// Settings Service
// Reads/writes editable app configuration to config/settings.json so the Admin
// can change things (priority buyers, re-alert window, email template) at runtime
// without code changes. Falls back to sensible defaults if the file is missing.

const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'config', 'settings.json');

// The document types that can be monitored. The query filters on DOCTYPEID.
const KNOWN_DOCUMENT_TYPES = ['ORDERS', 'INVOIC', 'DEBADV', 'CREADV', 'ARINV'];

const DEFAULTS = {
  priorityBuyers: ['AEON', 'MYDIN', 'ALFAMART', 'ALFAMIDI'],
  // Optional friendly display names per buyer keyword (display only; matching uses the keyword).
  buyerLabels: {},
  // Exact, full WORKFLOWID values to monitor in ADDITION to the buyer keywords.
  // Matched with `=` (not substring), and monitored REGARDLESS of document type.
  // Each entry may optionally PIN the workflow to a specific database so the
  // query only runs on that connection (less scanning / faster). Format:
  //     "dbName | WORKFLOWID"   → only query WORKFLOWID on dbName
  //     "WORKFLOWID"            → query WORKFLOWID on ALL connections (default)
  // Parsed by parseMonitoredWorkflows().
  monitoredWorkflows: [],
  // Document types to include (filters WHERE DOCTYPEID IN (...)). Empty array = all types (no filter).
  documentTypes: ['ORDERS', 'INVOIC', 'DEBADV', 'CREADV', 'ARINV'],
  reAlertMinutes: 30,
  // Data source — the query the app runs and a safety row cap. Editable in Admin.
  // The effective query auto-applies the row cap and a WHERE filter restricting to
  // the configured priority buyers + document types.
  // NOTE: the table is connection-relative (`dbo.DOCUMENT`, no database prefix) so
  // the SAME query works against every connection — each opens its own database
  // (integration_ehub, general_ehub, aeon_ehub, …). For MySQL the `dbo.` is stripped
  // automatically by getEffectiveQuery().
  dataSource: {
    query: 'SELECT DOCID, WORKFLOWID, DOCFILENAME, DOCSIZE, CREATIONDATE, STATUS, METADATA, RECEIVEDATE FROM dbo.DOCUMENT',
    // History window for the TREND snapshot (days 1–N of the month). 0 = all.
    historyDays: 14,
    // Alerts data window: the Alerts tab pulls documents received in the last
    // `alertDays` days (by RECEIVEDATE). Kept SMALL to minimize rows scanned.
    // Minimum of ~2 is required for missing-file detection to work (it compares
    // "got files yesterday, none today"); 3 gives a little slack for gaps.
    // 0 = no date filter (not recommended on a busy DB).
    alertDays: 3,
    // Optional hard ceiling on rows PER CONNECTION, applied ON TOP of the date
    // window as a last-resort guardrail. 0 = no cap (the date window is the limit).
    rowCap: 0
  },
  // SMTP server used to actually send alert emails. Editable in Admin.
  // The password is stored here (settings.json is git-ignored) and is NEVER
  // returned to the browser — getAll() masks it. enabled=false → send is blocked.
  smtp: {
    enabled: false,
    host: '',
    port: 587,
    secure: false,       // true = implicit TLS (port 465); false = STARTTLS (587)
    user: '',
    password: '',
    fromName: 'DM Monitoring',
    fromAddress: ''      // envelope From; falls back to `user` if blank
  },
  email: {
    // Default/fallback recipient (used when a workflow has no specific recipient).
    recipient: 'helpdesk@b2b.com.my',
    // Per-workflow recipients: { "<WORKFLOWID or buyer keyword>": "email(s)" }.
    // Matched case-insensitively: exact workflow id first, else a key contained
    // in the workflow id (e.g. "AEON"). Falls back to `recipient` above.
    recipients: {},
    subject: '[eHub Alert] Missing files for {workflow} on {expectedDay}',
    body:
`Hi Helpdesk,

Please assist to raise ticket to {buyer}.

Dear {buyer} team,

Our monitoring has detected that no documents were received from you on the expected day.

  Expected day  : {expectedDay}
  Last received : {lastReceived}

Could you please confirm whether the files have been sent on your side? If already sent, kindly advise so we can investigate the transmission.

Thank you,
DM Data Management Support Team`
  }
};

