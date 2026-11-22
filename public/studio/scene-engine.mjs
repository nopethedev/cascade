/* Renderer-independent Studio scene engine.
 *
 * Keep this module free of DOM, Three.js and network access so the same code
 * can be exercised by Node tests. studio.js uses it to build viewport meshes,
 * move the orbit camera, apply gizmo drags and turn a transform into the exact
 * relay command. The test suite also rasterises a deterministic frame from
 * these descriptors when a WebGL context is not available.
 */

export const RENDERABLE_SERVICES = ['Workspace', 'Lighting', 'ReplicatedStorage', 'ServerScriptService', 'StarterGui'];
export const EXCLUDED_CLASS = /Script|Module|Gui|Frame|Label|Button|Image|Scrolling|UIList|UIPadding|UICorner|UIStroke|UIGradient|Sound|Camera/;
export const IDENTITY_SIZE = Object.freeze({ x: 4, y: 1, z: 4 });
export const IDENTITY_POSITION = Object.freeze({ x: 0, y: 0, z: 0 });
export const IDENTITY_ROTATION = Object.freeze({ rx: 0, ry: 0, rz: 0 });
export const DEFAULT_BREAKPOINTS = Object.freeze({ tablet: 860, mobile: 600 });

const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, places = 4) => {
  const power = 10 ** places;
  return Math.round(finite(value) * power) / power;
};

export function classNameOf(node) {
  return String(node?.className || node?.props?.ClassName || 'Instance');
}

export function propsOf(node) {
  return node?.props && typeof node.props === 'object' ? node.props : {};
}

export function isRenderableNode(node) {
  const className = classNameOf(node);
  if (EXCLUDED_CLASS.test(className)) return false;
  const props = propsOf(node);
  if (props.Size || /Model|Folder|Service|Workspace|Lighting|Storage/.test(className)) return true;
  return false;
}

export function normalizeSize(value) {
  const size = value && typeof value === 'object' ? value : IDENTITY_SIZE;
  return {
    x: Math.max(0.05, finite(size.x, IDENTITY_SIZE.x)),
    y: Math.max(0.05, finite(size.y, IDENTITY_SIZE.y)),
    z: Math.max(0.05, finite(size.z, IDENTITY_SIZE.z)),
  };
}

export function normalizePosition(value) {
  if (!value || typeof value !== 'object') return { ...IDENTITY_POSITION };
  return { x: finite(value.x), y: finite(value.y), z: finite(value.z) };
}

export function normalizeRotation(value) {
  if (!value || typeof value !== 'object') return { ...IDENTITY_ROTATION };
  return { rx: finite(value.rx), ry: finite(value.ry), rz: finite(value.rz) };
}

export function normalizeColor(value, fallback = '#64748b') {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}

export function snapshotTransform(node) {
  const props = propsOf(node);
  const cframe = props.CFrame && typeof props.CFrame === 'object' ? props.CFrame : null;
  const position = normalizePosition(cframe && cframe.x !== undefined ? cframe : props.Position);
  const rotation = normalizeRotation(cframe);
  return {
    id: node?.id,
    position,
    rotation,
    size: normalizeSize(props.Size),
    hasCFrame: !!cframe,
    cframe: cframe ? { ...cframe } : null,
  };
}

export function buildSceneMeshes(scene, { services = RENDERABLE_SERVICES } = {}) {
  const roots = Array.isArray(scene?.services) ? scene.services : [];
  const out = [];
  const serviceNames = new Set([...services, 'Workspace', 'Lighting', 'ReplicatedStorage', 'ReplicatedFirst', 'ServerStorage', 'ServerScriptService', 'StarterGui', 'StarterPack', 'StarterPlayer', 'SoundService', 'Teams']);
  const walk = (node, parentId, depth) => {
    if (!node || depth > 64) return;
    // Service roots are containers, not renderable parts.
    if (depth === 0 && serviceNames.has(String(node.name || classNameOf(node)))) {
      for (const child of node.children || []) walk(child, node.id, depth + 1);
      return;
    }
    if (isRenderableNode(node)) {
      const props = propsOf(node);
      const transform = snapshotTransform(node);
      out.push({
        id: String(node.id || ''),
        name: String(node.name || classNameOf(node)),
        className: classNameOf(node),
        parentId: parentId || null,
        depth,
        position: transform.position,
        rotation: transform.rotation,
        size: transform.size,
        color: normalizeColor(props.Color),
        material: String(props.Material || 'Plastic'),
        transparency: clamp(finite(props.Transparency), 0, 1),
      });
    }
    for (const child of node.children || []) walk(child, node.id, depth + 1);
  };
  for (const root of roots) {
    const name = String(root?.name || classNameOf(root));
    if (!services.includes(name) && !services.includes(classNameOf(root))) continue;
    walk(root, null, 0);
  }
  return out;
}

