import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getDb } from './db.js';
import * as nc from './nodeClient.js';

export const LOCAL_ID = 'local';

export function localPath(fileId) {
  return path.join(config.storageDir, fileId);
}

export function allTargets() {
  const db = getDb();
  const enabled = (db.nodes || []).filter((n) => n.enabled !== false);
  return [{ id: LOCAL_ID, name: 'This server (local)', url: 'local', enabled: true }, ...enabled];
}

export function resolveTargets() {
  const db = getDb();
  const rep = db.settings.replication;
  const enabled = allTargets();
  const byId = new Map(enabled.map((n) => [n.id, n]));
  const healthy = (list) => list.filter((n) => byId.has(n.id));

  switch (rep.mode) {
    case 'all':
      return enabled;
    case 'select': {
      const picked = (rep.selectedNodeIds || []).map((id) => byId.get(id)).filter(Boolean);
      return picked.length ? picked : [byId.get(LOCAL_ID)].filter(Boolean);
    }
    case 'single':
      // exactly 1 copy — prefer local, else first enabled remote
      return [byId.get(LOCAL_ID) || enabled[0]].filter(Boolean);
    case 'default': {
      const d = byId.get(rep.defaultNodeId) || byId.get(LOCAL_ID) || enabled[0];
      return [d].filter(Boolean);
    }
    case 'n':
    default: {
      const count = Math.max(1, Math.min(enabled.length, Number(rep.replicaCount) || 1));
      // Prefer local first, then remotes in stored order
      const ordered = [
        ...enabled.filter((n) => n.id === LOCAL_ID),
        ...enabled.filter((n) => n.id !== LOCAL_ID),
      ];
      return ordered.slice(0, count);
    }
  }
}

export async function storeToNode(node, fileId, buffer, meta) {
  if (node.id === LOCAL_ID) {
    fs.mkdirSync(config.storageDir, { recursive: true });
    fs.writeFileSync(localPath(fileId), buffer);
    return true;
  }
  await nc.nodeStore(node, fileId, buffer, meta);
  return true;
}

export async function readFromNode(node, fileId) {
  if (node.id === LOCAL_ID) {
    const p = localPath(fileId);
    if (!fs.existsSync(p)) throw new Error('not found locally');
    return { buffer: fs.readFileSync(p), mime: null };
  }
  return nc.nodeFetch(node, fileId);
}

// Read from first replica that works (primary first)
export async function readFileWithFallback(file) {
  const db = getDb();
  const byId = new Map(allTargets().map((n) => [n.id, n]));
  const order = [...(file.replicas || [])];
  // move primary first
  if (file.primaryNode) {
    order.sort((a, b) => (a === file.primaryNode ? -1 : b === file.primaryNode ? 1 : 0));
  }
  let lastErr = null;
  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    try {
      const r = await readFromNode(node, file.id);
      return { ...r, nodeId: id };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('no replicas available');
}

export async function deleteFromNode(node, fileId) {
  if (node.id === LOCAL_ID) {
    const p = localPath(fileId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return;
  }
  await nc.nodeDelete(node, fileId);
}

export function localDiskUsage() {
  let bytes = 0;
  let count = 0;
  if (!fs.existsSync(config.storageDir)) return { bytes, count };
  for (const f of fs.readdirSync(config.storageDir)) {
    try {
      const st = fs.statSync(path.join(config.storageDir, f));
      if (st.isFile()) {
        bytes += st.size;
        count += 1;
      }
    } catch { /* ignore */ }
  }
  return { bytes, count };
}
