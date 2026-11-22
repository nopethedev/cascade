import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { buildPluginModel } from '../src/robloxPlugin.js';
import { validateScene, validateCommand, applyCommandToContent, starterScene } from '../src/studio.js';
import { renderSiteDocument, siteCss, renderSiteBody } from '../public/site-render.mjs';
import { TEMPLATES, templatesFor } from '../src/templates.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ADMIN_PASSWORD = 'studio-admin-password';
const USER_PASSWORD = 'studio-user-password';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function form(values) {
  return new URLSearchParams(values).toString();
}

function client(base) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(route, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.cookie = cookie;
      let body = options.body;
      if (options.json !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(options.json);
      } else if (options.form !== undefined) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        body = options.form;
      }
      const res = await fetch(base + route, { method: options.method || 'GET', headers, body, redirect: 'manual' });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return res;
    },
  };
}

const text = async (res) => Buffer.from(await res.arrayBuffer()).toString('utf8');
const json = async (res) => JSON.parse(await text(res));

async function waitForServer(base, child, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited:\n${logs.join('')}`);
    try {
      const res = await fetch(`${base}/api/health`, { redirect: 'manual' });
      if (res.status === 200 || res.status === 503) return;
    } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server not ready:\n${logs.join('')}`);
}

test('Roblox Studio unit validation rejects unsafe payloads and persists supported edits', () => {
  const scene = starterScene('Unit place');
  assert.equal(scene.services.length, 4);
  const workspace = scene.services.find((s) => s.name === 'Workspace');
  const parentId = workspace.id;
  const next = applyCommandToContent(scene, 'create', {
    parentId,
    className: 'Part',
    name: 'Unit Part',
    clientId: 'unit-part',
    props: { Size: { x: 2, y: 2, z: 2 } },
  });
  assert.ok(next.services.find((s) => s.id === parentId).children.some((c) => c.id === 'unit-part'));
  applyCommandToContent(next, 'rename', { instanceId: 'unit-part', name: 'Renamed' });
  assert.ok(next.services.find((s) => s.id === parentId).children.some((c) => c.name === 'Renamed'));
  assert.throws(() => validateCommand('script', { instanceId: 'x', source: 'x'.repeat(200001) }), /invalid script source/);
  assert.throws(() => validateScene(JSON.parse('{"services":[],"__proto__":{"polluted":true}}')), /unsafe key|too/);
  assert.throws(() => validateCommand('create', { className: '<script>' }), /invalid className/);
  assert.throws(() => validateCommand('update', { instanceId: 'x', props: JSON.parse('{"__proto__":{"polluted":true}}') }), /unsafe key/);

  const blank = TEMPLATES.find((t) => t.id === 'roblox-blank').build();
  assert.equal(blank.services.find((s) => s.name === 'Workspace').children.length, 0);
  assert.equal(blank.services.find((s) => s.name === 'ServerScriptService').children.length, 0);

  const xml = buildPluginModel();
  assert.match(xml, /Item class="Script"/);
  assert.match(xml, /ProtectedString name="Source"/);
  assert.match(xml, /&quot;/);
  assert.doesNotMatch(xml, /<script>/i);
});

