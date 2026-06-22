const express = require('express');
const router = express.Router();
const { ask } = require('../controllers/contractChatController');

/**
 * Contract Chat Routes
 * 
 * AI-powered chatbot for answering questions about loaded smart contracts.
 * Users can ask anything about a contract's functions, events, patterns, etc.
 */

// Ask a question about a contract
router.post('/ask', ask);

module.exports = router;
