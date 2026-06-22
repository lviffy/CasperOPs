const {
  sendTextEmail,
  sendHtmlEmail,
  sendEmailWithAttachments,
  verifyConnection,
} = require('../services/emailService');
const { successResponse, errorResponse, validateRequiredFields } = require('../utils/helpers');

/**
 * POST /email/send
 * Send a plain-text or HTML email (with optional attachments)
 *
 * Body:
 *   to       - string | string[]  (required)
 *   subject  - string             (required)
 *   text     - string             (plain text body, required if no html)
 *   html     - string             (HTML body, optional)
 *   cc       - string             (optional)
 *   bcc      - string             (optional)
 *   replyTo  - string             (optional)
 *   attachments - Array<{ filename, path?, content?, contentType? }> (optional)
 */
async function sendEmail(req, res) {
  try {
    const { to, subject, text, html, cc, bcc, replyTo, attachments } = req.body;

    // Validate required fields
    const validationError = validateRequiredFields(req.body, ['to', 'subject']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    if (!text && !html) {
      return res.status(400).json(
        errorResponse('Either "text" or "html" body is required.')
      );
    }

    // Choose the right sender based on what the caller provided
    let info;
    if (attachments && attachments.length > 0) {
      info = await sendEmailWithAttachments({ to, subject, text, html, attachments, cc, bcc, replyTo });
    } else if (html) {
      info = await sendHtmlEmail({ to, subject, html, text, cc, bcc, replyTo });
    } else {
      info = await sendTextEmail({ to, subject, text, cc, bcc, replyTo });
    }

    return res.json(
      successResponse({
        message: 'Email sent successfully',
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
      })
    );
  } catch (error) {
    console.error('[Email Controller] sendEmail error:', error.message);
    return res.status(500).json(
      errorResponse(`Failed to send email: ${error.message}`)
    );
  }
}

/**
 * POST /email/send-html
 * Convenience endpoint specifically for rich HTML emails
 */
async function sendHtml(req, res) {
  try {
    const { to, subject, html, text, cc, bcc, replyTo, attachments } = req.body;

    const validationError = validateRequiredFields(req.body, ['to', 'subject', 'html']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const info = await sendHtmlEmail({ to, subject, html, text, cc, bcc, replyTo, attachments });

    return res.json(
      successResponse({
        message: 'HTML email sent successfully',
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
      })
    );
  } catch (error) {
    console.error('[Email Controller] sendHtml error:', error.message);
    return res.status(500).json(
      errorResponse(`Failed to send HTML email: ${error.message}`)
    );
  }
}

/**
 * GET /email/verify
 * Verify that email credentials / SMTP connection are working
 */
async function verify(req, res) {
  try {
    await verifyConnection();
    return res.json(
      successResponse({ message: 'Email connection verified ✅' })
    );
  } catch (error) {
    console.error('[Email Controller] verify error:', error.message);
    return res.status(500).json(
      errorResponse(`Email verification failed: ${error.message}`)
    );
  }
}

module.exports = { sendEmail, sendHtml, verify };
