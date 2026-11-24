/* FFmpeg render plan for Cascade Motion.
 *
 * The plan is built from the same canonical project model the browser preview
 * uses. Timing, layer order, transforms, keyframe values, subtitle styles and
 * transition progress follow /public/motion/schema.mjs and particles.mjs.
 *
 * Operations that FFmpeg cannot express exactly are reported in `warnings`
 * instead of being silently dropped; the export dialog surfaces them before a
 * job starts and the job stores them with the result.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  TICKS, toSeconds, animatedTransform, evaluateKeyframes,
  transitionById, subtitleStyleById, effectById, timelineDuration,
} from '../../public/motion/schema.mjs';
import { subtitleAnimation, gradeColor } from '../../public/motion/animations.mjs';
import { EXPORT_PRESETS, CONTAINERS, VIDEO_CODECS, AUDIO_CODECS, codecCompatible } from '../../public/motion/schema.mjs';

const EPS = 1e-6;
const HW_BASE = {
  h264_nvenc: 'libx264', hevc_nvenc: 'libx265', av1_nvenc: 'libaom-av1',
  h264_vaapi: 'libx264', hevc_vaapi: 'libx265', av1_vaapi: 'libaom-av1',
  h264_qsv: 'libx264', hevc_qsv: 'libx265', av1_qsv: 'libaom-av1',
  h264_amf: 'libx264', hevc_amf: 'libx265', av1_amf: 'libaom-av1',
};
const softwareBase = (codec) => HW_BASE[codec] || codec;
const HW_ENCODERS = new Set(Object.keys(HW_BASE));
const sec = (ticks) => Math.max(0, Number(ticks) || 0) / TICKS;
const f = (n) => (Math.abs(n) < EPS ? '0' : Number(n).toFixed(6).replace(/0+$/, '').replace(/\.$/, ''));

export function outputDuration(project) {
  return Math.max(1 / project.fps, sec(timelineDuration(project) || project.duration));
}

function trackOrder(project) {
  // The first timeline row is the topmost layer. FFmpeg composites filters in
  // array order, so reverse the rows to match the editor preview.
  return [...project.tracks].reverse().filter((t) => !t.hidden);
}

function clipsFor(project, trackId) {
  return project.clips.filter((c) => c.trackId === trackId && c.enabled !== false).sort((a, b) => a.start - b.start);
}

function nextClip(project, clip) {
  return clipsFor(project, clip.trackId).find((c) => c.start > clip.start + 1);
}

function transitionDuration(clip, side) {
  return Math.min(sec(clip.duration), sec(clip[side]?.duration || 0));
}

/* A layer can be extended past its end so the next clip's crossfade has the
 * outgoing frame underneath it (freeze-frame tpad). */
function layerDuration(project, clip) {
  const out = transitionDuration(clip, 'transitionOut');
  let extra = out;
  const next = nextClip(project, clip);
  if (next && next.start - (clip.start + clip.duration) < TICKS * 0.25) {
    extra = Math.max(extra, transitionDuration(next, 'transitionIn'));
  }
  return sec(clip.duration) + extra;
}

function layerEnable(project, clip) {
  const start = sec(clip.start);
  const next = nextClip(project, clip);
  const nextIn = next && next.start - (clip.start + clip.duration) < TICKS * 0.25 ? transitionDuration(next, 'transitionIn') : 0;
  const out = Math.max(transitionDuration(clip, 'transitionOut'), nextIn);
  return `enable='between(t,${f(start)},${f(start + sec(clip.duration) + out)})'`;
}

/* ------------------------------------------------------------------------- */
/* Colour and effects                                                        */
/* ------------------------------------------------------------------------- */

function eqParams(color) {
  const parts = [];
  const brightness = Number(color.brightness) || 0;
  const contrast = 1 + (Number(color.contrast) || 0);
  const saturation = Math.max(0, 1 + (Number(color.saturation) || 0));
  const gamma = Math.max(0.1, Number(color.gamma) || 1);
  if (brightness) parts.push(`brightness=${f(brightness)}`);
  if (Math.abs(contrast - 1) > EPS) parts.push(`contrast=${f(contrast)}`);
  if (Math.abs(saturation - 1) > EPS) parts.push(`saturation=${f(saturation)}`);
  if (Math.abs(gamma - 1) > EPS) parts.push(`gamma=${f(gamma)}`);
  const exposure = Number(color.exposure) || 0;
  if (exposure) parts.push(`brightness=${f((2 ** exposure) - 1 + brightness)}`);
  return parts.length ? `eq=${parts.join(':')}` : '';
}

function colorBalance(color) {
  const temp = Number(color.temperature) || 0;
  const tint = Number(color.tint) || 0;
  if (!temp && !tint) return '';
  const rs = temp * 0.16 + tint * 0.04;
  const bs = -temp * 0.16 + tint * 0.06;
  const gs = -tint * 0.1;
  return `colorbalance=rs=${f(rs)}:gs=${f(gs)}:bs=${f(bs)}:rm=${f(rs * 0.5)}:gm=${f(gs * 0.5)}:bm=${f(bs * 0.5)}`;
}

