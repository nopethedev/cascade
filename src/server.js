import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { v4 as uuid } from 'uuid';
import mime from 'mime-types';
import { Op } from 'sequelize';
import { config } from './config.js';
import { sequelize, User, FileRecord, NodeRecord, Folder, getSettings, saveSettings, needsSetup } from './db.js';
import { requireLogin, requireAdmin, hashPassword, checkPassword, publicUser } from './auth.js';
import { validateNewAccount, validateUsername, usernameTaken, createAccount } from './accounts.js';
import { scanUnusedStorage, removeUnusedStorage } from './cleanup.js';
import { resolveTargets, storeToNode, readFileWithFallback, deleteFromNode, allTargets, localDiskUsage } from './storage.js';
import { nodeStatus, startHealthLoop, checkAllNodes, desiredReplicasForDisplay } from './health.js';
import { nodeStat } from './nodeClient.js';
import { recordEvent, analyticsSummary } from './analytics.js';
import { extractApiToken, authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from './apiKeys.js';
import { createWorkspaceRouter } from './workspace.js';
import { createImageRouter } from './images.js';
import { createMcpRouter } from './mcp.js';
import { KIND_BY_ID, KINDS } from './templates.js';
import { computeSheet } from './formula.js';
import { startCollabServer } from './collab.js';
import { createSitesRouter, customDomainSiteMiddleware } from './sites.js';
import { createStudioRouter } from './studio.js';

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

// Quotas are entered in megabytes (0.1 GB = 102.4 MB). Keep accepting the old
// quotaGB field so existing forms, API clients and tests continue to work.
function quotaBytesFromBody(body) {
  const mbRaw = body?.quotaMB;
  if (mbRaw !== undefined && mbRaw !== null && String(mbRaw).trim() !== '') {
    const mb = Number(mbRaw);
    if (Number.isFinite(mb)) return Math.max(1, Math.round(mb * 1024 * 1024));
  }
  const gbRaw = body?.quotaGB;
  if (gbRaw !== undefined && gbRaw !== null && String(gbRaw).trim() !== '') {
    const gb = Number(gbRaw);
    if (Number.isFinite(gb)) return Math.max(1, Math.round(gb * 1024 * 1024 * 1024));
  }
  return null;
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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ACTIVE_MIMES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
]);

function isActiveMime(value) {
  return ACTIVE_MIMES.has(String(value || '').split(';')[0].trim().toLowerCase());
}

// Trust the filename extension over a client-supplied multipart type. This
// stops a file named `photo.png` from being stored and later served as HTML.
function uploadMime(filename, provided) {
  const byName = mime.lookup(String(filename || ''));
  if (byName) return byName;
  const supplied = String(provided || '').split(';')[0].trim().toLowerCase();
  return supplied && !isActiveMime(supplied) ? supplied : 'application/octet-stream';
}

