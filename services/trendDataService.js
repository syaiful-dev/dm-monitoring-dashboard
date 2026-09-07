// Trend Data Service — parses Trenddata CSVs and serves real eHub B2B document records
// Central data source for ALL dashboard features: Overview, Trends, Files, Alerts, Insights, Chatbot

const fs = require('fs');
const path = require('path');

const TRENDDATA_DIR = path.join(__dirname, '..', 'data', 'Trenddata');

let cachedRecords = null;

/**
 * Parse a single CSV line respecting quoted fields (handles commas inside quotes)
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Load and parse all CSV files from the Trenddata directory
 */
function loadAllRecords() {
  if (cachedRecords) return cachedRecords;

  const records = [];

  if (!fs.existsSync(TRENDDATA_DIR)) {
    console.warn('[TrendDataService] Trenddata directory not found:', TRENDDATA_DIR);
    return records;
  }

  const files = fs.readdirSync(TRENDDATA_DIR).filter(f => f.endsWith('.csv'));

  for (const file of files) {
    const filePath = path.join(TRENDDATA_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);

    if (lines.length < 2) continue;

    const headers = parseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());

    const idxWorkflowId = headers.indexOf('WORKFLOWID');
    const idxDocFilename = headers.indexOf('DOCFILENAME');
    const idxDocSize = headers.indexOf('DOCSIZE');
    const idxCreationDate = headers.indexOf('CREATIONDATE');
    const idxStatus = headers.indexOf('STATUS');

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      if (fields.length < headers.length) continue;

      const workflowId = idxWorkflowId >= 0 ? fields[idxWorkflowId].replace(/^"|"$/g, '').trim() : '';
      const docFilename = idxDocFilename >= 0 ? fields[idxDocFilename].replace(/^"|"$/g, '').trim() : '';
      const docSize = idxDocSize >= 0 ? fields[idxDocSize].replace(/^"|"$/g, '').trim() : '';
      const creationDate = idxCreationDate >= 0 ? fields[idxCreationDate].replace(/^"|"$/g, '').trim() : '';
      const status = idxStatus >= 0 ? fields[idxStatus].replace(/^"|"$/g, '').trim() : '';

      if (!docFilename) continue;

      records.push({
        workflow_id: workflowId,
        file_name: docFilename,
        size_kb: docSize ? Math.round(parseFloat(docSize) / 1024 * 100) / 100 : null,
        size_bytes: docSize ? parseInt(docSize, 10) : null,
        received: creationDate || null,
        status: status,
        source_file: file
      });
    }
  }

  // Sort by received date descending (newest first)
  records.sort((a, b) => {
    if (!a.received && !b.received) return 0;
    if (!a.received) return 1;
    if (!b.received) return -1;
    return new Date(b.received) - new Date(a.received);
  });

  cachedRecords = records;
  console.log(`[TrendDataService] Loaded ${records.length} records from ${files.length} CSV files`);
  return records;
}

// ===================== FILES TAB =====================

/**
 * Get paginated and filtered records
 */
function getRecords(filters = {}) {
  let records = loadAllRecords();

  if (filters.workflow_id) {
    const q = filters.workflow_id.toLowerCase();
    records = records.filter(r => r.workflow_id.toLowerCase().includes(q));
  }
  if (filters.status) {
    records = records.filter(r => r.status === filters.status);
  }
  if (filters.date_from) {
    const from = new Date(filters.date_from);
    records = records.filter(r => r.received && new Date(r.received) >= from);
  }
  if (filters.date_to) {
    const to = new Date(filters.date_to);
    to.setHours(23, 59, 59, 999);
    records = records.filter(r => r.received && new Date(r.received) <= to);
  }

  const page = parseInt(filters.page, 10) || 1;
  const limit = parseInt(filters.limit, 10) || 20;
  const total = records.length;
  const offset = (page - 1) * limit;
  const paginated = records.slice(offset, offset + limit);

  return { records: paginated, total, page, limit, pages: Math.ceil(total / limit) };
}

/**
 * Get distinct workflow IDs
 */
function getDistinctWorkflows() {
  const records = loadAllRecords();
  return [...new Set(records.map(r => r.workflow_id).filter(Boolean))].sort();
}

/**
 * Get distinct status codes
 */
function getDistinctStatuses() {
  const records = loadAllRecords();
  return [...new Set(records.map(r => r.status).filter(Boolean))].sort();
}

