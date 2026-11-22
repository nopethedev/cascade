/* PDF editor: pdf.js rendering + pdf-lib page operations.
   Content shape: { pdf: base64, annotations: [], signatures: [] }
   Annotation coordinates are PDF points (origin bottom-left, page unrotated). */
import * as pdfjsLib from '/public/vendor/pdfjs/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/public/vendor/pdfjs/pdf.worker.mjs';

const { PDFDocument, degrees } = window.PDFLib;
const DOC = window.__DOC__;
const $ = (id) => document.getElementById(id);

const canvas = $('pdf-canvas');
const ctx = canvas.getContext('2d');
const stage = $('pdf-stage');
const viewportEl = $('pdf-viewport');
const textLayerEl = $('pdf-text-layer');
const overlayEl = $('pdf-overlay');
const thumbsEl = $('pdf-thumbs');
const annotListEl = $('pdf-annotations');
const sigListEl = $('pdf-signatures');
const hintEl = $('pdf-hint');
const zoomLabel = $('pdf-zoom-label');
const pageLabel = $('pdf-page-label');
const colorInput = $('pdf-color');
const sizeInput = $('pdf-size');

const toast = (msg, bad) => window.cascadeToast?.(msg, bad);
const hint = (html) => {
  hintEl.innerHTML = html;
};

function normalize(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    pdf: typeof c.pdf === 'string' ? c.pdf : '',
    annotations: Array.isArray(c.annotations) ? c.annotations.filter((a) => a && a.page) : [],
    signatures: Array.isArray(c.signatures) ? c.signatures : [],
  };
}

let content = normalize(DOC.content);
let pdfDoc = null;
let pageIndex = 0;
let selectedPages = new Set([0]);
let scale = 1;
let fitScale = 1;
let currentViewport = null;
let currentRotation = 0;
let tool = 'select';
let selectedId = null;
let pendingSignature = null;
let renderToken = 0;
let thumbsToken = 0;
let undoStack = [];
let redoStack = [];

const ws = window.Workspace.create({
  id: DOC.id,
  kind: 'pdf',
  version: DOC.version,
  isPublic: DOC.isPublic,
  filename: DOC.filename,
  content,
  collect: () => ({ pdf: content.pdf, annotations: content.annotations, signatures: content.signatures }),
  apply: (next) => {
    content = normalize(next);
    undoStack = [];
    redoStack = [];
    renderSignatures();
    loadDocument();
  },
});

// ---------- helpers ----------
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const currentAnnotations = () => content.annotations.filter((a) => Number(a.page) === pageIndex + 1);

function setTool(next) {
  tool = next;
  document.querySelectorAll('#pdf-tools [data-tool]').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === next));
  stage.dataset.tool = next;
  overlayEl.classList.toggle('is-placing', next !== 'select');
  if (next === 'signature' && !pendingSignature && content.signatures.length) {
    pendingSignature = content.signatures[content.signatures.length - 1].id;
    renderSignatures();
  }
  document.querySelectorAll('.pdf-annot').forEach((el) => el.classList.remove('is-selected'));
  if (next === 'select') hint('Select text then Highlight, or pick Text / Note / Sign to place something.');
  else if (next === 'text') hint('Click a page to place text. You will be asked what it should say.');
  else if (next === 'note') hint('Click a page to add a comment bubble.');
  else if (next === 'signature') hint(pendingSignature ? 'Click a page to place the selected signature.' : 'Choose a signature on the left, or create one first.');
  else if (next === 'highlight') hint('Select text and press Highlight, or drag a box over the page.');
}

function pdfPointToScreen(x, y) {
  if (!currentViewport) return [0, 0];
  return currentViewport.convertToViewportPoint(x, y);
}

function clientToPdf(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const [x, y] = currentViewport.convertToPdfPoint(clientX - r.left, clientY - r.top);
  return [x, y];
}

