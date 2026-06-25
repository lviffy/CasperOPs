-- ============================================
-- BlockOps Complete Database Schema
-- Supabase PostgreSQL Database
-- ============================================

-- ============================================
-- 1. USERS TABLE
-- ============================================
-- Stores user information from Privy authentication
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, -- Privy DID (format: did:privy:xxxxx)
  private_key TEXT, -- Lit-encrypted legacy EOA private key (optional)
  wallet_address TEXT, -- Agent wallet address (legacy EOA or PKP-backed)
  wallet_type TEXT CHECK (wallet_type IN ('traditional', 'pkp')),
  pkp_public_key TEXT, -- Lit PKP public key for seedless wallet mode
  pkp_token_id TEXT, -- ERC-721 tokenId for the minted PKP
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_wallet_type ON users(wallet_type);

-- ============================================
-- 2. AGENTS TABLE
-- ============================================
-- Stores AI agents created by users
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  api_key TEXT UNIQUE NOT NULL, -- API key for agent access
  tools JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of tool configurations
  -- Tools structure: [{tool: string, next_tool: string | null, config: object}]
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  on_chain_id TEXT, -- ERC-8004 Identity Registry ID
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for agents
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at DESC);

-- ============================================
-- 3. CONVERSATIONS TABLE (Optional - for chat history)
-- ============================================
-- Stores conversation history between users and agents
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT, -- Auto-generated from first message
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- ============================================
-- 4. MESSAGES TABLE (Optional - for chat history)
-- ============================================
-- Stores individual messages in conversations
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  agent_response JSONB, -- Full agent response with tool calls and results
  -- Structure: {agent_response: string, tool_calls: array, results: array}
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- ============================================
-- 5. AGENT_EXECUTIONS TABLE (Optional - for analytics)
-- ============================================
-- Tracks agent execution history and performance
CREATE TABLE IF NOT EXISTS agent_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_message TEXT NOT NULL,
  agent_response TEXT,
  tool_calls_count INTEGER DEFAULT 0,
  execution_time_ms INTEGER, -- Time taken in milliseconds
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_executions_agent_id ON agent_executions(agent_id);
CREATE INDEX IF NOT EXISTS idx_executions_user_id ON agent_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_executions_created_at ON agent_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_success ON agent_executions(success);

-- ============================================
-- 6. TOOL_EXECUTIONS TABLE (Optional - for detailed analytics)
-- ============================================
-- Tracks individual tool executions within agent runs
CREATE TABLE IF NOT EXISTS tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  parameters JSONB NOT NULL,
  result JSONB,
  success BOOLEAN DEFAULT true,
  execution_time_ms INTEGER,
  transaction_hash TEXT, -- For blockchain transactions
  validation_hash TEXT, -- ERC-8004 Validation Registry request hash
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_executions_execution_id ON tool_executions(execution_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_name ON tool_executions(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_executions_transaction_hash ON tool_executions(transaction_hash);

-- ============================================
-- 7. API_USAGE TABLE (Optional - for rate limiting & billing)
-- ============================================
-- Tracks API usage for rate limiting and analytics
CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL, -- Redundant but useful for quick lookups
  endpoint TEXT, -- e.g., '/agent/chat'
  ip_address INET,
  user_agent TEXT,
  response_status INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_agent_id ON api_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_api_key ON api_usage(api_key);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at DESC);

-- ============================================
-- DISABLE ROW LEVEL SECURITY
-- ============================================
-- Since we're using Privy for authentication, we disable Supabase RLS
-- Application-level security is handled in the frontend/backend
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE agents DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_executions DISABLE ROW LEVEL SECURITY;
ALTER TABLE tool_executions DISABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage DISABLE ROW LEVEL SECURITY;

-- ============================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================
-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VERIFICATION QUERY
-- ============================================
-- Run this to verify all tables were created
SELECT 
  table_name, 
  column_name, 
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public'
  AND table_name IN ('users', 'agents', 'conversations', 'messages', 'agent_executions', 'tool_executions', 'api_usage')
ORDER BY table_name, ordinal_position;
