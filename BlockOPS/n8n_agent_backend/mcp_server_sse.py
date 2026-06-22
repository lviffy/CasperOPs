"""
BlockOps MCP server — HTTP / Server-Sent Events transport.

Run with:
    uvicorn mcp_server_sse:app --host 0.0.0.0 --port 8080

This complements the stdio transport in `mcp_server.py`. The HTTP/SSE
endpoint is for remote LangGraph / CrewAI agents that need a long-running
host (Railway / Fly / Render / Docker). All 19 tools are exposed under /mcp.

Endpoints (canonical):
    GET  /health             liveness probe
    GET  /                   server info + tool summary
    GET  /mcp/tools          full tool catalog (tools/schema.json)
    GET  /mcp/sse            open SSE stream — client pushes JSON-RPC messages
    POST /mcp/message        synchronous JSON-RPC dispatch (one message → one reply)
    POST /mcp                alias for /mcp/message (back-compat with Phase 19)
    GET  /mcp/list           flat list of tool names (back-compat)
    POST /mcp/tools/{name}   single-shot tool invocation (back-compat)

Environment variables:
    CASPER_RPC_URL          default https://rpc.testnet.casper.live/rpc
    CSPR_CLOUD_API_URL      default https://api.testnet.cspr.cloud
    CSPR_CLOUD_API_KEY      optional
    BLOCKOPS_BACKEND_URL    default http://localhost:3000
                            where /v1/tools/:toolId lives
    REDIS_URL               optional, enables session state
    POSTGRES_DSN            optional, enables tool-call history
    CASPER_REPUTATION_HASH  required for get_reputation
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

import dispatcher
from state import get_state


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Eagerly attempt Postgres so the first /mcp/sse call is fast. Failures
    # are non-fatal (the server runs without Postgres and just skips
    # history recording).
    state = get_state()
    try:
        await state.connect_pg()
    except Exception as e:  # pragma: no cover
        print(f"[mcp-sse] lifespan: postgres disabled: {e}")
    yield


app = FastAPI(title="BlockOps MCP Server (HTTP/SSE)", version="1.0.0",
              lifespan=_lifespan)


# ---------------------------------------------------------------------------
# JSON-RPC plumbing (shared with stdio server in spirit, kept inline so
# transports can diverge as needed without sharing state)
# ---------------------------------------------------------------------------
def _make_response(req_id: Any, result: Any) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _make_error(req_id: Any, code: int, message: str, data: Any = None) -> Dict[str, Any]:
    err: Dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


async def _handle_rpc(msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    req_id = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}
    if method is None:
        return _make_error(req_id, -32600, "missing method")

    if method == "initialize":
        return _make_response(req_id, {
            "serverInfo": {
                "name": "blockops-mcp-http",
                "version": "1.0.0",
                "transport": "http+sse",
                "tool_count": len(dispatcher.list_tool_names()),
            },
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {"list": True, "call": True}},
        })
    if method == "ping":
        return _make_response(req_id, {"pong": True, "ts": time.time()})
    if method == "tools/list":
        return _make_response(req_id, dispatcher.list_tools_payload())
    if method == "tools/call":
        name = params.get("name") or params.get("tool")
        arguments = params.get("arguments")
        if arguments is None:
            arguments = params.get("params") or {}
        meta = params.get("_meta") or {}
        request_id = meta.get("request_id")
        result = await dispatcher.dispatch(name, arguments, request_id=request_id)
        return _make_response(req_id, result)

    return _make_error(req_id, -32601, f"method not found: {method}")


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------
@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"status": "ok", "ts": time.time()}


@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "name": "blockops-mcp",
        "version": "1.0.0",
        "transport": "http+sse",
        "tool_count": len(dispatcher.list_tool_names()),
        "tools": dispatcher.list_tool_names(),
        "endpoints": ["/health", "/mcp/tools", "/mcp/sse", "/mcp/message"],
    }


@app.get("/mcp/tools")
async def list_tools() -> Dict[str, Any]:
    return dispatcher.list_tools_payload()


@app.get("/mcp/list")
async def list_tool_names() -> JSONResponse:
    return JSONResponse({"tools": dispatcher.list_tool_names()})


# ---------------------------------------------------------------------------
# /mcp/sse — server-sent events stream. Client opens the stream and pushes
# JSON-RPC messages via POST /mcp/message.
# ---------------------------------------------------------------------------
@app.get("/mcp/sse")
async def mcp_sse(request: Request) -> StreamingResponse:
    """Open an SSE stream. The client receives:
        - an initial `ready` event with the assigned session id
        - `tool_result` events for each message it pushes via /mcp/message
        - `ping` events every 15s when idle (so the client knows we're alive)

    The session id is echoed in `X-MCP-Session-Id` so the client can send it
    back when posting messages. The same id is required when the client wants
    to receive its results on this stream (otherwise results are returned in
    the POST response directly).
    """
    state = get_state()
    session_id = request.headers.get("X-MCP-Session-Id") or f"sess-{os.urandom(6).hex()}"
    agent_id = request.headers.get("X-MCP-Agent-Id") or None
    state.touch_session(session_id, agent_id=agent_id)

    # Each session gets its own asyncio queue of pending results so the SSE
    # consumer can read them in order.
    queue: asyncio.Queue = asyncio.Queue()
    await state.set_sse_queue(session_id, queue)

    async def event_generator() -> AsyncGenerator[Dict[str, Any], None]:
        try:
            yield {
                "event": "ready",
                "data": json.dumps({
                    "session_id": session_id,
                    "tool_count": len(dispatcher.list_tool_names()),
                    "tools": dispatcher.list_tool_names(),
                }),
            }
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": json.dumps({"ts": time.time()})}
                    state.touch_session(session_id)
                    continue
                yield {"event": "tool_result", "data": json.dumps(payload, default=str)}
        finally:
            await state.clear_sse_queue(session_id)

    headers = {"X-MCP-Session-Id": session_id}
    return StreamingResponse(
        _format_sse(event_generator()),
        media_type="text/event-stream",
        headers=headers,
    )


async def _format_sse(gen):
    async for event in gen:
        yield f"event: {event['event']}\ndata: {event['data']}\n\n"


# ---------------------------------------------------------------------------
# /mcp/message — single message → single reply (JSON-RPC).
# When the client supplies X-MCP-Session-Id matching an open SSE stream,
# the result is ALSO enqueued onto that stream so subscribers see it.
# ---------------------------------------------------------------------------
@app.post("/mcp/message")
async def mcp_message(request: Request) -> JSONResponse:
    body = await request.json()
    response = await _handle_rpc(body)

    if response is not None:
        session_id = request.headers.get("X-MCP-Session-Id")
        if session_id:
            state = get_state()
            # record_call needs the inner result; for tools/call it lives in `result`.
            method = body.get("method")
            if method == "tools/call":
                params = body.get("params") or {}
                name = params.get("name") or params.get("tool") or "unknown"
                inner = response.get("result") or {}
                status = "error" if inner.get("success") is False else "success"
                await state.record_call(
                    session_id=session_id,
                    tool_name=name,
                    params=params.get("arguments") or params.get("params") or {},
                    result=inner,
                    status=status,
                    x402_hash=(
                        (params.get("_meta") or {}).get("x402_payment_deploy_hash")
                        or params.get("x402_payment_deploy_hash")
                    ),
                )
                # Mirror to the SSE stream so long-lived subscribers see it.
                state.push_sse(session_id, inner)

    return JSONResponse(response if response is not None else {})


# ---------------------------------------------------------------------------
# Back-compat routes (Phase 19 surface)
# ---------------------------------------------------------------------------
@app.post("/mcp")
async def mcp_legacy(request: Request) -> JSONResponse:
    """Single-shot POST that forwards to the dispatcher directly.

    Accepts both shapes:
        {"tool": "<name>", "params": {...}}                    legacy
        {"jsonrpc": "2.0", "method": "tools/call", "params": {...}}  JSON-RPC
    """
    body = await request.json()
    if "method" in body:
        # JSON-RPC path
        return await mcp_message(request)

    # Legacy single-shot path
    tool = body.get("tool")
    params = body.get("params") or {}
    state = get_state()
    session_id = request.headers.get("X-MCP-Session-Id")
    if session_id:
        state.touch_session(session_id)

    result = await dispatcher.dispatch(tool, params)
    if session_id:
        status = "error" if result.get("success") is False else "success"
        await state.record_call(
            session_id=session_id,
            tool_name=tool or "unknown",
            params=params,
            result=result,
            status=status,
        )
    return JSONResponse(result)


@app.post("/mcp/tools/{tool}")
async def mcp_tool_shortcut(tool: str, request: Request) -> JSONResponse:
    """Single-shot tool invocation: POST /mcp/tools/{name} with the params as JSON body."""
    params = await request.json() if (await request.body()) else {}
    result = await dispatcher.dispatch(tool, params)
    return JSONResponse(result)


@app.get("/mcp/recent/{session_id}")
async def mcp_recent(session_id: str, limit: int = 25) -> JSONResponse:
    """Return the recent tool-call history for a session."""
    state = get_state()
    calls = await state.recent_calls(session_id, limit=limit)
    return JSONResponse({"session_id": session_id, "calls": calls})
