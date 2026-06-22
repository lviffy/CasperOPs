"""
Sample LangGraph agent that registers an agent + attests it + reads the
reputation via the BlockOps MCP server.

Pipeline (deterministic — no LLM needed):
    register_agent → attest_agent → get_reputation

The graph uses `langgraph.graph.StateGraph` with `ToolNode` from
`langgraph.prebuilt`. Each BlockOps MCP tool is wrapped as a
`langchain_core.tools.StructuredTool` whose `coroutine` calls the MCP
HTTP/SSE transport via JSON-RPC.

Run with:
    # Make sure the MCP HTTP server is up first.
    uvicorn mcp_server_sse:app --host 0.0.0.0 --port 8080 &

    # Then in this directory:
    python examples/langgraph_agent.py --mcp-url http://localhost:8080/mcp

Environment:
    MCP_HTTP_URL    default http://localhost:8080/mcp
    BLOCKOPS_AGENT_ID  default demo-langgraph-agent
"""

from __future__ import annotations

import argparse
import asyncio
import functools
import json
import os
import sys
from typing import Annotated, Any, Dict, List, Optional, TypedDict

import httpx
from langchain_core.tools import StructuredTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

# Make sibling modules importable when run as a script from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import dispatcher  # noqa: E402


# ---------------------------------------------------------------------------
# MCP HTTP client (JSON-RPC over HTTP).
# ---------------------------------------------------------------------------
class McpHttpClient:
    """Tiny JSON-RPC client that talks to the BlockOps MCP HTTP/SSE server.

    It uses `/mcp/message` for synchronous request/reply so the example
    works without an open SSE stream. If the SSE stream is already open
    (X-MCP-Session-Id supplied) the server will additionally fan the
    response out over the stream — the HTTP reply is still authoritative.
    """

    def __init__(self, base_url: str, session_id: Optional[str] = None,
                 agent_id: Optional[str] = None) -> None:
        # Normalise: callers usually pass either `http://host:port` or
        # `http://host:port/mcp`. We strip any trailing /mcp so call()
        # can append /mcp/message without doubling up.
        url = base_url.rstrip("/")
        if url.endswith("/mcp"):
            url = url[: -len("/mcp")]
        self.base_url = url
        self.session_id = session_id or f"sess-langgraph-{os.urandom(4).hex()}"
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
        result = await self.call("tools/list", {})
        return result.get("tools", [])

    async def call_tool(self, name: str, arguments: Dict[str, Any],
                        request_id: Optional[str] = None) -> Dict[str, Any]:
        return await self.call("tools/call", {
            "name": name,
            "arguments": arguments,
            "_meta": {"request_id": request_id, "agent_id": self.agent_id},
        })


# ---------------------------------------------------------------------------
# Wrap a subset of the catalog as StructuredTools the LangGraph ToolNode
# can invoke directly. The schema comes from `tools/schema.json` so the
# tool surface stays in sync with the rest of the system.
# ---------------------------------------------------------------------------
def _json_schema_to_pydantic(name: str, schema: Dict[str, Any]):
    """Convert a JSON-Schema object property map into a minimal pydantic
    model the StructuredTool can use for input validation.

    We only need the simple cases used by the BlockOps tool catalog
    (string / integer / number / array-of-objects with required fields).
    Anything fancier is passed through as a dict and the MCP server
    validates it.
    """
    from pydantic import BaseModel, Field, create_model

    properties = schema.get("properties", {})
    required = set(schema.get("required", []) or [])

    fields: Dict[str, Any] = {}
    for prop_name, prop_schema in properties.items():
        py_type: Any = str  # default
        if prop_schema.get("type") == "integer":
            py_type = int
        elif prop_schema.get("type") == "number":
            py_type = float
        elif prop_schema.get("type") == "boolean":
            py_type = bool
        elif prop_schema.get("type") == "array":
            py_type = list

        description = prop_schema.get("description", "")
        if prop_name in required:
            fields[prop_name] = (py_type, Field(..., description=description))
        else:
            fields[prop_name] = (Optional[py_type], Field(default=None, description=description))

    return create_model(name, **fields)  # type: ignore[call-overload]


def build_langgraph_tools(client: McpHttpClient,
                          names: List[str]) -> List[StructuredTool]:
    tools: List[StructuredTool] = []
    for tool_meta in dispatcher.TOOLS.values():
        if tool_meta["name"] not in names:
            continue
        schema = tool_meta.get("input") or {"type": "object", "properties": {}}
        model = _json_schema_to_pydantic(tool_meta["name"].title().replace("_", ""), schema)

        async def _invoke(name: str = tool_meta["name"], **kwargs):
            # Drop kwargs that are None so the MCP server sees a clean dict.
            clean = {k: v for k, v in kwargs.items() if v is not None}
            return await client.call_tool(name, clean)

        tools.append(StructuredTool(
            name=tool_meta["name"],
            description=tool_meta.get("description", ""),
            args_schema=model,
            coroutine=_invoke,
        ))
    return tools


