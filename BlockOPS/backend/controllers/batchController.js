/**
 * Batch Controller
 *
 * Endpoints:
 *   POST /batch/transfer    — send native ETH to multiple addresses in one Multicall3 tx
 *   POST /batch/transfer-erc20 — send an ERC20 token to multiple addresses (sequential txs)
 *   POST /batch/mint        — mint NFTs to multiple recipients
 *   POST /batch/approve     — batch-approve multiple spenders for an ERC20 token
 *
 * Native ETH batch uses Multicall3 `aggregate3Value` — single on-chain tx, gas efficient.
 * ERC20 / mint / approve use sequential signing (no standard batch ERC20 on Stylus factory).
 */

const { ethers } = require('ethers');
const { getProvider, getWallet, getContract } = require('../utils/blockchain');
const {
  successResponse,
  errorResponse,
  validateRequiredFields,
  getTxExplorerUrl,
  logTransaction
} = require('../utils/helpers');
const { fireEvent } = require('../services/webhookService');
const { ERC20_TOKEN_ABI, ERC721_COLLECTION_ABI } = require('../config/abis');
const { getChainFromRequest, getChainMetadata } = require('../utils/chains');

// ─── Multicall3 ───────────────────────────────────────────────────────────────
// Deployed at the same address on every EVM chain
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

const MULTICALL3_ABI = [
  'function aggregate3Value(tuple(address target, bool allowFailure, uint256 value, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)'
];

// Standard ERC20 ABI (for tokens deployed outside our factory)
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

// ─── POST /batch/transfer ─────────────────────────────────────────────────────
/**
 * Send native ETH to multiple addresses in a single on-chain transaction via Multicall3.
 *
 * Body:
 *   privateKey  string          Signing key
 *   recipients  Array<{ address: string, amount: string }>  ETH amounts in ether units
 *   allowFailure boolean        If true individual calls may fail without reverting whole tx (default: false)
 */
async function batchTransferETH(req, res) {
  try {
    const { privateKey, recipients, allowFailure = false } = req.body;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);

    const validationError = validateRequiredFields(req.body, ['privateKey', 'recipients']);
    if (validationError) return res.status(400).json(validationError);

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json(errorResponse('recipients must be a non-empty array'));
    }
    if (recipients.length > 200) {
      return res.status(400).json(errorResponse('Maximum 200 recipients per batch'));
    }

    // Validate each recipient
    for (const r of recipients) {
      if (!r.address || !r.amount) {
        return res.status(400).json(errorResponse('Each recipient requires address and amount'));
      }
      if (!ethers.isAddress(r.address)) {
        return res.status(400).json(errorResponse(`Invalid address: ${r.address}`));
      }
    }

    const provider = getProvider(chain);
    const wallet = getWallet(privateKey, provider, chain);
    const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, wallet);

    // Calculate total ETH needed
    const totalWei = recipients.reduce((acc, r) => acc + ethers.parseEther(r.amount.toString()), 0n);

    // Check balance
    const balance = await provider.getBalance(wallet.address);
    if (balance < totalWei) {
      return res.status(400).json(
        errorResponse('Insufficient ETH balance', {
          balance: ethers.formatEther(balance),
          required: ethers.formatEther(totalWei)
        })
      );
    }

    logTransaction('Batch Transfer Native Token', { count: recipients.length, totalEth: ethers.formatEther(totalWei), chain });

    // Build Multicall3 call array — each call sends ETH with empty calldata
    const calls = recipients.map(r => ({
      target: r.address,
      allowFailure: !!allowFailure,
      value: ethers.parseEther(r.amount.toString()),
      callData: '0x'
    }));

    const tx = await multicall.aggregate3Value(calls, { value: totalWei });
    const receipt = await tx.wait();

    // Parse results from returnData
    const batchResults = recipients.map((r, i) => ({
      address: r.address,
      amount: r.amount,
      success: true // aggregate3Value reverts the whole tx if allowFailure=false and any call fails
    }));

    const data = {
      type: 'batch_eth',
      transactionHash: receipt.hash,
      from: wallet.address,
      recipientCount: recipients.length,
      totalAmount: ethers.formatEther(totalWei),
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: getTxExplorerUrl(receipt.hash, chain),
      results: batchResults,
      ...chainMetadata
    };

    fireEvent(req.apiKey?.agentId || null, 'tx.confirmed', data);

    return res.json(successResponse(data));

  } catch (error) {
    console.error('Batch transfer ETH error:', error);
    return res.status(500).json(errorResponse(error.message, error.reason || error.code));
  }
}

