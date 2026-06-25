-- ============================================
-- x402 Payment System Database Schema
-- Extends BlockOps database for payment gating
-- ============================================

-- ============================================
-- 1. PAYMENTS TABLE
-- ============================================
-- Tracks all payment transactions for tool usage
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  
  -- Payment identifiers
  payment_hash TEXT NOT NULL UNIQUE, -- Blockchain transaction hash
  payment_id TEXT NOT NULL UNIQUE, -- Off-chain payment ID (from smart contract)
  
  -- Payment details
  amount DECIMAL(20, 6) NOT NULL,
  token_address TEXT NOT NULL, -- ERC-20 address or 'native' for ETH
  token_symbol TEXT NOT NULL, -- USDC, ETH, etc.
  
  -- Tool/service information
  tool_name TEXT, -- Which tool was paid for
  agent_name TEXT, -- Agent name snapshot
  
  -- Payment lifecycle
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'executed', 'refunded', 'failed', 'expired')),
  execution_token TEXT UNIQUE, -- JWT token for authorized execution
  
  -- Transaction references
  transaction_hash TEXT, -- Result transaction hash (if applicable)
  refund_hash TEXT, -- Refund transaction hash (if refunded)
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  confirmed_at TIMESTAMP WITH TIME ZONE, -- When payment was confirmed on-chain
  executed_at TIMESTAMP WITH TIME ZONE, -- When service was delivered
  refunded_at TIMESTAMP WITH TIME ZONE, -- When refund was processed
  expires_at TIMESTAMP WITH TIME ZONE, -- Payment expiration time
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb -- Additional payment context
);

-- Indexes for payments
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_agent_id ON payments(agent_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_hash ON payments(payment_hash);
CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_execution_token ON payments(execution_token) WHERE execution_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_expires_at ON payments(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================
-- 2. PAYMENT_AGREEMENTS TABLE
-- ============================================
-- Tracks user agreement to payment terms
CREATE TABLE IF NOT EXISTS payment_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Agreement details
  version TEXT NOT NULL, -- Terms version (e.g., 'v1.0')
  ip_address TEXT, -- User's IP at time of agreement
  user_agent TEXT, -- Browser user agent
  
  -- Agreement metadata
  terms_content TEXT, -- Snapshot of terms at time of agreement
  agreed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id, version)
);

-- Indexes for payment agreements
CREATE INDEX IF NOT EXISTS idx_payment_agreements_user_id ON payment_agreements(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_agreements_agreed_at ON payment_agreements(agreed_at DESC);

-- ============================================
-- 3. PRICING_CONFIG TABLE
-- ============================================
-- Configuration for tool pricing
CREATE TABLE IF NOT EXISTS pricing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Tool identification
  tool_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  
  -- Pricing
  price_usdc DECIMAL(10, 2) NOT NULL,
  is_free BOOLEAN DEFAULT false,
  
  -- Description and metadata
  description TEXT,
  category TEXT, -- DeFi, NFT, DAO, Analytics, etc.
  
  -- Status
  enabled BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for pricing config
CREATE INDEX IF NOT EXISTS idx_pricing_config_tool_name ON pricing_config(tool_name);
CREATE INDEX IF NOT EXISTS idx_pricing_config_enabled ON pricing_config(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_pricing_config_category ON pricing_config(category);

-- ============================================
-- 4. AI_GENERATION_QUOTAS TABLE
-- ============================================
-- Tracks free AI workflow generation quotas
CREATE TABLE IF NOT EXISTS ai_generation_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Daily quota tracking
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  free_generations_used INTEGER NOT NULL DEFAULT 0,
  free_generations_limit INTEGER NOT NULL DEFAULT 3, -- 3 free per day
  
  -- Paid generations (no limit)
  paid_generations_used INTEGER NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id, date)
);