// ===================== OVERVIEW TAB =====================

/**
 * Get KPI overview stats from real CSV data
 */
function getOverviewStats() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();
  const statuses = getDistinctStatuses();

  // Count by status
  const statusCounts = {};
  statuses.forEach(s => { statusCounts[s] = 0; });
  records.forEach(r => {
    if (r.status) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  });

  // Count by workflow
  const workflowCounts = {};
  workflows.forEach(w => { workflowCounts[w] = 0; });
  records.forEach(r => {
    if (r.workflow_id) workflowCounts[r.workflow_id] = (workflowCounts[r.workflow_id] || 0) + 1;
  });

  // Today's records (or most recent date if today has none)
  const today = new Date().toISOString().split('T')[0];
  let todayRecords = records.filter(r => r.received && r.received.startsWith(today));
  
  // If no records today, use most recent date available
  let displayDate = today;
  if (todayRecords.length === 0 && records.length > 0) {
    const latestDate = records[0].received ? records[0].received.split(' ')[0] : today;
    displayDate = latestDate;
    todayRecords = records.filter(r => r.received && r.received.startsWith(latestDate));
  }

  // Status 50 = completed/archived (success), others = potentially problematic
  const completed = statusCounts['50'] || 0;
  const inProgress = statusCounts['45'] || 0;
  const errors = statusCounts['999'] || 0;
  const completionRate = records.length > 0 ? Math.round((completed / records.length) * 100) : 0;

  return {
    totalWorkflows: workflows.length,
    totalRecords: records.length,
    completionRate,
    completed,
    inProgress,
    errors,
    statusCounts,
    workflowCounts,
    displayDate,
    todayRecords: todayRecords.slice(0, 50) // limit for display
  };
}

// ===================== TRENDS TAB =====================

/**
 * Get arrival timing trend — what time of day files are received, grouped by date
 * Returns per-day: earliest, latest, average arrival time (as decimal hours)
 */
function getTrendData(workflowId, days = 30) {
  let records = loadAllRecords();

  if (workflowId) {
    records = records.filter(r => r.workflow_id === workflowId);
  }

  // Group by date, collect arrival times
  const dailyData = {};
  records.forEach(r => {
    if (!r.received) return;
    const parts = r.received.split(' ');
    const date = parts[0]; // YYYY-MM-DD
    const timePart = parts[1]; // HH:MM:SS.sss
    if (!timePart) return;

    const [hh, mm] = timePart.split(':').map(Number);
    const decimalHour = hh + mm / 60; // e.g. 9:30 = 9.5

    if (!dailyData[date]) {
      dailyData[date] = { date, times: [], count: 0 };
    }
    dailyData[date].times.push(decimalHour);
    dailyData[date].count++;
  });

  // Sort by date and limit to last N days
  const sorted = Object.values(dailyData)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days);

  // Calculate timing stats per day
  return {
    workflow_id: workflowId || 'ALL',
    days: sorted.length,
    data: sorted.map(d => {
      const times = d.times.sort((a, b) => a - b);
      const earliest = times[0];
      const latest = times[times.length - 1];
      const avg = times.reduce((s, t) => s + t, 0) / times.length;

      return {
        date: d.date,
        earliest: Math.round(earliest * 100) / 100,
        latest: Math.round(latest * 100) / 100,
        avg: Math.round(avg * 100) / 100,
        count: d.count
      };
    })
  };
}

/**
 * Get individual file arrival times (for scatter plot)
 * Each point: { date, time (decimal hours), file_name }
 */