function annotRect(a) {
  const [x1, y1] = pdfPointToScreen(a.x, a.y + a.h);
  const [x2, y2] = pdfPointToScreen(a.x + a.w, a.y);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

// ---------- rendering ----------
async function loadDocument() {
  if (!content.pdf) {
    hint('This PDF has no stored source. Restore a version from History, or create a new PDF.');
    return;
  }
  const token = ++renderToken;
  try {
    if (pdfDoc) {
      try { await pdfDoc.destroy(); } catch { /* ignore */ }
    }
    pdfDoc = await pdfjsLib.getDocument({
      data: b64ToBytes(content.pdf),
      standardFontDataUrl: '/public/vendor/pdfjs/standard_fonts/',
      isEvalSupported: false,
    }).promise;
    if (token !== renderToken) return;
    pageIndex = Math.max(0, Math.min(pageIndex, pdfDoc.numPages - 1));
    selectedPages = new Set([pageIndex]);
    await renderPage(token);
    if (token === renderToken) renderThumbnails(token);
  } catch (err) {
    console.error('[pdf] load failed', err);
    hint('Could not render this PDF. Restore a version from History if the file was damaged.');
    toast('Could not open the PDF', true);
  }
}

async function renderPage(token) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(pageIndex + 1);
  if (token !== renderToken) return;
  const viewport = page.getViewport({ scale });
  currentViewport = viewport;
  currentRotation = ((Number(page.rotate) || 0) % 360 + 360) % 360;
  const ratio = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  stage.style.width = `${viewport.width}px`;
  stage.style.height = `${viewport.height}px`;
  stage.style.setProperty('--scale-factor', String(scale));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  if (token !== renderToken) return;

  // text layer for real text selection
  textLayerEl.innerHTML = '';
  textLayerEl.style.width = `${viewport.width}px`;
  textLayerEl.style.height = `${viewport.height}px`;
  textLayerEl.style.setProperty('--scale-factor', String(scale));
  try {
    const layer = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textLayerEl,
      viewport,
    });
    await layer.render();
  } catch (err) {
    console.warn('[pdf] text layer failed', err);
  }

  zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  pageLabel.textContent = `${pageIndex + 1} / ${pdfDoc.numPages}`;
  thumbsEl.querySelectorAll('.pdf-thumb').forEach((el, i) => {
    el.classList.toggle('is-active', i === pageIndex);
    el.classList.toggle('is-selected', selectedPages.has(i));
  });
  const splitBtn = $('pdf-split');
  splitBtn.textContent = selectedPages.size > 1 ? `Split out ${selectedPages.size} pages` : 'Split out page';
  drawAnnotations();
  updateNavigation();
}

function drawAnnotations() {
  overlayEl.innerHTML = '';
  if (!currentViewport) return;
  for (const a of currentAnnotations()) {
    const r = annotRect(a);
    const el = document.createElement('div');
    el.className = `pdf-annot pdf-annot-${a.type}`;
    el.dataset.id = a.id;
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
    // Content (text, note, signature) must follow the page's /Rotate so the
    // overlay matches what the exported PDF looks like in a reader.
    if (currentRotation && a.type !== 'highlight') {
      const localW = a.w * scale;
      const localH = a.h * scale;
      el.style.width = `${localW}px`;
      el.style.height = `${localH}px`;
      el.style.transformOrigin = '0 0';
      el.style.transform =
        currentRotation === 90
          ? `translate(${localH}px, 0) rotate(90deg)`
          : currentRotation === 270
            ? `translate(0, ${localW}px) rotate(-90deg)`
            : `translate(${localW}px, ${localH}px) rotate(180deg)`;
    }
    if (a.id === selectedId) el.classList.add('is-selected');

    if (a.type === 'highlight') {
      el.style.background = a.color || '#f5c518';
      el.style.mixBlendMode = 'multiply';
    } else if (a.type === 'text') {
      el.textContent = a.text || '';
      el.style.color = a.color || '#d61f3c';
      el.style.fontSize = `${Math.max(8, (Number(a.fontSize) || 14) * scale)}px`;
    } else if (a.type === 'note') {
      el.style.background = a.color || '#f5c518';
      el.innerHTML = '<span>!</span>';
      el.title = a.text || '';
    } else if (a.type === 'signature') {
      const sig = content.signatures.find((s) => s.id === a.signatureId);
      if (sig) {
        const img = document.createElement('img');
        img.src = sig.dataUrl;
        img.alt = 'signature';
        img.draggable = false;
        el.append(img);
      }
    }
    el.addEventListener('pointerdown', (e) => {
      if (tool !== 'select') return;
      e.stopPropagation();
      selectedId = a.id;
      drawAnnotations();
      renderAnnotationList();
      $('pdf-annotation-delete').disabled = false;
    });
    overlayEl.append(el);
  }
  renderAnnotationList();
}

