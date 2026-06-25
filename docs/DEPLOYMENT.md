# Production Deployment Runbook

This document covers shipping the BlockOps Casper stack to production.
The repo is built so each service runs in its own container with health
checks, env validation on boot, and a deployable unit per host.

> **Status:** Phase 24. All Dockerfiles, the compose stack, and the env
> validator are landed. The host-specific recipes below are written
> against the host's CLI at the time of writing; verify the commands
> against the current host docs before running.

---

## Architecture

```
                    ┌──────────────────────────────────┐
                    │  Cloudflare (DNS, DDoS, TLS, WAF)│
                    └──────────┬───────────────────────┘
                               │
              ┌────────────────┼─────────────────┐
              ▼                ▼                 ▼
        ┌──────────┐    ┌──────────┐      ┌──────────┐
        │ Frontend │    │ Backend  │      │ MCP      │
        │ Next.js  │    │ Express  │      │ FastAPI  │
        │ Vercel   │    │ Fly.io   │      │ Render   │
        │ :3000    │    │ :3000    │      │ :8080    │
        └──────────┘    └─────┬────┘      └────┬─────┘
                             │                │
              ┌──────────────┴──────┐  ┌──────┴────────────┐
              ▼                     ▼  ▼                   ▼
       ┌────────────┐         ┌──────────┐         ┌────────────┐
       │ Supabase   │         │ Postgres │         │ Redis      │
       │ (managed)  │         │ Supabase │         │ Upstash /  │
       │            │         │          │         │ Render KV  │
       └────────────┘         └──────────┘         └────────────┘
```

The three services are decoupled by URL:

- **Frontend** talks to the backend over HTTPS via `NEXT_PUBLIC_*` env
  vars baked into the build.
- **Backend** talks to Supabase (managed), the Casper RPC (public), and
  the MCP service over HTTPS.
- **MCP** talks to the backend (`BLOCKOPS_BACKEND_URL`) and to Redis +
  Postgres when configured.

---

## Prerequisites

Before deploying, make sure you have:

1. **Contract hashes** from a successful Phase 22 testnet run. The
   values fill `CASPER_AGENT_FACTORY_HASH`, `CASPER_REPUTATION_HASH`,
   `CASPER_ESCROW_HASH`, `CASPER_COMPLIANCE_HASH` on both backend and
   frontend.
2. **Server-side signer** — the 64-char hex `CASPER_SECRET_KEY` for any
   tool that signs on behalf of the user (register_agent, attest_agent,
   escrow_payout, etc.).
3. **Supabase project** with the Phase 11 schema applied
   (`supabase/migrations/20260622_casper_schema.sql`).
4. **AI provider keys** — at least one of `GROQ_API_KEY1`,
   `GROQ_API_KEY2`, `GROQ_API_KEY3`, `GEMINI_API_KEY`.
5. **CSPR.cloud API key** (optional but recommended for rate limits).
6. **Sentry DSNs** for both backend and frontend (optional).
7. **Domain** + Cloudflare in front of every service.

The `validateEnv()` middleware refuses to boot when any required var is
missing in production, so the deploy will fail loudly rather than
silently misbehaving.

---

## 1. Backend → Fly.io

Fly.io is a good fit for the Express backend because it supports Docker
images natively, has a `healthcheck` directive, and lets us pin a region
close to the Casper testnet/mainnet RPC.

### One-time setup

```bash
brew install flyctl          # or curl -L https://fly.io/install.sh | sh
fly auth signup              # or `fly auth login`
fly org create blockops      # if you don't have one yet
```

### Per-service files

