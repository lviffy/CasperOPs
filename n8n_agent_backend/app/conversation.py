from typing import List, Dict, Any, Optional
import json
from fastapi import HTTPException
import google.generativeai as genai

from .tool_definitions import TOOL_DEFINITIONS
from .config import groq_clients, GEMINI_API_KEY
from .ai_helpers import get_openai_tools, enrich_calculate_args, convert_to_gemini_tools
from .tool_executor import execute_tool

def process_agent_conversation(
    system_prompt: str,
    user_message: str,
    available_tools: List[str],
    tool_flow: Dict[str, str],
    private_key: Optional[str] = None,
    wallet_address: Optional[str] = None,
    max_iterations: int = 10
) -> Dict[str, Any]:
    """
    Process the conversation with the AI agent
    Primary: Groq (moonshotai/kimi-k2-instruct-0905) with tool use
    Fallback: Google Gemini
    """
    
    # Add wallet context if available (preferred over private key)
    if wallet_address:
        system_prompt += f"\n\nCONTEXT: User's connected wallet address is: {wallet_address}. Use this as the fromAddress for transfers."
    elif private_key:
        system_prompt += f"\n\nCONTEXT: User's private key is available: {private_key}"
    
    all_tool_calls = []
    all_tool_results = []
    iteration = 0
    
    # Build OpenAI-compatible tools for Groq
    openai_tools = get_openai_tools(available_tools)
    
    # Try all Groq clients (Primary)
    if groq_clients:
        for client_idx, groq_client in enumerate(groq_clients, 1):
            try:
                print(f"Attempting Groq API key {client_idx}/{len(groq_clients)}...")
                
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ]
                
                iteration = 0
                all_tool_calls = []
                all_tool_results = []
                
                while iteration < max_iterations:
                    iteration += 1
                    
                    for tool_call in response_message.tool_calls:
                        function_name = tool_call.function.name
                        function_args = json.loads(tool_call.function.arguments)
                        
                        # Add private key if needed and available
                        if private_key and function_name in TOOL_DEFINITIONS:
                            tool_params = TOOL_DEFINITIONS[function_name]["parameters"]["properties"]
                            if "privateKey" in tool_params and "privateKey" not in function_args:
                                function_args["privateKey"] = private_key
                        
                        # Auto-inject missing variables for calculate from prior tool results
                        if function_name == "calculate":
                            function_args = enrich_calculate_args(function_args, all_tool_results, user_message)
                        
                        all_tool_calls.append({
                            "tool": function_name,
                            "parameters": function_args
                        })
                        
                        # Execute the tool
                        result = execute_tool(function_name, function_args)
                        all_tool_results.append(result)
                        
                        # Add tool result to messages
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": json.dumps(result)
                        })
                        
                        for tool_call in response_message.tool_calls:
                            function_name = tool_call.function.name
                            function_args = json.loads(tool_call.function.arguments)
                            
                            # Add wallet address for transfer tool if available and needed
                            if wallet_address and function_name == "transfer":
                                if "fromAddress" not in function_args:
                                    function_args["fromAddress"] = wallet_address
                            # Add wallet address for get_balance if asking for "my balance"
                            elif wallet_address and function_name == "get_balance":
                                if "address" not in function_args or not function_args["address"]:
                                    function_args["address"] = wallet_address
                            # Fallback to private key if needed and available
                            elif private_key and function_name in TOOL_DEFINITIONS:
                                tool_params = TOOL_DEFINITIONS[function_name]["parameters"]["properties"]
                                if "privateKey" in tool_params and "privateKey" not in function_args:
                                    function_args["privateKey"] = private_key
                            
                            all_tool_calls.append({
                                "tool": function_name,
                                "parameters": function_args
                            })
                            
                            # Execute the tool
                            result = execute_tool(function_name, function_args)
                            all_tool_results.append(result)
                            
                            # Add tool result to messages
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": json.dumps(result)
                            })
                            
                            # Check if we need to continue with sequential tools
                            if function_name in tool_flow:
                                next_tool = tool_flow[function_name]
                                messages.append({
                                    "role": "user",
                                    "content": f"Now immediately call the {next_tool} tool as it is next in the sequential flow."
                                })
                    else:
                        # No tool calls, return final response
                        print(f"✓ Groq API key {client_idx} succeeded")
                        return {
                            "agent_response": response_message.content,
                            "tool_calls": all_tool_calls,
                            "results": all_tool_results,
                            "conversation_history": [],
                            "provider": f"Groq key {client_idx} (moonshotai/kimi-k2-instruct-0905)"
                        }
                
                # Max iterations reached with this Groq client
                print(f"✓ Groq API key {client_idx} completed (max iterations)")
                return {
                    "agent_response": "Maximum iterations reached. Please try again with a simpler request.",
                    "tool_calls": all_tool_calls,
                    "results": all_tool_results,
                    "conversation_history": [],
                    "provider": f"Groq key {client_idx} (moonshotai/kimi-k2-instruct-0905)"
                }
                
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
                    print(f"⚠️ Groq key {client_idx} rate limited - trying next key or fallback...")
                    continue
                elif is_invalid_key:
                    print(f"⚠️ Groq key {client_idx} is invalid - trying next key...")
                    continue
                else:
                    print(f"⚠️ Groq API key {client_idx} failed: {error_msg}")
                    continue
            
            # Reset iteration counter for next client
            all_tool_calls = []
            all_tool_results = []
            iteration = 0
    
    # Fallback to Gemini
    if GEMINI_API_KEY:
        print("Attempting Gemini API (Fallback)...")
        
        # Build function declarations for Gemini
        function_declarations = convert_to_gemini_tools(available_tools)

        # Initialize Gemini model with fallback chain
        model_names = [
            'gemini-3.1-flash-lite-preview',
            'gemini-2.0-flash',
            'gemini-1.5-flash-002',
            'gemini-1.5-flash-001',
            'gemini-1.5-flash'
        ]
        model = None
        chat = None
        last_error = None

        tools_configuration = [{"function_declarations": function_declarations}] if function_declarations else None

        for name in model_names:
            try:
                print(f"Attempting to initialize Gemini model: {name}")
                model = genai.GenerativeModel(
                    model_name=name,
                    tools=tools_configuration,
                    generation_config={
                        "temperature": 0.7,
                        "top_p": 0.8,
                        "top_k": 40,
                    }
                )
                chat = model.start_chat(history=[])
                print(f"Successfully initialized Gemini model: {name}")
                break
            except Exception as e:
                print(f"Failed to initialize {name}: {str(e)}")
                last_error = e
                continue
        
        if not model:
            try:
                print("All Flash models failed. Falling back to Gemini 1.5 Pro...")
                model = genai.GenerativeModel(
                    model_name='gemini-1.5-pro',
                    tools=tools_configuration,
                    generation_config={
                        "temperature": 0.7,
                        "top_p": 0.8,
                        "top_k": 40,
                    }
                )
                chat = model.start_chat(history=[])
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"All AI providers failed. Last error: {str(last_error)}")
        
        full_prompt = f"{system_prompt}\n\nUser: {user_message}"
        
        while iteration < max_iterations:
            iteration += 1
            
            try:
                response = chat.send_message(full_prompt)
            except Exception as e:
                if "429" in str(e):
                    raise HTTPException(
                        status_code=429,
                        detail="Gemini rate limit exceeded. All AI providers are temporarily unavailable."
                    )
                raise e
            
            function_calls = []
            if response.candidates and response.candidates[0].content.parts:
                for part in response.candidates[0].content.parts:
                    if hasattr(part, 'function_call') and part.function_call:
                        function_calls.append(part.function_call)
            
            if not function_calls:
                return {
                    "agent_response": response.text,
                    "tool_calls": all_tool_calls,
                    "results": all_tool_results,
                    "conversation_history": [],
                    "provider": "Gemini (fallback)"
                }
            
            for function_call in function_calls:
                function_name = function_call.name
                function_args = dict(function_call.args)
                
                # Add wallet address for transfer tool if available and needed
                if wallet_address and function_name == "transfer":
                    if "fromAddress" not in function_args:
                        function_args["fromAddress"] = wallet_address
                # Add wallet address for get_balance if asking for "my balance"
                elif wallet_address and function_name == "get_balance":
                    if "address" not in function_args or not function_args["address"]:
                        function_args["address"] = wallet_address
                # Fallback to private key if needed and available
                elif private_key and function_name in TOOL_DEFINITIONS:
                    tool_params = TOOL_DEFINITIONS[function_name]["parameters"]["properties"]
                    if "privateKey" in tool_params and "privateKey" not in function_args:
                        function_args["privateKey"] = private_key
                
                # Auto-inject missing variables for calculate from prior tool results
                if function_name == "calculate":
                    function_args = enrich_calculate_args(function_args, all_tool_results, user_message)
                
                all_tool_calls.append({
                    "tool": function_name,
                    "parameters": function_args
                })
                
                result = execute_tool(function_name, function_args)
                all_tool_results.append(result)
                
                full_prompt = f"Function {function_name} returned: {json.dumps(result)}"
            
            if all_tool_calls:
                last_tool_executed = all_tool_calls[-1]["tool"]
                if last_tool_executed in tool_flow:
                    next_tool = tool_flow[last_tool_executed]
                    full_prompt += f"\n\nIMPORTANT: You must now immediately call the {next_tool} tool as it is next in the sequential flow."
        
        return {
            "agent_response": "Maximum iterations reached. Please try again with a simpler request.",
            "tool_calls": all_tool_calls,
            "results": all_tool_results,
            "conversation_history": [],
            "provider": "Gemini (fallback)"
        }
    
    raise HTTPException(status_code=500, detail="No AI provider available")

