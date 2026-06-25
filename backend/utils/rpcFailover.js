/**
 * Casper RPC failover layer (Phase 30).
 *
 * Wraps raw JSON-RPC POSTs against Casper RPC endpoints with:
 *
 *   1. The primary RPC (`CASPER_RPC_URL`, default public Casper RPC)
 *   2. The fallback RPC (`CASPER_RPC_URL_FALLBACK`, default CSPR.cloud
 *      derived URL — operators override if they want a different
 *      backup chain)
 *
 * Behaviour
 * ─────────
 *   • Reads (`info_get_status`, `chain_get_block`, `state_get_item`,
 *     `query_global_state`, `account_get_balance`) are attempted on
 *     the primary first. If the primary errors or times out, we
 *     retry once on the fallback.
 *   • Writes (`account_put_deploy`) are NEVER failed over — putting
 *     a deploy on the wrong RPC risks double-broadcast. The deploy
 *     will fail loudly and the operator can switch `CASPER_RPC_URL`
 *     manually per the runbook.
 *   • Health checks probe both endpoints every 60 s. The result is
 *     exposed on `/health/ready` so a half-dead cluster surfaces
 *     before users hit it.
 *
 * Why raw fetch?
 * ──────────────
 * casper-js-sdk exposes method-specific helpers (`getStatus`,
 * `getDeploy`, `getBlockState`) but no generic `request(method, params)`.
 * Implementing the failover around the specific helpers would mean
 * duplicating 20+ methods per endpoint, so we go raw and let the
 * typed helpers (`backend/utils/blockchain.js`) keep using
 * casper-js-sdk's instance methods when they want the parsed types.
 */

const { logger } = require('./logger');

const PRIMARY_URL = process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc';
const FALLBACK_URL = process.env.CASPER_RPC_URL_FALLBACK
  || process.env.CSPR_CLOUD_API_URL
  || '';

const READ_TIMEOUT_MS = Number(process.env.CASPER_RPC_READ_TIMEOUT_MS) || 4000;
const PROBE_COOLDOWN_MS = Number(process.env.CASPER_RPC_PROBE_COOLDOWN_MS) || 60_000;
const PROBE_INTERVAL_MS = Number(process.env.CASPER_RPC_PROBE_INTERVAL_MS) || 60_000;

// Last-known state of each endpoint, updated by health probes.
const health = {
  primary: { ok: true, lastChecked: 0, lastError: null },
  fallback: { ok: true, lastChecked: 0, lastError: null },
};

function log() {
  return logger.child({ component: 'casper-rpc-failover' });
}

async function rawRequest(url, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || {} }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body = await res.json();
    if (body.error) {
      const e = new Error(`rpc returned error: ${JSON.stringify(body.error).slice(0, 200)}`);
      e.rpcError = body.error;
      throw e;
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

function activeUrl() {
  return health.primary.ok ? PRIMARY_URL : (FALLBACK_URL || PRIMARY_URL);
}

/**
 * Send a JSON-RPC request and return the `result` field. Falls over
 * to the backup RPC on primary failure (when `failover: true`).
 *
 * @param {string} method  JSON-RPC method (e.g. 'info_get_status')
 * @param {object} [params]  method params
 * @param {object} [opts]
 * @param {boolean} [opts.failover=true]  whether to fall over to the
 *   backup RPC on failure. Set false for `account_put_deploy`.
 */
async function rpc(method, params = {}, { failover = true } = {}) {
  const start = Date.now();
  try {
    const result = await rawRequest(PRIMARY_URL, method, params);
    recordHealth('primary', true, null);
    return result;
  } catch (primaryErr) {
    recordHealth('primary', false, primaryErr.message || String(primaryErr));
    if (!failover || !FALLBACK_URL || FALLBACK_URL === PRIMARY_URL) {
      throw primaryErr;
    }

    log().warn?.({
      method, primaryErr: primaryErr.message, elapsedMs: Date.now() - start,
    }, 'casper-rpc-failover: primary failed, trying fallback');

    try {
      const result = await rawRequest(FALLBACK_URL, method, params);
      recordHealth('fallback', true, null);
      log().info?.({
        method, elapsedMs: Date.now() - start,
      }, 'casper-rpc-failover: fallback succeeded');
      return result;
    } catch (fallbackErr) {
      recordHealth('fallback', false, fallbackErr.message || String(fallbackErr));
      log().error?.({
        method,
        primaryErr: primaryErr.message,
        fallbackErr: fallbackErr.message,
        elapsedMs: Date.now() - start,
      }, 'casper-rpc-failover: both endpoints failed');
      const err = new Error(
        `Casper RPC failover: both endpoints failed (primary: ${primaryErr.message}, fallback: ${fallbackErr.message})`,
      );
      err.primaryError = primaryErr;
      err.fallbackError = fallbackErr;
      throw err;
    }
  }
}

function recordHealth(which, ok, err) {
  health[which].ok = ok;
  health[which].lastChecked = Date.now();
  health[which].lastError = ok ? null : err;
}

// ── health probes ──────────────────────────────────────────────────────

/**
 * Run an `info_get_status` against both endpoints and update the
 * `health` cache. Cheap (~10 KB JSON-RPC call) and safe to run
 * every minute; only invokes both at the requested interval.
 */
async function probeHealth({ force = false } = {}) {
  const now = Date.now();
  const tasks = [];
  for (const which of ['primary', 'fallback']) {
    if (!force && now - health[which].lastChecked < PROBE_COOLDOWN_MS) continue;
    const url = which === 'primary' ? PRIMARY_URL : FALLBACK_URL;
    if (!url) continue;
    tasks.push(
      rawRequest(url, 'info_get_status', {})
        .then(() => recordHealth(which, true, null))
        .catch((err) => recordHealth(which, false, err.message || String(err))),
    );
  }
  await Promise.allSettled(tasks);
  return snapshot();
}

function snapshot() {
  return {
    primary: { url: PRIMARY_URL, ...health.primary },
    fallback: { url: FALLBACK_URL || null, ...health.fallback },
    anyHealthy: health.primary.ok || (FALLBACK_URL && health.fallback.ok),
    activeUrl: activeUrl(),
  };
}

// Probe on boot so the readiness probe reflects real state, not the
// optimistic "true" default above. Errors are swallowed so a slow
// boot doesn't block startup.
probeHealth().catch(() => {});

// Re-probe on the configured interval.
const probeInterval = setInterval(() => {
  probeHealth().catch(() => {});
}, PROBE_INTERVAL_MS);
probeInterval.unref();

module.exports = {
  rpc,
  probeHealth,
  snapshot,
  PRIMARY_URL,
  FALLBACK_URL,
};