import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { Readable } from 'node:stream';
import { nanoid } from 'nanoid';
import mime from 'mime-types';
import { FileRecord, MotionAsset, User, sequelize } from '../db.js';
import { resolveTargets, storeToNode, readFileWithFallback, localPath, LOCAL_ID } from '../storage.js';
import { loadAccessibleFile, roleAtLeast } from '../access.js';
import { probeFile, makeThumbnail, makeWaveform, tmpFile, cleanupFile } from './ffmpeg.js';
import { MEDIA_EXTENSIONS, isBrowserDecodableVideo, isBrowserDecodableAudio, motionTmpDir } from './config.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif', 'image/bmp']);
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/mp4', 'audio/aiff', 'audio/x-ms-wma']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/x-msvideo', 'video/mp2t', 'video/ogg', 'video/3gpp']);

export async function loadMotionProject(id, user, minimum = 'viewer') {
  const { file, role } = await loadAccessibleFile(id, user, minimum);
  if (!file || file.kind !== 'video' || !role || !roleAtLeast(role, minimum)) return null;
  file.accessRole = role;
  return file;
}

export function parseProject(file) {
  try { return JSON.parse(file.content || '{}'); } catch { return {}; }
}

export function projectAssetsJson(project) {
  return Array.isArray(project.assets) ? project.assets : [];
}

export function assetJson(asset) {
  const meta = asset.meta || {};
  return {
    id: asset.id,
    fileId: asset.fileId,
    name: asset.name,
    kind: asset.kind,
    source: asset.source,
    meta,
    duration: Number(meta.duration) || 0,
    width: Number(meta.width) || 0,
    height: Number(meta.height) || 0,
    fps: Number(meta.frameRate) || 0,
    videoCodec: meta.videoCodec || null,
    audioCodec: meta.audioCodec || null,
    audioChannels: Number(meta.audioChannels) || 0,
    bitrate: Number(meta.bitrate) || 0,
    rotation: Number(meta.rotation) || 0,
    hdr: !!meta.hdr,
    hasAudio: !!meta.hasAudio,
    hasThumbnail: !!asset.thumbnailFileId,
    hasProxy: !!asset.proxyFileId,
    hasWaveform: !!asset.waveform,
    browserDecodable: asset.kind === 'audio' ? isBrowserDecodableAudio(meta.audioCodec) : asset.kind === 'image' ? true : isBrowserDecodableVideo(meta.videoCodec),
    url: `/api/motion/assets/${asset.id}/media`,
    proxyUrl: asset.proxyFileId ? `/api/motion/assets/${asset.id}/proxy` : null,
    thumbnailUrl: asset.thumbnailFileId ? `/api/motion/assets/${asset.id}/thumbnail` : null,
    waveformUrl: asset.waveform ? `/api/motion/assets/${asset.id}/waveform` : null,
    createdAt: asset.createdAt,
  };
}

