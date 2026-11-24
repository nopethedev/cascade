import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { Op } from 'sequelize';
import {
  MotionAsset, MotionJob, FileRecord, getSettings,
} from '../db.js';
import {
  normalizeProject, timelineDuration, TICKS, toSeconds, formatDuration,
} from '../../public/motion/schema.mjs';
import { buildCommand } from './filtergraph.js';
import { capabilities, binary, probeFile, parseProgress, cleanupFile, ensureFontConfig } from './ffmpeg.js';
import { motionJobDir } from './config.js';
import { readFileWithFallback } from '../storage.js';
import { filePathFor, storeTempAsFile } from './assets.js';
import { transcribe, translateCues } from './whisper.js';
import { renderParticleEffects } from './particles.js';
import { renderCompositions } from './compositions.js';

const active = new Map();
let draining = false;
let started = false;

function jobDir(id) {
  const dir = path.join(motionJobDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function resetInterruptedJobs() {
  const rows = await MotionJob.findAll({ where: { status: { [Op.in]: ['running'] } } });
  for (const job of rows) {
    await job.update({
      status: 'failed',
      error: 'The server restarted while this job was running. Retry to render it again.',
      finishedAt: new Date(),
      stage: 'interrupted',
    });
  }
  fs.mkdirSync(motionJobDir(), { recursive: true });
}

export async function enqueueJob({ type = 'export', projectId, ownerId, params, priority = false }) {
  const job = await MotionJob.create({
    id: nanoid(20), projectId, ownerId, type, status: 'queued', progress: 0,
    stage: 'Waiting for a render slot', params: params || {},
  });
  drain(priority);
  return job;
}

export async function startRenderQueue() {
  if (started) return;
  started = true;
  await resetInterruptedJobs();
  drain();
  setInterval(() => { drain().catch(() => {}); }, 5_000).unref?.();
  setInterval(() => { cleanupOldJobs().catch(() => {}); }, 6 * 60 * 60 * 1000).unref?.();
}

export async function drain(priority = false) {
  if (draining) return;
  draining = true;
  try {
    const settings = await getSettings();
    const limit = Number(settings.motion?.renderConcurrency) || 1;
    while (active.size < limit) {
      const queue = await MotionJob.findAll({
        where: { status: 'queued' },
        order: priority ? [['createdAt', 'DESC']] : [['createdAt', 'ASC']],
        limit: 1,
      });
      const job = queue[0];
      if (!job) break;
      await job.update({ status: 'running', startedAt: new Date(), stage: 'Preparing media' });
      const promise = runJob(job)
        .catch(async (err) => {
          const current = await MotionJob.findByPk(job.id);
          if (current?.status === 'cancelled') return;
          await MotionJob.update({
            status: 'failed', error: String(err?.message || err).slice(0, 4000),
            stage: 'failed', finishedAt: new Date(),
          }, { where: { id: job.id } });
        })
        .finally(() => {
          active.delete(job.id);
          drain().catch(() => {});
        });
      active.set(job.id, promise);
    }
  } finally {
    draining = false;
  }
}

async function setStage(job, stage, progress) {
  const latest = await MotionJob.findByPk(job.id).catch(() => null);
  if (latest?.status === 'cancelled' || latest?.status === 'failed') return;
  await MotionJob.update({
    stage,
    ...(progress !== undefined ? { progress: Math.max(0, Math.min(100, progress)) } : {}),
  }, { where: { id: job.id } });
}

async function loadMedia(project, projectId) {
  const rows = await MotionAsset.findAll({ where: { projectId } });
  const assets = [];
  const paths = {};
  const cleanups = [];
  for (const asset of rows) {
    const file = await FileRecord.findByPk(asset.fileId);
    if (!file) continue;
    let local = filePathFor(file);
    if (local) local = path.resolve(local);
    if (!local) {
      try {
        const { buffer } = await readFileWithFallback(file);
        local = path.join(jobDir(`asset-${nanoid(8)}`), file.filename || 'media');
        fs.mkdirSync(path.dirname(local), { recursive: true });
        fs.writeFileSync(local, buffer);
        cleanups.push(path.dirname(local));
      } catch {
        continue;
      }
    }
    assets.push({ ...asset.toJSON(), meta: asset.meta || {} });
    paths[asset.id] = path.resolve(local);
  }
  return { assets, paths, cleanups };
}

async function runJob(job) {
  const settings = await getSettings();
  const params = job.params || {};
  const project = normalizeProject(params.project || {});
  const dir = jobDir(job.id);
  if (job.type === 'proxy') return runProxyJob(job, settings, params, dir);
  if (job.type === 'transcribe') return runTranscribeJob(job, settings, params, dir);
  return runExportJob(job, settings, params, project, dir);
}

async function runExportJob(job, settings, params, project, dir) {
  const loaded = await loadMedia(project, job.projectId);
  const { assets, paths, cleanups } = loaded;
  const warnings = [];
  const outputName = `${safeStem(project.name || params.name || 'Cascade Motion')}.${extensionFor(params.exportSettings?.container || 'mp4')}`;
  const outputPath = path.join(dir, outputName);
  const caps = await capabilities(settings.motion);
  if (!caps.available) throw new Error('FFmpeg is not installed on this server. Install FFmpeg and restart Cascade.');
  let renderProject = project;
  try {
    await setStage(job, 'Rendering particle layers', 1);
    const particles = await renderParticleEffects({ project, settings: { ...settings.motion, capabilities: caps }, jobDir: dir, warnings });
    if (particles) {
      renderProject = particles.project;
      assets.push(...particles.assets);
      Object.assign(paths, particles.paths);
    }
  } catch (err) {
    warnings.push(`Particle layers could not be rendered: ${err.message}`);
  }
  const cancelledAfterParticles = await MotionJob.findByPk(job.id);
  if (cancelledAfterParticles?.status === 'cancelled') return;
  try {
    await setStage(job, 'Flattening compositions', 2);
    const comps = await renderCompositions({ project, assets, paths, settings: { ...settings.motion, capabilities: caps }, jobDir: dir, warnings });
    if (comps) {
      renderProject = { ...renderProject, clips: renderProject.clips.map((clip) => {
        if (clip.type !== 'composition') return clip;
        const replacement = comps.project.clips.find((c) => c.id === clip.id);
        return replacement && replacement.assetId ? replacement : clip;
      }) };
      assets.push(...comps.assets);
      Object.assign(paths, comps.paths);
    }
  } catch (err) {
    warnings.push(`Compositions could not be flattened: ${err.message}`);
  }
  const cancelledAfterComps = await MotionJob.findByPk(job.id);
  if (cancelledAfterComps?.status === 'cancelled') return;
  const command = buildCommand(renderProject, assets, paths, { ...settings.motion, capabilities: caps }, {
    exportSettings: params.exportSettings || {},
    outputPath,
    jobDir: dir,
    warnings,
    fontsDir: path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'assets', 'fonts'),
  });
  if (!assets.length && timelineDuration(project) > 0) {
    // A title-only or colour-only project is legitimate; no inputs needed.
    warnings.push('No media assets were found; the render contains the timeline background, titles and audio mix.');
  }
  await setStage(job, 'Rendering', 1);
  const duration = command.plan.duration;
  let lastUpdate = 0;
  let lineBuf = '';
  const childRef = { child: null };
  const promise = spawnProgress(command.args, {
    cwd: dir,
    bin: binary(settings.motion),
    signal: childRef,
    jobId: job.id,
    timeoutMs: (Number(settings.motion?.renderTimeoutSeconds) || 3600) * 1000,
    onLine(line) {
      const parsed = parseProgress(line);
      if (parsed.progress === 'end') return;
      if (parsed.seconds != null && duration) {
        const pct = Math.max(1, Math.min(99, (parsed.seconds / duration) * 100));
        if (Date.now() - lastUpdate > 800) {
          lastUpdate = Date.now();
          setStage(job, `Rendering · ${formatDuration(parsed.seconds * TICKS)} / ${formatDuration(duration * TICKS)}`, pct).catch(() => {});
        }
      }
    },
  });
  try {
    await promise;
  } catch (err) {
    const current = await MotionJob.findByPk(job.id);
    if (current?.status === 'cancelled') {
      cleanupFile(outputPath);
      return;
    }
    throw err;
  }
  const finished = await MotionJob.findByPk(job.id);
  if (finished?.status === 'cancelled') {
    cleanupFile(outputPath);
    return;
  }
  await setStage(job, 'Writing file', 99);
  const stat = fs.statSync(outputPath);
  if (!stat.size) throw new Error('FFmpeg produced an empty file');
  const probe = await probeFile(outputPath, settings.motion).catch(() => null);
  const stored = await storeTempAsFile({
    tempPath: outputPath,
    filename: outputName,
    mimeType: mimeFor(params.exportSettings?.container || 'mp4'),
    ownerId: job.ownerId,
    ownerName: params.ownerName || 'Cascade',
    limitBytes: settings.motion?.maxAssetBytes,
  });
  for (const cleanup of cleanups) cleanupFile(cleanup);
  fs.rmSync(dir, { recursive: true, force: true });
  const result = {
    outputFileId: stored.id,
    filename: stored.filename,
    size: stat.size,
    width: probe?.width || command.plan.width,
    height: probe?.height || command.plan.height,
    fps: probe?.frameRate || command.plan.fps,
    duration: probe?.duration || duration,
    videoCodec: probe?.videoCodec || command.exportSettings.videoCodec,
    audioCodec: probe?.audioCodec || command.exportSettings.audioCodec,
    warnings: [...new Set(command.warnings)],
    downloadUrl: `/download/${stored.id}`,
    renderSeconds: Math.max(1, Math.round((Date.now() - new Date(job.startedAt || Date.now()).getTime()) / 1000)),
  };
  await MotionJob.update({
    status: 'done', progress: 100, stage: 'Complete', outputFileId: stored.id,
    result, finishedAt: new Date(),
  }, { where: { id: job.id } });
}

async function runProxyJob(job, settings, params, dir) {
  const asset = await MotionAsset.findByPk(params.assetId);
  if (!asset) throw new Error('asset not found');
  if (asset.proxyFileId) {
    await MotionJob.update({ status: 'done', progress: 100, stage: 'Complete', result: { proxyFileId: asset.proxyFileId }, finishedAt: new Date() }, { where: { id: job.id } });
    return;
  }
  const file = await FileRecord.findByPk(asset.fileId);
  const local = file && filePathFor(file);
  if (!local) throw new Error('the source is not on this server');
  const out = path.join(dir, 'proxy.mp4');
  await setStage(job, 'Generating proxy', 10);
  const { makeProxy } = await import('./ffmpeg.js');
  await makeProxy(local, out, settings.motion, (chunk) => {
    const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(chunk);
    if (m) {
      const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      const duration = Number(asset.meta?.duration) || 1;
      setStage(job, 'Generating proxy', Math.min(95, 10 + (seconds / duration) * 80)).catch(() => {});
    }
  });
  const stored = await storeTempAsFile({
    tempPath: out, filename: `${safeStem(asset.name)}.proxy.mp4`, mimeType: 'video/mp4',
    ownerId: job.ownerId, ownerName: params.ownerName || 'Cascade', limitBytes: settings.motion?.maxAssetBytes,
  });
  await MotionAsset.update({ proxyFileId: stored.id }, { where: { id: asset.id } });
  fs.rmSync(dir, { recursive: true, force: true });
  await MotionJob.update({
    status: 'done', progress: 100, stage: 'Complete', result: { proxyFileId: stored.id }, finishedAt: new Date(),
  }, { where: { id: job.id } });
}

async function runTranscribeJob(job, settings, params, dir) {
  const asset = await MotionAsset.findByPk(params.assetId);
  if (!asset) throw new Error('asset not found');
  const file = await FileRecord.findByPk(asset.fileId);
  const local = file && filePathFor(file);
  if (!local) throw new Error('the source audio is not on this server');
  await setStage(job, 'Extracting audio', 10);
  const result = await transcribe({
    inputPath: local,
    settings: settings.motion,
    provider: params.provider,
    language: params.language || 'auto',
    prompt: params.prompt || '',
    model: params.model || '',
    translate: !!params.translate,
    translateTo: params.translateTo || '',
  });
  await setStage(job, 'Saving transcript', 90);
  const { wordsToCues } = await import('../../public/motion/schema.mjs');
  let cues = wordsToCues(result.words, params.cueOptions || {});
  if (params.translateTo && result.language !== params.translateTo && !result.translated) {
    try {
      cues = await translateCues(cues, settings.motion, params.translateTo);
      result.text = cues.map((c) => c.text).join(' ');
    } catch (err) {
      throw new Error(`Transcription succeeded but translation failed: ${err.message}`);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  await MotionJob.update({
    status: 'done', progress: 100, stage: 'Complete',
    result: { words: result.words, language: result.language, text: result.text, provider: result.provider, cues },
    finishedAt: new Date(),
  }, { where: { id: job.id } });
}

export async function cancelJob(jobId, ownerId) {
  const job = await MotionJob.findOne({ where: { id: jobId, ownerId } });
  if (!job) return null;
  if (job.status === 'queued') {
    await job.update({ status: 'cancelled', error: 'Cancelled before rendering', finishedAt: new Date() });
    return job;
  }
  if (job.status === 'running') {
    await job.update({ status: 'cancelled', error: 'Cancelled', finishedAt: new Date() });
    const entry = activeChildren.get(jobId);
    if (entry?.child) {
      try { entry.child.kill('SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => { try { entry.child.kill('SIGKILL'); } catch { /* noop */ } }, 4000);
    }
    return job;
  }
  return job;
}

const activeChildren = new Map();

/* Progress-aware spawn used by exports. We keep a child handle in a map so a
 * job can be cancelled from another request without killing unrelated work. */
function spawnProgress(args, opts) {
  return new Promise((resolve, reject) => {
    const fontConfig = ensureFontConfig();
    const child = spawn(opts.bin || 'ffmpeg', args, {
      cwd: opts.cwd,
      env: { ...process.env, FONTCONFIG_FILE: fontConfig, FONTCONFIG_PATH: path.dirname(fontConfig) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const entry = { child };
    if (opts.signal) opts.signal.child = child;
    // The caller's job id is not available here; activeChildren is keyed by the
    // caller after this function is created, so expose the handle through the
    // signal object as well.
    if (opts.jobId) activeChildren.set(opts.jobId, entry);
    let stderr = '';
    let buf = '';
    let timedOut = false;
    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch { /* noop */ } }, opts.timeoutMs) : null;
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) opts.onLine?.(line);
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-64 * 1024); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (opts.jobId) activeChildren.delete(opts.jobId);
      if (timedOut) return reject(new Error('The render exceeded the configured time limit'));
      if (code === 0) return resolve();
      reject(new Error(stderr.trim().split('\n').slice(-4).join(' ') || `FFmpeg exited with ${code}`));
    });
  });
}

export async function retryJob(jobId, ownerId) {
  const original = await MotionJob.findOne({ where: { id: jobId, ownerId } });
  if (!original) return null;
  return enqueueJob({ type: original.type, projectId: original.projectId, ownerId, params: original.params });
}

export async function jobsForProject(projectId, ownerId, limit = 25) {
  return MotionJob.findAll({ where: { projectId, ownerId }, order: [['createdAt', 'DESC']], limit });
}

export async function cleanupOldJobs() {
  const cutoff = Date.now() - 14 * 86400_000;
  const rows = await MotionJob.findAll({ where: { createdAt: { [Op.lt]: new Date(cutoff) } }, limit: 100 });
  for (const job of rows) {
    cleanupFile(path.join(motionJobDir(), job.id));
    if (['done', 'failed', 'cancelled'].includes(job.status)) await job.destroy();
  }
}

function safeStem(name) {
  return String(name || 'export').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\w\-. ]+/g, '_').slice(0, 120) || 'export';
}