// ─── POST /batch/transfer-erc20 ───────────────────────────────────────────────
/**
 * Send an ERC20 token to multiple addresses (sequential transactions).
 *
 * Body:
 *   privateKey      string
 *   tokenAddress    string   Standard ERC20 contract address
 *   recipients      Array<{ address: string, amount: string }>  Human-readable token amounts
 */
async function batchTransferERC20(req, res) {
  try {
    const { privateKey, tokenAddress, recipients } = req.body;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);

    const validationError = validateRequiredFields(req.body, ['privateKey', 'tokenAddress', 'recipients']);
    if (validationError) return res.status(400).json(validationError);

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json(errorResponse('recipients must be a non-empty array'));
    }
    if (recipients.length > 100) {
      return res.status(400).json(errorResponse('Maximum 100 recipients per ERC20 batch'));
    }
    if (!ethers.isAddress(tokenAddress)) {
      return res.status(400).json(errorResponse('Invalid tokenAddress'));
    }
    for (const r of recipients) {
      if (!r.address || !r.amount) {
        return res.status(400).json(errorResponse('Each recipient requires address and amount'));
      }
      if (!ethers.isAddress(r.address)) {
        return res.status(400).json(errorResponse(`Invalid address: ${r.address}`));
      }
    }

    const provider = getProvider(chain);
    const wallet = getWallet(privateKey, provider, chain);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    let decimals = 18;
    let symbol = 'TOKEN';
    try {
      decimals = await token.decimals();
      symbol = await token.symbol();
    } catch (_) {}

    // Check total balance
    const totalAmount = recipients.reduce(
      (acc, r) => acc + ethers.parseUnits(r.amount.toString(), decimals), 0n
    );
    const balance = await token.balanceOf(wallet.address);
    if (balance < totalAmount) {
      return res.status(400).json(
        errorResponse('Insufficient token balance', {
          balance: ethers.formatUnits(balance, decimals),
          required: ethers.formatUnits(totalAmount, decimals),
          symbol
        })
      );
    }

    logTransaction('Batch Transfer ERC20', { token: symbol, count: recipients.length, chain });

    const results = [];
    for (const r of recipients) {
      try {
        const amountWei = ethers.parseUnits(r.amount.toString(), decimals);
        const tx = await token.transfer(r.address, amountWei);
        const receipt = await tx.wait();
        results.push({
          address: r.address,
          amount: r.amount,
          success: true,
          txHash: receipt.hash,
          explorerUrl: getTxExplorerUrl(receipt.hash, chain)
        });
      } catch (err) {
        results.push({
          address: r.address,
          amount: r.amount,
          success: false,
          error: err.message
        });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.length - succeeded;

    const data = {
      type: 'batch_erc20',
      from: wallet.address,
      tokenAddress,
      tokenSymbol: symbol,
      recipientCount: recipients.length,
      succeeded,
      failed,
      results,
      ...chainMetadata
    };

    if (succeeded > 0) fireEvent(req.apiKey?.agentId || null, 'tx.confirmed', data);

    return res.json(successResponse(data));

  } catch (error) {
    console.error('Batch transfer ERC20 error:', error);
    return res.status(500).json(errorResponse(error.message, error.reason || error.code));
  }
}

// ─── POST /batch/mint ─────────────────────────────────────────────────────────
/**
 * Mint NFTs to multiple recipients from an ERC721 collection.
 *
 * Body:
 *   privateKey          string
 *   collectionAddress   string
 *   recipients          Array<string>   Addresses to mint to
 */
