import { FileRecord, Collaborator, ShareLink } from './db.js';

export const ROLE_LEVEL = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
export const ROLES = ['viewer', 'commenter', 'editor'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeRole(value) {
  const role = String(value || '').toLowerCase();
  return ROLES.includes(role) ? role : 'viewer';
}

export function roleAtLeast(role, minimum) {
  return (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[minimum] || 1);
}

/** Resolve the effective role of a user for a file. Null means no access. */
export async function accessFor(file, user) {
  if (!file) return null;
  if (user && (user.role === 'admin' || file.ownerId === user.id)) return 'owner';
  if (user) {
    const row = await Collaborator.findOne({
      where: { fileId: file.id, userId: user.id },
      order: [['createdAt', 'ASC']],
    });
    if (row) return normalizeRole(row.role);
    // Invitations addressed to the account's username also work. Cascade does
    // not require an email address for local accounts.
    const byName = await Collaborator.findOne({
      where: { fileId: file.id, username: String(user.username || '').toLowerCase() },
      order: [['createdAt', 'ASC']],
    });
    if (byName) {
      await byName.update({ userId: user.id }).catch(() => {});
      return normalizeRole(byName.role);
    }
  }
  if (file.isPublic) return 'viewer';
  return null;
}

export async function loadAccessibleFile(id, user, minimum = 'viewer') {
  const file = await FileRecord.findByPk(id);
  if (!file) return { file: null, role: null };
  const role = await accessFor(file, user);
  if (!role || !roleAtLeast(role, minimum)) return { file, role };
  return { file, role };
}

/** Resolve a capability link. Expired or revoked links fail closed. */
export async function accessByShareToken(token) {
  const link = await ShareLink.findOne({ where: { token: String(token || '') } });
  if (!link || link.revokedAt) return null;
  if (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now()) return null;
  const file = await FileRecord.findByPk(link.fileId);
  if (!file) return null;
  return { file, role: normalizeRole(link.role), link };
}

export function validInvitee(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw.length > 180) return null;
  if (EMAIL_RE.test(raw)) return { email: raw, username: null };
  if (/^[a-z0-9_.-]{2,64}$/.test(raw)) return { username: raw, email: null };
  return null;
}

export function collaboratorJson(row) {
  return {
    id: row.id,
    userId: row.userId || null,
    username: row.username || null,
    email: row.email || null,
    role: normalizeRole(row.role),
    invitedBy: row.invitedBy || null,
    createdAt: row.createdAt,
  };
}
