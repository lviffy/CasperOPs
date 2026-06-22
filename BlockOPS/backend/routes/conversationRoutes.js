const express = require('express');
const {
  chat,
  listConversations,
  getMessages,
  getConversation,
  deleteConversation,
  updateConversation,
  getStats,
  runCleanup
} = require('../controllers/conversationController');

const router = express.Router();

// ============================================
// CHAT ENDPOINTS
// ============================================

/**
 * Main chat endpoint
 * POST /api/chat
 * Body: { agentId, userId, message, conversationId?, systemPrompt? }
 */
router.post('/chat', chat);

// ============================================
// CONVERSATION MANAGEMENT
// ============================================

/**
 * List user's conversations
 * GET /api/conversations?userId=xxx&agentId=xxx&limit=20
 */
router.get('/conversations', listConversations);

/**
 * Get a single conversation
 * GET /api/conversations/:conversationId
 */
router.get('/conversations/:conversationId', getConversation);

/**
 * Get messages for a conversation
 * GET /api/conversations/:conversationId/messages?limit=50
 */
router.get('/conversations/:conversationId/messages', getMessages);

/**
 * Update conversation (title)
 * PATCH /api/conversations/:conversationId
 * Body: { title }
 */
router.patch('/conversations/:conversationId', updateConversation);

/**
 * Delete a conversation
 * DELETE /api/conversations/:conversationId
 */
router.delete('/conversations/:conversationId', deleteConversation);

// ============================================
// ADMIN ENDPOINTS
// ============================================

/**
 * Get database statistics
 * GET /api/admin/stats
 * Requires: Authorization: Bearer <ADMIN_SECRET>
 */
router.get('/admin/stats', getStats);

/**
 * Run manual cleanup
 * POST /api/admin/cleanup
 * Body: { maxDelete?: 100 }
 * Requires: Authorization: Bearer <ADMIN_SECRET>
 */
router.post('/admin/cleanup', runCleanup);

module.exports = router;
