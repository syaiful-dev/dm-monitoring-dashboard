// Trend Data Service — parses Trenddata CSVs and serves real eHub B2B document records
// Central data source for ALL dashboard features: Overview, Trends, Files, Alerts, Insights, Chatbot

const fs = require('fs');
const path = require('path');
const trendSource = require('../config/trendSource');

// CSV folder. Override with TREND_CSV_DIR (relative to the project root or absolute),
// e.g. the smoke test / CI points it at the fictional data in data/Trenddata/sample.
const TRENDDATA_DIR = process.env.TREND_CSV_DIR
  ? path.resolve(__dirname, '..', process.env.TREND_CSV_DIR)
  : path.join(__dirname, '..', 'data', 'Trenddata');

let cachedRecords = null;
// Daily per-(workflow,day) aggregate rows for the Trends & Analysis tab.
// Populated in DB mode from a GROUP BY query (tiny footprint); in CSV mode it is
// derived in-memory from the raw records so the same code path serves both.
let cachedAggregates = null;

// Stack-safe max/min for large arrays (Math.max(...arr) overflows on 100k+ elements)
function arrMax(arr) { let m = -Infinity; for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; }
function arrMin(arr) { let m = Infinity; for (let i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i]; return m; }

/**
 * Parse a single CSV line respecting quoted fields (handles commas inside quotes)
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Load and parse all CSV files from the Trenddata directory
 */
const clean = (s) => (s == null ? '' : s.replace(/^"|"$/g, '').trim());

/**
 * Resolve a usable "YYYY-MM-DD HH:MM:SS" datetime for a record.
 * Priority:
 *   1) CREATIONDATE if it is a valid full datetime (some exports mangle it to "MM:SS.0")
 *   2) METADATA <lastModified>YYYYMMDDHHMMSS</lastModified>
 *   3) RECEIVEDATE (date only) — appended with 00:00:00
 * Returns null if nothing usable is found.
 */
function resolveDatetime(creationDate, metadata, receiveDate) {
  // 1) Valid CREATIONDATE — must contain a 4-digit year and look like a date
  if (creationDate && /\d{4}-\d{2}-\d{2}/.test(creationDate)) {
    // Normalize "2026-09-15 10:25:22.000" -> "2026-09-15 10:25:22"
    const m = creationDate.match(/(\d{4}-\d{2}-\d{2})[ T]?(\d{2}:\d{2}:\d{2})?/);
    if (m) return `${m[1]} ${m[2] || '00:00:00'}`;
  }

  // 2) METADATA lastModified (YYYYMMDDHHMMSS)
  if (metadata) {
    const lm = metadata.match(/<lastModified>(\d{14})<\/lastModified>/);
    if (lm) {
      const s = lm[1];
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
    }
  }

  // 3) RECEIVEDATE (date only)
  if (receiveDate && /\d{4}-\d{2}-\d{2}/.test(receiveDate)) {
    const d = receiveDate.match(/\d{4}-\d{2}-\d{2}/)[0];
    return `${d} 00:00:00`;
  }

  return null;
}

/**
 * Read a (potentially very large) file line by line, invoking onLine(line) for each.
 * Uses a streamed buffered read so we never hold the whole file as one big string.
 */
function forEachLineSync(filePath, onLine) {
  const fd = fs.openSync(filePath, 'r');
  const BUF = Buffer.alloc(1 << 20); // 1MB chunks
  let leftover = '';
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, BUF, 0, BUF.length, null)) > 0) {
      const chunk = leftover + BUF.toString('utf-8', 0, bytes);
      const parts = chunk.split('\n');
      leftover = parts.pop(); // last piece may be a partial line
      for (const line of parts) onLine(line);
    }
    if (leftover.length > 0) onLine(leftover);
  } finally {
    fs.closeSync(fd);
  }
}

function loadRecordsFromCsv() {
  const records = [];

  if (!fs.existsSync(TRENDDATA_DIR)) {
    console.warn('[TrendDataService] Trenddata directory not found:', TRENDDATA_DIR);
    return records;
  }

  const files = fs.readdirSync(TRENDDATA_DIR).filter(f => f.endsWith('.csv'));

  for (const file of files) {
    const filePath = path.join(TRENDDATA_DIR, file);

    let headers = null;
    let idx = null;

    forEachLineSync(filePath, (rawLine) => {
      const line = rawLine.replace(/\r$/, '');
      if (line.trim().length === 0) return;

      if (!headers) {
        headers = parseCsvLine(line).map(h => clean(h));
        idx = {
          docId: headers.indexOf('DOCID'),
          workflowId: headers.indexOf('WORKFLOWID'),
          docFilename: headers.indexOf('DOCFILENAME'),
          docSize: headers.indexOf('DOCSIZE'),
          creationDate: headers.indexOf('CREATIONDATE'),
          status: headers.indexOf('STATUS'),
          metadata: headers.indexOf('METADATA'),
          receiveDate: headers.indexOf('RECEIVEDATE')
        };
        return;
      }

      const fields = parseCsvLine(line);
      if (fields.length < headers.length) return;

      const docFilename = idx.docFilename >= 0 ? clean(fields[idx.docFilename]) : '';
      if (!docFilename) return;

      const docSize = idx.docSize >= 0 ? clean(fields[idx.docSize]) : '';
      const creationDate = idx.creationDate >= 0 ? clean(fields[idx.creationDate]) : '';
      const metadata = idx.metadata >= 0 ? fields[idx.metadata] : '';
      const receiveDate = idx.receiveDate >= 0 ? clean(fields[idx.receiveDate]) : '';
      const received = resolveDatetime(creationDate, metadata, receiveDate);

      records.push({
        doc_id: idx.docId >= 0 ? clean(fields[idx.docId]) : '',
        workflow_id: idx.workflowId >= 0 ? clean(fields[idx.workflowId]) : '',
        file_name: docFilename,
        size_kb: docSize ? Math.round(parseFloat(docSize) / 1024 * 100) / 100 : null,
        size_bytes: docSize ? parseInt(docSize, 10) : null,
        received: received,
        status: idx.status >= 0 ? clean(fields[idx.status]) : '',
        source_file: file
      });
    });
  }

  sortByReceivedDesc(records);
  console.log(`[TrendDataService] Loaded ${records.length} records from ${files.length} CSV files`);
  return records;
}

function sortByReceivedDesc(records) {
  records.sort((a, b) => {
    if (!a.received && !b.received) return 0;
    if (!a.received) return 1;
    if (!b.received) return -1;
    return new Date(b.received) - new Date(a.received);
  });
}

// Guards against overlapping DB queries: if a load is already running, callers
// await the SAME promise instead of firing another query at the DB.
let loadingPromise = null;

