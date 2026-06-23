/**
 * Redis-backed read-through cache for the BlockOps backend.
 *
 * Wraps expensive Casper RPC + CSPR.cloud reads with a short TTL so the
 * same query doesn't blast the chain on every request. The cache layer
 * is **best-effort**: if Redis is down or times out, every call falls
 * through to the underlying fetcher and the cache miss is recorded so
 * the operator can see it on the `blockops_cache_operations_total`
 * metric.
 *
 * Key naming
 * ──────────
 *   blockops:v1:<cache>:<key-hash>
 *
 *   • `cache` ∈ {get_balance, get_token_info, lookup_deploy,
 *     lookup_block, fetch_price, get_reputation, get_token_balance}
 *   • `key-hash` is the sha256 of a normalised JSON serialisation of
 *     the params, so cache keys stay bounded regardless of input size
 *     and don't leak PII into Redis inspection tools.
 *
 * TTLs (configurable per cache)
 * ────────────────────────────
 *   The defaults below were chosen because:
 *   • 30 s  — balances & token info (block-time finality)
 *   • 60 s  — prices & reputation (slow-moving)
 *   • 5 s   — deploy / block lookups (after finality they're immutable,
 *             but we keep a short TTL so devnet / testnet reorgs
 *             don't leave stale entries around)
 *
 * Invalidation
 * ────────────
 *   The `invalidate(cache, params)` helper deletes matching keys on
 *   write events (e.g. attest_agent → invalidate get_reputation).
 *   Wire these in `directToolExecutor.js` for each write tool.
 *
 * For tests
 * ─────────
 *   `resetForTests()` flushes the Redis test-DB. The cache instance is
 *   a lazy singleton so tests can construct their own via
 *   `new CacheService({ url: 'redis://localhost:6379/15' })` to
 *   isolate from production data.
 */

const crypto = require('crypto');
const Redis = require('ioredis');
const { logger } = require('../utils/logger');
const { cacheOperationsTotal } = require('../utils/metrics');

// Default TTLs (seconds) keyed by cache name.
const DEFAULT_TTLS = Object.freeze({
  get_balance: 30,
  get_token_balance: 30,
  get_token_info: 60,
  fetch_price: 60,
  get_reputation: 60,
  lookup_deploy: 5,
  lookup_block: 5,
});

// Per-cache failure tracking: if a cache trips 10 failures in a row we
// disable it for 30 s to avoid hammering Redis. This is a circuit
// breaker lite — full blown we'd use opossum.
const FAILURE_WINDOW = 10;
const COOLDOWN_SECONDS = 30;

class CacheService {
  constructor({
    url = process.env.REDIS_URL || null,
    keyPrefix = 'blockops:v1:',
    connectTimeoutMs = 1500,
    commandTimeoutMs = 500,
    lazyConnect = true,
  } = {}) {
    this.url = url;
    this.keyPrefix = keyPrefix;
    this.commandTimeoutMs = commandTimeoutMs;
    this._client = null;
    this._connectTimeoutMs = connectTimeoutMs;
    this._failureCounters = new Map();
    this._disabledUntil = new Map();
    this._enabled = Boolean(url);
  }

  // ── connection management ────────────────────────────────────────────
  _getClient() {
    if (!this._enabled) return null;
    if (this._client) return this._client;
    try {
      this._client = new Redis(this.url, {
        connectTimeout: this._connectTimeoutMs,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy(times) {
          // Back off exponentially, capped at 2s. Keeps the noise out
          // of the event loop when Redis is misconfigured.
          return Math.min(2000, 50 * Math.pow(2, Math.min(times, 5)));
        },
      });
      this._client.on('error', (err) => {
        logger.warn?.({ err: err.message, code: err.code }, 'cache redis error');
      });
      this._client.connect().catch((err) => {
        logger.warn?.({ err: err.message }, 'cache redis connect failed');
        this._client = null;
      });
      return this._client;
    } catch (err) {
      logger.warn?.({ err: err.message }, 'cache redis init failed');
      this._client = null;
      return null;
    }
  }

  async close() {
    if (this._client) {
      try { await this._client.quit(); } catch (_) { /* ignore */ }
      this._client = null;
    }
  }

  // ── circuit breaker lite ─────────────────────────────────────────────
  _isDisabled(cache) {
    const until = this._disabledUntil.get(cache);
    if (!until) return false;
    if (Date.now() < until) return true;
    this._disabledUntil.delete(cache);
    this._failureCounters.set(cache, 0);
    return false;
  }

  _recordFailure(cache) {
    const n = (this._failureCounters.get(cache) || 0) + 1;
    this._failureCounters.set(cache, n);
    if (n >= FAILURE_WINDOW) {
      this._disabledUntil.set(cache, Date.now() + COOLDOWN_SECONDS * 1000);
      logger.warn?.({ cache, failures: n }, 'cache disabled (cooldown)');
    }
  }

  _recordSuccess(cache) {
    this._failureCounters.set(cache, 0);
  }

