// Chatbot Service — Comprehensive DM Assistant
// Full knowledge of eHub B2B document monitoring, all dashboard features,
// data analysis capabilities, and domain expertise

const trendDataService = require('./trendDataService');

// ===================== INTENT MATCHING =====================

const INTENTS = [
  // Greetings & Help
  { intent: 'help', patterns: [/\bhelp\b/i, /what can you do/i, /commands/i, /\bhi\b/i, /\bhello\b/i, /\bhey\b/i, /how do i/i, /guide/i] },
  { intent: 'about', patterns: [/what is this/i, /about this/i, /what.?s this dashboard/i, /explain.+dashboard/i] },
  { intent: 'tabs', patterns: [/\btab/i, /where.+(find|see|look|go)/i, /which tab/i, /navigate/i, /section/i] },

  // Status code explanation (before general status)
  { intent: 'explain_status', patterns: [/what.+does.+\d+.+mean/i, /explain.+status/i, /what.+status.+mean/i, /what.+code/i, /meaning of/i, /what does status/i, /what is status/i] },

  // Status & Overview
  { intent: 'status', patterns: [/\bstatus\b/i, /today/i, /how.?s? ?(everything|things)/i, /what.?s? happening/i, /overview/i, /current/i] },
  { intent: 'workflows', patterns: [/list workflow/i, /which workflow/i, /all workflow/i, /how many workflow/i, /show workflow/i] },
  { intent: 'workflow_detail', patterns: [/tell me about (.+)/i, /details? (?:on|for|about) (.+)/i, /(.+) workflow/i] },

  // Errors & Problems
  { intent: 'errors', patterns: [/error/i, /\b999\b/i, /fail/i, /problem/i, /issue/i, /wrong/i, /broken/i] },
  { intent: 'in_progress', patterns: [/in.?progress/i, /pending/i, /status 45/i, /\b45\b/i, /not complete/i, /incomplete/i, /stuck/i] },

  // SLA & Compliance
  { intent: 'sla', patterns: [/sla/i, /compliance/i, /on.?time/i, /within.+window/i, /meeting.+target/i, /service level/i] },
  { intent: 'late', patterns: [/late/i, /delay/i, /behind/i, /overdue/i, /slow/i] },

  // Timing & Patterns
  { intent: 'timing', patterns: [/when.+(arrive|come|receive)/i, /what time/i, /timing/i, /arrival time/i, /usually.+receive/i, /peak hour/i] },
  { intent: 'pattern', patterns: [/pattern/i, /trend/i, /day of week/i, /busiest/i, /quietest/i, /which day/i, /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i] },

  // Volume & Counts
  { intent: 'count', patterns: [/how many/i, /total/i, /count/i, /volume/i, /number of/i] },
  { intent: 'compare', patterns: [/compar/i, /week.?over/i, /vs/i, /versus/i, /change/i, /increase/i, /decrease/i, /differ/i] },

  // Size
  { intent: 'size', patterns: [/size/i, /large/i, /big/i, /small/i, /biggest/i, /largest/i, /smallest/i, /kb\b/i, /byte/i] },

  // Analysis (before partners/summary so "analyze ACME_RETAIL" works)
  { intent: 'analysis', patterns: [/\banaly/i, /deep.?dive/i, /investigate/i, /diagnos/i, /root cause/i] },

  // Trading Partners
  { intent: 'partners', patterns: [/partner/i, /sender/i, /receiver/i, /trading/i] },
  { intent: 'gaps', patterns: [/gap/i, /missing day/i, /no data/i, /silent/i, /inactive/i, /stopped/i, /no file/i] },

  // Health & Alerts
  { intent: 'health', patterns: [/health/i, /heatmap/i, /red/i, /green/i, /yellow/i] },
  { intent: 'alerts', patterns: [/alert/i, /critical/i, /warning/i, /attention/i, /urgent/i] },

  // Analysis & Insights
  { intent: 'summary', patterns: [/summary/i, /summar/i, /report/i, /brief/i, /give me/i, /overview/i] },
  { intent: 'predict', patterns: [/predict/i, /expect/i, /tomorrow/i, /next week/i, /forecast/i, /will.+receive/i, /should i/i] },

  // Recent & Specific
  { intent: 'recent', patterns: [/recent/i, /latest/i, /last/i, /new/i, /most recent/i, /just received/i] },

  // System & Data source
  { intent: 'data_source', patterns: [/data source/i, /where.+data/i, /csv/i, /connected/i, /provider/i, /ehub/i, /system/i, /technical/i] },
];