The backend uses the `backend/Dockerfile` (multi-stage Node 20-alpine,
non-root, tini). The image listens on port 3000 by default (matches the
backend's `PORT=3000`).

### fly.toml

Create `backend/fly.toml` (not committed; one per environment):

```toml
app = "blockops-backend"
primary_region = "iad"   # close to Casper RPC

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"
  CASPER_RPC_URL = "https://rpc.testnet.casper.live/rpc"
  CSPR_CLOUD_API_URL = "https://api.testnet.cspr.cloud"
  CASPER_CHAIN_NAME = "casper-test"

[healthchecks]
  [[healthchecks.http]]
    path = "/health/ready"
    interval = "30s"
    timeout = "5s"
    grace_period = "20s"

[[services]]
  internal_port = 3000
  protocol = "tcp"
  auto_stop_machines = false   # backend should always be warm
  auto_start_machines = true

  [[services.ports]]
    port = 80
    handlers = ["http"]
    force_https = true

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

### Secrets

Set secrets via the Fly CLI — never commit them:

```bash
fly secrets set \
  CASPER_SECRET_KEY=$(cat backend/secrets/testnet-signer.hex) \
  CASPER_AGENT_FACTORY_HASH=hash-... \
  CASPER_REPUTATION_HASH=hash-... \
  CASPER_ESCROW_HASH=hash-... \
  CASPER_COMPLIANCE_HASH=hash-... \
  CSPR_CLOUD_API_KEY=... \
  GROQ_API_KEY1=... \
  GROQ_API_KEY2=... \
  GROQ_API_KEY3=... \
  GEMINI_API_KEY=... \
  SUPABASE_URL=https://xxxxx.supabase.co \
  SUPABASE_SERVICE_KEY=... \
  ADMIN_SECRET=$(openssl rand -hex 32) \
  MASTER_API_KEY=$(openssl rand -hex 32) \
  SENTRY_DSN=https://...@sentry.io/... \
  TELEGRAM_BOT_TOKEN=... \
  GMAIL_USER=... \
  GMAIL_APP_PASSWORD=...
```

### Deploy

```bash
fly deploy --config backend/fly.toml --dockerfile backend/Dockerfile
# or use the helper script: ./scripts/deploy-backend.sh
```

### Verify

```bash
fly status
curl https://blockops-backend.fly.dev/health/ready
# Expect: { "status": "ok", "kind": "ready", "requiredOk": true, ... }
curl https://blockops-backend.fly.dev/health/live
# Expect: { "status": "ok", "kind": "live", "uptimeMs": ... }
```

### Roll back

```bash
fly releases                              # list recent releases
fly releases rollback <version>           # roll back to a previous release
```

---

## 2. Frontend → Vercel

The Next.js frontend is the simplest to ship because Vercel knows the
framework.

### One-time setup

```bash
npm i -g vercel
vercel login
```

In the Vercel dashboard:

1. Import the repo.
2. Set the **Root Directory** to `frontend`.
3. Set the **Build Command** to `npm run build`.
4. Set the **Output Directory** to `.next` (default).
5. Set **Install Command** to `npm install --no-audit --no-fund`.

### Env vars

| Name | Notes |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public anon URL from Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `NEXT_PUBLIC_SENTRY_DSN` | Frontend Sentry DSN |
| `NEXT_PUBLIC_CASPER_RPC_URL` | Same as backend |
| `NEXT_PUBLIC_AGENT_FACTORY_HASH` | Deployed hash |
| `NEXT_PUBLIC_REPUTATION_HASH` | Deployed hash |
| `NEXT_PUBLIC_ESCROW_HASH` | Deployed hash |
| `NEXT_PUBLIC_COMPLIANCE_HASH` | Deployed hash |
| `NEXT_PUBLIC_AGENT_BACKEND_URL` | Public URL of the MCP service |
| `SENTRY_AUTH_TOKEN` | Vercel-only, for source-map upload |

### Deploy

```bash
vercel --prod
# or use the helper script: ./scripts/deploy-frontend.sh
```

The Dockerfile at `frontend/Dockerfile` is provided as an alternative for
self-hosting (e.g. on Fly.io or a bare-metal container host) but is not
used when deploying to Vercel.

### Custom domain

In Vercel: **Settings → Domains → Add** `app.blockops.in`. Vercel will
issue the Let's Encrypt cert automatically.

---

## 3. MCP server → Render

The MCP server is a long-running FastAPI process. Render is a good fit
because it supports Docker, sticky sessions (which SSE benefits from),
and a free Postgres tier.

> **Why not Fly.io?** Fly's edge networking is great for short-lived
> HTTP but the SSE transport we expose (`GET /mcp/sse`) wants sticky
> sessions — Render's Web Service tier supports this out of the box.

### One-time setup

1. Sign up at https://render.com.
2. Create a new **Web Service** from the `n8n_agent_backend/` directory.
3. Set **Runtime** to `Docker`.
4. Set **Health Check Path** to `/health`.

### Env vars

| Name | Notes |
|------|-------|
| `BLOCKOPS_BACKEND_URL` | Public URL of the backend (e.g. `https://blockops-backend.fly.dev`) |
| `CASPER_RPC_URL` | Same as backend |
| `CSPR_CLOUD_API_URL` | Same as backend |
| `CSPR_CLOUD_API_KEY` | Optional |
| `GROQ_API_KEY1` | Primary AI key |
| `GROQ_API_KEY2` | Optional |
| `GROQ_API_KEY3` | Optional |
| `GEMINI_API_KEY` | Optional |
| `CASPER_REPUTATION_HASH` | For `get_reputation` |
| `CASPER_AGENT_FACTORY_HASH` | Optional |
| `CASPER_ESCROW_HASH` | Optional |
| `CASPER_COMPLIANCE_HASH` | Optional |
| `REDIS_URL` | Render Key-Value or Upstash URL |
| `POSTGRES_DSN` | Render Postgres URL or Supabase |

### Deploy

Push to `main` triggers an auto-deploy once you've connected the repo.
Manual:

```bash
# In the Render dashboard: Manual Deploy → Deploy latest commit
# or use the helper script: ./scripts/deploy-mcp.sh
```

### Verify

```bash
curl https://blockops-mcp.onrender.com/health
# Expect: { "status": "ok", "service": "blockops-mcp", "tools": 19 }

curl https://blockops-mcp.onrender.com/mcp/tools | jq '.tools | length'
# Expect: 19
```

---

## 4. Local end-to-end smoke

Before merging any change that touches deployment, verify the local
`docker compose` stack still works:

```bash
cp .env.example .env       # edit secrets
docker compose up -d --build
docker compose ps          # all 5 services healthy
docker compose logs -f backend | grep "🚀 BlockOps"

# Probe the running stack
curl http://localhost:3000/health/ready
curl http://localhost:3001/
curl http://localhost:8080/health
```

Run the test suites against the containerized stack:

```bash
docker compose exec backend  npm run test:unit
docker compose exec frontend npm test
docker compose exec mcp      python -m unittest __tests__.test_smoke
```

Tear down:

```bash
docker compose down -v      # -v also wipes the named volumes
```

---

## 5. Rollback procedure

If a deploy breaks something:

1. **Backend** — `fly releases rollback <version>`. Verify with
   `curl https://blockops-backend.fly.dev/health/ready`.
2. **Frontend** — Vercel keeps every deploy; **Deployments → Promote
   previous** in the dashboard.
3. **MCP** — Render keeps the previous image as "Rollback" in the
   **Events** tab.
4. **Contracts** — Casper contracts are immutable; rollback means
   deploying a new version of the contract and pointing `backend/.env`
   at the new hash. Document the new hash in `docs/testnet-validation.md`.

---

## 6. Disaster recovery checklist

| Incident | First action |
|----------|--------------|
| Deploy fails health check | `fly logs` / `vercel logs` / Render **Logs** — look for the `[validateEnv]` boot banner |
| RPC outage | The backend probes `/health/ready` returns 503; deploy a build with `CASPER_RPC_URL` pointed at a backup (CSPR.cloud has a JSON-RPC fallback) |
| Sentry spike | `https://sentry.io/organizations/blockops/issues/` — check whether the spike correlates with a deploy |
| Stuck deploy (pending) | Casper deploys may take 90 s to finalize. The frontend polls RPC; the toast should transition automatically. If it doesn't, link the user to https://testnet.cspr.live/deploy/<hash> |
| Bot Telegram 502 | The webhook is at `POST /telegram/webhook` (public, no API key). Re-set the webhook with `curl -F "url=https://blockops-backend.fly.dev/telegram/webhook" https://api.telegram.org/bot<TOKEN>/setWebhook` |

---

## 7. Post-deploy verification

Run through this checklist for **every** deploy:

- [ ] `curl -fsS https://<backend>/health/ready` → `requiredOk: true`
- [ ] `curl -fsS https://<backend>/v1/tools | jq '.count'` → 19
- [ ] `curl -fsS https://<mcp>/health` → `status: ok`
- [ ] Frontend: open `/` in a browser, connect CSPR.click, send one paid
      tool call end-to-end, verify the deploy hash surfaces in the toast
- [ ] Sentry: confirm the deploy release was tagged (`@sentry/nextjs`
      auto-tags)
- [ ] Update `docs/testnet-validation.md` with the deploy timestamp + any
      gotchas observed during boot
- [ ] Announce the deploy in `#deploys` with the new versions / commit
      hashes / contract hashes (if any)

---

## 8. Cost & sizing

This stack is small enough to run on free tiers:

| Service | Free tier | Recommended |
|---------|-----------|-------------|
| Fly.io backend | 3 shared VMs (256 MB each) | `shared-cpu-1x` (1 GB) × 1 instance |
| Vercel frontend | 100 GB bandwidth / mo | Pro for >100 GB |
| Render MCP | Free web service (sleeps after 15 min idle) | Starter ($7/mo) for always-on |
| Supabase | 500 MB DB, 2 GB bandwidth | Pro ($25/mo) for prod |
| Upstash Redis | 10k requests / day | Pay-as-you-go |
| Sentry | 5k events / mo | Team ($26/mo) for >50k |

Estimated **$40/mo** for low traffic (under 100 paid tool calls / day).
Scale up: add Fly.io instances horizontally (stateless), upgrade
Postgres + Redis, raise Render to Standard.

---

## 9. References

- Phase 22 live-testnet runbook: `docs/testnet-validation.md`
- Contract source: `contract/`
- Dockerfiles: `backend/Dockerfile`, `frontend/Dockerfile`, `n8n_agent_backend/Dockerfile`
- Compose: `docker-compose.yml`
- Env validator: `backend/middleware/validateEnv.js`, `n8n_agent_backend/validateEnv.py`