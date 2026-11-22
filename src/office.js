import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import PptxGenJS from 'pptxgenjs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parse } from 'node-html-parser';
import { imageSize } from 'image-size';
import { computeSheet } from './formula.js';

const DOCX_FONT = 'Georgia';
const DOCX_SIZE = 22; // half-points, 11pt
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_DOC_IMAGE_PX = 600;

function cleanColor(value, fallback = '111111') {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value || ''));
  return m ? m[1].toUpperCase() : fallback;
}

function textAlign(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'center') return AlignmentType.CENTER;
  if (v === 'right' || v === 'end') return AlignmentType.RIGHT;
  if (v === 'justify') return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

function alignFromStyle(style) {
  const m = /(?:^|;)\s*text-align\s*:\s*(left|right|center|justify)/i.exec(String(style || ''));
  return m ? textAlign(m[1]) : undefined;
}

function decodeDataUrl(src) {
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

async function embeddableImage(src, resolveImage) {
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

/* ------------------------------------------------------------------------- */
/* WordprocessingML                                                          */
/* ------------------------------------------------------------------------- */

function inlineRuns(node, base = {}) {
  const runs = [];
  const pushText = (text, fmt) => {
    if (!text) return;
    runs.push(
      new TextRun({
        text,
        font: fmt.font || DOCX_FONT,
        size: fmt.size || DOCX_SIZE,
        bold: !!fmt.bold,
        italics: !!fmt.italics,
        underline: fmt.underline ? { type: 'single' } : undefined,
        strike: !!fmt.strike,
        color: fmt.color,
        ...(fmt.break ? { break: fmt.break } : {}),
      }),
    );
  };

  for (const child of node.childNodes || []) {
    if (child.nodeType === 3) {
      if (child.text) pushText(child.text, base);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = String(child.rawTagName || '').toLowerCase();
    if (tag === 'br') {
      runs.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (tag === 'img' || tag === 'script' || tag === 'style') continue;
    const fmt = { ...base };
    if (tag === 'strong' || tag === 'b') fmt.bold = true;
    if (tag === 'em' || tag === 'i') fmt.italics = true;
    if (tag === 'u') fmt.underline = true;
    if (tag === 's' || tag === 'strike' || tag === 'del') fmt.strike = true;
    if (tag === 'code' || tag === 'kbd' || tag === 'samp') {
      fmt.font = 'Courier New';
      fmt.size = 20;
    }
    if (tag === 'a') {
      fmt.color = '0563C1';
      fmt.underline = true;
    }
    if (tag === 'mark') fmt.color = '7A4E00';
    runs.push(...inlineRuns(child, fmt));
  }
  return runs;
}

function hasBlockChildren(node) {
  return (node.childNodes || []).some(
    (n) => n.nodeType === 1 && /^(p|div|section|article|h[1-6]|ul|ol|table|blockquote|pre|figure|hr)$/i.test(n.rawTagName || ''),
  );
}

function paragraph(node, options = {}) {
  const runs = inlineRuns(node, options.run || {});
  if (!runs.length) runs.push(new TextRun({ text: '', font: DOCX_FONT, size: DOCX_SIZE }));
  return new Paragraph({
    children: runs,
    heading: options.heading,
    bullet: options.bullet,
    indent: options.indent,
    alignment: options.alignment || alignFromStyle(node.getAttribute?.('style')),
    spacing: options.spacing || { after: 100 },
    border: options.border,
  });
}

async function imageParagraphs(imgNode, resolveImage, caption = '') {
  const src = imgNode.getAttribute('src') || '';
  const alt = imgNode.getAttribute('alt') || '';
  const image = await embeddableImage(src, resolveImage);
  if (!image) {
    const label = alt || caption;
    if (!label) return [];
    return [new Paragraph({ children: [new TextRun({ text: `[Image: ${label}]`, italics: true, color: '777777' })] })];
  }
  let width = Number(image.width) || 600;
  let height = Number(image.height) || 400;
  if (width > MAX_DOC_IMAGE_PX) {
    height = Math.round((height * MAX_DOC_IMAGE_PX) / width);
    width = MAX_DOC_IMAGE_PX;
  }
  if (height > 700) {
    width = Math.round((width * 700) / height);
    height = 700;
  }
  const children = [
    new Paragraph({
      children: [
        new ImageRun({
          data: image.buffer,
          type: image.type,
          transformation: { width: Math.max(24, width), height: Math.max(24, height) },
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
  ];
  if (caption) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: caption, italics: true, size: 18, color: '666666', font: DOCX_FONT })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
      }),
    );
  }
  return children;
}

async function tableBlock(tableNode, resolveImage) {
  const rows = [...tableNode.querySelectorAll('tr')];
  if (!rows.length) return [];
  const tableRows = [];
  for (const tr of rows) {
    const cells = [...tr.childNodes].filter((n) => n.nodeType === 1 && /^(td|th)$/i.test(n.rawTagName || ''));
    if (!cells.length) continue;
    const tableCells = [];
    for (const cell of cells) {
      const cellBlocks = await blocksFromNode(cell, resolveImage);
      tableCells.push(
        new TableCell({
          children: cellBlocks.length ? cellBlocks : [new Paragraph('')],
          shading: String(cell.rawTagName).toLowerCase() === 'th' ? { fill: 'F2F2F2' } : undefined,
        }),
      );
    }
    tableRows.push(new TableRow({ children: tableCells, tableHeader: String(tr.parentNode?.rawTagName || '').toLowerCase() === 'thead' }));
  }
  if (!tableRows.length) return [];
  return [
    new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
    new Paragraph({ text: '', spacing: { after: 80 } }),
  ];
}

async function blocksFromNode(node, resolveImage) {
  const tag = String(node.rawTagName || '').toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'noscript') return [];
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
    const level = Number(tag[1]);
    const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][level - 1];
    return [paragraph(node, { heading, spacing: { before: 240, after: 100 } })];
  }
  if (tag === 'p') {
    const out = [];
    const imgs = [...node.querySelectorAll('img')];
    if (imgs.length) {
      for (const img of imgs) out.push(...(await imageParagraphs(img, resolveImage)));
      const text = node.text.replace(/\s+/g, ' ').trim();
      if (text) out.push(paragraph(node));
      return out;
    }
    return [paragraph(node)];
  }
  if (tag === 'figure') {
    const out = [];
    const captionNode = node.querySelector('figcaption');
    const caption = captionNode ? captionNode.text.trim() : '';
    const images = [...node.querySelectorAll('img')];
    for (let i = 0; i < images.length; i++) {
      out.push(...(await imageParagraphs(images[i], resolveImage, i === images.length - 1 ? caption : '')));
    }
    if (!node.querySelector('img') && caption) {
      out.push(new Paragraph({ children: [new TextRun({ text: caption, italics: true })] }));
    }
    return out;
  }
  if (tag === 'img') return imageParagraphs(node, resolveImage);
  if (tag === 'blockquote') {
    return [paragraph(node, { indent: { left: 480 }, spacing: { after: 120 } })];
  }
  if (tag === 'pre') {
    const lines = String(node.text || '').replace(/\n$/, '').split('\n');
    const children = lines.map(
      (line, i) => new TextRun({ text: line, font: 'Courier New', size: 19, ...(i ? { break: 1 } : {}) }),
    );
    return [new Paragraph({ children, spacing: { after: 120 } })];
  }
  if (tag === 'hr') {
    return [
      new Paragraph({
        text: '',
        border: { bottom: { color: 'CCCCCC', style: 'single', size: 6, space: 1 } },
        spacing: { after: 160 },
      }),
    ];
  }
  if (tag === 'ul' || tag === 'ol') {
    const out = [];
    const items = [...node.childNodes].filter((n) => n.nodeType === 1 && String(n.rawTagName).toLowerCase() === 'li');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const blocks = await blocksFromNode(item, resolveImage);
      const nestedList = [...item.childNodes].filter((n) => n.nodeType === 1 && /^(ul|ol)$/i.test(n.rawTagName || ''));
      if (!blocks.length) blocks.push(new Paragraph(''));
      if (tag === 'ul') {
        blocks[0] = paragraph(item, { bullet: { level: 0 } });
      } else {
        const runs = inlineRuns(item);
        blocks[0] = new Paragraph({
          children: [new TextRun({ text: `${i + 1}. `, font: DOCX_FONT, size: DOCX_SIZE }), ...runs],
          spacing: { after: 100 },
        });
      }
      out.push(...blocks);
      for (const nested of nestedList) out.push(...(await blocksFromNode(nested, resolveImage)));
    }
    return out;
  }
  if (tag === 'table') return tableBlock(node, resolveImage);
  if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'main' || tag === 'body' || tag === 'header' || tag === 'footer') {
    if (hasBlockChildren(node)) {
      const out = [];
      for (const child of node.childNodes) {
        if (child.nodeType === 1) out.push(...(await blocksFromNode(child, resolveImage)));
        else if (child.nodeType === 3 && child.text.trim()) {
          out.push(new Paragraph({ children: [new TextRun({ text: child.text, font: DOCX_FONT, size: DOCX_SIZE })] }));
        }
      }
      return out;
    }
    return [paragraph(node)];
  }
  if (tag === 'br') return [new Paragraph('')];
  if (node.text && node.text.trim()) return [paragraph(node)];
  return [];
}