function renderAnnotationList() {
  annotListEl.innerHTML = '';
  const items = content.annotations
    .map((a, i) => ({ a, i }))
    .sort((x, y) => Number(x.a.page) - Number(y.a.page) || x.i - y.i);
  if (!items.length) {
    annotListEl.innerHTML = '<p class="faint" style="font-size:12px">No annotations yet. Select text and highlight, or place a note, text box or signature.</p>';
    $('pdf-annotation-delete').disabled = true;
    return;
  }
  for (const { a } of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `annot-row${a.id === selectedId ? ' is-selected' : ''}`;
    const swatch = document.createElement('span');
    swatch.className = 'annot-dot';
    swatch.style.background = a.color || '#f5c518';
    const text = document.createElement('span');
    text.className = 'annot-text';
    const label = a.type === 'signature' ? 'Signature' : a.type === 'note' ? (a.text || 'Note') : a.type === 'text' ? (a.text || 'Text') : 'Highlight';
    text.innerHTML = `<strong>p${a.page} · ${a.type}</strong><span>${escapeHtml(String(label).slice(0, 60))}</span>`;
    row.append(swatch, text);
    row.addEventListener('click', () => {
      pageIndex = Number(a.page) - 1;
      selectedId = a.id;
      $('pdf-annotation-delete').disabled = false;
      renderPage(++renderToken);
    });
    annotListEl.append(row);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function updateNavigation() {
  const total = pdfDoc ? pdfDoc.numPages : 1;
  $('pdf-page-prev').disabled = pageIndex <= 0;
  $('pdf-page-next').disabled = pageIndex >= total - 1;
  $('pdf-page-left').disabled = pageIndex <= 0;
  $('pdf-page-right').disabled = pageIndex >= total - 1;
  $('pdf-page-delete').disabled = total <= 1;
  $('pdf-page-duplicate').disabled = !pdfDoc;
  $('pdf-page-insert').disabled = !pdfDoc;
  $('pdf-page-rotate').disabled = !pdfDoc;
  $('pdf-merge').disabled = !pdfDoc;
  $('pdf-split').disabled = !pdfDoc;
}

async function renderThumbnails(ignore) {
  if (!pdfDoc) return;
  const token = ++thumbsToken;
  thumbsEl.innerHTML = '';
  const total = Math.min(pdfDoc.numPages, 60);
  for (let i = 0; i < total; i += 1) {
    if (token !== thumbsToken) return;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `pdf-thumb${i === pageIndex ? ' is-active' : ''}${selectedPages.has(i) ? ' is-selected' : ''}`;
    item.dataset.page = String(i);
    const c = document.createElement('canvas');
    item.append(c);
    const num = document.createElement('span');
    num.className = 'pdf-thumb-num';
    num.textContent = String(i + 1);
    item.append(num);
    item.addEventListener('click', (e) => {
      if (e.shiftKey) {
        if (selectedPages.has(i)) selectedPages.delete(i);
        else selectedPages.add(i);
        if (selectedPages.size === 0) selectedPages.add(i);
        item.classList.toggle('is-selected', selectedPages.has(i));
        $('pdf-split').textContent = selectedPages.size > 1 ? `Split out ${selectedPages.size} pages` : 'Split out page';
        return;
      }
      pageIndex = i;
      selectedPages = new Set([i]);
      renderPage(++renderToken).then(() => {
        thumbsEl.querySelectorAll('.pdf-thumb').forEach((el, idx) => {
          el.classList.toggle('is-active', idx === i);
          el.classList.toggle('is-selected', selectedPages.has(idx));
        });
        renderAnnotationList();
      });
    });
    thumbsEl.append(item);
    try {
      const page = await pdfDoc.getPage(i + 1);
      const vp = page.getViewport({ scale: 0.16 });
      c.width = vp.width;
      c.height = vp.height;
      c.style.width = `${vp.width}px`;
      c.style.height = `${vp.height}px`;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    } catch { /* skip broken thumb */ }
  }
  if (pdfDoc.numPages > total) {
    const more = document.createElement('p');
    more.className = 'faint';
    more.style.fontSize = '11px';
    more.textContent = `+${pdfDoc.numPages - total} more pages`;
    thumbsEl.append(more);
  }
}

// ---------- zoom / navigation ----------
function setScale(next) {
  scale = Math.max(0.3, Math.min(3, next));
  renderPage(++renderToken);
}

async function fitWidth() {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const available = viewportEl.clientWidth - 56;
  fitScale = available / base.width;
  setScale(Math.max(0.4, Math.min(2, fitScale)));
}

$('pdf-zoom-in').addEventListener('click', () => setScale(scale + 0.15));
$('pdf-zoom-out').addEventListener('click', () => setScale(scale - 0.15));
$('pdf-zoom-fit').addEventListener('click', fitWidth);
$('pdf-page-prev').addEventListener('click', () => {
  if (pageIndex > 0) {
    pageIndex -= 1;
    selectedPages = new Set([pageIndex]);
    renderPage(++renderToken);
  }
});
$('pdf-page-next').addEventListener('click', () => {
  if (pdfDoc && pageIndex < pdfDoc.numPages - 1) {
    pageIndex += 1;
    selectedPages = new Set([pageIndex]);
    renderPage(++renderToken);
  }
});

// ---------- annotation creation ----------
function addAnnotation(annot) {
  pushHistory();
  const a = {
    id: uid(),
    page: pageIndex + 1,
    color: colorInput.value || '#f5c518',
    fontSize: Number(sizeInput.value) || 14,
    ...annot,
  };
  content.annotations.push(a);
  selectedId = a.id;
  ws.schedule();
  drawAnnotations();
  return a;
}

function linesOf(text, width, size) {
  const approx = Math.max(1, Math.floor(width / (size * 0.52)));
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > approx && line) {
        out.push(line.trim());
        line = word;
      } else line += ' ' + word;
    }
    out.push(line.trim());
  }
  return out;
}

