/**
 * Unit tests for the env-validation middleware.
 *
 * Coverage:
 *   - dev mode accepts the documented defaults (no .env required)
 *   - prod mode rejects missing required vars
 *   - prod mode rejects malformed CASPER_SECRET_KEY (not 64-char hex)
 *   - prod mode rejects short ADMIN_SECRET / MASTER_API_KEY / GROQ_API_KEY1
 *   - prod mode rejects malformed SUPABASE_URL
 *   - cached value is returned on subsequent calls
 *   - the runtime defaults match the rest of the codebase (PORT=3000,
 *     CASPER_RPC_URL=testnet, CSPR_CLOUD_API_URL=testnet)
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { validateEnv, getEnv, envSchema, _resetForTests } = require('../middleware/validateEnv');

function clearProcessEnv() {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('CASPER_') || k.startsWith('CSPR_') ||
        k.startsWith('GROQ_') || k.startsWith('GEMINI_') ||
        k.startsWith('SUPABASE_') || k.startsWith('ADMIN_') ||
        k.startsWith('MASTER_') || k.startsWith('SERVER_') ||
        k.startsWith('GMAIL_') || k.startsWith('TELEGRAM_') ||
        k.startsWith('AGENT_') || k.startsWith('REDIS_') ||
        k.startsWith('SENTRY_') || k.startsWith('NEXT_') ||
        k === 'NODE_ENV' || k === 'PORT') {
      delete process.env[k];
    }
  }
}

function setProdEnv() {
  process.env.NODE_ENV = 'production';
  process.env.CASPER_SECRET_KEY = 'a'.repeat(64);
  process.env.CASPER_AGENT_FACTORY_HASH = 'b'.repeat(64);
  process.env.CASPER_REPUTATION_HASH = 'c'.repeat(64);
  process.env.CASPER_ESCROW_HASH = 'd'.repeat(64);
  process.env.CASPER_COMPLIANCE_HASH = 'e'.repeat(64);
  process.env.SUPABASE_URL = 'https://abcdefghij.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'x'.repeat(32);
  process.env.ADMIN_SECRET = 'a'.repeat(20);
  process.env.MASTER_API_KEY = 'b'.repeat(20);
  process.env.GROQ_API_KEY1 = 'gsk_' + 'x'.repeat(40);
}

describe('validateEnv — development mode', () => {
  beforeEach(() => { clearProcessEnv(); process.env.NODE_ENV = 'development'; _resetForTests(); });
  afterEach(() => { _resetForTests(); });

  it('accepts defaults when no .env is present', () => {
    const env = validateEnv({ exitOnError: false });
    assert.ok(env, 'should not return null in dev mode');
    assert.equal(env.NODE_ENV, 'development');
    assert.equal(env.PORT, 3000);
    assert.equal(env.CASPER_RPC_URL, 'https://rpc.testnet.casper.live/rpc');
    assert.equal(env.CSPR_CLOUD_API_URL, 'https://api.testnet.cspr.cloud');
    assert.equal(env.CASPER_CHAIN_NAME, 'casper-test');
  });

  it('accepts missing optional vars (CSPR_CLOUD_API_KEY, GROQ, SUPABASE)', () => {
    const env = validateEnv({ exitOnError: false });
    assert.equal(env.CSPR_CLOUD_API_KEY, undefined);
    assert.equal(env.GROQ_API_KEY1, undefined);
    assert.equal(env.SUPABASE_URL, undefined);
  });

  it('coerces PORT to number', () => {
    process.env.PORT = '8080';
    _resetForTests();
    const env = validateEnv({ exitOnError: false });
    assert.equal(env.PORT, 8080);
    assert.equal(typeof env.PORT, 'number');
  });

  it('coerces SENTRY_TRACES_SAMPLE_RATE to a 0..1 number', () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
    _resetForTests();
    const env = validateEnv({ exitOnError: false });
    assert.equal(env.SENTRY_TRACES_SAMPLE_RATE, 0.25);
  });
});

describe('validateEnv — production mode', () => {
  beforeEach(() => { clearProcessEnv(); _resetForTests(); });
  afterEach(() => { _resetForTests(); });

  it('accepts a fully-populated production env', () => {
    setProdEnv();
    const env = validateEnv({ exitOnError: false });
    assert.ok(env, 'should not return null when all required vars are set');
    assert.equal(env.NODE_ENV, 'production');
    assert.equal(env.CASPER_SECRET_KEY, 'a'.repeat(64));
    assert.equal(env.SUPABASE_URL, 'https://abcdefghij.supabase.co');
  });

  it('rejects missing CASPER_SECRET_KEY', () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPABASE_URL = 'https://abcdefghij.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'x'.repeat(32);
    process.env.ADMIN_SECRET = 'a'.repeat(20);
    process.env.MASTER_API_KEY = 'b'.repeat(20);
    process.env.GROQ_API_KEY1 = 'gsk_' + 'x'.repeat(40);
    const env = validateEnv({ exitOnError: false });
    assert.equal(env, null);
  });

  it('rejects malformed CASPER_SECRET_KEY (not 64-char hex)', () => {
    setProdEnv();
    process.env.CASPER_SECRET_KEY = 'short';
    _resetForTests();
    const env = validateEnv({ exitOnError: false });
    assert.equal(env, null);
  });

  it('accepts CASPER_SECRET_KEY with 0x prefix', () => {
    setProdEnv();
    process.env.CASPER_SECRET_KEY = '0x' + 'a'.repeat(64);
    _resetForTests();
    const env = validateEnv({ exitOnError: false });
    assert.ok(env);
    assert.equal(env.CASPER_SECRET_KEY, '0x' + 'a'.repeat(64));
  });

  it('rejects short GROQ_API_KEY1 in prod', () => {
    setProdEnv();
    process.env.GROQ_API_KEY1 = 'short';
    _resetForTests();
    const env = validateEnv({ exitOnError: false });
    assert.equal(env, null);
  });

  it('rejects short SUPABASE_SERVICE_KEY in prod', () => {
    setProdEnv();
    process.env.SUPABASE_SERVICE_KEY = 'short';
    _resetForTests();
    const env = validateEnv({ exitOnError: false });
    assert.equal(env, null);
  });

  it('rejects malformed SUPABASE_URL in prod', () => {
    setProdEnv();
    process.env.SUPABASE_URL = 'not-a-url';
    _resetForTests();
    const env = validateEnv({ exitOnError: false });
    assert.equal(env, null);
  });

  it('rejects short ADMIN_SECRET in prod', () => {
    setProdEnv();
    process.env.ADMIN_SECRET = 'short';
    _resetForTests();
    const env = validateEnv({ exitOnError: false });
    assert.equal(env, null);
  });

  it('rejects short MASTER_API_KEY in prod', () => {
    setProdEnv();
    process.env.MASTER_API_KEY = 'short';
    _resetForTests();
    const env = validateEnv({ exitOnError: false });
    assert.equal(env, null);
  });
});

describe('validateEnv — caching', () => {
  beforeEach(() => { clearProcessEnv(); process.env.NODE_ENV = 'development'; _resetForTests(); });
  afterEach(() => { _resetForTests(); });

  it('returns the same cached object on subsequent calls', () => {
    const a = validateEnv({ exitOnError: false });
    const b = validateEnv({ exitOnError: false });
    assert.strictEqual(a, b);
  });

  it('getEnv() returns the cached parsed value', () => {
    const a = validateEnv({ exitOnError: false });
    const b = getEnv();
    assert.strictEqual(a, b);
  });

  it('_resetForTests() clears the cache so a fresh parse runs', () => {
    const a = validateEnv({ exitOnError: false });
    _resetForTests();
    const b = validateEnv({ exitOnError: false });
    assert.notStrictEqual(a, b, 'should be a fresh object after reset');
    assert.equal(a.PORT, b.PORT);
  });
});

describe('validateEnv — schema integrity', () => {
  it('exposes a parseable zod schema', () => {
    const parsed = envSchema.safeParse({
      NODE_ENV: 'development',
      PORT: '3000',
      CASPER_RPC_URL: 'https://rpc.testnet.casper.live/rpc',
      CSPR_CLOUD_API_URL: 'https://api.testnet.cspr.cloud',
      CASPER_CHAIN_NAME: 'casper-test',
      AGENT_BACKEND_URL: 'http://localhost:8000',
      SENTRY_TRACES_SAMPLE_RATE: '0.05',
    });
    assert.ok(parsed.success);
    assert.equal(parsed.data.PORT, 3000);
  });
});