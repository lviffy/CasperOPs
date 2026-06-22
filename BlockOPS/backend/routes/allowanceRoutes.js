const express = require('express');
const router = express.Router();
const { 
  approveToken, 
  revokeApproval, 
  checkAllowance 
} = require('../controllers/allowanceController');

// Approve token spending
router.post('/approve', approveToken);

// Revoke token approval
router.post('/revoke', revokeApproval);

// Check current allowance
router.get('/check/:tokenAddress/:ownerAddress/:spenderAddress', checkAllowance);

module.exports = router;
