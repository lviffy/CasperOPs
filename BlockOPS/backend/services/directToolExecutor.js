const axios = require('axios');
const {
  DeployUtil,
  Keys,
  RuntimeArgs,
  CLValueBuilder,
  CLPublicKey,
  CasperServiceByJsonRPC,
} = require('casper-js-sdk');
const { PORT } = require('../config/constants');
const { getChainMetadata, buildUnsupportedToolError, isToolSupportedOnChain } = require('../utils/chains');
const { getClient, getKeysFromHex, getAccountBalance } = require('../utils/blockchain');
const { deployCep18Token, deployCep78Collection } = require('./contractDeploymentService');
const { logger } = require('../utils/logger');

const BASE_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

const log = logger.child({ component: 'directToolExecutor' });

/**
 * Tool-to-endpoint table for HTTP-routed tools.
 * Tools not listed here are handled in-code (LOCAL handlers below).
 */
const TOOL_ENDPOINTS = {
  fetch_price: { method: 'POST', path: '/price/token' },
  get_balance: { method: 'GET', path: '/balance/{address}' },
  transfer: { method: 'POST', path: '/transfer' },
  batch_transfer: { method: 'POST', path: '/batch/transfer' },
  deploy_cep18: { method: 'POST', path: '/token/deploy' },
  deploy_cep78: { method: 'POST', path: '/nft/deploy-collection' },
  mint_nft: { method: 'POST', path: '/nft/mint' },
  get_token_info: { method: 'GET', path: '/token/info/{tokenHash}' },
  get_token_balance: { method: 'GET', path: '/token/balance/{tokenHash}/{ownerAddress}' },
  get_nft_info: { method: 'GET', path: '/nft/info/{collectionHash}/{tokenId}' },
  send_email: { method: 'POST', path: '/email/send' },
  calculate: { method: 'LOCAL' },
  lookup_deploy: { method: 'GET', path: '/chain/deploy/{deployHash}' },
  lookup_block: { method: 'GET', path: '/chain/block/{blockHeight}' },
  schedule_reminder: { method: 'POST', path: '/reminders' },
  list_reminders: { method: 'GET', path: '/reminders' },
  cancel_reminder: { method: 'DELETE', path: '/reminders/{id}' },
};

/**
 * Casper-native local tool executors (no HTTP roundtrip).
 */
const LOCAL_TOOL_HANDLERS = {
  register_agent,
  attest_agent,
  get_reputation,
  yield_rebalance,
  wallet_readiness,
};

/**
 * Extract a Casper account address (public key or account hash) from text.
 * Casper public keys are 66 hex chars prefixed with "01" or "02".
 */
function extractCasperAddressFromText(text = '') {
  if (!text) return null;
  const pubKeyMatch = text.match(/\b0[12][0-9a-fA-F]{64}\b/);
  if (pubKeyMatch) return pubKeyMatch[0];
  const accountHashMatch = text.match(/\baccount-hash-[0-9a-fA-F]{64}\b/);
  if (accountHashMatch) return accountHashMatch[0];
  return null;
}

function isSelfWalletQuery(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return false;
  return (
    /\bmy\b/.test(normalized) ||
    /\bme\b/.test(normalized) ||
    /\bmine\b/.test(normalized) ||
    /\bmy wallet\b/.test(normalized) ||
    /\bwhat is my balance\b/.test(normalized) ||
    /\bcheck my balance\b/.test(normalized) ||
    /\bwallet balance\b/.test(normalized) ||
    /\bmy portfolio\b/.test(normalized)
  );
}

function extractCsprAmountFromText(text = '') {
  const explicitMatch = text.match(/(?:transfer|send|pay|move)\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (explicitMatch) return explicitMatch[1];
  const hintedMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:cspr|motes?)\b/i);
  if (hintedMatch) return hintedMatch[1];
  return null;
}

function buildCasperWalletReadinessPayload({ address, balanceMotes }) {
  const meta = getChainMetadata();
  const balanceCspr = balanceMotes ? Number(balanceMotes) / 1_000_000_000 : 0;
  const funded = balanceMotes && Number(balanceMotes) > 0;
  return {
    success: true,
    address,
    balance: balanceCspr.toFixed(4),
    balanceMotes: balanceMotes || '0',
    readiness: funded ? 'ready' : 'needs_funding',
    funded,
    chain: meta.chain,
    chainName: meta.chainName,
    nativeCurrency: meta.nativeCurrency.symbol,
    faucetUrl: meta.faucetUrl,
    explorerBaseUrl: meta.explorerBaseUrl,
    explorerUrl: address ? `${meta.explorerBaseUrl}/account/${address}` : null,
    nextAction: funded
      ? 'Wallet is funded and ready for Casper automation tools.'
      : 'Wallet has no CSPR yet. Fund it from the Casper testnet faucet before running transfers or agent workflows.',
    recommendedTools: funded
      ? ['transfer', 'register_agent', 'attest_agent', 'yield_rebalance', 'deploy_cep18', 'deploy_cep78']
      : ['wallet_readiness'],
  };
}

