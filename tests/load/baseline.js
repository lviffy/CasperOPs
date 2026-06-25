/**
 * Baseline load test — 100 concurrent users hitting free tools.
 *
 * Run with:
 *   k6 run tests/load/baseline.js
 *   k6 run tests/load/baseline.js --env BASE_URL=https://api.casperops.example
 *
 * Targets:
 *   • 100 VUs sustained for 60 s
 *   • p95 latency < 500 ms (cache-miss) / < 100 ms (cache-hit)
 *   • Error rate < 1 %
 *
 * The test exercises a representative mix:
 *   - 50 % GET /v1/tools (catalog, hits the in-memory TOOL_PRICING table)
 *   - 30 % POST /v1/tools/get_balance (cacheable, CSPR.cloud or RPC)
 *   - 10 % POST /v1/tools/fetch_price (cacheable, CoinGecko)
 *   - 10 % POST /v1/tools/lookup_deploy (5 s cache TTL)
 *
 * Master key auth via the env-supplied `MASTER_API_KEY` so the test
 * isn't rate-limited by the per-tool limiter (the test itself wants to
 * measure system limits, not anti-abuse).
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const MASTER_API_KEY = __ENV.MASTER_API_KEY || 'local-dev-master-key-change-me';

// Custom metrics so we can graph cache hit rates in the k6 summary.
const cacheHits = new Counter('casperops_cache_hits');
const cacheMisses = new Counter('casperops_cache_misses');
const errorRate = new Rate('casperops_errors');
const balanceLatency = new Trend('casperops_get_balance_latency_ms', true);
const priceLatency = new Trend('casperops_fetch_price_latency_ms', true);

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    casperops_errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': MASTER_API_KEY,
};

// Spread load across a small pool of test addresses so the read
// cache layer can actually do its job — repeated hits on the same
// address exercise the cache path.
const TEST_ADDRESSES = new SharedArray('addresses', function () {
  // Deterministic test pubkey — won't actually have funds but the
  // backend handles "0 balance" gracefully.
  const addr = '010101010101010101010101010101010101010101010101010101010101010101';
  return Array.from({ length: 10 }, (_, i) => addr);
});

export default function () {
  // Mix of routes per VU cycle.
  const roll = Math.random();
  if (roll < 0.5) {
    // 50 % — catalog (always cache-friendly)
    const res = http.get(`${BASE_URL}/v1/tools`, { headers });
    check(res, {
      'tools 200': (r) => r.status === 200,
      'tools has count': (r) => r.json('count') >= 20,
    });
    errorRate.add(res.status !== 200);
  } else if (roll < 0.8) {
    // 30 % — get_balance
    const addr = TEST_ADDRESSES[Math.floor(Math.random() * TEST_ADDRESSES.length)];
    const res = http.post(
      `${BASE_URL}/v1/tools/get_balance`,
      JSON.stringify({ params: { address: addr } }),
      { headers },
    );
    balanceLatency.add(res.timings.duration);
    const ok = check(res, {
      'balance 200': (r) => r.status === 200 || r.status === 400,
    });
    if (!ok || res.status >= 500) errorRate.add(1);
    // Cache hit detection via response time (cache miss ~300 ms,
    // cache hit <50 ms). Crude but observable.
    if (res.timings.duration < 80) cacheHits.add(1);
    else cacheMisses.add(1);
  } else if (roll < 0.9) {
    // 10 % — fetch_price
    const res = http.post(
      `${BASE_URL}/v1/tools/fetch_price`,
      JSON.stringify({}),
      { headers },
    );
    priceLatency.add(res.timings.duration);
    if (res.status !== 200) errorRate.add(1);
    if (res.timings.duration < 80) cacheHits.add(1);
    else cacheMisses.add(1);
  } else {
    // 10 % — lookup_deploy (5 s TTL)
    const hash = '0'.repeat(64);
    const res = http.post(
      `${BASE_URL}/v1/tools/lookup_deploy`,
      JSON.stringify({ deploy_hash: hash }),
      { headers },
    );
    if (res.status !== 200 && res.status !== 400) errorRate.add(1);
  }
  sleep(0.5);
}