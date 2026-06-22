const express = require('express');
const router = express.Router();
const { batchTransferETH, batchTransferERC20, batchMint, batchApprove } = require('../controllers/batchController');

/**
 * POST /batch/transfer        — send native ETH to multiple addresses (Multicall3, single tx)
 * POST /batch/transfer-erc20  — send ERC20 token to multiple addresses (sequential txs)
 * POST /batch/mint            — mint NFTs to multiple recipients
 * POST /batch/approve         — approve multiple spenders for an ERC20
 */
router.post('/transfer',        batchTransferETH);
router.post('/transfer-erc20',  batchTransferERC20);
router.post('/mint',            batchMint);
router.post('/approve',         batchApprove);

module.exports = router;
