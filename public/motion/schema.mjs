/* Cascade Motion — canonical project model.
 *
 * This module is imported by the browser editor (`/public/motion/*`) and by the
 * server renderer (`src/motion/*`), so timeline maths, keyframes, presets and
 * edit operations are identical in preview and export. It must stay
 * environment-free: no DOM, no Node APIs.
 *
 * Time is integer microseconds (TICKS). Floating-point seconds are only used at
 * the UI edge. 1_000_000 ticks per second gives frame accuracy at 120 fps and
 * avoids drift in long projects.
 */

export const TICKS = 1_000_000;
export const PROJECT_VERSION = 1;
export const seconds = (value) => Math.round(Number(value || 0) * TICKS);
export const toSeconds = (ticks) => Number(ticks || 0) / TICKS;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
export const uid = (prefix = 'id') => `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

export const RESOLUTIONS = [
  { id: '480p', label: '480p', w: 854, h: 480 },
  { id: '720p', label: '720p', w: 1280, h: 720 },
  { id: '1080p', label: '1080p', w: 1920, h: 1080 },
  { id: '1440p', label: '1440p', w: 2560, h: 1440 },
  { id: '4k', label: '4K', w: 3840, h: 2160 },
  { id: 'vertical', label: 'Vertical 1080×1920', w: 1080, h: 1920 },
  { id: 'square', label: 'Square 1080×1080', w: 1080, h: 1080 },
];

export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120];

export const TRACK_TYPES = ['video', 'audio', 'subtitle', 'text', 'effect', 'overlay'];

/* ------------------------------------------------------------------------- */
/* Easing                                                                    */
/* ------------------------------------------------------------------------- */

export function easeValue(name, t) {
  t = clamp(t, 0, 1);
  switch (name) {
    case 'linear': return t;
    case 'ease-in': return t * t;
    case 'ease-out': return 1 - (1 - t) ** 2;
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2;
    case 'ease-in-cubic': return t ** 3;
    case 'ease-out-cubic': return 1 - (1 - t) ** 3;
    case 'ease-in-out-cubic': return t < 0.5 ? 4 * t ** 3 : 1 - 4 * (1 - t) ** 3;
    case 'ease-in-expo': return t === 0 ? 0 : 2 ** (10 * t - 10);
    case 'ease-out-expo': return t === 1 ? 1 : 1 - 2 ** (-10 * t);
    case 'ease-out-back': { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; }
    case 'ease-out-elastic': return t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    case 'ease-out-bounce': {
      const n = 7.5625; const d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    }
    case 'hold': return 0;
    default: return t;
  }
}

/* ------------------------------------------------------------------------- */
/* Keyframes                                                                 */
/* ------------------------------------------------------------------------- */

/* A track is [{ t: µs relative to clip start, value, easing, inHandle,
 * outHandle }]. Values may be numbers, colours or arrays. The evaluator is
 * deliberately linear between keyframes; Bezier handles modify the eased
 * parameter, not the value curve, which is enough for UI graph editing and is
 * reproduced identically by export. */
export function evaluateKeyframes(track, time, fallback) {
  if (!Array.isArray(track) || !track.length) return fallback;
  const sorted = track;
  if (time <= sorted[0].t) return sorted[0].value;
  if (time >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].value;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].t <= time) lo = mid; else hi = mid;
  }
  const a = sorted[lo];
  const b = sorted[hi];
  const span = Math.max(1, b.t - a.t);
  const raw = clamp((time - a.t) / span, 0, 1);
  const eased = easeValue(b.easing || 'linear', raw);
  if (typeof a.value === 'number' && typeof b.value === 'number') return a.value + (b.value - a.value) * eased;
  if (Array.isArray(a.value) && Array.isArray(b.value)) {
    return a.value.map((v, i) => Number(v) + (Number(b.value[i] ?? v) - Number(v)) * eased);
  }
  if (typeof a.value === 'string' && a.value.startsWith('#')) return raw < 0.5 ? a.value : b.value;
  return raw < 0.5 ? a.value : b.value;
}

/* Resolve an animatable property: keyframes win over the static value. */
export function animated(target, key, relativeTime) {
  const frames = target?.keyframes?.[key];
  const fallback = target?.[key];
  return evaluateKeyframes(frames, relativeTime, fallback);
}

export function animatedTransform(clip, localTime) {
  const tr = clip.transform || {};
  const read = (key, fallback) => evaluateKeyframes(clip.keyframes?.[key], localTime,
    evaluateKeyframes(clip.keyframes?.transform?.[key], localTime, tr[key] ?? fallback));
  return {
    x: read('x', 0),
    y: read('y', 0),
    scale: read('scale', 1),
    scaleX: read('scaleX', 1),
    scaleY: read('scaleY', 1),
    rotation: read('rotation', 0),
    opacity: read('opacity', 1),
    anchorX: tr.anchorX ?? 0.5,
    anchorY: tr.anchorY ?? 0.5,
  };
}

/* ------------------------------------------------------------------------- */
/* Project                                                                   */
/* ------------------------------------------------------------------------- */

export function defaultTransform(overrides = {}) {
  return {
    x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
    anchorX: 0.5, anchorY: 0.5, ...overrides,
  };
}

export function defaultColor() {
  return {
    exposure: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0,
    temperature: 0, tint: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    gamma: 1, hue: 0,
    lift: [0, 0, 0], gammaRGB: [1, 1, 1], gain: [1, 1, 1],
    curves: { master: [], red: [], green: [], blue: [] },
    lut: null, lutIntensity: 1,
    selective: [],
    preset: null,
  };
}

export function defaultAudio() {
  return {
    gain: 1, pan: 0, fadeIn: 0, fadeOut: 0,
    eqLow: 0, eqMid: 0, eqHigh: 0,
    compressor: 0, limiter: false, denoise: 0, enhance: 0,
    normalize: false, ducking: 0, pitch: 0, reverb: 0, echo: 0,
    muted: false,
  };
}

export function defaultText(content = 'Your text') {
  return {
    content,
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: 0.07, // fraction of project height
    fontWeight: 700,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.15,
    letterSpacing: 0,
    uppercase: false,
    italic: false,
    underline: false,
    shadow: { color: '#000000', blur: 0.015, x: 0, y: 0.006, opacity: 0.65 },
    outline: { color: '#000000', width: 0, opacity: 1 },
    background: { color: '#000000', opacity: 0, radius: 0.008, padding: 0.012 },
    x: 0.5, y: 0.84, width: 0.86, rotation: 0, opacity: 1,
    animation: 'fade-in', animationDuration: 0.5, template: null,
    perCharacter: false, perWord: false,
  };
}

export function defaultTrack(type = 'video', overrides = {}) {
  return {
    id: uid('trk'), type, name: type[0].toUpperCase() + type.slice(1),
    height: type === 'audio' ? 64 : type === 'subtitle' || type === 'text' ? 46 : 74,
    locked: false, hidden: false, muted: false, solo: false,
    volume: 1, pan: 0, opacity: 1, blend: 'normal', effects: [],
    ...overrides,
  };
}

export function newProject(overrides = {}) {
  const tracks = [
    defaultTrack('video', { name: 'Video 1' }),
    defaultTrack('overlay', { name: 'Overlay' }),
    defaultTrack('text', { name: 'Titles' }),
    defaultTrack('subtitle', { name: 'Subtitles' }),
    defaultTrack('audio', { name: 'Audio 1', height: 72 }),
    defaultTrack('audio', { name: 'Music', height: 64 }),
  ];
  return normalizeProject({
    version: PROJECT_VERSION,
    width: 1920, height: 1080, fps: 30,
    duration: seconds(30),
    background: '#000000',
    sampleRate: 48000, channels: 2,
    tracks, clips: [], markers: [], compositions: [], assets: [],
    master: { volume: 1, pan: 0, limiter: true, limiterCeiling: -1, fadeIn: 0, fadeOut: 0 },
    transcript: null,
    ...overrides,
  });
}

export function normalizeProject(input) {
  const project = input && typeof input === 'object' ? input : {};
  project.version = PROJECT_VERSION;
  project.width = Math.round(clamp(project.width || 1920, 16, 7680));
  project.height = Math.round(clamp(project.height || 1080, 16, 4320));
  project.fps = clamp(project.fps || 30, 1, 240);
  project.background = project.background || '#000000';
  project.sampleRate = [44100, 48000, 96000].includes(Number(project.sampleRate)) ? Number(project.sampleRate) : 48000;
  project.channels = [1, 2, 6].includes(Number(project.channels)) ? Number(project.channels) : 2;
  project.master = { volume: 1, pan: 0, limiter: true, limiterCeiling: -1, fadeIn: 0, fadeOut: 0, ...(project.master || {}) };
  project.assets = Array.isArray(project.assets) ? project.assets : [];
  project.markers = Array.isArray(project.markers) ? project.markers.map((m) => ({
    id: m.id || uid('mk'), t: Math.max(0, Math.round(m.t || 0)), label: String(m.label || 'Marker'), color: m.color || '#f59e0b',
  })) : [];
  project.compositions = Array.isArray(project.compositions) ? project.compositions.map((comp) => ({
    id: comp.id || uid('comp'), name: String(comp.name || 'Composition'),
    width: Math.round(comp.width || project.width), height: Math.round(comp.height || project.height),
    fps: Number(comp.fps) || project.fps, duration: Math.max(0, Math.round(comp.duration || seconds(5))),
    tracks: Array.isArray(comp.tracks) ? comp.tracks : [], clips: Array.isArray(comp.clips) ? comp.clips : [],
  })) : [];
  project.tracks = Array.isArray(project.tracks) && project.tracks.length ? project.tracks.map((track) => ({
    ...defaultTrack(track.type || 'video'),
    ...track,
    id: track.id || uid('trk'),
    type: TRACK_TYPES.includes(track.type) ? track.type : 'video',
    volume: clamp(track.volume ?? 1, 0, 2),
    pan: clamp(track.pan ?? 0, -1, 1),
    opacity: clamp(track.opacity ?? 1, 0, 1),
    height: clamp(track.height || 70, 30, 240),
  })) : newProject({ duration: project.duration }).tracks;
  const trackIds = new Set(project.tracks.map((t) => t.id));
  const compIds = new Set(project.compositions.map((c) => c.id));
  project.clips = (Array.isArray(project.clips) ? project.clips : []).map((clip) => normalizeClip(clip, trackIds, compIds)).filter(Boolean);
  project.duration = Math.max(seconds(1), Math.round(project.duration || timelineDuration(project)));
  return project;
}

export function normalizeClip(input, trackIds, compIds) {
  if (!input || typeof input !== 'object' || !input.trackId) return null;
  if (trackIds && !trackIds.has(input.trackId)) return null;
  const type = ['video', 'image', 'audio', 'text', 'subtitle', 'shape', 'adjustment', 'composition'].includes(input.type) ? input.type : 'video';
  const clip = {
    id: input.id || uid('clip'),
    trackId: input.trackId,
    type,
    name: String(input.name || (type === 'text' ? 'Text' : type === 'subtitle' ? 'Subtitles' : 'Clip')),
    assetId: input.assetId || null,
    compositionId: input.compositionId && (!compIds || compIds.has(input.compositionId)) ? input.compositionId : null,
    start: Math.max(0, Math.round(input.start || 0)),
    duration: Math.max(1000, Math.round(input.duration || seconds(5))),
    inPoint: Math.max(0, Math.round(input.inPoint || 0)),
    speed: clamp(input.speed ?? 1, 0.05, 16),
    reverse: !!input.reverse,
    freeze: !!input.freeze,
    enabled: input.enabled !== false,
    locked: !!input.locked,
    groupId: input.groupId || null,
    linkedId: input.linkedId || null,
    transform: { ...defaultTransform(), ...(input.transform || {}) },
    crop: { left: 0, right: 0, top: 0, bottom: 0, ...(input.crop || {}) },
    mask: { shape: 'none', feather: 0, expansion: 0, invert: false, opacity: 1, points: [], ...(input.mask || {}) },
    color: { ...defaultColor(), ...(input.color || {}) },
    audio: { ...defaultAudio(), ...(input.audio || {}) },
    text: { ...defaultText(), ...(input.text || {}) },
    subtitle: {
      text: '', words: [], styleId: 'classic-white', highlight: null, speaker: null,
      position: null, maxLines: 2, ...(input.subtitle || {}),
    },
    effects: Array.isArray(input.effects) ? input.effects.map((fx) => ({
      id: fx.id || uid('fx'),
      type: fx.type,
      enabled: fx.enabled !== false,
      params: fx.params || {},
      keyframes: fx.keyframes || {},
    })).filter((fx) => fx.type) : [],
    transitionIn: input.transitionIn ? normalizeTransition(input.transitionIn) : null,
    transitionOut: input.transitionOut ? normalizeTransition(input.transitionOut) : null,
    keyframes: input.keyframes && typeof input.keyframes === 'object' ? input.keyframes : {},
    blend: input.blend || 'normal',
    opacity: clamp(input.opacity ?? 1, 0, 1),
    volume: clamp(input.volume ?? 1, 0, 2),
  };
  clip.transform.opacity = clamp(clip.transform.opacity ?? 1, 0, 1);
  clip.duration = Math.max(1000, clip.duration);
  return clip;
}

function normalizeTransition(t) {
  return {
    type: t.type || 'crossfade',
    duration: Math.max(0, Math.round(t.duration || seconds(0.5))),
    easing: t.easing || 'ease-in-out',
    params: t.params || {},
  };
}

export function timelineDuration(project) {
  let max = 0;
  for (const clip of project.clips || []) max = Math.max(max, clip.start + clip.duration);
  return max;
}

export function clipsOnTrack(project, trackId) {
  return (project.clips || []).filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export function clipsAt(project, time) {
  return (project.clips || []).filter((c) => c.enabled !== false && c.start <= time && c.start + c.duration > time);
}

export function trackById(project, id) {
  return (project.tracks || []).find((t) => t.id === id) || null;
}

export function assetById(project, id) {
  return (project.assets || []).find((a) => a.id === id) || null;
}

/* Nested compositions can contain clips that point at other compositions. A
 * depth guard prevents a corrupted project from recursing forever. */
export function resolveComposition(project, clip, depth = 0) {
  if (depth > 6 || !clip?.compositionId) return null;
  return (project.compositions || []).find((c) => c.id === clip.compositionId) || null;
}

export function frameOf(project, time) {
  return Math.round((Number(time) / TICKS) * (Number(project.fps) || 30));
}

export function snapToFrame(project, time) {
  const fps = Number(project.fps) || 30;
  return Math.round((Number(time) / TICKS) * fps) * (TICKS / fps);
}

export function formatTimecode(project, time, frames = true) {
  const fps = Number(project.fps) || 30;
  const total = Math.max(0, Number(time) || 0);
  const totalSeconds = Math.floor(total / TICKS);
  const ff = Math.floor(((total % TICKS) / TICKS) * fps);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const base = `${hh ? `${pad(hh)}:` : ''}${pad(mm)}:${pad(ss)}`;
  return frames ? `${base}:${pad(ff)}` : base;
}

export function formatDuration(time) {
  const total = Math.max(0, Number(time) || 0) / TICKS;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}s`;
}

