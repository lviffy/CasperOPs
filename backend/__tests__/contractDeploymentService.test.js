'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sinon = require('sinon');
const fs = require('node:fs');
const path = require('node:path');

const { Keys } = require('casper-js-sdk');

// Inject a fake `utils/blockchain.js` into require.cache BEFORE requiring
// the service. The service does `const { getClient, getKeysFromHex } =
// require('../utils/blockchain')` at import time, so a sinon.stub on the
// already-loaded module's property would not affect the destructured
// reference. Replacing the cache entry instead makes the destructured
// reference point at our fake.
//
// `getKeysFromHex` mirrors the production intent: return a keypair for a
// 32-byte hex private key (with or without 0x prefix), null otherwise.
// casper-js-sdk 2.15 has a regression where its key-import APIs ignore the
// input bytes, so we generate a fresh keypair for any valid-looking input.
function fakeGetKeysFromHex(hex) {
  if (typeof hex !== 'string') return null;
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) return null;
  return Keys.Ed25519.new();
}

const fakeBlockchain = {
  getClient: () => ({ deploy: async () => 'fake-deploy-hash-abc' }),
  getKeysFromHex: fakeGetKeysFromHex,
  getAccountBalance: async () => '0',
  sendDeploy: async () => 'fake-deploy-hash-abc',
};
require.cache[require.resolve('../utils/blockchain')] = {
  id: require.resolve('../utils/blockchain'),
  filename: require.resolve('../utils/blockchain'),
  loaded: true,
  exports: fakeBlockchain,
  children: [],
  paths: [],
};

// Now require the service under test. It picks up our fake blockchain.
const svc = require('../services/contractDeploymentService');

