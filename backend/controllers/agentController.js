/**
 * Agent Controller
 *
 * Manages custom AI agents in Supabase.
 * Each agent has:
 *   - Custom system prompt (personality)
 *   - Specific tool set (enabled_tools array)
 *   - Optional pre-configured Casper public key
 *   - API key for authentication
 *
 * Users create agents via the web UI, then link them to Telegram
 * via /connect <agent-id> <api-key> command.
 *
 * Phase 23: the legacy EVM `registerAgentOnChain` flow (ERC-8004 Identity
 * Registry on Arbitrum Sepolia) has been removed. Agents are now anchored
 * on the Casper AgentFactory contract via `register_agent`, surfaced
 * through the tool router (`/v1/tools/:toolId`). The manifest endpoint
 * still exists but returns a Casper-shaped document.
 */

const crypto = require('crypto');
const supabase = require('../config/supabase');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Generate API key
// ─────────────────────────────────────────────────────────────────────────────

function generateApiKey() {
  const randomPart = crypto.randomBytes(32).toString('hex');
  return `bops_${randomPart}`;
}

function isMissingRelationError(error, relationName) {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  const code = String(error.code || '');
  return code === '42p01'
    || message.includes(`relation "${relationName}" does not exist`)
    || message.includes(`relation '${relationName}' does not exist`)
    || message.includes(`could not find the table '${relationName}'`);
}

function toPlainObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => toPlainObject(v));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = (v && typeof v === 'object') ? toPlainObject(v) : v;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /agents — Create a new agent
// ─────────────────────────────────────────────────────────────────────────────

