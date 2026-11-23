/* Cascade Flow graph compiler.
 *
 * The compiler is deliberately deterministic: scripts and nodes keep their
 * stored order, generated identifiers are derived from node IDs, and exported
 * JSON is serialized with sorted object keys where order is not meaningful.
 */
import { NODE_BY_TYPE, EVENTS, PIN_TYPES } from '../../public/flow/nodes.mjs';
import { normalizeFlow } from '../../public/flow/schema.mjs';
import { scanFlowSecrets } from '../../public/flow/secrets.mjs';
import { createFlowRuntime } from './runtime.js';
import '../../public/game/lua.js';

const PRIVILEGED_INTENTS = ['MessageContent', 'GuildMembers', 'Presence', 'GuildPresences'];
const VALID_BACKENDS = ['json', 'sqlite', 'mongodb'];
const ENTRY_TYPES = new Set(['main-entry', 'command-entry', ...Object.values(EVENTS).map((e) => e.node)]);
const EXEC = 'exec';

const q = (value) => JSON.stringify(String(value));
const safe = (value) => String(value || 'script').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60);
const slug = (value) => String(value || 'script').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'script';
const asArray = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const literal = (value) => {
  if (value === undefined) return 'undefined';
  const json = JSON.stringify(value);
  return json === undefined ? 'undefined' : json;
};

function diag(diagnostics, severity, code, message, nodeId = null, scriptId = null, hint = '') {
  diagnostics.push({ severity, code, message, nodeId, scriptId, hint });
}

const PACKAGE_PERMISSIONS = {
  'script.custom': 'unsafe-code',
  'script.defineFunction': 'unsafe-code',
  'http.request': 'network',
  'http.websocket': 'network',
  'http.webhook': 'network', 'http.paginate': 'network',
  'db.set': 'database', 'db.get': 'database', 'db.delete': 'database', 'db.query': 'database',
  'db.aggregate': 'database', 'db.transaction': 'database', 'db.connect': 'database', 'db.schema': 'database', 'db.inspect': 'database',
  'ai.chat': 'ai', 'ai.json': 'ai', 'ai.tools': 'ai', 'ai.embed': 'ai', 'ai.image': 'ai', 'ai.moderation': 'ai', 'ai.memory': 'ai',
  'music.connect': 'voice', 'music.play': 'voice', 'music.search': 'voice', 'music.queue': 'voice',
  'music.join': 'voice', 'music.leave': 'voice', 'music.filter': 'voice', 'music.events': 'voice',
};

function packagePermissionError(pkg, base) {
  const required = PACKAGE_PERMISSIONS[base?.operation];
  if (!required) return null;
  const permissions = asArray(pkg?.permissions).map((permission) => String(permission));
  return permissions.includes(required)
    ? null
    : `Custom node “${pkg?.type || 'unnamed'}” aliases a ${required} operation; declare permissions: ["${required}"].`;
}

let customDefs = new Map();

function loadCustomDefs(project) {
  customDefs = new Map();
  for (const pkg of asArray(project?.customNodes)) {
    if (!pkg || pkg.enabled === false || typeof pkg.type !== 'string' || !pkg.type.startsWith('custom:')) continue;
    const base = NODE_BY_TYPE.get(pkg.base);
    if (!base || !base.operation || (base.special && base.special !== 'data')) continue;
    if (packagePermissionError(pkg, base)) continue;
    const def = { ...base, type: pkg.type, title: String(pkg.title || base.title), category: 'Custom', color: pkg.color || '#a855f7', custom: true, version: String(pkg.version || '1.0.0'), permissions: asArray(pkg.permissions) };
    customDefs.set(def.type, def);
  }
}

function nodeDef(node) {
  return customDefs.get(node?.type) || NODE_BY_TYPE.get(node?.type) || null;
}

function pinsOf(node) {
  const def = nodeDef(node);
  if (!def) return { inputs: [], outputs: [] };
  return { inputs: def.inputs || [], outputs: def.outputs || [] };
}

function isDataPin(pin) { return pin && pin.kind !== EXEC; }
function isExecPin(pin) { return pin && pin.kind === EXEC; }

function compatible(from, to) {
  if (!from || !to) return false;
  const a = String(from).toLowerCase();
  const b = String(to).toLowerCase();
  if (a === b || a === 'any' || b === 'any') return true;
  if (a === 'json' || b === 'json') return true;
  if (a === 'number' && b === 'string') return true;
  if (a === 'string' && b === 'number') return true;
  return false;
}

function pinBy(node, id) {
  const { inputs, outputs } = pinsOf(node);
  return inputs.find((p) => p.id === id) || outputs.find((p) => p.id === id) || null;
}

function hasExecInput(node) {
  return pinsOf(node).inputs.some(isExecPin);
}

function isEntryNode(node) {
  return !!nodeDef(node)?.special && nodeDef(node).special === 'entry';
}

function isDataOnly(node) {
  return !hasExecInput(node) && !isEntryNode(node) && !['comment', 'group'].includes(nodeDef(node)?.special);
}

function isWebhookNode(node) {
  return nodeDef(node)?.operation === 'http.webhook';
}

function webhookPath(node) {
  let value = String(node?.config?.path || '/webhook').trim();
  if (!value.startsWith('/')) value = `/${value}`;
  value = value.replace(/\/+$/, '') || '/';
  return value;
}

function webhookRouteData(compiled) {
  const routes = [];
  for (const item of compiled) {
    for (const node of item.script.graph.nodes || []) {
      if (!isWebhookNode(node)) continue;
      routes.push({
        nodeId: node.id,
        scriptId: item.script.id,
        sid: item.sid,
        path: webhookPath(node),
        secretEnv: String(node.config?.secretEnv || 'WEBHOOK_SECRET').trim(),
      });
    }
  }
  return routes;
}

function defaultFor(node, key) {
  const field = (nodeDef(node)?.fields || []).find((f) => f.key === key);
  return field?.default;
}

function fieldsFor(node) {
  return nodeDef(node)?.fields || [];
}

class Builder {
  constructor() {
    this.lines = [];
    this.marks = [];
  }
  push(line = '') { this.lines.push(line); return this; }
  mark(nodeId, scriptId) { this.marks.push({ nodeId, scriptId, line: this.lines.length + 1 }); }
  toString() { return this.lines.join('\n'); }
  get lineCount() { return this.lines.length; }
}

function secretDiagnostics(content, project, diagnostics) {
  const findings = scanFlowSecrets(content?.scripts || []);
  for (const finding of findings) {
    const match = /^\[(\d+)\]\.graph\.nodes\.\[(\d+)\]/.exec(finding.path);
    const script = match ? project.scripts?.[Number(match[1])] : null;
    const node = match ? script?.graph?.nodes?.[Number(match[2])] : null;
    diag(diagnostics, 'error', 'flow.secret-in-graph', `A raw credential is stored at ${finding.path}. Use an *Env field or an environment variable name instead.`, node?.id || null, script?.id || null, 'Remove the raw credential from the graph before compiling or exporting.');
  }
}

