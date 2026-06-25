# CasperOPs Incident Response Runbook

This runbook covers the **top 8 incidents** the CasperOPs Casper stack
is expected to encounter in production. Each incident has:

- **Symptoms** — how you'll notice it (alert / dashboard / user report)
- **Diagnosis** — the first 60 seconds of investigation
- **Mitigation** — the fastest path to a green state
- **Follow-up** — what to capture in the post-incident doc

For component status, dependency map, and what's where, see
[`STATUS.md`](./STATUS.md). For alert configuration see
[`OPERATIONS.md`](./OPERATIONS.md).

> **On-call checklist (always):**
> 1. Open the relevant Grafana dashboard (`casperops-backend` / `casperops-mcp`)
> 2. Check the last deploy timestamp (deploys within the last 30 min are
>    the leading cause of fresh incidents)
> 3. Check Sentry for the matching error spike
> 4. Check Casper / CSPR.cloud status (testnet.cspr.live, status.cspr.live)
> 5. If it's a deploy rollback, follow §9 "Rollback a deploy" below

---

## 1. Deploy stuck pending > 5 minutes

**Symptoms**
- Sentry alert: "Deploy stuck pending > 5 min"
- User report: "I signed the payment but my tool never ran"
- Grafana: `rate(casperops_deploy_stuck_total[5m]) > 0`

**Diagnosis**
1. Grab the deploy hash from the Sentry alert or from the user's
   request id (`X-Request-Id`).
2. Run `info_get_deploy` against Casper RPC:
   ```bash
   curl -s -X POST https://rpc.testnet.casper.live/rpc \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"info_get_deploy",
          "params":{"deploy_hash":"<hash>"}}' | jq .
   ```
3. Check whether the deploy is `pending`, `unknown`, or has an
   `execution_results` entry.
4. Cross-reference with CSPR.cloud: `https://api.testnet.cspr.cloud/deploys/<hash>`.

**Mitigation**
- **Pending forever (RPC never picked it up):** the deploy was lost.
  Trigger the refund middleware (`POST /v1/tools/<toolId>` with the
  same payment deploy hash will re-broadcast the refund automatically
  on the next 5xx). Manually re-broadcast if needed:
  ```bash
  curl -X POST $CASPER_RPC_URL \
    -d @deploy.json -H 'content-type: application/json'
  ```
- **Unknown:** RPC node dropped it. Switch the deploy to the
  secondary RPC via `CASPER_RPC_URL` env var on the backend (no
  restart needed if you have a hot-reload hook; otherwise restart
  with `flyctl deploy` / Render redeploy).
- **Executed with error:** the deploy landed but failed. Check the
  contract entry point args — most "stuck pending" cases are
  actually `error: exit code 1` after 5 min.

**Follow-up**
- Add deploy hash + final state to the post-incident doc.
- If the refund didn't fire automatically, audit the
  `x402_refunds_total{status="failed"}` counter — the refund
  middleware swallowed the broadcast error.

---

## 2. MCP SSE connection drops

**Symptoms**
- User report: "My LangGraph agent disconnected"
- Grafana: `casperops_mcp_active_sessions` goes to 0 unexpectedly
- Sentry: spike in `client_disconnect` errors on `/mcp/sse`

**Diagnosis**
1. Check the MCP server logs for `event_generator` clean-up errors.
2. Verify Redis (`mcp:sse:*`) — if Redis flushed, all pending results
   in the durable queue are gone (the in-memory queue only lasts as
   long as the server process).
3. Test a fresh SSE connection:
   ```bash
   curl -N https://mcp.casperops.example/mcp/sse
   ```
   You should see `event: ready` then periodic `event: ping`.

**Mitigation**
- **Server restart needed:** `flyctl restart` / Render redeploy.
  In-memory SSE queues are dropped; durable results in Redis are
  preserved.
- **Redis flushed:** warn users that pending tool results are gone;
  the agent must re-call.
- **Stuck sessions in Redis (`mcp:active_sessions` has phantom ids):**
  ```
  redis-cli DEL mcp:active_sessions
  ```
  Then have users reconnect.

**Follow-up**
- Add a max-queue-age TTL test to the smoke suite so this is caught
  in CI next time.
- Consider promoting `mcp:active_sessions` from a set to a sorted
  set with a TTL on each member (Phase 27 follow-up).

---

## 3. Redis flush during deploy

