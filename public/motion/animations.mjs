/* Subtitle/text animation engine and .cube LUT parser.
 *
 * One parameterised engine drives all 50 subtitle presets. Each preset is a
 * named animation + style, not a bespoke implementation, so preview and export
 * share the same timing rules. */

import { clamp, easeValue } from './schema.mjs';

const easeOut = (t) => 1 - (1 - clamp(t)) ** 3;
const easeBack = (t) => {
  const c = 2.2;
  const x = clamp(t) - 1;
  return 1 + (c + 1) * x ** 3 + c * x ** 2;
};

/* Returns a visual state for one subtitle cue.
 * progress: 0..1 through the cue, index/count: word/character position. */
export function subtitleAnimation(name, progress, options = {}) {
  const t = clamp(progress);
  const intro = clamp(t / Math.max(0.001, options.introDuration ?? 0.22));
  const outro = clamp((1 - t) / Math.max(0.001, options.outroDuration ?? 0.16));
  const base = { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, blur: 0, clip: 1, perChar: 0, highlight: -1 };
  switch (name) {
    case 'none':
      return { ...base };
    case 'fade':
      return { ...base, opacity: Math.min(intro, outro) };
    case 'pop':
      return { ...base, opacity: Math.min(1, intro * 2) * outro, scale: 0.55 + easeBack(intro) * 0.45 };
    case 'bounce':
      return { ...base, opacity: Math.min(1, intro * 3) * outro, dy: (1 - easeOut(intro)) * 0.12, scale: 0.9 + easeOut(intro) * 0.1 };
    case 'zoom':
      return { ...base, opacity: Math.min(1, intro * 1.5) * outro, scale: 0.2 + easeOut(intro) * 0.8 };
    case 'slide-up':
      return { ...base, opacity: Math.min(1, intro * 2) * outro, dy: (1 - easeOut(intro)) * 0.1 };
    case 'dramatic-fade':
      return { ...base, opacity: easeOut(intro) * outro, blur: (1 - intro) * 0.008, scale: 1.04 - intro * 0.04 };
    case 'blur-in':
      return { ...base, opacity: outrame(intro, outro), blur: (1 - easeOut(intro)) * 0.016 };
    case 'typewriter':
      return { ...base, clip: intro, opacity: outro };
    case 'word-highlight':
    case 'karaoke': {
      const words = Math.max(1, options.wordCount || 1);
      const shown = Math.min(words, Math.floor(intro * words) + (intro > 0 ? 1 : 0));
      return { ...base, opacity: outro, clip: shown / words, highlight: Math.min(words - 1, shown - 1) };
    }
    case 'highlight-box':
    case 'wave':
    case 'stagger':
    case 'per-word-scale':
    case 'per-word-rotate':
    case 'elastic':
    case 'emphasis':
    case 'progressive':
      return { ...base, opacity: outro, perChar: t, highlight: Math.floor(clamp(intro) * Math.max(1, options.wordCount || 1)) };
    case 'reveal':
      return { ...base, opacity: outro, clip: easeOut(intro) };
    case 'glitch':
      return { ...base, opacity: outro, dx: intro < 1 ? Math.sin(intro * 90) * 0.012 * (1 - intro) : 0, blur: intro < 1 ? 0.004 : 0 };
    case 'tracking-in':
      return { ...base, opacity: easeOut(intro) * outro, scale: 1.08 - easeOut(intro) * 0.08 };
    case 'slide-in-left':
      return { ...base, opacity: Math.min(1, intro * 2) * outro, dx: -(1 - easeOut(intro)) * 0.2 };
    case 'slide-in-right':
      return { ...base, opacity: Math.min(1, intro * 2) * outro, dx: (1 - easeOut(intro)) * 0.2 };
    case 'slide-in-top':
      return { ...base, opacity: Math.min(1, intro * 2) * outro, dy: -(1 - easeOut(intro)) * 0.16 };
    case 'credits-roll':
      return { ...base, opacity: outro, dy: 0.55 - t * 1.1 };
    case 'count-up':
      return { ...base, opacity: Math.min(1, intro * 2) * outro };
    case 'logo-reveal':
      return { ...base, opacity: easeOut(intro) * outro, scale: 1.35 - easeOut(intro) * 0.35, rotation: (1 - intro) * -6 };
    default:
      return { ...base, opacity: Math.min(1, intro * 2) * outro };
  }
}

function outrame(intro, outro) {
  return Math.min(1, intro * 1.5) * clamp(outro);
}

/* Per-word / per-character transform. Used by the subtitle renderer for the
 * animated presets, and by the ASS exporter for karaoke-style events. */
