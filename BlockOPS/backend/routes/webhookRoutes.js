const express = require('express');
const router = express.Router();
const { register, list, remove, test, logs, eventTypes } = require('../controllers/webhookController');

/**
 * GET  /webhooks/events            – list valid event types
 * POST /webhooks/register          – register a new webhook
 * GET  /webhooks?agentId=          – list webhooks for an agent
 * DELETE /webhooks/:id             – deactivate a webhook
 * POST /webhooks/:id/test          – send a test payload
 * GET  /webhooks/:id/logs?agentId= – delivery logs for a webhook
 */

router.get('/events',    eventTypes);
router.post('/register', register);
router.get('/',          list);
router.delete('/:id',    remove);
router.post('/:id/test', test);
router.get('/:id/logs',  logs);

module.exports = router;
