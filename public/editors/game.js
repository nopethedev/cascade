/* Cascade Game Studio editor.
   The editor owns project data; Play, publish and export all run the same real
   runtime modules used by exported games. */
import {
  normalizeProject, blankProject, entity, addComponent, gameScript, graphNode, graphEdge,
  gid, COMPONENT_DEFS, defaultInputMap,
} from '/public/game/schema.mjs';
import { GAME_NODE_DEFS, GAME_NODE_CATEGORIES, gameNodeDef, defaultNodeConfig } from '/public/game/nodes.mjs';

const DOC = window.__DOC__ || {};
document.body.classList.add('game-body');
const $ = (id) => document.getElementById(id);
const editable = DOC.canEdit !== false && !window.__ACCESS__?.shareMode;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : 0));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

let project;
try {
  const raw = DOC.content && typeof DOC.content === 'object' ? DOC.content : null;
  project = raw && (raw.project || raw.scenes) ? normalizeProject(raw) : blankProject(String(DOC.filename || 'My Game').replace(/\.[^.]+$/, ''), '2d');
} catch {
  project = blankProject('My Game', '2d');
}
if (!Array.isArray(project.scenes) || !project.scenes.length) project.scenes = blankProject(project.project.name, project.mode).scenes;
if (!project.activeScene || !project.scenes.some((scene) => scene.id === project.activeScene)) project.activeScene = project.scenes[0].id;

let selectedId = null;
let selectedScriptId = project.scripts[0]?.id || null;
let selectedNodeId = null;
let selectedAssetId = null;
let activeTab = 'graph';
let gizmoMode = 'move';
let localSpace = false;
let snapEnabled = true;
let gridEnabled = true;
let inspectorMode = 'object';
let lastBuild = null;
let history = [];
let future = [];
let historyLock = false;
let toastTimer = null;
let playing = false;
let paused = false;
let monaco = null;
let monacoLoading = null;
let monacoEditor = null;
let codeTimer = null;
let rebuild3DTimer = null;

const collapsedTree = new Set();
const assetImages = new Map();
const assetModels = new Map();
const assetTextures = new Map();

const workspace = window.Workspace?.create({
  id: DOC.id,
  kind: 'game',
  version: DOC.version,
  content: project,
  canEdit: editable,
  isPublic: DOC.isPublic,
  collect: () => project,
  apply: (content) => {
    project = normalizeProject(content);
    if (!project.scenes.some((scene) => scene.id === project.activeScene)) project.activeScene = project.scenes[0]?.id || '';
    if (selectedId && !activeScene()?.entities.some((item) => item.id === selectedId)) selectedId = null;
    if (selectedScriptId && !project.scripts.some((script) => script.id === selectedScriptId)) selectedScriptId = project.scripts[0]?.id || null;
    renderAll();
  },
});

const scene = () => project.scenes.find((item) => item.id === project.activeScene) || project.scenes[0];
const activeScene = scene;
const findEntity = (id) => scene()?.entities.find((item) => item.id === id) || null;
const selectedEntity = () => findEntity(selectedId);
const activeScript = () => project.scripts.find((item) => item.id === selectedScriptId) || null;
const activeAsset = () => project.assets.find((item) => item.id === selectedAssetId) || null;

function toast(message, bad = false) {
  const host = $('g-toast-host');
  if (!host) return;
  clearTimeout(toastTimer);
  host.textContent = '';
  const node = document.createElement('div');
  node.className = 'gs-toast' + (bad ? ' bad' : '');
  node.textContent = message;
  host.append(node);
  toastTimer = setTimeout(() => node.remove(), 3500);
  if (window.cascadeToast && bad) window.cascadeToast(message, true);
}

function pushHistory() {
  if (!editable) return;
  const snapshot = JSON.stringify(project);
  if (history[history.length - 1] === snapshot) return;
  history.push(snapshot);
  if (history.length > 70) history.shift();
  future = [];
}

function scheduleSave() {
  if (!editable) return;
  workspace?.schedule();
  const note = $('g-save-note');
  if (note) note.textContent = 'Unsaved';
}

function refreshAfterChange({ rebuild = true, inspector = true } = {}) {
  scheduleSave();
  renderHierarchy();
  renderScripts();
  renderGraph();
  if (inspector) renderInspector();
  if (rebuild) queueRebuild3D();
  draw2D();
}

function changed({ rebuild = true, inspector = true, history: record = true } = {}) {
  if (!editable) return;
  if (record) pushHistory();
  refreshAfterChange({ rebuild, inspector });
}

function undo() {
  if (!history.length) return;
  future.push(JSON.stringify(project));
  project = normalizeProject(JSON.parse(history.pop()));
  selectedId = selectedEntity() ? selectedId : null;
  renderAll();
  scheduleSave();
  toast('Undo');
}

function redo() {
  if (!future.length) return;
  history.push(JSON.stringify(project));
  project = normalizeProject(JSON.parse(future.pop()));
  renderAll();
  scheduleSave();
  toast('Redo');
}

function setSelected(id, { script = false } = {}) {
  selectedId = id;
  if (!script) selectedNodeId = null;
  renderHierarchy();
  renderInspector();
  draw2D();
  if (project.mode === '3d') updateSelection3D();
}

function selectScript(id) {
  selectedScriptId = id;
  selectedNodeId = null;
  renderScripts();
  renderGraph();
  renderCode();
  const script = activeScript();
  if (script?.type === 'code') setTab('code');
  else if (activeTab === 'code' || activeTab === 'graph') setTab('graph');
  renderInspector();
}

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.gs-tab').forEach((button) => button.classList.toggle('on', button.dataset.tab === tab));
  document.querySelectorAll('.gs-tab-body').forEach((body) => body.classList.toggle('on', body.id === `g-tab-${tab}`));
  $('g-graph-tools').style.display = tab === 'graph' ? 'inline-flex' : 'none';
  if (tab === 'code') renderCode();
  if (tab === 'console') setTimeout(() => { const el = $('g-console'); if (el) el.scrollTop = el.scrollHeight; }, 0);
}

/* ---------------- hierarchy, assets, scripts ---------------- */

function entityIcon(item) {
  if (item.components.Camera3D || item.components.Camera2D) return '◉';
  if (item.components.Light3D || item.components.Light2D) return '☀';
  if (item.components.TerrainComponent) return '⛰';
  if (item.components.UIElement) return '▤';
  if (item.components.MeshRenderer) return item.components.MeshRenderer.mesh === 'sphere' ? '●' : '◧';
  if (item.components.SpriteRenderer) return item.components.SpriteRenderer.shape === 'circle' ? '●' : '▰';
  return '◇';
}

function entityMeta(item) {
  if (item.components.CharacterController3D) return 'player';
  if (item.components.Rigidbody3D) return item.components.Rigidbody3D.bodyType || 'body';
  if (item.components.Rigidbody2D) return item.components.Rigidbody2D.bodyType || 'body';
  if (item.components.UIElement) return 'ui';
  return '';
}

function renderHierarchy() {
  const host = $('g-hierarchy');
  if (!host) return;
  const currentScene = scene();
  const query = String($('g-hierarchy-search')?.value || '').toLowerCase();
  const entities = currentScene?.entities || [];
  const ids = new Set(entities.map((item) => item.id));
  const roots = entities.filter((item) => !item.parentId || !ids.has(item.parentId));
  const html = [];
  const renderRow = (item, depth) => {
    if (query && !String(item.name).toLowerCase().includes(query) && !(item.tags || []).join(' ').toLowerCase().includes(query)) {
      const hasMatchingChild = entities.some((child) => child.parentId === item.id && String(child.name).toLowerCase().includes(query));
      if (!hasMatchingChild) return;
    }
    const children = entities.filter((child) => child.parentId === item.id);
    const isCollapsed = collapsedTree.has(item.id);
    html.push(`<div class="gs-tree-row${selectedId === item.id ? ' sel' : ''}" data-id="${esc(item.id)}" draggable="${editable}" style="--depth:${depth}" role="treeitem" aria-selected="${selectedId === item.id}">
      <button class="gs-tree-toggle" type="button" data-toggle="${esc(item.id)}" aria-label="Toggle children">${children.length ? (isCollapsed ? '▸' : '▾') : ''}</button>
      <span class="gs-tree-icon">${entityIcon(item)}</span>
      <span class="gs-tree-name" title="${esc(item.name)}">${esc(item.name)}</span>
      <span class="gs-tree-meta">${esc(entityMeta(item))}</span>
      <button class="gs-tree-act${item.visible === false ? ' off' : ''}" type="button" data-eye="${esc(item.id)}" title="Show/hide">${item.visible === false ? '◌' : '◉'}</button>
      <button class="gs-tree-act${item.locked ? ' off' : ''}" type="button" data-lock="${esc(item.id)}" title="Lock/unlock">${item.locked ? '▣' : '▢'}</button>
    </div>`);
    if (!isCollapsed) children.forEach((child) => renderRow(child, depth + 1));
  };
  roots.forEach((item) => renderRow(item, 0));
  host.innerHTML = html.join('') || `<div class="gs-empty">${project.mode === '3d' ? 'The scene is empty. Add a cube, camera or light.' : 'The scene is empty. Add a sprite.'}</div>`;
}

function assetType(asset) {
  return asset.type === 'model' ? '3D' : asset.type === 'audio' ? 'AUD' : asset.type === 'texture' ? 'TEX' : 'IMG';
}

function renderAssets() {
  const host = $('g-assets');
  if (!host) return;
  const html = project.assets.map((asset) => {
    const image = asset.type === 'image' || asset.type === 'texture';
    const src = /^(data:|\/f\/|https?:)/.test(asset.src || '') ? asset.src : '';
    return `<div class="gs-asset${selectedAssetId === asset.id ? ' sel' : ''}" data-asset="${esc(asset.id)}" title="${esc(asset.src || asset.name)}">
      <span class="gs-asset-thumb">${image && src ? `<img src="${esc(src)}" alt="" loading="lazy" />` : assetType(asset)}</span>
      <span class="gs-asset-name">${esc(asset.name)}<br /><small>${esc(asset.type)}</small></span>
    </div>`;
  }).join('');
  host.innerHTML = html || '<div class="gs-empty">Drop GLB, glTF, OBJ, FBX, STL, textures or audio here.</div>';
}

function renderScripts() {
  const host = $('g-scripts');
  if (!host) return;
  host.innerHTML = project.scripts.map((script) => `
    <div class="gs-script-row${script.type === 'code' ? ' code' : ''}${selectedScriptId === script.id ? ' sel' : ''}" data-script="${esc(script.id)}">
      <span class="gs-script-dot"></span><span class="gs-script-name">${esc(script.name)}</span>
      <small>${script.enabled === false ? 'off · ' : ''}${esc(script.type === 'code' ? 'JS' : script.trigger || 'visual')}</small>
    </div>`).join('') || '<div class="gs-empty">No scripts yet. Add a visual script or code script.</div>';
  const select = $('g-script-select');
  if (select) {
    select.innerHTML = project.scripts.map((script) => `<option value="${esc(script.id)}"${script.id === selectedScriptId ? ' selected' : ''}>${esc(script.name)}</option>`).join('');
    select.disabled = !project.scripts.length;
  }
}

/* ---------------- 2D viewport ---------------- */

const canvas2d = $('g-canvas-2d');
const ctx2d = canvas2d?.getContext('2d');
const cam2d = { x: project.project.width / 2, y: project.project.height / 2, zoom: 1 };
let drag2d = null;
let viewportSize = { w: 960, h: 540 };

function screen2d(x, y) {
  const rect = canvas2d.getBoundingClientRect();
  return { x: (x - cam2d.x) * cam2d.zoom + rect.width / 2, y: (y - cam2d.y) * cam2d.zoom + rect.height / 2 };
}
function world2d(x, y) {
  const rect = canvas2d.getBoundingClientRect();
  return { x: (x - rect.width / 2) / cam2d.zoom + cam2d.x, y: (y - rect.height / 2) / cam2d.zoom + cam2d.y };
}

function resize2d() {
  if (!canvas2d) return;
  const rect = canvas2d.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  viewportSize = { w, h };
  if (canvas2d.width !== w * dpr || canvas2d.height !== h * dpr) {
    canvas2d.width = w * dpr;
    canvas2d.height = h * dpr;
  }
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw2D();
}

