from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import google.generativeai as genai
from groq import Groq
import json
import os
import logging
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Agent Workflow Builder API - Arbitrum Sepolia Edition")

# Add CORS middleware to allow requests from anywhere
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
)

# Configure API Keys
GROQ_API_KEYS = [
    os.getenv("GROQ_API_KEY1"),
    os.getenv("GROQ_API_KEY2"),
    os.getenv("GROQ_API_KEY3")
]
GROQ_API_KEYS = [key for key in GROQ_API_KEYS if key]  # Filter out None values

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Initialize clients
groq_clients = []
if GROQ_API_KEYS:
    for i, key in enumerate(GROQ_API_KEYS, 1):
        groq_clients.append(Groq(api_key=key))
        logger.info(f"Groq client {i} initialized")
    logger.info(f"Total {len(groq_clients)} Groq client(s) initialized (Primary)")
else:
    logger.warning("No Groq API keys configured")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    logger.info("Gemini configured (Fallback)")

if not GROQ_API_KEYS and not GEMINI_API_KEY:
    raise ValueError("At least one of GROQ_API_KEY1-3 or GEMINI_API_KEY must be set")

class WorkflowRequest(BaseModel):
    prompt: str
    temperature: Optional[float] = 0.3
    max_tokens: Optional[int] = 2000

class ToolNode(BaseModel):
    id: str
    type: str
    name: str
    next_tools: List[str] = []

class WorkflowResponse(BaseModel):
    agent_id: str
    tools: List[ToolNode]
    has_sequential_execution: bool
    description: str
    raw_response: Optional[str] = None

# Available tools in the platform
AVAILABLE_TOOLS = [
    "transfer",
    "get_balance",
    "deploy_erc20",
    "deploy_erc721",
    "fetch_token_price",
    "send_email"
]

SYSTEM_PROMPT = """You are an AI that converts natural language descriptions of blockchain agent workflows into structured JSON for the Arbitrum Sepolia blockchain.

Available tools:
- transfer: Transfer ETH or ERC-20 tokens between wallets
- get_balance: Fetch balance of ETH for a wallet
- deploy_erc20: Deploy ERC-20 tokens on Arbitrum Sepolia
- deploy_erc721: Deploy ERC-721 NFT tokens on Arbitrum Sepolia
- fetch_token_price: Get the current price of any token using AI-powered search
- send_email: Send email notifications to recipients (compose subject & body from user intent)

Your task is to analyze the user's request and create a workflow structure with:
1. An agent node (always present, id: "agent_1")
2. Tool nodes that the agent can use
3. Sequential connections when tools should execute in order
4. Parallel connections when tools are independent

Rules:
- The agent node always has id "agent_1" and type "agent"
- Each tool gets a unique id like "tool_1", "tool_2", etc.
- If tools should execute sequentially (one after another), set the next_tools field
- If tools are independent, they connect directly to the agent with empty next_tools
- Sequential execution examples: "deploy token then transfer", "check balance and then transfer"
- Parallel execution examples: "agent with multiple tools", "various tools available"
- IMPORTANT: Set has_sequential_execution to true if ANY tool has non-empty next_tools array
- IMPORTANT: Set has_sequential_execution to false ONLY if ALL tools have empty next_tools arrays

Return ONLY valid JSON matching this exact structure:
{
  "agent_id": "agent_1",
  "tools": [
    {
      "id": "tool_1",
      "type": "deploy_erc20",
      "name": "Token Deployment",
      "next_tools": ["tool_2"]
    },
    {
      "id": "tool_2",
      "type": "transfer",
      "name": "Transfer Tool",
      "next_tools": []
    }
  ],
  "has_sequential_execution": true,
  "description": "Brief description of the workflow"
}"""

