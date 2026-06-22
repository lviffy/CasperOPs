const path = require('path');
const { ethers } = require('ethers');
const { createAuthManager, storagePlugins, ViemAccountAuthenticator } = require('@lit-protocol/auth');
const { createLitClient } = require('@lit-protocol/lit-client');
const { nagaTest } = require('@lit-protocol/networks');
const { createPublicClient, createWalletClient, http } = require('viem');
const { arbitrumSepolia, flowTestnet } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const { getChainConfig } = require('../config/constants');
const { normalizeChainId } = require('../utils/chains');

const DEFAULT_APP_NAME = 'blockops';
const DEFAULT_RPC_URL = 'https://sepolia-rollup.arbitrum.io/rpc';
const DEFAULT_LIT_HANDSHAKE_TIMEOUT_MS = 20000;
const DEFAULT_AUTH_RESOURCES = [
  ['pkp-signing', '*'],
  ['lit-action-execution', '*']
];

let litClientPromise = null;
let authManagerInstance = null;
let controllerAuthDataPromise = null;

function getConfig() {
  const controllerPrivateKey = process.env.LIT_PKP_CONTROLLER_PRIVATE_KEY;
  const appDomain =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.BLOCKOPS_PUBLIC_URL ||
    'http://localhost:3001';
  const appName = process.env.LIT_APP_NAME || DEFAULT_APP_NAME;
  const arbitrumRpcUrl =
    process.env.ARBITRUM_SEPOLIA_RPC_URL ||
    process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    DEFAULT_RPC_URL;
  const storagePath = process.env.LIT_AUTH_STORAGE_PATH || path.join(process.cwd(), '.lit-auth');
  const handshakeTimeoutMs = Number(
    process.env.LIT_NAGA_HANDSHAKE_TIMEOUT_MS || DEFAULT_LIT_HANDSHAKE_TIMEOUT_MS
  );

  if (!controllerPrivateKey) {
    throw new Error('Lit PKP signing is not configured: missing LIT_PKP_CONTROLLER_PRIVATE_KEY');
  }

  return {
    appDomain,
    appName,
    arbitrumRpcUrl,
    controllerPrivateKey: controllerPrivateKey.startsWith('0x')
      ? controllerPrivateKey
      : `0x${controllerPrivateKey}`,
    handshakeTimeoutMs: Number.isFinite(handshakeTimeoutMs)
      ? Math.max(handshakeTimeoutMs, DEFAULT_LIT_HANDSHAKE_TIMEOUT_MS)
      : DEFAULT_LIT_HANDSHAKE_TIMEOUT_MS,
    storagePath
  };
}

function getNagaNetwork() {
  const { handshakeTimeoutMs } = getConfig();

  return {
    ...nagaTest,
    config: {
      ...nagaTest.config,
      abortTimeout: handshakeTimeoutMs
    }
  };
}

function formatLitHandshakeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Insufficient successful handshakes/i.test(message)) {
    const { handshakeTimeoutMs } = getConfig();
    return new Error(
      `Could not reach enough Lit Naga testnet nodes to mint/sign a PKP. The SDK requires at least 3 successful node handshakes, but your server reached fewer than that. Check firewall/VPN/proxy settings, allow outbound HTTPS/WebSocket traffic to Lit nodes, and try again. Current handshake timeout: ${handshakeTimeoutMs}ms.`
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function getControllerAccount() {
  const { controllerPrivateKey } = getConfig();
  return privateKeyToAccount(controllerPrivateKey);
}

async function getLitClient() {
  if (!litClientPromise) {
    litClientPromise = createLitClient({ network: getNagaNetwork() }).catch((error) => {
      litClientPromise = null;
      throw formatLitHandshakeError(error);
    });
  }

  return litClientPromise;
}

function getAuthManager() {
  if (!authManagerInstance) {
    const { appName, storagePath } = getConfig();
    authManagerInstance = createAuthManager({
      storage: storagePlugins.localStorageNode({
        appName,
        networkName: 'naga-test',
        storagePath
      })
    });
  }

  return authManagerInstance;
}

async function getControllerAuthData() {
  if (!controllerAuthDataPromise) {
    controllerAuthDataPromise = ViemAccountAuthenticator.authenticate(getControllerAccount());
  }

  return controllerAuthDataPromise;
}

function getAuthConfig() {
  const { appDomain } = getConfig();

  return {
    resources: DEFAULT_AUTH_RESOURCES.map((resource) => [...resource]),
    expiration: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
    statement: 'BlockOps delegated PKP session',
    domain: appDomain
  };
}

function resolveViemChain(chain) {
  const normalized = typeof chain === 'string' ? normalizeChainId(chain) : normalizeChainId(chain?.id || chain?.name);
  if (normalized === 'flow-testnet') {
    return flowTestnet;
  }
  return arbitrumSepolia;
}

function getChainClients(chain = arbitrumSepolia) {
  const viemChain = resolveViemChain(chain);
  const chainConfig = getChainConfig(viemChain.id === 545 ? 'flow-testnet' : 'arbitrum-sepolia');
  const transport = http(chainConfig.rpcUrl);

  return {
    chain: viemChain,
    publicClient: createPublicClient({
      chain: viemChain,
      transport
    }),
    transport
  };
}

async function createPkpWalletClient(pkpPublicKey, chain = arbitrumSepolia) {
  const litClient = await getLitClient();
  const authManager = getAuthManager();
  const authData = await getControllerAuthData();
  const authContext = await authManager.createPkpAuthContext({
    authData,
    pkpPublicKey,
    authConfig: getAuthConfig(),
    litClient
  });
  const { publicClient, transport, chain: viemChain } = getChainClients(chain);
  const pkpAccount = await litClient.getPkpViemAccount({
    pkpPublicKey,
    authContext,
    chainConfig: viemChain
  });

  const walletClient = createWalletClient({
    account: pkpAccount,
    chain: viemChain,
    transport
  });

  return {
    publicClient,
    walletClient,
    pkpAccount
  };
}

function normalizeBigInt(value) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  return BigInt(value);
}

function normalizeTransaction(transaction) {
  return {
    to: transaction.to,
    data: transaction.data || undefined,
    value: normalizeBigInt(transaction.value) ?? BigInt(0),
    gas: normalizeBigInt(transaction.gas),
    maxFeePerGas: normalizeBigInt(transaction.maxFeePerGas),
    maxPriorityFeePerGas: normalizeBigInt(transaction.maxPriorityFeePerGas),
    nonce: transaction.nonce ?? undefined
  };
}

function deriveWalletAddressFromPkpPublicKey(pkpPublicKey) {
  return ethers.computeAddress(pkpPublicKey);
}

async function mintPkpWalletOnNagaTest() {
  const litClient = await getLitClient();
  const controllerAccount = getControllerAccount();
  const authData = await getControllerAuthData();

  const mintedResponse = await litClient.mintWithAuth({
    account: controllerAccount,
    authData,
    scopes: ['sign-anything']
  });

  const minted = mintedResponse?.data || mintedResponse?._raw?.data;
  if (!minted?.pubkey || minted?.tokenId === undefined || minted?.tokenId === null) {
    throw new Error('Lit PKP mint did not return a public key and tokenId');
  }

  return {
    walletType: 'pkp',
    walletAddress: minted.ethAddress || deriveWalletAddressFromPkpPublicKey(minted.pubkey),
    pkpPublicKey: minted.pubkey,
    pkpTokenId: minted.tokenId.toString(),
    mintedAt: new Date().toISOString()
  };
}

async function signAndBroadcastTransactionWithPkp({ pkpPublicKey, transaction, chain = arbitrumSepolia }) {
  const { walletClient, publicClient, pkpAccount } = await createPkpWalletClient(pkpPublicKey, chain);
  const viemChain = resolveViemChain(chain);
  const chainConfig = getChainConfig(viemChain.id === 545 ? 'flow-testnet' : 'arbitrum-sepolia');

  const hash = await walletClient.sendTransaction({
    ...normalizeTransaction(transaction),
    account: pkpAccount
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return {
    hash,
    explorerUrl: `${chainConfig.explorerBaseUrl}/tx/${hash}`,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status === 'success' ? 'success' : 'failed',
    receipt
  };
}

module.exports = {
  deriveWalletAddressFromPkpPublicKey,
  mintPkpWalletOnNagaTest,
  signAndBroadcastTransactionWithPkp
};
