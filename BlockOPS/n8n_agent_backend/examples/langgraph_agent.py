"""
Sample LangGraph agent that registers an agent + attests it on the Casper
AgentFactory + Reputation contracts via the BlockOps MCP server.

Run with:
    python examples/langgraph_agent.py --mcp-url http://localhost:8080/mcp
"""

import argparse
import asyncio
import json

import httpx
from langgraph.graph import StateGraph
from langgraph.prebuilt import ToolNode
from langchain_core.messages import HumanMessage

from mcp_server_sse import call_cspr_cloud  # type: ignore  # not used; placeholder


async def call_mcp(url: str, tool: str, params: dict) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(url, json={"tool": tool, "params": params}, timeout=20.0)
        r.raise_for_status()
        return r.json()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mcp-url", default="http://localhost:8080/mcp")
    parser.add_argument("--agent-id", default="demo-agent-1")
    args = parser.parse_args()

    # 1. Wallet readiness
    print("[1/4] wallet_readiness…")
    readiness = await call_mcp(args.mcp_url, "get_balance", {"public_key": "01" + "a" * 64})
    print(json.dumps(readiness, indent=2))

    # 2. Register agent (would normally be paid via x402)
    print("[2/4] register_agent…")
    reg = await call_mcp(args.mcp_url, "register_agent", {"agent_id": args.agent_id, "metadata_uri": "ipfs://demo"})
    print(json.dumps(reg, indent=2))

    # 3. Attest
    print("[3/4] attest_agent…")
    att = await call_mcp(args.mcp_url, "attest_agent", {"agent_id": args.agent_id, "score": 90})
    print(json.dumps(att, indent=2))

    # 4. Look up reputation
    print("[4/4] get_reputation…")
    rep = await call_mcp(args.mcp_url, "get_reputation", {"agent_id": args.agent_id})
    print(json.dumps(rep, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
