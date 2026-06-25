'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { schemas } = require('../middleware/validate');
const { CASPER_SUPPORTED_TOOLS, TOOL_PRICING } = require('../utils/chains');
const {
  update_account_weights,
  upgrade_contract_package,
  update_nft_metadata,
  add_delegated_key,
  profile_wasm_gas,
} = require('../services/directToolExecutor');

// Minimal valid WASM magic bytes header + padding
const VALID_WASM_HEX = '0061736d' + '01000000' + '00'.repeat(20);
// Bad magic (not \0asm)
const BAD_WASM_HEX = 'deadbeef' + '00'.repeat(20);

describe('Phase 37 — chains.js tool registration', () => {
  const phase37Tools = [
    'update_account_weights',
    'upgrade_contract_package',
    'update_nft_metadata',
    'add_delegated_key',
    'profile_wasm_gas',
  ];

  for (const tool of phase37Tools) {
    it(`${tool} is in CASPER_SUPPORTED_TOOLS`, () => {
      assert.ok(CASPER_SUPPORTED_TOOLS.has(tool), `${tool} missing from CASPER_SUPPORTED_TOOLS`);
    });
    it(`${tool} is in TOOL_PRICING`, () => {
      assert.ok(TOOL_PRICING[tool], `${tool} missing from TOOL_PRICING`);
      assert.ok(['free', 'paid'].includes(TOOL_PRICING[tool].tier));
    });
  }

  it('profile_wasm_gas is free tier', () => {
    assert.equal(TOOL_PRICING.profile_wasm_gas.tier, 'free');
    assert.equal(TOOL_PRICING.profile_wasm_gas.priceMotes, 0);
  });

  it('upgrade_contract_package is the most expensive Phase 37 tool', () => {
    assert.equal(TOOL_PRICING.upgrade_contract_package.priceMotes, 5_000_000_000);
  });
});

describe('Phase 37 — Zod schema validation', () => {
  // 01 + 64 hex chars = 66 chars total (valid Casper secp256k1 public key)
  const validPubKey = '01' + '6'.repeat(64);

  it('update_account_weights rejects empty keys array', () => {
    const r = schemas.update_account_weights.safeParse({
      public_key: validPubKey,
      keys: [],
    });
    assert.ok(!r.success);
  });

  it('update_account_weights accepts valid input', () => {
    const r = schemas.update_account_weights.safeParse({
      public_key: validPubKey,
      keys: [{ account_hash: `account-hash-${'a'.repeat(64)}`, weight: 5 }],
    });
    assert.ok(r.success, JSON.stringify(r.error?.issues));
  });

  it('update_account_weights rejects weight > 255', () => {
    const r = schemas.update_account_weights.safeParse({
      public_key: validPubKey,
      keys: [{ account_hash: `account-hash-${'a'.repeat(64)}`, weight: 300 }],
    });
    assert.ok(!r.success);
  });

  it('upgrade_contract_package requires package_hash', () => {
    const r = schemas.upgrade_contract_package.safeParse({ wasm_hex: VALID_WASM_HEX });
    assert.ok(!r.success);
  });

  it('upgrade_contract_package accepts valid hash and wasm_hex', () => {
    const r = schemas.upgrade_contract_package.safeParse({
      package_hash: 'a'.repeat(64),
      wasm_hex: VALID_WASM_HEX,
    });
    assert.ok(r.success, JSON.stringify(r.error?.issues));
  });

  it('update_nft_metadata rejects when neither metadata nor metadata_uri given', () => {
    const r = schemas.update_nft_metadata.safeParse({
      collection_hash: `hash-${'a'.repeat(64)}`,
      token_id: '1',
    });
    assert.ok(!r.success);
  });

  it('update_nft_metadata accepts metadata object', () => {
    const r = schemas.update_nft_metadata.safeParse({
      collection_hash: `hash-${'a'.repeat(64)}`,
      token_id: '0',
      metadata: { appraisal_usd: '150000' },
    });
    assert.ok(r.success, JSON.stringify(r.error?.issues));
  });

  it('add_delegated_key rejects weight > 254', () => {
    const r = schemas.add_delegated_key.safeParse({
      public_key: validPubKey,
      delegate_key: validPubKey,
      weight: 255,
    });
    assert.ok(!r.success);
  });

  it('add_delegated_key accepts valid delegated key with daily limit', () => {
    const r = schemas.add_delegated_key.safeParse({
      public_key: validPubKey,
      delegate_key: validPubKey,
      weight: 1,
      daily_limit_motes: '100000000000',
    });
    assert.ok(r.success, JSON.stringify(r.error?.issues));
  });

  it('profile_wasm_gas rejects non-hex input', () => {
    const r = schemas.profile_wasm_gas.safeParse({ wasm_hex: 'not-hex!!' });
    assert.ok(!r.success);
  });
});

