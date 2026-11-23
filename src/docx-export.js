// Word (.docx) export that mirrors the Cascade document editor.
//
// The editor page is a 860px sheet with 62px side padding, Inter/system sans at
// 15.5px and 1.72 line-height. This writer reproduces those measurements on a
// Letter page (a 736px text column, Arial for portable rendering), maps the
// editor's headings, lists, quotes, code blocks, tables, figures, inline
// colours and highlights to native WordprocessingML, and deliberately avoids
// Word's built-in Heading styles so the document does not turn blue Calibri on
// a machine that has never seen Cascade.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { parse } from 'node-html-parser';
import { embeddableImage } from './export-assets.js';

const FONT = 'Arial';
const MONO = 'Courier New';
const TEXT = '17181C'; // light-theme --text, the page colour authors see
const HEADING = '17181C';
const MUTED = '59616D';
const RULE = 'CFD4DC'; // --line-2
const SHADE = 'EEF1F5'; // --sunken
const QUOTE = '59616D';
const ACCENT = 'E11D48';
const BODY_PX = 15.5;
const BODY_HALF = 23; // 11.5pt
// CSS line-height is a multiple of the font size, while Word's "auto" line
// rule multiplies Word's own single-line height. Use exact heights (twips) so
// line density matches the editor instead of drifting ~15%.
const BODY_LINE = 400; // 15.5px × 1.72
const H1_LINE = 774; // 30px × 1.72
const H2_LINE = 542; // 21px × 1.72
const H3_LINE = 439; // 17px × 1.72
const CODE_LINE = 309; // 12.5px × 1.65
const CELL_LINE = 361; // 14px × 1.72
const CAPTION_LINE = 242; // 11.5px × 1.4
const CONTENT_TWIP = 11040; // 7.667in = 736px
const MAX_IMAGE_PX = 736;
const PAGE = {
  size: { width: 12240, height: 15840 }, // US Letter
  margin: { top: 780, right: 600, bottom: 780, left: 600, header: 360, footer: 360 },
};

const twip = (value) => Math.round(Number(value) * 15);
const halfPoint = (value) => Math.max(2, Math.round(Number(value) * 1.5));

/* ------------------------------------------------------------------------- */
/* CSS helpers                                                               */
/* ------------------------------------------------------------------------- */

function styleMap(node) {
  const raw = String(node?.getAttribute?.('style') || '');
  const out = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf(':');
    if (index <= 0) continue;
    out[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim();
  }
  return out;
}

const NAMED_COLORS = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
  yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080',
};

function cssColor(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/.test(raw)) return raw.slice(1).split('').map((c) => `${c}${c}`).join('').toUpperCase();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(raw);
  if (rgb) {
    return rgb
      .slice(1, 4)
      .map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  return NAMED_COLORS[raw] || null;
}

function cssPx(value, base = BODY_PX) {
  const match = /^(-?[\d.]+)\s*(px|pt|em|rem)?$/i.exec(String(value || '').trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  if (match[2] === 'pt') return amount * (4 / 3);
  if (match[2] === 'em' || match[2] === 'rem') return amount * base;
  return amount;
}

function fontName(value) {
  const first = String(value || '').split(',')[0].replace(/^["']|["']$/g, '').trim();
  if (!first) return '';
  if (/^serif$/i.test(first)) return 'Times New Roman';
  if (/^sans-serif$/i.test(first)) return FONT;
  if (/^monospace$/i.test(first)) return MONO;
  if (/^(system-ui|ui-sans-serif|ui-monospace|-apple-system)$/i.test(first)) return FONT;
  return first;
}

function alignmentOf(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'center' || v === 'centre') return AlignmentType.CENTER;
  if (v === 'right' || v === 'end') return AlignmentType.RIGHT;
  if (v === 'justify') return AlignmentType.JUSTIFIED;
  return undefined;
}

function applyCssToFormat(format, style) {
  const color = cssColor(style.color);
  if (color) format.color = color;
  const background = cssColor(style['background-color'] || style['background']);
  if (background) format.fill = background;
  const size = cssPx(style['font-size']);
  if (size) format.size = halfPoint(size);
  const family = fontName(style['font-family']);
  if (family) format.font = family;
  if (/^(bold|[6-9]00)$/i.test(String(style['font-weight'] || ''))) format.bold = true;
  if (/^italic$/i.test(String(style['font-style'] || ''))) format.italic = true;
  const decoration = String(style['text-decoration'] || '');
  if (decoration.includes('underline')) format.underline = true;
  if (decoration.includes('line-through')) format.strike = true;
  const vertical = String(style['vertical-align'] || '');
  if (vertical === 'super') format.superScript = true;
  if (vertical === 'sub') format.subScript = true;
}

function makeTextRun(text, format) {
  return new TextRun({
    text,
    font: format.font || FONT,
    size: format.size || BODY_HALF,
    bold: !!format.bold,
    italics: !!format.italic,
    color: format.color || TEXT,
    strike: !!format.strike,
    superScript: !!format.superScript,
    subScript: !!format.subScript,
    ...(format.underline ? { underline: { type: 'single', color: format.color || TEXT } } : {}),
    ...(format.fill ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: format.fill } } : {}),
    ...(format.spacing ? { characterSpacing: Math.round(format.spacing * 20) } : {}),
  });
}

