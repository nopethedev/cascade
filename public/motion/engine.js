/* Cascade Motion preview compositor.
 *
 * Canvas2D is the reliable baseline (WebGL2/WebGPU are feature-detected where
 * useful for LUTs, but every operation has a Canvas path). The compositor reads
 * the same project model and presets as the FFmpeg renderer. Preview quality
 * can be lowered; positions, timing, transitions and animation progress do not
 * change with quality. */
import {
  TICKS, clamp, toSeconds, animatedTransform, evaluateKeyframes, trackById, assetById,
  transitionById, subtitleStyleById, effectById, timelineDuration, resolveComposition, frameOf,
} from './schema.mjs';
import { subtitleAnimation, glyphState, applyCube, parseColor, rgba, gradeColor } from './animations.mjs';
import { sampleParticles, seedFromString } from './particles.mjs';

const $ = (s, root = document) => root.querySelector(s);
const MAX_VIDEO_POOL = 12;

export class MotionEngine {
  constructor(options = {}) {
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.project = options.project;
    this.assets = options.assets || [];
    this.assetMap = new Map(this.assets.map((a) => [a.id, a]));
    this.quality = 1;
    this.time = 0;
    this.playing = false;
    this.muted = options.muted || false;
    this.loop = false;
    this.rate = 1;
    this.raf = null;
    this.lastTick = 0;
    this.clockStart = 0;
    this.clockBase = 0;
    this.stats = { fps: 0, dropped: 0, frames: 0, last: 0, audioPeak: 0 };
    this.listeners = new Set();
    this.videos = new Map();
    this.images = new Map();
    this.buffers = new Map();
    this.guides = false;
    this.compareFrame = null;
    this._lastFrame = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.audio = new PreviewAudio(this);
    this._resize();
    this._bindVideoEvents();
  }

  setProject(project) {
    const durationChanged = !this.project || this.project.width !== project.width || this.project.height !== project.height || this.project.fps !== project.fps;
    this.project = project;
    if (durationChanged) this._resize();
    this.invalidate();
  }

  setAssets(assets) {
    this.assets = assets || [];
    this.assetMap = new Map(this.assets.map((a) => [a.id, a]));
    for (const [id, video] of this.videos) {
      if (!this.assetMap.has(id)) { video.pause(); video.remove(); this.videos.delete(id); }
    }
    this.invalidate();
  }

  setQuality(quality) {
    this.quality = clamp(quality, 0.25, 1);
    this._resize();
    this.invalidate();
  }

  setTime(ticks) {
    this.time = clamp(ticks, 0, this.duration);
    this.seekMedia();
    this.invalidate();
  }

  get duration() {
    return Math.max(1, timelineDuration(this.project) || this.project.duration);
  }

  _resize() {
    if (!this.project || !this.canvas) return;
    const W = Math.round(this.project.width * this.quality);
    const H = Math.round(this.project.height * this.quality);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
  }

  invalidate() {
    if (this.playing) return;
    this.renderFrame();
  }

