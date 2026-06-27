/**
 * Rate Limiting Middleware
 *
 * Four tiers — applied in app.js at the route level:
 *
 *   globalLimiter  — 300 req / 15 min per IP  (all routes)
 *   chatLimiter    —  60 req / 1 min  per IP  (/api/chat)
 *   priceLimiter   —  60 req / 1 min  per IP  (/price/*)
 *   txLimiter      —  20 req / 1 min  per IP  (transfer, deploy, mint, wallet, allowance)
 *   userTxLimiter  —  20 req / 1 min  per user (for authenticated tool execution)
 */

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

/** Shared JSON error response format */
function rateLimitHandler(req, res) {
  res.status(429).json({
    success: false,
    error: 'Too many requests. Please slow down.',
    retryAfter: Math.ceil(res.getHeader('Retry-After') || 60)
  });
}

/** Helper to build a limiter with sensible defaults */
function makeLimiter({ windowMs, max, keyGenerator }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    keyGenerator,
  });
}

// express-rate-limit v8 requires `ipKeyGenerator` for IPv6 compatibility;
// wrapping `req.ip` directly triggers ERR_ERL_KEY_GEN_IPV6 at limiter
// construction time. See https://express-rate-limit.github.io/ERR_ERL_KEY_GEN_IPV6/
const ipKey = (req) => ipKeyGenerator(req.ip);
const userKey = (req) => req.user?.id || req.header('X-User-Id') || ipKeyGenerator(req.ip);

// 300 requests per 15 minutes — applies to every route
const globalLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 300, keyGenerator: ipKey });

// 60 requests per minute — for chat / AI inference endpoints
const chatLimiter = makeLimiter({ windowMs: 60 * 1000, max: 60, keyGenerator: ipKey });

// 60 requests per minute — for price-fetch endpoints
const priceLimiter = makeLimiter({ windowMs: 60 * 1000, max: 60, keyGenerator: ipKey });

// 20 requests per minute — for transaction-signing endpoints
const txLimiter = makeLimiter({ windowMs: 60 * 1000, max: 20, keyGenerator: ipKey });

// 120 requests per minute — for agent management and discovery endpoints
const agentLimiter = makeLimiter({ windowMs: 60 * 1000, max: 120, keyGenerator: ipKey });

// 20 requests per minute per authenticated user — for tool-execution endpoints.
// Per-user (not per-IP) prevents one user behind a shared NAT from blocking
// the entire network.
const userTxLimiter = makeLimiter({ windowMs: 60 * 1000, max: 20, keyGenerator: userKey });

// ── Phase 27: per-tool tier limiters ──────────────────────────────────
// The v1 tool surface categorises every tool into one of three rate
// tiers. Free reads are cheap and we want to allow generous polling;
// paid tools do a CSPR.transfer and deserve to be limited harder to
// prevent abuse; write tools mutate chain state (transfers, deploys,
// agent registrations) and get the strictest cap so a runaway client
// can't burn through the treasury signer.

const FREE_TOOLS = new Set([
  'get_balance', 'get_token_info', 'get_token_balance', 'get_nft_info',
  'lookup_deploy', 'lookup_block', 'fetch_price', 'get_reputation',
  'wallet_readiness', 'calculate',
]);

const PAID_TOOLS = new Set([
  'attest_agent', 'register_agent',
]);

const WRITE_TOOLS = new Set([
  'transfer', 'batch_transfer', 'mint_nft', 'send_email',
  'schedule_reminder', 'cancel_reminder', 'yield_rebalance',
]);

function tierFor(toolId) {
  if (PAID_TOOLS.has(toolId)) return 'paid';
  if (WRITE_TOOLS.has(toolId)) return 'write';
  if (FREE_TOOLS.has(toolId)) return 'free';
  return 'free'; // safe default
}

/**
 * Build a per-tool rate limiter middleware. Reads `req.params.toolId`
 * (the v1 router uses `:toolId`) and applies the appropriate cap.
 *
 * Defaults (overridable via env):
 *   TOOL_LIMIT_FREE_PER_MIN   = 60
 *   TOOL_LIMIT_PAID_PER_MIN   = 20
 *   TOOL_LIMIT_WRITE_PER_MIN  = 10
 *
 * Per-user when authenticated (via `req.apiKey.keyId`), else per-IP.
 * The `tier` label is surfaced in the 429 response so the operator can
 * tell from logs which tier is being throttled.
 */
