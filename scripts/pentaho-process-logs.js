#!/usr/bin/env node
/**
 * Pentaho log -> AI-analysis JSON processor (whole-file scan, no time window).
 *
 * Scans an entire Pentaho Data Integration (PDI) log file or a folder of logs,
 * extracts actionable error blocks, groups them by root-cause signature, keeps
 * the LATEST occurrence of each group with a surrounding context block, derives
 * the AI-analysis fields, and writes the JSON consumed by the Pentaho errors UI
 * (pentaho-ai-issues.json + optional embedded pentaho-ai-issues.data.js).
 *
 * IMPORTANT: unlike the capture shell/PowerShell tools, this reads the WHOLE
 * file. There is no 20/480-minute cutoff. Every error in the file is considered,
 * then de-duplicated so each distinct root cause appears once (latest instance).
 *
 * Usage:
 *   node process-logs.js <SOURCE_FILE_OR_FOLDER> [OUTPUT_JSON] [--emit-embed]
 *
 * Examples:
 *   node process-logs.js ./logs
 *   node process-logs.js ./logs ../pentaho-ai-issues.json --emit-embed
 *   node process-logs.js ./logs/AEON_INVOIC_Log_20260824.txt out.json
 *
 * Options:
 *   --emit-embed   Also write "<output>.data.js" (window.PENTAHO_AI_ISSUES = ...)
 *                  next to the JSON, for file:// usage of the page.
 *   --context-before=N  Lines of context kept before the error (default 40).
 *   --context-after=N   Lines of context kept after the error  (default 20).
 */
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
var TIMESTAMP_RE = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})\b/;

// A line starts an actionable error only if it carries a genuine PDI failure
// marker. PDI stamps real failures with "ERROR (version ...)"; we also accept
// explicit exception classes and a few known failure phrases. This deliberately
// excludes informational lines that merely contain the word "error" (e.g. a
// column name, a mail-body reference, or a "Finished processing ... E=0" line).
var ERROR_MARKER_RE = /ERROR \(version|[A-Za-z_][\w.$]*Exception\b|SQLSTATE|failed to respond|Connection timed out \(|Division undefined|Unable to recognize OLE stream/i;

// Informational lines to always skip even if they look error-ish.
var INFO_RE = /Finished processing \(|Added file '|Optimization level set|to the mail message|Sending mail|Loading transformation|Dispatching started|Starting entry|Processing has finished|Finished job entry|Finished reading query/i;

// Cascade / propagation lines: these are downstream effects of a real failure
// elsewhere, not the leaf root cause. They must not become their own issues.
var CASCADE_RE = /Transformation detected one or more steps with errors|Transformation is killing the other steps|Aborting job|Errors detected!|Because of an error, this step can't continue|Because of an error the previous step|one or more rows have errors|Job execution finished with|We failed to initialize at least one step/i;

// Known benign PDI messages that should not be treated as actionable errors.
var BENIGN_RE = /didn't detect sql data before timeout, failure/i;

// Framework/wrapper/stack lines that are not the leaf root cause.
var STACK_RE = /^\s*(at\s+[\w$.]+[.(]|\.\.\.\s+\d+\s+more$)/;
var WRAPPER_RE = /org\.pentaho\.di\.core\.exception\.Kettle\w*Exception:\s*$|Because of an error|Errors detected!|Unexpected error\s*$|Can not result from|Input \/ output error/i;

// Root-cause classification: ordered; first match wins.
// Each rule derives type, priority, a human title, and suggested_fix steps.
var CLASSIFIERS = [
  {
    type: "DATE_CONVERSION",
    test: /couldn't convert string \[(.*?)\] to a date using format \[(.*?)\]/i,
    title: "Date conversion failed",
    priority: "HIGH",
    confidence: "HIGH",
    fields: function (m) { return { affected_value: m[1], expected_format: m[2] }; },
    fix: [
      "Ask the sender to correct blank or malformed dates at source.",
      "Add a validation/default step before the date conversion.",
      "If placeholder dates are expected, adjust the date mask or route them to a review path."
    ]
  },
  {
    type: "DATA_TRUNCATION",
    test: /Out of range value for column '(.*?)'|Data truncation/i,
    title: "Database value is out of range",
    priority: "HIGH",
    confidence: "HIGH",
    fields: function (m) { return { affected_field: m[1] || "" }; },
    fix: [
      "Widen the target column type or precision/scale to fit legitimate values.",
      "Validate and cap or reject out-of-range values before the table output step.",
      "Confirm with the sender whether the oversized value is a data-entry error."
    ]
  },
  {
    type: "NO_HTTP_RESPONSE",
    test: /([\w.-]+:\d+) failed to respond|NoHttpResponseException/i,
    title: "Remote service did not respond",
    priority: "HIGH",
    confidence: "MEDIUM",
    fields: function (m) { return { affected_value: (m[1] || "") }; },
    fix: [
      "Verify the endpoint is healthy and reachable from the PDI host.",
      "Check for maintenance windows or rate limiting on the remote service.",
      "Retry the transmission once the service is confirmed available."
    ]
  },
  {
    type: "CONNECTION_TIMEOUT",
    test: /Connection timed out|ConnectException/i,
    title: "Connection timed out",
    priority: "HIGH",
    confidence: "MEDIUM",
    fix: [
      "Confirm the target host/port is up and reachable from the PDI host.",
      "Verify network path and firewall rules allow the connection.",
      "Re-run the job once connectivity is confirmed."
    ]
  },
  {
    type: "ARITHMETIC_ERROR",
    test: /Division undefined|ArithmeticException/i,
    title: "Calculation failed",
    priority: "HIGH",
    confidence: "HIGH",
    fix: [
      "Add a guard for zero or empty divisors before the Calculator step.",
      "Default the result when the divisor is missing.",
      "Trace the source field that feeds the divisor and correct upstream data."
    ]
  },
  {
    type: "MALFORMED_WORKBOOK",
    test: /Unable to recognize OLE stream|BiffException/i,
    title: "Input workbook cannot be read",
    priority: "HIGH",
    confidence: "HIGH",
    fix: [
      "Ask the sender to re-export the workbook in a valid Excel format.",
      "Confirm the file transfer completed and was not truncated.",
      "Validate the file type/signature before the read step."
    ]
  }
];

var DEFAULT_CLASS = {
  type: "GENERIC_ERROR",
  title: "Pipeline error",
  priority: "MEDIUM",
  confidence: "LOW",
  fix: ["Review the failing step and the raw context, then correct the source data or configuration."]
};

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  var positional = [];
  var opts = { emitEmbed: false, contextBefore: 40, contextAfter: 20 };
  argv.forEach(function (arg) {
    if (arg === "--emit-embed") opts.emitEmbed = true;
    else if (arg.indexOf("--context-before=") === 0) opts.contextBefore = parseInt(arg.split("=")[1], 10) || 0;
    else if (arg.indexOf("--context-after=") === 0) opts.contextAfter = parseInt(arg.split("=")[1], 10) || 0;
    else positional.push(arg);
  });
  return { source: positional[0], output: positional[1] || "pentaho-ai-issues.json", opts: opts };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
function listLogFiles(sourcePath) {
  var stat = fs.statSync(sourcePath);
  if (stat.isFile()) return [sourcePath];
  var out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      var full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(txt|log)$/i.test(entry.name)) out.push(full);
    });
  })(sourcePath);
  return out.sort();
}

