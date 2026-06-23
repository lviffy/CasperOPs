const { CasperServiceByJsonRPC, Keys } = require('casper-js-sdk');
const { getCache } = require('../services/cacheService');

const rpcUrl = process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc';
const client = new CasperServiceByJsonRPC(rpcUrl);
const cache = getCache();

function getClient() {
  return client;
}

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
  try {
    return await cache.getOrFetch(
      'get_balance',
      { publicKey: publicKeyHex },
      async () => {
        const stateRootHash = await client.getStateRootHash();
        const publicKey = Keys.PublicKey.fromHex(publicKeyHex);
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

async function sendDeploy(deploy) {
  return await client.deploy(deploy);
}

module.exports = {
  getClient,
  getKeysFromHex,
  getAccountBalance,
  sendDeploy
};
