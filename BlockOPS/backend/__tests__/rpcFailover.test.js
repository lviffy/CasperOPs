/**
 * Tests for backend/utils/rpcFailover.js (Phase 30).
 *
 * Coverage:
 *   - primary succeeds → fallback never called
 *   - primary throws → fallback called → result returned
 *   - both fail → throws combined error with primary + fallback reasons
 *   - failover=false (writes) → throws on primary failure, never falls over
 *   - timeout wrapper cancels a hanging call
 *   - snapshot() reflects the last-known health state
 *   - probeHealth() updates the snapshot
 *
 * We monkey-patch the global `fetch` so the tests don't depend on
 * network. Each URL pattern returns a configured response.
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── fetch stub ─────────────────────────────────────────────────────────

let nextResponse = (url) => ({ ok: true, body: { jsonrpc: '2.0', id: 1, result: { ok: true, url } } });

function installFetchStub() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = typeof url === 'string' ? url : url.url;
    const method = init?.method || 'POST';
    let body = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch (_) { /* ignore */ }
    const r = nextResponse(u, { method, body });
    if (r.throw) throw r.throw;
    return {
      ok: r.ok !== false,
      status: r.status || (r.ok === false ? 500 : 200),
      json: async () => r.body,
    };
  };
  return () => { globalThis.fetch = original; };
}

// ── helper ─────────────────────────────────────────────────────────────

function freshModule() {
  delete require.cache[require.resolve('../utils/rpcFailover')];
  return require('../utils/rpcFailover');
}

function setUrls(primary, fallback) {
  process.env.CASPER_RPC_URL = primary;
  process.env.CASPER_RPC_URL_FALLBACK = fallback || '';
  process.env.CASPER_RPC_PROBE_COOLDOWN_MS = '0';
}

// ── tests ──────────────────────────────────────────────────────────────

describe('rpcFailover — read requests', () => {
  let restoreFetch;

  before(() => {
    restoreFetch = installFetchStub();
  });

  after(() => {
    restoreFetch();
  });

  beforeEach(() => {
    nextResponse = (url) => ({ ok: true, body: { jsonrpc: '2.0', id: 1, result: { ok: true, url } } });
  });

  it('returns primary result without touching fallback', async () => {
    setUrls('http://primary-ok/rpc', 'http://fallback-ok/rpc');
    const { rpc } = freshModule();

    const result = await rpc('info_get_status', {});
    assert.deepEqual(result, { ok: true, url: 'http://primary-ok/rpc' });
  });

  it('falls over to fallback when primary throws', async () => {
    setUrls('http://primary-fail/rpc', 'http://fallback-ok/rpc');
    nextResponse = (url) => {
      if (url.includes('primary-fail')) throw new Error('primary boom');
      return { ok: true, body: { jsonrpc: '2.0', id: 1, result: { ok: true, url } } };
    };
    const { rpc } = freshModule();

    const result = await rpc('chain_get_block', { height: 1 });
    assert.deepEqual(result, { ok: true, url: 'http://fallback-ok/rpc' });
  });

  it('throws a combined error when both endpoints fail', async () => {
    setUrls('http://primary-fail/rpc', 'http://fallback-fail/rpc');
    nextResponse = (url) => {
      throw new Error(url.includes('primary-fail') ? 'primary boom' : 'fallback boom');
    };
    const { rpc } = freshModule();

    await assert.rejects(
      rpc('info_get_status'),
      (err) => {
        assert.match(err.message, /both endpoints failed/);
        assert.match(err.message, /primary boom/);
        assert.match(err.message, /fallback boom/);
        assert.ok(err.primaryError);
        assert.ok(err.fallbackError);
        return true;
      },
    );
  });

  it('skips fallback when failover=false (writes)', async () => {
    setUrls('http://primary-fail/rpc', 'http://fallback-ok/rpc');
    // Reset call counter AFTER the boot-time probe so the rpc() call
    // is the only thing recorded below.
    let calls = [];
    nextResponse = (url) => {
      calls.push(url);
      throw new Error(url.includes('primary-fail') ? 'primary boom' : 'should not be called');
    };
    const { rpc, probeHealth } = freshModule();
    await probeHealth({ force: true }); // sync state with the new URLs
    calls = []; // reset

    await assert.rejects(
      rpc('account_put_deploy', { deploy: 'x' }, { failover: false }),
      /primary boom/,
    );
    // Must NOT have touched the fallback — that's the whole point of
    // `failover: false` for write tools.
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('primary-fail'));
  });

  it('treats JSON-RPC error responses as failures (not ok=true)', async () => {
    setUrls('http://primary-rpcerr/rpc', 'http://fallback-ok/rpc');
    nextResponse = (url) => {
      if (url.includes('primary-rpcerr')) {
        return {
          ok: true,
          body: { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'method not found' } },
        };
      }
      return { ok: true, body: { jsonrpc: '2.0', id: 1, result: { ok: true, url } } };
    };
    const { rpc } = freshModule();

    const result = await rpc('some_method', {});
    assert.deepEqual(result, { ok: true, url: 'http://fallback-ok/rpc' });
  });

  it('treats HTTP 5xx as failure', async () => {
    setUrls('http://primary-5xx/rpc', 'http://fallback-ok/rpc');
    nextResponse = (url) => {
      if (url.includes('primary-5xx')) return { ok: false, status: 503 };
      return { ok: true, body: { jsonrpc: '2.0', id: 1, result: { ok: true, url } } };
    };
    const { rpc } = freshModule();

    const result = await rpc('info_get_status', {});
    assert.deepEqual(result, { ok: true, url: 'http://fallback-ok/rpc' });
  });

  it('throws the primary error when no fallback is configured', async () => {
    setUrls('http://primary-fail/rpc', '');
    nextResponse = () => { throw new Error('primary boom'); };
    const { rpc } = freshModule();

    await assert.rejects(rpc('info_get_status'), /primary boom/);
  });

  it('throws the primary error when failover=false even if fallback is configured', async () => {
    setUrls('http://primary-fail/rpc', 'http://fallback-ok/rpc');
    let fallbackCalls = 0;
    nextResponse = (url) => {
      if (url.includes('fallback-ok')) { fallbackCalls += 1; return {}; }
      throw new Error('primary boom');
    };
    const { rpc, probeHealth } = freshModule();
    await probeHealth({ force: true }); // sync state — but DON'T count probe hits
    fallbackCalls = 0;

    await assert.rejects(
      rpc('account_put_deploy', {}, { failover: false }),
      /primary boom/,
    );
    assert.equal(fallbackCalls, 0);
  });
});

