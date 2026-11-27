import {
  TICKS, seconds, toSeconds, clamp, uid, normalizeProject, newProject, timelineDuration,
  defaultTrack, defaultText, applyEdit, applyEdits, rippleDelete, snapTime, formatTimecode,
  formatDuration, trackById, assetById, TRANSITIONS, SUBTITLE_STYLES, EFFECTS, MOTION_TEMPLATES,
  COLOR_PRESETS, EXPORT_PRESETS, VIDEO_CODECS, AUDIO_CODECS, CONTAINERS, codecCompatible,
  formatSrt, formatVtt, formatAss, parseSrt, parseAss, wordsToCues, subtitleStyleById, effectById,
  transitionById, frameOf, snapToFrame,
} from './schema.mjs';
import { MotionEngine, drawEffectPreview, drawTransitionPreview } from './engine.js';
import { parseCube } from './animations.mjs';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const DOC = window.__DOC__ || {};
const CAN_EDIT = window.__ACCESS__ ? window.__ACCESS__.canEdit !== false : true;
const API = `/api/motion/projects/${DOC.id}`;
const FRAME = 1e6 / 30;
const raf = () => new Promise((r) => requestAnimationFrame(r));
const deep = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const fmt = (t) => formatTimecode(project, Math.max(0, t), true);
const fmtShort = (t) => formatDuration(Math.max(0, t));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const app = $('#mo-app');
if (!app) throw new Error('Motion workspace missing');
let project = normalizeProject(DOC.content && typeof DOC.content === 'object' && !Array.isArray(DOC.content) ? DOC.content : newProject({ name: (DOC.filename || 'Untitled').replace(/\.[^.]+$/, '') }));
if (!project.name) project.name = (DOC.filename || 'Untitled').replace(/\.[^.]+$/, '');
let assets = [];
let assetMap = new Map();
let config = { ffmpeg: { available: false, encoders: [], hwaccels: [] }, limits: {}, whisper: { provider: 'disabled', enabled: false } };
let selection = new Set();
let selectedTrackId = null;
let clipboard = null;
let engine = null;
let ws = null;
let zoom = 72;
let snapEnabled = true;
let linkSelection = true;
let tool = 'select';
let leftTab = 'media';
let rightTab = 'inspector';
let mediaSearch = '';
let mediaFilter = 'all';
let assetSelection = null;
let history = [{ label: 'Open project', project: deep(project), time: 0 }];
let historyIndex = 0;
let autosaveTimer = null;
let activeGesture = null;
let jobPoll = null;
let exportFmt = 'mp4';
let exportFps = 30;
let exportW = 1920;
let exportH = 1080;
let compareImage = null;
let recording = null;
let lastPreviewFrame = null;
let prevSnapshotCanvas = null;
let collapseState = new Set();
let curveDrag = null;
let keyframeProperty = 'transform.x';
let audioPreview = null;
const waveCache = new Map();
const mediaCache = new Map();
const waveBitmapCache = new Map();
const clipElements = new Map();
let previewZoomMode = 'fit';
let previewFitFrame = 0;
let autoQuality = true;
let autoQualityLast = 0;
let timelineFrame = 0;

/* ------------------------------------------------------------------------- */
/* Toasts, API, save                                                         */
/* ------------------------------------------------------------------------- */

function toast(message, bad = false) {
  let host = $('.mo-toasts');
  if (!host) { host = document.createElement('div'); host.className = 'mo-toasts'; document.body.append(host); }
  const el = document.createElement('div');
  el.className = `mo-toast${bad ? ' bad' : ''}`;
  el.textContent = message;
  host.append(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3200);
}

async function request(path, opts = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status, body });
  return body;
}

function status(text) {
  const el = $('#mo-status');
  if (el) el.textContent = text;
}

function scheduleSave() {
  if (!CAN_EDIT) return;
  ws?.schedule?.();
  const el = $('#save-status');
  if (el) { el.textContent = 'Unsaved'; el.className = 'badge'; }
}

function bumpHistory(label, nextProject = project, time = engine?.time ?? 0) {
  if (JSON.stringify(history[historyIndex]?.project) === JSON.stringify(nextProject)) return;
  history = history.slice(0, historyIndex + 1);
  history.push({ label, project: deep(nextProject), time });
  if (history.length > 120) history.shift();
  historyIndex = history.length - 1;
  renderHistory();
}

function commitProject(label, nextProject, { save = true, time = null } = {}) {
  if (!CAN_EDIT) { toast('You have view-only access to this project.', true); return false; }
  try {
    const normalized = normalizeProject(deep(nextProject));
    project = normalized;
    bumpHistory(label, project, time ?? engine?.time ?? 0);
    afterProjectChange(time);
    if (save) scheduleSave();
    return true;
  } catch (err) {
    toast(err.message || 'Edit failed', true);
    return false;
  }
}

function commitOp(label, op, options = {}) {
  try {
    const next = applyEdit(project, op);
    return commitProject(label, next, options);
  } catch (err) {
    toast(err.message || 'Edit failed', true);
    return false;
  }
}

function commitOps(label, ops, options = {}) {
  try {
    const next = applyEdits(project, ops);
    return commitProject(label, next, options);
  } catch (err) {
    toast(err.message || 'Edit failed', true);
    return false;
  }
}

function afterProjectChange(time = null) {
  // Suspend the compositor while the project and the playhead are updated so
  // one edit paints exactly one preview frame instead of two.
  engine.suspend();
  engine.setProject(project);
  if (time !== null) engine.setTime(time);
  engine.resume();
  if (!project.tracks.find((t) => t.id === selectedTrackId)) selectedTrackId = project.tracks[0]?.id || null;
  selection = new Set([...selection].filter((id) => project.clips.some((c) => c.id === id)));
  renderAll();
  updateTimecode();
  applyPreviewLayout();
}

function renderAll() {
  renderTimeline();
  renderLeftPanel();
  renderInspector();
  renderMonitorMeta();
  updateStatusbar();
}

/* Selection-only updates avoid rebuilding the timeline, the media grid and the
 * effect previews (and therefore re-decoding thumbnails) on every click. */
function refreshSelectionUI() {
  $$('.mo-clip', tracksEl).forEach((el) => el.classList.toggle('is-selected', selection.has(el.dataset.clipId)));
  $$('.mo-track-head', trackHeadsEl).forEach((el) => el.classList.toggle('is-selected', el.dataset.trackId === selectedTrackId));
  $$('.mo-track-lane', tracksEl).forEach((el) => el.classList.toggle('is-selected', el.dataset.trackId === selectedTrackId));
  renderInspector();
  updateStatusbar();
}

/* ------------------------------------------------------------------------- */
/* Undo / redo                                                               */
/* ------------------------------------------------------------------------- */

function restoreHistory(index) {
  if (!CAN_EDIT && index !== historyIndex) { toast('View-only access', true); return; }
  historyIndex = clamp(index, 0, history.length - 1);
  const entry = history[historyIndex];
  project = normalizeProject(deep(entry.project));
  selection = new Set();
  engine.setProject(project);
  engine.setTime(entry.time || 0);
  renderAll();
  scheduleSave();
}

function undo() {
  if (historyIndex <= 0) return toast('Nothing to undo');
  restoreHistory(historyIndex - 1);
  status('Undo');
}
function redo() {
  if (historyIndex >= history.length - 1) return toast('Nothing to redo');
  restoreHistory(historyIndex + 1);
  status('Redo');
}

function renderHistory() {
  if (rightTab !== 'history') return;
  const body = $('#mo-right-body');
  if (!body) return;
  body.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'mo-history-list';
  history.forEach((entry, i) => {
    const row = document.createElement('button');
    row.className = `mo-history-item${i === historyIndex ? ' is-current' : ''}`;
    row.innerHTML = `<i>${String(i).padStart(2, '0')}</i><span>${esc(entry.label)}</span>`;
    row.addEventListener('click', () => restoreHistory(i));
    list.append(row);
  });
  body.append(list);
  if (history.length === 1) body.insertAdjacentHTML('afterbegin', '<p class="mo-fine" style="margin-bottom:8px">Editing operations appear here. Click an entry to restore that state.</p>');
}

/* ------------------------------------------------------------------------- */
/* Assets                                                                    */
/* ------------------------------------------------------------------------- */

async function loadAssets() {
  try {
    const j = await request(`${API}/assets`);
    assets = j.assets || [];
    assetMap = new Map(assets.map((a) => [a.id, a]));
    engine.setAssets(assets);
    renderLeftPanel();
    renderMonitorMeta();
    updateStatusbar();
  } catch (err) {
    status(`Media library unavailable: ${err.message}`);
  }
}

async function loadConfig() {
  try {
    const j = await request('/api/motion/config');
    config = j;
    const box = $('#mo-provider-note');
    if (box) {
      box.innerHTML = '<b>On-device Whisper.</b> Models run in this browser with WebAssembly; audio never leaves this device. The first run downloads the selected model once and caches it.';
    }
    const hw = config.ffmpeg?.hardwareDevices?.length ? config.ffmpeg.hardwareDevices.join(', ') : 'No hardware encoder detected; CPU encoding will be used.';
    const hwEl = $('#mo-export-hw');
    if (hwEl) hwEl.textContent = config.ffmpeg?.available ? `${hw} FFmpeg ${config.ffmpeg.version || ''}` : 'FFmpeg is not available on this server.';
  } catch (err) {
    toast(`Motion configuration unavailable: ${err.message}`, true);
  }
}

function assetIcon(kind) {
  return kind === 'video' ? 'VID' : kind === 'audio' ? 'AUD' : kind === 'image' ? 'IMG' : 'MED';
}

function assetMetaLine(a) {
  if (a.kind === 'image') return `${a.width || '?'} × ${a.height || '?'}`;
  const parts = [];
  if (a.width) parts.push(`${a.width}×${a.height}`);
  if (a.fps) parts.push(`${Math.round(a.fps * 100) / 100}fps`);
  if (a.duration) parts.push(fmtShort(Math.round(a.duration * TICKS)));
  return parts.join(' · ') || a.videoCodec || a.kind;
}

function addAssetToTimeline(assetId, options = {}) {
  const asset = assetMap.get(assetId);
  if (!asset) return;
  if (!CAN_EDIT) return toast('View-only access', true);
  const isAudio = asset.kind === 'audio';
  const track = options.trackId ? trackById(project, options.trackId)
    : project.tracks.find((t) => !t.hidden && (isAudio ? t.type === 'audio' : ['video', 'overlay'].includes(t.type) && !t.locked));
  if (!track) return toast(isAudio ? 'Add an audio track first' : 'Add a video track first', true);
  let start = options.start ?? snapToFrame(project, engine.time);
  const trackClips = project.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
  if (options.append !== false && !options.start) {
    const collides = trackClips.some((c) => start < c.start + c.duration && start + seconds(asset.duration || 5) > c.start);
    if (collides) start = trackClips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
  }
  const duration = Math.max(seconds(1), Math.round((Number(asset.duration) || 5) * TICKS));
  const clip = {
    trackId: track.id, type: isAudio ? 'audio' : asset.kind === 'image' ? 'image' : 'video', assetId: asset.id,
    name: asset.name || 'Clip', start, duration, inPoint: 0, transform: { opacity: 1 },
  };
  if (commitOp('Add clip', { op: 'add_clip', clip })) {
    const added = project.clips[project.clips.length - 1];
    selection = new Set([added.id]);
    selectedTrackId = track.id;
    engine.setTime(start);
    renderAll();
  }
}

function selectAsset(id) {
  assetSelection = id;
  const asset = assetMap.get(id);
  if (asset?.url) previewAsset(asset);
  renderLeftPanel();
}

async function previewAsset(asset) {
  if (asset.kind === 'image') return toast('Image selected — double-click to add to the timeline');
  if (audioPreview) { audioPreview.pause(); audioPreview = null; }
  audioPreview = new Audio(asset.url);
  audioPreview.play().catch(() => {});
}

/* ------------------------------------------------------------------------- */
/* Left panel                                                                */
/* ------------------------------------------------------------------------- */

function setLeftTab(tab) {
  leftTab = tab;
  $$('#mo-left-tabs button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  renderLeftPanel();
  if (tab === 'colors') { rightTab = 'color'; setRightTab('color'); }
}

function leftToolbar(html) {
  $('#mo-left-toolbar').innerHTML = html;
}

function simpleSearchToolbar(placeholder, actions = '') {
  return `<div class="mo-search-row"><input class="mo-search" id="mo-panel-search" placeholder="${placeholder}" value="${esc(mediaSearch)}">${actions}</div>`;
}

function bindSearch(onInput) {
  const input = $('#mo-panel-search');
  if (!input) return;
  input.addEventListener('input', () => { mediaSearch = input.value; onInput(); });
}

function renderLeftPanel() {
  const body = $('#mo-left-body');
  if (!body) return;
  const tabs = $$('#mo-left-tabs button');
  tabs.forEach((b) => { b.classList.toggle('is-active', b.dataset.tab === leftTab); });
  switch (leftTab) {
    case 'media': renderMediaPanel(); break;
    case 'audio': renderAudioPanel(); break;
    case 'effects': renderEffectsPanel(); break;
    case 'transitions': renderTransitionsPanel(); break;
    case 'subtitles': renderSubtitlesPanel(); break;
    case 'text': renderTextPanel(); break;
    case 'colors': renderColorPresetsPanel(); break;
    default: body.innerHTML = '';
  }
}

function renderMediaPanel() {
  leftToolbar(simpleSearchToolbar('Search media…', '<button class="mo-btn primary" data-media="import" title="Import media">+</button>'));
  const body = $('#mo-left-body');
  if (!body) return;
  const folders = [
    ['all', 'All'], ['video', 'Video'], ['audio', 'Audio'], ['image', 'Images'], ['recording', 'Recordings'], ['url', 'URL imports'],
  ];
  const filtered = assets.filter((a) => {
    if (mediaFilter !== 'all') {
      if (mediaFilter === 'recording') return a.source === 'recording';
      if (mediaFilter === 'url') return a.source === 'url';
      return a.kind === mediaFilter;
    }
    return true;
  }).filter((a) => `${a.name} ${a.videoCodec || ''} ${a.audioCodec || ''}`.toLowerCase().includes(mediaSearch.toLowerCase()));
  body.innerHTML = '';
  const foldersEl = document.createElement('div');
  foldersEl.className = 'mo-media-folders';
  folders.forEach(([id, label]) => {
    const b = document.createElement('button');
    b.className = `mo-folder-chip${mediaFilter === id ? ' is-active' : ''}`;
    b.textContent = label;
    b.addEventListener('click', () => { mediaFilter = id; renderMediaPanel(); });
    foldersEl.append(b);
  });
  body.append(foldersEl);
  const summary = document.createElement('div');
  summary.className = 'mo-media-summary';
  summary.innerHTML = `<span>${filtered.length} asset${filtered.length === 1 ? '' : 's'}</span><span class="mo-spacer"></span><span>${assets.length} / ${config.limits?.maxAssetsPerProject || '—'} used</span>`;
  body.append(summary);
  const grid = document.createElement('div');
  grid.className = 'mo-media-grid';
  if (!filtered.length) {
    grid.innerHTML = `<div class="mo-empty" style="grid-column:1/-1"><b>No media yet</b>Import video, audio or images, or record directly into the project.</div>`;
  }
  for (const a of filtered) {
    const card = document.createElement('div');
    card.className = `mo-asset${assetSelection === a.id ? ' is-selected' : ''}`;
    card.draggable = true;
    card.dataset.assetId = a.id;
    card.innerHTML = `
      <div class="mo-asset-thumb" style="${a.thumbnailUrl ? `background-image:url('${a.thumbnailUrl}')` : ''}">
        ${!a.thumbnailUrl ? `<span>${a.kind === 'audio' ? '♪' : a.kind === 'image' ? '▣' : '▶'}</span>` : ''}
        <span class="mo-asset-kind">${assetIcon(a.kind)}${a.hasProxy ? ' · PROXY' : ''}</span>
        ${a.duration ? `<span class="mo-asset-dur">${fmtShort(Math.round(a.duration * TICKS))}</span>` : ''}
      </div>
      <div class="mo-asset-info"><b title="${esc(a.name)}">${esc(a.name)}</b><span>${esc(assetMetaLine(a))}</span></div>
      <div class="mo-asset-actions">
        <button type="button" data-asset-add="${a.id}" title="Add to timeline">＋</button>
        <button type="button" data-asset-menu="${a.id}" title="Asset options">⋯</button>
      </div>`;
    card.addEventListener('click', (e) => { if (!e.target.closest('button')) selectAsset(a.id); });
    card.addEventListener('dblclick', () => addAssetToTimeline(a.id));
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-cascade-asset', a.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    card.querySelector('[data-asset-menu]').addEventListener('click', (e) => assetMenu(a, e.clientX, e.clientY));
    grid.append(card);
  }
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'mo-import-tile';
  tile.innerHTML = '<span><b>+</b>Import</span>';
  tile.addEventListener('click', () => $('#mo-import-dlg').showModal());
  grid.append(tile);
  body.append(grid);
  bindSearch(renderMediaPanel);
  $$('[data-media="import"]').forEach((b) => b.addEventListener('click', () => $('#mo-import-dlg').showModal()));
  const bodyEl = $('#mo-left-body');
  if (bodyEl) {
    bodyEl.addEventListener('dragover', (e) => e.preventDefault());
    bodyEl.addEventListener('drop', (e) => {
      if (e.dataTransfer.files?.length) { e.preventDefault(); uploadFiles([...e.dataTransfer.files]); }
    }, { once: true });
  }
}

function assetMenu(asset, x, y) {
  closeContext();
  const menu = document.createElement('div');
  menu.className = 'mo-context';
  menu.innerHTML = `
    <button type="button" data-a="add">Add to timeline</button>
    <button type="button" data-a="relink">Relink all clips…</button>
    <button type="button" data-a="select">Select clips using asset</button>
    <button type="button" data-a="download">Download original</button>
    <div class="mo-menu-sep"></div>
    <button type="button" data-a="delete">Remove from project</button>`;
  placeContext(menu, x, y);
  const close = () => menu.remove();
  menu.querySelector('[data-a="add"]').onclick = () => { addAssetToTimeline(asset.id); close(); };
  menu.querySelector('[data-a="download"]').onclick = () => { window.open(asset.url, '_blank'); close(); };
  menu.querySelector('[data-a="select"]').onclick = () => {
    selection = new Set(project.clips.filter((c) => c.assetId === asset.id).map((c) => c.id));
    renderAll(); close();
  };
  menu.querySelector('[data-a="relink"]').onclick = () => {
    pendingRelink = asset.id;
    $('#mo-file-input').click();
    close();
  };
  menu.querySelector('[data-a="delete"]').onclick = async () => {
    close();
    if (!confirm(`Remove "${asset.name}" from this project? Clips using it will show as missing media.`)) return;
    try {
      await request(`/api/motion/assets/${asset.id}`, { method: 'DELETE' });
      await loadAssets(); toast('Asset removed');
    } catch (err) { toast(err.message, true); }
  };
}

let pendingRelink = null;

function renderAudioPanel() {
  leftToolbar(simpleSearchToolbar('Search music and SFX…', '<button class="mo-btn" data-audio="refresh" title="Refresh library">↻</button>'));
  const body = $('#mo-left-body');
  body.innerHTML = '<p class="mo-fine">Loading audio library…</p>';
  request('/api/motion/audio/library').then((j) => {
    if (leftTab !== 'audio') return;
    const favorites = new Set(JSON.parse(localStorage.getItem('cascade:motion:audio-favs') || '[]'));
    const q = mediaSearch.toLowerCase();
    const tracks = (j.tracks || []).filter((t) => `${t.title} ${t.artist} ${t.tags?.join(' ')}`.toLowerCase().includes(q));
    body.innerHTML = '';
    const lib = document.createElement('div');
    lib.className = 'mo-audio-list';
    if (!tracks.length) lib.innerHTML = '<div class="mo-empty"><b>No audio found</b>Upload music in Cascade Files or configure an audio catalog in Admin → Motion.</div>';
    tracks.forEach((track) => {
      const item = document.createElement('div');
      item.className = `mo-audio-item${favorites.has(track.id) ? ' is-favorite' : ''}`;
      item.innerHTML = `<button class="mo-audio-play" title="Preview">▶</button>
        <div class="mo-audio-meta"><b>${esc(track.title)}</b><span>${esc(track.artist || 'Unknown artist')} · ${esc(track.category || 'Audio')}${track.bpm ? ` · ${track.bpm} BPM` : ''}</span><span>${esc(track.license || '')} ${track.attribution ? `· ${esc(track.attribution)}` : ''}</span></div>
        ${track.duration ? `<span class="mo-audio-dur">${fmtShort(Math.round(track.duration * TICKS))}</span>` : ''}
        <button class="mo-audio-fav${favorites.has(track.id) ? ' on' : ''}" title="Favorite">★</button>
        <button class="mo-btn mo-btn-icon" data-audio-add="${esc(track.id)}" title="Add to timeline">＋</button>`;
      const play = item.querySelector('.mo-audio-play');
      play.addEventListener('click', () => {
        if (audioPreview) { audioPreview.pause(); audioPreview = null; }
        if (play.dataset.playing === '1') { play.dataset.playing = '0'; play.textContent = '▶'; return; }
        audioPreview = new Audio(track.url);
        audioPreview.play().catch(() => toast('Preview unavailable', true));
        play.dataset.playing = '1'; play.textContent = '❚❚';
        audioPreview.onended = () => { play.dataset.playing = '0'; play.textContent = '▶'; };
      });
      item.querySelector('.mo-audio-fav').addEventListener('click', (e) => {
        e.stopPropagation();
        if (favorites.has(track.id)) favorites.delete(track.id); else favorites.add(track.id);
        localStorage.setItem('cascade:motion:audio-favs', JSON.stringify([...favorites]));
        renderAudioPanel();
      });
      item.querySelector('[data-audio-add]').addEventListener('click', () => addLibraryAudio(track));
      lib.append(item);
    });
    body.append(lib);
    bindSearch(renderAudioPanel);
    $$('[data-audio="refresh"]').forEach((b) => b.addEventListener('click', renderAudioPanel));
  }).catch((err) => { body.innerHTML = `<p class="mo-empty">${esc(err.message)}</p>`; });
}

async function addLibraryAudio(track) {
  try {
    let asset = assets.find((a) => (track.fileId && a.fileId === track.fileId) || (track.url && a.url === track.url));
    if (!asset) {
      if (track.fileId) {
        const j = await request(`${API}/assets/attach`, { method: 'POST', body: JSON.stringify({ fileId: track.fileId }) });
        asset = j.asset;
      } else if (/^https?:/i.test(track.url || '')) {
        const j = await request(`${API}/assets/remote`, { method: 'POST', body: JSON.stringify({ url: track.url }) });
        asset = j.asset;
      } else return toast('This catalog track cannot be imported automatically', true);
      await loadAssets();
    }
    addAssetToTimeline(asset.id);
    toast(`Added “${track.title}”`);
  } catch (err) { toast(err.message, true); }
}

let libraryPreviewAnim = null;
function stopLibraryPreview(canvas = null) {
  if (!libraryPreviewAnim || (canvas && libraryPreviewAnim.canvas !== canvas)) return;
  cancelAnimationFrame(libraryPreviewAnim.raf);
  libraryPreviewAnim = null;
}
function animateLibraryPreview(canvas, draw) {
  stopLibraryPreview();
  const start = performance.now();
  let last = 0;
  const tick = (now) => {
    if (!canvas.isConnected) { libraryPreviewAnim = null; return; }
    if (now - last >= 33) {
      last = now;
      draw(((now - start) % 2400) / 2400);
    }
    libraryPreviewAnim = { canvas, raf: requestAnimationFrame(tick) };
  };
  libraryPreviewAnim = { canvas, raf: requestAnimationFrame(tick) };
}

function renderEffectsPanel() {
  stopLibraryPreview();
  const body = $('#mo-left-body');
  const cats = ['All', ...new Set(EFFECTS.map((e) => e.category))];
  const currentCat = body.dataset.cat || 'All';
  leftToolbar(simpleSearchToolbar('Search 100+ effects…'));
  body.innerHTML = '';
  const catRow = document.createElement('div');
  catRow.className = 'mo-category-tabs';
  cats.forEach((cat) => {
    const b = document.createElement('button');
    b.className = `mo-cat${currentCat === cat ? ' is-active' : ''}`;
    b.textContent = cat;
    b.addEventListener('click', () => { body.dataset.cat = cat; renderEffectsPanel(); });
    catRow.append(b);
  });
  body.append(catRow);
  const grid = document.createElement('div');
  grid.className = 'mo-preset-grid';
  const filtered = EFFECTS.filter((e) => (currentCat === 'All' || e.category === currentCat) && `${e.name} ${e.category}`.toLowerCase().includes(mediaSearch.toLowerCase()));
  filtered.forEach((fx) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'mo-preset';
    card.draggable = true;
    card.dataset.effectId = fx.id;
    card.innerHTML = `<div class="mo-preset-visual"><canvas class="mo-library-preview" width="264" height="96" aria-hidden="true"></canvas></div><div class="mo-preset-label">${esc(fx.name)}<span>${esc(fx.category)}</span></div>`;
    card.title = `${fx.name} — ${fx.category}${fx.ffmpeg ? ' · FFmpeg-backed' : ' · canvas renderer'}`;
    const preview = card.querySelector('canvas');
    drawEffectPreview(preview, fx.id, 400);
    card.addEventListener('pointerenter', () => animateLibraryPreview(preview, (progress) => drawEffectPreview(preview, fx.id, progress * 2600)));
    card.addEventListener('pointerleave', () => { stopLibraryPreview(preview); drawEffectPreview(preview, fx.id, 400); });
    card.addEventListener('click', () => applyEffectToSelection(fx.id));
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-cascade-effect', fx.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    grid.append(card);
  });
  body.append(grid);
  if (!filtered.length) body.insertAdjacentHTML('beforeend', '<div class="mo-empty"><b>No matching effects</b>Try another category.</div>');
  body.insertAdjacentHTML('beforeend', '<p class="mo-fine" style="margin-top:8px">Select a clip, then click an effect or drag it onto a clip. Hover a card to play its preview; every parameter is editable in the inspector.</p>');
  bindSearch(renderEffectsPanel);
}

function applyEffectToSelection(effectId, clipId = null) {
  const targets = clipId ? [clipId] : [...selection];
  if (!targets.length) return toast('Select a clip first', true);
  if (!CAN_EDIT) return toast('View-only access', true);
  let next = project;
  try {
    for (const id of targets) next = applyEdit(next, { op: 'add_effect', clipId: id, type: effectId });
    commitProject('Add effect', next);
    rightTab = 'inspector'; setRightTab('inspector');
    toast(`Added ${effectById(effectId)?.name || effectId}`);
  } catch (err) { toast(err.message, true); }
}

