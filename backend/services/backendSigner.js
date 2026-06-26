/**
 * CasperOPs backend Casper signer.
 *
 * Loads the deployer keypair from `CASPER_SECRET_KEY` (hex, ed25519 or secp256k1)
 * once per process and caches it in memory. Callers sign deploys either as raw
 * `Deploy` objects (via `casper-js-sdk`'s `signDeploy`) or as JSON-safe envelopes
 * (via `signDeployJson`).
 *
 * This module is intentionally separate from `backend/utils/blockchain.js`
 * (`getKeysFromHex` etc.) so that hot-path signing never touches the file system
 * or re-parses the secret on every call, and so that we have a single
 * import-time boundary that throws a clear "not configured" error when the
 * backend tries to submit on-chain deploys without a secret.
 *
 * Used by:
 *   - `backend/services/contractDeploymentService.js` (`getKeys`)
 *   - `backend/middleware/x402-refund.js`      (`signDeployJson`)
 *   - `backend/middleware/x402-verify.js`     (placeholder for future
 *                                              treasury → payer refund
 *                                              broadcasting)
 *
 * NOTE: This is a backend-side hot signer. Production deployments should mount
 * the secret via a secret manager (AWS Secrets Manager, GCP Secret Manager,
 * Vault) — never commit it. `contract/scripts/generate-signer.js` writes the
 * testnet signer to `backend/secrets/testnet-signer.{pem,json}` which are
 * already in `.gitignore`.
 */

const { Keys, DeployUtil } = require('casper-js-sdk');

const SECRET_ENV = 'CASPER_SECRET_KEY';
const CHAIN_NAME_ENV = 'CASPER_CHAIN_NAME';

let cachedKeys = null;
let cachedPublicKeyHex = null;
let cachedAlgorithm = null;

function readSecretFromEnv() {
  const raw = process.env[SECRET_ENV];
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  return raw.trim();
}

/**
 * Load the cached keypair from `CASPER_SECRET_KEY`. Returns the same object on
 * subsequent calls so callers don't pay the parse cost per deploy. Throws a
 * clear error if the env var is missing or malformed.
 */
function getKeys() {
  if (cachedKeys) return cachedKeys;
  const secret = readSecretFromEnv();
  if (!secret) {
    throw new Error(
      `backendSigner: ${SECRET_ENV} is not set. Add a 64-char hex ` +
        '(ed25519 or secp256k1) secret to backend/.env, or generate one with ' +
        '`cd contract && node scripts/generate-signer.js`.'
    );
  }
  const cleanSecret = secret.startsWith('0x') ? secret.slice(2) : secret;
  if (!/^[0-9a-fA-F]+$/.test(cleanSecret)) {
    throw new Error(`backendSigner: ${SECRET_ENV} must be hex-encoded`);
  }
  const secretBytes = Buffer.from(cleanSecret, 'hex');
  let keys;
  try {
    if (secretBytes.length === 32) {
      const privKey = Keys.Ed25519.parsePrivateKey(secretBytes);
      const pubKey = Keys.Ed25519.privateToPublicKey(privKey);
      keys = Keys.Ed25519.parseKeyPair(pubKey, privKey);
      if (!keys.publicKey.isEd25519()) throw new Error('not ed25519');
    } else {
      const privKey = Keys.Secp256K1.parsePrivateKey(secretBytes);
      const pubKey = Keys.Secp256K1.privateToPublicKey(privKey);
      keys = Keys.Secp256K1.parseKeyPair(pubKey, privKey);
    }
  } catch (err) {
    // casper-js-sdk may throw a specific error if the bytes are not a valid
    // Ed25519 seed; fall back to secp256k1.
    if (secretBytes.length === 32) {
      try {
        const privKey = Keys.Secp256K1.parsePrivateKey(secretBytes);
        const pubKey = Keys.Secp256K1.privateToPublicKey(privKey);
        keys = Keys.Secp256K1.parseKeyPair(pubKey, privKey);
      } catch (secpErr) {
        throw new Error(
          `backendSigner: failed to load ${SECRET_ENV} (${secretBytes.length} bytes): ${err.message}`
        );
      }
    } else {
      throw new Error(
        `backendSigner: failed to load ${SECRET_ENV} (${secretBytes.length} bytes): ${err.message}`
      );
    }
  }
  cachedKeys = keys;
  cachedPublicKeyHex = keys.publicKey.toHex();
  cachedAlgorithm = keys.publicKey.isEd25519() ? 'ed25519' : 'secp256k1';
  return cachedKeys;
}

/**
 * Returns the deployer's public key in hex (with the 0x01 / 0x02 algorithm
 * prefix that Casper uses on-chain). Cached after the first call.
 */
function getActivePublicKey() {
  if (cachedPublicKeyHex) return cachedPublicKeyHex;
  getKeys();
  return cachedPublicKeyHex;
}

/**
 * Returns the algorithm (`ed25519` or `secp256k1`) of the loaded keypair.
 */
function getAlgorithm() {
  if (cachedAlgorithm) return cachedAlgorithm;
  getKeys();
  return cachedAlgorithm;
}

/**
 * Returns the chain name (`casper-test` etc.) used in DeployParams.
 * Defaults to `casper-test`.
 */
function getChainName() {
  return process.env[CHAIN_NAME_ENV] || 'casper-test';
}

/**
 * True iff `CASPER_SECRET_KEY` is set and parseable.
 * Useful for routes that should 503 if the signer is unconfigured (e.g. before
 * the operator has rotated keys).
 */
function isConfigured() {
  try {
    getKeys();
    return true;
  } catch {
    return false;
  }
}

/**
 * Sign a `Deploy` object (already built via `DeployUtil.makeDeploy`).
 * Returns the signed `Deploy`.
 */
function signDeploy(deploy) {
  return DeployUtil.signDeploy(deploy, getKeys());
}

/**
 * Parse a deploy from JSON (the output of `DeployUtil.deployToJson`) and sign
 * it. Returns the signed Deploy as JSON (suitable for `account_put_deploy`).
 *
 * @param {object|string} deployJson - casper-js-sdk Deploy JSON envelope, or a
 *                                    JSON string.
 * @returns {object} signed Deploy JSON envelope
 */
function signDeployJson(deployJson) {
  const parsed = typeof deployJson === 'string' ? JSON.parse(deployJson) : deployJson;
  const result = DeployUtil.deployFromJson(parsed);
  // deployFromJson returns a `Result<Deploy, Error>`; casper-js-sdk does not
  // currently fail on a well-formed envelope, so unwrap defensively.
  if (result && typeof result.unwrap === 'function') {
    const unwrapped = result.unwrap();
    if (!unwrapped) throw new Error('backendSigner.signDeployJson: deployFromJson returned Err');
    return DeployUtil.deployToJson(DeployUtil.signDeploy(unwrapped, getKeys()));
  }
  // Older casper-js-sdk may return the Deploy directly.
  return DeployUtil.deployToJson(DeployUtil.signDeploy(result, getKeys()));
}

/**
 * Test helper: clear the in-memory cache so a new secret takes effect without
 * a process restart. Not used by production code paths.
 */
function _resetCacheForTests() {
  cachedKeys = null;
  cachedPublicKeyHex = null;
  cachedAlgorithm = null;
}

module.exports = {
  getKeys,
  getActivePublicKey,
  getAlgorithm,
  getChainName,
  isConfigured,
  signDeploy,
  signDeployJson,
  _resetCacheForTests,
};
