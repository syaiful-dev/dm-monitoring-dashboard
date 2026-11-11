// DM Monitoring Dashboard — Main Server
// Node.js + Express + Socket.io — data source configurable via TREND_SOURCE (MSSQL DB or CSV)

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const session = require('express-session');

const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const requireAuth = require('./middleware/requireAuth');
const trendDataService = require('./services/trendDataService');

const isProd = process.env.NODE_ENV === 'production';

// Production must have its own session secret (never the built-in dev fallback).
if (isProd && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set when NODE_ENV=production.');
  process.exit(1);
}

// CORS / Socket.io origin. The UI is served by this same server, so cross-origin
// access is not needed. Dev keeps "*"; production allows only ALLOWED_ORIGIN
// (comma-separated) and is same-origin only when it is unset.
const allowedOrigin = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : (isProd ? false : '*');

const app = express();
// Behind nginx (HTTPS terminates there): trust X-Forwarded-* so secure cookies work.
if (isProd) app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigin }
});

// Middleware
app.use(cors({ origin: allowedOrigin }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Session (for Admin login)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dm-dashboard-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd ? 'auto' : false, // 'auto' = secure when the request came in over HTTPS
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// Static files — disable caching so the browser always gets the latest JS/CSS/HTML
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Auth + Admin pages (served from /views, gated so they aren't public static files)
app.use('/auth', authRoutes);

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// Admin config API (all endpoints require an admin session)
app.use('/api/admin', requireAuth, adminRoutes);

// API Routes
app.use('/api', apiRoutes);

// SPA fallback — serve index.html for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`[WebSocket] Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[WebSocket] Client disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
const trendSource = require('./config/trendSource');

server.listen(PORT, async () => {
  // Initialize data from the configured source (csv or db) before reporting ready
  await trendDataService.initData();
  const records = trendDataService.loadAllRecords();
  const workflows = trendDataService.getDistinctWorkflows();

  console.log(`\n🚀 DM Monitoring Dashboard`);
  console.log(`   Server running on http://localhost:${PORT}`);
  console.log(`   Data Source: ${trendSource.source.toUpperCase()} (${records.length.toLocaleString()} records)`);
  console.log(`   Workflows: ${workflows.length}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down...');
  server.close(() => process.exit(0));
});

module.exports = { app, server, io };