/* ------------------------------------------------------------------------- */
/* Timeline edit operations                                                  */
/* ------------------------------------------------------------------------- */

export const EDIT_OPS = [
  'add_track', 'update_track', 'remove_track',
  'add_clip', 'move_clip', 'trim_clip', 'split_clip', 'remove_clip',
  'duplicate_clip', 'set_clip', 'set_keyframes', 'add_effect', 'remove_effect',
  'set_effect_params', 'add_transition', 'set_audio', 'set_color',
  'add_text', 'add_subtitle', 'add_marker', 'remove_marker', 'set_master',
  'add_composition',
];

function findClip(project, id) {
  return (project.clips || []).find((c) => c.id === id) || null;
}

/* Applies one structured edit. Returns a new project; never mutates the input.
 * The same validation runs for the editor, MCP and imports. */
export function applyEdit(project, op) {
  const next = structuredCloneish(project);
  if (!op || typeof op !== 'object') throw new Error('edit must be an object');
  switch (op.op) {
    case 'add_track': {
      const track = { ...defaultTrack(op.type || 'video'), ...(op.track || {}), id: op.track?.id || uid('trk') };
      next.tracks.push(track);
      break;
    }
    case 'update_track': {
      const track = next.tracks.find((t) => t.id === op.trackId);
      if (!track) throw new Error('track not found');
      Object.assign(track, op.patch || {});
      break;
    }
    case 'remove_track': {
      next.tracks = next.tracks.filter((t) => t.id !== op.trackId);
      next.clips = next.clips.filter((c) => c.trackId !== op.trackId);
      break;
    }
    case 'add_clip': {
      const track = next.tracks.find((t) => t.id === op.clip?.trackId);
      if (!track) throw new Error('track not found');
      if (track.locked) throw new Error('track is locked');
      const clip = normalizeClip(op.clip, new Set(next.tracks.map((t) => t.id)), new Set(next.compositions.map((c) => c.id)));
      if (!clip) throw new Error('invalid clip');
      next.clips.push(clip);
      break;
    }
    case 'move_clip': {
      const clip = findClip(next, op.clipId);
      if (!clip) throw new Error('clip not found');
      const track = next.tracks.find((t) => t.id === op.trackId);
      if (op.trackId && (!track || track.locked)) throw new Error('invalid or locked target track');
      if (track) clip.trackId = track.id;
      if (op.start !== undefined) clip.start = Math.max(0, Math.round(op.start));
      break;
    }
    case 'trim_clip': {
      const clip = findClip(next, op.clipId);
      if (!clip) throw new Error('clip not found');
      const start = op.start !== undefined ? Math.max(0, Math.round(op.start)) : clip.start;
      const end = op.end !== undefined ? Math.round(op.end) : clip.start + clip.duration;
      if (end <= start) throw new Error('clip must keep positive duration');
      if (op.fromEnd) {
        clip.duration = Math.max(1000, end - clip.start);
      } else if (op.fromStart) {
        const delta = start - clip.start;
        clip.start = start;
        clip.inPoint = Math.max(0, clip.inPoint + Math.round(delta * clip.speed));
        clip.duration = Math.max(1000, end - start);
      } else {
        clip.start = start;
        clip.duration = Math.max(1000, end - start);
      }
      break;
    }
    case 'split_clip': {
      const clip = findClip(next, op.clipId);
      if (!clip) throw new Error('clip not found');
      const at = Math.round(op.at);
      if (at <= clip.start || at >= clip.start + clip.duration) throw new Error('split point outside clip');
      const right = structuredCloneish(clip);
      const leftDuration = at - clip.start;
      right.id = op.newId || uid('clip');
      right.start = at;
      right.duration = clip.duration - leftDuration;
      right.inPoint = clip.inPoint + Math.round(leftDuration * clip.speed);
      clip.duration = leftDuration;
      next.clips.push(right);
      break;
    }
    case 'remove_clip': {
      next.clips = next.clips.filter((c) => !(op.clipIds || [op.clipId]).includes(c.id));
      break;
    }
    case 'duplicate_clip': {
      const clip = findClip(next, op.clipId);
      if (!clip) throw new Error('clip not found');
      const copy = structuredCloneish(clip);
      copy.id = uid('clip');
      copy.start = Math.max(0, clip.start + (op.offset ?? clip.duration));
      next.clips.push(copy);
      break;
    }
    case 'set_clip': {
      const clip = findClip(next, op.clipId);
      if (!clip) throw new Error('clip not found');
      deepMerge(clip, op.patch || {});
      break;
    }
    case 'set_keyframes': {
      const target = op.clipId ? findClip(next, op.clipId) : next.master;
      if (!target) throw new Error('target not found');
      target.keyframes = target.keyframes || {};
      if (op.property) target.keyframes[op.property] = (op.keyframes || []).slice().sort((a, b) => a.t - b.t);
      else target.keyframes = op.keyframes || {};
      break;
    }
    case 'add_effect': {
      const target = op.clipId ? findClip(next, op.clipId) : next.tracks.find((t) => t.id === op.trackId);
      if (!target) throw new Error('effect target not found');
      const preset = effectById(op.type);
      if (!preset) throw new Error(`unknown effect ${op.type}`);
      target.effects = target.effects || [];
      target.effects.push({ id: uid('fx'), type: preset.id, enabled: true, params: { ...preset.params, ...(op.params || {}) }, keyframes: {} });
      break;
    }
    case 'remove_effect': {
      const target = op.clipId ? findClip(next, op.clipId) : next.tracks.find((t) => t.id === op.trackId);
      if (!target) throw new Error('effect target not found');
      target.effects = (target.effects || []).filter((fx) => fx.id !== op.effectId);
      break;
    }
    case 'set_effect_params': {
      const target = op.clipId ? findClip(next, op.clipId) : next.tracks.find((t) => t.id === op.trackId);
      const fx = target?.effects?.find((f) => f.id === op.effectId);
      if (!fx) throw new Error('effect not found');
      fx.params = { ...fx.params, ...(op.params || {}) };
      if (op.keyframes) fx.keyframes = { ...fx.keyframes, ...op.keyframes };
      break;
    }
    case 'add_transition': {
      const clip = findClip(next, op.clipId);
      if (!clip) throw new Error('clip not found');
      const preset = transitionById(op.type);
      if (!preset) throw new Error(`unknown transition ${op.type}`);
      const duration = clamp(op.duration || seconds(preset.defaultDuration || 0.6), 0, Math.min(clip.duration, seconds(8)));
      clip[op.side === 'out' ? 'transitionOut' : 'transitionIn'] = { type: preset.id, duration, easing: op.easing || 'ease-in-out', params: op.params || {} };
      break;
    }
    case 'set_audio': {
      const clip = findClip(next, op.clipId);
      if (!clip) throw new Error('clip not found');
      clip.audio = { ...defaultAudio(), ...(clip.audio || {}), ...(op.patch || {}) };
      break;
    }
    case 'set_color': {
      const clip = findClip(next, op.clipId);
      if (!clip) throw new Error('clip not found');
      clip.color = { ...defaultColor(), ...(clip.color || {}), ...(op.patch || {}) };
      break;
    }
    case 'add_text': {
      const track = op.trackId ? next.tracks.find((t) => t.id === op.trackId) : next.tracks.find((t) => t.type === 'text');
      if (!track) throw new Error('text track not found');
      const id = op.id || uid('clip');
      next.clips.push(normalizeClip({
        id, trackId: track.id, type: 'text', name: op.name || 'Text',
        start: Math.max(0, Math.round(op.start || 0)), duration: Math.max(1000, Math.round(op.duration || seconds(5))),
        text: { ...defaultText(op.text || 'Your text'), ...(op.style || {}) },
      }, new Set(next.tracks.map((t) => t.id)), new Set(next.compositions.map((c) => c.id))));
      break;
    }
    case 'add_subtitle': {
      const track = op.trackId ? next.tracks.find((t) => t.id === op.trackId) : next.tracks.find((t) => t.type === 'subtitle');
      if (!track) throw new Error('subtitle track not found');
      next.clips.push(normalizeClip({
        id: op.id || uid('clip'), trackId: track.id, type: 'subtitle', name: 'Subtitle',
        start: Math.max(0, Math.round(op.start || 0)), duration: Math.max(1000, Math.round(op.duration || seconds(2))),
        subtitle: { text: op.text || '', words: op.words || [], styleId: op.styleId || 'classic-white', ...(op.subtitle || {}) },
      }, new Set(next.tracks.map((t) => t.id)), new Set(next.compositions.map((c) => c.id))));
      break;
    }
    case 'add_marker':
      next.markers.push({ id: op.id || uid('mk'), t: Math.max(0, Math.round(op.t || 0)), label: op.label || 'Marker', color: op.color || '#f59e0b' });
      break;
    case 'remove_marker':
      next.markers = next.markers.filter((m) => m.id !== op.markerId);
      break;
    case 'set_master':
      next.master = { ...next.master, ...(op.patch || {}) };
      break;
    case 'add_composition':
      next.compositions.push({
        id: op.id || uid('comp'), name: op.name || 'Composition',
        width: Math.round(op.width || next.width), height: Math.round(op.height || next.height),
        fps: Number(op.fps) || next.fps, duration: Math.max(0, Math.round(op.duration || seconds(5))),
        tracks: op.tracks || [defaultTrack('video', { name: 'Video 1' })], clips: op.clips || [],
      });
      break;
    default:
      throw new Error(`unknown edit operation ${op.op}`);
  }
  next.duration = Math.max(next.duration || 0, timelineDuration(next));
  return next;
}

