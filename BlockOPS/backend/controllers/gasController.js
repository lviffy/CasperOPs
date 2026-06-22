/**
 * Gas Controller — real-time gas pricing and call simulation
 *
 * GET  /gas/estimate          — current base fee + slow/normal/fast priority fee tiers
 * POST /gas/simulate          — estimate gas units for a specific call
 * GET  /gas/history           — base fee trend over recent blocks (last 20)
 */

const { ethers } = require('ethers');
const { getProvider } = require('../utils/blockchain');
const { successResponse, errorResponse } = require('../utils/helpers');
const { getChainFromRequest, getChainMetadata, isArbitrumChain } = require('../utils/chains');

// Arbitrum Sepolia is a rollup — priority fees are near 0 but we still model tiers
const PRIORITY_MULTIPLIERS = { slow: 1n, normal: 2n, fast: 5n };  // in gwei units

// ── GET /gas/estimate ─────────────────────────────────────────────────────────
async function estimateGas(req, res) {
  try {
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);
    const provider = getProvider(chain);
    const feeData = await provider.getFeeData();
    const block = await provider.getBlock('latest');

    if (!feeData.gasPrice && !feeData.maxFeePerGas) {
      return res.status(503).json(errorResponse('Could not retrieve fee data from node'));
    }

    // Arbitrum uses EIP-1559 style fees
    const baseFeeWei = block?.baseFeePerGas ?? feeData.gasPrice ?? 0n;
    const baseFeeGwei = parseFloat(ethers.formatUnits(baseFeeWei, 'gwei'));

    // Build tiers
    const buildTier = (priorityGwei) => {
      const priorityWei = ethers.parseUnits(priorityGwei.toFixed(9), 'gwei');
      const maxFeeWei = baseFeeWei + priorityWei;
      return {
        maxPriorityFeePerGas: `${priorityGwei} gwei`,
        maxFeePerGas: `${parseFloat(ethers.formatUnits(maxFeeWei, 'gwei')).toFixed(4)} gwei`,
        estimatedTxCostEth: {
          transfer: parseFloat(ethers.formatEther(maxFeeWei * 21000n)).toFixed(8),
          erc20Transfer: parseFloat(ethers.formatEther(maxFeeWei * 65000n)).toFixed(8),
          contractDeploy: parseFloat(ethers.formatEther(maxFeeWei * 1500000n)).toFixed(8)
        }
      };
    };

    // Arbitrum priority fees are tiny — typical ~0.01–0.1 gwei
    const priorityBase = parseFloat(ethers.formatUnits(feeData.maxPriorityFeePerGas ?? 10000000n, 'gwei'));

    return res.json(successResponse({
      blockNumber: block?.number,
      baseFee: `${baseFeeGwei.toFixed(6)} gwei`,
      baseFeeWei: baseFeeWei.toString(),
      suggested: {
        slow: buildTier(Math.max(priorityBase * 0.8, 0.001)),
        normal: buildTier(Math.max(priorityBase, 0.001)),
        fast: buildTier(Math.max(priorityBase * 2.5, 0.01))
      },
      note: isArbitrumChain(chain)
        ? 'Arbitrum Sepolia is an L2 rollup and keeps gas costs low.'
        : 'Flow EVM Testnet fee data is shown from the selected RPC endpoint.',
      ...chainMetadata
    }));
  } catch (error) {
    console.error('estimateGas error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ── POST /gas/simulate ────────────────────────────────────────────────────────
/**
 * Estimate gas for a specific call (no tx sent; uses eth_estimateGas).
 * Body: { from, to, data?, value? (ETH string), abi?, functionName?, args? }
 *
 * Two modes:
 *   1. Raw:  { from, to, data }
 *   2. ABI:  { from, to, abi, functionName, args }
 */
async function simulateGas(req, res) {
  try {
    const { from, to, data, value, abi, functionName, args } = req.body;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);

    if (!to) return res.status(400).json(errorResponse('to address is required'));
    if (!ethers.isAddress(to)) return res.status(400).json(errorResponse('Invalid to address'));
    if (from && !ethers.isAddress(from)) return res.status(400).json(errorResponse('Invalid from address'));

    let callData = data || '0x';

    // If ABI + functionName provided, encode the call
    if (abi && functionName) {
      try {
        const iface = new ethers.Interface(abi);
        callData = iface.encodeFunctionData(functionName, args || []);
      } catch (e) {
        return res.status(400).json(errorResponse('Failed to encode ABI call: ' + e.message));
      }
    }

    const provider = getProvider(chain);
    const feeData = await provider.getFeeData();

    const txRequest = {
      to,
      data: callData,
      ...(from ? { from } : {}),
      ...(value ? { value: ethers.parseEther(value.toString()) } : {})
    };

    let gasUnits;
    try {
      gasUnits = await provider.estimateGas(txRequest);
    } catch (e) {
      // Extract revert reason if available
      const revertMsg = e.reason || e.error?.message || e.message;
      return res.status(400).json(errorResponse('Simulation reverted: ' + revertMsg, {
        error: e.code,
        revertMessage: revertMsg
      }));
    }

    const gasWithBuffer = (gasUnits * 120n) / 100n; // +20% buffer

    const baseFeeWei = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const estimatedCostWei = baseFeeWei * gasUnits;
    const estimatedCostWithBufferWei = baseFeeWei * gasWithBuffer;

    return res.json(successResponse({
      to,
      from: from || null,
      functionName: functionName || null,
      gasEstimate: gasUnits.toString(),
      gasEstimateWithBuffer: gasWithBuffer.toString(),
      estimatedCostEth: ethers.formatEther(estimatedCostWei),
      estimatedCostWithBufferEth: ethers.formatEther(estimatedCostWithBufferWei),
      gasPrice: `${parseFloat(ethers.formatUnits(baseFeeWei, 'gwei')).toFixed(4)} gwei`,
      callData,
      ...chainMetadata
    }));
  } catch (error) {
    console.error('simulateGas error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ── GET /gas/history ──────────────────────────────────────────────────────────
async function gasHistory(req, res) {
  try {
    const { blocks = 20 } = req.query;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);
    const count = Math.min(parseInt(blocks) || 20, 50);

    const provider = getProvider(chain);
    const latest = await provider.getBlockNumber();

    const blockNums = Array.from({ length: count }, (_, i) => latest - (count - 1 - i));
    const blockData = await Promise.all(
      blockNums.map(n => provider.getBlock(n).catch(() => null))
    );

    const history = blockData
      .filter(Boolean)
      .map(b => ({
        blockNumber: b.number,
        timestamp: b.timestamp,
        baseFeeGwei: b.baseFeePerGas
          ? parseFloat(ethers.formatUnits(b.baseFeePerGas, 'gwei')).toFixed(6)
          : null,
        txCount: b.transactions.length
      }));

    const validFees = history.map(h => parseFloat(h.baseFeeGwei)).filter(f => !isNaN(f));
    const avg = validFees.length ? (validFees.reduce((a, b) => a + b, 0) / validFees.length).toFixed(6) : null;
    const min = validFees.length ? Math.min(...validFees).toFixed(6) : null;
    const max = validFees.length ? Math.max(...validFees).toFixed(6) : null;

    return res.json(successResponse({
      latestBlock: latest,
      blocksRequested: count,
      stats: { avgBaseFeeGwei: avg, minBaseFeeGwei: min, maxBaseFeeGwei: max },
      history,
      ...chainMetadata
    }));
  } catch (error) {
    console.error('gasHistory error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = { estimateGas, simulateGas, gasHistory };
