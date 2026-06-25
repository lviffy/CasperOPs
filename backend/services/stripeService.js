/**
 * Stripe service wrapper (Phase 31).
 *
 * The backend doesn't talk to the Stripe SDK directly — every Stripe
 * call goes through this module so we can:
 *
 *   1. Inject the API key at boot (no per-call env reads)
 *   2. Centralise idempotency (every Checkout Session + webhook
 *      handler has an explicit `idempotencyKey`)
 *   3. Map Stripe exceptions to a clean `{ok, error, ...}` shape
 *      that the route handlers can return
 *   4. Stub the entire module in tests via `resetForTests()`
 *
 * For local dev / CI we expose `stripeService.isMocked()` so callers
 * can skip Stripe calls without paying the SDK latency.
 *
 * Tier mapping:
 *   free       → no Stripe customer (default)
 *   pro        → Stripe subscription "pro-monthly"
 *   enterprise → manual invoice (no Checkout; sales team wires it)
 *
 * Env vars:
 *   STRIPE_SECRET_KEY         e.g. sk_test_...  / sk_live_...
 *   STRIPE_WEBHOOK_SECRET     e.g. whsec_...
 *   STRIPE_PRICE_PRO_MONTHLY  e.g. price_1ABC...
 *   STRIPE_SUCCESS_URL        default https://casperops.example/billing?status=success
 *   STRIPE_CANCEL_URL         default https://casperops.example/billing?status=cancelled
 *   STRIPE_DISABLED=1         skip all Stripe calls (CI)
 */

const crypto = require('crypto');

let stripeLib = null;
let isMocked = false;

function loadStripe() {
  if (stripeLib !== null) return stripeLib;
  if (process.env.STRIPE_DISABLED === '1' || !process.env.STRIPE_SECRET_KEY) {
    isMocked = true;
    stripeLib = null;
    return null;
  }
  try {
    // eslint-disable-next-line global-require
    stripeLib = require('stripe');
    stripeLib = stripeLib(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
      maxNetworkRetries: 2,
      timeout: 10_000,
    });
    isMocked = false;
  } catch (err) {
    isMocked = true;
    stripeLib = null;
  }
  return stripeLib;
}

function shouldMock() {
  if (process.env.STRIPE_DISABLED === '1') return true;
  if (!process.env.STRIPE_SECRET_KEY) return true;
  return false;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout Session for the requested tier. Returns
 * the redirect URL the frontend should bounce the user to.
 *
 * `tier` is one of 'pro' (Stripe Checkout) or 'enterprise' (returns
 * a special URL pointing to the sales contact form).
 *
 * `userId` is the CasperOPs user — embedded in the session metadata
 * so the webhook handler knows which row to update on
 * `checkout.session.completed`.
 */
async function createCheckoutSession({
  tier,
  userId,
  email,
  successUrl,
  cancelUrl,
  idempotencyKey,
} = {}) {
  if (!tier || !userId) {
    return { ok: false, error: 'tier and userId are required' };
  }

  // Enterprise doesn't go through Checkout — redirect to the sales
  // email instead. We still return a success URL so the frontend can
  // show "we'll be in touch" and the webhook handler doesn't have to
  // know the difference.
  if (tier === 'enterprise') {
    return {
      ok: true,
      url: 'mailto:sales@casperops.example?subject=CasperOPs%20Enterprise%20inquiry',
      mock: isMocked,
      enterprise: true,
    };
  }

  if (tier !== 'pro') {
    return { ok: false, error: `unknown tier: ${tier}` };
  }

  // Mock mode short-circuits BEFORE we require a real price id. In
  // dev / CI the operator often runs without Stripe configured and
  // we don't want the missing-price error to block the frontend.
  if (shouldMock()) {
    return {
      ok: true,
      url: `${successUrl || 'https://casperops.example/billing'}?mock=1`,
      mock: true,
      sessionId: `mock_sess_${crypto.randomBytes(8).toString('hex')}`,
    };
  }

  const priceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
  if (!priceId) {
    return { ok: false, error: 'STRIPE_PRICE_PRO_MONTHLY is not configured' };
  }

  const stripe = loadStripe();
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        customer_email: email || undefined,
        client_reference_id: userId,
        metadata: { userId, tier: 'pro' },
        subscription_data: { metadata: { userId, tier: 'pro' } },
        success_url: successUrl || process.env.STRIPE_SUCCESS_URL || 'https://casperops.example/billing?status=success',
        cancel_url: cancelUrl || process.env.STRIPE_CANCEL_URL || 'https://casperops.example/billing?status=cancelled',
        allow_promotion_codes: true,
      },
      { idempotencyKey: idempotencyKey || `co_${userId}_${Date.now()}` },
    );
    return { ok: true, url: session.url, mock: false, sessionId: session.id };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code, type: err.type };
  }
}

