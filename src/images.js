import express from 'express';
import { requireLogin } from './auth.js';

const router = express.Router();
const USER_AGENT = 'Cascade/1.0 (self-hosted image library; https://github.com/nopethedev/cascade)';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org', 'commons.wikimedia.org']);
const MAX_PROXY_BYTES = 15 * 1024 * 1024;

function plain(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function allowedImageUrl(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== 'https:') return null;
    if (!IMAGE_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

router.get('/search', requireLogin, async (req, res) => {
  const query = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (query.length < 2) return jsonError(res, 400, 'Search for at least two characters');
  try {
    const url = new URL(COMMONS_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', `filetype:bitmap ${query}`);
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', '12');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata|size|mime');
    url.searchParams.set('iiurlwidth', '960');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    const upstream = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) return jsonError(res, 502, 'Image search is unavailable');
    const data = await upstream.json();
    const pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];
    const results = [];
    for (const page of pages) {
      const info = page?.imageinfo?.[0];
      if (!info?.thumburl || !allowedImageUrl(info.thumburl)) continue;
      const meta = info.extmetadata || {};
      const title = plain(String(page.title || '').replace(/^File:/i, '')) || 'Untitled image';
      const artist = plain(meta.Artist?.value) || 'Unknown author';
      const license = plain(meta.LicenseShortName?.value) || 'See source for license';
      const source = String(info.descriptionurl || '').startsWith('https://commons.wikimedia.org/')
        ? info.descriptionurl
        : `https://commons.wikimedia.org/?curid=${encodeURIComponent(page.pageid || '')}`;
      results.push({
        id: String(page.pageid || ''),
        title,
        thumb: `/api/images/proxy?url=${encodeURIComponent(info.thumburl)}`,
        source,
        license,
        artist,
        credit: `${title} — ${artist} (${license}), Wikimedia Commons`,
        width: Number(info.thumbwidth) || null,
        height: Number(info.thumbheight) || null,
      });
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.json({ results, query, provider: 'Wikimedia Commons' });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return jsonError(res, 504, 'Image search timed out');
    }
    return jsonError(res, 502, 'Image search is unavailable');
  }
});

router.get('/proxy', requireLogin, async (req, res) => {
  const url = allowedImageUrl(req.query.url);
  if (!url) return jsonError(res, 400, 'Unsupported image URL');
  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png,image/jpeg,image/gif,image/webp,image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) return jsonError(res, 502, 'Could not load that image');
    const finalUrl = allowedImageUrl(upstream.url);
    if (!finalUrl) return jsonError(res, 502, 'Image redirected to an unsupported host');
    const mime = String(upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('image/')) return jsonError(res, 502, 'That result is not an image');
    const declared = Number(upstream.headers.get('content-length') || 0);
    if (declared > MAX_PROXY_BYTES) return jsonError(res, 413, 'Image is too large');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_PROXY_BYTES) return jsonError(res, 413, 'Image is too large');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return jsonError(res, 504, 'Image download timed out');
    return jsonError(res, 502, 'Could not load that image');
  }
});

export function createImageRouter() {
  return router;
}
