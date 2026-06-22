const { ethers } = require('ethers');
const axios = require('axios');
const { DEFAULT_CHAIN, PORT, getChainConfig } = require('../config/constants');
const { signAndBroadcastTransactionWithPkp } = require('./litPkpService');
const { getProvider } = require('../utils/blockchain');
const { getAddressExplorerUrl } = require('../utils/helpers');
const {
  buildUnsupportedToolError,
  isToolSupportedOnChain,
  normalizeChainId
} = require('../utils/chains');

const BASE_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

const TOOL_ENDPOINTS = {
  fetch_price: { method: 'POST', path: '/price/token' },
  get_balance: { method: 'GET', path: '/balance/{address}' },
  transfer: { method: 'POST', path: '/transfer' },
  deploy_erc20: { method: 'POST', path: '/token/deploy' },
  deploy_erc721: { method: 'POST', path: '/nft/deploy-collection' },
  mint_nft: { method: 'POST', path: '/nft/mint' },
  get_token_info: { method: 'GET', path: '/token/info/{tokenId}' },
  get_token_balance: { method: 'GET', path: '/token/balance/{tokenId}/{ownerAddress}' },
  get_nft_info: { method: 'GET', path: '/nft/info/{collectionAddress}/{tokenId}' },
  send_email: { method: 'POST', path: '/email/send' },
  calculate: { method: 'LOCAL' },
  batch_transfer:      { method: 'POST', path: '/batch/transfer' },
  batch_mint:          { method: 'POST', path: '/batch/mint' },
  tx_status:           { method: 'GET',  path: '/wallet/tx/{hash}' },
  wallet_history:      { method: 'GET',  path: '/wallet/history/{address}' },
  lookup_transaction:  { method: 'GET',  path: '/chain/tx/{txHash}' },
  fetch_events:        { method: 'POST', path: '/chain/events' },
  lookup_block:        { method: 'GET',  path: '/chain/block/{blockNumber}' },
  decode_revert:       { method: 'POST', path: '/chain/decode/revert' },
  get_portfolio:       { method: 'GET',  path: '/portfolio/{address}' },
  resolve_ens:         { method: 'GET',  path: '/ens/resolve/{name}' },
  reverse_ens:         { method: 'GET',  path: '/ens/reverse/{address}' },
  estimate_gas:        { method: 'GET',  path: '/gas/estimate' },
  simulate_gas:        { method: 'POST', path: '/gas/simulate' },
  swap_tokens:         { method: 'POST', path: '/swap' },
  get_swap_quote:      { method: 'GET',  path: '/swap/quote' },
  bridge_deposit:      { method: 'POST', path: '/bridge/deposit' },
  bridge_withdraw:     { method: 'POST', path: '/bridge/withdraw' },
  bridge_status:       { method: 'GET',  path: '/bridge/status/{txHash}' },
  schedule_transfer:   { method: 'POST', path: '/schedule/transfer' },
  create_savings_plan: { method: 'POST', path: '/schedule/transfer' },
  schedule_payout:     { method: 'POST', path: '/schedule/transfer' },
  create_payroll_plan: { method: 'POST', path: '/schedule/transfer' },
  create_grant_payout: { method: 'POST', path: '/schedule/transfer' },
  get_flow_network_overview: { method: 'LOCAL' },
  get_flow_wallet_readiness: { method: 'LOCAL' },
  schedule_reminder:   { method: 'POST', path: '/reminders' },
  list_reminders:      { method: 'GET',  path: '/reminders' },
  cancel_reminder:     { method: 'DELETE', path: '/reminders/{id}' },
  list_schedules:      { method: 'GET',  path: '/schedule' },
  cancel_schedule:     { method: 'DELETE', path: '/schedule/{id}' }
};

function extractAddressFromText(text = '') {
  const match = text.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
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

function extractExplicitChainFromText(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return null;

  if (/\b(arbitrum sepolia|arb sepolia|arbitrum)\b/.test(normalized)) {
    return 'arbitrum-sepolia';
  }

  if (/\b(flow evm testnet|flow testnet|flow evm|flow)\b/.test(normalized)) {
    return 'flow-testnet';
  }

  return null;
}

function extractPrivateKeyFromText(text = '') {
  const match = text.match(/0x[a-fA-F0-9]{64}/);
  return match ? match[0] : null;
}

function getFlowFaucetUrl() {
  return (
    process.env.FLOW_TESTNET_FAUCET_URL ||
    process.env.NEXT_PUBLIC_FLOW_TESTNET_FAUCET_URL ||
    'https://testnet-faucet.onflow.org/fund-account'
  );
}

function buildFlowNetworkOverviewPayload() {
  const chain = 'flow-testnet';
  const config = getChainConfig(chain);

  return {
    success: true,
    chain: config.id,
    chainId: config.chainId,
    network: config.name,
    nativeCurrency: config.nativeCurrency.symbol,
    rpcUrl: config.rpcUrl,
    sponsoredRpcEnabled: Boolean(config.sponsoredRpcUrl),
    sponsoredRpcUrl: config.sponsoredRpcUrl,
    explorerBaseUrl: config.explorerBaseUrl,
    faucetUrl: getFlowFaucetUrl(),
    automationTools: [
      'create_savings_plan',
      'schedule_payout',
      'create_payroll_plan',
      'create_grant_payout',
      'schedule_reminder'
    ],
    walletModes: ['Privy embedded wallet', 'Traditional private key', 'Lit PKP'],
    notes: [
      'Flow EVM Testnet is the default demo chain for BlockOPs.',
      'Sponsored gas can be enabled via FLOW_EVM_TESTNET_SPONSORED_RPC_URL.',
      'Use Flowscan for transaction and wallet verification.'
    ]
  };
}

function extractEmailFromText(text = '') {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function extractReminderTaskTypeFromText(text = '') {
  const lower = String(text || '').toLowerCase();
  if (/\bportfolio\b/.test(lower)) return 'portfolio';
  if (/\bprice\b|\btoken\b/.test(lower)) return 'price';
  if (/\bbalance\b/.test(lower)) return 'balance';
  return null;
}

function wantsBulkReminderCancellation(text = '') {
  return /\b(all|every|each|both|all of them|cancel reminders|stop reminders)\b/i.test(String(text || ''));
}

function normalizeReminderIdList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function isOneShotReminderExpression(expression = '') {
  return /^\d{4}-\d{2}-\d{2}/.test(String(expression || ''));
}

function extractReminderJobsFromListPayload(payload = {}) {
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  if (Array.isArray(payload?.result?.jobs)) return payload.result.jobs;
  return [];
}

function inferReminderCancelTargets(previousResults = [], fallbackMessage = '', existingParams = {}) {
  const latestListResult = [...previousResults]
    .reverse()
    .find((result) => result?.tool === 'list_reminders' && result?.success);

  if (!latestListResult) {
    return null;
  }

  const listedJobs = extractReminderJobsFromListPayload(latestListResult.result || {});
  if (!listedJobs.length) {
    return null;
  }

  const activeJobs = listedJobs.filter((job) => {
    const liveStatus = String(job?.liveStatus || '').toLowerCase();
    return job?.status === 'active' || liveStatus === 'running' || liveStatus === 'pending_reload';
  });

  const candidatePool = activeJobs.length ? activeJobs : listedJobs;
  let filteredJobs = candidatePool;

  const desiredTaskType = existingParams.taskType || extractReminderTaskTypeFromText(fallbackMessage);
  if (desiredTaskType) {
    filteredJobs = filteredJobs.filter((job) => String(job?.task_type || '').toLowerCase() === desiredTaskType);
  }

  const desiredWalletAddress =
    existingParams.walletAddress ||
    existingParams.wallet_address ||
    extractAddressFromText(fallbackMessage);
  if (desiredWalletAddress) {
    filteredJobs = filteredJobs.filter(
      (job) => String(job?.wallet_address || '').toLowerCase() === String(desiredWalletAddress).toLowerCase()
    );
  }

  const preferRecurring = /\b(recurring|recursive|cron|every)\b/i.test(String(fallbackMessage || ''));
  const preferOneShot = /\b(one[\s-]?shot|once|single time)\b/i.test(String(fallbackMessage || ''));

  if (preferRecurring) {
    const recurringJobs = filteredJobs.filter(
      (job) => String(job?.type || '').toLowerCase() === 'recurring' || !isOneShotReminderExpression(job?.cron_expression)
    );
    if (recurringJobs.length) {
      filteredJobs = recurringJobs;
    }
  } else if (preferOneShot) {
    const oneShotJobs = filteredJobs.filter(
      (job) => String(job?.type || '').toLowerCase() === 'one_shot' || isOneShotReminderExpression(job?.cron_expression)
    );
    if (oneShotJobs.length) {
      filteredJobs = oneShotJobs;
    }
  }

  if (!filteredJobs.length) {
    filteredJobs = candidatePool;
  }

  const mode = existingParams.mode || (wantsBulkReminderCancellation(fallbackMessage) ? 'all' : 'latest');
  if (mode === 'all') {
    const ids = filteredJobs.map((job) => job?.id).filter(Boolean);
    if (!ids.length) return null;

    return {
      mode,
      ids,
      taskType: desiredTaskType || null,
      walletAddress: desiredWalletAddress || null
    };
  }

  const chosen = filteredJobs[0];
  if (!chosen?.id) {
    return null;
  }

  return {
    mode,
    id: chosen.id,
    taskType: desiredTaskType || null,
    walletAddress: desiredWalletAddress || null
  };
}

function isLikelyPlaceholderValue(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;

  return (
    /\$\$?\w+\.[A-Za-z0-9_.]+/.test(normalized) ||
    /\{\{.*\}\}|\{.*\}/.test(normalized) ||
    /^required_from_user$/i.test(normalized) ||
    /^\[required_from_user\]$/i.test(normalized) ||
    /^<required_from_user>$/i.test(normalized)
  );
}

function pickFirstUsableValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || isLikelyPlaceholderValue(trimmed)) {
        continue;
      }

      return trimmed;
    }

    return value;
  }

  return null;
}

function isLikelyPlaceholderEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (isLikelyPlaceholderValue(normalized)) return true;
  if (normalized === 'user@example.com') return true;
  if (/@example\.com$/.test(normalized)) return true;
  if (normalized.includes('your@email')) return true;
  return false;
}

function selectRecipientEmail({ explicitRecipient, defaultEmailTo, userEmail, fallbackEmail }) {
  if (explicitRecipient && !isLikelyPlaceholderEmail(explicitRecipient)) {
    return explicitRecipient;
  }
  return defaultEmailTo || userEmail || fallbackEmail || explicitRecipient || null;
}

function getLatestSuccessfulResult(previousResults = []) {
  return [...previousResults].reverse().find(result => result?.success && result?.result)?.result || null;
}

function readPathWithAliases(source, path) {
  if (!source || !path) return undefined;
  const aliasMap = {
    txHash: ['txHash', 'transactionHash', 'hash'],
    transactionHash: ['transactionHash', 'txHash', 'hash'],
    hash: ['hash', 'transactionHash', 'txHash'],
    status: ['status']
  };

  let current = source;
  for (const segment of path.split('.')) {
    if (current == null) return undefined;

    if (Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment];
      continue;
    }

    const aliases = aliasMap[segment] || [];
    const matchedAlias = aliases.find(alias => Object.prototype.hasOwnProperty.call(current, alias));
    if (matchedAlias) {
      current = current[matchedAlias];
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

function extractAmountFromText(text = '') {
  // Prefer "transfer/send <amount> [ETH]" patterns.
  const explicitMatch = text.match(/(?:transfer|send|pay|move)\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (explicitMatch) {
    return explicitMatch[1];
  }

  // Fallback to amount adjacent to ETH/token hints.
  const hintedMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:eth|token|usdc|usdt|arb)\b/i);
  if (hintedMatch) {
    return hintedMatch[1];
  }

  return null;
}

function generateDefaultEmailSubject(message = '') {
  const lower = message.toLowerCase();
  if (/transfer|transaction|tx\b/.test(lower)) return 'Transfer and Transaction Update';
  if (/deploy|token|nft/.test(lower)) return 'Blockchain Operation Update';
  return 'BlockOps Assistant Update';
}

function generateDefaultEmailText(message = '') {
  const cleaned = String(message || '').trim();
  if (!cleaned) {
    return 'Hello,\n\nThis is an automated update from your BlockOps assistant.\n\nRegards,\nBlockOps';
  }

  return [
    'Hello,',
    '',
    'Here is the latest update from your BlockOps assistant:',
    cleaned,
    '',
    'Regards,',
    'BlockOps'
  ].join('\n');
}

function generateEmailFromPreviousResults(previousResults = [], fallbackMessage = '') {
  const lines = previousResults.map((result) => {
    const toolName = result?.tool || 'tool';
    if (!result?.success) {
      return `- ${toolName}: failed (${result?.error || 'unknown error'})`;
    }

    if (toolName === 'transfer') {
      const txHash = result?.result?.transactionHash || result?.result?.txHash;
      if (txHash) return `- transfer: completed (tx ${txHash})`;
      if (result?.result?.prepared || result?.result?.requiresSigning) {
        return '- transfer: prepared and awaiting wallet signature';
      }
      return '- transfer: completed';
    }

    if (toolName === 'tx_status') {
      const status = result?.result?.status || 'unknown';
      const hash = result?.result?.hash || result?.result?.txHash;
      return hash ? `- tx_status: ${status} (${hash})` : `- tx_status: ${status}`;
    }

    if (toolName === 'lookup_transaction') {
      const status = result?.result?.receipt?.status || result?.result?.status || 'unknown';
      const hash = result?.result?.hash || result?.result?.txHash;
      return hash ? `- lookup_transaction: ${status} (${hash})` : `- lookup_transaction: ${status}`;
    }

    if (toolName === 'get_balance') {
      const balance = result?.result?.balance;
      const address = result?.result?.address;
      if (balance && address) return `- get_balance: ${balance} ETH at ${address}`;
    }

    return `- ${toolName}: success`;
  }).filter(Boolean);

  const subject =
    previousResults.some(r => r?.tool === 'tx_status' || r?.tool === 'lookup_transaction')
      ? 'Transaction Status Confirmation'
      : previousResults.some(r => r?.tool === 'transfer')
        ? 'Transfer Update'
        : generateDefaultEmailSubject(fallbackMessage);

  const bodyLines = [
    'Hello,',
    '',
    'Here is your requested blockchain update:',
    ...lines,
    '',
    `Original request: "${String(fallbackMessage || '').trim()}"`,
    '',
    'Regards,',
    'BlockOps'
  ];

  return {
    subject,
    text: bodyLines.join('\n')
  };
}

function mapToolParams(tool, params = {}, fallbackMessage, executionContext = {}) {
  const missing = [];
  let mapped = { ...params };
  const explicitChainInMessage = extractExplicitChainFromText(fallbackMessage);
  const chain = normalizeChainId(explicitChainInMessage || executionContext.chain || params.chain || DEFAULT_CHAIN);
  const explicitAddressInMessage = extractAddressFromText(fallbackMessage);
  const requestWalletAddress = executionContext.walletAddress || executionContext.wallet_address || null;
  const shouldPreferExecutionWallet =
    Boolean(requestWalletAddress) &&
    !explicitAddressInMessage &&
    isSelfWalletQuery(fallbackMessage);
  const contextualAddress = pickFirstUsableValue(
    shouldPreferExecutionWallet ? requestWalletAddress : null,
    params.wallet_address,
    params.address,
    requestWalletAddress,
    explicitAddressInMessage
  );
  const contextualPrivateKey = pickFirstUsableValue(
    executionContext.privateKey,
    executionContext.private_key,
    params.privateKey,
    params.private_key,
    extractPrivateKeyFromText(fallbackMessage)
  );

  switch (tool) {
    case 'fetch_price': {
      const query = params.query || params.token_name || params.symbol || fallbackMessage;
      const vsCurrency = params.vsCurrency || params.vs_currency || params.currency;
      mapped = { query, chain };
      if (vsCurrency) mapped.vsCurrency = vsCurrency;
      if (!query) missing.push('query');
      break;
    }
    case 'get_balance': {
      const address = params.address || params.wallet_address || contextualAddress;
      mapped = { address, chain };
      if (!address) missing.push('address');
      break;
    }
    case 'get_flow_network_overview': {
      mapped = { chain: 'flow-testnet' };
      break;
    }
    case 'get_flow_wallet_readiness': {
      const address = params.address || params.wallet_address || params.walletAddress || contextualAddress;
      mapped = { address, chain: 'flow-testnet' };
      if (!address) missing.push('address');
      break;
    }
    case 'transfer': {
      const privateKey = contextualPrivateKey;
      const toAddress =
        params.toAddress ||
        params.to_address ||
        params.address ||
        params.recipient ||
        params.recipientAddress ||
        extractAddressFromText(fallbackMessage);
      const amount = params.amount || params.value || extractAmountFromText(fallbackMessage);
      const tokenId = params.tokenId || params.token_id;
      const tokenAddress = params.tokenAddress || params.token_address;
      const fromAddress =
        params.fromAddress ||
        params.from_address ||
        params.wallet_address ||
        executionContext.walletAddress ||
        executionContext.wallet_address ||
        null;
      mapped = { privateKey, fromAddress, toAddress, amount, chain };
      if (tokenId !== undefined) mapped.tokenId = tokenId;
      if (tokenAddress !== undefined) mapped.tokenAddress = tokenAddress;
      // If wallet is available but private key is not, we can still prepare the transfer
      // for client/Lit signing via /transfer/prepare.
      if (!privateKey && !fromAddress) missing.push('privateKey');
      if (!toAddress) missing.push('toAddress');
      if (!amount) missing.push('amount');
      break;
    }
    case 'deploy_erc20': {
      const privateKey = contextualPrivateKey;
      const name = params.name;
      const symbol = params.symbol;
      const initialSupply = params.initialSupply || params.initial_supply;
      const decimals = params.decimals;
      mapped = { privateKey, name, symbol, initialSupply, chain };
      if (decimals !== undefined) mapped.decimals = decimals;
      if (!privateKey) missing.push('privateKey');
      if (!name) missing.push('name');
      if (!symbol) missing.push('symbol');
      if (!initialSupply) missing.push('initialSupply');
      break;
    }
    case 'deploy_erc721': {
      const privateKey = contextualPrivateKey;
      const name = params.name;
      const symbol = params.symbol;
      const baseURI = params.baseURI || params.base_uri;
      mapped = { privateKey, name, symbol, baseURI, chain };
      if (!privateKey) missing.push('privateKey');
      if (!name) missing.push('name');
      if (!symbol) missing.push('symbol');
      if (!baseURI) missing.push('baseURI');
      break;
    }
    case 'mint_nft': {
      const privateKey = contextualPrivateKey;
      const collectionAddress = params.collectionAddress || params.contract_address;
      const toAddress = params.toAddress || params.to_address;
      mapped = { privateKey, collectionAddress, toAddress, chain };
      if (!privateKey) missing.push('privateKey');
      if (!collectionAddress) missing.push('collectionAddress');
      if (!toAddress) missing.push('toAddress'); 
      break;
    }
    case 'get_token_info': {
      const tokenId = params.tokenId || params.token_address;
      mapped = { tokenId, chain };
      if (!tokenId) missing.push('tokenId');
      break;
    }
    case 'get_token_balance': {
      const tokenId = params.tokenId || params.token_address;
      const ownerAddress = params.ownerAddress || params.wallet_address || contextualAddress;
      mapped = { tokenId, ownerAddress, chain };
      if (!tokenId) missing.push('tokenId');
      if (!ownerAddress) missing.push('ownerAddress');
      break;
    }
    case 'get_nft_info': {
      const collectionAddress = params.collectionAddress || params.contract_address;
      const tokenId = params.tokenId || params.token_id;
      mapped = { collectionAddress, tokenId, chain };
      if (!collectionAddress) missing.push('collectionAddress');
      if (!tokenId) missing.push('tokenId');
      break;
    }
    case 'send_email': {
      const explicitRecipient = params.to || params.email || params.recipient;
      const to =
        selectRecipientEmail({
          explicitRecipient,
          defaultEmailTo: executionContext.defaultEmailTo,
          userEmail: executionContext.userEmail,
          fallbackEmail: extractEmailFromText(fallbackMessage)
        });
      const subject =
        params.subject ||
        params.title ||
        params.emailSubject ||
        generateDefaultEmailSubject(fallbackMessage);
      const text =
        params.text ||
        params.body ||
        params.message ||
        params.content ||
        generateDefaultEmailText(fallbackMessage);
      const html = params.html;
      const cc = params.cc;
      const bcc = params.bcc;
      const replyTo = params.replyTo;
      mapped = { to, subject, text, html, cc, bcc, replyTo };
      if (!to) missing.push('to');
      if (!subject) missing.push('subject');
      if (!text && !html) missing.push('text');
      break;
    }
    case 'calculate': {
      const expression = params.expression;
      const variables = params.variables || params.values;
      const description = params.description;
      mapped = { expression, variables, description };
      if (!expression) missing.push('expression');
      break;
    }
    case 'batch_transfer': {
      const privateKey = contextualPrivateKey;
      const recipients = params.recipients;
      mapped = { privateKey, recipients, chain };
      if (!privateKey) missing.push('privateKey');
      if (!recipients || !Array.isArray(recipients) || recipients.length === 0) missing.push('recipients');
      break;
    }
    case 'batch_mint': {
      const privateKey = contextualPrivateKey;
      const collectionAddress = params.collectionAddress || params.collection_address || params.contract_address;
      const recipients = params.recipients;
      mapped = { privateKey, collectionAddress, recipients, chain };
      if (!privateKey) missing.push('privateKey');
      if (!collectionAddress) missing.push('collectionAddress');
      if (!recipients || !Array.isArray(recipients) || recipients.length === 0) missing.push('recipients');
      break;
    }
    case 'tx_status': {
      const hash = params.hash || params.txHash || params.tx_hash;
      mapped = { hash, chain };
      if (!hash) missing.push('hash');
      break;
    }
    case 'wallet_history': {
      const address = params.address || params.wallet_address || contextualAddress;
      const page = params.page;
      const limit = params.limit;
      mapped = { address, page, limit, chain };
      if (!address) missing.push('address');
      break;
    }
    case 'lookup_transaction': {
      const txHash = params.txHash || params.tx_hash || params.hash;
      mapped = { txHash, chain };
      if (!txHash) missing.push('txHash');
      break;
    }
    case 'fetch_events': {
      const contractAddress = params.contractAddress || params.contract_address || params.address;
      const eventSignature = params.eventSignature || params.event_signature || params.event;
      const fromBlock = params.fromBlock || params.from_block;
      const toBlock = params.toBlock || params.to_block;
      const limit = params.limit;
      mapped = { contractAddress, eventSignature, fromBlock, toBlock, limit, chain };
      if (!contractAddress) missing.push('contractAddress');
      break;
    }
    case 'lookup_block': {
      const blockNumber = params.blockNumber || params.block_number || params.number || 'latest';
      mapped = { blockNumber, chain };
      break;
    }
    case 'decode_revert': {
      const txHash = params.txHash || params.tx_hash || params.hash;
      const data = params.data || params.revertData || params.revert_data;
      mapped = { txHash, data, chain };
      if (!txHash && !data) missing.push('txHash or data');
      break;
    }
    case 'get_portfolio': {
      const address = params.address || params.wallet_address || contextualAddress;
      mapped = { address, chain };
      if (!address) missing.push('address');
      break;
    }
    case 'resolve_ens': {
      const name = params.name || params.ens_name;
      mapped = { name, chain };
      if (!name) missing.push('name');
      break;
    }
    case 'reverse_ens': {
      const address = params.address || params.wallet_address || contextualAddress;
      mapped = { address, chain };
      if (!address) missing.push('address');
      break;
    }
    case 'estimate_gas': {
      mapped = { chain }; // no params needed
      break;
    }
    case 'simulate_gas': {
      const to = params.to;
      const from = params.from;
      const data = params.data;
      const value = params.value;
      const abi = params.abi;
      const functionName = params.functionName || params.function_name;
      const args = params.args;
      mapped = { to, from, data, value, abi, functionName, args, chain };
      if (!to) missing.push('to');
      break;
    }
    case 'swap_tokens': {
      const privateKey       = contextualPrivateKey;
      const tokenIn          = params.tokenIn  || params.token_in  || params.from_token;
      const tokenOut         = params.tokenOut || params.token_out || params.to_token;
      const amountIn         = params.amountIn || params.amount_in || params.amount;
      const slippageTolerance = params.slippageTolerance || params.slippage || params.slippage_tolerance;
      const fee              = params.fee;
      mapped = { privateKey, tokenIn, tokenOut, amountIn, chain };
      if (slippageTolerance !== undefined) mapped.slippageTolerance = slippageTolerance;
      if (fee !== undefined) mapped.fee = fee;
      if (!privateKey)  missing.push('privateKey');
      if (!tokenIn)     missing.push('tokenIn');
      if (!tokenOut)    missing.push('tokenOut');
      if (!amountIn)    missing.push('amountIn');
      break;
    }
    case 'get_swap_quote': {
      const tokenIn  = params.tokenIn  || params.token_in  || params.from_token;
      const tokenOut = params.tokenOut || params.token_out || params.to_token;
      const amountIn = params.amountIn || params.amount_in || params.amount;
      const fee      = params.fee;
      mapped = { tokenIn, tokenOut, amountIn, chain };
      if (fee !== undefined) mapped.fee = fee;
      if (!tokenIn)  missing.push('tokenIn');
      if (!tokenOut) missing.push('tokenOut');
      if (!amountIn) missing.push('amountIn');
      break;
    }
    case 'bridge_deposit': {
      const privateKey         = contextualPrivateKey;
      const amount             = params.amount;
      const tokenAddress       = params.tokenAddress || params.token_address || params.token;
      const destinationAddress = params.destinationAddress || params.destination || params.to;
      mapped = { privateKey, amount, chain };
      if (tokenAddress)       mapped.tokenAddress       = tokenAddress;
      if (destinationAddress) mapped.destinationAddress = destinationAddress;
      if (!privateKey) missing.push('privateKey');
      if (!amount)     missing.push('amount');
      break;
    }
    case 'bridge_withdraw': {
      const privateKey         = contextualPrivateKey;
      const amount             = params.amount;
      const tokenAddress       = params.tokenAddress || params.token_address || params.token;
      const destinationAddress = params.destinationAddress || params.destination || params.to;
      mapped = { privateKey, amount, chain };
      if (tokenAddress)       mapped.tokenAddress       = tokenAddress;
      if (destinationAddress) mapped.destinationAddress = destinationAddress;
      if (!privateKey) missing.push('privateKey');
      if (!amount)     missing.push('amount');
      break;
    }
    case 'bridge_status': {
      const txHash = params.txHash || params.tx_hash || params.hash;
      mapped = { txHash, chain };
      if (!txHash) missing.push('txHash');
      break;
    }
    case 'schedule_transfer':
    case 'create_savings_plan':
    case 'schedule_payout':
    case 'create_payroll_plan':
    case 'create_grant_payout': {
      const privateKey      = contextualPrivateKey;
      const toAddress       = params.toAddress  || params.to_address || params.to;
      const amount          = params.amount;
      const cronExpression  = params.cronExpression || params.cron || params.cron_expression || params.schedule;
      const tokenAddress    = params.tokenAddress || params.token_address || params.token;
      const label           = params.label;
      const agentId         = params.agentId || executionContext.agentId || null;
      const userId          = params.userId || executionContext.userId || null;
      mapped = { privateKey, toAddress, amount, cronExpression, agentId, userId, chain };
      if (tokenAddress) mapped.tokenAddress = tokenAddress;
      if (label)        mapped.label        = label;
      if (tool === 'create_savings_plan' && !mapped.label) {
        mapped.label = 'Flow savings plan';
      }
      if (tool === 'schedule_payout' && !mapped.label) {
        mapped.label = 'Flow scheduled payout';
      }
      if (tool === 'create_payroll_plan' && !mapped.label) {
        mapped.label = 'Flow payroll plan';
      }
      if (tool === 'create_grant_payout' && !mapped.label) {
        mapped.label = 'Flow grant payout';
      }
      if (!privateKey)     missing.push('privateKey');
      if (!toAddress)      missing.push('toAddress');
      if (!amount)         missing.push('amount');
      if (!cronExpression) missing.push('cronExpression');
      break;
    }
    case 'schedule_reminder': {
      const taskType = params.taskType || params.task_type;
      const walletAddress = params.walletAddress || params.wallet_address || params.address || contextualAddress;
      const tokenQuery = params.tokenQuery || params.token_query || params.query || params.token;
      const cronExpression = params.cronExpression || params.cron_expression || params.schedule || params.cron;
      const label = params.label;
      const conversationId = params.conversationId || executionContext.conversationId || null;
      const userId = params.userId || executionContext.userId || null;
      const agentId = params.agentId || executionContext.agentId || null;
      const deliveryPlatform = params.deliveryPlatform || executionContext.deliveryPlatform || 'web';
      const telegramChatId = params.telegramChatId || executionContext.telegramChatId || null;
      const originalMessage = params.originalMessage || fallbackMessage;

      mapped = {
        taskType,
        cronExpression,
        label,
        chain,
        walletAddress,
        tokenQuery,
        conversationId,
        userId,
        agentId,
        deliveryPlatform,
        telegramChatId,
        originalMessage
      };

      if (!taskType) missing.push('taskType');
      if (!cronExpression) missing.push('cronExpression');
      if (!userId) missing.push('userId');
      if ((taskType === 'balance' || taskType === 'portfolio') && !walletAddress) missing.push('walletAddress');
      if (taskType === 'price' && !tokenQuery) missing.push('tokenQuery');
      if (deliveryPlatform === 'web' && !conversationId) missing.push('conversationId');
      if (deliveryPlatform === 'telegram' && !telegramChatId) missing.push('telegramChatId');
      break;
    }
    case 'list_reminders': {
      const userId = params.userId || executionContext.userId || null;
      const agentId = params.agentId || executionContext.agentId || null;
      mapped = { userId, agentId, chain };
      if (!userId && !agentId) missing.push('userId');
      break;
    }
    case 'cancel_reminder': {
      const id = params.id || params.reminderId || params.jobId || params.job_id;
      const ids = normalizeReminderIdList(params.ids || params.reminderIds || params.jobIds || params.job_ids);
      const userId = params.userId || executionContext.userId || null;
      const agentId = params.agentId || executionContext.agentId || null;
      const conversationId = params.conversationId || executionContext.conversationId || null;
      const taskType = params.taskType || params.task_type || extractReminderTaskTypeFromText(fallbackMessage);
      const walletAddress = params.walletAddress || params.wallet_address || params.address || contextualAddress || null;
      const mode = params.mode || (wantsBulkReminderCancellation(fallbackMessage) ? 'all' : 'latest');

      mapped = {
        id,
        ids,
        userId,
        agentId,
        conversationId,
        taskType,
        walletAddress,
        mode,
        chain
      };

      const hasAnyId = Boolean(id) || ids.length > 0;
      const hasFilterContext = Boolean(userId || agentId || conversationId || taskType || walletAddress);
      if (!hasAnyId && !hasFilterContext) missing.push('id');
      break;
    }
    case 'list_schedules': {
      const userId = params.userId || executionContext.userId || null;
      const agentId = params.agentId || executionContext.agentId || null;
      mapped = { userId, agentId, chain };
      if (!userId && !agentId) missing.push('userId');
      break;
    }
    case 'cancel_schedule': {
      const id = params.id || params.jobId || params.job_id;
      const userId = params.userId || executionContext.userId || null;
      const agentId = params.agentId || executionContext.agentId || null;
      mapped = { id, userId, agentId, chain };
      if (!id) missing.push('id');
      if (!userId && !agentId) missing.push('userId');
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
    '{tokenId}': 'tokenId',
    '{ownerAddress}': 'ownerAddress',
    '{collectionAddress}': 'collectionAddress',
    '{txHash}': 'txHash',
    '{hash}': 'hash',
    '{blockNumber}': 'blockNumber',
    '{name}': 'name',
    '{id}': 'id'
  };

  Object.entries(replacements).forEach(([placeholder, key]) => {
    if (result.includes(placeholder) && params[key]) {
      result = result.replace(placeholder, encodeURIComponent(params[key]));
    }
  });

  return result;
}

function safeCalculate(params) {
  try {
    const expression = params.expression || '';
    let variables = params.variables || {};

    // Ensure variables is an object (AI may send string)
    if (typeof variables === 'string') {
      try { variables = JSON.parse(variables); } catch { variables = {}; }
    }
    if (typeof variables !== 'object' || variables === null) variables = {};

    // Normalize whitespace in expression
    let resolved = expression.replace(/\s+/g, ' ').trim();
    
    // Build alias map so common variable name variants all resolve
    const aliasMap = {};
    for (const [varName, val] of Object.entries(variables)) {
      const vn = varName.toLowerCase();
      if (vn.includes('price')) {
        if (vn.includes('eth') || vn.includes('ethereum')) {
          for (const alias of ['eth_price', 'ethereum_price', 'eth_price_usd', 'price_eth']) aliasMap[alias] = val;
        } else if (vn.includes('btc') || vn.includes('bitcoin')) {
          for (const alias of ['btc_price', 'bitcoin_price', 'btc_price_usd', 'price_btc']) aliasMap[alias] = val;
        } else if (vn.includes('sol') || vn.includes('solana')) {
          for (const alias of ['sol_price', 'solana_price', 'sol_price_usd', 'price_sol']) aliasMap[alias] = val;
        } else if (vn.includes('arb') || vn.includes('arbitrum')) {
          for (const alias of ['arb_price', 'arbitrum_price', 'arb_price_usd', 'token_price', 'token_price_usd', 'price_arb']) aliasMap[alias] = val;
        } else if (vn.includes('token')) {
          for (const alias of ['token_price', 'token_price_usd', 'arb_price', 'sol_price', 'btc_price', 'target_price']) {
            if (!(alias in variables)) aliasMap[alias] = val;
          }
        }
      }
      if (vn.includes('balance')) {
        for (const alias of ['eth_balance', 'balance', 'wallet_balance', 'my_balance']) aliasMap[alias] = val;
      }
    }
    
    // Merge: explicit variables override aliases
    const mergedVars = { ...aliasMap, ...variables };

    // --- FALLBACK: extract balance from description when not in variables ---
    // The AI often mentions the balance in the description/context but forgets to include it in variables.
    if (!('eth_balance' in mergedVars) && !('balance' in mergedVars)) {
      const contextText = params.description || '';
      const balancePatterns = [
        /(\d+\.?\d*)\s*ETH/i,            // "0.1 ETH"
        /balance[:\s]+([\d.]+)/i,          // "balance: 0.1"
        /([\d.]+)\s*ether/i,               // "0.1 ether"
        /with\s+([\d.]+)\s*(?:ETH|eth)/i, // "with 0.1 ETH"
      ];
      for (const pattern of balancePatterns) {
        const m = contextText.match(pattern);
        if (m) {
          const extracted = parseFloat(m[1]);
          if (!isNaN(extracted)) {
            mergedVars.eth_balance = extracted;
            mergedVars.balance = extracted;
            mergedVars.wallet_balance = extracted;
            mergedVars.my_balance = extracted;
            console.log(`[Calculate] Auto-extracted balance ${extracted} ETH from description`);
            break;
          }
        }
      }
    }
    
    // Sort variable names by length (longest first) to avoid partial matches
    const sortedVars = Object.entries(mergedVars).sort((a, b) => b[0].length - a[0].length);
    
    sortedVars.forEach(([name, value]) => {
      // Convert value to number, stripping commas
      const numValue = parseFloat(String(value).replace(/,/g, ''));
      if (isNaN(numValue)) {
        throw new Error(`Variable '${name}' has non-numeric value: ${value}`);
      }
      const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      resolved = resolved.replace(pattern, String(numValue));
    });

    // Normalize whitespace again after substitution  
    resolved = resolved.replace(/\s+/g, ' ').trim();

    const allowedChars = /^[0-9+\-*/().eE\s]+$/;
    if (!allowedChars.test(resolved)) {
      const badChars = resolved.split('').filter(c => !/[0-9+\-*/().eE\s]/.test(c));
      return {
        success: false,
        tool: 'calculate',
        error: `Invalid characters in expression: [${badChars.join(', ')}]. Resolved: '${resolved}'. Only numbers and basic operators are allowed.`
      };
    }

    const result = Function(`"use strict"; return (${resolved});`)();
    return {
      success: true,
      tool: 'calculate',
      result: {
        original_expression: expression,
        variables: variables,
        resolved_expression: resolved,
        result: result,
        description: params.description || 'Calculation'
      }
    };
  } catch (error) {
    return {
      success: false,
      tool: 'calculate',
      error: `Calculation error: ${error.message}`
    };
  }
}

async function invokeLocalController(handler, req) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    let settled = false;

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        if (settled) {
          return payload;
        }

        settled = true;

        if (statusCode >= 400 || payload?.success === false) {
          const error = new Error(payload?.error || payload?.message || 'Request failed');
          error.status = statusCode;
          error.payload = payload;
          reject(error);
          return payload;
        }

        resolve(payload);
        return payload;
      }
    };

    Promise.resolve(handler(req, res)).catch((error) => {
      if (!settled) {
        reject(error);
      }
    });
  });
}