// ---------------------------------------------------------------------------
// Line helpers
// ---------------------------------------------------------------------------
function lineTimestamp(line) {
  var m = TIMESTAMP_RE.exec(line);
  return m ? m[1] : null;
}

// The message body after "TIMESTAMP - Step - " (best effort; PDI format).
function lineMessage(line) {
  var withoutTs = line.replace(TIMESTAMP_RE, "").replace(/^\s*-\s*/, "");
  var dash = withoutTs.indexOf(" - ");
  return dash >= 0 ? withoutTs.slice(dash + 3) : withoutTs;
}

function lineStep(line) {
  var withoutTs = line.replace(TIMESTAMP_RE, "").replace(/^\s*-\s*/, "");
  var dash = withoutTs.indexOf(" - ");
  return dash >= 0 ? withoutTs.slice(0, dash).trim() : "";
}

function isNoise(line) {
  var msg = lineMessage(line);
  return STACK_RE.test(msg) || WRAPPER_RE.test(msg) || msg.trim() === "";
}

// Pick the leaf root-cause line within an error region: prefer the first
// non-wrapper, non-stack, non-empty message that carries real signal.
function cleanCauseLine(msg) {
  return String(msg || "")
    .replace(/^ERROR \(version[^)]*\)\s*:\s*/i, "")
    .replace(/^Caused by:\s*/i, "")
    .trim();
}

function isUsableCause(msg) {
  if (!msg || msg.length < 8) return false;
  if (STACK_RE.test(msg)) return false;
  if (INFO_RE.test(msg)) return false;
  if (CASCADE_RE.test(msg)) return false;
  if (WRAPPER_RE.test(msg)) return false;
  if (/^(Because of an error|Errors detected!|Unexpected error)$/i.test(msg)) return false;
  return true;
}

// Within an error region, prefer a line that a classifier recognises (the real
// leaf cause), otherwise fall back to the first usable non-wrapper line.
function extractRootCause(regionLines) {
  var fallback = "";
  for (var i = 0; i < regionLines.length; i += 1) {
    var msg = cleanCauseLine(lineMessage(regionLines[i]));
    if (!isUsableCause(msg)) continue;
    if (classify(msg).match) return msg;           // classifier hit -> best cause
    if (!fallback) fallback = msg;                  // remember first usable line
  }
  return fallback;
}