# ---------------------------------------------------------------------------
# Graph state + nodes.
# ---------------------------------------------------------------------------
class AgentState(TypedDict, total=False):
    agent_id: str
    metadata_uri: str
    score: int
    register: Dict[str, Any]
    attest: Dict[str, Any]
    reputation: Dict[str, Any]
    trace: Annotated[List[str], add_messages]


async def register_node(state: AgentState, *, client: McpHttpClient) -> Dict[str, Any]:
    print(f"[langgraph] register_agent({state['agent_id']})…")
    result = await client.call_tool("register_agent", {
        "agent_id": state["agent_id"],
        "metadata_uri": state.get("metadata_uri", "ipfs://demo-langgraph"),
    })
    print(f"[langgraph]   → {json.dumps(result, indent=2)[:240]}")
    return {
        "register": result,
        "trace": [f"register_agent → success={result.get('success')}"],
    }


async def attest_node(state: AgentState, *, client: McpHttpClient) -> Dict[str, Any]:
    print(f"[langgraph] attest_agent({state['agent_id']}, score={state.get('score', 90)})…")
    result = await client.call_tool("attest_agent", {
        "agent_id": state["agent_id"],
        "score": state.get("score", 90),
        "evidence_uri": "ipfs://demo-langgraph-attestation",
    })
    print(f"[langgraph]   → {json.dumps(result, indent=2)[:240]}")
    return {
        "attest": result,
        "trace": [f"attest_agent → success={result.get('success')}"],
    }


async def reputation_node(state: AgentState, *, client: McpHttpClient) -> Dict[str, Any]:
    print(f"[langgraph] get_reputation({state['agent_id']})…")
    result = await client.call_tool("get_reputation", {"agent_id": state["agent_id"]})
    print(f"[langgraph]   → {json.dumps(result, indent=2)[:240]}")
    return {
        "reputation": result,
        "trace": [f"get_reputation → success={result.get('success')}"],
    }


def build_graph(client: McpHttpClient, tools: List[StructuredTool]):
    """Build the deterministic pipeline graph.

    The graph is intentionally linear — there's no LLM in the loop. The
    ToolNode is still attached so the same graph can be extended to a
    ReAct-style agent by adding an `agent` node that decides which tool
    to call next.
    """
    g = StateGraph(AgentState)

    # LangGraph expects each node to be a coroutine (or async callable)
    # directly. We bind `client` via functools.partial so the lambda
    # doesn't return a coroutine that the graph then has to await.
    g.add_node("register", functools.partial(register_node, client=client))
    g.add_node("attest", functools.partial(attest_node, client=client))
    g.add_node("reputation", functools.partial(reputation_node, client=client))
    g.add_node("tools", ToolNode(tools))

    g.add_edge(START, "register")
    g.add_edge("register", "attest")
    g.add_edge("attest", "reputation")
    g.add_edge("reputation", END)
    return g.compile()


# ---------------------------------------------------------------------------
# Entrypoint.
# ---------------------------------------------------------------------------
async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mcp-url", default=os.getenv("MCP_HTTP_URL",
                                                     "http://localhost:8080/mcp"))
    parser.add_argument("--agent-id", default=os.getenv("BLOCKOPS_AGENT_ID",
                                                      "demo-langgraph-agent"))
    parser.add_argument("--metadata-uri", default="ipfs://demo-langgraph")
    parser.add_argument("--score", type=int, default=90)
    args = parser.parse_args()

    client = McpHttpClient(args.mcp_url, agent_id=args.agent_id)
    print(f"[langgraph] MCP server: {args.mcp_url}")
    print(f"[langgraph] agent_id:   {args.agent_id}")

    # Confirm the catalog is reachable (gives a clear error if the SSE
    # server isn't running).
    catalog = await client.list_tools()
    print(f"[langgraph] server reports {len(catalog)} tools")

    needed = {"register_agent", "attest_agent", "get_reputation"}
    available = {t["name"] for t in catalog}
    missing = needed - available
    if missing:
        print(f"[langgraph] ERROR: server is missing tools: {sorted(missing)}")
        return 2

    tools = build_langgraph_tools(client, sorted(needed))
    graph = build_graph(client, tools)

    final = await graph.ainvoke({
        "agent_id": args.agent_id,
        "metadata_uri": args.metadata_uri,
        "score": args.score,
    })

    print("\n[langgraph] final state:")
    for key in ("register", "attest", "reputation"):
        print(f"  {key}.success = {final.get(key, {}).get('success')}")

    success = all(final.get(k, {}).get("success") for k in ("register", "attest", "reputation"))
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
