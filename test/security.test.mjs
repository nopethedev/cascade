import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import sqlite3 from 'sqlite3';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ADMIN_PASSWORD = 'security-admin-password';
const USER_PASSWORD = 'security-user-password';
const PRIVATE_MARKER = 'PRIVATE SECURITY MARKER';
const PUBLIC_MARKER = 'PUBLIC SECURITY MARKER';

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

function createClient(base) {
  let cookie = '';
  let lastSetCookie = '';
  return {
    get cookie() {
      return cookie;
    },
    get lastSetCookie() {
      return lastSetCookie;
    },
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
      const res = await fetch(base + route, {
        method: options.method || 'GET',
        headers,
        body,
        redirect: 'manual',
      });
      lastSetCookie = res.headers.get('set-cookie') || '';
      if (lastSetCookie) cookie = lastSetCookie.split(';')[0];
      return res;
    },
  };
}

async function bodyText(res) {
  return Buffer.from(await res.arrayBuffer()).toString('utf8');
}

async function json(res) {
  return JSON.parse(await bodyText(res));
}

async function waitForServer(base, child, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${logs.join('')}`);
    try {
      const res = await fetch(`${base}/api/health`, { redirect: 'manual' });
      // A fresh database correctly returns 503 setup-required here.
      if (res.status === 200 || res.status === 503) return;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready:\n${logs.join('')}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function queryRows(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) return reject(openErr);
      db.all(sql, params, (err, rows) => {
        db.close();
        if (err) reject(err);
        else resolve(rows);
      });
    });
  });
}

async function upload(client, filename, contents, type) {
  const data = new FormData();
  data.append('files', new Blob([contents], { type }), filename);
  const res = await client.request('/api/upload', { method: 'POST', body: data });
  return { res, payload: res.status === 200 ? await json(res) : null };
}

test('real HTTP security matrix blocks anonymous/cross-user access and hardens uploads and API keys', { timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-security-'));
  const dbPath = path.join(dir, 'security.sqlite');
  const storageDir = path.join(dir, 'uploads');
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
      SESSION_SECRET: 'security-test-session-secret',
      DB_PATH: dbPath,
      STORAGE_DIR: storageDir,
      HEALTHCHECK_INTERVAL_MS: '3600000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  try {
    await waitForServer(base, child, logs);
    const admin = createClient(base);
    const setup = await admin.request('/setup', {
      method: 'POST',
      form: form({ username: 'admin', password: ADMIN_PASSWORD }),
    });
    assert.equal(setup.status, 302);
    assert.match(admin.lastSetCookie, /HttpOnly/i);
    assert.match(admin.lastSetCookie, /SameSite=Lax/i);

    for (const username of ['sec-owner', 'sec-other']) {
      const res = await admin.request('/admin/users', {
        method: 'POST',
        form: form({ username, password: USER_PASSWORD, role: 'user', quotaGB: '1' }),
      });
      assert.equal(res.status, 302, `create ${username}`);
    }

    const owner = createClient(base);
    const other = createClient(base);
    for (const [client, username] of [[owner, 'sec-owner'], [other, 'sec-other']]) {
      const res = await client.request('/login', {
        method: 'POST',
        form: form({ username, password: USER_PASSWORD }),
      });
      assert.equal(res.status, 302);
      assert.match(client.lastSetCookie, /SameSite=Lax/i);
    }
    assert.equal((await other.request('/admin/api-keys')).status, 403, 'non-admin must not reach API-key management');

    const createDoc = async (client, kind, name, isPublic = false) => {
      const res = await client.request('/api/workspace/docs', {
        method: 'POST',
        json: { kind, name, isPublic },
      });
      assert.equal(res.status, 200, `create ${kind}`);
      return (await json(res)).id;
    };

    const docId = await createDoc(owner, 'doc', 'Security private doc');
    const sheetId = await createDoc(owner, 'sheet', 'Security private sheet');
    const deckId = await createDoc(owner, 'deck', 'Security private deck');
    const pdfId = await createDoc(owner, 'pdf', 'Security private pdf');
    const publicDocId = await createDoc(owner, 'doc', 'Security public doc', true);
    const boardId = await createDoc(owner, 'board', 'Security public board', true);
    const publicDeckId = await createDoc(owner, 'deck', 'Security public deck', true);

    const putContent = (client, id, content, version = 1) =>
      client.request(`/api/workspace/docs/${id}`, {
        method: 'PUT',
        json: { content, version },
      });
    assert.equal((await putContent(owner, docId, { html: `<h1>${PRIVATE_MARKER}</h1>` })).status, 200);
    assert.equal((await putContent(owner, sheetId, { sheets: [{ name: 'S1', cells: { A1: { v: PRIVATE_MARKER } } }] })).status, 200);
    assert.equal((await putContent(owner, deckId, { w: 1280, h: 720, slides: [{ elements: [{ type: 'text', x: 1, y: 1, w: 100, h: 40, text: PRIVATE_MARKER }] }] })).status, 200);
    assert.equal((await putContent(owner, publicDocId, { html: `<h1>${PUBLIC_MARKER}</h1>` })).status, 200);
    assert.equal((await putContent(owner, boardId, { elements: [{ type: 'rect', x: 1, y: 1, w: 40, h: 40, color: '"/><script>alert(1)</script>' }] })).status, 200);
    assert.equal((await putContent(owner, publicDeckId, { w: 1280, h: 720, slides: [{ bg: 'red;</style><script>alert(1)</script>', elements: [{ type: 'text', x: 1, y: 1, w: 100, h: 40, text: 'safe text', color: 'blue;</style><script>alert(2)</script>' }] }] })).status, 200);

    const image = await upload(owner, 'owner.png', Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png');
    assert.equal(image.res.status, 200);
    const imageId = image.payload.files[0].id;
    const otherImage = await upload(other, 'other.png', Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png');
    assert.equal(otherImage.res.status, 200);
    const otherImageId = otherImage.payload.files[0].id;

    const htmlUpload = await upload(owner, 'active.html', '<!doctype html><script>alert(1)</script><h1>ACTIVE SECRET</h1>', 'text/html');
    assert.equal(htmlUpload.res.status, 200);
    const htmlId = htmlUpload.payload.files[0].id;
    const disguised = await upload(owner, 'disguised.png', '<script>alert(2)</script>', 'text/html');
    assert.equal(disguised.res.status, 200);
    const disguisedId = disguised.payload.files[0].id;
    const publicFile = await upload(owner, 'public.txt', 'PUBLIC FILE', 'text/plain');
    const publicFileId = publicFile.payload.files[0].id;
    const traversal = await upload(owner, '../../escape.txt', 'TRAVERSAL', 'text/plain');
    assert.equal(traversal.res.status, 200);
    const traversalId = traversal.payload.files[0].id;
    assert.equal(traversal.payload.files[0].filename, 'escape.txt');
    assert.ok(fs.existsSync(path.join(storageDir, traversalId)), 'traversal upload must use the generated id');
    assert.ok(!fs.existsSync(path.join(dir, 'escape.txt')), 'traversal filename must not escape storage');

    assert.equal((await owner.request(`/api/files/${publicFileId}/share`, { method: 'POST', json: { isPublic: true } })).status, 200);
    const publicInfo = await json(await owner.request(`/api/workspace/docs/${publicDocId}`));
    const publicSlug = publicInfo.slug;
    const privateInfo = await json(await owner.request(`/api/workspace/docs/${docId}`));
    const privateSlug = privateInfo.slug;

    // Anonymous callers must not get private content or JSON/API data.
    for (const route of [
      `/api/workspace/docs/${docId}`,
      `/api/workspace/docs/${sheetId}`,
      `/api/workspace/docs/${deckId}`,
      `/api/workspace/docs/${pdfId}`,
      `/api/files/${imageId}`,
      `/api/files/${docId}/text`,
      '/api/files',
      '/api/images/search?q=panda',
    ]) {
      const res = await createClient(base).request(route);
      assert.equal(res.status, 401, `anonymous ${route}`);
      assert.ok(!(await bodyText(res)).includes(PRIVATE_MARKER));
    }
    for (const route of [`/download/${docId}`, `/export/${docId}`, `/f/${imageId}/raw`, '/admin/api-keys']) {
      const res = await createClient(base).request(route);
      assert.equal(res.status, 401, `anonymous ${route} must reject with 401`);
      assert.ok(!(await bodyText(res)).includes(PRIVATE_MARKER));
    }

    // Cross-user reads, including direct id replay, must be non-disclosing.
    for (const id of [docId, sheetId, deckId, pdfId]) {
      for (const route of [
        `/api/workspace/docs/${id}`,
        `/api/workspace/docs/${id}/versions`,
        `/download/${id}`,
        `/export/${id}`,
        `/edit/${id}`,
      ]) {
        const res = await other.request(route);
        assert.equal(res.status, 404, `cross-user ${route}`);
        const body = await bodyText(res);
        assert.ok(!body.includes(PRIVATE_MARKER), `cross-user leak ${route}`);
      }
    }
    for (const route of [
      `/api/workspace/docs/${docId}/versions/1`,
      `/f/${imageId}`,
      `/f/${imageId}/raw`,
      `/api/files/${imageId}`,
      `/api/files/${docId}/text`,
    ]) {
      const res = await other.request(route);
      assert.equal(res.status, 404, `cross-user ${route}`);
      const body = await bodyText(res);
      assert.ok(!body.includes(PRIVATE_MARKER), `cross-user leak ${route}`);
    }

    for (const [method, route, jsonBody] of [
      ['DELETE', `/api/files/${imageId}`, undefined],
      ['POST', `/api/files/${imageId}/share`, { isPublic: true }],
      ['POST', `/api/files/${imageId}/rename`, { filename: 'pwn.txt' }],
      ['PUT', `/api/workspace/docs/${docId}`, { content: { html: 'PWN' }, version: 1 }],
      ['POST', `/api/workspace/docs/${docId}/heartbeat`, {}],
      ['POST', `/api/workspace/docs/${docId}/restore`, { version: 1 }],
      ['POST', `/api/workspace/docs/${docId}/template`, {}],
    ]) {
      const res = await other.request(route, { method, json: jsonBody });
      assert.equal(res.status, 404, `cross-user ${method} ${route}`);
      assert.ok(!(await bodyText(res)).includes('PWN'));
    }

    // Owner access still works after the negative matrix.
    const ownerDoc = await owner.request(`/api/workspace/docs/${docId}`);
    assert.equal(ownerDoc.status, 200);
    assert.match(await bodyText(ownerDoc), /PRIVATE SECURITY MARKER/);
    assert.equal((await owner.request(`/download/${docId}`)).status, 200);
    assert.equal((await owner.request(`/export/${sheetId}`)).status, 200);
    assert.equal((await owner.request(`/export/${deckId}`)).status, 200);
    assert.equal((await owner.request(`/export/${pdfId}`)).status, 200);

    // Public sharing is intentional; private and random slugs remain non-disclosing.
    assert.equal((await createClient(base).request(`/c/${publicSlug}`)).status, 200);
    assert.equal((await createClient(base).request(`/c/${publicSlug}/export`)).status, 200);
    assert.equal((await createClient(base).request(`/c/${privateSlug}`)).status, 404);
    assert.equal((await createClient(base).request(`/c/${privateSlug}/export`)).status, 404);
    assert.equal((await createClient(base).request('/c/does-not-exist')).status, 404);
    assert.equal((await createClient(base).request(`/raw/${privateSlug}`)).status, 404);
    assert.equal((await createClient(base).request(`/c/${publicSlug}/asset/${imageId}`)).status, 200);
    assert.equal((await createClient(base).request(`/c/${publicSlug}/asset/${otherImageId}`)).status, 404);
    const boardInfo = await json(await owner.request(`/api/workspace/docs/${boardId}`));
    const boardSvg = await createClient(base).request(`/c/${boardInfo.slug}/export`);
    assert.equal(boardSvg.status, 200);
    assert.match(boardSvg.headers.get('content-security-policy') || '', /script-src 'none'|default-src 'none'/i);
    assert.ok(!(await bodyText(boardSvg)).includes('<script'), 'board SVG must not contain injected script');
    const deckInfo = await json(await owner.request(`/api/workspace/docs/${publicDeckId}`));
    const deckPreview = await createClient(base).request(`/c/${deckInfo.slug}/preview`);
    assert.equal(deckPreview.status, 200);
    assert.match(deckPreview.headers.get('content-security-policy') || '', /script-src 'none'|default-src 'none'/i);
    assert.ok(!(await bodyText(deckPreview)).includes('<script'), 'deck preview must not contain injected script');
    const fileSlug = publicFile.payload.files[0].slug;
    assert.equal((await createClient(base).request(`/raw/${fileSlug}`)).status, 200);
    assert.equal((await owner.request(`/api/files/${publicFileId}/share`, { method: 'POST', json: { isPublic: false } })).status, 200);
    assert.equal((await createClient(base).request(`/raw/${fileSlug}`)).status, 404);
    assert.equal((await owner.request(`/api/workspace/docs/${publicDocId}`)).status, 200);

    // Upload filename/type confusion and active content handling.
    const rawHtml = await owner.request(`/f/${htmlId}/raw`);
    assert.equal(rawHtml.status, 200);
    assert.match(rawHtml.headers.get('content-disposition') || '', /^attachment;/i);
    assert.match(rawHtml.headers.get('content-security-policy') || '', /sandbox/i);
    assert.equal(rawHtml.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(rawHtml.headers.get('cache-control'), 'private, no-store');
    const disguisedRaw = await owner.request(`/f/${disguisedId}/raw`);
    assert.equal(disguisedRaw.headers.get('content-type'), 'image/png');
    assert.match(disguisedRaw.headers.get('content-disposition') || '', /^inline;/i);
    const traversalRaw = await owner.request(`/f/${traversalId}/raw`);
    assert.equal(traversalRaw.status, 200);

    // CSRF defense and cookie attributes.
    const cross = await owner.request('/api/workspace/docs', {
      method: 'POST',
      headers: { origin: 'https://evil.example', referer: 'https://evil.example/x' },
      json: { kind: 'doc', name: 'csrf should fail' },
    });
    assert.equal(cross.status, 403);
    assert.match(await bodyText(cross), /cross-origin/i);
    const same = await owner.request('/api/workspace/docs', {
      method: 'POST',
      headers: { origin: base },
      json: { kind: 'doc', name: 'same origin allowed' },
    });
    assert.equal(same.status, 200);

    // API keys: demonstrate read-only denial, hashed storage, revocation and no leak in lists.
    const makeKey = async (name, scope, targetId) => {
      const res = await admin.request('/admin/api-keys', {
        method: 'POST',
        form: form({ name, ownerId: targetId, scope }),
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const html = await bodyText(res);
      const match = /id="fresh-key" value="([^"]+)"/.exec(html);
      assert.ok(match, `raw key not returned for ${name}`);
      return match[1];
    };
    const ownerId = (await json(await owner.request('/api/me'))).user.id;
    const otherId = (await json(await other.request('/api/me'))).user.id;
    const readKey = await makeKey('security read key', 'read', ownerId);
    const mcpReadKey = await makeKey('security mcp read key', 'read', ownerId);
    const writeKey = await makeKey('security write key', 'write', ownerId);
    const otherKey = await makeKey('security other key', 'read', otherId);

    const readMe = await fetch(`${base}/api/me`, { headers: { 'x-api-key': readKey } });
    assert.equal(readMe.status, 200);
    assert.equal((await json(readMe)).auth, 'api-key');
    const readWriteAttempt = await fetch(`${base}/api/workspace/docs`, {
      method: 'POST',
      headers: { 'x-api-key': readKey, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'doc', name: 'must be denied' }),
    });
    assert.equal(readWriteAttempt.status, 403);
    assert.match(await readWriteAttempt.text(), /read-only/i);
    const readAdmin = await fetch(`${base}/admin/api-keys`, { headers: { 'x-api-key': readKey } });
    assert.equal(readAdmin.status, 403);
    const writeAdmin = await fetch(`${base}/admin/api-keys`, { headers: { 'x-api-key': writeKey } });
    assert.equal(writeAdmin.status, 403);
    const writeUpload = await fetch(`${base}/api/upload`, {
      method: 'POST',
      headers: { 'x-api-key': writeKey },
      body: (() => {
        const f = new FormData();
        f.append('files', new Blob(['write-key'], { type: 'text/plain' }), 'write.txt');
        return f;
      })(),
    });
    assert.equal(writeUpload.status, 200);

    const otherDoc = await fetch(`${base}/api/workspace/docs/${docId}`, { headers: { 'x-api-key': otherKey } });
    assert.equal(otherDoc.status, 404);
    const otherDownload = await fetch(`${base}/download/${docId}`, { headers: { 'x-api-key': otherKey } });
    assert.equal(otherDownload.status, 404);

    const keyRows = await queryRows(dbPath, 'select * from api_keys where name = ?', ['security read key']);
    assert.equal(keyRows.length, 1);
    const stored = keyRows[0];
    assert.equal(stored.scope, 'read');
    assert.equal(stored.keyHash.length, 64);
    assert.equal(stored.keyHash, crypto.createHash('sha256').update(readKey).digest('hex'));
    assert.ok(!JSON.stringify(stored).includes(readKey), 'plaintext API key must not be in the DB row');
    assert.ok(readKey.length >= 36);

    const keyList = await admin.request('/admin/api-keys');
    const keyListHtml = await bodyText(keyList);
    assert.equal(keyList.status, 200);
    assert.ok(!keyListHtml.includes(readKey), 'raw key must not appear in key list');
    assert.ok(!keyListHtml.includes(mcpReadKey), 'raw MCP key must not appear in key list');
    assert.match(keyListHtml, /read-only/);

    const revokeRead = await admin.request(`/admin/api-keys/${stored.id}/revoke`, { method: 'POST' });
    assert.equal(revokeRead.status, 302);
    const revoked = await fetch(`${base}/api/me`, { headers: { 'x-api-key': readKey } });
    assert.equal(revoked.status, 401);

    // SQL/filter/id probes must not widen scope.
    const sqlProbe = await other.request(`/search?q=${encodeURIComponent("' OR 1=1-- ")}`);
    assert.equal(sqlProbe.status, 200);
    assert.ok(!(await bodyText(sqlProbe)).includes(PRIVATE_MARKER));
    const limitProbe = await other.request('/api/files?limit=1%20OR%201=1');
    assert.equal(limitProbe.status, 200);
    assert.ok(!(await bodyText(limitProbe)).includes(docId));
    const filesOther = await json(await other.request('/api/files'));
    assert.ok(filesOther.files.every((f) => f.ownerId === otherId), 'API file list must stay owner-scoped');
    assert.equal((await owner.request('/f/does-not-exist/raw')).status, 404);
    assert.equal((await owner.request('/download/does-not-exist')).status, 404);
    assert.equal((await createClient(base).request('/raw/does-not-exist')).status, 404);
    assert.equal((await createClient(base).request('/c/does-not-exist')).status, 404);

    // MCP: same auth and owner scope, with per-tool read-only enforcement.
    const anonMcp = await createClient(base).request('/mcp', {
      method: 'POST',
      json: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    });
    assert.equal(anonMcp.status, 401, 'anonymous MCP must be rejected');
    assert.ok(!(await bodyText(anonMcp)).includes(PRIVATE_MARKER));
    assert.equal((await createClient(base).request('/mcp')).status, 401);
    assert.equal((await owner.request('/mcp')).status, 405);

    const mcpClient = async (client, payload) => {
      const res = await client.request('/mcp', { method: 'POST', json: payload });
      const text = await bodyText(res);
      let body = null;
      try { body = JSON.parse(text); } catch { /* non-JSON error */ }
      return { res, body, text };
    };
    const mcpFetch = async (headers, payload) => {
      const res = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* non-JSON error */ }
      return { res, body, text };
    };
    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } };
    const ownerMcp = await mcpClient(owner, initialize);
    assert.equal(ownerMcp.res.status, 200);
    assert.match(ownerMcp.res.headers.get('content-type') || '', /application\/json/i);
    assert.equal(ownerMcp.body.result.serverInfo.name, 'cascade-workspace');
    assert.match(ownerMcp.body.result.instructions, /API key|owner/i);
    const initialized = await owner.request('/mcp', {
      method: 'POST',
      json: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });
    assert.equal(initialized.status, 202);
    const ownerTools = await mcpClient(owner, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.ok(ownerTools.body.result.tools.some((tool) => tool.name === 'create_document'));
    assert.ok(ownerTools.body.result.tools.some((tool) => tool.name === 'get_document'));

    const ownerRead = await mcpClient(owner, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'get_document', arguments: { id: docId } },
    });
    assert.equal(ownerRead.res.status, 200);
    assert.ok(!ownerRead.body.result.isError);
    assert.match(ownerRead.body.result.content[0].text, /PRIVATE SECURITY MARKER/);
    const otherRead = await mcpClient(other, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_document', arguments: { id: docId } },
    });
    assert.equal(otherRead.res.status, 200);
    assert.equal(otherRead.body.result.isError, true, 'cross-user MCP read must fail');
    assert.ok(!otherRead.text.includes(PRIVATE_MARKER), 'cross-user MCP read must not leak content');

    const crossOriginMcp = await owner.request('/mcp', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      json: initialize,
    });
    assert.equal(crossOriginMcp.status, 403, 'cookie-authenticated MCP mutations need same-origin CSRF checks');

    const readInit = await mcpFetch({ 'x-api-key': mcpReadKey }, initialize);
    assert.equal(readInit.res.status, 200);
    const readTools = await mcpFetch({ 'x-api-key': mcpReadKey }, { jsonrpc: '2.0', id: 5, method: 'tools/list' });
    const readToolNames = readTools.body.result.tools.map((tool) => tool.name);
    assert.ok(readToolNames.includes('get_document'));
    assert.ok(!readToolNames.includes('create_document'), 'read-only key must not list mutation tools');
    assert.ok(!readToolNames.includes('update_document'), 'read-only key must not list mutation tools');
    const readGet = await mcpFetch({ 'x-api-key': mcpReadKey }, {
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'get_document', arguments: { id: docId } },
    });
    assert.equal(readGet.res.status, 200);
    assert.match(readGet.body.result.content[0].text, /PRIVATE SECURITY MARKER/);
    const readUpdate = await mcpFetch({ 'x-api-key': mcpReadKey }, {
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'update_document', arguments: { id: docId, content: { html: 'MCP-PWN' } } },
    });
    assert.equal(readUpdate.body.result.isError, true, 'read-only MCP tool call must fail');
    assert.ok(!readUpdate.text.includes('MCP-PWN'));
    const afterDeniedUpdate = await owner.request(`/api/workspace/docs/${docId}`);
    assert.equal(afterDeniedUpdate.status, 200);
    assert.ok(!(await bodyText(afterDeniedUpdate)).includes('MCP-PWN'), 'read-only MCP call must not mutate');

    const writeCreate = await mcpFetch({ 'x-api-key': writeKey }, {
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { name: 'create_document', arguments: { kind: 'doc', name: 'MCP created', content: { html: '<h1>MCP CREATED</h1>' } } },
    });
    assert.equal(writeCreate.body.result.isError, undefined);
    const createdPayload = JSON.parse(writeCreate.body.result.content[0].text);
    const mcpDocId = createdPayload.document.id;
    assert.ok(mcpDocId);

    const writeUpdate = await mcpFetch({ 'x-api-key': writeKey }, {
      jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: { name: 'update_document', arguments: { id: mcpDocId, content: { html: '<h1>MCP UPDATED</h1>' }, version: 1 } },
    });
    assert.equal(writeUpdate.body.result.isError, undefined);
    const updated = JSON.parse(writeUpdate.body.result.content[0].text);
    assert.equal(updated.version, 2);
    assert.equal((await owner.request(`/api/workspace/docs/${mcpDocId}`)).status, 200);
    const listed = await mcpFetch({ 'x-api-key': writeKey }, {
      jsonrpc: '2.0', id: 9.1, method: 'tools/call',
      params: { name: 'list_documents', arguments: {} },
    });
    const listedIds = JSON.parse(listed.body.result.content[0].text).documents.map((doc) => doc.id);
    assert.ok(listedIds.includes(mcpDocId));
    assert.ok(listedIds.includes(docId), 'MCP list includes the owner\'s existing document');
    const otherList = await mcpFetch({ 'x-api-key': otherKey }, {
      jsonrpc: '2.0', id: 9.05, method: 'tools/call',
      params: { name: 'list_documents', arguments: {} },
    });
    const otherListIds = JSON.parse(otherList.body.result.content[0].text).documents.map((doc) => doc.id);
    assert.ok(!otherListIds.includes(docId) && !otherListIds.includes(mcpDocId), 'MCP list must not enumerate another owner');
    const versions = await mcpFetch({ 'x-api-key': writeKey }, {
      jsonrpc: '2.0', id: 9.2, method: 'tools/call',
      params: { name: 'get_version', arguments: { id: mcpDocId, version: 1 } },
    });
    assert.match(versions.body.result.content[0].text, /MCP CREATED/);
    const pdfCreate = await mcpFetch({ 'x-api-key': writeKey }, {
      jsonrpc: '2.0', id: 9.3, method: 'tools/call',
      params: { name: 'create_document', arguments: { kind: 'pdf', name: 'MCP PDF' } },
    });
    assert.equal(pdfCreate.body.result.isError, undefined);
    const pdfDocument = JSON.parse(pdfCreate.body.result.content[0].text).document;
    const pdfRead = await mcpFetch({ 'x-api-key': writeKey }, {
      jsonrpc: '2.0', id: 9.4, method: 'tools/call',
      params: { name: 'get_document', arguments: { id: pdfDocument.id } },
    });
    assert.match(JSON.parse(pdfRead.body.result.content[0].text).document.content.pdf, /^JVBERi/);
    const otherMcpRead = await mcpFetch({ 'x-api-key': otherKey }, {
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'get_document', arguments: { id: mcpDocId } },
    });
    assert.equal(otherMcpRead.body.result.isError, true, 'foreign API key must not read MCP document');
    assert.ok(!otherMcpRead.text.includes('MCP UPDATED'));
    const otherResource = await mcpFetch({ 'x-api-key': otherKey }, {
      jsonrpc: '2.0', id: 10.1, method: 'resources/read',
      params: { uri: `cascade://documents/${docId}` },
    });
    assert.equal(otherResource.body.error.code, -32602, 'foreign resource must be a resource-not-found error');
    assert.equal(otherResource.body.error.data, undefined, 'foreign resource error must not echo the URI');
    assert.ok(!otherResource.text.includes(PRIVATE_MARKER));

    const resources = await mcpFetch({ 'x-api-key': mcpReadKey }, { jsonrpc: '2.0', id: 11, method: 'resources/list' });
    assert.ok(resources.body.result.resources.some((resource) => resource.uri === `cascade://documents/${docId}`));
    const unknownMethod = await mcpFetch({ 'x-api-key': mcpReadKey }, { jsonrpc: '2.0', id: 12, method: 'unknown/method' });
    assert.equal(unknownMethod.body.error.code, -32601);
    const resourceRead = await mcpFetch({ 'x-api-key': mcpReadKey }, {
      jsonrpc: '2.0', id: 13, method: 'resources/read',
      params: { uri: `cascade://documents/${docId}` },
    });
    assert.equal(resourceRead.res.status, 200);
    assert.match(resourceRead.body.result.contents[0].text, /PRIVATE SECURITY MARKER/);
    const malformed = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: '{"jsonrpc":',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, -32700);
    const mcpKeyRows = await queryRows(dbPath, 'select * from api_keys where name = ?', ['security mcp read key']);
    assert.equal(mcpKeyRows.length, 1);
    await admin.request(`/admin/api-keys/${mcpKeyRows[0].id}/revoke`, { method: 'POST' });
    const revokedMcp = await mcpFetch({ 'x-api-key': mcpReadKey }, initialize);
    assert.equal(revokedMcp.res.status, 401, 'revoked API key must not reach MCP');

    assert.ok(!logs.join('').includes(readKey), 'raw API key must not be written to server logs');
    assert.ok(!logs.join('').includes(mcpReadKey), 'raw MCP API key must not be written to server logs');
  } finally {
    await stopServer(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
