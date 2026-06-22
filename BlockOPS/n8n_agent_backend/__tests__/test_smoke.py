"""
Smoke tests for the BlockOps MCP server (HTTP/SSE + stdio).

Boots the FastAPI app in a background thread via uvicorn, hits the
canonical endpoints, and asserts the surface stays stable:

  - GET  /health                       returns ok
  - GET  /                             reports 19 tools
  - GET  /mcp/tools                    full catalog matches tools/schema.json
  - POST /mcp/message tools/list       JSON-RPC returns 19 tools
  - POST /mcp/message tools/call calculate   local tool returns the right number
  - POST /mcp message register_agent   paid tool: 402 challenge OR backend_unreachable
  - POST /mcp message get_reputation   free tool: result OR graceful error
  - GET  /mcp/sse                      opens an event stream and emits "ready"
  - stdio mcp_server.py                JSON-RPC initialize + tools/list + tools/call

Run:
    cd n8n_agent_backend
    ./.venv/bin/python -m unittest __tests__.test_smoke -v
"""

from __future__ import annotations

import contextlib
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from typing import Optional

import httpx
import uvicorn


HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import dispatcher  # noqa: E402

EXPECTED_TOOL_COUNT = 19  # matches backend TOOL_PRICING (Phase 19 correction)


# ---------------------------------------------------------------------------
# Background-thread server fixture.
# ---------------------------------------------------------------------------
def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _ServerThread:
    """Run the FastAPI app on a free port inside a daemon thread.

    Mixing `uvicorn.Server.serve()` and the test's own asyncio loop in the
    same thread is fragile (httpx requests in the test loop can starve the
    server loop). A dedicated thread per server keeps things simple.
    """

    def __init__(self):
        self.port: Optional[int] = None
        self._thread: Optional[threading.Thread] = None
        self._server: Optional[uvicorn.Server] = None

    def start(self, timeout: float = 5.0) -> None:
        import mcp_server_sse  # lazy import keeps the import path inside
                               # the n8n_agent_backend package
        self.port = _free_port()
        config = uvicorn.Config(
            mcp_server_sse.app,
            host="127.0.0.1",
            port=self.port,
            log_level="warning",
            access_log=False,
        )
        self._server = uvicorn.Server(config)

        def _run():
            self._server.run()

        self._thread = threading.Thread(target=_run, name=f"mcp-srv-{self.port}",
                                        daemon=True)
        self._thread.start()
        # Poll until the server is accepting connections.
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.2):
                    return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError(f"MCP server did not start within {timeout}s on port {self.port}")

    def stop(self) -> None:
        if self._server:
            self._server.should_exit = True
        if self._thread:
            self._thread.join(timeout=3)

    def url(self, path: str = "") -> str:
        return f"http://127.0.0.1:{self.port}{path}"


