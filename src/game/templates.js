/* Real starter projects for Cascade Game Studio. Every template is ordinary
   editable project data: scenes, entities, components and scripts. */
import {
  blankProject, entity, addComponent, graphNode, graphEdge, gameScript, prefab, gid,
} from '../../public/game/schema.mjs';

const gn = (type, x, y, config = {}) => graphNode(type, x, y, config);
const ge = (from, fromPin, to, toPin) => graphEdge(from, fromPin, to, toPin);
const scoreScript = (playerId, winText = 'All collectibles found!') => {
  const event = gn('event.collisionEnter', 80, 80, { tagFilter: 'pickup' });
  const destroy = gn('action.destroy', 340, 80);
  const add = gn('variable.add', 560, 80, { name: 'score', amount: 1 });
  const branch = gn('action.branch', 780, 80);
  const get = gn('variable.get', 540, 300, { name: 'score' });
  const compare = gn('data.compare', 780, 300, { op: '>=', b: 3 });
  const show = gn('action.showUI', 1000, 80, { entityId: 'ui-win' });
  const win = gn('action.win', 1220, 80, { message: winText });
  return gameScript({
    name: 'Collect Pickups', entityId: playerId, trigger: 'collisionEnter',
    graph: {
      nodes: [event, destroy, add, branch, get, compare, show, win],
      edges: [
        ge(event.id, 'next', destroy.id, 'exec'), ge(event.id, 'other', destroy.id, 'entity'),
        ge(destroy.id, 'next', add.id, 'exec'), ge(add.id, 'next', branch.id, 'exec'),
        ge(get.id, 'value', compare.id, 'a'), ge(compare.id, 'value', branch.id, 'condition'),
        ge(branch.id, 'true', show.id, 'exec'), ge(show.id, 'next', win.id, 'exec'),
      ],
    },
  });
};

const movementScript = (playerId, speed = 5.2, jump = -10, vertical = false) => {
  const event = gn('event.update', 80, 80);
  const axis = gn('input.axis', 80, 280, { action: 'horizontal' });
  const mul = gn('data.math', 340, 280, { op: 'mul', b: speed });
  const velocity = gn('data.velocity', 80, 480);
  const set = gn('action.setVelocity', 600, 120, { x: 0, y: 0 });
  const nodes = [event, axis, mul, velocity, set];
  const edges = [
    ge(event.id, 'next', set.id, 'exec'), ge(axis.id, 'value', mul.id, 'a'),
    ge(mul.id, 'value', set.id, 'x'), ge(velocity.id, 'y', set.id, 'y'),
  ];
  if (vertical) {
    const axisY = gn('input.axis', 80, 620, { action: 'vertical' });
    const mulY = gn('data.math', 340, 620, { op: 'mul', b: speed });
    nodes.push(axisY, mulY);
    edges.push(ge(axisY.id, 'value', mulY.id, 'a'), ge(mulY.id, 'value', set.id, 'y'));
  } else {
    const key = gn('input.keyPressed', 80, 720, { key: 'Space' });
    const grounded = gn('data.grounded', 80, 840);
    const and = gn('data.and', 340, 760);
    const branch = gn('action.branch', 600, 680);
    const jumpNode = gn('action.setVelocity', 860, 680, { x: 0, y: jump });
    nodes.push(key, grounded, and, branch, jumpNode);
    edges.push(
      ge(set.id, 'next', branch.id, 'exec'),
      ge(key.id, 'value', and.id, 'a'), ge(grounded.id, 'value', and.id, 'b'),
      ge(and.id, 'value', branch.id, 'condition'), ge(branch.id, 'true', jumpNode.id, 'exec'),
    );
  }
  return gameScript({ name: 'Player Movement', entityId: playerId, trigger: 'update', graph: { nodes, edges } });
};

function platformer2D() {
  const project = blankProject('Skybound', '2d');
  project.project.description = 'A complete side-scrolling platformer with coins, physics, camera follow and a win condition.';
  project.project.gravityY = 1500;
  project.variables = { score: 0 };
  const scene = project.scenes[0];
  scene.name = 'Sunset Run';
  scene.background = '#111827';
  scene.gravity = { x: 0, y: 1500 };
  const bg = entity('Sky', { id: 'bg', x: 480, y: 270, w: 960, h: 540, zIndex: -20, components: { SpriteRenderer: { color: '#172554', shape: 'rect' } } });
  const glow = entity('Sun Glow', { id: 'bg-glow', x: 730, y: 130, w: 220, h: 220, zIndex: -15, components: { SpriteRenderer: { color: '#f59e0b', shape: 'circle', opacity: 0.16 } } });
  const ground = entity('Ground', { id: 'ground', x: 320, y: 500, w: 560, h: 42, components: { SpriteRenderer: { color: '#334155' }, Rigidbody2D: { bodyType: 'static' }, Collider2D: { shape: 'rectangle', width: 560, height: 42 } } });
  const ledge = entity('High Ledge', { id: 'ledge', x: 780, y: 420, w: 220, h: 38, components: { SpriteRenderer: { color: '#475569' }, Rigidbody2D: { bodyType: 'static' }, Collider2D: { shape: 'rectangle', width: 220, height: 38 } } });
  const player = entity('Player', { id: 'player', x: 170, y: 410, w: 42, h: 56, tags: ['player'], components: { SpriteRenderer: { color: '#f43f5e', shape: 'capsule' }, Rigidbody2D: { bodyType: 'dynamic', mass: 1, fixedRotation: true, friction: 0.1 }, Collider2D: { shape: 'rectangle', width: 40, height: 54 } } });
  const coin = (id, x, y) => entity('Coin', { id, x, y, w: 24, h: 24, tags: ['pickup'], components: { SpriteRenderer: { color: '#facc15', shape: 'circle' }, Collider2D: { shape: 'circle', radius: 13, sensor: true }, Rigidbody2D: { bodyType: 'static' } } });
  const coins = [coin('coin-1', 430, 455), coin('coin-2', 610, 455), coin('coin-3', 790, 380)];
  const camera = entity('Main Camera', { id: 'camera', x: 480, y: 270, w: 1, h: 1, components: { Camera2D: { follow: 'player', zoom: 1, smoothing: 0.12, boundsX: 0, boundsY: 0, boundsW: 960, boundsH: 540 } } });
  const score = entity('Score', { id: 'ui-score', x: 24, y: 20, w: 220, h: 38, components: { UIElement: { kind: 'text', binding: 'score', prefix: 'Coins:  ', size: 22, color: '#fef3c7' } } });
  const hint = entity('Hint', { id: 'ui-hint', x: 0, y: 500, w: 960, h: 28, components: { UIElement: { kind: 'text', anchor: 'top-center', text: 'A / D or arrows to move  ·  Space to jump', size: 14, color: '#94a3b8' } } });
  const win = entity('Win', { id: 'ui-win', x: 0, y: 200, w: 960, h: 80, visible: false, components: { UIElement: { kind: 'text', anchor: 'top-center', text: 'You collected every coin!', size: 38, color: '#4ade80', visible: false } } });
  scene.entities = [bg, glow, ground, ledge, player, ...coins, camera, score, hint, win];
  project.scripts = [movementScript('player', 5.2, -10), scoreScript('player', 'You collected every coin!')];
  return project;
}