function effectFilters(effect, ctx = {}) {
  const preset = effectById(effect.type);
  if (!preset) return { chain: '', warning: `Unknown effect "${effect.type}"` };
  const p = { ...preset.params, ...(effect.params || {}) };
  const w = ctx.width || 1920;
  const h = ctx.height || 1080;
  const px = Math.max(1, Math.round(p.size || p.amount * 20 || 4));
  switch (preset.primitive) {
    case 'filter': {
      const chain = [];
      if (p.blur) chain.push(`gblur=sigma=${f(p.blur)}`);
      if (p.sharpen) chain.push(`unsharp=5:5:${f(p.sharpen)}`);
      if (p.saturation) chain.push(`eq=saturation=${f(1 + p.saturation)}`);
      if (p.brightness) chain.push(`eq=brightness=${f(p.brightness)}`);
      if (p.radial) chain.push(`gblur=sigma=${f((p.blur || 4) * 0.7)}`);
      return { chain: chain.join(','), warning: '' };
    }
    case 'color': {
      const chain = [];
      if (p.sepia) chain.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
      if (p.saturation) chain.push(`eq=saturation=${f(Math.max(0, 1 + p.saturation))}`);
      if (p.contrast) chain.push(`eq=contrast=${f(1 + p.contrast)}`);
      if (p.brightness) chain.push(`eq=brightness=${f(p.brightness)}`);
      if (p.temperature) chain.push(colorBalance({ temperature: p.temperature, tint: p.tint }));
      if (p.cyan || p.magenta) chain.push(`colorbalance=rs=${f(p.magenta * 0.12)}:bs=${f(p.cyan * 0.15)}`);
      if (p.hue) chain.push(`hue=h=${f(p.hue)}:s=1.5`);
      return { chain: chain.join(','), warning: '' };
    }
    case 'vignette': return { chain: `vignette=angle=${f((p.amount || 0.6) * 0.8)}`, warning: '' };
    case 'grain': return { chain: `noise=alls=${Math.round((p.amount || 0.15) * 100)}:allf=t`, warning: '' };
    case 'chroma': return { chain: `rgbashift=rh=${Math.round((p.amount || 0.005) * w)}:bh=-${Math.round((p.amount || 0.005) * w)}`, warning: '' };
    case 'pixelate': return { chain: `pixelize=w=${Math.max(2, Math.round(p.size || 18))}:h=${Math.max(2, Math.round(p.size || 18))}`, warning: '' };
    case 'posterize': return { chain: `posterize=levels=${Math.max(2, Math.round(p.levels || 6))}`, warning: '' };
    case 'edges': return { chain: 'edgedetect=low=0.1:high=0.4', warning: '' };
    case 'emboss': return { chain: 'convolution="0 -1 0 -1 4 -1 0 -1 0"', warning: '' };
    case 'mirror': return { chain: p.axis === 'y' ? 'vflip' : 'hflip', warning: '' };
    case 'glow': {
      const sigma = Math.max(2, Math.round((p.radius || 0.02) * w));
      return { chain: `gblur=sigma=${sigma},unsharp=5:5:0.6`, warning: 'Glow is approximated with blur + sharpening in export' };
    }
    case 'vhs': return { chain: `noise=alls=${Math.round(14 * (p.amount || 0.7))}:allf=t,rgbashift=rh=2:bh=-2,curves=preset=vintage`, warning: '' };
    case 'crt': return { chain: `curves=preset=vintage,noise=alls=8:allf=t`, warning: 'CRT scanlines are previewed; export uses a vintage curve + noise' };
    case 'glitch': return { chain: `rgbashift=rh=${Math.round((p.amount || 0.5) * 12)}:bh=-${Math.round((p.amount || 0.5) * 12)}`, warning: '' };
    case 'datamosh': return { chain: 'tmix=frames=3', warning: '' };
    case 'film': return { chain: `colorbalance=rs=${f(0.1 * (p.warmth || 0.3))}:bs=${f(-0.08)}${p.grain || p.scratches ? `,noise=alls=${Math.round(10 + (p.grain || 0) * 40)}:allf=t` : ''}`, warning: '' };
    case 'comic': return { chain: 'eq=saturation=1.4:contrast=1.3', warning: '' };
    case 'cyberpunk': return { chain: 'colorbalance=rs=.1:bs=.15:rm=.1:bm=.1,eq=saturation=1.5', warning: '' };
    case 'infrared': return { chain: `hue=h=${Math.round(p.hue || 120)}:s=2`, warning: '' };
    case 'trails': return { chain: `tmix=frames=${Math.max(2, Math.min(12, Math.round(p.length || 4)))}:weights='${'1 '.repeat(Math.max(2, Math.min(12, Math.round(p.length || 4)))).trim()}'`, warning: '' };
    case 'scanlines': return { chain: 'curves=preset=vintage', warning: 'Scanlines are preview-only; export applies a vintage curve' };
    case 'invert': return { chain: 'negate', warning: '' };
    case 'strobe':
    case 'flash': return { chain: '', warning: 'Flash/strobe is a time-varying effect; export applies it in the compositor where possible' };
    case 'particles': return { chain: '', warning: `Particle effect "${preset.name}" is rendered by the Motion compositor` };
    case 'shake':
    case 'zoom':
    case 'motion-rotate':
    case 'perspective':
    case 'parallax':
    case 'bounce':
    case 'elastic':
      return { chain: '', warning: `Motion effect "${preset.name}" affects transform animation and is applied at the layer level` };
    case 'shockwave':
    case 'heat':
    case 'flare':
    case 'haze':
    case 'godrays':
    case 'fisheye':
    case 'kaleidoscope':
    case 'distort':
    case 'halftone':
    case 'swirl':
    case 'speedlines':
    case 'hologram':
    case 'neon':
    case 'pixelsort':
    case 'ascii':
    case 'oil':
    case 'sketch':
      return { chain: '', warning: `${preset.name} is a GPU compositor effect; export uses the layer/colour approximation` };
    default:
      return { chain: '', warning: `Effect "${preset.name}" has no FFmpeg equivalent` };
  }
}

function effectsChain(effects, ctx, warnings) {
  const chains = [];
  for (const fx of effects || []) {
    if (fx.enabled === false) continue;
    const out = effectFilters(fx, ctx);
    if (out.chain) chains.push(out.chain);
    if (out.warning) warnings.push(out.warning);
  }
  return chains.join(',');
}

function motionFilter(effect, ctx) {
  if (!effect) return '';
  const p = effect.params || {};
  if (effect.type === 'camera-shake' || effect.type === 'handheld' || effect.type === 'earthquake' || effect.type === 'whip-pan') {
    return `crop=iw-2*${Math.max(2, Math.round((p.amount || 0.01) * ctx.width))}:ih-2*${Math.max(2, Math.round((p.amount || 0.01) * ctx.height))}:${Math.round((p.amount || 0.01) * ctx.width)}:${Math.round((p.amount || 0.01) * ctx.height)}`;
  }
  return '';
}

/* ------------------------------------------------------------------------- */
/* ASS subtitles and titles                                                  */
/* ------------------------------------------------------------------------- */

function assColor(hex, alpha = 0) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '#ffffff'));
  const int = m ? parseInt(m[1], 16) : 0xffffff;
  /* libass alpha is inverted: 00 is opaque and FF is transparent. */
  const a = Math.round((1 - Math.min(1, Math.max(0, alpha))) * 255).toString(16).padStart(2, '0');
  const b = (int & 255).toString(16).padStart(2, '0');
  const g = ((int >> 8) & 255).toString(16).padStart(2, '0');
  const r = ((int >> 16) & 255).toString(16).padStart(2, '0');
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function assTime(ticks) {
  const total = Math.max(0, ticks) / TICKS;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAss(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, '\\N');
}

