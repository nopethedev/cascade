// PowerPoint (.pptx) → Cascade deck content.
//
// Import is intentionally lossless where the editor can express it: slide
// geometry, backgrounds, notes, transitions, text, solid shapes, pictures and
// simple tables. Text is flattened to the editor's single-style text element
// (the editor has no rich-text runs yet), so mixed formatting inside one text
// box keeps the first run's style. Everything is measured in EMUs and scaled
// to the editor's 1280px-wide slide grid, which keeps layouts pixel-accurate
// when the deck is exported back to PPTX.
import JSZip from 'jszip';
import { parseXml, elements, child, childrenOf, find, findAll, attr, textContent, paragraphText } from './ooxml.js';

const EMU_PER_PX = 9525; // 96 dpi
const DEFAULT_CX = 12192000; // 13.333in
const DEFAULT_CY = 6858000; // 7.5in

const px = (emu) => (Number(emu) || 0) / EMU_PER_PX;
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

function normalizeHex(value) {
  const raw = String(value || '').replace(/^#/, '').trim();
  if (/^[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(raw)) return raw.split('').map((c) => `${c}${c}`).join('').toUpperCase();
  if (/^[0-9a-f]{8}$/i.test(raw)) return raw.slice(0, 6).toUpperCase();
  return null;
}

function hexRgb(hex) {
  const value = normalizeHex(hex) || '000000';
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function luminance(hex) {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function lastSegment(path) {
  return String(path || '').split('/').filter(Boolean).pop() || '';
}

function dirname(path) {
  const parts = String(path || '').split('/');
  parts.pop();
  return parts.join('/');
}

function resolvePath(baseFile, target) {
  const raw = String(target || '');
  const combined = raw.startsWith('/') ? raw.slice(1) : `${dirname(baseFile)}/${raw}`;
  const out = [];
  for (const part of combined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function relsPath(partPath) {
  return `${dirname(partPath)}/_rels/${lastSegment(partPath)}.rels`;
}

async function readXml(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  const parsed = parseXml(await file.async('string'));
  // parseXml returns a synthetic #root wrapper; callers want the document
  // element (p:sld, p:presentation, p:sldMaster, ...).
  return elements(parsed)[0] || parsed;
}

async function readRels(zip, partPath) {
  const doc = await readXml(zip, relsPath(partPath));
  const map = new Map();
  if (!doc) return map;
  for (const rel of findAll(doc, 'Relationship')) {
    map.set(attr(rel, 'Id'), {
      target: attr(rel, 'Target'),
      type: attr(rel, 'Type'),
      external: attr(rel, 'TargetMode') === 'External',
    });
  }
  return map;
}

function relOfType(rels, suffix) {
  for (const [id, rel] of rels) {
    if (String(rel.type || '').endsWith(suffix)) return { id, ...rel };
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Theme + colour                                                            */
/* ------------------------------------------------------------------------- */

function readTheme(themeDoc) {
  const scheme = find(themeDoc, 'a:clrScheme');
  const colors = {};
  if (scheme) {
    for (const slot of elements(scheme)) {
      const srgb = child(slot, 'a:srgbClr');
      const sys = child(slot, 'a:sysClr');
      const value = srgb ? normalizeHex(attr(srgb, 'val')) : sys ? normalizeHex(attr(sys, 'lastClr')) : null;
      if (value) colors[slot.name.replace(/^a:/, '')] = value;
    }
  }
  const fonts = { major: 'Arial', minor: 'Arial' };
  const major = find(themeDoc, 'a:majorFont');
  const minor = find(themeDoc, 'a:minorFont');
  if (major && attr(child(major, 'a:latin'), 'typeface')) fonts.major = attr(child(major, 'a:latin'), 'typeface');
  if (minor && attr(child(minor, 'a:latin'), 'typeface')) fonts.minor = attr(child(minor, 'a:latin'), 'typeface');
  return { colors, fonts };
}

function readColorMap(masterDoc) {
  const map = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', hlink: 'hlink', folHlink: 'folHlink', phClr: 'phClr' };
  const node = find(masterDoc, 'p:clrMap');
  if (node) for (const [key, value] of Object.entries(node.attrs || {})) map[key] = value;
  return map;
}

function applyColorMods(hex, colorNode) {
  let [r, g, b] = hexRgb(hex);
  let alpha = 1;
  for (const mod of elements(colorNode)) {
    const value = Number(attr(mod, 'val', '100000')) / 100000;
    if (!Number.isFinite(value)) continue;
    if (mod.name === 'a:alpha') alpha *= clamp(value, 0, 1);
    else if (mod.name === 'a:lumMod' || mod.name === 'a:shade') {
      r *= value; g *= value; b *= value;
    } else if (mod.name === 'a:lumOff') {
      r += value * 255; g += value * 255; b += value * 255;
    } else if (mod.name === 'a:tint') {
      r += (255 - r) * (1 - value); g += (255 - g) * (1 - value); b += (255 - b) * (1 - value);
    }
  }
  return { hex: `${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase(), alpha: clamp(alpha, 0, 1) };
}

function colorFromNode(node, ctx) {
  if (!node) return null;
  if (node.name === 'a:srgbClr') return applyColorMods(normalizeHex(attr(node, 'val')) || '000000', node);
  if (node.name === 'a:schemeClr') {
    const name = attr(node, 'val');
    const mapped = ctx.clrMap[name] || name;
    const value = ctx.theme.colors[mapped] || ctx.theme.colors[name];
    if (!value) return null;
    return applyColorMods(value, node);
  }
  if (node.name === 'a:sysClr') return applyColorMods(normalizeHex(attr(node, 'lastClr')) || '000000', node);
  if (node.name === 'a:prstClr') {
    const named = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080' };
    return { hex: named[attr(node, 'val')] || null, alpha: 1 };
  }
  return null;
}

/** Read the first solid/gradient fill below `parent`. */
function readFill(parent, ctx) {
  if (!parent) return null;
  for (const entry of parent.children || []) {
    if (entry.name === 'a:noFill') return { none: true };
    if (entry.name === 'a:solidFill') {
      const color = colorFromNode(elements(entry)[0], ctx);
      return color && color.hex ? color : null;
    }
    if (entry.name === 'a:gradFill') {
      const stop = find(entry, 'a:gs');
      const color = stop ? colorFromNode(elements(stop)[0], ctx) : null;
      return color && color.hex ? color : null;
    }
    if (entry.name === 'a:blipFill') return null;
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Geometry                                                                  */
/* ------------------------------------------------------------------------- */

function frameOf(xfrm) {
  if (!xfrm) return null;
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  if (!off || !ext) return null;
  return {
    x: Number(attr(off, 'x')) || 0,
    y: Number(attr(off, 'y')) || 0,
    w: Number(attr(ext, 'cx')) || 0,
    h: Number(attr(ext, 'cy')) || 0,
    rot: (Number(attr(xfrm, 'rot')) || 0) / 60000,
  };
}

// Group transforms work in EMUs; every caller wants the editor's 96dpi pixel
// grid, so the conversion happens here once.
function transformPoint(frame, tx) {
  if (!frame) return null;
  return {
    x: (tx.dx + frame.x * tx.sx) / EMU_PER_PX,
    y: (tx.dy + frame.y * tx.sy) / EMU_PER_PX,
    w: (frame.w * tx.sx) / EMU_PER_PX,
    h: (frame.h * tx.sy) / EMU_PER_PX,
    rot: frame.rot || 0,
  };
}

function placeholderType(sp) {
  const ph = find(sp, 'p:ph');
  if (!ph) return null;
  return attr(ph, 'type', 'body');
}

function placeholderFrame(layoutShapes, type) {
  if (!type) return null;
  return layoutShapes.get(type) || layoutShapes.get('body') || layoutShapes.get('obj') || null;
}

/* ------------------------------------------------------------------------- */
/* Text                                                                      */
/* ------------------------------------------------------------------------- */

function fontFace(name, ctx) {
  const value = String(name || '').trim();
  if (!value) return '';
  if (value === '+mj-lt' || value === '+mj-ea' || value === '+mj-cs') return ctx.theme.fonts.major;
  if (value === '+mn-lt' || value === '+mn-ea' || value === '+mn-cs') return ctx.theme.fonts.minor;
  return value.replace(/^["']|["']$/g, '').split(',')[0].trim();
}

function runStyle(rPr, ctx) {
  const style = {};
  if (!rPr) return style;
  if (attr(rPr, 'sz')) style.sizePt = Number(attr(rPr, 'sz')) / 100;
  if (attr(rPr, 'b') === '1') style.bold = true;
  if (attr(rPr, 'i') === '1') style.italic = true;
  if (['sng', 'dbl', 'heavy', 'words'].includes(attr(rPr, 'u'))) style.underline = true;
  if (['sngStrike', 'dblStrike'].includes(attr(rPr, 'strike'))) style.strike = true;
  const fill = readFill(rPr, ctx);
  if (fill && fill.hex) style.color = fill.hex;
  const latin = child(rPr, 'a:latin');
  if (latin && attr(latin, 'typeface')) style.font = fontFace(attr(latin, 'typeface'), ctx);
  if (attr(rPr, 'spc')) style.letterSpacingPt = Number(attr(rPr, 'spc')) / 100;
  return style;
}

function paragraphSpacing(pPr) {
  const lnSpc = child(pPr, 'a:lnSpc');
  if (!lnSpc) return null;
  const percent = child(lnSpc, 'a:spcPct');
  if (percent) return clamp((Number(attr(percent, 'val')) || 100000) / 1000, 60, 240);
  const points = child(lnSpc, 'a:spcPts');
  if (points) return clamp(((Number(attr(points, 'val')) || 1800) / 100) * 6.25, 60, 240);
  return null;
}

function bulletPrefix(pPr, level, counters) {
  if (!pPr) return level ? '\u00a0\u00a0\u00a0'.repeat(level) : '';
  const char = child(pPr, 'a:buChar');
  const auto = child(pPr, 'a:buAutoNum');
  const none = child(pPr, 'a:buNone');
  const indent = '\u00a0\u00a0'.repeat(level);
  if (none) return indent;
  if (char) return `${indent}${attr(char, 'char', '•')} `;
  if (auto) {
    counters[level] = (counters[level] || 0) + 1;
    for (let i = level + 1; i < counters.length; i += 1) counters[i] = 0;
    const type = attr(auto, 'type', 'arabicPeriod');
    const value = counters[level];
    if (type.startsWith('arabic')) return `${indent}${value}. `;
    if (type.startsWith('alphaLc')) return `${indent}${String.fromCharCode(96 + ((value - 1) % 26) + 1)}. `;
    if (type.startsWith('alphaUc')) return `${indent}${String.fromCharCode(64 + ((value - 1) % 26) + 1)}. `;
    if (type.startsWith('romanLc')) return `${indent}${roman(value).toLowerCase()}. `;
    if (type.startsWith('romanUc')) return `${indent}${roman(value)}. `;
    return `${indent}${value}. `;
  }
  return indent;
}

function roman(value) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let n = Math.max(1, Math.min(3999, Number(value) || 1));
  let out = '';
  for (const [amount, glyph] of table) {
    while (n >= amount) {
      out += glyph;
      n -= amount;
    }
  }
  return out;
}

function readTextBody(container, ctx, defaults, bodyTag = 'p:txBody') {
  const body = child(container, bodyTag);
  if (!body) return null;
  const bodyPr = child(body, 'a:bodyPr');
  const anchor = attr(bodyPr, 'anchor', 't');
  const insets = {
    left: px(attr(bodyPr, 'lIns', '91440')),
    right: px(attr(bodyPr, 'rIns', '91440')),
    top: px(attr(bodyPr, 'tIns', '45720')),
    bottom: px(attr(bodyPr, 'bIns', '45720')),
  };
  const lines = [];
  const counters = [];
  let style = null;
  let align = 'left';
  let lineHeight = null;
  let hasText = false;

  for (const p of childrenOf(body, 'a:p')) {
    const pPr = child(p, 'a:pPr');
    const algn = attr(pPr, 'algn');
    if (algn && !hasText) align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left';
    if (!lineHeight) lineHeight = paragraphSpacing(pPr);
    const level = clamp(Number(attr(pPr, 'lvl')) || 0, 0, 8);
    let line = '';
    for (const entry of p.children || []) {
      if (entry.name === '#text') continue;
      if (entry.name === 'a:br') {
        line += '\n';
        continue;
      }
      if (entry.name === 'a:fld') {
        line += textContent(entry);
        continue;
      }
      if (entry.name !== 'a:r') continue;
      const rPr = child(entry, 'a:rPr');
      const run = runStyle(rPr, ctx);
      const text = textContent(entry);
      if (text && !style) style = run;
      if (text) hasText = true;
      line += text;
    }
    if (!line && !hasText) {
      // Paragraphs that only carry endParaRPr still establish the text style.
      const def = child(pPr, 'a:defRPr') || child(p, 'a:endParaRPr');
      if (!style && def) style = runStyle(def, ctx);
    }
    lines.push(`${bulletPrefix(pPr, level, counters)}${line}`);
  }

  const text = lines.join('\n').replace(/\n+$/, '');
  if (!text.trim()) return { text: '', insets, anchor };

  const effective = style || {};
  let sizePt = effective.sizePt || defaults.sizePt || 18;
  if (effective.sizePt) sizePt = effective.sizePt;
  return {
    text,
    insets,
    anchor,
    align,
    sizePt,
    color: effective.color || defaults.color || '#111111',
    bold: !!effective.bold,
    italic: !!effective.italic,
    underline: !!effective.underline,
    strike: !!effective.strike,
    font: effective.font || '',
    letterSpacing: effective.letterSpacingPt ? effective.letterSpacingPt * (4 / 3) : 0,
    lineHeight: lineHeight || 120,
  };
}

/* ------------------------------------------------------------------------- */
/* Layout defaults                                                           */
/* ------------------------------------------------------------------------- */

function placeholderSizes(doc) {
  const map = new Map();
  if (!doc) return map;
  for (const sp of findAll(doc, 'p:sp')) {
    const ph = find(sp, 'p:ph');
    if (!ph) continue;
    const type = attr(ph, 'type', 'body');
    let size = null;
    for (const def of findAll(sp, 'a:defRPr')) {
      if (attr(def, 'sz')) {
        size = Number(attr(def, 'sz')) / 100;
        break;
      }
    }
    if (!size) {
      for (const run of findAll(sp, 'a:rPr')) {
        if (attr(run, 'sz')) {
          size = Number(attr(run, 'sz')) / 100;
          break;
        }
      }
    }
    if (size && !map.has(type)) map.set(type, size);
  }
  return map;
}

function placeholderFrames(doc) {
  const map = new Map();
  if (!doc) return map;
  for (const sp of findAll(doc, 'p:sp')) {
    const ph = find(sp, 'p:ph');
    if (!ph) continue;
    const type = attr(ph, 'type', 'body');
    const frame = frameOf(child(child(sp, 'p:spPr'), 'a:xfrm'));
    if (frame && !map.has(type)) map.set(type, frame);
  }
  return map;
}

function masterTextSizes(doc) {
  const map = new Map();
  if (!doc) return map;
  const read = (styleNode) => {
    if (!styleNode) return null;
    const level = child(styleNode, 'a:lvl1pPr');
    const def = child(level, 'a:defRPr');
    return attr(def, 'sz') ? Number(attr(def, 'sz')) / 100 : null;
  };
  const title = read(find(doc, 'p:titleStyle'));
  const body = read(find(doc, 'p:bodyStyle'));
  const other = read(find(doc, 'p:otherStyle'));
  if (title) map.set('title', title);
  if (body) map.set('body', body);
  if (other) map.set('other', other);
  return map;
}

/* ------------------------------------------------------------------------- */
/* Slide walking                                                             */
/* ------------------------------------------------------------------------- */

function tableElements(frame, tx, tbl, ctx, defaults) {
  const out = [];
  const grid = child(tbl, 'a:tblGrid');
  const columns = childrenOf(grid, 'a:gridCol').map((col) => Number(attr(col, 'w')) || 0);
  const rows = childrenOf(tbl, 'a:tr');
  if (!columns.length || !rows.length) return out;

  const tableW = frame.w || columns.reduce((a, b) => a + b, 0);
  const startX = frame.x;
  const startY = frame.y;
  let y = startY;
  const headerFill = ctx.theme.colors.accent1 || '4472C4';

  rows.forEach((tr, rowIndex) => {
    const rowH = Number(attr(tr, 'h')) || 0;
    let x = startX;
    const cells = childrenOf(tr, 'a:tc');
    cells.forEach((tc, colIndex) => {
      const span = clamp(Number(attr(tc, 'gridSpan')) || 1, 1, columns.length);
      const colW = columns.slice(colIndex, colIndex + span).reduce((a, b) => a + b, 0) || tableW / columns.length;
      const isHeader = rowIndex === 0;
      const tcPr = child(tc, 'a:tcPr');
      const fill = readFill(tcPr, ctx);
      const cellFill = fill && fill.hex ? fill.hex : isHeader ? headerFill : 'FFFFFF';
      const cellFrame = transformPoint({ x, y, w: colW, h: rowH, rot: 0 }, tx);
      const boxW = cellFrame.w;
      const boxH = cellFrame.h;
      out.push({
        id: `t${out.length + 1}`,
        type: 'rect',
        x: Math.round(cellFrame.x),
        y: Math.round(cellFrame.y),
        w: Math.max(1, Math.round(boxW)),
        h: Math.max(1, Math.round(boxH)),
        fill: `#${cellFill}`,
        borderWidth: 1,
        borderColor: '#D9D9D9',
      });
      const text = readTextBody(tc, ctx, {
        sizePt: defaults.sizePt || 14,
        color: isHeader ? '#FFFFFF' : '#111111',
      }, 'a:txBody');
      if (text?.text) {
        out.push({
          id: `tt${out.length + 1}`,
          type: 'text',
          x: Math.round(cellFrame.x + 6),
          y: Math.round(cellFrame.y + 4),
          w: Math.max(8, Math.round(boxW) - 12),
          h: Math.max(8, Math.round(boxH) - 8),
          text: text.text,
          size: Math.max(6, Math.round(text.sizePt * (4 / 3))),
          color: isHeader ? '#FFFFFF' : `#${text.color.replace(/^#/, '')}`,
          bold: isHeader ? true : text.bold,
          italic: text.italic,
          underline: text.underline,
          align: text.align,
          valign: 'middle',
          fontFamily: text.font,
          lineHeight: text.lineHeight,
          letterSpacing: text.letterSpacing,
        });
      }
      x += colW;
    });
    y += rowH;
  });
  return out;
}

async function pictureElement(zip, pic, rels, partPath, ctx, frame) {
  const blip = find(pic, 'a:blip');
  const rid = blip ? attr(blip, 'r:embed') : '';
  const rel = rid ? rels.get(rid) : null;
  if (!rel || rel.external) return null;
  const path = resolvePath(partPath, rel.target);
  const ext = (path.split('.').pop() || '').toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext];
  if (!mime) return null;
  const file = zip.file(path);
  if (!file) return null;
  const buffer = Buffer.from(await file.async('nodebuffer'));
  if (buffer.length > ctx.limits.imageBytes || ctx.totalBytes + buffer.length > ctx.limits.totalBytes) {
    ctx.skippedImages += 1;
    return null;
  }
  ctx.totalBytes += buffer.length;
  const blipFill = child(pic, 'p:blipFill');
  const stretch = blipFill && child(blipFill, 'a:stretch');
  const crop = blipFill && child(blipFill, 'a:srcRect');
  const nv = find(pic, 'p:cNvPr');
  return {
    id: '',
    type: 'image',
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    w: Math.max(1, Math.round(frame.w)),
    h: Math.max(1, Math.round(frame.h)),
    src: `data:${mime};base64,${buffer.toString('base64')}`,
    alt: attr(nv, 'descr', ''),
    fit: stretch ? 'fill' : crop ? 'cover' : 'cover',
    radius: 0,
    rotation: frame.rot ? Math.round(frame.rot * 10) / 10 : 0,
  };
}

function shapeStyleRef(sp, tag, ctx) {
  const style = child(sp, 'p:style');
  const ref = style ? child(style, tag) : null;
  if (!ref || (tag === 'a:fillRef' || tag === 'a:lnRef') && !(Number(attr(ref, 'idx')) > 0)) return null;
  return colorFromNode(elements(ref)[0], ctx);
}

function shapeFillElement(sp, ctx, frame) {
  const spPr = child(sp, 'p:spPr');
  const fill = readFill(spPr, ctx) || shapeStyleRef(sp, 'a:fillRef', ctx);
  if (!fill || !fill.hex) return null;
  const geom = child(spPr, 'a:prstGeom');
  const prst = attr(geom, 'prst', 'rect');
  const line = child(spPr, 'a:ln');
  const styleLine = shapeStyleRef(sp, 'a:lnRef', ctx);
  const lineFill = (line ? readFill(line, ctx) : null) || styleLine;
  const lineWidth = line ? px(attr(line, 'w', '12700')) : styleLine ? 1 : 0;
  let radius = 0;
  if (prst === 'roundRect') {
    const guide = find(geom, 'a:gd');
    radius = guide && attr(guide, 'name') === 'adj' ? (Number(attr(guide, 'fmla', '').replace(/[^\d]/g, '')) / 100000) * Math.min(frame.w, frame.h) : 0.12 * Math.min(frame.w, frame.h);
  }
  const isLine = prst === 'line' || prst === 'straightConnector1';
  const isEllipse = prst === 'ellipse' || prst === 'circle';
  return {
    id: '',
    type: isLine ? 'line' : isEllipse ? 'ellipse' : 'rect',
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    w: Math.max(1, Math.round(frame.w)),
    h: Math.max(1, Math.round(isLine ? Math.max(2, frame.h) : frame.h)),
    fill: `#${fill.hex}`,
    ...(fill.alpha < 1 ? { opacity: Math.round(fill.alpha * 100) } : {}),
    ...(radius ? { radius: Math.max(0, Math.round(radius)) } : {}),
    ...(lineFill && lineFill.hex && lineWidth > 0
      ? { borderWidth: Math.min(40, Math.max(1, Math.round(lineWidth))), borderColor: `#${lineFill.hex}` }
      : {}),
    ...(frame.rot ? { rotation: Math.round(frame.rot * 10) / 10 } : {}),
  };
}

function textElement(sp, body, frame, defaults, background) {
  const type = placeholderType(sp) || 'other';
  const sizePt = body.sizePt || defaults.sizes.get(type) || 18;
  const fallback = luminance(background) > 0.55 ? '#111111' : '#F4F4F5';
  const left = Math.round(frame.x + body.insets.left);
  const top = Math.round(frame.y + body.insets.top);
  const width = Math.max(8, Math.round(frame.w - body.insets.left - body.insets.right));
  const height = Math.max(8, Math.round(frame.h - body.insets.top - body.insets.bottom));
  const el = {
    id: '',
    type: 'text',
    x: left,
    y: top,
    w: width,
    h: height,
    text: body.text,
    size: Math.max(6, Math.round(sizePt * (4 / 3))),
    color: `#${String(body.color || fallback).replace(/^#/, '')}`,
    bold: !!body.bold,
    italic: !!body.italic,
    underline: !!body.underline || undefined,
    align: body.align,
    valign: body.anchor === 'ctr' ? 'middle' : body.anchor === 'b' ? 'bottom' : 'top',
    fontFamily: body.font || '',
    lineHeight: body.lineHeight,
    letterSpacing: body.letterSpacing,
    ...(frame.rot ? { rotation: Math.round(frame.rot * 10) / 10 } : {}),
  };
  return el;
}

function cleanElement(el) {
  const out = {};
  for (const [key, value] of Object.entries(el)) {
    if (value === undefined || value === '' || value === null) continue;
    if (key === 'underline' && !value) continue;
    out[key] = value;
  }
  return out;
}

async function walkTree(zip, nodes, ctx, partCtx, tx, out, defaults, background) {
  for (const node of nodes) {
    if (node.name === 'p:grpSp') {
      const grpPr = child(node, 'p:grpSpPr');
      const xfrm = child(grpPr, 'a:xfrm');
      const frame = frameOf(xfrm);
      let childTx = tx;
      if (xfrm && frame) {
        const chOff = child(xfrm, 'a:chOff');
        const chExt = child(xfrm, 'a:chExt');
        const ratioX = Number(attr(chExt, 'cx')) ? frame.w / Number(attr(chExt, 'cx')) : 1;
        const ratioY = Number(attr(chExt, 'cy')) ? frame.h / Number(attr(chExt, 'cy')) : 1;
        const chX = Number(attr(chOff, 'x')) || 0;
        const chY = Number(attr(chOff, 'y')) || 0;
        childTx = {
          dx: tx.dx + tx.sx * (frame.x - chX * ratioX),
          dy: tx.dy + tx.sy * (frame.y - chY * ratioY),
          sx: tx.sx * ratioX,
          sy: tx.sy * ratioY,
        };
      }
      await walkTree(zip, elements(node).filter((n) => !/^p:(nvGrpSpPr|grpSpPr)$/.test(n.name)), ctx, partCtx, childTx, out, defaults, background);
      continue;
    }

    if (node.name === 'p:sp') {
      const local = frameOf(child(child(node, 'p:spPr'), 'a:xfrm')) || placeholderFrame(defaults.frames, placeholderType(node));
      if (!local) continue;
      const frame = transformPoint(local, tx);
      if (!frame) continue;
      const fill = shapeFillElement(node, ctx, frame);
      if (fill) out.push(cleanElement(fill));
      const styleFont = shapeStyleRef(node, 'a:fontRef', ctx);
      const phType = placeholderType(node);
      const body = readTextBody(node, ctx, {
        // A plain text box uses the master's `otherStyle` (18pt), not the
        // body-placeholder size.
        sizePt: defaults.sizes.get(phType || 'other') || 18,
        color: styleFont && styleFont.hex ? `#${styleFont.hex}` : luminance(background) > 0.55 ? '#111111' : '#F4F4F5',
      });
      if (body?.text) out.push(cleanElement(textElement(node, body, frame, defaults, background)));
      continue;
    }

    if (node.name === 'p:pic') {
      const local = frameOf(child(child(node, 'p:spPr'), 'a:xfrm'));
      if (!local) continue;
      const frame = transformPoint(local, tx);
      const el = await pictureElement(zip, node, partCtx.rels, partCtx.partPath, ctx, frame);
      if (el) out.push(cleanElement(el));
      continue;
    }

    if (node.name === 'p:graphicFrame') {
      const xfrm = child(node, 'p:xfrm');
      if (!xfrm) continue;
      const local = frameOf(xfrm);
      if (!local) continue;
      const frame = transformPoint(local, tx);
      const tbl = find(node, 'a:tbl');
      if (tbl) {
        for (const el of tableElements(local, tx, tbl, ctx, { sizePt: 14, color: '#111111' })) out.push(cleanElement(el));
      }
      continue;
    }
  }
}

function slideTransition(sld) {
  const transition = child(sld, 'p:transition');
  if (!transition) return undefined;
  const names = ['fade', 'push', 'wipe', 'zoom', 'dissolve', 'cut'];
  const hit = elements(transition).find((entry) => names.includes(entry.name.replace(/^p:/, '')));
  if (!hit) return undefined;
  const type = hit.name.replace(/^p:/, '');
  const spd = attr(transition, 'spd', 'med');
  const duration = Number(attr(transition, 'p14:dur')) || (spd === 'fast' ? 300 : spd === 'slow' ? 900 : 550);
  return { type: type === 'dissolve' || type === 'cut' ? 'fade' : type, duration: clamp(duration, 150, 2500) };
}

// Slides inherit their background from the layout, then the master. Returning
// null lets the caller fall through that chain instead of assuming white.
function backgroundOf(doc, ctx) {
  const cSld = doc ? child(doc, 'p:cSld') : null;
  const bg = cSld ? child(cSld, 'p:bg') : null;
  if (!bg) return null;
  const bgPr = child(bg, 'p:bgPr');
  if (bgPr) {
    const fill = readFill(bgPr, ctx);
    if (fill && fill.hex) return `#${fill.hex}`;
  }
  const bgRef = child(bg, 'p:bgRef');
  const refColor = bgRef ? colorFromNode(elements(bgRef)[0], ctx) : null;
  return refColor && refColor.hex ? `#${refColor.hex}` : null;
}

async function readNotes(zip, slidePath, rels) {
  const rel = relOfType(rels, '/notesSlide');
  if (!rel) return '';
  const path = resolvePath(slidePath, rel.target);
  const doc = await readXml(zip, path);
  if (!doc) return '';
  for (const sp of findAll(doc, 'p:sp')) {
    const ph = find(sp, 'p:ph');
    if (!ph || attr(ph, 'type', 'body') !== 'body') continue;
    const body = child(sp, 'p:txBody');
    if (!body) continue;
    const lines = childrenOf(body, 'a:p').map((p) => paragraphText(p).trim()).filter(Boolean);
    if (lines.length) return lines.join('\n');
  }
  return '';
}

/* ------------------------------------------------------------------------- */
/* Entry point                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Convert a .pptx buffer into editable deck content.
 * @param {Buffer} buffer
 * @param {{imageBytes?: number, totalBytes?: number}} limits
 * @returns {Promise<{content: object, slides: number, skippedImages: number}>}
 */
export async function pptxToDeck(buffer, limits = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const presentationPath = 'ppt/presentation.xml';
  const presentation = await readXml(zip, presentationPath);
  if (!presentation) throw new Error('This file is not a PowerPoint presentation.');

  const presRels = await readRels(zip, presentationPath);
  const size = find(presentation, 'p:sldSz');
  const cx = Number(attr(size, 'cx')) || DEFAULT_CX;
  const cy = Number(attr(size, 'cy')) || DEFAULT_CY;
  // The editor grid is 96 dpi, so a standard 16:9 slide becomes 1280×720 and
  // a 4:3 slide 960×720. Export converts the same grid back to inches.
  const slideW = Math.max(320, Math.min(4096, Math.round(cx / EMU_PER_PX)));
  const slideH = Math.max(180, Math.min(4096, Math.round(cy / EMU_PER_PX)));

  // Theme + master defaults (colour map, placeholder sizes and frames).
  const masterRel = relOfType(presRels, '/slideMaster');
  const masterPath = masterRel ? resolvePath(presentationPath, masterRel.target) : 'ppt/slideMasters/slideMaster1.xml';
  const masterDoc = await readXml(zip, masterPath);
  const masterRels = await readRels(zip, masterPath);
  const themeRel = relOfType(masterRels, '/theme');
  const themePath = themeRel ? resolvePath(masterPath, themeRel.target) : 'ppt/theme/theme1.xml';
  const themeDoc = await readXml(zip, themePath);
  const theme = readTheme(themeDoc);
  const clrMap = readColorMap(masterDoc);
  const sizes = masterTextSizes(masterDoc);

  const slidePaths = [];
  const idList = find(presentation, 'p:sldIdLst');
  if (idList) {
    for (const entry of childrenOf(idList, 'p:sldId')) {
      const rel = presRels.get(attr(entry, 'r:id'));
      if (rel) slidePaths.push(resolvePath(presentationPath, rel.target));
    }
  }
  if (!slidePaths.length) {
    for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      slidePaths.push(name);
    }
    slidePaths.sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] || 0) - Number(b.match(/(\d+)\.xml$/)?.[1] || 0));
  }
  if (!slidePaths.length) throw new Error('The presentation contains no slides.');

  const ctx = {
    zip,
    theme,
    clrMap,
    totalBytes: 0,
    skippedImages: 0,
    limits: {
      imageBytes: limits.imageBytes || 4 * 1024 * 1024,
      totalBytes: limits.totalBytes || 8 * 1024 * 1024,
    },
  };

  const slides = [];
  for (let i = 0; i < slidePaths.length; i += 1) {
    const path = slidePaths[i];
    const sld = await readXml(zip, path);
    if (!sld) continue;
    const cSld = child(sld, 'p:cSld');
    const rels = await readRels(zip, path);
    const layoutRel = relOfType(rels, '/slideLayout');
    const layoutDoc = layoutRel ? await readXml(zip, resolvePath(path, layoutRel.target)) : null;
    const background = backgroundOf(sld, ctx) || backgroundOf(layoutDoc, ctx) || backgroundOf(masterDoc, ctx) || '#FFFFFF';
    const defaults = {
      sizes: new Map([...sizes, ...placeholderSizes(layoutDoc)]),
      frames: placeholderFrames(layoutDoc),
    };
    const tree = child(cSld, 'p:spTree');
    const out = [];
    if (tree) {
      await walkTree(zip, elements(tree).filter((n) => !/^p:(nvGrpSpPr|grpSpPr)$/.test(n.name)), ctx, { partPath: path, rels }, { dx: 0, dy: 0, sx: 1, sy: 1 }, out, defaults, background);
    }
    const transition = slideTransition(sld);
    slides.push({
      id: `s${slides.length + 1}`,
      bg: background,
      notes: await readNotes(zip, path, rels),
      elements: out.map((el) => ({
        ...el,
        id: `${el.type === 'text' ? 't' : el.type === 'image' ? 'i' : 'e'}${Math.random().toString(36).slice(2, 8)}`,
      })),
      ...(transition ? { transition } : {}),
    });
  }

  if (!slides.length) throw new Error('The presentation contains no readable slides.');
  return { content: { w: slideW, h: slideH, slides }, slides: slides.length, skippedImages: ctx.skippedImages };
}
