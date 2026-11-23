import fs from 'node:fs';
import path from 'node:path';
import { DataTypes, Sequelize, QueryTypes } from 'sequelize';
import { config } from './config.js';

// ---------------------------------------------------------------------------
// Sequelize + SQLite
//
// All metadata (users, files, nodes, settings, API keys, analytics) lives in a
// single SQLite file at `config.dbPath`. File blobs still live on disk or on
// storage nodes — only their metadata is stored in SQL.
// ---------------------------------------------------------------------------

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: config.dbPath,
  logging: false,
});

export const User = sequelize.define(
  'user',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    username: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(128), allowNull: false },
    role: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'user' },
    quotaBytes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 * 1024 ** 3 },
  },
  { tableName: 'users' },
);

export const FileRecord = sequelize.define(
  'file',
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    slug: { type: DataTypes.STRING(32), unique: true },
    filename: { type: DataTypes.STRING(255), allowNull: false },
    mime: { type: DataTypes.STRING(128), defaultValue: 'application/octet-stream' },
    size: { type: DataTypes.INTEGER, defaultValue: 0 },
    ownerId: DataTypes.STRING(36),
    ownerName: DataTypes.STRING(64),
    isPublic: { type: DataTypes.BOOLEAN, defaultValue: false },
    starred: { type: DataTypes.BOOLEAN, defaultValue: false },
    replicas: { type: DataTypes.JSON, defaultValue: [] },
    primaryNode: DataTypes.STRING(32),
    // Workspace documents: kind=file for classic uploads, otherwise the editor
    // type. Editor state lives in `content` (JSON text) and `version` is bumped
    // on every save for optimistic concurrency.
    kind: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'file' },
    folderId: { type: DataTypes.STRING(36), allowNull: true },
    content: { type: DataTypes.TEXT, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    template: { type: DataTypes.STRING(48), allowNull: true },
    // Published websites keep a stable public slug and optional custom host.
    // Other editors use publishedAt only as a convenience marker.
    publishedAt: { type: DataTypes.DATE, allowNull: true },
    customDomain: { type: DataTypes.STRING(255), allowNull: true },
    siteTitle: { type: DataTypes.STRING(180), allowNull: true },
  },
  { tableName: 'files', indexes: [{ fields: ['ownerId'] }, { fields: ['slug'] }, { fields: ['kind'] }, { fields: ['customDomain'] }] },
);

export const Folder = sequelize.define(
  'folder',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    ownerId: { type: DataTypes.STRING(36), allowNull: false },
    // null means the owner's root. The server validates that a folder can
    // never be moved below itself or below one of its descendants.
    parentId: { type: DataTypes.STRING(36), allowNull: true },
  },
  { tableName: 'folders', indexes: [{ fields: ['ownerId'] }, { fields: ['parentId'] }] },
);

export const DocVersion = sequelize.define(
  'docVersion',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    version: { type: DataTypes.INTEGER, allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    createdBy: { type: DataTypes.STRING(36), allowNull: true },
  },
  { tableName: 'doc_versions', indexes: [{ fields: ['fileId'] }] },
);

export const Template = sequelize.define(
  'template',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    kind: { type: DataTypes.STRING(16), allowNull: false },
    category: { type: DataTypes.STRING(24), defaultValue: 'custom' },
    content: { type: DataTypes.TEXT, allowNull: false },
    ownerId: { type: DataTypes.STRING(36), allowNull: true },
  },
  { tableName: 'templates', indexes: [{ fields: ['ownerId'] }, { fields: ['kind'] }] },
);

// Per-document ACL. The owner is implicit; this table only stores people the
// owner invited. `userId` is null for an email invitation that has not been
// claimed yet, in which case `email` is the matching key.
export const Collaborator = sequelize.define(
  'collaborator',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    userId: { type: DataTypes.STRING(36), allowNull: true },
    username: { type: DataTypes.STRING(64), allowNull: true },
    email: { type: DataTypes.STRING(180), allowNull: true },
    role: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'viewer' },
    invitedBy: { type: DataTypes.STRING(36), allowNull: true },
  },
  { tableName: 'collaborators', indexes: [{ fields: ['fileId'] }, { fields: ['userId'] }, { fields: ['email'] }] },
);

