import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { motionTmpDir } from './config.js';
import { fileURLToPath } from 'node:url';

let capabilityCache = null;
const CAPABILITY_TTL = 60_000;

export function binary(settings, which = 'ffmpeg') {
  const configured = which === 'ffprobe' ? settings?.ffprobePath : settings?.ffmpegPath;
  if (configured) {
    try {
      if (fs.statSync(configured).isDirectory()) return path.join(configured, which);
    } catch {
      /* fall through to the literal path */
    }
    return configured;
  }
  return which;
}

export function ensureTmp() {
  const dir = motionTmpDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* Libass uses fontconfig. Minimal container images (including the Alpine
 * Docker image) may have no /etc/fonts, which makes subtitles silently
 * disappear. Generate a small config that includes the bundled fonts and any
 * system font directories that exist. */
let fontConfigPath = null;
export function ensureFontConfig() {
  if (fontConfigPath && fs.existsSync(fontConfigPath)) return fontConfigPath;
  const dir = ensureTmp();
  const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');
  const dirs = [bundled, '/usr/share/fonts', '/usr/local/share/fonts'].filter((p) => fs.existsSync(p));
  const cache = path.join(dir, 'fontcache');
  fs.mkdirSync(cache, { recursive: true });
  fontConfigPath = path.join(dir, 'fonts.conf');
  fs.writeFileSync(fontConfigPath, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
${dirs.map((d) => `  <dir>${d}</dir>`).join('\n')}
  <cachedir>${cache}</cachedir>
</fontconfig>
`, 'utf8');
  return fontConfigPath;
}

export function tmpFile(ext = '') {
  ensureTmp();
  return path.join(motionTmpDir(), `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext.replace(/^\./, '')}` : ''}`);
}

/* Spawn FFmpeg without a shell. Arguments are never concatenated, so a
 * filename containing quotes or shell metacharacters stays a single argv. */
export function spawnFfmpeg(args, options = {}) {
  const bin = options.binary || 'ffmpeg';
  return new Promise((resolve, reject) => {
    const config = ensureFontConfig();
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: { ...process.env, FONTCONFIG_FILE: config, FONTCONFIG_PATH: path.dirname(config), ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const maxErr = 64 * 1024;
    const maxOut = options.maxStdout || 1024 * 1024;
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch { /* already exited */ }
      }, options.timeoutMs)
      : null;
    child.stdout?.on('data', (chunk) => {
      if (options.onStdout) options.onStdout(chunk);
      if (options.captureStdout !== false && stdout.length < maxOut) stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      if (options.onStderr) options.onStderr(chunk.toString());
      stderr = (stderr + chunk.toString()).slice(-maxErr);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(Object.assign(err, { stderr }));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (options.signal) options.signal.child = null;
      if (timedOut) {
        const err = new Error(`FFmpeg timed out after ${Math.round(options.timeoutMs / 1000)}s`);
        err.stderr = stderr;
        return reject(err);
      }
      if (code === 0) return resolve({ code, stdout, stderr, signal });
      const err = new Error(stderr.trim().split('\n').slice(-3).join(' ') || `FFmpeg exited with ${code}`);
      err.code = code;
      err.stderr = stderr;
      return reject(err);
    });
    if (options.signal) options.signal.child = child;
  });
}

export async function ffmpegVersion(settings) {
  try {
    const { stdout } = await spawnFfmpeg(['-hide_banner', '-version'], { binary: binary(settings) });
    return stdout.split('\n')[0]?.replace(/^ffmpeg version\s*/i, '').trim() || '';
  } catch {
    return null;
  }
}

export async function capabilities(settings) {
  const key = `${binary(settings)}|${binary(settings, 'ffprobe')}`;
  const now = Date.now();
  if (capabilityCache && capabilityCache.key === key && now - capabilityCache.at < CAPABILITY_TTL) return capabilityCache.value;
  const value = {
    available: false,
    version: null,
    encoders: [],
    filters: [],
    hwaccels: [],
    hardwareDevices: fs.existsSync('/dev/dri'),
    subtitles: false,
    drawtext: false,
    ffmpeg: binary(settings),
    ffprobe: binary(settings, 'ffprobe'),
  };
  try {
    const version = await spawnFfmpeg(['-hide_banner', '-version'], { binary: binary(settings) });
    value.available = true;
    value.version = version.stdout.split('\n')[0]?.replace(/^ffmpeg version\s*/i, '').trim() || '';
    const enc = await spawnFfmpeg(['-hide_banner', '-encoders'], { binary: binary(settings), maxStdout: 2 * 1024 * 1024 });
    value.encoders = enc.stdout.split('\n').map((line) => /^\s*[VAS][A-Z.]{5}\s+([A-Za-z0-9_.-]+)/.exec(line)?.[1]).filter((name) => name && name !== '=');
    const filters = await spawnFfmpeg(['-hide_banner', '-filters'], { binary: binary(settings), maxStdout: 2 * 1024 * 1024 });
    value.filters = filters.stdout.split('\n').map((line) => /^\s*[TSC.]{3}\s+([A-Za-z0-9_.-]+)/.exec(line)?.[1]).filter((name) => name && name !== '=');
    value.subtitles = value.filters.includes('subtitles') || value.filters.includes('ass');
    value.drawtext = value.filters.includes('drawtext');
    try {
      const hw = await spawnFfmpeg(['-hide_banner', '-hwaccels'], { binary: binary(settings) });
      value.hwaccels = hw.stdout.replace(/Hardware acceleration methods:/i, '').split(/\s+/).filter(Boolean);
    } catch { /* optional */ }
  } catch {
    value.available = false;
  }
  capabilityCache = { key, at: now, value };
  return value;
}

