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
const { CLPublicKey } = require('casper-js-sdk');

const CACHE_TTL_MS = 5 * 60 * 1000;
const verifyCache = new Map(); // deployHash → { expiresAt, challenge }

const RPC_URL = process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc';
const RECIPIENT = process.env.CASPER_PAYMENT_RECIPIENT_PUBLIC_KEY ||
  '010101010101010101010101010101010101010101010101010101010101010101';
const TOKEN_HASH = process.env.CASPER_CEP18_CONTRACT_HASH || null;

const RECIPIENT_ACCOUNT_HASH = (() => {
  try {
    return CLPublicKey.fromHex(RECIPIENT).toAccountHashStr();
  } catch (err) {
    console.warn('[x402] failed to derive account hash for recipient:', err?.message);
    return '';
  }
})();

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
  const session = deployJson?.deploy?.session || deployJson?.session;
  if (!session) return null;

  // Handles StoredContractByHash, StoredContractByName, Transfer, etc.
  const contractCall = session?.StoredContractByHash || 
                       session?.StoredContractByName || 
                       session?.StoredVersionedContractByHash || 
                       session?.StoredVersionedContractByName ||
                       session?.Transfer;

  const args = contractCall?.args || session?.args || session?.Transfer?.args;
  if (!args) return null;

  const out = {};
  for (const arg of args) {
    const name = typeof arg[0] === 'string' ? arg[0] : arg?.[0]?.toString?.();
    if (name === 'recipient' || name === 'target') {
      const val = arg[1];
      const bytes = val?.bytes || val?.parsed?.bytes;
      if (bytes) {
        // Casper RPC always returns bytes as a hex string.
        const hex = Buffer.from(bytes, 'hex').toString('hex');
        if (hex.length === 64) {
          out.recipient = '01' + hex;
        } else {
          out.recipient = hex;
        }
      } else if (val?.parsed) {
        out.recipient = typeof val.parsed === 'string' ? val.parsed : JSON.stringify(val.parsed);
      } else if (typeof val === 'string') {
        out.recipient = val;
      }
    }
    if (name === 'amount') {
      const val = arg[1];
      out.amount = val?.parsed !== undefined ? String(val.parsed) : String(val);
    }
  }

  // Alternative path: serialised JSON form fallback
  if (!out.recipient && !out.amount) {
    const raw = args || [];
    for (const arg of raw) {
      const name = typeof arg[0] === 'string' ? arg[0] : arg?.[0]?.toString?.();
      if (name === 'recipient' || name === 'target') out.recipient = arg[1];
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

      const errorMessage = exec?.result?.Failure?.error_message || exec?.error_message;
      if (errorMessage) {
        return res.status(402).json({
          ...challengeFor(toolId),
          error: `Payment deploy reverted: ${errorMessage}`,
        });
      }

      // Verify deploy signer matches the payer header
      const deploySigner = result?.deploy?.header?.account;
      if (deploySigner && deploySigner.toLowerCase() !== payer.toLowerCase()) {
        return res.status(402).json({
          ...challengeFor(toolId),
          error: `Payment deploy signer ${deploySigner} does not match expected payer ${payer}.`,
        });
      }

      const payment = extractPaymentFromDeploy({ deploy: result.deploy });
      if (!payment) {
        return res.status(402).json({
          ...challengeFor(toolId),
          error: 'Could not extract payment details from deploy.',
        });
      }

      const cleanKey = (str) => {
        if (!str) return '';
        let cleaned = str.toLowerCase().replace(/^account-hash-/, '');
        if (cleaned.length === 66 && (cleaned.startsWith('01') || cleaned.startsWith('02'))) {
          cleaned = cleaned.slice(2);
        }
        return cleaned;
      };

      // Verify recipient matches expected treasury (normalizing account hashes and public keys)
      const expectedRecipient = cleanKey(RECIPIENT);
      const expectedRecipientHash = cleanKey(RECIPIENT_ACCOUNT_HASH);
      const actualRecipient = cleanKey(payment.recipient);

      if (
        actualRecipient !== expectedRecipient &&
        actualRecipient !== expectedRecipientHash
      ) {
        return res.status(402).json({
          ...challengeFor(toolId),
          error: `Payment recipient ${payment.recipient} does not match expected recipient ${RECIPIENT}.`,
        });
      }

      // Verify amount is sufficient
      if (!payment.amount) {
        return res.status(402).json({
          ...challengeFor(toolId),
          error: 'Could not extract payment amount from deploy.',
        });
      }

      if (BigInt(payment.amount) < BigInt(price.priceMotes)) {
        return res.status(402).json({
          ...challengeFor(toolId),
          error: `Payment amount ${payment.amount} below required ${price.priceMotes} motes.`,
        });
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
