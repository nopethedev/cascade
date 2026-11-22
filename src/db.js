import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const DEFAULTS = {
  users: [],
  files: [],
  nodes: [],
  settings: {
    setupDone: false,
    siteName: 'Cascade',
    accent: '#e11d48',
    bg: '#08080a',
    surface: '#101013',
    text: '#f3f3f4',
    allowPublicSignup: false,
    replication: {
      mode: 'n', // all | select | single | default | n
      selectedNodeIds: [],
      defaultNodeId: 'local',
      replicaCount: 2,
    },
  },
};

let db = null;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function loadDb() {
  ensureDir(path.dirname(config.dbPath));
  ensureDir(config.storageDir);
  if (!fs.existsSync(config.dbPath)) {
    db = structuredClone(DEFAULTS);
    // seed theme from env on first boot
    db.settings.siteName = process.env.SITE_NAME || DEFAULTS.settings.siteName;
    db.settings.accent = process.env.THEME_ACCENT || DEFAULTS.settings.accent;
    saveDb();
  } else {
    const raw = fs.readFileSync(config.dbPath, 'utf8');
    db = { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
    db.settings = { ...structuredClone(DEFAULTS.settings), ...(db.settings || {}) };
    db.settings.replication = {
      ...structuredClone(DEFAULTS.settings.replication),
      ...((db.settings && db.settings.replication) || {}),
    };
  }
  return db;
}

export function getDb() {
  if (!db) return loadDb();
  return db;
}

export function saveDb() {
  ensureDir(path.dirname(config.dbPath));
  fs.writeFileSync(config.dbPath, JSON.stringify(db, null, 2));
}

export function needsSetup() {
  const d = getDb();
  if (!d.settings.setupDone) return true;
  return !d.users.some((u) => u.role === 'admin');
}
