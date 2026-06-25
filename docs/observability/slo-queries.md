# CasperOPs SLO Queries

> PromQL queries powering the production SLO dashboard
> ([Grafana JSON](../../infra/grafana/casperops-slo-dashboard.json)).
> Every query references the metrics exposed by `prom-client` on
> `/metrics` — see [`OPERATIONS.md` §1](./OPERATIONS.md#1-metrics-endpoints).

The dashboard has 4 sections:

1. **Traffic & latency** — request rate + p50/p95/p99 by route
2. **Tool mix & cost** — which tools are being used, where the CSPR goes
3. **Reliability** — error rate, deploy-stuck gauge, cache hit ratio
4. **MCP / SSE** — active sessions, JSON-RPC message rate

## Traffic & latency

### Request rate (RPS) by route template

```promql
sum by (route, method) (rate(casperops_http_requests_total[1m]))
```

### p50 / p95 / p99 latency by route

```promql
# p95
histogram_quantile(0.95,
  sum by (le, route) (rate(casperops_http_request_duration_seconds_bucket[5m]))
)

# p99 (add a second panel)
histogram_quantile(0.99,
  sum by (le, route) (rate(casperops_http_request_duration_seconds_bucket[5m]))
)
```

### 5xx rate (alert query — RUNBOOK §2.1)

```promql
sum(rate(casperops_http_requests_total{status_code=~"5.."}[5m]))
/
sum(rate(casperops_http_requests_total[5m]))
```

## Tool mix & cost

### Tool invocations by tool_id (last 1h)

```promql
sum by (tool_id) (rate(casperops_tool_executions_total[1h]))
```

### x402 conversion rate (challenge → ok)

```promql
sum(rate(casperops_x402_challenges_total[1h]))
/
sum(rate(casperops_tool_executions_total{status="ok"}[1h]))
```

A ratio > 1.0 means many users are challenged but don't pay (good
news for free tools, bad news for paid ones — investigate).

### Refund rate

```promql
sum by (status) (rate(casperops_x402_refunds_total[1h]))
```

The `status="failed"` series should be near-zero. Anything > 0.01
means the treasury signer or the RPC had a hiccup.

### Tool latency p95 (per tool, paid tools only)

```promql
histogram_quantile(0.95,
  sum by (le, tool_id) (rate(casperops_tool_duration_seconds_bucket{tool_id!=""}[5m]))
)
```

## Reliability

### Deploy stuck rate (alert query — RUNBOOK §1)

```promql
rate(casperops_deploy_stuck_total[5m]) > 0
```

### Cache hit ratio (per cache)

```promql
sum by (cache, op, result) (rate(casperops_cache_operations_total[5m]))
```

Group by `cache` + `result` and divide `hit / (hit + miss)` to get
the hit ratio. Target > 80 % at 100 RPS sustained.

### Redis circuit-breaker activation

```promql
# `result="error"` on get/set/del ticks up when Redis is flaky
sum by (op) (rate(casperops_cache_operations_total{result="error"}[1m]))
```

If this exceeds 10 events/min, the circuit breaker is open (RUNBOOK
§3).

### RPC p95 latency (alert query — RUNBOOK §2.3)

```promql
histogram_quantile(0.95,
  sum by (le, method) (rate(casperops_rpc_call_duration_seconds_bucket[5m]))
)
```

Anything > 3 s sustained for 5 min → page the on-call.

### Process / GC stats (default `prom-client` series)

```promql
# Event loop lag (seconds) — should be < 0.1
rate(casperops_node_nodejs_eventloop_lag_seconds[1m])

# Heap used (bytes)
casperops_node_nodejs_heap_size_used_bytes

# GC pause time p99 (seconds)
histogram_quantile(0.99, rate(casperops_node_nodejs_gc_duration_seconds_bucket[5m]))
```

## MCP / SSE

### Active MCP sessions

```promql
casperops_mcp_active_sessions
```

Plateau at the machine's connection limit? Time to scale horizontally.

### Tool mix on MCP

```promql
sum by (tool_name, status) (rate(casperops_mcp_tool_calls_total[5m]))
```

### MCP RPC p95

```promql
histogram_quantile(0.95,
  sum by (le, method) (rate(casperops_mcp_rpc_call_duration_seconds_bucket[5m]))
)
```

### MCP backend proxy p95

```promql
histogram_quantile(0.95,
  sum by (le, tool_name, result) (
    rate(casperops_mcp_backend_proxy_duration_seconds_bucket[5m])
  )
)
```

The `result="unreachable"` series is a strong signal that the MCP
container can't reach the backend — usually a network ACL change.

## Capacity review (Day 30)

```promql
# Total request volume last 30 days
sum(increase(casperops_http_requests_total[30d]))

# p95 by route — compare against k6 baseline
histogram_quantile(0.95,
  sum by (le, route) (rate(casperops_http_request_duration_seconds_bucket[1h]))
)

# Saturation: are we hitting limits?
# Rate limit 429s (synthesised via X-RateLimit-* headers — needs to
# be parsed in the access log; for now check Sentry for "rate limit"
# alert spikes)
```

## Alert-to-Panel mapping

| Sentry alert (OPERATIONS.md §2) | Grafana panel |
|---------------------------------|---------------|
| 5xx rate > 1 % over 5 min | "5xx rate" |
| Deploy stuck pending > 5 min | "Deploy stuck rate" |
| RPC p95 > 3 s | "RPC p95 latency" |
| Redis errors > 10/min | "Redis circuit-breaker activation" |
| Tool error rate > 10 % | "Tool invocations" + filter by status="error" |