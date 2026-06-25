# CasperOPs Operations Runbook

This document covers the **observability stack** that backs the CasperOPs
backend + MCP server: Sentry alert rules, uptime monitoring, and the
structured log shipping pipeline. For incident response procedures see
[`RUNBOOK.md`](./RUNBOOK.md); for the public component status page see
[`STATUS.md`](./STATUS.md).

---

## 1. Metrics endpoints

Both services expose Prometheus-format `/metrics`:

| Service    | URL                                                | Auth                            |
|------------|----------------------------------------------------|---------------------------------|
| Backend    | `https://api.casperops.example/metrics`             | `METRICS_TOKEN` + CIDR allowlist |
| MCP        | `https://mcp.casperops.example/metrics`             | `METRICS_TOKEN` (optional)       |

### Backend scrape configuration

```yaml
# prometheus.yml
scrape_configs:
  - job_name: casperops-backend
    metrics_path: /metrics
    scheme: https
    authorization:
      type: Bearer
      credentials: ${env:METRICS_TOKEN}
    static_configs:
      - targets: [api.casperops.example]
  - job_name: casperops-mcp
    metrics_path: /metrics
    scheme: https
    authorization:
      type: Bearer
      credentials: ${env:METRICS_TOKEN}
    static_configs:
      - targets: [mcp.casperops.example]
```

### Series catalogue (backend)

| Series | Type | Labels | Meaning |
|--------|------|--------|---------|
| `casperops_http_requests_total` | counter | `method`, `route`, `status_code` | Every request handled |
| `casperops_http_request_duration_seconds` | histogram | `method`, `route`, `status_code` | Request latency |
| `casperops_tool_executions_total` | counter | `tool_id`, `kind`, `status` | v1 tool runs (`status` ∈ `ok`/`error`/`x402`) |
| `casperops_tool_duration_seconds` | histogram | `tool_id`, `kind` | Per-tool wall-clock time |
| `casperops_x402_challenges_total` | counter | `tool_id`, `tier` | 402 challenges emitted |
| `casperops_x402_refunds_total` | counter | `tool_id`, `status` | Refund deploy outcomes |
| `casperops_cache_operations_total` | counter | `cache`, `op`, `result` | Reserved for Phase 27 Redis |
| `casperops_deploy_stuck_total` | counter | `tool_id` | Deploys stuck past SLA |
| `casperops_active_sessions` | gauge | — | Mirrored MCP SSE sessions |
| `casperops_rpc_call_duration_seconds` | histogram | `method`, `result` | Casper RPC + CSPR.cloud calls |
| `casperops_node_*` | various | — | Default `prom-client` process / GC / event-loop |

### Series catalogue (MCP)

| Series | Type | Labels | Meaning |
|--------|------|--------|---------|
| `casperops_mcp_tool_calls_total` | counter | `tool_name`, `kind`, `status` | Tool invocations |
| `casperops_mcp_tool_latency_seconds` | histogram | `tool_name`, `kind` | Dispatch latency |
| `casperops_mcp_active_sessions` | gauge | — | Currently-open SSE sessions |
| `casperops_mcp_session_messages_total` | counter | `kind` (`inbound`/`outbound`) | JSON-RPC traffic |
| `casperops_mcp_backend_proxy_duration_seconds` | histogram | `tool_name`, `result` | Proxy round-trips |
| `casperops_mcp_rpc_call_duration_seconds` | histogram | `method`, `result` | Direct RPC + CSPR.cloud calls |

---

## 2. Sentry alert rules

Configure these in Sentry → Alerts → "Metric Alerts" or "Issue Alerts"
depending on the trigger type. PagerDuty / Slack integration should route
to `#casperops-oncall`.

### 2.1 5xx rate > 1% over 5 minutes

