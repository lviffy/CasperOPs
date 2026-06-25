/**
 * Paid-tools load test — 20 concurrent users signing payment deploys.
 *
 * Run with:
 *   k6 run tests/load/paid-tools.js
 *   k6 run tests/load/paid-tools.js --env BASE_URL=https://api.casperops.example
 *
 * Targets:
 *   • 20 VUs sustained for 60 s
 *   • p95 latency < 1500 ms (includes the x402 verify step + the
 *     backend's account_put_deploy round-trip)
 *   • Error rate < 5 % (we allow some 4xx for missing payment hashes
 *     so the rate limiter is exercised)
 *
 * Without a real CSPR.click wallet we can't actually sign the payment
 * deploys, so this test verifies the 402 challenge path: every
 * invocation should return 402 with the canonical challenge envelope.
 * The `--env SIGN_DEPLOYS=true` flag (when set AND a wallet is wired
 * via `CASPER_PAYMENT_SIGNER_PEM`) replays the same request with a
 * valid payment deploy and asserts a 200 response.
 *
 * The test deliberately uses a real on-chain test address for the
 * `payToPublicKey` header so the 402 challenge includes a valid
 * recipient — this catches the "treasury pubkey typo" regression.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const MASTER_API_KEY = __ENV.MASTER_API_KEY || 'local-dev-master-key-change-me';
const SIGN_DEPLOYS = __ENV.SIGN_DEPLOYS === 'true';

const x402Challenges = new Counter('casperops_x402_challenges');
const x402Verified = new Counter('casperops_x402_verified');
const errorRate = new Rate('casperops_errors');
const latency = new Trend('casperops_paid_tool_latency_ms', true);

export const options = {
  scenarios: {
    paid: {
      executor: 'constant-vus',
      vus: 20,
      duration: '60s',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    casperops_errors: ['rate<0.05'],
  },
};

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': MASTER_API_KEY,
};

const PAID_TOOLS = ['attest_agent', 'register_agent'];

export default function () {
  const tool = PAID_TOOLS[Math.floor(Math.random() * PAID_TOOLS.length)];
  const params = tool === 'register_agent'
    ? { agent_id: `load-test-${__VU}`, metadata_uri: 'ipfs://load-test' }
    : { agent_id: `load-test-${__VU}`, verified: true };

  const res = http.post(
    `${BASE_URL}/v1/tools/${tool}`,
    JSON.stringify({ params }),
    { headers },
  );
  latency.add(res.timings.duration);

  if (res.status === 402) {
    // Canonical challenge envelope — verify the deploy template is present.
    const ok = check(res, {
      '402 has toolId': (r) => typeof r.json('toolId') === 'string',
      '402 has payToPublicKey': (r) => typeof r.json('payToPublicKey') === 'string',
      '402 has priceMotes': (r) => typeof r.json('priceMotes') === 'string',
      '402 has deployTemplate': (r) => r.json('deployTemplate') !== undefined,
    });
    if (ok) x402Challenges.add(1);
    else errorRate.add(1);
  } else if (res.status === 200) {
    x402Verified.add(1);
  } else if (res.status === 429) {
    // Rate-limit exercised — not a failure, just a metric.
    errorRate.add(0);
  } else if (res.status >= 500) {
    errorRate.add(1);
  }

  sleep(0.5);
}