stage.addEventListener('click', (e) => {
  if (!currentViewport || !pdfDoc) return;
  if (tool === 'select' || tool === 'highlight') return;
  if (e.target.closest('.pdf-annot')) return;
  const [px, py] = clientToPdf(e.clientX, e.clientY);

  if (tool === 'text') {
    const text = window.prompt('Text to place on this page');
    if (!text) return;
    const size = Number(sizeInput.value) || 14;
    const width = 260;
    const lines = linesOf(text, width, size);
    addAnnotation({ type: 'text', x: px, y: py - lines.length * size * 1.3, w: width, h: lines.length * size * 1.3, text, fontSize: size });
    setTool('select');
  } else if (tool === 'note') {
    const text = window.prompt('Comment');
    if (!text) return;
    addAnnotation({ type: 'note', x: px, y: py - 18, w: 18, h: 18, text });
    setTool('select');
  } else if (tool === 'signature') {
    const sig = content.signatures.find((s) => s.id === pendingSignature);
    if (!sig) {
      toast('Choose or create a signature first', true);
      return;
    }
    const width = 170;
    const height = Math.round(width * (sig.h / sig.w || 0.35));
    addAnnotation({ type: 'signature', x: px, y: py - height, w: width, h: height, signatureId: sig.id });
    setTool('select');
  }
});

