/* Cascade AI workspace client: streaming chat, branches, tools, images, RAG, voice. */
const DATA = window.__AI__ || {};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const AI = {
  ai: DATA.ai || { providers: [], limits: {} },
  providers: (DATA.ai && DATA.ai.providers ? DATA.ai.providers : []).filter((p) => p.enabled !== false),
  conversations: DATA.conversations || [],
  folders: DATA.folders || [],
  assistants: DATA.assistants || [],
  knowledge: DATA.knowledge || [],
  knowledgeDocs: [],
  activeId: DATA.activeId || null,
  current: null,
  messages: [],
  leafId: null,
  providerId: '',
  model: '',
  models: [],
  assistantId: '',
  userConfig: DATA.userConfig || { mcpServers: [], globalMcpServers: [], thinking: 'auto', effort: 'auto' },
  thinking: DATA.userConfig?.thinking || 'auto',
  effort: DATA.userConfig?.effort || 'auto',
  useTools: true,
  useWeb: false,
  knowledgeIds: new Set(),
  attachments: [],
  streaming: false,
  controller: null,
  streamEl: null,
  streamMsg: null,
  audio: null,
  audioUrl: null,
  search: '',
  folderFilter: null,
  kbSelected: null,
  kbDocs: [],
  asstSelected: null,
};

/* ------------------------------- utilities ------------------------------ */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icon(name, className = '') {
  return `<i data-lucide="${escapeHtml(name)}"${className ? ` class="${escapeHtml(className)}"` : ''}></i>`;
}

function refreshIcons(root = document) {
  if (!window.lucide || typeof window.lucide.createIcons !== 'function') return;
  try { window.lucide.createIcons({ root, attrs: { 'stroke-width': 1.8 } }); } catch { /* icons are progressive */ }
}

/* Native selects remain the source of truth for accessibility and for the rest
 * of the client, but the visible trigger is a styled listbox so the workspace
 * does not expose browser-default dropdown chrome. */
function closeDropdowns(except = null) {
  $$('.ai-dd.is-open').forEach((dd) => { if (dd !== except) { dd.classList.remove('is-open'); const menu = $('.ai-dd-menu', dd); if (menu) menu.hidden = true; $('.ai-dd-btn', dd)?.setAttribute('aria-expanded', 'false'); } });
}

function refreshDropdown(select) {
  if (!select) return;
  const dd = select.closest('.ai-dd');
  if (!dd) return;
  const button = $('.ai-dd-btn', dd);
  const menu = $('.ai-dd-menu', dd);
  if (!button || !menu) return;
  const selected = select.options[select.selectedIndex] || select.options[0];
  const value = $('.ai-dd-value', button);
  if (value) value.textContent = selected ? selected.textContent.trim() : 'None';
  button.title = selected ? selected.textContent.trim() : 'None';
  button.disabled = !select.options.length || (select.options.length === 1 && !select.options[0].value);
  menu.innerHTML = '';
  [...select.options].forEach((option) => {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = `ai-dd-opt${option.selected ? ' is-selected' : ''}`;
    opt.dataset.value = option.value;
    opt.setAttribute('role', 'option');
    opt.setAttribute('aria-selected', option.selected ? 'true' : 'false');
    opt.innerHTML = `<span>${escapeHtml(option.textContent.trim())}</span>${icon('check', 'ai-dd-check')}`;
    opt.addEventListener('click', () => {
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      refreshDropdown(select);
      closeDropdowns();
      button.focus();
    });
    menu.append(opt);
  });
  refreshIcons(menu);
}

function enhanceSelect(select) {
  if (!select) return;
  const dd = select.closest('.ai-dd');
  if (!dd) return;
  if (!$('.ai-dd-btn', dd)) {
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const iconName = dd.dataset.icon || 'chevron-down';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-dd-btn';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `${icon(iconName)}<span class="ai-dd-value"></span>${icon('chevron-down')}`;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = dd.classList.contains('is-open');
      closeDropdowns(dd);
      dd.classList.toggle('is-open', !open);
      button.setAttribute('aria-expanded', String(!open));
      const menu = $('.ai-dd-menu', dd);
      if (!menu) return;
      menu.hidden = open;
      if (!open) {
        const rect = button.getBoundingClientRect();
        const width = Math.max(rect.width, 172);
        menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
        menu.style.top = `${Math.min(rect.bottom + 5, window.innerHeight - 80)}px`;
        menu.style.minWidth = `${width}px`;
      }
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { closeDropdowns(); button.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!dd.classList.contains('is-open')) button.click();
        setTimeout(() => { $(event.key === 'ArrowDown' ? '.ai-dd-opt' : '.ai-dd-opt:last-child', dd)?.focus(); }, 0);
      }
    });
    const menu = document.createElement('div');
    menu.className = 'ai-dd-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    dd.append(button, menu);
  }
  refreshDropdown(select);
  refreshIcons(dd);
}

function enhanceSelects(root = document) {
  $$('.ai-dd > select', root).forEach(enhanceSelect);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
  return data;
}

function throttle(fn, ms) {
  let timer = null;
  let last = 0;
  const run = () => { timer = null; last = Date.now(); fn(); };
  const wrapped = () => {
    const now = Date.now();
    if (now - last >= ms) { clearTimeout(timer); timer = null; run(); }
    else if (!timer) timer = setTimeout(run, ms - (now - last));
  };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  return wrapped;
}

function hint(text, isError = false) {
  const el = $('#ai-hint');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
}

function fmtTokens(n) { return Number(n || 0).toLocaleString(); }

function convoTitle(c) { return c && c.title ? c.title : 'New chat'; }

function currentConvo() { return AI.conversations.find((c) => c.id === AI.activeId) || AI.current; }

function modelId(entry) { return typeof entry === 'string' ? entry : String(entry && entry.id ? entry.id : ''); }

function modelLabel(entry) {
  if (typeof entry === 'string') return entry;
  return (entry && (entry.name || entry.id)) || '';
}

function providerLabel(p) { return p ? p.name || p.id : ''; }

function isNearBottom() {
  const chat = $('#ai-chat');
  return chat ? chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140 : true;
}

function scrollBottom() {
  const chat = $('#ai-chat');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

function scrollIfNeeded(force = false) {
  if (force || isNearBottom()) scrollBottom();
}

/* -------------------------------- markdown ------------------------------ */

let markedReady = false;
function setupMarkdown() {
  if (!window.marked || markedReady) return;
  const marked = window.marked;
  const renderer = new marked.Renderer();
  renderer.html = (token) => escapeHtml(typeof token === 'string' ? token : (token && (token.text || token.raw)) || '');
  const mathBlock = {
    name: 'mathBlock',
    level: 'block',
    start(src) {
      const i = src.search(/\$\$|\\\[/);
      return i < 0 ? undefined : i;
    },
    tokenizer(src) {
      const m = /^\$\$([\s\S]+?)\$\$/.exec(src) || /^\\\[([\s\S]+?)\\\]/.exec(src);
      if (!m) return undefined;
      return { type: 'mathBlock', raw: m[0], text: m[1].trim(), display: true };
    },
    renderer(token) {
      if (!window.katex) return `<pre>${escapeHtml(token.text)}</pre>`;
      try { return `<div class="ai-katex-block">${window.katex.renderToString(token.text, { displayMode: true, throwOnError: false })}</div>`; }
      catch { return `<pre>${escapeHtml(token.text)}</pre>`; }
    },
  };
  const mathInline = {
    name: 'mathInline',
    level: 'inline',
    start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\$([^$\n]+?)\$/.exec(src);
      if (!m || !m[1].trim() || /^\s*\d[\d.,]*\s*$/.test(m[1])) return undefined;
      return { type: 'mathInline', raw: m[0], text: m[1] };
    },
    renderer(token) {
      if (!window.katex) return escapeHtml(token.raw);
      try { return window.katex.renderToString(token.text, { displayMode: false, throwOnError: false }); }
      catch { return escapeHtml(token.raw); }
    },
  };
  marked.use({ gfm: true, breaks: true, renderer, extensions: [mathBlock, mathInline] });
  markedReady = true;
}

function renderMarkdown(text) {
  const source = String(text || '');
  if (!source) return '';
  if (!window.marked) return `<p>${escapeHtml(source).replace(/\n/g, '<br>')}</p>`;
  setupMarkdown();
  try { return window.marked.parse(source); }
  catch { return `<p>${escapeHtml(source).replace(/\n/g, '<br>')}</p>`; }
}

const CODE_LANGS = ['html', 'svg', 'javascript', 'js', 'typescript', 'ts', 'json', 'markdown', 'md', 'css', 'python', 'bash', 'sql', 'xml', 'yaml'];

function enhanceContent(root) {
  if (!root) return;
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!/^(https?:|mailto:|\/|#)/i.test(href)) { a.removeAttribute('href'); return; }
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
  root.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!/^(https?:|data:image\/)/i.test(src)) img.remove();
  });
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.closest('.ai-code')) return;
    const codeEl = pre.querySelector('code');
    const raw = codeEl ? codeEl.textContent : pre.textContent;
    const match = codeEl ? (codeEl.className || '').match(/language-([\w+-]+)/) : null;
    const lang = ((match && match[1]) || '').toLowerCase();
    const wrap = document.createElement('div');
    wrap.className = 'ai-code';
    const head = document.createElement('div');
    head.className = 'ai-code-head';
    head.innerHTML = `<b>${escapeHtml(lang || 'code')}</b><span>${raw.split('\n').length} lines</span>`;
    const actions = document.createElement('div');
    actions.className = 'ai-code-actions';
    const copy = document.createElement('button');
    copy.type = 'button'; copy.innerHTML = `${icon('copy')} Copy`;
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(raw); copy.innerHTML = `${icon('check')} Copied`; refreshIcons(copy); setTimeout(() => { copy.innerHTML = `${icon('copy')} Copy`; refreshIcons(copy); }, 1200); }
      catch { copy.innerHTML = `${icon('circle-alert')} Failed`; refreshIcons(copy); }
    });
    const preview = document.createElement('button');
    preview.type = 'button'; preview.innerHTML = `${icon('play')} Preview`;
    preview.addEventListener('click', () => openCodePreview(raw, lang));
    actions.append(copy, preview);
    head.append(actions);
    refreshIcons(head);
    if (codeEl && window.hljs) {
      try {
        const html = lang && window.hljs.getLanguage(lang)
          ? window.hljs.highlight(raw, { language: lang }).value
          : window.hljs.highlightAuto(raw, CODE_LANGS).value;
        codeEl.innerHTML = html;
        codeEl.className = `hljs${lang ? ` language-${lang}` : ''}`;
      } catch { /* keep marked-escaped text */ }
    }
    // Insert the wrapper before moving <pre> into it; appending first would
    // detach the block from the document.
    pre.parentNode.insertBefore(wrap, pre);
    wrap.append(head, pre);
  });
}