**Symptoms**
- Sentry: `redis.flushdb` or `redis.flushall` events
- Spike in `redis.connection_error` log lines
- `/health/ready` starts returning 503 (Redis is a "nice to have"
  check, but readiness degrades)

**Diagnosis**
1. Check the Redis provider dashboard — most managed Redis services
   show the flush command in their audit log.
2. Check the deploy script — `scripts/deploy-backend.sh` should
   never run `FLUSHDB`. If it does, that's a bug to file.
3. If a contributor manually flushed, check git log for any
   `redis-cli` calls in the last 24h.

**Mitigation**
- The backend + MCP server are designed to **survive Redis loss**
  without a restart: both log warnings and fall back to in-memory
  state. So the only mitigation needed is:
  - Wait for the readiness probe to recover (`mcp:active_sessions`
    repopulates as agents reconnect).
  - Tell users their tool-call history is gone (the
    `mcp_tool_calls` Postgres table is unaffected; only the Redis
    short-term state was lost).
- If you have backups, restore — but understand this also wipes
  any in-flight data.

**Follow-up**
- Enable Redis persistence (RDB + AOF) on the managed provider if
  not already on.
- Add a `redis.flush` audit event to the runbook list.

---

## 4. RPC node outage (failover)

**Symptoms**
- Sentry alert: "RPC p95 > 3 s" sustained 5 min
- User report: "Tool calls hanging"
- Grafana: `histogram_quantile(0.95, casperops_rpc_call_duration_seconds)`
  climbs above 3 s

**Diagnosis**
1. Check `https://testnet.cspr.live` and `https://status.cspr.live`.
2. Curl the configured RPC directly:
   ```bash
   curl -s -X POST $CASPER_RPC_URL \
     -d '{"jsonrpc":"2.0","id":1,"method":"info_get_status"}' | jq .
   ```
3. Check CSPR.cloud — they proxy the same RPCs and sometimes the
   RPC provider outage doesn't affect the proxy.

**Mitigation**
- **Switch to backup RPC:** update `CASPER_RPC_URL` in the host
  env store. For Fly.io:
  ```bash
  flyctl secrets set CASPER_RPC_URL=https://rpc2.testnet.casper.live/rpc
  flyctl deploy
  ```
- **CSPR.cloud fallback:** if the public RPC is down but CSPR.cloud
  is up, the read tools (`get_balance`, `get_token_balance`) keep
  working because they use `cspr.cloud` first. Writes still depend
  on the public RPC.
- **Failover to mainnet temporarily:** only for paid tools where the
  user is willing to pay mainnet CSPR — usually not worth it.

**Follow-up**
- File an issue with the RPC provider.
- Add a secondary RPC env var (`CASPER_RPC_URL_FALLBACK`) and a
  small in-process retry/failover loop (Phase 27 candidate).

---

## 5. x402 payment stuck (no retry)

**Symptoms**
- User report: "I signed the deploy but my tool never ran"
- Sentry: spike in `casperops_x402_challenges_total` but no
  corresponding `casperops_tool_executions_total{status="ok"}`
- The X-Casper-Payment-Deploy-Hash header is in the request but
  the tool still returned 402

**Diagnosis**
1. Ask the user for the deploy hash + the X-Request-Id from the
   402 response.
2. Look up the deploy on CSPR.cloud — was it actually executed?
3. Check the verify middleware logs for that request id:
   ```
   grep "<request-id>" backend-logs
   ```
4. Common root causes:
   - The payment deploy was for a **different chain** (mainnet vs
     testnet). Look at `chainName` in the 402 challenge body.
   - The recipient public key on the deploy doesn't match the
     configured `CASPER_PAYMENT_RECIPIENT_PUBLIC_KEY`.
   - The amount was under `priceMotes` (treasury rejected it).

**Mitigation**
- Tell the user to retry with the **same** deploy hash on the
  correct chain. The backend will re-verify and proceed.
- If the chain mismatch is on our side (env var typo), fix the
  env var and `flyctl deploy`. Past failed payments will need a
  manual refund — see §1.

**Follow-up**
- Add a startup log line that prints
  `CASPER_PAYMENT_RECIPIENT_PUBLIC_KEY` (truncated to first 8
  chars) so operators can spot a typo immediately.

---

## 6. Sentry spike

**Symptoms**
- Sentry: any incident alert, "issue spike" alert
- Slack: #casperops-oncall notification

