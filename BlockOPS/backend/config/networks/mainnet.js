/**
 * Casper mainnet network configuration.
 *
 * Phase 29 switch: when the operator sets `CASPER_NETWORK=mainnet` the
 * backend uses these values instead of the testnet defaults in
 * `config/constants.js`. The selector lives in `config/network.js` so
 * the rest of the codebase doesn't need to branch on `CASPER_NETWORK`
 * everywhere.
 *
 * Contract hashes
 * ───────────────
 * Pulled from `process.env.CASPER_*_HASH` at module load. The deploy
 * scripts (Phase 28) write the populated values into `backend/.env`
 * once the v1.0.0-rc.1 release is tagged; before that the env vars
 * are empty and `getChainConfig('casper')` returns the testnet
 * block (see `config/network.js`).
 *
 * Cost notes
 * ──────────
 * Mainnet deploys cost real CSPR. The deploy scripts reject any
 * deploy where the operator can't supply a funded signer; this file
 * does NOT auto-fund. Operators MUST rotate the signer keypair
 * between testnet and mainnet — never reuse a testnet key on mainnet.
 */

const CASPER_MAINNET_CONFIG = {
  id: 'casper',
  name: 'Casper Network (Mainnet)',
  rpcUrl: process.env.CASPER_MAINNET_RPC_URL || 'https://rpc.mainnet.casperlabs.io/rpc',
  explorerBaseUrl: 'https://cspr.live',
  nativeCurrency: {
    name: 'Casper',
    symbol: 'CSPR',
    decimals: 9,
  },
  // Contract hashes from the v1.0.0-rc.1 deploy (see docs/testnet-validation.md).
  // Operators MUST populate these via the env store before flipping
  // CASPER_NETWORK=mainnet — empty values cause every contract call
  // to fail with "unknown contract hash".
  agentFactoryHash: process.env.CASPER_MAINNET_AGENT_FACTORY_HASH || '',
  reputationContractHash: process.env.CASPER_MAINNET_REPUTATION_HASH || '',
  escrowContractHash: process.env.CASPER_MAINNET_ESCROW_HASH || '',
  complianceContractHash: process.env.CASPER_MAINNET_COMPLIANCE_HASH || '',
  cep18Hash: process.env.CASPER_MAINNET_CEP18_HASH || '',
  cep78Hash: process.env.CASPER_MAINNET_CEP78_HASH || '',
};

module.exports = { CASPER_MAINNET_CONFIG };