  play() {
    if (this.playing) return;
    if (this.time >= this.duration) this.time = 0;
    this.playing = true;
    this.audio.ensure();
    this.clockBase = performance.now();
    this.clockStart = this.time;
    this.audio.start(this.time);
    this._lastTick = performance.now();
    const loop = (now) => {
      if (!this.playing) return;
      const elapsed = (now - this.clockBase) * this.rate;
      let next = this.clockStart + elapsed * 1000;
      if (next >= this.duration) {
        if (this.loop) {
          this.time = 0;
          this.clockBase = performance.now();
          this.clockStart = 0;
          this.seekMedia(true);
          this.audio.start(0);
          next = 0;
        } else {
          this.time = this.duration;
          this.pause();
          this.renderFrame();
          this.emit();
          return;
        }
      }
      this.time = next;
      this.renderFrame();
      const nowMs = performance.now();
      const delta = nowMs - this._lastTick;
      this._lastTick = nowMs;
      this._fpsAcc += delta;
      this._fpsFrames += 1;
      if (this._fpsAcc > 500) {
        this.stats.fps = Math.round((this._fpsFrames * 1000) / this._fpsAcc);
        this._fpsAcc = 0;
        this._fpsFrames = 0;
      }
      if (delta > 1000 / this.project.fps * 2) this.stats.dropped += 1;
      this.stats.frames += 1;
      this.emit();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    for (const media of this.videos.values()) media.video.pause();
    this.audio.stop();
    this.emit();
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  setRate(rate) {
    this.rate = clamp(rate, 0.25, 4);
    if (this.playing) {
      this.clockStart = this.time;
      this.clockBase = performance.now();
      this.audio.setRate(this.rate);
    }
  }

  setMuted(muted) {
    this.muted = muted;
    this.audio.setMuted(muted);
    this.emit();
  }

  setGuides(on) { this.guides = !!on; this.renderFrame(); }
  setCompare(frame) { this.compareFrame = frame; this.renderFrame(); }

  toggleFullscreen() {
    const el = this.canvas.parentElement || this.canvas;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  }

  seekMedia(force = false) {
    const active = new Set();
    for (const clip of this.project.clips) {
      if (!this.clipActiveAt(clip, this.time)) continue;
      if (!['video', 'audio'].includes(clip.type)) continue;
      const asset = this.assetMap.get(clip.assetId);
      if (!asset) continue;
      const media = this.getMedia(asset, clip.type === 'audio' ? 'audio' : 'video');
      if (!media) continue;
      active.add(media);
      const local = (this.time - clip.start) / TICKS;
      const speed = clip.speed || 1;
      let at = toSeconds(clip.inPoint) + local * speed;
      if (clip.freeze) at = toSeconds(clip.inPoint);
      if (clip.reverse) at = Math.max(0, toSeconds(clip.inPoint) + toSeconds(clip.duration) * speed - local * speed);
      if (force || Math.abs((media.currentTime || 0) - at) > 0.12) {
        try { media.currentTime = Math.max(0, at); } catch { /* metadata not ready */ }
      }
    }
    for (const [id, held] of this.videos) {
      if (!active.has(held.video) && held.video.tagName === 'VIDEO') {
        held.video.pause();
        if (!held.video.closest('.mo-media-thumb')) held.video.remove();
        this.videos.delete(id);
      }
    }
  }

  _bindVideoEvents() {
    this._onSeek = () => this.audio.sync();
  }

  getMedia(asset, kind = 'video') {
    const key = `${kind}:${asset.id}`;
    if (this.videos.has(key)) return this.videos.get(key).video;
    if (!asset || asset.kind === 'image') return null;
    const video = document.createElement(kind === 'audio' ? 'video' : 'video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = true;
    video.src = asset.proxyUrl || asset.url;
    video.load();
    const entry = { video, asset, kind };
    this.videos.set(key, entry);
    if (this.videos.size > MAX_VIDEO_POOL) {
      const [firstKey, first] = this.videos.entries().next().value || [];
      if (firstKey && firstKey !== key) {
        first.video.pause();
        first.video.removeAttribute('src');
        first.video.load();
        this.videos.delete(firstKey);
      }
    }
    return video;
  }

  imageFor(asset) {
    if (!asset?.thumbnailUrl && asset.kind !== 'image') return null;
    const key = `${asset.id}:${asset.thumbnailUrl || asset.url}`;
    if (this.images.has(key)) return this.images.get(key).img;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = asset.kind === 'image' ? asset.url : asset.thumbnailUrl || asset.url;
    const entry = { img, ready: false };
    img.onload = () => { entry.ready = true; if (!this.playing) this.renderFrame(); };
    img.onerror = () => { entry.error = true; };
    this.images.set(key, entry);
    return img;
  }

  buffer(w, h) {
    const key = `${w}x${h}`;
    if (this.buffers.has(key)) return this.buffers.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const entry = { canvas, ctx };
    this.buffers.set(key, entry);
    return entry;
  }

  releaseUnused() {
    const activeAssets = new Set(this.project.clips.filter((c) => Math.abs(c.start - this.time) < 30 * TICKS).map((c) => c.assetId));
    for (const [key, entry] of this.videos) {
      const assetId = key.split(':').slice(1).join(':');
      if (!activeAssets.has(assetId) && this.playing) {
        entry.video.pause();
      }
    }
    if (this.buffers.size > 40) {
      for (const key of [...this.buffers.keys()].slice(0, this.buffers.size - 30)) this.buffers.delete(key);
    }
  }

  clipActiveAt(clip, time) {
    return clip.enabled !== false && clip.start <= time && clip.start + clip.duration > time;
  }

  /* Per-clip transition entrance. The FFmpeg renderer uses the same model: an
   * incoming transition runs from clip.start for its duration and the outgoing
   * clip stays visible underneath for that window. */
  transitionState(clip) {
    const tr = clip.transitionIn;
    if (!tr) return null;
    const preset = transitionById(tr.type);
    if (!preset) return null;
    const dur = Math.min(tr.duration, clip.duration);
    const local = this.time - clip.start;
    if (local < 0 || local >= dur) return null;
    const raw = clamp(local / Math.max(1, dur), 0, 1);
    const eased = ease(tr.easing, raw);
    return { preset, progress: eased, raw, duration: dur };
  }

  renderFrame() {
    const project = this.project;
    if (!project) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.ctx;
    const scale = W / project.width;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.filter = 'none';
    this.ctx.fillStyle = project.background || '#000000';
    this.ctx.fillRect(0, 0, W, H);

    const tracks = project.tracks.filter((t) => !t.hidden);
    // Timeline rows read top-to-bottom, so the first row is the topmost
    // visual layer. Draw the array in reverse: later rows are underneath.
    const visualTracks = [...tracks].reverse();
    for (const track of visualTracks) {
      if (!['video', 'overlay', 'effect'].includes(track.type)) continue;
      const clips = project.clips.filter((c) => c.trackId === track.id && c.enabled !== false && this.clipActiveAt(c, this.time));
      for (const clip of clips) this.drawClip(ctx, draftClip(clip, this.time, project), scale, track);
    }
    // Titles and subtitles are composited over the video layers.
    for (const track of visualTracks) {
      if (!['text', 'subtitle'].includes(track.type)) continue;
      const clips = project.clips.filter((c) => c.trackId === track.id && c.enabled !== false && this.clipActiveAt(c, this.time));
      for (const clip of clips) {
        if (clip.type === 'text') this.drawText(ctx, clip, project, scale);
        else this.drawSubtitle(ctx, clip, project, scale);
      }
    }
    for (const track of visualTracks) {
      if (track.type !== 'audio') continue;
      for (const clip of project.clips.filter((c) => c.trackId === track.id && c.enabled && this.clipActiveAt(c, this.time))) {
        for (const fx of clip.effects || []) if (fx.enabled !== false && effectById(fx.type)?.primitive === 'particles') this.drawParticles(ctx, fx, clip, project, scale);
      }
    }
    this.drawTrackEffects(ctx, project, scale);
    this.drawMarks(ctx, project, W, H);
    if (this.compareFrame) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.compareFrame, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    this.drawGuides(ctx, project, W, H);
    this.audio.update(this.time);
    this.stats.audioPeak = this.audio.peak;
  }

  drawMarks(ctx, project, W, H) {
    if (!this.guides) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
    ctx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
    ctx.beginPath();
    ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.restore();
  }

  drawGuides(ctx, project, W, H) {
    if (this.compareFrame) {
      ctx.save();
      ctx.fillStyle = 'rgba(8,8,10,.8)';
      ctx.fillRect(8, 8, 64, 22);
      ctx.fillStyle = '#fff';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillText('EXPORT', 18, 23);
      ctx.restore();
    }
  }

  /* --------------------------------------------------------------------- */
  /* Layers                                                                */
  /* --------------------------------------------------------------------- */

  drawClip(mainCtx, clip, scale, track) {
    const local = Math.max(0, this.time - clip.start);
    if (clip.type === 'adjustment' || clip.type === 'effect') return;
    if (clip.type === 'composition') { this.drawComposition(mainCtx, clip, scale); return; }
    if (!['video', 'image', 'shape'].includes(clip.type)) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const layer = this.buffer(W, H);
    layer.ctx.clearRect(0, 0, W, H);
    layer.ctx.save();
    layer.ctx.filter = 'none';
    const asset = this.assetMap.get(clip.assetId);
    const tr = animatedTransform(clip, local);
    const opacity = clamp(tr.opacity ?? 1, 0, 1) * clamp(track.opacity ?? 1, 0, 1);
    if (clip.type === 'shape') {
      this.drawShapeLayer(layer.ctx, clip, scale);
    } else if (asset?.kind === 'image') {
      const img = this.imageFor(asset);
      if (img?.complete && img.naturalWidth) this.drawMedia(layer.ctx, img, asset, clip, scale, tr);
    } else if (asset) {
      const video = this.getMedia(asset, 'video');
      if (video && video.readyState >= 2) {
        if (this.playing && video.paused) video.play().catch(() => {});
        if (!this.playing && !video.paused) video.pause();
        this.drawMedia(layer.ctx, video, asset, clip, scale, tr);
      } else if (asset.thumbnailUrl) {
        const img = this.imageFor(asset);
        if (img?.complete) this.drawMedia(layer.ctx, img, asset, clip, scale, tr);
      }
    }
    layer.ctx.restore();
    if (clip.mask?.shape && clip.mask.shape !== 'none') this.applyMask(layer.ctx, W, H, clip, scale);
    this.applyGrade(layer.ctx, layer.canvas, clip, scale, local);
    for (const fx of clip.effects || []) this.applyEffect(layer.ctx, layer.canvas, fx, clip, scale, track, local);
    const tstate = this.transitionState(clip);
    this.compositeLayer(mainCtx, layer.canvas, clip, tr, opacity, tstate, scale);
    if (clip.transitionOut && this.time >= clip.start + clip.duration - clip.transitionOut.duration) {
      const raw = clamp((this.time - (clip.start + clip.duration - clip.transitionOut.duration)) / Math.max(1, clip.transitionOut.duration), 0, 1);
      const preset = transitionById(clip.transitionOut.type);
      this.applyOutro(mainCtx, layer.canvas, preset, raw, scale, clip);
    }
  }

  drawMedia(ctx, media, asset, clip, scale, tr) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const meta = asset.meta || {};
    const sw = media.videoWidth || media.naturalWidth || meta.width || W;
    const sh = media.videoHeight || media.naturalHeight || meta.height || H;
    const fit = Math.min(W / sw, H / sh);
    const scaleFactor = fit * (tr.scale || 1);
    const dw = sw * scaleFactor * (tr.scaleX || 1);
    const dh = sh * scaleFactor * (tr.scaleY || 1);
    const x = W * (tr.x || 0) + W / 2 - dw * (tr.anchorX ?? 0.5);
    const y = H * (tr.y || 0) + H / 2 - dh * (tr.anchorY ?? 0.5);
    ctx.save();
    ctx.translate(x + dw / 2, y + dh / 2);
    if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
    let sx = 0; let sy = 0; let sww = sw; let shh = sh;
    if (clip.crop && (clip.crop.left || clip.crop.right || clip.crop.top || clip.crop.bottom)) {
      sx = sw * (clip.crop.left || 0);
      sy = sh * (clip.crop.top || 0);
      sww = sw * (1 - (clip.crop.left || 0) - (clip.crop.right || 0));
      shh = sh * (1 - (clip.crop.top || 0) - (clip.crop.bottom || 0));
    }
    try { ctx.drawImage(media, sx, sy, sww, shh, -dw / 2, -dh / 2, dw, dh); } catch { /* frame not ready */ }
    ctx.restore();
  }

  drawShapeLayer(ctx, clip, scale) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const p = clip.shape || {};
    ctx.fillStyle = p.fill || '#e11d48';
    const x = W * (p.x ?? 0.1);
    const y = H * (p.y ?? 0.1);
    const w = W * (p.w ?? 0.8);
    const h = H * (p.h ?? 0.8);
    if (p.shape === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
    } else if (p.shape === 'line') {
      ctx.strokeStyle = p.fill || '#ffffff'; ctx.lineWidth = Math.max(1, (p.strokeWidth || 0.004) * H);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.stroke();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  compositeLayer(ctx, layer, clip, tr, opacity, tstate, scale) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    let alpha = opacity;
    let dx = 0; let dy = 0; let rot = 0; let zoom = 1; let clipPath = null; let blur = 0; let extra = null;
    if (tstate) {
      const { preset, progress } = tstate;
      const p = progress;
      const prm = preset.params || {};
      switch (preset.engine) {
        case 'fade': alpha *= p; break;
        case 'dip': alpha *= p; break;
        case 'slide': {
          const dir = prm.dir || 'left';
          if (dir === 'left') dx = (1 - p) * W;
          if (dir === 'right') dx = -(1 - p) * W;
          if (dir === 'up') dy = (1 - p) * H;
          if (dir === 'down') dy = -(1 - p) * H;
          break;
        }
        case 'cover': {
          const dir = prm.dir || 'left';
          if (dir === 'left') clipPath = { x: 0, y: 0, w: W * p, h: H };
          if (dir === 'right') clipPath = { x: W * (1 - p), y: 0, w: W * p, h: H };
          break;
        }
        case 'wipe': clipPath = wipeRect(prm.dir || 'left', p, W, H); break;
        case 'barn': clipPath = barnRect(p, W, H, prm.mode); break;
        case 'zoom': zoom = (prm.from || 0.6) + (1 - (prm.from || 0.6)) * p; alpha *= p; break;
        case 'spin': rot = (1 - p) * Math.PI * 2 * (prm.turns || 1); zoom = (prm.scale || 0.3) + (1 - (prm.scale || 0.3)) * p; alpha *= p; break;
        case 'blur': blur = (1 - p) * (prm.amount || 0.3) * 40; break;
        case 'flash': alpha *= Math.sin(p * Math.PI); extra = prm.color || '#ffffff'; break;
        case 'glitch': alpha *= Math.min(1, p * 2); extra = 'glitch'; break;
        case 'pixelate': extra = { pixelate: Math.max(2, Math.round((prm.size || 24) * (1 - p) + 1)) }; break;
        case 'burn':
        case 'leak': extra = { burn: p, color: preset.engine === 'burn' ? '#fb923c' : `hsl(${prm.hue || 24} 90% 60%)` }; break;
        case 'rgb': extra = { rgb: (1 - p) * (prm.amount || 0.05) }; break;
        case 'shape': clipPath = { shape: prm.shape || 'circle', p, W, H }; break;
        case 'flip': if (prm.axis === 'x') zoom = 1; else zoom = 1; extra = { flip: prm.axis || 'x', p }; break;
        case 'luma': alpha *= p * 0.4 + 0.6 * p; extra = { luma: p }; break;
        default: alpha *= p;
      }
    }
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    if (clipPath) {
      ctx.beginPath();
      if (clipPath.shape === 'circle') ctx.arc(W / 2, H / 2, Math.max(0, clipPath.p) * Math.hypot(W, H) / 2, 0, Math.PI * 2);
      else if (clipPath.shape === 'diamond') { ctx.moveTo(W / 2, H / 2 - clipPath.p * H / 2); ctx.lineTo(W / 2 + clipPath.p * W / 2, H / 2); ctx.lineTo(W / 2, H / 2 + clipPath.p * H / 2); ctx.lineTo(W / 2 - clipPath.p * W / 2, H / 2); ctx.closePath(); }
      else if (clipPath.shape === 'star') starPath(ctx, W / 2, H / 2, Math.max(0, clipPath.p) * Math.min(W, H) / 2, 6);
      else ctx.rect(clipPath.x, clipPath.y, clipPath.w, clipPath.h);
      ctx.clip();
    }
    if (blur) ctx.filter = `blur(${blur}px)`;
    if (extra?.rgb) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = clamp(alpha * 0.45, 0, 1);
      ctx.drawImage(layer, dx - W * extra.rgb, dy, W, H);
      ctx.drawImage(layer, dx + W * extra.rgb, dy, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = clamp(alpha, 0, 1);
    }
    if (extra?.pixelate) {
      const small = this.buffer(Math.max(4, Math.round(W / extra.pixelate)), Math.max(4, Math.round(H / extra.pixelate)));
      small.ctx.clearRect(0, 0, small.canvas.width, small.canvas.height);
      small.ctx.drawImage(layer, 0, 0, small.canvas.width, small.canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small.canvas, dx, dy, W, H);
      ctx.imageSmoothingEnabled = true;
    } else if (extra?.glitch) {
      const slices = 12;
      for (let i = 0; i < slices; i += 1) {
        const sy = (i / slices) * H;
        const shift = Math.sin(i * 12.9898 + Math.floor(this.time / 80000)) * W * 0.04;
        ctx.drawImage(layer, 0, sy, W, H / slices, dx + shift, sy, W, H / slices);
      }
    } else if (extra?.flip) {
      ctx.translate(W / 2 + dx, H / 2 + dy);
      if (extra.flip === 'x') ctx.scale(1 - extra.p * 2, 1);
      else ctx.scale(1, 1 - extra.p * 2);
      ctx.drawImage(layer, -W / 2, -H / 2, W, H);
    } else {
      ctx.translate(dx + W / 2, dy + H / 2);
      ctx.rotate(rot);
      ctx.scale(zoom, zoom);
      ctx.drawImage(layer, -W / 2, -H / 2, W, H);
    }
    if (extra?.burn) {
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(W * 0.2, H * 0.8, 0, W * 0.2, H * 0.8, W * 0.9);
      g.addColorStop(0, rgba(extra.color, extra.burn * 0.8));
      g.addColorStop(1, rgba(extra.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-W, -H, W * 3, H * 3);
    }
    if (extra === 'glitch') {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.2 * alpha;
      ctx.drawImage(layer, -W * 0.01, 0, W, H);
    }
    if (extra?.luma) {
      ctx.globalAlpha = alpha * extra.luma;
    }
    ctx.restore();
  }

  applyOutro(ctx, layer, preset, raw, scale) {
    if (!preset) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.save();
    ctx.globalAlpha = clamp(1 - raw, 0, 1);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    if (preset.engine === 'dip') {
      ctx.save();
      ctx.globalAlpha = Math.sin(raw * Math.PI) * 0.7;
      ctx.fillStyle = preset.params?.color || '#000000';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  drawComposition(ctx, clip, scale, depth = 0) {
    if (depth > 4) return;
    const comp = resolveComposition(this.project, clip, depth);
    if (!comp) return;
    const layer = this.buffer(this.canvas.width, this.canvas.height);
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    const local = clip.start === this.time ? 0 : this.time - clip.start;
    const fraction = clamp(local / Math.max(1, clip.duration), 0, 1);
    const at = Math.round(comp.duration * fraction);
    const prevProject = this.project;
    const compProject = { ...this.project, width: comp.width || this.project.width, height: comp.height || this.project.height, tracks: comp.tracks || [], clips: comp.clips || [], compositions: [] };
    const savedCanvas = this.canvas;
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width; tmp.height = layer.canvas.height;
    const inner = new MotionEngine({ canvas: tmp, project: compProject, assets: this.assets });
    inner.quality = 1; inner.time = at; inner.audio = { update() {}, start() {}, stop() {}, sync() {}, setMuted() {}, setRate() {}, peak: 0 };
    inner.renderFrame();
    layer.ctx.drawImage(tmp, 0, 0);
    const tr = animatedTransform(clip, local);
    const tstate = this.transitionState(clip);
    this.compositeLayer(ctx, layer.canvas, clip, tr, tr.opacity ?? 1, tstate, scale);
  }

  applyMask(ctx, W, H, clip, scale) {
    const mask = clip.mask;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    if (mask.shape === 'ellipse') {
      ctx.ellipse(W / 2, H / 2, W * 0.45, H * 0.45, 0, 0, Math.PI * 2);
    } else if (mask.shape === 'polygon' && Array.isArray(mask.points) && mask.points.length > 2) {
      mask.points.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x * W, pt.y * H); else ctx.lineTo(pt.x * W, pt.y * H); });
      ctx.closePath();
    } else {
      ctx.rect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
    }
    if (mask.feather) ctx.filter = `blur(${Math.max(1, mask.feather * H)}px)`;
    ctx.fill();
    ctx.restore();
    if (mask.invert) {
      const inv = this.buffer(W, H);
      inv.ctx.clearRect(0, 0, W, H);
      inv.ctx.fillStyle = '#ffffff';
      inv.ctx.fillRect(0, 0, W, H);
      inv.ctx.globalCompositeOperation = 'destination-out';
      inv.ctx.drawImage(ctx.canvas, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(inv.canvas, 0, 0);
      ctx.restore();
    }
  }

  applyGrade(ctx, canvas, clip, scale, local = 0) {
    const base = clip.color || {};
    const c = { ...base };
    for (const key of ['exposure','brightness','contrast','saturation','vibrance','temperature','tint','highlights','shadows','whites','blacks','gamma','hue']) {
      if (clip.keyframes?.[key]) c[key] = evaluateKeyframes(clip.keyframes[key], local, base[key] ?? (key === 'gamma' ? 1 : 0));
    }
    if (clip.keyframes?.lift || clip.keyframes?.gammaRGB || clip.keyframes?.gain) {
      c.lift = clip.keyframes?.lift ? evaluateKeyframes(clip.keyframes.lift, local, base.lift) : base.lift;
      c.gammaRGB = clip.keyframes?.gammaRGB ? evaluateKeyframes(clip.keyframes.gammaRGB, local, base.gammaRGB) : base.gammaRGB;
      c.gain = clip.keyframes?.gain ? evaluateKeyframes(clip.keyframes.gain, local, base.gain) : base.gain;
    }
    const advanced = c.lift?.some((v) => v) || c.gain?.some((v) => Math.abs(v - 1) > 0.001) || c.gammaRGB?.some((v) => Math.abs(v - 1) > 0.001)
      || c.lut?.data || c.curves?.master?.length || c.curves?.red?.length || c.curves?.green?.length || c.curves?.blue?.length || c.selective?.length || c.highlights || c.shadows || c.whites || c.blacks || c.vibrance || c.exposure;
    if (!advanced) {
      const filters = [];
      if (c.brightness) filters.push(`brightness(${1 + c.brightness})`);
      if (c.contrast) filters.push(`contrast(${1 + c.contrast})`);
      if (c.saturation) filters.push(`saturate(${Math.max(0, 1 + c.saturation)})`);
      if (c.hue) filters.push(`hue-rotate(${c.hue}deg)`);
      if (filters.length) {
        const copy = this.buffer(canvas.width, canvas.height);
        copy.ctx.clearRect(0, 0, canvas.width, canvas.height);
        copy.ctx.filter = filters.join(' ');
        copy.ctx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(copy.canvas, 0, 0);
      }
      return;
    }
    const W = canvas.width;
    const H = canvas.height;
    let img;
    try { img = ctx.getImageData(0, 0, W, H); } catch { return; }
    const data = img.data;
    const lut = c.lut?.data && c.lut.size ? c.lut : null;
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const [r, g, b] = gradeColor(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, c, lut);
      data[i] = r * 255; data[i + 1] = g * 255; data[i + 2] = b * 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  applyEffect(ctx, canvas, effect, clip, scale, track, local = Math.max(0, this.time - (clip.start || 0))) {
    if (effect.enabled === false) return;
    const preset = effectById(effect.type);
    if (!preset) return;
    const params = { ...preset.params, ...(effect.params || {}) };
    for (const [key, frames] of Object.entries(effect.keyframes || {})) {
      if (Array.isArray(frames) && frames.length) params[key] = evaluateKeyframes(frames, local, params[key]);
    }
    params._t = this.time; params._local = local; params._clip = clip;
    const { width: W, height: H } = canvas;
    switch (preset.primitive) {
      case 'filter': {
        const filters = [];
        if (params.blur) filters.push(`blur(${params.blur * 2}px)`);
        if (params.sharpen) filters.push(`contrast(${1 + params.sharpen * 0.2})`);
        if (params.saturation) filters.push(`saturate(${1 + params.saturation})`);
        if (params.brightness) filters.push(`brightness(${1 + params.brightness})`);
        this.reblur(ctx, canvas, filters.join(' '));
        break;
      }
      case 'color': {
        const copy = this.buffer(W, H);
        copy.ctx.clearRect(0, 0, W, H);
        const filters = [];
        if (params.sepia) filters.push('sepia(1)');
        if (params.saturation) filters.push(`saturate(${Math.max(0, 1 + params.saturation)})`);
        if (params.contrast) filters.push(`contrast(${1 + params.contrast})`);
        if (params.brightness) filters.push(`brightness(${1 + params.brightness})`);
        if (params.hue) filters.push(`hue-rotate(${params.hue}deg)`);
        copy.ctx.filter = filters.join(' ');
        copy.ctx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(copy.canvas, 0, 0);
        if (params.temperature) this.tint(ctx, canvas, params.temperature);
        break;
      }
      case 'vignette': this.vignette(ctx, canvas, params.amount || 0.5); break;
      case 'grain': this.grain(ctx, canvas, params.amount || 0.15); break;
      case 'chroma': this.chroma(ctx, canvas, params.amount || 0.004); break;
      case 'pixelate': this.pixelate(ctx, canvas, params.size || 16); break;
      case 'posterize': this.posterize(ctx, canvas, params.levels || 6); break;
      case 'halftone': this.halftone(ctx, canvas, params.size || 6); break;
      case 'edges': this.edges(ctx, canvas, 1); break;
      case 'emboss': this.emboss(ctx, canvas); break;
      case 'mirror': this.flip(ctx, canvas, params.axis || 'x'); break;
      case 'fisheye': this.fisheye(ctx, canvas, params.amount || 0.5); break;
      case 'kaleidoscope': this.kaleidoscope(ctx, canvas, params.segments || 6); break;
      case 'distort': this.heat(ctx, canvas, params.amount || 0.02); break;
      case 'glow': this.glow(ctx, canvas, params.radius || 0.02, params.intensity || 0.6); break;
      case 'vhs': this.vhs(ctx, canvas, params); break;
      case 'crt': this.crt(ctx, canvas, params); break;
      case 'glitch': this.glitch(ctx, canvas, params); break;
      case 'datamosh': this.datamosh(ctx, canvas, params); break;
      case 'film': this.film(ctx, canvas, params); break;
      case 'comic': this.comic(ctx, canvas, params); break;
      case 'speedlines': this.speedlines(ctx, canvas, params); break;
      case 'cyberpunk': this.cyberpunk(ctx, canvas); break;
      case 'infrared': this.infrared(ctx, canvas, params); break;
      case 'trails': this.trails(ctx, canvas, clip, effect); break;
      case 'shake': break; // handled in drawMedia via applyMotion
      case 'zoom': break;
      case 'motion-rotate': break;
      case 'perspective': break;
      case 'parallax': break;
      case 'bounce': break;
      case 'elastic': break;
      case 'particles': this.drawParticles(ctx, effect, clip, this.project, W / this.project.width, params); break;
      case 'shockwave': this.heat(ctx, canvas, params.strength || 0.05); break;
      case 'heat': this.heat(ctx, canvas, params.amount || 0.004); break;
      case 'flare': this.flare(ctx, canvas, params); break;
      case 'haze': this.haze(ctx, canvas, params); break;
      case 'godrays': this.godrays(ctx, canvas, params); break;
      case 'scanlines': this.scanlines(ctx, canvas, params); break;
      case 'invert': this.invert(ctx, canvas, params.amount || 1); break;
      case 'strobe': this.strobe(ctx, canvas, params); break;
      case 'flash': this.flash(ctx, canvas, params); break;
      case 'swirl': this.swirl(ctx, canvas, params); break;
      case 'hologram': this.hologram(ctx, canvas, params); break;
      case 'neon': this.neon(ctx, canvas, params); break;
      case 'pixelsort': this.pixelsort(ctx, canvas, params); break;
      case 'ascii': this.ascii(ctx, canvas, params); break;
      case 'oil': this.reblur(ctx, canvas, 'blur(2px) saturate(1.1)'); break;
      case 'sketch': this.edges(ctx, canvas, params.amount || 0.8); break;
      default: break;
    }
  }

  reblur(ctx, canvas, filter) {
    if (!filter) return;
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.clearRect(0, 0, canvas.width, canvas.height);
    copy.ctx.filter = filter;
    copy.ctx.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(copy.canvas, 0, 0);
  }

  tint(ctx, canvas, amount) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(0.35, Math.abs(amount) * 0.4);
    ctx.fillStyle = amount > 0 ? '#ff9a3c' : '#3c9aff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  vignette(ctx, canvas, amount) {
    const W = canvas.width; const H = canvas.height;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.65);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${clamp(amount, 0, 0.95)})`);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  grain(ctx, canvas, amount) {
    const W = canvas.width; const H = canvas.height;
    const copy = this.buffer(W, H);
    copy.ctx.clearRect(0, 0, W, H);
    copy.ctx.drawImage(canvas, 0, 0);
    const img = copy.ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const strength = amount * 90;
    let seed = (Math.floor(this.time / 33333) + 1) * 9301;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return (seed / 233280) - 0.5;
    };
    for (let i = 0; i < d.length; i += 4) {
      const n = rnd() * strength;
      d[i] = clamp(d[i] + n, 0, 255);
      d[i + 1] = clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = clamp(d[i + 2] + n, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
  }

  chroma(ctx, canvas, amount) {
    const W = canvas.width; const H = canvas.height;
    const copy = this.buffer(W, H);
    copy.ctx.clearRect(0, 0, W, H);
    copy.ctx.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(copy.canvas, -amount * W, 0);
    ctx.drawImage(copy.canvas, amount * W, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  pixelate(ctx, canvas, size) {
    const W = canvas.width; const H = canvas.height;
    const small = this.buffer(Math.max(4, Math.round(W / size)), Math.max(4, Math.round(H / size)));
    small.ctx.clearRect(0, 0, small.canvas.width, small.canvas.height);
    small.ctx.drawImage(canvas, 0, 0, small.canvas.width, small.canvas.height);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small.canvas, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
  }

  pixelLoop(ctx, canvas, fn) {
    let img;
    try { img = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch { return; }
    const d = img.data;
    for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
      const i = (y * canvas.width + x) * 4;
      if (!d[i + 3]) continue;
      const out = fn(d[i], d[i + 1], d[i + 2], x, y, canvas.width, canvas.height);
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
    }
    ctx.putImageData(img, 0, 0);
  }

  posterize(ctx, canvas, levels) {
    const step = 255 / Math.max(2, levels - 1);
    this.pixelLoop(ctx, canvas, (r, g, b) => [Math.round(r / step) * step, Math.round(g / step) * step, Math.round(b / step) * step]);
  }

  halftone(ctx, canvas, size) {
    this.pixelLoop(ctx, canvas, (r, g, b, x, y) => {
      const lum = (r + g + b) / 3;
      const cell = ((Math.floor(x / size) + Math.floor(y / size)) % 2) ? 1 : 0;
      const v = lum > 128 ? (cell ? 255 : 225) : (cell ? 40 : 10);
      return [v, v, v];
    });
  }

  edges(ctx, canvas, strength) {
    const w = canvas.width; const h = canvas.height;
    let src;
    try { src = ctx.getImageData(0, 0, w, h); } catch { return; }
    const out = ctx.createImageData(w, h);
    const lumAt = (x, y) => {
      const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
      return (src.data[i] * 0.299 + src.data[i + 1] * 0.587 + src.data[i + 2] * 0.114) / 255;
    };
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const gx = -lumAt(x - 1, y - 1) - 2 * lumAt(x - 1, y) - lumAt(x - 1, y + 1)
        + lumAt(x + 1, y - 1) + 2 * lumAt(x + 1, y) + lumAt(x + 1, y + 1);
      const gy = -lumAt(x - 1, y - 1) - 2 * lumAt(x, y - 1) - lumAt(x + 1, y - 1)
        + lumAt(x - 1, y + 1) + 2 * lumAt(x, y + 1) + lumAt(x + 1, y + 1);
      const v = clamp(Math.hypot(gx, gy) * strength, 0, 1);
      const i = (y * w + x) * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v * 255;
      out.data[i + 3] = src.data[i + 3];
    }
    ctx.putImageData(out, 0, 0);
  }

  emboss(ctx, canvas) {
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.drawImage(canvas, 0, 0);
    const w = canvas.width; const h = canvas.height;
    const src = copy.ctx.getImageData(0, 0, w, h);
    const out = ctx.createImageData(w, h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const l = ((y - 1) * w + x) * 4;
      const r = ((y + 1) * w + x) * 4;
      out.data[i] = 128 + (src.data[i] - src.data[l]) * 0.5;
      out.data[i + 1] = 128 + (src.data[i + 1] - src.data[l + 1]) * 0.5;
      out.data[i + 2] = 128 + (src.data[i + 2] - src.data[l + 2]) * 0.5;
      out.data[i + 3] = src.data[i + 3];
    }
    ctx.putImageData(out, 0, 0);
  }

  flip(ctx, canvas, axis) {
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (axis === 'y') { ctx.translate(0, canvas.height); ctx.scale(1, -1); }
    else { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(copy.canvas, 0, 0);
    ctx.restore();
  }

  fisheye(ctx, canvas, amount) {
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.drawImage(canvas, 0, 0);
    const w = canvas.width; const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const strip = 2;
    for (let x = 0; x < w; x += strip) {
      const nx = (x / w - 0.5) * 2;
      const srcX = ((nx * (1 - amount * nx * nx * 0.5)) / 2 + 0.5) * w;
      ctx.drawImage(copy.canvas, srcX, 0, strip, h, x, 0, strip, h);
    }
  }

  kaleidoscope(ctx, canvas, segments) {
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.drawImage(canvas, 0, 0);
    const W = canvas.width; const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    for (let i = 0; i < segments; i += 1) {
      ctx.save();
      ctx.rotate((Math.PI * 2 * i) / segments);
      if (i % 2) ctx.scale(-1, 1);
      ctx.drawImage(copy.canvas, -W / 2, -H / 2, W / 2, H);
      ctx.restore();
    }
    ctx.restore();
  }

  heat(ctx, canvas, amount) {
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.drawImage(canvas, 0, 0);
    const W = canvas.width; const H = canvas.height;
    const phase = this.time / 90000;
    ctx.clearRect(0, 0, W, H);
    const strip = Math.max(2, Math.round(H / 120));
    for (let y = 0; y < H; y += strip) {
      const dx = Math.sin(y * 0.06 + phase) * amount * W * 4;
      ctx.drawImage(copy.canvas, 0, y, W, strip, dx, y, W, strip);
    }
  }

  glow(ctx, canvas, radius, intensity) {
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.clearRect(0, 0, canvas.width, canvas.height);
    copy.ctx.filter = `blur(${Math.max(1, radius * canvas.width)}px) brightness(${1 + intensity * 0.4})`;
    copy.ctx.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = clamp(intensity, 0, 1);
    ctx.drawImage(copy.canvas, 0, 0);
    ctx.restore();
  }

  vhs(ctx, canvas, p) {
    this.chroma(ctx, canvas, 0.002 * (p.amount || 1));
    this.scanlines(ctx, canvas, { density: 2, opacity: 0.22 * (p.amount || 1) });
    this.grain(ctx, canvas, 0.08 * (p.amount || 1));
  }

  crt(ctx, canvas, p) {
    this.scanlines(ctx, canvas, { density: 3, opacity: 0.3 });
    this.vignette(ctx, canvas, 0.3 * (p.curvature || 0.4));
    if (p.blackWhite) this.reblur(ctx, canvas, 'grayscale(1)');
  }

  glitch(ctx, canvas, p) {
    const W = canvas.width; const H = canvas.height;
    const copy = this.buffer(W, H);
    copy.ctx.drawImage(canvas, 0, 0);
    this.chroma(ctx, canvas, 0.006 * (p.amount || 0.5));
    const slices = Math.max(4, Math.round(p.slices || 10));
    ctx.save();
    for (let i = 0; i < slices; i += 1) {
      if (Math.random() > 0.42) continue;
      const sy = Math.random() * H;
      const sh = H / slices * (0.4 + Math.random());
      const sx = (Math.random() - 0.5) * W * 0.06 * (p.amount || 1);
      ctx.drawImage(copy.canvas, 0, sy, W, sh, sx, sy, W, sh);
    }
    ctx.restore();
  }

  datamosh(ctx, canvas, p) {
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.drawImage(canvas, 0, 0);
    const key = `mosh:${this.project?.clips?.[0]?.id || 'x'}`;
    const prev = this.buffers.get(key);
    if (prev) {
      ctx.save();
      ctx.globalAlpha = 0.35 * (p.amount || 0.6);
      ctx.drawImage(prev.canvas, 0, 0);
      ctx.restore();
    }
    const frame = this.buffer(canvas.width, canvas.height);
    frame.ctx.drawImage(canvas, 0, 0);
    this.buffers.set(key, frame);
  }

  film(ctx, canvas, p) {
    this.tint(ctx, canvas, p.warmth || 0.3);
    this.vignette(ctx, canvas, p.vignette || 0.2);
    if (p.grain) this.grain(ctx, canvas, p.grain * 0.6);
  }

  comic(ctx, canvas) {
    this.posterize(ctx, canvas, 5);
    this.edges(ctx, canvas, 0.4);
  }

  speedlines(ctx, canvas, p) {
    const W = canvas.width; const H = canvas.height;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${clamp(p.intensity || 0.5, 0, 0.8)})`;
    ctx.lineWidth = 1.2;
    const cx = (p.focalX ?? 0.5) * W; const cy = (p.focalY ?? 0.5) * H;
    for (let i = 0; i < 60; i += 1) {
      const a = (i / 60) * Math.PI * 2 + this.time / 2e6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * Math.min(W, H) * 0.25, cy + Math.sin(a) * Math.min(W, H) * 0.25);
      ctx.lineTo(cx + Math.cos(a) * Math.max(W, H), cy + Math.sin(a) * Math.max(W, H));
      ctx.stroke();
    }
    ctx.restore();
  }

