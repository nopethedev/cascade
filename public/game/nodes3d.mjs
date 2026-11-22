/* 3D gameplay visual-script node definitions. These are appended to the shared
   registry so the same graph editor, validator and interpreter dispatch can run
   both 2D and 3D projects. */
const exec = (id = 'exec', label = '') => ({ id, label, kind: 'exec' });
const out = (id = 'next', label = '') => ({ id, label, kind: 'exec' });
const data = (id, type = 'any', label = '') => ({ id, type, label });
const field = (key, label, type = 'number', extra = {}) => ({ key, label, type, ...extra });

export const GAME3D_NODE_DEFS = [
  {
    type: 'event.triggerEnter', title: 'On Trigger Enter 3D', category: '3D Physics', trigger: 'triggerEnter',
    color: '#f59e0b', description: 'Fires when a trigger volume is entered.', inputs: [], outputs: [out(), data('other', 'entity')],
    fields: [{ key: 'tagFilter', label: 'Tag filter', type: 'text' }], defaults: { tagFilter: '' },
  },
  {
    type: 'event.triggerExit', title: 'On Trigger Exit 3D', category: '3D Physics', trigger: 'triggerExit',
    color: '#f59e0b', description: 'Fires when a trigger volume is exited.', inputs: [], outputs: [out(), data('other', 'entity')],
    fields: [{ key: 'tagFilter', label: 'Tag filter', type: 'text' }], defaults: { tagFilter: '' },
  },
  {
    type: 'data.position3d', title: 'Get Position 3D', category: '3D Transform', color: '#06b6d4',
    description: 'World-space X/Y/Z.', inputs: [data('entity', 'entity')], outputs: [data('x', 'number'), data('y', 'number'), data('z', 'number')],
    fields: [{ key: 'entityId', label: 'Fallback entity id', type: 'entity' }], defaults: { entityId: '' },
  },
  {
    type: 'data.rotation3d', title: 'Get Rotation 3D', category: '3D Transform', color: '#06b6d4',
    description: 'Euler rotation in degrees.', inputs: [data('entity', 'entity')], outputs: [data('x', 'number'), data('y', 'number'), data('z', 'number')],
    fields: [], defaults: {},
  },
  {
    type: 'data.velocity3d', title: 'Get Velocity 3D', category: '3D Physics', color: '#06b6d4',
    description: 'Linear body velocity.', inputs: [data('entity', 'entity')], outputs: [data('x', 'number'), data('y', 'number'), data('z', 'number')],
    fields: [], defaults: {},
  },
  {
    type: 'data.distance3d', title: 'Distance 3D', category: '3D Transform', color: '#06b6d4',
    description: 'Distance between two entities.', inputs: [data('a', 'entity'), data('b', 'entity')], outputs: [data('value', 'number')], fields: [], defaults: {},
  },
  {
    type: 'data.vector3', title: 'Vector 3', category: '3D Math', color: '#facc15',
    description: 'Builds a Vector3.', inputs: [data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [data('value', 'vector3')],
    fields: [], defaults: { x: 0, y: 0, z: 0 },
  },
  {
    type: 'data.vectorMath3d', title: 'Vector 3 Math', category: '3D Math', color: '#facc15',
    description: 'Add/subtract/scale 3D vectors.', inputs: [data('a', 'vector3'), data('b', 'vector3')], outputs: [data('value', 'vector3')],
    fields: [{ key: 'op', label: 'Operator', type: 'select', options: ['add', 'sub', 'scale', 'normalize'] }, { key: 'scale', label: 'Scale', type: 'number' }],
    defaults: { op: 'add', scale: 1 },
  },
  {
    type: 'data.normalize3d', title: 'Normalize Vector', category: '3D Math', color: '#facc15',
    inputs: [data('value', 'vector3')], outputs: [data('value', 'vector3')], fields: [], defaults: {},
  },
  {
    type: 'data.dot3d', title: 'Dot Product', category: '3D Math', color: '#facc15',
    inputs: [data('a', 'vector3'), data('b', 'vector3')], outputs: [data('value', 'number')], fields: [], defaults: {},
  },
  {
    type: 'data.cross3d', title: 'Cross Product', category: '3D Math', color: '#facc15',
    inputs: [data('a', 'vector3'), data('b', 'vector3')], outputs: [data('value', 'vector3')], fields: [], defaults: {},
  },
  {
    type: 'data.lerp3d', title: 'Lerp Vector', category: '3D Math', color: '#facc15',
    inputs: [data('a', 'vector3'), data('b', 'vector3'), data('t', 'number')], outputs: [data('value', 'vector3')], fields: [], defaults: { t: 0.5 },
  },
  {
    type: 'action.setPosition3d', title: 'Set Position 3D', category: '3D Transform', color: '#06b6d4',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0, z: 0 },
  },
  {
    type: 'action.move3d', title: 'Move Object 3D', category: '3D Transform', color: '#06b6d4',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0, z: 0 },
  },
  {
    type: 'action.setRotation3d', title: 'Rotate Object 3D', category: '3D Transform', color: '#06b6d4',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0, z: 0 },
  },
  {
    type: 'action.setScale3d', title: 'Set Scale 3D', category: '3D Transform', color: '#06b6d4',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out()], fields: [], defaults: { x: 1, y: 1, z: 1 },
  },
  {
    type: 'action.lookAt3d', title: 'Look At 3D', category: '3D Transform', color: '#06b6d4',
    inputs: [exec(), data('target', 'entity')], outputs: [out()], fields: [], defaults: {},
  },
  {
    type: 'action.moveToward3d', title: 'Move Toward 3D', category: '3D Transform', color: '#06b6d4',
    inputs: [exec(), data('target', 'entity'), data('speed', 'number')], outputs: [out()], fields: [], defaults: { speed: 4 },
  },
  {
    type: 'action.setVelocity3d', title: 'Set Velocity 3D', category: '3D Physics', color: '#f59e0b',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0, z: 0 },
  },
  {
    type: 'action.applyImpulse3d', title: 'Apply Impulse 3D', category: '3D Physics', color: '#f59e0b',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0, z: 0 },
  },
  {
    type: 'action.applyForce3d', title: 'Apply Force 3D', category: '3D Physics', color: '#f59e0b',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0, z: 0 },
  },
  {
    type: 'data.grounded3d', title: 'Is Grounded 3D', category: '3D Physics', color: '#06b6d4',
    inputs: [data('entity', 'entity')], outputs: [data('value', 'boolean')], fields: [], defaults: {},
  },
  {
    type: 'action.raycast3d', title: 'Raycast 3D', category: '3D Physics', color: '#f59e0b',
    inputs: [exec(), data('dx', 'number'), data('dy', 'number'), data('dz', 'number'), data('distance', 'number')],
    outputs: [out(), data('hit', 'boolean'), data('entity', 'entity')], fields: [], defaults: { dx: 0, dy: -1, dz: 0, distance: 5 },
  },
  {
    type: 'action.cameraFollow3d', title: 'Follow Target 3D', category: '3D Camera', color: '#64748b',
    inputs: [exec(), data('entity', 'entity'), data('distance', 'number'), data('height', 'number')], outputs: [out()], fields: [], defaults: { distance: 7, height: 3 },
  },
  {
    type: 'action.cameraPosition3d', title: 'Set Camera Position', category: '3D Camera', color: '#64748b',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out()], fields: [], defaults: { x: 8, y: 6, z: 12 },
  },
  {
    type: 'action.cameraRotation3d', title: 'Set Camera Rotation', category: '3D Camera', color: '#64748b',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0, z: 0 },
  },
  {
    type: 'action.cameraShake3d', title: 'Camera Shake 3D', category: '3D Camera', color: '#64748b',
    inputs: [exec(), data('intensity', 'number'), data('duration', 'number')], outputs: [out()], fields: [], defaults: { intensity: 0.3, duration: 0.3 },
  },
  {
    type: 'action.cameraZoom3d', title: 'Camera Zoom 3D', category: '3D Camera', color: '#64748b',
    inputs: [exec(), data('value', 'number')], outputs: [out()], fields: [], defaults: { value: 60 },
  },
  {
    type: 'data.screenToWorld3d', title: 'World To Screen 3D', category: '3D Camera', color: '#64748b',
    inputs: [data('entity', 'entity')], outputs: [data('x', 'number'), data('y', 'number')], fields: [], defaults: {},
  },
  {
    type: 'action.spawn3d', title: 'Spawn 3D Object', category: '3D Object', color: '#38bdf8',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out(), data('entity', 'entity')],
    fields: [{ key: 'prefabId', label: 'Prefab id', type: 'text' }], defaults: { prefabId: '', x: 0, y: 2, z: 0 },
  },
  {
    type: 'action.setMaterial3d', title: 'Set Material 3D', category: '3D Object', color: '#38bdf8',
    inputs: [exec(), data('entity', 'entity')], outputs: [out()],
    fields: [field('color', 'Base color', 'color'), field('metalness', 'Metalness', 'number'), field('roughness', 'Roughness', 'number'), field('emissive', 'Emissive', 'color')],
    defaults: { color: '#e11d48', metalness: 0.1, roughness: 0.5, emissive: '' },
  },
  {
    type: 'action.changeMesh3d', title: 'Change Mesh 3D', category: '3D Object', color: '#38bdf8',
    inputs: [exec(), data('entity', 'entity')], outputs: [out()],
    fields: [field('mesh', 'Mesh', 'select', { options: ['box', 'sphere', 'cylinder', 'cone', 'plane', 'capsule', 'torus'] })], defaults: { mesh: 'box' },
  },
  {
    type: 'action.playAnimation3d', title: 'Play Animation 3D', category: '3D Animation', color: '#ec4899',
    inputs: [exec(), data('entity', 'entity')], outputs: [out()], fields: [field('clip', 'Clip', 'text'), field('speed', 'Speed', 'number')], defaults: { clip: '', speed: 1 },
  },
  {
    type: 'action.playSound3d', title: 'Play Spatial Sound', category: '3D Audio', color: '#14b8a6',
    inputs: [exec()], outputs: [out()], fields: [field('assetId', 'Audio asset', 'asset'), field('volume', 'Volume', 'number')], defaults: { assetId: '', volume: 0.8 },
  },
  {
    type: 'action.spawnParticles3d', title: 'Spawn Particle Effect 3D', category: '3D Effects', color: '#a855f7',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('z', 'number')], outputs: [out()],
    fields: [field('preset', 'Preset', 'select', { options: ['smoke', 'dust', 'rain', 'snow', 'sparks', 'fire', 'magic'] })], defaults: { preset: 'sparks', x: 0, y: 1, z: 0 },
  },
  {
    type: 'action.loadScene3d', title: 'Load Scene', category: '3D Game', color: '#22c55e',
    inputs: [exec()], outputs: [out()], fields: [field('sceneId', 'Scene id', 'text')], defaults: { sceneId: '' },
  },
];
