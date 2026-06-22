/**
 * x402 refund middleware.
 *
 * Wraps a paid-tool handler so that any thrown error after a verified payment
 * triggers a refund: a native CSPR transfer deploy from the backend treasury
 * (signed by `backend/services/backendSigner.js`) back to the original payer.
 *
 * Spec: `docs/x402.md` §9 mentions this as the refund flow for failed tool
 * executions. This module implements the production version.
 *
 * Usage:
 *   const { x402Verify } = require('./middleware/x402-verify');
 *   const { withRefundOnFailure, broadcastRefund } = require('./middleware/x402-refund');
 *   app.post(
 *     '/v1/tools/:toolId',
 *     x402Verify(),
 *     withRefundOnFailure(),
 *     toolHandler,
 *   );
 *
 * Env vars:
 *   CASPER_RPC_URL                       default https://rpc.testnet.casper.live/rpc
 *   CASPER_SECRET_KEY                     hex secret for the treasury signer
 *                                         (also gates `backendSigner`)
 *   REFUND_PAYMENT_AMOUNT_MOTES           override the default "full price"
 *                                         refund amount (per tool). Defaults to
 *                                         `x402.challenge.priceMotes`.
 *   REFUND_ENABLED=false                  escape hatch to disable refunds in
 *                                         load tests / sandbox envs
 *
 * Refund deploy shape:
 *   - Payment on x402 is a CEP-18 `transfer` deploy, paid to the treasury
 *     (`payToPublicKey`). The simplest refund is a native CSPR transfer back
 *     from the treasury to the original payer. This module does that.
 *   - For CEP-18 refunds (token-in, token-out) callers can wire a custom
 *     refund builder via `buildRefundDeploy` export.
 */

const { DeployUtil, RuntimeArgs, CLValueBuilder, CLPublicKey } = require('casper-js-sdk');
const { getToolPrice, motesToCspr } = require('../utils/chains');
const backendSigner = require('../services/backendSigner');

const REFUND_DEPLOY_TTL_MS = 60 * 60 * 1000; // 1 hour
const PAYMENT_AMOUNT_MOTES_DEFAULT_FALLBACK = 0n;

function isRefundEnabled() {
  const flag = String(process.env.REFUND_ENABLED ?? 'true').toLowerCase();
  return flag !== 'false' && flag !== '0' && flag !== 'no';
}