// Capability links are deliberately separate from Collaborator rows: a link
// can be revoked without knowing the recipient, while an invited person keeps
// their identity and role.
export const ShareLink = sequelize.define(
  'shareLink',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    token: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    role: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'viewer' },
    createdBy: { type: DataTypes.STRING(36), allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { tableName: 'share_links', indexes: [{ fields: ['fileId'] }, { fields: ['token'] }] },
);

// Threaded comments. `anchor` is editor-specific JSON (for example a deck
// element id or a document text range), kept opaque by the server.
export const CommentThread = sequelize.define(
  'commentThread',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    parentId: { type: DataTypes.STRING(36), allowNull: true },
    userId: { type: DataTypes.STRING(36), allowNull: true },
    authorName: { type: DataTypes.STRING(64), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    anchor: { type: DataTypes.JSON, allowNull: true },
    mentions: { type: DataTypes.JSON, allowNull: true },
    resolved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  { tableName: 'comment_threads', indexes: [{ fields: ['fileId'] }, { fields: ['parentId'] }, { fields: ['createdAt'] }] },
);

// Durable collaboration metadata. The editor content itself stays in files.content
// and doc_versions; this row prevents live rooms from inventing a second truth.
export const CollabRoom = sequelize.define(
  'collabRoom',
  {
    fileId: { type: DataTypes.STRING(32), primaryKey: true },
    revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastEditor: { type: DataTypes.STRING(64), allowNull: true },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { tableName: 'collab_rooms' },
);

// Roblox Studio relay. Pairing codes and session tokens are one-time secrets:
// only their SHA-256 hashes are stored. A session belongs to exactly one
// workspace project; the plugin is the authority that applies commands.
export const StudioPairing = sequelize.define(
  'studioPairing',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    userId: { type: DataTypes.STRING(36), allowNull: false },
    codeHash: { type: DataTypes.STRING(64), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE, allowNull: true },
    sessionId: { type: DataTypes.STRING(36), allowNull: true },
  },
  { tableName: 'studio_pairings', indexes: [{ fields: ['fileId'] }, { fields: ['codeHash'] }, { fields: ['expiresAt'] }] },
);

export const StudioSession = sequelize.define(
  'studioSession',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    userId: { type: DataTypes.STRING(36), allowNull: false },
    pairingId: { type: DataTypes.STRING(36), allowNull: true },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    placeName: { type: DataTypes.STRING(160), allowNull: true },
    clientVersion: { type: DataTypes.STRING(32), allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'connected' },
    lastHeartbeat: { type: DataTypes.DATE, allowNull: true },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { tableName: 'studio_sessions', indexes: [{ fields: ['fileId'] }, { fields: ['userId'] }, { fields: ['tokenHash'] }] },
);

export const StudioCommand = sequelize.define(
  'studioCommand',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    sessionId: { type: DataTypes.STRING(36), allowNull: true },
    kind: { type: DataTypes.STRING(32), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'queued' },
    createdBy: { type: DataTypes.STRING(64), allowNull: true },
    result: { type: DataTypes.JSON, allowNull: true },
    error: { type: DataTypes.TEXT, allowNull: true },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    appliedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { tableName: 'studio_commands', indexes: [{ fields: ['fileId'] }, { fields: ['status'] }, { fields: ['sessionId'] }] },
);

export const StudioSnapshot = sequelize.define(
  'studioSnapshot',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    scene: { type: DataTypes.TEXT, allowNull: false },
    label: { type: DataTypes.STRING(160), allowNull: true },
    createdBy: { type: DataTypes.STRING(64), allowNull: true },
  },
  { tableName: 'studio_snapshots', indexes: [{ fields: ['fileId'] }, { fields: ['createdAt'] }] },
);

// Published website deployments are immutable content snapshots. They power
// staging/preview links, production history and one-click rollback.
export const SiteDeployment = sequelize.define(
  'siteDeployment',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    environment: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'production' },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    content: { type: DataTypes.TEXT, allowNull: false },
    label: { type: DataTypes.STRING(160), allowNull: true },
    createdBy: { type: DataTypes.STRING(64), allowNull: true },
  },
  { tableName: 'site_deployments', indexes: [{ fields: ['fileId'] }, { fields: ['environment'] }, { fields: ['createdAt'] }] },
);

