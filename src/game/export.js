import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { normalizeProject } from '../../public/game/schema.mjs';
import { FileRecord } from '../db.js';
import { readFileWithFallback } from '../storage.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cache = new Map();

function readVendor(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(ROOT, 'public', 'vendor', name), 'utf8'));
  return cache.get(name);
}

function readRuntime(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(ROOT, 'public', 'game', name), 'utf8'));
  return cache.get(name);
}

function escapeScript(value) {
  return String(value).replace(/<\/script/gi, '<\\/script');
}

function titleOf(project) {
  return String(project.project?.name || 'Cascade Game').replace(/[<>&]/g, '');
}

function slugName(value) {
  return String(value || 'cascade-game').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'cascade-game';
}

async function dataUrlFor(buffer, mime) {
  return `data:${mime || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
}

// A game export must never point back at the authenticated Cascade origin.
// Resolve only files owned by the project owner, or already-public data URLs,
// and inline the bytes into the standalone package.
export async function inlineGameAssets(input, ownerId) {
  const project = normalizeProject(input);
  const diagnostics = [];
  for (const asset of project.assets) {
    if (!asset.src) continue;
    if (/^data:/i.test(asset.src)) continue;
    let pathname = asset.src;
    try { pathname = new URL(asset.src, 'http://local').pathname; } catch { /* keep */ }
    const local = /^\/f\/([A-Za-z0-9_-]+)\/raw$/.exec(pathname);
    if (!local) {
      if (!/^https?:\/\//i.test(asset.src)) continue;
      diagnostics.push(`External asset left as a URL: ${asset.name}`);
      continue;
    }
    const file = await FileRecord.findByPk(local[1]);
    if (!file || file.kind !== 'file' || file.ownerId !== ownerId) {
      diagnostics.push(`Asset not accessible to this owner and omitted: ${asset.name}`);
      asset.src = '';
      continue;
    }
    try {
      const { buffer } = await readFileWithFallback(file);
      asset.src = await dataUrlFor(buffer, file.mime);
    } catch {
      diagnostics.push(`Asset bytes unavailable and omitted: ${asset.name}`);
      asset.src = '';
    }
  }
  return { project, diagnostics };
}

function standaloneHtml(project, { source = false } = {}) {
  const title = titleOf(project);
  const is3d = project.mode === '3d';
  const runtime = is3d ? readRuntime('runtime3d.js') : readRuntime('runtime.js');
  const engines = is3d
    ? `<script>${escapeScript(readVendor('cascade-three.js'))}</script>\n<script>${escapeScript(readVendor('cannon-es.js'))}</script>`
    : `<script>${escapeScript(readVendor('matter.min.js'))}</script>`;
  const data = escapeScript(JSON.stringify(project));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${title}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src data: https: http: ws: wss:; font-src data:;">
<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050508;color:#f4f4f5;font-family:system-ui,sans-serif}
  #game-canvas{display:block;width:100vw;height:100vh;touch-action:none;outline:none}
  #game3d-hud{position:fixed;inset:0;pointer-events:none;overflow:hidden}
  .cascade-export-badge{position:fixed;right:10px;bottom:8px;z-index:20;font:10px ui-monospace,monospace;color:rgba(244,244,245,.35);pointer-events:none}
  .cascade-load-error{position:fixed;inset:0;display:grid;place-items:center;background:#09090c;color:#fecdd3;padding:24px;text-align:center;z-index:50}
</style>
</head>
<body>
<canvas id="game-canvas" aria-label="${title}" tabindex="0"></canvas>
${engines}
<script>window.__GAME_PROJECT__ = ${data}; window.__CASCADE_GAME_ENGINE__ = ${JSON.stringify(is3d ? '3d' : '2d')};</script>
<script>${escapeScript(runtime)}</script>
<script>
  window.addEventListener('error', function (event) {
    if (window.__CASCADE_GAME__) return;
    var node = document.createElement('div');
    node.className = 'cascade-load-error';
    node.textContent = 'The game failed to start: ' + (event.message || 'unknown error');
    document.body.append(node);
  });
</script>
<span class="cascade-export-badge">CASCADE GAME STUDIO${source ? ' · source build' : ''}</span>
</body>
</html>
`;
}

function readme(project, mode) {
  const is3d = mode === '3d';
  return `# ${titleOf(project)}\n\nA standalone ${is3d ? '3D' : '2D'} game exported from Cascade Game Studio.\n\n## Run\n\nOpen \`index.html\` in a modern browser, or serve this folder from any static host:\n\n\`\`\`\nnpx serve .\n# or: python3 -m http.server 8080\n\`\`\`\n\nNo Cascade login, server, database, or network service is required for single-player play. Keep the whole folder together when moving it.\n\n## Controls\n\n- WASD / arrow keys — move\n- Space — jump\n- Shift — sprint\n- Escape — browser pointer-lock exit\n- R — restart after winning\n\n## Package contents\n\n- \`index.html\` — complete playable build with the engine, runtime and project data inlined.\n- \`game.json\` — editable scene/script data used by the build.\n- \`README.md\` — this file.\n- \`source/\` — runtime entry points for source export.\n\n## Engine\n\n${is3d ? 'Three.js rendering, Cannon-es rigid-body physics, data-driven visual scripts and a sandboxed JavaScript entry point. Visual graphs are interpreted as data; JavaScript runs inside this document only.' : 'Canvas2D rendering, Matter.js rigid-body physics, data-driven visual scripts and a sandboxed JavaScript entry point.'}\n\nGame projects are client-side code. Do not paste private API keys or server credentials into project data: exported games are public.\n`;
}

export async function buildGameHtml(input, { ownerId, source = false } = {}) {
  const { project, diagnostics } = await inlineGameAssets(input, ownerId);
  return { html: standaloneHtml(project, { source }), project, diagnostics, filename: `${slugName(project.project.name)}.html` };
}

export async function buildGameZip(input, { ownerId, source = true } = {}) {
  const { project, diagnostics } = await inlineGameAssets(input, ownerId);
  const zip = new JSZip();
  const folder = zip.folder('cascade-game');
  folder.file('index.html', standaloneHtml(project, { source }));
  folder.file('game.json', JSON.stringify(project, null, 2));
  folder.file('README.md', readme(project, project.mode));
  if (source) {
    const sourceFolder = folder.folder('source');
    if (project.mode === '3d') {
      sourceFolder.file('runtime3d.js', readRuntime('runtime3d.js'));
      sourceFolder.file('three.global.js', readVendor('cascade-three.js'));
      sourceFolder.file('cannon-es.js', readVendor('cannon-es.js'));
    } else {
      sourceFolder.file('runtime.js', readRuntime('runtime.js'));
      sourceFolder.file('matter.min.js', readVendor('matter.min.js'));
    }
    sourceFolder.file('game.json', JSON.stringify(project, null, 2));
    for (const asset of project.assets) {
      if (!asset.src || !/^data:/i.test(asset.src)) continue;
      const match = /^data:([^;,]+);base64,(.*)$/is.exec(asset.src);
      if (!match) continue;
      const extension = match[1].split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
      sourceFolder.file(`assets/${slugName(asset.name)}.${extension}`, Buffer.from(match[2], 'base64'));
    }
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { buffer, project, diagnostics, filename: `${slugName(project.project.name)}.zip` };
}
