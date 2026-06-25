'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const chains = require('../utils/chains');

describe('chains.js — Casper Network utilities', () => {
  test('motesToCspr converts 1e9 motes = 1 CSPR', () => {
    assert.equal(chains.motesToCspr(1_000_000_000), '1.00');
    assert.equal(chains.motesToCspr(0), '0.00');
  });

  test('motesToCspr rounds sub-CSPR amounts to 2 dp', () => {
    assert.equal(chains.motesToCspr(500_000_000), '0.50');
    assert.equal(chains.motesToCspr(123_456_789), '0.12');
    assert.equal(chains.motesToCspr(99_999_999), '0.10');
  });

  test('motesToCspr handles non-finite / nullish inputs safely', () => {
    assert.equal(chains.motesToCspr(undefined), '0.00');
    assert.equal(chains.motesToCspr(null), '0.00');
    assert.equal(chains.motesToCspr(NaN), '0.00');
    assert.equal(chains.motesToCspr(Infinity), '0.00');
  });

  test('csprToMotes inverts motesToCspr for whole CSPR', () => {
    assert.equal(chains.csprToMotes(1), String(1_000_000_000));
    assert.equal(chains.csprToMotes(0), '0');
    assert.equal(chains.csprToMotes(0.5), String(500_000_000));
  });

  test('csprToMotes rounds fractional CSPR to whole motes', () => {
    // 0.123 CSPR * 1e9 = 123_000_000 motes (Math.round rounds 0.5 up)
    assert.equal(chains.csprToMotes(0.123), '123000000');
    assert.equal(chains.csprToMotes('1.5'), '1500000000');
  });

  test('csprToMotes handles non-finite / nullish inputs safely', () => {
    assert.equal(chains.csprToMotes(undefined), '0');
    assert.equal(chains.csprToMotes(null), '0');
    assert.equal(chains.csprToMotes(NaN), '0');
  });

  test('getToolPrice returns the documented x402 prices', () => {
    // Free tools — match the table in docs/x402.md §5
    assert.deepEqual(chains.getToolPrice('get_balance'), { tier: 'free', priceMotes: 0 });
    assert.deepEqual(chains.getToolPrice('get_token_info'), { tier: 'free', priceMotes: 0 });
    assert.deepEqual(chains.getToolPrice('get_nft_info'), { tier: 'free', priceMotes: 0 });
    assert.deepEqual(chains.getToolPrice('lookup_deploy'), { tier: 'free', priceMotes: 0 });
    assert.deepEqual(chains.getToolPrice('lookup_block'), { tier: 'free', priceMotes: 0 });
    assert.deepEqual(chains.getToolPrice('fetch_price'), { tier: 'free', priceMotes: 0 });
    assert.deepEqual(chains.getToolPrice('calculate'), { tier: 'free', priceMotes: 0 });
    assert.deepEqual(chains.getToolPrice('get_reputation'), { tier: 'free', priceMotes: 0 });
    assert.deepEqual(chains.getToolPrice('wallet_readiness'), { tier: 'free', priceMotes: 0 });
    assert.deepEqual(chains.getToolPrice('get_token_balance'), { tier: 'free', priceMotes: 0 });

    // Paid tools
    assert.deepEqual(chains.getToolPrice('transfer'), { tier: 'paid', priceMotes: 100_000_000 });
    assert.deepEqual(chains.getToolPrice('batch_transfer'), { tier: 'paid', priceMotes: 250_000_000 });
    assert.deepEqual(chains.getToolPrice('deploy_cep18'), { tier: 'paid', priceMotes: 5_000_000_000 });
    assert.deepEqual(chains.getToolPrice('deploy_cep78'), { tier: 'paid', priceMotes: 7_500_000_000 });
    assert.deepEqual(chains.getToolPrice('mint_nft'), { tier: 'paid', priceMotes: 50_000_000 });
    assert.deepEqual(chains.getToolPrice('send_email'), { tier: 'paid', priceMotes: 20_000_000 });
    assert.deepEqual(chains.getToolPrice('register_agent'), { tier: 'paid', priceMotes: 500_000_000 });
    assert.deepEqual(chains.getToolPrice('attest_agent'), { tier: 'paid', priceMotes: 200_000_000 });
    assert.deepEqual(chains.getToolPrice('yield_rebalance'), { tier: 'paid', priceMotes: 100_000_000 });
  });

  test('getToolPrice falls back to paid/0 for unknown tools', () => {
    const fallback = chains.getToolPrice('not_a_real_tool');
    assert.equal(fallback.tier, 'paid');
    assert.equal(fallback.priceMotes, 0);
  });

  test('getToolPrice falls back to paid/0 for empty input', () => {
    const fallback = chains.getToolPrice('');
    assert.equal(fallback.tier, 'paid');
    assert.equal(fallback.priceMotes, 0);
    const fallback2 = chains.getToolPrice(undefined);
    assert.equal(fallback2.tier, 'paid');
    assert.equal(fallback2.priceMotes, 0);
  });

  test('isFreeTool is true for free tools and false for paid tools', () => {
    assert.equal(chains.isFreeTool('get_balance'), true);
    assert.equal(chains.isFreeTool('get_reputation'), true);
    assert.equal(chains.isFreeTool('lookup_deploy'), true);
    assert.equal(chains.isFreeTool('transfer'), false);
    assert.equal(chains.isFreeTool('register_agent'), false);
    assert.equal(chains.isFreeTool('deploy_cep78'), false);
  });

  test('isFreeTool is false for unknown tools (treated as paid)', () => {
    assert.equal(chains.isFreeTool('not_a_real_tool'), false);
  });

  test('TOOL_PRICING has no duplicate tiers and free tools are all 0 motes', () => {
    const toolNames = Object.keys(chains.TOOL_PRICING);
    const uniqueToolNames = new Set(toolNames);
    assert.equal(uniqueToolNames.size, toolNames.length, 'duplicate tool names in TOOL_PRICING');
    for (const [tool, price] of Object.entries(chains.TOOL_PRICING)) {
      if (price.tier === 'free') {
        assert.equal(price.priceMotes, 0, `free tool "${tool}" must have priceMotes=0`);
      }
      if (price.tier === 'paid') {
        assert.ok(price.priceMotes > 0, `paid tool "${tool}" must have priceMotes > 0`);
      }
    }
  });

  test('TOOL_PRICING covers all tools in CASPER_SUPPORTED_TOOLS', () => {
    const supported = chains.CASPER_SUPPORTED_TOOLS;
    // Implementation actually has 19 tools (Phase 17 consolidation dropped
    // the legacy 22-tool naming; the tool router, deploy script, and x402
    // spec all use this 19-tool surface).
    assert.ok(supported.size >= 19, `CASPER_SUPPORTED_TOOLS must expose >=19 tools, got ${supported.size}`);
    for (const tool of supported) {
      const price = chains.TOOL_PRICING[tool];
      assert.ok(price, `TOOL_PRICING missing entry for tool "${tool}"`);
      assert.ok(['free', 'paid'].includes(price.tier), `tool "${tool}" has invalid tier "${price.tier}"`);
    }
  });

  test('isToolSupportedOnChain mirrors CASPER_SUPPORTED_TOOLS membership', () => {
    assert.equal(chains.isToolSupportedOnChain('register_agent'), true);
    assert.equal(chains.isToolSupportedOnChain('attest_agent'), true);
    assert.equal(chains.isToolSupportedOnChain('get_reputation'), true);
    assert.equal(chains.isToolSupportedOnChain('yield_rebalance'), true);
    assert.equal(chains.isToolSupportedOnChain('wallet_readiness'), true);
    assert.equal(chains.isToolSupportedOnChain('arbitrary_call'), false);
    assert.equal(chains.isToolSupportedOnChain(''), false);
    assert.equal(chains.isToolSupportedOnChain(undefined), false);
  });

  test('isCasperChain matches the canonical Casper chain identifiers', () => {
    assert.equal(chains.isCasperChain('casper-test'), true);
    assert.equal(chains.isCasperChain('casper'), true);
    assert.equal(chains.isCasperChain('CASPER'), true);
    assert.equal(chains.isCasperChain('casper-mainnet'), true);
    assert.equal(chains.isCasperChain(''), true, 'empty chain defaults to Casper');
    assert.equal(chains.isCasperChain(null), true, 'null chain defaults to Casper');
    assert.equal(chains.isCasperChain('ethereum'), false);
    assert.equal(chains.isCasperChain('arbitrum-sepolia'), false);
  });

  test('normalizeChainId returns casper-test for any of the Casper aliases', () => {
    assert.equal(chains.normalizeChainId('casper-test'), 'casper-test');
    assert.equal(chains.normalizeChainId('casper'), 'casper-test');
    assert.equal(chains.normalizeChainId('casper-testnet'), 'casper-test');
    assert.equal(chains.normalizeChainId('mainnet'), 'casper-test');
    assert.equal(chains.normalizeChainId('CASPER-TEST'), 'casper-test');
    assert.equal(chains.normalizeChainId('1'), 'casper-test');
    assert.equal(chains.normalizeChainId('2'), 'casper-test');
    // Anything else falls back to casper-test (Casper-only stack)
    assert.equal(chains.normalizeChainId('ethereum'), 'casper-test');
    assert.equal(chains.normalizeChainId('arbitrum-sepolia'), 'casper-test');
    assert.equal(chains.normalizeChainId(''), 'casper-test');
  });

  test('getChainMetadata always returns a Casper-shaped object', () => {
    const meta = chains.getChainMetadata();
    assert.equal(meta.chain, 'casper-test');
    assert.equal(meta.chainName, 'casper-test');
    assert.equal(meta.nativeCurrency.symbol, 'CSPR');
    assert.equal(meta.nativeCurrency.decimals, 9);
    assert.ok(meta.rpcUrl.startsWith('https://'));
    assert.ok(meta.explorerBaseUrl.startsWith('https://'));
    assert.ok(meta.faucetUrl.startsWith('https://'));
  });

  test('getChainFromRequest returns casper-test even for non-Casper input (warns only)', () => {
    const req = { body: { chain: 'ethereum' }, query: {}, params: {} };
    assert.equal(chains.getChainFromRequest(req), 'casper-test');

    const req2 = { body: {}, query: { chain: 'casper-test' }, params: {} };
    assert.equal(chains.getChainFromRequest(req2), 'casper-test');

    const empty = { body: {}, query: {}, params: {} };
    assert.equal(chains.getChainFromRequest(empty), 'casper-test');
  });

  test('buildUnsupportedToolError mentions the tool and lists supported tools', () => {
    const msg = chains.buildUnsupportedToolError('arbitrary_call');
    assert.match(msg, /arbitrary_call/);
    assert.match(msg, /not supported on Casper Network/);
    assert.match(msg, /Supported tools:/);
  });
});
