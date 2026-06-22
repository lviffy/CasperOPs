/**
 * Agent Controller
 * 
 * Manages custom AI agents with API keys.
 * Each agent has:
 *   • Custom system prompt (personality)
 *   • Specific tool set (enabled_tools array)
 *   • Optional pre-configured wallet
 *   • API key for authentication
 * 
 * Users create agents via the web UI, then link them to Telegram
 * via /connect <agent-id> <api-key> command.
 */

const crypto = require('crypto');
const { ethers } = require('ethers');
const { getProvider, getWallet, getServerWallet } = require('../utils/blockchain');
const supabase = require('../config/supabase');
const {
  AGENT_LIST_SELECT,
  AGENT_LIST_SELECT_LEGACY,
  AGENT_REGISTRATION_SELECT,
  AGENT_REGISTRATION_SELECT_LEGACY,
  isMissingOnChainIdColumnError,
  getOnChainIdColumnMigrationMessage,
} = require('../utils/agentSchema');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Generate API key
// ─────────────────────────────────────────────────────────────────────────────

function generateApiKey() {
  const randomPart = crypto.randomBytes(32).toString('hex');
  return `bops_${randomPart}`;
}

function extractOnChainIdFromReceipt(receipt, identityAbi, identityAddress) {
  const logs = receipt?.logs || [];
  const identityAddressLower = identityAddress ? identityAddress.toLowerCase() : null;

  // First prefer pre-parsed logs returned by ethers for known ABI events.
  for (const log of logs) {
    if (log?.fragment?.name === 'AgentRegistered' && log?.args?.agentId != null) {
      return log.args.agentId.toString();
    }
  }

  // Fall back to manual parsing against the identity ABI.
  const identityInterface = new ethers.Interface(identityAbi);
  for (const log of logs) {
    try {
      const parsedLog = identityInterface.parseLog(log);
      if (parsedLog?.name === 'AgentRegistered' && parsedLog?.args?.agentId != null) {
        return parsedLog.args.agentId.toString();
      }
    } catch (e) {
      // Ignore unrelated logs.
    }
  }

  // Final fallback: parse ERC-721 mint Transfer(from=0x0) to recover tokenId.
  const transferInterface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
  ]);

  for (const log of logs) {
    if (identityAddressLower && log?.address?.toLowerCase() !== identityAddressLower) {
      continue;
    }

    try {
      const parsedTransfer = transferInterface.parseLog(log);
      if (parsedTransfer?.name !== 'Transfer') {
        continue;
      }

      const from = parsedTransfer?.args?.from;
      if (from && from.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
        const tokenId = parsedTransfer?.args?.tokenId;
        if (tokenId != null) {
          return tokenId.toString();
        }
      }
    } catch (e) {
      // Ignore unrelated logs.
    }
  }

  return null;
}

const ARBITRUM_CHAIN_ID = 421614;
const ARBITRUM_CHAIN = 'arbitrum-sepolia';
const ARBITRUM_NETWORK_NAME = 'Arbitrum Sepolia';
const DEFAULT_ARBITRUM_EXPLORER_BASE_URL = 'https://sepolia.arbiscan.io';

function buildTransactionExplorerUrl(txHash) {
  if (!txHash) return null;

  const explorerBaseUrl = (process.env.ARBITRUM_SEPOLIA_EXPLORER_URL || DEFAULT_ARBITRUM_EXPLORER_BASE_URL)
    .replace(/\/+$/, '');
  return `${explorerBaseUrl}/tx/${txHash}`;
}

function isMissingRelationError(error, relationName) {
  if (!error || !relationName) return false;
  const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  return text.includes(`relation "${String(relationName).toLowerCase()}"`) && text.includes('does not exist');
}

function toPlainObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function toTextArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return fallback;
}

async function findAgentRegistrationEventProof(provider, identityAddress, onChainId) {
  if (!provider || !identityAddress || onChainId == null) {
    return null;
  }

  try {
    const eventTopic = ethers.id('AgentRegistered(uint256,address,string)');
    const onChainIdTopic = ethers.zeroPadValue(ethers.toBeHex(BigInt(onChainId)), 32);
    const logs = await provider.getLogs({
      address: identityAddress,
      topics: [eventTopic, onChainIdTopic],
      fromBlock: 0,
      toBlock: 'latest',
    });

    if (!logs || logs.length === 0) {
      return null;
    }

    const latestLog = logs[logs.length - 1];
    return {
      transactionHash: latestLog.transactionHash || null,
      blockNumber: latestLog.blockNumber || null,
      logIndex: latestLog.index ?? latestLog.logIndex ?? null,
    };
  } catch (error) {
    console.warn('[Agent] Failed to recover AgentRegistered proof from logs:', error.message);
    return null;
  }
}