// A small CMS that intentionally uses SQLite rows, not a second JSON blob.
// `fields` is a validated schema array; `data` is keyed by field id.
export const SiteCollection = sequelize.define(
  'siteCollection',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    slug: { type: DataTypes.STRING(80), allowNull: false },
    fields: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  },
  { tableName: 'site_collections', indexes: [{ fields: ['fileId'] }, { fields: ['fileId', 'slug'], unique: true }] },
);

export const SiteItem = sequelize.define(
  'siteItem',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    collectionId: { type: DataTypes.STRING(36), allowNull: false },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    slug: { type: DataTypes.STRING(140), allowNull: false },
    data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'draft' },
    publishedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { tableName: 'site_items', indexes: [{ fields: ['collectionId'] }, { fields: ['fileId'] }, { fields: ['collectionId', 'slug'], unique: true }] },
);

export const FormResponse = sequelize.define(
  'formResponse',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    fileId: { type: DataTypes.STRING(32), allowNull: false },
    data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    ip: { type: DataTypes.STRING(64), allowNull: true },
  },
  { tableName: 'form_responses', indexes: [{ fields: ['fileId'] }] },
);

export const NodeRecord = sequelize.define(
  'node',
  {
    id: { type: DataTypes.STRING(32), primaryKey: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    url: { type: DataTypes.STRING(255), allowNull: false },
    accessKey: { type: DataTypes.STRING(255), defaultValue: '' },
    enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  { tableName: 'nodes' },
);

export const ApiKeyRecord = sequelize.define(
  'apiKey',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    prefix: { type: DataTypes.STRING(24), allowNull: false },
    keyHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    // `full` keeps the historical owner-level behavior; `read` and `write`
    // let operators hand out least-privilege automation keys.
    scope: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'full' },
    createdBy: { type: DataTypes.STRING(36), allowNull: false },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { tableName: 'api_keys', indexes: [{ fields: ['createdBy'] }] },
);

export const AnalyticsEvent = sequelize.define(
  'analyticsEvent',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    // view | download | upload | share | api
    type: { type: DataTypes.STRING(20), allowNull: false },
    fileId: { type: DataTypes.STRING(32), allowNull: true },
    userId: { type: DataTypes.STRING(36), allowNull: true },
    // web | public | api
    channel: { type: DataTypes.STRING(12), defaultValue: 'web' },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    userAgent: { type: DataTypes.STRING(255), allowNull: true },
    referer: { type: DataTypes.STRING(255), allowNull: true },
    bytes: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: 'analytics_events',
    indexes: [{ fields: ['createdAt'] }, { fields: ['type'] }, { fields: ['fileId'] }],
  },
);

export const Setting = sequelize.define(
  'setting',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    setupDone: { type: DataTypes.BOOLEAN, defaultValue: false },
    siteName: { type: DataTypes.STRING(60), defaultValue: 'Cascade' },
    accent: { type: DataTypes.STRING(9), defaultValue: '#e11d48' },
    bg: { type: DataTypes.STRING(9), defaultValue: '#08080a' },
    surface: { type: DataTypes.STRING(9), defaultValue: '#101013' },
    text: { type: DataTypes.STRING(9), defaultValue: '#f3f3f4' },
    allowPublicSignup: { type: DataTypes.BOOLEAN, defaultValue: false },
    replicationMode: { type: DataTypes.STRING(16), defaultValue: 'n' },
    replicationSelectedNodeIds: { type: DataTypes.JSON, defaultValue: [] },
    replicationDefaultNodeId: { type: DataTypes.STRING(32), defaultValue: 'local' },
    replicationReplicaCount: { type: DataTypes.INTEGER, defaultValue: 2 },
  },
  { tableName: 'settings' },
);

