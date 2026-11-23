/* Cascade Game Studio project schema and shared helpers.
   This module is imported by both the browser editor and the server build
   pipeline, so it must stay free of DOM and Node-only APIs. */

export const GAME_SCHEMA_VERSION = 1;
export const GAME_DEFAULT_WIDTH = 960;
export const GAME_DEFAULT_HEIGHT = 540;

const HEX = /^#[0-9a-f]{3,8}$/i;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function gid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function safeColor(value, fallback = '#f4f4f5') {
  return HEX.test(String(value || '')) ? String(value) : fallback;
}

export function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export const COMPONENT_DEFS = {
  SpriteRenderer: {
    label: 'Sprite Renderer',
    fields: [
      { key: 'color', label: 'Color', type: 'color', fallback: '#e11d48' },
      { key: 'assetId', label: 'Image asset', type: 'asset' },
      { key: 'width', label: 'Width', type: 'number' },
      { key: 'height', label: 'Height', type: 'number' },
      { key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'flipX', label: 'Flip X', type: 'boolean' },
      { key: 'filter', label: 'Filter', type: 'select', options: ['nearest', 'linear'] },
      { key: 'shape', label: 'Fallback shape', type: 'select', options: ['rect', 'circle', 'capsule'] },
    ],
  },
  AnimatedSprite: {
    label: 'Animated Sprite',
    fields: [
      { key: 'frames', label: 'Frame asset ids (comma separated)', type: 'text' },
      { key: 'fps', label: 'FPS', type: 'number', min: 1, max: 60 },
      { key: 'loop', label: 'Loop', type: 'boolean' },
      { key: 'playing', label: 'Playing', type: 'boolean' },
      { key: 'animation', label: 'Current animation', type: 'text' },
    ],
  },
  Rigidbody2D: {
    label: 'Rigidbody 2D',
    fields: [
      { key: 'bodyType', label: 'Body type', type: 'select', options: ['dynamic', 'static', 'kinematic'] },
      { key: 'gravityScale', label: 'Gravity scale', type: 'number', step: 0.1 },
      { key: 'mass', label: 'Mass', type: 'number', min: 0.01, step: 0.1 },
      { key: 'friction', label: 'Friction', type: 'number', min: 0, max: 2, step: 0.05 },
      { key: 'restitution', label: 'Restitution', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'fixedRotation', label: 'Fixed rotation', type: 'boolean' },
      { key: 'linearDamping', label: 'Linear damping', type: 'number', min: 0, max: 1, step: 0.01 },
    ],
  },
  Collider2D: {
    label: 'Collider 2D',
    fields: [
      { key: 'shape', label: 'Shape', type: 'select', options: ['rectangle', 'circle', 'capsule'] },
      { key: 'width', label: 'Width', type: 'number' },
      { key: 'height', label: 'Height', type: 'number' },
      { key: 'radius', label: 'Radius', type: 'number' },
      { key: 'offsetX', label: 'Offset X', type: 'number' },
      { key: 'offsetY', label: 'Offset Y', type: 'number' },
      { key: 'sensor', label: 'Trigger / sensor', type: 'boolean' },
      { key: 'friction', label: 'Friction', type: 'number', step: 0.05 },
      { key: 'restitution', label: 'Restitution', type: 'number', step: 0.05 },
      { key: 'layer', label: 'Layer', type: 'number' },
      { key: 'mask', label: 'Collision mask', type: 'number' },
    ],
  },
  Camera2D: {
    label: 'Camera 2D',
    fields: [
      { key: 'follow', label: 'Follow entity id', type: 'entity' },
      { key: 'zoom', label: 'Zoom', type: 'number', min: 0.1, max: 8, step: 0.1 },
      { key: 'smoothing', label: 'Smoothing', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'pixelPerfect', label: 'Pixel perfect', type: 'boolean' },
      { key: 'shake', label: 'Shake', type: 'number', min: 0 },
      { key: 'boundsX', label: 'Bounds x', type: 'number' },
      { key: 'boundsY', label: 'Bounds y', type: 'number' },
      { key: 'boundsW', label: 'Bounds width', type: 'number' },
      { key: 'boundsH', label: 'Bounds height', type: 'number' },
    ],
  },
  AudioSource: {
    label: 'Audio Source',
    fields: [
      { key: 'assetId', label: 'Audio asset', type: 'asset' },
      { key: 'volume', label: 'Volume', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'pitch', label: 'Pitch', type: 'number', min: 0.25, max: 4, step: 0.05 },
      { key: 'loop', label: 'Loop', type: 'boolean' },
      { key: 'autoplay', label: 'Autoplay', type: 'boolean' },
      { key: 'bus', label: 'Bus', type: 'select', options: ['master', 'music', 'sfx'] },
    ],
  },
  AudioListener: { label: 'Audio Listener', fields: [] },
  ParticleEmitter: {
    label: 'Particle Emitter',
    fields: [
      { key: 'preset', label: 'Preset', type: 'select', options: ['sparks', 'fire', 'smoke', 'rain', 'snow', 'magic', 'explosion', 'dust'] },
      { key: 'rate', label: 'Rate / sec', type: 'number', min: 0 },
      { key: 'lifetime', label: 'Lifetime (s)', type: 'number', min: 0.05 },
      { key: 'speed', label: 'Speed', type: 'number' },
      { key: 'gravity', label: 'Gravity', type: 'number' },
      { key: 'size', label: 'Size', type: 'number' },
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'burst', label: 'Burst count', type: 'number', min: 0 },
    ],
  },
  Tilemap: {
    label: 'Tilemap',
    fields: [
      { key: 'tileSize', label: 'Tile size', type: 'number', min: 4 },
      { key: 'cols', label: 'Columns', type: 'number', min: 1 },
      { key: 'rows', label: 'Rows', type: 'number', min: 1 },
      { key: 'color', label: 'Tile color', type: 'color' },
      { key: 'collides', label: 'Collision tiles', type: 'boolean' },
      { key: 'data', label: 'Tile data (0 empty, 1 solid)', type: 'json' },
    ],
  },
  TextRenderer: {
    label: 'Text Renderer',
    fields: [
      { key: 'text', label: 'Text', type: 'textarea' },
      { key: 'size', label: 'Font size', type: 'number', min: 4 },
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'align', label: 'Align', type: 'select', options: ['left', 'center', 'right'] },
      { key: 'font', label: 'Font', type: 'text' },
    ],
  },
  Light2D: {
    label: 'Light 2D',
    fields: [
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'radius', label: 'Radius', type: 'number', min: 1 },
      { key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 2, step: 0.05 },
      { key: 'type', label: 'Type', type: 'select', options: ['point', 'ambient'] },
    ],
  },
  ScriptComponent: {
    label: 'Script Component',
    fields: [{ key: 'scriptId', label: 'Visual / code script', type: 'script' }],
  },
  UIElement: {
    label: 'UI Element',
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', options: ['text', 'button', 'panel', 'bar', 'image'] },
      { key: 'text', label: 'Text', type: 'textarea' },
      { key: 'binding', label: 'Variable binding', type: 'text' },
      { key: 'prefix', label: 'Text prefix', type: 'text' },
      { key: 'x', label: 'X', type: 'number' },
      { key: 'y', label: 'Y', type: 'number' },
      { key: 'w', label: 'Width', type: 'number' },
      { key: 'h', label: 'Height', type: 'number' },
      { key: 'anchor', label: 'Anchor', type: 'select', options: ['top-left', 'top-center', 'top-right', 'center'] },
      { key: 'size', label: 'Font size', type: 'number' },
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'fill', label: 'Fill', type: 'color' },
      { key: 'value', label: 'Progress value', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'visible', label: 'Visible', type: 'boolean' },
      { key: 'clickable', label: 'Clickable', type: 'boolean' },
    ],
  },
  NavigationAgent2D: {
    label: 'Navigation Agent',
    fields: [
      { key: 'target', label: 'Target entity id', type: 'entity' },
      { key: 'speed', label: 'Speed', type: 'number' },
      { key: 'behavior', label: 'Behavior', type: 'select', options: ['follow', 'chase', 'flee', 'wander'] },
      { key: 'range', label: 'Range', type: 'number' },
    ],
  },
  Joint2D: {
    label: 'Joint 2D',
    fields: [
      { key: 'type', label: 'Joint type', type: 'select', options: ['distance', 'revolute', 'fixed'] },
      { key: 'target', label: 'Target entity id', type: 'entity' },
      { key: 'stiffness', label: 'Stiffness', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'length', label: 'Length', type: 'number' },
    ],
  },
  PrefabInstance: {
    label: 'Prefab Instance',
    fields: [{ key: 'prefabId', label: 'Prefab id', type: 'text' }],
  },
  MeshRenderer: {
    label: 'Mesh Renderer',
    fields: [
      { key: 'mesh', label: 'Mesh', type: 'select', options: ['box', 'sphere', 'cylinder', 'cone', 'plane', 'capsule', 'torus', 'custom'] },
      { key: 'assetId', label: 'Model asset', type: 'asset' },
      { key: 'color', label: 'Base color', type: 'color' },
      { key: 'metalness', label: 'Metalness', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'roughness', label: 'Roughness', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'emissive', label: 'Emissive', type: 'color' },
      { key: 'emissiveIntensity', label: 'Emission strength', type: 'number', min: 0, max: 10, step: 0.1 },
      { key: 'textureAssetId', label: 'Albedo texture', type: 'asset' },
      { key: 'normalAssetId', label: 'Normal map', type: 'asset' },
      { key: 'castShadow', label: 'Cast shadow', type: 'boolean' },
      { key: 'receiveShadow', label: 'Receive shadow', type: 'boolean' },
      { key: 'instanced', label: 'GPU instancing', type: 'boolean' },
      { key: 'lod', label: 'LOD distance', type: 'number', min: 0 },
    ],
  },
  SkinnedMeshRenderer: {
    label: 'Skinned Mesh Renderer',
    fields: [
      { key: 'assetId', label: 'Model asset', type: 'asset' },
      { key: 'clip', label: 'Animation clip', type: 'text' },
      { key: 'speed', label: 'Speed', type: 'number', min: 0, step: 0.05 },
    ],
  },
  Camera3D: {
    label: 'Camera 3D',
    fields: [
      { key: 'fov', label: 'Field of view', type: 'number', min: 20, max: 120 },
      { key: 'near', label: 'Near', type: 'number', min: 0.01 },
      { key: 'far', label: 'Far', type: 'number', min: 1 },
      { key: 'orthographic', label: 'Orthographic', type: 'boolean' },
      { key: 'orthoSize', label: 'Ortho size', type: 'number', min: 1 },
      { key: 'follow', label: 'Follow entity id', type: 'entity' },
      { key: 'controller', label: 'Controller', type: 'select', options: ['orbit', 'firstPerson', 'thirdPerson'] },
      { key: 'offsetX', label: 'Follow offset X', type: 'number' },
      { key: 'offsetY', label: 'Follow offset Y', type: 'number' },
      { key: 'offsetZ', label: 'Follow offset Z', type: 'number' },
      { key: 'smoothing', label: 'Smoothing', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'yaw', label: 'First-person yaw (°)', type: 'number' },
    ],
  },
  Rigidbody3D: {
    label: 'Rigidbody 3D',
    fields: [
      { key: 'bodyType', label: 'Body type', type: 'select', options: ['dynamic', 'static', 'kinematic'] },
      { key: 'mass', label: 'Mass', type: 'number', min: 0.01 },
      { key: 'friction', label: 'Friction', type: 'number', min: 0, max: 2, step: 0.05 },
      { key: 'restitution', label: 'Restitution', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'linearDamping', label: 'Linear damping', type: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'angularDamping', label: 'Angular damping', type: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'gravityScale', label: 'Gravity scale', type: 'number', step: 0.1 },
      { key: 'fixedRotation', label: 'Fixed rotation', type: 'boolean' },
      { key: 'ccd', label: 'Continuous collision', type: 'boolean' },
    ],
  },
  Collider3D: {
    label: 'Collider 3D',
    fields: [
      { key: 'shape', label: 'Shape', type: 'select', options: ['box', 'sphere', 'capsule', 'cylinder', 'mesh'] },
      { key: 'width', label: 'Width', type: 'number' },
      { key: 'height', label: 'Height', type: 'number' },
      { key: 'depth', label: 'Depth', type: 'number' },
      { key: 'radius', label: 'Radius', type: 'number' },
      { key: 'sensor', label: 'Trigger / sensor', type: 'boolean' },
      { key: 'layer', label: 'Layer', type: 'number' },
      { key: 'mask', label: 'Collision mask', type: 'number' },
      { key: 'offsetX', label: 'Offset X', type: 'number' },
      { key: 'offsetY', label: 'Offset Y', type: 'number' },
      { key: 'offsetZ', label: 'Offset Z', type: 'number' },
    ],
  },
  CharacterController3D: {
    label: 'Character Controller',
    fields: [
      { key: 'speed', label: 'Walk speed', type: 'number', min: 0 },
      { key: 'runSpeed', label: 'Run speed', type: 'number', min: 0 },
      { key: 'jumpHeight', label: 'Jump height', type: 'number', min: 0 },
      { key: 'gravity', label: 'Gravity', type: 'number' },
      { key: 'cameraRelative', label: 'Camera relative', type: 'boolean' },
      { key: 'slopes', label: 'Max slope', type: 'number', min: 0, max: 89 },
      { key: 'stairs', label: 'Step height', type: 'number', min: 0 },
    ],
  },
  Light3D: {
    label: 'Light 3D',
    fields: [
      { key: 'type', label: 'Type', type: 'select', options: ['directional', 'point', 'spot', 'ambient', 'hemisphere'] },
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'intensity', label: 'Intensity', type: 'number', min: 0, step: 0.1 },
      { key: 'distance', label: 'Distance', type: 'number', min: 0 },
      { key: 'angle', label: 'Spot angle', type: 'number', min: 1, max: 89 },
      { key: 'penumbra', label: 'Penumbra', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'castShadow', label: 'Cast shadow', type: 'boolean' },
      { key: 'shadowQuality', label: 'Shadow map', type: 'select', options: ['512', '1024', '2048', '4096'] },
    ],
  },
  AudioSource3D: {
    label: 'Audio Source 3D',
    fields: [
      { key: 'assetId', label: 'Audio asset', type: 'asset' },
      { key: 'volume', label: 'Volume', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'pitch', label: 'Pitch', type: 'number', min: 0.25, max: 4, step: 0.05 },
      { key: 'loop', label: 'Loop', type: 'boolean' },
      { key: 'autoplay', label: 'Autoplay', type: 'boolean' },
      { key: 'spatial', label: 'Spatial audio', type: 'boolean' },
      { key: 'refDistance', label: 'Reference distance', type: 'number', min: 0.1 },
      { key: 'maxDistance', label: 'Max distance', type: 'number', min: 1 },
    ],
  },
  AnimationController3D: {
    label: 'Animation Controller 3D',
    fields: [
      { key: 'clip', label: 'Default clip', type: 'text' },
      { key: 'speed', label: 'Playback speed', type: 'number', min: 0, step: 0.05 },
      { key: 'loop', label: 'Loop', type: 'boolean' },
      { key: 'blend', label: 'Blend time', type: 'number', min: 0, step: 0.05 },
    ],
  },
  ParticleEmitter3D: {
    label: 'Particle Emitter 3D',
    fields: [
      { key: 'preset', label: 'Preset', type: 'select', options: ['smoke', 'dust', 'rain', 'snow', 'sparks', 'fire', 'magic'] },
      { key: 'rate', label: 'Rate / sec', type: 'number', min: 0 },
      { key: 'lifetime', label: 'Lifetime (s)', type: 'number', min: 0.05 },
      { key: 'speed', label: 'Speed', type: 'number' },
      { key: 'gravity', label: 'Gravity', type: 'number' },
      { key: 'size', label: 'Size', type: 'number' },
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'burst', label: 'Burst count', type: 'number', min: 0 },
      { key: 'worldSpace', label: 'World space', type: 'boolean' },
    ],
  },
  NavigationAgent3D: {
    label: 'Navigation Agent 3D',
    fields: [
      { key: 'target', label: 'Target entity id', type: 'entity' },
      { key: 'speed', label: 'Speed', type: 'number' },
      { key: 'behavior', label: 'Behavior', type: 'select', options: ['follow', 'chase', 'flee', 'wander'] },
      { key: 'range', label: 'Range', type: 'number' },
    ],
  },
  TerrainComponent: {
    label: 'Terrain',
    fields: [
      { key: 'size', label: 'Size', type: 'number', min: 1 },
      { key: 'segments', label: 'Segments', type: 'number', min: 2, max: 256 },
      { key: 'heightScale', label: 'Height scale', type: 'number' },
      { key: 'noise', label: 'Noise scale', type: 'number', min: 0.01, step: 0.05 },
      { key: 'seed', label: 'Seed', type: 'number' },
      { key: 'color', label: 'Base color', type: 'color' },
      { key: 'textureAssetId', label: 'Terrain texture', type: 'asset' },
    ],
  },
  Joint3D: {
    label: 'Joint 3D',
    fields: [
      { key: 'type', label: 'Joint type', type: 'select', options: ['distance', 'hinge', 'point'] },
      { key: 'target', label: 'Target entity id', type: 'entity' },
      { key: 'length', label: 'Length / hinge axis', type: 'number' },
      { key: 'stiffness', label: 'Stiffness', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },
};

export const COMPONENT_TYPES = Object.keys(COMPONENT_DEFS);

export const UI_KINDS = ['text', 'button', 'panel', 'bar', 'image'];

export function blankScene(name = 'Main Scene', id = gid('scene'), mode = '2d') {
  if (mode === '3d') {
    const camera = entity('Main Camera', {
      x: 8, y: 6, z: 12, w: 1, h: 1, d: 1,
      components: { Camera3D: { fov: 60, near: 0.1, far: 1000, controller: 'orbit', follow: '', smoothing: 0.15 } },
    });
    const sun = entity('Sun', { x: 6, y: 10, z: 4, w: 1, h: 1, d: 1, components: { Light3D: { type: 'directional', color: '#fff4df', intensity: 2.4, castShadow: true, shadowQuality: '2048' } } });
    const ground = entity('Ground', {
      x: 0, y: -0.5, z: 0, w: 24, h: 0.5, d: 24,
      components: {
        MeshRenderer: { mesh: 'box', color: '#334155', roughness: 0.82, metalness: 0.05, castShadow: false, receiveShadow: true },
        Rigidbody3D: { bodyType: 'static' },
        Collider3D: { shape: 'box', width: 24, height: 0.5, depth: 24 },
      },
    });
    return {
      id,
      name,
      background: '#0b0b12',
      gravity: { x: 0, y: -18, z: 0 },
      environment: { sky: 'gradient', top: '#111827', bottom: '#050508', fog: false, fogColor: '#111827', fogNear: 18, fogFar: 80 },
      entities: [camera, sun, ground],
    };
  }
  return {
    id,
    name,
    background: '#0b0b12',
    gravity: { x: 0, y: 980 },
    entities: [
      entity('Camera2D', { x: GAME_DEFAULT_WIDTH / 2, y: GAME_DEFAULT_HEIGHT / 2, w: 1, h: 1, components: { Camera2D: { follow: '', zoom: 1, smoothing: 0.15 } } }),
    ],
  };
}

export function blankProject(name = 'Untitled Game', mode = '2d') {
  const gameMode = mode === '3d' ? '3d' : '2d';
  const scene = blankScene('Main Scene', gid('scene'), gameMode);
  return {
    schema: GAME_SCHEMA_VERSION,
    mode: gameMode,
    project: {
      name,
      description: gameMode === '3d' ? 'A 3D game made with Cascade Game Studio.' : 'A game made with Cascade Game Studio.',
      width: GAME_DEFAULT_WIDTH,
      height: GAME_DEFAULT_HEIGHT,
      background: '#0b0b12',
      gravityX: 0,
      gravityY: gameMode === '3d' ? -18 : 980,
      gravityZ: 0,
      targetFps: 60,
      physicsTimestep: 1 / 60,
      pixelArt: false,
      debug: false,
      defaultScene: scene.id,
      input: defaultInputMap(),
      audio: { master: 1, music: 0.7, sfx: 0.9 },
      multiplayer: { enabled: false, url: '' },
      controls: gameMode === '3d' ? 'orbit' : 'none',
      render3d: {
        quality: 'medium', antialias: true, shadows: 'medium', toneMapping: 'aces', exposure: 1.05,
        environment: 'studio', sky: 'gradient', bloom: 0, dof: 0, ao: false, pixelRatio: 1,
      },
    },
    assets: [],
    scenes: [scene],
    prefabs: [],
    scripts: [],
    variables: {},
    activeScene: scene.id,
  };
}

export function defaultInputMap() {
  return {
    horizontal: { keys: ['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'], axis: 'KeyA:KeyD' },
    vertical: { keys: ['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS'], axis: 'KeyW:KeyS' },
    jump: { keys: ['Space'] },
    attack: { keys: ['KeyJ', 'ShiftLeft'] },
    interact: { keys: ['KeyE'] },
    pause: { keys: ['Escape'] },
  };
}

export function entity(name, options = {}) {
  return {
    id: options.id || gid('e'),
    name: String(name || 'Object'),
    parentId: options.parentId || null,
    type: options.type || 'entity',
    visible: options.visible !== false,
    locked: !!options.locked,
    tags: Array.isArray(options.tags) ? options.tags.map(String) : [],
    layer: safeNumber(options.layer, 0),
    zIndex: safeNumber(options.zIndex, 0),
    x: safeNumber(options.x, 0),
    y: safeNumber(options.y, 0),
    w: Math.max(1, safeNumber(options.w, 64)),
    h: Math.max(1, safeNumber(options.h, 64)),
    d: Math.max(0.01, safeNumber(options.d ?? options.depth, 64)),
    z: safeNumber(options.z, 0),
    rotation: safeNumber(options.rotation, 0),
    rotationX: safeNumber(options.rotationX, 0),
    rotationY: safeNumber(options.rotationY, 0),
    rotationZ: safeNumber(options.rotationZ, 0),
    scaleX: safeNumber(options.scaleX, 1),
    scaleY: safeNumber(options.scaleY, 1),
    scaleZ: safeNumber(options.scaleZ, 1),
    opacity: Math.max(0, Math.min(1, safeNumber(options.opacity, 1))),
    components: options.components && typeof options.components === 'object' ? clone(options.components) : {},
  };
}

export function addComponent(object, type, props = {}) {
  object.components[type] = { ...(object.components[type] || {}), ...clone(props) };
  return object;
}

export function prefab(name, entityData) {
  return { id: entityData.id || gid('prefab'), name, entity: clone(entityData) };
}

export function graphNode(type, x, y, config = {}) {
  return { id: gid('n'), type, x: safeNumber(x), y: safeNumber(y), config: clone(config) };
}

export function graphEdge(from, fromPin, to, toPin, kind = 'exec') {
  return { id: gid('w'), from: { node: from, pin: fromPin }, to: { node: to, pin: toPin }, kind };
}

export function gameScript(options = {}) {
  return {
    id: options.id || gid('s'),
    name: String(options.name || 'New Script'),
    type: options.type || 'visual',
    language: options.language || 'javascript',
    trigger: options.trigger || 'update',
    entityId: options.entityId || '',
    enabled: options.enabled !== false,
    graph: options.graph ? clone(options.graph) : { nodes: [], edges: [] },
    graphSnapshot: options.graphSnapshot ? clone(options.graphSnapshot) : null,
    code: String(options.code || ''),
    lua: String(options.lua || ''),
    jsSource: String(options.jsSource || ''),
  };
}

function normalizeEntity(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const object = entity(raw.name || `Object ${index + 1}`, {
    ...raw,
    x: raw.x ?? raw.transform?.x,
    y: raw.y ?? raw.transform?.y,
    z: raw.z ?? raw.transform?.z,
    w: raw.w ?? raw.transform?.w,
    h: raw.h ?? raw.transform?.h,
    d: raw.d ?? raw.depth ?? raw.transform?.d ?? raw.transform?.depth,
    rotation: typeof raw.rotation === 'number' ? raw.rotation : raw.transform?.rotation,
    rotationX: raw.rotationX ?? raw.rotation?.x ?? raw.transform?.rotationX,
    rotationY: raw.rotationY ?? raw.rotation?.y ?? raw.transform?.rotationY,
    rotationZ: raw.rotationZ ?? raw.rotation?.z ?? raw.transform?.rotationZ,
    scaleX: raw.scaleX ?? raw.transform?.scaleX,
    scaleY: raw.scaleY ?? raw.transform?.scaleY,
    scaleZ: raw.scaleZ ?? raw.transform?.scaleZ,
  });
  object.id = String(raw.id || object.id);
  object.parentId = raw.parentId ? String(raw.parentId) : null;
  object.tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
  object.zIndex = safeNumber(raw.zIndex ?? raw.z, 0);
  return object;
}

export function normalizeScene(raw, index = 0, mode = '2d') {
  const base = blankScene(raw?.name || `Scene ${index + 1}`, String(raw?.id || gid('scene')), mode);
  const entities = (Array.isArray(raw?.entities) ? raw.entities : base.entities)
    .map(normalizeEntity)
    .filter(Boolean)
    .map((object) => ({ ...object, parentId: object.parentId || null }));
  if (!entities.length) entities.push(...base.entities);
  return {
    id: String(raw?.id || base.id),
    name: String(raw?.name || base.name),
    background: safeColor(raw?.background, '#0b0b12'),
    gravity: { x: safeNumber(raw?.gravity?.x, 0), y: safeNumber(raw?.gravity?.y, mode === '3d' ? -18 : 980), z: safeNumber(raw?.gravity?.z, 0) },
    environment: raw?.environment && typeof raw.environment === 'object'
      ? { sky: 'gradient', top: '#111827', bottom: '#050508', fog: false, fogColor: '#111827', fogNear: 18, fogFar: 80, ...clone(raw.environment) }
      : (mode === '3d' ? { sky: 'gradient', top: '#111827', bottom: '#050508', fog: false, fogColor: '#111827', fogNear: 18, fogFar: 80 } : {}),
    entities,
  };
}

export function normalizeProject(raw) {
  const mode = raw?.mode === '3d' || raw?.project?.mode === '3d' ? '3d' : '2d';
  const base = blankProject(raw?.project?.name || raw?.name || 'Untitled Game', mode);
  if (!raw || typeof raw !== 'object') return base;
  const project = raw.project && typeof raw.project === 'object' ? raw.project : {};
  const scenes = (Array.isArray(raw.scenes) && raw.scenes.length ? raw.scenes : base.scenes).map((scene, index) => normalizeScene(scene, index, mode));
  const ids = new Set();
  for (const scene of scenes) {
    for (const object of scene.entities) {
      if (ids.has(object.id)) object.id = gid('e');
      ids.add(object.id);
    }
  }
  const scripts = (Array.isArray(raw.scripts) ? raw.scripts : []).map((script) => gameScript(script));
  const assets = (Array.isArray(raw.assets) ? raw.assets : []).map((asset) => ({
    id: String(asset?.id || gid('asset')),
    name: String(asset?.name || 'Asset'),
    type: ['image', 'audio', 'json', 'font', 'tilemap', 'model', 'texture', 'hdri'].includes(asset?.type) ? asset.type : 'image',
    src: String(asset?.src || ''),
    width: Math.max(0, safeNumber(asset?.width, 0)),
    height: Math.max(0, safeNumber(asset?.height, 0)),
  }));
  const prefabs = (Array.isArray(raw.prefabs) ? raw.prefabs : []).map((item) => ({
    id: String(item?.id || gid('prefab')),
    name: String(item?.name || 'Prefab'),
    entity: normalizeEntity(item?.entity || {}, 0) || entity(item?.name || 'Prefab'),
  }));
  return {
    schema: GAME_SCHEMA_VERSION,
    mode,
    project: {
      mode,
      name: String(project.name || raw.name || 'Untitled Game').slice(0, 120),
      description: String(project.description || '').slice(0, 2000),
      width: Math.max(160, Math.min(3840, safeNumber(project.width, GAME_DEFAULT_WIDTH))),
      height: Math.max(120, Math.min(2160, safeNumber(project.height, GAME_DEFAULT_HEIGHT))),
      background: safeColor(project.background, '#0b0b12'),
      gravityX: safeNumber(project.gravityX, 0),
      gravityY: safeNumber(project.gravityY, mode === '3d' ? -18 : 980),
      gravityZ: safeNumber(project.gravityZ, 0),
      targetFps: Math.max(1, Math.min(240, safeNumber(project.targetFps, 60))),
      physicsTimestep: Math.max(1 / 240, Math.min(0.1, safeNumber(project.physicsTimestep, 1 / 60))),
      pixelArt: !!project.pixelArt,
      debug: !!project.debug,
      controls: String(project.controls || (mode === '3d' ? 'orbit' : 'none')),
      render3d: {
        quality: ['low', 'medium', 'high', 'ultra'].includes(project.render3d?.quality) ? project.render3d.quality : 'medium',
        antialias: project.render3d?.antialias !== false,
        shadows: ['off', 'low', 'medium', 'high'].includes(project.render3d?.shadows) ? project.render3d.shadows : 'medium',
        toneMapping: String(project.render3d?.toneMapping || 'aces'),
        exposure: clamp(safeNumber(project.render3d?.exposure, 1.05), 0.1, 4),
        environment: String(project.render3d?.environment || 'studio'),
        sky: String(project.render3d?.sky || 'gradient'),
        bloom: clamp(safeNumber(project.render3d?.bloom, 0), 0, 2),
        dof: clamp(safeNumber(project.render3d?.dof, 0), 0, 2),
        ao: !!project.render3d?.ao,
        pixelRatio: clamp(safeNumber(project.render3d?.pixelRatio, 1), 0.5, 2),
      },
      defaultScene: String(project.defaultScene || scenes[0]?.id || ''),
      input: project.input && typeof project.input === 'object' ? clone(project.input) : defaultInputMap(),
      audio: { master: 1, music: 0.7, sfx: 0.9, ...(project.audio && typeof project.audio === 'object' ? project.audio : {}) },
      multiplayer: {
        enabled: !!(project.multiplayer && project.multiplayer.enabled),
        url: String(project.multiplayer?.url || ''),
      },
    },
    assets,
    scenes,
    prefabs,
    scripts,
    variables: raw.variables && typeof raw.variables === 'object' ? clone(raw.variables) : {},
    activeScene: String(raw.activeScene || project.defaultScene || scenes[0]?.id || ''),
  };
}

export function findEntity(project, id) {
  for (const scene of project.scenes || []) {
    const hit = scene.entities.find((object) => object.id === id);
    if (hit) return hit;
  }
  return null;
}

export function sceneById(project, id) {
  return (project.scenes || []).find((scene) => scene.id === id) || project.scenes?.[0] || null;
}

export function entityComponent(object, type) {
  return object?.components?.[type] || null;
}

export function defaultEntity(name, options = {}) {
  if (options.mode === '3d') {
    const object = entity(name, { w: 1, h: 1, d: 1, ...options });
    addComponent(object, 'MeshRenderer', { mesh: options.mesh || 'box', color: options.color || '#e11d48' });
    return object;
  }
  const object = entity(name, { w: 64, h: 64, ...options });
  if (options.sprite !== false) addComponent(object, 'SpriteRenderer', { color: options.color || '#f43f5e', shape: options.shape || 'rect' });
  return object;
}
