/**
 * Casper Network chain utilities.
 * Previously contained Flow/Arbitrum logic — fully replaced for Casper migration.
 */

const CASPER_CHAIN_ID = 'casper-test';

// All tools supported on Casper Network
const CASPER_SUPPORTED_TOOLS = new Set([
  'get_balance',
  'transfer',
  'batch_transfer',
  'deploy_cep18',
  'deploy_cep78',
  'mint_nft',
  'get_token_info',
  'get_token_balance',
  'get_nft_info',
  'lookup_deploy',
  'lookup_block',
  'fetch_price',
  'send_email',
  'calculate',
  'attest_agent',
  'register_agent',
  'get_reputation',
  'yield_rebalance',
]);

function isCasperChain(chain) {
  return !chain || String(chain).toLowerCase().includes('casper');
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
    chain: CASPER_CHAIN_ID,
    name: 'Casper Network (Testnet)',
    nativeCurrency: 'CSPR',
    explorerBaseUrl: 'https://testnet.casper.live',
  };
}

function isToolSupportedOnChain(tool) {
  const normalizedTool = String(tool || '').trim();
  return CASPER_SUPPORTED_TOOLS.has(normalizedTool);
}

function buildUnsupportedToolError(tool) {
  return `${tool} is not supported on Casper Network in the current build. Supported tools: ${[...CASPER_SUPPORTED_TOOLS].join(', ')}`;
}

module.exports = {
  CASPER_CHAIN_ID,
  CASPER_SUPPORTED_TOOLS,
  buildUnsupportedToolError,
  getChainFromRequest,
  getChainMetadata,
  isCasperChain,
  isToolSupportedOnChain,
};
