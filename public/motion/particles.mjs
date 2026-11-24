/* Deterministic particle simulation shared by the browser preview and the
 * server renderer. Particles are analytic (not integrated frame by frame), so
 * seeking, parallel rendering and repeated exports produce identical frames.
 * Positions are normalised to the composition (0..1); sizes are fractions of
 * the composition height. */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PARTICLE_PRESETS = {
  fire: { spawn: 'bottom', spread: 0.22, gravity: -0.12, turbulence: 0.05, sizeCurve: 'grow', opacity: 0.85, additive: true },
  explosion: { spawn: 'burst', gravity: 0.25, turbulence: 0.1, sizeCurve: 'grow', opacity: 1, additive: true },
  smoke: { spawn: 'bottom', spread: 0.35, gravity: -0.03, turbulence: 0.08, sizeCurve: 'grow', opacity: 0.42, additive: false },
  fog: { spawn: 'edges', spread: 0.9, gravity: 0, turbulence: 0.02, sizeCurve: 'grow', opacity: 0.25, additive: false },
  dust: { spawn: 'random', gravity: 0.01, turbulence: 0.05, sizeCurve: 'grow', opacity: 0.4, additive: false },
  sparks: { spawn: 'burst', gravity: 1.1, turbulence: 0.04, sizeCurve: 'shrink', opacity: 1, additive: true },
  embers: { spawn: 'bottom', spread: 0.5, gravity: -0.03, turbulence: 0.06, sizeCurve: 'shrink', opacity: 0.9, additive: true },
  lightning: { spawn: 'bolt', gravity: 0, turbulence: 0, sizeCurve: 'none', opacity: 1, additive: true },
  rain: { spawn: 'top', spread: 1, gravity: 0.55, turbulence: 0.01, sizeCurve: 'none', opacity: 0.55, additive: false, streak: 0.06 },
  snow: { spawn: 'top', spread: 1, gravity: 0.02, turbulence: 0.04, sizeCurve: 'none', opacity: 0.85, additive: false },
  splash: { spawn: 'burst', gravity: 1.0, turbulence: 0.06, sizeCurve: 'shrink', opacity: 0.9, additive: false },
  energy: { spawn: 'center', spread: 0.4, gravity: 0, turbulence: 0.12, sizeCurve: 'shrink', opacity: 0.9, additive: true },
  magic: { spawn: 'random', gravity: -0.02, turbulence: 0.1, sizeCurve: 'shrink', opacity: 1, additive: true },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '#ffffff'));
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

