-- ============================================
-- SAFE MIGRATION: add PKP wallet columns to an existing users table
-- ============================================
-- Run this in the Supabase SQL editor for an already-running BlockOps app.
-- It is additive and does NOT drop your existing data.

-- 1. Ensure the users table exists with the base columns
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  private_key TEXT,
  wallet_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 3: Recreate agents table
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  api_key TEXT UNIQUE NOT NULL,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  on_chain_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- 2. Add the new hybrid-wallet columns if they are missing
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pkp_public_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pkp_token_id TEXT;

-- 3. Recreate the wallet_type constraint safely
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_wallet_type_check;
ALTER TABLE users
  ADD CONSTRAINT users_wallet_type_check
  CHECK (wallet_type IN ('traditional', 'pkp') OR wallet_type IS NULL);

-- 4. Add helpful indexes
CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_wallet_type ON users(wallet_type);

-- 5. Verify the users table shape
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
ORDER BY ordinal_position;
