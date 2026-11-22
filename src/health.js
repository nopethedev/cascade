import { getDb, saveDb } from './db.js';
import { config } from './config.js';
import { allTargets, readFromNode, storeToNode, resolveTargets } from './storage.js';
import { nodeHealth } from './nodeClient.js';

export const nodeStatus = new Map(); // nodeId -> { online, latencyMs, lastSeen, error }

export async function checkAllNodes() {
  const targets = allTargets();
  await Promise.all(
    targets.map(async (n) => {
      if (n.id === 'local') {
        nodeStatus.set('local', { online: true, latencyMs: 0, lastSeen: Date.now() });
        return;
      }
      const s = await nodeHealth(n);
      nodeStatus.set(n.id, {
        online: !!s.online,
        latencyMs: s.latencyMs ?? null,
        lastSeen: s.online ? Date.now() : (nodeStatus.get(n.id)?.lastSeen || null),
        detail: s,
      });
    }),
  );
  await autoRepair();
}

// If a node went down and desired replica count is no longer met,
// copy from a healthy replica onto another healthy node ("always N" healing).
// Also heals `all` mode by topping up newly-enabled nodes.
async function autoRepair() {
  const db = getDb();
  const rep = db.settings.replication;
  if (!['n', 'all'].includes(rep.mode)) return;

  const targets = allTargets();
  const online = targets.filter((t) => (nodeStatus.get(t.id)?.online ?? true));
  if (!online.length) return;
  const onlineIds = new Set(online.map((n) => n.id));

  let changed = false;
  for (const file of db.files) {
    const live = (file.replicas || []).filter((id) => onlineIds.has(id));
    let desired;
    if (rep.mode === 'all') {
      desired = online.map((n) => n.id);
    } else {
      const want = Math.max(1, Number(rep.replicaCount) || 1);
      if (live.length >= Math.min(want, online.length)) continue;
      // pick extra online nodes we don't have yet
      const missing = online.filter((n) => !live.includes(n.id)).slice(0, want - live.length);
      desired = [...live, ...missing.map((n) => n.id)];
    }
    const need = desired.filter((id) => !(file.replicas || []).includes(id));
    if (!need.length) {
      // prune dead replicas from the record if node long offline? keep record, just ensure live list
      if (live.length !== (file.replicas || []).length) {
        // keep original list (so node coming back doesn't duplicate) — nothing to do
      }
      continue;
    }
    // fetch one good copy
    let source = null;
    for (const id of live.length ? live : (file.replicas || [])) {
      const node = targets.find((t) => t.id === id);
      if (!node) continue;
      try {
        source = await readFromNode(node, file.id);
        break;
      } catch { /* try next */ }
    }
    if (!source) continue;
    for (const id of need) {
      const node = targets.find((t) => t.id === id);
      if (!node) continue;
      try {
        await storeToNode(node, file.id, source.buffer, { filename: file.filename, mime: file.mime });
        file.replicas = [...new Set([...(file.replicas || []), id])];
        changed = true;
      } catch { /* leave for next round */ }
    }
  }
  if (changed) saveDb();
}

export function startHealthLoop() {
  checkAllNodes().catch(() => {});
  setInterval(() => checkAllNodes().catch(() => {}), config.healthcheckInterval);
}

export function desiredReplicasForDisplay() {
  const db = getDb();
  const rep = db.settings.replication;
  if (rep.mode === 'all') return allTargets().length;
  if (rep.mode === 'single' || rep.mode === 'default') return 1;
  if (rep.mode === 'select') return Math.max(1, (rep.selectedNodeIds || []).length || 1);
  return Math.max(1, Number(rep.replicaCount) || 1);
}
