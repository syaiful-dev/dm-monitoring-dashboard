// Admin Routes — configuration API (gated by requireAuth in server.js)
const express = require('express');
const router = express.Router();
const settingsService = require('../services/settingsService');

// GET /api/admin/settings — current settings
router.get('/settings', (req, res) => {
  res.json(settingsService.getAll());
});

// PUT /api/admin/settings — update settings
router.put('/settings', (req, res) => {
  try {
    const updated = settingsService.update(req.body || {});
    res.json({ ok: true, settings: updated });
  } catch (err) {
    console.error('Admin settings update error:', err);
    res.status(500).json({ ok: false, error: 'Failed to save settings' });
  }
});

// GET /api/admin/connections — list configured MSSQL connections (no passwords)
router.get('/connections', (req, res) => {
  const trendSource = require('../config/trendSource');
  const list = trendSource.connections.map((c, i) => ({
    index: i,
    name: c.name,
    client: c.client || 'mssql',
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.user,
    enabled: c.enabled,
    configured: !!(c.host && c.database && c.user)
  }));
  res.json({ source: trendSource.source, connections: list });
});

// POST /api/admin/test-db — connection-only test (SELECT 1). Optional body { index }.
// Without an index, tests ALL configured connections.
router.post('/test-db', async (req, res) => {
  try {
    const trendSource = require('../config/trendSource');
    const { getProvider } = require('../services/trendProviderFactory');
    const conns = trendSource.connections;

    if (conns.length === 0) {
      return res.json({ ok: false, error: 'No database connections configured. Set TREND_DB1_* in .env.' });
    }

    const idx = req.body && req.body.index != null ? parseInt(req.body.index, 10) : null;

    // Test a single connection by index — uses the connection's own dialect driver.
    if (idx != null) {
      const conn = conns[idx];
      if (!conn) return res.json({ ok: false, error: 'Connection not found.' });
      const t0 = Date.now();
      try {
        await getProvider(conn).testConnection(conn);
        return res.json({ ok: true, name: conn.name, client: conn.client || 'mssql', elapsedMs: Date.now() - t0, message: 'Connection successful (SELECT 1). No data query run.' });
      } catch (err) {
        return res.json({ ok: false, name: conn.name, client: conn.client || 'mssql', error: err.message });
      }
    }

    // Test all connections
    const results = await Promise.all(conns.map(async (conn) => {
      const t0 = Date.now();
      try { await getProvider(conn).testConnection(conn); return { name: conn.name, client: conn.client || 'mssql', ok: true, elapsedMs: Date.now() - t0 }; }
      catch (err) { return { name: conn.name, client: conn.client || 'mssql', ok: false, error: err.message }; }
    }));
    const allOk = results.every(r => r.ok);
    res.json({ ok: allOk, results, message: 'Connection-only test (SELECT 1) — no data query run.' });
  } catch (err) {
    console.error('DB test error:', err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
});

// POST /api/admin/reload-data — re-pull data from the active source (no restart)
router.post('/reload-data', async (req, res) => {
  try {
    const trendDataService = require('../services/trendDataService');
    const records = await trendDataService.reloadData();
    res.json({ ok: true, totalRecords: records.length, workflows: trendDataService.getDistinctWorkflows().length });
  } catch (err) {
    console.error('Reload error:', err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
});

// POST /api/admin/refresh-trend-snapshot — force-rebuild the monthly trend snapshot
// (days 1–14). Normally this happens automatically on the 15th; this is a manual override.
router.post('/refresh-trend-snapshot', async (req, res) => {
  try {
    const trendDataService = require('../services/trendDataService');
    const snapStore = require('../services/trendSnapshotStore');
    const result = await trendDataService.refreshTrendSnapshot();
    const win = snapStore.computeWindow(new Date());
    res.json({ ok: true, rows: result.rows, mode: result.mode, window: win.label });
  } catch (err) {
    console.error('Trend snapshot refresh error:', err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
});

// POST /api/admin/test-smtp — verify the configured SMTP connection/credentials
// without sending a message. Optionally sends a test email if body.to is given.
router.post('/test-smtp', async (req, res) => {
  try {
    const emailService = require('../services/emailService');
    const to = req.body && req.body.to ? String(req.body.to).trim() : '';
    if (to) {
      await emailService.send({
        to,
        subject: 'DM Monitoring — SMTP test',
        body: 'This is a test email from the DM Monitoring Dashboard. If you received it, SMTP is configured correctly.'
      });
      return res.json({ ok: true, message: `Test email sent to ${to}.` });
    }
    await emailService.verify();
    res.json({ ok: true, message: 'SMTP connection verified.' });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
});

// GET /api/admin/trend-snapshot-info — current snapshot window + freshness
router.get('/trend-snapshot-info', (req, res) => {
  try {
    const snapStore = require('../services/trendSnapshotStore');
    const saved = snapStore.read();
    const target = snapStore.computeWindow(new Date());
    res.json({
      ok: true,
      current: saved ? saved.window : null,
      generatedAt: saved ? saved.generatedAt : null,
      rows: saved && saved.rows ? saved.rows.length : 0,
      target: target,
      isCurrent: snapStore.isCurrent(saved, new Date())
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;
