const express = require('express');
const router  = express.Router();
const {
  depositToL2,
  withdrawToL1,
  getBridgeStatus,
  redeemRetryable
} = require('../controllers/bridgeController');

// POST /bridge/deposit          — deposit ETH or ERC20 from L1 → L2
router.post('/deposit', depositToL2);

// POST /bridge/withdraw         — initiate ETH or ERC20 withdrawal from L2 → L1
router.post('/withdraw', withdrawToL1);

// GET  /bridge/status/:txHash   — retryable ticket status for a deposit tx
router.get('/status/:txHash', getBridgeStatus);

// POST /bridge/retryable        — re-execute a failed retryable ticket on L2
router.post('/retryable', redeemRetryable);

module.exports = router;