/**
 * Initialize the data cache from the configured source.
 * Called once at server startup, and on explicit reload. In DB mode, concurrent
 * calls share a single in-flight query (no overlapping queries against the DB).
 */
async function initData() {
  if (loadingPromise) return loadingPromise;  // a load is already in progress → reuse it

  loadingPromise = (async () => {
    const source = trendSource.source;
    if (source === 'db') {
      try {
        const { getProvider } = require('./trendProviderFactory');
        const settingsService = require('./settingsService');
        const conns = trendSource.enabledConnections();

        if (!conns.length) throw new Error('No database connections configured (set TREND_DB1_* in .env).');

        // -------- ALERTS: recent raw records (always queried at startup) --------
        // Needs per-file detail for missing-file detection, so it uses the
        // row-capped recent query. This is independent of the trend snapshot.
        const rawResults = await Promise.allSettled(
          conns.map(c => getProvider(c).loadFromConnection(c, settingsService.getEffectiveQuery(c.client, c.name)))
        );

        let merged = [];
        const okNames = [];
        rawResults.forEach((r, i) => {
          const name = conns[i].name;
          if (r.status === 'fulfilled') {
            merged = merged.concat(r.value);
            okNames.push(`${name}:${r.value.length}`);
            console.log(`[TrendDataService]   ${name} → ${r.value.length} records`);
          } else {
            console.error(`[TrendDataService]   ${name} → FAILED: ${r.reason && r.reason.message}`);
          }
        });

        if (merged.length === 0 && okNames.length === 0) {
          // Every connection failed → fall back to CSV rather than show nothing.
          throw new Error('All MSSQL connections failed.');
        }

        sortByReceivedDesc(merged);
        cachedRecords = merged;

        // -------- TRENDS: monthly snapshot (days 1–14), read DB only if stale --------
        await loadTrendSnapshot(conns, getProvider, settingsService, /*force*/ false);

        console.log(`[TrendDataService] Loaded ${merged.length} records (alerts) + ${cachedAggregates ? cachedAggregates.length : 0} snapshot rows (trends) from ${okNames.length}/${conns.length} connection(s) [${okNames.join(', ')}]`);
      } catch (err) {
        console.error('[TrendDataService] DB load failed:', err.message);
        console.error('[TrendDataService] Falling back to CSV source.');
        cachedRecords = loadRecordsFromCsv();
        cachedAggregates = buildAggregatesFromRecords(cachedRecords);
      }
    } else {
      cachedRecords = loadRecordsFromCsv();
      cachedAggregates = buildAggregatesFromRecords(cachedRecords);
    }
    return cachedRecords;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;  // clear so a future explicit reload can run
  }
}

/**
 * Load the Trends & Analysis daily aggregates from the MONTHLY snapshot.
 *
 * - If a current snapshot exists on disk (its window matches the target 1–14
 *   window for today), load it — NO database read. This is the common path on
 *   every `npm run dev` / restart.
 * - Otherwise (missing, stale month, or force=true) query the DB ONCE with the
 *   fixed 1–14 window and NO row cap, persist the result to disk, and cache it.
 *
 * On DB failure it keeps any existing snapshot rather than wiping trends.
 */
async function loadTrendSnapshot(conns, getProvider, settingsService, force) {
  const snapStore = require('./trendSnapshotStore');
  const now = new Date();
  const target = snapStore.computeWindow(now);

  if (!force) {
    const saved = snapStore.read();
    if (snapStore.isCurrent(saved, now)) {
      cachedAggregates = saved.rows;
      console.log(`[TrendDataService] Trends: using saved snapshot ${saved.window.label} (${saved.rows.length} rows) — no DB read.`);
      return;
    }
  }

  console.log(`[TrendDataService] Trends: building snapshot for ${target.label} (${target.from} → ${target.to}) …`);
  const aggResults = await Promise.allSettled(
    conns.map(c => getProvider(c).loadAggregatesFromConnection(c, settingsService.getAggregateQuery(c.client, { from: target.from, to: target.to }, c.name)))
  );

  let aggMerged = [];
  let anyOk = false;
  aggResults.forEach((r, i) => {
    const name = conns[i].name;
    if (r.status === 'fulfilled') {
      anyOk = true;
      aggMerged = aggMerged.concat(r.value.map(normalizeAggregateRow));
      console.log(`[TrendDataService]   ${name} snapshot → ${r.value.length} daily rows`);
    } else {
      console.error(`[TrendDataService]   ${name} snapshot → FAILED: ${r.reason && r.reason.message}`);
    }
  });

  if (!anyOk) {
    // Don't destroy an existing snapshot on total failure — keep serving the old one.
    const saved = snapStore.read();
    if (saved && Array.isArray(saved.rows)) {
      cachedAggregates = saved.rows;
      console.warn('[TrendDataService] Trends: snapshot rebuild failed; keeping previous snapshot.');
      return;
    }
    cachedAggregates = [];
    console.warn('[TrendDataService] Trends: snapshot rebuild failed and no previous snapshot exists.');
    return;
  }

  cachedAggregates = aggMerged;
  snapStore.write({ window: target, generatedAt: new Date().toISOString(), rows: aggMerged });
  console.log(`[TrendDataService] Trends: snapshot ${target.label} saved (${aggMerged.length} rows).`);
}

/**
 * Synchronous accessor used everywhere. Returns the cached records.
 * - CSV mode: if cache is empty, loads synchronously on demand (safe, fast).
 * - DB mode: relies on initData() having run at startup; if not ready, returns [].
 */
// ---- Daily aggregate helpers ----
const { field: aggField } = require('./trendRowMapper');

// Coerce a DB aggregate row (column names vary in case; values may be strings,
// Date objects, or decimals) into the normalized aggregate shape used by the
// trend/analysis functions.
function normalizeAggregateRow(row) {
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  // DAY may come back as a Date or a string; normalize to YYYY-MM-DD.
  let day = aggField(row, 'DAY');
  if (day instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    day = `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`;
  } else if (day != null) {
    day = String(day).slice(0, 10);
  }
  return {
    workflow_id: aggField(row, 'WORKFLOWID') != null ? String(aggField(row, 'WORKFLOWID')) : '',
    day: day || null,
    count: num(aggField(row, 'CNT')) || 0,
    cnt50: num(aggField(row, 'CNT_50')) || 0,
    cnt45: num(aggField(row, 'CNT_45')) || 0,
    cnt999: num(aggField(row, 'CNT_999')) || 0,
    minHour: num(aggField(row, 'MIN_HOUR')),
    maxHour: num(aggField(row, 'MAX_HOUR')),
    avgHour: num(aggField(row, 'AVG_HOUR')),
    avgSizeKb: num(aggField(row, 'AVG_SIZE_KB')),
    minSizeKb: num(aggField(row, 'MIN_SIZE_KB')),
    maxSizeKb: num(aggField(row, 'MAX_SIZE_KB')),
    source: row._source || 'db'
  };
}

// Build the SAME daily-aggregate shape from raw in-memory records (CSV mode, or
// DB fallback). Groups by (workflow, day) and derives the per-day stats locally.
function buildAggregatesFromRecords(records) {
  const groups = {};
  (records || []).forEach(r => {
    if (!r.received || !r.workflow_id) return;
    const parts = r.received.split(' ');
    const day = parts[0];
    const timePart = parts[1];
    const key = r.workflow_id + '\u0000' + day;
    let g = groups[key];
    if (!g) {
      g = groups[key] = {
        workflow_id: r.workflow_id, day, count: 0,
        cnt50: 0, cnt45: 0, cnt999: 0,
        hours: [], sizes: [], source: r.source_file || 'csv'
      };
    }
    g.count++;
    if (r.status === '50') g.cnt50++;
    else if (r.status === '45') g.cnt45++;
    else if (r.status === '999') g.cnt999++;
    if (timePart) {
      const [hh, mm] = timePart.split(':').map(Number);
      if (Number.isFinite(hh)) g.hours.push(hh + (mm || 0) / 60);
    }
    if (r.size_kb != null) g.sizes.push(r.size_kb);
  });

  return Object.values(groups).map(g => {
    const h = g.hours, s = g.sizes;
    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    return {
      workflow_id: g.workflow_id,
      day: g.day,
      count: g.count,
      cnt50: g.cnt50, cnt45: g.cnt45, cnt999: g.cnt999,
      minHour: h.length ? arrMin(h) : null,
      maxHour: h.length ? arrMax(h) : null,
      avgHour: avg(h),
      avgSizeKb: avg(s),
      minSizeKb: s.length ? arrMin(s) : null,
      maxSizeKb: s.length ? arrMax(s) : null,
      source: g.source
    };
  });
}

// Accessor for the daily aggregates (lazy-build in CSV mode if needed).
function loadAggregates() {
  if (cachedAggregates) return cachedAggregates;
  if (trendSource.source === 'db') {
    console.warn('[TrendDataService] Aggregates not initialized yet — call initData() at startup.');
    return [];
  }
  cachedAggregates = buildAggregatesFromRecords(loadAllRecords());
  return cachedAggregates;
}

function loadAllRecords() {
  if (cachedRecords) return cachedRecords;

  if (trendSource.source === 'db') {
    console.warn('[TrendDataService] DB data not initialized yet — call initData() at startup.');
    return [];
  }

  // CSV mode can load lazily and synchronously
  cachedRecords = loadRecordsFromCsv();
  return cachedRecords;
}

// ===================== FILES TAB =====================

/**
 * Get paginated and filtered records
 */
function getRecords(filters = {}) {
  let records = loadAllRecords();

  if (filters.workflow_id) {
    const q = filters.workflow_id.toLowerCase();
    records = records.filter(r => r.workflow_id.toLowerCase().includes(q));
  }
  if (filters.doc_id) {
    const q = filters.doc_id.toLowerCase();
    records = records.filter(r => (r.doc_id || '').toLowerCase().includes(q));
  }
  if (filters.status) {
    records = records.filter(r => r.status === filters.status);
  }
  if (filters.date_from) {
    const from = new Date(filters.date_from);
    records = records.filter(r => r.received && new Date(r.received) >= from);
  }
  if (filters.date_to) {
    const to = new Date(filters.date_to);
    to.setHours(23, 59, 59, 999);
    records = records.filter(r => r.received && new Date(r.received) <= to);
  }

  const page = parseInt(filters.page, 10) || 1;
  const limit = parseInt(filters.limit, 10) || 20;
  const total = records.length;
  const offset = (page - 1) * limit;
  const paginated = records.slice(offset, offset + limit);

  return { records: paginated, total, page, limit, pages: Math.ceil(total / limit) };
}

/**
 * Get distinct workflow IDs
 */
function getDistinctWorkflows() {
  const records = loadAllRecords();
  return [...new Set(records.map(r => r.workflow_id).filter(Boolean))].sort();
}

/**
 * Get distinct status codes
 */
function getDistinctStatuses() {
  const records = loadAllRecords();
  return [...new Set(records.map(r => r.status).filter(Boolean))].sort();
}

// ===================== OVERVIEW TAB =====================

/**
 * Get KPI overview stats from real CSV data
 */
function getOverviewStats() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();
  const statuses = getDistinctStatuses();

  // Count by status
  const statusCounts = {};
  statuses.forEach(s => { statusCounts[s] = 0; });
  records.forEach(r => {
    if (r.status) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  });

  // Count by workflow
  const workflowCounts = {};
  workflows.forEach(w => { workflowCounts[w] = 0; });
  records.forEach(r => {
    if (r.workflow_id) workflowCounts[r.workflow_id] = (workflowCounts[r.workflow_id] || 0) + 1;
  });

  // Today's records (or most recent date if today has none)
  const today = new Date().toISOString().split('T')[0];
  let todayRecords = records.filter(r => r.received && r.received.startsWith(today));
  
  // If no records today, use most recent date available
  let displayDate = today;
  if (todayRecords.length === 0 && records.length > 0) {
    const latestDate = records[0].received ? records[0].received.split(' ')[0] : today;
    displayDate = latestDate;
    todayRecords = records.filter(r => r.received && r.received.startsWith(latestDate));
  }

  // Status 50 = completed/archived (success), others = potentially problematic
  const completed = statusCounts['50'] || 0;
  const inProgress = statusCounts['45'] || 0;
  const errors = statusCounts['999'] || 0;
  const completionRate = records.length > 0 ? Math.round((completed / records.length) * 100) : 0;

  return {
    totalWorkflows: workflows.length,
    totalRecords: records.length,
    completionRate,
    completed,
    inProgress,
    errors,
    statusCounts,
    workflowCounts,
    displayDate,
    todayRecords: todayRecords.slice(0, 50) // limit for display
  };
}

