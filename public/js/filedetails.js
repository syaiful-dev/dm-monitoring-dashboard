// DM Monitoring Dashboard — File Details tab
// Live, on-demand document lookup in a selected database. DOCID / WORKFLOWID are
// optional exact-match filters; Database is required. Results are grouped per
// source table (DOCUMENT, DOCUMENT_CONTENT_MAPPING) and rendered with the same
// card/stat styling as the Trends & Analysis tab.

const FileDetails = (() => {
  let initialized = false;

  async function load() {
    if (!initialized) {
      await initControls();
      initialized = true;
    }
  }

  async function initControls() {
    await populateDatabases();
    const btn = document.getElementById('fdSearchBtn');
    if (btn) btn.addEventListener('click', onSearch);
    // Enter key in either text field triggers a search
    ['fdDocId', 'fdWorkflowId'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') onSearch(); });
    });
  }

  // Fill the Database dropdown from the configured connections.
  async function populateDatabases() {
    const select = document.getElementById('fdDatabase');
    if (!select) return;
    let dbs = [];
    try {
      const res = await fetch('/api/file-details/databases');
      if (res.ok) {
        const d = await res.json();
        dbs = (d.databases || []).map(x => x.name);
      }
    } catch (_) { /* leave empty */ }

    if (!dbs.length) {
      select.innerHTML = '<option value="">No databases configured</option>';
      const status = document.getElementById('fdStatus');
      if (status) {
        status.textContent = 'No databases available. File Details needs TREND_SOURCE=db with configured connections.';
        status.className = 'a-status';
      }
    } else {
      select.innerHTML = '<option value="">Select a database…</option>' +
        dbs.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    }
    if (window.SearchableSelect) SearchableSelect.enhance('fdDatabase');
  }

  async function onSearch() {
    const db = document.getElementById('fdDatabase').value;
    const docid = document.getElementById('fdDocId').value.trim();
    const workflowid = document.getElementById('fdWorkflowId').value.trim();
    const status = document.getElementById('fdStatus');
    const resultsEl = document.getElementById('fdResults');

    // Database is mandatory.
    if (!db) {
      status.textContent = '✗ Please select a database first.';
      status.className = 'a-status err';
      resultsEl.innerHTML = '';
      return;
    }

    status.textContent = 'Searching…';
    status.className = 'a-status';
    resultsEl.innerHTML = '<div class="loading-inline"><div class="app-spinner"></div><span>Searching the database…</span></div>';
    if (window.App && App.showLoader) App.showLoader('Searching…');

    try {
      const qs = new URLSearchParams({ db });
      if (docid) qs.set('docid', docid);
      if (workflowid) qs.set('workflowid', workflowid);
      const res = await fetch('/api/file-details?' + qs.toString());
      const data = await res.json();

      if (data.error) {
        status.textContent = '✗ ' + data.error;
        status.className = 'a-status err';
        resultsEl.innerHTML = '';
        return;
      }

      const n = (data.results || []).length;
      status.textContent = n ? `✓ ${n} document(s) found in ${esc(db)}` : '';
      status.className = 'a-status ok';
      renderResults(data.results, db);
    } catch (err) {
      status.textContent = '✗ Lookup failed. Please try again.';
      status.className = 'a-status err';
      resultsEl.innerHTML = '';
    } finally {
      if (window.App && App.hideLoader) App.hideLoader();
    }
  }

  // ---- Rendering: big box per table, stat boxes per field ----
  function renderResults(results, db) {
    const el = document.getElementById('fdResults');
    if (!el) return;

    if (!results || !results.length) {
      el.innerHTML = '<div class="fd-empty">No matching documents.</div>';
      return;
    }

    el.innerHTML = results.map((r) => `
      ${bigBox('DOCUMENT', 'table where the data is extracted', fieldBoxes(r.document))}

      ${bigBox('DOCUMENT_CONTENT_MAPPING', 'content versions for this document',
        (r.contentMapping || []).length
          ? r.contentMapping.map(m => fieldBoxes(m)).join('')
          : '<div class="fd-empty-sm">No content mapping rows.</div>')}
    `).join('');
  }

  // A labelled "big box" — same styling as the Trends & Analysis card.
  function bigBox(name, note, innerHtml) {
    return `
      <div class="workflow-analysis-card">
        <div class="wf-analysis-header">
          <span class="wf-analysis-title">${esc(name)}</span>
          <span class="wf-analysis-meta">${esc(note)}</span>
        </div>
        ${innerHtml}
      </div>`;
  }

  // Render an object as a grid of stat boxes — same classes as Trends analysis.
  function fieldBoxes(obj) {
    const keys = Object.keys(obj || {});
    if (!keys.length) return '<div class="fd-empty-sm">No fields.</div>';
    return '<div class="wf-analysis-grid">' + keys.map(k => {
      const val = obj[k];
      const str = (val != null && val !== '') ? String(val) : '—';
      const isWide = str.length > 60; // long fields (e.g. METADATA) span full width
      return `
        <div class="wf-stat${isWide ? ' fd-stat-wide' : ''}">
          <div class="wf-stat-label">${esc(k)}</div>
          <div class="wf-stat-value fd-stat-value">${esc(str)}</div>
        </div>`;
    }).join('') + '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { load };
})();

window.FileDetails = FileDetails;