/**
 * Parse user message and return matching intent + captured groups
 */
function parseIntent(message) {
  for (const { intent, patterns } of INTENTS) {
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        return { intent, match };
      }
    }
  }
  return { intent: 'unknown', match: null };
}

/**
 * Find workflow by partial name match
 */
function findWorkflow(query) {
  if (!query) return null;
  const workflows = trendDataService.getDistinctWorkflows();
  const q = query.toLowerCase().replace(/[_\s-]+/g, '');
  return workflows.find(w => w.toLowerCase().replace(/[_\s-]+/g, '').includes(q));
}

// ===================== RESPONSE HANDLERS =====================

function processMessage(message) {
  const { intent, match } = parseIntent(message);
  let reply = '';
  let suggestions = [];

  try {
    switch (intent) {

      // ============ HELP & NAVIGATION ============

      case 'help':
        reply = `👋 Hi! I'm **DM Assistant** — your eHub document monitoring helper.\n\nI can answer questions about:\n\n` +
          `📊 **Status** — "What's the current status?", "Any issues?"\n` +
          `📁 **Workflows** — "List workflows", "Tell me about ACME_RETAIL"\n` +
          `🔴 **Errors** — "Any errors?", "What's failing?"\n` +
          `📋 **SLA** — "SLA compliance?", "Are we on time?"\n` +
          `⏰ **Timing** — "When do files arrive?", "Peak hours?"\n` +
          `📈 **Trends** — "Compare this week vs last", "Any patterns?"\n` +
          `📦 **Size** — "Largest files?", "Average file size?"\n` +
          `🤝 **Partners** — "Trading partner activity?", "Any gaps?"\n` +
          `🟩 **Health** — "Workflow health?", "Which ones are red?"\n` +
          `🔔 **Alerts** — "Any critical alerts?"\n` +
          `🤖 **Analysis** — "Analyze ACME_RETAIL workflow", "Why are there errors?"\n` +
          `⚙️ **System** — "Data source?", "What does status 50 mean?"\n\n` +
          `Just ask naturally — I understand context!`;
        suggestions = ['Current status', 'Any errors?', 'SLA compliance', 'Compare weeks'];
        break;

      case 'about':
        reply = `📊 **DM Monitoring Dashboard**\n\n` +
          `This is a B2B/EDI document monitoring dashboard for the **eHub integration platform**.\n\n` +
          `It tracks electronic documents (Purchase Orders, invoices, etc.) flowing between trading partners:\n` +
          `• Retailers: Acme Retail, Nova Mart, Orbit Stores, Pixel Shop, Lumen Grocers, Helix Trade\n` +
          `• Suppliers: Zenith Supply, Apex Goods, Vertex Dist, Quantum Co, Stellar Foods, Comet Brands\n\n` +
          `**What the dashboard shows:**\n` +
          `• Document processing status (completed, in-progress, errors)\n` +
          `• Arrival timing patterns\n` +
          `• SLA compliance\n` +
          `• Trading partner activity and health\n` +
          `• Week-over-week trends\n\n` +
          `**Status codes:** 50 = Completed/Archived, 45 = In Progress, 999 = Error`;
        suggestions = ['Current status', 'List workflows', 'Which tab shows alerts?'];
        break;

      case 'tabs':
        reply = `🗂️ **Dashboard Tabs:**\n\n` +
          `**🏠 Overview** — KPIs (total workflows, completion rate, errors, total docs), document distribution chart, recent documents table\n\n` +
          `**📊 Trends** — Arrival time trends (earliest/avg/latest per day), file size trends. Select workflow + date range.\n\n` +
          `**📁 Files** — Full searchable/filterable document list. Filter by workflow, date, status. Paginated.\n\n` +
          `**🔔 Alerts** — Error alerts (status 999), large file alerts, incomplete status warnings. Filter by severity.\n\n` +
          `**🤖 AI Insights** — Per-workflow analysis, SLA compliance, week-over-week comparison, health heatmap, trading partner activity.\n\n` +
          `**💬 Chatbot (me!)** — Ask anything about the data. Available from any tab.`;
        suggestions = ['What does the heatmap show?', 'How to filter files?', 'SLA compliance'];
        break;

      // ============ STATUS & OVERVIEW ============

      case 'status': {
        const overview = trendDataService.getOverviewStats();
        const alertStats = trendDataService.getAlertStats();

        reply = `📊 **Current Pipeline Status:**\n\n` +
          `• Workflows monitored: **${overview.totalWorkflows}**\n` +
          `• Total documents: **${overview.totalRecords.toLocaleString()}**\n` +
          `• Completion rate: **${overview.completionRate}%**\n` +
          `• Completed (status 50): ${overview.completed.toLocaleString()}\n` +
          `• In Progress (status 45): ${overview.inProgress.toLocaleString()}\n` +
          `• Errors (status 999): ${overview.errors.toLocaleString()}\n\n`;

        if (overview.errors > 0) {
          reply += `⚠️ There are ${overview.errors} error(s) that need attention.\n`;
        }
        if (alertStats.critical > 0) {
          reply += `🔴 ${alertStats.critical} critical alert(s) active.\n`;
        }
        reply += `\nLatest data: ${overview.displayDate}`;
        suggestions = ['Any errors?', 'SLA compliance', 'Compare weeks', 'Trading partners'];
        break;
      }

      case 'workflows': {
        const workflows = trendDataService.getDistinctWorkflows();
        const overview = trendDataService.getOverviewStats();

        reply = `📁 **Active Workflows (${workflows.length}):**\n\n`;
        workflows.forEach(w => {
          const count = overview.workflowCounts[w] || 0;
          reply += `• **${w}**\n  ${count.toLocaleString()} documents\n`;
        });
        reply += `\nAsk "tell me about [workflow name]" for detailed analysis.`;
        suggestions = workflows.slice(0, 3).map(w => `Tell me about ${w.replace('ORDERS_', '').split('_').slice(0, 2).join('_')}`);
        break;
      }

      case 'workflow_detail': {
        const query = match[1] || message.replace(/tell me about|details? (?:on|for|about)|workflow/gi, '').trim();
        const wf = findWorkflow(query);

        if (!wf) {
          const workflows = trendDataService.getDistinctWorkflows();
          reply = `❓ I couldn't find a workflow matching "${query}". Available workflows:\n\n`;
          workflows.forEach(w => { reply += `• ${w}\n`; });
          suggestions = ['List workflows', 'Status'];
        } else {
          const analysis = trendDataService.getWorkflowAnalysis().find(a => a.workflow_id === wf);
          if (analysis) {
            reply = `📋 **${wf}**\n\n` +
              `• Total documents: ${analysis.totalRecords.toLocaleString()}\n` +
              `• Active for: ${analysis.totalDays} days (${analysis.dateRange.from} to ${analysis.dateRange.to})\n` +
              `• Files start arriving: ~${formatHour(analysis.avgFirstArrival)} daily\n` +
              `• Average volume: ${analysis.avgDailyCount} files/day\n` +
              `• Average file size: ${analysis.avgSizeKb} KB (range: ${analysis.sizeRange.min}–${analysis.sizeRange.max} KB)\n` +
              `• Peak hours (80% of files): ${formatHour(analysis.peakHours.start)} — ${formatHour(analysis.peakHours.end)}\n` +
              `• Busiest day: ${analysis.busiestDayOfWeek?.day || '—'} (${analysis.busiestDayOfWeek?.count?.toLocaleString() || 0} total)\n` +
              `• Quietest day: ${analysis.quietestDayOfWeek?.day || '—'}\n` +
              `• Peak date: ${analysis.peakDate.date} (${analysis.peakDate.count} files)\n` +
              `• Error rate: ${analysis.errorRate}% (${analysis.errors} errors)\n`;
          }
          suggestions = ['SLA for this workflow?', 'Any gaps?', 'Compare weeks'];
        }
        break;
      }

      // ============ ERRORS & PROBLEMS ============

      case 'errors': {
        const overview = trendDataService.getOverviewStats();
        const alerts = trendDataService.getAlerts({ severity: 'critical' });

        if (overview.errors === 0) {
          reply = `✅ **No errors found!** All ${overview.totalRecords.toLocaleString()} documents have processed successfully or are in progress.\n\nStatus breakdown:\n• Completed (50): ${overview.completed.toLocaleString()}\n• In Progress (45): ${overview.inProgress.toLocaleString()}`;
        } else {
          reply = `🔴 **${overview.errors} Error(s) Detected (Status 999):**\n\n`;

          // Group errors by workflow
          const records = trendDataService.loadAllRecords();
          const errorRecords = records.filter(r => r.status === '999');
          const byWorkflow = {};
          errorRecords.forEach(r => {
            byWorkflow[r.workflow_id] = (byWorkflow[r.workflow_id] || []);
            byWorkflow[r.workflow_id].push(r);
          });

          Object.entries(byWorkflow).forEach(([wf, recs]) => {
            reply += `**${wf}** — ${recs.length} error(s)\n`;
            recs.slice(0, 3).forEach(r => {
              reply += `  • ${r.file_name} (${r.received || '—'})\n`;
            });
            if (recs.length > 3) reply += `  • ...and ${recs.length - 3} more\n`;
            reply += `\n`;
          });

          reply += `💡 **Possible causes:** Network timeout, malformed document, validation failure, partner system down.\n`;
          reply += `📍 Check the **Alerts** tab for full details.`;
        }
        suggestions = ['Which workflow has most errors?', 'Trading partner activity', 'Status'];
        break;
      }

      case 'in_progress': {
        const overview = trendDataService.getOverviewStats();
        const records = trendDataService.loadAllRecords();
        const pending = records.filter(r => r.status === '45');

        reply = `🟡 **In-Progress Documents (Status 45): ${overview.inProgress}**\n\n`;

        if (pending.length === 0) {
          reply += `All documents have been fully processed. Nothing pending.`;
        } else {
          reply += `These documents haven't completed processing yet:\n\n`;
          const byWorkflow = {};
          pending.forEach(r => {
            byWorkflow[r.workflow_id] = (byWorkflow[r.workflow_id] || []);
            byWorkflow[r.workflow_id].push(r);
          });

          Object.entries(byWorkflow).forEach(([wf, recs]) => {
            reply += `**${wf}** — ${recs.length} pending\n`;
            recs.slice(0, 3).forEach(r => {
              reply += `  • ${r.file_name} (received: ${r.received || '—'})\n`;
            });
            reply += `\n`;
          });

          reply += `💡 Status 45 means the document is being processed (routing, transformation, delivery). If stuck for hours, investigate the integration engine.`;
        }
        suggestions = ['Any errors?', 'Status', 'Health heatmap'];
        break;
      }

      // ============ SLA & COMPLIANCE ============

      case 'sla': {
        const sla = trendDataService.getSlaCompliance();

        reply = `📋 **SLA Compliance Summary:**\n\n`;
        reply += `SLA window is auto-detected from historical patterns (10th–90th percentile of arrival times).\n\n`;

        sla.forEach(wf => {
          const icon = wf.compliance >= 90 ? '🟢' : wf.compliance >= 75 ? '🟡' : '🔴';
          const window = wf.slaWindow ? `${formatHour(wf.slaWindow.start)}–${formatHour(wf.slaWindow.end)}` : '—';
          reply += `${icon} **${wf.workflow_id}**\n`;
          reply += `   Window: ${window} | Compliance: ${wf.compliance}% | Missed: ${wf.missedDays.length} day(s)\n\n`;
        });

        reply += `📍 Full details in **AI Insights** tab > SLA Compliance section.`;
        suggestions = ['Why is compliance low?', 'Which workflow is worst?', 'Timing patterns'];
        break;
      }

      case 'late': {
        const sla = trendDataService.getSlaCompliance();
        const worstSla = sla.sort((a, b) => a.compliance - b.compliance)[0];

        reply = `⏰ **Late File Analysis:**\n\n`;

        if (worstSla && worstSla.compliance < 100) {
          reply += `Workflow with most SLA misses: **${worstSla.workflow_id}**\n`;
          reply += `• Compliance: ${worstSla.compliance}%\n`;
          reply += `• SLA window: ${formatHour(worstSla.slaWindow?.start)}–${formatHour(worstSla.slaWindow?.end)}\n`;
          reply += `• Recent missed days:\n`;
          worstSla.missedDays.slice(0, 5).forEach(d => {
            reply += `  • ${d.date}: ${d.outsideSla} file(s) outside window\n`;
          });
          reply += `\n💡 **Common reasons for late arrivals:**\n`;
          reply += `• Source system processing delays\n`;
          reply += `• Network/connectivity issues\n`;
          reply += `• Large batch sizes taking longer\n`;
          reply += `• Partner system maintenance windows\n`;
        } else {
          reply += `✅ All workflows are meeting their SLA windows. No late files detected.`;
        }
        suggestions = ['SLA compliance', 'Peak hours?', 'Trading partners'];
        break;
      }

      // ============ TIMING & PATTERNS ============

      case 'timing': {
        const analysis = trendDataService.getWorkflowAnalysis();

        reply = `⏰ **File Arrival Timing Summary:**\n\n`;
        analysis.forEach(wf => {
          reply += `**${wf.workflow_id}**\n`;
          reply += `  First file arrives: ~${formatHour(wf.avgFirstArrival)}\n`;
          reply += `  Peak window (80%): ${formatHour(wf.peakHours.start)} — ${formatHour(wf.peakHours.end)}\n\n`;
        });
        reply += `📍 See the **Trends** tab for daily arrival time charts.`;
        suggestions = ['Which arrives earliest?', 'Day of week patterns', 'SLA compliance'];
        break;
      }

      case 'pattern': {
        const analysis = trendDataService.getWorkflowAnalysis();

        reply = `📈 **Day-of-Week Patterns:**\n\n`;
        analysis.forEach(wf => {
          reply += `**${wf.workflow_id}**\n`;
          reply += `  Busiest: ${wf.busiestDayOfWeek?.day || '—'} (${wf.busiestDayOfWeek?.count?.toLocaleString() || 0} files)\n`;
          reply += `  Quietest: ${wf.quietestDayOfWeek?.day || '—'} (${wf.quietestDayOfWeek?.count?.toLocaleString() || 0} files)\n\n`;
        });
        reply += `💡 Weekends typically have much lower volume — this is normal for B2B workflows.\n`;
        reply += `📍 Check **AI Insights** tab > Workflow Analysis for full breakdown.`;
        suggestions = ['Compare weeks', 'Timing patterns', 'Volume counts'];
        break;
      }

      // ============ VOLUME & COMPARISON ============

      case 'count': {
        const overview = trendDataService.getOverviewStats();

        reply = `📊 **Document Volume:**\n\n` +
          `• Total documents: **${overview.totalRecords.toLocaleString()}**\n` +
          `• Workflows: ${overview.totalWorkflows}\n\n` +
          `**By workflow:**\n`;
        Object.entries(overview.workflowCounts)
          .sort(([, a], [, b]) => b - a)
          .forEach(([wf, count]) => {
            const pct = Math.round((count / overview.totalRecords) * 100);
            reply += `• ${wf}: ${count.toLocaleString()} (${pct}%)\n`;
          });
        suggestions = ['Compare weeks', 'Which day has most files?', 'Average per day?'];
        break;
      }

      case 'compare': {
        const wow = trendDataService.getWeekOverWeek();

        reply = `📈 **Week-over-Week Comparison:**\n\n`;
        reply += `Period: ${wow[0]?.period?.current || '—'} vs ${wow[0]?.period?.previous || '—'}\n\n`;

        wow.forEach(wf => {
          const volIcon = wf.volume.change > 10 ? '📈' : wf.volume.change < -10 ? '📉' : '➡️';
          const timeIcon = Math.abs(wf.timing.shiftMinutes || 0) > 30 ? '⚠️' : '✅';

          reply += `**${wf.workflow_id}**\n`;
          reply += `  ${volIcon} Volume: ${wf.volume.change > 0 ? '+' : ''}${wf.volume.change}% (${wf.volume.current} → was ${wf.volume.previous})\n`;
          if (wf.timing.shiftMinutes != null) {
            reply += `  ${timeIcon} Timing: ${wf.timing.shiftMinutes > 0 ? '+' : ''}${wf.timing.shiftMinutes} min ${wf.timing.shiftMinutes > 0 ? 'later' : 'earlier'}\n`;
          }
          if (wf.errors.current > 0 || wf.errors.previous > 0) {
            reply += `  Errors: ${wf.errors.current} (was ${wf.errors.previous})\n`;
          }
          reply += `\n`;
        });

        reply += `📍 Full comparison in **AI Insights** tab.`;
        suggestions = ['Why did volume change?', 'Any new errors?', 'SLA compliance'];
        break;
      }

      // ============ SIZE ============

      case 'size': {
        const records = trendDataService.loadAllRecords();
        const withSize = records.filter(r => r.size_kb);
        const sorted = [...withSize].sort((a, b) => b.size_kb - a.size_kb);
        const allSizes = withSize.map(r => r.size_kb);
        const avgSize = allSizes.length > 0 ? Math.round(allSizes.reduce((s, v) => s + v, 0) / allSizes.length * 100) / 100 : 0;

        reply = `📦 **File Size Analysis:**\n\n` +
          `• Average size: **${avgSize} KB**\n` +
          `• Smallest: ${Math.min(...allSizes).toLocaleString()} KB\n` +
          `• Largest: ${Math.max(...allSizes).toLocaleString()} KB\n` +
          `• Total files with size data: ${withSize.length.toLocaleString()}\n\n` +
          `**Top 5 Largest Files:**\n`;

        sorted.slice(0, 5).forEach((r, i) => {
          reply += `${i + 1}. ${r.file_name} — **${r.size_kb.toLocaleString()} KB**\n   Workflow: ${r.workflow_id}\n`;
        });

        reply += `\n**Average by workflow:**\n`;
        const analysis = trendDataService.getWorkflowAnalysis();
        analysis.forEach(wf => {
          reply += `• ${wf.workflow_id}: ${wf.avgSizeKb} KB (${wf.sizeRange.min}–${wf.sizeRange.max} KB)\n`;
        });
        suggestions = ['Which has biggest files?', 'Status', 'Timing'];
        break;
      }

      // ============ TRADING PARTNERS ============

      case 'partners': {
        const partners = trendDataService.getTradingPartnerActivity();

        reply = `🤝 **Trading Partner Activity:**\n\n`;
        partners.forEach(p => {
          const statusIcon = p.daysSinceActive > 3 ? '🔴' : p.daysSinceActive > 1 ? '🟡' : '🟢';
          reply += `${statusIcon} **${p.sender} → ${p.receiver}**\n`;
          reply += `   Docs: ${p.totalDocs.toLocaleString()} | Last active: ${p.lastActive} (${p.daysSinceActive}d ago)\n`;
          reply += `   Last 7 days: ${p.recentDocs.toLocaleString()} docs | Weekday gaps: ${p.gaps}\n\n`;
        });

        if (partners.some(p => p.gaps > 0)) {
          reply += `⚠️ Gaps indicate weekdays with zero activity — could mean partner system issues or planned maintenance.`;
        }
        suggestions = ['Any inactive partners?', 'Gaps in data?', 'Status'];
        break;
      }

      case 'gaps': {
        const partners = trendDataService.getTradingPartnerActivity();
        const withGaps = partners.filter(p => p.gaps > 0);

        if (withGaps.length === 0) {
          reply = `✅ **No weekday gaps detected!** All trading partners have been consistently active throughout the monitoring period.`;
        } else {
          reply = `⚠️ **Weekday Gaps Detected:**\n\n`;
          reply += `These workflows had weekdays (Mon–Fri) with zero documents:\n\n`;
          withGaps.forEach(p => {
            reply += `**${p.sender} → ${p.receiver}** — ${p.gaps} gap(s)\n`;
            if (p.recentGaps.length > 0) {
              reply += `  Recent gap dates: ${p.recentGaps.join(', ')}\n`;
            }
            reply += `\n`;
          });
          reply += `💡 **Possible reasons:**\n` +
            `• Partner system maintenance/downtime\n` +
            `• No orders placed that day\n` +
            `• Holiday in partner's country\n` +
            `• Integration issue that was resolved`;
        }
        suggestions = ['Trading partners', 'Any errors?', 'Health heatmap'];
        break;
      }

      // ============ HEALTH & ALERTS ============

      case 'health': {
        const heatmap = trendDataService.getHealthHeatmap(7);

        reply = `🟩 **Workflow Health (Last 7 Days):**\n\n`;
        reply += `Legend: 🟢 Normal | 🟡 Low volume | 🔴 Errors | ⚫ No data\n\n`;

        heatmap.workflows.forEach((wf, wi) => {
          const cells = heatmap.data[wi];
          const healthIcons = cells.map(c => {
            switch (c.health) {
              case 3: return '🟢';
              case 2: return '🟡';
              case 1: return '🔴';
              default: return '⚫';
            }
          });
          reply += `${healthIcons.join('')} ${wf.replace('ORDERS_', '')}\n`;
        });

        reply += `\n📍 Interactive heatmap in **AI Insights** tab — hover cells for details.`;
        suggestions = ['Any red days?', 'Any errors?', 'Compare weeks'];
        break;
      }

      case 'alerts': {
        const stats = trendDataService.getAlertStats();
        const alerts = trendDataService.getAlerts({});

        reply = `🔔 **Alert Summary:**\n\n` +
          `• 🔴 Critical: ${stats.critical}\n` +
          `• 🟡 Warning: ${stats.warning}\n` +
          `• ℹ️ Info: ${stats.info}\n` +
          `• Total: ${stats.total}\n\n`;

        if (stats.mostProblematic) {
          reply += `Most problematic: **${stats.mostProblematic}** (${stats.mostProblematicCount} alerts)\n\n`;
        }

        if (alerts.length > 0) {
          reply += `**Recent alerts:**\n`;
          alerts.slice(0, 5).forEach(a => {
            const icon = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : 'ℹ️';
            reply += `${icon} ${a.title}\n`;
          });
        }
        suggestions = ['Any errors?', 'Health heatmap', 'Status'];
        break;
      }

      // ============ ANALYSIS & INSIGHTS ============

      case 'summary': {
        const result = trendDataService.generateSummary();
        reply = `🤖 **Pipeline Summary:**\n\n${result.summary}`;
        suggestions = ['Compare weeks', 'SLA compliance', 'Health heatmap'];
        break;
      }

      case 'analysis': {
        // Try to detect which workflow they want analyzed
        const query = message.replace(/\b(analy[a-z]*|insight|deep\s*dive|investigate|diagnos[a-z]*|root\s*cause|why|the|for|on|of|please|pls|can you)\b/gi, '').trim();
        const wf = findWorkflow(query);

        if (wf) {
          const analysis = trendDataService.getWorkflowAnalysis().find(a => a.workflow_id === wf);
          const sla = trendDataService.getSlaCompliance().find(s => s.workflow_id === wf);
          const partners = trendDataService.getTradingPartnerActivity().find(p => p.workflow_id === wf);

          reply = `🔍 **Deep Analysis: ${wf}**\n\n`;

          if (analysis) {
            reply += `**Volume:** ${analysis.avgDailyCount} docs/day avg, ${analysis.totalRecords.toLocaleString()} total\n`;
            reply += `**Timing:** First arrival ~${formatHour(analysis.avgFirstArrival)}, peak ${formatHour(analysis.peakHours.start)}–${formatHour(analysis.peakHours.end)}\n`;
            reply += `**Errors:** ${analysis.errors} (${analysis.errorRate}% rate)\n`;
            reply += `**Pattern:** Busiest on ${analysis.busiestDayOfWeek?.day || '—'}, quietest on ${analysis.quietestDayOfWeek?.day || '—'}\n`;
          }
          if (sla) {
            reply += `**SLA:** ${sla.compliance}% compliance (window: ${formatHour(sla.slaWindow?.start)}–${formatHour(sla.slaWindow?.end)})\n`;
          }
          if (partners) {
            reply += `**Partner:** ${partners.sender} → ${partners.receiver}, last active ${partners.lastActive}, ${partners.gaps} gap(s)\n`;
          }
        } else {
          // General analysis
          const overview = trendDataService.getOverviewStats();
          const alertStats = trendDataService.getAlertStats();

          reply = `🔍 **Pipeline Analysis:**\n\n` +
            `• ${overview.totalRecords.toLocaleString()} documents across ${overview.totalWorkflows} workflows\n` +
            `• Completion rate: ${overview.completionRate}%\n` +
            `• Errors: ${overview.errors} (${alertStats.critical} critical alerts)\n` +
            `• Most problematic: ${alertStats.mostProblematic || 'None'}\n\n` +
            `For a specific workflow analysis, ask "analyze [workflow name]".\n` +
            `📍 See **AI Insights** tab for full visual analysis.`;
        }
        suggestions = ['SLA compliance', 'Compare weeks', 'Trading partners'];
        break;
      }

      case 'predict': {
        const analysis = trendDataService.getWorkflowAnalysis();
        const wow = trendDataService.getWeekOverWeek();

        reply = `🔮 **What to Expect:**\n\n`;
        reply += `Based on historical patterns:\n\n`;

        analysis.forEach(wf => {
          reply += `**${wf.workflow_id}**\n`;
          reply += `  Expected: ~${wf.avgDailyCount} files/day\n`;
          reply += `  Arriving from: ${formatHour(wf.avgFirstArrival)}\n`;
          reply += `  Peak window: ${formatHour(wf.peakHours.start)}–${formatHour(wf.peakHours.end)}\n\n`;
        });

        // Check for concerning trends
        const declining = wow.filter(w => w.volume.change < -20);
        if (declining.length > 0) {
          reply += `⚠️ **Watch out for:**\n`;
          declining.forEach(w => {
            reply += `• ${w.workflow_id}: volume dropped ${w.volume.change}% this week\n`;
          });
        }
        suggestions = ['Status', 'Any errors?', 'Compare weeks'];
        break;
      }

      // ============ RECENT ============

      case 'recent': {
        const records = trendDataService.loadAllRecords();
        const recent = records.slice(0, 10);

        reply = `📄 **Most Recent Documents:**\n\n`;
        recent.forEach(r => {
          const statusIcon = r.status === '50' ? '✅' : r.status === '45' ? '🟡' : '🔴';
          reply += `${statusIcon} **${r.file_name}**\n  ${r.received || '—'} | ${r.size_kb || '?'} KB | Status: ${r.status}\n  Workflow: ${r.workflow_id}\n\n`;
        });
        suggestions = ['Status', 'Any errors?', 'Files tab'];
        break;
      }

      // ============ SYSTEM & EXPLANATIONS ============

      case 'data_source': {
        const records = trendDataService.loadAllRecords();
        const workflows = trendDataService.getDistinctWorkflows();
        const statuses = trendDataService.getDistinctStatuses();

        reply = `⚙️ **System Information:**\n\n` +
          `**Data Source:** eHub CSV files (from /data/Trenddata/)\n` +
          `**Records loaded:** ${records.length.toLocaleString()}\n` +
          `**Workflows:** ${workflows.length}\n` +
          `**Status codes found:** ${statuses.join(', ')}\n\n` +
          `**eHub Platform:** B2B/EDI integration middleware that routes electronic documents (Purchase Orders, invoices) between trading partners. Documents flow: Sender → eHub → Receiver.\n\n` +
          `**Architecture:**\n` +
          `Trading Partner → eHub Mailbox → Workflow Processing → Delivery → Archive\n\n` +
          `**Status Codes:**\n` +
          `• 50 = Completed/Archived (successfully delivered)\n` +
          `• 45 = In Progress (being processed/routed)\n` +
          `• 999 = Error (failed processing — needs investigation)`;
        suggestions = ['What does status 50 mean?', 'List workflows', 'Status'];
        break;
      }

      case 'explain_status': {
        reply = `📖 **Status Code Reference:**\n\n` +
          `| Code | Meaning | Action |\n` +
          `|------|---------|--------|\n` +
          `| **50** | Completed/Archived | ✅ No action — document successfully processed and delivered |\n` +
          `| **45** | In Progress | 🟡 Document is being processed. If stuck for hours, investigate |\n` +
          `| **999** | Error | 🔴 Processing failed. Check error logs, retry, or escalate |\n\n` +
          `**Document Lifecycle:**\n` +
          `1. Document received in eHub mailbox\n` +
          `2. Workflow picks it up (status changes to in-progress)\n` +
          `3. Transformation/validation applied\n` +
          `4. Document delivered to receiver\n` +
          `5. Archived (status 50)\n\n` +
          `If step 3 or 4 fails → status 999`;
        suggestions = ['Any errors right now?', 'In-progress documents', 'Status'];
        break;
      }

      // ============ UNKNOWN ============

      default:
        reply = `🤔 I'm not sure I understand that. Here are some things I can help with:\n\n` +
          `• **"status"** — Current pipeline health\n` +
          `• **"errors"** — Check for failures\n` +
          `• **"SLA"** — Compliance check\n` +
          `• **"compare weeks"** — Week-over-week trends\n` +
          `• **"timing"** — When files arrive\n` +
          `• **"partners"** — Trading partner activity\n` +
          `• **"analyze [workflow]"** — Deep dive on a workflow\n` +
          `• **"help"** — Full command list\n\n` +
          `I understand natural language — try asking a question about your pipelines!`;
        suggestions = ['help', 'Status', 'Any errors?', 'SLA compliance'];
    }
  } catch (error) {
    console.error('Chatbot error:', error);
    reply = `❌ Sorry, I encountered an error: ${error.message}. Please try again.`;
    suggestions = ['help', 'Status'];
  }

  return { reply, suggestions };
}

// ===================== UTILITIES =====================

function formatHour(decimal) {
  if (decimal == null) return '—';
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

module.exports = { processMessage };
