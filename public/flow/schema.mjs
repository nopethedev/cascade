/* Shared Flow project schema. Browser-safe and deliberately tolerant of older
   saved projects: normalizeFlow fills missing fields without dropping unknown
   node config (newer nodes keep working after a round trip). */

export const FLOW_SCHEMA_VERSION = 1;

export const SCRIPT_TYPES = ['main', 'command', 'event', 'module'];
export const COMMAND_KINDS = ['slash', 'prefix', 'user', 'message'];

export function flowId(prefix = 'n') {
  const rand = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 10)
    || Math.random().toString(36).slice(2, 12);
  return `${prefix}_${rand}`;
}

export function blankScript(id = flowId('s'), name = 'Main', type = 'main') {
  const entryType = type === 'event' ? 'event-message' : type === 'command' ? 'command-entry' : 'main-entry';
  return {
    id,
    name,
    type,
    folder: '',
    enabled: true,
    event: 'messageCreate',
    command: {
      name: 'command',
      description: 'A Cascade Flow command',
      kind: 'slash',
      options: [],
      guildOnly: false,
      dmOnly: false,
      cooldown: 0,
      permissions: [],
      defer: false,
      ephemeral: false,
    },
    exports: { variables: [], functions: [] },
    imports: [],
    permissions: { roles: [], users: [] },
    graph: {
      nodes: [{ id: flowId('e'), type: entryType, x: 60, y: 100, config: {} }],
      edges: [],
      groups: [],
      comments: [],
      bookmarks: [],
    },
  };
}

export function blankFlow(projectName = 'My Discord Bot') {
  return {
    schema: FLOW_SCHEMA_VERSION,
    project: {
      name: projectName,
      description: 'A Discord bot built visually with Cascade Flow.',
      prefix: '!',
      tokenEnv: 'DISCORD_TOKEN',
      clientIdEnv: 'DISCORD_CLIENT_ID',
      guildIdEnv: 'GUILD_ID',
      registerCommands: true,
      intents: ['Guilds', 'GuildMessages', 'MessageContent', 'GuildMembers', 'GuildVoiceStates'],
      partials: ['Channel', 'GuildMember', 'Message', 'Reaction', 'User'],
      database: { backend: 'json', env: 'DATABASE_URL', jsonPath: 'data/flow-db.json' },
      lavalink: { enabled: false, nodes: [] },
      nodeVersion: 1,
    },
    folders: [],
    scripts: [blankScript()],
    assets: [],
    bookmarks: [],
    customNodes: [],
  };
}

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export function normalizeScript(script, index = 0) {
  const source = asObject(script);
  const type = SCRIPT_TYPES.includes(source.type) ? source.type : 'main';
  const base = blankScript(source.id || `s_${index + 1}`, source.name || `Script ${index + 1}`, type);
  const graph = asObject(source.graph);
  const nodes = asArray(graph.nodes).filter((n) => n && typeof n === 'object' && n.id && n.type).map((n) => ({
    ...n,
    x: Number.isFinite(Number(n.x)) ? Number(n.x) : 0,
    y: Number.isFinite(Number(n.y)) ? Number(n.y) : 0,
    config: asObject(n.config),
  }));
  return {
    ...base,
    ...source,
    type,
    id: String(source.id || base.id),
    name: String(source.name || base.name).slice(0, 80),
    folder: String(source.folder || ''),
    enabled: source.enabled !== false,
    event: String(source.event || base.event),
    command: { ...base.command, ...asObject(source.command), options: asArray(source.command?.options) },
    exports: {
      variables: asArray(source.exports?.variables),
      functions: asArray(source.exports?.functions),
    },
    imports: asArray(source.imports).map(String),
    permissions: {
      roles: asArray(source.permissions?.roles).map(String),
      users: asArray(source.permissions?.users).map(String),
    },
    graph: {
      nodes: nodes.length ? nodes : base.graph.nodes,
      edges: asArray(graph.edges).filter((e) => e && e.from?.node && e.from?.pin && e.to?.node && e.to?.pin).map((e) => ({
        id: String(e.id || flowId('w')),
        from: { node: String(e.from.node), pin: String(e.from.pin) },
        to: { node: String(e.to.node), pin: String(e.to.pin) },
        kind: e.kind === 'exec' ? 'exec' : 'data',
      })),
      groups: asArray(graph.groups),
      comments: asArray(graph.comments),
      bookmarks: asArray(graph.bookmarks),
    },
  };
}

export function normalizeFlow(content) {
  const source = asObject(content);
  const base = blankFlow(source.project?.name || 'My Discord Bot');
  const scripts = asArray(source.scripts).map(normalizeScript);
  return {
    ...base,
    ...source,
    schema: FLOW_SCHEMA_VERSION,
    project: {
      ...base.project,
      ...asObject(source.project),
      database: { ...base.project.database, ...asObject(source.project?.database) },
      lavalink: { ...base.project.lavalink, ...asObject(source.project?.lavalink) },
      intents: asArray(source.project?.intents).length ? asArray(source.project.intents).map(String) : base.project.intents,
      partials: asArray(source.project?.partials).length ? asArray(source.project.partials).map(String) : base.project.partials,
    },
    folders: asArray(source.folders).map((f) => (typeof f === 'string' ? { id: f, name: f, parent: '' } : {
      id: String(f?.id || f?.name || flowId('f')),
      name: String(f?.name || 'Folder'),
      parent: String(f?.parent || ''),
    })),
    scripts: scripts.length ? scripts : base.scripts,
    assets: asArray(source.assets),
    bookmarks: asArray(source.bookmarks),
    customNodes: asArray(source.customNodes),
  };
}

export function scriptsForProject(content) {
  return normalizeFlow(content).scripts;
}

export function findScript(content, id) {
  return normalizeFlow(content).scripts.find((s) => s.id === id) || null;
}

export function cloneScript(script, name) {
  const copy = JSON.parse(JSON.stringify(script));
  copy.id = flowId('s');
  copy.name = name || `${script.name} copy`;
  const idMap = new Map();
  copy.graph.nodes = copy.graph.nodes.map((n) => {
    const id = flowId('n');
    idMap.set(n.id, id);
    return { ...n, id, x: Number(n.x || 0) + 28, y: Number(n.y || 0) + 28 };
  });
  copy.graph.edges = copy.graph.edges.map((e) => ({
    ...e,
    id: flowId('w'),
    from: { ...e.from, node: idMap.get(e.from.node) },
    to: { ...e.to, node: idMap.get(e.to.node) },
  })).filter((e) => idMap.has(e.from.node) && idMap.has(e.to.node));
  return copy;
}
