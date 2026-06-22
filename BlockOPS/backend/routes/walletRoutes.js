const express = require('express');
const router = express.Router();
const { 
  wrapETH, 
  unwrapETH, 
  getTokenMetadata, 
  getTransactionStatus, 
  getWalletHistory 
} = require('../controllers/walletController');

// Wrap ETH to WETH
router.post('/wrap', wrapETH);

// Unwrap WETH to ETH
router.post('/unwrap', unwrapETH);

// Get token metadata
router.get('/token/:address', getTokenMetadata);

// Get transaction status
router.get('/tx/:hash', getTransactionStatus);

// Get wallet transaction history
router.get('/history/:address', getWalletHistory);

module.exports = router;