function animationTags(animation, duration, width, height, x, y, style = {}) {
  const d = Math.max(1, Math.round(duration * 100));
  const tags = [];
  const named = String(animation || 'fade-in');
  if (named === 'fade-in' || named === 'fade') tags.push(`\\fad(${Math.min(600, Math.round(duration * 500))},${Math.min(400, Math.round(duration * 300))})`);
  else if (named === 'slide-in-left') tags.push(`\\move(${Math.round(x - width * 0.18)},${Math.round(y)},${Math.round(x)},${Math.round(y)},0,${Math.min(700, d)})`);
  else if (named === 'slide-in-right') tags.push(`\\move(${Math.round(x + width * 0.18)},${Math.round(y)},${Math.round(x)},${Math.round(y)},0,${Math.min(700, d)})`);
  else if (named === 'slide-in-top') tags.push(`\\move(${Math.round(x)},${Math.round(y - height * 0.2)},${Math.round(x)},${Math.round(y)},0,${Math.min(700, d)})`);
  else if (named === 'pop-in' || named === 'pop') tags.push(`\\fscx0\\fscy0\\t(0,${Math.min(260, d)},\\fscx100\\fscy100)`);
  else if (named === 'zoom-in' || named === 'zoom') tags.push(`\\fscx20\\fscy20\\fad(120,0)\\t(0,${Math.min(320, d)},\\fscx100\\fscy100)`);
  else if (named === 'tracking-in') tags.push(`\\fad(200,200)\\t(0,${Math.min(800, d)},\\fsp4)`);
  else if (named === 'glitch') tags.push(`\\fad(120,200)\\t(0,${Math.min(150, d)},\\frz3)\\t(${Math.min(150, d)},${Math.min(300, d)},\\frz-2)\\t(${Math.min(300, d)},${Math.min(450, d)},\\frz0)`);
  else if (named === 'blur-to-sharp' || named === 'blur-in') tags.push(`\\blur6\\fad(150,200)\\t(0,${Math.min(500, d)},\\blur0)`);
  else if (named === 'dramatic-fade') tags.push(`\\fad(${Math.min(1000, d)},${Math.min(600, d)})`);
  else if (named === 'bounce') tags.push(`\\move(${Math.round(x)},${Math.round(y + height * 0.12)},${Math.round(x)},${Math.round(y)},0,${Math.min(600, d)})`);
  else if (named === 'reveal' || named === 'progressive') tags.push(`\\fad(${Math.min(400, d)},100)`);
  else if (named === 'credits-roll') tags.push(`\\move(${Math.round(x)},${Math.round(height + 40)},${Math.round(x)},${Math.round(-40)},0,${Math.max(1000, d)})`);
  else tags.push(`\\fad(180,180)`);
  return tags.join('');
}

function assAlpha(alpha = 1) {
  const a = Math.round((1 - Math.min(1, Math.max(0, alpha))) * 255).toString(16).padStart(2, '0');
  return `&H${a}&`;
}

/* ASS borders follow glyph contours; a large border turns tightly-spaced title
 * text into a solid pill. Draw the title's background as a real vector box and
 * keep the glyph outline thin. */
function assTextBox({ start, end, x, y, size, lines, color, opacity, padding, lineHeight = 1.15 }) {
  const pad = Math.max(1, Math.round((Number(padding) || 0.012) * size * 3));
  const width = Math.max(size, Math.round(Math.max(...lines.map((line) => line.length), 1) * size * 0.68) + pad * 2);
  const height = Math.max(size, Math.round(lines.length * size * lineHeight) + pad * 2);
  const left = -Math.round(width / 2);
  const right = Math.round(width / 2);
  const top = -Math.round(height / 2);
  const bottom = Math.round(height / 2);
  const B = String.fromCharCode(92);
  return `Dialogue: 0,${start},${end},Cascade,,0,0,0,,{${B}an5${B}pos(${x},${y})${B}p1${B}c${assColor(color, 1)}${B}1a${assAlpha(opacity)}${B}bord0${B}shad0}m ${left} ${top} l ${right} ${top} l ${right} ${bottom} l ${left} ${bottom}}`;
}

function textEvent(clip, project, warnings) {
  const t = clip.text || {};
  const size = Math.max(8, Math.round((Number(t.fontSize) || 0.07) * project.height));
  const x = Math.round((Number(t.x) || 0.5) * project.width);
  const y = Math.round((Number(t.y) || 0.5) * project.height);
  const start = assTime(clip.start);
  const end = assTime(clip.start + clip.duration);
  const tags = [
    `\\an5\\pos(${x},${y})`,
    `\\fs${size}`,
    `\\c${assColor(t.color || '#ffffff', 1)}`,
    t.fontWeight >= 600 ? '\\b1' : '\\b0',
    t.italic ? '\\i1' : '\\i0',
    t.underline ? '\\u1' : '\\u0',
    `\\fsp${Number(t.letterSpacing || 0) * size}`,
    `\\frz${Number(t.rotation || 0)}`,
  ];
  if (t.outline?.width) tags.push(`\\bord${Math.max(1, Math.round(t.outline.width * project.height))}\\3c${assColor(t.outline.color || '#000000', 1)}`);
  if (t.shadow?.blur || t.shadow?.opacity) tags.push(`\\shad${Math.max(1, Math.round((t.shadow?.blur || 0.01) * size * 0.2))}\\4c${assColor(t.shadow?.color || '#000000', t.shadow?.opacity ?? 0.6)}`);
  if (t.gradient) warnings.push('Text gradients are previewed; the exported title uses a solid colour');
  tags.push(animationTags(t.animation, sec(clip.duration), project.width, project.height, x, y, t));
  const content = escapeAss(t.content || '');
  const lines = String(t.content || '').split('\n');
  const bg = t.background?.opacity > 0.01
    ? assTextBox({ start, end, x, y, size, lines, color: t.background.color || '#000000', opacity: t.background.opacity, padding: t.background.padding, lineHeight: t.lineHeight }) + '\n'
    : '';
  return bg + `Dialogue: 1,${start},${end},Cascade,,0,0,0,,{${tags.join('')}}${content}`;
}

