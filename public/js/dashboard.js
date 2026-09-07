// DM Monitoring Dashboard — Overview Tab
// KPIs, workflow distribution chart, and recent documents table
// Powered by real eHub CSV data

const Dashboard = (() => {
  async function load() {
    try {
      const overview = await App.api('overview');
      renderKPIs(overview);
      renderWorkflowChart(overview.workflowCounts);
      renderTodayTable(overview.todayRecords, overview.displayDate);
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }

  function renderKPIs(data) {
    document.getElementById('kpiWorkflows').textContent = data.totalWorkflows;
    document.getElementById('kpiOnTime').textContent = data.completionRate + '%';
    document.getElementById('kpiDelayed').textContent = data.inProgress.toLocaleString();
    document.getElementById('kpiMissing').textContent = data.errors.toLocaleString();
    document.getElementById('kpiAlerts').textContent = data.totalRecords.toLocaleString();
  }

  function renderWorkflowChart(workflowCounts) {
    if (!workflowCounts) return;

    const labels = Object.keys(workflowCounts).map(w => {
      // Shorten workflow IDs for display on chart
      return w.replace(/^ORDERS_/, '').replace(/_OUTBOUND$/, '').replace(/_PDF_/, '_');
    });
    const values = Object.values(workflowCounts);

    const colors = [
      Charts.COLORS.blue,
      Charts.COLORS.green,
      Charts.COLORS.yellow,
      Charts.COLORS.red,
      Charts.COLORS.purple,
      Charts.COLORS.gray
    ];

    Charts.createBarChart('healthTimelineChart', {
      horizontal: true,
      data: {
        labels,
        datasets: [{
          label: 'Documents',
          data: values,
          backgroundColor: colors.slice(0, labels.length),
          borderColor: colors.slice(0, labels.length),
          borderWidth: 1
        }]
      },
      options: {
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            title: { display: true, text: 'Document Count' },
            beginAtZero: true
          }
        }
      }
    });
  }

  function renderTodayTable(records, displayDate) {
    const body = document.getElementById('todayStatusBody');
    if (!body) return;

    // Update card title with the actual date displayed
    const tableCard = body.closest('.card');
    if (tableCard) {
      const titleEl = tableCard.querySelector('.card-title');
      if (titleEl) {
        titleEl.textContent = `Recent Documents (${displayDate})`;
      }
    }

    if (!records || records.length === 0) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary)">No records for this date</td></tr>';
      return;
    }

    body.innerHTML = records.map(r => `
      <tr>
        <td title="${r.workflow_id}">${r.workflow_id || '—'}</td>
        <td>${r.file_name || '—'}</td>
        <td>${r.size_kb != null ? r.size_kb.toLocaleString() : '—'}</td>
        <td>${r.received ? App.formatDateTime(r.received) : '—'}</td>
        <td>${r.status || '—'}</td>
      </tr>
    `).join('');
  }

  return { load };
})();
