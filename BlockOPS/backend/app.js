/**
 * BlockOps Casper backend.
 *
 * Phase 23 cleanup:
 *   - Removed `safeRequire` / `deprecatedRouter` shims; routes and
 *     controllers that survive are eager-loaded.
 *   - Deleted the 11 EVM-only routes (allowance, batch, bridge, chain,
 *     ens, gas, nlExecutor, portfolio, schedule, swap, wallet) and the
 *     `/transfer/prepare` Lit/Arbitrum signing shim.
 *   - The remaining routes are all Casper-native: token, nft, transfer,
 *     conversation, contract chat, email, webhooks, agents, reminders,
 *     telegram, price, health, plus the Phase 20 v1 tool surface.
 */
const express = require('express');
const { PORT, NETWORK_NAME, FACTORY_ADDRESS, NFT_FACTORY_ADDRESS } = require('./config/constants');
const apiKeyAuth = require('./middleware/apiKeyAuth');
const { globalLimiter, chatLimiter, priceLimiter, txLimiter } = require('./middleware/rateLimiter');
const { requestContext } = require('./middleware/requestContext');
const { validateToolRequest } = require('./middleware/validate');
const { x402Verify } = require('./middleware/x402-verify');
const { x402Challenge } = require('./middleware/x402');
const { withRefundOnFailure } = require('./middleware/x402-refund');
const { initSentry, captureException } = require('./utils/sentry');
const { logger } = require('./utils/logger');
const { executeToolsDirectly } = require('./services/directToolExecutor');

// Casper-native routes + controllers (eagerly required — none of them
// transitively import EVM-only modules after the Phase 23 cleanup).
const tokenRoutes         = require('./routes/tokenRoutes');
const nftRoutes           = require('./routes/nftRoutes');
const transferRoutes      = require('./routes/transferRoutes');
const healthRoutes        = require('./routes/healthRoutes');
const priceRoutes         = require('./routes/priceRoutes');
const conversationRoutes  = require('./routes/conversationRoutes');
const contractChatRoutes  = require('./routes/contractChatRoutes');
const emailRoutes         = require('./routes/emailRoutes');
const webhookRoutes       = require('./routes/webhookRoutes');
const reminderRoutes      = require('./routes/reminderRoutes');
const telegramRoutes      = require('./routes/telegramRoutes');
const agentRoutes         = require('./routes/agentRoutes');
const telegramService     = require('./services/telegramService');
const { reloadReminderJobsFromDB } = require('./controllers/reminderController');

// Initialize Express app
const app = express();

// Initialize Sentry (no-op when SENTRY_DSN is unset) — must happen BEFORE
// any middleware so the express error handler is wired up.
initSentry(app);

// Trust proxy headers (needed for correct IP in rate limiter when behind nginx/load balancer)
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware - Enable for frontend integration
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-key, X-Request-Id, X-Casper-Payment-Deploy-Hash, X-Casper-Payment-Payer-PublicKey');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Expose-Headers', 'X-Request-Id, X-Casper-Tool-Id, X-Casper-Price-Cspr, x-casper-refund-deploy-hash, x-casper-refund-skipped, x-casper-refund-error');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Global rate limiter — 300 req / 15 min per IP
app.use(globalLimiter);

// Per-request UUID + structured request logging. Must run before every
// route so `req.id` + `req.log` are available everywhere downstream.
app.use(requestContext());

// ── Public routes (rate limited, no key required) ──────────────────────────
app.use('/health', healthRoutes);
app.use('/price', priceLimiter, priceRoutes);

// Conversation chat: rate limited; api key optional (attaches context if present)
app.use('/api', chatLimiter, apiKeyAuth({ optional: true }), conversationRoutes);

// ── Protected routes (API key required + transaction rate limit) ─────────────
const authGuard = [txLimiter, apiKeyAuth()];

app.use('/token',         ...authGuard, tokenRoutes);
app.use('/nft',           ...authGuard, nftRoutes);
app.use('/transfer',      ...authGuard, transferRoutes);
app.use('/email',         ...authGuard, emailRoutes);
app.use('/contract-chat', ...authGuard, contractChatRoutes);
app.use('/webhooks',      ...authGuard, webhookRoutes);
app.use('/agents',        txLimiter, agentRoutes);
app.use('/reminders',     chatLimiter, apiKeyAuth({ optional: true }), reminderRoutes);

// Telegram: /webhook is public (called by Telegram, no key needed)
// All other /telegram/* routes require authGuard
app.use('/telegram', telegramRoutes);