function read() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return { ...DEFAULTS };
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    // Merge with defaults so missing keys are filled
    const email = { ...DEFAULTS.email, ...(parsed.email || {}) };
    if (!email.recipients || typeof email.recipients !== 'object') email.recipients = {};
    const merged = {
      ...DEFAULTS,
      ...parsed,
      email
    };
    if (!merged.buyerLabels || typeof merged.buyerLabels !== 'object') merged.buyerLabels = {};
    merged.monitoredWorkflows = Array.isArray(parsed.monitoredWorkflows)
      ? parsed.monitoredWorkflows.map(w => String(w).trim()).filter(Boolean)
      : [];
    merged.smtp = { ...DEFAULTS.smtp, ...(parsed.smtp || {}) };
    merged.dataSource = { ...DEFAULTS.dataSource, ...(parsed.dataSource || {}) };
    // Backfill new dataSource keys if an older settings.json omitted them.
    if (merged.dataSource.historyDays == null) merged.dataSource.historyDays = DEFAULTS.dataSource.historyDays;
    if (merged.dataSource.alertDays == null) merged.dataSource.alertDays = DEFAULTS.dataSource.alertDays;
    if (merged.dataSource.rowCap == null) merged.dataSource.rowCap = DEFAULTS.dataSource.rowCap;
    // documentTypes: keep only known types (uppercased). If the key is absent
    // entirely, fall back to the default (all types); an explicit [] means "all".
    if (Array.isArray(parsed.documentTypes)) {
      merged.documentTypes = parsed.documentTypes
        .map(t => String(t).trim().toUpperCase())
        .filter(t => KNOWN_DOCUMENT_TYPES.includes(t));
    } else {
      merged.documentTypes = [...DEFAULTS.documentTypes];
    }
    return merged;
  } catch (err) {
    console.error('[settingsService] read error:', err.message);
    return { ...DEFAULTS };
  }
}

function write(next) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8');
}

/**
 * Full settings object for the ADMIN UI. The SMTP password is NEVER returned —
 * it's replaced with a boolean `hasPassword` so the UI can show "configured"
 * without exposing the secret. Use getSmtp() server-side when actually sending.
 */
function getAll() {
  const s = read();
  if (s.smtp) {
    const { password, ...rest } = s.smtp;
    s.smtp = { ...rest, hasPassword: !!password };
  }
  return s;
}

/** Full SMTP config INCLUDING the password — server-side use only (sending). */
function getSmtp() {
  return read().smtp || { ...DEFAULTS.smtp };
}

/** Convenience accessors used across the app. */
function getPriorityBuyers() {
  const s = read();
  return Array.isArray(s.priorityBuyers) && s.priorityBuyers.length ? s.priorityBuyers : DEFAULTS.priorityBuyers;
}

/** Raw monitored-workflow entries as stored (may be "db | workflow" or "workflow"). */
function getMonitoredWorkflows() {
  const s = read();
  return Array.isArray(s.monitoredWorkflows) ? s.monitoredWorkflows : [];
}

/**
 * Parse the monitored-workflow entries into { db, workflow } objects.
 * "general_ehub | ORDERS_X"  → { db: 'general_ehub', workflow: 'ORDERS_X' }
 * "ORDERS_X"                 → { db: null, workflow: 'ORDERS_X' }  (all DBs)
 */
function parseMonitoredWorkflows() {
  return getMonitoredWorkflows().map(entry => {
    const raw = String(entry || '').trim();
    if (!raw) return null;
    const pipe = raw.indexOf('|');
    if (pipe >= 0) {
      const db = raw.slice(0, pipe).trim();
      const workflow = raw.slice(pipe + 1).trim();
      return workflow ? { db: db || null, workflow } : null;
    }
    return { db: null, workflow: raw };
  }).filter(Boolean);
}

/**
 * The exact workflows that apply to a given database connection name:
 * entries pinned to that db PLUS entries with no db (which apply everywhere).
 * Returns an array of workflow id strings.
 */
function getMonitoredWorkflowsFor(dbName) {
  return parseMonitoredWorkflows()
    .filter(e => e.db == null || String(e.db).toLowerCase() === String(dbName || '').toLowerCase())
    .map(e => e.workflow);
}

/** All distinct monitored workflow ids (ignoring db pinning) — for alert monitoring. */
function getAllMonitoredWorkflowIds() {
  return [...new Set(parseMonitoredWorkflows().map(e => e.workflow))];
}