async function wallet_readiness({ address }) {
  if (!address) {
    return { success: false, error: 'wallet_address is required' };
  }
  try {
    const client = getClient();
    const stateRootHash = await client.getStateRootHash();
    const publicKey = parseCasperPublicKey(address);
    const uref = await client.getAccountBalanceUrefByPublicKey(stateRootHash, publicKey);
    const balance = await client.getAccountBalance(stateRootHash, uref);
    log.info({ tool: 'wallet_readiness', address, balanceMotes: balance.toString() }, 'wallet readiness check ok');
    return buildCasperWalletReadinessPayload({ address, balanceMotes: balance.toString() });
  } catch (err) {
    log.warn({ tool: 'wallet_readiness', address, err: err.message }, 'wallet readiness check failed');
    return {
      success: false,
      address,
      readiness: 'unknown',
      error: err.message,
    };
  }
}

function parseCasperPublicKey(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) throw new Error('Missing public key');
  const hex = cleaned.startsWith('0x') ? cleaned.slice(2) : cleaned;
  if (!/^0[12][0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`Invalid Casper public key: ${cleaned}`);
  }
  return CLPublicKey.fromHex(hex);
}

/**
 * register_agent — calls the on-chain AgentFactory.deploy_agent entrypoint
 * via casper-js-sdk. Requires a server-side signing key (env CASPER_SECRET_KEY).
 */
async function register_agent({ agentAddress, secretKey }) {
  const sk = secretKey || process.env.CASPER_SECRET_KEY;
  if (!sk) {
    log.warn({ tool: 'register_agent', reason: 'missing_secret' }, 'register_agent missing CASPER_SECRET_KEY');
    return { success: false, error: 'CASPER_SECRET_KEY is required for on-chain agent registration' };
  }
  if (!agentAddress) {
    log.warn({ tool: 'register_agent', reason: 'missing_address' }, 'register_agent missing agentAddress');
    return { success: false, error: 'agentAddress is required' };
  }
  try {
    const keys = getKeysFromHex(sk);
    const agentKey = parseCasperPublicKey(agentAddress);
    const factoryHash = process.env.CASPER_AGENT_FACTORY_HASH;
    if (!factoryHash) {
      log.warn({ tool: 'register_agent', reason: 'missing_factory_hash' }, 'register_agent missing CASPER_AGENT_FACTORY_HASH');
      return { success: false, error: 'CASPER_AGENT_FACTORY_HASH env var is not set' };
    }

    const args = RuntimeArgs.fromMap({
      agent_address: CLValueBuilder.key(agentKey),
    });

    const params = new DeployUtil.DeployParams(keys.publicKey, 'casper-test');
    const session = DeployUtil.ExecutableDeployItem.newContractCall(
      { hash: factoryHash.startsWith('contract-') ? factoryHash.slice('contract-'.length) : factoryHash, packageHash: undefined },
      'deploy_agent',
      args,
    );
    const payment = DeployUtil.standardPayment(100_000_000);
    const deploy = DeployUtil.makeDeploy(params, session, payment);
    const signed = DeployUtil.signDeploy(deploy, keys);
    const client = getClient();
    const deployHash = await client.deploy(signed);
    log.info({
      tool: 'register_agent',
      agentAddress,
      deployer: keys.publicKey.toHex(),
      factoryHash,
      deployHash,
    }, 'register_agent deploy submitted');
    return {
      success: true,
      standard: 'AgentFactory',
      contractHash: factoryHash,
      deployHash,
      agentAddress,
      owner: keys.publicKey.toHex(),
      explorerUrl: `https://testnet.cspr.live/deploy/${deployHash}`,
    };
  } catch (err) {
    log.error({ tool: 'register_agent', agentAddress, err: err.message, stack: err.stack }, 'register_agent deploy failed');
    return { success: false, error: err.message };
  }
}

/**
 * attest_agent — calls on-chain Compliance.attest_agent entrypoint.
 */
