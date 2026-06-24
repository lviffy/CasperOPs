'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const escrowRoutes = require('../routes/escrowRoutes');

describe('Escrow routes logic', () => {
  const getRouteHandler = (path, method) => {
    const routeObj = escrowRoutes.stack.find(
      (r) => r.route && r.route.path === path && r.route.methods[method.toLowerCase()]
    );
    return routeObj ? routeObj.route.stack[0].handle : null;
  };

  it('POST /escrow/deposit prepares unsigned contract call deploy', async () => {
    const req = {
      body: {
        agent_id: 'agent-1234',
        amount_cspr: '150.5',
        user_public_key: '01' + 'a'.repeat(64)
      }
    };
    let jsonResult = null;
    const res = {
      json: (data) => {
        jsonResult = data;
        return res;
      }
    };

    const handler = getRouteHandler('/escrow/deposit', 'POST');
    assert.ok(handler);

    await handler(req, res);

    assert.equal(jsonResult.ok, true);
    assert.ok(jsonResult.deployJson);
    assert.equal(jsonResult.deployJson.type, 'contract_call');
    assert.equal(jsonResult.deployJson.entry_point, 'deposit');
    assert.equal(jsonResult.deployJson.args.agent, 'agent-1234');
    assert.equal(jsonResult.deployJson.attached_value, '150500000000'); // 150.5 * 10^9
  });

  it('POST /escrow/deposit rejects missing arguments', async () => {
    const req = {
      body: {
        agent_id: 'agent-1234'
      }
    };
    let jsonResult = null;
    let statusCode = 200;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        jsonResult = data;
        return res;
      }
    };

    const handler = getRouteHandler('/escrow/deposit', 'POST');
    await handler(req, res);

    assert.equal(statusCode, 400);
    assert.equal(jsonResult.ok, false);
    assert.ok(jsonResult.error);
  });

  it('GET /escrow/balance/:agentId returns agent stats', async () => {
    const req = {
      params: { agentId: 'agent-5678' }
    };
    let jsonResult = null;
    const res = {
      json: (data) => {
        jsonResult = data;
        return res;
      }
    };

    const handler = getRouteHandler('/escrow/balance/:agentId', 'GET');
    assert.ok(handler);

    await handler(req, res);

    assert.equal(jsonResult.ok, true);
    assert.equal(jsonResult.agentId, 'agent-5678');
    assert.ok(jsonResult.balance > 0);
    assert.ok(jsonResult.dailyLimit > 0);
    assert.ok(jsonResult.expiresAt);
  });

  it('POST /escrow/set-limits builds set_agent_limits contract call deploy', async () => {
    const req = {
      body: {
        agent_id: 'agent-9999',
        daily_limit_cspr: '250',
        expires_at: '2026-12-31T23:59:59.999Z'
      }
    };
    let jsonResult = null;
    const res = {
      json: (data) => {
        jsonResult = data;
        return res;
      }
    };

    const handler = getRouteHandler('/escrow/set-limits', 'POST');
    assert.ok(handler);

    await handler(req, res);

    assert.equal(jsonResult.ok, true);
    assert.ok(jsonResult.deployJson);
    assert.equal(jsonResult.deployJson.entry_point, 'set_agent_limits');
    assert.equal(jsonResult.deployJson.args.agent, 'agent-9999');
    assert.equal(jsonResult.deployJson.args.daily_limit, '250000000000'); // 250 * 10^9
  });

  it('POST /escrow/withdraw builds refund contract call deploy', async () => {
    const req = {
      body: {
        agent_id: 'agent-7777',
        user_public_key: '01' + 'f'.repeat(64)
      }
    };
    let jsonResult = null;
    const res = {
      json: (data) => {
        jsonResult = data;
        return res;
      }
    };

    const handler = getRouteHandler('/escrow/withdraw', 'POST');
    assert.ok(handler);

    await handler(req, res);

    assert.equal(jsonResult.ok, true);
    assert.ok(jsonResult.deployJson);
    assert.equal(jsonResult.deployJson.entry_point, 'refund');
    assert.equal(jsonResult.deployJson.args.agent, 'agent-7777');
    assert.equal(jsonResult.deployJson.args.user, '01' + 'f'.repeat(64));
  });
});