function classify(rootCause) {
  for (var i = 0; i < CLASSIFIERS.length; i += 1) {
    var c = CLASSIFIERS[i];
    var m = c.test.exec(rootCause);
    if (m) {
      var extra = c.fields ? c.fields(m) : {};
      return { def: c, match: m, extra: extra };
    }
  }
  return { def: DEFAULT_CLASS, match: null, extra: {} };
}

// Stable signature for de-duplication. When the cause is recognised by a
// classifier, group by (workflow + type) so all copies of the same failure —
// across step aliases and wrapper/leaf phrasings — collapse into ONE issue.
// Unrecognised causes fall back to a normalised text signature.
function signatureOf(rootCause, step, workflow) {
  var cls = classify(rootCause);
  var key;
  if (cls.match) {
    key = (workflow || "") + "|type:" + cls.def.type;
  } else {
    var norm = String(rootCause || "")
      .replace(/\[[^\]]*\]/g, "[]")
      .replace(/'[^']*'/g, "''")
      .replace(/\b\d[\d.:-]*\b/g, "#")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    key = (step || "") + "|" + norm;
  }
  return crypto.createHash("md5").update(key).digest("hex").slice(0, 12);
}

function fingerprintOf(signature) { return signature; }

function issueIdOf(signature) { return "PDI-" + signature.toUpperCase(); }

// ---------------------------------------------------------------------------
// Per-file scan: find error regions, keep the latest occurrence of each group.
// ---------------------------------------------------------------------------
function scanFile(filePath, sourceRoot, opts, benignCounter) {
  var raw = fs.readFileSync(filePath, "utf8");
  var lines = raw.split(/\r?\n/);
  var relative = path.relative(sourceRoot, filePath).split(path.sep).join("/");
  var logName = path.basename(filePath);
  var workflow = relative.indexOf("/") >= 0 ? relative.split("/")[0] : logName.replace(/(_Log_.*)?\.(txt|log)$/i, "");

  var groups = {}; // signature -> aggregated issue

  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i];
    var ts = lineTimestamp(line);
    if (!ts) continue;
    if (BENIGN_RE.test(line)) { benignCounter.count += 1; continue; }
    if (INFO_RE.test(line)) continue;
    if (CASCADE_RE.test(line)) continue;
    if (!ERROR_MARKER_RE.test(line)) continue;

    // Collect the region after this error marker to find the leaf cause.
    var regionStart = Math.max(0, i - 1);
    var regionEnd = Math.min(lines.length - 1, i + 8);
    var region = lines.slice(regionStart, regionEnd + 1);
    var rootCause = extractRootCause(region);
    if (!rootCause) continue;

    var step = lineStep(line);
    var signature = signatureOf(rootCause, step, workflow);

    // Context block: N lines before + error + N lines after (whole-file capture).
    var ctxStart = Math.max(0, i - opts.contextBefore);
    var ctxEnd = Math.min(lines.length - 1, i + opts.contextAfter);

    var group = groups[signature];
    if (!group) {
      group = groups[signature] = {
        signature: signature, step: step, rootCause: rootCause,
        firstSeen: ts, lastSeen: ts, occurrences: 0,
        latestLine: i, latestCtxStart: ctxStart, latestCtxEnd: ctxEnd, latestTs: ts
      };
    }
    group.occurrences += 1;
    if (ts < group.firstSeen) group.firstSeen = ts;
    // Keep the LATEST occurrence (by timestamp, then by position) for evidence + context.
    if (ts >= group.latestTs) {
      group.lastSeen = ts;
      group.latestTs = ts;
      group.latestLine = i;
      group.latestCtxStart = ctxStart;
      group.latestCtxEnd = ctxEnd;
      group.rootCause = rootCause;
      group.step = step;
    }
  }

  return Object.keys(groups).map(function (sig) {
    var g = groups[sig];
    var contextLines = lines.slice(g.latestCtxStart, g.latestCtxEnd + 1)
      .filter(function (l) { return lineTimestamp(l); });
    // Trim context to the most relevant lines around the cause for readability.
    var rawContext = contextLines.slice(0, 60).join("\n");

    var cls = classify(g.rootCause);
    var def = cls.def;
    var affected = cls.extra || {};

    return {
      id: issueIdOf(g.signature),
      fingerprint: fingerprintOf(g.signature),
      log_name: logName,
      timestamp: g.lastSeen,
      priority: def.priority,
      workflow: workflow,
      failed_step: g.step,
      exception: guessException(rawContext),
      root_cause: g.rootCause,
      affected_field: affected.affected_field || "",
      affected_value: affected.affected_value || "",
      expected_format: affected.expected_format || "",
      impact: def.title + " in step " + (g.step || "unknown") + " (" + workflow + ").",
      likely_cause: def.title + " — review the affected step and source data.",
      suggested_fix: def.fix.slice(),
      confidence: def.confidence,
      status: "NEW",
      raw_context: rawContext,
      title: def.title,
      type: def.type,
      primaryComponent: g.step,
      componentAliases: [g.step].filter(Boolean),
      sourceLogs: [relative],
      firstSeen: g.firstSeen,
      lastSeen: g.lastSeen,
      occurrences: g.occurrences,
      rawBlockCount: g.occurrences,
      duplicateBlocksCollapsed: Math.max(0, g.occurrences - 1),
      evidence: [
        { sourceLog: relative, timestamp: g.lastSeen, component: g.step, startLine: g.latestCtxStart + 1, endLine: g.latestCtxEnd + 1 }
      ]
    };
  });
}