function renderTransitionsPanel() {
  stopLibraryPreview();
  leftToolbar(simpleSearchToolbar('Search transitions…', '<input id="mo-tr-duration" type="number" min="0.1" max="8" step="0.1" value="0.6" title="Transition duration (seconds)" style="width:54px;height:26px;background:var(--mo-panel-2);border:1px solid var(--mo-line);border-radius:4px;padding:0 4px">'));
  const body = $('#mo-left-body');
  const cats = ['All', ...new Set(TRANSITIONS.map((t) => t.category))];
  const currentCat = body.dataset.cat || 'All';
  body.innerHTML = '';
  const info = document.createElement('div');
  info.className = 'mo-tr-controls';
  const selected = [...selection].map((id) => project.clips.find((c) => c.id === id)).filter(Boolean);
  const active = selected[0]?.transitionIn;
  info.innerHTML = `<div class="mo-row"><span class="mo-label">Applies to</span><span class="mo-spacer"></span><b style="font-size:9px">${selected.length ? esc(selected.length === 1 ? selected[0].name : `${selected.length} clips`) : 'No clip selected'}</b></div>
    <div class="mo-row"><span class="mo-label">Current</span><span class="mo-spacer"></span><span style="font-size:9px">${active ? esc(transitionById(active.type)?.name || active.type) : 'None'}</span></div>
    <div class="mo-row"><button class="mo-btn" data-tr="remove" style="flex:1">Remove transition</button><button class="mo-btn" data-tr="swap" style="flex:1">Swap to out</button></div>`;
  body.append(info);
  const catRow = document.createElement('div');
  catRow.className = 'mo-category-tabs';
  cats.forEach((cat) => {
    const b = document.createElement('button');
    b.className = `mo-cat${currentCat === cat ? ' is-active' : ''}`;
    b.textContent = cat;
    b.addEventListener('click', () => { body.dataset.cat = cat; renderTransitionsPanel(); });
    catRow.append(b);
  });
  body.append(catRow);
  const grid = document.createElement('div');
  grid.className = 'mo-preset-grid';
  const filtered = TRANSITIONS.filter((t) => (currentCat === 'All' || t.category === currentCat) && `${t.name} ${t.category}`.toLowerCase().includes(mediaSearch.toLowerCase()));
  filtered.forEach((tr) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `mo-preset mo-transition-card${active?.type === tr.id ? ' is-active' : ''}`;
    card.innerHTML = `<div class="mo-preset-visual"><canvas class="mo-library-preview" width="296" height="116" aria-hidden="true"></canvas></div><div class="mo-preset-label">${esc(tr.name)}<span>${tr.defaultDuration}s · ${esc(tr.engine)}</span></div>`;
    const preview = card.querySelector('canvas');
    drawTransitionPreview(preview, tr.id, 0.55);
    card.addEventListener('pointerenter', () => animateLibraryPreview(preview, (progress) => drawTransitionPreview(preview, tr.id, progress)));
    card.addEventListener('pointerleave', () => { stopLibraryPreview(preview); drawTransitionPreview(preview, tr.id, 0.55); });
    card.addEventListener('click', () => applyTransition(tr.id));
    grid.append(card);
  });
  body.append(grid);
  if (!filtered.length) body.insertAdjacentHTML('beforeend', '<div class="mo-empty"><b>No matching transitions</b></div>');
  body.insertAdjacentHTML('beforeend', '<p class="mo-fine" style="margin-top:8px">Hover a transition to preview it against the sample frames, then click to apply it to the selected incoming clip.</p>');
  info.querySelector('[data-tr="remove"]').addEventListener('click', () => {
    if (!selection.size) return toast('Select a clip first', true);
    const next = deep(project);
    next.clips.forEach((c) => { if (selection.has(c.id)) c.transitionIn = null; });
    commitProject('Remove transition', next);
  });
  info.querySelector('[data-tr="swap"]').addEventListener('click', () => {
    if (!selection.size) return toast('Select a clip first', true);
    const next = deep(project);
    next.clips.forEach((c) => { if (selection.has(c.id) && c.transitionIn) { c.transitionOut = c.transitionIn; c.transitionIn = null; } });
    commitProject('Swap transition', next);
  });
  bindSearch(renderTransitionsPanel);
}

function applyTransition(type) {
  if (!selection.size) return toast('Select the incoming clip first', true);
  const dur = Math.max(1, Number($('#mo-tr-duration')?.value || 0.6) * TICKS);
  let next = project;
  try {
    for (const id of selection) next = applyEdit(next, { op: 'add_transition', clipId: id, type, duration: dur });
    commitProject(`Add ${transitionById(type)?.name || 'transition'}`, next);
    renderTransitionsPanel();
    toast(`Applied ${transitionById(type)?.name || type}`);
  } catch (err) { toast(err.message, true); }
}

/* ------------------------------------------------------------------------- */
/* Subtitles                                                                 */
/* ------------------------------------------------------------------------- */

function subtitleClips() {
  const track = project.tracks.find((t) => t.type === 'subtitle');
  return project.clips.filter((c) => c.type === 'subtitle' && (!track || c.trackId === track.id)).sort((a, b) => a.start - b.start);
}

function renderSubtitlesPanel() {
  const body = $('#mo-left-body');
  const cues = subtitleClips();
  const selected = cues.find((c) => selection.has(c.id)) || null;
  leftToolbar(`<div class="mo-search-row"><input class="mo-search" id="mo-panel-search" placeholder="Search captions…" value="${esc(mediaSearch)}"><button class="mo-btn" data-sub="import" title="Import SRT/VTT/ASS">Import</button><button class="mo-btn" data-sub="export" title="Export subtitles">Export</button></div>`);
  body.innerHTML = '';
  const actions = document.createElement('div');
  actions.className = 'mo-row';
  actions.style.marginBottom = '7px';
  actions.innerHTML = `<button class="mo-btn primary" data-sub="transcribe">✦ Transcribe</button><button class="mo-btn" data-sub="add">+ Cue</button><button class="mo-btn" data-sub="fill" title="Fill from transcript">⚡</button>`;
  body.append(actions);
  const styleWrap = document.createElement('div');
  styleWrap.className = 'mo-section';
  styleWrap.innerHTML = `<div class="mo-section-head"><h3>Caption style</h3><span class="mo-spacer"></span><button data-sub="style-more" title="Show all styles">${SUBTITLE_STYLES.length} styles</button></div>`;
  const styleGrid = document.createElement('div');
  styleGrid.className = 'mo-sub-style-grid';
  const styleId = selected?.subtitle?.styleId || 'classic-white';
  const styles = SUBTITLE_STYLES.filter((s) => mediaSearch ? `${s.name} ${s.category}`.toLowerCase().includes(mediaSearch.toLowerCase()) : true);
  styles.slice(0, mediaSearch ? styles.length : 10).forEach((style) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `mo-sub-style${styleId === style.id ? ' is-active' : ''}`;
    card.innerHTML = `<canvas width="160" height="42"></canvas><span>${esc(style.name)}</span>`;
    styleGrid.append(card);
    queueMicrotask(() => engine?.drawSubtitlePreview(card.querySelector('canvas'), style.id, style.name.split(' ').slice(0, 3).join(' ')));
    card.addEventListener('click', () => applySubtitleStyle(style.id));
  });
  styleWrap.append(styleGrid);
  if (!mediaSearch) styleWrap.insertAdjacentHTML('beforeend', `<button class="mo-btn wide" data-sub="style-more" style="margin-top:5px">Browse all ${SUBTITLE_STYLES.length} styles</button>`);
  body.append(styleWrap);
  const listHead = document.createElement('div');
  listHead.className = 'mo-section-head';
  listHead.innerHTML = `<h3>Cues · ${cues.length}</h3><span class="mo-spacer"></span><span class="mo-fine">${mediaSearch ? 'Filtered' : 'Timeline order'}</span>`;
  body.append(listHead);
  const list = document.createElement('div');
  list.className = 'mo-cue-list';
  const visible = cues.filter((c) => !mediaSearch || `${c.subtitle.text} ${c.subtitle.speaker || ''}`.toLowerCase().includes(mediaSearch.toLowerCase()));
  if (!visible.length) list.innerHTML = '<p class="mo-empty">No captions yet. Transcribe a clip or import a subtitle file.</p>';
  visible.forEach((cue) => {
    const row = document.createElement('div');
    row.className = `mo-cue${selection.has(cue.id) ? ' is-active' : ''}`;
    row.innerHTML = `<time>${shortClock(cue.start)}</time><b>${esc(cue.subtitle.text || '(empty cue)')}</b><button title="Delete cue">✕</button>`;
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      selection = new Set([cue.id]); selectedTrackId = cue.trackId;
      engine.setTime(cue.start);
      renderAll();
    });
    row.querySelector('button').addEventListener('click', () => {
      selection = new Set([cue.id]);
      commitOp('Delete caption', { op: 'remove_clip', clipId: cue.id });
    });
    list.append(row);
  });
  body.append(list);
  if (selected) {
    const editor = document.createElement('div');
    editor.className = 'mo-cue-editor mo-section';
    editor.innerHTML = `<div class="mo-section-head"><h3>Selected cue</h3><span class="mo-spacer"></span><button data-sub="focus">Reveal</button></div>
      <label class="mo-field"><span>Text</span><textarea id="mo-cue-text" rows="3">${esc(selected.subtitle.text)}</textarea></label>
      <div class="mo-grid-2"><label class="mo-field"><span>Start (s)</span><input type="number" id="mo-cue-start" step="0.01" value="${(toSeconds(selected.start)).toFixed(2)}"></label>
      <label class="mo-field"><span>End (s)</span><input type="number" id="mo-cue-end" step="0.01" value="${(toSeconds(selected.start + selected.duration)).toFixed(2)}"></label></div>
      <label class="mo-field"><span>Speaker</span><input type="text" id="mo-cue-speaker" value="${esc(selected.subtitle.speaker || '')}" placeholder="Optional speaker label"></label>
      <div class="mo-search-row"><input class="mo-search" id="mo-cue-search" placeholder="Search words in all cues"><button class="mo-btn" data-sub="replace">Replace</button></div>`;
    editor.querySelector('#mo-cue-text').addEventListener('change', (e) => patchSubtitle(selected.id, { text: e.target.value }, 'Edit caption'));
    editor.querySelector('#mo-cue-start').addEventListener('change', (e) => setCueTiming(selected, Number(e.target.value) * TICKS, null));
    editor.querySelector('#mo-cue-end').addEventListener('change', (e) => setCueTiming(selected, null, Number(e.target.value) * TICKS));
    editor.querySelector('#mo-cue-speaker').addEventListener('change', (e) => patchSubtitle(selected.id, { speaker: e.target.value }, 'Speaker label'));
    editor.querySelector('[data-sub="focus"]').addEventListener('click', () => { engine.setTime(selected.start); });
    editor.querySelector('[data-sub="replace"]').addEventListener('click', () => {
      const q = editor.querySelector('#mo-cue-search').value;
      if (!q) return;
      const replace = prompt(`Replace all occurrences of “${q}” with:`, '');
      if (replace === null) return;
      const next = deep(project);
      let count = 0;
      next.clips.forEach((c) => {
        if (c.type !== 'subtitle') return;
        if (c.subtitle.text.includes(q)) { c.subtitle.text = c.subtitle.text.split(q).join(replace); count += 1; }
        c.subtitle.words = (c.subtitle.words || []).map((w) => (w.text.includes(q) ? { ...w, text: w.text.split(q).join(replace) } : w));
      });
      commitProject('Replace caption text', next);
      toast(`Updated ${count} cue${count === 1 ? '' : 's'}`);
    });
    body.append(editor);
  }
  bindSearch(renderSubtitlesPanel);
  actions.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => handleSubtitleAction(b.dataset.sub, selected)));
  $$('[data-sub="style-more"]').forEach((b) => b.addEventListener('click', () => { mediaSearch = ''; renderSubtitlesPanel(); }));
}

function shortClock(ticks) {
  const s = Math.max(0, ticks) / TICKS;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
}

function patchSubtitle(clipId, patch, label) {
  const next = deep(project);
  const clip = next.clips.find((c) => c.id === clipId);
  if (!clip) return;
  clip.subtitle = { ...clip.subtitle, ...patch };
  commitProject(label, next);
}

function setCueTiming(cue, start, end) {
  const next = deep(project);
  const clip = next.clips.find((c) => c.id === cue.id);
  if (!clip) return;
  const newStart = start ?? clip.start;
  const newEnd = end ?? clip.start + clip.duration;
  if (newEnd <= newStart + 5000) return toast('Cue must be at least 5ms long', true);
  const delta = newStart - clip.start;
  clip.start = newStart;
  clip.duration = newEnd - newStart;
  if (delta && clip.subtitle.words?.length) clip.subtitle.words = clip.subtitle.words.map((w) => ({ ...w, start: w.start + delta, end: w.end + delta }));
  commitProject('Adjust caption timing', next);
}

function applySubtitleStyle(styleId) {
  const cues = selection.size ? [...selection] : [];
  if (!cues.length) return toast('Select a caption cue first', true);
  const next = deep(project);
  next.clips.forEach((c) => { if (selection.has(c.id) && c.type === 'subtitle') c.subtitle.styleId = styleId; });
  commitProject(`Caption style: ${subtitleStyleById(styleId).name}`, next);
  renderSubtitlesPanel();
}

function handleSubtitleAction(action, selected) {
  if (action === 'add') {
    const track = project.tracks.find((t) => t.type === 'subtitle');
    if (!track) return toast('Add a subtitle track first', true);
    const start = snapToFrame(project, engine.time);
    const next = applyEdit(project, { op: 'add_subtitle', trackId: track.id, start, duration: seconds(2), text: 'New caption', styleId: 'classic-white' });
    commitProject('Add caption', next);
    const added = project.clips[project.clips.length - 1];
    selection = new Set([added.id]); selectedTrackId = track.id;
    renderAll();
  } else if (action === 'import') {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.srt,.vtt,.ass';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const text = await file.text();
      const cues = /^\[Script Info\]/i.test(text) ? parseAss(text) : parseSrt(text.replace(/^WEBVTT[^\n]*\n/i, ''));
      importCues(cues);
    };
    input.click();
  } else if (action === 'export') {
    exportSubtitles();
  } else if (action === 'transcribe') {
    openTranscribe(selected);
  } else if (action === 'fill') {
    fillFromTranscript();
  }
}

function importCues(cues) {
  if (!cues.length) return toast('No cues found in that file', true);
  let next = deep(project);
  let track = next.tracks.find((t) => t.type === 'subtitle');
  if (!track) { track = defaultTrack('subtitle', { name: 'Subtitles' }); next.tracks.push(track); }
  if (confirm('Replace existing captions on this subtitle track?')) next.clips = next.clips.filter((c) => c.trackId !== track.id);
  for (const cue of cues) {
    next.clips.push({
      id: uid('clip'), trackId: track.id, type: 'subtitle', name: String(cue.text).slice(0, 40), start: cue.start,
      duration: Math.max(1000, cue.end - cue.start), subtitle: { text: cue.text, words: [], styleId: 'classic-white' },
      transform: {}, color: {}, audio: {}, effects: [], keyframes: {},
    });
  }
  commitProject(`Import ${cues.length} captions`, next);
  toast(`Imported ${cues.length} cues`);
}

function exportSubtitles() {
  const cues = subtitleClips().map((c) => ({ start: c.start, end: c.start + c.duration, text: c.subtitle.text, words: c.subtitle.words }));
  if (!cues.length) return toast('No captions to export', true);
  const fmt = prompt('Export format: srt, vtt or ass', 'srt');
  if (!fmt) return;
  const text = fmt.toLowerCase() === 'vtt' ? formatVtt(cues) : fmt.toLowerCase() === 'ass' ? formatAss(cues) : formatSrt(cues);
  downloadBlob(new Blob([text], { type: 'text/plain' }), `${project.name || 'captions'}.${fmt.toLowerCase()}`);
}

let transcriptCache = null;
function fillFromTranscript() {
  if (!transcriptCache?.length) return toast('No transcript cache. Run Whisper transcription first.', true);
  const cues = wordsToCues(transcriptCache);
  importCues(cues);
}

/* ------------------------------------------------------------------------- */
/* Text and motion graphics                                                  */
/* ------------------------------------------------------------------------- */

function renderTextPanel() {
  leftToolbar(simpleSearchToolbar('Search titles and templates…', '<button class="mo-btn" data-text="new">+ Text</button>'));
  const body = $('#mo-left-body');
  body.innerHTML = '';
  const shapeRow = document.createElement('div');
  shapeRow.className = 'mo-row';
  shapeRow.style.marginBottom = '8px';
  shapeRow.innerHTML = `<button class="mo-btn" data-shape="rect">▭ Shape</button><button class="mo-btn" data-shape="ellipse">◯ Shape</button><button class="mo-btn" data-shape="line">╱ Line</button>`;
  body.append(shapeRow);
  const cats = ['All', ...new Set(MOTION_TEMPLATES.map((t) => t.category))];
  const currentCat = body.dataset.cat || 'All';
  const catRow = document.createElement('div');
  catRow.className = 'mo-category-tabs';
  cats.forEach((cat) => {
    const b = document.createElement('button');
    b.className = `mo-cat${currentCat === cat ? ' is-active' : ''}`;
    b.textContent = cat;
    b.addEventListener('click', () => { body.dataset.cat = cat; renderTextPanel(); });
    catRow.append(b);
  });
  body.append(catRow);
  const grid = document.createElement('div');
  grid.className = 'mo-template-grid';
  const filtered = MOTION_TEMPLATES.filter((t) => (currentCat === 'All' || t.category === currentCat) && `${t.name} ${t.text} ${t.category}`.toLowerCase().includes(mediaSearch.toLowerCase()));
  filtered.forEach((tpl) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'mo-template';
    const size = Math.min(18, 8 + (tpl.style.fontSize || 0.05) * 120);
    card.innerHTML = `<div class="mo-template-preview" style="font-size:${size}px;color:${esc(tpl.style.color || '#fff')};${tpl.style.background ? `background:${esc(tpl.style.background.color)}` : ''}">${esc(tpl.text.split('\n')[0])}<small>${esc(tpl.text.split('\n')[1] || '')}</small></div><div class="mo-template-label">${esc(tpl.name)}</div>`;
    card.title = `${tpl.name} (${tpl.category})`;
    card.addEventListener('click', () => applyTemplate(tpl.id));
    grid.append(card);
  });
  body.append(grid);
  if (!filtered.length) body.insertAdjacentHTML('beforeend', '<div class="mo-empty">No matching templates</div>');
  body.insertAdjacentHTML('beforeend', `<p class="mo-fine" style="margin-top:8px">${MOTION_TEMPLATES.length} editable title templates. Double-click a text clip on the timeline to edit it here.</p>`);
  $('#mo-left-toolbar [data-text="new"]')?.addEventListener('click', () => addTextClip('Your text'));
  body.querySelectorAll('[data-shape]').forEach((b) => b.addEventListener('click', () => addShape(b.dataset.shape)));
  bindSearch(renderTextPanel);
}

function addTextClip(text = 'Your text', style = {}, animation = 'fade-in', duration = 5) {
  try {
    let track = project.tracks.find((t) => t.type === 'text' && !t.hidden);
    let next = project;
    if (!track) {
      next = applyEdit(next, { op: 'add_track', type: 'text', track: { name: 'Titles' } });
      track = next.tracks[next.tracks.length - 1];
    }
    const start = snapToFrame(project, engine.time);
    next = applyEdit(next, {
      op: 'add_text', trackId: track.id, start, duration: seconds(duration), text,
      style, name: text.split('\n')[0].slice(0, 40),
    });
    // add_text cannot carry animation, set it after creation.
    const added = next.clips[next.clips.length - 1];
    added.text.animation = animation;
    added.text.template = arguments[4] || null;
    commitProject('Add title', next);
    selection = new Set([added.id]); selectedTrackId = track.id;
    rightTab = 'inspector'; setRightTab('inspector');
    renderAll();
  } catch (err) { toast(err.message, true); }
}

function applyTemplate(id) {
  const tpl = MOTION_TEMPLATES.find((t) => t.id === id);
  if (!tpl) return;
  addTextClip(tpl.text, { ...defaultText(tpl.text), ...tpl.style }, tpl.animation, tpl.duration);
}

function addShape(shape) {
  const track = project.tracks.find((t) => ['video', 'overlay'].includes(t.type) && !t.locked) || project.tracks[0];
  if (!track) return toast('No video track', true);
  const start = snapToFrame(project, engine.time);
  const clip = {
    trackId: track.id, type: 'shape', name: `${shape[0].toUpperCase()}${shape.slice(1)} shape`, start, duration: seconds(5),
    shape: { shape, x: 0.1, y: 0.1, w: 0.8, h: 0.8, fill: '#e11d48', strokeWidth: 0.004 },
  };
  if (commitOp('Add shape', { op: 'add_clip', clip })) {
    const added = project.clips[project.clips.length - 1];
    selection = new Set([added.id]);
    renderAll();
  }
}

/* ------------------------------------------------------------------------- */
/* Color presets                                                             */
/* ------------------------------------------------------------------------- */

function renderColorPresetsPanel() {
  leftToolbar(simpleSearchToolbar('Search color presets…'));
  const body = $('#mo-left-body');
  body.innerHTML = '';
  const selectedClip = [...selection].map((id) => project.clips.find((c) => c.id === id)).find(Boolean);
  const intro = document.createElement('p');
  intro.className = 'mo-fine';
  intro.style.marginBottom = '8px';
  intro.textContent = selectedClip ? `Applying to ${selectedClip.name}` : 'Select a clip to grade.';
  body.append(intro);
  const grid = document.createElement('div');
  grid.className = 'mo-swatch-grid';
  COLOR_PRESETS.filter((p) => !mediaSearch || `${p.name} ${p.category}`.toLowerCase().includes(mediaSearch.toLowerCase())).forEach((preset) => {
    const b = document.createElement('button');
    b.className = 'mo-swatch';
    b.title = `${preset.name} — ${preset.category}`;
    b.style.background = presetSwatch(preset);
    b.innerHTML = `<span>${esc(preset.name)}</span>`;
    b.addEventListener('click', () => applyColorPreset(preset.id));
    grid.append(b);
  });
  body.append(grid);
  body.insertAdjacentHTML('beforeend', '<p class="mo-fine" style="margin-top:8px">30 presets. Open the Color tab for wheels, curves, scopes, LUTs and HDR-aware controls.</p>');
  bindSearch(renderColorPresetsPanel);
}

function presetSwatch(preset) {
  const p = preset.patch || {};
  if (p.saturation <= -0.9) return 'linear-gradient(135deg,#e5e7eb,#111827)';
  const a = p.temperature > 0 ? '#f59e0b' : p.temperature < 0 ? '#0ea5e9' : '#64748b';
  const b = p.tint > 0 ? '#d946ef' : p.tint < 0 ? '#22c55e' : '#334155';
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function applyColorPreset(id) {
  const preset = COLOR_PRESETS.find((p) => p.id === id);
  if (!preset) return;
  if (!selection.size) return toast('Select a clip first', true);
  const next = deep(project);
  next.clips.forEach((c) => {
    if (!selection.has(c.id)) return;
    c.color = { ...c.color, ...deep(preset.patch), preset: id };
    if (id === 'neutral') c.color = { ...c.color, exposure: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, gamma: 1, hue: 0, lift: [0, 0, 0], gammaRGB: [1, 1, 1], gain: [1, 1, 1], selective: [] };
  });
  commitProject(`Color: ${preset.name}`, next);
  rightTab = 'color'; setRightTab('color');
}

/* ------------------------------------------------------------------------- */
/* Right panel                                                               */
/* ------------------------------------------------------------------------- */

function setRightTab(tab) {
  rightTab = tab;
  $$('#mo-right-tabs button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  app.classList.toggle('mo-color-mode', tab === 'color' && window.innerWidth > 1100);
  renderRightPanel();
}

function renderRightPanel() {
  const body = $('#mo-right-body');
  if (!body) return;
  if (rightTab === 'history') { renderHistory(); return; }
  if (rightTab === 'color') { renderColorPanel(); return; }
  if (rightTab === 'keyframes') { renderKeyframesPanel(); return; }
  if (rightTab === 'audio') { renderAudioInspector(); return; }
  renderInspector();
}

function selectedClip() {
  for (const id of selection) { const c = project.clips.find((x) => x.id === id); if (c) return c; }
  return null;
}

function renderInspector() {
  const body = $('#mo-right-body');
  const clips = [...selection].map((id) => project.clips.find((c) => c.id === id)).filter(Boolean);
  $('#mo-right-toolbar').innerHTML = '';
  if (!clips.length) {
    body.innerHTML = `<div class="mo-empty"><b>Nothing selected</b>Select a clip to edit its transform, effects, color and audio. Shift-click adds to the selection.</div>${projectSummaryHtml()}`;
    bindProjectSummary();
    return;
  }
  if (clips.length > 1) {
    body.innerHTML = `<div class="mo-section"><div class="mo-section-head"><h3>${clips.length} clips selected</h3></div>
      <p class="mo-fine">${clips.map((c) => esc(c.name)).join(', ')}</p>
      <div class="mo-row" style="margin-top:7px"><button class="mo-btn" data-multi="group">Group</button><button class="mo-btn" data-multi="link">Link</button><button class="mo-btn danger" data-multi="delete">Delete</button></div></div>`;
    body.querySelector('[data-multi="group"]').onclick = () => groupSelection();
    body.querySelector('[data-multi="link"]').onclick = () => linkSelectedClips();
    body.querySelector('[data-multi="delete"]').onclick = () => deleteSelection();
    return;
  }
  const clip = clips[0];
  selectedTrackId = clip.trackId;
  const track = trackById(project, clip.trackId);
  const asset = assetMap.get(clip.assetId);
  body.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'mo-section';
  head.innerHTML = `<div class="mo-section-head"><h3>${esc(clip.type)}</h3><span class="mo-spacer"></span><button data-i="menu">⋯</button></div>
    <label class="mo-field"><span>Name</span><input id="mo-clip-name" type="text" value="${esc(clip.name)}"></label>
    <div class="mo-row" style="margin-top:5px"><span class="mo-fine">${esc(track?.name || '')} · ${asset ? esc(asset.name) : clip.type === 'shape' ? 'Shape layer' : clip.type === 'composition' ? 'Nested composition' : 'No media'}</span><span class="mo-spacer"></span><span class="mo-fine">${clip.type !== 'subtitle' ? `${fmtShort(clip.duration)} · ${fmt(clip.start)}` : ''}</span></div>`;
  body.append(head);
  head.querySelector('#mo-clip-name').addEventListener('change', (e) => patchClip(clip.id, { name: e.target.value }, 'Rename clip'));
  head.querySelector('[data-i="menu"]').addEventListener('click', () => clipMenu(clip));
  if (clip.type === 'adjustment' || clip.type === 'effect') body.append(adjustmentInspector(clip));
  if (clip.type === 'text') body.append(textInspector(clip));
  if (clip.type === 'subtitle') body.append(subtitleInspector(clip));
  if (clip.type === 'composition') body.append(compositionInspector(clip));
  body.append(transformInspector(clip));
  if (asset || clip.type === 'shape') body.append(cropMaskInspector(clip));
  if (['video', 'image', 'audio', 'adjustment', 'effect'].includes(clip.type)) body.append(audioInspectorSection(clip));
  body.append(effectsInspector(clip));
  body.append(quickColorInspector(clip));
}

function projectSummaryHtml() {
  return `<div class="mo-section"><div class="mo-section-head"><h3>Sequence</h3><span class="mo-spacer"></span><button data-p="settings">Edit</button></div>
    <label class="mo-field"><span>Project name</span><input id="mo-project-name" type="text" value="${esc(project.name || 'Untitled')}"></label>
    <div class="mo-grid-2" style="margin-top:5px"><div class="mo-field"><span>Resolution</span><input value="${project.width} × ${project.height}" readonly></div><div class="mo-field"><span>Frame rate</span><input value="${project.fps} fps" readonly></div></div>
    <div class="mo-grid-2" style="margin-top:5px"><div class="mo-field"><span>Duration</span><input value="${fmtShort(timelineDuration(project) || project.duration)}" readonly></div><div class="mo-field"><span>Color</span><input value="${esc(project.colorSpace || 'Rec.709')}" readonly></div></div>
    <p class="mo-fine" style="margin-top:7px">${project.clips.length} clips · ${project.tracks.length} tracks · ${assets.length} media assets</p>
  </div>
  <div class="mo-section"><div class="mo-section-head"><h3>Master audio</h3></div>
    ${rangeRow('Volume', project.master.volume ?? 1, 0, 2, 0.01, (v) => setMaster({ volume: v }, 'Master volume'))}
    <label class="mo-check" style="margin-top:6px"><input type="checkbox" id="mo-master-limiter" ${project.master.limiter !== false ? 'checked' : ''}> Limiter (${project.master.limiterCeiling ?? -1} dBFS ceiling)</label>
  </div>
  <div class="mo-section"><div class="mo-section-head"><h3>Project</h3></div>
    <div class="mo-grid-2"><button class="mo-btn" data-p="export">Export video</button><button class="mo-btn" data-p="duplicate">Duplicate</button></div>
    <p class="mo-fine" style="margin-top:7px">Version ${DOC.version || 1} · autosaves ${esc(new Date().toLocaleTimeString())}</p>
  </div>`;
}

function bindProjectSummary() {
  const name = $('#mo-project-name');
  name?.addEventListener('change', (e) => {
    const next = deep(project); next.name = e.target.value; commitProject('Rename project', next);
  });
  $('#mo-master-limiter')?.addEventListener('change', (e) => setMaster({ limiter: e.target.checked }, 'Master limiter'));
  $$('[data-p]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.p === 'settings') $('#mo-sequence-dlg').showModal();
    if (b.dataset.p === 'export') openExport();
    if (b.dataset.p === 'duplicate') duplicateProject();
  }));
}