function draw2D() {
  if (!ctx2d || project.mode !== '2d') return;
  const { w, h } = viewportSize;
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = project.project.background || '#0b0b12';
  ctx2d.fillRect(0, 0, w, h);
  const gridSize = 32 * cam2d.zoom;
  if (gridEnabled && gridSize > 7) {
    const origin = screen2d(0, 0);
    ctx2d.strokeStyle = 'rgba(148,163,184,.08)';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    for (let x = origin.x % gridSize; x < w; x += gridSize) { ctx2d.moveTo(x, 0); ctx2d.lineTo(x, h); }
    for (let y = origin.y % gridSize; y < h; y += gridSize) { ctx2d.moveTo(0, y); ctx2d.lineTo(w, y); }
    ctx2d.stroke();
  }
  const entities = [...(scene()?.entities || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  for (const item of entities) {
    if (item.visible === false) continue;
    const p = screen2d(item.x, item.y);
    const ew = Math.max(2, item.w * cam2d.zoom);
    const eh = Math.max(2, item.h * cam2d.zoom);
    const sprite = item.components.SpriteRenderer;
    const ui = item.components.UIElement;
    const camera = item.components.Camera2D;
    const light = item.components.Light2D;
    const isCircle = (sprite?.shape === 'circle') || (item.components.Collider2D?.shape === 'circle' && !sprite?.shape);
    ctx2d.save();
    ctx2d.translate(p.x, p.y);
    ctx2d.rotate((num(item.rotation) * Math.PI) / 180);
    if (camera) {
      ctx2d.strokeStyle = '#fb7185';
      ctx2d.lineWidth = 1.5;
      ctx2d.strokeRect(-15, -11, 30, 22);
      ctx2d.beginPath(); ctx2d.moveTo(15, -11); ctx2d.lineTo(25, -17); ctx2d.lineTo(25, 17); ctx2d.lineTo(15, 11); ctx2d.stroke();
    } else if (light) {
      const gradient = ctx2d.createRadialGradient(0, 0, 0, 0, 0, Math.max(4, num(light.radius, 120) * cam2d.zoom));
      gradient.addColorStop(0, light.color || '#fbbf24');
      gradient.addColorStop(1, 'rgba(251,191,36,0)');
      ctx2d.fillStyle = gradient;
      ctx2d.beginPath(); ctx2d.arc(0, 0, Math.max(4, num(light.radius, 120) * cam2d.zoom), 0, Math.PI * 2); ctx2d.fill();
    } else if (ui) {
      ctx2d.fillStyle = ui.fill || 'rgba(15,23,42,.82)';
      if (ui.kind !== 'text') ctx2d.fillRect(-ew / 2, -eh / 2, ew, eh);
      ctx2d.fillStyle = ui.color || '#f4f4f5';
      ctx2d.font = `${Math.max(8, num(ui.size, 16) * cam2d.zoom)}px Inter, sans-serif`;
      ctx2d.textAlign = ui.anchor === 'top-center' ? 'center' : 'left';
      ctx2d.textBaseline = 'middle';
      const label = ui.text || (ui.binding ? `${ui.prefix || ''}{{${ui.binding}}}` : 'UI');
      ctx2d.fillText(String(label).slice(0, 90), ui.anchor === 'top-center' ? 0 : -ew / 2 + 4, 0);
    } else {
      const asset = (project.assets || []).find((a) => a.id === sprite?.assetId);
      if (asset?.src) {
        let image = assetImages.get(asset.id);
        if (!image) {
          image = new Image();
          image.crossOrigin = 'anonymous';
          image.src = asset.src;
          assetImages.set(asset.id, image);
          image.onload = draw2D;
        }
        if (image.complete && image.naturalWidth) {
          ctx2d.drawImage(image, -ew / 2, -eh / 2, ew, eh);
        } else {
          ctx2d.fillStyle = sprite?.color || '#e11d48';
          ctx2d.fillRect(-ew / 2, -eh / 2, ew, eh);
        }
      } else {
        ctx2d.fillStyle = sprite?.color || (item.components.Collider3D ? '#475569' : '#64748b');
        ctx2d.globalAlpha = num(sprite?.opacity, item.opacity ?? 1);
        if (isCircle) {
          ctx2d.beginPath(); ctx2d.ellipse(0, 0, ew / 2, eh / 2, 0, 0, Math.PI * 2); ctx2d.fill();
        } else {
          const radius = Math.min(8, ew / 4, eh / 4);
          ctx2d.beginPath();
          if (ctx2d.roundRect) ctx2d.roundRect(-ew / 2, -eh / 2, ew, eh, radius); else ctx2d.rect(-ew / 2, -eh / 2, ew, eh);
          ctx2d.fill();
        }
        if (sprite?.shape === 'capsule') {
          ctx2d.beginPath();
          ctx2d.ellipse(0, 0, ew / 2, eh / 2, 0, 0, Math.PI * 2);
          ctx2d.fill();
        }
        ctx2d.globalAlpha = 1;
      }
    }
    ctx2d.restore();
    if (item.components.Collider2D && !item.components.UIElement) {
      ctx2d.save();
      ctx2d.translate(p.x, p.y);
      ctx2d.rotate((num(item.rotation) * Math.PI) / 180);
      ctx2d.strokeStyle = 'rgba(34,211,238,.55)';
      ctx2d.setLineDash([3, 3]);
      ctx2d.strokeRect(-ew / 2, -eh / 2, ew, eh);
      ctx2d.restore();
    }
    if (selectedId === item.id) {
      ctx2d.save();
      ctx2d.translate(p.x, p.y);
      ctx2d.rotate((num(item.rotation) * Math.PI) / 180);
      ctx2d.strokeStyle = '#fb7185';
      ctx2d.lineWidth = 1.5;
      ctx2d.setLineDash([]);
      ctx2d.strokeRect(-ew / 2 - 3, -eh / 2 - 3, ew + 6, eh + 6);
      ctx2d.restore();
      ctx2d.fillStyle = '#fb7185';
      ctx2d.font = '10px ui-monospace, monospace';
      ctx2d.fillText(item.name, p.x - ew / 2, p.y - eh / 2 - 8);
    }
  }
  draw2DGizmo();
}

function draw2DGizmo() {
  const item = selectedEntity();
  if (!item || project.mode !== '2d') return;
  const p = screen2d(item.x, item.y);
  const s = 38;
  ctx2d.save();
  ctx2d.lineWidth = 2;
  for (const [axis, color, dx, dy] of [['x', '#fb7185', 1, 0], ['y', '#34d399', 0, -1]]) {
    ctx2d.strokeStyle = color;
    ctx2d.beginPath(); ctx2d.moveTo(p.x, p.y); ctx2d.lineTo(p.x + dx * s, p.y + dy * s); ctx2d.stroke();
    ctx2d.fillStyle = color;
    ctx2d.beginPath(); ctx2d.arc(p.x + dx * s, p.y + dy * s, 3.5, 0, Math.PI * 2); ctx2d.fill();
  }
  ctx2d.restore();
}

function hit2d(x, y) {
  const point = world2d(x, y);
  const entities = [...(scene()?.entities || [])].filter((item) => item.visible !== false && !item.locked).reverse();
  return entities.find((item) => {
    const w = Math.abs(item.w), h = Math.abs(item.h);
    return point.x >= item.x - w / 2 && point.x <= item.x + w / 2 && point.y >= item.y - h / 2 && point.y <= item.y + h / 2;
  }) || null;
}

if (canvas2d) {
  canvas2d.addEventListener('pointerdown', (event) => {
    canvas2d.setPointerCapture(event.pointerId);
    const rect = canvas2d.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (event.button !== 0) {
      drag2d = { type: 'pan', startX: event.clientX, startY: event.clientY, camX: cam2d.x, camY: cam2d.y };
      return;
    }
    const hit = hit2d(x, y);
    if (hit) {
      setSelected(hit.id);
      const item = hit;
      const startWorld = world2d(x, y);
      pushHistory();
      drag2d = { type: 'move', id: item.id, startX: startWorld.x, startY: startWorld.y, ox: item.x, oy: item.y };
    } else {
      setSelected(null);
      drag2d = { type: 'pan', startX: event.clientX, startY: event.clientY, camX: cam2d.x, camY: cam2d.y };
    }
  });
  canvas2d.addEventListener('pointermove', (event) => {
    if (!drag2d) return;
    const rect = canvas2d.getBoundingClientRect();
    if (drag2d.type === 'pan') {
      cam2d.x = drag2d.camX - (event.clientX - drag2d.startX) / cam2d.zoom;
      cam2d.y = drag2d.camY - (event.clientY - drag2d.startY) / cam2d.zoom;
      draw2D();
      return;
    }
    const item = findEntity(drag2d.id);
    if (!item) return;
    const point = world2d(event.clientX - rect.left, event.clientY - rect.top);
    let nx = drag2d.ox + point.x - drag2d.startX;
    let ny = drag2d.oy + point.y - drag2d.startY;
    if (snapEnabled) { nx = Math.round(nx / 8) * 8; ny = Math.round(ny / 8) * 8; }
    item.x = nx; item.y = ny;
    draw2D();
    updateTransformFields(item);
    scheduleSave();
  });
  const end2d = () => {
    if (drag2d?.type === 'move') refreshAfterChange({ rebuild: true });
    drag2d = null;
  };
  canvas2d.addEventListener('pointerup', end2d);
  canvas2d.addEventListener('pointercancel', end2d);
  canvas2d.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas2d.getBoundingClientRect();
    const before = world2d(event.clientX - rect.left, event.clientY - rect.top);
    cam2d.zoom = clamp(cam2d.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.1, 8);
    const after = world2d(event.clientX - rect.left, event.clientY - rect.top);
    cam2d.x += before.x - after.x;
    cam2d.y += before.y - after.y;
    draw2D();
  }, { passive: false });
}

function updateTransformFields(item) {
  const host = $('g-inspector');
  if (!host || selectedId !== item.id) return;
  for (const key of ['x', 'y', 'z', 'rotation', 'rotationX', 'rotationY', 'rotationZ']) {
    const input = host.querySelector(`[data-transform="${key}"]`);
    if (input && document.activeElement !== input) input.value = round(item[key]);
  }
}

function round(value, places = 2) {
  return Math.round(num(value) * 10 ** places) / 10 ** places;
}

/* ---------------- inspector ---------------- */