**Diagnosis**
1. Open the Sentry issue page.
2. Sort by `frequency` — most spikes are one or two recurring
   exceptions, not a thousand unique ones.
3. Check `tags`: `release`, `environment`, `transaction`,
   `requestId`. The request id is the most useful — it links back
   to backend logs and the original user's tool call.
4. Pull the matching log line:
   ```bash
   grep "<request-id>" <log-store-query>
   ```

**Mitigation**
- **Spike is post-deploy:** rollback per §9.
- **Spike is from a single user's bad input:** add a denylist /
  validation rule to reject the input earlier (cheaper than letting
  it cascade).
- **Spike is a third-party API:** see §4 (RPC) or §7 (Supabase).

**Follow-up**
- Add a regression test that asserts the exception is NOT thrown.
- File a "should we redesign this codepath?" note for next sprint.

---

## 7. Supabase rate limit hit

**Symptoms**
- Sentry: `429` from Supabase, with `retry-after` header
- User report: "Save failed"
- Grafana: spike in `casperops_http_requests_total{status_code="429",route="/agents"}`

**Diagnosis**
1. Open the Supabase dashboard → API → Logs.
2. Sort by `rate-limited` events.
3. Check if a single API key is hammering an endpoint (likely
   cause: a runaway cron job or a single test suite looping).

**Mitigation**
- **Single key hammering:** rotate the key, then ban it via the
  dashboard.
- **Legitimate burst:** bump the Supabase plan tier. The free tier
  caps at 500 MB egress + 2 GB storage; the Pro plan lifts that.
- **Code-side throttle:** temporarily tighten
  `backend/middleware/rateLimiter.js` for the affected endpoint
  via env override.

**Follow-up**
- Add per-API-key rate limiting (Phase 29 work) so a single bad
  actor can't starve the rest.

---

## 8. Telegram bot webhook 502

**Symptoms**
- User report: "Bot not responding"
- Sentry: spike in `casperops_http_requests_total{status_code="502",route="/telegram/webhook"}`
- Telegram dashboard: webhook deliveries failing

**Diagnosis**
1. Check the backend logs for the webhook handler — is it throwing
   or returning 502 deliberately?
2. Check Telegram's webhook status:
   `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
3. Verify the webhook URL matches the deployed backend URL — a
   stale URL is the most common cause.

**Mitigation**
- **Stale URL:** re-register via:
  ```bash
  curl -F "url=https://api.casperops.example/telegram/webhook" \
       https://api.telegram.org/bot<TOKEN>/setWebhook
  ```
- **Backend returning 502:** this is a bug — the bot always
  responds 200 quickly, so 502 means an exception in the handler.
  Look at the stack trace in Sentry.
- **Telegram itself is down:** wait. Status at
  `https://status.telegram.org`.

**Follow-up**
- Add a daily cron that runs `getWebhookInfo` and alerts if the
  URL doesn't match `BACKEND_PUBLIC_URL`.

---

## 9. Rollback a deploy

**When to use**
- A fresh deploy caused a regression within the last 30 min
- Sentry spike correlates 1:1 with deploy timestamp
- New deploy broke the readiness probe

**How**

### Fly.io (backend)
```bash
flyctl releases                # note the previous release number
flyctl releases rollback v<previous>
```

### Render (MCP)
Render has no instant rollback for `service.deploy` events. Use
the "Redeploy" button on the previous commit; it takes ~2 min.

### Vercel (frontend)
Vercel dashboard → Deployments → Promote a previous deployment to
production. Takes ~30 s.

### Docker Compose (local / staging)
```bash
git checkout <previous-sha>
docker compose up -d --build backend
```

**After rollback**
1. Confirm Sentry issue rate drops back to baseline.
2. Confirm Grafana dashboards show normal latency + traffic.
3. File the post-mortem doc **before** the day ends.

---

## 10. Post-incident checklist

Within 24 hours of resolution:

- [ ] Post-incident doc written (root cause + timeline + action items)
- [ ] Regression test added (or filed in the next sprint)
- [ ] If the incident exposed a missing alert, add the alert
- [ ] If the incident required manual SQL / SSH, automate it
- [ ] Customer-facing status update sent (see [`STATUS.md`](./STATUS.md))
- [ ] Calendar invite for the post-mortem review (if P0/P1)

Post-mortems are blameless. Focus on systems + signals, not people.