function patchClip(id, patch, label) {
  const next = deep(project);
  const clip = next.clips.find((c) => c.id === id);
  if (!clip) return;
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && clip[k] && typeof clip[k] === 'object') clip[k] = { ...clip[k], ...v };
    else clip[k] = v;
  }
  commitProject(label, next, { save: label !== 'Live edit' });
}

function rangeRow(label, value, min, max, step, onInput, opts = {}) {
  return `<div class="mo-param"><label>${esc(label)}</label><input type="number" value="${Number(value).toFixed(step < 0.01 ? 3 : 2)}" step="${step}" min="${min}" max="${max}" data-range="${esc(label)}"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
}

function wireRange(container, label, handler, opts = {}) {
  const row = [...container.querySelectorAll('.mo-param')].find((r) => r.querySelector('label')?.textContent === label);
  if (!row) return;
  const slider = row.querySelector('input[type="range"]');
  const number = row.querySelector('input[type="number"]');
  let before = null;
  const start = () => { if (!before) before = deep(project); };
  const input = (v) => handler(Number(v), !!before);
  slider.addEventListener('pointerdown', start);
  slider.addEventListener('input', () => { start(); input(slider.value); number.value = Number(slider.value).toFixed(3); });
  slider.addEventListener('change', () => { finish(); });
  number.addEventListener('change', () => { start(); input(number.value); slider.value = number.value; finish(); });
  function finish() {
    if (before && JSON.stringify(before) !== JSON.stringify(project)) {
      bumpHistory(opts.label || label, project, engine.time);
      scheduleSave();
    }
    before = null;
  }
}

function transformInspector(clip) {
  const tr = clip.transform || {};
  const section = document.createElement('div');
  section.className = 'mo-section';
  section.innerHTML = `<div class="mo-section-head"><h3>Transform</h3><span class="mo-spacer"></span><button data-t="reset">Reset</button></div>
    <div class="mo-prop-row">
      ${propField('X', tr.x ?? 0, 'number', 0.01, 'x', clip)}
      ${propField('Y', tr.y ?? 0, 'number', 0.01, 'y', clip)}
      ${propField('Scale', tr.scale ?? 1, 'number', 0.01, 'scale', clip)}
      ${propField('Rotation', tr.rotation ?? 0, 'number', 0.5, 'rotation', clip)}
      ${propField('Scale X', tr.scaleX ?? 1, 'number', 0.01, 'scaleX', clip)}
      ${propField('Scale Y', tr.scaleY ?? 1, 'number', 0.01, 'scaleY', clip)}
    </div>
    <div class="mo-param" style="margin-top:5px"><label>Opacity</label><input type="number" min="0" max="1" step="0.01" value="${tr.opacity ?? 1}" data-opacity><input type="range" min="0" max="1" step="0.01" value="${tr.opacity ?? 1}"></div>
    <div class="mo-grid-2" style="margin-top:5px"><div class="mo-field"><span>Anchor X</span><input type="number" step="0.01" value="${tr.anchorX ?? 0.5}" data-anchor="x"></div><div class="mo-field"><span>Anchor Y</span><input type="number" step="0.01" value="${tr.anchorY ?? 0.5}" data-anchor="y"></div></div>`;
  const opacityRow = section.querySelector('.mo-param');
  const slider = opacityRow.querySelector('input[type="range"]');
  const number = opacityRow.querySelector('input[type="number"]');
  slider.addEventListener('input', () => { liveClip(clip.id, (c) => { c.transform.opacity = Number(slider.value); }); number.value = slider.value; });
  slider.addEventListener('change', () => finishLive('Opacity', clip.id));
  number.addEventListener('change', () => { liveClip(clip.id, (c) => { c.transform.opacity = Number(number.value); }); slider.value = number.value; finishLive('Opacity', clip.id); });
  section.querySelectorAll('[data-prop]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.prop;
      const value = Number(input.value);
      liveClip(clip.id, (c) => { c.transform[key] = value; });
      finishLive(`Transform ${key}`, clip.id);
    });
  });
  section.querySelectorAll('[data-anchor]').forEach((input) => input.addEventListener('change', () => {
    liveClip(clip.id, (c) => { c.transform[`anchor${input.dataset.anchor.toUpperCase()}`] = Number(input.value); });
    finishLive('Anchor', clip.id);
  }));
  section.querySelectorAll('[data-kf]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.kf;
    const t = snapToFrame(project, engine.time - clip.start);
    if (t < 0 || t > clip.duration) return toast('Move the playhead inside the clip', true);
    const next = deep(project);
    const c = next.clips.find((x) => x.id === clip.id);
    const frames = (c.keyframes?.[key] || []).filter((k) => Math.abs(k.t - t) > 1000);
    frames.push({ t, value: Number(c.transform[key] ?? 0), easing: 'ease-in-out' });
    c.keyframes = { ...c.keyframes, [key]: frames.sort((a, b) => a.t - b.t) };
    commitProject(`Keyframe ${key}`, next);
    renderInspector();
  }));
  section.querySelector('[data-t="reset"]').addEventListener('click', () => {
    liveClip(clip.id, (c) => { c.transform = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 }; });
    finishLive('Reset transform', clip.id);
  });
  return section;
}

function propField(label, value, type, step, key, clip) {
  const hasKf = (clip.keyframes?.[key] || []).length > 0;
  return `<div class="mo-prop"><label>${label}</label><input data-prop="${key}" type="${type}" step="${step}" value="${value}"><button class="mo-kf${hasKf ? ' is-on' : ''}" data-kf="${key}" title="Toggle keyframe at playhead">◆</button></div>`;
}

let liveBefore = null;
let liveKey = '';
let liveRenderFrame = 0;

/* Slider and colour-wheel drags fire many input events per frame. Mutating the
 * project stays synchronous; the preview render is coalesced to one per frame. */
function scheduleLiveRender() {
  engine.project = project;
  if (liveRenderFrame) return;
  liveRenderFrame = requestAnimationFrame(() => {
    liveRenderFrame = 0;
    engine.setProject(project);
  });
}

function liveClip(id, mutate) {
  const key = `${id}:${liveKey}`;
  if (liveBefore === null) liveBefore = deep(project);
  const next = project === liveBefore ? deep(project) : project;
  const clip = next.clips.find((c) => c.id === id);
  if (!clip) return;
  mutate(clip);
  project = next;
  scheduleLiveRender();
}
function finishLive(label, id) {
  if (liveBefore && JSON.stringify(liveBefore) !== JSON.stringify(project)) {
    bumpHistory(label, project, engine.time);
    scheduleSave();
  }
  liveBefore = null;
  renderInspector();
}

function startLive(key) { liveBefore = deep(project); liveKey = key || ''; }

function cropMaskInspector(clip) {
  const section = document.createElement('div');
  section.className = 'mo-section';
  section.innerHTML = `<div class="mo-section-head"><h3>Crop &amp; mask</h3></div>
    <div class="mo-grid-2"><label class="mo-field"><span>Crop left</span><input type="number" min="0" max="0.45" step="0.01" value="${clip.crop.left}" data-crop="left"></label>
    <label class="mo-field"><span>Crop right</span><input type="number" min="0" max="0.45" step="0.01" value="${clip.crop.right}" data-crop="right"></label>
    <label class="mo-field"><span>Crop top</span><input type="number" min="0" max="0.45" step="0.01" value="${clip.crop.top}" data-crop="top"></label>
    <label class="mo-field"><span>Crop bottom</span><input type="number" min="0" max="0.45" step="0.01" value="${clip.crop.bottom}" data-crop="bottom"></label></div>
    <div class="mo-grid-2" style="margin-top:5px"><label class="mo-field"><span>Mask</span><select id="mo-mask-shape"><option value="none">None</option><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="polygon">Polygon</option></select></label>
    <label class="mo-field"><span>Feather</span><input type="number" min="0" max="0.2" step="0.005" value="${clip.mask.feather}" data-mask="feather"></label></div>
    <div class="mo-row" style="margin-top:5px"><label class="mo-check"><input type="checkbox" id="mo-mask-invert" ${clip.mask.invert ? 'checked' : ''}> Invert</label><span class="mo-spacer"></span><button class="mo-btn" id="mo-mask-draw">Draw in preview</button></div>`;
  section.querySelector('#mo-mask-shape').value = clip.mask.shape || 'none';
  section.querySelectorAll('[data-crop]').forEach((input) => input.addEventListener('change', () => {
    liveClip(clip.id, (c) => { c.crop[input.dataset.crop] = Number(input.value); });
    finishLive('Crop', clip.id);
  }));
  section.querySelectorAll('[data-mask]').forEach((input) => input.addEventListener('change', () => {
    liveClip(clip.id, (c) => { c.mask[input.dataset.mask] = Number(input.value); });
    finishLive('Mask feather', clip.id);
  }));
  section.querySelector('#mo-mask-shape').addEventListener('change', (e) => {
    liveClip(clip.id, (c) => { c.mask.shape = e.target.value; if (e.target.value === 'polygon' && !c.mask.points.length) c.mask.points = [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.5, y: 0.75 }]; });
    finishLive('Mask shape', clip.id);
  });
  section.querySelector('#mo-mask-invert').addEventListener('change', (e) => { liveClip(clip.id, (c) => { c.mask.invert = e.target.checked; }); finishLive('Invert mask', clip.id); });
  section.querySelector('#mo-mask-draw').addEventListener('click', () => drawMaskOnPreview(clip));
  return section;
}

function drawMaskOnPreview(clip) {
  const points = [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.5, y: 0.75 }];
  const next = deep(project);
  const target = next.clips.find((c) => c.id === clip.id);
  target.mask.shape = 'polygon'; target.mask.points = points;
  commitProject('Draw polygon mask', next);
  toast('Polygon mask created. Adjust feather and inversion in the inspector.');
}

function audioInspectorSection(clip) {
  const a = clip.audio || {};
  const section = document.createElement('div');
  section.className = 'mo-section';
  section.innerHTML = `<div class="mo-section-head"><h3>Audio</h3><span class="mo-spacer"></span><button data-a="reset">Reset</button></div>
    <div class="mo-param"><label>Gain</label><input type="number" min="0" max="2" step="0.01" value="${a.gain ?? 1}"><input type="range" min="0" max="2" step="0.01" value="${a.gain ?? 1}"></div>
    <div class="mo-param"><label>Pan</label><input type="number" min="-1" max="1" step="0.01" value="${a.pan ?? 0}"><input type="range" min="-1" max="1" step="0.01" value="${a.pan ?? 0}"></div>
    <div class="mo-grid-2"><label class="mo-field"><span>Fade in (s)</span><input type="number" min="0" step="0.1" value="${a.fadeIn || 0}" data-audio="fadeIn"></label><label class="mo-field"><span>Fade out (s)</span><input type="number" min="0" step="0.1" value="${a.fadeOut || 0}" data-audio="fadeOut"></label></div>
    <div class="mo-grid-3" style="margin-top:4px"><label class="mo-field"><span>Low</span><input type="number" min="-1" max="1" step="0.05" value="${a.eqLow || 0}" data-audio="eqLow"></label><label class="mo-field"><span>Mid</span><input type="number" min="-1" max="1" step="0.05" value="${a.eqMid || 0}" data-audio="eqMid"></label><label class="mo-field"><span>High</span><input type="number" min="-1" max="1" step="0.05" value="${a.eqHigh || 0}" data-audio="eqHigh"></label></div>
    <div class="mo-grid-2" style="margin-top:4px"><label class="mo-field"><span>Ducking</span><input type="number" min="0" max="1" step="0.05" value="${a.ducking || 0}" data-audio="ducking"></label><label class="mo-field"><span>Pitch (semitones)</span><input type="number" min="-12" max="12" step="1" value="${a.pitch || 0}" data-audio="pitch"></label></div>
    <div class="mo-row wrap" style="margin-top:5px"><label class="mo-check"><input type="checkbox" data-audio-check="muted" ${a.muted ? 'checked' : ''}> Mute</label><label class="mo-check"><input type="checkbox" data-audio-check="limiter" ${a.limiter ? 'checked' : ''}> Limiter</label><label class="mo-check"><input type="checkbox" data-audio-check="normalize" ${a.normalize ? 'checked' : ''}> Normalize</label></div>`;
  const params = section.querySelectorAll('.mo-param');
  params.forEach((row) => {
    const slider = row.querySelector('input[type="range"]');
    const num = row.querySelector('input[type="number"]');
    const key = row.querySelector('label').textContent === 'Gain' ? 'gain' : 'pan';
    slider.addEventListener('input', () => { liveClip(clip.id, (c) => { c.audio[key] = Number(slider.value); }); num.value = slider.value; });
    slider.addEventListener('change', () => finishLive('Audio', clip.id));
    num.addEventListener('change', () => { liveClip(clip.id, (c) => { c.audio[key] = Number(num.value); }); slider.value = num.value; finishLive('Audio', clip.id); });
  });
  section.querySelectorAll('[data-audio]').forEach((input) => input.addEventListener('change', () => {
    liveClip(clip.id, (c) => { c.audio[input.dataset.audio] = Number(input.value); });
    finishLive('Audio', clip.id);
  }));
  section.querySelectorAll('[data-audio-check]').forEach((input) => input.addEventListener('change', () => {
    liveClip(clip.id, (c) => { c.audio[input.dataset.audioCheck] = input.checked; });
    finishLive('Audio', clip.id);
  }));
  section.querySelector('[data-a="reset"]').addEventListener('click', () => {
    liveClip(clip.id, (c) => { c.audio = { ...c.audio, gain: 1, pan: 0, fadeIn: 0, fadeOut: 0, eqLow: 0, eqMid: 0, eqHigh: 0, ducking: 0, pitch: 0 }; });
    finishLive('Reset audio', clip.id);
  });
  return section;
}

function effectsInspector(clip) {
  const section = document.createElement('div');
  section.className = 'mo-section';
  section.innerHTML = `<div class="mo-section-head"><h3>Effects · ${clip.effects?.length || 0}</h3><span class="mo-spacer"></span><button data-fx="add">+</button></div>`;
  const stack = document.createElement('div');
  stack.className = 'mo-effect-stack';
  if (!clip.effects?.length) stack.innerHTML = '<p class="mo-fine">No effects. Add one from the Effects browser.</p>';
  (clip.effects || []).forEach((fx) => {
    const preset = effectById(fx.type);
    const row = document.createElement('div');
    row.className = `mo-effect-row${collapseState.has(fx.id) ? ' open' : ' open'}`;
    row.innerHTML = `<div class="mo-effect-head"><button data-fx-toggle="${fx.id}" title="Enable">${fx.enabled === false ? '○' : '●'}</button><b>${esc(preset?.name || fx.type)}</b><button data-fx-up="${fx.id}" title="Move up">↑</button><button data-fx-del="${fx.id}" title="Remove">✕</button></div><div class="mo-effect-body"></div>`;
    const body = row.querySelector('.mo-effect-body');
    const params = { ...(preset?.params || {}), ...(fx.params || {}) };
    for (const [key, value] of Object.entries(params)) {
      if (key === 'preset' || key === '_t' || key === '_clip') continue;
      if (Array.isArray(value) || (key === 'colors')) {
        const color = Array.isArray(value) ? value[0] : '#ffffff';
        body.insertAdjacentHTML('beforeend', `<div class="mo-color-row"><label>${esc(key)}</label><input type="color" value="${esc(color)}" data-fx-param="${esc(key)}"><button class="mo-kf" data-fx-kf="${esc(key)}" title="Keyframe">◆</button></div>`);
      } else if (typeof value === 'number') {
        const max = Math.max(2, Math.abs(value) * 3 || 2);
        body.insertAdjacentHTML('beforeend', `<div class="mo-param"><label>${esc(key)}</label><input type="number" step="0.01" value="${value}" data-fx-num="${esc(key)}"><input type="range" min="${Math.min(0, value)}" max="${max}" step="0.01" value="${value}" data-fx-param="${esc(key)}"></div>`);
      } else if (typeof value === 'boolean') {
        body.insertAdjacentHTML('beforeend', `<label class="mo-check" style="margin-top:5px"><input type="checkbox" ${value ? 'checked' : ''} data-fx-check="${esc(key)}"> ${esc(key)}</label>`);
      } else if (key !== 'colors') {
        body.insertAdjacentHTML('beforeend', `<label class="mo-field" style="margin-top:5px"><span>${esc(key)}</span><input type="text" value="${esc(value)}" data-fx-text="${esc(key)}"></label>`);
      }
    }
    stack.append(row);
    body.querySelectorAll('[data-fx-param]').forEach((input) => {
      input.addEventListener('input', () => { liveEffect(clip.id, fx.id, input.dataset.fxParam, Number(input.value)); });
      input.addEventListener('change', () => finishFx(clip.id));
    });
    body.querySelectorAll('[data-fx-num]').forEach((input) => input.addEventListener('change', () => { liveEffect(clip.id, fx.id, input.dataset.fxNum, Number(input.value)); finishFx(clip.id); }));
    body.querySelectorAll('[data-fx-check]').forEach((input) => input.addEventListener('change', () => { liveEffect(clip.id, fx.id, input.dataset.fxCheck, input.checked); finishFx(clip.id); }));
    body.querySelectorAll('[data-fx-text]').forEach((input) => input.addEventListener('change', () => { liveEffect(clip.id, fx.id, input.dataset.fxText, input.value); finishFx(clip.id); }));
    body.querySelectorAll('[data-fx-kf]').forEach((btn) => btn.addEventListener('click', () => addEffectKeyframe(clip, fx, btn.dataset.fxKf, Number(params[btn.dataset.fxKf]) || 0)));
    row.querySelector('[data-fx-toggle]').addEventListener('click', () => toggleEffect(clip.id, fx.id));
    row.querySelector('[data-fx-del]').addEventListener('click', () => removeEffect(clip.id, fx.id));
  });
  section.append(stack);
  return section;
}

function liveEffect(clipId, effectId, key, value) {
  if (!liveBefore) liveBefore = deep(project);
  const next = project === liveBefore ? deep(project) : project;
  const clip = next.clips.find((c) => c.id === clipId);
  const fx = clip?.effects.find((f) => f.id === effectId);
  if (!fx) return;
  fx.params = { ...fx.params, [key]: value };
  project = next; scheduleLiveRender();
}
function finishFx(clipId) {
  if (liveBefore) { bumpHistory('Effect parameter', project, engine.time); scheduleSave(); liveBefore = null; }
  renderInspector();
}

function toggleEffect(clipId, effectId) {
  const next = deep(project);
  const fx = next.clips.find((c) => c.id === clipId)?.effects.find((f) => f.id === effectId);
  if (fx) fx.enabled = fx.enabled === false;
  commitProject('Toggle effect', next);
}
function removeEffect(clipId, effectId) { commitOp('Remove effect', { op: 'remove_effect', clipId, effectId }); }

function addEffectKeyframe(clip, fx, param, value) {
  const next = deep(project);
  const c = next.clips.find((x) => x.id === clip.id);
  const f = c.effects.find((x) => x.id === fx.id);
  const t = snapToFrame(project, engine.time - clip.start);
  const frames = (f.keyframes?.[param] || []).filter((k) => Math.abs(k.t - t) > 1000);
  frames.push({ t, value, easing: 'ease-in-out' });
  f.keyframes = { ...f.keyframes, [param]: frames.sort((a, b) => a.t - b.t) };
  commitProject(`Keyframe ${param}`, next);
}

function quickColorInspector(clip) {
  const section = document.createElement('div');
  section.className = 'mo-section';
  section.innerHTML = `<div class="mo-section-head"><h3>Color</h3><span class="mo-spacer"></span><button data-c="open">Open grading</button></div>
    <div class="mo-row"><span class="mo-fine">${esc(COLOR_PRESETS.find((p) => p.id === clip.color?.preset)?.name || 'Custom / ungraded')}</span><span class="mo-spacer"></span><button class="mo-btn" data-c="reset">Reset grade</button></div>`;
  section.querySelector('[data-c="open"]').onclick = () => { selection = new Set([clip.id]); rightTab = 'color'; setRightTab('color'); };
  section.querySelector('[data-c="reset"]').onclick = () => {
    liveClip(clip.id, (c) => { c.color = { ...c.color, exposure: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, gamma: 1, hue: 0, lift: [0, 0, 0], gammaRGB: [1, 1, 1], gain: [1, 1, 1], selective: [], lut: null, preset: null }; });
    finishLive('Reset grade', clip.id);
    setRightTab('color');
  };
  return section;
}

function textInspector(clip) {
  const t = clip.text;
  const section = document.createElement('div');
  section.className = 'mo-section';
  section.innerHTML = `<div class="mo-section-head"><h3>Text</h3><span class="mo-spacer"></span><button data-tx="template">Templates</button></div>
    <label class="mo-field"><span>Content</span><textarea id="mo-text-content" rows="3">${esc(t.content)}</textarea></label>
    <div class="mo-grid-2" style="margin-top:4px"><label class="mo-field"><span>Font</span><select id="mo-text-font">${fontOptions(t.fontFamily)}</select></label>
    <label class="mo-field"><span>Size (fraction)</span><input id="mo-text-size" type="number" min="0.01" max="0.4" step="0.002" value="${t.fontSize}"></label></div>
    <div class="mo-grid-2"><label class="mo-field"><span>Weight</span><select id="mo-text-weight"><option value="300">Light</option><option value="400">Regular</option><option value="600">Semibold</option><option value="700">Bold</option><option value="900">Black</option></select></label>
    <label class="mo-field"><span>Align</span><select id="mo-text-align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></div>
    <div class="mo-grid-2"><label class="mo-field"><span>Color</span><input type="color" id="mo-text-color" value="${hex(t.color)}"></label>
    <label class="mo-field"><span>Background</span><input type="color" id="mo-text-bg" value="${hex(t.background?.color || '#000000')}"></label></div>
    <div class="mo-param"><label>Background opacity</label><input type="number" min="0" max="1" step="0.01" value="${t.background?.opacity || 0}"><input type="range" min="0" max="1" step="0.01" value="${t.background?.opacity || 0}"></div>
    <div class="mo-grid-2"><label class="mo-field"><span>Outline</span><input type="number" min="0" max="0.02" step="0.0005" value="${t.outline?.width || 0}" data-text-num="outline"></label>
    <label class="mo-field"><span>Shadow</span><input type="number" min="0" max="0.1" step="0.001" value="${t.shadow?.blur || 0}" data-text-num="shadow"></label></div>
    <div class="mo-grid-2"><label class="mo-field"><span>X</span><input type="number" min="0" max="1" step="0.01" value="${t.x}" data-text-num="x"></label><label class="mo-field"><span>Y</span><input type="number" min="0" max="1" step="0.01" value="${t.y}" data-text-num="y"></label></div>
    <label class="mo-field" style="margin-top:4px"><span>Animation</span><select id="mo-text-anim">${['fade-in','slide-in-left','slide-in-right','slide-in-top','pop-in','zoom-in','tracking-in','typewriter','bounce','dramatic-fade','glitch','credits-roll'].map((a) => `<option value="${a}">${a}</option>`).join('')}</select></label>
    <div class="mo-row" style="margin-top:5px"><label class="mo-check"><input type="checkbox" id="mo-text-upper" ${t.uppercase ? 'checked' : ''}> Uppercase</label><label class="mo-check"><input type="checkbox" id="mo-text-italic" ${t.italic ? 'checked' : ''}> Italic</label></div>`;
  section.querySelector('#mo-text-weight').value = String(t.fontWeight || 700);
  section.querySelector('#mo-text-align').value = t.align || 'center';
  section.querySelector('#mo-text-anim').value = t.animation || 'fade-in';
  const patchText = (patch, label = 'Edit text') => {
    const next = deep(project);
    const c = next.clips.find((x) => x.id === clip.id);
    Object.assign(c.text, patch);
    commitProject(label, next);
  };
  section.querySelector('#mo-text-content').addEventListener('change', (e) => patchText({ content: e.target.value }));
  section.querySelector('#mo-text-font').addEventListener('change', (e) => patchText({ fontFamily: e.target.value }));
  section.querySelector('#mo-text-size').addEventListener('change', (e) => patchText({ fontSize: Number(e.target.value) }));
  section.querySelector('#mo-text-weight').addEventListener('change', (e) => patchText({ fontWeight: Number(e.target.value) }));
  section.querySelector('#mo-text-align').addEventListener('change', (e) => patchText({ align: e.target.value }));
  section.querySelector('#mo-text-color').addEventListener('input', (e) => patchText({ color: e.target.value }, 'Text color'));
  section.querySelector('#mo-text-bg').addEventListener('input', (e) => { const next = deep(project); const c = next.clips.find((x) => x.id === clip.id); c.text.background = { ...c.text.background, color: e.target.value }; commitProject('Text background', next); });
  section.querySelectorAll('[data-text-num]').forEach((input) => input.addEventListener('change', () => {
    const key = input.dataset.textNum;
    const value = Number(input.value);
    if (key === 'outline') patchText({ outline: { ...clip.text.outline, width: value } });
    else if (key === 'shadow') patchText({ shadow: { ...clip.text.shadow, blur: value } });
    else patchText({ [key]: value });
  }));
  section.querySelector('#mo-text-anim').addEventListener('change', (e) => patchText({ animation: e.target.value }));
  section.querySelector('#mo-text-upper').addEventListener('change', (e) => patchText({ uppercase: e.target.checked }));
  section.querySelector('#mo-text-italic').addEventListener('change', (e) => patchText({ italic: e.target.checked }));
  section.querySelector('[data-tx="template"]').onclick = () => { setLeftTab('text'); };
  const bgRow = section.querySelector('.mo-param');
  const bgSlider = bgRow.querySelector('input[type="range"]'); const bgNum = bgRow.querySelector('input[type="number"]');
  bgSlider.addEventListener('input', () => { const next = deep(project); const c = next.clips.find((x) => x.id === clip.id); c.text.background = { ...c.text.background, opacity: Number(bgSlider.value) }; project = next; scheduleLiveRender(); bgNum.value = bgSlider.value; });
  bgSlider.addEventListener('change', () => { bumpHistory('Text background opacity', project, engine.time); scheduleSave(); renderInspector(); });
  return section;
}

function fontOptions(current) {
  const fonts = ["Inter, Arial, sans-serif", "Arial, sans-serif", "Helvetica, Arial, sans-serif", "Georgia, serif", "Times New Roman, serif", "Courier New, monospace", "Impact, Arial Black, sans-serif", "Verdana, sans-serif", "Trebuchet MS, sans-serif", "Segoe Script, cursive"];
  return fonts.map((f) => `<option value="${esc(f)}" ${f === current ? 'selected' : ''}>${esc(f.split(',')[0])}</option>`).join('');
}
function hex(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
  return m ? color : '#ffffff';
}

function subtitleInspector(clip) {
  const sub = clip.subtitle;
  const section = document.createElement('div');
  section.className = 'mo-section';
  section.innerHTML = `<div class="mo-section-head"><h3>Caption</h3><span class="mo-spacer"></span><button data-s="styles">All styles</button></div>
    <label class="mo-field"><span>Text</span><textarea id="mo-sub-text" rows="3">${esc(sub.text)}</textarea></label>
    <div class="mo-grid-2"><label class="mo-field"><span>Start (s)</span><input id="mo-sub-start" type="number" step="0.01" value="${toSeconds(clip.start).toFixed(2)}"></label><label class="mo-field"><span>End (s)</span><input id="mo-sub-end" type="number" step="0.01" value="${toSeconds(clip.start + clip.duration).toFixed(2)}"></label></div>
    <label class="mo-field" style="margin-top:4px"><span>Style</span><select id="mo-sub-style">${SUBTITLE_STYLES.map((s) => `<option value="${s.id}" ${s.id === sub.styleId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <div class="mo-row" style="margin-top:5px"><label class="mo-check"><input type="checkbox" id="mo-sub-upper" ${subtitleStyleById(sub.styleId).style.uppercase ? 'checked' : ''}> Uppercase</label><span class="mo-spacer"></span><button class="mo-btn" data-s="timeline">Reveal</button></div>
    <p class="mo-fine" style="margin-top:5px">${sub.words?.length || 0} word timings · ${esc(subtitleStyleById(sub.styleId).animation)} animation</p>`;
  section.querySelector('#mo-sub-text').addEventListener('change', (e) => patchSubtitle(clip.id, { text: e.target.value }, 'Edit caption'));
  section.querySelector('#mo-sub-start').addEventListener('change', (e) => setCueTiming(clip, Number(e.target.value) * TICKS, null));
  section.querySelector('#mo-sub-end').addEventListener('change', (e) => setCueTiming(clip, null, Number(e.target.value) * TICKS));
  section.querySelector('#mo-sub-style').addEventListener('change', (e) => { selection = new Set([clip.id]); applySubtitleStyle(e.target.value); renderInspector(); });
  section.querySelector('#mo-sub-upper').addEventListener('change', (e) => {
    const next = deep(project); const c = next.clips.find((x) => x.id === clip.id); c.subtitle.style = { ...(c.subtitle.style || {}), uppercase: e.target.checked }; commitProject('Caption casing', next);
  });
  section.querySelector('[data-s="styles"]').onclick = () => setLeftTab('subtitles');
  section.querySelector('[data-s="timeline"]').onclick = () => engine.setTime(clip.start);
  return section;
}

function adjustmentInspector(clip) {
  const section = document.createElement('div');
  section.className = 'mo-section';
  section.innerHTML = `<div class="mo-section-head"><h3>Adjustment layer</h3></div><p class="mo-fine">Effects added to this layer apply to every layer underneath it for the duration of the clip.</p>`;
  return section;
}
function compositionInspector(clip) {
  const comp = project.compositions.find((c) => c.id === clip.compositionId);
  const section = document.createElement('div');
  section.className = 'mo-section';
  section.innerHTML = `<div class="mo-section-head"><h3>Nested composition</h3></div><p class="mo-fine">${comp ? `${esc(comp.name)} · ${comp.width}×${comp.height} · ${comp.clips.length} clips` : 'Missing composition'}</p><button class="mo-btn wide" data-comp="open" style="margin-top:5px">Open composition</button>`;
  section.querySelector('[data-comp="open"]').onclick = () => {
    if (!comp) return;
    const target = project.clips.find((c) => c.trackId === clip.trackId && c.id !== clip.id);
    toast('Nested composition is rendered in place. Duplicate the project to edit it as a standalone sequence.');
  };
  return section;
}

/* ------------------------------------------------------------------------- */
/* Clip menu and batch actions                                               */
/* ------------------------------------------------------------------------- */

function clipMenu(clip, x, y) {
  closeContext();
  const menu = document.createElement('div');
  menu.className = 'mo-context';
  menu.innerHTML = `<button data-c="split">Split at playhead</button><button data-c="duplicate">Duplicate</button><button data-c="copy">Copy</button><button data-c="detach">Detach audio</button><button data-c="replace">Replace media…</button><button data-c="nest">Nest selection</button><div class="mo-menu-sep"></div><button data-c="delete">Delete</button>`;
  placeContext(menu, x, y);
  menu.querySelector('[data-c="split"]').onclick = () => { selection = new Set([clip.id]); splitSelection(); menu.remove(); };
  menu.querySelector('[data-c="duplicate"]').onclick = () => { selection = new Set([clip.id]); duplicateSelection(); menu.remove(); };
  menu.querySelector('[data-c="copy"]').onclick = () => { selection = new Set([clip.id]); copySelection(); menu.remove(); };
  menu.querySelector('[data-c="detach"]').onclick = () => { detachAudio(clip.id); menu.remove(); };
  menu.querySelector('[data-c="replace"]').onclick = () => { selection = new Set([clip.id]); replaceMedia(); menu.remove(); };
  menu.querySelector('[data-c="nest"]').onclick = () => { nestSelection(); menu.remove(); };
  menu.querySelector('[data-c="delete"]').onclick = () => { selection = new Set([clip.id]); deleteSelection(); menu.remove(); };
}

function placeContext(menu, x, y) {
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  const left = Number.isFinite(x) ? x : window.innerWidth - rect.width - 16;
  const top = Number.isFinite(y) ? y : 120;
  menu.style.left = `${Math.max(6, Math.min(left, window.innerWidth - rect.width - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(top, window.innerHeight - rect.height - 6))}px`;
}

function closeContext() { $$('.mo-context').forEach((m) => m.remove()); }

function deleteSelection() {
  if (!selection.size) return;
  const ids = [...selection];
  if (commitOp(`Delete ${ids.length} clip${ids.length === 1 ? '' : 's'}`, { op: 'remove_clip', clipIds: ids })) {
    selection = new Set();
    renderAll();
  }
}

function rippleDeleteSelection() {
  if (!selection.size) return;
  let next = project;
  for (const id of selection) next = rippleDelete(next, id);
  commitProject('Ripple delete', next);
  selection = new Set();
  renderAll();
}

function splitSelection() {
  const at = Math.round(engine.time / FRAME) * FRAME;
  let ids = [...selection];
  if (!ids.length) ids = project.clips.filter((c) => c.start < at && c.start + c.duration > at && !isTrackLocked(c.trackId)).map((c) => c.id);
  if (!ids.length) return toast('Position the playhead inside a clip', true);
  let next = project;
  let count = 0;
  for (const id of ids) {
    const clip = next.clips.find((c) => c.id === id);
    if (!clip || at <= clip.start || at >= clip.start + clip.duration) continue;
    try { next = applyEdit(next, { op: 'split_clip', clipId: id, at }); count += 1; } catch (err) { toast(err.message, true); }
  }
  if (count) { commitProject(`Split ${count} clip${count === 1 ? '' : 's'}`, next); selection = new Set(); renderAll(); }
}

function duplicateSelection() {
  const ids = [...selection];
  if (!ids.length) return;
  let next = project;
  for (const id of ids) next = applyEdit(next, { op: 'duplicate_clip', clipId: id, offset: 0 });
  commitProject('Duplicate clips', next);
  renderAll();
}

function copySelection() {
  const clips = [...selection].map((id) => project.clips.find((c) => c.id === id)).filter(Boolean);
  if (!clips.length) return;
  clipboard = deep(clips);
  toast(`Copied ${clips.length} clip${clips.length === 1 ? '' : 's'}`);
}

function pasteClipboard() {
  if (!clipboard?.length) return toast('Clipboard is empty', true);
  const first = Math.min(...clipboard.map((c) => c.start));
  const at = snapToFrame(project, engine.time);
  let next = project;
  const newSelection = [];
  for (const clip of clipboard) {
    const track = next.tracks.find((t) => t.id === clip.trackId) || next.tracks.find((t) => t.type === (clip.type === 'audio' ? 'audio' : 'video'));
    if (!track) continue;
    const copy = deep(clip);
    copy.id = uid('clip');
    copy.trackId = track.id;
    copy.start = Math.max(0, at + (clip.start - first));
    copy.linkedId = null; copy.groupId = null;
    next = applyEdit(next, { op: 'add_clip', clip: copy });
    newSelection.push(copy.id);
  }
  if (newSelection.length) { commitProject('Paste clips', next); selection = new Set(newSelection); renderAll(); }
}

function selectAll() {
  selection = new Set(project.clips.map((c) => c.id));
  renderAll();
}

function detachAudio(clipId) {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip?.assetId) return toast('This clip has no media', true);
  const asset = assetMap.get(clip.assetId);
  if (!asset?.hasAudio && asset?.kind !== 'audio') return toast('This clip has no audio stream', true);
  const track = project.tracks.find((t) => t.type === 'audio' && !t.locked);
  if (!track) return toast('Add an audio track first', true);
  const next = deep(project);
  const original = next.clips.find((c) => c.id === clipId);
  const audioClip = deep(original);
  audioClip.id = uid('clip');
  audioClip.type = 'audio'; audioClip.trackId = track.id; audioClip.name = `${clip.name} (audio)`;
  audioClip.linkedId = original.id;
  original.linkedId = audioClip.id;
  original.audio.muted = true;
  next.clips.push(audioClip);
  commitProject('Detach audio', next);
  selection = new Set([audioClip.id]);
  renderAll();
}

function replaceMedia() {
  const clip = selectedClip();
  if (!clip) return toast('Select a clip', true);
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'video/*,audio/*,image/*';
  input.onchange = async () => {
    pendingReplaceClip = clip.id;
    await uploadFiles([...input.files]);
  };
  input.click();
}
let pendingReplaceClip = null;

function groupSelection() {
  const id = uid('grp');
  const next = deep(project);
  next.clips.forEach((c) => { if (selection.has(c.id)) c.groupId = id; });
  commitProject('Group clips', next);
}
function linkSelectedClips() {
  const ids = [...selection];
  if (ids.length < 2) return toast('Select at least two clips', true);
  const next = deep(project);
  const primary = next.clips.find((c) => c.id === ids[0]);
  next.clips.forEach((c) => { if (selection.has(c.id)) c.linkedId = primary.id; });
  commitProject('Link clips', next);
}
function ungroupSelection() {
  const next = deep(project);
  next.clips.forEach((c) => { if (selection.has(c.id)) { c.groupId = null; c.linkedId = null; } });
  commitProject('Ungroup clips', next);
}

function nestSelection() {
  const ids = [...selection];
  if (!ids.length) return toast('Select clips to nest', true);
  const clips = project.clips.filter((c) => ids.includes(c.id));
  const minStart = Math.min(...clips.map((c) => c.start));
  const maxEnd = Math.max(...clips.map((c) => c.start + c.duration));
  const involvedTracks = project.tracks.filter((t) => clips.some((c) => c.trackId === t.id));
  const compId = uid('comp');
  const comp = {
    id: compId, name: 'Nested composition', width: project.width, height: project.height, fps: project.fps,
    duration: maxEnd - minStart,
    tracks: involvedTracks.map((t) => ({ ...deep(t), id: uid('trk') })),
    clips: clips.map((c) => {
      const copy = deep(c); copy.id = uid('clip'); copy.start -= minStart; copy.trackId = comp.tracks[involvedTracks.findIndex((t) => t.id === c.trackId)]?.id || comp.tracks[0].id; return copy;
    }),
  };
  const targetTrack = involvedTracks[0];
  const next = deep(project);
  next.compositions.push(comp);
  next.clips = next.clips.filter((c) => !ids.includes(c.id));
  next.clips.push({
    id: uid('clip'), trackId: targetTrack.id, type: 'composition', compositionId: compId, name: 'Nested composition',
    start: minStart, duration: Math.max(1000, maxEnd - minStart), transform: { opacity: 1 }, effects: [], color: {}, audio: {}, keyframes: {},
  });
  commitProject('Create nested composition', next);
  selection = new Set([next.clips[next.clips.length - 1].id]);
  renderAll();
}

function isTrackLocked(trackId) { return !!trackById(project, trackId)?.locked; }

function setMaster(patch, label) {
  const next = deep(project); next.master = { ...next.master, ...patch }; commitProject(label, next);
}
/* ------------------------------------------------------------------------- */
/* Color workspace                                                           */
/* ------------------------------------------------------------------------- */

let scopeRaf = 0;
function renderColorPanel() {
  const body = $('#mo-right-body');
  const clip = selectedClip();
  $('#mo-right-toolbar').innerHTML = '';
  if (!clip) {
    body.innerHTML = '<div class="mo-empty"><b>No clip selected</b>Select a video or image clip on the timeline to open the grading workspace.</div>';
    return;
  }
  if (!['video', 'image', 'shape', 'adjustment'].includes(clip.type)) {
    body.innerHTML = `<div class="mo-empty"><b>${esc(clip.type)} clip</b>Color grading applies to video, image, shape and adjustment layers.</div>`;
    return;
  }
  const c = clip.color || {};
  body.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'mo-color-head';
  head.innerHTML = `<b>${esc(clip.name)}</b><button data-g="compare">${compareImage ? 'Hide compare' : 'Compare'}</button><button data-g="before">Save still</button><button data-g="reset">Reset</button>`;
  body.append(head);
  const basic = document.createElement('div');
  basic.className = 'mo-section';
  basic.innerHTML = `<div class="mo-section-head"><h3>Primary correction</h3><span class="mo-spacer"></span><span class="mo-fine">Rec.709 · ${c.hdr ? 'HDR source' : 'SDR'}</span></div>`;
  const sliders = [
    ['Exposure', 'exposure', -2, 2, 0.01],
    ['Contrast', 'contrast', -1, 1, 0.01],
    ['Saturation', 'saturation', -1, 1, 0.01],
    ['Vibrance', 'vibrance', -1, 1, 0.01],
    ['Temperature', 'temperature', -1, 1, 0.01],
    ['Tint', 'tint', -1, 1, 0.01],
    ['Highlights', 'highlights', -1, 1, 0.01],
    ['Shadows', 'shadows', -1, 1, 0.01],
    ['Whites', 'whites', -1, 1, 0.01],
    ['Blacks', 'blacks', -1, 1, 0.01],
    ['Gamma', 'gamma', 0.2, 3, 0.01],
    ['Hue', 'hue', -180, 180, 1],
  ];
  sliders.forEach(([label, key, min, max, step]) => {
    basic.insertAdjacentHTML('beforeend', `<div class="mo-param"><label>${label}</label><input type="number" min="${min}" max="${max}" step="${step}" value="${Number(c[key] ?? (key === 'gamma' ? 1 : 0)).toFixed(3)}" data-color-num="${key}"><input type="range" min="${min}" max="${max}" step="${step}" value="${c[key] ?? (key === 'gamma' ? 1 : 0)}" data-color="${key}"></div>`);
  });
  body.append(basic);
  basic.querySelectorAll('[data-color]').forEach((input) => {
    const key = input.dataset.color;
    const num = basic.querySelector(`[data-color-num="${key}"]`);
    input.addEventListener('input', () => { liveGrade(clip.id, { [key]: Number(input.value) }, false); num.value = Number(input.value).toFixed(3); drawColorScopes(clip); });
    input.addEventListener('change', () => finishGrade(clip.id, `Color ${key}`));
    num.addEventListener('change', () => { liveGrade(clip.id, { [key]: Number(num.value) }, false); input.value = num.value; finishGrade(clip.id, `Color ${key}`); });
  });
  const wheels = document.createElement('div');
  wheels.className = 'mo-section';
  wheels.innerHTML = `<div class="mo-section-head"><h3>Lift · Gamma · Gain</h3></div><div class="mo-wheel-grid">${['lift', 'gammaRGB', 'gain'].map((k) => `<div class="mo-wheel"><canvas width="120" height="120" data-wheel="${k}"></canvas><span>${k === 'gammaRGB' ? 'Gamma' : k === 'lift' ? 'Lift' : 'Gain'}</span></div>`).join('')}</div>`;
  body.append(wheels);
  wheels.querySelectorAll('[data-wheel]').forEach((canvas) => {
    const key = canvas.dataset.wheel;
    drawWheel(canvas, c[key] || (key === 'gain' ? [1, 1, 1] : key === 'gammaRGB' ? [1, 1, 1] : [0, 0, 0]));
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const apply = (ev) => {
        const dx = clamp((ev.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
        const dy = clamp((ev.clientY - rect.top) / rect.height * 2 - 1, -1, 1);
        const value = key === 'gain' ? [1 + dx * 0.4, 1 - dy * 0.3, 1 - dx * 0.2] : key === 'gammaRGB' ? [1 + dx * 0.4, 1 - dy * 0.3, 1 - dx * 0.2] : [dx * 0.1, -dy * 0.1, -dx * 0.05];
        liveGrade(clip.id, { [key]: value }, false);
        drawWheel(canvas, value);
      };
      apply(e);
      const move = (ev) => apply(ev);
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); finishGrade(clip.id, `${key === 'gammaRGB' ? 'Gamma' : key} wheel`); renderColorPanel(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
    });
  });
  const curves = document.createElement('div');
  curves.className = 'mo-section';
  curves.innerHTML = `<div class="mo-section-head"><h3>RGB curves</h3><span class="mo-spacer"></span><button data-g="curve-reset">Reset</button></div><canvas class="mo-curves" id="mo-curve-canvas" width="320" height="150"></canvas><p class="mo-fine">Click to add a point. Drag points to shape the master curve. Double-click a point to remove it.</p>`;
  body.append(curves);
  const curveCanvas = curves.querySelector('#mo-curve-canvas');
  drawCurveEditor(curveCanvas, c.curves?.master || []);
  curveCanvas.addEventListener('pointerdown', (e) => {
    const pts = deep(c.curves?.master || []);
    const rect = curveCanvas.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
    let idx = pts.findIndex((p) => Math.abs(p[0] - x) < 0.04 && Math.abs(p[1] - y) < 0.05);
    if (idx < 0) { pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]); idx = pts.findIndex((p) => Math.abs(p[0] - x) < 0.0001 && Math.abs(p[1] - y) < 0.0001); }
    const move = (ev) => {
      const nx = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
      const ny = clamp(1 - (ev.clientY - rect.top) / rect.height, 0, 1);
      pts[idx] = [nx, ny];
      drawCurveEditor(curveCanvas, pts);
      liveGrade(clip.id, { curves: { ...(c.curves || {}), master: pts } }, false);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); finishGrade(clip.id, 'RGB curve'); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
    move(e);
  });
  curveCanvas.addEventListener('dblclick', (e) => {
    const rect = curveCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const pts = (c.curves?.master || []).filter((p) => Math.abs(p[0] - x) > 0.04);
    liveGrade(clip.id, { curves: { ...(c.curves || {}), master: pts } }, false);
    finishGrade(clip.id, 'Remove curve point');
    renderColorPanel();
  });
  curves.querySelector('[data-g="curve-reset"]').onclick = () => { liveGrade(clip.id, { curves: { master: [], red: [], green: [], blue: [] } }, false); finishGrade(clip.id, 'Reset curves'); renderColorPanel(); };
  const lut = document.createElement('div');
  lut.className = 'mo-section';
  lut.innerHTML = `<div class="mo-section-head"><h3>LUT</h3></div>
    <label class="mo-field"><span>Load .cube (3D)</span><input type="file" id="mo-lut-file" accept=".cube"></label>
    <div class="mo-row" style="margin-top:5px"><span class="mo-fine">${c.lut?.title ? esc(c.lut.title) : 'No LUT applied'}</span><span class="mo-spacer"></span><button class="mo-btn" id="mo-lut-clear">Clear</button></div>
    <div class="mo-param"><label>LUT intensity</label><input type="number" min="0" max="1" step="0.01" value="${c.lutIntensity ?? 1}" id="mo-lut-intensity"><input type="range" min="0" max="1" step="0.01" value="${c.lutIntensity ?? 1}" id="mo-lut-range"></div>`;
  body.append(lut);
  lut.querySelector('#mo-lut-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = parseCube(await file.text());
      liveGrade(clip.id, { lut: { title: parsed.title, size: parsed.size, data: parsed.data }, lutIntensity: 1 }, false);
      finishGrade(clip.id, 'Apply LUT');
      renderColorPanel();
      toast(`Loaded ${parsed.title} (${parsed.size}³)`);
    } catch (err) { toast(err.message, true); }
  });
  lut.querySelector('#mo-lut-clear').onclick = () => { liveGrade(clip.id, { lut: null }, false); finishGrade(clip.id, 'Remove LUT'); renderColorPanel(); };
  lut.querySelector('#mo-lut-intensity').addEventListener('change', (e) => { liveGrade(clip.id, { lutIntensity: Number(e.target.value) }, false); finishGrade(clip.id, 'LUT intensity'); });
  lut.querySelector('#mo-lut-range').addEventListener('input', (e) => { liveGrade(clip.id, { lutIntensity: Number(e.target.value) }, false); lut.querySelector('#mo-lut-intensity').value = e.target.value; });
  const scopes = document.createElement('div');
  scopes.className = 'mo-section';
  scopes.innerHTML = `<div class="mo-section-head"><h3>Scopes</h3><span class="mo-spacer"></span><button data-g="scopes">Refresh</button></div><div class="mo-scopes"><div class="mo-scope"><b>HISTOGRAM</b><canvas width="150" height="68" id="mo-scope-hist"></canvas></div><div class="mo-scope"><b>WAVEFORM</b><canvas width="150" height="68" id="mo-scope-wave"></canvas></div><div class="mo-scope"><b>RGB PARADE</b><canvas width="150" height="68" id="mo-scope-parade"></canvas></div><div class="mo-scope"><b>VECTORSCOPE</b><canvas width="150" height="68" id="mo-scope-vector"></canvas></div></div>`;
  body.append(scopes);
  const compare = document.createElement('div');
  compare.className = 'mo-section';
  compare.innerHTML = `<div class="mo-section-head"><h3>Before / after</h3></div><div class="mo-before-after"><canvas width="150" height="84" id="mo-before"></canvas><canvas width="150" height="84" id="mo-after"></canvas></div>`;
  body.append(compare);
  head.querySelector('[data-g="reset"]').addEventListener('click', () => { liveGrade(clip.id, { exposure: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, gamma: 1, hue: 0, lift: [0, 0, 0], gammaRGB: [1, 1, 1], gain: [1, 1, 1], curves: { master: [], red: [], green: [], blue: [] }, selective: [], lut: null, preset: null }, false); finishGrade(clip.id, 'Reset grade'); renderColorPanel(); });
  head.querySelector('[data-g="compare"]').addEventListener('click', () => toggleCompare());
  head.querySelector('[data-g="before"]').addEventListener('click', () => saveStill());
  head.querySelector('[data-g="scopes"]').addEventListener('click', () => drawColorScopes(clip));
  drawColorScopes(clip);
  drawBeforeAfter();
}

