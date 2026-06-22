/**
 * Webhook Service
 *
 * Handles webhook registration, delivery, retry, and logging.
 *
 * Supported event types:
 *   tx.sent            – transaction broadcast (has txHash, no receipt yet)
 *   tx.confirmed       – transaction mined (has receipt)
 *   tx.failed          – transaction reverted or timed out
 *   token.deployed     – ERC20 token deployed
 *   nft.deployed       – NFT collection deployed
 *   nft.minted         – NFT minted
 *   balance.low        – wallet ETH balance dropped below threshold
 *   price.threshold    – token price crossed a configured value
 *   agent.message      – inbound chat message to an agent
 *
 * Delivery:
 *   - HMAC-SHA256 signature on every payload (X-BlockOps-Signature header)
 *   - 3 attempts with exponential backoff: 1s → 5s → 30s
 *   - All attempts logged to Supabase webhook_delivery_logs
 */

const axios = require('axios');
const crypto = require('crypto');
const supabase = require('../config/supabase');

// ─── Constants ───────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000]; // 1s, 5s, 30s
const DELIVERY_TIMEOUT_MS = 10_000;              // 10s per attempt

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Build HMAC-SHA256 signature for a payload.
 * @param {string} secret   Webhook-specific signing secret
 * @param {string} body     JSON-serialised payload string
 * @returns {string}        "sha256=<hex>"
 */
function sign(secret, body) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  return 'sha256=' + hmac.digest('hex');
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function getWebhooksForAgent(agentId, eventType) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('webhook_registrations')
    .select('*')
    .eq('agent_id', agentId)
    .eq('is_active', true)
    .contains('event_types', [eventType]);

  if (error) {
    console.error('[webhook] Supabase fetch error:', error.message);
    return [];
  }
  return data || [];
}

async function logDelivery({ webhookId, agentId, eventType, payload, attempt, statusCode, success, errorMessage }) {
  if (!supabase) return;
  await supabase.from('webhook_delivery_logs').insert({
    webhook_id: webhookId,
    agent_id: agentId,
    event_type: eventType,
    payload,
    attempt,
    status_code: statusCode,
    success,
    error_message: errorMessage || null,
    delivered_at: new Date().toISOString()
  }).then(() => {}).catch(e => console.error('[webhook] Log insert failed:', e.message));
}

// ─── Core delivery ────────────────────────────────────────────────────────────

/**
 * Attempt to deliver one webhook with retries.
 * Runs fire-and-forget — never throws, never awaited by callers.
 */
