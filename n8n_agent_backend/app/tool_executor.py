from typing import Dict, Any
import os
import json
import re
import requests

from .tool_definitions import TOOL_DEFINITIONS


def enrich_send_email_args(args: Dict[str, Any], prior_results: list, user_message: str) -> Dict[str, Any]:
    """
    Normalize send_email arguments:
    - Alias 'body' → 'text'
    - Extract 'to' email from user_message or prior results if missing
    - Auto-generate subject + text from prior tool results when missing
    - Perform template interpolation on ${var} placeholders from prior tool results
    """
    enriched = dict(args)

    # Normalize body → text
    if "body" in enriched and "text" not in enriched:
        enriched["text"] = enriched.pop("body")

    # Try to extract recipient email from user message
    if not enriched.get("to"):
        email_match = re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', user_message)
        if email_match:
            enriched["to"] = email_match.group(0)

    # Build summary text from prior successful tool results
    if not enriched.get("text") and not enriched.get("html"):
        summary_lines = ["✅ CasperOPs Yield Optimizer — Workflow Execution Summary\n"]
        for r in prior_results:
            tool = r.get("tool", "unknown")
            result = r.get("result", {})
            if r.get("success") and result:
                if tool == "fetch_price":
                    prices = result.get("prices", [])
                    if prices:
                        p = prices[0]
                        summary_lines.append(f"• Live Price: {p.get('coin','CSPR')} = ${p.get('price','N/A')} USD")
                elif tool == "get_balance":
                    summary_lines.append(f"• Wallet Balance: {result.get('balance', 'N/A')} CSPR (ready: {result.get('readiness', 'N/A')})")
                elif tool == "wallet_readiness":
                    summary_lines.append(f"• Wallet Readiness: {result.get('readiness', 'N/A')} — Balance: {result.get('balance', 'N/A')} CSPR")
                elif tool == "calculate":
                    inner = result.get("result", result)
                    summary_lines.append(f"• Yield Calculation: {inner.get('result', 'N/A')} (expr: {inner.get('resolved_expression','N/A')})")
                elif tool == "yield_rebalance":
                    actions = result.get("actions", [])
                    summary_lines.append(f"• Yield Rebalance Strategy: {result.get('strategyId','N/A')} (risk: {result.get('riskTolerance','N/A')})")
                    for a in actions:
                        summary_lines.append(f"  - {a.get('protocol')}: {a.get('action')} {a.get('allocation')}")
        summary_lines.append("\nAll workflow steps completed successfully on Casper Testnet.")
        enriched["text"] = "\n".join(summary_lines)

    if not enriched.get("subject"):
        enriched["subject"] = "✅ CasperOPs Yield Optimizer — Workflow Complete"

    # Build auto-variables from prior results for ${var} template interpolation
    auto_vars = {}
    for r in prior_results:
        if not r.get("success") or not r.get("result"):
            continue
        tool = r.get("tool")
        result = r.get("result")
        if tool == "fetch_price":
            prices = result.get("prices", [])
            if prices:
                coin = str(prices[0].get("coin") or "").lower()
                price = str(prices[0].get("price") or "")
                auto_vars["price"] = price
                auto_vars["price_usd"] = price
                auto_vars["token_price"] = price
                auto_vars["current_price"] = price
                auto_vars[f"{coin}_price"] = price
                if coin == "bitcoin":
                    auto_vars["btc_price"] = price
                elif coin == "btc":
                    auto_vars["bitcoin_price"] = price
                elif coin == "solana":
                    auto_vars["sol_price"] = price
                elif coin == "sol":
                    auto_vars["solana_price"] = price
                elif coin == "casper":
                    auto_vars["cspr_price"] = price
                elif coin == "cspr":
                    auto_vars["casper_price"] = price
        elif tool in ["get_balance", "wallet_readiness"]:
            balance = result.get("balance")
            if balance is not None:
                auto_vars["balance"] = str(balance)
                auto_vars["cspr_balance"] = str(balance)
        elif tool == "calculate":
            calc_result = result.get("result")
            if calc_result is None:
                calc_result = result
            if isinstance(calc_result, dict):
                val = calc_result.get("result")
            else:
                val = calc_result
            if val is not None:
                auto_vars["result"] = str(val)
                auto_vars["calc_result"] = str(val)

    # Perform template interpolation on string fields
    def interpolate_string(s: str) -> str:
        if not isinstance(s, str):
            return s
        def repl(match):
            var_name = match.group(1).lower()
            return auto_vars.get(var_name, match.group(0))
        return re.sub(r'\$\{([A-Za-z0-9_]+)\}', repl, s)

    for field in ["text", "body", "subject", "html"]:
        if field in enriched and isinstance(enriched[field], str):
            enriched[field] = interpolate_string(enriched[field])

    return enriched


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
                # This fixes the AI using e.g. "cspr_price" in expression but providing "casper_price"
                alias_map = {}
                for var_name in list(variables.keys()):
                    val = variables[var_name]
                    vn = var_name.lower()
                    # Price aliases
                    if 'price' in vn:
                        # cspr_price → also register as casper_price and vice versa
                        if 'cspr' in vn or 'casper' in vn:
                            for alias in ['cspr_price', 'casper_price', 'cspr_price_usd', 'price_cspr']:
                                alias_map[alias] = val
                        elif 'btc' in vn or 'bitcoin' in vn:
                            for alias in ['btc_price', 'bitcoin_price', 'btc_price_usd', 'price_btc']:
                                alias_map[alias] = val
                        elif 'sol' in vn or 'solana' in vn:
                            for alias in ['sol_price', 'solana_price', 'sol_price_usd', 'price_sol']:
                                alias_map[alias] = val
                        elif 'token' in vn:
                            # token_price → also register short coin names
                            for alias in ['token_price', 'token_price_usd', 'cspr_price', 'sol_price', 'btc_price', 'target_price']:
                                if alias not in variables:  # don't override explicit vars
                                    alias_map[alias] = val
                    # Balance aliases
                    if 'balance' in vn:
                        for alias in ['cspr_balance', 'balance', 'wallet_balance', 'my_balance']:
                            alias_map[alias] = val
                
                # Merge aliases into variables (don't override explicitly provided vars)
                merged_variables = {**alias_map, **variables}
                
                # --- FALLBACK: extract balance/amounts from description & expression context ---
                # The AI often writes the balance value in the description but forgets to put it in variables.
                # e.g. description="Calculate how many tokens with 1000 CSPR" or user_message has "1000 CSPR"
                # Scan for patterns like "1000 CSPR", "balance: 1000", "X CSPR balance"
                context_text = description
                if 'cspr_balance' not in merged_variables and 'balance' not in merged_variables:
                    balance_patterns = [
                        r'CSPR Balance:\s*([\d.]+)',                      # "CSPR Balance: 1000"
                        r'Balance for [a-zA-Z0-9_-]+:\s*([\d.]+)',        # "Balance for wallet: 1000"
                        r'balance[:\s]+([\d.]+)',                        # "balance: 1000"
                        r'with\s+([\d.]+)\s*(?:CSPR|casper)',             # "with 1000 CSPR"
                        r'has\s+([\d.]+)\s*(?:CSPR|casper)',              # "has 1000 CSPR"
                        r'\b(0\.\d+)\s*CSPR\b',                          # "0.1 CSPR" (< 1 CSPR)
                        r'(\d+\.?\d*)\s*casper',                         # "1000 casper"
                    ]
                    for pattern in balance_patterns:
                        m = re.search(pattern, context_text, re.IGNORECASE)
                        if m:
                            try:
                                extracted = float(m.group(1))
                                # CSPR balances can be large
                                if 0 < extracted < 100000000:
                                    merged_variables['cspr_balance'] = extracted
                                    merged_variables['balance'] = extracted
                                    merged_variables['wallet_balance'] = extracted
                                    merged_variables['my_balance'] = extracted
                                    print(f"[Calculate] Auto-extracted balance {extracted} CSPR from description")
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
    if "api.testnet.cspr.cloud" in endpoint:
        bearer_token = os.getenv("CSPR_CLOUD_API_KEY")
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