function getArrivalTimes(workflowId, days = 30) {
  let records = loadAllRecords();

  if (workflowId) {
    records = records.filter(r => r.workflow_id === workflowId);
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  const arrivals = [];
  records.forEach(r => {
    if (!r.received) return;
    const parts = r.received.split(' ');
    const date = parts[0];
    const timePart = parts[1];
    if (!timePart || date < cutoffStr) return;

    const [hh, mm] = timePart.split(':').map(Number);
    const decimalHour = hh + mm / 60;

    arrivals.push({
      date,
      time: Math.round(decimalHour * 100) / 100,
      file_name: r.file_name
    });
  });

  return arrivals.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get file size distribution for a workflow over time
 */
function getSizeTrend(workflowId, days = 30) {
  let records = loadAllRecords();

  if (workflowId) {
    records = records.filter(r => r.workflow_id === workflowId);
  }

  // Only records with sizes and dates
  const withSizes = records
    .filter(r => r.size_kb && r.received)
    .sort((a, b) => a.received.localeCompare(b.received))
    .slice(-days * 50); // approximate

  return withSizes.map(r => ({
    date: r.received,
    size_kb: r.size_kb
  }));
}

// ===================== WORKFLOW ANALYSIS (AI Insights) =====================

/**
 * Generate per-workflow file trend analysis
 * Returns detailed stats for each workflow: timing, volume, size, patterns
 */
function getWorkflowAnalysis() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return workflows.map(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf);

    // --- Group by date ---
    const byDate = {};
    const byDayOfWeek = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const arrivalHours = [];

    wfRecords.forEach(r => {
      if (!r.received) return;
      const parts = r.received.split(' ');
      const date = parts[0];
      const timePart = parts[1];

      if (!byDate[date]) byDate[date] = { count: 0, sizes: [], times: [] };
      byDate[date].count++;
      if (r.size_kb) byDate[date].sizes.push(r.size_kb);

      if (timePart) {
        const [hh, mm] = timePart.split(':').map(Number);
        const decimalHour = hh + mm / 60;
        byDate[date].times.push(decimalHour);
        arrivalHours.push(decimalHour);
      }

      // Day of week
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        byDayOfWeek[d.getDay()]++;
      }
    });

    const dates = Object.keys(byDate).sort();
    const dailyCounts = Object.values(byDate).map(d => d.count);

    // --- 1. When files start coming in daily (average first arrival) ---
    const firstArrivals = Object.values(byDate)
      .filter(d => d.times.length > 0)
      .map(d => Math.min(...d.times));
    const avgFirstArrival = firstArrivals.length > 0
      ? firstArrivals.reduce((s, v) => s + v, 0) / firstArrivals.length
      : null;

    // --- 2. Average files received daily ---
    const avgDailyCount = dailyCounts.length > 0
      ? Math.round(dailyCounts.reduce((s, v) => s + v, 0) / dailyCounts.length)
      : 0;

    // --- 3. Average file size ---
    const allSizes = wfRecords.filter(r => r.size_kb).map(r => r.size_kb);
    const avgSize = allSizes.length > 0
      ? Math.round(allSizes.reduce((s, v) => s + v, 0) / allSizes.length * 100) / 100
      : 0;

    // --- 4. Date with most / fewest files ---
    let peakDate = null, peakCount = 0, quietDate = null, quietCount = Infinity;
    Object.entries(byDate).forEach(([date, data]) => {
      if (data.count > peakCount) { peakCount = data.count; peakDate = date; }
      if (data.count < quietCount) { quietCount = data.count; quietDate = date; }
    });

    // --- 5. Peak hours (80% of files arrive between...) ---
    let peakHourStart = null, peakHourEnd = null;
    if (arrivalHours.length > 0) {
      const sorted = [...arrivalHours].sort((a, b) => a - b);
      const p10 = sorted[Math.floor(sorted.length * 0.1)];
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      peakHourStart = p10;
      peakHourEnd = p90;
    }

    // --- 6. Size range (min/max) ---
    const minSize = allSizes.length > 0 ? Math.min(...allSizes) : 0;
    const maxSize = allSizes.length > 0 ? Math.max(...allSizes) : 0;

    // --- 7. Status distribution ---
    const statusDist = {};
    wfRecords.forEach(r => {
      statusDist[r.status] = (statusDist[r.status] || 0) + 1;
    });
    const totalCount = wfRecords.length;

    // --- 8. Busiest day of week ---
    const busiestDayIdx = Object.entries(byDayOfWeek)
      .sort(([, a], [, b]) => b - a)[0];
    const quietestDayIdx = Object.entries(byDayOfWeek)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => a - b)[0];

    // --- 9. Error rate ---
    const errors = wfRecords.filter(r => r.status === '999').length;
    const errorRate = totalCount > 0 ? Math.round((errors / totalCount) * 10000) / 100 : 0;

    return {
      workflow_id: wf,
      totalRecords: totalCount,
      totalDays: dates.length,
      dateRange: { from: dates[0] || null, to: dates[dates.length - 1] || null },

      // Core analysis
      avgFirstArrival: avgFirstArrival != null ? Math.round(avgFirstArrival * 100) / 100 : null,
      avgDailyCount,
      avgSizeKb: avgSize,
      peakDate: { date: peakDate, count: peakCount },
      quietDate: { date: quietDate, count: quietCount },

      // Additional insights
      peakHours: { start: peakHourStart, end: peakHourEnd },
      sizeRange: { min: Math.round(minSize * 100) / 100, max: Math.round(maxSize * 100) / 100 },
      statusDistribution: Object.entries(statusDist).map(([status, count]) => ({
        status, count, percentage: Math.round((count / totalCount) * 10000) / 100
      })),
      busiestDayOfWeek: busiestDayIdx ? { day: dayNames[parseInt(busiestDayIdx[0])], count: busiestDayIdx[1] } : null,
      quietestDayOfWeek: quietestDayIdx ? { day: dayNames[parseInt(quietestDayIdx[0])], count: quietestDayIdx[1] } : null,
      errorRate,
      errors
    };
  });
}

