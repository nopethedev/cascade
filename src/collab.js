import crypto from 'node:crypto';
import * as Y from 'yjs';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import { FileRecord, DocVersion, CollabRoom, User } from './db.js';
import { accessFor, accessByShareToken, normalizeRole, roleAtLeast } from './access.js';
import { redactFlowSecrets, scanFlowSecrets } from '../public/flow/secrets.mjs';

const MAX_CONTENT = 12 * 1024 * 1024;
const rooms = new Map();
const TOKEN_TTL_MS = 10 * 60 * 1000;

function sign(payload) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

export function issueCollabToken({ fileId, user, role, shareToken = null, name = null }) {
  const body = Buffer.from(JSON.stringify({
    fileId,
    userId: user?.id || null,
    username: user?.username || name || 'Guest',
    role: normalizeRole(role),
    shareToken,
    exp: Date.now() + TOKEN_TTL_MS,
  })).toString('base64url');
  return `${body}.${sign(body)}`;
}

function verifyCollabToken(token) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(body);
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.fileId || !payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function roomFor(file) {
  let room = rooms.get(file.id);
  if (!room) {
    const doc = new Y.Doc();
    const current = (() => {
      try {
        return JSON.parse(file.content || '{}');
      } catch {
        return {};
      }
    })();
    const safeContent = file.kind === 'flow' ? redactFlowSecrets(current) : current;
    doc.getMap('document').set('content', safeContent);
    room = {
      fileId: file.id,
      kind: file.kind,
      doc,
      clients: new Set(),
      version: Number(file.version) || 1,
      lastPersistedContent: file.content || '',
      timer: null,
      idleTimer: null,
    };
    rooms.set(file.id, room);
  }
  return room;
}

function participants(room) {
  const seen = new Map();
  for (const client of room.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const key = client.meta.userId || `guest:${client.meta.username}`;
    if (!seen.has(key)) {
      seen.set(key, {
        userId: client.meta.userId,
        username: client.meta.username,
        role: client.meta.role,
        color: client.meta.color,
        cursor: client.meta.cursor || null,
        selection: client.meta.selection || null,
        guest: !client.meta.userId,
      });
    }
  }
  return [...seen.values()];
}

function broadcast(room, payload, except = null) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const client of room.clients) {
    if (client === except || client.readyState !== WebSocket.OPEN) continue;
    try {
      client.send(text);
    } catch {
      /* dropped */
    }
  }
}

function touchPresence(room) {
  broadcast(room, { type: 'presence', users: participants(room) });
}

async function persist(room) {
  room.timer = null;
  const file = await FileRecord.findByPk(room.fileId);
  if (!file) return;
  const stored = room.doc.getMap('document').get('content');
  const content = room.kind === 'flow' ? redactFlowSecrets(stored || {}) : stored;
  if (room.kind === 'flow' && JSON.stringify(content) !== JSON.stringify(stored)) {
    room.doc.getMap('document').set('content', content);
  }
  let serialized;
  try {
    serialized = JSON.stringify(content || {});
  } catch {
    return;
  }
  if (!serialized || Buffer.byteLength(serialized) > MAX_CONTENT || serialized === room.lastPersistedContent) return;
  room.lastPersistedContent = serialized;
  const version = (Number(file.version) || 0) + 1;
  await DocVersion.create({ fileId: file.id, version, content: serialized, createdBy: null });
  const old = await DocVersion.findAll({ where: { fileId: file.id }, order: [['id', 'DESC']], offset: 25, attributes: ['id'] });
  if (old.length) await DocVersion.destroy({ where: { id: old.map((o) => o.id) } });
  await file.update({ content: serialized, size: Buffer.byteLength(serialized), version, updatedAt: new Date() });
  await CollabRoom.upsert({ fileId: file.id, revision: version, lastEditor: 'live' });
  room.version = version;
  broadcast(room, { type: 'saved', version });
}

function schedulePersist(room) {
  if (room.timer) return;
  room.timer = setTimeout(() => {
    persist(room).catch((err) => console.error('[collab] persist:', err.message));
  }, 650);
}

/** Reject revoked access immediately, not only on the next reconnect. */
export function closeUserSockets(fileId, userId) {
  for (const room of rooms.values()) {
    if (fileId && room.fileId !== fileId) continue;
    for (const client of [...room.clients]) {
      if (userId && client.meta.userId !== userId) continue;
      try {
        client.close(4001, 'access revoked');
      } catch {
        room.clients.delete(client);
      }
    }
  }
}

export function closeShareSockets(fileId, shareToken) {
  for (const room of rooms.values()) {
    if (room.fileId !== fileId) continue;
    for (const client of [...room.clients]) {
      if (client.meta.shareToken === shareToken) client.close(4001, 'share link revoked');
    }
  }
}

const COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185', '#2dd4bf', '#f97316'];
function colorFor(name) {
  let hash = 0;
  for (const ch of String(name || '?')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

async function authorize(payload) {
  const file = await FileRecord.findByPk(payload.fileId);
  if (!file || file.kind === 'file') return null;
  if (payload.shareToken) {
    const hit = await accessByShareToken(payload.shareToken);
    if (!hit || hit.file.id !== file.id) return null;
    return {
      file,
      role: hit.role,
      user: null,
      userId: null,
      username: payload.username || 'Guest',
      shareToken: payload.shareToken,
    };
  }
  if (!payload.userId) return null;
  const user = await User.findByPk(payload.userId);
  if (!user) return null;
  const role = await accessFor(file, user);
  if (!role) return null;
  return { file, role, user, userId: user.id, username: user.username, shareToken: null };
}

async function refreshAccess(client) {
  try {
    if (client.meta.shareToken) {
      const hit = await accessByShareToken(client.meta.shareToken);
      if (!hit || hit.file.id !== client.meta.fileId) return null;
      return hit.role;
    }
    const user = await User.findByPk(client.meta.userId);
    if (!user) return null;
    return await accessFor(await FileRecord.findByPk(client.meta.fileId), user);
  } catch {
    return null;
  }
}

export function startCollabServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CONTENT + 1024 });

  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/collab') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, url));
  });

  wss.on('connection', async (ws, req, url) => {
    const token = url?.searchParams.get('token');
    const payload = verifyCollabToken(token);
    if (!payload) {
      ws.close(4003, 'invalid token');
      return;
    }
    const auth = await authorize(payload);
    if (!auth) {
      ws.close(4003, 'forbidden');
      return;
    }
    const room = roomFor(auth.file);
    ws.meta = {
      fileId: auth.file.id,
      userId: auth.userId,
      username: auth.username,
      role: auth.role,
      shareToken: auth.shareToken,
      color: colorFor(auth.username),
      cursor: null,
      selection: null,
      lastAuth: Date.now(),
    };
    room.clients.add(ws);
    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }

    ws.send(JSON.stringify({
      type: 'init',
      fileId: room.fileId,
      version: room.version,
      role: auth.role,
      canWrite: roleAtLeast(auth.role, 'editor'),
      update: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64'),
      users: participants(room),
    }));
    touchPresence(room);

    ws.on('message', async (data, isBinary) => {
      try {
        if (isBinary) {
          if (!roleAtLeast(ws.meta.role, 'editor')) {
            ws.send(JSON.stringify({ type: 'error', error: 'read-only access' }));
            return;
          }
          if (Date.now() - ws.meta.lastAuth > 10000) {
            ws.meta.lastAuth = Date.now();
            const fresh = await refreshAccess(ws);
            if (!fresh || !roleAtLeast(fresh, 'editor')) {
              ws.send(JSON.stringify({ type: 'error', error: 'access revoked' }));
              ws.close(4001, 'access revoked');
              return;
            }
            ws.meta.role = fresh;
          }
          const update = new Uint8Array(data);
          if (room.kind === 'flow') {
            // Validate the resulting document before applying a Flow update so
            // raw credentials are never relayed to collaborators or persisted.
            const probe = new Y.Doc();
            try {
              Y.applyUpdate(probe, Y.encodeStateAsUpdate(room.doc));
              Y.applyUpdate(probe, update);
              const candidate = probe.getMap('document').get('content');
              if (scanFlowSecrets(candidate).length) {
                ws.send(JSON.stringify({ type: 'error', error: 'Raw credentials are not allowed in Flow graphs; use an *Env field.' }));
                return;
              }
            } finally {
              probe.destroy();
            }
          }
          Y.applyUpdate(room.doc, update, 'remote');
          for (const client of room.clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) client.send(data, { binary: true });
          }
          schedulePersist(room);
          return;
        }
        const message = JSON.parse(String(data));
        if (message.type === 'presence') {
          ws.meta.cursor = message.cursor && typeof message.cursor === 'object'
            ? { x: Math.max(-10000, Math.min(10000, Number(message.cursor.x) || 0)), y: Math.max(-10000, Math.min(10000, Number(message.cursor.y) || 0)) }
            : null;
          ws.meta.selection = typeof message.selection === 'string' ? message.selection.slice(0, 120) : null;
          touchPresence(room);
        } else if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', at: Date.now(), version: room.version }));
        } else if (message.type === 'save' && roleAtLeast(ws.meta.role, 'editor')) {
          await persist(room);
        }
      } catch (err) {
        try {
          ws.send(JSON.stringify({ type: 'error', error: 'could not apply update' }));
        } catch {
          /* ignore */
        }
      }
    });

    ws.on('close', () => {
      room.clients.delete(ws);
      touchPresence(room);
      if (!room.clients.size) {
        if (room.timer) clearTimeout(room.timer);
        persist(room).catch(() => {});
        room.idleTimer = setTimeout(() => {
          rooms.delete(room.fileId);
          room.doc.destroy();
        }, 30000);
      }
    });
    ws.on('error', () => {
      room.clients.delete(ws);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {
          /* ignore */
        }
      }
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));
  httpServer.on('close', () => {
    clearInterval(heartbeat);
    for (const room of rooms.values()) {
      if (room.timer) clearTimeout(room.timer);
      if (room.idleTimer) clearTimeout(room.idleTimer);
    }
  });
  return wss;
}