function subtitleEvent(clip, project, warnings) {
  const sub = clip.subtitle || {};
  const preset = subtitleStyleById(sub.styleId);
  const s = preset.style;
  const x = Math.round((sub.position?.x ?? s.x) * project.width);
  const y = Math.round((sub.position?.y ?? s.y) * project.height);
  const size = Math.max(8, Math.round((sub.position?.size ?? s.size) * project.height));
  const start = assTime(clip.start);
  const end = assTime(clip.start + clip.duration);
  const tags = [
    `\\an5\\pos(${x},${y})`,
    `\\fs${size}`,
    `\\c${assColor(sub.color || s.color, 1)}`,
    s.weight >= 600 ? '\\b1' : '\\b0',
    `\\fsp${Number(s.letterSpacing || 0) * size}`,
    `\\shad${Math.max(1, Math.round((s.shadow || 0) * size * 0.2))}`,
  ];
  if (s.outline) tags.push(`\\bord${Math.max(1, Math.round(s.outline * project.height))}\\3c${assColor(s.outlineColor || '#000000', 1)}`);
  if (s.glow) warnings.push('Subtitle glow is previewed with canvas shadows; ASS export uses the outline colour');
  tags.push(animationTags(preset.animation, sec(clip.duration), project.width, project.height, x, y, s));
  const words = Array.isArray(sub.words) ? sub.words : [];
  let body = escapeAss(sub.text || words.map((w) => w.text).join(' '));
  const bg = s.bg && (s.bgOpacity ?? 0.8) > 0.01
    ? assTextBox({ start, end, x, y, size, lines: [String(sub.text || words.map((w) => w.text).join(' '))], color: s.bg, opacity: s.bgOpacity ?? 0.8, padding: s.paddingX, lineHeight: s.lineHeight })
    : null;
  if ((preset.animation === 'karaoke' || preset.animation === 'word-highlight' || preset.animation === 'highlight-box') && words.length) {
    const highlight = s.highlight || s.glow || '#22d3ee';
    tags.push(`\\1c${assColor(highlight, 1)}\\2c${assColor(s.color, 1)}`);
    body = words.map((w) => `{\\k${Math.max(1, Math.round(((w.end - w.start) / TICKS) * 100))}}${escapeAss(w.text)}`).join(' ');
  }
  if (preset.animation === 'typewriter') {
    /* ASS has no native typewriter; a blur/scale entrance is the closest
     * single-event approximation. Preview shows the character reveal. */
    warnings.push('Typewriter subtitle presets use a soft entrance in burned-in subtitles');
  }
  return (bg ? bg + '\n' : '') + `Dialogue: 1,${start},${end},Cascade,,0,0,0,,{${tags.join('')}}${body}`;
}

