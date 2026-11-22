/* Game Studio visual-script node registry. Kept separate from Cascade Flow's
   Discord node catalog so Discord operations can never leak into games. */
import { GAME3D_NODE_DEFS } from './nodes3d.mjs';

const exec = (id = 'exec', label = '') => ({ id, label, kind: 'exec' });
const out = (id = 'next', label = '') => ({ id, label, kind: 'exec' });
const data = (id, type = 'any', label = '') => ({ id, type, label });

const fields = {
  key: { key: 'key', label: 'Key code', type: 'text', placeholder: 'Space or KeyE' },
  action: { key: 'action', label: 'Input action', type: 'text', placeholder: 'horizontal' },
  name: { key: 'name', label: 'Variable / entity name', type: 'text' },
  text: { key: 'text', label: 'Text', type: 'textarea' },
  number: { key: 'value', label: 'Value', type: 'number' },
  slot: { key: 'slot', label: 'Save slot', type: 'text', placeholder: 'slot1' },
};

const trigger = (type, title, triggerName, extraInputs = [], description = '') => ({
  type, title, category: 'Lifecycle', description, color: '#38bdf8', trigger: triggerName,
  inputs: [], outputs: [out()], fields: [], defaults: {}, ...extraInputs,
});

export const GAME_NODE_DEFS = [
  trigger('event.start', 'On Game Start', 'start', {}, 'Runs once after the scene and assets are ready.'),
  trigger('event.update', 'On Update', 'update', {}, 'Runs every rendered frame with delta time.'),
  trigger('event.fixedUpdate', 'On Fixed Update', 'fixedUpdate', {}, 'Runs at the physics timestep.'),
  trigger('event.destroy', 'On Destroy', 'destroy', {}, 'Runs when the entity is removed.'),
  trigger('event.sceneLoad', 'On Scene Load', 'sceneLoad', {}, 'Runs after a scene finishes loading.'),
  trigger('event.sceneUnload', 'On Scene Unload', 'sceneUnload', {}, 'Runs before a scene is unloaded.'),
  {
    type: 'event.collisionEnter', title: 'On Collision Enter', category: 'Physics', trigger: 'collisionEnter',
    color: '#f59e0b', description: 'Fires when this entity begins touching another collider.',
    inputs: [], outputs: [out(), data('other', 'entity'), data('tag', 'string')],
    fields: [{ key: 'tagFilter', label: 'Tag filter (optional)', type: 'text' }], defaults: { tagFilter: '' },
  },
  {
    type: 'event.collisionExit', title: 'On Collision Exit', category: 'Physics', trigger: 'collisionExit',
    color: '#f59e0b', description: 'Fires when the contact with another collider ends.',
    inputs: [], outputs: [out(), data('other', 'entity'), data('tag', 'string')],
    fields: [{ key: 'tagFilter', label: 'Tag filter (optional)', type: 'text' }], defaults: { tagFilter: '' },
  },
  {
    type: 'event.uiClick', title: 'On UI Click', category: 'UI', trigger: 'uiClick',
    color: '#a855f7', description: 'Fires when a clickable UI element is pressed.',
    inputs: [], outputs: [out(), data('clicked', 'entity')], fields: [], defaults: {},
  },
  {
    type: 'event.keyPressed', title: 'On Key Pressed', category: 'Input', trigger: 'keyPressed',
    color: '#22c55e', description: 'Fires once for a key press, not every frame.',
    inputs: [], outputs: [out()], fields: [fields.key], defaults: { key: 'Space' },
  },
  {
    type: 'event.animationFinished', title: 'On Animation Finished', category: 'Animation', trigger: 'animationFinished',
    color: '#ec4899', description: 'Fires when a non-looping animation completes.',
    inputs: [], outputs: [out(), data('name', 'string')], fields: [], defaults: {},
  },

  {
    type: 'input.axis', title: 'Input Axis', category: 'Input', description: 'Reads -1..1 from an input action.',
    color: '#22c55e', inputs: [], outputs: [data('value', 'number')], fields: [fields.action], defaults: { action: 'horizontal' },
  },
  {
    type: 'input.keyHeld', title: 'Key Held', category: 'Input', description: 'True while a key is down.',
    color: '#22c55e', inputs: [], outputs: [data('value', 'boolean')], fields: [fields.key], defaults: { key: 'Space' },
  },
  {
    type: 'input.keyPressed', title: 'Key Pressed', category: 'Input', description: 'True only on the frame a key went down.',
    color: '#22c55e', inputs: [], outputs: [data('value', 'boolean')], fields: [fields.key], defaults: { key: 'Space' },
  },
  {
    type: 'input.mouseX', title: 'Mouse X', category: 'Input', description: 'Pointer position in world coordinates.',
    color: '#22c55e', inputs: [], outputs: [data('value', 'number')], fields: [], defaults: {},
  },
  {
    type: 'input.mouseY', title: 'Mouse Y', category: 'Input', description: 'Pointer position in world coordinates.',
    color: '#22c55e', inputs: [], outputs: [data('value', 'number')], fields: [], defaults: {},
  },
  {
    type: 'input.mouseDown', title: 'Mouse Down', category: 'Input', description: 'True while the pointer is down.',
    color: '#22c55e', inputs: [], outputs: [data('value', 'boolean')], fields: [], defaults: {},
  },
  {
    type: 'input.gamepadButton', title: 'Gamepad Button', category: 'Input', description: 'Gamepad button state.',
    color: '#22c55e', inputs: [], outputs: [data('value', 'boolean')], fields: [{ key: 'button', label: 'Button index', type: 'number' }], defaults: { button: 0 },
  },
  {
    type: 'input.gamepadAxis', title: 'Gamepad Axis', category: 'Input', description: 'Gamepad stick/axis value.',
    color: '#22c55e', inputs: [], outputs: [data('value', 'number')], fields: [{ key: 'axis', label: 'Axis index', type: 'number' }], defaults: { axis: 0 },
  },
  {
    type: 'input.touch', title: 'Touch Active', category: 'Input', description: 'True while a touch is pressed.',
    color: '#22c55e', inputs: [], outputs: [data('value', 'boolean')], fields: [], defaults: {},
  },

  {
    type: 'data.position', title: 'Get Position', category: 'Transform', description: 'World position of the target entity.',
    color: '#06b6d4', inputs: [data('entity', 'entity')], outputs: [data('x', 'number'), data('y', 'number')],
    fields: [{ key: 'entityId', label: 'Fallback entity id', type: 'entity' }], defaults: { entityId: '' },
  },
  {
    type: 'data.velocity', title: 'Get Velocity', category: 'Physics', description: 'Linear velocity of the target body.',
    color: '#06b6d4', inputs: [data('entity', 'entity')], outputs: [data('x', 'number'), data('y', 'number')],
    fields: [{ key: 'entityId', label: 'Fallback entity id', type: 'entity' }], defaults: { entityId: '' },
  },
  {
    type: 'data.rotation', title: 'Get Rotation', category: 'Transform', description: 'Rotation in degrees.',
    color: '#06b6d4', inputs: [data('entity', 'entity')], outputs: [data('value', 'number')],
    fields: [], defaults: {},
  },
  {
    type: 'data.scale', title: 'Get Scale', category: 'Transform', description: 'Scale X/Y.',
    color: '#06b6d4', inputs: [data('entity', 'entity')], outputs: [data('x', 'number'), data('y', 'number')],
    fields: [], defaults: {},
  },
  {
    type: 'data.self', title: 'Self', category: 'Object', description: 'The entity that owns this script.',
    color: '#06b6d4', inputs: [], outputs: [data('entity', 'entity')], fields: [], defaults: {},
  },
  {
    type: 'data.find', title: 'Find Entity', category: 'Object', description: 'Finds an entity by id or name.',
    color: '#06b6d4', inputs: [], outputs: [data('entity', 'entity')], fields: [{ key: 'name', label: 'Entity name or id', type: 'text' }], defaults: { name: '' },
  },
  {
    type: 'data.children', title: 'Get Children', category: 'Object', description: 'Child entity array.',
    color: '#06b6d4', inputs: [data('entity', 'entity')], outputs: [data('value', 'array')], fields: [], defaults: {},
  },
  {
    type: 'data.distance', title: 'Distance Between', category: 'Transform', description: 'Distance between two entities/positions.',
    color: '#06b6d4', inputs: [data('a', 'entity'), data('b', 'entity')], outputs: [data('value', 'number')], fields: [], defaults: {},
  },
  {
    type: 'data.rigidbody', title: 'Get Rigidbody', category: 'Physics', description: 'Returns whether the entity has a physics body.',
    color: '#06b6d4', inputs: [data('entity', 'entity')], outputs: [data('value', 'boolean')], fields: [], defaults: {},
  },
  {
    type: 'data.grounded', title: 'Is Grounded', category: 'Physics', description: 'True when a downward contact or short ray hits the ground.',
    color: '#06b6d4', inputs: [data('entity', 'entity')], outputs: [data('value', 'boolean')], fields: [], defaults: {},
  },
  {
    type: 'data.compare', title: 'Compare', category: 'Logic', description: 'Compares two values.',
    color: '#facc15', inputs: [data('a', 'number'), data('b', 'number')], outputs: [data('value', 'boolean')],
    fields: [{ key: 'op', label: 'Operator', type: 'select', options: ['==', '!=', '>', '>=', '<', '<='] }], defaults: { op: '>=', a: 0, b: 0 },
  },
  {
    type: 'data.math', title: 'Math', category: 'Logic', description: 'Arithmetic on two numbers.',
    color: '#facc15', inputs: [data('a', 'number'), data('b', 'number')], outputs: [data('value', 'number')],
    fields: [{ key: 'op', label: 'Operator', type: 'select', options: ['add', 'sub', 'mul', 'div', 'min', 'max'] }], defaults: { op: 'add', a: 0, b: 1 },
  },
  {
    type: 'data.random', title: 'Random', category: 'Logic', description: 'Random number between min and max.',
    color: '#facc15', inputs: [data('min', 'number'), data('max', 'number')], outputs: [data('value', 'number')],
    fields: [], defaults: { min: 0, max: 1 },
  },
  {
    type: 'data.and', title: 'AND', category: 'Logic', description: 'Boolean AND.', color: '#facc15',
    inputs: [data('a', 'boolean'), data('b', 'boolean')], outputs: [data('value', 'boolean')], fields: [], defaults: {},
  },
  {
    type: 'data.or', title: 'OR', category: 'Logic', description: 'Boolean OR.', color: '#facc15',
    inputs: [data('a', 'boolean'), data('b', 'boolean')], outputs: [data('value', 'boolean')], fields: [], defaults: {},
  },
  {
    type: 'data.not', title: 'NOT', category: 'Logic', description: 'Boolean NOT.', color: '#facc15',
    inputs: [data('a', 'boolean')], outputs: [data('value', 'boolean')], fields: [], defaults: {},
  },
  {
    type: 'data.string', title: 'Text Template', category: 'Data', description: 'Text with {{variable}} placeholders.',
    color: '#8b5cf6', inputs: [], outputs: [data('value', 'string')], fields: [fields.text], defaults: { text: 'Hello {{player}}' },
  },
  {
    type: 'variable.get', title: 'Get Variable', category: 'Data', description: 'Reads a project or save variable.',
    color: '#8b5cf6', inputs: [], outputs: [data('value', 'any')], fields: [fields.name], defaults: { name: 'score' },
  },
  {
    type: 'variable.set', title: 'Set Variable', category: 'Data', description: 'Writes a project variable.',
    color: '#8b5cf6', inputs: [exec(), data('value', 'any')], outputs: [out()], fields: [fields.name], defaults: { name: 'score', value: 0 },
  },
  {
    type: 'variable.add', title: 'Add To Variable', category: 'Data', description: 'Adds a number to a variable.',
    color: '#8b5cf6', inputs: [exec(), data('amount', 'number')], outputs: [out()], fields: [fields.name], defaults: { name: 'score', amount: 1 },
  },

  {
    type: 'action.setVelocity', title: 'Set Velocity', category: 'Physics', description: 'Sets linear velocity.',
    color: '#f59e0b', inputs: [exec(), data('x', 'number'), data('y', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0 },
  },
  {
    type: 'action.applyForce', title: 'Apply Force', category: 'Physics', description: 'Applies a force to the body.',
    color: '#f59e0b', inputs: [exec(), data('x', 'number'), data('y', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0 },
  },
  {
    type: 'action.applyImpulse', title: 'Apply Impulse', category: 'Physics', description: 'Adds an instant velocity change.',
    color: '#f59e0b', inputs: [exec(), data('x', 'number'), data('y', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0 },
  },
  {
    type: 'action.setGravityScale', title: 'Set Gravity Scale', category: 'Physics', description: 'Changes gravity for this body.',
    color: '#f59e0b', inputs: [exec(), data('value', 'number')], outputs: [out()], fields: [], defaults: { value: 1 },
  },
  {
    type: 'action.setPosition', title: 'Set Position', category: 'Transform', description: 'Teleports the entity and its body.',
    color: '#06b6d4', inputs: [exec(), data('x', 'number'), data('y', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0 },
  },
  {
    type: 'action.translate', title: 'Translate', category: 'Transform', description: 'Moves the entity by a delta.',
    color: '#06b6d4', inputs: [exec(), data('x', 'number'), data('y', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0 },
  },
  {
    type: 'action.setRotation', title: 'Set Rotation', category: 'Transform', description: 'Sets rotation in degrees.',
    color: '#06b6d4', inputs: [exec(), data('value', 'number')], outputs: [out()], fields: [], defaults: { value: 0 },
  },
  {
    type: 'action.setScale', title: 'Set Scale', category: 'Transform', description: 'Sets scale X/Y.',
    color: '#06b6d4', inputs: [exec(), data('x', 'number'), data('y', 'number')], outputs: [out()], fields: [], defaults: { x: 1, y: 1 },
  },
  {
    type: 'action.lookAt', title: 'Look At', category: 'Transform', description: 'Points rotation at another entity.',
    color: '#06b6d4', inputs: [exec(), data('target', 'entity')], outputs: [out()], fields: [], defaults: {},
  },

  {
    type: 'action.spawn', title: 'Spawn Prefab', category: 'Object', description: 'Instantiates a prefab in the active scene.',
    color: '#38bdf8', inputs: [exec(), data('x', 'number'), data('y', 'number')], outputs: [out(), data('entity', 'entity')],
    fields: [{ key: 'prefabId', label: 'Prefab id', type: 'text' }], defaults: { prefabId: '', x: 0, y: 0 },
  },
  {
    type: 'action.destroy', title: 'Destroy Entity', category: 'Object', description: 'Removes an entity from the scene.',
    color: '#38bdf8', inputs: [exec(), data('entity', 'entity')], outputs: [out()], fields: [], defaults: {},
  },
  {
    type: 'action.setVisible', title: 'Set Visible', category: 'Object', description: 'Shows or hides an entity.',
    color: '#38bdf8', inputs: [exec(), data('entity', 'entity'), data('visible', 'boolean')], outputs: [out()], fields: [], defaults: { visible: true },
  },
  {
    type: 'action.playAnimation', title: 'Play Animation', category: 'Animation', description: 'Plays an animation by name.',
    color: '#ec4899', inputs: [exec(), data('entity', 'entity')], outputs: [out()],
    fields: [{ key: 'name', label: 'Animation', type: 'text' }], defaults: { name: 'default' },
  },
  {
    type: 'action.stopAnimation', title: 'Stop Animation', category: 'Animation', color: '#ec4899',
    inputs: [exec(), data('entity', 'entity')], outputs: [out()], fields: [], defaults: {},
  },
  {
    type: 'action.pauseAnimation', title: 'Pause Animation', category: 'Animation', color: '#ec4899',
    inputs: [exec(), data('entity', 'entity')], outputs: [out()], fields: [], defaults: {},
  },
  {
    type: 'action.setAnimationSpeed', title: 'Set Animation Speed', category: 'Animation', color: '#ec4899',
    inputs: [exec(), data('entity', 'entity'), data('value', 'number')], outputs: [out()], fields: [], defaults: { value: 1 },
  },

  {
    type: 'action.playSound', title: 'Play Sound', category: 'Audio', description: 'Plays an audio asset.',
    color: '#14b8a6', inputs: [exec()], outputs: [out()],
    fields: [{ key: 'assetId', label: 'Audio asset', type: 'asset' }, { key: 'volume', label: 'Volume', type: 'number', min: 0, max: 1, step: 0.05 }, { key: 'loop', label: 'Loop', type: 'boolean' }],
    defaults: { assetId: '', volume: 0.8, loop: false },
  },
  {
    type: 'action.stopSound', title: 'Stop Sound', category: 'Audio', color: '#14b8a6',
    inputs: [exec()], outputs: [out()], fields: [{ key: 'assetId', label: 'Audio asset (blank = all)', type: 'asset' }], defaults: { assetId: '' },
  },
  {
    type: 'action.setVolume', title: 'Set Volume', category: 'Audio', color: '#14b8a6',
    inputs: [exec(), data('value', 'number')], outputs: [out()], fields: [], defaults: { value: 0.8 },
  },
  {
    type: 'action.setPitch', title: 'Set Pitch', category: 'Audio', color: '#14b8a6',
    inputs: [exec(), data('value', 'number')], outputs: [out()], fields: [], defaults: { value: 1 },
  },
  {
    type: 'action.playMusic', title: 'Play Music', category: 'Audio', color: '#14b8a6',
    inputs: [exec()], outputs: [out()], fields: [{ key: 'assetId', label: 'Music asset', type: 'asset' }], defaults: { assetId: '' },
  },
  {
    type: 'action.fadeAudio', title: 'Fade Audio', category: 'Audio', color: '#14b8a6',
    inputs: [exec(), data('value', 'number')], outputs: [out()], fields: [{ key: 'duration', label: 'Seconds', type: 'number' }], defaults: { value: 0, duration: 1 },
  },

  {
    type: 'action.cameraFollow', title: 'Camera Follow', category: 'Camera', color: '#64748b',
    inputs: [exec(), data('entity', 'entity')], outputs: [out()], fields: [], defaults: {},
  },
  {
    type: 'action.cameraShake', title: 'Camera Shake', category: 'Camera', color: '#64748b',
    inputs: [exec(), data('intensity', 'number'), data('duration', 'number')], outputs: [out()], fields: [], defaults: { intensity: 8, duration: 0.3 },
  },
  {
    type: 'action.cameraZoom', title: 'Camera Zoom', category: 'Camera', color: '#64748b',
    inputs: [exec(), data('value', 'number')], outputs: [out()], fields: [], defaults: { value: 1 },
  },
  {
    type: 'action.setCameraBounds', title: 'Set Camera Bounds', category: 'Camera', color: '#64748b',
    inputs: [exec(), data('x', 'number'), data('y', 'number'), data('w', 'number'), data('h', 'number')], outputs: [out()], fields: [], defaults: { x: 0, y: 0, w: 3200, h: 1800 },
  },
  {
    type: 'data.screenToWorld', title: 'Screen To World', category: 'Camera', color: '#64748b',
    inputs: [data('x', 'number'), data('y', 'number')], outputs: [data('x', 'number'), data('y', 'number')], fields: [], defaults: {},
  },

  {
    type: 'action.setUIText', title: 'Set UI Text', category: 'UI', color: '#a855f7',
    inputs: [exec(), data('entity', 'entity'), data('text', 'string')], outputs: [out()], fields: [fields.text], defaults: { text: '' },
  },
  {
    type: 'action.setUIBinding', title: 'Bind UI Text', category: 'UI', color: '#a855f7',
    inputs: [exec(), data('entity', 'entity')], outputs: [out()],
    fields: [{ key: 'binding', label: 'Variable', type: 'text' }, { key: 'prefix', label: 'Prefix', type: 'text' }], defaults: { binding: '', prefix: '' },
  },
  {
    type: 'action.setUIValue', title: 'Set UI Value', category: 'UI', color: '#a855f7',
    inputs: [exec(), data('entity', 'entity'), data('value', 'number')], outputs: [out()], fields: [], defaults: { value: 1 },
  },
  {
    type: 'action.showUI', title: 'Show UI', category: 'UI', color: '#a855f7',
    inputs: [exec(), data('entity', 'entity')], outputs: [out()], fields: [], defaults: {},
  },
  {
    type: 'action.hideUI', title: 'Hide UI', category: 'UI', color: '#a855f7',
    inputs: [exec(), data('entity', 'entity')], outputs: [out()], fields: [], defaults: {},
  },

  {
    type: 'action.branch', title: 'Branch', category: 'Logic', description: 'Routes execution down true or false.',
    color: '#facc15', inputs: [exec(), data('condition', 'boolean')], outputs: [out('true', 'True'), out('false', 'False')],
    fields: [], defaults: {},
  },
  {
    type: 'action.loop', title: 'Loop', category: 'Logic', description: 'Runs the body a fixed number of times.',
    color: '#facc15', inputs: [exec(), data('count', 'number')], outputs: [out('body', 'Each'), out('done', 'Done')],
    fields: [], defaults: { count: 3 },
  },
  {
    type: 'action.wait', title: 'Wait', category: 'Logic', description: 'Delays the exec chain.',
    color: '#facc15', inputs: [exec(), data('seconds', 'number')], outputs: [out()], fields: [], defaults: { seconds: 0.5 },
  },
  {
    type: 'action.gate', title: 'Gate', category: 'Logic', description: 'Passes execution only while open is true.',
    color: '#facc15', inputs: [exec(), data('open', 'boolean')], outputs: [out()], fields: [], defaults: { open: true },
  },
  {
    type: 'action.doOnce', title: 'Do Once', category: 'Logic', description: 'Only the first execution passes per play session.',
    color: '#facc15', inputs: [exec()], outputs: [out()], fields: [], defaults: {},
  },
  {
    type: 'action.log', title: 'Log', category: 'Logic', description: 'Writes to the game console.',
    color: '#facc15', inputs: [exec(), data('message', 'string')], outputs: [out()], fields: [fields.text], defaults: { message: '' },
  },
  {
    type: 'action.win', title: 'Win Game', category: 'Logic', description: 'Stops the game and shows the win overlay.',
    color: '#22c55e', inputs: [exec(), data('message', 'string')], outputs: [], fields: [fields.text], defaults: { message: 'You win!' },
  },

  {
    type: 'action.save', title: 'Save Game', category: 'Data', color: '#8b5cf6',
    inputs: [exec()], outputs: [out()], fields: [fields.slot], defaults: { slot: 'slot1' },
  },
  {
    type: 'action.load', title: 'Load Game', category: 'Data', color: '#8b5cf6',
    inputs: [exec()], outputs: [out()], fields: [fields.slot], defaults: { slot: 'slot1' },
  },
  {
    type: 'action.deleteSave', title: 'Delete Save', category: 'Data', color: '#8b5cf6',
    inputs: [exec()], outputs: [out()], fields: [fields.slot], defaults: { slot: 'slot1' },
  },
  {
    type: 'action.setGravityScale', title: 'Set Gravity Scale', category: 'Physics', color: '#f59e0b',
    inputs: [exec(), data('value', 'number')], outputs: [out()], fields: [], defaults: { value: 1 },
  },
];

GAME_NODE_DEFS.push(...GAME3D_NODE_DEFS);
export const GAME_NODE_BY_TYPE = new Map(GAME_NODE_DEFS.map((def) => [def.type, def]));
export const GAME_NODE_CATEGORIES = [...new Set(GAME_NODE_DEFS.map((def) => def.category))];

export function gameNodeDef(type) {
  return GAME_NODE_BY_TYPE.get(type) || null;
}

export function nodePin(node, pinId, direction = 'outputs') {
  const def = gameNodeDef(node?.type);
  return (def?.[direction] || []).find((pin) => pin.id === pinId) || null;
}

export function defaultNodeConfig(type) {
  return { ...(gameNodeDef(type)?.defaults || {}) };
}

export function eventNodeForTrigger(graph, trigger) {
  return (graph?.nodes || []).find((node) => gameNodeDef(node.type)?.trigger === trigger) || null;
}
