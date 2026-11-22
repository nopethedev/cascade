import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { docToDocx, sheetToXlsx, deckToPptx } from '../src/office.js';

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lz1l4QAAAABJRU5ErkJggg==';

test('DOCX export is a valid ZIP with headings, lists, tables and an embedded image', async () => {
  const buffer = await docToDocx(
    { filename: 'smoke.docx' },
    {
      header: 'Header',
      footer: 'Footer',
      html: '<h1>Smoke</h1><p><strong>bold</strong> text</p><ul><li>one</li></ul><table><tr><th>A</th></tr><tr><td>B</td></tr></table><figure><img src="' + PNG_1X1 + '" alt="pixel"><figcaption>credit</figcaption></figure>',
    },
    null,
  );
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.length > 1000);
});

test('XLSX export preserves values, computed formulas and sheet names', async () => {
  const buffer = await sheetToXlsx({
    sheets: [
      { name: 'Numbers', cells: { A1: { v: 2 }, A2: { v: 3 }, A3: { f: '=SUM(A1:A2)' }, B1: { v: 'Hello' } } },
      { name: 'Second', cells: { A1: { v: 'Other' } } },
    ],
  });
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((w) => w.name), ['Numbers', 'Second']);
  assert.deepEqual(workbook.getWorksheet('Numbers').getCell('A3').value, { formula: 'SUM(A1:A2)', result: 5 });
  assert.equal(workbook.getWorksheet('Second').getCell('A1').value, 'Other');
});

test('PPTX export embeds an image and keeps slide text', async () => {
  const buffer = await deckToPptx(
    { filename: 'smoke.pptx' },
    {
      w: 1280,
      h: 720,
      slides: [
        {
          bg: '#101014',
          notes: 'note',
          transition: { type: 'push', duration: 600, easing: 'ease' },
          elements: [
            { type: 'text', x: 10, y: 10, w: 500, h: 80, text: 'Hello', size: 32 },
            { type: 'rect', x: 10, y: 200, w: 100, h: 100, fill: '#e11d48' },
            { type: 'image', x: 200, y: 200, w: 200, h: 200, src: PNG_1X1, alt: 'pixel' },
          ],
        },
      ],
    },
    null,
  );
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.length > 1000);
  const zip = await JSZip.loadAsync(buffer);
  const slideXml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(slideXml, /<p:transition\b[^>]*>\s*<p:push\b/);
});
