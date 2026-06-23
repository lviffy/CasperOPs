"""
BlockOps MCP Prometheus metrics registry.

Mirrors `backend/utils/metrics.js` on the Python side so a single
Grafana dashboard can chart the whole stack. Exposes:

    blockops_mcp_tool_calls_total{tool_name,kind,status}
        Counter — incremented in `dispatcher.dispatch` after every tool
        invocation. `kind` ∈ {local, proxy, rpc}, `status` ∈
        {ok, error, x402}.

    blockops_mcp_tool_latency_seconds{tool_name,kind}
        Histogram — wall-clock dispatch latency.

    blockops_mcp_active_sessions
        Gauge — number of SSE sessions currently attached. Updated
        whenever a session opens / closes its `/mcp/sse` stream.

    blockops_mcp_session_messages_total{kind}
        Counter — `kind` ∈ {inbound, outbound}. Tracks JSON-RPC traffic.

    blockops_mcp_backend_proxy_duration_seconds{tool_name,result}
        Histogram — backend proxy round-trip latency (`result` ∈
        {ok, error, unreachable}). Helps spot drift between the MCP
        server and the BlockOps backend.

    blockops_mcp_rpc_call_duration_seconds{method,result}
        Histogram — direct Casper RPC + CSPR.cloud calls made by the
        RPC-class tools (get_balance, lookup_deploy, etc.).

The registry is the prometheus_client default registry, so process /
GC / platform metrics are picked up automatically. `render()` returns
the text exposition payload — Prometheus scrapes it from `/metrics`.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Iterator

from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    CONTENT_TYPE_LATEST,
    process_collector,
    platform_collector,
)


# Dedicated registry so we don't collide with the global default. The
# BlockOps backend uses its own registry; the MCP server uses this one.
REGISTRY = CollectorRegistry()

# Process + platform collectors so a fresh /metrics scrape gives the
# operator everything needed without an exporter sidecar.
try:
    process_collector.ProcessCollector(registry=REGISTRY)
    platform_collector.PlatformCollector(registry=REGISTRY)
except Exception:  # pragma: no cover - collector init can fail on exotic platforms
    pass


# ── Series ──────────────────────────────────────────────────────────────
TOOL_CALLS_TOTAL = Counter(
    "blockops_mcp_tool_calls_total",
    "Tool invocations through the MCP server.",
    ["tool_name", "kind", "status"],
    registry=REGISTRY,
)

TOOL_LATENCY = Histogram(
    "blockops_mcp_tool_latency_seconds",
    "Wall-clock latency of MCP tool dispatches.",
    ["tool_name", "kind"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
    registry=REGISTRY,
)

ACTIVE_SESSIONS = Gauge(
    "blockops_mcp_active_sessions",
    "MCP SSE sessions currently connected.",
    registry=REGISTRY,
)

SESSION_MESSAGES = Counter(
    "blockops_mcp_session_messages_total",
    "JSON-RPC messages exchanged by the MCP server.",
    ["kind"],  # inbound | outbound
    registry=REGISTRY,
)

BACKEND_PROXY_DURATION = Histogram(
    "blockops_mcp_backend_proxy_duration_seconds",
    "Round-trip latency for proxied calls to the BlockOps backend.",
    ["tool_name", "result"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
    registry=REGISTRY,
)

RPC_CALL_DURATION = Histogram(
    "blockops_mcp_rpc_call_duration_seconds",
    "Direct Casper RPC + CSPR.cloud call latency from RPC-class tools.",
    ["method", "result"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
    registry=REGISTRY,
)


# ── Helpers ─────────────────────────────────────────────────────────────

@contextmanager
def time_tool_call(tool_name: str, kind: str) -> Iterator[dict]:
    """Context manager that records wall-clock latency for a tool call.

    Usage:
        with time_tool_call("get_balance", "rpc") as ctx:
            result = await handler(params)
            ctx["status"] = "ok" if result.get("success") else "error"
    """
    ctx: dict = {"status": "ok"}
    started = time.perf_counter()
    try:
        yield ctx
    finally:
        try:
            TOOL_LATENCY.labels(tool_name=tool_name, kind=kind).observe(
                time.perf_counter() - started
            )
            TOOL_CALLS_TOTAL.labels(
                tool_name=tool_name, kind=kind, status=ctx.get("status", "ok")
            ).inc()
        except Exception:  # pragma: no cover - never let metrics errors break a tool call
            pass


def record_proxy_call(tool_name: str, status_code: int, duration_s: float) -> None:
    """Record a backend proxy round-trip. status_code is the HTTP code
    from the BlockOps backend; we bucket it into ok / error /
    unreachable for cardinality control."""
    if status_code == 0:
        result = "unreachable"
    elif status_code < 500:
        result = "ok"
    else:
        result = "error"
    try:
        BACKEND_PROXY_DURATION.labels(tool_name=tool_name, result=result).observe(duration_s)
    except Exception:  # pragma: no cover
        pass


def record_rpc_call(method: str, ok: bool, duration_s: float) -> None:
    try:
        RPC_CALL_DURATION.labels(
            method=method, result="ok" if ok else "error"
        ).observe(duration_s)
    except Exception:  # pragma: no cover
        pass


def record_session_opened() -> None:
    try:
        ACTIVE_SESSIONS.inc()
    except Exception:  # pragma: no cover
        pass


def record_session_closed() -> None:
    try:
        ACTIVE_SESSIONS.dec()
    except Exception:  # pragma: no cover
        pass


def record_message(direction: str) -> None:
    try:
        SESSION_MESSAGES.labels(kind=direction).inc()
    except Exception:  # pragma: no cover
        pass


def render() -> bytes:
    """Return the Prometheus text exposition payload."""
    return generate_latest(REGISTRY)


def content_type() -> str:
    return CONTENT_TYPE_LATEST


# Test-only helper: drop in-process counters/gauges between cases so the
# snapshot is deterministic. We deliberately do NOT clear the histogram
# buckets (their observation_count can be asserted directly).
def _reset_for_tests() -> None:
    try:
        TOOL_CALLS_TOTAL._metrics.clear()  # type: ignore[attr-defined]
        SESSION_MESSAGES._metrics.clear()  # type: ignore[attr-defined]
        ACTIVE_SESSIONS.set(0)
    except Exception:  # pragma: no cover
        pass