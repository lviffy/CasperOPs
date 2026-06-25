/**
 * Casper Network chain utilities.
 * The CasperOPs backend is Casper-only — there is no Arbitrum or Flow support.
 */

const CASPER_CHAIN_ID = 'casper-test';
const CASPER_CHAIN_NAME = 'casper';
const CASPER_TESTNET_NAME = 'casper-test';

const CASPER_NETWORK_CONFIG = {
  chain: CASPER_CHAIN_ID,
  chainName: CASPER_TESTNET_NAME,
  rpcUrl: process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc',
  explorerBaseUrl: 'https://testnet.cspr.live',
  nativeCurrency: { name: 'Casper', symbol: 'CSPR', decimals: 9 },
  faucetUrl: 'https://testnet.cspr.live/tools/faucet',
  csprCloudUrl: process.env.CSPR_CLOUD_API_URL || 'https://api.testnet.cspr.cloud',
};

// Tools the AI assistant can drive on Casper Testnet
const CASPER_SUPPORTED_TOOLS = new Set([
  // Native CSPR
  'get_balance',
  'transfer',
  'batch_transfer',
  // Token / NFT deployment
  'deploy_cep18',
  'deploy_cep78',
  'mint_nft',
  // Token / NFT lookups
  'get_token_info',
  'get_token_balance',
  'get_nft_info',
  // On-chain lookups
  'lookup_deploy',
  'lookup_block',
  // Market data via CSPR.cloud / CoinGecko
  'fetch_price',
  // Notifications / utilities
  'send_email',
  'calculate',
  // Casper-native Agent workflow
  'register_agent',
  'attest_agent',
  'get_reputation',
  'yield_rebalance',
  'wallet_readiness',
  'rwa_valuation',
  'fractionalize_rwa',
  'attest_performance',
  'compliance_check',
  'post_message',
  'get_message',
  // Phase 37: Casper-unique native capabilities
  'update_account_weights',
  'upgrade_contract_package',
  'update_nft_metadata',
  'add_delegated_key',
  'profile_wasm_gas',
]);

function isCasperChain(chain) {
  if (!chain) return true;
  return String(chain).toLowerCase().includes('casper');
}

function normalizeChainId(chain) {
  const normalized = String(chain || '').trim().toLowerCase();
  if (
    normalized === CASPER_CHAIN_ID ||
    normalized === CASPER_CHAIN_NAME ||
    normalized === CASPER_TESTNET_NAME ||
    normalized === 'casper-testnet' ||
    normalized === 'mainnet' ||
    normalized === 'casper' ||
    normalized === '1' ||
    normalized === '2'
  ) {
    return CASPER_CHAIN_ID;
  }
  return CASPER_CHAIN_ID;
}

function getChainFromRequest(req) {
  const raw = req?.body?.chain || req?.query?.chain || req?.params?.chain;
  if (raw && !isCasperChain(raw)) {
    console.warn(`[chains] Unsupported chain "${raw}" — defaulting to Casper Testnet`);
  }
  return CASPER_CHAIN_ID;
}

function getChainMetadata() {
  return {
    chain: CASPER_NETWORK_CONFIG.chain,
    chainName: CASPER_NETWORK_CONFIG.chainName,
    name: 'Casper Network (Testnet)',
    nativeCurrency: CASPER_NETWORK_CONFIG.nativeCurrency,
    rpcUrl: CASPER_NETWORK_CONFIG.rpcUrl,
    explorerBaseUrl: CASPER_NETWORK_CONFIG.explorerBaseUrl,
    faucetUrl: CASPER_NETWORK_CONFIG.faucetUrl,
    csprCloudUrl: CASPER_NETWORK_CONFIG.csprCloudUrl,
  };
}

// Phase 23: there is now exactly one supported chain. The legacy
// multi-chain constant is preserved as a single-element array so any
// external surface (health endpoint, MCP server) that introspects the
// list continues to work.
function getSupportedChains() {
  return [{
    id: CASPER_CHAIN_ID,
    chainId: CASPER_NETWORK_CONFIG.chain,
    name: CASPER_NETWORK_CONFIG.chainName,
    rpcUrl: CASPER_NETWORK_CONFIG.rpcUrl,
    explorerBaseUrl: CASPER_NETWORK_CONFIG.explorerBaseUrl,
    nativeCurrency: CASPER_NETWORK_CONFIG.nativeCurrency,
  }];
}

