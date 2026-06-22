const express = require('express');
const router = express.Router();
const {
  discoverContract,
  executeCommand,
  quickExecute
} = require('../controllers/nlExecutorController');

/**
 * Natural Language Contract Executor Routes
 * 
 * These routes enable AI-powered natural language interaction with any
 * Arbitrum Sepolia smart contract by fetching ABIs and mapping commands
 * to function calls.
 */

// Discovery: Get all available functions from a contract
router.get('/discover/:contractAddress', discoverContract);

// Execute: Map natural language command to function and execute
router.post('/execute', executeCommand);

// Quick Execute: Auto-confirm and execute (use with caution)
router.post('/quick-execute', quickExecute);

module.exports = router;