// drop-to-create text/note
let dragStart = null;
let ghost = null;
stage.addEventListener('pointerdown', (e) => {
  if (tool !== 'highlight' || !currentViewport) return;
  if (e.target.closest('.pdf-annot')) return;
  dragStart = { x: e.clientX, y: e.clientY };
  ghost = document.createElement('div');
  ghost.className = 'pdf-ghost';
  stage.append(ghost);
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!dragStart || !ghost) return;
  const r = stage.getBoundingClientRect();
  ghost.style.left = `${Math.min(dragStart.x, e.clientX) - r.left}px`;
  ghost.style.top = `${Math.min(dragStart.y, e.clientY) - r.top}px`;
  ghost.style.width = `${Math.abs(e.clientX - dragStart.x)}px`;
  ghost.style.height = `${Math.abs(e.clientY - dragStart.y)}px`;
});
stage.addEventListener('pointerup', (e) => {
  if (!dragStart || !ghost) return;
  const start = dragStart;
  dragStart = null;
  ghost.remove();
  ghost = null;
  if (Math.abs(e.clientX - start.x) < 5 || Math.abs(e.clientY - start.y) < 5) return;
  const [ax, ay] = clientToPdf(start.x, start.y);
  const [bx, by] = clientToPdf(e.clientX, e.clientY);
  addAnnotation({
    type: 'highlight',
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  });
  setTool('select');
});

// highlight the browser text selection
function highlightSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !currentViewport) {
    hint('Select text in the page first (drag across it), then press Highlight. You can also drag a box while Highlight is active.');
    return false;
  }
  const range = sel.getRangeAt(0);
  if (!textLayerEl.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== textLayerEl) {
    hint('Select text inside the page first, then press Highlight.');
    return false;
  }
  const rects = [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
  if (!rects.length) return false;
  pushHistory();
  for (const r of rects) {
    const [ax, ay] = clientToPdf(r.left, r.top);
    const [bx, by] = clientToPdf(r.right, r.bottom);
    content.annotations.push({
      id: uid(),
      page: pageIndex + 1,
      type: 'highlight',
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      w: Math.abs(bx - ax),
      h: Math.abs(by - ay),
      color: colorInput.value || '#f5c518',
    });
  }
  sel.removeAllRanges();
  ws.schedule();
  drawAnnotations();
  setTool('select');
  toast(`${rects.length} highlight${rects.length === 1 ? '' : 's'} added`);
  return true;
}

document.querySelectorAll('#pdf-tools [data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.tool;
    if (next === 'highlight') {
      if (!highlightSelection()) setTool('highlight');
      return;
    }
    if (next === 'signature' && !content.signatures.length) {
      openSignatureDialog();
      return;
    }
    setTool(next);
  });
});

$('pdf-annotation-delete').addEventListener('click', () => {
  if (!selectedId) return;
  pushHistory();
  content.annotations = content.annotations.filter((a) => a.id !== selectedId);
  selectedId = null;
  ws.schedule();
  drawAnnotations();
});

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && document.activeElement === document.body) {
    e.preventDefault();
    $('pdf-annotation-delete').click();
  }
  if (e.key === 'PageDown' || e.key === 'ArrowRight') $('pdf-page-next').click();
  if (e.key === 'PageUp' || e.key === 'ArrowLeft') $('pdf-page-prev').click();
});

// ---------- undo / redo ----------
function snapshot() {
  return JSON.stringify({ pdf: content.pdf, annotations: content.annotations, signatures: content.signatures });
}
function restore(snap) {
  content = JSON.parse(snap);
  ws.schedule();
  drawAnnotations();
  loadDocument();
}
function pushHistory() {
  undoStack.push(snapshot());
  if (undoStack.length > 10) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  updateHistoryButtons();
  toast('Undo');
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  updateHistoryButtons();
  toast('Redo');
}
function updateHistoryButtons() {
  $('pdf-undo').disabled = !undoStack.length;
  $('pdf-redo').disabled = !redoStack.length;
}
$('pdf-undo').addEventListener('click', undo);
$('pdf-redo').addEventListener('click', redo);

// ---------- page operations (pdf-lib) ----------
async function mutatePdf(fn) {
  if (!content.pdf) return;
  pushHistory();
  try {
    const doc = await PDFDocument.load(b64ToBytes(content.pdf));
    await fn(doc);
    content.pdf = bytesToB64(await doc.save());
    pendingSignature = pendingSignature || null;
    ws.schedule();
    await loadDocument();
  } catch (err) {
    console.error('[pdf] operation failed', err);
    toast(err.message || 'PDF operation failed', true);
  }
}

function shiftAnnotations(from, to) {
  for (const a of content.annotations) {
    let idx = Number(a.page) - 1;
    if (idx === from) idx = to;
    else if (from < to && idx > from && idx <= to) idx -= 1;
    else if (from > to && idx >= to && idx < from) idx += 1;
    a.page = idx + 1;
  }
}