async function attest_agent({ agentAddress, verified, metadataUri, secretKey }) {
  const sk = secretKey || process.env.CASPER_SECRET_KEY;
  if (!sk) {
    log.warn({ tool: 'attest_agent', reason: 'missing_secret' }, 'attest_agent missing CASPER_SECRET_KEY');
    return { success: false, error: 'CASPER_SECRET_KEY is required' };
  }
  if (!agentAddress || typeof verified !== 'boolean' || !metadataUri) {
    log.warn({ tool: 'attest_agent', agentAddress, verified, hasUri: Boolean(metadataUri) }, 'attest_agent invalid args');
    return { success: false, error: 'agentAddress, verified (bool), metadataUri are required' };
  }
  try {
    const keys = getKeysFromHex(sk);
    const agentKey = parseCasperPublicKey(agentAddress);
    const contractHash = process.env.CASPER_COMPLIANCE_HASH;
    if (!contractHash) {
      log.warn({ tool: 'attest_agent', reason: 'missing_compliance_hash' }, 'attest_agent missing CASPER_COMPLIANCE_HASH');
      return { success: false, error: 'CASPER_COMPLIANCE_HASH env var is not set' };
    }

    const args = RuntimeArgs.fromMap({
      agent: CLValueBuilder.key(agentKey),
      verified: CLValueBuilder.bool(verified),
      uri: CLValueBuilder.string(metadataUri),
    });

    const params = new DeployUtil.DeployParams(keys.publicKey, 'casper-test');
    const session = DeployUtil.ExecutableDeployItem.newContractCall(
      { hash: contractHash.startsWith('contract-') ? contractHash.slice('contract-'.length) : contractHash, packageHash: undefined },
      'attest_agent',
      args,
    );
    const payment = DeployUtil.standardPayment(150_000_000);
    const deploy = DeployUtil.makeDeploy(params, session, payment);
    const signed = DeployUtil.signDeploy(deploy, keys);
    const deployHash = await getClient().deploy(signed);
    log.info({
      tool: 'attest_agent',
      agentAddress,
      verified,
      contractHash,
      deployHash,
    }, 'attest_agent deploy submitted');
    return {
      success: true,
      contractHash,
      deployHash,
      agentAddress,
      verified,
      metadataUri,
      explorerUrl: `https://testnet.cspr.live/deploy/${deployHash}`,
    };
  } catch (err) {
    log.error({ tool: 'attest_agent', agentAddress, err: err.message, stack: err.stack }, 'attest_agent deploy failed');
    return { success: false, error: err.message };
  }
}

/**
 * get_reputation — reads rating + success/failure stats from on-chain Reputation.
 */
async function get_reputation({ agentAddress }) {
  if (!agentAddress) {
    log.warn({ tool: 'get_reputation', reason: 'missing_address' }, 'get_reputation missing agentAddress');
    return { success: false, error: 'agentAddress is required' };
  }
  try {
    const contractHash = process.env.CASPER_REPUTATION_HASH;
    if (!contractHash) {
      log.warn({ tool: 'get_reputation', reason: 'missing_reputation_hash' }, 'get_reputation missing CASPER_REPUTATION_HASH');
      return { success: false, error: 'CASPER_REPUTATION_HASH env var is not set' };
    }

    const client = getClient();
    const stateRootHash = await client.getStateRootHash();
    const agentKey = parseCasperPublicKey(agentAddress);
    const dictKey = agentKey.toHex();

    const cleanHash = contractHash.startsWith('contract-') ? contractHash.slice('contract-'.length) : contractHash;
    const ratingKey = `rating_${dictKey}`;
    const successKey = `success_${dictKey}`;
    const failureKey = `failure_${dictKey}`;

    const [rating, successCount, failureCount] = await Promise.all([
      client.getBlockState(stateRootHash, cleanHash, [ratingKey]).catch(() => null),
      client.getBlockState(stateRootHash, cleanHash, [successKey]).catch(() => null),
      client.getBlockState(stateRootHash, cleanHash, [failureKey]).catch(() => null),
    ]);

    const result = {
      success: true,
      contractHash,
      agentAddress,
      rating: rating?.storedValue?.CLValue?.parsed?.[0] ?? 0,
      successCount: successCount?.storedValue?.CLValue?.parsed?.[0] ?? 0,
      failureCount: failureCount?.storedValue?.CLValue?.parsed?.[0] ?? 0,
      source: 'casper_rpc',
    };
    log.info({ tool: 'get_reputation', agentAddress, ...result }, 'get_reputation read ok');
    return result;
  } catch (err) {
    log.error({ tool: 'get_reputation', agentAddress, err: err.message }, 'get_reputation read failed');
    return { success: false, error: err.message };
  }
}