const ENV_DEFAULTS = {
  siteName: process.env.SITE_NAME || 'Cascade',
  accent: process.env.THEME_ACCENT || '#e11d48',
  bg: process.env.THEME_BG || '#08080a',
  surface: process.env.THEME_SURFACE || '#101013',
  text: process.env.THEME_TEXT || '#f3f3f4',
};

let settingsCache = null;
let adminSeen = false;

function toSettings(row) {
  const selected = row.replicationSelectedNodeIds;
  return {
    setupDone: !!row.setupDone,
    siteName: row.siteName || 'Cascade',
    accent: row.accent || '#e11d48',
    bg: row.bg || '#08080a',
    surface: row.surface || '#101013',
    text: row.text || '#f3f3f4',
    allowPublicSignup: !!row.allowPublicSignup,
    replication: {
      mode: row.replicationMode || 'n',
      selectedNodeIds: Array.isArray(selected) ? selected : [],
      defaultNodeId: row.replicationDefaultNodeId || 'local',
      replicaCount: Number(row.replicationReplicaCount) || 1,
    },
  };
}

// Import a pre-Sequelize `data/db.json` store once, if it sits next to the DB.
async function migrateLegacyJson() {
  const legacyPath = path.join(path.dirname(config.dbPath), 'db.json');
  if (!fs.existsSync(legacyPath)) return false;
  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  } catch {
    return false;
  }
  const s = legacy.settings || {};
  const rep = s.replication || {};
  try {
    await Setting.create({
      id: 1,
      setupDone: !!s.setupDone,
      siteName: s.siteName || ENV_DEFAULTS.siteName,
      accent: s.accent || ENV_DEFAULTS.accent,
      bg: s.bg || ENV_DEFAULTS.bg,
      surface: s.surface || ENV_DEFAULTS.surface,
      text: s.text || ENV_DEFAULTS.text,
      allowPublicSignup: !!s.allowPublicSignup,
      replicationMode: rep.mode || 'n',
      replicationSelectedNodeIds: rep.selectedNodeIds || [],
      replicationDefaultNodeId: rep.defaultNodeId || 'local',
      replicationReplicaCount: rep.replicaCount || 2,
    });
    for (const u of legacy.users || []) {
      await User.create({
        id: u.id,
        username: u.username,
        passwordHash: u.passwordHash,
        role: u.role === 'admin' ? 'admin' : 'user',
        quotaBytes: Number(u.quotaBytes) || 5 * 1024 ** 3,
        createdAt: u.createdAt || new Date(),
      });
    }
    for (const f of legacy.files || []) {
      await FileRecord.create({
        id: f.id,
        slug: f.slug,
        filename: f.filename,
        mime: f.mime,
        size: Number(f.size) || 0,
        ownerId: f.ownerId,
        ownerName: f.ownerName,
        isPublic: !!f.isPublic,
        replicas: f.replicas || [],
        primaryNode: f.primaryNode,
        createdAt: f.createdAt || new Date(),
      });
    }
    for (const n of legacy.nodes || []) {
      await NodeRecord.create({
        id: n.id,
        name: n.name,
        url: n.url,
        accessKey: n.accessKey || '',
        enabled: n.enabled !== false,
        createdAt: n.createdAt || new Date(),
      });
    }
    console.log(`[cascade] imported ${(legacy.users || []).length} users and ${(legacy.files || []).length} files from data/db.json`);
    return true;
  } catch (err) {
    console.warn('[cascade] legacy JSON import skipped:', err.message);
    return false;
  }
}

