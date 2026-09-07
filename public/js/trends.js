// DM Monitoring Dashboard — Trends Tab
// File arrival timing trend — shows WHEN files are typically received (time of day)

const Trends = (() => {
  let workflows = [];
  let selectedWorkflow = 'ALL';
  let selectedDays = 30;
  let initialized = false;

  async function load() {
    if (!initialized) {
      await initControls();
      initialized = true;
    }
    await loadTrendData();
  }

  async function initControls() {
    try {
      workflows = await App.api('files/workflows');
      const select = document.getElementById('trendWorkflowSelect');
      if (select) {
        select.innerHTML = '<option value="ALL">All Workflows</option>' +
          workflows.map(w => `<option value="${w}">${w}</option>`).join('');

        select.addEventListener('change', () => {
          selectedWorkflow = select.value;
          loadTrendData();
        });
      }
    } catch (err) {
      console.error('Failed to load trend workflows:', err);
    }

    // Date range buttons
    const dayBtns = document.querySelectorAll('#tab-trends .btn-group .btn-sm[data-days]');
    dayBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        dayBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedDays = parseInt(btn.dataset.days, 10);
        loadTrendData();
      });
    });
  }

  async function loadTrendData() {
    try {
      const data = await App.api(`trends/${encodeURIComponent(selectedWorkflow)}?days=${selectedDays}`);
      renderTimingChart(data.trend);
      renderSizeChart(data.sizes);
      renderInsights(data);
    } catch (err) {
      console.error('Trends load error:', err);
    }
  }

  /**
   * Render arrival timing chart — shows earliest, avg, and latest arrival times per day
   */
  function renderTimingChart(trend) {
    if (!trend || !trend.data || trend.data.length === 0) {
      Charts.destroy('arrivalTrendChart');
      return;
    }

    const labels = trend.data.map(d => {
      const date = new Date(d.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const earliest = trend.data.map(d => d.earliest);
    const avg = trend.data.map(d => d.avg);
    const latest = trend.data.map(d => d.latest);

    Charts.createLineChart('arrivalTrendChart', {
      data: {
        labels,
        datasets: [
          {
            label: 'Earliest Arrival',
            data: earliest,
            borderColor: Charts.COLORS.green,
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 3,
            borderWidth: 1.5
          },
          {
            label: 'Average Arrival',
            data: avg,
            borderColor: Charts.COLORS.blue,
            backgroundColor: Charts.COLORS.blueFaded,
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            borderWidth: 2
          },
          {
            label: 'Latest Arrival',
            data: latest,
            borderColor: Charts.COLORS.red,
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 3,
            borderWidth: 1.5
          }
        ]
      },
      beginAtZero: false,
      options: {
        scales: {
          y: {
            title: { display: true, text: 'Time of Day (Hour)' },
            min: 0,
            max: 24,
            ticks: {
              stepSize: 2,
              callback: function(value) {
                const h = Math.floor(value);
                const m = Math.round((value - h) * 60);
                return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
              }
            }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const val = ctx.raw;
                const h = Math.floor(val);
                const m = Math.round((val - h) * 60);
                return `${ctx.dataset.label}: ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
              }
            }
          }
        }
      }
    });
  }

  function renderSizeChart(sizes) {
    if (!sizes || sizes.length === 0) {
      Charts.destroy('sizeTrendChart');
      return;
    }

    // Group by date and get avg size
    const dailySizes = {};
    sizes.forEach(s => {
      const date = s.date ? s.date.split(' ')[0] : null;
      if (!date) return;
      if (!dailySizes[date]) dailySizes[date] = [];
      dailySizes[date].push(s.size_kb);
    });

    const sortedDates = Object.keys(dailySizes).sort();
    const labels = sortedDates.map(d => {
      const date = new Date(d);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const avgSizes = sortedDates.map(d => {
      const arr = dailySizes[d];
      return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 100) / 100;
    });
    const maxSizes = sortedDates.map(d => Math.max(...dailySizes[d]));

    Charts.createLineChart('sizeTrendChart', {
      data: {
        labels,
        datasets: [
          {
            label: 'Avg Size (KB)',
            data: avgSizes,
            borderColor: Charts.COLORS.purple,
            backgroundColor: Charts.COLORS.purpleFaded,
            fill: true,
            tension: 0.3,
            pointRadius: 2
          },
          {
            label: 'Max Size (KB)',
            data: maxSizes,
            borderColor: Charts.COLORS.yellow,
            borderDash: [5, 5],
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0
          }
        ]
      },
      options: {
        scales: {
          y: {
            title: { display: true, text: 'File Size (KB)' },
            beginAtZero: true
          }
        }
      }
    });
  }

  function renderInsights(data) {
    const el = document.getElementById('trendInsights');
    if (!el) return;

    let text = '';
    const trend = data.trend;

    text += `Workflow: ${data.workflow_id}\n`;
    text += `Period: ${trend.days} days of data\n\n`;

    if (trend.data && trend.data.length > 0) {
      // Calculate overall timing stats
      const allAvg = trend.data.map(d => d.avg);
      const overallAvg = allAvg.reduce((s, v) => s + v, 0) / allAvg.length;
      const overallEarliest = Math.min(...trend.data.map(d => d.earliest));
      const overallLatest = Math.max(...trend.data.map(d => d.latest));

      text += `Arrival Timing Pattern:\n`;
      text += `  • Average arrival: ${formatHour(overallAvg)}\n`;
      text += `  • Earliest ever: ${formatHour(overallEarliest)}\n`;
      text += `  • Latest ever: ${formatHour(overallLatest)}\n`;
      text += `  • Typical window: ${formatHour(overallEarliest)} — ${formatHour(overallLatest)}\n\n`;

      // Detect if timing is consistent or varies
      const stdDev = Math.sqrt(allAvg.reduce((s, v) => s + Math.pow(v - overallAvg, 2), 0) / allAvg.length);
      if (stdDev < 1) {
        text += `✅ Timing is consistent (±${Math.round(stdDev * 60)} min variation)\n`;
      } else if (stdDev < 3) {
        text += `⚠️ Moderate timing variation (±${Math.round(stdDev * 60)} min)\n`;
      } else {
        text += `🔴 High timing variation (±${Math.round(stdDev * 60)} min) — investigate\n`;
      }

      // Total docs per day
      const totalDocs = trend.data.reduce((s, d) => s + d.count, 0);
      const avgPerDay = Math.round(totalDocs / trend.data.length);
      text += `\nVolume: ${totalDocs.toLocaleString()} docs total, ~${avgPerDay.toLocaleString()}/day\n`;
    }

    if (data.sizes && data.sizes.length > 0) {
      const allSizes = data.sizes.map(s => s.size_kb).filter(Boolean);
      if (allSizes.length > 0) {
        const avgSize = Math.round(allSizes.reduce((s, v) => s + v, 0) / allSizes.length * 100) / 100;
        text += `\nFile Sizes: avg ${avgSize.toLocaleString()} KB, max ${Math.max(...allSizes).toLocaleString()} KB\n`;
      }
    }

    el.textContent = text;
  }

  function formatHour(decimal) {
    const h = Math.floor(decimal);
    const m = Math.round((decimal - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  return { load };
})();
