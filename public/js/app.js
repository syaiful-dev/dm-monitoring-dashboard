// DM Monitoring Dashboard — Main App Controller
// Handles tab navigation, clock, data source indicator, and app initialization

const App = (() => {
  let activeTab = 'alerts';

  // Tab navigation
  function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
      });
    });
  }

  function switchTab(tab) {
    activeTab = tab;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tab}`);
    });

    // Load tab data
    switch (tab) {
      case 'alerts': Alerts.load(); break;
      case 'trends': Trends.load(); Insights.load(); break;
      case 'filedetails': if (window.FileDetails) FileDetails.load(); break;
    }
  }

  // Alerts tab badge — shows count of active (new) missing-file alerts
  async function updateAlertsBadge() {
    try {
      const data = await api('missing-alerts');
      const active = data.summary ? data.summary.active : 0;
      const badge = document.getElementById('alertsTabBadge');
      if (badge) {
        if (active > 0) {
          badge.style.display = 'inline-flex';
          badge.textContent = active > 99 ? '99+' : active;
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (err) {
      console.error('Failed to update alerts badge:', err);
    }
  }

  // Live clock
  function initClock() {
    updateClock();
    setInterval(updateClock, 1000);
  }

  function updateClock() {
    const el = document.getElementById('liveClock');
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
  }

  // Data source badge
  async function initDataSource() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      const badge = document.getElementById('dataSourceBadge');
      if (badge) {
        const icon = badge.querySelector('.badge-icon');
        const text = badge.querySelector('.badge-text');
        icon.textContent = data.sourceIcon || (data.source === 'db' ? '🗄️' : '📁');
        text.textContent = data.sourceLabel || data.provider || 'Data Source';
        if (data.connections && data.connections.length) {
          badge.title = 'Sources: ' + data.connections.join(', ');
        }
      }
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  }

  // Utility: format datetime
  function formatTime(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit'
    });
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric'
    });
  }

  function formatDateTime(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  // Status badge HTML
  function statusBadge(status) {
    const labels = {
      on_time: '✓ On Time',
      late: '⚠ Late',
      missing: '✗ Missing',
      abnormal: '? Abnormal'
    };
    return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
  }

  function severityBadge(severity) {
    const labels = {
      critical: '🔴 Critical',
      warning: '🟡 Warning',
      info: 'ℹ️ Info'
    };
    return `<span class="badge badge-${severity}">${labels[severity] || severity}</span>`;
  }

  // API helper
  // ---- Global loading overlay ----
  // Reference-counted so overlapping requests don't hide it too early. A short
  // delay avoids a distracting flash for very fast calls.
  let loaderCount = 0;
  let loaderTimer = null;

  function showLoader(text) {
    loaderCount++;
    const el = document.getElementById('appLoader');
    if (!el) return;
    const label = document.getElementById('appLoaderText');
    if (label && text) label.textContent = text;
    if (loaderTimer) return; // already scheduled/visible
    loaderTimer = setTimeout(() => { el.classList.add('show'); el.setAttribute('aria-hidden', 'false'); }, 180);
  }

  function hideLoader() {
    loaderCount = Math.max(0, loaderCount - 1);
    if (loaderCount > 0) return; // other requests still running
    if (loaderTimer) { clearTimeout(loaderTimer); loaderTimer = null; }
    const el = document.getElementById('appLoader');
    if (el) {
      el.classList.remove('show');
      el.setAttribute('aria-hidden', 'true');
      const label = document.getElementById('appLoaderText');
      if (label) label.textContent = 'Loading…';
    }
  }

  // Every API call shows the overlay automatically.
  async function api(endpoint) {
    showLoader();
    try {
      const res = await fetch(`/api/${endpoint}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return await res.json();
    } finally {
      hideLoader();
    }
  }

  // Initialize app — each step guarded so one failure can't block the others
  function init() {
    const safe = (label, fn) => { try { fn(); } catch (e) { console.error(`[init] ${label} failed:`, e); } };
    safe('tabs', initTabs);
    safe('clock', initClock);
    safe('dataSource', initDataSource);
    safe('assistant', () => { if (window.Assistant) Assistant.init(); });
    safe('alerts', () => Alerts.load());
    safe('alertsBadge', updateAlertsBadge);
    safe('socket', () => SocketManager.init());
  }

  // Start when DOM is ready
  document.addEventListener('DOMContentLoaded', init);

  return {
    switchTab,
    formatTime,
    formatDate,
    formatDateTime,
    statusBadge,
    severityBadge,
    api,
    showLoader,
    hideLoader,
    updateAlertsBadge,
    getActiveTab: () => activeTab
  };
})();
