import express from 'express';
import session from 'express-session';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { v4 as uuid } from 'uuid';
import mime from 'mime-types';
import { config } from './config.js';
import { getDb, saveDb, needsSetup } from './db.js';
import { requireLogin, requireAdmin, hashPassword, checkPassword, publicUser } from './auth.js';
import { resolveTargets, storeToNode, readFileWithFallback, deleteFromNode, allTargets, localDiskUsage } from './storage.js';
import { nodeStatus, startHealthLoop, checkAllNodes, desiredReplicasForDisplay } from './health.js';
import { nodeStat } from './nodeClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB; quota enforced separately
});

export function createMainApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'views'));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
    }),
  );
  app.use('/public', express.static(path.join(ROOT, 'public')));

  // theme + user locals
  app.use((req, res, next) => {
    const db = getDb();
    res.locals.settings = db.settings;
    res.locals.user = req.session?.user || null;
    res.locals.theme = {
      siteName: db.settings.siteName || 'Cascade',
      accent: db.settings.accent || '#e11d48',
      bg: db.settings.bg || '#0a0a0b',
      surface: db.settings.surface || '#131316',
      text: db.settings.text || '#f4f4f5',
    };
    next();
  });

  // First-run wizard gate
  app.use((req, res, next) => {
    if (needsSetup() && !['/setup', '/public'].includes(req.path) && !req.path.startsWith('/public/')) {
      if (req.path.startsWith('/api/')) return res.status(503).json({ error: 'setup required' });
      return res.redirect('/setup');
    }
    next();
  });

  // ---------- Setup wizard ----------
  app.get('/setup', (req, res) => {
    if (!needsSetup()) return res.redirect('/login');
    res.render('setup', { error: null });
  });

  app.post('/setup', async (req, res) => {
    if (!needsSetup()) return res.redirect('/login');
    const { siteName, username, password, accent } = req.body;
    if (!username || !password || password.length < 6) {
      return res.render('setup', { error: 'Pick a username and a password of at least 6 characters.' });
    }
    const db = getDb();
    const id = uuid();
    db.users.push({
      id,
      username: String(username).trim(),
      passwordHash: await hashPassword(password),
      role: 'admin',
      quotaBytes: 10 * 1024 * 1024 * 1024, // 10 GB default
      createdAt: new Date().toISOString(),
    });
    db.settings.siteName = siteName?.trim() || 'Cascade';
    if (accent) db.settings.accent = accent;
    db.settings.setupDone = true;
    saveDb();
    req.session.user = publicUser(db.users.find((u) => u.id === id));
    res.redirect('/');
  });

  // ---------- Auth ----------
  app.get('/login', (req, res) => {
    if (req.session?.user) return res.redirect('/');
    res.render('login', { error: null });
  });

  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const db = getDb();
    const u = db.users.find((x) => x.username.toLowerCase() === String(username || '').toLowerCase());
    if (!u || !(await checkPassword(password || '', u.passwordHash))) {
      return res.render('login', { error: 'Invalid username or password.' });
    }
    req.session.user = publicUser(u);
    res.redirect('/');
  });

  app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  // ---------- Dashboard ----------
  app.get('/', requireLogin, (req, res) => {
    const db = getDb();
    const mine = db.files.filter((f) => f.ownerId === req.session.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const used = mine.reduce((s, f) => s + (f.size || 0), 0);
    const me = db.users.find((u) => u.id === req.session.user.id);
    res.render('dashboard', { files: mine, used, quota: me?.quotaBytes || 0, query: req.query.q || '' });
  });

  // ---------- Upload ----------
  app.post('/api/upload', requireLogin, upload.array('files', 20), async (req, res) => {
    const db = getDb();
    const me = db.users.find((u) => u.id === req.session.user.id);
    if (!me) return res.status(401).json({ error: 'unknown user' });
    const targets = resolveTargets();
    if (!targets.length) return res.status(500).json({ error: 'no storage nodes configured' });

    const used = db.files.filter((f) => f.ownerId === me.id).reduce((s, f) => s + (f.size || 0), 0);
    const results = [];
    for (const f of req.files || []) {
      if (used + f.size > (me.quotaBytes || 0)) {
        results.push({ filename: f.originalname, error: 'quota exceeded' });
        continue;
      }
      const id = nanoid(12);
      const slug = nanoid(10);
      const stored = [];
      let firstErr = null;
      for (const t of targets) {
        try {
          await storeToNode(t, id, f.buffer, { filename: f.originalname, mime: f.mimetype });
          stored.push(t.id);
        } catch (e) {
          firstErr = e;
        }
      }
      if (!stored.length) {
        results.push({ filename: f.originalname, error: `all nodes failed (${firstErr?.message || 'unknown'})` });
        continue;
      }
      db.files.push({
        id,
        slug,
        filename: f.originalname,
        mime: f.mimetype || mime.lookup(f.originalname) || 'application/octet-stream',
        size: f.size,
        ownerId: me.id,
        ownerName: me.username,
        isPublic: false,
        createdAt: new Date().toISOString(),
        replicas: stored,
        primaryNode: stored[0],
      });
      results.push({ filename: f.originalname, id, slug, replicas: stored });
    }
    saveDb();
    res.json({ ok: true, files: results, targets: targets.map((t) => t.id) });
  });

  // ---------- File view / edit / share (owner or admin) ----------
  function canAccess(file, user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return file.ownerId === user.id;
  }

  app.get('/f/:id', requireLogin, (req, res) => {
    const db = getDb();
    const file = db.files.find((f) => f.id === req.params.id);
    if (!file || !canAccess(file, req.session.user)) return res.status(404).render('error', { message: 'File not found.', status: 404 });
    const editable = isEditable(file);
    res.render('view', { file, editable, content: null, loadError: null });
  });

  app.get('/f/:id/raw', requireLogin, async (req, res) => {
    const db = getDb();
    const file = db.files.find((f) => f.id === req.params.id);
    if (!file || !canAccess(file, req.session.user)) return res.status(404).send('not found');
    try {
      const { buffer, mime: m } = await readFileWithFallback(file);
      res.setHeader('Content-Type', file.mime || m || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
      res.send(buffer);
    } catch {
      res.status(502).send('no healthy replica available');
    }
  });

  // Load text for editor
  app.get('/api/files/:id/text', requireLogin, async (req, res) => {
    const db = getDb();
    const file = db.files.find((f) => f.id === req.params.id);
    if (!file || !canAccess(file, req.session.user)) return res.status(404).json({ error: 'not found' });
    if (!isEditable(file) || file.size > 2 * 1024 * 1024) return res.status(400).json({ error: 'not editable as text' });
    try {
      const { buffer } = await readFileWithFallback(file);
      res.json({ text: buffer.toString('utf8') });
    } catch {
      res.status(502).json({ error: 'no healthy replica' });
    }
  });

  // Save text edit → rewrite to every known replica
  app.put('/api/files/:id/text', requireLogin, async (req, res) => {
    const db = getDb();
    const file = db.files.find((f) => f.id === req.params.id);
    if (!file || !canAccess(file, req.session.user)) return res.status(404).json({ error: 'not found' });
    const text = String(req.body?.text ?? '');
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) return res.status(400).json({ error: 'too large to edit' });
    const buffer = Buffer.from(text, 'utf8');
    const targets = allTargets().filter((t) => (file.replicas || []).includes(t.id));
    const ok = [];
    for (const t of targets.length ? targets : resolveTargets()) {
      try {
        await storeToNode(t, file.id, buffer, { filename: file.filename, mime: file.mime });
        ok.push(t.id);
      } catch { /* keep going */ }
    }
    if (!ok.length) return res.status(502).json({ error: 'write failed on all replicas' });
    file.size = buffer.length;
    file.replicas = [...new Set([...(file.replicas || []), ...ok])];
    saveDb();
    res.json({ ok: true, size: file.size });
  });

  app.post('/api/files/:id/share', requireLogin, (req, res) => {
    const db = getDb();
    const file = db.files.find((f) => f.id === req.params.id);
    if (!file || !canAccess(file, req.session.user)) return res.status(404).json({ error: 'not found' });
    file.isPublic = !!req.body?.isPublic;
    if (!file.slug) file.slug = nanoid(10);
    saveDb();
    res.json({ ok: true, isPublic: file.isPublic, slug: file.slug });
  });

  app.post('/api/files/:id/rename', requireLogin, (req, res) => {
    const db = getDb();
    const file = db.files.find((f) => f.id === req.params.id);
    if (!file || !canAccess(file, req.session.user)) return res.status(404).json({ error: 'not found' });
    const name = String(req.body?.filename || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: 'name required' });
    file.filename = name;
    const mt = mime.lookup(name);
    if (mt) file.mime = mt;
    saveDb();
    res.json({ ok: true, file });
  });

  app.delete('/api/files/:id', requireLogin, async (req, res) => {
    const db = getDb();
    const idx = db.files.findIndex((f) => f.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    const file = db.files[idx];
    if (!canAccess(file, req.session.user)) return res.status(404).json({ error: 'not found' });
    const targets = allTargets().filter((t) => (file.replicas || []).includes(t.id));
    for (const t of targets) {
      try {
        await deleteFromNode(t, file.id);
      } catch { /* best effort */ }
    }
    db.files.splice(idx, 1);
    saveDb();
    res.json({ ok: true });
  });

  // ---------- Public CDN / share links (no login) ----------
  app.get('/c/:slug', async (req, res) => {
    const db = getDb();
    const file = db.files.find((f) => f.slug === req.params.slug && f.isPublic);
    if (!file) return res.status(404).render('error', { message: 'This link is invalid or private.', status: 404 });
    res.render('share', { file });
  });

  app.get('/raw/:slug', async (req, res) => {
    const db = getDb();
    const file = db.files.find((f) => f.slug === req.params.slug && f.isPublic);
    if (!file) return res.status(404).send('not found');
    try {
      const { buffer, mime: m } = await readFileWithFallback(file);
      res.setHeader('Content-Type', file.mime || m || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
      res.send(buffer);
    } catch {
      res.status(502).send('no healthy replica');
    }
  });

  // ---------- Admin ----------
  app.get('/admin', requireAdmin, async (req, res) => {
    await checkAllNodes().catch(() => {});
    const db = getDb();
    const stats = {
      users: db.users.length,
      files: db.files.length,
      bytes: db.files.reduce((s, f) => s + (f.size || 0), 0),
      nodes: db.nodes.length + 1,
      desired: desiredReplicasForDisplay(),
    };
    const local = localDiskUsage();
    const remoteStats = [];
    for (const n of db.nodes) {
      const st = nodeStatus.get(n.id);
      let usage = null;
      if (st?.online) {
        try {
          usage = await nodeStat(n);
        } catch { /* ignore */ }
      }
      remoteStats.push({ node: n, status: st || { online: false }, usage });
    }
    res.render('admin/overview', {
      stats,
      local,
      remoteStats,
      nodeStatus: Object.fromEntries(nodeStatus),
      replication: db.settings.replication,
    });
  });

  app.get('/admin/users', requireAdmin, (req, res) => {
    const db = getDb();
    const users = db.users.map((u) => ({
      ...publicUser(u),
      used: db.files.filter((f) => f.ownerId === u.id).reduce((s, f) => s + (f.size || 0), 0),
      fileCount: db.files.filter((f) => f.ownerId === u.id).length,
    }));
    res.render('admin/users', { users });
  });

  app.post('/admin/users', requireAdmin, async (req, res) => {
    const db = getDb();
    const { username, password, role, quotaGB } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).send('username + password (6+ chars) required');
    }
    if (db.users.some((u) => u.username.toLowerCase() === String(username).toLowerCase())) {
      return res.status(400).send('username taken');
    }
    db.users.push({
      id: uuid(),
      username: String(username).trim(),
      passwordHash: await hashPassword(password),
      role: role === 'admin' ? 'admin' : 'user',
      quotaBytes: Math.max(1, Number(quotaGB) || 5) * 1024 * 1024 * 1024,
      createdAt: new Date().toISOString(),
    });
    saveDb();
    res.redirect('/admin/users');
  });

  app.post('/admin/users/:id/quota', requireAdmin, (req, res) => {
    const db = getDb();
    const u = db.users.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).send('not found');
    u.quotaBytes = Math.max(1, Number(req.body.quotaGB) || 1) * 1024 * 1024 * 1024;
    if (req.body.role === 'admin' || req.body.role === 'user') u.role = req.body.role;
    saveDb();
    res.redirect('/admin/users');
  });

  app.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
    const db = getDb();
    if (req.session.user.id === req.params.id) return res.status(400).send('cannot delete yourself');
    db.users = db.users.filter((u) => u.id !== req.params.id);
    saveDb();
    res.redirect('/admin/users');
  });

  app.get('/admin/files', requireAdmin, (req, res) => {
    const db = getDb();
    const files = [...db.files].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.render('admin/files', { files, users: db.users });
  });

  app.get('/admin/nodes', requireAdmin, async (req, res) => {
    await checkAllNodes().catch(() => {});
    const db = getDb();
    res.render('admin/nodes', {
      nodes: db.nodes,
      replication: db.settings.replication,
      nodeStatus: Object.fromEntries(nodeStatus),
    });
  });

  app.post('/admin/nodes', requireAdmin, (req, res) => {
    const db = getDb();
    const { name, url, accessKey } = req.body;
    if (!name || !url) return res.status(400).send('name + url required');
    db.nodes.push({
      id: nanoid(10),
      name: String(name).trim(),
      url: String(url).trim().replace(/\/+$/, ''),
      accessKey: String(accessKey || '').trim(),
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    saveDb();
    res.redirect('/admin/nodes');
  });

  app.post('/admin/nodes/:id/toggle', requireAdmin, (req, res) => {
    const db = getDb();
    const n = db.nodes.find((x) => x.id === req.params.id);
    if (n) {
      n.enabled = !(n.enabled !== false);
      saveDb();
    }
    res.redirect('/admin/nodes');
  });

  app.post('/admin/nodes/:id/delete', requireAdmin, (req, res) => {
    const db = getDb();
    db.nodes = db.nodes.filter((x) => x.id !== req.params.id);
    saveDb();
    res.redirect('/admin/nodes');
  });

  app.post('/admin/replication', requireAdmin, (req, res) => {
    const db = getDb();
    const { mode, selectedNodeIds, defaultNodeId, replicaCount } = req.body;
    const sel = Array.isArray(selectedNodeIds) ? selectedNodeIds : selectedNodeIds ? [selectedNodeIds] : [];
    db.settings.replication = {
      mode: ['all', 'select', 'single', 'default', 'n'].includes(mode) ? mode : 'n',
      selectedNodeIds: sel,
      defaultNodeId: defaultNodeId || 'local',
      replicaCount: Math.max(1, Math.min(20, parseInt(replicaCount, 10) || 1)),
    };
    saveDb();
    res.redirect('/admin/nodes');
  });

  app.get('/admin/appearance', requireAdmin, (req, res) => {
    res.render('admin/appearance', { s: getDb().settings });
  });

  app.post('/admin/appearance', requireAdmin, (req, res) => {
    const db = getDb();
    const { siteName, accent, bg, surface, text } = req.body;
    if (siteName?.trim()) db.settings.siteName = siteName.trim().slice(0, 60);
    for (const [k, v] of Object.entries({ accent, bg, surface, text })) {
      if (/^#[0-9a-fA-F]{6}$/.test(v || '')) db.settings[k] = v;
    }
    saveDb();
    res.redirect('/admin/appearance');
  });

  app.get('/api/health', async (req, res) => {
    const db = getDb();
    res.json({
      mode: 'main',
      setupDone: db.settings.setupDone,
      nodes: allTargets().map((n) => ({ id: n.id, name: n.name, status: nodeStatus.get(n.id) || null })),
    });
  });

  // 404
  app.use((req, res) => res.status(404).render('error', { message: 'Page not found.', status: 404 }));

  startHealthLoop();
  return app;
}

function isEditable(file) {
  if ((file.size || 0) > 2 * 1024 * 1024) return false;
  const m = file.mime || '';
  if (m.startsWith('text/') || m.includes('json') || m.includes('javascript') || m.includes('xml')) return true;
  return /\.(txt|md|markdown|json|js|ts|css|html|yml|yaml|toml|env|log|csv)$/i.test(file.filename || '');
}

export function startMain() {
  const app = createMainApp();
  app.listen(config.port, config.host, () => {
    console.log(`[cascade] main server on http://${config.host}:${config.port}`);
  });
}
