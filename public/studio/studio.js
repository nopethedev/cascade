import * as THREE from '/public/vendor/three.module.js';
import {
  buildSceneMeshes,
  orbitPosition,
  orbitCamera,
  zoomCamera,
  screenPanDelta,
  applyGizmoDrag,
  transformCommand,
  snapshotTransform,
} from './scene-engine.mjs';

const bootstrap = JSON.parse(document.getElementById('studio-bootstrap')?.textContent || '{}');
const app = document.getElementById('studio-app');
const DOC = bootstrap;
let project = bootstrap.project || bootstrap;
let session = bootstrap.session || { status: 'disconnected' };
let scene = normalizeScene(project.content);
let selected = new Set();
let primaryId = null;
let activeTab = 'scene';
let activeScriptId = null;
let transformTool = 'select';
let transformSpace = 'world';
let gridSnap = 1;
let ortho = false;
let dragging = null;
let lastVersion = Number(project.version) || 1;
let logLines = [];
let commandPoll = null;
let monaco = null;
let monacoLoading = null;
let monacoEditor = null;
let monacoFallback = null;
let monacoModels = new Map();
let cmsCounter = 0;
let studioCollab = null;
let undoStack = [];
let redoStack = [];

const $ = (id) => document.getElementById(id);
const canEdit = app?.dataset.canEdit === '1' && project.role !== 'viewer';
const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const num = (value, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
const escAttr = (value) => esc(value).replace(/`/g, '&#96;');

function toast(message, bad = false) {
  if (window.cascadeToast) return window.cascadeToast(message, bad);
  log(message, bad ? 'error' : 'info');
}

function log(message, level = 'info') {
  logLines.unshift({ at: new Date(), message, level });
  logLines = logLines.slice(0, 200);
  renderLog();
}

function normalizeScene(content) {
  if (content?.scene?.services) return content.scene;
  if (Array.isArray(content?.services)) return content;
  return { placeName: content?.placeName || project.filename || 'Untitled place', services: [] };
}

function service(name) {
  return (scene.services || []).find((n) => n.name === name || n.className === name) || null;
}

function walk(nodes, fn, depth = 0, parent = null) {
  for (const node of nodes || []) {
    fn(node, depth, parent);
    walk(node.children || [], fn, depth + 1, node);
  }
}

function allNodes() {
  const out = [];
  walk(scene.services || [], (node, depth, parent) => out.push({ node, depth, parent }));
  return out;
}

function findNode(id) {
  let found = null;
  walk(scene.services || [], (node, parent) => { if (!found && node.id === id) found = node; });
  return found;
}

function parentOf(id) {
  let found = null;
  walk(scene.services || [], (node, depth, parent) => { if (node.id === id) found = parent; });
  return found;
}

function createId(prefix = 'rbx') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function primaryNode() {
  return primaryId ? findNode(primaryId) : null;
}

function classColor(className) {
  if (/Lighting|Light/i.test(className)) return '#fbbf24';
  if (/Script|Module/i.test(className)) return '#60a5fa';
  if (/Gui|Frame|Label|Button|Image/i.test(className)) return '#c084fc';
  if (/Sound/i.test(className)) return '#34d399';
  if (/Part|Mesh|Model|Wedge|Spawn/i.test(className)) return '#fb7185';
  return '#94a3b8';
}

function classNameOf(node) {
  return String(node?.className || node?.props?.ClassName || 'Instance');
}

function propsOf(node) {
  return node?.props && typeof node.props === 'object' ? node.props : {};
}

function defaultProps(className) {
  const base = { ClassName: className };
  if (/Part|Spawn/.test(className)) return { ...base, Anchored: true, Size: { x: 4, y: 1, z: 4 }, Position: { x: 0, y: 2, z: 0 }, Color: '#e11d48', CanCollide: true, Transparency: 0 };
  if (className === 'Model' || className === 'Folder') return base;
  if (/Script/.test(className)) return { ...base, Source: className === 'ModuleScript' ? 'local Module = {}\n\nreturn Module\n' : '-- New Luau script\nprint("Hello from Cascade")\n' };
  if (className === 'ScreenGui') return { ...base, Enabled: true };
  if (/Frame|Label|Button|Image|Scrolling/.test(className)) return { ...base, Size: { xs: 0.4, xo: 0, ys: 0.3, yo: 0 }, Position: { xs: 0.1, xo: 0, ys: 0.1, yo: 0 }, BackgroundColor3: '#1f2937', Text: /Label|Button/.test(className) ? 'Label' : undefined, TextColor3: '#ffffff', TextSize: 18 };
  if (/UIList|UIPadding|UICorner|UIStroke|UIGradient/.test(className)) return base;
  return base;
}

function nodeDisplay(node) {
  return node?.name || classNameOf(node);
}

function scriptNodes() {
  return allNodes().map((x) => x.node).filter((n) => /Script$/.test(classNameOf(n)));
}

function scriptsSource(node) {
  return String(propsOf(node).Source || '');
}

function applyLocal(kind, payload) {
  if (kind === 'create') {
    const parent = findNode(payload.parentId) || service('Workspace');
    if (!parent) return;
    const node = {
      id: payload.clientId || createId(),
      className: payload.className,
      name: payload.name || payload.className,
      props: { ClassName: payload.className, ...(payload.props || {}) },
      children: [],
    };
    parent.children = Array.isArray(parent.children) ? parent.children : [];
    parent.children.push(node);
    selected = new Set([node.id]);
    primaryId = node.id;
  } else if (kind === 'rename') {
    const node = findNode(payload.instanceId);
    if (node) { node.name = payload.name; node.props = { ...propsOf(node), Name: payload.name }; }
  } else if (kind === 'update' || kind === 'gui') {
    const node = findNode(payload.instanceId);
    if (node) node.props = { ...propsOf(node), ...(payload.props || {}) };
  } else if (kind === 'reparent') {
    const node = findNode(payload.instanceId);
    const parent = findNode(payload.parentId);
    if (node && parent && node !== parent) {
      const old = parentOf(node.id);
      if (old) old.children = (old.children || []).filter((c) => c.id !== node.id);
      parent.children = Array.isArray(parent.children) ? parent.children : [];
      parent.children.push(node);
    }
  } else if (kind === 'delete') {
    const parent = parentOf(payload.instanceId);
    if (parent) parent.children = (parent.children || []).filter((c) => c.id !== payload.instanceId);
    selected.delete(payload.instanceId);
    if (primaryId === payload.instanceId) primaryId = null;
  } else if (kind === 'script') {
    const node = findNode(payload.instanceId);
    if (node) node.props = { ...propsOf(node), Source: payload.source };
  }
  renderAll();
  publishScene();
}

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

function captureHistory(kind, payload) {
  if (kind === 'create') {
    const id = payload.clientId;
    if (!id) return null;
    return {
      undo: { kind: 'delete', payload: { instanceId: id } },
      redo: { kind: 'create', payload: cloneJson(payload) },
      label: `Create ${payload.className || 'instance'}`,
    };
  }
  if (kind === 'delete') {
    const node = findNode(payload.instanceId);
    const parent = parentOf(payload.instanceId);
    if (!node || !parent?.id) return null;
    const ops = [];
    const add = (n, parentId) => {
      ops.push({
        kind: 'create',
        payload: { parentId, className: classNameOf(n), name: nodeDisplay(n), clientId: n.id, props: cloneJson(propsOf(n)) },
      });
      for (const child of n.children || []) add(child, n.id);
    };
    add(node, parent.id);
    return {
      undo: ops,
      redo: { kind: 'delete', payload: cloneJson(payload) },
      label: `Delete ${nodeDisplay(node)}`,
    };
  }
  const node = findNode(payload.instanceId);
  if (!node) return null;
  if (kind === 'update' || kind === 'gui') {
    const oldProps = propsOf(node);
    const previous = {};
    for (const key of Object.keys(payload.props || {})) {
      if (Object.prototype.hasOwnProperty.call(oldProps, key)) previous[key] = cloneJson(oldProps[key]);
    }
    if (!Object.keys(previous).length) return null;
    return {
      undo: { kind: 'update', payload: { instanceId: node.id, props: previous } },
      redo: { kind: kind, payload: cloneJson(payload) },
      label: `Edit ${nodeDisplay(node)}`,
    };
  }
  if (kind === 'rename') {
    return {
      undo: { kind: 'rename', payload: { instanceId: node.id, name: nodeDisplay(node) } },
      redo: { kind: 'rename', payload: cloneJson(payload) },
      label: `Rename ${nodeDisplay(node)}`,
    };
  }
  if (kind === 'reparent') {
    const oldParent = parentOf(node.id);
    if (!oldParent?.id) return null;
    return {
      undo: { kind: 'reparent', payload: { instanceId: node.id, parentId: oldParent.id } },
      redo: { kind: 'reparent', payload: cloneJson(payload) },
      label: `Move ${nodeDisplay(node)}`,
    };
  }
  if (kind === 'script') {
    return {
      undo: { kind: 'script', payload: { instanceId: node.id, source: scriptsSource(node) } },
      redo: { kind: 'script', payload: cloneJson(payload) },
      label: `Edit ${nodeDisplay(node)}`,
    };
  }
  return null;
}

function renderHistoryButtons() {
  const undo = $('studio-undo');
  const redo = $('studio-redo');
  if (undo) undo.disabled = !undoStack.length;
  if (redo) redo.disabled = !redoStack.length;
  if (undo) undo.title = undoStack.length ? `Undo ${undoStack.at(-1).label}` : 'Nothing to undo';
  if (redo) redo.title = redoStack.length ? `Redo ${redoStack.at(-1).label}` : 'Nothing to redo';
}

function clearHistory() {
  undoStack = [];
  redoStack = [];
  renderHistoryButtons();
}

async function undoLast() {
  const entry = undoStack.pop();
  if (!entry) return;
  renderHistoryButtons();
  let ok = true;
  for (const op of (Array.isArray(entry.undo) ? entry.undo : [entry.undo])) {
    if (!(await queueCommand(op.kind, op.payload, { history: false }))) { ok = false; break; }
  }
  if (ok) {
    redoStack.push(entry);
    toast(`Undid ${entry.label}`);
  } else {
    undoStack.push(entry);
  }
  renderHistoryButtons();
}

async function redoLast() {
  const entry = redoStack.pop();
  if (!entry) return;
  renderHistoryButtons();
  let ok = true;
  for (const op of (Array.isArray(entry.redo) ? entry.redo : [entry.redo])) {
    if (!(await queueCommand(op.kind, op.payload, { history: false }))) { ok = false; break; }
  }
  if (ok) {
    undoStack.push(entry);
    toast(`Redid ${entry.label}`);
  } else {
    redoStack.push(entry);
  }
  renderHistoryButtons();
}

async function queueCommand(kind, payload, { optimistic = true, history = true } = {}) {
  if (!canEdit) return false;
  if (kind === 'create' && !payload.clientId) payload = { ...payload, clientId: createId() };
  const historyEntry = history ? captureHistory(kind, payload) : null;
  try {
    const r = await fetch(`/api/studio/projects/${DOC.id}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not queue command');
    if (optimistic) applyLocal(kind, payload);
    if (historyEntry) {
      undoStack.push(historyEntry);
      if (undoStack.length > 50) undoStack.shift();
      redoStack = [];
      renderHistoryButtons();
    }
    log(`Queued ${kind}${j.session?.status === 'connected' ? ' → Studio' : ' (waiting for Studio)'}`);
    renderConnection(j.session || session);
    publishScene();
    pollProject();
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

// ----------------------------- live collaboration -----------------------------
function publishScene() {
  if (!studioCollab?.connected || !canEdit) return;
  studioCollab.publish(scene);
}

function renderStudioPresence(users = []) {
  const live = $('studio-live');
  const box = $('studio-presence');
  if (!live || !box) return;
  const people = users.filter((u) => !u.guest);
  live.hidden = !studioCollab?.connected;
  const label = $('studio-live-label');
  if (label) label.textContent = people.length > 1 ? `${people.length} live` : 'Live';
  box.textContent = '';
  for (const person of people.slice(0, 5)) {
    const chip = document.createElement('span');
    chip.className = 'studio-presence-chip';
    chip.textContent = String(person.username || '?').slice(0, 1).toUpperCase();
    chip.title = `${person.username || 'Guest'} · ${person.role || 'viewer'}`;
    chip.style.setProperty('--chip', /^#[0-9a-f]{6}$/i.test(person.color || '') ? person.color : '#38bdf8');
    box.append(chip);
  }
  if (people.length > 5) {
    const more = document.createElement('span');
    more.className = 'studio-presence-more';
    more.textContent = `+${people.length - 5}`;
    box.append(more);
  }
}

async function initStudioCollab() {
  if (!window.CascadeCollab?.connect) {
    log('Live collaboration transport is unavailable; autosave and Studio sync still work.', 'warn');
    return;
  }
  try {
    const r = await fetch(`/api/studio/projects/${DOC.id}/collab-token`);
    if (!r.ok) {
      log('Live collaboration requires an editor or viewer share of this project.', 'warn');
      return;
    }
    const j = await r.json();
    studioCollab = window.CascadeCollab.connect({
      token: j.token,
      content: scene,
      canWrite: !!j.canEdit && canEdit,
      onInit: ({ users, canWrite }) => {
        renderStudioPresence(users);
        const label = $('studio-live-label');
        if (label) label.textContent = canWrite ? 'Live' : 'Watching';
      },
      onRemoteContent: (value) => {
        if (!value || typeof value !== 'object') return;
        if (!Array.isArray(value.services) && !Array.isArray(value.scene?.services)) return;
        scene = normalizeScene(value);
        if (primaryId && !findNode(primaryId)) { primaryId = null; selected.clear(); }
        clearHistory();
        renderAll();
      },
      onPresence: renderStudioPresence,
      onStatus: ({ state, participants }) => {
        const live = $('studio-live');
        if (live) live.hidden = !studioCollab?.connected;
        const label = $('studio-live-label');
        if (label && state !== 'live') label.textContent = state === 'connecting' ? 'Connecting…' : 'Reconnecting…';
        renderStudioPresence(participants || []);
      },
      onError: (message) => log(`Live collaboration: ${message}`, 'warn'),
    });
  } catch (err) {
    log(`Live collaboration unavailable: ${err.message}`, 'warn');
  }
}

// ----------------------------- connection -----------------------------
function renderConnection(next) {
  if (next) session = { ...session, ...next };
  const label = $('studio-connection-label');
  const place = $('studio-session-place');
  const dot = $('studio-connection');
  if (label) label.textContent = session.status === 'connected' ? 'Studio connected' : session.status === 'stale' ? 'Studio stale' : session.status;
  if (place) place.textContent = session.placeName || '';
  if (dot) dot.className = `studio-connection is-${session.status}`;
  const empty = $('studio-empty-connect');
  if (empty) empty.hidden = session.status === 'connected';
  const revoke = $('studio-disconnect-btn');
  if (revoke) revoke.hidden = !session.id;
  const connect = $('studio-connect-btn');
  if (connect) connect.textContent = session.status === 'connected' ? 'Reconnect Studio' : 'Connect Studio';
}

async function pollProject() {
  try {
    const r = await fetch(`/api/studio/projects/${DOC.id}`);
    if (!r.ok) return;
    const j = await r.json();
    renderConnection(j.session);
    if (j.project?.version && j.project.version !== lastVersion) {
      lastVersion = j.project.version;
      project = j.project;
      scene = normalizeScene(project.content);
      if (primaryId && !findNode(primaryId)) { primaryId = null; selected.clear(); }
      renderAll();
      log(`Applied Studio snapshot v${lastVersion}`);
    }
    renderQueue(j.commands || []);
  } catch { /* transient network failures are expected while Studio reconnects */ }
}

function renderQueue(commands) {
  const queued = commands.filter((c) => c.status === 'queued' || c.status === 'delivered').length;
  const el = $('studio-perf-queue');
  if (el) el.textContent = String(queued);
  const state = $('studio-save-state');
  if (state) state.textContent = queued ? `${queued} pending` : session.status === 'connected' ? 'synced' : 'saved';
  const logEl = $('studio-log');
  if (logEl && commands.length) {
    // Activity is kept in the dedicated log; this only surfaces failed commands.
    const failures = commands.filter((c) => c.status === 'failed');
    if (failures.length) logEl.dataset.failures = failures.length;
  }
}

async function startPairing() {
  if (!canEdit) return toast('Only editors can pair Studio', true);
  try {
    const r = await fetch(`/api/studio/projects/${DOC.id}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not create pairing');
    $('studio-pair-url').value = j.pairing.baseUrl || j.pairing.relayUrl;
    $('studio-pair-code').value = j.pairing.code;
    $('studio-pair-expiry').textContent = `Expires ${new Date(j.pairing.expiresAt).toLocaleTimeString()} · one use only`;
    $('studio-pair-status').textContent = 'Waiting for the plugin…';
    $('studio-pair-dialog').showModal();
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      if (attempts > 60 || !$('studio-pair-dialog').open) { clearInterval(timer); return; }
      const s = await fetch(`/api/studio/projects/${DOC.id}/session`).then((x) => x.json()).catch(() => null);
      if (s?.session?.status === 'connected') {
        clearInterval(timer);
        $('studio-pair-status').textContent = `Connected to ${s.session.placeName || 'Studio'} ✓`;
        renderConnection(s.session);
        pollProject();
      }
    }, 2000);
  } catch (err) { toast(err.message, true); }
}

function revokeSession() {
  if (!session.id || !canEdit) return;
  if (!confirm('Revoke this Studio connection? The plugin will stop receiving commands immediately.')) return;
  fetch(`/api/studio/projects/${DOC.id}/sessions/${session.id}/revoke`, { method: 'POST' })
    .then((r) => r.json())
    .then(() => { renderConnection({ ...session, status: 'revoked' }); log('Studio session revoked', 'warn'); })
    .catch(() => toast('Could not revoke session', true));
}

document.querySelectorAll('[data-open-pair]').forEach((b) => b.addEventListener('click', startPairing));
$('studio-connect-btn')?.addEventListener('click', startPairing);
$('studio-disconnect-btn')?.addEventListener('click', revokeSession);
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
  const input = $(b.dataset.copy);
  if (!input) return;
  navigator.clipboard?.writeText(input.value).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); }).catch(() => {});
}));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog')?.close()));

// ----------------------------- explorer -----------------------------
function collectExpandedIds() {
  return new Set([...document.querySelectorAll('.studio-tree-row[data-expanded="1"]')].map((r) => r.dataset.id));
}
let expanded = new Set();
function renderTree() {
  const tree = $('studio-tree');
  if (!tree) return;
  if (!tree.dataset.ready) {
    expanded = new Set((scene.services || []).map((s) => s.id));
    tree.dataset.ready = '1';
  }
  const query = String($('studio-explorer-search')?.value || '').trim().toLowerCase();
  const html = [];
  const renderNode = (node, depth) => {
    const kids = node.children || [];
    const matches = !query || `${node.name} ${classNameOf(node)}`.toLowerCase().includes(query) || kids.some((k) => `${k.name} ${classNameOf(k)}`.toLowerCase().includes(query));
    if (!matches) return;
    const isOpen = expanded.has(node.id) || query;
    const selectedCls = selected.has(node.id) ? ' is-selected' : '';
    html.push(`<div class="studio-tree-row${selectedCls}" data-id="${escAttr(node.id)}" data-kind="${escAttr(classNameOf(node))}" draggable="${canEdit ? 'true' : 'false'}" style="--depth:${depth}" role="treeitem" aria-selected="${selected.has(node.id)}">
      <button class="studio-tree-toggle" type="button" data-toggle="${escAttr(node.id)}" aria-label="${isOpen ? 'Collapse' : 'Expand'}">${kids.length ? (isOpen ? '▾' : '▸') : '<span class="studio-tree-dot"></span>'}</button>
      <span class="studio-tree-icon" style="--kind-color:${classColor(classNameOf(node))}">${esc(classNameOf(node).slice(0, 2).toUpperCase())}</span>
      <span class="studio-tree-name">${esc(nodeDisplay(node))}</span>
      <span class="studio-tree-class">${esc(classNameOf(node))}</span>
    </div>`);
    if (isOpen) for (const child of kids) renderNode(child, depth + 1);
  };
  for (const svc of scene.services || []) renderNode(svc, 0);
  tree.innerHTML = html.join('') || '<div class="studio-tree-empty">No matching instances</div>';
  tree.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = b.dataset.toggle;
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    renderTree();
  }));
  tree.querySelectorAll('.studio-tree-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (selected.has(row.dataset.id)) selected.delete(row.dataset.id); else selected.add(row.dataset.id);
      } else {
        selected = new Set([row.dataset.id]);
      }
      primaryId = selected.has(row.dataset.id) ? row.dataset.id : [...selected][0] || null;
      renderTree();
      renderProps();
      renderViewportSelection();
      renderGui();
    });
    row.addEventListener('dblclick', () => renameSelected());
    row.addEventListener('dragstart', (e) => {
      if (!canEdit) return;
      e.dataTransfer.setData('text/plain', row.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => { if (canEdit) { e.preventDefault(); row.classList.add('is-drop'); } });
    row.addEventListener('dragleave', () => row.classList.remove('is-drop'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('is-drop');
      const source = e.dataTransfer.getData('text/plain');
      if (!source || source === row.dataset.id) return;
      const target = findNode(row.dataset.id);
      if (!target || !canEdit) return;
      queueCommand('reparent', { instanceId: source, parentId: row.dataset.id });
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      selected = new Set([row.dataset.id]);
      primaryId = row.dataset.id;
      renderTree();
      renderProps();
      openContextMenu(e.clientX, e.clientY);
    });
  });
}

function openContextMenu(x, y) {
  document.querySelector('.studio-context-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'studio-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.innerHTML = `<button data-cmd="rename">Rename</button><button data-cmd="duplicate">Duplicate</button><button data-cmd="delete" class="is-danger">Delete</button><hr><button data-cmd="newscript">Insert script</button><button data-cmd="newgui">Insert ScreenGui</button>`;
  document.body.append(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
  menu.addEventListener('click', (e) => {
    const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
    close();
    if (cmd === 'rename') renameSelected();
    if (cmd === 'duplicate') duplicateSelected();
    if (cmd === 'delete') deleteSelected();
    if (cmd === 'newscript') createInstance('Script', primaryNode());
    if (cmd === 'newgui') createInstance('ScreenGui', primaryNode());
  });
}

function renameSelected() {
  const node = primaryNode();
  if (!node || !canEdit) return;
  const name = prompt('Rename instance', nodeDisplay(node));
  if (!name || name === nodeDisplay(node)) return;
  queueCommand('rename', { instanceId: node.id, name: name.slice(0, 100) });
}

function duplicateSelected() {
  const node = primaryNode();
  if (!node || !canEdit) return;
  const parent = parentOf(node.id) || service('Workspace');
  queueCommand('create', { parentId: parent?.id || null, className: classNameOf(node), name: `${nodeDisplay(node)} Copy`, props: { ...propsOf(node) } });
}

function deleteSelected() {
  if (!canEdit || !selected.size) return;
  if (!confirm(`Delete ${selected.size} instance${selected.size === 1 ? '' : 's'}?`)) return;
  [...selected].forEach((id) => queueCommand('delete', { instanceId: id }));
}

function createInstance(className = $('studio-instance-class')?.value || 'Part', parent = null) {
  if (!canEdit) return;
  let target = parent || primaryNode();
  if (!target) target = service('Workspace');
  if (/Script/.test(className) && (!target || !/Service|ServerStorage|Workspace|Model|Folder/.test(classNameOf(target)))) target = service('ServerScriptService') || target;
  if (/Gui|Frame|Label|Button|Image/.test(className) && !/ScreenGui/.test(className)) {
    const gui = service('StarterGui');
    const screen = gui?.children?.find((c) => classNameOf(c) === 'ScreenGui');
    target = screen || gui || target;
  }
  const baseName = className.replace(/([a-z])([A-Z])/g, '$1 $2');
  const count = allNodes().filter((n) => classNameOf(n) === className).length + 1;
  const clientId = createId();
  queueCommand('create', { parentId: target?.id || null, className, name: `${baseName} ${count}`, clientId, props: defaultProps(className) });
  if (/Script/.test(className)) setTimeout(() => { activeScriptId = clientId; showTab('scripts'); }, 60);
}

$('studio-new-instance')?.addEventListener('click', () => createInstance());
$('studio-instance-class')?.addEventListener('change', () => {});
$('studio-explorer-refresh')?.addEventListener('click', pollProject);
$('studio-explorer-search')?.addEventListener('input', renderTree);
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select, [contenteditable="true"]')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('studio-explorer-search')?.focus(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redoLast(); else undoLast(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && primaryId && activeTab === 'scene') { e.preventDefault(); deleteSelected(); }
  if (e.key === 'F2' && primaryId) { e.preventDefault(); renameSelected(); }
  if (e.key === 'Escape') { selected.clear(); primaryId = null; renderAll(); }
});

// ----------------------------- properties -----------------------------
function numberField(label, value, onChange, { min, max, step } = {}) {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = value ?? 0;
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  if (step !== undefined) input.step = String(step);
  input.addEventListener('change', () => onChange(num(input.value)));
  return field(label, input);
}

function field(label, input) {
  const wrap = document.createElement('label');
  wrap.className = 'studio-field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, input);
  return wrap;
}

function textField(label, value, onChange, max = 2000) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value ?? '';
  input.maxLength = max;
  input.addEventListener('change', () => onChange(input.value));
  return field(label, input);
}

function colorField(label, value, onChange) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#ffffff';
  input.addEventListener('change', () => onChange(input.value));
  return field(label, input);
}

function selectField(label, value, options, onChange) {
  const select = document.createElement('select');
  for (const [key, text] of Object.entries(options)) {
    const o = document.createElement('option');
    o.value = key; o.textContent = text; o.selected = String(value) === String(key);
    select.append(o);
  }
  select.addEventListener('change', () => onChange(select.value));
  return field(label, select);
}

function checkboxField(label, value, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'studio-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value === true;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, document.createTextNode(label));
  return wrap;
}

function updateSelectedProps(patch) {
  if (!canEdit || !selected.size) return;
  for (const id of selected) queueCommand('update', { instanceId: id, props: patch }, { optimistic: true });
}

function renderProps() {
  const body = $('studio-props');
  if (!body) return;
  body.textContent = '';
  const nodes = [...selected].map(findNode).filter(Boolean);
  const node = nodes[0];
  $('studio-props-title').textContent = node ? nodeDisplay(node) : 'Properties';
  $('studio-selection-count').textContent = nodes.length > 1 ? `${nodes.length} selected` : node ? classNameOf(node) : 'No selection';
  if (!node) {
    body.innerHTML = '<div class="studio-props-empty">Select an instance in the Explorer or viewport to inspect it.<br><br><strong>Tip</strong> Drag a row onto another to reparent. Double-click to rename.</div>';
    return;
  }
  const props = propsOf(node);
  const name = textField('Name', nodeDisplay(node), (v) => queueCommand('rename', { instanceId: node.id, name: v.slice(0, 100) }));
  const classLine = document.createElement('div');
  classLine.className = 'studio-class-chip';
  classLine.style.setProperty('--kind-color', classColor(classNameOf(node)));
  classLine.textContent = classNameOf(node);
  const basics = document.createElement('section');
  basics.className = 'studio-prop-group';
  basics.innerHTML = '<h4>Identity</h4>';
  basics.append(name, classLine);
  if (nodes.length > 1) {
    const note = document.createElement('p'); note.className = 'studio-hint'; note.textContent = 'Multi-edit applies to all selected instances.'; basics.append(note);
  }
  body.append(basics);

  const transform = document.createElement('section');
  transform.className = 'studio-prop-group';
  transform.innerHTML = '<h4>Transform</h4>';
  const pos = props.Position || { x: 0, y: 0, z: 0 };
  const size = props.Size || { x: 4, y: 1, z: 4 };
  if (pos && typeof pos === 'object' && 'x' in pos) {
    for (const axis of ['x', 'y', 'z']) transform.append(numberField(axis.toUpperCase(), pos[axis], (v) => updateSelectedProps({ Position: { ...pos, [axis]: v } }), { step: 0.25 }));
  }
  if (size && typeof size === 'object' && 'x' in size) {
    for (const axis of ['x', 'y', 'z']) transform.append(numberField(`Size ${axis.toUpperCase()}`, size[axis], (v) => updateSelectedProps({ Size: { ...size, [axis]: Math.max(0.05, v) } }), { min: 0.05, step: 0.25 }));
  }
  transform.append(numberField('Rotation Y°', props.CFrame?.ry ?? 0, (v) => updateSelectedProps({ CFrame: { ...(props.CFrame || pos), ry: v } }), { step: 5 }));
  body.append(transform);

  const appearance = document.createElement('section');
  appearance.className = 'studio-prop-group';
  appearance.innerHTML = '<h4>Appearance</h4>';
  if ('Color' in props) appearance.append(colorField('Color', props.Color, (v) => updateSelectedProps({ Color: v })));
  if ('Transparency' in props) appearance.append(numberField('Transparency', props.Transparency, (v) => updateSelectedProps({ Transparency: Math.max(0, Math.min(1, v)) }), { min: 0, max: 1, step: 0.05 }));
  if ('Material' in props) appearance.append(selectField('Material', props.Material, { Plastic: 'Plastic', SmoothPlastic: 'SmoothPlastic', Neon: 'Neon', Metal: 'Metal', Wood: 'Wood', Concrete: 'Concrete', Glass: 'Glass', ForceField: 'ForceField' }, (v) => updateSelectedProps({ Material: v })));
  if ('Shape' in props) appearance.append(selectField('Shape', props.Shape, { Block: 'Block', Ball: 'Ball', Cylinder: 'Cylinder' }, (v) => updateSelectedProps({ Shape: v })));
  if ('Text' in props) {
    const area = document.createElement('textarea');
    area.value = String(props.Text || '');
    area.rows = 3;
    area.addEventListener('change', () => updateSelectedProps({ Text: area.value }));
    appearance.append(field('Text', area));
    appearance.append(numberField('Text size', props.TextSize ?? 14, (v) => updateSelectedProps({ TextSize: v }), { min: 1, max: 200 }));
    if (props.TextColor3) appearance.append(colorField('Text color', props.TextColor3, (v) => updateSelectedProps({ TextColor3: v })));
  }
  if (props.BackgroundColor3) appearance.append(colorField('Background', props.BackgroundColor3, (v) => updateSelectedProps({ BackgroundColor3: v })));
  if ('Visible' in props) appearance.append(checkboxField('Visible', props.Visible, (v) => updateSelectedProps({ Visible: v })));
  body.append(appearance);

  const physics = document.createElement('section');
  physics.className = 'studio-prop-group';
  physics.innerHTML = '<h4>Physics & behavior</h4>';
  if ('Anchored' in props) physics.append(checkboxField('Anchored', props.Anchored, (v) => updateSelectedProps({ Anchored: v })));
  if ('CanCollide' in props) physics.append(checkboxField('CanCollide', props.CanCollide, (v) => updateSelectedProps({ CanCollide: v })));
  if ('Enabled' in props) physics.append(checkboxField('Enabled', props.Enabled, (v) => updateSelectedProps({ Enabled: v })));
  if ('Archivable' in props) physics.append(checkboxField('Archivable', props.Archivable, (v) => updateSelectedProps({ Archivable: v })));
  body.append(physics);

  if (/Script$/.test(classNameOf(node))) {
    const scripts = document.createElement('section');
    scripts.className = 'studio-prop-group';
    scripts.innerHTML = '<h4>Luau source</h4>';
    const btn = document.createElement('button'); btn.className = 'btn btn-ghost btn-sm'; btn.textContent = 'Open in script editor';
    btn.addEventListener('click', () => { activeScriptId = node.id; showTab('scripts'); });
    scripts.append(btn);
    body.append(scripts);
  }

  const attributes = document.createElement('section');
  attributes.className = 'studio-prop-group';
  attributes.innerHTML = '<h4>Attributes & tags</h4>';
  const attrs = props.Attributes || {};
  if (!Object.keys(attrs).length) {
    const hint = document.createElement('p'); hint.className = 'studio-hint'; hint.textContent = 'No primitive attributes exposed by the plugin yet.'; attributes.append(hint);
  } else {
    for (const [k, v] of Object.entries(attrs).slice(0, 20)) attributes.append(textField(k, String(v), () => {}));
  }
  body.append(attributes);
}

// ----------------------------- scripts -----------------------------
function renderScriptTabs() {
  const tabs = $('studio-script-tabs');
  if (!tabs) return;
  const scripts = scriptNodes();
  tabs.innerHTML = '';
  for (const node of scripts.slice(0, 30)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `studio-script-tab${node.id === activeScriptId ? ' is-active' : ''}`;
    b.dataset.id = node.id;
    b.innerHTML = `<span>${esc(classNameOf(node) === 'ModuleScript' ? 'M' : classNameOf(node) === 'LocalScript' ? 'L' : 'S')}</span>${esc(nodeDisplay(node))}`;
    b.addEventListener('click', () => { activeScriptId = node.id; renderScriptTabs(); openMonaco(); });
    tabs.append(b);
  }
  if (!scripts.length) tabs.innerHTML = '<span class="studio-hint">No scripts yet. Insert a Script in the Explorer.</span>';
  if (!activeScriptId || !scripts.some((s) => s.id === activeScriptId)) activeScriptId = scripts[0]?.id || null;
  // Only touch Monaco/fallback while the Scripts tab is visible. Otherwise a
  // viewport or Explorer render resets the fallback editor and steals focus.
  if (activeTab === 'scripts') openMonaco();
}

async function loadMonaco() {
  if (monaco) return monaco;
  if (monacoLoading) return monacoLoading;
  monacoLoading = new Promise((resolve) => {
    const fail = () => { monacoFallback = true; monacoLoading = null; resolve(null); };
    if (!window.require) {
      const s = document.createElement('script');
      s.src = '/public/vendor/monaco/vs/loader.js';
      s.onload = () => {
        try {
          window.require.config({ paths: { vs: '/public/vendor/monaco/vs' } });
          window.require(['vs/editor/editor.main'], () => { monaco = window.monaco; monacoLoading = null; resolve(monaco); }, fail);
        } catch { fail(); }
      };
      s.onerror = fail;
      document.head.append(s);
    } else {
      try { window.require(['vs/editor/editor.main'], () => { monaco = window.monaco; monacoLoading = null; resolve(monaco); }, fail); } catch { fail(); }
    }
  });
  return monacoLoading;
}

async function openMonaco() {
  const node = activeScriptId ? findNode(activeScriptId) : null;
  const fallback = $('studio-monaco-fallback');
  if (!node) {
    if (monacoEditor) monacoEditor.setValue('-- Select or create a Script to edit.');
    if (fallback) { fallback.hidden = false; fallback.querySelector('textarea').value = '-- Select or create a Script to edit.'; }
    return;
  }
  const source = scriptsSource(node);
  if (!monaco) {
    if (fallback) {
      const ta = fallback.querySelector('textarea');
      ta.value = source;
      fallback.hidden = false;
      ta.oninput = () => autosaveScript(ta.value);
    }
    // Load the vendored Monaco bundle lazily; the textarea remains usable if
    // the browser cannot load it.
    if (!monacoFallback) loadMonaco().then(() => { if (monaco && activeTab === 'scripts' && activeScriptId) openMonaco(); });
    return;
  }
  if (fallback) fallback.hidden = true;
  if (!monaco.languages.getLanguages().some((l) => l.id === 'luau')) {
    monaco.languages.register({ id: 'luau', extensions: ['.luau'], aliases: ['Luau', 'lua'] });
    monaco.languages.setMonarchTokensProvider('luau', {
      tokenizer: {
        root: [
          [/\b(local|function|end|if|then|else|elseif|for|while|repeat|until|do|return|break|continue|true|false|nil|and|or|not|in|export|type)\b/, 'keyword'],
          [/\b(game|workspace|script|plugin|task|Enum|Instance|Vector3|Vector2|CFrame|Color3|UDim2|UDim|BrickColor|wait|spawn|typeof|pairs|ipairs|print|warn|error|pcall)\b/, 'type.identifier'],
          [/--.*$/, 'comment'],
          [/"[^"]*"|'[^']*'/, 'string'],
          [/\b\d+(\.\d+)?\b/, 'number'],
        ],
      },
    });
    monaco.languages.setLanguageConfiguration('luau', { comments: { lineComment: '--' }, brackets: [['(', ')'], ['{', '}'], ['[', ']']], autoClosingPairs: [{ open: '(', close: ')' }, { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '"', close: '"' }, { open: "'", close: "'" }] });
    monaco.languages.registerCompletionItemProvider('luau', {
      provideCompletionItems: () => ({
        suggestions: [
          { label: 'game:GetService', kind: monaco.languages.CompletionItemKind.Method, insertText: 'game:GetService("${1:Players}")', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
          { label: 'Instance.new', kind: monaco.languages.CompletionItemKind.Constructor, insertText: 'Instance.new("${1:Part}")', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
          { label: 'task.wait', kind: monaco.languages.CompletionItemKind.Function, insertText: 'task.wait(${1:1})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
          { label: 'player:GetAttribute', kind: monaco.languages.CompletionItemKind.Method, insertText: 'player:GetAttribute("${1:Name}")', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
        ],
      }),
    });
  }
  if (!monacoEditor) {
    monacoEditor = monaco.editor.create($('studio-monaco'), {
      value: source,
      language: 'luau',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 12,
      tabSize: 4,
      insertSpaces: true,
      folding: true,
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
      padding: { top: 12 },
    });
    monacoEditor.onDidChangeModelContent(() => {
      if (activeScriptId) autosaveScript(monacoEditor.getValue());
    });
    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveScript());
  } else if (monacoEditor.getValue() !== source) {
    monacoEditor.setValue(source);
  }
  updateDiagnostics(source);
}

let scriptSaveTimer = null;
function autosaveScript(value) {
  updateDiagnostics(value);
  clearTimeout(scriptSaveTimer);
  scriptSaveTimer = setTimeout(async () => {
    if (!activeScriptId || !canEdit) return;
    await queueCommand('script', { instanceId: activeScriptId, source: value }, { optimistic: true });
    $('studio-save-state').textContent = 'script queued';
  }, 1200);
}

function saveScript() {
  if (!activeScriptId || !canEdit) return;
  const source = monacoEditor ? monacoEditor.getValue() : $('studio-monaco-fallback')?.querySelector('textarea')?.value || '';
  clearTimeout(scriptSaveTimer);
  queueCommand('script', { instanceId: activeScriptId, source }, { optimistic: true });
}

function updateDiagnostics(source) {
  const el = $('studio-diagnostics');
  if (!el) return;
  const lines = String(source || '').split('\n');
  const opens = (source.match(/\b(function|if|for|while|do)\b/g) || []).length;
  const ends = (source.match(/\bend\b/g) || []).length;
  const unbalanced = opens - ends;
  el.textContent = unbalanced === 0
    ? `Luau structure looks balanced · ${lines.length} lines · syntax is compiled by Studio when the plugin applies it`
    : `Warning: ${unbalanced > 0 ? `${unbalanced} unclosed block${unbalanced === 1 ? '' : 's'}` : `${-unbalanced} extra end${-unbalanced === 1 ? '' : 's'}`} · Studio will report exact diagnostics`;
  el.classList.toggle('is-warn', unbalanced !== 0);
}

$('studio-script-save')?.addEventListener('click', saveScript);
$('studio-script-new')?.addEventListener('click', () => createInstance('Script', service('ServerScriptService')));
$('studio-script-format')?.addEventListener('click', () => {
  if (!monacoEditor) return;
  const formatted = monacoEditor.getValue().split('\n').map((line) => line.replace(/^[ \t]+/, (m) => m.replace(/\t/g, '    '))).join('\n');
  monacoEditor.setValue(formatted);
});
$('studio-script-template')?.addEventListener('click', () => {
  if (!monacoEditor) return;
  monacoEditor.setValue('-- Cascade Luau template\nlocal Players = game:GetService("Players")\n\nlocal function onPlayerAdded(player)\n\tprint("Welcome", player.Name)\nend\n\nPlayers.PlayerAdded:Connect(onPlayerAdded)\n');
});
$('studio-script-diff')?.addEventListener('click', () => {
  const node = activeScriptId ? findNode(activeScriptId) : null;
  if (!node) return;
  const original = scriptsSource(node);
  const current = monacoEditor?.getValue() || original;
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg dlg-wide';
  dlg.innerHTML = `<div class="dlg-in"><h3 class="dlg-title">Script diff</h3><div class="studio-diff"><pre>${esc(original)}</pre><pre>${esc(current)}</pre></div><div class="dlg-actions"><button class="btn btn-quiet" data-close>Close</button></div></div>`;
  document.body.append(dlg);
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.showModal();
});

// ----------------------------- viewport -----------------------------
const viewport = { renderer: null, scene: null, camera: null, root: null, selection: null, gizmo: null, meshes: new Map(), target: new THREE.Vector3(0, 4, 0), radius: 34, theta: 0.8, phi: 1.05 };
function viewportFallback(message) {
  const canvas = $('studio-viewport');
  if (!canvas) return;
  if (!canvas.nextElementSibling?.classList.contains('studio-viewport-fallback')) {
    canvas.insertAdjacentHTML('afterend', `<p class="studio-viewport-fallback">${message}</p>`);
  }
}
function hardwareWebGL() {
  // Remote desktops and some embedded browsers advertise WebGL through a slow
  // software rasterizer. Creating Three.js there can freeze the main thread for
  // a long time, so only start the preview when a hardware context is available.
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true })
      || probe.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch (err) { return false; }
}
function initViewport() {
  const canvas = $('studio-viewport');
  if (!canvas) return;
  if (!hardwareWebGL()) {
    viewportFallback('3D preview needs hardware WebGL. The Explorer, properties, scripts and GUI designer still work.');
    return;
  }
  try {
    viewport.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch (err) {
    // A missing or blocked WebGL context should disable the 3D preview, not
    // take down the rest of the Studio editor.
    viewportFallback('3D preview is unavailable in this browser. The Explorer, properties and scripts still work.');
    return;
  }
  viewport.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  viewport.renderer.setClearColor(0x0b1018, 1);
  viewport.scene = new THREE.Scene();
  viewport.scene.fog = new THREE.Fog(0x0b1018, 90, 190);
  viewport.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
  viewport.scene.add(new THREE.HemisphereLight(0xa5c8ff, 0x16121c, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(18, 30, 12);
  viewport.scene.add(sun);
  const rim = new THREE.DirectionalLight(0x38bdf8, 1.2);
  rim.position.set(-20, 12, -16);
  viewport.scene.add(rim);
  viewport.root = new THREE.Group();
  viewport.scene.add(viewport.root);
  const grid = new THREE.GridHelper(160, 160, 0x315a76, 0x1d3444);
  grid.position.y = -0.01;
  grid.userData.system = true;
  viewport.root.add(grid);
  const axes = new THREE.AxesHelper(6);
  axes.position.y = 0.02;
  axes.userData.system = true;
  viewport.root.add(axes);
  viewport.selection = new THREE.BoxHelper(new THREE.Object3D(), 0x38bdf8);
  viewport.selection.visible = false;
  viewport.selection.userData.system = true;
  viewport.root.add(viewport.selection);
  viewport.gizmo = makeTransformGizmo();
  viewport.gizmo.visible = false;
  viewport.root.add(viewport.gizmo);
  bindViewportInput(canvas);
  const resize = () => {
    const box = canvas.parentElement?.getBoundingClientRect();
    if (!box || box.width < 10 || box.height < 10) return;
    // The canvas is absolutely positioned, but a very large intrinsic buffer
    // can still exhaust GPU memory when a flex parent briefly reports a huge
    // height during layout. Keep the drawing buffer within sane limits.
    const width = Math.min(2400, Math.max(1, Math.round(box.width)));
    const height = Math.min(1600, Math.max(1, Math.round(box.height)));
    viewport.renderer.setSize(width, height, false);
    viewport.camera.aspect = width / height;
    viewport.camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas.parentElement || canvas);
  resize();
  rebuildViewport();
  const tick = () => {
    if (!viewport.renderer) return;
    requestAnimationFrame(tick);
    if (!viewport.camera) return;
    const p = orbitPosition({ target: viewport.target, radius: viewport.radius, theta: viewport.theta, phi: viewport.phi });
    viewport.camera.position.set(p.x, p.y, p.z);
    viewport.camera.lookAt(viewport.target);
    try {
      viewport.renderer.render(viewport.scene, viewport.camera);
    } catch (err) {
      viewport.renderer = null;
      viewportFallback('3D preview stopped after a renderer error. Editing is unaffected.');
    }
  };
  requestAnimationFrame(tick);
}
function makeTransformGizmo() {
  const group = new THREE.Group();
  group.userData.system = true;
  const axes = [
    ['x', 8, 0.22, 0xf87171, new THREE.Vector3(1, 0, 0)],
    ['y', 8, 0.22, 0x4ade80, new THREE.Vector3(0, 1, 0)],
    ['z', 8, 0.22, 0x60a5fa, new THREE.Vector3(0, 0, 1)],
  ];
  for (const [axis, length, head, color, direction] of axes) {
    const arrow = new THREE.ArrowHelper(direction, new THREE.Vector3(0, 0, 0), length, color, head, 0.45);
    arrow.userData.gizmoAxis = axis;
    arrow.traverse((child) => { child.userData.gizmoAxis = axis; });
    group.add(arrow);
  }
  return group;
}
function makeMesh(item) {
  const className = item.className;
  const { x: sx, y: sy, z: sz } = item.size;
  const geometry = className === 'MeshPart' ? new THREE.SphereGeometry(Math.max(sx, sy, sz) / 2, 24, 16) : new THREE.BoxGeometry(sx, sy, sz);
  const color = item.color;
  const material = new THREE.MeshStandardMaterial({ color, roughness: item.material === 'Metal' ? 0.25 : 0.72, metalness: item.material === 'Metal' ? 0.65 : 0.06, transparent: item.transparency > 0, opacity: 1 - item.transparency, emissive: item.material === 'Neon' ? color : 0x000000, emissiveIntensity: item.material === 'Neon' ? 0.55 : 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(item.position.x, item.position.y, item.position.z);
  mesh.rotation.set(
    THREE.MathUtils.degToRad(item.rotation.rx),
    THREE.MathUtils.degToRad(item.rotation.ry),
    THREE.MathUtils.degToRad(item.rotation.rz),
  );
  mesh.userData.id = item.id;
  mesh.userData.className = className;
  mesh.userData.transform = item;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.35 })));
  return mesh;
}
function rebuildViewport(revealId = null) {
  if (!viewport.root) return;
  for (const child of [...viewport.root.children]) {
    // Grid, axes, selection and gizmo are renderer infrastructure, not scene nodes.
    if (child === viewport.selection || child === viewport.gizmo || child.userData.system) continue;
    viewport.root.remove(child);
  }
  viewport.meshes.clear();
  for (const item of buildSceneMeshes(scene)) {
    const mesh = makeMesh(item);
    viewport.root.add(mesh);
    viewport.meshes.set(item.id, mesh);
  }
  if (revealId) focusNode(revealId);
  renderViewportSelection();
}
function renderViewportSelection() {
  if (!viewport.selection) return;
  const mesh = primaryId ? viewport.meshes.get(primaryId) : null;
  if (!mesh) {
    viewport.selection.visible = false;
    if (viewport.gizmo) viewport.gizmo.visible = false;
    return;
  }
  viewport.selection.setFromObject(mesh);
  viewport.selection.visible = true;
  if (viewport.gizmo) {
    viewport.gizmo.position.copy(mesh.position);
    viewport.gizmo.rotation.set(0, mesh.rotation.y, 0);
    viewport.gizmo.scale.setScalar(transformTool === 'scale' ? 1.25 : 1);
    viewport.gizmo.visible = transformTool !== 'select';
  }
}
function focusNode(id) {
  const mesh = id ? viewport.meshes.get(id) : null;
  if (!mesh) return;
  viewport.target.copy(mesh.position);
  viewport.radius = Math.max(8, (mesh.geometry?.boundingSphere?.radius || 5) * 5);
}
function clearSelection() { selected.clear(); primaryId = null; renderAll(); }
function raycast(event) {
  const rect = viewport.renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, viewport.camera);
  const objects = [...viewport.meshes.values()];
  if (viewport.gizmo?.visible) objects.push(...viewport.gizmo.children);
  return raycaster.intersectObjects(objects, true)[0] || null;
}
function bindViewportInput(canvas) {
  let pointer = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const hit = raycast(e);
    const hitId = hit?.object?.userData?.id;
    const gizmoAxis = hit?.object?.userData?.gizmoAxis;
    if (e.button === 0 && gizmoAxis && ['move', 'rotate', 'scale'].includes(transformTool) && primaryId) {
      const node = findNode(primaryId);
      const mesh = viewport.meshes.get(primaryId);
      if (node && mesh) {
        pointer = { mode: transformTool, axis: gizmoAxis, x: e.clientX, y: e.clientY, start: snapshotTransform(node), object: mesh };
        return;
      }
    }
    if (e.button === 0 && ['move', 'rotate', 'scale'].includes(transformTool) && hitId) {
      const node = findNode(hitId);
      const mesh = viewport.meshes.get(hitId);
      if (node && mesh) {
        selected = new Set([hitId]); primaryId = hitId;
        renderTree(); renderProps(); renderGui(); renderViewportSelection();
        pointer = { mode: transformTool, axis: null, x: e.clientX, y: e.clientY, start: snapshotTransform(node), object: mesh };
        return;
      }
    }
    pointer = { mode: e.button === 2 || e.shiftKey ? 'pan' : 'orbit', x: e.clientX, y: e.clientY, theta: viewport.theta, phi: viewport.phi, target: viewport.target.clone() };
    if (e.button === 0 && hit?.object?.userData?.id) {
      const id = hit.object.userData.id;
      if (e.ctrlKey || e.metaKey) { if (selected.has(id)) selected.delete(id); else selected.add(id); } else selected = new Set([id]);
      primaryId = selected.has(id) ? id : null;
      renderTree(); renderProps(); renderGui(); renderViewportSelection();
    } else if (e.button === 0 && !hit) clearSelection();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointer) return;
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    if (pointer.mode === 'orbit') {
      const next = orbitCamera({ theta: pointer.theta, phi: pointer.phi }, dx, dy);
      viewport.theta = next.theta;
      viewport.phi = next.phi;
    } else if (pointer.mode === 'pan') {
      const right = new THREE.Vector3().setFromMatrixColumn(viewport.camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(viewport.camera.matrix, 1);
      const delta = screenPanDelta({ dx, dy, radius: viewport.radius, right, up });
      viewport.target.copy(pointer.target).add(new THREE.Vector3(delta.x, delta.y, delta.z));
    } else if (['move', 'rotate', 'scale'].includes(pointer.mode)) {
      const next = applyGizmoDrag(pointer.start, {
        mode: pointer.mode,
        axis: pointer.axis,
        dx,
        dy,
        radius: viewport.radius,
        space: transformSpace,
        snapStep: gridSnap,
        rotationSnap: !!gridSnap,
        rotationDegrees: 15,
      });
      pointer.next = next;
      const obj = pointer.object;
      if (pointer.mode === 'move') obj.position.set(next.position.x, next.position.y, next.position.z);
      if (pointer.mode === 'rotate') obj.rotation.y = THREE.MathUtils.degToRad(next.rotation.ry);
      if (pointer.mode === 'scale') {
        const base = pointer.start.size;
        obj.scale.set(next.size.x / base.x, next.size.y / base.y, next.size.z / base.z);
      }
      viewport.selection.setFromObject(obj);
      if (viewport.gizmo) viewport.gizmo.position.copy(obj.position);
    }
  });
  canvas.addEventListener('pointerup', () => {
    if (pointer?.next && canEdit && ['move', 'rotate', 'scale'].includes(pointer.mode)) {
      const node = findNode(pointer.start.id);
      const command = node ? transformCommand(node.id, pointer.start, pointer.next, pointer.mode) : null;
      if (node && command) {
        // Capture undo history from the pre-drag props, then apply the local
        // transform immediately; the server command remains the relay diff.
        queueCommand(command.kind, command.payload, { optimistic: false });
        node.props = { ...propsOf(node), ...command.payload.props };
        renderProps();
        rebuildViewport(node.id);
      }
    }
    pointer = null;
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); viewport.radius = zoomCamera(viewport.radius, e.deltaY); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
document.querySelectorAll('[data-studio-tool]').forEach((b) => b.addEventListener('click', () => {
  transformTool = b.dataset.studioTool;
  document.querySelectorAll('[data-studio-tool]').forEach((x) => x.classList.toggle('is-active', x === b));
  renderViewportSelection();
}));
$('studio-transform-space')?.addEventListener('change', (e) => { transformSpace = e.target.value; });
$('studio-snap')?.addEventListener('change', (e) => { gridSnap = e.target.checked ? Number($('studio-snap-size').value) : 0; });
$('studio-snap-size')?.addEventListener('change', (e) => { if (gridSnap) gridSnap = Number(e.target.value); });
$('studio-camera-reset')?.addEventListener('click', () => { viewport.target.set(0, 4, 0); viewport.radius = 34; viewport.theta = 0.8; viewport.phi = 1.05; });
$('studio-ortho-toggle')?.addEventListener('click', () => {
  ortho = !ortho;
  const canvas = $('studio-viewport');
  const box = canvas.parentElement.getBoundingClientRect();
  viewport.camera = ortho ? new THREE.OrthographicCamera(-box.width / 55, box.width / 55, box.height / 55, -box.height / 55, 0.1, 1000) : new THREE.PerspectiveCamera(48, box.width / box.height, 0.1, 1000);
  viewport.camera.position.copy(new THREE.Vector3(0, 30, 34));
  viewport.camera.lookAt(viewport.target);
  $('studio-ortho-toggle').classList.toggle('is-active', ortho);
});
$('studio-fit-selection')?.addEventListener('click', () => focusNode(primaryId));

// ----------------------------- GUI designer -----------------------------
function guiNodes() {
  const gui = service('StarterGui');
  return gui ? (gui.children || []) : [];
}
function renderGui() {
  const canvas = $('studio-gui-canvas');
  if (!canvas) return;
  const screens = guiNodes();
  canvas.innerHTML = '';
  if (!screens.length) { canvas.innerHTML = '<div class="studio-gui-empty">No ScreenGui yet. Add one from the palette or Explorer.</div>'; return; }
  const screen = screens.find((s) => selected.has(s.id)) || screens[0];
  const render = (node, parentEl, depth) => {
    if (depth > 12) return;
    const p = propsOf(node);
    const className = classNameOf(node);
    if (/UIListLayout|UIPadding|UICorner|UIStroke|UIGradient|UIAspectRatioConstraint|UISizeConstraint/.test(className)) return;
    const el = document.createElement('div');
    el.className = `studio-gui-node ${className.replace(/[^A-Za-z]/g, '').toLowerCase()}${selected.has(node.id) ? ' is-selected' : ''}`;
    el.dataset.id = node.id;
    const pos = p.Position || { xs: 0, xo: 0, ys: 0, yo: 0 };
    const size = p.Size || { xs: 0.4, xo: 0, ys: 0.3, yo: 0 };
    el.style.left = `${num(pos.xs) * 100}%`;
    el.style.top = `${num(pos.ys) * 100}%`;
    el.style.width = `${num(size.xs) * 100}%`;
    el.style.height = `${num(size.ys) * 100}%`;
    if (num(pos.xo)) el.style.marginLeft = `${num(pos.xo)}px`;
    if (num(pos.yo)) el.style.marginTop = `${num(pos.yo)}px`;
    if (num(size.xo)) el.style.width = `calc(${num(size.xs) * 100}% + ${num(size.xo)}px)`;
    if (num(size.yo)) el.style.height = `calc(${num(size.ys) * 100}% + ${num(size.yo)}px)`;
    el.style.background = /^#[0-9a-f]{6}$/i.test(p.BackgroundColor3 || '') ? p.BackgroundColor3 : 'rgba(34,38,52,.75)';
    el.style.color = /^#[0-9a-f]{6}$/i.test(p.TextColor3 || '') ? p.TextColor3 : '#f8fafc';
    if ('Text' in p) el.textContent = String(p.Text || '');
    if (p.TextSize) el.style.fontSize = `${Math.max(7, Math.min(56, num(p.TextSize, 16)))}px`;
    if (p.Visible === false) el.style.display = 'none';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selected = new Set([node.id]); primaryId = node.id;
      renderTree(); renderProps(); renderGui();
    });
    el.addEventListener('pointerdown', (e) => {
      if (!canEdit || e.button !== 0) return;
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const start = { ...(pos || {}) };
      const move = (ev) => {
        const rect = canvas.getBoundingClientRect();
        const nx = Math.max(0, Math.min(1, num(start.xs) + (ev.clientX - startX) / rect.width));
        const ny = Math.max(0, Math.min(1, num(start.ys) + (ev.clientY - startY) / rect.height));
        el.style.left = `${nx * 100}%`; el.style.top = `${ny * 100}%`;
        el.dataset.nx = String(nx); el.dataset.ny = String(ny);
      };
      const up = () => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
        const nx = Number(el.dataset.nx), ny = Number(el.dataset.ny);
        if (Number.isFinite(nx) && Number.isFinite(ny)) {
          const next = { ...start, xs: nx, ys: ny };
          node.props = { ...p, Position: next };
          queueCommand('gui', { instanceId: node.id, props: { Position: next } }, { optimistic: false });
          renderProps();
        }
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
    parentEl.append(el);
    for (const child of node.children || []) render(child, el, depth + 1);
  };
  for (const child of screen.children || []) render(child, canvas, 0);
}
document.querySelectorAll('[data-gui-add]').forEach((b) => b.addEventListener('click', () => {
  const className = b.dataset.guiAdd;
  const gui = service('StarterGui');
  const screen = gui?.children?.find((c) => classNameOf(c) === 'ScreenGui') || null;
  if (!screen && className !== 'ScreenGui') { createInstance('ScreenGui', gui); return; }
  createInstance(className, screen || gui);
}));
$('studio-device-preview')?.addEventListener('change', (e) => {
  const device = $('studio-gui-device');
  if (!device) return;
  const size = e.target.value === 'phone' ? [390, 844] : e.target.value === 'tablet' ? [1024, 768] : [1280, 720];
  device.style.width = `${size[0]}px`; device.style.height = `${size[1]}px`;
  device.dataset.device = e.target.value;
});
$('studio-gui-refresh')?.addEventListener('click', renderGui);

// ----------------------------- tools -----------------------------
function renderLighting() {
  const box = $('studio-lighting-controls');
  if (!box) return;
  const lighting = service('Lighting');
  const props = propsOf(lighting);
  box.innerHTML = '';
  box.append(numberField('Brightness', props.Brightness ?? 2, (v) => {
    const node = service('Lighting');
    if (!node) return;
    queueCommand('update', { instanceId: node.id, props: { Brightness: Math.max(0, Math.min(10, v)) } });
  }, { min: 0, max: 10, step: 0.1 }));
  box.append(colorField('Ambient', props.Ambient || '#3a3a4a', (v) => {
    const node = service('Lighting');
    if (!node) return;
    queueCommand('update', { instanceId: node.id, props: { Ambient: v } });
  }));
}
function addModel(kind) {
  const workspace = service('Workspace');
  if (!workspace) return;
  const part = (name, props) => queueCommand('create', { parentId: workspace.id, className: kind === 'spawn' ? 'SpawnLocation' : 'Part', name, props: { Anchored: true, CanCollide: true, ...props } });
  if (kind === 'platform') part('CascadePlatform', { Size: { x: 18, y: 1, z: 18 }, Position: { x: 0, y: 1, z: 0 }, Color: '#334155' });
  else if (kind === 'spawn') part('CascadeSpawn', { Size: { x: 8, y: 1, z: 8 }, Position: { x: 0, y: 0.5, z: 0 }, Color: '#f59e0b' });
  else if (kind === 'obstacle') part('CascadeObstacle', { Size: { x: 3, y: 4, z: 3 }, Position: { x: 8, y: 2, z: 0 }, Color: '#e11d48' });
  else if (kind === 'coin') part('CascadeCoin', { Size: { x: 2, y: 2, z: 2 }, Position: { x: -6, y: 4, z: 0 }, Color: '#facc15', Material: 'Neon' });
  else if (kind === 'checkpoint') part('CascadeCheckpoint', { Size: { x: 6, y: 0.5, z: 6 }, Position: { x: 12, y: 1, z: 8 }, Color: '#22d3ee', Material: 'Neon' });
  log(`Queued model: ${kind}`);
}
document.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => addModel(b.dataset.model)));
document.querySelectorAll('[data-effect]').forEach((b) => b.addEventListener('click', () => {
  const node = primaryNode() || service('Workspace');
  if (!node) return;
  const effect = b.dataset.effect;
  if (effect === 'particles') queueCommand('create', { parentId: node.id, className: 'ParticleEmitter', name: 'CascadeParticles', props: { Enabled: true, Rate: 20, Lifetime: { min: 0.4, max: 1.2 } } });
  else if (effect === 'pulse') queueCommand('create', { parentId: node.id, className: 'PointLight', name: 'CascadePulse', props: { Brightness: 2, Range: 18, Color: '#38bdf8' } });
  else if (effect === 'spin' || effect === 'float') {
    const src = effect === 'spin'
      ? '-- Rotate this part\nlocal RunService = game:GetService("RunService")\nlocal part = script.Parent\nRunService.Heartbeat:Connect(function(dt)\n\tpart.CFrame *= CFrame.Angles(0, math.rad(60) * dt, 0)\nend)\n'
      : '-- Float this part\nlocal RunService = game:GetService("RunService")\nlocal part = script.Parent\nlocal base = part.Position\nRunService.Heartbeat:Connect(function()\n\tpart.Position = base + Vector3.new(0, math.sin(os.clock() * 2) * 1.5, 0)\nend)\n';
    queueCommand('create', { parentId: node.id, className: 'Script', name: `${effect === 'spin' ? 'Spin' : 'Float'}Effect`, props: { Source: src } });
  }
}));

// ----------------------------- snapshots / history -----------------------------
async function openSnapshots() {
  const dlg = $('studio-snapshots-dialog');
  dlg.showModal();
  const list = $('studio-snapshot-list');
  list.textContent = 'Loading…';
  try {
    const r = await fetch(`/api/studio/projects/${DOC.id}/snapshots`);
    const j = await r.json();
    list.textContent = '';
    if (!j.snapshots?.length) { list.innerHTML = '<p class="hint">No snapshots yet. Connect Studio and apply a command, or create one now.</p>'; return; }
    for (const snap of j.snapshots) {
      const row = document.createElement('div');
      row.className = 'studio-snapshot-row';
      row.innerHTML = `<span><strong>${esc(snap.label || 'Snapshot')}</strong><small>${new Date(snap.createdAt).toLocaleString()}</small></span><button class="btn btn-ghost btn-sm" type="button">Restore</button>`;
      row.querySelector('button').addEventListener('click', async () => {
        if (!canEdit) return toast('Only editors can restore a snapshot', true);
        if (!confirm('Restore this scene snapshot? The current state is kept in version history.')) return;
        const rr = await fetch(`/api/studio/projects/${DOC.id}/snapshots/${encodeURIComponent(snap.id)}/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const jj = await rr.json().catch(() => ({}));
        if (!rr.ok) return toast(jj.error || 'Restore failed', true);
        scene = normalizeScene(jj.content);
        project.version = jj.version;
        lastVersion = jj.version;
        renderAll();
        publishScene();
        dlg.close();
        toast('Snapshot restored; the next Studio snapshot reconciles the place');
      });
      list.append(row);
    }
  } catch (err) { list.textContent = err.message; }
}
$('studio-snapshot-btn')?.addEventListener('click', openSnapshots);
$('studio-snapshot-create')?.addEventListener('click', async () => {
  try {
    await fetch(`/api/studio/projects/${DOC.id}/snapshots`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Manual snapshot' }) });
    await openSnapshots();
  } catch (err) { toast(err.message, true); }
});
async function openHistory() {
  const dlg = $('studio-history-dialog');
  dlg.showModal();
  const list = $('studio-history-list');
  list.textContent = 'Loading…';
  try {
    const r = await fetch(`/api/workspace/docs/${DOC.id}/versions`);
    const j = await r.json();
    list.textContent = '';
    for (const v of (j.versions || []).slice(0, 30)) {
      const row = document.createElement('div');
      row.className = 'studio-snapshot-row';
      row.innerHTML = `<span><strong>Version ${v.version}</strong><small>${new Date(v.createdAt).toLocaleString()}</small></span><button class="btn btn-ghost btn-sm" type="button">Restore</button>`;
      row.querySelector('button').addEventListener('click', async () => {
        if (!confirm(`Restore version ${v.version}?`)) return;
        const rr = await fetch(`/api/workspace/docs/${DOC.id}/versions/${v.version}/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const jj = await rr.json();
        if (!rr.ok) return toast(jj.error || 'Restore failed', true);
        scene = normalizeScene(jj.content); project.version = jj.version; lastVersion = jj.version; clearHistory(); renderAll(); publishScene(); dlg.close();
        toast('Version restored in the browser; the next Studio snapshot reconciles the place');
      });
      list.append(row);
    }
  } catch (err) { list.textContent = err.message; }
}
$('studio-history-btn')?.addEventListener('click', openHistory);

// ----------------------------- tabs / render -----------------------------
function showTab(name) {
  activeTab = name;
  document.querySelectorAll('[data-studio-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.studioTab === name));
  document.querySelectorAll('[data-studio-view]').forEach((v) => { v.hidden = v.dataset.studioView !== name; });
  if (name === 'scripts') renderScriptTabs();
  if (name === 'gui') renderGui();
  if (name === 'tools') { renderLighting(); renderPerf(); }
  if (name === 'scene') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}
document.querySelectorAll('[data-studio-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.studioTab)));
$('studio-undo')?.addEventListener('click', undoLast);
$('studio-redo')?.addEventListener('click', redoLast);
renderHistoryButtons();
function renderLog() {
  const el = $('studio-log');
  if (!el) return;
  el.innerHTML = logLines.map((line) => `<div class="studio-log-line is-${line.level}"><time>${line.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>${esc(line.message)}</span></div>`).join('') || '<div class="studio-log-empty">No activity yet. Commands and Studio snapshots appear here.</div>';
}
function renderPerf() {
  $('studio-perf-nodes') && ($('studio-perf-nodes').textContent = String(allNodes().length));
  $('studio-perf-scripts') && ($('studio-perf-scripts').textContent = String(scriptNodes().length));
}
function renderAll() {
  renderTree(); renderProps(); renderScriptTabs(); renderGui(); renderLighting(); renderPerf(); rebuildViewport(); renderConnection(session);
}
renderLog();
renderAll();
showTab('scene');
// WebGL is opt-in: remote desktops and embedded previews can spend a long time
// creating a context, and that must never block the editor shell. The button
// starts Three.js after a real user gesture.
$('studio-start-viewport')?.addEventListener('click', (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  button.textContent = 'Starting 3D…';
  setTimeout(() => {
    try { initViewport(); } catch (err) { console.warn('Studio viewport failed', err); }
    if (viewport.renderer) button.remove();
    else { button.disabled = false; button.textContent = '3D preview unavailable'; }
  }, 0);
});
renderConnection(session);
pollProject();
// Let the editor settle before attaching the Yjs room; initializing during the
// first paint can race with the scene render and block the main thread.
setTimeout(initStudioCollab, 1200);
commandPoll = setInterval(pollProject, 3000);

window.addEventListener('beforeunload', () => clearInterval(commandPoll));