export function orbitPosition({ target = IDENTITY_POSITION, radius = 34, theta = 0.8, phi = 1.05 } = {}) {
  const t = normalizePosition(target);
  const r = Math.max(0.01, finite(radius, 34));
  const p = clamp(finite(phi, 1.05), 0.08, Math.PI - 0.08);
  return {
    x: t.x + r * Math.sin(p) * Math.sin(theta),
    y: t.y + r * Math.cos(p),
    z: t.z + r * Math.sin(p) * Math.cos(theta),
  };
}

export function orbitCamera(state, dx, dy) {
  return {
    theta: finite(state?.theta, 0.8) - finite(dx) * 0.006,
    phi: clamp(finite(state?.phi, 1.05) - finite(dy) * 0.006, 0.08, Math.PI - 0.08),
  };
}

export function zoomCamera(radius, deltaY) {
  return clamp(finite(radius, 34) + finite(deltaY) * 0.035, 3, 150);
}

export function screenPanDelta({ dx = 0, dy = 0, radius = 34, right = { x: 1, y: 0, z: 0 }, up = { x: 0, y: 1, z: 0 } } = {}) {
  const factor = Math.max(0.01, finite(radius, 34)) * 0.0016;
  return {
    x: (finite(right.x) * -finite(dx) + finite(up.x) * finite(dy)) * factor,
    y: (finite(right.y) * -finite(dx) + finite(up.y) * finite(dy)) * factor,
    z: (finite(right.z) * -finite(dx) + finite(up.z) * finite(dy)) * factor,
  };
}

export function snapValue(value, step) {
  const s = Math.abs(finite(step));
  return s ? Math.round(finite(value) / s) * s : finite(value);
}

export function snapAngle(radians, enabled, degrees = 15) {
  if (!enabled) return finite(radians);
  const step = (Math.PI / 180) * Math.max(1, finite(degrees, 15));
  return Math.round(finite(radians) / step) * step;
}

/** Apply one pointer drag to a transform. axis restricts movement to x/y/z. */
export function applyGizmoDrag(start, options = {}) {
  const mode = options.mode || 'move';
  const dx = finite(options.dx);
  const dy = finite(options.dy);
  const radius = Math.max(0.01, finite(options.radius, 34));
  const axis = ['x', 'y', 'z'].includes(options.axis) ? options.axis : null;
  const space = options.space === 'local' ? 'local' : 'world';
  const snapStep = Math.abs(finite(options.snapStep));
  const rotationSnap = !!options.rotationSnap;
  const degreeStep = Math.max(1, finite(options.rotationDegrees, 15));
  const base = {
    position: normalizePosition(start?.position),
    rotation: normalizeRotation(start?.rotation),
    size: normalizeSize(start?.size),
    hasCFrame: !!start?.hasCFrame,
    cframe: start?.cframe ? { ...start.cframe } : null,
    id: start?.id,
  };

  if (mode === 'rotate') {
    const next = { ...base, rotation: { ...base.rotation } };
    next.rotation.ry = round(snapAngle(base.rotation.ry * (Math.PI / 180) + dx * 0.012, rotationSnap, degreeStep) * (180 / Math.PI), 6);
    return next;
  }

  if (mode === 'scale') {
    const factor = clamp(1 + (dx - dy) * 0.004, 0.05, 20);
    const size = {
      x: Math.max(0.05, base.size.x * factor),
      y: Math.max(0.05, base.size.y * factor),
      z: Math.max(0.05, base.size.z * factor),
    };
    return { ...base, size };
  }

  // Move. Screen x maps to world x, screen y maps to world z. Local space
  // rotates that screen delta by the object's yaw.
  let localX = dx * radius * 0.0018;
  let localZ = dy * radius * 0.0018;
  if (axis === 'x') localZ = 0;
  if (axis === 'z') localX = 0;
  if (axis === 'y') { localX = 0; localZ = 0; }
  let deltaX = localX;
  let deltaZ = localZ;
  if (space === 'local') {
    const yaw = base.rotation.ry * (Math.PI / 180);
    deltaX = localX * Math.cos(yaw) + localZ * Math.sin(yaw);
    deltaZ = -localX * Math.sin(yaw) + localZ * Math.cos(yaw);
  }
  const position = {
    x: base.position.x + deltaX,
    y: base.position.y,
    z: base.position.z + deltaZ,
  };
  if (axis === 'y') position.y = base.position.y + (dy || dx) * radius * 0.0018;
  position.x = snapValue(position.x, snapStep);
  position.z = snapValue(position.z, snapStep);
  return { ...base, position };
}