// ===================== ALERTS TAB =====================

/**
 * Generate alerts from real data — flag errors (status 999) and unusually large files
 */
function getAlerts(filters = {}) {
  const records = loadAllRecords();
  const alerts = [];

  // Alert 1: All records with status 999 (error)
  const errorRecords = records.filter(r => r.status === '999');
  errorRecords.forEach((r, i) => {
    alerts.push({
      id: i + 1,
      severity: 'critical',
      type: 'error_status',
      title: `Error status on ${r.file_name}`,
      message: `Document "${r.file_name}" in workflow ${r.workflow_id} has error status (999).`,
      workflow_id: r.workflow_id,
      source: r.workflow_id,
      received: r.received,
      acknowledged: false,
      created_at: r.received
    });
  });

  // Alert 2: Unusually large files (> 100KB) — informational
  const largeFiles = records.filter(r => r.size_kb && r.size_kb > 100);
  largeFiles.slice(0, 20).forEach((r, i) => {
    alerts.push({
      id: errorRecords.length + i + 1,
      severity: 'info',
      type: 'large_file',
      title: `Large file: ${r.file_name}`,
      message: `File size ${r.size_kb} KB exceeds 100KB threshold in workflow ${r.workflow_id}.`,
      workflow_id: r.workflow_id,
      source: r.workflow_id,
      received: r.received,
      acknowledged: false,
      created_at: r.received
    });
  });

  // Alert 3: Status 45 (in-progress/not completed) — warning
  const inProgressRecords = records.filter(r => r.status === '45');
  if (inProgressRecords.length > 0) {
    // Group by workflow
    const byWorkflow = {};
    inProgressRecords.forEach(r => {
      byWorkflow[r.workflow_id] = (byWorkflow[r.workflow_id] || 0) + 1;
    });

    Object.entries(byWorkflow).forEach(([wf, count], i) => {
      alerts.push({
        id: errorRecords.length + 20 + i + 1,
        severity: 'warning',
        type: 'incomplete_status',
        title: `${count} documents pending in ${wf}`,
        message: `${count} document(s) in workflow "${wf}" have status 45 (not yet completed).`,
        workflow_id: wf,
        source: wf,
        received: inProgressRecords.find(r => r.workflow_id === wf)?.received,
        acknowledged: false,
        created_at: inProgressRecords.find(r => r.workflow_id === wf)?.received
      });
    });
  }

  // Apply filters
  let filtered = alerts;
  if (filters.severity) {
    filtered = filtered.filter(a => a.severity === filters.severity);
  }
  if (filters.workflow_id) {
    filtered = filtered.filter(a => a.workflow_id && a.workflow_id.toLowerCase().includes(filters.workflow_id.toLowerCase()));
  }

  // Sort by severity priority then date
  const sevOrder = { critical: 0, warning: 1, info: 2 };
  filtered.sort((a, b) => (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3));

  return filtered;
}

/**
 * Get alert statistics
 */
