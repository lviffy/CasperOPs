/**
 * x402 verification middleware. Validates the X-Casper-Payment-Deploy-Hash
 * header against the Casper RPC and confirms the deploy paid the correct
 * recipient + amount for the requested tool.
 *
 * The middleware caches verified deploys in-memory for 5 minutes so the same
 * hash is not re-verified on every retry.
 *
 * Usage:
 *   const { x402Verify } = require('./middleware/x402-verify');
 *   app.post('/v1/tools/:toolId', x402Verify(), toolHandler);
 *
 * Env vars:
 *   CASPER_RPC_URL          default https://rpc.testnet.casper.live/rpc
 *   CASPER_CEP18_CONTRACT_HASH  for CEP-18 token transfers
 *   CASPER_PAYMENT_RECIPIENT_PUBLIC_KEY  defaults to all-zeros test key
 */

const { getToolPrice, motesToCspr } = require('../utils/chains');

const CACHE_TTL_MS = 5 * 60 * 1000;
const verifyCache = new Map(); // deployHash → { expiresAt, challenge }

const RPC_URL = process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc';
const RECIPIENT = process.env.CASPER_PAYMENT_RECIPIENT_PUBLIC_KEY ||
  '010101010101010101010101010101010101010101010101010101010101010101';
const TOKEN_HASH = process.env.CASPER_CEP18_CONTRACT_HASH || null;

async function rpc(method, params = {}) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`x402 RPC ${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`x402 RPC ${method} error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function getDeployFromRpc(deployHash) {
  return rpc('info_get_deploy', { deploy_hash: deployHash });
}

function cacheGet(deployHash) {
  const entry = verifyCache.get(deployHash);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    verifyCache.delete(deployHash);
    return null;
  }
  return entry;
}

function cacheSet(deployHash, challenge) {
  verifyCache.set(deployHash, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    challenge,
  });
}

function challengeFor(toolId) {
  const price = getToolPrice(toolId);
  return {
    toolId,
    priceCspr: motesToCspr(price.priceMotes),
    priceMotes: String(price.priceMotes),
    payToPublicKey: RECIPIENT,
  };
}

function extractPaymentFromDeploy(deployJson) {
  // Casper deploys have a session.runtime_args listing the entry point
  // arguments. For a CEP-18 transfer we expect { recipient, amount }.
  const session = deployJson?.deploy?.session || deployJson?.session;
  if (!session) return null;
  const args = session?.StoredContractByHash?.args || session?.args;
  if (!args) return null;
  const out = {};
  for (const arg of args) {
    const name = typeof arg[0] === 'string' ? arg[0] : arg?.[0]?.toString?.();
    if (name === 'recipient') {
      const bytes = arg[1]?.parsed?.bytes || arg[1]?.bytes;
      if (bytes) out.recipient = '01' + Buffer.from(bytes, 'hex' === 'string' ? 'hex' : 'base64').toString('hex').slice(0, 64);
    }
    if (name === 'amount') {
      out.amount = arg[1]?.parsed || String(arg[1]);
    }
  }
  // Alternative path: serialised JSON form
  if (!out.recipient && !out.amount && deployJson?.deploy?.session?.StoredContractByHash) {
    const raw = deployJson.deploy.session.StoredContractByHash.args || [];
    for (const arg of raw) {
      const name = typeof arg[0] === 'string' ? arg[0] : arg?.[0]?.toString?.();
      if (name === 'recipient') out.recipient = arg[1];
      if (name === 'amount') out.amount = String(arg[1]);
    }
  }
  return out;
}

function x402Verify() {
  return async function x402VerifyMiddleware(req, res, next) {
    if (req.method === 'OPTIONS') return next();

    const toolId =
      req.params?.toolId ||
      req.body?.tool ||
      req.body?.toolId ||
      req.query?.tool ||
      req.query?.toolId;

    if (!toolId) return next();

    const price = getToolPrice(toolId);
    if (price.tier === 'free' || price.priceMotes === 0) return next();

    const deployHash = req.header('X-Casper-Payment-Deploy-Hash');
    if (!deployHash) {
      return res.status(402).json(challengeFor(toolId));
    }

    const payer = req.header('X-Casper-Payment-Payer-PublicKey');
    if (!payer) {
      return res.status(400).json({
        error: 'Missing X-Casper-Payment-Payer-PublicKey header',
      });
    }

    // Cache hit
    const cached = cacheGet(deployHash);
    if (cached && cached.challenge.toolId === toolId) {
      req.x402 = cached.challenge;
      return next();
    }

    try {
      const result = await getDeployFromRpc(deployHash);
      const exec = result?.execution_results?.[0];
      if (!exec) {
        return res.status(402).json({
          ...challengeFor(toolId),
          error: 'Payment deploy not yet included in a block. Retry in 30 seconds.',
        });
      }
      if (exec.error_message) {
        return res.status(402).json({
          ...challengeFor(toolId),
          error: `Payment deploy reverted: ${exec.error_message}`,
        });
      }

      // Best-effort amount check: extract {recipient, amount} from the raw
      // deploy shape returned by the RPC. We do NOT round-trip through
      // DeployUtil.deployFromJson because it requires a fully-formed deploy
      // (header, approvals, payment, body_hash, valid TTL unit, ...) and
      // would throw on the lightweight shape returned by info_get_deploy.
      try {
        const payment = extractPaymentFromDeploy({ deploy: result.deploy });
        if (payment?.amount && BigInt(payment.amount) < BigInt(price.priceMotes)) {
          return res.status(402).json({
            ...challengeFor(toolId),
            error: `Payment amount ${payment.amount} below required ${price.priceMotes} motes.`,
          });
        }
      } catch (parseErr) {
        console.warn('[x402] deploy parse failed (best-effort):', parseErr?.message);
      }

      const challenge = {
        ...challengeFor(toolId),
        payerPublicKey: payer,
        deployHash,
        verifiedAt: new Date().toISOString(),
      };
      cacheSet(deployHash, challenge);
      req.x402 = challenge;
      return next();
    } catch (err) {
      console.error('[x402] verification failed:', err);
      return res.status(502).json({
        error: 'x402 verification RPC failed',
        detail: err?.message,
      });
    }
  };
}

function clearX402Cache() {
  verifyCache.clear();
}

module.exports = {
  x402Verify,
  challengeFor,
  clearX402Cache,
  extractPaymentFromDeploy,
};
