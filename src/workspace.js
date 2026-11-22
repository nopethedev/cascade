import express from 'express';
import { nanoid } from 'nanoid';
import { v4 as uuid } from 'uuid';
import { Op } from 'sequelize';
import { FileRecord, Folder, DocVersion, Template, FormResponse } from './db.js';
import { requireLogin, requireAdmin } from './auth.js';
import { KINDS, CATEGORIES, TEMPLATES, buildContent, templatesFor, KIND_BY_ID } from './templates.js';
import { recordEvent } from './analytics.js';
import { computeSheet } from './formula.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_CONTENT = 2 * 1024 * 1024; // 2 MB of editor JSON per document

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

function canAccess(file, user) {
  return !!user && (user.role === 'admin' || file.ownerId === user.id);
}

async function loadDoc(id, user) {
  const file = await FileRecord.findByPk(id);
  if (!file || file.kind === 'file' || !canAccess(file, user)) return null;
  return file;
}

function parseContent(file) {
  try {
    return JSON.parse(file.content || '{}');
  } catch {
    return {};
  }
}

function defaultName(kind) {
  const label = KIND_BY_ID.get(kind)?.label || 'Document';
  const d = new Date();
  return `${label} ${d.toISOString().slice(0, 10)}`;
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

function docToHtml(file, content) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(file.filename)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font: 16px/1.65 Georgia, 'Times New Roman', serif; max-width: 780px; margin: 40px auto; padding: 0 24px; color: #111; }
  h1 { font-size: 32px; } h2 { font-size: 22px; margin-top: 28px; }
  table { border-collapse: collapse; width: 100%; margin: 14px 0; } td, th { border: 1px solid #bbb; padding: 7px 9px; text-align: left; }
  img { max-width: 100%; } blockquote { border-left: 3px solid #e11d48; margin-left: 0; padding-left: 14px; color: #444; }
  header, footer { font-size: 12px; color: #666; } header { margin-bottom: 26px; } footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px; }
</style></head><body>
${content.header ? `<header>${escapeHtml(content.header)}</header>` : ''}
${content.html || ''}
${content.footer ? `<footer>${escapeHtml(content.footer)}</footer>` : ''}
</body></html>`;
}

function sheetToCsv(content) {
  const sheet = (content.sheets || [])[content.active || 0] || (content.sheets || [])[0];
  if (!sheet) return '';
  const cells = sheet.cells || {};
  const computed = computeSheet(sheet);
  const rows = Number(sheet.rows) || 20;
  const cols = Number(sheet.cols) || 10;
  const colName = (n) => String.fromCharCode(65 + (n % 26));
  const line = [];
  for (let r = 1; r <= rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const ref = colName(c) + r;
      const cell = cells[ref];
      const v = cell ? computed[ref] ?? cell.v ?? cell.f ?? '' : '';
      row.push(/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    }
    line.push(row.join(','));
  }
  return line.join('\n');
}

function deckToHtml(file, content) {
  const slides = content.slides || [];
  const el = (e) => {
    if (e.type === 'text') {
      return `<div style="position:absolute;left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;color:${e.color || '#fff'};font-size:${e.size || 28}px;font-weight:${e.bold ? 700 : 400};text-align:${e.align || 'left'};white-space:pre-wrap">${escapeHtml(e.text)}</div>`;
    }
    if (e.type === 'rect') {
      return `<div style="position:absolute;left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;background:${e.fill || '#e11d48'}"></div>`;
    }
    if (e.type === 'image') {
      return `<img src="${escapeHtml(e.src)}" style="position:absolute;left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;object-fit:cover" alt="" />`;
    }
    return '';
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(file.filename)}</title>
<style>
  body { margin: 0; background: #111; font-family: Inter, system-ui, sans-serif; }
  .slide { position: relative; width: ${content.w || 1280}px; height: ${content.h || 720}px; margin: 20px auto; overflow: hidden; page-break-after: always; }
  @media print { body { background: #fff; } .slide { margin: 0; } }
  .notes { color: #aaa; font-size: 13px; max-width: 1280px; margin: 0 auto 30px; font-family: system-ui; }
</style></head><body>
${slides.map((s) => `<section class="slide" style="background:${s.bg || '#101014'}">${(s.elements || []).map(el).join('')}</section>${s.notes ? `<p class="notes">Notes: ${escapeHtml(s.notes)}</p>` : ''}`).join('\n')}
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
    if (e.type === 'path') {
      const pts = (e.points || []).map((p) => `${p[0]},${p[1]}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${e.color || '#fff'}" stroke-width="${e.width || 3}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if (e.type === 'rect') return `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${e.color || '#27272a'}"/>`;
    if (e.type === 'ellipse') return `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${e.w / 2}" ry="${e.h / 2}" fill="${e.color || '#27272a'}"/>`;
    if (e.type === 'sticky') return `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="4" fill="${e.color || '#fde68a'}"/><foreignObject x="${e.x + 10}" y="${e.y + 10}" width="${e.w - 20}" height="${e.h - 20}"><div xmlns="http://www.w3.org/1999/xhtml" style="font:14px system-ui;color:#111">${escapeHtml(e.text)}</div></foreignObject>`;
    if (e.type === 'text') return `<text x="${e.x}" y="${e.y + (e.size || 20)}" fill="${e.color || '#fff'}" font-size="${e.size || 20}" font-family="system-ui">${escapeHtml(e.text)}</text>`;
    return '';
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}" width="1200" style="background:#101014"><rect x="${minX - pad}" y="${minY - pad}" width="100%" height="100%" fill="#101014"/>${parts.join('')}</svg>`;
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
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      data[f.id] = list;
      if (f.required && !list.length) errors[f.id] = 'Please pick at least one option.';
      continue;
    }
    const val = String(raw ?? '').trim();
    data[f.id] = val;
    if (f.required && !val) errors[f.id] = 'This field is required.';
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

  // ---------- Editor shell ----------
  r.get('/edit/:id', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user);
    if (!file) return res.status(404).render('error', { message: 'Document not found.', status: 404 });
    if (!KIND_BY_ID.has(file.kind)) return res.status(400).render('error', { message: 'Unknown document type.', status: 400 });
    const content = parseContent(file);
    res.render(`editors/${file.kind}`, { file, content, kinds: KINDS, kind: KIND_BY_ID.get(file.kind) });
  }));

  // ---------- Create a document ----------
  r.post('/api/workspace/docs', requireLogin, wrap(async (req, res) => {
    const { kind, templateId, name, folderId, isPublic } = req.body || {};
    if (!KIND_BY_ID.has(kind)) return res.status(400).json({ error: 'unknown kind' });

    let content = null;
    let templateName = null;
    if (templateId && String(templateId).startsWith('custom:')) {
      const tpl = await Template.findByPk(String(templateId).slice(7));
      if (tpl && tpl.ownerId === req.user.id && tpl.kind === kind) {
        content = JSON.parse(tpl.content);
        templateName = tpl.name;
      }
    } else if (templateId) {
      content = buildContent(String(templateId), kind);
      templateName = templateId;
    }
    if (!content) content = buildContent(null, kind);

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
      isPublic: !!isPublic,
      replicas: [],
      content: serialized,
      kind,
      folderId: folder ? folder.id : null,
      template: templateId ? String(templateId) : null,
      version: 1,
    });
    await snapshot(file, req.user.id);
    recordEvent(req, 'create', { fileId: file.id });
    res.json({ ok: true, id: file.id, url: `/edit/${file.id}` });
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
    const file = await loadDoc(req.params.id, req.user);
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
    const file = await loadDoc(req.params.id, req.user);
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
    const file = await loadDoc(req.params.id, req.user);
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

  // ---------- Export ----------
  function exportPayload(file) {
    const content = parseContent(file);
    const base = String(file.filename || 'document').replace(/[^\w.-]+/g, '-');
    if (file.kind === 'doc') return { body: docToHtml(file, content), type: 'text/html; charset=utf-8', filename: `${base}.html` };
    if (file.kind === 'sheet') return { body: sheetToCsv(content), type: 'text/csv; charset=utf-8', filename: `${base}.csv` };
    if (file.kind === 'deck') return { body: deckToHtml(file, content), type: 'text/html; charset=utf-8', filename: `${base}.html` };
    if (file.kind === 'board') return { body: boardToSvg(file, content), type: 'image/svg+xml; charset=utf-8', filename: `${base}.svg` };
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
    const file = await loadDoc(req.params.id, req.user);
    if (!file) return res.status(404).send('not found');
    const out = exportPayload(file);
    res.setHeader('Content-Type', out.type);
    res.send(out.body);
  }));

  r.get('/download/:id', requireLogin, wrap(async (req, res) => {
    const file = await loadDoc(req.params.id, req.user);
    if (!file) return res.status(404).send('not found');
    const out = exportPayload(file);
    res.setHeader('Content-Type', out.type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(out.filename)}"`);
    res.send(out.body);
  }));

  // Public render/export for a shared workspace document (used by /c/:slug).
  r.get('/c/:slug/export', wrap(async (req, res) => {
    const file = await FileRecord.findOne({ where: { slug: req.params.slug, isPublic: true } });
    if (!file || file.kind === 'file') return res.status(404).send('not found');
    const out = exportPayload(file);
    res.setHeader('Content-Type', out.type);
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