async function executeReminderToolLocally(tool, mapped) {
  const {
    createReminder,
    listReminders,
    cancelReminder
  } = require('../controllers/reminderController');

  if (tool === 'schedule_reminder') {
    return invokeLocalController(createReminder, {
      body: { ...mapped },
      query: {},
      params: {},
      apiKey: null
    });
  }

  if (tool === 'list_reminders') {
    return invokeLocalController(listReminders, {
      body: {},
      query: { ...mapped },
      params: {},
      apiKey: null
    });
  }

  if (tool === 'cancel_reminder') {
    return invokeLocalController(cancelReminder, {
      body: { ...mapped },
      query: {
        userId: mapped.userId || undefined,
        agentId: mapped.agentId || undefined,
        conversationId: mapped.conversationId || undefined,
        taskType: mapped.taskType || undefined,
        walletAddress: mapped.walletAddress || undefined,
        mode: mapped.mode || undefined
      },
      params: { id: mapped.id },
      apiKey: mapped.agentId ? { agentId: mapped.agentId } : null
    });
  }

  throw new Error(`Unsupported local reminder tool: ${tool}`);
}

async function executeFlowToolLocally(tool, mapped) {
  if (tool === 'get_flow_network_overview') {
    return buildFlowNetworkOverviewPayload();
  }

  if (tool === 'get_flow_wallet_readiness') {
    const address = mapped.address || mapped.wallet_address || mapped.walletAddress;
    const provider = getProvider('flow-testnet');
    const balanceWei = await provider.getBalance(address);
    const balance = ethers.formatEther(balanceWei);
    const funded = balanceWei > 0n;
    const overview = buildFlowNetworkOverviewPayload();

    return {
      success: true,
      address,
      balance,
      balanceWei: balanceWei.toString(),
      readiness: funded ? 'ready' : 'needs_funding',
      funded,
      chain: 'flow-testnet',
      chainId: overview.chainId,
      network: overview.network,
      nativeCurrency: overview.nativeCurrency,
      faucetUrl: overview.faucetUrl,
      explorerBaseUrl: overview.explorerBaseUrl,
      explorerUrl: getAddressExplorerUrl(address, 'flow-testnet'),
      sponsoredRpcEnabled: overview.sponsoredRpcEnabled,
      nextAction: funded
        ? 'Wallet is funded and ready for Flow automation tools.'
        : 'Wallet has no FLOW yet. Fund it from the Flow testnet faucet before running transfers or schedules.',
      recommendedTools: funded
        ? ['create_savings_plan', 'schedule_payout', 'create_payroll_plan', 'create_grant_payout']
        : ['get_flow_network_overview']
    };
  }

  throw new Error(`Unsupported local Flow tool: ${tool}`);
}

