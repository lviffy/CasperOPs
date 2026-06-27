'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sinon = require('sinon');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'x'.repeat(32);

const supabase = require('../config/supabase');
const directToolExecutor = require('../services/directToolExecutor');
const { registerAgentOnChain, getAgentReputation } = require('../controllers/agentController');

describe('Agent Controller — registerAgentOnChain', () => {
  let selectStub, updateStub, eqStub, singleStub, registerAgentStub, getReputationStub;

  before(() => {
    selectStub = sinon.stub();
    updateStub = sinon.stub();
    eqStub = sinon.stub();
    singleStub = sinon.stub();

    // Stub Supabase .from('agents') and .from('agent_registry')
    sinon.stub(supabase, 'from').callsFake((table) => {
      if (table === 'agents') {
        return {
          select: selectStub,
          update: updateStub,
        };
      }
      if (table === 'agent_registry') {
        return {
          upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }) }),
        };
      }
      return {};
    });

    // Stub register_agent and get_reputation from directToolExecutor
    registerAgentStub = sinon.stub(directToolExecutor, 'register_agent');
    getReputationStub = sinon.stub(directToolExecutor, 'get_reputation');
  });

  after(() => {
    sinon.restore();
  });

  beforeEach(() => {
    selectStub.reset();
    updateStub.reset();
    eqStub.reset();
    singleStub.reset();
    registerAgentStub.reset();
    getReputationStub.reset();

    // Set default chain behavior
    selectStub.returns({ eq: eqStub });
    updateStub.returns({ eq: eqStub });
    
    // First call is for select query (which calls .single())
    eqStub.onFirstCall().returns({ single: singleStub });
    // Second call is for update query (which is awaited directly)
    eqStub.onSecondCall().resolves({ error: null });
  });

  function makeMockRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
  }

  it('should return 404 if agent is not found', async () => {
    const req = { params: { id: 'agent-123' } };
    const res = makeMockRes();

    singleStub.resolves({ data: null, error: { message: 'Agent not found' } });

    await registerAgentOnChain(req, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { success: false, error: 'Agent not found' });
  });

  it('should return 400 if agent does not have a wallet_address and no signerPublicKey is provided', async () => {
    const req = { params: { id: 'agent-123' }, body: {} };
    const res = makeMockRes();

    singleStub.resolves({
      data: { id: 'agent-123', name: 'Test Agent', wallet_address: null },
      error: null,
    });

    await registerAgentOnChain(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /connect your Casper wallet/);
  });

  it('should fallback to signerPublicKey and update agent wallet_address and on_chain_id if wallet_address is missing', async () => {
    const req = { params: { id: 'agent-123' }, body: { signerPublicKey: '0180d...' } };
    const res = makeMockRes();

    singleStub.resolves({
      data: { id: 'agent-123', name: 'Test Agent', wallet_address: null },
      error: null,
    });

    registerAgentStub.resolves({
      success: true,
      deployHash: 'deploy-hash-xyz',
    });

    let updatePayload;
    updateStub.callsFake((data) => {
      updatePayload = data;
      return { eq: eqStub };
    });

    await registerAgentOnChain(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      success: true,
      onChainId: '0180d...',
      transactionHash: 'deploy-hash-xyz',
    });
    assert.deepEqual(updatePayload, {
      on_chain_id: '0180d...',
      wallet_address: '0180d...',
    });
  });

  it('should return 400 if register_agent execution fails', async () => {
    const req = { params: { id: 'agent-123' } };
    const res = makeMockRes();

    singleStub.resolves({
      data: { id: 'agent-123', name: 'Test Agent', wallet_address: '0180d...' },
      error: null,
    });

    registerAgentStub.resolves({ success: false, error: 'Network error' });

    await registerAgentOnChain(req, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
      success: false,
      error: 'Network error',
    });
  });

  it('should return 500 if database update of on_chain_id fails after successful registration', async () => {
    const req = { params: { id: 'agent-123' } };
    const res = makeMockRes();

    singleStub.resolves({
      data: { id: 'agent-123', name: 'Test Agent', wallet_address: '0180d...' },
      error: null,
    });

    registerAgentStub.resolves({
      success: true,
      deployHash: 'deploy-hash-xyz',
    });

    // Make the update call return an error
    eqStub.onSecondCall().resolves({ error: { message: 'DB Write Error' } });

    await registerAgentOnChain(req, res);

    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /database update failed/);
  });

  it('should register successfully and update agent on_chain_id in Supabase', async () => {
    const req = { params: { id: 'agent-123' } };
    const res = makeMockRes();

    singleStub.resolves({
      data: { id: 'agent-123', name: 'Test Agent', wallet_address: '0180d...' },
      error: null,
    });

    registerAgentStub.resolves({
      success: true,
      deployHash: 'deploy-hash-xyz',
    });

    eqStub.resolves({ error: null });

    await registerAgentOnChain(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      success: true,
      onChainId: '0180d...',
      transactionHash: 'deploy-hash-xyz',
    });
  });

  describe('getAgentReputation', () => {
    it('should return 400 if onChainId is missing', async () => {
      const req = { params: {} };
      const res = makeMockRes();

      await getAgentReputation(req, res);

      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { success: false, error: 'onChainId is required' });
    });

    it('should return 400 if get_reputation fails', async () => {
      const req = { params: { onChainId: '0180d...' } };
      const res = makeMockRes();

      getReputationStub.resolves({ success: false, error: 'Contract read failed' });

      await getAgentReputation(req, res);

      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { success: false, error: 'Contract read failed' });
    });

    it('should return 200 with mapped reputation keys on success', async () => {
      const req = { params: { onChainId: '0180d...' } };
      const res = makeMockRes();

      getReputationStub.resolves({
        success: true,
        rating: 5,
        successCount: 10,
        failureCount: 1
      });

      await getAgentReputation(req, res);

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, {
        success: true,
        rating: 5,
        score: 5,
        averageScore: 5,
        successCount: 10,
        failureCount: 1
      });
    });
  });
});
