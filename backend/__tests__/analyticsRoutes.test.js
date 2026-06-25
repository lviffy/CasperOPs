'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const analyticsRoutes = require('../routes/analyticsRoutes');

describe('Analytics routes logic', () => {
  it('GET /analytics/x402 returns successful metrics', async () => {
    const req = { query: {} };
    let jsonResult = null;
    const res = {
      json: (data) => {
        jsonResult = data;
        return res;
      },
      status: (code) => {
        res.statusCode = code;
        return res;
      }
    };

    const route = analyticsRoutes.stack.find(
      (r) => r.route && r.route.path === '/analytics/x402' && r.route.methods.get
    );
    assert.ok(route, 'analytics route path /analytics/x402 is not registered');

    await route.route.stack[0].handle(req, res);

    assert.equal(jsonResult.ok, true);
    assert.equal(jsonResult.period, '7d');
    assert.ok(jsonResult.metrics);
    assert.ok(jsonResult.metrics.totalCsprSettled > 0);
    assert.ok(jsonResult.metrics.totalTransactions > 0);
    assert.ok(jsonResult.metrics.cacheHitRatio > 0);
    assert.ok(Array.isArray(jsonResult.metrics.topTools));
    assert.ok(Array.isArray(jsonResult.metrics.dailyVolume));
  });

  it('GET /analytics/x402 respects custom period query param', async () => {
    const req = { query: { period: '30d' } };
    let jsonResult = null;
    const res = {
      json: (data) => {
        jsonResult = data;
        return res;
      }
    };

    const route = analyticsRoutes.stack.find(
      (r) => r.route && r.route.path === '/analytics/x402' && r.route.methods.get
    );
    await route.route.stack[0].handle(req, res);

    assert.equal(jsonResult.ok, true);
    assert.equal(jsonResult.period, '30d');
  });
});
