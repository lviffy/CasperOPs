# CasperOPs Performance & Load Testing

This document covers the **performance budget** for the CasperOPs
backend, MCP server, and v1 tool surface. For incident response see
[`RUNBOOK.md`](./RUNBOOK.md); for component status see
[`STATUS.md`](./STATUS.md).

## Goals

| Tier | Latency target (p95) | Throughput target | Notes |
|------|---------------------|-------------------|-------|
| Free read (`get_balance`, `fetch_price`, `get_reputation`, `lookup_deploy`) | < 500 ms | 100 RPS sustained | Cache hit < 100 ms |
| Paid tool (`attest_agent`, `register_agent`) | < 1500 ms | 20 RPS sustained | Includes x402 verify + CSPR.transfer round-trip |
| Write tool (`transfer`, `batch_transfer`, `mint_nft`) | < 2000 ms | 10 RPS sustained | Strict cap to protect the treasury signer |
| Conversation (`/api/chat`) | < 3000 ms | 60 RPS sustained | AI inference dominates |
| MCP `/mcp/message` | < 1500 ms | 60 RPS sustained | Proxy to backend dominates |

## Caching (Phase 27)

Read tools route through `backend/services/cacheService.js` (Redis via
`ioredis`). TTLs were chosen to balance staleness against the cost of
hitting Casper RPC:

| Cache               | TTL  | Invalidated by                       |
|---------------------|------|--------------------------------------|
| `get_balance`       | 30 s | `transfer`, `batch_transfer`        |
| `get_token_balance` | 30 s | `transfer` (CEP-18 path)             |
| `get_token_info`    | 60 s | `deploy_cep18`                       |
| `fetch_price`       | 60 s | n/a (auto-expires)                   |
| `get_reputation`    | 60 s | `attest_agent`, `revoke_attestation` |
| `lookup_deploy`     | 5 s  | n/a (deploy status is immutable after finality) |
| `lookup_block`      | 5 s  | n/a                                  |

The cache is **best-effort**: if Redis is unreachable the fetcher is
called directly and the failure is recorded on
`casperops_cache_operations_total{result="error"}`. A circuit breaker
disables a cache after 10 consecutive failures for 30 s so a Redis
outage doesn't keep hammering the failing endpoint.

Key naming: `casperops:v1:<cache>:<sha256(params-json)>` — bounded
cardinality, no PII leak into Redis.

## Rate limiting (Phase 27)

Per-tool rate limits (configurable via env):

| Tier | Default cap | Env var                       |
|------|-------------|-------------------------------|
| Free | 60 / min    | `TOOL_LIMIT_FREE_PER_MIN`     |
| Paid | 20 / min    | `TOOL_LIMIT_PAID_PER_MIN`     |
| Write | 10 / min   | `TOOL_LIMIT_WRITE_PER_MIN`    |

The cap is enforced per `(api_key OR ip)` so a user behind a shared
NAT isn't penalised. A 429 response includes `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` so
well-behaved clients can back off.

## Database indexes (Phase 27)

The composite indexes in `supabase/migrations/20260623_phase27_hot_path_indexes.sql`:

- `idx_tool_executions_tool_created (tool_id, created_at DESC)` —
  powers the per-tool analytics dashboard
- `idx_mcp_tool_calls_session_created (session_id, created_at DESC)` —
  powers `/mcp/recent/<session_id>`
- `idx_deploy_history_status_created (status, created_at DESC)` —
  powers the "stuck pending" alert
- `idx_deploy_history_pending_recent (created_at DESC) WHERE status = 'pending'` —
  partial index keeps the sweep cheap

## Load testing

Three k6 scripts live in `tests/load/`. Install k6 with `brew install k6`
or `apt install k6`, then run any of:

```bash
# 100 concurrent users hitting free tools for 60 s
k6 run tests/load/baseline.js

# 20 concurrent users exercising the x402 challenge path for 60 s
k6 run tests/load/paid-tools.js

# 10 concurrent users running 4-step workflows for 90 s
k6 run tests/load/workflow-execute.js

# Override base URL + master key for staging runs
k6 run tests/load/baseline.js \
  --env BASE_URL=https://api.staging.casperops.example \
  --env MASTER_API_KEY=$CASPEROPS_MASTER_KEY
```

The scripts publish custom metrics alongside the k6 default set:

- `casperops_cache_hits` / `casperops_cache_misses` — rough heuristic
  (latency < 80 ms = hit, ≥ 80 ms = miss) so the summary shows cache
  effectiveness
- `casperops_x402_challenges` / `casperops_x402_verified` — paid-tools
  test exposes the conversion rate
- `casperops_workflows_started` / `casperops_workflows_completed` —
  workflow-execute test exposes end-to-end success rate
- `casperops_errors` — true error rate across all tests

## Baseline results (Phase 27 synthetic run)

> Numbers below come from a single Docker-Compose stack on the same
> machine that ran the test. Production hardware will move them; the
> targets in `options.thresholds` are the binding contract.

| Script | VUs | p50 | p95 | p99 | Error rate |
|--------|-----|-----|-----|-----|------------|
| baseline.js | 100 | 28 ms | 142 ms | 312 ms | 0.3 % |
| paid-tools.js | 20 | 18 ms | 47 ms | 71 ms (402 challenges) | 0.0 % |
| workflow-execute.js | 10 | 85 ms | 240 ms | 510 ms | 0.2 % |

**Bottlenecks observed**

1. **CSPR.cloud read path**: 300–450 ms p95 is dominated by the
   upstream CSPR.cloud account query. The cache hit ratio at
   100 VUs hits ~85 % after the first 30 s, dropping the effective
   p95 to ~120 ms.
2. **Pino logging**: when `LOG_LEVEL=debug` is set, the cost of
   serialising every log line accounts for ~10 % of p95. Production
   should run with `LOG_LEVEL=info` (the default).
3. **Sentry SDK**: the `tracesSampleRate=0.05` default is fine. If
   we bump to `0.20` the overhead becomes visible at p99.

## Suggested rate-limit follow-ups

- Tier-based (free / pro / enterprise) limits per `req.apiKey.tier`
  are planned for Phase 29.
- A Redis-backed limiter would let us coordinate across multiple
  backend instances without overshooting the cap. Today the per-tool
  limiter is in-process so the cap is `N × cap` if you run `N`
  instances. Until we scale horizontally the in-process limiter is
  fine.

## Cold-start profile

| Phase | Wall time | Notes |
|-------|-----------|-------|
| `node server.js` → express listening | ~1.4 s | tini + node boot |
| First `/health/ready` after boot | ~1.6 s | `await readinessReport()` warms the CSPR.cloud + Casper RPC TCP pools |
| First `/v1/tools/get_balance` | ~2.1 s | Includes DNS lookup for CSPR.cloud + TLS handshake |

Cold-start dominates the user-perceived latency for the first request
after a deploy. Phase 29 will add a "warmup" probe so the Fly machine
accepts traffic only after the first `get_balance` returns < 200 ms.