// Additive, idempotent migrations that run *before* sync(): sequelize.sync()
// never alters existing tables, and creating the new indexes would fail on a
// database from the pre-workspace schema. Raw PRAGMA + ALTER keeps it simple
// and works on every SQLite version Sequelize supports.
async function migrateSchema() {
  const tables = (await sequelize.getQueryInterface().showAllTables()).map((t) =>
    String(typeof t === 'string' ? t : t.tableName || t).toLowerCase(),
  );
  if (tables.includes('files')) {
    const columns = await sequelize.query('PRAGMA table_info(`files`)', { type: QueryTypes.SELECT });
    const have = new Set(columns.map((c) => c.name));
    const add = async (name, sql) => {
      if (!have.has(name)) await sequelize.query(`ALTER TABLE \`files\` ADD COLUMN ${sql}`);
    };
    await add('kind', "`kind` VARCHAR(16) NOT NULL DEFAULT 'file'");
    await add('starred', '`starred` BOOLEAN NOT NULL DEFAULT 0');
    await add('folderId', '`folderId` VARCHAR(36)');
    await add('content', '`content` TEXT');
    await add('version', '`version` INTEGER NOT NULL DEFAULT 0');
    await add('template', '`template` VARCHAR(48)');
    await add('publishedAt', '`publishedAt` DATETIME');
    await add('customDomain', '`customDomain` VARCHAR(255)');
    await add('siteTitle', '`siteTitle` VARCHAR(180)');
  }
  if (tables.includes('folders')) {
    const columns = await sequelize.query('PRAGMA table_info(`folders`)', { type: QueryTypes.SELECT });
    if (!columns.some((c) => c.name === 'parentId')) {
      await sequelize.query('ALTER TABLE `folders` ADD COLUMN `parentId` VARCHAR(36)');
    }
  }
  if (tables.includes('api_keys')) {
    const columns = await sequelize.query('PRAGMA table_info(`api_keys`)', { type: QueryTypes.SELECT });
    if (!columns.some((c) => c.name === 'scope')) {
      await sequelize.query("ALTER TABLE `api_keys` ADD COLUMN `scope` VARCHAR(16) NOT NULL DEFAULT 'full'");
    }
  }
  if (tables.includes('settings')) {
    const columns = await sequelize.query('PRAGMA table_info(`settings`)', { type: QueryTypes.SELECT });
    const have = new Set(columns.map((c) => c.name));
    // Older installs predate the registration flag. It stays disabled until an
    // administrator explicitly enables it.
    if (!have.has('allowPublicSignup')) {
      await sequelize.query('ALTER TABLE `settings` ADD COLUMN `allowPublicSignup` BOOLEAN NOT NULL DEFAULT 0');
    }
  }
}

export async function initDb() {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  fs.mkdirSync(config.storageDir, { recursive: true });
  await sequelize.authenticate();
  await migrateSchema();
  await sequelize.sync();
  let row = await Setting.findByPk(1);
  if (!row) {
    await migrateLegacyJson();
    row = await Setting.findByPk(1);
  }
  if (!row) row = await Setting.create({ id: 1, ...ENV_DEFAULTS });
  settingsCache = toSettings(row);
  adminSeen = (await User.count({ where: { role: 'admin' } })) > 0;
  return settingsCache;
}

export async function getSettings() {
  if (settingsCache) return settingsCache;
  const row = await Setting.findByPk(1);
  settingsCache = row ? toSettings(row) : { ...ENV_DEFAULTS, setupDone: false, allowPublicSignup: false, replication: { mode: 'n', selectedNodeIds: [], defaultNodeId: 'local', replicaCount: 2 } };
  return settingsCache;
}

export async function saveSettings(patch = {}) {
  const row = await Setting.findByPk(1);
  if (!row) throw new Error('settings row missing');
  const current = toSettings(row);
  const next = { ...current, ...patch };
  if (patch.replication) next.replication = { ...current.replication, ...patch.replication };
  await row.update({
    setupDone: !!next.setupDone,
    siteName: next.siteName,
    accent: next.accent,
    bg: next.bg,
    surface: next.surface,
    text: next.text,
    allowPublicSignup: !!next.allowPublicSignup,
    replicationMode: next.replication.mode,
    replicationSelectedNodeIds: next.replication.selectedNodeIds,
    replicationDefaultNodeId: next.replication.defaultNodeId,
    replicationReplicaCount: next.replication.replicaCount,
  });
  settingsCache = toSettings(row);
  if (next.setupDone) adminSeen = true;
  return settingsCache;
}

export async function needsSetup() {
  const s = await getSettings();
  if (!s.setupDone) return true;
  if (adminSeen) return false;
  const admins = await User.count({ where: { role: 'admin' } });
  if (admins > 0) adminSeen = true;
  return admins === 0;
}

export async function closeDb() {
  await sequelize.close();
}
