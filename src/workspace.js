import express from 'express';
import { nanoid } from 'nanoid';
import { v4 as uuid } from 'uuid';
import { Op } from 'sequelize';
import {
  FileRecord,
  Folder,
  DocVersion,
  Template,
  FormResponse,
  Collaborator,
  ShareLink,
  CommentThread,
  CollabRoom,
  SiteDeployment,
  User,
  AnalyticsEvent,
  sequelize,
} from './db.js';
import { requireLogin, requireAdmin } from './auth.js';
import {
  accessFor,
  loadAccessibleFile,
  accessByShareToken,
  normalizeRole,
  roleAtLeast,
  validInvitee,
  collaboratorJson,
} from './access.js';
import { KINDS, CATEGORIES, TEMPLATES, buildContent, templatesFor, getTemplate, KIND_BY_ID } from './templates.js';
import { templatePreviewDocument } from './templatePreview.js';
import { issueCollabToken, closeUserSockets, closeShareSockets } from './collab.js';
import { recordEvent } from './analytics.js';
import { computeSheet } from './formula.js';
import { allowFormSubmission } from './formRateLimit.js';
import { buildPdfTemplate } from './pdfTemplates.js';
import { readFileWithFallback } from './storage.js';
import { docToDocx, sheetToXlsx, deckToPptx, inlineImageSource } from './office.js';
import { PDFDocument as ServerPDF, StandardFonts, rgb } from 'pdf-lib';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_CONTENT = 12 * 1024 * 1024; // editor JSON per document (PDFs are base64)

// In-memory presence: fileId -> userId -> { username, at }
const presence = new Map();
function touchPresence(fileId, user) {
  if (!presence.has(fileId)) presence.set(fileId, new Map());
  presence.get(fileId).set(user.id, { username: user.username, at: Date.now() });
  return viewersOf(fileId);
}
function viewersOf(fileId) {
  const room = presence.get(fileId);
  if (!room) return [];
  const cutoff = Date.now() - 25000;
  for (const [uid, v] of room) if (v.at < cutoff) room.delete(uid);
  return [...room.values()].map((v) => v.username);
}

async function loadDoc(id, user, minimum = 'viewer') {
  const { file, role } = await loadAccessibleFile(id, user, minimum);
  if (!file || file.kind === 'file' || !role || !roleAtLeast(role, minimum)) return null;
  file.accessRole = role;
  return file;
}

function parseContent(file) {
  try {
    return JSON.parse(file.content || '{}');
  } catch {
    return {};
  }
}

// Capability/public asset URLs must be scoped to images actually referenced by
// that document. Knowing an unrelated owner's image id is not authorization.
function contentReferencesImage(content, id) {
  const raw = String(content || '');
  const assetId = String(id || '');
  return !!assetId && (raw.includes(`/f/${assetId}/raw`) || raw.includes(`/asset/${assetId}`));
}

function defaultName(kind) {
  const label = KIND_BY_ID.get(kind)?.label || 'Document';
  const d = new Date();
  return `${label} ${d.toISOString().slice(0, 10)}`;
}

// Resolve an image reference stored in editor content. Only images owned by
// the document owner (or already public images) can be embedded in exports.
async function resolveDocImage(src, ownerId) {
  const value = String(src || '');
  const data = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (data) {
    return { mime: data[1].toLowerCase(), buffer: Buffer.from(data[2].replace(/\s+/g, ''), 'base64') };
  }
  let pathname = value;
  try {
    pathname = new URL(value, 'http://local').pathname;
  } catch {
    return null;
  }
  const local = /^\/f\/([A-Za-z0-9_-]+)\/raw$/.exec(pathname);
  if (local) {
    const img = await FileRecord.findByPk(local[1]);
    if (!img || !String(img.mime || '').startsWith('image/')) return null;
    if (img.ownerId !== ownerId) return null;
    const { buffer } = await readFileWithFallback(img);
    return { mime: img.mime, buffer };
  }
  const pub = /^\/raw\/([A-Za-z0-9_-]+)$/.exec(pathname);
  if (pub) {
    const img = await FileRecord.findOne({ where: { slug: pub[1], isPublic: true } });
    if (!img || img.kind !== 'file' || !String(img.mime || '').startsWith('image/')) return null;
    const { buffer } = await readFileWithFallback(img);
    return { mime: img.mime, buffer };
  }
  return null;
}

async function snapshot(file, userId) {
  await DocVersion.create({
    fileId: file.id,
    version: file.version,
    content: file.content || '{}',
    createdBy: userId || null,
  });
  // keep the newest 25 snapshots per document
  const old = await DocVersion.findAll({
    where: { fileId: file.id },
    order: [['id', 'DESC']],
    offset: 25,
    attributes: ['id'],
  });
  if (old.length) await DocVersion.destroy({ where: { id: { [Op.in]: old.map((o) => o.id) } } });
}

// --- export renderers -------------------------------------------------------
const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Colors and geometry end up inside SVG/CSS attributes. Never interpolate raw
// editor values there: only a small color grammar and finite numbers are safe.
const safeColor = (value, fallback = '#ffffff') => {
  const v = String(value || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i.test(v)) return v;
  return fallback;
};
const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