-- Indexes for AI quotas
CREATE INDEX IF NOT EXISTS idx_ai_quotas_user_id ON ai_generation_quotas(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_quotas_date ON ai_generation_quotas(date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_quotas_user_date ON ai_generation_quotas(user_id, date);

-- ============================================
-- 5. API_RATE_LIMITS TABLE
-- ============================================
-- Tracks API rate limiting per user/agent
CREATE TABLE IF NOT EXISTS api_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  
  -- API identification
  api_key TEXT NOT NULL,
  
  -- Rate limit tracking
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'pro', 'enterprise')),
  requests_this_period INTEGER DEFAULT 0,
  max_requests INTEGER NOT NULL, -- Based on tier
  
  -- Period tracking
  period_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(api_key, period_start)
);

-- Indexes for rate limits
CREATE INDEX IF NOT EXISTS idx_rate_limits_api_key ON api_rate_limits(api_key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_user_id ON api_rate_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_agent_id ON api_rate_limits(agent_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_period_end ON api_rate_limits(period_end);

-- ============================================
-- SEED DATA - Initial Pricing Configuration
-- ============================================

-- Insert default pricing for tools
INSERT INTO pricing_config (tool_name, display_name, price_usdc, is_free, description, category, enabled) VALUES
  -- Free tools
  ('transfer', 'Token Transfer', 0.00, true, 'Send tokens to any address', 'DeFi', true),
  ('get_balance', 'Check Balance', 0.00, true, 'Check wallet token balances', 'Analytics', true),
  ('fetch_price', 'Fetch Price', 0.00, true, 'Get real-time token prices', 'Analytics', true),
  
  -- Paid tools - DeFi
  ('swap', 'Token Swap', 1.00, false, 'Swap tokens via DEX', 'DeFi', true),
  ('deposit_yield', 'Yield Deposit', 0.25, false, 'Deposit tokens to earn yield', 'DeFi', true),
  ('create_pool', 'Create Liquidity Pool', 2.00, false, 'Create new liquidity pool', 'DeFi', true),
  
  -- Paid tools - Token Creation
  ('deploy_erc20', 'Deploy ERC-20 Token', 5.00, false, 'Deploy custom ERC-20 token', 'Token', true),
  ('deploy_erc721', 'Deploy NFT Collection', 5.00, false, 'Deploy NFT collection contract', 'NFT', true),
  ('mint_nft', 'Mint NFT', 0.50, false, 'Mint NFT from collection', 'NFT', true),
  
  -- Paid tools - DAO
  ('create_dao', 'Create DAO', 3.00, false, 'Create decentralized organization', 'DAO', true),
  ('create_proposal', 'Create Proposal', 0.50, false, 'Create governance proposal', 'DAO', true),
  
  -- Paid tools - Batch Operations
  ('airdrop', 'Token Airdrop', 0.50, false, 'Batch send tokens to multiple addresses', 'Utility', true),
  ('batch_transfer', 'Batch Transfer', 0.75, false, 'Execute multiple transfers', 'Utility', true),
  
  -- Paid tools - Analytics
  ('wallet_analytics', 'Wallet Analytics', 0.25, false, 'Advanced wallet analysis', 'Analytics', true),
  ('portfolio_tracking', 'Portfolio Tracker', 0.25, false, 'Track portfolio performance', 'Analytics', true)
ON CONFLICT (tool_name) DO NOTHING;

-- ============================================
-- VIEWS FOR CONVENIENCE
-- ============================================

-- View for active payments with user info
CREATE OR REPLACE VIEW active_payments AS
SELECT 
  p.*,
  u.wallet_address,
  a.name as agent_name_current
FROM payments p
JOIN users u ON p.user_id = u.id
LEFT JOIN agents a ON p.agent_id = a.id
WHERE p.status IN ('pending', 'confirmed');

-- View for today's AI generation usage
CREATE OR REPLACE VIEW todays_ai_usage AS
SELECT 
  user_id,
  free_generations_used,
  free_generations_limit,
  paid_generations_used,
  (free_generations_limit - free_generations_used) as free_generations_remaining,
  CASE 
    WHEN free_generations_used >= free_generations_limit THEN true 
    ELSE false 
  END as needs_payment
FROM ai_generation_quotas
WHERE date = CURRENT_DATE;

-- ============================================
-- FUNCTIONS FOR QUOTA MANAGEMENT
-- ============================================

-- Function to check and update AI generation quota
CREATE OR REPLACE FUNCTION check_ai_generation_quota(
  p_user_id TEXT,
  p_is_paid BOOLEAN DEFAULT false
) RETURNS TABLE (
  can_generate BOOLEAN,
  free_remaining INTEGER,
  needs_payment BOOLEAN
) AS $$
DECLARE
  v_quota RECORD;
BEGIN
  -- Get or create today's quota record
  INSERT INTO ai_generation_quotas (user_id, date)
  VALUES (p_user_id, CURRENT_DATE)
  ON CONFLICT (user_id, date) DO NOTHING;
  
  -- Get current quota
  SELECT * INTO v_quota
  FROM ai_generation_quotas
  WHERE user_id = p_user_id AND date = CURRENT_DATE;
  
  -- Return quota status
  RETURN QUERY SELECT 
    CASE 
      WHEN p_is_paid THEN true
      WHEN v_quota.free_generations_used < v_quota.free_generations_limit THEN true
      ELSE false
    END as can_generate,
    (v_quota.free_generations_limit - v_quota.free_generations_used) as free_remaining,
    (v_quota.free_generations_used >= v_quota.free_generations_limit) as needs_payment;
END;
$$ LANGUAGE plpgsql;

-- Function to increment AI generation usage
CREATE OR REPLACE FUNCTION increment_ai_generation(
  p_user_id TEXT,
  p_is_paid BOOLEAN DEFAULT false
) RETURNS BOOLEAN AS $$
BEGIN
  IF p_is_paid THEN
    -- Increment paid generations
    UPDATE ai_generation_quotas
    SET paid_generations_used = paid_generations_used + 1,
        updated_at = NOW()
    WHERE user_id = p_user_id AND date = CURRENT_DATE;
  ELSE
    -- Increment free generations
    UPDATE ai_generation_quotas
    SET free_generations_used = free_generations_used + 1,
        updated_at = NOW()
    WHERE user_id = p_user_id AND date = CURRENT_DATE
      AND free_generations_used < free_generations_limit;
    
    IF NOT FOUND THEN
      RETURN false; -- Quota exceeded
    END IF;
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on payment tables
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generation_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Payments: Users can view their own payments
CREATE POLICY payments_select_own ON payments
  FOR SELECT USING (auth.uid()::text = user_id);

-- Payments: Service role can do everything
CREATE POLICY payments_service_all ON payments
  FOR ALL USING (auth.role() = 'service_role');

-- Payment agreements: Users can view their own agreements
CREATE POLICY payment_agreements_select_own ON payment_agreements
  FOR SELECT USING (auth.uid()::text = user_id);

-- Payment agreements: Users can insert their own agreements
CREATE POLICY payment_agreements_insert_own ON payment_agreements
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- AI quotas: Users can view their own quotas
CREATE POLICY ai_quotas_select_own ON ai_generation_quotas
  FOR SELECT USING (auth.uid()::text = user_id);

-- API rate limits: Users can view their own limits
CREATE POLICY rate_limits_select_own ON api_rate_limits
  FOR SELECT USING (auth.uid()::text = user_id);

-- ============================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to relevant tables
CREATE TRIGGER update_pricing_config_updated_at
  BEFORE UPDATE ON pricing_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ai_quotas_updated_at
  BEFORE UPDATE ON ai_generation_quotas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rate_limits_updated_at
  BEFORE UPDATE ON api_rate_limits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE payments IS 'Tracks all payment transactions for tool usage with escrow status';
COMMENT ON TABLE payment_agreements IS 'Records user acceptance of payment terms and conditions';
COMMENT ON TABLE pricing_config IS 'Configuration for tool pricing and availability';
COMMENT ON TABLE ai_generation_quotas IS 'Tracks daily free AI workflow generation quotas (3 free per day)';
COMMENT ON TABLE api_rate_limits IS 'Manages API rate limiting per user and agent';

COMMENT ON COLUMN payments.payment_hash IS 'Blockchain transaction hash for on-chain payment verification';
COMMENT ON COLUMN payments.execution_token IS 'JWT token authorizing service execution after payment';
COMMENT ON COLUMN ai_generation_quotas.free_generations_limit IS 'Default 3 free AI generations per day';

-- ============================================
-- END OF SCHEMA
-- ============================================