function drawWheel(canvas, rgb) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height; const cx = W / 2; const cy = H / 2; const r = W / 2 - 4;
  ctx.clearRect(0, 0, W, H);
  for (let a = 0; a < 360; a += 2) {
    const start = (a * Math.PI) / 180;
    const end = ((a + 3) * Math.PI) / 180;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,.05)');
    grad.addColorStop(1, `hsl(${a}, 85%, 55%)`);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, start, end); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.stroke();
  const vx = cx + (Number(rgb[0]) - 1) * 60; const vy = cy - (Number(rgb[1]) - 1) * 60;
  ctx.beginPath(); ctx.arc(clamp(vx, cx - r, cx + r), clamp(vy, cy - r, cy + r), 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.fill(); ctx.stroke();
}

function drawCurveEditor(canvas, points) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) { ctx.beginPath(); ctx.moveTo((W * i) / 4, 0); ctx.lineTo((W * i) / 4, H); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, (H * i) / 4); ctx.lineTo(W, (H * i) / 4); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 1.6; ctx.beginPath();
  const sample = (x) => {
    if (!pts.length) return x;
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i += 1) if (x >= pts[i][0] && x <= pts[i + 1][0]) {
      const t = (x - pts[i][0]) / Math.max(0.0001, pts[i + 1][0] - pts[i][0]);
      const e = t * t * (3 - 2 * t);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * e;
    }
    return x;
  };
  for (let x = 0; x <= 1.0001; x += 1 / 64) { const px = x * W; const py = H - sample(x) * H; if (x === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
  ctx.stroke();
  pts.forEach((p) => { ctx.beginPath(); ctx.arc(p[0] * W, H - p[1] * H, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.stroke(); });
}

function liveGrade(clipId, patch, save = false) {
  if (!liveBefore) liveBefore = deep(project);
  const next = project === liveBefore ? deep(project) : project;
  const clip = next.clips.find((c) => c.id === clipId);
  if (!clip) return;
  clip.color = { ...clip.color, ...patch };
  project = next; scheduleLiveRender();
  if (save) scheduleSave();
}
function finishGrade(clipId, label) {
  if (liveBefore) { bumpHistory(label, project, engine.time); scheduleSave(); liveBefore = null; }
  engine.invalidate();
  drawColorScopes(selectedClip());
}

function drawColorScopes(clip) {
  if (!engine?.canvas) return;
  cancelAnimationFrame(scopeRaf);
  scopeRaf = requestAnimationFrame(() => {
    const source = engine.canvas;
    const W = source.width; const H = source.height;
    const scale = Math.max(1, Math.round(W / 180));
    const small = document.createElement('canvas');
    small.width = Math.max(2, Math.floor(W / scale)); small.height = Math.max(2, Math.floor(H / scale));
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(source, 0, 0, small.width, small.height);
    let data;
    try { data = sctx.getImageData(0, 0, small.width, small.height).data; } catch { return; }
    const hist = $('#mo-scope-hist'); const wave = $('#mo-scope-wave'); const parade = $('#mo-scope-parade'); const vector = $('#mo-scope-vector');
    if (hist) drawHistogram(hist, data);
    if (wave) drawWaveformScope(wave, data, small.width, small.height);
    if (parade) drawParade(parade, data, small.width, small.height);
    if (vector) drawVectorscope(vector, data);
  });
}

function scopeCtx(canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, canvas.width, canvas.height); return ctx; }

function drawHistogram(canvas, data) {
  const ctx = scopeCtx(canvas); const W = canvas.width; const H = canvas.height;
  const bins = [new Array(64).fill(0), new Array(64).fill(0), new Array(64).fill(0)];
  for (let i = 0; i < data.length; i += 4) { bins[0][data[i] >> 2] += 1; bins[1][data[i + 1] >> 2] += 1; bins[2][data[i + 2] >> 2] += 1; }
  const max = Math.max(1, ...bins.flat());
  ['#ef4444', '#22c55e', '#60a5fa'].forEach((color, ch) => {
    ctx.strokeStyle = color; ctx.globalAlpha = 0.85; ctx.beginPath();
    bins[ch].forEach((v, i) => { const x = (i / 63) * W; const y = H - (v / max) * H; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke(); ctx.globalAlpha = 1;
  });
}

function drawWaveformScope(canvas, data, w, h) {
  const ctx = scopeCtx(canvas); const W = canvas.width; const H = canvas.height;
  ctx.fillStyle = 'rgba(52,211,153,.28)';
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4;
    const lum = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
    ctx.fillRect((x / w) * W, H - lum * H, 1, 1);
  }
}

function drawParade(canvas, data, w, h) {
  const ctx = scopeCtx(canvas); const W = canvas.width; const H = canvas.height;
  const colors = ['rgba(239,68,68,.35)', 'rgba(34,197,94,.32)', 'rgba(96,165,250,.32)'];
  for (let ch = 0; ch < 3; ch += 1) {
    ctx.fillStyle = colors[ch];
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const v = data[(y * w + x) * 4 + ch] / 255;
      ctx.fillRect(((ch + x / w) / 3) * W, H - v * H, 1, 1);
    }
  }
}

function drawVectorscope(canvas, data) {
  const ctx = scopeCtx(canvas); const W = canvas.width; const H = canvas.height;
  const cx = W / 2; const cy = H / 2; const r = Math.min(W, H) * 0.44;
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < data.length; i += 16) {
    const rr = data[i] / 255; const gg = data[i + 1] / 255; const bb = data[i + 2] / 255;
    const y = rr * 0.299 + gg * 0.587 + bb * 0.114;
    const u = (bb - y) * 0.565; const v = (rr - y) * 0.713;
    ctx.fillStyle = `rgba(${data[i]},${data[i + 1]},${data[i + 2]},.4)`;
    ctx.fillRect(cx + u * r * 1.7, cy - v * r * 1.7, 1.5, 1.5);
  }
}

function drawBeforeAfter() {
  const after = $('#mo-after');
  const before = $('#mo-before');
  if (!after || !before) return;
  after.getContext('2d').drawImage(engine.canvas, 0, 0, after.width, after.height);
  const ctx = before.getContext('2d');
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, before.width, before.height);
  if (!prevSnapshotCanvas) prevSnapshotCanvas = captureCanvas(engine.canvas);
  if (prevSnapshotCanvas) ctx.drawImage(prevSnapshotCanvas, 0, 0, before.width, before.height);
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, before.height - 14, 50, 14);
  ctx.fillStyle = '#fff'; ctx.font = '9px monospace'; ctx.fillText('BEFORE', 4, before.height - 4);
}

function captureCanvas(source) {
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}

async function toggleCompare() {
  if (compareImage) { compareImage = null; engine.setCompare(null); renderColorPanel(); return; }
  try {
    status('Rendering comparison frame…');
    const res = await fetch(`${API}/still`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, time: engine.time, width: Math.min(1280, project.width) }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Comparison render failed');
    const blob = await res.blob();
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    compareImage = img; engine.setCompare(img);
    status('Comparison frame loaded');
    renderColorPanel();
  } catch (err) { toast(err.message, true); status('Ready'); }
}

