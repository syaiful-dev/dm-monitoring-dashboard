// DM Monitoring Dashboard — AI Insights Tab
// Workflow Analysis, SLA Compliance, Week-over-Week, Health Heatmap, Trading Partners

const Insights = (() => {
  let analysisData = [];
  let initialized = false;

  async function load() {
    try {
      const [analysis, summary, sla, wow, heatmap, partners] = await Promise.all([
        App.api('workflow-analysis'),
        App.api('summary'),
        App.api('sla-compliance'),
        App.api('week-over-week'),
        App.api('health-heatmap?days=14'),
        App.api('trading-partners')
      ]);

      analysisData = analysis;

      if (!initialized) {
        initWorkflowSelector(analysis);
        initialized = true;
      }

      if (analysis.length > 0) {
        renderWorkflowAnalysis(analysis[0]);
      }

      renderSummary(summary);
      renderSlaCompliance(sla);
      renderWeekOverWeek(wow);
      renderHealthHeatmap(heatmap);
      renderTradingPartners(partners);
    } catch (err) {
      console.error('Insights load error:', err);
    }
  }

  // ============ Workflow Analysis (dropdown) ============

  function initWorkflowSelector(analysis) {
    const select = document.getElementById('analysisWorkflowSelect');
    if (!select) return;

    select.innerHTML = analysis.map((wf, i) =>
      `<option value="${i}">${wf.workflow_id}</option>`
    ).join('');

    select.addEventListener('change', () => {
      const idx = parseInt(select.value, 10);
      if (analysisData[idx]) {
        renderWorkflowAnalysis(analysisData[idx]);
      }
    });
  }

  function renderWorkflowAnalysis(wf) {
    const el = document.getElementById('workflowAnalysis');
    if (!el || !wf) return;

    el.innerHTML = `
      <div class="workflow-analysis-card">
        <div class="wf-analysis-header">
          <span class="wf-analysis-meta">${wf.totalRecords.toLocaleString()} docs · ${wf.totalDays} days · ${wf.dateRange.from} to ${wf.dateRange.to}</span>
        </div>
        <div class="wf-analysis-grid">
          <div class="wf-stat">
            <div class="wf-stat-label">Files Start Coming In</div>
            <div class="wf-stat-value">${wf.avgFirstArrival != null ? formatHour(wf.avgFirstArrival) : '—'}</div>
            <div class="wf-stat-sub">avg first arrival daily</div>
          </div>
          <div class="wf-stat">
            <div class="wf-stat-label">Avg Files/Day</div>
            <div class="wf-stat-value">${wf.avgDailyCount.toLocaleString()}</div>
            <div class="wf-stat-sub">documents received daily</div>
          </div>
          <div class="wf-stat">
            <div class="wf-stat-label">Avg File Size</div>
            <div class="wf-stat-value">${wf.avgSizeKb.toLocaleString()} KB</div>
            <div class="wf-stat-sub">range: ${wf.sizeRange.min} — ${wf.sizeRange.max.toLocaleString()} KB</div>
          </div>
          <div class="wf-stat">
            <div class="wf-stat-label">Peak Day</div>
            <div class="wf-stat-value">${wf.peakDate.date || '—'}</div>
            <div class="wf-stat-sub">${wf.peakDate.count.toLocaleString()} files received</div>
          </div>
          <div class="wf-stat">
            <div class="wf-stat-label">Quietest Day</div>
            <div class="wf-stat-value">${wf.quietDate.date || '—'}</div>
            <div class="wf-stat-sub">${wf.quietDate.count.toLocaleString()} files received</div>
          </div>
          <div class="wf-stat">
            <div class="wf-stat-label">Peak Hours (80%)</div>
            <div class="wf-stat-value">${wf.peakHours.start != null ? formatHour(wf.peakHours.start) + ' — ' + formatHour(wf.peakHours.end) : '—'}</div>
            <div class="wf-stat-sub">most files arrive in this window</div>
          </div>
          <div class="wf-stat">
            <div class="wf-stat-label">Busiest Day of Week</div>
            <div class="wf-stat-value">${wf.busiestDayOfWeek ? wf.busiestDayOfWeek.day : '—'}</div>
            <div class="wf-stat-sub">${wf.busiestDayOfWeek ? wf.busiestDayOfWeek.count.toLocaleString() + ' total files' : ''}</div>
          </div>
          <div class="wf-stat">
            <div class="wf-stat-label">Quietest Day of Week</div>
            <div class="wf-stat-value">${wf.quietestDayOfWeek ? wf.quietestDayOfWeek.day : '—'}</div>
            <div class="wf-stat-sub">${wf.quietestDayOfWeek ? wf.quietestDayOfWeek.count.toLocaleString() + ' total files' : ''}</div>
          </div>
          <div class="wf-stat">
            <div class="wf-stat-label">Error Rate</div>
            <div class="wf-stat-value ${wf.errorRate > 0.5 ? 'wf-stat-danger' : wf.errorRate > 0 ? 'wf-stat-warn' : 'wf-stat-good'}">${wf.errorRate}%</div>
            <div class="wf-stat-sub">${wf.errors} error(s) out of ${wf.totalRecords.toLocaleString()}</div>
          </div>
        </div>
        <div class="wf-analysis-status">
          <span class="wf-status-label">Status:</span>
          ${wf.statusDistribution.map(s => `<span class="badge badge-sm">${s.status} (${s.percentage}%)</span>`).join(' ')}
        </div>
      </div>
    `;
  }

  // ============ AI Summary ============

  function renderSummary(data) {
    const el = document.getElementById('weeklySummary');
    if (!el) return;
    el.textContent = data.summary || 'No summary available.';
  }

  // ============ SLA Compliance ============

  function renderSlaCompliance(data) {
    const el = document.getElementById('slaCompliance');
    if (!el || !data || data.length === 0) return;

    el.innerHTML = `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Workflow</th>
              <th>SLA Window</th>
              <th>Compliance</th>
              <th>Days Tracked</th>
              <th>Days Missed</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(wf => {
              const compColor = wf.compliance >= 90 ? 'var(--accent-green)' : wf.compliance >= 75 ? 'var(--accent-yellow)' : 'var(--accent-red)';
              return `
                <tr>
                  <td title="${wf.workflow_id}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${wf.workflow_id}</td>
                  <td>${wf.slaWindow ? formatHour(wf.slaWindow.start) + ' — ' + formatHour(wf.slaWindow.end) : '—'}</td>
                  <td style="color:${compColor};font-weight:600;">${wf.compliance}%</td>
                  <td>${wf.totalDays}</td>
                  <td>${wf.missedDays.length > 0 ? `<span style="color:var(--accent-red)">${wf.missedDays.length} day(s)</span>` : '<span style="color:var(--accent-green)">None</span>'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:0.75rem;color:var(--text-secondary);margin-top:8px;">SLA window is auto-calculated from historical 10th–90th percentile arrival times.</p>
    `;
  }

  // ============ Week-over-Week ============

  function renderWeekOverWeek(data) {
    const el = document.getElementById('weekOverWeek');
    if (!el || !data || data.length === 0) return;

    el.innerHTML = `
      <p style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:12px;">
        Current: ${data[0].period.current} vs Previous: ${data[0].period.previous}
      </p>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Volume Change</th>
              <th>Timing Shift</th>
              <th>Current Docs</th>
              <th>Previous Docs</th>
              <th>Errors (Now/Prev)</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(wf => {
              const volColor = wf.volume.change > 10 ? 'var(--accent-green)' : wf.volume.change < -10 ? 'var(--accent-red)' : 'var(--text-primary)';
              const volArrow = wf.volume.change > 0 ? '↑' : wf.volume.change < 0 ? '↓' : '→';
              const timeColor = Math.abs(wf.timing.shiftMinutes || 0) > 30 ? 'var(--accent-yellow)' : 'var(--text-primary)';
              const timeArrow = (wf.timing.shiftMinutes || 0) > 0 ? '↑ later' : (wf.timing.shiftMinutes || 0) < 0 ? '↓ earlier' : '→ same';

              return `
                <tr>
                  <td title="${wf.workflow_id}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${wf.workflow_id}</td>
                  <td style="color:${volColor};font-weight:600;">${volArrow} ${wf.volume.change > 0 ? '+' : ''}${wf.volume.change}%</td>
                  <td style="color:${timeColor};">${wf.timing.shiftMinutes != null ? (wf.timing.shiftMinutes > 0 ? '+' : '') + wf.timing.shiftMinutes + ' min ' + timeArrow : '—'}</td>
                  <td>${wf.volume.current.toLocaleString()}</td>
                  <td>${wf.volume.previous.toLocaleString()}</td>
                  <td>${wf.errors.current} / ${wf.errors.previous}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ============ Health Heatmap ============

  function renderHealthHeatmap(data) {
    const el = document.getElementById('healthHeatmap');
    if (!el || !data || !data.workflows || data.workflows.length === 0) return;

    const healthColors = {
      0: '#37474f', // no data — gray
      1: '#f44336', // errors — red
      2: '#ff9800', // below avg — yellow
      3: '#4caf50'  // normal — green
    };

    const healthLabels = {
      0: 'No data',
      1: 'Errors',
      2: 'Low volume',
      3: 'Normal'
    };

    // Short date labels
    const dateLabels = data.dates.map(d => {
      const date = new Date(d);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    let html = `
      <div class="heatmap-legend" style="display:flex;gap:12px;margin-bottom:12px;font-size:0.75rem;">
        ${Object.entries(healthColors).map(([k, v]) => `
          <span style="display:flex;align-items:center;gap:4px;">
            <span style="width:12px;height:12px;border-radius:2px;background:${v};display:inline-block;"></span>
            ${healthLabels[k]}
          </span>
        `).join('')}
      </div>
      <table class="heatmap-table" style="border-collapse:collapse;width:100%;">
        <thead>
          <tr>
            <th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:var(--text-secondary);min-width:180px;">Workflow</th>
            ${dateLabels.map(d => `<th style="padding:4px 2px;font-size:0.65rem;color:var(--text-secondary);text-align:center;writing-mode:vertical-rl;height:60px;">${d}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.workflows.map((wf, wi) => `
            <tr>
              <td style="padding:4px 8px;font-size:0.75rem;color:var(--text-primary);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${wf}">${wf.replace(/^ORDERS_/, '').replace(/_PDF_/, '_')}</td>
              ${data.data[wi].map(cell => `
                <td style="padding:2px;">
                  <div title="${cell.date}: ${cell.count} docs${cell.errors > 0 ? ', ' + cell.errors + ' errors' : ''}" style="width:20px;height:20px;border-radius:3px;background:${healthColors[cell.health]};margin:auto;cursor:default;"></div>
                </td>
              `).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    el.innerHTML = html;
  }

  // ============ Trading Partners ============

  function renderTradingPartners(data) {
    const el = document.getElementById('tradingPartners');
    if (!el || !data || data.length === 0) return;

    el.innerHTML = `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Sender</th>
              <th>Receiver</th>
              <th>Total Docs</th>
              <th>Last Active</th>
              <th>Days Since Active</th>
              <th>Last 7 Days</th>
              <th>Gaps (Weekdays)</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(p => {
              const gapColor = p.gaps > 5 ? 'var(--accent-red)' : p.gaps > 0 ? 'var(--accent-yellow)' : 'var(--accent-green)';
              const activeColor = p.daysSinceActive > 3 ? 'var(--accent-red)' : p.daysSinceActive > 1 ? 'var(--accent-yellow)' : 'var(--text-primary)';

              return `
                <tr>
                  <td><strong>${p.sender}</strong></td>
                  <td><strong>${p.receiver}</strong></td>
                  <td>${p.totalDocs.toLocaleString()}</td>
                  <td>${p.lastActive || '—'}</td>
                  <td style="color:${activeColor};">${p.daysSinceActive != null ? p.daysSinceActive + 'd' : '—'}</td>
                  <td>${p.recentDocs.toLocaleString()}</td>
                  <td style="color:${gapColor};">${p.gaps}${p.recentGaps.length > 0 ? ' <span title="' + p.recentGaps.join(', ') + '" style="cursor:help;">ⓘ</span>' : ''}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:0.75rem;color:var(--text-secondary);margin-top:8px;">Gaps = weekdays (Mon–Fri) with zero documents within the active date range.</p>
    `;
  }

  // ============ Utilities ============

  function formatHour(decimal) {
    if (decimal == null) return '—';
    const h = Math.floor(decimal);
    const m = Math.round((decimal - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  return { load };
})();
