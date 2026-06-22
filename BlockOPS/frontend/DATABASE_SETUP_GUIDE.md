# Database Setup Guide - x402 Payment System

## Overview

This guide will help you set up the payment system database schema in Supabase.

## Prerequisites

- ✅ Supabase project created
- ✅ Database connection established
- ✅ Existing BlockOps schema (users, agents tables)

## Quick Setup

### Option 1: Supabase SQL Editor (Recommended)

1. **Login to Supabase Dashboard**
   - Go to https://app.supabase.com
   - Select your project

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New query"

3. **Run Migration**
   - Copy the entire contents of `X402_PAYMENT_SCHEMA.sql`
   - Paste into the SQL editor
   - Click "Run" (or press Ctrl/Cmd + Enter)

4. **Verify Tables Created**
   - Go to "Table Editor" in the left sidebar
   - You should see these new tables:
     - ✅ `payments`
     - ✅ `payment_agreements`
     - ✅ `pricing_config`
     - ✅ `ai_generation_quotas`
     - ✅ `api_rate_limits`

### Option 2: Command Line (psql)

```bash
# Connect to your Supabase database
psql "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].supabase.co:5432/postgres"

# Run the migration
\i frontend/X402_PAYMENT_SCHEMA.sql
```

### Option 3: Supabase CLI

```bash
# Login to Supabase
npx supabase login

# Link your project
npx supabase link --project-ref [YOUR-PROJECT-REF]

# Create migration
npx supabase db reset --db-url "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].supabase.co:5432/postgres"

# Or push the schema directly
cat frontend/X402_PAYMENT_SCHEMA.sql | npx supabase db execute
```

## Database Schema Details

### Tables Created

#### 1. `payments`
Tracks all payment transactions for tool usage.

**Key Columns:**
- `payment_hash` - Blockchain transaction hash
- `payment_id` - Off-chain payment reference
- `status` - Payment lifecycle (pending → confirmed → executed/refunded)
- `execution_token` - JWT for authorized execution
- `expires_at` - Payment expiration time

#### 2. `payment_agreements`
Records user acceptance of payment terms.

**Key Columns:**
- `user_id` - User who agreed
- `version` - Terms version (v1.0)
- `agreed_at` - Timestamp of agreement

#### 3. `pricing_config`
Configuration for tool pricing.

**Pre-seeded with:**
- 3 free tools (transfer, get_balance, fetch_price)
- 13 paid tools (deploy_erc20: $5, swap: $1, etc.)

#### 4. `ai_generation_quotas`
Tracks daily free AI workflow generation quotas.

**Default Limits:**
- 3 free AI generations per day per user
- Unlimited paid generations

#### 5. `api_rate_limits`
Manages API rate limiting per user and agent.

**Tiers:**
- Free: Limited requests
- Starter/Pro/Enterprise: Higher limits

### Views Created

- `active_payments` - All pending/confirmed payments with user info
- `todays_ai_usage` - Today's AI generation usage per user

### Functions Created

- `check_ai_generation_quota(user_id, is_paid)` - Check if user can generate
- `increment_ai_generation(user_id, is_paid)` - Increment usage counter

## Verification Steps

### 1. Check Tables Exist

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('payments', 'payment_agreements', 'pricing_config', 'ai_generation_quotas', 'api_rate_limits');
```

Should return 5 rows.

### 2. Verify Pricing Config Seeded

```sql
SELECT tool_name, price_usdc, is_free 
FROM pricing_config 
ORDER BY price_usdc;
```

Should return 16 tools with pricing.

### 3. Test AI Quota Function

```sql
-- Test checking quota for a user
SELECT * FROM check_ai_generation_quota('test_user_id', false);
```

### 4. Verify Indexes Created

```sql
SELECT indexname 
FROM pg_indexes 
WHERE tablename IN ('payments', 'payment_agreements', 'pricing_config', 'ai_generation_quotas', 'api_rate_limits');
```

Should return multiple indexes.

## Row Level Security (RLS)

All tables have RLS enabled with policies:

✅ **Users can:**
- View their own payments
- View their own agreements
- View their own quotas
- Insert their own agreements

✅ **Service role can:**
- Perform all operations (for backend services)

## Environment Variables

After database setup, update your `.env.local` in the frontend:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://[YOUR-PROJECT-REF].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Payment Contract (from Day 2)
NEXT_PUBLIC_PAYMENT_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
NEXT_PUBLIC_ARBITRUM_SEPOLIA_CHAIN_ID=421614
```

## Common Issues & Fixes

### Issue: "relation already exists"
**Solution:** Tables already created. You can either:
- Drop tables first: `DROP TABLE IF EXISTS payments CASCADE;`
- Or skip the error and continue

### Issue: "permission denied"
**Solution:** Make sure you're using a user with CREATE TABLE permissions.

### Issue: RLS blocking queries
**Solution:** 
- For testing: `ALTER TABLE payments DISABLE ROW LEVEL SECURITY;`
- For production: Use service role key for backend operations

### Issue: Functions not working
**Solution:** Check if plpgsql extension is enabled:
```sql
CREATE EXTENSION IF NOT EXISTS plpgsql;
```

## Testing the Setup

### 1. Create a test payment record

```sql
INSERT INTO payments (
  user_id, 
  payment_hash, 
  payment_id, 
  amount, 
  token_address, 
  token_symbol, 
  tool_name, 
  status
) VALUES (
  'test_user', 
  '0xtest123', 
  'pay_test123', 
  5.00, 
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', 
  'USDC', 
  'deploy_erc20', 
  'confirmed'
);
```

### 2. Test AI quota check

```sql
-- Initialize quota for test user
INSERT INTO ai_generation_quotas (user_id) VALUES ('test_user');

-- Check quota
SELECT * FROM check_ai_generation_quota('test_user', false);

-- Should show: can_generate=true, free_remaining=3, needs_payment=false
```

### 3. Query active payments

```sql
SELECT * FROM active_payments LIMIT 5;
```

### 4. Check pricing

```sql
SELECT tool_name, price_usdc, category 
FROM pricing_config 
WHERE enabled = true 
ORDER BY category, price_usdc;
```

## Rollback (if needed)

If you need to remove all payment tables:

```sql
-- Drop tables (in reverse order due to dependencies)
DROP TABLE IF EXISTS api_rate_limits CASCADE;
DROP TABLE IF EXISTS ai_generation_quotas CASCADE;
DROP TABLE IF EXISTS pricing_config CASCADE;
DROP TABLE IF EXISTS payment_agreements CASCADE;
DROP TABLE IF EXISTS payments CASCADE;

-- Drop views
DROP VIEW IF EXISTS active_payments;
DROP VIEW IF EXISTS todays_ai_usage;

-- Drop functions
DROP FUNCTION IF EXISTS check_ai_generation_quota;
DROP FUNCTION IF EXISTS increment_ai_generation;
DROP FUNCTION IF EXISTS update_updated_at_column;
```

## Next Steps

✅ **Day 3 Complete!** Database schema is ready.

**Day 4 - Payment Service Backend:**
1. Create payment service API
2. Implement payment verification
3. Add execution token generation
4. Set up webhook handlers

Run:
```bash
cd frontend
# We'll create the payment service next
```

## Support

If you encounter issues:
1. Check Supabase logs in dashboard
2. Verify database connection string
3. Ensure you're using the service role key for backend operations
4. Check RLS policies if queries return empty results

---

**Status:** ✅ Ready for Day 4 (Payment Service)  
**Database:** Payment tables, views, and functions created  
**Seeded:** 16 tools with pricing configuration
