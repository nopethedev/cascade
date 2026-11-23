/* Cascade Photo — layered raster/vector image editor.
 *
 * Raster layers keep a data URL (persisted) plus an in-memory canvas for fast
 * painting. Vector layers store editable shapes/text. PSD import uses
 * /public/photo/psd.js and reads the flattened composite.
 */
const DOC = window.__DOC__ || {};
const $ = (id) => document.getElementById(id);
const editable = DOC.canEdit !== false && window.__ACCESS__?.canEdit !== false;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

let content = normalizeContent(DOC.content);
let selectedLayerId = content.activeLayerId || content.layers[content.layers.length - 1]?.id || null;
let tool = 'move';
let zoom = 1;
let fg = '#111827';
let bg = '#ffffff';
let brushSize = 24;
let brushOpacity = 100;
let drag = null;
let shapePreview = null;
let cropPreview = null;
let undoStack = [];
let redoStack = [];
let exportFormat = 'png';
let replaceTargetId = null;
let prevTool = null;
let spaceDown = false;
let toastTimer = null;

const images = new Map();

const workspace = window.Workspace?.create({
  id: DOC.id,
  kind: 'photo',
  version: DOC.version,
  content,
  canEdit: editable,
  isPublic: DOC.isPublic,
  collect: () => cleanContent(),
  apply: (remote) => applyRemote(remote),
});

function uid(prefix = 'l') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeContent(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {
    w: clamp(Math.round(num(src.w, 1200)), 1, 12000),
    h: clamp(Math.round(num(src.h, 800)), 1, 12000),
    background: typeof src.background === 'string' ? src.background : '#ffffff',
    layers: Array.isArray(src.layers) ? src.layers.filter((l) => l && typeof l === 'object').map(normalizeLayer) : [],
    activeLayerId: null,
  };
  out.activeLayerId = out.layers.some((l) => l.id === src.activeLayerId) ? src.activeLayerId : out.layers[out.layers.length - 1]?.id || null;
  return out;
}

function normalizeLayer(input) {
  const type = ['raster', 'rect', 'ellipse', 'line', 'text'].includes(input.type) ? input.type : 'raster';
  const layer = {
    id: String(input.id || uid()),
    name: String(input.name || (type === 'raster' ? 'Layer' : type[0].toUpperCase() + type.slice(1))),
    type,
    x: num(input.x, 0),
    y: num(input.y, 0),
    w: Math.max(1, num(input.w, 1200)),
    h: Math.max(1, num(input.h, 800)),
    rotation: num(input.rotation, 0),
    opacity: clamp(num(input.opacity, 1), 0, 1),
    blend: typeof input.blend === 'string' ? input.blend : 'normal',
    visible: input.visible !== false,
  };
  if (type === 'raster') layer.src = typeof input.src === 'string' ? input.src : '';
  if (type === 'rect' || type === 'ellipse') {
    layer.fill = typeof input.fill === 'string' ? input.fill : '#38bdf8';
    layer.stroke = typeof input.stroke === 'string' ? input.stroke : '#0f172a';
    layer.strokeWidth = Math.max(0, num(input.strokeWidth, 0));
    layer.radius = Math.max(0, num(input.radius, 0));
  }
  if (type === 'line') {
    layer.fill = typeof input.fill === 'string' ? input.fill : '#38bdf8';
    layer.stroke = typeof input.stroke === 'string' ? input.stroke : '#38bdf8';
    layer.strokeWidth = Math.max(1, num(input.strokeWidth, 4));
    layer.x1 = num(input.x1, 0);
    layer.y1 = num(input.y1, 0);
    layer.x2 = num(input.x2, layer.w);
    layer.y2 = num(input.y2, layer.h);
  }
  if (type === 'text') {
    layer.text = String(input.text ?? 'Text');
    layer.color = typeof input.color === 'string' ? input.color : '#111827';
    layer.size = Math.max(1, num(input.size, 48));
    layer.font = String(input.font || 'Inter');
    layer.weight = clamp(num(input.weight, 600), 100, 900);
    layer.align = ['left', 'center', 'right'].includes(input.align) ? input.align : 'left';
  }
  if (input._canvas) layer._canvas = input._canvas;
  return layer;
}

function cleanContent() {
  return {
    w: content.w,
    h: content.h,
    background: content.background,
    activeLayerId: selectedLayerId,
    layers: content.layers.map((layer) => {
      const copy = { ...layer };
      delete copy._canvas;
      delete copy._dirty;
      return copy;
    }),
  };
}

function selected() {
  return content.layers.find((layer) => layer.id === selectedLayerId) || null;
}

function imageEntry(src) {
  if (!src) return null;
  let entry = images.get(src);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, waiters: [] };
    images.set(src, entry);
    img.onload = () => {
      entry.ready = true;
      const waiters = entry.waiters.splice(0);
      waiters.forEach((fn) => fn(entry.img));
      render();
    };
    img.onerror = () => {
      entry.error = true;
      entry.ready = false;
    };
    img.src = src;
  }
  return entry;
}

function rasterCanvas(layer) {
  if (layer._canvas) return layer._canvas;
  const canvas = document.createElement('canvas');
  canvas.width = content.w;
  canvas.height = content.h;
  layer._canvas = canvas;
  const entry = imageEntry(layer.src);
  if (!entry) return canvas;
  const paint = (img) => {
    if (layer._dirty) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    try { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); } catch { /* broken image */ }
    render();
  };
  if (entry.ready) paint(entry.img);
  else entry.waiters.push(paint);
  return canvas;
}

function blendMode(value) {
  const allowed = ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
  return allowed.includes(value) ? value : 'source-over';
}

