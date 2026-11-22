import bcrypt from 'bcryptjs';

export function requireLogin(req, res, next) {
  if (!req.session?.user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'login required' });
    return res.redirect('/login');
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session?.user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'login required' });
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'admin') {
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
  return { id: u.id, username: u.username, role: u.role, quotaBytes: u.quotaBytes, createdAt: u.createdAt };
}
