import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../src/templates.js';
import { compileFlow, modularExport, singleFileExport } from '../src/flow/compiler.js';
import { createFlowRuntime } from '../src/flow/runtime.js';
import { blankFlow, blankScript, flowId } from '../public/flow/schema.mjs';

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
