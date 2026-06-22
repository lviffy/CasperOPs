const express = require('express');
const router = express.Router();
const { getPortfolio } = require('../controllers/portfolioController');

// GET /portfolio/:address
router.get('/:address', getPortfolio);

module.exports = router;
