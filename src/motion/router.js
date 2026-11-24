import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import multer from 'multer';
import { Op } from 'sequelize';
import {
  FileRecord, MotionAsset, MotionJob, User, getSettings,
} from '../db.js';
import { requireLogin } from '../auth.js';
import { normalizeProject, TICKS, seconds, toSeconds, timelineDuration } from '../../public/motion/schema.mjs';
import { parseCube } from '../../public/motion/animations.mjs';
import { capabilities, binary, tmpFile, cleanupFile } from './ffmpeg.js';
import {
  loadMotionProject, assetJson, serveMedia, initUploadSession, getUploadSession, appendChunk,
  abortUploadSession, storeTempAsFile, ingestFile, downloadRemote, safeMediaName, filePathFor,
  loadMotionProject as loadProject,
} from './assets.js';
import { enqueueJob, cancelJob, retryJob, jobsForProject, renderStill } from './render.js';
import { normalizeAudioCatalog } from '../../public/motion/schema.mjs';
import { motionTmpDir } from './config.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_BODY = 4096;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

export function createMotionRouter() {
  const r = express.Router();

  r.use(express.json({ limit: '4mb' }));

  async function projectFor(req, res, minimum = 'viewer') {
    const project = await loadMotionProject(req.params.id, req.user, minimum);
    if (!project) {
      res.status(404).json({ error: 'project not found' });
      return null;
    }
    return project;
  }

  async function assetFor(req, res) {
    const asset = await MotionAsset.findByPk(req.params.id);
    if (!asset) {
      res.status(404).json({ error: 'asset not found' });
      return null;
    }
    const project = await loadMotionProject(asset.projectId, req.user, 'viewer');
    if (!project) {
      res.status(404).json({ error: 'asset not found' });
      return null;
    }
    return { asset, project };
  }

  r.get('/config', requireLogin, wrap(async (req, res) => {
    const settings = await getSettings();
    const caps = await capabilities(settings.motion);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      ffmpeg: {
        available: caps.available,
        version: caps.version,
        encoders: caps.encoders,
        hwaccels: caps.hwaccels,
        hardwareDevices: caps.hardwareDevices,
        subtitles: caps.subtitles,
      },
      limits: {
        maxUploadBytes: settings.motion.maxAssetBytes,
        maxAssetsPerProject: settings.motion.maxAssetsPerProject,
        maxResolution: settings.motion.maxResolution,
        renderConcurrency: settings.motion.renderConcurrency,
        proxyEnabled: !!settings.motion.proxyEnabled,
      },
      whisper: {
        provider: settings.motion.whisper.provider,
        enabled: settings.motion.whisper.provider !== 'disabled',
        local: settings.motion.whisper.provider === 'local',
      },
      allowRemoteMedia: !!settings.motion.allowRemoteMedia,
      audioCatalog: !!settings.motion.audioCatalogUrl,
    });
  }));

  /* ----------------------------------------------------------------------- */
  /* Assets                                                                  */
  /* ----------------------------------------------------------------------- */

  r.get('/projects/:id/assets', requireLogin, wrap(async (req, res) => {
    const project = await projectFor(req, res);
    if (!project) return;
    const rows = await MotionAsset.findAll({ where: { projectId: project.id }, order: [['createdAt', 'ASC']] });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, assets: rows.map(assetJson) });
  }));

  r.post('/projects/:id/assets/attach', requireLogin, wrap(async (req, res) => {
    const project = await projectFor(req, res, 'editor');
    if (!project) return;
    const fileId = String(req.body?.fileId || '');
    const file = await FileRecord.findByPk(fileId);
    if (!file) return res.status(404).json({ error: 'file not found' });
    if (file.ownerId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'you do not own this file' });
    const count = await MotionAsset.count({ where: { projectId: project.id } });
    const settings = await getSettings();
    if (count >= settings.motion.maxAssetsPerProject) return res.status(413).json({ error: 'project asset limit reached' });
    const existing = await MotionAsset.findOne({ where: { projectId: project.id, fileId } });
    if (existing) return res.json({ ok: true, asset: assetJson(existing), duplicate: true });
    try {
      const owner = await User.findByPk(project.ownerId);
      const { asset } = await ingestFile({ file, project, settings: settings.motion, owner, source: 'library' });
      maybeProxy(asset, project, settings).catch(() => {});
      res.json({ ok: true, asset: assetJson(asset) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }));

  r.post('/projects/:id/duplicate', requireLogin, wrap(async (req, res) => {
    const project = await loadMotionProject(req.params.id, req.user, 'editor');
    if (!project) return res.status(404).json({ error: 'project not found' });
    const content = JSON.parse(project.content || '{}');
    const rows = await MotionAsset.findAll({ where: { projectId: project.id } });
    const idMap = new Map();
    for (const asset of rows) {
      const id = nanoid(20);
      idMap.set(asset.id, id);
      await MotionAsset.create({
        id, projectId: 'pending', ownerId: req.user.id, fileId: asset.fileId, kind: asset.kind,
        name: asset.name, source: asset.source, meta: asset.meta, waveform: asset.waveform,
        thumbnailFileId: asset.thumbnailFileId, proxyFileId: asset.proxyFileId, sha256: asset.sha256,
      });
    }
    let serialized = JSON.stringify(content);
    for (const [oldId, newId] of idMap) serialized = serialized.split(oldId).join(newId);
    const nextContent = JSON.parse(serialized);
    const copy = await FileRecord.create({
      id: nanoid(12), slug: nanoid(10),
      filename: `${(project.filename || 'Motion project').replace(/(\.[^.]+)?$/, '')} copy$1`,
      mime: project.mime || 'application/vnd.cascade.motion+json',
      size: Buffer.byteLength(JSON.stringify(nextContent)),
      ownerId: req.user.id, ownerName: req.user.username, kind: 'video',
      folderId: project.folderId || null, content: JSON.stringify(nextContent), version: 1,
    });
    await MotionAsset.update({ projectId: copy.id }, { where: { id: { [Op.in]: [...idMap.values()] } } });
    res.json({ ok: true, file: { id: copy.id, filename: copy.filename, url: `/edit/${copy.id}` } });
  }));

  r.post('/projects/:id/assets/remote', requireLogin, wrap(async (req, res) => {
    const project = await projectFor(req, res, 'editor');
    if (!project) return;
    const settings = await getSettings();
    if (!settings.motion.allowRemoteMedia) return res.status(403).json({ error: 'remote media is disabled by the administrator' });
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl) return res.status(400).json({ error: 'url required' });
    let downloaded;
    try {
      downloaded = await downloadRemote(rawUrl, settings.motion, { maxBytes: Math.min(settings.motion.maxAssetBytes, 512 * 1024 * 1024) });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    try {
      const owner = await User.findByPk(project.ownerId);
      const stored = await storeTempAsFile({
        tempPath: downloaded.temp,
        filename: downloaded.filename,
        mimeType: downloaded.mime,
        ownerId: project.ownerId,
        ownerName: owner?.username || 'Cascade',
        limitBytes: settings.motion.maxAssetBytes,
      });
      const { asset } = await ingestFile({ file: stored, project, settings: settings.motion, owner, source: 'url' });
      maybeProxy(asset, project, settings).catch(() => {});
      res.json({ ok: true, asset: assetJson(asset) });
    } catch (err) {
      cleanupFile(downloaded.temp);
      res.status(400).json({ error: err.message });
    }
  }));

  r.delete('/assets/:id', requireLogin, wrap(async (req, res) => {
    const found = await assetFor(req, res);
    if (!found) return;
    const project = await loadMotionProject(found.asset.projectId, req.user, 'editor');
    if (!project) return res.status(403).json({ error: 'editor access required' });
    await found.asset.destroy();
    res.json({ ok: true });
  }));

  r.get('/assets/:id/media', requireLogin, wrap(async (req, res) => {
    const found = await assetFor(req, res);
    if (!found) return;
    await serveMedia(req, res, found.asset);
  }));
  r.head('/assets/:id/media', requireLogin, wrap(async (req, res) => {
    const found = await assetFor(req, res);
    if (!found) return;
    await serveMedia(req, res, found.asset);
  }));
  r.get('/assets/:id/proxy', requireLogin, wrap(async (req, res) => {
    const found = await assetFor(req, res);
    if (!found) return;
    if (!found.asset.proxyFileId) return res.status(404).send('no proxy');
    await serveMedia(req, res, found.asset, { proxy: true });
  }));
  r.get('/assets/:id/thumbnail', requireLogin, wrap(async (req, res) => {
    const found = await assetFor(req, res);
    if (!found) return;
    if (!found.asset.thumbnailFileId) return res.status(404).send('no thumbnail');
    await serveMedia(req, res, found.asset, { thumbnail: true });
  }));
  r.get('/assets/:id/waveform', requireLogin, wrap(async (req, res) => {
    const found = await assetFor(req, res);
    if (!found) return;
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (!found.asset.waveform) return res.json({ ok: true, sampleRate: 50, peaks: [], duration: found.asset.meta?.duration || 0 });
    res.type('application/json').send(found.asset.waveform);
  }));

  /* ----------------------------------------------------------------------- */
  /* Resumable uploads                                                       */
  /* ----------------------------------------------------------------------- */

  r.post('/uploads', requireLogin, wrap(async (req, res) => {
    const project = await loadMotionProject(req.body?.projectId, req.user, 'editor');
    if (!project) return res.status(404).json({ error: 'project not found' });
    const settings = await getSettings();
    const name = safeMediaName(req.body?.name || 'upload.mp4');
    if (!name.allowed) return res.status(400).json({ error: 'unsupported media extension' });
    const size = Number(req.body?.size) || 0;
    if (size > settings.motion.maxAssetBytes) return res.status(413).json({ error: 'file exceeds the upload limit' });
    const id = initUploadSession({ ownerId: req.user.id, projectId: project.id, name: name.name, size });
    res.json({ ok: true, uploadId: id, chunkSize: 8 * 1024 * 1024 });
  }));

  r.put('/uploads/:id', requireLogin, express.raw({ type: 'application/octet-stream', limit: '32mb' }), wrap(async (req, res) => {
    const session = getUploadSession(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'upload session not found' });
    const offset = Number(req.headers['x-offset'] || req.body?.offset || 0);
    const chunk = Buffer.isBuffer(req.body) ? req.body : null;
    if (!chunk || !chunk.length) return res.status(400).json({ error: 'empty chunk' });
    try {
      const received = await appendChunk(session, offset, chunk);
      res.json({ ok: true, received });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message, received: fs.existsSync(session.temp) ? fs.statSync(session.temp).size : 0 });
    }
  }));

  r.post('/uploads/:id/complete', requireLogin, wrap(async (req, res) => {
    const session = getUploadSession(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'upload session not found' });
    const project = await loadMotionProject(session.projectId, req.user, 'editor');
    if (!project) return res.status(403).json({ error: 'project access removed' });
    const settings = await getSettings();
    const expected = Number(session.size) || 0;
    const actual = fs.existsSync(session.temp) ? fs.statSync(session.temp).size : 0;
    if (expected && actual < expected) return res.status(409).json({ error: `upload incomplete: ${actual} of ${expected} bytes`, received: actual });
    const safe = safeMediaName(session.name);
    if (!safe.allowed) {
      abortUploadSession(session);
      return res.status(400).json({ error: 'unsupported media extension' });
    }
    try {
      const owner = await User.findByPk(project.ownerId);
      const file = await storeTempAsFile({
        tempPath: session.temp,
        filename: safe.name,
        mimeType: mimeForName(safe.name),
        ownerId: project.ownerId,
        ownerName: owner?.username || 'Cascade',
        limitBytes: settings.motion.maxAssetBytes,
      });
      const { asset, duplicate } = await ingestFile({ file, project, settings: settings.motion, owner, source: 'upload', name: safe.name });
      fs.rmSync(session.metaPath, { force: true });
      maybeProxy(asset, project, settings).catch(() => {});
      res.json({ ok: true, asset: assetJson(asset), duplicate });
    } catch (err) {
      abortUploadSession(session);
      res.status(400).json({ error: err.message });
    }
  }));

  r.delete('/uploads/:id', requireLogin, wrap(async (req, res) => {
    const session = getUploadSession(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'upload session not found' });
    abortUploadSession(session);
    res.json({ ok: true });
  }));

  /* ----------------------------------------------------------------------- */
  /* LUTs                                                                    */
  /* ----------------------------------------------------------------------- */

  r.post('/projects/:id/lut', requireLogin, upload.single('lut'), wrap(async (req, res) => {
    const project = await loadMotionProject(req.params.id, req.user, 'editor');
    if (!project) return res.status(404).json({ error: 'project not found' });
    if (!req.file) return res.status(400).json({ error: 'LUT file required' });
    let parsed;
    try { parsed = parseCube(req.file.buffer.toString('utf8')); } catch (err) { return res.status(400).json({ error: err.message }); }
    const id = nanoid(20);
    const dir = path.join(path.dirname((await import('../config.js')).config.dbPath), 'motion-luts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.cube`), req.file.buffer);
    res.json({ ok: true, lut: { id, title: parsed.title, size: parsed.size, url: `/api/motion/luts/${id}` } });
  }));

  r.get('/luts/:id', requireLogin, wrap(async (req, res) => {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(req.params.id)) return res.status(404).send('not found');
    const dir = path.join(path.dirname((await import('../config.js')).config.dbPath), 'motion-luts');
    const file = path.join(dir, `${req.params.id}.cube`);
    if (!fs.existsSync(file)) return res.status(404).send('not found');
    res.type('text/plain').send(fs.readFileSync(file, 'utf8'));
  }));

  /* ----------------------------------------------------------------------- */
  /* Export, stills and jobs                                                 */
  /* ----------------------------------------------------------------------- */

  r.post('/projects/:id/export', requireLogin, wrap(async (req, res) => {
    const projectFile = await loadMotionProject(req.params.id, req.user, 'editor');
    if (!projectFile) return res.status(404).json({ error: 'project not found' });
    if (projectFile.accessRole !== 'owner' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'only the project owner can start a render' });
    }
    const settings = await getSettings();
    const content = normalizeProject(req.body?.project || {});
    const exportSettings = req.body?.settings || {};
    const width = Number(exportSettings.width) || content.width;
    if (width > settings.motion.maxResolution) {
      return res.status(400).json({ error: `the administrator limits exports to ${settings.motion.maxResolution}px wide` });
    }
    if (Buffer.byteLength(JSON.stringify(content)) > settings.motion.maxProjectBytes) {
      return res.status(413).json({ error: 'project is too large to render' });
    }
    const assets = await MotionAsset.count({ where: { projectId: projectFile.id } });
    if (!assets && timelineDuration(content) === 0) return res.status(400).json({ error: 'the timeline is empty' });
    const caps = await capabilities(settings.motion);
    if (!caps.available) return res.status(503).json({ error: 'FFmpeg is not installed on this server' });
    const job = await enqueueJob({
      type: 'export', projectId: projectFile.id, ownerId: req.user.id,
      params: {
        exportSettings,
        project: content,
        ownerName: req.user.username,
        projectName: content.name || projectFile.filename,
      },
    });
    res.json({ ok: true, job: jobJson(job) });
  }));

  r.post('/projects/:id/still', requireLogin, wrap(async (req, res) => {
    const projectFile = await loadMotionProject(req.params.id, req.user, 'viewer');
    if (!projectFile) return res.status(404).json({ error: 'project not found' });
    const content = normalizeProject(req.body?.project || JSON.parse(projectFile.content || '{}'));
    const time = Math.max(0, Number(req.body?.time) || 0);
    const width = Math.max(64, Math.min(Number(req.body?.width) || 960, 1920));
    try {
      const png = await renderStill({ project: content, projectId: projectFile.id, time, width });
      res.type('image/png').setHeader('Cache-Control', 'private, no-store').send(png);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  r.get('/projects/:id/jobs', requireLogin, wrap(async (req, res) => {
    const project = await loadMotionProject(req.params.id, req.user, 'viewer');
    if (!project) return res.status(404).json({ error: 'project not found' });
    const jobs = await MotionJob.findAll({ where: { projectId: project.id }, order: [['createdAt', 'DESC']], limit: 30 });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, jobs: jobs.map(jobJson) });
  }));

  r.get('/jobs/:id', requireLogin, wrap(async (req, res) => {
    const job = await MotionJob.findByPk(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const project = await loadMotionProject(job.projectId, req.user, 'viewer');
    if (!project) return res.status(404).json({ error: 'job not found' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, job: jobJson(job) });
  }));

  r.post('/jobs/:id/cancel', requireLogin, wrap(async (req, res) => {
    const job = await MotionJob.findByPk(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const project = await loadMotionProject(job.projectId, req.user, 'editor');
    if (!project || (job.ownerId !== req.user.id && req.user.role !== 'admin')) return res.status(403).json({ error: 'not allowed' });
    await cancelJob(job.id, job.ownerId);
    const next = await MotionJob.findByPk(job.id);
    res.json({ ok: true, job: jobJson(next) });
  }));

  r.post('/jobs/:id/retry', requireLogin, wrap(async (req, res) => {
    const job = await MotionJob.findByPk(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const project = await loadMotionProject(job.projectId, req.user, 'editor');
    if (!project || (job.ownerId !== req.user.id && req.user.role !== 'admin')) return res.status(403).json({ error: 'not allowed' });
    const next = await retryJob(job.id, job.ownerId);
    if (!next) return res.status(404).json({ error: 'job not found' });
    res.json({ ok: true, job: jobJson(next) });
  }));

  r.get('/jobs/:id/download', requireLogin, wrap(async (req, res) => {
    const job = await MotionJob.findByPk(req.params.id);
    if (!job || !job.outputFileId) return res.status(404).send('not found');
    const project = await loadMotionProject(job.projectId, req.user, 'viewer');
    if (!project) return res.status(404).send('not found');
    const file = await FileRecord.findByPk(job.outputFileId);
    if (!file) return res.status(404).send('not found');
    res.setHeader('Content-Type', file.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    const local = filePathFor(file);
    if (local) return fs.createReadStream(local).pipe(res);
    const { readFileWithFallback } = await import('../storage.js');
    const { buffer } = await readFileWithFallback(file);
    res.send(buffer);
  }));

  r.post('/projects/:id/transcribe', requireLogin, wrap(async (req, res) => {
    const project = await loadMotionProject(req.params.id, req.user, 'editor');
    if (!project) return res.status(404).json({ error: 'project not found' });
    const settings = await getSettings();
    if (settings.motion.whisper.provider === 'disabled' && !req.body?.provider) {
      return res.status(400).json({ error: 'Whisper is disabled. An administrator can enable it in Settings → Motion.' });
    }
    const assetId = req.body?.assetId;
    const asset = assetId ? await MotionAsset.findOne({ where: { id: assetId, projectId: project.id } }) : null;
    if (!asset) return res.status(400).json({ error: 'choose an audio or video asset to transcribe' });
    const job = await enqueueJob({
      type: 'transcribe', projectId: project.id, ownerId: req.user.id,
      params: {
        assetId: asset.id,
        provider: req.body?.provider || null,
        language: req.body?.language || 'auto',
        prompt: req.body?.prompt || '',
        model: String(req.body?.model || '').slice(0, 120),
        translate: req.body?.translate === true,
        translateTo: String(req.body?.translateTo || 'en').slice(0, 12),
        ownerName: req.user.username,
      },
    });
    res.json({ ok: true, job: jobJson(job) });
  }));

  /* ----------------------------------------------------------------------- */
  /* Audio library                                                           */
  /* ----------------------------------------------------------------------- */

  r.get('/audio/library', requireLogin, wrap(async (req, res) => {
    const settings = await getSettings();
    const q = String(req.query.q || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim();
    const files = await FileRecord.findAll({
      where: {
        ownerId: req.user.id,
        [Op.or]: [{ kind: 'file' }, { kind: 'video' }],
        mime: { [Op.like]: 'audio/%' },
      },
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
    const local = files.map((f) => ({
      id: `file:${f.id}`, title: f.filename.replace(/\.[^.]+$/, ''), artist: 'Your uploads',
      category: 'Uploads', url: `/f/${f.id}/raw`, fileId: f.id, duration: 0, bpm: null,
      tags: [], license: 'Original', attribution: 'Your upload',
    }));
    let remote = [];
    if (settings.motion.audioCatalogUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res2 = await fetch(settings.motion.audioCatalogUrl, { signal: controller.signal, headers: { accept: 'application/json' } });
        clearTimeout(timer);
        if (res2.ok) {
          const body = await res2.json();
          remote = normalizeAudioCatalog(Array.isArray(body) ? body : body.tracks || []);
        }
      } catch { /* catalogue is optional */ }
    }
    let all = [...local, ...remote];
    if (q) all = all.filter((x) => `${x.title} ${x.artist} ${x.tags.join(' ')}`.toLowerCase().includes(q));
    if (category) all = all.filter((x) => x.category === category);
    res.json({ ok: true, tracks: all, categories: [...new Set(all.map((x) => x.category))] });
  }));

  r.get('/projects/:id/audio-files', requireLogin, wrap(async (req, res) => {
    const project = await loadMotionProject(req.params.id, req.user, 'viewer');
    if (!project) return res.status(404).json({ error: 'project not found' });
    const rows = await MotionAsset.findAll({ where: { projectId: project.id, kind: 'audio' } });
    res.json({ ok: true, assets: rows.map(assetJson) });
  }));

  return r;
}

function jobJson(job) {
  const result = job.result || null;
  return {
    id: job.id, type: job.type, status: job.status, progress: Math.round(Number(job.progress) || 0),
    stage: job.stage || '', error: job.error || null, createdAt: job.createdAt,
    startedAt: job.startedAt, finishedAt: job.finishedAt,
    result: result ? {
      ...result,
      downloadUrl: result.outputFileId ? `/api/motion/jobs/${job.id}/download` : result.downloadUrl,
    } : null,
    params: job.type === 'export' ? { settings: job.params?.exportSettings || {} } : undefined,
  };
}

function mimeForName(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return ({
    mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/opus',
    m4a: 'audio/mp4', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    svg: 'image/svg+xml',
  })[ext] || 'application/octet-stream';
}

async function maybeProxy(asset, project, settings) {
  if (!settings.motion.proxyEnabled || asset.kind !== 'video') return;
  const meta = asset.meta || {};
  const { isBrowserDecodableVideo } = await import('./config.js');
  if (isBrowserDecodableVideo(meta.videoCodec) && Number(meta.width) <= settings.motion.proxyThreshold) return;
  const existing = await MotionJob.findOne({ where: { projectId: project.id, type: 'proxy', status: { [Op.in]: ['queued', 'running'] } } });
  if (existing) return;
  await enqueueJob({
    type: 'proxy', projectId: project.id, ownerId: project.ownerId,
    params: { assetId: asset.id, ownerName: project.ownerName || 'Cascade' },
  });
}
