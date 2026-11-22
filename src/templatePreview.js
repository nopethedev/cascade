import { computeSheet } from './formula.js';
import { renderSiteBody, siteCss } from '../public/site-render.mjs';

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const color = (value, fallback) => {
  const v = String(value || '');
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i.test(v)) return v;
  return fallback;
};

const imageSrc = (src) => {
  const value = String(src || '');
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value)) return value;
  if (/^\/f\/[A-Za-z0-9_-]+\/raw$/.test(value)) return value;
  if (/^\/raw\/[A-Za-z0-9_-]+$/.test(value)) return value;
  return '';
};

function documentPreview(content) {
  const html = String(content.html || '<p>Empty document</p>');
  return `<div class="doc-preview">${content.header ? `<div class="doc-hf">${esc(content.header)}</div>` : ''}${html}${content.footer ? `<div class="doc-hf">${esc(content.footer)}</div>` : ''}</div>`;
}

function sheetPreview(content) {
  const sheet = (content.sheets || [])[content.active || 0] || (content.sheets || [])[0] || { cells: {}, rows: 12, cols: 6 };
  const values = computeSheet(sheet);
  const cells = sheet.cells || {};
  const rows = Math.min(14, Math.max(6, Number(sheet.rows) || 12));
  const cols = Math.min(8, Math.max(4, Number(sheet.cols) || 8));
  const colName = (i) => {
    let s = '';
    let n = i + 1;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  let table = '<table class="sheet-preview"><thead><tr><th></th>';
  for (let c = 0; c < cols; c++) table += `<th>${colName(c)}</th>`;
  table += '</tr></thead><tbody>';
  for (let r = 1; r <= rows; r++) {
    table += `<tr><th>${r}</th>`;
    for (let c = 0; c < cols; c++) {
      const ref = `${colName(c)}${r}`;
      const value = values[ref] ?? cells[ref]?.v ?? '';
      const style = [
        cells[ref]?.b ? 'font-weight:700' : '',
        cells[ref]?.i ? 'font-style:italic' : '',
        cells[ref]?.fill ? `background:${color(cells[ref].fill, 'transparent')}` : '',
        cells[ref]?.color ? `color:${color(cells[ref].color, 'inherit')}` : '',
      ].filter(Boolean).join(';');
      table += `<td${style ? ` style="${style}"` : ''}>${esc(value)}</td>`;
    }
    table += '</tr>';
  }
  return `${table}</tbody>${(content.sheets || []).length > 1 ? `<div class="sheet-tabs">${(content.sheets || []).map((s, i) => `<span class="${i === (content.active || 0) ? 'on' : ''}">${esc(s.name || `Sheet${i + 1}`)}</span>`).join('')}</div>` : ''}`;
}

function deckPreview(content) {
  const slide = (content.slides || [])[0] || { elements: [], bg: '#101014' };
  const w = Math.max(320, num(content.w, 1280));
  const h = Math.max(180, num(content.h, 720));
  const parts = (slide.elements || []).map((e) => {
    const x = num(e.x);
    const y = num(e.y);
    const ew = Math.max(1, num(e.w, 1));
    const eh = Math.max(1, num(e.h, 1));
    const base = `left:${(x / w) * 100}%;top:${(y / h) * 100}%;width:${(ew / w) * 100}%;height:${(eh / h) * 100}%`;
    if (e.type === 'text') {
      return `<div class="dp-el" style="${base};color:${color(e.color, '#f4f4f5')};font-size:${Math.max(4, (num(e.size, 28) / w) * 100 * 9.5)}px;font-weight:${e.bold ? 700 : 400};text-align:${['left', 'center', 'right'].includes(e.align) ? e.align : 'left'};white-space:pre-wrap">${esc(e.text)}</div>`;
    }
    if (e.type === 'rect') return `<div class="dp-el" style="${base};background:${color(e.fill, '#e11d48')};border-radius:${Math.max(0, Math.min(40, num(e.radius)))}px"></div>`;
    if (e.type === 'image') {
      const src = imageSrc(e.src);
      return src ? `<div class="dp-el" style="${base};overflow:hidden"><img src="${esc(src)}" alt="${esc(e.alt || '')}" style="width:100%;height:100%;object-fit:cover"></div>` : '';
    }
    return '';
  }).join('');
  const transition = slide.transition || 'fade';
  return `<div class="deck-preview" style="aspect-ratio:${w}/${h}"><div class="dp-slide dp-in-${esc(transition)}" style="background:${color(slide.bg, '#101014')}">${parts}</div></div>${(content.slides || []).length > 1 ? `<div class="dp-count">${(content.slides || []).length} slides</div>` : ''}`;
}

function boardPreview(content) {
  const els = content.elements || [];
  const maxX = Math.max(900, ...els.map((e) => num(e.x) + num(e.w, 0) + 80));
  const maxY = Math.max(560, ...els.map((e) => num(e.y) + num(e.h, 0) + 80));
  const parts = els.map((e) => {
    const base = `left:${(num(e.x) / maxX) * 100}%;top:${(num(e.y) / maxY) * 100}%;width:${(Math.max(20, num(e.w, 20)) / maxX) * 100}%;height:${(Math.max(20, num(e.h, 20)) / maxY) * 100}%`;
    if (e.type === 'sticky') return `<div class="bp-sticky" style="${base};background:${color(e.color, '#fde68a')}">${esc(e.text)}</div>`;
    if (e.type === 'rect') return `<div class="bp-el" style="${base};background:${color(e.color, '#27272a')}"></div>`;
    if (e.type === 'ellipse') return `<div class="bp-el" style="${base};background:${color(e.color, '#27272a')};border-radius:50%"></div>`;
    if (e.type === 'text') return `<div class="bp-text" style="${base};color:${color(e.color, '#f4f4f5')};font-size:${Math.max(7, (num(e.size, 20) / maxX) * 100 * 5.4)}px">${esc(e.text)}</div>`;
    if (e.type === 'path') {
      const points = (e.points || []).map((p) => `${(num(p[0]) / maxX) * 1000},${(num(p[1]) / maxY) * 620}`).join(' ');
      return `<svg class="bp-path" viewBox="0 0 1000 620" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="${color(e.color, '#e11d48')}" stroke-width="${Math.max(1, num(e.width, 3))}" stroke-linecap="round"/></svg>`;
    }
    return '';
  }).join('');
  return `<div class="board-preview">${parts}</div>`;
}

function formPreview(content) {
  const fields = (content.fields || []).slice(0, 7).map((f) => {
    if (f.type === 'textarea') return `<label class="fp-label">${esc(f.label)}</label><div class="fp-area"></div>`;
    if (f.type === 'radio' || f.type === 'select' || f.type === 'checkbox') {
      return `<label class="fp-label">${esc(f.label)}</label><div class="fp-options">${(f.options || []).slice(0, 4).map((o) => `<span class="fp-option"><i></i>${esc(o)}</span>`).join('') || '<span class="fp-option"><i></i>Option</span>'}</div>`;
    }
    return `<label class="fp-label">${esc(f.label)}</label><div class="fp-input"></div>`;
  }).join('');
  return `<div class="form-preview"><strong>${esc(content.title || 'Untitled form')}</strong>${content.description ? `<p>${esc(content.description)}</p>` : ''}${fields}<span class="fp-button">Submit</span></div>`;
}

function codePreview(content) {
  const file = (content.files || [])[content.active || 0] || (content.files || [])[0];
  if (!file) return '<pre class="code-preview">// Empty file</pre>';
  return `<div class="code-preview-wrap"><span class="code-preview-name">${esc(file.name)}</span><pre class="code-preview">${esc(String(file.text || '').slice(0, 2600))}</pre></div>`;
}

function gamePreview(content) {
  const project = content?.project ? content : {};
  const mode = project.mode === '3d' ? '3d' : '2d';
  const scene = (project.scenes || [])[0] || { entities: [] };
  const width = Math.max(320, num(project.project?.width, 960));
  const height = Math.max(180, num(project.project?.height, 540));
  const entities = (scene.entities || []).filter((item) => item.visible !== false).slice(0, 40);
  const shapes = entities.map((item) => {
    const sprite = item.components?.SpriteRenderer || {};
    const fill = color(sprite.color || item.components?.MeshRenderer?.color, '#64748b');
    const x = ((num(item.x) + width / 2) / width) * 100;
    const y = ((num(item.y) + height / 2) / height) * 100;
    const w = Math.max(0.6, (num(item.w, 40) / width) * 100);
    const h = Math.max(0.6, (num(item.h, 40) / height) * 100);
    return `<i style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;background:${fill};opacity:${Math.max(0.15, num(sprite.opacity, item.opacity, 1))};border-radius:${sprite.shape === 'circle' ? '50%' : '3px'};transform:rotate(${num(item.rotation || item.rotationZ)}deg)"></i>`;
  }).join('');
  return `<div class="game-preview ${mode}" style="background:${color(project.project?.background, '#07080b')}">
    <div class="gp-scene">${mode === '2d' ? shapes : `<div class="gp-sun"></div><div class="gp-floor"></div>${shapes}<div class="gp-glow"></div>`}</div>
    <div class="gp-hud"><span class="gp-badge">${mode.toUpperCase()}</span><b>${esc(project.project?.name || 'Cascade Game')}</b><small>${entities.length} entities · ${(project.scripts || []).length} scripts · ${(project.assets || []).length} assets</small></div>
    <div class="gp-play">▶ Play in Game Studio</div>
  </div>`;
}

function robloxPreview(content) {
  const services = Array.isArray(content?.scene?.services) ? content.scene.services : Array.isArray(content?.services) ? content.services : [];
  const flat = [];
  const walk = (node, depth = 0) => {
    if (!node || flat.length >= 28) return;
    flat.push({ name: node.name || node.className || 'Instance', className: node.className || node.ClassName || 'Instance', depth });
    for (const child of node.children || []) walk(child, depth + 1);
  };
  services.forEach((s) => walk(s));
  return `<div class="roblox-preview">
    <div class="rbx-viewport"><div class="rbx-grid"></div><div class="rbx-block b1"></div><div class="rbx-block b2"></div><div class="rbx-block b3"></div><span class="rbx-label">CASCADE STUDIO</span></div>
    <div class="rbx-tree"><b>${esc(content?.placeName || content?.scene?.placeName || 'Untitled place')}</b>${flat.map((n) => `<span style="padding-left:${8 + n.depth * 9}px"><i>${esc(n.className.slice(0, 3).toUpperCase())}</i>${esc(n.name)}</span>`).join('') || '<em>No instances yet</em>'}</div>
  </div>`;
}

function flowPreview(content) {
  const scripts = Array.isArray(content?.scripts) ? content.scripts : [];
  const active = scripts[0] || { graph: { nodes: [], edges: [] }, name: 'Main' };
  const nodes = (active.graph?.nodes || []).filter((n) => !['comment', 'group'].includes(n.type));
  const edges = active.graph?.edges || [];
  const maxX = Math.max(560, ...nodes.map((n) => Number(n.x) + 260));
  const maxY = Math.max(360, ...nodes.map((n) => Number(n.y) + 130));
  const pos = new Map(nodes.map((n) => [n.id, { x: Number(n.x) || 0, y: Number(n.y) || 0 }]));
  const paths = edges.map((e) => {
    const a = pos.get(e.from?.node), b = pos.get(e.to?.node);
    if (!a || !b) return '';
    const x1 = ((a.x + 220) / maxX) * 100, y1 = ((a.y + 46) / maxY) * 100;
    const x2 = (b.x / maxX) * 100, y2 = ((b.y + 46) / maxY) * 100;
    const mid = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="${e.kind === 'exec' ? '#e11d48' : '#64748b'}" stroke-width="1.1" opacity="${e.kind === 'exec' ? 0.85 : 0.65}"/>`;
  }).join('');
  const cards = nodes.slice(0, 40).map((n) => {
    const x = ((Number(n.x) || 0) / maxX) * 100, y = ((Number(n.y) || 0) / maxY) * 100;
    const title = n.type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `<div class="fp-node" style="left:${x}%;top:${y}%;width:${Math.max(14, Math.min(34, (220 / maxX) * 100))}%"><b>${esc(title)}</b><span>${esc(n.type)}</span></div>`;
  }).join('');
  return `<div class="flow-preview">
    <div class="flp-head"><span class="flp-kicker">CASCADE FLOW · ${esc(content?.project?.name || 'Discord bot')}</span><div class="flp-tabs">${scripts.slice(0, 5).map((s, i) => `<span class="${i === 0 ? 'on' : ''}">${esc(s.name || 'Script')}</span>`).join('')}</div></div>
    <div class="flp-canvas"><div class="flp-dots"></div><svg viewBox="0 0 100 100" preserveAspectRatio="none">${paths}</svg>${cards}<div class="flp-legend"><i class="exec"></i> execution <i class="data"></i> data</div></div>
    <div class="flp-foot"><span>${scripts.length} scripts</span><span>${nodes.length} nodes</span><span>${edges.length} connections</span><span class="flp-ready">Ready to compile</span></div>
  </div>`;
}

export function templatePreviewBody(kind, content) {
  if (kind === 'flow') return flowPreview(content || {});
  if (kind === 'game') return gamePreview(content || {});
  if (kind === 'roblox') return robloxPreview(content || {});
  if (kind === 'doc') return documentPreview(content || {});
  if (kind === 'sheet') return sheetPreview(content || {});
  if (kind === 'deck') return deckPreview(content || {});
  if (kind === 'board') return boardPreview(content || {});
  if (kind === 'form') return formPreview(content || {});
  if (kind === 'code') return codePreview(content || {});
  if (kind === 'site') return `<div class="template-site">${renderSiteBody(content || {}, { preview: false })}</div>`;
  return '<div class="unknown">No preview</div>';
}

function sitePreview(content) {
  const hero = (content.sections || []).find((s) => s.type === 'hero') || {};
  const sectionCount = (content.sections || []).length;
  return `<div class="site-preview" style="--site-accent:${color(content.theme?.accent, '#e11d48')};--site-bg:${color(content.theme?.bg, '#0b0b10')};--site-fg:${color(content.theme?.text, '#f7f7f8')}">
    <div class="sp-nav"><b>${esc(content.brand || 'Brand')}</b><span>${esc((content.nav || []).slice(0, 3).map((n) => n.label).join(' · ') || 'Home · Work · Contact')}</span></div>
    <div class="sp-hero">
      ${hero.eyebrow ? `<small>${esc(hero.eyebrow)}</small>` : ''}
      <strong>${esc(hero.title || content.siteTitle || 'Your headline')}</strong>
      ${hero.text ? `<p>${esc(hero.text)}</p>` : ''}
      <i>${esc(hero.ctaLabel || 'Get started')}</i>
    </div>
    <div class="sp-grid">${Array.from({ length: Math.min(3, Math.max(1, sectionCount - 1)) }, (_, i) => `<span><b>${esc((content.sections?.[i + 1]?.title || ['Design', 'Build', 'Launch'][i]))}</b><em></em><em></em></span>`).join('')}</div>
  </div>`;
}

export function templatePreviewDocument({ kind, content, title, theme }) {
  if (kind === 'site') {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title || 'Website preview')}</title><style>html,body{margin:0;height:100%;overflow:hidden}${siteCss(content || {})}</style></head><body>${renderSiteBody(content || {}, { preview: false })}</body></html>`;
  }
  const accent = color(theme?.accent, '#e11d48');
  const bg = color(theme?.bg, '#08080a');
  const text = color(theme?.text, '#f3f3f4');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || 'Template preview')}</title>
<style>
  :root { color-scheme: dark; --accent:${accent}; --bg:${bg}; --text:${text}; --surface:#131316; --muted:#92929c; --line:rgba(255,255,255,.1); }
  * { box-sizing:border-box; }
  html, body { margin:0; min-height:100%; background:var(--bg); color:var(--text); font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif; }
  body { overflow:hidden; }
  .doc-preview { padding:24px 28px; font-size:11px; line-height:1.55; overflow:hidden; height:100vh; }
  .doc-preview h1 { font-size:25px; margin:0 0 8px; letter-spacing:-.035em; }
  .doc-preview h2 { font-size:16px; margin:16px 0 6px; }
  .doc-preview h3 { font-size:13px; margin:12px 0 4px; }
  .doc-preview p { margin:0 0 7px; color:#c9c9d0; }
  .doc-preview ul,.doc-preview ol { margin:0 0 8px; padding-left:17px; color:#c9c9d0; }
  .doc-preview table { width:100%; border-collapse:collapse; margin:8px 0; font-size:9px; }
  .doc-preview th,.doc-preview td { border:1px solid var(--line); padding:3px 5px; text-align:left; }
  .doc-preview th { background:#1b1b20; }
  .doc-preview img { max-width:100%; max-height:150px; border-radius:4px; }
  .doc-preview blockquote { border-left:2px solid var(--accent); margin:8px 0; padding:4px 10px; color:#b9b9c4; }
  .doc-preview pre { background:#16161a; padding:8px; border-radius:5px; font:9px/1.5 ui-monospace,monospace; overflow:hidden; }
  .doc-hf { border-bottom:1px solid var(--line); color:#777781; font-size:8px; padding-bottom:4px; margin-bottom:10px; }
  .doc-hf:last-child { border:0; border-top:1px solid var(--line); padding:6px 0 0; margin:10px 0 0; }
  .sheet-preview { border-collapse:collapse; width:100%; table-layout:fixed; font-size:8px; }
  .sheet-preview th { background:#17171c; color:#777781; font-weight:600; padding:3px 4px; border:1px solid var(--line); }
  .sheet-preview td { border:1px solid var(--line); padding:3px 4px; color:#d8d8de; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; height:18px; }
  .sheet-preview tbody th { width:22px; }
  .sheet-tabs { display:flex; gap:4px; margin-top:8px; }
  .sheet-tabs span { font-size:8px; border:1px solid var(--line); border-radius:4px; padding:3px 6px; color:#85858f; }
  .sheet-tabs span.on { color:var(--accent); border-color:var(--accent); }
  .deck-preview { position:relative; width:100%; max-height:100vh; overflow:hidden; background:#08080a; }
  .dp-slide { position:relative; width:100%; aspect-ratio:16/9; overflow:hidden; animation:dpfade .45s ease both; }
  .dp-el { position:absolute; }
  .dp-in-none { animation:none; }
  .dp-in-fade { animation:dpfade .55s ease both; }
  .dp-in-zoom { animation:dpzoom .5s cubic-bezier(.2,.8,.2,1) both; }
  .dp-in-push { animation:dppush .55s cubic-bezier(.2,.8,.2,1) both; }
  .dp-count { position:absolute; right:8px; bottom:6px; font:8px ui-monospace,monospace; color:#888891; }
  @keyframes dpfade { from { opacity:0 } to { opacity:1 } }
  @keyframes dpzoom { from { opacity:0; transform:scale(1.06) } to { opacity:1; transform:scale(1) } }
  @keyframes dppush { from { opacity:0; transform:translateX(8%) } to { opacity:1; transform:translateX(0) } }
  .board-preview { position:relative; height:100vh; overflow:hidden; background:#0e0e12; background-image:radial-gradient(circle at 1px 1px, rgba(255,255,255,.12) 1px, transparent 0); background-size:18px 18px; }
  .bp-el,.bp-sticky,.bp-text { position:absolute; }
  .bp-sticky { padding:6px; font-size:8px; color:#111; border-radius:2px; box-shadow:0 4px 10px rgba(0,0,0,.3); overflow:hidden; }
  .bp-text { overflow:hidden; }
  .bp-path { position:absolute; inset:0; width:100%; height:100%; }
  .form-preview { padding:24px 28px; font-size:11px; }
  .form-preview strong { display:block; font-size:19px; letter-spacing:-.025em; margin-bottom:4px; }
  .form-preview p { color:var(--muted); margin:0 0 14px; font-size:10px; }
  .fp-label { display:block; color:#d5d5db; font-size:10px; margin:9px 0 4px; }
  .fp-input,.fp-area { height:24px; border:1px solid var(--line); border-radius:4px; background:#131317; }
  .fp-area { height:44px; }
  .fp-options { display:flex; flex-wrap:wrap; gap:5px; }
  .fp-option { border:1px solid var(--line); border-radius:4px; padding:4px 7px; font-size:9px; color:#b8b8c1; display:flex; align-items:center; gap:5px; }
  .fp-option i { width:8px; height:8px; border:1px solid var(--line); border-radius:50%; }
  .fp-button { display:inline-block; margin-top:13px; background:var(--accent); color:white; font:600 9px/1 system-ui; padding:7px 12px; border-radius:4px; }
  .code-preview-wrap { height:100vh; background:#0d0d11; }
  .code-preview-name { display:block; padding:8px 12px; border-bottom:1px solid var(--line); color:#86868f; font:9px ui-monospace,monospace; }
  .code-preview { margin:0; padding:14px; font:10px/1.65 ui-monospace,SFMono-Regular,monospace; color:#d4d4d8; white-space:pre-wrap; overflow:hidden; max-height:calc(100vh - 34px); }
  .site-preview { --site-accent:#e11d48; background:var(--site-bg); color:var(--site-fg); min-height:100vh; padding:0 6%; overflow:hidden; }
  .sp-nav { display:flex; align-items:center; justify-content:space-between; padding:16px 0; font-size:9px; border-bottom:1px solid rgba(255,255,255,.12); }
  .sp-nav b { font-size:11px; }
  .sp-nav span { color:rgba(255,255,255,.58); }
  .sp-hero { padding:15% 0 12%; max-width:88%; }
  .sp-hero small { color:var(--site-accent); font:700 7px/1 ui-monospace,monospace; letter-spacing:.16em; text-transform:uppercase; }
  .sp-hero strong { display:block; font-size:clamp(20px,6vw,39px); line-height:1.03; letter-spacing:-.045em; margin:6px 0 9px; }
  .sp-hero p { color:rgba(255,255,255,.58); font-size:9px; max-width:70%; line-height:1.55; }
  .sp-hero i { display:inline-block; margin-top:12px; background:var(--site-accent); color:#fff; padding:7px 12px; border-radius:4px; font:600 8px/1 system-ui; font-style:normal; }
  .sp-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding-bottom:20px; }
  .sp-grid span { border:1px solid rgba(255,255,255,.13); border-radius:4px; padding:9px; font-size:8px; background:rgba(255,255,255,.025); }
  .sp-grid b { display:block; margin-bottom:6px; }
  .sp-grid em { display:block; height:3px; border-radius:2px; background:rgba(255,255,255,.15); margin-top:4px; }
  .sp-grid em:last-child { width:65%; }
  .roblox-preview { display:grid; grid-template-columns:1.1fr .9fr; height:100vh; background:#0b0b0e; color:#e8e8ee; font:11px system-ui; overflow:hidden; }
  .rbx-viewport { position:relative; overflow:hidden; background:radial-gradient(circle at 50% 40%,#26354a,#0b1018 70%); }
  .rbx-grid { position:absolute; inset:0; background-image:linear-gradient(rgba(125,211,252,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(125,211,252,.12) 1px,transparent 1px); background-size:22px 22px; transform:perspective(420px) rotateX(58deg) scale(1.7); transform-origin:50% 70%; }
  .rbx-block { position:absolute; border:1px solid rgba(255,255,255,.25); box-shadow:0 12px 30px rgba(0,0,0,.45); }
  .rbx-block.b1 { width:44%; height:25%; left:28%; top:44%; background:#334155; transform:skewY(-8deg); }
  .rbx-block.b2 { width:20%; height:13%; left:48%; top:31%; background:#e11d48; transform:skewY(-8deg); }
  .rbx-block.b3 { width:12%; height:8%; left:63%; top:52%; background:#f59e0b; transform:skewY(-8deg); }
  .rbx-label { position:absolute; left:12px; bottom:10px; font:700 7px ui-monospace,monospace; letter-spacing:.15em; color:#7dd3fc; }
  .rbx-tree { padding:12px; border-left:1px solid rgba(255,255,255,.1); overflow:hidden; background:#101015; }
  .rbx-tree b { display:block; font-size:11px; margin-bottom:8px; color:#fff; }
  .rbx-tree span { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:3px 5px; border-radius:3px; color:#b8b8c5; font-size:9px; }
  .rbx-tree i { display:inline-block; width:21px; color:#f59e0b; font:700 7px ui-monospace,monospace; font-style:normal; }
  .rbx-tree em { color:#777; font-size:9px; }
  .flow-preview { height:100vh; display:flex; flex-direction:column; background:#09090c; color:#f4f4f5; font-family:Inter,system-ui,sans-serif; overflow:hidden; }
  .flp-head { padding:13px 16px; border-bottom:1px solid rgba(255,255,255,.08); display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .flp-kicker { font:700 8px/1 ui-monospace,monospace; letter-spacing:.1em; color:#f472b6; }
  .flp-tabs { display:flex; gap:4px; overflow:hidden; }
  .flp-tabs span { font-size:8px; color:#85858f; border:1px solid rgba(255,255,255,.1); border-radius:4px; padding:4px 6px; white-space:nowrap; }
  .flp-tabs span.on { color:#f9a8d4; border-color:rgba(244,114,182,.5); background:rgba(244,114,182,.1); }
  .flp-canvas { position:relative; flex:1; overflow:hidden; background:radial-gradient(circle at 1px 1px, rgba(255,255,255,.13) 1px, transparent 0); background-size:17px 17px; }
  .flp-canvas svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
  .fp-node { position:absolute; background:#17171d; border:1px solid rgba(255,255,255,.13); border-left:3px solid #e11d48; border-radius:5px; padding:8px 9px; box-shadow:0 8px 24px rgba(0,0,0,.3); overflow:hidden; }
  .fp-node b { display:block; font-size:8px; color:#ededf0; margin-bottom:3px; white-space:nowrap; }
  .fp-node span { font:6px ui-monospace,monospace; color:#71717a; }
  .flp-legend { position:absolute; left:11px; bottom:10px; display:flex; align-items:center; gap:4px; font:7px ui-monospace,monospace; color:#85858f; background:rgba(9,9,12,.8); padding:5px 7px; border:1px solid rgba(255,255,255,.08); border-radius:4px; }
  .flp-legend i { display:inline-block; width:9px; height:2px; border-radius:2px; margin-left:4px; }
  .flp-legend i.exec { background:#e11d48; } .flp-legend i.data { background:#64748b; }
  .flp-foot { display:flex; gap:12px; padding:9px 15px; border-top:1px solid rgba(255,255,255,.08); font:7px ui-monospace,monospace; color:#71717a; }
  .flp-ready { margin-left:auto; color:#4ade80; }
  .game-preview { position:relative; height:100vh; overflow:hidden; color:#f8fafc; font:11px system-ui; }
  .gp-scene { position:absolute; inset:0; overflow:hidden; }
  .game-preview.2d .gp-scene i { position:absolute; transform-origin:center; border:1px solid rgba(255,255,255,.12); }
  .game-preview.3d .gp-scene { background:linear-gradient(180deg,#172554,#070b16 72%); }
  .game-preview.3d .gp-scene i { position:absolute; transform:translate(-50%,-50%) rotateX(-18deg); border:1px solid rgba(255,255,255,.18); box-shadow:0 10px 25px rgba(0,0,0,.35); }
  .gp-sun { position:absolute; width:90px; height:90px; border-radius:50%; right:14%; top:12%; background:radial-gradient(circle,#fef3c7,#f59e0b 55%,transparent 72%); opacity:.8; }
  .gp-floor { position:absolute; left:-20%; right:-20%; bottom:-18%; height:62%; background:repeating-linear-gradient(90deg,rgba(148,163,184,.14) 0 1px,transparent 1px 34px),repeating-linear-gradient(rgba(148,163,184,.14) 0 1px,transparent 1px 34px),linear-gradient(180deg,#1e293b,#0b1220); transform:perspective(480px) rotateX(62deg); transform-origin:50% 0; }
  .gp-glow { position:absolute; inset:auto 0 0; height:30%; background:linear-gradient(transparent,rgba(2,6,23,.7)); }
  .gp-hud { position:absolute; left:14px; top:13px; display:flex; flex-direction:column; gap:2px; text-shadow:0 2px 8px #000; }
  .gp-hud b { font-size:14px; letter-spacing:-.02em; }
  .gp-hud small { color:#b6c2d4; font-size:9px; }
  .gp-badge { align-self:flex-start; font:800 8px ui-monospace,monospace; letter-spacing:.12em; background:#be123c; color:#fff; padding:3px 5px; border-radius:3px; margin-bottom:2px; }
  .gp-play { position:absolute; left:14px; bottom:13px; background:#e11d48; color:#fff; border-radius:4px; padding:6px 9px; font:700 9px system-ui; box-shadow:0 5px 18px rgba(225,29,72,.4); }
  .unknown { padding:20px; color:#888; font:11px system-ui; }
  @media (max-width:520px) { .doc-preview { padding:18px; } .sp-hero strong { font-size:27px; } }
  @media (prefers-reduced-motion: reduce) { * { animation:none !important; } }
</style></head><body>${templatePreviewBody(kind, content)}</body></html>`;
}