  cyberpunk(ctx, canvas) {
    this.tint(ctx, canvas, 0.2);
    this.chroma(ctx, canvas, 0.002);
  }

  infrared(ctx, canvas, p) {
    this.pixelLoop(ctx, canvas, (r, g, b) => [b, r, g]);
  }

  trails(ctx, canvas, clip, effect) {
    const key = `trail:${clip.id}:${effect.id}`;
    const prev = this.buffers.get(key);
    if (prev) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.drawImage(prev.canvas, 0, 0);
      ctx.restore();
    }
    const next = this.buffer(canvas.width, canvas.height);
    next.ctx.clearRect(0, 0, canvas.width, canvas.height);
    next.ctx.drawImage(canvas, 0, 0);
    this.buffers.set(key, next);
  }

  scanlines(ctx, canvas, p) {
    const W = canvas.width; const H = canvas.height;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${clamp(p.opacity ?? 0.3, 0, 0.8)})`;
    const density = Math.max(2, Math.round(p.density || 3));
    for (let y = 0; y < H; y += density) ctx.fillRect(0, y, W, 1);
    ctx.restore();
  }

  invert(ctx, canvas, amount) {
    this.pixelLoop(ctx, canvas, (r, g, b) => [r + (255 - 2 * r) * amount, g + (255 - 2 * g) * amount, b + (255 - 2 * b) * amount]);
  }

  strobe(ctx, canvas, p) {
    const on = Math.sin((this.time / 1e6) * Math.PI * 2 * (p.speed || 8)) > 0;
    if (!on) {
      ctx.save();
      ctx.globalAlpha = 0.3 * (p.amount || 0.5);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  flash(ctx, canvas, p) {
    const pulse = Math.max(0, Math.sin((this.time / 1e6) * Math.PI * 2 * 2.4));
    ctx.save();
    ctx.globalAlpha = 0.25 * pulse;
    ctx.fillStyle = p.color || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  flare(ctx, canvas, p) {
    const W = canvas.width; const H = canvas.height;
    const x = (p.x ?? 0.7) * W; const y = (p.y ?? 0.3) * H;
    const r = (p.size || 0.5) * Math.min(W, H);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(p.color || '#fde68a', 0.9));
    g.addColorStop(0.2, rgba(p.color || '#fde68a', 0.35));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (p.streak) {
      const s = ctx.createLinearGradient(0, y, W, y);
      s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(0.5, rgba(p.color || '#67e8f9', 0.35)); s.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = s; ctx.fillRect(0, y - r * 0.03, W, r * 0.06);
    }
    ctx.restore();
  }

  haze(ctx, canvas, p) {
    ctx.save();
    ctx.globalAlpha = clamp(p.amount || 0.25, 0, 1);
    ctx.fillStyle = p.color || '#94a3b8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  godrays(ctx, canvas, p) {
    const W = canvas.width; const H = canvas.height;
    const x = (p.x ?? 0.3) * W; const y = (p.y ?? 0) * H;
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.hypot(W, H) * 0.8);
    g.addColorStop(0, rgba(p.color || '#fef08a', p.amount ?? 0.4));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a - 0.05) * W, y + Math.sin(a - 0.05) * H);
      ctx.lineTo(x + Math.cos(a + 0.05) * W, y + Math.sin(a + 0.05) * H);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  swirl(ctx, canvas, p) {
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.drawImage(canvas, 0, 0);
    const W = canvas.width; const H = canvas.height;
    const cx = W / 2; const cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    const size = 4;
    for (let y = 0; y < H; y += size) {
      for (let x = 0; x < W; x += size) {
        const dx = x - cx; const dy = y - cy;
        const dist = Math.hypot(dx, dy) / Math.max(W, H);
        const a = (p.amount || 0.5) * (1 - Math.min(1, dist / (p.radius || 0.6)));
        const sx = Math.cos(a) * dx - Math.sin(a) * dy + cx;
        const sy = Math.sin(a) * dx + Math.cos(a) * dy + cy;
        ctx.drawImage(copy.canvas, sx, sy, size, size, x, y, size, size);
      }
    }
  }

  hologram(ctx, canvas, p) {
    this.chroma(ctx, canvas, 0.006);
    this.scanlines(ctx, canvas, { density: 2, opacity: 0.28 });
    this.tint(ctx, canvas, -0.2);
  }

  neon(ctx, canvas, p) {
    this.glow(ctx, canvas, 0.015, p.amount || 0.6);
    this.chroma(ctx, canvas, 0.003);
  }

  pixelsort(ctx, canvas, p) {
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.drawImage(canvas, 0, 0);
    const W = canvas.width; const H = canvas.height;
    const img = copy.ctx.getImageData(0, 0, W, H);
    const out = new ImageData(new Uint8ClampedArray(img.data), W, H);
    const threshold = 80;
    for (let y = 0; y < H; y += 3) {
      let run = [];
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        const lum = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
        if (lum > threshold) run.push([img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]);
        else {
          if (run.length) {
            run.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
            for (let k = 0; k < run.length; k += 1) {
              const j = (y * W + (x - run.length + k)) * 4;
              out.data[j] = run[k][0]; out.data[j + 1] = run[k][1]; out.data[j + 2] = run[k][2]; out.data[j + 3] = run[k][3];
            }
            run = [];
          }
        }
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  ascii(ctx, canvas, p) {
    const size = Math.max(4, Math.round(p.size || 8));
    const copy = this.buffer(canvas.width, canvas.height);
    copy.ctx.drawImage(canvas, 0, 0);
    const W = canvas.width; const H = canvas.height;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = `${size}px monospace`; ctx.textBaseline = 'top';
    for (let y = 0; y < H; y += size) for (let x = 0; x < W; x += size) {
      const d = copy.ctx.getImageData(x, y, 1, 1).data;
      const lum = (d[0] + d[1] + d[2]) / 3;
      if (lum > 180) ctx.fillText('#', x, y);
      else if (lum > 100) ctx.fillText('+', x, y);
      else if (lum > 40) ctx.fillText('.', x, y);
    }
  }

  drawParticles(ctx, effect, clip, project, scale, supplied) {
    const preset = effectById(effect.type);
    const params = { ...(preset?.params || {}), ...(effect.params || {}), ...(supplied || {}), preset: supplied?.preset || preset?.params?.preset || effect.params?.preset || effect.type };
    const local = Math.max(0, (this.time - (clip.start || 0)) / TICKS);
    const particles = sampleParticles(params, local, { seed: seedFromString(clip.id + effect.id), aspect: project.width / project.height });
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.save();
    ctx.globalCompositeOperation = params.blend === 'add' || params.additive ? 'lighter' : 'source-over';
    for (const p of particles) {
      const x = p.x * W;
      const y = p.y * H;
      const size = Math.max(0.5, p.size * H);
      ctx.globalAlpha = p.alpha;
      if (p.kind === 'bolt') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, p.width * H);
        ctx.beginPath();
        (p.points || []).forEach(([px, py], i) => { if (i === 0) ctx.moveTo(px * W, py * H); else ctx.lineTo(px * W, py * H); });
        ctx.stroke();
      } else if (p.kind === 'spark' || p.streak) {
        const vx = (p.vx || 0) * W * 0.04;
        const vy = Math.max(4, (p.vy || 0.2) * H * 0.04);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.6, size * 0.25);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - vx, y - vy);
        ctx.stroke();
      } else {
        const g = ctx.createRadialGradient(x, y, 0, x, y, size);
        g.addColorStop(0, p.color);
        g.addColorStop(0.5, p.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawTrackEffects(ctx, project, scale) {
    for (const track of [...project.tracks].reverse()) {
      if (track.hidden || !track.effects?.length) continue;
      for (const effect of track.effects) this.applyEffect(ctx, this.canvas, effect, { id: track.id, originalDuration: 1 }, scale, track);
    }
  }

  /* --------------------------------------------------------------------- */
  /* Text and subtitles                                                    */
  /* --------------------------------------------------------------------- */

  wrapText(ctx, text, maxWidth) {
    const paragraphs = String(text || '').split('\n');
    const lines = [];
    for (const paragraph of paragraphs) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (ctx.measureText(candidate).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else line = candidate;
      }
      lines.push(line);
    }
    return lines;
  }

  drawText(ctx, clip, project, scale) {
    const t = clip.text;
    const W = this.canvas.width; const H = this.canvas.height;
    const local = this.time - clip.start;
    const progress = clamp(local / Math.max(1, clip.duration), 0, 1);
    const anim = textAnimationState(t.animation, progress, local, clip.duration);
    const size = Math.max(6, (t.fontSize || 0.07) * H);
    ctx.save();
    ctx.translate((t.x ?? 0.5) * W + anim.dx * W, (t.y ?? 0.5) * H + anim.dy * H);
    ctx.rotate(((t.rotation || 0) + anim.rotation) * Math.PI / 180);
    ctx.scale(anim.scale, anim.scale);
    ctx.globalAlpha = clamp(anim.opacity, 0, 1);
    if (anim.blur) ctx.filter = `blur(${anim.blur * H}px)`;
    ctx.font = `${t.italic ? 'italic ' : ''}${t.fontWeight || 700} ${size}px ${t.fontFamily || 'Inter, Arial, sans-serif'}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(t.letterSpacing || 0) * size}px`;
    ctx.textAlign = t.align === 'left' ? 'left' : t.align === 'right' ? 'right' : 'center';
    ctx.textBaseline = 'middle';
    const lines = this.wrapText(ctx, t.uppercase ? String(t.content).toUpperCase() : String(t.content), W * (t.width || 0.86));
    const lineHeight = size * (t.lineHeight || 1.15);
    const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width), 0);
    if (t.background?.opacity > 0.01) {
      ctx.fillStyle = rgba(t.background.color || '#000000', t.background.opacity);
      const padX = (t.background.padding || 0.012) * H;
      const padY = (t.background.padding || 0.012) * H * 0.6;
      ctx.beginPath();
      const bw = textWidth + padX * 2;
      ctx.roundRect(-bw / 2, -lineHeight * lines.length / 2 - padY, bw, lineHeight * lines.length + padY * 2, (t.background.radius || 0.008) * H);
      ctx.fill();
    }
    if (t.shadow && (t.shadow.blur || t.shadow.opacity)) {
      ctx.shadowColor = rgba(t.shadow.color || '#000000', t.shadow.opacity ?? 0.6);
      ctx.shadowBlur = (t.shadow.blur || 0.01) * H;
      ctx.shadowOffsetY = (t.shadow.y || 0.004) * H;
    }
    if (t.outline?.width) {
      ctx.lineWidth = Math.max(1, t.outline.width * H);
      ctx.strokeStyle = rgba(t.outline.color || '#000000', t.outline.opacity ?? 1);
    }
    for (let i = 0; i < lines.length; i += 1) {
      const y = (i - (lines.length - 1) / 2) * lineHeight;
      if (t.gradient && t.gradient.length) {
        const grad = ctx.createLinearGradient(-textWidth / 2, 0, textWidth / 2, 0);
        t.gradient.forEach((c, j) => grad.addColorStop(j / Math.max(1, t.gradient.length - 1), c));
        ctx.fillStyle = grad;
      } else ctx.fillStyle = t.color || '#ffffff';
      if (t.outline?.width) ctx.strokeText(lines[i], 0, y);
      ctx.fillText(lines[i], 0, y);
    }
    ctx.restore();
    if (anim.clip < 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W * anim.clip, H);
      ctx.restore();
    }
  }

  drawSubtitle(ctx, clip, project, scale) {
    const sub = clip.subtitle;
    const preset = subtitleStyleById(sub.styleId);
    const s = { ...preset.style, ...(sub.style || {}) };
    const W = this.canvas.width; const H = this.canvas.height;
    const local = this.time - clip.start;
    const progress = clamp(local / Math.max(1, clip.duration), 0, 1);
    const state = subtitleAnimation(preset.animation, progress, { wordCount: sub.words?.length || 1, introDuration: 0.22 });
    const size = Math.max(6, (s.size || 0.052) * H);
    ctx.save();
    ctx.translate((s.x || 0.5) * W + state.dx * W, (s.y || 0.86) * H + state.dy * H);
    ctx.rotate(((s.rotation || 0) + state.rotation) * Math.PI / 180);
    ctx.scale(state.scale, state.scale);
    ctx.globalAlpha = clamp(state.opacity, 0, 1);
    if (state.blur) ctx.filter = `blur(${state.blur * H}px)`;
    ctx.font = `${s.italic ? 'italic ' : ''}${s.weight || 700} ${size}px ${s.fontFamily || 'Inter, Arial, sans-serif'}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(s.letterSpacing || 0) * size}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = s.uppercase ? String(sub.text || '').toUpperCase() : String(sub.text || '');
    const lines = this.wrapText(ctx, text, W * (s.maxWidth || 0.86));
    const lineHeight = size * (s.lineHeight || 1.16);
    const words = sub.words || [];
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width), 0);
    const padX = (s.paddingX || 0.012) * H;
    const padY = (s.paddingY || 0.006) * H;
    if (s.bg && s.bgOpacity > 0) {
      ctx.fillStyle = rgba(s.bg, s.bgOpacity);
      ctx.beginPath();
      ctx.roundRect(-width / 2 - padX, -lineHeight * lines.length / 2 - padY, width + padX * 2, lineHeight * lines.length + padY * 2, (s.radius || 0.006) * H);
      ctx.fill();
    }
    if (s.shadow) {
      ctx.shadowColor = rgba(s.shadowColor || '#000000', 0.8);
      ctx.shadowBlur = s.shadow * H;
      ctx.shadowOffsetY = (s.shadowY || 0.004) * H;
    }
    if (s.outline) {
      ctx.lineWidth = Math.max(1, s.outline * H);
      ctx.strokeStyle = s.outlineColor || '#000000';
    }
    if (state.clip < 1) {
      ctx.beginPath();
      ctx.rect(-width, -H, width * 2 * state.clip, H * 2);
      ctx.clip();
    }
    const activeWord = words.length ? words.findIndex((w) => this.time >= w.start && this.time < w.end) : -1;
    for (let i = 0; i < lines.length; i += 1) {
      const y = (i - (lines.length - 1) / 2) * lineHeight;
      if (words.length && preset.animation === 'karaoke' || preset.animation === 'word-highlight' || preset.animation === 'highlight-box') {
        // Word-level render so the active word can change colour/scale.
        const lineWords = lines[i].split(' ');
        let x = -ctx.measureText(lines[i]).width / 2;
        for (const word of lineWords) {
          const w = ctx.measureText(`${word} `).width;
          const idx = words.findIndex((entry) => entry.text.toLowerCase().startsWith(word.toLowerCase()));
          const active = idx >= 0 && this.time >= words[idx].start && this.time < words[idx].end;
          const g = idx >= 0 ? glyphState(preset.animation, progress, idx, words.length) : null;
          if (active) {
            const highlight = s.highlight || s.bg || '#facc15';
            if (preset.animation === 'karaoke') ctx.fillStyle = highlight;
            else {
              ctx.fillStyle = highlight;
              ctx.fillRect(x - 2, y - lineHeight * 0.55, w, lineHeight);
              ctx.fillStyle = s.bg ? '#111111' : '#111111';
            }
          } else ctx.fillStyle = s.color || '#ffffff';
          if (s.outline) ctx.strokeText(word, x + w / 2, y);
          ctx.fillText(word, x + w / 2, y);
          x += w;
        }
      } else {
        ctx.fillStyle = s.color || '#ffffff';
        if (s.outline) ctx.strokeText(lines[i], 0, y);
        ctx.fillText(lines[i], 0, y);
      }
    }
    ctx.restore();
  }

  /* Render a static preview for a subtitle preset card. */
  drawSubtitlePreview(canvas, styleId, text = 'Caption preview') {
    const style = subtitleStyleById(styleId);
    const ctx = canvas.getContext('2d');
    const W = canvas.width; const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#1f2937'); grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    const sub = { ...style.style };
    const size = Math.max(7, sub.size * H * 1.4);
    ctx.font = `${sub.weight || 700} ${size}px ${sub.fontFamily || 'Inter, Arial, sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const words = String(text).split(' ');
    const width = Math.max(...words.map((w) => ctx.measureText(w).width)) * 2.6 + 24;
    if (sub.bg) {
      ctx.fillStyle = rgba(sub.bg, sub.bgOpacity ?? 0.8);
      ctx.beginPath();
      ctx.roundRect(W / 2 - width / 2, H / 2 - size, width, size * 2, (sub.radius || 0.006) * H);
      ctx.fill();
    }
    if (sub.shadow) {
      ctx.shadowColor = sub.shadowColor || '#000000';
      ctx.shadowBlur = sub.shadow * H;
      ctx.shadowOffsetY = (sub.shadowY || 0.004) * H;
    }
    if (sub.outline) { ctx.lineWidth = Math.max(1, sub.outline * H); ctx.strokeStyle = sub.outlineColor || '#000000'; }
    ctx.fillStyle = sub.color || '#ffffff';
    if (style.animation === 'karaoke' || style.animation === 'word-highlight' || style.animation === 'highlight-box') {
      let x = W / 2 - width / 2 + 10;
      words.forEach((word, i) => {
        const w = ctx.measureText(`${word} `).width;
        if (i === 1) {
          ctx.fillStyle = sub.highlight || '#facc15';
          if (style.animation !== 'karaoke') ctx.fillRect(x - 3, H / 2 - size * 0.6, w, size * 1.2);
          ctx.fillStyle = '#111111';
        } else ctx.fillStyle = sub.color || '#ffffff';
        if (sub.outline) ctx.strokeText(word, x + w / 2, H / 2);
        ctx.fillText(word, x + w / 2, H / 2);
        x += w;
      });
    } else {
      if (sub.outline) ctx.strokeText(text, W / 2, H / 2);
      ctx.fillText(text, W / 2, H / 2);
    }
  }

  emit() { for (const cb of this.listeners) { try { cb(this); } catch { /* ignore */ } } }
  onTick(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  destroy() {
    this.pause();
    this.listeners.clear();
    for (const { video } of this.videos.values()) { video.pause(); video.removeAttribute('src'); video.load(); }
    this.videos.clear();
    this.images.clear();
    this.buffers.clear();
    this.audio.destroy();
  }
}

function ease(name, t) {
  if (name === 'linear') return t;
  if (name === 'ease-in') return t * t;
  if (name === 'ease-out') return 1 - (1 - t) ** 2;
  if (name === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2;
  return t;
}

function wipeRect(dir, p, W, H) {
  if (dir === 'left') return { x: 0, y: 0, w: W * p, h: H };
  if (dir === 'right') return { x: W * (1 - p), y: 0, w: W * p, h: H };
  if (dir === 'up') return { x: 0, y: H * (1 - p), w: W, h: H * p };
  return { x: 0, y: 0, w: W, h: H * p };
}

function barnRect(p, W, H, mode) {
  if (mode === 'close') return { x: (W * (1 - p)) / 2, y: 0, w: W * p, h: H };
  return { x: 0, y: 0, w: W, h: H };
}

function starPath(ctx, cx, cy, r, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const radius = i % 2 ? r * 0.45 : r;
    if (i === 0) ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    else ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  ctx.closePath();
}

function draftClip(clip, time, project) {
  return clip;
}

function textAnimationState(name, progress, local, duration) {
  const p = progress;
  const intro = clamp(p / 0.08);
  const outro = clamp((1 - p) / 0.07);
  const base = { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, blur: 0, clip: 1 };
  switch (name) {
    case 'fade-in': return { ...base, opacity: Math.min(intro, outro) };
    case 'slide-in-left': return { ...base, opacity: Math.min(1, intro * 2) * outro, dx: -(1 - intro) * 0.2 };
    case 'slide-in-right': return { ...base, opacity: Math.min(1, intro * 2) * outro, dx: (1 - intro) * 0.2 };
    case 'slide-in-top': return { ...base, opacity: Math.min(1, intro * 2) * outro, dy: -(1 - intro) * 0.2 };
    case 'pop-in': return { ...base, opacity: Math.min(1, intro * 2) * outro, scale: 0.5 + intro * 0.5 };
    case 'zoom-in': return { ...base, opacity: intro * outro, scale: 0.2 + intro * 0.8 };
    case 'tracking-in': return { ...base, opacity: intro * outro, scale: 1.1 - intro * 0.1 };
    case 'typewriter': return { ...base, clip: intro, opacity: outro };
    case 'bounce': return { ...base, opacity: Math.min(1, intro * 2) * outro, dy: (1 - intro) * 0.1 };
    case 'dramatic-fade': return { ...base, opacity: intro * outro, blur: (1 - intro) * 0.01 };
    case 'credits-roll': return { ...base, opacity: outro };
    case 'glitch': return { ...base, opacity: Math.min(1, intro * 3) * outro, dx: Math.sin(local / 40000) * 0.006 * (1 - intro) };
    default: return { ...base, opacity: Math.min(intro, outro) };
  }
}

/* ------------------------------------------------------------------------- */
/* Preview audio                                                             */
/* ------------------------------------------------------------------------- */

class PreviewAudio {
  constructor(engine) {
    this.engine = engine;
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.muted = false;
    this.rate = 1;
    this.clock = null;
    this.players = new Map();
    this.peak = 0;
  }

  ensure() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C({ sampleRate: 48000 });
    this.master = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
  }

  build(clip, asset) {
    if (!asset || (!asset.hasAudio && asset.kind !== 'audio')) return null;
    if (!this.ctx) this.ensure();
    if (!this.ctx) return null;
    const media = document.createElement('video');
    media.src = asset.proxyUrl || asset.url;
    media.crossOrigin = 'anonymous';
    media.preload = 'auto';
    media.muted = false;
    media.playsInline = true;
    const src = this.ctx.createMediaElementSource(media);
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    const low = this.ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200;
    const mid = this.ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 1;
    const high = this.ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000;
    src.connect(low); low.connect(mid); mid.connect(high); high.connect(gain); gain.connect(pan); pan.connect(this.master);
    return { media, src, gain, pan, low, mid, high };
  }

  start(time) {
    this.ensure();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.engine.seekMedia(true);
    for (const clip of this.engine.project.clips) {
      if (!['audio', 'video'].includes(clip.type)) continue;
      const asset = this.engine.assetMap.get(clip.assetId);
      if (!asset || (!asset.hasAudio && asset.kind !== 'audio')) continue;
      const key = `${clip.id}:${clip.assetId}`;
      let player = this.players.get(key);
      if (!player) {
        player = this.build(clip, asset);
        if (player) this.players.set(key, player);
      }
      if (player) {
        try { player.media.currentTime = toSeconds(clip.inPoint); } catch { /* not ready */ }
      }
    }
    this.clock = performance.now();
    this.sync();
  }

  stop() {
    for (const player of this.players.values()) { player.media.pause(); }
    this.peak = 0;
    if (!this.ctx) return;
    for (const player of this.players.values()) player.media.pause();
  }

  setRate(rate) {
    this.rate = rate;
    for (const player of this.players.values()) player.media.playbackRate = rate;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  sync() {}

  update(time) {
    if (!this.ctx || !this.engine.playing) return;
    const project = this.engine.project;
    const active = new Set();
    const speechActive = project.clips.some((c) => c.type === 'video' && c.audio?.duckingSource && this.engine.time >= c.start && this.engine.time < c.start + c.duration);
    for (const clip of project.clips) {
      if (!['audio', 'video'].includes(clip.type)) continue;
      const key = `${clip.id}:${clip.assetId}`;
      const player = this.players.get(key);
      if (!player) continue;
      const on = this.engine.time >= clip.start && this.engine.time < clip.start + clip.duration;
      if (!on && !clip.audio?.muted) {
        if (!player.media.paused) player.media.pause();
        continue;
      }
      active.add(player);
      const local = (this.engine.time - clip.start) / TICKS;
      const wanted = toSeconds(clip.inPoint) + local * (clip.speed || 1);
      if (Math.abs(player.media.currentTime - wanted) > 0.18 && !player.media.seeking) {
        try { player.media.currentTime = Math.max(0, wanted); } catch { /* ignore */ }
      }
      if (player.media.paused) player.media.play().catch(() => {});
      player.media.playbackRate = this.engine.rate * (clip.speed || 1);
      const a = clip.audio || {};
      let gain = Number(a.gain ?? 1) * Number(this.engine.project.master?.volume ?? 1);
      if (a.fadeIn) gain *= clamp(local / a.fadeIn, 0, 1);
      if (a.fadeOut) gain *= clamp((toSeconds(clip.duration) - local) / a.fadeOut, 0, 1);
      if (a.ducking && speechActive) gain *= 1 - a.ducking;
      if (a.muted || !on) gain = 0;
      player.gain.gain.setTargetAtTime(clamp(gain, 0, 2), this.ctx.currentTime, 0.03);
      if (player.pan) player.pan.pan.setTargetAtTime(clamp(a.pan ?? 0, -1, 1), this.ctx.currentTime, 0.03);
      if (player.low) player.low.gain.value = (a.eqLow || 0) * 12;
      if (player.mid) player.mid.gain.value = (a.eqMid || 0) * 12;
      if (player.high) player.high.gain.value = (a.eqHigh || 0) * 12;
    }
    for (const [key, player] of this.players) {
      if (!active.has(player) && !player.media.paused) player.media.pause();
    }
    if (this.analyser && this.data) {
      this.analyser.getByteTimeDomainData(this.data);
      let peak = 0;
      for (const v of this.data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      this.peak += (peak - this.peak) * 0.25;
    }
  }

  destroy() {
    for (const player of this.players.values()) {
      player.media.pause();
      player.media.removeAttribute('src');
      player.media.load();
    }
    this.players.clear();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

export function drawEffectPreview(canvas, effectId) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0ea5e9'); g.addColorStop(0.5, '#f43f5e'); g.addColorStop(1, '#f59e0b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.arc(W * 0.5, H * 0.5, H * 0.24, 0, Math.PI * 2); ctx.fill();
}