  // ── key helpers ──────────────────────────────────────────────────────
  _keyFor(cache, params) {
    const json = JSON.stringify(params ?? {}, Object.keys(params ?? {}).sort());
    const hash = crypto.createHash('sha256').update(json).digest('hex');
    return `${this.keyPrefix}${cache}:${hash}`;
  }

  /**
   * Read-through cache: returns the cached value or calls `fetcher`,
   * caches the result, and returns it. Returns `undefined` only if
   * both cache and fetcher fail — in that case the caller's error
   * handler takes over.
   *
   * `params` must be JSON-serialisable. Use it as a deterministic
   * cache key so `(address, "cspr")` and `(address, "usdc")` get
   * distinct entries.
   */
  async getOrFetch(cache, params, fetcher, { ttl } = {}) {
    if (!this._enabled) {
      try { cacheOperationsTotal.inc({ cache, op: 'get', result: 'disabled' }); } catch (_) {}
      try { cacheOperationsTotal.inc({ cache, op: 'set', result: 'disabled' }); } catch (_) {}
      return fetcher();
    }
    if (this._isDisabled(cache)) {
      try { cacheOperationsTotal.inc({ cache, op: 'get', result: 'disabled' }); } catch (_) {}
      return fetcher();
    }

    const client = this._getClient();
    const key = this._keyFor(cache, params);
    const ttlSeconds = ttl ?? DEFAULT_TTLS[cache] ?? 30;

    // 1. Cache read
    if (client) {
      try {
        const cached = await client.get(key);
        if (cached !== null) {
          try { cacheOperationsTotal.inc({ cache, op: 'get', result: 'hit' }); } catch (_) {}
          this._recordSuccess(cache);
          try { return JSON.parse(cached); } catch (_) { return cached; }
        }
        try { cacheOperationsTotal.inc({ cache, op: 'get', result: 'miss' }); } catch (_) {}
      } catch (err) {
        this._recordFailure(cache);
        try { cacheOperationsTotal.inc({ cache, op: 'get', result: 'error' }); } catch (_) {}
      }
    }

    // 2. Cache miss → fetch
    const value = await fetcher();

    // 3. Cache write (fire and forget so a slow Redis doesn't slow the request)
    if (client && value !== undefined && value !== null) {
      client.set(key, JSON.stringify(value), 'EX', ttlSeconds).then(() => {
        try { cacheOperationsTotal.inc({ cache, op: 'set', result: 'ok' }); } catch (_) {}
        this._recordSuccess(cache);
      }).catch((err) => {
        this._recordFailure(cache);
        try { cacheOperationsTotal.inc({ cache, op: 'set', result: 'error' }); } catch (_) {}
      });
    }
    return value;
  }

  /**
   * Invalidate every cached entry for a (cache, params) pair. Used by
   * write tools (attest_agent, transfer, set_paused) to keep reads
   * consistent with the new chain state.
   */
  async invalidate(cache, params) {
    if (!this._enabled) return 0;
    const client = this._getClient();
    if (!client) return 0;
    const key = this._keyFor(cache, params);
    try {
      const deleted = await client.del(key);
      try { cacheOperationsTotal.inc({ cache, op: 'del', result: 'ok' }); } catch (_) {}
      return deleted;
    } catch (err) {
      this._recordFailure(cache);
      try { cacheOperationsTotal.inc({ cache, op: 'del', result: 'error' }); } catch (_) {}
      return 0;
    }
  }

  /**
   * Invalidate every entry that matches a glob pattern. Used by
   * `set_paused` to flush all tool caches for the affected contract.
   * SCAN + DEL pattern keeps Redis responsive on big keysets.
   */
  async invalidatePattern(pattern) {
    if (!this._enabled) return 0;
    const client = this._getClient();
    if (!client) return 0;
    let cursor = '0';
    let total = 0;
    do {
      let batch;
      try {
        batch = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      } catch (err) {
        this._recordFailure('*');
        return total;
      }
      cursor = batch[0];
      const keys = batch[1];
      if (keys.length > 0) {
        try {
          const deleted = await client.del(...keys);
          total += deleted;
        } catch (_) { /* swallow */ }
      }
    } while (cursor !== '0');
    return total;
  }

  /**
   * Test-only helper: drop the underlying connection + counters.
   * Production code never calls this.
   */
  async resetForTests() {
    if (this._client) {
      try { await this._client.flushdb(); } catch (_) { /* ignore */ }
      try { await this._client.quit(); } catch (_) { /* ignore */ }
    }
    this._client = null;
    this._failureCounters.clear();
    this._disabledUntil.clear();
  }
}

// ── singleton accessor ─────────────────────────────────────────────────

let _instance = null;

function getCache(opts = {}) {
  if (!_instance) _instance = new CacheService(opts);
  return _instance;
}

function _resetForTests() {
  if (_instance) _instance = null;
}

module.exports = {
  CacheService,
  getCache,
  DEFAULT_TTLS,
  // exposed for tests
  _resetForTests,
};