function topDown2D() {
  const project = blankProject('Mosslight', '2d');
  project.project.description = 'A top-down exploration starter with camera-relative movement, enemies, pickups and a win condition.';
  project.project.gravityY = 0;
  project.variables = { score: 0 };
  const scene = project.scenes[0];
  scene.name = 'Mosslight Grove';
  scene.background = '#0b1f1a';
  scene.gravity = { x: 0, y: 0 };
  const ground = entity('Ground', { id: 'ground', x: 480, y: 270, w: 960, h: 540, zIndex: -10, components: { SpriteRenderer: { color: '#12332a' } } });
  const path = entity('Path', { id: 'path', x: 480, y: 330, w: 960, h: 180, zIndex: -9, components: { SpriteRenderer: { color: '#1f4a3b' } } });
  const player = entity('Player', { id: 'player', x: 450, y: 320, w: 38, h: 38, tags: ['player'], components: { SpriteRenderer: { color: '#67e8f9', shape: 'circle' }, Rigidbody2D: { bodyType: 'dynamic', fixedRotation: true }, Collider2D: { shape: 'circle', radius: 19 } } });
  const enemy = entity('Enemy', { id: 'enemy', x: 720, y: 250, w: 38, h: 38, tags: ['enemy'], components: { SpriteRenderer: { color: '#fb7185', shape: 'circle' }, Collider2D: { shape: 'circle', radius: 19, sensor: true } } });
  const pickup = (id, x, y) => entity('Glow Shard', { id, x, y, w: 22, h: 22, tags: ['pickup'], components: { SpriteRenderer: { color: '#fde047', shape: 'circle' }, Collider2D: { shape: 'circle', radius: 12, sensor: true } } });
  const pickups = [pickup('shard-1', 250, 180), pickup('shard-2', 700, 420), pickup('shard-3', 810, 160)];
  const camera = entity('Main Camera', { id: 'camera', x: 480, y: 270, w: 1, h: 1, components: { Camera2D: { follow: 'player', zoom: 1, smoothing: 0.2 } } });
  const score = entity('Score', { id: 'ui-score', x: 22, y: 20, w: 220, h: 36, components: { UIElement: { kind: 'text', binding: 'score', prefix: 'Shards:  ', size: 20, color: '#fef9c3' } } });
  const win = entity('Win', { id: 'ui-win', x: 0, y: 210, w: 960, h: 70, visible: false, components: { UIElement: { kind: 'text', anchor: 'top-center', text: 'The grove is restored.', size: 36, color: '#86efac', visible: false } } });
  scene.entities = [ground, path, player, enemy, ...pickups, camera, score, win];
  const move = gameScript({
    name: 'Top Down Movement', entityId: 'player', trigger: 'update',
    graph: {
      nodes: [
        gn('event.update', 60, 80), gn('input.axis', 60, 260, { action: 'horizontal' }),
        gn('data.math', 300, 260, { op: 'mul', b: 4.5 }), gn('input.axis', 60, 400, { action: 'vertical' }),
        gn('data.math', 300, 400, { op: 'mul', b: 4.5 }), gn('action.setVelocity', 580, 120, { x: 0, y: 0 }),
      ],
      edges: [
        ge('event-placeholder', 'next', 'set-placeholder', 'exec'),
      ],
    },
  });
  // Build the movement graph with explicit ids because two actions share one exec.
  const event = gn('event.update', 60, 80);
  const h = gn('input.axis', 60, 260, { action: 'horizontal' });
  const hm = gn('data.math', 300, 260, { op: 'mul', b: 4.5 });
  const v = gn('input.axis', 60, 400, { action: 'vertical' });
  const vm = gn('data.math', 300, 400, { op: 'mul', b: 4.5 });
  const set = gn('action.setVelocity', 600, 120, { x: 0, y: 0 });
  move.graph = {
    nodes: [event, h, hm, v, vm, set],
    edges: [
      ge(event.id, 'next', set.id, 'exec'), ge(h.id, 'value', hm.id, 'a'), ge(v.id, 'value', vm.id, 'a'),
      ge(hm.id, 'value', set.id, 'x'), ge(vm.id, 'value', set.id, 'y'),
    ],
  };
  project.scripts = [move, scoreScript('player', 'The grove is restored.')];
  return project;
}