function perToolLimiter() {
  const freeMax = Number(process.env.TOOL_LIMIT_FREE_PER_MIN) || 60;
  const paidMax = Number(process.env.TOOL_LIMIT_PAID_PER_MIN) || 20;
  const writeMax = Number(process.env.TOOL_LIMIT_WRITE_PER_MIN) || 10;

  return function perToolRateLimit(req, res, next) {
    const toolId = req.params?.toolId || req.body?.toolId || req.body?.tool;
    if (!toolId) return next();
    const tier = tierFor(toolId);
    const max = tier === 'paid' ? paidMax : tier === 'write' ? writeMax : freeMax;
    const key = `tool:${tier}:${req.apiKey?.keyId || ipKeyGenerator(req.ip)}`;
    // Hand-roll a tiny bucket per (key, tier) in-memory. For a single
    // process this is fine; the multi-process Redis-backed limiter
    // comes in a later phase if we scale horizontally.
    const now = Date.now();
    const bucket = perToolLimiter._buckets.get(key) || { count: 0, resetAt: now + 60_000 };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + 60_000;
    }
    bucket.count += 1;
    perToolLimiter._buckets.set(key, bucket);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({
        success: false,
        error: `Rate limit exceeded for ${tier} tool`,
        tier,
        toolId,
        retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
      });
    }
    return next();
  };
}
perToolLimiter._buckets = new Map();
// Reset buckets every minute so they don't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of perToolLimiter._buckets.entries()) {
    if (now > bucket.resetAt + 5 * 60_000) perToolLimiter._buckets.delete(key);
  }
}, 60_000).unref();

/**
 * Phase 29: API-key tier rate limiter.
 *
 * Reads `req.apiKey.tier` (set by apiKeyAuth middleware) and applies the
 * matching per-minute cap. Falls back to "free" if the tier is missing
 * (defence in depth — never trust an untyped key to get pro limits).
 *
 * Tiers:
 *   free       — 60 / min      (default for every new key)
 *   pro        — 600 / min     (Stripe customer with active subscription)
 *   enterprise — 6000 / min    (negotiated contract; key flagged manually)
 */
const API_TIERS = Object.freeze({
  free: { maxPerMin: 60, label: 'Free' },
  pro: { maxPerMin: 600, label: 'Pro' },
  enterprise: { maxPerMin: 6000, label: 'Enterprise' },
});

function tierRateLimiter() {
  return function tierRateLimit(req, res, next) {
    const tier = req.apiKey?.tier && API_TIERS[req.apiKey.tier]
      ? req.apiKey.tier
      : 'free';
    const { maxPerMin, label } = API_TIERS[tier];
    const key = `tier:${tier}:${req.apiKey?.keyId || ipKeyGenerator(req.ip)}`;
    const now = Date.now();
    const bucket = tierRateLimiter._buckets.get(key) || { count: 0, resetAt: now + 60_000 };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + 60_000;
    }
    bucket.count += 1;
    tierRateLimiter._buckets.set(key, bucket);
    res.setHeader('X-RateLimit-Tier', label);
    res.setHeader('X-RateLimit-Limit', String(maxPerMin));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxPerMin - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > maxPerMin) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({
        success: false,
        error: `Rate limit exceeded for ${label} tier`,
        tier,
        limit: maxPerMin,
        upgradeUrl: tier === 'free' ? 'https://casperops.example/pricing' : undefined,
        retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
      });
    }
    return next();
  };
}
tierRateLimiter._buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of tierRateLimiter._buckets.entries()) {
    if (now > bucket.resetAt + 5 * 60_000) tierRateLimiter._buckets.delete(key);
  }
}, 60_000).unref();

module.exports = {
  globalLimiter, chatLimiter, priceLimiter, txLimiter, agentLimiter, userTxLimiter,
  perToolLimiter, tierFor, FREE_TOOLS, PAID_TOOLS, WRITE_TOOLS,
  // Phase 29: tier-based rate limits for self-serve API key holders.
  tierRateLimiter,
  API_TIERS,
};
