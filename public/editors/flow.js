/* Cascade Flow — visual Discord bot IDE.
   The graph is the source of truth. Every mutation goes through commit(), which
   schedules the shared autosave and the server-side compiler. */
import { NODE_LIBRARY, NODE_BY_TYPE, NODE_CATEGORIES, COMMAND_TYPES, EVENTS } from '/public/flow/nodes.mjs';
import { normalizeFlow, blankScript, flowId, SCRIPT_TYPES } from '/public/flow/schema.mjs';
import { scanFlowSecrets, redactFlowSecrets } from '/public/flow/secrets.mjs';

const $ = (id) => document.getElementById(id);
const DOC = window.__DOC__ || {};
const READONLY = window.__ACCESS__?.canEdit === false;
const wrap = $('flow-canvas-wrap');
const world = $('flow-world');
const edgesSvg = $('flow-edges');
const nodesEl = $('flow-nodes');
const fiBody = $('fi-body');
const consoleEl = $('flow-console');
const problemsEl = $('flow-problems');
const codeEl = $('flow-code');

let content = normalizeFlow(DOC.content || {});
let activeScriptId = content.scripts[0]?.id || null;
let selectedNodeId = null;
let selectedEdgeId = null;
let inspectorTab = 'node';
let view = { x: 72, y: 52, zoom: 1 };
let connecting = null;
let tempPath = null;
let ws = null;
let compileTimer = null;
let compileSeq = 0;
let compileState = null;
let dirty = false;
let history = [];
let future = [];
let clipboard = null;
let simLast = null;
let toastTimer = null;
let dragState = null;
let spaceDown = false;
let pinOffsets = new Map();
let edgePathEls = new Map();
let minimapFrame = 0;
let dragFrame = 0;
let suppressCanvasClick = false;
const collapsedFolders = new Set();
const consoleLines = [];

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeColor = (value) => /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? String(value) : '#f43f5e';
const activeScript = () => content.scripts.find((s) => s.id === activeScriptId) || content.scripts[0] || null;
const nodeById = (id) => activeScript()?.graph.nodes.find((n) => n.id === id) || null;
const customDefs = new Map();
const CUSTOM_PERMISSIONS = {
  'script.custom': 'unsafe-code', 'script.defineFunction': 'unsafe-code',
  'http.request': 'network', 'http.websocket': 'network', 'http.webhook': 'network', 'http.paginate': 'network',
  'db.set': 'database', 'db.get': 'database', 'db.delete': 'database', 'db.query': 'database',
  'db.aggregate': 'database', 'db.transaction': 'database', 'db.connect': 'database', 'db.schema': 'database', 'db.inspect': 'database',
  'ai.chat': 'ai', 'ai.json': 'ai', 'ai.tools': 'ai', 'ai.embed': 'ai', 'ai.image': 'ai', 'ai.moderation': 'ai', 'ai.memory': 'ai',
  'music.connect': 'voice', 'music.play': 'voice', 'music.search': 'voice', 'music.queue': 'voice',
  'music.join': 'voice', 'music.leave': 'voice', 'music.filter': 'voice', 'music.events': 'voice',
};
function rebuildCustomDefs() {
  customDefs.clear();
  for (const pkg of content.customNodes || []) {
    if (!pkg || pkg.enabled === false || typeof pkg.type !== 'string' || !pkg.type.startsWith('custom:')) continue;
    const base = NODE_BY_TYPE.get(pkg.base);
    if (!base || !base.operation || (base.special && base.special !== 'data')) continue;
    const required = CUSTOM_PERMISSIONS[base.operation];
    if (required && !(Array.isArray(pkg.permissions) && pkg.permissions.includes(required))) continue;
    const def = JSON.parse(JSON.stringify(base));
    def.type = pkg.type;
    def.title = String(pkg.title || base.title);
    def.category = 'Custom';
    def.color = safeColor(pkg.color || '#a855f7');
    def.custom = true;
    def.version = String(pkg.version || '1.0.0');
    def.description = `${def.title} · custom package ${def.version} (${base.title})`;
    customDefs.set(def.type, def);
  }
}
rebuildCustomDefs();
const defOf = (node) => (node ? customDefs.get(node.type) || NODE_BY_TYPE.get(node.type) : null);
const NODE_ICONS = {
  Events: 'zap', Commands: 'terminal', Messages: 'message-square', Components: 'mouse-pointer',
  Guild: 'users', Logic: 'git-branch', Data: 'database', Database: 'database', AI: 'sparkles',
  HTTP: 'globe', Music: 'music', Scripts: 'code', Runtime: 'settings', Testing: 'flask',
};
const nodeIcon = (def) => window.CascadeIcons?.svg(NODE_ICONS[def.category] || 'file-text') || esc(def.icon || 'N');
const scriptIcon = (s) => window.CascadeIcons?.svg(s.type === 'command' ? 'terminal' : s.type === 'event' ? 'zap' : s.type === 'module' ? 'box' : 'play') || '';
const isExec = (pin) => pin?.kind === 'exec';
const isDataOnly = (node) => {
  const def = defOf(node);
  return !!def && !def.inputs.some(isExec) && def.special !== 'entry' && !['comment', 'group'].includes(def.special);
};

function toast(message, bad = false) {
  let host = $('flow-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'flow-toast-host';
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `flow-toast${bad ? ' bad' : ''}`;
  el.textContent = message;
  host.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
  if (window.cascadeToast) window.cascadeToast(message, bad);
}

function setStatus(text, kind = '') {
  const el = $('flow-status');
  const label = $('flow-status-text');
  const appLabel = $('flow-app-status-text');
  if (appLabel) appLabel.textContent = text;
  if (label) label.textContent = text;
  if (el) el.className = `ft-status ${kind}`;
}

function setCompileStatus(text, kind = '') {
  const el = $('flow-compile-status');
  if (el) el.className = `ft-status ${kind}`;
  const label = $('flow-compile-text');
  if (label) label.textContent = text;
}

function snapshot() {
  try {
    history.push(JSON.stringify(content));
    if (history.length > 80) history.shift();
    future.length = 0;
  } catch {
    /* content is JSON-serializable by construction */
  }
}

function restoreSnapshot(raw) {
  content = normalizeFlow(JSON.parse(raw));
  if (!content.scripts.find((s) => s.id === activeScriptId)) activeScriptId = content.scripts[0]?.id || null;
  selectedNodeId = null;
  selectedEdgeId = null;
  renderAll();
  markDirty();
}

function undo() {
  if (!history.length) return toast('Nothing to undo', true);
  future.push(JSON.stringify(content));
  restoreSnapshot(history.pop());
}

function redo() {
  if (!future.length) return toast('Nothing to redo', true);
  history.push(JSON.stringify(content));
  restoreSnapshot(future.pop());
}

function markDirty() {
  dirty = true;
  ws?.schedule();
  clearTimeout(compileTimer);
  compileTimer = setTimeout(() => compile(true), 900);
}

function commit({ structural = true } = {}) {
  if (structural) renderExplorer();
  renderEdges();
  renderMinimap();
  markDirty();
}

function applyView() {
  if (!world) return;
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  const label = $('flow-zoom-label');
  if (label) label.textContent = `${Math.round(view.zoom * 100)}%`;
  // Edges live inside .flow-world and already use world coordinates, so moving
  // or zooming the camera only changes the world transform. Rebuilding every
  // edge here used to force layout on each pointermove and made panning stall.
  scheduleMinimap();
}

/* ------------------------------------------------------------------ explorer */
function renderExplorer() {
  const projectName = $('fe-project-name');
  if (projectName) projectName.textContent = content.project.name || 'My Discord Bot';
  const count = $('fe-project-count');
  if (count) count.textContent = `${content.scripts.length} scripts`;
  const tree = $('fe-tree');
  if (!tree) return;
  const query = String($('fe-search')?.value || '').toLowerCase();
  const visible = content.scripts.filter((s) => !query || s.name.toLowerCase().includes(query) || s.command?.name?.toLowerCase().includes(query));
  const folders = content.folders || [];
  const folderIds = new Set(folders.map((f) => f.id));
  let html = '';
  const scriptRow = (s) => `<div class="fe-script ${s.id === activeScriptId ? 'on' : ''} ${s.enabled === false ? 'off' : ''}" data-script="${esc(s.id)}" data-type="${esc(s.type)}" tabindex="0" role="button">
    <span class="fe-ico">${scriptIcon(s)}</span>
    <span class="fe-name">${esc(s.name)}</span>
    <span class="fe-kind">${esc(s.type === 'command' ? (s.command?.kind || 'slash') : s.type === 'event' ? s.event : s.type)}</span>
    <button class="fe-toggle ${s.enabled !== false ? 'on' : ''}" type="button" data-toggle-script="${esc(s.id)}" title="${s.enabled !== false ? 'Disable' : 'Enable'} script">✓</button>
  </div>`;
  for (const folder of folders) {
    const inFolder = visible.filter((s) => s.folder === folder.id);
    if (!inFolder.length && query) continue;
    const closed = collapsedFolders.has(folder.id);
    html += `<div class="fe-folder" data-folder-toggle="${esc(folder.id)}"><span>${closed ? '▸' : '▾'}</span><span>${esc(folder.name)}</span></div>`;
    if (!closed) html += inFolder.map(scriptRow).join('');
  }
  html += visible.filter((s) => !s.folder || !folderIds.has(s.folder)).map(scriptRow).join('');
  if (!html) html = '<div class="fi-empty" style="padding:14px">No scripts match.</div>';
  tree.innerHTML = html;

  tree.querySelectorAll('[data-script]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-toggle-script]')) return;
      activeScriptId = row.dataset.script;
      selectedNodeId = null;
      selectedEdgeId = null;
      inspectorTab = 'node';
      $('flow-shell')?.classList.remove('has-explorer');
      renderAll();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const script = content.scripts.find((s) => s.id === row.dataset.script);
      if (script) showScriptMenu(script, e.clientX, e.clientY);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
    });
  });
  tree.querySelectorAll('[data-toggle-script]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const script = content.scripts.find((s) => s.id === btn.dataset.toggleScript);
      if (!script || READONLY) return;
      snapshot();
      script.enabled = script.enabled === false;
      renderExplorer();
      markDirty();
    });
  });
  tree.querySelectorAll('[data-folder-toggle]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.folderToggle;
      if (collapsedFolders.has(id)) collapsedFolders.delete(id); else collapsedFolders.add(id);
      renderExplorer();
    });
  });
}

function showScriptMenu(script, x, y) {
  const old = $('flow-script-menu');
  old?.remove();
  const menu = document.createElement('div');
  menu.id = 'flow-script-menu';
  menu.style.cssText = `position:fixed;left:${Math.min(x, window.innerWidth - 180)}px;top:${Math.min(y, window.innerHeight - 190)}px;z-index:200;background:#17171d;border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:4px;min-width:160px;box-shadow:0 14px 34px rgba(0,0,0,.5)`;
  const add = (label, fn, danger = false) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = `display:block;width:100%;text-align:left;border:0;background:transparent;color:${danger ? '#fb7185' : '#d4d4da'};font:9px Inter,system-ui;padding:7px 8px;border-radius:3px;cursor:pointer`;
    btn.onmouseenter = () => { btn.style.background = '#22222a'; };
    btn.onmouseleave = () => { btn.style.background = 'transparent'; };
    btn.onclick = () => { menu.remove(); fn(); };
    menu.append(btn);
  };
  add('Rename…', () => {
    const name = prompt('Script name', script.name);
    if (name && name.trim() && !READONLY) { snapshot(); script.name = name.trim().slice(0, 80); commit(); }
  });
  add('Duplicate', () => {
    if (READONLY) return;
    snapshot();
    const copy = JSON.parse(JSON.stringify(script));
    copy.id = flowId('s');
    copy.name = `${script.name} copy`;
    copy.graph.nodes = copy.graph.nodes.map((n) => ({ ...n, id: flowId('n') }));
    content.scripts.push(copy);
    activeScriptId = copy.id;
    selectedNodeId = null;
    renderAll();
    markDirty();
  });
  add('Delete', () => {
    if (READONLY || content.scripts.length <= 1) return toast('Keep at least one script', true);
    if (!confirm(`Delete “${script.name}”?`)) return;
    snapshot();
    content.scripts = content.scripts.filter((s) => s.id !== script.id);
    if (activeScriptId === script.id) activeScriptId = content.scripts[0]?.id || null;
    renderAll();
    markDirty();
  }, true);
  document.body.append(menu);
  setTimeout(() => document.addEventListener('pointerdown', () => menu.remove(), { once: true }), 0);
}

