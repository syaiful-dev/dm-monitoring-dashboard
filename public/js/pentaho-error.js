/**
 * Pentaho errors page logic (standalone).
 *
 * Consumes the AI-analysis JSON via PentahoDataService.load(), renders the KPI
 * cards, the issue table (with search + priority filter + paging), and the
 * detail dialog (AI-analysis fields, single latest evidence chunk, raw context,
 * suggested-fix list). Includes local status/comments/status-history tracking
 * persisted in localStorage, keyed by each issue's fingerprint.
 *
 * No dependency on the rest of the original dashboard (trends/upload/training).
 */
(function () {
  "use strict";

  var ERROR_PAGE_SIZE = 15;
  var ISSUE_STORE_KEY = "pentaho-error-issue-tracking-v1";

  var STATUS_FLOW = { NEW: "IN_PROGRESS", IN_PROGRESS: "FIXED", FIXED: null };
  var STATUS_LABELS = { NEW: "New", IN_PROGRESS: "In Progress", FIXED: "Fixed" };
  var STATUS_CLASSES = { NEW: "status-new", IN_PROGRESS: "status-in-progress", FIXED: "status-fixed" };

  var state = { issues: [], summary: {}, meta: {}, errorPage: 1, errorSearch: "", errorSeverity: "ALL", activeIssueId: null };

  // ---- small helpers ----
  function byId(id) { return document.getElementById(id); }
  function number(value) { return new Intl.NumberFormat("en-US").format(value || 0); }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function parsePdiDate(value) {
    // Accepts "YYYY/MM/DD HH:MM:SS" or ISO; returns Date or null.
    if (!value) return null;
    var s = String(value).trim();
    var m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function dateTime(value) {
    var d = parsePdiDate(value);
    return d ? d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : String(value || "");
  }
  function commentTime(iso) {
    var parsed = new Date(iso);
    return isNaN(parsed) ? iso : parsed.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // ---- issue tracking (status + comments), persisted locally ----
  function readStore(key) {
    try { var raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (error) { return null; }
  }
  var issueStore = readStore(ISSUE_STORE_KEY) || {};
  function saveIssueStore() {
    try { window.localStorage.setItem(ISSUE_STORE_KEY, JSON.stringify(issueStore)); }
    catch (error) { /* file:// or storage disabled: keep in memory for the session */ }
  }
  function issueTracking(fingerprint) {
    if (!issueStore[fingerprint]) issueStore[fingerprint] = { status: "NEW", comments: [], history: [] };
    if (!issueStore[fingerprint].history) issueStore[fingerprint].history = [];
    return issueStore[fingerprint];
  }
  function seedIssueStatus(fingerprint, seedStatus) {
    if (!fingerprint || !seedStatus || seedStatus === "NEW") return;
    if (issueStore[fingerprint]) return;
    issueStore[fingerprint] = { status: seedStatus, comments: [], history: [] };
  }
  function addIssueComment(fingerprint, text) {
    var trimmed = String(text || "").trim();
    if (!trimmed) return false;
    issueTracking(fingerprint).comments.push({ text: trimmed, at: new Date().toISOString() });
    saveIssueStore();
    return true;
  }
  function changeIssueStatus(fingerprint, nextStatus, reason, action) {
    var trimmed = String(reason || "").trim();
    if (!trimmed) return false;
    var tracking = issueTracking(fingerprint);
    var from = tracking.status;
    var at = new Date().toISOString();
    tracking.status = nextStatus;
    tracking.history.push({ action: action, from: from, to: nextStatus, reason: trimmed, at: at });
    tracking.comments.push({ text: trimmed, at: at });
    saveIssueStore();
    return true;
  }
  function advanceIssueStatus(fingerprint, reason) {
    var next = STATUS_FLOW[issueTracking(fingerprint).status];
    if (!next) return false;
    return changeIssueStatus(fingerprint, next, reason, next === "FIXED" ? "MARK_FIXED" : "START_WORK");
  }
  function refixIssue(fingerprint, reason) {
    if (issueTracking(fingerprint).status !== "FIXED") return false;
    return changeIssueStatus(fingerprint, "IN_PROGRESS", reason, "REFIX");
  }

  // ---- rendering ----
  function filteredIssues() {
    var search = state.errorSearch.trim().toLowerCase();
    return state.issues.filter(function (issue) {
      if (state.errorSeverity !== "ALL" && issue.severity !== state.errorSeverity) return false;
      if (!search) return true;
      return [issue.rootCause, issue.title, issue.type, issue.primaryComponent, issue.workflow, issue.logName]
        .concat(issue.componentAliases || [], issue.sourceLogs || [])
        .join(" ").toLowerCase().includes(search);
    });
  }

  function renderErrors() {
    var summary = state.summary || {};
    byId("error-logs").textContent = summary.logsScanned != null ? summary.logsScanned : "—";
    byId("error-logs-note").textContent = (summary.logsWithRootCauses != null ? summary.logsWithRootCauses : 0) + " with root causes";
    byId("error-groups").textContent = number(summary.rootCauseGroups);
    byId("error-benign").textContent = number(summary.ignoredKnownBenignLines);
    byId("error-lines").textContent = number(summary.rootCauseEvents);
    byId("error-noise-note").textContent = number(summary.duplicateBlocksCollapsed) + " duplicate blocks collapsed";
    if (state.meta && (state.meta.source || state.meta.generatedAt)) {
      byId("error-source-note").textContent = "Source: " + (state.meta.source || "—") + (state.meta.generatedAt ? " · generated " + state.meta.generatedAt : "");
    }

    var issues = filteredIssues();
    var pageCount = Math.max(1, Math.ceil(issues.length / ERROR_PAGE_SIZE));
    state.errorPage = Math.min(state.errorPage, pageCount);
    var start = (state.errorPage - 1) * ERROR_PAGE_SIZE;
    var page = issues.slice(start, start + ERROR_PAGE_SIZE);
    byId("error-result-count").textContent = number(issues.length) + " root causes";
    byId("error-page-label").textContent = "Page " + state.errorPage + " of " + pageCount;
    byId("error-prev").disabled = state.errorPage <= 1;
    byId("error-next").disabled = state.errorPage >= pageCount;
    byId("error-table-body").innerHTML = page.length ? page.map(function (issue) {
      var tracking = issueTracking(issue.fingerprint);
      return '<tr><td><span class="badge ' + escapeHtml((issue.severity || "").toLowerCase()) + '">' + escapeHtml(issue.severity) + '</span></td>' +
        '<td><strong>' + escapeHtml(issue.rootCause) + '</strong><br><span class="subtle">' + escapeHtml(issue.type) + '</span></td>' +
        '<td class="truncate" title="' + escapeHtml((issue.componentAliases || []).join(", ")) + '">' + escapeHtml(issue.primaryComponent) + '</td>' +
        '<td><span class="status-badge ' + STATUS_CLASSES[tracking.status] + '">' + STATUS_LABELS[tracking.status] + '</span></td>' +
        '<td>' + escapeHtml(dateTime(issue.lastSeen)) + '</td><td>' + number(issue.occurrences) + '</td>' +
        '<td><button type="button" class="link-button" data-issue="' + escapeHtml(issue.id) + '">View</button></td></tr>';
    }).join("") : '<tr><td colspan="7" class="subtle">No matching root causes.</td></tr>';
  }

  function renderIssueTracking(issue) {
    var tracking = issueTracking(issue.fingerprint);
    byId("error-dialog-status").textContent = STATUS_LABELS[tracking.status];
    byId("error-dialog-status").className = "status-badge " + STATUS_CLASSES[tracking.status];

    var hasReason = byId("error-dialog-comment").value.trim().length > 0;
    var advance = byId("error-dialog-advance");
    var refix = byId("error-dialog-refix");
    var next = STATUS_FLOW[tracking.status];
    var hint = byId("error-dialog-status-hint");
    hint.className = "subtle status-hint";

    refix.hidden = tracking.status !== "FIXED";
    refix.disabled = !hasReason;

    if (!next) {
      advance.hidden = true;
      hint.textContent = hasReason ? "Add a reason and select Refix to reopen this issue." : "This issue is marked Fixed. To reopen it, type a reason then select Refix.";
    } else {
      advance.hidden = false;
      advance.textContent = "Move to " + STATUS_LABELS[next];
      advance.disabled = !hasReason;
      if (!hasReason) {
        hint.textContent = "Type a reason in the comment box to move this issue to " + STATUS_LABELS[next] + ".";
        hint.className = "subtle status-hint is-blocked";
      } else {
        hint.textContent = "Ready to move to " + STATUS_LABELS[next] + ".";
      }
    }

    byId("error-dialog-comment-label").textContent = next || tracking.status === "FIXED"
      ? "Reason / comment (required to change status)"
      : "Comment from person in charge";

    var actionClass = { START_WORK: "act-start", MARK_FIXED: "act-fixed", REFIX: "act-refix" };
    var actionLabel = { START_WORK: "Started", MARK_FIXED: "Fixed", REFIX: "Refix" };
    byId("error-dialog-history").innerHTML = tracking.history.length
      ? tracking.history.slice().reverse().map(function (entry) {
          return '<div class="history-entry">' +
            '<span class="history-line"><span class="history-action ' + (actionClass[entry.action] || "act-start") + '">' + (actionLabel[entry.action] || entry.action) + '</span>' +
            escapeHtml(STATUS_LABELS[entry.from] || entry.from) + '<span class="history-arrow">&rarr;</span>' + escapeHtml(STATUS_LABELS[entry.to] || entry.to) + '</span>' +
            '<span class="history-reason">' + escapeHtml(entry.reason) + '</span>' +
            '<span class="history-meta">' + escapeHtml(commentTime(entry.at)) + '</span></div>';
        }).join("")
      : '<p class="history-empty">No status changes yet.</p>';

    byId("error-dialog-comment-log").innerHTML = tracking.comments.length
      ? tracking.comments.slice().reverse().map(function (comment) {
          return '<div class="comment-entry' + (comment.system ? " is-system" : "") + '">' + escapeHtml(comment.text) + '<span class="comment-meta">' + escapeHtml(commentTime(comment.at)) + '</span></div>';
        }).join("")
      : '<p class="comment-empty">No comments yet.</p>';
  }

  // The capture tool records only the latest error chunk per file, so the detail
  // view shows a single, most-recent evidence entry (newest timestamp).
  function latestEvidenceEntry(evidence) {
    if (!Array.isArray(evidence) || evidence.length === 0) return null;
    return evidence.reduce(function (latest, current) {
      if (!latest) return current;
      return String(current.timestamp || "") >= String(latest.timestamp || "") ? current : latest;
    }, null);
  }

  function detailCard(label, value) {
    return '<span class="detail-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></span>';
  }
  function analysisRow(label, value) {
    var text = value == null ? "" : String(value).trim();
    if (!text) text = "\u2014";
    return '<div class="analysis-row"><span class="analysis-label">' + escapeHtml(label) + '</span><span class="analysis-value">' + escapeHtml(text) + '</span></div>';
  }
  function renderSuggestedFix(issue) {
    var list = Array.isArray(issue.suggestedFixList) ? issue.suggestedFixList.filter(function (item) { return String(item || "").trim(); }) : [];
    var container = byId("error-dialog-fix");
    if (list.length === 0) container.innerHTML = '<p class="fix-empty">No suggested action available.</p>';
    else if (list.length === 1) container.innerHTML = '<p class="fix-single">' + escapeHtml(list[0]) + '</p>';
    else container.innerHTML = '<ol class="fix-list">' + list.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join("") + '</ol>';
  }

  function openIssue(issueId) {
    var issue = state.issues.find(function (item) { return item.id === issueId; });
    if (!issue) return;
    state.activeIssueId = issueId;
    byId("error-dialog-title").textContent = issue.title;
    byId("error-dialog-meta").innerHTML = [
      ["Priority", issue.severity], ["Confidence", issue.confidence || "\u2014"], ["Main step", issue.primaryComponent],
      ["First seen", dateTime(issue.firstSeen)], ["Latest", dateTime(issue.lastSeen)], ["Incidents", number(issue.occurrences)]
    ].map(function (item) { return detailCard(item[0], item[1]); }).join("");

    byId("error-dialog-analysis").innerHTML = [
      analysisRow("Log name", issue.logName),
      analysisRow("Workflow", issue.workflow),
      analysisRow("Failed step", issue.primaryComponent),
      analysisRow("Exception", issue.exception),
      analysisRow("Affected field", issue.affectedField),
      analysisRow("Affected value", issue.affectedValue),
      analysisRow("Expected format", issue.expectedFormat),
      analysisRow("Impact", issue.impact),
      analysisRow("Likely cause", issue.likelyCause)
    ].join("");

    byId("error-dialog-sample").textContent = issue.rootCause;
    var latest = latestEvidenceEntry(issue.evidence);
    byId("error-dialog-lines").textContent = latest
      ? "Evidence (latest capture): " + String(latest.sourceLog || "").split("/").pop() + " lines " + latest.startLine + "\u2013" + latest.endLine + " @ " + dateTime(latest.timestamp)
      : "Evidence: none captured";
    renderSuggestedFix(issue);
    byId("error-dialog-raw").textContent = issue.rawContext || "No raw context captured.";
    byId("error-dialog-comment").value = "";
    renderIssueTracking(issue);
    byId("error-dialog").showModal();
  }

  function activeIssue() {
    return state.issues.find(function (item) { return item.id === state.activeIssueId; });
  }

  function bindEvents() {
    document.addEventListener("click", function (event) {
      var issueButton = event.target.closest("[data-issue]");
      if (issueButton) openIssue(issueButton.getAttribute("data-issue"));
      var closeButton = event.target.closest("[data-close]");
      if (closeButton) byId(closeButton.getAttribute("data-close")).close();
    });
    byId("error-search").addEventListener("input", function (event) { state.errorSearch = event.target.value; state.errorPage = 1; renderErrors(); });
    byId("error-severity").addEventListener("change", function (event) { state.errorSeverity = event.target.value; state.errorPage = 1; renderErrors(); });
    byId("error-prev").addEventListener("click", function () { state.errorPage -= 1; renderErrors(); });
    byId("error-next").addEventListener("click", function () { state.errorPage += 1; renderErrors(); });
    byId("error-dialog-comment").addEventListener("input", function () { var issue = activeIssue(); if (issue) renderIssueTracking(issue); });
    byId("error-dialog-comment-add").addEventListener("click", function () {
      var issue = activeIssue(); if (!issue) return;
      if (addIssueComment(issue.fingerprint, byId("error-dialog-comment").value)) { byId("error-dialog-comment").value = ""; renderIssueTracking(issue); }
    });
    byId("error-dialog-advance").addEventListener("click", function () {
      var issue = activeIssue(); if (!issue) return;
      if (advanceIssueStatus(issue.fingerprint, byId("error-dialog-comment").value)) { byId("error-dialog-comment").value = ""; renderIssueTracking(issue); renderErrors(); }
    });
    byId("error-dialog-refix").addEventListener("click", function () {
      var issue = activeIssue(); if (!issue) return;
      if (refixIssue(issue.fingerprint, byId("error-dialog-comment").value)) { byId("error-dialog-comment").value = ""; renderIssueTracking(issue); renderErrors(); }
    });
  }

  function boot() {
    bindEvents();
    if (!window.PentahoDataService) {
      byId("error-table-body").innerHTML = '<tr><td colspan="7" class="subtle">Data service not loaded.</td></tr>';
      return;
    }
    window.PentahoDataService.load().then(function (payload) {
      state.summary = payload.summary || {};
      state.issues = payload.issues || [];
      state.meta = { generatedAt: payload.generatedAt, source: payload.source, schemaVersion: payload.schemaVersion };
      state.issues.forEach(function (issue) { seedIssueStatus(issue.fingerprint, issue.seedStatus); });
      saveIssueStore();
      renderErrors();
    }).catch(function () {
      byId("error-table-body").innerHTML = '<tr><td colspan="7" class="subtle">Could not load issue data.</td></tr>';
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