describe('contractDeploymentService.js — Casper CEP-18 + CEP-78 deploys', () => {
  let existsSyncStub;
  let readFileSyncStub;
  let fakeWasm;
  let validPrivateKey;

  before(() => {
    fakeWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    existsSyncStub = sinon.stub(fs, 'existsSync').returns(true);
    readFileSyncStub = sinon.stub(fs, 'readFileSync').returns(fakeWasm);
    const kp = Keys.Ed25519.new();
    validPrivateKey = Buffer.from(kp.privateKey).toString('hex');
  });

  after(() => {
    sinon.restore();
    delete require.cache[require.resolve('../utils/blockchain')];
    delete require.cache[require.resolve('../services/contractDeploymentService')];
  });

  describe('buildCep18InitArgs', () => {
    test('wraps the four CEP-18 init args in CLValue builders', () => {
      const args = svc.buildCep18InitArgs({
        name: 'Test Token',
        symbol: 'tCSPR',
        decimals: 9,
        totalSupply: '1000000000000000000',
      });
      // casper-js-sdk 2.x exposes the wrapped value on `.data` (BigNumber for
      // numeric types). The CLType lives at `.clType().linksTo`. We assert on
      // the string form so the test is stable across BigNumber library versions.
      assert.equal(args.name.clType().linksTo, 'String');
      assert.equal(args.name.data, 'Test Token');
      assert.equal(args.symbol.clType().linksTo, 'String');
      assert.equal(args.symbol.data, 'tCSPR');
      assert.equal(args.decimals.clType().linksTo, 'U8');
      assert.equal(args.decimals.data.toString(), '9');
      assert.equal(args.total_supply.clType().linksTo, 'U256');
      assert.equal(args.total_supply.data.toString(), '1000000000000000000');
    });

    test('defaults decimals to 9 and stringifies totalSupply', () => {
      const args = svc.buildCep18InitArgs({
        name: 'X',
        symbol: 'X',
        totalSupply: 1_000_000,
      });
      assert.equal(args.decimals.data.toString(), '9');
      assert.equal(args.total_supply.data.toString(), '1000000');
    });

    test('declares exactly the required CEP-18 init and configuration args', () => {
      const args = svc.buildCep18InitArgs({
        name: 'X',
        symbol: 'X',
        decimals: 9,
        totalSupply: '1',
      });
      const expectedKeys = [
        'decimals',
        'name',
        'odra_cfg_allow_key_override',
        'odra_cfg_constructor',
        'odra_cfg_is_upgradable',
        'odra_cfg_is_upgrade',
        'odra_cfg_package_hash_key_name',
        'symbol',
        'total_supply'
      ];
      assert.deepEqual(Object.keys(args).sort(), expectedKeys.sort());
    });
  });

  describe('buildCep78InitArgs', () => {
    test('declares the required CEP-78 init and configuration args', () => {
      const args = svc.buildCep78InitArgs({
        name: 'Sample Collection',
        symbol: 'SAMPLE',
        totalTokenSupply: 1000,
      });
      const expectedKeys = [
        'collection_name',
        'collection_symbol',
        'odra_cfg_allow_key_override',
        'odra_cfg_constructor',
        'odra_cfg_is_upgradable',
        'odra_cfg_is_upgrade',
        'odra_cfg_package_hash_key_name',
        'total_token_supply',
      ];
      assert.deepEqual(Object.keys(args).sort(), expectedKeys.sort());
    });

    test('uses the documented v2.x Odra defaults for configuration options', () => {
      const args = svc.buildCep78InitArgs({
        name: 'X',
        symbol: 'X',
        totalTokenSupply: 100,
      });
      assert.equal(args.odra_cfg_package_hash_key_name.data, 'cep78_x');
      assert.equal(args.odra_cfg_allow_key_override.data, true);
      assert.equal(args.odra_cfg_is_upgradable.data, false);
      assert.equal(args.odra_cfg_is_upgrade.data, false);
      assert.equal(args.odra_cfg_constructor.data, 'init');
    });

    test('correctly wraps the minter address in a Key when provided', () => {
      const keys = Keys.Ed25519.new();
      const args = svc.buildCep78InitArgs({
        name: 'X',
        symbol: 'X',
        totalTokenSupply: 1,
        minter: keys.publicKey,
      });
      assert.equal(args.minter.clType().linksTo, 'Key');
    });

    test('defaults totalTokenSupply to 1000 (matches deploy script)', () => {
      const args = svc.buildCep78InitArgs({ name: 'X', symbol: 'X' });
      // CLValueBuilder.u64 wraps the value in a BigNumber-like `data` field.
      assert.equal(args.total_token_supply.clType().linksTo, 'U64');
      assert.equal(args.total_token_supply.data.toString(), '1000');
    });
  });

  describe('payment amounts', () => {
    test('CEP-18 deploy pays 200 CSPR (matches deploy.js)', () => {
      assert.equal(svc.CEP18_PAYMENT_MOTES, 200_000_000_000);
    });
    test('CEP-78 deploy pays 500 CSPR (matches deploy.js)', () => {
      assert.equal(svc.CEP78_PAYMENT_MOTES, 500_000_000_000);
    });
    test('CEP-78 payment is strictly larger than CEP-18 payment', () => {
      assert.ok(svc.CEP78_PAYMENT_MOTES > svc.CEP18_PAYMENT_MOTES);
    });
  });

  describe('WASM paths', () => {
    test('CEP18_WASM points at the Odra build output', () => {
      assert.match(svc.CEP18_WASM, /contract\/wasm\/Cep18Token\.wasm$/);
    });
    test('CEP78_WASM points at the Odra build output', () => {
      assert.match(svc.CEP78_WASM, /contract\/wasm\/Cep78Nft\.wasm$/);
    });
  });

  describe('deployCep18Token', () => {
    test('returns a CEP-18 result envelope with deploy hash and explorer URL', async () => {
      const result = await svc.deployCep18Token({
        privateKey: validPrivateKey,
        name: 'Test',
        symbol: 'tCSPR',
        decimals: 9,
        totalSupply: '1000000000000000000',
      });
      assert.equal(result.standard, 'CEP-18');
      assert.equal(result.transactionHash, 'fake-deploy-hash-abc');
      assert.equal(result.tokenInfo.name, 'Test');
      assert.equal(result.tokenInfo.symbol, 'tCSPR');
      assert.equal(result.tokenInfo.decimals, 9);
      assert.equal(result.tokenInfo.totalSupply, '1000000000000000000');
      assert.match(result.explorerUrl, /testnet\.cspr\.live\/deploy\//);
    });

    test('rejects an unparseable private key without touching fs', async () => {
      const before = existsSyncStub.callCount;
      await assert.rejects(
        () => svc.deployCep18Token({
          privateKey: 'not-a-key',
          name: 'X',
          symbol: 'X',
          decimals: 9,
          totalSupply: '1',
        }),
        /Invalid private key/,
      );
      assert.equal(existsSyncStub.callCount, before);
    });

    test('throws a clear error when WASM is missing', async () => {
      existsSyncStub.returns(false);
      try {
        await assert.rejects(
          () => svc.deployCep18Token({
            privateKey: validPrivateKey,
            name: 'X',
            symbol: 'X',
            decimals: 9,
            totalSupply: '1',
          }),
          /Cep18Token\.wasm/,
        );
      } finally {
        existsSyncStub.returns(true);
      }
    });
  });

  describe('deployCep78Collection', () => {
    test('returns a CEP-78 result envelope with deploy hash and explorer URL', async () => {
      const result = await svc.deployCep78Collection({
        privateKey: validPrivateKey,
        name: 'Sample Collection',
        symbol: 'SAMPLE',
        totalTokenSupply: 1000,
      });
      assert.equal(result.standard, 'CEP-78');
      assert.equal(result.transactionHash, 'fake-deploy-hash-abc');
      assert.equal(result.collectionInfo.name, 'Sample Collection');
      assert.equal(result.collectionInfo.symbol, 'SAMPLE');
      assert.equal(result.collectionInfo.totalTokenSupply, 1000);
    });

    test('rejects an unparseable private key without touching fs', async () => {
      const before = existsSyncStub.callCount;
      await assert.rejects(
        () => svc.deployCep78Collection({
          privateKey: 'not-a-key',
          name: 'X',
          symbol: 'X',
          totalTokenSupply: 1,
        }),
        /Invalid private key/,
      );
      assert.equal(existsSyncStub.callCount, before);
    });

    test('throws a clear error when WASM is missing', async () => {
      existsSyncStub.returns(false);
      try {
        await assert.rejects(
          () => svc.deployCep78Collection({
            privateKey: validPrivateKey,
            name: 'X',
            symbol: 'X',
            totalTokenSupply: 1,
          }),
          /Cep78Nft\.wasm/,
        );
      } finally {
        existsSyncStub.returns(true);
      }
    });
  });
});