/* -------------------------------------------------------------------- nodes */
function showContextMenu(items, x, y) {
  document.querySelector('.flow-context-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'flow-context-menu';
  menu.style.left = `${Math.min(x, window.innerWidth - 196)}px`;
  menu.style.top = `${Math.min(y, Math.max(8, window.innerHeight - items.length * 30 - 12))}px`;
  for (const item of items) {
    if (!item || item === '-') {
      const sep = document.createElement('div');
      sep.className = 'fcm-sep';
      menu.append(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `fcm-item${item.danger ? ' danger' : ''}`;
    btn.disabled = !!item.disabled;
    btn.innerHTML = `<span>${esc(item.label)}</span>${item.shortcut ? `<kbd>${esc(item.shortcut)}</kbd>` : ''}`;
    btn.addEventListener('click', () => { menu.remove(); item.action?.(); });
    menu.append(btn);
  }
  document.body.append(menu);
  setTimeout(() => document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target)) menu.remove();
  }, { once: true }), 0);
  return menu;
}

function addSpecialNode(type, worldX, worldY) {
  const script = activeScript();
  const def = defOf({ type });
  if (!script || !def || READONLY) return;
  snapshot();
  const node = { id: flowId('n'), type, x: Math.round(worldX), y: Math.round(worldY), config: type === 'group' ? { title: 'Group', width: 440, height: 280 } : { text: type === 'comment' ? 'Right-click the canvas to add comments.' : '' } };
  script.graph.nodes.push(node);
  selectedNodeId = node.id;
  selectedEdgeId = null;
  renderAll();
  markDirty();
}

function showCanvasMenu(x, y) {
  const worldPoint = screenToWorld(x, y);
  showContextMenu([
    { label: 'Add node…', shortcut: 'A', action: () => { libraryCategory = 'All'; libraryQuery = ''; if ($('library-search')) $('library-search').value = ''; renderLibrary(); openDialog('flow-library'); } },
    { label: 'Add comment', action: () => addSpecialNode('comment', worldPoint.x, worldPoint.y) },
    { label: 'Add group', action: () => addSpecialNode('group', worldPoint.x, worldPoint.y) },
    { label: 'Paste node', shortcut: 'Ctrl+V', disabled: !clipboard || READONLY, action: () => {
      const copy = { ...JSON.parse(JSON.stringify(clipboard)), id: flowId('n'), x: Math.round(worldPoint.x), y: Math.round(worldPoint.y) };
      snapshot();
      activeScript()?.graph.nodes.push(copy);
      selectedNodeId = copy.id;
      renderAll();
      markDirty();
    } },
    '-',
    { label: 'Fit graph', shortcut: 'F', action: fitView },
    { label: 'Auto layout', action: autoLayout, disabled: !!READONLY },
  ], x, y);
}

function showNodeMenu(node, x, y) {
  const script = activeScript();
  const incoming = script ? script.graph.edges.filter((edge) => edge.to.node === node.id).length : 0;
  const outgoing = script ? script.graph.edges.filter((edge) => edge.from.node === node.id).length : 0;
  showContextMenu([
    { label: 'Duplicate', shortcut: 'Ctrl+D', action: duplicateSelectedNode, disabled: !!READONLY },
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => { clipboard = JSON.parse(JSON.stringify(node)); toast('Node copied'); } },
    '-',
    { label: `Disconnect inputs${incoming ? ` (${incoming})` : ''}`, disabled: !incoming || !!READONLY, action: () => {
      snapshot();
      script.graph.edges = script.graph.edges.filter((edge) => edge.to.node !== node.id);
      renderAll(); markDirty();
    } },
    { label: `Disconnect outputs${outgoing ? ` (${outgoing})` : ''}`, disabled: !outgoing || !!READONLY, action: () => {
      snapshot();
      script.graph.edges = script.graph.edges.filter((edge) => edge.from.node !== node.id);
      renderAll(); markDirty();
    } },
    '-',
    { label: 'Delete node', danger: true, action: () => { selectedNodeId = node.id; deleteSelectedNode(); }, disabled: !!READONLY },
  ], x, y);
}

function showEdgeMenu(edge, x, y) {
  const script = activeScript();
  showContextMenu([
    { label: 'Select source node', action: () => { selectedNodeId = edge.from.node; selectedEdgeId = null; inspectorTab = 'node'; renderAll(); } },
    { label: 'Select target node', action: () => { selectedNodeId = edge.to.node; selectedEdgeId = null; inspectorTab = 'node'; renderAll(); } },
    '-',
    { label: 'Delete connection', danger: true, disabled: !!READONLY, action: () => {
      snapshot();
      script.graph.edges = script.graph.edges.filter((item) => item.id !== edge.id);
      selectedEdgeId = null;
      renderAll(); markDirty();
    } },
  ], x, y);
}

function showPinMenu(info, x, y) {
  const script = activeScript();
  const count = script ? script.graph.edges.filter((edge) => (info.side === 'in'
    ? edge.to.node === info.node.id && edge.to.pin === info.pin.id
    : edge.from.node === info.node.id && edge.from.pin === info.pin.id)).length : 0;
  showContextMenu([
    { label: info.side === 'in' ? 'Disconnect this input' : 'Disconnect this output', danger: true, disabled: !count || !!READONLY, action: () => {
      snapshot();
      script.graph.edges = script.graph.edges.filter((edge) => (info.side === 'in'
        ? !(edge.to.node === info.node.id && edge.to.pin === info.pin.id)
        : !(edge.from.node === info.node.id && edge.from.pin === info.pin.id)));
      renderAll(); markDirty();
    } },
    { label: 'Connect from here', disabled: !!READONLY, action: () => { selectedNodeId = info.node.id; renderNodes(); const el = sourcePin(info.node.id, info.pin.id, info.side); if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0 })); } },
  ], x, y);
}

function renderNodes() {
  const script = activeScript();
  if (!script) {
    nodesEl.innerHTML = '';
    return;
  }
  const selected = selectedNodeId;
  nodesEl.innerHTML = script.graph.nodes.map((node) => {
    const def = defOf(node);
    if (!def) {
      return `<div class="flow-node selected" data-id="${esc(node.id)}" style="left:${Number(node.x) || 0}px;top:${Number(node.y) || 0}px;border-color:#f43f5e"><div class="fn-head"><span class="fn-ico">!</span><span class="fn-title">Unknown: ${esc(node.type)}</span></div><div class="fn-text">Remove this node or install its custom package.</div></div>`;
    }
    if (def.special === 'comment') {
      return `<div class="flow-node special-comment ${selected === node.id ? 'selected' : ''}" data-id="${esc(node.id)}" style="left:${Number(node.x) || 0}px;top:${Number(node.y) || 0}px"><div class="fn-text">${esc(node.config?.text || 'Comment')}</div></div>`;
    }
    if (def.special === 'group') {
      const width = Math.max(240, Number(node.config?.width) || 440);
      const height = Math.max(140, Number(node.config?.height) || 280);
      return `<div class="flow-node special-group ${selected === node.id ? 'selected' : ''}" data-id="${esc(node.id)}" style="left:${Number(node.x) || 0}px;top:${Number(node.y) || 0}px;width:${width}px;height:${height}px"><div class="fn-group-title">${esc(node.config?.title || 'Group')}</div></div>`;
    }
    const inputs = (def.inputs || []).map((pin) => pinHtml(node, pin, 'in')).join('');
    const outputs = (def.outputs || []).map((pin) => pinHtml(node, pin, 'out')).join('');
    const summary = nodeSummary(node, def);
    return `<div class="flow-node ${selected === node.id ? 'selected' : ''}" data-id="${esc(node.id)}" style="left:${Number(node.x) || 0}px;top:${Number(node.y) || 0}px;width:${def.width || 230}px;--node-color:${safeColor(def.color)}">
      <div class="fn-head"><span class="fn-ico">${nodeIcon(def)}</span><span class="fn-title">${esc(def.title)}</span><span class="fn-badge">${esc(def.category)}</span></div>
      <div class="fn-body"><div class="fn-col in">${inputs}</div><div class="fn-col out">${outputs}</div></div>
      ${summary ? `<div class="fn-summary">${esc(summary)}</div>` : ''}
    </div>`;
  }).join('');
  $('flow-empty').hidden = script.graph.nodes.length > 0;
  requestAnimationFrame(() => renderEdges());
}

function pinHtml(node, pin, side) {
  const kind = pin.kind === 'exec' ? 'exec' : 'data';
  return `<div class="flow-pin ${side} ${kind}" data-node="${esc(node.id)}" data-pin="${esc(pin.id)}" data-side="${side}" data-type="${esc(pin.type)}" data-kind="${esc(pin.kind)}" title="${esc(pin.label || pin.id)} · ${esc(pin.type)}">
    ${side === 'in' ? '<span class="pin-dot"></span>' : ''}
    <span class="pin-label">${esc(pin.label || pin.id)}</span>
    ${side === 'out' ? '<span class="pin-dot"></span>' : ''}
  </div>`;
}

function nodeSummary(node, def) {
  const c = node.config || {};
  if (def.special === 'entry') return '';
  if (def.type === 'text') return String(c.value || '').slice(0, 48);
  if (def.type === 'command-respond' || def.type === 'message-send' || def.type === 'message-reply') return String(c.content || '').slice(0, 58);
  if (def.type === 'template') return String(c.template || '').slice(0, 58);
  if (c.name) return `${c.name}`;
  if (c.collection) return `collection: ${c.collection}`;
  if (c.question) return String(c.question).slice(0, 58);
  if (c.title) return String(c.title).slice(0, 58);
  if (c.url) return String(c.url).slice(0, 58);
  return '';
}