function runValidation(content, project, diagnostics) {
  const scripts = asArray(project.scripts);
  const ids = new Set();
  const scriptNames = new Set();
  const commandNames = new Set();
  const mainScripts = scripts.filter((s) => s.type === 'main');
  if (!scripts.filter((s) => s.enabled).length) diag(diagnostics, 'error', 'flow.no-enabled-scripts', 'Enable at least one script before compiling.');
  if (mainScripts.length > 1) diag(diagnostics, 'warning', 'flow.multiple-main', 'More than one Main script is present; every Main script runs when the client becomes ready.');

  for (const script of scripts) {
    if (ids.has(script.id)) diag(diagnostics, 'error', 'flow.duplicate-script-id', `Duplicate script id "${script.id}".`, null, script.id);
    ids.add(script.id);
    if (scriptNames.has(script.name) && script.name) diag(diagnostics, 'warning', 'flow.duplicate-script-name', `Two scripts are named "${script.name}".`, null, script.id);
    scriptNames.add(script.name);
    if (script.type === 'command') {
      const name = String(script.command?.name || '').trim().toLowerCase();
      if (!/^[a-z0-9_-]{1,32}$/.test(name)) diag(diagnostics, 'error', 'flow.invalid-command-name', `Command "${script.name}" needs a lowercase name using a-z, 0-9, "-" or "_".`, null, script.id);
      if (commandNames.has(name)) diag(diagnostics, 'error', 'flow.duplicate-command', `Command name "${name}" is registered more than once.`, null, script.id);
      commandNames.add(name);
      if (script.command?.kind === 'slash' && name.length > 32) diag(diagnostics, 'error', 'flow.command-too-long', 'Slash command names are limited to 32 characters.', null, script.id);
      const options = asArray(script.command?.options);
      for (const option of options) {
        if (!option?.name || !option?.description) diag(diagnostics, 'error', 'flow.invalid-option', `Command "${name}" has an option without a name or description.`, null, script.id);
      }
    }
    if (script.type === 'event' && !EVENTS[script.event] && !['raw', 'custom'].includes(script.event)) {
      diag(diagnostics, 'warning', 'flow.unknown-event', `Script "${script.name}" uses unknown gateway event "${script.event}".`, null, script.id);
    }
    if (!script.enabled) continue;
    const nodes = script.graph.nodes || [];
    const edges = script.graph.edges || [];
    const nodeIds = new Set();
    for (const node of nodes) {
      if (nodeIds.has(node.id)) diag(diagnostics, 'error', 'flow.duplicate-node-id', `Duplicate node id "${node.id}".`, node.id, script.id);
      nodeIds.add(node.id);
      const def = nodeDef(node);
      if (!def) {
        diag(diagnostics, 'error', 'flow.unknown-node', `Unknown node type "${node.type}". Add the missing custom node package or remove the node.`, node.id, script.id);
        continue;
      }
      for (const field of fieldsFor(node)) {
        if (!field.required) continue;
        const value = node.config?.[field.key];
        if (value === undefined || value === null || String(value).trim() === '') {
          diag(diagnostics, 'error', 'flow.required-field', `${def.title}: "${field.label}" is required.`, node.id, script.id);
        }
      }
      if (def.special === 'comment' && node.config?.text) { /* comments are intentionally inert */ }
    }
    const incoming = new Map();
    for (const edge of edges) {
      const from = nodes.find((n) => n.id === edge.from?.node);
      const to = nodes.find((n) => n.id === edge.to?.node);
      if (!from || !to) {
        diag(diagnostics, 'error', 'flow.edge-missing-node', 'A connection references a deleted node.', to?.id || from?.id || null, script.id);
        continue;
      }
      const fromPin = pinBy(from, edge.from.pin);
      const toPin = pinBy(to, edge.to.pin);
      if (!fromPin || !toPin) {
        diag(diagnostics, 'error', 'flow.edge-missing-pin', `Connection uses a pin that does not exist on ${nodeDef(to)?.title || to.type}.`, to.id, script.id);
        continue;
      }
      const fromExec = isExecPin(fromPin), toExec = isExecPin(toPin);
      if (fromExec !== toExec) {
        diag(diagnostics, 'error', 'flow.mixed-edge', 'Execution pins can only connect to execution pins, and data pins can only connect to data pins.', to.id, script.id);
        continue;
      }
      if (edge.kind && edge.kind !== (fromExec ? 'exec' : 'data')) {
        diag(diagnostics, 'error', 'flow.edge-kind', 'Connection kind does not match its pins.', to.id, script.id);
        continue;
      }
      const key = `${to.id}:${edge.to.pin}`;
      if (incoming.has(key)) diag(diagnostics, 'error', 'flow.multiple-inputs', `An input pin has more than one incoming connection.`, to.id, script.id);
      incoming.set(key, edge);
      if (!compatible(fromPin.type, toPin.type)) {
        diag(diagnostics, 'error', 'flow.type-mismatch', `Cannot connect ${fromPin.type} "${fromPin.label}" to ${toPin.type} "${toPin.label}".`, to.id, script.id,
          'Insert a Convert Type node or change the destination pin.');
      }
    }
    const outgoing = new Map();
    for (const edge of edges) {
      const key = `${edge.from?.node}:${edge.from?.pin}`;
      outgoing.set(key, [...(outgoing.get(key) || []), edge]);
    }
    for (const [key, list] of outgoing) {
      if (list.length > 1) {
        diag(diagnostics, 'warning', 'flow.multiple-outputs', 'An execution output has more than one outgoing connection; only the first is used. Insert a Branch or Reroute to fan out.', list[0].from?.node, script.id);
      }
    }

    const entry = findEntry(script, diagnostics);
    if (script.enabled && !entry) {
      const expected = script.type === 'command' ? 'Command Entry' : script.type === 'event' ? 'matching Event node' : 'On Bot Ready';
      diag(diagnostics, 'error', 'flow.missing-entry', `Script "${script.name}" has no ${expected} node.`, null, script.id);
    }
    if (entry) {
      const reachable = new Set();
      const walk = (id) => {
        if (!id || reachable.has(id) || reachable.size > 5000) return;
        reachable.add(id);
        for (const edge of outgoing.get(`${id}:next`) || []) walk(edge.to.node);
        for (const pin of pinsOf(nodes.find((n) => n.id === id)).outputs.filter(isExecPin)) {
          for (const edge of outgoing.get(`${id}:${pin.id}`) || []) walk(edge.to.node);
        }
      };
      walk(entry.id);
      for (const node of nodes) {
        if (hasExecInput(node) && !reachable.has(node.id) && node.id !== entry.id && !isWebhookNode(node)) {
          diag(diagnostics, 'warning', 'flow.unreachable', `${nodeDef(node)?.title || node.type} is not reachable from the entry point.`, node.id, script.id);
        }
      }
    }
    const dataCycles = findDataCycles(script);
    for (const cycle of dataCycles) diag(diagnostics, 'error', 'flow.data-cycle', `Data nodes form a cycle: ${cycle.map((id) => nodes.find((n) => n.id === id)?.type || id).join(' → ')}.`, cycle[0], script.id);
    if (script.type === 'command' && script.command?.kind === 'slash' && asArray(script.command?.options).length > 25) {
      diag(diagnostics, 'error', 'flow.too-many-options', 'Discord allows at most 25 options on a slash command.', null, script.id);
    }
    for (const node of nodes) {
      const def = nodeDef(node);
      if (def?.special === 'loop') {
        const body = (script.graph.edges || []).find((e) => e.from?.node === node.id && e.from?.pin === 'body');
        if (!body) diag(diagnostics, 'warning', 'flow.loop-no-body', `${def.title} has no body connection.`, node.id, script.id);
      }
      if (def?.type === 'custom-code' && node.config?.language === 'lua') {
        const lua = globalThis.CascadeLua?.compile(String(node.config?.code || ''), {});
        if (!lua?.ok) diag(diagnostics, 'error', 'flow.lua', `Lua error: ${lua?.error || 'Lua compiler unavailable'}`, node.id, script.id);
        else diag(diagnostics, 'warning', 'flow.custom-code', `${def.title} contains user Lua. Review it before exporting or hosting.`, node.id, script.id);
      } else if (def?.type === 'custom-code' || def?.type === 'function-define' || def?.operation === 'script.custom' || def?.operation === 'script.defineFunction') {
        diag(diagnostics, 'warning', 'flow.custom-code', `${def.title} contains user JavaScript. Review it before exporting or hosting.`, node.id, script.id);
      }
    }
  }

  const webhookPaths = new Map();
  for (const script of scripts) {
    if (!script.enabled) continue;
    for (const node of script.graph.nodes || []) {
      if (!isWebhookNode(node)) continue;
      const routePath = webhookPath(node);
      if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(routePath) || routePath.includes('..')) {
        diag(diagnostics, 'error', 'flow.webhook-path', `Webhook path "${routePath}" is invalid. Use an absolute URL path without "..".`, node.id, script.id);
      }
      if (webhookPaths.has(routePath)) {
        diag(diagnostics, 'error', 'flow.webhook-duplicate', `Webhook path "${routePath}" is registered more than once.`, node.id, script.id);
      } else webhookPaths.set(routePath, node.id);
      const secretEnv = String(node.config?.secretEnv || 'WEBHOOK_SECRET').trim();
      if (secretEnv && !/^[A-Z_][A-Z0-9_]*$/.test(secretEnv)) {
        diag(diagnostics, 'error', 'flow.webhook-secret-env', `Webhook secret variable "${secretEnv}" must be an uppercase environment variable name.`, node.id, script.id);
      } else if (!secretEnv) {
        diag(diagnostics, 'warning', 'flow.webhook-unauthenticated', 'This webhook has no secretEnv; anyone who can reach the port can invoke it.', node.id, script.id);
      }
    }
  }

  for (const intent of asArray(project.project.intents)) {
    if (PRIVILEGED_INTENTS.includes(intent)) {
      diag(diagnostics, 'warning', 'flow.privileged-intent', `${intent} is a privileged gateway intent. Enable it in the Discord Developer Portal; Discord may require verification or approval.`);
    }
  }
  if (!VALID_BACKENDS.includes(project.project.database?.backend)) diag(diagnostics, 'error', 'flow.database-backend', 'Choose a database backend: sqlite, mongodb or json.');
  if (project.project.lavalink?.enabled) {
    const nodes = asArray(project.project.lavalink.nodes);
    if (!nodes.length) diag(diagnostics, 'error', 'flow.lavalink-nodes', 'Lavalink is enabled but no nodes are configured.');
    for (const node of nodes) if (!node.authEnv) diag(diagnostics, 'error', 'flow.lavalink-secret', 'Every Lavalink node needs an authEnv name; never paste a password into the project.');
  }

  // Cross-script imports and cycles. Both the project-level import list and
  // Import Script nodes are considered.
  const imports = new Map();
  for (const script of scripts) {
    const deps = new Set(script.imports || []);
    for (const node of script.graph.nodes || []) {
      if (node.type === 'import-script' && node.config?.scriptId) deps.add(String(node.config.scriptId));
    }
    imports.set(script.id, [...deps]);
    for (const dep of deps) {
      if (!scripts.find((s) => s.id === dep)) diag(diagnostics, 'error', 'flow.missing-import', `Script "${script.name}" imports a script that does not exist.`, null, script.id);
    }
  }
  const seen = new Set();
  const stack = [];
  const visit = (id) => {
    if (stack.includes(id)) {
      diag(diagnostics, 'error', 'flow.circular-import', `Circular script dependency: ${[...stack, id].map((x) => scripts.find((s) => s.id === x)?.name || x).join(' → ')}.`, null, id);
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    stack.push(id);
    for (const dep of imports.get(id) || []) visit(dep);
    stack.pop();
  };
  for (const script of scripts) visit(script.id);

  const main = scripts.find((s) => s.type === 'main' && s.enabled);
  for (const script of scripts) {
    const mainUses = (script.graph?.nodes || []).filter((n) => n.type === 'use-from-main');
    for (const node of mainUses) {
      const name = node.config?.name;
      if (!name) continue;
      if (!main) diag(diagnostics, 'error', 'flow.no-main', `Use From Main in "${script.name}" needs an enabled Main script.`, node.id, script.id);
      else if (main.exports?.variables?.length || main.exports?.functions?.length) {
        const known = [...(main.exports.variables || []), ...(main.exports.functions || [])].some((entry) => (typeof entry === 'string' ? entry : entry.name) === name);
        if (!known) diag(diagnostics, 'warning', 'flow.unknown-export', `Main does not list "${name}" in its exports; check the exported name.`, node.id, script.id);
      }
    }
  }

  if (project.project.registerCommands && !scripts.some((s) => s.type === 'command' && s.enabled)) {
    diag(diagnostics, 'warning', 'flow.no-commands', 'Command registration is enabled but there are no enabled command scripts.');
  }
}

