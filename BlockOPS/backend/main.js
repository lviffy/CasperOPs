const express = require('express');
const { ethers } = require('ethers');
const axios = require('axios');
const FormData = require('form-data');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
app.use(express.json());

// Arbitrum Sepolia RPC URL
const ARBITRUM_SEPOLIA_RPC = 'https://sepolia-rollup.arbitrum.io/rpc';

// TokenFactory Contract Address (Stylus on Arbitrum Sepolia)
// Deploy your Stylus contract and update this address
const FACTORY_ADDRESS = process.env.TOKEN_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000';

// TokenFactory ABI (Stylus contract)
const FACTORY_ABI = [
  "function initialize(address implementation) external",
  "function create_token(string name, string symbol, uint256 decimals, uint256 initial_supply) external returns (address)",
  "function get_implementation() external view returns (address)",
  "function get_token_count() external view returns (uint256)",
  "function get_token_by_id(uint256 token_id) external view returns (address)",
  "function get_token_id(address token_address) external view returns (uint256)",
  "function get_tokens(uint256 start, uint256 count) external view returns (address[])",
  "event TokenCreated(address indexed creator, address indexed token_address, string name, string symbol, uint256 initial_supply, uint256 token_id)"
];

// NFTFactory Contract Address (Stylus on Arbitrum Sepolia)
// Deploy your Stylus contract and update this address
const NFT_FACTORY_ADDRESS = process.env.NFT_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000';

// NFTFactory ABI (Stylus contract)
const NFT_FACTORY_ABI = [
  "function initialize(address implementation) external",
  "function create_collection(string name, string symbol, string base_uri) external returns (address)",
  "function get_implementation() external view returns (address)",
  "function get_collection_count() external view returns (uint256)",
  "function get_collection_by_id(uint256 collection_id) external view returns (address)",
  "function get_collection_id(address collection_address) external view returns (uint256)",
  "function get_collections(uint256 start, uint256 count) external view returns (address[])",
  "event CollectionCreated(address indexed creator, address indexed collection_address, string name, string symbol, string base_uri, uint256 collection_id)"
];

