// Auth Service — single Admin login
// Credentials come from .env:
//   ADMIN_USERNAME (default "admin")
//   ADMIN_PASSWORD_HASH  (bcrypt hash — preferred)
//   ADMIN_PASSWORD       (plaintext fallback for quick/demo setup)
// Generate a hash with:  node scripts/hash-password.js "yourPassword"

const bcrypt = require('bcryptjs');

const USERNAME = process.env.ADMIN_USERNAME || 'admin';
const HASH = process.env.ADMIN_PASSWORD_HASH || '';
const PLAIN = process.env.ADMIN_PASSWORD || 'admin123'; // demo default; change via .env

/**
 * Verify a username/password. Returns true on success.
 */
function verify(username, password) {
  if (!username || !password) return false;
  if (username !== USERNAME) return false;

  if (HASH) {
    try { return bcrypt.compareSync(password, HASH); } catch { return false; }
  }
  // Fallback: compare against plaintext env (demo only)
  return password === PLAIN;
}

function getUsername() { return USERNAME; }

module.exports = { verify, getUsername };
