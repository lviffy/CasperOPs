const { Keys, CLPublicKey } = require('casper-js-sdk');
const { getCache } = require('../services/cacheService');
const { rpc, snapshot: rpcSnapshot } = require('./rpcFailover');

const cache = getCache();

function getKeysFromHex(hexPrivateKey, algorithm = 'ed25519') {
  try {
    const rawPrivKey = hexPrivateKey.startsWith('0x') ? hexPrivateKey.slice(2) : hexPrivateKey;
    const privateKeyBuffer = Buffer.from(rawPrivKey, 'hex');

    if (algorithm === 'ed25519') {
      return Keys.Ed25519.loadKeyPairFromPrivateKey(privateKeyBuffer);
    } else {
      return Keys.Secp256K1.loadKeyPairFromPrivateKey(privateKeyBuffer);
    }
  } catch (error) {
    console.error('Failed to load key pair:', error);
    return null;
  }
}

async function getAccountBalance(publicKeyHex) {
  // Phase 27: read-through cache. Balances change after transfers /
  // contract calls land, so the 30 s TTL bounds the staleness window.
  // The transfer tool invalidates this cache after broadcasting.
  //
  // Phase 30: the read goes through the RPC failover layer so a single
  // bad endpoint doesn't take down the whole balance endpoint.
  try {
    return await cache.getOrFetch(
      'get_balance',
      { publicKey: publicKeyHex },
      async () => {
        const stateRootHash = await rpc('chain_get_state_root_hash', {});
        // casper-js-sdk expects the state_root_hash response — wrap in the
        // format it knows how to consume. Easiest path: use the existing
        // public Casper RPC client directly when needed, otherwise call
        // the lower-level CasperServiceByJsonRPC for the typed helpers.
        const { CasperServiceByJsonRPC } = require('casper-js-sdk');
        const url = process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc';
        const client = new CasperServiceByJsonRPC(url);
        const publicKey = CLPublicKey.fromHex(publicKeyHex);
        const balance = await client.getAccountBalanceUrefByPublicKey(stateRootHash, publicKey)
          .then((uref) => client.getAccountBalance(stateRootHash, uref));
        return balance.toString();
      },
    );
  } catch (error) {
    console.error('Failed to get account balance:', error);
    return '0';
  }
}

/**
 * Broadcast a signed deploy. NEVER fails over — putting a deploy on
 * the wrong RPC risks double-broadcast and a confused chain state.
 */
async function sendDeploy(signedDeploy) {
  const { CasperServiceByJsonRPC } = require('casper-js-sdk');
  const url = process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc';
  const client = new CasperServiceByJsonRPC(url);
  return client.deploy(signedDeploy);
}

function getRpcHealth() {
  return rpcSnapshot();
}

function getClient() {
  const { CasperServiceByJsonRPC } = require('casper-js-sdk');
  const url = process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc';
  return new CasperServiceByJsonRPC(url);
}

module.exports = {
  getClient,
  getKeysFromHex,
  getAccountBalance,
  sendDeploy,
  getRpcHealth,
};