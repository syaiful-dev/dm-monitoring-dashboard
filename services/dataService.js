// Data Service — abstraction layer that delegates to the active provider
// Routes and other services call THIS service, never the provider directly.
// Switching providers requires ZERO changes here.

const provider = require('../providers');

module.exports = {
  // Workflows
  getWorkflows: () => provider.getWorkflows(),
  getWorkflowById: (id) => provider.getWorkflowById(id),

  // File Records
  getFileRecords: (filters) => provider.getFileRecords(filters),
  getFileRecordsByDate: (date) => provider.getFileRecordsByDate(date),
  getRecentFileRecords: (workflowId, days) => provider.getRecentFileRecords(workflowId, days),

  // Alerts
  getAlerts: (filters) => provider.getAlerts(filters),
  getActiveAlerts: () => provider.getActiveAlerts(),
  acknowledgeAlert: (id) => provider.acknowledgeAlert(id),

  // Statistics & Trends
  getDailyStats: (workflowId, days) => provider.getDailyStats(workflowId, days),
  getOverviewStats: () => provider.getOverviewStats(),
  getReliabilityScores: () => provider.getReliabilityScores(),

  // For anomaly detection
  getArrivalTimes: (workflowId, days) => provider.getArrivalTimes(workflowId, days),
  getFileSizes: (workflowId, days) => provider.getFileSizes(workflowId, days),

  // Provider utilities (for simulation service)
  invalidateCache: (filename) => {
    if (provider.invalidateCache) {
      provider.invalidateCache(filename);
    }
  }
};
