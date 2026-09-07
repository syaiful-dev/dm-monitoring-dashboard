// Controls which data provider is active
// Change DATA_PROVIDER in .env to switch between 'json' and 'redshift'
module.exports = {
  provider: process.env.DATA_PROVIDER || 'json', // 'json' or 'redshift'

  // Redshift config (used only when provider = 'redshift')
  redshift: {
    host: process.env.REDSHIFT_HOST || '',
    port: parseInt(process.env.REDSHIFT_PORT, 10) || 5439,
    database: process.env.REDSHIFT_DATABASE || '',
    user: process.env.REDSHIFT_USER || '',
    password: process.env.REDSHIFT_PASSWORD || '',
    schema: process.env.REDSHIFT_SCHEMA || 'dm_monitoring'
  },

  // Simulation settings (only active in json mode)
  simulation: {
    enabled: (process.env.DATA_PROVIDER || 'json') === 'json',
    intervalMs: parseInt(process.env.SIMULATION_INTERVAL_MS, 10) || 10000
  },

  // Anomaly detection settings
  anomaly: {
    zScoreThreshold: parseFloat(process.env.ANOMALY_ZSCORE_THRESHOLD) || 2.0,
    trendDriftThreshold: parseFloat(process.env.TREND_DRIFT_THRESHOLD) || 1.0,
    rollingWindowDays: parseInt(process.env.ROLLING_WINDOW_DAYS, 10) || 14
  }
};
