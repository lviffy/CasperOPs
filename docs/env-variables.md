# CasperOPs Environment Variables

All env vars by layer. Required = must be set, no fallback. Optional = has a safe default.

---

## Getting Started: Deploy Contracts + Get Faucet Funds

Before any env vars matter, you need a funded testnet signer and deployed contracts.

### Prerequisites

```bash
# Rust nightly (for Odra contract compilation)
rustup toolchain install nightly
rustup target add wasm32-unknown-unknown --toolchain nightly

# WABT (WebAssembly Binary Toolkit) — for wasm-strip
# Ubuntu/Debian:
sudo apt install wabt
# macOS:
brew install wabt

# Node 20+
node --version  # must be ≥20
```

### Step 1: Generate signer keypair

```bash
cd contract
node scripts/generate-signer.js
```

This prints:
- **Public key** — starts with `01`, 66 hex chars. Copy this.
- **Private key (SecretKey)** — 64 hex chars, no prefix. Copy this.

The script also writes:
- `backend/secrets/testnet-signer.pem` (PEM format, gitignored)
- `backend/secrets/testnet-signer.json` (JSON format, gitignored)

### Step 2: Fund from faucet

Take the **public key** from Step 1 and go to:

👉 **https://testnet.cspr.live/tools/faucet**

Paste the public key into the faucet form and request funds. 200 CSPR is enough for 10+ contract deploys + e2e runs.

Verify balance loaded:
```
https://testnet.cspr.live/account/<public-key>
```

### Step 3: Wire signer into backend

Edit `backend/.env`:
```
CASPER_SECRET_KEY=<64-hex-private-key-from-step-1>
```

### Step 4: Build WASM contracts

```bash
cd contract
export RUSTFLAGS="-C link-arg=--unresolved-symbols=import-dynamic"
cargo odra build
```

This produces 6 WASM binaries in `contract/wasm/`:
- `AgentFactory.wasm`
- `Reputation.wasm`
- `Escrow.wasm`
- `Compliance.wasm`
- `Cep18Token.wasm`
- `Cep78Nft.wasm`

### Step 5: Deploy to testnet

```bash
cd contract
node scripts/deploy.js
```

The script prints 6 contract hashes in `hash-<64hex>` format. Copy them all:

```
Factory:   hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Reputation: hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
Escrow:    hash-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
Compliance: hash-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
Cep18:     hash-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
Cep78:     hash-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
```

### Step 6: Wire contract hashes into env vars

<table>
<tr><th>Backend (<code>backend/.env</code>)</th><th>Frontend (<code>frontend/.env.local</code>)</th></tr>
<tr><td>
<pre>
CASPER_AGENT_FACTORY_HASH=hash-aaaa…
CASPER_REPUTATION_HASH=hash-bbbb…
CASPER_ESCROW_HASH=hash-cccc…
CASPER_COMPLIANCE_HASH=hash-dddd…
</pre>
</td><td>
<pre>
NEXT_PUBLIC_AGENT_FACTORY_CONTRACT_HASH=hash-aaaa…
NEXT_PUBLIC_REPUTATION_CONTRACT_HASH=hash-bbbb…
NEXT_PUBLIC_ESCROW_CONTRACT_HASH=hash-cccc…
NEXT_PUBLIC_COMPLIANCE_CONTRACT_HASH=hash-dddd…
NEXT_PUBLIC_CEP18_CONTRACT_HASH=hash-eeee…
NEXT_PUBLIC_PAYMENT_RECIPIENT_PUBLIC_KEY=01<64hex>
</pre>
</td></tr>
</table>

`PAYMENT_RECIPIENT_PUBLIC_KEY` is the same `01`-prefixed public key from Step 1.

### Step 7: Run e2e test to verify

```bash
# Dryrun first (no live RPC):
./scripts/e2e-testnet-phase22.sh

# Then live against testnet:
./scripts/e2e-testnet-phase22.sh --skip-deploy --live
```

### Step 8: Start the stack

```bash
# Docker (all services):
docker compose up -d --build

# Or manually:
cd backend && npm start          # Express API on :3000
cd frontend && npm run dev       # Next.js on :3000 (different port if backend also :3000)
cd n8n_agent_backend && uvicorn mcp_server_sse:app --port 8080  # MCP
```

