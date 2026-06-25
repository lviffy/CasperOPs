/**
 * Webhook Controller
 * REST handlers for webhook CRUD + delivery logs.
 */

const {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  testWebhook,
  getDeliveryLogs
} = require('../services/webhookService');

const { successResponse, errorResponse } = require('../utils/helpers');

// ─── POST /webhooks/register ──────────────────────────────────────────────────

async function register(req, res) {
  try {
    const { agentId, userId, url, eventTypes, label } = req.body;

    if (!agentId || !userId || !url || !eventTypes || !Array.isArray(eventTypes) || eventTypes.length === 0) {
      return res.status(400).json(
        errorResponse('Missing required fields: agentId, userId, url, eventTypes (array)')
      );
    }

    const webhook = await registerWebhook({ agentId, userId, url, eventTypes, label });

    return res.status(201).json(
      successResponse({
        message: 'Webhook registered. Save the secret — it will not be shown again.',
        webhook
      })
    );
  } catch (err) {
    console.error('Webhook register error:', err.message);
    return res.status(400).json(errorResponse(err.message));
  }
}

// ─── GET /webhooks?agentId= ───────────────────────────────────────────────────

async function list(req, res) {
  try {
    const { agentId } = req.query;
    if (!agentId) return res.status(400).json(errorResponse('agentId query param required'));

    const webhooks = await listWebhooks(agentId);
    return res.json(successResponse({ webhooks }));
  } catch (err) {
    console.error('Webhook list error:', err.message);
    return res.status(500).json(errorResponse(err.message));
  }
}

// ─── DELETE /webhooks/:id ─────────────────────────────────────────────────────

async function remove(req, res) {
  try {
    const { id } = req.params;
    const { agentId } = req.body;

    if (!agentId) return res.status(400).json(errorResponse('agentId required in body'));

    await deleteWebhook(id, agentId);
    return res.json(successResponse({ message: 'Webhook deactivated' }));
  } catch (err) {
    console.error('Webhook delete error:', err.message);
    return res.status(400).json(errorResponse(err.message));
  }
}

// ─── POST /webhooks/:id/test ──────────────────────────────────────────────────

async function test(req, res) {
  try {
    const { id } = req.params;
    const { agentId } = req.body;

    if (!agentId) return res.status(400).json(errorResponse('agentId required in body'));

    const result = await testWebhook(id, agentId);

    if (result.success) {
      return res.json(successResponse({ message: 'Test delivery succeeded', ...result }));
    } else {
      return res.status(502).json(errorResponse(`Test delivery failed: ${result.error}`, result));
    }
  } catch (err) {
    console.error('Webhook test error:', err.message);
    return res.status(400).json(errorResponse(err.message));
  }
}

// ─── GET /webhooks/:id/logs ───────────────────────────────────────────────────

async function logs(req, res) {
  try {
    const { id } = req.params;
    const { agentId, limit } = req.query;

    if (!agentId) return res.status(400).json(errorResponse('agentId query param required'));

    const deliveryLogs = await getDeliveryLogs(id, agentId, limit ? parseInt(limit) : 50);
    return res.json(successResponse({ logs: deliveryLogs }));
  } catch (err) {
    console.error('Webhook logs error:', err.message);
    return res.status(400).json(errorResponse(err.message));
  }
}

// ─── GET /webhooks/events ─────────────────────────────────────────────────────
// Return the list of valid event types so clients know what to subscribe to

function eventTypes(req, res) {
  return res.json(
    successResponse({
      eventTypes: [
        { event: 'tx.sent',         description: 'Transaction broadcast to the network (pre-confirmation)' },
        { event: 'tx.confirmed',    description: 'Transaction mined and confirmed' },
        { event: 'tx.failed',       description: 'Transaction reverted or timed out' },
        { event: 'token.deployed',  description: 'ERC20 token deployed via factory' },
        { event: 'nft.deployed',    description: 'NFT collection deployed via factory' },
        { event: 'nft.minted',      description: 'NFT minted to a recipient' },
        { event: 'balance.low',     description: 'Wallet ETH balance dropped below configured threshold' },
        { event: 'price.threshold', description: 'Token price crossed configured value' },
        { event: 'agent.message',   description: 'Inbound chat message received by an agent' }
      ]
    })
  );
}

module.exports = { register, list, remove, test, logs, eventTypes };
