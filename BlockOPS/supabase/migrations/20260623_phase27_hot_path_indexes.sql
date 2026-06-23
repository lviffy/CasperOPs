-- =============================================================================
-- 20260623_phase27_hot_path_indexes.sql
-- Phase 27: add covering indexes on the three hot read paths the k6 load
-- tests exercise. The original migration created per-column indexes; this
-- one extends them with composite indexes that match the actual query
-- predicates + ORDER BY patterns.
--
-- This migration is IDEMPOTENT — every CREATE uses IF NOT EXISTS so it can
-- be re-run after a partial apply.
-- =============================================================================

-- 1. tool_executions(tool_id, created_at DESC)
--    Query pattern: "SELECT * FROM tool_executions WHERE tool_id = $1
--                     ORDER BY created_at DESC LIMIT 50" — every
--    per-tool analytics dashboard hits this. Without the composite
--    index Postgres falls back to a sort on idx_tool_executions_tool_id.
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_created
  ON tool_executions (tool_id, created_at DESC);

-- 2. mcp_tool_calls(session_id, created_at DESC)
--    Query pattern: "SELECT * FROM mcp_tool_calls WHERE session_id = $1
--                     ORDER BY created_at DESC LIMIT 25" — hit by the
--    /mcp/recent/<session_id> endpoint every time an MCP client opens
--    a stream and asks for context. The original migration created
--    idx_mcp_tool_calls_session (session_id) only; this adds the
--    composite.
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_session_created
  ON mcp_tool_calls (session_id, created_at DESC);

-- 3. deploy_history status + created_at — useful for the
--    "what stuck deploys are pending right now?" Sentry alert query.
--    Cheap to maintain because status has low cardinality.
CREATE INDEX IF NOT EXISTS idx_deploy_history_status_created
  ON deploy_history (status, created_at DESC);

-- 4. Partial index for the 5-min "stuck pending" sweep — Postgres can
--    skip the heap entirely when most rows are NOT pending.
CREATE INDEX IF NOT EXISTS idx_deploy_history_pending_recent
  ON deploy_history (created_at DESC)
  WHERE status = 'pending';