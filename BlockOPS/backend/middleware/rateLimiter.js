/**
 * Rate Limiting Middleware
 *
 * Three tiers — applied in app.js at the route level:
 *
 *   globalLimiter  — 300 req / 15 min per IP  (all routes)
 *   chatLimiter    —  60 req / 1 min  per IP  (/api/chat)
 *   priceLimiter   —  60 req / 1 min  per IP  (/price/*)
 *   txLimiter      —  20 req / 1 min  per IP  (transfer, deploy, mint, wallet, allowance)
 */

const rateLimit = require('express-rate-limit');

/** Shared JSON error response format */
function rateLimitHandler(req, res) {
  res.status(429).json({
    success: false,
    error: 'Too many requests. Please slow down.',
    retryAfter: Math.ceil(res.getHeader('Retry-After') || 60)
  });
}

/** Helper to build a limiter with sensible defaults */
function makeLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,   // Return rate-limit info in RateLimit-* headers
    legacyHeaders: false,     // Disable X-RateLimit-* headers
    handler: rateLimitHandler
    // No custom keyGenerator — express-rate-limit's default keys by IP
    // and handles IPv6 normalization correctly out of the box.
    // (If behind a proxy, set app.set('trust proxy', 1) in app.js)
  });
}

// 300 requests per 15 minutes — applies to every route
const globalLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300
});

// 60 requests per minute — for chat / AI inference endpoints
const chatLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 60
});

// 60 requests per minute — for price-fetch endpoints
const priceLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 60
});

// 20 requests per minute — for transaction-signing endpoints
const txLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 20
});

module.exports = { globalLimiter, chatLimiter, priceLimiter, txLimiter };
