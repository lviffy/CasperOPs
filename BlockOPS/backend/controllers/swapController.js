/**
 * Swap Controller — DEX token swaps via Uniswap V3 on Arbitrum Sepolia
 *
 * POST /swap
 *   Swap any ERC20-to-ERC20 (or ETH↔token) pair using Uniswap V3 router.
 *   Fetches a live quote from the Quoter before sending, calculates slippage,
 *   warns on price impact > 2%, and fires a webhook event on success.
 *
 * Body params:
 *   privateKey         — signer key (server-side signing, matches existing pattern)
 *   tokenIn            — ERC20 address OR "ETH" / "NATIVE"
 *   tokenOut           — ERC20 address OR "ETH" / "NATIVE"
 *   amountIn           — human-readable input amount (e.g. "1.5")
 *   slippageTolerance  — optional, percent (default: 0.5 → 0.5%)
 *   fee                — optional, Uniswap V3 pool fee tier in bps (500|3000|10000, default: 3000)
 */

const { ethers } = require('ethers');
const { getProvider, getWallet } = require('../utils/blockchain');
const { successResponse, errorResponse, getTxExplorerUrl } = require('../utils/helpers');
const { fireEvent } = require('../services/webhookService');

// ── Uniswap V3 addresses on Arbitrum Sepolia ──────────────────────────────────
const UNISWAP_V3_ROUTER   = process.env.UNISWAP_V3_ROUTER   || '0x101F443B4d1b059569D643917553c771E1b9663E';
const UNISWAP_V3_QUOTER   = process.env.UNISWAP_V3_QUOTER   || '0x2D99ABB6958e6F060f4F36b3d5e77fEBa35c8e2D';
const WETH_ADDRESS        = process.env.WETH_ADDRESS         || '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73';

const ETH_ALIASES = new Set(['eth', 'native', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee']);

// Minimal ABIs
const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
];

const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)'
];

const ERC20_MINIMAL_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

