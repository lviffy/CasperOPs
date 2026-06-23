-- =============================================================================
-- 20260624_phase29_api_keys_tier.sql
-- Phase 29: tier-based self-serve API key flow.
--
-- Adds a `tier` column to `agent_api_keys` (free / pro / enterprise) and a
-- `last_used_ip` column for fraud detection. The frontend's /api-keys page
-- mints a new key (returned once, then stored hashed), and the user can
-- rotate / revoke via the same page.
--
-- The Stripe webhook handler (Phase 29 follow-up) sets tier='pro' on
-- subscription creation and tier='free' on cancellation. Manual flips to
-- 'enterprise' happen via the admin SQL console.
-- =============================================================================

ALTER TABLE agent_api_keys
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free'
    CHECK (tier IN ('free', 'pro', 'enterprise'));

ALTER TABLE agent_api_keys
  ADD COLUMN IF NOT EXISTS last_used_ip INET;

ALTER TABLE agent_api_keys
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE;

-- Index for tier-based reporting ("how many pro keys are out there?")
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_tier
  ON agent_api_keys (tier, created_at DESC)
  WHERE revoked_at IS NULL;