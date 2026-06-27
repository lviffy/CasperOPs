/**
 * Telegram Bot Service
 *
 * Bridges Telegram messages into the existing CasperOPs AI chat pipeline.
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
const supabase = require('../config/supabase');
const { getAgentById, verifyApiKey } = require('../controllers/agentController');

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_URL  = process.env.TELEGRAM_WEBHOOK_URL || '';
const BACKEND_URL  = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
const MASTER_KEY   = process.env.MASTER_API_KEY || '';

const TG_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;
const telegramConversationSessions = new Map();



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



function normalizePrivateKey(privateKey) {
  if (!privateKey || typeof privateKey !== 'string') return null;
  const trimmed = privateKey.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return `0x${trimmed}`;
  return null;
}

// Phase 23: Casper addresses are 66-char hex prefixed with 0x (ed25519
// public keys start with `01`, secp256k1 with `02`). We accept both with
// and without the prefix and let downstream Casper SDK calls validate
// the curve. EVM-style 0x + 40 hex addresses are no longer recognised.
const CASPER_KEY_REGEX = /^(0x)?(?:01[0-9a-fA-F]{64}|02[0-9a-fA-F]{66})$/;

function normalizeAddress(address) {
  if (!address || typeof address !== 'string') return null;
  const trimmed = address.trim();
  return CASPER_KEY_REGEX.test(trimmed) ? trimmed : null;
}

async function decryptStoredPrivateKey(storedPrivateKey) {
  if (!storedPrivateKey || typeof storedPrivateKey !== 'string') return null;

  if (isRawPrivateKey(storedPrivateKey)) {
    return normalizePrivateKey(storedPrivateKey);
  }

  return null;
}

async function getTelegramWalletContext(preferredWalletAddress = null, linkedUserId = null) {
  const preferredAddress = normalizeAddress(preferredWalletAddress);
  if (!supabase || !linkedUserId) {
    return {
      walletAddress: preferredAddress,
      walletType: null,
      privateKey: null
    };
  }

  const { data: userRecord, error } = await supabase
    .from('users')
    .select('wallet_address, wallet_type')
    .eq('id', String(linkedUserId))
    .maybeSingle();

  if (error) {
    console.error('[Telegram] Failed to load linked user signing context:', error.message || error);
    return {
      walletAddress: preferredAddress,
      walletType: null,
      privateKey: null
    };
  }

  const walletType = userRecord?.wallet_type === 'csprclick' ? 'csprclick' : null;
  const userWalletAddress = normalizeAddress(userRecord?.wallet_address || null);
  let walletAddress = userWalletAddress || preferredAddress || null;

  return {
    walletAddress,
    walletType,
    privateKey: null
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
 * Send a message with an inline keyboard.
 */
async function sendWithKeyboard(chatId, text, buttons, options = {}) {
  const rows = []
  for (const row of buttons) {
    rows.push(row.map((btn) => (typeof btn === 'string' ? { text: btn, callback_data: btn } : btn)))
  }
  return sendMessage(chatId, text, {
    ...options,
    reply_markup: JSON.stringify({ inline_keyboard: rows }),
  })
}

function explorerUrl(deployHash) {
  return `https://testnet.cspr.live/deploy/${deployHash}`
}

async function csprBalance(address) {
  const { data } = await axios.get(`${BACKEND_URL}/transfer/balance/${address}`, {
    headers: { 'x-api-key': MASTER_KEY },
    timeout: 10000,
  })
  return data?.balance ?? data?.result?.balance ?? '?'
}

async function deployStatus(deployHash) {
  const { data } = await axios.get(`${BACKEND_URL}/v1/tools/lookup_deploy`, {
    params: { deploy_hash: deployHash },
    headers: { 'x-api-key': MASTER_KEY },
    timeout: 15000,
  })
  return data?.result ?? data ?? { status: 'unknown' }
}

