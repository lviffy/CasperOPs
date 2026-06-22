/**
 * Telegram Bot Service
 *
 * Bridges Telegram messages into the existing BlockOps AI chat pipeline.
 * Uses the Telegram Bot API (long-polling for dev, webhook for prod).
 *
 * Features:
 *   • Registers Telegram chatId per user in Supabase `telegram_users` table
 *   • Commands: /start /balance /price /status /help
 *   • Free-text messages are forwarded into conversationController chat pipeline
 *   • Outbound notifications: fireToTelegram() allows any service to push messages
 *   • Webhook delivery receipts can also be forwarded to a Telegram chatId
 *
 * Environment variables required:
 *   TELEGRAM_BOT_TOKEN   — from BotFather
 *   TELEGRAM_WEBHOOK_URL — public HTTPS URL for prod (e.g. https://yourapi.com/telegram/webhook)
 *                          Leave empty to use long-polling during local dev.
 *
 * Optional for Lit-managed private keys stored in `users.private_key`:
 *   LIT_API_BASE_URL      — defaults to https://api.dev.litprotocol.com/core/v1
 *   LIT_USAGE_API_KEY     — required to decrypt Lit ciphertexts
 *   LIT_PKP_ID            — optional fallback PKP id when payload pkpId is missing
 */

const axios   = require('axios');
const bcrypt  = require('bcrypt');
const { ethers } = require('ethers');
const supabase = require('../config/supabase');
const { getAgentById, verifyApiKey } = require('../controllers/agentController');

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_URL  = process.env.TELEGRAM_WEBHOOK_URL || '';
const BACKEND_URL  = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
const MASTER_KEY   = process.env.MASTER_API_KEY || '';

const TG_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;
const telegramConversationSessions = new Map();

const LIT_PRIVATE_KEY_PREFIX = 'lit:v1:';
const LIT_PROVIDERS = ['lit-chipotle', 'lit-naga-test'];
const DEFAULT_LIT_API_BASE_URL = 'https://api.dev.litprotocol.com/core/v1';
const decryptedKeyCache = new Map();
const DECRYPT_ACTION_CODE = `
async function main({ pkpId, ciphertext }) {
  const plaintext = await Lit.Actions.Decrypt({ pkpId, ciphertext });
  return { plaintext };
}
`;

function getConversationSessionKey(chatId, agentId) {
  return `${String(chatId)}:${String(agentId || 'generic')}`;
}

function getSessionConversationId(chatId, agentId) {
  const key = getConversationSessionKey(chatId, agentId);
  return telegramConversationSessions.get(key) || null;
}

function setSessionConversationId(chatId, agentId, conversationId) {
  if (!conversationId) {
    return;
  }
  const key = getConversationSessionKey(chatId, agentId);
  telegramConversationSessions.set(key, conversationId);
}

function clearChatConversationSessions(chatId) {
  const prefix = `${String(chatId)}:`;
  for (const key of telegramConversationSessions.keys()) {
    if (key.startsWith(prefix)) {
      telegramConversationSessions.delete(key);
    }
  }
}

function isRawPrivateKey(privateKey) {
  if (!privateKey || typeof privateKey !== 'string') return false;
  const trimmed = privateKey.trim();
  return /^0x[a-fA-F0-9]{64}$/.test(trimmed) || /^[a-fA-F0-9]{64}$/.test(trimmed);
}

function isLitStoredPrivateKey(privateKey) {
  return !!privateKey && typeof privateKey === 'string' && privateKey.startsWith(LIT_PRIVATE_KEY_PREFIX);
}

function normalizePrivateKey(privateKey) {
  if (!privateKey || typeof privateKey !== 'string') return null;
  const trimmed = privateKey.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return `0x${trimmed}`;
  return null;
}

function normalizeAddress(address) {
  if (!address || typeof address !== 'string') return null;
  const trimmed = address.trim();
  return ethers.isAddress(trimmed) ? trimmed : null;
}

function deriveAddressFromPrivateKey(privateKey) {
  try {
    if (!privateKey) return null;
    return new ethers.Wallet(privateKey).address;
  } catch (_) {
    return null;
  }
}

