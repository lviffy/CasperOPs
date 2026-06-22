// Network and Contract Configuration for Casper Network
require('dotenv').config();

const CASPER_TESTNET_CONFIG = {
  id: 'casper-test',
  name: 'Casper Network (Testnet)',
  rpcUrl: process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc',
  explorerBaseUrl: 'https://testnet.casper.live',
  nativeCurrency: {
    name: 'Casper',
    symbol: 'CSPR',
    decimals: 9
  },
  agentFactoryHash: process.env.CASPER_AGENT_FACTORY_HASH || 'hash-agentfactory',
  reputationContractHash: process.env.CASPER_REPUTATION_HASH || 'hash-reputation',
  escrowContractHash: process.env.CASPER_ESCROW_HASH || 'hash-escrow',
  complianceContractHash: process.env.CASPER_COMPLIANCE_HASH || 'hash-compliance'
};

// Aliases kept for back-compat with older imports. Phase 23 collapsed the
// multi-chain constants into a single Casper testnet block since the
// Arbitrum / Flow / Filecoin networks were removed.
const DEFAULT_CHAIN = CASPER_TESTNET_CONFIG.id;
const getChainConfig = (chainId = DEFAULT_CHAIN) => {
  if (chainId === CASPER_TESTNET_CONFIG.id) return CASPER_TESTNET_CONFIG;
  // Unknown chains fall through to Casper testnet (the only supported
  // network in v1.0).
  return CASPER_TESTNET_CONFIG;
};
const FACTORY_ADDRESS = CASPER_TESTNET_CONFIG.agentFactoryHash;
const NFT_FACTORY_ADDRESS = ''; // CEP-78 is deployed separately; no global factory
const NETWORK_NAME = CASPER_TESTNET_CONFIG.name;

module.exports = {
  CASPER_TESTNET_CONFIG,
  DEFAULT_CHAIN,
  NETWORK_NAME,
  FACTORY_ADDRESS,
  NFT_FACTORY_ADDRESS,
  PORT: process.env.PORT || 3000,
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  getChainConfig,
};