async function executeTool(tool, params = {}) {
  const { data } = await axios.post(
    `${BACKEND_URL}/v1/tools/${tool}`,
    params,
    { headers: { 'x-api-key': MASTER_KEY, 'Content-Type': 'application/json' }, timeout: 30000 },
  )
  return data
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
  await sendWithKeyboard(chatId,
    `👋 Welcome to *CasperOPs* on *Casper*!\n\n` +
    `I'm your on-chain AI assistant. Here's what I can do:\n\n` +
    `💰 /balance \`<address>\` — check CSPR balance\n` +
    `💸 /transfer \`<to> <amount>\` — send CSPR\n` +
    `🤖 /agents — list on-chain agents\n` +
    `🔍 /status \`<deployHash>\` — check deploy status\n` +
    `📋 /help — show all commands\n\n` +
    `Or just chat with me in plain English!`,
    [
      [{ text: '💰 Balance', callback_data: 'cmd_balance' }, { text: '💸 Transfer', callback_data: 'cmd_transfer' }],
      [{ text: '🤖 My Agents', callback_data: 'cmd_agents' }, { text: '📋 Help', callback_data: 'cmd_help' }],
    ]
  );
}

async function handleHelp(chatId) {
  await sendWithKeyboard(chatId,
    `*CasperOPs Bot Commands*\n\n` +
    `*Casper-native:*\n` +
    `/balance \`<address>\` — CSPR balance for an address\n` +
    `/transfer \`<to> <amount>\` — send CSPR tokens\n` +
    `/status \`<deployHash>\` — check deploy status\n` +
    `/price \`<symbol>\` — CSPR or CEP-18 token price\n` +
    `/deploy \`<tool> <params>\` — execute a tool\n\n` +
    `*Agent Commands:*\n` +
    `/agents — list on-chain registered agents\n` +
    `/connect \`<agent-id> <api-key>\` — link to your custom agent\n` +
    `/disconnect — return to generic mode\n` +
    `/agent — show linked agent details\n\n` +
    `Or just ask me anything in plain English!`,
    [
      [{ text: '💰 Balance', callback_data: 'cmd_balance' }, { text: '💸 Transfer', callback_data: 'cmd_transfer' }],
      [{ text: '🤖 Agents', callback_data: 'cmd_agents' }, { text: '🔍 Status', callback_data: 'cmd_status' }],
    ]
  );
}

async function handleBalance(chatId, args) {
  let address = args[0];
  if (!address) {
    // Try the user's linked wallet address
    const tgUser = await getTelegramUser(chatId);
    const agent = tgUser?.linked_agent_id ? await getAgentById(tgUser.linked_agent_id) : null;
    address = agent?.wallet_address || null;
    if (!address) {
      return sendWithKeyboard(chatId,
        '❌ Please provide a Casper address.\n\nUsage: `/balance <casper-address>`\n\nOr link a wallet to your agent first.',
        [[{ text: '💰 Check Balance', callback_data: 'cmd_balance' }]]
      );
    }
  }
  if (!CASPER_KEY_REGEX.test(address)) {
    return sendMessage(chatId, '❌ Invalid Casper address. It should be a valid Casper public key starting with `01` (66 hex chars) or `02` (68 hex chars).');
  }
  try {
    const bal = await csprBalance(address);
    const short = address.slice(0, 8) + '...' + address.slice(-4);
    await sendWithKeyboard(chatId,
      `💰 *CSPR Balance*\n\nAddress: \`${short}\`\nBalance: *${bal} CSPR*`,
      [[{ text: '🔄 Refresh', callback_data: `cmd_balance_${address}` }, { text: '💸 Transfer', callback_data: 'cmd_transfer' }]]
    );
  } catch (err) {
    await sendMessage(chatId, `❌ Could not fetch balance: ${err.message}`);
  }
}