/**
 * yield_rebalance — server-side stub. In production this would call the on-chain
 * YieldVault / DEX contracts; for now we emit a deterministic recommendation.
 */
async function yield_rebalance({ agentAddress, strategyId, riskTolerance = 'medium' }) {
  if (!agentAddress) {
    log.warn({ tool: 'yield_rebalance', reason: 'missing_address' }, 'yield_rebalance missing agentAddress');
    return { success: false, error: 'agentAddress is required' };
  }
  const allowed = new Set(['low', 'medium', 'high']);
  if (!allowed.has(riskTolerance)) {
    log.warn({ tool: 'yield_rebalance', agentAddress, riskTolerance }, 'yield_rebalance invalid riskTolerance');
    return { success: false, error: `riskTolerance must be one of: ${[...allowed].join(', ')}` };
  }
  const plan = {
    success: true,
    agentAddress,
    strategyId: strategyId || 'default-casper-dex',
    riskTolerance,
    actions: [
      { protocol: 'Casper DEX', action: 'stake', allocation: '40%' },
      { protocol: 'Liquid Staking (CSPR)', action: 'stake', allocation: '30%' },
      { protocol: 'Stable Vault', action: 'deposit', allocation: '30%' },
    ],
    note: 'Recommendation emitted. Wire this to your on-chain DEX/vault contracts for live execution.',
  };
  log.info({ tool: 'yield_rebalance', agentAddress, riskTolerance, strategyId: plan.strategyId }, 'yield_rebalance plan generated');
  return plan;
}

/**
 * Compute a numeric expression safely (no eval). Supports + - * / ( ) and numeric values.
 */
function safeCalculate(params) {
  try {
    const expression = params.expression || '';
    let variables = params.variables || params.values || {};
    if (typeof variables === 'string') {
      try { variables = JSON.parse(variables); } catch { variables = {}; }
    }
    if (typeof variables !== 'object' || variables === null) variables = {};

    let resolved = expression.replace(/\s+/g, ' ').trim();
    const sortedVars = Object.entries({ ...variables }).sort((a, b) => b[0].length - a[0].length);
    sortedVars.forEach(([name, value]) => {
      const numValue = parseFloat(String(value).replace(/,/g, ''));
      if (isNaN(numValue)) throw new Error(`Variable '${name}' has non-numeric value: ${value}`);
      const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'g');
      resolved = resolved.replace(pattern, String(numValue));
    });
    resolved = resolved.replace(/\s+/g, ' ').trim();

    const allowedChars = /^[0-9+\-*/().eE\s]+$/;
    if (!allowedChars.test(resolved)) {
      const badChars = resolved.split('').filter((c) => !/[0-9+\-*/().eE\s]/.test(c));
      return { success: false, tool: 'calculate', error: `Invalid characters: [${badChars.join(', ')}]` };
    }
    const result = Function(`"use strict"; return (${resolved});`)();
    return {
      success: true,
      tool: 'calculate',
      result: { original_expression: expression, variables, resolved_expression: resolved, result, description: params.description || 'Calculation' },
    };
  } catch (err) {
    return { success: false, tool: 'calculate', error: `Calculation error: ${err.message}` };
  }
}

function readPathWithAliases(source, path) {
  if (!source || !path) return undefined;
  const aliasMap = {
    txHash: ['txHash', 'transactionHash', 'hash'],
    transactionHash: ['transactionHash', 'txHash', 'hash'],
    hash: ['hash', 'transactionHash', 'txHash'],
    status: ['status'],
  };
  let current = source;
  for (const segment of path.split('.')) {
    if (current == null) return undefined;
    if (Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment];
      continue;
    }
    const aliases = aliasMap[segment] || [];
    const matched = aliases.find((a) => Object.prototype.hasOwnProperty.call(current, a));
    if (matched) {
      current = current[matched];
      continue;
    }
    return undefined;
  }
  return current;
}

function stringifyInterpolatedValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function interpolateParameters(params, previousResults) {
  if (!params) return params;
  const interpolated = { ...params };
  if (!previousResults || previousResults.length === 0) return interpolated;

  const resultsByTool = {};
  for (const result of previousResults) {
    if (result?.success && result?.result) resultsByTool[result.tool] = result.result;
  }
  const latestResult = [...previousResults].reverse().find((r) => r?.success && r?.result)?.result || null;

  const applyTemplateInterpolation = (input) => {
    if (typeof input !== 'string') return input;
    let value = input;
    value = value.replace(/\$\$PREVIOUS_RESULT\.([A-Za-z0-9_.]+)/g, (_match, path) => {
      const resolved = readPathWithAliases(latestResult, path);
      return resolved === undefined ? _match : stringifyInterpolatedValue(resolved);
    });
    value = value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_.]+)/g, (_match, toolName, path) => {
      const toolResult = resultsByTool[toolName];
      if (!toolResult) return _match;
      const resolved = readPathWithAliases(toolResult, path);
      return resolved === undefined ? _match : stringifyInterpolatedValue(resolved);
    });
    return value;
  };

  if (params.expression) {
    const autoVariables = {};
    const priceResults = previousResults.filter((r) => r?.success && r?.tool === 'fetch_price');
    for (const pr of priceResults) {
      const price = pr.result?.prices?.[0]?.price;
      if (price != null) {
        const coin = (pr.result?.prices?.[0]?.coin || '').toLowerCase();
        if (coin.includes('cspr') || coin.includes('casper')) {
          autoVariables.cspr_price = price;
          autoVariables.cspr_price_usd = price;
        } else {
          autoVariables.token_price = price;
          autoVariables[`${coin}_price`] = price;
        }
      }
    }
    const balanceResults = previousResults.filter((r) => r?.success && r?.tool === 'get_balance');
    for (const br of balanceResults) {
      const balance = br.result?.balance;
      if (balance != null) {
        autoVariables.cspr_balance = balance;
        autoVariables.balance = balance;
      }
    }
    if (Object.keys(autoVariables).length > 0) {
      interpolated.variables = { ...autoVariables, ...(params.variables || {}) };
    }
  }

  Object.keys(interpolated).forEach((key) => {
    if (typeof interpolated[key] === 'string') {
      interpolated[key] = applyTemplateInterpolation(interpolated[key]);
    }
  });
  return interpolated;
}

function pickFirstUsableValue(...values) {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) continue;
      return t;
    }
    return v;
  }
  return null;
}