export function glyphState(animation, progress, index, count) {
  const t = clamp(progress);
  const stagger = count > 1 ? index / (count - 1) : 0;
  const local = clamp((t - stagger * 0.18) / 0.55);
  switch (animation) {
    case 'word-highlight':
    case 'karaoke':
    case 'highlight-box':
      return { scale: 1, dy: 0, rotation: 0, active: t * count >= index && t * count < index + 1, highlight: true };
    case 'wave':
      return { scale: 1, dy: Math.sin((t * 6 + stagger * 4) * Math.PI) * 0.012, rotation: 0, active: false };
    case 'stagger':
      return { scale: 0.7 + easeOut(local) * 0.3, dy: (1 - easeOut(local)) * 0.03, rotation: 0, active: false };
    case 'per-word-scale':
      return { scale: 0.75 + easeBack(local) * 0.25, dy: 0, rotation: 0, active: false };
    case 'per-word-rotate':
      return { scale: 1, dy: 0, rotation: (1 - easeOut(local)) * -14, active: false };
    case 'elastic':
      return { scale: 1, dy: (1 - easeOut(local)) * 0.05, rotation: 0, active: false, elastic: true };
    case 'emphasis':
      return { scale: 1 + Math.sin(t * Math.PI) * 0.06, dy: 0, rotation: 0, active: false };
    case 'progressive':
      return { scale: 1, dy: 0, rotation: 0, active: false, reveal: clamp(local) };
    default:
      return { scale: 1, dy: 0, rotation: 0, active: false };
  }
}

export function cueProgress(cue, time) {
  if (!cue?.duration) return 0;
  return clamp((time - cue.start) / cue.duration);
}

/* ------------------------------------------------------------------------- */
/* .cube LUT                                                                 */
/* ------------------------------------------------------------------------- */

/* Parse a Resolve/Adobe .cube into a cube of RGB triples. The browser applies
 * it with trilinear interpolation; the server passes the original file to
 * FFmpeg's lut3d filter, so both use the same calibration. */
export function parseCube(text) {
  const lines = String(text || '').split(/\r?\n/);
  let size = 0;
  let title = 'LUT';
  const data = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) { title = line.replace(/^TITLE\s+/i, '').replace(/"/g, ''); continue; }
    if (upper.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (upper.startsWith('LUT_1D_SIZE')) { throw new Error('1D .cube LUTs are not supported'); }
    if (/^(DOMAIN_MIN|DOMAIN_MAX|LUT_3D_INPUT_RANGE)/.test(upper)) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) data.push(parts);
  }
  if (!size || size < 2 || size > 129) throw new Error('invalid or unsupported LUT_3D_SIZE');
  if (data.length !== size ** 3) throw new Error(`expected ${size ** 3} LUT entries, found ${data.length}`);
  return { title, size, data };
}

export function applyCube(lut, r, g, b) {
  if (!lut) return [r, g, b];
  const n = lut.size;
  const clampIndex = (v, max) => Math.min(max, Math.max(0, v));
  const fx = clampIndex(r, 1) * (n - 1);
  const fy = clampIndex(g, 1) * (n - 1);
  const fz = clampIndex(b, 1) * (n - 1);
  const x0 = Math.floor(fx); const y0 = Math.floor(fy); const z0 = Math.floor(fz);
  const x1 = Math.min(n - 1, x0 + 1); const y1 = Math.min(n - 1, y0 + 1); const z1 = Math.min(n - 1, z0 + 1);
  const tx = fx - x0; const ty = fy - y0; const tz = fz - z0;
  const at = (x, y, z) => lut.data[z * n * n + y * n + x];
  const lerp = (a, c, t) => a + (c - a) * t;
  const c000 = at(x0, y0, z0); const c100 = at(x1, y0, z0);
  const c010 = at(x0, y1, z0); const c110 = at(x1, y1, z0);
  const c001 = at(x0, y0, z1); const c101 = at(x1, y0, z1);
  const c011 = at(x0, y1, z1); const c111 = at(x1, y1, z1);
  return [0, 1, 2].map((i) => {
    const a = lerp(lerp(c000[i], c100[i], tx), lerp(c010[i], c110[i], tx), ty);
    const c = lerp(lerp(c001[i], c101[i], tx), lerp(c011[i], c111[i], tx), ty);
    return lerp(a, c, tz);
  });
}

/* ------------------------------------------------------------------------- */
/* Colour maths                                                              */
/* ------------------------------------------------------------------------- */

export const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  let h = 0; let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
}

/* Apply the editor's colour model. Values are the same ones written into the
 * FFmpeg plan, so an exported frame is within rounding of the preview. */
function curveValue(points, x) {
  if (!Array.isArray(points) || points.length < 2) return x;
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i += 1) {
    if (x <= pts[i][0]) {
      const a = pts[i - 1]; const b = pts[i];
      const span = Math.max(1e-6, b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * ((x - a[0]) / span);
    }
  }
  return x;
}

