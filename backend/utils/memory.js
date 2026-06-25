/**
 * Conversation Memory Utilities
 * Handles token estimation and context building for AI conversations
 */

const MAX_CONTEXT_TOKENS = 8000;
const CHARS_PER_TOKEN = 4; // Rough estimate

/**
 * Estimate tokens for text (fast approximation)
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.floor(text.length / CHARS_PER_TOKEN));
}

/**
 * Build context from messages, respecting token limit
 * @param {Array} messages - Array of message objects with role and content
 * @param {string} systemPrompt - Optional system prompt
 * @param {number} maxTokens - Maximum tokens to include
 * @returns {Object} { context: Array, tokenCount: number }
 */
function buildContext(messages, systemPrompt = '', maxTokens = MAX_CONTEXT_TOKENS) {
  const context = [];
  let currentTokens = 0;

  // Add system prompt if provided
  if (systemPrompt) {
    context.push({ role: 'system', content: systemPrompt });
    currentTokens += estimateTokens(systemPrompt) + 10; // +10 for overhead
  }

  // Add messages from most recent backwards
  const reversedMessages = [...messages].reverse();
  
  for (const msg of reversedMessages) {
    const msgTokens = estimateTokens(msg.content) + 10; // +10 for role/overhead
    
    if (currentTokens + msgTokens > maxTokens) {
      break; // Stop if we exceed token limit
    }
    
    // Add to front of context (since we're iterating backwards)
    context.unshift({ 
      role: msg.role, 
      content: msg.content 
    });
    currentTokens += msgTokens;
  }

  return { context, tokenCount: currentTokens };
}

/**
 * Truncate message if too long
 * @param {string} content - Message content
 * @param {number} maxLength - Maximum length in characters
 * @returns {string} Truncated content
 */
function truncateMessage(content, maxLength = 4000) {
  if (!content) return '';
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength - 3) + '...';
}

/**
 * Compress tool calls to reduce storage
 * @param {Array} toolCalls - Array of tool call objects
 * @returns {Array} Compressed tool calls
 */
function compressToolCalls(toolCalls) {
  if (!toolCalls || !Array.isArray(toolCalls)) return null;
  
  return toolCalls.map(call => ({
    tool: call.tool || call.function?.name,
    args: call.args || call.function?.arguments,
    result: call.result ? String(call.result).slice(0, 200) : null // Limit result size
  }));
}

module.exports = { 
  estimateTokens, 
  buildContext, 
  truncateMessage,
  compressToolCalls,
  MAX_CONTEXT_TOKENS
};