async function saveStill() {
  try {
    const res = await fetch(`${API}/still`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, time: engine.time, width: Math.min(1920, project.width) }) });
    if (!res.ok) throw new Error('Still render failed');
    downloadBlob(await res.blob(), `${(project.name || 'frame').replace(/[^\w-]+/g, '-')}-${frameOf(project, engine.time)}.png`);
  } catch (err) { toast(err.message, true); }
}

/* ------------------------------------------------------------------------- */
/* Keyframes                                                                 */
/* ------------------------------------------------------------------------- */

function keyframeTargets(clip) {
  const targets = [
    { id: 'transform.x', label: 'Position X', get: (c) => c.transform.x ?? 0, set: (c, v) => { c.transform.x = v; }, min: -1, max: 1 },
    { id: 'transform.y', label: 'Position Y', get: (c) => c.transform.y ?? 0, set: (c, v) => { c.transform.y = v; }, min: -1, max: 1 },
    { id: 'transform.scale', label: 'Scale', get: (c) => c.transform.scale ?? 1, set: (c, v) => { c.transform.scale = v; }, min: 0.1, max: 4 },
    { id: 'transform.rotation', label: 'Rotation', get: (c) => c.transform.rotation ?? 0, set: (c, v) => { c.transform.rotation = v; }, min: -360, max: 360 },
    { id: 'transform.opacity', label: 'Opacity', get: (c) => c.transform.opacity ?? 1, set: (c, v) => { c.transform.opacity = clamp(v, 0, 1); }, min: 0, max: 1 },
    { id: 'audio.gain', label: 'Audio gain', get: (c) => c.audio.gain ?? 1, set: (c, v) => { c.audio.gain = clamp(v, 0, 2); }, min: 0, max: 2 },
    { id: 'color.exposure', label: 'Exposure', get: (c) => c.color.exposure ?? 0, set: (c, v) => { c.color.exposure = v; }, min: -2, max: 2 },
    { id: 'color.contrast', label: 'Contrast', get: (c) => c.color.contrast ?? 0, set: (c, v) => { c.color.contrast = v; }, min: -1, max: 1 },
    { id: 'color.saturation', label: 'Saturation', get: (c) => c.color.saturation ?? 0, set: (c, v) => { c.color.saturation = v; }, min: -1, max: 1 },
  ];
  for (const fx of clip.effects || []) for (const [key, value] of Object.entries(fx.params || {})) {
    if (typeof value !== 'number') continue;
    targets.push({ id: `effect.${fx.id}.${key}`, label: `${effectById(fx.type)?.name || fx.type} · ${key}`, get: () => fx.params[key], set: (c, v) => { const f = c.effects.find((x) => x.id === fx.id); if (f) f.params[key] = v; }, min: 0, max: Math.max(2, value * 3), effectId: fx.id, param: key });
  }
  return targets;
}

function currentTargetValue(clip, targetId) {
  if (targetId.startsWith('effect.')) {
    const [, fxId, param] = targetId.split('.');
    return clip.effects.find((f) => f.id === fxId)?.params?.[param] ?? 0;
  }
  const [, key] = targetId.split('.');
  if (targetId.startsWith('transform.')) return clip.transform[key] ?? 0;
  if (targetId.startsWith('audio.')) return clip.audio[key] ?? 0;
  if (targetId.startsWith('color.')) return clip.color[key] ?? 0;
  return 0;
}

function keyframesFor(clip, targetId) {
  if (targetId.startsWith('effect.')) {
    const [, fxId, param] = targetId.split('.');
    return clip.effects.find((f) => f.id === fxId)?.keyframes?.[param] || [];
  }
  return clip.keyframes?.[targetId.split('.')[1]] || [];
}

