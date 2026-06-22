const express = require('express');
const { DEFAULT_CHAIN, FACTORY_ADDRESS, NFT_FACTORY_ADDRESS, getChainConfig } = require('../config/constants');
const { getChainMetadata, getSupportedChains } = require('../utils/chains');

const router = express.Router();

// Health check endpoint
router.get('/', (req, res) => {
  const defaultChain = getChainMetadata(DEFAULT_CHAIN);
  const defaultChainConfig = getChainConfig(DEFAULT_CHAIN);
  res.json({ 
    status: 'ok', 
    ...defaultChain,
    rpc: defaultChainConfig.rpcUrl,
    tokenFactory: FACTORY_ADDRESS,
    nftFactory: NFT_FACTORY_ADDRESS,
    supportedChains: getSupportedChains().map((chain) => ({
      chain: chain.id,
      chainId: chain.chainId,
      network: chain.name,
      rpc: chain.rpcUrl,
      explorer: chain.explorerBaseUrl,
      nativeCurrency: chain.nativeCurrency.symbol
    })),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