// ===================== TRENDS TAB =====================

/**
 * Get arrival timing trend — what time of day files are received, grouped by date
 * Returns per-day: earliest, latest, average arrival time (as decimal hours)
 */
function getTrendData(workflowId, days = 30) {
  let aggs = loadAggregates();
  if (workflowId) aggs = aggs.filter(a => a.workflow_id === workflowId);

  // Combine multiple workflows (or connections) that fall on the same day:
  // count sums; earliest = min of min-hours; latest = max of max-hours;
  // avg = count-weighted average of per-group avg hours.
  const byDay = {};
  aggs.forEach(a => {
    if (!a.day) return;
    let d = byDay[a.day];
    if (!d) d = byDay[a.day] = { date: a.day, count: 0, min: null, max: null, avgWeighted: 0 };
    d.count += a.count;
    if (a.minHour != null) d.min = d.min == null ? a.minHour : Math.min(d.min, a.minHour);
    if (a.maxHour != null) d.max = d.max == null ? a.maxHour : Math.max(d.max, a.maxHour);
    if (a.avgHour != null) d.avgWeighted += a.avgHour * a.count;
  });

  const sorted = Object.values(byDay)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days);

  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  return {
    workflow_id: workflowId || 'ALL',
    days: sorted.length,
    data: sorted.map(d => ({
      date: d.date,
      earliest: r2(d.min),
      latest: r2(d.max),
      avg: d.count > 0 ? r2(d.avgWeighted / d.count) : null,
      count: d.count
    }))
  };
}

