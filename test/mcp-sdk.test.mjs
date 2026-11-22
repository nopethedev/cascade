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

function execDb(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (openErr) => {
      if (openErr) return reject(openErr);
      db.run(sql, params, function (err) {
        const result = { changes: this.changes, lastID: this.lastID };
        db.close();
        if (err) reject(err);
        else resolve(result);
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
    assert.equal(write.getServerVersion()?.version, '1.1.0');
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
    for (const name of ['list_folders', 'create_folder', 'update_document_metadata', 'restore_version', 'duplicate_document', 'delete_document', 'search_documents', 'list_templates', 'list_form_responses']) {
      assert.ok(names.includes(name), `write client should see ${name}`);
    }

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

    const rawMcp = async (payload, key = writeKey.raw) => {
      const res = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { parseError: text }; }
      return { status: res.status, json, text };
    };
    const rawTool = async (name, args) => {
      const response = await rawMcp({ jsonrpc: '2.0', id: 900, method: 'tools/call', params: { name, arguments: args } });
      return response.json.result || response.json.error;
    };

    const readBack = await write.callTool({ name: 'get_document', arguments: { id: createdDoc.id } });
    assert.match(textOf(readBack), /SDK PRIVATE MARKER/);

    const listed = await write.callTool({ name: 'list_documents', arguments: {} });
    assert.ok(JSON.parse(textOf(listed)).documents.some((doc) => doc.id === createdDoc.id));

    const resourceList = await write.listResources();
    assert.ok(resourceList.resources.some((resource) => resource.uri === `cascade://documents/${createdDoc.id}`));
    const resourceRead = await write.readResource({ uri: `cascade://documents/${createdDoc.id}` });
    assert.match(resourceRead.contents[0].text, /SDK PRIVATE MARKER/);

    const createdFolder = JSON.parse(textOf(await write.callTool({
      name: 'create_folder',
      arguments: { name: 'SDK Folder' },
    }))).folder;
    assert.ok(createdFolder.id);
    const folders = JSON.parse(textOf(await write.callTool({ name: 'list_folders', arguments: {} }))).folders;
    assert.ok(folders.some((folder) => folder.id === createdFolder.id));

    const organized = JSON.parse(textOf(await write.callTool({
      name: 'update_document_metadata',
      arguments: { id: createdDoc.id, name: 'SDK organized doc', folderId: createdFolder.id, isPublic: false },
    }))).document;
    assert.equal(organized.filename, 'SDK organized doc');
    assert.equal(organized.folderId, createdFolder.id);
    assert.equal(organized.isPublic, false);
    const folderListing = JSON.parse(textOf(await write.callTool({
      name: 'list_documents', arguments: { folderId: createdFolder.id },
    }))).documents;
    assert.ok(folderListing.some((doc) => doc.id === createdDoc.id));
    assert.equal(folderListing.find((doc) => doc.id === createdDoc.id).filename, 'SDK organized doc');
    const unfiled = JSON.parse(textOf(await write.callTool({
      name: 'update_document_metadata', arguments: { id: createdDoc.id, folderId: null },
    }))).document;
    assert.equal(unfiled.folderId, null);
    const refiled = JSON.parse(textOf(await write.callTool({
      name: 'update_document_metadata', arguments: { id: createdDoc.id, folderId: createdFolder.id },
    }))).document;
    assert.equal(refiled.folderId, createdFolder.id);
    const starred = JSON.parse(textOf(await write.callTool({
      name: 'update_document_metadata', arguments: { id: createdDoc.id, starred: true },
    }))).document;
    assert.equal(starred.starred, true);
    assert.equal(starred.filename, 'SDK organized doc');
    const unstarred = JSON.parse(textOf(await write.callTool({
      name: 'update_document_metadata', arguments: { id: createdDoc.id, starred: false },
    }))).document;
    assert.equal(unstarred.starred, false);

    const searched = JSON.parse(textOf(await write.callTool({
      name: 'search_documents', arguments: { query: 'SDK PRIVATE MARKER' },
    })));
    assert.ok(searched.documents.some((doc) => doc.id === createdDoc.id));
    assert.match(searched.documents.find((doc) => doc.id === createdDoc.id).snippet, /SDK PRIVATE MARKER/);

    const templates = JSON.parse(textOf(await write.callTool({
      name: 'list_templates', arguments: { kind: 'doc' },
    }))).templates;
    assert.ok(templates.some((template) => template.id === 'doc-blank' && template.custom === false));

    const edited = await write.callTool({
      name: 'update_document',
      arguments: { id: createdDoc.id, content: { html: '<h1>SDK PRIVATE MARKER V2</h1>' }, version: createdDoc.version },
    });
    assert.equal(JSON.parse(textOf(edited)).changed, true);
    assert.equal(JSON.parse(textOf(edited)).version, 2);
    const versions = JSON.parse(textOf(await write.callTool({ name: 'list_versions', arguments: { id: createdDoc.id } })));
    assert.equal(versions.current, 2);
    assert.ok(versions.versions.some((version) => version.version === 1));
    const oldVersion = JSON.parse(textOf(await write.callTool({
      name: 'get_version', arguments: { id: createdDoc.id, version: 1 },
    })));
    assert.match(oldVersion.content.html, /SDK PRIVATE MARKER/);

    const restored = JSON.parse(textOf(await write.callTool({
      name: 'restore_version', arguments: { id: createdDoc.id, version: 1 },
    })));
    assert.equal(restored.version, 3);
    const afterRestore = await write.callTool({ name: 'get_document', arguments: { id: createdDoc.id } });
    assert.match(textOf(afterRestore), /SDK PRIVATE MARKER/);
    assert.ok(!textOf(afterRestore).includes('MARKER V2'));

    const raceDoc = JSON.parse(textOf(await write.callTool({
      name: 'create_document',
      arguments: { kind: 'doc', name: 'SDK race doc', content: { html: 'RACE BASE' } },
    }))).document;
    const raceResults = await Promise.all([
      write.callTool({
        name: 'update_document',
        arguments: { id: raceDoc.id, content: { html: 'RACE A' }, version: raceDoc.version },
      }),
      write.callTool({
        name: 'update_document',
        arguments: { id: raceDoc.id, content: { html: 'RACE B' }, version: raceDoc.version },
      }),
    ]);
    const raceSuccesses = raceResults.filter((result) => !result.isError);
    const raceConflicts = raceResults.filter((result) => result.isError);
    assert.equal(raceSuccesses.length, 1, `exactly one concurrent stale update may succeed: ${JSON.stringify(raceResults)}`);
    assert.equal(raceConflicts.length, 1, 'the stale update must return a conflict');
    assert.match(textOf(raceConflicts[0]), /version conflict/i);
    const raceFinal = JSON.parse(textOf(await write.callTool({ name: 'get_document', arguments: { id: raceDoc.id } })));
    assert.ok(['RACE A', 'RACE B'].includes(raceFinal.document.content.html));
    assert.equal(raceFinal.document.version, raceDoc.version + 1);
    assert.equal((await queryRows(dbPath, 'select count(*) as n from doc_versions where fileId = ?', [raceDoc.id]))[0].n, 1, 'one edit must not duplicate the initial v1 snapshot');
    await write.callTool({ name: 'delete_document', arguments: { id: raceDoc.id, confirm: true } });

    const restoreRaceDoc = JSON.parse(textOf(await write.callTool({
      name: 'create_document', arguments: { kind: 'doc', name: 'SDK restore race doc', content: { html: 'RESTORE RACE BASE' } },
    }))).document;
    await write.callTool({
      name: 'update_document', arguments: { id: restoreRaceDoc.id, content: { html: 'RESTORE RACE NEW' }, version: restoreRaceDoc.version },
    });
    const restoreRaceResults = await Promise.all([
      write.callTool({ name: 'restore_version', arguments: { id: restoreRaceDoc.id, version: 1 } }),
      write.callTool({ name: 'restore_version', arguments: { id: restoreRaceDoc.id, version: 1 } }),
    ]);
    assert.equal(restoreRaceResults.filter((result) => !result.isError).length, 1, 'exactly one concurrent restore may commit');
    assert.match(textOf(restoreRaceResults.find((result) => result.isError)), /version conflict/i);
    const restoreRaceFinal = JSON.parse(textOf(await write.callTool({ name: 'get_document', arguments: { id: restoreRaceDoc.id } }))).document;
    assert.equal(restoreRaceFinal.version, 3);
    assert.match(restoreRaceFinal.content.html, /RESTORE RACE BASE/);
    assert.equal((await queryRows(dbPath, 'select count(*) as n from doc_versions where fileId = ?', [restoreRaceDoc.id]))[0].n, 2);
    await write.callTool({ name: 'delete_document', arguments: { id: restoreRaceDoc.id, confirm: true } });

    const duplicate = JSON.parse(textOf(await write.callTool({
      name: 'duplicate_document', arguments: { id: createdDoc.id, name: 'SDK copied doc' },
    }))).document;
    assert.ok(duplicate.id !== createdDoc.id);
    assert.equal(duplicate.filename, 'SDK copied doc');
    assert.equal(duplicate.isPublic, false);
    assert.equal(duplicate.version, 1);
    const originalForDuplicate = JSON.parse(textOf(await write.callTool({ name: 'get_document', arguments: { id: createdDoc.id } }))).document;
    const duplicateForCompare = JSON.parse(textOf(await write.callTool({ name: 'get_document', arguments: { id: duplicate.id } }))).document;
    assert.deepEqual(duplicateForCompare.content, originalForDuplicate.content, 'duplicate must preserve editor JSON exactly');
    const deleteDenied = await write.callTool({
      name: 'delete_document', arguments: { id: duplicate.id, confirm: false },
    });
    assert.equal(deleteDenied.isError, true, 'delete must require explicit confirmation');
    const deleted = JSON.parse(textOf(await write.callTool({
      name: 'delete_document', arguments: { id: duplicate.id, confirm: true },
    })));
    assert.equal(deleted.deleted, true);
    const deletedRead = await write.callTool({ name: 'get_document', arguments: { id: duplicate.id } });
    assert.equal(deletedRead.isError, true);

    const formDoc = JSON.parse(textOf(await write.callTool({
      name: 'create_document',
      arguments: { kind: 'form', name: 'SDK form', content: { title: 'SDK form', fields: [] } },
    }))).document;
    await execDb(dbPath,
      'insert into form_responses (fileId, data, ip, createdAt, updatedAt) values (?, ?, ?, ?, ?)',
      [formDoc.id, JSON.stringify({ answer: 'FORM FIELD VALUE' }), '198.51.100.7', new Date().toISOString(), new Date().toISOString()]);
    const formResponseId = (await queryRows(dbPath, 'select id from form_responses where fileId = ?', [formDoc.id]))[0].id;
    const formResponses = JSON.parse(textOf(await write.callTool({
      name: 'list_form_responses', arguments: { id: formDoc.id },
    })));
    assert.equal(formResponses.name, 'SDK form');
    assert.deepEqual(formResponses.fields, []);
    assert.equal(formResponses.responses.length, 1);
    assert.equal(formResponses.responses[0].data.answer, 'FORM FIELD VALUE');
    assert.deepEqual(Object.keys(formResponses.responses[0]).sort(), ['createdAt', 'data', 'id'], 'only form data and timestamps may be returned');
    assert.ok(!JSON.stringify(formResponses).includes('198.51.100.7'), 'list_form_responses must omit the IP');
    assert.ok(!Object.prototype.hasOwnProperty.call(formResponses.responses[0], 'ip'));
    assert.ok(!JSON.stringify(formResponses).includes(writeKey.raw), 'form responses must not expose API-key material');
    const oneFormResponse = JSON.parse(textOf(await write.callTool({
      name: 'list_form_responses', arguments: { id: formDoc.id, responseId: formResponseId },
    })));
    assert.equal(oneFormResponse.response.id, formResponseId);
    assert.ok(!JSON.stringify(oneFormResponse).includes('198.51.100.7'));

    const { client: read } = await connectSdk(base, readKey.raw);
    const readTools = await read.listTools();
    assert.ok(!readTools.tools.some((tool) => tool.name === 'create_document'), 'read-only tools/list excludes writes');
    for (const name of ['list_folders', 'list_templates', 'search_documents', 'list_form_responses']) {
      assert.ok(readTools.tools.some((tool) => tool.name === name), `read-only client should see ${name}`);
    }
    const readBackByRead = await read.callTool({ name: 'get_document', arguments: { id: createdDoc.id } });
    assert.match(textOf(readBackByRead), /SDK PRIVATE MARKER/);
    const deniedUpdate = await read.callTool({
      name: 'update_document',
      arguments: { id: createdDoc.id, content: { html: 'SDK-PWN' } },
    });
    assert.equal(deniedUpdate.isError, true);
    assert.ok(!JSON.stringify(deniedUpdate).includes('SDK-PWN'));
    const deniedDelete = await read.callTool({
      name: 'delete_document', arguments: { id: createdDoc.id, confirm: true },
    });
    assert.equal(deniedDelete.isError, true, 'read-only keys cannot delete documents');
    const unchanged = await write.callTool({ name: 'get_document', arguments: { id: createdDoc.id } });
    assert.ok(!textOf(unchanged).includes('SDK-PWN'));

    const readOnlyState = async () => ({
      files: await queryRows(dbPath, 'select id, filename, content, version, isPublic, starred, folderId from files order by id'),
      folders: await queryRows(dbPath, 'select id, name, ownerId from folders order by id'),
      versions: await queryRows(dbPath, 'select id, fileId, version, content from doc_versions order by id'),
      responses: await queryRows(dbPath, 'select id, fileId, data from form_responses order by id'),
    });
    const stateBeforeReadOnlyWrites = await readOnlyState();
    const readOnlyWrites = [
      { name: 'create_document', arguments: { kind: 'doc', name: 'READONLY CREATE' } },
      { name: 'update_document', arguments: { id: createdDoc.id, content: { html: 'READONLY UPDATE' } } },
      { name: 'update_document_metadata', arguments: { id: createdDoc.id, name: 'READONLY RENAME' } },
      { name: 'create_folder', arguments: { name: 'READONLY FOLDER' } },
      { name: 'restore_version', arguments: { id: createdDoc.id, version: 1 } },
      { name: 'duplicate_document', arguments: { id: createdDoc.id, name: 'READONLY COPY' } },
      { name: 'delete_document', arguments: { id: createdDoc.id, confirm: true } },
    ];
    for (const call of readOnlyWrites) {
      const result = await read.callTool(call);
      assert.equal(result.isError, true, `read-only key must reject ${call.name}`);
      assert.match(textOf(result), /read-only/i, `${call.name} must fail at the scope gate`);
    }
    assert.deepEqual(await readOnlyState(), stateBeforeReadOnlyWrites, 'read-only rejected writes must not change any state');

    const { client: other } = await connectSdk(base, otherKey.raw);
    const otherFolder = JSON.parse(textOf(await other.callTool({
      name: 'create_folder', arguments: { name: 'Other private folder' },
    }))).folder;
    const otherDoc = JSON.parse(textOf(await other.callTool({
      name: 'create_document',
      arguments: { kind: 'doc', name: 'OTHER SECRET DOCUMENT', content: { html: 'OTHER SECRET BODY' } },
    }))).document;
    const otherForm = JSON.parse(textOf(await other.callTool({
      name: 'create_document',
      arguments: { kind: 'form', name: 'OTHER SECRET FORM', content: { title: 'Other form', fields: [{ id: 'q1', type: 'text', label: 'Answer', required: false }] } },
    }))).document;
    await execDb(dbPath,
      'insert into form_responses (fileId, data, ip, createdAt, updatedAt) values (?, ?, ?, ?, ?)',
      [otherForm.id, JSON.stringify({ q1: 'OTHER SECRET RESPONSE' }), '203.0.113.9', new Date().toISOString(), new Date().toISOString()]);
    const otherResponse = (await queryRows(dbPath, 'select id from form_responses where fileId = ?', [otherForm.id]))[0];
    assert.ok(otherResponse?.id);
    await execDb(dbPath,
      'insert into templates (id, name, kind, category, content, ownerId, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?, ?)',
      ['foreign-sdk-template', 'OTHER SECRET TEMPLATE', 'doc', 'custom', JSON.stringify({ html: 'TEMPLATE SECRET' }), otherRow.id, new Date().toISOString(), new Date().toISOString()]);
    await execDb(dbPath,
      'insert into templates (id, name, kind, category, content, ownerId, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?, ?)',
      ['admin-sdk-template', 'ADMIN SECRET TEMPLATE', 'doc', 'custom', JSON.stringify({ html: 'ADMIN TEMPLATE SECRET' }), adminRow.id, new Date().toISOString(), new Date().toISOString()]);

    const adminFolders = JSON.parse(textOf(await write.callTool({ name: 'list_folders', arguments: {} }))).folders;
    assert.ok(adminFolders.some((folder) => folder.id === createdFolder.id));
    assert.ok(!adminFolders.some((folder) => folder.id === otherFolder.id), 'folder list must not cross owner boundaries');
    const otherFolders = JSON.parse(textOf(await other.callTool({ name: 'list_folders', arguments: {} }))).folders;
    assert.ok(otherFolders.some((folder) => folder.id === otherFolder.id));
    assert.ok(!otherFolders.some((folder) => folder.id === createdFolder.id), 'folder list must not cross owner boundaries');
    const adminDocuments = JSON.parse(textOf(await write.callTool({ name: 'list_documents', arguments: {} }))).documents;
    assert.ok(!adminDocuments.some((doc) => doc.id === otherDoc.id));
    const otherDocuments = JSON.parse(textOf(await other.callTool({ name: 'list_documents', arguments: {} }))).documents;
    assert.ok(!otherDocuments.some((doc) => doc.id === createdDoc.id));
    const adminTemplates = JSON.parse(textOf(await write.callTool({ name: 'list_templates', arguments: { kind: 'doc' } }))).templates;
    assert.ok(!adminTemplates.some((template) => template.id === 'custom:foreign-sdk-template'));
    assert.ok(adminTemplates.some((template) => template.id === 'custom:admin-sdk-template'));
    const otherTemplates = JSON.parse(textOf(await other.callTool({ name: 'list_templates', arguments: { kind: 'doc' } }))).templates;
    assert.ok(otherTemplates.some((template) => template.id === 'custom:foreign-sdk-template'));
    assert.ok(!otherTemplates.some((template) => template.id === 'custom:admin-sdk-template'));

    const otherSearch = JSON.parse(textOf(await other.callTool({
      name: 'search_documents', arguments: { query: 'SDK PRIVATE MARKER' },
    })));
    assert.equal(otherSearch.documents.length, 0, 'search must not cross owner boundaries');
    const otherSearchesOwn = JSON.parse(textOf(await other.callTool({
      name: 'search_documents', arguments: { query: 'OTHER SECRET DOCUMENT' },
    })));
    assert.ok(otherSearchesOwn.documents.some((doc) => doc.id === otherDoc.id));
    const foreignMetadata = await other.callTool({
      name: 'update_document_metadata', arguments: { id: createdDoc.id, name: 'SDK-PWN' },
    });
    assert.equal(foreignMetadata.isError, true);
    assert.match(textOf(foreignMetadata), /document not found/i);
    assert.ok(!JSON.stringify(foreignMetadata).includes('SDK PRIVATE MARKER'));
    const foreignFormResponses = await other.callTool({
      name: 'list_form_responses', arguments: { id: formDoc.id },
    });
    assert.equal(foreignFormResponses.isError, true);
    assert.match(textOf(foreignFormResponses), /document not found/i);
    const foreignOwnResponse = await other.callTool({
      name: 'list_form_responses', arguments: { id: otherForm.id, responseId: otherResponse.id },
    });
    assert.equal(foreignOwnResponse.isError, undefined);
    assert.equal(JSON.parse(textOf(foreignOwnResponse)).response.id, otherResponse.id);
    assert.ok(!JSON.stringify(foreignOwnResponse).includes('203.0.113.9'), 'form response IP must not be exposed');

    const foreignFolderCreate = await other.callTool({
      name: 'create_document', arguments: { kind: 'doc', name: 'SHOULD NOT EXIST', folderId: createdFolder.id },
    });
    assert.equal(foreignFolderCreate.isError, true);
    assert.match(textOf(foreignFolderCreate), /folder not found/i);
    const foreignFolderMove = await other.callTool({
      name: 'update_document_metadata', arguments: { id: otherDoc.id, folderId: createdFolder.id },
    });
    assert.equal(foreignFolderMove.isError, true);
    assert.match(textOf(foreignFolderMove), /folder not found/i);
    assert.ok(!JSON.stringify(foreignFolderMove).includes('SDK Folder'));
    const missingFolderMove = await write.callTool({
      name: 'update_document_metadata', arguments: { id: createdDoc.id, folderId: 'sdk-folder-that-does-not-exist' },
    });
    assert.equal(missingFolderMove.isError, true);
    assert.match(textOf(missingFolderMove), /folder not found/i);
    const foreignUpdate = await other.callTool({
      name: 'update_document', arguments: { id: createdDoc.id, content: { html: 'OTHER SHOULD NOT WRITE' } },
    });
    assert.equal(foreignUpdate.isError, true);
    assert.ok(!JSON.stringify(foreignUpdate).includes('SDK PRIVATE MARKER'));
    const foreignTemplateCreate = await other.callTool({
      name: 'create_document',
      arguments: { kind: 'doc', name: 'SHOULD NOT EXIST', templateId: 'custom:admin-sdk-template' },
    });
    assert.equal(foreignTemplateCreate.isError, true);
    assert.match(textOf(foreignTemplateCreate), /template not found/i);
    assert.ok(!JSON.stringify(foreignTemplateCreate).includes('ADMIN SECRET TEMPLATE'));
    const foreignVersionGet = await other.callTool({ name: 'get_version', arguments: { id: createdDoc.id, version: 1 } });
    assert.equal(foreignVersionGet.isError, true);
    assert.match(textOf(foreignVersionGet), /document not found/i);
    assert.ok(!JSON.stringify(foreignVersionGet).includes('SDK PRIVATE MARKER'));
    assert.ok(!JSON.stringify(foreignVersionGet).includes(createdDoc.id));
    const foreignRestore = await other.callTool({ name: 'restore_version', arguments: { id: createdDoc.id, version: 1 } });
    assert.equal(foreignRestore.isError, true);
    assert.match(textOf(foreignRestore), /document not found/i);
    assert.ok(!JSON.stringify(foreignRestore).includes('SDK PRIVATE MARKER'));
    assert.ok(!JSON.stringify(foreignRestore).includes(createdDoc.id));
    const missingVersionRestore = await write.callTool({ name: 'restore_version', arguments: { id: createdDoc.id, version: 999999 } });
    assert.equal(missingVersionRestore.isError, true);
    assert.match(textOf(missingVersionRestore), /version not found/i);
    const foreignDuplicate = await other.callTool({ name: 'duplicate_document', arguments: { id: createdDoc.id } });
    assert.equal(foreignDuplicate.isError, true);
    assert.match(textOf(foreignDuplicate), /document not found/i);
    assert.ok(!JSON.stringify(foreignDuplicate).includes('SDK PRIVATE MARKER'));
    assert.ok(!JSON.stringify(foreignDuplicate).includes(createdDoc.id));
    const missingDuplicate = await write.callTool({ name: 'duplicate_document', arguments: { id: 'sdk-missing-duplicate-id' } });
    assert.equal(missingDuplicate.isError, true);
    assert.match(textOf(missingDuplicate), /document not found/i);
    const foreignVersions = await other.callTool({ name: 'list_versions', arguments: { id: createdDoc.id } });
    assert.equal(foreignVersions.isError, true);
    assert.ok(!JSON.stringify(foreignVersions).includes('SDK PRIVATE MARKER'));
    const foreignDelete = await other.callTool({ name: 'delete_document', arguments: { id: createdDoc.id, confirm: true } });
    assert.equal(foreignDelete.isError, true);
    assert.match(textOf(foreignDelete), /document not found/i);
    assert.ok(!JSON.stringify(foreignDelete).includes(createdDoc.id));
    assert.equal((await queryRows(dbPath, 'select count(*) as n from files where id = ?', [createdDoc.id]))[0].n, 1);
    const ownMissingResponse = await write.callTool({ name: 'list_form_responses', arguments: { id: formDoc.id, responseId: otherResponse.id } });
    assert.equal(ownMissingResponse.isError, true);
    assert.match(textOf(ownMissingResponse), /response not found/i);

    const shareSet = await write.callTool({
      name: 'update_document_metadata', arguments: { id: createdDoc.id, isPublic: true },
    });
    assert.equal(JSON.parse(textOf(shareSet)).document.isPublic, true);
    const otherPublicRead = await other.callTool({ name: 'get_document', arguments: { id: createdDoc.id } });
    assert.equal(otherPublicRead.isError, true, 'sharing a document must not bypass owner isolation');
    await write.callTool({ name: 'update_document_metadata', arguments: { id: createdDoc.id, isPublic: false } });

    const missingIdForDelete = 'sdk-missing-delete-id';
    const cascadeDoc = JSON.parse(textOf(await write.callTool({
      name: 'create_document', arguments: { kind: 'doc', name: 'SDK cascade doc', content: { html: 'CASCADE V1' } },
    }))).document;
    await write.callTool({
      name: 'update_document', arguments: { id: cascadeDoc.id, content: { html: 'CASCADE V2' }, version: cascadeDoc.version },
    });
    assert.equal((await queryRows(dbPath, 'select count(*) as n from doc_versions where fileId = ?', [cascadeDoc.id]))[0].n, 1, 'one edit must not duplicate the initial v1 snapshot');
    const cascadeDenied = await write.callTool({ name: 'delete_document', arguments: { id: cascadeDoc.id, confirm: false } });
    assert.equal(cascadeDenied.isError, true);
    assert.equal((await queryRows(dbPath, 'select count(*) as n from files where id = ?', [cascadeDoc.id]))[0].n, 1, 'unconfirmed delete must not remove the file');
    assert.ok((await queryRows(dbPath, 'select count(*) as n from doc_versions where fileId = ?', [cascadeDoc.id]))[0].n > 0, 'unconfirmed delete must not remove versions');
    await write.callTool({ name: 'delete_document', arguments: { id: cascadeDoc.id, confirm: true } });
    assert.equal((await queryRows(dbPath, 'select count(*) as n from files where id = ?', [cascadeDoc.id]))[0].n, 0);
    assert.equal((await queryRows(dbPath, 'select count(*) as n from doc_versions where fileId = ?', [cascadeDoc.id]))[0].n, 0, 'delete must cascade versions');

    const cascadeForm = JSON.parse(textOf(await write.callTool({
      name: 'create_document', arguments: { kind: 'form', name: 'SDK cascade form', content: { title: 'Cascade form', fields: [] } },
    }))).document;
    await execDb(dbPath,
      'insert into form_responses (fileId, data, ip, createdAt, updatedAt) values (?, ?, ?, ?, ?)',
      [cascadeForm.id, JSON.stringify({ answer: 'cascade response' }), '192.0.2.44', new Date().toISOString(), new Date().toISOString()]);
    assert.equal((await queryRows(dbPath, 'select count(*) as n from form_responses where fileId = ?', [cascadeForm.id]))[0].n, 1);
    await write.callTool({ name: 'delete_document', arguments: { id: cascadeForm.id, confirm: true } });
    assert.equal((await queryRows(dbPath, 'select count(*) as n from form_responses where fileId = ?', [cascadeForm.id]))[0].n, 0, 'delete must cascade form responses');
    const missingDeleteState = (await queryRows(dbPath, 'select count(*) as n from files'))[0].n;
    const missingDelete = await write.callTool({ name: 'delete_document', arguments: { id: missingIdForDelete, confirm: true } });
    assert.equal(missingDelete.isError, true);
    assert.equal((await queryRows(dbPath, 'select count(*) as n from files'))[0].n, missingDeleteState);

    const injectionDoc = JSON.parse(textOf(await write.callTool({
      name: 'create_document',
      arguments: { kind: 'doc', name: "SQL' OR 1=1 --", content: { html: 'INJECTION BODY' } },
    }))).document;
    const injectionSearch = await write.callTool({
      name: 'search_documents', arguments: { query: "%' OR 1=1; DROP TABLE files; --" },
    });
    assert.equal(injectionSearch.isError, undefined, 'injection-shaped search must be a normal query');
    assert.equal((await queryRows(dbPath, "select count(*) as n from sqlite_master where type = 'table' and name = 'files'", []))[0].n, 1, 'search must not execute injected SQL');
    const wildcardSearch = JSON.parse(textOf(await write.callTool({
      name: 'search_documents', arguments: { query: '%' },
    })));
    assert.ok(wildcardSearch.documents.length <= 100);
    assert.ok(!wildcardSearch.documents.some((doc) => doc.filename === 'OTHER SECRET DOCUMENT'));
    const longQuery = await write.callTool({ name: 'search_documents', arguments: { query: 'x'.repeat(1000) } });
    assert.equal(longQuery.isError, true);
    assert.match(textOf(longQuery), /too long/i);

    const bulkCount = 105;
    const bulkRows = Array.from({ length: bulkCount }, (_, index) => ({
      id: `bulk-sdk-${String(index).padStart(3, '0')}`,
      slug: `bulk-sdk-${String(index).padStart(3, '0')}`,
      filename: `Bulk SDK ${index}`,
      content: JSON.stringify({ html: `BULK SEARCH MARKER ${index}` }),
      now: new Date().toISOString(),
    }));
    for (let start = 0; start < bulkRows.length; start += 50) {
      const chunk = bulkRows.slice(start, start + 50);
      await execDb(dbPath,
        `insert into files (id, slug, filename, mime, size, ownerId, ownerName, isPublic, starred, replicas, kind, folderId, content, version, template, createdAt, updatedAt)
         values ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flatMap((row) => [row.id, row.slug, row.filename, 'application/x-cascade-doc', Buffer.byteLength(row.content), adminRow.id, 'sdk-admin', 0, 0, '[]', 'doc', null, row.content, 1, null, row.now, row.now]));
    }
    const largeSearch = JSON.parse(textOf(await write.callTool({
      name: 'search_documents', arguments: { query: 'BULK SEARCH MARKER', limit: 1000 },
    })));
    assert.equal(largeSearch.documents.length, 100, 'search must cap result sets at 100');
    assert.ok(largeSearch.documents.every((doc) => doc.filename.startsWith('Bulk SDK')));
    assert.ok(!largeSearch.documents.some((doc) => doc.id === injectionDoc.id));

    const beforeBadInput = JSON.parse(textOf(await write.callTool({ name: 'get_document', arguments: { id: createdDoc.id } }))).document;
    for (const content of [[], null, 'not-an-object', 42]) {
      const bad = await rawTool('update_document', { id: createdDoc.id, content });
      assert.equal(bad.isError, true, `wrong-typed content must be rejected: ${JSON.stringify(content)}`);
      assert.match(textOf(bad), /content must be a JSON object/i);
      assert.ok(!String(bad.stack || '').includes(' at '), 'tool error must not include a stack trace');
    }
    const badQuery = await rawTool('search_documents', { query: 42 });
    assert.equal(badQuery.isError, true);
    assert.match(textOf(badQuery), /query must be a string/i);
    const emptyQuery = await write.callTool({ name: 'search_documents', arguments: { query: '' } });
    assert.equal(emptyQuery.isError, true);
    const afterBadInput = JSON.parse(textOf(await write.callTool({ name: 'get_document', arguments: { id: createdDoc.id } }))).document;
    assert.deepEqual(afterBadInput.content, beforeBadInput.content, 'invalid inputs must not partially write content');
    assert.equal(afterBadInput.version, beforeBadInput.version, 'invalid inputs must not advance the version');

    const deepJson = `${'{"a":'.repeat(6000)}1${'}'.repeat(6000)}`;
    const deepBody = `{"jsonrpc":"2.0","id":901,"method":"tools/call","params":{"name":"update_document","arguments":{"id":${JSON.stringify(createdDoc.id)},"content":${deepJson}}}}`;
    const deepResponse = await rawMcp(deepBody);
    assert.equal(deepResponse.status, 200);
    assert.ok(deepResponse.json.result?.isError === true || deepResponse.json.error, `deep JSON must return a clean JSON-RPC/tool error: ${deepResponse.text.slice(0, 500)}`);
    assert.ok(!JSON.stringify(deepResponse.json).includes('RangeError'));
    const oversizedBody = JSON.stringify({
      jsonrpc: '2.0', id: 902, method: 'tools/call',
      params: { name: 'update_document', arguments: { id: createdDoc.id, content: { html: 'X'.repeat(13 * 1024 * 1024) } } },
    });
    const oversizedResponse = await rawMcp(oversizedBody);
    assert.equal(oversizedResponse.status, 200);
    assert.ok(oversizedResponse.json.result?.isError === true || oversizedResponse.json.error, 'oversized content must be rejected cleanly');
    const afterOversized = JSON.parse(textOf(await write.callTool({ name: 'get_document', arguments: { id: createdDoc.id } }))).document;
    assert.deepEqual(afterOversized.content, beforeBadInput.content, 'oversized content must not write');
    const malformed = await rawMcp('{ this is not json');
    assert.equal(malformed.status, 400, 'malformed JSON gets an HTTP parse-error response');
    assert.equal(malformed.json.error.code, -32700);
    assert.ok(!malformed.text.includes(' at '), 'parse errors must not expose a stack trace');

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
    assert.ok(!logs.join('').includes('198.51.100.7'), 'submitter IP must not appear in logs');
    assert.ok(!logs.join('').includes('FORM FIELD VALUE'), 'form data must not appear in logs');
    assert.ok(!logs.join('').includes('RangeError'), 'input hardening must not leak a stack/exception trace');
    const healthAfterSession = await fetch(`${base}/api/health`);
    assert.ok([200, 503].includes(healthAfterSession.status), 'server must remain responsive after the full session');
    assert.equal(child.exitCode, null, 'server must not crash or hang during the full session');
  } finally {
    await stopServer(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