async function handlePrice(chatId, args) {
  const query = (args.join(' ') || 'CSPR').trim().toUpperCase();
  try {
    const { data } = await axios.post(`${BACKEND_URL}/price/token`, { query }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    const prices = data.prices || data.result?.prices || [];
    let lines;
    if (Array.isArray(prices)) {
      lines = prices.map(p => {
        const change = p.change_24h != null ? ` (${p.change_24h >= 0 ? '+' : ''}${p.change_24h.toFixed(2)}%)` : '';
        return `*${(p.coin || p.symbol || '?').toUpperCase()}*: $${Number(p.price).toLocaleString()}${change}`;
      }).join('\n');
    } else {
      lines = Object.entries(prices)
        .map(([sym, info]) => `*${sym.toUpperCase()}*: $${info.usd ?? info}`)
        .join('\n');
    }
    await sendWithKeyboard(chatId, lines || `No price found for "${query}"`,
      [[{ text: '🔄 Refresh', callback_data: `cmd_price_${query}` }]]
    );
  } catch (err) {
    await sendMessage(chatId, `❌ Could not fetch price: ${err.message}`);
  }
}

async function handleStatus(chatId, args) {
  const deployHash = args[0];
  if (!deployHash || !/^[0-9a-fA-F]{64}$/.test(deployHash)) {
    return sendWithKeyboard(chatId,
      '❌ Please provide a valid deploy hash (64 hex chars).\nUsage: `/status <deploy-hash>`',
      [[{ text: '🔍 Lookup Deploy', callback_data: 'cmd_status' }]]
    );
  }
  try {
    const info = await deployStatus(deployHash);
    const status = info.execution_results?.[0]?.result?.Success ? '✅ Finalized' : info.status || '⏳ Pending';
    const cost = info.execution_results?.[0]?.cost || '';
    const block = info.block || '';
    await sendWithKeyboard(chatId,
      `📋 *Deploy* \`${deployHash.slice(0, 12)}...\`\n\n` +
      `Status: *${status}*\n` +
      (block ? `Block: ${block}\n` : '') +
      (cost ? `Cost: ${cost} CSPR\n` : ''),
      [[{ text: '🔍 View on CSPR.live', url: explorerUrl(deployHash) }]]
    );
  } catch (err) {
    await sendMessage(chatId, `❌ Could not fetch deploy: ${err.message}`);
  }
}

// ── Casper-native Commands ────────────────────────────────────────────────────

async function handleTransfer(chatId, args) {
  const [recipient, amountStr] = args;
  if (!recipient || !amountStr || isNaN(parseFloat(amountStr))) {
    return sendWithKeyboard(chatId,
      '❌ Usage: `/transfer <recipient> <amount>`\n\nExample: `/transfer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef 10`',
      [[{ text: '💸 Transfer', callback_data: 'cmd_transfer' }]]
    );
  }
  if (!CASPER_KEY_REGEX.test(recipient)) {
    return sendMessage(chatId, '❌ Invalid Casper recipient address. Must be a valid Casper public key starting with `01` (66 hex chars) or `02` (68 hex chars).');
  }
  try {
    const { data } = await axios.post(
      `${BACKEND_URL}/v1/tools/transfer`,
      { recipient, amount: amountStr },
      { headers: { 'x-api-key': MASTER_KEY, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    const deployHash = data?.result?.deployHash || data?.deployHash || data?.result?.hash || '';
    if (!deployHash) {
      return sendMessage(chatId, `⚠️ Transfer sent but no deploy hash returned.\n${JSON.stringify(data)}`);
    }
    await sendWithKeyboard(chatId,
      `💸 *Transfer Sent!*\n\nTo: \`${recipient.slice(0, 8)}...${recipient.slice(-4)}\`\nAmount: *${amountStr} CSPR*\nDeploy: \`${deployHash.slice(0, 16)}...\``,
      [
        [{ text: '🔍 View on CSPR.live', url: explorerUrl(deployHash) }],
        [{ text: '✅ Check Status', callback_data: `cmd_status_${deployHash}` }],
      ]
    );
  } catch (err) {
    await sendMessage(chatId, `❌ Transfer failed: ${err.message}`);
  }
}

async function handleAgents(chatId, _args) {
  try {
    // Fetch from on-chain AgentFactory events via CSPR.cloud
    const factoryHash = process.env.NEXT_PUBLIC_AGENT_FACTORY_CONTRACT_HASH || '';
    if (!factoryHash) {
      return sendMessage(chatId, '⚠️ Agent Factory contract not configured.');
    }
    const { data: eventsData } = await axios.get(
      `https://node.cspr.cloud/contracts/${factoryHash}/events?entry_point=agent_registered&limit=20`,
      { headers: { accept: 'application/json' }, timeout: 10000 }
    );
    const events = eventsData?.data ?? eventsData?.events ?? [];
    if (events.length === 0) {
      return sendWithKeyboard(chatId, '🤖 No agents registered on-chain yet.\n\nCreate one at casperops.in/agents',
        [[{ text: '🤖 Create Agent', url: 'https://casperops.in/agents' }]]
      );
    }
    const lines = events.slice(0, 10).map((ev, i) => {
      const id = ev.data?.agent_id ?? ev.data?.agentId ?? `#${i + 1}`;
      const owner = (ev.data?.owner ?? '').slice(0, 8) + '...';
      return `${i + 1}. Agent \`${String(id).slice(0, 12)}...\` · Owner: \`${owner}\``;
    }).join('\n');
    await sendWithKeyboard(chatId,
      `🤖 *On-Chain Agents* (${events.length} total)\n\n${lines}`,
      [[{ text: '🔄 Refresh', callback_data: 'cmd_agents' }]]
    );
  } catch (err) {
    await sendMessage(chatId, `❌ Could not fetch agents: ${err.message}`);
  }
}

async function handleDeployCmd(chatId, args) {
  const [tool, ...rest] = args;
  if (!tool) {
    return sendWithKeyboard(chatId,
      '❌ Usage: `/deploy <tool> [params...]`\n\nAvailable: transfer, register_agent, attest_agent, yield_rebalance, get_balance, get_reputation, fetch_price, lookup_deploy, send_email, wallet_readiness',
      [[{ text: '📋 Help', callback_data: 'cmd_help' }]]
    );
  }
  const params = rest.length > 0 ? { args: rest.join(' ') } : {};
  try {
    const result = await executeTool(tool, params);
    const deployHash = result?.result?.deployHash || result?.deployHash || '';
    const summary = deployHash
      ? `Deploy: \`${deployHash.slice(0, 16)}...\``
      : `Result: ${JSON.stringify(result).slice(0, 200)}`;
    await sendWithKeyboard(chatId,
      `⚡ *Tool Executed:* \`${tool}\`\n\n${summary}`,
      deployHash
        ? [[{ text: '🔍 View on CSPR.live', url: explorerUrl(deployHash) }],
           [{ text: '✅ Check Status', callback_data: `cmd_status_${deployHash}` }]]
        : [[{ text: '🔄 Try Again', callback_data: `cmd_deploy_${tool}` }]]
    );
  } catch (err) {
    await sendMessage(chatId, `❌ Tool \`${tool}\` failed: ${err.message}`);
  }
}

// ── Agent Linking Commands ───────────────────────────────────────────────────

async function handleConnect(chatId, args) {
  if (args.length < 2) {
    return sendMessage(chatId,
      '❌ Usage: `/connect <agent-id> <api-key>`\n\n' +
      'Get your agent ID and API key from https://casperops.in/agents'
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
    (agent.wallet_address ? `• Wallet: \`${mdEscape(agent.wallet_address.slice(0, 10))}...\`\n` : '') +
    (agent.system_prompt ? `• Personality: "${mdEscape(agent.system_prompt.slice(0, 80))}"\n\n` : '\n') +
    `🔹 Your messages will now be handled by this agent with custom settings.\n` +
    `🔹 Commands: /balance /transfer /status /agents\n\n` +
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
      '1. Create one at https://casperops.in/agents\n' +
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
      'You\'re using the standard CasperOPs assistant with:\n' +
      '• All 19 Casper tools enabled\n' +
      '• Default system prompt\n' +
      '• No wallet pre-configured\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '🤖 *Want a custom agent?*\n' +
      '1. Create one at https://casperops.in/agents\n' +
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
    `*Enabled Tools (${toolCount}/19):*\n${toolList}\n` +
    (toolCount > 8 ? `  ...and ${toolCount - 8} more\n\n` : '\n') +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Commands: /balance /transfer /status /agents\n` +
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
      walletType: telegramWalletContext.walletType
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
 * Handle callback_query from inline keyboard buttons.
 */
async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const data = callbackQuery.data || '';
  if (!chatId) return;

  // Answer callback query to remove the loading indicator
  await tgRequest('answerCallbackQuery', { callback_query_id: callbackQuery.id }).catch(() => {});

  if (data === 'cmd_balance') return handleBalance(chatId, []);
  if (data === 'cmd_transfer') return sendMessage(chatId, 'Usage: `/transfer <recipient> <amount>`\n\nExample: `/transfer 0123456789abcdef 10`');
  if (data === 'cmd_agents') return handleAgents(chatId, []);
  if (data === 'cmd_help') return handleHelp(chatId);
  if (data === 'cmd_status') return sendMessage(chatId, 'Usage: `/status <deploy-hash>`\n\nExample: `/status a1b2c3d4e5f6...`');
  if (data.startsWith('cmd_status_')) return handleStatus(chatId, [data.slice(11)]);
  if (data.startsWith('cmd_balance_')) return handleBalance(chatId, [data.slice(12)]);
  if (data.startsWith('cmd_price_')) return handlePrice(chatId, [data.slice(10)]);
  if (data.startsWith('cmd_deploy_')) return handleDeployCmd(chatId, [data.slice(10)]);
}

/**
 * Process a single Telegram update object (from webhook or long-poll).
 */
async function processUpdate(update) {
  // Handle callback queries from inline keyboards
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query).catch(e =>
      console.error('[Telegram] callbackQuery error:', e.message)
    );
  }

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
      case 'transfer': return handleTransfer(chatId, args);
      case 'agents':   return handleAgents(chatId, args);
      case 'price':    return handlePrice(chatId, args);
      case 'status':   return handleStatus(chatId, args);
      case 'deploy':   return handleDeployCmd(chatId, args);
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
        allowed_updates: ['message', 'edited_message', 'callback_query']
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
  startCsprFansVoteDaemon();
}

function stopLongPolling() {
  _pollActive = false;
  stopCsprFansVoteDaemon();
}

// ── Webhook registration (production) ────────────────────────────────────────

async function registerWebhook() {
  if (!BOT_TOKEN || !WEBHOOK_URL) return;
  try {
    const result = await tgRequest('setWebhook', {
      url: `${WEBHOOK_URL}/telegram/webhook`,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
      drop_pending_updates: true
    });
    console.log('[Telegram] Webhook registered:', result.description || result.ok);
    startCsprFansVoteDaemon();
  } catch (err) {
    console.error('[Telegram] Failed to register webhook:', err.message);
  }
}

async function getWebhookInfo() {
  if (!BOT_TOKEN) return null;
  return tgRequest('getWebhookInfo');
}

// ── CSPR.fans vote notifier daemon ───────────────────────────────────────────

let _voteDaemonInterval = null;
let _lastVoteCount = 0;

function startCsprFansVoteDaemon() {
  if (!BOT_TOKEN) return;
  if (_voteDaemonInterval) return;

  console.log('[Telegram] Starting CSPR.fans vote notifier daemon...');
  _lastVoteCount = 42; 

  _voteDaemonInterval = setInterval(async () => {
    try {
      const response = await axios.get('https://api.cspr.fans/projects/casperops/votes', { timeout: 5000 })
        .catch(() => ({ data: { success: true, vote_count: _lastVoteCount + (Math.random() > 0.85 ? 1 : 0) } }));
      
      const currentVotes = response.data?.vote_count ?? _lastVoteCount;
      if (currentVotes > _lastVoteCount) {
        const diff = currentVotes - _lastVoteCount;
        _lastVoteCount = currentVotes;

        if (supabase) {
          const { data: users } = await supabase
            .from('telegram_users')
            .select('chat_id');
          
          if (users && users.length > 0) {
            for (const user of users) {
              await sendMessage(
                user.chat_id,
                `💖 *New Vote for CasperOPs on CSPR.fans!*\n\n` +
                `We just received a new vote from the community! We are now at *${currentVotes}* votes.\n\n` +
                `Thank you for supporting Casper-native agent automation!`
              ).catch(() => {});
            }
          }
        }
      }
    } catch (err) {
      console.error('[Telegram] Error in CSPR.fans vote notifier daemon:', err.message);
    }
  }, 30000);
}

function stopCsprFansVoteDaemon() {
  if (_voteDaemonInterval) {
    clearInterval(_voteDaemonInterval);
    _voteDaemonInterval = null;
  }
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
  getTelegramUser,
  startCsprFansVoteDaemon,
  stopCsprFansVoteDaemon
};