function sandbox2D() {
  const project = blankProject('Physics Sandbox', '2d');
  project.project.description = 'A hands-on Matter.js sandbox: press the spawn button to drop a new rigid body into the scene.';
  project.project.gravityY = 1250;
  const scene = project.scenes[0];
  scene.name = 'Drop Lab';
  scene.background = '#0f172a';
  scene.gravity = { x: 0, y: 1250 };
  const floor = entity('Floor', { id: 'floor', x: 480, y: 500, w: 920, h: 38, components: { SpriteRenderer: { color: '#475569' }, Rigidbody2D: { bodyType: 'static' }, Collider2D: { width: 920, height: 38 } } });
  const wallL = entity('Wall Left', { id: 'wall-l', x: 24, y: 300, w: 24, h: 420, components: { SpriteRenderer: { color: '#334155' }, Rigidbody2D: { bodyType: 'static' }, Collider2D: { width: 24, height: 420 } } });
  const wallR = entity('Wall Right', { id: 'wall-r', x: 936, y: 300, w: 24, h: 420, components: { SpriteRenderer: { color: '#334155' }, Rigidbody2D: { bodyType: 'static' }, Collider2D: { width: 24, height: 420 } } });
  const ramp = entity('Ramp', { id: 'ramp', x: 620, y: 400, w: 300, h: 24, rotation: -14, components: { SpriteRenderer: { color: '#f59e0b' }, Rigidbody2D: { bodyType: 'static' }, Collider2D: { width: 300, height: 24 } } });
  const previewBox = entity('Falling Crate', { id: 'crate-preview', x: 360, y: 130, w: 70, h: 70, components: { SpriteRenderer: { color: '#e11d48' }, Rigidbody2D: { bodyType: 'dynamic', mass: 2 }, Collider2D: { width: 70, height: 70 } } });
  const previewBall = entity('Falling Ball', { id: 'ball-preview', x: 520, y: 100, w: 54, h: 54, components: { SpriteRenderer: { color: '#38bdf8', shape: 'circle' }, Rigidbody2D: { bodyType: 'dynamic', mass: 1 }, Collider2D: { shape: 'circle', radius: 27 } } });
  const button = entity('Spawn Button', { id: 'ui-spawn', x: 0, y: 18, w: 220, h: 48, components: { UIElement: { kind: 'button', anchor: 'top-center', text: 'Drop a body', clickable: true, fill: '#e11d48' } } });
  const hint = entity('Hint', { id: 'ui-hint', x: 0, y: 76, w: 500, h: 28, components: { UIElement: { kind: 'text', anchor: 'top-center', text: 'Click the button or press Space to spawn', size: 14, color: '#94a3b8' } } });
  scene.entities = [floor, wallL, wallR, ramp, previewBox, previewBall, button, hint];
  const ball = entity('Ball', { id: 'prefab-ball', x: 0, y: 0, w: 52, h: 52, components: { SpriteRenderer: { color: '#a78bfa', shape: 'circle' }, Rigidbody2D: { bodyType: 'dynamic', mass: 1 }, Collider2D: { shape: 'circle', radius: 26 } } });
  project.prefabs = [prefab('Ball', ball)];
  const click = gameScript({
    name: 'Spawn Ball', trigger: 'uiClick',
    graph: {
      nodes: [
        gn('event.uiClick', 80, 80), gn('action.spawn', 340, 80, { prefabId: 'prefab-ball', x: 480, y: 120 }),
        gn('action.cameraShake', 580, 80, { intensity: 4, duration: 0.12 }),
      ],
      edges: [ge('ui-event', 'next', 'spawn', 'exec')],
    },
  });
  // Rebuild with real ids (the compact literal above is replaced below).
  const ev = gn('event.uiClick', 80, 80);
  const spawn = gn('action.spawn', 340, 80, { prefabId: 'prefab-ball', x: 480, y: 120 });
  const shake = gn('action.cameraShake', 600, 80, { intensity: 4, duration: 0.12 });
  click.graph = { nodes: [ev, spawn, shake], edges: [ge(ev.id, 'next', spawn.id, 'exec'), ge(spawn.id, 'next', shake.id, 'exec')] };
  const key = gameScript({
    name: 'Spawn With Space', trigger: 'keyPressed',
    graph: {
      nodes: [gn('event.keyPressed', 80, 80, { key: 'Space' }), gn('action.spawn', 340, 80, { prefabId: 'prefab-ball', x: 480, y: 120 })],
      edges: [ge('key-event', 'next', 'key-spawn', 'exec')],
    },
  });
  const kev = gn('event.keyPressed', 80, 80, { key: 'Space' });
  const kspawn = gn('action.spawn', 340, 80, { prefabId: 'prefab-ball', x: 480, y: 120 });
  key.graph = { nodes: [kev, kspawn], edges: [ge(kev.id, 'next', kspawn.id, 'exec')] };
  project.scripts = [click, key];
  return project;
}

const OBJ_CRATE = `o Crate\nv -0.5 -0.5 0.5\nv 0.5 -0.5 0.5\nv 0.5 0.5 0.5\nv -0.5 0.5 0.5\nv -0.5 -0.5 -0.5\nv 0.5 -0.5 -0.5\nv 0.5 0.5 -0.5\nv -0.5 0.5 -0.5\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 2 6 7 3\nf 3 7 8 4\nf 5 1 4 8\n`;
const OBJ_DATA_URL = `data:model/obj;base64,${Buffer.from(OBJ_CRATE).toString('base64')}`;

