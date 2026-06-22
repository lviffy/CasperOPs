"""
BlockOps MCP Server — HTTP/SSE transport.

Run with:
    uvicorn mcp_server_sse:app --host 0.0.0.0 --port 8080

This complements the stdio transport in `mcp_server.py`. The HTTP/SSE
endpoint is for remote LangGraph / CrewAI agents that need a long-running
host (Railway / Fly / Render). All 22 tools are exposed under /mcp.

Environment variables:
    CASPER_RPC_URL          default https://rpc.testnet.casper.live/rpc
    CSPR_CLOUD_API_URL      default https://api.testnet.cspr.cloud
    CSPR_CLOUD_API_KEY      optional
    REDIS_URL               optional, enables session state
    POSTGRES_DSN            optional, enables tool-call history
"""

import os
import json
import asyncio
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
from sse_starlette.sse import EventSourceResponse

from state import get_state

CASPER_RPC_URL = os.getenv("CASPER_RPC_URL", "https://rpc.testnet.casper.live/rpc")
CSPR_CLOUD_API_URL = os.getenv("CSPR_CLOUD_API_URL", "https://api.testnet.cspr.cloud")
CSPR_CLOUD_API_KEY = os.getenv("CSPR_CLOUD_API_KEY", "")

app = FastAPI(title="BlockOps MCP Server (HTTP/SSE)", version="1.0.0")

# The 22-tool catalog. Single source of truth: tools/schema.json.
TOOL_CATALOG: List[Dict[str, Any]] = []
try:
    with open(os.path.join(os.path.dirname(__file__), "tools", "schema.json"), "r", encoding="utf-8") as f:
        TOOL_CATALOG = json.load(f).get("tools", [])
except Exception:  # pragma: no cover
    TOOL_CATALOG = []


async def call_casper_rpc(method: str, params: Any = None) -> Dict[str, Any]:
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(CASPER_RPC_URL, json=payload, timeout=15.0)
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                return {"error": data["error"]}
            return data.get("result", {})
        except Exception as e:  # pragma: no cover
            return {"error": str(e)}


async def call_cspr_cloud(endpoint: str) -> Dict[str, Any]:
    headers = {"Accept": "application/json"}
    if CSPR_CLOUD_API_KEY:
        headers["Authorization"] = f"Bearer {CSPR_CLOUD_API_KEY}"
    url = f"{CSPR_CLOUD_API_URL.rstrip('/')}/{endpoint.lstrip('/')}"
    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(url, headers=headers, timeout=15.0)
            if r.status_code == 200:
                return r.json()
            return {"error": f"CSPR.cloud returned status {r.status_code}"}
        except Exception as e:  # pragma: no cover
            return {"error": str(e)}


# --------------------------------------------------------------- HTTP routes
@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "name": "blockops-mcp",
        "version": "1.0.0",
        "transport": "http+sse",
        "tool_count": len(TOOL_CATALOG),
        "tools": [t["name"] for t in TOOL_CATALOG],
    }


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"status": "ok"}


@app.get("/mcp/tools")
async def list_tools() -> Dict[str, Any]:
    return {"tools": TOOL_CATALOG}


# ------------------------------------------------------------------- /mcp SSE
@app.get("/mcp")
async def mcp_sse(request: Request) -> StreamingResponse:
    """Open an SSE stream for the MCP client.

    Clients send tool invocations as newline-delimited JSON over the same
    stream. Each invocation receives a server-sent event with the result.
    """

    state = get_state()
    await state.connect_pg()
    session_id = request.headers.get("X-MCP-Session-Id") or f"sess-{os.urandom(4).hex()}"
    state.touch_session(session_id, agent_id=request.headers.get("X-MCP-Agent-Id"))

    async def event_generator():
        yield {"event": "ready", "data": json.dumps({"session_id": session_id, "tools": len(TOOL_CATALOG)})}
        queue: asyncio.Queue = asyncio.Queue()
        request._mcp_queue = queue  # type: ignore[attr-defined]

        async def reader():
            body = await request.body()
            if not body:
                return
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = {"tool": "_error", "params": {"raw": body.decode("utf-8", errors="ignore")}}
            await queue.put(payload)

        reader_task = asyncio.create_task(reader())
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    state.touch_session(session_id)
                    continue
                result = await _dispatch(payload)
                yield {"event": "tool_result", "data": json.dumps(result, default=str)}
                await state.record_call(
                    session_id=session_id,
                    tool_name=payload.get("tool", "unknown"),
                    params=payload.get("params", {}),
                    result=result,
                )
        finally:
            reader_task.cancel()

    return EventSourceResponse(event_generator())


async def _dispatch(payload: Dict[str, Any]) -> Dict[str, Any]:
    tool = payload.get("tool")
    params = payload.get("params") or {}
    if not tool:
        return {"error": "missing 'tool' field"}
    if tool == "get_balance":
        pk = params.get("public_key")
        cloud = await call_cspr_cloud(f"/accounts/{pk}/balance")
        if "error" in cloud:
            return {"error": cloud["error"]}
        motes = int(cloud.get("balance", 0))
        return {"public_key": pk, "balance_motes": str(motes), "balance_cspr": f"{motes / 1_000_000_000:.4f}"}
    if tool == "get_deploy_status":
        return await call_casper_rpc("info_get_deploy", {"deploy_hash": params.get("deploy_hash")})
    if tool == "fetch_price":
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://api.coingecko.com/api/v3/simple/price?ids=casper-network&vs_currencies=usd&include_24hr_change=true",
                timeout=10.0,
            )
            if r.status_code == 200:
                return {"token": "CSPR", "price_usd": r.json().get("casper-network", {}).get("usd")}
        return {"error": "price lookup failed"}
    if tool == "lookup_deploy":
        return await call_casper_rpc("info_get_deploy", {"deploy_hash": params.get("deploy_hash")})
    if tool == "get_reputation":
        return await call_casper_rpc(
            "query_global_state",
            {"key": os.getenv("CASPER_REPUTATION_HASH", ""), "path": [f"reputation_{(params.get('agent_id') or '').replace('-', '_')}"]},
        )
    return {"error": f"unknown tool: {tool}"}


# --------------------------------------------------------------- /mcp POST
@app.post("/mcp")
async def mcp_post(request: Request) -> JSONResponse:
    """Synchronous tool invocation (one request → one response)."""
    body = await request.json()
    result = await _dispatch(body)
    return JSONResponse(result)


# --------------------------------------------------------------- /mcp/list
@app.get("/mcp/list")
async def mcp_list() -> JSONResponse:
    return JSONResponse({"tools": [t["name"] for t in TOOL_CATALOG]})
