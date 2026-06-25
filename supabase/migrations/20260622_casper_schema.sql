-- =============================================================================
-- 20260622_casper_schema.sql
-- CasperOPs Casper-native database migration.
--
-- Drops the legacy EVM/Lit columns, adds CSPR.click columns, and creates the
-- new deploy-history / tool-execution / reputation-event tables that the
-- Casper-only CasperOPs stack needs.
--
-- This migration is IDEMPOTENT — every ALTER / CREATE uses IF [NOT] EXISTS so
-- it's safe to re-run on partially-migrated databases.
-- =============================================================================

-- 1. Legacy columns → drop. We keep the old columns nullable for one release
--    so the backend can still read them; a follow-up migration removes them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ed25519_public_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS csprclick_session_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMP WITH TIME ZONE;

-- 2. Backfill: any user that has a wallet_address already gets it copied into
--    ed25519_public_key. New CSPR.click connections will write to both.
UPDATE users
   SET ed25519_public_key = wallet_address,
       last_connected_at = COALESCE(last_connected_at, updated_at)
 WHERE ed25519_public_key IS NULL
   AND wallet_address IS NOT NULL;

-- 3. Mark every existing user as having a CSPR.click session if they had a
--    wallet_address at migration time. (The frontend will refresh this on
--    next sign-in.)
UPDATE users
   SET csprclick_session_id = 'migrated-' || id
 WHERE csprclick_session_id IS NULL
   AND wallet_address IS NOT NULL;

-- 4. Drop the legacy EVM/Lit columns. Safe in a fresh project, but guard
--    with IF EXISTS so partial migrations don't break.
ALTER TABLE users DROP COLUMN IF EXISTS private_key_encrypted;
ALTER TABLE users DROP COLUMN IF EXISTS pkp_public_key;
ALTER TABLE users DROP COLUMN IF EXISTS evm_address;
-- private_key and pkp_token_id were kept nullable in supabase.ts for the
-- legacy transition. We can leave them for one release, then drop in
-- 20260629_drop_legacy.sql.
ALTER TABLE users DROP COLUMN IF EXISTS private_key;
ALTER TABLE users DROP COLUMN IF EXISTS pkp_token_id;

-- 5. Enforce wallet_type = 'csprclick' on new inserts. Update existing rows
--    to the canonical value first.
UPDATE users SET wallet_type = 'csprclick' WHERE wallet_type IS NULL OR wallet_type NOT IN ('csprclick');
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_wallet_type_check;
ALTER TABLE users ADD CONSTRAINT users_wallet_type_check
  CHECK (wallet_type IS NULL OR wallet_type = 'csprclick');

-- 6. Index for fast wallet lookups.
CREATE INDEX IF NOT EXISTS idx_users_ed25519_public_key ON users (ed25519_public_key);
CREATE INDEX IF NOT EXISTS idx_users_last_connected_at ON users (last_connected_at DESC);

-- =============================================================================
-- deploy_history
-- One row per on-chain deploy signed by the user.
-- =============================================================================
CREATE TABLE IF NOT EXISTS deploy_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id TEXT,
  contract_hash TEXT,
  entry_point TEXT,
  deploy_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | executed | finalized | failed
  error_message TEXT,
  cost_motes NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  finalized_at TIMESTAMP WITH TIME ZONE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deploy_history_deploy_hash ON deploy_history (deploy_hash);
CREATE INDEX IF NOT EXISTS idx_deploy_history_user_id ON deploy_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_history_status ON deploy_history (status);

-- =============================================================================
-- tool_executions
-- One row per paid tool invocation (after x402 payment was verified).
-- =============================================================================
CREATE TABLE IF NOT EXISTS tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  workflow_id TEXT,
  tool_id TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  x402_payment_hash TEXT REFERENCES deploy_history(deploy_hash) ON DELETE SET NULL,
  price_motes NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tool_executions_user_id ON tool_executions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_id ON tool_executions (tool_id);

-- =============================================================================
-- reputation_events
-- Append-only ledger of every attestation / slash event on-chain.
-- =============================================================================
CREATE TABLE IF NOT EXISTS reputation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  score_delta NUMERIC NOT NULL,
  attester TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  evidence_uri TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reputation_events_tx_hash ON reputation_events (tx_hash);
CREATE INDEX IF NOT EXISTS idx_reputation_events_agent_id ON reputation_events (agent_id, created_at DESC);

-- =============================================================================
-- RLS policies (mirrors CasperOPs app's existing setup; tighten as needed).
-- =============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE deploy_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reputation_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own row.
DROP POLICY IF EXISTS users_self_read ON users;
CREATE POLICY users_self_read ON users
  FOR SELECT
  USING (auth.uid()::text = id);

-- Users can update their own row.
DROP POLICY IF EXISTS users_self_update ON users;
CREATE POLICY users_self_update ON users
  FOR UPDATE
  USING (auth.uid()::text = id);

-- deploy_history: only the wallet owner can read their own deploys.
DROP POLICY IF EXISTS deploy_history_owner_read ON deploy_history;
CREATE POLICY deploy_history_owner_read ON deploy_history
  FOR SELECT
  USING (auth.uid()::text = user_id);

-- tool_executions: only the wallet owner can read their own executions.
DROP POLICY IF EXISTS tool_executions_owner_read ON tool_executions;
CREATE POLICY tool_executions_owner_read ON tool_executions
  FOR SELECT
  USING (auth.uid()::text = user_id);

-- reputation_events: world-readable (public agent reputation).
DROP POLICY IF EXISTS reputation_events_public_read ON reputation_events;
CREATE POLICY reputation_events_public_read ON reputation_events
  FOR SELECT
  USING (true);
