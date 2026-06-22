const express = require('express');
const { sendEmail, sendHtml, verify } = require('../controllers/emailController');

const router = express.Router();

// Send email (text or HTML, with optional attachments)
router.post('/send', sendEmail);

// Send HTML email (convenience endpoint)
router.post('/send-html', sendHtml);

// Verify email credentials / SMTP connection
router.get('/verify', verify);

module.exports = router;
