const { ethers } = require('ethers');
const { getProvider, getWallet, getContract } = require('../utils/blockchain');
const { 
  successResponse, 
  errorResponse, 
  validateRequiredFields, 
  getTxExplorerUrl,
  logTransaction 
} = require('../utils/helpers');

// WETH address on Arbitrum Sepolia
const WETH_ADDRESS = '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73';

// WETH ABI
const WETH_ABI = [
  'function deposit() external payable',
  'function withdraw(uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)'
];

// Standard ERC20 ABI for token metadata
const STANDARD_ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)'
];

/**
 * Wrap ETH to WETH
 */
async function wrapETH(req, res) {
  try {
    const { privateKey, amount } = req.body;

    const validationError = validateRequiredFields(req.body, ['privateKey', 'amount']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const provider = getProvider();
    const wallet = getWallet(privateKey, provider);
    const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);

    const amountWei = ethers.parseEther(amount.toString());

    // Check balance
    const balance = await provider.getBalance(wallet.address);
    if (balance < amountWei) {
      return res.status(400).json(
        errorResponse('Insufficient ETH balance', {
          balance: ethers.formatEther(balance),
          required: amount.toString()
        })
      );
    }

    logTransaction('Wrap ETH', { amount, wallet: wallet.address });

    const tx = await weth.deposit({ value: amountWei });
    const receipt = await tx.wait();

    return res.json(
      successResponse({
        type: 'wrap_eth',
        transactionHash: receipt.hash,
        from: wallet.address,
        amount: amount,
        wethAddress: WETH_ADDRESS,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: getTxExplorerUrl(receipt.hash)
      })
    );
  } catch (error) {
    console.error('Wrap ETH error:', error);
    return res.status(500).json(
      errorResponse(error.message, error.reason || error.code)
    );
  }
}

/**
 * Unwrap WETH to ETH
 */
async function unwrapETH(req, res) {
  try {
    const { privateKey, amount } = req.body;

    const validationError = validateRequiredFields(req.body, ['privateKey', 'amount']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const provider = getProvider();
    const wallet = getWallet(privateKey, provider);
    const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);

    const amountWei = ethers.parseEther(amount.toString());

    // Check WETH balance
    const wethBalance = await weth.balanceOf(wallet.address);
    if (wethBalance < amountWei) {
      return res.status(400).json(
        errorResponse('Insufficient WETH balance', {
          balance: ethers.formatEther(wethBalance),
          required: amount.toString()
        })
      );
    }

    logTransaction('Unwrap WETH', { amount, wallet: wallet.address });

    const tx = await weth.withdraw(amountWei);
    const receipt = await tx.wait();

    return res.json(
      successResponse({
        type: 'unwrap_eth',
        transactionHash: receipt.hash,
        from: wallet.address,
        amount: amount,
        wethAddress: WETH_ADDRESS,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: getTxExplorerUrl(receipt.hash)
      })
    );
  } catch (error) {
    console.error('Unwrap WETH error:', error);
    return res.status(500).json(
      errorResponse(error.message, error.reason || error.code)
    );
  }
}

/**
 * Get token metadata
 */
async function getTokenMetadata(req, res) {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json(errorResponse('Invalid token address'));
    }

    const provider = getProvider();
    const token = new ethers.Contract(address, STANDARD_ERC20_ABI, provider);

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      token.name().catch(() => 'Unknown'),
      token.symbol().catch(() => 'UNKNOWN'),
      token.decimals().catch(() => 18),
      token.totalSupply().catch(() => 0n)
    ]);

    return res.json(
      successResponse({
        address: address,
        name: name,
        symbol: symbol,
        decimals: Number(decimals),
        totalSupply: ethers.formatUnits(totalSupply, Number(decimals)),
        totalSupplyRaw: totalSupply.toString(),
        network: 'Arbitrum Sepolia'
      })
    );
  } catch (error) {
    console.error('Get token metadata error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

/**
 * Get transaction status
 */
async function getTransactionStatus(req, res) {
  try {
    const { hash } = req.params;

    const provider = getProvider();
    const receipt = await provider.getTransactionReceipt(hash);

    if (!receipt) {
      // Check if tx exists but is pending
      const tx = await provider.getTransaction(hash);
      if (tx) {
        return res.json(
          successResponse({
            hash: hash,
            status: 'pending',
            confirmations: 0,
            from: tx.from,
            to: tx.to,
            value: ethers.formatEther(tx.value),
            nonce: tx.nonce
          })
        );
      }
      return res.status(404).json(errorResponse('Transaction not found'));
    }

    const currentBlock = await provider.getBlockNumber();
    const confirmations = currentBlock - receipt.blockNumber;

    return res.json(
      successResponse({
        hash: hash,
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        confirmations: confirmations,
        blockNumber: receipt.blockNumber,
        from: receipt.from,
        to: receipt.to,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice ? ethers.formatGwei(receipt.gasPrice) + ' Gwei' : null,
        logsCount: receipt.logs.length,
        explorerUrl: getTxExplorerUrl(hash),
        network: 'Arbitrum Sepolia'
      })
    );
  } catch (error) {
    console.error('Get transaction status error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

/**
 * Get wallet transaction history (using Arbiscan API)
 */
async function getWalletHistory(req, res) {
  try {
    const { address } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!ethers.isAddress(address)) {
      return res.status(400).json(errorResponse('Invalid wallet address'));
    }

    // Use Arbiscan API for transaction history
    const ARBISCAN_API_KEY = process.env.ARBISCAN_API_KEY || '';
    const apiUrl = `https://api-sepolia.arbiscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=${page}&offset=${limit}&sort=desc&apikey=${ARBISCAN_API_KEY}`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.status !== '1') {
      // Check if it's just an empty result
      if (data.message === 'No transactions found') {
        return res.json(
          successResponse({
            address: address,
            transactions: [],
            page: parseInt(page),
            limit: parseInt(limit),
            network: 'Arbitrum Sepolia'
          })
        );
      }
      return res.status(400).json(errorResponse(data.message || 'Failed to fetch history'));
    }

    const transactions = data.result.map(tx => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: ethers.formatEther(tx.value),
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
      blockNumber: parseInt(tx.blockNumber),
      isError: tx.isError === '1',
      functionName: tx.functionName || null
    }));

    return res.json(
      successResponse({
        address: address,
        transactions: transactions,
        page: parseInt(page),
        limit: parseInt(limit),
        network: 'Arbitrum Sepolia'
      })
    );
  } catch (error) {
    console.error('Get wallet history error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = {
  wrapETH,
  unwrapETH,
  getTokenMetadata,
  getTransactionStatus,
  getWalletHistory
};
