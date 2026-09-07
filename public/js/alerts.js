// DM Monitoring Dashboard — Alerts Tab
// Displays alerts derived from real eHub CSV data (errors, large files, incomplete status)

const Alerts = (() => {
  let currentSeverity = '';
  let initialized = false;

  async function load() {
    if (!initialized) {
      initControls();
      initialized = true;
    }
    await fetchAlerts();
  }

  function initControls() {
    const filterBtns = document.querySelectorAll('.alert-filter-tabs .btn-sm');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSeverity = btn.dataset.severity;
        fetchAlerts();
      });
    });
  }

  async function fetchAlerts() {
    try {
      let query = 'alerts';
      if (currentSeverity) query += `?severity=${currentSeverity}`;

      const [alerts, stats] = await Promise.all([
        App.api(query),
        App.api('alerts/stats')
      ]);

      renderAlertsList(alerts);
      renderAlertStats(stats);
    } catch (err) {
      console.error('Alerts load error:', err);
    }
  }

  function renderAlertsList(alerts) {
    const container = document.getElementById('alertsList');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No alerts found</p>';
      return;
    }

    container.innerHTML = alerts.map(a => `
      <div class="alert-item ${a.severity}">
        <div class="alert-item-content">
          <div class="alert-item-title">${a.title}</div>
          <div class="alert-item-message">${a.message}</div>
          <div class="alert-item-meta">
            ${severityBadge(a.severity)} · ${a.type} · ${a.received ? App.formatDateTime(a.received) : '—'}
          </div>
        </div>
      </div>
    `).join('');
  }

  function renderAlertStats(stats) {
    const container = document.getElementById('alertStats');
    if (!container) return;

    container.innerHTML = `
      <div class="stat-row">
        <span class="stat-label">🔴 Critical</span>
        <span class="stat-value" style="color:var(--accent-red)">${stats.critical}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">🟡 Warning</span>
        <span class="stat-value" style="color:var(--accent-yellow)">${stats.warning}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">ℹ️ Info</span>
        <span class="stat-value" style="color:var(--accent-blue)">${stats.info}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Total</span>
        <span class="stat-value">${stats.total}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Most Problematic</span>
        <span class="stat-value" style="font-size:0.75rem">${stats.mostProblematic || '—'}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Alert Count</span>
        <span class="stat-value">${stats.mostProblematicCount || 0}</span>
      </div>
    `;
  }

  function severityBadge(severity) {
    const labels = {
      critical: '🔴 Critical',
      warning: '🟡 Warning',
      info: 'ℹ️ Info'
    };
    return `<span class="badge badge-${severity}">${labels[severity] || severity}</span>`;
  }

  return { load };
})();