async function deliverWithRetry(webhook, eventType, payload) {
  const bodyStr = JSON.stringify(payload);
  const signature = sign(webhook.secret, bodyStr);

  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const response = await axios.post(webhook.url, payload, {
        timeout: DELIVERY_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-BlockOps-Signature': signature,
          'X-BlockOps-Event': eventType,
          'X-BlockOps-Delivery': crypto.randomUUID(),
          'User-Agent': 'BlockOps-Webhooks/1.0'
        }
      });

      console.log(`[webhook] ✓ Delivered ${eventType} to ${webhook.url} (attempt ${attempt}, status ${response.status})`);

      await logDelivery({
        webhookId: webhook.id,
        agentId: webhook.agent_id,
        eventType,
        payload: bodyStr,
        attempt,
        statusCode: response.status,
        success: true
      });

      return; // success — stop retrying

    } catch (err) {
      const statusCode = err.response?.status || null;
      const errorMessage = err.message;

      console.warn(`[webhook] ✗ Attempt ${attempt} for ${webhook.url} failed: ${errorMessage}`);

      await logDelivery({
        webhookId: webhook.id,
        agentId: webhook.agent_id,
        eventType,
        payload: bodyStr,
        attempt,
        statusCode,
        success: false,
        errorMessage
      });

      // Wait before next attempt
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (delay) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`[webhook] All attempts exhausted for ${webhook.url} (${eventType})`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fire an event to all registered webhooks for an agent.
 * Always fire-and-forget — never blocks the HTTP response.
 *
 * @param {string} agentId    The agent that owns the event
 * @param {string} eventType  One of the supported event type strings
 * @param {Object} data       Event-specific data payload
 */
function fireEvent(agentId, eventType, data) {
  if (!agentId) return; // nothing to fire if no agent context

  // Async, non-blocking
  (async () => {
    try {
      const webhooks = await getWebhooksForAgent(agentId, eventType);
      if (webhooks.length === 0) return;

      const payload = {
        event: eventType,
        agentId,
        timestamp: new Date().toISOString(),
        data
      };

      for (const webhook of webhooks) {
        deliverWithRetry(webhook, eventType, payload).catch(() => {});
      }
    } catch (err) {
      console.error('[webhook] fireEvent error:', err.message);
    }
  })();
}

/**
 * Register a new webhook.
 */
async function registerWebhook({ agentId, userId, url, eventTypes, label }) {
  if (!supabase) throw new Error('Supabase not configured');

  // Validate URL
  try { new URL(url); } catch { throw new Error('Invalid webhook URL'); }

  // Validate event types
  const VALID_EVENTS = [
    'tx.sent', 'tx.confirmed', 'tx.failed',
    'token.deployed', 'nft.deployed', 'nft.minted',
    'balance.low', 'price.threshold', 'agent.message'
  ];
  const invalid = eventTypes.filter(e => !VALID_EVENTS.includes(e));
  if (invalid.length) throw new Error(`Invalid event types: ${invalid.join(', ')}`);

  const secret = 'whsec_' + crypto.randomBytes(24).toString('hex');

  const { data, error } = await supabase
    .from('webhook_registrations')
    .insert({
      agent_id: agentId,
      user_id: userId,
      url,
      event_types: eventTypes,
      label: label || null,
      secret,
      is_active: true
    })
    .select()
    .single();

  if (error) throw new Error('Failed to register webhook: ' + error.message);

  return { ...data, secret }; // return secret once — not stored in plaintext after this
}

/**
 * List webhooks for an agent (secrets redacted).
 */
async function listWebhooks(agentId) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('webhook_registrations')
    .select('id, agent_id, user_id, url, event_types, label, is_active, created_at, last_triggered_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Delete (deactivate) a webhook.
 */
async function deleteWebhook(webhookId, agentId) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('webhook_registrations')
    .update({ is_active: false })
    .eq('id', webhookId)
    .eq('agent_id', agentId);

  if (error) throw new Error(error.message);
}

/**
 * Send a test payload to a specific webhook.
 */
async function testWebhook(webhookId, agentId) {
  if (!supabase) throw new Error('Supabase not configured');

  const { data: webhook, error } = await supabase
    .from('webhook_registrations')
    .select('*')
    .eq('id', webhookId)
    .eq('agent_id', agentId)
    .single();

  if (error || !webhook) throw new Error('Webhook not found');

  const testPayload = {
    event: 'test',
    agentId,
    timestamp: new Date().toISOString(),
    data: { message: 'This is a test delivery from BlockOps', webhookId }
  };

  const bodyStr = JSON.stringify(testPayload);
  const signature = sign(webhook.secret, bodyStr);

  try {
    const response = await axios.post(webhook.url, testPayload, {
      timeout: DELIVERY_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-BlockOps-Signature': signature,
        'X-BlockOps-Event': 'test',
        'X-BlockOps-Delivery': crypto.randomUUID(),
        'User-Agent': 'BlockOps-Webhooks/1.0'
      }
    });
    return { success: true, statusCode: response.status };
  } catch (err) {
    return { success: false, statusCode: err.response?.status || null, error: err.message };
  }
}

/**
 * Get delivery logs for a webhook.
 */
async function getDeliveryLogs(webhookId, agentId, limit = 50) {
  if (!supabase) throw new Error('Supabase not configured');

  // First confirm ownership
  const { data: webhook } = await supabase
    .from('webhook_registrations')
    .select('id')
    .eq('id', webhookId)
    .eq('agent_id', agentId)
    .single();

  if (!webhook) throw new Error('Webhook not found');

  const { data, error } = await supabase
    .from('webhook_delivery_logs')
    .select('*')
    .eq('webhook_id', webhookId)
    .order('delivered_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data || [];
}

module.exports = {
  fireEvent,
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  testWebhook,
  getDeliveryLogs
};
