-- ============================================
-- Supabase Setup for BlockOps (Quick Setup)
-- Run this in Supabase SQL Editor
-- 
-- NOTE: For complete schema with all optional tables,
-- see: frontend/DATABASE_SCHEMA.sql
-- ============================================

-- 1. Create users table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, -- Privy DID (format: did:privy:xxxxx)
  private_key TEXT,
  wallet_address TEXT,
  wallet_type TEXT CHECK (wallet_type IN ('traditional', 'pkp')),
  pkp_public_key TEXT,
  pkp_token_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create agents table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS agents (
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

-- 3. DISABLE Row Level Security (RLS) since we're using Privy for auth
-- Privy handles authentication, so we don't need Supabase RLS
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE agents DISABLE ROW LEVEL SECURITY;

-- 4. Drop existing policies if they exist (optional, won't error if they don't exist)
DROP POLICY IF EXISTS "Users can view own data" ON users;
DROP POLICY IF EXISTS "Users can update own data" ON users;
DROP POLICY IF EXISTS "Users can insert own data" ON users;
DROP POLICY IF EXISTS "Users can view own agents" ON agents;
DROP POLICY IF EXISTS "Users can create own agents" ON agents;
DROP POLICY IF EXISTS "Users can update own agents" ON agents;
DROP POLICY IF EXISTS "Users can delete own agents" ON agents;

-- 5. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_wallet_type ON users(wallet_type);
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at DESC);

-- 6. Create trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 7. Create triggers for auto-updating updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. Verify tables were created
SELECT 
  table_name, 
  column_name, 
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name IN ('users', 'agents')
ORDER BY table_name, ordinal_position;

-- ============================================
-- OPTIONAL: Run DATABASE_SCHEMA.sql for complete setup
-- including conversations, messages, executions tables
-- ============================================