function nodeBounds() {
  const script = activeScript();
  if (!script) return null;
  const nodes = script.graph.nodes;
  if (!nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const def = defOf(n);
    if (!def) continue;
    const w = def.special === 'group' ? Number(n.config?.width) || 440 : def.width || 230;
    minX = Math.min(minX, Number(n.x) || 0);
    minY = Math.min(minY, Number(n.y) || 0);
    maxX = Math.max(maxX, (Number(n.x) || 0) + w);
    maxY = Math.max(maxY, (Number(n.y) || 0) + 150);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function measurePinOffsets() {
  pinOffsets = new Map();
  for (const nodeEl of nodesEl.querySelectorAll('.flow-node')) {
    const nodeId = nodeEl.dataset.id;
    if (!nodeId) continue;
    const nodeRect = nodeEl.getBoundingClientRect();
    nodeEl.querySelectorAll('.flow-pin').forEach((pin) => {
      const dot = pin.querySelector('.pin-dot') || pin;
      const rect = dot.getBoundingClientRect();
      pinOffsets.set(`${nodeId}:${pin.dataset.side}:${pin.dataset.pin}`, {
        x: (rect.left + rect.width / 2 - nodeRect.left) / view.zoom,
        y: (rect.top + rect.height / 2 - nodeRect.top) / view.zoom,
      });
    });
  }
}

function pinWorldPos(nodeId, side, pinId) {
  const node = nodeById(nodeId);
  const offset = pinOffsets.get(`${nodeId}:${side}:${pinId}`);
  if (!node || !offset) return null;
  return { x: (Number(node.x) || 0) + offset.x, y: (Number(node.y) || 0) + offset.y };
}

function edgePathD(a, b) {
  const dx = Math.max(42, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function renderEdges() {
  if (!edgesSvg) return;
  const script = activeScript();
  edgesSvg.innerHTML = '';
  edgePathEls = new Map();
  if (!script) return;
  measurePinOffsets();
  const bounds = nodeBounds();
  edgesSvg.style.width = `${Math.max(4000, (bounds?.maxX || 0) + 500)}px`;
  edgesSvg.style.height = `${Math.max(3000, (bounds?.maxY || 0) + 500)}px`;
  const ns = 'http://www.w3.org/2000/svg';
  for (const edge of script.graph.edges) {
    const a = pinWorldPos(edge.from.node, 'out', edge.from.pin);
    const b = pinWorldPos(edge.to.node, 'in', edge.to.pin);
    if (!a || !b) continue;
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', edgePathD(a, b));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', edge.kind === 'exec' ? '#f43f5e' : '#64748b');
    path.setAttribute('stroke-width', selectedEdgeId === edge.id ? '2.4' : edge.kind === 'exec' ? '1.7' : '1.3');
    path.setAttribute('opacity', edge.kind === 'exec' ? '0.92' : '0.72');
    path.setAttribute('data-edge', edge.id);
    path.style.cursor = 'pointer';
    path.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedEdgeId = edge.id;
      selectedNodeId = null;
      inspectorTab = 'node';
      renderNodes();
      renderInspector();
      renderEdges();
    });
    edgePathEls.set(edge.id, path);
    edgesSvg.append(path);
  }
  if (selectedEdgeId && !script.graph.edges.some((e) => e.id === selectedEdgeId)) selectedEdgeId = null;
}

function updateNodeEdges(nodeId) {
  const script = activeScript();
  if (!script) return;
  for (const edge of script.graph.edges) {
    if (edge.from.node !== nodeId && edge.to.node !== nodeId) continue;
    const path = edgePathEls.get(edge.id);
    if (!path) continue;
    const a = pinWorldPos(edge.from.node, 'out', edge.from.pin);
    const b = pinWorldPos(edge.to.node, 'in', edge.to.pin);
    if (a && b) path.setAttribute('d', edgePathD(a, b));
  }
}

function scheduleMinimap() {
  if (minimapFrame) return;
  minimapFrame = requestAnimationFrame(() => {
    minimapFrame = 0;
    renderMinimap();
  });
}

function renderMinimap() {
  const svg = $('flow-minimap-svg');
  if (!svg) return;
  const script = activeScript();
  const bounds = nodeBounds();
  if (!script || !bounds) { svg.innerHTML = ''; return; }
  const pad = 50;
  const w = Math.max(1, bounds.maxX - bounds.minX + pad * 2);
  const h = Math.max(1, bounds.maxY - bounds.minY + pad * 2);
  const scale = Math.min(150 / w, 92 / h);
  const ox = (150 - w * scale) / 2 - (bounds.minX - pad) * scale;
  const oy = (92 - h * scale) / 2 - (bounds.minY - pad) * scale;
  const items = script.graph.nodes.map((n) => {
    const def = defOf(n);
    const width = def?.width || 230;
    return `<rect x="${ox + (Number(n.x) || 0) * scale}" y="${oy + (Number(n.y) || 0) * scale}" width="${Math.max(2, width * scale)}" height="${Math.max(2, 34 * scale)}" rx="1" fill="${n.id === selectedNodeId ? '#f43f5e' : '#3f3f46'}" opacity=".85"/>`;
  }).join('');
  const vr = wrap.getBoundingClientRect();
  const viewX = (-view.x / view.zoom - (bounds.minX - pad)) * scale + ox;
  const viewY = (-view.y / view.zoom - (bounds.minY - pad)) * scale + oy;
  const viewW = (vr.width / view.zoom) * scale;
  const viewH = (vr.height / view.zoom) * scale;
  svg.innerHTML = `${items}<rect class="mm-view" x="${viewX}" y="${viewY}" width="${Math.max(4, viewW)}" height="${Math.max(4, viewH)}" rx="2"/>`;
}

/* ------------------------------------------------------------------- edges */
function sourcePin(nodeId, pinId, side) {
  return nodesEl.querySelector(`.flow-pin[data-node="${CSS.escape(nodeId)}"][data-side="${side}"][data-pin="${CSS.escape(pinId)}"]`);
}

function screenToWorld(clientX, clientY) {
  const r = wrap.getBoundingClientRect();
  return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom };
}

function compatible(from, to) {
  const a = String(from || 'any').toLowerCase(), b = String(to || 'any').toLowerCase();
  return a === b || a === 'any' || b === 'any' || a === 'json' || b === 'json' || (a === 'number' && b === 'string') || (a === 'string' && b === 'number');
}

function pinElInfo(el) {
  if (!el?.dataset?.node) return null;
  const node = nodeById(el.dataset.node);
  const def = defOf(node);
  if (!node || !def) return null;
  const side = el.dataset.side === 'in' ? 'in' : 'out';
  const pin = (side === 'out' ? def.outputs : def.inputs || []).find((p) => p.id === el.dataset.pin);
  if (!pin) return null;
  return { el, node, def, side, pin };
}

function pinCenterWorld(el) {
  const dot = el.querySelector('.pin-dot') || el;
  const r = dot.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  return { x: (r.left + r.width / 2 - wr.left - view.x) / view.zoom, y: (r.top + r.height / 2 - wr.top - view.y) / view.zoom };
}

function compatiblePin(from, to) {
  return from.kind === to.kind && compatible(from.type, to.type);
}

/** Prefer an exact pin under the cursor, then the nearest compatible pin on the
 *  node body. Dropping anywhere on the target node is a much larger target than
 *  the 8px connector dot. */
function resolveDropPin(ev, source) {
  const under = document.elementFromPoint(ev.clientX, ev.clientY);
  const direct = under?.closest('.flow-pin');
  if (direct) return direct;
  const nodeEl = under?.closest('.flow-node');
  if (!nodeEl || nodeEl.dataset.id === source.node.id) return null;
  const wanted = source.side === 'out' ? 'in' : 'out';
  const candidates = [...nodeEl.querySelectorAll(`.flow-pin[data-side="${wanted}"]`)]
    .map(pinElInfo)
    .filter((entry) => entry && compatiblePin(source.pin, entry.pin));
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const dot = candidate.el.querySelector('.pin-dot') || candidate.el;
    const r = dot.getBoundingClientRect();
    const distance = Math.hypot(r.left + r.width / 2 - ev.clientX, r.top + r.height / 2 - ev.clientY);
    if (distance < bestDistance) { bestDistance = distance; best = candidate; }
  }
  return best.el;
}

function tryConnect(targetEl, source = connecting ? pinElInfo(connecting.el) : null) {
  const target = pinElInfo(targetEl);
  if (!source || !target) return false;
  if (source.side === target.side) { toast('Connect an output pin to an input pin', true); return false; }
  if (source.node.id === target.node.id) { toast('A node cannot connect to itself', true); return false; }
  const from = source.side === 'out' ? source : target;
  const to = source.side === 'out' ? target : source;
  if (from.pin.kind !== to.pin.kind) {
    toast(from.pin.kind === 'exec' ? 'Execution pins connect only to execution pins' : 'Data pins connect only to data pins', true);
    return false;
  }
  if (!compatible(from.pin.type, to.pin.type)) {
    toast(`Type mismatch: ${from.pin.type} → ${to.pin.type}. Insert Convert Type.`, true);
    return false;
  }
  const script = activeScript();
  if (!script) return false;
  const duplicate = script.graph.edges.some((e) => e.from.node === from.node.id && e.from.pin === from.pin.id && e.to.node === to.node.id && e.to.pin === to.pin.id);
  snapshot();
  // One incoming connection per input pin; exec outputs may fan out.
  script.graph.edges = script.graph.edges.filter((e) => !(e.to.node === to.node.id && e.to.pin === to.pin.id));
  if (!duplicate) {
    script.graph.edges.push({ id: flowId('w'), from: { node: from.node.id, pin: from.pin.id }, to: { node: to.node.id, pin: to.pin.id }, kind: from.pin.kind === 'exec' ? 'exec' : 'data' });
  }
  selectedEdgeId = null;
  selectedNodeId = to.node.id;
  renderAll();
  markDirty();
  toast(duplicate ? 'Already connected' : `Connected ${from.pin.label || from.pin.id} → ${to.pin.label || to.pin.id}`);
  return true;
}

function cancelConnection() {
  tempPath?.remove();
  tempPath = null;
  connecting = null;
  wrap.classList.remove('connecting', 'connecting-armed');
  document.querySelectorAll('.flow-pin.target-ok,.flow-pin.target-bad').forEach((el) => el.classList.remove('target-ok', 'target-bad'));
}

function startConnection(e, pinEl) {
  if (READONLY || (e.button !== undefined && e.button !== 0)) return;
  e.preventDefault();
  e.stopPropagation();
  // A click (rather than a drag) on the first pin keeps the pending connection
  // armed, so clicking the second pin also connects.
  if (connecting) {
    const source = pinElInfo(connecting.el);
    const target = pinElInfo(pinEl);
    if (source && target && target.side !== source.side && target.node.id !== source.node.id) {
      if (tryConnect(pinEl, source)) cancelConnection();
      return;
    }
  }
  const source = pinElInfo(pinEl);
  if (!source) return;
  cancelConnection();
  connecting = { el: pinEl, node: { id: source.node.id }, side: source.side };
  wrap.classList.add('connecting');
  tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tempPath.setAttribute('class', 'flow-temp-edge');
  tempPath.setAttribute('fill', 'none');
  edgesSvg.append(tempPath);
  const startX = e.clientX, startY = e.clientY;
  const draw = (ev) => {
    const live = connecting && pinElInfo(connecting.el);
    if (!live) return;
    const a = pinCenterWorld(live.el);
    const b = screenToWorld(ev.clientX, ev.clientY);
    tempPath?.setAttribute('d', live.side === 'out' ? edgePathD(a, b) : edgePathD(b, a));
    document.querySelectorAll('.flow-pin.target-ok,.flow-pin.target-bad').forEach((el) => el.classList.remove('target-ok', 'target-bad'));
    const hitEl = resolveDropPin(ev, live);
    if (hitEl) {
      const hit = pinElInfo(hitEl);
      hitEl.classList.add(hit && hit.node.id !== live.node.id && compatiblePin(live.pin, hit.pin) ? 'target-ok' : 'target-bad');
    }
  };
  const move = (ev) => { draw(ev); };
  const up = (ev) => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    const live = connecting && pinElInfo(connecting.el);
    if (!live) { cancelConnection(); return; }
    const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4;
    const hitEl = resolveDropPin(ev, live);
    if (hitEl && tryConnect(hitEl, live)) { cancelConnection(); return; }
    if (hitEl) {
      // Keep the connection armed so the user can pick another target.
      tempPath?.remove();
      tempPath = null;
      wrap.classList.add('connecting-armed');
      return;
    }
    if (!moved) {
      tempPath?.remove();
      tempPath = null;
      wrap.classList.add('connecting-armed');
      toast('Now click an input pin to finish the connection');
      return;
    }
    cancelConnection();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
}

