// AI Anomaly Detection Engine
// Calls dataService to get data (provider-agnostic)
// Implements: timing anomaly (z-score), file size anomaly, trend drift, missing file detection

const dataService = require('./dataService');
const config = require('../config/dataSource');
const {
  calculateMean,
  calculateStdDev,
  calculateZScore,
  linearRegression,
  calculateReliabilityScore
} = require('../utils/statistics');

const ZSCORE_THRESHOLD = config.anomaly.zScoreThreshold;
const DRIFT_THRESHOLD = config.anomaly.trendDriftThreshold;
const ROLLING_DAYS = config.anomaly.rollingWindowDays;

/**
 * Detect timing anomalies for a workflow using z-score
 */
async function detectTimingAnomalies(workflowId) {
  const arrivals = await dataService.getArrivalTimes(workflowId, ROLLING_DAYS);
  if (arrivals.length < 3) return [];

  const delays = arrivals.map(a => a.delay_minutes);
  const mean = calculateMean(delays);
  const stdDev = calculateStdDev(delays);

  return arrivals
    .map(a => {
      const zScore = calculateZScore(a.delay_minutes, mean, stdDev);
      const absZ = Math.abs(zScore);
      let severity = null;

      if (absZ > 3.0) severity = 'critical';
      else if (absZ > ZSCORE_THRESHOLD) severity = 'warning';

      return {
        ...a,
        zScore: Math.round(zScore * 100) / 100,
        severity,
        type: 'timing',
        isAnomaly: absZ > ZSCORE_THRESHOLD
      };
    })
    .filter(a => a.isAnomaly);
}

/**
 * Detect file size anomalies for a workflow
 */
async function detectSizeAnomalies(workflowId) {
  const sizes = await dataService.getFileSizes(workflowId, ROLLING_DAYS);
  if (sizes.length < 3) return [];

  const sizeValues = sizes.map(s => s.file_size_kb);
  const mean = calculateMean(sizeValues);
  const stdDev = calculateStdDev(sizeValues);

  return sizes
    .map(s => {
      const zScore = calculateZScore(s.file_size_kb, mean, stdDev);
      const absZ = Math.abs(zScore);
      let severity = null;

      if (absZ > 3.0) severity = 'critical';
      else if (absZ > ZSCORE_THRESHOLD) severity = 'warning';

      return {
        ...s,
        zScore: Math.round(zScore * 100) / 100,
        mean: Math.round(mean),
        stdDev: Math.round(stdDev),
        severity,
        type: 'size',
        isAnomaly: absZ > ZSCORE_THRESHOLD
      };
    })
    .filter(a => a.isAnomaly);
}

/**
 * Detect timing drift using linear regression
 * Flag if slope > DRIFT_THRESHOLD min/day
 */
async function detectTrendDrift(workflowId) {
  const arrivals = await dataService.getArrivalTimes(workflowId, ROLLING_DAYS);
  if (arrivals.length < 5) return null;

  // x = day index, y = delay_minutes
  const xValues = arrivals.map((_, i) => i);
  const yValues = arrivals.map(a => a.delay_minutes);

  const { slope, intercept, rSquared } = linearRegression(xValues, yValues);

  const isDrifting = Math.abs(slope) > DRIFT_THRESHOLD;

  // Predict when SLA breach might happen (assuming threshold is workflow's alert_threshold)
  const workflow = await dataService.getWorkflowById(workflowId);
  let predictedBreachDays = null;
  if (isDrifting && slope > 0 && workflow) {
    const currentDelay = slope * (arrivals.length - 1) + intercept;
    const threshold = workflow.alert_threshold_minutes;
    if (currentDelay < threshold) {
      predictedBreachDays = Math.ceil((threshold - currentDelay) / slope);
    }
  }

  return {
    workflow_id: workflowId,
    slope: Math.round(slope * 100) / 100,
    intercept: Math.round(intercept * 100) / 100,
    rSquared: Math.round(rSquared * 100) / 100,
    isDrifting,
    direction: slope > 0 ? 'later' : 'earlier',
    predictedBreachDays,
    severity: isDrifting ? (Math.abs(slope) > 2 ? 'critical' : 'warning') : null
  };
}

/**
 * Get all anomalies across all workflows
 */