export function extensionFor(container) {
  return ({ mp4: 'mp4', mov: 'mov', webm: 'webm', mkv: 'mkv', mp3: 'mp3', flac: 'flac', wav: 'wav' })[container] || 'mp4';
}

export function mimeFor(container) {
  return ({
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav',
  })[container] || 'application/octet-stream';
}

/* Render one still frame through the exact export graph. Used by MCP and by the
 * editor's "compare with export" action. */
export async function renderStill({ project, projectId, time = 0, width = 0 }) {
  const settings = await getSettings();
  const caps = await capabilities(settings.motion);
  if (!caps.available) throw new Error('FFmpeg is not installed on this server');
  const dir = jobDir(`still-${nanoid(10)}`);
  const { assets, paths } = await loadMedia(project, projectId);
  const output = path.join(dir, 'frame.png');
  const outWidth = width || project.width;
  const outHeight = Math.max(16, Math.round(outWidth / (project.width / project.height)));
  const exportSettings = { container: 'mov', videoCodec: 'png', audioCodec: null, width: outWidth, height: outHeight, fps: project.fps };
  const command = buildCommand(project, assets, paths, { ...settings.motion, capabilities: caps }, {
    exportSettings, outputPath: output, jobDir: dir, warnings: [], videoOnly: true,
  });
  const args = [];
  for (let i = 0; i < command.args.length; i += 1) {
    if (command.args[i] === '-map' && command.args[i + 1] === '[aout]') { i += 1; continue; }
    args.push(command.args[i]);
  }
  const outIndex = args.lastIndexOf(output);
  const mapIndex = args.lastIndexOf('-map');
  args.splice(mapIndex, 0, '-ss', String(toSeconds(time)), '-frames:v', '1');
  const cIndex = args.lastIndexOf('-c:v');
  if (cIndex > 0) args.splice(cIndex, 2, '-c:v', 'png', '-update', '1');
  const aCodec = args.lastIndexOf('-c:a');
  if (aCodec > 0) args.splice(aCodec, 2);
  try {
    await spawnProgress(args, { cwd: dir, bin: binary(settings.motion), timeoutMs: 120_000, onLine() {} });
    if (!fs.existsSync(output)) throw new Error('FFmpeg did not produce a preview frame');
    return fs.readFileSync(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
