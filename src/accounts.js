import { randomUUID } from 'node:crypto';
import { sequelize, User } from './db.js';
import { hashPassword } from './auth.js';

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/;
const DEFAULT_QUOTA = 5 * 1024 * 1024 * 1024;

export function normalizeUsername(value) {
  return String(value || '').trim();
}

export function validateUsername(value) {
  const name = normalizeUsername(value);
  if (!USERNAME_RE.test(name)) {
    return { ok: false, error: 'Username must be 3–32 characters using letters, numbers, dots, dashes or underscores.' };
  }
  return { ok: true, username: name };
}

/** Validation shared by registration, account settings and tests. */
export function validateNewAccount({ username, password } = {}) {
  const checkedName = validateUsername(username);
  if (!checkedName.ok) return checkedName;
  const name = checkedName.username;
  if (typeof password !== 'string' || password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  if (password.length > 200) return { ok: false, error: 'Password is too long.' };
  return { ok: true, username: name };
}

export async function usernameTaken(username, excludeId = null) {
  const wanted = normalizeUsername(username).toLowerCase();
  const found = await User.findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('username')), wanted),
  });
  return !!found && found.id !== excludeId;
}

/**
 * Create a local account. Role is deliberately restricted to `user`; the
 * public registration and account APIs must never mint administrators.
 */
export async function createAccount({ username, password, quotaBytes = DEFAULT_QUOTA, role = 'user' } = {}) {
  const checked = validateNewAccount({ username, password });
  if (!checked.ok) {
    const error = new Error(checked.error);
    error.status = 400;
    throw error;
  }
  if (await usernameTaken(checked.username)) {
    const error = new Error('That username is already taken.');
    error.status = 409;
    throw error;
  }
  const safeRole = role === 'admin' ? 'admin' : 'user';
  try {
    return await User.create({
      id: randomUUID(),
      username: checked.username,
      passwordHash: await hashPassword(password),
      role: safeRole,
      quotaBytes: Math.max(1024, Number(quotaBytes) || DEFAULT_QUOTA),
    });
  } catch (error) {
    // A concurrent request can still win the unique-index race.
    if (String(error?.name || '').includes('Unique') || /unique/i.test(String(error?.message))) {
      const conflict = new Error('That username is already taken.');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}
