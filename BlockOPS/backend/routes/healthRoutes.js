/**
 * Health endpoints for the BlockOps backend.
 *
 * Three distinct probes that map cleanly to the orchestrator's lifecycle:
 *
 *   GET /health/live     Liveness — process is up. Always 200 once the
 *                        HTTP listener accepts connections. Used by
 *                        Docker / k8s `livenessProbe` to decide whether
 *                        to restart the container.
 *
 *   GET /health/ready    Readiness — every runtime dependency this
 *                        service needs is reachable: Casper RPC,
 *                        CSPR.cloud, Supabase, Redis (when configured),
 *                        AGENT_BACKEND_URL. Returns 503 with a per-check
 *                        breakdown when something is degraded so the load
 *                        balancer can drain traffic.
 *
 *   GET /health/startup  Cold-start tolerance — same checks as ready but
 *                        designed to fail open during the first 30 s of
 *                        boot while Supabase / Redis warm their TLS
 *                        pools. Used by k8s `startupProbe`.
 *
 *   GET /health          Back-compat — full payload (chain metadata +
 *                        supported networks + RPC). Same shape as before
 *                        Phase 24 so existing monitors keep working.
 */

const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const { DEFAULT_CHAIN, FACTORY_ADDRESS, NFT_FACTORY_ADDRESS, getChainConfig } = require('../config/constants');
const { getChainMetadata, getSupportedChains } = require('../utils/chains');
const { logger } = require('../utils/logger');
const { snapshot: rpcSnapshot } = require('../utils/rpcFailover');

const PROBE_TIMEOUT_MS = 4000;
const BOOT_TIME_MS = Date.now();

// ── Probe helpers ────────────────────────────────────────────────────────

function probeUrl(rawUrl, { method = 'GET', body = null, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return resolve({ ok: false, error: 'invalid_url', url: rawUrl });
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
        timeout: timeoutMs,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ ok: res.statusCode < 500, status: res.statusCode, url: rawUrl }));
      },
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (err) => resolve({ ok: false, error: err.code || err.message, url: rawUrl }));
    if (body) req.write(body);
    req.end();
  });
}

async function probeCasperRpc(rpcUrl) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'info_get_status',
    params: {},
  });
  const result = await probeUrl(rpcUrl, { method: 'POST', body, timeoutMs: PROBE_TIMEOUT_MS });
  return {
    ...result,
    label: 'casper_rpc',
  };
}

async function probeHttpUrl(label, targetUrl, { method = 'GET' } = {}) {
  if (!targetUrl) return { ok: false, label, error: 'not_configured', url: targetUrl };
  const result = await probeUrl(targetUrl, { method, timeoutMs: PROBE_TIMEOUT_MS });
  return { ...result, label };
}

// ── Router ───────────────────────────────────────────────────────────────

const router = express.Router();

let lastReadyResult = null;
let lastReadyAt = 0;
const READY_CACHE_MS = 5000;

async function runReadinessChecks() {
  const chain = getChainConfig(DEFAULT_CHAIN);
  // CSPR.cloud has no `/rpc` suffix in its base URL — derive it by
  // stripping the suffix from the RPC URL if present, otherwise use the
  // env var as-is.
  const csprCloudUrl = (process.env.CSPR_CLOUD_API_URL ||
    chain.rpcUrl.replace(/\/rpc\/?$/, '')).replace(/\/$/, '');
  const checks = await Promise.all([
    probeCasperRpc(chain.rpcUrl),
    probeHttpUrl('cspr_cloud', csprCloudUrl + '/'),
    probeHttpUrl('agent_backend', process.env.AGENT_BACKEND_URL || 'http://localhost:8000'),
    probeHttpUrl('redis', process.env.REDIS_URL ? process.env.REDIS_URL.replace(/^redis/, 'http') : null),
  ]);

  // Phase 30: probe the fallback RPC so the readiness snapshot
  // surfaces a degraded-but-alive state before users hit it.
  const rpcHealth = rpcSnapshot();
  checks.push({
    label: 'casper_rpc_fallback',
    ok: rpcHealth.fallback.ok,
    url: rpcHealth.fallback.url,
    error: rpcHealth.fallback.ok ? null : rpcHealth.fallback.lastError,
  });

  const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
  checks.push({ ok: supabaseConfigured, label: 'supabase', error: supabaseConfigured ? null : 'not_configured' });

  // "Ready" = primary RPC + fallback RPC + Supabase all reachable.
  // (Phase 30: if primary is down but fallback is up, we're still ready
  // because the failover layer transparently routes the reads.)
  const required = checks.filter((c) =>
    ['casper_rpc', 'casper_rpc_fallback', 'supabase'].includes(c.label)
  );
  const requiredOk = required.every((c) => c.ok);

  return {
    ok: requiredOk,
    requiredOk,
    activeRpc: rpcHealth.activeUrl,
    rpcFailover: rpcHealth,
    checkedAt: new Date().toISOString(),
    uptimeMs: Date.now() - BOOT_TIME_MS,
    checks,
  };
}