function deriveAddressFromPkpPublicKey(pkpPublicKey) {
  try {
    if (!pkpPublicKey || typeof pkpPublicKey !== 'string') return null;
    return ethers.computeAddress(pkpPublicKey);
  } catch (_) {
    return null;
  }
}

function parseLitStoredPrivateKey(storedPrivateKey) {
  if (!isLitStoredPrivateKey(storedPrivateKey)) {
    throw new Error('Not a Lit-managed private key payload');
  }

  const rawJson = storedPrivateKey.slice(LIT_PRIVATE_KEY_PREFIX.length);
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (_) {
    throw new Error('Invalid Lit private key payload format');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    parsed.version !== 1 ||
    !LIT_PROVIDERS.includes(parsed.provider) ||
    typeof parsed.pkpId !== 'string' ||
    typeof parsed.ciphertext !== 'string'
  ) {
    throw new Error('Invalid Lit private key payload schema');
  }

  return parsed;
}

function parseLitResponsePayload(payload) {
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      return { value: parsed };
    } catch (_) {
      return { value: payload };
    }
  }

  if (payload && typeof payload === 'object') {
    return payload;
  }

  return { value: payload };
}

function getLitConfig() {
  const apiBaseUrl = (process.env.LIT_API_BASE_URL || DEFAULT_LIT_API_BASE_URL).replace(/\/$/, '');
  const apiKey = process.env.LIT_USAGE_API_KEY;
  const defaultPkpId = process.env.LIT_PKP_ID || null;

  if (!apiKey) {
    throw new Error('Lit is not configured: missing LIT_USAGE_API_KEY');
  }

  return { apiBaseUrl, apiKey, defaultPkpId };
}

async function runLitAction({ code, jsParams }) {
  const { apiBaseUrl, apiKey } = getLitConfig();

  const response = await axios.post(
    `${apiBaseUrl}/lit_action`,
    {
      code,
      js_params: jsParams || {}
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey
      },
      timeout: 15000,
      validateStatus: () => true
    }
  );

  if (response.status < 200 || response.status >= 300) {
    const responseBody = typeof response.data === 'string'
      ? response.data
      : response.data?.logs || JSON.stringify(response.data);
    throw new Error(`Lit action request failed (${response.status}): ${responseBody}`);
  }

  const body = response.data;

  if (!body || typeof body !== 'object') {
    throw new Error('Lit action returned an invalid response');
  }

  if (body.has_error) {
    throw new Error(body.logs || 'Lit action execution failed');
  }

  return parseLitResponsePayload(body.response);
}

async function decryptSecretWithLit(ciphertext, pkpId) {
  const { defaultPkpId } = getLitConfig();
  const finalPkpId = pkpId || defaultPkpId;

  if (!finalPkpId) {
    throw new Error('Lit decrypt requires pkpId (missing payload pkpId and LIT_PKP_ID)');
  }

  const payload = await runLitAction({
    code: DECRYPT_ACTION_CODE,
    jsParams: {
      pkpId: finalPkpId,
      ciphertext
    }
  });

  const plaintext = typeof payload?.plaintext === 'string' ? payload.plaintext : null;
  if (!plaintext) {
    throw new Error('Lit decryption did not return plaintext');
  }

  return plaintext;
}

async function decryptStoredPrivateKey(storedPrivateKey) {
  if (!storedPrivateKey || typeof storedPrivateKey !== 'string') return null;

  if (isRawPrivateKey(storedPrivateKey)) {
    return normalizePrivateKey(storedPrivateKey);
  }

  if (!isLitStoredPrivateKey(storedPrivateKey)) {
    return null;
  }

  if (decryptedKeyCache.has(storedPrivateKey)) {
    return decryptedKeyCache.get(storedPrivateKey) || null;
  }

  const litPayload = parseLitStoredPrivateKey(storedPrivateKey);
  const plaintext = await decryptSecretWithLit(litPayload.ciphertext, litPayload.pkpId);

  if (!isRawPrivateKey(plaintext)) {
    throw new Error('Lit decrypt returned an invalid private key');
  }

  const normalizedPrivateKey = normalizePrivateKey(plaintext);
  if (!normalizedPrivateKey) {
    throw new Error('Unable to normalize decrypted private key');
  }

  decryptedKeyCache.set(storedPrivateKey, normalizedPrivateKey);
  return normalizedPrivateKey;
}

