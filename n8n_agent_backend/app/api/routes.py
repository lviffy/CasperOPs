from fastapi import HTTPException
import os
import json
import traceback
import google.generativeai as genai

from ..app_instance import app
from ..schemas import AgentRequest, AgentResponse, WorkflowRequest, WorkflowResponse, AITool
from ..tool_definitions import TOOL_DEFINITIONS
from ..prompt_builder import build_system_prompt
from ..conversation import process_agent_conversation
from ..config import groq_clients, GEMINI_API_KEY, BACKEND_URL

@app.post("/agent/chat", response_model=AgentResponse)
async def chat_with_agent(request: AgentRequest):
    """
    Main endpoint to interact with the AI agent.
    Dynamically configures the agent based on tool connections.
    """
    
    try:
        # Extract unique tools and build flow map
        unique_tools = set()
        tool_flow = {}
        
        for conn in request.tools:
            unique_tools.add(conn.tool)
            if conn.next_tool:
                unique_tools.add(conn.next_tool)
                tool_flow[conn.tool] = conn.next_tool
        
        available_tools = list(unique_tools)
        
        # Validate tools
        for tool in available_tools:
            if tool not in TOOL_DEFINITIONS:
                raise HTTPException(status_code=400, detail=f"Unknown tool: {tool}")
        
        # Build system prompt
        system_prompt = build_system_prompt(request.tools)
        
        # Process conversation with sequential support
        result = process_agent_conversation(
            system_prompt=system_prompt,
            user_message=request.user_message,
            available_tools=available_tools,
            tool_flow=tool_flow,
            private_key=request.private_key,
            wallet_address=request.wallet_address
        )
        
        return AgentResponse(
            agent_response=result["agent_response"],
            tool_calls=result["tool_calls"],
            results=result["results"]
        )
    
    except Exception as e:
        import traceback
        error_detail = f"{str(e)}\n\nTraceback:\n{traceback.format_exc()}"
        print(f"ERROR in /agent/chat: {error_detail}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/create-workflow", response_model=WorkflowResponse)