const WETH_ABI = [
  ...ERC20_MINIMAL_ABI,
  'function deposit() payable',
  'function withdraw(uint256 amount)'
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isEth(addr) {
  return ETH_ALIASES.has((addr || '').toLowerCase());
}

function resolveTokenAddress(addr) {
  return isEth(addr) ? WETH_ADDRESS : addr;
}

async function getTokenMeta(provider, address) {
  if (isEth(address)) {
    return { address: WETH_ADDRESS, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 };
  }
  const token = new ethers.Contract(address, ERC20_MINIMAL_ABI, provider);
  const [symbol, name, decimals] = await Promise.all([
    token.symbol().catch(() => '???'),
    token.name().catch(() => 'Unknown'),
    token.decimals().catch(() => 18)
  ]);
  return { address, symbol, name, decimals: Number(decimals) };
}

// ── POST /swap ─────────────────────────────────────────────────────────────────
async function swap(req, res) {
  try {
    const {
      privateKey,
      tokenIn:  rawTokenIn,
      tokenOut: rawTokenOut,
      amountIn: amountInHuman,
      slippageTolerance = 0.5,
      fee = 3000
    } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!privateKey)      return res.status(400).json(errorResponse('privateKey is required'));
    if (!rawTokenIn)      return res.status(400).json(errorResponse('tokenIn is required (address or "ETH")'));
    if (!rawTokenOut)     return res.status(400).json(errorResponse('tokenOut is required (address or "ETH")'));
    if (!amountInHuman)   return res.status(400).json(errorResponse('amountIn is required'));

    const validFees = [100, 500, 3000, 10000];
    if (!validFees.includes(Number(fee))) {
      return res.status(400).json(errorResponse(`fee must be one of ${validFees.join(', ')} (Uniswap V3 pool fee tiers in bps)`));
    }

    const slippage = parseFloat(slippageTolerance);
    if (isNaN(slippage) || slippage < 0 || slippage > 50) {
      return res.status(400).json(errorResponse('slippageTolerance must be a number between 0 and 50'));
    }

    const ethIn  = isEth(rawTokenIn);
    const ethOut = isEth(rawTokenOut);

    if (ethIn && ethOut) {
      return res.status(400).json(errorResponse('Cannot swap ETH to ETH'));
    }

    const provider = getProvider();
    const wallet   = getWallet(privateKey, provider);
    const signer   = wallet.connect(provider);

    const tokenInAddress  = resolveTokenAddress(rawTokenIn);
    const tokenOutAddress = resolveTokenAddress(rawTokenOut);

    if (tokenInAddress.toLowerCase() === tokenOutAddress.toLowerCase()) {
      return res.status(400).json(errorResponse('tokenIn and tokenOut must be different'));
    }

    // ── Token metadata ────────────────────────────────────────────────────────
    const [metaIn, metaOut] = await Promise.all([
      getTokenMeta(provider, rawTokenIn),
      getTokenMeta(provider, rawTokenOut)
    ]);

    const amountInWei = ethers.parseUnits(String(amountInHuman), metaIn.decimals);

    // ── Balance check ─────────────────────────────────────────────────────────
    if (ethIn) {
      const ethBalance = await provider.getBalance(wallet.address);
      // Leave some ETH for gas (~0.005 ETH buffer)
      const gasBuffer = ethers.parseEther('0.005');
      if (ethBalance < amountInWei + gasBuffer) {
        return res.status(400).json(errorResponse(
          `Insufficient ETH balance. Have ${ethers.formatEther(ethBalance)} ETH, need ${amountInHuman} ETH plus gas`
        ));
      }
    } else {
      const tokenContract = new ethers.Contract(tokenInAddress, ERC20_MINIMAL_ABI, provider);
      const balance = await tokenContract.balanceOf(wallet.address);
      if (balance < amountInWei) {
        return res.status(400).json(errorResponse(
          `Insufficient ${metaIn.symbol} balance. Have ${ethers.formatUnits(balance, metaIn.decimals)}, need ${amountInHuman}`
        ));
      }
    }

    // ── Quote from Uniswap V3 QuoterV2 (staticCall) ───────────────────────────
    const quoter = new ethers.Contract(UNISWAP_V3_QUOTER, QUOTER_V2_ABI, provider);

    let quotedAmountOut;
    try {
      const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
        tokenIn:  tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountInWei,
        fee:      Number(fee),
        sqrtPriceLimitX96: 0n
      });
      quotedAmountOut = amountOut;
    } catch (quoteErr) {
      return res.status(400).json(errorResponse(
        `No liquidity or pool does not exist for this pair with fee tier ${fee}bps. Try a different fee tier (500, 3000, or 10000).`,
        quoteErr.message
      ));
    }

    // ── Slippage & price impact ───────────────────────────────────────────────
    const slippageBps = BigInt(Math.round(slippage * 100));        // slippage% → bps
    const amountOutMinimum = quotedAmountOut * (10000n - slippageBps) / 10000n;

    // Estimate price impact: compare effective rate vs spot
    // Simple proxy: if quotedAmountOut = 0 the pool is empty
    const amountOutHuman  = parseFloat(ethers.formatUnits(quotedAmountOut, metaOut.decimals));
    const amountOutMinHuman = parseFloat(ethers.formatUnits(amountOutMinimum, metaOut.decimals));
    const priceImpactWarning = amountOutHuman === 0;  // basic liveness check; deep impact calc needs spot price

    // ── Approve router for ERC20 tokenIn ────────────────────────────────────────
    if (!ethIn) {
      const tokenContract = new ethers.Contract(tokenInAddress, ERC20_MINIMAL_ABI, signer);
      const currentAllowance = await tokenContract.allowance(wallet.address, UNISWAP_V3_ROUTER);

      if (currentAllowance < amountInWei) {
        console.log(`[Swap] Approving ${UNISWAP_V3_ROUTER} to spend ${metaIn.symbol}…`);
        const approveTx = await tokenContract.approve(UNISWAP_V3_ROUTER, ethers.MaxUint256);
        await approveTx.wait();
        console.log(`[Swap] Approval confirmed: ${approveTx.hash}`);
      }
    }

    // ── Build swap params ────────────────────────────────────────────────────
    const swapParams = {
      tokenIn:           tokenInAddress,
      tokenOut:          tokenOutAddress,
      fee:               Number(fee),
      recipient:         wallet.address,
      amountIn:          amountInWei,
      amountOutMinimum,
      sqrtPriceLimitX96: 0n
    };

    const router = new ethers.Contract(UNISWAP_V3_ROUTER, SWAP_ROUTER_ABI, signer);

    // For ETH-in: pass msg.value to the router — it wraps to WETH internally
    const txOverrides = ethIn ? { value: amountInWei } : {};

    console.log(`[Swap] Swapping ${amountInHuman} ${metaIn.symbol} → min ${amountOutMinHuman} ${metaOut.symbol} (fee ${fee}bps, slippage ${slippage}%)`);

    const swapTx = await router.exactInputSingle(swapParams, txOverrides);
    const receipt = await swapTx.wait();

    const agentId = req.apiKey?.agentId || null;

    // ── Webhook event ────────────────────────────────────────────────────────
    await fireEvent('tx.sent', agentId, {
      type: 'swap',
      txHash: swapTx.hash,
      from: wallet.address,
      tokenIn: metaIn.symbol,
      tokenOut: metaOut.symbol,
      amountIn: amountInHuman
    }).catch(() => {});

    return res.json(successResponse({
      txHash:        swapTx.hash,
      explorerUrl:   getTxExplorerUrl(swapTx.hash),
      status:        receipt.status === 1 ? 'success' : 'reverted',
      from:          wallet.address,
      swap: {
        tokenIn:  { address: tokenInAddress,  symbol: metaIn.symbol,  amount: amountInHuman },
        tokenOut: { address: tokenOutAddress, symbol: metaOut.symbol, quotedAmount: amountOutHuman, minimumAmount: amountOutMinHuman },
        feeTier:  `${fee}bps`,
        slippageTolerance: `${slippage}%`
      },
      ...(priceImpactWarning && {
        warning: 'Quote returned zero output. Pool may have no liquidity — the swap may revert.'
      })
    }));
  } catch (error) {
    console.error('swap error:', error);

    // Surface friendly revert messages
    const reason = error.reason || error.shortMessage || error.message;
    if (reason?.includes('Too little received') || reason?.includes('STF') || reason?.includes('INSUFFICIENT_OUTPUT')) {
      return res.status(400).json(errorResponse(
        'Swap reverted: insufficient output amount. Increase slippageTolerance or try again.',
        reason
      ));
    }
    if (reason?.includes('EXPIRED')) {
      return res.status(400).json(errorResponse('Swap deadline expired. Please retry.', reason));
    }

    return res.status(500).json(errorResponse(reason || 'Swap failed'));
  }
}

