-- Migration: agent registry + Filecoin-backed tool execution audit logs
-- Run this in your Supabase SQL editor

-- ─── Agent Registry ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_registry (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id          TEXT        NOT NULL,
  display_name     TEXT        NOT NULL,
  description      TEXT,
  capabilities     TEXT[]      NOT NULL DEFAULT '{}',
  supported_chains TEXT[]      NOT NULL DEFAULT '{}',
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deprecated')),
  version          INTEGER     NOT NULL DEFAULT 1,
  metadata_cid     TEXT,
  metadata_uri     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_registry_user           ON agent_registry (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_registry_status         ON agent_registry (status);
CREATE INDEX IF NOT EXISTS idx_agent_registry_chains         ON agent_registry USING GIN (supported_chains);
CREATE INDEX IF NOT EXISTS idx_agent_registry_capabilities   ON agent_registry USING GIN (capabilities);

-- ─── Tool Execution Audit Logs ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_tool_execution_logs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         TEXT        NOT NULL,
  user_id          TEXT        NOT NULL,
  conversation_id  TEXT,
  message_excerpt  TEXT,
  execution_mode   TEXT        NOT NULL DEFAULT 'agent_backend',
  tool_name        TEXT        NOT NULL,
  tool_index       INTEGER,
  chain            TEXT,
  params_sanitized JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result_summary   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  raw_result       JSONB,
  success          BOOLEAN     NOT NULL DEFAULT FALSE,
  tx_hash          TEXT,
  amount           TEXT,
  filecoin_cid     TEXT,
  filecoin_uri     TEXT,
  filecoin_provider TEXT,
  storage_status   TEXT        NOT NULL DEFAULT 'pending' CHECK (storage_status IN ('stored', 'failed', 'not_configured', 'pending')),
  storage_error    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_logs_agent_time    ON agent_tool_execution_logs (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_logs_user_time     ON agent_tool_execution_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_logs_conversation  ON agent_tool_execution_logs (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_logs_storage       ON agent_tool_execution_logs (storage_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_logs_tx_hash       ON agent_tool_execution_logs (tx_hash);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE agent_registry             ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_execution_logs  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON agent_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON agent_tool_execution_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── updated_at trigger for registry ────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_agent_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_registry_updated_at ON agent_registry;
CREATE TRIGGER trg_agent_registry_updated_at
  BEFORE UPDATE ON agent_registry
  FOR EACH ROW
  EXECUTE FUNCTION set_agent_registry_updated_at();
