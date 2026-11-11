// Trend MySQL Provider (per-connection)
// Mirrors trendMssqlProvider's interface (runQueryOn / testConnection /
// loadFromConnection) but talks to MySQL via the mysql2 driver. Returns rows in
// the SAME normalized shape (via the shared row mapper), so the combined view
// downstream treats MySQL and MSSQL connections identically. Read-only.

const trendSource = require('../config/trendSource');
const { resolveDatetime, mapRow } = require('./trendRowMapper');

// Build a mysql2 connection config from one connection entry.
function connectionConfig(conn, timeoutMs) {
  return {
    host: conn.host,
    port: conn.port || 3306,
    database: conn.database,
    user: conn.user,
    password: conn.password,
    connectTimeout: timeoutMs || trendSource.timeoutMs,
    // Return DATETIME/DATE as strings ("YYYY-MM-DD HH:MM:SS") rather than JS
    // Date objects, matching what resolveDatetime expects and avoiding TZ shifts.
    dateStrings: true,
    // TLS: enable only when the connection opts into encryption.
    ssl: conn.encrypt
      ? { rejectUnauthorized: conn.trustServerCertificate === false }
      : undefined
  };
}

function assertConfigured(conn) {
  if (!conn || !conn.host || !conn.database || !conn.user) {
    throw new Error('Connection is not configured (needs HOST, DATABASE, USER, PASSWORD in .env).');
  }
}

// Run an arbitrary read query against ONE MySQL connection; returns raw rows.
// `timeoutMs` optionally overrides the default connect/query timeout.
async function runQueryOn(conn, query, timeoutMs) {
  const mysql = require('mysql2/promise');
  assertConfigured(conn);
  let connection;
  try {
    connection = await mysql.createConnection(connectionConfig(conn, timeoutMs));
    const [rows] = timeoutMs
      ? await connection.query({ sql: query, timeout: timeoutMs })
      : await connection.query(query);
    return Array.isArray(rows) ? rows : [];
  } finally {
    if (connection) { try { await connection.end(); } catch (_) {} }
  }
}

// Run a PARAMETERIZED read query. `params` is an array of values; reference them
// in the SQL with `?` placeholders (mysql2 positional). Prevents SQL injection.
async function runParamQueryOn(conn, query, params, timeoutMs) {
  const mysql = require('mysql2/promise');
  assertConfigured(conn);
  let connection;
  try {
    connection = await mysql.createConnection(connectionConfig(conn, timeoutMs));
    const [rows] = await connection.execute(query, params || []);
    return Array.isArray(rows) ? rows : [];
  } finally {
    if (connection) { try { await connection.end(); } catch (_) {} }
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

// Load DAILY AGGREGATE rows from ONE connection (no mapRow — pre-grouped summary
// rows). Tag each with the source connection name for the merge.
async function loadAggregatesFromConnection(conn, query) {
  const rows = await runQueryOn(conn, query, trendSource.aggregateTimeoutMs);
  return rows.map(r => ({ ...r, _source: conn.name }));
}

module.exports = {
  resolveDatetime,
  connectionConfig,
  runQueryOn,
  runParamQueryOn,
  testConnection,
  loadFromConnection,
  loadAggregatesFromConnection
};