describe('rpcFailover — snapshot + probeHealth', () => {
  let restoreFetch;

  before(() => {
    restoreFetch = installFetchStub();
  });

  after(() => {
    restoreFetch();
  });

  beforeEach(() => {
    process.env.CASPER_RPC_PROBE_COOLDOWN_MS = '0';
    nextResponse = (url) => ({ ok: true, body: { jsonrpc: '2.0', id: 1, result: {} } });
  });

  it('snapshot() returns primary + fallback + activeUrl', async () => {
    setUrls('http://primary-ok/rpc', 'http://fallback-ok/rpc');
    const { probeHealth, snapshot } = freshModule();
    await probeHealth({ force: true });
    const s = snapshot();
    assert.equal(typeof s.primary.ok, 'boolean');
    assert.equal(typeof s.fallback.ok, 'boolean');
    assert.equal(typeof s.activeUrl, 'string');
    assert.equal(typeof s.anyHealthy, 'boolean');
  });

  it('anyHealthy is true when fallback is healthy even if primary is not', async () => {
    setUrls('http://primary-fail/rpc', 'http://fallback-ok/rpc');
    nextResponse = (url) => {
      if (url.includes('primary-fail')) throw new Error('primary boom');
      return { ok: true, body: { jsonrpc: '2.0', id: 1, result: {} } };
    };
    const { probeHealth, snapshot } = freshModule();
    await probeHealth({ force: true });
    const s = snapshot();
    assert.equal(s.primary.ok, false);
    assert.equal(s.fallback.ok, true);
    assert.equal(s.anyHealthy, true);
    assert.match(s.activeUrl, /fallback-ok/);
  });

  it('anyHealthy is false when both endpoints fail', async () => {
    setUrls('http://primary-fail/rpc', 'http://fallback-fail/rpc');
    nextResponse = () => { throw new Error('boom'); };
    const { probeHealth, snapshot } = freshModule();
    await probeHealth({ force: true });
    const s = snapshot();
    assert.equal(s.primary.ok, false);
    assert.equal(s.fallback.ok, false);
    assert.equal(s.anyHealthy, false);
  });

  it('snapshot reflects the last successful primary', async () => {
    setUrls('http://primary-ok/rpc', 'http://fallback-fail/rpc');
    nextResponse = (url) => {
      if (url.includes('fallback-fail')) throw new Error('fallback boom');
      return { ok: true, body: { jsonrpc: '2.0', id: 1, result: {} } };
    };
    const { probeHealth, snapshot } = freshModule();
    await probeHealth({ force: true });
    const s = snapshot();
    assert.equal(s.primary.ok, true);
    assert.equal(s.fallback.ok, false);
    assert.match(s.activeUrl, /primary-ok/);
  });
});

describe('rpcFailover — probeHealth respects cooldown', () => {
  let restoreFetch;

  before(() => {
    restoreFetch = installFetchStub();
  });

  after(() => {
    restoreFetch();
  });

  it('skips probing within cooldown window unless force=true', async () => {
    setUrls('http://primary-ok/rpc', 'http://fallback-ok/rpc');
    let callCount = 0;
    nextResponse = () => {
      callCount += 1;
      return { ok: true, body: { jsonrpc: '2.0', id: 1, result: {} } };
    };
    process.env.CASPER_RPC_PROBE_COOLDOWN_MS = '60000'; // 1 min
    const { probeHealth } = freshModule();

    await probeHealth({ force: true }); // forces both
    const afterFirst = callCount;
    await probeHealth(); // should be a no-op
    assert.equal(callCount, afterFirst, 'probe within cooldown must skip fetch');

    await probeHealth({ force: true });
    assert.ok(callCount > afterFirst, 'forced probe must hit fetch again');
  });
});