function sendStoredFile(res, file, buffer) {
  const type = file.mime || 'application/octet-stream';
  const encodedName = encodeURIComponent(file.filename || file.id || 'download');
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (isActiveMime(type)) {
    // User-controlled HTML/SVG/XML must never execute on the app origin.
    res.setHeader('Content-Disposition', `attachment; filename="${encodedName}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  } else {
    res.setHeader('Content-Disposition', `inline; filename="${encodedName}"`);
  }
  res.send(buffer);
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
    kind: f.kind || 'file',
    folderId: f.folderId || null,
    version: f.version || 0,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

const nameKey = (value) => String(value || '').trim().toLocaleLowerCase();

function splitFilename(filename) {
  const raw = String(filename || 'File').trim() || 'File';
  const dot = raw.lastIndexOf('.');
  if (dot > 0 && dot < raw.length - 1) return { base: raw.slice(0, dot), ext: raw.slice(dot) };
  return { base: raw, ext: '' };
}

// A copy never silently overwrites a sibling and never reuses its basename:
// `Report.docx` → `Report copy.docx`, then `Report copy 2.docx`.
function nextCopyName(filename, takenNames) {
  const { base, ext } = splitFilename(filename);
  const taken = new Set([...takenNames].map(nameKey));
  const stem = base.slice(0, Math.max(1, 235 - ext.length));
  let candidate = `${stem} copy${ext}`;
  let n = 2;
  while (taken.has(nameKey(candidate))) {
    candidate = `${stem} copy ${n}${ext}`;
    n += 1;
  }
  return candidate;
}

function uniqueNameForFolder(name, takenNames) {
  const taken = new Set([...takenNames].map(nameKey));
  const base = String(name || 'Folder').trim().slice(0, 80) || 'Folder';
  if (!taken.has(nameKey(base))) return base;
  let n = 2;
  while (taken.has(nameKey(`${base} ${n}`.slice(0, 80)))) n += 1;
  return `${base} ${n}`.slice(0, 80);
}

// Busboy (via multer 1.x) decodes multipart filename parameters as latin1.
// Browsers send UTF-8, so non-ASCII names arrive mojibaked. Decode only when
// the bytes form valid UTF-8; a genuine latin1 name keeps its original value.
function decodeUploadFilename(filename) {
  const raw = String(filename || '');
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? raw : decoded;
}

function uniqueFileName(filename, takenNames) {
  const taken = new Set([...takenNames].map(nameKey));
  const raw = String(filename || 'File').trim() || 'File';
  if (!taken.has(nameKey(raw))) return raw;
  const { base, ext } = splitFilename(raw);
  let n = 2;
  let candidate = `${base} ${n}${ext}`;
  while (taken.has(nameKey(candidate))) {
    n += 1;
    candidate = `${base} ${n}${ext}`;
  }
  return candidate.slice(0, 240);
}

function folderTrail(folderRows, folder) {
  const byId = new Map(folderRows.map((f) => [f.id, f]));
  const trail = [];
  const seen = new Set();
  let cursor = folder || null;
  while (cursor && !seen.has(cursor.id) && trail.length < 100) {
    seen.add(cursor.id);
    trail.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  return trail;
}

function folderViews(folderRows) {
  const byId = new Map(folderRows.map((f) => [f.id, f]));
  return folderRows.map((f) => {
    const trail = folderTrail(folderRows, byId.get(f.id));
    return {
      id: f.id,
      name: f.name,
      parentId: f.parentId || null,
      updatedAt: f.updatedAt,
      path: trail.map((p) => p.name).join(' / '),
    };
  });
}

async function siblingFileNames(ownerId, folderId, excludeId = null) {
  const rows = await FileRecord.findAll({
    where: { ownerId, folderId: folderId || null },
    attributes: ['id', 'filename'],
  });
  return rows.filter((r) => r.id !== excludeId).map((r) => r.filename);
}

async function siblingFolderRows(ownerId, parentId, excludeId = null) {
  const rows = await Folder.findAll({ where: { ownerId, parentId: parentId || null } });
  return rows.filter((r) => r.id !== excludeId);
}

async function validFolderForOwner(folderId, ownerId) {
  if (!folderId) return null;
  return Folder.findOne({ where: { id: String(folderId), ownerId } });
}

export function createMainApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'views'));
  app.set('trust proxy', true);

  app.use(express.urlencoded({ extended: true }));
  // PDF workspaces store the base64 source in the document JSON; allow room for merges.
  app.use(express.json({ limit: '25mb' }));
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, sameSite: 'lax' },
    }),
  );
  app.use('/public', express.static(path.join(ROOT, 'public')));
  app.get('/favicon.ico', (req, res) => res.redirect(302, '/public/favicon.svg'));

  // Published websites can answer on their own verified Host before the app
  // auth/setup layers run. Unknown Hosts continue to the normal app.
  app.use(customDomainSiteMiddleware());

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
          if (req.path.startsWith('/api/') || req.path === '/mcp') return res.status(401).json({ error: 'invalid or revoked API key' });
          return res.status(401).send('Invalid or revoked API key.');
        }
        req.user = auth.user;
        req.apiKey = auth.record;
      }

      res.locals.settings = settings;
      res.locals.allowPublicSignup = !!settings.allowPublicSignup;
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
      // Authenticated JSON and editor responses must not be reused by a cache
      // for a different principal.
      if (req.path.startsWith('/api/') || req.path === '/mcp') res.setHeader('Cache-Control', 'private, no-store');

      if (req.apiKey) {
        const scope = ['read', 'write', 'full'].includes(req.apiKey.scope) ? req.apiKey.scope : 'full';
        const adminPath = req.path === '/admin' || req.path.startsWith('/admin/');
        if (scope !== 'full' && adminPath) {
          return req.path.startsWith('/api/')
            ? res.status(403).json({ error: 'API key scope does not allow admin access' })
            : res.status(403).render('error', { message: 'API key scope does not allow admin access.', status: 403 });
        }
        // MCP uses POST for both reads and writes; its handler enforces
        // per-tool read-only scope after authentication.
        if (scope === 'read' && !SAFE_METHODS.has(req.method) && req.path !== '/mcp') {
          return req.path.startsWith('/api/')
            ? res.status(403).json({ error: 'API key is read-only' })
            : res.status(403).render('error', { message: 'API key is read-only.', status: 403 });
        }
      }

      // CSRF defense for cookie-authenticated browser mutations. API-key clients
      // authenticate with a header, so they do not rely on ambient cookies.
      if (!req.apiKey && req.session?.user && !SAFE_METHODS.has(req.method)) {
        const source = req.get('origin') || req.get('referer');
        if (source) {
          let same = false;
          try {
            const parsed = new URL(source);
            const expectedHost = req.get('x-forwarded-host') || req.get('host');
            const expectedProto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
            same = parsed.host === expectedHost && parsed.protocol === `${expectedProto}:`;
          } catch {
            same = false;
          }
          if (!same) {
            return req.path.startsWith('/api/')
              ? res.status(403).json({ error: 'cross-origin request rejected' })
              : res.status(403).render('error', { message: 'Cross-origin request rejected.', status: 403 });
          }
        }
      }

      next();
    }),
  );

  // First-run wizard gate
  app.use(
    wrap(async (req, res, next) => {
      if (!(await needsSetup())) return next();
      if (['/setup', '/docs'].includes(req.path) || req.path.startsWith('/docs/') || req.path.startsWith('/public/')) return next();
      if (req.path.startsWith('/api/') || req.path === '/mcp') return res.status(503).json({ error: 'setup required' });
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

  // ---------- Registration ----------
  // Disabled by default. An administrator can opt in from Admin → Users.
  const registrationOpen = async () => !!(await getSettings()).allowPublicSignup;

  app.get('/api/auth/config', wrap(async (req, res) => {
    const settings = await getSettings();
    res.json({ allowPublicSignup: !!settings.allowPublicSignup, siteName: settings.siteName || 'Cascade' });
  }));

  app.get('/register', wrap(async (req, res) => {
    if (req.user) return res.redirect('/');
    if (!(await registrationOpen())) return res.redirect('/login?registration=disabled');
    res.render('register', { error: null, values: {} });
  }));

  app.post('/register', wrap(async (req, res) => {
    if (!(await registrationOpen())) return res.status(403).render('register', { error: 'Registration is disabled on this server.', values: {} });
    const values = { username: String(req.body?.username || '').trim() };
    if (req.body?.confirmPassword !== undefined && req.body.confirmPassword !== req.body.password) {
      return res.status(400).render('register', { error: 'Passwords do not match.', values });
    }
    const checked = validateNewAccount({ username: values.username, password: req.body?.password });
    if (!checked.ok) return res.status(400).render('register', { error: checked.error, values });
    try {
      const user = await createAccount({ username: checked.username, password: req.body.password });
      req.session.user = publicUser(user);
      return res.redirect('/');
    } catch (error) {
      return res.status(error.status || 400).render('register', { error: error.message, values });
    }
  }));

  app.post('/api/auth/register', wrap(async (req, res) => {
    if (!(await registrationOpen())) return res.status(403).json({ error: 'Registration is disabled on this server.' });
    const checked = validateNewAccount({ username: req.body?.username, password: req.body?.password });
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    try {
      const user = await createAccount({ username: checked.username, password: req.body.password });
      req.session.user = publicUser(user);
      res.status(201).json({ ok: true, user: publicUser(user) });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  }));

  // ---------- Auth ----------
  app.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('login', { error: null, query: req.query });
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

  // ---------- Account settings ----------
  app.get('/settings', requireLogin, wrap(async (req, res) => {
    const me = await User.findByPk(req.user.id);
    if (!me) return res.redirect('/login');
    const mine = await FileRecord.findAll({ where: { ownerId: me.id }, attributes: ['size'] });
    const used = mine.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    res.render('settings', {
      account: publicUser(me),
      used,
      fileCount: mine.length,
      quota: Number(me.quotaBytes) || 0,
      notice: req.query.updated ? 'Account updated.' : null,
      error: null,
    });
  }));

  app.post('/settings/profile', requireLogin, wrap(async (req, res) => {
    const me = await User.findByPk(req.user.id);
    if (!me) return res.redirect('/login');
    const checked = validateUsername(req.body?.username);
    if (!checked.ok) {
      const mine = await FileRecord.findAll({ where: { ownerId: me.id }, attributes: ['size'] });
      return res.status(400).render('settings', {
        account: publicUser(me), used: mine.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
        fileCount: mine.length, quota: Number(me.quotaBytes) || 0, notice: null, error: checked.error,
      });
    }
    if (checked.username.toLowerCase() !== String(me.username).toLowerCase() && await usernameTaken(checked.username, me.id)) {
      const mine = await FileRecord.findAll({ where: { ownerId: me.id }, attributes: ['size'] });
      return res.status(409).render('settings', {
        account: publicUser(me), used: mine.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
        fileCount: mine.length, quota: Number(me.quotaBytes) || 0, notice: null, error: 'That username is already taken.',
      });
    }
    await me.update({ username: checked.username });
    await FileRecord.update({ ownerName: checked.username }, { where: { ownerId: me.id } });
    req.session.user = publicUser(me);
    res.redirect('/settings?updated=1');
  }));

  app.post('/settings/password', requireLogin, wrap(async (req, res) => {
    const me = await User.findByPk(req.user.id);
    if (!me) return res.redirect('/login');
    const current = String(req.body?.currentPassword || '');
    const next = String(req.body?.newPassword || '');
    const mine = await FileRecord.findAll({ where: { ownerId: me.id }, attributes: ['size'] });
    const view = {
      account: publicUser(me), used: mine.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
      fileCount: mine.length, quota: Number(me.quotaBytes) || 0, notice: null,
    };
    if (!(await checkPassword(current, me.passwordHash))) return res.status(400).render('settings', { ...view, error: 'Current password is incorrect.' });
    if (next.length < 6) return res.status(400).render('settings', { ...view, error: 'New password must be at least 6 characters.' });
    await me.update({ passwordHash: await hashPassword(next) });
    res.redirect('/settings?updated=1');
  }));

  // ---------- Dashboard ----------
  app.get('/', requireLogin, wrap(async (req, res) => {
    const folderId = String(req.query.folder || '');
    const [folderRows, me] = await Promise.all([
      Folder.findAll({ where: { ownerId: req.user.id }, order: [['name', 'ASC']] }),
      User.findByPk(req.user.id),
    ]);
    const folders = folderViews(folderRows);
    const currentFolder = folderId ? folders.find((f) => f.id === folderId) || null : null;
    const trail = currentFolder ? folderTrail(folders, currentFolder) : [];
    const parentFolder = trail.length > 1 ? trail[trail.length - 2] : null;
    const files = await FileRecord.findAll({
      where: { ownerId: req.user.id, folderId: currentFolder ? currentFolder.id : null },
      order: [['updatedAt', 'DESC']],
    });
    const allMine = await FileRecord.findAll({ where: { ownerId: req.user.id }, attributes: ['size'] });
    const used = allMine.reduce((s, f) => s + (Number(f.size) || 0), 0);
    res.render('dashboard', {
      files,
      folders,
      childFolders: folders.filter((f) => (f.parentId || null) === (currentFolder?.id || null)),
      currentFolder,
      parentFolder,
      folderTrail: trail,
      folderId: currentFolder?.id || '',
      kinds: KINDS,
      used,
      quota: Number(me?.quotaBytes) || 0,
      query: req.query.q || '',
    });
  }));

  // ---------- Upload ----------
  app.post('/api/upload', requireLogin, upload.array('files', 20), wrap(async (req, res) => {
    const me = await User.findByPk(req.user.id);
    if (!me) return res.status(401).json({ error: 'unknown user' });
    const folderId = req.body?.folderId ? String(req.body.folderId) : null;
    const folder = folderId ? await validFolderForOwner(folderId, me.id) : null;
    if (folderId && !folder) return res.status(400).json({ error: 'folder not found' });
    const targets = await resolveTargets();
    if (!targets.length) return res.status(500).json({ error: 'no storage nodes configured' });

    const existing = await FileRecord.findAll({ where: { ownerId: me.id } });
    let used = existing.reduce((s, f) => s + (Number(f.size) || 0), 0);
    const takenNames = await siblingFileNames(me.id, folderId);

    const results = [];
    let uploadedBytes = 0;
    for (const f of req.files || []) {
      const originalName = decodeUploadFilename(f.originalname);
      if (used + f.size > (Number(me.quotaBytes) || 0)) {
        results.push({ filename: originalName, error: 'quota exceeded' });
        continue;
      }
      const id = nanoid(12);
      const slug = nanoid(10);
      const filename = uniqueFileName(originalName, takenNames);
      takenNames.push(filename);
      const stored = [];
      let firstErr = null;
      for (const t of targets) {
        try {
          await storeToNode(t, id, f.buffer, { filename, mime: f.mimetype });
          stored.push(t.id);
        } catch (e) {
          firstErr = e;
        }
      }
      if (!stored.length) {
        results.push({ filename: originalName, error: `all nodes failed (${firstErr?.message || 'unknown'})` });
        continue;
      }
      await FileRecord.create({
        id,
        slug,
        filename,
        mime: uploadMime(filename, f.mimetype),
        size: f.size,
        ownerId: me.id,
        ownerName: me.username,
        isPublic: false,
        replicas: stored,
        primaryNode: stored[0],
        folderId: folder?.id || null,
      });
      used += f.size;
      uploadedBytes += f.size;
      results.push({ filename, id, slug, replicas: stored, folderId: folder?.id || null });
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
      res.setHeader('Cache-Control', 'private, no-store');
      sendStoredFile(res, { ...file.toJSON(), mime: file.mime || m }, buffer);
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
    const isPublic = req.body?.isPublic;
    if (typeof isPublic !== 'boolean') return res.status(400).json({ error: 'isPublic must be a boolean' });
    await file.update({ isPublic, slug: file.slug || nanoid(10) });
    if (isPublic) recordEvent(req, 'share', { fileId: file.id });
    res.json({ ok: true, isPublic: !!file.isPublic, slug: file.slug });
  }));

  app.post('/api/files/:id/rename', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: 'not found' });
    const name = String(req.body?.filename || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: 'name required' });
    const taken = await siblingFileNames(file.ownerId, file.folderId, file.id);
    if (taken.some((n) => nameKey(n) === nameKey(name))) {
      return res.status(409).json({ error: 'an item with that name already exists in this folder' });
    }
    const mt = mime.lookup(name);
    await file.update({ filename: name, ...(mt ? { mime: mt } : {}) });
    res.json({ ok: true, file: safeFile(file) });
  }));

  // Move a file into a folder (or back to the root). Folders are owner-scoped,
  // so a stale folder id from another account cannot be used as a destination.
  app.post('/api/files/:id/move', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: 'not found' });
    const raw = req.body?.folderId;
    const folder = raw ? await validFolderForOwner(raw, req.user.id) : null;
    if (raw && !folder) return res.status(400).json({ error: 'folder not found' });
    const nextFolderId = folder?.id || null;
    if (nextFolderId === (file.folderId || null)) {
      return res.json({ ok: true, folderId: nextFolderId, folder: folder ? { id: folder.id, name: folder.name } : null, unchanged: true });
    }
    const taken = await siblingFileNames(file.ownerId, nextFolderId, file.id);
    if (taken.some((n) => nameKey(n) === nameKey(file.filename))) {
      return res.status(409).json({ error: 'an item with that name already exists in the destination' });
    }
    await file.update({ folderId: nextFolderId });
    res.json({ ok: true, folderId: nextFolderId, folder: folder ? { id: folder.id, name: folder.name } : null });
  }));

  // Copy an editor document in place, or copy an uploaded blob onto the same
  // healthy replicas. The duplicate is always private and owned by the caller.
  app.post('/api/files/:id/copy', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file || !canAccess(file, req.user)) return res.status(404).json({ error: 'not found' });
    const me = await User.findByPk(req.user.id);
    const mine = await FileRecord.findAll({ where: { ownerId: req.user.id }, attributes: ['size'] });
    const used = mine.reduce((s, f) => s + (Number(f.size) || 0), 0);
    if (used + (Number(file.size) || 0) > (Number(me?.quotaBytes) || 0)) {
      return res.status(413).json({ error: 'not enough storage quota for a copy' });
    }
    let folderId = null;
    if (req.body?.folderId) {
      const folder = await validFolderForOwner(req.body.folderId, req.user.id);
      if (!folder) return res.status(400).json({ error: 'folder not found' });
      folderId = folder.id;
    } else if (req.body?.keepFolder === true) {
      folderId = file.folderId || null;
    }
    const id = nanoid(12);
    const slug = nanoid(10);
    const filename = nextCopyName(file.filename, await siblingFileNames(req.user.id, folderId));
    let replicas = [];
    let primaryNode = null;
    if (file.kind === 'file') {
      try {
        const { buffer } = await readFileWithFallback(file);
        for (const target of await resolveTargets()) {
          try {
            await storeToNode(target, id, buffer, { filename, mime: file.mime });
            replicas.push(target.id);
          } catch {
            /* try the next node */
          }
        }
        if (!replicas.length) return res.status(502).json({ error: 'could not copy the stored file' });
        primaryNode = replicas[0];
      } catch {
        return res.status(502).json({ error: 'could not read the stored file' });
      }
    }
    const copy = await FileRecord.create({
      id,
      slug,
      filename,
      mime: file.mime,
      size: Number(file.size) || 0,
      ownerId: req.user.id,
      ownerName: req.user.username,
      isPublic: false,
      starred: false,
      replicas,
      primaryNode,
      kind: file.kind || 'file',
      content: file.content || null,
      version: file.kind === 'file' ? 0 : Math.max(1, Number(file.version) || 1),
      template: file.template || null,
      folderId,
    });
    recordEvent(req, 'create', { fileId: copy.id });
    res.status(201).json({ ok: true, id: copy.id, file: safeFile(copy), url: file.kind === 'file' ? `/f/${copy.id}` : `/edit/${copy.id}` });
  }));

  app.post('/api/folders/:id/rename', requireLogin, wrap(async (req, res) => {
    const folder = await Folder.findOne({ where: { id: req.params.id, ownerId: req.user.id } });
    if (!folder) return res.status(404).json({ error: 'not found' });
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'name required' });
    const siblings = await siblingFolderRows(req.user.id, folder.parentId, folder.id);
    if (siblings.some((f) => nameKey(f.name) === nameKey(name))) {
      return res.status(409).json({ error: 'a folder with that name already exists here' });
    }
    await folder.update({ name });
    res.json({ ok: true, folder: { id: folder.id, name: folder.name, parentId: folder.parentId || null } });
  }));

  // Moving a folder is where hierarchy bugs usually happen. Resolve the full
  // ancestor chain and reject the move if the new parent is the folder itself
  // or any descendant of it. Names must stay unique among siblings.
  app.post('/api/folders/:id/move', requireLogin, wrap(async (req, res) => {
    const folder = await Folder.findOne({ where: { id: req.params.id, ownerId: req.user.id } });
    if (!folder) return res.status(404).json({ error: 'not found' });
    const parentId = req.body?.parentId ? String(req.body.parentId) : null;
    if (parentId === folder.id) return res.status(400).json({ error: 'a folder cannot contain itself' });
    const parent = parentId ? await validFolderForOwner(parentId, req.user.id) : null;
    if (parentId && !parent) return res.status(400).json({ error: 'destination folder not found' });
    if (parent) {
      const all = await Folder.findAll({ where: { ownerId: req.user.id } });
      const trail = folderTrail(all, parent);
      if (trail.some((f) => f.id === folder.id)) {
        return res.status(400).json({ error: 'a folder cannot be moved into itself or one of its descendants' });
      }
    }
    const siblings = await siblingFolderRows(req.user.id, parentId, folder.id);
    if (siblings.some((f) => nameKey(f.name) === nameKey(folder.name))) {
      return res.status(409).json({ error: 'a folder with that name already exists in the destination' });
    }
    await folder.update({ parentId: parent?.id || null });
    res.json({ ok: true, folder: { id: folder.id, name: folder.name, parentId: folder.parentId || null } });
  }));

  // Deleting a folder never deletes content. Child folders and files move up
  // one level (to the removed folder's parent); any sibling-name collision is
  // resolved deterministically instead of leaving duplicates or orphans.
  app.delete('/api/folders/:id', requireLogin, wrap(async (req, res) => {
    const folder = await Folder.findOne({ where: { id: req.params.id, ownerId: req.user.id } });
    if (!folder) return res.status(404).json({ error: 'not found' });
    const parentId = folder.parentId || null;
    const children = await Folder.findAll({ where: { ownerId: req.user.id, parentId: folder.id } });
    const siblingFolders = await siblingFolderRows(req.user.id, parentId, folder.id);
    const folderNames = siblingFolders.map((f) => f.name);
    for (const child of children) {
      const nextName = uniqueNameForFolder(child.name, folderNames);
      folderNames.push(nextName);
      await child.update({ parentId, name: nextName });
    }
    const files = await FileRecord.findAll({ where: { ownerId: req.user.id, folderId: folder.id } });
    const fileNames = await siblingFileNames(req.user.id, parentId);
    for (const file of files) {
      const nextName = uniqueFileName(file.filename, fileNames);
      fileNames.push(nextName);
      await file.update({ folderId: parentId, filename: nextName });
    }
    await folder.destroy();
    res.json({ ok: true, folderId: folder.id, movedFolders: children.length, movedFiles: files.length, parentId });
  }));

  app.post('/api/folders', requireLogin, wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'name required' });
    const parentId = req.body?.parentId ? String(req.body.parentId) : null;
    const parent = parentId ? await validFolderForOwner(parentId, req.user.id) : null;
    if (parentId && !parent) return res.status(400).json({ error: 'parent folder not found' });
    const siblings = await siblingFolderRows(req.user.id, parentId);
    if (siblings.some((f) => nameKey(f.name) === nameKey(name))) {
      return res.status(409).json({ error: 'a folder with that name already exists here' });
    }
    const folder = await Folder.create({ id: uuid(), name, ownerId: req.user.id, parentId: parent?.id || null });
    res.status(201).json({ ok: true, folder: { id: folder.id, name: folder.name, parentId: folder.parentId || null } });
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
    if (file.kind === 'site') return res.redirect(302, `/sites/${file.slug}`);
    if (file.kind && file.kind !== 'file') {
      let content = {};
      try {
        content = JSON.parse(file.content || '{}');
      } catch {
        /* ignore */
      }
      let sheetValues = null;
      if (file.kind === 'sheet') {
        const first = (content.sheets || [])[0];
        sheetValues = first ? computeSheet(first) : {};
      }
      if (file.kind === 'doc' && content.html) {
        // Private uploads use /f/:id/raw; expose only images owned by the
        // document owner through the public document asset route.
        content.html = String(content.html).replace(/\/f\/([A-Za-z0-9_-]+)\/raw/g, `/c/${file.slug}/asset/$1`);
      }
      // Documents may contain user-authored HTML — never run scripts on the share origin.
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
      return res.render('share-doc', { file, content, kind: KIND_BY_ID.get(file.kind), sheetValues });
    }
    res.render('share', { file });
  }));

  app.get('/raw/:slug', wrap(async (req, res) => {
    const file = await FileRecord.findOne({ where: { slug: req.params.slug, isPublic: true } });
    if (!file) return res.status(404).send('not found');
    if (file.kind && file.kind !== 'file') return res.redirect(`/c/${file.slug}`);
    try {
      const { buffer, mime: m } = await readFileWithFallback(file);
      recordEvent(req, 'download', { fileId: file.id, bytes: buffer.length });
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      sendStoredFile(res, { ...file.toJSON(), mime: file.mime || m }, buffer);
    } catch {
      res.status(502).send('no healthy replica');
    }
  }));

  // ---------- Docs ----------
  app.get('/docs', (req, res) => res.render('docs'));
  app.get('/docs/game', (req, res) => res.render('docs-game'));
  app.get('/docs/flow', (req, res) => res.render('docs-flow'));

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
    res.render('admin/users', { users, allowPublicSignup: !!(await getSettings()).allowPublicSignup });
  }));

  app.post('/admin/registration', requireAdmin, wrap(async (req, res) => {
    const enabled = req.body?.allowPublicSignup === 'on' || req.body?.allowPublicSignup === '1' || req.body?.allowPublicSignup === 'true';
    await saveSettings({ allowPublicSignup: enabled });
    res.redirect('/admin/users');
  }));

  app.post('/admin/users', requireAdmin, wrap(async (req, res) => {
    const { username, password, role } = req.body;
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
      quotaBytes: quotaBytesFromBody(req.body) ?? 5 * 1024 * 1024 * 1024,
    });
    res.redirect('/admin/users');
  }));

  app.post('/admin/users/:id/quota', requireAdmin, wrap(async (req, res) => {
    const u = await User.findByPk(req.params.id);
    if (!u) return res.status(404).send('not found');
    const patch = {};
    const quotaBytes = quotaBytesFromBody(req.body);
    if (quotaBytes !== null) patch.quotaBytes = quotaBytes;
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

  // Local blob cleanup. A blob is unused only when its id has no FileRecord;
  // this never deletes uploads merely because no document references them.
  app.get('/admin/cleanup', requireAdmin, wrap(async (req, res) => {
    const records = await FileRecord.findAll({ attributes: ['id'] });
    const scan = scanUnusedStorage({ storageDir: config.storageDir, knownIds: records.map((file) => file.id) });
    res.render('admin/cleanup', {
      tab: 'cleanup', scan, records: records.length, disk: localDiskUsage(),
      cleaned: req.query.cleaned !== undefined ? Number(req.query.cleaned) || 0 : null,
      cleanedBytes: Number(req.query.bytes) || 0,
      cleanupError: req.query.error ? String(req.query.error).slice(0, 200) : null,
    });
  }));

  app.post('/admin/cleanup', requireAdmin, wrap(async (req, res) => {
    const records = await FileRecord.findAll({ attributes: ['id'] });
    const scan = scanUnusedStorage({ storageDir: config.storageDir, knownIds: records.map((file) => file.id) });
    const removed = removeUnusedStorage({ storageDir: config.storageDir, files: scan.files });
    const params = new URLSearchParams({ cleaned: String(removed.deleted.length), bytes: String(removed.bytes) });
    if (removed.failed.length) params.set('error', `${removed.failed.length} file(s) could not be removed`);
    res.redirect(`/admin/cleanup?${params}`);
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
    res.setHeader('Cache-Control', 'no-store');
    res.render('admin/api-keys', { keys, users: people, createdKey: null });
  }));

  app.post('/admin/api-keys', requireAdmin, wrap(async (req, res) => {
    const { name, ownerId, scope } = req.body;
    const owner = ownerId ? await User.findByPk(ownerId) : await User.findByPk(req.user.id);
    if (!owner) return res.status(400).send('owner not found');
    const created = await createApiKey({ name, createdBy: owner.id, scope });
    const [keys, people] = await Promise.all([listApiKeys(), User.findAll({ order: [['username', 'ASC']] })]);
    res.setHeader('Cache-Control', 'no-store');
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

  // Image library: keyless Wikimedia Commons search plus a constrained proxy.
  app.use('/api/images', createImageRouter());

  // MCP: stateless Streamable HTTP JSON-RPC, same auth/owner checks as the app.
  app.use('/mcp', createMcpRouter());

  // Roblox Studio: /studio/roblox, authenticated pairing relay and editor.
  app.use(createStudioRouter());

  // Workspace: /create, /edit/:id, /api/workspace/*, /export/:id, /forms/:slug, /search
  app.use(createWorkspaceRouter());

  // Published websites: /sites/:slug, forms, SEO files and standalone exports.
  app.use(createSitesRouter());

  // 404
  app.use((req, res) => res.status(404).render('error', { message: 'Page not found.', status: 404 }));

  // Errors
  app.use((err, req, res, next) => {
    if (req.path === '/mcp' && (err instanceof SyntaxError || err.type === 'entity.parse.failed')) {
      return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }
    if (req.path === '/mcp' && err.type === 'entity.too.large') {
      return res.status(413).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } });
    }
    console.error('[cascade]', err?.message || err);
    const bad = err instanceof multer.MulterError;
    const status = bad ? 400 : 500;
    if (req.path.startsWith('/api/') || req.path === '/mcp') {
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
  const server = app.listen(config.port, config.host, () => {
    console.log(`[cascade] main server on http://${config.host}:${config.port}`);
    console.log(`[cascade] sqlite database at ${path.resolve(config.dbPath)}`);
  });
  startCollabServer(server);
  return server;
}
