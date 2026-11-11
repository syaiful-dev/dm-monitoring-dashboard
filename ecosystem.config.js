// PM2 process configuration for production (EC2).
// PM2 keeps the Node server running, restarts it on crash, and starts it on boot.
//
// On the server:
//   pm2 start ecosystem.config.js      # first time
//   pm2 reload dm-dashboard            # zero-downtime reload (used by CD)
//   pm2 save && pm2 startup            # persist across reboots
//
// Environment (DB creds, SESSION_SECRET, QUICK_EMBED_URL, TREND_SOURCE=db, …)
// comes from the server's own .env file — NOT from this file and NOT from git.

module.exports = {
  apps: [
    {
      name: 'dm-dashboard',
      script: 'server.js',
      instances: 1,            // single instance (the app caches in-memory per process)
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
