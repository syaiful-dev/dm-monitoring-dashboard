// File Details Service
// Powers the "File Details" tab: a live, on-demand lookup of a document in ONE
// selected database. Read-only, parameterized (no SQL injection), and resilient
// to schema differences — it discovers the real columns of DOCUMENT and
// DOCUMENT_CONTENT_MAPPING from INFORMATION_SCHEMA and selects only those that
// exist, so a column-name mismatch never crashes the query.

const trendSource = require('../config/trendSource');
const { getProvider } = require('./trendProviderFactory');

const DOC_TABLE = 'DOCUMENT';
const MAP_TABLE = 'DOCUMENT_CONTENT_MAPPING';
const MAX_DOCS = 25; // cap matched documents

// Fields to show for each table, in display order. Only those that actually
// exist in the table are used (matched case-insensitively), so a name mismatch
// never breaks the query — the field is simply omitted. Real column names in
// the live DB: DOCTYPEID (not DOCTYPE), LAST_SUCCESSFUL_STATE (underscored).
const DOC_FIELDS = ['DOCID', 'DOCSIZE', 'STATUS', 'RECEIVEDATE', 'STATE', 'LAST_SUCCESSFUL_STATE', 'DOCTYPEID', 'METADATA'];
const MAP_FIELDS = ['DOCID', 'CONTENTID', 'VERSION'];

function isMysqlClient(conn) {
  const c = String((conn && conn.client) || 'mssql').toLowerCase();
  return c === 'mysql' || c === 'mariadb';
}

// Find the connection object by its configured name.
function findConnection(dbName) {
  return trendSource.enabledConnections().find(c => c.name === dbName) || null;
}

// Discover the actual column names of a table (case-insensitive match on the
// table name). Returns an array of column names as the DB reports them.
async function discoverColumns(provider, conn, tableName) {
  const sql = 'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE UPPER(TABLE_NAME) = UPPER(' +
    (isMysqlClient(conn) ? '?' : '@p0') + ')';
  const rows = await provider.runParamQueryOn(conn, sql, [tableName]);
  // Column name key varies: COLUMN_NAME (both engines, but case may differ).
  return rows.map(r => r.COLUMN_NAME || r.column_name).filter(Boolean);
}

// From the real columns, pick ONLY the wanted fields that actually exist
// (case-insensitive), preserving the requested order. Returns the real column
// names as the DB spells them. Fields that don't exist are silently skipped.
function pickFields(real, wanted) {
  const realUpper = new Map(real.map(c => [c.toUpperCase(), c]));
  const out = [];
  wanted.forEach(w => {
    const hit = realUpper.get(w.toUpperCase());
    if (hit) out.push(hit);
  });
  return out;
}

// Quote an identifier for the dialect ([col] for MSSQL, `col` for MySQL).
function quoteId(name, mysql) {
  return mysql ? '`' + String(name).replace(/`/g, '``') + '`'
               : '[' + String(name).replace(/]/g, ']]') + ']';
}

function tableRef(table, mysql) {
  return mysql ? quoteId(table, true) : 'dbo.' + quoteId(table, false);
}

// Normalize a value for JSON (Dates → "YYYY-MM-DD HH:MM:SS", Buffers → string).
function normalizeValue(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return v;
}

function normalizeRow(row, columns) {
  const out = {};
  columns.forEach(c => {
    // row keys may differ in case from the discovered column name
    const key = Object.keys(row).find(k => k.toUpperCase() === c.toUpperCase());
    out[c] = normalizeValue(key != null ? row[key] : null);
  });
  return out;
}

/**
 * Look up documents in ONE database.
 * @param {string} dbName   connection name (required)
 * @param {object} filters  { docid, workflowid } — exact match, optional
 * @returns {Promise<{db, columns:{document, mapping}, results:[{document, contentMapping}]}>}
 */
