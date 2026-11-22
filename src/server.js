import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { v4 as uuid } from 'uuid';
import mime from 'mime-types';
import { config } from './config.js';
import { sequelize, User, FileRecord, NodeRecord, getSettings, saveSettings, needsSetup } from './db.js';
import { requireLogin, requireAdmin, hashPassword, checkPassword, publicUser } from './auth.js';
import { resolveTargets, storeToNode, readFileWithFallback, deleteFromNode, allTargets, localDiskUsage } from './storage.js';
import { nodeStatus, startHealthLoop, checkAllNodes, desiredReplicasForDisplay } from './health.js';
import { nodeStat } from './nodeClient.js';
import { recordEvent, analyticsSummary } from './analytics.js';
import { extractApiToken, authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from './apiKeys.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB; quota enforced separately
});

// Async route helper — Express 4 does not catch rejected promises.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function prettyBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function prettyDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function prettyDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function safeFile(f) {
  return {
    id: f.id,
    slug: f.slug,
    filename: f.filename,
    mime: f.mime,
    size: Number(f.size) || 0,
    ownerId: f.ownerId,
    ownerName: f.ownerName,
    isPublic: !!f.isPublic,
    replicas: f.replicas || [],
    primaryNode: f.primaryNode,
    createdAt: f.createdAt,
  };
}