export function kindFor(mimeType, filename = '') {
  const ext = String(filename).split('.').pop().toLowerCase();
  if (IMAGE_TYPES.has(mimeType) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
  if (AUDIO_TYPES.has(mimeType) || ['mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'opus', 'm4a', 'aiff', 'wma'].includes(ext)) return 'audio';
  if (VIDEO_TYPES.has(mimeType) || ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'ts', 'mts', '3gp', 'ogv'].includes(ext)) return 'video';
  return null;
}

export function safeMediaName(name) {
  const base = path.basename(String(name || 'media')).replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').slice(0, 200);
  const ext = base.split('.').pop().toLowerCase();
  return { name: base || 'media', ext, allowed: MEDIA_EXTENSIONS.has(ext) };
}

export function filePathFor(file) {
  if ((file.replicas || []).includes(LOCAL_ID) && fs.existsSync(localPath(file.id))) return path.resolve(localPath(file.id));
  return null;
}

/* Serve a media response with byte-range support. Video elements require
 * ranges for seeking; reading a 2GB file into RAM would be a denial of service. */
export async function serveMedia(req, res, asset, { proxy = false, thumbnail = false } = {}) {
  const fileId = thumbnail ? asset.thumbnailFileId : proxy ? asset.proxyFileId : asset.fileId;
  if (!fileId) return res.status(404).send('not found');
  const file = await FileRecord.findByPk(fileId);
  if (!file) return res.status(404).send('not found');
  const type = file.mime || mime.lookup(file.filename) || 'application/octet-stream';
  const local = filePathFor(file);
  const setup = () => {
    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Content-Disposition', type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/') ? 'inline' : 'attachment');
  };
  if (!local) {
    setup();
    try {
      const { buffer } = await readFileWithFallback(file);
      return res.send(buffer);
    } catch {
      return res.status(502).send('media unavailable');
    }
  }
  setup();
  const stat = fs.statSync(local);
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start === null) { start = Math.max(0, stat.size - (end || 0)); end = stat.size - 1; }
    else if (end === null) end = stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
    }
    end = Math.min(end, stat.size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(local, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', String(stat.size));
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(local).pipe(res);
}

export async function uniqueFilename(ownerId, filename) {
  const base = String(filename || 'media').slice(0, 200);
  const existing = await FileRecord.findAll({ where: { ownerId }, attributes: ['filename'] });
  const taken = new Set(existing.map((f) => f.filename.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let n = 2;
  while (taken.has(`${stem} ${n}${ext}`.toLowerCase())) n += 1;
  return `${stem} ${n}${ext}`;
}

export async function ownerUsedBytes(ownerId) {
  const [row] = await sequelize.query('SELECT COALESCE(SUM(size),0) AS bytes FROM files WHERE ownerId = :ownerId', {
    replacements: { ownerId },
    type: sequelize.QueryTypes.SELECT,
  });
  return Number(row?.bytes) || 0;
}

export async function createStoredFile({ buffer, filename, mimeType, ownerId, ownerName, kind = 'file', quota = true }) {
  const owner = await User.findByPk(ownerId);
  const size = buffer.length;
  if (quota && owner) {
    const used = await ownerUsedBytes(ownerId);
    if (used + size > (Number(owner.quotaBytes) || 0)) {
      const err = new Error('storage quota exceeded');
      err.status = 413;
      throw err;
    }
  }
  const id = nanoid(12);
  const slug = nanoid(10);
  const name = await uniqueFilename(ownerId, filename);
  fs.mkdirSync(path.dirname(localPath(id)), { recursive: true });
  fs.writeFileSync(localPath(id), buffer);
  const stored = [LOCAL_ID];
  try {
    const targets = await resolveTargets();
    for (const target of targets) {
      if (target.id === LOCAL_ID) continue;
      await storeToNode(target, id, buffer, { filename: name, mime: mimeType }).then(() => stored.push(target.id)).catch(() => {});
    }
  } catch { /* local copy already exists */ }
  return FileRecord.create({
    id, slug, filename: name, mime: mimeType, size,
    ownerId, ownerName, isPublic: false, replicas: stored,
    primaryNode: LOCAL_ID, kind,
  });
}

export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/* Attach metadata to a file that already exists in Cascade storage. */
export async function ingestFile({ file, project, settings = null, owner, source = 'upload', tempPath = null, sha256 = null, name = null }) {
  const local = tempPath || filePathFor(file);
  if (!local) throw new Error('the primary copy is not on this server, so it cannot be probed');
  let meta;
  try {
    meta = await probeFile(local, settings || project?.motionSettings || {});
    const hinted = kindFor(file.mime, file.filename);
    if (hinted) meta.type = hinted;
  } catch (err) {
    throw new Error(`FFprobe could not read this file: ${err.message}`);
  }
  const kind = meta.type === 'video' ? 'video' : meta.type === 'audio' ? 'audio' : 'image';
  const digest = sha256 || await hashFile(local);
  const duplicate = await MotionAsset.findOne({ where: { ownerId: owner.id, sha256: digest } });
  if (duplicate && duplicate.fileId !== file.id) {
    const copy = await MotionAsset.create({
      id: nanoid(24), projectId: project.id, ownerId: owner.id, fileId: duplicate.fileId,
      kind: duplicate.kind, name: name || file.filename, source: 'duplicate', meta: duplicate.meta,
      waveform: duplicate.waveform, thumbnailFileId: duplicate.thumbnailFileId, proxyFileId: duplicate.proxyFileId, sha256: digest,
    });
    if (tempPath) cleanupFile(tempPath);
    return { asset: copy, duplicate: true };
  }

  const assetId = nanoid(24);
  let thumbnailFileId = null;
  if (kind !== 'audio') {
    const thumbPath = tmpFile('jpg');
    try {
      const at = kind === 'video' ? Math.min(1, (meta.duration || 0) / 3) : 0;
      if (await makeThumbnail(local, thumbPath, settings || project?.motionSettings || {}, at)) {
        const thumb = await createStoredFile({
          buffer: fs.readFileSync(thumbPath),
          filename: `${file.filename.replace(/\.[^.]+$/, '')}.thumb.jpg`,
          mimeType: 'image/jpeg', ownerId: owner.id, ownerName: owner.username, quota: false,
        });
        thumbnailFileId = thumb.id;
      }
    } catch { /* a missing thumbnail should not block import */ }
    cleanupFile(thumbPath);
  }
  let waveform = null;
  if (kind !== 'image') {
    try {
      const wf = await makeWaveform(local, settings || project?.motionSettings || {}, { maxSeconds: 900 });
      waveform = JSON.stringify(wf);
    } catch { /* waveform is optional */ }
  }
  const asset = await MotionAsset.create({
    id: assetId, projectId: project.id, ownerId: owner.id, fileId: file.id, kind,
    name: name || file.filename, source, meta, waveform, thumbnailFileId, proxyFileId: null, sha256: digest,
  });
  return { asset, duplicate: false };
}

/* ------------------------------------------------------------------------- */
/* Resumable uploads                                                         */
/* ------------------------------------------------------------------------- */

const uploadSessions = new Map();

function sessionPath(id, suffix) {
  return path.join(motionTmpDir(), `upload-${id}.${suffix}`);
}

export function initUploadSession({ ownerId, projectId, name, size }) {
  const id = nanoid(28);
  const temp = tmpFile('part');
  const metaPath = sessionPath(id, 'json');
  fs.writeFileSync(temp, Buffer.alloc(0));
  fs.writeFileSync(metaPath, JSON.stringify({ id, ownerId, projectId, name, size, received: 0, createdAt: Date.now(), temp }));
  uploadSessions.set(id, { id, ownerId, projectId, name, size, received: 0, temp, metaPath });
  return id;
}

export function getUploadSession(id, ownerId) {
  let session = uploadSessions.get(id);
  if (!session) {
    const metaPath = sessionPath(id, 'json');
    if (!fs.existsSync(metaPath)) return null;
    try {
      session = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch { return null; }
    if (!fs.existsSync(session.temp)) return null;
    uploadSessions.set(id, session);
  }
  if (session.ownerId !== ownerId) return null;
  return session;
}

export async function appendChunk(session, offset, chunk) {
  const current = fs.existsSync(session.temp) ? fs.statSync(session.temp).size : 0;
  if (Number(offset) !== current) {
    const err = new Error(`offset mismatch: expected ${current}`);
    err.status = 409;
    throw err;
  }
  await fs.promises.appendFile(session.temp, chunk);
  session.received = current + chunk.length;
  if (session.received > (Number(session.size) || 0) + 1024 * 1024) {
    const err = new Error('upload exceeds declared size');
    err.status = 413;
    throw err;
  }
  await fs.promises.writeFile(session.metaPath, JSON.stringify({ ...session, metaPath: undefined, received: session.received }));
  return session.received;
}

export async function finishUploadSession(session, { fileRecord, project, settings, owner, name }) {
  const result = await ingestFile({ file: fileRecord, project, settings, owner, source: 'upload', name });
  fs.rmSync(session.metaPath, { force: true });
  uploadSessions.delete(session.id);
  return result;
}

export function abortUploadSession(session) {
  cleanupFile(session.temp);
  fs.rmSync(session.metaPath, { force: true });
  uploadSessions.delete(session.id);
}

/* ------------------------------------------------------------------------- */
/* Authorized remote media                                                   */
/* ------------------------------------------------------------------------- */

function isPrivateAddress(address) {
  if (!net.isIP(address)) return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const lower = address.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower === '::';
}

export async function assertRemoteAllowed(rawUrl, settings) {
  let url;
  try { url = new URL(String(rawUrl)); } catch { throw new Error('invalid URL'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('only http(s) media URLs are supported');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not allowed');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) throw new Error('private hosts are not allowed');
  const allow = settings?.remoteHostAllowlist || [];
  if (allow.length) {
    if (!allow.includes(host)) throw new Error(`host ${host} is not on the Motion allowlist`);
  }
  const addresses = await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new Error('host could not be resolved');
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) throw new Error('private network addresses are not allowed');
  }
  return url;
}

export async function downloadRemote(rawUrl, settings, { maxBytes = 512 * 1024 * 1024 } = {}) {
  let url = await assertRemoteAllowed(rawUrl, settings);
  let res = null;
  for (let hop = 0; hop < 4; hop += 1) {
    res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'Cascade-Motion/1.0', accept: 'video/*,audio/*,image/*,*/*;q=0.8' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertRemoteAllowed(new URL(res.headers.get('location'), url).toString(), settings);
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`remote server returned ${res?.status || 'no response'}`);
  const declared = Number(res.headers.get('content-length')) || 0;
  if (declared && declared > maxBytes) throw new Error('remote media exceeds the size limit');
  const type = String(res.headers.get('content-type') || '').split(';')[0];
  if (!kindFor(type, new URL(url).pathname) && !mime.extension(type)) throw new Error('remote URL is not a supported media type');
  const temp = tmpFile();
  const handle = fs.createWriteStream(temp);
  let received = 0;
  try {
    for await (const chunk of Readable.fromWeb(res.body)) {
      received += chunk.length;
      if (received > maxBytes) throw new Error('remote media exceeds the size limit');
      if (!handle.write(chunk)) await new Promise((resolve) => handle.once('drain', resolve));
    }
  } catch (err) {
    handle.destroy();
    cleanupFile(temp);
    throw err;
  }
  await new Promise((resolve, reject) => handle.end((err) => (err ? reject(err) : resolve())));
  const pathName = path.basename(new URL(url).pathname) || `remote-${Date.now()}`;
  return { temp, filename: safeMediaName(pathName).name, mime: type || 'application/octet-stream', bytes: received };
}

/* Copy a temp file into storage without holding it in RAM. */
export async function storeTempAsFile({ tempPath, filename, mimeType, ownerId, ownerName, limitBytes }) {
  const owner = await User.findByPk(ownerId);
  const size = fs.statSync(tempPath).size;
  if (limitBytes && size > limitBytes) {
    const err = new Error(`file exceeds the ${Math.round(limitBytes / (1024 ** 2))} MB limit`);
    err.status = 413;
    throw err;
  }
  const used = await ownerUsedBytes(ownerId);
  if (owner && used + size > (Number(owner.quotaBytes) || 0)) {
    const err = new Error('storage quota exceeded');
    err.status = 413;
    throw err;
  }
  const id = nanoid(12);
  const slug = nanoid(10);
  const name = await uniqueFilename(ownerId, filename);
  fs.mkdirSync(path.dirname(localPath(id)), { recursive: true });
  await fs.promises.rename(tempPath, localPath(id));
  const replicas = [LOCAL_ID];
  try {
    const targets = await resolveTargets();
    if (targets.some((t) => t.id !== LOCAL_ID)) {
      const buffer = fs.readFileSync(localPath(id));
      for (const target of targets) {
        if (target.id === LOCAL_ID) continue;
        await storeToNode(target, id, buffer, { filename: name, mime: mimeType }).then(() => replicas.push(target.id)).catch(() => {});
      }
    }
  } catch { /* local copy is enough */ }
  return FileRecord.create({
    id, slug, filename: name, mime: mimeType, size, ownerId, ownerName,
    isPublic: false, replicas, primaryNode: LOCAL_ID, kind: 'file',
  });
}

export function publicAsset(asset) {
  return assetJson(asset);
}
