const express = require('express');
const { deployToken, getTokenInfo, getTokenBalance } = require('../controllers/tokenController');

const router = express.Router();

// Token deployment
router.post('/deploy', deployToken);

// Token information
router.get('/info/:tokenId', getTokenInfo);

// Token balance
router.get('/balance/:tokenId/:ownerAddress', getTokenBalance);

module.exports = router;