export function createMainApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'views'));
  app.set('trust proxy', true);

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
    }),
  );
  app.use('/public', express.static(path.join(ROOT, 'public')));

  // Theme, settings and auth context (session cookie or API key).
  app.use(
    wrap(async (req, res, next) => {
      const settings = await getSettings();
      req.settings = settings;
      req.user = req.session?.user || null;

      const token = extractApiToken(req);
      if (token) {
        const auth = await authenticateApiKey(token);
        if (!auth) {
          if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'invalid or revoked API key' });
          return res.status(401).render('error', { message: 'Invalid or revoked API key.', status: 401 });
        }
        req.user = auth.user;
        req.apiKey = auth.record;
      }

      res.locals.settings = settings;
      res.locals.user = req.user;
      res.locals.path = req.path;
      res.locals.mode = config.mode;
      res.locals.prettyBytes = prettyBytes;
      res.locals.prettyDate = prettyDate;
      res.locals.prettyDateTime = prettyDateTime;
      res.locals.theme = {
        siteName: settings.siteName || 'Cascade',
        accent: settings.accent || '#e11d48',
        bg: settings.bg || '#08080a',
        surface: settings.surface || '#101013',
        text: settings.text || '#f3f3f4',
      };
      next();
    }),
  );

  // First-run wizard gate
  app.use(
    wrap(async (req, res, next) => {
      if (!(await needsSetup())) return next();
      if (['/setup', '/docs'].includes(req.path) || req.path.startsWith('/public/')) return next();
      if (req.path.startsWith('/api/')) return res.status(503).json({ error: 'setup required' });
      return res.redirect('/setup');
    }),
  );

  // ---------- Setup wizard ----------
  app.get('/setup', wrap(async (req, res) => {
    if (!(await needsSetup())) return res.redirect('/login');
    res.render('setup', { error: null });
  }));

  app.post('/setup', wrap(async (req, res) => {
    if (!(await needsSetup())) return res.redirect('/login');
    const { siteName, username, password, accent } = req.body;
    if (!username || !password || password.length < 6) {
      return res.render('setup', { error: 'Pick a username and a password of at least 6 characters.' });
    }
    const user = await User.create({
      id: uuid(),
      username: String(username).trim(),
      passwordHash: await hashPassword(password),
      role: 'admin',
      quotaBytes: 10 * 1024 * 1024 * 1024, // 10 GB default
    });
    const patch = { setupDone: true };
    if (siteName?.trim()) patch.siteName = siteName.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(accent || '')) patch.accent = accent;
    await saveSettings(patch);
    req.session.user = publicUser(user);
    res.redirect('/');
  }));

  // ---------- Auth ----------
  app.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('login', { error: null });
  });

  app.post('/login', wrap(async (req, res) => {
    const { username, password } = req.body;
    const wanted = String(username || '').toLowerCase();
    const u = await User.findOne({
      where: sequelize.where(sequelize.fn('lower', sequelize.col('username')), wanted),
    });
    if (!u || !(await checkPassword(password || '', u.passwordHash))) {
      return res.render('login', { error: 'Invalid username or password.' });
    }
    req.session.user = publicUser(u);
    res.redirect('/');
  }));

  app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  // ---------- Dashboard ----------
  app.get('/', requireLogin, wrap(async (req, res) => {
    const files = await FileRecord.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'DESC']] });
    const used = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
    const me = await User.findByPk(req.user.id);
    res.render('dashboard', { files, used, quota: Number(me?.quotaBytes) || 0, query: req.query.q || '' });
  }));

  // ---------- Upload ----------
  app.post('/api/upload', requireLogin, upload.array('files', 20), wrap(async (req, res) => {
    const me = await User.findByPk(req.user.id);
    if (!me) return res.status(401).json({ error: 'unknown user' });
    const targets = await resolveTargets();
    if (!targets.length) return res.status(500).json({ error: 'no storage nodes configured' });

    const existing = await FileRecord.findAll({ where: { ownerId: me.id } });
    let used = existing.reduce((s, f) => s + (Number(f.size) || 0), 0);

    const results = [];
    let uploadedBytes = 0;
    for (const f of req.files || []) {
      if (used + f.size > (Number(me.quotaBytes) || 0)) {
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
      await FileRecord.create({
        id,
        slug,
        filename: f.originalname,
        mime: f.mimetype || mime.lookup(f.originalname) || 'application/octet-stream',
        size: f.size,
        ownerId: me.id,
        ownerName: me.username,
        isPublic: false,
        replicas: stored,
        primaryNode: stored[0],
      });
      used += f.size;
      uploadedBytes += f.size;
      results.push({ filename: f.originalname, id, slug, replicas: stored });
    }
    if (uploadedBytes) recordEvent(req, 'upload', { bytes: uploadedBytes });
    res.json({ ok: true, files: results, targets: targets.map((t) => t.id) });
  }));

  // ---------- File view / edit / share (owner or admin) ----------
  function canAccess(file, user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return file.ownerId === user.id;
  }

  app.get('/f/:id', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) {
      return res.status(404).render('error', { message: 'File not found.', status: 404 });
    }
    recordEvent(req, 'view', { fileId: file.id });
    res.render('view', { file, editable: isEditable(file), content: null, loadError: null });
  }));

  app.get('/f/:id/raw', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) return res.status(404).send('not found');
    try {
      const { buffer, mime: m } = await readFileWithFallback(file);
      recordEvent(req, 'download', { fileId: file.id, bytes: buffer.length });
      res.setHeader('Content-Type', file.mime || m || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
      res.send(buffer);
    } catch {
      res.status(502).send('no healthy replica available');
    }
  }));

  // Load text for editor
  app.get('/api/files/:id/text', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: 'not found' });
    if (!isEditable(file) || Number(file.size) > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'not editable as text' });
    }
    try {
      const { buffer } = await readFileWithFallback(file);
      res.json({ text: buffer.toString('utf8') });
    } catch {
      res.status(502).json({ error: 'no healthy replica' });
    }
  }));

  // Save text edit → rewrite to every known replica
  app.put('/api/files/:id/text', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: 'not found' });
    const text = String(req.body?.text ?? '');
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) return res.status(400).json({ error: 'too large to edit' });
    const buffer = Buffer.from(text, 'utf8');
    const replicas = file.replicas || [];
    const targets = (await allTargets()).filter((t) => replicas.includes(t.id));
    const ok = [];
    for (const t of targets.length ? targets : await resolveTargets()) {
      try {
        await storeToNode(t, file.id, buffer, { filename: file.filename, mime: file.mime });
        ok.push(t.id);
      } catch {
        /* keep going */
      }
    }
    if (!ok.length) return res.status(502).json({ error: 'write failed on all replicas' });
    await file.update({ size: buffer.length, replicas: [...new Set([...replicas, ...ok])] });
    res.json({ ok: true, size: Number(file.size) });
  }));

  app.post('/api/files/:id/share', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: 'not found' });
    const isPublic = !!req.body?.isPublic;
    await file.update({ isPublic, slug: file.slug || nanoid(10) });
    if (isPublic) recordEvent(req, 'share', { fileId: file.id });
    res.json({ ok: true, isPublic: !!file.isPublic, slug: file.slug });
  }));

  app.post('/api/files/:id/rename', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: 'not found' });
    const name = String(req.body?.filename || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: 'name required' });
    const mt = mime.lookup(name);
    await file.update({ filename: name, ...(mt ? { mime: mt } : {}) });
    res.json({ ok: true, file: safeFile(file) });
  }));

  app.delete('/api/files/:id', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: 'not found' });
    const replicas = file.replicas || [];
    const targets = (await allTargets()).filter((t) => replicas.includes(t.id));
    for (const t of targets) {
      try {
        await deleteFromNode(t, file.id);
      } catch {
        /* best effort */
      }
    }
    await file.destroy();
    res.json({ ok: true });
  }));

  // ---------- JSON API (session cookie or API key) ----------
  app.get('/api/me', requireLogin, wrap(async (req, res) => {
    const files = await FileRecord.findAll({ where: { ownerId: req.user.id }, attributes: ['size'] });
    const used = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
    const me = await User.findByPk(req.user.id);
    res.json({
      user: publicUser(me),
      usage: { files: files.length, bytes: used, quotaBytes: Number(me?.quotaBytes) || 0 },
      auth: req.apiKey ? 'api-key' : 'session',
    });
  }));

  app.get('/api/files', requireLogin, wrap(async (req, res) => {
    const all = req.user.role === 'admin' && req.query.all === '1';
    const files = await FileRecord.findAll({
      where: all ? {} : { ownerId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100)),
    });
    res.json({ files: files.map(safeFile) });
  }));

  app.get('/api/files/:id', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: 'not found' });
    res.json({ file: safeFile(file), raw: `/f/${file.id}/raw`, publicUrl: file.isPublic ? `/raw/${file.slug}` : null });
  }));

  // ---------- Public CDN / share links (no login) ----------
  app.get('/c/:slug', wrap(async (req, res) => {
    const file = await FileRecord.findOne({ where: { slug: req.params.slug, isPublic: true } });
    if (!file) return res.status(404).render('error', { message: 'This link is invalid or private.', status: 404 });
    recordEvent(req, 'view', { fileId: file.id });
    res.render('share', { file });
  }));

  app.get('/raw/:slug', wrap(async (req, res) => {
    const file = await FileRecord.findOne({ where: { slug: req.params.slug, isPublic: true } });
    if (!file) return res.status(404).send('not found');
    try {
      const { buffer, mime: m } = await readFileWithFallback(file);
      recordEvent(req, 'download', { fileId: file.id, bytes: buffer.length });
      res.setHeader('Content-Type', file.mime || m || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
      res.send(buffer);
    } catch {
      res.status(502).send('no healthy replica');
    }
  }));

  // ---------- Docs ----------
  app.get('/docs', (req, res) => res.render('docs'));

  // ---------- Admin ----------
  app.get('/admin', requireAdmin, wrap(async (req, res) => {
    await checkAllNodes().catch(() => {});
    const [users, files, nodes, replication, desired] = await Promise.all([
      User.count(),
      FileRecord.findAll({ attributes: ['size'] }),
      NodeRecord.findAll({ order: [['createdAt', 'ASC']] }),
      getSettings().then((s) => s.replication),
      desiredReplicasForDisplay(),
    ]);
    const stats = {
      users,
      files: files.length,
      bytes: files.reduce((s, f) => s + (Number(f.size) || 0), 0),
      nodes: nodes.length + 1,
      desired,
    };
    const local = localDiskUsage();
    const remoteStats = [];
    for (const n of nodes) {
      const st = nodeStatus.get(n.id);
      let usage = null;
      if (st?.online) {
        try {
          usage = await nodeStat(n);
        } catch {
          /* ignore */
        }
      }
      remoteStats.push({ node: n, status: st || { online: false }, usage });
    }
    res.render('admin/overview', {
      stats,
      local,
      remoteStats,
      nodeStatus: Object.fromEntries(nodeStatus),
      replication,
    });
  }));

  app.get('/admin/analytics', requireAdmin, wrap(async (req, res) => {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 14));
    const summary = await analyticsSummary({ days });
    res.render('admin/analytics', { summary });
  }));

  app.get('/admin/users', requireAdmin, wrap(async (req, res) => {
    const [people, files] = await Promise.all([
      User.findAll({ order: [['createdAt', 'ASC']] }),
      FileRecord.findAll({ attributes: ['ownerId', 'size'] }),
    ]);
    const users = people.map((u) => {
      const mine = files.filter((f) => f.ownerId === u.id);
      return {
        ...publicUser(u),
        used: mine.reduce((s, f) => s + (Number(f.size) || 0), 0),
        fileCount: mine.length,
      };
    });
    res.render('admin/users', { users });
  }));

  app.post('/admin/users', requireAdmin, wrap(async (req, res) => {
    const { username, password, role, quotaGB } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).send('username + password (6+ chars) required');
    }
    const taken = await User.findOne({
      where: sequelize.where(sequelize.fn('lower', sequelize.col('username')), String(username).trim().toLowerCase()),
    });
    if (taken) return res.status(400).send('username taken');
    await User.create({
      id: uuid(),
      username: String(username).trim(),
      passwordHash: await hashPassword(password),
      role: role === 'admin' ? 'admin' : 'user',
      quotaBytes: Math.max(1, Number(quotaGB) || 5) * 1024 * 1024 * 1024,
    });
    res.redirect('/admin/users');
  }));

  app.post('/admin/users/:id/quota', requireAdmin, wrap(async (req, res) => {
    const u = await User.findByPk(req.params.id);
    if (!u) return res.status(404).send('not found');
    const patch = { quotaBytes: Math.max(1, Number(req.body.quotaGB) || 1) * 1024 * 1024 * 1024 };
    if (req.body.role === 'admin' || req.body.role === 'user') patch.role = req.body.role;
    await u.update(patch);
    res.redirect('/admin/users');
  }));

  app.post('/admin/users/:id/delete', requireAdmin, wrap(async (req, res) => {
    if (req.user.id === req.params.id) return res.status(400).send('cannot delete yourself');
    await User.destroy({ where: { id: req.params.id } });
    res.redirect('/admin/users');
  }));

  app.get('/admin/files', requireAdmin, wrap(async (req, res) => {
    const [files, people] = await Promise.all([
      FileRecord.findAll({ order: [['createdAt', 'DESC']] }),
      User.findAll(),
    ]);
    res.render('admin/files', { files, users: people });
  }));

  app.get('/admin/nodes', requireAdmin, wrap(async (req, res) => {
    await checkAllNodes().catch(() => {});
    const [nodes, settings] = await Promise.all([NodeRecord.findAll({ order: [['createdAt', 'ASC']] }), getSettings()]);
    res.render('admin/nodes', {
      nodes,
      replication: settings.replication,
      nodeStatus: Object.fromEntries(nodeStatus),
    });
  }));

  app.post('/admin/nodes', requireAdmin, wrap(async (req, res) => {
    const { name, url, accessKey } = req.body;
    if (!name || !url) return res.status(400).send('name + url required');
    await NodeRecord.create({
      id: nanoid(10),
      name: String(name).trim(),
      url: String(url).trim().replace(/\/+$/, ''),
      accessKey: String(accessKey || '').trim(),
      enabled: true,
    });
    res.redirect('/admin/nodes');
  }));

  app.post('/admin/nodes/:id/toggle', requireAdmin, wrap(async (req, res) => {
    const n = await NodeRecord.findByPk(req.params.id);
    if (n) await n.update({ enabled: !n.enabled });
    res.redirect('/admin/nodes');
  }));

  app.post('/admin/nodes/:id/delete', requireAdmin, wrap(async (req, res) => {
    await NodeRecord.destroy({ where: { id: req.params.id } });
    res.redirect('/admin/nodes');
  }));

  app.post('/admin/replication', requireAdmin, wrap(async (req, res) => {
    const { mode, selectedNodeIds, defaultNodeId, replicaCount } = req.body;
    const sel = Array.isArray(selectedNodeIds) ? selectedNodeIds : selectedNodeIds ? [selectedNodeIds] : [];
    await saveSettings({
      replication: {
        mode: ['all', 'select', 'single', 'default', 'n'].includes(mode) ? mode : 'n',
        selectedNodeIds: sel,
        defaultNodeId: defaultNodeId || 'local',
        replicaCount: Math.max(1, Math.min(20, parseInt(replicaCount, 10) || 1)),
      },
    });
    res.redirect('/admin/nodes');
  }));

  app.get('/admin/appearance', requireAdmin, wrap(async (req, res) => {
    res.render('admin/appearance', { s: await getSettings() });
  }));

  app.post('/admin/appearance', requireAdmin, wrap(async (req, res) => {
    const { siteName, accent, bg, surface, text } = req.body;
    const patch = {};
    if (siteName?.trim()) patch.siteName = siteName.trim().slice(0, 60);
    for (const [k, v] of Object.entries({ accent, bg, surface, text })) {
      if (/^#[0-9a-fA-F]{6}$/.test(v || '')) patch[k] = v;
    }
    if (Object.keys(patch).length) await saveSettings(patch);
    res.redirect('/admin/appearance');
  }));

  // ---------- API keys ----------
  app.get('/admin/api-keys', requireAdmin, wrap(async (req, res) => {
    const [keys, people] = await Promise.all([listApiKeys(), User.findAll({ order: [['username', 'ASC']] })]);
    res.render('admin/api-keys', { keys, users: people, createdKey: null });
  }));

  app.post('/admin/api-keys', requireAdmin, wrap(async (req, res) => {
    const { name, ownerId } = req.body;
    const owner = (ownerId && (await User.findByPk(ownerId))) || (await User.findByPk(req.user.id));
    const created = await createApiKey({ name, createdBy: owner.id });
    const [keys, people] = await Promise.all([listApiKeys(), User.findAll({ order: [['username', 'ASC']] })]);
    res.render('admin/api-keys', { keys, users: people, createdKey: created.raw });
  }));

  app.post('/admin/api-keys/:id/revoke', requireAdmin, wrap(async (req, res) => {
    await revokeApiKey(req.params.id);
    res.redirect('/admin/api-keys');
  }));

  app.get('/api/health', wrap(async (req, res) => {
    const settings = await getSettings();
    res.json({
      mode: 'main',
      setupDone: settings.setupDone,
      nodes: (await allTargets()).map((n) => ({ id: n.id, name: n.name, status: nodeStatus.get(n.id) || null })),
    });
  }));

  // 404
  app.use((req, res) => res.status(404).render('error', { message: 'Page not found.', status: 404 }));

  // Errors
  app.use((err, req, res, next) => {
    console.error('[cascade]', err?.message || err);
    const bad = err instanceof multer.MulterError;
    const status = bad ? 400 : 500;
    if (req.path.startsWith('/api/')) {
      return res.status(status).json({ error: bad ? err.message : 'server error' });
    }
    res.status(status).render('error', { message: bad ? err.message : 'Something went wrong.', status });
  });

  startHealthLoop();
  return app;
}

function isEditable(file) {
  if ((Number(file.size) || 0) > 2 * 1024 * 1024) return false;
  const m = file.mime || '';
  if (m.startsWith('text/') || m.includes('json') || m.includes('javascript') || m.includes('xml')) return true;
  return /\.(txt|md|markdown|json|js|ts|css|html|yml|yaml|toml|env|log|csv)$/i.test(file.filename || '');
}

export function startMain() {
  const app = createMainApp();
  app.listen(config.port, config.host, () => {
    console.log(`[cascade] main server on http://${config.host}:${config.port}`);
    console.log(`[cascade] sqlite database at ${path.resolve(config.dbPath)}`);
  });
}
