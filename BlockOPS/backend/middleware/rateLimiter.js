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

// 20 requests per minute per authenticated user — for tool-execution endpoints.
// Per-user (not per-IP) prevents one user behind a shared NAT from blocking
// the entire network.
const userTxLimiter = makeLimiter({ windowMs: 60 * 1000, max: 20, keyGenerator: userKey });

module.exports = { globalLimiter, chatLimiter, priceLimiter, txLimiter, userTxLimiter };