/**
 * Get individual file arrival times (for scatter plot)
 * Each point: { date, time (decimal hours), file_name }
 */
function getArrivalTimes(workflowId, days = 30) {
  // Individual scatter points are derived from raw documents, which we no longer
  // pull in full for trends. The frontend does not render this series, so we
  // return an empty array (kept for API back-compat).
  return [];
}

/**
 * Get file size distribution per day (from daily aggregates).
 * Returns one point per day carrying that day's avg and max size (KB). `date`
 * is kept as a full "YYYY-MM-DD 00:00:00" string so the existing frontend, which
 * splits on space, still groups correctly.
 */
function getSizeTrend(workflowId, days = 30) {
  let aggs = loadAggregates();
  if (workflowId) aggs = aggs.filter(a => a.workflow_id === workflowId);

  // Merge same-day rows across workflows/connections.
  const byDay = {};
  aggs.forEach(a => {
    if (!a.day || a.avgSizeKb == null) return;
    let d = byDay[a.day];
    if (!d) d = byDay[a.day] = { day: a.day, sumWeighted: 0, count: 0, max: null };
    d.sumWeighted += a.avgSizeKb * a.count;
    d.count += a.count;
    if (a.maxSizeKb != null) d.max = d.max == null ? a.maxSizeKb : Math.max(d.max, a.maxSizeKb);
  });

  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  return Object.values(byDay)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-days)
    .map(d => ({
      date: `${d.day} 00:00:00`,
      size_kb: d.count > 0 ? r2(d.sumWeighted / d.count) : null,
      max_size_kb: r2(d.max)
    }));
}

// ===================== WORKFLOW ANALYSIS (AI Insights) =====================

/**
 * Generate per-workflow file trend analysis
 * Returns detailed stats for each workflow: timing, volume, size, patterns
 */
function getWorkflowAnalysis() {
  const aggs = loadAggregates();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Group aggregate rows by workflow.
  const byWf = {};
  aggs.forEach(a => {
    if (!a.workflow_id) return;
    (byWf[a.workflow_id] = byWf[a.workflow_id] || []).push(a);
  });

  const workflows = Object.keys(byWf).sort();

  return workflows.map(wf => {
    // One row per day already; merge same-day rows (multiple connections) first.
    const perDay = {};
    const byDayOfWeek = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    byWf[wf].forEach(a => {
      if (!a.day) return;
      let d = perDay[a.day];
      if (!d) {
        d = perDay[a.day] = {
          count: 0, cnt50: 0, cnt45: 0, cnt999: 0,
          minHour: null, maxHour: null, avgHourWeighted: 0,
          sizeAvgWeighted: 0, sizeCount: 0, minSize: null, maxSize: null
        };
      }
      d.count += a.count;
      d.cnt50 += a.cnt50; d.cnt45 += a.cnt45; d.cnt999 += a.cnt999;
      if (a.minHour != null) d.minHour = d.minHour == null ? a.minHour : Math.min(d.minHour, a.minHour);
      if (a.maxHour != null) d.maxHour = d.maxHour == null ? a.maxHour : Math.max(d.maxHour, a.maxHour);
      if (a.avgHour != null) d.avgHourWeighted += a.avgHour * a.count;
      if (a.avgSizeKb != null) { d.sizeAvgWeighted += a.avgSizeKb * a.count; d.sizeCount += a.count; }
      if (a.minSizeKb != null) d.minSize = d.minSize == null ? a.minSizeKb : Math.min(d.minSize, a.minSizeKb);
      if (a.maxSizeKb != null) d.maxSize = d.maxSize == null ? a.maxSizeKb : Math.max(d.maxSize, a.maxSizeKb);
    });

    const dates = Object.keys(perDay).sort();
    const dailyCounts = dates.map(d => perDay[d].count);
    const totalCount = dailyCounts.reduce((s, v) => s + v, 0);

    // Day-of-week counts
    dates.forEach(d => {
      const dow = new Date(d).getDay();
      if (!isNaN(dow)) byDayOfWeek[dow] += perDay[d].count;
    });

    // 1) Avg first arrival = average of each day's earliest (min) hour
    const firstArrivals = dates.map(d => perDay[d].minHour).filter(v => v != null);
    const avgFirstArrival = firstArrivals.length
      ? firstArrivals.reduce((s, v) => s + v, 0) / firstArrivals.length
      : null;

    // 2) Avg files/day
    const avgDailyCount = dailyCounts.length
      ? Math.round(totalCount / dailyCounts.length)
      : 0;

    // 3) Avg file size (count-weighted across days)
    let sizeWeighted = 0, sizeCount = 0;
    dates.forEach(d => { sizeWeighted += perDay[d].sizeAvgWeighted; sizeCount += perDay[d].sizeCount; });
    const avgSize = sizeCount ? Math.round((sizeWeighted / sizeCount) * 100) / 100 : 0;

    // 4) Peak / quiet DATE by daily count
    let peakDate = null, peakCount = 0, quietDate = null, quietCount = Infinity;
    dates.forEach(d => {
      const c = perDay[d].count;
      if (c > peakCount) { peakCount = c; peakDate = d; }
      if (c < quietCount) { quietCount = c; quietDate = d; }
    });
    if (quietCount === Infinity) quietCount = 0;

    // 5) Peak-hours window — approximated from the earliest & latest daily hours
    //    (exact p10/p90 needs per-file data, which we intentionally don't pull).
    const minHours = dates.map(d => perDay[d].minHour).filter(v => v != null);
    const maxHours = dates.map(d => perDay[d].maxHour).filter(v => v != null);
    const peakHourStart = minHours.length ? arrMin(minHours) : null;
    const peakHourEnd = maxHours.length ? arrMax(maxHours) : null;

    // 6) Size range (min/max across days)
    const minSizes = dates.map(d => perDay[d].minSize).filter(v => v != null);
    const maxSizes = dates.map(d => perDay[d].maxSize).filter(v => v != null);
    const minSize = minSizes.length ? arrMin(minSizes) : 0;
    const maxSize = maxSizes.length ? arrMax(maxSizes) : 0;

    // 7) Status distribution (from per-status counts). Only known codes tracked.
    const cnt50 = dates.reduce((s, d) => s + perDay[d].cnt50, 0);
    const cnt45 = dates.reduce((s, d) => s + perDay[d].cnt45, 0);
    const cnt999 = dates.reduce((s, d) => s + perDay[d].cnt999, 0);
    const other = totalCount - cnt50 - cnt45 - cnt999;
    const statusDistribution = [];
    const pushStatus = (status, count) => {
      if (count > 0) statusDistribution.push({ status, count, percentage: totalCount > 0 ? Math.round((count / totalCount) * 10000) / 100 : 0 });
    };
    pushStatus('50', cnt50);
    pushStatus('45', cnt45);
    pushStatus('999', cnt999);
    pushStatus('other', other);

    // 8) Busiest / quietest day of week
    const busiestDayIdx = Object.entries(byDayOfWeek).sort(([, a], [, b]) => b - a)[0];
    const quietestDayIdx = Object.entries(byDayOfWeek).filter(([, c]) => c > 0).sort(([, a], [, b]) => a - b)[0];

    // 9) Error rate (status 999)
    const errors = cnt999;
    const errorRate = totalCount > 0 ? Math.round((errors / totalCount) * 10000) / 100 : 0;

    return {
      workflow_id: wf,
      totalRecords: totalCount,
      totalDays: dates.length,
      dateRange: { from: dates[0] || null, to: dates[dates.length - 1] || null },

      avgFirstArrival: avgFirstArrival != null ? Math.round(avgFirstArrival * 100) / 100 : null,
      avgDailyCount,
      avgSizeKb: avgSize,
      peakDate: { date: peakDate, count: peakCount },
      quietDate: { date: quietDate, count: quietCount },

      peakHours: { start: peakHourStart, end: peakHourEnd },
      sizeRange: { min: Math.round(minSize * 100) / 100, max: Math.round(maxSize * 100) / 100 },
      statusDistribution,
      busiestDayOfWeek: busiestDayIdx ? { day: dayNames[parseInt(busiestDayIdx[0])], count: busiestDayIdx[1] } : null,
      quietestDayOfWeek: quietestDayIdx ? { day: dayNames[parseInt(quietestDayIdx[0])], count: quietestDayIdx[1] } : null,
      errorRate,
      errors
    };
  });
}

