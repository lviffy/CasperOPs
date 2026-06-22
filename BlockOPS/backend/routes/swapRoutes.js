const express = require('express');
const router = express.Router();
const { swap, getQuote } = require('../controllers/swapController');

// GET /swap/quote  — dry-run quote (no tx sent)
router.get('/quote', getQuote);

// POST /swap       — execute a swap
router.post('/', swap);

module.exports = router;
