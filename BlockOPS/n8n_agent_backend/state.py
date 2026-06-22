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

Redis keys:
    mcp:session:{id}         hash with last_tool, last_call_at, calls_count
    mcp:active_sessions      set of session ids currently connected
"""

import os
import json
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


class McpState:
    """Combined Redis + Postgres state for the MCP server.

    All methods are best-effort: if Redis or Postgres is unavailable, the
    methods log and return safe defaults so the MCP server keeps responding
    to tool calls.
    """

    def __init__(self) -> None:
        self._redis: Optional["redis.Redis"] = None
        self._pg_pool: Optional["asyncpg.Pool"] = None
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

    # ----------------------------------------------------------------- redis
    def touch_session(self, session_id: str, agent_id: Optional[str] = None, **meta: Any) -> None:
        if not self._redis or not session_id:
            return
        try:
            key = f"mcp:session:{session_id}"
            self._redis.hset(key, mapping={"last_seen_at": str(time.time()), **(meta or {})})
            if agent_id:
                self._redis.hset(key, "agent_id", agent_id)
            self._redis.expire(key, 60 * 60 * 24)
            self._redis.sadd("mcp:active_sessions", session_id)
        except Exception as e:  # pragma: no cover
            print(f"[mcp-state] redis.touch_session failed: {e}")

    def session_meta(self, session_id: str) -> Dict[str, Any]:
        if not self._redis or not session_id:
            return {}
        try:
            raw = self._redis.hgetall(f"mcp:session:{session_id}") or {}
        except Exception:  # pragma: no cover
            return {}
        return {k: v for k, v in raw.items()}

    def list_active_sessions(self) -> List[str]:
        if not self._redis:
            return []
        try:
            return list(self._redis.smembers("mcp:active_sessions") or [])
        except Exception:  # pragma: no cover
            return []

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
