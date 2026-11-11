// API Routes — endpoints for the 3-tab support dashboard (Alerts, Trends, Analysis)
const express = require('express');
const router = express.Router();
const trendDataService = require('../services/trendDataService');
const missingFileAlertService = require('../services/missingFileAlertService');
const alertStateStore = require('../services/alertStateStore');
const settingsService = require('../services/settingsService');
const trendSource = require('../config/trendSource');
const fileDetailsService = require('../services/fileDetailsService');
const requireAuth = require('../middleware/requireAuth');

// GET /api/workflows — Distinct workflow IDs
router.get('/workflows', (req, res) => {
  try {
    res.json(trendDataService.getDistinctWorkflows());
  } catch (err) {
    console.error('Error fetching workflows:', err);
    res.status(500).json({ error: 'Failed to fetch workflows' });
  }
});

// Used by the Trends tab workflow dropdown
router.get('/files/workflows', (req, res) => {
  try {
    res.json(trendDataService.getDistinctWorkflows());
  } catch (err) {
    console.error('Error fetching workflow list:', err);
    res.status(500).json({ error: 'Failed to fetch workflow list' });
  }
});

// ===================== MISSING-FILE ALERTS (Alerts tab) =====================

// GET /api/missing-alerts — list missing-file alerts (optional ?status= filter)
router.get('/missing-alerts', (req, res) => {
  try {
    let alerts = missingFileAlertService.getMissingFileAlerts();
    const { status } = req.query;
    if (status) alerts = alerts.filter(a => a.status === status);
    const summary = missingFileAlertService.getSummary();
    res.json({ alerts, summary, reAlertMinutes: alertStateStore.reAlertMinutes() });
  } catch (err) {
    console.error('Error fetching missing-file alerts:', err);
    res.status(500).json({ error: 'Failed to fetch missing-file alerts' });
  }
});