test('website engine emits real responsive CSS, breakpoints, layout variants and media', () => {
  const content = {
    brand: 'Responsive QA',
    theme: { breakpoints: { tablet: 820, mobile: 560 }, accent: '#e11d48' },
    sections: [
      {
        id: 'layout-features', type: 'features', title: 'Layouts', items: [{ title: 'A', text: 'one' }, { title: 'B', text: 'two' }],
        layout: { display: 'flex', columns: 4, tablet: 2, mobile: 1, gap: 22, justify: 'space-between' },
        style: { paddingY: 90, paddingYTablet: 50, paddingYMobile: 22, bg: 'gradient', bgFrom: '#111111', bgTo: '#222222', bgVideo: 'https://cdn.example.test/loop.mp4' },
      },
      { id: 'layout-gallery', type: 'gallery', title: 'Work', images: [], layout: { display: 'grid', columns: 3 } },
      { id: 'layout-freeform', type: 'freeform', height: 500, items: [{ id: 'block-a', title: 'SVG mark', x: 6, y: 10, w: 32, h: 24, image: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=' }, { id: 'block-b', title: 'Layer two', x: 56, y: 46, w: 28, h: 30 }] },
    ],
  };
  const html = renderSiteBody(content);
  const css = siteCss(content);
  assert.match(html, /--cs-layout:flex/);
  assert.match(html, /--cs-cols:4/);
  assert.match(html, /cs-layout-flex/);
  assert.match(html, /<video class="cs-bg-video"[^>]+src="https:\/\/cdn\.example\.test\/loop\.mp4"/);
  assert.match(html, /data-freeform-id="block-a"/);
  assert.match(html, /left:6%;top:10%;width:32%;height:24%/);
  assert.match(html, /data:image\/svg\+xml;base64/);
  assert.match(html, /--cs-freeform-height:500px/);
  assert.match(css, /@media \(max-width:820px\)/);
  assert.match(css, /@media \(max-width:560px\)/);
  assert.match(css, /\[data-cs-id="layout-features"\]\{padding-top:50px;padding-bottom:50px\}/);
  assert.match(css, /\[data-cs-id="layout-features"\]\{padding-top:22px;padding-bottom:22px\}/);
  const doc = renderSiteDocument(content);
  assert.match(doc, /@media \(max-width:820px\)/);
  assert.match(doc, /--cs-cols-tablet:2/);
  assert.ok(templatesFor('site').some((t) => t.id === 'site-landing'));
  assert.ok(templatesFor('site').some((t) => t.id === 'site-community'));
  assert.ok(templatesFor('site', 'community').length >= 1);
  const landing = TEMPLATES.find((t) => t.id === 'site-landing').build();
  assert.ok(landing.sections.length >= 5);
  assert.match(renderSiteDocument(landing), /cs-feature-grid/);
});

test('Studio relay, website publishing, CMS, rollback, MCP and cross-user isolation work end-to-end', { timeout: 90000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-studio-sites-'));
  const dbPath = path.join(dir, 'db.sqlite');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      SERVER_MODE: 'main',
      SESSION_SECRET: 'studio-sites-test-secret',
      DB_PATH: dbPath,
      STORAGE_DIR: path.join(dir, 'uploads'),
      HEALTHCHECK_INTERVAL_MS: '3600000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));
  t.after(() => child.kill('SIGTERM'));

  try {
    await waitForServer(base, child, logs);
    const admin = client(base);
    assert.equal((await admin.request('/setup', { method: 'POST', form: form({ username: 'admin', password: ADMIN_PASSWORD }) })).status, 302);
    for (const username of ['studio-owner', 'studio-other']) {
      assert.equal((await admin.request('/admin/users', { method: 'POST', form: form({ username, password: USER_PASSWORD, role: 'user', quotaGB: '1' }) })).status, 302);
    }
    const owner = client(base);
    const other = client(base);
    for (const [c, username] of [[owner, 'studio-owner'], [other, 'studio-other']]) {
      assert.equal((await c.request('/login', { method: 'POST', form: form({ username, password: USER_PASSWORD }) })).status, 302);
    }

    const created = await owner.request('/api/studio/projects', { method: 'POST', json: { name: 'Relay Place' } });
    assert.equal(created.status, 200);
    const projectId = (await json(created)).id;
    assert.equal((await other.request(`/studio/roblox/${projectId}`)).status, 404, 'private Studio project must not leak to another user');
    assert.equal((await other.request(`/api/studio/projects/${projectId}`)).status, 404);
    assert.equal((await other.request(`/api/studio/projects/${projectId}/pair`, { method: 'POST', json: {} })).status, 404);

    const pairing = await json(await owner.request(`/api/studio/projects/${projectId}/pair`, { method: 'POST', json: {} }));
    assert.match(pairing.pairing.code, /^[A-Z0-9]{8}$/);
    assert.ok(pairing.pairing.baseUrl.startsWith('http'));
    assert.equal((await fetch(`${base}/api/studio/relay/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'WRONG123' }),
    })).status, 401);
    const connect = await fetch(`${base}/api/studio/relay/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.pairing.code, placeName: 'Relay Place', pluginVersion: '1.0.0' }),
    });
    assert.equal(connect.status, 201);
    const session = await connect.json();
    assert.ok(session.token);
    assert.equal(session.sessionId.length > 10, true);
    // A pairing code is single-use.
    assert.equal((await fetch(`${base}/api/studio/relay/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.pairing.code }),
    })).status, 401);

    const project = await json(await owner.request(`/api/studio/projects/${projectId}`));
    const workspaceId = project.project.content.services.find((s) => s.name === 'Workspace').id;
    const queued = await owner.request(`/api/studio/projects/${projectId}/commands`, {
      method: 'POST', json: {
        kind: 'create',
        payload: { parentId: workspaceId, className: 'Part', name: 'Browser Part', clientId: 'browser-part', props: { Size: { x: 3, y: 1, z: 3 }, Anchored: true } },
      },
    });
    assert.equal(queued.status, 201);
    const saved = await json(await owner.request(`/api/studio/projects/${projectId}`));
    assert.ok(saved.project.version > project.project.version, 'browser edit must persist before a plugin connects');
    assert.ok(saved.project.content.services.find((s) => s.name === 'Workspace').children.some((s) => s.name === 'Browser Part'));

    const poll = await fetch(`${base}/api/studio/relay/poll`, { headers: { 'x-studio-token': session.token } });
    assert.equal(poll.status, 200);
    const polled = await poll.json();
    assert.equal(polled.commands.length, 1);
    const ack = await fetch(`${base}/api/studio/relay/ack`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-token': session.token },
      body: JSON.stringify({ commands: [{ id: polled.commands[0].id, ok: true }] }),
    });
    assert.equal(ack.status, 200);
    const acked = await json(ack);
    assert.equal(acked.processed, 1);

    const snapshot = await fetch(`${base}/api/studio/relay/snapshot`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-token': session.token },
      body: JSON.stringify({ placeName: 'Relay Place', pluginVersion: '1.0.0', scene: project.project.content }),
    });
    assert.equal(snapshot.status, 200);
    const afterSnapshot = await json(await owner.request(`/api/studio/projects/${projectId}`));
    assert.equal(afterSnapshot.project.content.scene.services.length, 4);
    assert.ok(afterSnapshot.project.version > saved.project.version);
    const snapshots = await json(await owner.request(`/api/studio/projects/${projectId}/snapshots`));
    assert.ok(snapshots.snapshots.length >= 1);
    const restored = await owner.request(`/api/studio/projects/${projectId}/snapshots/${snapshots.snapshots[0].id}/restore`, { method: 'POST', json: {} });
    assert.equal(restored.status, 200);
    const restoredProject = await json(await owner.request(`/api/studio/projects/${projectId}`));
    assert.ok(restoredProject.project.version > afterSnapshot.project.version);
    assert.equal(restoredProject.project.content.scene.services.length, 4);
    assert.equal((await other.request(`/api/studio/projects/${projectId}/snapshots/${snapshots.snapshots[0].id}/restore`, { method: 'POST', json: {} })).status, 404);

    assert.equal((await other.request(`/api/studio/projects/${projectId}/commands`, {
      method: 'POST', json: { kind: 'create', payload: { parentId: workspaceId, className: 'Part' } },
    })).status, 404);

    assert.equal((await owner.request(`/api/studio/projects/${projectId}/sessions/${session.sessionId}/revoke`, { method: 'POST', json: {} })).status, 200);
    assert.equal((await fetch(`${base}/api/studio/relay/poll`, { headers: { 'x-studio-token': session.token } })).status, 410);

    const plugin = await owner.request('/studio/roblox/plugin.rbxmx');
    assert.equal(plugin.status, 200);
    const pluginText = await text(plugin);
    assert.match(pluginText, /CascadePlugin/);
    assert.match(pluginText, /HttpService/);

    // Website builder + SQLite CMS.
    const siteCreate = await owner.request('/api/workspace/docs', { method: 'POST', json: { kind: 'site', templateId: 'site-blog', name: 'QA Site' } });
    assert.equal(siteCreate.status, 200);
    const siteId = (await json(siteCreate)).id;
    const editor = await owner.request(`/edit/${siteId}`);
    assert.equal(editor.status, 200);
    assert.match(await text(editor), /site-canvas/);

    const collectionRes = await owner.request(`/api/workspace/docs/${siteId}/cms/collections`, {
      method: 'POST', json: {
        name: 'Journal',
        fields: [{ id: 'title', label: 'Title', type: 'text' }, { id: 'excerpt', label: 'Excerpt', type: 'text' }, { id: 'body', label: 'Body', type: 'richtext' }],
      },
    });
    assert.equal(collectionRes.status, 201);
    const collection = (await json(collectionRes)).collection;
    const itemRes = await owner.request(`/api/workspace/docs/${siteId}/cms/collections/${collection.id}/items`, {
      method: 'POST', json: {
        data: { title: 'First dispatch', excerpt: 'Rendered from SQLite.', body: 'A dynamic paragraph from the database.' },
        status: 'published',
      },
    });
    assert.equal(itemRes.status, 201);
    const item = (await json(itemRes)).item;

    const raw = await json(await owner.request(`/api/workspace/docs/${siteId}`));
    raw.content.sections.push({
      id: 'cms-test', type: 'cms', collectionId: collection.id, collectionSlug: collection.slug, title: 'Field notes', limit: 6,
    });
    const updated = await owner.request(`/api/workspace/docs/${siteId}`, { method: 'PUT', json: { content: raw.content, version: raw.version } });
    assert.equal(updated.status, 200);

    const publish = await json(await owner.request(`/api/workspace/docs/${siteId}/publish`, { method: 'POST', json: {} }));
    assert.ok(publish.publishedAt);
    assert.ok(publish.slug);
    const publicPage = await fetch(`${base}/sites/${publish.slug}`);
    assert.equal(publicPage.status, 200);
    const publicHtml = await text(publicPage);
    assert.match(publicHtml, /First dispatch/);
    assert.match(publicHtml, /Rendered from SQLite/);
    assert.match(publicHtml, /Field notes/);
    const itemPage = await fetch(`${base}/sites/${publish.slug}/c/${collection.slug}/${item.slug}`);
    assert.equal(itemPage.status, 200);
    assert.match(await text(itemPage), /cs-cms-item/);

    assert.equal((await other.request(`/api/workspace/docs/${siteId}/cms`)).status, 404, 'public site must not expose CMS drafts to strangers');
    assert.equal((await other.request(`/api/workspace/docs/${siteId}/deployments`)).status, 404);
    assert.equal((await other.request(`/sites/${siteId}/staging`)).status, 404);
    assert.equal((await other.request(`/api/workspace/docs/${siteId}/publish`, { method: 'POST', json: {} })).status, 404);

    const xss = await owner.request(`/api/workspace/docs/${siteId}/cms/collections/${collection.id}/items`, {
      method: 'POST', json: { data: { title: '<script>globalThis.__cmsXss = 1</script>', excerpt: '<img src=x onerror=alert(1)>', body: 'safe body' }, status: 'published' },
    });
    assert.equal(xss.status, 201);
    const xssPage = await text(await fetch(`${base}/sites/${publish.slug}/c/${collection.slug}`));
    assert.doesNotMatch(xssPage, /<script>globalThis\.__cmsXss/);
    assert.doesNotMatch(xssPage, /<img src=x onerror=/);
    assert.match(xssPage, /&lt;script&gt;/);

    const deployments = await json(await owner.request(`/api/workspace/docs/${siteId}/deployments`));
    const production = deployments.deployments.filter((d) => d.environment === 'production');
    assert.ok(production.length >= 1);
    const staging = await owner.request(`/api/workspace/docs/${siteId}/deployments/staging`, { method: 'POST', json: { label: 'QA staging' } });
    assert.equal(staging.status, 201);
    assert.equal((await owner.request(`/sites/${siteId}/staging`)).status, 200);
    const v1 = production.sort((a, b) => a.version - b.version)[0];
    const rollback = await owner.request(`/api/workspace/docs/${siteId}/deployments/${v1.id}/rollback`, { method: 'POST', json: {} });
    assert.equal(rollback.status, 200);
    const afterRollback = await text(await fetch(`${base}/sites/${publish.slug}`));
    assert.match(afterRollback, /The Long Form/);

    // MCP can read Studio projects and preview/queue an approved command.
    const ownerMe = await json(await owner.request('/api/me'));
    const keyPage = await text(await admin.request('/admin/api-keys', {
      method: 'POST', form: form({ name: 'studio-mcp', ownerId: ownerMe.user.id, scope: 'full' }),
    }));
    const key = /id="fresh-key" value="([^"]+)"/.exec(keyPage)?.[1];
    assert.ok(key, 'API key should be shown once');
    const mcp = async (payload) => json(await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, accept: 'application/json, text/event-stream' },
      body: JSON.stringify(payload),
    }));
    const tools = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.ok(tools.result.tools.some((tool) => tool.name === 'studio_queue_command'));
    const listed = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'studio_list_projects', arguments: {} } });
    assert.match(listed.result.content[0].text, /Relay Place/);
    const preview = await mcp({
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
        name: 'studio_queue_command', arguments: {
          id: projectId, kind: 'create', dry_run: true,
          payload: { parentId: workspaceId, className: 'Part', name: 'MCP preview', clientId: 'mcp-preview' },
        },
      },
    });
    assert.match(preview.result.content[0].text, /dryRun/);
    const queuedByMcp = await mcp({
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
        name: 'studio_queue_command', arguments: {
          id: projectId, kind: 'create',
          payload: { parentId: workspaceId, className: 'Part', name: 'MCP part', clientId: 'mcp-part' },
        },
      },
    });
    assert.match(queuedByMcp.result.content[0].text, /queued/);
    const mcpSaved = await json(await owner.request(`/api/studio/projects/${projectId}`));
    assert.ok(mcpSaved.project.content.scene.services.find((s) => s.name === 'Workspace').children.some((s) => s.name === 'MCP part'));

    assert.match(renderSiteDocument({ sections: [], brand: 'X' }, { slug: 'x' }), /<!doctype html>/);
  } finally {
    child.kill('SIGTERM');
  }
});