// A page inserted at index `at` pushes every page from there on down by one.
function shiftForInsert(at) {
  for (const a of content.annotations) {
    if (Number(a.page) - 1 >= at) a.page = Number(a.page) + 1;
  }
}

$('pdf-page-rotate').addEventListener('click', () => {
  mutatePdf((doc) => {
    const page = doc.getPage(pageIndex);
    page.setRotation(degrees((page.getRotation().angle + 90) % 360));
  });
});

$('pdf-page-delete').addEventListener('click', () => {
  mutatePdf((doc) => {
    if (doc.getPageCount() <= 1) throw new Error('A PDF needs at least one page');
    doc.removePage(pageIndex);
    content.annotations = content.annotations
      .filter((a) => Number(a.page) !== pageIndex + 1)
      .map((a) => (Number(a.page) > pageIndex + 1 ? { ...a, page: Number(a.page) - 1 } : a));
    pageIndex = Math.max(0, Math.min(pageIndex, doc.getPageCount() - 1));
  });
});

$('pdf-page-duplicate').addEventListener('click', () => {
  mutatePdf(async (doc) => {
    const [copy] = await doc.copyPages(doc, [pageIndex]);
    doc.insertPage(pageIndex + 1, copy);
    shiftForInsert(pageIndex + 1);
    pageIndex += 1;
  });
});

$('pdf-page-insert').addEventListener('click', () => {
  mutatePdf((doc) => {
    const current = doc.getPage(pageIndex);
    const { width, height } = current.getSize();
    doc.insertPage(pageIndex + 1, [width, height]);
    shiftForInsert(pageIndex + 1);
    pageIndex += 1;
  });
});

$('pdf-page-left').addEventListener('click', () => {
  if (pageIndex <= 0) return;
  mutatePdf(async (doc) => {
    const from = pageIndex;
    const to = pageIndex - 1;
    const [copy] = await doc.copyPages(doc, [from]);
    doc.removePage(from);
    doc.insertPage(to, copy);
    shiftAnnotations(from, to);
    pageIndex = to;
  });
});

$('pdf-page-right').addEventListener('click', () => {
  mutatePdf(async (doc) => {
    const from = pageIndex;
    const to = pageIndex + 1;
    if (to >= doc.getPageCount()) throw new Error('Already the last page');
    const [copy] = await doc.copyPages(doc, [from]);
    doc.removePage(from);
    doc.insertPage(to, copy);
    shiftAnnotations(from, to);
    pageIndex = to;
  });
});

$('pdf-merge').addEventListener('click', () => $('pdf-merge-input').click());
$('pdf-merge-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const other = await PDFDocument.load(bytes);
    pushHistory();
    const doc = await PDFDocument.load(b64ToBytes(content.pdf));
    const copies = await doc.copyPages(other, other.getPageIndices());
    for (const p of copies) doc.addPage(p);
    content.pdf = bytesToB64(await doc.save());
    ws.schedule();
    await loadDocument();
    toast(`Merged ${copies.length} page${copies.length === 1 ? '' : 's'} from ${file.name}`);
  } catch (err) {
    console.error('[pdf] merge failed', err);
    toast('Could not merge that PDF (encrypted or invalid)', true);
  }
});

$('pdf-split').addEventListener('click', async () => {
  if (!content.pdf) return;
  try {
    const indices = [...selectedPages].sort((a, b) => a - b);
    const src = await PDFDocument.load(b64ToBytes(content.pdf));
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, indices);
    for (const p of pages) out.addPage(p);
    const bytes = await out.save();
    const name = `${DOC.filename.replace(/\.pdf$/i, '')} p${indices.map((i) => i + 1).join(',')}`;
    const r = await fetch('/api/workspace/pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, pdf: bytesToB64(bytes) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not create the split PDF');
    hint(`Split out ${indices.length === 1 ? 'page' : `${indices.length} pages`} ${indices.map((i) => i + 1).join(', ')} → <a href="${j.url}">open the new PDF</a>.`);
    toast('Split PDF created');
  } catch (err) {
    toast(err.message || 'Split failed', true);
  }
});

