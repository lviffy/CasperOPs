const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * Gmail SMTP transporter (singleton)
 */
let transporter = null;

/**
 * Initialize the nodemailer transporter with Gmail credentials
 * @returns {Object} nodemailer transporter
 */
function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('Gmail credentials not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env');
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  return transporter;
}

/**
 * Send a plain text email
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient(s)
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text body
 * @param {string} [options.cc] - CC recipients
 * @param {string} [options.bcc] - BCC recipients
 * @param {string} [options.replyTo] - Reply-to address
 * @returns {Promise<Object>} Send result
 */
async function sendTextEmail({ to, subject, text, cc, bcc, replyTo }) {
  const transport = getTransporter();
  const mailOptions = {
    from: `"BlockOps" <${process.env.GMAIL_USER}>`,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    text,
    ...(cc && { cc }),
    ...(bcc && { bcc }),
    ...(replyTo && { replyTo }),
  };

  const info = await transport.sendMail(mailOptions);
  console.log(`[Email] Text email sent: ${info.messageId}`);
  return info;
}

/**
 * Send an HTML email
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient(s)
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body
 * @param {string} [options.text] - Fallback plain text
 * @param {string} [options.cc] - CC recipients
 * @param {string} [options.bcc] - BCC recipients
 * @param {string} [options.replyTo] - Reply-to address
 * @param {Array}  [options.attachments] - Array of attachment objects
 * @returns {Promise<Object>} Send result
 */
async function sendHtmlEmail({ to, subject, html, text, cc, bcc, replyTo, attachments }) {
  const transport = getTransporter();
  const mailOptions = {
    from: `"BlockOps" <${process.env.GMAIL_USER}>`,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
    ...(text && { text }),
    ...(cc && { cc }),
    ...(bcc && { bcc }),
    ...(replyTo && { replyTo }),
    ...(attachments && { attachments }),
  };

  const info = await transport.sendMail(mailOptions);
  console.log(`[Email] HTML email sent: ${info.messageId}`);
  return info;
}

/**
 * Send an email with attachments
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient(s)
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text body
 * @param {string} [options.html] - HTML body
 * @param {Array}  options.attachments - Array of { filename, path | content, contentType }
 * @param {string} [options.cc] - CC recipients
 * @param {string} [options.bcc] - BCC recipients
 * @param {string} [options.replyTo] - Reply-to address
 * @returns {Promise<Object>} Send result
 */
async function sendEmailWithAttachments({ to, subject, text, html, attachments, cc, bcc, replyTo }) {
  const transport = getTransporter();
  const mailOptions = {
    from: `"BlockOps" <${process.env.GMAIL_USER}>`,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    ...(text && { text }),
    ...(html && { html }),
    attachments,
    ...(cc && { cc }),
    ...(bcc && { bcc }),
    ...(replyTo && { replyTo }),
  };

  const info = await transport.sendMail(mailOptions);
  console.log(`[Email] Email with attachments sent: ${info.messageId}`);
  return info;
}

/**
 * Verify that the SMTP connection / credentials are valid
 * @returns {Promise<boolean>}
 */
async function verifyConnection() {
  const transport = getTransporter();
  return transport.verify();
}

module.exports = {
  sendTextEmail,
  sendHtmlEmail,
  sendEmailWithAttachments,
  verifyConnection,
};
