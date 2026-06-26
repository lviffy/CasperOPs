const { Keys, CLPublicKey } = require('casper-js-sdk');
const { getCache } = require('../services/cacheService');
const { rpc, snapshot: rpcSnapshot } = require('./rpcFailover');

const cache = getCache();

function getKeysFromHex(hexPrivateKey, algorithm = 'ed25519') {
  try {
    const rawPrivKey = hexPrivateKey.startsWith('0x') ? hexPrivateKey.slice(2) : hexPrivateKey;
    const privateKeyBuffer = Buffer.from(rawPrivKey, 'hex');

    if (algorithm === 'ed25519') {
      const privKey = Keys.Ed25519.parsePrivateKey(privateKeyBuffer);
      const pubKey = Keys.Ed25519.privateToPublicKey(privKey);
      return Keys.Ed25519.parseKeyPair(pubKey, privKey);
    } else {
      const privKey = Keys.Secp256K1.parsePrivateKey(privateKeyBuffer);
      const pubKey = Keys.Secp256K1.privateToPublicKey(privKey);
      return Keys.Secp256K1.parseKeyPair(pubKey, privKey);
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
  // Fast path: query CSPR.cloud REST API directly (authorized), avoids
  // the slow 2-step JSON-RPC flow (state root hash → uref → balance).
  try {
    return await cache.getOrFetch(
      'get_balance',
      { publicKey: publicKeyHex },
      async () => {
        const cloudUrl = process.env.CSPR_CLOUD_API_URL;
        const cloudKey = process.env.CSPR_CLOUD_API_KEY;

        if (cloudUrl && cloudKey) {
          // Direct REST API — fastest path, no multi-hop JSON-RPC
          const base = cloudUrl.replace(/\/+$/, '');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6000);
          try {
            const res = await fetch(`${base}/accounts/${publicKeyHex}`, {
              headers: {
                'accept': 'application/json',
                'authorization': cloudKey,
              },
              signal: controller.signal,
            });
            if (res.ok) {
              const json = await res.json();
              // liquid_balance_motes or balance from the REST response
              const motes = json?.data?.liquid_balance_motes
                ?? json?.liquid_balance_motes
                ?? json?.data?.balance
                ?? json?.balance
                ?? null;
              if (motes !== null && motes !== undefined) {
                return String(motes);
              }
            }
          } finally {
            clearTimeout(timer);
          }
          // Fall through to SDK approach if REST failed
        }

        // Fallback: 2-step JSON-RPC via failover layer
        const stateRootHashResult = await rpc('chain_get_state_root_hash', {});
        // The RPC response is { api_version, state_root_hash } — extract just the hash string.
        const stateRootHash = stateRootHashResult?.state_root_hash || stateRootHashResult;
        const { CasperServiceByJsonRPC } = require('casper-js-sdk');
        const activeRpcUrl = rpcSnapshot().activeUrl;
        const client = new CasperServiceByJsonRPC(activeRpcUrl);
        if (activeRpcUrl.includes('cspr.cloud') && process.env.CSPR_CLOUD_API_KEY) {
          const transport = client.client?.requestManager?.transports?.[0];
          if (transport && transport.headers && typeof transport.headers.set === 'function') {
            transport.headers.set('authorization', process.env.CSPR_CLOUD_API_KEY);
          }
        }
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
  if (url.includes('cspr.cloud') && process.env.CSPR_CLOUD_API_KEY) {
    const transport = client.client?.requestManager?.transports?.[0];
    if (transport && transport.headers && typeof transport.headers.set === 'function') {
      transport.headers.set('authorization', process.env.CSPR_CLOUD_API_KEY);
    }
  }
  const result = await client.deploy(signedDeploy);
  return result?.deploy_hash || result;
}

function getRpcHealth() {
  return rpcSnapshot();
}

function getClient() {
  const { CasperServiceByJsonRPC } = require('casper-js-sdk');
  const activeRpcUrl = rpcSnapshot().activeUrl;
  const client = new CasperServiceByJsonRPC(activeRpcUrl);
  if (activeRpcUrl.includes('cspr.cloud') && process.env.CSPR_CLOUD_API_KEY) {
    const transport = client.client?.requestManager?.transports?.[0];
    if (transport && transport.headers && typeof transport.headers.set === 'function') {
      transport.headers.set('authorization', process.env.CSPR_CLOUD_API_KEY);
    }
  }
  return client;
}

module.exports = {
  getClient,
  getKeysFromHex,
  getAccountBalance,
  sendDeploy,
  getRpcHealth,
};