// DM Monitoring Dashboard — API Tests
// Basic smoke tests for core endpoints

const http = require('http');

const BASE_URL = 'http://localhost:3000';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Test runner
async function runTests() {
  const results = [];
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      results.push(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      results.push(`  ✗ ${name}: ${err.message}`);
    }
  }

  function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
  }

  console.log('\n🧪 Running API Tests...\n');

  // --- System ---
  await test('GET /api/status returns provider info', async () => {
    const res = await get('/api/status');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.provider === 'json', 'Expected json provider');
    assert(typeof res.body.uptime === 'number', 'Expected uptime number');
  });

  // --- Overview ---
  await test('GET /api/overview returns KPI data', async () => {
    const res = await get('/api/overview');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(typeof res.body.totalWorkflows === 'number', 'Expected totalWorkflows');
    assert(typeof res.body.onTimePercent === 'number', 'Expected onTimePercent');
    assert(Array.isArray(res.body.todayRecords), 'Expected todayRecords array');
  });

  // --- Workflows ---
  await test('GET /api/workflows returns array', async () => {
    const res = await get('/api/workflows');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body), 'Expected array');
    assert(res.body.length > 0, 'Expected at least 1 workflow');
    assert(res.body[0].name, 'Expected workflow name');
  });

  // --- Files ---
  await test('GET /api/files returns paginated records', async () => {
    const res = await get('/api/files?page=1&limit=5');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body.records), 'Expected records array');
    assert(typeof res.body.total === 'number', 'Expected total count');
    assert(typeof res.body.pages === 'number', 'Expected pages count');
  });

  await test('GET /api/files with workflow_id filter', async () => {
    const res = await get('/api/files?workflow_id=1&limit=5');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    res.body.records.forEach(r => {
      assert(r.workflow_id === 1, `Expected workflow_id 1, got ${r.workflow_id}`);
    });
  });

  // --- Alerts ---
  await test('GET /api/alerts returns array', async () => {
    const res = await get('/api/alerts');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body), 'Expected array');
  });

  await test('GET /api/alerts with severity filter', async () => {
    const res = await get('/api/alerts?severity=critical');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    res.body.forEach(a => {
      assert(a.severity === 'critical', `Expected critical, got ${a.severity}`);
    });
  });

  // --- Trends ---
  await test('GET /api/trends/:id returns trend data', async () => {
    const res = await get('/api/trends/1?days=14');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.workflow, 'Expected workflow info');
    assert(Array.isArray(res.body.arrivals), 'Expected arrivals array');
    assert(Array.isArray(res.body.sizes), 'Expected sizes array');
  });

  // --- Anomalies ---
  await test('GET /api/anomalies returns array', async () => {
    const res = await get('/api/anomalies');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body), 'Expected array');
  });

  // --- Reliability ---
  await test('GET /api/reliability returns scores', async () => {
    const res = await get('/api/reliability');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body), 'Expected array');
    if (res.body.length > 0) {
      assert(typeof res.body[0].reliability_score === 'number', 'Expected reliability_score');
    }
  });

  // --- Summary ---
  await test('GET /api/summary returns AI summary', async () => {
    const res = await get('/api/summary');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(typeof res.body.summary === 'string', 'Expected summary string');
    assert(res.body.metrics, 'Expected metrics object');
  });

  // --- Predictions ---
  await test('GET /api/predictions returns array', async () => {
    const res = await get('/api/predictions');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body), 'Expected array');
  });

  // --- Chatbot ---
  await test('POST /api/chat responds to help', async () => {
    const res = await post('/api/chat', { message: 'help' });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(typeof res.body.reply === 'string', 'Expected reply string');
    assert(Array.isArray(res.body.suggestions), 'Expected suggestions array');
  });

  await test('POST /api/chat responds to status query', async () => {
    const res = await post('/api/chat', { message: "What's the status today?" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.reply.length > 0, 'Expected non-empty reply');
  });

  await test('POST /api/chat rejects empty message', async () => {
    const res = await post('/api/chat', { message: '' });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  // --- Results ---
  console.log(results.join('\n'));
  console.log(`\n  Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
