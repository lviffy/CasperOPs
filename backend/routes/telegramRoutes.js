/**
 * Telegram Bot Routes
 *
 * POST /telegram/webhook          — receive updates from Telegram (prod webhook mode)
 * GET  /telegram/info             — bot info + webhook status (admin)
 * POST /telegram/send             — push a message to a chatId (admin / internal)
 * POST /telegram/register-webhook — register the webhook URL with Telegram (admin)
 * DELETE /telegram/webhook        — delete the registered webhook (admin)
 */

const express = require('express');
const router  = express.Router();
const {
  processUpdate,
  sendMessage,
  registerWebhook,
  getWebhookInfo,
  getBotInfo,
  stopLongPolling
} = require('../services/telegramService');
const { successResponse, errorResponse } = require('../utils/helpers');

// ── POST /telegram/webhook ────────────────────────────────────────────────────
// Telegram POST's updates here in webhook mode. Must return 200 quickly.
// No API key required — Telegram signs requests implicitly via the secret token path.
router.post('/webhook', async (req, res) => {
  // Respond immediately so Telegram doesn't retry
  res.sendStatus(200);
  // Process async — errors are swallowed to avoid webhook retries
  processUpdate(req.body).catch(e => console.error('[Telegram] processUpdate error:', e.message));
});

// ── GET /telegram/info ────────────────────────────────────────────────────────
router.get('/info', async (req, res) => {
  try {
    const [botInfo, webhookInfo] = await Promise.all([
      getBotInfo().catch(() => null),
      getWebhookInfo().catch(() => null)
    ]);
    return res.json(successResponse({
      bot:     botInfo?.result || null,
      webhook: webhookInfo?.result || null,
      configured: !!process.env.TELEGRAM_BOT_TOKEN
    }));
  } catch (err) {
    return res.status(500).json(errorResponse(err.message));
  }
});

// ── POST /telegram/send ───────────────────────────────────────────────────────
// Body: { chatId, text, parseMode? }
router.post('/send', async (req, res) => {
  const { chatId, text } = req.body;
  if (!chatId) return res.status(400).json(errorResponse('chatId is required'));
  if (!text)   return res.status(400).json(errorResponse('text is required'));

  try {
    await sendMessage(String(chatId), text);
    return res.json(successResponse({ sent: true, chatId, text }));
  } catch (err) {
    return res.status(500).json(errorResponse(err.message));
  }
});

// ── POST /telegram/register-webhook ──────────────────────────────────────────
router.post('/register-webhook', async (req, res) => {
  try {
    await registerWebhook();
    const info = await getWebhookInfo().catch(() => null);
    return res.json(successResponse({
      registered: true,
      webhook: info?.result || null
    }));
  } catch (err) {
    return res.status(500).json(errorResponse(err.message));
  }
});

// ── DELETE /telegram/webhook ──────────────────────────────────────────────────
router.delete('/webhook', async (req, res) => {
  try {
    stopLongPolling();
    const { default: axios } = await import('axios'); // dynamic to avoid circular
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(400).json(errorResponse('TELEGRAM_BOT_TOKEN not configured'));
    await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`);
    return res.json(successResponse({ deleted: true }));
  } catch (err) {
    return res.status(500).json(errorResponse(err.message));
  }
});

module.exports = router;