async function getTelegramWalletContext(preferredWalletAddress = null, linkedUserId = null) {
  const preferredAddress = normalizeAddress(preferredWalletAddress);
  if (!supabase || !linkedUserId) {
    return {
      walletAddress: preferredAddress,
      walletType: null,
      privateKey: null,
      pkpPublicKey: null,
      pkpTokenId: null
    };
  }

  const { data: userRecord, error } = await supabase
    .from('users')
    .select('private_key, wallet_address, wallet_type, pkp_public_key, pkp_token_id')
    .eq('id', String(linkedUserId))
    .maybeSingle();

  if (error) {
    console.error('[Telegram] Failed to load linked user signing context:', error.message || error);
    return {
      walletAddress: preferredAddress,
      walletType: null,
      privateKey: null,
      pkpPublicKey: null,
      pkpTokenId: null
    };
  }

  const walletType =
    userRecord?.wallet_type === 'pkp'
      ? 'pkp'
      : userRecord?.wallet_type === 'traditional'
        ? 'traditional'
        : null;
  const pkpPublicKey =
    walletType === 'pkp' && typeof userRecord?.pkp_public_key === 'string'
      ? userRecord.pkp_public_key
      : null;
  const pkpTokenId =
    walletType === 'pkp' && typeof userRecord?.pkp_token_id === 'string'
      ? userRecord.pkp_token_id
      : null;
  let privateKey = null;
  const storedPrivateKey = typeof userRecord?.private_key === 'string' ? userRecord.private_key : null;
  if (walletType !== 'pkp' && storedPrivateKey) {
    try {
      privateKey = await decryptStoredPrivateKey(storedPrivateKey);
    } catch (err) {
      console.warn('[Telegram] Failed to resolve linked user private key for Telegram chat:', err.message || err);
    }
  }

  const userWalletAddress = normalizeAddress(userRecord?.wallet_address || null);
  const derivedAddress = deriveAddressFromPrivateKey(privateKey);
  const pkpDerivedAddress = normalizeAddress(deriveAddressFromPkpPublicKey(pkpPublicKey));

  let walletAddress = userWalletAddress || pkpDerivedAddress || derivedAddress || preferredAddress || null;

  // Never pass a signer key when it does not map to the active wallet context.
  if (privateKey && walletAddress && derivedAddress && walletAddress.toLowerCase() !== derivedAddress.toLowerCase()) {
    console.warn('[Telegram] Linked user wallet differs from decrypted private key; privateKey context disabled for this chat');
    privateKey = null;
  }

  return {
    walletAddress,
    walletType,
    privateKey,
    pkpPublicKey,
    pkpTokenId
  };
}