function isToolSupportedOnChain(tool) {
  const normalizedTool = String(tool || '').trim();
  return CASPER_SUPPORTED_TOOLS.has(normalizedTool);
}

// CSPR-per-tool pricing for the x402 payment protocol (see docs/x402.md).
// Amounts are in motes (1 CSPR = 1e9 motes) to avoid float drift.
const TOOL_PRICING = {
  // Read-only / free
  get_balance: { tier: 'free', priceMotes: 0 },
  get_token_info: { tier: 'free', priceMotes: 0 },
  get_token_balance: { tier: 'free', priceMotes: 0 },
  get_nft_info: { tier: 'free', priceMotes: 0 },
  lookup_deploy: { tier: 'free', priceMotes: 0 },
  lookup_block: { tier: 'free', priceMotes: 0 },
  fetch_price: { tier: 'free', priceMotes: 0 },
  calculate: { tier: 'free', priceMotes: 0 },
  get_reputation: { tier: 'free', priceMotes: 0 },
  wallet_readiness: { tier: 'free', priceMotes: 0 },
  compliance_check: { tier: 'free', priceMotes: 0 },

  // Paid
  transfer: { tier: 'paid', priceMotes: 100_000_000 }, // 0.10 CSPR
  batch_transfer: { tier: 'paid', priceMotes: 250_000_000 }, // 0.25 CSPR
  deploy_cep18: { tier: 'paid', priceMotes: 5_000_000_000 }, // 5.00 CSPR
  deploy_cep78: { tier: 'paid', priceMotes: 7_500_000_000 }, // 7.50 CSPR
  mint_nft: { tier: 'paid', priceMotes: 50_000_000 }, // 0.05 CSPR
  send_email: { tier: 'paid', priceMotes: 20_000_000 }, // 0.02 CSPR
  register_agent: { tier: 'paid', priceMotes: 500_000_000 }, // 0.50 CSPR
  attest_agent: { tier: 'paid', priceMotes: 200_000_000 }, // 0.20 CSPR
  yield_rebalance: { tier: 'paid', priceMotes: 100_000_000 }, // 0.10 CSPR
  rwa_valuation: { tier: 'paid', priceMotes: 200_000_000 }, // 0.20 CSPR
  fractionalize_rwa: { tier: 'paid', priceMotes: 500_000_000 }, // 0.50 CSPR
  attest_performance: { tier: 'paid', priceMotes: 200_000_000 }, // 0.20 CSPR
  post_message: { tier: 'paid', priceMotes: 100_000_000 }, // 0.10 CSPR
  get_message: { tier: 'free', priceMotes: 0 },
  // Phase 37: Casper-unique native capabilities
  update_account_weights: { tier: 'paid', priceMotes: 500_000_000 },  // 0.50 CSPR
  upgrade_contract_package: { tier: 'paid', priceMotes: 5_000_000_000 }, // 5.00 CSPR
  update_nft_metadata: { tier: 'paid', priceMotes: 200_000_000 },     // 0.20 CSPR
  add_delegated_key: { tier: 'paid', priceMotes: 300_000_000 },       // 0.30 CSPR
  profile_wasm_gas: { tier: 'free', priceMotes: 0 },
};

function getToolPrice(tool) {
  if (!tool) return { tier: 'paid', priceMotes: 0 };
  return TOOL_PRICING[tool] || { tier: 'paid', priceMotes: 0 };
}

function motesToCspr(motes) {
  const n = Number(motes || 0);
  if (!Number.isFinite(n)) return '0.00';
  return (n / 1_000_000_000).toFixed(2);
}

function csprToMotes(cspr) {
  const n = Number(cspr || 0);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1_000_000_000));
}

function isFreeTool(tool) {
  return getToolPrice(tool).tier === 'free';
}

function buildUnsupportedToolError(tool) {
  return `${tool} is not supported on Casper Network in the current build. Supported tools: ${[...CASPER_SUPPORTED_TOOLS].join(', ')}`;
}

module.exports = {
  CASPER_CHAIN_ID,
  CASPER_CHAIN_NAME,
  CASPER_TESTNET_NAME,
  CASPER_NETWORK_CONFIG,
  CASPER_SUPPORTED_TOOLS,
  TOOL_PRICING,
  buildUnsupportedToolError,
  csprToMotes,
  getChainFromRequest,
  getChainMetadata,
  getSupportedChains,
  getToolPrice,
  isCasperChain,
  isFreeTool,
  isToolSupportedOnChain,
  motesToCspr,
  normalizeChainId,
};