/** Build the minimal relay update for a finished gizmo drag. */
export function transformCommand(nodeId, start, next, mode) {
  if (!nodeId) return null;
  const props = {};
  if (mode === 'move') {
    props.Position = {
      x: round(next.position.x),
      y: round(next.position.y),
      z: round(next.position.z),
    };
    if (start?.hasCFrame) {
      props.CFrame = {
        ...(start.cframe || {}),
        ...props.Position,
        rx: round(start.rotation.rx),
        ry: round(start.rotation.ry),
        rz: round(start.rotation.rz),
      };
    }
  } else if (mode === 'rotate') {
    const position = {
      x: round(start.position.x),
      y: round(start.position.y),
      z: round(start.position.z),
    };
    props.CFrame = {
      ...(start.cframe || {}),
      ...position,
      rx: round(next.rotation.rx),
      ry: round(next.rotation.ry),
      rz: round(next.rotation.rz),
    };
  } else if (mode === 'scale') {
    props.Size = {
      x: round(next.size.x),
      y: round(next.size.y),
      z: round(next.size.z),
    };
  } else {
    return null;
  }
  return { kind: 'update', payload: { instanceId: nodeId, props } };
}

/** Compare two renderable snapshots and emit only the changed properties. */
export function sceneDiff(previous, next) {
  const before = new Map((previous || []).map((item) => [item.id, item]));
  const after = new Map((next || []).map((item) => [item.id, item]));
  const events = [];
  for (const [id, item] of after) {
    const old = before.get(id);
    if (!old) { events.push({ kind: 'create', payload: { instanceId: id, className: item.className } }); continue; }
    const props = {};
    if (JSON.stringify(old.position) !== JSON.stringify(item.position)) props.Position = item.position;
    if (JSON.stringify(old.rotation) !== JSON.stringify(item.rotation)) props.CFrame = { ...item.position, ...item.rotation };
    if (JSON.stringify(old.size) !== JSON.stringify(item.size)) props.Size = item.size;
    if (JSON.stringify(old.color) !== JSON.stringify(item.color)) props.Color = item.color;
    if (Object.keys(props).length) events.push({ kind: 'update', payload: { instanceId: id, props } });
  }
  for (const id of before.keys()) if (!after.has(id)) events.push({ kind: 'delete', payload: { instanceId: id } });
  return events;
}

export function gridConfig(size = 160, divisions = 160) {
  const s = Math.max(1, Math.floor(finite(size, 160)));
  const d = clamp(Math.floor(finite(divisions, s)), 1, 500);
  return { size: s, divisions: d, spacing: s / d };
}

// --------------------------- deterministic frame ---------------------------
// A tiny wireframe rasteriser used only when WebGL cannot be created. It is not
// a replacement for Three.js; it proves scene descriptors, camera framing and
// projected geometry are real and produces a stable trace for regression tests.

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