// Escape characters that break Telegram's legacy Markdown parser
function mdEscape(str) {
  if (!str) return '';
  return String(str).replace(/[*_`[\]]/g, (c) => '\\' + c);
}

// ── Telegram API helpers ──────────────────────────────────────────────────────

async function tgRequest(method, body = {}, timeout = 10000) {
  if (!TG_API) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const { data } = await axios.post(`${TG_API}/${method}`, body, { timeout });
  return data;
}

/**
 * Send a plain-text message to a Telegram chat.
 * Silently no-ops if bot token is missing.
 */
async function sendMessage(chatId, text, options = {}) {
  if (!TG_API) return;

  const { parse_mode, ...restOptions } = options || {};
  const payload = {
    chat_id: chatId,
    text: String(text ?? ''),
    parse_mode: parse_mode || 'Markdown',
    ...restOptions
  };

  try {
    await tgRequest('sendMessage', payload);
  } catch (err) {
    const tgError = err.response?.data;
    const description = String(tgError?.description || err.message || '');
    const isMarkdownParseError =
      tgError?.error_code === 400 &&
      description.toLowerCase().includes("can't parse entities");

    // If Telegram rejects Markdown entities from AI output, retry once as plain text.
    if (isMarkdownParseError) {
      try {
        await tgRequest('sendMessage', {
          chat_id: chatId,
          text: String(text ?? ''),
          ...restOptions
        });
        console.warn(`[Telegram] sendMessage markdown parse failed for ${chatId}; resent as plain text`);
        return;
      } catch (retryErr) {
        console.error(`[Telegram] sendMessage plain-text retry to ${chatId} failed:`, retryErr.response?.data || retryErr.message || retryErr);
      }
    }

    console.error(`[Telegram] sendMessage to ${chatId} failed:`, tgError || err.message || err);
  }
}

// ── User registration (Supabase) ─────────────────────────────────────────────

async function upsertTelegramUser({ chatId, username, firstName, agentId }) {
  if (!supabase) return;
  await supabase.from('telegram_users').upsert({
    chat_id:    String(chatId),
    username:   username || null,
    first_name: firstName || null,
    agent_id:   agentId || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'chat_id' }).then(({ error }) => {
    if (error) console.error('[Telegram] upsert user error:', error.message);
  });
}

async function getTelegramUser(chatId) {
  if (!supabase) return null;
  const { data } = await supabase
    .from('telegram_users')
    .select('*')
    .eq('chat_id', String(chatId))
    .single();
  return data || null;
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleStart(chatId, user) {
  await upsertTelegramUser({
    chatId,
    username:  user.username,
    firstName: user.first_name
  });
  await sendMessage(chatId,
    `👋 Welcome to *BlockOps*!\n\n` +
    `I'm your on-chain AI assistant. Here's what I can do:\n\n` +
    `🔹 /balance \`<address>\` — check ETH balance\n` +
    `🔹 /price \`<token>\` — get token price (e.g., /price ETH)\n` +
    `🔹 /status \`<txHash>\` — look up a transaction\n` +
    `🔹 /help — show all commands\n\n` +
    `Or just ask me anything in plain English:\n` +
    `  • "What's the gas price right now?"\n` +
    `  • "Show me the portfolio for 0x1234..."\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🤖 *Want a custom agent?*\n` +
    `Create one at https://blockops.in/agents\n` +
    `Then type: /connect <agent-id> <api-key>\n\n` +
    `Your agent can have:\n` +
    `  ✓ Custom personality\n` +
    `  ✓ Specific tools only\n` +
    `  ✓ Pre-configured wallet\n\n` +
    `For now, you're in *generic mode* with all tools enabled.`
  );
}

async function handleHelp(chatId) {
  await sendMessage(chatId,
    `*BlockOps Bot Commands*\n\n` +
    `*Basic Commands:*\n` +
    `/balance \`<address>\` — ETH balance for an address\n` +
    `/price \`<token>\` — current token price\n` +
    `/status \`<txHash>\` — transaction status\n` +
    `/help — this message\n\n` +
    `*Agent Commands:*\n` +
    `/connect \`<agent-id> <api-key>\` — link to your custom agent\n` +
    `/disconnect — return to generic mode\n` +
    `/agent — show linked agent details\n` +
    `/switch \`<agent-id> <api-key>\` — switch to different agent\n\n` +
    `You can also ask me anything in plain English, e.g.:\n` +
    `_"What is the gas price right now?"_\n` +
    `_"Show me the portfolio for 0x1234..."_\n` +
    `_"What's the ETH price?"_`
  );
}

async function handleBalance(chatId, args) {
  const address = args[0];
  if (!address || !address.startsWith('0x') || address.length < 40) {
    return sendMessage(chatId, '❌ Please provide a valid Ethereum address.\nUsage: `/balance 0x1234...`');
  }
  try {
    const { data } = await axios.get(`${BACKEND_URL}/transfer/balance/${address}`, {
      headers: { 'x-api-key': MASTER_KEY },
      timeout: 10000
    });
    const bal = data.balance ?? data.result?.balance ?? '?';
    const balFormatted = typeof bal === 'number' ? bal.toFixed(4) : String(bal);
    await sendMessage(chatId, `💰 Balance for \`${address.slice(0, 10)}...\`\n\n*${balFormatted} ETH*`);
  } catch (err) {
    await sendMessage(chatId, `❌ Could not fetch balance: ${err.message}`);
  }
}

async function handlePrice(chatId, args) {
  const query = args.join(' ');
  if (!query) {
    return sendMessage(chatId, '❌ Please provide a token name.\nUsage: `/price ETH` or `/price bitcoin`');
  }
  try {
    const { data } = await axios.post(`${BACKEND_URL}/price/token`, { query }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    const prices = data.prices || data.result?.prices || [];
    let lines;
    if (Array.isArray(prices)) {
      // Array of { coin, price, currency, change_24h, market_cap, ... }
      lines = prices.map(p => {
        const change = p.change_24h != null ? ` (${p.change_24h >= 0 ? '+' : ''}${p.change_24h.toFixed(2)}%)` : '';
        return `*${(p.coin || p.symbol || '?').toUpperCase()}*: $${Number(p.price).toLocaleString()}${change}`;
      }).join('\n');
    } else {
      // Object keyed by symbol (fallback)
      lines = Object.entries(prices)
        .map(([sym, info]) => `*${sym.toUpperCase()}*: $${info.usd ?? info}`)
        .join('\n');
    }
    await sendMessage(chatId, lines || `No price found for "${query}"`);
  } catch (err) {
    await sendMessage(chatId, `❌ Could not fetch price: ${err.message}`);
  }
}

async function handleStatus(chatId, args) {
  const txHash = args[0];
  if (!txHash || !txHash.startsWith('0x')) {
    return sendMessage(chatId, '❌ Please provide a transaction hash.\nUsage: `/status 0xabc...`');
  }
  try {
    const { data } = await axios.get(`${BACKEND_URL}/chain/tx/${txHash}`, {
      headers: { 'x-api-key': MASTER_KEY },
      timeout: 15000
    });
    const tx = data.result || data;
    const status  = tx.receipt?.status ?? 'pending';
    const block   = tx.blockNumber ?? 'pending';
    const value   = tx.value ? `\nValue: *${tx.value} ETH*` : '';
    await sendMessage(chatId,
      `📋 *Transaction* \`${txHash.slice(0, 12)}...\`\n` +
      `Status: *${status}*\n` +
      `Block: ${block}${value}\n` +
      `[View on Arbiscan](${tx.explorerUrl || `https://sepolia.arbiscan.io/tx/${txHash}`})`
    );
  } catch (err) {
    await sendMessage(chatId, `❌ Could not fetch transaction: ${err.message}`);
  }
}

// ── Agent Linking Commands ───────────────────────────────────────────────────

async function handleConnect(chatId, args) {
  if (args.length < 2) {
    return sendMessage(chatId,
      '❌ Usage: `/connect <agent-id> <api-key>`\n\n' +
      'Get your agent ID and API key from https://blockops.in/agents'
    );
  }

  const [agentId, apiKey] = args;

  // Verify agent exists and API key is correct
  const agent = await getAgentById(agentId);
  if (!agent) {
    return sendMessage(chatId, '❌ Agent not found. Check your agent ID.');
  }

  const isValid = await verifyApiKey(agentId, apiKey);
  if (!isValid) {
    return sendMessage(chatId, '❌ Invalid API key. Please check and try again.');
  }

  // Hash the API key for storage (so we can verify it later)
  const apiKeyHash = await bcrypt.hash(apiKey, 12);

  // Update telegram_users to link this agent
  const { error } = await supabase
    .from('telegram_users')
    .update({
      linked_agent_id: agentId,
      agent_api_key_hash: apiKeyHash,
      linked_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('chat_id', String(chatId));

  if (error) {
    console.error('[Telegram] Link agent error:', error);
    return sendMessage(chatId, `⚠️ Something went wrong: ${error.message}`);
  }

  clearChatConversationSessions(chatId);

  const toolCount = agent.enabled_tools?.length || 0;
  const toolList = agent.enabled_tools?.slice(0, 4).map(mdEscape).join(', ') || 'none specified';

  await sendMessage(chatId,
    `✅ *Connected to agent:* ${mdEscape(agent.name)}\n\n` +
    `🤖 *Agent Details:*\n` +
    `• Name: ${mdEscape(agent.name)}\n` +
    `• Enabled Tools: ${toolCount} ${toolCount > 4 ? '(showing first 4)' : ''}\n` +
    `  ${toolList}\n` +
    (agent.wallet_address ? `• Wallet: ${mdEscape(agent.wallet_address.slice(0, 10))}...\n` : '') +
    (agent.system_prompt ? `• Personality: "${mdEscape(agent.system_prompt.slice(0, 80))}"\n\n` : '\n') +
    `🔹 Your messages will now be handled by this agent with custom settings.\n` +
    `🔹 Generic commands (/balance, /price, /status) still work.\n\n` +
    `Type /agent to see full details.\n` +
    `Type /disconnect to return to generic mode.`
  );
}

async function handleDisconnect(chatId) {
  const telegramUser = await getTelegramUser(chatId);

  if (!telegramUser?.linked_agent_id) {
    return sendMessage(chatId,
      'ℹ️ You\'re not connected to any agent. You\'re in generic mode.\n\n' +
      'To connect to a custom agent:\n' +
      '1. Create one at https://blockops.in/agents\n' +
      '2. Type: /connect <agent-id> <api-key>'
    );
  }

  // Get agent name before unlinking
  const agent = await getAgentById(telegramUser.linked_agent_id);
  const agentName = agent?.name || 'Unknown Agent';

  // Unlink
  const { error } = await supabase
    .from('telegram_users')
    .update({
      linked_agent_id: null,
      agent_api_key_hash: null,
      linked_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('chat_id', String(chatId));

  if (error) {
    console.error('[Telegram] Disconnect error:', error);
    return sendMessage(chatId, `⚠️ Something went wrong: ${error.message}`);
  }

  clearChatConversationSessions(chatId);

  await sendMessage(chatId,
    `✅ Disconnected from agent: *${mdEscape(agentName)}*\n\n` +
    `You're back to *generic mode* with all tools enabled.\n\n` +
    `Type /connect <agent-id> <api-key> to link to an agent again.`
  );
}

async function handleAgent(chatId) {
  const telegramUser = await getTelegramUser(chatId);

  if (!telegramUser?.linked_agent_id) {
    return sendMessage(chatId,
      'ℹ️ *Generic Mode* (default)\n\n' +
      'You\'re using the standard BlockOps assistant with:\n' +
      '• All 20+ tools enabled\n' +
      '• Default system prompt\n' +
      '• No wallet pre-configured\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '🤖 *Want a custom agent?*\n' +
      '1. Create one at https://blockops.in/agents\n' +
      '2. Copy your Agent ID and API Key\n' +
      '3. Type: /connect <agent-id> <api-key>'
    );
  }

  const agent = await getAgentById(telegramUser.linked_agent_id);
  if (!agent) {
    return sendMessage(chatId,
      '⚠️ Your linked agent no longer exists. Falling back to generic mode.\n\n' +
      'Type /disconnect to clear the link.'
    );
  }

  const toolCount = agent.enabled_tools?.length || 0;
  const toolList = agent.enabled_tools?.slice(0, 8).map(t => `  • ${mdEscape(t)}`).join('\n') || '  • (none specified)';

  await sendMessage(chatId,
    `🤖 *Connected Agent*\n\n` +
    `*Name:* ${mdEscape(agent.name)}\n` +
    `*ID:* ${agent.id}\n` +
    (agent.description ? `*Description:* ${mdEscape(agent.description)}\n` : '') +
    (agent.wallet_address ? `*Wallet:* ${mdEscape(agent.wallet_address.slice(0, 10))}...\n` : '') +
    (agent.system_prompt ? `*System Prompt:* "${mdEscape(agent.system_prompt.slice(0, 120))}"\n\n` : '\n') +
    `*Enabled Tools (${toolCount}/20+):*\n${toolList}\n` +
    (toolCount > 8 ? `  ...and ${toolCount - 8} more\n\n` : '\n') +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Generic commands (/balance, /price, /status) still work.\n` +
    `Type /disconnect to return to generic mode.`
  );
}

async function handleSwitch(chatId, args) {
  if (args.length < 2) {
    return sendMessage(chatId,
      '❌ Usage: `/switch <agent-id> <api-key>`\n\n' +
      'This is a shortcut for /disconnect + /connect.'
    );
  }

  // Disconnect first (silently)
  await supabase
    .from('telegram_users')
    .update({
      linked_agent_id: null,
      agent_api_key_hash: null,
      linked_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('chat_id', String(chatId));

  clearChatConversationSessions(chatId);

  // Then connect to new agent
  await handleConnect(chatId, args);
}

// ── Free-text → AI chat pipeline ─────────────────────────────────────────────

async function handleFreeText(chatId, text, user) {
  // Ensure user exists
  await upsertTelegramUser({ chatId, username: user.username, firstName: user.first_name });

  const telegramUser = await getTelegramUser(chatId);
  let agentId, agentConfig;
  
  if (telegramUser?.linked_agent_id) {
    // AGENT MODE: Load custom agent config
    const agent = await getAgentById(telegramUser.linked_agent_id);
    if (agent) {
      agentId = agent.id;
      agentConfig = {
        systemPrompt: agent.system_prompt,
        enabledTools: agent.enabled_tools,
        walletAddress: agent.wallet_address,
        userId: agent.user_id
      };
    } else {
      // Agent deleted or invalid — fall back to generic
      await sendMessage(chatId, '⚠️ Your linked agent no longer exists. Falling back to generic mode.');
      agentId = telegramUser.id;
      agentConfig = null;
    }
  } else {
    // GENERIC MODE: Default behavior (all tools, default prompt)
    agentId = telegramUser?.id || `tg-${chatId}`;
    agentConfig = null;
  }

  const userId = `tg-user-${chatId}`;
  const conversationId = getSessionConversationId(chatId, agentId);
  const telegramWalletContext = await getTelegramWalletContext(
    agentConfig?.walletAddress || null,
    agentConfig?.userId || null
  );

  // Send "typing…" indicator
  await tgRequest('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  try {
    const { data } = await axios.post(`${BACKEND_URL}/api/chat`, {
      agentId,
      userId,
      message: text,
      conversationId,
      deliveryPlatform: 'telegram',
      telegramChatId: String(chatId),
      systemPrompt: agentConfig?.systemPrompt,       // null = use default
      enabledTools: agentConfig?.enabledTools,       // null = enable all
      walletAddress: telegramWalletContext.walletAddress, // linked user wallet context (fallback: linked agent wallet)
      walletType: telegramWalletContext.walletType,
      pkpPublicKey: telegramWalletContext.pkpPublicKey,
      pkpTokenId: telegramWalletContext.pkpTokenId,
      privateKey: telegramWalletContext.privateKey        // linked website user's private key when available
    }, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': MASTER_KEY },
      timeout: 60000
    });

    if (data?.conversationId) {
      setSessionConversationId(chatId, agentId, data.conversationId);
    }

    const reply = data.message || data.response || 'Done.';

    // Telegram Markdown is limited — strip unsupported formatting
    const safe = reply
      .replace(/#{1,6}\s/g, '*')          // headings → bold
      .replace(/\*\*(.+?)\*\*/g, '*$1*')  // **bold** → *bold*
      .replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/`{3}/g, '```')) // keep code blocks
      .slice(0, 4000);                    // Telegram max message length

    await sendMessage(chatId, safe);
  } catch (err) {
    console.error('[Telegram] Chat pipeline error:', err.message);
    await sendMessage(chatId, `⚠️ Something went wrong: ${err.message}`);
  }
}

// ── Update dispatcher ─────────────────────────────────────────────────────────

/**
 * Process a single Telegram update object (from webhook or long-poll).
 */
async function processUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return; // skip non-text updates

  const chatId = msg.chat.id;
  const user   = msg.from || {};
  const text   = msg.text.trim();

  // Parse command
  const commandMatch = text.match(/^\/(\w+)(?:@\S+)?\s*(.*)/s);
  if (commandMatch) {
    const cmd  = commandMatch[1].toLowerCase();
    const rest = commandMatch[2].trim();
    const args = rest ? rest.split(/\s+/) : [];

    switch (cmd) {
      case 'start':    return handleStart(chatId, user);
      case 'help':     return handleHelp(chatId);
      case 'balance':  return handleBalance(chatId, args);
      case 'price':    return handlePrice(chatId, args);
      case 'status':   return handleStatus(chatId, args);
      case 'connect':  return handleConnect(chatId, args);
      case 'disconnect': return handleDisconnect(chatId);
      case 'agent':    return handleAgent(chatId);
      case 'switch':   return handleSwitch(chatId, args);
      default:
        // Unknown command — treat as free text
        return handleFreeText(chatId, text, user);
    }
  }

  // Plain text
  return handleFreeText(chatId, text, user);
}

// ── Long-polling (local dev) ──────────────────────────────────────────────────

let _pollActive = false;
let _pollOffset = 0;

async function startLongPolling() {
  if (!BOT_TOKEN) {
    console.warn('[Telegram] BOT_TOKEN not set — Telegram bot disabled');
    return;
  }
  if (WEBHOOK_URL) {
    console.log('[Telegram] WEBHOOK_URL set — skipping long-polling (use webhook mode)');
    return;
  }
  if (_pollActive) return;
  _pollActive = true;
  console.log('[Telegram] Starting long-polling…');

  // Force-clear any existing webhook or concurrent session.
  // drop_pending_updates: true also kills leftover sessions causing 409.
  try {
    await tgRequest('deleteWebhook', { drop_pending_updates: true }, 10000);
    console.log('[Telegram] Webhook cleared');
  } catch (e) {
    console.warn('[Telegram] deleteWebhook failed (non-fatal):', e.message);
  }

  // Give Telegram a moment to release the previous session before we start
  await new Promise(r => setTimeout(r, 2000));

  const poll = async () => {
    if (!_pollActive) return;
    try {
      const { result } = await tgRequest('getUpdates', {
        offset:  _pollOffset,
        timeout: 30,          // Telegram server-side long-poll seconds
        allowed_updates: ['message', 'edited_message']
      }, 35000);             // axios timeout must be > Telegram timeout (30s → 35s)
      for (const update of result || []) {
        _pollOffset = update.update_id + 1;
        processUpdate(update).catch(e => console.error('[Telegram] processUpdate error:', e.message));
      }
      // Success — next poll immediately after the long-poll returns
      if (_pollActive) setImmediate(poll);
    } catch (err) {
      if (!_pollActive) return;
      const status = err.response?.status;
      if (status === 409) {
        // Another instance is polling — wait longer before retrying
        console.warn('[Telegram] 409 Conflict — another instance detected, retrying in 5s…');
        setTimeout(poll, 5000);
      } else {
        console.error('[Telegram] Poll error:', err.message);
        setTimeout(poll, 2000);
      }
    }
  };

  poll();
}

function stopLongPolling() {
  _pollActive = false;
}

// ── Webhook registration (production) ────────────────────────────────────────

async function registerWebhook() {
  if (!BOT_TOKEN || !WEBHOOK_URL) return;
  try {
    const result = await tgRequest('setWebhook', {
      url: `${WEBHOOK_URL}/telegram/webhook`,
      allowed_updates: ['message', 'edited_message'],
      drop_pending_updates: true
    });
    console.log('[Telegram] Webhook registered:', result.description || result.ok);
  } catch (err) {
    console.error('[Telegram] Failed to register webhook:', err.message);
  }
}

async function getWebhookInfo() {
  if (!BOT_TOKEN) return null;
  return tgRequest('getWebhookInfo');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Push a notification message to a specific Telegram chatId.
 * Called by webhookService or any other service.
 */
async function fireToTelegram(chatId, text) {
  return sendMessage(String(chatId), text);
}

/**
 * Get bot info (verifies token is valid).
 */
async function getBotInfo() {
  return tgRequest('getMe');
}

module.exports = {
  processUpdate,
  sendMessage,
  fireToTelegram,
  startLongPolling,
  stopLongPolling,
  registerWebhook,
  getWebhookInfo,
  getBotInfo,
  upsertTelegramUser,
  getTelegramUser
};