async function deckToHtml(file, content) {
  const slides = content.slides || [];
  const imageCache = new Map();
  for (const s of slides) {
    for (const e of s.elements || []) {
      if (e.type === 'image' && e.src && !imageCache.has(e.src)) {
        imageCache.set(e.src, await inlineImageSource(e.src, (src) => resolveDocImage(src, file.ownerId)));
      }
    }
  }
  const el = (e) => {
    const x = finite(e.x);
    const y = finite(e.y);
    const w = Math.max(1, finite(e.w, 1));
    const h = Math.max(1, finite(e.h, 1));
    if (e.type === 'text') {
      const align = ['left', 'center', 'right'].includes(e.align) ? e.align : 'left';
      return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;color:${safeColor(e.color)};font-size:${Math.max(1, finite(e.size, 28))}px;font-weight:${e.bold ? 700 : 400};text-align:${align};white-space:pre-wrap">${escapeHtml(e.text)}</div>`;
    }
    if (e.type === 'rect') {
      return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${safeColor(e.fill, '#e11d48')}"></div>`;
    }
    if (e.type === 'image') {
      const src = imageCache.get(e.src) || e.src;
      return `<img src="${escapeHtml(src)}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;object-fit:cover" alt="${escapeHtml(e.alt || '')}" />`;
    }
    return '';
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(file.filename)}</title>
<style>
  body { margin: 0; background: #111; font-family: Inter, system-ui, sans-serif; }
  .slide { position: relative; width: ${Math.max(1, finite(content.w, 1280))}px; height: ${Math.max(1, finite(content.h, 720))}px; margin: 20px auto; overflow: hidden; page-break-after: always; }
  @media print { body { background: #fff; } .slide { margin: 0; } }
  .notes { color: #aaa; font-size: 13px; max-width: 1280px; margin: 0 auto 30px; font-family: system-ui; }
</style></head><body>
${slides.map((s) => `<section class="slide" style="background:${safeColor(s.bg, '#101014')}">${(s.elements || []).map(el).join('')}</section>${s.notes ? `<p class="notes">Notes: ${escapeHtml(s.notes)}</p>` : ''}`).join('\n')}
</body></html>`;
}

function boardToSvg(file, content) {
  const els = content.elements || [];
  let minX = 0, minY = 0, maxX = 1200, maxY = 800;
  const consider = (x, y) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const e of els) {
    if (e.type === 'path') for (const p of e.points || []) consider(p[0], p[1]);
    else consider(e.x || 0, e.y || 0), consider((e.x || 0) + (e.w || 0), (e.y || 0) + (e.h || 0));
  }
  const pad = 60;
  const parts = els.map((e) => {
    const x = finite(e.x);
    const y = finite(e.y);
    const w = Math.max(1, finite(e.w, 1));
    const h = Math.max(1, finite(e.h, 1));
    if (e.type === 'path') {
      const pts = (Array.isArray(e.points) ? e.points : []).map((p) => `${finite(p?.[0])},${finite(p?.[1])}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${safeColor(e.color)}" stroke-width="${Math.max(0, finite(e.width, 3))}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if (e.type === 'rect') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${safeColor(e.color, '#27272a')}"/>`;
    if (e.type === 'ellipse') return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${safeColor(e.color, '#27272a')}"/>`;
    if (e.type === 'sticky') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${safeColor(e.color, '#fde68a')}"/><foreignObject x="${x + 10}" y="${y + 10}" width="${Math.max(1, w - 20)}" height="${Math.max(1, h - 20)}"><div xmlns="http://www.w3.org/1999/xhtml" style="font:14px system-ui;color:#111">${escapeHtml(e.text)}</div></foreignObject>`;
    if (e.type === 'text') return `<text x="${x}" y="${y + Math.max(1, finite(e.size, 20))}" fill="${safeColor(e.color)}" font-size="${Math.max(1, finite(e.size, 20))}" font-family="system-ui">${escapeHtml(e.text)}</text>`;
    return '';
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${Math.max(1, maxX - minX + pad * 2)} ${Math.max(1, maxY - minY + pad * 2)}" width="1200" style="background:#101014"><rect x="${minX - pad}" y="${minY - pad}" width="100%" height="100%" fill="#101014"/>${parts.join('')}</svg>`;
}

function toCsv(rows) {
  return rows
    .map((r) => r.map((v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))).join(','))
    .join('\n');
}

function validateForm(content, body) {
  const data = {};
  const errors = {};
  for (const f of content.fields || []) {
    const raw = body[f.id];
    if (f.type === 'checkbox') {
      const allowed = new Set((f.options || []).map((o) => String(o)));
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => String(v).trim()).filter((v) => allowed.has(v)).slice(0, 50);
      data[f.id] = list;
      if (f.required && !list.length) errors[f.id] = 'Please pick at least one option.';
      continue;
    }
    const val = String(raw ?? '').trim();
    const max = f.type === 'email' ? 180 : 4000;
    data[f.id] = val.slice(0, max);
    if (val.length > max) errors[f.id] = `Keep this answer under ${max} characters.`;
    else if (f.required && !val) errors[f.id] = 'This field is required.';
    else if (val && f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) errors[f.id] = 'Enter a valid email address.';
    else if (val && f.type === 'number' && Number.isNaN(Number(val))) errors[f.id] = 'Enter a number.';
    else if (val && (f.type === 'select' || f.type === 'radio') && !(f.options || []).includes(val)) errors[f.id] = 'Pick one of the options.';
  }
  return { data, errors };
}

export function createWorkspaceRouter() {
  const r = express.Router();

  // ---------- Create page ----------
  r.get('/create', requireLogin, wrap(async (req, res) => {
    const [folders, recents, customTemplates] = await Promise.all([
      Folder.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'DESC']] }),
      FileRecord.findAll({
        where: { ownerId: req.user.id, kind: { [Op.ne]: 'file' } },
        order: [['updatedAt', 'DESC']],
        limit: 8,
      }),
      Template.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'DESC']] }),
    ]);
    res.render('create', {
      kinds: KINDS,
      categories: CATEGORIES,
      // strip builder functions before handing templates to the view
      templates: TEMPLATES.map(({ build, ...rest }) => rest),
      folders,
      recents,
      customTemplates,
      kindParam: KIND_BY_ID.has(req.query.kind) ? req.query.kind : null,
    });
  }));

  // ---------- Real template previews (rendered from actual template content) ----------
  r.get('/template-preview/:id', requireLogin, wrap(async (req, res) => {
    const raw = String(req.params.id || '');
    let kind = null;
    let content = null;
    let title = 'Template preview';
    if (raw.startsWith('custom:')) {
      const tpl = await Template.findByPk(raw.slice(7));
      if (!tpl || tpl.ownerId !== req.user.id) return res.status(404).send('not found');
      kind = tpl.kind;
      title = tpl.name;
      content = JSON.parse(tpl.content || '{}');
    } else {
      const tpl = getTemplate(raw);
      if (!tpl) return res.status(404).send('not found');
      kind = tpl.kind;
      title = tpl.name;
      content = kind === 'pdf' ? await buildPdfTemplate(raw) : tpl.build();
    }
    if (kind === 'pdf') {
      const bytes = Buffer.from(String(content?.pdf || ''), 'base64');
      if (bytes.slice(0, 5).toString() !== '%PDF-') return res.status(404).send('not found');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; object-src 'none'; frame-src 'none'");
      return res.send(bytes);
    }
    const html = templatePreviewDocument({ kind, content, title, theme: req.settings });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'self'");
    res.send(html);
  }));

  // ---------- Editor shell ----------
  r.get('/edit/:id', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user);
    if (!file) return res.status(404).render('error', { message: 'Document not found.', status: 404 });
    if (file.kind === 'roblox') return res.redirect(`/studio/roblox/${file.id}`);
    if (!KIND_BY_ID.has(file.kind)) return res.status(400).render('error', { message: 'Unknown document type.', status: 400 });
    const content = parseContent(file);
    res.render(`editors/${file.kind}`, {
      file,
      content,
      kinds: KINDS,
      kind: KIND_BY_ID.get(file.kind),
      accessRole: file.accessRole,
      canEdit: roleAtLeast(file.accessRole, 'editor'),
    });
  }));

  // ---------- Create a document ----------
  r.post('/api/workspace/docs', requireLogin, wrap(async (req, res) => {
    const { kind, templateId, name, folderId, isPublic } = req.body || {};
    if (!KIND_BY_ID.has(kind)) return res.status(400).json({ error: 'unknown kind' });
    if (isPublic !== undefined && typeof isPublic !== 'boolean') {
      return res.status(400).json({ error: 'isPublic must be a boolean' });
    }

    let content = null;
    let templateName = null;
    if (templateId && String(templateId).startsWith('custom:')) {
      const tpl = await Template.findByPk(String(templateId).slice(7));
      if (tpl && tpl.ownerId === req.user.id && tpl.kind === kind) {
        content = JSON.parse(tpl.content);
        templateName = tpl.name;
      }
    } else if (kind === 'pdf') {
      content = await buildPdfTemplate(String(templateId || 'pdf-blank'));
      templateName = templateId ? String(templateId) : 'pdf-blank';
    } else if (templateId) {
      content = buildContent(String(templateId), kind);
      templateName = templateId;
    }
    if (!content) content = kind === 'pdf' ? await buildPdfTemplate('pdf-blank') : buildContent(null, kind);

    let folder = null;
    if (folderId) {
      folder = await Folder.findOne({ where: { id: folderId, ownerId: req.user.id } });
    }

    const filename = String(name || '').trim().slice(0, 120) || (templateName ? `${templateName}` : defaultName(kind));
    const serialized = JSON.stringify(content);
    const file = await FileRecord.create({
      id: nanoid(12),
      slug: nanoid(10),
      filename,
      mime: `application/x-cascade-${kind}`,
      size: Buffer.byteLength(serialized),
      ownerId: req.user.id,
      ownerName: req.user.username,
      isPublic: isPublic === true,
      replicas: [],
      content: serialized,
      kind,
      folderId: folder ? folder.id : null,
      template: templateId ? String(templateId) : null,
      version: 1,
    });
    await snapshot(file, req.user.id);
    recordEvent(req, 'create', { fileId: file.id });
    res.json({ ok: true, id: file.id, url: kind === 'roblox' ? `/studio/roblox/${file.id}` : `/edit/${file.id}` });
  }));

  // ---------- Folders ----------
  r.post('/api/workspace/folders', requireLogin, wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'name required' });
    const folder = await Folder.create({ id: uuid(), name, ownerId: req.user.id });
    res.json({ ok: true, folder: { id: folder.id, name: folder.name } });
  }));

  // ---------- Load / save ----------
  r.get('/api/workspace/docs/:id', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user);
    if (!file) return res.status(404).json({ error: 'not found' });
    touchPresence(file.id, req.user);
    const payload = {
      ok: true,
      id: file.id,
      filename: file.filename,
      kind: file.kind,
      version: file.version,
      isPublic: !!file.isPublic,
      slug: file.slug,
      folderId: file.folderId,
      updatedAt: file.updatedAt,
      content: parseContent(file),
      viewers: viewersOf(file.id),
      exportUrl: `/export/${file.id}`,
      downloadUrl: `/download/${file.id}`,
    };
    if (file.kind === 'form') payload.responses = await FormResponse.count({ where: { fileId: file.id } });
    res.json(payload);
  }));

  r.put('/api/workspace/docs/:id', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const body = req.body || {};
    const serialized = JSON.stringify(body.content ?? {});
    if (Buffer.byteLength(serialized) > MAX_CONTENT) return res.status(413).json({ error: 'document too large' });
    const incomingVersion = Number(body.version) || 0;
    if (!body.force && incomingVersion && incomingVersion !== file.version) {
      return res.status(409).json({
        error: 'conflict',
        version: file.version,
        content: parseContent(file),
        updatedAt: file.updatedAt,
      });
    }
    const changed = serialized !== (file.content || '');
    if (changed) {
      await snapshot(file, req.user.id);
      await file.update({
        content: serialized,
        size: Buffer.byteLength(serialized),
        version: file.version + 1,
        updatedAt: new Date(),
      });
      recordEvent(req, 'edit', { fileId: file.id });
    }
    touchPresence(file.id, req.user);
    res.json({ ok: true, version: file.version, updatedAt: file.updatedAt, changed, viewers: viewersOf(file.id) });
  }));

  // ---------- Presence heartbeat ----------
  r.post('/api/workspace/docs/:id/heartbeat', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user);
    if (!file) return res.status(404).json({ error: 'not found' });
    touchPresence(file.id, req.user);
    res.json({ ok: true, viewers: viewersOf(file.id) });
  }));

  // ---------- Version history ----------
  r.get('/api/workspace/docs/:id/versions', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user);
    if (!file) return res.status(404).json({ error: 'not found' });
    const versions = await DocVersion.findAll({
      where: { fileId: file.id },
      order: [['id', 'DESC']],
      limit: 25,
      attributes: ['version', 'createdAt', 'createdBy'],
    });
    res.json({ ok: true, current: file.version, versions });
  }));

  r.get('/api/workspace/docs/:id/versions/:version', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user);
    if (!file) return res.status(404).json({ error: 'not found' });
    const snap = await DocVersion.findOne({
      where: { fileId: file.id, version: Number(req.params.version) },
      order: [['id', 'DESC']],
    });
    if (!snap) return res.status(404).json({ error: 'version not found' });
    res.json({ ok: true, version: snap.version, content: JSON.parse(snap.content) });
  }));

  r.post('/api/workspace/docs/:id/restore', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const snap = await DocVersion.findOne({
      where: { fileId: file.id, version: Number(req.body?.version) },
      order: [['id', 'DESC']],
    });
    if (!snap) return res.status(404).json({ error: 'version not found' });
    await snapshot(file, req.user.id);
    await file.update({ content: snap.content, version: file.version + 1, size: Buffer.byteLength(snap.content), updatedAt: new Date() });
    res.json({ ok: true, version: file.version, content: JSON.parse(snap.content) });
  }));

  // ---------- Save current document as a personal template ----------
  r.post('/api/workspace/docs/:id/template', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const name = String(req.body?.name || file.filename).trim().slice(0, 80) || file.filename;
    const tpl = await Template.create({
      id: uuid(),
      name,
      kind: file.kind,
      category: 'custom',
      content: file.content || '{}',
      ownerId: req.user.id,
    });
    res.json({ ok: true, template: { id: `custom:${tpl.id}`, name: tpl.name, kind: tpl.kind } });
  }));

  r.get('/api/workspace/docs/:id/collab-token', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'viewer');
    if (!file) return res.status(404).json({ error: 'not found' });
    const token = issueCollabToken({ fileId: file.id, user: req.user, role: file.accessRole });
    res.json({ ok: true, token, role: file.accessRole, canEdit: roleAtLeast(file.accessRole, 'editor'), canComment: roleAtLeast(file.accessRole, 'commenter') });
  }));

  // ---------- Sharing, roles and comments ----------
  async function ownedFile(req) {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file) return null;
    const role = await accessFor(file, req.user);
    return role === 'owner' ? file : null;
  }

  r.get('/api/files/:id/access', requireLogin, wrap(async (req, res) => {
    const file = await FileRecord.findByPk(req.params.id);
    if (!file) return res.status(404).json({ error: 'not found' });
    const role = await accessFor(file, req.user);
    if (!role) return res.status(403).json({ error: 'forbidden' });
    const owner = await User.findByPk(file.ownerId);
    const people = await Collaborator.findAll({ where: { fileId: file.id }, order: [['createdAt', 'ASC']] });
    const links = role === 'owner'
      ? await ShareLink.findAll({ where: { fileId: file.id, revokedAt: null }, order: [['createdAt', 'DESC']] })
      : [];
    res.json({
      ok: true,
      role,
      canEdit: roleAtLeast(role, 'editor'),
      canComment: roleAtLeast(role, 'commenter'),
      isPublic: !!file.isPublic,
      slug: file.slug,
      filename: file.filename,
      owner: owner ? { username: owner.username } : { username: file.ownerName },
      collaborators: people.map(collaboratorJson),
      links: links.map((l) => ({ id: l.id, token: l.token, role: normalizeRole(l.role), expiresAt: l.expiresAt, createdAt: l.createdAt })),
    });
  }));

  r.post('/api/files/:id/collaborators', requireLogin, wrap(async (req, res) => {
    const file = await ownedFile(req);
    if (!file) return res.status(404).json({ error: 'not found' });
    const who = validInvitee(req.body?.invitee);
    if (!who) return res.status(400).json({ error: 'Enter a username or email address' });
    const role = normalizeRole(req.body?.role);
    let user = null;
    if (who.username) {
      user = await User.findOne({ where: sequelize.where(sequelize.fn('lower', sequelize.col('username')), who.username) });
    }
    if (!user && !who.email) return res.status(404).json({ error: 'No account with that username' });
    if (user && user.id === file.ownerId) return res.status(400).json({ error: 'The owner already has full access' });
    const existing = user
      ? await Collaborator.findOne({ where: { fileId: file.id, userId: user.id } })
      : await Collaborator.findOne({ where: { fileId: file.id, email: who.email } });
    if (existing) {
      await existing.update({ role, username: user?.username?.toLowerCase() || existing.username, email: who.email || existing.email });
      return res.json({ ok: true, collaborator: collaboratorJson(existing), existing: true });
    }
    const row = await Collaborator.create({
      id: uuid(),
      fileId: file.id,
      userId: user?.id || null,
      username: user?.username?.toLowerCase() || who.username,
      email: who.email,
      role,
      invitedBy: req.user.id,
    });
    // Local accounts do not have an email column. For an email address that is
    // not a username, create a capability link the owner can send directly.
    let inviteUrl = null;
    if (!user && who.email) {
      const link = await ShareLink.create({
        id: uuid(),
        fileId: file.id,
        token: nanoid(28),
        role,
        createdBy: req.user.id,
        expiresAt: new Date(Date.now() + 30 * 86400000),
      });
      inviteUrl = `/s/${link.token}`;
    }
    res.status(201).json({ ok: true, collaborator: collaboratorJson(row), inviteUrl });
  }));

  r.patch('/api/files/:id/collaborators/:collabId', requireLogin, wrap(async (req, res) => {
    const file = await ownedFile(req);
    if (!file) return res.status(404).json({ error: 'not found' });
    const row = await Collaborator.findOne({ where: { id: req.params.collabId, fileId: file.id } });
    if (!row) return res.status(404).json({ error: 'not found' });
    await row.update({ role: normalizeRole(req.body?.role) });
    // A demotion must take effect in the live room immediately.
    if (row.userId) closeUserSockets(file.id, row.userId);
    res.json({ ok: true, collaborator: collaboratorJson(row) });
  }));

  r.delete('/api/files/:id/collaborators/:collabId', requireLogin, wrap(async (req, res) => {
    const file = await ownedFile(req);
    if (!file) return res.status(404).json({ error: 'not found' });
    const row = await Collaborator.findOne({ where: { id: req.params.collabId, fileId: file.id } });
    await Collaborator.destroy({ where: { id: req.params.collabId, fileId: file.id } });
    if (row?.userId) closeUserSockets(file.id, row.userId);
    res.json({ ok: true });
  }));

  r.post('/api/files/:id/share-links', requireLogin, wrap(async (req, res) => {
    const file = await ownedFile(req);
    if (!file) return res.status(404).json({ error: 'not found' });
    const hours = Math.min(24 * 365, Math.max(1, Number(req.body?.expiresInHours) || 24 * 7));
    const link = await ShareLink.create({
      id: uuid(),
      fileId: file.id,
      token: nanoid(28),
      role: normalizeRole(req.body?.role),
      createdBy: req.user.id,
      expiresAt: new Date(Date.now() + hours * 3600 * 1000),
    });
    res.status(201).json({ ok: true, link: { id: link.id, token: link.token, role: link.role, expiresAt: link.expiresAt } });
  }));

  r.delete('/api/files/:id/share-links/:linkId', requireLogin, wrap(async (req, res) => {
    const file = await ownedFile(req);
    if (!file) return res.status(404).json({ error: 'not found' });
    const link = await ShareLink.findOne({ where: { id: req.params.linkId, fileId: file.id } });
    await ShareLink.update({ revokedAt: new Date() }, { where: { id: req.params.linkId, fileId: file.id } });
    if (link) closeShareSockets(file.id, link.token);
    res.json({ ok: true });
  }));

  // A capability link renders the same editor shell read-only (or editable for
  // editor links) without exposing the file to people who do not hold the token.
  r.get('/s/:token', wrap(async (req, res) => {
    const hit = await accessByShareToken(req.params.token);
    if (!hit || hit.file.kind === 'file' || !KIND_BY_ID.has(hit.file.kind)) {
      return res.status(404).render('error', { message: 'This share link is invalid or has expired.', status: 404 });
    }
    const file = hit.file;
    file.accessRole = hit.role;
    res.render(`editors/${file.kind}`, {
      file,
      content: parseContent(file),
      kinds: KINDS,
      kind: KIND_BY_ID.get(file.kind),
      accessRole: 'viewer',
      canEdit: false,
      shareToken: req.params.token,
      shareMode: true,
      collabToken: issueCollabToken({
        fileId: file.id,
        role: 'viewer',
        name: 'Guest',
        shareToken: req.params.token,
      }),
    });
  }));

  r.get('/s/:token/asset/:id', wrap(async (req, res) => {
    const hit = await accessByShareToken(req.params.token);
    if (!hit || !contentReferencesImage(hit.file.content, req.params.id)) return res.status(404).send('not found');
    const img = await FileRecord.findByPk(req.params.id);
    if (!img || img.kind !== 'file' || img.ownerId !== hit.file.ownerId || !String(img.mime || '').startsWith('image/')) {
      return res.status(404).send('not found');
    }
    const { buffer } = await readFileWithFallback(img);
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  }));

  r.get('/api/workspace/docs/:id/comments', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'viewer');
    if (!file) return res.status(404).json({ error: 'not found' });
    const rows = await CommentThread.findAll({ where: { fileId: file.id }, order: [['createdAt', 'ASC']] });
    res.json({ ok: true, role: file.accessRole, comments: rows });
  }));

  r.post('/api/workspace/docs/:id/comments', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'commenter');
    if (!file) return res.status(404).json({ error: 'not found' });
    const body = String(req.body?.body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: 'comment required' });
    let parent = null;
    if (req.body?.parentId) {
      parent = await CommentThread.findOne({ where: { id: String(req.body.parentId), fileId: file.id } });
      if (!parent) return res.status(404).json({ error: 'thread not found' });
    }
    const mentions = [...body.matchAll(/(?:^|\s)@([a-z0-9_.-]{2,64})/gi)].map((m) => m[1].toLowerCase()).slice(0, 20);
    const row = await CommentThread.create({
      id: uuid(),
      fileId: file.id,
      parentId: parent?.id || null,
      userId: req.user.id,
      authorName: req.user.username,
      body,
      anchor: req.body?.anchor && typeof req.body.anchor === 'object' ? req.body.anchor : null,
      mentions,
    });
    res.status(201).json({ ok: true, comment: row });
  }));

  r.patch('/api/comments/:id', requireLogin, wrap(async (req, res) => {
    const row = await CommentThread.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const file = await FileRecord.findByPk(row.fileId);
    const role = await accessFor(file, req.user);
    if (!role || (row.userId !== req.user.id && role !== 'owner')) return res.status(403).json({ error: 'forbidden' });
    const patch = {};
    if (req.body?.resolved !== undefined) patch.resolved = !!req.body.resolved;
    if (typeof req.body?.body === 'string') {
      const body = req.body.body.trim().slice(0, 4000);
      if (!body) return res.status(400).json({ error: 'comment required' });
      patch.body = body;
    }
    await row.update(patch);
    res.json({ ok: true, comment: row });
  }));

  r.delete('/api/comments/:id', requireLogin, wrap(async (req, res) => {
    const row = await CommentThread.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const file = await FileRecord.findByPk(row.fileId);
    const role = await accessFor(file, req.user);
    if (!role || (row.userId !== req.user.id && role !== 'owner')) return res.status(403).json({ error: 'forbidden' });
    await CommentThread.destroy({ where: { id: row.id } });
    await CommentThread.destroy({ where: { parentId: row.id } });
    res.json({ ok: true });
  }));

  // ---------- Website publishing ----------
  r.post('/api/workspace/docs/:id/publish', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    if (file.kind !== 'site') return res.status(400).json({ error: 'only websites can be published' });
    const body = req.body || {};
    if (body.content && typeof body.content === 'object') {
      const serialized = JSON.stringify(body.content);
      if (Buffer.byteLength(serialized) > MAX_CONTENT) return res.status(413).json({ error: 'document too large' });
      if (serialized !== (file.content || '')) {
        await snapshot(file, req.user.id);
        await file.update({ content: serialized, size: Buffer.byteLength(serialized), version: file.version + 1, updatedAt: new Date() });
      }
    }
    const customRaw = String(body.customDomain || '').trim().toLowerCase();
    if (customRaw) {
      if (!/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(customRaw)) {
        return res.status(400).json({ error: 'Enter a domain such as www.example.com' });
      }
      const taken = await FileRecord.findOne({ where: { customDomain: customRaw, kind: 'site' } });
      if (taken && taken.id !== file.id) return res.status(409).json({ error: 'That domain is already connected to another site' });
    }
    const content = parseContent(file);
    await file.update({
      isPublic: true,
      publishedAt: new Date(),
      siteTitle: String(content?.seo?.title || content?.brand || file.filename).slice(0, 180),
      customDomain: customRaw || null,
    });
    await SiteDeployment.create({
      id: uuid(),
      fileId: file.id,
      environment: 'production',
      version: file.version,
      content: file.content,
      label: String(body.label || `Production v${file.version}`).slice(0, 160),
      createdBy: req.user.id,
    });
    recordEvent(req, 'share', { fileId: file.id });
    res.json({
      ok: true,
      publishedAt: file.publishedAt,
      url: `/sites/${file.slug}`,
      slug: file.slug,
      customDomain: file.customDomain || null,
      version: file.version,
    });
  }));

  r.post('/api/workspace/docs/:id/unpublish', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    await file.update({ isPublic: false, publishedAt: null });
    res.json({ ok: true });
  }));

  r.get('/api/workspace/docs/:id/site-stats', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'editor');
    if (!file || file.kind !== 'site') return res.status(404).json({ error: 'not found' });
    const [views, submissions] = await Promise.all([
      AnalyticsEvent.count({ where: { fileId: file.id, type: 'view' } }),
      FormResponse.count({ where: { fileId: file.id } }),
    ]);
    res.json({ ok: true, views, submissions, publishedAt: file.publishedAt, slug: file.slug, customDomain: file.customDomain });
  }));

  // ---------- Create a new PDF from pages split out of an editor ----------
  r.post('/api/workspace/pdf', requireLogin, wrap(async (req, res) => {
    const name = String(req.body?.name || 'Split document').trim().slice(0, 120) || 'Split document';
    const raw = String(req.body?.pdf || '');
    if (!raw) return res.status(400).json({ error: 'pdf required' });
    const bytes = Buffer.from(raw, 'base64');
    if (bytes.slice(0, 5).toString() !== '%PDF-') return res.status(400).json({ error: 'invalid pdf' });
    if (bytes.length > MAX_CONTENT) return res.status(413).json({ error: 'pdf too large' });
    try {
      await ServerPDF.load(bytes);
    } catch {
      return res.status(400).json({ error: 'invalid pdf' });
    }
    const content = { pdf: raw };
    const serialized = JSON.stringify(content);
    const file = await FileRecord.create({
      id: nanoid(12),
      slug: nanoid(10),
      filename: name.replace(/\.pdf$/i, ''),
      mime: 'application/x-cascade-pdf',
      size: Buffer.byteLength(serialized),
      ownerId: req.user.id,
      ownerName: req.user.username,
      isPublic: false,
      replicas: [],
      content: serialized,
      kind: 'pdf',
      folderId: null,
      template: null,
      version: 1,
    });
    await snapshot(file, req.user.id);
    recordEvent(req, 'create', { fileId: file.id });
    res.json({ ok: true, id: file.id, url: `/edit/${file.id}` });
  }));

  // ---------- PDF rendering / export ----------
  const hexColor = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return rgb(0.98, 0.8, 0.08);
    const n = parseInt(m[1], 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };

  function wrapPdfText(text, maxWidth, font, size) {
    const lines = [];
    for (const paragraph of String(text || '').split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      lines.push(line);
    }
    return lines;
  }

  // Burn highlights, text overlays, notes, signatures and placed images into a real PDF.
  async function renderPdfBuffer(content, ownerId) {
    const bytes = Buffer.from(String(content.pdf || ''), 'base64');
    const doc = await ServerPDF.load(bytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const signatures = new Map();
    const images = new Map();

    for (const a of content.annotations || []) {
      const page = pages[(Number(a.page) || 1) - 1];
      if (!page) continue;
      const color = hexColor(a.color);
      if (a.type === 'highlight') {
        page.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color, opacity: 0.35 });
      } else if (a.type === 'text') {
        const size = Number(a.fontSize) || 14;
        wrapPdfText(a.text, Math.max(40, a.w || 240), font, size).forEach((line, i) => {
          page.drawText(line, { x: a.x, y: a.y + a.h - size - i * size * 1.25, size, font, color });
        });
      } else if (a.type === 'note') {
        page.drawRectangle({ x: a.x, y: a.y + a.h - 14, width: 14, height: 14, color, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.6 });
        const lines = wrapPdfText(a.text, 180, font, 8);
        const boxH = lines.length * 10 + 8;
        page.drawRectangle({
          x: a.x,
          y: a.y + a.h - 14 - boxH - 2,
          width: 190,
          height: boxH,
          color: rgb(1, 1, 0.92),
          borderColor: color,
          borderWidth: 0.6,
          opacity: 0.95,
        });
        lines.forEach((line, i) => {
          page.drawText(line, { x: a.x + 4, y: a.y + a.h - 24 - i * 10, size: 8, font, color: rgb(0.15, 0.15, 0.15) });
        });
      } else if (a.type === 'signature') {
        const sig = (content.signatures || []).find((s) => s.id === a.signatureId);
        if (!sig || !sig.dataUrl) continue;
        if (!signatures.has(sig.id)) {
          const raw = sig.dataUrl.split(',')[1] || '';
          const img = sig.dataUrl.startsWith('data:image/jpeg')
            ? await doc.embedJpg(Buffer.from(raw, 'base64'))
            : await doc.embedPng(Buffer.from(raw, 'base64'));
          signatures.set(sig.id, img);
        }
        page.drawImage(signatures.get(sig.id), { x: a.x, y: a.y, width: a.w, height: a.h });
      } else if (a.type === 'image') {
        const src = String(a.src || '');
        if (!src) continue;
        if (!images.has(src)) images.set(src, await resolveDocImage(src, ownerId));
        const resolved = images.get(src);
        if (!resolved || !resolved.buffer?.length) continue;
        const mime = String(resolved.mime || '').toLowerCase();
        if (mime !== 'image/png' && mime !== 'image/jpeg') continue;
        const embedded = mime === 'image/jpeg' ? await doc.embedJpg(resolved.buffer) : await doc.embedPng(resolved.buffer);
        page.drawImage(embedded, {
          x: finite(a.x),
          y: finite(a.y),
          width: Math.max(1, finite(a.w, 100)),
          height: Math.max(1, finite(a.h, 100)),
        });
      }
    }
    return Buffer.from(await doc.save());
  }

  // ---------- Export ----------
  async function exportPayload(file) {
    const content = parseContent(file);
    const base = String(file.filename || 'document').replace(/[^\w.-]+/g, '-').replace(/\.pdf$/i, '');
    const resolveImage = (src) => resolveDocImage(src, file.ownerId);
    if (file.kind === 'doc') {
      return {
        body: await docToDocx(file, content, resolveImage),
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: `${base}.docx`,
      };
    }
    if (file.kind === 'sheet') {
      return {
        body: await sheetToXlsx(content, resolveImage),
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `${base}.xlsx`,
      };
    }
    if (file.kind === 'deck') {
      return {
        body: await deckToPptx(file, content, resolveImage),
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        filename: `${base}.pptx`,
      };
    }
    if (file.kind === 'board') return { body: boardToSvg(file, content), type: 'image/svg+xml; charset=utf-8', filename: `${base}.svg` };
    if (file.kind === 'pdf') return { body: await renderPdfBuffer(content, file.ownerId), type: 'application/pdf', filename: `${base}.pdf` };
    if (file.kind === 'code') {
      const active = (content.files || [])[content.active || 0] || (content.files || [])[0];
      const safe = (active?.name || 'file.txt').replace(/[^\w.-]+/g, '-');
      return { body: active?.text || '', type: 'text/plain; charset=utf-8', filename: safe };
    }
    if (file.kind === 'form') {
      return { body: JSON.stringify(content, null, 2), type: 'application/json; charset=utf-8', filename: `${base}.json` };
    }
    return { body: JSON.stringify(content, null, 2), type: 'application/json; charset=utf-8', filename: `${base}.json` };
  }

  r.get('/export/:id', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'viewer');
    if (!file) return res.status(404).send('not found');
    const out = await exportPayload(file);
    res.setHeader('Content-Type', out.type);
    res.setHeader('Cache-Control', 'private, no-store');
    if (out.type.startsWith('image/svg+xml')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    res.send(out.body);
  }));

  r.get('/download/:id', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user, 'viewer');
    if (!file) return res.status(404).send('not found');
    const out = await exportPayload(file);
    res.setHeader('Content-Type', out.type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(out.filename)}"`);
    if (out.type.startsWith('image/svg+xml')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    res.send(out.body);
  }));

  // Public image assets referenced by a shared document. A document can only
  // expose images uploaded by its own owner.
  r.get('/c/:slug/asset/:id', wrap(async (req, res) => {
    const doc = await FileRecord.findOne({ where: { slug: req.params.slug, isPublic: true } });
    if (!doc || doc.kind === 'file' || !contentReferencesImage(doc.content, req.params.id)) return res.status(404).send('not found');
    const img = await FileRecord.findByPk(req.params.id);
    if (!img || img.kind !== 'file' || img.ownerId !== doc.ownerId || !String(img.mime || '').startsWith('image/')) {
      return res.status(404).send('not found');
    }
    try {
      const { buffer } = await readFileWithFallback(img);
      const active = ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml', 'text/javascript', 'application/javascript'].includes(String(img.mime || '').toLowerCase());
      res.setHeader('Content-Type', img.mime || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `${active ? 'attachment' : 'inline'}; filename="${encodeURIComponent(img.filename || img.id)}"`);
      if (active) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      res.send(buffer);
    } catch {
      res.status(502).send('no healthy replica');
    }
  }));

  // HTML preview for public decks (the export itself is a PowerPoint file).
  r.get('/c/:slug/preview', wrap(async (req, res) => {
    const file = await FileRecord.findOne({ where: { slug: req.params.slug, isPublic: true } });
    if (!file || file.kind !== 'deck') return res.status(404).send('not found');
    const out = await deckToHtml(file, parseContent(file));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(out);
  }));

  // Public render/export for a shared workspace document (used by /c/:slug).
  r.get('/c/:slug/export', wrap(async (req, res) => {
    const file = await FileRecord.findOne({ where: { slug: req.params.slug, isPublic: true } });
    if (!file || file.kind === 'file') return res.status(404).send('not found');
    const out = await exportPayload(file);
    res.setHeader('Content-Type', out.type);
    // Shared exports are intentionally public, but a short lifetime limits
    // stale copies after the owner revokes sharing.
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    if (out.type.startsWith('image/svg+xml')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(out.filename)}"`);
    }
    res.send(out.body);
  }));

  // ---------- Public forms ----------
  r.get('/forms/:slug', wrap(async (req, res) => {
    const file = await FileRecord.findOne({ where: { slug: req.params.slug, kind: 'form' } });
    if (!file || !file.isPublic) return res.status(404).render('error', { message: 'This form is not published.', status: 404 });
    const content = parseContent(file);
    res.render('form-public', { file, content, errors: {}, values: {}, done: req.query.done === '1' });
  }));

  r.post('/forms/:slug/submit', wrap(async (req, res) => {
    const file = await FileRecord.findOne({ where: { slug: req.params.slug, kind: 'form' } });
    if (!file || !file.isPublic) return res.status(404).render('error', { message: 'This form is not published.', status: 404 });
    const limit = allowFormSubmission(`workspace-form:${file.id}:${req.socket?.remoteAddress || req.ip || 'unknown'}`);
    if (!limit.ok) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      return res.status(429).render('error', { message: 'Too many submissions. Please try again later.', status: 429 });
    }
    const content = parseContent(file);
    const { data, errors } = validateForm(content, req.body || {});
    if (Object.keys(errors).length) {
      return res.status(400).render('form-public', { file, content, errors, values: data, done: false });
    }
    await FormResponse.create({
      fileId: file.id,
      data,
      ip: (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim().slice(0, 64),
    });
    recordEvent(req, 'response', { fileId: file.id });
    res.redirect(`/forms/${file.slug}?done=1`);
  }));

  r.get('/responses/:id.csv', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user);
    if (!file || file.kind !== 'form') return res.status(404).send('not found');
    const content = parseContent(file);
    const responses = await FormResponse.findAll({ where: { fileId: file.id }, order: [['id', 'ASC']] });
    const header = ['submitted_at', ...(content.fields || []).map((f) => f.label)];
    const rows = responses.map((r) => [
      r.createdAt.toISOString(),
      ...(content.fields || []).map((f) => {
        const v = r.data?.[f.id];
        return Array.isArray(v) ? v.join('; ') : v ?? '';
      }),
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/[^\w.-]+/g, '-')}-responses.csv"`);
    res.send(toCsv([header, ...rows]));
  }));

  r.get('/responses/:id', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user);
    if (!file || file.kind !== 'form') return res.status(404).render('error', { message: 'Form not found.', status: 404 });
    const content = parseContent(file);
    const responses = await FormResponse.findAll({ where: { fileId: file.id }, order: [['id', 'DESC']] });
    const summary = (content.fields || []).map((f) => {
      const values = responses.map((r) => r.data?.[f.id]).filter((v) => v !== '' && v != null && !(Array.isArray(v) && !v.length));
      if (f.type === 'radio' || f.type === 'select' || f.type === 'checkbox') {
        const counts = new Map();
        for (const v of values) for (const x of Array.isArray(v) ? v : [v]) counts.set(x, (counts.get(x) || 0) + 1);
        const total = Math.max(1, values.length);
        return {
          field: f,
          counts: (f.options || []).map((o) => ({ option: o, count: counts.get(o) || 0, pct: Math.round(((counts.get(o) || 0) / total) * 100) })),
          answered: values.length,
        };
      }
      return { field: f, samples: values.slice(0, 5), answered: values.length };
    });
    res.render('responses', { file, content, responses, summary });
  }));

  // ---------- Global search ----------
  r.get('/search', requireLogin, wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    let results = [];
    if (q) {
      const where = {
        [Op.or]: [{ filename: { [Op.like]: `%${q}%` } }, { content: { [Op.like]: `%${q}%` } }],
      };
      if (req.user.role !== 'admin') where.ownerId = req.user.id;
      const rows = await FileRecord.findAll({ where, order: [['updatedAt', 'DESC']], limit: 50 });
      results = rows.map((f) => {
        let snippet = '';
        if (f.content) {
          const plain = f.content.replace(/<[^>]+>/g, ' ').replace(/\\[nrt]/g, ' ').replace(/\s+/g, ' ').trim();
          const idx = plain.toLowerCase().indexOf(q.toLowerCase());
          snippet = idx >= 0 ? plain.slice(Math.max(0, idx - 60), idx + 120) : plain.slice(0, 160);
        }
        return { file: f, snippet };
      });
    }
    res.render('search', { q, results });
  }));

  return r;
}
