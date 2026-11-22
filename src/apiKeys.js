import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { ApiKeyRecord, User } from './db.js';
import { publicUser } from './auth.js';

// API keys look like `csk_<32 chars>`. Only the SHA-256 hash is stored, so the
// full key is shown exactly once, right after it is created.
export const API_KEY_PREFIX = 'csk_';

export function hashApiKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

export function generateApiKey() {
  const raw = API_KEY_PREFIX + nanoid(32);
  return { raw, prefix: raw.slice(0, 12), keyHash: hashApiKey(raw) };
}

export function extractApiToken(req) {
  const direct = req.get('x-api-key');
  if (direct) return direct.trim();
  const auth = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

export async function authenticateApiKey(raw) {
  if (!raw || !raw.startsWith(API_KEY_PREFIX)) return null;
  const record = await ApiKeyRecord.findOne({
    where: { keyHash: hashApiKey(raw), revokedAt: null },
  });
  if (!record) return null;
  const user = await User.findByPk(record.createdBy);
  if (!user) return null;
  record.lastUsedAt = new Date();
  await record.save();
  return { record, user: publicUser(user) };
}

export async function createApiKey({ name, createdBy }) {
  const { raw, prefix, keyHash } = generateApiKey();
  const record = await ApiKeyRecord.create({
    id: crypto.randomUUID(),
    name: String(name || 'Untitled key').trim().slice(0, 80) || 'Untitled key',
    prefix,
    keyHash,
    createdBy,
  });
  return { raw, record };
}

export async function listApiKeys() {
  const keys = await ApiKeyRecord.findAll({ order: [['createdAt', 'DESC']] });
  const users = await User.findAll();
  const byId = new Map(users.map((u) => [u.id, u]));
  return keys.map((k) => {
    const owner = byId.get(k.createdBy);
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      owner: owner ? owner.username : k.createdBy,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revoked: !!k.revokedAt,
    };
  });
}

export async function revokeApiKey(id) {
  const key = await ApiKeyRecord.findByPk(id);
  if (!key) return false;
  if (!key.revokedAt) await key.update({ revokedAt: new Date() });
  return true;
}