// ===================== ALERTS TAB =====================

/**
 * Generate alerts from real data — flag errors (status 999) and unusually large files
 */
function getAlerts(filters = {}) {
  const records = loadAllRecords();
  const alerts = [];

  // Alert 1: All records with status 999 (error)
  const errorRecords = records.filter(r => r.status === '999');
  errorRecords.forEach((r, i) => {
    alerts.push({
      id: i + 1,
      severity: 'critical',
      type: 'error_status',
      title: `Error status on ${r.file_name}`,
      message: `Document "${r.file_name}" in workflow ${r.workflow_id} has error status (999).`,
      workflow_id: r.workflow_id,
      source: r.workflow_id,
      received: r.received,
      acknowledged: false,
      created_at: r.received
    });
  });

  // Alert 2: Unusually large files (> 100KB) — informational
  const largeFiles = records.filter(r => r.size_kb && r.size_kb > 100);
  largeFiles.slice(0, 20).forEach((r, i) => {
    alerts.push({
      id: errorRecords.length + i + 1,
      severity: 'info',
      type: 'large_file',
      title: `Large file: ${r.file_name}`,
      message: `File size ${r.size_kb} KB exceeds 100KB threshold in workflow ${r.workflow_id}.`,
      workflow_id: r.workflow_id,
      source: r.workflow_id,
      received: r.received,
      acknowledged: false,
      created_at: r.received
    });
  });

  // Alert 3: Status 45 (in-progress/not completed) — warning
  const inProgressRecords = records.filter(r => r.status === '45');
  if (inProgressRecords.length > 0) {
    // Group by workflow
    const byWorkflow = {};
    inProgressRecords.forEach(r => {
      byWorkflow[r.workflow_id] = (byWorkflow[r.workflow_id] || 0) + 1;
    });

    Object.entries(byWorkflow).forEach(([wf, count], i) => {
      alerts.push({
        id: errorRecords.length + 20 + i + 1,
        severity: 'warning',
        type: 'incomplete_status',
        title: `${count} documents pending in ${wf}`,
        message: `${count} document(s) in workflow "${wf}" have status 45 (not yet completed).`,
        workflow_id: wf,
        source: wf,
        received: inProgressRecords.find(r => r.workflow_id === wf)?.received,
        acknowledged: false,
        created_at: inProgressRecords.find(r => r.workflow_id === wf)?.received
      });
    });
  }

  // Alert 4: Overdue — no file received for longer than the workflow's average gap
  // "Now" = the most recent timestamp across all data (this is historical CSV data).
  const dated = records.filter(r => r.received).map(r => new Date(r.received).getTime());
  if (dated.length > 0) {
    const nowRef = arrMax(dated);
    let overdueId = errorRecords.length + 200;

    getDistinctWorkflows().forEach(wf => {
      // This workflow's file times, oldest -> newest
      const times = records
        .filter(r => r.workflow_id === wf && r.received)
        .map(r => new Date(r.received).getTime())
        .sort((a, b) => a - b);

      if (times.length < 3) return; // need enough history to have a meaningful average

      // Average gap between consecutive files (ms)
      let gapSum = 0;
      for (let i = 1; i < times.length; i++) gapSum += times[i] - times[i - 1];
      const avgGap = gapSum / (times.length - 1);
      if (avgGap <= 0) return;

      const lastTime = times[times.length - 1];
      const sinceLast = nowRef - lastTime;

      // Overdue if the current silence is well beyond the normal gap (1.5x buffer to avoid noise)
      if (sinceLast > avgGap * 1.5) {
        const avgHrs = avgGap / 3600000;
        const sinceHrs = sinceLast / 3600000;
        const fmt = (h) => h >= 24 ? `${(h / 24).toFixed(1)} day(s)` : `${h.toFixed(1)} hr(s)`;
        // Escalate to critical when it's very overdue (3x the normal gap)
        const severity = sinceLast > avgGap * 3 ? 'critical' : 'warning';

        alerts.push({
          id: overdueId++,
          severity,
          type: 'overdue',
          title: `No new files in ${fmt(sinceHrs)} — ${wf}`,
          message: `Workflow "${wf}" usually receives a file about every ${fmt(avgHrs)}, but none has arrived for ${fmt(sinceHrs)} (last: ${new Date(lastTime).toISOString().replace('T', ' ').slice(0, 19)}).`,
          workflow_id: wf,
          source: wf,
          received: new Date(lastTime).toISOString().replace('T', ' ').slice(0, 19),
          acknowledged: false,
          created_at: new Date(lastTime).toISOString().replace('T', ' ').slice(0, 19)
        });
      }
    });
  }

  // Apply filters
  let filtered = alerts;
  if (filters.severity) {
    filtered = filtered.filter(a => a.severity === filters.severity);
  }
  if (filters.workflow_id) {
    filtered = filtered.filter(a => a.workflow_id && a.workflow_id.toLowerCase().includes(filters.workflow_id.toLowerCase()));
  }

  // Sort by severity priority then date
  const sevOrder = { critical: 0, warning: 1, info: 2 };
  filtered.sort((a, b) => (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3));

  return filtered;
}