export function projectPoint(point, camera, width, height) {
  const eye = normalizePosition(camera?.position || orbitPosition(camera));
  const target = normalizePosition(camera?.target || IDENTITY_POSITION);
  const forward = norm(sub(target, eye));
  const right = norm(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const rel = sub(point, eye);
  const depth = Math.max(0.01, dot(rel, forward));
  const fov = (finite(camera?.fov, 48) * Math.PI) / 180;
  const focal = (height / 2) / Math.tan(fov / 2);
  return {
    x: width / 2 + (dot(rel, right) / depth) * focal,
    y: height / 2 - (dot(rel, up) / depth) * focal,
    depth,
  };
}

function corners(item) {
  const { x, y, z } = item.position;
  const { x: sx, y: sy, z: sz } = item.size;
  const out = [];
  for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
    out.push({ x: x + dx * sx, y: y + dy * sy, z: z + dz * sz });
  }
  return out;
}

const EDGES = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];

function hexRgb(hex) {
  const value = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex.slice(1) : '64748b';
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export function frameTrace(scene, camera = {}, width = 640, height = 400, options = {}) {
  const w = Math.max(16, Math.floor(width));
  const h = Math.max(16, Math.floor(height));
  const descriptors = Array.isArray(scene) ? scene : buildSceneMeshes(scene);
  const pixels = new Uint8Array(w * h * 3);
  for (let i = 0; i < pixels.length; i += 3) { pixels[i] = 11; pixels[i + 1] = 16; pixels[i + 2] = 24; }
  let segments = 0;
  const drawLine = (a, b, rgb) => {
    let x0 = Math.round(a.x), y0 = Math.round(a.y), x1 = Math.round(b.x), y1 = Math.round(b.y);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < w * h * 2; guard += 1) {
      if (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) {
        const i = (y0 * w + x0) * 3;
        pixels[i] = rgb[0]; pixels[i + 1] = rgb[1]; pixels[i + 2] = rgb[2];
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    segments += 1;
  };
  const cam = {
    position: camera.position || orbitPosition(camera),
    target: camera.target || IDENTITY_POSITION,
    fov: camera.fov,
  };
  if (options.grid) {
    const size = Math.max(4, finite(options.gridSize, 28));
    const divisions = clamp(Math.floor(finite(options.gridDivisions, 14)), 2, 100);
    const half = size / 2;
    const rgb = [38, 48, 66];
    for (let i = 0; i <= divisions; i += 1) {
      const t = -half + (size / divisions) * i;
      drawLine(projectPoint({ x: t, y: 0, z: -half }, cam, w, h), projectPoint({ x: t, y: 0, z: half }, cam, w, h), rgb);
      drawLine(projectPoint({ x: -half, y: 0, z: t }, cam, w, h), projectPoint({ x: half, y: 0, z: t }, cam, w, h), rgb);
    }
    drawLine(projectPoint({ x: 0, y: 0, z: -half }, cam, w, h), projectPoint({ x: 0, y: 0, z: half }, cam, w, h), [127, 29, 29]);
  }
  for (const item of descriptors) {
    const projected = corners(item).map((point) => projectPoint(point, cam, w, h));
    const rgb = hexRgb(item.color);
    for (const [a, b] of EDGES) {
      if (projected[a].depth > 0 && projected[b].depth > 0) drawLine(projected[a], projected[b], rgb);
    }
  }
  let visible = 0;
  let hash = 2166136261;
  for (let i = 0; i < pixels.length; i += 1) {
    if (pixels[i] !== (i % 3 === 0 ? 11 : i % 3 === 1 ? 16 : 24)) visible += 1;
    hash ^= pixels[i];
    hash = Math.imul(hash, 16777619);
  }
  return {
    width: w,
    height: h,
    pixels,
    segments,
    visiblePixels: visible / 3,
    hash: (hash >>> 0).toString(16).padStart(8, '0'),
    meshes: descriptors.length,
  };
}
