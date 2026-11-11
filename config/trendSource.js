// Trend Data Source configuration
// Controls where the dashboard's document records come from.
//
//   TREND_SOURCE=csv   → read CSV files from data/Trenddata/ (default)
//   TREND_SOURCE=db    → query MSSQL database(s) and combine into one view
//
// Multiple databases (same schema) are supported. Define numbered connections in .env:
//   TREND_DB1_NAME / TREND_DB1_HOST / TREND_DB1_PORT / TREND_DB1_DATABASE /
//   TREND_DB1_USER / TREND_DB1_PASSWORD / TREND_DB1_ENCRYPT / TREND_DB1_TRUST_CERT
//   ...up to TREND_DB5_* (or more; it scans until it finds no HOST).
//
// Back-compat: the old single-DB vars (TREND_DB_HOST, etc.) are also accepted as
// connection #1 if no numbered connections are defined.

function bool(v, def) {
  if (v == null || v === '') return def;
  return String(v).toLowerCase() === 'true';
}

function readConnection(prefix, fallbackName) {
  const host = process.env[`${prefix}_HOST`];
  if (!host) return null;

  // Per-connection database engine: 'mssql' (default) or 'mysql'.
  const client = String(process.env[`${prefix}_CLIENT`] || 'mssql').toLowerCase();
  // Sensible default port per engine when not specified.
  const defaultPort = client === 'mysql' ? 3306 : 1433;

  return {
    name: process.env[`${prefix}_NAME`] || fallbackName,
    client,
    host,
    port: parseInt(process.env[`${prefix}_PORT`], 10) || defaultPort,
    database: process.env[`${prefix}_DATABASE`] || process.env[`${prefix}_NAME`] || '',
    user: process.env[`${prefix}_USER`] || '',
    password: process.env[`${prefix}_PASSWORD`] || '',
    encrypt: bool(process.env[`${prefix}_ENCRYPT`], false),
    trustServerCertificate: bool(process.env[`${prefix}_TRUST_CERT`], true),
    enabled: bool(process.env[`${prefix}_ENABLED`], true)
  };
}

function buildConnections() {
  const list = [];

  // Numbered connections TREND_DB1_* .. TREND_DB20_*
  for (let i = 1; i <= 20; i++) {
    const conn = readConnection(`TREND_DB${i}`, `DB ${i}`);
    if (conn) list.push(conn);
  }

  // Back-compat: single-DB vars become connection #1 if none numbered.
  if (list.length === 0) {
    const legacy = readConnection('TREND_DB', 'Primary DB');
    if (legacy) list.push(legacy);
  }

  return list;
}

const connections = buildConnections();

module.exports = {
  // 'csv' (default) or 'db'
  source: (process.env.TREND_SOURCE || 'csv').toLowerCase(),

  // Shared MSSQL settings
  client: process.env.TREND_DB_CLIENT || 'mssql',
  table: process.env.TREND_DB_TABLE || 'dbo.DOCUMENT',
  timeoutMs: parseInt(process.env.TREND_DB_TIMEOUT_MS, 10) || 30000,
  // Longer timeout for the daily GROUP BY aggregate query (scans the full history
  // window server-side). Runs only at startup/reload, so a bigger budget is fine.
  aggregateTimeoutMs: parseInt(process.env.TREND_DB_AGG_TIMEOUT_MS, 10) || 120000,

  // All configured DB connections (same schema; combined into one view)
  connections,

  // Convenience: only the enabled ones
  enabledConnections() { return connections.filter(c => c.enabled); }
};
