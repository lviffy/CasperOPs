'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Force test environment so compilerRouter uses mock WASM fallback
process.env.NODE_ENV = 'test';

const router = require('../routes/compilerRouter');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function callRoute(method, path, body = {}) {
  const req = { method, path, headers: {}, body };
  const res = makeRes();
  
  const layers = router.stack.filter(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
  );
  if (!layers.length) return { error: 'not_found' };
  const layer = layers[0];
  layer.handle(req, res, () => {});

  const start = Date.now();
  while (res.body === null && Date.now() - start < 3000) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return res;
}

describe('compilerRouter — POST /compile-contract', () => {
  it('returns 400 if source_code is missing', async () => {
    const res = await callRoute('POST', '/compile-contract', {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  });

  it('compiles templates and returns mock fallback when in test environment', async () => {
    const res = await callRoute('POST', '/compile-contract', {
      source_code: 'pub struct Test {}',
      contract_name: 'test_contract'
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.contract_name, 'test_contract');
    assert.ok(res.body.wasm_hex);
  });
});
