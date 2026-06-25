/**
 * Backend entry point. Delegates to `app.js` and starts the listener.
 *
 * Kept as a separate file (rather than calling `app.listen()` at the
 * bottom of `app.js`) so the test suite can require `app.js` as a
 * library without it auto-listening.
 */

const { logger } = require('./utils/logger');
const { PORT, NETWORK_NAME, FACTORY_ADDRESS, NFT_FACTORY_ADDRESS } = require('./config/constants');

const app = require('./app');

const server = app.listen(PORT, async () => {
  // Reload reminder jobs from DB on startup (Casper-side state).
  const { reloadReminderJobsFromDB } = require('./controllers/reminderController');
  if (typeof reloadReminderJobsFromDB === 'function') {
    try {
      await reloadReminderJobsFromDB();
    } catch (err) {
      logger.warn({ err: err.message }, '[boot] reloadReminderJobsFromDB failed');
    }
  }

  // Start Telegram bot (long-poll in dev, no-op if WEBHOOK_URL or no token)
  const telegramService = require('./services/telegramService');
  if (typeof telegramService.startLongPolling === 'function') {
    telegramService.startLongPolling();
  }

  console.log('\n' + '='.repeat(50));
  console.log('🚀 CasperOPs Casper Backend');
  console.log('='.repeat(50));
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 Network: ${NETWORK_NAME}`);
  console.log(`🏭 TokenFactory: ${FACTORY_ADDRESS}`);
  console.log(`🎨 NFTFactory: ${NFT_FACTORY_ADDRESS}`);
  console.log('\n📍 API Endpoints:');
  console.log('  Health:');
  console.log('    GET  /health');
  console.log('    GET  /health/live');
  console.log('    GET  /health/ready');
  console.log('    GET  /health/startup');
  console.log('\n  v1 Tool Surface (Phase 20):');
  console.log('    GET  /v1/tools');
  console.log('    POST /v1/tools/:toolId');
  console.log('\n  Token Operations: POST /token/deploy, GET /token/info/:addr, GET /token/balance');
  console.log('  NFT Operations:    POST /nft/deploy-collection, POST /nft/mint, GET /nft/info');
  console.log('  Transfer:          POST /transfer');
  console.log('  Contract Chat:     POST /contract-chat/ask');
  console.log('  Email:             POST /email/send, POST /email/send-html, GET /email/verify');
  console.log('  Webhooks:          POST /webhooks, GET /webhooks');
  console.log('  Agents:            GET/POST/PATCH/DELETE /agents');
  console.log('  Reminders:         GET/POST/DELETE /reminders');
  console.log('  Telegram:          POST /telegram/webhook (public)');
  console.log('  Conversation:      POST /api/chat (x402 + tool router)');
  console.log('\n' + '='.repeat(50) + '\n');
});

// Graceful shutdown — handles both kill and Ctrl+C
function gracefulShutdown(signal) {
  console.log(`${signal} received: shutting down…`);
  const telegramService = require('./services/telegramService');
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
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = server;