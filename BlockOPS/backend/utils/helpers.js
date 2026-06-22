const { DEFAULT_CHAIN, getChainConfig } = require('../config/constants');

/**
 * Generate transaction explorer URL
 * @param {string} txHash - Transaction hash
 * @param {string} chain - Canonical chain id
 * @returns {string} Explorer URL
 */
function getTxExplorerUrl(txHash, chain = DEFAULT_CHAIN) {
  const config = getChainConfig(chain);
  return `${config.explorerBaseUrl}/tx/${txHash}`;
}

/**
 * Generate address explorer URL
 * @param {string} address - Contract or wallet address
 * @param {string} chain - Canonical chain id
 * @returns {string} Explorer URL
 */
function getAddressExplorerUrl(address, chain = DEFAULT_CHAIN) {
  const config = getChainConfig(chain);
  return `${config.explorerBaseUrl}/address/${address}`;
}

/**
 * Format success response
 * @param {Object} data - Response data
 * @returns {Object} Formatted response
 */
function successResponse(data) {
  return {
    success: true,
    ...data
  };
}

/**
 * Format error response
 * @param {string} error - Error message
 * @param {string} details - Additional error details (optional)
 * @returns {Object} Formatted error response
 */
function errorResponse(error, details = null) {
  const response = {
    success: false,
    error: error
  };
  
  if (details) {
    response.details = details;
  }
  
  return response;
}

/**
 * Validate required fields in request body
 * @param {Object} body - Request body
 * @param {Array<string>} requiredFields - Array of required field names
 * @returns {Object|null} Error response or null if valid
 */
function validateRequiredFields(body, requiredFields) {
  const missing = requiredFields.filter(field => !body[field]);
  
  if (missing.length > 0) {
    return errorResponse(
      `Missing required fields: ${missing.join(', ')}`
    );
  }
  
  return null;
}

/**
 * Log transaction details
 * @param {string} action - Action being performed
 * @param {Object} details - Transaction details
 */
function logTransaction(action, details) {
  console.log(`\n[${new Date().toISOString()}] ${action}`);
  console.log('Details:', JSON.stringify(details, null, 2));
}

module.exports = {
  getTxExplorerUrl,
  getAddressExplorerUrl,
  successResponse,
  errorResponse,
  validateRequiredFields,
  logTransaction
};
