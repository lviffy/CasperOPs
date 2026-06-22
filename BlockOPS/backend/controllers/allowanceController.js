const { ethers } = require('ethers');
const { getProvider, getWallet } = require('../utils/blockchain');
const { 
  successResponse, 
  errorResponse, 
  validateRequiredFields, 
  getTxExplorerUrl,
  logTransaction 
} = require('../utils/helpers');

// Standard ERC20 ABI for allowance operations
const ERC20_ALLOWANCE_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

/**
 * Approve token spending
 */
async function approveToken(req, res) {
  try {
    const { privateKey, tokenAddress, spenderAddress, amount } = req.body;

    const validationError = validateRequiredFields(req.body, ['privateKey', 'tokenAddress', 'spenderAddress', 'amount']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    if (!ethers.isAddress(tokenAddress) || !ethers.isAddress(spenderAddress)) {
      return res.status(400).json(errorResponse('Invalid token or spender address'));
    }

    const provider = getProvider();
    const wallet = getWallet(privateKey, provider);
    const token = new ethers.Contract(tokenAddress, ERC20_ALLOWANCE_ABI, wallet);

    // Get token info
    let decimals = 18;
    let symbol = 'TOKEN';
    try {
      decimals = await token.decimals();
      symbol = await token.symbol();
    } catch (e) {
      console.log('Could not fetch token info, using defaults');
    }

    // Handle unlimited approval
    let amountWei;
    if (amount === 'unlimited' || amount === 'max') {
      amountWei = ethers.MaxUint256;
    } else {
      amountWei = ethers.parseUnits(amount.toString(), decimals);
    }

    logTransaction('Approve Token', { tokenAddress, spenderAddress, amount, wallet: wallet.address });

    const tx = await token.approve(spenderAddress, amountWei);
    const receipt = await tx.wait();

    return res.json(
      successResponse({
        type: 'approve_token',
        transactionHash: receipt.hash,
        owner: wallet.address,
        tokenAddress: tokenAddress,
        tokenSymbol: symbol,
        spenderAddress: spenderAddress,
        amount: amount === 'unlimited' || amount === 'max' ? 'unlimited' : amount,
        amountRaw: amountWei.toString(),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: getTxExplorerUrl(receipt.hash),
        network: 'Arbitrum Sepolia'
      })
    );
  } catch (error) {
    console.error('Approve token error:', error);
    return res.status(500).json(
      errorResponse(error.message, error.reason || error.code)
    );
  }
}

/**
 * Revoke token approval (set to 0)
 */
async function revokeApproval(req, res) {
  try {
    const { privateKey, tokenAddress, spenderAddress } = req.body;

    const validationError = validateRequiredFields(req.body, ['privateKey', 'tokenAddress', 'spenderAddress']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    if (!ethers.isAddress(tokenAddress) || !ethers.isAddress(spenderAddress)) {
      return res.status(400).json(errorResponse('Invalid token or spender address'));
    }

    const provider = getProvider();
    const wallet = getWallet(privateKey, provider);
    const token = new ethers.Contract(tokenAddress, ERC20_ALLOWANCE_ABI, wallet);

    // Get token info
    let symbol = 'TOKEN';
    try {
      symbol = await token.symbol();
    } catch (e) {
      console.log('Could not fetch token symbol');
    }

    // Check current allowance
    const currentAllowance = await token.allowance(wallet.address, spenderAddress);
    if (currentAllowance === 0n) {
      return res.json(
        successResponse({
          type: 'revoke_approval',
          message: 'Allowance is already zero',
          owner: wallet.address,
          tokenAddress: tokenAddress,
          tokenSymbol: symbol,
          spenderAddress: spenderAddress,
          currentAllowance: '0',
          network: 'Arbitrum Sepolia'
        })
      );
    }

    logTransaction('Revoke Approval', { tokenAddress, spenderAddress, wallet: wallet.address });

    const tx = await token.approve(spenderAddress, 0);
    const receipt = await tx.wait();

    return res.json(
      successResponse({
        type: 'revoke_approval',
        transactionHash: receipt.hash,
        owner: wallet.address,
        tokenAddress: tokenAddress,
        tokenSymbol: symbol,
        spenderAddress: spenderAddress,
        previousAllowance: currentAllowance.toString(),
        newAllowance: '0',
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: getTxExplorerUrl(receipt.hash),
        network: 'Arbitrum Sepolia'
      })
    );
  } catch (error) {
    console.error('Revoke approval error:', error);
    return res.status(500).json(
      errorResponse(error.message, error.reason || error.code)
    );
  }
}

/**
 * Check current allowance
 */
async function checkAllowance(req, res) {
  try {
    const { tokenAddress, ownerAddress, spenderAddress } = req.params;

    if (!ethers.isAddress(tokenAddress) || !ethers.isAddress(ownerAddress) || !ethers.isAddress(spenderAddress)) {
      return res.status(400).json(errorResponse('Invalid address provided'));
    }

    const provider = getProvider();
    const token = new ethers.Contract(tokenAddress, ERC20_ALLOWANCE_ABI, provider);

    const [allowance, decimals, symbol] = await Promise.all([
      token.allowance(ownerAddress, spenderAddress),
      token.decimals().catch(() => 18),
      token.symbol().catch(() => 'TOKEN')
    ]);

    const isUnlimited = allowance >= ethers.MaxUint256 / 2n;

    return res.json(
      successResponse({
        tokenAddress: tokenAddress,
        tokenSymbol: symbol,
        ownerAddress: ownerAddress,
        spenderAddress: spenderAddress,
        allowance: ethers.formatUnits(allowance, decimals),
        allowanceRaw: allowance.toString(),
        isUnlimited: isUnlimited,
        decimals: Number(decimals),
        network: 'Arbitrum Sepolia'
      })
    );
  } catch (error) {
    console.error('Check allowance error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = {
  approveToken,
  revokeApproval,
  checkAllowance
};
