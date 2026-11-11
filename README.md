# DM Monitoring Dashboard

A support-team dashboard for monitoring **eHub B2B/EDI document flows** and **ETL (Pentaho/PDI) errors**. It reads document records (Purchase Orders, invoices, debit/credit advices, etc.) exchanged between trading partners and focuses on actionable operations:

- **Missing-file alerts** for priority buyers, with a call-to-action workflow
- **Trend & analysis** of file arrival timing and volume
- **ETL error triage** with root cause + suggested fix

Built with **Node.js + Express + Socket.io** (backend) and **vanilla JS + Chart.js** (frontend).

> This README is the maintenance reference. It documents not just *how to run* the app but **all the business logic** — the alert algorithm, the trend math, the half-month snapshot mechanism, and the SQL query builder — so a new developer can maintain and extend it confidently.
>
> The full operations guide (architecture, Linux on-premise production deployment, go-live checklist, maintenance runbook) is in **`DM_Monitoring_Dashboard_Technical_Document.docx`**.

---

## Table of contents

1. [Quick start](#quick-start)
2. [High-level architecture](#high-level-architecture)
3. [Data sources & the record shape](#data-sources--the-record-shape)
4. [The two data paths (this is the core mental model)](#the-two-data-paths)
5. [SQL query building (dialect-aware)](#sql-query-building)
6. [Trends & Analysis logic](#trends--analysis-logic)
7. [The half-month snapshot mechanism](#the-half-month-snapshot-mechanism)
8. [Missing-File Alert logic](#missing-file-alert-logic)
9. [ETL Errors tab](#etl-errors-tab)
10. [Admin configuration](#admin-configuration)
11. [Managing database connections](#managing-database-connections)
12. [AI Assistant (Amazon Quick)](#ai-assistant-amazon-quick)
13. [Status codes & glossary](#status-codes--glossary)
14. [API reference](#api-reference)
15. [Environment variables](#environment-variables)
16. [Project structure](#project-structure)
17. [Common maintenance tasks](#common-maintenance-tasks)
18. [Security](#security)
19. [CI/CD](#cicd)
20. [Production deployment (Linux, on-premise)](#production-deployment-linux-on-premise)

---

## Quick start

```bash
npm install
npm run dev        # or: npm start
```

Open `http://localhost:3000`. Stop with `Ctrl + C` (Windows: `taskkill /f /im node.exe`).

- Prerequisites: **Node.js 18+**, npm.
- Default data source is **CSV**. To try it with the bundled fictional data, set `TREND_CSV_DIR=data/Trenddata/sample`. Set `TREND_SOURCE=db` in `.env` to use live databases.

---

## High-level architecture

```
                            ┌─────────────────────────────────────────┐
                            │            Browser (frontend)            │
                            │  index.html + /js/*.js + Chart.js        │
                            │  Tabs: Alerts · Trends · ETL Errors      │
                            └───────────────┬─────────────────────────┘
                                            │ REST (/api/*) + Socket.io
                            ┌───────────────▼─────────────────────────┐
                            │            Express (server.js)           │
                            │  routes/api.js · routes/admin.js · auth  │
                            └───────────────┬─────────────────────────┘
                                            │
        ┌───────────────────────────────────┼───────────────────────────────────┐
        ▼                                    ▼                                    ▼
┌───────────────────┐          ┌───────────────────────────┐        ┌────────────────────────┐
│ trendDataService  │          │ missingFileAlertService   │        │ settingsService        │
│ - loads records   │          │ - detects missing files   │        │ - config (settings.json)│
│ - loadAllRecords  │◄─────────│ - builds alert profiles   │        │ - builds SQL queries    │
│ - loadAggregates  │          │   (from aggregates)       │        │ - priority buyers,      │
│ - trend/analysis  │          │ alertStateStore (statuses)│        │   doc types, email tpl  │
└─────────┬─────────┘          └───────────────────────────┘        └────────────────────────┘
          │
          │ DB mode
   ┌──────▼───────────────┐        ┌──────────────────────┐
   │ trendProviderFactory │──────► │ trendMssqlProvider    │ (mssql driver)
   │  getProvider(conn)   │        │ trendMysqlProvider    │ (mysql2 driver)
   └──────────────────────┘        └──────────────────────┘
          │
   ┌──────▼───────────────┐
   │ trendSnapshotStore   │  data/trendSnapshot.json (half-month cache: 1–14 / 15–end)
   └──────────────────────┘

   emailService ── nodemailer ──► SMTP relay (Admin → SMTP Server)
   fileDetailsService ──────────► live DOCUMENT lookup (tab hidden, admin-only API)
```

**Key services:**

| Service | Responsibility |
|---------|----------------|
| `config/trendSource.js` | Reads `.env`, decides CSV vs DB, builds the list of DB connections (MSSQL/MySQL, up to 20). |
| `services/settingsService.js` | Runtime config (priority buyers, doc types, email, data-source query) + **the SQL query builder** (raw + aggregate, dialect-aware). |
| `services/trendDataService.js` | Loads + caches data; exposes records (for alerts) and daily aggregates (for trends); all trend/analysis functions. |
| `services/trendProviderFactory.js` | Returns the MSSQL or MySQL provider for a connection based on its `client`. |
| `services/trendMssqlProvider.js` / `trendMysqlProvider.js` | Run queries against one connection; map rows to the normalized shape. |
| `services/trendRowMapper.js` | Shared row→record normalization + date resolution (used by both providers). |
| `services/trendSnapshotStore.js` | Persists/loads the half-month trend snapshot; computes the window (`computeWindow`). |
| `services/missingFileAlertService.js` | The missing-file **detection + alert profile** logic. |
| `services/alertStateStore.js` | Persists per-alert status (new/review/resolved/ignored) + re-alert timing. |
| `services/emailService.js` | Sends alert emails and tests SMTP (nodemailer), using the Admin SMTP settings. |
| `services/fileDetailsService.js` | Live, parameterized lookup of `DOCUMENT` / `DOCUMENT_CONTENT_MAPPING` in one database (File Details, currently hidden). |
| `services/authService.js` | Admin credential check (bcrypt). |

---

## Data sources & the record shape

Controlled by **one** setting in `.env`:

```
TREND_SOURCE=csv    # read CSV files from data/Trenddata/  (default)
TREND_SOURCE=db     # query database(s) directly
```

Every feature consumes the **same normalized record shape**, regardless of source:

```js
{
  doc_id:      "…",              // DOCID
  workflow_id: "ORDERS_AEON_…",  // WORKFLOWID
  file_name:   "…",              // DOCFILENAME
  size_kb:     12.34,            // DOCSIZE / 1024 (rounded 2dp)
  size_bytes:  12634,
  received:    "2026-09-14 08:16:11",  // resolved datetime (see below)
  status:      "50",             // 50 = done, 45 = in progress, 999 = error
  source_file: "integration_ehub"      // CSV filename OR DB connection name
}
```

### CSV mode

- Reads **every** `*.csv` in `data/Trenddata/`, parsed by **column name** (not position).
- Required columns: `WORKFLOWID`, `DOCFILENAME`, `DOCSIZE` (bytes), `CREATIONDATE`, `STATUS`, `DOCID`. `METADATA`, `RECEIVEDATE` used as date fallbacks.
- Rows with an empty `DOCFILENAME` are skipped.
- Data cached at startup — restart after adding/replacing files.

### DB mode

- Multiple databases (same schema) are combined into one view, queried in parallel. Each record is tagged with its source connection name. One failing database does not stop the others.
- **Current setup:** 4 MSSQL databases on port 5500 — `integration_ehub` (DB1), `general_ehub` (DB3), `general_ehub2` (DB4), `aeon_ehub` (DB5). DB2 is an empty MySQL placeholder (no host, skipped). See [Managing database connections](#managing-database-connections).
- Connections can be a **mix of MSSQL and MySQL** — per connection `TREND_DBx_CLIENT=mssql|mysql`.
- Connections are numbered `TREND_DB1_*` … (scans up to `TREND_DB20_*`). Legacy single-DB `TREND_DB_*` is accepted as connection #1 if no numbered ones exist.
- The table is **connection-relative** (`dbo.DOCUMENT`, no database prefix), so the same query works on every connection — each opens its own database (`integration_ehub`, `general_ehub`, `aeon_ehub`, …). For MySQL the `dbo.` prefix is stripped automatically.
- If all connections fail, the app logs a clear message and **falls back to CSV mode**.

### Date resolution (`services/trendRowMapper.js` → `resolveDatetime`)

`received` is resolved with this priority (some exports mangle `CREATIONDATE`):

1. **`CREATIONDATE`** if it's a valid full datetime → normalized to `YYYY-MM-DD HH:MM:SS`.
2. **`METADATA`** `<lastModified>YYYYMMDDHHMMSS</lastModified>` → parsed.
3. **`RECEIVEDATE`** (date only) → appended `00:00:00`.
4. Otherwise `null` (record is ignored by time-based logic).

> **Timezone note:** DB timestamps are treated as **wall-clock strings** and compared in the server's **local timezone** (see `localDayStr` in the alert service). If you deploy to a server in a different timezone than the data, make the timezone explicit.

---

## The two data paths

This is the single most important concept for maintaining the app. There are **two separate caches**, fed by **two separate queries**, serving **two different features**:

| | **Raw records** | **Daily aggregates** |
|---|---|---|
| Cache var | `cachedRecords` | `cachedAggregates` |
| Accessor | `loadAllRecords()` | `loadAggregates()` |
| Source query | `getEffectiveQuery(client, dbName)` — last **`alertDays`** (3) days | `getAggregateQuery(client, window, dbName)` — `GROUP BY`, **no cap** |
| Powers | **Alerts tab** (needs per-file detail + today/yesterday) | **Trends & Analysis tab** + alert **profiles** |
| Freshness | Re-queried on every startup / reload | **Half-month snapshot** — DB read twice a month (see below) |
| Size | All rows in the 3-day window (~113k today across 4 DBs) | ~`workflows × 14–16` rows (a few thousand) |

**Why two paths?**
- Alerts must know "did a file arrive *today*?" → needs recent, per-document data.
- Trends describe "what's normal over a settled half-month" → only needs daily summaries, which don't change once the period is over, so we snapshot them.

Both are loaded in `trendDataService.initData()` (called once at startup). In DB mode, raw records are always re-queried; aggregates come from the snapshot (DB only if stale).

---

## SQL query building

All SQL is generated in `services/settingsService.js`, dialect-aware (MSSQL vs MySQL). Two builders share one filter helper.

### Shared filters — `buildFilterClauses(settings, isMysql, opts)`

Produces the `WHERE` conditions used by both queries:

1. **Workflow selection** — a workflow is included when either is true:
   - its `WORKFLOWID` **contains** a priority-buyer keyword (`settings.priorityBuyers`) **and** its `DOCTYPEID` is in `settings.documentTypes` (empty = all types); or
   - it **exactly matches** an entry in `settings.monitoredWorkflows` (bypasses the document-type filter).
   ```sql
   ( ((WORKFLOWID LIKE '%AEON%' OR …) AND DOCTYPEID IN ('ORDERS'))
     OR WORKFLOWID IN ('<exact ids for this database>') )
   ```
   **DB pinning:** a monitored entry written as `dbName | WORKFLOWID` is only queried on that connection (`getMonitoredWorkflowsFor(dbName)`); an entry without a prefix is queried on every database.
2. **Rolling date window** (skipped if `opts.skipDate`): `RECEIVEDATE >= DATEADD(day,-N,GETDATE())` (MSSQL) / `DATE_SUB(NOW(), INTERVAL N DAY)` (MySQL). Alerts use `N = dataSource.alertDays`.

### 1) Raw-record query — `getEffectiveQuery(client, dbName)`

Powers the **Alerts** tab. Starts from the base query (`dataSource.query`, default `SELECT … FROM dbo.DOCUMENT`; the Admin Query card is hidden) and layers on:

- MySQL: strip `dbo.` from the table.
- `WHERE` = shared filter clauses for **this database** (selection + `alertDays` window), **only if the base query has no WHERE of its own**.
- `ORDER BY RECEIVEDATE DESC`.
- Optional row cap (`dataSource.rowCap`, default **0 = off**): MSSQL `SELECT TOP (n)`, MySQL `LIMIT n`. The date window is the real limit; a shared cap would starve quiet workflows.

Example (MSSQL, current settings):
```sql
SELECT DOCID, WORKFLOWID, DOCFILENAME, DOCSIZE, CREATIONDATE, STATUS, METADATA, RECEIVEDATE
FROM dbo.DOCUMENT
WHERE ( ((WORKFLOWID LIKE '%AEON%' OR … OR WORKFLOWID LIKE '%7ELEVEN%') AND DOCTYPEID IN ('ORDERS'))
        OR WORKFLOWID IN ('INVOIC_7ELEVEN-…', …) )
  AND RECEIVEDATE >= DATEADD(day,-3,GETDATE())
ORDER BY RECEIVEDATE DESC
```

### 2) Daily-aggregate query — `getAggregateQuery(client, window, dbName)`

Powers the **Trends & Analysis** tab (and alert profiles). One row **per (workflow, day)**, computed server-side:

| Output column | Meaning |
|---|---|
| `WORKFLOWID`, `DAY` | grouping keys (day = date only) |
| `CNT` | documents that day |
| `CNT_50`, `CNT_45`, `CNT_999` | per-status counts |
| `MIN_HOUR`, `MAX_HOUR`, `AVG_HOUR` | arrival time as **decimal hour** (`hour + minute/60`) |
| `AVG_SIZE_KB`, `MIN_SIZE_KB`, `MAX_SIZE_KB` | file sizes in KB |

- **No row cap** — aggregation is cheap in rows, so we keep the full window.
- Same workflow selection (buyers + doc types, or exact monitored workflows, with DB pinning).
- `window = { from, to }` (used by the snapshot): fixed inclusive range `RECEIVEDATE >= from AND RECEIVEDATE < (to + 1 day)`; the rolling filter is skipped.
- Without `window`: uses the rolling `historyDays` window (legacy/live behaviour, not used by the snapshot).
- Runs with the longer `TREND_DB_AGG_TIMEOUT_MS` (300000 = 5 min) because the `GROUP BY` is heavy without an index on `RECEIVEDATE`.

Example (MySQL, snapshot window):
```sql
SELECT WORKFLOWID, DATE(RECEIVEDATE) AS DAY, COUNT(*) AS CNT,
       SUM(CASE WHEN STATUS='50' THEN 1 ELSE 0 END) AS CNT_50, … ,
       MIN((HOUR(RECEIVEDATE)+MINUTE(RECEIVEDATE)/60.0)) AS MIN_HOUR, … ,
       AVG(DOCSIZE/1024.0) AS AVG_SIZE_KB, …
FROM DOCUMENT
WHERE (WORKFLOWID LIKE '%AEON%' OR …) AND DOCTYPEID IN (…)
      AND RECEIVEDATE >= '2026-09-01' AND RECEIVEDATE < DATE_ADD('2026-09-14', INTERVAL 1 DAY)
GROUP BY WORKFLOWID, DATE(RECEIVEDATE)
ORDER BY WORKFLOWID, DATE(RECEIVEDATE)
```

> **Decimal hour** is used everywhere for time math: `09:30 → 9.5`. Formatted back to `HH:MM` for display (`fmtHour` / `formatHour`).

---

## Trends & Analysis logic

All in `services/trendDataService.js`, computed **from the aggregates** (`loadAggregates()`), then rendered by `public/js/trends.js` + `public/js/insights.js`.

### The tab (`#tab-trends`)

- **Workflow selector** (top) — drives everything on the tab. `ALL` = combined across workflows.
- **Arrival Time Trend** chart — per day: earliest / average / latest arrival (line chart, Y-axis = hour 0–24).
- **File Size Trend** chart — per day: average + max size (KB).
- **📊 Workflow File Trend Analysis** box — per-workflow stat cards. **Follows the top selector** (no separate dropdown). Shows "select a workflow" when `ALL` is chosen.
- **Insights** — text summary derived from the trend data.
- Window label from `GET /api/trend-window`, e.g. "Oct 2026 (1–14)" (there is no user range control; see snapshot section).
- A full-page loading spinner (`App.showLoader()` / `App.hideLoader()` in `public/js/app.js`) shows while data loads.

### `getTrendData(workflowId, days)` → the Arrival Time chart

1. Filter aggregates to the workflow (or all).
2. Merge same-day rows across workflows/connections:
   - `count` = sum of counts
   - `earliest` = **min** of the days' `minHour`
   - `latest` = **max** of the days' `maxHour`
   - `avg` = **count-weighted** average of `avgHour`
3. Sort by date, keep last `days`.
4. Returns `{ workflow_id, days, data: [{ date, earliest, latest, avg, count }] }`.

### `getSizeTrend(workflowId, days)` → the File Size chart

Per day: `size_kb` = count-weighted average of `avgSizeKb`; `max_size_kb` = max of `maxSizeKb`. Returns `[{ date, size_kb, max_size_kb }]`.

### `getWorkflowAnalysis()` → the analysis cards

For each workflow, from its aggregate rows:

| Card | How it's computed |
|---|---|
| **Files Start Coming In** (`avgFirstArrival`) | average of each day's `minHour` (earliest arrival per day) |
| **Avg Files/Day** (`avgDailyCount`) | `totalRecords / totalDays` |
| **Avg File Size** (`avgSizeKb`) | count-weighted average of `avgSizeKb`; range from min/max size |
| **Peak / Quietest Day** | date with max / min daily count |
| **Peak Hours (80%)** | approximated as `[min of minHour, max of maxHour]`. ⚠️ true p10–p90 needs per-file data, which we intentionally don't pull — this is a documented approximation. |
| **Busiest / Quietest Day of Week** | sum daily counts per weekday |
| **Error Rate** | `CNT_999 / total` |
| **Status distribution** | from `CNT_50 / CNT_45 / CNT_999` (+ "other") |

### `generateSummary()` / `getReliabilityScores()`

Also computed from aggregates — totals, completion rate (`CNT_50/total`), most-active workflow, date range. `getReliabilityScores` = per-workflow `completed/total` score.

> **Note:** `getArrivalTimes()` now returns `[]` — individual scatter points were dropped when trends moved to aggregation (the frontend never rendered them). Kept for API back-compat.

---

## The half-month snapshot mechanism

**Problem it solves:** the aggregate `GROUP BY` over busy production DBs is slow (minutes per database without an index). We don't want that on every restart, and trends don't need live data.

**Solution:** compute the aggregates **once per half-month phase**, persist to `data/trendSnapshot.json`, and reuse it.

### The window — `trendSnapshotStore.computeWindow(now)`

Each month has two phases: **P1 = days 1–14** and **P2 = days 15–end of month**. The dashboard analyses the phase **one older than the most recently completed phase**. The lag exists because clients sometimes send a period's files late (around the 15th–20th), so a phase is only analysed once it has fully settled.

| Today | Most recent completed phase | Window analysed |
|---|---|---|
| 1 Oct – 14 Oct | 15–30 Sep | **1–14 Sep** |
| 15 Oct – 31 Oct | 1–14 Oct | **15–30 Sep** |
| 1 Nov – 14 Nov | 15–31 Oct | **1–14 Oct** (current snapshot) |
| 15 Nov – 30 Nov | 1–14 Nov | **15–31 Oct** |

Returns `{ from, to, label, key }`, e.g. `{ from: '2026-10-01', to: '2026-10-14', label: 'Oct 2026 (1–14)', key: '2026-10-P1' }`. `key` (`YYYY-MM-P1` / `YYYY-MM-P2`) is the window's identity; it changes on the **1st** and the **15th**.

### The lifecycle — `trendDataService.loadTrendSnapshot()`

Whenever data is loaded (DB mode):

1. Read `data/trendSnapshot.json`. If its `window.key` matches today's target window → **load rows from disk, no DB read.** (The common path — fast restarts.)
2. Otherwise (missing / stale / forced): run `getAggregateQuery(client, {from,to}, dbName)` per connection in parallel (no cap, `TREND_DB_AGG_TIMEOUT_MS`), merge, **persist to disk**, cache.
3. If a rebuild fails entirely, keep the previous snapshot rather than wiping trends.

**When does it refresh?** The staleness check runs on **server start** and on **Admin → Reload data** (`reloadData()` → `initData()`). There is no background timer, so on a server that stays up across the 1st/15th, the new phase is picked up at the next restart or reload. To refresh immediately: Admin → Trend & Analysis → **Rebuild snapshot now** (`refreshTrendSnapshot()` / `POST /api/admin/refresh-trend-snapshot`).

**Rebuild after configuration changes** (new monitored workflows, buyers, document types or databases) so they appear in Trends.

Snapshot file shape:
```json
{
  "window": { "from": "2026-10-01", "to": "2026-10-14", "label": "Oct 2026 (1–14)", "key": "2026-10-P1" },
  "generatedAt": "2026-11-02T02:31:48.000Z",
  "rows": [ { "workflow_id": "…", "day": "2026-10-03", "count": 50, "cnt50": 48, "minHour": 8.5, … } ]
}
```

> CSV mode derives aggregates in-memory from records (no snapshot file needed).

---

## Missing-File Alert logic

`services/missingFileAlertService.js` — the Alerts tab (`#tab-alerts`). This is the app's flagship feature; understand it fully before editing.

### What triggers an alert — `getMissingFileAlerts()`

For each **monitored** workflow (priority-buyer keyword match, case-insensitive, or an exact entry in Monitored Workflows), using records from the last `alertDays` (3) days:

1. **Need history:** the workflow must have **≥ 3 recent records** (from `loadAllRecords()`), else skip — not enough to judge.
2. **Find the gap:**
   - `lastTime` = its most recent file (local day = `lastDay`).
   - `expectedDay` = the **calendar day after** `lastDay`.
   - If the workflow already has files on `expectedDay` → **fine, no alert.**
3. **Future guard:** if `expectedDay` is in the **future** (last file was today → expected = tomorrow) → skip. Nothing is missing yet.
4. **Time-of-day gate** (only when `expectedDay` is **today**): don't alert too early. A file is "late" only once **now ≥ usual-first-arrival + 1 hour** (`avgFirstArrival + 1`). Before that, stay silent (it may still be arriving on schedule). For a **past** expected day (whole day elapsed) → always alert.
5. If all the above pass → **raise the alert.**

> `alertDays` must be **≥ 2**: with a 1-day window every workflow's last file is today, its expected day is tomorrow, and no alert can ever be raised. The default 3 gives slack for weekends and short gaps.

### The alert profile — matches the Trends tab exactly

The numbers shown on an alert (avg files/day, usual arrival, latest arrival, avg size, busiest day) come from **`buildProfile(aggRows)`**, fed by the **same daily aggregates** as the Trends & Analysis tab. So an alert and the Trends card for the same workflow always agree.

- **Detection** uses recent records (needs today/yesterday).
- **Profile/expectation** uses the snapshot aggregates.
- Fallback: if a workflow has **no snapshot rows** (e.g. brand new), `buildProfileFromRecords()` derives the profile from recent records instead (same shape).

Profile fields: `avgPerDay`, `minPerDay`, `maxPerDay`, `avgFirstArrival(+Label)` ("Usually arrives by"), `latestFirstArrival(+Label)` ("Latest arrival" = worst-case earliest arrival across days), `avgSizeKb`, `busiestDay`, `quietestDay`, `activeDays`, `firstSeen`, `lastSeen`.

### Status workflow — `services/alertStateStore.js`

Each alert has an id `missing::<workflow>::<expectedDay>`. Status is persisted to `data/alertStates.json` (survives restarts):

| Status | Meaning |
|---|---|
| `new` | 🔴 Active — needs attention |
| `review` | 📧 In Review — alert email sent. Re-surfaces to `new` after `reAlertMinutes` (default 30) if still missing. |
| `resolved` | ✅ Closed |
| `ignored` | 🚫 Dismissed |

### Sending the alert email — `POST /api/missing-alerts/:id/send`

1. **Send Alert Email** opens a draft rendered from the Admin template (`GET …/draft`).
2. On **Send**, `emailService` sends it through the SMTP server configured in Admin → SMTP Server (nodemailer).
3. On success the alert moves to `review` and `emailSentAt` / `reviewUntil` are recorded. If SMTP is disabled or fails, the modal stays open and shows the error; status is unchanged.

Default recipient: **`helpdesk@b2b.com.my`**. The body starts with *"Hi Helpdesk, Please assist to raise ticket to {buyer}."* followed by the message to the buyer.

> SMTP is currently **disabled** in `config/settings.json` (internal relay, port 25, no auth). Enable it in Admin and use **Test connection** before relying on it.

### Sort order

Active (`new`/`review`) first, then resolved/ignored; **within each group, most recent `lastReceived` first (descending)**, then workflow name.

### Email recipients — `getRecipientFor(workflowId)`

Priority: exact workflow-id match in `email.recipients` → a configured key **contained** in the workflow id (e.g. `AEON`) → the general `email.recipient` template. Templates support placeholders: `{buyer}`, `{workflow}`, `{expectedDay}`, `{lastReceived}`, `{avgPerDay}`, `{avgFirstArrival}`.

---

## ETL Errors tab

Root-cause analysis of ETL (Pentaho/PDI) log errors. Tab id `#tab-pentaho`, logic in `public/js/pentaho-error.js`, data via `public/js/pentaho-data-service.js`.

- **Data source:** AI-analysis issue JSON at `public/data/pentaho-ai-issues.json` (served statically). Generate from real logs:
  ```
  node scripts/pentaho-process-logs.js <SOURCE_FILE_OR_FOLDER> public/data/pentaho-ai-issues.json --emit-embed
  ```
- **UI:** KPI row (logs scanned, root-cause groups, duplicates collapsed), searchable/filterable issue table (priority filter + paging), and a detail dialog (root cause, exception, suggested fix, raw log context).
- **Per-issue tracking:** status workflow New → In Progress → Fixed with a required comment, persisted in the **browser** (`localStorage`, key `pentaho-error-issue-tracking-v1`).
- To use a live API instead of the static file, change `REMOTE_URL` in `public/js/pentaho-data-service.js`. Falls back to the embedded copy (`window.PENTAHO_AI_ISSUES`) when `fetch` is blocked (e.g. `file://`).
- Processor + JSON schema details: `docs/pentaho-error-module.md`.

> Note: the tab is labelled **"ETL Errors"** in the UI. Internal filenames/identifiers keep the `pentaho-` prefix (the log source technology); the raw log text legitimately contains `org.pentaho.di.*` package names.

---

## Admin configuration

Session-gated config page at `/admin` (⚙️ Admin link in the header). Auth: `express-session` + bcrypt, credentials from `.env`.

- **Login:** `/login`. `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` (bcrypt, preferred) or `ADMIN_PASSWORD` (plaintext demo fallback).
- Settings persist to `config/settings.json`, applied **live** (no restart) via `settingsService`.

**Cards:**

| Card | Edits |
|---|---|
| 📧 **Missing-File Alert Email** | default recipient, subject, body template |
| 📤 **SMTP Server** | enabled, host, port, secure, user, password (masked; blank = keep), from name/address, **Test connection** / test email |
| ⏰ **Re-alert Window** | minutes before an In Review alert returns to Active |
| 📮 **Per-Workflow Recipients** | searchable dropdown + add/remove overrides |
| 🎯 **Priority Buyers** | buyer keywords (substring match) + display labels |
| 🧩 **Monitored Workflows (exact)** | exact WORKFLOWIDs, one per line, optional `dbName \| WORKFLOWID` pinning; bypass document types |
| 📄 **Document Types** | `DOCTYPEID`s for keyword matches (ORDERS/INVOIC/DEBADV/CREADV/ARINV) |
| 🗄 **Database Connections** | **read-only** list + **Test** each / all with `SELECT 1`; reload data. Connections are added in `.env` only (see below) |
| 📝 **Query** | *hidden* — base SELECT is kept at its default |
| 📈 **Trend & Analysis** | snapshot window (current/target), freshness, row count + **Rebuild snapshot now** |
| 🛡 **Alerts data** | `alertDays` window (min 2, default 3) and optional `rowCap` (0 = off) |

**Current settings** (`config/settings.json`): priority buyers `AEON, MYDIN, ALFAMART, ALFAMIDI, UNILEVER_WALLS_ID, 7ELEVEN`; document types `ORDERS`; 5 exact monitored 7ELEVEN workflows (INVOIC / ORDERS / REMADV, incl. HEC variants); re-alert 30 min; `alertDays` 3; `rowCap` 0.

Generate a password hash: `node scripts/hash-password.js "yourPassword"` → put in `.env` as `ADMIN_PASSWORD_HASH`. Set `SESSION_SECRET` to a long random string.

---

## Managing database connections

Connections are defined **only in `.env` on the server**. The Admin page lists and tests them but **cannot add or edit** them. This is deliberate:

| | Add from the dashboard | Add in `.env` (chosen) |
|---|---|---|
| Password storage | In a file the web app can write | Stays in `.env` (chmod 600), owned by the server admin |
| If the admin login is stolen | Attacker can point the app at any server or read stored passwords | Attacker can only view and test existing connections |
| Who can change it | Anyone with the dashboard admin login | Only people with SSH access (change control) |

`config/trendSource.js` reads `TREND_DB1_*` … `TREND_DB20_*`. A block with no `HOST` is skipped and gaps are allowed. Slots **1, 3, 4, 5** are in use; slot 2 is an empty MySQL placeholder (reuse it, or use 6+).

### Add a new database

1. Ask the DBA for a **read-only** login with `SELECT` on `dbo.DOCUMENT` (and `DOCUMENT_CONTENT_MAPPING` for File Details). The database must have the same `DOCUMENT` columns as the others.
2. Check the network from the server: `nc -zv <db-host> <port>`.
3. Add a block to `.env`:
   ```ini
   TREND_DB6_NAME=giant_ehub          # label in the dashboard; also the name used for pinning
   TREND_DB6_CLIENT=mssql             # mssql or mysql
   TREND_DB6_HOST=<db-host>
   TREND_DB6_PORT=5500                # always set it; defaults are 1433 (mssql) / 3306 (mysql)
   TREND_DB6_DATABASE=giant_ehub
   TREND_DB6_USER=dm_read
   TREND_DB6_PASSWORD="p@ss#word"     # quote values containing # or spaces
   TREND_DB6_ENCRYPT=false
   TREND_DB6_TRUST_CERT=true
   # TREND_DB6_ENABLED=false          # optional: keep the block but switch it off
   ```
4. Restart (the list is read only at startup): `pm2 reload dm-dashboard --update-env` (locally: stop and `npm start`).
5. Check the log for `giant_ehub → N records` and `from 5/5 connection(s)`.
6. Header badge shows **MSSQL (5 DBs) · Connected**; Admin → Database Connections → **Test all connections** passes.
7. Admin → Trend & Analysis → **Rebuild snapshot now**. Alerts include the new database right after the restart; Trends only after the rebuild.
8. Optional: pin workflows to it in Monitored Workflows, e.g. `giant_ehub | ORDERS_GIANT-…`.

### Other changes

| Change | How |
|---|---|
| Disable temporarily | `TREND_DBx_ENABLED=false`, restart |
| Remove | Delete the block, restart, rebuild the snapshot |
| Rotate a password | Update `TREND_DBx_PASSWORD`, restart |
| Move to a new host | Update HOST/PORT, `nc -zv`, restart, test in Admin |

> Each database adds to the first-load and snapshot-rebuild time (up to 5 min per database before timeout). An index on `RECEIVEDATE` keeps it fast:
> ```sql
> CREATE INDEX IX_DOCUMENT_RECEIVEDATE ON dbo.DOCUMENT (RECEIVEDATE) INCLUDE (WORKFLOWID, DOCTYPEID, DOCSIZE, STATUS);
> ```

---

## AI Assistant (Amazon Quick)

A floating 💬 assistant embeds an **Amazon Quick AI agent** into the dashboard.

- Reads `QUICK_EMBED_URL` from `.env`. Set → renders the Quick agent in an iframe. Blank → shows a "not configured yet" message.
- Endpoint: `GET /api/assistant/config` → `{ configured, embedUrl }`.
- AWS setup (your AWS team): deploy `aws-samples/sample-quicksuite-chat-embedding`, share the agent + knowledge-base resources, put the resulting URL in `QUICK_EMBED_URL`. See `docs/embed-amazon-quick-agent-notes.txt`.

---

## Status codes & glossary

| Code | Meaning |
|------|---------|
| `50` | Completed / Archived (success) |
| `45` | In Progress |
| `999` | Error |

- **WORKFLOWID** — the trading-partner flow id, e.g. `ORDERS_AEON_MY_DKSH_MY_AEON_MY`. Priority buyers are matched as substrings of this.
- **DOCTYPEID** — document type: ORDERS, INVOIC, DEBADV, CREADV, ARINV.
- **Priority buyer** — a buyer keyword (currently AEON, MYDIN, ALFAMART, ALFAMIDI, UNILEVER_WALLS_ID, 7ELEVEN) monitored for missing files.
- **Monitored workflow** — an exact WORKFLOWID monitored regardless of document type, optionally pinned to one database (`dbName | WORKFLOWID`).
- **Decimal hour** — time-of-day as a number: `09:30 = 9.5`.
- **Phase** — half of a month: P1 = days 1–14, P2 = days 15–end.
- **Snapshot** — the persisted half-month aggregate (one phase behind the latest completed phase) that powers trends.

---

## API reference

### Alerts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/missing-alerts` | List alerts (query `status`) + summary + `reAlertMinutes` |
| GET | `/api/missing-alerts/:id` | Single alert detail |
| GET | `/api/missing-alerts/:id/draft` | Email draft (rendered from the Admin template) |
| POST | `/api/missing-alerts/:id/send` | Send the alert email via SMTP; sets status `review` |
| PUT | `/api/missing-alerts/:id/status` | Update status (`review` / `resolved` / `ignored` / `new`) |
| POST | `/api/missing-alerts/:id/expire-review` | Test helper: fast-forward the re-alert window |

### Trends & Analysis
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trends/:workflow_id` | Arrival-time + size trends (query `days`; `ALL` = all workflows) |
| GET | `/api/workflow-analysis` | Per-workflow analysis array |
| GET | `/api/summary` | Activity summary |
| GET | `/api/trend-window` | Current snapshot window `{ label, from, to, key }` |

### System / Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workflows` | Distinct workflow IDs |
| GET | `/api/files/workflows` | Workflow list with record counts |
| GET | `/api/status` | Data source label, connections, record count, workflows, uptime |
| GET | `/api/assistant/config` | Quick assistant embed config |
| GET | `/api/file-details/databases` | Connection names for File Details (**admin session required**) |
| GET | `/api/file-details?db=&docid=&workflowid=` | Live document lookup in one DB (**admin session required**) |
| GET | `/api/admin/settings` · PUT | Read / update settings (auth) |
| GET | `/api/admin/connections` | List DB connections (auth) |
| POST | `/api/admin/test-db` | Test one/all connections with `SELECT 1` (auth) |
| POST | `/api/admin/reload-data` | Re-pull alerts data (auth) |
| POST | `/api/admin/refresh-trend-snapshot` | Force-rebuild the half-month trend snapshot (auth) |
| GET | `/api/admin/trend-snapshot-info` | Snapshot window + freshness (auth) |
| POST | `/api/admin/test-smtp` | Verify SMTP, or send a test email (auth) |

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Admin login (8-hour session). 5 failed attempts per IP → 15-minute lock (HTTP 429) |
| POST | `/auth/logout` | End the session |
| GET | `/auth/me` | Session check |

---

## Environment variables

See `.env.example` for the full list. Key ones:

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3000) |
| `NODE_ENV` | `development` locally; **`production`** on the server (enables the hardening in [Security](#security)) |
| `TREND_SOURCE` | `csv` (default) or `db` — currently `db` |
| `TREND_DB_TABLE` | Connection-relative table (default `dbo.DOCUMENT`) |
| `TREND_CSV_DIR` | CSV folder for CSV mode (default `data/Trenddata`; the smoke test uses `data/Trenddata/sample`) |
| `TREND_DB_TIMEOUT_MS` | Per-query timeout (current 30000) |
| `TREND_DB_AGG_TIMEOUT_MS` | Snapshot GROUP BY timeout (code default 120000; **current 300000** = 5 min) |
| `TREND_DBx_NAME` / `TREND_DBx_CLIENT` | Connection label and engine `mssql` (default) / `mysql` (`x` = 1..20) |
| `TREND_DBx_HOST/PORT/DATABASE/USER/PASSWORD` | Per-connection settings |
| `TREND_DBx_ENCRYPT` / `TREND_DBx_TRUST_CERT` | TLS options |
| `TREND_DBx_ENABLED` | `false` switches a connection off without deleting it (default `true`) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` / `ADMIN_PASSWORD` | Admin login (use the bcrypt hash; plaintext is a demo fallback) |
| `SESSION_SECRET` | Cookie signing secret — **required** when `NODE_ENV=production` (the app exits without it) |
| `ALLOWED_ORIGIN` | Extra CORS / Socket.io origins in production, comma-separated (blank = same-origin only) |
| `ALERT_REVIEW_MINUTES` | Fallback re-alert window if not set in Admin (default 30) |
| `QUICK_EMBED_URL` | Amazon Quick assistant embed URL (blank = disabled) |
| `KIRO_CMD` | Optional Kiro CLI command for `npm run kiro:analyze` (blank = no-op) |

> Wrap passwords containing `#` or spaces in double quotes in `.env`.
>
> A variable already set in the shell **overrides** `.env` (dotenv does not overwrite). If the badge unexpectedly shows "eHub CSV", look for a stray `TREND_SOURCE` (PowerShell: `Remove-Item Env:TREND_SOURCE`).

---

## Project structure

```
config/
  trendSource.js          data-source config + DB connection list (from .env)
  settings.json           runtime admin settings (git-ignored)
data/
  Trenddata/              CSV data (real exports git-ignored)
    sample/               fictional sample_orders_*.csv (tracked; used by the smoke test)
  alertStates.json        persisted alert statuses (git-ignored, runtime)
  trendSnapshot.json      half-month trend aggregate cache (git-ignored, runtime)
routes/
  api.js                  public API (alerts + email send, trends, analysis, status, assistant, file details)
  admin.js                admin config API (auth-gated)
  auth.js                 login/logout/session
middleware/
  requireAuth.js          session gate for /admin
services/
  trendDataService.js         loads/caches records + aggregates; trend & analysis logic; snapshot lifecycle
  trendSnapshotStore.js       half-month snapshot window + persistence
  trendProviderFactory.js     picks MSSQL vs MySQL provider per connection
  trendMssqlProvider.js       MSSQL fetch (mssql driver)
  trendMysqlProvider.js       MySQL fetch (mysql2 driver)
  trendRowMapper.js           shared row→record normalization + date resolution
  settingsService.js          config + SQL query builders (raw + aggregate)
  missingFileAlertService.js  missing-file detection + alert profiles
  alertStateStore.js          persists alert status + re-alert timing
  emailService.js             SMTP send + verify (nodemailer)
  fileDetailsService.js       live document lookup (File Details)
  authService.js              admin credential check
scripts/
  smoke-test.js               boots the server in CSV mode and checks key endpoints (CI)
  pentaho-process-logs.js     turn raw PDI logs into the ETL-errors JSON
  hash-password.js            generate an admin bcrypt hash
  kiro-analyze-errors.js      optional Kiro CLI seam for ETL error analysis (KIRO_CMD)
deploy/
  deploy.sh                   production deploy: pull, install, PM2 reload, health check, auto-rollback
  nginx-dm-dashboard.conf     nginx HTTPS reverse proxy + security headers + login rate limit
.github/workflows/
  ci.yml                      lint + smoke on push/PR
  deploy.yml                  runs deploy/deploy.sh on a self-hosted runner after CI
public/
  index.html              the dashboard (Alerts · Trends · ETL Errors; File Details hidden) + loader + assistant
  js/                     app.js, trends.js, insights.js, alerts.js, charts.js, filedetails.js,
                          searchableSelect.js, socket.js, assistant.js, pentaho-*.js
  css/                    style.css, assistant.css, pentaho-error.css
  data/                   pentaho-ai-issues.json (ETL errors data)
views/
  login.html, admin.html
server.js                 app entry point (production hardening lives here)
ecosystem.config.js       PM2 process definition (single instance)
```

---

## Common maintenance tasks

**Change which buyers are monitored** → Admin → Priority Buyers (or edit `config/settings.json` → `priorityBuyers`).

**Change which document types are pulled** → Admin → Document Types (`documentTypes`; empty = all).

**Change the missing-file re-alert delay** → Admin → re-alert window (`reAlertMinutes`) or `.env` `ALERT_REVIEW_MINUTES`.

**Monitor one specific workflow** → Admin → Monitored Workflows, add the exact WORKFLOWID (optionally `dbName | WORKFLOWID`), then **Rebuild snapshot now**.

**Change the alerts window** → Admin → Alerts data → `alertDays` (minimum 2, default 3).

**Add / disable / remove a database connection** → `.env` on the server, restart, test, rebuild snapshot. Full steps: [Managing database connections](#managing-database-connections).

**Trends look stale / missing a workflow** → Admin → Trend & Analysis → **Rebuild snapshot now**. (The phase rolls over on the 1st and 15th; it is picked up on the next restart / reload.)

**Trends tab empty right after a restart** → the first load takes ~2 minutes (4 databases); wait for the loader. If still empty, restart, then rebuild the snapshot.

**Trends/alerts numbers disagree** → they shouldn't (both use the aggregates). If they do, rebuild the snapshot and reload alerts data.

**Alert fires too early/late in the day** → tune the time-of-day gate in `missingFileAlertService.js` (the `avgFirstArrival + 1` grace).

**Configure alert email sending** → Admin → SMTP Server: fill in, enable, save, **Test connection**, then send one test email.

**Speed up the snapshot build** → ask the DBA for an index on `RECEIVEDATE` (see [Managing database connections](#managing-database-connections)); the build only runs twice a month / on manual rebuild.

**Switch to a real ETL-errors API** → set `REMOTE_URL` in `public/js/pentaho-data-service.js`.

---

## Security

Hardening in `server.js` / `routes/` that switches on with **`NODE_ENV=production`**:

| Control | Behaviour |
|---|---|
| Session secret | The app **exits at startup** if `SESSION_SECRET` is empty (the dev fallback is never used in production). |
| Proxy + cookie | `trust proxy` enabled for nginx; session cookie `httpOnly`, `sameSite=lax`, `secure` over HTTPS; 8-hour lifetime. |
| CORS / Socket.io | Same-origin only; extra origins via `ALLOWED_ORIGIN`. Development keeps `*`. |

Always on:

- **Admin pages and `/api/admin/*`** require a session; the password is a bcrypt hash.
- **Login brute-force guard:** 5 failed attempts per IP → 15-minute lock (HTTP 429). `deploy/nginx-dm-dashboard.conf` adds 10 req/min on `/auth/login`.
- **File Details API** (`/api/file-details*`) requires the admin session (tab is hidden).
- **SMTP password** is never returned to the browser; leaving it blank in Admin keeps the stored value.
- **Database connections** are managed only in `.env` (see [Managing database connections](#managing-database-connections)); use **read-only** DB logins.
- File Details queries are parameterized.
- `.env` and `config/settings.json` hold secrets: git-ignored, `chmod 600` on the server.

Known limit: sessions use the in-memory store (a restart logs the admin out; PM2 shows a MemoryStore warning). Fine for a single admin.

---

## CI/CD

The project ships with **GitHub Actions** pipelines in `.github/workflows/`.

### CI — `ci.yml` (runs on every push & PR to `main`)

Three steps, on Node 20 & 22:

1. `npm ci` — clean install from the lockfile.
2. `npm run lint` — ESLint (flat config in `eslint.config.js`; lenient — real errors fail, style is warnings).
3. `npm run smoke` — boots the real server in **CSV mode** and asserts `/api/status`, `/`, and `/api/workflows` respond (`scripts/smoke-test.js`).

CI runs with `TREND_SOURCE=csv`, so it **never touches a production database**. There is no unit-test suite yet; `npm test` = lint + smoke. Add Jest specs over time and wire them into the `test` script.

### CD — `deploy.yml` (on-premise, self-hosted runner)

GitHub-hosted runners cannot reach an on-premise server, so deployment runs on a **self-hosted runner** installed on the production server. After CI passes on `main` (or manually from the Actions tab), the job runs `deploy/deploy.sh` in the app directory. It requires approval from the `production` environment and does nothing until the repository variable `DEPLOY_ENABLED` is `true`.

**One-time setup:**

1. On the server, as the app user `dmapp`: GitHub repo → Settings → Actions → Runners → **New self-hosted runner** (Linux). Run `./config.sh` with the label **`dm-prod`**, then `sudo ./svc.sh install dmapp && sudo ./svc.sh start`.
2. Settings → Secrets and variables → Actions → **Variables**: `DEPLOY_ENABLED=true`, optional `APP_DIR=/home/dmapp/app` (default).
3. Settings → Environments → `production`: add required reviewers.
4. The old `EC2_*` secrets are no longer used and can be deleted.

**`deploy/deploy.sh`** — pulls `origin/main`, backs up `config/settings.json` (keeps 10), `npm ci --omit=dev`, `pm2 reload`, waits up to 30 s for `/api/status`, and **rolls back** to the previous commit if the health check fails. It can also be run by hand: `cd ~/app && bash deploy/deploy.sh`.

**Secrets & safety:**
- The production `.env` lives **only on the server** — never in git, never in Actions logs.
- CI uses CSV mode; only the production server uses `TREND_SOURCE=db` against real databases.
- `.env`, `data/` and `config/settings.json` are git-ignored, so runtime state (snapshot, alert statuses, admin settings) survives deploys (`git reset --hard` doesn't touch ignored files).

> **Note:** the app caches data in-memory per process, so PM2 runs a **single instance** (`instances: 1`). Don't scale to multiple instances without moving the cache to a shared store.

---

## Production deployment (Linux, on-premise)

Summary of the recommended setup. The step-by-step runbook, checklists and go-live sign-off are in the **Technical Document** (sections 7 and 8).

```
Users ──HTTPS 443──► nginx (TLS, headers, WebSocket) ──► 127.0.0.1:3000 Node + PM2 (user dmapp, 1 instance)
                                                           ├─ MSSQL :5500 → 4 eHub databases (read-only logins)
                                                           └─ SMTP  :25   → internal mail relay
```

1. **Server:** Ubuntu/Debian, Node 20+, git, nginx, PM2; set the time zone (`timedatectl set-timezone Asia/Kuala_Lumpur`) — alert timing and the snapshot window use server local time.
2. **Network:** server → DB hosts on 5500 and SMTP on 25; users → server on 443 only (block 3000).
3. **Code:** `sudo useradd -m dmapp`; as `dmapp` clone the repo to `~/app` (deploy key), `npm ci --omit=dev`.
4. **Config:** create `.env` with `NODE_ENV=production`, `TREND_SOURCE=db`, the DB blocks, `ADMIN_PASSWORD_HASH` (`node scripts/hash-password.js "…"`) and `SESSION_SECRET` (`openssl rand -hex 32`). Copy `config/settings.json` (and optionally `data/trendSnapshot.json` to skip the first rebuild). `chmod 600 .env config/settings.json`.
5. **Run:** `pm2 start ecosystem.config.js && pm2 save && pm2 startup systemd -u dmapp --hp /home/dmapp`; add `pm2 install pm2-logrotate`.
6. **nginx:** install `deploy/nginx-dm-dashboard.conf` (edit `server_name` + certificate paths), `nginx -t`, reload.
7. **Verify:** badge **MSSQL (4 DBs) · Connected**; Admin → Test all connections; Alerts and Trends show data; reboot test.
8. **Email last:** enable SMTP in Admin, Test connection, send one test alert.
9. **Backups:** daily copy of `config/settings.json`, `data/alertStates.json`, `.env` (encrypted).

---

## Sample data

Ships with **fictional sample data** in `data/Trenddata/sample/sample_orders_*.csv`. All names are invented. Real eHub exports placed directly in `data/Trenddata/` are git-ignored; only the `sample/` folder is tracked.

To run CSV mode on the sample data, set `TREND_CSV_DIR=data/Trenddata/sample` (the smoke test does this automatically).