---

## Backend (`backend/.env`)

### Required — app won't start without these

| Variable | Description |
|---|---|
| `CASPER_SECRET_KEY` | 64-char hex testnet signer private key (from `contract/scripts/generate-signer.js`) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service_role secret (full access) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather on Telegram |
| `ADMIN_SECRET` | Admin endpoint auth (change from default!) |
| `MASTER_API_KEY` | Master API key for internal calls (change from default!) |
| `GROQ_API_KEY1` | At least one Groq key required for AI tool routing |

### Contract hashes — set after `contract/scripts/deploy.js`

| Variable | Description |
|---|---|
| `CASPER_AGENT_FACTORY_HASH` | `hash-<64hex>` from deploy output |
| `CASPER_REPUTATION_HASH` | `hash-<64hex>` |
| `CASPER_ESCROW_HASH` | `hash-<64hex>` |
| `CASPER_COMPLIANCE_HASH` | `hash-<64hex>` |

### Optional — sensible defaults exist

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `development` | `production` in staging |
| `CASPER_RPC_URL` | `https://rpc.testnet.casper.live/rpc` | Casper testnet RPC |
| `CASPER_RPC_URL_FALLBACK` | `''` | Secondary RPC for failover |
| `CSPR_CLOUD_API_URL` | `https://api.testnet.cspr.cloud` | CSPR.cloud API |
| `CSPR_CLOUD_API_KEY` | `''` | Required for higher rate limits |
| `CASPER_CHAIN_NAME` | `casper-test` | Chain name for deploy signing |
| `CASPER_PAYMENT_RECIPIENT_PUBLIC_KEY` | `01010101...` | Key that receives x402 payments |
| `CASPER_CEP18_CONTRACT_HASH` | `null` | Used for x402 payment token validation |
| `CASPER_NETWORK` | `testnet` | `mainnet` for production |
| `BACKEND_URL` | `http://localhost:3000` | Self-referencing URL |
| `AGENT_BACKEND_URL` | `http://localhost:8000` | MCP server URL |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection |
| `LOG_LEVEL` | `info` | `debug` for troubleshooting |
| `TELEGRAM_WEBHOOK_URL` | `''` | Set for webhook mode (empty = long-poll) |
| `SENTRY_DSN` | `''` | Optional error tracking |
| `STRIPE_SECRET_KEY` | `''` | Optional billing |
| `STRIPE_DISABLED` | `''` | Set `1` to disable Stripe |
| `STRIPE_PRICE_PRO_MONTHLY` | `''` | Stripe price ID for pro tier |
| `STRIPE_WEBHOOK_SECRET` | `''` | Stripe webhook signing secret |
| `REFUND_ENABLED` | `true` | Auto-refund on failed tool execution |
| `METRICS_TOKEN` | `''` | Bearer token for `/metrics` |
| `METRICS_ALLOWED_CIDRS` | `''` | CIDRs allowed to scrape metrics |
| `GMAIL_USER` | `''` | Gmail address for email service |
| `GMAIL_APP_PASSWORD` | `''` | Gmail app password |
| `GROQ_API_KEY2` | `''` | Fallback Groq key |
| `GROQ_API_KEY3` | `''` | Fallback Groq key |
| `GEMINI_API_KEY` | `''` | Optional Gemini provider |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.05` | Sentry tracing rate |

### Rate limits (backend)

| Variable | Default | Description |
|---|---|---|
| `TOOL_LIMIT_FREE_PER_MIN` | `60` | Free-to-use tools |
| `TOOL_LIMIT_PAID_PER_MIN` | `20` | Paid (x402) tools |
| `TOOL_LIMIT_WRITE_PER_MIN` | `10` | Write tools (register_agent, etc.) |

---

## Frontend (`frontend/.env.local`)

### Must set for staging/production

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public, safe in client) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public, safe in client) |
| `NEXT_PUBLIC_AGENT_FACTORY_CONTRACT_HASH` | `hash-<64hex>` from deploy |
| `NEXT_PUBLIC_REPUTATION_CONTRACT_HASH` | `hash-<64hex>` |
| `NEXT_PUBLIC_ESCROW_CONTRACT_HASH` | `hash-<64hex>` |
| `NEXT_PUBLIC_COMPLIANCE_CONTRACT_HASH` | `hash-<64hex>` |
| `NEXT_PUBLIC_CEP18_CONTRACT_HASH` | `hash-<64hex>` |
| `NEXT_PUBLIC_PAYMENT_RECIPIENT_PUBLIC_KEY` | `01<64hex>` signer public key |

### Optional

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_CASPER_RPC_URL` | `https://rpc.testnet.casper.live/rpc` | Casper testnet RPC |
| `NEXT_PUBLIC_AGENT_BACKEND_URL` | `http://localhost:8080` | MCP server URL |
| `NEXT_PUBLIC_CSPRCLICK_APP_NAME` | `CasperOPs` | CSPR.click app display name |
| `NEXT_PUBLIC_CSPRCLICK_APP_ID` | `casperops` | CSPR.click app identifier |
| `NEXT_PUBLIC_SENTRY_DSN` | `''` | Optional error tracking |
| `NEXT_PUBLIC_AI_AGENT_BACKEND_URL` | `http://localhost:8000` | AI workflow backend |
| `NEXT_PUBLIC_AI_WORKFLOW_BACKEND_URL` | `http://localhost:8001` | AI workflow backend |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:3000` | Backend API URL |

---

## MCP Server (`n8n_agent_backend/.env`)

| Variable | Default | Required? |
|---|---|---|
| `GROQ_API_KEY1` | `''` | Yes (at least one) |
| `CSPR_CLOUD_API_URL` | `https://api.testnet.cspr.cloud` | Optional |
| `CSPR_CLOUD_API_KEY` | `''` | Optional |
| `CASPER_RPC_URL` | `https://rpc.testnet.casper.live/rpc` | Optional |
| `CASPER_REPUTATION_HASH` | `''` | No (but needed for reputation queries) |
| `CASPER_FAUCET_URL` | `https://testnet.cspr.live/tools/faucet` | Optional |
| `CASPER_EXPLORER_BASE_URL` | `https://testnet.cspr.live` | Optional |
| `REDIS_URL` | `redis://localhost:6379/0` | Optional |
| `POSTGRES_DSN` | `''` (falls back to DATABASE_URL) | Optional |
| `CASPEROPS_BACKEND_URL` | `http://localhost:3000` | Optional |
| `METRICS_TOKEN` | `''` | Optional |

