// Email Service
// Sends alert emails via SMTP using the config set in Admin (settingsService.smtp).
// Uses nodemailer. A fresh transport is created per send (config can change at
// runtime via Admin, and sends are infrequent — no need to pool).

const nodemailer = require('nodemailer');
const settingsService = require('./settingsService');

function buildTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: !!smtp.secure, // true for 465, false for 587/STARTTLS
    auth: (smtp.user || smtp.password) ? { user: smtp.user, pass: smtp.password } : undefined
  });
}

function fromHeader(smtp) {
  const addr = (smtp.fromAddress || smtp.user || '').trim();
  const name = (smtp.fromName || '').trim();
  if (!addr) return undefined;
  return name ? `"${name.replace(/"/g, '')}" <${addr}>` : addr;
}

function assertConfigured(smtp) {
  if (!smtp || !smtp.enabled) throw new Error('Email sending is disabled. Enable and configure SMTP in Admin → Email.');
  if (!smtp.host) throw new Error('SMTP host is not set. Configure it in Admin → Email.');
  if (!smtp.port) throw new Error('SMTP port is not set. Configure it in Admin → Email.');
  if (!(smtp.fromAddress || smtp.user)) throw new Error('SMTP "From" address is not set. Configure it in Admin → Email.');
}

/**
 * Send an email using the configured SMTP server.
 * @param {{to:string, subject:string, body:string}} msg
 * @returns {Promise<{ok:true, messageId:string}>}
 */
async function send({ to, subject, body }) {
  const smtp = settingsService.getSmtp();
  assertConfigured(smtp);
  if (!to || !String(to).trim()) throw new Error('No recipient address.');

  const transport = buildTransport(smtp);
  const info = await transport.sendMail({
    from: fromHeader(smtp),
    to: String(to),
    subject: String(subject || ''),
    text: String(body || '')
  });
  return { ok: true, messageId: info.messageId };
}

/**
 * Verify the SMTP connection/credentials without sending a message.
 * @returns {Promise<{ok:true}>}
 */
async function verify() {
  const smtp = settingsService.getSmtp();
  if (!smtp.host) throw new Error('SMTP host is not set.');
  const transport = buildTransport(smtp);
  await transport.verify();
  return { ok: true };
}

module.exports = { send, verify };
