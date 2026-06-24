const express = require('express');
const router = express.Router();
const { getPropertyValuation, fractionalizeRwa } = require('../controllers/rwaController');

/**
 * @route   POST /rwa/property-valuation
 * @desc    Fetch certified appraisal and land registry valuation for a property address
 * @access  Protected
 * @body    { propertyAddress: "123 Casper Way, Zug, Switzerland" }
 */
router.post('/property-valuation', getPropertyValuation);

/**
 * @route   POST /rwa/fractionalize
 * @desc    Fractionalizes a certified RWA valuation into a CEP-18 token representing shares
 * @access  Protected
 * @body    { propertyAddress, valuationId, tokenName, tokenSymbol, decimals, fractionsCount }
 */
router.post('/fractionalize', fractionalizeRwa);

module.exports = router;