function drawLayer(ctx, layer) {
  if (!layer || layer.visible === false || layer.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = clamp(layer.opacity, 0, 1);
  ctx.globalCompositeOperation = blendMode(layer.blend);
  ctx.translate(layer.x, layer.y);
  if (layer.rotation) {
    ctx.translate(layer.w / 2, layer.h / 2);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.translate(-layer.w / 2, -layer.h / 2);
  }
  if (layer.type === 'raster') {
    const canvas = rasterCanvas(layer);
    if (canvas) ctx.drawImage(canvas, 0, 0, layer.w, layer.h);
  } else if (layer.type === 'rect') {
    ctx.fillStyle = layer.fill || 'transparent';
    ctx.strokeStyle = layer.stroke || 'transparent';
    ctx.lineWidth = layer.strokeWidth || 0;
    ctx.beginPath();
    const r = Math.min(Math.max(0, layer.radius || 0), Math.abs(layer.w) / 2, Math.abs(layer.h) / 2);
    if (ctx.roundRect) ctx.roundRect(0, 0, layer.w, layer.h, r);
    else ctx.rect(0, 0, layer.w, layer.h);
    if (layer.fill && layer.fill !== 'none') ctx.fill();
    if (layer.strokeWidth > 0 && layer.stroke !== 'none') ctx.stroke();
  } else if (layer.type === 'ellipse') {
    ctx.fillStyle = layer.fill || 'transparent';
    ctx.strokeStyle = layer.stroke || 'transparent';
    ctx.lineWidth = layer.strokeWidth || 0;
    ctx.beginPath();
    ctx.ellipse(layer.w / 2, layer.h / 2, Math.abs(layer.w / 2), Math.abs(layer.h / 2), 0, 0, Math.PI * 2);
    if (layer.fill && layer.fill !== 'none') ctx.fill();
    if (layer.strokeWidth > 0 && layer.stroke !== 'none') ctx.stroke();
  } else if (layer.type === 'line') {
    ctx.strokeStyle = layer.stroke && layer.stroke !== 'none' ? layer.stroke : layer.fill || '#38bdf8';
    ctx.lineWidth = Math.max(1, layer.strokeWidth || 4);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(num(layer.x1, 0), num(layer.y1, 0));
    ctx.lineTo(num(layer.x2, layer.w), num(layer.y2, layer.h));
    ctx.stroke();
  } else if (layer.type === 'text') {
    ctx.fillStyle = layer.color || '#111827';
    ctx.font = `${clamp(layer.weight, 100, 900)} ${layer.size}px "${String(layer.font || 'Inter').replace(/"/g, '')}", sans-serif`;
    ctx.textAlign = layer.align === 'center' ? 'center' : layer.align === 'right' ? 'right' : 'left';
    ctx.textBaseline = 'top';
    const tx = layer.align === 'center' ? layer.w / 2 : layer.align === 'right' ? layer.w : 0;
    String(layer.text || '').split('\n').forEach((line, i) => {
      ctx.fillText(line, tx, i * layer.size * 1.2);
    });
  }
  ctx.restore();
}

function flattenCanvas(scale = 1, includeBackground = true) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(content.w * scale));
  canvas.height = Math.max(1, Math.round(content.h * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  if (includeBackground) {
    ctx.fillStyle = content.background || '#ffffff';
    ctx.fillRect(0, 0, content.w, content.h);
  }
  for (const layer of content.layers) drawLayer(ctx, layer);
  return canvas;
}

/* ---------------- rendering ---------------- */
function render() {
  const canvas = $('ph-canvas');
  const overlay = $('ph-overlay');
  if (!canvas || !overlay) return;
  if (canvas.width !== content.w || canvas.height !== content.h) {
    canvas.width = content.w;
    canvas.height = content.h;
    overlay.width = content.w;
    overlay.height = content.h;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, content.w, content.h);
  ctx.fillStyle = content.background || '#ffffff';
  ctx.fillRect(0, 0, content.w, content.h);
  for (const layer of content.layers) drawLayer(ctx, layer);
  applyZoom();
  drawOverlay();
  const empty = $('ph-empty');
  if (empty) empty.hidden = content.layers.length > 0;
  const count = $('ph-layer-count');
  if (count) count.textContent = `${content.layers.length} layer${content.layers.length === 1 ? '' : 's'}`;
  const size = $('ph-doc-size');
  if (size) size.textContent = `${content.w} × ${content.h}`;
  $('ph-app')?.classList.toggle('has-selection', !!selected());
}

function applyZoom() {
  const wrap = $('ph-canvas-wrap');
  if (wrap) {
    wrap.style.width = `${Math.max(1, content.w * zoom)}px`;
    wrap.style.height = `${Math.max(1, content.h * zoom)}px`;
  }
  const label = $('ph-zoom-label');
  if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  const status = $('ph-status-zoom');
  if (status) status.textContent = `${Math.round(zoom * 100)}%`;
}

function layerBounds(layer) {
  return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
}

function drawOverlay() {
  const overlay = $('ph-overlay');
  if (!overlay) return;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const scale = 1 / Math.max(zoom, 0.05);
  const layer = selected();

  if (cropPreview) {
    const r = cropPreview;
    ctx.save();
    ctx.fillStyle = 'rgba(2,6,12,.55)';
    ctx.beginPath();
    ctx.rect(0, 0, content.w, content.h);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash([7 * scale, 5 * scale]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  if (shapePreview) {
    const p = shapePreview;
    ctx.save();
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.setLineDash([6 * scale, 4 * scale]);
    ctx.beginPath();
    if (p.tool === 'line') {
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
    } else if (p.tool === 'ellipse') {
      ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, Math.abs(p.w / 2), Math.abs(p.h / 2), 0, 0, Math.PI * 2);
    } else {
      ctx.rect(p.x, p.y, p.w, p.h);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (layer && tool === 'move' && layer.visible !== false) {
    const b = layerBounds(layer);
    ctx.save();
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.setLineDash([6 * scale, 4 * scale]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    const hs = Math.max(3, 7 * scale);
    for (const point of handlePoints(b)) {
      ctx.fillStyle = '#0b1220';
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      ctx.fillRect(point.x - hs / 2, point.y - hs / 2, hs, hs);
      ctx.strokeRect(point.x - hs / 2, point.y - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  if (drag?.kind === 'move' && layer) {
    ctx.save();
    ctx.fillStyle = 'rgba(56,189,248,.1)';
    ctx.fillRect(layer.x, layer.y, layer.w, layer.h);
    ctx.restore();
  }
}

function handlePoints(b) {
  const xs = [b.x, b.x + b.w / 2, b.x + b.w];
  const ys = [b.y, b.y + b.h / 2, b.y + b.h];
  return [
    { name: 'nw', x: xs[0], y: ys[0] }, { name: 'n', x: xs[1], y: ys[0] }, { name: 'ne', x: xs[2], y: ys[0] },
    { name: 'e', x: xs[2], y: ys[1] }, { name: 'se', x: xs[2], y: ys[2] }, { name: 's', x: xs[1], y: ys[2] },
    { name: 'sw', x: xs[0], y: ys[2] }, { name: 'w', x: xs[0], y: ys[1] },
  ];
}

function hitHandle(point, layer) {
  const threshold = Math.max(4, 9 / Math.max(zoom, 0.1));
  for (const handle of handlePoints(layerBounds(layer))) {
    if (Math.abs(point.x - handle.x) <= threshold && Math.abs(point.y - handle.y) <= threshold) return handle.name;
  }
  return null;
}

function handleCursor(name) {
  if (name === 'nw' || name === 'se') return 'nwse-resize';
  if (name === 'ne' || name === 'sw') return 'nesw-resize';
  if (name === 'n' || name === 's') return 'ns-resize';
  if (name === 'e' || name === 'w') return 'ew-resize';
  return 'move';
}

function hitLayer(point) {
  for (let i = content.layers.length - 1; i >= 0; i--) {
    const layer = content.layers[i];
    if (layer.visible === false) continue;
    if (point.x >= layer.x && point.x <= layer.x + layer.w && point.y >= layer.y && point.y <= layer.y + layer.h) return layer;
  }
  return null;
}

/* ---------------- history ---------------- */
function snapshot() {
  return JSON.stringify(cleanContent());
}

function pushHistory() {
  if (!editable) return;
  undoStack.push(snapshot());
  if (undoStack.length > 20) undoStack.shift();
  redoStack = [];
}

function restoreSnapshot(json) {
  try {
    content = normalizeContent(JSON.parse(json));
  } catch {
    return;
  }
  selectedLayerId = content.activeLayerId || content.layers[content.layers.length - 1]?.id || null;
  renderAll();
  scheduleSave();
}

function undo() {
  if (!editable || !undoStack.length) return;
  redoStack.push(snapshot());
  restoreSnapshot(undoStack.pop());
  toast('Undo');
}

function redo() {
  if (!editable || !redoStack.length) return;
  undoStack.push(snapshot());
  restoreSnapshot(redoStack.pop());
  toast('Redo');
}

function scheduleSave() {
  workspace?.schedule?.();
  const state = $('ph-save-state');
  if (state) state.textContent = 'Unsaved changes';
}

/* ---------------- layers ---------------- */
function selectLayer(id, { renderProps = true } = {}) {
  selectedLayerId = id;
  content.activeLayerId = id;
  renderLayers();
  if (renderProps) syncProps();
  render();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function renderLayers() {
  const host = $('ph-layers');
  if (!host) return;
  if (!content.layers.length) {
    host.innerHTML = '<div class="ph-layers-empty">No layers yet. Paint, add a shape, or open an image.</div>';
    return;
  }
  const rows = [...content.layers].reverse().map((layer) => {
    const isSelected = layer.id === selectedLayerId;
    const thumb = layer.type === 'raster' && layer.src
      ? `<img src="${escapeAttr(layer.src)}" alt="" />`
      : `<i style="background:${escapeAttr(layer.fill || (layer.type === 'text' ? layer.color : '#64748b'))}"></i>`;
    return `<div class="ph-layer${isSelected ? ' sel' : ''}${layer.visible === false ? ' hidden-layer' : ''}" data-layer="${escapeAttr(layer.id)}" role="button" tabindex="0">
      <button class="ph-eye" type="button" data-eye="${escapeAttr(layer.id)}" aria-label="${layer.visible === false ? 'Show' : 'Hide'} layer">${window.CascadeIcons?.svg('eye') || '◉'}</button>
      <span class="ph-thumb">${thumb}</span>
      <span class="ph-layer-meta"><b>${escapeHtml(layer.name)}</b><small>${layer.type}</small></span>
      <span class="ph-layer-op">${Math.round(layer.opacity * 100)}%</span>
    </div>`;
  });
  host.innerHTML = rows.join('');
}

function addRasterLayer(name = 'Layer', canvas = null) {
  const c = canvas || document.createElement('canvas');
  if (!canvas) {
    c.width = content.w;
    c.height = content.h;
  }
  const layer = normalizeLayer({
    id: uid(), name, type: 'raster', x: 0, y: 0, w: content.w, h: content.h,
    src: c.toDataURL('image/png'), opacity: 1, blend: 'normal', visible: true,
  });
  layer._canvas = c;
  content.layers.push(layer);
  selectedLayerId = layer.id;
  content.activeLayerId = layer.id;
  return layer;
}

function createRasterForPaint() {
  pushHistory();
  const layer = addRasterLayer(`Paint ${content.layers.filter((l) => l.type === 'raster').length + 1}`);
  renderLayers();
  syncProps();
  return layer;
}

function duplicateLayer() {
  const layer = selected();
  if (!layer || !editable) return;
  pushHistory();
  const copy = normalizeLayer({ ...layer, id: uid(), name: `${layer.name} copy`, x: layer.x + 18, y: layer.y + 18, _canvas: null });
  if (layer.type === 'raster') {
    const source = rasterCanvas(layer);
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    c.getContext('2d').drawImage(source, 0, 0);
    copy._canvas = c;
    copy.src = c.toDataURL('image/png');
  }
  content.layers.push(copy);
  selectLayer(copy.id);
  scheduleSave();
}

function deleteLayer() {
  const layer = selected();
  if (!layer || !editable) return;
  if (content.layers.length <= 1) return toast('The document needs at least one layer.', true);
  pushHistory();
  content.layers = content.layers.filter((l) => l.id !== layer.id);
  selectedLayerId = content.layers[content.layers.length - 1]?.id || null;
  content.activeLayerId = selectedLayerId;
  renderAll();
  scheduleSave();
}

function moveLayer(direction) {
  const layer = selected();
  if (!layer || !editable) return;
  const index = content.layers.indexOf(layer);
  const next = index + direction;
  if (next < 0 || next >= content.layers.length) return;
  pushHistory();
  content.layers.splice(index, 1);
  content.layers.splice(next, 0, layer);
  renderLayers();
  render();
  scheduleSave();
}

function toggleVisibility(id) {
  const layer = content.layers.find((l) => l.id === id);
  if (!layer || !editable) return;
  pushHistory();
  layer.visible = layer.visible === false;
  renderLayers();
  render();
  scheduleSave();
}

/* ---------------- properties ---------------- */
function syncProps() {
  const layer = selected();
  const empty = $('ph-prop-empty');
  const body = $('ph-prop-body');
  if (empty) empty.hidden = !!layer;
  if (body) body.hidden = !layer;
  if (!layer) return;
  $('ph-prop-name').value = layer.name;
  $('ph-prop-x').value = Math.round(layer.x);
  $('ph-prop-y').value = Math.round(layer.y);
  $('ph-prop-w').value = Math.round(layer.w);
  $('ph-prop-h').value = Math.round(layer.h);
  $('ph-prop-rotation').value = Math.round(layer.rotation || 0);
  $('ph-prop-blend').value = layer.blend || 'normal';
  $('ph-prop-opacity').value = Math.round(layer.opacity * 100);
  $('ph-prop-opacity-out').textContent = `${Math.round(layer.opacity * 100)}%`;
  const groupName = layer.type === 'text' ? 'text' : layer.type === 'raster' ? 'raster' : 'shape';
  for (const group of document.querySelectorAll('[data-prop-group]')) {
    group.hidden = group.dataset.propGroup !== groupName;
  }
  if (layer.type === 'raster') {
    /* replace button only */
  }
  if (layer.type === 'rect' || layer.type === 'ellipse' || layer.type === 'line') {
    $('ph-prop-fill').value = toColorInput(layer.fill, '#38bdf8');
    $('ph-prop-stroke').value = toColorInput(layer.stroke, '#0f172a');
    $('ph-prop-stroke-width').value = Math.round(layer.strokeWidth || 0);
    $('ph-prop-radius').value = Math.round(layer.radius || 0);
  }
  if (layer.type === 'text') {
    $('ph-prop-text').value = layer.text || '';
    $('ph-prop-size').value = Math.round(layer.size);
    $('ph-prop-weight').value = layer.weight;
    $('ph-prop-color').value = toColorInput(layer.color, '#111827');
    $('ph-prop-align').value = layer.align || 'left';
    $('ph-prop-font').value = layer.font || 'Inter';
  }
}

function toColorInput(value, fallback) {
  const s = String(value || '');
  return /^#[0-9a-f]{6}$/i.test(s) ? s : fallback;
}

function setLayerNumber(key, value, min = -100000) {
  const layer = selected();
  if (!layer || !editable) return;
  layer[key] = Math.max(min, num(value, layer[key]));
  render();
  scheduleSave();
}

function setLayerColor(key, value) {
  const layer = selected();
  if (!layer || !editable) return;
  layer[key] = value;
  render();
  scheduleSave();
}

/* ---------------- canvas size, flatten, rotate ---------------- */
function resizeDocument(nextW, nextH) {
  if (!editable) return;
  const w = clamp(Math.round(nextW), 1, 12000);
  const h = clamp(Math.round(nextH), 1, 12000);
  if (w === content.w && h === content.h) return;
  pushHistory();
  const oldW = content.w;
  const oldH = content.h;
  for (const layer of content.layers) {
    if (layer.type === 'raster') {
      const old = rasterCanvas(layer);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(old, 0, 0);
      layer._canvas = c;
      layer.src = c.toDataURL('image/png');
      layer._dirty = true;
      if (layer.w === oldW && layer.h === oldH) {
        layer.w = w;
        layer.h = h;
      }
    }
  }
  content.w = w;
  content.h = h;
  renderAll();
  scheduleSave();
  toast(`Canvas ${w} × ${h}`);
}

function cropDocument(rect) {
  if (!editable) return;
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  if (w < 2 || h < 2) return;
  pushHistory();
  for (const layer of content.layers) {
    if (layer.type === 'raster') {
      const old = rasterCanvas(layer);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(old, layer.x - x, layer.y - y);
      layer._canvas = c;
      layer.src = c.toDataURL('image/png');
      layer._dirty = true;
      layer.x = 0;
      layer.y = 0;
      layer.w = w;
      layer.h = h;
    } else {
      layer.x -= x;
      layer.y -= y;
    }
  }
  content.w = w;
  content.h = h;
  renderAll();
  scheduleSave();
  toast(`Cropped to ${w} × ${h}`);
}

function flattenImage() {
  if (!editable) return;
  pushHistory();
  const canvas = flattenCanvas(1, true);
  const layer = normalizeLayer({
    id: uid(), name: 'Flattened', type: 'raster', x: 0, y: 0, w: content.w, h: content.h,
    src: canvas.toDataURL('image/png'), opacity: 1, blend: 'normal', visible: true,
  });
  layer._canvas = canvas;
  content.layers = [layer];
  selectedLayerId = layer.id;
  content.activeLayerId = layer.id;
  renderAll();
  scheduleSave();
  toast('Image flattened');
}

function rotateDocument(direction) {
  if (!editable) return;
  pushHistory();
  const flat = flattenCanvas(1, true);
  const c = document.createElement('canvas');
  c.width = content.h;
  c.height = content.w;
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0);
  ctx.rotate((Math.PI / 2) * (direction < 0 ? -1 : 1));
  ctx.drawImage(flat, 0, 0);
  const layer = normalizeLayer({
    id: uid(), name: 'Rotated', type: 'raster', x: 0, y: 0, w: c.width, h: c.height,
    src: c.toDataURL('image/png'), opacity: 1, blend: 'normal', visible: true,
  });
  layer._canvas = c;
  content.w = c.width;
  content.h = c.height;
  content.layers = [layer];
  selectedLayerId = layer.id;
  content.activeLayerId = layer.id;
  renderAll();
  scheduleSave();
  toast('Rotated 90°');
}

/* ---------------- tools and pointer handling ---------------- */
function setTool(next) {
  if (!['move', 'brush', 'eraser', 'rect', 'ellipse', 'line', 'text', 'crop', 'pan'].includes(next)) return;
  tool = next;
  document.querySelectorAll('.ph-tool').forEach((button) => button.classList.toggle('on', button.dataset.tool === tool));
  $('ph-app')?.setAttribute('data-tool', tool);
  const hint = $('ph-tool-hint');
  const hints = {
    move: 'Move: drag a layer, corner to resize',
    brush: 'Brush: paint on the active raster layer',
    eraser: 'Eraser: remove pixels from the active raster layer',
    rect: 'Rectangle: drag to add a filled shape',
    ellipse: 'Ellipse: drag to add an ellipse',
    line: 'Line: drag to draw a line',
    text: 'Text: click the canvas to add text',
    crop: 'Crop: drag a region, then release',
    pan: 'Pan: drag to move around the canvas',
  };
  if (hint) hint.textContent = hints[tool];
  const cursor = tool === 'move' ? 'default' : tool === 'text' ? 'text' : tool === 'pan' ? 'grab' : 'crosshair';
  const overlay = $('ph-overlay');
  if (overlay && !drag) overlay.style.cursor = cursor;
  render();
}

function docPoint(event) {
  const overlay = $('ph-overlay');
  const rect = overlay.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (content.w / Math.max(1, rect.width)),
    y: (event.clientY - rect.top) * (content.h / Math.max(1, rect.height)),
  };
}

function normalizeRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

function startBrush(point) {
  let layer = selected();
  if (!layer || layer.type !== 'raster') layer = createRasterForPaint();
  const canvas = rasterCanvas(layer);
  layer._dirty = true;
  const ctx = canvas.getContext('2d');
  const local = { x: point.x - layer.x, y: point.y - layer.y };
  ctx.save();
  ctx.globalAlpha = brushOpacity / 100;
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(local.x, local.y, Math.max(0.5, brushSize / 2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drag = { kind: 'brush', layer, last: local, canvas };
  render();
}

function continueBrush(point) {
  const layer = drag.layer;
  const local = { x: point.x - layer.x, y: point.y - layer.y };
  const ctx = drag.canvas.getContext('2d');
  ctx.save();
  ctx.globalAlpha = brushOpacity / 100;
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = fg;
  ctx.lineWidth = brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(drag.last.x, drag.last.y);
  ctx.lineTo(local.x, local.y);
  ctx.stroke();
  ctx.restore();
  drag.last = local;
  render();
}

function finishBrush() {
  const layer = drag.layer;
  layer.src = drag.canvas.toDataURL('image/png');
  layer._dirty = true;
  renderLayers();
  scheduleSave();
}

function createTextAt(point) {
  pushHistory();
  const layer = normalizeLayer({
    id: uid(), name: 'Text', type: 'text', x: Math.round(point.x), y: Math.round(point.y),
    w: Math.max(240, content.w - point.x), h: Math.max(64, 48 * 1.4),
    text: 'Double-click the text in Properties', color: fg, size: 48, font: 'Inter', weight: 600, align: 'left',
    opacity: 1, blend: 'normal', visible: true,
  });
  content.layers.push(layer);
  selectedLayerId = layer.id;
  content.activeLayerId = layer.id;
  renderAll();
  scheduleSave();
  setTimeout(() => {
    const field = $('ph-prop-text');
    if (field) { field.focus(); field.select(); }
  }, 30);
}

function finishShape() {
  const preview = shapePreview;
  shapePreview = null;
  if (!preview) return;
  pushHistory();
  if (preview.tool === 'line') {
    const length = Math.hypot(preview.x2 - preview.x1, preview.y2 - preview.y1);
    if (length < 2) return;
    const layer = normalizeLayer({
      id: uid(), name: 'Line', type: 'line',
      x: Math.min(preview.x1, preview.x2), y: Math.min(preview.y1, preview.y2),
      w: Math.max(1, Math.abs(preview.x2 - preview.x1)), h: Math.max(1, Math.abs(preview.y2 - preview.y1)),
      x1: preview.x1 - Math.min(preview.x1, preview.x2), y1: preview.y1 - Math.min(preview.y1, preview.y2),
      x2: preview.x2 - Math.min(preview.x1, preview.x2), y2: preview.y2 - Math.min(preview.y1, preview.y2),
      stroke: fg, fill: fg, strokeWidth: brushSize, opacity: brushOpacity / 100, blend: 'normal', visible: true,
    });
    content.layers.push(layer);
    selectedLayerId = layer.id;
    content.activeLayerId = layer.id;
  } else {
    const rect = normalizeRect({ x: preview.x1, y: preview.y1 }, { x: preview.x2, y: preview.y2 });
    if (rect.w < 2 || rect.h < 2) return;
    const layer = normalizeLayer({
      id: uid(), name: preview.tool === 'ellipse' ? 'Ellipse' : 'Rectangle', type: preview.tool,
      ...rect, fill: fg, stroke: fg, strokeWidth: 0, radius: 0,
      opacity: brushOpacity / 100, blend: 'normal', visible: true,
    });
    content.layers.push(layer);
    selectedLayerId = layer.id;
    content.activeLayerId = layer.id;
  }
  renderAll();
  scheduleSave();
}

function onPointerDown(event) {
  if (!editable) return;
  if (event.button === 2) return;
  const overlay = $('ph-overlay');
  if (event.button === 1 || tool === 'pan' || spaceDown) {
    const stage = $('ph-stage');
    drag = { kind: 'pan', sx: event.clientX, sy: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    overlay.setPointerCapture(event.pointerId);
    overlay.style.cursor = 'grabbing';
    event.preventDefault();
    return;
  }
  const point = docPoint(event);
  if (tool === 'move') {
    const layer = selected();
    const handle = layer ? hitHandle(point, layer) : null;
    if (layer && handle) {
      pushHistory();
      drag = { kind: 'resize', layer, handle, start: point, box: { x: layer.x, y: layer.y, w: layer.w, h: layer.h } };
    } else {
      let target = layer && point.x >= layer.x && point.x <= layer.x + layer.w && point.y >= layer.y && point.y <= layer.y + layer.h ? layer : null;
      if (!target) target = hitLayer(point);
      if (!target) {
        selectedLayerId = null;
        content.activeLayerId = null;
        renderLayers();
        syncProps();
        render();
        return;
      }
      selectLayer(target.id);
      pushHistory();
      drag = { kind: 'move', layer: target, start: point, box: { x: target.x, y: target.y } };
    }
    overlay.setPointerCapture(event.pointerId);
    event.preventDefault();
    render();
    return;
  }
  if (tool === 'brush' || tool === 'eraser') {
    startBrush(point);
    overlay.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (tool === 'text') {
    createTextAt(point);
    event.preventDefault();
    return;
  }
  if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
    shapePreview = { tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, x: point.x, y: point.y, w: 0, h: 0 };
    drag = { kind: 'shape' };
    overlay.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (tool === 'crop') {
    cropPreview = { x: point.x, y: point.y, w: 0, h: 0 };
    drag = { kind: 'crop', start: point };
    overlay.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
}

function onPointerMove(event) {
  if (!editable) return;
  const point = docPoint(event);
  if (!drag) {
    if (tool === 'move') {
      const layer = selected();
      const handle = layer ? hitHandle(point, layer) : null;
      const overlay = $('ph-overlay');
      if (overlay) overlay.style.cursor = handle ? handleCursor(handle) : layer && point.x >= layer.x && point.x <= layer.x + layer.w && point.y >= layer.y && point.y <= layer.y + layer.h ? 'move' : 'default';
    }
    return;
  }
  if (drag.kind === 'pan') {
    const stage = $('ph-stage');
    stage.scrollLeft = drag.left - (event.clientX - drag.sx);
    stage.scrollTop = drag.top - (event.clientY - drag.sy);
    return;
  }
  if (drag.kind === 'brush') {
    continueBrush(point);
    return;
  }
  if (drag.kind === 'shape') {
    shapePreview.x2 = point.x;
    shapePreview.y2 = point.y;
    shapePreview.x = Math.min(shapePreview.x1, point.x);
    shapePreview.y = Math.min(shapePreview.y1, point.y);
    shapePreview.w = Math.abs(point.x - shapePreview.x1);
    shapePreview.h = Math.abs(point.y - shapePreview.y1);
    drawOverlay();
    return;
  }
  if (drag.kind === 'crop') {
    const rect = normalizeRect(drag.start, point);
    cropPreview = rect;
    drawOverlay();
    return;
  }
  if (drag.kind === 'move') {
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    drag.layer.x = Math.round(drag.box.x + dx);
    drag.layer.y = Math.round(drag.box.y + dy);
    render();
    return;
  }
  if (drag.kind === 'resize') {
    const box = drag.box;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    let { x, y, w, h } = box;
    if (drag.handle.includes('e')) w = Math.max(2, box.w + dx);
    if (drag.handle.includes('s')) h = Math.max(2, box.h + dy);
    if (drag.handle.includes('w')) { w = Math.max(2, box.w - dx); x = box.x + dx; }
    if (drag.handle.includes('n')) { h = Math.max(2, box.h - dy); y = box.y + dy; }
    drag.layer.x = Math.round(x);
    drag.layer.y = Math.round(y);
    drag.layer.w = Math.round(w);
    drag.layer.h = Math.round(h);
    if (drag.layer.type === 'text') drag.layer.h = Math.max(drag.layer.size * 1.4, h);
    renderLayers();
    render();
  }
}

function onPointerUp() {
  if (!drag) return;
  const kind = drag.kind;
  if (kind === 'brush') finishBrush();
  if (kind === 'shape') finishShape();
  if (kind === 'crop' && cropPreview) {
    const rect = cropPreview;
    cropPreview = null;
    if (rect.w > 3 && rect.h > 3) cropDocument(rect);
  }
  if (kind === 'move' || kind === 'resize') {
    syncProps();
    renderLayers();
    scheduleSave();
  }
  drag = null;
  shapePreview = null;
  cropPreview = null;
  const overlay = $('ph-overlay');
  if (overlay) overlay.style.cursor = tool === 'pan' ? 'grab' : tool === 'move' ? 'default' : 'crosshair';
  render();
}

/* ---------------- files: images and PSD ---------------- */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode that image.'));
    img.src = src;
  });
}

function makeDocCanvas(source, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const scale = Math.min(w / source.width, h / source.height);
  const dw = Math.max(1, Math.round(source.width * scale));
  const dh = Math.max(1, Math.round(source.height * scale));
  ctx.drawImage(source, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
  return canvas;
}

function addImportedCanvas(canvas, name) {
  const first = content.layers.length === 0;
  if (first) {
    content.w = canvas.width;
    content.h = canvas.height;
  }
  const placed = first ? canvas : makeDocCanvas(canvas, content.w, content.h);
  const layer = addRasterLayer(name, placed);
  renderAll();
  scheduleSave();
  toast(first ? `Opened ${name}` : `Added ${name} as a layer`);
  return layer;
}

async function openFile(file, { replace = false } = {}) {
  if (!file) return;
  const status = $('ph-save-state');
  if (status) status.textContent = 'Reading…';
  try {
    const buffer = await file.arrayBuffer();
    if (window.CascadePSD?.isPsd(buffer)) {
      const psd = window.CascadePSD.parse(buffer);
      const source = document.createElement('canvas');
      source.width = psd.width;
      source.height = psd.height;
      source.getContext('2d').putImageData(new ImageData(psd.data, psd.width, psd.height), 0, 0);
      if (replace) {
        const layer = selected();
        if (!layer || layer.type !== 'raster') throw new Error('Select a raster layer to replace.');
        pushHistory();
        const c = makeDocCanvas(source, content.w, content.h);
        layer._canvas = c;
        layer.src = c.toDataURL('image/png');
        layer._dirty = true;
        renderAll();
        scheduleSave();
        toast('Layer pixels replaced');
      } else {
        pushHistory();
        addImportedCanvas(source, file.name || 'Photoshop import');
      }
      if (status) status.textContent = 'PSD imported';
      return;
    }
    const url = URL.createObjectURL(file);
    let img;
    try { img = await loadImage(url); } finally { URL.revokeObjectURL(url); }
    if (replace) {
      const layer = selected();
      if (!layer || layer.type !== 'raster') throw new Error('Select a raster layer to replace.');
      pushHistory();
      const c = makeDocCanvas(img, content.w, content.h);
      layer._canvas = c;
      layer.src = c.toDataURL('image/png');
      layer._dirty = true;
      renderAll();
      scheduleSave();
      toast('Layer pixels replaced');
    } else {
      pushHistory();
      addImportedCanvas(img, file.name || 'Image');
    }
    if (status) status.textContent = 'Ready';
  } catch (error) {
    if (status) status.textContent = 'Import failed';
    toast(error.message || 'Could not open that file', true);
  }
}

/* ---------------- export ---------------- */
function safeName() {
  return String(DOC.filename || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-') || 'photo';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportRaster(format) {
  const scale = clamp(num($('ph-export-scale')?.value, 100) / 100, 0.25, 4);
  const quality = clamp(num($('ph-export-quality')?.value, 92) / 100, 0.4, 1);
  const canvas = flattenCanvas(scale, true);
  const mime = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const status = $('ph-export-status');
  if (status) status.textContent = 'Rendering…';
  canvas.toBlob((blob) => {
    if (!blob) {
      if (status) status.textContent = 'This browser could not encode that format.';
      return;
    }
    downloadBlob(blob, `${safeName()}.${format === 'jpg' ? 'jpg' : format}`);
    if (status) status.textContent = `Exported ${canvas.width} × ${canvas.height} ${format.toUpperCase()}`;
    toast(`Exported ${format.toUpperCase()}`);
  }, mime, quality);
}

function svgEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function safeColor(value, fallback = 'transparent') {
  const s = String(value || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^(?:rgb|hsl)a?\([0-9.,%\s/+-]+\)$/i.test(s)) return s;
  if (/^[a-z]{3,24}$/i.test(s)) return s;
  return fallback;
}

function buildSvg() {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${content.w}" height="${content.h}" viewBox="0 0 ${content.w} ${content.h}">`,
    `<rect width="${content.w}" height="${content.h}" fill="${svgEscape(safeColor(content.background, '#ffffff'))}"/>`,
  ];
  for (const layer of content.layers) {
    if (layer.visible === false || layer.opacity <= 0) continue;
    const opacity = clamp(layer.opacity, 0, 1);
    const transform = `translate(${layer.x} ${layer.y})${layer.rotation ? ` rotate(${layer.rotation} ${layer.w / 2} ${layer.h / 2})` : ''}`;
    const common = `opacity="${opacity}" transform="${transform}"${layer.blend && layer.blend !== 'normal' ? ` style="mix-blend-mode:${layer.blend}"` : ''}`;
    if (layer.type === 'raster') {
      if (!layer.src || !/^data:image\//i.test(layer.src)) continue;
      parts.push(`<image ${common} href="${layer.src}" x="0" y="0" width="${layer.w}" height="${layer.h}" preserveAspectRatio="none"/>`);
    } else if (layer.type === 'rect') {
      parts.push(`<rect ${common} width="${layer.w}" height="${layer.h}" rx="${Math.max(0, layer.radius || 0)}" fill="${svgEscape(safeColor(layer.fill, 'transparent'))}" stroke="${svgEscape(safeColor(layer.stroke, 'none'))}" stroke-width="${Math.max(0, layer.strokeWidth || 0)}"/>`);
    } else if (layer.type === 'ellipse') {
      parts.push(`<ellipse ${common} cx="${layer.w / 2}" cy="${layer.h / 2}" rx="${layer.w / 2}" ry="${layer.h / 2}" fill="${svgEscape(safeColor(layer.fill, 'transparent'))}" stroke="${svgEscape(safeColor(layer.stroke, 'none'))}" stroke-width="${Math.max(0, layer.strokeWidth || 0)}"/>`);
    } else if (layer.type === 'line') {
      parts.push(`<line ${common} x1="${num(layer.x1, 0)}" y1="${num(layer.y1, 0)}" x2="${num(layer.x2, layer.w)}" y2="${num(layer.y2, layer.h)}" stroke="${svgEscape(safeColor(layer.stroke, '#38bdf8'))}" stroke-width="${Math.max(1, layer.strokeWidth || 1)}" stroke-linecap="round"/>`);
    } else if (layer.type === 'text') {
      const size = Math.max(1, layer.size);
      const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
      const tx = anchor === 'middle' ? layer.w / 2 : anchor === 'end' ? layer.w : 0;
      parts.push(`<g ${common} fill="${svgEscape(safeColor(layer.color, '#111827'))}" font-family="${svgEscape(layer.font)}, sans-serif" font-size="${size}" font-weight="${layer.weight}" text-anchor="${anchor}">`);
      String(layer.text || '').split('\n').forEach((line, i) => {
        parts.push(`<text x="${tx}" y="${size + i * size * 1.2}">${svgEscape(line)}</text>`);
      });
      parts.push('</g>');
    }
  }
  parts.push('</svg>');
  return parts.join('');
}

function exportSvg() {
  const blob = new Blob([buildSvg()], { type: 'image/svg+xml' });
  downloadBlob(blob, `${safeName()}.svg`);
  const status = $('ph-export-status');
  if (status) status.textContent = 'Exported SVG';
  toast('Exported SVG');
}

function openExport(format = 'png') {
  exportFormat = format;
  document.querySelectorAll('[data-export-format]').forEach((button) => button.classList.toggle('selected', button.dataset.exportFormat === format));
  const dialog = $('ph-export-dialog');
  const scale = $('ph-export-scale');
  if (scale) { scale.value = 100; $('ph-export-scale-out').textContent = '100%'; }
  const link = $('ph-download-svg');
  if (link) link.href = `/download/${encodeURIComponent(DOC.id)}`;
  if (dialog) dialog.showModal();
}

/* ---------------- dialogs and UI ---------------- */
function toast(message, bad = false) {
  const host = $('ph-toast-host');
  if (!host) return;
  clearTimeout(toastTimer);
  const node = document.createElement('div');
  node.className = `ph-toast${bad ? ' bad' : ''}`;
  node.textContent = message;
  host.append(node);
  toastTimer = setTimeout(() => node.remove(), 3200);
}

function renderAll() {
  renderLayers();
  syncProps();
  render();
  const state = $('ph-save-state');
  if (state && !state.textContent.includes('Unsaved')) state.textContent = 'Ready';
}

function applyRemote(remote) {
  content = normalizeContent(remote);
  selectedLayerId = content.activeLayerId || content.layers[content.layers.length - 1]?.id || null;
  renderAll();
}

function focusCanvas() {
  $('ph-overlay')?.focus?.();
}

/* ---------------- events ---------------- */
document.querySelectorAll('.ph-tool').forEach((button) => {
  button.addEventListener('click', () => setTool(button.dataset.tool));
});

$('ph-fg')?.addEventListener('input', (event) => { fg = event.target.value; });
$('ph-bg')?.addEventListener('input', (event) => { bg = event.target.value; });
$('ph-swap-colors')?.addEventListener('click', () => {
  const a = fg;
  fg = bg;
  bg = a;
  $('ph-fg').value = fg;
  $('ph-bg').value = bg;
});
$('ph-brush-size')?.addEventListener('input', (event) => { brushSize = clamp(num(event.target.value, 24), 1, 400); });
$('ph-opacity')?.addEventListener('input', (event) => {
  brushOpacity = clamp(num(event.target.value, 100), 1, 100);
  $('ph-opacity-out').textContent = `${brushOpacity}%`;
});
$('ph-zoom-in')?.addEventListener('click', () => { zoom = clamp(zoom * 1.2, 0.05, 8); render(); });
$('ph-zoom-out')?.addEventListener('click', () => { zoom = clamp(zoom / 1.2, 0.05, 8); render(); });
$('ph-zoom-label')?.addEventListener('click', () => { zoom = 1; render(); });
$('ph-fit')?.addEventListener('click', fitOnScreen);
$('ph-import')?.addEventListener('click', () => { replaceTargetId = null; $('ph-file')?.click(); });
$('ph-export')?.addEventListener('click', () => openExport('png'));
$('ph-file')?.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  const replace = !!replaceTargetId;
  replaceTargetId = null;
  if (file) openFile(file, { replace });
});

$('ph-add-layer')?.addEventListener('click', () => {
  if (!editable) return;
  pushHistory();
  addRasterLayer(`Layer ${content.layers.length + 1}`);
  renderAll();
  scheduleSave();
});
$('ph-dup-layer')?.addEventListener('click', duplicateLayer);
$('ph-del-layer')?.addEventListener('click', deleteLayer);
$('ph-up-layer')?.addEventListener('click', () => moveLayer(1));
$('ph-down-layer')?.addEventListener('click', () => moveLayer(-1));

$('ph-layers')?.addEventListener('click', (event) => {
  const eye = event.target.closest('[data-eye]');
  if (eye) { event.stopPropagation(); toggleVisibility(eye.dataset.eye); return; }
  const row = event.target.closest('[data-layer]');
  if (row) selectLayer(row.dataset.layer);
});
$('ph-layers')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('[data-layer]');
  if (row) { event.preventDefault(); selectLayer(row.dataset.layer); }
});

$('ph-prop-name')?.addEventListener('input', (event) => {
  const layer = selected();
  if (!layer || !editable) return;
  layer.name = event.target.value.slice(0, 80);
  const row = [...document.querySelectorAll('[data-layer]')].find((node) => node.dataset.layer === layer.id);
  const label = row?.querySelector('b');
  if (label) label.textContent = layer.name;
  scheduleSave();
});
for (const [id, key, min] of [
  ['ph-prop-x', 'x', -100000], ['ph-prop-y', 'y', -100000], ['ph-prop-w', 'w', 1], ['ph-prop-h', 'h', 1], ['ph-prop-rotation', 'rotation', -3600],
]) {
  $(id)?.addEventListener('input', (event) => setLayerNumber(key, event.target.value, min));
}
$('ph-prop-blend')?.addEventListener('change', (event) => {
  const layer = selected();
  if (!layer || !editable) return;
  layer.blend = event.target.value;
  render();
  scheduleSave();
});
$('ph-prop-opacity')?.addEventListener('input', (event) => {
  const layer = selected();
  if (!layer || !editable) return;
  layer.opacity = clamp(num(event.target.value, 100) / 100, 0, 1);
  $('ph-prop-opacity-out').textContent = `${Math.round(layer.opacity * 100)}%`;
  render();
  scheduleSave();
});
$('ph-prop-fill')?.addEventListener('input', (event) => setLayerColor('fill', event.target.value));
$('ph-prop-stroke')?.addEventListener('input', (event) => setLayerColor('stroke', event.target.value));
$('ph-prop-stroke-width')?.addEventListener('input', (event) => setLayerNumber('strokeWidth', event.target.value, 0));
$('ph-prop-radius')?.addEventListener('input', (event) => setLayerNumber('radius', event.target.value, 0));
$('ph-prop-text')?.addEventListener('input', (event) => {
  const layer = selected();
  if (!layer || layer.type !== 'text' || !editable) return;
  layer.text = event.target.value;
  render();
  scheduleSave();
});
$('ph-prop-size')?.addEventListener('input', (event) => setLayerNumber('size', event.target.value, 1));
$('ph-prop-weight')?.addEventListener('input', (event) => setLayerNumber('weight', event.target.value, 100));
$('ph-prop-color')?.addEventListener('input', (event) => setLayerColor('color', event.target.value));
$('ph-prop-align')?.addEventListener('change', (event) => {
  const layer = selected();
  if (!layer || !editable) return;
  layer.align = event.target.value;
  render();
  scheduleSave();
});
$('ph-prop-font')?.addEventListener('change', (event) => {
  const layer = selected();
  if (!layer || !editable) return;
  layer.font = event.target.value;
  render();
  scheduleSave();
});
$('ph-replace-raster')?.addEventListener('click', () => {
  const layer = selected();
  if (!layer || layer.type !== 'raster') return;
  replaceTargetId = layer.id;
  $('ph-file')?.click();
});

$('ph-canvas-wrap')?.addEventListener('dblclick', () => {
  const layer = selected();
  if (layer?.type === 'text') $('ph-prop-text')?.focus();
});

$('ph-overlay')?.addEventListener('pointerdown', onPointerDown);
$('ph-overlay')?.addEventListener('pointermove', onPointerMove);
$('ph-overlay')?.addEventListener('pointerup', onPointerUp);
$('ph-overlay')?.addEventListener('pointercancel', onPointerUp);
$('ph-overlay')?.addEventListener('contextmenu', (event) => event.preventDefault());
$('ph-overlay')?.addEventListener('wheel', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoom = clamp(zoom * (event.deltaY < 0 ? 1.1 : 0.9), 0.05, 8);
  render();
}, { passive: false });

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => $(button.dataset.close)?.close());
});
document.querySelectorAll('[data-export-format]').forEach((button) => {
  button.addEventListener('click', () => {
    exportFormat = button.dataset.exportFormat;
    document.querySelectorAll('[data-export-format]').forEach((el) => el.classList.toggle('selected', el === button));
  });
});
$('ph-export-run')?.addEventListener('click', () => {
  if (exportFormat === 'svg') exportSvg();
  else exportRaster(exportFormat);
});
$('ph-export-scale')?.addEventListener('input', (event) => {
  $('ph-export-scale-out').textContent = `${event.target.value}%`;
});
$('ph-export-quality')?.addEventListener('input', (event) => {
  $('ph-export-quality-out').textContent = event.target.value;
});

$('ph-size-apply')?.addEventListener('click', () => {
  resizeDocument(num($('ph-size-w').value, content.w), num($('ph-size-h').value, content.h));
  $('ph-size-dialog')?.close();
});
$('ph-new-create')?.addEventListener('click', () => {
  if (!editable) return;
  pushHistory();
  content = normalizeContent({
    w: num($('ph-new-w').value, 1200),
    h: num($('ph-new-h').value, 800),
    background: $('ph-new-bg').value,
    layers: [],
    activeLayerId: null,
  });
  selectedLayerId = null;
  zoom = 1;
  renderAll();
  scheduleSave();
  $('ph-new-dialog')?.close();
  toast('New canvas created');
});

function fitOnScreen() {
  const stage = $('ph-stage');
  if (!stage) return;
  const availableW = Math.max(80, stage.clientWidth - 88);
  const availableH = Math.max(80, stage.clientHeight - 88);
  zoom = clamp(Math.min(availableW / content.w, availableH / content.h), 0.05, 4);
  render();
}

document.addEventListener('cascade:menu', (event) => {
  const action = event.detail?.action;
  switch (action) {
    case 'new': $('ph-new-w').value = content.w; $('ph-new-h').value = content.h; $('ph-new-bg').value = toColorInput(content.background, '#ffffff'); $('ph-new-dialog')?.showModal(); break;
    case 'open': replaceTargetId = null; $('ph-file')?.click(); break;
    case 'save': workspace?.saveNow?.() || $('btn-save')?.click(); break;
    case 'history': $('btn-versions')?.click(); break;
    case 'share': $('btn-share')?.click(); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'duplicate-layer': duplicateLayer(); break;
    case 'delete-layer': deleteLayer(); break;
    case 'flatten': flattenImage(); break;
    case 'canvas-size': $('ph-size-w').value = content.w; $('ph-size-h').value = content.h; $('ph-size-dialog')?.showModal(); break;
    case 'fit': fitOnScreen(); break;
    case 'zoom-100': zoom = 1; render(); break;
    case 'rotate-cw': rotateDocument(1); break;
    case 'rotate-ccw': rotateDocument(-1); break;
    case 'export-open': openExport('png'); break;
    case 'export-png': openExport('png'); break;
    case 'export-jpg': openExport('jpg'); break;
    case 'export-webp': openExport('webp'); break;
    case 'export-svg': openExport('svg'); break;
    case 'toggle-left': $('ph-app')?.classList.toggle('ph-left-hidden'); break;
    case 'toggle-right':
      if (window.matchMedia('(max-width: 700px)').matches) $('ph-app')?.classList.toggle('ph-mobile-layers');
      else $('ph-app')?.classList.toggle('ph-right-hidden');
      break;
    case 'fullscreen': document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.(); break;
    case 'shortcuts': $('ph-shortcuts-dialog')?.showModal(); break;
    default: break;
  }
});

window.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault();
    workspace?.saveNow?.() || $('btn-save')?.click();
    return;
  }
  if (typing) return;
  if (mod && event.key.toLowerCase() === 'o') { event.preventDefault(); $('ph-file')?.click(); return; }
  if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
  if (mod && event.key.toLowerCase() === 'j') { event.preventDefault(); duplicateLayer(); return; }
  if (mod && event.key === '0') { event.preventDefault(); fitOnScreen(); return; }
  if (mod && event.key === '1') { event.preventDefault(); zoom = 1; render(); return; }
  if (event.code === 'Space') {
    if (!spaceDown) {
      spaceDown = true;
      prevTool = tool;
      setTool('pan');
    }
    event.preventDefault();
    return;
  }
  const shortcuts = { v: 'move', b: 'brush', e: 'eraser', r: 'rect', o: 'ellipse', l: 'line', t: 'text', c: 'crop', h: 'pan' };
  const next = shortcuts[event.key.toLowerCase()];
  if (next) { setTool(next); return; }
  if (event.key === '[') { brushSize = clamp(brushSize - 4, 1, 400); $('ph-brush-size').value = brushSize; return; }
  if (event.key === ']') { brushSize = clamp(brushSize + 4, 1, 400); $('ph-brush-size').value = brushSize; return; }
  if (event.key === 'Escape') {
    drag = null;
    shapePreview = null;
    cropPreview = null;
    render();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code !== 'Space' || !spaceDown) return;
  spaceDown = false;
  if (prevTool) setTool(prevTool);
  prevTool = null;
});

window.addEventListener('blur', () => {
  spaceDown = false;
  drag = null;
});

const saveMirror = $('save-status');
if (saveMirror) {
  new MutationObserver(() => {
    const state = $('ph-save-state');
    if (state) state.textContent = saveMirror.textContent || 'Ready';
  }).observe(saveMirror, { childList: true, characterData: true, subtree: true });
}

/* ---------------- boot ---------------- */
window.CascadeIcons?.hydrate();
$('ph-fg').value = fg;
$('ph-bg').value = bg;
$('ph-app')?.setAttribute('data-tool', tool);
$('ph-file')?.setAttribute('accept', '.psd,image/png,image/jpeg,image/webp,image/gif');
$('ph-download-svg')?.setAttribute('href', `/download/${encodeURIComponent(DOC.id)}`);
renderAll();
requestAnimationFrame(() => {
  const stage = $('ph-stage');
  if (stage && stage.clientWidth < content.w) fitOnScreen();
});
if (!editable) {
  document.querySelectorAll('.ph-toolbar button, .ph-right button, .ph-tool').forEach((button) => { button.disabled = true; });
}
if (!content.layers.length) setTimeout(() => toast('Open a PSD or image, or start painting.', false), 500);