function getAlertStats() {
  const alerts = getAlerts();
  const critical = alerts.filter(a => a.severity === 'critical').length;
  const warning = alerts.filter(a => a.severity === 'warning').length;
  const info = alerts.filter(a => a.severity === 'info').length;

  // Most problematic workflow
  const counts = {};
  alerts.forEach(a => {
    if (a.workflow_id) counts[a.workflow_id] = (counts[a.workflow_id] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);

  return {
    total: alerts.length,
    critical,
    warning,
    info,
    mostProblematic: sorted[0] ? sorted[0][0] : null,
    mostProblematicCount: sorted[0] ? sorted[0][1] : 0
  };
}

// ===================== INSIGHTS TAB =====================

/**
 * Get reliability scores per workflow based on completion rate (status 50)
 */
function getReliabilityScores() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();

  return workflows.map(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf);
    const completed = wfRecords.filter(r => r.status === '50').length;
    const total = wfRecords.length;
    const score = total > 0 ? Math.round((completed / total) * 100) / 100 : 0;

    return {
      workflow_id: wf,
      workflow_name: wf,
      reliability_score: score,
      total_records: total,
      completed,
      errors: wfRecords.filter(r => r.status === '999').length
    };
  });
}

/**
 * Generate AI weekly summary from real data
 */
function generateSummary() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();
  const reliability = getReliabilityScores();
  const alertStats = getAlertStats();

  const totalRecords = records.length;
  const completed = records.filter(r => r.status === '50').length;
  const errors = records.filter(r => r.status === '999').length;
  const inProgress = records.filter(r => r.status === '45').length;
  const completionRate = totalRecords > 0 ? Math.round((completed / totalRecords) * 100) : 0;

  // Date range
  const dates = records.filter(r => r.received).map(r => r.received.split(' ')[0]);
  const minDate = dates.length > 0 ? dates[dates.length - 1] : 'N/A';
  const maxDate = dates.length > 0 ? dates[0] : 'N/A';

  // Most active workflow
  const wfCounts = {};
  records.forEach(r => { wfCounts[r.workflow_id] = (wfCounts[r.workflow_id] || 0) + 1; });
  const mostActive = Object.entries(wfCounts).sort(([, a], [, b]) => b - a)[0];

  // Lowest reliability
  const lowestReliability = reliability.filter(r => r.total_records > 10)
    .sort((a, b) => a.reliability_score - b.reliability_score)[0];

  let summary = `eHub Document Pipeline Summary\n`;
  summary += `Period: ${minDate} to ${maxDate}\n\n`;
  summary += `Total Documents Processed: ${totalRecords.toLocaleString()}\n`;
  summary += `Workflows Monitored: ${workflows.length}\n`;
  summary += `Overall Completion Rate: ${completionRate}%\n\n`;
  summary += `Status Breakdown:\n`;
  summary += `  • Completed (50): ${completed.toLocaleString()} documents\n`;
  summary += `  • In Progress (45): ${inProgress.toLocaleString()} documents\n`;
  summary += `  • Errors (999): ${errors.toLocaleString()} documents\n\n`;

  if (mostActive) {
    summary += `Most Active Workflow: ${mostActive[0]} (${mostActive[1].toLocaleString()} docs)\n`;
  }
  if (lowestReliability) {
    summary += `Lowest Reliability: ${lowestReliability.workflow_name} (${Math.round(lowestReliability.reliability_score * 100)}%, ${lowestReliability.errors} errors)\n`;
  }
  if (alertStats.critical > 0) {
    summary += `\n⚠️ ${alertStats.critical} critical alert(s) require attention.\n`;
  }

  return {
    summary,
    metrics: {
      totalRecords,
      completionRate,
      completed,
      inProgress,
      errors,
      totalWorkflows: workflows.length,
      dateRange: { from: minDate, to: maxDate }
    }
  };
}

/**
 * Generate predictions based on data patterns
 */
function generatePredictions() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();
  const predictions = [];

  for (const wf of workflows) {
    const wfRecords = records.filter(r => r.workflow_id === wf);
    const errors = wfRecords.filter(r => r.status === '999').length;
    const total = wfRecords.length;
    const errorRate = total > 0 ? errors / total : 0;

    // Predict if error rate is concerning
    if (errorRate > 0.05 && errors > 5) {
      predictions.push({
        workflow_id: wf,
        workflow_name: wf,
        prediction: `Error rate at ${Math.round(errorRate * 100)}% (${errors} errors out of ${total} documents). Investigate root cause.`,
        severity: errorRate > 0.1 ? 'critical' : 'warning',
        confidence: Math.min(0.95, 0.5 + errorRate * 2)
      });
    }

    // Predict volume trends — check if recent days have fewer docs
    const dates = [...new Set(wfRecords.filter(r => r.received).map(r => r.received.split(' ')[0]))].sort();
    if (dates.length >= 2) {
      const recentDate = dates[dates.length - 1];
      const olderDate = dates[0];
      const recentCount = wfRecords.filter(r => r.received && r.received.startsWith(recentDate)).length;
      const olderCount = wfRecords.filter(r => r.received && r.received.startsWith(olderDate)).length;

      if (olderCount > recentCount * 2 && olderCount > 20) {
        predictions.push({
          workflow_id: wf,
          workflow_name: wf,
          prediction: `Volume drop detected: ${olderCount} docs on ${olderDate} vs ${recentCount} on ${recentDate}. May indicate upstream issues.`,
          severity: 'warning',
          confidence: 0.6
        });
      }
    }
  }

  return predictions;
}