function fieldInput(key, type, value, options = []) {
  const v = value ?? '';
  if (type === 'boolean') return `<input type="checkbox" data-prop="${esc(key)}" ${v ? 'checked' : ''} />`;
  if (type === 'color') return `<input type="color" data-prop="${esc(key)}" value="${esc(/^#[0-9a-f]{6}$/i.test(String(v)) ? v : '#e11d48')}" />`;
  if (type === 'select') return `<select data-prop="${esc(key)}">${options.map((opt) => `<option value="${esc(opt)}"${String(v) === String(opt) ? ' selected' : ''}>${esc(opt)}</option>`).join('')}</select>`;
  if (type === 'textarea' || type === 'json') return `<textarea data-prop="${esc(key)}" ${type === 'json' ? 'data-json="1"' : ''}>${esc(type === 'json' ? JSON.stringify(value ?? {}, null, 2) : v)}</textarea>`;
  if (type === 'asset') return `<select data-prop="${esc(key)}"><option value="">None</option>${(project.assets || []).filter((asset) => !options.length || options.includes(asset.type)).map((asset) => `<option value="${esc(asset.id)}"${asset.id === v ? ' selected' : ''}>${esc(asset.name)}</option>`).join('')}</select>`;
  if (type === 'entity') return `<select data-prop="${esc(key)}"><option value="">Self</option>${(scene()?.entities || []).map((item) => `<option value="${esc(item.id)}"${item.id === v ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`;
  if (type === 'script') return `<select data-prop="${esc(key)}"><option value="">None</option>${project.scripts.map((script) => `<option value="${esc(script.id)}"${script.id === v ? ' selected' : ''}>${esc(script.name)}</option>`).join('')}</select>`;
  const inputType = type === 'number' ? 'number' : 'text';
  const step = type === 'number' ? 'step="any"' : '';
  return `<input type="${inputType}" ${step} data-prop="${esc(key)}" value="${esc(v)}" />`;
}

function renderInspector() {
  const host = $('g-inspector');
  if (!host) return;
  const node = selectedNodeId && activeScript()?.graph?.nodes?.find((item) => item.id === selectedNodeId);
  if (node) return renderNodeInspector(node);
  const asset = activeAsset();
  if (selectedAssetId && asset) return renderAssetInspector(asset);
  const item = selectedEntity();
  if (inspectorMode === 'project' || (!item && inspectorMode !== 'object')) return renderProjectInspector();
  if (!item) return renderProjectInspector();
  renderEntityInspector(item);
}

function renderEntityInspector(item) {
  const host = $('g-inspector');
  const components = item.components || {};
  const compHtml = Object.entries(components).map(([type, props]) => {
    const def = COMPONENT_DEFS[type];
    if (!def) return '';
    const fields = def.fields.map((field) => {
      const value = props?.[field.key] ?? field.fallback ?? '';
      const options = field.type === 'asset' ? ['model', 'texture', 'image', 'audio'] : field.options || [];
      return `<div class="gs-field"><label>${esc(field.label || field.key)}</label>${fieldInput(field.key, field.type, value, options)}</div>`;
    }).join('');
    return `<div class="gs-component" data-component="${esc(type)}">
      <div class="gs-component-head">${esc(def.label || type)}<span>${type}</span><button type="button" data-remove-component="${esc(type)}" title="Remove component">×</button></div>
      <div class="gs-component-body">${fields || '<div class="gs-insp-note">No configurable fields.</div>'}</div>
    </div>`;
  }).join('');
  const is3d = project.mode === '3d';
  const transform = is3d ? `
    <div class="gs-field gs-field-wide"><label>Position</label><div class="gs-axis-fields">
      <span class="gs-axis-field"><i>X</i><input type="number" step="any" data-transform="x" value="${round(item.x)}" /></span>
      <span class="gs-axis-field"><i>Y</i><input type="number" step="any" data-transform="y" value="${round(item.y)}" /></span>
      <span class="gs-axis-field"><i>Z</i><input type="number" step="any" data-transform="z" value="${round(item.z)}" /></span>
    </div></div>
    <div class="gs-field gs-field-wide"><label>Rotation</label><div class="gs-axis-fields">
      <span class="gs-axis-field"><i>X</i><input type="number" step="any" data-transform="rotationX" value="${round(item.rotationX)}" /></span>
      <span class="gs-axis-field"><i>Y</i><input type="number" step="any" data-transform="rotationY" value="${round(item.rotationY)}" /></span>
      <span class="gs-axis-field"><i>Z</i><input type="number" step="any" data-transform="rotationZ" value="${round(item.rotationZ)}" /></span>
    </div></div>
    <div class="gs-field gs-field-wide"><label>Scale</label><div class="gs-axis-fields">
      <span class="gs-axis-field"><i>X</i><input type="number" step="any" data-transform="w" value="${round(item.w, 3)}" /></span>
      <span class="gs-axis-field"><i>Y</i><input type="number" step="any" data-transform="h" value="${round(item.h, 3)}" /></span>
      <span class="gs-axis-field"><i>Z</i><input type="number" step="any" data-transform="d" value="${round(item.d, 3)}" /></span>
    </div></div>` : `
    <div class="gs-field gs-field-wide"><label>Position</label><div class="gs-axis-fields">
      <span class="gs-axis-field"><i>X</i><input type="number" step="any" data-transform="x" value="${round(item.x)}" /></span>
      <span class="gs-axis-field"><i>Y</i><input type="number" step="any" data-transform="y" value="${round(item.y)}" /></span>
      <span class="gs-axis-field"><i>W</i><input type="number" step="any" data-transform="w" value="${round(item.w)}" /></span>
      <span class="gs-axis-field"><i>H</i><input type="number" step="any" data-transform="h" value="${round(item.h)}" /></span>
    </div></div>
    <div class="gs-field"><label>Rotation</label><input type="number" step="any" data-transform="rotation" value="${round(item.rotation)}" /></div>`;
  host.innerHTML = `
    <div class="gs-insp-head"><span class="gs-insp-ico">${entityIcon(item)}</span><input data-entity-name type="text" value="${esc(item.name)}" aria-label="Object name" /></div>
    <div class="gs-insp-section"><div class="gs-field"><label>Visible</label><input type="checkbox" data-entity="visible" ${item.visible !== false ? 'checked' : ''} /></div>
      <div class="gs-field"><label>Locked</label><input type="checkbox" data-entity="locked" ${item.locked ? 'checked' : ''} /></div>
      <div class="gs-field"><label>Tags</label><input type="text" data-entity="tags" value="${esc((item.tags || []).join(', '))}" placeholder="player, pickup" /></div>
      <div class="gs-field"><label>Layer</label><input type="number" data-entity="layer" value="${num(item.layer)}" /></div>
    </div>
    <div class="gs-insp-section"><h3>Transform</h3>${transform}</div>
    <div class="gs-insp-section"><h3>Components <button class="gs-mini" type="button" id="g-add-component">＋ Add</button></h3>${compHtml || '<div class="gs-insp-note">No components. Add a renderer, collider or script component.</div>'}</div>
    <div class="gs-insp-section"><h3>Object</h3><div class="gs-insp-actions">
      <button class="gs-mini" type="button" data-object-action="focus">Focus</button>
      <button class="gs-mini" type="button" data-object-action="duplicate">Duplicate</button>
      <button class="gs-mini" type="button" data-object-action="lock">${item.locked ? 'Unlock' : 'Lock'}</button>
      <button class="gs-mini" type="button" data-object-action="hide">${item.visible === false ? 'Show' : 'Hide'}</button>
      <button class="gs-mini" type="button" data-object-action="delete">Delete</button>
    </div><div class="gs-insp-note">Changes autosave. Locked objects cannot be picked in the viewport.</div></div>`;
}

function renderNodeInspector(node) {
  const def = gameNodeDef(node.type);
  const fields = (def?.fields || []).map((field) => `<div class="gs-field"><label>${esc(field.label || field.key)}</label>${fieldInput(field.key, field.type, node.config?.[field.key] ?? field.fallback ?? '', field.options || [])}</div>`).join('');
  const inputs = (def?.inputs || []).map((pin) => `<div class="gs-field"><label>${esc(pin.label || pin.id)}</label><span class="gs-insp-note">${esc(pin.type || pin.kind)} · connect in graph</span></div>`).join('');
  const outputs = (def?.outputs || []).map((pin) => `<div class="gs-field"><label>${esc(pin.label || pin.id)}</label><span class="gs-insp-note">${esc(pin.type || pin.kind)}</span></div>`).join('');
  $('g-inspector').innerHTML = `
    <div class="gs-insp-head"><span class="gs-insp-ico">◇</span><input type="text" value="${esc(def?.title || node.type)}" readonly aria-label="Node title" /></div>
    <div class="gs-insp-section"><h3>Node</h3>
      <div class="gs-field"><label>Type</label><span class="gs-insp-note">${esc(node.type)}</span></div>
      <div class="gs-field"><label>Category</label><span class="gs-insp-note">${esc(def?.category || '')}</span></div>
      <div class="gs-insp-note">${esc(def?.description || '')}</div>
    </div>
    ${fields ? `<div class="gs-insp-section"><h3>Configuration</h3>${fields}</div>` : ''}
    ${inputs ? `<div class="gs-insp-section"><h3>Inputs</h3>${inputs}</div>` : ''}
    ${outputs ? `<div class="gs-insp-section"><h3>Outputs</h3>${outputs}</div>` : ''}
    <div class="gs-insp-section"><button class="gs-mini" type="button" data-node-action="delete">Delete node</button></div>`;
}

function renderAssetInspector(asset) {
  const isImage = asset.type === 'image' || asset.type === 'texture';
  $('g-inspector').innerHTML = `
    <div class="gs-insp-head"><span class="gs-insp-ico">${assetType(asset)}</span><input type="text" value="${esc(asset.name)}" readonly aria-label="Asset name" /></div>
    <div class="gs-insp-section">
      ${isImage && asset.src ? `<img src="${esc(asset.src)}" alt="${esc(asset.name)}" style="width:100%;max-height:150px;object-fit:contain;background:#050608;border:1px solid #202634;border-radius:5px;margin-bottom:8px" />` : ''}
      <div class="gs-field"><label>Type</label><span class="gs-insp-note">${esc(asset.type)}</span></div>
      <div class="gs-field"><label>Source</label><span class="gs-insp-note" style="word-break:break-all">${esc(asset.src.slice(0, 90))}${asset.src.length > 90 ? '…' : ''}</span></div>
      <div class="gs-insp-note">${asset.type === 'model' ? 'Select a MeshRenderer and assign this model asset.' : asset.type === 'audio' ? 'Assign to AudioSource3D or play it from a script.' : 'Assign this texture to a MeshRenderer or SpriteRenderer.'}</div>
      <div class="gs-insp-actions" style="margin-top:8px">
        ${selectedEntity() ? `<button class="gs-mini" type="button" data-asset-action="assign">Assign to selection</button>` : ''}
        <button class="gs-mini" type="button" data-asset-action="delete">Remove asset</button>
      </div>
    </div>`;
}

function renderProjectInspector() {
  const p = project.project;
  const is3d = project.mode === '3d';
  const env = scene()?.environment || {};
  $('g-inspector').innerHTML = `
    <div class="gs-insp-head"><span class="gs-insp-ico">◆</span><input type="text" data-project="name" value="${esc(p.name)}" aria-label="Project name" /></div>
    <div class="gs-insp-section"><h3>Project</h3>
      <div class="gs-field"><label>Mode</label><span class="gs-insp-note">${is3d ? '3D · Three.js + Cannon' : '2D · Canvas + Matter.js'}</span></div>
      <div class="gs-field"><label>Viewport</label><span class="gs-insp-note">${p.width} × ${p.height}</span></div>
      <div class="gs-field"><label>Gravity Y</label><input type="number" data-project="gravityY" value="${num(p.gravityY)}" /></div>
      <div class="gs-field"><label>Target FPS</label><input type="number" data-project="targetFps" value="${num(p.targetFps, 60)}" min="1" max="240" /></div>
      <div class="gs-field"><label>Physics step</label><input type="number" data-project="physicsTimestep" value="${round(p.physicsTimestep, 4)}" step="0.001" /></div>
      <div class="gs-field"><label>Debug</label><input type="checkbox" data-project="debug" ${p.debug ? 'checked' : ''} /></div>
    </div>
    ${is3d ? `<div class="gs-insp-section"><h3>Rendering</h3>
      <div class="gs-field"><label>Quality</label><select data-render="quality">${['low','medium','high','ultra'].map((x) => `<option${p.render3d?.quality === x ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="gs-field"><label>Shadows</label><select data-render="shadows">${['off','low','medium','high'].map((x) => `<option${p.render3d?.shadows === x ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="gs-field"><label>Antialias</label><input type="checkbox" data-render="antialias" ${p.render3d?.antialias !== false ? 'checked' : ''} /></div>
      <div class="gs-field"><label>Pixel ratio</label><input type="number" step="0.1" min="0.5" max="2" data-render="pixelRatio" value="${num(p.render3d?.pixelRatio, 1)}" /></div>
      <div class="gs-field"><label>Exposure</label><input type="number" step="0.05" data-render="exposure" value="${num(p.render3d?.exposure, 1.05)}" /></div>
    </div>
    <div class="gs-insp-section"><h3>Environment</h3>
      <div class="gs-field"><label>Sky top</label><input type="color" data-env="top" value="${esc(env.top || '#172554')}" /></div>
      <div class="gs-field"><label>Sky bottom</label><input type="color" data-env="bottom" value="${esc(env.bottom || '#060814')}" /></div>
      <div class="gs-field"><label>Fog</label><input type="checkbox" data-env="fog" ${env.fog !== false ? 'checked' : ''} /></div>
      <div class="gs-field"><label>Fog color</label><input type="color" data-env="fogColor" value="${esc(env.fogColor || '#0f172a')}" /></div>
    </div>` : ''}
    <div class="gs-insp-section"><h3>Scene</h3>
      <div class="gs-field"><label>Name</label><input type="text" data-scene="name" value="${esc(scene()?.name || '')}" /></div>
      <div class="gs-field"><label>Gravity X</label><input type="number" data-gravity="x" value="${num(scene()?.gravity?.x)}" /></div>
      <div class="gs-field"><label>Gravity Y</label><input type="number" data-gravity="y" value="${num(scene()?.gravity?.y)}" /></div>
      ${is3d ? `<div class="gs-field"><label>Gravity Z</label><input type="number" data-gravity="z" value="${num(scene()?.gravity?.z)}" /></div>` : ''}
    </div>
    <div class="gs-insp-section"><h3>Input map</h3><div class="gs-insp-note">WASD / arrows are built in. Custom actions live in project.input; runtime reads them by action name.</div><button class="gs-mini" type="button" data-project-action="reset-input" style="margin-top:6px">Reset input map</button></div>`;
}

/* ---------------- hierarchy / asset / script interactions ---------------- */

$('g-hierarchy')?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-id]');
  if (!row) return;
  const id = row.dataset.id;
  if (event.target.closest('[data-toggle]')) {
    const toggleId = event.target.closest('[data-toggle]').dataset.toggle;
    if (collapsedTree.has(toggleId)) collapsedTree.delete(toggleId); else collapsedTree.add(toggleId);
    renderHierarchy();
    return;
  }
  if (event.target.closest('[data-eye]')) {
    const item = findEntity(id);
    if (item) { pushHistory(); item.visible = item.visible === false; changed({ rebuild: true, history: false }); }
    return;
  }
  if (event.target.closest('[data-lock]')) {
    const item = findEntity(id);
    if (item) { pushHistory(); item.locked = !item.locked; changed({ rebuild: false, history: false }); }
    return;
  }
  setSelected(id);
});

$('g-hierarchy')?.addEventListener('dragstart', (event) => {
  const row = event.target.closest('[data-id]');
  if (!row) return;
  event.dataTransfer.setData('text/plain', row.dataset.id);
  event.dataTransfer.effectAllowed = 'move';
});
$('g-hierarchy')?.addEventListener('dragover', (event) => {
  const row = event.target.closest('[data-id]');
  if (!row) return;
  event.preventDefault();
  document.querySelectorAll('.gs-tree-row.dragover').forEach((el) => el.classList.remove('dragover'));
  row.classList.add('dragover');
});
$('g-hierarchy')?.addEventListener('dragleave', (event) => {
  event.target.closest('[data-id]')?.classList.remove('dragover');
});
$('g-hierarchy')?.addEventListener('drop', (event) => {
  const row = event.target.closest('[data-id]');
  if (!row) return;
  event.preventDefault();
  row.classList.remove('dragover');
  const childId = event.dataTransfer.getData('text/plain');
  const parentId = row.dataset.id;
  if (!childId || childId === parentId) return;
  const child = findEntity(childId);
  const parent = findEntity(parentId);
  if (!child || !parent) return;
  let cursor = parent;
  while (cursor?.parentId) {
    if (cursor.parentId === childId) { toast('Cannot parent an object to its own descendant', true); return; }
    cursor = findEntity(cursor.parentId);
  }
  pushHistory();
  child.parentId = parentId;
  changed({ rebuild: true, history: false });
});

$('g-scripts')?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-script]');
  if (row) selectScript(row.dataset.script);
});

$('g-assets')?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-asset]');
  if (!row) return;
  selectedAssetId = row.dataset.asset;
  selectedId = null;
  selectedNodeId = null;
  renderAssets();
  renderInspector();
});
$('g-assets')?.addEventListener('dblclick', (event) => {
  const row = event.target.closest('[data-asset]');
  if (row) assignAsset(row.dataset.asset);
});

function assetKind(file) {
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  if (['glb', 'gltf', 'obj', 'fbx', 'stl'].includes(ext)) return 'model';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(ext)) return 'image';
  if (['hdr', 'exr'].includes(ext)) return 'hdri';
  if (['json'].includes(ext)) return 'json';
  return 'image';
}

async function uploadFiles(files) {
  if (!editable || !files?.length) return;
  const form = new FormData();
  [...files].slice(0, 20).forEach((file) => form.append('files', file));
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'upload failed');
    pushHistory();
    for (const uploaded of data.files || []) {
      if (uploaded.error) continue;
      const type = assetKind({ name: uploaded.filename });
      project.assets.push({ id: gid('asset'), name: uploaded.filename, type, src: `/f/${uploaded.id}/raw`, width: 0, height: 0 });
    }
    changed({ rebuild: true, history: false });
    toast(`${(data.files || []).filter((file) => !file.error).length} asset(s) imported`);
  } catch (error) {
    toast(error.message, true);
  }
}

function assignAsset(assetId) {
  const asset = project.assets.find((item) => item.id === assetId);
  const item = selectedEntity();
  if (!asset || !item || !editable) return;
  pushHistory();
  if (asset.type === 'model') {
    ensureComponent(item, 'MeshRenderer');
    item.components.MeshRenderer.mesh = 'custom';
    item.components.MeshRenderer.assetId = asset.id;
  } else if (asset.type === 'texture' || asset.type === 'image') {
    if (project.mode === '3d') {
      ensureComponent(item, 'MeshRenderer');
      item.components.MeshRenderer.textureAssetId = asset.id;
    } else {
      ensureComponent(item, 'SpriteRenderer');
      item.components.SpriteRenderer.assetId = asset.id;
    }
  } else if (asset.type === 'audio') {
    ensureComponent(item, project.mode === '3d' ? 'AudioSource3D' : 'AudioSource');
    item.components[project.mode === '3d' ? 'AudioSource3D' : 'AudioSource'].assetId = asset.id;
  }
  selectedAssetId = null;
  changed({ rebuild: true, history: false });
  toast(`Assigned ${asset.name}`);
}

$('g-asset-input')?.addEventListener('change', (event) => {
  uploadFiles(event.target.files);
  event.target.value = '';
});
$('g-upload-asset')?.addEventListener('click', () => $('g-asset-input')?.click());
$('g-assets')?.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
$('g-assets')?.addEventListener('drop', (event) => { event.preventDefault(); uploadFiles(event.dataTransfer.files); });

$('g-inspector')?.addEventListener('click', (event) => {
  const action = event.target.closest('[data-object-action]')?.dataset.objectAction;
  if (action) {
    const item = selectedEntity();
    if (!item) return;
    if (action === 'focus') focusSelection();
    if (action === 'duplicate') duplicateSelection();
    if (action === 'delete') deleteSelection();
    if (action === 'lock') { pushHistory(); item.locked = !item.locked; changed({ rebuild: false, history: false }); }
    if (action === 'hide') { pushHistory(); item.visible = item.visible === false; changed({ rebuild: true, history: false }); }
    return;
  }
  if (event.target.closest('#g-add-component')) return openComponentDialog();
  const remove = event.target.closest('[data-remove-component]')?.dataset.removeComponent;
  if (remove) {
    const item = selectedEntity();
    if (!item) return;
    pushHistory();
    delete item.components[remove];
    changed({ rebuild: true, history: false });
    return;
  }
  const assetAction = event.target.closest('[data-asset-action]')?.dataset.assetAction;
  if (assetAction === 'assign') { assignAsset(selectedAssetId); return; }
  if (assetAction === 'delete') {
    if (!selectedAssetId) return;
    pushHistory();
    project.assets = project.assets.filter((asset) => asset.id !== selectedAssetId);
    selectedAssetId = null;
    changed({ rebuild: true, history: false });
    return;
  }
  if (event.target.closest('[data-project-action="reset-input"]')) {
    pushHistory();
    project.project.input = defaultInputMap();
    changed({ rebuild: false, history: false, inspector: false });
    return;
  }
  if (event.target.closest('[data-node-action="delete"]')) { deleteSelectedNode(); }
});

$('g-inspector')?.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset.entityName !== undefined || target.hasAttribute('data-entity-name')) {
    const item = selectedEntity();
    if (!item) return;
    pushHistory(); item.name = target.value.slice(0, 80) || 'Object'; changed({ rebuild: true, history: false });
    return;
  }
  const entityProp = target.dataset.entity;
  if (entityProp) {
    const item = selectedEntity();
    if (!item) return;
    pushHistory();
    if (entityProp === 'tags') item.tags = target.value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
    else if (entityProp === 'layer') item.layer = num(target.value);
    else item[entityProp] = target.type === 'checkbox' ? target.checked : target.value;
    changed({ rebuild: true, history: false });
    return;
  }
  const transform = target.dataset.transform;
  if (transform) {
    const item = selectedEntity();
    if (!item) return;
    pushHistory();
    let v = num(target.value, item[transform]);
    if (snapEnabled && ['x', 'y', 'z'].includes(transform)) v = Math.round(v / 0.25) * 0.25;
    item[transform] = v;
    changed({ rebuild: true, history: false, inspector: false });
    updateTransformFields(item);
    return;
  }
  const prop = target.dataset.prop;
  if (prop) {
    const item = selectedEntity();
    const component = target.closest('[data-component]')?.dataset.component;
    if (item && component && item.components[component]) {
      pushHistory();
      const field = COMPONENT_DEFS[component]?.fields?.find((entry) => entry.key === prop);
      let value = target.type === 'checkbox' ? target.checked : target.value;
      if (field?.type === 'number') value = num(value);
      if (field?.type === 'json') { try { value = JSON.parse(target.value); } catch { toast('Invalid JSON', true); return; } }
      item.components[component][prop] = value;
      changed({ rebuild: true, history: false });
      return;
    }
    const node = selectedNodeId && activeScript()?.graph?.nodes?.find((entry) => entry.id === selectedNodeId);
    if (node) {
      pushHistory();
      const field = gameNodeDef(node.type)?.fields?.find((entry) => entry.key === prop);
      let value = target.type === 'checkbox' ? target.checked : target.value;
      if (field?.type === 'number') value = num(value);
      node.config = { ...(node.config || {}), [prop]: value };
      changed({ rebuild: false, history: false });
      return;
    }
  }
  const proj = target.dataset.project;
  if (proj) {
    pushHistory();
    project.project[proj] = target.type === 'checkbox' ? target.checked : target.type === 'number' ? num(target.value) : target.value;
    changed({ rebuild: true, history: false });
    return;
  }
  const render = target.dataset.render;
  if (render) {
    pushHistory();
    project.project.render3d = { ...(project.project.render3d || {}), [render]: target.type === 'checkbox' ? target.checked : target.type === 'number' ? num(target.value) : target.value };
    changed({ rebuild: true, history: false });
    return;
  }
  const env = target.dataset.env;
  if (env) {
    pushHistory();
    scene().environment = { ...(scene().environment || {}), [env]: target.type === 'checkbox' ? target.checked : target.value };
    changed({ rebuild: true, history: false });
    return;
  }
  const sceneProp = target.dataset.scene;
  if (sceneProp === 'name') { pushHistory(); scene().name = target.value.slice(0, 80); changed({ rebuild: false, history: false }); return; }
  const gravity = target.dataset.gravity;
  if (gravity) {
    pushHistory();
    scene().gravity = { ...(scene().gravity || { x: 0, y: 0, z: 0 }), [gravity]: num(target.value) };
    project.project[`gravity${gravity.toUpperCase()}`] = num(target.value);
    changed({ rebuild: true, history: false });
  }
});

$('g-inspector')?.addEventListener('input', (event) => {
  if (event.target.hasAttribute('data-transform')) {
    const item = selectedEntity();
    if (!item) return;
    const key = event.target.dataset.transform;
    item[key] = num(event.target.value, item[key]);
    scheduleSave();
    draw2D();
    update3DObject(item);
  }
});

$('g-scene-select')?.addEventListener('change', (event) => {
  project.activeScene = event.target.value;
  selectedId = null;
  selectedScriptId = project.scripts[0]?.id || null;
  renderAll();
  scheduleSave();
});
$('g-add-scene')?.addEventListener('click', () => {
  if (!editable) return;
  musiclessScene();
});

function musiclessScene() {
  pushHistory();
  const blank = blankProject(project.project.name, project.mode);
  const next = blank.scenes[0];
  next.name = `Scene ${project.scenes.length + 1}`;
  scene()?.environment && (next.environment = clone(scene().environment));
  project.scenes.push(next);
  project.activeScene = next.id;
  selectedId = null;
  renderAll();
  scheduleSave();
}

$('g-hierarchy-search')?.addEventListener('input', renderHierarchy);
$('g-script-select')?.addEventListener('change', (event) => selectScript(event.target.value));

/* ---------------- 3D viewport ---------------- */

let three = null;
let t3 = null;
let tr3 = null;
let ts3 = null;
let tc3 = null;
let grid3 = null;
let selectionBox3 = null;
let gizmo3 = null;
let t3Objects = new Map();
let t3EntityMeshes = new Map();
let t3Raycaster = null;
let t3Pointer = new T2();
let orbit3 = { target: { x: 0, y: 1, z: 0 }, yaw: 0.72, pitch: 0.42, distance: 14 };
let drag3 = null;
let t3Hover = false;
let t3Keys = new Set();
let t3Last = performance.now();
let t3Fps = 60;
let t3Accum = 0;
let t3Frames = 0;
let viewMode = 'perspective';

function T2() { return { x: 0, y: 0 }; }

function init3D() {
  if (three) return;
  three = window.CascadeThree?.THREE;
  const canvas = $('g-canvas-3d');
  if (!three || !canvas) return;
  try {
    tr3 = new three.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    tr3.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    tr3.shadowMap.enabled = true;
    tr3.shadowMap.type = three.PCFSoftShadowMap;
    tr3.outputColorSpace = three.SRGBColorSpace;
    tr3.toneMapping = three.ACESFilmicToneMapping;
    tr3.toneMappingExposure = 1.06;
    tc3 = new three.PerspectiveCamera(55, 1, 0.1, 600);
    t3Raycaster = new three.Raycaster();
    rebuild3D();
    requestAnimationFrame(render3DLoop);
    bind3DControls();
    resize3D();
  } catch (error) {
    console.warn('3D viewport unavailable', error);
    const help = $('g-view-help');
    if (help) help.textContent = 'WebGL is unavailable in this browser. Use Play mode or a WebGL-capable browser.';
  }
}

function env3() {
  return scene()?.environment || {};
}

function dispose3DScene() {
  if (!ts3 || !three) return;
  ts3.traverse((child) => {
    if (child.geometry) child.geometry.dispose?.();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => { for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (material[key]) material[key].dispose?.(); material.dispose?.(); });
    }
  });
}

function queueRebuild3D() {
  if (project.mode !== '3d' || !three) return;
  clearTimeout(rebuild3DTimer);
  rebuild3DTimer = setTimeout(rebuild3D, 35);
}

function primitive3D(type, w, h, d) {
  switch (type) {
    case 'sphere': return new three.SphereGeometry(0.5, 28, 18);
    case 'cylinder': return new three.CylinderGeometry(0.5, 0.5, 1, 24);
    case 'cone': return new three.ConeGeometry(0.5, 1, 24);
    case 'plane': return new three.PlaneGeometry(1, 1);
    case 'capsule': return new three.CapsuleGeometry(0.5, 1, 8, 16);
    case 'torus': return new three.TorusGeometry(0.4, 0.16, 10, 28);
    default: return new three.BoxGeometry(1, 1, 1);
  }
}

function build3DEntity(item) {
  const group = new three.Group();
  group.userData.entityId = item.id;
  group.position.set(item.x, item.y, item.z);
  group.rotation.set(deg(item.rotationX), deg(item.rotationY), deg(item.rotationZ));
  group.scale.set(item.w || 1, item.h || 1, item.d || 1);
  group.visible = item.visible !== false;
  const renderer = item.components.MeshRenderer;
  if (renderer) {
    let geometry;
    let material;
    if (renderer.mesh === 'custom' && renderer.assetId) {
      const cached = assetModels.get(renderer.assetId);
      if (cached) {
        const model = cached.clone(true);
        model.traverse((child) => { if (child.isMesh) { child.castShadow = renderer.castShadow !== false; child.receiveShadow = renderer.receiveShadow !== false; } });
        group.add(model);
      } else {
        loadEditorModel(renderer.assetId);
        geometry = new three.BoxGeometry(1, 1, 1);
        material = new three.MeshStandardMaterial({ color: renderer.color || '#64748b', roughness: 0.8, metalness: 0.1, wireframe: true });
      }
    }
    if (!geometry && !material) {
      geometry = primitive3D(renderer.mesh || 'box');
      material = new three.MeshStandardMaterial({
        color: renderer.color || '#e11d48', roughness: num(renderer.roughness, 0.55), metalness: num(renderer.metalness, 0.1),
        transparent: num(renderer.opacity, 1) < 1, opacity: num(renderer.opacity, 1), emissive: renderer.emissive || '#000000', emissiveIntensity: num(renderer.emissiveIntensity, 0),
      });
      const texture = renderer.textureAssetId && project.assets.find((asset) => asset.id === renderer.textureAssetId);
      if (texture?.src) loadEditorTexture(texture, material);
    }
    if (geometry && material) {
      const mesh = new three.Mesh(geometry, material);
      mesh.castShadow = renderer.castShadow !== false;
      mesh.receiveShadow = renderer.receiveShadow !== false;
      group.add(mesh);
    }
    t3EntityMeshes.set(item.id, group);
  } else if (item.components.Camera3D) {
    const helper = new three.Group();
    const body = new three.Mesh(new three.BoxGeometry(0.7, 0.45, 0.7), new three.MeshBasicMaterial({ color: 0xfb7185, wireframe: true }));
    const lens = new three.Mesh(new three.ConeGeometry(0.28, 0.55, 4), new three.MeshBasicMaterial({ color: 0xfecdd3 }));
    lens.rotation.x = -Math.PI / 2; lens.position.z = 0.45;
    helper.add(body, lens); group.add(helper);
  } else if (item.components.Light3D) {
    const lightDef = item.components.Light3D;
    let light;
    if (lightDef.type === 'directional') light = new three.DirectionalLight(lightDef.color || '#ffffff', num(lightDef.intensity, 2));
    else if (lightDef.type === 'spot') light = new three.SpotLight(lightDef.color || '#ffffff', num(lightDef.intensity, 30), num(lightDef.distance, 40), deg(lightDef.angle || 30), num(lightDef.penumbra, 0.3), 1);
    else if (lightDef.type === 'point') light = new three.PointLight(lightDef.color || '#ffffff', num(lightDef.intensity, 12), num(lightDef.distance, 25), 1.5);
    else light = new three.HemisphereLight(lightDef.color || '#ffffff', '#1e293b', num(lightDef.intensity, 1));
    light.castShadow = lightDef.castShadow !== false;
    light.position.set(0, 0, 0);
    group.add(light);
    const marker = new three.Mesh(new three.SphereGeometry(0.22, 10, 8), new three.MeshBasicMaterial({ color: lightDef.color || '#fbbf24' }));
    group.add(marker);
  } else if (item.components.TerrainComponent) {
    const terrain = item.components.TerrainComponent;
    const geo = new three.PlaneGeometry(num(terrain.size, 40), num(terrain.size, 40), Math.min(48, num(terrain.segments, 24)), Math.min(48, num(terrain.segments, 24)));
    geo.rotateX(-Math.PI / 2);
    const mesh = new three.Mesh(geo, new three.MeshStandardMaterial({ color: terrain.color || '#3f6212', roughness: 1, wireframe: false }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function rebuild3D() {
  if (!three || project.mode !== '3d') return;
  const canvas = $('g-canvas-3d');
  if (!canvas) return;
  dispose3DScene();
  ts3 = new three.Scene();
  const environment = env3();
  ts3.background = new three.Color(environment.bottom || project.project.background || '#080a10');
  ts3.fog = environment.fog === false ? null : new three.Fog(environment.fogColor || '#0f172a', num(environment.fogNear, 18), num(environment.fogFar, 80));
  const hemi = new three.HemisphereLight(environment.top || '#93c5fd', environment.bottom || '#0f172a', 1.6);
  ts3.add(hemi);
  const fill = new three.DirectionalLight('#ffffff', 1.5);
  fill.position.set(7, 12, 8);
  ts3.add(fill);
  const grid = new three.GridHelper(80, 80, 0x2b3342, 0x1a202b);
  grid.position.y = 0;
  grid3 = grid;
  ts3.add(grid);
  const axes = new three.AxesHelper(1.6);
  axes.position.y = 0.01;
  ts3.add(axes);
  const byId = new Map((scene()?.entities || []).map((item) => [item.id, item]));
  const groups = new Map();
  t3Objects = new Map();
  t3EntityMeshes = new Map();
  for (const item of scene()?.entities || []) {
    const group = build3DEntity(item);
    groups.set(item.id, group);
    t3Objects.set(item.id, group);
  }
  for (const item of scene()?.entities || []) {
    const group = groups.get(item.id);
    const parent = item.parentId && byId.has(item.parentId) ? groups.get(item.parentId) : null;
    (parent || ts3).add(group);
  }
  selectionBox3 = new three.BoxHelper(new three.Object3D(), 0xfb7185);
  selectionBox3.visible = false;
  ts3.add(selectionBox3);
  updateSelection3D();
  updateEditorCamera();
}

function deg(value) { return (num(value) * Math.PI) / 180; }

function loadEditorModel(assetId) {
  const asset = project.assets.find((entry) => entry.id === assetId);
  if (!asset?.src || assetModels.has(assetId) || assetModels.get(`${assetId}:loading`)) return;
  assetModels.set(`${assetId}:loading`, true);
  const finish = (object) => {
    assetModels.delete(`${assetId}:loading`);
    if (!object) return;
    assetModels.set(assetId, object);
    queueRebuild3D();
  };
  const ext = String(asset.name || '').split('.').pop().toLowerCase();
  fetch(asset.src).then((response) => response.arrayBuffer()).then((buffer) => {
    if (ext === 'obj' && window.CascadeThree?.OBJLoader) finish(new window.CascadeThree.OBJLoader().parse(new TextDecoder().decode(buffer)));
    else if (ext === 'glb' || ext === 'gltf') new window.CascadeThree.GLTFLoader().parse(buffer, '', (gltf) => finish(gltf.scene), () => finish(null));
    else if (ext === 'fbx' && window.CascadeThree?.FBXLoader) finish(new window.CascadeThree.FBXLoader().parse(buffer));
    else if (ext === 'stl' && window.CascadeThree?.STLLoader) {
      const geometry = new window.CascadeThree.STLLoader().parse(buffer);
      finish(new three.Mesh(geometry, new three.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.7 })));
    } else finish(null);
  }).catch(() => finish(null));
}

function loadEditorTexture(asset, material) {
  if (!asset?.src) return;
  if (assetTextures.has(asset.id)) { material.map = assetTextures.get(asset.id); material.needsUpdate = true; return; }
  const loader = new three.TextureLoader();
  loader.load(asset.src, (texture) => {
    texture.colorSpace = three.SRGBColorSpace;
    assetTextures.set(asset.id, texture);
    material.map = texture;
    material.needsUpdate = true;
  }, undefined, () => {});
}

function updateEditorCamera() {
  if (!three || !tc3) return;
  const { target, yaw, pitch, distance } = orbit3;
  if (viewMode === 'top') { tc3.position.set(target.x, target.y + distance, target.z + 0.001); }
  else if (viewMode === 'front') { tc3.position.set(target.x, target.y, target.z + distance); }
  else if (viewMode === 'side') { tc3.position.set(target.x + distance, target.y, target.z); }
  else {
    tc3.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
  }
  tc3.lookAt(target.x, target.y, target.z);
  if (viewMode === 'ortho') {
    if (!(tc3 instanceof three.OrthographicCamera)) {
      const aspect = Math.max(0.2, (tc3.aspect || 1));
      const size = 9;
      const next = new three.OrthographicCamera(-size * aspect, size * aspect, size, -size, 0.1, 600);
      next.position.copy(tc3.position); next.lookAt(target.x, target.y, target.z);
      tc3 = next;
    }
  } else if (!(tc3 instanceof three.PerspectiveCamera)) {
    const next = new three.PerspectiveCamera(55, 1, 0.1, 600);
    next.position.copy(tc3.position); next.lookAt(target.x, target.y, target.z);
    tc3 = next;
  }
}

function resize3D() {
  if (!tr3 || !tc3) return;
  const canvas = $('g-canvas-3d');
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  tr3.setSize(w, h, false);
  if (tc3.isPerspectiveCamera) { tc3.aspect = w / h; tc3.updateProjectionMatrix(); }
  else if (tc3.isOrthographicCamera) { const aspect = w / h; const size = 9; tc3.left = -size * aspect; tc3.right = size * aspect; tc3.top = size; tc3.bottom = -size; tc3.updateProjectionMatrix(); }
}

function render3DLoop(now) {
  const dt = Math.min(0.1, (now - t3Last) / 1000 || 0.016);
  t3Last = now;
  if (tr3 && ts3 && tc3) {
    if (t3Hover && t3Keys.size) {
      const speed = (t3Keys.has('shift') ? 2.6 : 1) * 8 * dt;
      const forward = new three.Vector3(); tc3.getWorldDirection(forward);
      const right = new three.Vector3().crossVectors(forward, new three.Vector3(0, 1, 0)).normalize();
      if (t3Keys.has('w')) orbit3.target.x += forward.x * speed, orbit3.target.y += forward.y * speed, orbit3.target.z += forward.z * speed;
      if (t3Keys.has('s')) orbit3.target.x -= forward.x * speed, orbit3.target.y -= forward.y * speed, orbit3.target.z -= forward.z * speed;
      if (t3Keys.has('d')) orbit3.target.x += right.x * speed, orbit3.target.z += right.z * speed;
      if (t3Keys.has('a')) orbit3.target.x -= right.x * speed, orbit3.target.z -= right.z * speed;
      if (t3Keys.has('q')) orbit3.target.y -= speed;
      if (t3Keys.has('e')) orbit3.target.y += speed;
      updateEditorCamera();
    }
    if (selectionBox3?.visible) selectionBox3.update();
    if (gizmo3) {
      const selected = selectedEntity();
      if (selected) {
        const pos = new three.Vector3(); selected && t3Objects.get(selected.id)?.getWorldPosition(pos);
        gizmo3.position.copy(pos);
        const scale = Math.max(0.45, tc3.position.distanceTo(pos) * 0.08);
        gizmo3.scale.setScalar(scale);
      }
    }
    tr3.render(ts3, tc3);
    t3Frames += 1; t3Accum += dt;
    if (t3Accum > 0.5) { t3Fps = Math.round(t3Frames / t3Accum); t3Accum = 0; t3Frames = 0; updateViewStats(); }
  }
  requestAnimationFrame(render3DLoop);
}

function updateViewStats() {
  const count = scene()?.entities?.length || 0;
  const fps = $('g-fps');
  if (fps) fps.textContent = `${project.mode === '3d' ? t3Fps : '—'} fps`;
  const stats = $('g-view-stats');
  if (stats) stats.textContent = `${count} object${count === 1 ? '' : 's'}`;
  const render = $('g-prof-render');
  if (render) render.textContent = project.mode === '3d' ? `viewport fps: ${t3Fps}\ndraw objects: ${count}\nmode: ${viewMode}\nquality: ${project.project.render3d?.quality || 'medium'}` : `viewport: Canvas2D\nobjects: ${count}\nzoom: ${Math.round(cam2d.zoom * 100)}%`;
  const sim = $('g-prof-sim');
  if (sim) sim.textContent = `scripts: ${project.scripts.length}\nvisual nodes: ${project.scripts.reduce((sum, script) => sum + (script.graph?.nodes?.length || 0), 0)}\nphysics step: ${project.project.physicsTimestep}`;
}

function updateSelection3D() {
  if (!three || project.mode !== '3d') return;
  const item = selectedEntity();
  if (selectionBox3) {
    selectionBox3.visible = !!item;
    if (item && t3Objects.get(item.id)) { selectionBox3.setFromObject(t3Objects.get(item.id)); selectionBox3.material.color.set(0xfb7185); }
  }
  if (gizmo3) { ts3.remove(gizmo3); gizmo3 = null; }
  if (!item || !t3Objects.get(item.id)) return;
  const group = new three.Group();
  const axes = [
    ['x', 0xfb7185, new three.Vector3(1, 0, 0)],
    ['y', 0x34d399, new three.Vector3(0, 1, 0)],
    ['z', 0x60a5fa, new three.Vector3(0, 0, 1)],
  ];
  for (const [axis, color, dir] of axes) {
    const shaft = new three.Mesh(new three.CylinderGeometry(0.018, 0.018, 0.95, 6), new three.MeshBasicMaterial({ color, depthTest: false }));
    shaft.position.copy(dir.clone().multiplyScalar(0.48));
    shaft.quaternion.setFromUnitVectors(new three.Vector3(0, 1, 0), dir);
    shaft.userData.axis = axis;
    const tip = new three.Mesh(new three.ConeGeometry(0.065, 0.2, 8), new three.MeshBasicMaterial({ color, depthTest: false }));
    tip.position.copy(dir.clone().multiplyScalar(1.03));
    tip.quaternion.copy(shaft.quaternion);
    tip.userData.axis = axis;
    group.add(shaft, tip);
  }
  const center = new three.Mesh(new three.SphereGeometry(0.07, 10, 8), new three.MeshBasicMaterial({ color: 0xf8fafc, depthTest: false }));
  group.add(center);
  group.renderOrder = 999;
  group.traverse((child) => { if (child.isMesh) { child.material.depthTest = false; child.renderOrder = 999; } });
  gizmo3 = group;
  ts3.add(group);
}

function ndc(event) {
  const rect = $('g-canvas-3d').getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * 2 - 1, y: -((event.clientY - rect.top) / rect.height) * 2 + 1 };
}

function pick3D(event) {
  if (!three || !ts3 || !tc3) return null;
  t3Raycaster.setFromCamera(ndc(event), tc3);
  if (gizmo3) {
    const gizmoHits = t3Raycaster.intersectObjects(gizmo3.children, false);
    if (gizmoHits.length) return { gizmo: gizmoHits[0].object.userData.axis || null };
  }
  const roots = [...t3Objects.values()].filter((object) => ts3.children.includes(object));
  const hits = t3Raycaster.intersectObjects(roots, true);
  for (const hit of hits) {
    let object = hit.object;
    while (object && !object.userData.entityId) object = object.parent;
    if (object?.userData.entityId) return { entity: findEntity(object.userData.entityId) };
  }
  return null;
}

function bind3DControls() {
  const canvas = $('g-canvas-3d');
  if (!canvas) return;
  canvas.addEventListener('pointerdown', (event) => {
    if (project.mode !== '3d') return;
    canvas.setPointerCapture(event.pointerId);
    const hit = pick3D(event);
    drag3 = { startX: event.clientX, startY: event.clientY, moved: false, mode: 'orbit' };
    if (hit?.gizmo) {
      const item = selectedEntity();
      if (!item) return;
      pushHistory();
      drag3 = { ...drag3, mode: 'gizmo', axis: hit.gizmo, entityId: item.id, before: clone(item) };
      return;
    }
    if (hit?.entity) {
      setSelected(hit.entity.id);
      return;
    }
    if (event.button === 1 || event.button === 2 || event.shiftKey) drag3.mode = 'pan';
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag3) return;
    const dx = event.clientX - drag3.startX;
    const dy = event.clientY - drag3.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag3.moved = true;
    if (drag3.mode === 'orbit') {
      orbit3.yaw -= dx * 0.006;
      orbit3.pitch = clamp(orbit3.pitch + dy * 0.005, -1.35, 1.35);
      updateEditorCamera();
      drag3.startX = event.clientX; drag3.startY = event.clientY;
    } else if (drag3.mode === 'pan') {
      const right = new three.Vector3(); const up = new three.Vector3();
      tc3.matrixWorld.extractBasis(right, up, new three.Vector3());
      const scale = orbit3.distance * 0.0015;
      orbit3.target.x -= right.x * dx * scale; orbit3.target.y -= right.y * dx * scale; orbit3.target.z -= right.z * dx * scale;
      orbit3.target.y += up.y * dy * scale; orbit3.target.x += up.x * dy * scale;
      updateEditorCamera();
      drag3.startX = event.clientX; drag3.startY = event.clientY;
    } else if (drag3.mode === 'gizmo') {
      const item = findEntity(drag3.entityId);
      if (!item) return;
      const p0 = new three.Vector3(item.x, item.y, item.z).project(tc3);
      const axisVec = new three.Vector3(drag3.axis === 'x' ? 1 : 0, drag3.axis === 'y' ? 1 : 0, drag3.axis === 'z' ? 1 : 0);
      const p1 = new three.Vector3(item.x, item.y, item.z).add(axisVec).project(tc3);
      const sx = (p1.x - p0.x) * canvas.getBoundingClientRect().width / 2;
      const sy = -(p1.y - p0.y) * canvas.getBoundingClientRect().height / 2;
      const len = Math.hypot(sx, sy) || 1;
      const amount = (dx * sx + dy * sy) / len * 0.012;
      if (gizmoMode === 'move') {
        item[drag3.axis] = drag3.before[drag3.axis] + amount * orbit3.distance * 0.12;
        if (snapEnabled) item[drag3.axis] = Math.round(item[drag3.axis] * 4) / 4;
      } else if (gizmoMode === 'rotate') {
        const key = `rotation${drag3.axis.toUpperCase()}`;
        item[key] = drag3.before[key] + (dx + dy) * 0.35;
        if (snapEnabled) item[key] = Math.round(item[key] / 15) * 15;
      } else {
        const key = drag3.axis === 'x' ? 'w' : drag3.axis === 'y' ? 'h' : 'd';
        item[key] = Math.max(0.05, drag3.before[key] + (dx + dy) * 0.008 * orbit3.distance * 0.1);
        if (snapEnabled) item[key] = Math.round(item[key] * 10) / 10;
      }
      update3DObject(item);
      scheduleSave();
      updateTransformFields(item);
    }
  });
  const end = () => {
    if (drag3?.mode === 'gizmo') { refreshAfterChange({ rebuild: true }); }
    drag3 = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerenter', () => { t3Hover = true; });
  canvas.addEventListener('pointerleave', () => { t3Hover = false; t3Keys.clear(); });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    orbit3.distance = clamp(orbit3.distance * (event.deltaY > 0 ? 1.1 : 0.9), 1.2, 200);
    updateEditorCamera();
  }, { passive: false });
  canvas.addEventListener('dblclick', focusSelection);
  window.addEventListener('keydown', (event) => {
    if (project.mode !== '3d' || !t3Hover || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (event.key === 'Shift') t3Keys.add('shift');
    if (['w', 'a', 's', 'd', 'q', 'e'].includes(event.key.toLowerCase())) { t3Keys.add(event.key.toLowerCase()); event.preventDefault(); }
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Shift') t3Keys.delete('shift');
    t3Keys.delete(event.key.toLowerCase());
  });
}

function update3DObject(item) {
  if (!three || project.mode !== '3d' || !item) return;
  const object = t3Objects.get(item.id);
  if (!object) return;
  object.position.set(item.x, item.y, item.z);
  object.rotation.set(deg(item.rotationX), deg(item.rotationY), deg(item.rotationZ));
  object.scale.set(item.w || 1, item.h || 1, item.d || 1);
  object.visible = item.visible !== false;
  if (selectionBox3) selectionBox3.setFromObject(object);
  if (gizmo3) { const p = new three.Vector3(); object.getWorldPosition(p); gizmo3.position.copy(p); }
  draw2D();
}

function focusSelection() {
  const item = selectedEntity();
  if (!item) return;
  if (project.mode === '3d') {
    orbit3.target = { x: item.x, y: item.y, z: item.z };
    orbit3.distance = Math.max(3, Math.max(item.w, item.h, item.d) * 4);
    updateEditorCamera();
  } else {
    cam2d.x = item.x; cam2d.y = item.y; cam2d.zoom = clamp(Math.min(viewportSize.w / Math.max(120, item.w * 3), viewportSize.h / Math.max(120, item.h * 3)), 0.3, 3);
    draw2D();
  }
}

function setView(mode) {
  viewMode = mode;
  if (mode === 'perspective') viewMode = 'perspective';
  updateEditorCamera();
  const label = $('g-view-label');
  if (label) label.textContent = mode === 'perspective' ? 'Perspective' : mode === 'ortho' ? 'Orthographic' : `${mode[0].toUpperCase()}${mode.slice(1)} view`;
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('on', button.dataset.view === mode));
  draw2D();
}

function ensureComponent(item, type) {
  if (!item.components[type]) item.components[type] = {};
  return item.components[type];
}

function addPrimitive3D(kind) {
  const p = project.project;
  const base = { x: orbit3.target.x, y: orbit3.target.y, z: orbit3.target.z };
  if (kind === 'camera') {
    const item = entity('Camera', { id: gid('e'), x: base.x, y: base.y + 1.7, z: base.z + 6, w: 1, h: 1, d: 1, components: { Camera3D: { fov: 60, controller: 'orbit' } } });
    scene().entities.push(item); selectedId = item.id;
  } else if (kind === 'light') {
    const item = entity('Sun', { id: gid('e'), x: base.x + 5, y: base.y + 8, z: base.z + 5, w: 1, h: 1, d: 1, components: { Light3D: { type: 'directional', intensity: 2.5, color: '#fff1d6', castShadow: true } } });
    scene().entities.push(item); selectedId = item.id;
  } else if (kind === 'empty') {
    const item = entity('Group', { id: gid('e'), x: base.x, y: base.y, z: base.z, w: 1, h: 1, d: 1 });
    scene().entities.push(item); selectedId = item.id;
  } else {
    const item = entity(kind === 'box' ? 'Cube' : kind[0].toUpperCase() + kind.slice(1), { id: gid('e'), x: base.x, y: Math.max(0.5, base.y), z: base.z, w: 1, h: 1, d: 1, components: { MeshRenderer: { mesh: kind, color: ['#e11d48', '#38bdf8', '#a78bfa', '#f59e0b'][Math.floor(Math.random() * 4)], roughness: 0.55 }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: kind === 'sphere' ? 'sphere' : 'box', width: 1, height: 1, depth: 1 } } });
    scene().entities.push(item); selectedId = item.id;
  }
  changed({ rebuild: true });
}

function addPrimitive2D(kind) {
  const center = world2d(viewportSize.w / 2, viewportSize.h / 2);
  let item;
  if (kind === 'camera') item = entity('Camera', { id: gid('e'), x: center.x, y: center.y, w: 1, h: 1, components: { Camera2D: { zoom: 1 } } });
  else if (kind === 'light') item = entity('Light', { id: gid('e'), x: center.x, y: center.y, w: 48, h: 48, components: { Light2D: { color: '#fbbf24', radius: 160, intensity: 0.6 } } });
  else if (kind === 'empty') item = entity('Group', { id: gid('e'), x: center.x, y: center.y, w: 1, h: 1 });
  else item = entity(kind === 'sprite' ? 'Sprite' : kind[0].toUpperCase() + kind.slice(1), { id: gid('e'), x: center.x, y: center.y, w: 64, h: 64, components: { SpriteRenderer: { color: ['#e11d48', '#38bdf8', '#a78bfa', '#f59e0b'][Math.floor(Math.random() * 4)], shape: kind === 'sphere' ? 'circle' : kind === 'capsule' ? 'capsule' : 'rect' }, ...(kind === 'sprite' ? {} : { Rigidbody2D: { bodyType: 'dynamic' }, Collider2D: { shape: kind === 'sphere' ? 'circle' : 'rectangle' } }) } });
  scene().entities.push(item); selectedId = item.id;
  changed({ rebuild: false });
}

function duplicateSelection() {
  const item = selectedEntity();
  if (!item || !editable) return;
  pushHistory();
  const copy = clone(item);
  copy.id = gid('e');
  copy.name = `${item.name} copy`;
  copy.x += project.mode === '3d' ? 1 : 32;
  if (project.mode === '3d') copy.z += 1; else copy.y += 32;
  scene().entities.push(copy);
  selectedId = copy.id;
  changed({ rebuild: true, history: false });
}

function deleteSelection() {
  const item = selectedEntity();
  if (!item || !editable) return;
  pushHistory();
  const ids = new Set([item.id]);
  let changedSet = true;
  while (changedSet) {
    changedSet = false;
    for (const entry of scene().entities) if (entry.parentId && ids.has(entry.parentId) && !ids.has(entry.id)) { ids.add(entry.id); changedSet = true; }
  }
  scene().entities = scene().entities.filter((entry) => !ids.has(entry.id));
  selectedId = null;
  changed({ rebuild: true, history: false });
}

function groupSelection() {
  const item = selectedEntity();
  if (!item || !editable) return;
  pushHistory();
  const group = entity('Group', { id: gid('e'), x: item.x, y: item.y, z: item.z, w: 1, h: 1, d: 1, parentId: item.parentId || null });
  scene().entities.push(group);
  item.parentId = group.id;
  selectedId = group.id;
  changed({ rebuild: true, history: false });
}

function openComponentDialog() {
  if (!selectedEntity()) return;
  const select = $('g-component-type');
  select.innerHTML = Object.entries(COMPONENT_DEFS).map(([type, def]) => `<option value="${esc(type)}">${esc(def.label || type)}</option>`).join('');
  $('g-component-dialog')?.showModal();
}

$('g-component-add')?.addEventListener('click', () => {
  const item = selectedEntity();
  const type = $('g-component-type')?.value;
  if (!item || !type || !editable) return;
  pushHistory();
  addComponent(item, type);
  $('g-component-dialog')?.close();
  changed({ rebuild: true, history: false });
});

function addObjectFromToolbar() {
  if (!editable) return toast('You have view-only access to this project.', true);
  const kind = $('g-add-type')?.value || 'box';
  if (project.mode === '3d') addPrimitive3D(kind); else addPrimitive2D(kind);
}

function renderAll() {
  const badge = $('g-mode-badge');
  if (badge) badge.textContent = project.mode === '3d' ? '3D' : '2D';
  const canvas2 = $('g-canvas-2d'), canvas3 = $('g-canvas-3d');
  if (canvas2) canvas2.hidden = project.mode === '3d';
  if (canvas3) canvas3.hidden = project.mode !== '3d';
  const select = $('g-scene-select');
  if (select) select.innerHTML = project.scenes.map((entry) => `<option value="${esc(entry.id)}"${entry.id === project.activeScene ? ' selected' : ''}>${esc(entry.name)}</option>`).join('');
  const modeHint = $('g-view-help');
  if (modeHint) modeHint.textContent = project.mode === '3d' ? 'Orbit: drag empty space · Pan: right-drag / Shift-drag · Zoom: wheel · Fly: WASD + Q/E · Focus: F' : 'Drag objects to move · Pan: right-drag · Zoom: wheel · Focus: F · Snap: grid';
  renderHierarchy();
  renderAssets();
  renderScripts();
  renderInspector();
  renderGraph();
  renderCode();
  updateViewStats();
  if (project.mode === '3d') {
    init3D();
    queueRebuild3D();
    setTimeout(resize3D, 0);
  } else {
    setTimeout(resize2d, 0);
    draw2D();
  }
}

/* ---------------- visual graph editor ---------------- */

let pendingPin = null;
let dragNode = null;

function nodeWidth() { return 208; }

function nodePinY(node, pinId, direction) {
  const def = gameNodeDef(node.type);
  const pins = def?.[direction === 'out' ? 'outputs' : 'inputs'] || [];
  const index = Math.max(0, pins.findIndex((pin) => pin.id === pinId));
  return node.y + 37 + index * 17;
}

function renderGraph() {
  const wrap = $('g-graph-wrap');
  const nodesHost = $('g-graph-nodes');
  const edges = $('g-graph-edges');
  if (!wrap || !nodesHost || !edges) return;
  const script = activeScript();
  const empty = $('g-graph-empty');
  const graph = script?.type === 'visual' ? script.graph || { nodes: [], edges: [] } : null;
  $('g-graph-tools').style.display = activeTab === 'graph' ? 'inline-flex' : 'none';
  if (!graph) {
    nodesHost.innerHTML = '';
    edges.innerHTML = '';
    if (empty) { empty.hidden = false; empty.querySelector('b').textContent = script ? 'This is a JavaScript script.' : 'No script selected.'; empty.querySelector('span').textContent = script ? 'Switch to the Code tab to edit it.' : 'Create a visual script, then add lifecycle and gameplay nodes.'; }
    return;
  }
  if (empty) empty.hidden = graph.nodes.length > 0;
  nodesHost.innerHTML = graph.nodes.map((node) => {
    const def = gameNodeDef(node.type) || { title: node.type, inputs: [], outputs: [], color: '#334155', category: 'unknown' };
    const inputPins = (def.inputs || []).map((pin) => `<div class="gs-pin ${pin.kind === 'exec' ? 'exec' : ''}" data-node="${esc(node.id)}" data-pin="${esc(pin.id)}" data-dir="in"><i></i><span>${esc(pin.label || pin.id)}</span></div>`).join('');
    const outputPins = (def.outputs || []).map((pin) => `<div class="gs-pin ${pin.kind === 'exec' ? 'exec' : ''}" data-node="${esc(node.id)}" data-pin="${esc(pin.id)}" data-dir="out"><span>${esc(pin.label || pin.id)}</span><i></i></div>`).join('');
    const configText = Object.entries(node.config || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined).slice(0, 3).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value).slice(0, 20) : String(value).slice(0, 24)}`).join(' · ');
    return `<div class="gs-node${selectedNodeId === node.id ? ' sel' : ''}" data-node-id="${esc(node.id)}" style="left:${num(node.x, 40)}px;top:${num(node.y, 40)}px;--node-color:${esc(def.color || '#334155')}">
      <div class="gs-node-head" data-node-drag="${esc(node.id)}"><span>${esc(def.title || node.type)}</span><span class="gs-node-cat">${esc(def.category || '')}</span></div>
      <div class="gs-node-body"><div class="gs-node-pins">${inputPins}</div><div class="gs-node-pins out">${outputPins}</div></div>
      ${configText ? `<div class="gs-node-config" title="${esc(configText)}">${esc(configText)}</div>` : ''}
    </div>`;
  }).join('');
  const connected = new Set();
  for (const edge of graph.edges || []) {
    connected.add(`${edge.from.node}:${edge.from.pin}:out`);
    connected.add(`${edge.to.node}:${edge.to.pin}:in`);
  }
  nodesHost.querySelectorAll('.gs-pin').forEach((el) => {
    if (connected.has(`${el.dataset.node}:${el.dataset.pin}:${el.dataset.dir}`)) el.classList.add('connected');
  });
  edges.innerHTML = (graph.edges || []).map((edge) => {
    const from = graph.nodes.find((node) => node.id === edge.from.node);
    const to = graph.nodes.find((node) => node.id === edge.to.node);
    if (!from || !to) return '';
    const x1 = num(from.x, 40) + nodeWidth();
    const y1 = nodePinY(from, edge.from.pin, 'out');
    const x2 = num(to.x, 40);
    const y2 = nodePinY(to, edge.to.pin, 'in');
    const mid = Math.max(38, Math.abs(x2 - x1) / 2);
    const def = gameNodeDef(from.type);
    const pin = (def?.outputs || []).find((entry) => entry.id === edge.from.pin);
    return `<path data-edge="${esc(edge.id)}" class="${pin?.kind === 'exec' ? 'exec' : ''}" d="M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}" />`;
  }).join('');
}

$('g-graph-nodes')?.addEventListener('pointerdown', (event) => {
  const pin = event.target.closest('.gs-pin');
  if (pin) {
    event.stopPropagation();
    const node = activeScript()?.graph?.nodes?.find((entry) => entry.id === pin.dataset.node);
    if (!node) return;
    if (pin.dataset.dir === 'out') {
      pendingPin = { node: node.id, pin: pin.dataset.pin };
      document.querySelectorAll('.gs-pin.pending').forEach((el) => el.classList.remove('pending'));
      pin.classList.add('pending');
      toast('Click an input pin to connect', false);
    } else if (pendingPin) {
      connectPins(pendingPin, { node: node.id, pin: pin.dataset.pin });
      pendingPin = null;
      document.querySelectorAll('.gs-pin.pending').forEach((el) => el.classList.remove('pending'));
    }
    return;
  }
  const head = event.target.closest('[data-node-drag]');
  if (!head) return;
  const node = activeScript()?.graph?.nodes?.find((entry) => entry.id === head.dataset.nodeDrag);
  if (!node) return;
  selectedNodeId = node.id;
  selectedId = null;
  renderGraph();
  renderInspector();
  const rect = $('g-graph-nodes').getBoundingClientRect();
  dragNode = { id: node.id, startX: event.clientX, startY: event.clientY, x: num(node.x, 40), y: num(node.y, 40), scrollX: $('g-graph-wrap').scrollLeft, scrollY: $('g-graph-wrap').scrollTop, rect };
  $('g-graph-nodes').setPointerCapture(event.pointerId);
  pushHistory();
});

$('g-graph-nodes')?.addEventListener('pointermove', (event) => {
  if (!dragNode) return;
  const node = activeScript()?.graph?.nodes?.find((entry) => entry.id === dragNode.id);
  if (!node) return;
  node.x = Math.max(0, dragNode.x + (event.clientX - dragNode.startX));
  node.y = Math.max(0, dragNode.y + (event.clientY - dragNode.startY));
  const el = $('g-graph-nodes').querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
  if (el) { el.style.left = `${node.x}px`; el.style.top = `${node.y}px`; }
  renderGraph();
  scheduleSave();
});
$('g-graph-nodes')?.addEventListener('pointerup', () => { if (dragNode) { dragNode = null; refreshAfterChange({ rebuild: false, inspector: false }); } });
$('g-graph-nodes')?.addEventListener('pointercancel', () => { dragNode = null; });

function connectPins(from, to) {
  const script = activeScript();
  if (!script?.graph) return;
  const fromNode = script.graph.nodes.find((node) => node.id === from.node);
  const toNode = script.graph.nodes.find((node) => node.id === to.node);
  const fromPin = (gameNodeDef(fromNode?.type)?.outputs || []).find((pin) => pin.id === from.pin);
  const toPin = (gameNodeDef(toNode?.type)?.inputs || []).find((pin) => pin.id === to.pin);
  if (!fromNode || !toNode || !fromPin || !toPin) return;
  if (from.node === to.node) return toast('A node cannot connect to itself', true);
  if ((fromPin.kind === 'exec') !== (toPin.kind === 'exec')) return toast('Connect execution pins to execution pins, or data to data', true);
  if (fromPin.kind !== 'exec' && fromPin.type !== 'any' && toPin.type !== 'any' && fromPin.type !== toPin.type) return toast(`Type mismatch: ${fromPin.type} → ${toPin.type}`, true);
  if (script.graph.edges.some((edge) => edge.from.node === from.node && edge.from.pin === from.pin && edge.to.node === to.node && edge.to.pin === to.pin)) return;
  pushHistory();
  script.graph.edges.push(graphEdge(from.node, from.pin, to.node, to.pin, fromPin.kind === 'exec' ? 'exec' : 'data'));
  changed({ rebuild: false, history: false, inspector: false });
  toast('Connected');
}

$('g-graph-edges')?.addEventListener('click', (event) => {
  const path = event.target.closest('[data-edge]');
  if (!path) return;
  const script = activeScript();
  if (!script?.graph) return;
  pushHistory();
  script.graph.edges = script.graph.edges.filter((edge) => edge.id !== path.dataset.edge);
  changed({ rebuild: false, history: false, inspector: false });
});

function openNodeLibrary() {
  if (!activeScript() || activeScript().type !== 'visual') return toast('Select or create a visual script first.', true);
  const grid = $('g-node-results');
  const cats = $('g-node-cats');
  const search = $('g-node-search');
  let category = 'All';
  if (search) search.value = '';
  const render = () => {
    const query = String(search?.value || '').toLowerCase();
    cats.innerHTML = ['All', ...GAME_NODE_CATEGORIES].map((cat) => `<button class="gs-library-cat${category === cat ? ' on' : ''}" type="button" data-cat="${esc(cat)}">${esc(cat)}</button>`).join('');
    const results = GAME_NODE_DEFS.filter((def) => (category === 'All' || def.category === category) && (!query || `${def.title} ${def.type} ${def.category} ${def.description}`.toLowerCase().includes(query)));
    grid.innerHTML = results.map((def) => `<div class="gs-library-node" data-add-node="${esc(def.type)}"><b>${esc(def.title)}</b><small>${esc(def.description || '')}</small><em>${esc(def.category || '')}</em></div>`).join('') || '<div class="gs-empty">No matching nodes.</div>';
  };
  cats.onclick = (event) => { const cat = event.target.closest('[data-cat]')?.dataset.cat; if (cat) { category = cat; render(); } };
  search.oninput = render;
  grid.onclick = (event) => {
    const type = event.target.closest('[data-add-node]')?.dataset.addNode;
    if (!type) return;
    addNodeToGraph(type);
  };
  render();
  $('g-node-dialog')?.showModal();
  search?.focus();
}

function addNodeToGraph(type) {
  const script = activeScript();
  if (!script?.graph || !editable) return;
  pushHistory();
  const wrap = $('g-graph-wrap');
  const x = Math.max(20, Math.round(wrap.scrollLeft + 340 + Math.random() * 80));
  const y = Math.max(20, Math.round(wrap.scrollTop + 80 + Math.random() * 140));
  const node = graphNode(type, x, y, defaultNodeConfig(type));
  script.graph.nodes.push(node);
  selectedNodeId = node.id;
  selectedId = null;
  $('g-node-dialog')?.close();
  changed({ rebuild: false, history: false, inspector: false });
  renderInspector();
}

function deleteSelectedNode() {
  const script = activeScript();
  if (!script?.graph || !selectedNodeId || !editable) return;
  pushHistory();
  script.graph.nodes = script.graph.nodes.filter((node) => node.id !== selectedNodeId);
  script.graph.edges = script.graph.edges.filter((edge) => edge.from.node !== selectedNodeId && edge.to.node !== selectedNodeId);
  selectedNodeId = null;
  changed({ rebuild: false, history: false });
}

$('g-add-node')?.addEventListener('click', openNodeLibrary);
$('g-delete-node')?.addEventListener('click', deleteSelectedNode);
$('g-fit-graph')?.addEventListener('click', () => {
  const wrap = $('g-graph-wrap');
  wrap.scrollLeft = 0; wrap.scrollTop = 0;
});
$('g-node-clear')?.addEventListener('click', () => { const input = $('g-node-search'); if (input) { input.value = ''; input.dispatchEvent(new Event('input')); } });
$('g-add-node')?.addEventListener('dblclick', (event) => event.preventDefault());

/* ---------------- code editor ---------------- */

function renderCode() {
  const script = activeScript();
  const textarea = $('g-code');
  const code = script?.type === 'code' ? script.code : '';
  if (textarea && document.activeElement !== textarea) textarea.value = script?.type === 'code' ? code : 'Select a JavaScript script to edit code, or add one from the Scripts panel.';
  if (monacoEditor) {
    const current = monacoEditor.getValue();
    if (script?.type === 'code' && current !== script.code) monacoEditor.setValue(script.code || '');
  }
  const wrap = $('g-code-wrap');
  if (wrap) wrap.dataset.language = script?.type === 'code' ? script.language || 'javascript' : 'text';
  const head = $('g-graph-tools');
  if (head) head.style.display = activeTab === 'graph' ? 'inline-flex' : 'none';
}

$('g-code')?.addEventListener('input', (event) => {
  const script = activeScript();
  if (!script || script.type !== 'code' || !editable) return;
  script.code = event.target.value;
  scheduleSave();
  clearTimeout(codeTimer);
  codeTimer = setTimeout(() => refreshAfterChange({ rebuild: false, inspector: false }), 250);
});

async function loadMonaco() {
  if (monaco) return monaco;
  if (monacoLoading) return monacoLoading;
  monacoLoading = new Promise((resolve) => {
    const fail = () => { monacoLoading = null; resolve(null); };
    const boot = () => {
      try {
        window.require.config({ paths: { vs: '/public/vendor/monaco/vs' } });
        window.require(['vs/editor/editor.main'], () => { monaco = window.monaco; monacoLoading = null; resolve(monaco); }, fail);
      } catch { fail(); }
    };
    if (window.require) boot();
    else {
      const loader = document.createElement('script');
      loader.src = '/public/vendor/monaco/vs/loader.js';
      loader.onload = boot;
      loader.onerror = fail;
      document.head.append(loader);
    }
  });
  return monacoLoading;
}

async function openMonaco() {
  if ($('g-tab-code')?.classList.contains('on') === false) return;
  const m = await loadMonaco();
  if (!m || !$('g-monaco') || monacoEditor) return;
  window.MonacoEnvironment = window.MonacoEnvironment || { getWorkerUrl: () => '/public/vendor/monaco/vs/editorWorkerHost-B_VpI68A.js' };
  const script = activeScript();
  monacoEditor = m.editor.create($('g-monaco'), {
    value: script?.type === 'code' ? script.code || '' : '',
    language: script?.language === 'typescript' ? 'typescript' : 'javascript',
    theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 12, lineHeight: 19,
    scrollBeyondLastLine: false, tabSize: 2, padding: { top: 8 },
  });
  monacoEditor.onDidChangeModelContent(() => {
    const current = activeScript();
    if (current?.type === 'code' && editable) { current.code = monacoEditor.getValue(); scheduleSave(); }
  });
  const ta = $('g-code');
  if (ta) ta.style.display = 'none';
}

/* ---------------- compile, play, export, publish ---------------- */

async function apiJson(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || `Request failed (${response.status})`); error.status = response.status; error.body = data; throw error; }
  return data;
}

