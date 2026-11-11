// DM Monitoring Dashboard — WebSocket Manager
// Handles real-time updates from simulation service

const SocketManager = (() => {
  let socket = null;

  function init() {
    socket = io();

    socket.on('connect', () => {
      console.log('[Socket] Connected');
      updateConnectionStatus(true);
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      updateConnectionStatus(false);
    });

    // Refresh alerts + badge when a new alert arrives and we're on the Alerts tab
    socket.on('alert:new', () => {
      if (App.getActiveTab() === 'alerts' && window.Alerts) Alerts.load();
      if (App.updateAlertsBadge) App.updateAlertsBadge();
    });
  }

  function updateConnectionStatus(connected) {
    const el = document.getElementById('connectionStatus');
    if (el) {
      const dot = el.querySelector('.status-dot');
      const text = el.querySelector('span:last-child');
      if (connected) {
        dot.classList.add('connected');
        text.textContent = 'Connected';
      } else {
        dot.classList.remove('connected');
        text.textContent = 'Disconnected';
      }
    }
  }

  return { init };
})();
