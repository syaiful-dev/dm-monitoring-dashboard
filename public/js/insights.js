// DM Monitoring Dashboard — Analysis Tab
// Workflow File Trend Analysis (per-workflow dropdown) + AI Summary

const Insights = (() => {
  let analysisData = [];
  let loaded = false;
  let pendingWorkflow = null; // a workflow requested before data arrived

  // Load the per-workflow analysis dataset once. Optionally render a workflow
  // immediately (or the one queued via show() before data was ready).
  async function load() {
    try {
      if (!loaded) {
        analysisData = await App.api('workflow-analysis');
        loaded = true;
      }
      // Render whatever workflow is currently requested (set by show()).
      renderFor(pendingWorkflow);
    } catch (err) {
      console.error('Analysis load error:', err);
    }
  }

  // Called by the Trends tab when the top workflow selector changes.
  // workflowId may be 'ALL' or a specific WORKFLOWID.
  function show(workflowId) {
    pendingWorkflow = workflowId;
    if (loaded) renderFor(workflowId);
    // if not loaded yet, load() will pick it up from pendingWorkflow
  }

  function renderFor(workflowId) {
    const el = document.getElementById('workflowAnalysis');
    if (!el) return;

    // "All Workflows" has no single per-workflow analysis — prompt to pick one.
    if (!workflowId || workflowId === 'ALL') {
      el.innerHTML = '<div class="wf-analysis-empty">Select a specific workflow in the selector above to see its file-trend analysis.</div>';
      return;
    }

    const wf = analysisData.find(a => a.workflow_id === workflowId);
    if (!wf) {
      el.innerHTML = '<div class="wf-analysis-empty">No analysis available for this workflow in the current snapshot window.</div>';
      return;
    }
    renderWorkflowAnalysis(wf);
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

  // ============ Utilities ============

  function formatHour(decimal) {
    if (decimal == null) return '—';
    const h = Math.floor(decimal);
    const m = Math.round((decimal - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  return { load, show };
})();