async function executeToolStep(step, fallbackMessage, executionContext = {}) {
  const { tool, parameters } = step;
  const mapping = mapToolParams(tool, parameters, fallbackMessage, executionContext);
  const selectedChain = mapping.mapped.chain || normalizeChainId(executionContext.chain || DEFAULT_CHAIN);
  const headers = {};
  if (executionContext.apiKey) {
    headers['x-api-key'] = executionContext.apiKey;
  }

  const isSignerTool = new Set([
    'transfer',
    'deploy_erc20',
    'deploy_erc721',
    'mint_nft',
    'batch_transfer',
    'batch_mint',
    'swap_tokens',
    'bridge_deposit',
    'bridge_withdraw',
    'schedule_transfer',
    'create_savings_plan',
    'schedule_payout',
    'create_payroll_plan',
    'create_grant_payout'
  ]).has(tool);

  // For transfer, support wallet-address-based prepare flow (Lit/MetaMask signing).
  const canPrepareTransfer =
    tool === 'transfer' &&
    !mapping.mapped.privateKey &&
    mapping.mapped.fromAddress &&
    mapping.mapped.toAddress &&
    mapping.mapped.amount;
  const canSignTransferWithPkp =
    canPrepareTransfer &&
    executionContext.walletType === 'pkp' &&
    !!executionContext.pkpPublicKey;
  const isReminderTool = new Set([
    'schedule_reminder',
    'list_reminders',
    'cancel_reminder'
  ]).has(tool);
  const isFlowLocalTool = new Set([
    'get_flow_network_overview',
    'get_flow_wallet_readiness'
  ]).has(tool);

  if (!isToolSupportedOnChain(tool, selectedChain)) {
    return {
      tool_call: { tool, parameters: mapping.mapped },
      result: {
        success: false,
        tool,
        error: buildUnsupportedToolError(tool, selectedChain)
      }
    };
  }

  if (mapping.missing.length > 0) {
    const missingPrivateKeyOnly =
      mapping.missing.length === 1 &&
      mapping.missing[0] === 'privateKey';

    if (isSignerTool && missingPrivateKeyOnly && !canPrepareTransfer) {
      return {
        tool_call: { tool, parameters: mapping.mapped },
        result: {
          success: false,
          tool,
          error: `This action requires a signer. Provide privateKey, or use a tool/flow that supports prepared transactions for wallet signing.`
        }
      };
    }

    return {
      tool_call: { tool, parameters: mapping.mapped },
      result: {
        success: false,
        tool,
        error: `Missing required parameters: ${mapping.missing.join(', ')}`
      }
    };
  }

  if (isReminderTool) {
    try {
      const payload = await executeReminderToolLocally(tool, mapping.mapped);
      return {
        tool_call: { tool, parameters: mapping.mapped },
        result: { success: true, tool, result: payload }
      };
    } catch (error) {
      return {
        tool_call: { tool, parameters: mapping.mapped },
        result: {
          success: false,
          tool,
          error: error.status ? `HTTP ${error.status}: ${error.message}` : error.message
        }
      };
    }
  }

  if (isFlowLocalTool) {
    try {
      const payload = await executeFlowToolLocally(tool, mapping.mapped);
      return {
        tool_call: { tool, parameters: mapping.mapped },
        result: { success: true, tool, result: payload }
      };
    } catch (error) {
      return {
        tool_call: { tool, parameters: mapping.mapped },
        result: {
          success: false,
          tool,
          error: error.status ? `HTTP ${error.status}: ${error.message}` : error.message
        }
      };
    }
  }

  const config = TOOL_ENDPOINTS[tool];
  if (!config) {
    return {
      tool_call: { tool, parameters: mapping.mapped },
      result: { success: false, tool, error: 'Tool not supported for direct execution' }
    };
  }

  if (canPrepareTransfer) {
    try {
      const preparePayload = {
        fromAddress: mapping.mapped.fromAddress,
        toAddress: mapping.mapped.toAddress,
        amount: mapping.mapped.amount,
        chain: selectedChain
      };
      if (mapping.mapped.tokenId !== undefined) {
        preparePayload.tokenId = mapping.mapped.tokenId;
      }
      if (mapping.mapped.tokenAddress !== undefined) {
        preparePayload.tokenAddress = mapping.mapped.tokenAddress;
      }

      const prepareResponse = await axios.post(`${BASE_URL}/transfer/prepare`, preparePayload, {
        headers: Object.keys(headers).length ? headers : undefined,
        timeout: 30000
      });

      const prepared = prepareResponse.data || {};

      if (canSignTransferWithPkp) {
        const signedTransaction = await signAndBroadcastTransactionWithPkp({
          pkpPublicKey: executionContext.pkpPublicKey,
          chain: selectedChain,
          transaction: {
            to: prepared.transaction?.to || mapping.mapped.toAddress,
            data: prepared.transaction?.data || null,
            value: prepared.transaction?.value || null
          }
        });

        return {
          tool_call: { tool, parameters: mapping.mapped },
          result: {
            success: true,
            tool,
            result: {
              type: prepared.type || (mapping.mapped.tokenId !== undefined ? 'erc20' : 'native'),
              transactionHash: signedTransaction.hash,
              txHash: signedTransaction.hash,
              from: mapping.mapped.fromAddress,
              to: mapping.mapped.toAddress,
              amount: mapping.mapped.amount,
              tokenId: mapping.mapped.tokenId,
              blockNumber: signedTransaction.blockNumber,
              gasUsed: signedTransaction.gasUsed,
              status: signedTransaction.status,
              explorerUrl: signedTransaction.explorerUrl,
              chain: selectedChain,
              walletType: 'pkp',
              signer: 'lit-pkp'
            }
          }
        };
      }

      return {
        tool_call: { tool, parameters: mapping.mapped },
        result: {
          success: true,
          tool,
          result: {
            ...prepared,
            prepared: true,
            requiresSigning: true
          }
        }
      };
    } catch (error) {
      const statusCode = error.response?.status;
      const backendError = error.response?.data?.error || error.response?.data?.message || error.response?.data?.details;
      const detail = backendError || error.message;
      return {
        tool_call: { tool, parameters: mapping.mapped },
        result: { success: false, tool, error: statusCode ? `HTTP ${statusCode}: ${detail}` : detail }
      };
    }
  }

  if (config.method === 'LOCAL' && tool === 'calculate') {
    return {
      tool_call: { tool, parameters: mapping.mapped },
      result: safeCalculate(mapping.mapped)
    };
  }

  const url = `${BASE_URL}${replacePathParams(config.path, mapping.mapped)}`;
  const requestParams = { ...mapping.mapped };

  Object.keys(requestParams).forEach(key => {
    if (config.path.includes(`{${key}}`)) {
      delete requestParams[key];
    }
  });

  try {
    let response;
    if (config.method === 'POST') {
      response = await axios.post(url, requestParams, {
        headers: Object.keys(headers).length ? headers : undefined,
        timeout: 30000
      });
    } else if (config.method === 'GET') {
      // Pass any remaining (non-path) params as query string
      const hasQueryParams = Object.keys(requestParams).length > 0;
      response = await axios.get(url, {
        headers: Object.keys(headers).length ? headers : undefined,
        params: hasQueryParams ? requestParams : undefined,
        timeout: 30000
      });
    } else if (config.method === 'DELETE') {
      const hasQueryParams = Object.keys(requestParams).length > 0;
      response = await axios.delete(url, {
        headers: Object.keys(headers).length ? headers : undefined,
        params: hasQueryParams ? requestParams : undefined,
        timeout: 30000
      });
    } else {
      throw new Error(`Unsupported method: ${config.method}`);
    }

    return {
      tool_call: { tool, parameters: mapping.mapped },
      result: { success: true, tool, result: response.data }
    };
  } catch (error) {
    const statusCode = error.response?.status;
    const backendError = error.response?.data?.error || error.response?.data?.message || error.response?.data?.details;
    const detail = backendError || error.message;
    return {
      tool_call: { tool, parameters: mapping.mapped },
      result: { success: false, tool, error: statusCode ? `HTTP ${statusCode}: ${detail}` : detail }
    };
  }
}