export function applyEdits(project, ops) {
  return (ops || []).reduce((acc, op) => applyEdit(acc, op), project);
}

export function rippleDelete(project, clipId, { closeGap = true } = {}) {
  const clip = findClip(project, clipId);
  if (!clip) return project;
  const next = structuredCloneish(project);
  next.clips = next.clips.filter((c) => c.id !== clipId);
  if (closeGap) {
    for (const other of next.clips) {
      if (other.trackId === clip.trackId && other.start >= clip.start + clip.duration) other.start = Math.max(0, other.start - clip.duration);
    }
  }
  return next;
}

/* Magnetic snapping: candidate edges are clip edges, the playhead and markers. */
export function snapTime(project, time, options = {}) {
  const threshold = options.threshold ?? seconds(0.08);
  const candidates = [0, options.playhead || 0, ...(project.markers || []).map((m) => m.t)];
  for (const clip of project.clips || []) {
    if (options.exclude?.includes(clip.id)) continue;
    candidates.push(clip.start, clip.start + clip.duration);
  }
  let best = time;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - time);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

export function detectBeats({ peaks, sampleRate = 50 } = {}) {
  if (!Array.isArray(peaks) || peaks.length < 8) return [];
  const values = peaks.map((p) => (Array.isArray(p) ? Math.max(...p) : Number(p) || 0));
  const max = Math.max(...values) || 1;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const beats = [];
  const minGap = sampleRate * 0.22;
  for (let i = 1; i < values.length - 1; i += 1) {
    const v = values[i] / max;
    if (v > avg / max + 0.22 && v >= values[i - 1] / max && v > values[i + 1] / max) {
      if (!beats.length || i - beats[beats.length - 1] > minGap) beats.push(i);
    }
  }
  return beats.map((i) => ({ time: Math.round((i / sampleRate) * TICKS), strength: values[i] / max }));
}

