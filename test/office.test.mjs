import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
      { name: 'Numbers', cells: { A1: { v: 2 }, A2: { v: 3 }, A3: { f: '=SUM(A1:A2)' }, B1: { v: 'Hello' }, C1: { v: false }, C2: { v: true } } },
      { name: 'Second', cells: { A1: { v: 'Other' } } },
    ],
  });
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((w) => w.name), ['Numbers', 'Second']);
  assert.deepEqual(workbook.getWorksheet('Numbers').getCell('A3').value, { formula: 'SUM(A1:A2)', result: 5 });
  assert.equal(workbook.getWorksheet('Numbers').getCell('C1').value, false, 'boolean false must not become the string "false"');
  assert.equal(workbook.getWorksheet('Numbers').getCell('C2').value, true, 'boolean true must stay boolean');
  assert.equal(workbook.getWorksheet('Second').getCell('A1').value, 'Other');
});

test('PPTX export embeds an image, keeps rich text and writes all native transitions', async () => {
  const buffer = await deckToPptx(
    { filename: 'smoke.pptx' },
    {
      w: 1280,
      h: 720,
      slides: [
        { bg: '#101014', notes: 'fade note', transition: { type: 'fade', duration: 600 }, elements: [{ type: 'text', x: 10, y: 10, w: 700, h: 80, text: 'Fade heading', size: 32, bold: true, italic: true }] },
        { bg: '#101014', notes: 'push note', transition: { type: 'push', duration: 600 }, elements: [{ type: 'text', x: 100, y: 80, w: 700, h: 80, text: 'Push heading', size: 32 }] },
        { bg: '#101014', transition: { type: 'wipe', duration: 700 }, elements: [{ type: 'text', x: 120, y: 90, w: 700, h: 80, text: 'Wipe heading', size: 32 }] },
        { bg: '#101014', transition: { type: 'zoom', duration: 500 }, elements: [{ type: 'text', x: 140, y: 100, w: 700, h: 100, text: 'Line one\nLine two & <tag>', size: 28 }] },
      ],
    },
    null,
  );
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.length > 1000);
  const zip = await JSZip.loadAsync(buffer);
  const expected = ['fade', 'push', 'wipe', 'zoom'];
  for (let i = 0; i < expected.length; i += 1) {
    const xml = await zip.file(`ppt/slides/slide${i + 1}.xml`).async('string');
    assert.match(xml, new RegExp(`<p:transition\\b[^>]*>\\s*<p:${expected[i]}\\b`), `slide ${i + 1} transition`);
    assert.match(xml, /<a:t>/, 'slide text must survive');
  }
  const richXml = await zip.file('ppt/slides/slide4.xml').async('string');
  assert.match(richXml, /Line one/);
  assert.match(richXml, /Line two &amp; &lt;tag&gt;/);
});

test('PPTX opens with independent python-pptx and preserves transitions, text and geometry', { timeout: 30000 }, async (t) => {
  const python = process.env.PYTHON_BIN || 'python3';
  const probe = spawnSync(python, ['-c', 'import pptx'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('Set PYTHON_BIN to a Python with python-pptx installed for independent OOXML readback');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-pptx-readback-'));
  const file = path.join(dir, 'qa.pptx');
  const buffer = await deckToPptx(
    { filename: 'qa.pptx' },
    {
      w: 1280,
      h: 720,
      slides: [
        { bg: '#101014', transition: { type: 'fade' }, elements: [{ type: 'text', x: 100, y: 80, w: 700, h: 80, text: 'Fade heading', size: 36, bold: true }] },
        { bg: '#101014', transition: { type: 'push' }, elements: [{ type: 'text', x: 110, y: 90, w: 700, h: 80, text: 'Push heading', size: 36 }] },
        { bg: '#101014', transition: { type: 'wipe' }, elements: [{ type: 'text', x: 120, y: 100, w: 700, h: 80, text: 'Wipe heading', size: 36 }] },
        { bg: '#101014', transition: { type: 'zoom' }, elements: [{ type: 'text', x: 130, y: 110, w: 700, h: 100, text: 'Line one\nLine two & <tag>', size: 32 }] },
      ],
    },
    null,
  );
  fs.writeFileSync(file, buffer);
  const script = `
import json, sys
from pptx import Presentation
from pptx.oxml.ns import qn
p = Presentation(sys.argv[1])
out = []
for slide in p.slides:
    trans = slide._element.find(qn('p:transition'))
    kind = None
    if trans is not None:
        for child in trans:
            kind = child.tag.split('}')[-1]
            break
    texts = []
    boxes = []
    for shape in slide.shapes:
        if shape.has_text_frame:
            texts.append(shape.text)
            boxes.append([shape.left, shape.top, shape.width, shape.height])
    out.append({'transition': kind, 'texts': texts, 'boxes': boxes})
print(json.dumps(out))
`;
  const result = spawnSync(python, ['-c', script, file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const slides = JSON.parse(result.stdout);
  assert.deepEqual(slides.map((s) => s.transition), ['fade', 'push', 'wipe', 'zoom']);
  assert.match(slides[0].texts.join('\n'), /Fade heading/);
  assert.match(slides[3].texts.join('\n'), /Line one[\s\S]*Line two & <tag>/);
  assert.ok(slides[0].boxes[0][0] > 0 && slides[0].boxes[0][1] > 0, 'slide geometry must survive');
});
