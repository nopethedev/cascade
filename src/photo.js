/* Server-side Photo document export.
 *
 * Photo documents are layered canvases. Raster layers store a data URL
 * (imported images, PSD composites and brush strokes); vector layers keep
 * editable shape/text settings. The server can always produce a faithful SVG
 * by embedding the raster data and drawing the vector layers as real SVG.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const safeColor = (value, fallback = 'transparent') => {
  const s = String(value || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^(?:rgb|hsl)a?\([0-9.,%\s/+-]+\)$/i.test(s)) return s;
  if (/^[a-z]{3,24}$/i.test(s)) return s;
  return fallback;
};
const safeFont = (value) => String(value || 'Inter').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 60) || 'Inter';
const safeBlend = (value) => {
  const v = String(value || 'normal');
  return ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].includes(v) ? v : 'normal';
};
const dataImage = (src) => (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(String(src || '')) ? String(src) : '');

export function photoToSvg(file, content = {}) {
  const w = Math.max(1, Math.round(num(content.w, 1200)));
  const h = Math.max(1, Math.round(num(content.h, 800)));
  const background = safeColor(content.background, '#ffffff');
  const layers = Array.isArray(content.layers) ? content.layers : [];
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(String(file?.filename || 'Photo').replace(/\.\w+$/, ''))}">`,
    `<rect width="${w}" height="${h}" fill="${esc(background)}"/>`,
  ];

  for (const layer of layers) {
    if (layer?.visible === false) continue;
    const opacity = Math.max(0, Math.min(1, num(layer.opacity, 1)));
    if (opacity <= 0) continue;
    const rotation = num(layer.rotation, 0);
    const x = num(layer.x, 0);
    const y = num(layer.y, 0);
    const lw = Math.max(0, num(layer.w, w));
    const lh = Math.max(0, num(layer.h, h));
    const transform = `translate(${x} ${y})${rotation ? ` rotate(${rotation} ${lw / 2} ${lh / 2})` : ''}`;
    const blend = safeBlend(layer.blend);
    const common = `opacity="${opacity}" transform="${transform}"${blend === 'normal' ? '' : ` style="mix-blend-mode:${blend}"`}`;
    const fill = safeColor(layer.fill, 'transparent');
    const stroke = safeColor(layer.stroke, 'none');
    const strokeWidth = Math.max(0, num(layer.strokeWidth, 0));
    if (layer.type === 'raster') {
      const href = dataImage(layer.src);
      if (href) parts.push(`<image ${common} href="${href}" x="0" y="0" width="${lw}" height="${lh}" preserveAspectRatio="none"/>`);
    } else if (layer.type === 'rect') {
      parts.push(`<rect ${common} width="${lw}" height="${lh}" rx="${Math.max(0, num(layer.radius, 0))}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${strokeWidth}"/>`);
    } else if (layer.type === 'ellipse') {
      parts.push(`<ellipse ${common} cx="${lw / 2}" cy="${lh / 2}" rx="${lw / 2}" ry="${lh / 2}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${strokeWidth}"/>`);
    } else if (layer.type === 'line') {
      const x1 = num(layer.x1, 0);
      const y1 = num(layer.y1, 0);
      const x2 = num(layer.x2, lw);
      const y2 = num(layer.y2, lh);
      parts.push(`<line ${common} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${esc(stroke === 'none' ? fill : stroke)}" stroke-width="${Math.max(1, strokeWidth || 4)}" stroke-linecap="round"/>`);
    } else if (layer.type === 'text') {
      const size = Math.max(1, num(layer.size, 48));
      const lines = String(layer.text || '').split('\n');
      const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
      const tx = anchor === 'middle' ? lw / 2 : anchor === 'end' ? lw : 0;
      const lineHeight = size * 1.2;
      parts.push(`<g ${common} fill="${esc(safeColor(layer.color, '#111827'))}" font-family="${esc(safeFont(layer.font))}, sans-serif" font-size="${size}" font-weight="${Math.max(100, Math.min(900, num(layer.weight, 400)))}" text-anchor="${anchor}">`);
      lines.forEach((line, i) => {
        parts.push(`<text x="${tx}" y="${size + i * lineHeight}">${esc(line)}</text>`);
      });
      parts.push('</g>');
    }
  }

  parts.push('</svg>');
  return parts.join('');
}
