const express = require('express');
const router = express.Router();
const { getTokenPrice } = require('../controllers/priceController');

/**
 * @route   POST /price/token
 * @desc    Get token prices using natural language query
 * @access  Public
 * @body    { query: "bitcoin price" }
 */
router.post('/token', getTokenPrice);

module.exports = router;
