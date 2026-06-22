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

module.exports = {
  CASPER_TESTNET_CONFIG,
  PORT: process.env.PORT || 3000,
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || ''
};
