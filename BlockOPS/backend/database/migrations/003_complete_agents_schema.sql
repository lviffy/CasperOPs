-- Migration: Complete agents table schema
-- This ensures all columns used by the backend exist in the agents table.
-- Run this in your Supabase SQL Editor.

-- 1. Add missing metadata columns
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS api_key TEXT,
  ADD COLUMN IF NOT EXISTS tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS enabled_tools TEXT[],
  ADD COLUMN IF NOT EXISTS wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS on_chain_id TEXT,
  ADD COLUMN IF NOT EXISTS api_key_hash TEXT,
  ADD COLUMN IF NOT EXISTS api_key_prefix TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

-- 2. Ensure status is constrained to supported values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agents_status_check'
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_status_check
      CHECK (status IN ('active', 'paused', 'archived'));
  END IF;
END $$;

-- 3. Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_wallet_address ON agents(wallet_address);
CREATE INDEX IF NOT EXISTS idx_agents_is_public ON agents(is_public);

-- 4. Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'agents'
ORDER BY ordinal_position;