function guessException(context) {
  var m = /([A-Za-z_][\w.$]*Exception)\b/.exec(context || "");
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  var args = parseArgs(process.argv.slice(2));
  if (!args.source) {
    console.error("Usage: node process-logs.js <SOURCE_FILE_OR_FOLDER> [OUTPUT_JSON] [--emit-embed]");
    process.exit(1);
  }
  if (!fs.existsSync(args.source)) {
    console.error("Source not found: " + args.source);
    process.exit(1);
  }

  var sourceStat = fs.statSync(args.source);
  var sourceRoot = sourceStat.isFile() ? path.dirname(args.source) : args.source;
  var files = listLogFiles(args.source);

  var benignCounter = { count: 0 };
  var allIssues = [];
  var logsWithRootCauses = 0;

  files.forEach(function (file) {
    var issues = scanFile(file, sourceRoot, args.opts, benignCounter);
    if (issues.length > 0) logsWithRootCauses += 1;
    allIssues = allIssues.concat(issues);
  });

  // Merge identical signatures that appear across multiple files (keep latest).
  var merged = {};
  allIssues.forEach(function (issue) {
    var key = issue.fingerprint;
    var existing = merged[key];
    if (!existing) { merged[key] = issue; return; }
    existing.occurrences += issue.occurrences;
    existing.rawBlockCount += issue.rawBlockCount;
    existing.duplicateBlocksCollapsed = Math.max(0, existing.occurrences - 1);
    if (issue.firstSeen < existing.firstSeen) existing.firstSeen = issue.firstSeen;
    if (issue.lastSeen >= existing.lastSeen) {
      existing.lastSeen = issue.lastSeen;
      existing.timestamp = issue.timestamp;
      existing.raw_context = issue.raw_context;
      existing.evidence = issue.evidence;
      existing.log_name = issue.log_name;
      existing.failed_step = issue.failed_step;
      existing.primaryComponent = issue.primaryComponent;
    }
    existing.sourceLogs = Array.from(new Set(existing.sourceLogs.concat(issue.sourceLogs)));
    existing.componentAliases = Array.from(new Set(existing.componentAliases.concat(issue.componentAliases)));
  });

  var issues = Object.keys(merged).map(function (k) { return merged[k]; })
    .sort(function (a, b) { return String(b.lastSeen).localeCompare(String(a.lastSeen)); });

  var high = issues.filter(function (i) { return i.priority === "HIGH"; }).length;
  var payload = {
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19).replace(/-/g, "/"),
    source: "PROCESSOR",
    schemaVersion: "ai-analysis-v1",
    summary: {
      logsScanned: files.length,
      logsWithRootCauses: logsWithRootCauses,
      ignoredKnownBenignLines: benignCounter.count,
      duplicateBlocksCollapsed: issues.reduce(function (s, i) { return s + (i.duplicateBlocksCollapsed || 0); }, 0),
      rootCauseEvents: issues.reduce(function (s, i) { return s + (i.occurrences || 0); }, 0),
      rootCauseGroups: issues.length,
      highIssues: high,
      mediumIssues: issues.length - high
    },
    issues: issues
  };

  var outputPath = path.resolve(args.output);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log("Wrote " + issues.length + " issue(s) from " + files.length + " log file(s) -> " + outputPath);

  if (args.opts.emitEmbed) {
    var embedPath = outputPath.replace(/\.json$/i, ".data.js");
    var header = "/**\n * Embedded fallback copy of " + path.basename(outputPath) + " (auto-generated).\n */\nwindow.PENTAHO_AI_ISSUES = ";
    fs.writeFileSync(embedPath, header + JSON.stringify(payload, null, 2) + ";\n", "utf8");
    console.log("Wrote embedded copy -> " + embedPath);
  }
}

main();