async function createAgent(req, res) {
  try {
    const {
      userId,
      name,
      description,
      systemPrompt,
      tools,
      enabledTools,
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

    const rawApiKey = generateApiKey();
    const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const apiKeyPrefix = rawApiKey.slice(0, 12) + '...';

    const workflowTools = Array.isArray(tools) ? tools : [];
    const normalizedEnabledTools = Array.isArray(enabledTools)
      ? enabledTools
      : workflowTools.map((tool) => tool.tool).filter(Boolean);

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

    return res.status(201).json({
      success: true,
      agent: data,
      apiKey: rawApiKey,
      apiKeyPrefix,
      warning: 'Save the apiKey — it is shown only once.'
    });
  } catch (err) {
    console.error('[Agent] Create error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /agents — List agents
// ─────────────────────────────────────────────────────────────────────────────

async function listAgents(req, res) {
  try {
    const { userId } = req.query;

    let query = supabase.from('agents').select('*');
    if (userId) query = query.eq('user_id', userId);
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.json({ success: true, agents: data || [] });
  } catch (err) {
    console.error('[Agent] List error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /agents/:id — Get one agent
// ─────────────────────────────────────────────────────────────────────────────

async function getAgent(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    return res.json({ success: true, agent: data });
  } catch (err) {
    console.error('[Agent] Get error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /agents/:id — Update agent
// ─────────────────────────────────────────────────────────────────────────────

async function updateAgent(req, res) {
  try {
    const { id } = req.params;
    const update = {};
    const fields = ['name', 'description', 'system_prompt', 'enabled_tools',
                    'wallet_address', 'status', 'is_public', 'avatar_url', 'tools'];
    for (const f of fields) {
      if (f in req.body) update[f] = req.body[f];
    }

    const { data, error } = await supabase
      .from('agents')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    if (!data) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    return res.json({ success: true, agent: data });
  } catch (err) {
    console.error('[Agent] Update error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /agents/:id/regenerate-key
// ─────────────────────────────────────────────────────────────────────────────

async function regenerateApiKey(req, res) {
  try {
    const { id } = req.params;
    const rawApiKey = generateApiKey();
    const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const apiKeyPrefix = rawApiKey.slice(0, 12) + '...';

    const { data, error } = await supabase
      .from('agents')
      .update({
        api_key: rawApiKey,
        api_key_hash: apiKeyHash,
        api_key_prefix: apiKeyPrefix,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    if (!data) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    return res.json({
      success: true,
      apiKey: rawApiKey,
      apiKeyPrefix,
      warning: 'Save the apiKey — it is shown only once.'
    });
  } catch (err) {
    console.error('[Agent] Regenerate key error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /agents/:id
// ─────────────────────────────────────────────────────────────────────────────

async function deleteAgent(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('agents').delete().eq('id', id);
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    return res.json({ success: true, message: 'Agent deleted' });
  } catch (err) {
    console.error('[Agent] Delete error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers (used by telegramService + middleware)
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
// GET /agents/:id/manifest — Casper-flavored agent manifest
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

    const casperHashes = {
      agentFactory: process.env.CASPER_AGENT_FACTORY_HASH || null,
      reputation: process.env.CASPER_REPUTATION_HASH || null,
      compliance: process.env.CASPER_COMPLIANCE_HASH || null,
    };

    return res.json({
      success: true,
      manifest: {
        name: agent.name,
        version: '1.0.0',
        description: agent.description,
        author: 'CasperOPs',
        casper: {
          agentFactory: casperHashes.agentFactory,
          reputation: casperHashes.reputation,
          compliance: casperHashes.compliance,
          operatorPublicKey: agent.wallet_address || null,
        },
        capabilities: agent.enabled_tools || [],
        paymentProtocol: 'x402',
        chain: {
          name: 'Casper Testnet',
          chainId: 'casper-test',
        },
        metadata: {
          avatarUrl: agent.avatar_url,
          createdAt: agent.created_at,
          updatedAt: agent.updated_at,
          registry: registryMetadata,
        },
      },
    });
  } catch (err) {
    console.error('[Agent] Manifest error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /agents/:id/register-on-chain — removed (Phase 23).
// Casper agents are anchored via the tool router's `register_agent` entry
// point against the AgentFactory contract. This route returns 410 Gone so
// any stale clients see a clear signal.
// ─────────────────────────────────────────────────────────────────────────────

async function registerAgentOnChain(req, res) {
  try {
    const { id } = req.params;
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', id)
      .single();

    if (agentError || !agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const { signerPublicKey } = req.body || {};
    const agentAddress = agent.wallet_address || signerPublicKey;

    if (!agentAddress) {
      return res.status(400).json({
        success: false,
        error: 'Agent does not have a wallet address. Please connect your Casper wallet first.'
      });
    }

    const { register_agent } = require('../services/directToolExecutor');
    const result = await register_agent({ agentAddress });

    if (!result || !result.success) {
      return res.status(400).json({
        success: false,
        error: result?.error || 'Failed to register agent on-chain against the AgentFactory contract.'
      });
    }

    const updateData = { on_chain_id: agentAddress };
    if (!agent.wallet_address) {
      updateData.wallet_address = agentAddress;
    }

    const { error: updateError } = await supabase
      .from('agents')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: `Agent registered on-chain (Tx: ${result.deployHash}), but database update failed: ${updateError.message}`
      });
    }

    // Automatically upsert default agent registry record with on-chain registration proof
    const registryPayload = {
      onChainRegistration: {
        transactionHash: result.deployHash,
        transactionExplorerUrl: `${process.env.CASPER_EXPLORER_URL || 'https://testnet.cspr.live'}/deploy/${result.deployHash}`,
        registeredAt: new Date().toISOString(),
      }
    };

    await supabase
      .from('agent_registry')
      .upsert({
        agent_id: id,
        user_id: agent.user_id,
        display_name: agent.name,
        description: agent.description,
        capabilities: agent.enabled_tools || [],
        supported_chains: ['casper-testnet'],
        metadata: registryPayload,
        status: 'active',
        version: 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent_id' });

    return res.json({
      success: true,
      onChainId: agentAddress,
      transactionHash: result.deployHash
    });
  } catch (err) {
    console.error('[Agent] On-chain registration error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getAgentReputation(req, res) {
  try {
    const { onChainId } = req.params;
    if (!onChainId) {
      return res.status(400).json({ success: false, error: 'onChainId is required' });
    }

    const { get_reputation } = require('../services/directToolExecutor');
    const result = await get_reputation({ agentAddress: onChainId });

    if (!result || !result.success) {
      return res.status(400).json({
        success: false,
        error: result?.error || 'Failed to fetch agent reputation from contract.'
      });
    }

    return res.json({
      success: true,
      rating: result.rating,
      score: result.rating,
      averageScore: result.rating,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  } catch (err) {
    console.error('[Agent] getAgentReputation error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  regenerateApiKey,
  registerAgentOnChain,
  deleteAgent,
  getAgentManifest,
  getAgentById,
  verifyApiKey,
  getAgentReputation,
};