async function batchMint(req, res) {
  try {
    const { privateKey, collectionAddress, recipients } = req.body;

    const validationError = validateRequiredFields(req.body, ['privateKey', 'collectionAddress', 'recipients']);
    if (validationError) return res.status(400).json(validationError);

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json(errorResponse('recipients must be a non-empty array'));
    }
    if (recipients.length > 50) {
      return res.status(400).json(errorResponse('Maximum 50 recipients per batch mint'));
    }
    if (!ethers.isAddress(collectionAddress)) {
      return res.status(400).json(errorResponse('Invalid collectionAddress'));
    }
    for (const addr of recipients) {
      if (!ethers.isAddress(addr)) {
        return res.status(400).json(errorResponse(`Invalid recipient address: ${addr}`));
      }
    }

    const provider = getProvider();
    const wallet = getWallet(privateKey, provider);
    const nftContract = getContract(collectionAddress, ERC721_COLLECTION_ABI, wallet);

    logTransaction('Batch Mint NFT', { collection: collectionAddress, count: recipients.length });

    const results = [];
    for (const toAddress of recipients) {
      try {
        const tx = await nftContract.mint(toAddress);
        const receipt = await tx.wait();

        // Parse Transfer event to get token ID
        let tokenId = 'unknown';
        try {
          const iface = new ethers.Interface(ERC721_COLLECTION_ABI);
          for (const log of receipt.logs) {
            try {
              const parsed = iface.parseLog(log);
              if (parsed?.name === 'Transfer') {
                tokenId = parsed.args.token_id?.toString() || parsed.args.tokenId?.toString() || 'unknown';
                break;
              }
            } catch (_) {}
          }
        } catch (_) {}

        results.push({
          to: toAddress,
          tokenId,
          success: true,
          txHash: receipt.hash,
          explorerUrl: getTxExplorerUrl(receipt.hash)
        });

        fireEvent(req.apiKey?.agentId || null, 'nft.minted', {
          collectionAddress, toAddress, tokenId, txHash: receipt.hash
        });

      } catch (err) {
        results.push({ to: toAddress, success: false, error: err.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.length - succeeded;

    return res.json(
      successResponse({
        type: 'batch_mint',
        collectionAddress,
        recipientCount: recipients.length,
        succeeded,
        failed,
        results
      })
    );

  } catch (error) {
    console.error('Batch mint error:', error);
    return res.status(500).json(errorResponse(error.message, error.reason || error.code));
  }
}

// ─── POST /batch/approve ──────────────────────────────────────────────────────
/**
 * Approve multiple spenders for an ERC20 token in one go (sequential txs).
 *
 * Body:
 *   privateKey    string
 *   tokenAddress  string
 *   approvals     Array<{ spender: string, amount: string | "unlimited" }>
 */
async function batchApprove(req, res) {
  try {
    const { privateKey, tokenAddress, approvals } = req.body;

    const validationError = validateRequiredFields(req.body, ['privateKey', 'tokenAddress', 'approvals']);
    if (validationError) return res.status(400).json(validationError);

    if (!Array.isArray(approvals) || approvals.length === 0) {
      return res.status(400).json(errorResponse('approvals must be a non-empty array'));
    }
    if (!ethers.isAddress(tokenAddress)) {
      return res.status(400).json(errorResponse('Invalid tokenAddress'));
    }
    for (const a of approvals) {
      if (!a.spender || !a.amount) {
        return res.status(400).json(errorResponse('Each approval requires spender and amount'));
      }
      if (!ethers.isAddress(a.spender)) {
        return res.status(400).json(errorResponse(`Invalid spender address: ${a.spender}`));
      }
    }

    const provider = getProvider();
    const wallet = getWallet(privateKey, provider);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    let decimals = 18;
    let symbol = 'TOKEN';
    try { decimals = await token.decimals(); symbol = await token.symbol(); } catch (_) {}

    logTransaction('Batch Approve', { token: symbol, count: approvals.length });

    const results = [];
    for (const a of approvals) {
      try {
        const amountWei = (a.amount === 'unlimited' || a.amount === 'max')
          ? ethers.MaxUint256
          : ethers.parseUnits(a.amount.toString(), decimals);

        const tx = await token.approve(a.spender, amountWei);
        const receipt = await tx.wait();
        results.push({
          spender: a.spender,
          amount: a.amount,
          success: true,
          txHash: receipt.hash,
          explorerUrl: getTxExplorerUrl(receipt.hash)
        });
      } catch (err) {
        results.push({ spender: a.spender, amount: a.amount, success: false, error: err.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;

    return res.json(
      successResponse({
        type: 'batch_approve',
        from: wallet.address,
        tokenAddress,
        tokenSymbol: symbol,
        approvalCount: approvals.length,
        succeeded,
        failed: approvals.length - succeeded,
        results
      })
    );

  } catch (error) {
    console.error('Batch approve error:', error);
    return res.status(500).json(errorResponse(error.message, error.reason || error.code));
  }
}

module.exports = { batchTransferETH, batchTransferERC20, batchMint, batchApprove };