export async function probeFile(filePath, settings) {
  const { stdout } = await spawnFfmpeg([
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ], { binary: binary(settings, 'ffprobe'), timeoutMs: 60_000, maxStdout: 4 * 1024 * 1024 });
  return normalizeProbe(JSON.parse(stdout || '{}'));
}

function rate(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const [a, b] = String(value).split('/').map(Number);
  if (b) return Math.round((a / b) * 1000) / 1000;
  return Number(value) || 0;
}

export function normalizeProbe(raw) {
  const format = raw.format || {};
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const video = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const audio = streams.find((s) => s.codec_type === 'audio');
  const rotation = (() => {
    const side = (video?.side_data_list || []).find((s) => s.rotation !== undefined);
    const value = Number(side?.rotation ?? video?.tags?.rotate ?? 0);
    return ((value % 360) + 360) % 360;
  })();
  const duration = Number(format.duration || video?.duration || audio?.duration || 0);
  const type = video ? 'video' : audio ? 'audio' : 'image';
  return {
    type,
    duration: Number.isFinite(duration) ? duration : 0,
    size: Number(format.size) || 0,
    bitrate: Number(format.bit_rate) || 0,
    formatName: format.format_name || '',
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    frameRate: rate(video?.avg_frame_rate || video?.r_frame_rate) || 0,
    videoCodec: video?.codec_name || null,
    pixelFormat: video?.pix_fmt || null,
    colorSpace: video?.color_space || video?.color_primaries || null,
    colorTransfer: video?.color_transfer || null,
    colorPrimaries: video?.color_primaries || null,
    hdr: /smpte2084|arib-std-b67|bt2020/i.test(`${video?.color_transfer || ''} ${video?.color_primaries || ''} ${video?.color_space || ''}`),
    rotation,
    hasAudio: !!audio,
    audioCodec: audio?.codec_name || null,
    audioChannels: Number(audio?.channels) || 0,
    audioSampleRate: Number(audio?.sample_rate) || 0,
    audioBitrate: Number(audio?.bit_rate) || 0,
    audioChannelLayout: audio?.channel_layout || null,
    streams: streams.map((s) => ({ type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height, channels: s.channels, sampleRate: Number(s.sample_rate) || 0 })),
    raw: undefined,
  };
}

export async function makeThumbnail(input, output, settings, time = 0) {
  const args = ['-y', '-v', 'error'];
  if (time > 0) args.push('-ss', String(Math.max(0, time)));
  args.push('-i', input, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '3', output);
  await spawnFfmpeg(args, { binary: binary(settings), timeoutMs: 120_000 });
  return fs.existsSync(output) && fs.statSync(output).size > 0;
}

export async function makeProxy(input, output, settings, onProgress) {
  await spawnFfmpeg([
    '-y', '-v', 'error', '-i', input,
    '-vf', "scale='min(1280,iw)':-2:flags=lanczos",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
  ], {
    binary: binary(settings),
    timeoutMs: 30 * 60_000,
    onStderr: (chunk) => onProgress?.(chunk),
  });
  return fs.statSync(output).size;
}

/* Decode mono PCM once and fold it into an amplitude envelope. 50 buckets per
 * second is enough for waveforms and beat detection without storing audio. */
export async function makeWaveform(input, settings, { bucketsPerSecond = 50, maxSeconds = 1800 } = {}) {
  const rate = 8000;
  const perBucket = Math.max(1, Math.round(rate / bucketsPerSecond));
  const peaks = [];
  let leftover = null;
  let bucketPeak = 0;
  let bucketCount = 0;
  let samples = 0;
  await spawnFfmpeg([
    '-v', 'error', '-i', input, '-t', String(maxSeconds), '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1',
  ], {
    binary: binary(settings),
    timeoutMs: 5 * 60_000,
    captureStdout: false,
    onStdout(chunk) {
      const buf = leftover ? Buffer.concat([leftover, chunk]) : chunk;
      const even = buf.length - (buf.length % 2);
      for (let i = 0; i < even; i += 2) {
        const value = Math.abs(buf.readInt16LE(i));
        if (value > bucketPeak) bucketPeak = value;
        bucketCount += 1;
        samples += 1;
        if (bucketCount >= perBucket) {
          peaks.push(Math.min(1, bucketPeak / 32768));
          bucketPeak = 0;
          bucketCount = 0;
        }
      }
      leftover = even < buf.length ? buf.subarray(even) : null;
    },
  });
  if (bucketCount) peaks.push(Math.min(1, bucketPeak / 32768));
  return { sampleRate: bucketsPerSecond, duration: samples / rate, peaks };
}

export function parseProgress(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(\w+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  if (out.out_time_us) out.seconds = Number(out.out_time_us) / 1e6;
  else if (out.out_time) out.seconds = parseTime(out.out_time);
  return out;
}

function parseTime(value) {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(value));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

export function cleanupFile(file) {
  try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch { /* best effort */ }
}