async def create_workflow(request: WorkflowRequest):
    """
    Generate a workflow configuration from a natural language query.
    This endpoint analyzes the user's request and returns a structured workflow with tools.
    """
    
    try:
        # System prompt for workflow generation
        workflow_system_prompt = """You are an AI workflow designer for Casper Testnet blockchain operations.
Your task is to analyze the user's request and create a structured workflow with the appropriate blockchain tools.

AVAILABLE TOOLS:
- transfer: Transfer native CSPR tokens from one address to another
- get_balance: Get native CSPR balance of a wallet address
- deploy_cep18: Deploy a new CEP-18 token (Casper's ERC-20 equivalent)
- deploy_cep78: Deploy a new CEP-78 NFT collection (Casper's ERC-721 equivalent)
- mint_nft: Mint a new NFT in an existing CEP-78 collection
- register_agent: Register a new AI agent on the Casper AgentFactory contract
- get_reputation: Fetch agent reputation stats from Reputation contract
- attest_agent: Submit an RWA compliance attestation for an agent via Compliance contract
- lookup_deploy: Look up execution status of a Casper deploy hash
- get_token_info: Get metadata of a deployed CEP-18 token
- get_nft_info: Get metadata of a deployed CEP-78 NFT
- fetch_price: Fetch the current live price of CSPR or other tokens
- send_email: Send email notification to recipients
- calculate: Evaluate mathematical calculations

RESPONSE FORMAT:
You must respond with a valid JSON object containing:
{
  "tools": [
    {
      "type": "tool_name",
      "name": "Descriptive Name",
      "next_tools": ["next_tool_type"] or []
    }
  ],
  "description": "Brief description of what this workflow does",
  "has_sequential_execution": true/false
}

RULES:
1. Identify which tool(s) are needed based on the user's request
2. If multiple operations need to happen in sequence, set has_sequential_execution to true
3. Use next_tools array to link sequential operations
4. Keep the description clear and concise
5. Only include tools that are needed for the request
6. Return ONLY the JSON object, no additional text

EXAMPLES:

User: "Deploy a new CEP-18 token called MYTOKEN with 1000000 supply"
Response:
{
  "tools": [{"type": "deploy_cep18", "name": "Deploy MYTOKEN CEP-18", "next_tools": []}],
  "description": "Deploy CEP-18 token MYTOKEN with 1,000,000 initial supply",
  "has_sequential_execution": false
}

User: "Deploy a CEP-78 NFT collection and mint the first NFT"
Response:
{
  "tools": [
    {"type": "deploy_cep78", "name": "Deploy CEP-78 NFT Collection", "next_tools": ["mint_nft"]},
    {"type": "mint_nft", "name": "Mint First NFT", "next_tools": []}
  ],
  "description": "Deploy a CEP-78 NFT collection and mint the first NFT",
  "has_sequential_execution": true
}

User: "Check my wallet balance"
Response:
{
  "tools": [{"type": "get_balance", "name": "Check CSPR Balance", "next_tools": []}],
  "description": "Check the native CSPR balance of your wallet",
  "has_sequential_execution": false
}
"""

        # Use Groq for workflow generation - try all keys
        if groq_clients:
            for client_idx, groq_client in enumerate(groq_clients, 1):
                try:
                    print(f"Attempting workflow generation with Groq key {client_idx}/{len(groq_clients)}")
                    
                    completion = groq_client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        messages=[
                            {"role": "system", "content": workflow_system_prompt},
                            {"role": "user", "content": request.prompt}
                        ],
                        temperature=0.5,
                        max_tokens=2048,
                    )
                    
                    response_text = completion.choices[0].message.content.strip()
                    
                    # Parse the JSON response
                    # Remove markdown code blocks if present
                    if response_text.startswith("```json"):
                        response_text = response_text[7:]
                    if response_text.startswith("```"):
                        response_text = response_text[3:]
                    if response_text.endswith("```"):
                        response_text = response_text[:-3]
                    
                    response_text = response_text.strip()
                    workflow_data = json.loads(response_text)
                    
                    # Generate tool IDs and structure
                    tools = []
                    for idx, tool in enumerate(workflow_data.get("tools", [])):
                        tools.append(AITool(
                            id=f"tool_{idx + 1}",
                            type=tool.get("type", ""),
                            name=tool.get("name", ""),
                            next_tools=tool.get("next_tools", [])
                        ))
                    
                    print(f"✓ Groq key {client_idx} succeeded for workflow generation")
                    return WorkflowResponse(
                        agent_id=f"workflow_{int(os.urandom(4).hex(), 16)}",
                        tools=tools,
                        has_sequential_execution=workflow_data.get("has_sequential_execution", False),
                        description=workflow_data.get("description", "Generated workflow"),
                        raw_response=response_text
                    )
                    
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
                    
                    if is_rate_limit:
                        print(f"⚠️ Groq key {client_idx} rate limited - trying next key or fallback...")
                        continue
                    else:
                        print(f"⚠️ Groq key {client_idx} workflow generation failed: {error_msg}")
                        if client_idx < len(groq_clients):
                            continue
                        else:
                            print("All Groq keys rate limited, falling back to Gemini...")
                            break
        
        # Fallback to Gemini
        if GEMINI_API_KEY:
            try:
                model = genai.GenerativeModel(
                    model_name='gemini-3.1-flash-lite-preview',
                    generation_config={
                        "temperature": 0.5,
                        "top_p": 0.8,
                    }
                )
                
                prompt = f"{workflow_system_prompt}\n\nUser Query: {request.prompt}"
                response = model.generate_content(prompt)
                response_text = response.text.strip()
                
                # Parse the JSON response
                if response_text.startswith("```json"):
                    response_text = response_text[7:]
                if response_text.startswith("```"):
                    response_text = response_text[3:]
                if response_text.endswith("```"):
                    response_text = response_text[:-3]
                
                response_text = response_text.strip()
                workflow_data = json.loads(response_text)
                
                # Generate tool IDs and structure
                tools = []
                for idx, tool in enumerate(workflow_data.get("tools", [])):
                    tools.append(AITool(
                        id=f"tool_{idx + 1}",
                        type=tool.get("type", ""),
                        name=tool.get("name", ""),
                        next_tools=tool.get("next_tools", [])
                    ))
                
                return WorkflowResponse(
                    agent_id=f"workflow_{int(os.urandom(4).hex(), 16)}",
                    tools=tools,
                    has_sequential_execution=workflow_data.get("has_sequential_execution", False),
                    description=workflow_data.get("description", "Generated workflow"),
                    raw_response=response_text
                )
                
            except Exception as gemini_error:
                raise HTTPException(status_code=500, detail=f"Gemini workflow generation failed: {str(gemini_error)}")
        
        raise HTTPException(status_code=500, detail="No AI providers available")
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response as JSON: {str(e)}")
    except Exception as e:
        import traceback
        error_detail = f"{str(e)}\n\nTraceback:\n{traceback.format_exc()}"
        print(f"ERROR in /create-workflow: {error_detail}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "AI Agent Builder",
        "blockchain": "Casper Testnet",
        "ai_providers": {
            "primary": "Groq (llama-3.3-70b-versatile)" if groq_clients else "Not configured",
            "fallback": "Google Gemini 3.1 Flash Lite" if GEMINI_API_KEY else "Not configured"
        },
        "backend_url": BACKEND_URL
    }

@app.get("/tools")
async def list_tools():
    """List all available tools"""
    return {
        "tools": list(TOOL_DEFINITIONS.keys()),
        "details": TOOL_DEFINITIONS
    }
