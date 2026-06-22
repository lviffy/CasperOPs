-- Migration: agent_api_keys table
-- Run this in your Supabase SQL editor to enable per-agent API key auth

CREATE TABLE IF NOT EXISTS agent_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,     -- SHA-256 hash of the raw key
  label         TEXT,                     -- Human-readable label, e.g. "Production Key"
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast key lookups
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_hash ON agent_api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent ON agent_api_keys (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_user  ON agent_api_keys (user_id);

-- RLS: service role can read/write, users can only see their own keys
ALTER TABLE agent_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON agent_api_keys
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Optional: call this from your backend to generate + insert a new key
-- The raw key is returned once and never stored; only the hash is kept.
--
-- Example usage from Node.js:
--   const crypto = require('crypto');
--   const rawKey = 'bops_' + crypto.randomBytes(24).toString('hex');
--   const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
--   await supabase.from('agent_api_keys').insert({ agent_id, user_id, key_hash: keyHash, label });
--   // Return rawKey to the user — this is the only time it is visible