function firstPerson3D() {
  const project = blankProject('Vaultbreaker', '3d');
  project.project.description = 'A first-person exploration starter with a real character controller, spatial scene, imported crate model, interactable door and win condition.';
  project.project.gravityY = -22;
  project.project.controls = 'firstPerson';
  project.variables = { score: 0 };
  const scene = project.scenes[0];
  scene.name = 'The Vault';
  scene.environment = { sky: 'gradient', top: '#172554', bottom: '#060814', fog: true, fogColor: '#0f172a', fogNear: 16, fogFar: 70 };
  scene.gravity = { x: 0, y: -22, z: 0 };
  const sun = entity('Vault Sun', { id: 'sun', x: 5, y: 9, z: 4, w: 1, h: 1, d: 1, components: { Light3D: { type: 'point', color: '#fbbf24', intensity: 24, distance: 30, castShadow: true } } });
  const room = entity('Vault Floor', { id: 'floor', x: 0, y: -0.5, z: 0, w: 24, h: 1, d: 24, components: { MeshRenderer: { mesh: 'box', color: '#1e293b', roughness: 0.9, receiveShadow: true }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: 'box', width: 24, height: 1, depth: 24 } } });
  const backWall = entity('Back Wall', { id: 'back-wall', x: 0, y: 3, z: -12, w: 24, h: 6, d: 1, components: { MeshRenderer: { mesh: 'box', color: '#312e81', roughness: 0.8 }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: 'box', width: 24, height: 6, depth: 1 } } });
  const pillarA = entity('Pillar A', { id: 'pillar-a', x: -5, y: 2, z: -4, w: 1.4, h: 4, d: 1.4, components: { MeshRenderer: { mesh: 'box', color: '#475569', metalness: 0.2, roughness: 0.4 }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: 'box', width: 1.4, height: 4, depth: 1.4 } } });
  const pillarB = entity('Pillar B', { id: 'pillar-b', x: 5, y: 2, z: -4, w: 1.4, h: 4, d: 1.4, components: { MeshRenderer: { mesh: 'box', color: '#475569', metalness: 0.2, roughness: 0.4 }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: 'box', width: 1.4, height: 4, depth: 1.4 } } });
  const door = entity('Vault Door', { id: 'door', x: 0, y: 2, z: -10, w: 2.4, h: 4, d: 0.4, tags: ['door'], components: { MeshRenderer: { mesh: 'box', color: '#e11d48', metalness: 0.45, roughness: 0.28, emissive: '#450a0a', emissiveIntensity: 0.4 }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: 'box', width: 2.4, height: 4, depth: 0.4 } } });
  const crate = entity('Crate (OBJ import)', { id: 'crate', x: 4, y: 1, z: 2, w: 2, h: 2, d: 2, components: { MeshRenderer: { mesh: 'custom', assetId: 'asset-crate', color: '#d97706', castShadow: true }, Rigidbody3D: { bodyType: 'dynamic', mass: 3 }, Collider3D: { shape: 'box', width: 2, height: 2, depth: 2 } } });
  const player = entity('Player', { id: 'player', x: 0, y: 1.1, z: 5, w: 0.9, h: 1.8, d: 0.9, tags: ['player'], components: { MeshRenderer: { mesh: 'capsule', color: '#22d3ee', roughness: 0.4, metalness: 0.1, castShadow: true }, Rigidbody3D: { bodyType: 'dynamic', mass: 1, fixedRotation: true }, Collider3D: { shape: 'box', width: 0.85, height: 1.7, depth: 0.85 }, CharacterController3D: { speed: 4.2, runSpeed: 7, jumpHeight: 1.5, gravity: -22, cameraRelative: true } } });
  const camera = entity('First Person Camera', { id: 'camera', x: 0, y: 2.6, z: 5, w: 1, h: 1, d: 1, components: { Camera3D: { fov: 66, controller: 'firstPerson', follow: 'player', yaw: 180, offsetY: 1.55, smoothing: 0.2 } } });
  const prompt = entity('Prompt', { id: 'ui-prompt', x: 0, y: 20, w: 420, h: 40, components: { UIElement: { kind: 'panel', text: 'WASD move · Mouse look · Space jump · E open door', x: 20, y: 20, w: 440, h: 44, size: 14, color: '#e2e8f0', fill: 'rgba(15,23,42,.72)' } } });
  const win = entity('Win', { id: 'ui-win', x: 0, y: 230, w: 960, h: 80, visible: false, components: { UIElement: { kind: 'text', anchor: 'top-center', text: 'Vault opened. You escaped!', size: 36, color: '#4ade80', visible: false } } });
  scene.entities = [room, backWall, pillarA, pillarB, door, crate, player, camera, prompt, win, sun];
  project.assets = [{ id: 'asset-crate', name: 'crate.obj', type: 'model', src: OBJ_DATA_URL, width: 1, height: 1 }];
  const event = gn('event.keyPressed', 80, 80, { key: 'KeyE' });
  const findDoor = gn('data.find', 80, 260, { name: 'door' });
  const findPlayer = gn('data.find', 80, 380, { name: 'player' });
  const distance = gn('data.distance3d', 320, 300);
  const compare = gn('data.compare', 540, 300, { op: '<', b: 4.5 });
  const branch = gn('action.branch', 760, 80);
  const hide = gn('action.setVisible', 980, 80, { entityId: 'door', visible: false });
  const winNode = gn('action.win', 1180, 80, { message: 'Vault opened. You escaped!' });
  project.scripts = [gameScript({
    name: 'Open Door', entityId: 'player', trigger: 'keyPressed',
    graph: {
      nodes: [event, findDoor, findPlayer, distance, compare, branch, hide, winNode],
      edges: [
        ge(event.id, 'next', branch.id, 'exec'), ge(findDoor.id, 'entity', distance.id, 'a'),
        ge(findPlayer.id, 'entity', distance.id, 'b'), ge(distance.id, 'value', compare.id, 'a'),
        ge(compare.id, 'value', branch.id, 'condition'), ge(branch.id, 'true', hide.id, 'exec'),
        ge(hide.id, 'next', winNode.id, 'exec'),
      ],
    },
  })];
  return project;
}

