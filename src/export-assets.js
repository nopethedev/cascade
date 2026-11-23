// Shared helpers for turning editor image references into bytes that Office
// exporters can embed. Kept separate so the DOCX writer and the XLSX/PPTX
// writers use exactly the same limits and data-URL handling.
import { imageSize } from 'image-size';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export function cleanColor(value, fallback = '111111') {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (m) return m[1].toUpperCase();
  const short = /^#?([0-9a-f]{3})$/i.exec(String(value || '').trim());
  if (short) return short[1].split('').map((c) => `${c}${c}`).join('').toUpperCase();
  return fallback;
}

export function decodeDataUrl(src) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(src || ''));
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2].replace(/\s+/g, ''), 'base64') };
}

function imageKind(mime) {
  const m = String(mime || '').toLowerCase();
  if (m === 'image/png') return 'png';
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  return null;
}

export async function embeddableImage(src, resolveImage) {
  const fromData = decodeDataUrl(src);
  let img = fromData;
  if (!img && resolveImage) {
    try {
      img = await resolveImage(src);
    } catch {
      img = null;
    }
  }
  if (!img || !img.buffer || img.buffer.length === 0 || img.buffer.length > MAX_IMAGE_BYTES) return null;
  const type = imageKind(img.mime);
  if (!type) return null;
  let dims = null;
  try {
    dims = imageSize(img.buffer);
  } catch {
    dims = null;
  }
  return { buffer: img.buffer, mime: img.mime, type, width: dims?.width || 600, height: dims?.height || 400 };
}

/** Turn a stored/local image source into a data URL for HTML previews/exports. */
export async function inlineImageSource(src, resolveImage) {
  const fromData = decodeDataUrl(src);
  let img = fromData;
  if (!img && resolveImage) {
    try {
      img = await resolveImage(src);
    } catch {
      img = null;
    }
  }
  if (!img || !img.buffer || !img.buffer.length || img.buffer.length > MAX_IMAGE_BYTES) return null;
  return `data:${img.mime};base64,${img.buffer.toString('base64')}`;
}