function renderKeyframesPanel() {
  const body = $('#mo-right-body');
  const clip = selectedClip();
  if (!clip) { body.innerHTML = '<div class="mo-empty"><b>No clip selected</b>Select a clip to animate its properties.</div>'; return; }
  const targets = keyframeTargets(clip);
  if (!targets.find((t) => t.id === keyframeProperty)) keyframeProperty = targets[0].id;
  const target = targets.find((t) => t.id === keyframeProperty);
  const frames = keyframesFor(clip, keyframeProperty);
  const value = currentTargetValue(clip, keyframeProperty);
  body.innerHTML = `<div class="mo-section">
    <div class="mo-section-head"><h3>Keyframe editor</h3><span class="mo-spacer"></span><button data-k="clear">Clear</button></div>
    <label class="mo-field"><span>Property</span><select id="mo-kf-prop">${targets.map((t) => `<option value="${esc(t.id)}" ${t.id === keyframeProperty ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
    <div class="mo-row" style="margin-top:6px"><button class="mo-btn primary" data-k="add">◆ Add at playhead</button><span class="mo-spacer"></span><span class="mo-fine">${frames.length} keys · value ${value.toFixed(3)}</span></div>
    <div class="mo-keyframe-lane" id="mo-kf-lane"><div class="mo-kf-playhead" style="position:absolute;top:0;bottom:0;width:1px;background:var(--mo-accent);left:0"></div></div>
    <canvas class="mo-kf-curve" id="mo-kf-curve" width="300" height="96"></canvas>
    <div class="mo-grid-2" style="margin-top:6px"><label class="mo-field"><span>Interpolation</span><select id="mo-kf-ease"><option value="linear">Linear</option><option value="ease-in">Ease in</option><option value="ease-out">Ease out</option><option value="ease-in-out" selected>Ease in/out</option><option value="hold">Hold</option></select></label><label class="mo-field"><span>Keyframe time</span><input id="mo-kf-time" type="number" step="0.05" value="${toSeconds(engine.time - clip.start).toFixed(2)}"></label></div>
    <div class="mo-row" style="margin-top:6px"><button class="mo-btn" data-k="copy">Copy keys</button><button class="mo-btn" data-k="paste">Paste</button><button class="mo-btn" data-k="preset-fade">Fade preset</button></div>
    <p class="mo-fine" style="margin-top:7px">Click a diamond to jump. Drag horizontally in the lane to retime; drag points in the graph to change value. Hold interpolation freezes the previous value.</p>
  </div>`;
  const lane = body.querySelector('#mo-kf-lane');
  const duration = Math.max(1, clip.duration);
  frames.forEach((k) => {
    const d = document.createElement('div');
    d.className = 'mo-kf-diamond';
    d.style.left = `${(k.t / duration) * 100}%`;
    d.title = `${(k.t / TICKS).toFixed(2)}s · ${k.value}`;
    d.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const rect = lane.getBoundingClientRect();
      const move = (ev) => {
        const t = clamp(((ev.clientX - rect.left) / rect.width) * duration, 0, duration);
        d.style.left = `${(t / duration) * 100}%`;
        d.dataset.t = String(t);
      };
      const up = () => {
        const t = Math.round(Number(d.dataset.t || k.t));
        const next = deep(project);
        const c = next.clips.find((x) => x.id === clip.id);
        setKeyframesOnClip(c, keyframeProperty, frames.map((f) => (f === k ? { ...f, t } : f)).sort((a, b) => a.t - b.t));
        commitProject('Retime keyframe', next);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
    });
    lane.append(d);
  });
  const playhead = lane.querySelector('.mo-kf-playhead');
  if (playhead) playhead.style.left = `${clamp((engine.time - clip.start) / duration, 0, 1) * 100}%`;
  lane.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.mo-kf-diamond')) return;
    const rect = lane.getBoundingClientRect();
    const at = clamp((e.clientX - rect.left) / rect.width, 0, 1) * duration;
    engine.setTime(clip.start + at);
    renderKeyframesPanel();
  });
  const curve = body.querySelector('#mo-kf-curve');
  drawKeyframeCurve(curve, clip, target, frames);
  curve.addEventListener('pointerdown', (e) => {
    const rect = curve.getBoundingClientRect();
    const getPos = (ev) => ({ t: clamp((ev.clientX - rect.left) / rect.width, 0, 1) * duration, v: target.min + (1 - clamp((ev.clientY - rect.top) / rect.height, 0, 1)) * (target.max - target.min) });
    const pos = getPos(e);
    const pts = frames.map((k) => ({ ...k }));
    let idx = pts.findIndex((k) => Math.abs(k.t / duration - pos.t / duration) < 0.05);
    if (idx < 0) { pts.push({ t: pos.t, value: pos.v, easing: 'ease-in-out' }); pts.sort((a, b) => a.t - b.t); idx = pts.findIndex((k) => k.t === pos.t); }
    const move = (ev) => {
      const p = getPos(ev);
      pts[idx] = { ...pts[idx], t: p.t, value: p.v };
      drawKeyframeCurve(curve, clip, target, pts);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const next = deep(project);
      const c = next.clips.find((x) => x.id === clip.id);
      setKeyframesOnClip(c, keyframeProperty, pts.sort((a, b) => a.t - b.t));
      commitProject('Edit keyframes', next);
      renderKeyframesPanel();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  });
  body.querySelector('#mo-kf-prop').addEventListener('change', (e) => { keyframeProperty = e.target.value; renderKeyframesPanel(); });
  body.querySelector('[data-k="add"]').addEventListener('click', () => addKeyframeAtPlayhead(clip, target));
  body.querySelector('[data-k="clear"]').addEventListener('click', () => {
    const next = deep(project);
    const c = next.clips.find((x) => x.id === clip.id);
    setKeyframesOnClip(c, keyframeProperty, []);
    commitProject('Clear keyframes', next);
    renderKeyframesPanel();
  });
  body.querySelector('#mo-kf-time').addEventListener('change', (e) => { engine.setTime(clip.start + Number(e.target.value) * TICKS); renderKeyframesPanel(); });
  body.querySelector('#mo-kf-ease').addEventListener('change', (e) => {
    const next = deep(project);
    const c = next.clips.find((x) => x.id === clip.id);
    setKeyframesOnClip(c, keyframeProperty, frames.map((k) => ({ ...k, easing: e.target.value })));
    commitProject('Keyframe interpolation', next);
    renderKeyframesPanel();
  });
  body.querySelector('[data-k="copy"]').onclick = () => { window.__motionKfClipboard = deep(frames); toast('Keyframes copied'); };
  body.querySelector('[data-k="paste"]').onclick = () => {
    if (!window.__motionKfClipboard) return toast('No keyframes copied', true);
    const next = deep(project);
    const c = next.clips.find((x) => x.id === clip.id);
    setKeyframesOnClip(c, keyframeProperty, deep(window.__motionKfClipboard));
    commitProject('Paste keyframes', next);
    renderKeyframesPanel();
  };
  body.querySelector('[data-k="preset-fade"]').onclick = () => applyAnimationPreset(clip, 'fade');
}

function setKeyframesOnClip(clip, targetId, frames) {
  const sorted = frames.slice().sort((a, b) => a.t - b.t);
  if (targetId.startsWith('effect.')) {
    const [, fxId, param] = targetId.split('.');
    const fx = clip.effects.find((f) => f.id === fxId);
    if (fx) fx.keyframes = { ...fx.keyframes, [param]: sorted };
  } else {
    clip.keyframes = { ...clip.keyframes, [targetId.split('.')[1]]: sorted };
  }
  return sorted;
}

function addKeyframeAtPlayhead(clip, target) {
  const t = snapToFrame(project, engine.time - clip.start);
  if (t < 0 || t > clip.duration) return toast('Move the playhead inside the clip', true);
  const existing = keyframesFor(clip, keyframeProperty).filter((k) => Math.abs(k.t - t) > 1000);
  existing.push({ t, value: currentTargetValue(clip, keyframeProperty), easing: 'ease-in-out' });
  const next = deep(project);
  const c = next.clips.find((x) => x.id === clip.id);
  setKeyframesOnClip(c, keyframeProperty, existing);
  commitProject(`Keyframe ${target.label}`, next);
  renderKeyframesPanel();
}

function drawKeyframeCurve(canvas, clip, target, frames) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i += 1) { ctx.beginPath(); ctx.moveTo(0, (H * i) / 5); ctx.lineTo(W, (H * i) / 5); ctx.stroke(); }
  const duration = Math.max(1, clip.duration);
  const span = target.max - target.min;
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 1.5; ctx.beginPath();
  if (!sorted.length) {
    const v = currentTargetValue(clip, keyframeProperty);
    const y = H - clamp((v - target.min) / span, 0, 1) * H;
    ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  } else {
    const sample = (t) => {
      if (t <= sorted[0].t) return sorted[0].value;
      if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].value;
      for (let i = 0; i < sorted.length - 1; i += 1) if (t >= sorted[i].t && t <= sorted[i + 1].t) {
        const a = sorted[i]; const b = sorted[i + 1];
        if (a.easing === 'hold') return a.value;
        let x = (t - a.t) / Math.max(1, b.t - a.t);
        if (a.easing === 'ease-in') x = x * x;
        else if (a.easing === 'ease-out') x = 1 - (1 - x) ** 2;
        else if (a.easing === 'ease-in-out') x = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) ** 2;
        return a.value + (b.value - a.value) * x;
      }
      return sorted[sorted.length - 1].value;
    };
    for (let i = 0; i <= 80; i += 1) {
      const t = (i / 80) * duration;
      const y = H - clamp((sample(t) - target.min) / span, 0, 1) * H;
      if (i === 0) ctx.moveTo(0, y); else ctx.lineTo((i / 80) * W, y);
    }
    ctx.stroke();
  }
  sorted.forEach((k) => {
    const x = (k.t / duration) * W;
    const y = H - clamp((k.value - target.min) / span, 0, 1) * H;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111827'; ctx.stroke();
  });
}

function applyAnimationPreset(clip, type) {
  const next = deep(project);
  const c = next.clips.find((x) => x.id === clip.id);
  const dur = c.duration;
  if (type === 'fade') {
    c.keyframes = { ...c.keyframes, opacity: [{ t: 0, value: 0, easing: 'ease-out' }, { t: Math.min(seconds(0.6), dur / 4), value: 1, easing: 'ease-in-out' }, { t: dur - Math.min(seconds(0.6), dur / 4), value: 1, easing: 'ease-in-out' }, { t: dur, value: 0, easing: 'ease-in' }] };
  }
  commitProject('Animation preset', next);
  renderKeyframesPanel();
}

/* ------------------------------------------------------------------------- */
/* Audio inspector                                                           */
/* ------------------------------------------------------------------------- */

function renderAudioInspector() {
  const body = $('#mo-right-body');
  const clip = selectedClip();
  const audioTracks = project.tracks.filter((t) => t.type === 'audio');
  body.innerHTML = `<div class="mo-section"><div class="mo-section-head"><h3>Master</h3><span class="mo-spacer"></span><span class="mo-fine">${-20 * Math.log10(Math.max(0.001, engine.audio?.peak || 0.001)) < -60 ? '-∞' : `${Math.round(20 * Math.log10(engine.audio?.peak || 0.001))} dB`}</span></div>
    <div class="mo-param"><label>Master volume</label><input type="number" min="0" max="2" step="0.01" value="${project.master.volume ?? 1}" data-master="volume"><input type="range" min="0" max="2" step="0.01" value="${project.master.volume ?? 1}" data-master-range="volume"></div>
    <label class="mo-check"><input type="checkbox" id="mo-audio-limiter" ${project.master.limiter !== false ? 'checked' : ''}> Limiter at ${project.master.limiterCeiling ?? -1} dBFS</label>
    </div>
    <div class="mo-section"><div class="mo-section-head"><h3>Tracks</h3></div>${audioTracks.map((t) => `<div class="mo-param" style="grid-template-columns:1fr 70px"><label>${esc(t.name)}</label><input type="number" min="0" max="2" step="0.01" value="${t.volume ?? 1}" data-trk-vol="${t.id}"><input type="range" min="0" max="2" step="0.01" value="${t.volume ?? 1}" data-trk-range="${t.id}"></div>`).join('') || '<p class="mo-fine">No audio tracks.</p>'}</div>`;
  if (clip) body.append(audioInspectorSection(clip));
  body.insertAdjacentHTML('beforeend', '<p class="mo-fine" style="margin-top:8px">Audio faders, EQ, ducking and fades are applied in both preview and export. Per-track gain is mixed before the master limiter.</p>');
  body.querySelectorAll('[data-master]').forEach((input) => input.addEventListener('change', () => setMaster({ volume: Number(input.value) }, 'Master volume')));
  body.querySelectorAll('[data-master-range]').forEach((input) => input.addEventListener('input', () => { setMaster({ volume: Number(input.value) }, 'Master volume'); body.querySelector('[data-master="volume"]').value = input.value; }));
  $('#mo-audio-limiter')?.addEventListener('change', (e) => setMaster({ limiter: e.target.checked }, 'Master limiter'));
  body.querySelectorAll('[data-trk-vol]').forEach((input) => input.addEventListener('change', () => updateTrack(input.dataset.trkVol, { volume: Number(input.value) }, 'Track volume')));
  body.querySelectorAll('[data-trk-range]').forEach((input) => input.addEventListener('input', () => { updateTrack(input.dataset.trkRange, { volume: Number(input.value) }, 'Track volume'); body.querySelector(`[data-trk-vol="${input.dataset.trkRange}"]`).value = input.value; }));
}

function updateTrack(id, patch, label) {
  commitOp(label, { op: 'update_track', trackId: id, patch });
}
/* ------------------------------------------------------------------------- */
/* Timeline renderer                                                         */
/* ------------------------------------------------------------------------- */

const timelineScroll = $('#mo-timeline-scroll');
const timelineContent = $('#mo-timeline-content');
const rulerEl = $('#mo-ruler');
const trackHeadsEl = $('#mo-track-heads');
const tracksEl = $('#mo-tracks');
const playheadEl = $('#mo-playhead');

function headWidth() {
  return parseFloat(getComputedStyle(app).getPropertyValue('--mo-head-w')) || 176;
}
function trackHeight(track) {
  if (track.type === 'audio') return 44;
  if (track.type === 'subtitle' || track.type === 'text') return 38;
  return 50;
}
function timelineSeconds() {
  return Math.max((timelineDuration(project) || project.duration) / TICKS, 30);
}

function chooseTickStep() {
  const target = 74 / zoom;
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s >= target) || 600;
}

function renderTimeline() {
  if (!timelineScroll) return;
  const headW = headWidth();
  const viewport = timelineScroll.clientWidth || 900;
  const secondsTotal = Math.max(timelineSeconds() + 4, (viewport - headW) / zoom + 2);
  const width = Math.max(viewport - headW, secondsTotal * zoom);
  timelineContent.style.gridTemplateColumns = `${headW}px ${width}px`;
  timelineContent.style.width = `${headW + width}px`;
  trackHeadsEl.style.width = `${headW}px`;
  renderRuler(width);
  renderTrackHeads();
  renderLanes(width);
  renderClips(width);
  updatePlayhead();
  if (!project.clips.length) {
    let hint = tracksEl.querySelector('.mo-empty-timeline');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'mo-empty-timeline';
      hint.innerHTML = 'Drag media here to start editing<br><span style="font-size:9px;opacity:.7">or use Media → Import. Press Space to play, S to split.</span>';
      tracksEl.append(hint);
    }
  } else {
    tracksEl.querySelector('.mo-empty-timeline')?.remove();
  }
}

function renderRuler(width) {
  const startMs = performance.now();
  rulerEl.innerHTML = '';
  const step = chooseTickStep();
  const end = width / zoom;
  const majorEvery = step < 1 ? 5 : 1;
  const offsetLeft = timelineScroll.scrollLeft;
  const visibleStart = Math.max(0, offsetLeft / zoom - step);
  const visibleEnd = visibleStart + (timelineScroll.clientWidth / zoom) + step * 2;
  let i = Math.floor(visibleStart / step);
  for (let t = Math.max(0, i * step); t <= Math.min(end, visibleEnd); t += step) {
    const tick = document.createElement('div');
    tick.className = `mo-ruler-tick${i % majorEvery === 0 ? ' is-major' : ''}`;
    tick.style.left = `${t * zoom}px`;
    const s = Math.floor(t);
    const frames = Math.floor((t % 1) * project.fps);
    tick.textContent = step < 1 ? `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.round((t % 1) * 10))}` : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    if (step < 1 && i % majorEvery !== 0) tick.textContent = '';
    rulerEl.append(tick);
    i += 1;
  }
  (project.markers || []).forEach((marker) => {
    if (marker.t / TICKS < visibleStart || marker.t / TICKS > visibleEnd) return;
    const m = document.createElement('div');
    m.className = 'mo-ruler-marker';
    m.style.left = `${(marker.t / TICKS) * zoom}px`;
    m.title = `${marker.label} · ${fmt(marker.t)}`;
    m.addEventListener('pointerdown', (e) => { e.stopPropagation(); seek(marker.t); });
    m.addEventListener('contextmenu', (e) => { e.preventDefault(); if (confirm(`Remove marker “${marker.label}”?`)) commitOp('Remove marker', { op: 'remove_marker', markerId: marker.id }); });
    rulerEl.append(m);
  });
  (project.beats || []).forEach((beat) => {
    if (beat / TICKS < visibleStart || beat / TICKS > visibleEnd) return;
    const b = document.createElement('div');
    b.className = 'mo-ruler-tick is-beat';
    b.style.left = `${(beat / TICKS) * zoom}px`;
    rulerEl.append(b);
  });
  void startMs;
}

function renderTrackHeads() {
  trackHeadsEl.innerHTML = '';
  project.tracks.forEach((track) => {
    const head = document.createElement('div');
    head.className = `mo-track-head${selectedTrackId === track.id ? ' is-selected' : ''}`;
    head.style.height = `${trackHeight(track)}px`;
    head.dataset.trackId = track.id;
    const type = track.type === 'overlay' ? 'video' : track.type;
    head.innerHTML = `<span class="mo-track-type ${esc(type)}">${track.type === 'video' || track.type === 'overlay' ? 'V' : track.type === 'audio' ? 'A' : track.type === 'text' ? 'T' : track.type === 'subtitle' ? 'S' : track.type === 'effect' ? 'FX' : 'ADJ'}</span>
      <span class="mo-track-name" title="${esc(track.name)}">${esc(track.name)}</span>
      <div class="mo-track-btns">
        <button data-tt="hide" class="${track.hidden ? 'on' : ''}" title="Hide track">👁</button>
        <button data-tt="mute" class="${track.muted ? 'on mute' : ''}" title="Mute track">M</button>
        <button data-tt="solo" class="${track.solo ? 'on solo' : ''}" title="Solo track">S</button>
        <button data-tt="lock" class="${track.locked ? 'on' : ''}" title="Lock track">🔒</button>
      </div>`;
    head.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      selectedTrackId = track.id; selection = new Set();
      refreshSelectionUI();
    });
    head.querySelector('.mo-track-name').addEventListener('dblclick', () => {
      const name = head.querySelector('.mo-track-name');
      const input = document.createElement('input');
      input.value = track.name;
      name.innerHTML = ''; name.append(input); input.focus(); input.select();
      const finish = () => {
        const value = input.value.trim();
        if (value && value !== track.name) updateTrack(track.id, { name: value }, 'Rename track');
        else renderTimeline();
      };
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') { input.value = track.name; input.blur(); } });
    });
    head.querySelectorAll('[data-tt]').forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.tt === 'hide' ? 'hidden' : btn.dataset.tt;
      updateTrack(track.id, { [key]: !track[key] }, `Track ${key}`);
    }));
    head.addEventListener('dragover', (e) => { e.preventDefault(); head.style.background = 'var(--mo-panel-3)'; });
    head.addEventListener('dragleave', () => { head.style.background = ''; });
    head.addEventListener('drop', (e) => {
      e.preventDefault();
      const assetId = e.dataTransfer.getData('application/x-cascade-asset');
      const effectId = e.dataTransfer.getData('application/x-cascade-effect');
      if (assetId && !track.locked) addAssetToTimeline(assetId, { trackId: track.id, start: snapToFrame(project, engine.time) });
      else if (effectId && selection.size) applyEffectToSelection(effectId);
      head.style.background = '';
    });
    trackHeadsEl.append(head);
  });
  if (!project.tracks.length) trackHeadsEl.innerHTML = '<div class="mo-empty" style="padding:16px 8px">No tracks</div>';
}

function laneFor(trackId) {
  return tracksEl.querySelector(`.mo-track-lane[data-track-id="${trackId}"]`);
}

function bindLaneEvents(lane) {
  lane.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.mo-clip')) return;
    const track = trackById(project, lane.dataset.trackId);
    if (!track) return;
    selectedTrackId = track.id;
    selection = new Set();
    closeContext();
    if (tool !== 'hand') {
      if (engine.playing) engine.pause();
      seek(timeFromClientX(e.clientX));
    }
    refreshSelectionUI();
  });
  lane.addEventListener('dragover', (e) => { e.preventDefault(); lane.classList.add('is-drop-target'); });
  lane.addEventListener('dragleave', () => lane.classList.remove('is-drop-target'));
  lane.addEventListener('drop', (e) => {
    e.preventDefault();
    lane.classList.remove('is-drop-target');
    const track = trackById(project, lane.dataset.trackId);
    if (!track) return;
    const assetId = e.dataTransfer.getData('application/x-cascade-asset');
    const effectId = e.dataTransfer.getData('application/x-cascade-effect');
    if (assetId && !track.locked) {
      const start = snapToFrame(project, timeFromClientX(e.clientX));
      addAssetToTimeline(assetId, { trackId: track.id, start });
    } else if (effectId) {
      const clip = clipAtPoint(e.clientX, e.clientY);
      if (clip) applyEffectToSelection(effectId, clip.id);
    }
  });
}

/* Lanes are reconciled, not rebuilt: clip elements and their decoded waveform
 * bitmaps survive re-renders so selection/zoom changes stay cheap. */
function renderLanes(width) {
  const existing = new Map();
  for (const lane of $$('.mo-track-lane', tracksEl)) existing.set(lane.dataset.trackId, lane);
  const ordered = [];
  for (const track of project.tracks) {
    let lane = existing.get(track.id);
    if (!lane) {
      lane = document.createElement('div');
      lane.dataset.trackId = track.id;
      bindLaneEvents(lane);
    }
    existing.delete(track.id);
    lane.className = `mo-track-lane${selectedTrackId === track.id ? ' is-selected' : ''}${track.locked ? ' is-locked' : ''}`;
    lane.style.height = `${trackHeight(track)}px`;
    lane.style.width = `${width}px`;
    ordered.push(lane);
  }
  for (const lane of existing.values()) lane.remove();
  ordered.forEach((lane) => tracksEl.append(lane));
  if (!project.tracks.length) tracksEl.innerHTML = '<div class="mo-empty" style="padding:16px 8px">No tracks</div>';
}

function visibleRange() {
  const start = Math.max(0, timelineScroll.scrollLeft / zoom - 1.5);
  const end = start + (timelineScroll.clientWidth || 1000) / zoom + 3;
  return { start, end };
}

/* Vertical culling: only clips whose lane intersects the scrolled viewport get
 * DOM nodes. Off-screen tracks cost one empty lane each. */
function visibleTrackWindow() {
  const offsets = new Map();
  let y = 0;
  for (const track of project.tracks) {
    const h = trackHeight(track);
    offsets.set(track.id, { top: y, bottom: y + h });
    y += h;
  }
  const top = timelineScroll.scrollTop - 26;
  return { offsets, top, bottom: top + (timelineScroll.clientHeight || 600) };
}

function clipSignature(clip) {
  const asset = assetMap.get(clip.assetId);
  const hasAudio = clip.type === 'audio' || (clip.type === 'video' && !!asset?.hasAudio);
  return [clip.type, clip.name, asset?.thumbnailUrl || '', hasAudio ? 'a' : '',
    clip.effects?.length || 0, clip.transitionIn ? 't' : '',
    Math.abs(clip.speed - 1) > 0.01 ? clip.speed.toFixed(2) : '', clip.reverse ? 'r' : '', clip.freeze ? 'f' : ''].join('|');
}

function clipMarkup(clip, widthPx) {
  const asset = assetMap.get(clip.assetId);
  const hasAudio = clip.type === 'audio' || (clip.type === 'video' && !!asset?.hasAudio);
  let inner = '';
  if (asset && ['video', 'image'].includes(clip.type) && asset.thumbnailUrl) {
    inner += `<div class="mo-clip-thumbs" style="background-image:url('${asset.thumbnailUrl}')" aria-hidden="true"></div>`;
  }
  if (hasAudio) inner += `<canvas class="mo-clip-wave" width="${Math.min(1200, Math.round(widthPx))}" height="32" data-wave="1"></canvas>`;
  inner += `<div class="mo-clip-label"><i>${clip.type === 'video' ? '▶' : clip.type === 'audio' ? '♪' : clip.type === 'text' ? 'T' : clip.type === 'subtitle' ? 'CC' : clip.type === 'shape' ? '◆' : clip.type === 'composition' ? '◇' : 'FX'}</i>${esc(clip.name)}</div>`;
  inner += `<div class="mo-clip-badges">${Math.abs(clip.speed - 1) > 0.01 ? `<span>${clip.speed.toFixed(2)}×</span>` : ''}${clip.reverse ? '<span>REV</span>' : ''}${clip.freeze ? '<span>FREEZE</span>' : ''}</div>`;
  if (clip.effects?.length) inner += `<span class="mo-clip-fx">FX ${clip.effects.length}</span>`;
  if (clip.transitionIn) inner += '<span class="mo-transition-badge" title="Incoming transition"></span>';
  inner += '<div class="mo-trim left" data-trim="left"></div><div class="mo-trim right" data-trim="right"></div>';
  return inner;
}

function createClipElement() {
  const el = document.createElement('div');
  el.addEventListener('pointerdown', (e) => {
    const clip = project.clips.find((c) => c.id === el.dataset.clipId);
    if (clip) beginClipDrag(e, clip, el);
  });
  el.addEventListener('dblclick', () => {
    const clip = project.clips.find((c) => c.id === el.dataset.clipId);
    if (!clip) return;
    selection = new Set([clip.id]); selectedTrackId = clip.trackId;
    if (clip.type === 'subtitle') setLeftTab('subtitles');
    else setRightTab('inspector');
    engine.setTime(clip.start);
    renderAll();
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const clip = project.clips.find((c) => c.id === el.dataset.clipId);
    if (!clip) return;
    selection = new Set([clip.id]);
    refreshSelectionUI();
    clipMenu(clip, e.clientX, e.clientY);
  });
  el.addEventListener('dragover', (e) => { e.preventDefault(); });
  el.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    const effectId = e.dataTransfer.getData('application/x-cascade-effect');
    const clip = project.clips.find((c) => c.id === el.dataset.clipId);
    if (effectId && clip) applyEffectToSelection(effectId, clip.id);
  });
  return el;
}

function renderClips(width) {
  const range = visibleRange();
  const { offsets, top, bottom } = visibleTrackWindow();
  const clips = project.clips.filter((c) => c.start / TICKS < range.end && (c.start + c.duration) / TICKS > range.start);
  const seen = new Set();
  for (const clip of clips) {
    const rect = offsets.get(clip.trackId);
    if (!rect || rect.bottom < top || rect.top > bottom) continue;
    const lane = laneFor(clip.trackId);
    if (!lane) continue;
    seen.add(clip.id);
    const widthPx = Math.max(2, (clip.duration / TICKS) * zoom);
    let el = clipElements.get(clip.id);
    if (!el || !el.isConnected) { el = createClipElement(); el.dataset.clipId = clip.id; clipElements.set(clip.id, el); }
    el.className = `mo-clip ${clip.type === 'image' ? 'image' : clip.type}${selection.has(clip.id) ? ' is-selected' : ''}`;
    if (clip.type === 'video' && assetMap.get(clip.assetId)?.hasAudio) el.classList.add('has-audio');
    el.style.left = `${(clip.start / TICKS) * zoom}px`;
    el.style.width = `${widthPx}px`;
    el.title = `${clip.name}\n${fmt(clip.start)} → ${fmt(clip.start + clip.duration)}`;
    const sig = `${clipSignature(clip)}|${Math.round(widthPx)}`;
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = clipMarkup(clip, widthPx);
    }
    if (lane !== el.parentElement) lane.append(el);
    if (widthPx > 20) drawClipWave(el, clip);
  }
  for (const [id, el] of clipElements) {
    if (seen.has(id)) continue;
    el.remove();
    clipElements.delete(id);
  }
}

/* Waveforms are rasterised once per (asset, width, trim) and cached as a small
 * bitmap, so zooming or scrolling never reruns the per-column loop. */
async function drawClipWave(el, clip) {
  const canvas = el.querySelector('canvas[data-wave]');
  if (!canvas) return;
  const asset = assetMap.get(clip.assetId);
  if (!asset?.waveformUrl) return;
  const W = canvas.width; const H = canvas.height;
  const key = `${asset.id}:${W}:${H}:${clip.inPoint}:${clip.duration}`;
  if (canvas.dataset.waveKey === key) return;
  try {
    let peaks = waveCache.get(asset.id);
    if (!peaks) {
      const res = await fetch(asset.waveformUrl);
      if (!res.ok) return;
      const j = await res.json();
      peaks = Array.isArray(j.peaks) ? j.peaks : [];
      if (waveCache.size > 48) waveCache.delete(waveCache.keys().next().value);
      waveCache.set(asset.id, peaks);
    }
    if (!peaks.length || !canvas.isConnected) return;
    let bitmap = waveBitmapCache.get(key);
    if (!bitmap) {
      bitmap = document.createElement('canvas');
      bitmap.width = W; bitmap.height = H;
      const bctx = bitmap.getContext('2d');
      bctx.fillStyle = 'rgba(255,255,255,.65)';
      const rate = 50;
      const inPoint = clip.inPoint / TICKS;
      const dur = clip.duration / TICKS;
      const count = Math.max(1, Math.ceil(dur * rate));
      for (let i = 0; i < count; i += 1) {
        const idx = Math.floor((inPoint + (i / count) * dur) * rate);
        const p = peaks[Math.min(peaks.length - 1, idx)] || 0;
        const value = Array.isArray(p) ? Math.max(...p) : Number(p) || 0;
        const x = (i / count) * W;
        const h = Math.max(1, value * H * 0.9);
        bctx.fillRect(x, H / 2 - h / 2, Math.max(1, W / count - 0.4), h);
      }
      if (waveBitmapCache.size > 64) waveBitmapCache.delete(waveBitmapCache.keys().next().value);
      waveBitmapCache.set(key, bitmap);
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bitmap, 0, 0);
    canvas.dataset.waveKey = key;
  } catch { /* waveform is optional */ }
}

function updatePlayhead() {
  if (!playheadEl) return;
  playheadEl.style.left = `${headWidth() + (engine.time / TICKS) * zoom}px`;
  const label = $('#mo-ruler-label');
  if (label) label.textContent = shortClock(engine.time);
}

function seek(ticks, { pause = false } = {}) {
  if (pause && engine.playing) engine.pause();
  engine.setTime(clamp(ticks, 0, Math.max(project.duration, timelineDuration(project))));
  updatePlayhead();
  updateTimecode();
  updateTransport();
  if (rightTab === 'color') drawColorScopes(selectedClip());
}

function timeFromClientX(clientX) {
  const rect = tracksEl.getBoundingClientRect();
  return Math.max(0, ((clientX - rect.left) / zoom) * TICKS);
}

function clipAtPoint(x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('.mo-clip');
  return el ? project.clips.find((c) => c.id === el.dataset.clipId) : null;
}

/* ------------------------------------------------------------------------- */
/* Timeline interactions                                                     */
/* ------------------------------------------------------------------------- */

let drag = null;

function beginClipDrag(e, clip, el) {
  if (e.button !== 0) return;
  e.stopPropagation();
  closeContext();
  const toolNow = tool;
  if (toolNow === 'hand') { beginTimelinePan(e); return; }
  const trimHandle = e.target.closest('[data-trim]');
  if (e.shiftKey && !trimHandle) {
    if (selection.has(clip.id)) selection.delete(clip.id); else selection.add(clip.id);
    renderAll();
    return;
  }
  if (!selection.has(clip.id)) selection = new Set([clip.id]);
  selectedTrackId = clip.trackId;
  if (toolNow === 'razor') {
    const time = snapToFrame(project, timeFromClientX(e.clientX));
    if (time > clip.start && time < clip.start + clip.duration) {
      commitOp('Split clip', { op: 'split_clip', clipId: clip.id, at: time });
      selection = new Set();
      renderAll();
    }
    return;
  }
      if (!CAN_EDIT) return toast('View-only access', true);
  const track = trackById(project, clip.trackId);
  if (clip.locked || track?.locked) return toast('This track is locked', true);
  refreshSelectionUI();
  const selected = [...selection].map((id) => project.clips.find((c) => c.id === id)).filter(Boolean);
  const mode = trimHandle ? `trim-${trimHandle.dataset.trim}` : toolNow === 'slip' ? 'slip' : 'move';
  drag = {
    mode, clipId: clip.id, el, startX: e.clientX, startY: e.clientY, before: deep(project), moved: false,
    origStart: clip.start, origDuration: clip.duration, origIn: clip.inPoint, selectedIds: selected.map((c) => c.id),
    trackId: clip.trackId, targetTrackId: clip.trackId, delta: 0, alt: e.altKey,
  };
  el.classList.add('is-dragging');
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd, { once: true });
}

function onDragMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
  const deltaTicks = (dx / zoom) * TICKS;
  const clip = project.clips.find((c) => c.id === drag.clipId);
  if (!clip) return;
  if (drag.mode === 'move') {
    let next = drag.origStart + deltaTicks;
    if (snapEnabled) {
      const snap = snapTime(drag.before, snapToFrame(project, next), { playhead: engine.time, threshold: seconds(8 / zoom), exclude: drag.selectedIds });
      if (snap !== next) { next = snap; }
    }
    next = Math.max(0, snapToFrame(project, next));
    drag.delta = next - drag.origStart;
    drag.el.style.left = `${(next / TICKS) * zoom}px`;
    $$('.mo-clip.is-selected', tracksEl).forEach((node) => {
      const c = project.clips.find((x) => x.id === node.dataset.clipId);
      if (c && c.id !== drag.clipId) node.style.left = `${((c.start + drag.delta) / TICKS) * zoom}px`;
    });
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.mo-track-lane');
    $$('.mo-track-lane.is-drop-target', tracksEl).forEach((n) => n.classList.remove('is-drop-target'));
    if (under) {
      const target = project.tracks.find((t) => t.id === under.dataset.trackId);
      const compatible = target && ((['audio'].includes(clip.type) && target.type === 'audio') || (!['audio'].includes(clip.type) && ['video', 'overlay'].includes(target.type)));
      if (compatible && !target.locked) { drag.targetTrackId = target.id; under.classList.add('is-drop-target'); }
    }
    $('#mo-status').textContent = `Move ${clip.name} → ${fmt(Math.max(0, drag.origStart + drag.delta))}`;
  } else if (drag.mode === 'slip') {
    let nextIn = Math.max(0, drag.origIn - deltaTicks);
    const asset = assetMap.get(clip.assetId);
    if (asset?.duration) nextIn = Math.min(nextIn, Math.max(0, (asset.duration * TICKS) - clip.duration * clip.speed));
    drag.el.style.opacity = '0.7';
    drag.el.style.backgroundPosition = `${-drag.delta / 100}px 0`;
    drag.delta = drag.origIn - nextIn;
    $('#mo-status').textContent = `Slip ${clip.name} · source ${fmtShort(nextIn)}`;
    engine.setTime(drag.origStart + Math.min(clip.duration - 1, Math.max(0, (drag.startX - drag.el.getBoundingClientRect().left) / zoom * TICKS)));
  } else if (drag.mode === 'trim-left') {
    let nextStart = Math.max(0, drag.origStart + deltaTicks);
    if (snapEnabled) nextStart = snapTime(drag.before, snapToFrame(project, nextStart), { playhead: engine.time, threshold: seconds(8 / zoom), exclude: drag.selectedIds });
    nextStart = Math.max(0, Math.min(drag.origStart + drag.origDuration - 1000, snapToFrame(project, nextStart)));
    drag.delta = nextStart - drag.origStart;
    drag.el.style.left = `${(nextStart / TICKS) * zoom}px`;
    drag.el.style.width = `${Math.max(2, ((drag.origDuration - drag.delta) / TICKS) * zoom)}px`;
    $('#mo-status').textContent = `Trim in · ${fmtShort(nextStart)}`;
  } else if (drag.mode === 'trim-right') {
    let nextEnd = drag.origStart + drag.origDuration + deltaTicks;
    if (snapEnabled) nextEnd = snapTime(drag.before, snapToFrame(project, nextEnd), { playhead: engine.time, threshold: seconds(8 / zoom), exclude: drag.selectedIds });
    nextEnd = Math.max(drag.origStart + 1000, snapToFrame(project, nextEnd));
    drag.delta = nextEnd - (drag.origStart + drag.origDuration);
    drag.el.style.width = `${Math.max(2, ((drag.origDuration + drag.delta) / TICKS) * zoom)}px`;
    $('#mo-status').textContent = `Trim out · ${fmtShort(drag.origStart + drag.origDuration + drag.delta)}`;
  }
}

function onDragEnd(e) {
  window.removeEventListener('pointermove', onDragMove);
  if (!drag) return;
  const d = drag;
  drag = null;
  $$('.mo-track-lane.is-drop-target', tracksEl).forEach((n) => n.classList.remove('is-drop-target'));
  if (!d.moved) {
    d.el?.classList.remove('is-dragging');
    refreshSelectionUI();
    return;
  }
  if (d.mode === 'move') {
    let next = d.before;
    for (const id of d.selectedIds) {
      const clip = next.clips.find((c) => c.id === id);
      if (!clip) continue;
      const start = Math.max(0, clip.start + d.delta);
      const targetId = id === d.clipId ? d.targetTrackId : clip.trackId;
      try { next = applyEdit(next, { op: 'move_clip', clipId: id, trackId: targetId, start }); } catch (err) { toast(err.message, true); }
    }
    commitProject('Move clip', next);
  } else if (d.mode === 'slip') {
    const next = deep(d.before);
    const clip = next.clips.find((c) => c.id === d.clipId);
    clip.inPoint = Math.max(0, d.origIn - d.delta);
    if (clip.subtitle?.words?.length) clip.subtitle.words = clip.subtitle.words.map((w) => ({ ...w, start: w.start - d.delta, end: w.end - d.delta }));
    commitProject('Slip clip', next);
  } else if (d.mode === 'trim-left') {
    const start = d.origStart + d.delta;
    commitOp('Trim clip in', { op: 'trim_clip', clipId: d.clipId, start, end: d.origStart + d.origDuration, fromStart: true });
  } else if (d.mode === 'trim-right') {
    const end = d.origStart + d.origDuration + d.delta;
    commitOp('Trim clip out', { op: 'trim_clip', clipId: d.clipId, end, fromEnd: true });
  }
  renderAll();
}

function beginTimelinePan(e) {
  const startX = e.clientX; const startY = e.clientY;
  const left = timelineScroll.scrollLeft; const top = timelineScroll.scrollTop;
  const move = (ev) => { timelineScroll.scrollLeft = left - (ev.clientX - startX); timelineScroll.scrollTop = top - (ev.clientY - startY); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
}

/* ruler scrub */
rulerEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.mo-ruler-marker')) return;
  if (engine.playing) engine.pause();
  seek(timeFromClientX(e.clientX));
  const move = (ev) => seek(timeFromClientX(ev.clientX));
  const up = () => window.removeEventListener('pointermove', move);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
});
playheadEl.addEventListener('pointerdown', (e) => {
  if (e.target.tagName === 'SPAN') {
    e.stopPropagation();
    if (engine.playing) engine.pause();
    const move = (ev) => seek(timeFromClientX(ev.clientX));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  }
});

/* One rAF-coalesced timeline repaint for scroll, resize and splitter drags. */
function scheduleTimeline() {
  if (timelineFrame) return;
  timelineFrame = requestAnimationFrame(() => {
    timelineFrame = 0;
    renderTimeline();
  });
}

timelineScroll.addEventListener('scroll', () => scheduleTimeline(), { passive: true });

/* ------------------------------------------------------------------------- */
/* Transport / monitor                                                       */
/* ------------------------------------------------------------------------- */

function updateTimecode() {
  const el = $('#mo-timecode');
  if (el) el.textContent = fmt(engine.time);
  const t = $('#mo-stat-time');
  if (t) t.textContent = `${(engine.time / TICKS).toFixed(2)}s`;
  const play = $('.mo-play');
  if (play) play.textContent = engine.playing ? '❚❚' : '▶';
  updatePlayhead();
}

function updateTransport() {
  $('#mo-loop')?.classList.toggle('is-active', engine.loop);
  $('#mo-mute')?.classList.toggle('is-active', engine.muted);
  $('#mo-mute').textContent = engine.muted ? 'Muted' : 'Audio';
  updateTimecode();
}

function renderMonitorMeta() {
  const meta = $('#mo-monitor-meta');
  if (meta) meta.textContent = `${project.width} × ${project.height} · ${project.fps} fps · ${fmtShort(timelineDuration(project) || project.duration)} · ${project.clips.length} clips`;
  const seq = $('#mo-seq-name');
  if (seq) seq.textContent = project.name || 'Sequence 01';
  const q = $('#mo-quality');
  if (q) { q.value = autoQuality ? 'auto' : String(engine.quality); q.title = `Preview quality — currently ${qualityLabel(engine.quality)}`; }
  $('#mo-export-summary').textContent = `${exportFmt.toUpperCase()} · ${exportH >= 2160 ? '4K' : `${exportH}p`}`;
}

/* ------------------------------------------------------------------------- */
/* Preview layout and quality                                                */
/* ------------------------------------------------------------------------- */

/* Fit/fill/percentage zoom is computed from the stage's real content box on
 * every resize. The canvas is absolutely positioned, so it can never add to
 * the stage's intrinsic size or push the timeline out of the viewport. */
function applyPreviewLayout() {
  const stage = $('#mo-monitor-stage');
  const canvas = $('#mo-canvas');
  if (!stage || !canvas || !project) return;
  const availW = Math.max(24, stage.clientWidth - 2);
  const availH = Math.max(24, stage.clientHeight - 2);
  const pw = project.width || 1920;
  const ph = project.height || 1080;
  let w; let h;
  if (previewZoomMode === 'fit' || previewZoomMode === 'fill') {
    const ratio = previewZoomMode === 'fit'
      ? Math.min(availW / pw, availH / ph)
      : Math.max(availW / pw, availH / ph);
    w = pw * ratio; h = ph * ratio;
  } else {
    const z = clamp(Number(previewZoomMode) || 1, 0.1, 8);
    w = pw * z; h = ph * z;
  }
  canvas.style.width = `${Math.max(1, Math.round(w))}px`;
  canvas.style.height = `${Math.max(1, Math.round(h))}px`;
  stage.classList.toggle('is-cropped', previewZoomMode !== 'fit');
}

function setPreviewZoom(mode) {
  const custom = $('#mo-preview-zoom-custom');
  if (mode === 'custom') {
    previewZoomMode = String(clamp(Number(custom?.value) || 75, 10, 800) / 100);
    if (custom) { custom.hidden = false; custom.focus(); custom.select(); }
  } else {
    previewZoomMode = mode;
    if (custom) custom.hidden = true;
  }
  applyPreviewLayout();
}

function setupPreviewLayout() {
  engine.autoQuality = autoQuality;
  $('#mo-preview-zoom')?.addEventListener('change', (e) => setPreviewZoom(e.target.value));
  const custom = $('#mo-preview-zoom-custom');
  custom?.addEventListener('input', () => {
    if (custom.hidden) return;
    previewZoomMode = String(clamp(Number(custom.value) || 10, 10, 800) / 100);
    applyPreviewLayout();
  });
  $('#mo-quality')?.addEventListener('change', (e) => setQuality(e.target.value));
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (previewFitFrame) return;
      previewFitFrame = requestAnimationFrame(() => { previewFitFrame = 0; applyPreviewLayout(); });
    });
    const stage = $('#mo-monitor-stage');
    const body = $('#mo-monitor-body');
    if (stage) observer.observe(stage);
    if (body) observer.observe(body);
  }
  applyPreviewLayout();
}

function updateStatusbar() {
  const clipCount = $('#mo-project-stat');
  if (clipCount) clipCount.textContent = `${project.clips.length} clips · ${project.tracks.length} tracks · ${assets.length} assets`;
  const rs = $('#mo-render-stat');
  if (rs) rs.textContent = '';
  const col = $('#mo-collab-status');
  if (col) col.textContent = ws?.state?.live ? `Live · ${ws.state.participants.length} editing` : 'Solo session · autosave on';
}

function qualityLabel(q) {
  if (q >= 1) return 'Full';
  if (q >= 0.5) return '1/2';
  if (q >= 0.25) return '1/4';
  return '1/8';
}

function setQuality(value) {
  if (value === 'auto') {
    autoQuality = true;
    autoQualityLast = 0;
    engine.autoQuality = true;
    engine.setQuality(1);
  } else {
    engine.autoQuality = false;
    autoQuality = false;
    engine.setQuality(clamp(Number(value) || 1, 0.125, 1));
  }
  renderMonitorMeta();
  applyPreviewLayout();
  toast(`Preview quality: ${autoQuality ? 'Auto' : qualityLabel(engine.quality)}`);
}

function cycleQuality() {
  const steps = [1, 0.5, 0.25, 0.125];
  const index = steps.findIndex((s) => Math.abs(s - engine.quality) < 0.001);
  setQuality(String(steps[(index + 1) % steps.length]));
}

/* Auto preview quality samples the measured frame rate once a second and moves
 * the backing resolution toward real time: big drops fall straight to a quarter
 * of the current scale, while sustained headroom restores it one step at a
 * time. Export always renders at full resolution from the project. */
function updateAutoQuality() {
  if (!autoQuality) return;
  const now = performance.now();
  if (now - autoQualityLast < 1000) return;
  autoQualityLast = now;
  const fps = engine.stats.fps || 0;
  if (!fps) return;
  let next = engine.quality;
  if (fps < 30) next = engine.quality / (fps < 15 ? 4 : 2);
  else if (fps > 56) next = engine.quality * 2;
  next = clamp(next, 0.125, 1);
  if (Math.abs(next - engine.quality) < 0.001) return;
  engine.setQuality(next);
  applyPreviewLayout();
  renderMonitorMeta();
}

/* ------------------------------------------------------------------------- */
/* Menus and commands                                                        */
/* ------------------------------------------------------------------------- */

function closeMenus() {
  $$('.mo-menu.open').forEach((m) => m.classList.remove('open'));
}

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.mo-menu')) closeMenus();
  if (!e.target.closest('.mo-context')) closeContext();
});

function runCommand(cmd) {
  closeMenus();
  switch (cmd) {
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'cut': copySelection(); deleteSelection(); break;
    case 'copy': copySelection(); break;
    case 'paste': pasteClipboard(); break;
    case 'duplicate': duplicateSelection(); break;
    case 'delete': deleteSelection(); break;
    case 'select-all': selectAll(); break;
    case 'add-marker': addMarker(); break;
    case 'split': splitSelection(); break;
    case 'ripple-delete': rippleDeleteSelection(); break;
    case 'group': groupSelection(); break;
    case 'ungroup': ungroupSelection(); break;
    case 'link': linkSelectedClips(); break;
    case 'nest': nestSelection(); break;
    case 'reverse': reverseSelection(); break;
    case 'freeze': freezeSelection(); break;
    case 'detach-audio': { const clip = selectedClip(); if (clip) detachAudio(clip.id); break; }
    case 'replace': replaceMedia(); break;
    case 'relink': { const clip = selectedClip(); if (clip?.assetId) { pendingRelink = clip.assetId; $('#mo-file-input').click(); } break; }
    case 'speed': openSpeed(); break;
    case 'save': ws?.saveNow?.(true); toast('Saved'); break;
    case 'import': $('#mo-import-dlg').showModal(); break;
    case 'import-url': toggleUrlRow(); break;
    case 'import-cloud': openCloudPicker(); break;
    case 'duplicate-project': duplicateProject(); break;
    case 'export-project': exportProjectFile(); break;
    case 'export': openExport(); break;
    case 'export-audio': openExport({ audioOnly: true }); break;
    case 'add-track-video': addTrack('video'); break;
    case 'add-track-audio': addTrack('audio'); break;
    case 'add-track-text': addTrack('text'); break;
    case 'add-track-subtitle': addTrack('subtitle'); break;
    case 'sequence-settings': openSequenceSettings(); break;
    case 'transcribe': openTranscribe(); break;
    case 'detect-beats': detectBeatsFromSelection(); break;
    case 'toggle-left': togglePanel('left'); break;
    case 'toggle-right': togglePanel('right'); break;
    case 'toggle-timeline': app.classList.toggle('mo-timeline-hidden'); break;
    case 'fullscreen': engine.toggleFullscreen(); break;
    case 'quality': cycleQuality(); break;
    case 'quality-auto': setQuality('auto'); break;
    case 'quality-1': setQuality(1); break;
    case 'quality-half': setQuality(0.5); break;
    case 'quality-quarter': setQuality(0.25); break;
    case 'quality-eighth': setQuality(0.125); break;
    case 'guides': toggleGuides(); break;
    case 'before-after':
    case 'compare': toggleCompare(); break;
    case 'capture': saveStill(); break;
    case 'theme': toggleTheme(); break;
    case 'shortcuts': $('#mo-shortcuts-dlg').showModal(); break;
    case 'new-project': newProjectDialog(); break;
    case 'play': engine.toggle(); updateTransport(); break;
    case 'step-back': engine.pause(); seek(engine.time - 1e6 / project.fps); break;
    case 'step-fwd': engine.pause(); seek(engine.time + 1e6 / project.fps); break;
    case 'go-start': engine.pause(); seek(0); break;
    case 'go-end': engine.pause(); seek(Math.max(0, timelineDuration(project) - 1e6 / project.fps)); break;
    case 'loop': engine.loop = !engine.loop; updateTransport(); break;
    case 'mute': engine.setMuted(!engine.muted); updateTransport(); break;
    case 'fit': fitTimeline(); break;
    case 'zoom-in': setZoom(zoom * 1.35); break;
    case 'zoom-out': setZoom(zoom / 1.35); break;
    case 'snap': snapEnabled = !snapEnabled; $('#mo-snap')?.classList.toggle('is-active', snapEnabled); break;
    case 'linked': linkSelection = !linkSelection; $('#mo-linked')?.classList.toggle('is-active', linkSelection); break;
    case 'mixer': $('#mo-mixer').hidden = !$('#mo-mixer').hidden; renderMixer(); break;
    case 'timeline-settings': openSequenceSettings(); break;
    case 'multicam': toast('Multicam is not part of this build'); break;
    default: break;
  }
}

document.addEventListener('click', (e) => {
  const menuBtn = e.target.closest('[data-menu]');
  if (menuBtn) {
    e.stopPropagation();
    const parent = menuBtn.closest('.mo-menu');
    const wasOpen = parent.classList.contains('open');
    closeMenus();
    if (!wasOpen) parent.classList.add('open');
    return;
  }
  const cmd = e.target.closest('[data-cmd]');
  if (cmd) { e.preventDefault(); runCommand(cmd.dataset.cmd); return; }
  const assetAdd = e.target.closest('[data-asset-add]');
  if (assetAdd) { addAssetToTimeline(assetAdd.dataset.assetAdd); return; }
});

function togglePanel(side) {
  const el = side === 'left' ? $('#mo-left') : $('#mo-right');
  if (!el) return;
  if (window.innerWidth <= 720) {
    const other = side === 'left' ? $('#mo-right') : $('#mo-left');
    other?.classList.remove('is-mobile-open');
    el.classList.toggle('is-mobile-open');
  } else el.classList.toggle('is-hidden');
  setTimeout(renderTimeline, 30);
}

function toggleGuides() {
  engine.setGuides(!engine.guides);
  const g = $('#mo-guides');
  if (g) g.hidden = !engine.guides;
  toast(engine.guides ? 'Safe guides on' : 'Safe guides off');
}

function toggleTheme() {
  const light = document.documentElement.dataset.theme === 'light';
  if (light) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = 'light';
  try { localStorage.setItem('cascade-theme', light ? 'dark' : 'light'); } catch { /* storage disabled */ }
  setTimeout(renderTimeline, 40);
}

function addMarker() {
  const label = prompt('Marker label', `Marker ${project.markers.length + 1}`);
  if (!label) return;
  commitOp('Add marker', { op: 'add_marker', t: engine.time, label });
}

function setZoom(value) {
  zoom = clamp(value, 8, 320);
  const input = $('#mo-timeline-zoom');
  if (input) input.value = zoom;
  renderTimeline();
}
function fitTimeline() {
  const viewport = timelineScroll.clientWidth - headWidth() - 24;
  const total = Math.max(5, timelineSeconds());
  setZoom(clamp(viewport / total, 8, 320));
  timelineScroll.scrollLeft = 0;
}

function addTrack(type) {
  const labels = { video: 'Video', audio: 'Audio', text: 'Titles', subtitle: 'Subtitles', overlay: 'Overlay' };
  const track = defaultTrack(type, { name: `${labels[type] || type} ${project.tracks.filter((t) => t.type === type).length + 1}` });
  const next = deep(project);
  if (type === 'audio') next.tracks.push(track);
  else next.tracks.unshift(track);
  commitProject(`Add ${labels[type] || type} track`, next);
  selectedTrackId = track.id;
  renderAll();
}

function reverseSelection() {
  const next = deep(project);
  next.clips.forEach((c) => { if (selection.has(c.id)) c.reverse = !c.reverse; });
  commitProject('Reverse playback', next);
}
function freezeSelection() {
  const clip = selectedClip();
  if (!clip) return toast('Select a clip', true);
  const local = clamp(engine.time - clip.start, 0, Math.max(0, clip.duration - 1000));
  const next = deep(project);
  const c = next.clips.find((x) => x.id === clip.id);
  c.freeze = true; c.inPoint = c.inPoint + local * c.speed;
  commitProject('Freeze frame', next);
}

function openSpeed() {
  const clip = selectedClip();
  if (!clip) return toast('Select a clip', true);
  const dlg = $('#mo-speed-dlg');
  const asset = assetMap.get(clip.assetId);
  const sourceDuration = asset?.duration ? seconds(asset.duration) : clip.duration;
  $('#mo-speed-value').value = clip.speed || 1;
  $('#mo-speed-duration').value = (clip.duration / TICKS).toFixed(2);
  $('#mo-speed-reverse').checked = !!clip.reverse;
  dlg.showModal();
  const sync = () => {
    const v = clamp(Number($('#mo-speed-value').value) || 1, 0.1, 10);
    $('#mo-speed-duration').value = (((sourceDuration - clip.inPoint) / v) / TICKS).toFixed(2);
  };
  $('#mo-speed-value').oninput = sync;
  $('#mo-speed-apply').onclick = () => {
    const speed = clamp(Number($('#mo-speed-value').value) || 1, 0.1, 10);
    const duration = Math.max(1000, Math.round((Number($('#mo-speed-duration').value) || (clip.duration / TICKS)) * TICKS));
    const next = deep(project);
    const c = next.clips.find((x) => x.id === clip.id);
    c.speed = speed; c.duration = duration; c.reverse = $('#mo-speed-reverse').checked;
    commitProject('Speed and duration', next);
    dlg.close();
  };
}

function openSequenceSettings() {
  const dlg = $('#mo-sequence-dlg');
  $('#mo-seq-title').value = project.name || '';
  $('#mo-seq-width').value = project.width;
  $('#mo-seq-height').value = project.height;
  $('#mo-seq-fps').value = String(project.fps);
  $('#mo-seq-bg').value = project.background || '#000000';
  $('#mo-seq-space').value = project.colorSpace || 'bt709';
  $('#mo-seq-vfr').checked = !!project.vfr;
  dlg.showModal();
  $('#mo-seq-apply').onclick = () => {
    const next = deep(project);
    next.name = $('#mo-seq-title').value.trim() || 'Sequence 01';
    next.width = clamp(Number($('#mo-seq-width').value) || 1920, 16, config.limits?.maxResolution || 7680);
    next.height = clamp(Number($('#mo-seq-height').value) || 1080, 16, 4320);
    next.fps = clamp(Number($('#mo-seq-fps').value) || 30, 1, 120);
    next.background = $('#mo-seq-bg').value;
    next.colorSpace = $('#mo-seq-space').value;
    next.vfr = $('#mo-seq-vfr').checked;
    commitProject('Sequence settings', next);
    engine.setProject(project);
    engine.setQuality(engine.quality);
    dlg.close();
    renderAll();
  };
}

function toggleUrlRow() {
  const dlg = $('#mo-import-dlg');
  if (!dlg.open) dlg.showModal();
  const row = $('#mo-url-row');
  row.hidden = false;
  $('#mo-url-input').focus();
}

function newProjectDialog() {
  if (confirm('Start a new empty scene in this project? Existing clips can be restored with Undo.')) {
    const next = newProject({ name: project.name });
    commitProject('New project', next);
    engine.setTime(0);
    renderAll();
  }
}

function exportProjectFile() {
  const payload = { format: 'cascade-motion', version: 1, exportedAt: new Date().toISOString(), project };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${(project.name || 'motion-project').replace(/[^\w-]+/g, '-')}.cascade-motion`);
}

