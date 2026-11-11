# Pentaho Errors — portable package

A self-contained Pentaho error-analysis page you can drop into another website.
It renders AI-analysis issue JSON produced from Pentaho Data Integration (PDI)
logs: a KPI row, a searchable/filterable issue table, and a detail dialog with
the full analysis fields, a single latest evidence chunk, raw context, and a
local status / comments / status-history workflow.

```
Pentaho log  ->  error extraction  ->  (AI) analysis  ->  structured JSON  ->  API  ->  this page
                 \___ backend/process-logs.js ___/         \_ pentaho-ai-issues.json _/
```

## Contents

| File | Role |
|------|------|
| `index.html` | Standalone page. Contains the `#view-errors` section and `#error-dialog`. |
| `pentaho-error.css` | Self-contained styles (own design tokens, scoped to `.pe-root` / `#error-dialog`). |
| `pentaho-error.js` | Page logic: rendering, search/filter/paging, detail dialog, status tracking. |
| `pentaho-data-service.js` | Data loader. `fetch()` first, falls back to the embedded copy on `file://`. |
| `pentaho-ai-issues.json` | The issue data (the file an API would serve). Sample included. |
| `pentaho-ai-issues.data.js` | Embedded copy of the JSON for `file://` use (`window.PENTAHO_AI_ISSUES`). |
| `backend/process-logs.js` | Node processor: scans whole PDI logs and emits the JSON. |

## Run it

- **Quick preview (no server):** open `index.html` directly. The page loads
  `pentaho-ai-issues.data.js` (the embedded copy) because browsers block
  `fetch()` of local files under `file://`.
- **Served (http/https):** host the folder. The data service fetches
  `pentaho-ai-issues.json`; the embedded `.data.js` is then optional.

## Generate JSON from new logs

The processor reads the **entire** log file(s) — there is **no** 20/480-minute
time window. Every error is considered, then grouped so each distinct root cause
appears once (the latest occurrence, with a context block).

```
cd backend
node process-logs.js <SOURCE_FILE_OR_FOLDER> [OUTPUT_JSON] [options]
```

Examples:

```
# Scan a folder of logs, write the JSON the page reads, and the file:// embed copy
node process-logs.js "C:\pdi\logs" "..\pentaho-ai-issues.json" --emit-embed

# Scan a single file
node process-logs.js "C:\pdi\logs\AEON_INVOIC_Log_20260824.txt" out.json
```

Options:

- `--emit-embed` — also write `<output>.data.js` (for `file://`).
- `--context-before=N` — context lines kept before the error (default `40`).
- `--context-after=N` — context lines kept after the error (default `20`).

### How extraction works

1. Walk the file(s) line by line (whole file, no cutoff).
2. A line starts an actionable error only if it carries a real PDI failure
   marker (`ERROR (version ...)`, a `*Exception`, or a known failure phrase).
   Informational lines, cascade/propagation lines (`Aborting job`,
   `Transformation detected ... errors`), stack frames, and the known benign
   `Didn't detect SQL data before timeout` are ignored.
3. The leaf **root cause** is taken from the region after the marker, preferring
   a line a classifier recognises over a framework wrapper.
4. Issues are grouped by `(workflow + classified type)` so copies across step
   aliases collapse into one issue. The **latest** occurrence supplies the
   timestamp, evidence line range, and `raw_context`.
5. Each group is classified into `type` / `priority` / `title` / `suggested_fix`.

Add or tune detection by editing the `CLASSIFIERS` array and the
`ERROR_MARKER_RE` / `CASCADE_RE` / `INFO_RE` regexes at the top of
`backend/process-logs.js`. No redaction is applied — IPs, endpoints, file paths,
and the PDI version string (e.g. `8.3.0.0-371`) are preserved as-is.

## JSON schema

Top level:

```json
{
  "generatedAt": "2026/08/26 11:00:00",
  "source": "PROCESSOR | MOCK",
  "schemaVersion": "ai-analysis-v1",
  "summary": {
    "logsScanned": 8,
    "logsWithRootCauses": 5,
    "ignoredKnownBenignLines": 17,
    "duplicateBlocksCollapsed": 52,
    "rootCauseEvents": 58,
    "rootCauseGroups": 6,
    "highIssues": 6,
    "mediumIssues": 0
  },
  "issues": [ /* Issue objects, see below */ ]
}
```

Each issue (the AI-analysis fields the page displays):

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable id, e.g. `PDI-<signature>`. |
| `fingerprint` | string | De-dup / tracking key (status + comments keyed by this). |
| `log_name` | string | Source log filename. |
| `timestamp` | string | Latest occurrence, `YYYY/MM/DD HH:MM:SS`. |
| `priority` | `HIGH` \| `MEDIUM` | Shown as the badge. |
| `workflow` | string | Workflow / job name (folder or log prefix). |
| `failed_step` | string | The PDI step that failed. |
| `exception` | string | Exception class if detected. |
| `root_cause` | string | Leaf cause line. |
| `affected_field` | string | e.g. a column or field name. |
| `affected_value` | string | e.g. the offending value / endpoint. |
| `expected_format` | string | e.g. a date mask or expected type. |
| `impact` | string | Plain-language impact. |
| `likely_cause` | string | Plain-language likely cause. |
| `suggested_fix` | string[] | Rendered as a numbered list (single line if one item, "No suggested action available." if empty). |
| `confidence` | `HIGH` \| `MEDIUM` \| `LOW` | Shown in the detail meta. |
| `status` | `NEW` \| `ACKNOWLEDGED` \| `RESOLVED` | Seeds the local tracking status. |
| `raw_context` | string | Multi-line captured block (newline-separated). |

Fields also used for the table/evidence: `title`, `type`, `primaryComponent`,
`componentAliases[]`, `sourceLogs[]`, `firstSeen`, `lastSeen`, `occurrences`,
`rawBlockCount`, `duplicateBlocksCollapsed`, `evidence[]`
(`{ sourceLog, timestamp, component, startLine, endLine }`). The detail view
shows only the **single latest** evidence entry.

## Status mapping

The schema `status` seeds the UI tracking vocabulary once:
`NEW -> New`, `ACKNOWLEDGED -> In Progress`, `RESOLVED -> Fixed`.
After that, status / comments / history are managed on the page and persisted in
`localStorage` under `pentaho-error-issue-tracking-v1`, keyed by `fingerprint`.
Every status change requires a reason, which is also recorded as a comment.

## Embedding into another site

1. Copy this folder into your site.
2. Add `<link rel="stylesheet" href="pentaho-error.css">`.
3. Copy the `<section id="view-errors">` and `<dialog id="error-dialog">`
   blocks from `index.html` into your page.
4. Include the three scripts (order matters):
   ```html
   <script src="pentaho-ai-issues.data.js"></script>   <!-- optional if served over http -->
   <script src="pentaho-data-service.js"></script>
   <script src="pentaho-error.js"></script>
   ```
5. To use a live backend, set `REMOTE_URL` in `pentaho-data-service.js` to your
   API endpoint. Keep it returning the schema above.
```
