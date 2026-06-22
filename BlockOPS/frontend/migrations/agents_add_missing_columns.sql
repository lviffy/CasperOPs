-- Migration: Add missing columns to agents table
-- The agents table was created with the backend schema (api_key_hash / api_key_prefix)
-- but the frontend expects a plain api_key column along with tools (JSONB) and status.
--
-- Run this in the Supabase SQL Editor.

-- 1. Add api_key column (plain text, used by frontend)
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS api_key TEXT;

-- 2. Backfill api_key for any existing rows so the NOT NULL constraint can be set
UPDATE agents
SET api_key = 'bops_' || substr(md5(random()::text || id::text), 1, 27)
WHERE api_key IS NULL;

-- 3. Add NOT NULL + UNIQUE constraints
ALTER TABLE agents
  ALTER COLUMN api_key SET NOT NULL;

ALTER TABLE agents
  ADD CONSTRAINT agents_api_key_unique UNIQUE (api_key);

-- 4. Add tools column (JSONB array of workflow tool configs)
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS tools JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 5. Add status column
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'paused', 'archived'));

-- 6. Add on-chain registry column
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS on_chain_id TEXT;

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_agents_api_key    ON agents(api_key);
CREATE INDEX IF NOT EXISTS idx_agents_status     ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at DESC);

-- 8. Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'agents'
ORDER BY ordinal_position;
