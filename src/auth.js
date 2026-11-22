import bcrypt from 'bcryptjs';

// `req.user` is set by the auth middleware for both session logins and API keys.
function currentUser(req) {
  return req.user || req.session?.user || null;
}

export function requireLogin(req, res, next) {
  if (!currentUser(req)) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'login required' });
    return res.redirect('/login');
  }
  next();
}

export function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'login required' });
    return res.redirect('/login');
  }
  if (user.role !== 'admin') {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'admin only' });
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
