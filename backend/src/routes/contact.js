const express = require('express');
const { rateLimit } = require('express-rate-limit');
const nodemailer = require('nodemailer');

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const LIMITS = { name: 100, email: 254, message: 5000 };

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  } else if (process.env.NODE_ENV !== 'production') {
    // Local development without SMTP: build the message but only log it.
    console.warn('[contact] SMTP_HOST is not set — messages will be logged, not sent.');
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

function validate(body) {
  const fields = {};
  const errors = [];
  for (const key of ['name', 'email', 'message']) {
    const value = typeof body?.[key] === 'string' ? body[key].trim() : '';
    if (!value) errors.push(`${key} is required`);
    else if (value.length > LIMITS[key]) errors.push(`${key} must be at most ${LIMITS[key]} characters`);
    fields[key] = value;
  }
  if (fields.email && !EMAIL.test(fields.email)) errors.push('email is not a valid email address');
  return { fields, errors };
}

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many messages from this address. Please try again in 15 minutes.' },
});

const router = express.Router();

// Limiter runs before body parsing so malformed requests count toward the limit too.
router.post('/', contactLimiter, express.json({ limit: '20kb' }), async (req, res) => {
  // Honeypot: real visitors never see the "website" field. Pretend success.
  if (typeof req.body?.website === 'string' && req.body.website.trim() !== '') {
    return res.json({ ok: true });
  }

  const { fields, errors } = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; '), details: errors });

  const mailer = getTransporter();
  const to = process.env.CONTACT_TO;
  if (!mailer || (!to && process.env.NODE_ENV === 'production')) {
    console.error('[contact] Email is not configured (SMTP_HOST / CONTACT_TO).');
    return res.status(503).json({ error: 'The contact form is temporarily unavailable. Please email me directly.' });
  }

  const safeName = fields.name.replace(/[\r\n]+/g, ' ');
  try {
    const info = await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'portfolio@localhost',
      to: to || 'dev@localhost',
      replyTo: { name: safeName, address: fields.email },
      subject: `Portfolio contact from ${safeName}`,
      text: `Name: ${fields.name}\nEmail: ${fields.email}\n\n${fields.message}\n`,
    });
    if (info.message && !process.env.SMTP_HOST) console.log('[contact] (not sent) %s', info.message.toString());
    return res.json({ ok: true });
  } catch (err) {
    console.error('[contact] Failed to send email:', err.message);
    return res.status(502).json({ error: 'Message could not be sent. Please try again later.' });
  }
});

module.exports = router;