```
Type:        Metric Alert (backend series)
Query:       sum(rate(casperops_http_requests_total{status_code=~"5.."}[5m]))
             /
             sum(rate(casperops_http_requests_total[5m]))
Threshold:   > 0.01 (1 %)
Window:      5 min
Severity:    P3
Notify:      #casperops-oncall, PagerDuty (low)
```

### 2.2 Deploy stuck pending > 5 minutes

```
Type:        Metric Alert
Query:       rate(casperops_deploy_stuck_total[5m]) > 0
Threshold:   any increase
Window:      5 min
Severity:    P2
Notify:      #casperops-oncall, PagerDuty (high)
Runbook:     RUNBOOK.md §1
```

### 2.3 RPC call latency p95 > 3 s

```
Type:        Metric Alert
Query:       histogram_quantile(0.95,
                sum(rate(casperops_rpc_call_duration_seconds_bucket[5m])) by (le, method))
Threshold:   > 3
Window:      5 min
Severity:    P3
Notify:      #casperops-oncall
Runbook:     RUNBOOK.md §4
```

### 2.4 Redis connection errors > 10/min

Sentry does not natively scrape Redis. Wire this as an alert on the
`error` field of structured logs:

```
Type:        Issue Alert (Sentry)
Filter:      logger == "casperops-backend" AND msg contains "redis" AND level == "error"
Threshold:   > 10 in 1 min
Window:      1 min
Severity:    P3
Runbook:     RUNBOOK.md §3
```

### 2.5 (Recommended) Tool execution error spike

```
Type:        Metric Alert
Query:       sum(rate(casperops_tool_executions_total{status="error"}[5m]))
             /
             sum(rate(casperops_tool_executions_total[5m]))
Threshold:   > 0.10 (10 %)
Window:      5 min
Severity:    P3
```

---

## 3. Uptime monitoring

Use Better Stack (formerly Better Uptime) or UptimeRobot — both have
generous free tiers and Slack / PagerDuty integrations.

### Components

| Component        | URL                                          | Probe interval | Timeout |
|------------------|----------------------------------------------|----------------|---------|
| Backend live     | `https://api.casperops.example/health/live`   | 30 s           | 5 s     |
| Backend ready    | `https://api.casperops.example/health/ready`  | 60 s           | 10 s    |
| MCP server       | `https://mcp.casperops.example/health`        | 30 s           | 5 s     |
| Frontend         | `https://casperops.example/`                  | 60 s           | 10 s    |

`/health/ready` is the canonical "is the backend safe to take
traffic?" probe. Configure uptime checks to alert when it returns
**non-200 for 2 consecutive probes** (avoids flapping during a brief
Supabase hiccup).

### Credentials

Store monitoring API keys in the team password manager under
`CasperOPs / Monitoring`. The README in this repo intentionally does
not include live tokens.

---

## 4. Structured log shipping

The backend uses **pino** with `redact` paths for secrets, writing
sync to fd 1 (stdout) so Docker / Fly / Render can pick the stream up
without a transport worker thread. Recommended destinations:

### 4.1 Logflare (recommended for Render / Fly)

```bash
# .env on the host
LOGFLARE_SOURCE_TOKEN=<source-token>
LOGFLARE_API_KEY=<api-key>
```

Render / Fly automatically tail container stdout to Logflare when the
integration is installed; no extra config needed beyond env vars.

### 4.2 Loki (self-hosted)

```yaml
# promtail-config.yaml
scrape_configs:
  - job_name: casperops
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
    relabel_configs:
      - source_labels: ['__meta_docker_container_label_com_docker_compose_service']
        regex: .+
        action: keep
    pipeline_stages:
      - json:
          expressions:
            level: level
            time: time
            msg: msg
            requestId: requestId
      - labels:
          level:
```

### 4.3 Datadog

```yaml
# datadog-agent.yaml
logs:
  - type: docker
    service: casperops-backend
    source: nodejs
    path: /var/lib/docker/containers/*/*.log
    exclude_paths:
      - /var/lib/docker/containers/*/*.log
    log_processing_rules:
      - type: include_at_match
        name: include_casperops
        pattern: '"service":"casperops-backend"'
```

