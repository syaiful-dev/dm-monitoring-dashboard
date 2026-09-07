// DM Monitoring Dashboard — Main Server
// Node.js + Express + Socket.io — powered by real eHub CSV data

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const apiRoutes = require('./routes/api');
const chatRoutes = require('./routes/chat');
const trendDataService = require('./services/trendDataService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api', apiRoutes);
app.use('/api/chat', chatRoutes);

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
server.listen(PORT, () => {
  const records = trendDataService.loadAllRecords();
  const workflows = trendDataService.getDistinctWorkflows();

  console.log(`\n🚀 DM Monitoring Dashboard`);
  console.log(`   Server running on http://localhost:${PORT}`);
  console.log(`   Data Source: eHub CSV (${records.length.toLocaleString()} records)`);
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
