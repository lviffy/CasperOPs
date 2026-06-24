'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let mockPublicKeyHex = null;

// Mock blockchain before requiring directToolExecutor
const { Keys } = require('casper-js-sdk');
const fakeBlockchain = {
  getClient: () => ({
    deploy: async () => 'fake-deploy-hash-reputation',
    getStateRootHash: async () => 'state-root',
    getAccountBalanceUrefByPublicKey: async () => 'uref',
    getAccountBalance: async () => '1000000000',
  }),
  getKeysFromHex: (pk) => {
    if (mockPublicKeyHex) {
      return {
        publicKey: {
          toHex: () => mockPublicKeyHex
        }
      };
    }
    return Keys.Ed25519.new();
  },
  getAccountBalance: async () => '100000000000',
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

const { checkAddressCompliance, compliance_check } = require('../services/directToolExecutor');
const { transfer, prepareTransfer } = require('../controllers/transferController');

describe('ZK Compliance Whitelisting', () => {
  before(() => {
    process.env.CASPER_COMPLIANCE_HASH = 'mock-compliance-hash';
  });

  it('should verify a compliant address successfully', async () => {
    const compliantAddress = '010101010101010101010101010101010101010101010101010101010101010101';
    const isCompliant = await checkAddressCompliance(compliantAddress);
    assert.equal(isCompliant, true);

    const res = await compliance_check({ agent_id: compliantAddress });
    assert.equal(res.success, true);
    assert.equal(res.compliant, true);
  });

  it('should reject a non-compliant address', async () => {
    const unverifiedAddress = '010101010101010101010101010101010101010101010101010101010101unverified';
    const isCompliant = await checkAddressCompliance(unverifiedAddress);
    assert.equal(isCompliant, false);

    const res = await compliance_check({ agent_id: unverifiedAddress });
    assert.equal(res.success, true);
    assert.equal(res.compliant, false);
  });

  it('should reject transfer build if the payer is non-compliant', async () => {
    const req = {
      body: {
        privateKey: '0101010101010101010101010101010101010101010101010101010101010101',
        toAddress: '010101010101010101010101010101010101010101010101010101010101010101',
        amount: '10'
      }
    };
    
    mockPublicKeyHex = '01-noncompliant-address';

    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };

    await transfer(req, res);
    
    mockPublicKeyHex = null;

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /compliant/);
  });

  it('should reject prepared transfer if the payer is non-compliant', async () => {
    const req = {
      body: {
        fromAddress: '01-noncompliant-address',
        toAddress: '010202020202020202020202020202020202020202020202020202020202020202',
        amount: '5'
      }
    };

    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };

    await prepareTransfer(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /compliant/);
  });
});