export async function docToDocx(file, content, resolveImage) {
  const root = parse(String(content.html || '<p></p>'));
  const nodes = [...root.childNodes];
  // Empty editor paragraphs are useful on screen, but a trailing editor-created
  // <p><br></p> after an image can create a blank final Word page.
  while (nodes.length) {
    const last = nodes[nodes.length - 1];
    const whitespaceText = last.nodeType === 3 && !last.text.trim();
    const emptyParagraph = last.nodeType === 1 && String(last.rawTagName || '').toLowerCase() === 'p' && !last.text.trim() && !last.querySelector('img');
    if (!whitespaceText && !emptyParagraph) break;
    nodes.pop();
  }
  const children = [];
  for (const node of nodes) {
    if (node.nodeType === 1) children.push(...(await blocksFromNode(node, resolveImage)));
    else if (node.nodeType === 3 && node.text.trim()) {
      children.push(new Paragraph({ children: [new TextRun({ text: node.text, font: DOCX_FONT, size: DOCX_SIZE })] }));
    }
  }
  if (!children.length) children.push(new Paragraph(''));

  const headers = content.header
    ? { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: String(content.header), size: 18, color: '666666', font: DOCX_FONT })] })] }) }
    : undefined;
  const footers = content.footer
    ? { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: String(content.footer), size: 18, color: '666666', font: DOCX_FONT })] })] }) }
    : undefined;

  const doc = new Document({
    title: file.filename,
    description: 'Created with Cascade',
    sections: [
      {
        headers,
        footers,
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

/* ------------------------------------------------------------------------- */
/* SpreadsheetML                                                             */
/* ------------------------------------------------------------------------- */

function colNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function sheetName(name, used, index) {
  const base = String(name || `Sheet${index + 1}`).replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || `Sheet${index + 1}`;
  let out = base;
  let n = 2;
  while (used.has(out)) {
    const suffix = ` ${n++}`;
    out = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(out);
  return out;
}

export async function sheetToXlsx(content, resolveImage) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cascade';
  wb.created = new Date();
  const sheets = content.sheets || [];
  const used = new Set();
  for (let i = 0; i < sheets.length; i++) {
    const source = sheets[i] || {};
    const ws = wb.addWorksheet(sheetName(source.name, used, i), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalDpi: 96, verticalDpi: 96 };
    const cells = source.cells || {};
    const computed = computeSheet(source);
    const refs = Object.keys(cells);
    const widths = new Map();
    let maxRow = 0;
    for (const ref of refs) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      const col = colNumber(m[1]);
      const row = Number(m[2]);
      maxRow = Math.max(maxRow, row);
      const cell = cells[ref] || {};
      const value = computed[ref] ?? cell.v ?? cell.f ?? '';
      const target = ws.getCell(ref);
      if (value !== '' && value !== undefined && value !== null) {
        // Keep the formula and its computed result. Excel/LibreOffice can
        // recalculate it, while viewers that do not calculate still show the
        // value the Cascade formula engine computed.
        target.value = cell.f && String(cell.f).startsWith('=')
          ? { formula: String(cell.f).slice(1), result: value }
          : typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
        const len = String(value).length;
        widths.set(col, Math.max(widths.get(col) || 10, Math.min(60, Math.max(10, len + 2))));
      }
      if (cell.b || cell.i || cell.color) {
        target.font = {
          ...(target.font || {}),
          ...(cell.b ? { bold: true } : {}),
          ...(cell.i ? { italic: true } : {}),
          ...(cell.color ? { color: { argb: `FF${cleanColor(cell.color, '111111')}` } } : {}),
        };
      }
      if (cell.align) target.alignment = { horizontal: cell.align };
      if (cell.bg) target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${cleanColor(cell.bg, 'FFFFFF')}` } };
    }
    for (const [col, width] of widths) ws.getColumn(col).width = width;

    const images = Array.isArray(source.images) ? source.images : [];
    for (let n = 0; n < images.length; n++) {
      const entry = images[n] || {};
      const img = await embeddableImage(entry.src, resolveImage);
      if (!img) continue;
      const naturalW = Math.max(24, Number(img.width) || 320);
      const naturalH = Math.max(24, Number(img.height) || 200);
      const maxW = Math.min(320, naturalW);
      const maxH = 240;
      const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
      const width = Math.max(24, Math.round(naturalW * scale));
      const height = Math.max(24, Math.round(naturalH * scale));
      const col = Math.max(0, Number(entry.col) || 0);
      const row = Math.max(0, Number(entry.row) || maxRow + 1 + n * 8);
      const imageId = wb.addImage({
        buffer: img.buffer,
        extension: img.type === 'png' ? 'png' : 'jpeg',
        name: entry.alt || `image-${i + 1}-${n + 1}`,
      });
      ws.addImage(imageId, {
        tl: { col, row },
        ext: { width, height },
        editAs: 'oneCell',
      });
    }
  }
  if (!sheets.length) wb.addWorksheet('Sheet1');
  wb.views = [{ activeTab: 0 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ------------------------------------------------------------------------- */
/* PresentationML                                                            */
/* ------------------------------------------------------------------------- */

function pptxImageData(img) {
  const mime = String(img.mime || '').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/jpg', 'image/gif'].includes(mime)) return null;
  return `data:${mime};base64,${img.buffer.toString('base64')}`;
}

export async function deckToPptx(file, content, resolveImage) {
  const pptx = new PptxGenJS();
  pptx.author = 'Cascade';
  pptx.subject = file.filename;
  pptx.title = file.filename;
  pptx.company = 'Cascade';
  pptx.layout = 'LAYOUT_WIDE';
  const slideW = Number(content.w) || 1280;
  const slideH = Number(content.h) || 720;
  const sx = 13.333 / slideW;
  const sy = 7.5 / slideH;

  for (const source of content.slides || []) {
    const slide = pptx.addSlide();
    slide.background = { color: cleanColor(source.bg, '101014') };
    for (const e of source.elements || []) {
      const x = (Number(e.x) || 0) * sx;
      const y = (Number(e.y) || 0) * sy;
      const w = (Number(e.w) || 1) * sx;
      const h = (Number(e.h) || 1) * sy;
      const rotate = Number(e.rotation) || 0;
      if (e.type === 'text') {
        const size = Math.max(6, Math.min(120, (Number(e.size) || 28) * 0.75));
        const fontFamily = String(e.fontFamily || 'Arial').split(',')[0].replace(/['"]/g, '').trim() || 'Arial';
        slide.addText(String(e.text || ''), {
          x, y, w, h,
          fontFace: fontFamily,
          fontSize: size,
          bold: !!e.bold,
          italic: !!e.italic,
          underline: e.underline ? { style: 'sng' } : undefined,
          color: cleanColor(e.color, 'F4F4F5'),
          align: ['left', 'center', 'right'].includes(e.align) ? e.align : 'left',
          valign: e.valign === 'middle' ? 'mid' : e.valign === 'bottom' ? 'bottom' : 'top',
          margin: 0,
          breakLine: false,
          ...(rotate ? { rotate } : {}),
        });
      } else if (e.type === 'rect' || e.type === 'ellipse' || e.type === 'line') {
        const type = e.type === 'ellipse' ? pptx.ShapeType.ellipse : pptx.ShapeType.rect;
        const lineWidth = Math.max(0, Number(e.borderWidth) || 0);
        slide.addShape(type, {
          x, y, w: Math.max(0.01, w), h: e.type === 'line' ? Math.max(0.02, h) : Math.max(0.01, h),
          fill: { color: cleanColor(e.fill, 'E11D48'), ...(Number(e.opacity) < 100 ? { transparency: 100 - Math.max(0, Number(e.opacity)) } : {}) },
          line: lineWidth > 0
            ? { color: cleanColor(e.borderColor, 'FFFFFF'), width: Math.min(20, lineWidth * 0.75) }
            : { color: cleanColor(e.fill, 'E11D48'), transparency: 100 },
          ...(e.type === 'ellipse' ? {} : { rectRadius: Math.max(0, Math.min(0.5, (Number(e.radius) || 0) / slideW)) }),
          ...(rotate ? { rotate } : {}),
        });
      } else if (e.type === 'image') {
        const img = await embeddableImage(e.src, resolveImage);
        const data = img && pptxImageData(img);
        if (data) {
          slide.addImage({
            data, x, y, w, h,
            sizing: { type: e.fit === 'contain' ? 'contain' : e.fit === 'fill' ? 'crop' : 'cover', w, h },
            ...(e.alt ? { altText: String(e.alt) } : {}),
            ...(rotate ? { rotate } : {}),
          });
        }
        if (e.credit) {
          slide.addText(String(e.credit), {
            x, y: Math.min(7.1, y + h + 0.04), w, h: 0.25,
            fontFace: 'Arial', fontSize: 7, color: '999999', margin: 0,
          });
        }
      }
    }
    if (source.notes) slide.addNotes(String(source.notes));
  }
  if (!(content.slides || []).length) {
    const slide = pptx.addSlide();
    slide.background = { color: '101014' };
  }
  const buffer = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
  return addPptxTransitions(buffer, content.slides || []);
}

function pptxTransitionXml(raw) {
  const t = raw && typeof raw === 'object' ? raw : { type: raw || 'none' };
  const type = ['fade', 'push', 'wipe', 'zoom', 'dissolve'].includes(t.type) ? t.type : 'none';
  if (type === 'none') return '';
  const duration = Math.max(150, Math.min(2500, Number(t.duration) || 550));
  const speed = duration < 400 ? 'fast' : duration > 900 ? 'slow' : 'med';
  if (type === 'push') return `<p:transition spd="${speed}"><p:push dir="l"/></p:transition>`;
  if (type === 'wipe') return `<p:transition spd="${speed}"><p:wipe dir="l"/></p:transition>`;
  if (type === 'zoom') return `<p:transition spd="${speed}"><p:zoom/></p:transition>`;
  // PowerPoint has no dissolve element in the core schema (it is a legacy
  // filter); fade is the closest portable transition in PowerPoint/Keynote.
  return `<p:transition spd="${speed}"><p:fade/></p:transition>`;
}

/** Add native slide transitions to an already-generated PPTX package. */
async function addPptxTransitions(buffer, slides) {
  const wanted = slides.map((s) => pptxTransitionXml(s.transition));
  if (!wanted.some(Boolean)) return buffer;
  try {
    const zip = await JSZip.loadAsync(buffer);
    for (let i = 0; i < wanted.length; i++) {
      if (!wanted[i]) continue;
      const path = `ppt/slides/slide${i + 1}.xml`;
      const file = zip.file(path);
      if (!file) continue;
      let xml = await file.async('string');
      if (xml.includes('<p:transition')) continue;
      const closemap = /<p:clrMapOvr[\s\S]*?<\/p:clrMapOvr>/;
      if (closemap.test(xml)) xml = xml.replace(closemap, (m) => `${m}${wanted[i]}`);
      else xml = xml.replace('</p:sld>', `${wanted[i]}</p:sld>`);
      zip.file(path, xml);
    }
    return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
  } catch {
    // A valid deck without remembered transitions is better than a corrupt file.
    return buffer;
  }
}