/**
 * Verify a webhook signature. Returns the parsed event on success,
 * `{ok:false}` on a bad signature. Stripe signs the body + timestamp
 * with HMAC-SHA256 using the webhook secret; the SDK does the heavy
 * lifting but we keep the contract explicit for tests.
 */
function verifyWebhook(rawBody, signature) {
  if (shouldMock()) {
    // In mock mode accept anything and parse it as JSON.
    try {
      return { ok: true, event: JSON.parse(rawBody.toString()), mock: true };
    } catch (err) {
      return { ok: false, error: `invalid JSON: ${err.message}` };
    }
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, error: 'STRIPE_WEBHOOK_SECRET is not configured' };
  if (!signature) return { ok: false, error: 'missing Stripe-Signature header' };

  const stripe = loadStripe();
  try {
    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    return { ok: true, event, mock: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Compute a deterministic idempotency key for a given Stripe event
 * id so duplicate deliveries (Stripe retries on 5xx) don't double-
 * process. The webhook handler should use this when calling any
 * side-effectful Supabase update.
 */
function eventIdempotencyKey(event) {
  return `evt_${event.id}`;
}

/**
 * Map a Stripe event to the (userId, tier) pair we should set in
 * Supabase. Returns null for events we don't care about so the
 * handler can early-return without touching the DB.
 */
function eventToTierTransition(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.client_reference_id || session.metadata?.userId;
      if (!userId) return { handled: false, reason: 'no client_reference_id' };
      return {
        handled: true,
        userId,
        tier: 'pro',
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
      };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (!userId) return { handled: false, reason: 'no userId metadata' };
      return {
        handled: true,
        userId,
        tier: 'free',
        stripeCustomerId: sub.customer,
        stripeSubscriptionId: sub.id,
        cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
      };
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (!userId) return { handled: false, reason: 'no userId metadata' };
      // Pro tier covers both `active` and `trialing`. Past-due is
      // handled separately so we don't lock the user out instantly.
      if (sub.status === 'active' || sub.status === 'trialing') {
        return {
          handled: true,
          userId,
          tier: 'pro',
          stripeCustomerId: sub.customer,
          stripeSubscriptionId: sub.id,
        };
      }
      return { handled: false, reason: `subscription status ${sub.status}` };
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      const userId = inv.subscription_details?.metadata?.userId;
      if (!userId) return { handled: false, reason: 'no userId metadata' };
      return {
        handled: true,
        userId,
        tier: 'past_due',
        stripeCustomerId: inv.customer,
        stripeInvoiceId: inv.id,
        amountDueMotes: inv.amount_due || 0,
      };
    }
    default:
      return { handled: false, reason: `unhandled event type: ${event.type}` };
  }
}

/**
 * Cancel a subscription by id. Used by the "Cancel subscription"
 * button on the billing page. Returns `{ok:true}` even if the
 * subscription is already cancelled (idempotent).
 */
async function cancelSubscription({ stripeSubscriptionId }) {
  if (!stripeSubscriptionId) return { ok: false, error: 'stripeSubscriptionId is required' };
  if (shouldMock()) return { ok: true, mock: true };
  const stripe = loadStripe();
  try {
    const sub = await stripe.subscriptions.cancel(stripeSubscriptionId);
    return { ok: true, status: sub.status, cancelAt: sub.cancel_at };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code, type: err.type };
  }
}

/**
 * List the customer's recent invoices. Used by the billing page
 * "Invoices" tab. Returns an empty array when the user has no
 * Stripe customer id (free tier).
 */
async function listInvoices({ stripeCustomerId, limit = 12 } = {}) {
  if (!stripeCustomerId) return { ok: true, invoices: [], mock: shouldMock() };
  if (shouldMock()) return { ok: true, invoices: [], mock: true };
  const stripe = loadStripe();
  try {
    const list = await stripe.invoices.list({ customer: stripeCustomerId, limit });
    return {
      ok: true,
      invoices: list.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        amountDue: inv.amount_due,
        amountPaid: inv.amount_paid,
        currency: inv.currency,
        status: inv.status,
        createdAt: new Date(inv.created * 1000).toISOString(),
        hostedInvoiceUrl: inv.hosted_invoice_url,
        pdfUrl: inv.invoice_pdf,
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function isMockedNow() {
  return shouldMock();
}

// ── test helpers ───────────────────────────────────────────────────────

function _resetForTests() {
  stripeLib = null;
  isMocked = false;
}

function _setMockForTests(mock = true) {
  isMocked = mock;
  if (mock) stripeLib = null;
}

module.exports = {
  createCheckoutSession,
  verifyWebhook,
  eventToTierTransition,
  eventIdempotencyKey,
  cancelSubscription,
  listInvoices,
  isMocked: isMockedNow,
  // internal
  _resetForTests,
  _setMockForTests,
};