function thirdPerson3D() {
  const project = blankProject('Skyward', '3d');
  project.project.description = 'A third-person platformer with a character controller, moving platform, collectibles, follow camera and a win condition.';
  project.project.gravityY = -24;
  project.project.controls = 'thirdPerson';
  project.variables = { score: 0 };
  const scene = project.scenes[0];
  scene.name = 'Skyward Platforms';
  scene.environment = { sky: 'gradient', top: '#1e3a8a', bottom: '#0f172a', fog: true, fogColor: '#172554', fogNear: 22, fogFar: 90 };
  scene.gravity = { x: 0, y: -24, z: 0 };
  const platform = (id, x, y, z, w, h, d, color) => entity(id, { id, x, y, z, w, h, d, components: { MeshRenderer: { mesh: 'box', color, roughness: 0.7, metalness: 0.1 }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: 'box', width: w, height: h, depth: d } } });
  const start = platform('Start Platform', 0, -0.5, 0, 8, 1, 8, '#475569');
  const mid = platform('Middle Platform', 0, 1.5, -8, 5, 0.8, 5, '#64748b');
  const high = platform('High Platform', 4, 3.7, -13, 4, 0.8, 4, '#94a3b8');
  const goal = platform('Goal Platform', -4, 5.4, -18, 5, 0.8, 5, '#a78bfa');
  const player = entity('Player', { id: 'player', x: 0, y: 1.1, z: 0, w: 0.9, h: 1.7, d: 0.9, tags: ['player'], components: { MeshRenderer: { mesh: 'capsule', color: '#f43f5e', roughness: 0.4 }, Rigidbody3D: { bodyType: 'dynamic', mass: 1, fixedRotation: true }, Collider3D: { shape: 'box', width: 0.85, height: 1.7, depth: 0.85 }, CharacterController3D: { speed: 4.8, runSpeed: 7.5, jumpHeight: 1.7, gravity: -24, cameraRelative: true } } });
  const camera = entity('Follow Camera', { id: 'camera', x: 6, y: 5, z: 7, w: 1, h: 1, d: 1, components: { Camera3D: { fov: 58, controller: 'thirdPerson', follow: 'player', offsetY: 2.4, offsetZ: 7, smoothing: 0.12 } } });
  const gem = (id, x, y, z) => entity('Gem', { id, x, y, z, w: 0.7, h: 0.7, d: 0.7, tags: ['pickup'], components: { MeshRenderer: { mesh: 'torus', color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 1.2, metalness: 0.2 }, Collider3D: { shape: 'box', width: 0.7, height: 0.7, depth: 0.7, sensor: true } } });
  const gems = [gem('gem-1', 0, 3, -8), gem('gem-2', 4, 5.2, -13), gem('gem-3', -4, 6.9, -18)];
  const score = entity('Score', { id: 'ui-score', x: 0, y: 20, w: 220, h: 36, components: { UIElement: { kind: 'text', anchor: 'top-center', binding: 'score', prefix: 'Gems:  ', size: 20, color: '#fef3c7' } } });
  const win = entity('Win', { id: 'ui-win', x: 0, y: 230, w: 960, h: 80, visible: false, components: { UIElement: { kind: 'text', anchor: 'top-center', text: 'Skyward summit reached!', size: 36, color: '#4ade80', visible: false } } });
  scene.entities = [start, mid, high, goal, player, camera, ...gems, score, win];
  const event = gn('event.collisionEnter', 60, 80, { tagFilter: 'pickup' });
  const destroy = gn('action.destroy', 320, 80);
  const add = gn('variable.add', 540, 80, { name: 'score', amount: 1 });
  const branch = gn('action.branch', 760, 80);
  const get = gn('variable.get', 520, 300, { name: 'score' });
  const compare = gn('data.compare', 760, 300, { op: '>=', b: 3 });
  const show = gn('action.showUI', 980, 80, { entityId: 'ui-win' });
  const winNode = gn('action.win', 1180, 80, { message: 'Skyward summit reached!' });
  project.scripts = [gameScript({
    name: 'Gem Collector', entityId: 'player', trigger: 'collisionEnter',
    graph: {
      nodes: [event, destroy, add, branch, get, compare, show, winNode],
      edges: [
        ge(event.id, 'next', destroy.id, 'exec'), ge(event.id, 'other', destroy.id, 'entity'),
        ge(destroy.id, 'next', add.id, 'exec'), ge(add.id, 'next', branch.id, 'exec'),
        ge(get.id, 'value', compare.id, 'a'), ge(compare.id, 'value', branch.id, 'condition'),
        ge(branch.id, 'true', show.id, 'exec'), ge(show.id, 'next', winNode.id, 'exec'),
      ],
    },
  })];
  return project;
}

function sandbox3D() {
  const project = blankProject('Cube Yard', '3d');
  project.project.description = 'A 3D physics sandbox with dynamic crates, spheres, a ramp and click-to-spawn bodies.';
  project.project.gravityY = -24;
  project.project.controls = 'thirdPerson';
  const scene = project.scenes[0];
  scene.name = 'Cube Yard';
  scene.environment = { sky: 'gradient', top: '#0f172a', bottom: '#020617', fog: true, fogColor: '#0f172a', fogNear: 20, fogFar: 70 };
  scene.gravity = { x: 0, y: -24, z: 0 };
  const floor = entity('Yard', { id: 'floor', x: 0, y: -0.5, z: 0, w: 30, h: 1, d: 30, components: { MeshRenderer: { mesh: 'box', color: '#1e293b', roughness: 0.95 }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: 'box', width: 30, height: 1, depth: 30 } } });
  const ramp = entity('Ramp', { id: 'ramp', x: 5, y: 1.2, z: -3, w: 8, h: 0.6, d: 4, rotationZ: 18, components: { MeshRenderer: { mesh: 'box', color: '#f59e0b', metalness: 0.2 }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: 'box', width: 8, height: 0.6, depth: 4 } } });
  const crate = (id, x, y, z, color, size = 1.2) => entity('Crate', { id, x, y, z, w: size, h: size, d: size, components: { MeshRenderer: { mesh: 'box', color, roughness: 0.55, metalness: 0.15 }, Rigidbody3D: { bodyType: 'dynamic', mass: 2 }, Collider3D: { shape: 'box', width: size, height: size, depth: size } } });
  const crates = [crate('crate-a', -2, 2, 0, '#e11d48'), crate('crate-b', 0, 2.5, 0, '#38bdf8'), crate('crate-c', 2, 2, 0, '#a78bfa')];
  const ball = entity('Ball', { id: 'ball', x: -4, y: 4, z: 2, w: 1.4, h: 1.4, d: 1.4, components: { MeshRenderer: { mesh: 'sphere', color: '#fbbf24', metalness: 0.3, roughness: 0.25 }, Rigidbody3D: { bodyType: 'dynamic', mass: 1 }, Collider3D: { shape: 'sphere', radius: 0.7 } } });
  const player = entity('Player', { id: 'player', x: 0, y: 1.2, z: 8, w: 0.9, h: 1.8, d: 0.9, components: { MeshRenderer: { mesh: 'capsule', color: '#22d3ee' }, Rigidbody3D: { bodyType: 'dynamic', mass: 1, fixedRotation: true }, Collider3D: { shape: 'box', width: 0.85, height: 1.75, depth: 0.85 }, CharacterController3D: { speed: 4.5, jumpHeight: 1.5, gravity: -24, cameraRelative: true } } });
  const camera = entity('Camera', { id: 'camera', x: 8, y: 6, z: 12, w: 1, h: 1, d: 1, components: { Camera3D: { controller: 'thirdPerson', follow: 'player', offsetY: 3, offsetZ: 8 } } });
  const button = entity('Spawn Crate', { id: 'ui-spawn', x: 0, y: 18, w: 220, h: 44, components: { UIElement: { kind: 'button', anchor: 'top-center', text: 'Spawn a crate', clickable: true, fill: '#e11d48' } } });
  scene.entities = [floor, ramp, ...crates, ball, player, camera, button];
  const spawnEntity = crate('prefab-crate', 0, 0, 0, '#f43f5e');
  project.prefabs = [prefab('Spawnable Crate', spawnEntity)];
  project.scripts = [gameScript({
    name: 'Spawn Crate', trigger: 'uiClick',
    graph: {
      nodes: [gn('event.uiClick', 80, 80), gn('action.spawn3d', 340, 80, { prefabId: 'prefab-crate', x: 0, y: 8, z: 0 })],
      edges: [ge('ui-event', 'next', 'spawn', 'exec')],
    },
  })];
  // Replace placeholder ids with a valid graph.
  const ev = gn('event.uiClick', 80, 80);
  const spawn = gn('action.spawn3d', 340, 80, { prefabId: 'prefab-crate', x: 0, y: 8, z: 0 });
  project.scripts[0].graph = { nodes: [ev, spawn], edges: [ge(ev.id, 'next', spawn.id, 'exec')] };
  return project;
}