/* ------------------------------------------------------------------------- */
/* Inline runs                                                               */
/* ------------------------------------------------------------------------- */

function normalizeInlineText(text) {
  return String(text || '').replace(/[ \t\r\n]+/g, ' ');
}

function inlineRuns(node, base) {
  const runs = [];
  const pushText = (value, format) => {
    const text = normalizeInlineText(value);
    if (!text) return;
    if (!runs.length) {
      const trimmed = text.replace(/^ /, '');
      if (trimmed) runs.push(makeTextRun(trimmed, format));
      return;
    }
    runs.push(makeTextRun(text, format));
  };

  for (const entry of node.childNodes || []) {
    if (entry.nodeType === 3) {
      pushText(entry.text, base);
      continue;
    }
    if (entry.nodeType !== 1) continue;
    const tag = String(entry.rawTagName || '').toLowerCase();
    if (tag === 'br') {
      runs.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (tag === 'img' || tag === 'script' || tag === 'style' || tag === 'figcaption') continue;
    // Lists are block-level and handled by listBlock; skipping them here keeps
    // nested list text out of the parent item's paragraph.
    if (tag === 'ul' || tag === 'ol') continue;

    const format = { ...base };
    if (tag === 'strong' || tag === 'b') format.bold = true;
    if (tag === 'em' || tag === 'i') format.italic = true;
    if (tag === 'u') format.underline = true;
    if (tag === 's' || tag === 'strike' || tag === 'del') format.strike = true;
    if (tag === 'sup') format.superScript = true;
    if (tag === 'sub') format.subScript = true;
    if (tag === 'code' || tag === 'kbd' || tag === 'samp') {
      format.font = MONO;
      format.size = 20;
      if (!format.fill) format.fill = SHADE;
    }
    if (tag === 'mark') {
      format.fill = format.fill || 'FEF08A';
      format.color = '713F12';
    }
    const fontColor = cssColor(entry.getAttribute?.('color'));
    if (fontColor) format.color = fontColor;
    applyCssToFormat(format, styleMap(entry));

    if (tag === 'a') {
      const href = String(entry.getAttribute?.('href') || '').trim();
      if (href) {
        const linkFormat = { ...format, color: ACCENT, underline: true };
        const children = inlineRuns(entry, linkFormat).filter((child) => child instanceof TextRun);
        if (children.length) runs.push(new ExternalHyperlink({ link: href, children }));
        continue;
      }
    }

    runs.push(...inlineRuns(entry, format));
  }
  return runs;
}

/* ------------------------------------------------------------------------- */
/* Block formatting                                                          */
/* ------------------------------------------------------------------------- */

const HEADINGS = [
  { size: 30, before: 0, after: 14, outline: 0, line: H1_LINE },
  { size: 21, before: 26, after: 10, outline: 1, line: H2_LINE },
  { size: 17, before: 20, after: 8, outline: 2, line: H3_LINE },
];

function paragraphProperties(node, options) {
  const style = styleMap(node);
  const align = alignmentOf(style['text-align'] || node?.getAttribute?.('align')) || options.alignment;
  return {
    ...(align ? { alignment: align } : {}),
    spacing: {
      before: twip(options.before || 0),
      after: twip(options.after ?? 10),
      line: options.line || BODY_LINE,
      lineRule: options.lineRule || LineRuleType.AT_LEAST,
    },
    ...(options.outlineLevel !== undefined ? { outlineLevel: options.outlineLevel } : {}),
    ...(options.keepNext ? { keepNext: true } : {}),
    ...(options.indent ? { indent: options.indent } : {}),
    ...(options.border ? { border: options.border } : {}),
    ...(options.shading ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: options.shading } } : {}),
  };
}

