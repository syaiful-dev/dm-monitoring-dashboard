// Trend MSSQL Provider (multi-connection)
// Connects to one or more MSSQL databases (same schema) and runs the configured
// query, returning rows in the normalized shape the dashboard uses. Read-only;
// applies row cap + timeout via the caller's query. Records are tagged with the
// source connection name so a combined view knows where each row came from.

const trendSource = require('../config/trendSource');
const { resolveDatetime, mapRow } = require('./trendRowMapper');

// Build an mssql config from one connection entry.
function connectionConfig(conn, timeoutMs) {
  let server = conn.host;
  let instanceName;
  if (server && server.includes('\\')) {
    const parts = server.split('\\');
    server = parts[0];
    instanceName = parts[1];
  }
  const options = {
    encrypt: !!conn.encrypt,
    trustServerCertificate: conn.trustServerCertificate !== false
  };
  if (instanceName) options.instanceName = instanceName;
  const t = timeoutMs || trendSource.timeoutMs;
  return {
    server,
    port: conn.port || 1433,
    database: conn.database,
    user: conn.user,
    password: conn.password,
    options,
    connectionTimeout: t,
    requestTimeout: t,
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 }
  };
}

function assertConfigured(conn) {
  if (!conn || !conn.host || !conn.database || !conn.user) {
    throw new Error('Connection is not configured (needs HOST, DATABASE, USER, PASSWORD in .env).');
  }
}

// Run an arbitrary read query against ONE connection; returns raw rows.
// `timeoutMs` optionally overrides the default request/connection timeout.
async function runQueryOn(conn, query, timeoutMs) {
  const sql = require('mssql');
  assertConfigured(conn);
  let pool;
  try {
    pool = await new sql.ConnectionPool(connectionConfig(conn, timeoutMs)).connect();
    const result = await pool.request().query(query);
    return result.recordset || [];
  } finally {
    if (pool) { try { await pool.close(); } catch (_) {} }
  }
}

// Run a PARAMETERIZED read query. `params` is an array of values; reference them
// in the SQL as @p0, @p1, … (positional). Prevents SQL injection for user input.
async function runParamQueryOn(conn, query, params, timeoutMs) {
  const sql = require('mssql');
  assertConfigured(conn);
  let pool;
  try {
    pool = await new sql.ConnectionPool(connectionConfig(conn, timeoutMs)).connect();
    const request = pool.request();
    (params || []).forEach((v, i) => request.input('p' + i, v));
    const result = await request.query(query);
    return result.recordset || [];
  } finally {
    if (pool) { try { await pool.close(); } catch (_) {} }
  }
}

// Connection-only test (SELECT 1) against one connection.
async function testConnection(conn) {
  await runQueryOn(conn, 'SELECT 1 AS ok');
  return true;
}

// Load + map records from ONE connection, tagged with its name.
async function loadFromConnection(conn, query) {
  const rows = await runQueryOn(conn, query);
  return rows.map(r => mapRow(r, conn.name)).filter(r => r.file_name);
}

// Load DAILY AGGREGATE rows from ONE connection (no mapRow — these are pre-grouped
// summary rows). Tag each with the source connection name for the merge.
async function loadAggregatesFromConnection(conn, query) {
  const rows = await runQueryOn(conn, query, trendSource.aggregateTimeoutMs);
  return rows.map(r => ({ ...r, _source: conn.name }));
}

// ---- Back-compat single-connection helpers (used by older callers) ----
function firstConnection() {
  const list = trendSource.enabledConnections();
  if (!list.length) throw new Error('MSSQL connection is not configured. Set TREND_DB1_HOST / TREND_DB1_DATABASE / TREND_DB1_USER (and password) in .env.');
  return list[0];
}
async function runQuery(query) { return runQueryOn(firstConnection(), query); }
async function loadRecordsFromMssql(query) { return loadFromConnection(firstConnection(), query); }

module.exports = {
  resolveDatetime,
  connectionConfig,
  runQueryOn,
  runParamQueryOn,
  testConnection,
  loadFromConnection,
  loadAggregatesFromConnection,
  // back-compat
  runQuery,
  loadRecordsFromMssql,
  firstConnection
};