---

## Docker Compose (`docker compose up`)

Passed automatically from host shell or `.env`:

| Variable | Default |
|---|---|
| `POSTGRES_USER` | `casperops` |
| `POSTGRES_PASSWORD` | `casperops` |
| `POSTGRES_DB` | `casperops` |
| All backend env vars above | — |
| All frontend vars prefixed `NEXT_PUBLIC_*` | — |

---

## Deploy checklist (minimal set)

### Vercel (frontend)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_AGENT_FACTORY_CONTRACT_HASH=
NEXT_PUBLIC_REPUTATION_CONTRACT_HASH=
NEXT_PUBLIC_ESCROW_CONTRACT_HASH=
NEXT_PUBLIC_COMPLIANCE_CONTRACT_HASH=
NEXT_PUBLIC_CEP18_CONTRACT_HASH=
NEXT_PUBLIC_PAYMENT_RECIPIENT_PUBLIC_KEY=
```

### Fly.io (backend)
```
NODE_ENV=production
CASPER_SECRET_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
CASPER_AGENT_FACTORY_HASH=
CASPER_REPUTATION_HASH=
CASPER_ESCROW_HASH=
CASPER_COMPLIANCE_HASH=
GROQ_API_KEY1=
TELEGRAM_BOT_TOKEN=
ADMIN_SECRET=
MASTER_API_KEY=
```

---

## Source of truth

- `backend/config/constants.js` — backend defaults
- `backend/middleware/validateEnv.js` — required-vs-optional rules
- `frontend/lib/contracts.ts` — frontend contract hash loading
- `n8n_agent_backend/validateEnv.py` — MCP env validation
- `.env.example` — full template with comments
