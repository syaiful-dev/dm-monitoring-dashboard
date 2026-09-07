# DM Monitoring Dashboard

A full-stack data pipeline monitoring dashboard with AI-powered anomaly detection and a built-in chatbot.

## Architecture

```
[Source Databases] → [Pentaho ETL Jobs] → [AWS S3] → [Redshift (future)] → [This App] → [DM Dashboard]
                                                                                  ↓
                                                                      [AI Anomaly Detection Engine]
                                                                      [Built-in Chatbot for queries]
```

## Data Provider Pattern

The app uses a **Provider Pattern** for data abstraction:

| Mode | Description | Config |
|------|-------------|--------|
| **JSON** (default) | Reads from `/data/*.json` files | `DATA_PROVIDER=json` |
| **Redshift** (future) | Connects to Amazon Redshift | `DATA_PROVIDER=redshift` |

Switching providers requires **only** changing the `.env` file — no code changes needed.

## Prerequisites

- Node.js 18+
- npm

## Quick Start

```bash
npm install
npm run dev
```

The dashboard will be available at `http://localhost:3000`.

To stop the server, press `Ctrl + C` in the terminal running it (or on Windows: `taskkill /f /im node.exe`).

## Sample Data

This repository ships with **fictional sample data** so the dashboard runs out of the box on any machine.

- Sample CSVs live in `data/Trenddata/` and are named `sample_orders_01.csv` … `sample_orders_06.csv`.
- The data source (`services/trendDataService.js`) automatically reads **every** `*.csv` file in `data/Trenddata/`, so a fresh clone loads only the sample files with no configuration.
- All company/partner names, file names, and metadata are **invented** and do not represent any real trading partner. Numbers are generated with a seeded pseudo-random generator for reproducibility.

The sample data covers 6 fictional workflows:

| Workflow | Retailer | Supplier |
|----------|----------|----------|
| ORDERS_ACME_RETAIL_ZENITH_SUPPLY_ACME_RETAIL | Acme Retail | Zenith Supply |
| ORDERS_NOVA_MART_APEX_GOODS_NOVA_MART | Nova Mart | Apex Goods |
| ORDERS_ORBIT_STORES_VERTEX_DIST_ORBIT_STORES | Orbit Stores | Vertex Dist |
| ORDERS_PDF_PIXEL_SHOP_QUANTUM_CO_PIXEL_SHOP | Pixel Shop | Quantum Co |
| ORDERS_LUMEN_GROCERS_STELLAR_FOODS_LUMEN_GROCERS | Lumen Grocers | Stellar Foods |
| ORDERS_HELIX_TRADE_COMET_BRANDS_HELIX_TRADE | Helix Trade | Comet Brands |

**Status codes:** `50` = Completed/Archived, `45` = In Progress, `999` = Error.

To use your own data, drop additional CSV files (matching the column headers of the samples — `WORKFLOWID`, `DOCFILENAME`, `DOCSIZE`, `CREATIONDATE`, `STATUS`) into `data/Trenddata/` and restart the app.

## How to Switch to Redshift

1. **Set up Redshift cluster** on AWS
2. **Create schema and tables:**

```sql
CREATE SCHEMA dm_monitoring;

CREATE TABLE dm_monitoring.workflows (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name VARCHAR(255),
  description VARCHAR(500),
  source_db VARCHAR(100),
  pentaho_job VARCHAR(255),
  s3_path VARCHAR(500),
  schedule_type VARCHAR(20),
  expected_time VARCHAR(5),
  expected_day VARCHAR(10),
  alert_threshold_minutes INT,
  expected_size_min_kb FLOAT,
  expected_size_max_kb FLOAT,
  monitoring_enabled BOOLEAN DEFAULT TRUE
);

CREATE TABLE dm_monitoring.file_records (
  id INT IDENTITY(1,1) PRIMARY KEY,
  workflow_id INT REFERENCES dm_monitoring.workflows(id),
  file_name VARCHAR(500),
  s3_key VARCHAR(1000),
  file_size_kb FLOAT,
  expected_at TIMESTAMP,
  received_at TIMESTAMP,
  delay_minutes FLOAT,
  status VARCHAR(20),
  is_anomaly BOOLEAN DEFAULT FALSE,
  anomaly_type VARCHAR(50),
  anomaly_score FLOAT,
  created_at TIMESTAMP DEFAULT GETDATE()
);

CREATE TABLE dm_monitoring.alerts (
  id INT IDENTITY(1,1) PRIMARY KEY,
  workflow_id INT REFERENCES dm_monitoring.workflows(id),
  file_record_id INT REFERENCES dm_monitoring.file_records(id),
  severity VARCHAR(20),
  type VARCHAR(50),
  title VARCHAR(255),
  message VARCHAR(1000),
  source VARCHAR(255),
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT GETDATE()
);

CREATE TABLE dm_monitoring.daily_stats (
  id INT IDENTITY(1,1) PRIMARY KEY,
  workflow_id INT REFERENCES dm_monitoring.workflows(id),
  stat_date DATE,
  expected_count INT,
  received_count INT,
  on_time_count INT,
  late_count INT,
  missing_count INT,
  avg_delay_minutes FLOAT,
  avg_file_size_kb FLOAT,
  reliability_score FLOAT
);
```

3. **Update `.env`** with Redshift credentials:
```
REDSHIFT_HOST=your-cluster.region.redshift.amazonaws.com
REDSHIFT_PORT=5439
REDSHIFT_DATABASE=your_database
REDSHIFT_USER=your_user
REDSHIFT_PASSWORD=your_password
REDSHIFT_SCHEMA=dm_monitoring
```

4. **Change provider:** Set `DATA_PROVIDER=redshift` in `.env`
5. **Restart the app**

## API Documentation

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/overview` | KPI data + today's status |
| GET | `/api/workflows` | All workflow definitions |
| GET | `/api/files` | File records (query: workflow_id, status, date_from, date_to, page, limit) |
| GET | `/api/alerts` | Alerts (query: severity, acknowledged, date_from, date_to) |
| PUT | `/api/alerts/:id/acknowledge` | Mark alert as seen |

### Insights
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trends/:workflow_id` | Trend data (query: days=14) |
| GET | `/api/anomalies` | Detected anomalies |
| GET | `/api/reliability` | Reliability scores |
| GET | `/api/summary` | AI weekly summary |
| GET | `/api/predictions` | AI predictions |

### Chatbot
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Send message, receive response |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Current data provider, connection status, uptime |

## Chatbot Usage

The built-in "DM Assistant" chatbot supports natural language queries:

- **Status:** "What's the status today?", "Which workflows are delayed?"
- **Alerts:** "Show active alerts", "How many critical alerts?"
- **Trends:** "How is Daily_HR_Feed trending?", "Any anomalies this week?"
- **Insights:** "Give me a summary", "Any predictions?"
- **Help:** "help" or "what can you do?"

## Features

- 5-tab dashboard (Overview, Trends, Files, Alerts, AI Insights)
- Real-time simulation via WebSocket (JSON mode)
- AI anomaly detection (z-score, trend drift, missing files)
- Built-in chatbot with data-aware responses
- Dark professional theme
- Provider pattern for seamless data source switching

## Future Enhancements

- Redshift integration (provider already stubbed)
- Email/Slack alert notifications
- Custom anomaly threshold configuration
- Historical report generation
- User authentication and role-based access
- Multi-tenant support
