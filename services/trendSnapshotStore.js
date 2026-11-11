// Trend Snapshot Store
// The Trends & Analysis tab is built from a MONTHLY snapshot: the daily
// aggregates for days 1–14 of a month, captured with NO row cap, persisted to
// disk, and refreshed only on/after the 15th when the month rolls over.
//
// Why: trends don't need live data — they describe a stable historical window.
// Reading the DB once a month (not on every startup) keeps `npm run dev` instant
// and avoids hammering the production databases.
//
// File: data/trendSnapshot.json
//   {
//     "window":     { "from": "2026-09-01", "to": "2026-09-14", "label": "Sep 2026 (1–14)" },
//     "generatedAt": "2026-09-29T03:00:00.000Z",
//     "rows":       [ <normalized aggregate rows> ]
//   }

const fs = require('fs');
const path = require('path');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'data', 'trendSnapshot.json');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

// Last calendar day of a given month (0-based month).
function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0).getDate(); // 28/29/30/31
}

/**
 * Determine the target TREND window for a given "now".
 *
 * Two half-month phases per month:
 *   Phase 1 = days 1–14   (completes at end of the 14th)
 *   Phase 2 = days 15–end (completes at end of the month)
 *
 * Rule: show the phase that completed ONE FULL PHASE BEFORE the most recent one
 * — i.e. always one phase behind the freshest. This gives a deliberate ~2-week
 * settling lag so the analysed window is fully stable (clients sometimes keep
 * sending a period's files up to the 15th–20th, so we don't analyse a phase that
 * may still be receiving late files).
 *
 *   - today is 1st–14th → most-recent completed = prev month's P2
 *                         → step back one more = prev month's P1 (1–14)
 *   - today is 15th+    → most-recent completed = this month's P1
 *                         → step back one more = prev month's P2 (15–end)
 *
 * Examples:
 *   1 Oct  → Sep 1–14      (one phase behind Sep 15–30)
 *   14 Oct → Sep 1–14
 *   15 Oct → Sep 15–30     (one phase behind Oct 1–14)
 *   28 Oct → Sep 15–30
 *   1 Nov  → Oct 1–14
 *
 * Returns { from, to, label, key }. `key` uniquely identifies the window
 * ("YYYY-MM-P1" / "YYYY-MM-P2") so a saved snapshot is detected as stale the
 * moment the target phase changes (on the 1st and the 15th).
 */
function computeWindow(now = new Date()) {
  const day = now.getDate();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-based

  // Start from the MOST RECENTLY COMPLETED phase …
  let phase; // 1 = days 1–14, 2 = days 15–end
  if (day >= 15) {
    phase = 1;                       // this month's P1 just completed
  } else {
    phase = 2;                       // prev month's P2 just completed
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
  }

  // … then step back ONE MORE phase (the deliberate settling lag).
  if (phase === 1) {
    // P1 → previous phase is the PRIOR month's P2.
    phase = 2;
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
  } else {
    // P2 → previous phase is the SAME month's P1.
    phase = 1;
  }

  const mm = pad(month + 1);
  if (phase === 1) {
    return {
      from: `${year}-${mm}-01`,
      to: `${year}-${mm}-14`,
      label: `${MONTHS[month]} ${year} (1–14)`,
      key: `${year}-${mm}-P1`
    };
  }
  const last = lastDayOfMonth(year, month);
  return {
    from: `${year}-${mm}-15`,
    to: `${year}-${mm}-${pad(last)}`,
    label: `${MONTHS[month]} ${year} (15–${last})`,
    key: `${year}-${mm}-P2`
  };
}

function read() {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return null;
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('[trendSnapshotStore] read error:', err.message);
    return null;
  }
}

function write(snapshot) {
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[trendSnapshotStore] write error:', err.message);
    return false;
  }
}

/**
 * Is the given saved snapshot current for "now"? It's current when its window
 * key matches the target window key. (If the month has rolled and we're past
 * the 15th, the target key changes and the snapshot is considered stale.)
 */
function isCurrent(snapshot, now = new Date()) {
  if (!snapshot || !snapshot.window || !Array.isArray(snapshot.rows)) return false;
  return snapshot.window.key === computeWindow(now).key;
}

module.exports = {
  SNAPSHOT_PATH,
  computeWindow,
  read,
  write,
  isCurrent
};