function openCodePreview(code, lang) {
  const dialog = $('#ai-preview-dlg');
  const frame = $('#ai-preview-frame');
  const note = $('#ai-preview-note');
  const title = $('#ai-preview-title');
  if (!dialog || !frame) return;
  const l = String(lang || '').toLowerCase();
  let srcdoc;
  if (l === 'html' || /^\s*<!doctype html/i.test(code)) {
    srcdoc = code;
    note.textContent = 'Rendered in a sandboxed iframe. Scripts run without access to Cascade.';
    title.textContent = 'HTML preview';
  } else if (l === 'svg' || /^\s*<svg[\s>]/i.test(code)) {
    srcdoc = `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#111">${code}</body></html>`;
    note.textContent = 'SVG rendered in a sandboxed iframe.';
    title.textContent = 'SVG preview';
  } else {
    const highlighted = window.hljs && l && window.hljs.getLanguage(l)
      ? window.hljs.highlight(code, { language: l }).value
      : escapeHtml(code);
    srcdoc = `<!doctype html><html><head><style>body{margin:0;background:#0d1117;color:#c9d1d9;font:12.5px/1.6 ui-monospace,Menlo,monospace}pre{margin:0;padding:18px;white-space:pre-wrap}.hljs-keyword{color:#ff7b72}.hljs-string{color:#a5d6ff}.hljs-comment{color:#8b949e}.hljs-number{color:#79c0ff}.hljs-title{color:#d2a8ff}.hljs-attr{color:#79c0ff}</style></head><body><pre>${highlighted}</pre></body></html>`;
    note.textContent = 'Source preview — no execution.';
    title.textContent = `${l || 'Code'} preview`;
  }
  frame.srcdoc = srcdoc;
  dialog.showModal();
}

/* -------------------------------- sidebar ------------------------------- */

function renderSidebar() {
  const list = $('#ai-convos');
  const foldersEl = $('#ai-folders');
  if (!list) return;
  if (foldersEl) {
    foldersEl.innerHTML = '';
    const all = document.createElement('button');
    all.type = 'button'; all.className = `ai-folder-chip${AI.folderFilter ? '' : ' is-active'}`;
    all.textContent = 'All';
    all.addEventListener('click', () => { AI.folderFilter = null; renderSidebar(); });
    foldersEl.append(all);
    AI.folders.forEach((folder) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `ai-folder-chip${AI.folderFilter === folder.id ? ' is-active' : ''}`;
      chip.textContent = folder.name;
      chip.title = 'Filter by folder · double-click to delete';
      chip.addEventListener('click', () => { AI.folderFilter = AI.folderFilter === folder.id ? null : folder.id; renderSidebar(); });
      chip.addEventListener('dblclick', async () => {
        if (!confirm(`Delete folder "${folder.name}"? Conversations stay in your library.`)) return;
        try { await api(`/api/ai/folders/${folder.id}`, { method: 'DELETE' }); AI.folders = AI.folders.filter((f) => f.id !== folder.id); if (AI.folderFilter === folder.id) AI.folderFilter = null; renderSidebar(); }
        catch (err) { hint(err.message, true); }
      });
      foldersEl.append(chip);
    });
  }
  const query = AI.search.trim().toLowerCase();
  const rows = AI.conversations.filter((c) => {
    if (AI.folderFilter && c.folderId !== AI.folderFilter) return false;
    if (query && !String(c.title || '').toLowerCase().includes(query)) return false;
    return true;
  });
  list.innerHTML = '';
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'ai-empty-small';
    p.textContent = query ? 'No matching conversations.' : 'No conversations yet.';
    list.append(p);
    return;
  }
  rows.forEach((convo) => {
    const item = document.createElement('div');
    item.className = `ai-convo${convo.id === AI.activeId ? ' is-active' : ''}`;
    item.tabIndex = 0;
    item.innerHTML = `${icon('message-square')}<b>${escapeHtml(convoTitle(convo))}</b>${convo.pinned ? icon('pin', 'ai-pin') : ''}`;
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'ai-convo-more'; more.innerHTML = icon('ellipsis'); more.title = 'Conversation actions'; more.setAttribute('aria-label', 'Conversation actions');
    more.addEventListener('click', (event) => { event.stopPropagation(); openConvoMenu(convo, more); });
    item.append(more);
    item.addEventListener('click', () => openConversation(convo.id));
    item.addEventListener('keydown', (event) => { if (event.key === 'Enter') openConversation(convo.id); });
    list.append(item);
  });
  refreshIcons(list);
}

function openConvoMenu(convo, anchor) {
  const menu = $('#ai-convo-menu');
  if (!menu) return;
  menu.innerHTML = '';
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 210)}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 240)}px`;
  const add = (label, fn, danger = false) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; if (danger) b.className = 'danger';
    b.addEventListener('click', () => { menu.hidden = true; fn(); });
    menu.append(b);
  };
  add(convo.pinned ? 'Unpin' : 'Pin to top', async () => {
    try {
      const data = await api(`/api/ai/conversations/${convo.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !convo.pinned }) });
      mergeConversation(data.conversation); renderSidebar();
    } catch (err) { hint(err.message, true); }
  });
  add('Rename…', async () => {
    const title = prompt('Conversation title', convo.title || '');
    if (!title || !title.trim()) return;
    try {
      const data = await api(`/api/ai/conversations/${convo.id}`, { method: 'PATCH', body: JSON.stringify({ title: title.trim() }) });
      mergeConversation(data.conversation);
      if (convo.id === AI.activeId) setTitle(data.conversation.title);
      renderSidebar();
    } catch (err) { hint(err.message, true); }
  });
  const sep = document.createElement('div');
  sep.className = 'ai-context-sep';
  menu.append(sep);
  const label = document.createElement('label');
  label.textContent = 'Move to folder';
  const select = document.createElement('select');
  select.innerHTML = `<option value="">No folder</option>${AI.folders.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}`;
  select.value = convo.folderId || '';
  select.addEventListener('change', async () => {
    try {
      const data = await api(`/api/ai/conversations/${convo.id}`, { method: 'PATCH', body: JSON.stringify({ folderId: select.value || null }) });
      mergeConversation(data.conversation); renderSidebar(); menu.hidden = true;
    } catch (err) { hint(err.message, true); }
  });
  label.append(select);
  menu.append(label);
  const sep2 = document.createElement('div');
  sep2.className = 'ai-context-sep';
  menu.append(sep2);
  add('Delete conversation', async () => {
    if (!confirm(`Delete "${convoTitle(convo)}"? This cannot be undone.`)) return;
    try {
      await api(`/api/ai/conversations/${convo.id}`, { method: 'DELETE' });
      AI.conversations = AI.conversations.filter((c) => c.id !== convo.id);
      if (AI.activeId === convo.id) newChat();
      renderSidebar();
    } catch (err) { hint(err.message, true); }
  }, true);
  menu.hidden = false;
}

/* -------------------------------- topbar -------------------------------- */

function renderProviderOptions() {
  const select = $('#ai-provider');
  if (!select) return;
  select.innerHTML = AI.providers.length
    ? AI.providers.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(providerLabel(p))}</option>`).join('')
    : '<option value="">No providers</option>';
  if (AI.providerId) select.value = AI.providerId;
  refreshDropdown(select);
}

function renderModelOptions() {
  const select = $('#ai-model');
  if (!select) return;
  const models = AI.models.length ? AI.models : (AI.providers.find((p) => p.id === AI.providerId)?.models || []);
  const normalized = models.map((m) => ({ id: modelId(m), label: modelLabel(m) })).filter((m) => m.id);
  select.innerHTML = normalized.length
    ? normalized.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('')
    : '<option value="">No models</option>';
  if (AI.model) select.value = AI.model;
  if (!AI.model && normalized.length) { AI.model = normalized[0].id; select.value = AI.model; }
  refreshDropdown(select);
}

function renderAssistantOptions() {
  const select = $('#ai-assistant');
  if (!select) return;
  select.innerHTML = `<option value="">Default assistant</option>${AI.assistants.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}`;
  select.value = AI.assistantId || '';
  refreshDropdown(select);
}

function syncControls() {
  renderProviderOptions();
  renderModelOptions();
  renderAssistantOptions();
  $('#ai-provider')?.closest('.ai-dd')?.classList.toggle('is-single', AI.providers.length <= 1);
  $('#ai-assistant')?.closest('.ai-dd')?.classList.toggle('is-single', AI.assistants.length === 0);
  const thinking = $('#ai-thinking');
  if (thinking) { thinking.value = AI.thinking || 'auto'; refreshDropdown(thinking); }
  const effort = $('#ai-effort');
  if (effort) { effort.value = AI.effort || 'auto'; refreshDropdown(effort); }
  $('#ai-tools-toggle')?.classList.toggle('is-on', AI.useTools);
  $('#ai-web-toggle')?.classList.toggle('is-on', AI.useWeb);
  const badge = $('#ai-kb-count');
  if (badge) { badge.hidden = AI.knowledgeIds.size === 0; badge.textContent = String(AI.knowledgeIds.size); }
  $('#ai-kb-toggle')?.classList.toggle('is-on', AI.knowledgeIds.size > 0);
  const mcpBadge = $('#ai-mcp-badge');
  const personal = (AI.userConfig?.mcpServers || []).filter((server) => server.enabled).length;
  if (mcpBadge) { mcpBadge.hidden = personal === 0; mcpBadge.textContent = String(personal); }
  const context = $('#ai-composer-context');
  if (context) {
    const model = AI.model || 'no model';
    const mode = AI.thinking === 'on' ? `thinking ${AI.effort === 'auto' ? 'on' : AI.effort}` : AI.thinking === 'off' ? 'fast' : 'auto';
    context.textContent = `${model} · ${mode}`;
    context.title = `${model} · thinking ${AI.thinking} · effort ${AI.effort}`;
  }
  refreshIcons();
}

async function savePreference(field, value) {
  AI[field] = value;
  syncControls();
  try {
    const data = await api('/api/ai/user-config', { method: 'PUT', body: JSON.stringify({ [field]: value }) });
    AI.userConfig = data.config;
  } catch { /* preference still applies to this conversation */ }
  if (AI.activeId) {
    api(`/api/ai/conversations/${AI.activeId}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) })
      .then((data) => mergeConversation(data.conversation)).catch(() => {});
  }
}

