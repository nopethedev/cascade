import PptxGenJS from 'pptxgenjs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { computeSheet } from './formula.js';
import { embeddableImage, cleanColor, inlineImageSource } from './export-assets.js';

export { inlineImageSource };

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
  // The editor canvas is measured at 96 dpi, so a 1280×720 deck is exactly
  // 13.333×7.5in. Deriving the PowerPoint page from the deck size (instead of
  // hard-coding LAYOUT_WIDE) keeps slides imported at other sizes 1:1 too.
  const slideW = Math.max(1, Number(content.w) || 1280);
  const slideH = Math.max(1, Number(content.h) || 720);
  const layoutName = `CASCADE_${Math.round(slideW)}x${Math.round(slideH)}`;
  pptx.defineLayout({ name: layoutName, width: slideW / 96, height: slideH / 96 });
  pptx.layout = layoutName;
  const sx = 1 / 96;
  const sy = 1 / 96;

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
        const lineHeight = Math.max(60, Math.min(240, Number(e.lineHeight) || 120)) / 100;
        const letterSpacing = Number(e.letterSpacing) || 0;
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
          fit: 'none',
          wrap: true,
          lineSpacingMultiple: lineHeight,
          ...(letterSpacing ? { charSpacing: letterSpacing * 0.75 } : {}),
          ...(rotate ? { rotate } : {}),
        });
      } else if (e.type === 'rect' || e.type === 'ellipse' || e.type === 'line') {
        const opacity = Number(e.opacity ?? 100);
        const transparency = opacity < 100 ? 100 - Math.max(0, Math.min(100, opacity)) : undefined;
        const radius = Math.max(0, Number(e.radius) || 0);
        const lineWidth = Math.max(0, Number(e.borderWidth) || 0);
        const type = e.type === 'ellipse' ? pptx.ShapeType.ellipse
          : e.type === 'line' ? pptx.ShapeType.roundRect
            : radius > 0 ? pptx.ShapeType.roundRect
              : pptx.ShapeType.rect;
        slide.addShape(type, {
          x, y,
          w: Math.max(0.01, w),
          h: e.type === 'line' ? Math.max(0.02, h) : Math.max(0.01, h),
          fill: { color: cleanColor(e.fill, 'E11D48'), ...(transparency !== undefined ? { transparency } : {}) },
          line: lineWidth > 0
            ? { color: cleanColor(e.borderColor, 'FFFFFF'), width: Math.min(20, lineWidth * 0.75) }
            : { color: cleanColor(e.fill, 'E11D48'), transparency: 100 },
          ...(e.type === 'ellipse' ? {}
            : e.type === 'line' ? { rectRadius: Math.min(0.5, h / 2) }
              : radius > 0 ? { rectRadius: Math.max(0, Math.min(0.5, radius / 96)) }
                : {}),
          ...(rotate ? { rotate } : {}),
        });
      } else if (e.type === 'image') {
        const img = await embeddableImage(e.src, resolveImage);
        const data = img && pptxImageData(img);
        if (data) {
          slide.addImage({
            data, x, y, w, h,
            // 'fill' stretches to the frame, which is PowerPoint's default
            // (no sizing box); cover crops and contain letterboxes.
            ...(e.fit === 'contain' ? { sizing: { type: 'contain', w, h } }
              : e.fit === 'fill' ? {}
                : { sizing: { type: 'crop', w, h } }),
            ...(e.alt ? { altText: String(e.alt) } : {}),
            ...(rotate ? { rotate } : {}),
          });
        }
        if (e.credit) {
          slide.addText(String(e.credit), {
            x, y: Math.min(slideH / 96 - 0.26, y + h + 0.04), w, h: 0.25,
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

export { docToDocx } from './docx-export.js';
