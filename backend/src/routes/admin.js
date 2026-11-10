// Local-only admin API. server.js mounts this only when ADMIN_PASSWORD is set
// and NODE_ENV is not "production".
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { rateLimit } = require('express-rate-limit');
const content = require('../content');
const { exportSite } = require('../export');
const { RESUME_FILE } = require('../validate');
const { RESUME_DIR } = require('../paths');

const COOKIE = 'admin_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiry timestamp

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();
const passwordMatches = (attempt) => crypto.timingSafeEqual(sha256(attempt), sha256(process.env.ADMIN_PASSWORD));

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function isAuthenticated(req) {
  const token = readCookie(req, COOKIE);
  const expires = token && sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function setSessionCookie(res, token, maxAgeMs) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}`);
}

const router = express.Router();

// CSRF guard: state-changing requests must carry a custom header, which a
// cross-site form or image can't send (and this router has no CORS).
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'portfolio-admin') {
    return res.status(403).json({ error: 'Missing X-Requested-With header' });
  }
  next();
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });

router.post('/login', loginLimiter, express.json({ limit: '2kb' }), (req, res) => {
  if (typeof req.body?.password !== 'string' || !passwordMatches(req.body.password)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  setSessionCookie(res, token, SESSION_MS);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  sessions.delete(readCookie(req, COOKIE));
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

router.get('/session', (req, res) => res.json({ authenticated: isAuthenticated(req) }));

// Everything below requires a session.
router.use((req, res, next) => (isAuthenticated(req) ? next() : res.status(401).json({ error: 'Not logged in' })));

router.get('/content', (req, res) => res.json(content.readAll()));

router.put('/content', express.json({ limit: '1mb' }), (req, res) => {
  const result = content.saveAll(req.body || {});
  res.json({ ok: true, ...result });
});

router.get('/history', (req, res) => res.json(content.listHistory()));

router.post('/history/:id/restore', (req, res) => {
  const result = content.restoreSnapshot(req.params.id);
  if (!result) return res.status(404).json({ error: 'Snapshot not found' });
  res.json({ ok: true, ...result, content: content.readAll() });
});

router.get('/resumes', (req, res) => {
  const files = fs.existsSync(RESUME_DIR) ? fs.readdirSync(RESUME_DIR).filter((f) => RESUME_FILE.test(f)) : [];
  res.json(files.map((name) => ({ name, size: fs.statSync(path.join(RESUME_DIR, name)).size })));
});

router.post('/resume', express.raw({ type: 'application/pdf', limit: '10mb' }), (req, res) => {
  let name = String(req.query.filename || '').trim();
  if (!RESUME_FILE.test(name)) {
    return res.status(400).json({ error: 'File name must end in .pdf and use only letters, numbers, dots, dashes and underscores' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length < 5 || req.body.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return res.status(400).json({ error: 'That file is not a PDF' });
  }
  fs.mkdirSync(RESUME_DIR, { recursive: true });
  // Windows/macOS treat "cv.pdf" and "CV.pdf" as the same file and keep the old
  // name, but Vercel (Linux) doesn't. Reuse the existing spelling so the link matches.
  const existing = fs.readdirSync(RESUME_DIR).find((f) => f.toLowerCase() === name.toLowerCase());
  if (existing) name = existing;
  fs.writeFileSync(path.join(RESUME_DIR, name), req.body);
  res.json({ ok: true, name, size: req.body.length });
});

router.post('/export', (req, res) => {
  const result = exportSite();
  res.json({ ok: true, ...result });
});

router.use((err, req, res, next) => {
  if (err instanceof content.ValidationError) return res.status(400).json({ error: 'Some fields need fixing', details: err.errors });
  next(err);
});

module.exports = router;
