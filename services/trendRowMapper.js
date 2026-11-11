// Trend Row Mapper (shared)
// Shared row-normalization + datetime resolution used by BOTH the MSSQL and
// MySQL providers so every connection produces the identical record shape,
// regardless of database engine. Keeping this in one place means the merge
// logic downstream never has to care where a row came from.

// Resolve a usable "YYYY-MM-DD HH:MM:SS" datetime for a record.
// Priority: valid CREATIONDATE > METADATA <lastModified> > RECEIVEDATE (date only).
// Handles native Date objects (drivers may return dates as Date instances).
function resolveDatetime(creationDate, metadata, receiveDate) {
  const toStr = (v) => {
    if (v == null) return '';
    if (v instanceof Date) {
      const p = (n) => String(n).padStart(2, '0');
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
    }
    return String(v);
  };
  const cd = toStr(creationDate);
  if (cd && /\d{4}-\d{2}-\d{2}/.test(cd)) {
    const m = cd.match(/(\d{4}-\d{2}-\d{2})[ T]?(\d{2}:\d{2}:\d{2})?/);
    if (m) return `${m[1]} ${m[2] || '00:00:00'}`;
  }
  if (metadata) {
    const lm = String(metadata).match(/<lastModified>(\d{14})<\/lastModified>/);
    if (lm) {
      const s = lm[1];
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
    }
  }
  const rd = toStr(receiveDate);
  if (rd) { const m = rd.match(/\d{4}-\d{2}-\d{2}/); if (m) return `${m[0]} 00:00:00`; }
  return null;
}

// Case-insensitive column accessor (SQL Server and MySQL may differ in casing).
function field(row, name) {
  if (row[name] !== undefined) return row[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lower) return row[k];
  return undefined;
}

// Map a raw DB row into the normalized dashboard record shape.
// `sourceName` tags the row with the originating connection so the combined
// view knows which DB each record came from.
function mapRow(row, sourceName) {
  const docSizeRaw = field(row, 'DOCSIZE');
  const sizeBytes = docSizeRaw != null && docSizeRaw !== '' ? parseInt(docSizeRaw, 10) : null;
  return {
    doc_id: field(row, 'DOCID') != null ? String(field(row, 'DOCID')) : '',
    workflow_id: field(row, 'WORKFLOWID') != null ? String(field(row, 'WORKFLOWID')) : '',
    file_name: field(row, 'DOCFILENAME') != null ? String(field(row, 'DOCFILENAME')) : '',
    size_kb: sizeBytes ? Math.round((sizeBytes / 1024) * 100) / 100 : null,
    size_bytes: sizeBytes,
    received: resolveDatetime(field(row, 'CREATIONDATE'), field(row, 'METADATA'), field(row, 'RECEIVEDATE')),
    status: field(row, 'STATUS') != null ? String(field(row, 'STATUS')) : '',
    source_file: sourceName || 'db'
  };
}

module.exports = { resolveDatetime, field, mapRow };