function setTitle(title) {
  const el = $('#ai-title');
  if (el) el.textContent = title || 'New chat';
  document.title = title ? `${title} · Cascade AI` : 'Cascade AI · Cascade';
}

async function loadModels(providerId, keepModel = true) {
  if (!providerId) { AI.models = []; AI.modelsProviderId = ''; renderModelOptions(); return; }
  try {
    const data = await api(`/api/ai/models?providerId=${encodeURIComponent(providerId)}`);
    AI.models = data.models || [];
    AI.modelsProviderId = providerId;
    if (!keepModel || !AI.models.some((m) => modelId(m) === AI.model)) AI.model = modelId(AI.models[0]) || '';
    renderModelOptions();
  } catch (err) {
    AI.models = [];
    AI.modelsProviderId = providerId;
    renderModelOptions();
  }
}

/* ----------------------------- conversations ---------------------------- */

function mergeConversation(convo) {
  if (!convo) return;
  const index = AI.conversations.findIndex((c) => c.id === convo.id);
  if (index >= 0) AI.conversations[index] = { ...AI.conversations[index], ...convo };
  else AI.conversations.unshift(convo);
  if (AI.activeId === convo.id) AI.current = AI.conversations.find((c) => c.id === convo.id);
  AI.conversations.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (new Date(b.lastMessageAt || b.updatedAt || 0) - new Date(a.lastMessageAt || a.updatedAt || 0)));
}

async function refreshConversations() {
  try {
    const data = await api('/api/ai/conversations');
    if (data && Array.isArray(data.conversations)) {
      AI.conversations = data.conversations;
      if (AI.activeId) AI.current = AI.conversations.find((c) => c.id === AI.activeId) || AI.current;
      renderSidebar();
    }
  } catch { /* sidebar refresh is best-effort */ }
}

function newChat() {
  if (AI.streaming) return;
  AI.activeId = null;
  AI.current = null;
  AI.messages = [];
  AI.leafId = null;
  AI.attachments = [];
  AI.thinking = AI.userConfig?.thinking || 'auto';
  AI.effort = AI.userConfig?.effort || 'auto';
  renderAttachments();
  setTitle('New chat');
  history.replaceState(null, '', '/ai');
  renderChat();
  syncControls();
  renderSidebar();
  $('#ai-input')?.focus();
}

async function openConversation(id) {
  if (AI.streaming) { if (!confirm('A response is streaming. Open another conversation and stop it?')) return; AI.controller?.abort(); }
  if (id === AI.activeId && AI.messages.length) { closeSidebar(); return; }
  try {
    const data = await api(`/api/ai/conversations/${id}`);
    AI.activeId = id;
    AI.current = data.conversation;
    AI.messages = data.messages || [];
    AI.leafId = data.leafId || (AI.messages.length ? AI.messages[AI.messages.length - 1].id : null);
    AI.providerId = data.conversation.providerId || AI.providerId || AI.ai.defaultProviderId || AI.providers[0]?.id || '';
    AI.model = data.conversation.model || '';
    AI.assistantId = data.conversation.assistantId || '';
    AI.thinking = data.conversation.thinking || AI.userConfig?.thinking || 'auto';
    AI.effort = data.conversation.effort || AI.userConfig?.effort || 'auto';
    mergeConversation(data.conversation);
    setTitle(data.conversation.title);
    history.replaceState(null, '', `/ai/${id}`);
    renderChat();
    renderSidebar();
    syncControls();
    closeSidebar();
    if (AI.modelsProviderId !== AI.providerId) {
      await loadModels(AI.providerId, true);
      const providerModels = AI.models.map((m) => modelId(m));
      if (AI.model && !providerModels.includes(AI.model)) AI.model = providerModels[0] || '';
      renderModelOptions();
    }
  } catch (err) { hint(err.message, true); }
}

async function reloadActiveConversation(options = {}) {
  if (!AI.activeId) return;
  try {
    const data = await api(`/api/ai/conversations/${AI.activeId}`);
    AI.messages = data.messages || [];
    AI.leafId = data.leafId;
    AI.current = data.conversation;
    if (!options.silent) renderChat();
    else renderChat();
  } catch { /* keep local tree */ }
}

/* --------------------------------- chat --------------------------------- */

function renderChat() {
  const chat = $('#ai-chat');
  if (!chat) return;
  if (!AI.messages.length) {
    chat.innerHTML = `
      <div class="ai-empty-chat">
        <div class="ai-empty-orb">${icon('sparkles')}</div>
        <h1>What can I help you build?</h1>
        <p>Cascade AI answers questions and creates real projects in Cascade — documents, decks, spreadsheets, websites, images and video edits — through MCP tools.</p>
        <div class="ai-suggestions">
          <button type="button" class="ai-suggestion" data-prompt="Create a 6-slide presentation about the future of local-first software. Include speaker notes."><b>${icon('presentation')} Build a deck</b><span>Six slides with speaker notes on local-first software.</span></button>
          <button type="button" class="ai-suggestion" data-prompt="Build a one-page landing page for a specialty coffee roaster called Ember & Oak. Save it as a website in Cascade."><b>${icon('globe-2')} Build a website</b><span>A one-page landing site for a coffee roaster.</span></button>
          <button type="button" class="ai-suggestion" data-prompt="Create a budget spreadsheet for a small studio with categories, monthly columns and totals."><b>${icon('table-2')} Make a spreadsheet</b><span>A studio budget with categories and totals.</span></button>
          <button type="button" class="ai-suggestion" data-prompt="Summarize the key differences between RAG and long-context prompting, with a table."><b>${icon('book-open')} Explain something</b><span>RAG versus long-context prompting.</span></button>
        </div>
      </div>`;
    chat.querySelectorAll('[data-prompt]').forEach((btn) => {
      btn.addEventListener('click', () => { const input = $('#ai-input'); if (input) { input.value = btn.dataset.prompt; input.focus(); autoGrow(input); } });
    });
    refreshIcons(chat);
    return;
  }
  chat.innerHTML = '';
  AI.messages.forEach((msg) => appendMessageEl(msg));
  scrollBottom();
}

function appendMessageEl(msg) {
  const chat = $('#ai-chat');
  if (!chat) return null;
  const el = document.createElement('article');
  el.className = `ai-msg ${msg.role}`;
  el.dataset.id = msg.id;
  el.innerHTML = `
    <div class="ai-avatar">${msg.role === 'assistant' ? icon('sparkles') : icon('user-round')}</div>
    <div class="ai-msg-body">
      <div class="ai-msg-head"><b>${msg.role === 'assistant' ? 'Cascade AI' : 'You'}</b><span class="ai-msg-model"></span></div>
      <div class="ai-msg-tools"></div>
      <div class="ai-msg-content"></div>
      <div class="ai-msg-foot"></div>
    </div>`;
  chat.append(el);
  refreshIcons(el);
  updateMessageEl(el, msg);
  return el;
}