# ---------------------------------------------------------------------------
# HTTP/SSE transport tests.
# ---------------------------------------------------------------------------
class HttpSseSmokeTests(unittest.TestCase):
    """End-to-end smoke against the FastAPI HTTP/SSE transport."""

    @classmethod
    def setUpClass(cls):
        cls._server = _ServerThread()
        cls._server.start()

    @classmethod
    def tearDownClass(cls):
        cls._server.stop()

    def _post(self, path: str, body: dict) -> httpx.Response:
        return httpx.post(self._server.url(path), json=body, timeout=10.0)

    def _get(self, path: str) -> httpx.Response:
        return httpx.get(self._server.url(path), timeout=10.0)

    # ----- discovery ----------------------------------------------------------
    def test_01_health(self):
        r = self._get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("status"), "ok")

    def test_02_root_reports_19_tools(self):
        r = self._get("/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["tool_count"], EXPECTED_TOOL_COUNT)
        self.assertEqual(len(body["tools"]), EXPECTED_TOOL_COUNT)

    def test_03_mcp_tools_matches_schema(self):
        r = self._get("/mcp/tools")
        self.assertEqual(r.status_code, 200)
        tools = r.json()["tools"]
        self.assertEqual(len(tools), EXPECTED_TOOL_COUNT)
        names = {t["name"] for t in tools}
        # Every pricing tier in chains.js is present
        self.assertIn("get_balance", names)
        self.assertIn("register_agent", names)
        self.assertIn("attest_agent", names)
        self.assertIn("get_reputation", names)
        # And every tool declares a tier.
        for t in tools:
            self.assertIn(t["tier"], ("free", "paid"))

    # ----- JSON-RPC over HTTP -------------------------------------------------
    def test_10_jsonrpc_tools_list(self):
        body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
        r = self._post("/mcp/message", body)
        self.assertEqual(r.status_code, 200)
        result = r.json().get("result") or {}
        self.assertEqual(len(result.get("tools", [])), EXPECTED_TOOL_COUNT)

    def test_11_jsonrpc_tools_call_calculate(self):
        body = {
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": "calculate", "arguments": {"expression": "7 * 6 + 1"}},
        }
        r = self._post("/mcp/message", body)
        self.assertEqual(r.status_code, 200)
        result = r.json()["result"]
        self.assertTrue(result["success"])
        self.assertEqual(result["kind"], "local")
        self.assertEqual(result["tier"], "free")
        # Dispatcher wraps the handler output. For calculate the handler
        # returns {success, tool, result: {result, ...}} so the numeric
        # answer is at result["result"]["result"]["result"].
        self.assertEqual(result["result"]["result"]["result"], 43)

    def test_12_jsonrpc_ping(self):
        r = self._post("/mcp/message", {"jsonrpc": "2.0", "id": 99, "method": "ping"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["result"]["pong"])

    def test_13_jsonrpc_unknown_method(self):
        r = self._post("/mcp/message",
                       {"jsonrpc": "2.0", "id": 1, "method": "not_a_real_method"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["error"]["code"], -32601)

    # ----- Paid tool: register_agent -----------------------------------------
    def test_20_paid_register_agent_proxy(self):
        """register_agent is a paid tool that proxies to the BlockOps backend.

        We don't require the backend to be running in CI; the dispatcher
        should respond with either:
          - success=True (real backend), OR
          - success=False, error="backend_unreachable: …"
        Both are acceptable evidence the proxy path is wired.
        """
        body = {
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "register_agent",
                       "arguments": {"agent_id": "smoke-test-agent",
                                     "metadata_uri": "ipfs://smoke"}},
        }
        r = self._post("/mcp/message", body)
        self.assertEqual(r.status_code, 200)
        result = r.json()["result"]
        # Tier metadata is set by the dispatcher.
        self.assertEqual(result.get("tier"), "paid")
        self.assertEqual(result.get("kind"), "proxy")
        self.assertGreater(result.get("price_motes", 0), 0)
        # Either success (real backend) or a clean backend_unreachable error.
        if not result.get("success"):
            self.assertIn("error", result)
            err = result["error"].lower()
            self.assertTrue(
                "backend_unreachable" in err
                or "connect_error" in err
                or "connection refused" in err
                or "status" in result,  # x402 challenge carries "status" field
                f"unexpected paid-tool error: {result.get('error')}",
            )

    # ----- Free tool: get_reputation -----------------------------------------
    def test_30_free_get_reputation_rpc(self):
        """get_reputation is a free tool that hits the Casper RPC directly.

        Without CASPER_REPUTATION_HASH set, the handler should return a
        clean error envelope (success=False, error describing the missing
        env var). With it set, we'd get the on-chain rating.
        """
        body = {
            "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": {"name": "get_reputation", "arguments": {"agent_id": "smoke-agent"}},
        }
        r = self._post("/mcp/message", body)
        self.assertEqual(r.status_code, 200)
        result = r.json()["result"]
        self.assertEqual(result.get("tier"), "free")
        self.assertEqual(result.get("kind"), "rpc")
        self.assertEqual(result.get("price_motes"), 0)
        if not result.get("success"):
            # Either the env var is missing OR we couldn't reach the RPC.
            self.assertIn("error", result)

    # ----- SSE stream ---------------------------------------------------------
    def test_40_sse_stream_emits_ready(self):
        with httpx.stream("GET", self._server.url("/mcp/sse"),
                          timeout=5.0) as r:
            self.assertEqual(r.status_code, 200)
            self.assertIn("text/event-stream", r.headers.get("content-type", ""))
            saw_ready = False
            for line in r.iter_lines():
                if line.startswith("event: ready"):
                    saw_ready = True
                    break
                if line.startswith("event: ping"):
                    continue
            self.assertTrue(saw_ready, "SSE stream did not emit a `ready` event")

    # ----- Legacy back-compat ------------------------------------------------
    def test_50_legacy_post_mcp(self):
        r = self._post("/mcp", {"tool": "calculate", "params": {"expression": "1+1"}})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("success"))


# ---------------------------------------------------------------------------
# Stdio transport tests.
# ---------------------------------------------------------------------------
class StdioSmokeTests(unittest.TestCase):
    """Spawn `mcp_server.py` as a subprocess and drive it via stdin/stdout."""

    PYTHON = HERE / ".venv" / "bin" / "python"
    SCRIPT = HERE / "mcp_server.py"

    def _spawn(self) -> subprocess.Popen:
        return subprocess.Popen(
            [str(self.PYTHON), str(self.SCRIPT), "--debug"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(HERE),
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )

    def _rpc(self, proc: subprocess.Popen, msg: dict) -> dict:
        line = (json.dumps(msg) + "\n").encode("utf-8")
        proc.stdin.write(line)
        proc.stdin.flush()
        # Read until we get a JSON object on a single line.
        out = b""
        while True:
            ch = proc.stdout.read(1)
            if not ch:
                break
            if ch == b"\n":
                break
            out += ch
        if not out:
            stderr = proc.stderr.read().decode("utf-8", errors="ignore")
            self.fail(f"no stdout, stderr={stderr!r}")
        return json.loads(out.decode("utf-8"))

    def test_stdio_initialize(self):
        proc = self._spawn()
        try:
            r = self._rpc(proc, {
                "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {},
            })
            self.assertEqual(r["id"], 1)
            self.assertEqual(r["result"]["serverInfo"]["tool_count"],
                             EXPECTED_TOOL_COUNT)
            self.assertEqual(r["result"]["serverInfo"]["transport"], "stdio")
        finally:
            proc.stdin.close()
            if proc.stdout:
                proc.stdout.close()
            if proc.stderr:
                proc.stderr.close()
            proc.terminate()
            proc.wait(timeout=3)

    def test_stdio_tools_list(self):
        proc = self._spawn()
        try:
            r = self._rpc(proc, {
                "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {},
            })
            self.assertEqual(r["id"], 2)
            self.assertEqual(len(r["result"]["tools"]), EXPECTED_TOOL_COUNT)
        finally:
            proc.stdin.close()
            if proc.stdout:
                proc.stdout.close()
            if proc.stderr:
                proc.stderr.close()
            proc.terminate()
            proc.wait(timeout=3)

    def test_stdio_tools_call_calculate(self):
        proc = self._spawn()
        try:
            r = self._rpc(proc, {
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": {"name": "calculate",
                           "arguments": {"expression": "10 / 2"}},
            })
            self.assertEqual(r["id"], 3)
            self.assertTrue(r["result"]["success"])
            # The dispatcher wraps the calculate handler's output; the
            # numeric answer lives at result["result"]["result"]["result"].
            self.assertEqual(r["result"]["result"]["result"]["result"], 5.0)
        finally:
            proc.stdin.close()
            if proc.stdout:
                proc.stdout.close()
            if proc.stderr:
                proc.stderr.close()
            proc.terminate()
            proc.wait(timeout=3)


# ---------------------------------------------------------------------------
# State + dispatcher unit tests (in-process, no network).
# ---------------------------------------------------------------------------
class StateTests(unittest.TestCase):
    def test_touch_session_increments_ttl(self):
        from state import get_state, SESSION_TTL_SECONDS
        s = get_state()
        if s._redis is None:
            self.skipTest("Redis not configured; skipping touch_session test")
        sid = f"smoke-{os.urandom(3).hex()}"
        s.touch_session(sid, agent_id="test-agent")
        meta = s.session_meta(sid)
        self.assertEqual(meta.get("agent_id"), "test-agent")
        # Redis reports seconds-remaining on TTL queries; we only assert the
        # ceiling (1h = 3600) is respected.
        ttl = s._redis.ttl(f"mcp:session:{sid}")
        self.assertGreater(ttl, 0)
        self.assertLessEqual(ttl, SESSION_TTL_SECONDS)

    def test_dispatcher_classify(self):
        self.assertEqual(dispatcher.classify("calculate"), "local")
        self.assertEqual(dispatcher.classify("get_balance"), "rpc")
        self.assertEqual(dispatcher.classify("register_agent"), "proxy")
        self.assertEqual(dispatcher.classify("transfer"), "proxy")

    def test_dispatcher_safe_calculate_known_results(self):
        r = dispatcher.safe_calculate({"expression": "2 + 3 * 4"})
        self.assertTrue(r["success"])
        self.assertEqual(r["result"]["result"], 14)

        r = dispatcher.safe_calculate({
            "expression": "cspr * 2",
            "variables": {"cspr": 25},
        })
        self.assertTrue(r["success"])
        self.assertEqual(r["result"]["result"], 50.0)

        r = dispatcher.safe_calculate({"expression": "2 +"})
        self.assertFalse(r["success"])
        self.assertIn("error", r)


if __name__ == "__main__":
    unittest.main(verbosity=2)