async function getAllAnomalies() {
  const workflows = await dataService.getWorkflows();
  const anomalies = [];

  for (const wf of workflows) {
    const timingAnomalies = await detectTimingAnomalies(wf.id);
    const sizeAnomalies = await detectSizeAnomalies(wf.id);
    const drift = await detectTrendDrift(wf.id);

    timingAnomalies.forEach(a => {
      anomalies.push({
        workflow_id: wf.id,
        workflow_name: wf.name,
        ...a
      });
    });

    sizeAnomalies.forEach(a => {
      anomalies.push({
        workflow_id: wf.id,
        workflow_name: wf.name,
        ...a
      });
    });

    if (drift && drift.isDrifting) {
      anomalies.push({
        workflow_id: wf.id,
        workflow_name: wf.name,
        type: 'drift',
        ...drift
      });
    }
  }

  // Sort by severity (critical first) then date
  const severityOrder = { critical: 0, warning: 1, info: 2, null: 3 };
  anomalies.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));

  return anomalies;
}

/**
 * Generate AI weekly summary
 */
async function generateWeeklySummary() {
  const workflows = await dataService.getWorkflows();
  const reliability = await dataService.getReliabilityScores();
  const anomalies = await getAllAnomalies();
  const activeAlerts = await dataService.getActiveAlerts();

  const avgReliability = reliability.length > 0
    ? reliability.reduce((sum, r) => sum + r.reliability_score, 0) / reliability.length
    : 0;

  const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
  const warningCount = anomalies.filter(a => a.severity === 'warning').length;

  // Find most problematic workflow
  const problemCounts = {};
  anomalies.forEach(a => {
    problemCounts[a.workflow_name] = (problemCounts[a.workflow_name] || 0) + 1;
  });
  const mostProblematic = Object.entries(problemCounts)
    .sort(([, a], [, b]) => b - a)[0];

  // Find drifting workflows
  const drifting = anomalies.filter(a => a.type === 'drift');

  let summary = `Pipeline Health Summary (Last ${ROLLING_DAYS} Days)\n\n`;
  summary += `Overall reliability: ${Math.round(avgReliability * 100)}% across ${workflows.length} monitored workflows.\n\n`;

  if (criticalCount > 0 || warningCount > 0) {
    summary += `Anomalies detected: ${criticalCount} critical, ${warningCount} warnings.\n`;
  } else {
    summary += `No significant anomalies detected. All pipelines operating normally.\n`;
  }

  if (mostProblematic) {
    summary += `Most attention needed: ${mostProblematic[0]} (${mostProblematic[1]} anomalies).\n`;
  }

  if (drifting.length > 0) {
    summary += `\nTiming drift detected in: ${drifting.map(d => d.workflow_name).join(', ')}.\n`;
    drifting.forEach(d => {
      if (d.predictedBreachDays) {
        summary += `  → ${d.workflow_name}: drifting ${d.slope} min/day ${d.direction}, potential SLA breach in ~${d.predictedBreachDays} days.\n`;
      }
    });
  }

  if (activeAlerts.length > 0) {
    summary += `\n${activeAlerts.length} unacknowledged alert(s) require attention.\n`;
  }

  return {
    summary,
    metrics: {
      avgReliability: Math.round(avgReliability * 100),
      totalWorkflows: workflows.length,
      criticalAnomalies: criticalCount,
      warningAnomalies: warningCount,
      activeAlerts: activeAlerts.length,
      mostProblematic: mostProblematic ? mostProblematic[0] : null
    }
  };
}

/**
 * Generate AI predictions for next 7 days
 */
async function generatePredictions() {
  const workflows = await dataService.getWorkflows();
  const predictions = [];

  for (const wf of workflows) {
    const drift = await detectTrendDrift(wf.id);

    if (drift && drift.isDrifting) {
      predictions.push({
        workflow_id: wf.id,
        workflow_name: wf.name,
        prediction: drift.predictedBreachDays
          ? `Expected SLA breach in ~${drift.predictedBreachDays} days if drift continues at ${drift.slope} min/day.`
          : `Timing drift detected (${drift.slope} min/day ${drift.direction}). Monitor closely.`,
        severity: drift.severity,
        confidence: drift.rSquared
      });
    }

    // Check if reliability is declining
    const stats = await dataService.getDailyStats(wf.id, 14);
    if (stats.length >= 7) {
      const recentScores = stats.slice(-7).map(s => s.reliability_score);
      const olderScores = stats.slice(0, 7).map(s => s.reliability_score);
      const recentAvg = calculateMean(recentScores);
      const olderAvg = calculateMean(olderScores);

      if (olderAvg - recentAvg > 0.1) {
        predictions.push({
          workflow_id: wf.id,
          workflow_name: wf.name,
          prediction: `Reliability declining: ${Math.round(olderAvg * 100)}% → ${Math.round(recentAvg * 100)}% over the past 2 weeks.`,
          severity: 'warning',
          confidence: 0.7
        });
      }
    }
  }

  return predictions;
}

module.exports = {
  detectTimingAnomalies,
  detectSizeAnomalies,
  detectTrendDrift,
  getAllAnomalies,
  generateWeeklySummary,
  generatePredictions
};
