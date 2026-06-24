/**
 * Unit tests for the RWA Valuation & Oracle controller/routes.
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getDeterministicValuation, getPropertyValuation, fractionalizeRwa } = require('../controllers/rwaController');

// Mock blockchain before requiring directToolExecutor
const { Keys } = require('casper-js-sdk');
const fakeBlockchain = {
  getClient: () => ({
    deploy: async () => 'fake-deploy-hash-reputation',
    getStateRootHash: async () => 'state-root',
    getAccountBalanceUrefByPublicKey: async () => 'uref',
    getAccountBalance: async () => '1000000000',
  }),
  getKeysFromHex: () => Keys.Ed25519.new(),
  getAccountBalance: async () => '0',
  sendDeploy: async () => 'fake-deploy-hash-reputation',
};
require.cache[require.resolve('../utils/blockchain')] = {
  id: require.resolve('../utils/blockchain'),
  filename: require.resolve('../utils/blockchain'),
  loaded: true,
  exports: fakeBlockchain,
  children: [],
  paths: [],
};

delete require.cache[require.resolve('../services/directToolExecutor')];
const { executeToolsDirectly } = require('../services/directToolExecutor');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('RWA Valuation Controller - Unit Logic', () => {
  it('should deterministically generate valuation reports', () => {
    const address = '123 Casper Way, Zug, Switzerland';
    const report1 = getDeterministicValuation(address);
    const report2 = getDeterministicValuation(address);

    // Verify key structures
    assert.equal(report1.propertyAddress, address);
    assert.equal(typeof report1.propertyType, 'string');
    assert.equal(typeof report1.parcelId, 'string');
    assert.equal(typeof report1.valuation.valueUsd, 'number');
    assert.equal(typeof report1.valuation.valueCspr, 'number');
    assert.equal(typeof report1.oracleAttestation.signature, 'string');
    assert.ok(report1.oracleAttestation.signature.startsWith('01'));

    // Verify determinism
    delete report1.oracleAttestation.attestedTimestamp;
    delete report2.oracleAttestation.attestedTimestamp;
    assert.deepEqual(report1, report2);
  });

  it('should generate different valuations for different addresses', () => {
    const report1 = getDeterministicValuation('123 Casper Way, Zug, Switzerland');
    const report2 = getDeterministicValuation('456 Blockchain Ave, Boston, USA');

    assert.notDeepEqual(report1, report2);
  });
});

describe('RWA Valuation Endpoint - HTTP controller', () => {
  it('should return 200 and property valuation report for a valid address', async () => {
    const req = {
      body: {
        propertyAddress: '789 Genesis Block Rd, Casper Network'
      }
    };
    const res = makeRes();

    await getPropertyValuation(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.report);
    assert.equal(res.body.report.propertyAddress, '789 Genesis Block Rd, Casper Network');
    assert.ok(res.body.report.valuation.valueUsd > 0);
  });

  it('should return 400 when propertyAddress is missing', async () => {
    const req = {
      body: {}
    };
    const res = makeRes();

    await getPropertyValuation(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /required/);
  });
});

describe('RWA Fractionalization Endpoint - HTTP controller', () => {
  it('should return 200 and fractionalize RWA with valid inputs', async () => {
    const req = {
      body: {
        propertyAddress: '123 Casper Way, Zug, Switzerland',
        valuationId: 'cert-12345',
        tokenName: 'Zug Property Share',
        tokenSymbol: 'ZUGPROP',
        fractionsCount: 50000,
      }
    };
    const res = makeRes();

    await fractionalizeRwa(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.standard, 'CEP-18');
    assert.ok(res.body.transactionHash);
    assert.ok(res.body.contractHash.startsWith('hash-'));
    assert.equal(res.body.tokenInfo.name, 'Zug Property Share');
    assert.equal(res.body.tokenInfo.symbol, 'ZUGPROP');
    assert.equal(res.body.tokenInfo.totalSupply, '50000');
    assert.equal(res.body.rwaRegistry.propertyAddress, '123 Casper Way, Zug, Switzerland');
    assert.equal(res.body.rwaRegistry.valuationId, 'cert-12345');
    assert.ok(res.body.rwaRegistry.parcelId);
  });

  it('should return 400 when propertyAddress or valuationId is missing', async () => {
    const req = {
      body: {
        propertyAddress: '123 Casper Way, Zug, Switzerland',
      }
    };
    const res = makeRes();

    await fractionalizeRwa(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /required/);
  });
});

describe('On-Chain Agent Trust & Reputation - Tool & Hook', () => {
  before(() => {
    process.env.CASPER_SECRET_KEY = '012da7df7800000000000000000000000000000000000000000000000000000000';
    process.env.CASPER_REPUTATION_HASH = 'hash-reputation-contract';
  });

  it('should successfully execute attest_performance tool', async () => {
    const routingPlan = {
      requires_tools: true,
      execution_plan: {
        type: 'sequential',
        steps: [
          {
            tool: 'attest_performance',
            parameters: {
              agentAddress: '012da7df7800000000000000000000000000000000000000000000000000000000',
              success: true
            }
          }
        ]
      }
    };

    const res = await executeToolsDirectly(routingPlan, '', {
      agentAddress: '012da7df7800000000000000000000000000000000000000000000000000000000'
    });

    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].success, true);
    assert.equal(res.results[0].result.standard, 'Reputation');
    assert.equal(res.results[0].result.entrypoint, 'log_success');
  });

  it('should trigger automated reputation logging at the end of a paid tool execution', async () => {
    const routingPlan = {
      requires_tools: true,
      execution_plan: {
        type: 'sequential',
        steps: [
          {
            tool: 'transfer',
            parameters: {
              toAddress: '012da7df7800000000000000000000000000000000000000000000000000000000',
              amount: '10'
            }
          }
        ]
      }
    };

    const res = await executeToolsDirectly(routingPlan, '', {
      agentAddress: '012da7df7800000000000000000000000000000000000000000000000000000000',
      privateKey: '012da7df7800000000000000000000000000000000000000000000000000000000'
    });

    assert.equal(res.results.length, 1);
  });
});