export function mixColor(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * clamp01(t)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function sampleColorGradient(colors, t) {
  const list = Array.isArray(colors) && colors.length ? colors : ['#ffffff'];
  if (list.length === 1) return list[0];
  const at = clamp01(t) * (list.length - 1);
  const i = Math.floor(at);
  return mixColor(list[i], list[Math.min(list.length - 1, i + 1)], at - i);
}

/* Analytic emission: particle i is born at i/rate. This avoids storing a
 * simulation history and makes the result independent of frame rate. */
export function sampleParticles(params = {}, time, options = {}) {
  const presetName = params.preset || 'fire';
  const preset = PARTICLE_PRESETS[presetName] || PARTICLE_PRESETS.fire;
  const p = { ...preset, ...params };
  const seed = Math.max(1, Number(options.seed ?? p.seed ?? 1)) >>> 0;
  const aspect = Number(options.aspect) || 16 / 9;
  const timeSec = Math.max(0, Number(time) || 0);
  const life = Math.max(0.05, Number(p.life) || 1.5);
  const rate = Math.max(0, Number(p.rate) || 0);
  const burst = Math.max(0, Math.min(1200, Number(p.burst) || 0));
  const max = Math.max(1, Math.min(1400, Number(p.max) || 700));
  const speed = Number(p.speed) || 0.3;
  const size = Math.max(0.0005, Number(p.size) || 0.03);
  const gravity = Number(p.gravity) || 0;
  const turbulence = Number(p.turbulence) || 0;
  const opacity = p.opacity ?? 0.8;
  const colors = Array.isArray(p.colors) && p.colors.length ? p.colors : ['#ffffff'];
  const out = [];

  if (presetName === 'lightning' || p.spawn === 'bolt') {
    const interval = Math.max(0.25, Number(p.interval) || 1.4);
    const n = Math.floor(timeSec / interval);
    for (let k = Math.max(0, n - 2); k <= n; k += 1) {
      const birth = k * interval;
      const age = timeSec - birth;
      if (age < 0 || age > 0.42) continue;
      const rnd = mulberry32(seed + k * 7919);
      const startX = 0.15 + rnd() * 0.7;
      const segments = [];
      let x = startX;
      let y = 0;
      const steps = 12;
      for (let s = 0; s < steps; s += 1) {
        segments.push([x, y]);
        x += (rnd() - 0.5) * 0.09;
        y += 1 / steps;
      }
      out.push({
        kind: 'bolt', x: startX, y: 0.5, points: segments, color: colors[0],
        alpha: (1 - age / 0.42) * opacity, width: Math.max(0.001, size), additive: true,
      });
    }
    return out;
  }

  const emitAt = Math.max(0, Number(p.emitAt) || 0);
  const births = [];
  if (burst) {
    for (let i = 0; i < burst; i += 1) births.push(emitAt + (i / Math.max(1, burst)) * 0.05);
  }
  if (rate) {
    const first = Math.max(0, Math.ceil((timeSec - life) * rate));
    const last = Math.floor(timeSec * rate);
    for (let i = first; i <= last; i += 1) births.push(emitAt + i / rate);
    if (births.length > max) births.splice(0, births.length - max);
  }

  const spawnPoint = (rnd, i) => {
    const spread = Number(p.spread) || 0.2;
    switch (p.spawn) {
      case 'bottom': return [0.5 + (rnd() - 0.5) * spread, 1.02 + rnd() * 0.03];
      case 'top': return [rnd() * 1.05 - 0.02, -0.02 - rnd() * 0.05];
      case 'edges': {
        const edge = rnd();
        if (edge < 0.5) return [rnd(), -0.03];
        return [edge < 0.75 ? -0.03 : 1.03, rnd()];
      }
      case 'center': return [0.5 + (rnd() - 0.5) * spread, 0.5 + (rnd() - 0.5) * spread];
      case 'burst': return [0.5, 0.52];
      default: return [rnd() * 1.04 - 0.02, rnd() * 1.04 - 0.02];
    }
  };

  for (let i = 0; i < births.length; i += 1) {
    const age = timeSec - births[i];
    if (age < 0 || age > life) continue;
    const rnd = mulberry32(seed + i * 2654435761);
    const [sx, sy] = spawnPoint(rnd, i);
    const angle = rnd() * Math.PI * 2;
    const spread = Number(p.spread) || 0.3;
    let vx;
    let vy;
    if (p.spawn === 'burst') {
      const a = -Math.PI * 0.82 + rnd() * Math.PI * 1.64;
      const speedScale = 0.35 + rnd() * 0.9;
      vx = Math.cos(a) * speed * speedScale;
      vy = Math.sin(a) * speed * speedScale;
    } else if (p.spawn === 'top') {
      vx = (rnd() - 0.5) * (p.streak ? 0.04 : 0.18);
      vy = speed * (0.75 + rnd() * 0.5);
    } else if (p.spawn === 'center') {
      vx = Math.cos(angle) * speed * (0.4 + rnd() * 0.9);
      vy = Math.sin(angle) * speed * (0.4 + rnd() * 0.9);
    } else if (p.spawn === 'bottom') {
      vx = (rnd() - 0.5) * 0.12 * (1 + spread);
      vy = -speed * (0.55 + rnd() * 0.9);
    } else {
      vx = (rnd() - 0.5) * speed * 0.6;
      vy = (rnd() - 0.5) * speed * 0.6;
    }
    const n1 = Math.sin(age * 2.7 + rnd() * 24.0);
    const n2 = Math.cos(age * 2.1 + i * 0.71);
    const x = sx + vx * age + n1 * turbulence * age * (p.spawn === 'top' ? 3 : 1.2);
    const y = sy + vy * age + 0.5 * gravity * age * age + n2 * turbulence * age * 0.45;
    if (x < -0.25 || x > 1.25 || y < -0.25 || y > 1.25) continue;
    const lifeRatio = age / life;
    let sz = size;
    if (preset.sizeCurve === 'grow') sz = size * (0.35 + lifeRatio * 1.15);
    if (preset.sizeCurve === 'shrink') sz = size * (1 - lifeRatio * 0.85);
    if (p.sizeCurve === 'grow') sz = size * (0.35 + lifeRatio * 1.15);
    if (p.sizeCurve === 'shrink') sz = size * (1 - lifeRatio * 0.85);
    const fadeIn = presetName === 'rain' || presetName === 'snow' ? 1 : clamp01(lifeRatio * 7);
    const alpha = clamp01(fadeIn * (1 - lifeRatio ** 1.6)) * opacity * (0.55 + rnd() * 0.45);
    if (alpha <= 0.002) continue;
    out.push({
      kind: p.streak ? 'streak' : p.spawn === 'burst' && (presetName === 'sparks' || presetName === 'explosion') ? 'spark' : 'soft',
      x, y, size: sz, alpha,
      color: sampleColorGradient(colors, lifeRatio * 0.9 + rnd() * 0.1),
      rotation: rnd() * Math.PI * 2 + age * (2 + rnd() * 5),
      additive: !!p.additive,
      streak: p.streak || (presetName === 'sparks' ? 0.035 : 0),
      vx, vy, aspect,
    });
  }
  return out;
}

/* A compact deterministic hash for per-clip seeds, so moving a clip does not
 * restart its particle pattern. */
export function seedFromString(value) {
  let h = 2166136261;
  for (const ch of String(value || '')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/* Audio-reactive particles can use a precomputed envelope. Values are 0..1. */
export function envelopeAt(peaks, timeSec, durationSec) {
  if (!Array.isArray(peaks) || !peaks.length || !durationSec) return 0.5;
  const at = clamp01(timeSec / durationSec) * (peaks.length - 1);
  const i = Math.floor(at);
  const a = Array.isArray(peaks[i]) ? peaks[i][0] : Number(peaks[i]) || 0;
  return clamp01(a);
}
