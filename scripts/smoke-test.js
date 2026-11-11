#!/usr/bin/env node
/**
 * Smoke test — the minimal "does it actually run?" check used by CI.
 *
 * Boots the real server as a child process in CSV mode (so it never touches a
 * production database), waits for it to come up, then asserts that:
 *   1. GET /api/status returns 200 with a connected status and some records.
 *   2. GET / (the dashboard) returns 200 HTML.
 *   3. GET /api/workflows returns an array.
 *
 * Exits 0 on success, non-zero on any failure (fails the CI job). Always tears
 * the server down, even on error.
 *
 * Run locally:  npm run smoke
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = process.env.SMOKE_PORT || '3999';
const BASE = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 60000;   // generous: CSV parse of large sample files
const POLL_INTERVAL_MS = 1000;

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + pathname, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await get('/api/status');
      if (res.status === 200) return JSON.parse(res.body);
    } catch (_) { /* not up yet */ }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Server did not respond on ${BASE} within ${BOOT_TIMEOUT_MS}ms`);
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ✓ ' + msg);
}

(async () => {
  console.log(`[smoke] booting server on :${PORT} in CSV mode …`);
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    // Always use the tracked, fictional sample data so the result is the same locally and in CI.
    env: { ...process.env, PORT, TREND_SOURCE: 'csv', NODE_ENV: 'test', TREND_CSV_DIR: process.env.TREND_CSV_DIR || 'data/Trenddata/sample' },
    stdio: ['ignore', 'inherit', 'inherit']
  });

  let failed = null;
  try {
    const status = await waitForServer(Date.now() + BOOT_TIMEOUT_MS);
    console.log('[smoke] server is up — running assertions');

    assert(status && status.status === 'connected', '/api/status is connected');
    assert(typeof status.totalRecords === 'number', '/api/status reports a record count');
    assert(status.totalRecords > 0, `/api/status has records (${status.totalRecords})`);

    const home = await get('/');
    assert(home.status === 200, 'GET / returns 200');
    assert(/<html/i.test(home.body), 'GET / returns HTML');

    const wf = await get('/api/workflows');
    assert(wf.status === 200, 'GET /api/workflows returns 200');
    assert(Array.isArray(JSON.parse(wf.body)), '/api/workflows returns an array');

    console.log('[smoke] PASS');
  } catch (err) {
    failed = err;
    console.error('[smoke] FAIL:', err.message);
  } finally {
    // Terminate the server child process.
    try { server.kill('SIGTERM'); } catch (_) {}
    await sleep(500);
    try { if (!server.killed) server.kill('SIGKILL'); } catch (_) {}
  }

  process.exit(failed ? 1 : 0);
})();