function findEntry(script, diagnostics) {
  const nodes = script.graph?.nodes || [];
  const expected = script.type === 'event' ? EVENTS[script.event]?.node : script.type === 'command' ? 'command-entry' : 'main-entry';
  const candidates = nodes.filter((n) => nodeDef(n)?.special === 'entry');
  const exact = candidates.find((n) => n.type === expected);
  if (exact) return exact;
  if (script.type === 'event') {
    const eventNode = candidates.find((n) => n.type.startsWith('event-'));
    if (eventNode) return eventNode;
  }
  if (candidates.length) return candidates[0];
  return null;
}

function findDataCycles(script) {
  const nodes = script.graph?.nodes || [];
  const edges = script.graph?.edges || [];
  const data = new Map();
  for (const node of nodes) if (isDataOnly(node)) data.set(node.id, []);
  for (const edge of edges) {
    if (data.has(edge.from?.node) && data.has(edge.to?.node) && pinBy(nodes.find((n) => n.id === edge.from.node), edge.from.pin)?.kind !== EXEC) {
      data.get(edge.from.node).push(edge.to.node);
    }
  }
  const state = new Map();
  const stack = [];
  const cycles = [];
  const visit = (id) => {
    if (state.get(id) === 1) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (state.get(id) === 2) return;
    state.set(id, 1);
    stack.push(id);
    for (const dep of data.get(id) || []) visit(dep);
    stack.pop();
    state.set(id, 2);
  };
  for (const id of data.keys()) visit(id);
  return cycles;
}

function loopMeta(script) {
  const nodes = script.graph.nodes || [];
  const edges = script.graph.edges || [];
  const loopNodes = new Map(nodes.filter((n) => nodeDef(n)?.special === 'loop').map((n) => [n.id, n]));
  const back = new Map();
  const out = (id, pin) => edges.filter((e) => e.from?.node === id && e.from?.pin === pin).map((e) => e.to.node);
  for (const [loopId] of loopNodes) {
    const queue = [];
    const body = out(loopId, 'body');
    for (const id of body) queue.push(id);
    const seen = new Set([loopId]);
    while (queue.length) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const node = nodes.find((n) => n.id === id);
      if (!node) continue;
      if (nodeDef(node)?.special === 'loop' && id !== loopId) {
        for (const done of out(id, 'done')) queue.push(done);
        continue;
      }
      if (!back.has(id)) back.set(id, loopId);
      for (const pin of pinsOf(node).outputs.filter(isExecPin)) for (const target of out(id, pin.id)) queue.push(target);
    }
  }
  return { loopNodes, back };
}

