"""
BlockOps MCP state layer.

Persists session metadata in Redis (short-term) and tool-call history in
Postgres (long-term) so the MCP server can survive restarts and surface
historical tool invocations to LangGraph / CrewAI agents.

Tables (Postgres):
    mcp_sessions (
        session_id    text PRIMARY KEY,
        agent_id      text,
        created_at    timestamptz DEFAULT now(),
        last_seen_at  timestamptz DEFAULT now(),
        metadata      jsonb
    )

    mcp_tool_calls (
        id            bigserial PRIMARY KEY,
        session_id    text,
        tool_name     text,
        params        jsonb,
        result        jsonb,
        status        text,           -- success | error | x402
        x402_hash     text,           -- optional, only when payment was required
        created_at    timestamptz DEFAULT now()
    )

Redis keys (1-hour TTL per Phase 21 spec):
    mcp:session:{id}         hash with last_seen_at, calls_count, agent_id,
                             plus an ephemeral queue of pending SSE results
                             (sse:<session_id> below)
    mcp:sse:{id}             list of pending SSE result payloads (capped)
    mcp:active_sessions      set of session ids currently connected

The state layer is best-effort: if Redis or Postgres is unavailable the
methods log + return safe defaults so the MCP server keeps responding to
tool calls.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    import redis  # type: ignore
except ImportError:  # pragma: no cover
    redis = None  # type: ignore

try:
    import asyncpg  # type: ignore
except ImportError:  # pragma: no cover
    asyncpg = None  # type: ignore


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
PG_DSN = os.getenv("POSTGRES_DSN", os.getenv("DATABASE_URL", ""))

# 1-hour TTL per Phase 21 spec.
SESSION_TTL_SECONDS = 60 * 60
# Cap pending SSE results per session so a runaway consumer doesn't OOM Redis.
SSE_PENDING_CAP = 64


class McpState:
    """Combined Redis + Postgres state for the MCP server."""

    def __init__(self) -> None:
        self._redis: Optional["redis.Redis"] = None
        self._pg_pool: Optional["asyncpg.Pool"] = None
        # Per-process in-memory SSE queue map. Redis is the durable store;
        # this map lets a server process fan-out results to its own SSE
        # consumers without an extra round-trip.
        self._sse_queues: Dict[str, asyncio.Queue] = {}
        self._sse_lock = asyncio.Lock()
        self._connect()

    # ------------------------------------------------------------------ setup
    def _connect(self) -> None:
        if redis is not None and REDIS_URL:
            try:
                self._redis = redis.from_url(REDIS_URL, decode_responses=True)
                self._redis.ping()
            except Exception as e:  # pragma: no cover
                print(f"[mcp-state] Redis disabled: {e}")
                self._redis = None

    async def connect_pg(self) -> None:
        if asyncpg is None or not PG_DSN:
            return
        if self._pg_pool is not None:
            return
        try:
            self._pg_pool = await asyncpg.create_pool(dsn=PG_DSN, min_size=1, max_size=5)
            await self._init_pg_schema()
        except Exception as e:  # pragma: no cover
            print(f"[mcp-state] Postgres disabled: {e}")
            self._pg_pool = None

    async def _init_pg_schema(self) -> None:
        if not self._pg_pool:
            return
        async with self._pg_pool.acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mcp_sessions (
                    session_id text PRIMARY KEY,
                    agent_id text,
                    created_at timestamptz DEFAULT now(),
                    last_seen_at timestamptz DEFAULT now(),
                    metadata jsonb
                )
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mcp_tool_calls (
                    id bigserial PRIMARY KEY,
                    session_id text,
                    tool_name text,
                    params jsonb,
                    result jsonb,
                    status text,
                    x402_hash text,
                    created_at timestamptz DEFAULT now()
                )
                """
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_session ON mcp_tool_calls(session_id)"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_created ON mcp_tool_calls(created_at DESC)"
            )

    # ----------------------------------------------------------------- redis
    def touch_session(self, session_id: str, agent_id: Optional[str] = None, **meta: Any) -> None:
        if not self._redis or not session_id:
            return
        try:
            key = f"mcp:session:{session_id}"
            pipe = self._redis.pipeline()
            pipe.hset(key, mapping={"last_seen_at": str(time.time()), **(meta or {})})
            if agent_id:
                pipe.hset(key, "agent_id", agent_id)
            pipe.expire(key, SESSION_TTL_SECONDS)
            pipe.sadd("mcp:active_sessions", session_id)
            # Garbage-collect the active set so it doesn't grow forever.
            pipe.expire("mcp:active_sessions", SESSION_TTL_SECONDS * 2)
            pipe.execute()
        except Exception as e:  # pragma: no cover
            print(f"[mcp-state] redis.touch_session failed: {e}")

    def session_meta(self, session_id: str) -> Dict[str, Any]:
        if not self._redis or not session_id:
            return {}
        try:
            raw = self._redis.hgetall(f"mcp:session:{session_id}") or {}
        except Exception:  # pragma: no cover
            return {}
        out = {k: v for k, v in raw.items()}
        try:
            out["calls_count"] = int(out.get("calls_count", 0))
        except (TypeError, ValueError):
            out["calls_count"] = 0
        # Translate unix ts → ISO for human consumption.
        if "last_seen_at" in out:
            try:
                ts = float(out["last_seen_at"])
                out["last_seen_at_iso"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except (TypeError, ValueError):
                pass
        return out

    def list_active_sessions(self) -> List[str]:
        if not self._redis:
            return []
        try:
            return list(self._redis.smembers("mcp:active_sessions") or [])
        except Exception:  # pragma: no cover
            return []

    def increment_calls(self, session_id: str, n: int = 1) -> None:
        if not self._redis or not session_id:
            return
        try:
            pipe = self._redis.pipeline()
            pipe.hincrby(f"mcp:session:{session_id}", "calls_count", n)
            pipe.expire(f"mcp:session:{session_id}", SESSION_TTL_SECONDS)
            pipe.execute()
        except Exception as e:  # pragma: no cover
            print(f"[mcp-state] redis.increment_calls failed: {e}")

    # --------------------------------------------------------------- sse queue
    async def set_sse_queue(self, session_id: str, queue: asyncio.Queue) -> None:
        async with self._sse_lock:
            self._sse_queues[session_id] = queue

    async def clear_sse_queue(self, session_id: str) -> None:
        async with self._sse_lock:
            self._sse_queues.pop(session_id, None)

    def push_sse(self, session_id: str, payload: Any) -> None:
        """Fan out a result to the in-memory SSE queue (if a stream is open)
        and to a Redis list (so a different server process can replay)."""
        q = self._sse_queues.get(session_id)
        if q is not None:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:  # pragma: no cover
                pass
        if self._redis:
            try:
                key = f"mcp:sse:{session_id}"
                pipe = self._redis.pipeline()
                pipe.lpush(key, json.dumps(payload, default=str))
                pipe.ltrim(key, 0, SSE_PENDING_CAP - 1)
                pipe.expire(key, SESSION_TTL_SECONDS)
                pipe.execute()
            except Exception as e:  # pragma: no cover
                print(f"[mcp-state] redis.push_sse failed: {e}")

    # ------------------------------------------------------------------ pg
    async def record_call(
        self,
        session_id: Optional[str],
        tool_name: str,
        params: Dict[str, Any],
        result: Any,
        status: str = "success",
        x402_hash: Optional[str] = None,
    ) -> None:
        if not self._pg_pool:
            return
        try:
            async with self._pg_pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        """
                        INSERT INTO mcp_tool_calls
                            (session_id, tool_name, params, result, status, x402_hash)
                        VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
                        """,
                        session_id,
                        tool_name,
                        json.dumps(params or {}),
                        json.dumps(result or {}, default=str),
                        status,
                        x402_hash,
                    )
                    if session_id:
                        await conn.execute(
                            """
                            INSERT INTO mcp_sessions (session_id, last_seen_at)
                            VALUES ($1, now())
                            ON CONFLICT (session_id) DO UPDATE SET last_seen_at = now()
                            """,
                            session_id,
                        )
        except Exception as e:  # pragma: no cover
            print(f"[mcp-state] pg.record_call failed: {e}")
            return

        # Mirror the call count to Redis (best-effort).
        if session_id:
            self.increment_calls(session_id, 1)

    async def recent_calls(self, session_id: str, limit: int = 25) -> List[Dict[str, Any]]:
        if not self._pg_pool or not session_id:
            return []
        try:
            async with self._pg_pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT tool_name, params, result, status, x402_hash, created_at
                    FROM mcp_tool_calls
                    WHERE session_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                    """,
                    session_id,
                    limit,
                )
        except Exception:  # pragma: no cover
            return []
        out: List[Dict[str, Any]] = []
        for r in rows:
            out.append(
                {
                    "tool_name": r["tool_name"],
                    "params": json.loads(r["params"] or "{}"),
                    "result": json.loads(r["result"] or "{}"),
                    "status": r["status"],
                    "x402_hash": r["x402_hash"],
                    "created_at": r["created_at"].astimezone(timezone.utc).isoformat(),
                }
            )
        return out


_state: Optional[McpState] = None


def get_state() -> McpState:
    global _state
    if _state is None:
        _state = McpState()
    return _state