function driving3D() {
  const project = blankProject('Circuit Run', '3d');
  project.project.description = 'A small 3D driving starter with an arcade vehicle, checkpoints, follow camera and lap timer.';
  project.project.gravityY = -24;
  project.project.controls = 'thirdPerson';
  project.variables = { laps: 0, time: 0 };
  const scene = project.scenes[0];
  scene.name = 'Circuit';
  scene.environment = { sky: 'gradient', top: '#0c4a6e', bottom: '#020617', fog: true, fogColor: '#0c4a6e', fogNear: 25, fogFar: 90 };
  scene.gravity = { x: 0, y: -24, z: 0 };
  const track = entity('Track', { id: 'track', x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 40, components: { MeshRenderer: { mesh: 'box', color: '#334155', roughness: 0.9 }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: 'box', width: 40, height: 1, depth: 40 } } });
  const car = entity('Car', { id: 'car', x: 0, y: 1.2, z: 8, w: 2, h: 0.8, d: 4, tags: ['player'], components: { MeshRenderer: { mesh: 'box', color: '#f43f5e', metalness: 0.5, roughness: 0.25 }, Rigidbody3D: { bodyType: 'dynamic', mass: 6, fixedRotation: true }, Collider3D: { shape: 'box', width: 2, height: 0.8, depth: 4 } } });
  const camera = entity('Chase Camera', { id: 'camera', x: 0, y: 5, z: 15, w: 1, h: 1, d: 1, components: { Camera3D: { fov: 60, controller: 'thirdPerson', follow: 'car', offsetY: 3, offsetZ: 9, smoothing: 0.18 } } });
  const checkpoint = entity('Checkpoint', { id: 'checkpoint', x: 0, y: 1, z: -8, w: 3, h: 3, d: 1, tags: ['pickup'], components: { MeshRenderer: { mesh: 'box', color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 0.8 }, Collider3D: { shape: 'box', width: 3, height: 3, depth: 1, sensor: true } } });
  const speed = entity('Lap Counter', { id: 'ui-laps', x: 0, y: 20, w: 220, h: 36, components: { UIElement: { kind: 'text', anchor: 'top-center', binding: 'laps', prefix: 'Checkpoints:  ', size: 20, color: '#fef3c7' } } });
  const win = entity('Win', { id: 'ui-win', x: 0, y: 230, w: 960, h: 80, visible: false, components: { UIElement: { kind: 'text', anchor: 'top-center', text: 'Checkpoint cleared!', size: 36, color: '#4ade80', visible: false } } });
  scene.entities = [track, car, camera, checkpoint, speed, win];
  const event = gn('event.update', 60, 80);
  const forward = gn('input.axis', 60, 260, { action: 'vertical' });
  const speedMath = gn('data.math', 300, 260, { op: 'mul', b: 9 });
  const steer = gn('input.axis', 60, 400, { action: 'horizontal' });
  const steerMath = gn('data.math', 300, 400, { op: 'mul', b: 40 });
  const velocity = gn('data.velocity3d', 60, 540);
  const set = gn('action.setVelocity3d', 580, 120, { x: 0, y: 0, z: 0 });
  project.scripts = [
    gameScript({
      name: 'Arcade Drive', entityId: 'car', trigger: 'update',
      graph: {
        nodes: [event, forward, speedMath, steer, steerMath, velocity, set],
        edges: [
          ge(event.id, 'next', set.id, 'exec'), ge(forward.id, 'value', speedMath.id, 'a'),
          ge(speedMath.id, 'value', set.id, 'z'), ge(steer.id, 'value', steerMath.id, 'a'),
          ge(steerMath.id, 'value', set.id, 'x'), ge(velocity.id, 'y', set.id, 'y'),
        ],
      },
    }),
    gameScript({
      name: 'Lap Check', entityId: 'car', trigger: 'collisionEnter',
      graph: (() => {
        const ev = gn('event.collisionEnter', 60, 80, { tagFilter: 'pickup' });
        const destroy = gn('action.destroy', 300, 80, { entityId: 'checkpoint' });
        const add = gn('variable.add', 520, 80, { name: 'laps', amount: 1 });
        const get = gn('variable.get', 520, 280, { name: 'laps' });
        const compare = gn('data.compare', 740, 280, { op: '>=', b: 1 });
        const branch = gn('action.branch', 740, 80);
        const show = gn('action.showUI', 960, 80, { entityId: 'ui-win' });
        const win = gn('action.win', 1150, 80, { message: 'Checkpoint cleared!' });
        return {
          nodes: [ev, destroy, add, get, compare, branch, show, win],
          edges: [
            ge(ev.id, 'next', destroy.id, 'exec'), ge(ev.id, 'other', destroy.id, 'entity'),
            ge(destroy.id, 'next', add.id, 'exec'), ge(add.id, 'next', branch.id, 'exec'),
            ge(get.id, 'value', compare.id, 'a'), ge(compare.id, 'value', branch.id, 'condition'),
            ge(branch.id, 'true', show.id, 'exec'), ge(show.id, 'next', win.id, 'exec'),
          ],
        };
      })(),
    }),
  ];
  return project;
}