describe('Phase 37 — profile_wasm_gas handler logic', () => {
  it('rejects bad WASM magic bytes', async () => {
    const result = await profile_wasm_gas({ wasm_hex: BAD_WASM_HEX });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('magic'));
  });

  it('returns structured profile for valid WASM', async () => {
    const result = await profile_wasm_gas({ wasm_hex: VALID_WASM_HEX });
    assert.equal(result.success, true);
    assert.ok(typeof result.estimatedPaymentCspr === 'string');
    assert.ok(typeof result.wasmSizeKb === 'number');
    assert.ok(Array.isArray(result.suggestions));
    assert.ok(result.suggestions.length > 0);
    assert.ok(result.breakdown.baseCspr === 2.0);
  });

  it('base cost alone for a tiny WASM is exactly 2 CSPR', async () => {
    const result = await profile_wasm_gas({ wasm_hex: VALID_WASM_HEX });
    const cost = Number(result.estimatedPaymentCspr);
    assert.ok(cost >= 2.0 && cost < 2.1, `Expected ~2 CSPR, got ${cost}`);
  });

  it('tiny binary gets an optimal size suggestion', async () => {
    const result = await profile_wasm_gas({ wasm_hex: VALID_WASM_HEX });
    const hasOptimal = result.suggestions.some(s => s.level === 'success');
    assert.ok(hasOptimal, 'Expected a success-level suggestion for small binary');
  });
});

describe('Phase 37 — update_account_weights handler', () => {
  it('returns success with keysConfigured count', async () => {
    const result = await update_account_weights({
      public_key: '01' + '6'.repeat(64),
      keys: [{ account_hash: `account-hash-${'a'.repeat(64)}`, weight: 1 }],
    });
    assert.equal(result.success, true);
    assert.equal(result.keysConfigured, 1);
    assert.ok(result.deployJson);
    assert.equal(result.deployJson.type, 'account_update');
  });
});

describe('Phase 37 — upgrade_contract_package handler', () => {
  it('rejects WASM with bad magic bytes', async () => {
    const result = await upgrade_contract_package({
      package_hash: 'a'.repeat(64),
      wasm_hex: BAD_WASM_HEX,
    });
    assert.equal(result.success, false);
  });

  it('returns deploy JSON for valid WASM', async () => {
    const result = await upgrade_contract_package({
      package_hash: 'a'.repeat(64),
      wasm_hex: VALID_WASM_HEX,
    });
    assert.equal(result.success, true);
    assert.equal(result.deployJson.type, 'contract_upgrade');
    assert.ok(result.wasmSizeBytes > 0);
  });
});

describe('Phase 37 — update_nft_metadata handler', () => {
  it('returns contract_call deploy JSON', async () => {
    const result = await update_nft_metadata({
      collection_hash: `hash-${'a'.repeat(64)}`,
      token_id: '5',
      metadata: { appraisal: '250000' },
    });
    assert.equal(result.success, true);
    assert.equal(result.deployJson.entry_point, 'set_token_metadata');
    assert.equal(result.tokenId, '5');
  });
});

describe('Phase 37 — add_delegated_key handler', () => {
  const key = '01' + '6'.repeat(64);
  it('returns daily limit in CSPR when daily_limit_motes provided', async () => {
    const result = await add_delegated_key({
      public_key: key,
      delegate_key: key,
      weight: 1,
      daily_limit_motes: '100000000000', // 100 CSPR
    });
    assert.equal(result.success, true);
    assert.equal(result.dailyLimitCspr, '100.00');
    assert.equal(result.weight, 1);
  });

  it('returns null dailyLimitCspr when no limit given', async () => {
    const result = await add_delegated_key({
      public_key: key,
      delegate_key: key,
      weight: 3,
    });
    assert.equal(result.success, true);
    assert.equal(result.dailyLimitCspr, null);
  });
});