function blockParagraph(node, options = {}) {
  const format = {
    font: FONT,
    size: halfPoint(options.sizePx || BODY_PX),
    color: options.color || TEXT,
    bold: !!options.bold,
    ...(options.format || {}),
  };
  applyCssToFormat(format, styleMap(node));
  const runs = inlineRuns(node, format);
  if (!runs.length) runs.push(makeTextRun('', format));
  return new Paragraph({
    children: runs,
    ...paragraphProperties(node, {
      before: options.before || 0,
      after: options.compact ? 0 : options.after ?? 10,
      line: options.line || BODY_LINE,
      outlineLevel: options.outlineLevel,
      keepNext: options.keepNext,
      indent: options.indent,
      border: options.border,
      shading: options.shading,
      alignment: options.alignment,
    }),
  });
}

async function imageParagraphs(imgNode, resolveImage, options = {}) {
  const src = imgNode.getAttribute?.('src') || '';
  const alt = imgNode.getAttribute?.('alt') || '';
  const image = await embeddableImage(src, resolveImage);
  if (!image) {
    const label = alt || options.caption || '';
    if (!label) return [];
    return [
      new Paragraph({
        children: [makeTextRun(`[Image: ${label}]`, { italics: true, color: MUTED })],
        ...paragraphProperties(null, { after: 10, alignment: options.alignment }),
      }),
    ];
  }

  const style = styleMap(imgNode);
  const declared = cssPx(style.width) ?? (Number(imgNode.getAttribute?.('width')) || null);
  const naturalWidth = Math.max(1, Number(image.width) || 600);
  const naturalHeight = Math.max(1, Number(image.height) || 400);
  let width = options.full ? MAX_IMAGE_PX : declared ? Math.min(MAX_IMAGE_PX, declared) : Math.min(MAX_IMAGE_PX, naturalWidth);
  width = Math.max(24, width);
  const height = Math.max(24, Math.round((width * naturalHeight) / naturalWidth));

  const out = [
    new Paragraph({
      children: [
        new ImageRun({
          data: image.buffer,
          type: image.type,
          transformation: { width: Math.round(width), height },
        }),
      ],
      // Inline images must not be clipped by an exact line height.
      ...paragraphProperties(null, { before: 10, after: options.caption ? 2 : 10, line: 240, lineRule: LineRuleType.AUTO, alignment: options.alignment }),
    }),
  ];
  if (options.caption) {
    out.push(
      new Paragraph({
        children: [makeTextRun(options.caption, { italics: true, size: 17, color: MUTED })],
        ...paragraphProperties(null, { before: 0, after: 12, line: CAPTION_LINE, alignment: options.alignment }),
      }),
    );
  }
  return out;
}

function alignmentFromFigure(node) {
  const data = String(node.getAttribute?.('data-align') || '').toLowerCase();
  if (data === 'center') return AlignmentType.CENTER;
  if (data === 'right') return AlignmentType.RIGHT;
  const style = alignmentOf(styleMap(node)['text-align']);
  return style;
}