function survival3D() {
  const project = blankProject('Ember Isle', '3d');
  project.project.description = 'A low-poly survival starter: explore an island, gather wood and stone into the HUD inventory, meet a wanderer and survive until the beacon is lit.';
  project.project.gravityY = -24;
  project.project.controls = 'thirdPerson';
  project.variables = { wood: 0, stone: 0 };
  const scene = project.scenes[0];
  scene.name = 'Driftwood Shore';
  scene.environment = { sky: 'gradient', top: '#38bdf8', bottom: '#fef3c7', fog: true, fogColor: '#bae6fd', fogNear: 28, fogFar: 95 };
  scene.gravity = { x: 0, y: -24, z: 0 };
  const ground = entity('Island Terrain', { id: 'ground', x: 0, y: -0.6, z: 0, w: 38, h: 1.2, d: 38, components: { MeshRenderer: { mesh: 'box', color: '#a3a35a', roughness: 0.95, metalness: 0 }, Rigidbody3D: { bodyType: 'static' }, Collider3D: { shape: 'box', width: 38, height: 1.2, depth: 38 } } });
  const tide = entity('Tide', { id: 'tide', x: 0, y: -0.85, z: 0, w: 60, h: 0.1, d: 60, components: { MeshRenderer: { mesh: 'plane', color: '#0ea5e9', opacity: 0.45, transparent: true, roughness: 0.2, metalness: 0.1 } } });
  const stump = (id, x, z) => entity('Stump', { id, x, y: 0.25, z, w: 0.8, h: 0.9, d: 0.8, components: { MeshRenderer: { mesh: 'cylinder', color: '#7c4a24', roughness: 0.9 } } });
  const wood = (id, x, z) => entity('Pine', { id, x, y: 2, z, w: 1.6, h: 4, d: 1.6, tags: ['wood'], components: { MeshRenderer: { mesh: 'cone', color: '#166534', roughness: 0.8, metalness: 0 }, Collider3D: { shape: 'box', width: 1.6, height: 4, depth: 1.6, sensor: true } } });
  const stone = (id, x, z) => entity('Stone Outcrop', { id, x, y: 0.7, z, w: 1.5, h: 1.4, d: 1.5, tags: ['stone'], components: { MeshRenderer: { mesh: 'sphere', color: '#94a3b8', roughness: 0.9, metalness: 0.05 }, Collider3D: { shape: 'box', width: 1.5, height: 1.4, depth: 1.5, sensor: true } } });
  const trees = [wood('pine-1', -6, -2), wood('pine-2', 6, -3), wood('pine-3', -9, 5)];
  const stones = [stone('stone-1', 7, 4), stone('stone-2', -4, -8)];
  const player = entity('Player', { id: 'player', x: 0, y: 1.15, z: 10, w: 0.9, h: 1.8, d: 0.9, tags: ['player'], components: { MeshRenderer: { mesh: 'capsule', color: '#f59e0b', roughness: 0.5, metalness: 0.05 }, Rigidbody3D: { bodyType: 'dynamic', mass: 1, fixedRotation: true }, Collider3D: { shape: 'box', width: 0.85, height: 1.75, depth: 0.85 }, CharacterController3D: { speed: 4.5, runSpeed: 7, jumpHeight: 1.6, gravity: -24, cameraRelative: true } } });
  const camera = entity('Follow Camera', { id: 'camera', x: 0, y: 4, z: 16, w: 1, h: 1, d: 1, components: { Camera3D: { fov: 60, controller: 'thirdPerson', follow: 'player', offsetY: 2.6, offsetZ: 8, smoothing: 0.16 } } });
  const npc = entity('Wanderer', { id: 'npc', x: 6, y: 1, z: 7, w: 1, h: 1.8, d: 1, tags: ['npc'], components: { MeshRenderer: { mesh: 'capsule', color: '#e2e8f0', roughness: 0.7 }, Collider3D: { shape: 'box', width: 1.1, height: 2, depth: 1.1, sensor: true } } });
  const woodHud = entity('Wood Counter', { id: 'ui-wood', x: 0, y: 18, w: 220, h: 36, components: { UIElement: { kind: 'text', anchor: 'top-left', binding: 'wood', prefix: 'Wood:  ', size: 20, color: '#fef3c7' } } });
  const stoneHud = entity('Stone Counter', { id: 'ui-stone', x: 0, y: 54, w: 220, h: 36, components: { UIElement: { kind: 'text', anchor: 'top-left', binding: 'stone', prefix: 'Stone:  ', size: 20, color: '#e2e8f0' } } });
  const dialogue = entity('Wanderer Dialogue', { id: 'ui-dialogue', x: 0, y: 120, w: 620, h: 64, visible: false, components: { UIElement: { kind: 'text', anchor: 'bottom-center', text: 'Wanderer: Two pines and one stone will light the beacon before the tide.', size: 18, color: '#fef9c3', fill: 'rgba(15,23,42,.72)', visible: false } } });
  scene.entities = [tide, ground, ...trees.flatMap((tree) => [stump(`${tree.id}-stump`, tree.x, tree.z), tree]), ...stones, player, npc, camera, woodHud, stoneHud, dialogue];

  const gatherWood = (() => {
    const ev = gn('event.triggerEnter', 60, 80, { tagFilter: 'wood' });
    const destroy = gn('action.destroy', 300, 80);
    const add = gn('variable.add', 520, 80, { name: 'wood', amount: 1 });
    const get = gn('variable.get', 520, 280, { name: 'wood' });
    const compare = gn('data.compare', 740, 280, { op: '>=', b: 2 });
    const getStone = gn('variable.get', 520, 380, { name: 'stone' });
    const stoneCompare = gn('data.compare', 740, 380, { op: '>=', b: 1 });
    const and = gn('data.and', 920, 300);
    const branch = gn('action.branch', 1080, 80);
    const winNode = gn('action.win', 1280, 80, { message: 'The beacon is lit. You survived the isle.' });
    return gameScript({
      name: 'Gather Wood', entityId: 'player', trigger: 'triggerEnter',
      graph: {
        nodes: [ev, destroy, add, get, compare, getStone, stoneCompare, and, branch, winNode],
        edges: [
          ge(ev.id, 'next', destroy.id, 'exec'), ge(ev.id, 'other', destroy.id, 'entity'),
          ge(destroy.id, 'next', add.id, 'exec'), ge(add.id, 'next', branch.id, 'exec'),
          ge(get.id, 'value', compare.id, 'a'), ge(getStone.id, 'value', stoneCompare.id, 'a'),
          ge(compare.id, 'value', and.id, 'a'), ge(stoneCompare.id, 'value', and.id, 'b'),
          ge(and.id, 'value', branch.id, 'condition'), ge(branch.id, 'true', winNode.id, 'exec'),
        ],
      },
    });
  })();

  const gatherStone = (() => {
    const ev = gn('event.triggerEnter', 60, 80, { tagFilter: 'stone' });
    const destroy = gn('action.destroy', 300, 80);
    const add = gn('variable.add', 520, 80, { name: 'stone', amount: 1 });
    const get = gn('variable.get', 520, 280, { name: 'stone' });
    const compare = gn('data.compare', 740, 280, { op: '>=', b: 1 });
    const getWood = gn('variable.get', 520, 380, { name: 'wood' });
    const woodCompare = gn('data.compare', 740, 380, { op: '>=', b: 2 });
    const and = gn('data.and', 920, 300);
    const branch = gn('action.branch', 1080, 80);
    const winNode = gn('action.win', 1280, 80, { message: 'The beacon is lit. You survived the isle.' });
    return gameScript({
      name: 'Gather Stone', entityId: 'player', trigger: 'triggerEnter',
      graph: {
        nodes: [ev, destroy, add, get, compare, getWood, woodCompare, and, branch, winNode],
        edges: [
          ge(ev.id, 'next', destroy.id, 'exec'), ge(ev.id, 'other', destroy.id, 'entity'),
          ge(destroy.id, 'next', add.id, 'exec'), ge(add.id, 'next', branch.id, 'exec'),
          ge(get.id, 'value', compare.id, 'a'), ge(getWood.id, 'value', woodCompare.id, 'a'),
          ge(compare.id, 'value', and.id, 'a'), ge(woodCompare.id, 'value', and.id, 'b'),
          ge(and.id, 'value', branch.id, 'condition'), ge(branch.id, 'true', winNode.id, 'exec'),
        ],
      },
    });
  })();

  const npcEvent = gn('event.triggerEnter', 60, 80, { tagFilter: 'player' });
  const npcShow = gn('action.showUI', 320, 80, { entityId: 'ui-dialogue' });
  const npcTalk = gameScript({
    name: 'Wanderer Greeting', entityId: 'npc', trigger: 'triggerEnter',
    graph: { nodes: [npcEvent, npcShow], edges: [ge(npcEvent.id, 'next', npcShow.id, 'exec')] },
  });
  project.scripts = [gatherWood, gatherStone, npcTalk];
  return project;
}