function updateMessageEl(el, msg) {
  if (!el || !msg) return;
  el.dataset.id = msg.id;
  const model = $('.ai-msg-model', el);
  if (model) model.textContent = msg.role === 'assistant' ? [msg.model, msg.usage && msg.usage.totalTokens ? `${fmtTokens(msg.usage.totalTokens)} tok` : ''].filter(Boolean).join(' · ') : '';
  const tools = $('.ai-msg-tools', el);
  renderTools(tools, msg);
  const content = $('.ai-msg-content', el);
  if (content) {
    if (msg.content) {
      content.innerHTML = renderMarkdown(msg.content);
      enhanceContent(content);
    } else if (msg.status === 'streaming') {
      content.innerHTML = '<span class="ai-typing"><i></i><i></i><i></i></span>';
    } else if (msg.role === 'assistant' && msg.status === 'error') {
      content.innerHTML = '';
    } else {
      content.innerHTML = '';
    }
    if (msg.status === 'error' && msg.error) {
      const err = document.createElement('div');
      err.className = 'ai-error-note';
      err.textContent = msg.error;
      content.append(err);
    }
    if (msg.search && Array.isArray(msg.search.results) && msg.search.results.length) {
      const note = document.createElement('div');
      note.className = 'ai-notice';
      note.innerHTML = `<b>Web search</b> · ${escapeHtml(msg.search.provider || '')} — ${msg.search.results.slice(0, 4).map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title || r.url)}</a>`).join(' · ')}`;
      content.append(note);
    }
  }
  const foot = $('.ai-msg-foot', el);
  if (foot) renderFoot(foot, msg);
}

function renderFoot(foot, msg) {
  foot.innerHTML = '';
  const copy = document.createElement('button');
  copy.type = 'button'; copy.innerHTML = `${icon('copy')} Copy`;
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(msg.content || ''); copy.innerHTML = `${icon('check')} Copied`; refreshIcons(copy); setTimeout(() => { copy.innerHTML = `${icon('copy')} Copy`; refreshIcons(copy); }, 1200); }
    catch { copy.innerHTML = `${icon('circle-alert')} Failed`; refreshIcons(copy); }
  });
  foot.append(copy);
  if (msg.role === 'assistant') {
    if (msg.status !== 'streaming' && AI.streaming === false) {
      const regen = document.createElement('button');
      regen.type = 'button'; regen.innerHTML = `${icon('rotate-ccw')} Regenerate`;
      regen.addEventListener('click', () => startStream({ regenerateOf: msg.id, providerId: AI.providerId, model: AI.model, thinking: AI.thinking, effort: AI.effort }, { regenerateOf: msg.id }));
      foot.append(regen);
    }
    const speak = document.createElement('button');
    speak.type = 'button'; speak.innerHTML = `${icon('volume-2')} Speak`;
    speak.addEventListener('click', () => speakText(msg.content, speak));
    foot.append(speak);
    if (msg.branch && msg.branch.count > 1 && Array.isArray(msg.branch.ids) && msg.branch.ids.length) {
      const wrap = document.createElement('span');
      wrap.className = 'ai-branch';
      const prev = document.createElement('button');
      prev.type = 'button'; prev.innerHTML = icon('chevron-left'); prev.title = 'Previous branch'; prev.setAttribute('aria-label', 'Previous branch');
      prev.disabled = msg.branch.index <= 0;
      prev.addEventListener('click', () => switchBranch(msg, -1));
      const label = document.createElement('span');
      label.textContent = `${msg.branch.index + 1}/${msg.branch.count}`;
      const next = document.createElement('button');
      next.type = 'button'; next.innerHTML = icon('chevron-right'); next.title = 'Next branch'; next.setAttribute('aria-label', 'Next branch');
      next.disabled = msg.branch.index >= msg.branch.count - 1;
      next.addEventListener('click', () => switchBranch(msg, 1));
      wrap.append(prev, label, next);
      foot.append(wrap);
    }
    if (msg.usage && msg.usage.totalTokens) {
      const chip = document.createElement('span');
      chip.className = 'ai-usage-chip';
      chip.textContent = `${fmtTokens(msg.usage.totalTokens)} tokens`;
      foot.append(chip);
    }
  }
  refreshIcons(foot);
}

async function switchBranch(msg, direction) {
  const ids = msg.branch.ids;
  const index = msg.branch.index + direction;
  if (index < 0 || index >= ids.length) return;
  try {
    const data = await api(`/api/ai/messages/${ids[index]}/leaf`, { method: 'POST', body: '{}' });
    AI.messages = data.messages || [];
    AI.leafId = data.leafId;
    mergeConversation(data.conversation);
    renderChat();
    renderSidebar();
  } catch (err) { hint(err.message, true); }
}

/* --------------------------------- tools -------------------------------- */

function upsertTool(msg, call) {
  if (!msg.toolCalls) msg.toolCalls = [];
  const existing = msg.toolCalls.find((c) => c.id === call.id);
  if (existing) Object.assign(existing, call);
  else msg.toolCalls.push({ ...call });
}

function renderTools(container, msg) {
  if (!container) return;
  container.innerHTML = '';
  const calls = msg.toolCalls || [];
  if (msg.search) {
    const note = document.createElement('div');
    note.className = 'ai-notice';
    note.textContent = `Web search · ${msg.search.provider || ''}`;
    container.append(note);
  }
  calls.forEach((call) => {
    const card = document.createElement('div');
    card.className = `ai-tool${call.isError ? ' is-error' : call.result ? ' is-ok' : ''}${call.pending ? ' is-pending' : ''}`;
    const head = document.createElement('div');
    head.className = 'ai-tool-head';
    head.innerHTML = `${icon(call.isError ? 'circle-alert' : call.pending ? 'shield-alert' : 'wrench')}<b>${escapeHtml(call.name || 'tool')}</b><span>${call.pending ? 'needs approval' : call.result ? 'done' : 'running'}</span><span class="ai-tool-state">${call.isError ? 'error' : call.pending ? 'pending' : call.result ? 'ok' : 'running'}</span>`;
    head.addEventListener('click', () => card.classList.toggle('is-open'));
    const body = document.createElement('div');
    body.className = 'ai-tool-body';
    if (call.arguments && Object.keys(call.arguments).length) {
      const args = document.createElement('pre');
      args.textContent = `arguments\n${JSON.stringify(call.arguments, null, 2)}`;
      body.append(args);
    }
    if (call.result) {
      const result = document.createElement('pre');
      result.textContent = `result\n${String(call.result).slice(0, 6000)}`;
      body.append(result);
    }
    artifactsFrom(call.data).forEach((artifact) => {
      const link = document.createElement('a');
      link.className = 'ai-artifact';
      link.href = artifact.url;
      link.innerHTML = `${icon('arrow-up-right')} ${escapeHtml(artifact.label)}`;
      body.append(link);
    });
    imagesFrom(call.data).forEach((src) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Generated image';
      img.style.maxWidth = '220px';
      img.style.borderRadius = '6px';
      img.style.marginTop = '6px';
      body.append(img);
    });
    card.append(head, body);
    if (call.pending) card.classList.add('is-open');
    container.append(card);
  });
  if (msg.status === 'pending') {
    const pending = calls.filter((c) => c.pending);
    if (pending.length) {
      const box = document.createElement('div');
      box.className = 'ai-confirm';
      const p = document.createElement('p');
      p.innerHTML = `Cascade AI wants to run ${pending.length === 1 ? 'a tool' : `${pending.length} tools`} that can change your files: <code>${pending.map((c) => escapeHtml(c.name)).join('</code>, <code>')}</code>.`;
      const row = document.createElement('div');
      row.className = 'ai-row';
      const approve = document.createElement('button');
      approve.type = 'button'; approve.className = 'ai-btn ai-btn-primary ai-btn-sm'; approve.innerHTML = `${icon('play')} Approve and run`;
      approve.addEventListener('click', () => continueTools(msg, pending.map((c) => c.id)));
      const deny = document.createElement('button');
      deny.type = 'button'; deny.className = 'ai-btn ai-btn-sm'; deny.innerHTML = `${icon('x')} Decline`;
      deny.addEventListener('click', () => continueTools(msg, []));
      row.append(approve, deny);
      box.append(p, row);
      container.append(box);
    }
  }
  refreshIcons(container);
}

function artifactsFrom(data) {
  const out = [];
  const seen = new Set();
  const walk = (value, depth) => {
    if (!value || depth > 4) return;
    if (Array.isArray(value)) { value.forEach((entry) => walk(entry, depth + 1)); return; }
    if (typeof value !== 'object') return;
    const url = value.url || value.editorUrl;
    if (url && typeof url === 'string' && url.startsWith('/') && !seen.has(url)) {
      seen.add(url);
      const kind = value.kind || value.type || value.filename || value.title || value.name || 'file';
      out.push({ url, label: `Open ${String(kind).replace(/_/g, ' ')}` });
    }
    Object.values(value).forEach((entry) => walk(entry, depth + 1));
  };
  walk(data, 0);
  return out.slice(0, 6);
}

function imagesFrom(data) {
  const out = [];
  const walk = (value, depth) => {
    if (!value || depth > 4 || out.length >= 4) return;
    if (Array.isArray(value)) { value.forEach((entry) => walk(entry, depth + 1)); return; }
    if (typeof value !== 'object') return;
    if (typeof value.dataUrl === 'string' && value.dataUrl.startsWith('data:image/')) out.push(value.dataUrl);
    else if (typeof value.url === 'string' && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(value.url)) out.push(value.url);
    Object.values(value).forEach((entry) => walk(entry, depth + 1));
  };
  walk(data, 0);
  return out;
}

/* ------------------------------- streaming ------------------------------ */

async function readSSE(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const payload = chunk.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (!payload) continue;
      let event;
      try { event = JSON.parse(payload); } catch { continue; }
      onEvent(event);
    }
  }
}

function setBusy(busy) {
  AI.streaming = busy;
  const send = $('#ai-send');
  const stop = $('#ai-stop');
  if (send) send.disabled = busy;
  if (stop) stop.hidden = !busy;
  hint(busy ? 'Streaming… press Stop to cancel.' : 'Cascade AI can create documents, decks, sheets, sites and video projects through MCP tools.');
}

async function startStream(body, options = {}) {
  if (AI.streaming) return;
  if (options.regenerateOf) {
    const index = AI.messages.findIndex((m) => m.id === options.regenerateOf);
    if (index >= 0) AI.messages = AI.messages.slice(0, index);
    renderChat();
  }
  setBusy(true);
  AI.controller = new AbortController();
  let conversationId = AI.activeId;
  let assistant = null;
  let el = null;
  const pendingRender = throttle(() => { if (el && assistant) { updateMessageEl(el, assistant); scrollIfNeeded(); } }, 110);
  const upsertAndRender = () => { if (el && assistant) { updateMessageEl(el, assistant); scrollIfNeeded(); } };
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ ...body, conversationId }),
      signal: AI.controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    await readSSE(res, (event) => {
      switch (event.type) {
        case 'meta': {
          if (!conversationId) {
            conversationId = event.conversationId;
            AI.activeId = conversationId;
            history.replaceState(null, '', `/ai/${conversationId}`);
          }
          if (event.providerId) AI.providerId = event.providerId;
          if (event.model) AI.model = event.model;
          syncControls();
          break;
        }
        case 'user':
          if (event.message) {
            AI.messages.push(event.message);
            AI.leafId = event.message.id;
            appendMessageEl(event.message);
            scrollIfNeeded(true);
            if (AI.current) setTitle(AI.current.title);
          }
          break;
        case 'assistant_start':
          if (event.message) {
            assistant = event.message;
            AI.messages.push(assistant);
            AI.leafId = assistant.id;
            el = appendMessageEl(assistant);
            AI.streamEl = el;
            AI.streamMsg = assistant;
            scrollIfNeeded(true);
          }
          if (event.conversation) mergeConversation(event.conversation);
          break;
        case 'delta':
          if (assistant) { assistant.content += event.text; pendingRender(); }
          break;
        case 'tool_start':
          if (assistant) { upsertTool(assistant, { id: event.id, name: event.name, arguments: event.arguments, pending: false }); upsertAndRender(); }
          break;
        case 'tool_result':
          if (assistant) { upsertTool(assistant, { id: event.id, name: event.name, result: event.result, isError: event.isError, data: event.data, pending: false }); upsertAndRender(); }
          break;
        case 'confirmation_required':
          if (assistant) {
            assistant.status = 'pending';
            (event.calls || []).forEach((call) => upsertTool(assistant, { ...call, pending: true }));
            upsertAndRender();
          }
          break;
        case 'search':
          if (assistant) { assistant.search = { provider: event.provider, results: event.results || [] }; upsertAndRender(); }
          break;
        case 'notice':
          if (event.message) hint(event.message, false);
          break;
        case 'usage':
          if (assistant) { assistant.usage = event.usage || {}; upsertAndRender(); }
          break;
        case 'done':
          if (assistant && event.message) {
            Object.assign(assistant, event.message);
            assistant.content = event.message.content;
            if (event.message.usage) assistant.usage = event.message.usage;
            assistant.status = event.message.status === 'pending' ? 'pending' : 'complete';
            upsertAndRender();
            AI.leafId = event.message.id || AI.leafId;
          }
          if (event.conversation) {
            mergeConversation(event.conversation);
            setTitle(event.conversation.title);
            if (event.conversation.thinking) AI.thinking = event.conversation.thinking;
            if (event.conversation.effort) AI.effort = event.conversation.effort;
            syncControls();
          }
          break;
        case 'error':
          throw new Error(event.message || 'Generation failed');
      }
    });
    pendingRender.cancel();
    if (assistant) {
      if (assistant.status === 'streaming') assistant.status = 'complete';
      if (el) updateMessageEl(el, assistant);
    }
    AI.streamEl = null;
    AI.streamMsg = null;
    setBusy(false);
    if (conversationId) await refreshConversations();
    if (conversationId && !(assistant && assistant.status === 'pending')) await reloadActiveConversation();
    renderSidebar();
    scrollIfNeeded();
  } catch (err) {
    pendingRender.cancel();
    AI.streamEl = null;
    AI.streamMsg = null;
    setBusy(false);
    const aborted = err.name === 'AbortError';
    if (assistant) {
      assistant.status = aborted ? 'complete' : 'error';
      if (!aborted) assistant.error = err.message;
      if (el) updateMessageEl(el, assistant);
    } else {
      const chat = $('#ai-chat');
      if (chat) {
        const note = document.createElement('div');
        note.className = 'ai-error-note';
        note.textContent = aborted ? 'Stopped.' : err.message;
        note.style.maxWidth = '880px';
        note.style.margin = '0 auto 16px';
        chat.append(note);
      }
    }
    if (!aborted) hint(err.message, true);
    if (conversationId) refreshConversations().then(renderSidebar);
  } finally {
    AI.controller = null;
    setBusy(false);
  }
}

async function continueTools(msg, approvals) {
  if (AI.streaming) return;
  setBusy(true);
  AI.controller = new AbortController();
  const el = $(`.ai-msg[data-id="${msg.id}"]`);
  const pendingRender = throttle(() => { if (el) { updateMessageEl(el, msg); scrollIfNeeded(); } }, 110);
  try {
    const res = await fetch('/api/ai/tool-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ messageId: msg.id, approvals }),
      signal: AI.controller.signal,
    });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Request failed (${res.status})`); }
    msg.status = 'streaming';
    msg.toolCalls = (msg.toolCalls || []).map((call) => approvals.includes(call.id) ? { ...call, pending: false, result: 'Running…' } : call);
    if (el) updateMessageEl(el, msg);
    await readSSE(res, (event) => {
      switch (event.type) {
        case 'tool_start':
          upsertTool(msg, { id: event.id, name: event.name, arguments: event.arguments, pending: false });
          if (el) updateMessageEl(el, msg);
          break;
        case 'tool_result':
          upsertTool(msg, { id: event.id, name: event.name, result: event.result, isError: event.isError, data: event.data, pending: false });
          if (el) updateMessageEl(el, msg);
          break;
        case 'delta':
          msg.content += event.text;
          pendingRender();
          break;
        case 'confirmation_required':
          msg.status = 'pending';
          (event.calls || []).forEach((call) => upsertTool(msg, { ...call, pending: true }));
          if (el) updateMessageEl(el, msg);
          break;
        case 'usage':
          msg.usage = event.usage || {};
          if (el) updateMessageEl(el, msg);
          break;
        case 'done':
          if (event.message) Object.assign(msg, event.message);
          msg.status = event.pending ? 'pending' : 'complete';
          if (el) updateMessageEl(el, msg);
          break;
        case 'error':
          throw new Error(event.message || 'Tool run failed');
      }
    });
    pendingRender.cancel();
    if (msg.status === 'streaming') msg.status = 'complete';
    if (el) updateMessageEl(el, msg);
    await refreshConversations();
    setBusy(false);
    if (!msg.status || msg.status !== 'pending') await reloadActiveConversation();
  } catch (err) {
    pendingRender.cancel();
    msg.status = 'error';
    msg.error = err.message;
    if (el) updateMessageEl(el, msg);
    hint(err.message, true);
  } finally {
    AI.controller = null;
    setBusy(false);
  }
}

