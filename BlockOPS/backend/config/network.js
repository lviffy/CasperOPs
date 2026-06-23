/**
 * Network selector.
 *
 * Phase 29: based on the `CASPER_NETWORK` env var (default `testnet`)
 * the backend exposes the right chain config to the rest of the code.
 * Switching to mainnet is a single env-var flip + redeploy; the
 * selector picks `casper-testnet` or `casper` from the two registry
 * files in `config/networks/`.
 *
 * Safety rails:
 *   1. `getActiveChainConfig()` fails loud if `CASPER_NETWORK=mainnet`
 *      but the contract hashes are missing — prevents shipping a
 *      backend that talks to mainnet with empty contract refs.
 *   2. The selector refuses to return the mainnet config unless
 *      `NODE_ENV=production` (development keeps testnet even if the
 *      env var is set, so a dev who exports the wrong var doesn't
 *      accidentally point a dev backend at mainnet).
 */

const { CASPER_TESTNET_CONFIG } = require('./constants');
const { CASPER_MAINNET_CONFIG } = require('./networks/mainnet');

function getActiveChainConfig() {
  const requested = (process.env.CASPER_NETWORK || 'testnet').toLowerCase();

  if (requested === 'mainnet' || requested === 'casper') {
    if (process.env.NODE_ENV !== 'production') {
      // Refuse to point a non-production process at mainnet.
      // Comment out this guard if you really need to test mainnet
      // locally — but it's there for a reason.
      return CASPER_TESTNET_CONFIG;
    }
    // Sanity: refuse if any required contract hash is missing.
    const missing = [];
    if (!CASPER_MAINNET_CONFIG.agentFactoryHash) missing.push('CASPER_MAINNET_AGENT_FACTORY_HASH');
    if (!CASPER_MAINNET_CONFIG.reputationContractHash) missing.push('CASPER_MAINNET_REPUTATION_HASH');
    if (!CASPER_MAINNET_CONFIG.escrowContractHash) missing.push('CASPER_MAINNET_ESCROW_HASH');
    if (!CASPER_MAINNET_CONFIG.complianceContractHash) missing.push('CASPER_MAINNET_COMPLIANCE_HASH');
    if (missing.length > 0) {
      throw new Error(
        `[config/network] CASPER_NETWORK=mainnet but missing contract hashes: ${missing.join(', ')}. ` +
        'See docs/MAINNET_LAUNCH.md for the promotion checklist.',
      );
    }
    return CASPER_MAINNET_CONFIG;
  }

  return CASPER_TESTNET_CONFIG;
}

module.exports = { getActiveChainConfig };