/**
 * Get anomalies — records with status 999 or unusually large sizes
 */
function getAnomalies() {
  const records = loadAllRecords();
  const anomalies = [];

  // Error status anomalies
  records.filter(r => r.status === '999').forEach(r => {
    anomalies.push({
      workflow_id: r.workflow_id,
      workflow_name: r.workflow_id,
      type: 'error_status',
      severity: 'critical',
      date: r.received,
      file_name: r.file_name,
      detail: `Status 999 error`
    });
  });

  // Size anomalies — calculate per-workflow stats
  const workflows = getDistinctWorkflows();
  for (const wf of workflows) {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.size_kb);
    if (wfRecords.length < 5) continue;

    const sizes = wfRecords.map(r => r.size_kb);
    const mean = sizes.reduce((s, v) => s + v, 0) / sizes.length;
    const stdDev = Math.sqrt(sizes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (sizes.length - 1));

    if (stdDev === 0) continue;

    wfRecords.forEach(r => {
      const zScore = (r.size_kb - mean) / stdDev;
      if (Math.abs(zScore) > 2.5) {
        anomalies.push({
          workflow_id: r.workflow_id,
          workflow_name: r.workflow_id,
          type: 'size_anomaly',
          severity: Math.abs(zScore) > 3 ? 'critical' : 'warning',
          date: r.received,
          file_name: r.file_name,
          zScore: Math.round(zScore * 100) / 100,
          detail: `Size ${r.size_kb} KB (z-score: ${Math.round(zScore * 100) / 100})`
        });
      }
    });
  }

  // Sort by severity then date
  const sevOrder = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3));

  return anomalies.slice(0, 100); // cap at 100
}

// ===================== CACHE =====================

function invalidateCache() {
  cachedRecords = null;
}

// ===================== SLA COMPLIANCE =====================

/**
 * SLA Compliance — checks if files arrive within expected time windows per workflow
 * Uses peak hours (10th-90th percentile) as the "expected window"
 */
function getSlaCompliance() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return workflows.map(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.received);

    // Determine SLA window from historical 10th-90th percentile
    const arrivalHours = [];
    wfRecords.forEach(r => {
      const parts = r.received.split(' ');
      const timePart = parts[1];
      if (!timePart) return;
      const [hh, mm] = timePart.split(':').map(Number);
      arrivalHours.push(hh + mm / 60);
    });

    if (arrivalHours.length < 10) {
      return { workflow_id: wf, totalDays: 0, slaWindow: null, compliance: 0, missedDays: [] };
    }

    const sorted = [...arrivalHours].sort((a, b) => a - b);
    const slaStart = sorted[Math.floor(sorted.length * 0.1)];
    const slaEnd = sorted[Math.floor(sorted.length * 0.9)];

    // Group by date, check if any file arrived outside SLA window
    const byDate = {};
    wfRecords.forEach(r => {
      const parts = r.received.split(' ');
      const date = parts[0];
      const timePart = parts[1];
      if (!timePart) return;
      const [hh, mm] = timePart.split(':').map(Number);
      const hour = hh + mm / 60;

      if (!byDate[date]) byDate[date] = { withinSla: 0, outsideSla: 0, total: 0 };
      byDate[date].total++;
      if (hour >= slaStart && hour <= slaEnd) {
        byDate[date].withinSla++;
      } else {
        byDate[date].outsideSla++;
      }
    });

    const dates = Object.keys(byDate).sort();
    const totalDays = dates.length;
    const compliantDays = dates.filter(d => byDate[d].outsideSla === 0).length;
    const compliance = totalDays > 0 ? Math.round((compliantDays / totalDays) * 100) : 0;

    // Missed SLA days (most recent first)
    const missedDays = dates
      .filter(d => byDate[d].outsideSla > 0)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 10)
      .map(d => ({
        date: d,
        outsideSla: byDate[d].outsideSla,
        total: byDate[d].total
      }));

    return {
      workflow_id: wf,
      totalDays,
      slaWindow: { start: Math.round(slaStart * 100) / 100, end: Math.round(slaEnd * 100) / 100 },
      compliance,
      compliantDays,
      missedDays
    };
  });
}

