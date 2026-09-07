// DM Monitoring Dashboard — PDF Export
// Generates a PDF report of the current active tab's data

const ExportPdf = (() => {
  const { jsPDF } = window.jspdf;

  function init() {
    const btn = document.getElementById('exportPdfBtn');
    if (btn) {
      btn.addEventListener('click', exportCurrentTab);
    }
  }

  async function exportCurrentTab() {
    const activeTab = App.getActiveTab();
    const btn = document.getElementById('exportPdfBtn');

    // Show loading state
    btn.textContent = '⏳ Generating...';
    btn.disabled = true;

    try {
      switch (activeTab) {
        case 'overview': await exportOverview(); break;
        case 'trends': await exportTrends(); break;
        case 'files': await exportFiles(); break;
        case 'alerts': await exportAlerts(); break;
        case 'insights': await exportInsights(); break;
        default: await exportOverview(); break;
      }
    } catch (err) {
      console.error('PDF export error:', err);
      alert('Failed to generate PDF. Check console for details.');
    }

    btn.textContent = '📄 Export PDF';
    btn.disabled = false;
  }

  // ============ Helpers ============

  function createDoc() {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    return doc;
  }

  function addHeader(doc, title) {
    const now = new Date().toLocaleString();

    // Title
    doc.setFontSize(18);
    doc.setTextColor(79, 195, 247); // accent blue
    doc.text('DM Monitoring Dashboard', 14, 15);

    // Subtitle
    doc.setFontSize(12);
    doc.setTextColor(60, 60, 60);
    doc.text(title, 14, 23);

    // Date
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Generated: ${now}`, 14, 29);

    // Line separator
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 31, 283, 31);

    return 35; // starting Y position for content
  }

  function addFooter(doc) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pageCount} | DM Monitoring Dashboard | eHub CSV Data`, 14, 200);
    }
  }

  function addChartImage(doc, canvasId, x, y, width, height) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return y;

    try {
      const imgData = canvas.toDataURL('image/png');
      doc.addImage(imgData, 'PNG', x, y, width, height);
      return y + height + 5;
    } catch (e) {
      return y;
    }
  }

  // ============ Tab Exporters ============

  async function exportOverview() {
    const doc = createDoc();
    let y = addHeader(doc, 'Overview Report');

    const overview = await App.api('overview');

    // KPIs
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    doc.text('Key Performance Indicators', 14, y);
    y += 7;

    doc.autoTable({
      startY: y,
      head: [['Metric', 'Value']],
      body: [
        ['Total Workflows', overview.totalWorkflows.toString()],
        ['Total Documents', overview.totalRecords.toLocaleString()],
        ['Completion Rate', overview.completionRate + '%'],
        ['Completed (Status 50)', overview.completed.toLocaleString()],
        ['In Progress (Status 45)', overview.inProgress.toLocaleString()],
        ['Errors (Status 999)', overview.errors.toLocaleString()],
        ['Latest Data Date', overview.displayDate]
      ],
      theme: 'grid',
      headStyles: { fillColor: [79, 195, 247], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14 },
      tableWidth: 120
    });

    y = doc.lastAutoTable.finalY + 10;

    // Workflow distribution
    doc.setFontSize(11);
    doc.text('Documents by Workflow', 14, y);
    y += 7;

    doc.autoTable({
      startY: y,
      head: [['Workflow', 'Documents', 'Percentage']],
      body: Object.entries(overview.workflowCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([wf, count]) => [
          wf,
          count.toLocaleString(),
          Math.round((count / overview.totalRecords) * 100) + '%'
        ]),
      theme: 'grid',
      headStyles: { fillColor: [79, 195, 247], fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14 }
    });

    y = doc.lastAutoTable.finalY + 10;

    // Chart
    y = addChartImage(doc, 'healthTimelineChart', 14, y, 180, 70);

    addFooter(doc);
    doc.save('DM_Dashboard_Overview.pdf');
  }

  async function exportTrends() {
    const doc = createDoc();
    let y = addHeader(doc, 'Trends Report');

    // Arrival time chart
    y = addChartImage(doc, 'arrivalTrendChart', 14, y, 260, 80);
    y += 5;

    // Size chart
    y = addChartImage(doc, 'sizeTrendChart', 14, y, 260, 80);

    // Insights text
    const insightsEl = document.getElementById('trendInsights');
    if (insightsEl && insightsEl.textContent) {
      if (y > 170) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      doc.text('AI Insights', 14, y);
      y += 6;
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);

      const lines = doc.splitTextToSize(insightsEl.textContent, 260);
      doc.text(lines, 14, y);
    }

    addFooter(doc);
    doc.save('DM_Dashboard_Trends.pdf');
  }

  async function exportFiles() {
    const doc = createDoc();
    let y = addHeader(doc, 'File Records Report');

    // Fetch current page data
    const data = await App.api('files?page=1&limit=100');

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Total records: ${data.total.toLocaleString()} | Showing first 100`, 14, y);
    y += 6;

    doc.autoTable({
      startY: y,
      head: [['Workflow', 'File Name', 'Size (KB)', 'Received', 'Status']],
      body: data.records.map(r => [
        r.workflow_id || '—',
        r.file_name || '—',
        r.size_kb != null ? r.size_kb.toString() : '—',
        r.received || '—',
        r.status || '—'
      ]),
      theme: 'grid',
      headStyles: { fillColor: [79, 195, 247], fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 80 },
        2: { cellWidth: 25 },
        3: { cellWidth: 45 },
        4: { cellWidth: 20 }
      },
      margin: { left: 14, right: 14 }
    });

    addFooter(doc);
    doc.save('DM_Dashboard_Files.pdf');
  }

  async function exportAlerts() {
    const doc = createDoc();
    let y = addHeader(doc, 'Alerts Report');

    const [alerts, stats] = await Promise.all([
      App.api('alerts'),
      App.api('alerts/stats')
    ]);

    // Stats summary
    doc.autoTable({
      startY: y,
      head: [['Severity', 'Count']],
      body: [
        ['Critical', stats.critical.toString()],
        ['Warning', stats.warning.toString()],
        ['Info', stats.info.toString()],
        ['Total', stats.total.toString()],
        ['Most Problematic', stats.mostProblematic || '—']
      ],
      theme: 'grid',
      headStyles: { fillColor: [244, 67, 54], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14 },
      tableWidth: 100
    });

    y = doc.lastAutoTable.finalY + 10;

    // Alert list
    doc.setFontSize(11);
    doc.text('Alert Details', 14, y);
    y += 6;

    doc.autoTable({
      startY: y,
      head: [['Severity', 'Type', 'Title', 'Date']],
      body: alerts.slice(0, 50).map(a => [
        a.severity,
        a.type,
        a.title,
        a.received || '—'
      ]),
      theme: 'grid',
      headStyles: { fillColor: [244, 67, 54], fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      margin: { left: 14, right: 14 }
    });

    addFooter(doc);
    doc.save('DM_Dashboard_Alerts.pdf');
  }

  async function exportInsights() {
    const doc = createDoc();
    let y = addHeader(doc, 'AI Insights Report');

    // Summary
    const summary = await App.api('summary');
    doc.setFontSize(11);
    doc.text('Pipeline Summary', 14, y);
    y += 6;
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    const summaryLines = doc.splitTextToSize(summary.summary, 260);
    doc.text(summaryLines, 14, y);
    y += summaryLines.length * 4 + 8;

    // SLA Compliance
    const sla = await App.api('sla-compliance');
    if (y > 160) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    doc.text('SLA Compliance', 14, y);
    y += 6;

    doc.autoTable({
      startY: y,
      head: [['Workflow', 'SLA Window', 'Compliance', 'Days Tracked', 'Missed Days']],
      body: sla.map(s => [
        s.workflow_id,
        s.slaWindow ? formatHour(s.slaWindow.start) + '–' + formatHour(s.slaWindow.end) : '—',
        s.compliance + '%',
        s.totalDays.toString(),
        s.missedDays.length.toString()
      ]),
      theme: 'grid',
      headStyles: { fillColor: [79, 195, 247], fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 10;

    // Week-over-week
    const wow = await App.api('week-over-week');
    if (y > 160) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    doc.text('Week-over-Week Comparison', 14, y);
    y += 6;

    doc.autoTable({
      startY: y,
      head: [['Workflow', 'Volume Change', 'Timing Shift', 'Current', 'Previous', 'Errors']],
      body: wow.map(w => [
        w.workflow_id,
        (w.volume.change > 0 ? '+' : '') + w.volume.change + '%',
        w.timing.shiftMinutes != null ? w.timing.shiftMinutes + ' min' : '—',
        w.volume.current.toString(),
        w.volume.previous.toString(),
        w.errors.current + ' / ' + w.errors.previous
      ]),
      theme: 'grid',
      headStyles: { fillColor: [79, 195, 247], fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 10;

    // Trading Partners
    const partners = await App.api('trading-partners');
    if (y > 160) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    doc.text('Trading Partner Activity', 14, y);
    y += 6;

    doc.autoTable({
      startY: y,
      head: [['Sender', 'Receiver', 'Total Docs', 'Last Active', 'Last 7 Days', 'Gaps']],
      body: partners.map(p => [
        p.sender,
        p.receiver,
        p.totalDocs.toLocaleString(),
        p.lastActive || '—',
        p.recentDocs.toString(),
        p.gaps.toString()
      ]),
      theme: 'grid',
      headStyles: { fillColor: [79, 195, 247], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 }
    });

    addFooter(doc);
    doc.save('DM_Dashboard_Insights.pdf');
  }

  // ============ Utility ============

  function formatHour(decimal) {
    if (decimal == null) return '—';
    const h = Math.floor(decimal);
    const m = Math.round((decimal - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  // Init when DOM ready
  document.addEventListener('DOMContentLoaded', init);

  return { exportCurrentTab };
})();