function renderProblems(errors = [], warnings = []) {
  const host = $('g-problems');
  const count = $('g-problem-count');
  if (count) count.textContent = String(errors.length + warnings.length);
  if (!host) return;
  const all = [...errors.map((item) => ({ ...item, severity: 'error' })), ...warnings.map((item) => ({ ...item, severity: 'warning' }))];
  host.innerHTML = all.length ? all.map((item) => `<div class="log-line ${item.severity === 'warning' ? 'warn' : 'error'}"><time>${item.severity === 'warning' ? 'warn' : 'error'}</time><span>${esc(item.message)}${item.hint ? `<br /><small>${esc(item.hint)}</small>` : ''}</span></div>`).join('') : '<div class="gs-empty" style="color:#6ee7b7">No problems. The project compiles.</div>';
}

async function compileProject({ silent = false } = {}) {
  try {
    if (editable && workspace?.saveNow) await workspace.saveNow();
    const result = await apiJson(`/api/workspace/docs/${DOC.id}/game/compile`, { method: 'POST', body: JSON.stringify({ content: project }) });
    lastBuild = result;
    renderProblems(result.errors || [], result.warnings || []);
    const prof = $('g-prof-build');
    if (prof) prof.textContent = result.ok ? `scene: ${result.stats?.scenes || 0}\nobjects: ${result.stats?.entities || 0}\nscripts: ${result.stats?.scripts || 0}\nvisual nodes: ${result.stats?.visualNodes || 0}\nassets: ${result.stats?.assets || 0}\nprefabs: ${result.stats?.prefabs || 0}` : `Build failed\n${(result.errors || []).length} error(s)`;
    if (!result.ok) {
      setTab('problems');
      if (!silent) toast(`Build failed: ${(result.errors || [])[0]?.message || 'see Problems'}`, true);
      return result;
    }
    if (!silent) toast('Project compiled');
    return result;
  } catch (error) {
    renderProblems([{ message: error.message }], []);
    if (!silent) toast(error.message, true);
    return { ok: false, errors: [{ message: error.message }] };
  }
}