async function rpc(method, params = {}) {
  const rpcUrl = process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc';
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`x402-refund RPC ${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`x402-refund RPC ${method} error: ${JSON.stringify(json.error)}`);
  return json.result;
}

/**
 * Build an unsigned native CSPR transfer deploy from `from` (treasury) to
 * `to` (payer). The returned deploy is signed by `backendSigner.signDeploy`
 * before being broadcast.
 */
function buildRefundDeploy({ payerPublicKey, amountMotes }) {
  const keys = backendSigner.getKeys();
  const params = new DeployUtil.DeployParams(
    keys.publicKey,
    backendSigner.getChainName(),
    // Casper TTL is `u64` ms; default 1h keeps the refund valid for the next
    // block under load.
    REFUND_DEPLOY_TTL_MS,
  );
  const session = DeployUtil.ExecutableDeployItem.newTransfer(
    amountMotes,
    keys.publicKey,
    CLPublicKey.fromHex(payerPublicKey),
    undefined, // no transfer id
  );
  const payment = DeployUtil.standardPayment(100_000_000); // 0.1 CSPR
  return DeployUtil.makeDeploy(params, session, payment);
}

/**
 * Sign and broadcast a refund deploy. Returns the refund deploy hash on
 * success. Throws if broadcasting fails (the caller logs + surfaces 502).
 */
async function broadcastRefund({ toolId, payerPublicKey, amountMotes, originalPaymentHash, reason }) {
  if (!isRefundEnabled()) {
    return { skipped: true, reason: 'REFUND_ENABLED=false' };
  }
  if (!payerPublicKey) throw new Error('broadcastRefund: payerPublicKey required');
  if (!amountMotes || BigInt(amountMotes) <= 0n) {
    throw new Error(`broadcastRefund: amountMotes must be > 0, got ${amountMotes}`);
  }
  const deploy = buildRefundDeploy({ payerPublicKey, amountMotes });
  const signed = backendSigner.signDeploy(deploy);
  const deployJson = DeployUtil.deployToJson(signed);
  const result = await rpc('account_put_deploy', deployJson);
  return {
    skipped: false,
    refundDeployHash: result?.deploy_hash,
    toolId,
    payerPublicKey,
    amountMotes: String(amountMotes),
    originalPaymentHash: originalPaymentHash || null,
    reason: reason || 'tool_execution_failed',
    broadcastAt: new Date().toISOString(),
  };
}

/**
 * Express middleware that broadcasts a refund when the downstream handler
 * throws or rejects with a 5xx status. Skipped for:
 *   - requests with no verified payment (req.x402 is absent)
 *   - requests where the handler returned 4xx (those are user errors)
 *   - requests where REFUND_ENABLED=false
 *
 * The refund broadcast is fire-and-forget so a transient RPC failure on the
 * refund path does not mask the original tool error. Errors are logged.
 */
function withRefundOnFailure() {
  return function refundMiddleware(req, res, next) {
    // Capture the original res.json so we can observe the response status.
    const originalJson = res.json.bind(res);
    res.json = function patchedJson(body) {
      res.locals = res.locals || {};
      res.locals.responseBody = body;
      res.locals.responseStatus = res.statusCode;
      return originalJson(body);
    };

    // Wrap res.end so we know the handler actually finished writing.
    const originalEnd = res.end.bind(res);
    res.end = function patchedEnd(...args) {
      const challenge = req.x402;
      const shouldRefund =
        isRefundEnabled() &&
        challenge &&
        challenge.deployHash &&
        challenge.payerPublicKey &&
        (res.statusCode >= 500 || res.locals?.responseStatus >= 500);

      if (shouldRefund) {
        // Fire and forget; never await in the response path.
        refundOnFailure(req, res, challenge).catch((err) => {
          console.error('[x402-refund] fire-and-forget failed:', err?.message);
        });
      }
      return originalEnd(...args);
    };

    next();
  };
}

async function refundOnFailure(req, res, challenge) {
  const amountMotes =
    process.env.REFUND_PAYMENT_AMOUNT_MOTES ||
    challenge.priceMotes ||
    String(PAYMENT_AMOUNT_MOTES_DEFAULT_FALLBACK);
  try {
    const result = await broadcastRefund({
      toolId: challenge.toolId,
      payerPublicKey: challenge.payerPublicKey,
      amountMotes,
      originalPaymentHash: challenge.deployHash,
      reason: res.locals?.responseStatus >= 500
        ? `tool_returned_${res.locals.responseStatus}`
        : 'tool_handler_threw',
    });
    res.setHeader('x-casper-refund-deploy-hash', result.refundDeployHash || '');
    res.setHeader('x-casper-refund-skipped', result.skipped ? 'true' : 'false');
    console.log('[x402-refund]', {
      toolId: challenge.toolId,
      payer: challenge.payerPublicKey,
      amountMotes: String(amountMotes),
      amountCspr: motesToCspr(amountMotes),
      refundHash: result.refundDeployHash,
      skipped: result.skipped,
      originalPayment: challenge.deployHash,
    });
  } catch (err) {
    // Best-effort: do not throw — the original tool error is what matters.
    res.setHeader('x-casper-refund-error', String(err?.message || 'unknown'));
    console.error('[x402-refund] broadcast failed:', err?.message);
  }
}

module.exports = {
  withRefundOnFailure,
  broadcastRefund,
  buildRefundDeploy,
  isRefundEnabled,
};
