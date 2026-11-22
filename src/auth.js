import bcrypt from 'bcryptjs';

// `req.user` is set by the auth middleware for both session logins and API keys.
function currentUser(req) {
  return req.user || req.session?.user || null;
}

function isApiRequest(req) {
  const path = req.path || '';
  return path.startsWith('/api/') || path === '/mcp' || String(req.originalUrl || '').startsWith('/api/');
}

export function requireLogin(req, res, next) {
  if (!currentUser(req)) {
    if (isApiRequest(req)) return res.status(401).json({ error: 'login required' });
    // Direct export/media URLs are often called by scripts and must fail closed
    // with an auth status rather than a redirect that could be cached as content.
    if (/^\/(download|export)\/[^/]+$/.test(req.path) || /^\/f\/[^/]+\/raw$/.test(req.path)) {
      return res.status(401).send('login required');
    }
    return res.redirect('/login');
  }
  next();
}

export function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    if (isApiRequest(req) || req.path.startsWith('/admin/api-keys')) return res.status(401).json({ error: 'login required' });
    return res.redirect('/login');
  }
  if (user.role !== 'admin') {
    if (isApiRequest(req)) return res.status(403).json({ error: 'admin only' });
    return res.status(403).render('error', { message: 'Admin only.', status: 403 });
  }
  next();
}

export async function hashPassword(pw) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(pw, salt);
}

export function checkPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, role: u.role, quotaBytes: Number(u.quotaBytes) || 0, createdAt: u.createdAt };
}
