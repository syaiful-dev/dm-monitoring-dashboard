// Simulation Service — simulates real-time file arrivals in JSON mode
// Pushes updates via WebSocket every SIMULATION_INTERVAL_MS
// Auto-disabled when DATA_PROVIDER=redshift

const config = require('../config/dataSource');
const dataService = require('./dataService');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');

let intervalHandle = null;
let io = null;

/**
 * Start the simulation loop
 */
function start(socketIo) {
  if (!config.simulation.enabled) {
    console.log('[Simulation] Disabled — DATA_PROVIDER is not json');
    return;
  }

  io = socketIo;
  const interval = config.simulation.intervalMs;

  console.log(`[Simulation] Starting (interval: ${interval}ms)`);

  intervalHandle = setInterval(async () => {
    try {
      await simulateFileArrival();
    } catch (err) {
      console.error('[Simulation] Error:', err.message);
    }
  }, interval);
}

/**
 * Stop the simulation loop
 */
function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[Simulation] Stopped');
  }
}

/**
 * Simulate a file arrival for a randomly selected due workflow
 */
async function simulateFileArrival() {
  const workflows = await dataService.getWorkflows();
  const dailyWorkflows = workflows.filter(w => w.schedule_type === 'daily');

  if (dailyWorkflows.length === 0) return;

  // Pick a random workflow
  const workflow = dailyWorkflows[Math.floor(Math.random() * dailyWorkflows.length)];

  // Determine status: 85% on-time, 10% late, 5% missing
  const roll = Math.random();
  let status, delayMinutes, isAnomaly, anomalyType, anomalyScore;

  if (roll < 0.85) {
    // On time (±10 min)
    status = 'on_time';
    delayMinutes = Math.round((Math.random() * 20 - 10));
    isAnomaly = false;
    anomalyType = null;
    anomalyScore = null;
  } else if (roll < 0.95) {
    // Late (30-120 min)
    status = 'late';
    delayMinutes = Math.round(30 + Math.random() * 90);
    isAnomaly = true;
    anomalyType = 'timing';
    anomalyScore = Math.round((0.5 + Math.random() * 0.5) * 100) / 100;
  } else {
    // Missing
    status = 'missing';
    delayMinutes = null;
    isAnomaly = true;
    anomalyType = 'missing';
    anomalyScore = 1.0;
  }

  // Generate file size
  const sizeMin = workflow.expected_size_min_kb;
  const sizeMax = workflow.expected_size_max_kb;
  let fileSizeKb = null;

  if (status !== 'missing') {
    // 8% chance of abnormal size
    if (Math.random() < 0.08) {
      fileSizeKb = Math.round(sizeMax * (1.5 + Math.random()));
      isAnomaly = true;
      anomalyType = 'size';
      anomalyScore = Math.round((0.6 + Math.random() * 0.4) * 100) / 100;
    } else {
      fileSizeKb = Math.round(sizeMin + Math.random() * (sizeMax - sizeMin));
    }
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
  const filePrefix = workflow.name.toLowerCase().replace(/^daily_|^weekly_|^monthly_/i, '');
  const fileName = `${filePrefix}_${dateStr}.csv`;

  const [expectedHour, expectedMin] = workflow.expected_time.split(':').map(Number);
  const expectedAt = new Date(now);
  expectedAt.setHours(expectedHour, expectedMin, 0, 0);

  const receivedAt = status === 'missing' ? null : new Date(expectedAt.getTime() + (delayMinutes || 0) * 60000);

  const newRecord = {
    id: Date.now(),
    workflow_id: workflow.id,
    file_name: fileName,
    s3_key: `${workflow.s3_path}${fileName}`,
    file_size_kb: fileSizeKb,
    expected_at: expectedAt.toISOString(),
    received_at: receivedAt ? receivedAt.toISOString() : null,
    delay_minutes: delayMinutes,
    status,
    is_anomaly: isAnomaly,
    anomaly_type: anomalyType,
    anomaly_score: anomalyScore
  };

  // Emit WebSocket events
  if (io) {
    io.emit('file:received', {
      ...newRecord,
      workflow_name: workflow.name
    });

    io.emit('status:update', { timestamp: now.toISOString() });

    // If anomaly, generate alert
    if (isAnomaly) {
      const alert = {
        id: Date.now() + 1,
        workflow_id: workflow.id,
        file_record_id: newRecord.id,
        severity: anomalyScore > 0.8 ? 'critical' : 'warning',
        type: anomalyType === 'missing' ? 'missing_file' : anomalyType === 'size' ? 'size_anomaly' : 'late_arrival',
        title: status === 'missing'
          ? `Missing file: ${fileName}`
          : anomalyType === 'size'
            ? `Abnormal size: ${fileName} (${fileSizeKb}KB)`
            : `Late arrival: ${fileName} (+${delayMinutes}min)`,
        message: `Anomaly detected in workflow ${workflow.name}.`,
        source: workflow.name,
        acknowledged: false,
        acknowledged_at: null,
        created_at: now.toISOString()
      };

      io.emit('alert:new', alert);
    }
  }
}

module.exports = { start, stop };