async function upsertAgentRegistryProof({
  agentId,
  agent,
  onChainId,
  identityAddress,
  transactionHash,
  blockNumber,
  logIndex,
  operatorWallet,
  agentURI,
}) {
  if (!supabase) {
    return { success: false, error: 'Supabase is not configured.' };
  }

  const { data: existingRegistry, error: existingError } = await supabase
    .from('agent_registry')
    .select('version, metadata, status, capabilities, supported_chains, metadata_cid, metadata_uri')
    .eq('agent_id', agentId)
    .maybeSingle();

  if (existingError) {
    if (isMissingRelationError(existingError, 'agent_registry')) {
      return {
        success: false,
        error: 'The agent_registry table is missing. Run backend/database/migrations/003_agent_registry_and_filecoin_audit.sql and retry.',
      };
    }

    return { success: false, error: existingError.message };
  }

  const nowIso = new Date().toISOString();
  const existingMetadata = toPlainObject(existingRegistry?.metadata);
  const existingProof = toPlainObject(existingMetadata.onChainRegistration);
  const proofTxHash = transactionHash || existingProof.transactionHash || null;
  const proofExplorerUrl = buildTransactionExplorerUrl(proofTxHash);

  const registrationProof = {
    standard: 'ERC-8004',
    chainId: ARBITRUM_CHAIN_ID,
    chain: ARBITRUM_CHAIN,
    network: ARBITRUM_NETWORK_NAME,
    identityRegistryAddress: identityAddress,
    onChainId: String(onChainId),
    transactionHash: proofTxHash,
    transactionExplorerUrl: proofExplorerUrl,
    blockNumber: blockNumber ?? existingProof.blockNumber ?? null,
    logIndex: logIndex ?? existingProof.logIndex ?? null,
    manifestUri: agentURI || existingProof.manifestUri || null,
    registeredAt: existingProof.registeredAt || nowIso,
    lastSyncedAt: nowIso,
  };

  const eip155IdentityRegistry = identityAddress
    ? `eip155:${ARBITRUM_CHAIN_ID}:${identityAddress}`
    : null;
  const eip155ReputationRegistry = process.env.REPUTATION_REGISTRY_ADDRESS
    ? `eip155:${ARBITRUM_CHAIN_ID}:${process.env.REPUTATION_REGISTRY_ADDRESS}`
    : null;
  const eip155ValidationRegistry = process.env.VALIDATION_REGISTRY_ADDRESS
    ? `eip155:${ARBITRUM_CHAIN_ID}:${process.env.VALIDATION_REGISTRY_ADDRESS}`
    : null;

  const metadata = {
    ...existingMetadata,
    erc8004: {
      identityRegistry: eip155IdentityRegistry,
      reputationRegistry: eip155ReputationRegistry,
      validationRegistry: eip155ValidationRegistry,
      agentId: String(onChainId),
      operatorWallet: operatorWallet || agent.wallet_address || null,
    },
    onChainRegistration: registrationProof,
  };

  const supportedChains = Array.from(new Set([
    ...toTextArray(existingRegistry?.supported_chains, []),
    ARBITRUM_CHAIN,
  ])).filter(Boolean);

  const capabilities = toTextArray(agent.enabled_tools, toTextArray(existingRegistry?.capabilities, []));

  const upsertPayload = {
    agent_id: agentId,
    user_id: agent.user_id,
    display_name: agent.name,
    description: agent.description || null,
    capabilities,
    supported_chains: supportedChains.length ? supportedChains : [ARBITRUM_CHAIN],
    metadata,
    status: existingRegistry?.status || 'active',
    version: (existingRegistry?.version || 0) + 1,
    metadata_cid: existingRegistry?.metadata_cid || null,
    metadata_uri: existingRegistry?.metadata_uri || null,
    updated_at: nowIso,
  };

  const { data: savedRegistry, error: upsertError } = await supabase
    .from('agent_registry')
    .upsert(upsertPayload, { onConflict: 'agent_id' })
    .select('version, metadata')
    .single();

  if (upsertError) {
    return { success: false, error: upsertError.message };
  }

  return {
    success: true,
    version: savedRegistry?.version || upsertPayload.version,
    proof: toPlainObject(savedRegistry?.metadata).onChainRegistration || registrationProof,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /agents — Create a new agent
// ─────────────────────────────────────────────────────────────────────────────

async function createAgent(req, res) {
  try {
    const { 
      userId,           // owner ID (from auth or request)
      name, 
      description, 
      systemPrompt, 
      tools,
      enabledTools,     // array of tool names
      walletAddress,
      avatarUrl,
      status = 'active',
      isPublic = false
    } = req.body;

    if (!userId || !name) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: userId, name' 
      });
    }

    // Generate API key
    const rawApiKey = generateApiKey();
    // SHA-256 hash for authentication lookup (matches apiKeyAuth.js)
    const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const apiKeyPrefix = rawApiKey.slice(0, 12) + '...';
    
    const workflowTools = Array.isArray(tools) ? tools : [];
    const normalizedEnabledTools = Array.isArray(enabledTools)
      ? enabledTools
      : workflowTools.map((tool) => tool.tool).filter(Boolean);

    // Insert into database
    const { data, error } = await supabase
      .from('agents')
      .insert({
        user_id: userId,
        name,
        description: description || null,
        system_prompt: systemPrompt || null,
        enabled_tools: normalizedEnabledTools.length > 0 ? normalizedEnabledTools : null,
        wallet_address: walletAddress || null,
        api_key: rawApiKey,
        tools: workflowTools,
        status,
        api_key_hash: apiKeyHash,
        api_key_prefix: apiKeyPrefix,
        avatar_url: avatarUrl || null,
        is_public: isPublic
      })
      .select()
      .single();

    if (error) {
      console.error('[Agent] Create error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    // Also register the key in agent_api_keys for unified auth (apiKeyAuth.js uses this table)
    try {
      await supabase
        .from('agent_api_keys')
        .insert({
          agent_id: data.id,
          user_id: userId,
          key_hash: apiKeyHash,
          label: `Key for ${name}`,
          is_active: true
        });
    } catch (keyErr) {
      console.error('[Agent] Failed to register API key in agent_api_keys:', keyErr);
      // We don't fail the whole request because the agent was created in 'agents' table
    }

    return res.json({
      success: true,
      agent: {
        id: data.id,
        userId: data.user_id,
        name: data.name,
        description: data.description,
        api_key: data.api_key,
        tools: data.tools || [],
        status: data.status,
        systemPrompt: data.system_prompt,
        enabledTools: data.enabled_tools,
        walletAddress: data.wallet_address,
        apiKey: rawApiKey,  // ⚠️ ONLY shown once
        apiKeyPrefix: data.api_key_prefix,
        createdAt: data.created_at,
        created_at: data.created_at,
        updated_at: data.updated_at
      },
      warning: 'Save this API key now. You won\'t be able to see it again.'
    });

  } catch (err) {
    console.error('[Agent] Create error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /agents — List all agents for a user
// ─────────────────────────────────────────────────────────────────────────────

async function listAgents(req, res) {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing userId parameter' 
      });
    }

    const buildListAgentsQuery = (selectColumns) => (
      supabase
        .from('agents')
        .select(selectColumns)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
    );

    let { data, error } = await buildListAgentsQuery(AGENT_LIST_SELECT);

    if (isMissingOnChainIdColumnError(error)) {
      console.warn('[Agent] agents.on_chain_id is missing; falling back to legacy list query.');
      ({ data, error } = await buildListAgentsQuery(AGENT_LIST_SELECT_LEGACY));
    }

    if (error) {
      console.error('[Agent] List error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    // Check if any agents are linked to Telegram
    const agentIds = (data || []).map(a => a.id);
    let linkedMap = {};
    
    if (agentIds.length > 0) {
      const { data: telegramLinks } = await supabase
        .from('telegram_users')
        .select('linked_agent_id, chat_id')
        .in('linked_agent_id', agentIds)
        .not('linked_agent_id', 'is', null);
      
      if (telegramLinks) {
        telegramLinks.forEach(link => {
          linkedMap[link.linked_agent_id] = link.chat_id;
        });
      }
    }

    // Enrich agent list with Telegram status
    const agents = data.map(agent => ({
      id: agent.id,
      user_id: agent.user_id,
      name: agent.name,
      description: agent.description,
      api_key: agent.api_key,
      tools: agent.tools || [],
      status: agent.status || 'active',
      system_prompt: agent.system_prompt,
      enabled_tools: agent.enabled_tools,
      wallet_address: agent.wallet_address,
      on_chain_id: agent.on_chain_id || null,
      api_key_prefix: agent.api_key_prefix,
      is_public: agent.is_public,
      created_at: agent.created_at,
      updated_at: agent.updated_at,
      linkedToTelegram: !!linkedMap[agent.id],
      telegramChatId: linkedMap[agent.id] || null
    }));

    return res.json({ success: true, agents });

  } catch (err) {
    console.error('[Agent] List error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /agents/:id — Get single agent details
// ─────────────────────────────────────────────────────────────────────────────

async function getAgent(req, res) {
  try {
    const { id } = req.params;
    const { userId } = req.query; // verify ownership

    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    // Verify ownership (optional: skip if public agent)
    if (userId && data.user_id !== userId && !data.is_public) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Check Telegram link status
    const { data: telegramLink } = await supabase
      .from('telegram_users')
      .select('chat_id, linked_at')
      .eq('linked_agent_id', id)
      .single();

    return res.json({
      success: true,
      agent: {
        id: data.id,
        user_id: data.user_id,
        name: data.name,
        description: data.description,
        api_key: data.api_key,
        tools: data.tools || [],
        status: data.status || 'active',
        systemPrompt: data.system_prompt,
        enabledTools: data.enabled_tools,
        walletAddress: data.wallet_address,
        apiKeyPrefix: data.api_key_prefix,
        avatarUrl: data.avatar_url,
        isPublic: data.is_public,
        linkedToTelegram: !!telegramLink,
        telegramChatId: telegramLink?.chat_id || null,
        linkedAt: telegramLink?.linked_at || null,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      }
    });

  } catch (err) {
    console.error('[Agent] Get error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /agents/:id — Update agent config
// ─────────────────────────────────────────────────────────────────────────────

async function updateAgent(req, res) {
  try {
    const { id } = req.params;
    const { userId, name, description, systemPrompt, tools, enabledTools, walletAddress, avatarUrl, status, isPublic } = req.body;

    // Verify ownership
    const { data: agent } = await supabase
      .from('agents')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (userId && agent.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Build update object (only update provided fields)
    const updates = { updated_at: new Date().toISOString() };
    const workflowTools = Array.isArray(tools) ? tools : undefined;
    const normalizedEnabledTools = Array.isArray(enabledTools)
      ? enabledTools
      : workflowTools
        ? workflowTools.map((tool) => tool.tool).filter(Boolean)
        : undefined;
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (systemPrompt !== undefined) updates.system_prompt = systemPrompt;
    if (workflowTools !== undefined) updates.tools = workflowTools;
    if (normalizedEnabledTools !== undefined) updates.enabled_tools = normalizedEnabledTools;
    if (walletAddress !== undefined) updates.wallet_address = walletAddress;
    if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;
    if (status !== undefined) updates.status = status;
    if (isPublic !== undefined) updates.is_public = isPublic;

    const { data, error } = await supabase
      .from('agents')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[Agent] Update error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.json({
      success: true,
      agent: {
        id: data.id,
        user_id: data.user_id,
        name: data.name,
        description: data.description,
        api_key: data.api_key,
        tools: data.tools || [],
        status: data.status || 'active',
        systemPrompt: data.system_prompt,
        enabledTools: data.enabled_tools,
        walletAddress: data.wallet_address,
        updatedAt: data.updated_at,
        created_at: data.created_at,
        updated_at: data.updated_at
      }
    });

  } catch (err) {
    console.error('[Agent] Update error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /agents/:id/regenerate-key — Regenerate API key
// ─────────────────────────────────────────────────────────────────────────────

async function regenerateApiKey(req, res) {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    // Verify ownership
    const { data: agent } = await supabase
      .from('agents')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (userId && agent.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Generate new API key
    const newApiKey = generateApiKey();
    // SHA-256 hash for authentication lookup (matches apiKeyAuth.js)
    const newApiKeyHash = crypto.createHash('sha256').update(newApiKey).digest('hex');
    const newApiKeyPrefix = newApiKey.slice(0, 12) + '...';

    // Update database
    const { error } = await supabase
      .from('agents')
      .update({
        api_key: newApiKey,
        api_key_hash: newApiKeyHash,
        api_key_prefix: newApiKeyPrefix,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      console.error('[Agent] Regenerate key error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    // Update agent_api_keys table (revoke old keys, add new one)
    try {
      // 1. Deactivate all existing keys for this agent
      await supabase
        .from('agent_api_keys')
        .update({ is_active: false })
        .eq('agent_id', id);

      // 2. Insert the new key
      await supabase
        .from('agent_api_keys')
        .insert({
          agent_id: id,
          user_id: agent.user_id,
          key_hash: newApiKeyHash,
          label: `Regenerated Key at ${new Date().toISOString()}`,
          is_active: true
        });
    } catch (keyErr) {
      console.error('[Agent] Failed to update agent_api_keys during regeneration:', keyErr);
    }

    // Also update any linked Telegram users (so old hash is invalidated)
    await supabase
      .from('telegram_users')
      .update({ agent_api_key_hash: newApiKeyHash })
      .eq('linked_agent_id', id);

    return res.json({
      success: true,
      apiKey: newApiKey,  // ⚠️ ONLY shown once
      apiKeyPrefix: newApiKeyPrefix,
      warning: 'Old API key has been revoked. Update all integrations (Telegram, etc.)'
    });

  } catch (err) {
    console.error('[Agent] Regenerate key error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /agents/:id/register-on-chain — Register agent in ERC-8004 Registry
// ─────────────────────────────────────────────────────────────────────────────

async function registerAgentOnChain(req, res) {
  try {
    const { id } = req.params;
    const { userId, privateKey } = req.body;

    // Verify ownership
    const buildRegistrationQuery = (selectColumns) => (
      supabase
        .from('agents')
        .select(selectColumns)
        .eq('id', id)
        .single()
    );

    let onChainIdColumnAvailable = true;
    let { data: agent, error: agentError } = await buildRegistrationQuery(AGENT_REGISTRATION_SELECT);

    if (isMissingOnChainIdColumnError(agentError)) {
      onChainIdColumnAvailable = false;
      console.warn('[Agent] agents.on_chain_id is missing; blocking on-chain registration until migration is applied.');
      ({ data: agent, error: agentError } = await buildRegistrationQuery(AGENT_REGISTRATION_SELECT_LEGACY));
    }

    if (agentError || !agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (userId && agent.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!onChainIdColumnAvailable) {
      return res.status(500).json({
        success: false,
        error: getOnChainIdColumnMigrationMessage(),
      });
    }

    // ERC-8004 registries are deployed on Arbitrum Sepolia.
    const provider = getProvider(ARBITRUM_CHAIN);

    const identityAddr = process.env.IDENTITY_REGISTRY_ADDRESS;
    if (!identityAddr) {
      return res.status(500).json({ success: false, error: 'Identity Registry address not configured' });
    }

    const agentURI = `https://blockops.in/api/v1/agents/${id}/manifest`;

    if (agent.on_chain_id) {
      const recoveredProof = await findAgentRegistrationEventProof(provider, identityAddr, agent.on_chain_id);
      const registrySync = await upsertAgentRegistryProof({
        agentId: id,
        agent,
        onChainId: agent.on_chain_id,
        identityAddress: identityAddr,
        transactionHash: recoveredProof?.transactionHash || null,
        blockNumber: recoveredProof?.blockNumber || null,
        logIndex: recoveredProof?.logIndex || null,
        operatorWallet: agent.wallet_address || null,
        agentURI,
      });

      if (!registrySync.success) {
        return res.status(500).json({
          success: false,
          error: `Agent is already registered on-chain, but registry proof sync failed: ${registrySync.error}`,
          onChainId: agent.on_chain_id,
          transactionHash: recoveredProof?.transactionHash || null,
          explorerUrl: buildTransactionExplorerUrl(recoveredProof?.transactionHash || null),
        });
      }

      return res.json({
        success: true,
        alreadyRegistered: true,
        onChainId: agent.on_chain_id,
        transactionHash: recoveredProof?.transactionHash || registrySync.proof?.transactionHash || null,
        explorerUrl: buildTransactionExplorerUrl(recoveredProof?.transactionHash || registrySync.proof?.transactionHash || null),
        registryVersion: registrySync.version,
        registryProof: registrySync.proof,
        message: 'Agent already registered on-chain. Registry proof synchronized for verification.',
      });
    }

    let wallet = null;

    try {
      wallet = privateKey
        ? getWallet(privateKey, provider)
        : getServerWallet(provider);
    } catch (walletError) {
      const errorMessage = privateKey
        ? 'The provided private key is invalid. Please re-save your wallet key and try again.'
        : 'SERVER_SIGNER_PRIVATE_KEY is configured incorrectly in backend/.env. Update it to a valid 32-byte hex private key and restart the backend.';

      return res.status(400).json({ success: false, error: errorMessage });
    }

    if (!wallet) {
      return res.status(400).json({
        success: false,
        error: 'No signer available for on-chain registration. Add your private key in the app, or set SERVER_SIGNER_PRIVATE_KEY in backend/.env and restart the backend.',
      });
    }

    const identityCode = await provider.getCode(identityAddr);
    if (!identityCode || identityCode === '0x') {
      return res.status(500).json({
        success: false,
        error: 'Identity Registry contract is not deployed on Arbitrum Sepolia at the configured IDENTITY_REGISTRY_ADDRESS. Fix backend/.env and retry.',
      });
    }

    const IDENTITY_ABI = [
      "function registerAgent(address owner, string memory agentURI) public returns (uint256)",
      "event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI)",
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
    ];

    console.log(`[Agent] Registering ${agent.name} (${id}) on-chain...`);
    const identityContract = new ethers.Contract(identityAddr, IDENTITY_ABI, wallet);
    
    const tx = await identityContract.registerAgent(wallet.address, agentURI);
    const receipt = await tx.wait();

    const onChainId = extractOnChainIdFromReceipt(receipt, IDENTITY_ABI, identityAddr);

    if (!onChainId) {
      console.error('[Agent] Failed to extract on-chain agent ID from receipt logs', {
        txHash: receipt.hash,
        logCount: receipt.logs?.length || 0,
      });

      return res.status(500).json({
        success: false,
        error: 'Agent transaction was mined, but backend could not decode the agent ID from logs. Please retry once; if it persists, use the transaction hash for recovery.',
        transactionHash: receipt.hash,
      });
    }

    // Save to Supabase
    const { error: updateError } = await supabase
      .from('agents')
      .update({ on_chain_id: onChainId })
      .eq('id', id);

    if (updateError) {
      console.error('[Agent] Failed to persist on-chain ID:', updateError);

      const errorMessage = isMissingOnChainIdColumnError(updateError)
        ? `${getOnChainIdColumnMigrationMessage()} The agent was registered on-chain as ${onChainId}, but the ID could not be saved locally.`
        : `Agent registered on-chain as ${onChainId}, but failed to save the ID locally: ${updateError.message}`;

      return res.status(500).json({
        success: false,
        error: errorMessage,
        onChainId,
        transactionHash: receipt.hash,
      });
    }

    const registrySync = await upsertAgentRegistryProof({
      agentId: id,
      agent,
      onChainId,
      identityAddress: identityAddr,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber || null,
      logIndex: null,
      operatorWallet: wallet.address,
      agentURI,
    });

    if (!registrySync.success) {
      return res.status(500).json({
        success: false,
        error: `Agent registered on-chain and saved locally, but failed to write registry proof: ${registrySync.error}`,
        onChainId,
        transactionHash: receipt.hash,
        explorerUrl: buildTransactionExplorerUrl(receipt.hash),
      });
    }

    return res.json({
      success: true,
      onChainId,
      transactionHash: receipt.hash,
      explorerUrl: buildTransactionExplorerUrl(receipt.hash),
      registryVersion: registrySync.version,
      registryProof: registrySync.proof,
      message: `Agent registered on-chain with ID ${onChainId}`
    });

  } catch (err) {
    console.error('[Agent] On-chain registration error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /agents/:id — Delete an agent
// ─────────────────────────────────────────────────────────────────────────────

async function deleteAgent(req, res) {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    // Verify ownership
    const { data: agent } = await supabase
      .from('agents')
      .select('user_id, name')
      .eq('id', id)
      .single();

    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (userId && agent.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Unlink from any Telegram chats (foreign key ON DELETE SET NULL will handle this automatically)
    // But we'll explicitly clear for logging
    const { data: linkedChats } = await supabase
      .from('telegram_users')
      .select('chat_id')
      .eq('linked_agent_id', id);

    // Delete agent
    const { error } = await supabase
      .from('agents')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[Agent] Delete error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.json({
      success: true,
      message: `Agent "${agent.name}" deleted`,
      unlinkedChats: linkedChats?.length || 0
    });

  } catch (err) {
    console.error('[Agent] Delete error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get agent by ID (internal, used by telegramService)
// ─────────────────────────────────────────────────────────────────────────────

async function getAgentById(agentId) {
  try {
    const { data } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();
    return data;
  } catch (err) {
    console.error('[Agent] getAgentById error:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Verify API key (used during Telegram /connect)
// ─────────────────────────────────────────────────────────────────────────────

async function verifyApiKey(agentId, apiKey) {
  try {
    const { data } = await supabase
      .from('agents')
      .select('api_key_hash')
      .eq('id', agentId)
      .single();

    if (!data) return false;

    const hashedApiKey = crypto.createHash('sha256').update(apiKey).digest('hex');
    return hashedApiKey === data.api_key_hash;
  } catch (err) {
    console.error('[Agent] verifyApiKey error:', err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /agents/:id/manifest — Get agent manifest (ERC-8004)
// ─────────────────────────────────────────────────────────────────────────────

async function getAgentManifest(req, res) {
  try {
    const { id } = req.params;

    const { data: agent, error } = await supabase
      .from('agents')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    let registryProof = null;
    let registryMetadata = null;

    try {
      const { data: registryRow, error: registryError } = await supabase
        .from('agent_registry')
        .select('metadata, metadata_cid, metadata_uri, version, updated_at')
        .eq('agent_id', id)
        .maybeSingle();

      if (registryError && !isMissingRelationError(registryError, 'agent_registry')) {
        console.warn('[Agent] Registry lookup for manifest failed:', registryError.message);
      }

      if (registryRow) {
        const metadata = toPlainObject(registryRow.metadata);
        registryProof = toPlainObject(metadata.onChainRegistration);
        registryMetadata = {
          version: registryRow.version,
          metadataCid: registryRow.metadata_cid,
          metadataUri: registryRow.metadata_uri,
          updatedAt: registryRow.updated_at,
        };
      }
    } catch (registryLookupError) {
      console.warn('[Agent] Registry lookup for manifest failed:', registryLookupError.message);
    }

    // Standard ERC-8004 Agent Manifest
    const manifest = {
      name: agent.name,
      version: "1.0.0",
      description: agent.description,
      author: "BlockOps",
      erc8004: {
        identityRegistry: `eip155:421614:${process.env.IDENTITY_REGISTRY_ADDRESS || '0x734C984AE7d64aa917D9D2e4B9C08A0CD6C0589B'}`,
        reputationRegistry: `eip155:421614:${process.env.REPUTATION_REGISTRY_ADDRESS || '0xa497e1BFe08109D60A8F91AdEc868ffdD1e0055c'}`,
        validationRegistry: `eip155:421614:${process.env.VALIDATION_REGISTRY_ADDRESS || '0xFab8731b8d1a978e78086179dC5494F0dbA1f6bE'}`,
        agentId: agent.on_chain_id || "unregistered",
        operatorWallet: agent.wallet_address || "0x0000000000000000000000000000000000000000"
      },
      capabilities: agent.enabled_tools || [],
      trustModel: ["reputation", "crypto-economic"],
      paymentProtocol: "x402",
      chain: {
        name: "Arbitrum Sepolia",
        chainId: 421614
      },
      metadata: {
        avatarUrl: agent.avatar_url,
        createdAt: agent.created_at,
        updatedAt: agent.updated_at,
        registry: registryMetadata,
        registrationProof: registryProof,
      }
    };

    if (registryProof && registryProof.transactionHash) {
      manifest.erc8004.registrationProof = {
        transactionHash: registryProof.transactionHash,
        transactionExplorerUrl: registryProof.transactionExplorerUrl || buildTransactionExplorerUrl(registryProof.transactionHash),
        blockNumber: registryProof.blockNumber || null,
        registeredAt: registryProof.registeredAt || null,
      };
    }

    return res.json(manifest);

  } catch (err) {
    console.error('[Agent] Manifest error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  regenerateApiKey,
  deleteAgent,
  getAgentById,
  verifyApiKey,
  registerAgentOnChain,
  getAgentManifest
};