function startNodeDrag(e, nodeEl) {
  if (READONLY) return;
  const node = nodeById(nodeEl.dataset.id);
  if (!node) return;
  e.preventDefault();
  e.stopPropagation();
  selectedNodeId = node.id;
  selectedEdgeId = null;
  inspectorTab = 'node';
  $('flow-shell')?.classList.remove('has-explorer');
  $('flow-shell')?.classList.add('has-inspector');
  // Update the selection in place. Re-rendering the whole node layer here used
  // to detach this node from the DOM, so dragging changed data without moving
  // anything on screen.
  for (const el of nodesEl.querySelectorAll('.flow-node')) el.classList.toggle('selected', el.dataset.id === node.id);
  renderInspector();
  const start = { x: e.clientX, y: e.clientY, nx: Number(node.x) || 0, ny: Number(node.y) || 0 };
  dragState = { node, start, el: nodeEl };
  nodeEl.classList.add('dragging');
  let moved = false;
  const paint = () => {
    dragFrame = 0;
    if (!dragState) return;
    nodeEl.style.transform = `translate(${node.x - start.nx}px, ${node.y - start.ny}px)`;
    updateNodeEdges(node.id);
  };
  const move = (ev) => {
    if (!dragState) return;
    const nx = Math.round(start.nx + (ev.clientX - start.x) / view.zoom);
    const ny = Math.round(start.ny + (ev.clientY - start.y) / view.zoom);
    if (!moved && (Math.abs(nx - start.nx) > 1 || Math.abs(ny - start.ny) > 1)) {
      snapshot();
      moved = true;
    }
    node.x = nx;
    node.y = ny;
    if (!dragFrame) dragFrame = requestAnimationFrame(paint);
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    if (dragFrame) { cancelAnimationFrame(dragFrame); dragFrame = 0; }
    nodeEl.classList.remove('dragging');
    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
    nodeEl.style.transform = '';
    if (moved) {
      updateNodeEdges(node.id);
      renderEdges();
      scheduleMinimap();
      markDirty();
    }
    dragState = null;
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
}

function startPan(e) {
  if (connecting) cancelConnection();
  if (e.button !== 0 && e.button !== 1) return;
  if (e.target.closest('.flow-node, .flow-pin, .flow-edges path, .flow-minimap, .flow-canvas-hud, .flow-btn')) return;
  e.preventDefault();
  wrap.classList.add('panning');
  const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  let moved = false;
  const move = (ev) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    view.x = start.vx + dx;
    view.y = start.vy + dy;
    applyView();
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    wrap.classList.remove('panning');
    if (moved) suppressCanvasClick = true;
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
}

/* --------------------------------------------------------------- inspector */
function fieldHtml(field, value, scope, ownerId) {
  const id = `${scope}-${ownerId}-${field.key}`.replace(/[^a-z0-9_-]/gi, '-');
  const val = value !== undefined ? value : field.default;
  const common = `data-field-scope="${scope}" data-owner-id="${esc(ownerId)}" data-field-key="${esc(field.key)}" id="${id}"`;
  let control = '';
  if (field.type === 'textarea') control = `<textarea ${common} rows="${field.rows || 3}">${esc(val ?? '')}</textarea>`;
  else if (field.type === 'checkbox') control = `<label class="fi-check"><input type="checkbox" ${common} ${val ? 'checked' : ''}/> ${esc(field.label)}</label>`;
  else if (field.type === 'select') control = `<select ${common}>${(field.options || []).map((o) => `<option value="${esc(o)}" ${String(val) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (field.type === 'json') {
    const text = val === undefined ? '' : typeof val === 'string' ? val : JSON.stringify(val, null, 2);
    control = `<textarea ${common} data-json="1" rows="${field.rows || 4}" spellcheck="false">${esc(text)}</textarea>`;
  } else if (field.type === 'color') control = `<input type="color" ${common} value="${esc(val || '#e11d48')}"/>`;
  else if (field.type === 'number') control = `<input type="number" ${common} value="${esc(val ?? '')}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''}/>`;
  else control = `<input type="text" ${common} value="${esc(val ?? '')}" placeholder="${esc(field.placeholder || '')}"/>`;
  return `<div class="fi-field"><label for="${id}">${esc(field.label)}</label>${control}${field.help ? `<div class="fi-help">${esc(field.help)}</div>` : ''}${field.warn ? `<div class="fi-note">${esc(field.warn)}</div>` : ''}</div>`;
}

function pinValueControl(node, pin, value, disabled) {
  const id = `pin-${node.id}-${pin.id}`.replace(/[^a-z0-9_-]/gi, '-');
  const common = `data-pin-value="1" data-pin-owner="${esc(node.id)}" data-pin-key="${esc(pin.id)}" data-pin-type="${esc(pin.type)}" id="${id}" ${disabled ? 'disabled' : ''}`;
  if (pin.type === 'boolean') {
    return `<label class="fi-check"><input type="checkbox" ${common} ${value ? 'checked' : ''}/> ${value ? 'true' : 'false'}</label>`;
  }
  if (pin.type === 'number') return `<input type="number" step="any" ${common} value="${esc(value ?? '')}" placeholder="0" />`;
  if (pin.type === 'json') {
    const text = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return `<textarea ${common} rows="3" spellcheck="false" placeholder='{"key": "value"}'>${esc(text)}</textarea>`;
  }
  return `<input type="text" ${common} value="${esc(value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : value)}" placeholder="${pin.type === 'any' ? 'Type text or JSON…' : 'Type a value…'}" />`;
}

function pinValueRow(node, pin, edge, duplicateField) {
  const connected = !!edge;
  const sourceNode = edge ? nodeById(edge.from.node) : null;
  const sourceDef = sourceNode ? defOf(sourceNode) : null;
  const sourceLabel = sourceNode ? `${sourceDef?.title || sourceNode.type} › ${edge.from.pin}` : '';
  return `<div class="fi-pin-row${connected ? ' is-connected' : ''}">
    <div class="fi-pin-head"><span>${esc(pin.label || pin.id)}</span><span class="fi-pin-type">${esc(pin.type)}</span><span class="fi-pin-badge${connected ? ' on' : ''}">${connected ? 'connected' : 'value'}</span></div>
    ${connected ? `<div class="fi-pin-source">From <b>${esc(sourceLabel)}</b><button class="flow-btn mini ghost" type="button" data-pin-disconnect="${esc(pin.id)}">Disconnect</button></div>` : ''}
    ${duplicateField ? '<div class="fi-help">This pin is configured under Configuration.</div>' : pinValueControl(node, pin, node.config?.[pin.id], connected)}
    ${!connected && !duplicateField ? '<div class="fi-help">Type a literal here, or drag this pin to a matching output.</div>' : ''}
  </div>`;
}

function parsePinValue(raw, type) {
  if (type === 'boolean') return !!raw;
  if (type === 'number') return raw === '' ? 0 : Number(raw) || 0;
  if (type === 'string') return String(raw ?? '');
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try { return JSON.parse(text); } catch { return text; }
}

function renderInspector() {
  if (!fiBody) return;
  if (inspectorTab === 'node' && !selectedNodeId && !selectedEdgeId) inspectorTab = 'script';
  document.querySelectorAll('.fi-tab').forEach((tab) => tab.classList.toggle('on', tab.dataset.fi === inspectorTab));
  if (inspectorTab === 'project') return renderProjectInspector();
  if (inspectorTab === 'script') return renderScriptInspector();
  if (selectedNodeId) {
    const node = nodeById(selectedNodeId);
    const def = defOf(node);
    if (node && def) {
            const edgesInto = new Map((activeScript()?.graph.edges || []).filter((e) => e.to.node === node.id).map((e) => [e.to.pin, e]));
      const inputs = (def.inputs || []).filter((pin) => pin.kind !== 'exec');
      const fieldKeys = new Set((def.fields || []).map((f) => f.key));
      const inputFields = inputs.map((pin) => pinValueRow(node, pin, edgesInto.get(pin.id), fieldKeys.has(pin.id))).join('');
      fiBody.innerHTML = `<div class="fi-node-title"><span class="fn-ico" style="background:${safeColor(def.color)}22;color:${safeColor(def.color)}">${nodeIcon(def)}</span><div><b>${esc(def.title)}</b><small>${esc(def.category)} · ${esc(node.id)}</small></div></div>
        <p class="fi-desc">${esc(def.description || 'No description for this node.')}</p>
        ${inputFields ? `<div class="fi-section"><b>Inputs</b>${inputFields}</div>` : ''}
        <div class="fi-section"><b>Configuration</b>${(def.fields || []).map((f) => fieldHtml(f, node.config?.[f.key], 'node', node.id)).join('') || '<div class="fi-empty">This node has no configurable fields.</div>'}</div>
        <div class="fi-actions"><button class="flow-btn mini" type="button" id="fi-duplicate">Duplicate</button><button class="flow-btn mini" type="button" id="fi-disconnect">Disconnect</button><button class="flow-btn mini" type="button" id="fi-delete" style="color:#fb7185">Delete</button></div>`;
      $('fi-delete')?.addEventListener('click', deleteSelectedNode);
      $('fi-duplicate')?.addEventListener('click', duplicateSelectedNode);
      $('fi-disconnect')?.addEventListener('click', () => {
        const s = activeScript();
        if (!s) return;
        snapshot();
        s.graph.edges = s.graph.edges.filter((e) => e.from.node !== node.id && e.to.node !== node.id);
        commit();
      });
      return;
    }
    selectedNodeId = null;
  }
  if (selectedEdgeId) {
    const script = activeScript();
    const edge = script?.graph.edges.find((e) => e.id === selectedEdgeId);
    if (edge) {
      const from = nodeById(edge.from.node), to = nodeById(edge.to.node);
      fiBody.innerHTML = `<div class="fi-node-title"><span class="fn-ico">${window.CascadeIcons?.svg('arrow-left-right') || '→'}</span><div><b>Connection</b><small>${esc(edge.kind)} · ${esc(edge.id)}</small></div></div>
        <p class="fi-desc">${esc(defOf(from)?.title || from?.type)} → ${esc(defOf(to)?.title || to?.type)}</p>
        <div class="fi-section"><b>Pins</b><div class="fi-chiprow"><span class="fi-chip">${esc(edge.from.pin)}</span><span class="fi-chip">${esc(edge.to.pin)}</span></div></div>
        <div class="fi-actions"><button class="flow-btn mini" type="button" id="fi-delete-edge" style="color:#fb7185">Delete connection</button></div>`;
      $('fi-delete-edge')?.addEventListener('click', () => {
        snapshot();
        script.graph.edges = script.graph.edges.filter((e) => e.id !== edge.id);
        selectedEdgeId = null;
        renderAll();
        markDirty();
      });
      return;
    }
    selectedEdgeId = null;
  }
  renderScriptInspector();
}

function renderScriptInspector() {
  const s = activeScript();
  if (!s) { fiBody.innerHTML = '<div class="fi-empty">Create a script to begin.</div>'; return; }
  const isCommand = s.type === 'command';
  const eventOptions = [...Object.keys(EVENTS), 'raw', 'custom'];
  fiBody.innerHTML = `<div class="fi-node-title"><span class="fn-ico">${scriptIcon(s)}</span><div><b>${esc(s.name)}</b><small>${esc(s.type)} · ${esc(s.id)}</small></div></div>
    <div class="fi-section"><b>Script</b>
      ${fieldHtml({ key: 'name', label: 'Name', type: 'text' }, s.name, 'script', s.id)}
      ${fieldHtml({ key: 'type', label: 'Type', type: 'select', options: SCRIPT_TYPES }, s.type, 'script', s.id)}
      ${fieldHtml({ key: 'enabled', label: 'Enabled', type: 'checkbox' }, s.enabled !== false, 'script', s.id)}
      ${fieldHtml({ key: 'folder', label: 'Folder id', type: 'text', placeholder: 'root' }, s.folder || '', 'script', s.id)}
      ${s.type === 'event' ? fieldHtml({ key: 'event', label: 'Gateway event', type: 'select', options: eventOptions }, s.event, 'script', s.id) : ''}
    </div>
    ${isCommand ? `<div class="fi-section"><b>Command</b>
      ${fieldHtml({ key: 'command.name', label: 'Command name', type: 'text' }, s.command?.name, 'script', s.id)}
      ${fieldHtml({ key: 'command.description', label: 'Description', type: 'text' }, s.command?.description, 'script', s.id)}
      ${fieldHtml({ key: 'command.kind', label: 'Command type', type: 'select', options: ['slash', 'prefix', 'user', 'message'] }, s.command?.kind || 'slash', 'script', s.id)}
      ${fieldHtml({ key: 'command.options', label: 'Options (Discord JSON)', type: 'json' }, s.command?.options || [], 'script', s.id)}
      ${fieldHtml({ key: 'command.guildOnly', label: 'Guild only', type: 'checkbox' }, !!s.command?.guildOnly, 'script', s.id)}
      ${fieldHtml({ key: 'command.dmOnly', label: 'DM only', type: 'checkbox' }, !!s.command?.dmOnly, 'script', s.id)}
      ${fieldHtml({ key: 'command.cooldown', label: 'Cooldown (seconds)', type: 'number' }, s.command?.cooldown || 0, 'script', s.id)}
      ${fieldHtml({ key: 'command.permissions', label: 'Default permissions', type: 'json' }, s.command?.permissions || [], 'script', s.id)}
    </div>` : ''}
    <div class="fi-section"><b>Exports</b>
      ${fieldHtml({ key: 'exports.variables', label: 'Variables (comma separated)', type: 'text' }, (s.exports?.variables || []).join(', '), 'script', s.id)}
      ${fieldHtml({ key: 'exports.functions', label: 'Functions (comma separated)', type: 'text' }, (s.exports?.functions || []).join(', '), 'script', s.id)}
      ${fieldHtml({ key: 'imports', label: 'Imported script ids', type: 'text' }, (s.imports || []).join(', '), 'script', s.id)}
    </div>
    <div class="fi-section"><b>Graph</b><div class="fi-chiprow"><span class="fi-chip">${s.graph.nodes.length} nodes</span><span class="fi-chip">${s.graph.edges.length} connections</span><span class="fi-chip">${s.type === 'event' ? 'event entry' : s.type === 'command' ? 'command entry' : 'main entry'}</span></div></div>`;
}

function renderProjectInspector() {
  const p = content.project;
  const intents = ['Guilds', 'GuildMessages', 'GuildMembers', 'MessageContent', 'GuildVoiceStates', 'GuildPresences', 'GuildMessageReactions', 'DirectMessages', 'GuildModeration', 'GuildInvites'];
  const selectedIntents = new Set(p.intents || []);
  fiBody.innerHTML = `<div class="fi-node-title"><span class="fn-ico">${window.CascadeIcons?.svg('settings') || ''}</span><div><b>${esc(p.name || 'Project settings')}</b><small>project.json · environment-safe</small></div></div>
    <div class="fi-section"><b>Identity</b>
      ${fieldHtml({ key: 'name', label: 'Project name', type: 'text' }, p.name, 'project', 'project')}
      ${fieldHtml({ key: 'description', label: 'Description', type: 'textarea' }, p.description, 'project', 'project')}
      ${fieldHtml({ key: 'prefix', label: 'Prefix for text commands', type: 'text' }, p.prefix, 'project', 'project')}
    </div>
    <div class="fi-section"><b>Credentials (environment names only)</b>
      ${fieldHtml({ key: 'tokenEnv', label: 'Token env var', type: 'text' }, p.tokenEnv, 'project', 'project')}
      ${fieldHtml({ key: 'clientIdEnv', label: 'Client id env var', type: 'text' }, p.clientIdEnv, 'project', 'project')}
      ${fieldHtml({ key: 'guildIdEnv', label: 'Guild id env var', type: 'text' }, p.guildIdEnv, 'project', 'project')}
      <div class="fi-note">Secrets are never stored in the graph or exported source. Use the hosting environment or .env.</div>
    </div>
    <div class="fi-section"><b>Gateway</b>
      ${fieldHtml({ key: 'registerCommands', label: 'Register commands on ready', type: 'checkbox' }, p.registerCommands !== false, 'project', 'project')}
      <div class="fi-field"><label>Intents</label><div class="fi-chiprow" id="fi-intents">${intents.map((name) => `<button type="button" class="fi-chip ${selectedIntents.has(name) ? 'on' : ''}" data-intent="${esc(name)}">${esc(name)}</button>`).join('')}</div><div class="fi-help">Privileged intents require Discord approval.</div></div>
    </div>
    <div class="fi-section"><b>Database</b>
      ${fieldHtml({ key: 'database.backend', label: 'Backend', type: 'select', options: ['json', 'sqlite', 'mongodb'] }, p.database?.backend || 'json', 'project', 'project')}
      ${fieldHtml({ key: 'database.env', label: 'Connection env var', type: 'text' }, p.database?.env || 'DATABASE_URL', 'project', 'project')}
      ${fieldHtml({ key: 'database.jsonPath', label: 'JSON path', type: 'text' }, p.database?.jsonPath || 'data/flow-db.json', 'project', 'project')}
    </div>
    <div class="fi-section"><b>Lavalink music</b>
      ${fieldHtml({ key: 'lavalink.enabled', label: 'Enable Lavalink', type: 'checkbox' }, !!p.lavalink?.enabled, 'project', 'project')}
      ${fieldHtml({ key: 'lavalink.nodes', label: 'Nodes (authEnv only)', type: 'json' }, p.lavalink?.nodes || [], 'project', 'project')}
    </div>
    <div class="fi-section"><b>Custom nodes</b>
      ${fieldHtml({ key: 'customNodes', label: 'Package metadata (JSON)', type: 'json' }, content.customNodes || [], 'project', 'project')}
      <div class="fi-help">Example: <code>[{"type":"custom:double","title":"Double","base":"math-op","version":"1.0.0","enabled":true}]</code>. Packages reusing <code>script.custom</code>, HTTP, database, AI or music operations must declare <code>permissions: ["unsafe-code"]</code>, <code>["network"]</code>, <code>["database"]</code>, <code>["ai"]</code> or <code>["voice"]</code>; they appear under the Custom library category only when permitted.</div>
    </div>`;
  fiBody.querySelectorAll('[data-intent]').forEach((btn) => btn.addEventListener('click', () => {
    const set = new Set(content.project.intents || []);
    if (set.has(btn.dataset.intent)) set.delete(btn.dataset.intent); else set.add(btn.dataset.intent);
    content.project.intents = [...set];
    btn.classList.toggle('on');
    markDirty();
  }));
}

function parseFieldValue(el) {
  const isJson = el.dataset.json === '1';
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return el.value === '' ? 0 : Number(el.value);
  if (isJson) {
    try { el.classList.remove('fi-json-bad'); return JSON.parse(el.value || 'null'); }
    catch { el.classList.add('fi-json-bad'); return undefined; }
  }
  return el.value;
}

function setPath(target, path, value) {
  const parts = path.split('.');
  let obj = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
}

function onInspectorChange(e) {
  const pinField = e.target.closest('[data-pin-value]');
  if (pinField) {
    if (READONLY || pinField.disabled) return;
    const node = nodeById(pinField.dataset.pinOwner);
    if (!node) return;
    node.config ||= {};
    node.config[pinField.dataset.pinKey] = parsePinValue(pinField.type === 'checkbox' ? pinField.checked : pinField.value, pinField.dataset.pinType);
    markDirty();
    return;
  }
  const el = e.target.closest('[data-field-key]');
  if (!el || READONLY) return;
  const value = parseFieldValue(el);
  if (value === undefined) return;
  const scope = el.dataset.fieldScope, owner = el.dataset.ownerId, key = el.dataset.fieldKey;
  if (scope === 'node') {
    const node = nodeById(owner);
    if (!node) return;
    node.config ||= {};
    node.config[key] = value;
    markDirty();
    renderEdges();
  } else if (scope === 'script') {
    const s = activeScript();
    if (!s) return;
    if (key === 'exports.variables' || key === 'exports.functions' || key === 'imports') {
      const list = String(value).split(',').map((x) => x.trim()).filter(Boolean);
      if (key === 'imports') s.imports = list;
      else { s.exports ||= { variables: [], functions: [] }; s.exports[key.split('.')[1]] = list; }
    } else if (key.startsWith('command.')) {
      s.command ||= {};
      setPath(s.command, key.slice(8), value);
    } else if (key === 'enabled') {
      s.enabled = !!value;
      renderExplorer();
    } else s[key] = value;
    markDirty();
  } else if (scope === 'project') {
    if (key.startsWith('database.')) {
      content.project.database ||= {};
      setPath(content.project.database, key.slice(9), value);
    } else if (key.startsWith('lavalink.')) {
      content.project.lavalink ||= {};
      setPath(content.project.lavalink, key.slice(9), value);
    } else if (key === 'customNodes') {
      content.customNodes = Array.isArray(value) ? value : [];
      rebuildCustomDefs();
    } else content.project[key] = value;
    markDirty();
  }
}

function deleteSelectedNode() {
  if (READONLY || !selectedNodeId) return;
  const s = activeScript();
  if (!s) return;
  snapshot();
  s.graph.nodes = s.graph.nodes.filter((n) => n.id !== selectedNodeId);
  s.graph.edges = s.graph.edges.filter((e) => e.from.node !== selectedNodeId && e.to.node !== selectedNodeId);
  selectedNodeId = null;
  inspectorTab = 'script';
  $('flow-shell')?.classList.remove('has-inspector');
  renderAll();
  markDirty();
}

function duplicateSelectedNode() {
  if (READONLY || !selectedNodeId) return;
  const s = activeScript();
  const source = nodeById(selectedNodeId);
  if (!s || !source) return;
  snapshot();
  const copy = JSON.parse(JSON.stringify(source));
  copy.id = flowId('n');
  copy.x = (Number(source.x) || 0) + 26;
  copy.y = (Number(source.y) || 0) + 26;
  s.graph.nodes.push(copy);
  selectedNodeId = copy.id;
  renderAll();
  markDirty();
}

/* ------------------------------------------------------------------- dialogs */
function openDialog(id) {
  const dialog = $(id);
  if (dialog) dialog.showModal();
}
function closeDialog(id) {
  const dialog = $(id);
  if (dialog) dialog.close();
}

let libraryCategory = 'All';
let libraryQuery = '';
function renderLibrary() {
  const cats = $('library-cats');
  const results = $('library-results');
  if (!cats || !results) return;
  const allNodes = [...NODE_LIBRARY, ...customDefs.values()];
  const categories = [...NODE_CATEGORIES, ...(customDefs.size ? ['Custom'] : [])];
  const counts = Object.fromEntries(categories.map((c) => [c, allNodes.filter((n) => n.category === c).length]));
  cats.innerHTML = ['All', ...categories].map((c) => `<button class="library-cat ${libraryCategory === c ? 'on' : ''}" type="button" data-library-cat="${esc(c)}">${esc(c)}<span>${c === 'All' ? allNodes.length : counts[c] || 0}</span></button>`).join('');
  const q = libraryQuery.toLowerCase();
  const list = allNodes.filter((n) => (libraryCategory === 'All' || n.category === libraryCategory)
    && (!q || `${n.title} ${n.type} ${n.category} ${n.description}`.toLowerCase().includes(q)));
  results.innerHTML = list.slice(0, 120).map((n) => `<button class="library-node" type="button" data-library-node="${esc(n.type)}" style="--node-color:${safeColor(n.color)}"><b>${esc(n.title)}</b><small>${esc(n.description || n.category)}</small><em>${esc(n.category)} · ${esc(n.type)}</em></button>`).join('') || '<div class="fi-empty">No nodes match that search.</div>';
  cats.querySelectorAll('[data-library-cat]').forEach((btn) => btn.addEventListener('click', () => { libraryCategory = btn.dataset.libraryCat; renderLibrary(); }));
  results.querySelectorAll('[data-library-node]').forEach((btn) => btn.addEventListener('click', () => {
    addNode(btn.dataset.libraryNode);
    closeDialog('flow-library');
  }));
}

function addNode(type) {
  const s = activeScript();
  const def = defOf({ type });
  if (!s || !def || READONLY) return;
  snapshot();
  const r = wrap.getBoundingClientRect();
  const center = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  const existing = s.graph.nodes.filter((n) => !['comment', 'group'].includes(defOf(n)?.special));
  // A library click has no cursor position. Put the node beside the current
  // graph instead of on top of it, keeping the whole graph discoverable.
  const maxX = existing.length ? Math.max(...existing.map((n) => (Number(n.x) || 0) + 240)) : 0;
  const minY = existing.length ? Math.min(...existing.map((n) => Number(n.y) || 0)) : 0;
  const node = existing.length
    ? { id: flowId('n'), type, x: Math.round(maxX + 60), y: Math.round(minY), config: {} }
    : { id: flowId('n'), type, x: Math.round(center.x - 110), y: Math.round(center.y - 80), config: {} };
  s.graph.nodes.push(node);
  selectedNodeId = node.id;
  selectedEdgeId = null;
  inspectorTab = 'node';
  renderAll();
  const viewport = wrap.getBoundingClientRect();
  const screenX = (node.x + 110) * view.zoom + view.x;
  const screenY = (node.y + 80) * view.zoom + view.y;
  if (screenX < 40 || screenX > viewport.width - 40 || screenY < 40 || screenY > viewport.height - 40) {
    view.x = viewport.width / 2 - (node.x + 110) * view.zoom;
    view.y = viewport.height / 2 - (node.y + 80) * view.zoom;
    applyView();
  }
  $('flow-shell')?.classList.add('has-inspector');
  markDirty();
}

/* ------------------------------------------------------------------ compiler */
async function compile(silent = false) {
  if (!DOC.id) return;
  const secrets = scanFlowSecrets(content);
  if (secrets.length) {
    renderProblems([{ severity: 'error', code: 'flow.secret-in-graph', message: `Remove raw credentials before compiling (${secrets[0].path}). Use an *Env field.`, hint: 'Credentials must come from environment variables, never graph properties.' }]);
    toast('Remove raw credentials before compiling', true);
    return;
  }
  const seq = ++compileSeq;
  setCompileStatus('Compiling…', '');
  if (!silent) setStatus('Compiling…', '');
  try {
    const res = await fetch(`/api/workspace/docs/${DOC.id}/flow/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const body = await res.json().catch(() => ({}));
    if (seq !== compileSeq) return;
    if (!res.ok) throw new Error(body.error || `Compile failed (${res.status})`);
    compileState = body;
    codeEl.textContent = body.code || '// Compilation stopped at the errors below.\n';
    const problems = body.diagnostics || [];
    const errors = problems.filter((d) => d.severity === 'error');
    const warnings = problems.filter((d) => d.severity === 'warning');
    renderProblems(problems);
    setCompileStatus(errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : `Compiled${warnings.length ? ` · ${warnings.length} warnings` : ''}`, errors.length ? 'bad' : 'ok');
    setStatus(errors.length ? 'Needs attention' : 'Compiled', errors.length ? 'bad' : 'ok');
    $('flow-problem-count').textContent = errors.length ? `(${errors.length})` : warnings.length ? `(${warnings.length})` : '';
    renderExportFiles();
    if (!silent && !errors.length) toast('Compiled successful JavaScript');
  } catch (error) {
    if (seq !== compileSeq) return;
    setCompileStatus('Compiler unavailable', 'bad');
    setStatus('Compiler unavailable', 'bad');
    if (!silent) toast(error.message, true);
  }
}

function renderProblems(diagnostics) {
  if (!problemsEl) return;
  if (!diagnostics?.length) {
    problemsEl.innerHTML = '<div class="fi-empty">No problems. The graph compiles cleanly.</div>';
    return;
  }
  problemsEl.innerHTML = diagnostics.map((d, i) => `<div class="flow-problem ${esc(d.severity)}" data-problem="${i}" data-node="${esc(d.nodeId || '')}" data-script="${esc(d.scriptId || '')}" role="button" tabindex="0">
    <span class="fp-sev">${esc(d.severity === 'error' ? 'ERR' : 'WARN')}</span>
    <span><span>${esc(d.message)}</span>${d.hint ? `<span class="fi-help" style="display:block;margin-top:2px">${esc(d.hint)}</span>` : ''}</span>
    <span class="fp-code">${esc(d.code || '')}</span>
  </div>`).join('');
  problemsEl.querySelectorAll('[data-problem]').forEach((row) => row.addEventListener('click', () => {
    const d = diagnostics[Number(row.dataset.problem)];
    if (d?.scriptId) {
      activeScriptId = d.scriptId;
      selectedNodeId = d.nodeId || null;
      selectedEdgeId = null;
      renderAll();
    } else if (d?.nodeId && nodeById(d.nodeId)) {
      selectedNodeId = d.nodeId;
      renderAll();
    }
    document.querySelector('[data-fb="problems"]')?.click();
  }));
}

function renderExportFiles() {
  const list = $('export-list');
  if (!list) return;
  if (!compileState?.ok) { list.textContent = 'Fix compiler errors before exporting.'; return; }
  list.textContent = `Generated ${compileState.stats?.scripts || 0} scripts · ${compileState.stats?.nodes || 0} nodes · ${compileState.stats?.edges || 0} connections\nFiles: ${(compileState.modularFiles || []).join(', ')}`;
}

/* -------------------------------------------------------------------- export */
async function exportProject(mode) {
  const result = compileState?.ok ? compileState : await compile(true);
  if (!result?.ok) { openDialog('flow-export-dialog'); toast('Compile the project first', true); return; }
  try {
    setStatus('Packaging ZIP…', '');
    const res = await fetch(`/api/workspace/docs/${DOC.id}/flow/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, mode }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Export failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(DOC.filename || 'cascade-flow-bot').replace(/[^\w.-]+/g, '-')}-${mode}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    closeDialog('flow-export-dialog');
    toast(`Downloaded ${mode} export`);
    setStatus('Exported', 'ok');
  } catch (error) {
    toast(error.message, true);
    setStatus('Export failed', 'bad');
  }
}

/* ------------------------------------------------------------------- console */
function addConsole(message, kind = 'info') {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  consoleLines.push({ time, message: String(message), kind });
  if (consoleLines.length > 200) consoleLines.shift();
  if (!consoleEl) return;
  const row = document.createElement('div');
  row.className = `cl ${kind}`;
  row.innerHTML = `<time>${esc(time)}</time><span>${esc(message)}</span>`;
  consoleEl.append(row);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

/* ----------------------------------------------------------------- simulation */
function dataEdge(script, nodeId, pinId) {
  return script.graph.edges.find((e) => e.kind === 'data' && e.to.node === nodeId && e.to.pin === pinId) || null;
}
function simArgs(script, node, ctx, vars, stack) {
  const def = defOf(node);
  const args = {};
  for (const field of def?.fields || []) args[field.key] = node.config?.[field.key] !== undefined ? node.config[field.key] : field.default;
  for (const pin of def?.inputs?.filter((p) => p.kind !== 'exec') || []) {
    const edge = dataEdge(script, node.id, pin.id);
    if (edge) {
      const src = nodeById(edge.from.node);
      args[pin.id] = src && isDataOnly(src) ? evalData(script, src, ctx, vars, stack)?.[edge.from.pin] : vars[edge.from.node]?.[edge.from.pin];
    } else if (node.config?.[pin.id] !== undefined) args[pin.id] = node.config[pin.id];
  }
  return args;
}

function evalData(script, node, ctx, vars, stack = new Set()) {
  if (!node || stack.has(node.id)) return {};
  const def = defOf(node);
  if (!def) return {};
  const args = simArgs(script, node, ctx, vars, stack);
  stack.add(node.id);
  const a = args;
  let out = {};
  switch (def.type) {
    case 'text': out = { value: String(a.value ?? '') }; break;
    case 'number': out = { value: Number(a.value) || 0 }; break;
    case 'boolean': out = { value: !!a.value }; break;
    case 'json-value': out = { value: a.value ?? null }; break;
    case 'template': {
      const values = { ...(ctx.globals || {}), ...a };
      out = { value: String(a.template || '').replace(/\{([\w.-]+)\}/g, (_, k) => String(values[k] ?? '')) };
      break;
    }
    case 'array-value': out = { value: Array.isArray(a.items) ? a.items : [] }; break;
    case 'object-value': out = { value: a.value || {} }; break;
    case 'map-value': out = { value: a.entries || {} }; break;
    case 'set-value': out = { value: [...new Set(Array.isArray(a.items) ? a.items : [])] }; break;
    case 'array-op': {
      const list = Array.isArray(a.input) ? a.input : [];
      if (a.operation === 'length') out = { value: list.length };
      else if (a.operation === 'join') out = { value: list.join(String(a.argument ?? ',')) };
      else if (a.operation === 'unique') out = { value: [...new Set(list)] };
      else if (a.operation === 'find') out = { value: list.find((v) => v === a.argument) };
      else if (a.operation === 'filter') out = { value: list.filter((v) => v === a.argument) };
      else if (a.operation === 'sort') out = { value: [...list].sort() };
      else if (a.operation === 'slice') out = { value: list.slice(0, Number(a.argument) || list.length) };
      else out = { value: [...list, a.argument] };
      break;
    }
    case 'string-op': {
      const input = String(a.input ?? '');
      if (a.operation === 'uppercase') out = { value: input.toUpperCase() };
      else if (a.operation === 'lowercase') out = { value: input.toLowerCase() };
      else if (a.operation === 'trim') out = { value: input.trim() };
      else if (a.operation === 'split') out = { value: input.split(String(a.a ?? '\n')) };
      else if (a.operation === 'includes') out = { value: input.includes(String(a.a ?? '')) };
      else if (a.operation === 'replace') out = { value: input.split(String(a.a ?? '')).join(String(a.b ?? '')) };
      else if (a.operation === 'length') out = { value: input.length };
      else out = { value: input.slice(Number(a.a) || 0, Number(a.b) || input.length) };
      break;
    }
    case 'math-op': {
      const x = Number(a.a) || 0, y = Number(a.b) || 0;
      out = { value: a.operation === 'add' ? x + y : a.operation === 'subtract' ? x - y : a.operation === 'multiply' ? x * y : a.operation === 'divide' ? (y ? x / y : 0) : a.operation === 'modulo' ? (y ? x % y : 0) : a.operation === 'power' ? x ** y : a.operation === 'round' ? Math.round(x) : a.operation === 'min' ? Math.min(x, y) : a.operation === 'max' ? Math.max(x, y) : Math.abs(x) };
      break;
    }
    case 'compare': {
      const x = a.a, y = a.b;
      out = { value: a.operator === '==' ? x == y : a.operator === '!=' ? x != y : a.operator === '>' ? x > y : a.operator === '>=' ? x >= y : a.operator === '<' ? x < y : a.operator === '<=' ? x <= y : a.operator === 'includes' ? String(x).includes(String(y)) : a.operator === 'startsWith' ? String(x).startsWith(String(y)) : String(x).endsWith(String(y)) };
      break;
    }
    case 'random': out = { value: Math.floor(Math.random() * (Number(a.max) || 100)) + (Number(a.min) || 0) }; break;
    case 'date-op': out = { value: new Date().toISOString() }; break;
    case 'json-op': {
      try {
        if (a.operation === 'stringify') out = { value: JSON.stringify(a.input) };
        else if (a.operation === 'parse') out = { value: typeof a.input === 'string' ? JSON.parse(a.input) : a.input };
        else out = { value: a.input?.[a.path] };
      } catch { out = { value: null }; }
      break;
    }
    case 'regex-op': {
      try {
        const re = new RegExp(String(a.pattern || ''), String(a.flags || 'g'));
        out = { value: a.replacement !== undefined ? String(a.input || '').replace(re, String(a.replacement)) : (String(a.input || '').match(re) || null) };
      } catch { out = { value: null }; }
      break;
    }
    case 'env': out = { value: ctx.env?.[a.name] ?? String(a.fallback || '') }; break;
    case 'coalesce': out = { value: [a.a, a.b, a.c].find((v) => v !== undefined && v !== null && v !== '') ?? null }; break;
    case 'type-convert': out = { value: a.to === 'number' ? Number(a.input) : a.to === 'boolean' ? !!a.input : a.to === 'json' ? (() => { try { return JSON.parse(a.input); } catch { return null; } })() : String(a.input ?? '') }; break;
    case 'validate': out = { valid: a.input !== undefined && a.input !== null && String(a.input).length > 0, value: a.input }; break;
    case 'cache': out = { value: a.value }; break;
    case 'variable-get': out = { value: a.scope === 'global' ? ctx.globals?.[a.name] : vars[a.name] }; break;
    case 'command-option': out = { value: ctx.options?.get?.(a.name) ?? a.fallback }; break;
    case 'use-from-main': out = { value: ctx.globals?.[a.name] }; break;
    case 'import-script': out = { value: a.scriptId }; break;
    case 'function-call': out = { result: null }; break;
    case 'embed-create': out = { embed: { title: a.title, description: a.description, color: a.color } }; break;
    case 'embed-field': out = { field: { name: a.name, value: a.value } }; break;
    case 'component-button': out = { component: { label: a.label, customId: a.customId } }; break;
    case 'component-select': out = { component: { customId: a.customId, kind: a.kind } }; break;
    case 'component-row': out = { row: a.components }; break;
    case 'modal-create': out = { modal: { title: a.title, inputs: a.inputs } }; break;
    default: {
      out = {};
      for (const pin of def.outputs?.filter((p) => p.kind !== 'exec') || []) out[pin.id] = undefined;
    }
  }
  stack.delete(node.id);
  return out;
}

function findSimEntry(script) {
  const nodes = script.graph.nodes;
  const expected = script.type === 'event' ? EVENTS[script.event]?.node : script.type === 'command' ? 'command-entry' : 'main-entry';
  return nodes.find((n) => n.type === expected) || nodes.find((n) => defOf(n)?.special === 'entry');
}

function loopBackMap(script) {
  const map = new Map();
  const loopNodes = script.graph.nodes.filter((n) => defOf(n)?.special === 'loop');
  for (const loop of loopNodes) {
    const queue = script.graph.edges.filter((e) => e.from.node === loop.id && e.from.pin === 'body').map((e) => e.to.node);
    const seen = new Set([loop.id]);
    while (queue.length) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const node = nodeById(id);
      if (!node) continue;
      if (defOf(node)?.special === 'loop') {
        for (const e of script.graph.edges.filter((x) => x.from.node === id && x.from.pin === 'done')) queue.push(e.to.node);
        continue;
      }
      if (!map.has(id)) map.set(id, loop.id);
      for (const e of script.graph.edges.filter((x) => x.from.node === id && defOf(node)?.outputs.find((p) => p.id === x.from.pin)?.kind === 'exec')) queue.push(e.to.node);
    }
  }
  return map;
}

async function runSimulation() {
  const selectedTestId = $('test-script')?.value;
  if (selectedTestId) activeScriptId = selectedTestId;
  const script = activeScript();
  if (!script) return;
  let mock = {};
  try { mock = JSON.parse($('test-json').value || '{}'); } catch { toast('Mock payload is not valid JSON', true); return; }
  const s = script;
  const user = mock.user || { id: 'mock-user', username: 'tester' };
  const replies = [];
  const channel = mock.channel || { id: 'mock-channel', send: async (p) => { replies.push({ channel: p }); return { id: 'sent' }; } };
  const guild = mock.guild || { id: 'mock-guild', name: 'Test Guild', memberCount: 12 };
  const member = mock.member || { id: user.id, user, displayName: user.username, guild, permissions: { has: () => true }, roles: { cache: new Map() } };
  const interaction = mock.interaction || {
    isChatInputCommand: () => true,
    commandName: s.command?.name || s.name,
    user, channel, guild, member,
    options: { get: (name) => mock.options?.[name] ?? null },
    reply: async (p) => { replies.push(p); return { id: 'reply' }; },
    editReply: async (p) => { replies.push(p); return { id: 'edit' }; },
    followUp: async (p) => { replies.push(p); return { id: 'followup' }; },
    deferReply: async () => { replies.push({ deferred: true }); },
    showModal: async (m) => { replies.push({ modal: m }); },
    update: async (p) => { replies.push(p); },
    replied: false,
    deferred: false,
  };
  const message = mock.message || { id: 'mock-message', content: mock.content || '', author: user, channel, guild, member, reply: async (p) => { replies.push(p); return { id: 'reply' }; } };
  const ctx = {
    scriptId: s.id,
    client: { user: { id: 'bot' }, isReady: () => true },
    interaction,
    message,
    user,
    author: user,
    channel,
    guild,
    member,
    options: interaction.options,
    args: mock.args || [],
    content: message.content,
    env: mock.env || {},
    globals: {},
    simReplies: replies,
    ...mock,
  };
  const trace = [];
  const vars = {};
  const sync = {};
  const loopBack = loopBackMap(s);
  const entry = findSimEntry(s);
  if (!entry) { addConsole('No entry node found.', 'bad'); toast('No entry node', true); return; }
  let pc = entry.id;
  let guard = 0;
  let paused = false;
  try {
    while (pc && guard++ < 300) {
      if (String(pc).includes('#')) {
        const [id, phase] = String(pc).split('#');
        const loop = nodeById(id);
        const frame = sync[id];
        if (!frame) { pc = null; break; }
        if (phase === 'iter') {
          if (frame.i >= frame.list.length || frame.i >= frame.max) {
            pc = s.graph.edges.find((e) => e.from.node === id && e.from.pin === 'done')?.to.node || null;
          } else {
            const index = frame.i++;
            vars[id] = { item: frame.list[index], index };
            trace.push(`${id} → item ${index}`);
            pc = s.graph.edges.find((e) => e.from.node === id && e.from.pin === 'body')?.to.node || null;
          }
        } else {
          const cond = evalData(s, loop, ctx, vars)?.condition ?? true;
          if (frame.i >= frame.max || !cond) pc = s.graph.edges.find((e) => e.from.node === id && e.from.pin === 'done')?.to.node || null;
          else { frame.i += 1; vars[id] = {}; pc = s.graph.edges.find((e) => e.from.node === id && e.from.pin === 'body')?.to.node || null; }
        }
        continue;
      }
      const node = nodeById(pc);
      if (!node) break;
      const def = defOf(node);
      if (!def) { trace.push(`? ${pc}`); pc = null; break; }
      trace.push(`→ ${def.title}`);
      if (def.special === 'entry') {
        const out = {};
        for (const pin of def.outputs.filter((p) => p.kind !== 'exec')) out[pin.id] = ctx[pin.id] ?? ctx[pin.id === 'message' ? 'message' : pin.id];
        vars[node.id] = out;
        pc = s.graph.edges.find((e) => e.from.node === node.id && e.from.pin === 'next')?.to.node || null;
        continue;
      }
      if (def.special === 'branch') {
        const args = simArgs(s, node, ctx, vars);
        const cond = dataEdge(s, node.id, 'condition') ? args.condition : node.config?.condition;
        pc = s.graph.edges.find((e) => e.from.node === node.id && e.from.pin === (cond ? 'true' : 'false'))?.to.node || null;
        trace.push(`  condition = ${String(cond)}`);
        continue;
      }
      if (def.special === 'switch') {
        const args = simArgs(s, node, ctx, vars);
        let next = null;
        for (const pin of ['case1', 'case2', 'case3']) if (args.value == (node.config?.[pin] ?? '')) next = s.graph.edges.find((e) => e.from.node === node.id && e.from.pin === pin)?.to.node || null;
        pc = next || s.graph.edges.find((e) => e.from.node === node.id && e.from.pin === 'default')?.to.node || null;
        continue;
      }
      if (def.type === 'loop-each') {
        const items = simArgs(s, node, ctx, vars).items;
        const list = Array.isArray(items) ? items : items == null ? [] : [items];
        sync[node.id] = { list, i: 0, max: Number(node.config?.limit) || 1000 };
        pc = `${node.id}#iter`;
        continue;
      }
      if (def.type === 'while-loop') {
        sync[node.id] = { i: 0, max: Number(node.config?.maxIterations) || 1000 };
        pc = `${node.id}#check`;
        continue;
      }
      if (def.type === 'breakpoint' && node.config?.enabled !== false) {
        trace.push('  ⏸ paused at breakpoint');
        paused = true;
        pc = null;
        break;
      }
      if (def.special === 'try') { ctx.__flowCatch = s.graph.edges.find((e) => e.from.node === node.id && e.from.pin === 'catch')?.to.node || null; pc = s.graph.edges.find((e) => e.from.node === node.id && e.from.pin === 'body')?.to.node || null; continue; }
      if (def.special === 'tryEnd') { ctx.__flowCatch = null; pc = s.graph.edges.find((e) => e.from.node === node.id && e.from.pin === 'next')?.to.node || null; continue; }
      if (def.type === 'return') { trace.push('  return'); pc = null; break; }
      if (def.type === 'command-respond' || def.type === 'command-followup' || def.type === 'command-edit' || def.type === 'message-reply' || def.type === 'message-send') {
        const args = simArgs(s, node, ctx, vars);
        const payload = { content: args.content, embeds: args.embeds, components: args.components };
        replies.push(payload);
        addConsole(`${def.title}: ${args.content || '(embed/components)'}`, 'ok');
      }
      if (def.type === 'command-defer') { replies.push({ deferred: true }); addConsole('Deferred reply', 'info'); }
      if (def.type === 'log') {
        const args = simArgs(s, node, ctx, vars);
        addConsole(String(args.message ?? args.value ?? ''), 'info');
      }
      if (def.type === 'variable-set' || def.type === 'global-set') {
        const args = simArgs(s, node, ctx, vars);
        if (args.scope === 'global') ctx.globals[args.name] = args.value; else vars[args.name] = args.value;
        vars[node.id] = { value: args.value };
        addConsole(`${args.name} = ${JSON.stringify(args.value)}`, 'info');
      }
      if (def.type === 'command-permission' || def.type === 'command-cooldown') {
        vars[node.id] = { allowed: true, remaining: 0 };
        pc = s.graph.edges.find((e) => e.from.node === node.id && e.from.pin === 'allowed')?.to.node || null;
        continue;
      }
      vars[node.id] = { ...(evalData(s, node, ctx, vars) || {}), ...(vars[node.id] || {}) };
      pc = s.graph.edges.find((e) => e.from.node === node.id && e.from.pin === 'next')?.to.node || loopBack.get(node.id) ? (s.graph.edges.find((e) => e.from.node === node.id && e.from.pin === 'next')?.to.node || loopBack.get(node.id)) : null;
    }
    simLast = { trace, vars, replies, paused };
    $('flow-debug-vars').textContent = JSON.stringify(vars, null, 2);
    $('flow-debug-trace').textContent = trace.join('\n') || 'No trace.';
    addConsole(`Simulation finished: ${replies.length} reply${replies.length === 1 ? '' : 's'}${paused ? ' (paused)' : ''}`, paused ? 'warn' : 'ok');
    document.querySelector('[data-fb="debug"]')?.click();
    closeDialog('flow-test-dialog');
    toast(paused ? 'Paused at breakpoint' : `Simulation finished · ${replies.length} replies`);
  } catch (error) {
    addConsole(`Simulation error: ${error.message}`, 'bad');
    $('flow-debug-trace').textContent = `${trace.join('\n')}\n\nERROR: ${error.message}`;
    toast(error.message, true);
  }
}

/* ------------------------------------------------------------------ toolbar */
function fitView() {
  const bounds = nodeBounds();
  const r = wrap.getBoundingClientRect();
  if (!bounds) { view = { x: 72, y: 52, zoom: 1 }; applyView(); return; }
  const w = Math.max(120, bounds.maxX - bounds.minX + 160);
  const h = Math.max(100, bounds.maxY - bounds.minY + 160);
  const zoom = Math.min(1.45, Math.max(0.22, Math.min((r.width - 40) / w, (r.height - 40) / h)));
  view.zoom = zoom;
  view.x = (r.width - (bounds.maxX - bounds.minX) * zoom) / 2 - bounds.minX * zoom;
  view.y = (r.height - (bounds.maxY - bounds.minY) * zoom) / 2 - bounds.minY * zoom;
  applyView();
  renderMinimap();
}

function autoLayout() {
  const s = activeScript();
  if (!s || READONLY) return;
  snapshot();
  const incoming = new Map();
  for (const e of s.graph.edges) if (e.kind === 'exec') incoming.set(e.to.node, (incoming.get(e.to.node) || 0) + 1);
  const layers = [];
  const nodes = s.graph.nodes.filter((n) => !['comment', 'group'].includes(defOf(n)?.special));
  const execNodes = nodes.filter((n) => !isDataOnly(n));
  const dataNodes = nodes.filter(isDataOnly);
  const placed = new Set();
  let layer = 0;
  let current = execNodes.filter((n) => (incoming.get(n.id) || 0) === 0);
  while (current.length && layer < 80) {
    layers[layer] = current;
    for (const n of current) placed.add(n.id);
    const next = [];
    for (const n of current) for (const e of s.graph.edges) if (e.from.node === n.id && e.kind === 'exec' && !placed.has(e.to.node) && !next.includes(nodeById(e.to.node))) { const to = nodeById(e.to.node); if (to) next.push(to); }
    current = next;
    layer += 1;
  }
  for (const n of execNodes) if (!placed.has(n.id)) { layers[layer] = layers[layer] || []; layers[layer].push(n); layer += 1; }
  layers.forEach((list, li) => list.forEach((n, ni) => { n.x = 80 + li * 310; n.y = 70 + ni * 145; }));
  dataNodes.forEach((n, i) => { n.x = 80 + (i % 4) * 255; n.y = 620 + Math.floor(i / 4) * 130; });
  s.graph.nodes.filter((n) => ['comment', 'group'].includes(defOf(n)?.special)).forEach((n, i) => { n.x = 80 + i * 470; n.y = 20; });
  renderAll();
  markDirty();
  setTimeout(fitView, 30);
}

function bindToolbar() {
  $('flow-add-node')?.addEventListener('click', () => { libraryCategory = 'All'; libraryQuery = ''; $('library-search').value = ''; renderLibrary(); openDialog('flow-library'); });
  $('flow-compile')?.addEventListener('click', () => compile(false));
  $('flow-test')?.addEventListener('click', openTest);
  $('flow-undo')?.addEventListener('click', undo);
  $('flow-redo')?.addEventListener('click', redo);
  $('flow-fit')?.addEventListener('click', fitView);
  $('flow-layout')?.addEventListener('click', autoLayout);
  $('flow-export')?.addEventListener('click', () => { renderExportFiles(); openDialog('flow-export-dialog'); });
  $('flow-bookmark')?.addEventListener('click', addBookmark);
  $('flow-zoom-in')?.addEventListener('click', () => zoomBy(1.15));
  $('flow-zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.15));
  $('flow-zoom-label')?.addEventListener('click', () => { view.zoom = 1; applyView(); renderMinimap(); });
  $('flow-minimap-toggle')?.addEventListener('click', () => { const mm = $('flow-minimap'); mm.hidden = !mm.hidden; });
  $('flow-copy-code')?.addEventListener('click', () => { navigator.clipboard?.writeText(codeEl.textContent || '').then(() => toast('Generated JavaScript copied')).catch(() => toast('Copy failed', true)); });
  $('flow-compile-first')?.addEventListener('click', () => compile(false));
  $('flow-export-dialog')?.querySelectorAll('[data-export]').forEach((card) => card.addEventListener('click', () => exportProject(card.dataset.export)));
  $('flow-library')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDialog('flow-library'); });
  $('flow-export-dialog')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDialog('flow-export-dialog'); });
  $('flow-test-dialog')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDialog('flow-test-dialog'); });
  document.querySelectorAll('[data-close-dialog]').forEach((btn) => btn.addEventListener('click', () => closeDialog(btn.dataset.closeDialog)));
  $('library-search')?.addEventListener('input', (e) => { libraryQuery = e.target.value; renderLibrary(); });
  $('library-clear')?.addEventListener('click', () => { libraryQuery = ''; $('library-search').value = ''; renderLibrary(); });
  $('test-run')?.addEventListener('click', runSimulation);
  $('fe-settings')?.addEventListener('click', () => { inspectorTab = 'project'; selectedNodeId = null; renderInspector(); $('flow-shell')?.classList.add('has-inspector'); });
  document.addEventListener('cascade:menu', (event) => {
    const action = event.detail?.action;
    switch (action) {
      case 'save': $('btn-save')?.click(); break;
      case 'history': $('btn-versions')?.click(); break;
      case 'share': $('btn-share')?.click(); break;
      case 'compile': $('flow-compile')?.click(); break;
      case 'test': $('flow-test')?.click(); break;
      case 'export': $('flow-export')?.click(); break;
      case 'settings': $('fe-settings')?.click(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'add-node': $('flow-add-node')?.click(); break;
      case 'fit': fitView(); break;
      case 'layout': autoLayout(); break;
      case 'bookmark': addBookmark(); break;
      case 'shortcuts': toast('A add node · F fit · Ctrl+Enter compile · right-click for canvas/node/pin menus'); break;
      default: break;
    }
  });
  $('fe-new-script')?.addEventListener('click', newScript);
  $('fe-new-folder')?.addEventListener('click', newFolder);
  $('fe-search')?.addEventListener('input', renderExplorer);
  $('fi-close-mobile')?.addEventListener('click', () => $('flow-shell').classList.remove('has-inspector'));
  $('flow-mobile-project')?.addEventListener('click', () => $('flow-shell')?.classList.toggle('has-explorer'));
  document.querySelectorAll('.fi-tab').forEach((tab) => tab.addEventListener('click', () => { inspectorTab = tab.dataset.fi; if (inspectorTab !== 'node') selectedNodeId = null; renderInspector(); }));
  document.querySelectorAll('.fb-tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.fb-tab').forEach((x) => x.classList.toggle('on', x === tab));
    document.querySelectorAll('.fb-pane').forEach((p) => p.classList.toggle('on', p.id === `fb-${tab.dataset.fb}`));
  }));
  fiBody?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pin-disconnect]');
    if (!btn || READONLY) return;
    const node = nodeById(selectedNodeId);
    const script = activeScript();
    if (!node || !script) return;
    snapshot();
    script.graph.edges = script.graph.edges.filter((edge) => !(edge.to.node === node.id && edge.to.pin === btn.dataset.pinDisconnect));
    renderNodes();
    renderInspector();
    renderEdges();
    markDirty();
    toast('Input disconnected — type a value instead');
  });
  fiBody?.addEventListener('input', (e) => { if (e.target.matches('textarea[data-json]')) parseFieldValue(e.target); });
  fiBody?.addEventListener('change', onInspectorChange);
  fiBody?.addEventListener('input', (e) => { if (!e.target.matches('input[type=text], input[type=number], textarea:not([data-json])')) return; onInspectorChange(e); });
  nodesEl?.addEventListener('pointerdown', (e) => {
    const pin = e.target.closest('.flow-pin');
    if (pin) { startConnection(e, pin); return; }
    const nodeEl = e.target.closest('.flow-node');
    if (!nodeEl) return;
    if (e.target.closest('.fn-head')) { startNodeDrag(e, nodeEl); return; }
    selectedNodeId = nodeEl.dataset.id;
    selectedEdgeId = null;
    inspectorTab = 'node';
    $('flow-shell')?.classList.remove('has-explorer');
    $('flow-shell')?.classList.add('has-inspector');
    renderNodes();
    renderInspector();
  });
  nodesEl?.addEventListener('dblclick', (e) => {
    const nodeEl = e.target.closest('.flow-node');
    if (nodeEl) { inspectorTab = 'node'; selectedNodeId = nodeEl.dataset.id; renderNodes(); renderInspector(); }
  });
  wrap?.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const x = event.clientX, y = event.clientY;
    const edgeEl = event.target.closest('[data-edge]');
    if (edgeEl) {
      const script = activeScript();
      const edge = script?.graph.edges.find((item) => item.id === edgeEl.dataset.edge);
      if (edge) {
        selectedEdgeId = edge.id;
        selectedNodeId = null;
        renderNodes(); renderEdges(); renderInspector();
        showEdgeMenu(edge, x, y);
      }
      return;
    }
    const pinEl = event.target.closest('.flow-pin');
    if (pinEl) {
      selectedNodeId = pinEl.dataset.node;
      selectedEdgeId = null;
      inspectorTab = 'node';
      renderNodes(); renderInspector();
      showPinMenu(pinElInfo(pinEl), x, y);
      return;
    }
    const nodeEl = event.target.closest('.flow-node');
    if (nodeEl) {
      const node = nodeById(nodeEl.dataset.id);
      if (!node) return;
      selectedNodeId = node.id;
      selectedEdgeId = null;
      inspectorTab = 'node';
      renderNodes(); renderInspector();
      $('flow-shell')?.classList.add('has-inspector');
      showNodeMenu(node, x, y);
      return;
    }
    showCanvasMenu(x, y);
  });
  wrap?.addEventListener('pointerdown', startPan);
  wrap?.addEventListener('click', (e) => {
    if (suppressCanvasClick) { suppressCanvasClick = false; return; }
    if (!e.target.closest('.flow-node,.flow-pin,.flow-minimap')) { selectedNodeId = null; selectedEdgeId = null; renderNodes(); renderEdges(); renderInspector(); }
  });
  wrap?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const before = screenToWorld(e.clientX, e.clientY);
    view.zoom = Math.min(2.5, Math.max(0.18, view.zoom * factor));
    const after = screenToWorld(e.clientX, e.clientY);
    view.x += (after.x - before.x) * view.zoom;
    view.y += (after.y - before.y) * view.zoom;
    applyView();
    renderMinimap();
  }, { passive: false });
  $('flow-minimap')?.addEventListener('click', (e) => {
    const bounds = nodeBounds();
    if (!bounds) return;
    const r = e.currentTarget.getBoundingClientRect();
    const scale = Math.min(150 / (bounds.maxX - bounds.minX + 100), 92 / (bounds.maxY - bounds.minY + 100));
    view.x = -(e.clientX - r.left) / scale + wrap.clientWidth / 2 / view.zoom;
    view.y = -(e.clientY - r.top) / scale + wrap.clientHeight / 2 / view.zoom;
    applyView();
    renderMinimap();
  });
  document.addEventListener('keydown', (e) => {
    const typing = e.target.matches('input, textarea, select');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); ws?.saveNow?.(true); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); compile(false); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('flow-add-node').click(); return; }
    if (e.key === 'Escape') { if (connecting) { cancelConnection(); toast('Connection cancelled'); return; } document.querySelector('.flow-context-menu')?.remove(); return; }
    if (typing) return;
    if (e.code === 'Space') { spaceDown = true; e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedNodeId) { const n = nodeById(selectedNodeId); if (n) { clipboard = JSON.parse(JSON.stringify(n)); toast('Node copied'); } return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard) {
      if (READONLY) return;
      snapshot();
      const copy = { ...JSON.parse(JSON.stringify(clipboard)), id: flowId('n'), x: Number(clipboard.x) + 30, y: Number(clipboard.y) + 30 };
      activeScript().graph.nodes.push(copy);
      selectedNodeId = copy.id;
      renderAll();
      markDirty();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedNodeId) { e.preventDefault(); duplicateSelectedNode(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedEdgeId) { const s = activeScript(); snapshot(); s.graph.edges = s.graph.edges.filter((x) => x.id !== selectedEdgeId); selectedEdgeId = null; renderAll(); markDirty(); } else if (selectedNodeId) deleteSelectedNode(); return; }
    if (e.key.toLowerCase() === 'f') fitView();
    if (e.key.toLowerCase() === 'a' && !e.metaKey && !e.ctrlKey) $('flow-add-node').click();
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
}

