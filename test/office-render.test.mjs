import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { docToDocx, sheetToXlsx, deckToPptx } from '../src/office.js';

// This is intentionally opt-in: CI images without an office suite still run
// the structural tests, while a machine with LibreOffice (or another
// soffice-compatible binary) can enforce real openability:
//
//   SOFFICE_BIN=/path/to/soffice npm test
//
// A failed external conversion fails this test; a missing binary is reported
// as skipped rather than pretending the compatibility claim was exercised.
const SOFFICE = process.env.SOFFICE_BIN || '';
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lz1l4QAAAABJRU5ErkJggg==';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-office-'));
}

function mediaFiles(buffer, prefix) {
  return JSZip.loadAsync(buffer).then((zip) => Object.keys(zip.files).filter((name) => name.startsWith(prefix) && !zip.files[name].dir));
}

function convert(file, outDir, profile, filter = 'pdf') {
  const result = spawnSync(
    SOFFICE,
    [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      '--convert-to',
      filter,
      '--outdir',
      outDir,
      file,
    ],
    {
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, HOME: path.dirname(profile), SAL_USE_VCLPLUGIN: 'svp' },
    },
  );
  assert.equal(result.status, 0, `LibreOffice conversion failed: ${result.stderr || result.stdout}`);
  assert.match(result.stdout + result.stderr, /convert .* -> /i);
  return result;
}

test(
  'generated DOCX, XLSX and PPTX open in a real office renderer',
  { skip: SOFFICE ? false : 'Set SOFFICE_BIN to a LibreOffice/soffice binary to run the external render check' },
  async () => {
    const dir = makeTempDir();
    const outDir = path.join(dir, 'out');
    fs.mkdirSync(outDir);
    const docxPath = path.join(dir, 'compat-doc.docx');
    const xlsxPath = path.join(dir, 'compat-sheet.xlsx');
    const pptxPath = path.join(dir, 'compat-deck.pptx');
    const docx = await docToDocx(
      { filename: 'compat.docx' },
      {
        header: 'Header',
        footer: 'Footer',
        html:
          '<h1>Compatibility heading</h1><p>Body text</p><table><tr><th>Check</th><th>Value</th></tr><tr><td>Table</td><td>Visible</td></tr></table>' +
          `<figure><img src="${PNG_1X1}" alt="pixel"><figcaption>Caption</figcaption></figure><p><br></p>`,
      },
      null,
    );
    const xlsx = await sheetToXlsx(
      {
        sheets: [
          {
            name: 'Render QA',
            cells: { A1: { v: 'Sheet heading', b: true }, A4: { v: 2 }, A5: { v: 3 }, A6: { f: '=SUM(A4:A5)' } },
            images: [{ src: PNG_1X1, alt: 'pixel', col: 0, row: 10 }],
          },
        ],
      },
      null,
    );
    const pptx = await deckToPptx(
      { filename: 'compat.pptx' },
      {
        w: 1280,
        h: 720,
        slides: [
          {
            bg: '#101014',
            notes: 'Notes survive',
            elements: [
              { type: 'text', x: 60, y: 60, w: 700, h: 80, text: 'Presentation heading', size: 40 },
              { type: 'image', x: 100, y: 220, w: 300, h: 200, src: PNG_1X1, alt: 'pixel', credit: 'credit' },
            ],
          },
        ],
      },
      null,
    );

    fs.writeFileSync(docxPath, docx);
    fs.writeFileSync(xlsxPath, xlsx);
    fs.writeFileSync(pptxPath, pptx);

    // Structural assertions catch missing relationships/parts before invoking
    // the external renderer, and make the failure readable when they do.
    assert.ok((await mediaFiles(docx, 'word/media/')).length >= 1, 'DOCX has no media part');
    assert.ok((await mediaFiles(xlsx, 'xl/media/')).length >= 1, 'XLSX has no media part');
    assert.ok((await mediaFiles(pptx, 'ppt/media/')).length >= 1, 'PPTX has no media part');
    const xlsxXml = await (await JSZip.loadAsync(xlsx)).file('xl/worksheets/sheet1.xml').async('string');
    assert.match(xlsxXml, /<f>SUM\(A4:A5\)<\/f>/);
    const pptxNotes = await (await JSZip.loadAsync(pptx)).file('ppt/notesSlides/notesSlide1.xml').async('string');
    assert.match(pptxNotes, /Notes survive/);

    const profile = path.join(dir, 'profile');
    for (const file of [docxPath, xlsxPath, pptxPath]) {
      convert(file, outDir, profile);
      const pdf = path.join(outDir, path.basename(file, path.extname(file)) + '.pdf');
      assert.ok(fs.existsSync(pdf), `LibreOffice did not produce ${pdf}`);
      assert.ok(fs.statSync(pdf).size > 1000, `LibreOffice produced a suspiciously small ${pdf}`);
      assert.match(fs.readFileSync(pdf).toString('latin1'), /\/Subtype\s*\/Image/, `${pdf} contains no rendered image XObject`);
    }

    // The fixture ends with an editor-style empty paragraph. The PDF must
    // still have one content page rather than a blank trailing page.
    const docPdf = await PDFDocument.load(fs.readFileSync(path.join(outDir, 'compat-doc.pdf')));
    assert.equal(docPdf.getPageCount(), 1, 'DOCX gained a blank trailing page');

    // LibreOffice's document text export is independent of the PDF renderer
    // and catches a document that opens but lost its text.
    const textDir = path.join(dir, 'text');
    fs.mkdirSync(textDir);
    convert(docxPath, textDir, profile, 'txt');
    const docText = fs.readFileSync(path.join(textDir, 'compat-doc.txt'), 'utf8');
    assert.match(docText, /Compatibility heading/);
    assert.match(docText, /Table\tVisible/);

    convert(xlsxPath, textDir, profile, 'csv:Text - txt - csv (StarCalc):44,34,76');
    const sheetText = fs.readFileSync(path.join(textDir, 'compat-sheet.csv'), 'utf8');
    assert.match(sheetText, /Sheet heading/);
    assert.match(sheetText, /5/);
  },
);
