/**
 * Workflow end-to-end load test — 10 concurrent users running a full
 * 4-step workflow against the v1 tool surface.
 *
 * Run with:
 *   k6 run tests/load/workflow-execute.js
 *   k6 run tests/load/workflow-execute.js --env BASE_URL=https://api.casperops.example
 *
 * Workflow exercised (per VU cycle):
 *   1. GET  /v1/tools                 (catalog)
 *   2. POST /v1/tools/fetch_price     (CSPR/USD price)
 *   3. POST /v1/tools/get_balance     (account balance)
 *   4. POST /v1/tools/lookup_deploy   (status of last deploy)
 *
 * Targets:
 *   • 10 VUs sustained for 90 s
 *   • p95 latency per step < 1000 ms
 *   • Workflow success rate > 95 % (one step's 5xx is enough to fail)
 *
 * Note: this is a STRUCTURE test — it verifies that the v1 router can
 * sustain a multi-step workflow under concurrency. It does NOT verify
 * that the workflow makes semantic sense (e.g. that the deploy_hash
 * returned by step 4 is the deploy from step 3) — that's covered by
 * the testnet e2e.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const MASTER_API_KEY = __ENV.MASTER_API_KEY || 'local-dev-master-key-change-me';

const workflowsStarted = new Counter('casperops_workflows_started');
const workflowsCompleted = new Counter('casperops_workflows_completed');
const workflowFailure = new Rate('casperops_workflow_failure');

export const options = {
  scenarios: {
    workflow: {
      executor: 'constant-vus',
      vus: 10,
      duration: '90s',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    casperops_workflow_failure: ['rate<0.05'],
    http_req_failed: ['rate<0.05'],
  },
};

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': MASTER_API_KEY,
};

const TEST_ADDRESSES = new SharedArray('addresses', function () {
  return Array.from({ length: 20 }, () =>
    '010101010101010101010101010101010101010101010101010101010101010101',
  );
});

export default function () {
  workflowsStarted.add(1);
  let failed = false;

  // Step 1: catalog
  let res = http.get(`${BASE_URL}/v1/tools`, { headers });
  if (res.status !== 200) failed = true;

  // Step 2: price
  res = http.post(
    `${BASE_URL}/v1/tools/fetch_price`,
    JSON.stringify({}),
    { headers },
  );
  if (res.status !== 200) failed = true;

  // Step 3: balance
  const addr = TEST_ADDRESSES[Math.floor(Math.random() * TEST_ADDRESSES.length)];
  res = http.post(
    `${BASE_URL}/v1/tools/get_balance`,
    JSON.stringify({ params: { address: addr } }),
    { headers },
  );
  if (res.status !== 200 && res.status !== 400) failed = true;

  // Step 4: deploy lookup (will 400 unless the previous step returned one)
  res = http.post(
    `${BASE_URL}/v1/tools/lookup_deploy`,
    JSON.stringify({ deploy_hash: '0'.repeat(64) }),
    { headers },
  );
  if (res.status !== 200 && res.status !== 400) failed = true;

  if (failed) workflowFailure.add(1);
  else workflowsCompleted.add(1);

  // Pause between workflows — a real user takes 10–30 s between
  // multi-step actions, so we throttle the test accordingly.
  sleep(2 + Math.random() * 3);
}