/** Document types to include in the query (subset of KNOWN_DOCUMENT_TYPES). Empty = all. */
function getDocumentTypes() {
  const s = read();
  return Array.isArray(s.documentTypes) ? s.documentTypes : [];
}

function getReAlertMinutes() {
  const s = read();
  const n = parseInt(s.reAlertMinutes, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULTS.reAlertMinutes;
}

function getEmail() {
  return read().email;
}

/** The MSSQL query + row cap (editable in Admin). */
function getDataSource() {
  return read().dataSource;
}

// Build the shared WHERE conditions (priority buyers + document types + N-day
// window) used by BOTH the raw query and the aggregate query. Returns an array
// of SQL condition strings (already escaped). `isMysql` picks the date function.
function buildFilterClauses(s, isMysql, opts = {}) {
  const esc = (v) => String(v).replace(/'/g, "''");
  const clauses = [];

  // Workflow scope. Two ways a row qualifies, combined with OR:
  //   (a) buyer keyword (substring) AND the document-type filter, OR
  //   (b) an EXACT monitored workflow id (bypasses the doctype filter — Option 1).
  const buyers = Array.isArray(s.priorityBuyers) ? s.priorityBuyers.filter(Boolean) : [];
  const docTypes = Array.isArray(s.documentTypes) ? s.documentTypes.filter(Boolean) : [];
  // Exact monitored workflows for THIS connection: entries pinned to this db
  // plus unpinned ones. If no dbName is given, include all (back-compat).
  const exactWf = (opts.dbName != null
    ? getMonitoredWorkflowsFor(opts.dbName)
    : getAllMonitoredWorkflowIds());

  const buyerBranchParts = [];
  if (buyers.length) {
    buyerBranchParts.push('(' + buyers.map(b => `WORKFLOWID LIKE '%${esc(b)}%'`).join(' OR ') + ')');
  }
  if (docTypes.length) {
    buyerBranchParts.push('DOCTYPEID IN (' + docTypes.map(t => `'${esc(t)}'`).join(', ') + ')');
  }
  const buyerBranch = buyerBranchParts.length ? '(' + buyerBranchParts.join(' AND ') + ')' : '';

  const exactBranch = exactWf.length
    ? 'WORKFLOWID IN (' + exactWf.map(w => `'${esc(w)}'`).join(', ') + ')'
    : '';

  // Combine the two branches with OR. If only one exists, use it directly.
  if (buyerBranch && exactBranch) {
    clauses.push(`(${buyerBranch} OR ${exactBranch})`);
  } else if (buyerBranch) {
    clauses.push(buyerBranch);
  } else if (exactBranch) {
    clauses.push(exactBranch);
  }

  // The rolling date filter is skipped when the caller supplies its own fixed
  // date window (snapshot mode). `opts.dateDays` overrides which setting drives
  // the window (Alerts uses alertDays; the legacy aggregate uses historyDays).
  if (!opts.skipDate) {
    const days = opts.dateDays != null
      ? parseInt(opts.dateDays, 10)
      : parseInt(s.dataSource.historyDays, 10);
    if (Number.isFinite(days) && days > 0) {
      const cutoff = isMysql
        ? `DATE_SUB(NOW(), INTERVAL ${days} DAY)`
        : `DATEADD(day, -${days}, GETDATE())`;
      clauses.push(`RECEIVEDATE >= ${cutoff}`);
    }
  }

  return clauses;
}

/**
 * The configured query with the priority-buyer WHERE filter and the row cap
 * applied, rendered for the target SQL dialect.
 *
 * @param {string} [client='mssql'] - 'mssql' or 'mysql'. MSSQL uses
 *   `SELECT TOP (n) ... dbo.table`; MySQL uses `SELECT ... table ... LIMIT n`
 *   (the `dbo.` schema qualifier, which MySQL has no concept of, is removed).
 */
function getEffectiveQuery(client = 'mssql', dbName = null) {
  const dialect = String(client || 'mssql').toLowerCase();
  const isMysql = dialect === 'mysql' || dialect === 'mariadb';

  const s = read();
  const ds = s.dataSource;
  const cap = parseInt(ds.rowCap, 10);
  let q = String(ds.query || '').trim();

  // MySQL has no `dbo` schema. Rewrite `db.dbo.TABLE` -> `db.TABLE` and a bare
  // `dbo.TABLE` -> `TABLE` so the same stored query works against MySQL.
  if (isMysql) {
    q = q.replace(/\bdbo\./gi, '');
  }

  // Build the auto WHERE conditions (only when the query has no WHERE of its own).
  // Alerts data is bounded by a DATE window (alertDays), not the trend historyDays.
  if (!/\bWHERE\b/i.test(q)) {
    const clauses = buildFilterClauses(s, isMysql, { dateDays: s.dataSource.alertDays, dbName });
    if (clauses.length) {
      const where = clauses.join(' AND ');
      // Insert the WHERE before any trailing ORDER BY; else append at the end.
      if (/\bORDER\s+BY\b/i.test(q)) {
        q = q.replace(/\bORDER\s+BY\b/i, `WHERE ${where} ORDER BY`);
      } else {
        q = q + ` WHERE ${where}`;
      }
    }
  }

  // Ensure newest-first ordering so the row cap returns the LATEST documents
  //    (without ORDER BY, TOP/LIMIT return an arbitrary set). Only add if the
  //    query doesn't already specify its own ORDER BY.
  if (!/\bORDER\s+BY\b/i.test(q)) {
    q = q + ' ORDER BY RECEIVEDATE DESC';
  }

  // 4) Apply the row cap.
  if (Number.isFinite(cap) && cap > 0) {
    if (isMysql) {
      // MySQL: append LIMIT n (if not already present).
      if (!/\bLIMIT\s+\d/i.test(q)) q = `${q} LIMIT ${cap}`;
    } else {
      // MSSQL: inject TOP (n) after SELECT (if not already present).
      if (!/\bTOP\s*\(/i.test(q) && !/\bTOP\s+\d/i.test(q)) {
        q = q.replace(/^SELECT\s+/i, `SELECT TOP (${cap}) `);
      }
    }
  }
  return q;
}

/**
 * Build the DAILY AGGREGATE query for the Trends & Analysis tab.
 *
 * Returns ONE row per (workflow, day) with everything the trend/analysis views
 * need — counts, per-status counts, arrival-hour stats, and size stats —
 * computed server-side via GROUP BY. This is dramatically lighter than pulling
 * raw documents: a 14-day window yields ~ (workflows × 14) rows instead of
 * hundreds of thousands. Applies the SAME buyer + document-type + N-day filters
 * as the raw query.
 *
 * Column contract (case-insensitive; consumed by trendDataService):
 *   WORKFLOWID, DAY (YYYY-MM-DD), CNT,
 *   CNT_50, CNT_45, CNT_999,                       -- per-status counts
 *   MIN_HOUR, MAX_HOUR, AVG_HOUR,                  -- arrival hour (decimal-ish)
 *   AVG_SIZE_KB, MIN_SIZE_KB, MAX_SIZE_KB          -- file sizes (KB)
 *
 * @param {string} [client='mssql'] - 'mssql' or 'mysql'.
 * @param {{from:string,to:string}} [window] - optional FIXED date window
 *   (inclusive `from`, inclusive `to`, both 'YYYY-MM-DD'). When provided, the
 *   rolling historyDays filter is IGNORED and there is NO row cap — the query
 *   aggregates every document in that exact range. Used for the monthly
 *   trend snapshot (days 1–14 of a month).
 */
function getAggregateQuery(client = 'mssql', window = null, dbName = null) {
  const dialect = String(client || 'mssql').toLowerCase();
  const isMysql = dialect === 'mysql' || dialect === 'mariadb';
  const s = read();

  // Dialect-specific expressions
  const table = isMysql ? 'DOCUMENT' : 'dbo.DOCUMENT';
  // Day bucket (date only)
  const dayExpr = isMysql ? 'DATE(RECEIVEDATE)' : 'CAST(RECEIVEDATE AS DATE)';
  // Arrival time as a decimal hour: hour + minute/60
  const hourExpr = isMysql
    ? '(HOUR(RECEIVEDATE) + MINUTE(RECEIVEDATE)/60.0)'
    : '(DATEPART(hour, RECEIVEDATE) + DATEPART(minute, RECEIVEDATE)/60.0)';
  // Size in KB
  const sizeKbExpr = 'DOCSIZE/1024.0';
  // Per-status conditional count (portable CASE WHEN)
  const statusCnt = (code) => `SUM(CASE WHEN STATUS = '${code}' THEN 1 ELSE 0 END)`;

  // Filters: buyer + document-type always apply. The date filter is either the
  // fixed window (snapshot mode) or the rolling historyDays (legacy/live mode).
  let where;
  if (window && window.from && window.to) {
    where = buildFilterClauses(s, isMysql, { skipDate: true, dbName });
    // Inclusive range: RECEIVEDATE >= from 00:00 AND RECEIVEDATE < (to + 1 day).
    const esc = (v) => String(v).replace(/'/g, "''");
    where.push(`RECEIVEDATE >= '${esc(window.from)}'`);
    const nextExpr = isMysql
      ? `DATE_ADD('${esc(window.to)}', INTERVAL 1 DAY)`
      : `DATEADD(day, 1, '${esc(window.to)}')`;
    where.push(`RECEIVEDATE < ${nextExpr}`);
  } else {
    where = buildFilterClauses(s, isMysql, { dbName });
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const cols = [
    'WORKFLOWID',
    `${dayExpr} AS DAY`,
    'COUNT(*) AS CNT',
    `${statusCnt('50')} AS CNT_50`,
    `${statusCnt('45')} AS CNT_45`,
    `${statusCnt('999')} AS CNT_999`,
    `MIN(${hourExpr}) AS MIN_HOUR`,
    `MAX(${hourExpr}) AS MAX_HOUR`,
    `AVG(${hourExpr}) AS AVG_HOUR`,
    `AVG(${sizeKbExpr}) AS AVG_SIZE_KB`,
    `MIN(${sizeKbExpr}) AS MIN_SIZE_KB`,
    `MAX(${sizeKbExpr}) AS MAX_SIZE_KB`
  ].join(', ');

  // GROUP BY the same expressions (both dialects accept the expressions here).
  return `SELECT ${cols} FROM ${table}${whereSql} GROUP BY WORKFLOWID, ${dayExpr} ORDER BY WORKFLOWID, ${dayExpr}`;
}

/**
 * Resolve the recipient for a given workflow id.
 * Priority: exact workflow-id match > a configured key contained in the
 * workflow id (e.g. "AEON") > the general `recipient` template.
 * Returns the raw string (may contain {buyer} etc. placeholders for the caller to fill).
 */
function getRecipientFor(workflowId) {
  const email = read().email;
  const map = email.recipients || {};
  const wf = String(workflowId || '');
  const wfUpper = wf.toUpperCase();

  // 1) exact match (case-insensitive)
  for (const key of Object.keys(map)) {
    if (key.toUpperCase() === wfUpper && String(map[key]).trim()) return String(map[key]).trim();
  }
  // 2) key contained in the workflow id (e.g. "AEON" matches ORDERS_AEON_...)
  for (const key of Object.keys(map)) {
    if (key && wfUpper.includes(key.toUpperCase()) && String(map[key]).trim()) return String(map[key]).trim();
  }
  // 3) fallback to the general template recipient
  return email.recipient;
}

/**
 * Update settings from an admin form. Validates + normalizes input.
 * Accepts partial updates; unknown keys ignored.
 */
function update(input = {}) {
  const current = read();
  const next = { ...current };

  if (input.priorityBuyers != null) {
    // Accept array or comma/newline-separated string
    let list = input.priorityBuyers;
    if (typeof list === 'string') list = list.split(/[\n,]+/);
    next.priorityBuyers = list.map(s => String(s).trim().toUpperCase()).filter(Boolean);
  }

  if (input.monitoredWorkflows != null) {
    // Exact full WORKFLOWIDs. Accept array or comma/newline-separated string.
    // Preserve case (workflow ids are case-sensitive as stored). De-duplicate.
    let list = input.monitoredWorkflows;
    if (typeof list === 'string') list = list.split(/[\n,]+/);
    const seen = new Set();
    next.monitoredWorkflows = (Array.isArray(list) ? list : [])
      .map(w => String(w).trim())
      .filter(w => w && !seen.has(w) && seen.add(w));
  }

  if (input.documentTypes != null) {
    // Accept array or comma/newline-separated string; keep only known types.
    let list = input.documentTypes;
    if (typeof list === 'string') list = list.split(/[\n,]+/);
    next.documentTypes = (Array.isArray(list) ? list : [])
      .map(t => String(t).trim().toUpperCase())
      .filter(t => KNOWN_DOCUMENT_TYPES.includes(t));
  }

  if (input.buyerLabels != null && typeof input.buyerLabels === 'object') {
    const labels = {};
    for (const k of Object.keys(input.buyerLabels)) {
      const key = String(k).trim().toUpperCase();
      const val = String(input.buyerLabels[k]).trim();
      if (key && val) labels[key] = val;
    }
    next.buyerLabels = labels;
  }

  if (input.reAlertMinutes != null) {
    const n = parseInt(input.reAlertMinutes, 10);
    if (Number.isFinite(n) && n > 0) next.reAlertMinutes = n;
  }

  if (input.dataSource && typeof input.dataSource === 'object') {
    const cur = current.dataSource || DEFAULTS.dataSource;
    const q = input.dataSource.query != null ? String(input.dataSource.query).trim() : cur.query;
    let cap = cur.rowCap != null ? cur.rowCap : DEFAULTS.dataSource.rowCap;
    if (input.dataSource.rowCap != null) {
      const n = parseInt(input.dataSource.rowCap, 10);
      if (Number.isFinite(n) && n >= 0) cap = n;
    }
    let historyDays = cur.historyDays != null ? cur.historyDays : DEFAULTS.dataSource.historyDays;
    if (input.dataSource.historyDays != null) {
      const d = parseInt(input.dataSource.historyDays, 10);
      if (Number.isFinite(d) && d >= 0) historyDays = d;
    }
    let alertDays = cur.alertDays != null ? cur.alertDays : DEFAULTS.dataSource.alertDays;
    if (input.dataSource.alertDays != null) {
      const d = parseInt(input.dataSource.alertDays, 10);
      if (Number.isFinite(d) && d >= 0) alertDays = d;
    }
    next.dataSource = { query: q || DEFAULTS.dataSource.query, historyDays, alertDays, rowCap: cap };
  }

  if (input.smtp && typeof input.smtp === 'object') {
    const cur = current.smtp || DEFAULTS.smtp;
    const inp = input.smtp;
    const port = inp.port != null && Number.isFinite(parseInt(inp.port, 10)) ? parseInt(inp.port, 10) : cur.port;
    next.smtp = {
      enabled: inp.enabled != null ? !!inp.enabled : cur.enabled,
      host: inp.host != null ? String(inp.host).trim() : cur.host,
      port,
      secure: inp.secure != null ? !!inp.secure : cur.secure,
      user: inp.user != null ? String(inp.user).trim() : cur.user,
      // Password: only overwrite when a NON-EMPTY value is provided; a blank
      // field means "keep the existing password". Never cleared accidentally.
      password: (inp.password != null && String(inp.password) !== '') ? String(inp.password) : cur.password,
      fromName: inp.fromName != null ? String(inp.fromName) : cur.fromName,
      fromAddress: inp.fromAddress != null ? String(inp.fromAddress).trim() : cur.fromAddress
    };
  }

  if (input.email && typeof input.email === 'object') {
    let recipients = current.email.recipients || {};
    if (input.email.recipients != null) {
      // Accept an object map, or a newline/comma list of "workflow = email" lines
      recipients = normalizeRecipients(input.email.recipients);
    }
    next.email = {
      recipient: input.email.recipient != null ? String(input.email.recipient) : current.email.recipient,
      recipients,
      subject: input.email.subject != null ? String(input.email.subject) : current.email.subject,
      body: input.email.body != null ? String(input.email.body) : current.email.body
    };
  }

  write(next);
  return next;
}

// Accept either an object { workflow: email } or a text block of lines like:
//   ORDERS_AEON_... = ops@aeon.com
//   MYDIN | mydin.support@example.com
function normalizeRecipients(input) {
  const out = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const k of Object.keys(input)) {
      const key = String(k).trim();
      const val = String(input[k]).trim();
      if (key && val) out[key] = val;
    }
    return out;
  }
  const text = Array.isArray(input) ? input.join('\n') : String(input || '');
  text.split(/\r?\n/).forEach(line => {
    const m = line.split(/[=|]/);
    if (m.length >= 2) {
      const key = m[0].trim();
      const val = m.slice(1).join('=').trim();
      if (key && val) out[key] = val;
    }
  });
  return out;
}

module.exports = { getAll, getPriorityBuyers, getMonitoredWorkflows, parseMonitoredWorkflows, getMonitoredWorkflowsFor, getAllMonitoredWorkflowIds, getDocumentTypes, getReAlertMinutes, getEmail, getSmtp, getRecipientFor, getDataSource, getEffectiveQuery, getAggregateQuery, update, DEFAULTS, KNOWN_DOCUMENT_TYPES };