async function figureBlock(node, resolveImage) {
  const align = alignmentFromFigure(node);
  const full = String(node.getAttribute?.('data-align') || '').toLowerCase() === 'full';
  const captionNode = node.querySelector('figcaption');
  const caption = captionNode ? captionNode.text.replace(/\s+/g, ' ').trim() : '';
  const images = [...node.querySelectorAll('img')];
  if (!images.length) {
    return caption
      ? [new Paragraph({ children: [makeTextRun(caption, { italics: true, color: MUTED })], ...paragraphProperties(null, { after: 12, line: CAPTION_LINE }) })]
      : [];
  }
  const out = [];
  for (let i = 0; i < images.length; i += 1) {
    out.push(...(await imageParagraphs(images[i], resolveImage, {
      caption: i === images.length - 1 ? caption : '',
      alignment: align,
      full,
    })));
  }
  return out;
}

async function listBlock(node, resolveImage, ctx, level = 0) {
  const ordered = String(node.rawTagName).toLowerCase() === 'ol';
  const reference = ordered ? 'cascade-number' : 'cascade-bullet';
  const out = [];
  const items = (node.childNodes || []).filter((entry) => entry.nodeType === 1 && String(entry.rawTagName).toLowerCase() === 'li');
  for (const item of items) {
    const nested = (item.childNodes || []).filter((entry) => entry.nodeType === 1 && /^(ul|ol)$/i.test(entry.rawTagName || ''));
    const format = { font: FONT, size: halfPoint(ctx.sizePx || BODY_PX), color: TEXT };
    const runs = inlineRuns(item, format);
    if (!runs.length) runs.push(makeTextRun('', format));
    out.push(
      new Paragraph({
        children: runs,
        numbering: { reference, level: Math.min(level, 2) },
        spacing: { before: 0, after: twip(4), line: ctx.line || BODY_LINE, lineRule: LineRuleType.AT_LEAST },
      }),
    );
    for (const childList of nested) out.push(...(await listBlock(childList, resolveImage, ctx, level + 1)));
  }
  return out;
}

function tableBorders() {
  const edge = { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 0 }; // 1px
  return { top: edge, bottom: edge, left: edge, right: edge, insideHorizontal: edge, insideVertical: edge };
}

