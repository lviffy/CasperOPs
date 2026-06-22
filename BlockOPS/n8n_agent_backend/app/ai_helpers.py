from typing import List, Dict, Any
import re as _re

from .tool_definitions import TOOL_DEFINITIONS

def convert_to_gemini_tools(tool_names: List[str]) -> List[Dict[str, Any]]:
    """Convert tool definitions to Gemini function declaration format"""
    function_declarations = []
    
    for tool_name in tool_names:
        if tool_name in TOOL_DEFINITIONS:
            tool_def = TOOL_DEFINITIONS[tool_name]
            
            # Deep copy to avoid modifying original
            import copy
            parameters = copy.deepcopy(tool_def["parameters"])
            
            # Convert types to uppercase for Gemini (STRING, NUMBER, OBJECT, etc.)
            if "type" in parameters:
                parameters["type"] = parameters["type"].upper()
            
            if "properties" in parameters:
                for prop_name, prop_def in parameters["properties"].items():
                    if "type" in prop_def:
                        prop_def["type"] = prop_def["type"].upper()
            
            function_declarations.append({
                "name": tool_def["name"],
                "description": tool_def["description"],
                "parameters": parameters
            })
    
    return function_declarations

def get_openai_tools(tool_names: List[str]) -> List[Dict[str, Any]]:
    """Convert tool definitions to OpenAI function calling format"""
    tools = []
    for tool_name in tool_names:
        if tool_name in TOOL_DEFINITIONS:
            tool_def = TOOL_DEFINITIONS[tool_name]
            tools.append({
                "type": "function",
                "function": {
                    "name": tool_def["name"],
                    "description": tool_def["description"],
                    "parameters": tool_def["parameters"]
                }
            })
    
    return tools

def enrich_calculate_args(function_args: Dict[str, Any], all_tool_results: List[Dict[str, Any]], context_text: str = "") -> Dict[str, Any]:
    """
    Before executing a calculate tool call, auto-inject missing numeric variables
    from previous tool results (get_balance, fetch_price) so the AI doesn't have to
    manually include every value in the variables dict.
    Also scans context_text (user_message) for balance values like '0.1 ETH'.
    """
    if not function_args.get("expression"):
        return function_args

    variables = function_args.get("variables", {})
    if not isinstance(variables, dict):
        variables = {}

    # Scan all previous successful results
    for tr in all_tool_results:
        if not tr.get("success") or not tr.get("result"):
            continue
        tool = tr.get("tool", "")
        result = tr["result"]

        if tool == "get_balance":
            balance_val = result.get("balance") or result.get("balanceInEth")
            if balance_val is not None:
                try:
                    b = float(str(balance_val))
                    # Only inject if not already explicitly set
                    for key in ["eth_balance", "balance", "wallet_balance", "my_balance"]:
                        if key not in variables:
                            variables[key] = b
                except (ValueError, TypeError):
                    pass

        if tool == "fetch_price":
            prices = result.get("prices", [])
            if prices and isinstance(prices, list):
                price_val = prices[0].get("price")
                coin = (prices[0].get("coin") or "").lower()
                if price_val is not None:
                    try:
                        p = float(price_val)
                        if "eth" in coin or "ethereum" in coin:
                            for key in ["eth_price", "eth_price_usd", "ethereum_price"]:
                                if key not in variables:
                                    variables[key] = p
                        elif "btc" in coin or "bitcoin" in coin:
                            for key in ["btc_price", "bitcoin_price"]:
                                if key not in variables:
                                    variables[key] = p
                        elif "sol" in coin or "solana" in coin:
                            for key in ["sol_price", "solana_price"]:
                                if key not in variables:
                                    variables[key] = p
                        else:
                            # Generic token — register under the coin name and common aliases
                            for key in [f"{coin}_price", "token_price", "token_price_usd",
                                        "arb_price", "sol_price", "target_price"]:
                                if key not in variables:
                                    variables[key] = p
                    except (ValueError, TypeError):
                        pass

    function_args = dict(function_args)
    function_args["variables"] = variables

    # Also scan context_text (user_message) for a balance value as last resort.
    # The conversationController.js embeds e.g. "ETH Balance: 0.1 ETH" in user_message.
    # We only inject if the value looks like a wallet balance (< 100 ETH), not a price.
    if context_text and not any(k in variables for k in ["eth_balance", "balance", "wallet_balance"]):
        import re as _re
        balance_patterns = [
            # Most specific patterns first to avoid false matches
            r'ETH Balance:\s*([\d.]+)',                      # "ETH Balance: 0.1"
            r'Balance for 0x[a-fA-F0-9]+:\s*([\d.]+)',      # "Balance for 0x...: 0.1 ETH"
            r'balanceInEth["\s:>]+([\d.]+)',                 # JSON key
            r'(?:wallet\s*)?balance[:\s]+([\d.]+)\s*(?:ETH)?',  # "balance: 0.1" / "wallet balance: 0.1"
            r'with\s+([\d.]+)\s*ETH\b',                     # "with 0.1 ETH"
            r'has\s+([\d.]+)\s*ETH\b',                      # "has 0.1 ETH"
            r'holding\s+([\d.]+)\s*ETH\b',                  # "holding 0.5 ETH"
            r'\b(0\.\d+)\s*ETH\b',                          # "0.1 ETH" — only values < 1 ETH
            r'\b([1-9]\d*\.\d+)\s*ETH\b(?!.*price)',        # "1.5 ETH" but not near the word "price"
        ]
        for pattern in balance_patterns:
            m = _re.search(pattern, context_text, _re.IGNORECASE)
            if m:
                try:
                    b = float(m.group(1))
                    # Sanity check: a wallet balance is typically < 1000 ETH;
                    # values > 1000 are almost certainly prices, not balances.
                    if 0 < b < 1000:
                        for key in ["eth_balance", "balance", "wallet_balance", "my_balance"]:
                            if key not in variables:
                                variables[key] = b
                        print(f"[Calculate] Auto-extracted balance {b} ETH from context_text (pattern: {pattern})")
                        break
                except (ValueError, TypeError):
                    pass

    return function_args
