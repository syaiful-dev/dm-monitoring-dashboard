// Redshift Data Provider — connects to Amazon Redshift
// FUTURE: This provider is stubbed out with planned SQL queries in comments.
// Each method throws an error until Redshift is properly configured.
// Uses pg (node-postgres) which is compatible with Redshift.

class RedshiftProvider {
  constructor(config) {
    this.config = config;
    // FUTURE: Uncomment when Redshift is configured
    // const { Pool } = require('pg');
    // this.pool = new Pool({
    //   host: config.host,
    //   port: config.port,
    //   database: config.database,
    //   user: config.user,
    //   password: config.password,
    //   ssl: { rejectUnauthorized: false }
    // });
  }

  // --- Workflows ---

  async getWorkflows() {
    // FUTURE QUERY:
    // SELECT * FROM dm_monitoring.workflows
    // WHERE monitoring_enabled = true
    // ORDER BY name;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  async getWorkflowById(id) {
    // FUTURE QUERY:
    // SELECT * FROM dm_monitoring.workflows WHERE id = $1;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  // --- File Records ---

  async getFileRecords(filters) {
    // FUTURE QUERY:
    // SELECT fr.*, w.name as workflow_name
    // FROM dm_monitoring.file_records fr
    // JOIN dm_monitoring.workflows w ON fr.workflow_id = w.id
    // WHERE 1=1
    //   AND ($1::int IS NULL OR fr.workflow_id = $1)
    //   AND ($2::text IS NULL OR fr.status = $2)
    //   AND ($3::date IS NULL OR fr.received_at >= $3)
    //   AND ($4::date IS NULL OR fr.received_at <= $4)
    // ORDER BY fr.received_at DESC
    // LIMIT $5 OFFSET $6;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  async getFileRecordsByDate(date) {
    // FUTURE QUERY:
    // SELECT fr.*, w.name as workflow_name
    // FROM dm_monitoring.file_records fr
    // JOIN dm_monitoring.workflows w ON fr.workflow_id = w.id
    // WHERE DATE(fr.expected_at) = $1
    // ORDER BY fr.expected_at ASC;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  async getRecentFileRecords(workflowId, days) {
    // FUTURE QUERY:
    // SELECT * FROM dm_monitoring.file_records
    // WHERE workflow_id = $1
    //   AND received_at >= CURRENT_DATE - INTERVAL '$2 days'
    // ORDER BY received_at ASC;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  // --- Alerts ---

  async getAlerts(filters) {
    // FUTURE QUERY:
    // SELECT a.*, w.name as workflow_name
    // FROM dm_monitoring.alerts a
    // JOIN dm_monitoring.workflows w ON a.workflow_id = w.id
    // WHERE 1=1
    //   AND ($1::text IS NULL OR a.severity = $1)
    //   AND ($2::boolean IS NULL OR a.acknowledged = $2)
    //   AND ($3::date IS NULL OR a.created_at >= $3)
    //   AND ($4::date IS NULL OR a.created_at <= $4)
    // ORDER BY a.created_at DESC;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  async getActiveAlerts() {
    // FUTURE QUERY:
    // SELECT a.*, w.name as workflow_name
    // FROM dm_monitoring.alerts a
    // JOIN dm_monitoring.workflows w ON a.workflow_id = w.id
    // WHERE a.acknowledged = false
    // ORDER BY a.created_at DESC;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  async acknowledgeAlert(id) {
    // FUTURE QUERY:
    // UPDATE dm_monitoring.alerts
    // SET acknowledged = true, acknowledged_at = GETDATE()
    // WHERE id = $1
    // RETURNING *;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  // --- Statistics & Trends ---

  async getDailyStats(workflowId, days) {
    // FUTURE QUERY:
    // SELECT * FROM dm_monitoring.daily_stats
    // WHERE ($1::int IS NULL OR workflow_id = $1)
    //   AND stat_date >= CURRENT_DATE - INTERVAL '$2 days'
    // ORDER BY stat_date ASC;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  async getOverviewStats() {
    // FUTURE QUERY:
    // SELECT
    //   (SELECT COUNT(*) FROM dm_monitoring.workflows WHERE monitoring_enabled = true) as total_workflows,
    //   (SELECT COUNT(*) FROM dm_monitoring.file_records WHERE DATE(expected_at) = CURRENT_DATE AND status = 'on_time') as on_time,
    //   (SELECT COUNT(*) FROM dm_monitoring.file_records WHERE DATE(expected_at) = CURRENT_DATE AND status = 'late') as delayed,
    //   (SELECT COUNT(*) FROM dm_monitoring.file_records WHERE DATE(expected_at) = CURRENT_DATE AND status = 'missing') as missing,
    //   (SELECT COUNT(*) FROM dm_monitoring.alerts WHERE acknowledged = false) as active_alerts;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  async getReliabilityScores() {
    // FUTURE QUERY:
    // SELECT w.id as workflow_id, w.name as workflow_name,
    //   AVG(ds.reliability_score) as reliability_score,
    //   COUNT(ds.id) as total_days
    // FROM dm_monitoring.workflows w
    // LEFT JOIN dm_monitoring.daily_stats ds ON w.id = ds.workflow_id
    // WHERE w.monitoring_enabled = true
    // GROUP BY w.id, w.name
    // ORDER BY w.name;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  // --- For Anomaly Detection ---

  async getArrivalTimes(workflowId, days) {
    // FUTURE QUERY:
    // SELECT received_at, expected_at, delay_minutes, file_size_kb
    // FROM dm_monitoring.file_records
    // WHERE workflow_id = $1
    //   AND received_at >= CURRENT_DATE - INTERVAL '$2 days'
    // ORDER BY received_at ASC;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }

  async getFileSizes(workflowId, days) {
    // FUTURE QUERY:
    // SELECT received_at as date, file_size_kb
    // FROM dm_monitoring.file_records
    // WHERE workflow_id = $1
    //   AND file_size_kb IS NOT NULL
    //   AND received_at >= CURRENT_DATE - INTERVAL '$2 days'
    // ORDER BY received_at ASC;
    throw new Error('Redshift provider not configured. Set DATA_PROVIDER=json in .env');
  }
}

module.exports = RedshiftProvider;
