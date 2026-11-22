import express from 'express';
import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { nanoid } from 'nanoid';
import {
  FileRecord,
  DocVersion,
  StudioPairing,
  StudioSession,
  StudioCommand,
  StudioSnapshot,
} from './db.js';
import { requireLogin } from './auth.js';
import { loadAccessibleFile, roleAtLeast } from './access.js';
import { allowFormSubmission } from './formRateLimit.js';
import { buildPluginModel, pluginDownloadName } from './robloxPlugin.js';
import { issueCollabToken } from './collab.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_SCENE = 8 * 1024 * 1024;
const MAX_COMMAND = 512 * 1024;
const MAX_NODES = 8000;
const PAIR_TTL_MS = 15 * 60 * 1000;
const COMMAND_KINDS = new Set(['create', 'update', 'rename', 'reparent', 'delete', 'script', 'gui']);
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return out;
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function parseContent(file) {
  try {
    return JSON.parse(file.content || '{}');
  } catch {
    return {};
  }
}

function safeKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length < 80 && !BLOCKED_KEYS.has(key);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function validateScene(raw) {
  assertPlainObject(raw, 'scene');
  const stack = [{ value: raw, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (depth > 24) throw new Error('scene is too deeply nested');
    if (typeof value === 'string' && value.length > 250000) throw new Error('scene string is too large');
    if (Array.isArray(value)) {
      if (value.length > MAX_NODES) throw new Error('scene array is too large');
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    nodes += 1;
    if (nodes > MAX_NODES) throw new Error('scene has too many objects');
    for (const [key, child] of Object.entries(value)) {
      if (!safeKey(key)) throw new Error('scene contains an unsafe key');
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  let serialized;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    throw new Error('scene must be JSON serializable');
  }
  if (Buffer.byteLength(serialized) > MAX_SCENE) throw new Error('scene is too large');
  return JSON.parse(serialized);
}

function validateCommand(kind, payload) {
  const k = String(kind || '');
  if (!COMMAND_KINDS.has(k)) throw new Error('unsupported command');
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  if (k === 'create') {
    if (!p.className || typeof p.className !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(p.className)) throw new Error('invalid className');
    if (p.name !== undefined && (typeof p.name !== 'string' || p.name.length > 100)) throw new Error('invalid name');
    if (p.parentId !== undefined && p.parentId !== null && typeof p.parentId !== 'string') throw new Error('invalid parent');
    if (p.props !== undefined) {
      assertPlainObject(p.props, 'props');
      for (const key of Object.keys(p.props)) if (!safeKey(key)) throw new Error('props contains an unsafe key');
    }
    if (p.clientId !== undefined && (typeof p.clientId !== 'string' || !p.clientId || p.clientId.length > 80)) throw new Error('invalid clientId');
    p.clientId = p.clientId || uuid();
  }
  if (k === 'update' || k === 'rename' || k === 'reparent' || k === 'delete' || k === 'script' || k === 'gui') {
    if (typeof p.instanceId !== 'string' || p.instanceId.length > 80) throw new Error('invalid instance id');
  }
  if (k === 'update' || k === 'gui') {
    assertPlainObject(p.props || {}, 'props');
    for (const key of Object.keys(p.props || {})) if (!safeKey(key)) throw new Error('props contains an unsafe key');
  }
  if (k === 'rename' && (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100)) throw new Error('invalid name');
  if (k === 'reparent' && (typeof p.parentId !== 'string' || !p.parentId || p.parentId.length > 80)) throw new Error('invalid parent');
  if (k === 'script' && (typeof p.source !== 'string' || p.source.length > 200000)) throw new Error('invalid script source');
  const serialized = JSON.stringify(p);
  if (Buffer.byteLength(serialized) > MAX_COMMAND) throw new Error('command is too large');
  return { ...p, ...(p.props ? { props: p.props } : {}) };
}

function starterScene(placeName = 'Untitled place') {
  const id = () => uuid();
  const workspaceId = id();
  const storageId = id();
  const scriptsId = id();
  const guiId = id();
  return {
    placeName,
    services: [
      {
        id: workspaceId, className: 'Workspace', name: 'Workspace', props: { ClassName: 'Workspace' },
        children: [
          { id: id(), className: 'Part', name: 'SpawnLocation', props: { ClassName: 'Part', Anchored: true, Size: { x: 12, y: 1, z: 12 }, Position: { x: 0, y: 0.5, z: 0 }, Color: '#71717a', CanCollide: true }, children: [] },
          { id: id(), className: 'Part', name: 'Baseplate', props: { ClassName: 'Part', Anchored: true, Size: { x: 120, y: 1, z: 120 }, Position: { x: 0, y: 0, z: 0 }, Color: '#27272a', CanCollide: true }, children: [] },
        ],
      },
      { id: storageId, className: 'ReplicatedStorage', name: 'ReplicatedStorage', props: { ClassName: 'ReplicatedStorage' }, children: [] },
      { id: scriptsId, className: 'ServerScriptService', name: 'ServerScriptService', props: { ClassName: 'ServerScriptService' }, children: [] },
      { id: guiId, className: 'StarterGui', name: 'StarterGui', props: { ClassName: 'StarterGui' }, children: [] },
    ],
    pluginVersion: null,
    capturedAt: null,
  };
}

function findSceneNode(nodes, id) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') continue;
    if (node.id === id) return node;
    const found = findSceneNode(node.children, id);
    if (found) return found;
  }
  return null;
}

function sceneParentOf(nodes, id, parent = null) {
  for (const node of nodes || []) {
    if (node.id === id) return parent;
    const found = sceneParentOf(node.children, id, node);
    if (found) return found;
  }
  return null;
}

function isSceneDescendant(node, id) {
  if (!node) return false;
  for (const child of node.children || []) {
    if (child.id === id || isSceneDescendant(child, id)) return true;
  }
  return false;
}

/** Apply the same supported command the plugin will apply, so a disconnected
 * browser session still persists its project. The next plugin snapshot remains
 * the authority and reconciles any unsupported property with Studio. */
function applyCommandToContent(content, kind, payload) {
  const scene = content?.scene?.services ? content.scene : content;
  const services = Array.isArray(scene?.services) ? scene.services : [];
  if (!services.length) return content;
  if (kind === 'create') {
    const parent = findSceneNode(services, payload.parentId) || services.find((s) => s.name === 'Workspace');
    if (!parent) return content;
    const id = String(payload.clientId || uuid());
    if (findSceneNode(services, id)) return content;
    parent.children = Array.isArray(parent.children) ? parent.children : [];
    parent.children.push({
      id,
      className: String(payload.className),
      name: String(payload.name || payload.className).slice(0, 100),
      props: { ClassName: payload.className, ...(payload.props || {}) },
      children: [],
    });
    return content;
  }
  const node = findSceneNode(services, payload.instanceId);
  if (!node) return content;
  if (kind === 'update' || kind === 'gui') {
    node.props = { ...(node.props && typeof node.props === 'object' ? node.props : {}), ...(payload.props || {}) };
  } else if (kind === 'rename') {
    node.name = String(payload.name);
    node.props = { ...(node.props || {}), Name: node.name };
  } else if (kind === 'script') {
    node.props = { ...(node.props || {}), Source: String(payload.source || '') };
  } else if (kind === 'reparent') {
    const parent = findSceneNode(services, payload.parentId);
    if (!parent || parent === node || isSceneDescendant(node, parent.id)) return content;
    const oldParent = sceneParentOf(services, node.id);
    if (oldParent) oldParent.children = (oldParent.children || []).filter((child) => child.id !== node.id);
    parent.children = Array.isArray(parent.children) ? parent.children : [];
    parent.children.push(node);
  } else if (kind === 'delete') {
    const oldParent = sceneParentOf(services, node.id);
    // Core services are not deletable from the relay.
    if (!oldParent) return content;
    oldParent.children = (oldParent.children || []).filter((child) => child.id !== node.id);
  }
  return content;
}

function projectJson(file, role) {
  const content = parseContent(file);
  return {
    id: file.id,
    filename: file.filename,
    version: file.version,
    isPublic: !!file.isPublic,
    role,
    content,
  };
}

function sessionState(session) {
  if (!session) return { status: 'disconnected', placeName: null, lastHeartbeat: null };
  if (session.revokedAt) return { status: 'revoked', placeName: session.placeName, lastHeartbeat: session.lastHeartbeat };
  const age = session.lastHeartbeat ? Date.now() - new Date(session.lastHeartbeat).getTime() : Infinity;
  return {
    status: age < 45000 ? 'connected' : 'stale',
    id: session.id,
    placeName: session.placeName,
    clientVersion: session.clientVersion,
    lastHeartbeat: session.lastHeartbeat,
    revokedAt: session.revokedAt,
  };
}

async function latestSession(fileId) {
  return StudioSession.findOne({ where: { fileId }, order: [['createdAt', 'DESC']] });
}

async function loadProject(id, user, minimum = 'viewer') {
  const { file, role } = await loadAccessibleFile(id, user, minimum);
  if (!file || file.kind !== 'roblox' || !role || !roleAtLeast(role, minimum)) return null;
  file.accessRole = role;
  return file;
}

function relayToken(req) {
  // A dedicated header keeps a Studio session token away from the browser/API
  // key Authorization path. The plugin never receives a Cascade account key.
  return String(req.get('x-studio-token') || '').trim() || null;
}

async function relayAuth(req) {
  const token = relayToken(req);
  if (!token) return null;
  const session = await StudioSession.findOne({ where: { tokenHash: hash(token) } });
  if (!session) return null;
  const file = await FileRecord.findByPk(session.fileId);
  if (!file || file.kind !== 'roblox') return null;
  if (session.revokedAt) return { session, file, revoked: true };
  return { session, file, revoked: false };
}

function origin(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.get('host') || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}`;
}

export function createStudioRouter() {
  const r = express.Router();

  r.get('/studio/roblox', requireLogin, wrap(async (req, res) => {
    const projects = await FileRecord.findAll({
      where: { kind: 'roblox', ownerId: req.user.id },
      order: [['updatedAt', 'DESC']],
      limit: 60,
    });
    const rows = [];
    for (const file of projects) {
      const session = await latestSession(file.id);
      rows.push({ file, session: sessionState(session) });
    }
    res.render('studio/index', {
      title: 'Roblox Studio',
      projects: rows,
      pluginUrl: '/studio/roblox/plugin.rbxmx',
      setup: !projects.length,
    });
  }));

  r.post('/studio/roblox', requireLogin, wrap(async (req, res) => {
    const name = String(req.body?.name || 'Roblox project').trim().slice(0, 120) || 'Roblox project';
    const content = starterScene(name);
    const serialized = JSON.stringify(content);
    const file = await FileRecord.create({
      id: nanoid(12),
      slug: nanoid(10),
      filename: name,
      mime: 'application/x-cascade-roblox',
      size: Buffer.byteLength(serialized),
      ownerId: req.user.id,
      ownerName: req.user.username,
      isPublic: false,
      replicas: [],
      content: serialized,
      kind: 'roblox',
      folderId: null,
      template: 'roblox-starter',
      version: 1,
    });
    await DocVersion.create({ fileId: file.id, version: 1, content: serialized, createdBy: req.user.id });
    res.redirect(`/studio/roblox/${file.id}`);
  }));

  r.get('/studio/roblox/plugin.rbxmx', requireLogin, wrap(async (req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${pluginDownloadName()}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buildPluginModel());
  }));

  r.get('/studio/roblox/plugin-source.luau', requireLogin, wrap(async (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="CascadePlugin.luau"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send((await import('./robloxPlugin.js')).pluginSource);
  }));

  r.get('/studio/roblox/:id', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user);
    if (!file) return res.status(404).render('error', { message: 'Roblox project not found.', status: 404 });
    const content = parseContent(file);
    const session = sessionState(await latestSession(file.id));
    res.render('studio/project', {
      title: file.filename,
      file,
      content,
      role: file.accessRole,
      canEdit: roleAtLeast(file.accessRole, 'editor'),
      session,
      projectJson: JSON.stringify({ ...projectJson(file, file.accessRole), session }).replace(/</g, '\\u003c'),
    });
  }));

  r.post('/api/studio/projects', requireLogin, wrap(async (req, res) => {
    const name = String(req.body?.name || 'Roblox project').trim().slice(0, 120) || 'Roblox project';
    const content = starterScene(name);
    const serialized = JSON.stringify(content);
    const file = await FileRecord.create({
      id: nanoid(12),
      slug: nanoid(10),
      filename: name,
      mime: 'application/x-cascade-roblox',
      size: Buffer.byteLength(serialized),
      ownerId: req.user.id,
      ownerName: req.user.username,
      isPublic: false,
      replicas: [],
      content: serialized,
      kind: 'roblox',
      folderId: null,
      template: 'roblox-starter',
      version: 1,
    });
    await DocVersion.create({ fileId: file.id, version: 1, content: serialized, createdBy: req.user.id });
    res.json({ ok: true, id: file.id, url: `/studio/roblox/${file.id}` });
  }));

  r.get('/api/studio/projects/:id', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user);
    if (!file) return res.status(404).json({ error: 'not found' });
    const session = sessionState(await latestSession(file.id));
    const commands = await StudioCommand.findAll({ where: { fileId: file.id }, order: [['createdAt', 'DESC']], limit: 60 });
    res.json({ ok: true, project: projectJson(file, file.accessRole), session, commands });
  }));

  r.post('/api/studio/projects/:id/pair', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    await StudioPairing.update({ expiresAt: new Date() }, { where: { fileId: file.id, usedAt: null } });
    const code = randomCode();
    const pairing = await StudioPairing.create({
      id: uuid(),
      fileId: file.id,
      userId: req.user.id,
      codeHash: hash(code),
      expiresAt: new Date(Date.now() + PAIR_TTL_MS),
    });
    res.json({
      ok: true,
      pairing: {
        id: pairing.id,
        code,
        expiresAt: pairing.expiresAt,
        baseUrl: origin(req),
        relayUrl: `${origin(req)}/api/studio/relay`,
        projectId: file.id,
        projectName: file.filename,
        pluginUrl: `${origin(req)}/studio/roblox/plugin.rbxmx`,
      },
    });
  }));

  r.get('/api/studio/projects/:id/session', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user);
    if (!file) return res.status(404).json({ error: 'not found' });
    const session = await latestSession(file.id);
    res.json({ ok: true, session: sessionState(session), project: projectJson(file, file.accessRole) });
  }));

  r.post('/api/studio/projects/:id/commands', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    let payload;
    try {
      payload = validateCommand(req.body?.kind, req.body?.payload);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const session = await latestSession(file.id);
    const command = await StudioCommand.create({
      id: uuid(),
      fileId: file.id,
      // Leave commands unassigned until a live plugin claims them. This is what
      // lets edits queued while Studio was closed survive a reconnect.
      sessionId: null,
      kind: String(req.body.kind),
      payload,
      status: 'queued',
      createdBy: req.user.id,
    });
    // Persist an optimistic browser-side edit immediately. Without this, a
    // project built while Studio is closed would vanish on reload even though
    // its commands are still queued for the plugin.
    let content = parseContent(file);
    const previous = JSON.stringify(content);
    content = applyCommandToContent(content, command.kind, payload);
    const serialized = JSON.stringify(content);
    if (serialized !== previous) {
      await file.update({
        content: serialized,
        size: Buffer.byteLength(serialized),
        version: file.version + 1,
        updatedAt: new Date(),
      });
    }
    res.status(201).json({
      ok: true,
      queued: true,
      command: { id: command.id, kind: command.kind, status: command.status, createdAt: command.createdAt },
      version: file.version,
      session: sessionState(session),
    });
  }));

  r.get('/api/studio/projects/:id/commands', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user);
    if (!file) return res.status(404).json({ error: 'not found' });
    const commands = await StudioCommand.findAll({ where: { fileId: file.id }, order: [['createdAt', 'DESC']], limit: 100 });
    res.json({ ok: true, commands });
  }));

  r.post('/api/studio/projects/:id/sessions/:sessionId/revoke', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const session = await StudioSession.findOne({ where: { id: req.params.sessionId, fileId: file.id } });
    if (!session) return res.status(404).json({ error: 'not found' });
    await session.update({ revokedAt: new Date(), status: 'revoked' });
    await StudioCommand.update({ status: 'cancelled' }, { where: { sessionId: session.id, status: 'queued' } });
    res.json({ ok: true, session: sessionState(session) });
  }));

  r.get('/api/studio/projects/:id/collab-token', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user);
    if (!file) return res.status(404).json({ error: 'not found' });
    res.json({
      ok: true,
      token: issueCollabToken({ fileId: file.id, user: req.user, role: file.accessRole, name: req.user.username }),
      canEdit: roleAtLeast(file.accessRole, 'editor'),
    });
  }));

  r.get('/api/studio/projects/:id/snapshots', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user);
    if (!file) return res.status(404).json({ error: 'not found' });
    const snapshots = await StudioSnapshot.findAll({
      where: { fileId: file.id },
      attributes: ['id', 'label', 'createdBy', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: 30,
    });
    res.json({ ok: true, snapshots });
  }));

  r.post('/api/studio/projects/:id/snapshots', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const snap = await StudioSnapshot.create({
      fileId: file.id,
      scene: file.content,
      label: String(req.body?.label || 'Manual snapshot').slice(0, 160),
      createdBy: req.user.id,
    });
    await pruneSnapshots(file.id);
    res.status(201).json({ ok: true, id: snap.id, snapshot: snap });
  }));

  r.post('/api/studio/projects/:id/snapshots/:snapshotId/restore', requireLogin, wrap(async (req, res) => {
    const file = await loadProject(req.params.id, req.user, 'editor');
    if (!file) return res.status(404).json({ error: 'not found' });
    const snap = await StudioSnapshot.findOne({ where: { id: req.params.snapshotId, fileId: file.id } });
    if (!snap) return res.status(404).json({ error: 'snapshot not found' });
    let content;
    try {
      content = JSON.stringify(JSON.parse(snap.scene));
    } catch {
      return res.status(422).json({ error: 'snapshot is not valid scene JSON' });
    }
    const previousVersion = file.version;
    const previousContent = file.content;
    await file.update({
      content,
      size: Buffer.byteLength(content),
      version: previousVersion + 1,
      updatedAt: new Date(),
    });
    await DocVersion.create({ fileId: file.id, version: previousVersion, content: previousContent, createdBy: req.user.id });
    res.json({ ok: true, version: file.version, content: JSON.parse(content) });
  }));

  // ------------------------- plugin relay (no cookies) -------------------------
  r.post('/api/studio/relay/connect', wrap(async (req, res) => {
    const limit = allowFormSubmission(`studio-connect:${req.ip || 'unknown'}`);
    if (!limit.ok) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      return res.status(429).json({ error: 'too many connection attempts' });
    }
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) return res.status(401).json({ error: 'invalid pairing code' });
    const pairing = await StudioPairing.findOne({
      where: { codeHash: hash(code) },
      order: [['createdAt', 'DESC']],
    });
    if (!pairing || pairing.usedAt || new Date(pairing.expiresAt).getTime() < Date.now()) {
      return res.status(401).json({ error: 'invalid or expired pairing code' });
    }
    const file = await FileRecord.findByPk(pairing.fileId);
    if (!file || file.kind !== 'roblox') return res.status(404).json({ error: 'project not found' });
    const raw = randomToken();
    const session = await StudioSession.create({
      id: uuid(),
      fileId: file.id,
      userId: pairing.userId,
      pairingId: pairing.id,
      tokenHash: hash(raw),
      placeName: String(req.body?.placeName || file.filename).slice(0, 160),
      clientVersion: String(req.body?.pluginVersion || '').slice(0, 32) || null,
      status: 'connected',
      lastHeartbeat: new Date(),
    });
    // Claim the pairing atomically: a second request cannot reuse the code.
    const claimed = await StudioPairing.update(
      { usedAt: new Date(), sessionId: session.id },
      { where: { id: pairing.id, usedAt: null } },
    );
    if (!claimed[0]) {
      await session.destroy();
      return res.status(401).json({ error: 'pairing code already used' });
    }
    res.status(201).json({
      ok: true,
      token: raw,
      sessionId: session.id,
      projectId: file.id,
      projectName: file.filename,
      pollIntervalMs: 1400,
      instructions: 'Poll /api/studio/relay/poll with this bearer token. Send heartbeat every 10s and a snapshot after applying commands.',
    });
  }));

  r.post('/api/studio/relay/heartbeat', wrap(async (req, res) => {
    const auth = await relayAuth(req);
    if (!auth) return res.status(401).json({ error: 'invalid session token' });
    if (auth.revoked) return res.status(410).json({ error: 'session revoked', revoked: true });
    await auth.session.update({
      lastHeartbeat: new Date(),
      status: 'connected',
      placeName: String(req.body?.placeName || auth.session.placeName || auth.file.filename).slice(0, 160),
      clientVersion: String(req.body?.pluginVersion || auth.session.clientVersion || '').slice(0, 32) || null,
    });
    res.json({ ok: true, placeName: auth.session.placeName, serverTime: new Date().toISOString() });
  }));

  r.get('/api/studio/relay/poll', wrap(async (req, res) => {
    const auth = await relayAuth(req);
    if (!auth) return res.status(401).json({ error: 'invalid session token' });
    if (auth.revoked) return res.status(410).json({ error: 'session revoked', revoked: true });
    await auth.session.update({ lastHeartbeat: new Date(), status: 'connected' });
    const commands = await StudioCommand.findAll({
      where: {
        fileId: auth.session.fileId,
        status: 'queued',
        sessionId: auth.session.id,
      },
      order: [['createdAt', 'ASC']],
      limit: 20,
    });
    // Commands queued before a session connected have a null sessionId. Claim
    // them for this session, one at a time, so two plugins cannot apply the
    // same change.
    if (commands.length < 20) {
      const unassigned = await StudioCommand.findAll({
        where: { fileId: auth.session.fileId, status: 'queued', sessionId: null },
        order: [['createdAt', 'ASC']],
        limit: 20 - commands.length,
      });
      commands.push(...unassigned);
    }
    const claimed = [];
    for (const command of commands) {
      const [affected] = await StudioCommand.update(
        { status: 'delivered', sessionId: auth.session.id, deliveredAt: new Date() },
        { where: { id: command.id, status: 'queued' } },
      );
      if (affected) claimed.push({ id: command.id, kind: command.kind, payload: command.payload, createdAt: command.createdAt });
    }
    res.json({ ok: true, commands: claimed, serverTime: new Date().toISOString() });
  }));

  r.post('/api/studio/relay/ack', wrap(async (req, res) => {
    const auth = await relayAuth(req);
    if (!auth) return res.status(401).json({ error: 'invalid session token' });
    if (auth.revoked) return res.status(410).json({ error: 'session revoked', revoked: true });
    const records = Array.isArray(req.body?.commands) ? req.body.commands.slice(0, 50) : [];
    const results = [];
    for (const record of records) {
      if (!record || typeof record.id !== 'string') continue;
      const command = await StudioCommand.findOne({ where: { id: record.id, fileId: auth.session.fileId } });
      if (!command) continue;
      const ok = record.ok === true;
      await command.update({
        status: ok ? 'applied' : 'failed',
        result: ok ? (record.result && typeof record.result === 'object' ? record.result : null) : null,
        error: ok ? null : String(record.error || 'plugin failed').slice(0, 2000),
        appliedAt: new Date(),
      });
      results.push({ id: command.id, ok });
    }
    res.json({ ok: true, processed: results.length, results });
  }));

  r.post('/api/studio/relay/snapshot', wrap(async (req, res) => {
    const auth = await relayAuth(req);
    if (!auth) return res.status(401).json({ error: 'invalid session token' });
    if (auth.revoked) return res.status(410).json({ error: 'session revoked', revoked: true });
    let scene;
    try {
      scene = validateScene(req.body?.scene);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const placeName = String(req.body?.placeName || scene.placeName || auth.session.placeName || auth.file.filename).slice(0, 160);
    scene.placeName = placeName;
    scene.pluginVersion = String(req.body?.pluginVersion || auth.session.clientVersion || '').slice(0, 32) || null;
    scene.capturedAt = new Date().toISOString();
    const content = { ...parseContent(auth.file), placeName, scene, lastSnapshotAt: new Date().toISOString() };
    const serialized = JSON.stringify(content);
    if (Buffer.byteLength(serialized) > MAX_SCENE + 200000) return res.status(413).json({ error: 'snapshot too large' });
    const previousVersion = auth.file.version;
    const previousContent = auth.file.content;
    await auth.file.update({ content: serialized, size: Buffer.byteLength(serialized), version: previousVersion + 1, updatedAt: new Date() });
    // Snapshot the revision that existed before this plugin upload; the
    // restored version must match what a browser client previously saw.
    await DocVersion.create({ fileId: auth.file.id, version: previousVersion, content: previousContent, createdBy: auth.session.userId });
    await StudioSnapshot.create({ fileId: auth.file.id, scene: serialized, label: 'Studio snapshot', createdBy: auth.session.userId });
    await pruneSnapshots(auth.file.id);
    await auth.session.update({ placeName, lastHeartbeat: new Date(), status: 'connected' });
    res.json({ ok: true, version: auth.file.version, placeName, nodes: scene.services?.length || 0 });
  }));

  return r;
}

async function pruneSnapshots(fileId) {
  const rows = await StudioSnapshot.findAll({ where: { fileId }, order: [['createdAt', 'DESC']], limit: 100 });
  const stale = rows.slice(20);
  if (stale.length) await StudioSnapshot.destroy({ where: { id: stale.map((row) => row.id) } });
}

export { starterScene, validateScene, validateCommand, applyCommandToContent };