// ERC20 Token ABI (for interacting with deployed tokens from Stylus factory)
const ERC20_TOKEN_ABI = [
  "function initialize(string name, string symbol, uint256 decimals, uint256 initialSupply, address creator) external",
  "function creator() external view returns (address)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint256)",
  "function total_supply() external view returns (uint256)",
  "function balance_of(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer_from(address from, address to, uint256 amount) external returns (bool)",
  "function increase_allowance(address spender, uint256 added_value) external returns (bool)",
  "function decrease_allowance(address spender, uint256 subtracted_value) external returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

// ERC721 Collection ABI (Stylus contract)
const ERC721_COLLECTION_ABI = [
  "function initialize(string name, string symbol, string base_uri, address creator) external",
  "function creator() external view returns (address)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function base_uri() external view returns (string)",
  "function token_uri(uint256 token_id) external view returns (string)",
  "function total_supply() external view returns (uint256)",
  "function balance_of(address owner) external view returns (uint256)",
  "function owner_of(uint256 token_id) external view returns (address)",
  "function mint(address to) external returns (uint256)",
  "function burn(uint256 token_id) external returns (bool)",
  "function transfer_from(address from, address to, uint256 token_id) external returns (bool)",
  "function safe_transfer_from(address from, address to, uint256 token_id) external returns (bool)",
  "function approve(address to, uint256 token_id) external returns (bool)",
  "function get_approved(uint256 token_id) external view returns (address)",
  "function set_approval_for_all(address operator, bool approved) external returns (bool)",
  "function is_approved_for_all(address owner, address operator) external view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed token_id)",
  "event Approval(address indexed owner, address indexed approved, uint256 indexed token_id)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)"
];

// ============================================
// TRANSFER ENDPOINT
// ============================================

app.post('/transfer', async (req, res) => {
  try {
    const { privateKey, toAddress, amount, tokenAddress } = req.body;

    if (!privateKey || !toAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: privateKey, toAddress, amount'
      });
    }

    const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    // If tokenAddress is provided, transfer ERC20 tokens
    if (tokenAddress) {
      console.log('Transferring ERC20 token from Stylus contract');
      
      // Use ERC20_TOKEN_ABI for Stylus-deployed tokens
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_TOKEN_ABI, wallet);
      
      // Get token decimals
      let decimals;
      try {
        const decimalsResult = await tokenContract.decimals();
        decimals = Number(decimalsResult);
      } catch (error) {
        console.log('Could not get decimals, defaulting to 18:', error.message);
        decimals = 18;
      }
      
      const amountInWei = ethers.parseUnits(amount.toString(), decimals);
      
      // Check balance
      const balance = await tokenContract.balance_of(wallet.address);
      console.log('Token balance:', ethers.formatUnits(balance, decimals));
      
      if (balance < amountInWei) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient token balance',
          balance: ethers.formatUnits(balance, decimals),
          required: amount.toString()
        });
      }
      
      // Execute transfer
      console.log(`Transferring ${amount} tokens to ${toAddress}`);
      const tx = await tokenContract.transfer(toAddress, amountInWei);
      console.log('Transaction hash:', tx.hash);
      
      const receipt = await tx.wait();
      
      // Get token info
      let tokenName = 'Unknown';
      let tokenSymbol = 'UNKNOWN';
      try {
        tokenName = await tokenContract.name();
        tokenSymbol = await tokenContract.symbol();
      } catch (error) {
        console.log('Could not fetch token info:', error.message);
      }
      
      return res.json({
        success: true,
        type: 'erc20',
        transactionHash: receipt.hash,
        from: wallet.address,
        to: toAddress,
        amount: amount,
        tokenAddress: tokenAddress,
        tokenName: tokenName,
        tokenSymbol: tokenSymbol,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: `https://sepolia.arbiscan.io/tx/${receipt.hash}`
      });
    }

    // Native token transfer (ETH on Arbitrum Sepolia)
    console.log('Transferring native token (ETH)');
    const balance = await provider.getBalance(wallet.address);
    const amountInWei = ethers.parseEther(amount.toString());

    if (balance < amountInWei) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance',
        balance: ethers.formatEther(balance),
        required: amount.toString()
      });
    }

    const tx = {
      to: toAddress,
      value: amountInWei,
    };

    const transactionResponse = await wallet.sendTransaction(tx);
    const receipt = await transactionResponse.wait();

    return res.json({
      success: true,
      type: 'native',
      transactionHash: receipt.hash,
      from: wallet.address,
      to: toAddress,
      amount: amount,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `https://sepolia.arbiscan.io/tx/${receipt.hash}`
    });

  } catch (error) {
    console.error('Transfer error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.reason || error.code
    });
  }
});

// ============================================
// TOKEN DEPLOYMENT ENDPOINT
// ============================================