function logConsole(message, kind = 'log') {
  const host = $('g-console');
  if (!host) return;
  const empty = host.querySelector('.gs-empty');
  if (empty) empty.remove();
  const line = document.createElement('div');
  line.className = `log-line ${kind}`;
  line.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>${esc(message)}</span>`;
  host.append(line);
  host.scrollTop = host.scrollHeight;
  const count = $('g-console-count');
  if (count) count.textContent = String(Number(count.textContent || 0) + 1);
}

function setPlayingUI(on) {
  playing = on;
  $('g-play-overlay').hidden = !on;
  $('g-pause').disabled = !on;
  $('g-step').disabled = !on;
  $('g-stop').disabled = !on;
  $('g-play').innerHTML = on ? '▶ <span>Playing</span>' : '▶ <span>Play</span>';
  if (!on) { paused = false; $('g-pause').textContent = '⏸'; $('g-play-pause').textContent = 'Pause'; }
}

async function startPlay() {
  if (playing) return;
  const result = await compileProject({ silent: true });
  if (!result?.ok) return;
  try {
    const response = await fetch(`/api/workspace/docs/${DOC.id}/game/preview`, { headers: { accept: 'text/html' } });
    const html = await response.text();
    if (!response.ok) throw new Error(html.replace(/<[^>]+>/g, ' ').slice(0, 300) || 'Preview build failed');
    const frame = $('g-play-frame');
    frame.srcdoc = html;
    setPlayingUI(true);
    logConsole(`Play mode started (${project.mode.toUpperCase()} runtime).`);
    setTimeout(() => frame.focus(), 50);
  } catch (error) {
    logConsole(error.message, 'error');
    toast(error.message, true);
  }
}

function controlPlay(action) {
  const frame = $('g-play-frame');
  frame?.contentWindow?.postMessage({ type: `cascade-game:${action}` }, '*');
}

function stopPlay() {
  const frame = $('g-play-frame');
  if (frame) frame.srcdoc = '<!doctype html><body style="background:#050608"></body>';
  setPlayingUI(false);
  logConsole('Play mode stopped.');
}

function togglePause() {
  if (!playing) return;
  paused = !paused;
  controlPlay(paused ? 'pause' : 'resume');
  $('g-pause').textContent = paused ? '▶' : '⏸';
  $('g-play-pause').textContent = paused ? 'Resume' : 'Pause';
  $('g-play-stats').textContent = paused ? 'Paused' : 'Running the real runtime';
}

function stepFrame() {
  if (!playing) return;
  if (!paused) togglePause();
  controlPlay('step');
  logConsole('Stepped one frame.');
}

window.addEventListener('message', (event) => {
  const frame = $('g-play-frame');
  if (!frame || event.source !== frame.contentWindow) return;
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;
  const type = data.type.replace(/^cascade-game:/, '');
  if (type === 'console') logConsole(data.message, data.level === 'warn' ? 'warn' : data.level === 'error' ? 'error' : 'log');
  if (type === 'ready') { $('g-play-stats').textContent = 'Running · ' + (data.mode || project.mode).toUpperCase(); }
  if (type === 'paused') { paused = true; $('g-pause').textContent = '▶'; $('g-play-pause').textContent = 'Resume'; }
  if (type === 'resumed') { paused = false; $('g-pause').textContent = '⏸'; $('g-play-pause').textContent = 'Pause'; }
  if (type === 'profiler') {
    const sim = $('g-prof-sim');
    if (sim) sim.textContent = `runtime fps: ${data.fps || '—'}\nentities: ${data.entities || 0}\nphysics bodies: ${data.bodies || 0}\nscripts: ${data.scripts || 0}\nscript ms: ${data.scriptMs || 0}`;
  }
});

async function saveBeforeBuild() {
  if (!editable) return;
  try { await workspace?.saveNow?.(); } catch { /* save errors surface in the editor chrome */ }
}

async function exportGame(mode) {
  $('g-export-menu').hidden = true;
  const status = $('g-export-status');
  if (status) { status.className = 'gs-export-status'; status.textContent = 'Compiling project…'; }
  const result = await compileProject({ silent: true });
  if (!result?.ok) {
    if (status) { status.className = 'gs-export-status bad'; status.textContent = 'Build failed. Fix the Problems tab first.'; }
    return;
  }
  if (mode === 'publish') {
    try {
      const published = await apiJson(`/api/workspace/docs/${DOC.id}/publish`, { method: 'POST', body: JSON.stringify({ content: project }) });
      if (status) { status.className = 'gs-export-status ok'; status.innerHTML = `Published at <a href="${esc(published.url)}" target="_blank" rel="noopener">${esc(published.url)}</a>`; }
      const urlNode = $('g-publish-url');
      if (urlNode) { urlNode.textContent = published.url; urlNode.dataset.url = published.url; }
      toast('Game published');
      logConsole(`Published ${published.url}`);
    } catch (error) {
      if (status) { status.className = 'gs-export-status bad'; status.textContent = error.message; }
      toast(error.message, true);
    }
    return;
  }
  try {
    if (status) status.textContent = 'Building standalone game…';
    const response = await fetch(`/api/workspace/docs/${DOC.id}/game/export`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: project, mode: mode === 'html' ? 'html' : 'zip' }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Export failed');
    }
    const blob = await response.blob();
    const filename = (response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || `game.${mode === 'html' ? 'html' : 'zip'}`);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = decodeURIComponent(filename);
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (status) { status.className = 'gs-export-status ok'; status.textContent = `Exported ${anchor.download}. ${mode === 'html' ? 'Open it directly in a browser — no Cascade account needed.' : 'Unzip and open index.html.'}`; }
    logConsole(`Exported ${anchor.download}`);
    toast('Export ready');
  } catch (error) {
    if (status) { status.className = 'gs-export-status bad'; status.textContent = error.message; }
    toast(error.message, true);
  }
}

/* ---------------- wiring ---------------- */

$('g-play')?.addEventListener('click', startPlay);
$('g-pause')?.addEventListener('click', togglePause);
$('g-step')?.addEventListener('click', stepFrame);
$('g-stop')?.addEventListener('click', stopPlay);
$('g-play-pause')?.addEventListener('click', togglePause);
$('g-play-restart')?.addEventListener('click', () => { stopPlay(); setTimeout(startPlay, 30); });
$('g-play-exit')?.addEventListener('click', stopPlay);
$('g-fullscreen')?.addEventListener('click', () => { const overlay = $('g-play-overlay'); if (!overlay.hidden) overlay.requestFullscreen?.().catch(() => {}); else { $('g-viewport').requestFullscreen?.().catch(() => {}); } });
$('g-compile')?.addEventListener('click', () => compileProject());
$('g-export')?.addEventListener('click', (event) => { event.stopPropagation(); const menu = $('g-export-menu'); menu.hidden = !menu.hidden; const dialog = $('g-export-dialog'); if (dialog && !dialog.open) dialog.showModal(); });
$('g-export-menu')?.addEventListener('click', (event) => { const mode = event.target.closest('[data-export]')?.dataset.export; if (mode) { $('g-export-dialog')?.close(); exportGame(mode); } });
$('g-export-body')?.addEventListener('click', (event) => { const mode = event.target.closest('[data-export-do]')?.dataset.exportDo; if (mode) exportGame(mode); });
document.addEventListener('click', (event) => { if (!event.target.closest('.gs-menu-wrap')) { const menu = $('g-export-menu'); if (menu) menu.hidden = true; } });
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close)?.close()));
document.querySelectorAll('.gs-tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
document.querySelectorAll('[data-gizmo]').forEach((button) => button.addEventListener('click', () => {
  gizmoMode = button.dataset.gizmo;
  document.querySelectorAll('[data-gizmo]').forEach((el) => el.classList.toggle('on', el === button));
}));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('g-bottom-toggle')?.addEventListener('click', () => $('g-bottom')?.classList.toggle('collapsed'));
$('g-toggle-left')?.addEventListener('click', () => { const left = document.querySelector('.gs-left'); const right = document.querySelector('.gs-right'); left?.classList.toggle('open'); right?.classList.remove('open'); });
$('g-toggle-right')?.addEventListener('click', () => { const left = document.querySelector('.gs-left'); const right = document.querySelector('.gs-right'); right?.classList.toggle('open'); left?.classList.remove('open'); });
$('g-collapse-left')?.addEventListener('click', () => $('game-studio')?.classList.toggle('gs-collapse-left'));
$('g-inspector-mode') && ($('g-inspector-mode').textContent = 'Object');

window.addEventListener('keydown', (event) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || $('g-node-dialog')?.open || $('g-export-dialog')?.open) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.ctrlKey || event.metaKey) && key === 'd') { event.preventDefault(); duplicateSelection(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); compileProject(); return; }
  if (event.key === 'Delete' || event.key === 'Backspace') { if (selectedNodeId) deleteSelectedNode(); else if (selectedId) deleteSelection(); return; }
  if (key === 'f') { focusSelection(); return; }
  if (key === 'p' && !event.shiftKey) { startPlay(); return; }
  if (event.key === 'Escape' && playing) { stopPlay(); return; }
  if (key === 'w') { gizmoMode = 'move'; document.querySelectorAll('[data-gizmo]').forEach((el) => el.classList.toggle('on', el.dataset.gizmo === 'move')); }
  if (key === 'e') { gizmoMode = 'rotate'; document.querySelectorAll('[data-gizmo]').forEach((el) => el.classList.toggle('on', el.dataset.gizmo === 'rotate')); }
  if (key === 'r') { gizmoMode = 'scale'; document.querySelectorAll('[data-gizmo]').forEach((el) => el.classList.toggle('on', el.dataset.gizmo === 'scale')); }
});

new ResizeObserver(() => {
  if (project.mode === '3d') resize3D(); else resize2d();
  updateViewStats();
}).observe($('g-viewport'));

const saveWatcher = $('save-status');
if (saveWatcher) {
  new MutationObserver(() => { const note = $('g-save-note'); if (note) note.textContent = saveWatcher.textContent || 'Ready'; }).observe(saveWatcher, { childList: true, characterData: true, subtree: true });
}

if (!editable) {
  document.querySelectorAll('.gs-toolbar button, .gs-subhead button, .gs-tabs button').forEach((button) => { if (!['g-play', 'g-fullscreen', 'g-add-node', 'g-delete-node', 'g-export'].includes(button.id)) button.disabled = true; });
  $('g-play') && ($('g-play').disabled = false);
}

renderAll();
updateViewStats();
if (project.mode === '3d') { init3D(); setTimeout(resize3D, 20); } else setTimeout(resize2d, 20);
logConsole(`Cascade Game Studio ready · ${project.mode.toUpperCase()} · ${project.scenes.length} scene(s)`);



$('g-add-script')?.addEventListener('click', () => {
  if (!editable) return;
  pushHistory();
  const script = gameScript({ name: `Script ${project.scripts.length + 1}`, type: 'visual', trigger: 'update' });
  const event = graphNode('event.update', 60, 80);
  script.graph.nodes.push(event);
  project.scripts.push(script);
  selectedScriptId = script.id;
  selectedNodeId = null;
  changed({ rebuild: false, history: false });
  setTab('graph');
});
$('g-add')?.addEventListener('click', addObjectFromToolbar);
$('g-add-type')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addObjectFromToolbar(); } });
$('g-undo')?.addEventListener('click', undo);
$('g-redo')?.addEventListener('click', redo);
$('g-duplicate')?.addEventListener('click', duplicateSelection);
$('g-group')?.addEventListener('click', groupSelection);
$('g-delete')?.addEventListener('click', deleteSelection);
$('g-focus')?.addEventListener('click', focusSelection);
$('g-local-toggle')?.addEventListener('click', () => { localSpace = !localSpace; toast(localSpace ? 'Local space' : 'World space'); });
$('g-snap')?.addEventListener('change', (event) => { snapEnabled = event.target.checked; });
$('g-grid')?.addEventListener('change', (event) => { gridEnabled = event.target.checked; draw2D(); if (grid3) grid3.visible = gridEnabled; });
$('g-inspector-mode')?.addEventListener('click', () => {
  inspectorMode = inspectorMode === 'project' ? 'object' : 'project';
  $('g-inspector-mode').textContent = inspectorMode === 'project' ? 'Project' : 'Object';
  renderInspector();
});


