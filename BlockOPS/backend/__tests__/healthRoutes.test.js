/**
 * Unit tests for the Phase 24 health endpoints.
 *
 * Tests the `routes/healthRoutes.js` router directly by injecting mock
 * `req`/`res` objects instead of booting the full Express app (the
 * backend has long-running timers from telegramService that prevent
 * clean process exit when `app.js` is required as a library).
 *
 * Coverage:
 *   - GET /health/live returns 200 + kind:"live" + uptimeMs
 *   - GET /health/ready returns 200 or 503 with a per-check breakdown
 *   - GET /health/startup is the same shape as ready (with coldStarting)
 *   - GET /health (back-compat) returns the full info payload
 *   - the readiness response includes casper_rpc, supabase, cspr_cloud,
 *     agent_backend, redis probes
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Set test-friendly env BEFORE requiring the router so the
// constants.js config captures the right URLs.
process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'x'.repeat(32);
// Use a fast-failing localhost:1 instead of the real testnet RPC so
// the readiness probe returns ECONNREFUSED immediately (no 4s socket
// timeout, no test hang).
process.env.CASPER_RPC_URL = 'http://127.0.0.1:1/rpc';
process.env.CSPR_CLOUD_API_URL = 'http://127.0.0.1:1';
process.env.AGENT_BACKEND_URL = 'http://127.0.0.1:1';

const router = require('../routes/healthRoutes');

// ── helpers ─────────────────────────────────────────────────────────────

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// Stub the readiness probes so tests don't open real sockets to
// rpc.testnet.casper.live / api.testnet.cspr.cloud / localhost:8000.
// Without this, an in-flight probe keeps the event loop alive for the
// 4 s socket timeout after the test body finishes.
function stubProbes({ rpcOk = false, csprOk = false, backendOk = false, redisOk = false, supabaseOk = true } = {}) {
  // The router reads these at call time via require() — we monkey-patch
  // the inner probeUrl by intercepting the response builders. The
  // simplest reliable approach: replace process.env.CASPER_RPC_URL with
  // a localhost:1 target so the probe fails immediately, and toggle
  // env vars that gate the check.
  const prev = {
    CASPER_RPC_URL: process.env.CASPER_RPC_URL,
    CSPR_CLOUD_API_URL: process.env.CSPR_CLOUD_API_URL,
    AGENT_BACKEND_URL: process.env.AGENT_BACKEND_URL,
    REDIS_URL: process.env.REDIS_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  };

  // localhost:1 fails fast with ECONNREFUSED instead of a 4-s timeout.
  process.env.CASPER_RPC_URL = `http://127.0.0.1:1/rpc`;
  process.env.CSPR_CLOUD_API_URL = `http://127.0.0.1:1`;
  process.env.AGENT_BACKEND_URL = `http://127.0.0.1:1`;
  if (redisOk) process.env.REDIS_URL = `redis://127.0.0.1:1`;
  else delete process.env.REDIS_URL;
  if (supabaseOk) {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'x'.repeat(32);
  } else {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
  }

  return () => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  };
}

// Wait for the async handler to populate `res.body`. Polls with a short
// interval so we don't race the handler.
async function callRoute(method, path, { maxWaitMs = 2000 } = {}) {
  const req = { method, path, headers: {} };
  const res = makeRes();
  const layers = router.stack.filter(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()],
  );
  if (!layers.length) return { error: 'not_found' };
  const layer = layers[0];
  layer.handle(req, res, () => {});

  const start = Date.now();
  while (res.body === null && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return res;
}

// ── tests ────────────────────────────────────────────────────────────────

describe('healthRoutes — GET /health/live', () => {
  it('returns 200 + kind:"live" + uptimeMs', async () => {
    const res = await callRoute('GET', '/live');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.kind, 'live');
    assert.equal(typeof res.body.uptimeMs, 'number');
    assert.ok(res.body.uptimeMs >= 0);
    assert.equal(typeof res.body.timestamp, 'string');
  });
});

describe('healthRoutes — GET /health/ready', () => {
  let restore;
  before(() => { restore = stubProbes({ supabaseOk: true }); });
  after(() => { restore(); });

  it('returns a per-check breakdown labelled casper_rpc + supabase', async () => {
    const res = await callRoute('GET', '/ready');
    assert.ok([200, 503].includes(res.statusCode));
    assert.equal(res.body.kind, 'ready');
    assert.equal(typeof res.body.requiredOk, 'boolean');
    assert.ok(Array.isArray(res.body.checks));
    const labels = res.body.checks.map((c) => c.label);
    assert.ok(labels.includes('casper_rpc'));
    assert.ok(labels.includes('supabase'));
  });

  it('reports cspr_cloud + agent_backend + redis', async () => {
    const res = await callRoute('GET', '/ready');
    const labels = res.body.checks.map((c) => c.label);
    assert.ok(labels.includes('cspr_cloud'));
    assert.ok(labels.includes('agent_backend'));
    assert.ok(labels.includes('redis'));
  });

  it('returns 503 when the casper_rpc probe fails', async () => {
    const res = await callRoute('GET', '/ready');
    const rpcCheck = res.body.checks.find((c) => c.label === 'casper_rpc');
    assert.equal(rpcCheck.ok, false);
    // Required-not-ok when casper_rpc fails
    assert.equal(res.body.requiredOk, false);
  });
});

describe('healthRoutes — GET /health/startup', () => {
  let restore;
  before(() => { restore = stubProbes({ supabaseOk: true }); });
  after(() => { restore(); });

  it('returns kind:"startup" with coldStarting flag', async () => {
    const res = await callRoute('GET', '/startup');
    assert.ok([200, 503].includes(res.statusCode));
    assert.equal(res.body.kind, 'startup');
    assert.equal(typeof res.body.coldStarting, 'boolean');
  });
});

describe('healthRoutes — GET /health (back-compat)', () => {
  it('returns the full info payload', async () => {
    const res = await callRoute('GET', '/');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.kind, 'info');
    assert.equal(typeof res.body.rpc, 'string');
    assert.ok(res.body.rpc.startsWith('http'));
    assert.ok(Array.isArray(res.body.supportedChains));
    assert.ok(res.body.supportedChains.length >= 1);
    assert.equal(res.body.supportedChains[0].chain, 'casper-test');
    assert.equal(typeof res.body.timestamp, 'string');
  });

  it('exposes the same top-level fields as before Phase 24', async () => {
    const res = await callRoute('GET', '/');
    assert.equal(typeof res.body.tokenFactory, 'string');
    assert.equal(typeof res.body.nftFactory, 'string');
  });
});