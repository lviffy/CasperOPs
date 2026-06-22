const express = require('express');
const router = express.Router();
const { estimateGas, simulateGas, gasHistory } = require('../controllers/gasController');

// GET /gas/estimate    — current base fee + slow/normal/fast tiers
router.get('/estimate', estimateGas);

// POST /gas/simulate   — estimate gas for a specific call
router.post('/simulate', simulateGas);

// GET /gas/history     — base fee trend over recent blocks
router.get('/history', gasHistory);

module.exports = router;