// ── Canonical Casper tool router (Phase 20) ─────────────────────────────────
// Single v1 surface for all 19 tools. Middleware order matters:
//   1. validateToolRequest  — zod input validation, 400 on bad input
//   2. x402Challenge        — free tools: pass-through; paid tools: 402 challenge
//   3. x402Verify           — paid tools: verify deploy hash against RPC
//   4. withRefundOnFailure  — broadcast treasury refund if handler returns 5xx
//   5. toolHandler          — dispatch to directToolExecutor
async function v1ToolHandler(req, res) {
  const { toolId, params } = req.validated || {};
  const stepLog = (req.log || logger).child({ toolId });
  const startedAt = Date.now();
  try {
    stepLog.info({ params: req.validated?.params }, 'v1 tool handler starting');
    const result = await executeToolsDirectly(
      {
        requires_tools: true,
        execution_plan: { type: 'sequential', steps: [{ tool: toolId, parameters: params || {} }] },
      },
      '',
      { requestId: req.id, apiKey: req.header('x-api-key') },
    );
    const inner = result?.results?.[0] || { success: false, error: 'no result' };
    const ok = inner?.success !== false;
    stepLog[ok ? 'info' : 'warn']({
      ok,
      durationMs: Date.now() - startedAt,
      deployHash: inner?.result?.deployHash || inner?.result?.transactionHash,
    }, 'v1 tool handler finished');
    return res.status(ok ? 200 : 400).json({
      success: ok,
      toolId,
      result: inner?.result || null,
      error: ok ? null : inner?.error || null,
      requestId: req.id,
    });
  } catch (err) {
    captureException(err, { toolId, requestId: req.id });
    stepLog.error({ err: err.message, stack: err.stack, durationMs: Date.now() - startedAt }, 'v1 tool handler threw');
    return res.status(500).json({
      success: false,
      toolId,
      error: err.message || 'internal error',
      requestId: req.id,
    });
  }
}

app.post(
  '/v1/tools/:toolId',
  validateToolRequest(),
  x402Challenge(),
  x402Verify(),
  withRefundOnFailure(),
  v1ToolHandler,
);

// Convenience: list tools + pricing (public, free, no x402)
app.get('/v1/tools', (req, res) => {
  const { AVAILABLE_TOOLS } = require('./services/toolRouter');
  const { getToolPrice } = require('./utils/chains');
  const tools = Object.values(AVAILABLE_TOOLS).map((t) => {
    const price = getToolPrice(t.name);
    return {
      name: t.name,
      description: t.description,
      x402_required: price.tier === 'paid',
      price_motes: price.priceMotes,
    };
  });
  res.json({ success: true, count: tools.length, tools });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  captureException(error, { requestId: req.id, url: req.originalUrl, method: req.method });
  (req.log || logger).error({
    err: error?.message,
    stack: error?.stack,
    url: req.originalUrl,
    method: req.method,
  }, 'unhandled error');
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message,
    requestId: req.id,
  });
});

// Start server
const server = app.listen(PORT, async () => {
  // Reload reminder jobs from DB on startup (Casper-side state).
  if (typeof reloadReminderJobsFromDB === 'function') {
    try {
      await reloadReminderJobsFromDB();
    } catch (err) {
      console.warn(`[boot] reloadReminderJobsFromDB failed: ${err.message}`);
    }
  }

  // Start Telegram bot (long-poll in dev, no-op if WEBHOOK_URL or no token)
  if (typeof telegramService.startLongPolling === 'function') {
    telegramService.startLongPolling();
  }

  console.log('\n' + '='.repeat(50));
  console.log('🚀 BlockOps Casper Backend');
  console.log('='.repeat(50));
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 Network: ${NETWORK_NAME}`);
  console.log(`🏭 TokenFactory: ${FACTORY_ADDRESS}`);
  console.log(`🎨 NFTFactory: ${NFT_FACTORY_ADDRESS}`);
  console.log('\n📍 API Endpoints:');
  console.log('  Health:');
  console.log('    GET  /health');
  console.log('\n  v1 Tool Surface (Phase 20):');
  console.log('    GET  /v1/tools');
  console.log('    POST /v1/tools/:toolId            (validate → x402 challenge/verify → refund → dispatch)');
  console.log('\n  Token Operations:');
  console.log('    POST /token/deploy');
  console.log('    GET  /token/info/:tokenAddress');
  console.log('    GET  /token/balance/:tokenAddress/:ownerAddress');
  console.log('\n  NFT Operations:');
  console.log('    POST /nft/deploy-collection');
  console.log('    POST /nft/mint');
  console.log('    GET  /nft/info/:collectionAddress/:tokenId');
  console.log('\n  Transfer Operations:');
  console.log('    POST /transfer');
  console.log('\n  Contract Chat:');
  console.log('    POST /contract-chat/ask             - Ask AI about a contract');
  console.log('\n  Email:');
  console.log('    POST /email/send                   - Send email (text/HTML/attachments)');
  console.log('    POST /email/send-html              - Send HTML email');
  console.log('    GET  /email/verify                 - Verify email connection');
  console.log('\n  Webhooks:');
  console.log('    POST /webhooks                     - Register a webhook');
  console.log('    GET  /webhooks                     - List webhooks');
  console.log('\n  Agents:');
  console.log('    GET  /agents                       - List agents');
  console.log('    POST /agents                       - Create agent');
  console.log('    PATCH /agents/:id                  - Update agent');
  console.log('    DELETE /agents/:id                 - Delete agent');
  console.log('    GET  /agents/:id/manifest          - Casper manifest');
  console.log('\n  Reminders:');
  console.log('    GET  /reminders / POST /reminders / DELETE /reminders/:id');
  console.log('\n  Telegram:');
  console.log('    POST /telegram/webhook             - public Telegram webhook');
  console.log('\n  Conversation:');
  console.log('    POST /api/chat                     - Casper-native chat (x402 + tool router)');
  console.log('\n' + '='.repeat(50) + '\n');
});

// Graceful shutdown — handles both kill and Ctrl+C
function gracefulShutdown(signal) {
  console.log(`${signal} received: shutting down…`);
  if (typeof telegramService.stopLongPolling === 'function') {
    telegramService.stopLongPolling();
  }
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  // Force exit if server.close hangs beyond 5 s
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

module.exports = app;