function columnWidths(tableNode, columnCount) {
  const cols = [...tableNode.querySelectorAll('col')];
  let widths = cols
    .map((col) => {
      const value = String(styleMap(col).width || col.getAttribute('width') || '');
      const percent = /^([\d.]+)%$/.exec(value);
      if (percent) return Number(percent[1]) / 100;
      const pixels = cssPx(value);
      return pixels ? pixels / MAX_IMAGE_PX : null;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  if (widths.length !== columnCount) widths = new Array(columnCount).fill(1 / columnCount);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const twips = widths.map((value) => Math.max(240, Math.round((value / total) * CONTENT_TWIP)));
  const diff = CONTENT_TWIP - twips.reduce((a, b) => a + b, 0);
  twips[twips.length - 1] += diff;
  return twips;
}

async function tableBlock(tableNode, resolveImage) {
  const rows = [...tableNode.querySelectorAll('tr')];
  if (!rows.length) return [];
  const rowCells = rows.map((tr) => (tr.childNodes || []).filter((entry) => entry.nodeType === 1 && /^(td|th)$/i.test(entry.rawTagName || '')));
  const columnCount = Math.max(1, ...rowCells.map((cells) => cells.length), ...[...tableNode.querySelectorAll('tr')].map((tr) => (tr.childNodes || []).filter((e) => e.nodeType === 1 && /^(td|th)$/i.test(e.rawTagName || '')).length));
  const widths = columnWidths(tableNode, columnCount);
  const headerRows = new Set([...tableNode.querySelectorAll('thead tr')].map((tr) => tr));

  const docRows = [];
  for (let r = 0; r < rows.length; r += 1) {
    const cells = rowCells[r];
    if (!cells.length) continue;
    const cellsOut = [];
    for (const cell of cells) {
      const isHeader = String(cell.rawTagName).toLowerCase() === 'th';
      const blocks = isHeader
        ? [blockParagraph(cell, { sizePx: 14, bold: true, color: HEADING, compact: true, line: CELL_LINE })]
        : await blocksFromNode(cell, resolveImage, { compact: true, sizePx: 14, line: CELL_LINE });
      const span = Math.max(1, Math.min(columnCount, Number(cell.getAttribute('colspan')) || 1));
      cellsOut.push(
        new TableCell({
          children: blocks.length ? blocks : [new Paragraph({ children: [makeTextRun('', {})] })],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: isHeader ? SHADE : 'FFFFFF' },
          ...(span > 1 ? { columnSpan: span } : {}),
          ...(Number(cell.getAttribute('rowspan')) > 1 ? { rowSpan: Number(cell.getAttribute('rowspan')) } : {}),
        }),
      );
    }
    docRows.push(new TableRow({ children: cellsOut, tableHeader: headerRows.has(rows[r]) }));
  }
  if (!docRows.length) return [];

  return [
    new Table({
      rows: docRows,
      width: { size: CONTENT_TWIP, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      borders: tableBorders(),
      margins: { top: twip(8), bottom: twip(8), left: twip(10), right: twip(10) },
    }),
    new Paragraph({ children: [makeTextRun('', {})], spacing: { before: 0, after: twip(2), line: 240, lineRule: LineRuleType.AT_LEAST } }),
  ];
}

async function blocksFromNode(node, resolveImage, ctx = {}) {
  const tag = String(node.rawTagName || '').toLowerCase();
  const compact = !!ctx.compact;
  const bodyPx = ctx.sizePx || BODY_PX;

  if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return [];
  if (/^h[1-6]$/.test(tag)) {
    const metrics = HEADINGS[Math.min(Number(tag[1]) - 1, HEADINGS.length - 1)];
    return [
      blockParagraph(node, {
        sizePx: metrics.size,
        bold: true,
        color: HEADING,
        before: compact ? 0 : metrics.before,
        after: metrics.after,
        line: metrics.line,
        outlineLevel: metrics.outline,
        keepNext: true,
        compact,
      }),
    ];
  }
  if (tag === 'p') {
    const images = [...node.querySelectorAll('img')];
    if (images.length) {
      const out = [];
      for (const image of images) out.push(...(await imageParagraphs(image, resolveImage, { alignment: alignmentOf(styleMap(node)['text-align']) })));
      const text = node.text.replace(/\s+/g, ' ').trim();
      if (text) out.push(blockParagraph(node, { sizePx: bodyPx, compact, line: ctx.line }));
      return out;
    }
    return [blockParagraph(node, { sizePx: bodyPx, compact, line: ctx.line })];
  }
  if (tag === 'figure') return figureBlock(node, resolveImage);
  if (tag === 'img') return imageParagraphs(node, resolveImage);
  if (tag === 'blockquote') {
    return [
      blockParagraph(node, {
        sizePx: bodyPx,
        color: QUOTE,
        before: 14,
        after: 14,
        indent: { left: twip(16) },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 6 } },
        shading: SHADE,
        compact,
      }),
    ];
  }
  if (tag === 'pre') {
    const lines = String(node.text || '').replace(/\n$/, '').split('\n');
    const children = lines.map((line, index) => new TextRun({
      text: line,
      font: MONO,
      size: 19,
      color: TEXT,
      ...(index ? { break: 1 } : {}),
    }));
    return [
      new Paragraph({
        children,
        spacing: { before: twip(4), after: twip(16), line: CODE_LINE, lineRule: LineRuleType.AT_LEAST },
        indent: { left: twip(14), right: twip(14) },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: SHADE },
        border: {
          top: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 },
          left: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 },
          right: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 },
        },
      }),
    ];
  }
  if (tag === 'hr') {
    return [
      new Paragraph({
        children: [makeTextRun('', {})],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
        spacing: { before: 0, after: twip(16), line: BODY_LINE, lineRule: LineRuleType.AT_LEAST },
      }),
    ];
  }
  if (tag === 'ul' || tag === 'ol') return listBlock(node, resolveImage, { sizePx: bodyPx }, 0);
  if (tag === 'table') return tableBlock(node, resolveImage);
  if (tag === 'br') return [new Paragraph({ children: [makeTextRun('', {})], spacing: { after: twip(10), line: BODY_LINE, lineRule: LineRuleType.AT_LEAST } })];
  if (['div', 'section', 'article', 'main', 'body', 'header', 'footer', 'aside', 'nav'].includes(tag)) {
    const blockChildren = (node.childNodes || []).filter(
      (entry) => entry.nodeType === 1 && /^(p|div|section|article|h[1-6]|ul|ol|table|blockquote|pre|figure|hr|main|header|footer|aside|nav)$/i.test(entry.rawTagName || ''),
    );
    if (blockChildren.length) {
      const out = [];
      for (const entry of node.childNodes || []) {
        if (entry.nodeType === 1) out.push(...(await blocksFromNode(entry, resolveImage, ctx)));
        else if (entry.nodeType === 3 && entry.text.trim()) {
          out.push(new Paragraph({ children: [makeTextRun(entry.text, { font: FONT, size: halfPoint(bodyPx) })], spacing: { after: twip(10), line: BODY_LINE, lineRule: LineRuleType.AT_LEAST } }));
        }
      }
      return out;
    }
    return [blockParagraph(node, { sizePx: bodyPx, compact, line: ctx.line })];
  }
  if (node.text && node.text.trim()) return [blockParagraph(node, { sizePx: bodyPx, compact, line: ctx.line })];
  return [];
}