@app.post("/create-workflow", response_model=WorkflowResponse)
async def create_workflow(request: WorkflowRequest):
    """
    Convert natural language workflow description to structured JSON
    Primary: Groq (moonshotai/kimi-k2-instruct-0905)
    Fallback: Google Gemini
    """
    try:
        logger.info(f"Processing workflow request: {request.prompt}")
        logger.info(f"Temperature: {request.temperature}, Max Tokens: {request.max_tokens}")
        
        full_prompt = f"{SYSTEM_PROMPT}\n\nUser Query: {request.prompt}\n\nGenerate the workflow JSON:"
        raw_content = None
        provider_used = None
        
        # Try all Groq clients (Primary)
        if groq_clients:
            for client_idx, groq_client in enumerate(groq_clients, 1):
                try:
                    logger.info(f"Attempting Groq API key {client_idx}/{len(groq_clients)}...")
                    
                    groq_response = groq_client.chat.completions.create(
                        model="moonshotai/kimi-k2-instruct-0905",
                        messages=[
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": f"User Query: {request.prompt}\n\nGenerate the workflow JSON:"}
                        ],
                        temperature=request.temperature,
                        max_tokens=request.max_tokens,
                        response_format={"type": "json_object"}
                    )
                    
                    raw_content = groq_response.choices[0].message.content
                    provider_used = f"Groq key {client_idx} (moonshotai/kimi-k2-instruct-0905)"
                    logger.info(f"✓ Groq key {client_idx} response received successfully")
                    break  # Success, exit loop
                    
                except Exception as groq_error:
                    error_msg = str(groq_error)
                    
                    # Enhanced rate limit detection
                    is_rate_limit = (
                        "rate_limit" in error_msg.lower() or 
                        "429" in error_msg or
                        "rate limit" in error_msg.lower() or
                        hasattr(groq_error, 'status_code') and groq_error.status_code == 429 or
                        hasattr(groq_error, 'status') and groq_error.status == 429
                    )
                    
                    # Enhanced invalid key detection
                    is_invalid_key = (
                        "invalid_api_key" in error_msg.lower() or
                        "invalid api key" in error_msg.lower() or
                        "authentication" in error_msg.lower() or
                        hasattr(groq_error, 'status_code') and groq_error.status_code == 401 or
                        hasattr(groq_error, 'status') and groq_error.status == 401
                    )
                    
                    if is_rate_limit:
                        logger.warning(f"⚠️ Groq key {client_idx} rate limited - trying next key or fallback...")
                        # Continue to next key or fallback
                        continue
                    elif is_invalid_key:
                        logger.warning(f"⚠️ Groq key {client_idx} is invalid - trying next key...")
                        continue
                    else:
                        logger.warning(f"⚠️ Groq API key {client_idx} failed: {error_msg}")
                        # For other errors, also try next key
                        continue
        
        # Fallback to Gemini if Groq failed or not available
        if raw_content is None and GEMINI_API_KEY:
            try:
                logger.info("Attempting Gemini API (Fallback)...")
                
                model = genai.GenerativeModel(
                    model_name='gemini-3.1-flash-lite-preview',
                    generation_config={
                        "temperature": request.temperature,
                        "max_output_tokens": request.max_tokens,
                        "response_mime_type": "application/json"
                    }
                )
                
                response = model.generate_content(full_prompt)
                raw_content = response.text
                provider_used = "Gemini (gemini-3.1-flash-lite)"
                logger.info(f"Gemini response received successfully")
                
            except Exception as gemini_error:
                logger.error(f"Gemini API also failed: {str(gemini_error)}")
                raise HTTPException(status_code=500, detail=f"Both AI providers failed. Groq error: Primary not available, Gemini error: {str(gemini_error)}")
        
        if raw_content is None:
            raise HTTPException(status_code=500, detail="No AI provider available")
        
        logger.info(f"Raw AI Response ({provider_used}): {raw_content}")
        
        # Parse the response
        workflow_data = json.loads(raw_content)
        workflow_data["raw_response"] = raw_content
        
        logger.info(f"Parsed workflow data: {json.dumps(workflow_data, indent=2)}")
        logger.info(f"Provider used: {provider_used}")
        
        return WorkflowResponse(**workflow_data)
    
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON response: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Invalid JSON response: {str(e)}")
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")

@app.get("/available-tools")
async def get_available_tools():
    """
    Get list of available tools in the platform
    """
    return {"tools": AVAILABLE_TOOLS}

@app.get("/health")
async def health_check():
    """
    Health check endpoint
    """
    return {
        "status": "healthy",
        "service": "Agent Workflow Builder",
        "blockchain": "Arbitrum Sepolia",
        "ai_providers": {
            "primary": "Groq (llama-3.3-70b-versatile)" if GROQ_API_KEY else "Not configured",
            "fallback": "Google Gemini 3.1 Flash Lite" if GEMINI_API_KEY else "Not configured"
        }
    }

# Example usage
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)