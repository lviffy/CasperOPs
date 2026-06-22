const supabase = require('../config/supabase');
const {
  archiveJsonToFilecoin,
  parsePieceCidFromUri,
  retrieveJsonFromFilecoin
} = require('../services/filecoinStorageService');

function toArray(value, fallback = []) {
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

function clampLimit(value, defaultValue = 20, maxValue = 100) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(parsed, maxValue);
}

function normalizeStatus(status) {
  const normalized = String(status || 'active').trim().toLowerCase();
  const allowedStatuses = new Set(['active', 'inactive', 'deprecated']);
  if (allowedStatuses.has(normalized)) {
    return normalized;
  }
  return 'active';
}

function normalizeRegistryRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    displayName: row.display_name,
    description: row.description,
    capabilities: row.capabilities || [],
    supportedChains: row.supported_chains || [],
    metadata: row.metadata || {},
    status: row.status,
    version: row.version,
    metadataCid: row.metadata_cid,
    metadataUri: row.metadata_uri,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadAgent(agentId) {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('agents')
    .select('id, user_id, name, description, enabled_tools, wallet_address, avatar_url, status, is_public, on_chain_id')
    .eq('id', agentId)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

function ensureSupabase(res) {
  if (supabase) {
    return true;
  }

  res.status(503).json({
    success: false,
    error: 'Agent registry requires Supabase configuration'
  });
  return false;
}

function canReadRegistry(agent, userId) {
  if (!agent) {
    return false;
  }

  if (agent.is_public) {
    return true;
  }

  // On-chain registered agents are publicly verifiable by design.
  if (agent.on_chain_id) {
    return true;
  }

  if (!userId) {
    return false;
  }

  return agent.user_id === userId;
}

// PUT /agents/:id/registry
async function upsertAgentRegistry(req, res) {
  if (!ensureSupabase(res)) {
    return;
  }

  try {
    const { id: agentId } = req.params;
    const {
      userId,
      displayName,
      description,
      capabilities,
      supportedChains,
      chains,
      metadata,
      status,
      walletAddress,
      avatarUrl
    } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing required field: userId' });
    }

    const agent = await loadAgent(agentId);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (agent.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { data: existingRow } = await supabase
      .from('agent_registry')
      .select('id, version, metadata_cid, metadata_uri')
      .eq('agent_id', agentId)
      .maybeSingle();

    const normalizedCapabilities = toArray(capabilities, agent.enabled_tools || []);
    const normalizedChains = toArray(
      supportedChains || chains,
      ['arbitrum-sepolia', 'filecoin-mainnet']
    );

    const metadataObject =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};

    const nextVersion = (existingRow?.version || 0) + 1;
    const normalizedDisplayName = String(displayName || agent.name || '').trim();
    const normalizedDescription =
      description !== undefined ? String(description || '') : agent.description || null;
    const normalizedStatus = normalizeStatus(status || agent.status || 'active');

    const registryPayload = {
      schemaVersion: '1.0',
      recordType: 'agent_registry',
      timestamp: new Date().toISOString(),
      agentId,
      userId,
      profile: {
        name: normalizedDisplayName,
        description: normalizedDescription,
        walletAddress: walletAddress || agent.wallet_address || null,
        avatarUrl: avatarUrl || agent.avatar_url || null,
        capabilities: normalizedCapabilities,
        supportedChains: normalizedChains,
        status: normalizedStatus,
        isPublic: Boolean(agent.is_public)
      },
      metadata: metadataObject,
      version: nextVersion
    };

    const filecoin = await archiveJsonToFilecoin(registryPayload, {
      namespace: 'blockops-agent-registry',
      name: `agent-registry-${agentId}-v${nextVersion}`,
      metadata: { agentId, userId }
    });
    const metadataCid = filecoin?.pieceCid || filecoin?.cid || null;

    const upsertPayload = {
      agent_id: agentId,
      user_id: userId,
      display_name: normalizedDisplayName,
      description: normalizedDescription,
      capabilities: normalizedCapabilities,
      supported_chains: normalizedChains,
      metadata: metadataObject,
      status: normalizedStatus,
      version: nextVersion,
      metadata_cid: metadataCid || existingRow?.metadata_cid || null,
      metadata_uri: filecoin.uri || existingRow?.metadata_uri || null,
      updated_at: new Date().toISOString()
    };

    const { data: savedRegistry, error: saveError } = await supabase
      .from('agent_registry')
      .upsert(upsertPayload, { onConflict: 'agent_id' })
      .select()
      .single();

    if (saveError) {
      console.error('[AgentRegistry] Upsert error:', saveError);
      return res.status(500).json({ success: false, error: saveError.message });
    }

    return res.json({
      success: true,
      registry: normalizeRegistryRow(savedRegistry),
      filecoin: {
        status: filecoin.status,
        provider: filecoin.provider,
        cid: metadataCid,
        pieceCid: filecoin.pieceCid || null,
        uri: filecoin.uri || null,
        error: filecoin.error || null
      }
    });
  } catch (error) {
    console.error('[AgentRegistry] Upsert error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// GET /agents/:id/registry
async function getAgentRegistry(req, res) {
  if (!ensureSupabase(res)) {
    return;
  }

  try {
    const { id: agentId } = req.params;
    const { userId } = req.query;

    const agent = await loadAgent(agentId);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (!canReadRegistry(agent, userId)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { data, error } = await supabase
      .from('agent_registry')
      .select('*')
      .eq('agent_id', agentId)
      .maybeSingle();

    if (error) {
      console.error('[AgentRegistry] Read error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Registry entry not found' });
    }

    return res.json({
      success: true,
      registry: normalizeRegistryRow(data)
    });
  } catch (error) {
    console.error('[AgentRegistry] Read error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// GET /agents/registry/discover
async function discoverAgentRegistry(req, res) {
  if (!ensureSupabase(res)) {
    return;
  }

  try {
    const { userId, chain, capability, mineOnly = 'false', limit = 20 } = req.query;
    const maxRows = clampLimit(limit, 20, 100);

    let query = supabase
      .from('agent_registry')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(maxRows);

    if (String(mineOnly).toLowerCase() === 'true') {
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required when mineOnly=true' });
      }
      query = query.eq('user_id', userId);
    } else {
      query = query.eq('status', 'active');
    }

    if (chain) {
      query = query.contains('supported_chains', [String(chain)]);
    }

    if (capability) {
      query = query.contains('capabilities', [String(capability)]);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[AgentRegistry] Discover error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    let visibleRows = data || [];
    if (String(mineOnly).toLowerCase() !== 'true') {
      const agentIds = Array.from(new Set(visibleRows.map((row) => row.agent_id).filter(Boolean)));

      if (agentIds.length > 0) {
        const { data: agents, error: agentLookupError } = await supabase
          .from('agents')
          .select('id, user_id, is_public, on_chain_id')
          .in('id', agentIds);

        if (agentLookupError) {
          console.error('[AgentRegistry] Discover visibility lookup error:', agentLookupError);
          return res.status(500).json({ success: false, error: agentLookupError.message });
        }

        const visibilityMap = new Map((agents || []).map((agent) => [agent.id, agent]));
        visibleRows = visibleRows.filter((row) => {
          const visibility = visibilityMap.get(row.agent_id);
          if (!visibility) {
            return false;
          }

          if (visibility.is_public || visibility.on_chain_id) {
            return true;
          }

          return Boolean(userId) && visibility.user_id === userId;
        });
      } else {
        visibleRows = [];
      }
    }

    const registryEntries = visibleRows.map(normalizeRegistryRow);
    return res.json({
      success: true,
      count: registryEntries.length,
      registry: registryEntries
    });
  } catch (error) {
    console.error('[AgentRegistry] Discover error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// GET /agents/:id/audit-logs
async function listAgentAuditLogs(req, res) {
  if (!ensureSupabase(res)) {
    return;
  }

  try {
    const { id: agentId } = req.params;
    const {
      userId,
      conversationId,
      tool,
      success,
      limit = 50
    } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing required query parameter: userId' });
    }

    const agent = await loadAgent(agentId);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (agent.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    let query = supabase
      .from('agent_tool_execution_logs')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(clampLimit(limit, 50, 200));

    if (conversationId) {
      query = query.eq('conversation_id', conversationId);
    }

    if (tool) {
      query = query.eq('tool_name', String(tool));
    }

    if (success === 'true') {
      query = query.eq('success', true);
    }

    if (success === 'false') {
      query = query.eq('success', false);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[AgentRegistry] Audit log query error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.json({
      success: true,
      count: data.length,
      logs: data
    });
  } catch (error) {
    console.error('[AgentRegistry] Audit log query error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// GET /agents/:id/audit-logs/:logId/content
async function getAgentAuditLogContent(req, res) {
  if (!ensureSupabase(res)) {
    return;
  }

  try {
    const { id: agentId, logId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing required query parameter: userId' });
    }

    const agent = await loadAgent(agentId);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (agent.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { data: logRow, error: logError } = await supabase
      .from('agent_tool_execution_logs')
      .select('*')
      .eq('id', logId)
      .eq('agent_id', agentId)
      .maybeSingle();

    if (logError) {
      console.error('[AgentRegistry] Audit content query error:', logError);
      return res.status(500).json({ success: false, error: logError.message });
    }

    if (!logRow) {
      return res.status(404).json({ success: false, error: 'Audit log entry not found' });
    }

    const pieceCid = logRow.filecoin_cid || parsePieceCidFromUri(logRow.filecoin_uri) || null;
    if (!pieceCid) {
      return res.status(409).json({
        success: false,
        error: 'No Filecoin piece CID available for this log entry',
        log: {
          id: logRow.id,
          storageStatus: logRow.storage_status,
          filecoinUri: logRow.filecoin_uri
        }
      });
    }

    const retrieval = await retrieveJsonFromFilecoin({
      pieceCid,
      uri: logRow.filecoin_uri || null
    });

    if (retrieval.status !== 'stored') {
      return res.status(502).json({
        success: false,
        error: retrieval.error || 'Failed to retrieve Filecoin payload',
        filecoin: {
          status: retrieval.status,
          provider: retrieval.provider,
          pieceCid: retrieval.pieceCid || pieceCid,
          uri: retrieval.uri || logRow.filecoin_uri || null
        }
      });
    }

    return res.json({
      success: true,
      logId: logRow.id,
      filecoin: {
        status: retrieval.status,
        provider: retrieval.provider,
        pieceCid: retrieval.pieceCid || pieceCid,
        uri: retrieval.uri || logRow.filecoin_uri || null,
        contentType: retrieval.contentType,
        parseError: retrieval.parseError || null
      },
      // This is the exact JSON envelope uploaded through archiveJsonToFilecoin.
      envelope: retrieval.parsed,
      // Convenience field for quickly seeing the application payload body.
      payload: retrieval.payload,
      metadata: retrieval.metadata,
      rawText: retrieval.rawText
    });
  } catch (error) {
    console.error('[AgentRegistry] Audit content retrieval error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  discoverAgentRegistry,
  getAgentAuditLogContent,
  getAgentRegistry,
  listAgentAuditLogs,
  upsertAgentRegistry
};
