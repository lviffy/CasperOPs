const express = require('express');
const { deployToken, prepareDeployToken, getTokenInfo, getTokenBalance, broadcastDeploy } = require('../controllers/tokenController');

const router = express.Router();

// Token deployment
router.post('/deploy', deployToken);
router.post('/prepare-deploy', prepareDeployToken);
router.post('/broadcast', broadcastDeploy);

// Token information
router.get('/info/:tokenId', getTokenInfo);

// Token balance
router.get('/balance/:tokenId/:ownerAddress', getTokenBalance);

module.exports = router;
