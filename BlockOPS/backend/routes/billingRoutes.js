/**
 * Billing routes (Phase 31).
 *
 * Three endpoints:
 *
 *   POST /billing/checkout
 *     Body: { tier: 'pro' | 'enterprise' }
 *     Auth: requires a valid x-api-key OR a wallet signature (CSPR.click)
 *     Returns: { ok, url } — the frontend redirects to `url`
 *
 *   POST /billing/webhook
 *     Auth: Stripe signature verification (no x-api-key needed)
 *     Idempotent: re-deliveries of the same event are no-ops
 *     Updates Supabase `agent_api_keys.tier` based on the event type
 *
 *   POST /billing/cancel
 *     Body: { stripeSubscriptionId }
 *     Auth: x-api-key (must match the key that has the subscription)
 *     Returns: { ok, status, cancelAt }
 *
 *   GET /billing/invoices
 *     Auth: x-api-key
 *     Returns: { ok, invoices: [...] } — the user's Stripe invoices
 *
 *   GET /billing/me
 *     Auth: x-api-key
 *     Returns: { ok, tier, stripeCustomerId, stripeSubscriptionId, status }
 *
 * Env vars (production):
 *   STRIPE_SECRET_KEY         sk_live_...
 *   STRIPE_WEBHOOK_SECRET     whsec_...
 *   STRIPE_PRICE_PRO_MONTHLY  price_...
 *   STRIPE_SUCCESS_URL        https://blockops.example/billing?status=success
 *   STRIPE_CANCEL_URL         https://blockops.example/billing?status=cancelled
 *
 * In dev / CI (`STRIPE_DISABLED=1` or no key) every endpoint returns
 * a mocked response so the frontend can develop against it without
 * a Stripe account.
 */

const express = require('express');
const crypto = require('crypto');
const stripeService = require('../services/stripeService');
const supabase = require('../config/supabase');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const { logger } = require('../utils/logger');

const router = express.Router();

// Stripe webhooks need the raw body for signature verification, so
// this route mounts a per-route raw parser instead of the global
// express.json(). The webhook handler below grabs req.body, which is
// a Buffer at this point.
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const verification = stripeService.verifyWebhook(req.body, signature);
    if (!verification.ok) {
      logger.warn?.({ err: verification.error }, 'stripe webhook signature failed');
      return res.status(400).json({ ok: false, error: verification.error });
    }
    const event = verification.event;
    const transition = stripeService.eventToTierTransition(event);
    if (!transition.handled) {
      // Idempotent ack — Stripe expects 2xx for unhandled events so
      // it doesn't retry forever.
      return res.json({
        ok: true,
        ignored: true,
        reason: transition.reason || 'unhandled event type',
        eventId: event.id,
      });
    }
    if (!supabase) {
      logger.warn?.({ transition }, 'stripe webhook reached but Supabase not configured');
      return res.status(503).json({ ok: false, error: 'supabase not configured' });
    }
    try {
      // Look up the api_key row by userId (set via Phase 29 api_keys
      // table — `user_id` is the CSPR.click wallet address). We
      // update every key owned by this user so the tier propagates
      // correctly even if the user has multiple keys.
      const { error: updateErr } = await supabase
        .from('agent_api_keys')
        .update({
          tier: transition.tier,
          stripe_customer_id: transition.stripeCustomerId || null,
          stripe_subscription_id: transition.stripeSubscriptionId || null,
          last_billing_event_at: new Date().toISOString(),
        })
        .eq('user_id', transition.userId);
      if (updateErr) {
        logger.error?.({ event: event.id, err: updateErr.message }, 'stripe webhook DB update failed');
        return res.status(500).json({ ok: false, error: 'database update failed' });
      }
      // Fire-and-forget dunning email on payment_failed.
      if (event.type === 'invoice.payment_failed') {
        sendDunningEmail(transition).catch((err) =>
          logger.warn?.({ err: err.message }, 'dunning email send failed'),
        );
      }
      logger.info?.({
        event: event.id, type: event.type, userId: transition.userId, tier: transition.tier,
      }, 'stripe webhook processed');
      return res.json({
        ok: true,
        eventId: event.id,
        idempotencyKey: stripeService.eventIdempotencyKey(event),
        tier: transition.tier,
      });
    } catch (err) {
      logger.error?.({ event: event.id, err: err.message }, 'stripe webhook handler crashed');
      return res.status(500).json({ ok: false, error: err.message });
    }
  },
);

// All routes below this point require a valid API key.
router.use(apiKeyAuth());

router.post('/checkout', async (req, res) => {
  const { tier } = req.body || {};
  if (!['pro', 'enterprise'].includes(tier)) {
    return res.status(400).json({ ok: false, error: 'tier must be "pro" or "enterprise"' });
  }
  const idempotencyKey = `co_${req.apiKey.keyId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const result = await stripeService.createCheckoutSession({
    tier,
    userId: req.apiKey.userId,
    email: req.apiKey.userEmail,
    idempotencyKey,
  });
  if (!result.ok) {
    return res.status(500).json({ ok: false, error: result.error });
  }
  return res.json({
    ok: true,
    url: result.url,
    mock: !!result.mock,
    enterprise: !!result.enterprise,
  });
});

router.post('/cancel', async (req, res) => {
  const { stripeSubscriptionId } = req.body || {};
  if (!stripeSubscriptionId) {
    return res.status(400).json({ ok: false, error: 'stripeSubscriptionId is required' });
  }
  const result = await stripeService.cancelSubscription({ stripeSubscriptionId });
  if (!result.ok) {
    return res.status(500).json({ ok: false, error: result.error });
  }
  return res.json({ ok: true, status: result.status, cancelAt: result.cancelAt });
});

router.get('/invoices', async (req, res) => {
  const result = await stripeService.listInvoices({
    stripeCustomerId: req.apiKey.stripeCustomerId,
  });
  if (!result.ok) {
    return res.status(500).json({ ok: false, error: result.error });
  }
  return res.json({ ok: true, invoices: result.invoices, mock: !!result.mock });
});

router.get('/me', async (req, res) => {
  return res.json({
    ok: true,
    tier: req.apiKey.tier || 'free',
    stripeCustomerId: req.apiKey.stripeCustomerId || null,
    stripeSubscriptionId: req.apiKey.stripeSubscriptionId || null,
    userId: req.apiKey.userId,
    keyId: req.apiKey.keyId,
  });
});

// ── dunning email ──────────────────────────────────────────────────────

async function sendDunningEmail(transition) {
  // Best-effort: never throw to the webhook handler. We don't
  // require any external dependency here — the existing email
  // service is loaded lazily so a CI run without `nodemailer`
  // configured still works.
  const { sendEmail } = require('../services/emailService');
  if (!sendEmail) return;
  const to = transition.userEmail || transition.userId;
  const subject = 'Your BlockOps payment failed — please update your card';
  const text = [
    `Hi there,`,
    ``,
    `We tried to charge your card for the BlockOps Pro subscription but the payment failed.`,
    `Your account is in a past_due state. To avoid service interruption, please update your card:`,
    ``,
    `  https://blockops.example/billing`,
    ``,
    `If you have any questions, reply to this email or ping #blockops-help on Discord.`,
    ``,
    `— The BlockOps team`,
  ].join('\n');
  await sendEmail({ to, subject, text });
}

module.exports = router;