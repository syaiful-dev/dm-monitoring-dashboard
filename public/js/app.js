// DM Monitoring Dashboard — Main App Controller
// Handles tab navigation, clock, data source indicator, and app initialization

const App = (() => {
  let activeTab = 'overview';

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
      case 'overview': Dashboard.load(); break;
      case 'trends': Trends.load(); break;
      case 'files': FileExplorer.load(); break;
      case 'alerts': Alerts.load(); break;
      case 'insights': Insights.load(); break;
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
        icon.textContent = '📁';
        text.textContent = 'eHub CSV';
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
  async function api(endpoint) {
    const res = await fetch(`/api/${endpoint}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  // Initialize app
  function init() {
    initTabs();
    initClock();
    initDataSource();
    Dashboard.load();
    Chatbot.init();
    SocketManager.init();
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
    getActiveTab: () => activeTab
  };
})();