function applySelective(r, g, b, bands) {
  if (!Array.isArray(bands) || !bands.length) return [r, g, b];
  let [h, s, l] = rgbToHsl(clamp01(r), clamp01(g), clamp01(b));
  for (const band of bands) {
    if (!band || band.enabled === false) continue;
    const target = ((Number(band.hue) || 0) / 360 + 1) % 1;
    const range = Math.max(0.01, Number(band.range ?? 0.12));
    let dist = Math.abs(h - target);
    dist = Math.min(dist, 1 - dist);
    if (dist > range) continue;
    const weight = 1 - dist / range;
    s = clamp01(s + (Number(band.saturation) || 0) * weight);
    l = clamp01(l + (Number(band.luminance) || 0) * weight);
    h = (h + (Number(band.hueShift) || 0) / 360 * weight + 1) % 1;
  }
  return hslToRgb(h, s, l);
}

export function gradeColor(r, g, b, color = {}, lut = null) {
  const c = color || {};
  const exposure = 2 ** (Number(c.exposure) || 0);
  r *= exposure; g *= exposure; b *= exposure;
  const brightness = Number(c.brightness) || 0;
  r += brightness; g += brightness; b += brightness;
  const contrast = 1 + (Number(c.contrast) || 0);
  r = (r - 0.5) * contrast + 0.5; g = (g - 0.5) * contrast + 0.5; b = (b - 0.5) * contrast + 0.5;
  const temp = Number(c.temperature) || 0;
  const tint = Number(c.tint) || 0;
  r += temp * 0.08; b -= temp * 0.08; g += tint * 0.06;
  let [h, s, l] = rgbToHsl(clamp01(r), clamp01(g), clamp01(b));
  s *= 1 + (Number(c.saturation) || 0);
  const vibrance = Number(c.vibrance) || 0;
  s *= 1 + vibrance * (1 - s) * 0.8;
  h += (Number(c.hue) || 0) / 360;
  [r, g, b] = hslToRgb((h + 1) % 1, clamp01(s), l);
  const shadows = Number(c.shadows) || 0;
  const highlights = Number(c.highlights) || 0;
  const whites = Number(c.whites) || 0;
  const blacks = Number(c.blacks) || 0;
  const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const shadowMask = clamp01(1 - lum * 2);
  const highlightMask = clamp01((lum - 0.45) * 2);
  const blackMask = clamp01(1 - lum * 4.5);
  const whiteMask = clamp01((lum - 0.55) * 2.5);
  const tonal = shadows * shadowMask + highlights * highlightMask + blacks * blackMask * 0.28 + whites * whiteMask * 0.28;
  r += tonal; g += tonal; b += tonal;
  [r, g, b] = applySelective(r, g, b, c.selective);
  const curves = c.curves || {};
  if (curves.master?.length) { r = curveValue(curves.master, clamp01(r)); g = curveValue(curves.master, clamp01(g)); b = curveValue(curves.master, clamp01(b)); }
  if (curves.red?.length) r = curveValue(curves.red, clamp01(r));
  if (curves.green?.length) g = curveValue(curves.green, clamp01(g));
  if (curves.blue?.length) b = curveValue(curves.blue, clamp01(b));
  const gamma = Math.max(0.1, Number(c.gamma) || 1);
  r = (clamp01(r) ** (1 / gamma)); g = (clamp01(g) ** (1 / gamma)); b = (clamp01(b) ** (1 / gamma));
  const lift = c.lift || [0, 0, 0];
  const gain = c.gain || [1, 1, 1];
  const gammaRGB = c.gammaRGB || [1, 1, 1];
  r = clamp01((r + (Number(lift[0]) || 0)) * (Number(gain[0]) || 1)) ** (1 / Math.max(0.1, Number(gammaRGB[0]) || 1));
  g = clamp01((g + (Number(lift[1]) || 0)) * (Number(gain[1]) || 1)) ** (1 / Math.max(0.1, Number(gammaRGB[1]) || 1));
  b = clamp01((b + (Number(lift[2]) || 0)) * (Number(gain[2]) || 1)) ** (1 / Math.max(0.1, Number(gammaRGB[2]) || 1));
  if (lut) {
    const [lr, lg, lb] = applyCube(lut, clamp01(r), clamp01(g), clamp01(b));
    const amount = clamp01(Number(c.lutIntensity ?? 1));
    r += (lr - r) * amount; g += (lg - g) * amount; b += (lb - b) * amount;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/* Parse a #rrggbb(a) value into 0..1 channels. */
export function parseColor(value) {
  const s = String(value || '#ffffff').trim();
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgba) {
    const parts = rgba[1].split(',').map(Number);
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1];
  }
  return [1, 1, 1, 1];
}

export function rgba(value, alpha = 1) {
  const [r, g, b, a] = parseColor(value);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${clamp01(a * alpha)})`;
}