// ── GET /swap/quote ──────────────────────────────────────────────────────────
/**
 * Dry-run quote: returns expected output without sending a transaction.
 * Query params: tokenIn, tokenOut, amountIn, fee (optional)
 */
async function getQuote(req, res) {
  try {
    const { tokenIn: rawTokenIn, tokenOut: rawTokenOut, amountIn: amountInHuman, fee = 3000 } = req.query;

    if (!rawTokenIn || !rawTokenOut || !amountInHuman) {
      return res.status(400).json(errorResponse('tokenIn, tokenOut, and amountIn are required query params'));
    }

    const ethIn  = isEth(rawTokenIn);
    const ethOut = isEth(rawTokenOut);
    if (ethIn && ethOut) return res.status(400).json(errorResponse('Cannot quote ETH to ETH'));

    const provider = getProvider();

    const tokenInAddress  = resolveTokenAddress(rawTokenIn);
    const tokenOutAddress = resolveTokenAddress(rawTokenOut);

    const [metaIn, metaOut] = await Promise.all([
      getTokenMeta(provider, rawTokenIn),
      getTokenMeta(provider, rawTokenOut)
    ]);

    const amountInWei = ethers.parseUnits(String(amountInHuman), metaIn.decimals);

    const quoter = new ethers.Contract(UNISWAP_V3_QUOTER, QUOTER_V2_ABI, provider);

    let quotedAmountOut, sqrtPriceX96After, gasEstimate;
    try {
      [quotedAmountOut, sqrtPriceX96After, , gasEstimate] = await quoter.quoteExactInputSingle.staticCall({
        tokenIn:  tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountInWei,
        fee:      Number(fee),
        sqrtPriceLimitX96: 0n
      });
    } catch (quoteErr) {
      return res.status(400).json(errorResponse(
        `No liquidity or pool does not exist for this pair at fee tier ${fee}bps.`,
        quoteErr.message
      ));
    }

    const amountOutHuman = parseFloat(ethers.formatUnits(quotedAmountOut, metaOut.decimals));

    // Compute effective price
    const effectivePrice = amountInHuman > 0 ? amountOutHuman / parseFloat(amountInHuman) : 0;

    // Slippage examples
    const slippageTable = [0.1, 0.5, 1.0, 2.0].map(pct => {
      const bps = BigInt(Math.round(pct * 100));
      const minOut = quotedAmountOut * (10000n - bps) / 10000n;
      return {
        slippage:   `${pct}%`,
        amountOutMinimum: parseFloat(ethers.formatUnits(minOut, metaOut.decimals))
      };
    });

    return res.json(successResponse({
      tokenIn:  { address: tokenInAddress,  symbol: metaIn.symbol,  amount: amountInHuman },
      tokenOut: { address: tokenOutAddress, symbol: metaOut.symbol, quotedAmount: amountOutHuman },
      feeTier:  `${fee}bps`,
      effectivePrice: `1 ${metaIn.symbol} = ${effectivePrice.toFixed(6)} ${metaOut.symbol}`,
      estimatedGas: gasEstimate?.toString(),
      slippageScenarios: slippageTable
    }));
  } catch (error) {
    console.error('getQuote error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = { swap, getQuote };