function zoomBy(factor) {
  const r = wrap.getBoundingClientRect();
  const before = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  view.zoom = Math.min(2.5, Math.max(0.18, view.zoom * factor));
  const after = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  view.x += (after.x - before.x) * view.zoom;
  view.y += (after.y - before.y) * view.zoom;
  applyView();
  renderMinimap();
}

function addBookmark() {
  const name = prompt('Bookmark name', activeScript()?.name || 'View');
  if (!name) return;
  snapshot();
  content.bookmarks ||= [];
  content.bookmarks.push({ id: flowId('b'), name: name.slice(0, 60), scriptId: activeScriptId, view: { ...view } });
  markDirty();
  toast('View bookmarked');
}

function newScript() {
  if (READONLY) return;
  const name = prompt('Script name', 'New Command');
  if (!name || !name.trim()) return;
  const type = prompt('Type: command, event, module or main', 'command') || 'command';
  const safeType = SCRIPT_TYPES.includes(type) ? type : 'command';
  snapshot();
  const script = blankScript(flowId('s'), name.trim().slice(0, 80), safeType);
  if (safeType === 'command') {
    script.command = { ...script.command, name: name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32), description: `${name.trim()} command`, options: [] };
  }
  if (safeType === 'event') script.event = prompt('Gateway event key', 'messageCreate') || 'messageCreate';
  content.scripts.push(script);
  activeScriptId = script.id;
  selectedNodeId = null;
  renderAll();
  markDirty();
}