// ===================== WEEK-OVER-WEEK COMPARISON =====================

/**
 * Compare current week vs previous week for each workflow
 */
function getWeekOverWeek() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();

  // Determine the latest date in data
  const allDates = records.filter(r => r.received).map(r => r.received.split(' ')[0]).sort();
  if (allDates.length === 0) return [];

  const latestDate = new Date(allDates[allDates.length - 1]);
  const currentWeekStart = new Date(latestDate);
  currentWeekStart.setDate(latestDate.getDate() - 6); // last 7 days
  const prevWeekStart = new Date(currentWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const cwStart = currentWeekStart.toISOString().split('T')[0];
  const cwEnd = latestDate.toISOString().split('T')[0];
  const pwStart = prevWeekStart.toISOString().split('T')[0];
  const pwEnd = new Date(currentWeekStart.getTime() - 86400000).toISOString().split('T')[0];

  return workflows.map(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.received);

    const currentWeek = wfRecords.filter(r => {
      const d = r.received.split(' ')[0];
      return d >= cwStart && d <= cwEnd;
    });
    const prevWeek = wfRecords.filter(r => {
      const d = r.received.split(' ')[0];
      return d >= pwStart && d <= pwEnd;
    });

    const cwCount = currentWeek.length;
    const pwCount = prevWeek.length;
    const volumeChange = pwCount > 0 ? Math.round(((cwCount - pwCount) / pwCount) * 100) : 0;

    // Average arrival time comparison
    const getAvgHour = (recs) => {
      const hours = [];
      recs.forEach(r => {
        const timePart = r.received.split(' ')[1];
        if (!timePart) return;
        const [hh, mm] = timePart.split(':').map(Number);
        hours.push(hh + mm / 60);
      });
      return hours.length > 0 ? hours.reduce((s, v) => s + v, 0) / hours.length : null;
    };

    const cwAvgHour = getAvgHour(currentWeek);
    const pwAvgHour = getAvgHour(prevWeek);
    const timingShift = (cwAvgHour != null && pwAvgHour != null)
      ? Math.round((cwAvgHour - pwAvgHour) * 60) // in minutes
      : null;

    // Error comparison
    const cwErrors = currentWeek.filter(r => r.status === '999').length;
    const pwErrors = prevWeek.filter(r => r.status === '999').length;

    // Avg size comparison
    const getAvgSize = (recs) => {
      const sizes = recs.filter(r => r.size_kb).map(r => r.size_kb);
      return sizes.length > 0 ? Math.round(sizes.reduce((s, v) => s + v, 0) / sizes.length * 100) / 100 : 0;
    };

    return {
      workflow_id: wf,
      period: { current: `${cwStart} to ${cwEnd}`, previous: `${pwStart} to ${pwEnd}` },
      volume: { current: cwCount, previous: pwCount, change: volumeChange },
      timing: { current: cwAvgHour, previous: pwAvgHour, shiftMinutes: timingShift },
      errors: { current: cwErrors, previous: pwErrors },
      avgSize: { current: getAvgSize(currentWeek), previous: getAvgSize(prevWeek) }
    };
  });
}

// ===================== WORKFLOW HEALTH HEATMAP =====================

/**
 * Heatmap data — workflows × days, colored by health
 * Health: green (normal), yellow (low volume/late), red (errors/no files)
 */
