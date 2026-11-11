// Alert State Store
// Persists per-alert state (status, email-sent time, re-alert deadline) to a JSON file,
// so alert status survives across requests/restarts. Keyed by the alert id
// (e.g. "missing::<workflow>::<date>").

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'alertStates.json');

// Re-alert window after a "review" action.
// Priority: Admin setting (config/settings.json) > env > default 30.
const settingsService = require('./settingsService');
function reAlertMinutes() {
  const fromEnv = parseInt(process.env.ALERT_REVIEW_MINUTES, 10);
  return settingsService.getReAlertMinutes() || (Number.isFinite(fromEnv) ? fromEnv : 30);
}

const VALID_STATUSES = ['new', 'review', 'resolved', 'ignored'];

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('[alertStateStore] read error:', err.message);
    return {};
  }
}

function writeStore(data) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[alertStateStore] write error:', err.message);
  }
}

/** All saved states, keyed by alert id. */
function getAll() {
  return readStore();
}

/** State for a single alert id (or null). */
function get(id) {
  return readStore()[id] || null;
}

/**
 * Update an alert's status.
 * - review   → records emailSentAt (simulated) and sets reviewUntil = now + window
 * - resolved → closes the alert
 * - ignored  → dismisses the alert
 * - new      → clears review timing (back to active)
 */
function setStatus(id, status, meta = {}) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const store = readStore();
  const now = Date.now();
  const prev = store[id] || {};
  const entry = { ...prev, status, updatedAt: new Date(now).toISOString() };

  if (status === 'review') {
    // Simulate sending an alert email to the client and start the re-alert timer.
    const mins = reAlertMinutes();
    entry.emailSentAt = new Date(now).toISOString();
    entry.reviewUntil = now + mins * 60 * 1000;
    entry.reviewCount = (prev.reviewCount || 0) + 1;
    console.log(`[alertStateStore] (SIMULATED EMAIL) Alert "${id}" — notified client. Re-alert in ${mins} min if still missing.`);
  } else if (status === 'resolved' || status === 'ignored') {
    entry.reviewUntil = null;
  } else if (status === 'new') {
    entry.reviewUntil = null;
  }

  if (meta.note != null) entry.note = String(meta.note);

  store[id] = entry;
  writeStore(store);
  return entry;
}

/**
 * TEST HELPER — fast-forward the re-alert deadline so the 30-min re-alert can be
 * demonstrated without waiting. Sets reviewUntil into the past.
 */
function expireReview(id) {
  const store = readStore();
  if (store[id] && store[id].status === 'review') {
    store[id].reviewUntil = Date.now() - 1000;
    writeStore(store);
    return true;
  }
  return false;
}

module.exports = {
  getAll,
  get,
  setStatus,
  expireReview,
  reAlertMinutes,        // function — current value from settings
  VALID_STATUSES
};