/**
 * Get alert statistics
 */
function getAlertStats() {
  const alerts = getAlerts();
  const critical = alerts.filter(a => a.severity === 'critical').length;
  const warning = alerts.filter(a => a.severity === 'warning').length;
  const info = alerts.filter(a => a.severity === 'info').length;

  // Most problematic workflow
  const counts = {};
  alerts.forEach(a => {
    if (a.workflow_id) counts[a.workflow_id] = (counts[a.workflow_id] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);

  return {
    total: alerts.length,
    critical,
    warning,
    info,
    mostProblematic: sorted[0] ? sorted[0][0] : null,
    mostProblematicCount: sorted[0] ? sorted[0][1] : 0
  };
}

// ===================== INSIGHTS TAB =====================

/**
 * Get reliability scores per workflow based on completion rate (status 50)
 */
function getReliabilityScores() {
  const aggs = loadAggregates();
  const byWf = {};
  aggs.forEach(a => {
    if (!a.workflow_id) return;
    let g = byWf[a.workflow_id];
    if (!g) g = byWf[a.workflow_id] = { total: 0, completed: 0, errors: 0 };
    g.total += a.count;
    g.completed += a.cnt50;
    g.errors += a.cnt999;
  });

  return Object.keys(byWf).sort().map(wf => {
    const g = byWf[wf];
    const score = g.total > 0 ? Math.round((g.completed / g.total) * 100) / 100 : 0;
    return {
      workflow_id: wf,
      workflow_name: wf,
      reliability_score: score,
      total_records: g.total,
      completed: g.completed,
      errors: g.errors
    };
  });
}

/**
 * Generate AI weekly summary from real data
 */
function generateSummary() {
  const aggs = loadAggregates();
  const reliability = getReliabilityScores();
  const alertStats = getAlertStats();

  let totalRecords = 0, completed = 0, errors = 0, inProgress = 0;
  const wfCounts = {};
  const daysSet = new Set();
  aggs.forEach(a => {
    totalRecords += a.count;
    completed += a.cnt50;
    errors += a.cnt999;
    inProgress += a.cnt45;
    if (a.workflow_id) wfCounts[a.workflow_id] = (wfCounts[a.workflow_id] || 0) + a.count;
    if (a.day) daysSet.add(a.day);
  });
  const workflows = Object.keys(wfCounts);
  const completionRate = totalRecords > 0 ? Math.round((completed / totalRecords) * 100) : 0;

  // Date range (from the aggregated day buckets)
  const sortedDays = [...daysSet].sort();
  const minDate = sortedDays.length ? sortedDays[0] : 'N/A';
  const maxDate = sortedDays.length ? sortedDays[sortedDays.length - 1] : 'N/A';

  // Most active workflow
  const mostActive = Object.entries(wfCounts).sort(([, a], [, b]) => b - a)[0];

  // Lowest reliability
  const lowestReliability = reliability.filter(r => r.total_records > 10)
    .sort((a, b) => a.reliability_score - b.reliability_score)[0];

  let summary = `eHub Document Pipeline Summary\n`;
  summary += `Period: ${minDate} to ${maxDate}\n\n`;
  summary += `Total Documents Processed: ${totalRecords.toLocaleString()}\n`;
  summary += `Workflows Monitored: ${workflows.length}\n`;
  summary += `Overall Completion Rate: ${completionRate}%\n\n`;
  summary += `Status Breakdown:\n`;
  summary += `  • Completed (50): ${completed.toLocaleString()} documents\n`;
  summary += `  • In Progress (45): ${inProgress.toLocaleString()} documents\n`;
  summary += `  • Errors (999): ${errors.toLocaleString()} documents\n\n`;

  if (mostActive) {
    summary += `Most Active Workflow: ${mostActive[0]} (${mostActive[1].toLocaleString()} docs)\n`;
  }
  if (lowestReliability) {
    summary += `Lowest Reliability: ${lowestReliability.workflow_name} (${Math.round(lowestReliability.reliability_score * 100)}%, ${lowestReliability.errors} errors)\n`;
  }
  if (alertStats.critical > 0) {
    summary += `\n⚠️ ${alertStats.critical} critical alert(s) require attention.\n`;
  }

  return {
    summary,
    metrics: {
      totalRecords,
      completionRate,
      completed,
      inProgress,
      errors,
      totalWorkflows: workflows.length,
      dateRange: { from: minDate, to: maxDate }
    }
  };
}

/**
 * Generate predictions based on data patterns
 */
function generatePredictions() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();
  const predictions = [];

  for (const wf of workflows) {
    const wfRecords = records.filter(r => r.workflow_id === wf);
    const errors = wfRecords.filter(r => r.status === '999').length;
    const total = wfRecords.length;
    const errorRate = total > 0 ? errors / total : 0;

    // Predict if error rate is concerning
    if (errorRate > 0.05 && errors > 5) {
      predictions.push({
        workflow_id: wf,
        workflow_name: wf,
        prediction: `Error rate at ${Math.round(errorRate * 100)}% (${errors} errors out of ${total} documents). Investigate root cause.`,
        severity: errorRate > 0.1 ? 'critical' : 'warning',
        confidence: Math.min(0.95, 0.5 + errorRate * 2)
      });
    }

    // Predict volume trends — check if recent days have fewer docs
    const dates = [...new Set(wfRecords.filter(r => r.received).map(r => r.received.split(' ')[0]))].sort();
    if (dates.length >= 2) {
      const recentDate = dates[dates.length - 1];
      const olderDate = dates[0];
      const recentCount = wfRecords.filter(r => r.received && r.received.startsWith(recentDate)).length;
      const olderCount = wfRecords.filter(r => r.received && r.received.startsWith(olderDate)).length;

      if (olderCount > recentCount * 2 && olderCount > 20) {
        predictions.push({
          workflow_id: wf,
          workflow_name: wf,
          prediction: `Volume drop detected: ${olderCount} docs on ${olderDate} vs ${recentCount} on ${recentDate}. May indicate upstream issues.`,
          severity: 'warning',
          confidence: 0.6
        });
      }
    }
  }

  return predictions;
}

/**
 * Get anomalies — records with status 999 or unusually large sizes
 */
function getAnomalies() {
  const records = loadAllRecords();
  const anomalies = [];

  // Error status anomalies
  records.filter(r => r.status === '999').forEach(r => {
    anomalies.push({
      workflow_id: r.workflow_id,
      workflow_name: r.workflow_id,
      type: 'error_status',
      severity: 'critical',
      date: r.received,
      file_name: r.file_name,
      detail: `Status 999 error`
    });
  });

  // Size anomalies — calculate per-workflow stats
  const workflows = getDistinctWorkflows();
  for (const wf of workflows) {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.size_kb);
    if (wfRecords.length < 5) continue;

    const sizes = wfRecords.map(r => r.size_kb);
    const mean = sizes.reduce((s, v) => s + v, 0) / sizes.length;
    const stdDev = Math.sqrt(sizes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (sizes.length - 1));

    if (stdDev === 0) continue;

    wfRecords.forEach(r => {
      const zScore = (r.size_kb - mean) / stdDev;
      if (Math.abs(zScore) > 2.5) {
        anomalies.push({
          workflow_id: r.workflow_id,
          workflow_name: r.workflow_id,
          type: 'size_anomaly',
          severity: Math.abs(zScore) > 3 ? 'critical' : 'warning',
          date: r.received,
          file_name: r.file_name,
          zScore: Math.round(zScore * 100) / 100,
          detail: `Size ${r.size_kb} KB (z-score: ${Math.round(zScore * 100) / 100})`
        });
      }
    });
  }

  // Sort by severity then date
  const sevOrder = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3));

  return anomalies.slice(0, 100); // cap at 100
}