function structuredCloneish(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/* ------------------------------------------------------------------------- */
/* Transition presets (50)                                                   */
/* ------------------------------------------------------------------------- */

const T = (id, name, category, engine, params = {}, defaultDuration = 0.6) => ({ id, name, category, engine, params, defaultDuration });

export const TRANSITIONS = [
  T('crossfade', 'Crossfade', 'Dissolve', 'fade', { mode: 'cross' }),
  T('dissolve', 'Film Dissolve', 'Dissolve', 'fade', { mode: 'cross', grain: 0.08 }),
  T('additive-dissolve', 'Additive Dissolve', 'Dissolve', 'fade', { mode: 'add' }, 0.7),
  T('soft-dissolve', 'Soft Dissolve', 'Dissolve', 'fade', { mode: 'cross', soft: 0.6 }, 0.8),
  T('fade-black', 'Fade Through Black', 'Fade', 'dip', { color: '#000000' }, 0.7),
  T('fade-white', 'Fade Through White', 'Fade', 'dip', { color: '#ffffff' }, 0.7),
  T('dip-red', 'Dip to Red', 'Fade', 'dip', { color: '#7f1d1d' }, 0.6),
  T('dip-blue', 'Dip to Blue', 'Fade', 'dip', { color: '#0c4a6e' }, 0.6),
  T('slide-left', 'Slide Left', 'Slide', 'slide', { dir: 'left', push: false }),
  T('slide-right', 'Slide Right', 'Slide', 'slide', { dir: 'right', push: false }),
  T('slide-up', 'Slide Up', 'Slide', 'slide', { dir: 'up', push: false }),
  T('slide-down', 'Slide Down', 'Slide', 'slide', { dir: 'down', push: false }),
  T('push-left', 'Push Left', 'Slide', 'slide', { dir: 'left', push: true }),
  T('push-right', 'Push Right', 'Slide', 'slide', { dir: 'right', push: true }),
  T('push-up', 'Push Up', 'Slide', 'slide', { dir: 'up', push: true }),
  T('push-down', 'Push Down', 'Slide', 'slide', { dir: 'down', push: true }),
  T('cover-left', 'Cover Left', 'Slide', 'cover', { dir: 'left' }),
  T('cover-right', 'Cover Right', 'Slide', 'cover', { dir: 'right' }),
  T('wipe-left', 'Wipe Left', 'Wipe', 'wipe', { dir: 'left', soft: 0.02 }),
  T('wipe-right', 'Wipe Right', 'Wipe', 'wipe', { dir: 'right', soft: 0.02 }),
  T('wipe-up', 'Wipe Up', 'Wipe', 'wipe', { dir: 'up', soft: 0.02 }),
  T('wipe-down', 'Wipe Down', 'Wipe', 'wipe', { dir: 'down', soft: 0.02 }),
  T('barn-open', 'Barn Doors Open', 'Wipe', 'barn', { mode: 'open' }),
  T('barn-close', 'Barn Doors Close', 'Wipe', 'barn', { mode: 'close' }),
  T('iris', 'Iris Round', 'Wipe', 'iris', { soft: 0.05 }),
  T('clock', 'Clock Wipe', 'Wipe', 'clock', { soft: 0.02 }),
  T('zoom-in', 'Zoom In', 'Zoom', 'zoom', { from: 0.55, blur: 0 }),
  T('zoom-out', 'Zoom Out', 'Zoom', 'zoom', { from: 1.8, blur: 0 }),
  T('cross-zoom', 'Cross Zoom', 'Zoom', 'zoom', { from: 0.4, blur: 0.25 }),
  T('warp-zoom', 'Warp Zoom', 'Zoom', 'zoom', { from: 2.4, blur: 0.5 }),
  T('spin', 'Spin', 'Spin', 'spin', { turns: 1, scale: 0.4 }),
  T('spin-blur', 'Spin Blur', 'Spin', 'spin', { turns: 1.5, scale: 0.2, blur: 0.5 }),
  T('rotate-scale', 'Rotate & Scale', 'Spin', 'spin', { turns: 0.5, scale: 0.7 }),
  T('blur-dissolve', 'Blur Dissolve', 'Blur', 'blur', { amount: 0.25 }),
  T('directional-blur', 'Directional Blur', 'Blur', 'blur', { amount: 0.4, angle: 90 }),
  T('zoom-blur', 'Zoom Blur', 'Blur', 'blur', { amount: 0.5, radial: true }),
  T('flash-white', 'White Flash', 'Flash', 'flash', { color: '#ffffff' }, 0.35),
  T('flash-black', 'Black Flash', 'Flash', 'flash', { color: '#000000' }, 0.35),
  T('light-flash', 'Light Leak Flash', 'Flash', 'flash', { color: '#fbbf24', bloom: true }, 0.45),
  T('glitch', 'Digital Glitch', 'Glitch', 'glitch', { slices: 14, shift: 0.06 }, 0.4),
  T('rgb-split', 'RGB Split', 'Glitch', 'glitch', { slices: 5, shift: 0.1, rgb: true }, 0.5),
  T('datamosh', 'Datamosh', 'Glitch', 'glitch', { slices: 22, shift: 0.2, smear: true }, 0.6),
  T('pixelate', 'Pixelate', 'Stylized', 'pixelate', { size: 32 }),
  T('mosaic-dissolve', 'Mosaic Dissolve', 'Stylized', 'pixelate', { size: 64, dissolve: true }, 0.8),
  T('film-burn', 'Film Burn', 'Film', 'burn', { intensity: 1 }, 0.8),
  T('light-leak', 'Light Leak', 'Film', 'leak', { hue: 24, intensity: 0.9 }, 0.9),
  T('lens-warp', 'Lens Warp', 'Distort', 'warp', { amount: 0.35 }),
  T('ripple', 'Ripple', 'Distort', 'warp', { amount: 0.2, ripple: true }),
  T('channel-shift', 'Channel Shift', 'RGB', 'rgb', { amount: 0.04 }),
  T('chromatic', 'Chromatic Aberration', 'RGB', 'rgb', { amount: 0.08, radial: true }),
  T('circle-reveal', 'Circle Reveal', 'Shape', 'shape', { shape: 'circle' }),
  T('diamond-reveal', 'Diamond Reveal', 'Shape', 'shape', { shape: 'diamond' }),
  T('star-reveal', 'Star Reveal', 'Shape', 'shape', { shape: 'star' }),
  T('flip-h', 'Flip Horizontal', 'Perspective', 'flip', { axis: 'x' }),
  T('flip-v', 'Flip Vertical', 'Perspective', 'flip', { axis: 'y' }),
  T('cube', 'Cube Turn', 'Perspective', 'flip', { axis: 'x', perspective: true }),
  T('page-turn', 'Page Turn', 'Perspective', 'flip', { axis: 'x', perspective: true, curl: true }),
  T('motion-push', 'Motion Push', 'Motion', 'slide', { dir: 'left', push: true, blur: 0.3 }, 0.45),
  T('linear-mask', 'Linear Mask', 'Mask', 'wipe', { dir: 'left', soft: 0.18 }),
  T('radial-mask', 'Radial Mask', 'Mask', 'iris', { soft: 0.22, invert: false }),
  T('luma-dissolve', 'Luma Dissolve', 'Luma', 'luma', { pattern: 'noise' }, 0.8),
  T('luminance-wipe', 'Luminance Wipe', 'Luma', 'luma', { pattern: 'linear' }, 0.7),
];

export function transitionById(id) {
  return TRANSITIONS.find((t) => t.id === id) || null;
}

/* ------------------------------------------------------------------------- */
/* Subtitle presets (50)                                                     */
/* ------------------------------------------------------------------------- */

const S = (id, name, category, style = {}, animation = 'fade') => ({
  id, name, category,
  style: {
    fontFamily: 'Inter, Arial, sans-serif', weight: 700, size: 0.052,
    color: '#ffffff', bg: null, bgOpacity: 0, outline: 0, outlineColor: '#000000',
    shadow: 0.12, shadowColor: '#000000', shadowY: 0.004,
    x: 0.5, y: 0.86, maxWidth: 0.86, align: 'center', uppercase: false,
    letterSpacing: 0, lineHeight: 1.16, radius: 0.006, paddingX: 0.012, paddingY: 0.006,
    gradient: null, glow: null, skew: 0, ...style,
  },
  animation,
});

export const SUBTITLE_STYLES = [
  S('classic-white', 'Classic White', 'Clean', {}, 'fade'),
  S('white-outline', 'White with Black Outline', 'Clean', { outline: 0.0032 }, 'fade'),
  S('black-background', 'Black Background', 'Clean', { bg: '#000000', bgOpacity: 0.92, paddingX: 0.018, paddingY: 0.009 }, 'fade'),
  S('transparent-dark', 'Transparent Dark Background', 'Clean', { bg: '#000000', bgOpacity: 0.55, paddingX: 0.014 }, 'fade'),
  S('minimal-lower', 'Minimal Lower Third', 'Clean', { size: 0.04, weight: 500, y: 0.9, align: 'left', x: 0.09, maxWidth: 0.7 }, 'slide-up'),
  S('documentary', 'Documentary', 'Clean', { fontFamily: 'Georgia, serif', size: 0.04, weight: 400, y: 0.9, shadow: 0.2 }, 'fade'),
  S('news-broadcast', 'News Broadcast', 'Clean', { bg: '#0b3d91', bgOpacity: 0.95, size: 0.043, weight: 600, radius: 0.002, paddingX: 0.014 }, 'slide-up'),
  S('cinematic-serif', 'Cinematic Serif', 'Cinematic', { fontFamily: 'Georgia, "Times New Roman", serif', size: 0.045, weight: 400, color: '#f5f0e6', shadow: 0.3 }, 'fade'),
  S('corporate', 'Corporate', 'Clean', { fontFamily: 'Arial, sans-serif', size: 0.04, weight: 500, color: '#f8fafc', bg: '#1e293b', bgOpacity: 0.8, radius: 0.003 }, 'fade'),
  S('modern-minimal', 'Modern Minimalist', 'Clean', { fontFamily: 'Inter, Helvetica, sans-serif', weight: 500, size: 0.042, letterSpacing: 0.001, color: '#f4f4f5' }, 'fade'),
  S('bold-creator', 'Bold Creator Captions', 'Social', { fontFamily: 'Impact, "Arial Black", sans-serif', size: 0.075, weight: 900, uppercase: true, outline: 0.006 }, 'pop'),
  S('yellow-emphasis', 'Yellow Emphasis', 'Social', { color: '#facc15', weight: 900, outline: 0.0045, size: 0.068, uppercase: true }, 'pop'),
  S('word-highlight', 'Word-by-Word Highlight', 'Social', { bg: '#facc15', bgOpacity: 1, color: '#111111', size: 0.068, weight: 900, uppercase: true }, 'word-highlight'),
  S('karaoke', 'Karaoke Highlight', 'Social', { color: '#ffffff', size: 0.06, weight: 800, highlight: '#22d3ee' }, 'karaoke'),
  S('animated-pop', 'Animated Pop-In', 'Social', { color: '#ffffff', weight: 900, size: 0.07, outline: 0.005 }, 'pop'),
  S('bounce', 'Bounce Captions', 'Social', { color: '#ffffff', weight: 900, size: 0.066, outline: 0.004 }, 'bounce'),
  S('zoom', 'Zoom Captions', 'Social', { color: '#ffffff', weight: 900, size: 0.064 }, 'zoom'),
  S('slide-up', 'Slide-Up Captions', 'Social', { color: '#ffffff', weight: 800, size: 0.056, bg: '#000000', bgOpacity: 0.35 }, 'slide-up'),
  S('vertical-short', 'Vertical Short-Form', 'Social', { size: 0.062, weight: 900, y: 0.78, maxWidth: 0.8, outline: 0.005, uppercase: true }, 'word-highlight'),
  S('dynamic-center', 'Dynamic Center', 'Social', { size: 0.075, weight: 900, y: 0.5, uppercase: true, outline: 0.005 }, 'pop'),
  S('neon-glow', 'Neon Glow', 'Creative', { color: '#a5f3fc', glow: '#22d3ee', weight: 800, size: 0.064 }, 'fade'),
  S('retro-vhs', 'Retro VHS', 'Creative', { fontFamily: '"Courier New", monospace', color: '#f0abfc', weight: 700, size: 0.052, shadow: 0.35, shadowColor: '#22d3ee', shadowY: 0.002 }, 'glitch'),
  S('pixel-font', 'Pixel Font', 'Creative', { fontFamily: '"Courier New", monospace', weight: 700, size: 0.048, letterSpacing: 0.002, color: '#86efac' }, 'typewriter'),
  S('typewriter', 'Typewriter', 'Creative', { fontFamily: '"Courier New", monospace', size: 0.045, weight: 500, color: '#e5e7eb' }, 'typewriter'),
  S('comic-book', 'Comic Book', 'Creative', { fontFamily: 'Impact, "Arial Black", sans-serif', color: '#111111', bg: '#fde047', bgOpacity: 1, outline: 0.005, outlineColor: '#111111', uppercase: true, size: 0.062, radius: 0.002 }, 'pop'),
  S('gradient-text', 'Gradient Text', 'Creative', { gradient: ['#f472b6', '#a78bfa', '#22d3ee'], weight: 900, size: 0.07 }, 'reveal'),
  S('rainbow-highlight', 'Rainbow Highlight', 'Creative', { color: '#111111', bg: '#fef08a', bgOpacity: 1, size: 0.056, weight: 800 }, 'karaoke'),
  S('glass-background', 'Glass Background', 'Creative', { bg: '#ffffff', bgOpacity: 0.18, radius: 0.012, paddingX: 0.022, paddingY: 0.012, weight: 600, size: 0.046 }, 'blur-in'),
  S('handwritten', 'Handwritten', 'Creative', { fontFamily: '"Segoe Script", "Comic Sans MS", cursive', size: 0.058, weight: 400, color: '#fef3c7' }, 'reveal'),
  S('futuristic-hud', 'Futuristic HUD', 'Creative', { fontFamily: '"Courier New", monospace', color: '#67e8f9', size: 0.042, letterSpacing: 0.003, bg: '#0e7490', bgOpacity: 0.35, uppercase: true, border: '#67e8f9' }, 'reveal'),
  S('film-subtitles', 'Film Subtitles', 'Cinematic', { fontFamily: 'Georgia, serif', size: 0.043, weight: 400, color: '#f4f4f5', shadow: 0.28, y: 0.915 }, 'fade'),
  S('letterboxed', 'Letterboxed Captions', 'Cinematic', { size: 0.045, weight: 600, y: 0.935, bg: '#000000', bgOpacity: 0.9, paddingX: 0.02, radius: 0 }, 'fade'),
  S('dramatic-fade', 'Dramatic Fade', 'Cinematic', { size: 0.05, weight: 300, letterSpacing: 0.002, color: '#e7e5e4', y: 0.8 }, 'dramatic-fade'),
  S('soft-shadow', 'Soft Shadow', 'Cinematic', { size: 0.048, weight: 500, shadow: 0.5, shadowColor: '#000000', shadowY: 0.008 }, 'fade'),
  S('golden-cinematic', 'Golden Cinematic', 'Cinematic', { fontFamily: 'Georgia, serif', color: '#fcd34d', size: 0.048, weight: 500, shadow: 0.3 }, 'fade'),
  S('vintage-film', 'Vintage Film', 'Cinematic', { fontFamily: 'Georgia, serif', color: '#f5e6c8', size: 0.045, weight: 400, glow: '#92400e', shadow: 0.4 }, 'fade'),
  S('horror', 'Horror Atmosphere', 'Cinematic', { fontFamily: 'Georgia, serif', color: '#e7e5e4', size: 0.055, weight: 700, shadow: 0.8, shadowColor: '#7f1d1d', letterSpacing: 0.002 }, 'dramatic-fade'),
  S('sci-fi-terminal', 'Sci-Fi Terminal', 'Cinematic', { fontFamily: '"Courier New", monospace', color: '#4ade80', size: 0.042, bg: '#000000', bgOpacity: 0.7, align: 'left', x: 0.12, maxWidth: 0.6 }, 'typewriter'),
  S('action-typography', 'Action Typography', 'Cinematic', { fontFamily: 'Impact, "Arial Black", sans-serif', color: '#ffffff', size: 0.078, weight: 900, uppercase: true, skew: -8, outline: 0.004 }, 'zoom'),
  S('elegant-credits', 'Elegant Credits', 'Cinematic', { fontFamily: 'Georgia, serif', size: 0.038, weight: 400, letterSpacing: 0.003, color: '#e7e5e4', y: 0.5 }, 'stagger'),
  S('per-word-scale', 'Per-Word Scaling', 'Animated', { weight: 900, size: 0.062, color: '#ffffff' }, 'per-word-scale'),
  S('per-word-rotate', 'Per-Word Rotation', 'Animated', { weight: 800, size: 0.058, color: '#fef08a' }, 'per-word-rotate'),
  S('progressive-reveal', 'Progressive Reveal', 'Animated', { weight: 600, size: 0.05 }, 'progressive'),
  S('elastic-bounce', 'Elastic Bounce', 'Animated', { weight: 900, size: 0.066, color: '#f472b6', outline: 0.004 }, 'elastic'),
  S('glitch-reveal', 'Glitch Reveal', 'Animated', { fontFamily: '"Courier New", monospace', weight: 700, size: 0.054, color: '#67e8f9' }, 'glitch'),
  S('blur-to-sharp', 'Blur to Sharp', 'Animated', { weight: 600, size: 0.052 }, 'blur-in'),
  S('moving-highlight', 'Moving Highlight Box', 'Animated', { color: '#111111', bg: '#fef08a', bgOpacity: 1, size: 0.056, weight: 800 }, 'highlight-box'),
  S('wave', 'Wave Animation', 'Animated', { weight: 800, size: 0.058, color: '#a5f3fc' }, 'wave'),
  S('staggered-chars', 'Staggered Characters', 'Animated', { weight: 800, size: 0.058, color: '#f5d0fe' }, 'stagger'),
  S('dynamic-emphasis', 'Dynamic Emphasis', 'Animated', { weight: 900, size: 0.06, color: '#ffffff', outline: 0.004 }, 'emphasis'),
];

export function subtitleStyleById(id) {
  return SUBTITLE_STYLES.find((s) => s.id === id) || SUBTITLE_STYLES[0];
}

/* ------------------------------------------------------------------------- */
/* Effect presets (100+)                                                     */
/* ------------------------------------------------------------------------- */

const E = (id, name, category, primitive, params = {}, ffmpeg = null) => ({ id, name, category, primitive, params, ffmpeg });

export const EFFECTS = [
  // Environmental / cinematic VFX — procedural particle systems.
  E('fire', 'Fire Overlay', 'Cinematic VFX', 'particles', { preset: 'fire', rate: 90, life: 1.2, size: 0.06, speed: 0.4, colors: ['#fff3b0', '#f97316', '#b91c1c'], blend: 'add', gravity: -0.1 }),
  E('explosion', 'Cinematic Explosion', 'Cinematic VFX', 'particles', { preset: 'explosion', rate: 0, burst: 180, life: 1.1, size: 0.1, speed: 1.3, colors: ['#fff7ed', '#fb923c', '#7f1d1d'], blend: 'add' }),
  E('smoke', 'Smoke Plume', 'Cinematic VFX', 'particles', { preset: 'smoke', rate: 24, life: 4, size: 0.28, speed: 0.16, colors: ['#d4d4d8', '#71717a', '#27272a'], blend: 'normal', gravity: -0.02 }),
  E('fog', 'Atmospheric Fog', 'Cinematic VFX', 'particles', { preset: 'fog', rate: 10, life: 8, size: 0.5, speed: 0.05, colors: ['#cbd5e1'], blend: 'screen', opacity: 0.3 }),
  E('dust', 'Dust Cloud', 'Cinematic VFX', 'particles', { preset: 'dust', rate: 60, life: 2.5, size: 0.12, speed: 0.1, colors: ['#d6c7a1', '#8d7b5f'], blend: 'screen', opacity: 0.5 }),
  E('sparks', 'Sparks', 'Cinematic VFX', 'particles', { preset: 'sparks', rate: 40, life: 0.9, size: 0.012, speed: 1.6, colors: ['#fef3c7', '#f59e0b'], blend: 'add', gravity: 0.9 }),
  E('embers', 'Embers', 'Cinematic VFX', 'particles', { preset: 'embers', rate: 28, life: 3, size: 0.012, speed: 0.25, colors: ['#fbbf24', '#ef4444'], blend: 'add', gravity: -0.03 }),
  E('lightning', 'Lightning', 'Cinematic VFX', 'particles', { preset: 'lightning', rate: 0, burst: 1, life: 0.25, size: 0.01, colors: ['#e0f2fe', '#7dd3fc'], blend: 'add' }),
  E('rain', 'Rain', 'Cinematic VFX', 'particles', { preset: 'rain', rate: 260, life: 0.9, size: 0.004, speed: 2.6, colors: ['#bfdbfe'], blend: 'screen', gravity: 0.6 }),
  E('snow', 'Snow', 'Cinematic VFX', 'particles', { preset: 'snow', rate: 120, life: 4, size: 0.012, speed: 0.3, colors: ['#ffffff'], blend: 'screen', gravity: 0.02 }),
  E('splash', 'Water Splash', 'Cinematic VFX', 'particles', { preset: 'splash', rate: 0, burst: 140, life: 1, size: 0.02, speed: 1.1, colors: ['#e0f2fe', '#38bdf8'], blend: 'screen', gravity: 1 }),
  E('shockwave', 'Shockwave Distortion', 'Cinematic VFX', 'shockwave', { radius: 0.5, width: 0.04, strength: 0.08 }),
  E('heat-haze', 'Heat Distortion', 'Cinematic VFX', 'heat', { amount: 0.004, speed: 0.8 }),
  E('lens-flare', 'Anamorphic Lens Flare', 'Cinematic VFX', 'flare', { x: 0.72, y: 0.32, size: 0.5, color: '#67e8f9', streak: true }),
  E('light-leak', 'Light Leak Overlay', 'Cinematic VFX', 'flare', { x: 0.15, y: 0.2, size: 0.9, color: '#fb7185', streak: false }),
  E('haze', 'Atmospheric Haze', 'Cinematic VFX', 'haze', { color: '#94a3b8', amount: 0.35 }),
  E('volumetric', 'Volumetric Light', 'Cinematic VFX', 'godrays', { x: 0.3, y: 0, color: '#fef08a', amount: 0.4 }),
  E('energy', 'Energy Field', 'Cinematic VFX', 'particles', { preset: 'energy', rate: 70, life: 1.4, size: 0.03, speed: 0.5, colors: ['#67e8f9', '#c084fc'], blend: 'add' }),
  E('magic', 'Magical Particles', 'Cinematic VFX', 'particles', { preset: 'magic', rate: 50, life: 2.6, size: 0.016, speed: 0.3, colors: ['#f0abfc', '#818cf8', '#fef08a'], blend: 'add', gravity: -0.02 }),

  // Image effects.
  E('gaussian-blur', 'Gaussian Blur', 'Image', 'filter', { blur: 6 }, 'gblur=sigma=6'),
  E('directional-blur', 'Directional Blur', 'Image', 'filter', { blur: 8, directional: true, angle: 0 }, 'avgblur=sizeX=8:sizeY=1'),
  E('radial-blur', 'Radial Blur', 'Image', 'filter', { blur: 10, radial: true }, 'gblur=sigma=10'),
  E('motion-blur', 'Motion Blur', 'Image', 'motion-blur', { amount: 0.6, samples: 8 }, 'tmix=frames=4:weights="1 1 1 1"'),
  E('sharpen', 'Sharpen', 'Image', 'filter', { sharpen: 0.8 }, 'unsharp=5:5:0.8'),
  E('glow', 'Glow', 'Image', 'glow', { radius: 0.02, intensity: 0.6 }, 'gblur=sigma=8,blend=all_mode=screen:all_opacity=0.5'),
  E('bloom', 'Bloom', 'Image', 'glow', { radius: 0.04, intensity: 0.9, threshold: 0.65 }, 'gblur=sigma=14,blend=all_mode=screen:all_opacity=0.65'),
  E('vignette', 'Vignette', 'Image', 'vignette', { amount: 0.6, softness: 0.5 }, 'vignette=angle=PI/4'),
  E('film-grain', 'Film Grain', 'Image', 'grain', { amount: 0.18, size: 1 }, 'noise=alls=18:allf=t'),
  E('chromatic', 'Chromatic Aberration', 'Image', 'chroma', { amount: 0.004, radial: false }, 'rgbashift=rh=3:bh=-3'),
  E('pixelate', 'Pixelate', 'Image', 'pixelate', { size: 18 }, 'pixelize=w=18:h=18'),
  E('posterize', 'Posterize', 'Image', 'posterize', { levels: 6 }, 'posterize=levels=6'),
  E('halftone', 'Halftone', 'Image', 'halftone', { size: 6, angle: 45 }),
  E('edge', 'Edge Detection', 'Image', 'edges', { strength: 1 }, 'edgedetect=low=0.1:high=0.4'),
  E('emboss', 'Emboss', 'Image', 'emboss', { strength: 0.8 }, 'convolution="0 -1 0 -1 4 -1 0 -1 0"'),
  E('distortion', 'Wave Distortion', 'Image', 'distort', { amount: 0.02, frequency: 6 }, 'geq=r=r(X+10*sin(Y/20)):g=g(X+10*sin(Y/20)):b=b(X+10*sin(Y/20))'),
  E('fisheye', 'Fisheye', 'Image', 'fisheye', { amount: 0.6 }, null),
  E('mirror', 'Mirror', 'Image', 'mirror', { axis: 'x' }, 'hflip'),
  E('kaleidoscope', 'Kaleidoscope', 'Image', 'kaleidoscope', { segments: 6, rotation: 0 }, null),

  // Stylized looks.
  E('vhs', 'VHS Tape', 'Stylized', 'vhs', { amount: 0.7, scanlines: 0.4 }, 'noise=alls=14:allf=t,rgbashift=rh=2:bh=-2'),
  E('crt', 'CRT Monitor', 'Stylized', 'crt', { curvature: 0.35, scanlines: 0.5, glow: 0.3 }, null),
  E('digital-glitch', 'Digital Glitch', 'Stylized', 'glitch', { amount: 0.5, rate: 0.4 }, 'rgbashift=rh=6:bh=-6'),
  E('datamosh', 'Datamosh Simulation', 'Stylized', 'datamosh', { amount: 0.7 }, null),
  E('retro-film', 'Retro Film', 'Stylized', 'film', { warmth: 0.3, grain: 0.2, fade: 0.12 }, 'colorbalance=rs=.1:bs=-.08,noise=alls=10:allf=t'),
  E('old-tv', 'Old Television', 'Stylized', 'crt', { curvature: 0.5, scanlines: 0.7, blackWhite: true }, 'hue=s=0,noise=alls=16:allf=t'),
  E('comic', 'Comic Book', 'Stylized', 'comic', { levels: 4, outline: 0.5 }, null),
  E('speed-lines', 'Anime Speed Lines', 'Stylized', 'speedlines', { intensity: 0.6, focalX: 0.5, focalY: 0.5 }, null),
  E('cyberpunk', 'Cyberpunk Glow', 'Stylized', 'cyberpunk', { cyan: 0.8, magenta: 0.7 }, 'colorbalance=rs=.1:bs=.15:rm=.1:bm=.1,eq=saturation=1.5'),
  E('dream', 'Dreamlike Blur', 'Stylized', 'filter', { blur: 3, saturation: 1.25, glow: true }, 'gblur=sigma=3,eq=saturation=1.25'),
  E('vintage-camera', 'Vintage Camera', 'Stylized', 'film', { warmth: 0.5, grain: 0.3, fade: 0.2, vignette: 0.4 }, 'colorbalance=rs=.15:bs=-.1,vignette'),
  E('infrared', 'Infrared Coloring', 'Stylized', 'infrared', { amount: 0.8 }, 'hue=h=120:s=2'),

  // Motion.
  E('camera-shake', 'Camera Shake', 'Motion', 'shake', { amount: 0.012, speed: 6, rotation: 0.4 }, 'crop=iw-izoom*2:ih-izoom*2'),
  E('handheld', 'Handheld Camera', 'Motion', 'shake', { amount: 0.005, speed: 2.2, rotation: 0.2, smooth: true }, null),
  E('smooth-zoom', 'Smooth Zoom', 'Motion', 'zoom', { from: 1, to: 1.12, speed: 0.3 }, null),
  E('dynamic-rotation', 'Dynamic Rotation', 'Motion', 'motion-rotate', { amount: 6, speed: 0.4 }, null),
  E('motion-trails', 'Motion Trails', 'Motion', 'trails', { length: 6, opacity: 0.5 }, 'tmix=frames=6:weights="1 1 1 1 1 1"'),
  E('echo', 'Echo Frames', 'Motion', 'trails', { length: 3, opacity: 0.35, delay: 2 }, 'tmix=frames=3'),
  E('perspective', 'Perspective Move', 'Motion', 'perspective', { amount: 0.25, speed: 0.3 }, null),
  E('parallax', 'Parallax Drift', 'Motion', 'parallax', { amount: 0.04, speed: 0.2 }, null),
  E('bouncing', 'Bouncing', 'Motion', 'bounce', { amount: 0.03, speed: 1.2 }, null),
  E('elastic-move', 'Elastic Movement', 'Motion', 'elastic', { amount: 0.06, speed: 0.8 }, null),

  // Additional colour / optical presets (100 total and beyond).
  E('auto-contrast', 'Auto Contrast', 'Color', 'color', { contrast: 0.25, saturation: 0.05 }, 'eq=contrast=1.25'),
  E('warm-glow', 'Warm Glow', 'Color', 'color', { temperature: 0.3, saturation: 0.1, glow: 0.2 }, 'colorbalance=rs=.1:gs=.03'),
  E('cool-tone', 'Cool Tone', 'Color', 'color', { temperature: -0.3, tint: -0.05 }, 'colorbalance=bs=.12'),
  E('teal-orange', 'Teal & Orange', 'Color', 'color', { temperature: 0.25, tint: -0.1, saturation: 0.15 }, 'colorbalance=rs=.12:bs=-.12'),
  E('bleach-bypass', 'Bleach Bypass', 'Color', 'color', { saturation: -0.45, contrast: 0.3, brightness: 0.05 }, 'eq=saturation=0.55:contrast=1.3'),
  E('day-for-night', 'Day for Night', 'Color', 'color', { brightness: -0.25, temperature: -0.4, saturation: -0.2 }, 'eq=brightness=-0.2:saturation=0.8,colorbalance=bs=.2'),
  E('sepia', 'Sepia', 'Color', 'color', { sepia: 1 }, 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'),
  E('black-white', 'Black & White', 'Color', 'color', { saturation: -1 }, 'hue=s=0'),
  E('high-contrast-bw', 'High Contrast B&W', 'Color', 'color', { saturation: -1, contrast: 0.45 }, 'hue=s=0,eq=contrast=1.45'),
  E('faded-film', 'Faded Film', 'Color', 'film', { fade: 0.25, grain: 0.12 }, 'curves=preset=vintage'),
  E('cross-process', 'Cross Process', 'Color', 'color', { cyan: 0.4, magenta: 0.3, contrast: 0.2 }, 'colorbalance=rs=-.1:gs=.1:bs=.2:rm=.2:bm=-.1'),
  E('infrared-false', 'False Infrared', 'Color', 'infrared', { amount: 1, hue: 300 }, 'hue=h=300:s=1.6'),
  E('sun-flare', 'Sun Flare', 'Light', 'flare', { x: 0.82, y: 0.18, size: 0.7, color: '#fde68a', streak: true }),
  E('window-light', 'Window Light', 'Light', 'godrays', { x: 0.18, y: 0.05, color: '#fef3c7', amount: 0.55 }),
  E('soft-focus', 'Soft Focus', 'Image', 'filter', { blur: 1.6, brightness: 0.04 }, 'gblur=sigma=1.6'),
  E('film-damage', 'Film Damage', 'Stylized', 'film', { grain: 0.35, scratches: true }, 'noise=alls=22:allf=t'),
  E('scanlines', 'Scanlines', 'Stylized', 'scanlines', { density: 3, opacity: 0.35 }, null),
  E('strobe', 'Strobe', 'Stylized', 'strobe', { speed: 8, amount: 0.4 }, null),
  E('invert', 'Invert', 'Stylized', 'invert', { amount: 1 }, 'negate'),
  E('prism', 'Prism Split', 'Distort', 'chroma', { amount: 0.02, prism: true }, 'rgbashift=rh=8:gh=4:bh=-8'),
  E('swirl', 'Swirl Distortion', 'Distort', 'swirl', { amount: 0.5, radius: 0.6 }, null),
  E('zoom-pulse', 'Zoom Pulse', 'Motion', 'zoom', { from: 1.05, to: 1, speed: 2 }, null),
  E('breathe', 'Breathe', 'Motion', 'zoom', { from: 1, to: 1.04, speed: 0.5 }, null),
  E('drift-up', 'Drift Up', 'Motion', 'parallax', { amount: 0.06, speed: 0.08, axis: 'y' }, null),
  E('drift-left', 'Drift Left', 'Motion', 'parallax', { amount: 0.05, speed: 0.1, axis: 'x' }, null),
  E('whip-pan', 'Whip Pan', 'Motion', 'shake', { amount: 0.05, speed: 11 }, null),
  E('earthquake', 'Earthquake', 'Motion', 'shake', { amount: 0.035, speed: 14 }, null),
  E('heartbeat', 'Heartbeat', 'Motion', 'elastic', { amount: 0.035, speed: 1.5 }, null),
  E('glow-pulse', 'Glow Pulse', 'Light', 'glow', { radius: 0.03, intensity: 0.4, pulse: true }, null),
  E('shimmer', 'Shimmer', 'Light', 'haze', { color: '#fef9c3', amount: 0.18 }, null),
  E('vignette-pulse', 'Vignette Pulse', 'Image', 'vignette', { amount: 0.7, pulse: true }, 'vignette'),
  E('grain-burst', 'Grain Burst', 'Stylized', 'grain', { amount: 0.4, burst: true }, 'noise=alls=30:allf=t'),
  E('chroma-wave', 'Chroma Wave', 'Stylized', 'chroma', { amount: 0.008, wave: true }, 'rgbashift=rh=4:bh=-4'),
  E('hologram', 'Hologram', 'Stylized', 'hologram', { amount: 0.6 }, null),
  E('neon-outline', 'Neon Outline', 'Stylized', 'neon', { color: '#22d3ee', amount: 0.7 }, null),
  E('pixel-sort', 'Pixel Sort', 'Stylized', 'pixelsort', { amount: 0.5 }, null),
  E('ascii', 'ASCII Art', 'Stylized', 'ascii', { size: 8 }, null),
  E('oil-paint', 'Oil Paint', 'Stylized', 'oil', { radius: 3 }, null),
  E('sketch', 'Pencil Sketch', 'Stylized', 'sketch', { amount: 0.8 }, null),
  E('glitch-blocks', 'Glitch Blocks', 'Stylized', 'glitch', { amount: 0.8, rate: 1 }, 'rgbashift=rh=10:bh=-10'),
  E('vhs-tracking', 'VHS Tracking', 'Stylized', 'vhs', { amount: 1, tracking: 0.7 }, null),
  E('crt-turn-off', 'CRT Power Off', 'Stylized', 'crt', { curvature: 0.2, powerOff: true }, null),
  E('lightning-flash', 'Lightning Flash', 'Light', 'flash', { color: '#e0f2fe', speed: 1.6 }, null),
  E('strobe-flash', 'Strobe Flash', 'Light', 'strobe', { speed: 12, amount: 0.8 }, null),
  E('color-pulse', 'Colour Pulse', 'Color', 'color', { saturation: 0.4, pulse: true }, null),
];

export function effectById(id) {
  return EFFECTS.find((e) => e.id === id) || null;
}

/* ------------------------------------------------------------------------- */
/* Motion graphics templates (50)                                            */
/* ------------------------------------------------------------------------- */

const MG = (id, name, category, text, style, animation = 'fade-in', duration = 5) => ({ id, name, category, text, style, animation, duration });

export const MOTION_TEMPLATES = [
  MG('lower-third', 'Lower Third', 'Lower Thirds', 'Jordan Lee\nCreative Director', { y: 0.82, x: 0.22, align: 'left', fontSize: 0.045, background: { color: '#000000', opacity: 0.45, radius: 0.004, padding: 0.012 } }, 'slide-in-left'),
  MG('lower-third-accent', 'Accent Lower Third', 'Lower Thirds', 'Alex Rivera\nDirector of Photography', { y: 0.82, x: 0.22, align: 'left', fontSize: 0.045, accentBar: true }, 'slide-in-left'),
  MG('news-lower', 'News Ticker', 'Lower Thirds', 'BREAKING: Cascade Motion 2.0 launches today', { y: 0.9, fontSize: 0.036, background: { color: '#0b3d91', opacity: 0.95, radius: 0, padding: 0.01 }, align: 'left', x: 0.5 }, 'slide-in-left'),
  MG('name-card', 'Minimal Name Card', 'Lower Thirds', 'Maya Chen', { y: 0.5, fontSize: 0.06, letterSpacing: 0.002 }, 'fade-in'),
  MG('job-title', 'Job Title Card', 'Lower Thirds', 'SENIOR VIDEO EDITOR', { y: 0.58, fontSize: 0.028, letterSpacing: 0.004, color: '#a1a1aa' }, 'fade-in'),
  MG('social-handle', 'Social Handle', 'Social', '@cascademotion', { y: 0.9, fontSize: 0.032, background: { color: '#000000', opacity: 0.6, radius: 0.02, padding: 0.01 } }, 'pop-in'),
  MG('subscribe', 'Subscribe Button', 'Social', 'SUBSCRIBE', { y: 0.88, x: 0.5, fontSize: 0.036, background: { color: '#e11d48', opacity: 1, radius: 0.006, padding: 0.01 } }, 'pop-in'),
  MG('follow', 'Follow for More', 'Social', 'FOLLOW FOR MORE', { y: 0.12, fontSize: 0.03, background: { color: '#111111', opacity: 0.7, radius: 0.004, padding: 0.008 } }, 'slide-in-top'),
  MG('like-share', 'Like & Share', 'Social', 'LIKE · SHARE · SUBSCRIBE', { y: 0.9, fontSize: 0.028, letterSpacing: 0.002 }, 'fade-in'),
  MG('social-count', 'Follower Count', 'Social', '1.2M', { y: 0.5, x: 0.5, fontSize: 0.14, fontWeight: 900 }, 'count-up'),
  MG('quote', 'Pull Quote', 'Titles', '“The edit is where the story lives.”', { y: 0.5, width: 0.68, fontSize: 0.052, fontFamily: 'Georgia, serif', fontStyle: 'italic' }, 'fade-in'),
  MG('quote-attribution', 'Quote with Attribution', 'Titles', '“Every frame is a decision.”\n— Walter Murch', { y: 0.5, fontSize: 0.045, fontFamily: 'Georgia, serif' }, 'fade-in'),
  MG('chapter', 'Chapter Title', 'Titles', '01\nTHE BEGINNING', { y: 0.5, fontSize: 0.07, letterSpacing: 0.004, background: { color: '#000000', opacity: 0.5, radius: 0, padding: 0.03 } }, 'zoom-in'),
  MG('chapter-number', 'Big Chapter Number', 'Titles', '01', { y: 0.5, fontSize: 0.26, fontWeight: 900, color: '#ffffff' }, 'count-up'),
  MG('section', 'Section Divider', 'Titles', 'PART TWO', { y: 0.5, fontSize: 0.055, letterSpacing: 0.008 }, 'tracking-in'),
  MG('title', 'Opening Title', 'Titles', 'CASCADE', { y: 0.5, fontSize: 0.16, fontWeight: 900, letterSpacing: 0.006 }, 'tracking-in'),
  MG('subtitle-title', 'Title + Subtitle', 'Titles', 'CASCADE MOTION\nProfessional video editing', { y: 0.5, fontSize: 0.09, fontWeight: 900 }, 'fade-in'),
  MG('credits-roll', 'End Credits Roll', 'Credits', 'DIRECTED BY\nJordan Lee\n\nEDITED BY\nAlex Rivera', { y: 0.5, fontSize: 0.032, align: 'center' }, 'credits-roll'),
  MG('credits-cast', 'Cast Credits', 'Credits', 'MAYA CHEN\nALEX RIVERA\nJORDAN LEE', { y: 0.5, fontSize: 0.04, letterSpacing: 0.003 }, 'credits-roll'),
  MG('thank-you', 'Thank You', 'Credits', 'Thank you for watching', { y: 0.5, fontSize: 0.05 }, 'fade-in'),
  MG('logo-reveal', 'Logo Reveal', 'Intros', 'CASCADE', { y: 0.5, fontSize: 0.2, fontWeight: 900, letterSpacing: 0.01 }, 'logo-reveal'),
  MG('intro-slide', 'Intro Slide', 'Intros', 'A CASCADE ORIGINAL', { y: 0.5, fontSize: 0.035, letterSpacing: 0.006 }, 'tracking-in'),
  MG('outro-slide', 'Outro Slide', 'Outros', 'Thanks for watching\n@cascademotion', { y: 0.5, fontSize: 0.05 }, 'fade-in'),
  MG('next-video', 'Next Video Card', 'Outros', 'NEXT: How to grade in 5 minutes', { y: 0.5, width: 0.7, fontSize: 0.045, background: { color: '#000000', opacity: 0.6, radius: 0.01, padding: 0.02 } }, 'slide-in-left'),
  MG('cta', 'Call to Action', 'Outros', 'START EDITING TODAY', { y: 0.78, fontSize: 0.036, background: { color: '#e11d48', opacity: 1, radius: 0.008, padding: 0.012 } }, 'pop-in'),
  MG('notification', 'Notification Popup', 'Overlays', 'New message from Cascade', { y: 0.14, x: 0.78, align: 'left', width: 0.36, fontSize: 0.032, background: { color: '#ffffff', opacity: 0.95, radius: 0.012, padding: 0.014 }, color: '#111111' }, 'slide-in-right'),
  MG('like-counter', 'Like Counter', 'Overlays', '♥ 24.8K', { y: 0.2, x: 0.14, fontSize: 0.05, color: '#fb7185' }, 'count-up'),
  MG('timer', 'Countdown Timer', 'Overlays', '00:10', { y: 0.14, x: 0.5, fontSize: 0.07, fontFamily: '"Courier New", monospace' }, 'count-up'),
  MG('progress', 'Progress Label', 'Overlays', 'RENDERING 87%', { y: 0.86, fontSize: 0.028, fontFamily: '"Courier New", monospace', align: 'left', x: 0.2 }, 'fade-in'),
  MG('weather', 'Weather Bug', 'Overlays', '72°F · CLEAR', { y: 0.1, x: 0.1, align: 'left', fontSize: 0.034 }, 'fade-in'),
  MG('score', 'Score Bug', 'Overlays', 'HOME 2 — 1 AWAY', { y: 0.1, x: 0.5, fontSize: 0.034, background: { color: '#111111', opacity: 0.85, radius: 0.004, padding: 0.01 } }, 'slide-in-top'),
  MG('breaking', 'Breaking News Banner', 'Overlays', 'BREAKING NEWS', { y: 0.12, fontSize: 0.045, background: { color: '#b91c1c', opacity: 1, radius: 0, padding: 0.012 }, align: 'left', x: 0.2 }, 'slide-in-top'),
  MG('caption-box', 'Caption Box', 'Overlays', 'Add your caption here', { y: 0.86, fontSize: 0.042, background: { color: '#000000', opacity: 0.8, radius: 0.006, padding: 0.012 } }, 'fade-in'),
  MG('speech-bubble', 'Speech Bubble', 'Overlays', 'Wait, what?', { y: 0.3, x: 0.3, width: 0.4, fontSize: 0.04, background: { color: '#ffffff', opacity: 1, radius: 0.02, padding: 0.02 }, color: '#111111' }, 'pop-in'),
  MG('sticker', 'Sticker Text', 'Overlays', '*NEW*', { y: 0.3, x: 0.72, fontSize: 0.055, fontWeight: 900, rotation: -12, background: { color: '#fde047', opacity: 1, radius: 0.01, padding: 0.012 }, color: '#111111' }, 'pop-in'),
  MG('countdown', 'Countdown', 'Overlays', '3', { y: 0.5, fontSize: 0.22, fontWeight: 900 }, 'zoom-in'),
  MG('presents', 'Presents Card', 'Intros', 'CASCADE PRESENTS', { y: 0.5, fontSize: 0.03, letterSpacing: 0.008 }, 'tracking-in'),
  MG('location', 'Location Card', 'Titles', 'REYKJAVÍK, ICELAND', { y: 0.88, x: 0.18, align: 'left', fontSize: 0.026, letterSpacing: 0.004, background: { color: '#000000', opacity: 0.6, radius: 0.003, padding: 0.008 } }, 'slide-in-left'),
  MG('date', 'Date Card', 'Titles', 'NOVEMBER 24, 2026', { y: 0.12, x: 0.5, fontSize: 0.026, letterSpacing: 0.004 }, 'fade-in'),
  MG('stat', 'Stat Callout', 'Titles', '4.9×', { y: 0.4, x: 0.5, fontSize: 0.13, fontWeight: 900 }, 'count-up'),
  MG('stat-label', 'Stat Label', 'Titles', 'FASTER RENDERS', { y: 0.55, x: 0.5, fontSize: 0.026, letterSpacing: 0.004 }, 'fade-in'),
  MG('bullet', 'Bullet Point', 'Titles', '•  One timeline. Every tool.', { y: 0.78, x: 0.26, align: 'left', width: 0.62, fontSize: 0.038 }, 'slide-in-left'),
  MG('text-mask', 'Text with Background Mask', 'Titles', 'CASCADE', { y: 0.5, fontSize: 0.13, fontWeight: 900, background: { color: '#111111', opacity: 0.85, radius: 0, padding: 0.04 } }, 'reveal'),
  MG('outline-title', 'Outline Title', 'Titles', 'MOTION', { y: 0.5, fontSize: 0.15, fontWeight: 900, color: 'transparent', outline: { color: '#ffffff', width: 0.002, opacity: 1 } }, 'tracking-in'),
  MG('gradient-title', 'Gradient Title', 'Titles', 'CASCADE', { y: 0.5, fontSize: 0.15, fontWeight: 900, gradient: ['#f472b6', '#a78bfa', '#22d3ee'] }, 'reveal'),
  MG('glitch-title', 'Glitch Title', 'Titles', 'ERROR', { y: 0.5, fontSize: 0.14, fontWeight: 900, fontFamily: '"Courier New", monospace', color: '#67e8f9' }, 'glitch'),
  MG('typewriter-title', 'Typewriter Title', 'Titles', 'Once upon a time...', { y: 0.5, fontSize: 0.06, fontFamily: '"Courier New", monospace', align: 'left', x: 0.2 }, 'typewriter'),
  MG('fade-credit', 'Fade Credit', 'Credits', 'A FILM BY CASCADE', { y: 0.86, fontSize: 0.028, letterSpacing: 0.004 }, 'fade-in'),
  MG('credits-role', 'Role and Name', 'Credits', 'DIRECTOR OF PHOTOGRAPHY\nAlex Rivera', { y: 0.5, fontSize: 0.034, align: 'center' }, 'fade-in'),
  MG('sponsor', 'Sponsor Card', 'Overlays', 'BROUGHT TO YOU BY\nCASCADE', { y: 0.14, x: 0.5, fontSize: 0.026, letterSpacing: 0.003, background: { color: '#000000', opacity: 0.5, radius: 0.004, padding: 0.01 } }, 'fade-in'),
  MG('end-screen', 'End Screen', 'Outros', 'WATCH NEXT', { y: 0.24, x: 0.76, width: 0.34, fontSize: 0.028, background: { color: '#000000', opacity: 0.65, radius: 0.008, padding: 0.018 } }, 'slide-in-right'),
];

/* ------------------------------------------------------------------------- */
/* Colour presets (30)                                                       */
/* ------------------------------------------------------------------------- */

const C = (id, name, category, patch) => ({ id, name, category, patch });

export const COLOR_PRESETS = [
  C('neutral', 'Neutral', 'Basic', {}),
  C('cinematic', 'Cinematic', 'Basic', { contrast: 0.12, saturation: -0.08, shadows: -0.05, highlights: -0.08, lift: [0.01, 0.01, 0.02], gain: [1.02, 1, 0.98] }),
  C('warm', 'Warm Daylight', 'Basic', { temperature: 0.28, tint: 0.02, brightness: 0.03 }),
  C('cool', 'Cool Daylight', 'Basic', { temperature: -0.28, tint: -0.02 }),
  C('high-contrast', 'High Contrast', 'Basic', { contrast: 0.3, blacks: -0.1, whites: 0.08 }),
  C('soft', 'Soft Contrast', 'Basic', { contrast: -0.18, shadows: 0.1, highlights: -0.05 }),
  C('vibrant', 'Vibrant', 'Basic', { saturation: 0.28, vibrance: 0.3 }),
  C('desaturated', 'Desaturated', 'Basic', { saturation: -0.45 }),
  C('bw', 'Monochrome', 'Basic', { saturation: -1, contrast: 0.15 }),
  C('sepia', 'Sepia', 'Creative', { saturation: -0.5, temperature: 0.35, tint: 0.08, identifier: 'sepia' }),
  C('teal-orange', 'Teal & Orange', 'Cinematic', { temperature: 0.18, tint: -0.08, saturation: 0.12, lift: [0, 0.01, 0.04], gain: [1.05, 1, 0.94], selective: [{ hue: 25, range: 40, saturation: 0.2 }] }),
  C('bleach', 'Bleach Bypass', 'Cinematic', { saturation: -0.35, contrast: 0.32, brightness: 0.04 }),
  C('noir', 'Film Noir', 'Cinematic', { saturation: -1, contrast: 0.5, blacks: -0.12, whites: 0.1 }),
  C('day-night', 'Day for Night', 'Cinematic', { brightness: -0.2, temperature: -0.4, saturation: -0.18, lift: [0, 0.01, 0.05] }),
  C('golden', 'Golden Hour', 'Cinematic', { temperature: 0.35, brightness: 0.06, highlights: 0.08, saturation: 0.1 }),
  C('blockbuster', 'Blockbuster', 'Cinematic', { contrast: 0.2, saturation: 0.15, temperature: 0.1, lift: [0.02, 0.01, 0], gain: [1.04, 1, 0.96] }),
  C('matrix', 'Matrix Green', 'Creative', { tint: 0.3, saturation: -0.2, temperature: -0.2, gain: [0.9, 1.08, 0.9] }),
  C('cyberpunk', 'Cyberpunk', 'Creative', { tint: 0.25, saturation: 0.35, lift: [0.03, 0, 0.05], gain: [1.08, 0.98, 1.06] }),
  C('pastel', 'Pastel', 'Creative', { saturation: -0.15, brightness: 0.08, contrast: -0.12, lift: [0.03, 0.03, 0.04] }),
  C('vintage', 'Vintage', 'Creative', { temperature: 0.2, saturation: -0.25, contrast: -0.1, lift: [0.04, 0.03, 0.02], gain: [0.98, 0.96, 0.9] }),
  C('faded', 'Faded Film', 'Creative', { contrast: -0.2, blacks: 0.12, saturation: -0.15 }),
  C('infrared', 'Infrared', 'Creative', { hue: 140, saturation: 0.7, temperature: -0.2 }),
  C('anime', 'Anime Pop', 'Creative', { saturation: 0.45, contrast: 0.18, vibrance: 0.4 }),
  C('horror', 'Horror', 'Creative', { saturation: -0.4, contrast: 0.35, tint: 0.1, lift: [0, 0.005, 0.01] }),
  C('dream', 'Dreamy', 'Creative', { saturation: 0.1, brightness: 0.06, contrast: -0.15, temperature: 0.1, gamma: 1.05 }),
  C('hdr', 'HDR Punch', 'Basic', { contrast: 0.25, saturation: 0.2, shadows: 0.15, highlights: -0.1, vibrance: 0.25 }),
  C('log', 'Log Flat', 'Technical', { contrast: -0.3, saturation: -0.25, shadows: 0.15, highlights: -0.1 }),
  C('rec709', 'Rec.709', 'Technical', { contrast: 0.02, gamma: 1.02 }),
  C('skin', 'Skin Tone Protect', 'Technical', { vibrance: 0.08, saturation: 0.04, temperature: 0.05, selective: [{ hue: 20, range: 30, saturation: 0.08 }] }),
  C('solarized', 'Solarized', 'Creative', { temperature: 0.12, tint: 0.15, lift: [0.03, 0.02, 0.01], gamma: 0.95, contrast: 0.08 }),
];

/* ------------------------------------------------------------------------- */
/* Export presets and compatibility                                          */
/* ------------------------------------------------------------------------- */

export const EXPORT_PRESETS = [
  { id: 'youtube-1080p', name: 'YouTube 1080p', width: 1920, height: 1080, fps: 30, videoCodec: 'libx264', audioCodec: 'aac', videoBitrate: '12M', audioBitrate: '192k', container: 'mp4', preset: 'medium' },
  { id: 'youtube-4k', name: 'YouTube 4K', width: 3840, height: 2160, fps: 30, videoCodec: 'libx265', audioCodec: 'aac', videoBitrate: '40M', audioBitrate: '256k', container: 'mp4', preset: 'slow' },
  { id: 'tiktok', name: 'TikTok / Shorts', width: 1080, height: 1920, fps: 30, videoCodec: 'libx264', audioCodec: 'aac', videoBitrate: '8M', audioBitrate: '192k', container: 'mp4', preset: 'medium' },
  { id: 'instagram', name: 'Instagram Reel', width: 1080, height: 1920, fps: 30, videoCodec: 'libx264', audioCodec: 'aac', videoBitrate: '8M', audioBitrate: '192k', container: 'mp4', preset: 'medium' },
  { id: 'instagram-square', name: 'Instagram Square', width: 1080, height: 1080, fps: 30, videoCodec: 'libx264', audioCodec: 'aac', videoBitrate: '8M', audioBitrate: '192k', container: 'mp4', preset: 'medium' },
  { id: 'discord', name: 'Discord (10 MB)', width: 1280, height: 720, fps: 30, videoCodec: 'libx264', audioCodec: 'aac', videoBitrate: '2M', audioBitrate: '128k', container: 'mp4', preset: 'fast' },
  { id: 'webm', name: 'WebM VP9', width: 1920, height: 1080, fps: 30, videoCodec: 'libvpx-vp9', audioCodec: 'libopus', videoBitrate: '0', crf: 32, audioBitrate: '160k', container: 'webm', preset: 'good' },
  { id: 'archive', name: 'High-quality archive', width: 1920, height: 1080, fps: 30, videoCodec: 'libx264', audioCodec: 'flac', videoBitrate: '0', crf: 12, audioBitrate: '0', container: 'mkv', preset: 'slow' },
  { id: 'audio-only', name: 'Audio only (MP3)', width: 0, height: 0, fps: 0, videoCodec: null, audioCodec: 'libmp3lame', audioBitrate: '256k', container: 'mp3', preset: 'medium' },
];

export const VIDEO_CODECS = [
  { id: 'libx264', label: 'H.264 / AVC', containers: ['mp4', 'mov', 'mkv'], hardware: ['h264_nvenc', 'h264_vaapi', 'h264_qsv', 'h264_amf'] },
  { id: 'libx265', label: 'H.265 / HEVC', containers: ['mp4', 'mov', 'mkv'], hardware: ['hevc_nvenc', 'hevc_vaapi', 'hevc_qsv', 'hevc_amf'] },
  { id: 'libvpx-vp9', label: 'VP9', containers: ['webm', 'mkv'], hardware: ['vp9_vaapi', 'vp9_qsv'] },
  { id: 'libaom-av1', label: 'AV1', containers: ['webm', 'mp4', 'mkv'], hardware: ['av1_nvenc', 'av1_vaapi', 'av1_qsv'] },
];

export const AUDIO_CODECS = [
  { id: 'aac', label: 'AAC', containers: ['mp4', 'mov', 'mkv'], channels: [1, 2, 6] },
  { id: 'libopus', label: 'Opus', containers: ['webm', 'mkv'], channels: [1, 2, 6] },
  { id: 'libmp3lame', label: 'MP3', containers: ['mp3', 'mkv'], channels: [1, 2] },
  { id: 'flac', label: 'FLAC', containers: ['mkv', 'flac'], channels: [1, 2, 6] },
  { id: 'pcm_s16le', label: 'PCM 16-bit', containers: ['mov', 'mkv', 'wav'], channels: [1, 2, 6] },
  { id: 'eac3', label: 'Dolby Digital Plus (E-AC-3)', containers: ['mp4', 'mkv'], channels: [1, 2, 6] },
];

export const CONTAINERS = [
  { id: 'mp4', label: 'MP4', ext: 'mp4', video: ['libx264', 'libx265', 'libaom-av1'], audio: ['aac', 'eac3'] },
  { id: 'mov', label: 'MOV', ext: 'mov', video: ['libx264', 'libx265'], audio: ['aac', 'pcm_s16le'] },
  { id: 'webm', label: 'WebM', ext: 'webm', video: ['libvpx-vp9', 'libaom-av1'], audio: ['libopus'] },
  { id: 'mkv', label: 'MKV', ext: 'mkv', video: ['libx264', 'libx265', 'libvpx-vp9', 'libaom-av1'], audio: ['aac', 'libopus', 'libmp3lame', 'flac', 'pcm_s16le', 'eac3'] },
  { id: 'mp3', label: 'MP3 audio', ext: 'mp3', video: [], audio: ['libmp3lame'] },
  { id: 'flac', label: 'FLAC audio', ext: 'flac', video: [], audio: ['flac'] },
  { id: 'wav', label: 'WAV audio', ext: 'wav', video: [], audio: ['pcm_s16le'] },
];

export function codecCompatible(container, videoCodec, audioCodec) {
  const c = CONTAINERS.find((x) => x.id === container);
  if (!c) return false;
  if (videoCodec && !c.video.includes(videoCodec)) return false;
  if (audioCodec && !c.audio.includes(audioCodec)) return false;
  return true;
}

/* ------------------------------------------------------------------------- */
/* Subtitle file formats                                                     */
/* ------------------------------------------------------------------------- */

export function formatSrt(cues = []) {
  return cues.map((cue, i) => {
    const start = srtTime(cue.start);
    const end = srtTime(cue.end);
    return `${i + 1}\n${start} --> ${end}\n${cue.text}\n`;
  }).join('\n');
}

function srtTime(ticks) {
  const total = Math.max(0, ticks) / TICKS;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.floor((total - Math.floor(total)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function formatVtt(cues = []) {
  return `WEBVTT\n\n${cues.map((cue) => {
    const start = vttTime(cue.start);
    const end = vttTime(cue.end);
    return `${start} --> ${end}\n${cue.text}\n`;
  }).join('\n')}`;
}

function vttTime(ticks) {
  return srtTime(ticks).replace(',', '.');
}

export function formatAss(cues = [], style = null) {
  const st = subtitleStyleById(style?.styleId || 'classic-white');
  const s = { ...st.style, ...(style?.style || {}) };
  const fontSize = Math.round(52 * (s.size / 0.052));
  const assColor = (hex, alpha = 0) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '#ffffff'));
    if (!m) return '&H00FFFFFF';
    const int = parseInt(m[1], 16);
    const b = int & 255; const g = (int >> 8) & 255; const r = (int >> 16) & 255;
    return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${r.toString(16).padStart(2, '0').toUpperCase()}`;
  };
  const primary = assColor(s.color);
  const outline = s.outline ? assColor(s.outlineColor) : assColor(s.color);
  const back = s.bg ? assColor(s.bg, Math.round((1 - s.bgOpacity) * 255)) : '&HFF000000';
  const events = cues.map((cue) => {
    const start = assTime(cue.start);
    const end = assTime(cue.end);
    const text = String(cue.text || '').replace(/\n/g, '\\N').replace(/[{}]/g, '');
    return `Dialogue: 0,${start},${end},Cascade,,0,0,0,,{\\an5\\pos(${Math.round(s.x * 384) === 384 ? 960 : Math.round(s.x * 1920)},${Math.round(s.y * 1080)})}${text}`;
  }).join('\n');
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cascade,${String(s.fontFamily || 'Arial').split(',')[0].replace(/"/g, '')},${fontSize},${primary},${primary},${outline},${back},${s.weight >= 600 ? -1 : 0},${s.italic ? -1 : 0},0,0,100,100,${Math.round((s.letterSpacing || 0) * 1000)},0,1,${Math.round((s.outline || 0) * 320) || 2},${Math.round((s.shadow || 0) * 40)},5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

function assTime(ticks) {
  const total = Math.max(0, ticks) / TICKS;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function parseSrt(text) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const [rawStart, rawEnd] = timeLine.split('-->').map((s) => s.trim().split(' ')[0]);
    const index = lines.indexOf(timeLine);
    const body = lines.slice(index + 1).join('\n').trim();
    if (!body) continue;
    cues.push({ start: parseSrtTime(rawStart), end: parseSrtTime(rawEnd), text: body });
  }
  return cues;
}

function parseSrtTime(value) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(String(value));
  if (!m) return 0;
  return Math.round(((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4])) * (TICKS / 1000));
}

export function parseAss(text) {
  const cues = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.startsWith('Dialogue:')) continue;
    const parts = line.slice(9).split(',');
    if (parts.length < 10) continue;
    const start = parseAssTime(parts[1]);
    const end = parseAssTime(parts[2]);
    const body = parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues;
}

function parseAssTime(value) {
  const m = /(\d+):(\d+):(\d+)[.](\d+)/.exec(String(value).trim());
  if (!m) return 0;
  return Math.round(((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 100 + Number(m[4])) * (TICKS / 100));
}

/* Convert transcription words into sentence-level cues with word timings. */
export function wordsToCues(words, { maxChars = 84, maxDuration = seconds(6), gap = seconds(0.35) } = {}) {
  const cues = [];
  let current = null;
  const sorted = (words || []).filter((w) => w && w.text).sort((a, b) => a.start - b.start);
  for (const word of sorted) {
    const text = String(word.text).trim();
    if (!text) continue;
    if (!current) current = { start: word.start, end: word.end, words: [] };
    const nextText = `${current.words.map((w) => w.text).join(' ')} ${text}`.trim();
    const tooLong = nextText.length > maxChars || word.end - current.start > maxDuration;
    if (tooLong && current.words.length) {
      cues.push({ start: current.start, end: current.end, text: current.words.map((w) => w.text).join(' '), words: current.words });
      current = { start: word.start, end: word.end, words: [] };
    }
    current.words.push({ text, start: word.start, end: word.end });
    current.end = word.end;
    if (/[.!?]$/.test(text) && word.end - current.start > gap) {
      cues.push({ start: current.start, end: current.end, text: current.words.map((w) => w.text).join(' '), words: current.words });
      current = null;
    }
  }
  if (current?.words.length) cues.push({ start: current.start, end: current.end, text: current.words.map((w) => w.text).join(' '), words: current.words });
  return cues;
}

/* ------------------------------------------------------------------------- */
/* Audio                                                                     */
/* ------------------------------------------------------------------------- */

export const AUDIO_LICENSES = ['CC0', 'CC-BY', 'CC-BY-SA', 'Royalty-free', 'Original', 'Unknown'];

export function normalizeAudioCatalog(entries = []) {
  return entries.map((entry) => ({
    id: entry.id || uid('audio'),
    title: String(entry.title || 'Untitled'),
    artist: String(entry.artist || ''),
    category: String(entry.category || 'Music'),
    url: entry.url || null,
    fileId: entry.fileId || null,
    duration: Number(entry.duration) || 0,
    bpm: Number(entry.bpm) || null,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    license: AUDIO_LICENSES.includes(entry.license) ? entry.license : 'Unknown',
    attribution: String(entry.attribution || ''),
  })).filter((entry) => entry.url || entry.fileId);
}

export function duckingGain(clip, otherClips, time) {
  if (!clip.audio?.ducking) return 1;
  let duck = 0;
  for (const other of otherClips) {
    if (other.id === clip.id || other.type !== 'audio') continue;
    if (other.trackId === clip.trackId) continue;
    if (time < other.start || time > other.start + other.duration) continue;
    duck = Math.max(duck, Number(other.audio?.duckingSource ? 1 : 1));
  }
  return 1 - (clip.audio.ducking * duck);
}
