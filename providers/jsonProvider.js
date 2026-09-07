// JSON Data Provider — reads from /data/*.json files
// This is the default provider that works out of the box
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');

class JsonProvider {
  constructor() {
    this._cache = {};
  }

  // Helper to read and parse a JSON file with caching
  _readJson(filename) {
    if (!this._cache[filename]) {
      const filePath = path.join(DATA_DIR, filename);
      const raw = fs.readFileSync(filePath, 'utf-8');
      this._cache[filename] = JSON.parse(raw);
    }
    return this._cache[filename];
  }

  // Invalidate cache (used by simulation service when data changes)
  invalidateCache(filename) {
    if (filename) {
      delete this._cache[filename];
    } else {
      this._cache = {};
    }
  }

  // Write updated data back to JSON file
  _writeJson(filename, data) {
    const filePath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    this._cache[filename] = data;
  }

  // --- Workflows ---

  async getWorkflows() {
    const workflows = this._readJson('workflows.json');
    return workflows.filter(w => w.monitoring_enabled);
  }

  async getWorkflowById(id) {
    const workflows = this._readJson('workflows.json');
    return workflows.find(w => w.id === parseInt(id, 10)) || null;
  }

  // --- File Records ---

  async getFileRecords(filters = {}) {
    let records = this._readJson('fileRecords.json');
    const workflows = this._readJson('workflows.json');

    // Apply filters
    if (filters.workflow_id) {
      records = records.filter(r => r.workflow_id === parseInt(filters.workflow_id, 10));
    }
    if (filters.status) {
      records = records.filter(r => r.status === filters.status);
    }
    if (filters.date_from) {
      const from = new Date(filters.date_from);
      records = records.filter(r => new Date(r.received_at || r.expected_at) >= from);
    }
    if (filters.date_to) {
      const to = new Date(filters.date_to);
      records = records.filter(r => new Date(r.received_at || r.expected_at) <= to);
    }

    // Sort by received_at descending
    records.sort((a, b) => new Date(b.received_at || b.expected_at) - new Date(a.received_at || a.expected_at));

    // Enrich with workflow name
    records = records.map(r => {
      const wf = workflows.find(w => w.id === r.workflow_id);
      return { ...r, workflow_name: wf ? wf.name : 'Unknown' };
    });

    // Pagination
    const page = parseInt(filters.page, 10) || 1;
    const limit = parseInt(filters.limit, 10) || 20;
    const total = records.length;
    const offset = (page - 1) * limit;
    const paginated = records.slice(offset, offset + limit);

    return { records: paginated, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getFileRecordsByDate(date) {
    const records = this._readJson('fileRecords.json');
    const targetDate = new Date(date).toISOString().split('T')[0];
    return records.filter(r => {
      const recDate = new Date(r.received_at || r.expected_at).toISOString().split('T')[0];
      return recDate === targetDate;
    });
  }

  async getRecentFileRecords(workflowId, days = 14) {
    const records = this._readJson('fileRecords.json');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return records.filter(r =>
      r.workflow_id === parseInt(workflowId, 10) &&
      new Date(r.received_at || r.expected_at) >= cutoff
    ).sort((a, b) => new Date(a.received_at || a.expected_at) - new Date(b.received_at || b.expected_at));
  }

  // --- Alerts ---

  async getAlerts(filters = {}) {
    let alerts = this._readJson('alerts.json');
    const workflows = this._readJson('workflows.json');

    if (filters.severity) {
      alerts = alerts.filter(a => a.severity === filters.severity);
    }
    if (filters.acknowledged !== undefined) {
      const ack = filters.acknowledged === 'true' || filters.acknowledged === true;
      alerts = alerts.filter(a => a.acknowledged === ack);
    }
    if (filters.date_from) {
      const from = new Date(filters.date_from);
      alerts = alerts.filter(a => new Date(a.created_at) >= from);
    }
    if (filters.date_to) {
      const to = new Date(filters.date_to);
      alerts = alerts.filter(a => new Date(a.created_at) <= to);
    }

    // Enrich with workflow name
    alerts = alerts.map(a => {
      const wf = workflows.find(w => w.id === a.workflow_id);
      return { ...a, workflow_name: wf ? wf.name : 'Unknown' };
    });

    // Sort by created_at descending
    alerts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return alerts;
  }

  async getActiveAlerts() {
    const alerts = this._readJson('alerts.json');
    return alerts.filter(a => !a.acknowledged);
  }

  async acknowledgeAlert(id) {
    const alerts = this._readJson('alerts.json');
    const alert = alerts.find(a => a.id === parseInt(id, 10));
    if (!alert) return null;

    alert.acknowledged = true;
    alert.acknowledged_at = new Date().toISOString();
    this._writeJson('alerts.json', alerts);
    return alert;
  }

  // --- Statistics & Trends ---

  async getDailyStats(workflowId, days = 30) {
    let stats = this._readJson('dailyStats.json');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    if (workflowId) {
      stats = stats.filter(s => s.workflow_id === parseInt(workflowId, 10));
    }

    return stats.filter(s => new Date(s.stat_date) >= cutoff)
      .sort((a, b) => new Date(a.stat_date) - new Date(b.stat_date));
  }

  async getOverviewStats() {
    const workflows = this._readJson('workflows.json').filter(w => w.monitoring_enabled);
    const today = new Date().toISOString().split('T')[0];
    const records = this._readJson('fileRecords.json');
    const alerts = this._readJson('alerts.json');

    // Today's records
    const todayRecords = records.filter(r => {
      const recDate = new Date(r.expected_at).toISOString().split('T')[0];
      return recDate === today;
    });

    const onTime = todayRecords.filter(r => r.status === 'on_time').length;
    const delayed = todayRecords.filter(r => r.status === 'late').length;
    const missing = todayRecords.filter(r => r.status === 'missing').length;
    const total = todayRecords.length || 1;
    const activeAlerts = alerts.filter(a => !a.acknowledged).length;

    return {
      totalWorkflows: workflows.length,
      onTimePercent: Math.round((onTime / total) * 100),
      delayed,
      missing,
      activeAlerts,
      todayRecords: todayRecords.map(r => {
        const wf = workflows.find(w => w.id === r.workflow_id);
        return { ...r, workflow_name: wf ? wf.name : 'Unknown' };
      })
    };
  }

  async getReliabilityScores() {
    const stats = this._readJson('dailyStats.json');
    const workflows = this._readJson('workflows.json').filter(w => w.monitoring_enabled);

    return workflows.map(wf => {
      const wfStats = stats.filter(s => s.workflow_id === wf.id);
      const avgReliability = wfStats.length > 0
        ? wfStats.reduce((sum, s) => sum + s.reliability_score, 0) / wfStats.length
        : 0;

      return {
        workflow_id: wf.id,
        workflow_name: wf.name,
        reliability_score: Math.round(avgReliability * 100) / 100,
        total_days: wfStats.length
      };
    });
  }

  // --- For Anomaly Detection ---

  async getArrivalTimes(workflowId, days = 14) {
    const records = await this.getRecentFileRecords(workflowId, days);
    return records
      .filter(r => r.received_at)
      .map(r => ({
        received_at: r.received_at,
        expected_at: r.expected_at,
        delay_minutes: r.delay_minutes,
        file_size_kb: r.file_size_kb
      }));
  }

  async getFileSizes(workflowId, days = 14) {
    const records = await this.getRecentFileRecords(workflowId, days);
    return records
      .filter(r => r.file_size_kb)
      .map(r => ({
        date: r.received_at || r.expected_at,
        file_size_kb: r.file_size_kb
      }));
  }
}

module.exports = JsonProvider;