app.post('/deploy-token', async (req, res) => {
  try {
    const { 
      privateKey, 
      name, 
      symbol, 
      initialSupply,
      decimals = 18 // Default to 18 decimals if not provided
    } = req.body;

    // Validation
    if (!privateKey || !name || !symbol || !initialSupply) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: privateKey, name, symbol, initialSupply'
      });
    }

    if (FACTORY_ADDRESS === '0x0000000000000000000000000000000000000000') {
      return res.status(500).json({
        success: false,
        error: 'TokenFactory contract address not configured. Please set TOKEN_FACTORY_ADDRESS in environment variables.'
      });
    }

    const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    // Check balance for gas
    const balance = await provider.getBalance(wallet.address);
    console.log('Wallet balance:', ethers.formatEther(balance), 'ETH');
    
    if (balance === 0n) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance for gas fees',
        balance: '0',
        message: 'Please fund your wallet with ETH on Arbitrum Sepolia'
      });
    }

    console.log('Creating token via Stylus TokenFactory:', { name, symbol, decimals, initialSupply });
    console.log('Factory address:', FACTORY_ADDRESS);

    // Connect to Stylus TokenFactory contract
    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet);

    // Convert values to proper types
    const decimalsBigInt = BigInt(decimals.toString());
    const initialSupplyBigInt = BigInt(initialSupply.toString());

    // Estimate gas before sending transaction
    console.log('Estimating gas for create_token...');
    let gasEstimate;
    let estimatedCost = null;
    try {
      gasEstimate = await factory.create_token.estimateGas(name, symbol, decimalsBigInt, initialSupplyBigInt);
      console.log('Estimated gas:', gasEstimate.toString());
      
      const feeData = await provider.getFeeData();
      if (feeData.gasPrice) {
        const estimatedCostWei = gasEstimate * feeData.gasPrice;
        estimatedCost = ethers.formatEther(estimatedCostWei);
        console.log('Estimated cost:', estimatedCost, 'ETH');
        
        // Check if balance is sufficient for gas
        const gasBuffer = estimatedCostWei * 12n / 10n; // 20% buffer
        if (balance < gasBuffer) {
          return res.status(400).json({
            success: false,
            error: 'Insufficient balance for gas fees',
            balance: ethers.formatEther(balance),
            estimatedCost: estimatedCost,
            required: ethers.formatEther(gasBuffer)
          });
        }
      }
    } catch (estimateError) {
      console.warn('Gas estimation failed:', estimateError.message);
      console.log('Proceeding without gas estimate...');
    }

    // Create token via Stylus factory
    console.log('Sending create_token transaction...');
    let tx;
    if (gasEstimate) {
      const gasLimit = gasEstimate * 12n / 10n; // Add 20% buffer
      tx = await factory.create_token(name, symbol, decimalsBigInt, initialSupplyBigInt, { gasLimit });
    } else {
      tx = await factory.create_token(name, symbol, decimalsBigInt, initialSupplyBigInt);
    }
    console.log('Transaction hash:', tx.hash);
    console.log('Waiting for confirmation...');

    // Wait for the transaction to be mined
    const receipt = await tx.wait();
    console.log('Transaction confirmed in block:', receipt.blockNumber);

    // Parse the TokenCreated event to get the token address
    const factoryInterface = new ethers.Interface(FACTORY_ABI);
    let newTokenAddress = null;
    
    for (const log of receipt.logs) {
      try {
        const parsedLog = factoryInterface.parseLog(log);
        if (parsedLog && parsedLog.name === 'TokenCreated') {
          newTokenAddress = parsedLog.args.token_address;
          console.log('Parsed TokenCreated event:', parsedLog.args);
          break;
        }
      } catch (e) {
        // Not a factory event, continue
      }
    }

    if (!newTokenAddress) {
      throw new Error('Failed to parse TokenCreated event from receipt');
    }

    console.log('Token created at address:', newTokenAddress);

    // Get token info
    const tokenContract = new ethers.Contract(newTokenAddress, ERC20_TOKEN_ABI, provider);
    let tokenInfo = {
      name: name,
      symbol: symbol,
      decimals: decimals,
      totalSupply: initialSupply
    };

    try {
      const creatorAddress = await tokenContract.creator();
      const actualSupply = await tokenContract.total_supply();
      tokenInfo.creator = creatorAddress;
      tokenInfo.actualTotalSupply = actualSupply.toString();
    } catch (error) {
      console.warn('Could not fetch token info:', error.message);
    }

    return res.json({
      success: true,
      message: 'Token deployed successfully via Stylus TokenFactory',
      tokenAddress: newTokenAddress,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      estimatedCost: estimatedCost,
      creator: wallet.address,
      tokenInfo: tokenInfo,
      explorerUrl: `https://sepolia.arbiscan.io/address/${newTokenAddress}`,
      transactionUrl: `https://sepolia.arbiscan.io/tx/${receipt.hash}`
    });

  } catch (error) {
    console.error('Deploy token error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.reason || error.code
    });
  }
});

// ============================================
// NFT COLLECTION DEPLOYMENT ENDPOINT
// ============================================