export function buildAss(project, warnings) {
  const lines = [];
  const textTracks = new Set(project.tracks.filter((t) => t.type === 'text' || t.type === 'subtitle').map((t) => t.id));
  const clips = project.clips.filter((c) => textTracks.has(c.trackId) && c.enabled !== false);
  const rank = new Map(project.tracks.map((track, index) => [track.id, index]));
  // ASS paints later events on top. Top timeline rows therefore sort last.
  for (const clip of clips.sort((a, b) => (rank.get(b.trackId) - rank.get(a.trackId)) || (a.start - b.start))) {
    if (clip.type === 'text') lines.push(textEvent(clip, project, warnings));
    else if (clip.type === 'subtitle') lines.push(subtitleEvent(clip, project, warnings));
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${project.width}
PlayResY: ${project.height}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cascade,Noto Sans JP,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
}

/* ------------------------------------------------------------------------- */
/* Audio                                                                     */
/* ------------------------------------------------------------------------- */

function atempoChain(speed) {
  const steps = [];
  let s = speed;
  while (s > 2) { steps.push('atempo=2'); s /= 2; }
  while (s < 0.5) { steps.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > EPS) steps.push(`atempo=${f(s)}`);
  return steps;
}

function audioChain(clip, index, project, warnings) {
  const a = clip.audio || {};
  const start = sec(clip.start);
  const dur = sec(clip.duration);
  const parts = [`[${index}:a]atrim=start=${f(sec(clip.inPoint))}:end=${f(sec(clip.inPoint) + dur * clip.speed)}`, 'asetpts=PTS-STARTPTS'];
  parts.push(...atempoChain(clip.speed).map((x) => x.replace(/^/, '')));
  if (clip.reverse) parts.push('areverse');
  parts.push(`volume=${f(Number(a.gain ?? 1))}`);
  if (a.pan) parts.push(`pan=stereo|c0=${f(Math.cos(((a.pan + 1) * Math.PI) / 4))}*c0|c1=${f(Math.sin(((a.pan + 1) * Math.PI) / 4))}*c1`);
  if (a.eqLow) parts.push(`equalizer=f=120:t=q:w=1:g=${f(a.eqLow)}`);
  if (a.eqMid) parts.push(`equalizer=f=1000:t=q:w=1:g=${f(a.eqMid)}`);
  if (a.eqHigh) parts.push(`equalizer=f=8000:t=q:w=1:g=${f(a.eqHigh)}`);
  if (a.denoise) parts.push('afftdn=nf=-25');
  if (a.enhance) parts.push('dynaudnorm=f=200:g=15');
  if (a.reverb) parts.push(`aecho=0.8:0.9:${Math.round(120 + a.reverb * 500)}:${f(0.3 * a.reverb)}`);
  if (a.echo) parts.push(`aecho=0.8:0.7:${Math.round(80 + a.echo * 300)}:${f(0.4 * a.echo)}`);
  if (a.pitch) {
    parts.push(`asetrate=${Math.round(project.sampleRate * (1 + a.pitch))}`, `aresample=${project.sampleRate}`);
    parts.push(...atempoChain(1 / (1 + a.pitch)));
  }
  if (a.compressor) parts.push(`acompressor=threshold=-${Math.round(10 + a.compressor * 20)}dB:ratio=${f(2 + a.compressor * 6)}:attack=10:release=200`);
  if (a.limiter) parts.push('alimiter=level_in=1:level_out=0.9:limit=0.95');
  if (a.fadeIn) parts.push(`afade=t=in:st=0:d=${f(Math.min(dur, a.fadeIn))}`);
  if (a.fadeOut) parts.push(`afade=t=out:st=${f(Math.max(0, dur - a.fadeOut))}:d=${f(Math.min(dur, a.fadeOut))}`);
  if (a.muted) parts.push('volume=0');
  parts.push(`apad=whole_dur=${f(projectDurationSec(project))}`, `atrim=duration=${f(projectDurationSec(project))}`, `adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)}`);
  if (a.ducking) warnings.push('Audio ducking is applied in preview; export uses the static music gain');
  return parts.join(',');
}

function projectDurationSec(project) {
  return outputDuration(project);
}

/* ------------------------------------------------------------------------- */
/* Plan                                                                      */
/* ------------------------------------------------------------------------- */

export function resolveExportSettings(settings = {}, project) {
  const preset = EXPORT_PRESETS.find((p) => p.id === settings.preset);
  const base = preset ? { ...preset } : {};
  const container = settings.container || base.container || 'mp4';
  const c = CONTAINERS.find((x) => x.id === container) || CONTAINERS[0];
  const requested = settings.videoCodec ?? base.videoCodec ?? c.video[0] ?? null;
  const requestedBase = softwareBase(requested);
  let videoCodec = c.video.includes(requestedBase) ? requestedBase : c.video[0] ?? null;
  const hw = String(settings.hardwareAcceleration || 'cpu');
  const family = videoCodec === 'libx265' ? 'hevc' : videoCodec === 'libaom-av1' ? 'av1' : videoCodec === 'libx264' ? 'h264' : '';
  const hwName = family ? `${family}_${hw.split('_').pop()}` : '';
  if (hw !== 'cpu' && HW_ENCODERS.has(hwName)) videoCodec = hwName;
  const audioCodec = settings.audioCodec ?? (c.audio.includes(base.audioCodec) ? base.audioCodec : c.audio[0] ?? null);
  const width = Math.max(0, Math.round(Number(settings.width) || base.width || project.width));
  const height = Math.max(0, Math.round(Number(settings.height) || base.height || project.height));
  const fps = Math.max(0, Number(settings.fps) || base.fps || project.fps);
  return {
    ...base,
    ...settings,
    container,
    videoCodec,
    audioCodec,
    width,
    height,
    fps,
    crf: settings.crf ?? base.crf ?? null,
    videoBitrate: settings.videoBitrate ?? base.videoBitrate ?? null,
    audioBitrate: settings.audioBitrate ?? base.audioBitrate ?? '192k',
    preset: settings.presetName || base.preset || 'medium',
    channels: Number(settings.channels) || project.channels || 2,
    measure: settings.measure || null,
  };
}

export function validateExport(exportSettings, capabilities) {
  const errors = [];
  const warnings = [];
  const c = CONTAINERS.find((x) => x.id === exportSettings.container);
  if (!c) errors.push(`Unknown container "${exportSettings.container}"`);
  if (c?.video.length && !c.video.includes(softwareBase(exportSettings.videoCodec))) {
    errors.push(`${exportSettings.videoCodec} cannot be stored in ${exportSettings.container}. Use ${c.video.join(', ')}.`);
  }
  if (c?.audio.length && exportSettings.audioCodec && !c.audio.includes(exportSettings.audioCodec)) {
    errors.push(`${exportSettings.audioCodec} cannot be stored in ${exportSettings.container}. Use ${c.audio.join(', ')}.`);
  }
  if (exportSettings.videoCodec && capabilities?.encoders?.length && !capabilities.encoders.includes(exportSettings.videoCodec)) {
    errors.push(`${exportSettings.videoCodec} is not installed in this FFmpeg build. Choose ${VIDEO_CODECS.filter((v) => v.containers.includes(exportSettings.container)).map((v) => v.id).join(', ')}.`);
  }
  if (exportSettings.audioCodec && capabilities?.encoders?.length && !capabilities.encoders.includes(exportSettings.audioCodec)) {
    errors.push(`${exportSettings.audioCodec} is not installed in this FFmpeg build.`);
  }
  if (exportSettings.container === 'mp4' && exportSettings.audioCodec === 'libopus') errors.push('Opus in MP4 is not broadly playable; use WebM or AAC.');
  if (exportSettings.container === 'mp4' && exportSettings.audioCodec === 'flac') errors.push('FLAC in MP4 is not broadly playable; use MKV or AAC.');
  if (exportSettings.channels === 6 && !['eac3', 'libopus', 'flac', 'pcm_s16le'].includes(exportSettings.audioCodec)) {
    errors.push(`5.1 audio needs E-AC-3, Opus, FLAC or PCM; ${exportSettings.audioCodec} will be downmixed.`);
  }
  if (exportSettings.channels === 6 && exportSettings.audioCodec === 'aac') warnings.push('AAC 5.1 is not supported by the managed encoder configuration; sound will be stereo.');
  return { errors, warnings };
}

function curvesFilter(curves = {}) {
  const fmt = (pts) => (pts || []).slice().sort((a, b) => a[0] - b[0]).map(([x, y]) => `${f(x)}/${f(y)}`).join(' ');
  const parts = [];
  for (const [key, name] of [['master', 'master'], ['red', 'r'], ['green', 'g'], ['blue', 'b']]) {
    const pts = fmt(curves[key]);
    if (pts.trim()) parts.push(`${name}='${pts}'`);
  }
  return parts.length ? `curves=${parts.join(':')}` : '';
}

/* Build an FFmpeg expression that follows linear keyframes for a transform
 * property. Times are clip-local; overlay expressions run on the timeline, so
 * keyframes are offset by the clip start. */
function transformExpression(clip, property, basePx, spanPx) {
  const frames = clip.keyframes?.[property];
  if (!Array.isArray(frames) || !frames.length) return String(Math.round(basePx));
  const pts = frames.slice().sort((a, b) => a.t - b.t).map((k) => ({ t: sec(clip.start + k.t), v: Number(k.value) || 0 }));
  if (pts.length === 1) return String(Math.round(basePx + pts[0].v * spanPx));
  let expr = String(Math.round(basePx + pts[pts.length - 1].v * spanPx));
  for (let i = pts.length - 2; i >= 0; i -= 1) {
    const a = pts[i]; const b = pts[i + 1];
    const span = Math.max(1e-6, b.t - a.t);
    const av = Math.round(basePx + a.v * spanPx); const bv = Math.round(basePx + b.v * spanPx);
    expr = `if(lt(t,${f(b.t)}),${av}+(${bv}-${av})*(t-${f(a.t)})/${f(span)},${expr})`;
  }
  return expr;
}

export function buildFilterScript(project, assets, paths, options = {}) {
  const warnings = options.warnings || [];
  const W = Math.max(16, Math.round(project.width));
  const H = Math.max(16, Math.round(project.height));
  const fps = Number(project.fps) || 30;
  const D = outputDuration(project);
  const inputs = [];
  const filters = [];
  const addInput = (assetId, filePath, isImage) => {
    const opts = [];
    if (isImage) opts.push('-loop', '1', '-framerate', String(fps), '-t', f(D));
    inputs.push({ path: filePath, opts });
    return inputs.length - 1;
  };

  const trim = `-t ${f(D)}`;
  filters.push(`color=c=${options.transparent ? 'black@0.0' : (project.background || '#000000').replace('#', '0x')}:s=${W}x${H}:r=${f(fps)}:d=${f(D)}[vbase]`);
  let videoLabel = 'vbase';
  if (options.transparent) {
    filters.push('[vbase]format=rgba[vbase_alpha]');
    videoLabel = 'vbase_alpha';
  }

  const visual = trackOrder(project).filter((t) => ['video', 'overlay', 'effect', 'adjustment'].includes(t.type));
  for (const track of visual) {
    if (track.type === 'effect' || track.type === 'adjustment') {
      /* Adjustment layers are full-frame by definition. Apply their colour and
       * effects to the composite while they are active; partial-mask
       * adjustments are listed as a limitation. */
      const clips = clipsFor(project, track.id);
      for (const clip of clips) {
        const chain = [];
        const eq = eqParams(clip.color || {});
        if (eq) chain.push(eq);
        const cb = colorBalance(clip.color || {});
        if (cb) chain.push(cb);
        const fx = effectsChain(clip.effects, { width: W, height: H }, warnings);
        if (fx) chain.push(fx);
        if (!chain.length) continue;
        const out = `adj_${clip.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        filters.push(`[${videoLabel}]${chain.join(',')},format=yuv420p[${out}]`);
        videoLabel = out;
      }
      continue;
    }
    const clips = clipsFor(project, track.id);
    for (const clip of clips) {
      const asset = (assets || []).find((a) => a.id === clip.assetId);
      if (clip.type === 'text' || clip.type === 'subtitle') continue;
      if (clip.type === 'composition') {
        warnings.push('Nested compositions are composited in preview but not yet flattened by the FFmpeg renderer');
        continue;
      }
      if (!asset) {
        warnings.push(`Clip "${clip.name}" has no media asset`);
        continue;
      }
      const filePath = paths[asset.id];
      if (!filePath || !fs.existsSync(filePath)) {
        warnings.push(`Media for "${clip.name}" is missing on this server`);
        continue;
      }
      const idx = addInput(asset.id, filePath, asset.kind === 'image');
      const meta = asset.meta || {};
      const tr = animatedTransform(clip, 0);
      const srcW = Number(meta.width) || W;
      const srcH = Number(meta.height) || H;
      const fit = Math.min(W / srcW, H / srcH);
      const sc = (Number(tr.scale) || 1) * (Number(tr.scaleX) || 1);
      const outW = Math.max(2, Math.round(srcW * fit * sc));
      const outH = Math.max(2, Math.round(srcH * fit * sc * (tr.scaleY || 1)));
      const baseX = W / 2 - outW * (tr.anchorX ?? 0.5);
      const baseY = H / 2 - outH * (tr.anchorY ?? 0.5);
      const x = Math.round(W * (Number(tr.x) || 0) + baseX);
      const y = Math.round(H * (Number(tr.y) || 0) + baseY);
      const xExpr = transformExpression(clip, 'x', baseX, W);
      const yExpr = transformExpression(clip, 'y', baseY, H);
      const dur = sec(clip.duration);
      const chain = [];
      const srcIn = sec(clip.inPoint);
      if (clip.type === 'image') {
        chain.push(`trim=duration=${f(dur)}`, 'setpts=PTS-STARTPTS');
      } else if (clip.freeze) {
        chain.push(`trim=start=${f(srcIn)}:end=${f(srcIn + 1 / fps)}`, 'setpts=PTS-STARTPTS', 'loop=loop=-1:size=1:start=0', `trim=duration=${f(dur)}`, 'setpts=N/FRAME_RATE/TB');
      } else {
        chain.push(`trim=start=${f(srcIn)}:end=${f(srcIn + dur * clip.speed)}`);
        if (clip.reverse) chain.push('reverse');
        chain.push('setpts=PTS-STARTPTS');
        if (Math.abs(clip.speed - 1) > EPS) chain.push(`setpts=PTS/${f(clip.speed)}`);
      }
      chain.push(`fps=${f(fps)}`, `scale=${outW}:${outH}:flags=lanczos`, 'format=rgba');
      /* Shift the source to its timeline position. The transparent layer below
       * is also padded to that point so overlay has frames before the clip. */
      chain.push(`setpts=PTS+${f(sec(clip.start))}/TB`);
      if (clip.crop?.left || clip.crop?.right || clip.crop?.top || clip.crop?.bottom) {
        const cw = Math.max(2, Math.round(outW * (1 - (clip.crop.left || 0) - (clip.crop.right || 0))));
        const ch = Math.max(2, Math.round(outH * (1 - (clip.crop.top || 0) - (clip.crop.bottom || 0))));
        chain.push(`crop=${cw}:${ch}:${Math.round(outW * (clip.crop.left || 0))}:${Math.round(outH * (clip.crop.top || 0))}`);
      }
      if (tr.rotation) chain.push(`rotate=${f((tr.rotation * Math.PI) / 180)}:ow=rotw(${f((tr.rotation * Math.PI) / 180)}):oh=roth(${f((tr.rotation * Math.PI) / 180)}):c=none`);
      const grade = clip.color || {};
      let lutPath = grade.lut?.path || null;
      if (!lutPath && Array.isArray(grade.lut?.data) && grade.lut?.size && options.jobDir) {
        const digest = crypto.createHash('sha1').update(JSON.stringify(grade.lut)).digest('hex').slice(0, 16);
        lutPath = path.join(options.jobDir, `lut-${digest}.cube`);
        if (!fs.existsSync(lutPath)) {
          const rows = ['TITLE "Cascade Motion LUT"', `LUT_3D_SIZE ${grade.lut.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
          for (const entry of grade.lut.data) rows.push(entry.map((v) => f(Number(v))).join(' '));
          fs.writeFileSync(lutPath, rows.join('\n') + '\n', 'utf8');
        }
      }
      if (lutPath) chain.push(`lut3d=file='${String(lutPath).replace(/[\\']/g, '')}'`);
      else if (grade.lut?.fileId) warnings.push(`LUT for "${clip.name}" is not a local .cube file`);
      if (lutPath && Number(grade.lutIntensity ?? 1) !== 1) warnings.push(`LUT intensity on "${clip.name}" is previewed; export applies the LUT at full strength`);
      const curves = curvesFilter(grade.curves);
      if (curves) chain.push(curves);
      if (grade.selective?.length) warnings.push(`Selective colour on "${clip.name}" is previewed with the canvas compositor; export applies the base grade only`);
      if (grade.lift?.some((v) => v) || grade.gain?.some((v) => Math.abs(v - 1) > 0.001) || grade.gammaRGB?.some((v) => Math.abs(v - 1) > 0.001)) warnings.push(`Lift/gamma/gain on "${clip.name}" is previewed; export uses exposure and RGB curves only`);
      if (clip.keyframes?.color || clip.keyframes?.exposure || clip.keyframes?.effect) warnings.push(`Animated colour on "${clip.name}" is exported at its first-frame grade`);
      const eq = eqParams(grade);
      if (eq) chain.push(eq);
      const cb = colorBalance(grade);
      if (cb) chain.push(cb);
      if (grade.hue) chain.push(`hue=h=${f(grade.hue)}`);
      const fx = effectsChain(clip.effects, { width: W, height: H }, warnings);
      if (fx) chain.push(fx);
      const animatedTransformProps = ['scale', 'scaleX', 'scaleY', 'rotation', 'opacity'].filter((key) => clip.keyframes?.[key]?.length);
      if (animatedTransformProps.length) warnings.push(`Animated ${animatedTransformProps.join(', ')} on "${clip.name}" uses the first-frame value in export`);
      const animatedEffects = (clip.effects || []).some((fx) => Object.values(fx.keyframes || {}).some((frames) => Array.isArray(frames) && frames.length));
      if (animatedEffects) warnings.push(`Animated effect parameters on "${clip.name}" use their first-frame values in export`);
      const motion = (clip.effects || []).map((e) => motionFilter(e, { width: W, height: H })).filter(Boolean).join(',');
      if (motion) chain.push(motion);
      if (tr.opacity < 1) chain.push(`colorchannelmixer=aa=${f(tr.opacity)}`);
      if (clip.mask?.shape && clip.mask.shape !== 'none') {
        warnings.push(`Mask on "${clip.name}" is previewed with canvas compositing; export uses a rectangular crop`);
      }
      chain.push('setsar=1');
      const label = `c${clip.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      filters.push(`[${idx}:v]${chain.join(',')}[${label}src]`);
      const layerDur = layerDuration(project, clip);
      filters.push(`color=c=black@0.0:s=${W}x${H}:r=${f(fps)}:d=${f(sec(clip.start) + layerDur)}[${label}bg]`);
      const xArg = clip.keyframes?.x?.length ? `'${xExpr}'` : String(x);
      const yArg = clip.keyframes?.y?.length ? `'${yExpr}'` : String(y);
      filters.push(`[${label}bg][${label}src]overlay=x=${xArg}:y=${yArg}:format=auto:eof_action=pass:shortest=1[${label}raw]`);
      const transIn = clip.transitionIn ? transitionById(clip.transitionIn.type) : null;
      const td = clip.transitionIn ? Math.min(dur, sec(clip.transitionIn.duration)) : 0;
      const animate = [];
      if (transIn && td > 0) {
        if (['fade', 'dip'].includes(transIn.engine)) animate.push(`fade=t=in:st=${f(sec(clip.start))}:d=${f(td)}:alpha=1`);
        if (transIn.engine === 'slide' || transIn.engine === 'cover') {
          /* Translate during the transition; the layer is already padded to the
           * full frame, so use a crop/pad pair to keep the canvas size. */
          const dir = transIn.params?.dir || 'left';
          const sign = dir === 'left' || dir === 'up' ? 1 : -1;
          const axis = dir === 'left' || dir === 'right' ? 'x' : 'y';
          const st = f(sec(clip.start));
          if (axis === 'x') animate.push(`crop=iw:ih:x='if(lt(t,${f(sec(clip.start) + td)}),${sign}*iw*(1-(t-${st})/${f(td)}),0)':y=0`);
          else animate.push(`crop=iw:ih:x=0:y='if(lt(t,${f(sec(clip.start) + td)}),${sign}*ih*(1-(t-${st})/${f(td)}),0)'`);
        }
        if (transIn.engine === 'spin') animate.push(`rotate='if(lt(t,${f(sec(clip.start) + td)}),(1-(t-${f(sec(clip.start))})/${f(td)})*2*PI,0)':ow=iw:oh=ih:c=none`);
        if (transIn.engine === 'blur') animate.push(`gblur=sigma='max(0,${f((transIn.params?.amount || 0.3) * 20)}*(1-(t-${f(sec(clip.start))})/${f(td)}))'`);
        if (transIn.engine === 'glitch') animate.push(`rgbashift=rh='if(lt(t,${f(sec(clip.start) + td)}),${Math.round((transIn.params?.shift || 0.05) * W)},0)':bh='if(lt(t,${f(sec(clip.start) + td)}),-${Math.round((transIn.params?.shift || 0.05) * W)},0)'`);
        if (transIn.engine === 'pixelate') animate.push(`pixelize=w='if(lt(t,${f(sec(clip.start) + td)}),${Math.max(2, Math.round(transIn.params?.size || 32))},1)':h='if(lt(t,${f(sec(clip.start) + td)}),${Math.max(2, Math.round(transIn.params?.size || 32))},1)'`);
      }
      const transOut = clip.transitionOut ? transitionById(clip.transitionOut.type) : null;
      const tod = clip.transitionOut ? Math.min(dur, sec(clip.transitionOut.duration)) : 0;
      if (transOut && tod > 0) animate.push(`fade=t=out:st=${f(sec(clip.start) + Math.max(0, dur - tod))}:d=${f(tod)}:alpha=1`);
      if (animate.length) filters.push(`[${label}raw]${animate.join(',')},setsar=1[${label}]`);
      else filters.push(`[${label}raw]setsar=1[${label}]`);
      const outLabel = `v_${clip.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      filters.push(`[${videoLabel}][${label}]overlay=0:0:format=auto:eof_action=pass:${layerEnable(project, clip)}[${outLabel}]`);
      videoLabel = outLabel;
    }
  }

  const textClips = project.clips.filter((c) => {
    const track = project.tracks.find((t) => t.id === c.trackId);
    return track && (track.type === 'text' || track.type === 'subtitle') && c.enabled !== false;
  });
  filters.push(`[${videoLabel}]format=${options.transparent ? 'yuva420p' : 'yuv420p'}[vout_pre]`);

  /* Audio */
  const audioClips = options.videoOnly ? [] : project.clips.filter((c) => c.type === 'audio' || (c.type === 'video' && c.audio && !c.audio.muted));
  const audioLabels = [];
  if (!options.videoOnly) for (const clip of audioClips) {
    const asset = (assets || []).find((a) => a.id === clip.assetId);
    if (!asset) continue;
    const filePath = paths[asset.id];
    if (!filePath || !fs.existsSync(filePath)) continue;
    if (!asset.meta?.hasAudio && asset.kind !== 'audio') continue;
    const idx = addInput(asset.id + '_audio', filePath, false);
    const label = `a${audioLabels.length + 1}`;
    filters.push(`${audioChain(clip, idx, project, warnings)}[${label}]`);
    audioLabels.push(label);
  }
  if (!options.videoOnly) {
    if (audioLabels.length) {
      filters.push(audioLabels.map((l) => `[${l}]`).join('') + `amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0:duration=longest[mix]`);
    } else {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=${project.sampleRate}:duration=${f(D)}[mix]`);
    }
    const master = project.master || {};
    const masterChain = [`volume=${f(Number(master.volume ?? 1))}`];
    if (Number(master.fadeIn)) masterChain.push(`afade=t=in:st=0:d=${f(Math.min(D, master.fadeIn))}`);
    if (Number(master.fadeOut)) masterChain.push(`afade=t=out:st=${f(Math.max(0, D - master.fadeOut))}:d=${f(Math.min(D, master.fadeOut))}`);
    if (master.limiter !== false) masterChain.push(`alimiter=level_in=1:level_out=${f(10 ** ((master.limiterCeiling ?? -1) / 20))}:limit=0.95`);
    masterChain.push(`aresample=${project.sampleRate}`);
    filters.push(`[mix]${masterChain.join(',')}[aout]`);
  }

  return {
    filterScript: filters.join(';\n') + ';\n',
    inputs,
    warnings,
    duration: D,
    width: W,
    height: H,
    fps,
    ass: buildAss(project, warnings),
    textClips: textClips.length,
    audioClips: audioLabels.length,
    trimArgs: trim,
  };
}

export function buildCommand(project, assets, paths, settings, options = {}) {
  const exportSettings = resolveExportSettings(options.exportSettings || {}, project);
  const outPath = options.outputPath;
  const dir = options.jobDir || path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const plan = buildFilterScript(project, assets, paths, { warnings: [...(options.warnings || [])], jobDir: dir, videoOnly: !!options.videoOnly });
  const c = CONTAINERS.find((x) => x.id === exportSettings.container) || CONTAINERS[0];
  const validation = validateExport(exportSettings, settings.capabilities);
  if (validation.errors.length) throw new Error(validation.errors.join(' '));
  plan.warnings.push(...validation.warnings);
  const args = ['-y', '-v', 'error', '-hide_banner', '-progress', 'pipe:1', '-nostats'];
  for (const input of plan.inputs) args.push(...input.opts, '-i', input.path);
  let filterScript = plan.filterScript;
  let assFile = null;
  if (plan.textClips) {
    assFile = path.join(dir, 'subtitles.ass');
    fs.writeFileSync(assFile, plan.ass, 'utf8');
    if (settings.capabilities?.subtitles === false) {
      plan.warnings.push('This FFmpeg build lacks libass; titles and subtitles were not burned in');
      filterScript += '\n[vout_pre]null[vout];';
    } else {
      filterScript += '\n[vout_pre]subtitles=filename=subtitles.ass[vout];';
    }
  } else {
    filterScript = filterScript.replace('[vout_pre]', '[vout]');
  }
  let videoMap = 'vout';
  if (Number(exportSettings.width) && Number(exportSettings.height)
    && (Number(exportSettings.width) !== project.width || Number(exportSettings.height) !== project.height)) {
    filterScript += `\n[vout]scale=${Math.round(exportSettings.width)}:${Math.round(exportSettings.height)}:flags=lanczos[vout_scaled];`;
    videoMap = 'vout_scaled';
  }
  if (String(exportSettings.videoCodec).endsWith('_vaapi')) {
    filterScript += `\n[${videoMap}]format=nv12,hwupload[vout_hw];`;
    videoMap = 'vout_hw';
    args.unshift('-vaapi_device', '/dev/dri/renderD128');
  }
  fs.writeFileSync(path.join(dir, 'filter.txt'), filterScript, 'utf8');
  args.push('-filter_complex_script', path.join(dir, 'filter.txt'), '-map', `[${videoMap}]`, '-map', '[aout]');
  const fps = exportSettings.fps || project.fps;
  args.push('-r', f(fps));
  if (options.range) args.push('-ss', f(options.range.start || 0), '-t', f(options.range.duration || plan.duration));
  else args.push('-t', f(options.duration || plan.duration));
  if (exportSettings.videoCodec) {
    args.push('-c:v', exportSettings.videoCodec);
    const codec = exportSettings.videoCodec;
    if (['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'hevc_qsv', 'h264_amf', 'hevc_amf'].includes(codec)) {
      args.push('-preset', exportSettings.preset || 'medium');
    }
    if (codec.endsWith('_nvenc')) {
      if (exportSettings.videoBitrate && exportSettings.videoBitrate !== '0') args.push('-rc', 'vbr', '-b:v', String(exportSettings.videoBitrate));
      args.push('-cq', String(exportSettings.crf ?? 20));
    } else if (codec.endsWith('_qsv') || codec.endsWith('_vaapi')) {
      args.push('-global_quality', String(exportSettings.crf ?? 20));
      if (exportSettings.videoBitrate && exportSettings.videoBitrate !== '0') args.push('-b:v', String(exportSettings.videoBitrate));
    } else if (codec.endsWith('_amf')) {
      args.push('-quality', 'balanced');
      if (exportSettings.videoBitrate && exportSettings.videoBitrate !== '0') args.push('-b:v', String(exportSettings.videoBitrate));
      else args.push('-rc', 'cqp', '-qp_i', String(exportSettings.crf ?? 20), '-qp_p', String(exportSettings.crf ?? 20));
    } else if (exportSettings.crf != null && (!exportSettings.videoBitrate || exportSettings.videoBitrate === '0')) args.push('-crf', String(exportSettings.crf));
    else if (exportSettings.videoBitrate && exportSettings.videoBitrate !== '0') args.push('-b:v', String(exportSettings.videoBitrate));
    else args.push('-crf', '20');
    args.push('-pix_fmt', 'yuv420p');
    if (exportSettings.videoCodec.includes('265') || exportSettings.videoCodec.includes('hevc')) args.push('-tag:v', 'hvc1');
  } else {
    args.push('-vn');
  }
  if (exportSettings.audioCodec) {
    args.push('-c:a', exportSettings.audioCodec);
    if (exportSettings.audioBitrate && exportSettings.audioBitrate !== '0') args.push('-b:a', exportSettings.audioBitrate);
    args.push('-ac', String(exportSettings.channels === 6 ? 6 : Math.min(2, exportSettings.channels || 2)));
    args.push('-ar', String(project.sampleRate || 48000));
  } else args.push('-an');
  if (c.id === 'mp4' || c.id === 'mov') args.push('-movflags', '+faststart');
  args.push('-metadata', `title=${String(project.name || 'Cascade Motion').slice(0, 100)}`);
  args.push(outPath);
  return { args, plan, exportSettings, warnings: plan.warnings, outputPath: outPath, cwd: dir, assFile };
}