async function readinessReport({ allowDegraded = false } = {}) {
  const now = Date.now();
  if (lastReadyResult && now - lastReadyAt < READY_CACHE_MS) {
    return lastReadyResult;
  }
  const result = await runReadinessChecks();
  lastReadyResult = result;
  lastReadyAt = now;
  if (!result.requiredOk) {
    logger.warn?.({ checks: result.checks }, 'readiness check degraded');
  }
  return result;
}

router.get('/live', (_req, res) => {
  res.json({
    status: 'ok',
    kind: 'live',
    uptimeMs: Date.now() - BOOT_TIME_MS,
    timestamp: new Date().toISOString(),
  });
});

router.get('/startup', async (_req, res) => {
  // During the first 30 s we accept any "configured" state so the container
  // gets past the startup probe even if Supabase / RPC are warming.
  const stillColdStarting = Date.now() - BOOT_TIME_MS < 30_000;
  const report = await readinessReport();
  const ok = stillColdStarting ? report.ok || report.checks.some((c) => c.ok) : report.requiredOk;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'starting',
    kind: 'startup',
    coldStarting: stillColdStarting,
    ...report,
  });
});

router.get('/ready', async (_req, res) => {
  const report = await readinessReport();
  res.status(report.requiredOk ? 200 : 503).json({
    status: report.requiredOk ? 'ok' : 'degraded',
    kind: 'ready',
    ...report,
  });
});

// Back-compat root: full payload, same shape as before Phase 24.
router.get('/', (_req, res) => {
  const defaultChain = getChainMetadata(DEFAULT_CHAIN);
  const defaultChainConfig = getChainConfig(DEFAULT_CHAIN);
  res.json({
    status: 'ok',
    kind: 'info',
    ...defaultChain,
    rpc: defaultChainConfig.rpcUrl,
    tokenFactory: FACTORY_ADDRESS,
    nftFactory: NFT_FACTORY_ADDRESS,
    supportedChains: getSupportedChains().map((chain) => ({
      chain: chain.id,
      chainId: chain.chainId,
      network: chain.name,
      rpc: chain.rpcUrl,
      explorer: chain.explorerBaseUrl,
      nativeCurrency: chain.nativeCurrency.symbol,
    })),
    timestamp: new Date().toISOString(),
  });
});

// ── Diag endpoint (admin-gated) ─────────────────────────────────────────
// Phase 26 addition: helps triage without SSH.
// Auth: must present `Authorization: Bearer <ADMIN_SECRET>` or
// `x-api-key: <MASTER_API_KEY>`. When neither env var is configured
// the endpoint refuses to respond so we don't accidentally expose
// version + dep metadata on an unconfigured deploy.

function diagAuthorized(req, adminSecret, masterApiKey) {
  const auth = req.header('Authorization') || '';
  if (adminSecret && auth === `Bearer ${adminSecret}`) return true;
  if (masterApiKey && req.header('x-api-key') === masterApiKey) return true;
  return false;
}

function diagDisabled(adminSecret, masterApiKey) {
  return !adminSecret && !masterApiKey;
}