function interpolateParameters(params, previousResults) {
  if (!params) {
    return params;
  }

  const interpolated = { ...params };

  if (!previousResults || previousResults.length === 0) {
    return interpolated;
  }
  
  // Collect all successful results
  const resultsByTool = {};
  for (const result of previousResults) {
    if (result?.success && result?.result) {
      resultsByTool[result.tool] = result.result;
    }
  }
  const latestResult = getLatestSuccessfulResult(previousResults);

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

  // Helper to extract numeric price from fetch_price result
  const extractPrice = (result) => {
    if (result.prices && Array.isArray(result.prices) && result.prices.length > 0) {
      return result.prices[0].price;
    }
    return null;
  };

  // Helper to extract balance
  const extractBalance = (result) => {
    if (result.balance) return parseFloat(result.balance);
    if (result.balanceInEth) return parseFloat(result.balanceInEth);
    return null;
  };

  // Helper to format price data for display
  const formatPriceData = (result) => {
    if (result.prices && Array.isArray(result.prices) && result.prices.length > 0) {
      const price = result.prices[0];
      const currency = (price.currency || 'USD').toUpperCase();
      const value = typeof price.price === 'number' ? price.price.toFixed(2) : price.price;
      const change = price.change_24h !== undefined && price.change_24h !== null
        ? ` (24h change: ${price.change_24h > 0 ? '+' : ''}${price.change_24h.toFixed(2)}%)`
        : '';
      return `${value} ${currency}${change}`;
    }
    return null;
  };

  // Auto-populate calculate tool variables from previous results
  // Always merge — even if params.variables exists, fill in gaps from tool results
  if (params.expression) {
    const autoVariables = {};
    
    // Extract prices from all fetch_price results
    const priceResults = previousResults.filter(r => r?.success && r?.tool === 'fetch_price');
    for (const pr of priceResults) {
      const price = extractPrice(pr.result);
      if (price !== null) {
        const coin = pr.result.prices?.[0]?.coin?.toLowerCase() || '';
        if (coin.includes('ethereum') || coin.includes('eth')) {
          autoVariables.eth_price = price;
          autoVariables.eth_price_usd = price;
        } else {
          autoVariables.token_price = price;
          autoVariables.token_price_usd = price;
          autoVariables[`${coin}_price`] = price;
        }
      }
    }
    
    // Extract balance from get_balance results
    const balanceResults = previousResults.filter(r => r?.success && r?.tool === 'get_balance');
    for (const br of balanceResults) {
      const balance = extractBalance(br.result);
      if (balance !== null) {
        autoVariables.eth_balance = balance;
        autoVariables.balance = balance;
      }
    }
    
    if (Object.keys(autoVariables).length > 0) {
      // Merge: explicit params.variables override auto-populated ones
      interpolated.variables = { ...autoVariables, ...(params.variables || {}) };
    }
  }

  // Replace placeholders in string parameters
  Object.keys(interpolated).forEach(key => {
    if (typeof interpolated[key] === 'string') {
      let value = interpolated[key];
      value = applyTemplateInterpolation(value);
      
      // Replace price-related placeholders
      for (const result of previousResults) {
        if (!result?.success) continue;
        
        if (result.tool === 'fetch_price') {
          const priceData = formatPriceData(result.result);
          if (priceData) {
            value = value.replace(/\[Price (?:will be inserted )?from fetch_price result\]/gi, priceData);
            value = value.replace(/\[Price from [\w_]+ result\]/gi, priceData);
            value = value.replace(/\[Current Price\]/gi, priceData);
            value = value.replace(/\{price\}/gi, priceData);
          }
        }
        
        if (result.tool === 'get_balance' && result.result?.balance) {
          value = value.replace(/\[Balance from get_balance result\]/gi, result.result.balance);
          value = value.replace(/\{balance\}/gi, result.result.balance);
        }
      }
      
      interpolated[key] = value;
    }
  });

  return interpolated;
}

