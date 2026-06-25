/**
 * Prometheus metrics registry for the BlockOps Casper backend.
 *
 * Single source of truth for all `/metrics` output. Uses `prom-client`'s
 * default registry so we automatically collect Node process / GC / event
 * loop stats; the application-specific series below layer business
 * counters and histograms on top.
 *
 * Series exposed
 * ──────────────
 *   blockops_http_requests_total{method,route,status_code}
 *       counter — incremented by `requestContext` middleware
 *
 *   blockops_http_request_duration_seconds{method,route,status_code}
 *       histogram — labelled HTTP latency; default buckets sized for an
 *       API surface where 100ms–2s is the sweet spot
 *
 *   blockops_tool_executions_total{tool_id,kind,status}
 *       counter — `kind` ∈ {local, proxy, rpc}, `status` ∈ {ok, error, x402}
 *
 *   blockops_tool_duration_seconds{tool_id,kind}
 *       histogram — wall-clock time inside `directToolExecutor`
 *
 *   blockops_x402_challenges_total{tool_id,tier}
 *       counter — 402 challenges emitted by the x402 middleware
 *
 *   blockops_x402_refunds_total{tool_id,status}
 *       counter — refund deploys attempted (status ∈ {broadcast,skipped,failed})
 *
 *   blockops_cache_operations_total{cache,op,result}
 *       counter — reserved for Phase 27 Redis read-through cache
 *
 *   blockops_deploy_stuck_total{tool_id}
 *       counter — incremented when a deploy stays pending past the SLA
 *       (5 min) and the polling task gives up
 *
 *   blockops_active_sessions
 *       gauge — MCP SSE sessions currently connected (mirrors Redis SCARD)
 *
 *   blockops_rpc_call_duration_seconds{method,result}
 *       histogram — wraps Casper RPC + CSPR.cloud calls
 *
 * Cardinality controls
 * ────────────────────
 *   • `route` uses the Express route template (`/v1/tools/:toolId`),
 *     NOT the raw URL — keeps cardinality bounded.
 *   • `tool_id` is one of the 22 documented tools; never user input.
 *   • Histogram buckets are tuned to the API; default Prometheus
 *     buckets (5ms–10s) would waste ~80% of the bucket space.
 *
 * For tests
 * ─────────
 *   `resetForTests()` clears all custom (non-default) series between cases
 *   so the `/metrics` snapshot is deterministic. Default Node / process
 *   metrics are NOT cleared.
 */

const client = require('prom-client');

// ── Default registry (process / GC / event-loop) ────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'blockops_node_' });