async function duplicateProject() {
  try {
    await ws?.saveNow?.(true);
    const j = await request(`/api/motion/projects/${DOC.id}/duplicate`, { method: 'POST', body: JSON.stringify({ project }) });
    const id = j.file?.id || j.id;
    toast('Project duplicated — opening the copy');
    setTimeout(() => { window.location.href = `/edit/${id}`; }, 500);
  } catch (err) {
    // Fall back to the generic file copy when the motion endpoint is absent.
    try {
      const j = await request(`/api/files/${DOC.id}/copy`, { method: 'POST', body: '{}' });
      window.location.href = `/edit/${j.id}`;
    } catch (err2) { toast(err2.message || err.message, true); }
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* keyboard shortcuts */
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t.closest?.('input, textarea, select, [contenteditable="true"]');
  if (typing) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); ws?.saveNow?.(true); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
  if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); return; }
  if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); copySelection(); deleteSelection(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
  if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); openExport(); return; }
  if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); $('#mo-import-dlg').showModal(); return; }
  if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return; }
  if (mod) return;
  switch (e.key) {
    case ' ': e.preventDefault(); engine.toggle(); updateTransport(); break;
    case 'ArrowLeft': e.preventDefault(); engine.pause(); seek(engine.time - (e.shiftKey ? TICKS : TICKS / project.fps)); break;
    case 'ArrowRight': e.preventDefault(); engine.pause(); seek(engine.time + (e.shiftKey ? TICKS : TICKS / project.fps)); break;
    case 'ArrowUp': e.preventDefault(); if (selection.size) { const next = deep(project); next.clips.forEach((c) => { if (selection.has(c.id)) c.trackId = project.tracks[Math.max(0, project.tracks.findIndex((t) => t.id === c.trackId) - 1)]?.id || c.trackId; }); commitProject('Move clip to track above', next); } break;
    case 'ArrowDown': e.preventDefault(); if (selection.size) { const next = deep(project); next.clips.forEach((c) => { if (selection.has(c.id)) c.trackId = project.tracks[Math.min(project.tracks.length - 1, project.tracks.findIndex((t) => t.id === c.trackId) + 1)]?.id || c.trackId; }); commitProject('Move clip to track below', next); } break;
    case 'Home': e.preventDefault(); engine.pause(); seek(0); break;
    case 'End': e.preventDefault(); engine.pause(); seek(timelineDuration(project)); break;
    case 'Delete': e.preventDefault(); if (e.shiftKey) rippleDeleteSelection(); else deleteSelection(); break;
    case 'Backspace': e.preventDefault(); deleteSelection(); break;
    case 's': case 'S': splitSelection(); break;
    case 'm': case 'M': addMarker(); break;
    case 'n': case 'N': snapEnabled = !snapEnabled; $('#mo-snap')?.classList.toggle('is-active', snapEnabled); break;
    case 'f': case 'F': if (e.shiftKey) engine.toggleFullscreen(); else freezeSelection(); break;
    case 'v': case 'V': setTool('select'); break;
    case 'c': case 'C': setTool('razor'); break;
    case 'y': case 'Y': setTool('slip'); break;
    case 'h': case 'H': setTool('hand'); break;
    case 'k': case 'K': engine.pause(); updateTransport(); break;
    case 'l': case 'L': if (!engine.playing) engine.play(); else engine.setRate(Math.min(4, engine.rate * 2)); updateTransport(); break;
    case 'j': case 'J': engine.pause(); seek(engine.time - TICKS); break;
    case 'i': case 'I': addMarkerAt('In'); break;
    case 'o': case 'O': addMarkerAt('Out'); break;
    case '?': $('#mo-shortcuts-dlg').showModal(); break;
    case '+': case '=': setZoom(zoom * 1.25); break;
    case '-': setZoom(zoom / 1.25); break;
    case 'Escape': closeMenus(); closeContext(); engine.pause(); engine.setCompare(null); compareImage = null; break;
    default: break;
  }
});

function addMarkerAt(label) {
  commitOp('Add marker', { op: 'add_marker', t: engine.time, label });
}

document.addEventListener('mouseenter', () => {}, true);

function setTool(next) {
  tool = next;
  $$('.mo-tool').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === next));
  app.classList.toggle('mo-tool-razor', next === 'razor');
}

$$('.mo-tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

const zoomInput = $('#mo-timeline-zoom');
zoomInput?.addEventListener('input', () => setZoom(Number(zoomInput.value)));
$('#mo-rate')?.addEventListener('change', (e) => { engine.setRate(Number(e.target.value)); });
$('#mo-left-tabs')?.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setLeftTab(b.dataset.tab); });
$('#mo-right-tabs')?.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setRightTab(b.dataset.tab); });

/* splitters */
function bindSplitter(el, side) {
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const left = parseInt(getComputedStyle(app).getPropertyValue(side === 'left' ? '--mo-left-w' : '--mo-right-w')) || (side === 'left' ? 318 : 326);
    const move = (ev) => {
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
      const width = clamp(left + delta, 220, Math.min(560, window.innerWidth * 0.5));
      app.style.setProperty(side === 'left' ? '--mo-left-w' : '--mo-right-w', `${width}px`);
      scheduleTimeline();
    };
    el.classList.add('is-dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => { el.classList.remove('is-dragging'); window.removeEventListener('pointermove', move); }, { once: true });
  });
}
bindSplitter($('#mo-split-left'), 'left');
bindSplitter($('#mo-split-right'), 'right');

$('#mo-split-bottom')?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const el = $('#mo-split-bottom');
  const startY = e.clientY;
  const startH = parseInt(getComputedStyle(app).getPropertyValue('--mo-timeline-height')) || 336;
  const maxH = Math.max(180, ($('#mo-workspace')?.clientHeight || window.innerHeight) - 140);
  el?.classList.add('is-dragging');
  const move = (ev) => {
    const h = clamp(startH + (startY - ev.clientY), 120, maxH);
    app.style.setProperty('--mo-timeline-height', `${h}px`);
    scheduleTimeline();
  };
  const up = () => {
    el?.classList.remove('is-dragging');
    window.removeEventListener('pointermove', move);
    try { localStorage.setItem('cascade:motion-timeline-height', getComputedStyle(app).getPropertyValue('--mo-timeline-height').trim()); } catch { /* storage disabled */ }
    applyPreviewLayout();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
});
$('#mo-split-bottom')?.addEventListener('dblclick', () => {
  app.style.setProperty('--mo-timeline-height', '336px');
  try { localStorage.removeItem('cascade:motion-timeline-height'); } catch { /* storage disabled */ }
  scheduleTimeline();
  applyPreviewLayout();
});

window.addEventListener('resize', () => { scheduleTimeline(); applyPreviewLayout(); });
/* ------------------------------------------------------------------------- */
/* Import, uploads and recordings                                            */
/* ------------------------------------------------------------------------- */

async function uploadFiles(files, opts = {}) {
  const dlg = $('#mo-import-dlg');
  const progress = $('#mo-upload-progress');
  const bar = progress?.querySelector('span');
  const label = progress?.querySelector('p');
  if (progress) progress.hidden = false;
  const mediaFiles = [];
  for (const file of files) {
    if (/\.(srt|vtt|ass)$/i.test(file.name)) {
      const text = await file.text();
      const cues = /^\[Script Info\]/i.test(text) ? parseAss(text) : parseSrt(text.replace(/^WEBVTT[^\n]*\n/i, ''));
      importCues(cues);
      continue;
    }
    mediaFiles.push(file);
  }
  for (let index = 0; index < mediaFiles.length; index += 1) {
    const file = mediaFiles[index];
    try {
      if (file.size > (config.limits?.maxUploadBytes || 2 * 1024 ** 3)) throw new Error(`${file.name} exceeds the upload limit`);
      if (label) label.textContent = `Uploading ${file.name} (${index + 1}/${mediaFiles.length})`;
      const session = await request('/api/motion/uploads', {
        method: 'POST', body: JSON.stringify({ projectId: DOC.id, name: file.name, size: file.size }),
      });
      const chunkSize = session.chunkSize || 8 * 1024 * 1024;
      let offset = 0;
      while (offset < file.size) {
        const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
        const res = await fetch(`/api/motion/uploads/${session.uploadId}`, {
          method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-offset': String(offset) }, body: chunk,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Upload failed (${res.status})`);
        }
        offset += chunk.size;
        if (bar) bar.style.width = `${Math.round((offset / Math.max(1, file.size)) * 100)}%`;
      }
      const done = await request(`/api/motion/uploads/${session.uploadId}/complete`, { method: 'POST', body: '{}' });
      if (bar) bar.style.width = '100%';
      if (done.duplicate) toast(`${file.name} was already in this project (duplicate detected)`);
      await loadAssets();
      if (pendingReplaceClip && done.asset) {
        const next = deep(project);
        const clip = next.clips.find((c) => c.id === pendingReplaceClip);
        if (clip) {
          clip.assetId = done.asset.id;
          const duration = Math.max(1000, Math.round((done.asset.duration || 5) * TICKS));
          clip.duration = Math.min(clip.duration, duration);
          clip.name = done.asset.name;
          commitProject('Replace media', next);
        }
        pendingReplaceClip = null;
      }
      if (pendingRelink && done.asset) {
        const next = deep(project);
        next.clips.forEach((c) => { if (c.assetId === pendingRelink) c.assetId = done.asset.id; });
        commitProject('Relink media', next);
        pendingRelink = null;
      }
      toast(`Imported ${file.name}`);
      if (opts.addToTimeline !== false && done.asset) addAssetToTimeline(done.asset.id);
    } catch (err) {
      toast(`${file.name}: ${err.message}`, true);
    }
  }
  if (progress) setTimeout(() => { progress.hidden = true; if (bar) bar.style.width = '0'; }, 1200);
  if (dlg?.open) dlg.close();
}

async function importRemoteUrl(url) {
  try {
    status('Downloading remote media…');
    const j = await request(`${API}/assets/remote`, { method: 'POST', body: JSON.stringify({ url }) });
    await loadAssets();
    toast(`Imported ${j.asset.name}`);
    addAssetToTimeline(j.asset.id);
    $('#mo-url-row').hidden = true;
    $('#mo-url-input').value = '';
  } catch (err) { toast(err.message, true); }
  status('Ready');
}

async function openCloudPicker() {
  const dlg = $('#mo-cloud-dlg');
  if (!dlg.open) dlg.showModal();
  const list = $('#mo-cloud-list');
  list.innerHTML = '<p class="mo-fine">Loading…</p>';
  try {
    const j = await request('/api/files?limit=200');
    const media = (j.files || []).filter((f) => /^(video|audio|image)\//.test(f.mime || ''));
    const render = () => {
      const q = ($('#mo-cloud-search').value || '').toLowerCase();
      const kind = $('#mo-cloud-kind').value;
      const filtered = media.filter((f) => `${f.filename} ${f.mime}`.toLowerCase().includes(q) && (kind === 'media' || (f.mime || '').startsWith(kind + '/')));
      list.innerHTML = '';
      if (!filtered.length) list.innerHTML = '<p class="mo-empty">No matching media in Cascade Files.</p>';
      filtered.forEach((f) => {
        const row = document.createElement('div');
        row.className = 'mo-cloud-item';
        row.innerHTML = `<b>${esc(f.filename)}</b><span>${Math.round((f.size || 0) / 1024 / 1024)} MB · ${esc(f.mime || '')}</span><button class="mo-btn">Import</button>`;
        row.addEventListener('click', async () => {
          try {
            const result = await request(`${API}/assets/attach`, { method: 'POST', body: JSON.stringify({ fileId: f.id }) });
            await loadAssets(); dlg.close();
            toast(result.duplicate ? 'Already in this project' : `Imported ${f.filename}`);
            if (result.asset) addAssetToTimeline(result.asset.id);
          } catch (err) { toast(err.message, true); }
        });
        list.append(row);
      });
    };
    $('#mo-cloud-search').oninput = render;
    $('#mo-cloud-kind').onchange = render;
    render();
  } catch (err) { list.innerHTML = `<p class="mo-empty">${esc(err.message)}</p>`; }
}

function toggleUrlRowOpen() { toggleUrlRow(); }

let recordingStop = null;
async function startRecording(kind) {
  try {
    let stream;
    if (kind === 'screen') stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60 } }, audio: true });
    else if (kind === 'camera') stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
    else stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const dlg = $('#mo-record-dlg');
    const preview = $('#mo-record-preview');
    preview.srcObject = stream;
    $('#mo-record-title').textContent = kind === 'screen' ? 'Screen recording' : kind === 'camera' ? 'Webcam recording' : 'Microphone recording';
    $('#mo-record-device').textContent = stream.getVideoTracks()[0]?.label || stream.getAudioTracks()[0]?.label || 'Default';
    $('#mo-record-note').textContent = kind === 'screen' ? 'Recording stops when sharing ends. The file is imported as WebM and can be transcoded on export.' : 'Recording is imported as WebM and can be trimmed on the timeline.';
    if (!dlg.open) dlg.showModal();
    const chunks = [];
    const mime = kind === 'mic' ? (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm') : (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm');
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: kind === 'screen' ? 8_000_000 : 4_000_000 });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const started = Date.now();
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      $('#mo-record-time').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
    const finish = async () => {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      preview.srcObject = null;
      if (dlg.open) dlg.close();
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const ext = kind === 'mic' ? 'webm' : 'webm';
      const filename = `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
      if (blob.size) await uploadFiles([new File([blob], filename, { type: blob.type })]);
    };
    recordingStop = finish;
    recorder.start(1000);
    $('#mo-record-stop').onclick = () => { if (recorder.state !== 'inactive') recorder.stop(); finish(); };
    recorder.onstop = () => { /* finish is driven by the stop button or track end */ };
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (recorder.state !== 'inactive') recorder.stop(); finish(); });
  } catch (err) {
    toast(`Recording failed: ${err.message}`, true);
  }
}

/* ------------------------------------------------------------------------- */
/* Transcription                                                             */
/* ------------------------------------------------------------------------- */

let whisperWorker = null;
let whisperRequest = null;
let whisperRun = 0;

function setTranscribeStatus(message, percent = null) {
  const box = $('#mo-transcribe-progress');
  const label = $('#mo-transcribe-status');
  if (!box) return;
  box.hidden = false;
  if (label) label.textContent = message;
  const bar = box.querySelector('span');
  if (bar) bar.style.width = percent == null ? '15%' : `${Math.max(2, Math.min(100, percent))}%`;
}

function getWhisperWorker() {
  if (whisperWorker) return whisperWorker;
  whisperWorker = new Worker('/public/motion/whisper-worker.mjs', { type: 'module' });
  whisperWorker.addEventListener('message', (event) => {
    const message = event.data || {};
    const request = whisperRequest;
    if (!request) return;
    if (message.id && message.id !== request.id) return;
    if (message.type === 'progress') {
      const name = String(message.file || 'model').split('/').pop();
      setTranscribeStatus(`Downloading ${name} · ${Math.round(message.percent || 0)}%`, message.percent);
    } else if (message.type === 'status') {
      setTranscribeStatus(message.message || 'Preparing…');
    } else if (message.type === 'ready') {
      setTranscribeStatus('Model ready');
    } else if (message.type === 'done') {
      whisperRequest = null;
      request.resolve(message.result);
    } else if (message.type === 'error') {
      whisperRequest = null;
      request.reject(new Error(message.error || 'Local transcription failed'));
    }
  });
  whisperWorker.addEventListener('error', (event) => {
    const request = whisperRequest;
    whisperRequest = null;
    request?.reject(new Error(event.message || 'The local Whisper worker could not start.'));
  });
  return whisperWorker;
}

function transcribeOnDevice(audio, options) {
  const worker = getWhisperWorker();
  return new Promise((resolve, reject) => {
    whisperRun += 1;
    whisperRequest = { id: `whisper-${whisperRun}`, resolve, reject };
    worker.postMessage({
      type: 'transcribe',
      id: whisperRequest.id,
      audio,
      model: options.model,
      language: options.language,
      translate: options.translate,
    });
  });
}

async function decodeClipAudio(asset, clip) {
  const response = await fetch(asset.url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not read that media file.');
  const buffer = await response.arrayBuffer();
  let decoded;
  try {
    const ctx = new OfflineAudioContext(1, 1, 16000);
    decoded = await ctx.decodeAudioData(buffer.slice(0));
  } catch {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('This browser cannot decode audio for local transcription.');
    const ctx = new Ctx();
    try {
      decoded = await ctx.decodeAudioData(buffer.slice(0));
    } finally {
      ctx.close?.();
    }
  }
  const speed = Math.max(0.1, Number(clip.speed) || 1);
  const sourceStart = Math.max(0, toSeconds(clip.inPoint || 0));
  const requested = clip.duration ? toSeconds(clip.duration) * speed : decoded.duration;
  const sourceDuration = Math.min(decoded.duration - sourceStart, requested);
  if (!(sourceDuration > 0.05)) throw new Error('That clip has no audible section to transcribe.');
  const rate = decoded.sampleRate;
  const first = Math.floor(sourceStart * rate);
  const frames = Math.min(decoded.length - first, Math.ceil(sourceDuration * rate));
  const length = Math.max(1, Math.round((frames * 16000) / rate));
  const out = new Float32Array(length);
  const channels = [];
  for (let c = 0; c < decoded.numberOfChannels; c += 1) channels.push(decoded.getChannelData(c));
  for (let i = 0; i < length; i += 1) {
    const position = (i * rate) / 16000;
    const index = Math.min(frames - 1, Math.floor(position));
    const fraction = position - index;
    let sample = 0;
    for (const data of channels) {
      const a = data[first + index] || 0;
      const b = data[first + index + 1] || a;
      sample += a + (b - a) * fraction;
    }
    out[i] = sample / Math.max(1, channels.length);
  }
  return out;
}

function openTranscribe(cue = null) {
  const dlg = $('#mo-transcribe-dlg');
  const clip = cue || selectedClip();
  const hasAudio = assets.some((a) => a.kind === 'audio' || a.hasAudio);
  if (!hasAudio) return toast('Import or record an audio-bearing clip first', true);
  $('#mo-tr-source').value = clip ? 'clip' : 'sequence';
  if (!dlg.open) dlg.showModal();
  const note = $('#mo-provider-note');
  const supported = typeof Worker !== 'undefined' && typeof WebAssembly === 'object';
  if (note) {
    note.innerHTML = supported
      ? '<b>On-device Whisper.</b> The model downloads once and is cached by this browser. Audio is decoded and transcribed on this device; it is never uploaded or sent to a provider. Inference uses the bundled WebAssembly runtime.'
      : 'This browser cannot run the local Whisper model (WebAssembly or Web Workers are unavailable). You can still import SRT/VTT/ASS caption files.';
  }
  try {
    const saved = localStorage.getItem('cascade:motion-whisper-model');
    if (saved && $(`#mo-tr-model option[value="${saved}"]`)) $('#mo-tr-model').value = saved;
  } catch { /* ignore */ }
  const language = $('#mo-tr-language');
  if (language && !language.value) language.value = 'en';
  const progress = $('#mo-transcribe-progress');
  if (progress) progress.hidden = true;
  const run = $('#mo-transcribe-run');
  run.disabled = !supported;
  run.textContent = 'Start transcription';
}

async function runTranscription() {
  const dlg = $('#mo-transcribe-dlg');
  const source = $('#mo-tr-source').value;
  let clip = null;
  if (source === 'clip') clip = selectedClip();
  if (source === 'track') {
    const track = project.tracks.find((t) => t.id === selectedTrackId && t.type === 'audio') || project.tracks.find((t) => t.type === 'audio');
    clip = project.clips.filter((c) => c.trackId === track?.id && c.assetId).sort((a, b) => a.duration - b.duration)[0] || null;
  }
  if (source === 'sequence') {
    const candidates = project.clips.filter((c) => c.assetId && (assetMap.get(c.assetId)?.hasAudio || assetMap.get(c.assetId)?.kind === 'audio'));
    clip = candidates.sort((a, b) => b.duration - a.duration)[0] || null;
  }
  if (!clip?.assetId) return toast('No audio-bearing clip found for that source', true);
  const asset = assetMap.get(clip.assetId);
  if (!asset) return toast('Missing media for that clip', true);
  const model = $('#mo-tr-model').value;
  const run = $('#mo-transcribe-run');
  try {
    run.disabled = true;
    run.textContent = 'Preparing audio…';
    setTranscribeStatus('Decoding audio on this device…');
    try { localStorage.setItem('cascade:motion-whisper-model', model); } catch { /* ignore */ }
    const audio = await decodeClipAudio(asset, clip);
    run.textContent = 'Transcribing…';
    setTranscribeStatus('Loading the local model…');
    const result = await transcribeOnDevice(audio, {
      model,
      language: $('#mo-tr-language').value,
      translate: $('#mo-tr-translate').checked,
    });
    if (!result.words?.length) throw new Error('No speech was detected in that clip.');
    const speed = Math.max(0.1, Number(clip.speed) || 1);
    const words = result.words.map((word) => {
      const sourceStart = Math.round((clip.inPoint || 0) + word.start * TICKS);
      const start = Math.max(0, Math.round(clip.start + (sourceStart - (clip.inPoint || 0)) / speed));
      const end = Math.max(start + 80, Math.round(clip.start + ((clip.inPoint || 0) + word.end * TICKS - (clip.inPoint || 0)) / speed));
      return { text: word.text, start, end };
    });
    const cues = wordsToCues(words);
    dlg.close();
    applyTranscript({ ...result, words, cues, mapped: true });
  } catch (err) {
    setTranscribeStatus(err.message, null);
    toast(err.message, true);
    run.disabled = false;
    run.textContent = 'Start transcription';
  }
}

async function applyTranscript(result) {
  const styleId = selectedClip()?.subtitle?.styleId || project.clips.find((c) => c.type === 'subtitle')?.subtitle?.styleId || 'classic-white';
  const replace = $('#mo-tr-replace').checked;
  let next = deep(project);
  let track = next.tracks.find((t) => t.type === 'subtitle');
  if (!track) { track = defaultTrack('subtitle', { name: 'Subtitles' }); next.tracks.push(track); }
  if (replace) next.clips = next.clips.filter((c) => c.trackId !== track.id);
  const cues = result.cues || wordsToCues(result.words || []);
  for (const cue of cues) {
    const start = cue.start;
    const words = cue.words || [];
    next.clips.push({
      id: uid('clip'), trackId: track.id, type: 'subtitle', name: cue.text.slice(0, 40), start, duration: Math.max(1000, cue.end - cue.start),
      subtitle: { text: cue.text, words, styleId, speaker: null },
      transform: {}, color: {}, audio: {}, effects: [], keyframes: {},
    });
  }
  transcriptCache = result.words || [];
  commitProject(`Whisper: ${cues.length} captions`, next);
  toast(`Added ${cues.length} captions (${result.language || 'auto'})`);
  setLeftTab('subtitles');
}

/* ------------------------------------------------------------------------- */
/* Export                                                                    */
/* ------------------------------------------------------------------------- */

