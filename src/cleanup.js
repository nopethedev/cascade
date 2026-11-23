import fs from 'node:fs';
import path from 'node:path';

/**
 * Find local blobs that have no FileRecord. Local blob names are file ids, so
 * the comparison is exact and case-sensitive. Directories and unreadable
 * entries are reported as skipped rather than deleted.
 */
export function scanUnusedStorage({ storageDir, knownIds = [] } = {}) {
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds);
  const result = { files: [], bytes: 0, totalBytes: 0, totalFiles: 0, knownFiles: 0, skipped: 0 };
  if (!storageDir || !fs.existsSync(storageDir)) return result;
  for (const name of fs.readdirSync(storageDir)) {
    let stat;
    try {
      stat = fs.statSync(path.join(storageDir, name));
    } catch {
      result.skipped += 1;
      continue;
    }
    if (!stat.isFile()) {
      result.skipped += 1;
      continue;
    }
    result.totalFiles += 1;
    result.totalBytes += stat.size;
    if (known.has(name)) {
      result.knownFiles += 1;
      continue;
    }
    result.files.push({
      name,
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
    result.bytes += stat.size;
  }
  result.files.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  return result;
}

/** Delete only the files returned by scanUnusedStorage; never directories. */
export function removeUnusedStorage({ storageDir, files = [] } = {}) {
  const deleted = [];
  const failed = [];
  let bytes = 0;
  for (const file of files) {
    const name = typeof file === 'string' ? file : file?.name;
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') continue;
    const target = path.join(storageDir, name);
    try {
      const stat = fs.statSync(target);
      if (!stat.isFile()) continue;
      fs.unlinkSync(target);
      deleted.push({ name, bytes: stat.size });
      bytes += stat.size;
    } catch (error) {
      failed.push({ name, error: error?.message || 'delete failed' });
    }
  }
  return { deleted, failed, bytes };
}
