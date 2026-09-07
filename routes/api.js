// API Routes — all endpoints powered by real eHub CSV data via trendDataService
const express = require('express');
const router = express.Router();
const trendDataService = require('../services/trendDataService');
const config = require('../config/dataSource');

// ===================== OVERVIEW =====================

// GET /api/overview — KPI data + today's status
router.get('/overview', (req, res) => {
  try {
    const overview = trendDataService.getOverviewStats();
    res.json(overview);
  } catch (err) {
    console.error('Error fetching overview:', err);
    res.status(500).json({ error: 'Failed to fetch overview data' });
  }
});

// GET /api/workflows — Distinct workflow IDs
router.get('/workflows', (req, res) => {
  try {
    const workflows = trendDataService.getDistinctWorkflows();
    res.json(workflows);
  } catch (err) {
    console.error('Error fetching workflows:', err);
    res.status(500).json({ error: 'Failed to fetch workflows' });
  }
});

// ===================== FILES =====================

// GET /api/files — File records from Trenddata CSVs
router.get('/files', (req, res) => {
  try {
    const filters = {
      workflow_id: req.query.workflow_id,
      status: req.query.status,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      page: req.query.page,
      limit: req.query.limit
    };
    const result = trendDataService.getRecords(filters);
    res.json(result);
  } catch (err) {
    console.error('Error fetching files:', err);
    res.status(500).json({ error: 'Failed to fetch file records' });
  }
});

// GET /api/files/workflows — Distinct workflow IDs for filter dropdown
router.get('/files/workflows', (req, res) => {
  try {
    const workflows = trendDataService.getDistinctWorkflows();
    res.json(workflows);
  } catch (err) {
    console.error('Error fetching file workflows:', err);
    res.status(500).json({ error: 'Failed to fetch workflow list' });
  }
});

// GET /api/files/statuses — Distinct status codes for filter dropdown
router.get('/files/statuses', (req, res) => {
  try {
    const statuses = trendDataService.getDistinctStatuses();
    res.json(statuses);
  } catch (err) {
    console.error('Error fetching file statuses:', err);
    res.status(500).json({ error: 'Failed to fetch status list' });
  }
});

// ===================== ALERTS =====================

// GET /api/alerts — Alerts derived from real data
router.get('/alerts', (req, res) => {
  try {
    const filters = {
      severity: req.query.severity,
      workflow_id: req.query.workflow_id
    };
    const alerts = trendDataService.getAlerts(filters);
    res.json(alerts);
  } catch (err) {
    console.error('Error fetching alerts:', err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// GET /api/alerts/stats — Alert statistics
router.get('/alerts/stats', (req, res) => {
  try {
    const stats = trendDataService.getAlertStats();
    res.json(stats);
  } catch (err) {
    console.error('Error fetching alert stats:', err);
    res.status(500).json({ error: 'Failed to fetch alert statistics' });
  }
});

// ===================== TRENDS =====================

// GET /api/trends/:workflow_id — Trend data for a workflow
router.get('/trends/:workflow_id', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const workflowId = req.params.workflow_id === 'ALL' ? null : req.params.workflow_id;

    const trendData = trendDataService.getTrendData(workflowId, days);
    const arrivalTimes = trendDataService.getArrivalTimes(workflowId, days);
    const sizeTrend = trendDataService.getSizeTrend(workflowId, days);

    res.json({
      workflow_id: workflowId || 'ALL',
      trend: trendData,
      arrivals: arrivalTimes,
      sizes: sizeTrend
    });
  } catch (err) {
    console.error('Error fetching trends:', err);
    res.status(500).json({ error: 'Failed to fetch trend data' });
  }
});

// ===================== INSIGHTS =====================

// GET /api/workflow-analysis — Per-workflow file trend analysis
router.get('/workflow-analysis', (req, res) => {
  try {
    const analysis = trendDataService.getWorkflowAnalysis();
    res.json(analysis);
  } catch (err) {
    console.error('Error generating workflow analysis:', err);
    res.status(500).json({ error: 'Failed to generate workflow analysis' });
  }
});

// GET /api/sla-compliance — SLA compliance per workflow
router.get('/sla-compliance', (req, res) => {
  try {
    const data = trendDataService.getSlaCompliance();
    res.json(data);
  } catch (err) {
    console.error('Error fetching SLA compliance:', err);
    res.status(500).json({ error: 'Failed to fetch SLA compliance' });
  }
});

// GET /api/week-over-week — Week-over-week comparison
router.get('/week-over-week', (req, res) => {
  try {
    const data = trendDataService.getWeekOverWeek();
    res.json(data);
  } catch (err) {
    console.error('Error fetching week-over-week:', err);
    res.status(500).json({ error: 'Failed to fetch week-over-week data' });
  }
});

// GET /api/health-heatmap — Workflow health heatmap
router.get('/health-heatmap', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 14;
    const data = trendDataService.getHealthHeatmap(days);
    res.json(data);
  } catch (err) {
    console.error('Error fetching health heatmap:', err);
    res.status(500).json({ error: 'Failed to fetch heatmap data' });
  }
});

// GET /api/trading-partners — Trading partner activity summary
router.get('/trading-partners', (req, res) => {
  try {
    const data = trendDataService.getTradingPartnerActivity();
    res.json(data);
  } catch (err) {
    console.error('Error fetching trading partners:', err);
    res.status(500).json({ error: 'Failed to fetch trading partner data' });
  }
});

// GET /api/anomalies — Detected anomalies
router.get('/anomalies', (req, res) => {
  try {
    const anomalies = trendDataService.getAnomalies();
    res.json(anomalies);
  } catch (err) {
    console.error('Error fetching anomalies:', err);
    res.status(500).json({ error: 'Failed to fetch anomalies' });
  }
});

// GET /api/reliability — Reliability scores per workflow
router.get('/reliability', (req, res) => {
  try {
    const scores = trendDataService.getReliabilityScores();
    res.json(scores);
  } catch (err) {
    console.error('Error fetching reliability:', err);
    res.status(500).json({ error: 'Failed to fetch reliability scores' });
  }
});

// GET /api/summary — AI summary
router.get('/summary', (req, res) => {
  try {
    const summary = trendDataService.generateSummary();
    res.json(summary);
  } catch (err) {
    console.error('Error generating summary:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// GET /api/predictions — AI predictions
router.get('/predictions', (req, res) => {
  try {
    const predictions = trendDataService.generatePredictions();
    res.json(predictions);
  } catch (err) {
    console.error('Error generating predictions:', err);
    res.status(500).json({ error: 'Failed to generate predictions' });
  }
});

// ===================== SYSTEM =====================

// GET /api/status — System status
router.get('/status', (req, res) => {
  try {
    const records = trendDataService.loadAllRecords();
    res.json({
      provider: 'eHub CSV',
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

module.exports = router;
