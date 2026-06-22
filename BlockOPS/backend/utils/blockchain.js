const { CasperServiceByJsonRPC, Keys } = require('casper-js-sdk');

const rpcUrl = process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc';
const client = new CasperServiceByJsonRPC(rpcUrl);

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
  try {
    const stateRootHash = await client.getStateRootHash();
    const publicKey = Keys.PublicKey.fromHex(publicKeyHex);
    const balance = await client.getAccountBalanceUrefByPublicKey(stateRootHash, publicKey)
      .then(uref => client.getAccountBalance(stateRootHash, uref));
    return balance.toString();
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
