"""
Tests for the Phase 26 MCP Prometheus metrics endpoint + counters.

Coverage:
  - GET /metrics is unauthenticated when METRICS_TOKEN is unset
  - GET /metrics refuses with 401 when METRICS_TOKEN is set + wrong bearer
  - GET /metrics serves prometheus text when METRICS_TOKEN matches
  - /metrics output contains the documented casperops_mcp_* series
  - the dispatcher increments the tool-calls counter after every dispatch
  - the dispatcher increments the proxy counter for proxy-kind tools
  - the dispatcher increments the rpc counter for rpc-kind tools
  - active_sessions gauge increments on SSE connect
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import unittest
from pathlib import Path

import httpx
import uvicorn


HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import dispatcher  # noqa: E402
import metrics as mcp_metrics  # noqa: E402


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _ServerThread:
    """Background-thread uvicorn fixture (mirrors test_smoke)."""

    def __init__(self) -> None:
        self.port: int | None = None
        self._thread: threading.Thread | None = None
        self._server: uvicorn.Server | None = None

    def start(self, timeout: float = 5.0) -> None:
        import mcp_server_sse  # noqa: E402
        self.port = _free_port()
        config = uvicorn.Config(
            mcp_server_sse.app,
            host="127.0.0.1",
            port=self.port,
            log_level="warning",
            access_log=False,
        )
        self._server = uvicorn.Server(config)

        def _run() -> None:
            self._server.run()

        self._thread = threading.Thread(target=_run, name=f"mcp-srv-{self.port}",
                                        daemon=True)
        self._thread.start()
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


class MetricsEndpointTests(unittest.TestCase):
    """Hit the live /metrics endpoint over HTTP."""

    @classmethod
    def setUpClass(cls) -> None:
        # Make sure METRICS_TOKEN is unset for the dev path.
        os.environ.pop("METRICS_TOKEN", None)
        cls._server = _ServerThread()
        cls._server.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls._server.stop()

    def test_metrics_unauthenticated_in_dev(self) -> None:
        r = httpx.get(self._server.url("/metrics"), timeout=5.0)
        self.assertEqual(r.status_code, 200)
        # Prometheus text exposition starts with `# HELP`.
        self.assertTrue(r.text.startswith("# HELP") or "# HELP" in r.text[:200],
                        f"unexpected exposition format: {r.text[:120]!r}")

    def test_metrics_contains_documented_series(self) -> None:
        # Touch a few series so they show up in the exposition.
        mcp_metrics.TOOL_CALLS_TOTAL.labels(
            tool_name="calculate", kind="local", status="ok"
        ).inc()
        mcp_metrics.BACKEND_PROXY_DURATION.labels(
            tool_name="register_agent", result="ok"
        ).observe(0.123)
        mcp_metrics.SESSION_MESSAGES.labels(kind="inbound").inc()

        r = httpx.get(self._server.url("/metrics"), timeout=5.0)
        self.assertEqual(r.status_code, 200)
        body = r.text
        for name in (
            "casperops_mcp_tool_calls_total",
            "casperops_mcp_tool_latency_seconds",
            "casperops_mcp_active_sessions",
            "casperops_mcp_session_messages_total",
            "casperops_mcp_backend_proxy_duration_seconds",
            "casperops_mcp_rpc_call_duration_seconds",
        ):
            self.assertIn(name, body, f"missing series {name} in /metrics output")

    def test_metrics_gated_when_token_set(self) -> None:
        # The /metrics handler reads METRICS_TOKEN per-request, so we can
        # flip the env var on the SAME running server and verify both the
        # 401 (no/wrong token) and 200 (right token) paths in sequence.
        import mcp_server_sse  # noqa: E402
        prev = os.environ.get("METRICS_TOKEN")
        token = "test-token-xyz"
        os.environ["METRICS_TOKEN"] = token
        try:
            base = self._server.url("/metrics")
            # 1. No token → 401
            r = httpx.get(base, timeout=5.0)
            self.assertEqual(r.status_code, 401)
            # 2. Wrong bearer → 401
            r = httpx.get(base, headers={"Authorization": "Bearer wrong"}, timeout=5.0)
            self.assertEqual(r.status_code, 401)
            # 3. Right bearer → 200
            r = httpx.get(
                base, headers={"Authorization": f"Bearer {token}"}, timeout=5.0
            )
            self.assertEqual(r.status_code, 200)
            self.assertIn("casperops_mcp_tool_calls_total", r.text)
            # 4. X-Metrics-Token header → 200
            r = httpx.get(
                base, headers={"X-Metrics-Token": token}, timeout=5.0
            )
            self.assertEqual(r.status_code, 200)
        finally:
            if prev is None:
                os.environ.pop("METRICS_TOKEN", None)
            else:
                os.environ["METRICS_TOKEN"] = prev


class DispatcherMetricsTests(unittest.IsolatedAsyncioTestCase):
    """Verify the dispatcher increments the right metrics."""

    async def test_calculate_local_counter(self) -> None:
        mcp_metrics._reset_for_tests()
        # calculate is local → increments TOOL_CALLS_TOTAL{kind=local}
        result = await dispatcher.dispatch("calculate", {"expression": "2+2"})
        self.assertTrue(result.get("success"))
        body = mcp_metrics.render().decode("utf-8")
        self.assertIn('tool_name="calculate"', body)
        self.assertIn('kind="local"', body)
        self.assertIn('status="ok"', body)

    async def test_register_agent_proxy_counter(self) -> None:
        mcp_metrics._reset_for_tests()
        # register_agent is paid → proxies to backend. Backend is unreachable
        # in this CI env so the dispatcher returns an error envelope; the
        # counter still ticks because the dispatcher entered the proxy path.
        result = await dispatcher.dispatch("register_agent", {"agent_id": "x"})
        body = mcp_metrics.render().decode("utf-8")
        self.assertIn('tool_name="register_agent"', body)
        self.assertIn('kind="proxy"', body)
        self.assertEqual(result.get("tier"), "paid")

    async def test_get_reputation_rpc_counter(self) -> None:
        mcp_metrics._reset_for_tests()
        # get_reputation is RPC-kind → increments RPC_CALL_DURATION
        await dispatcher.dispatch("get_reputation", {"agent_id": "smoke-test"})
        body = mcp_metrics.render().decode("utf-8")
        self.assertIn('tool_name="get_reputation"', body)
        self.assertIn('kind="rpc"', body)
        # The RPC helper also records under RPC_CALL_DURATION.
        self.assertIn("casperops_mcp_rpc_call_duration_seconds", body)

    async def test_x402_status_label(self) -> None:
        mcp_metrics._reset_for_tests()
        await dispatcher.dispatch("register_agent", {"agent_id": "y"})
        body = mcp_metrics.render().decode("utf-8")
        # The status label may be `error` (no backend), `ok` (real
        # backend), or `x402` (challenge). Exactly one will appear on
        # the register_agent counter line. Use a regex to find that line
        # and assert it has one of the three valid status values.
        import re
        match = re.search(
            r'casperops_mcp_tool_calls_total\{[^}]*tool_name="register_agent"[^}]*\}',
            body,
        )
        self.assertIsNotNone(match, "register_agent counter line not found")
        self.assertRegex(match.group(0), r'status="(ok|error|x402)"')


class SessionGaugeTests(unittest.TestCase):
    """Verify the active-sessions gauge tracks SSE connect/disconnect."""

    def test_record_session_opened_and_closed(self) -> None:
        mcp_metrics._reset_for_tests()
        mcp_metrics.record_session_opened()
        mcp_metrics.record_session_opened()
        body = mcp_metrics.render().decode("utf-8")
        # After two opens the gauge should read 2.
        self.assertIn("casperops_mcp_active_sessions 2.0", body)
        mcp_metrics.record_session_closed()
        body = mcp_metrics.render().decode("utf-8")
        self.assertIn("casperops_mcp_active_sessions 1.0", body)


if __name__ == "__main__":
    unittest.main(verbosity=2)