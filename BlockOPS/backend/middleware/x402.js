/**
 * x402 challenge middleware. When a paid tool is invoked without a verified
 * payment deploy, the middleware responds with HTTP 402 Payment Required and
 * a Casper deploy template the client can sign via CSPR.click.
 *
 * See docs/x402.md for the full spec.
 *
 * Usage:
 *   const { x402Challenge } = require('./middleware/x402');
 *   app.use('/v1/tools/:toolId', x402Challenge());
 *
 * The middleware is a no-op for free tools. For paid tools, it:
 *   1. Skips if X-Casper-Payment-Deploy-Hash is present (the verify
 *      middleware will validate it).
 *   2. Otherwise responds with 402 + deploy template.
 */

const { getToolPrice, motesToCspr, CASPER_NETWORK_CONFIG } = require('../utils/chains');

function x402Challenge({
  recipientPublicKey = process.env.CASPER_PAYMENT_RECIPIENT_PUBLIC_KEY ||
    '010101010101010101010101010101010101010101010101010101010101010101',
  tokenContractHash = process.env.CASPER_CEP18_CONTRACT_HASH,
  chainName = 'casper-test',
} = {}) {
  return function x402ChallengeMiddleware(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    if (req.path === '/pricing' || req.path === '/verify') return next();

    const toolId =
      req.params?.toolId ||
      req.body?.tool ||
      req.body?.toolId ||
      req.query?.tool ||
      req.query?.toolId;

    if (!toolId) return next();

    const price = getToolPrice(toolId);
    if (price.tier === 'free' || price.priceMotes === 0) return next();

    const paymentHeader = req.header('X-Casper-Payment-Deploy-Hash');
    if (paymentHeader) return next();

    const challenge = buildChallenge({
      toolId,
      priceMotes: price.priceMotes,
      recipientPublicKey,
      tokenContractHash,
      chainName,
    });

    res.set('X-Casper-Tool-Id', toolId);
    res.set('X-Casper-Price-Cspr', motesToCspr(price.priceMotes));
    return res.status(402).json(challenge);
  };
}

function buildChallenge({
  toolId,
  priceMotes,
  recipientPublicKey,
  tokenContractHash,
  chainName,
}) {
  // Use the CEP-18 token contract for CSPR/CEP-18 token payments. Fall back
  // to a native CSPR transfer entry point when no token contract is
  // configured (suitable for the very first deploys on a fresh testnet).
  const isTokenTransfer = !!tokenContractHash;
  const deployTemplate = isTokenTransfer
    ? {
        contractHash: tokenContractHash,
        entryPoint: 'transfer',
        args: {
          recipient: recipientPublicKey,
          amount: String(priceMotes),
        },
        chainName,
      }
    : {
        // Native CSPR transfer (no entry point — Casper uses a special
        // "transfer" wasm for native CSPR).
        contractHash: null,
        entryPoint: 'transfer',
        args: {
          recipient: recipientPublicKey,
          amount: String(priceMotes),
        },
        chainName,
      };

  return {
    toolId,
    priceCspr: motesToCspr(priceMotes),
    priceMotes: String(priceMotes),
    payToPublicKey: recipientPublicKey,
    chainName,
    rpcUrl: CASPER_NETWORK_CONFIG.rpcUrl,
    deployTemplate,
    memo: `BlockOps tool payment: ${toolId}`,
    instructions: isTokenTransfer
      ? 'Sign the deployTemplate via CSPR.click and broadcast with sendDeploy(). Retry this request with X-Casper-Payment-Deploy-Hash set to the resulting deploy hash.'
      : 'Native CSPR transfer: sign the deploy via CSPR.click using a transfer deploy with the recipient + amount above. Retry this request with X-Casper-Payment-Deploy-Hash set to the resulting deploy hash.',
  };
}

module.exports = {
  x402Challenge,
  buildChallenge,
};
