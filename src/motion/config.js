import path from 'node:path';
import { config } from '../config.js';

/* Motion settings live in the settings row and are editable by an
 * administrator. Environment variables provide deployment defaults; a stored
 * value always wins so an operator can change a running instance without a
 * restart. */
export const MOTION_DEFAULTS = {
  enabled: true,
  maxResolution: 3840,
  maxProjectBytes: 12 * 1024 * 1024,
  maxAssetBytes: 2 * 1024 * 1024 * 1024,
  maxAssetsPerProject: 250,
  renderConcurrency: 1,
  renderTimeoutSeconds: 60 * 60,
  ffmpegPath: process.env.FFMPEG_PATH || '',
  ffprobePath: process.env.FFPROBE_PATH || '',
  proxyThreshold: 1920,
  proxyEnabled: true,
  hardwareAcceleration: 'auto',
  allowRemoteMedia: true,
  remoteHostAllowlist: (process.env.MOTION_REMOTE_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean),
  audioCatalogUrl: process.env.MOTION_AUDIO_CATALOG_URL || '',
  fonts: [],
  whisper: {
    provider: process.env.WHISPER_PROVIDER || 'disabled', // disabled | openai | compatible | local
    endpoint: process.env.WHISPER_ENDPOINT || '',
    model: process.env.WHISPER_MODEL || 'whisper-1',
    language: process.env.WHISPER_LANGUAGE || 'auto',
    compute: process.env.WHISPER_COMPUTE || 'auto', // auto | cpu | gpu
    binary: process.env.WHISPER_BINARY || 'whisper-cli',
    modelPath: process.env.WHISPER_MODEL_PATH || '',
    threads: 4,
    maxMinutes: 90,
    translateProvider: process.env.TRANSLATE_PROVIDER || '',
  },
};

export function normalizeMotionSettings(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const whisper = { ...MOTION_DEFAULTS.whisper, ...(raw.whisper || {}) };
  return {
    ...MOTION_DEFAULTS,
    ...raw,
    whisper,
    remoteHostAllowlist: Array.isArray(raw.remoteHostAllowlist)
      ? raw.remoteHostAllowlist.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      : MOTION_DEFAULTS.remoteHostAllowlist,
    audioCatalogUrl: String(raw.audioCatalogUrl ?? MOTION_DEFAULTS.audioCatalogUrl),
    maxResolution: Math.max(480, Math.min(7680, Number(raw.maxResolution) || MOTION_DEFAULTS.maxResolution)),
    renderConcurrency: Math.max(1, Math.min(8, Number(raw.renderConcurrency) || MOTION_DEFAULTS.renderConcurrency)),
    maxAssetBytes: Math.max(64 * 1024 * 1024, Math.min(8 * 1024 ** 3, Number(raw.maxAssetBytes) || MOTION_DEFAULTS.maxAssetBytes)),
  };
}

export function motionTmpDir() {
  return path.resolve(path.dirname(config.dbPath), 'motion-tmp');
}

export function motionJobDir() {
  return path.resolve(path.dirname(config.dbPath), 'motion-jobs');
}

export const MEDIA_EXTENSIONS = new Set([
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'ts', 'mts', '3gp', 'ogv',
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'm4a', 'opus', 'aiff', 'aif', 'wma',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif',
]);

const VIDEO_CODEC_HINTS = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'theora', 'mpeg4', 'prores', 'dnxhd', 'h263', 'mjpeg']);
const AUDIO_CODEC_HINTS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'ac3', 'eac3', 'alac']);

export function isBrowserDecodableVideo(codec = '') {
  return ['h264', 'vp8', 'vp9', 'av1', 'theora'].includes(String(codec).toLowerCase());
}

export function isBrowserDecodableAudio(codec = '') {
  return ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le'].includes(String(codec).toLowerCase());
}

export { VIDEO_CODEC_HINTS, AUDIO_CODEC_HINTS };