let exportSettingsState = null;
function openExport(opts = {}) {
  const dlg = $('#mo-export-dlg');
  if (!exportSettingsState) {
    exportSettingsState = {
      preset: 'youtube-1080p', container: 'mp4', videoCodec: 'libx264', audioCodec: 'aac',
      width: project.width, height: project.height, fps: project.fps, crf: 18, videoBitrate: '', audioBitrate: '192k',
      channels: project.channels || 2, presetName: 'medium', colorSpace: 'bt709', faststart: true,
    };
  }
  populateExportForm();
  if (opts.audioOnly) {
    exportSettingsState.container = 'mp3'; exportSettingsState.videoCodec = null; exportSettingsState.audioCodec = 'libmp3lame';
    populateExportForm();
  }
  if (!dlg.open) dlg.showModal();
  loadJobs();
  if (config.ffmpeg && !config.ffmpeg.available) {
    $('#mo-export-warning').hidden = false;
    $('#mo-export-warning').textContent = 'FFmpeg is not installed on this server, so renders cannot start. Install FFmpeg or set FFMPEG_PATH in Admin → Motion.';
  }
}

function populateExportForm() {
  const st = exportSettingsState;
  const containerSel = $('#mo-export-container');
  containerSel.innerHTML = CONTAINERS.map((c) => `<option value="${c.id}" ${c.id === st.container ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
  const container = CONTAINERS.find((c) => c.id === st.container) || CONTAINERS[0];
  const videoSel = $('#mo-export-vcodec');
  videoSel.innerHTML = container.video.length
    ? container.video.map((id) => `<option value="${id}" ${id === st.videoCodec ? 'selected' : ''}>${esc(VIDEO_CODECS.find((v) => v.id === id)?.label || id)}</option>`).join('')
    : '<option value="">No video</option>';
  const audioSel = $('#mo-export-acodec');
  audioSel.innerHTML = container.audio.map((id) => `<option value="${id}" ${id === st.audioCodec ? 'selected' : ''}>${esc(AUDIO_CODECS.find((a) => a.id === id)?.label || id)}</option>`).join('');
  if (!container.video.length) st.videoCodec = null;
  else if (!container.video.includes(st.videoCodec)) st.videoCodec = container.video[0];
  if (!container.audio.includes(st.audioCodec)) st.audioCodec = container.audio[0];
  videoSel.value = st.videoCodec || '';
  audioSel.value = st.audioCodec || '';
  const resolutions = [
    ['match', `Match sequence (${project.width} × ${project.height})`, project.width, project.height],
    ['1920x1080', '1080p · 1920×1080', 1920, 1080], ['1280x720', '720p · 1280×720', 1280, 720],
    ['854x480', '480p · 854×480', 854, 480], ['2560x1440', '1440p · 2560×1440', 2560, 1440],
    ['3840x2160', '4K UHD · 3840×2160', 3840, 2160], ['1080x1920', 'Vertical · 1080×1920', 1080, 1920],
    ['1080x1080', 'Square · 1080×1080', 1080, 1080], ['custom', 'Custom…', st.width, st.height],
  ];
  const resSel = $('#mo-export-resolution');
  const currentKey = `${st.width}x${st.height}`;
  resSel.innerHTML = resolutions.map(([id, label, w, h]) => `<option value="${id}" data-w="${w}" data-h="${h}" ${id === currentKey || (id === 'match' && st.width === project.width && st.height === project.height) ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const fpsSel = $('#mo-export-fps');
  fpsSel.innerHTML = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => `<option value="${f}" ${Number(f) === Number(st.fps) ? 'selected' : ''}>${f} fps</option>`).join('');
  exportFmt = st.container;
  exportW = st.width; exportH = st.height; exportFps = st.fps;
  $('#mo-export-filename')?.remove();
  $('#mo-export-name').value = st.name || (project.name || 'cascade-motion').replace(/[^\w-]+/g, '-');
  $('#mo-export-qualitymode').value = st.videoBitrate ? 'bitrate' : 'crf';
  $('#mo-export-crf').value = st.crf ?? 18;
  $('#mo-export-bitrate').value = st.videoBitrate ? String(parseInt(st.videoBitrate, 10)) : 12000;
  $('#mo-export-crf-wrap').hidden = !!st.videoBitrate;
  $('#mo-export-bitrate-wrap').hidden = !st.videoBitrate;
  $('#mo-export-encoder').value = st.presetName || 'medium';
  $('#mo-export-abitrate').value = st.audioBitrate || '192k';
  $('#mo-export-arate').value = '48000';
  $('#mo-export-channels').value = String(st.channels || 2);
  $('#mo-export-colorspace').value = st.colorSpace || 'bt709';
  const presets = $('#mo-export-presets');
  const allPresets = [...EXPORT_PRESETS, { id: 'match', name: 'Match sequence' }];
  presets.innerHTML = allPresets.map((p) => `<button type="button" data-preset="${p.id}" class="${st.preset === p.id ? 'is-active' : ''}">${esc(p.name)}</button>`).join('');
  presets.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => applyExportPreset(b.dataset.preset)));
  renderExportSummary();
}

function applyExportPreset(id) {
  const st = exportSettingsState;
  st.preset = id;
  if (id === 'match') {
    st.container = 'mp4'; st.videoCodec = 'libx264'; st.audioCodec = 'aac'; st.width = project.width; st.height = project.height; st.fps = project.fps; st.videoBitrate = ''; st.crf = 18; st.presetName = 'medium';
  } else {
    const p = EXPORT_PRESETS.find((x) => x.id === id);
    if (p) {
      st.container = p.container; st.videoCodec = p.videoCodec; st.audioCodec = p.audioCodec;
      if (p.width) st.width = p.width; if (p.height) st.height = p.height; if (p.fps) st.fps = p.fps;
      st.videoBitrate = p.videoBitrate === '0' ? '' : p.videoBitrate || '';
      st.crf = p.crf ?? 18; st.audioBitrate = p.audioBitrate || '192k'; st.presetName = p.preset || 'medium';
    }
  }
  populateExportForm();
  validateExportForm();
}

function readExportForm() {
  const st = exportSettingsState;
  st.name = $('#mo-export-name').value.trim();
  st.container = $('#mo-export-container').value;
  st.videoCodec = $('#mo-export-vcodec').value || null;
  st.audioCodec = $('#mo-export-acodec').value || null;
  const res = $('#mo-export-resolution');
  const option = res.selectedOptions[0];
  if (res.value === 'custom') {
    const w = Number(prompt('Export width', String(st.width)));
    const h = Number(prompt('Export height', String(st.height)));
    if (w && h) { st.width = w; st.height = h; }
  } else if (option) { st.width = Number(option.dataset.w); st.height = Number(option.dataset.h); }
  st.fps = Number($('#mo-export-fps').value) || project.fps;
  st.qualityMode = $('#mo-export-qualitymode').value;
  st.crf = Number($('#mo-export-crf').value);
  st.videoBitrate = st.qualityMode === 'bitrate' ? `${Number($('#mo-export-bitrate').value)}k` : '';
  st.presetName = $('#mo-export-encoder').value;
  st.audioBitrate = $('#mo-export-abitrate').value;
  st.sampleRate = Number($('#mo-export-arate').value);
  st.channels = Number($('#mo-export-channels').value);
  st.colorSpace = $('#mo-export-colorspace').value;
  st.faststart = $('#mo-export-faststart').checked;
  st.hardware = $('#mo-export-hardware')?.value || 'cpu';
  renderExportSummary();
}

function validateExportForm() {
  if (!exportSettingsState) return { errors: [], warnings: [] };
  const st = exportSettingsState;
  const errors = []; const warnings = [];
  const c = CONTAINERS.find((x) => x.id === st.container);
  const softwareCodec = String(st.videoCodec || '').replace(/_(nvenc|vaapi|qsv|amf)$/, '').replace(/^hevc_/, 'libx265').replace(/^h264_/, 'libx264');
  if (c?.video.length && !c.video.includes(st.videoCodec) && !c.video.includes(softwareCodec)) errors.push(`${st.videoCodec || 'No video codec'} cannot be stored in ${st.container}.`);
  if (st.audioCodec && c && !c.audio.includes(st.audioCodec)) errors.push(`${st.audioCodec} cannot be stored in ${st.container}.`);
  if (st.videoCodec && config.ffmpeg?.encoders?.length && !config.ffmpeg.encoders.includes(st.videoCodec)) errors.push(`${st.videoCodec} is not installed in this FFmpeg build.`);
  if (st.hardware && st.hardware !== 'cpu' && config.ffmpeg?.encoders?.length && !config.ffmpeg.encoders.includes(st.hardware)) errors.push(`${st.hardware} is not installed in this FFmpeg build.`);
  if (st.audioCodec && config.ffmpeg?.encoders?.length && !config.ffmpeg.encoders.includes(st.audioCodec)) errors.push(`${st.audioCodec} is not installed in this FFmpeg build.`);
  if (st.container === 'mp4' && st.audioCodec === 'libopus') errors.push('Opus in MP4 is not broadly playable. Use WebM or AAC.');
  if (st.channels === 6 && !['eac3', 'libopus', 'flac', 'pcm_s16le'].includes(st.audioCodec)) errors.push('5.1 surround needs E-AC-3, Opus, FLAC or PCM.');
  if (st.channels === 6 && st.audioCodec === 'aac') warnings.push('AAC 5.1 is not supported by this encoder setup; audio will be stereo.');
  if (st.videoCodec === 'libx265' && ['mp4', 'mov'].includes(st.container)) warnings.push('H.265 playback depends on the player; add the hvc1 tag (applied automatically) or share an H.264 copy.');
  if (st.videoCodec === 'libvpx-vp9') warnings.push('VP9 encoding is CPU-intensive; keep the render queue open or let it run in the background.');
  if (st.hardware && st.hardware !== 'cpu') warnings.push(`Using hardware encoder ${st.hardware}. Quality and rate control depend on the GPU driver.`);
  if (st.hardware && st.hardware !== 'cpu' && !['nvenc','qsv','amf','vaapi'].some((h) => st.hardware.endsWith('_'+h))) warnings.push('Hardware selection will fall back to the CPU encoder for this codec.');
  const box = $('#mo-export-warning');
  if (box) {
    const text = [...errors, ...warnings].filter(Boolean);
    box.hidden = !text.length;
    box.innerHTML = errors.map((e) => `<div>⛔ ${esc(e)}</div>`).join('') + warnings.map((w2) => `<div>⚠ ${esc(w2)}</div>`).join('');
  }
  const run = $('#mo-export-run');
  if (run) run.disabled = errors.length > 0 || !config.ffmpeg?.available;
  return { errors, warnings };
}

function renderExportSummary() {
  const st = exportSettingsState;
  const duration = Math.max(1, (timelineDuration(project) || project.duration) / TICKS);
  const bitrate = st.videoBitrate ? parseInt(st.videoBitrate, 10) * 1000 : (st.videoCodec === 'libx265' ? 20_000_000 : st.videoCodec === 'libvpx-vp9' ? 8_000_000 : 12_000_000);
  const size = (bitrate * duration) / 8;
  const list = $('#mo-export-summary-list');
  if (!list) return;
  list.innerHTML = `<dt>Container</dt><dd>${esc(CONTAINERS.find((c) => c.id === st.container)?.label || st.container)}</dd>
    <dt>Video</dt><dd>${esc(VIDEO_CODECS.find((v) => v.id === st.videoCodec)?.label || st.videoCodec || 'None')}</dd>
    <dt>Audio</dt><dd>${esc(AUDIO_CODECS.find((a) => a.id === st.audioCodec)?.label || st.audioCodec || 'None')}</dd>
    <dt>Resolution</dt><dd>${st.width} × ${st.height}</dd><dt>Frame rate</dt><dd>${st.fps} fps</dd>
    <dt>Duration</dt><dd>${fmtShort(duration * TICKS)}</dd><dt>Est. size</dt><dd>${size > 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : `${Math.round(size / 1024 / 1024)} MB`}</dd>`;
  const est = $('#mo-export-estimate');
  if (est) est.textContent = `Estimated render: ${Math.max(1, Math.ceil(duration * (st.videoCodec === 'libx265' ? 2.4 : 1.1)))}s at up to ${config.limits?.renderConcurrency || 1} concurrent job.`;
  bindHardwareSelect();
}

function bindHardwareSelect() {
  const st = exportSettingsState;
  $('#mo-export-hardware')?.closest('label')?.remove();
  const baseId = st.videoCodec?.replace(/_(nvenc|vaapi|qsv|amf)$/, '') || '';
  const family = baseId.includes('265') || baseId.includes('hevc') ? 'hevc' : baseId.includes('av1') ? 'av1' : 'h264';
  const encoders = config.ffmpeg?.encoders || [];
  const hardware = [`${family}_nvenc`, `${family}_qsv`, `${family}_amf`].filter((id) => encoders.includes(id));
  const hwNote = $('#mo-export-hw');
  if (hwNote) hwNote.textContent = hardware.length ? `Detected: ${hardware.join(', ')}. CPU encoding is always available.` : 'No hardware encoders detected; renders use the CPU encoder.';
  if (!hardware.length) return;
  const wrap = document.createElement('label');
  wrap.style.marginTop = '2px';
  wrap.innerHTML = `Hardware encoder<select id="mo-export-hardware"><option value="cpu">CPU (${esc(st.videoCodec || 'software')})</option>${hardware.map((id) => `<option value="${id}" ${id === st.hardware ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select>`;
  const grid = $('.mo-export-body .mo-form-grid');
  grid.append(wrap);
  $('#mo-export-hardware').addEventListener('change', () => { readExportForm(); validateExportForm(); });
}

async function startExport() {
  readExportForm();
  const v = validateExportForm();
  if (v.errors.length) return toast('Fix the export compatibility errors first', true);
  const st = exportSettingsState;
  try {
    $('#mo-export-run').disabled = true;
    $('#mo-export-run').textContent = 'Starting…';
    await ws?.saveNow?.(true);
    const j = await request(`${API}/export`, {
      method: 'POST',
      body: JSON.stringify({
        project,
        settings: {
          preset: st.preset, name: st.name, container: st.container, videoCodec: st.videoCodec, audioCodec: st.audioCodec,
          width: Number(st.width), height: Number(st.height), fps: Number(st.fps),
          crf: st.qualityMode === 'crf' ? Number(st.crf) : null,
          videoBitrate: st.qualityMode === 'bitrate' ? st.videoBitrate : null,
          audioBitrate: st.audioBitrate, sampleRate: st.sampleRate, channels: Number(st.channels),
          presetName: st.presetName, colorSpace: st.colorSpace, faststart: st.faststart,
          hardwareAcceleration: st.hardware === 'cpu' ? 'cpu' : st.hardware,
        },
      }),
    });
    toast('Render queued');
    loadJobs();
    watchJob(j.job.id, () => { toast('Render complete'); loadJobs(); });
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('#mo-export-run').disabled = false;
    $('#mo-export-run').textContent = 'Start render';
  }
}

function setExportProgress(text) { const el = $('#mo-render-stat'); if (el) el.textContent = text; }

async function loadJobs() {
  try {
    const j = await request(`${API}/jobs`);
    renderJobs(j.jobs || []);
  } catch { /* jobs panel is optional until first render */ }
}

function renderJobs(jobs) {
  const list = $('#mo-job-list');
  if (!list) return;
  if (!jobs.length) { list.innerHTML = '<p class="mo-fine">No renders yet.</p>'; return; }
  list.innerHTML = '';
  jobs.slice(0, 10).forEach((job) => {
    const row = document.createElement('div');
    row.className = 'mo-job';
    const status = job.status || 'queued';
    row.innerHTML = `<div class="mo-job-head"><b>${esc(job.type === 'export' ? job.params?.settings?.container || 'export' : job.type)}</b><span class="mo-job-status ${status}">${esc(status)}</span></div>
      <div class="mo-job-bar"><span style="width:${job.progress || 0}%"></span></div>
      <div class="mo-fine">${esc(job.stage || (status === 'done' ? 'Complete' : ''))}${job.error ? ` · ${esc(job.error)}` : ''}</div>
      <div class="mo-job-actions"></div>`;
    const actions = row.querySelector('.mo-job-actions');
    if (job.status === 'done' && job.result?.downloadUrl) {
      actions.innerHTML = `<a href="${job.result.downloadUrl}">Download</a>${job.result.size ? `<span class="mo-fine">${Math.round(job.result.size / 1024 / 1024)} MB</span>` : ''}`;
    }
    if (['queued', 'running'].includes(job.status)) {
      const b = document.createElement('button'); b.textContent = 'Cancel'; b.onclick = async () => { try { await request(`/api/motion/jobs/${job.id}/cancel`, { method: 'POST', body: '{}' }); loadJobs(); } catch (err) { toast(err.message, true); } };
      actions.append(b);
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      const b = document.createElement('button'); b.textContent = 'Retry'; b.onclick = async () => { try { await request(`/api/motion/jobs/${job.id}/retry`, { method: 'POST', body: '{}' }); loadJobs(); } catch (err) { toast(err.message, true); } };
      actions.append(b);
    }
    list.append(row);
    if (job.status === 'running') setExportProgress(`${job.progress || 0}% · ${job.stage || 'Rendering'}`);
  });
}

function watchJob(id, onDone) {
  const started = Date.now();
  const tick = async () => {
    try {
      const j = await request(`/api/motion/jobs/${id}`);
      const job = j.job;
      setExportProgress(job.status === 'running' ? `${job.progress}% · ${job.stage || 'Rendering'}` : '');
      if (['done', 'failed', 'cancelled'].includes(job.status)) {
        if (job.status === 'done') onDone?.(job);
        else toast(job.error || `Job ${job.status}`, true);
        loadJobs();
        return;
      }
      if (Date.now() - started > 6 * 60 * 60 * 1000) return toast('Job is still running; check the export queue later', true);
      setTimeout(tick, 1800);
    } catch (err) { setTimeout(tick, 3000); }
  };
  tick();
}

/* ------------------------------------------------------------------------- */
/* Mixer                                                                     */
/* ------------------------------------------------------------------------- */

function renderMixer() {
  const mixer = $('#mo-mixer');
  if (!mixer || mixer.hidden) return;
  const audioTracks = project.tracks.filter((t) => t.type === 'audio');
  mixer.innerHTML = '';
  audioTracks.forEach((track) => {
    const ch = document.createElement('div');
    ch.className = 'mo-channel';
    ch.innerHTML = `<h4>${esc(track.name)}</h4><div class="mo-fader"><input type="range" min="0" max="2" step="0.01" value="${track.volume ?? 1}"><div class="mo-channel-meter"><span></span></div></div><div class="mo-channel-btns"><button data-m="mute" class="${track.muted ? 'on' : ''}">M</button><button data-m="solo" class="${track.solo ? 'on' : ''}">S</button></div>`;
    ch.querySelector('input').addEventListener('input', (e) => {
      const next = deep(project); const t = next.tracks.find((x) => x.id === track.id); t.volume = Number(e.target.value);
      project = next; engine.setProject(project); mixer.dataset.dirty = '1';
    });
    ch.querySelector('input').addEventListener('change', () => { bumpHistory('Fader', project, engine.time); scheduleSave(); });
    ch.querySelector('[data-m="mute"]').onclick = () => updateTrack(track.id, { muted: !track.muted }, 'Mute track');
    ch.querySelector('[data-m="solo"]').onclick = () => updateTrack(track.id, { solo: !track.solo }, 'Solo track');
    mixer.append(ch);
  });
  const master = document.createElement('div');
  master.className = 'mo-channel master';
  master.innerHTML = `<h4>Master</h4><div class="mo-fader"><input type="range" min="0" max="2" step="0.01" value="${project.master.volume ?? 1}"><div class="mo-channel-meter"><span></span></div></div><div class="mo-fine" id="mo-master-db">-∞ dB</div>`;
  master.querySelector('input').addEventListener('input', (e) => setMaster({ volume: Number(e.target.value) }, 'Master volume'));
  mixer.append(master);
  updateMixerMeters();
}

function updateMixerMeters() {
  const mixer = $('#mo-mixer');
  if (!mixer || mixer.hidden) return;
  const peak = engine.audio?.peak || 0;
  mixer.querySelectorAll('.mo-channel-meter span').forEach((bar) => { bar.style.height = `${Math.min(100, peak * 100)}%`; });
  const db = $('#mo-master-db');
  if (db) db.textContent = peak > 0.001 ? `${Math.round(20 * Math.log10(peak))} dB` : '-∞ dB';
}

/* ------------------------------------------------------------------------- */
/* Shortcuts sheet and init                                                  */
/* ------------------------------------------------------------------------- */

const SHORTCUTS = [
  ['Playback', [['Play / pause', 'Space'], ['Pause', 'K'], ['Play forward / speed up', 'L'], ['Step back', 'J'], ['Previous / next frame', '← / →'], ['Jump 1 second', 'Shift + ← / →'], ['Start / end', 'Home / End'], ['Fullscreen preview', 'Shift + F']]],
  ['Editing', [['Split at playhead', 'S'], ['Razor tool', 'C'], ['Selection tool', 'V'], ['Slip tool', 'Y'], ['Hand tool', 'H'], ['Delete', 'Delete'], ['Ripple delete', 'Shift + Delete'], ['Freeze frame', 'F'], ['Add marker', 'M'], ['In / out markers', 'I / O'], ['Undo / redo', 'Ctrl + Z / Ctrl + Shift + Z'], ['Copy / paste', 'Ctrl + C / Ctrl + V'], ['Duplicate', 'Ctrl + D'], ['Group', 'Ctrl + G'], ['Select all', 'Ctrl + A']]],
  ['View', [['Zoom timeline', '+ / −'], ['Fit timeline', 'Shift + Z'], ['Snap', 'N'], ['Import', 'Ctrl + I'], ['Export', 'Ctrl + E'], ['Save', 'Ctrl + S'], ['Shortcuts', '?']]],
];

function renderShortcuts() {
  const box = $('#mo-shortcuts-body');
  if (!box) return;
  box.innerHTML = `<div class="mo-shortcuts">${SHORTCUTS.map(([cat, rows]) => `<section><h3>${cat}</h3>${rows.map(([label, keys]) => `<div class="mo-shortcut"><span>${label}</span><kbd>${keys}</kbd></div>`).join('')}</section>`).join('')}</div>`;
}

function setupImportDialog() {
  const dlg = $('#mo-import-dlg');
  $('#mo-file-input').addEventListener('change', (e) => {
    if (e.target.files.length) uploadFiles([...e.target.files]);
    e.target.value = '';
  });
  const zone = $('#mo-upload-zone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('is-over'); if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]); });
  dlg.querySelectorAll('[data-cmd="record-screen"]').forEach((b) => b.addEventListener('click', () => startRecording('screen')));
  dlg.querySelectorAll('[data-cmd="record-camera"]').forEach((b) => b.addEventListener('click', () => startRecording('camera')));
  dlg.querySelectorAll('[data-cmd="record-mic"]').forEach((b) => b.addEventListener('click', () => startRecording('mic')));
  dlg.querySelectorAll('[data-cmd="import-cloud-dlg"]').forEach((b) => b.addEventListener('click', openCloudPicker));
  dlg.querySelectorAll('[data-cmd="import-url-dlg"]').forEach((b) => b.addEventListener('click', () => { toggleUrlRow(); }));
  dlg.querySelector('[data-cmd="import-url-go"]').addEventListener('click', () => { const url = $('#mo-url-input').value.trim(); if (url) importRemoteUrl(url); });
  $('#mo-url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dlg.querySelector('[data-cmd="import-url-go"]').click(); } });
  $('#mo-record-dlg').addEventListener('close', () => { if (recordingStop) { /* recording already stopped by button */ } });
}

function setupExportDialog() {
  $('#mo-export-container').addEventListener('change', () => {
    exportSettingsState.container = $('#mo-export-container').value;
    const c = CONTAINERS.find((x) => x.id === exportSettingsState.container);
    exportSettingsState.videoCodec = c?.video[0] || null;
    exportSettingsState.audioCodec = c?.audio[0] || null;
    populateExportForm();
    validateExportForm();
  });
  $('#mo-export-options')?.addEventListener('change', () => { readExportForm(); validateExportForm(); });
  ['#mo-export-resolution', '#mo-export-fps', '#mo-export-qualitymode', '#mo-export-crf', '#mo-export-bitrate', '#mo-export-encoder', '#mo-export-abitrate', '#mo-export-arate', '#mo-export-channels', '#mo-export-colorspace'].forEach((sel) => {
    $(sel)?.addEventListener('change', () => { readExportForm(); validateExportForm(); if (sel === '#mo-export-qualitymode') { $('#mo-export-crf-wrap').hidden = $(sel).value !== 'crf'; $('#mo-export-bitrate-wrap').hidden = $(sel).value !== 'bitrate'; } });
  });
  $('#mo-export-run').addEventListener('click', startExport);
  $('#mo-export-dlg').addEventListener('close', () => loadJobs());
}

function setupTranscribeDialog() {
  $('#mo-transcribe-run').addEventListener('click', runTranscription);
}

function startLivePresence() {
  setInterval(() => {
    const others = (ws?.state?.participants || []).filter((p) => p.username !== ws?.state?.me?.username);
    $$('.mo-remote-playhead', rulerEl).forEach((el) => el.remove());
    others.forEach((p) => {
      if (!String(p.selection || '').startsWith('motion:')) return;
      const t = Number(String(p.selection).slice(7));
      if (!Number.isFinite(t)) return;
      const marker = document.createElement('div');
      marker.className = 'mo-remote-playhead';
      marker.style.left = `${(t / TICKS) * zoom}px`;
      marker.style.background = p.color || '#22d3ee';
      marker.title = `${p.username}'s playhead`;
      rulerEl.append(marker);
    });
  }, 1200);
  setInterval(() => {
    if (!ws?.collab?.connected) return;
    window.__cascadePresenceSelection = `motion:${Math.round(engine.time)}`;
    try { ws.collab.sendPresence(); } catch { /* optional */ }
  }, 1500);
}

let initialized = false;
async function init() {
  if (initialized) return;
  initialized = true;
  engine = new MotionEngine({ canvas: $('#mo-canvas'), project, assets });
  try {
    const savedH = parseInt(localStorage.getItem('cascade:motion-timeline-height'), 10);
    if (savedH) app.style.setProperty('--mo-timeline-height', `${clamp(savedH, 120, Math.max(180, window.innerHeight - 220))}px`);
  } catch { /* storage disabled */ }
  setupPreviewLayout();
  engine.onTick(() => {
    updatePlayhead();
    updateAutoQuality();
    const now = performance.now();
    if (now - (init._lastUi || 0) > 90) {
      init._lastUi = now;
      updateTimecode();
      const barL = $('#mo-meter-l'); const barR = $('#mo-meter-r');
      if (barL) barL.style.height = `${Math.min(100, (engine.audio?.peak || 0) * 130)}%`;
      if (barR) barR.style.height = `${Math.min(100, (engine.audio?.peak || 0) * 118)}%`;
      const fps = $('#mo-stat-fps'); if (fps) fps.textContent = engine.stats.fps || '—';
      const drop = $('#mo-stat-dropped'); if (drop) drop.textContent = engine.stats.dropped;
      updateMixerMeters();
    }
  });
  engine.setTime(0);
  exportW = project.width; exportH = project.height; exportFps = project.fps;

  await Promise.all([loadAssets(), loadConfig()]);
  renderAll();
  renderMonitorMeta();
  updateTransport();
  renderShortcuts();
  setupImportDialog();
  setupExportDialog();
  setupTranscribeDialog();
  renderMixer();
  const mobileTools = document.createElement('div');
  mobileTools.className = 'mo-mobile-tools';
  mobileTools.innerHTML = '<button type="button">Media</button><button type="button">Inspector</button>';
  mobileTools.children[0].addEventListener('click', () => togglePanel('left'));
  mobileTools.children[1].addEventListener('click', () => togglePanel('right'));
  $('.mo-menus')?.after(mobileTools);
  startLivePresence();
  loadJobs();

  if (window.Workspace) {
    try {
      ws = window.Workspace.create({
        id: DOC.id,
        kind: 'video',
        content: DOC.content,
        version: DOC.version || 1,
        filename: DOC.filename || 'Motion project',
        canEdit: CAN_EDIT,
        collect: () => project,
        apply: (content) => {
          try {
            project = normalizeProject(content || {});
            selection = new Set([...selection].filter((id) => project.clips.some((c) => c.id === id)));
            engine.setProject(project);
            renderAll();
          } catch (err) { console.error('motion apply failed', err); }
        },
      });
      updateStatusbar();
    } catch (err) { console.error(err); }
  }
  window.addEventListener('beforeunload', () => { engine?.destroy(); });
  status('Ready');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