function newFolder() {
  if (READONLY) return;
  const name = prompt('Folder name', 'Commands');
  if (!name || !name.trim()) return;
  snapshot();
  content.folders ||= [];
  content.folders.push({ id: flowId('f'), name: name.trim().slice(0, 60), parent: '' });
  renderExplorer();
  markDirty();
}

function openTest() {
  const select = $('test-script');
  if (select) select.innerHTML = content.scripts.map((s) => `<option value="${esc(s.id)}" ${s.id === activeScriptId ? 'selected' : ''}>${esc(s.name)} · ${esc(s.type)}</option>`).join('');
  select?.addEventListener('change', () => {
    activeScriptId = select.value;
    selectedNodeId = null;
    selectedEdgeId = null;
    renderAll();
  });
  const current = activeScript();
  if (current?.type === 'command') $('test-json').value = JSON.stringify({ user: { id: '123', username: 'tester' }, options: { [current.command?.name || 'query']: 'hello' }, args: ['hello'] }, null, 2);
  openDialog('flow-test-dialog');
}

function renderAll() {
  renderExplorer();
  renderNodes();
  renderInspector();
  renderMinimap();
  const shell = $('flow-shell');
  if (selectedNodeId) shell?.classList.add('has-inspector');
}

function boot() {
  if (!DOC.id) return;
  if (!activeScriptId) activeScriptId = content.scripts[0]?.id || null;
  renderAll();
  applyView();
  bindToolbar();
  renderLibrary();
  ws = window.Workspace?.create({
    id: DOC.id,
    kind: 'flow',
    version: DOC.version,
    content,
    canEdit: !READONLY,
    filename: DOC.filename,
    isPublic: DOC.isPublic,
    collect: () => {
      const findings = scanFlowSecrets(content);
      if (findings.length) {
        toast(`Raw credentials are not saved (${findings[0].path})`, true);
        return redactFlowSecrets(content);
      }
      return content;
    },
    apply: (next) => {
      content = normalizeFlow(next || {});
      if (!content.scripts.find((s) => s.id === activeScriptId)) activeScriptId = content.scripts[0]?.id || null;
      selectedNodeId = null;
      selectedEdgeId = null;
      renderAll();
      applyView();
    },
  });
  addConsole('Flow IDE ready. Compile with Ctrl+Enter, test with the Test button.', 'ok');
  setTimeout(() => { fitView(); compile(true); }, 100);
}

window.__FLOW__ = { get content() { return content; }, compile, runSimulation, addNode };
window.addEventListener('error', (event) => {
  console.error('[flow] runtime error', event.error || event.message);
  const host = $('flow-toast-host') || document.body;
  const el = document.createElement('div');
  el.className = 'flow-toast bad';
  el.textContent = `Flow error: ${event.message}`;
  host.append(el);
});

try {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
} catch (error) {
  window.__FLOW_ERROR = error;
  console.error('[flow] boot failed', error);
  const host = $('flow-toast-host') || document.body;
  const el = document.createElement('div');
  el.className = 'flow-toast bad';
  el.textContent = `Flow failed to start: ${error.message}`;
  host.append(el);
}
