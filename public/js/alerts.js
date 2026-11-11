// DM Monitoring Dashboard — Alerts Tab (Missing-File Alerts)
// Master-detail: list of workflows missing today's files, click to view profile,
// and update status (Review / Resolved / Ignore). Review simulates a client email
// and re-surfaces the alert after the configured window if the file is still missing.

const Alerts = (() => {
  let currentStatus = '';
  let selectedId = null;
  let reAlertMinutes = 30;
  let initialized = false;

  async function load() {
    if (!initialized) {
      initControls();
      initialized = true;
    }
    await fetchAlerts();
  }

  function initControls() {
    document.querySelectorAll('.ma-filter-tabs .btn-sm').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ma-filter-tabs .btn-sm').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentStatus = btn.dataset.status;
        fetchAlerts();
      });
    });

    // Email draft modal buttons
    const sendBtn = document.getElementById('emailSendBtn');
    const cancelBtn = document.getElementById('emailCancelBtn');
    if (sendBtn) sendBtn.addEventListener('click', sendEmailDraft);
    if (cancelBtn) cancelBtn.addEventListener('click', closeEmailDraft);
  }

  async function fetchAlerts() {
    try {
      const query = currentStatus ? `missing-alerts?status=${currentStatus}` : 'missing-alerts';
      const data = await App.api(query);
      reAlertMinutes = data.reAlertMinutes || 30;
      renderSummary(data.summary);

      let alerts = data.alerts;
      // Default ("All") view = only alerts still needing attention.
      // Resolved / Ignored are hidden here (still viewable via their own filter tabs).
      if (!currentStatus) {
        alerts = alerts.filter(a => a.status === 'new' || a.status === 'review');
      }
      renderList(alerts);
    } catch (err) {
      console.error('Missing-file alerts load error:', err);
    }
  }

  function renderSummary(s) {
    const el = document.getElementById('maSummary');
    if (!el || !s) return;
    el.innerHTML = `
      <div class="ma-stat ma-stat-red"><div class="ma-stat-value">${s.active}</div><div class="ma-stat-label">Active</div></div>
      <div class="ma-stat ma-stat-blue"><div class="ma-stat-value">${s.inReview}</div><div class="ma-stat-label">In Review</div></div>
      <div class="ma-stat ma-stat-green"><div class="ma-stat-value">${s.resolved}</div><div class="ma-stat-label">Resolved</div></div>
      <div class="ma-stat ma-stat-gray"><div class="ma-stat-value">${s.ignored}</div><div class="ma-stat-label">Ignored</div></div>
      <div class="ma-stat"><div class="ma-stat-value">${s.total}</div><div class="ma-stat-label">Total</div></div>
    `;
  }

  function statusBadge(status) {
    const map = {
      new: '<span class="ma-badge ma-badge-new">🔴 Active</span>',
      review: '<span class="ma-badge ma-badge-review">📧 In Review</span>',
      resolved: '<span class="ma-badge ma-badge-resolved">✅ Resolved</span>',
      ignored: '<span class="ma-badge ma-badge-ignored">🚫 Ignored</span>'
    };
    return map[status] || status;
  }

  function shortName(wf) {
    // Display the raw WORKFLOWID exactly as it appears in the CSV
    return wf;
  }

  function renderList(alerts) {
    const container = document.getElementById('maList');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
      container.innerHTML = `
        <div class="ma-allclear">
          <div class="ma-allclear-icon">✅</div>
          <div class="ma-allclear-title">All clear</div>
          <div class="ma-allclear-sub">No workflows are missing files${currentStatus ? ' in this view' : ' today'}.</div>
        </div>`;
      // Clear detail if the selected alert is gone
      if (!alerts.find || alerts.length === 0) clearDetailIfMissing(alerts);
      return;
    }

    container.innerHTML = alerts.map(a => `
      <div class="ma-item ${a.status} ${a.id === selectedId ? 'selected' : ''}" data-id="${a.id}">
        <div class="ma-item-top">
          <span class="ma-item-title">${shortName(a.workflow_id)}</span>
          ${statusBadge(a.status)}
        </div>
        <div class="ma-item-sub">Last received: ${a.lastReceived} · overdue ${a.overdue}</div>
        ${a.reAlerted ? '<div class="ma-item-realert">⏰ Re-alerted — still missing after review window</div>' : ''}
      </div>
    `).join('');

    container.querySelectorAll('.ma-item').forEach(item => {
      item.addEventListener('click', () => selectAlert(item.dataset.id));
    });

    // Keep a selection visible if one exists
    if (selectedId && alerts.find(a => a.id === selectedId)) {
      showDetail(alerts.find(a => a.id === selectedId));
    }
  }

  function clearDetailIfMissing(alerts) {
    if (selectedId && (!alerts || !alerts.find || !alerts.find(a => a.id === selectedId))) {
      selectedId = null;
      const d = document.getElementById('maDetail');
      if (d) d.innerHTML = '<p class="ma-placeholder">Select an alert on the left to view its details.</p>';
    }
  }

  async function selectAlert(id) {
    selectedId = id;
    document.querySelectorAll('.ma-item').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
    try {
      const alert = await App.api(`missing-alerts/${encodeURIComponent(id)}`);
      showDetail(alert);
    } catch (err) {
      console.error('Alert detail error:', err);
    }
  }

  function showDetail(a) {
    const el = document.getElementById('maDetail');
    if (!el || !a) return;
    const p = a.profile || {};

    let emailLine = '';
    if (a.status === 'review' && a.emailSentAt) {
      emailLine = `<div class="ma-review-note">📧 Client notified at ${App.formatDateTime(a.emailSentAt)}. Will re-alert after ${reAlertMinutes} min if still missing.</div>`;
    }
    if (a.reAlerted) {
      emailLine += `<div class="ma-realert-note">⏰ The review window elapsed and the file is still missing — this alert is active again.</div>`;
    }

    el.innerHTML = `
      <div class="ma-detail-head">
        <div class="ma-detail-title">${a.workflow_id}</div>
        ${statusBadge(a.status)}
      </div>
      <div class="ma-detail-msg">${a.message}</div>
      ${emailLine}

      <h4 class="ma-section-title">Expectation vs Reality</h4>
      <div class="ma-metrics">
        <div class="ma-metric"><div class="ma-metric-label">Expected files today</div><div class="ma-metric-value">~${p.avgPerDay}</div><div class="ma-metric-sub">avg per day</div></div>
        <div class="ma-metric"><div class="ma-metric-label">Received today</div><div class="ma-metric-value">0</div><div class="ma-metric-sub">on ${a.currentDay}</div></div>
        <div class="ma-metric"><div class="ma-metric-label">Usually arrives by</div><div class="ma-metric-value">${p.avgFirstArrivalLabel}</div><div class="ma-metric-sub">first file of the day</div></div>
        <div class="ma-metric"><div class="ma-metric-label">Latest arrival</div><div class="ma-metric-value">${p.latestFirstArrivalLabel || '—'}</div><div class="ma-metric-sub">worst-case first file</div></div>
        <div class="ma-metric"><div class="ma-metric-label">Avg file size</div><div class="ma-metric-value">${(p.avgSizeKb || 0).toLocaleString()} KB</div><div class="ma-metric-sub">historical</div></div>
        <div class="ma-metric"><div class="ma-metric-label">Daily range</div><div class="ma-metric-value">${p.minPerDay}–${p.maxPerDay}</div><div class="ma-metric-sub">files/day (min–max)</div></div>
        <div class="ma-metric"><div class="ma-metric-label">Last received</div><div class="ma-metric-value">${a.overdue}</div><div class="ma-metric-sub">ago (${a.lastReceived})</div></div>
      </div>

      <h4 class="ma-section-title">Pattern</h4>
      <div class="ma-pattern">
        <div>Active days observed: <strong>${p.activeDays}</strong> (from ${p.firstSeen} to ${p.lastSeen})</div>
        <div>Busiest day: <strong>${p.busiestDay}</strong> · Quietest day: <strong>${p.quietestDay}</strong></div>
      </div>

      <h4 class="ma-section-title">Actions</h4>
      <div class="ma-actions">
        <button class="ma-btn ma-btn-review" data-action="review" ${a.status === 'review' ? 'disabled' : ''}>📧 Send Alert Email</button>
        <button class="ma-btn ma-btn-resolve" data-action="resolved" ${a.status === 'resolved' ? 'disabled' : ''}>✅ Resolve</button>
        <button class="ma-btn ma-btn-ignore" data-action="ignored" ${a.status === 'ignored' ? 'disabled' : ''}>🚫 Ignore</button>
        ${(a.status === 'resolved' || a.status === 'ignored') ? '<button class="ma-btn ma-btn-reopen" data-action="new">↩ Reopen</button>' : ''}
      </div>
      ${a.status === 'review' ? '<div class="ma-devtools"><button class="ma-btn ma-btn-dev" data-action="expire">⏩ (Test) Simulate 30 min passing</button></div>' : ''}
    `;

    el.querySelectorAll('.ma-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'review') {
          openEmailDraft(a); // show draft first, send on confirm
        } else {
          handleAction(a.id, btn.dataset.action);
        }
      });
    });
  }

  // Fetch the admin-configured email draft from the backend and show it in a modal.
  async function openEmailDraft(a) {
    const modal = document.getElementById('emailModal');
    modal.dataset.alertId = a.id;
    // Show modal immediately with a loading state
    document.getElementById('emailTo').value = '';
    document.getElementById('emailSubject').value = '';
    document.getElementById('emailBody').value = 'Loading draft...';
    modal.style.display = 'flex';
    try {
      const draft = await App.api(`missing-alerts/${encodeURIComponent(a.id)}/draft`);
      document.getElementById('emailTo').value = draft.to || '';
      document.getElementById('emailSubject').value = draft.subject || '';
      document.getElementById('emailBody').value = draft.body || '';
    } catch (err) {
      document.getElementById('emailBody').value = 'Could not load the email draft.';
    }
  }

  function closeEmailDraft() {
    const modal = document.getElementById('emailModal');
    if (modal) modal.style.display = 'none';
  }

  async function sendEmailDraft() {
    const modal = document.getElementById('emailModal');
    const id = modal.dataset.alertId;
    const to = document.getElementById('emailTo').value.trim();
    const subject = document.getElementById('emailSubject').value;
    const body = document.getElementById('emailBody').value;

    const sendBtn = document.getElementById('emailSendBtn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }

    try {
      const res = await fetch(`/api/missing-alerts/${encodeURIComponent(id)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body })
      });
      const data = await res.json();
      if (data.ok) {
        closeEmailDraft();
        if (App.toast) App.toast('📧 Email sent to ' + (data.sentTo || to));
        window.location.reload(); // refresh list/badge/detail (alert now In Review)
      } else {
        // Sending failed — keep the modal open and show why.
        if (App.toast) App.toast('✗ ' + (data.error || 'Failed to send email'));
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
      }
    } catch (err) {
      if (App.toast) App.toast('✗ Could not reach the server.');
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
    }
  }

  async function handleAction(id, action) {
    try {
      if (action === 'expire') {
        await fetch(`/api/missing-alerts/${encodeURIComponent(id)}/expire-review`, { method: 'POST' });
      } else {
        await fetch(`/api/missing-alerts/${encodeURIComponent(id)}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: action })
        });
      }
      // Reload the whole page so the alert list, badge, and detail all reset cleanly.
      window.location.reload();
    } catch (err) {
      console.error('Alert action error:', err);
    }
  }

  return { load };
})();