// ===================== CACHE =====================

function invalidateCache() {
  cachedRecords = null;
}

/**
 * Reload data from the configured source (clears cache then re-inits).
 * Use this to refresh without restarting the server.
 */
async function reloadData() {
  // Refresh alerts (recent records). Trends load from the monthly snapshot;
  // a normal reload does NOT force a snapshot rebuild — the snapshot only
  // changes on the 15th (month rollover) or via refreshTrendSnapshot().
  cachedRecords = null;
  return initData();
}

/**
 * Force-rebuild the Trends & Analysis monthly snapshot from the database now,
 * regardless of whether the saved one is still current. Persists the result.
 * Used by an Admin "Rebuild trend snapshot" action.
 */
async function refreshTrendSnapshot() {
  if (trendSource.source !== 'db') {
    // CSV mode derives aggregates in-memory from records.
    cachedAggregates = buildAggregatesFromRecords(loadAllRecords());
    return { rows: cachedAggregates.length, mode: 'csv' };
  }
  const { getProvider } = require('./trendProviderFactory');
  const settingsService = require('./settingsService');
  const conns = trendSource.enabledConnections();
  if (!conns.length) throw new Error('No database connections configured.');
  await loadTrendSnapshot(conns, getProvider, settingsService, /*force*/ true);
  return { rows: cachedAggregates ? cachedAggregates.length : 0, mode: 'db' };
}

// ===================== SLA COMPLIANCE =====================

/**
 * SLA Compliance — checks if files arrive within expected time windows per workflow
 * Uses peak hours (10th-90th percentile) as the "expected window"
 */
function getSlaCompliance() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return workflows.map(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.received);

    // Determine SLA window from historical 10th-90th percentile
    const arrivalHours = [];
    wfRecords.forEach(r => {
      const parts = r.received.split(' ');
      const timePart = parts[1];
      if (!timePart) return;
      const [hh, mm] = timePart.split(':').map(Number);
      arrivalHours.push(hh + mm / 60);
    });

    if (arrivalHours.length < 10) {
      return { workflow_id: wf, totalDays: 0, slaWindow: null, compliance: 0, missedDays: [] };
    }

    const sorted = [...arrivalHours].sort((a, b) => a - b);
    const slaStart = sorted[Math.floor(sorted.length * 0.1)];
    const slaEnd = sorted[Math.floor(sorted.length * 0.9)];

    // Group by date, check if any file arrived outside SLA window
    const byDate = {};
    wfRecords.forEach(r => {
      const parts = r.received.split(' ');
      const date = parts[0];
      const timePart = parts[1];
      if (!timePart) return;
      const [hh, mm] = timePart.split(':').map(Number);
      const hour = hh + mm / 60;

      if (!byDate[date]) byDate[date] = { withinSla: 0, outsideSla: 0, total: 0 };
      byDate[date].total++;
      if (hour >= slaStart && hour <= slaEnd) {
        byDate[date].withinSla++;
      } else {
        byDate[date].outsideSla++;
      }
    });

    const dates = Object.keys(byDate).sort();
    const totalDays = dates.length;
    const compliantDays = dates.filter(d => byDate[d].outsideSla === 0).length;
    const compliance = totalDays > 0 ? Math.round((compliantDays / totalDays) * 100) : 0;

    // Missed SLA days (most recent first)
    const missedDays = dates
      .filter(d => byDate[d].outsideSla > 0)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 10)
      .map(d => ({
        date: d,
        outsideSla: byDate[d].outsideSla,
        total: byDate[d].total
      }));

    return {
      workflow_id: wf,
      totalDays,
      slaWindow: { start: Math.round(slaStart * 100) / 100, end: Math.round(slaEnd * 100) / 100 },
      compliance,
      compliantDays,
      missedDays
    };
  });
}

// ===================== WEEK-OVER-WEEK COMPARISON =====================

/**
 * Compare current week vs previous week for each workflow
 */
