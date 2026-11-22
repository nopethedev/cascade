import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ADMIN_PASSWORD = 'flow-api-admin-password';

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

function createClient(base) {
  let cookie = '';
  return {
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

async function waitForServer(base, child, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${logs.join('')}`);
    try {
      const res = await fetch(`${base}/api/health`, { redirect: 'manual' });
      if (res.status === 200 || res.status === 503) return;
    } catch { /* starting */ }
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

async function json(res) {
  return JSON.parse(Buffer.from(await res.arrayBuffer()).toString('utf8'));
}

async function mcp(base, key, payload) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  return { res, body, text };
}

test('Flow HTTP compile/export and MCP tools work with owner scope and scoped keys', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-flow-api-'));
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
      SESSION_SECRET: 'flow-api-test-session-secret',
      DB_PATH: path.join(dir, 'flow-api.sqlite'),
      STORAGE_DIR: path.join(dir, 'uploads'),
      HEALTHCHECK_INTERVAL_MS: '3600000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  try {
    await waitForServer(base, child, logs);
    const admin = createClient(base);
    assert.equal((await admin.request('/setup', {
      method: 'POST',
      form: new URLSearchParams({ username: 'admin', password: ADMIN_PASSWORD }).toString(),
    })).status, 302);
    assert.equal((await admin.request('/login', {
      method: 'POST',
      form: new URLSearchParams({ username: 'admin', password: ADMIN_PASSWORD }).toString(),
    })).status, 302);

    const created = await admin.request('/api/workspace/docs', {
      method: 'POST',
      json: { kind: 'flow', name: 'Flow API QA', templateId: 'flow-ping' },
    });
    assert.equal(created.status, 200);
    const flowId = (await json(created)).id;

    const anonymous = createClient(base);
    assert.equal((await anonymous.request(`/api/workspace/docs/${flowId}/flow/compile`, { method: 'POST', json: {} })).status, 401);
    assert.equal((await anonymous.request(`/api/workspace/docs/${flowId}/flow/export`, { method: 'POST', json: { mode: 'single' } })).status, 401);

    const compile = await admin.request(`/api/workspace/docs/${flowId}/flow/compile`, { method: 'POST', json: {} });
    assert.equal(compile.status, 200);
    const compiled = await json(compile);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.ok(compiled.code.includes('createFlowRuntime'));
    assert.ok(compiled.stats.scripts >= 1);

    const zipRes = await admin.request(`/api/workspace/docs/${flowId}/flow/export`, {
      method: 'POST', json: { mode: 'single' },
    });
    assert.equal(zipRes.status, 200);
    assert.match(zipRes.headers.get('content-type') || '', /zip/i);
    const zip = await JSZip.loadAsync(Buffer.from(await zipRes.arrayBuffer()));
    const names = Object.keys(zip.files);
    assert.ok(names.some((name) => name.endsWith('bot.js')));
    assert.ok(names.some((name) => name.endsWith('package.json')));

    const me = await json(await admin.request('/api/me'));
    const keyResponse = await admin.request('/admin/api-keys', {
      method: 'POST',
      form: new URLSearchParams({ name: 'flow api key', ownerId: me.user.id, scope: 'write' }).toString(),
    });
    assert.equal(keyResponse.status, 200);
    const keyHtml = await keyResponse.text();
    const key = /id="fresh-key" value="([^"]+)"/.exec(keyHtml)?.[1];
    assert.ok(key, 'API key was not returned once');
    const readKeyResponse = await admin.request('/admin/api-keys', {
      method: 'POST',
      form: new URLSearchParams({ name: 'flow read key', ownerId: me.user.id, scope: 'read' }).toString(),
    });
    const readKey = /id="fresh-key" value="([^"]+)"/.exec(await readKeyResponse.text())?.[1];
    assert.ok(readKey, 'read key was not returned once');

    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } };
    assert.equal((await mcp(base, key, initialize)).res.status, 200);
    const tools = await mcp(base, key, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const toolNames = tools.body.result.tools.map((tool) => tool.name);
    for (const name of ['flow_list_templates', 'flow_get_project', 'flow_compile', 'flow_export', 'flow_create_script']) {
      assert.ok(toolNames.includes(name), `MCP missing ${name}`);
    }

    const project = await mcp(base, key, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'flow_get_project', arguments: { id: flowId } },
    });
    assert.equal(project.body.result.isError, undefined, project.text);
    const projectData = JSON.parse(project.body.result.content[0].text);
    assert.equal(projectData.project.kind, 'flow');
    assert.ok(projectData.scripts.some((s) => s.type === 'command'));

    const remoteCompile = await mcp(base, key, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'flow_compile', arguments: { id: flowId, include_code: true } },
    });
    assert.equal(remoteCompile.body.result.isError, undefined, remoteCompile.text);
    const remoteData = JSON.parse(remoteCompile.body.result.content[0].text);
    assert.equal(remoteData.ok, true);
    assert.ok(remoteData.code.includes('createFlowRuntime'));

    const remoteExport = await mcp(base, key, {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'flow_export', arguments: { id: flowId, mode: 'modular' } },
    });
    assert.equal(remoteExport.body.result.isError, undefined, remoteExport.text);
    const exportData = JSON.parse(remoteExport.body.result.content[0].text);
    assert.ok(exportData.files.some((f) => f.path === 'main.js'));
    assert.ok(exportData.files.some((f) => f.path === 'runtime.js'));

    const addScript = await mcp(base, key, {
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: {
        name: 'flow_create_script',
        arguments: { id: flowId, name: 'Extra', type: 'command', commandName: 'extra', version: projectData.project.version },
      },
    });
    assert.equal(addScript.body.result.isError, undefined, addScript.text);
    const added = JSON.parse(addScript.body.result.content[0].text);
    assert.equal(added.created, true);
    assert.equal(added.version, projectData.project.version + 1);

    const readOnlyAdd = await mcp(base, readKey, {
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'flow_create_script', arguments: { id: flowId, name: 'Denied', type: 'module' } },
    });
    assert.equal(readOnlyAdd.body.result.isError, true, 'read-only key must not create scripts');
    const after = await mcp(base, key, {
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { name: 'flow_get_project', arguments: { id: flowId } },
    });
    const afterData = JSON.parse(after.body.result.content[0].text);
    assert.ok(!afterData.scripts.some((s) => s.name === 'Denied'), 'denied mutation must not persist');
  } finally {
    await stopServer(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