function interpolateStepParameters(step, previousResults, fallbackMessage = '', executionContext = {}) {
  const tool = step?.tool;
  const interpolated = interpolateParameters(step?.parameters || {}, previousResults);

  if (tool === 'tx_status' && !interpolated.hash && !interpolated.txHash && !interpolated.tx_hash) {
    const latestTransfer = [...previousResults].reverse().find(r => r?.tool === 'transfer' && r?.success);
    const transferHash = latestTransfer?.result?.transactionHash || latestTransfer?.result?.txHash;
    if (transferHash) {
      interpolated.hash = transferHash;
    }
  }

  if (tool === 'lookup_transaction') {
    if (interpolated.txHash && isLikelyPlaceholderValue(interpolated.txHash)) {
      delete interpolated.txHash;
    }
    if (!interpolated.txHash && !interpolated.hash && !interpolated.tx_hash) {
      const latestTransfer = [...previousResults].reverse().find(r => r?.tool === 'transfer' && r?.success);
      const transferHash = latestTransfer?.result?.transactionHash || latestTransfer?.result?.txHash || latestTransfer?.result?.hash;
      if (transferHash) {
        interpolated.txHash = transferHash;
      }
    }
  }

  if (tool === 'cancel_reminder') {
    if (!interpolated.userId && executionContext.userId) {
      interpolated.userId = executionContext.userId;
    }
    if (!interpolated.agentId && executionContext.agentId) {
      interpolated.agentId = executionContext.agentId;
    }
    if (!interpolated.conversationId && executionContext.conversationId) {
      interpolated.conversationId = executionContext.conversationId;
    }
    if (!interpolated.taskType) {
      const inferredTaskType = extractReminderTaskTypeFromText(fallbackMessage);
      if (inferredTaskType) {
        interpolated.taskType = inferredTaskType;
      }
    }
    if (!interpolated.walletAddress) {
      const inferredAddress = extractAddressFromText(fallbackMessage);
      if (inferredAddress) {
        interpolated.walletAddress = inferredAddress;
      }
    }

    const explicitIds = normalizeReminderIdList(interpolated.ids);
    const hasExplicitTarget = Boolean(interpolated.id) || explicitIds.length > 0;

    if (!hasExplicitTarget) {
      const inferredTargets = inferReminderCancelTargets(previousResults, fallbackMessage, interpolated);
      if (inferredTargets?.id && !interpolated.id) {
        interpolated.id = inferredTargets.id;
      }
      if (!interpolated.ids && Array.isArray(inferredTargets?.ids) && inferredTargets.ids.length > 0) {
        interpolated.ids = inferredTargets.ids;
      }
      if (!interpolated.mode && inferredTargets?.mode) {
        interpolated.mode = inferredTargets.mode;
      }
      if (!interpolated.taskType && inferredTargets?.taskType) {
        interpolated.taskType = inferredTargets.taskType;
      }
      if (!interpolated.walletAddress && inferredTargets?.walletAddress) {
        interpolated.walletAddress = inferredTargets.walletAddress;
      }
    }
  }

  if (tool === 'send_email') {
    const generated = generateEmailFromPreviousResults(previousResults, fallbackMessage);

    interpolated.to = selectRecipientEmail({
      explicitRecipient: interpolated.to,
      defaultEmailTo: executionContext.defaultEmailTo,
      userEmail: executionContext.userEmail,
      fallbackEmail: extractEmailFromText(fallbackMessage)
    });

    const hasUnresolvedTemplateInText =
      typeof interpolated.text === 'string' &&
      isLikelyPlaceholderValue(interpolated.text);

    if (!interpolated.subject) {
      interpolated.subject = generated.subject;
    }

    if ((!interpolated.text && !interpolated.html) || hasUnresolvedTemplateInText) {
      interpolated.text = generated.text;
    }
  }

  return interpolated;
}