function getWeekOverWeek() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();

  // Determine the latest date in data
  const allDates = records.filter(r => r.received).map(r => r.received.split(' ')[0]).sort();
  if (allDates.length === 0) return [];

  const latestDate = new Date(allDates[allDates.length - 1]);
  const currentWeekStart = new Date(latestDate);
  currentWeekStart.setDate(latestDate.getDate() - 6); // last 7 days
  const prevWeekStart = new Date(currentWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const cwStart = currentWeekStart.toISOString().split('T')[0];
  const cwEnd = latestDate.toISOString().split('T')[0];
  const pwStart = prevWeekStart.toISOString().split('T')[0];
  const pwEnd = new Date(currentWeekStart.getTime() - 86400000).toISOString().split('T')[0];

  return workflows.map(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.received);

    const currentWeek = wfRecords.filter(r => {
      const d = r.received.split(' ')[0];
      return d >= cwStart && d <= cwEnd;
    });
    const prevWeek = wfRecords.filter(r => {
      const d = r.received.split(' ')[0];
      return d >= pwStart && d <= pwEnd;
    });

    const cwCount = currentWeek.length;
    const pwCount = prevWeek.length;
    const volumeChange = pwCount > 0 ? Math.round(((cwCount - pwCount) / pwCount) * 100) : 0;

    // Average arrival time comparison
    const getAvgHour = (recs) => {
      const hours = [];
      recs.forEach(r => {
        const timePart = r.received.split(' ')[1];
        if (!timePart) return;
        const [hh, mm] = timePart.split(':').map(Number);
        hours.push(hh + mm / 60);
      });
      return hours.length > 0 ? hours.reduce((s, v) => s + v, 0) / hours.length : null;
    };

    const cwAvgHour = getAvgHour(currentWeek);
    const pwAvgHour = getAvgHour(prevWeek);
    const timingShift = (cwAvgHour != null && pwAvgHour != null)
      ? Math.round((cwAvgHour - pwAvgHour) * 60) // in minutes
      : null;

    // Error comparison
    const cwErrors = currentWeek.filter(r => r.status === '999').length;
    const pwErrors = prevWeek.filter(r => r.status === '999').length;

    // Avg size comparison
    const getAvgSize = (recs) => {
      const sizes = recs.filter(r => r.size_kb).map(r => r.size_kb);
      return sizes.length > 0 ? Math.round(sizes.reduce((s, v) => s + v, 0) / sizes.length * 100) / 100 : 0;
    };

    return {
      workflow_id: wf,
      period: { current: `${cwStart} to ${cwEnd}`, previous: `${pwStart} to ${pwEnd}` },
      volume: { current: cwCount, previous: pwCount, change: volumeChange },
      timing: { current: cwAvgHour, previous: pwAvgHour, shiftMinutes: timingShift },
      errors: { current: cwErrors, previous: pwErrors },
      avgSize: { current: getAvgSize(currentWeek), previous: getAvgSize(prevWeek) }
    };
  });
}

// ===================== WORKFLOW HEALTH HEATMAP =====================

/**
 * Heatmap data — workflows × days, colored by health
 * Health: green (normal), yellow (low volume/late), red (errors/no files)
 */
function getHealthHeatmap(days = 14) {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();

  // Determine date range
  const allDates = records.filter(r => r.received).map(r => r.received.split(' ')[0]);
  if (allDates.length === 0) return { workflows: [], dates: [], data: [] };

  const sortedDates = [...new Set(allDates)].sort();
  const recentDates = sortedDates.slice(-days);

  // Calculate avg daily count per workflow (for baseline)
  const avgCounts = {};
  workflows.forEach(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.received);
    const byDate = {};
    wfRecords.forEach(r => {
      const d = r.received.split(' ')[0];
      byDate[d] = (byDate[d] || 0) + 1;
    });
    const counts = Object.values(byDate);
    avgCounts[wf] = counts.length > 0 ? counts.reduce((s, v) => s + v, 0) / counts.length : 0;
  });

  // Build heatmap grid
  const data = workflows.map(wf => {
    return recentDates.map(date => {
      const dayRecords = records.filter(r => r.workflow_id === wf && r.received && r.received.startsWith(date));
      const count = dayRecords.length;
      const errors = dayRecords.filter(r => r.status === '999').length;
      const avg = avgCounts[wf];

      // Determine health: 0=no data, 1=red (errors/very low), 2=yellow (below avg), 3=green (normal)
      let health = 3;
      if (count === 0) health = 0;
      else if (errors > 0) health = 1;
      else if (count < avg * 0.3) health = 2;

      return { date, count, errors, health };
    });
  });

  return {
    workflows,
    dates: recentDates,
    data // data[workflowIndex][dateIndex]
  };
}

// ===================== TRADING PARTNER ACTIVITY =====================

/**
 * Trading partner activity summary — grouped by sender/receiver pairs
 * Extracts from workflow_id which contains the partner info
 */
function getTradingPartnerActivity() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();

  return workflows.map(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.received);

    // Extract sender/receiver from workflow_id pattern: ORDERS_SENDER_RECEIVER_OWNER
    const parts = wf.replace(/^ORDERS_/, '').replace(/_PDF_/, '_').split('_');
    let sender = '—', receiver = '—';
    if (parts.length >= 4) {
      sender = parts[0] + '_' + parts[1]; // e.g. ACME_RETAIL
      receiver = parts[2] + '_' + parts[3]; // e.g. ZENITH_SUPPLY
    } else if (parts.length >= 2) {
      sender = parts[0];
      receiver = parts[1];
    }

    // Last active date
    const dates = wfRecords.map(r => r.received.split(' ')[0]).sort();
    const lastActive = dates.length > 0 ? dates[dates.length - 1] : null;
    const firstSeen = dates.length > 0 ? dates[0] : null;

    // Total docs
    const totalDocs = wfRecords.length;

    // Check for gaps — days with zero activity (within the active date range)
    const uniqueDates = [...new Set(dates)];
    let gaps = [];
    if (uniqueDates.length >= 2) {
      const start = new Date(uniqueDates[0]);
      const end = new Date(uniqueDates[uniqueDates.length - 1]);
      const dateSet = new Set(uniqueDates);

      const current = new Date(start);
      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        const dayOfWeek = current.getDay();
        // Only flag weekday gaps (Mon-Fri) — weekends might be expected to have no data
        if (!dateSet.has(dateStr) && dayOfWeek !== 0 && dayOfWeek !== 6) {
          gaps.push(dateStr);
        }
        current.setDate(current.getDate() + 1);
      }
    }

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysStr = sevenDaysAgo.toISOString().split('T')[0];
    const recentDocs = wfRecords.filter(r => r.received.split(' ')[0] >= sevenDaysStr).length;

    // Days since last activity
    let daysSinceActive = null;
    if (lastActive) {
      const last = new Date(lastActive);
      const now = new Date();
      daysSinceActive = Math.floor((now - last) / 86400000);
    }

    return {
      workflow_id: wf,
      sender,
      receiver,
      totalDocs,
      firstSeen,
      lastActive,
      daysSinceActive,
      recentDocs,
      totalActiveDays: uniqueDates.length,
      gaps: gaps.length,
      recentGaps: gaps.slice(-5) // last 5 gap dates
    };
  });
}

module.exports = {
  // Files
  getRecords,
  getDistinctWorkflows,
  getDistinctStatuses,
  // Overview
  getOverviewStats,
  // Trends
  getTrendData,
  getArrivalTimes,
  getSizeTrend,
  loadAggregates,
  // Workflow Analysis
  getWorkflowAnalysis,
  // Insights - new
  getSlaCompliance,
  getWeekOverWeek,
  getHealthHeatmap,
  getTradingPartnerActivity,
  // Alerts
  getAlerts,
  getAlertStats,
  // Insights - existing
  getReliabilityScores,
  generateSummary,
  generatePredictions,
  getAnomalies,
  // Utils
  invalidateCache,
  reloadData,
  refreshTrendSnapshot,
  initData,
  loadAllRecords
};
