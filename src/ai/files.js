/* Persist AI-generated images and audio into Cascade Files so they appear in the
 * library, dashboards and exports like any other upload. */
import { nanoid } from 'nanoid';
import { FileRecord, User } from '../db.js';
import { resolveTargets, storeToNode } from '../storage.js';

function safeName(name) {
  return String(name || 'cascade-ai')
    .replace(/[^\w.\- ]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'cascade-ai';
}

async function uniqueName(ownerId, filename) {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let candidate = filename;
  for (let i = 2; i < 200; i += 1) {
    const clash = await FileRecord.findOne({ where: { ownerId, filename: candidate } });
    if (!clash) return candidate;
    candidate = `${stem} ${i}${ext}`;
  }
  return `${stem}-${Date.now()}${ext}`;
}

export async function saveGeneratedFile(user, buffer, { filename, mime, folderId = null, source = 'cascade-ai' } = {}) {
  const owner = await User.findByPk(user.id);
  if (!owner) throw new Error('unknown user');
  const size = buffer.length;
  const all = await FileRecord.findAll({ where: { ownerId: owner.id }, attributes: ['size'] });
  const used = all.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
  if (used + size > (Number(owner.quotaBytes) || 0)) throw new Error('quota exceeded');
  const id = nanoid(12);
  const name = await uniqueName(owner.id, safeName(filename));
  const record = await FileRecord.create({
    id,
    slug: nanoid(10),
    filename: name,
    mime: mime || 'application/octet-stream',
    size,
    ownerId: owner.id,
    ownerName: owner.username,
    isPublic: false,
    replicas: [],
    kind: 'file',
    folderId,
    template: source,
  });
  const targets = await resolveTargets();
  if (!targets.length) throw new Error('no storage nodes configured');
  for (const target of targets) {
    await storeToNode(target, id, buffer, { mime: record.mime, filename: name });
    record.replicas = [...(record.replicas || []), target.id];
  }
  await record.save();
  return record;
}

export function fileJson(file) {
  return {
    id: file.id,
    filename: file.filename,
    mime: file.mime,
    size: file.size,
    url: `/f/${file.id}`,
    rawUrl: `/f/${file.id}/raw`,
    downloadUrl: `/f/${file.id}/download`,
  };
}
