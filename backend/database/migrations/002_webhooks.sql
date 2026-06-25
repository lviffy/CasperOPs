-- Migration: webhook tables
-- Run this in your Supabase SQL editor

-- ─── Webhook registrations ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhook_registrations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          TEXT        NOT NULL,
  user_id           TEXT        NOT NULL,
  url               TEXT        NOT NULL,
  event_types       TEXT[]      NOT NULL DEFAULT '{}',
  label             TEXT,
  secret            TEXT        NOT NULL,   -- whsec_ prefixed signing secret
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_reg_agent     ON webhook_registrations (agent_id);
CREATE INDEX IF NOT EXISTS idx_webhook_reg_active    ON webhook_registrations (agent_id, is_active);

-- ─── Delivery logs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id    UUID        NOT NULL REFERENCES webhook_registrations(id) ON DELETE CASCADE,
  agent_id      TEXT        NOT NULL,
  event_type    TEXT        NOT NULL,
  payload       TEXT,               -- JSON string of what was sent
  attempt       INT         NOT NULL DEFAULT 1,
  status_code   INT,                -- HTTP status from target (null = connection error)
  success       BOOLEAN     NOT NULL DEFAULT FALSE,
  error_message TEXT,
  delivered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_webhook  ON webhook_delivery_logs (webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_log_agent    ON webhook_delivery_logs (agent_id);
CREATE INDEX IF NOT EXISTS idx_webhook_log_time     ON webhook_delivery_logs (delivered_at DESC);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE webhook_registrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_logs  ENABLE ROW LEVEL SECURITY;

-- Service role gets full access
CREATE POLICY "Service role full access" ON webhook_registrations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON webhook_delivery_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

CREATE TRIGGER trg_webhook_reg_updated_at
  BEFORE UPDATE ON webhook_registrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