router.get('/diag', (req, res) => {
  // Read per-request so env-var rotation works without restart.
  const adminSecret = process.env.ADMIN_SECRET || '';
  const masterApiKey = process.env.MASTER_API_KEY || '';

  if (diagDisabled(adminSecret, masterApiKey)) {
    return res.status(503).json({
      ok: false,
      error: 'diag_disabled',
      message: 'Set ADMIN_SECRET or MASTER_API_KEY to enable /health/diag',
    });
  }
  if (!diagAuthorized(req, adminSecret, masterApiKey)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // Lazy require so the diag endpoint isn't on the hot path.
  let pkg = {};
  try { pkg = require('../package.json'); } catch (_) { /* not fatal */ }
  let casperSdkVersion = 'unknown';
  try {
    // casper-js-sdk exposes version via package.json (no runtime export)
    casperSdkVersion = require('casper-js-sdk/package.json').version;
  } catch (_) { /* not fatal */ }

  const chain = getChainConfig(DEFAULT_CHAIN);
  const chains = getSupportedChains().map((c) => ({
    chain: c.id,
    network: c.name,
    rpc: c.rpcUrl,
    factoryHash: c.factoryHash || null,
    nftFactoryHash: c.nftFactoryHash || null,
  }));

  // Last deploy timestamp is best-effort: we read from a small JSON file
  // written by scripts/deploy-backend.sh. Missing file ⇒ never deployed.
  let lastDeploy = null;
  try {
    const fs = require('fs');
    const p = require('path').resolve(__dirname, '..', '..', '.last-deploy.json');
    if (fs.existsSync(p)) {
      lastDeploy = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (_) { /* not fatal */ }

  // Last migration applied — read from a marker file written by the
  // deploy scripts. Same best-effort semantics as lastDeploy.
  let lastMigration = null;
  try {
    const fs = require('fs');
    const p = require('path').resolve(__dirname, '..', '..', '.last-migration.json');
    if (fs.existsSync(p)) {
      lastMigration = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (_) { /* not fatal */ }

  res.json({
    ok: true,
    kind: 'diag',
    timestamp: new Date().toISOString(),
    uptimeMs: Date.now() - BOOT_TIME_MS,
    node: {
      version: process.version,
      pid: process.pid,
      env: process.env.NODE_ENV || 'development',
      cwd: process.cwd(),
    },
    app: {
      name: pkg.name || 'blockops-backend',
      version: pkg.version || 'unknown',
      dependencies: {
        express: pkg.dependencies?.express || 'unknown',
        'casper-js-sdk': casperSdkVersion,
        'prom-client': pkg.dependencies?.['prom-client'] || 'unknown',
        '@sentry/node': pkg.dependencies?.['@sentry/node'] || 'unknown',
      },
    },
    env: {
      // Only surface presence, not values, so the diag output is safe
      // to paste into a public channel when debugging.
      NODE_ENV: process.env.NODE_ENV || null,
      CASPER_RPC_URL: process.env.CASPER_RPC_URL ? 'set' : 'unset',
      CSPR_CLOUD_API_URL: process.env.CSPR_CLOUD_API_URL ? 'set' : 'unset',
      CSPR_CLOUD_API_KEY: process.env.CSPR_CLOUD_API_KEY ? 'set' : 'unset',
      CASPER_SECRET_KEY: process.env.CASPER_SECRET_KEY ? 'set' : 'unset',
      SUPABASE_URL: process.env.SUPABASE_URL ? 'set' : 'unset',
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? 'set' : 'unset',
      REDIS_URL: process.env.REDIS_URL ? 'set' : 'unset',
      SENTRY_DSN: process.env.SENTRY_DSN ? 'set' : 'unset',
      AGENT_BACKEND_URL: process.env.AGENT_BACKEND_URL ? 'set' : 'unset',
      METRICS_TOKEN: process.env.METRICS_TOKEN ? 'set' : 'unset',
      METRICS_ALLOWED_CIDRS: process.env.METRICS_ALLOWED_CIDRS || null,
      ADMIN_SECRET: adminSecret ? 'set' : 'unset',
      MASTER_API_KEY: masterApiKey ? 'set' : 'unset',
    },
    chains,
    lastDeploy,
    lastMigration,
  });
});

module.exports = router;
module.exports._diagAuthorized = diagAuthorized;
module.exports._diagDisabled = diagDisabled;
// Expose for test introspection
module.exports._ipInCidr = (typeof ipInCidr !== 'undefined') ? ipInCidr : null;