async function lookup(dbName, filters = {}) {
  if (trendSource.source !== 'db') {
    throw new Error('File Details requires database mode (set TREND_SOURCE=db).');
  }
  if (!dbName) throw new Error('A database must be selected.');

  const conn = findConnection(dbName);
  if (!conn) throw new Error(`Database "${dbName}" is not a configured connection.`);

  const provider = getProvider(conn);
  const mysql = isMysqlClient(conn);
  const ph = (i) => (mysql ? '?' : '@p' + i); // placeholder for param i

  // 1) Discover the DOCUMENT table's real columns, then keep only the fields we
  //    want to display (that actually exist). Also discover DOCID/WORKFLOWID for
  //    filtering even if they aren't in the display set.
  const docAll = await discoverColumns(provider, conn, DOC_TABLE);
  if (!docAll.length) throw new Error(`Table ${DOC_TABLE} not found (or no columns) in "${dbName}".`);
  const docCols = pickFields(docAll, DOC_FIELDS);

  // Resolve the real DOCID / WORKFLOWID column names (from the FULL column set,
  // since WORKFLOWID is used for filtering even if not in the display fields).
  const findCol = (cols, want) => cols.find(c => c.toUpperCase() === want.toUpperCase());
  const docIdCol = findCol(docAll, 'DOCID');
  const wfCol = findCol(docAll, 'WORKFLOWID');

  // 2) Build the parameterized WHERE for the DOCUMENT query (exact match).
  const where = [];
  const params = [];
  const docid = (filters.docid || '').trim();
  const workflowid = (filters.workflowid || '').trim();
  if (docid && docIdCol) { where.push(`${quoteId(docIdCol, mysql)} = ${ph(params.length)}`); params.push(docid); }
  if (workflowid && wfCol) { where.push(`${quoteId(wfCol, mysql)} = ${ph(params.length)}`); params.push(workflowid); }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const selectCols = docCols.map(c => quoteId(c, mysql)).join(', ');
  const orderSql = findCol(docCols, 'RECEIVEDATE') ? ` ORDER BY ${quoteId(findCol(docCols, 'RECEIVEDATE'), mysql)} DESC` : '';

  let docSql;
  if (mysql) {
    docSql = `SELECT ${selectCols} FROM ${tableRef(DOC_TABLE, true)}${whereSql}${orderSql} LIMIT ${MAX_DOCS}`;
  } else {
    docSql = `SELECT TOP (${MAX_DOCS}) ${selectCols} FROM ${tableRef(DOC_TABLE, false)}${whereSql}${orderSql}`;
  }

  const docRows = await provider.runParamQueryOn(conn, docSql, params);
  const documents = docRows.map(r => normalizeRow(r, docCols));

  // 3) Content mapping — discover columns once; query per matched DOCID.
  let mapCols = [];
  let mapByDoc = {};
  try {
    mapCols = pickFields(await discoverColumns(provider, conn, MAP_TABLE), MAP_FIELDS);
  } catch (_) { mapCols = []; }

  const mapDocIdCol = mapCols.length ? findCol(mapCols, 'DOCID') : null;
  if (mapCols.length && mapDocIdCol && documents.length) {
    const ids = documents.map(d => d[docIdCol]).filter(v => v != null && v !== '');
    if (ids.length) {
      const inPlaceholders = ids.map((_, i) => ph(i)).join(', ');
      const mapSelect = mapCols.map(c => quoteId(c, mysql)).join(', ');
      const mapSql = `SELECT ${mapSelect} FROM ${tableRef(MAP_TABLE, mysql)} WHERE ${quoteId(mapDocIdCol, mysql)} IN (${inPlaceholders})`;
      const mapRows = await provider.runParamQueryOn(conn, mapSql, ids);
      mapRows.forEach(r => {
        const nr = normalizeRow(r, mapCols);
        const key = String(nr[mapDocIdCol]);
        (mapByDoc[key] = mapByDoc[key] || []).push(nr);
      });
    }
  }

  const results = documents.map(d => ({
    document: d,
    contentMapping: mapByDoc[String(d[docIdCol])] || []
  }));

  return {
    db: dbName,
    columns: { document: docCols, mapping: mapCols },
    results
  };
}

module.exports = { lookup, DOC_TABLE, MAP_TABLE };
