from typing import Dict, Any
import os
import json
import requests

from .tool_definitions import TOOL_DEFINITIONS

def execute_tool(tool_name: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a tool by calling its API endpoint"""
    
    if tool_name not in TOOL_DEFINITIONS:
        raise ValueError(f"Unknown tool: {tool_name}")
    
    tool_def = TOOL_DEFINITIONS[tool_name]
    endpoint = tool_def["endpoint"]
    method = tool_def["method"]
    
    # Handle local tools (like calculate)
    if method == "LOCAL":
        if tool_name == "calculate":
            try:
                expression = parameters.get("expression", "")
                variables = parameters.get("variables", {})
                description = parameters.get("description", "Calculation")
                
                import re
                
                # Ensure variables is a dict (AI may send string or other types)
                if isinstance(variables, str):
                    try:
                        variables = json.loads(variables)
                    except (json.JSONDecodeError, TypeError):
                        variables = {}
                if not isinstance(variables, dict):
                    variables = {}
                
                # Normalize ALL whitespace (newlines, tabs, etc.) to single spaces
                resolved_expression = ' '.join(expression.split())
                
                # Build alias map: common variable name variants → canonical provided name
                # This fixes the AI using e.g. "arb_price" in expression but providing "arbitrum_price"
                alias_map = {}
                for var_name in list(variables.keys()):
                    val = variables[var_name]
                    vn = var_name.lower()
                    # Price aliases
                    if 'price' in vn:
                        # eth_price → also register as ethereum_price and vice versa
                        if 'eth' in vn:
                            for alias in ['eth_price', 'ethereum_price', 'eth_price_usd', 'price_eth']:
                                alias_map[alias] = val
                        elif 'btc' in vn or 'bitcoin' in vn:
                            for alias in ['btc_price', 'bitcoin_price', 'btc_price_usd', 'price_btc']:
                                alias_map[alias] = val
                        elif 'sol' in vn or 'solana' in vn:
                            for alias in ['sol_price', 'solana_price', 'sol_price_usd', 'price_sol']:
                                alias_map[alias] = val
                        elif 'arb' in vn or 'arbitrum' in vn:
                            for alias in ['arb_price', 'arbitrum_price', 'arb_price_usd', 'token_price', 'token_price_usd', 'price_arb']:
                                alias_map[alias] = val
                        elif 'token' in vn:
                            # token_price → also register short coin names
                            for alias in ['token_price', 'token_price_usd', 'arb_price', 'sol_price', 'btc_price', 'target_price']:
                                if alias not in variables:  # don't override explicit vars
                                    alias_map[alias] = val
                    # Balance aliases
                    if 'balance' in vn:
                        for alias in ['eth_balance', 'balance', 'wallet_balance', 'my_balance']:
                            alias_map[alias] = val
                
                # Merge aliases into variables (don't override explicitly provided vars)
                merged_variables = {**alias_map, **variables}
                
                # --- FALLBACK: extract balance/amounts from description & expression context ---
                # The AI often writes the balance value in the description but forgets to put it in variables.
                # e.g. description="Calculate how many ARB with 0.1 ETH" or user_message has "0.1 ETH"
                # Scan for patterns like "0.1 ETH", "balance: 0.1", "X ETH balance"
                context_text = description
                if 'eth_balance' not in merged_variables and 'balance' not in merged_variables:
                    balance_patterns = [
                        r'ETH Balance:\s*([\d.]+)',                      # "ETH Balance: 0.1"
                        r'Balance for 0x[a-fA-F0-9]+:\s*([\d.]+)',      # "Balance for 0x...: 0.1"
                        r'balance[:\s]+([\d.]+)',                        # "balance: 0.1"
                        r'with\s+([\d.]+)\s*(?:ETH|ether)',             # "with 0.1 ETH"
                        r'has\s+([\d.]+)\s*(?:ETH|ether)',              # "has 0.1 ETH"
                        r'\b(0\.\d+)\s*ETH\b',                          # "0.1 ETH" (< 1 ETH)
                        r'(\d+\.?\d*)\s*ether',                         # "0.1 ether"
                    ]
                    for pattern in balance_patterns:
                        m = re.search(pattern, context_text, re.IGNORECASE)
                        if m:
                            try:
                                extracted = float(m.group(1))
                                # Values > 1000 are almost certainly prices, not balances
                                if 0 < extracted < 1000:
                                    merged_variables['eth_balance'] = extracted
                                    merged_variables['balance'] = extracted
                                    merged_variables['wallet_balance'] = extracted
                                    merged_variables['my_balance'] = extracted
                                    print(f"[Calculate] Auto-extracted balance {extracted} ETH from description")
                                    break
                            except (ValueError, TypeError):
                                pass
                
                # Substitute variables (sort by name length desc to avoid partial matches)
                if merged_variables:
                    sorted_vars = sorted(merged_variables.items(), key=lambda x: len(str(x[0])), reverse=True)
                    for var_name, var_value in sorted_vars:
                        # Convert value to float, stripping commas and whitespace
                        try:
                            numeric_value = float(str(var_value).replace(',', '').strip())
                        except (ValueError, TypeError):
                            return {
                                "success": False,
                                "tool": tool_name,
                                "error": f"Variable '{var_name}' has non-numeric value: {var_value}"
                            }
                        resolved_expression = re.sub(
                            r'\b' + re.escape(str(var_name)) + r'\b',
                            str(numeric_value),
                            resolved_expression
                        )
                
                # Normalize whitespace again after substitution
                resolved_expression = ' '.join(resolved_expression.split())
                
                # Check if there are still unresolved variable names
                variable_pattern = r'[a-zA-Z_][a-zA-Z0-9_]*'
                found_variables = re.findall(variable_pattern, resolved_expression)
                # Filter out 'e' which is valid for scientific notation like 1e10
                found_variables = [v for v in found_variables if v.lower() != 'e']
                
                if found_variables:
                    return {
                        "success": False,
                        "tool": tool_name,
                        "error": f"Unresolved variables in expression: {', '.join(found_variables)}. Resolved so far: '{resolved_expression}'. Available variables were: {list(merged_variables.keys())}. Please ensure expression variable names match the provided variables."
                    }
                
                # Safely evaluate the expression (only allow basic math)
                allowed_chars = set("0123456789+-*/().e ")
                if not all(c in allowed_chars for c in resolved_expression.lower()):
                    bad_chars = [c for c in resolved_expression if c.lower() not in allowed_chars]
                    return {
                        "success": False,
                        "tool": tool_name,
                        "error": f"Invalid characters in expression: {bad_chars}. Resolved expression: '{resolved_expression}'. Only numbers and basic operators are allowed."
                    }
                    
                result = eval(resolved_expression)
                return {
                    "success": True,
                    "tool": tool_name,
                    "result": {
                        "original_expression": expression,
                        "variables": variables,
                        "resolved_expression": resolved_expression,
                        "result": result,
                        "description": description
                    }
                }
            except Exception as e:
                return {
                    "success": False,
                    "tool": tool_name,
                    "error": f"Calculation error: {str(e)}. Expression: '{parameters.get('expression', '')}', Variables: {parameters.get('variables', {})}"
                }
    
    # Handle URL parameters for GET requests
    url_params_to_replace = {
        "{address}": "address",
        "{tokenId}": "tokenId",
        "{ownerAddress}": "ownerAddress",
        "{collectionAddress}": "collectionAddress"
    }
    
    params_for_request = parameters.copy()
    
    # Replace URL parameters
    for placeholder, param_name in url_params_to_replace.items():
        if placeholder in endpoint and param_name in params_for_request:
            endpoint = endpoint.replace(placeholder, str(params_for_request[param_name]))
            del params_for_request[param_name]
    
    # Prepare headers - check if Bearer token is needed
    headers = {}
    if "api.subgraph.arbitrum.network" in endpoint:
        bearer_token = os.getenv("ARBITRUM_BEARER_TOKEN")
        if bearer_token:
            headers["Authorization"] = f"Bearer {bearer_token}"
    
    try:
        if method == "POST":
            response = requests.post(endpoint, json=params_for_request, headers=headers, timeout=60)
        elif method == "GET":
            response = requests.get(endpoint, headers=headers, timeout=60)
        else:
            raise ValueError(f"Unsupported HTTP method: {method}")
        
        response.raise_for_status()
        return {
            "success": True,
            "tool": tool_name,
            "result": response.json()
        }
    except requests.exceptions.RequestException as e:
        return {
            "success": False,
            "tool": tool_name,
            "error": str(e)
        }