function mapToolParams(tool, params = {}, fallbackMessage = '', executionContext = {}) {
  const missing = [];
  let mapped = { ...params };
  const casperAddrInMessage = extractCasperAddressFromText(fallbackMessage);
  const contextualAddress = pickFirstUsableValue(
    params.toPublicKey,
    params.toAddress,
    params.to_address,
    params.recipient,
    params.address,
    params.wallet_address,
    params.publicKey,
    executionContext.walletAddress,
    casperAddrInMessage,
  );

  switch (tool) {
    case 'fetch_price': {
      const query = params.query || params.token_name || params.symbol || fallbackMessage;
      const vsCurrency = params.vsCurrency || params.vs_currency || params.currency;
      mapped = { query, vsCurrency: vsCurrency || 'USD' };
      if (!query) missing.push('query');
      break;
    }
    case 'get_balance': {
      const address = params.address || params.wallet_address || params.publicKey || contextualAddress;
      mapped = { address };
      if (!address) missing.push('address');
      break;
    }
    case 'transfer': {
      const privateKey = params.privateKey || params.private_key || executionContext.privateKey;
      const fromAddress = params.fromAddress || params.from_address || executionContext.walletAddress || contextualAddress;
      const toAddress = params.toAddress || params.to_address || params.toPublicKey || params.recipient || contextualAddress;
      const amount = params.amount || params.value || extractCsprAmountFromText(fallbackMessage);
      const tokenAddress = params.tokenAddress || params.token_address;
      mapped = { privateKey, fromAddress, toAddress, amount };
      if (tokenAddress) mapped.tokenAddress = tokenAddress;
      if (!toAddress) missing.push('toAddress');
      if (!amount) missing.push('amount');
      break;
    }
    case 'batch_transfer': {
      const recipients = params.recipients;
      mapped = { recipients };
      if (!recipients || !Array.isArray(recipients) || recipients.length === 0) missing.push('recipients');
      break;
    }
    case 'deploy_cep18':
    case 'deploy_cep78': {
      const privateKey = params.privateKey || params.private_key || executionContext.privateKey;
      mapped = { privateKey, ...params };
      if (!privateKey) missing.push('privateKey');
      if (!params.name) missing.push('name');
      if (!params.symbol) missing.push('symbol');
      break;
    }
    case 'mint_nft': {
      const collectionHash = params.collectionHash || params.contract_address || params.collectionAddress;
      const toAddress = params.toAddress || params.to_address || contextualAddress;
      mapped = { collectionHash, toAddress, tokenUri: params.tokenUri || params.token_uri };
      if (!collectionHash) missing.push('collectionHash');
      if (!toAddress) missing.push('toAddress');
      break;
    }
    case 'get_token_info': {
      const tokenHash = params.tokenHash || params.contract_address || params.tokenAddress;
      mapped = { tokenHash };
      if (!tokenHash) missing.push('tokenHash');
      break;
    }
    case 'get_token_balance': {
      const tokenHash = params.tokenHash || params.tokenAddress;
      const ownerAddress = params.ownerAddress || params.wallet_address || contextualAddress;
      mapped = { tokenHash, ownerAddress };
      if (!tokenHash) missing.push('tokenHash');
      if (!ownerAddress) missing.push('ownerAddress');
      break;
    }
    case 'get_nft_info': {
      const collectionHash = params.collectionHash || params.contract_address;
      const tokenId = params.tokenId || params.token_id;
      mapped = { collectionHash, tokenId };
      if (!collectionHash) missing.push('collectionHash');
      break;
    }
    case 'lookup_deploy': {
      const deployHash = params.deployHash || params.hash || params.txHash;
      mapped = { deployHash };
      if (!deployHash) missing.push('deployHash');
      break;
    }
    case 'lookup_block': {
      const blockHeight = params.blockHeight || params.blockNumber || 'latest';
      mapped = { blockHeight };
      break;
    }
    case 'register_agent':
    case 'attest_agent':
    case 'get_reputation':
    case 'yield_rebalance':
    case 'wallet_readiness': {
      mapped = { ...params };
      if (tool === 'attest_agent' && typeof mapped.verified !== 'boolean') missing.push('verified');
      if (tool === 'yield_rebalance' && mapped.riskTolerance && !['low', 'medium', 'high'].includes(mapped.riskTolerance)) {
        missing.push('riskTolerance');
      }
      if (['register_agent', 'attest_agent', 'get_reputation', 'yield_rebalance'].includes(tool) && !mapped.agentAddress) {
        missing.push('agentAddress');
      }
      if (tool === 'wallet_readiness' && !mapped.address) missing.push('address');
      break;
    }
    case 'send_email': {
      const explicitRecipient = params.to || params.email || params.recipient;
      mapped = {
        to: explicitRecipient || executionContext.defaultEmailTo,
        subject: params.subject || params.title,
        text: params.text || params.body,
        html: params.html,
        cc: params.cc,
        bcc: params.bcc,
        replyTo: params.replyTo,
      };
      if (!mapped.to) missing.push('to');
      if (!mapped.subject) missing.push('subject');
      if (!mapped.text && !mapped.html) missing.push('text');
      break;
    }
    case 'calculate': {
      mapped = { expression: params.expression, variables: params.variables || params.values, description: params.description };
      if (!mapped.expression) missing.push('expression');
      break;
    }
    default:
      break;
  }

  return { mapped, missing };
}

function replacePathParams(path, params) {
  let result = path;
  const replacements = {
    '{address}': 'address',
    '{deployHash}': 'deployHash',
    '{blockHeight}': 'blockHeight',
    '{tokenHash}': 'tokenHash',
    '{ownerAddress}': 'ownerAddress',
    '{collectionHash}': 'collectionHash',
    '{tokenId}': 'tokenId',
    '{id}': 'id',
  };
  Object.entries(replacements).forEach(([placeholder, key]) => {
    if (result.includes(placeholder) && params[key]) {
      result = result.replace(placeholder, encodeURIComponent(params[key]));
    }
  });
  return result;
}

/**
 * Execute a single tool step. Tries local handler, then HTTP route, then errors out.
 */