async function executeToolsDirectly(routingPlan, fallbackMessage, executionContext = {}) {
  if (!routingPlan?.execution_plan?.steps?.length) {
    return { tool_calls: [], results: [] };
  }

  const { steps, type } = routingPlan.execution_plan;

  if (type === 'parallel') {
    const results = await Promise.all(steps.map(step => executeToolStep(step, fallbackMessage, executionContext)));
    return {
      tool_calls: results.map(item => item.tool_call),
      results: results.map(item => item.result)
    };
  }

  const toolCalls = [];
  const toolResults = [];
  for (const step of steps) {
    // Interpolate parameters based on previous results
    const interpolatedStep = {
      ...step,
      parameters: interpolateStepParameters(step, toolResults, fallbackMessage, executionContext)
    };
    
    const { tool_call, result } = await executeToolStep(interpolatedStep, fallbackMessage, executionContext);
    toolCalls.push(tool_call);
    toolResults.push(result);
  }

  return { tool_calls: toolCalls, results: toolResults };
}

function formatToolResponse(toolResults) {
  if (!toolResults?.tool_calls?.length) {
    return 'No tool calls were executed.';
  }

  const messages = toolResults.results.map((result, index) => {
    const tool = toolResults.tool_calls[index]?.tool;
    if (!result?.success) {
      return `${tool}: ${result?.error || 'Failed to execute tool.'}`;
    }

    const payload = result.result || {};

    switch (tool) {
      case 'fetch_price': {
        const prices = payload.prices || [];
        if (!prices.length) {
          return 'Price data not available.';
        }
        const formatted = prices.map(price => {
          const currency = (price.currency || '').toUpperCase();
          const value = typeof price.price === 'number' ? price.price.toFixed(4) : price.price;
          const change = price.change_24h !== undefined && price.change_24h !== null
            ? ` (24h ${price.change_24h.toFixed(2)}%)`
            : '';
          return `${price.coin.toUpperCase()}: ${value} ${currency}${change}`;
        }).join(', ');
        return `Current prices: ${formatted}.`;
      }
      case 'get_balance': {
        const symbol = payload.nativeCurrency || 'ETH';
        return `Balance for ${payload.address}: ${payload.balance} ${symbol}.`;
      }
      case 'get_flow_network_overview': {
        const sponsorship = payload.sponsoredRpcEnabled ? 'enabled' : 'not configured';
        return `Flow is ready in BlockOPs on ${payload.network} (chain ${payload.chainId}). Faucet: ${payload.faucetUrl}. Sponsored gas is ${sponsorship}.`;
      }
      case 'get_flow_wallet_readiness': {
        const symbol = payload.nativeCurrency || 'FLOW';
        return payload.funded
          ? `Flow wallet ${payload.address} is ready with ${payload.balance} ${symbol}.`
          : `Flow wallet ${payload.address} needs funding. Current balance: ${payload.balance} ${symbol}. Faucet: ${payload.faucetUrl}.`;
      }
      case 'transfer': {
        if (payload.requiresMetaMask || payload.requiresSigning || payload.prepared) {
          const details = payload.details || {};
          const to = details.toAddress || payload.transaction?.to || 'unknown';
          const amount = details.amount || 'unknown';
          const symbol = details.tokenSymbol || payload.tokenSymbol || payload.nativeCurrency || details.nativeCurrency || 'ETH';
          return `Transfer prepared for wallet signing: ${amount} ${symbol} to ${to}. Please sign this transaction in your wallet/Lit flow.`;
        }
        if (payload.walletType === 'pkp') {
          return `Transfer completed via Lit PKP. Tx: ${payload.transactionHash || payload.txHash || 'unknown'}.`;
        }
        return `Transfer completed. Tx: ${payload.transactionHash || 'unknown'}.`;
      }
      case 'deploy_erc20': {
        const tokenAddress = payload.tokenAddress || payload.contractAddress || null;
        const txHash = payload.transactionHash || payload.txHash || 'unknown';
        if (tokenAddress) {
          return `Token deployed at ${tokenAddress}. Tx: ${txHash}.`;
        }
        return `Token deployed. Tx: ${txHash}.`;
      }
      case 'deploy_erc721': {
        const collectionAddress = payload.collectionAddress || payload.contractAddress || 'unknown';
        const txHash = payload.transactionHash || payload.txHash || 'unknown';
        return `NFT collection deployed. Address: ${collectionAddress}. Tx: ${txHash}.`;
      }
      case 'mint_nft': {
        return `NFT minted. Token ID: ${payload.tokenId || 'unknown'}. Tx: ${payload.transactionHash || 'unknown'}.`;
      }
      case 'get_token_info': {
        return `Token info: ${payload.name || 'unknown'} (${payload.symbol || 'unknown'}), supply ${payload.totalSupply || 'unknown'}.`;
      }
      case 'get_token_balance': {
        return `Token balance for ${payload.ownerAddress || 'unknown'}: ${payload.balance || 'unknown'}.`;
      }
      case 'get_nft_info': {
        return `NFT ${payload.tokenId || 'unknown'} owner: ${payload.owner || 'unknown'}.`;
      }
      case 'send_email': {
        return `Email sent successfully.`;
      }
      case 'calculate': {
        return `Calculation result: ${payload.result}.`;
      }
      case 'batch_transfer': {
        return `Batch ETH transfer complete. ${payload.recipientCount} recipients, ${payload.totalAmount} ETH total. Tx: ${payload.transactionHash || 'multiple'}.`;
      }
      case 'batch_mint': {
        return `Batch mint complete. ${payload.succeeded}/${payload.recipientCount} NFTs minted successfully${payload.failed > 0 ? `, ${payload.failed} failed` : ''}.`;
      }
      case 'tx_status': {
        return `Transaction ${payload.hash?.slice(0, 10)}... is ${payload.status || 'unknown'} with ${payload.confirmations ?? 0} confirmation(s).`;
      }
      case 'wallet_history': {
        const txs = payload.transactions || [];
        return `Wallet history for ${payload.address?.slice(0, 10)}...: ${txs.length} transaction(s) returned.`;
      }
      case 'lookup_transaction': {
        const status = payload.receipt?.status || 'pending';
        const val = payload.value ? ` Value: ${payload.value} ETH.` : '';
        return `Transaction ${payload.hash?.slice(0, 10)}... is ${status}.${val} Block: ${payload.blockNumber || 'pending'}. Explorer: ${payload.explorerUrl || ''}`;
      }
      case 'fetch_events': {
        return `Found ${payload.totalFound} event(s) for ${payload.contractAddress} (returned ${payload.returned}). Block range: ${payload.fromBlock} – ${payload.toBlock}.`;
      }
      case 'lookup_block': {
        return `Block ${payload.blockNumber}: ${payload.transactionCount} txs, gas used ${payload.gasUsedPct}, timestamp ${payload.timestampIso}.`;
      }
      case 'decode_revert': {
        const r = payload.revertReason;
        if (!r) return 'Transaction did not revert.';
        return `Revert reason (${r.type}): ${r.message || r.selector || 'unknown'}`;
      }
      case 'get_portfolio': {
        const eth = payload.eth?.balance ? `ETH: ${payload.eth.balance}` : '';
        const usd = payload.totalValueUsd ? ` | Total: $${payload.totalValueUsd}` : '';
        const tokens = payload.erc20?.count ? ` | ${payload.erc20.count} ERC20 token(s)` : '';
        const nfts = payload.nfts?.count ? ` | ${payload.nfts.count} NFT(s)` : '';
        return `Portfolio for ${payload.address?.slice(0, 10)}...: ${eth}${tokens}${nfts}${usd}`;
      }
      case 'resolve_ens': {
        return `${payload.name} resolves to ${payload.address}`;
      }
      case 'reverse_ens': {
        return payload.name
          ? `${payload.address?.slice(0, 10)}... has ENS name: ${payload.name}`
          : `No ENS name found for ${payload.address?.slice(0, 10)}...`;
      }
      case 'estimate_gas': {
        const n = payload.suggested?.normal;
        const symbol = payload.nativeCurrency || 'ETH';
        return `Current gas on ${payload.network || payload.chain || 'the selected chain'}: base fee ${payload.baseFee}, normal max fee ${n?.maxFeePerGas}. Native transfer ~${n?.estimatedTxCostEth?.transfer} ${symbol}.`;
      }
      case 'simulate_gas': {
        return `Gas estimate: ${payload.gasEstimateWithBuffer} units (with buffer). Est. cost: ${payload.estimatedCostWithBufferEth} ETH.`;
      }
      case 'swap_tokens': {
        const sw = payload.swap || {};
        const status = payload.status === 'success' ? 'succeeded' : 'reverted';
        const warn = payload.warning ? ` ⚠️ ${payload.warning}` : '';
        return `Swap ${status}: ${sw.tokenIn?.amount} ${sw.tokenIn?.symbol} → ~${sw.tokenOut?.quotedAmount} ${sw.tokenOut?.symbol} (min ${sw.tokenOut?.minimumAmount}). Tx: ${payload.txHash}. Explorer: ${payload.explorerUrl}.${warn}`;
      }
      case 'get_swap_quote': {
        const quote = payload;
        const best = quote.slippageScenarios?.find(s => s.slippage === '0.5%');
        const minOut = best ? ` (min ${best.amountOutMinimum} with 0.5% slippage)` : '';
        return `Quote: ${quote.tokenIn?.amount} ${quote.tokenIn?.symbol} → ${quote.tokenOut?.quotedAmount} ${quote.tokenOut?.symbol}${minOut}. Rate: ${quote.effectivePrice}. Fee tier: ${quote.feeTier}.`;
      }
      case 'bridge_deposit': {
        return `Bridge deposit ${payload.status}: ${payload.amount} from L1 → L2. Tx: ${payload.txHash}. ${payload.note || ''} Track: ${payload.trackStatus || ''}`;
      }
      case 'bridge_withdraw': {
        return `Bridge withdrawal ${payload.status}: ${payload.amount} from L2 → L1. Tx: ${payload.txHash}. ${payload.note || ''}`;
      }
      case 'bridge_status': {
        return `Retryable ticket ${payload.ticketId?.slice(0, 12)}... status: ${payload.ticketStatus}. L1: ${payload.l1?.status}. ${payload.note || ''}`;
      }
      case 'schedule_transfer': {
        return `Scheduled transfer created (ID: ${payload.id}) on ${payload.network || payload.chain || 'the selected chain'}. ${payload.note || ''} Type: ${payload.type}. Amount: ${payload.amount}. To: ${payload.toAddress?.slice(0, 10)}...`;
      }
      case 'create_savings_plan': {
        return `Savings plan created (ID: ${payload.id}) on ${payload.network || payload.chain || 'the selected chain'}. ${payload.note || ''}`;
      }
      case 'schedule_payout': {
        return `Scheduled payout created (ID: ${payload.id}) on ${payload.network || payload.chain || 'the selected chain'}. ${payload.note || ''}`;
      }
      case 'create_payroll_plan': {
        return `Payroll plan created (ID: ${payload.id}) on ${payload.network || payload.chain || 'the selected chain'}. ${payload.note || ''}`;
      }
      case 'create_grant_payout': {
        return `Grant payout plan created (ID: ${payload.id}) on ${payload.network || payload.chain || 'the selected chain'}. ${payload.note || ''}`;
      }
      case 'schedule_reminder': {
        return `Scheduled reminder created (ID: ${payload.id}). ${payload.note || ''}`;
      }
      case 'list_reminders': {
        const count = payload.total || 0;
        const active = (payload.jobs || []).filter(j => j.status === 'active').length;
        return `Found ${count} reminder job(s), ${active} active.`;
      }
      case 'cancel_reminder': {
        const cancelledIds = Array.isArray(payload.cancelledIds)
          ? payload.cancelledIds
          : (Array.isArray(payload.ids) ? payload.ids : []);
        if (cancelledIds.length > 1) {
          return `Cancelled ${cancelledIds.length} reminders.`;
        }
        const cancelledId = payload.id || cancelledIds[0] || 'unknown';
        return `Reminder ${cancelledId} has been cancelled.`;
      }
      case 'list_schedules': {
        const count = payload.total || 0;
        const active = (payload.jobs || []).filter(j => j.status === 'active').length;
        return `Found ${count} scheduled transfer(s), ${active} active.`;
      }
      case 'cancel_schedule': {
        return `Scheduled transfer ${payload.id} has been cancelled.`;
      }
      default:
        return `Executed ${tool}.`;
    }
  });

  return messages.join('\n');
}

module.exports = {
  executeToolsDirectly,
  formatToolResponse
};
