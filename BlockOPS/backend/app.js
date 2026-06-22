const express = require('express');
const { PORT, NETWORK_NAME, FACTORY_ADDRESS, NFT_FACTORY_ADDRESS } = require('./config/constants');
const apiKeyAuth = require('./middleware/apiKeyAuth');
const { globalLimiter, chatLimiter, priceLimiter, txLimiter } = require('./middleware/rateLimiter');

// BlockOps migrated off EVM (Arbitrum / Flow / Filecoin) onto Casper in Phase 2.
// The legacy controllers still reference `ethers` and other EVM-only deps which
// were removed in Phase 18. Loading any of them should fail gracefully so the
// server still starts — the affected routes just return a clear "deprecated"
// response. Real signing happens in CSPR.click (frontend) and backendSigner.js.
const { Router } = express;
function deprecatedRouter(label) {
  const router = Router();
  const handler = (req, res) => res.status(410).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} is no longer available`,
    context: `${label} was removed in the Casper migration (Phase 18). Use CSPR.click + the Casper tool router instead.`
  });
  router.use(handler);
  return router;
}
function safeRequire(modulePath, label) {
  try {
    return require(modulePath);
  } catch (error) {
    console.warn(`[boot] EVM-only module ${modulePath} failed to load (${error.message}); serving deprecated fallback for ${label}`);
    return deprecatedRouter(label);
  }
}

// Casper-native routes (required eagerly) — but conversation/agent routes
// transitively depend on agentRuntime/agentCoordinator (EVM-only), so wrap them.
const tokenRoutes         = safeRequire('./routes/tokenRoutes',         'token routes');
const nftRoutes           = safeRequire('./routes/nftRoutes',           'nft routes');
const transferRoutes      = safeRequire('./routes/transferRoutes',      'transfer routes');
const healthRoutes        = require('./routes/healthRoutes');
const priceRoutes         = require('./routes/priceRoutes');
const conversationRoutes  = safeRequire('./routes/conversationRoutes',  'conversation (Casper chat — uses EVM agent runtime internally)');
const contractChatRoutes  = safeRequire('./routes/contractChatRoutes',  'contract chat (Casper contract AI)');
const emailRoutes         = require('./routes/emailRoutes');
const webhookRoutes       = require('./routes/webhookRoutes');
const reminderRoutes      = safeRequire('./routes/reminderRoutes',      'reminders (uses telegramService internally)');
const telegramRoutes      = safeRequire('./routes/telegramRoutes',      'telegram (long-polls Casper / Arbitrum — EVM bits missing)');
const agentRoutes         = safeRequire('./routes/agentRoutes',         'agents (Casper agent registry + EVM controller)');

// EVM-only routes — wrapped so the server can start even if ethers is missing.
const nlExecutorRoutes    = safeRequire('./routes/nlExecutorRoutes',    'nl-executor (Arbitrum Sepolia NL executor)');
const walletRoutes        = safeRequire('./routes/walletRoutes',        'wallet (Arbitrum EVM wallet)');
const allowanceRoutes     = safeRequire('./routes/allowanceRoutes',     'allowance (Arbitrum ERC-20 approvals)');
const batchRoutes         = safeRequire('./routes/batchRoutes',         'batch (Arbitrum batch calls)');
const chainRoutes         = safeRequire('./routes/chainRoutes',         'chain (Arbitrum chain info)');
const portfolioRoutes     = safeRequire('./routes/portfolioRoutes',     'portfolio (Arbitrum portfolio)');
const ensRoutes           = safeRequire('./routes/ensRoutes',           'ens (Arbitrum ENS)');
const gasRoutes           = safeRequire('./routes/gasRoutes',           'gas (Arbitrum gas oracle)');
const swapRoutes          = safeRequire('./routes/swapRoutes',          'swap (Arbitrum DEX router)');
const bridgeRoutes        = safeRequire('./routes/bridgeRoutes',        'bridge (Arbitrum bridge)');
const scheduleRoutes      = safeRequire('./routes/scheduleRoutes',      'schedule (Arbitrum scheduled jobs)');
const { reloadJobsFromDB } = safeRequire('./controllers/scheduleController', 'schedule controller');
const { reloadReminderJobsFromDB } = safeRequire('./controllers/reminderController', 'reminder controller');
const { prepareTransfer } = safeRequire('./controllers/transferController', 'transfer controller');
const walletControllerModule = safeRequire('./controllers/walletController', 'wallet controller');
const telegramServiceModule = safeRequire('./services/telegramService', 'telegram service');

// safeRequire returns a fallback Router when the underlying module failed to
// load (EVM-only deps missing). Wrap each function so we never pass undefined
// to `app.listen` / `app.use` callbacks.
const safeStartLongPolling = typeof telegramServiceModule.startLongPolling === 'function'
  ? telegramServiceModule.startLongPolling
  : () => {};
const safeStopLongPolling = typeof telegramServiceModule.stopLongPolling === 'function'
  ? telegramServiceModule.stopLongPolling
  : () => {};
const safeReloadJobsFromDB = typeof reloadJobsFromDB === 'function'
  ? reloadJobsFromDB
  : async () => {};
const safeReloadReminderJobsFromDB = typeof reloadReminderJobsFromDB === 'function'
  ? reloadReminderJobsFromDB
  : async () => {};
const safePrepareTransfer = typeof prepareTransfer === 'function'
  ? prepareTransfer
  : (req, res) => res.status(410).json({
      success: false,
      error: `${req.method} ${req.originalUrl} is no longer available`,
      context: 'prepareTransfer removed in the Casper migration (Phase 18). Use CSPR.click + the Casper tool router.'
    });

// Initialize Express app
const app = express();

// Trust proxy headers (needed for correct IP in rate limiter when behind nginx/load balancer)
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware - Enable for frontend integration
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Global rate limiter — 300 req / 15 min per IP
app.use(globalLimiter);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Public routes (rate limited, no key required) ──────────────────────────
app.use('/health', healthRoutes);

// Price: rate limited per-IP but no key required
app.use('/price', priceLimiter, priceRoutes);

// Gas + ENS: read-only public endpoints
app.use('/gas',       priceLimiter, gasRoutes);
app.use('/ens',       priceLimiter, ensRoutes);

// Portfolio: read-only but auth-optional (key attaches agent context)
app.use('/portfolio', chatLimiter, apiKeyAuth({ optional: true }), portfolioRoutes);

// Conversation chat: rate limited; api key optional (attaches context if present)
app.use('/api', chatLimiter, apiKeyAuth({ optional: true }), conversationRoutes);

// Public prepare-only transfer route for wallet/Lit signing flows (no server-side signing)
app.post('/transfer/prepare', chatLimiter, safePrepareTransfer);

// Public read-only wallet routes for status/history in direct fallback mode
app.get('/wallet/tx/:hash', chatLimiter, legacyHandler(walletControllerModule, 'getTransactionStatus'));
app.get('/wallet/history/:address', chatLimiter, legacyHandler(walletControllerModule, 'getWalletHistory'));

// ── Protected routes (API key required + transaction rate limit) ─────────────
const authGuard = [txLimiter, apiKeyAuth()];

app.use('/token',         ...authGuard, tokenRoutes);
app.use('/nft',           ...authGuard, nftRoutes);
app.use('/transfer',      ...authGuard, transferRoutes);
app.use('/wallet',        ...authGuard, walletRoutes);
app.use('/allowance',     ...authGuard, allowanceRoutes);
app.use('/email',         ...authGuard, emailRoutes);
app.use('/nl-executor',   ...authGuard, nlExecutorRoutes);
app.use('/contract-chat', ...authGuard, contractChatRoutes);
app.use('/webhooks',      ...authGuard, webhookRoutes);
app.use('/batch',         ...authGuard, batchRoutes);
app.use('/chain',         ...authGuard, chainRoutes);
app.use('/swap',          ...authGuard, swapRoutes);
app.use('/bridge',        ...authGuard, bridgeRoutes);
app.use('/schedule',      txLimiter, scheduleRoutes);
app.use('/agents',        txLimiter, agentRoutes);
app.use('/reminders',     chatLimiter, apiKeyAuth({ optional: true }), reminderRoutes);

// Telegram: /webhook is public (called by Telegram, no key needed)
// All other /telegram/* routes require authGuard
app.use('/telegram', telegramRoutes);

// ── Legacy routes (protected) ────────────────────────────────────────────────
// EVM-only controllers wrapped in safeRequire so the server still boots.
// If the legacy module failed to load, `safeRequire` returns a Router and the
// `.getBalance` / `.deployToken` etc. properties will be undefined — in that
// case we mount a router that returns 410 Gone so the legacy path is still
// covered without crashing the server.
function legacyHandler(controller, methodName) {
  if (controller && typeof controller[methodName] === 'function') {
    return controller[methodName];
  }
  return (req, res) => res.status(410).json({
    success: false,
    error: `${req.method} ${req.originalUrl} is no longer available`,
    context: 'legacy EVM-only endpoint removed in the Casper migration (Phase 18). Use CSPR.click + the Casper tool router.'
  });
}
const legacyTokenController = safeRequire('./controllers/tokenController', 'legacy token controller');
const legacyNftController   = safeRequire('./controllers/nftController',   'legacy nft controller');
const legacyTransferController = safeRequire('./controllers/transferController', 'legacy transfer controller');
app.post('/deploy-token',          ...authGuard, legacyHandler(legacyTokenController, 'deployToken'));
app.post('/deploy-nft-collection', ...authGuard, legacyHandler(legacyNftController, 'deployNFTCollection'));
app.post('/mint-nft',              ...authGuard, legacyHandler(legacyNftController, 'mintNFT'));
app.get('/balance/:address',     legacyHandler(legacyTransferController, 'getBalance'));
app.get('/token-info/:tokenAddress', legacyHandler(legacyTokenController, 'getTokenInfo'));
app.get('/token-balance/:tokenAddress/:ownerAddress', legacyHandler(legacyTokenController, 'getTokenBalance'));
app.get('/nft-info/:collectionAddress/:tokenId', legacyHandler(legacyNftController, 'getNFTInfo'));

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
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message
  });
});

// Start server
const server = app.listen(PORT, async () => {
  // Reload scheduled jobs from DB on startup
  await safeReloadJobsFromDB();
  await safeReloadReminderJobsFromDB();

  // Start Telegram bot (long-poll in dev, no-op if WEBHOOK_URL or no token)
  safeStartLongPolling();

  console.log('\n' + '='.repeat(50));
  console.log('🚀 n8nrollup Backend Server');
  console.log('='.repeat(50));
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 Network: ${NETWORK_NAME}`);
  console.log(`🏭 TokenFactory: ${FACTORY_ADDRESS}`);
  console.log(`🎨 NFTFactory: ${NFT_FACTORY_ADDRESS}`);
  console.log('\n📍 API Endpoints:');
  console.log('  Health Check:');
  console.log('    GET  /health');
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
  console.log('    GET  /transfer/balance/:address');
  console.log('\n  Natural Language Executor:');
  console.log('    GET  /nl-executor/discover/:contractAddress');
  console.log('    POST /nl-executor/execute');
  console.log('    POST /nl-executor/quick-execute');
  console.log('\n  Contract Chat:');
  console.log('    POST /contract-chat/ask             - Ask AI about a contract');
  console.log('\n  Email:');
  console.log('    POST /email/send                   - Send email (text/HTML/attachments)');
  console.log('    POST /email/send-html              - Send HTML email');
  console.log('    GET  /email/verify                 - Verify email connection');
  console.log('\n' + '='.repeat(50) + '\n');
});

// Graceful shutdown — handles both kill and Ctrl+C
function gracefulShutdown(signal) {
  console.log(`${signal} received: shutting down…`);
  safeStopLongPolling();               // Stop Telegram poller immediately
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