async function executeToolStep(step, fallbackMessage = '', executionContext = {}) {
  const { tool, parameters } = step;
  const { mapped, missing } = mapToolParams(tool, parameters || {}, fallbackMessage, executionContext);
  const stepLog = log.child({ tool });

  if (!isToolSupportedOnChain(tool)) {
    stepLog.warn({ reason: 'unsupported_tool' }, 'tool step rejected');
    return {
      tool_call: { tool, parameters: mapped },
      result: { success: false, tool, error: buildUnsupportedToolError(tool) },
    };
  }
  if (missing.length > 0) {
    stepLog.warn({ missing, reason: 'missing_params' }, 'tool step missing required params');
    return {
      tool_call: { tool, parameters: mapped },
      result: { success: false, tool, error: `Missing required parameters: ${missing.join(', ')}` },
    };
  }

  if (LOCAL_TOOL_HANDLERS[tool]) {
    try {
      const payload = await LOCAL_TOOL_HANDLERS[tool](mapped, executionContext);
      const ok = payload?.success !== false;
      stepLog[ok ? 'info' : 'warn']({ ok, keys: Object.keys(payload || {}) }, 'local tool step finished');
      return {
        tool_call: { tool, parameters: mapped },
        result: { success: ok, tool, result: payload },
      };
    } catch (err) {
      stepLog.error({ err: err.message, stack: err.stack }, 'local tool step threw');
      return { tool_call: { tool, parameters: mapped }, result: { success: false, tool, error: err.message } };
    }
  }

  if (tool === 'calculate') {
    const result = safeCalculate(mapped);
    stepLog[result?.success ? 'info' : 'warn']({ ok: result?.success }, 'calculate step finished');
    return { tool_call: { tool, parameters: mapped }, result };
  }

  const config = TOOL_ENDPOINTS[tool];
  if (!config) {
    stepLog.error({ reason: 'no_endpoint' }, 'tool has no endpoint and no local handler');
    return { tool_call: { tool, parameters: mapped }, result: { success: false, tool, error: 'Tool not supported for direct execution' } };
  }

  const headers = {};
  if (executionContext.apiKey) headers['x-api-key'] = executionContext.apiKey;
  const url = `${BASE_URL}${replacePathParams(config.path, mapped)}`;
  const requestParams = { ...mapped };
  Object.keys(requestParams).forEach((key) => {
    if (config.path.includes(`{${key}}`)) delete requestParams[key];
  });

  stepLog.debug({ url, method: config.method }, 'dispatching tool step via HTTP');
  try {
    let response;
    if (config.method === 'POST') {
      response = await axios.post(url, requestParams, {
        headers: Object.keys(headers).length ? headers : undefined,
        timeout: 30000,
      });
    } else if (config.method === 'GET') {
      const hasQuery = Object.keys(requestParams).length > 0;
      response = await axios.get(url, {
        headers: Object.keys(headers).length ? headers : undefined,
        params: hasQuery ? requestParams : undefined,
        timeout: 30000,
      });
    } else if (config.method === 'DELETE') {
      const hasQuery = Object.keys(requestParams).length > 0;
      response = await axios.delete(url, {
        headers: Object.keys(headers).length ? headers : undefined,
        params: hasQuery ? requestParams : undefined,
        timeout: 30000,
      });
    } else {
      throw new Error(`Unsupported method: ${config.method}`);
    }
    stepLog.info({ status: response.status }, 'http tool step ok');
    return { tool_call: { tool, parameters: mapped }, result: { success: true, tool, result: response.data } };
  } catch (err) {
    const statusCode = err.response?.status;
    const detail = err.response?.data?.error || err.response?.data?.message || err.response?.data?.details || err.message;
    stepLog.error({ statusCode, err: detail }, 'http tool step failed');
    return { tool_call: { tool, parameters: mapped }, result: { success: false, tool, error: statusCode ? `HTTP ${statusCode}: ${detail}` : detail } };
  }
}

function interpolateStepParameters(step, previousResults, fallbackMessage = '', executionContext = {}) {
  const tool = step?.tool;
  const interpolated = interpolateParameters(step?.parameters || {}, previousResults);
  if (tool === 'lookup_deploy' && !interpolated.deployHash && !interpolated.hash) {
    const latestTransfer = [...previousResults].reverse().find((r) => r?.tool === 'transfer' && r?.success);
    const transferHash = latestTransfer?.result?.deployHash || latestTransfer?.result?.hash || latestTransfer?.result?.transactionHash;
    if (transferHash) interpolated.deployHash = transferHash;
  }
  if (tool === 'lookup_block' && !interpolated.blockHeight) interpolated.blockHeight = 'latest';
  return interpolated;
}

async function executeToolsDirectly(routingPlan, fallbackMessage, executionContext = {}) {
  if (!routingPlan?.execution_plan?.steps?.length) {
    log.debug({ reason: 'no_steps' }, 'executeToolsDirectly called with empty plan');
    return { tool_calls: [], results: [] };
  }
  const { steps, type } = routingPlan.execution_plan;
  log.info({ stepCount: steps.length, type, tools: steps.map((s) => s.tool) }, 'executing tools directly');

  if (type === 'parallel') {
    const results = await Promise.all(steps.map((step) => executeToolStep(step, fallbackMessage, executionContext)));
    log.info({ ok: results.filter((r) => r.result?.success).length, total: results.length }, 'parallel tool batch finished');
    return { tool_calls: results.map((r) => r.tool_call), results: results.map((r) => r.result) };
  }

  const toolCalls = [];
  const toolResults = [];
  for (const step of steps) {
    const interpolatedStep = {
      ...step,
      parameters: interpolateStepParameters(step, toolResults, fallbackMessage, executionContext),
    };
    const { tool_call, result } = await executeToolStep(interpolatedStep, fallbackMessage, executionContext);
    toolCalls.push(tool_call);
    toolResults.push(result);
  }
  log.info({
    ok: toolResults.filter((r) => r?.success).length,
    total: toolResults.length,
  }, 'sequential tool batch finished');
  return { tool_calls: toolCalls, results: toolResults };
}