### 4.4 JSON log shape

Every line written by pino is a single-line JSON object:

```json
{
  "level": 30,
  "time": 1748200000000,
  "pid": 17,
  "hostname": "casperops-backend-7d4b",
  "service": "casperops-backend",
  "requestId": "8b3e1d2f-7c4a-4a59-b6e2-3e8e2c2d5d44",
  "toolId": "transfer",
  "msg": "request completed",
  "method": "POST",
  "url": "/v1/tools/transfer",
  "status": 200,
  "durationMs": 412
}
```

### 4.5 Recommended label set

When shipping to a structured store, parse the JSON and apply these
labels for queryability:

| Label        | Source field   | Use                              |
|--------------|----------------|----------------------------------|
| `service`    | `service`      | `casperops-backend` / `casperops-mcp` |
| `level`      | `level`        | `info`/`warn`/`error`/`debug`    |
| `requestId`  | `requestId`    | Trace a single request           |
| `toolId`     | `toolId`       | Filter to a single tool          |
| `route`      | `url` (path)   | Endpoint traffic analysis        |
| `status`     | `status`       | Filter 5xx errors quickly        |

The redactor (see `backend/utils/logger.js`) strips the following
fields before logging: `privateKey`, `secret`, `jwt`, `authorization`,
and any `X-Casper-Payment-Deploy-Hash` header. **Never** disable the
redactor in production — payment deploy hashes are bearer-equivalent.

---

## 5. Diag endpoint (admin-gated)

`GET /health/diag` returns a JSON dump of:

- Node version, PID, cwd, NODE_ENV
- App + dependency versions
- **Presence** (not values) of every environment variable
- Chain config (`casper-test` etc.) + RPC URLs
- Last deploy + last migration timestamps (read from `.last-deploy.json`
  and `.last-migration.json` written by the deploy scripts)

Auth: `Authorization: Bearer <ADMIN_SECRET>` OR `x-api-key: <MASTER_API_KEY>`.
When neither env var is set the endpoint refuses to respond (503).

Use it to triage without SSH'ing onto the box:

```bash
curl -fsS -H "Authorization: Bearer $ADMIN_SECRET" \
  https://api.casperops.example/health/diag | jq .
```

---

## 6. Dashboards

Recommended Grafana dashboard panels (one dashboard for backend, one
for MCP):

1. **HTTP traffic** — `rate(casperops_http_requests_total[1m])` stacked by `route`
2. **Latency heatmap** — `histogram_quantile(0.95, …)` per route
3. **Tool mix** — `casperops_tool_executions_total` pie by `tool_id`
4. **x402 conversion** — ratio of challenges → verified payments
5. **Refunds** — `casperops_x402_refunds_total` stacked by `status`
6. **Active MCP sessions** — `casperops_mcp_active_sessions`
7. **RPC p95** — `histogram_quantile(0.95, …)` per Casper RPC method
8. **Deploy stuck** — `rate(casperops_deploy_stuck_total[5m])`

Import the JSON dashboards in `infra/grafana/` (added in a future
phase) once they're committed.

---

## 7. SLOs (suggested starting points)

| SLI                              | SLO target        | Error budget (30d) |
|----------------------------------|-------------------|--------------------|
| Backend HTTP availability        | 99.9 %            | 43 min             |
| `/v1/tools/*` success rate (free) | 99.5 %            | 3h 36m             |
| `/v1/tools/*` success rate (paid) | 99.0 %            | 7h 12m             |
| RPC p95 latency                  | < 3 s             | n/a                |
| MCP `/mcp/message` success rate   | 99.5 %            | 3h 36m             |
| Deploy-to-finalized (p95)        | < 90 s            | n/a                |

Review quarterly; tighten as the system matures.