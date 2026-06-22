/**
 * Agent Routes
 * 
 * RESTful API for managing custom AI agents.
 * Public read endpoints are exposed for ERC-8004 verification,
 * while management routes require API key authentication.
 */

const express = require('express');
const router = express.Router();
const {
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  regenerateApiKey,
  registerAgentOnChain,
  getAgentManifest,
  deleteAgent
} = require('../controllers/agentController');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const {
  discoverAgentRegistry,
  getAgentAuditLogContent,
  getAgentRegistry,
  listAgentAuditLogs,
  upsertAgentRegistry
} = require('../controllers/agentRegistryController');

// ─────────────────────────────────────────────────────────────────────────────
// Agent CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /agents/:id/manifest
 * Get public agent manifest for ERC-8004
 */
router.get('/:id/manifest', getAgentManifest);

/**
 * GET /agents/registry/discover
 * Discover active agent registry entries.
 *
 * Query: { chain?, capability?, mineOnly?, userId?, limit? }
 */
router.get('/registry/discover', discoverAgentRegistry);

/**
 * GET /agents/:id/registry
 * Read an agent registry record.
 *
 * Query: { userId? }
 */
router.get('/:id/registry', getAgentRegistry);

// All agent management routes should be protected by the master API key
router.use(apiKeyAuth());

/**
 * POST /agents
 * Create a new agent and get an API key (shown only once)
 * 
 * Body: { userId, name, description?, systemPrompt?, enabledTools?, walletAddress?, isPublic? }
 * Response: { success, agent: { id, name, apiKey, ... }, warning }
 */
router.post('/', createAgent);

/**
 * GET /agents?userId=xxx
 * List all agents for a user
 * 
 * Response: { success, agents: [...] }
 */
router.get('/', listAgents);

/**
 * PUT /agents/:id/registry
 * Create/update an agent registry record.
 *
 * Body: { userId, displayName?, description?, capabilities?, supportedChains?, metadata?, status? }
 */
router.put('/:id/registry', upsertAgentRegistry);

/**
 * GET /agents/:id/audit-logs
 * List per-tool execution logs mapped to this agent/user.
 *
 * Query: { userId, conversationId?, tool?, success?, limit? }
 */
router.get('/:id/audit-logs', listAgentAuditLogs);

/**
 * GET /agents/:id/audit-logs/:logId/content
 * Retrieve exact JSON content archived on Filecoin for a specific audit log.
 *
 * Query: { userId }
 */
router.get('/:id/audit-logs/:logId/content', getAgentAuditLogContent);

/**
 * GET /agents/:id?userId=xxx
 * Get single agent details (with Telegram link status)
 * 
 * Response: { success, agent: { ..., linkedToTelegram, telegramChatId } }
 */
router.get('/:id', getAgent);

/**
 * PATCH /agents/:id
 * Update agent configuration
 * 
 * Body: { userId, name?, description?, systemPrompt?, enabledTools?, ... }
 * Response: { success, agent: { ... } }
 */
router.patch('/:id', updateAgent);

/**
 * POST /agents/:id/regenerate-key
 * Regenerate API key (old key becomes invalid)
 * 
 * Body: { userId }
 * Response: { success, apiKey, apiKeyPrefix, warning }
 */
router.post('/:id/regenerate-key', regenerateApiKey);

/**
 * POST /agents/:id/register-on-chain
 * Manually register an agent in the ERC-8004 Identity Registry
 * 
 * Body: { userId, privateKey? }
 * Response: { success, onChainId, transactionHash }
 */
router.post('/:id/register-on-chain', registerAgentOnChain);

/**
 * DELETE /agents/:id?userId=xxx
 * Delete an agent (also unlinks from Telegram)
 * 
 * Response: { success, message, unlinkedChats }
 */
router.delete('/:id', deleteAgent);

module.exports = router;
