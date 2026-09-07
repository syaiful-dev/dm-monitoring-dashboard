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

    // New file received
    socket.on('file:received', (data) => {
      console.log('[Socket] File received:', data.file_name);
      
      // Refresh dashboard if on overview tab
      if (App.getActiveTab() === 'overview') {
        Dashboard.load();
      }
    });

    // New alert
    socket.on('alert:new', (data) => {
      console.log('[Socket] New alert:', data.title);
      
      // Refresh alerts if on alerts tab
      if (App.getActiveTab() === 'alerts') {
        Alerts.load();
      }

      // Update chatbot badge
      Chatbot.incrementBadge();
    });

    // Status update
    socket.on('status:update', () => {
      if (App.getActiveTab() === 'overview') {
        Dashboard.load();
      }
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
