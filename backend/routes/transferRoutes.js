const express = require('express');
const { transfer, prepareTransfer, getBalance } = require('../controllers/transferController');

const router = express.Router();

// Transfer endpoint (legacy - uses private key)
router.post('/', transfer);

// Prepare transfer for MetaMask signing
router.post('/prepare', prepareTransfer);

// Get native balance
router.get('/balance/:address', getBalance);

module.exports = router;
