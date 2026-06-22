const express = require('express');
const { PORT, NETWORK_NAME, FACTORY_ADDRESS, NFT_FACTORY_ADDRESS } = require('./config/constants');
const apiKeyAuth = require('./middleware/apiKeyAuth');
const { globalLimiter, chatLimiter, priceLimiter, txLimiter } = require('./middleware/rateLimiter');

// Import routes
const tokenRoutes = require('./routes/tokenRoutes');
const nftRoutes = require('./routes/nftRoutes');
const transferRoutes = require('./routes/transferRoutes');
const healthRoutes = require('./routes/healthRoutes');
const priceRoutes = require('./routes/priceRoutes');
const nlExecutorRoutes = require('./routes/nlExecutorRoutes');
const conversationRoutes = require('./routes/conversationRoutes');
const walletRoutes = require('./routes/walletRoutes');
const allowanceRoutes = require('./routes/allowanceRoutes');
const contractChatRoutes = require('./routes/contractChatRoutes');
const emailRoutes = require('./routes/emailRoutes');
const webhookRoutes   = require('./routes/webhookRoutes');
const batchRoutes     = require('./routes/batchRoutes');
const chainRoutes     = require('./routes/chainRoutes');
const portfolioRoutes = require('./routes/portfolioRoutes');
const ensRoutes       = require('./routes/ensRoutes');
const gasRoutes       = require('./routes/gasRoutes');
const swapRoutes      = require('./routes/swapRoutes');
const bridgeRoutes    = require('./routes/bridgeRoutes');
const scheduleRoutes  = require('./routes/scheduleRoutes');
const { reloadJobsFromDB } = require('./controllers/scheduleController');
const reminderRoutes  = require('./routes/reminderRoutes');
const { reloadReminderJobsFromDB } = require('./controllers/reminderController');
const telegramRoutes  = require('./routes/telegramRoutes');
const agentRoutes     = require('./routes/agentRoutes');
const { prepareTransfer } = require('./controllers/transferController');
const { getTransactionStatus, getWalletHistory } = require('./controllers/walletController');
const { startLongPolling, stopLongPolling } = require('./services/telegramService');

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
app.post('/transfer/prepare', chatLimiter, prepareTransfer);

// Public read-only wallet routes for status/history in direct fallback mode
app.get('/wallet/tx/:hash', chatLimiter, getTransactionStatus);
app.get('/wallet/history/:address', chatLimiter, getWalletHistory);

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
app.post('/deploy-token',          ...authGuard, require('./controllers/tokenController').deployToken);
app.post('/deploy-nft-collection', ...authGuard, require('./controllers/nftController').deployNFTCollection);
app.post('/mint-nft',              ...authGuard, require('./controllers/nftController').mintNFT);
app.get('/balance/:address',     require('./controllers/transferController').getBalance);
app.get('/token-info/:tokenAddress', require('./controllers/tokenController').getTokenInfo);
app.get('/token-balance/:tokenAddress/:ownerAddress', require('./controllers/tokenController').getTokenBalance);
app.get('/nft-info/:collectionAddress/:tokenId', require('./controllers/nftController').getNFTInfo);

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
  await reloadJobsFromDB();
  await reloadReminderJobsFromDB();

  // Start Telegram bot (long-poll in dev, no-op if WEBHOOK_URL or no token)
  startLongPolling();

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
  stopLongPolling();               // Stop Telegram poller immediately
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
