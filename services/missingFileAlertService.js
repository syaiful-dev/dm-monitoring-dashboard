// Missing-File Alert Service
// Detects workflows that did NOT receive files on the current day (relative to the
// latest date present in the data), builds a per-workflow profile for the detail view,
// and merges persistent alert state (status / email / re-alert timing).

const trendDataService = require('./trendDataService');
const alertStateStore = require('./alertStateStore');
const settingsService = require('./settingsService');

const DAY_MS = 24 * 60 * 60 * 1000;

// A workflow is monitored if EITHER:
//   - its WORKFLOWID contains a configured priority-buyer keyword (substring,
//     case-insensitive), OR
//   - it exactly matches a configured "monitored workflow" full id.
function isPriorityBuyer(workflowId) {
  const wfRaw = workflowId || '';
  const wf = wfRaw.toUpperCase();
  if (settingsService.getPriorityBuyers().some(b => wf.includes(String(b).toUpperCase()))) return true;
  // Exact monitored workflows (ignore any "db |" prefix — match on the id only).
  return settingsService.getAllMonitoredWorkflowIds().some(w => String(w).toUpperCase() === wf);
}

// Return the calendar day (YYYY-MM-DD) immediately after the given YYYY-MM-DD string.
function nextDay(dayStr) {
  const d = new Date(dayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

// Stack-safe max/min for large arrays (avoids Math.max(...arr) call-stack overflow)
function arrMax(arr) {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}
function arrMin(arr) {
  let m = Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i];
  return m;
}

function dateKey(d) {
  return d.toISOString().split('T')[0];
}

// Local-time YYYY-MM-DD (DB timestamps are wall-clock strings, so we compare
// days/times in the server's local timezone rather than UTC).
function localDayStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtHour(h) {
  if (h == null || isNaN(h)) return '—';
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function fmtDuration(ms) {
  const hrs = ms / 3600000;
  if (hrs >= 24) return `${(hrs / 24).toFixed(1)} day(s)`;
  if (hrs >= 1) return `${hrs.toFixed(1)} hour(s)`;
  return `${Math.round(ms / 60000)} min(s)`;
}

/**
 * Build a per-workflow behavioural profile from history.
 */
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Build a per-workflow behavioural profile from the SAME daily aggregates that
 * power the Trends & Analysis tab (the monthly snapshot). This guarantees the
 * numbers shown on an alert (avg files/day, usual arrival, latest arrival, avg
 * size, busiest day, etc.) match the Trends tab exactly.
 *
 * @param {Array} aggRows - snapshot aggregate rows for ONE workflow, each:
 *   { day, count, cnt50, cnt45, cnt999, minHour, maxHour, avgHour,
 *     avgSizeKb, minSizeKb, maxSizeKb }
 */
function buildProfile(aggRows) {
  const rows = (aggRows || []).filter(a => a.day);
  const days = rows.map(a => a.day).sort();
  const totalDays = days.length;
  const totalRecords = rows.reduce((s, a) => s + (a.count || 0), 0);
  const avgPerDay = totalDays > 0 ? Math.round(totalRecords / totalDays) : 0;

  const dayCounts = rows.map(a => a.count || 0);
  const minPerDay = dayCounts.length ? arrMin(dayCounts) : 0;
  const maxPerDay = dayCounts.length ? arrMax(dayCounts) : 0;

  // "Usually arrives by" = average of each day's FIRST (earliest) arrival hour.
  // In the aggregate, a day's earliest arrival is its minHour.
  const firstHours = rows.map(a => a.minHour).filter(v => v != null);
  const avgFirstArrival = firstHours.length
    ? firstHours.reduce((a, b) => a + b, 0) / firstHours.length
    : null;
  // "Latest arrival" = the latest a day's first file has arrived (worst case).
  const latestFirstArrival = firstHours.length ? arrMax(firstHours) : null;

  // Count-weighted average file size across days (matches Trends analysis).
  let sizeWeighted = 0, sizeCount = 0;
  rows.forEach(a => { if (a.avgSizeKb != null) { sizeWeighted += a.avgSizeKb * (a.count || 0); sizeCount += (a.count || 0); } });
  const avgSize = sizeCount ? Math.round((sizeWeighted / sizeCount) * 100) / 100 : 0;

  // Busiest / quietest day of week (by total count per weekday).
  const dow = [0, 0, 0, 0, 0, 0, 0];
  rows.forEach(a => {
    const d = new Date(a.day).getDay();
    if (!isNaN(d)) dow[d] += (a.count || 0);
  });
  let busiestIdx = 0, quietestIdx = 0;
  dow.forEach((c, i) => {
    if (c > dow[busiestIdx]) busiestIdx = i;
    if (c < dow[quietestIdx]) quietestIdx = i;
  });

  return {
    totalRecords,
    activeDays: totalDays,
    avgPerDay,
    minPerDay,
    maxPerDay,
    avgFirstArrival,
    avgFirstArrivalLabel: fmtHour(avgFirstArrival),
    latestFirstArrival,
    latestFirstArrivalLabel: fmtHour(latestFirstArrival),
    avgSizeKb: avgSize,
    busiestDay: DOW_NAMES[busiestIdx],
    quietestDay: DOW_NAMES[quietestIdx],
    firstSeen: days[0] || null,
    lastSeen: days[days.length - 1] || null
  };
}

/**
 * Fallback profile builder from raw recent records — used only when a workflow
 * has no rows in the Trends snapshot yet (e.g. a brand-new workflow). Produces
 * the same profile shape as buildProfile().
 */
function buildProfileFromRecords(records) {
  const byDay = {};
  const firstByDay = {};
  const sizes = [];
  const dow = [0, 0, 0, 0, 0, 0, 0];

  records.forEach(r => {
    if (!r.received) return;
    const day = r.received.split(' ')[0];
    byDay[day] = (byDay[day] || 0) + 1;
    const dt = new Date(r.received);
    const h = dt.getHours() + dt.getMinutes() / 60;
    if (firstByDay[day] == null || h < firstByDay[day]) firstByDay[day] = h;
    dow[dt.getDay()]++;
    if (r.size_kb != null) sizes.push(r.size_kb);
  });

  const days = Object.keys(byDay).sort();
  const dayCounts = days.map(d => byDay[d]);
  const totalDays = days.length;
  const firstHours = Object.values(firstByDay);
  const avgFirstArrival = firstHours.length ? firstHours.reduce((a, b) => a + b, 0) / firstHours.length : null;
  const latestFirstArrival = firstHours.length ? arrMax(firstHours) : null;
  const avgSize = sizes.length ? Math.round((sizes.reduce((a, b) => a + b, 0) / sizes.length) * 100) / 100 : 0;

  let busiestIdx = 0, quietestIdx = 0;
  dow.forEach((c, i) => { if (c > dow[busiestIdx]) busiestIdx = i; if (c < dow[quietestIdx]) quietestIdx = i; });

  return {
    totalRecords: records.length,
    activeDays: totalDays,
    avgPerDay: totalDays > 0 ? Math.round(records.length / totalDays) : 0,
    minPerDay: dayCounts.length ? arrMin(dayCounts) : 0,
    maxPerDay: dayCounts.length ? arrMax(dayCounts) : 0,
    avgFirstArrival,
    avgFirstArrivalLabel: fmtHour(avgFirstArrival),
    latestFirstArrival,
    latestFirstArrivalLabel: fmtHour(latestFirstArrival),
    avgSizeKb: avgSize,
    busiestDay: DOW_NAMES[busiestIdx],
    quietestDay: DOW_NAMES[quietestIdx],
    firstSeen: days[0] || null,
    lastSeen: days[days.length - 1] || null
  };
}

/**
 * Generate missing-file alerts (one per workflow that received nothing on the current day).
 * Merges any persisted state and applies the re-alert timing for 'review' status.
 */
function getMissingFileAlerts() {
  // Detection uses RECENT records (needs today/yesterday to see a gap).
  const records = trendDataService.loadAllRecords();
  const workflows = trendDataService.getDistinctWorkflows();
  const now = Date.now();

  // Profiles use the SAME daily aggregates as the Trends & Analysis tab, grouped
  // by workflow — so the numbers on an alert match that tab exactly.
  const aggByWf = {};
  (trendDataService.loadAggregates() || []).forEach(a => {
    if (!a.workflow_id) return;
    (aggByWf[a.workflow_id] = aggByWf[a.workflow_id] || []).push(a);
  });

  const states = alertStateStore.getAll();
  const alerts = [];

  // Only monitor the priority buyers
  workflows.filter(isPriorityBuyer).forEach(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.received);
    if (wfRecords.length < 3) return; // not enough recent history to judge a gap

    const daysWithFiles = new Set(wfRecords.map(r => r.received.split(' ')[0]));

    // Per-workflow "next expected day" = the day AFTER this workflow's own last file.
    const lastTime = arrMax(wfRecords.map(r => new Date(r.received).getTime()));
    const lastDay = localDayStr(new Date(lastTime));
    const expectedDay = nextDay(lastDay);

    // If this workflow already has files on its next-expected day, it's fine.
    if (daysWithFiles.has(expectedDay)) return;

    // Don't alert for a FUTURE expected day. If the workflow's last file is from
    // today, its next expected day is tomorrow — which simply hasn't happened yet,
    // so there's nothing missing. Only evaluate once expectedDay <= today.
    const todayStrEarly = localDayStr(new Date());
    if (expectedDay > todayStrEarly) return;

    // Missing: build the alert profile from the Trends & Analysis aggregates.
    // Fall back to the recent records only if this workflow has no snapshot rows
    // yet (e.g. brand-new workflow not in the last 1–14 window).
    const aggRows = aggByWf[wf] || [];
    const profile = aggRows.length
      ? buildProfile(aggRows)
      : buildProfileFromRecords(wfRecords);

    // ---- Time-of-day gate (only when the expected day is TODAY) ----
    // Don't raise a missing-file alert too early in the day. A file is only
    // considered "late" once we are at least ONE HOUR past the workflow's
    // usual first-arrival time ("Usually arrives by"). Before that window the
    // file may still be arriving on schedule, so we stay silent.
    //   - now < avgFirstArrival            → too early, skip
    //   - avgFirstArrival <= now < +1h     → within grace period, skip
    //   - now >= avgFirstArrival + 1h      → genuinely late, alert
    // For a PAST expected day (the whole day already elapsed), the file is
    // simply missing regardless of time-of-day, so we always alert.
    const nowDate = new Date();
    const todayStr = localDayStr(nowDate);
    if (expectedDay === todayStr && profile.avgFirstArrival != null) {
      const nowHours = nowDate.getHours() + nowDate.getMinutes() / 60;
      const alertAfter = profile.avgFirstArrival + 1; // 1-hour grace past expected
      if (nowHours < alertAfter) return; // not late yet → no alert
    }

    const overdueMs = new Date(expectedDay + 'T00:00:00Z').getTime() +
      (profile.avgFirstArrival != null ? profile.avgFirstArrival * 3600000 : 0) - Date.now();
    // overdue is informational; show days since last file instead (clearer for static data)
    const daysSinceLast = Math.max(1, Math.round((Date.now() - lastTime) / DAY_MS));

    const id = `missing::${wf}::${expectedDay}`;
    const saved = states[id] || {};

    // Determine effective status considering re-alert window
    let status = saved.status || 'new';
    let reAlerted = false;
    if (status === 'review' && saved.reviewUntil && now >= saved.reviewUntil) {
      // 30-min window elapsed and still missing → re-surface as active
      status = 'new';
      reAlerted = true;
    }

    alerts.push({
      id,
      workflow_id: wf,
      type: 'missing_file',
      severity: 'critical',
      title: `No files received on ${expectedDay} — ${wf}`,
      message: `Priority buyer "${wf}" has not received any files on ${expectedDay}. It normally receives about ${profile.avgPerDay} file(s)/day, usually starting around ${profile.avgFirstArrivalLabel} (latest seen ${profile.latestFirstArrivalLabel}). It is now more than an hour past the usual arrival time with nothing received.`,
      currentDay: expectedDay,
      expectedDay,
      lastReceived: new Date(lastTime).toISOString().replace('T', ' ').slice(0, 19),
      overdue: `${daysSinceLast} day(s) since last file`,
      status,
      emailSentAt: saved.emailSentAt || null,
      reviewUntil: saved.reviewUntil || null,
      reAlerted,
      profile
    });
  });

  // Sort: active (new/review) first, then resolved/ignored; within each group,
  // most recent "last received" first (Last received DESC), then workflow name.
  const order = { new: 0, review: 1, resolved: 2, ignored: 3 };
  const lastMs = (a) => { const t = new Date(a.lastReceived).getTime(); return Number.isFinite(t) ? t : -Infinity; };
  alerts.sort((a, b) =>
    (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
    lastMs(b) - lastMs(a) ||
    a.workflow_id.localeCompare(b.workflow_id)
  );

  return alerts;
}

/**
 * Get a single alert's full detail by id.
 */
function getAlertDetail(id) {
  return getMissingFileAlerts().find(a => a.id === id) || null;
}

/**
 * Summary counts for the stats panel.
 */
function getSummary() {
  const alerts = getMissingFileAlerts();
  return {
    total: alerts.length,
    active: alerts.filter(a => a.status === 'new').length,
    inReview: alerts.filter(a => a.status === 'review').length,
    resolved: alerts.filter(a => a.status === 'resolved').length,
    ignored: alerts.filter(a => a.status === 'ignored').length
  };
}

module.exports = {
  getMissingFileAlerts,
  getAlertDetail,
  getSummary,
  DAY_MS
};
