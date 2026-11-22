import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const theme = {
  siteName: 'Cascade QA',
  accent: '#2563eb',
  bg: '#ffffff',
  surface: '#ffffff',
  text: '#18181b',
};
const user = { username: 'qa', role: 'user' };
const kind = { icon: 'DOC', label: 'Document' };
const base = {
  theme,
  user,
  path: '/edit/editor-qa',
  mode: 'main',
  filename: 'Editor QA',
  title: 'Editor QA',
};

test('document editor renders formatting, image and integration controls', async () => {
  const html = await ejs.renderFile(path.join(ROOT, 'views/editors/doc.ejs'), {
    ...base,
    kind,
    file: { id: 'editor-qa', filename: 'Editor QA', version: 1, isPublic: false },
    content: { html: '<h1>Quarterly plan</h1><p>Body</p>' },
  });
  for (const needle of [
    'id="doc-toolbar"',
    'data-cmd="bold"',
    'data-cmd="italic"',
    'id="font-family"',
    'id="font-size"',
    'id="text-color"',
    'id="highlight-color"',
    'id="insert-image"',
    'id="insert-table"',
    'id="insert-link"',
    'id="editor-side"',
    'id="doc-outline"',
    'id="side-insert-image"',
    'id="side-image-library"',
    'id="image-tools"',
    'id="side-versions"',
    'id="side-share"',
    'id="btn-editor-panel"',
    '/public/image-library.js',
  ]) {
    assert.ok(html.includes(needle), `document editor is missing ${needle}`);
  }
  assert.match(html, /window\.__DOC__/);
  assert.match(html, /\/download\/editor-qa/);
});

test('PDF editor renders image placement and integration controls', async () => {
  const html = await ejs.renderFile(path.join(ROOT, 'views/editors/pdf.ejs'), {
    ...base,
    kind: { icon: 'PDF', label: 'PDF' },
    file: { id: 'editor-pdf-qa', filename: 'Editor PDF QA', version: 1, isPublic: false },
    content: { pdf: '', annotations: [], signatures: [] },
  });
  for (const needle of [
    'data-tool="image"',
    'id="pdf-insert-image"',
    'id="pdf-side-image"',
    'id="pdf-side-versions"',
    'id="pdf-side-share"',
    'id="pdf-annotations"',
    '/public/image-library.js',
  ]) {
    assert.ok(html.includes(needle), `PDF editor is missing ${needle}`);
  }
  assert.match(html, /window\.__DOC__/);
  assert.match(html, /\/download\/editor-pdf-qa/);
});
