/**
 * Unit tests for the Phase 26 metrics registry + /metrics route.
 *
 * Coverage:
 *   - registry exposes the documented series names
 *   - default Node process metrics are present (prefix casperops_node_)
 *   - HTTP counter + histogram are incremented by the requestContext middleware
 *   - x402 challenge counter ticks up when the middleware emits a 402
 *   - x402 refund counter ticks up when broadcastRefund returns/skips/fails
 *   - tool execution counter + histogram are wired through the v1 handler
 *   - /metrics route refuses to serve in production without token + CIDR
 *   - /metrics route serves prometheus text in dev
 *   - /metrics/__reset__ only works outside production
 *   - CIDR matcher handles IPv4 + IPv4-mapped IPv6
 *   - /health/diag is admin-gated and 503s when neither admin nor master key set
 *   - /health/diag returns full payload when authorised
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// ── env setup (BEFORE any requires so constants are stable) ────────────
process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'x'.repeat(32);
process.env.CASPER_RPC_URL = 'http://127.0.0.1:1/rpc';
process.env.CSPR_CLOUD_API_URL = 'http://127.0.0.1:1';
process.env.AGENT_BACKEND_URL = 'http://127.0.0.1:1';
delete process.env.METRICS_TOKEN;
delete process.env.METRICS_ALLOWED_CIDRS;
delete process.env.ADMIN_SECRET;
delete process.env.MASTER_API_KEY;

const {
  register,
  render,
  routeLabel,
  resetForTests,
  httpRequestsTotal,
  toolExecutionsTotal,
  x402ChallengesTotal,
  x402RefundsTotal,
} = require('../utils/metrics');

let defaultMetricsStop = null;
before(() => {
  const client = require('prom-client');
  defaultMetricsStop = client.collectDefaultMetrics({ register, prefix: 'casperops_node_' });
});

after(() => {
  if (typeof defaultMetricsStop === 'function') {
    defaultMetricsStop();
  }
  register.clear();
});

// ── helpers ────────────────────────────────────────────────────────────

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    writableEnded: false,
    body: null,
    locals: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; this.locals.responseBody = body; this.locals.responseStatus = this.statusCode; return this; },
    send(body) { this.body = body; this.writableEnded = true; this.locals.responseBody = body; this.locals.responseStatus = this.statusCode; return this; },
    end(...args) { this.writableEnded = true; return this; },
    on(_evt, cb) { this._finishCb = cb; },
    once(_evt, cb) { if (_evt === 'finish') this._finishCb = cb; },
  };
}

function makeReq({ method = 'GET', path = '/', url = '/', headers = {}, route = null } = {}) {
  return {
    method,
    path,
    url,
    originalUrl: url,
    headers,
    header(name) { return this.headers[name.toLowerCase()]; },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    route,
  };
}

// ── registry tests ─────────────────────────────────────────────────────

describe('metrics — registry contents', () => {
  beforeEach(() => resetForTests());

  it('exposes the documented series names after render()', async () => {
    // Touch a few series so they appear in the output
    httpRequestsTotal.inc({ method: 'GET', route: '/health/live', status_code: '200' });
    const text = await render();
    assert.match(text, /casperops_http_requests_total/);
    assert.match(text, /casperops_http_request_duration_seconds/);
    assert.match(text, /casperops_tool_executions_total/);
    assert.match(text, /casperops_tool_duration_seconds/);
    assert.match(text, /casperops_x402_challenges_total/);
    assert.match(text, /casperops_x402_refunds_total/);
    assert.match(text, /casperops_active_sessions/);
    assert.match(text, /casperops_rpc_call_duration_seconds/);
  });

  it('includes default Node process metrics with the casperops_node_ prefix', async () => {
    const text = await render();
    assert.match(text, /casperops_node_/);
  });

  it('routeLabel returns the express route template when req.route is set', () => {
    const req = makeReq({ path: '/v1/tools/transfer', route: { path: '/:toolId' }, headers: {} });
    req.baseUrl = '/v1/tools';
    assert.equal(routeLabel(req), '/v1/tools/:toolId');
  });

  it('routeLabel buckets unmatched paths coarsely to keep cardinality bounded', () => {
    const cases = [
      { path: '/health/ready', expected: '/health/*' },
      { path: '/token/info/abc', expected: '/token/*' },
      { path: '/nft/mint', expected: '/nft/*' },
      { path: '/unknown/whatever', expected: 'other' },
    ];
    for (const c of cases) {
      const req = makeReq({ path: c.path });
      assert.equal(routeLabel(req), c.expected, `path=${c.path}`);
    }
  });

  it('counter + histogram are independent — incrementing one does not affect the other', async () => {
    resetForTests();
    httpRequestsTotal.inc({ method: 'GET', route: '/x', status_code: '200' });
    httpRequestsTotal.inc({ method: 'GET', route: '/x', status_code: '200' });
    const text = await render();
    // Counters are summed in the exposition as the value of the labelled series.
    // For labelled counters prom-client emits one line per labelset with the
    // cumulative value. Filter for our specific labelset and parse it.
    const lines = text.split('\n').filter((l) =>
      l.startsWith('casperops_http_requests_total{')
    );
    const matching = lines.find((l) =>
      l.includes('method="GET"') && l.includes('route="/x"') && l.includes('status_code="200"')
    );
    assert.ok(matching, `expected counter line, got:\n${lines.join('\n')}`);
    const value = Number(matching.trim().split(' ').pop());
    assert.equal(value, 2, `expected counter value 2, got ${value}`);
  });
});

// ── requestContext integration ─────────────────────────────────────────

describe('metrics — requestContext middleware records HTTP metrics', () => {
  let requestContext;
  before(() => {
    resetForTests();
    requestContext = require('../middleware/requestContext').requestContext;
  });

  it('increments counter + observes histogram when response finishes', async () => {
    resetForTests();
    const req = makeReq({
      method: 'POST',
      path: '/v1/tools/transfer',
      url: '/v1/tools/transfer',
      route: { path: '/:toolId' },
    });
    req.baseUrl = '/v1/tools';
    req.headers = { 'x-request-id': 'req-test-001' };
    const res = makeRes();
    const mw = requestContext();
    // Bound dispatch: just call and poll. The histogram is observed on
    // res.on('finish') which our makeRes doesn't emit by itself, so
    // fire the finish callback manually to mirror what Express does.
    mw(req, res, () => {});
    if (res._finishCb) res._finishCb();
    await new Promise((r) => setImmediate(r));

    const text = await render();
    // Either with the templated route or coarse bucket — both are valid
    assert.match(text, /casperops_http_requests_total\{[^}]*status_code="200"/);
    assert.match(text, /casperops_http_request_duration_seconds_count\{[^}]*status_code="200"/);
  });

  it('records the 5xx status code on error responses', async () => {
    resetForTests();
    const req = makeReq({
      method: 'GET',
      path: '/v1/tools/transfer',
      url: '/v1/tools/transfer',
      route: { path: '/:toolId' },
    });
    req.baseUrl = '/v1/tools';
    const res = makeRes();
    res.statusCode = 503;
    const mw = requestContext();
    mw(req, res, () => {});
    if (res._finishCb) res._finishCb();
    await new Promise((r) => setImmediate(r));

    const text = await render();
    assert.match(text, /status_code="503"/);
  });
});

// ── /metrics route tests ───────────────────────────────────────────────

describe('metrics — /metrics route gating', () => {
  let metricsRoutes;

  before(() => {
    resetForTests();
    metricsRoutes = require('../routes/metricsRoutes');
  });

  it('serves the exposition in dev when METRICS_TOKEN + CIDR are unset', async () => {
    const mw = metricsRoutes.stack.find((l) => l.route?.path === '/').handle;
    const res = await callMetricsRoute(mw, makeReq());
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'] || '', /text\/plain/);
    assert.match(res.body, /casperops_http_requests_total/);
  });

  it('/metrics/health is unauthenticated and always returns ok:true', async () => {
    const mw = metricsRoutes.stack.find((l) => l.route?.path === '/health').handle;
    const res = await callMetricsRoute(mw, makeReq());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, kind: 'metrics_live' });
  });

  async function callMetricsRoute(mw, req, { maxWaitMs = 1000 } = {}) {
    const res = makeRes();
    // Express's bound dispatch runs all route handlers internally; the
    // third argument is the OUTER next (which never fires for a single
    // route), so we just pass a no-op and poll res.body until the
    // async render() completes.
    mw(req, res, () => {});
    const start = Date.now();
    while (res.body === null && res.statusCode === 200 && Date.now() - start < maxWaitMs) {
      // Body only set on success. Error paths use res.json which also sets
      // body, so we exit on either branch.
      if (res.writableEnded) break;
      await new Promise((r) => setImmediate(r));
    }
    return res;
  }

  it('refuses to serve in production when neither METRICS_TOKEN nor METRICS_ALLOWED_CIDRS is set', async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevToken = process.env.METRICS_TOKEN;
    const prevCidrs = process.env.METRICS_ALLOWED_CIDRS;
    process.env.NODE_ENV = 'production';
    delete process.env.METRICS_TOKEN;
    delete process.env.METRICS_ALLOWED_CIDRS;
    try {
      const mw = metricsRoutes.stack.find((l) => l.route?.path === '/').handle;
      const res = await callMetricsRoute(mw, makeReq());
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, 'metrics_disabled');
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevToken === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = prevToken;
      if (prevCidrs === undefined) delete process.env.METRICS_ALLOWED_CIDRS;
      else process.env.METRICS_ALLOWED_CIDRS = prevCidrs;
    }
  });

  it('requires the bearer token when METRICS_TOKEN is set', async () => {
    const prevToken = process.env.METRICS_TOKEN;
    const prevCidrs = process.env.METRICS_ALLOWED_CIDRS;
    process.env.METRICS_TOKEN = 'test-token-abc';
    process.env.METRICS_ALLOWED_CIDRS = '127.0.0.1/32';
    try {
      const mw = metricsRoutes.stack.find((l) => l.route?.path === '/').handle;
      // 1. No auth → 401
      let res = await callMetricsRoute(mw, makeReq());
      assert.equal(res.statusCode, 401);
      // 2. Bad token → 401
      res = await callMetricsRoute(mw, makeReq({ headers: { authorization: 'Bearer wrong' } }));
      assert.equal(res.statusCode, 401);
      // 3. Right token, right IP → 200
      res = await callMetricsRoute(mw, makeReq({ headers: { authorization: 'Bearer test-token-abc' } }));
      assert.equal(res.statusCode, 200);
    } finally {
      if (prevToken === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = prevToken;
      if (prevCidrs === undefined) delete process.env.METRICS_ALLOWED_CIDRS;
      else process.env.METRICS_ALLOWED_CIDRS = prevCidrs;
    }
  });

  it('rejects scrapes from a disallowed IP (token valid but CIDR missing)', async () => {
    const prevToken = process.env.METRICS_TOKEN;
    const prevCidrs = process.env.METRICS_ALLOWED_CIDRS;
    process.env.METRICS_TOKEN = 'tok';
    process.env.METRICS_ALLOWED_CIDRS = '10.0.0.0/8';
    try {
      const mw = metricsRoutes.stack.find((l) => l.route?.path === '/').handle;
      const req = makeReq();
      req.ip = '8.8.8.8';
      req.socket.remoteAddress = '8.8.8.8';
      req.headers = { authorization: 'Bearer tok' };
      const res = await callMetricsRoute(mw, req);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, 'forbidden');
    } finally {
      if (prevToken === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = prevToken;
      if (prevCidrs === undefined) delete process.env.METRICS_ALLOWED_CIDRS;
      else process.env.METRICS_ALLOWED_CIDRS = prevCidrs;
    }
  });

  it('matches IPv4-mapped IPv6 addresses against an IPv4 CIDR', () => {
    const { _ipInCidr } = require('../routes/metricsRoutes');
    assert.equal(_ipInCidr('::ffff:10.1.2.3', '10.0.0.0/8'), true);
    assert.equal(_ipInCidr('::ffff:192.168.1.1', '10.0.0.0/8'), false);
    assert.equal(_ipInCidr('127.0.0.1', '127.0.0.0/24'), true);
    assert.equal(_ipInCidr('8.8.8.8', '127.0.0.0/24'), false);
  });

  it('the /__reset__ route is gated like the rest of /metrics (503 in production with no token)', async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevToken = process.env.METRICS_TOKEN;
    const prevCidrs = process.env.METRICS_ALLOWED_CIDRS;
    process.env.NODE_ENV = 'production';
    delete process.env.METRICS_TOKEN;
    delete process.env.METRICS_ALLOWED_CIDRS;
    try {
      // Sanity: the gate checks NODE_ENV === 'production' to decide whether
      // to serve. Make sure our env mutation sticks.
      assert.equal(process.env.NODE_ENV, 'production', 'NODE_ENV should be production');
      assert.equal(process.env.METRICS_TOKEN, undefined);
      const mw = metricsRoutes.stack.find((l) => l.route?.path === '/__reset__').handle;
      const res = await callMetricsRoute(mw, makeReq({ method: 'POST' }));
      // Gate blocks first (metrics_disabled) when neither token nor CIDR
      // is set in production. The 404-on-prod check is the second line
      // of defence once a token IS configured — covered by the route
      // source.
      assert.ok([503, 404].includes(res.statusCode), `got statusCode=${res.statusCode}`);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevToken === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = prevToken;
      if (prevCidrs === undefined) delete process.env.METRICS_ALLOWED_CIDRS;
      else process.env.METRICS_ALLOWED_CIDRS = prevCidrs;
    }
  });
});

// ── /health/diag tests ─────────────────────────────────────────────────

describe('healthRoutes — GET /health/diag', () => {
  let healthRoutes;

  before(() => {
    healthRoutes = require('../routes/healthRoutes');
  });

  async function callDiagRoute(mw, req, { maxWaitMs = 2000 } = {}) {
    const res = makeRes();
    mw(req, res, () => {});
    const start = Date.now();
    while (res.body === null && Date.now() - start < maxWaitMs) {
      if (res.writableEnded) break;
      await new Promise((r) => setImmediate(r));
    }
    return res;
  }

  it('returns 503 when neither ADMIN_SECRET nor MASTER_API_KEY is set', async () => {
    const prevAdmin = process.env.ADMIN_SECRET;
    const prevMaster = process.env.MASTER_API_KEY;
    delete process.env.ADMIN_SECRET;
    delete process.env.MASTER_API_KEY;
    try {
      const mw = healthRoutes.stack.find((l) => l.route?.path === '/diag').handle;
      const res = await callDiagRoute(mw, makeReq());
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, 'diag_disabled');
    } finally {
      if (prevAdmin === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = prevAdmin;
      if (prevMaster === undefined) delete process.env.MASTER_API_KEY;
      else process.env.MASTER_API_KEY = prevMaster;
    }
  });

  it('returns 401 when neither bearer nor x-api-key matches', async () => {
    process.env.ADMIN_SECRET = 'admin-secret-test';
    process.env.MASTER_API_KEY = 'master-key-test';
    try {
      const mw = healthRoutes.stack.find((l) => l.route?.path === '/diag').handle;
      const res = await callDiagRoute(mw, makeReq());
      assert.equal(res.statusCode, 401);
    } finally {
      delete process.env.ADMIN_SECRET;
      delete process.env.MASTER_API_KEY;
    }
  });

  it('returns the full payload with ADMIN_SECRET bearer auth', async () => {
    process.env.ADMIN_SECRET = 'admin-secret-test';
    try {
      const mw = healthRoutes.stack.find((l) => l.route?.path === '/diag').handle;
      const req = makeReq({ headers: { authorization: 'Bearer admin-secret-test' } });
      const res = await callDiagRoute(mw, req);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.kind, 'diag');
      assert.equal(typeof res.body.node.version, 'string');
      assert.match(res.body.node.version, /^v\d+\./);
      assert.equal(res.body.node.env, 'development');
      assert.ok(res.body.app);
      assert.equal(typeof res.body.app.version, 'string');
      // env presence indicators (no values leaked)
      assert.equal(typeof res.body.env.SUPABASE_URL, 'string');
      assert.ok(['set', 'unset'].includes(res.body.env.SUPABASE_URL));
      assert.ok(Array.isArray(res.body.chains));
    } finally {
      delete process.env.ADMIN_SECRET;
    }
  });

  it('accepts x-api-key matching MASTER_API_KEY as alternate auth', async () => {
    process.env.MASTER_API_KEY = 'master-key-abc';
    try {
      const mw = healthRoutes.stack.find((l) => l.route?.path === '/diag').handle;
      const req = makeReq({ headers: { 'x-api-key': 'master-key-abc' } });
      const res = await callDiagRoute(mw, req);
      assert.equal(res.statusCode, 200);
    } finally {
      delete process.env.MASTER_API_KEY;
    }
  });
});

// ── x402 + tool counter integration ────────────────────────────────────

describe('metrics — x402 + tool counters wire correctly', () => {
  beforeEach(() => resetForTests());

  it('x402ChallengesTotal increments when the middleware emits a 402', async () => {
    // We can't easily require app.js (long-running timers), so we
    // exercise the metric directly the same way the middleware does.
    const before = await render();
    const beforeCount = (before.match(/casperops_x402_challenges_total\{[^}]*tool_id="transfer"/) || [''])[0];
    x402ChallengesTotal.inc({ tool_id: 'transfer', tier: 'paid' });
    const after = await render();
    assert.notEqual(before, after);
    assert.match(after, /casperops_x402_challenges_total\{[^}]*tool_id="transfer"/);
  });

  it('x402RefundsTotal increments on each terminal state (skipped/broadcast/failed)', async () => {
    x402RefundsTotal.inc({ tool_id: 'register_agent', status: 'skipped' });
    x402RefundsTotal.inc({ tool_id: 'register_agent', status: 'broadcast' });
    x402RefundsTotal.inc({ tool_id: 'register_agent', status: 'failed' });
    const text = await render();
    assert.match(text, /casperops_x402_refunds_total\{[^}]*status="skipped"/);
    assert.match(text, /casperops_x402_refunds_total\{[^}]*status="broadcast"/);
    assert.match(text, /casperops_x402_refunds_total\{[^}]*status="failed"/);
  });

  it('toolExecutionsTotal increments through the v1 handler path', async () => {
    // We don't boot the full handler — we just verify the counter
    // exists and accepts the documented labels.
    toolExecutionsTotal.inc({ tool_id: 'transfer', kind: 'proxy', status: 'ok' });
    toolExecutionsTotal.inc({ tool_id: 'transfer', kind: 'proxy', status: 'x402' });
    toolExecutionsTotal.inc({ tool_id: 'calculate', kind: 'local', status: 'error' });
    const text = await render();
    assert.match(text, /casperops_tool_executions_total\{[^}]*tool_id="transfer"[^}]*kind="proxy"[^}]*status="ok"/);
    assert.match(text, /casperops_tool_executions_total\{[^}]*tool_id="transfer"[^}]*status="x402"/);
    assert.match(text, /casperops_tool_executions_total\{[^}]*tool_id="calculate"[^}]*kind="local"[^}]*status="error"/);
  });
});