export const GAME_TEMPLATES = [
  { id: 'game-platformer-2d', name: '2D Platformer', kind: 'game', category: 'game', description: 'A complete side-scroller with movement, jumping, Matter.js collisions, coins, camera follow and a win state.', build: platformer2D },
  { id: 'game-topdown-2d', name: 'Top-Down Adventure', kind: 'game', category: 'game', description: 'Top-down movement, environmental art, pickups and a working win condition.', build: topDown2D },
  { id: 'game-sandbox-2d', name: '2D Physics Sandbox', kind: 'game', category: 'game', description: 'Matter.js rigid bodies, a clickable spawner and a ramp for experimenting.', build: sandbox2D },
  { id: 'game-firstperson-3d', name: '3D First-Person Exploration', kind: 'game', category: 'game', description: 'A real first-person controller, mouse look, jump, interactable vault door, imported OBJ crate, lighting and UI.', build: firstPerson3D },
  { id: 'game-thirdperson-3d', name: '3D Third-Person Platformer', kind: 'game', category: 'game', description: 'Character controller, jump physics, platform course, collectibles and a third-person follow camera.', build: thirdPerson3D },
  { id: 'game-sandbox-3d', name: '3D Physics Sandbox', kind: 'game', category: 'game', description: 'Cannon rigid bodies, stacked crates, a ramp, player collision and click-to-spawn physics objects.', build: sandbox3D },
  { id: 'game-driving-3d', name: '3D Driving Prototype', kind: 'game', category: 'game', description: 'Arcade vehicle movement, chase camera, checkpoint trigger and lap counter.', build: driving3D },
  { id: 'game-survival-3d', name: '3D Low-Poly Survival', kind: 'game', category: 'game', description: 'A low-poly island with a third-person controller, gatherable wood and stone, an inventory HUD, a wandering NPC and a survival win condition.', build: survival3D },
  { id: 'game-blank-2d', name: 'Blank 2D Project', kind: 'game', category: 'blank', description: 'An empty 2D scene with a camera and the full editor.', build: () => blankProject('My 2D Game', '2d') },
  { id: 'game-blank-3d', name: 'Blank 3D Project', kind: 'game', category: 'blank', description: 'An empty 3D scene with a camera, sun and ground, ready for level building.', build: () => blankProject('My 3D Game', '3d') },
];
