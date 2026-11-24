/* CPU particle rasterizer used only by the export worker. It consumes the same
 * deterministic sampler as the browser preview and streams RGBA frames into
 * FFmpeg as a transparent WebM layer. No canvas/DOM dependency, so long jobs
 * stay in a bounded worker process and seek/export remain reproducible. */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { sampleParticles, hexToRgb } from '../../public/motion/particles.mjs';
import { effectById, TICKS } from '../../public/motion/schema.mjs';
import { binary } from './ffmpeg.js';

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function blendPixel(buf, x, y, rgba, additive) {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return;
  const i = (y * buf.width + x) * 4;
  const a = rgba[3];
  if (a <= 0) return;
  if (additive) {
    buf.data[i] = Math.min(255, buf.data[i] + rgba[0] * a);
    buf.data[i + 1] = Math.min(255, buf.data[i + 1] + rgba[1] * a);
    buf.data[i + 2] = Math.min(255, buf.data[i + 2] + rgba[2] * a);
    buf.data[i + 3] = Math.min(255, buf.data[i + 3] + a * 255);
  } else {
    const da = buf.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    buf.data[i] = (rgba[0] * a + buf.data[i] * da * (1 - a)) / oa;
    buf.data[i + 1] = (rgba[1] * a + buf.data[i + 1] * da * (1 - a)) / oa;
    buf.data[i + 2] = (rgba[2] * a + buf.data[i + 2] * da * (1 - a)) / oa;
    buf.data[i + 3] = oa * 255;
  }
}

function drawDisc(buf, cx, cy, radius, color, alpha, additive) {
  const r = Math.max(0.7, radius);
  const [cr, cg, cb] = hexToRgb(color);
  const minX = Math.floor(cx - r); const maxX = Math.ceil(cx + r);
  const minY = Math.floor(cy - r); const maxY = Math.ceil(cy + r);
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > r) continue;
    const falloff = 1 - d / r;
    blendPixel(buf, x, y, [cr, cg, cb, alpha * falloff * falloff], additive);
  }
}

function drawLine(buf, x1, y1, x2, y2, width, color, alpha, additive) {
  const [cr, cg, cb] = hexToRgb(color);
  const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / Math.max(0.5, width * 0.4)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    blendPixel(buf, Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), [cr, cg, cb, alpha], additive);
  }
}

function frameAt(params, time, W, H, seed, aspect) {
  const buf = { width: W, height: H, data: new Uint8Array(W * H * 4) };
  const particles = sampleParticles(params, time, { seed, aspect });
  for (const p of particles) {
    const additive = p.additive || params.blend === 'add';
    if (p.kind === 'bolt') {
      const pts = p.points || [];
      for (let i = 1; i < pts.length; i += 1) {
        drawLine(buf, pts[i - 1][0] * W, pts[i - 1][1] * H, pts[i][0] * W, pts[i][1] * H, Math.max(1, p.width * H), p.color, p.alpha, true);
      }
    } else if (p.kind === 'spark' || p.streak) {
      const vx = (p.vx || 0) * W * 0.04;
      const vy = Math.max(4, (p.vy || 0.2) * H * 0.04);
      drawLine(buf, p.x * W, p.y * H, p.x * W - vx, p.y * H - vy, Math.max(1, p.size * H * 0.3), p.color, p.alpha, additive);
    } else {
      drawDisc(buf, p.x * W, p.y * H, Math.max(0.7, p.size * H), p.color, p.alpha, additive);
    }
  }
  return buf;
}

export async function renderParticleLayer({ effect, clip, project, outputPath, settings, fps }) {
  const preset = effectById(effect.type);
  if (!preset) throw new Error(`unknown effect ${effect.type}`);
  const params = { ...preset.params, ...(effect.params || {}), preset: effect.params?.preset || preset.params?.preset || effect.type };
  const W = Math.max(16, Math.round(project.width));
  const H = Math.max(16, Math.round(project.height));
  const rate = Math.max(1, Math.min(120, Number(fps) || project.fps || 30));
  const duration = Math.max(1 / rate, (Number(clip.duration) || 0) / TICKS);
  const frames = Math.max(1, Math.round(duration * rate));
  const seed = hashSeed(`${clip.id}:${effect.id}`);
  const bin = binary(settings);
  const args = [
    '-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`,
    '-framerate', String(rate), '-i', 'pipe:0', '-an', '-c:v', 'qtrle', '-pix_fmt', 'argb', outputPath,
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c) => { err = (err + c).slice(-4000); });
    child.on('error', reject);
    child.stdin.on('error', () => { /* encoder closed early; close handler reports the real error */ });
    child.on('close', (code) => { if (code === 0) resolve(); else reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `particle encoder exited ${code}`)); });
    let frame = 0;
    const writeNext = () => {
      if (frame >= frames) { child.stdin.end(); return; }
      const buf = frameAt(params, frame / rate, W, H, seed, W / H);
      frame += 1;
      if (!child.stdin.write(Buffer.from(buf.data))) child.stdin.once('drain', writeNext);
      else setImmediate(writeNext);
    };
    writeNext();
  });
  return { path: outputPath, width: W, height: H, duration, fps: rate };
}

export async function renderParticleEffects({ project, settings, jobDir, warnings }) {
  const assets = [];
  const paths = {};
  const clips = [];
  const tracks = [...project.tracks];
  let index = 0;
  for (const clip of project.clips) {
    const particleEffects = (clip.effects || []).filter((fx) => fx.enabled !== false && effectById(fx.type)?.primitive === 'particles');
    if (!particleEffects.length) continue;
    for (const effect of particleEffects) {
      index += 1;
      const id = `particle_${index}`;
      const file = `${id}.mov`;
      try {
        const out = `${jobDir}/${file}`;
        await renderParticleLayer({ effect, clip, project, outputPath: out, settings, fps: project.fps });
        if (!fs.existsSync(out) || fs.statSync(out).size < 1000) throw new Error('particle layer was empty');
        assets.push({ id, kind: 'video', meta: { width: project.width, height: project.height, duration: clip.duration / TICKS, hasAudio: false }, name: effect.type });
        paths[id] = out;
        clips.push({
          id: `fxclip_${index}`, trackId: 'fx_track', type: 'video', name: presetName(effect.type),
          start: clip.start, duration: clip.duration, inPoint: 0, speed: 1, assetId: id,
          transform: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
          color: {}, audio: { muted: true }, effects: [], keyframes: {}, enabled: true,
        });
      } catch (err) {
        warnings.push(`Particle effect ${effect.type} could not be rendered to video: ${err.message}`);
      }
    }
  }
  if (!assets.length) return null;
  // Track 0 is the top visual layer; the particle overlay belongs above the
  // footage it decorates, matching the live preview compositor.
  tracks.unshift({ id: 'fx_track', type: 'overlay', name: 'Particles', hidden: false, muted: true, locked: false, opacity: 1, volume: 1, effects: [], height: 54 });
  return {
    project: { ...project, tracks, clips: [...project.clips, ...clips].map((clip) => ({ ...clip, effects: (clip.effects || []).filter((fx) => effectById(fx.type)?.primitive !== 'particles') })) },
    assets,
    paths,
  };
}

function presetName(type) { return effectById(type)?.name || type; }
