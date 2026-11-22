import express from 'express';
import { FileRecord, FormResponse } from './db.js';
import { requireLogin } from './auth.js';
import { loadAccessibleFile } from './access.js';
import { readFileWithFallback } from './storage.js';
import { recordEvent } from './analytics.js';
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

async function serveSite(req, res, site, { submitted = false, custom = false } = {}) {
  const content = parseContent(site);
  recordEvent(req, 'view', { fileId: site.id });
  const html = renderSiteDocument(content, {
    slug: site.slug,
    action: custom ? '/submit' : `/sites/${site.slug}/submit`,
    submitted,
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
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

  r.get('/sites/:slug/asset/:id', wrap(async (req, res) => {
    const site = await publishedSite({ slug: req.params.slug });
    if (!site) return res.status(404).send('not found');
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
