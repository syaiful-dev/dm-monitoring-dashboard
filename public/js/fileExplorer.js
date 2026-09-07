// DM Monitoring Dashboard — Files Tab
// Displays real eHub B2B document records from Trenddata CSVs
// Columns: Workflow, File Name, Size (KB), Received, Status

const FileExplorer = (() => {
  let currentPage = 1;
  let initialized = false;

  async function load() {
    if (!initialized) {
      await initControls();
      initialized = true;
    }
    await fetchFiles();
  }

  async function initControls() {
    // Load distinct workflow IDs into selector
    try {
      const workflows = await App.api('files/workflows');
      const select = document.getElementById('fileWorkflowSelect');
      if (select) {
        select.innerHTML = '<option value="">All Workflows</option>' +
          workflows.map(w => `<option value="${w}">${w}</option>`).join('');
      }
    } catch (err) {
      console.error('Failed to load workflow filter:', err);
    }

    // Load distinct status codes into selector
    try {
      const statuses = await App.api('files/statuses');
      const select = document.getElementById('fileStatusSelect');
      if (select) {
        select.innerHTML = '<option value="">All</option>' +
          statuses.map(s => `<option value="${s}">${s}</option>`).join('');
      }
    } catch (err) {
      console.error('Failed to load status filter:', err);
    }

    // Filter button
    const filterBtn = document.getElementById('fileFilterBtn');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        currentPage = 1;
        fetchFiles();
      });
    }
  }

  async function fetchFiles() {
    const workflowId = document.getElementById('fileWorkflowSelect')?.value || '';
    const dateFrom = document.getElementById('fileDateFrom')?.value || '';
    const dateTo = document.getElementById('fileDateTo')?.value || '';
    const status = document.getElementById('fileStatusSelect')?.value || '';

    let query = `files?page=${currentPage}&limit=20`;
    if (workflowId) query += `&workflow_id=${encodeURIComponent(workflowId)}`;
    if (dateFrom) query += `&date_from=${dateFrom}`;
    if (dateTo) query += `&date_to=${dateTo}`;
    if (status) query += `&status=${status}`;

    try {
      const data = await App.api(query);
      renderTable(data.records);
      renderPagination(data);
    } catch (err) {
      console.error('Files load error:', err);
    }
  }

  function renderTable(records) {
    const body = document.getElementById('fileTableBody');
    if (!body) return;

    if (!records || records.length === 0) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary)">No records found</td></tr>';
      return;
    }

    body.innerHTML = records.map(r => `
      <tr data-record='${JSON.stringify(r).replace(/'/g, "&#39;")}'>
        <td title="${r.workflow_id || ''}">${r.workflow_id || '—'}</td>
        <td>${r.file_name || '—'}</td>
        <td>${r.size_kb != null ? r.size_kb.toLocaleString() : '—'}</td>
        <td>${r.received ? App.formatDateTime(r.received) : '—'}</td>
        <td>${r.status || '—'}</td>
      </tr>
    `).join('');

    // Row click to expand details
    body.querySelectorAll('tr').forEach(row => {
      row.addEventListener('click', () => {
        const record = JSON.parse(row.dataset.record);
        showDetail(record);
      });
    });
  }

  function renderPagination(data) {
    const container = document.getElementById('filePagination');
    if (!container) return;

    const { page, pages, total } = data;
    let html = '';

    html += `<button ${page <= 1 ? 'disabled' : ''} onclick="FileExplorer.goToPage(${page - 1})">← Prev</button>`;

    const start = Math.max(1, page - 2);
    const end = Math.min(pages, page + 2);

    for (let i = start; i <= end; i++) {
      html += `<button class="${i === page ? 'active' : ''}" onclick="FileExplorer.goToPage(${i})">${i}</button>`;
    }

    html += `<button ${page >= pages ? 'disabled' : ''} onclick="FileExplorer.goToPage(${page + 1})">Next →</button>`;
    html += `<span style="color:var(--text-secondary);font-size:0.8rem;margin-left:12px">${total} records</span>`;

    container.innerHTML = html;
  }

  function goToPage(page) {
    currentPage = page;
    fetchFiles();
  }

  function showDetail(record) {
    const panel = document.getElementById('fileDetailPanel');
    const content = document.getElementById('fileDetailContent');
    if (!panel || !content) return;

    panel.style.display = 'block';
    content.innerHTML = `
      <div class="detail-row"><span class="detail-label">File Name:</span><span>${record.file_name || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Workflow ID:</span><span>${record.workflow_id || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Size (KB):</span><span>${record.size_kb != null ? record.size_kb.toLocaleString() : '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Size (Bytes):</span><span>${record.size_bytes != null ? record.size_bytes.toLocaleString() : '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Received:</span><span>${record.received || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Status:</span><span>${record.status || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Source File:</span><span>${record.source_file || '—'}</span></div>
    `;

    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return { load, goToPage };
})();