// GET /api/missing-alerts/:id — full detail for one alert
router.get('/missing-alerts/:id', (req, res) => {
  try {
    const alert = missingFileAlertService.getAlertDetail(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json(alert);
  } catch (err) {
    console.error('Error fetching alert detail:', err);
    res.status(500).json({ error: 'Failed to fetch alert detail' });
  }
});

// GET /api/missing-alerts/:id/draft — email draft rendered from the admin template
router.get('/missing-alerts/:id/draft', (req, res) => {
  try {
    const a = missingFileAlertService.getAlertDetail(req.params.id);
    if (!a) return res.status(404).json({ error: 'Alert not found' });

    const tpl = settingsService.getEmail();
    const p = a.profile || {};
    const buyer = a.workflow_id.replace(/^ORDERS_/, '').split('_')[0];
    const vars = {
      buyer,
      workflow: a.workflow_id,
      expectedDay: a.expectedDay,
      lastReceived: a.lastReceived,
      avgPerDay: p.avgPerDay != null ? p.avgPerDay : '—',
      avgFirstArrival: p.avgFirstArrivalLabel || '—'
    };
    const fill = (str) => String(str || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

    // Per-workflow recipient (falls back to the general template recipient)
    const recipient = settingsService.getRecipientFor(a.workflow_id);

    res.json({
      to: fill(recipient),
      subject: fill(tpl.subject),
      body: fill(tpl.body)
    });
  } catch (err) {
    console.error('Error building draft:', err);
    res.status(500).json({ error: 'Failed to build email draft' });
  }
});

// POST /api/missing-alerts/:id/send — actually send the alert email via SMTP,
// then mark the alert "In Review". Body: { to, subject, body } (operator-edited).
router.post('/missing-alerts/:id/send', async (req, res) => {
  try {
    const a = missingFileAlertService.getAlertDetail(req.params.id);
    if (!a) return res.status(404).json({ error: 'Alert not found' });

    const emailService = require('../services/emailService');
    const { to, subject, body } = req.body || {};

    await emailService.send({ to, subject, body });

    // Sent OK → move the alert to 'review' (records emailSentAt / reviewUntil).
    const entry = alertStateStore.setStatus(req.params.id, 'review', { note: `Email sent to ${to}` });
    res.json({
      ok: true,
      sentTo: to,
      state: entry,
      reAlertMinutes: alertStateStore.reAlertMinutes()
    });
  } catch (err) {
    console.error('Error sending alert email:', err.message);
    // 200 with ok:false so the frontend can show the real reason inline.
    res.status(200).json({ ok: false, error: err.message });
  }
});

// PUT /api/missing-alerts/:id/status — update status (review | resolved | ignored | new)
router.put('/missing-alerts/:id/status', (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!alertStateStore.VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${alertStateStore.VALID_STATUSES.join(', ')}` });
    }
    const existing = missingFileAlertService.getAlertDetail(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Alert not found' });

    const entry = alertStateStore.setStatus(req.params.id, status, { note });
    const updated = missingFileAlertService.getAlertDetail(req.params.id);
    res.json({
      ok: true,
      state: entry,
      alert: updated,
      emailSimulated: status === 'review',
      reAlertMinutes: alertStateStore.reAlertMinutes()
    });
  } catch (err) {
    console.error('Error updating alert status:', err);
    res.status(500).json({ error: 'Failed to update alert status' });
  }
});

// POST /api/missing-alerts/:id/expire-review — TEST: fast-forward the re-alert window
router.post('/missing-alerts/:id/expire-review', (req, res) => {
  try {
    const ok = alertStateStore.expireReview(req.params.id);
    res.json({ ok, alert: missingFileAlertService.getAlertDetail(req.params.id) });
  } catch (err) {
    console.error('Error expiring review:', err);
    res.status(500).json({ error: 'Failed to expire review' });
  }
});

// ===================== TRENDS =====================

// GET /api/trends/:workflow_id — Trend data for a workflow
router.get('/trends/:workflow_id', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const workflowId = req.params.workflow_id === 'ALL' ? null : req.params.workflow_id;

    res.json({
      workflow_id: workflowId || 'ALL',
      trend: trendDataService.getTrendData(workflowId, days),
      arrivals: trendDataService.getArrivalTimes(workflowId, days),
      sizes: trendDataService.getSizeTrend(workflowId, days)
    });
  } catch (err) {
    console.error('Error fetching trends:', err);
    res.status(500).json({ error: 'Failed to fetch trend data' });
  }
});

// ===================== ANALYSIS =====================

// GET /api/workflow-analysis — Per-workflow file trend analysis
router.get('/workflow-analysis', (req, res) => {
  try {
    res.json(trendDataService.getWorkflowAnalysis());
  } catch (err) {
    console.error('Error generating workflow analysis:', err);
    res.status(500).json({ error: 'Failed to generate workflow analysis' });
  }
});

// GET /api/summary — activity summary
router.get('/summary', (req, res) => {
  try {
    res.json(trendDataService.generateSummary());
  } catch (err) {
    console.error('Error generating summary:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// ===================== AI ASSISTANT (Amazon Quick embed) =====================

// GET /api/assistant/config — whether the Quick agent embed is configured, and its URL
router.get('/assistant/config', (req, res) => {
  const url = (process.env.QUICK_EMBED_URL || '').trim();
  res.json({
    configured: url.length > 0,
    embedUrl: url
  });
});

// ===================== SYSTEM =====================

// GET /api/status — System status
router.get('/status', (req, res) => {
  try {
    const records = trendDataService.loadAllRecords();
    const isDb = trendSource.source === 'db';
    const enabled = trendSource.enabledConnections();

    // Reflect the actual data source in the badge/status.
    let provider, sourceLabel, sourceIcon;
    if (isDb) {
      const count = enabled.length;
      provider = 'MSSQL Database';
      sourceLabel = count > 1 ? `MSSQL (${count} DBs)` : 'MSSQL Database';
      sourceIcon = '🗄️';
    } else {
      provider = 'eHub CSV';
      sourceLabel = 'eHub CSV';
      sourceIcon = '📁';
    }

    res.json({
      provider,
      source: trendSource.source,   // 'db' | 'csv'
      sourceLabel,
      sourceIcon,
      connections: isDb ? enabled.map(c => c.name) : [],
      status: 'connected',
      totalRecords: records.length,
      totalWorkflows: trendDataService.getDistinctWorkflows().length,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// GET /api/trend-window — the current trend snapshot window label (public, read-only).
router.get('/trend-window', (req, res) => {
  try {
    const snapStore = require('../services/trendSnapshotStore');
    const w = snapStore.computeWindow(new Date());
    res.json({ label: w.label, from: w.from, to: w.to, key: w.key });
  } catch (err) {
    res.status(200).json({ label: '' });
  }
});

// ===================== FILE DETAILS =====================

// GET /api/file-details/databases — connection names for the lookup dropdown.
// (Admin session required; read-only, names only, no credentials.)
router.get('/file-details/databases', requireAuth, (req, res) => {
  try {
    const dbs = trendSource.source === 'db'
      ? trendSource.enabledConnections()
          .filter(c => c.host && c.database && c.user)
          .map(c => ({ name: c.name, client: c.client || 'mssql' }))
      : [];
    res.json({ source: trendSource.source, databases: dbs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list databases' });
  }
});

// GET /api/file-details?db=<name>&docid=<id>&workflowid=<id>
// Live, read-only lookup in ONE database. db is required; docid/workflowid optional.
router.get('/file-details', requireAuth, async (req, res) => {
  try {
    const { db, docid, workflowid } = req.query;
    if (!db) return res.status(400).json({ error: 'A database is required.' });
    const data = await fileDetailsService.lookup(String(db), {
      docid: docid != null ? String(docid) : '',
      workflowid: workflowid != null ? String(workflowid) : ''
    });
    res.json(data);
  } catch (err) {
    console.error('File details lookup error:', err.message);
    res.status(200).json({ error: err.message });
  }
});

module.exports = router;