app.post('/deploy-nft-collection', async (req, res) => {
  try {
    const { 
      privateKey, 
      name, 
      symbol, 
      baseURI 
    } = req.body;

    // Validation
    if (!privateKey || !name || !symbol || !baseURI) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: privateKey, name, symbol, baseURI'
      });
    }

    if (NFT_FACTORY_ADDRESS === '0x0000000000000000000000000000000000000000') {
      return res.status(500).json({
        success: false,
        error: 'NFTFactory contract address not configured. Please set NFT_FACTORY_ADDRESS in environment variables.'
      });
    }

    const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    // Check balance for gas
    const balance = await provider.getBalance(wallet.address);
    console.log('Wallet balance:', ethers.formatEther(balance), 'ETH');
    
    if (balance === 0n) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance for gas fees',
        balance: '0'
      });
    }

    console.log('Creating NFT collection via Stylus NFTFactory:', { name, symbol, baseURI });
    console.log('Factory address:', NFT_FACTORY_ADDRESS);

    // Connect to Stylus NFTFactory contract
    const factory = new ethers.Contract(NFT_FACTORY_ADDRESS, NFT_FACTORY_ABI, wallet);

    // Estimate gas
    console.log('Estimating gas for create_collection...');
    let gasEstimate;
    let estimatedCost = null;
    try {
      gasEstimate = await factory.create_collection.estimateGas(name, symbol, baseURI);
      console.log('Estimated gas:', gasEstimate.toString());
      
      const feeData = await provider.getFeeData();
      if (feeData.gasPrice) {
        const estimatedCostWei = gasEstimate * feeData.gasPrice;
        estimatedCost = ethers.formatEther(estimatedCostWei);
        console.log('Estimated cost:', estimatedCost, 'ETH');
        
        const gasBuffer = estimatedCostWei * 12n / 10n; // 20% buffer
        if (balance < gasBuffer) {
          return res.status(400).json({
            success: false,
            error: 'Insufficient balance for gas fees',
            balance: ethers.formatEther(balance),
            estimatedCost: estimatedCost,
            required: ethers.formatEther(gasBuffer)
          });
        }
      }
    } catch (estimateError) {
      console.warn('Gas estimation failed:', estimateError.message);
      console.log('Proceeding without gas estimate...');
    }

    // Create collection via Stylus factory
    console.log('Sending create_collection transaction...');
    let tx;
    if (gasEstimate) {
      const gasLimit = gasEstimate * 12n / 10n;
      tx = await factory.create_collection(name, symbol, baseURI, { gasLimit });
    } else {
      tx = await factory.create_collection(name, symbol, baseURI);
    }
    
    console.log('Transaction hash:', tx.hash);
    console.log('Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log('Transaction confirmed in block:', receipt.blockNumber);

    // Parse CollectionCreated event
    const factoryInterface = new ethers.Interface(NFT_FACTORY_ABI);
    let collectionAddress = null;
    
    for (const log of receipt.logs) {
      try {
        const parsedLog = factoryInterface.parseLog(log);
        if (parsedLog && parsedLog.name === 'CollectionCreated') {
          collectionAddress = parsedLog.args.collection_address;
          console.log('Parsed CollectionCreated event:', parsedLog.args);
          break;
        }
      } catch (e) {
        // Not a factory event, continue
      }
    }

    if (!collectionAddress) {
      throw new Error('Failed to parse CollectionCreated event from receipt');
    }

    console.log('NFT Collection created at address:', collectionAddress);

    return res.json({
      success: true,
      message: 'NFT Collection deployed successfully via Stylus NFTFactory',
      collectionAddress: collectionAddress,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      estimatedCost: estimatedCost,
      creator: wallet.address,
      collectionInfo: {
        name: name,
        symbol: symbol,
        baseURI: baseURI
      },
      explorerUrl: `https://sepolia.arbiscan.io/address/${collectionAddress}`,
      transactionUrl: `https://sepolia.arbiscan.io/tx/${receipt.hash}`
    });

  } catch (error) {
    console.error('Deploy NFT collection error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.reason || error.code
    });
  }
});

// ============================================
// NFT MINTING ENDPOINT
// ============================================

app.post('/mint-nft', async (req, res) => {
  try {
    const { privateKey, collectionAddress, toAddress } = req.body;

    if (!privateKey || !collectionAddress || !toAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: privateKey, collectionAddress, toAddress'
      });
    }

    const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log('Minting NFT from collection:', collectionAddress);
    const nftContract = new ethers.Contract(collectionAddress, ERC721_COLLECTION_ABI, wallet);

    // Mint NFT
    const tx = await nftContract.mint(toAddress);
    console.log('Mint transaction hash:', tx.hash);

    const receipt = await tx.wait();
    console.log('Mint confirmed in block:', receipt.blockNumber);

    // Parse Transfer event to get token ID
    const nftInterface = new ethers.Interface(ERC721_COLLECTION_ABI);
    let tokenId = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = nftInterface.parseLog(log);
        if (parsedLog && parsedLog.name === 'Transfer') {
          tokenId = parsedLog.args.token_id;
          break;
        }
      } catch (e) {
        // Continue
      }
    }

    return res.json({
      success: true,
      message: 'NFT minted successfully',
      tokenId: tokenId ? tokenId.toString() : 'unknown',
      collectionAddress: collectionAddress,
      owner: toAddress,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `https://sepolia.arbiscan.io/tx/${receipt.hash}`
    });

  } catch (error) {
    console.error('Mint NFT error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.reason || error.code
    });
  }
});