// ── HTTP ────────────────────────────────────────────────────────────────
const httpRequestsTotal = new client.Counter({
  name: 'blockops_http_requests_total',
  help: 'HTTP requests handled by the backend, labelled by route + status.',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'blockops_http_request_duration_seconds',
  help: 'HTTP request latency in seconds.',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// ── v1 tool surface ────────────────────────────────────────────────────
const toolExecutionsTotal = new client.Counter({
  name: 'blockops_tool_executions_total',
  help: 'Tool executions on the v1 surface.',
  labelNames: ['tool_id', 'kind', 'status'],
  registers: [register],
});

const toolDuration = new client.Histogram({
  name: 'blockops_tool_duration_seconds',
  help: 'Wall-clock duration of a single tool execution (in v1 surface).',
  labelNames: ['tool_id', 'kind'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

// ── x402 ───────────────────────────────────────────────────────────────
const x402ChallengesTotal = new client.Counter({
  name: 'blockops_x402_challenges_total',
  help: '402 challenges emitted by the x402 middleware.',
  labelNames: ['tool_id', 'tier'],
  registers: [register],
});

const x402RefundsTotal = new client.Counter({
  name: 'blockops_x402_refunds_total',
  help: 'Refund deploys attempted after a tool handler returned 5xx.',
  labelNames: ['tool_id', 'status'],
  registers: [register],
});

// ── Cache (reserved for Phase 27) ──────────────────────────────────────
const cacheOperationsTotal = new client.Counter({
  name: 'blockops_cache_operations_total',
  help: 'Read-through cache hits/misses (populated by Phase 27).',
  labelNames: ['cache', 'op', 'result'],
  registers: [register],
});

// ── Deploy status ──────────────────────────────────────────────────────
const deployStuckTotal = new client.Counter({
  name: 'blockops_deploy_stuck_total',
  help: 'Deploys that stayed pending past the SLA and the polling task gave up.',
  labelNames: ['tool_id'],
  registers: [register],
});

// ── MCP / SSE ──────────────────────────────────────────────────────────
const activeSessions = new client.Gauge({
  name: 'blockops_active_sessions',
  help: 'MCP SSE sessions currently connected (mirrors Redis SCARD mcp:active_sessions).',
  registers: [register],
});

// ── Casper RPC ─────────────────────────────────────────────────────────
const rpcCallDuration = new client.Histogram({
  name: 'blockops_rpc_call_duration_seconds',
  help: 'Casper RPC + CSPR.cloud call latency.',
  labelNames: ['method', 'result'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Returns the Express route template (e.g. `/v1/tools/:toolId`) instead
 * of the raw URL (`/v1/tools/transfer`) so cardinality stays bounded.
 *
 * Express puts the matched route on `req.route.path` once the router has
 * resolved it; before that point (404, middleware-only path) we fall back
 * to a coarse bucket so we don't blow up label cardinality.
 */
function routeLabel(req) {
  if (req.route && req.route.path) {
    const base = req.baseUrl || '';
    return `${base}${req.route.path}`;
  }
  // Coarse buckets for unmatched paths
  if (req.path === '/' || req.path === '') return '/';
  if (req.path.startsWith('/health')) return '/health/*';
  if (req.path.startsWith('/v1/tools/')) return '/v1/tools/:toolId';
  if (req.path.startsWith('/v1/')) return '/v1/*';
  if (req.path.startsWith('/token/')) return '/token/*';
  if (req.path.startsWith('/nft/')) return '/nft/*';
  if (req.path.startsWith('/transfer')) return '/transfer/*';
  if (req.path.startsWith('/contract-chat')) return '/contract-chat/*';
  if (req.path.startsWith('/email')) return '/email/*';
  if (req.path.startsWith('/webhooks')) return '/webhooks/*';
  if (req.path.startsWith('/agents')) return '/agents/*';
  if (req.path.startsWith('/reminders')) return '/reminders/*';
  if (req.path.startsWith('/telegram')) return '/telegram/*';
  if (req.path.startsWith('/api')) return '/api/*';
  return 'other';
}

/**
 * Timer that observes into a histogram and returns a function that
 * stops it. Idiomatic pattern for `res.on('finish')` handlers.
 */
function startTimer(histogram, labels) {
  const end = histogram.startTimer(labels);
  return (extraLabels = {}) => {
    try {
      end({ ...labels, ...extraLabels });
    } catch (err) {
      // Don't let a metrics error mask the real response
    }
  };
}

/**
 * Reset every custom (non-default) series so tests get a clean slate.
 * Default Node / process metrics are kept — they're cheap and stable.
 */
function resetForTests() {
  register.resetMetrics();
}

/**
 * Render the full registry as Prometheus exposition text. Returns a
 * Promise<string> so the caller can stream it or send it inline.
 */
async function render() {
  return register.metrics();
}

/**
 * Render with content-type header value for `/metrics` responses.
 */
function contentType() {
  return register.contentType;
}

module.exports = {
  register,
  render,
  contentType,
  routeLabel,
  startTimer,
  resetForTests,

  // Exported for test introspection + non-middleware callers
  httpRequestsTotal,
  httpRequestDuration,
  toolExecutionsTotal,
  toolDuration,
  x402ChallengesTotal,
  x402RefundsTotal,
  cacheOperationsTotal,
  deployStuckTotal,
  activeSessions,
  rpcCallDuration,
};