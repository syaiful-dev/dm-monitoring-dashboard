// Auth Routes — admin login / logout / session check
const express = require('express');
const router = express.Router();
const authService = require('../services/authService');

// Simple in-memory brute-force guard: 5 failed attempts per IP => 15 min lockout.
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map(); // ip -> { count, until }

function lockedFor(ip) {
  const f = fails.get(ip);
  if (!f || !f.until) return 0;
  if (Date.now() >= f.until) { fails.delete(ip); return 0; }
  return f.until - Date.now();
}

// POST /auth/login — { username, password }
router.post('/login', (req, res) => {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const wait = lockedFor(ip);
  if (wait > 0) {
    res.set('Retry-After', String(Math.ceil(wait / 1000)));
    return res.status(429).json({ ok: false, error: 'Too many failed attempts. Try again in ' + Math.ceil(wait / 60000) + ' minute(s).' });
  }
  const { username, password } = req.body || {};
  if (authService.verify(username, password)) {
    fails.delete(ip);
    req.session.isAdmin = true;
    req.session.username = username;
    return res.json({ ok: true });
  }
  const f = fails.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.count = 0; }
  fails.set(ip, f);
  return res.status(401).json({ ok: false, error: 'Invalid username or password' });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /auth/me — is the current session an admin?
router.get('/me', (req, res) => {
  res.json({
    authenticated: !!(req.session && req.session.isAdmin),
    username: req.session ? req.session.username || null : null
  });
});

module.exports = router;
