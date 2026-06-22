/**
 * BlockOps no-op shim for the deprecated Lit PKP service.
 *
 * Lit Protocol signing was removed when BlockOps migrated off EVM (Arbitrum
 * / Flow) to Casper (Phase 13). This module preserves the import-time
 * contract so the rest of the codebase keeps working — but any actual call
 * throws a clear migration error so the caller knows to switch to CSPR.click.
 *
 * Real signing now happens in:
 *   - Frontend: `frontend/lib/wallet.ts` (CSPR.click signMessage / signDeploy)
 *   - Backend:  `backend/services/backendSigner.js` (CASPER_SECRET_KEY)
 */

function deriveWalletAddressFromPkpPublicKey(_pkpPublicKey) {
  throw new Error(
    'deriveWalletAddressFromPkpPublicKey() is no longer supported — BlockOps uses CSPR.click on Casper. ' +
      'Read the active account public key via getActiveAccount() (frontend) or expose CASPER_PUBLIC_KEY (backend).',
  )
}

async function signAndBroadcastTransactionWithPkp(_opts) {
  throw new Error(
    'signAndBroadcastTransactionWithPkp() is no longer supported — BlockOps signs Casper deploys via CSPR.click. ' +
      'Use frontend/lib/x402-client.ts (browser) or backend/services/backendSigner.js (server).',
  )
}

module.exports = {
  deriveWalletAddressFromPkpPublicKey,
  signAndBroadcastTransactionWithPkp,
}
