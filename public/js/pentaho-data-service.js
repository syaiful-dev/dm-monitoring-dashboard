/**
 * PentahoDataService
 *
 * The single place the Pentaho errors page talks to for AI-analysis issue data.
 *
 * Pipeline this represents:
 *   Pentaho log -> error extraction -> AI analysis -> structured JSON
 *   -> backend/database -> API -> (this service) -> Pentaho errors UI
 *
 * To switch to a real backend API, change only REMOTE_URL below (and/or the
 * fetch options); the rest of the page is unchanged. Keep the endpoint returning
 * the same JSON schema documented in README.md.
 *
 * Loading strategy (file:// safe):
 *   1. Try fetch(REMOTE_URL) — the path used when served over http(s).
 *   2. Fall back to the embedded copy window.PENTAHO_AI_ISSUES
 *      (pentaho-ai-issues.data.js), because browsers block fetch() of local
 *      files under the file:// protocol.
 */
(function () {
  "use strict";

  // Served statically from public/data. Point at a live API later if desired.
  var REMOTE_URL = "/data/pentaho-ai-issues.json";

  // AI schema status -> UI tracking vocabulary (NEW/IN_PROGRESS/FIXED). This only
  // seeds the initial status; the page's own status/comments/history workflow
  // takes over after that and persists locally.
  var STATUS_FROM_SCHEMA = { NEW: "NEW", ACKNOWLEDGED: "IN_PROGRESS", RESOLVED: "FIXED" };

  function mapSchemaStatus(status) { return STATUS_FROM_SCHEMA[status] || "NEW"; }

  function asArray(value) {
    if (Array.isArray(value)) return value.slice();
    if (value == null || value === "") return [];
    return [value];
  }

  // Adapt one AI-analysis issue (JSON schema) into the shape the page renders.
  function adaptIssue(raw) {
    var suggestedFixList = asArray(raw.suggested_fix);
    return {
      id: raw.id,
      fingerprint: raw.fingerprint,
      rootCause: raw.root_cause,
      type: raw.type,
      title: raw.title,
      severity: raw.priority,
      primaryComponent: raw.failed_step,
      componentAliases: asArray(raw.componentAliases),
      sourceLogs: asArray(raw.sourceLogs),
      firstSeen: raw.firstSeen,
      lastSeen: raw.lastSeen,
      occurrences: raw.occurrences,
      rawBlockCount: raw.rawBlockCount,
      duplicateBlocksCollapsed: raw.duplicateBlocksCollapsed,
      evidence: asArray(raw.evidence),

      suggestedFixList: suggestedFixList,
      suggestedFix: suggestedFixList.length === 1 ? suggestedFixList[0] : "",

      logName: raw.log_name,
      workflow: raw.workflow,
      timestamp: raw.timestamp,
      exception: raw.exception,
      affectedField: raw.affected_field,
      affectedValue: raw.affected_value,
      expectedFormat: raw.expected_format,
      impact: raw.impact,
      likelyCause: raw.likely_cause,
      confidence: raw.confidence,
      rawContext: raw.raw_context,

      analysisStatus: raw.status,
      seedStatus: mapSchemaStatus(raw.status)
    };
  }

  function adaptPayload(payload) {
    return {
      generatedAt: payload.generatedAt,
      source: payload.source,
      schemaVersion: payload.schemaVersion,
      summary: payload.summary,
      issues: asArray(payload.issues).map(adaptIssue)
    };
  }

  function loadFromEmbedded() {
    if (window.PENTAHO_AI_ISSUES) return adaptPayload(window.PENTAHO_AI_ISSUES);
    throw new Error("Pentaho AI issue data is unavailable (no fetch and no embedded fallback).");
  }

  // Returns a Promise resolving to { generatedAt, source, schemaVersion, summary, issues[] }.
  function load() {
    if (typeof window.fetch !== "function" || window.location.protocol === "file:") {
      return Promise.resolve().then(loadFromEmbedded);
    }
    return window.fetch(REMOTE_URL, { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(adaptPayload)
      .catch(function () { return loadFromEmbedded(); });
  }

  window.PentahoDataService = {
    load: load,
    adaptPayload: adaptPayload,
    adaptIssue: adaptIssue,
    mapSchemaStatus: mapSchemaStatus
  };
})();
