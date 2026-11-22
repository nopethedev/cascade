import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import sqlite3 from 'sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ADMIN_PASSWORD = 'sdk-admin-password';
const OTHER_PASSWORD = 'sdk-other-password';

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

async function waitForServer(base, child, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${logs.join('')}`);
    try {
      const res = await fetch(`${base}/api/health`, { redirect: 'manual' });
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

function textOf(result) {
  const item = (result?.content || []).find((entry) => entry.type === 'text');
  assert.ok(item, 'tool result should contain text content');
  return item.text;
}

async function captureError(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return { code: err.code, message: err.message, data: err.data };
  }
}

async function connectSdk(base, key) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: key ? { headers: { 'x-api-key': key } } : {},
  });
  const client = new Client({ name: 'cascade-sdk-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

test('official MCP SDK Streamable HTTP client completes a scoped session', { timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-mcp-sdk-'));
  const dbPath = path.join(dir, 'mcp.sqlite');
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
      SESSION_SECRET: 'sdk-test-session-secret',
      DB_PATH: dbPath,
      STORAGE_DIR: storageDir,
      HEALTHCHECK_INTERVAL_MS: '3600000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  let cookie = '';
  const request = async (route, options = {}) => {
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
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return res;
  };

  try {
    await waitForServer(base, child, logs);
    const setup = await request('/setup', {
      method: 'POST',
      form: form({ siteName: 'SDK MCP', username: 'sdk-admin', password: ADMIN_PASSWORD }),
    });
    assert.equal(setup.status, 302);

    const otherUser = await request('/admin/users', {
      method: 'POST',
      form: form({ username: 'sdk-other', password: OTHER_PASSWORD, role: 'user', quotaGB: '1' }),
    });
    assert.equal(otherUser.status, 302);

    const otherRow = (await queryRows(dbPath, 'select id from users where username = ?', ['sdk-other']))[0];
    const adminRow = (await queryRows(dbPath, 'select id from users where username = ?', ['sdk-admin']))[0];
    assert.ok(otherRow?.id && adminRow?.id);

    const makeKey = async (name, scope, ownerId) => {
      const res = await request('/admin/api-keys', {
        method: 'POST',
        form: form({ name, scope, ...(ownerId ? { ownerId } : {}) }),
      });
      assert.equal(res.status, 200);
      const html = await res.text();
      const match = /id="fresh-key" value="([^"]+)"/.exec(html);
      assert.ok(match, `raw key not returned for ${name}`);
      return { raw: match[1], id: (await queryRows(dbPath, 'select id from api_keys where name = ?', [name]))[0].id };
    };

    const writeKey = await makeKey('sdk write', 'write', adminRow.id);
    const readKey = await makeKey('sdk read', 'read', adminRow.id);
    const otherKey = await makeKey('sdk other', 'write', otherRow.id);

    const { client: write, transport: writeTransport } = await connectSdk(base, writeKey.raw);
    assert.equal(write.getServerVersion()?.name, 'cascade-workspace');
    assert.equal(write.getServerCapabilities()?.tools?.listChanged, false);
    assert.equal(writeTransport.protocolVersion, '2025-11-25', 'SDK negotiation must report the selected version');
    assert.equal(writeTransport.sessionId, undefined, 'the stateless server must not issue a session id');

    const initializeResponse = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'x-api-key': writeKey.raw, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 499, method: 'initialize', params: { protocolVersion: '2025-11-25' } }),
    });
    assert.equal(initializeResponse.status, 200);
    assert.equal(initializeResponse.headers.get('mcp-session-id'), null, 'initialize must not return a session id');
    assert.equal((await initializeResponse.json()).result.protocolVersion, '2025-11-25');

    const versionedFollowUp = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'x-api-key': writeKey.raw,
        'mcp-protocol-version': '2025-11-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 500, method: 'tools/list' }),
    });
    assert.equal(versionedFollowUp.status, 200, 'a valid MCP-Protocol-Version follow-up must be accepted');
    assert.ok(Array.isArray((await versionedFollowUp.json()).result.tools));

    const badVersion = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'x-api-key': writeKey.raw,
        'mcp-protocol-version': '1999-01-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 501, method: 'tools/list' }),
    });
    assert.equal(badVersion.status, 400, 'an unsupported MCP-Protocol-Version must be rejected');
    assert.equal((await badVersion.json()).error.code, -32600);

    const deleteResponse = await fetch(`${base}/mcp`, {
      method: 'DELETE',
      headers: { 'x-api-key': writeKey.raw },
    });
    assert.equal(deleteResponse.status, 405, 'stateless DELETE must be method-not-allowed, not a session teardown');

    const tools = await write.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.ok(names.includes('whoami'));
    assert.ok(names.includes('create_document'));
    assert.ok(names.includes('get_document'));
    assert.ok(names.includes('list_documents'));

    const who = await write.callTool({ name: 'whoami', arguments: {} });
    const whoPayload = JSON.parse(textOf(who));
    assert.equal(whoPayload.user.username, 'sdk-admin');
    assert.equal(whoPayload.scope, 'write');
    assert.ok(!JSON.stringify(who).includes(writeKey.raw), 'whoami must not return key material');

    const created = await write.callTool({
      name: 'create_document',
      arguments: { kind: 'doc', name: 'SDK private doc', content: { html: '<h1>SDK PRIVATE MARKER</h1>' } },
    });
    const createdDoc = JSON.parse(textOf(created)).document;
    assert.ok(createdDoc.id);
    assert.equal(createdDoc.kind, 'doc');

    const readBack = await write.callTool({ name: 'get_document', arguments: { id: createdDoc.id } });
    assert.match(textOf(readBack), /SDK PRIVATE MARKER/);

    const listed = await write.callTool({ name: 'list_documents', arguments: {} });
    assert.ok(JSON.parse(textOf(listed)).documents.some((doc) => doc.id === createdDoc.id));

    const resourceList = await write.listResources();
    assert.ok(resourceList.resources.some((resource) => resource.uri === `cascade://documents/${createdDoc.id}`));
    const resourceRead = await write.readResource({ uri: `cascade://documents/${createdDoc.id}` });
    assert.match(resourceRead.contents[0].text, /SDK PRIVATE MARKER/);

    const { client: read } = await connectSdk(base, readKey.raw);
    const readTools = await read.listTools();
    assert.ok(!readTools.tools.some((tool) => tool.name === 'create_document'), 'read-only tools/list excludes writes');
    const readBackByRead = await read.callTool({ name: 'get_document', arguments: { id: createdDoc.id } });
    assert.match(textOf(readBackByRead), /SDK PRIVATE MARKER/);
    const deniedUpdate = await read.callTool({
      name: 'update_document',
      arguments: { id: createdDoc.id, content: { html: 'SDK-PWN' } },
    });
    assert.equal(deniedUpdate.isError, true);
    assert.ok(!JSON.stringify(deniedUpdate).includes('SDK-PWN'));
    const unchanged = await write.callTool({ name: 'get_document', arguments: { id: createdDoc.id } });
    assert.ok(!textOf(unchanged).includes('SDK-PWN'));

    const { client: other } = await connectSdk(base, otherKey.raw);
    const missingId = 'sdk-document-that-does-not-exist';
    const logStart = logs.join('').length;

    const foreignTool = await other.callTool({ name: 'get_document', arguments: { id: createdDoc.id } });
    const missingTool = await other.callTool({ name: 'get_document', arguments: { id: missingId } });
    assert.equal(foreignTool.isError, true);
    assert.deepEqual(foreignTool, missingTool, 'foreign and missing ids must produce the same get_document result');
    assert.ok(!JSON.stringify(foreignTool).includes(createdDoc.id), 'get_document error must not echo the id');
    assert.ok(!JSON.stringify(missingTool).includes(missingId), 'get_document error must not echo the id');
    assert.ok(!JSON.stringify(foreignTool).includes('SDK PRIVATE MARKER'));

    const foreignResource = await captureError(() =>
      other.readResource({ uri: `cascade://documents/${createdDoc.id}` }));
    const missingResource = await captureError(() =>
      other.readResource({ uri: `cascade://documents/${missingId}` }));
    assert.deepEqual(foreignResource, missingResource, 'foreign and missing resource ids must produce identical errors');
    assert.deepEqual(foreignResource, { code: -32602, message: 'MCP error -32602: resource not found', data: undefined });
    const resourceErrors = JSON.stringify([foreignResource, missingResource]);
    assert.ok(!resourceErrors.includes(createdDoc.id), 'resources/read error must not echo the foreign id');
    assert.ok(!resourceErrors.includes(missingId), 'resources/read error must not echo the missing id');
    assert.ok(!resourceErrors.includes('cascade://documents/'), 'resources/read error must not echo a URI');

    const rawResource = async (id) => {
      const res = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'x-api-key': otherKey.raw, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 700, method: 'resources/read', params: { uri: `cascade://documents/${id}` } }),
      });
      return (await res.json()).error;
    };
    assert.deepEqual(await rawResource(createdDoc.id), { code: -32602, message: 'resource not found' });
    assert.deepEqual(await rawResource(missingId), { code: -32602, message: 'resource not found' });

    const idOracleLogs = logs.join('').slice(logStart);
    assert.ok(!idOracleLogs.includes(createdDoc.id), 'server log must not distinguish the foreign id');
    assert.ok(!idOracleLogs.includes(missingId), 'server log must not distinguish the missing id');
    assert.ok(!idOracleLogs.includes('SDK PRIVATE MARKER'), 'server log must not contain document content');

    const apiKeyCrossOrigin = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'x-api-key': writeKey.raw,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 502, method: 'initialize', params: {} }),
    });
    assert.equal(apiKeyCrossOrigin.status, 403, 'API-key MCP requests must also reject foreign origins');

    const anonymousTransport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
    const anonymousClient = new Client({ name: 'cascade-sdk-anon', version: '1.0.0' }, { capabilities: {} });
    await assert.rejects(
      () => anonymousClient.connect(anonymousTransport),
      (err) => err.code === 401 || /401|Unauthorized|login required/i.test(String(err)),
    );

    const crossOrigin = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'initialize', params: {} }),
    });
    assert.equal(crossOrigin.status, 403);

    const revoke = await request(`/admin/api-keys/${readKey.id}/revoke`, { method: 'POST' });
    assert.equal(revoke.status, 302);
    await assert.rejects(
      () => read.callTool({ name: 'whoami', arguments: {} }),
      (err) => err.code === 401 || /401|Unauthorized|invalid or revoked/i.test(String(err)),
      'revoked key must fail through the SDK transport',
    );

    await writeTransport.close();
    await write.close();
    await read.close();
    await other.close();
    assert.ok(!logs.join('').includes(writeKey.raw), 'write key must not appear in logs');
    assert.ok(!logs.join('').includes(readKey.raw), 'read key must not appear in logs');
    assert.ok(!logs.join('').includes(otherKey.raw), 'other key must not appear in logs');
  } finally {
    await stopServer(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