function formatToolResponse(toolResults) {
  if (!toolResults?.tool_calls?.length) return 'No tool calls were executed.';
  const messages = toolResults.results.map((result, index) => {
    const tool = toolResults.tool_calls[index]?.tool;
    if (!result?.success) {
      return `${tool}: ${result?.error || 'Failed to execute tool.'}`;
    }
    const payload = result.result || {};
    switch (tool) {
      case 'fetch_price': {
        const prices = payload.prices || [];
        if (!prices.length) return 'Price data not available.';
        const formatted = prices.map((price) => {
          const currency = (price.currency || '').toUpperCase();
          const value = typeof price.price === 'number' ? price.price.toFixed(4) : price.price;
          const change = price.change_24h != null
            ? ` (24h ${price.change_24h > 0 ? '+' : ''}${Number(price.change_24h).toFixed(2)}%)`
            : '';
          return `${(price.coin || 'TOKEN').toUpperCase()}: ${value} ${currency}${change}`;
        }).join(', ');
        return `Current prices: ${formatted}.`;
      }
      case 'get_balance': {
        const symbol = payload.nativeCurrency || 'CSPR';
        return `Balance for ${payload.address}: ${payload.balance} ${symbol}.`;
      }
      case 'wallet_readiness': {
        return payload.funded
          ? `Casper wallet ${payload.address} is ready with ${payload.balance} ${payload.nativeCurrency || 'CSPR'}.`
          : `Casper wallet ${payload.address} needs funding. Current balance: ${payload.balance || '0'} ${payload.nativeCurrency || 'CSPR'}. Faucet: ${payload.faucetUrl}.`;
      }
      case 'register_agent':
        return `Agent registered. Tx: ${payload.deployHash}. Explorer: ${payload.explorerUrl}`;
      case 'attest_agent':
        return `Agent attested (verified=${payload.verified}). Tx: ${payload.deployHash}.`;
      case 'get_reputation':
        return `Reputation for ${payload.agentAddress}: rating ${payload.rating}, ${payload.successCount} successes / ${payload.failureCount} failures.`;
      case 'yield_rebalance':
        return `Yield rebalance plan (${payload.riskTolerance} risk): ${payload.actions.map((a) => `${a.protocol} ${a.action} ${a.allocation}`).join('; ')}.`;
      case 'transfer':
        return payload.deployHash
          ? `Transfer submitted on Casper Testnet. Deploy: ${payload.deployHash}. Explorer: https://testnet.cspr.live/deploy/${payload.deployHash}`
          : payload.requiresSigning
            ? `Transfer prepared for wallet signing. Approve in CSPR.click to broadcast.`
            : `Transfer result: ${JSON.stringify(payload)}.`;
      case 'lookup_deploy':
        return `Deploy ${(payload.deployHash || payload.hash || '').slice(0, 12)}… status: ${payload.status || 'unknown'}. Block: ${payload.blockHeight || 'pending'}.`;
      case 'lookup_block':
        return `Block ${payload.blockHeight}: ${payload.transactionCount || 0} txs, era ${payload.eraId || 'n/a'}.`;
      case 'send_email':
        return `Email sent successfully.`;
      case 'calculate':
        return `Calculation result: ${payload.result}.`;
      case 'deploy_cep18':
      case 'deploy_cep78':
      case 'mint_nft':
      case 'get_token_info':
      case 'get_token_balance':
      case 'get_nft_info':
        return `${tool} succeeded. ${payload.transactionHash || payload.deployHash ? `Tx: ${payload.transactionHash || payload.deployHash}.` : ''} ${payload.tokenAddress || payload.collectionAddress || payload.contractHash || ''}`.trim();
      default:
        return `Executed ${tool}.`;
    }
  });
  return messages.join('\n');
}

module.exports = {
  executeToolsDirectly,
  formatToolResponse,
  safeCalculate,
  wallet_readiness,
  register_agent,
  attest_agent,
  get_reputation,
  yield_rebalance,
};
