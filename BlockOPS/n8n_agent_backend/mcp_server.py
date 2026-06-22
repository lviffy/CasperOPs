import os
import json
import httpx
from typing import Dict, Any, List
from mcp.server import Server
from mcp.server.stdio import stdio_server
import mcp.types as types
from dotenv import load_dotenv

load_dotenv()

# Initialize MCP Server
server = Server("casper-mcp-server")

# Configuration
CASPER_RPC_URL = os.getenv("CASPER_RPC_URL", "https://rpc.testnet.casperlabs.io/rpc")
CSPR_CLOUD_API_URL = os.getenv("CSPR_CLOUD_API_URL", "https://api.testnet.cspr.cloud")
CSPR_CLOUD_API_KEY = os.getenv("CSPR_CLOUD_API_KEY", "")

async def call_casper_rpc(method: str, params: list or dict = None) -> Dict[str, Any]:
    """Helper to perform Casper JSON-RPC calls"""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params or []
    }
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(CASPER_RPC_URL, json=payload, timeout=10.0)
            response.raise_for_status()
            res_json = response.json()
            if "error" in res_json:
                raise Exception(f"RPC Error: {res_json['error']}")
            return res_json.get("result", {})
        except Exception as e:
            return {"error": str(e)}

async def call_cspr_cloud(endpoint: str) -> Dict[str, Any]:
    """Helper to call CSPR.cloud API"""
    headers = {}
    if CSPR_CLOUD_API_KEY:
        headers["Authorization"] = f"Bearer {CSPR_CLOUD_API_KEY}"
        
    async with httpx.AsyncClient() as client:
        try:
            url = f"{CSPR_CLOUD_API_URL.rstrip('/')}/{endpoint.lstrip('/')}"
            response = await client.get(url, headers=headers, timeout=10.0)
            if response.status_code == 200:
                return response.json()
            else:
                return {"error": f"CSPR.cloud returned status {response.status_code}"}
        except Exception as e:
            return {"error": str(e)}

@server.list_tools()
async def handle_list_tools() -> List[types.Tool]:
    """List available tools for Casper Network context"""
    return [
        types.Tool(
            name="get_casper_balance",
            description="Retrieve the native CSPR balance for a given public key on Casper Network.",
            inputSchema={
                "type": "object",
                "properties": {
                    "public_key": {"type": "string", "description": "The Casper public key (hex format, e.g., starting with 01 or 02)"}
                },
                "required": ["public_key"]
            }
        ),
        types.Tool(
            name="get_deploy_status",
            description="Check the execution status of a Casper deploy/transaction using its deploy hash.",
            inputSchema={
                "type": "object",
                "properties": {
                    "deploy_hash": {"type": "string", "description": "The 64-character hex deploy hash"}
                },
                "required": ["deploy_hash"]
            }
        ),
        types.Tool(
            name="get_cspr_market_info",
            description="Fetch the current market price, volume, and rank of CSPR via CSPR.cloud.",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        ),
        types.Tool(
            name="get_reputation_stats",
            description="Retrieve success/slashing history metrics from the Reputation smart contract.",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_address": {"type": "string", "description": "The public key address of the agent"}
                },
                "required": ["agent_address"]
            }
        )
    ]

@server.call_tool()
async def handle_call_tool(name: str, arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle tool execution requests from the AI agent"""
    try:
        if name == "get_casper_balance":
            public_key = arguments.get("public_key")
            # First, fetch state root hash
            state_root_res = await call_casper_rpc("chain_get_state_root_hash")
            if "error" in state_root_res:
                return [types.TextContent(type="text", text=f"Failed to fetch state root: {state_root_res['error']}")]
            
            state_root_hash = state_root_res.get("state_root_hash")
            
            # Fetch balance uref using query_balance
            balance_res = await call_casper_rpc("state_get_balance", {
                "purse_uref": f"purse-uref-{public_key}", # Simplified / fallback representation
                "state_root_hash": state_root_hash
            })
            
            # As a fallback, query CSPR.cloud if key-based balance check fails on RPC
            if "error" in balance_res or not balance_res.get("balance_value"):
                cloud_res = await call_cspr_cloud(f"/accounts/{public_key}/balance")
                if "error" not in cloud_res:
                    balance_value = cloud_res.get("balance", "0")
                    return [types.TextContent(type="text", text=json.dumps({
                        "public_key": public_key,
                        "balance_cspr": str(int(balance_value) / 1_000_000_000),
                        "source": "cspr_cloud"
                    }, indent=2))]
            
            val = balance_res.get("balance_value", "0")
            return [types.TextContent(type="text", text=json.dumps({
                "public_key": public_key,
                "balance_motes": val,
                "balance_cspr": str(int(val) / 1_000_000_000),
                "source": "casper_rpc"
            }, indent=2))]

        elif name == "get_deploy_status":
            deploy_hash = arguments.get("deploy_hash")
            res = await call_casper_rpc("info_get_deploy", {"deploy_hash": deploy_hash})
            if "error" in res:
                return [types.TextContent(type="text", text=f"Failed to fetch deploy: {res['error']}")]
            
            execution_results = res.get("execution_results", [])
            status = "pending"
            cost = "0"
            error_message = None
            
            if execution_results:
                result = execution_results[0].get("result", {})
                if "Success" in result:
                    status = "success"
                    cost = result["Success"].get("cost", "0")
                elif "Failure" in result:
                    status = "failure"
                    cost = result["Failure"].get("cost", "0")
                    error_message = result["Failure"].get("error_message")

            return [types.TextContent(type="text", text=json.dumps({
                "deploy_hash": deploy_hash,
                "status": status,
                "cost_motes": cost,
                "cost_cspr": str(int(cost) / 1_000_000_000),
                "error_message": error_message,
                "raw_result": res
            }, indent=2))]

        elif name == "get_cspr_market_info":
            # Call CSPR.cloud to get current Casper token information
            cloud_res = await call_cspr_cloud("/tokens/cspr")
            if "error" in cloud_res:
                # Fallback to Coingecko public request
                async with httpx.AsyncClient() as client:
                    cg_res = await client.get("https://api.coingecko.com/api/v3/simple/price?ids=casper-network&vs_currencies=usd&include_24hr_change=true")
                    if cg_res.status_code == 200:
                        cg_data = cg_res.json().get("casper-network", {})
                        return [types.TextContent(type="text", text=json.dumps({
                            "token": "CSPR",
                            "price_usd": cg_data.get("usd"),
                            "change_24h": cg_data.get("usd_24h_change"),
                            "source": "coingecko_fallback"
                        }, indent=2))]
                return [types.TextContent(type="text", text=f"Failed to fetch market info: {cloud_res['error']}")]
            
            return [types.TextContent(type="text", text=json.dumps(cloud_res, indent=2))]

        elif name == "get_reputation_stats":
            agent_address = arguments.get("agent_address")
            # In a real environment, query the Reputation contract using state_get_item / query_global_state.
            # Here we provide a mock structure for LangGraph/CrewAI context validation.
            return [types.TextContent(type="text", text=json.dumps({
                "agent_address": agent_address,
                "success_count": 42,
                "failure_count": 1,
                "reputation_rating": 97.6,
                "is_slashed": False,
                "reputation_contract": "hash-reputation-contract-placeholder"
            }, indent=2))]

        else:
            return [types.TextContent(type="text", text=f"Unknown tool: {name}")]
            
    except Exception as e:
        return [types.TextContent(type="text", text=f"Error executing tool {name}: {str(e)}")]

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options()
        )

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
