import express from 'express';
import { v4 as uuid } from 'uuid';
import { FileRecord, FormResponse, DocVersion, SiteCollection, SiteItem, SiteDeployment } from './db.js';
import { requireLogin } from './auth.js';
import { loadAccessibleFile, roleAtLeast } from './access.js';
import { readFileWithFallback } from './storage.js';
import { recordEvent } from './analytics.js';
import { allowFormSubmission } from './formRateLimit.js';
import { renderSiteDocument, siteToReact, siteToReactCss } from '../public/site-render.mjs';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseContent(file) {
  try {
    return JSON.parse(file.content || '{}');
  } catch {
    return {};
  }
}

async function publishedSite(where) {
  const site = await FileRecord.findOne({
    where: { ...where, kind: 'site', isPublic: true },
  });
  if (!site || !site.publishedAt) return null;
  return site;
}

function siteCsp() {
  // The page itself contains no scripts. Inline scripts are allowed so the
  // sandboxed custom-embed iframe (unique origin, no network) can run the
  // HTML/CSS/JS its author wrote.
  return "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
}

async function cmsForSite(site) {
  const collections = await SiteCollection.findAll({ where: { fileId: site.id }, order: [['createdAt', 'ASC']] });
  const items = await SiteItem.findAll({ where: { fileId: site.id, status: 'published' }, order: [['createdAt', 'DESC']], limit: 500 });
  const byCollection = new Map(collections.map((c) => [c.id, c]));
  return {
    collections: collections.map((c) => c.toJSON()),
    items: items.map((row) => ({ ...row.toJSON(), collectionSlug: byCollection.get(row.collectionId)?.slug || '' })),
  };
}