function getHealthHeatmap(days = 14) {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();

  // Determine date range
  const allDates = records.filter(r => r.received).map(r => r.received.split(' ')[0]);
  if (allDates.length === 0) return { workflows: [], dates: [], data: [] };

  const sortedDates = [...new Set(allDates)].sort();
  const recentDates = sortedDates.slice(-days);

  // Calculate avg daily count per workflow (for baseline)
  const avgCounts = {};
  workflows.forEach(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.received);
    const byDate = {};
    wfRecords.forEach(r => {
      const d = r.received.split(' ')[0];
      byDate[d] = (byDate[d] || 0) + 1;
    });
    const counts = Object.values(byDate);
    avgCounts[wf] = counts.length > 0 ? counts.reduce((s, v) => s + v, 0) / counts.length : 0;
  });

  // Build heatmap grid
  const data = workflows.map(wf => {
    return recentDates.map(date => {
      const dayRecords = records.filter(r => r.workflow_id === wf && r.received && r.received.startsWith(date));
      const count = dayRecords.length;
      const errors = dayRecords.filter(r => r.status === '999').length;
      const avg = avgCounts[wf];

      // Determine health: 0=no data, 1=red (errors/very low), 2=yellow (below avg), 3=green (normal)
      let health = 3;
      if (count === 0) health = 0;
      else if (errors > 0) health = 1;
      else if (count < avg * 0.3) health = 2;

      return { date, count, errors, health };
    });
  });

  return {
    workflows,
    dates: recentDates,
    data // data[workflowIndex][dateIndex]
  };
}

// ===================== TRADING PARTNER ACTIVITY =====================

/**
 * Trading partner activity summary — grouped by sender/receiver pairs
 * Extracts from workflow_id which contains the partner info
 */
function getTradingPartnerActivity() {
  const records = loadAllRecords();
  const workflows = getDistinctWorkflows();

  return workflows.map(wf => {
    const wfRecords = records.filter(r => r.workflow_id === wf && r.received);

    // Extract sender/receiver from workflow_id pattern: ORDERS_SENDER_RECEIVER_OWNER
    const parts = wf.replace(/^ORDERS_/, '').replace(/_PDF_/, '_').split('_');
    let sender = '—', receiver = '—';
    if (parts.length >= 4) {
      sender = parts[0] + '_' + parts[1]; // e.g. ACME_RETAIL
      receiver = parts[2] + '_' + parts[3]; // e.g. ZENITH_SUPPLY
    } else if (parts.length >= 2) {
      sender = parts[0];
      receiver = parts[1];
    }

    // Last active date
    const dates = wfRecords.map(r => r.received.split(' ')[0]).sort();
    const lastActive = dates.length > 0 ? dates[dates.length - 1] : null;
    const firstSeen = dates.length > 0 ? dates[0] : null;

    // Total docs
    const totalDocs = wfRecords.length;

    // Check for gaps — days with zero activity (within the active date range)
    const uniqueDates = [...new Set(dates)];
    let gaps = [];
    if (uniqueDates.length >= 2) {
      const start = new Date(uniqueDates[0]);
      const end = new Date(uniqueDates[uniqueDates.length - 1]);
      const dateSet = new Set(uniqueDates);

      const current = new Date(start);
      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        const dayOfWeek = current.getDay();
        // Only flag weekday gaps (Mon-Fri) — weekends might be expected to have no data
        if (!dateSet.has(dateStr) && dayOfWeek !== 0 && dayOfWeek !== 6) {
          gaps.push(dateStr);
        }
        current.setDate(current.getDate() + 1);
      }
    }

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysStr = sevenDaysAgo.toISOString().split('T')[0];
    const recentDocs = wfRecords.filter(r => r.received.split(' ')[0] >= sevenDaysStr).length;

    // Days since last activity
    let daysSinceActive = null;
    if (lastActive) {
      const last = new Date(lastActive);
      const now = new Date();
      daysSinceActive = Math.floor((now - last) / 86400000);
    }

    return {
      workflow_id: wf,
      sender,
      receiver,
      totalDocs,
      firstSeen,
      lastActive,
      daysSinceActive,
      recentDocs,
      totalActiveDays: uniqueDates.length,
      gaps: gaps.length,
      recentGaps: gaps.slice(-5) // last 5 gap dates
    };
  });
}

module.exports = {
  // Files
  getRecords,
  getDistinctWorkflows,
  getDistinctStatuses,
  // Overview
  getOverviewStats,
  // Trends
  getTrendData,
  getArrivalTimes,
  getSizeTrend,
  // Workflow Analysis
  getWorkflowAnalysis,
  // Insights - new
  getSlaCompliance,
  getWeekOverWeek,
  getHealthHeatmap,
  getTradingPartnerActivity,
  // Alerts
  getAlerts,
  getAlertStats,
  // Insights - existing
  getReliabilityScores,
  generateSummary,
  generatePredictions,
  getAnomalies,
  // Utils
  invalidateCache,
  loadAllRecords
};
