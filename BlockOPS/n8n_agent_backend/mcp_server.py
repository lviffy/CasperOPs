"""
BlockOps MCP server (stdio transport).

Speaks JSON-RPC 2.0 over stdin/stdout so it can plug into n8n, the
`langgraph_agent.py` and `crewai_agent.py` examples, and any other agent
runtime that consumes a stdio MCP server.

Message protocol:
    request  → {"jsonrpc": "2.0", "id": <int|str>, "method": "...", "params": {...}}
    response ← {"jsonrpc": "2.0", "id": ..., "result": {...}} | {"error": {...}}

Supported methods:
    initialize          → handshake; returns server info + tool count
    tools/list          → returns the full tool catalog (from tools/schema.json)
    tools/call          → params: {name: <tool>, arguments: <dict>, _meta: {x402, agent_id, request_id}}
                          result: {success, tool, kind, tier, price_motes, result|error, duration_ms}
    ping                → liveness probe
    shutdown            → graceful shutdown

Tool dispatch goes through `dispatcher.dispatch` (shared with the HTTP/SSE
transport) so the catalog and behaviour stay in sync.

Run with:
    python mcp_server.py            # default (uses tools/schema.json)
    python mcp_server.py --debug    # verbose logging to stderr
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from typing import Any, Dict, Optional

from dotenv import load_dotenv

import dispatcher

load_dotenv()

log = logging.getLogger("blockops.mcp.stdio")

SERVER_INFO = {
    "name": "blockops-mcp-stdio",
    "version": "1.0.0",
    "transport": "stdio",
    "tool_count": len(dispatcher.list_tool_names()),
}


# ---------------------------------------------------------------------------
# JSON-RPC plumbing
# ---------------------------------------------------------------------------
def _make_response(req_id: Any, result: Any) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _make_error(req_id: Any, code: int, message: str, data: Any = None) -> Dict[str, Any]:
    err: Dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


async def _handle_request(msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Dispatch a single JSON-RPC message. Returns None for notifications."""
    req_id = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}

    if method is None:
        return _make_error(req_id, -32600, "missing method")

    if method == "initialize":
        return _make_response(req_id, {
            "serverInfo": SERVER_INFO,
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {"list": True, "call": True}},
        })

    if method == "ping":
        return _make_response(req_id, {"pong": True, "ts": __import__("time").time()})

    if method == "shutdown":
        return _make_response(req_id, {"ok": True})

    if method == "tools/list":
        return _make_response(req_id, dispatcher.list_tools_payload())

    if method == "tools/call":
        # Accept either Anthropic-style {name, arguments} or our internal
        # {tool, params} so older clients keep working.
        name = params.get("name") or params.get("tool")
        arguments = params.get("arguments")
        if arguments is None:
            arguments = params.get("params") or {}
        meta = params.get("_meta") or {}
        headers: Dict[str, str] = {}
        x402_hash = meta.get("x402_payment_deploy_hash") or params.get("x402_payment_deploy_hash")
        x402_payer = meta.get("x402_payment_payer_public_key") or params.get("x402_payment_payer_public_key")
        if x402_hash:
            headers["X-Casper-Payment-Deploy-Hash"] = x402_hash
        if x402_payer:
            headers["X-Casper-Payment-Payer-PublicKey"] = x402_payer

        request_id = meta.get("request_id")
        result = await dispatcher.dispatch(
            name, arguments, headers=headers, request_id=request_id,
        )
        return _make_response(req_id, result)

    return _make_error(req_id, -32601, f"method not found: {method}")


async def _read_messages(reader: asyncio.StreamReader):
    """Yield JSON-RPC messages from newline-delimited JSON on stdin."""
    while True:
        line = await reader.readline()
        if not line:
            return
        line = line.decode("utf-8", errors="ignore").strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError as e:
            log.warning("malformed JSON on stdin: %s", e)


async def _serve_stdio() -> None:
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin)

    writer_transport, writer_protocol = await asyncio.get_event_loop().connect_write_pipe(
        asyncio.streams.FlowControlMixin, sys.stdout,
    )
    writer = asyncio.StreamWriter(writer_transport, writer_protocol, reader, asyncio.get_event_loop())

    async for msg in _read_messages(reader):
        try:
            response = await _handle_request(msg)
        except Exception as e:  # pragma: no cover
            log.exception("handler threw")
            response = _make_error(msg.get("id"), -32603, f"internal error: {e!s}")
        if response is None:
            # notification: no reply
            continue
        writer.write((json.dumps(response) + "\n").encode("utf-8"))
        await writer.drain()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true", help="Verbose logging on stderr")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.WARNING,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )
    log.info("starting %s with %d tools", SERVER_INFO["name"], SERVER_INFO["tool_count"])

    try:
        asyncio.run(_serve_stdio())
    except KeyboardInterrupt:
        log.info("shutdown")


if __name__ == "__main__":
    main()
