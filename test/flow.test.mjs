import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../src/templates.js';
import { compileFlow, modularExport, singleFileExport } from '../src/flow/compiler.js';
import { createFlowRuntime } from '../src/flow/runtime.js';
import { blankFlow, blankScript, flowId } from '../public/flow/schema.mjs';
import { redactFlowSecrets } from '../public/flow/secrets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const node = (type, x, y, config = {}) => ({ id: flowId('n'), type, x, y, config });
const edge = (from, pin, to, toPin, kind = 'exec') => ({ id: flowId('w'), from: { node: from, pin }, to: { node: to, pin: toPin }, kind });

function stubDiscord() {
  return `export class Client {
  constructor(options) { this.options = options; this.handlers = Object.create(null); this.user = { id: 'bot-user', username: 'bot' }; }
  on(event, fn) { (this.handlers[event] ||= []).push(fn); return this; }
  once(event, fn) { return this.on(event, fn); }
  isReady() { return true; }
  async login() { return this; }
  async destroy() {}
}
export const GatewayIntentBits = new Proxy({}, { get: (_t, key) => String(key) });
export const Partials = new Proxy({}, { get: (_t, key) => String(key) });
export const Events = {
  ClientReady: 'ready', MessageCreate: 'messageCreate', InteractionCreate: 'interactionCreate',
  GuildMemberAdd: 'guildMemberAdd', GuildMemberRemove: 'guildMemberRemove',
  MessageReactionAdd: 'messageReactionAdd', MessageReactionRemove: 'messageReactionRemove',
  GuildCreate: 'guildCreate', ChannelCreate: 'channelCreate', ThreadCreate: 'threadCreate', RoleCreate: 'roleCreate',
  VoiceStateUpdate: 'voiceStateUpdate', MessageUpdate: 'messageUpdate', MessageDelete: 'messageDelete',
  Error: 'error', Raw: 'raw',
};
export const ActivityType = { Playing: 0, Watching: 1, Listening: 2, Competing: 3, Custom: 4 };
export const ChannelType = { GuildText: 0, GuildVoice: 2, GuildCategory: 4, GuildForum: 15 };
export class EmbedBuilder {
  setTitle(v) { this.title = v; return this; } setDescription(v) { this.description = v; return this; }
  setURL(v) { this.url = v; return this; } setColor(v) { this.color = v; return this; }
  setImage(v) { this.image = v; return this; } setThumbnail(v) { this.thumbnail = v; return this; }
  setFooter(v) { this.footer = v; return this; } addFields(v) { this.fields = v; return this; }
}
export class ActionRowBuilder { constructor() { this.components = []; } addComponents(...c) { this.components.push(...c); return this; } }
export class ButtonBuilder {
  setCustomId(v) { this.customId = v; return this; } setLabel(v) { this.label = v; return this; }
  setStyle(v) { this.style = v; return this; } setDisabled(v) { this.disabled = v; return this; }
  setEmoji(v) { this.emoji = v; return this; }
}
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 };
export class StringSelectMenuBuilder {
  setCustomId(v) { this.customId = v; return this; } setPlaceholder(v) { this.placeholder = v; return this; }
  setMinValues(v) { this.min = v; return this; } setMaxValues(v) { this.max = v; return this; }
  addOptions(v) { this.options = v; return this; }
}
export class UserSelectMenuBuilder extends StringSelectMenuBuilder {}
export class RoleSelectMenuBuilder extends StringSelectMenuBuilder {}
export class ChannelSelectMenuBuilder extends StringSelectMenuBuilder {}
export class MentionableSelectMenuBuilder extends StringSelectMenuBuilder {}
export class ModalBuilder {
  setCustomId(v) { this.customId = v; return this; } setTitle(v) { this.title = v; return this; }
  addComponents(...v) { this.components = v; return this; }
}
export class TextInputBuilder {
  setCustomId(v) { this.customId = v; return this; } setLabel(v) { this.label = v; return this; }
  setStyle(v) { this.style = v; return this; } setRequired(v) { this.required = v; return this; }
  setPlaceholder(v) { this.placeholder = v; return this; } setValue(v) { this.value = v; return this; }
}
export const TextInputStyle = { Short: 1, Paragraph: 2 };
export class REST { setToken() { return this; } async put() { return {}; } }
export const Routes = { applicationCommands: () => '', applicationGuildCommands: () => '' };
export const PermissionFlagsBits = new Proxy({}, { get: (_t, key) => String(key) });
`;
}

function writeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-flow-test-'));
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  fs.mkdirSync(path.join(dir, 'node_modules/discord.js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules/discord.js/package.json'), JSON.stringify({ name: 'discord.js', type: 'module', main: 'index.js', exports: './index.js' }));
  fs.writeFileSync(path.join(dir, 'node_modules/discord.js/index.js'), stubDiscord());
  fs.mkdirSync(path.join(dir, 'node_modules/dotenv'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules/dotenv/package.json'), JSON.stringify({ name: 'dotenv', type: 'module', exports: { '.': './index.js', './config': './config.js' } }));
  fs.writeFileSync(path.join(dir, 'node_modules/dotenv/index.js'), 'export const config = () => ({});\n');
  fs.writeFileSync(path.join(dir, 'node_modules/dotenv/config.js'), '// test stub\n');
  return dir;
}

function syntaxCheck(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-flow-syntax-'));
  for (const [name, contents] of Object.entries(files)) {
    if (!name.endsWith('.js')) continue;
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    const check = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
    assert.equal(check.status, 0, `generated ${name} has invalid syntax:\n${check.stderr}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

test('every Flow template compiles to deterministic, syntactically valid JavaScript', () => {
  const flows = TEMPLATES.filter((t) => t.kind === 'flow');
  assert.ok(flows.length >= 11, 'expected the full Flow template set');
  for (const template of flows) {
    const project = template.build();
    const first = compileFlow(project);
    assert.equal(first.ok, true, `${template.id}: ${first.errors.map((e) => e.message).join('; ')}`);
    assert.ok(first.code.includes('createFlowRuntime'), `${template.id} did not include the runtime`);
    const second = compileFlow(project);
    assert.equal(second.code, first.code, `${template.id} output is not deterministic`);
    syntaxCheck({ 'bot.js': first.code });
    const modular = modularExport(project);
    assert.equal(modular.ok, true, `${template.id} modular export failed`);
    for (const required of ['main.js', 'package.json', '.env.example', 'README.md', 'runtime.js', 'commands/index.js', 'events/index.js']) {
      assert.ok(Object.hasOwn(modular.files, required), `${template.id} modular export missing ${required}`);
    }
    assert.equal(JSON.parse(modular.files['package.json']).scripts.check, 'node --check main.js');
    syntaxCheck(modular.files);
  }
});

test('invalid graphs produce meaningful diagnostics linked to scripts or nodes', () => {
  const project = blankFlow('Broken');
  const command = blankScript('s_broken', 'Broken command', 'command');
  command.command.name = 'broken';
  command.graph.nodes.push({ id: 'n_unknown', type: 'does-not-exist', x: 0, y: 0, config: {} });
  project.scripts = [command];
  const result = compileFlow(project);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'flow.unknown-node' && d.nodeId === 'n_unknown'));
  assert.equal(result.code, null);

  const missing = blankFlow('Missing entry');
  const main = blankScript('s_no_entry', 'No entry', 'main');
  main.graph.nodes = [{ id: 'n_log', type: 'log', x: 0, y: 0, config: {} }];
  missing.scripts = [main];
  const missingResult = compileFlow(missing);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.diagnostics.some((d) => d.code === 'flow.missing-entry' && d.scriptId === 's_no_entry'));
});

test('array operations map, filter and find real fields instead of returning the input', async () => {
  const runtime = createFlowRuntime({ client: {} });
  const rows = [{ name: 'Ada', level: 9 }, { name: 'Grace', level: 4 }];
  assert.deepEqual((await runtime.op({}, 'data.arrayOp', { operation: 'map', input: rows, argument: 'name' })).value, ['Ada', 'Grace']);
  assert.deepEqual((await runtime.op({}, 'data.arrayOp', { operation: 'filter', input: rows, argument: 'level=9' })).value, [rows[0]]);
  assert.deepEqual((await runtime.op({}, 'data.arrayOp', { operation: 'find', input: rows, argument: 'name=Grace' })).value, rows[1]);
});

test('raw credentials block Flow compilation and can be redacted for reads', () => {
  const project = blankFlow('Secret graph');
  project.scripts[0].graph.nodes.push({ id: 'n_secret', type: 'log', x: 0, y: 0, config: { message: 'sk-live-abcdefghijklmnopqrstuvwxyz' } });
  const result = singleFileExport(project);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'flow.secret-in-graph'));
  assert.equal(result.code, null);
  assert.ok(!JSON.stringify(result.files || {}).includes('sk-live-'));
  const redacted = redactFlowSecrets(project);
  assert.ok(!JSON.stringify(redacted).includes('sk-live-'));
  assert.match(JSON.stringify(redacted), /\[redacted\]/);
});

test('custom packages cannot alias unsafe code or network operations without declared permissions', () => {
  const project = blankFlow('Custom permissions');
  project.customNodes = [{ type: 'custom:runner', base: 'custom-code', version: '1.0.0' }];
  project.scripts[0].graph.nodes.push({ id: 'n_runner', type: 'custom:runner', x: 0, y: 0, config: { code: 'return { value: 1 };' } });
  const blocked = compileFlow(project);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.diagnostics.some((diagnostic) => diagnostic.code === 'flow.custom-node-permission'));
  project.customNodes[0].permissions = ['unsafe-code'];
  const allowed = compileFlow(project);
  assert.equal(allowed.ok, true, allowed.errors.map((error) => error.message).join('; '));
  assert.ok(allowed.diagnostics.some((diagnostic) => diagnostic.code === 'flow.custom-code'));
});

test('runtime rejects traversal database paths and private-network HTTP targets', async () => {
  const traversal = createFlowRuntime({ client: {}, project: { database: { backend: 'json', jsonPath: '../../etc/passwd' } } });
  await assert.rejects(traversal.op({}, 'db.connect', {}), /Database path must stay inside/);
  const ssrf = createFlowRuntime({ client: {} });
  await assert.rejects(ssrf.op({}, 'http.request', { url: 'http://127.0.0.1:3000/secret' }), /private or local/);
  await assert.rejects(ssrf.op({}, 'http.request', { url: 'file:///etc/passwd' }), /http and https/);
});

test('custom node packages resolve to real runtime operations with versioned metadata', () => {
  const project = blankFlow('Custom nodes');
  const command = blankScript('s_custom', 'Custom command', 'command');
  command.command.name = 'custom';
  project.scripts = [command];
  project.customNodes = [{ type: 'custom:double', title: 'Double', base: 'math-op', version: '1.2.0', enabled: true }];
  command.graph.nodes.push({ id: 'n_custom', type: 'custom:double', x: 0, y: 0, config: { operation: 'multiply', a: 4, b: 5 } });
  const result = compileFlow(project);
  assert.equal(result.ok, true, result.errors.map((e) => e.message).join('; '));
  assert.match(result.code, /data\.math/);
  assert.equal(result.diagnostics.some((d) => d.code === 'flow.custom-node-invalid'), false);

  const disabled = blankFlow('Bad custom nodes');
  disabled.customNodes = [{ type: 'custom:bad', base: 'does-not-exist', enabled: true }];
  assert.ok(compileFlow(disabled).diagnostics.some((d) => d.code === 'flow.custom-node-invalid'));
});

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

test('exported bots run a real authenticated webhook listener', { timeout: 20000 }, async () => {
  const project = blankFlow('Webhook bot');
  const main = project.scripts[0];
  const entry = main.graph.nodes.find((node) => node.type === 'main-entry');
  const webhook = { id: 'n_webhook', type: 'webhook-handler', x: 300, y: 120, config: { path: '/hooks/cascade', secretEnv: 'WEBHOOK_SECRET' } };
  const log = { id: 'n_webhook_log', type: 'log', x: 600, y: 120, config: {} };
  main.graph.nodes.push(webhook, log);
  main.graph.edges.push(
    edge(entry.id, 'next', webhook.id, 'exec'),
    edge(webhook.id, 'next', log.id, 'exec'),
    edge(webhook.id, 'payload', log.id, 'message', 'data'),
  );
  const exported = singleFileExport(project);
  assert.equal(exported.ok, true, exported.errors.map((error) => error.message).join('; '));
  const dir = writeProject(exported.files);
  const port = await freePort();
  const child = spawn(process.execPath, ['bot.js'], {
    cwd: dir,
    env: { ...process.env, FLOW_DRY_RUN: '1', FLOW_WEBHOOK_PORT: String(port), FLOW_WEBHOOK_HOST: '127.0.0.1', WEBHOOK_SECRET: 'cascade-webhook-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stdout += chunk.toString(); });
  try {
    const deadline = Date.now() + 8000;
    while (!stdout.includes('webhook listener') && Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`webhook bot exited early:\n${stdout}`);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    assert.match(stdout, /webhook listener/, 'webhook listener did not start');
    const wrong = await fetch(`http://127.0.0.1:${port}/hooks/cascade`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'wrong' }, body: '{"secret":"bad"}',
    });
    assert.equal(wrong.status, 401);
    const response = await fetch(`http://127.0.0.1:${port}/hooks/cascade`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'cascade-webhook-secret' }, body: '{"hello":"world"}',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.match(stdout, /hello: 'world'/);
    const missing = await fetch(`http://127.0.0.1:${port}/missing`, { method: 'POST', body: '{}' });
    assert.equal(missing.status, 404);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 1500); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('modular export includes a working webhook listener', { timeout: 20000 }, async () => {
  const project = blankFlow('Modular webhook');
  const main = project.scripts[0];
  const entry = main.graph.nodes.find((node) => node.type === 'main-entry');
  const webhook = { id: 'n_modular_webhook', type: 'webhook-handler', x: 300, y: 120, config: { path: '/hooks/modular', secretEnv: 'WEBHOOK_SECRET' } };
  const log = { id: 'n_modular_log', type: 'log', x: 600, y: 120, config: {} };
  main.graph.nodes.push(webhook, log);
  main.graph.edges.push(edge(entry.id, 'next', webhook.id, 'exec'), edge(webhook.id, 'next', log.id, 'exec'), edge(webhook.id, 'payload', log.id, 'message', 'data'));
  const exported = modularExport(project);
  assert.equal(exported.ok, true, exported.errors.map((error) => error.message).join('; '));
  assert.ok(exported.files['webhooks.js'].includes('createServer'));
  assert.ok(exported.files['main.js'].includes("./webhooks.js"));
  syntaxCheck(exported.files);
  const dir = writeProject(exported.files);
  const port = await freePort();
  const child = spawn(process.execPath, ['main.js'], {
    cwd: dir,
    env: { ...process.env, FLOW_DRY_RUN: '1', FLOW_WEBHOOK_PORT: String(port), FLOW_WEBHOOK_HOST: '127.0.0.1', WEBHOOK_SECRET: 'modular-webhook-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stdout += chunk.toString(); });
  try {
    const deadline = Date.now() + 8000;
    while (!stdout.includes('webhook listener') && Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`modular webhook bot exited early:\n${stdout}`);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    assert.match(stdout, /webhook listener/, 'modular webhook listener did not start');
    const response = await fetch(`http://127.0.0.1:${port}/hooks/modular`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'modular-webhook-secret' }, body: '{"modular":true}',
    });
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.match(stdout, /modular: true/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 1500); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('offline contracts cover OpenAI, MongoDB and Lavalink shapes without live services', async () => {
  process.env.FLOW_TEST_OPENAI_KEY = 'offline-key';
  process.env.FLOW_TEST_MONGO_URI = 'mongodb://stub/flow';
  process.env.FLOW_TEST_LAVALINK = 'offline-lavalink';
  try {
    class OpenAIStub {
      constructor(options) { this.options = options; this.chat = { completions: { create: async (body) => ({ choices: [{ message: { content: `stub:${body.messages.at(-1).content}` } }], usage: { total_tokens: 7 } }) } }; }
    }
    const ai = createFlowRuntime({ client: {}, deps: { openai: { default: OpenAIStub } } });
    const completion = await ai.op({}, 'ai.chat', { prompt: 'hello', env: 'FLOW_TEST_OPENAI_KEY', model: 'stub-model' });
    assert.equal(completion.text, 'stub:hello');
    assert.equal(completion.usage.total_tokens, 7);

    const rows = [];
    class CollectionStub {
      async createIndex(index) { this.index = index; }
      async updateOne(filter, update) { const i = rows.findIndex((row) => row.collection === filter.collection && row.key === filter.key); const next = update.$set; if (i >= 0) rows[i] = next; else rows.push(next); }
      async findOne(filter) { return rows.find((row) => row.collection === filter.collection && row.key === filter.key) || null; }
      find(filter) { return { toArray: async () => rows.filter((row) => row.collection === filter.collection) }; }
      async deleteOne(filter) { const i = rows.findIndex((row) => row.collection === filter.collection && row.key === filter.key); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; }
    }
    class MongoClientStub {
      constructor(uri) { this.uri = uri; this.collection = new CollectionStub(); }
      async connect() { this.connected = true; }
      db() { return { collection: () => this.collection }; }
    }
    const mongo = createFlowRuntime({ client: {}, deps: { mongodb: { MongoClient: MongoClientStub } }, project: { database: { backend: 'mongodb', env: 'FLOW_TEST_MONGO_URI' } } });
    await mongo.op({}, 'db.connect', {});
    await mongo.op({}, 'db.set', { collection: 'users', key: 'u1', value: { name: 'Ada' } });
    assert.deepEqual((await mongo.op({}, 'db.get', { collection: 'users', key: 'u1' })).value, { name: 'Ada' });
    assert.equal((await mongo.op({}, 'db.inspect', { collection: 'users' })).rows.length, 1);
    assert.equal((await mongo.op({}, 'db.delete', { collection: 'users', key: 'u1' })).deleted, true);

    class ShoukakuStub {
      constructor(connector, nodes, options) { this.connector = connector; this.nodes = nodes; this.options = options; this.players = new Map(); }
      getIdealNode() { return { rest: { resolve: async (query) => ({ tracks: [{ encoded: 'track', info: { title: query } }] }) } }; }
      async joinVoiceChannel({ guildId, channelId }) { const player = { guildId, channelId, queue: [] }; this.players.set(guildId, player); return player; }
    }
    const music = createFlowRuntime({
      client: {},
      deps: { shoukaku: { Connectors: { DiscordJS: class { constructor(client) { this.client = client; } } }, Shoukaku: ShoukakuStub } },
      project: { lavalink: { enabled: true, nodes: [{ name: 'offline', url: 'localhost:2333', authEnv: 'FLOW_TEST_LAVALINK' }] } },
    });
    const manager = (await music.op({}, 'music.connect', {})).manager;
    assert.equal(manager.nodes.length, 1);
    assert.equal(manager.nodes[0].auth, 'offline-lavalink');
    const search = await music.op({}, 'music.search', { query: 'cascade' });
    assert.equal(search.tracks[0].info.title, 'cascade');
  } finally {
    delete process.env.FLOW_TEST_OPENAI_KEY;
    delete process.env.FLOW_TEST_MONGO_URI;
    delete process.env.FLOW_TEST_LAVALINK;
  }
});

test('single-file export runs a real graph, returns a reply and supports prefix commands', async () => {
  const project = blankFlow('Ping Bot');
  const command = blankScript('s_ping', 'Ping', 'command');
  command.command.name = 'ping';
  command.command.description = 'Ping';
  const entry = command.graph.nodes[0];
  const reply = node('command-respond', 320, 100, { content: 'Pong! 🏓' });
  command.graph.nodes.push(reply);
  command.graph.edges.push(edge(entry.id, 'next', reply.id, 'exec'));
  const prefix = blankScript('s_prefix', 'Hello', 'command');
  prefix.command = { ...prefix.command, name: 'hello', kind: 'prefix' };
  const prefixReply = node('command-respond', 320, 100, { content: 'Hello from prefix' });
  prefix.graph.nodes.push(prefixReply);
  prefix.graph.edges.push(edge(prefix.graph.nodes[0].id, 'next', prefixReply.id, 'exec'));
  project.scripts = [command, prefix];

  const exported = singleFileExport(project);
  assert.equal(exported.ok, true);
  const dir = writeProject(exported.files);
  const previousDryRun = process.env.FLOW_DRY_RUN;
  process.env.FLOW_DRY_RUN = '1';
  try {
    const bot = await import(`${pathToFileURL(path.join(dir, 'bot.js')).href}?v=${Date.now()}`);
    const replies = [];
    const interaction = {
      commandName: 'ping',
      user: { id: 'user-1', username: 'tester' },
      channel: { id: 'channel-1' },
      guild: { id: 'guild-1' },
      member: { id: 'member-1' },
      options: { get: () => undefined },
      deferred: false,
      replied: false,
      async reply(payload) { replies.push(payload); },
    };
    const scripts = Object.fromEntries(exported.scripts.map((s) => [s.name, s.id]));
    await bot.runFlowScript(scripts.Ping, { interaction });
    assert.equal(replies[0].content, 'Pong! 🏓');

    const prefixReplies = [];
    await bot.runFlowScript(scripts.Hello, {
      message: {
        content: '!hello',
        channel: { id: 'channel-1', send: async (payload) => prefixReplies.push(payload) },
        async reply(payload) { prefixReplies.push(payload); },
      },
      author: { id: 'user-1', username: 'tester' },
      channel: { id: 'channel-1' },
      guild: { id: 'guild-1' },
      member: { id: 'member-1' },
    });
    assert.equal(prefixReplies[0].content, 'Hello from prefix');
  } finally {
    if (previousDryRun === undefined) delete process.env.FLOW_DRY_RUN;
    else process.env.FLOW_DRY_RUN = previousDryRun;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('shared Main variables and functions are available to command scripts', async () => {
  const project = blankFlow('Shared Bot');
  const main = blankScript('s_main', 'Main', 'main');
  main.exports = { variables: ['sharedValue'], functions: ['shout'] };
  const text = node('text', 260, 260, { value: 'shared-data' });
  const set = node('global-set', 260, 100, { name: 'sharedValue', scope: 'global' });
  const define = node('function-define', 540, 100, {
    name: 'shout', params: 'input', body: 'return String(input).toUpperCase();',
  });
  main.graph.nodes.push(text, set, define);
  main.graph.edges.push(
    edge(main.graph.nodes[0].id, 'next', set.id, 'exec'),
    edge(set.id, 'next', define.id, 'exec'),
    edge(text.id, 'value', set.id, 'value', 'data'),
  );

  const use = blankScript('s_use', 'Use shared', 'command');
  use.command = { ...use.command, name: 'use', description: 'Read shared state' };
  const read = node('use-from-main', 320, 260, { name: 'sharedValue', kind: 'variable' });
  const useReply = node('command-respond', 600, 100, { content: 'fallback' });
  use.graph.nodes.push(read, useReply);
  use.graph.edges.push(
    edge(use.graph.nodes[0].id, 'next', useReply.id, 'exec'),
    edge(read.id, 'value', useReply.id, 'content', 'data'),
  );

  const call = blankScript('s_call', 'Call shared', 'command');
  call.command = { ...call.command, name: 'call', description: 'Call shared function' };
  const input = node('json-value', 300, 300, { value: { input: 'hello' } });
  const fn = node('function-call', 560, 160, { name: 'shout' });
  const callReply = node('command-respond', 820, 100, { content: 'fallback' });
  call.graph.nodes.push(input, fn, callReply);
  call.graph.edges.push(
    edge(call.graph.nodes[0].id, 'next', callReply.id, 'exec'),
    edge(input.id, 'value', fn.id, 'args', 'data'),
    edge(fn.id, 'result', callReply.id, 'content', 'data'),
  );
  project.scripts = [main, use, call];

  const exported = singleFileExport(project);
  assert.equal(exported.ok, true);
  const dir = writeProject(exported.files);
  const previousDryRun = process.env.FLOW_DRY_RUN;
  process.env.FLOW_DRY_RUN = '1';
  try {
    const bot = await import(`${pathToFileURL(path.join(dir, 'bot.js')).href}?v=${Date.now()}`);
    const ids = Object.fromEntries(exported.scripts.map((s) => [s.name, s.id]));
    const replies = [];
    const interaction = {
      commandName: 'use',
      user: { id: 'u' }, channel: { id: 'c' }, guild: { id: 'g' }, member: { id: 'm' },
      options: { get: () => undefined }, deferred: false, replied: false,
      async reply(payload) { replies.push(payload); },
    };
    await bot.runFlowScript(ids.Main, { client: bot.client });
    await bot.runFlowScript(ids['Use shared'], { interaction });
    await bot.runFlowScript(ids['Call shared'], { interaction: { ...interaction, commandName: 'call' } });
    assert.equal(replies[0].content, 'shared-data');
    assert.equal(replies[1].content, 'HELLO');
  } finally {
    if (previousDryRun === undefined) delete process.env.FLOW_DRY_RUN;
    else process.env.FLOW_DRY_RUN = previousDryRun;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('JSON and SQLite adapters persist, read and delete records', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-flow-db-'));
  try {
    const jsonPath = path.join(dir, 'json', 'flow-db.json');
    const json = createFlowRuntime({
      client: {}, deps: {}, project: { database: { backend: 'json', jsonPath } },
    });
    await json.op({}, 'db.set', { collection: 'users', key: 'u1', value: { coins: 7 } });
    await Promise.all(Array.from({ length: 12 }, (_, i) => json.op({}, 'db.set', { collection: 'users', key: `u${i + 2}`, value: { coins: i } })));
    assert.deepEqual((await json.op({}, 'db.get', { collection: 'users', key: 'u1' })).value, { coins: 7 });
    const rows = await json.op({}, 'db.inspect', { collection: 'users', limit: 50 });
    assert.equal(rows.rows.length, 13);
    assert.equal((await json.op({}, 'db.delete', { collection: 'users', key: 'u1' })).deleted, true);
    const saved = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.equal(saved.collections.users.u1, undefined);
    assert.equal(saved.collections.users.u2.coins, 0);

    process.env.FLOW_TEST_SQLITE = `sqlite:${path.join(dir, 'flow.sqlite')}`;
    const sqlite = createFlowRuntime({
      client: {}, deps: {},
      project: { database: { backend: 'sqlite', env: 'FLOW_TEST_SQLITE', jsonPath: path.join(dir, 'unused.json') } },
    });
    await sqlite.op({}, 'db.set', { collection: 'guilds', key: 'g1', value: { name: 'QA' } });
    assert.deepEqual((await sqlite.op({}, 'db.get', { collection: 'guilds', key: 'g1' })).value, { name: 'QA' });
    const sqliteAll = await sqlite.op({}, 'db.inspect', { collection: 'guilds' });
    assert.equal(sqliteAll.rows.length, 1);
    assert.equal((await sqlite.op({}, 'db.delete', { collection: 'guilds', key: 'g1' })).deleted, true);
    await sqlite.db.connection.close();
    delete process.env.FLOW_TEST_SQLITE;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('export strips raw credential values while keeping environment names', () => {
  const project = blankFlow('Secrets');
  project.project.lavalink = {
    enabled: true,
    nodes: [{ name: 'main', url: 'localhost:2333', authEnv: 'LAVALINK_PASSWORD', auth: 'raw-lavalink-secret' }],
  };
  project.project.database = { backend: 'json', env: 'DATABASE_URL', jsonPath: 'data/db.json', password: 'raw-db-secret' };
  const result = singleFileExport(project);
  assert.equal(result.ok, true);
  const all = Object.values(result.files).join('\n');
  assert.ok(!all.includes('raw-lavalink-secret'));
  assert.ok(!all.includes('raw-db-secret'));
  assert.ok(result.files['bot.js'].includes('LAVALINK_PASSWORD'));
  const modular = modularExport(project);
  const modularAll = Object.values(modular.files).join('\n');
  assert.ok(!modularAll.includes('raw-lavalink-secret'));
  assert.ok(!modularAll.includes('raw-db-secret'));
  assert.ok(modular.files['config.js'].includes('authEnv'));
});

test('Flow editor view includes the canvas, library, compiler and export controls', async () => {
  const html = await ejs.renderFile(path.join(ROOT, 'views/editors/flow.ejs'), {
    theme: { siteName: 'Cascade QA', accent: '#2563eb', bg: '#ffffff', surface: '#ffffff', text: '#18181b' },
    user: { username: 'qa', role: 'user' },
    path: '/edit/flow-qa',
    mode: 'main',
    title: 'Flow QA',
    filename: 'Flow QA',
    kind: { icon: 'FLOW', label: 'Discord bot' },
    file: { id: 'flow-qa', filename: 'Flow QA', version: 1, isPublic: false },
    content: blankFlow('Flow QA'),
  });
  for (const needle of [
    'id="flow-canvas-wrap"', 'id="flow-nodes"', 'id="flow-add-node"', 'id="flow-compile"',
    'id="flow-library"', 'id="flow-export"', 'id="flow-test"', 'id="flow-inspector"',
    'id="flow-mobile-project"', 'id="flow-code"', 'id="flow-problems"', 'window.__DOC__',
  ]) assert.ok(html.includes(needle), `Flow editor missing ${needle}`);
});
