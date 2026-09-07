// DM Monitoring Dashboard — Chart.js Helpers
// Shared chart configuration and utilities

const Charts = (() => {
  // Global Chart.js defaults
  Chart.defaults.color = '#9aa0a6';
  Chart.defaults.borderColor = '#37474f';
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
  Chart.defaults.font.size = 12;

  const COLORS = {
    blue: '#4fc3f7',
    green: '#4caf50',
    yellow: '#ff9800',
    red: '#f44336',
    purple: '#ab47bc',
    gray: '#607d8b',
    blueFaded: 'rgba(79, 195, 247, 0.2)',
    greenFaded: 'rgba(76, 175, 80, 0.2)',
    yellowFaded: 'rgba(255, 152, 0, 0.2)',
    redFaded: 'rgba(244, 67, 54, 0.2)',
    purpleFaded: 'rgba(171, 71, 188, 0.2)'
  };

  // Store chart instances for cleanup
  const instances = {};

  /**
   * Destroy existing chart instance before creating a new one
   */
  function destroy(id) {
    if (instances[id]) {
      instances[id].destroy();
      delete instances[id];
    }
  }

  /**
   * Create a line chart
   */
  function createLineChart(canvasId, config) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const chart = new Chart(ctx, {
      type: 'line',
      data: config.data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 12,
              padding: 12
            }
          },
          tooltip: {
            backgroundColor: '#1a2332',
            titleColor: '#e8eaed',
            bodyColor: '#9aa0a6',
            borderColor: '#37474f',
            borderWidth: 1,
            padding: 10
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxRotation: 45 }
          },
          y: {
            grid: { color: 'rgba(55, 71, 79, 0.5)' },
            beginAtZero: config.beginAtZero !== false
          }
        },
        ...config.options
      }
    });

    instances[canvasId] = chart;
    return chart;
  }

  /**
   * Create a horizontal bar chart (for timeline)
   */
  function createBarChart(canvasId, config) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const chart = new Chart(ctx, {
      type: 'bar',
      data: config.data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: config.horizontal ? 'y' : 'x',
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, padding: 12 }
          },
          tooltip: {
            backgroundColor: '#1a2332',
            titleColor: '#e8eaed',
            bodyColor: '#9aa0a6',
            borderColor: '#37474f',
            borderWidth: 1,
            padding: 10
          }
        },
        scales: {
          x: {
            grid: { display: config.horizontal ? true : false },
            beginAtZero: true
          },
          y: {
            grid: { display: config.horizontal ? false : true, color: 'rgba(55, 71, 79, 0.5)' }
          }
        },
        ...config.options
      }
    });

    instances[canvasId] = chart;
    return chart;
  }

  return { COLORS, createLineChart, createBarChart, destroy };
})();
