'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Set up test environment before requiring modules
process.env.NODE_ENV = 'development';
process.env.MASTER_API_KEY = 'test_master_key';
process.env.STRIPE_DISABLED = '1';

const { getToolPrice, motesToCspr } = require('../utils/chains');

describe('billing analytics — GET /billing/analytics logic', () => {
  it('getToolPrice correctly identifies paid tools', () => {
    const price = getToolPrice('transfer');
    assert.equal(price.tier, 'paid');
    assert.ok(price.priceMotes > 0);
  });

  it('getToolPrice correctly identifies free tools', () => {
    const price = getToolPrice('get_balance');
    assert.equal(price.tier, 'free');
    assert.equal(price.priceMotes, 0);
  });

  it('motesToCspr correctly converts paid tool prices', () => {
    const price = getToolPrice('transfer');
    const cspr = Number(motesToCspr(price.priceMotes));
    assert.ok(cspr > 0);
    assert.ok(cspr < 1); // transfer is 0.10 CSPR
  });

  it('analytics summary structure is correct shape', () => {
    // Simulate the analytics aggregation logic
    const toolsData = [
      { tool_name: 'transfer', success: true, created_at: new Date().toISOString() },
      { tool_name: 'get_balance', success: true, created_at: new Date().toISOString() },
      { tool_name: 'deploy_cep18', success: true, created_at: new Date().toISOString() },
    ];

    let totalSpentCspr = 0;
    let cacheSavingsCspr = 0;
    let totalToolCalls = 0;
    let cachedToolCalls = 0;

    toolsData.forEach(logEntry => {
      const price = getToolPrice(logEntry.tool_name);
      totalToolCalls += 1;

      if (price.tier === 'free') {
        cacheSavingsCspr += 0.05;
        cachedToolCalls += 1;
      }

      if (price.tier === 'paid' && logEntry.success) {
        totalSpentCspr += Number(motesToCspr(price.priceMotes));
      }
    });

    const summary = {
      totalSpentCspr: Number(totalSpentCspr.toFixed(2)),
      cacheSavingsCspr: Number(cacheSavingsCspr.toFixed(2)),
      totalToolCalls,
      cachedToolCalls,
      activeTier: 'free',
      subscriptionStatus: 'none'
    };

    assert.equal(summary.totalToolCalls, 3);
    assert.equal(summary.cachedToolCalls, 1); // get_balance is free
    assert.ok(summary.totalSpentCspr > 0); // transfer + deploy_cep18 cost
    assert.ok(summary.cacheSavingsCspr > 0); // get_balance saves
    assert.equal(summary.activeTier, 'free');
  });
});
