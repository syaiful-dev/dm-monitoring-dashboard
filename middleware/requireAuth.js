// Route guard — allows the request only if an admin session exists.
// For page routes, redirects to /login. For API routes, returns 401 JSON.
function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();

  // Use originalUrl since this middleware may be mounted under /api/admin
  if ((req.originalUrl || '').startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login');
}

module.exports = requireAuth;
