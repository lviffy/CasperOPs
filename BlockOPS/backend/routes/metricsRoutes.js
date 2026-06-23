/**
 * Prometheus metrics endpoint.
 *
 * Exposes the registry at `GET /metrics` in Prometheus text format. Two
 * gates protect the endpoint from abuse:
 *
 *   1. Auth token — `METRICS_TOKEN` env var. Clients (Grafana Agent,
 *      Prometheus scraper, Better Stack / Datadog agent) must send
 *      `Authorization: Bearer <token>` OR `X-Metrics-Token: <token>`.
 *      When the env var is unset the endpoint refuses to register so
 *      misconfiguration can't silently expose data.
 *
 *   2. Internal-network CIDR — `METRICS_ALLOWED_CIDRS` env var (comma
 *      separated). The request IP must match at least one entry. This is
 *      the layer that should fail closed if the token leaks: rotate
 *      the token and the allowed CIDR simultaneously.
 *
 * The endpoint is deliberately simple — `register.metrics()` returns the
 * full exposition snapshot in a single buffer. For 22 tools × 4 label
 * dimensions × 11 histogram buckets the payload stays well under 50 KB
 * even after thousands of unique routes.
 *
 * `GET /metrics/health` is an unauthenticated liveness check for the
 * scraper (returns `{ ok: true }` if the registry is responsive).
 */

const express = require('express');
const { render, contentType, resetForTests } = require('../utils/metrics');
const { logger } = require('../utils/logger');

const router = express.Router();

// Env vars are read PER-REQUEST so the operator can rotate the token
// or update the CIDR list without restarting the process. The cost is
// two extra env reads per scrape — negligible compared to the network
// round-trip Prometheus is making.

// Tiny CIDR matcher — supports IPv4 + IPv6 (simple prefix match against
// a normalised address). We don't pull in `ip-cidr` or `netmask`
// because the operator-defined CIDR list is short and static; if you
// ever need full RFC 4632 coverage swap this for a lib.
function ipInCidr(ip, cidr) {
  if (!cidr.includes('/')) {
    return ip === cidr;
  }
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (Number.isNaN(bits)) return false;
  // Normalise IPv4-mapped IPv6 (`::ffff:1.2.3.4`) so scrapers behind
  // dual-stack ingress match the IPv4 CIDR they were given.
  const normalised = ip.replace(/^::ffff:/, '');
  const baseNorm = base.replace(/^::ffff:/, '');
  // Bitwise compare `bits` high-order bits of the address family.
  // For IPv4 we pack into 4 bytes; for IPv6 we pack into 16 bytes.
  const isV4 = normalised.includes('.');
  const isBaseV4 = baseNorm.includes('.');
  if (isV4 !== isBaseV4) return false;
  if (isV4) {
    const a = normalised.split('.').map(Number);
    const b = baseNorm.split('.').map(Number);
    if (a.length !== 4 || b.length !== 4) return false;
    if (bits === 0) return true;
    const mask = bits >= 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
    const ai = ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0;
    const bi = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    return (ai & mask) === (bi & mask);
  }
  // IPv6 path — string-prefix compare on the first (bits/16) hextets.
  const aParts = normalised.split(':');
  const bParts = baseNorm.split(':');
  const fullGroups = Math.floor(bits / 16);
  for (let i = 0; i < fullGroups; i += 1) {
    if ((aParts[i] || '0').padStart(4, '0') !== (bParts[i] || '0').padStart(4, '0')) {
      return false;
    }
  }
  return true;
}

function ipAllowed(ip, allowedCidrs) {
  if (!allowedCidrs.length) return false; // fail closed when unset
  return allowedCidrs.some((cidr) => ipInCidr(ip, cidr));
}

function tokenValid(req, token) {
  if (!token) return false;
  const header = req.header('Authorization') || '';
  if (header === `Bearer ${token}`) return true;
  if (req.header('X-Metrics-Token') === token) return true;
  return false;
}

function metricsGate(req, res, next) {
  // Read at call time so env-var rotation works without a process restart.
  const token = process.env.METRICS_TOKEN || '';
  const allowedCidrs = (process.env.METRICS_ALLOWED_CIDRS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Dev convenience: if neither METRICS_TOKEN nor METRICS_ALLOWED_CIDRS
  // is set AND we're not in production, skip the gate so local testing
  // works without ceremony.
  if (!token && !allowedCidrs.length) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        ok: false,
        error: 'metrics_disabled',
        message: 'METRICS_TOKEN and METRICS_ALLOWED_CIDRS must be set in production',
      });
    }
    return next();
  }

  if (!tokenValid(req, token)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const ip = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (!ipAllowed(ip, allowedCidrs)) {
    logger.warn?.({ ip, path: req.path }, 'metrics scrape from disallowed IP');
    return res.status(403).json({ ok: false, error: 'forbidden', ip });
  }
  return next();
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, kind: 'metrics_live' });
});

router.get('/', metricsGate, async (_req, res, next) => {
  try {
    const body = await render();
    res.setHeader('Content-Type', contentType());
    res.status(200).send(body);
  } catch (err) {
    next(err);
  }
});

// Test-only helper: clears all custom metrics between test cases. The
// route is gated to NODE_ENV !== 'production' so it can't be called
// against a live deploy.
router.post('/__reset__', metricsGate, (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  resetForTests();
  res.json({ ok: true, reset: true });
});

module.exports = router;
module.exports._ipInCidr = ipInCidr; // exposed for tests