// ============================================
// BALANCE QUERY ENDPOINTS
// ============================================

// Get native balance
app.get('/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
    const balance = await provider.getBalance(address);
    
    return res.json({
      success: true,
      address: address,
      balance: ethers.formatEther(balance),
      balanceWei: balance.toString(),
      network: 'Arbitrum Sepolia'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get token balance
app.get('/token-balance/:tokenAddress/:ownerAddress', async (req, res) => {
  try {
    const { tokenAddress, ownerAddress } = req.params;
    const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_TOKEN_ABI, provider);
    
    const balance = await tokenContract.balance_of(ownerAddress);
    let decimals = 18;
    try {
      const decimalsResult = await tokenContract.decimals();
      decimals = Number(decimalsResult);
    } catch (e) {
      console.log('Could not get decimals, using 18');
    }
    
    return res.json({
      success: true,
      tokenAddress: tokenAddress,
      ownerAddress: ownerAddress,
      balance: ethers.formatUnits(balance, decimals),
      balanceRaw: balance.toString(),
      decimals: decimals,
      network: 'Arbitrum Sepolia'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// INFO QUERY ENDPOINTS
// ============================================

// Get NFT info
app.get('/nft-info/:collectionAddress/:tokenId', async (req, res) => {
  try {
    const { collectionAddress, tokenId } = req.params;
    const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
    const nftContract = new ethers.Contract(collectionAddress, ERC721_COLLECTION_ABI, provider);
    
    const owner = await nftContract.owner_of(BigInt(tokenId));
    const tokenURI = await nftContract.token_uri(BigInt(tokenId));
    const name = await nftContract.name();
    const symbol = await nftContract.symbol();
    
    return res.json({
      success: true,
      collectionAddress: collectionAddress,
      tokenId: tokenId,
      owner: owner,
      tokenURI: tokenURI,
      collectionName: name,
      collectionSymbol: symbol,
      network: 'Arbitrum Sepolia'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get token info
app.get('/token-info/:tokenAddress', async (req, res) => {
  try {
    const { tokenAddress } = req.params;
    const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_TOKEN_ABI, provider);
    
    const name = await tokenContract.name();
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();
    const totalSupply = await tokenContract.total_supply();
    const creator = await tokenContract.creator();
    
    return res.json({
      success: true,
      tokenAddress: tokenAddress,
      name: name,
      symbol: symbol,
      decimals: Number(decimals),
      totalSupply: ethers.formatUnits(totalSupply, Number(decimals)),
      totalSupplyRaw: totalSupply.toString(),
      creator: creator,
      network: 'Arbitrum Sepolia'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    network: 'Arbitrum Sepolia',
    rpc: ARBITRUM_SEPOLIA_RPC,
    tokenFactory: FACTORY_ADDRESS,
    nftFactory: NFT_FACTORY_ADDRESS
  });
});

// ============================================
// SERVER START
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Network: Arbitrum Sepolia`);
  console.log(`TokenFactory: ${FACTORY_ADDRESS}`);
  console.log(`NFTFactory: ${NFT_FACTORY_ADDRESS}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /transfer - Transfer native ETH or ERC20 tokens`);
  console.log(`  POST /deploy-token - Deploy ERC20 token via Stylus factory`);
  console.log(`  POST /deploy-nft-collection - Deploy NFT collection via Stylus factory`);
  console.log(`  POST /mint-nft - Mint NFT from collection`);
  console.log(`  GET /balance/:address - Get native ETH balance`);
  console.log(`  GET /token-balance/:tokenAddress/:ownerAddress - Get ERC20 balance`);
  console.log(`  GET /token-info/:tokenAddress - Get ERC20 token info`);
  console.log(`  GET /nft-info/:collectionAddress/:tokenId - Get NFT info`);
  console.log(`  GET /health - Health check`);
});

module.exports = app;