/* -------------------------------- composer ------------------------------ */

function autoGrow(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(220, input.scrollHeight)}px`;
}

function renderAttachments() {
  const wrap = $('#ai-attachments');
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.hidden = AI.attachments.length === 0;
  AI.attachments.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'ai-attach';
    if (file.type === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(file.filename)) {
      const img = document.createElement('img');
      img.src = `/f/${file.id}/raw`;
      img.alt = file.filename;
      chip.append(img);
    }
    const b = document.createElement('b');
    b.textContent = file.filename;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.innerHTML = icon('x'); remove.setAttribute('aria-label', `Remove ${file.filename}`);
    remove.addEventListener('click', () => { AI.attachments.splice(index, 1); renderAttachments(); });
    chip.append(b, remove);
    wrap.append(chip);
  });
  refreshIcons(wrap);
}

async function uploadFiles(files) {
  const list = [...files].slice(0, 8);
  if (!list.length) return;
  const form = new FormData();
  list.forEach((file) => form.append('files', file));
  hint('Uploading…');
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form, credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    (data.files || []).forEach((file) => {
      if (file.error) { hint(`${file.filename}: ${file.error}`, true); return; }
      AI.attachments.push({ id: file.id, filename: file.filename, type: /\.(png|jpe?g|gif|webp)$/i.test(file.filename) ? 'image' : 'file' });
    });
    renderAttachments();
    hint('Attached. Images are understood by vision models; documents are extracted and analysed.');
  } catch (err) { hint(err.message, true); }
}

function sendCurrent() {
  if (AI.streaming) return;
  const input = $('#ai-input');
  const text = input ? input.value.trim() : '';
  if (!text && !AI.attachments.length) return;
  const payload = {
    message: text,
    parentId: AI.leafId,
    attachments: AI.attachments.map((file) => file.id),
    assistantId: AI.assistantId || null,
    providerId: AI.providerId || null,
    model: AI.model || null,
    useTools: AI.useTools,
    useWeb: AI.useWeb,
    thinking: AI.thinking,
    effort: AI.effort,
    knowledgeIds: [...AI.knowledgeIds],
  };
  if (input) { input.value = ''; autoGrow(input); }
  AI.attachments = [];
  renderAttachments();
  hint('Thinking…');
  startStream(payload);
}

/* --------------------------------- voice -------------------------------- */

function speakText(text, button) {
  const clean = String(text || '').replace(/```[\s\S]*?```/g, ' code block ').replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 3000);
  if (!clean) return;
  if (AI.speaking) { stopSpeech(); if (button) button.textContent = 'Speak'; return; }
  AI.speaking = true;
  if (button) button.textContent = 'Loading…';
  fetch('/api/ai/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ text: clean }),
  }).then(async (res) => {
    if (!res.ok) throw new Error('no server speech');
    const blob = await res.blob();
    AI.audioUrl = URL.createObjectURL(blob);
    AI.audio = new Audio(AI.audioUrl);
    AI.audio.addEventListener('ended', () => { AI.speaking = false; if (button) button.textContent = 'Speak'; });
    await AI.audio.play();
    if (button) button.textContent = 'Stop';
  }).catch(() => {
    if (!('speechSynthesis' in window)) { AI.speaking = false; hint('No speech provider is configured and this browser cannot synthesize speech.', true); if (button) button.textContent = 'Speak'; return; }
    const utter = new SpeechSynthesisUtterance(clean.slice(0, 800));
    utter.onend = () => { AI.speaking = false; if (button) button.textContent = 'Speak'; };
    window.speechSynthesis.speak(utter);
    if (button) button.textContent = 'Stop';
  });
}

function stopSpeech() {
  AI.speaking = false;
  if (AI.audio) { try { AI.audio.pause(); } catch { /* noop */ } AI.audio = null; }
  if (AI.audioUrl) { URL.revokeObjectURL(AI.audioUrl); AI.audioUrl = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function startVoice(input) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { hint('Voice input needs a Chromium-based browser or Safari.', true); return; }
  const recognition = new Recognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  const base = input.value;
  const mic = $('#ai-mic');
  if (mic) mic.classList.add('is-on');
  hint('Listening…');
  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
    input.value = `${base}${base && !base.endsWith(' ') ? ' ' : ''}${transcript}`;
    autoGrow(input);
  };
  recognition.onerror = (event) => hint(`Voice input error: ${event.error}`, true);
  recognition.onend = () => { if (mic) mic.classList.remove('is-on'); hint('Voice input stopped.'); };
  recognition.start();
}

/* --------------------------------- images ------------------------------- */

function openImageDialog() {
  const dialog = $('#ai-image-dlg');
  if (!dialog) return;
  $('#ai-image-status').textContent = '';
  if (!dialog.open) dialog.showModal();
}

async function generateImage() {
  const prompt = $('#ai-image-prompt').value.trim();
  const size = $('#ai-image-size').value;
  const count = Math.max(1, Math.min(4, Number($('#ai-image-count').value) || 1));
  const editFile = $('#ai-image-edit').files[0];
  const status = $('#ai-image-status');
  const button = $('#ai-image-run');
  if (!prompt) { status.textContent = 'Write a prompt first.'; return; }
  button.disabled = true; status.textContent = 'Generating…';
  try {
    let data;
    if (editFile) {
      const form = new FormData();
      form.append('prompt', prompt);
      form.append('size', size);
      form.append('image', editFile);
      const res = await fetch('/api/ai/images/edit', { method: 'POST', body: form, credentials: 'same-origin' });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Image edit failed');
    } else {
      data = await api('/api/ai/images/generate', { method: 'POST', body: JSON.stringify({ prompt, size, count }) });
    }
    renderImageResults(data.images || []);
    status.textContent = data.images && data.images.length ? `Saved ${data.images.length} image${data.images.length === 1 ? '' : 's'} to Cascade Files.` : 'The provider returned no images.';
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

function renderImageResults(images) {
  const wrap = $('#ai-image-results');
  wrap.innerHTML = '';
  images.forEach((image) => {
    const card = document.createElement('div');
    card.className = 'ai-image-card';
    const img = document.createElement('img');
    img.src = image.dataUrl || (image.id ? `/f/${image.id}/raw` : '');
    img.alt = image.filename || 'Generated image';
    const row = document.createElement('div');
    const open = document.createElement('a');
    open.href = image.url || `/f/${image.id}`;
    open.textContent = 'Open';
    open.target = '_blank'; open.rel = 'noopener noreferrer';
    const use = document.createElement('a');
    use.href = '#';
    use.textContent = 'Attach';
    use.addEventListener('click', (event) => {
      event.preventDefault();
      AI.attachments.push({ id: image.id, filename: image.filename || 'image.png', type: 'image' });
      renderAttachments();
      hint('Image attached to the next message.');
      $('#ai-image-dlg').close();
    });
    row.append(open, use);
    card.append(img, row);
    wrap.append(card);
  });
}

/* ------------------------------- knowledge ------------------------------ */

function openKnowledgeDialog() {
  const dialog = $('#ai-knowledge-dlg');
  if (!dialog) return;
  renderKnowledgeList();
  renderKnowledgeDetail();
  if (!dialog.open) dialog.showModal();
}

function renderKnowledgeList() {
  const list = $('#ai-kb-list');
  if (!list) return;
  list.innerHTML = '';
  if (!AI.knowledge.length) {
    const p = document.createElement('p'); p.className = 'ai-fine'; p.textContent = 'No knowledge bases yet. Create one to index notes, PDFs and text.';
    list.append(p);
    return;
  }
  AI.knowledge.forEach((base) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `ai-kb-item${AI.kbSelected === base.id ? ' is-active' : ''}`;
    item.innerHTML = `<b>${escapeHtml(base.name)}</b><span>${base.documentCount || 0} document${base.documentCount === 1 ? '' : 's'}</span>`;
    item.addEventListener('click', () => { AI.kbSelected = base.id; renderKnowledgeList(); renderKnowledgeDetail(); });
    list.append(item);
  });
}

async function refreshKnowledge() {
  try {
    const data = await api('/api/ai/knowledge');
    AI.knowledge = data.knowledge || [];
    AI.knowledgeDocs = data.documents || [];
  } catch { /* keep cached */ }
}

function renderKnowledgeDetail() {
  const detail = $('#ai-kb-detail');
  if (!detail) return;
  const base = AI.knowledge.find((k) => k.id === AI.kbSelected);
  if (!base) { detail.innerHTML = '<p class="ai-fine">Select a knowledge base to add documents.</p>'; return; }
  const docs = AI.knowledgeDocs.filter((doc) => doc.knowledgeId === base.id);
  detail.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'ai-row';
  head.innerHTML = `<h3>${escapeHtml(base.name)}</h3><span class="ai-spacer"></span><button type="button" class="ai-btn ai-btn-sm ai-btn-danger" data-kb-delete>Delete base</button>`;
  head.querySelector('[data-kb-delete]').addEventListener('click', async () => {
    if (!confirm(`Delete knowledge base "${base.name}" and its documents?`)) return;
    try { await api(`/api/ai/knowledge/${base.id}`, { method: 'DELETE' }); AI.knowledge = AI.knowledge.filter((k) => k.id !== base.id); AI.knowledgeIds.delete(base.id); AI.kbSelected = null; renderKnowledgeList(); renderKnowledgeDetail(); syncControls(); }
    catch (err) { hint(err.message, true); }
  });
  const toggle = document.createElement('label');
  toggle.className = 'ai-row';
  toggle.style.fontSize = '11.5px';
  const check = document.createElement('input');
  check.type = 'checkbox'; check.checked = AI.knowledgeIds.has(base.id);
  check.addEventListener('change', () => { if (check.checked) AI.knowledgeIds.add(base.id); else AI.knowledgeIds.delete(base.id); syncControls(); });
  toggle.append(check, document.createTextNode('Use this knowledge base in chat'));
  const addRow = document.createElement('div');
  addRow.className = 'ai-row';
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = '.txt,.md,.csv,.json,.pdf,.html,.js,.ts,.py,.docx';
  fileInput.style.maxWidth = '220px';
  const addFile = document.createElement('button');
  addFile.type = 'button'; addFile.className = 'ai-btn ai-btn-sm'; addFile.textContent = 'Add file';
  addFile.addEventListener('click', async () => {
    if (!fileInput.files[0]) { hint('Choose a file first.', true); return; }
    addFile.disabled = true; hint('Indexing…');
    try {
      const form = new FormData(); form.append('files', fileInput.files[0]);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: form, credentials: 'same-origin' });
      const upload = await uploadRes.json();
      const file = (upload.files || [])[0];
      if (!file || file.error) throw new Error(file?.error || 'Upload failed');
      const result = await api(`/api/ai/knowledge/${base.id}/docs`, { method: 'POST', body: JSON.stringify({ fileId: file.id }) });
      hint(result.warning || `Indexed ${result.document.chunks} chunks.`);
      await refreshKnowledge();
      renderKnowledgeList(); renderKnowledgeDetail();
    } catch (err) { hint(err.message, true); }
    finally { addFile.disabled = false; }
  });
  addRow.append(fileInput, addFile);
  const note = document.createElement('textarea');
  note.rows = 3;
  note.placeholder = 'Or paste text to index…';
  note.style.cssText = 'border:1px solid var(--ai-line);background:var(--ai-panel-2);border-radius:6px;padding:6px 8px;font-size:12px;resize:vertical;width:100%;min-height:64px';
  const addNote = document.createElement('button');
  addNote.type = 'button'; addNote.className = 'ai-btn ai-btn-sm'; addNote.textContent = 'Index text';
  addNote.addEventListener('click', async () => {
    if (!note.value.trim()) return;
    addNote.disabled = true; hint('Indexing…');
    try {
      const result = await api(`/api/ai/knowledge/${base.id}/docs`, { method: 'POST', body: JSON.stringify({ text: note.value, filename: 'note.txt' }) });
      hint(result.warning || `Indexed ${result.document.chunks} chunks.`);
      note.value = '';
      await refreshKnowledge();
      renderKnowledgeList(); renderKnowledgeDetail();
    } catch (err) { hint(err.message, true); }
    finally { addNote.disabled = false; }
  });
  const docsWrap = document.createElement('div');
  docsWrap.className = 'ai-kb-docs';
  if (!docs.length) docsWrap.innerHTML = '<p class="ai-fine">No documents indexed yet.</p>';
  docs.forEach((doc) => {
    const row = document.createElement('div');
    row.className = 'ai-kb-doc';
    row.innerHTML = `<b>${escapeHtml(doc.filename)}</b><span>${doc.status}</span>`;
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'ai-btn ai-btn-sm ai-btn-danger'; del.innerHTML = icon('x'); del.title = 'Remove document'; del.setAttribute('aria-label', 'Remove document');
    del.addEventListener('click', async () => {
      try { await api(`/api/ai/knowledge/${base.id}/docs/${doc.id}`, { method: 'DELETE' }); await refreshKnowledge(); renderKnowledgeList(); renderKnowledgeDetail(); }
      catch (err) { hint(err.message, true); }
    });
    row.append(del);
    docsWrap.append(row);
  });
  const searchRow = document.createElement('div');
  searchRow.className = 'ai-inline';
  const searchInput = document.createElement('input');
  searchInput.placeholder = 'Test retrieval…';
  const searchBtn = document.createElement('button');
  searchBtn.type = 'button'; searchBtn.className = 'ai-btn ai-btn-sm'; searchBtn.textContent = 'Search';
  const results = document.createElement('div');
  results.className = 'ai-kb-docs';
  searchBtn.addEventListener('click', async () => {
    if (!searchInput.value.trim()) return;
    results.innerHTML = '<p class="ai-fine">Searching…</p>';
    try {
      const data = await api(`/api/ai/knowledge/${base.id}/search`, { method: 'POST', body: JSON.stringify({ query: searchInput.value }) });
      results.innerHTML = (data.hits || []).map((hit) => `<div class="ai-kb-doc"><b>${escapeHtml(hit.filename || 'document')}</b><span>${(hit.score || 0).toFixed(2)}</span></div><p class="ai-fine">${escapeHtml(String(hit.text || '').slice(0, 220))}</p>`).join('') || '<p class="ai-fine">No matches.</p>';
    } catch (err) { results.innerHTML = `<p class="ai-fine">${escapeHtml(err.message)}</p>`; }
  });
  searchRow.append(searchInput, searchBtn);
  const noteRow = document.createElement('div');
  noteRow.className = 'ai-row';
  noteRow.append(addNote);
  const heading = document.createElement('div');
  heading.className = 'ai-fine';
  heading.textContent = 'Indexed documents';
  detail.append(head, toggle, addRow, note, noteRow, heading, docsWrap, searchRow, results);
  refreshIcons(detail);
}

/* ------------------------------- assistants ----------------------------- */

function openAssistantDialog() {
  const dialog = $('#ai-assistant-dlg');
  if (!dialog) return;
  renderAssistantList(); renderAssistantDetail();
  if (!dialog.open) dialog.showModal();
}

function renderAssistantList() {
  const list = $('#ai-assistant-list');
  if (!list) return;
  list.innerHTML = '';
  if (!AI.assistants.length) list.innerHTML = '<p class="ai-fine">No assistants yet. Create one with custom instructions.</p>';
  AI.assistants.forEach((assistant) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `ai-kb-item${AI.asstSelected === assistant.id ? ' is-active' : ''}`;
    item.innerHTML = `<b>${icon('bot')} ${escapeHtml(assistant.name)}</b><span>${escapeHtml(assistant.description || assistant.model || 'custom instructions')}</span>`;
    item.addEventListener('click', () => { AI.asstSelected = assistant.id; renderAssistantList(); renderAssistantDetail(); });
    list.append(item);
  });
  refreshIcons(list);
}

function renderAssistantDetail() {
  const detail = $('#ai-assistant-detail');
  if (!detail) return;
  const assistant = AI.assistants.find((a) => a.id === AI.asstSelected);
  if (!assistant) { detail.innerHTML = '<p class="ai-fine">Select an assistant to edit its instructions.</p>'; return; }
  detail.innerHTML = `
    <label class="ai-field"><span>Name</span><input data-as="name" value="${escapeHtml(assistant.name)}"></label>
    <label class="ai-field"><span>Description</span><input data-as="description" value="${escapeHtml(assistant.description || '')}"></label>
    <label class="ai-field"><span>System prompt</span><textarea data-as="systemPrompt" rows="7">${escapeHtml(assistant.systemPrompt || '')}</textarea></label>
    <div class="ai-grid-2">
      <label class="ai-field"><span>Model override</span><input data-as="model" value="${escapeHtml(assistant.model || '')}" placeholder="provider default"></label>
      <label class="ai-field"><span>Temperature</span><input data-as="temperature" type="number" min="0" max="2" step="0.1" value="${assistant.temperature == null ? '' : assistant.temperature}"></label>
    </div>
    <label class="ai-row" style="font-size:11.5px"><input type="checkbox" data-as="toolsEnabled" ${assistant.toolsEnabled === false ? '' : 'checked'}> Allow tool calls</label>
    <div class="ai-field"><span>Knowledge bases</span><div data-as="knowledge" class="ai-kb-list"></div></div>`;
  const kbWrap = detail.querySelector('[data-as="knowledge"]');
  AI.knowledge.forEach((base) => {
    const label = document.createElement('label');
    label.className = 'ai-row';
    label.style.fontSize = '11.5px';
    const check = document.createElement('input');
    check.type = 'checkbox'; check.value = base.id;
    check.checked = (assistant.knowledgeIds || []).includes(base.id);
    label.append(check, document.createTextNode(base.name));
    kbWrap.append(label);
  });
  const actions = document.createElement('div');
  actions.className = 'ai-row';
  const save = document.createElement('button');
  save.type = 'button'; save.className = 'ai-btn ai-btn-primary'; save.textContent = 'Save assistant';
  save.addEventListener('click', async () => {
    const payload = {
      name: detail.querySelector('[data-as="name"]').value.trim(),
      description: detail.querySelector('[data-as="description"]').value,
      systemPrompt: detail.querySelector('[data-as="systemPrompt"]').value,
      model: detail.querySelector('[data-as="model"]').value.trim(),
      temperature: detail.querySelector('[data-as="temperature"]').value === '' ? null : Number(detail.querySelector('[data-as="temperature"]').value),
      toolsEnabled: detail.querySelector('[data-as="toolsEnabled"]').checked,
      knowledgeIds: $$('[data-as="knowledge"] input:checked', detail).map((input) => input.value),
    };
    if (!payload.name) { hint('Assistant name is required.', true); return; }
    save.disabled = true;
    try {
      const data = await api(`/api/ai/assistants/${assistant.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      const index = AI.assistants.findIndex((a) => a.id === assistant.id);
      AI.assistants[index] = data.assistant;
      renderAssistantList(); renderAssistantDetail(); syncControls();
      if (AI.assistantId === assistant.id) hint(`Updated ${data.assistant.name}.`);
    } catch (err) { hint(err.message, true); }
    finally { save.disabled = false; }
  });
  const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'ai-btn ai-btn-danger'; remove.textContent = 'Delete';
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete assistant "${assistant.name}"?`)) return;
    try {
      await api(`/api/ai/assistants/${assistant.id}`, { method: 'DELETE' });
      AI.assistants = AI.assistants.filter((a) => a.id !== assistant.id);
      if (AI.assistantId === assistant.id) AI.assistantId = '';
      AI.asstSelected = null;
      renderAssistantList(); renderAssistantDetail(); syncControls();
    } catch (err) { hint(err.message, true); }
  });
  actions.append(save, remove);
  detail.append(actions);
}

/* --------------------------------- usage -------------------------------- */

async function openUsage() {
  const dialog = $('#ai-usage-dlg');
  const body = $('#ai-usage-body');
  if (!dialog || !body) return;
  body.innerHTML = '<p class="ai-fine">Loading…</p>';
  dialog.showModal();
  try {
    const data = await api('/api/ai/usage');
    body.innerHTML = `
      <div class="ai-usage-grid">
        <div class="ai-stat"><b>${fmtTokens(data.today)}</b><span>tokens today</span></div>
        <div class="ai-stat"><b>${fmtTokens(data.totalTokens)}</b><span>tokens total</span></div>
        <div class="ai-stat"><b>${fmtTokens(data.totalCalls)}</b><span>API calls</span></div>
      </div>
      <p class="ai-fine">Daily limit: ${data.limit ? `${fmtTokens(data.limit)} tokens` : 'unlimited'}.</p>
      <div class="ai-usage-rows">
        ${(data.recent || []).map((row) => `<div><span>${escapeHtml(row.kind || row.model || 'chat')}</span><span>${escapeHtml(row.providerId || '')}</span><b>${fmtTokens(row.totalTokens)}</b></div>`).join('') || '<div>No usage recorded yet.</div>'}
      </div>`;
  } catch (err) { body.innerHTML = `<p class="ai-fine">${escapeHtml(err.message)}</p>`; }
}

/* ------------------------------ personal MCP ---------------------------- */

async function loadUserConfig() {
  try {
    const data = await api('/api/ai/user-config');
    if (data?.config) AI.userConfig = data.config;
    syncControls();
    return AI.userConfig;
  } catch (err) {
    hint(err.message, true);
    return AI.userConfig;
  }
}

function mcpServerRow(server, personal) {
  const row = document.createElement('div');
  row.className = 'ai-mcp-item';
  row.innerHTML = `${icon(personal ? 'server' : 'cloud')}
    <span class="ai-mcp-item-copy"><b>${escapeHtml(server.name)}</b><span>${escapeHtml(personal ? server.url : 'Shared by an administrator')}${personal && server.hasToken ? ' · token saved' : ''}</span><em>${server.enabled ? 'enabled' : 'disabled'}</em></span>`;
  if (!personal) return row;
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = server.enabled !== false;
  toggle.title = 'Enable this server';
  toggle.setAttribute('aria-label', `Enable ${server.name}`);
  toggle.addEventListener('change', () => savePersonalMcp((AI.userConfig.mcpServers || []).map((entry) => entry.id === server.id ? { ...entry, enabled: toggle.checked } : entry)));
  const test = document.createElement('button');
  test.type = 'button'; test.textContent = 'Test';
  test.addEventListener('click', async () => {
    test.disabled = true; test.textContent = 'Testing…';
    try {
      const data = await api('/api/ai/user-config/test-mcp', { method: 'POST', body: JSON.stringify({ id: server.id }) });
      test.textContent = `${data.tools.length} tools`;
    } catch (err) { test.textContent = 'Failed'; hint(err.message, true); }
    finally { test.disabled = false; }
  });
  const remove = document.createElement('button');
  remove.type = 'button'; remove.innerHTML = icon('trash-2'); remove.title = 'Remove server'; remove.setAttribute('aria-label', `Remove ${server.name}`);
  remove.addEventListener('click', () => savePersonalMcp((AI.userConfig.mcpServers || []).filter((entry) => entry.id !== server.id)));
  row.append(toggle, test, remove);
  return row;
}

function renderMcpDialog() {
  const globalList = $('#ai-mcp-global');
  const personalList = $('#ai-mcp-list');
  if (!globalList || !personalList) return;
  const globals = AI.userConfig?.globalMcpServers || [];
  const personal = AI.userConfig?.mcpServers || [];
  globalList.innerHTML = '';
  if (globals.length) {
    const title = document.createElement('div'); title.className = 'ai-mcp-section-title'; title.textContent = 'Shared servers';
    globalList.append(title, ...globals.map((server) => mcpServerRow(server, false)));
  }
  personalList.innerHTML = '';
  const title = document.createElement('div'); title.className = 'ai-mcp-section-title'; title.textContent = 'Your servers';
  personalList.append(title);
  if (!personal.length) {
    const empty = document.createElement('p'); empty.className = 'ai-fine'; empty.textContent = 'No personal servers yet. Add an MCP endpoint below.';
    personalList.append(empty);
  } else {
    personalList.append(...personal.map((server) => mcpServerRow(server, true)));
  }
  refreshIcons(personalList);
  refreshIcons(globalList);
  syncControls();
}

async function savePersonalMcp(servers) {
  const status = $('#ai-mcp-status');
  if (status) status.textContent = 'Saving…';
  try {
    const data = await api('/api/ai/user-config', {
      method: 'PUT',
      body: JSON.stringify({ mcpServers: servers.map((server) => ({ id: server.id, name: server.name, url: server.url, token: server.token || undefined, enabled: server.enabled !== false })) }),
    });
    AI.userConfig = data.config;
    renderMcpDialog();
    if (status) status.textContent = 'Saved.';
  } catch (err) {
    if (status) status.textContent = err.message;
    hint(err.message, true);
  }
}

async function openMcpDialog() {
  const dialog = $('#ai-mcp-dlg');
  if (!dialog) return;
  renderMcpDialog();
  if (!dialog.open) dialog.showModal();
  await loadUserConfig();
  renderMcpDialog();
}

/* -------------------------------- sidebar ------------------------------- */

function toggleSidebar() {
  const sidebar = $('#ai-sidebar');
  if (!sidebar) return;
  const open = !sidebar.classList.contains('is-open');
  sidebar.classList.toggle('is-open', open);
  const scrim = $('#ai-sidebar-scrim');
  if (scrim) scrim.hidden = !open;
}

function closeSidebar() {
  $('#ai-sidebar')?.classList.remove('is-open');
  const scrim = $('#ai-sidebar-scrim');
  if (scrim) scrim.hidden = true;
}

/* --------------------------------- events ------------------------------- */

function bindEvents() {
  const chat = $('#ai-chat');
  const input = $('#ai-input');
  const form = $('#ai-form');

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.ai-dd')) closeDropdowns();
    const menu = $('#ai-convo-menu');
    if (menu && !menu.hidden && !event.target.closest('#ai-convo-menu') && !event.target.closest('.ai-convo-more')) menu.hidden = true;
    const action = event.target.closest('[data-ai]');
    if (!action) return;
    const name = action.dataset.ai;
    if (name === 'new') newChat();
    else if (name === 'new-folder') {
      const folderName = prompt('Folder name');
      if (!folderName || !folderName.trim()) return;
      api('/api/ai/folders', { method: 'POST', body: JSON.stringify({ name: folderName.trim() }) })
        .then((data) => { AI.folders.push(data.folder); renderSidebar(); })
        .catch((err) => hint(err.message, true));
    } else if (name === 'toggle-side') toggleSidebar();
    else if (name === 'toggle-tools') { AI.useTools = !AI.useTools; syncControls(); }
    else if (name === 'toggle-web') { AI.useWeb = !AI.useWeb; syncControls(); }
    else if (name === 'attach') $('#ai-file-input')?.click();
    else if (name === 'mic') { if (input) startVoice(input); }
    else if (name === 'open-image') openImageDialog();
    else if (name === 'open-knowledge') { refreshKnowledge().then(openKnowledgeDialog); }
    else if (name === 'open-assistants') openAssistantDialog();
    else if (name === 'open-mcp') openMcpDialog();
    else if (name === 'open-usage') openUsage();
  });

  document.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('[data-close-dialog]');
    if (closeBtn) { closeBtn.closest('dialog')?.close(); return; }
    if (event.target.tagName === 'DIALOG') event.target.close();
  });

  if (form) form.addEventListener('submit', (event) => { event.preventDefault(); sendCurrent(); });

  if (input) {
    input.addEventListener('input', () => autoGrow(input));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendCurrent(); }
    });
  }

  $('#ai-stop')?.addEventListener('click', () => { AI.controller?.abort(); });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeDropdowns(); closeSidebar(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      newChat();
      $('#ai-input')?.focus();
    }
  });

  $('#ai-file-input')?.addEventListener('change', async (event) => {
    const files = event.target.files;
    event.target.value = '';
    if (files && files.length) await uploadFiles(files);
  });

  if (chat) {
    chat.addEventListener('dragover', (event) => { event.preventDefault(); });
    chat.addEventListener('drop', async (event) => {
      event.preventDefault();
      if (event.dataTransfer?.files?.length) await uploadFiles(event.dataTransfer.files);
    });
  }

  $('#ai-search')?.addEventListener('input', (event) => { AI.search = event.target.value; renderSidebar(); });

  $('#ai-provider')?.addEventListener('change', async (event) => {
    AI.providerId = event.target.value;
    AI.model = '';
    await loadModels(AI.providerId, false);
    renderModelOptions();
    if (AI.activeId) {
      api(`/api/ai/conversations/${AI.activeId}`, { method: 'PATCH', body: JSON.stringify({ providerId: AI.providerId, model: AI.model || null }) })
        .then((data) => mergeConversation(data.conversation)).catch(() => {});
    }
  });

  $('#ai-model')?.addEventListener('change', (event) => {
    AI.model = event.target.value;
    syncControls();
    if (AI.activeId) {
      api(`/api/ai/conversations/${AI.activeId}`, { method: 'PATCH', body: JSON.stringify({ model: AI.model }) })
        .then((data) => mergeConversation(data.conversation)).catch(() => {});
    }
  });

  $('#ai-thinking')?.addEventListener('change', (event) => savePreference('thinking', event.target.value));
  $('#ai-effort')?.addEventListener('change', (event) => savePreference('effort', event.target.value));

  $('#ai-assistant')?.addEventListener('change', async (event) => {
    AI.assistantId = event.target.value;
    const assistant = AI.assistants.find((a) => a.id === AI.assistantId);
    if (assistant?.providerId) { AI.providerId = assistant.providerId; renderProviderOptions(); await loadModels(AI.providerId, true); }
    if (assistant?.model) { AI.model = assistant.model; renderModelOptions(); }
    if (AI.activeId) {
      api(`/api/ai/conversations/${AI.activeId}`, { method: 'PATCH', body: JSON.stringify({ assistantId: AI.assistantId || null }) })
        .then((data) => mergeConversation(data.conversation)).catch(() => {});
    }
  });

  $('#ai-kb-create')?.addEventListener('click', async () => {
    const name = $('#ai-kb-name').value.trim();
    if (!name) return;
    try {
      const data = await api('/api/ai/knowledge', { method: 'POST', body: JSON.stringify({ name }) });
      AI.knowledge.push(data.knowledge);
      $('#ai-kb-name').value = '';
      AI.kbSelected = data.knowledge.id;
      renderKnowledgeList(); renderKnowledgeDetail();
    } catch (err) { hint(err.message, true); }
  });

  $('#ai-assistant-create')?.addEventListener('click', async () => {
    const name = $('#ai-assistant-name').value.trim();
    if (!name) return;
    try {
      const data = await api('/api/ai/assistants', { method: 'POST', body: JSON.stringify({ name }) });
      AI.assistants.push(data.assistant);
      $('#ai-assistant-name').value = '';
      AI.asstSelected = data.assistant.id;
      renderAssistantList(); renderAssistantDetail(); syncControls();
    } catch (err) { hint(err.message, true); }
  });

  $('#ai-image-run')?.addEventListener('click', generateImage);

  $('#ai-mcp-add')?.addEventListener('click', async () => {
    const name = $('#ai-mcp-name')?.value.trim();
    const url = $('#ai-mcp-url')?.value.trim();
    const token = $('#ai-mcp-token')?.value || '';
    const status = $('#ai-mcp-status');
    if (!name || !url) { if (status) status.textContent = 'Name and endpoint URL are required.'; return; }
    await savePersonalMcp([...(AI.userConfig.mcpServers || []), { name, url, token, enabled: true }]);
    if ($('#ai-mcp-status')?.textContent === 'Saved.') {
      $('#ai-mcp-name').value = ''; $('#ai-mcp-url').value = ''; $('#ai-mcp-token').value = '';
    }
  });

  // Auto-select a sane provider/model on first load.
  const conv = currentConvo();
  AI.providerId = conv?.providerId || AI.ai.defaultProviderId || AI.providers.find((p) => p.hasKey)?.id || AI.providers[0]?.id || '';
  AI.model = conv?.model || AI.ai.defaultModel || '';
  AI.assistantId = conv?.assistantId || '';
  AI.thinking = conv?.thinking || AI.userConfig?.thinking || 'auto';
  AI.effort = conv?.effort || AI.userConfig?.effort || 'auto';
  renderProviderOptions();
  const initialModels = (AI.providers.find((p) => p.id === AI.providerId)?.models || []);
  AI.models = initialModels;
  if (!AI.model && initialModels.length) AI.model = modelId(initialModels[0]);
  renderModelOptions();
  syncControls();
  if (!initialModels.length && AI.providerId) loadModels(AI.providerId, false);
}

async function init() {
  enhanceSelects();
  bindEvents();
  renderSidebar();
  if (AI.activeId) {
    const loading = $('#ai-loading');
    if (loading) loading.hidden = false;
    await openConversation(AI.activeId);
    if (loading) loading.hidden = true;
  } else {
    setTitle('New chat');
    renderChat();
  }
  $('#ai-input')?.focus();
}

init();
