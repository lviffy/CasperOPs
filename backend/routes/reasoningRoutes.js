const express = require('express');
const router = express.Router();

// SSE Pub-Sub map: conversationId -> Set of Response objects
const activeClients = new Map();

/**
 * Broadcasts a trace step event to all SSE clients listening to the conversationId.
 */
function broadcastTrace(conversationId, event) {
  if (!conversationId) return;
  const clients = activeClients.get(conversationId);
  if (clients && clients.size > 0) {
    const data = JSON.stringify({
      ...event,
      timestamp: new Date().toISOString()
    });
    clients.forEach(client => {
      client.write(`data: ${data}\n\n`);
    });
  }
}

/**
 * GET /reasoning/stream/:conversationId
 * Establishes an SSE stream connection for a given conversation.
 */
router.get('/reasoning/stream/:conversationId', (req, res) => {
  const { conversationId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  });

  // Immediately send connection acknowledgement
  res.write(`data: ${JSON.stringify({ type: 'connected', conversationId })}\n\n`);

  if (!activeClients.has(conversationId)) {
    activeClients.set(conversationId, new Set());
  }
  activeClients.get(conversationId).add(res);

  // Keep connection alive with 15s pings
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(pingInterval);
    const clients = activeClients.get(conversationId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        activeClients.delete(conversationId);
      }
    }
  });
});

/**
 * POST /reasoning/trace
 * Broadcasts a trace step event to all SSE clients listening to the conversationId.
 */
router.post('/reasoning/trace', (req, res) => {
  const { conversationId, type, tool, success, message, txHash } = req.body;

  if (!conversationId) {
    return res.status(400).json({ ok: false, error: 'conversationId is required' });
  }

  broadcastTrace(conversationId, { type, tool, success, message, txHash });

  const clients = activeClients.get(conversationId);
  res.json({ ok: true, clientsNotified: clients ? clients.size : 0 });
});

router.broadcastTrace = broadcastTrace;
module.exports = router;