// ---------- signatures ----------
let sigCtx = null;
let sigDrawing = false;
let sigInk = false;

function initSignaturePad() {
  const pad = $('sig-pad');
  sigCtx = pad.getContext('2d');
  sigCtx.clearRect(0, 0, pad.width, pad.height);
  sigCtx.strokeStyle = '#111827';
  sigCtx.lineWidth = 3;
  sigCtx.lineCap = 'round';
  sigCtx.lineJoin = 'round';
  sigInk = false;

  const point = (e) => {
    const r = pad.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * pad.width, y: ((e.clientY - r.top) / r.height) * pad.height };
  };
  pad.addEventListener('pointerdown', (e) => {
    sigDrawing = true;
    pad.setPointerCapture(e.pointerId);
    const p = point(e);
    sigCtx.beginPath();
    sigCtx.moveTo(p.x, p.y);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!sigDrawing) return;
    const p = point(e);
    sigCtx.lineTo(p.x, p.y);
    sigCtx.stroke();
    sigInk = true;
  });
  pad.addEventListener('pointerup', () => {
    sigDrawing = false;
  });
}

function trimCanvas(source) {
  const w = source.width;
  const h = source.height;
  const data = source.getContext('2d').getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return source;
  const pad = 6;
  const out = document.createElement('canvas');
  out.width = maxX - minX + pad * 2;
  out.height = maxY - minY + pad * 2;
  out.getContext('2d').drawImage(source, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function openSignatureDialog() {
  const pad = $('sig-pad');
  sigCtx = pad.getContext('2d');
  sigCtx.clearRect(0, 0, pad.width, pad.height);
  sigInk = false;
  $('pdf-signature-dlg').showModal();
}

$('sig-clear').addEventListener('click', () => {
  const pad = $('sig-pad');
  sigCtx = pad.getContext('2d');
  sigCtx.clearRect(0, 0, pad.width, pad.height);
  sigInk = false;
});

$('sig-file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const pad = $('sig-pad');
      sigCtx = pad.getContext('2d');
      sigCtx.clearRect(0, 0, pad.width, pad.height);
      const ratio = Math.min(pad.width / img.width, pad.height / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      sigCtx.drawImage(img, (pad.width - w) / 2, (pad.height - h) / 2, w, h);
      sigInk = true;
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
});

$('sig-save').addEventListener('click', () => {
  if (!sigInk) {
    toast('Draw or upload a signature first', true);
    return;
  }
  const trimmed = trimCanvas($('sig-pad'));
  const dataUrl = trimmed.toDataURL('image/png');
  const sig = { id: uid(), dataUrl, w: trimmed.width, h: trimmed.height };
  pushHistory();
  content.signatures.push(sig);
  pendingSignature = sig.id;
  ws.schedule();
  $('pdf-signature-dlg').close();
  renderSignatures();
  setTool('signature');
  toast('Signature saved — click a page to place it');
});

$('pdf-signature-new').addEventListener('click', openSignatureDialog);
$('pdf-signature-dlg').querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $('pdf-signature-dlg').close()));

function renderSignatures() {
  sigListEl.innerHTML = '';
  if (!content.signatures.length) {
    sigListEl.innerHTML = '<p class="faint" style="font-size:12px">No signatures yet.</p>';
    return;
  }
  for (const sig of content.signatures) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sig-item${sig.id === pendingSignature ? ' is-active' : ''}`;
    const img = document.createElement('img');
    img.src = sig.dataUrl;
    img.alt = 'signature';
    btn.append(img);
    btn.addEventListener('click', () => {
      pendingSignature = sig.id;
      renderSignatures();
      setTool('signature');
    });
    sigListEl.append(btn);
  }
}

initSignaturePad();
renderSignatures();
updateHistoryButtons();
$('pdf-annotation-delete').disabled = true;
setTool('select');
loadDocument().then(fitWidth);

window.addEventListener('resize', () => {
  clearTimeout(window.__pdfResize);
  window.__pdfResize = setTimeout(() => {
    if (pdfDoc && Math.abs(scale - fitScale) < 0.02) fitWidth();
  }, 200);
});
