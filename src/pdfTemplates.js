import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Starter PDFs are generated on the server so the stored document is a real
// PDF from the first save (and can be rendered/exported immediately).
const A4 = [595.28, 841.89];
const LETTER = [612, 792];

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage(A4);
  return doc;
}

async function letterLines() {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Notes', { x: 56, y: 720, size: 26, font: bold, color: rgb(0.08, 0.08, 0.1) });
  page.drawText(new Date().toISOString().slice(0, 10), {
    x: 56,
    y: 696,
    size: 10,
    font,
    color: rgb(0.45, 0.45, 0.5),
  });
  for (let y = 660; y > 80; y -= 28) {
    page.drawLine({
      start: { x: 56, y },
      end: { x: LETTER[0] - 56, y },
      thickness: 0.7,
      color: rgb(0.82, 0.82, 0.86),
    });
  }
  return doc;
}

async function cover() {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: A4[1] - 210, width: A4[0], height: 210, color: rgb(0.882, 0.114, 0.282) });
  page.drawText('CASCADE', { x: 56, y: A4[1] - 96, size: 12, font: bold, color: rgb(1, 1, 1), characterSpacing: 3 });
  page.drawText('Document title', { x: 56, y: A4[1] - 160, size: 34, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Add a subtitle, author and date here.', {
    x: 56,
    y: A4[1] - 190,
    size: 12,
    font,
    color: rgb(1, 0.86, 0.89),
  });
  page.drawText('Prepared by', { x: 56, y: 300, size: 10, font: bold, color: rgb(0.45, 0.45, 0.5) });
  page.drawText('Team / company', { x: 56, y: 280, size: 15, font, color: rgb(0.1, 0.1, 0.12) });
  page.drawText('Date', { x: 56, y: 232, size: 10, font: bold, color: rgb(0.45, 0.45, 0.5) });
  page.drawText(new Date().toISOString().slice(0, 10), { x: 56, y: 212, size: 15, font, color: rgb(0.1, 0.1, 0.12) });
  page.drawLine({
    start: { x: 56, y: 120 },
    end: { x: A4[0] - 56, y: 120 },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.88),
  });
  page.drawText('Shared from Cascade', { x: 56, y: 100, size: 9, font, color: rgb(0.55, 0.55, 0.6) });
  return doc;
}

async function checklist() {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Checklist', { x: 56, y: 760, size: 26, font: bold, color: rgb(0.08, 0.08, 0.1) });
  const items = ['First task', 'Second task', 'Third task', 'Fourth task', 'Fifth task'];
  items.forEach((label, i) => {
    const y = 690 - i * 44;
    page.drawRectangle({
      x: 56,
      y: y - 3,
      width: 14,
      height: 14,
      borderColor: rgb(0.2, 0.2, 0.25),
      borderWidth: 1.2,
      color: rgb(1, 1, 1),
    });
    page.drawText(label, { x: 82, y, size: 13, font, color: rgb(0.12, 0.12, 0.15) });
    page.drawLine({
      start: { x: 82, y: y - 12 },
      end: { x: A4[0] - 56, y: y - 12 },
      thickness: 0.5,
      color: rgb(0.87, 0.87, 0.9),
    });
  });
  return doc;
}

const BUILDERS = {
  'pdf-blank': blank,
  'pdf-letter-lines': letterLines,
  'pdf-cover': cover,
  'pdf-checklist': checklist,
};

/** Returns the editor content object ({ pdf: <base64> }) for a PDF template. */
export async function buildPdfTemplate(templateId) {
  const builder = BUILDERS[templateId] || BUILDERS['pdf-blank'];
  const doc = await builder();
  const bytes = await doc.save();
  return { pdf: Buffer.from(bytes).toString('base64') };
}