async function serveSite(req, res, site, { submitted = false, custom = false, item = false, collection = null, cmsItems = null, cmsCollections = null, contentOverride = null, privatePreview = false } = {}) {
  const content = contentOverride || parseContent(site);
  recordEvent(req, 'view', { fileId: site.id });
  const cmsData = cmsItems ? { items: cmsItems, collections: cmsCollections || [] } : await cmsForSite(site);
  const html = renderSiteDocument(content, {
    slug: site.slug,
    action: custom ? '/submit' : `/sites/${site.slug}/submit`,
    submitted,
    item,
    collection,
    cmsItems: cmsData.items,
    cmsCollections: cmsData.collections,
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', privatePreview ? 'private, no-store' : 'public, max-age=60, must-revalidate');
  res.setHeader('Content-Security-Policy', siteCsp());
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.send(html);
}

function siteAssetPath(src) {
  const m = /^\/sites\/[A-Za-z0-9_-]+\/asset\/([A-Za-z0-9_-]+)$/.exec(String(src || ''));
  if (m) return m[1];
  const local = /^\/f\/([A-Za-z0-9_-]+)\/raw$/.exec(String(src || ''));
  return local ? local[1] : null;
}

function collectImageIds(value, out = new Set()) {
  if (typeof value === 'string') {
    const id = siteAssetPath(value);
    if (id) out.add(id);
  } else if (Array.isArray(value)) {
    for (const item of value) collectImageIds(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectImageIds(item, out);
  }
  return out;
}

async function inlineSiteImages(content, ownerId) {
  const ids = collectImageIds(content);
  const map = new Map();
  for (const id of ids) {
    const img = await FileRecord.findByPk(id);
    if (!img || img.kind !== 'file' || img.ownerId !== ownerId || !String(img.mime || '').startsWith('image/')) continue;
    try {
      const { buffer } = await readFileWithFallback(img);
      if (buffer.length > 15 * 1024 * 1024) continue;
      map.set(id, `data:${img.mime};base64,${buffer.toString('base64')}`);
    } catch {
      /* leave the original reference if the replica is unavailable */
    }
  }
  const walk = (value) => {
    if (typeof value === 'string') {
      const id = siteAssetPath(value);
      return id && map.has(id) ? map.get(id) : value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v);
      return out;
    }
    return value;
  };
  return walk(content);
}

export function createSitesRouter() {
  const r = express.Router();

  r.get('/sites/:slug', wrap(async (req, res) => {
    const site = await publishedSite({ slug: req.params.slug });
    if (!site) return res.status(404).render('error', { message: 'This website has not been published.', status: 404 });
    await serveSite(req, res, site, { submitted: req.query.submitted === '1' });
  }));

  r.get('/sites/:slug/c/:collectionSlug', wrap(async (req, res) => {
    const site = await publishedSite({ slug: req.params.slug });
    if (!site) return res.status(404).render('error', { message: 'This website has not been published.', status: 404 });
    const collection = await SiteCollection.findOne({ where: { fileId: site.id, slug: String(req.params.collectionSlug || '').toLowerCase() } });
    if (!collection) return res.status(404).render('error', { message: 'Collection not found.', status: 404 });
    const content = parseContent(site);
    const cmsSection = { id: 'cms-index', type: 'cms', collectionId: collection.id, collectionSlug: collection.slug, title: collection.name, text: `Latest from ${collection.name}.`, limit: 12 };
    const sections = Array.isArray(content.sections) ? [...content.sections] : [];
    const footerAt = sections.map((s) => s.type).lastIndexOf('footer');
    sections.splice(footerAt >= 0 ? footerAt : sections.length, 0, cmsSection);
    await serveSite(req, res, site, { contentOverride: { ...content, sections } });
  }));

  r.get('/sites/:slug/c/:collectionSlug/:itemSlug', wrap(async (req, res) => {
    const site = await publishedSite({ slug: req.params.slug });
    if (!site) return res.status(404).render('error', { message: 'This website has not been published.', status: 404 });
    const collection = await SiteCollection.findOne({ where: { fileId: site.id, slug: String(req.params.collectionSlug || '').toLowerCase() } });
    if (!collection) return res.status(404).render('error', { message: 'Collection not found.', status: 404 });
    const item = await SiteItem.findOne({ where: { fileId: site.id, collectionId: collection.id, slug: String(req.params.itemSlug || '').toLowerCase(), status: 'published' } });
    if (!item) return res.status(404).render('error', { message: 'Story not found.', status: 404 });
    const itemJson = { ...item.toJSON(), collectionSlug: collection.slug };
    await serveSite(req, res, site, { item: itemJson, collection: collection.toJSON(), cmsItems: [itemJson] });
  }));

  r.get('/sites/:slug/asset/:id', wrap(async (req, res) => {
    const site = await publishedSite({ slug: req.params.slug });
    if (!site) return res.status(404).send('not found');
    const raw = String(site.content || '');
    const assetId = String(req.params.id || '');
    if (!assetId || !(raw.includes(`/f/${assetId}/raw`) || raw.includes(`/asset/${assetId}`))) {
      return res.status(404).send('not found');
    }
    const img = await FileRecord.findByPk(req.params.id);
    if (!img || img.kind !== 'file' || img.ownerId !== site.ownerId || !String(img.mime || '').startsWith('image/')) {
      return res.status(404).send('not found');
    }
    try {
      const { buffer } = await readFileWithFallback(img);
      res.setHeader('Content-Type', img.mime);
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(buffer);
    } catch {
      res.status(502).send('asset unavailable');
    }
  }));

  r.post('/sites/:slug/submit', express.urlencoded({ extended: false }), wrap(async (req, res) => {
    const site = await publishedSite({ slug: req.params.slug });
    if (!site) return res.status(404).send('not found');
    const limit = allowFormSubmission(`site:${site.id}:${req.socket?.remoteAddress || req.ip || 'unknown'}`);
    if (!limit.ok) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      return res.status(429).send('Too many form submissions. Please try again later.');
    }
    const body = req.body || {};
    if (String(body.company || '').trim()) return res.redirect(303, `/sites/${site.slug}?submitted=1#contact`);
    const data = {
      name: String(body.name || '').trim().slice(0, 120),
      email: String(body.email || '').trim().slice(0, 180),
      message: String(body.message || '').trim().slice(0, 4000),
    };
    if (!data.name || !data.email || !data.message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      return res.status(400).render('error', { message: 'Please complete the form with a valid name, email and message.', status: 400 });
    }
    await FormResponse.create({
      fileId: site.id,
      data,
      ip: (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim().slice(0, 64),
    });
    recordEvent(req, 'response', { fileId: site.id });
    res.redirect(303, `/sites/${site.slug}?submitted=1#contact`);
  }));

  r.get('/sites/:slug/sitemap.xml', wrap(async (req, res) => {
    const site = await publishedSite({ slug: req.params.slug });
    if (!site) return res.status(404).send('not found');
    const origin = `${req.protocol}://${req.get('host')}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/sites/${site.slug}</loc><lastmod>${new Date(site.updatedAt).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  }));

  r.get('/sites/:slug/robots.txt', wrap(async (req, res) => {
    const site = await publishedSite({ slug: req.params.slug });
    if (!site) return res.status(404).send('not found');
    const origin = `${req.protocol}://${req.get('host')}`;
    res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${origin}/sites/${site.slug}/sitemap.xml\n`);
  }));

  // Authenticated, self-contained exports. Images are embedded so the file can
  // be opened or handed to a client without the Cascade origin.
  r.get('/sites/:id/export.html', requireLogin, wrap(async (req, res) => {
    const { file, role } = await loadAccessibleFile(req.params.id, req.user, 'viewer');
    if (!file || file.kind !== 'site' || !role) return res.status(404).send('not found');
    const content = await inlineSiteImages(parseContent(file), file.ownerId);
    const html = renderSiteDocument(content, { preview: false, slug: file.slug });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent((file.filename || 'site').replace(/[^\w.-]+/g, '-'))}.html"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(html);
  }));

  r.get('/sites/:id/export.jsx', requireLogin, wrap(async (req, res) => {
    const { file, role } = await loadAccessibleFile(req.params.id, req.user, 'viewer');
    if (!file || file.kind !== 'site' || !role) return res.status(404).send('not found');
    const content = await inlineSiteImages(parseContent(file), file.ownerId);
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent((file.filename || 'site').replace(/[^\w.-]+/g, '-'))}.jsx"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(siteToReact(content));
  }));

  r.get('/sites/:id/export.css', requireLogin, wrap(async (req, res) => {
    const { file, role } = await loadAccessibleFile(req.params.id, req.user, 'viewer');
    if (!file || file.kind !== 'site' || !role) return res.status(404).send('not found');
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent((file.filename || 'site').replace(/[^\w.-]+/g, '-'))}.css"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(siteToReactCss(parseContent(file)));
  }));

  // ------------------------- deployments and CMS -------------------------
  const loadSite = async (id, user, minimum = 'viewer') => {
    const { file, role } = await loadAccessibleFile(id, user, minimum);
    if (!file || file.kind !== 'site' || !role || !roleAtLeast(role, minimum)) return null;
    file.accessRole = role;
    return file;
  };

  const deploymentJson = (row) => ({
    id: row.id,
    environment: row.environment,
    version: row.version,
    label: row.label,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  });

  const saveDeployment = async (file, environment, user, label) => {
    const row = await SiteDeployment.create({
      id: uuid(),
      fileId: file.id,
      environment,
      version: file.version,
      content: file.content,
      label: String(label || `${environment} v${file.version}`).slice(0, 160),
      createdBy: user.id,
    });
    return row;
  };

  r.get('/api/workspace/docs/:id/deployments', requireLogin, wrap(async (req, res) => {
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const rows = await SiteDeployment.findAll({ where: { fileId: file.id }, order: [['createdAt', 'DESC']], limit: 60 });
    res.json({
      ok: true,
      currentVersion: file.version,
      publishedAt: file.publishedAt,
      deployments: rows.map(deploymentJson),
    });
  }));

  r.post('/api/workspace/docs/:id/deployments/staging', requireLogin, wrap(async (req, res) => {
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const row = await saveDeployment(file, 'staging', req.user, req.body?.label || 'Staging preview');
    res.status(201).json({ ok: true, deployment: deploymentJson(row), previewUrl: `/sites/${file.id}/staging` });
  }));

  r.get('/sites/:id/staging', requireLogin, wrap(async (req, res) => {
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).render('error', { message: 'Staging preview not found.', status: 404 });
    await serveSite(req, res, file, { privatePreview: true });
  }));

  r.post('/api/workspace/docs/:id/deployments/:deploymentId/rollback', requireLogin, wrap(async (req, res) => {
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const deployment = await SiteDeployment.findOne({ where: { id: req.params.deploymentId, fileId: file.id } });
    if (!deployment) return res.status(404).json({ error: 'deployment not found' });
    await DocVersion.create({ fileId: file.id, version: file.version, content: file.content, createdBy: req.user.id });
    await file.update({
      content: deployment.content,
      size: Buffer.byteLength(deployment.content),
      version: file.version + 1,
      updatedAt: new Date(),
      ...(deployment.environment === 'production' ? { isPublic: true, publishedAt: new Date() } : {}),
    });
    const created = await saveDeployment(file, deployment.environment, req.user, `Rollback to v${deployment.version}`);
    res.json({ ok: true, version: file.version, deployment: deploymentJson(created), url: deployment.environment === 'production' ? `/sites/${file.slug}` : `/sites/${file.id}/staging` });
  }));

  const cleanFields = (raw) => {
    if (!Array.isArray(raw) || raw.length > 30) throw new Error('fields must be an array of at most 30 fields');
    return raw.map((field) => {
      const id = String(field?.id || '').trim().toLowerCase();
      if (!/^[a-z][a-z0-9_]{1,31}$/.test(id)) throw new Error('invalid field id');
      const type = ['text', 'richtext', 'image', 'number', 'date', 'boolean', 'select'].includes(field.type) ? field.type : 'text';
      const label = String(field.label || id).trim().slice(0, 80) || id;
      const options = type === 'select' ? (Array.isArray(field.options) ? field.options : []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 30) : [];
      return { id, label, type, options };
    });
  };

  const cleanItemData = (fields, raw) => {
    const out = {};
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(source, field.id)) continue;
      const value = source[field.id];
      if (field.type === 'boolean') out[field.id] = value === true;
      else if (field.type === 'number') out[field.id] = Number.isFinite(Number(value)) ? Number(value) : 0;
      else out[field.id] = String(value ?? '').slice(0, field.type === 'richtext' ? 20000 : 2000);
    }
    return out;
  };

  const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || `item-${Date.now().toString(36)}`;

  r.get('/api/workspace/docs/:id/cms', requireLogin, wrap(async (req, res) => {
    // CMS metadata includes drafts and fields. A shared public site grants a
    // logged-in stranger viewer access to the document, but not to its CMS.
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const collections = await SiteCollection.findAll({ where: { fileId: file.id }, order: [['createdAt', 'ASC']] });
    const out = [];
    for (const collection of collections) {
      const items = await SiteItem.findAll({ where: { collectionId: collection.id }, order: [['createdAt', 'DESC']], limit: 200 });
      out.push({ ...collection.toJSON(), items: items.map((i) => i.toJSON()) });
    }
    res.json({ ok: true, collections: out });
  }));

  r.post('/api/workspace/docs/:id/cms/collections', requireLogin, wrap(async (req, res) => {
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'collection name is required' });
    let fields;
    try { fields = cleanFields(req.body?.fields || [{ id: 'title', label: 'Title', type: 'text' }]); } catch (err) { return res.status(400).json({ error: err.message }); }
    const slug = slugify(req.body?.slug || name);
    const existing = await SiteCollection.findOne({ where: { fileId: file.id, slug } });
    if (existing) return res.status(409).json({ error: 'a collection with that slug already exists' });
    const collection = await SiteCollection.create({ id: uuid(), fileId: file.id, name, slug, fields });
    res.status(201).json({ ok: true, collection: { ...collection.toJSON(), items: [] } });
  }));

  r.patch('/api/workspace/docs/:id/cms/collections/:collectionId', requireLogin, wrap(async (req, res) => {
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const collection = await SiteCollection.findOne({ where: { id: req.params.collectionId, fileId: file.id } });
    if (!collection) return res.status(404).json({ error: 'not found' });
    let fields = collection.fields;
    if (req.body?.fields) {
      try { fields = cleanFields(req.body.fields); } catch (err) { return res.status(400).json({ error: err.message }); }
    }
    await collection.update({ name: String(req.body?.name || collection.name).trim().slice(0, 80) || collection.name, fields });
    res.json({ ok: true, collection: collection.toJSON() });
  }));

  r.delete('/api/workspace/docs/:id/cms/collections/:collectionId', requireLogin, wrap(async (req, res) => {
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const collection = await SiteCollection.findOne({ where: { id: req.params.collectionId, fileId: file.id } });
    if (!collection) return res.status(404).json({ error: 'not found' });
    await SiteItem.destroy({ where: { collectionId: collection.id, fileId: file.id } });
    await collection.destroy();
    res.json({ ok: true });
  }));

  r.post('/api/workspace/docs/:id/cms/collections/:collectionId/items', requireLogin, wrap(async (req, res) => {
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const collection = await SiteCollection.findOne({ where: { id: req.params.collectionId, fileId: file.id } });
    if (!collection) return res.status(404).json({ error: 'not found' });
    const data = cleanItemData(collection.fields, req.body?.data);
    const slug = slugify(req.body?.slug || data.title || data.name || 'untitled');
    const exists = await SiteItem.findOne({ where: { collectionId: collection.id, slug } });
    if (exists) return res.status(409).json({ error: 'an item with that slug already exists' });
    const status = req.body?.status === 'published' ? 'published' : 'draft';
    const item = await SiteItem.create({
      id: uuid(), collectionId: collection.id, fileId: file.id, slug, data, status,
      publishedAt: status === 'published' ? new Date() : null,
    });
    res.status(201).json({ ok: true, item: item.toJSON() });
  }));

  r.patch('/api/workspace/docs/:id/cms/collections/:collectionId/items/:itemId', requireLogin, wrap(async (req, res) => {
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const collection = await SiteCollection.findOne({ where: { id: req.params.collectionId, fileId: file.id } });
    if (!collection) return res.status(404).json({ error: 'not found' });
    const item = await SiteItem.findOne({ where: { id: req.params.itemId, collectionId: collection.id, fileId: file.id } });
    if (!item) return res.status(404).json({ error: 'not found' });
    const data = req.body?.data ? cleanItemData(collection.fields, req.body.data) : item.data;
    const status = req.body?.status === 'published' ? 'published' : req.body?.status === 'draft' ? 'draft' : item.status;
    await item.update({ data, status, publishedAt: status === 'published' ? (item.publishedAt || new Date()) : null });
    res.json({ ok: true, item: item.toJSON() });
  }));

  r.delete('/api/workspace/docs/:id/cms/collections/:collectionId/items/:itemId', requireLogin, wrap(async (req, res) => {
    const file = await loadSite(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const item = await SiteItem.findOne({ where: { id: req.params.itemId, collectionId: req.params.collectionId, fileId: file.id } });
    if (!item) return res.status(404).json({ error: 'not found' });
    await item.destroy();
    res.json({ ok: true });
  }));

  return r;
}

/** Route a custom domain's public requests to its published site. */
export function customDomainSiteMiddleware() {
  return wrap(async (req, res, next) => {
    const host = String(req.hostname || '').toLowerCase();
    if (!host || host === 'localhost' || /^[0-9.]+$/.test(host) || host.endsWith('.style.dev')) return next();
    const site = await publishedSite({ customDomain: host });
    if (!site) return next();
    if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
      return serveSite(req, res, site, { custom: true, submitted: req.query.submitted === '1' });
    }
    if (req.method === 'GET' && req.path === '/sitemap.xml') {
      const origin = `${req.protocol}://${req.get('host')}`;
      return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc><lastmod>${new Date(site.updatedAt).toISOString()}</lastmod></url></urlset>`);
    }
    if (req.method === 'GET' && req.path === '/robots.txt') {
      return res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${req.protocol}://${req.get('host')}/sitemap.xml\n`);
    }
    if (req.method === 'POST' && req.path === '/submit') {
      // Re-use the slug route's validation by redirecting through the public
      // origin is not safe on a custom domain; this handler mirrors the check.
      const limit = allowFormSubmission(`site:${site.id}:${req.socket?.remoteAddress || req.ip || 'unknown'}`);
      if (!limit.ok) {
        res.setHeader('Retry-After', String(limit.retryAfter));
        return res.status(429).send('Too many form submissions. Please try again later.');
      }
      const body = req.body || {};
      const data = {
        name: String(body.name || '').trim().slice(0, 120),
        email: String(body.email || '').trim().slice(0, 180),
        message: String(body.message || '').trim().slice(0, 4000),
      };
      if (!data.name || !data.email || !data.message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
        return res.status(400).send('Please complete the form with a valid name, email and message.');
      }
      await FormResponse.create({ fileId: site.id, data, ip: (req.ip || '').slice(0, 64) });
      return res.redirect(303, '/?submitted=1#contact');
    }
    return next();
  });
}