function numberingConfig() {
  const indent = (level) => ({ paragraph: { indent: { left: twip(24 + level * 24), hanging: twip(18) } } });
  return {
    config: [
      {
        reference: 'cascade-bullet',
        levels: [0, 1, 2].map((level) => ({
          level,
          format: LevelFormat.BULLET,
          text: ['•', '◦', '▪'][level],
          alignment: AlignmentType.START,
          style: indent(level),
        })),
      },
      {
        reference: 'cascade-number',
        levels: [0, 1, 2].map((level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: indent(level),
        })),
      },
    ],
  };
}

function headerFooter(text, kind) {
  const lines = String(text || '').split(/\r?\n/).slice(0, 4);
  const children = lines.map((line) => new Paragraph({
    children: line ? [new TextRun({ text: line, font: FONT, size: 17, color: MUTED })] : [],
    spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AT_LEAST },
  }));
  if (!children.length) children.push(new Paragraph({ children: [] }));
  return kind === 'header' ? new Header({ children }) : new Footer({ children });
}

export async function docToDocx(file, content, resolveImage) {
  const root = parse(String(content.html || '<p></p>'));
  const nodes = [...root.childNodes];
  // The editor always keeps a trailing empty paragraph. Dropping it (but not
  // interior blanks) keeps Word from adding a blank final page.
  while (nodes.length) {
    const last = nodes[nodes.length - 1];
    const whitespaceText = last.nodeType === 3 && !last.text.trim();
    const emptyParagraph = last.nodeType === 1 && String(last.rawTagName || '').toLowerCase() === 'p' && !last.text.trim() && !last.querySelector?.('img');
    if (!whitespaceText && !emptyParagraph) break;
    nodes.pop();
  }

  const children = [];
  for (const node of nodes) {
    if (node.nodeType === 1) children.push(...(await blocksFromNode(node, resolveImage)));
    else if (node.nodeType === 3 && node.text.trim()) {
      children.push(new Paragraph({
        children: [makeTextRun(node.text, { font: FONT, size: BODY_HALF, color: TEXT })],
        spacing: { before: 0, after: twip(10), line: BODY_LINE, lineRule: LineRuleType.AT_LEAST },
      }));
    }
  }
  if (!children.length) children.push(new Paragraph({ children: [makeTextRun('', {})] }));

  const headers = content.header ? { default: headerFooter(content.header, 'header') } : undefined;
  const footers = content.footer ? { default: headerFooter(content.footer, 'footer') } : undefined;

  const doc = new Document({
    title: file.filename,
    description: 'Created with Cascade',
    numbering: numberingConfig(),
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_HALF, color: TEXT },
          paragraph: { spacing: { line: BODY_LINE, lineRule: LineRuleType.AT_LEAST, after: twip(10) } },
        },
      },
    },
    sections: [
      {
        properties: { page: PAGE },
        headers,
        footers,
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export { PAGE as DOCX_PAGE, BODY_PX as DOCX_BODY_PX, CONTENT_TWIP as DOCX_CONTENT_TWIP };
