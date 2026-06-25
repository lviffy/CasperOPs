"""
Sample CrewAI agent that registers an agent + attests it + reads the
reputation via the CasperOPs MCP server.

The flow is the same as `langgraph_agent.py` but expressed as a CrewAI
task. We create one agent with three MCP-backed tools (register_agent,
attest_agent, get_reputation) and let the agent's ReAct loop drive the
calls. No LLM is strictly required if the agent runtime supports a
"deterministic" mode, but the typical setup is:

    from langchain_openai import ChatOpenAI
    from crewai import Agent
    Agent(llm=ChatOpenAI(model="gpt-4o-mini"), ...)

Run with:
    # Make sure the MCP HTTP server is up.
    uvicorn mcp_server_sse:app --host 0.0.0.0 --port 8080 &

    # Then in this directory (with crewai installed):
    pip install crewai
    python examples/crewai_agent.py --mcp-url http://localhost:8080/mcp
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any, Dict, List, Optional

import httpx


# ---------------------------------------------------------------------------
# MCP HTTP client (JSON-RPC over HTTP)
# ---------------------------------------------------------------------------
class McpHttpClient:
    """Tiny JSON-RPC client that talks to the CasperOPs MCP HTTP/SSE server."""

    def __init__(self, base_url: str, session_id: Optional[str] = None,
                 agent_id: Optional[str] = None) -> None:
        url = base_url.rstrip("/")
        if url.endswith("/mcp"):
            url = url[: -len("/mcp")]
        self.base_url = url
        self.session_id = session_id or f"sess-crewai-{os.urandom(4).hex()}"
        self.agent_id = agent_id

    def _headers(self) -> Dict[str, str]:
        h = {"content-type": "application/json"}
        if self.session_id:
            h["X-MCP-Session-Id"] = self.session_id
        if self.agent_id:
            h["X-MCP-Agent-Id"] = self.agent_id
        return h

    async def call(self, method: str, params: Dict[str, Any],
                   req_id: int = 1) -> Dict[str, Any]:
        url = f"{self.base_url}/mcp/message"
        body = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
        async with httpx.AsyncClient() as client:
            r = await client.post(url, json=body, headers=self._headers(), timeout=30.0)
            r.raise_for_status()
            data = r.json()
        if "error" in data:
            err = data["error"]
            raise RuntimeError(f"mcp_rpc_error [{err.get('code')}]: {err.get('message')}")
        return data.get("result") or {}

    async def list_tools(self) -> List[Dict[str, Any]]:
        return (await self.call("tools/list", {})).get("tools", [])

    async def call_tool(self, name: str, arguments: Dict[str, Any],
                        request_id: Optional[str] = None) -> Dict[str, Any]:
        return await self.call("tools/call", {
            "name": name,
            "arguments": arguments,
            "_meta": {"request_id": request_id, "agent_id": self.agent_id},
        })


# ---------------------------------------------------------------------------
# Build crewai Tools around the MCP client. We use the `crewai.tools.tool`
# decorator so the agent can call the tool by name. The tool function is
# sync (CrewAI's expected interface); we drive the async MCP client via
# `asyncio.run`. For high-throughput agents a thread pool executor would
# be more appropriate, but the example below is intentionally simple.
# ---------------------------------------------------------------------------
def build_crewai_tools(client: McpHttpClient):
    # crewai is optional — we lazy-import so the file is still importable
    # in environments where crewai isn't installed (e.g. CI smoke tests).
    try:
        from crewai.tools import tool
    except ImportError as e:
        raise SystemExit(
            "crewai is not installed. Run `pip install crewai` to use this example."
        ) from e

    @tool("register_agent")
    def register_agent(agent_id: str, metadata_uri: str = "ipfs://demo-crewai") -> str:
        """Register an AI agent on the Casper AgentFactory contract.

        Args:
            agent_id: Unique agent identifier (e.g. 'crewai-agent-1').
            metadata_uri: Optional URI pointing to the agent's metadata (IPFS / HTTPS).
        """
        result = asyncio.run(client.call_tool("register_agent", {
            "agent_id": agent_id, "metadata_uri": metadata_uri,
        }))
        return json.dumps(result, indent=2)

    @tool("attest_agent")
    def attest_agent(agent_id: str, score: int = 90,
                     evidence_uri: str = "ipfs://demo-crewai-attestation") -> str:
        """Submit an attestation for an agent on the Casper Compliance contract.

        Args:
            agent_id: Agent identifier previously passed to register_agent.
            score: Reputation score 0-100.
            evidence_uri: URI for the evidence backing the attestation.
        """
        result = asyncio.run(client.call_tool("attest_agent", {
            "agent_id": agent_id, "score": int(score), "evidence_uri": evidence_uri,
        }))
        return json.dumps(result, indent=2)

    @tool("get_reputation")
    def get_reputation(agent_id: str) -> str:
        """Look up an agent's current on-chain reputation.

        Args:
            agent_id: Agent identifier to look up.
        """
        result = asyncio.run(client.call_tool("get_reputation", {"agent_id": agent_id}))
        return json.dumps(result, indent=2)

    return [register_agent, attest_agent, get_reputation]


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mcp-url", default=os.getenv("MCP_HTTP_URL",
                                                     "http://localhost:8080/mcp"))
    parser.add_argument("--agent-id", default=os.getenv("CASPEROPS_AGENT_ID",
                                                      "crewai-demo-agent"))
    parser.add_argument("--deterministic", action="store_true",
                        help="Skip CrewAI's LLM loop and call the three tools in order.")
    args = parser.parse_args()

    client = McpHttpClient(args.mcp_url, agent_id=args.agent_id)
    print(f"[crewai] MCP server: {args.mcp_url}")
    print(f"[crewai] agent_id:   {args.agent_id}")

    # Fail fast if the server isn't reachable.
    try:
        catalog = asyncio.run(client.list_tools())
    except Exception as e:
        print(f"[crewai] ERROR: cannot reach MCP server: {e}")
        return 2
    print(f"[crewai] server reports {len(catalog)} tools")

    needed = {"register_agent", "attest_agent", "get_reputation"}
    missing = needed - {t["name"] for t in catalog}
    if missing:
        print(f"[crewai] ERROR: server is missing tools: {sorted(missing)}")
        return 2

    if args.deterministic:
        # No-LLM path: drive the same tool calls the agent would.
        results: Dict[str, Any] = {}
        for step, fn in [
            ("register", lambda: asyncio.run(client.call_tool("register_agent", {
                "agent_id": args.agent_id, "metadata_uri": "ipfs://demo-crewai",
            }))),
            ("attest", lambda: asyncio.run(client.call_tool("attest_agent", {
                "agent_id": args.agent_id, "score": 95,
                "evidence_uri": "ipfs://demo-crewai-attestation",
            }))),
            ("reputation", lambda: asyncio.run(client.call_tool("get_reputation", {
                "agent_id": args.agent_id,
            }))),
        ]:
            results[step] = fn()
            ok = results[step].get("success")
            print(f"[crewai] {step}.success = {ok}")
            if not ok:
                print(f"[crewai]   error: {results[step].get('error')}")
        return 0 if all(r.get("success") for r in results.values()) else 1

    # Full CrewAI agent path.
    from crewai import Agent, Task, Crew
    from langchain_openai import ChatOpenAI

    tools = build_crewai_tools(client)

    agent = Agent(
        role="CasperOPs agent operator",
        goal=(
            f"Register an AI agent with id '{args.agent_id}' on the Casper testnet, "
            "submit a 90+ score attestation, then return the agent's reputation."
        ),
        backstory=(
            "You are a senior agent operator on the CasperOPs platform. You speak MCP "
            "and you always verify the final reputation after registering and attesting."
        ),
        tools=tools,
        llm=ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                       temperature=0),
        verbose=True,
    )

    task = Task(
        description=(
            f"1) Call register_agent with agent_id='{args.agent_id}'.\n"
            f"2) Call attest_agent for the same agent with score=95.\n"
            f"3) Call get_reputation for the same agent and return the JSON result."
        ),
        expected_output="A JSON object containing register_agent, attest_agent, and get_reputation responses.",
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task], verbose=True)
    result = crew.kickoff()
    print("[crewai] result:", result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