function compileScript(script, project, diagnostics, codeMap) {
  const builder = new Builder();
  const sid = safe(script.id);
  const nodes = script.graph.nodes || [];
  const edges = script.graph.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of edges) {
    incoming.set(`${edge.to.node}:${edge.to.pin}`, edge);
    const key = `${edge.from.node}:${edge.from.pin}`;
    outgoing.set(key, [...(outgoing.get(key) || []), edge]);
  }
  const dataNodes = nodes.filter(isDataOnly);
  const { back } = loopMeta(script);
  const entry = findEntry(script, diagnostics);
  const target = (node, pin) => {
    const edge = edges.find((e) => e.from?.node === node.id && e.from?.pin === pin);
    return edge ? edge.to.node : null;
  };
  const fallback = (node) => (back.has(node.id) ? `${node.id}#${nodeDef(byId.get(back.get(node.id)))?.type === 'while-loop' ? 'check' : 'iter'}` : null);
  const nextTarget = (node) => target(node, 'next') || fallback(node);
  const pcExpr = (id) => (id ? literal(id) : 'null');

  function edgeFor(node, pinId) {
    return incoming.get(`${node.id}:${pinId}`) || null;
  }

  function isDataSource(node) {
    return node && isDataOnly(node);
  }

  function sourceExpr(edge) {
    const source = byId.get(edge.from.node);
    if (!source) return 'undefined';
    if (isDataSource(source)) return `((await __data(${q(source.id)}))?.[${q(edge.from.pin)}])`;
    return `__v[${q(source.id)}]?.[${q(edge.from.pin)}]`;
  }

  function pinExpr(node, pinId) {
    const edge = edgeFor(node, pinId);
    if (edge) return sourceExpr(edge);
    if (node.config?.[pinId] !== undefined) return literal(node.config[pinId]);
    const value = defaultFor(node, pinId);
    if (value !== undefined) return literal(value);
    return 'undefined';
  }

  function argsExpr(node) {
    const parts = [];
    for (const field of fieldsFor(node)) {
      let value = node.config?.[field.key] !== undefined ? node.config[field.key] : field.default;
      if (node.type === 'custom-code' && field.key === 'code' && node.config?.language === 'lua') {
        const lua = globalThis.CascadeLua?.compile(String(value || ''), {});
        if (lua?.ok) value = lua.code;
      }
      if (value !== undefined) parts.push(`${q(field.key)}: ${literal(value)}`);
    }
    for (const pin of pinsOf(node).inputs.filter(isDataPin)) {
      const edge = edgeFor(node, pin.id);
      if (edge) parts.push(`${q(pin.id)}: ${sourceExpr(edge)}`);
      else if (node.config?.[pin.id] !== undefined) parts.push(`${q(pin.id)}: ${literal(node.config[pin.id])}`);
    }
    return `{ ${parts.join(', ')} }`;
  }

  builder.push(`// ${script.name} (${script.type})`);
  builder.push(`async function flow_${sid}(__ctx, __start) {`);
  builder.push('  const __v = Object.create(null);');
  builder.push('  const __loops = Object.create(null);');
  builder.push('  const __dataCache = Object.create(null);');
  builder.push('  async function __data(__id) {');
  builder.push('    if (__id in __dataCache) return __dataCache[__id];');
  builder.push('    switch (__id) {');
  for (const node of dataNodes) {
    const def = nodeDef(node);
    if (!def) continue;
    builder.push(`      case ${q(node.id)}:`);
    builder.push(`        __dataCache[__id] = await __flow.op(__ctx, ${q(def.operation)}, ${argsExpr(node)});`);
    builder.push('        return __dataCache[__id];');
  }
  builder.push('      default: throw new Error(`Unknown data node ${__id}`);');
  builder.push('    }');
  builder.push('  }');
  builder.push(`  let __pc = __start || ${pcExpr(entry?.id)};`);
  builder.push('  let __guard = 0;');
  builder.push('  while (__pc) {');
  builder.push('    if (++__guard > 100000) throw new Error("Flow graph exceeded 100000 execution steps");');
  builder.push('    switch (__pc) {');

  const emitted = new Set();
  const emitCase = (id, fn) => {
    if (emitted.has(id)) return;
    emitted.add(id);
    fn();
  };

  for (const node of nodes) {
    const def = nodeDef(node);
    if (!def || def.special === 'comment' || def.special === 'group') continue;
    if (isDataOnly(node)) continue;
    builder.mark(node.id, script.id);
    builder.push(`      case ${q(node.id)}: {`);
    if (def.special === 'entry') {
      const dataPins = pinsOf(node).outputs.filter(isDataPin);
      const values = dataPins.map((pin) => `${q(pin.id)}: __ctx[${q(pin.id)}]`).join(', ');
      builder.push(`        __v[${q(node.id)}] = { ${values} };`);
      builder.push(`        __pc = ${pcExpr(nextTarget(node))};`);
      builder.push('        break;');
    } else if (def.special === 'branch') {
      builder.push(`        { const __condition = await (${pinExpr(node, 'condition')}); __pc = __condition ? ${pcExpr(target(node, 'true'))} : ${pcExpr(target(node, 'false'))}; }`);
      builder.push('        break;');
    } else if (def.type === 'command-permission' || def.type === 'command-cooldown') {
      builder.push(`        __v[${q(node.id)}] = (await __flow.op(__ctx, ${q(def.operation)}, ${argsExpr(node)})) || {};`);
      builder.push(`        __pc = __v[${q(node.id)}].allowed ? ${pcExpr(target(node, 'allowed'))} : ${pcExpr(target(node, def.type === 'command-cooldown' ? 'cooldown' : 'denied'))};`);
      builder.push('        break;');
    } else if (def.special === 'switch') {
      const value = pinExpr(node, 'value');
      builder.push(`        { const __switch = await (${value});`);
      const casePins = ['case1', 'case2', 'case3'];
      for (let i = 0; i < casePins.length; i += 1) {
        const pin = casePins[i];
        const keyword = i === 0 ? 'if' : 'else if';
        builder.push(`          ${keyword} (__switch == ${literal(node.config?.[pin] ?? defaultFor(node, pin) ?? '')}) __pc = ${pcExpr(target(node, pin))};`);
      }
      builder.push(`          else __pc = ${pcExpr(target(node, 'default'))}; }`);
      builder.push('        break;');
    } else if (def.type === 'loop-each') {
      builder.push(`        { const __items = await (${pinExpr(node, 'items')});`);
      builder.push('          const __list = Array.isArray(__items) ? __items : (__items == null ? [] : [__items]);');
      builder.push(`          __loops[${q(node.id)}] = { list: __list, i: 0, max: Math.max(1, Number(${literal(node.config?.limit ?? 10000)}) || 10000) };`);
      builder.push(`          __pc = ${literal(`${node.id}#iter`)}; }`);
      builder.push('        break;');
    } else if (def.type === 'while-loop') {
      builder.push(`        __loops[${q(node.id)}] = { i: 0, max: Math.max(1, Number(${literal(node.config?.maxIterations ?? 10000)}) || 10000) };`);
      builder.push(`        __pc = ${literal(`${node.id}#check`)};`);
      builder.push('        break;');
    } else if (def.special === 'try') {
      builder.push(`        __ctx.__flowCatch = ${pcExpr(target(node, 'catch'))};`);
      builder.push(`        __pc = ${pcExpr(target(node, 'body'))};`);
      builder.push('        break;');
    } else if (def.special === 'tryEnd') {
      builder.push('        __ctx.__flowCatch = null;');
      builder.push(`        __pc = ${pcExpr(nextTarget(node))};`);
      builder.push('        break;');
    } else if (def.type === 'return') {
      builder.push(`        return await (${pinExpr(node, 'value')});`);
    } else if (def.type === 'breakpoint') {
      builder.push(`        await __flow.op(__ctx, "logic.breakpoint", ${argsExpr(node)});`);
      builder.push(`        __pc = ${pcExpr(nextTarget(node))};`);
      builder.push('        break;');
    } else if (def.special === 'data') {
      // A data node that also has an execution pin is an action; assign its
      // outputs so downstream data edges can use the cached value.
      builder.push(`        __v[${q(node.id)}] = (await __flow.op(__ctx, ${q(def.operation)}, ${argsExpr(node)})) || {};`);
      builder.push(`        __pc = ${pcExpr(nextTarget(node))};`);
      builder.push('        break;');
    } else if (def.operation === 'logic.reroute') {
      builder.push(`        __pc = ${pcExpr(nextTarget(node))};`);
      builder.push('        break;');
    } else {
      builder.push(`        __v[${q(node.id)}] = (await __flow.op(__ctx, ${q(def.operation)}, ${argsExpr(node)})) || {};`);
      builder.push(`        __pc = ${pcExpr(nextTarget(node))};`);
      builder.push('        break;');
    }
    builder.push('      }');
  }

  for (const node of nodes) {
    const def = nodeDef(node);
    if (!def || def.special !== 'loop') continue;
    if (def.type === 'loop-each') {
      builder.push(`      case ${q(`${node.id}#iter`)}: {`);
      builder.push(`        const __frame = __loops[${q(node.id)}];`);
      builder.push('        if (!__frame || __frame.i >= __frame.list.length || __frame.i >= __frame.max) {');
      builder.push(`          __pc = ${pcExpr(target(node, 'done'))};`);
      builder.push('          break;');
      builder.push('        }');
      builder.push('        const __index = __frame.i++;');
      builder.push(`        __v[${q(node.id)}] = { item: __frame.list[__index], index: __index };`);
      builder.push(`        __pc = ${pcExpr(target(node, 'body'))};`);
      builder.push('        break;');
      builder.push('      }');
    } else {
      builder.push(`      case ${q(`${node.id}#check`)}: {`);
      builder.push(`        const __frame = __loops[${q(node.id)}];`);
      builder.push(`        const __again = __frame && __frame.i < __frame.max && await (${pinExpr(node, 'condition')});`);
      builder.push('        if (!__again) {');
      builder.push(`          __pc = ${pcExpr(target(node, 'done'))};`);
      builder.push('          break;');
      builder.push('        }');
      builder.push('        __frame.i += 1;');
      builder.push(`        __v[${q(node.id)}] = {};`);
      builder.push(`        __pc = ${pcExpr(target(node, 'body'))};`);
      builder.push('        break;');
      builder.push('      }');
    }
  }

  builder.push('      default: __pc = null;');
  builder.push('    }');
  builder.push('  }');
  builder.push('}');
  builder.push(`async function run_${sid}(__ctx) {`);
  builder.push('  try {');
  builder.push(`    return await flow_${sid}(__ctx);`);
  builder.push('  } catch (__err) {');
  builder.push('    const __catch = __ctx.__flowCatch;');
  builder.push('    if (__catch) {');
  builder.push('      __ctx.__flowCatch = null;');
  builder.push('      __ctx.error = __err;');
  builder.push(`      return await flow_${sid}(__ctx, __catch);`);
  builder.push('    }');
  builder.push('    throw __err;');
  builder.push('  }');
  builder.push('}');

  codeMap.push(...builder.marks.map((m) => ({ ...m, code: builder.toString().split('\n').slice(m.line - 1, m.line + 3).join('\n') })));
  return { script, sid, code: builder.toString(), entry, lineCount: builder.lineCount };
}

function intentsArray(project) {
  return asArray(project.intents).filter((name) => typeof name === 'string' && /^[A-Za-z]+$/.test(name));
}

function partialsArray(project) {
  return asArray(project.partials).filter((name) => typeof name === 'string' && /^[A-Za-z]+$/.test(name));
}

function discordIntentExpr(names) {
  return names.map((name) => `GatewayIntentBits.${name}`).join(', ');
}

function discordPartialExpr(names) {
  return names.map((name) => `Partials.${name}`).join(', ');
}

function commandData(script) {
  const kind = script.command?.kind || 'slash';
  const name = String(script.command?.name || slug(script.name)).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (kind === 'user') return { name: name.slice(0, 32), type: 2 };
  if (kind === 'message') return { name: name.slice(0, 32), type: 3 };
  return {
    name: name.slice(0, 32),
    description: String(script.command?.description || 'A Cascade Flow command').slice(0, 100),
    ...(asArray(script.command?.options).length ? { options: asArray(script.command.options) } : {}),
    ...(asArray(script.command?.permissions).length ? { default_member_permissions: asArray(script.command.permissions).join('') } : {}),
  };
}

function eventContextExpression(scriptEvent) {
  switch (scriptEvent) {
    case 'messageCreate': return '{ message: __a[0], author: __a[0]?.author, channel: __a[0]?.channel, guild: __a[0]?.guild, content: __a[0]?.content }';
    case 'interactionCreate': return '{ interaction: __a[0], user: __a[0]?.user, channel: __a[0]?.channel, guild: __a[0]?.guild, member: __a[0]?.member, commandName: __a[0]?.commandName }';
    case 'guildMemberAdd':
    case 'guildMemberRemove': return '{ member: __a[0], user: __a[0]?.user, guild: __a[0]?.guild }';
    case 'guildMemberUpdate': return '{ oldMember: __a[0], newMember: __a[1], member: __a[1], user: __a[1]?.user, guild: __a[1]?.guild }';
    case 'guildBanAdd': return '{ guild: __a[0], user: __a[0]?.user || __a[2], member: __a[2] }';
    case 'presenceUpdate': return '{ oldPresence: __a[0], newPresence: __a[1], member: __a[1]?.member, guild: __a[1]?.guild }';
    case 'voiceStateUpdate': return '{ oldState: __a[0], newState: __a[1], member: __a[1]?.member, guild: __a[1]?.guild }';
    case 'messageReactionAdd':
    case 'messageReactionRemove': return '{ reaction: __a[0], user: __a[1], message: __a[0]?.message }';
    case 'messageUpdate': return '{ oldMessage: __a[0], newMessage: __a[1], message: __a[1], channel: __a[1]?.channel, guild: __a[1]?.guild }';
    case 'messageDelete': return '{ message: __a[0], channel: __a[0]?.channel, guild: __a[0]?.guild }';
    case 'guildCreate': return '{ guild: __a[0] }';
    case 'channelCreate': return '{ channel: __a[0], guild: __a[0]?.guild }';
    case 'channelDelete': return '{ channel: __a[0], guild: __a[0]?.guild }';
    case 'threadCreate': return '{ thread: __a[0], channel: __a[0] }';
    case 'threadDelete': return '{ thread: __a[0], channel: __a[0]?.parent, guild: __a[0]?.guild }';
    case 'roleCreate': return '{ role: __a[0], guild: __a[0]?.guild }';
    case 'roleDelete': return '{ role: __a[0], guild: __a[0]?.guild }';
    case 'inviteCreate': return '{ invite: __a[0], channel: __a[0]?.channel, guild: __a[0]?.guild }';
    case 'error': return '{ error: __a[0] }';
    default: return '{ payload: __a.length === 1 ? __a[0] : __a, guild: __a[0]?.guild, channel: __a[0]?.channel }';
  }
}

function commandContextExpression(script) {
  const kind = script.command?.kind;
  if (kind === 'prefix') return '{ interaction: null, message: __interaction?.message || __interaction, user: __interaction?.author || __interaction?.user, channel: __interaction?.channel, guild: __interaction?.guild, member: __interaction?.member, options: { get: () => null }, args: __interaction?.args || [], content: __interaction?.content }';
  return '{ interaction: __interaction, user: __interaction?.user, channel: __interaction?.channel, guild: __interaction?.guild, member: __interaction?.member, options: __interaction?.options, args: __interaction?.args || [] }';
}

function buildScripts(project, diagnostics) {
  const codeMap = [];
  return asArray(project.scripts).filter((s) => s.enabled).map((script) => compileScript(script, project, diagnostics, codeMap));
}

function webhookServerSource(routeExpression) {
  return `const __flowWebhookRoutes = ${routeExpression};
let __flowWebhookServer = null;
async function __flowStartWebhooks() {
  if (!__flowWebhookRoutes.length) return null;
  const __http = await import('node:http');
  const __crypto = await import('node:crypto');
  const __port = Number(process.env.FLOW_WEBHOOK_PORT || 3001);
  const __host = process.env.FLOW_WEBHOOK_HOST || '0.0.0.0';
  const __server = __http.createServer(async (__req, __res) => {
    const __json = (__status, __body) => {
      __res.writeHead(__status, { 'content-type': 'application/json' });
      __res.end(JSON.stringify(__body));
    };
    let __url;
    try { __url = new URL(__req.url || '/', 'http://localhost'); } catch { return __json(400, { ok: false, error: 'bad request' }); }
    const __route = __flowWebhookRoutes.find((__candidate) => __candidate.path === __url.pathname);
    if (!__route) return __json(404, { ok: false, error: 'not found' });
    let __raw = '';
    try {
      for await (const __chunk of __req) {
        __raw += __chunk;
        if (Buffer.byteLength(__raw) > 1024 * 1024) { __req.destroy(); return __json(413, { ok: false, error: 'payload too large' }); }
      }
    } catch { return __json(400, { ok: false, error: 'could not read body' }); }
    if (__route.secretEnv) {
      const __secret = process.env[__route.secretEnv];
      if (!__secret) return __json(503, { ok: false, error: 'webhook secret is not configured' });
      const __provided = String(__req.headers['x-webhook-secret'] || '');
      const __signature = String(__req.headers['x-flow-signature'] || '');
      let __valid = false;
      try {
        if (__provided && __provided.length === __secret.length) {
          __valid = __crypto.timingSafeEqual(Buffer.from(__provided), Buffer.from(__secret));
        }
        if (!__valid && __signature) {
          const __expected = 'sha256=' + __crypto.createHmac('sha256', __secret).update(__raw).digest('hex');
          if (__signature.length === __expected.length) {
            __valid = __crypto.timingSafeEqual(Buffer.from(__signature), Buffer.from(__expected));
          }
        }
      } catch { __valid = false; }
      if (!__valid) return __json(401, { ok: false, error: 'invalid signature' });
    }
    let __payload;
    try { __payload = __raw ? JSON.parse(__raw) : {}; } catch { __payload = __raw; }
    try {
      await __route.run({
        scriptId: __route.scriptId,
        client,
        payload: __payload,
        headers: __req.headers,
        method: __req.method,
        query: Object.fromEntries(__url.searchParams),
        rawBody: __raw,
      });
      return __json(200, { ok: true });
    } catch (__error) {
      console.error('[flow] webhook handler failed', __error);
      return __json(500, { ok: false, error: 'handler failed' });
    }
  });
  await new Promise((resolve, reject) => {
    __server.once('error', reject);
    __server.listen(__port, __host, resolve);
  });
  __flowWebhookServer = __server;
  console.log('[flow] webhook listener on', __host, __port);
  return __server;
}
const __flowWebhookReady = __flowStartWebhooks().catch((__error) => {
  console.error('[flow] webhook listener failed', __error.message);
  return null;
});
export { __flowWebhookServer, __flowWebhookReady };
`;
}

function renderSingle(project, compiled, diagnostics) {
  const lines = [];
  const header = `// Cascade Flow — generated Discord.js bot
// Generated by Cascade Flow. Edit the graph in Cascade, not this file.
import {
  Client, GatewayIntentBits, Partials, Events, REST, Routes, ActivityType, ChannelType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  UserSelectMenuBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, MentionableSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits,
} from 'discord.js';
import 'dotenv/config';

const __FLOW_PROJECT = ${JSON.stringify(publicProjectSettings(project.project), null, 2)};

const client = new Client({
  intents: [${discordIntentExpr(intentsArray(project.project))}],
  partials: [${discordPartialExpr(partialsArray(project.project))}],
});

const __flow = (${createFlowRuntime.toString()})({
  client,
  project: __FLOW_PROJECT,
  deps: {
    GatewayIntentBits, Partials, Events, ActivityType, ChannelType, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder, MentionableSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    PermissionFlagsBits,
  },
});
`;
  lines.push(header);
  for (const item of compiled) lines.push(item.code, '');
  lines.push('const __flowScripts = Object.create(null);');
  for (const item of compiled) {
    lines.push(`__flowScripts[${q(item.script.id)}] = { id: ${q(item.script.id)}, name: ${q(item.script.name)}, type: ${q(item.script.type)}, run: (__ctx) => run_${item.sid}(__ctx) };`);
  }
  lines.push('');
  lines.push('function __flowCtx(__scriptId, __extra) { return { scriptId: __scriptId, client, ...__extra }; }');
  lines.push('');

  const commandScripts = compiled.filter((s) => s.script.type === 'command');
  const eventScripts = compiled.filter((s) => s.script.type === 'event');
  const mainScripts = compiled.filter((s) => s.script.type === 'main');
  const moduleScripts = compiled.filter((s) => s.script.type === 'module');
  const slashCommands = commandScripts.filter((s) => ['slash', 'user', 'message'].includes(s.script.command?.kind || 'slash'));
  const prefixCommands = commandScripts.filter((s) => s.script.command?.kind === 'prefix');

  if (slashCommands.length) {
    lines.push('const __flowCommandData = [');
    for (const item of slashCommands) lines.push(`  ${JSON.stringify(commandData(item.script))},`);
    lines.push('];');
  } else lines.push('const __flowCommandData = [];');

  if (commandScripts.length) {
    lines.push('const __flowCommandHandlers = Object.create(null);');
    for (const item of commandScripts) {
      const name = String(item.script.command?.name || '').toLowerCase();
      lines.push(`__flowCommandHandlers[${q(name)}] = async (__interaction) => {`);
      lines.push(`  const __ctx = __flowCtx(${q(item.script.id)}, ${commandContextExpression(item.script)});`);
      lines.push(`  try { await run_${item.sid}(__ctx); } catch (__error) { console.error("[flow:${safe(item.script.name)}]", __error); }`);
      lines.push('};');
    }
    lines.push('client.on(Events.InteractionCreate, async (__interaction) => {');
    lines.push('  let __name = null;');
    lines.push('  if (__interaction.isChatInputCommand?.() || __interaction.isUserContextMenuCommand?.() || __interaction.isMessageContextMenuCommand?.()) __name = __interaction.commandName;');
    lines.push('  if (__name && __flowCommandHandlers[__name]) await __flowCommandHandlers[__name](__interaction);');
    lines.push('});');
  }

  if (prefixCommands.length) {
    lines.push('client.on(Events.MessageCreate, async (__message) => {');
    lines.push('  if (!__message || __message.author?.bot || !__message.content) return;');
    lines.push(`  const __prefix = process.env[${q(project.project.prefixEnv || 'PREFIX')}] || ${q(project.project.prefix || '!')};`);
    lines.push('  if (!__message.content.startsWith(__prefix)) return;');
    lines.push('  const __parts = __message.content.slice(__prefix.length).trim().split(/\\s+/);');
    lines.push('  const __name = (__parts.shift() || "").toLowerCase();');
    for (const item of prefixCommands) {
      const name = String(item.script.command?.name || '').toLowerCase();
      lines.push(`  if (__name === ${q(name)}) {`);
      lines.push(`    const __ctx = __flowCtx(${q(item.script.id)}, { interaction: null, message: __message, user: __message.author, channel: __message.channel, guild: __message.guild, member: __message.member, options: { get: () => null }, args: __parts, content: __message.content });`);
      lines.push(`    try { await run_${item.sid}(__ctx); } catch (__error) { console.error("[flow:${safe(item.script.name)}]", __error); }`);
      lines.push('    return;');
      lines.push('  }');
    }
    lines.push('});');
  }

  for (const item of eventScripts) {
    const mapping = EVENTS[item.script.event];
    const eventName = mapping?.discord || (['raw', 'custom'].includes(item.script.event) ? 'raw' : item.script.event);
    const context = eventContextExpression(item.script.event);
    lines.push(`client.on(${mapping ? `Events.${eventName}` : q(eventName)}, async (...__a) => {`);
    lines.push(`  const __ctx = __flowCtx(${q(item.script.id)}, ${context});`);
    lines.push(`  try { await run_${item.sid}(__ctx); } catch (__error) { console.error("[flow:${safe(item.script.name)}]", __error); }`);
    lines.push('});');
  }

  if (mainScripts.length || moduleScripts.length) {
    lines.push('client.on(Events.ClientReady, async () => {');
    for (const item of mainScripts) {
      lines.push(`  try { await run_${item.sid}(__flowCtx(${q(item.script.id)}, { client })); } catch (__error) { console.error("[flow:${safe(item.script.name)}]", __error); }`);
    }
    for (const item of moduleScripts) {
      lines.push(`  try { await run_${item.sid}(__flowCtx(${q(item.script.id)}, { client })); } catch (__error) { console.error("[flow:${safe(item.script.name)}]", __error); }`);
    }
    lines.push('});');
  }

  if (slashCommands.length) {
    lines.push('client.once(Events.ClientReady, async () => {');
    lines.push(`  const __token = process.env[${q(project.project.tokenEnv || 'DISCORD_TOKEN')}];`);
    lines.push('  if (!__token || process.env.FLOW_DRY_RUN === "1") return;');
    lines.push(`  const __guild = process.env[${q(project.project.guildIdEnv || 'GUILD_ID')}];`);
    lines.push('  const __rest = new REST({ version: "10" }).setToken(__token);');
    lines.push('  try {');
    lines.push('    const __route = __guild ? Routes.applicationGuildCommands(client.user.id, __guild) : Routes.applicationCommands(client.user.id);');
    lines.push('    await __rest.put(__route, { body: __flowCommandData });');
    lines.push('    console.log(`[flow] registered ${__flowCommandData.length} command(s)`);');
    lines.push('  } catch (__error) { console.error("[flow] command registration failed", __error); }');
    lines.push('});');
  }

  const webhookRoutes = webhookRouteData(compiled);
  if (webhookRoutes.length) {
    const routeExpression = `[\n${webhookRoutes.map((route) => `  { path: ${q(route.path)}, scriptId: ${q(route.scriptId)}, secretEnv: ${q(route.secretEnv)}, run: (__ctx) => flow_${route.sid}(__ctx, ${q(route.nodeId)}) },`).join('\n')}\n]`;
    lines.push(webhookServerSource(routeExpression));
    lines.push('');
  }

  lines.push('');
  lines.push('process.on("unhandledRejection", (__error) => console.error("[flow] unhandled rejection", __error));');
  lines.push('process.on("uncaughtException", (__error) => console.error("[flow] uncaught exception", __error));');
  lines.push('');
  lines.push('export { client, __flow, __flowScripts, __FLOW_PROJECT };');
  lines.push('export async function runFlowScript(__id, __extra = {}) {');
  lines.push('  const __script = __flowScripts[__id];');
  lines.push('  if (!__script) throw new Error(`Unknown Flow script ${__id}`);');
  lines.push('  return __script.run({ scriptId: __id, client, ...__extra });');
  lines.push('}');
  lines.push('');
  lines.push(`if (process.env.FLOW_DRY_RUN !== "1") {`);
  lines.push(`  const __token = process.env[${q(project.project.tokenEnv || 'DISCORD_TOKEN')}];`);
  lines.push(`  if (!__token) console.error("[flow] ${project.project.tokenEnv || 'DISCORD_TOKEN'} is not set. Add it to .env before starting the bot.");`);
  lines.push('  else client.login(__token).catch((__error) => { console.error("[flow] login failed", __error); process.exitCode = 1; });');
  lines.push('} else {');
  lines.push('  console.log("[flow] dry-run mode: Discord login disabled");');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

const PRIVATE_SETTING_KEYS = new Set(['token', 'password', 'secret', 'apikey', 'api_key', 'authorization', 'auth', 'credentials', 'privatekey', 'private_key']);

// Project settings are embedded in generated source and config.js. Drop raw
// credential-shaped values while keeping the *Env names that tell the runtime
// where to read secrets at deploy time.
function publicProjectSettings(settings) {
  const clean = (value, depth = 0) => {
    if (depth > 20 || value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
    if (typeof value !== 'object') return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_SETTING_KEYS.has(key.toLowerCase())) continue;
      out[key] = clean(child, depth + 1);
    }
    return out;
  };
  return clean(settings || {});
}

function modularPackageJson(project) {
  const pkg = JSON.parse(packageJson(project));
  pkg.main = 'main.js';
  pkg.scripts = { start: 'node main.js', check: 'node --check main.js' };
  return JSON.stringify(pkg, null, 2);
}

function packageJson(project) {
  return JSON.stringify({
    name: slug(project.project.name || 'cascade-flow-bot'),
    version: '1.0.0',
    private: true,
    type: 'module',
    main: 'bot.js',
    scripts: { start: 'node bot.js', check: 'node --check bot.js' },
    engines: { node: '>=20.0.0' },
    dependencies: {
      'discord.js': '^14.16.3',
      dotenv: '^16.4.5',
      mongodb: '^6.8.0',
      openai: '^4.67.3',
      sequelize: '^6.37.3',
      shoukaku: '^4.1.1',
      sqlite3: '^5.1.7',
    },
  }, null, 2);
}

function envExample(project) {
  const lines = [
    '# Discord application credentials',
    `${project.project.tokenEnv || 'DISCORD_TOKEN'}=your-bot-token`,
    `${project.project.clientIdEnv || 'DISCORD_CLIENT_ID'}=your-application-id`,
    `${project.project.guildIdEnv || 'GUILD_ID'}=optional-guild-id-for-fast-registration`,
    'PREFIX=!',
    '',
    '# Database (only when the graph uses it)',
    'DATABASE_URL=sqlite:data/flow.sqlite',
    '',
    '# AI (only when the graph uses AI nodes)',
    'OPENAI_API_KEY=',
    'OPENAI_BASE_URL=',
    '',
    '# Lavalink (only when the graph uses music nodes)',
    'LAVALINK_PASSWORD=',
    '',
    '# Webhook listener (only when the graph has a Webhook Handler node)',
    'FLOW_WEBHOOK_HOST=0.0.0.0',
    'FLOW_WEBHOOK_PORT=3001',
    'WEBHOOK_SECRET=',
    '',
    '# Opt in only for trusted private-network HTTP calls',
    'FLOW_ALLOW_PRIVATE_HTTP=',
    '',
    'WELCOME_CHANNEL_ID=',
  ];
  return `${lines.join('\n')}\n`;
}

function readme(project, modular) {
  return `# ${project.project.name || 'Cascade Flow bot'}

${project.project.description || 'A Discord bot generated by Cascade Flow.'}

This project was generated by Cascade Flow. The graph is the source of truth; edit it in Cascade rather than editing generated code by hand.

## Run

1. Copy \`.env.example\` to \`.env\` and fill in your Discord bot token.
2. Install dependencies with \`npm install\`.
3. Run \`${modular ? 'npm start' : 'npm start'}\`.
4. Enable the gateway intents listed in \`config.js\`/the generated client in the Discord Developer Portal. Privileged intents may require Discord approval.

## Hosting

The project is a normal Node.js 20+ application. It works on any host that can run Node and reach the Discord gateway. Keep \`.env\` out of source control. Database and Lavalink credentials are read from environment variables and are never written into the generated source.

## Webhooks

If the graph contains a Webhook Handler node, the generated bot starts an HTTP listener on \`FLOW_WEBHOOK_PORT\` (default 3001, bound to \`FLOW_WEBHOOK_HOST\`, default 0.0.0.0). Expose that port through your hosting provider's HTTPS router; the Discord gateway port is separate. Each node's path is matched exactly. When \`secretEnv\` is set, set that environment variable and send either \`x-webhook-secret: <secret>\` or \`x-flow-signature: sha256=<HMAC-SHA256(rawBody, secret)>\`; missing secret configuration fails closed with 503, bad credentials return 401, unknown paths return 404, and bodies over 1 MiB return 413. The listener invokes the graph beginning at the Webhook Handler node with \`payload\`, \`headers\`, \`method\`, \`query\` and \`rawBody\` in context. The Discord client does not need to be logged in for the listener to start.

## Structure

${modular ? `- \`main.js\` — entry point and Discord event wiring\n- \`client.js\` — gateway client and intents\n- \`commands/\` — one file per command\n- \`events/\` — one file per event script\n- \`modules/\` — module scripts\n- \`runtime.js\` — Cascade Flow runtime\n- \`database/models.js\` — model metadata` : '- `bot.js` — the complete bot\n- `package.json` — dependencies'}

## Safety

Custom JavaScript and \`function-define\` nodes execute with the bot's server privileges. Review them before deploying. Secrets belong in the hosting environment, never in the graph.
`;
}

function renderModular(project, compiled) {
  const files = {};
  const intents = intentsArray(project.project);
  const partials = partialsArray(project.project);
  files['package.json'] = packageJson(project).replace('"main": "bot.js"', '"main": "main.js"').replace('"start": "node bot.js"', '"start": "node main.js"').replace(/\n    "check": "node --check bot.js",/, '\n    "check": "node --check main.js",').replace(/\n    "start:modular": "node main.js"/, '');
  files['client.js'] = `import { Client, GatewayIntentBits, Partials } from 'discord.js';\n\nexport const client = new Client({\n  intents: [${discordIntentExpr(intents)}],\n  partials: [${discordPartialExpr(partials)}],\n});\n`;
  files['config.js'] = `export const project = ${JSON.stringify(publicProjectSettings(project.project), null, 2)};\n`;
  files['runtime.js'] = `export ${createFlowRuntime.toString()}\n`;
  files['runtime-context.js'] = `import * as discord from 'discord.js';\nimport { createFlowRuntime } from './runtime.js';\nimport { client } from './client.js';\nimport { project } from './config.js';\n\nexport const flow = createFlowRuntime({ client, project, deps: discord });\nexport { client };\n`;
  files['database/models.js'] = `// Generated model metadata. The runtime uses the generic flow_records\n// collection for SQLite/MongoDB and atomic JSON storage for the JSON backend.\nexport const models = {\n  flow_records: { collection: 'default', fields: { key: 'string', value: 'json' } },\n};\n`;
  files['.env.example'] = envExample(project);
  files['README.md'] = readme(project, true);

  const commandImports = [];
  const eventImports = [];
  const moduleImports = [];
  for (const item of compiled) {
    const s = item.script;
    const fileSlug = slug(s.name || s.id);
    if (s.type === 'command') {
      const file = `commands/${fileSlug}.js`;
      files[file] = `import { flow as __flow, client } from '../runtime-context.js';\n\n${item.code}\n\nexport const data = ${JSON.stringify(commandData(s), null, 2)};\nexport const kind = ${q(s.command?.kind || 'slash')};\nexport const name = ${q(String(s.command?.name || '').toLowerCase())};\nexport async function execute(__interaction) {\n  const __ctx = { scriptId: ${q(s.id)}, client: (await import('../client.js')).client, ...${commandContextExpression(s)} };\n  return run_${item.sid}(__ctx);\n}\nexport async function runFrom(__ctx, __start) { return flow_${item.sid}(__ctx, __start); }\n`;
      commandImports.push({ file, item });
    } else if (s.type === 'event') {
      const file = `events/${fileSlug}.js`;
      const mapping = EVENTS[s.event];
      const eventName = mapping?.discord || s.event;
      files[file] = `import { flow as __flow, client } from '../runtime-context.js';\n\n${item.code}\n\nexport const event = ${q(eventName)};\nexport function buildContext(...__a) { return ${eventContextExpression(s.event)}; }\nexport async function execute(__ctx) { return run_${item.sid}({ scriptId: ${q(s.id)}, ...__ctx }); }\nexport async function runFrom(__ctx, __start) { return flow_${item.sid}(__ctx, __start); }\n`;
      eventImports.push({ file, item });
    } else if (s.type === 'module') {
      const file = `modules/${fileSlug}.js`;
      files[file] = `import { flow as __flow, client } from '../runtime-context.js';\n\n${item.code}\n\nexport async function run(__ctx = {}) { return run_${item.sid}({ scriptId: ${q(s.id)}, ...__ctx }); }\nexport async function runFrom(__ctx, __start) { return flow_${item.sid}(__ctx, __start); }\n`;
      moduleImports.push({ file, item });
    } else if (s.type === 'main') {
      const file = `modules/${fileSlug}.js`;
      files[file] = `import { flow as __flow, client } from '../runtime-context.js';\n\n${item.code}\n\nexport async function run(__ctx = {}) { return run_${item.sid}({ scriptId: ${q(s.id)}, ...__ctx }); }\nexport async function runFrom(__ctx, __start) { return flow_${item.sid}(__ctx, __start); }\n`;
      moduleImports.push({ file, item });
    }
  }
  files['commands/index.js'] = `import { client } from '../client.js';\n${commandImports.map(({ file }) => `import * as __m_${safe(file)} from './${file.split('/').pop()}';`).join('\n')}\n\nexport const commands = [${commandImports.map(({ file }) => `__m_${safe(file)}`).join(', ')}];\n`;
  files['package.json'] = modularPackageJson(project);
  files['events/index.js'] = `${eventImports.map(({ file }) => `import * as __m_${safe(file)} from './${file.split('/').pop()}';`).join('\n')}\n\nexport const events = [${eventImports.map(({ file }) => `__m_${safe(file)}`).join(', ')}];\n`;
  files['modules/index.js'] = `${moduleImports.map(({ file }) => `import * as __m_${safe(file)} from './${file.split('/').pop()}';`).join('\n')}\n\nexport const modules = [${moduleImports.map(({ file }) => `__m_${safe(file)}`).join(', ')}];\n`;
  const scriptFile = (script) => script.type === 'command'
    ? `commands/${slug(script.name || script.id)}.js`
    : script.type === 'event' ? `events/${slug(script.name || script.id)}.js` : `modules/${slug(script.name || script.id)}.js`;
  const webhookRoutes = webhookRouteData(compiled).map((route) => {
    const script = compiled.find((item) => item.script.id === route.scriptId)?.script;
    return { ...route, file: scriptFile(script || {}) };
  });
  if (webhookRoutes.length) {
    const routeModules = new Map();
    for (const route of webhookRoutes) routeModules.set(route.file, `__w_${safe(route.file)}`);
    const imports = [...routeModules].map(([file, name]) => `import * as ${name} from './${file}';`).join('\n');
    const routeExpression = `[\n${webhookRoutes.map((route) => `  { path: ${q(route.path)}, scriptId: ${q(route.scriptId)}, secretEnv: ${q(route.secretEnv)}, run: (__ctx) => ${routeModules.get(route.file)}.runFrom(__ctx, ${q(route.nodeId)}) },`).join('\n')}\n]`;
    files['webhooks.js'] = `import 'dotenv/config';\nimport { client } from './runtime-context.js';\n${imports}\n\n${webhookServerSource(routeExpression)}`;
  }
  const slash = compiled.filter((s) => s.script.type === 'command' && ['slash', 'user', 'message'].includes(s.script.command?.kind || 'slash'));
  files['main.js'] = `${webhookRoutes.length ? `import { __flowWebhookReady } from './webhooks.js';\nvoid __flowWebhookReady;\n` : ''}import 'dotenv/config';\nimport { Events, REST, Routes } from 'discord.js';\nimport { client } from './client.js';\nimport { project } from './config.js';\nimport { commands } from './commands/index.js';\nimport { events } from './events/index.js';\nimport { modules } from './modules/index.js';\n\nconst commandMap = Object.create(null);\nfor (const command of commands) commandMap[command.name] = command;\nclient.on(Events.InteractionCreate, async (interaction) => {\n  let name = null;\n  if (interaction.isChatInputCommand?.() || interaction.isUserContextMenuCommand?.() || interaction.isMessageContextMenuCommand?.()) name = interaction.commandName;\n  if (name && commandMap[name]) {\n    try { await commandMap[name].execute(interaction); } catch (error) { console.error('[flow]', name, error); }\n  }\n});\nclient.on(Events.MessageCreate, async (message) => {\n  if (!message || message.author?.bot || !message.content) return;\n  const prefix = process.env[project.prefixEnv || 'PREFIX'] || project.prefix || '!';\n  if (!message.content.startsWith(prefix)) return;\n  const parts = message.content.slice(prefix.length).trim().split(/\\s+/);\n  const name = (parts.shift() || '').toLowerCase();\n  const command = commandMap[name];\n  if (!command || command.kind !== 'prefix') return;\n  try { await command.execute({ message, author: message.author, channel: message.channel, guild: message.guild, member: message.member, args: parts, content: message.content }); } catch (error) { console.error('[flow]', name, error); }\n});\nfor (const mod of events) {\n  client.on(mod.event, async (...args) => {\n    try { await mod.execute(mod.buildContext(...args)); } catch (error) { console.error('[flow]', mod.event, error); }\n  });\n}\nclient.on(Events.ClientReady, async () => {\n  for (const mod of modules) { try { await mod.run({ client }); } catch (error) { console.error('[flow]', error); } }\n  const token = process.env[project.tokenEnv || 'DISCORD_TOKEN'];\n  const data = commands.filter((c) => ['slash', 'user', 'message'].includes(c.kind)).map((c) => c.data);\n  if (token && data.length && process.env.FLOW_DRY_RUN !== '1') {\n    const rest = new REST({ version: '10' }).setToken(token);\n    const guild = process.env[project.guildIdEnv || 'GUILD_ID'];\n    const route = guild ? Routes.applicationGuildCommands(client.user.id, guild) : Routes.applicationCommands(client.user.id);\n    try { await rest.put(route, { body: data }); } catch (error) { console.error('[flow] registration failed', error); }\n  }\n});\nprocess.on('unhandledRejection', (error) => console.error('[flow] unhandled rejection', error));\nif (process.env.FLOW_DRY_RUN !== '1') {\n  const token = process.env[project.tokenEnv || 'DISCORD_TOKEN'];\n  if (!token) console.error('[flow] Discord token is not set');\n  else client.login(token).catch((error) => { console.error('[flow] login failed', error); process.exitCode = 1; });\n}\n`;
  return files;
}

export function compileFlow(content, options = {}) {
  const project = normalizeFlow(content);
  loadCustomDefs(project);
  const diagnostics = [];
  runValidation(content, project, diagnostics);
  secretDiagnostics(content, project, diagnostics);
  for (const pkg of asArray(project.customNodes)) {
    if (!pkg || pkg.enabled === false) continue;
    const base = NODE_BY_TYPE.get(pkg.base);
    if (typeof pkg.type !== 'string' || !pkg.type.startsWith('custom:') || !base || !base.operation || (base.special && base.special !== 'data')) {
      diag(diagnostics, 'warning', 'flow.custom-node-invalid', `Custom node package “${pkg.type || 'unnamed'}” needs a custom: type and a supported base node.`, null, null, 'Open Project settings and fix the customNodes JSON.');
    } else {
      const permissionError = packagePermissionError(pkg, base);
      if (permissionError) diag(diagnostics, 'error', 'flow.custom-node-permission', permissionError, null, null, 'Add the declared permission to the package only after reviewing the operation.');
    }
  }
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length && !options.partial) {
    return { ok: false, diagnostics, errors, project, scripts: [], code: null, modular: null, codeMap: [] };
  }
  const codeMap = [];
  let compiled;
  try {
    compiled = asArray(project.scripts).filter((s) => s.enabled).map((s) => compileScript(s, project, diagnostics, codeMap));
  } catch (error) {
    diag(diagnostics, 'error', 'flow.compile-exception', `Compiler failed: ${error.message}`);
    return { ok: false, diagnostics, errors: diagnostics.filter((d) => d.severity === 'error'), project, scripts: [], code: null, modular: null, codeMap: [] };
  }
  const code = renderSingle(project, compiled, diagnostics);
  const modular = renderModular(project, compiled);
  return {
    ok: diagnostics.every((d) => d.severity !== 'error'),
    diagnostics,
    errors: diagnostics.filter((d) => d.severity === 'error'),
    project,
    scripts: compiled.map((s) => ({ id: s.script.id, name: s.script.name, type: s.script.type, entry: s.entry?.id || null })),
    code,
    modular,
    codeMap,
    stats: {
      scripts: compiled.length,
      nodes: compiled.reduce((sum, s) => sum + (s.script.graph.nodes?.length || 0), 0),
      edges: compiled.reduce((sum, s) => sum + (s.script.graph.edges?.length || 0), 0),
      lines: code.split('\n').length,
    },
  };
}

export function validateFlow(content) {
  const project = normalizeFlow(content);
  const diagnostics = [];
  runValidation(content, project, diagnostics);
  secretDiagnostics(content, project, diagnostics);
  return { ok: diagnostics.every((d) => d.severity !== 'error'), diagnostics, errors: diagnostics.filter((d) => d.severity === 'error'), project };
}

export function singleFileExport(content) {
  const result = compileFlow(content);
  if (!result.ok) return result;
  return { ...result, files: { 'bot.js': result.code, 'package.json': packageJson(result.project), '.env.example': envExample(result.project), 'README.md': readme(result.project, false) } };
}

export function modularExport(content) {
  const result = compileFlow(content);
  if (!result.ok) return result;
  return { ...result, files: { ...renderModular(result.project, buildScripts(result.project, [])) } };
}

export function renderExport(content) {
  const single = singleFileExport(content);
  if (!single.ok) return single;
  const modular = modularExport(content);
  return { ...single, single: { code: single.code, files: single.files }, modular: modular.files };
}

export function compileScriptOnly(content, scriptId) {
  const project = normalizeFlow(content);
  const script = project.scripts.find((s) => s.id === scriptId);
  if (!script) return { ok: false, error: 'Script not found' };
  const diagnostics = [];
  const map = [];
  const compiled = compileScript(script, project, diagnostics, map);
  return { ok: diagnostics.every((d) => d.severity !== 'error'), diagnostics, code: compiled.code, codeMap: map };
}
