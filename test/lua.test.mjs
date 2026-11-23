import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/game/lua.js';
import { gameNodeDef } from '../public/game/nodes.mjs';

const L = globalThis.CascadeLua;

test('Lua compiles a lifecycle script and keeps locals on the instance', () => {
  const result = L.compile('local score = 0\nfunction on_start()\n  log("ready")\nend\nfunction on_update(dt)\n  score = score + 1\nend', { lifecycle: true });
  assert.equal(result.ok, true, result.error);
  const calls = [];
  const api = { input: {}, log: (value) => calls.push(value) };
  const Factory = new Function('api', 'entity', `"use strict";\n${result.code}`);
  const Script = Factory(api, null);
  const instance = new Script();
  instance.game = { api: () => api };
  instance.entity = null;
  instance.onStart();
  instance.onUpdate(1 / 60);
  assert.deepEqual(calls, ['ready']);
  assert.equal(instance.L_score, 1);
});

test('Lua rejects invalid input with a useful line number', () => {
  const result = L.compile('if then', {});
  assert.equal(result.ok, false);
  assert.match(result.error, /Line 1/);
});

test('visual graph converts to runnable Lua with data wires and branches', () => {
  const graph = {
    nodes: [
      { id: 'evt', type: 'event.update', x: 0, y: 0, config: {} },
      { id: 'axis', type: 'input.axis', x: 0, y: 0, config: { action: 'horizontal' } },
      { id: 'math', type: 'data.math', x: 0, y: 0, config: { op: 'mul', b: 8 } },
      { id: 'vel', type: 'action.setVelocity', x: 0, y: 0, config: { entityId: '' } },
      { id: 'jumpKey', type: 'input.keyPressed', x: 0, y: 0, config: { key: 'Space' } },
      { id: 'grounded', type: 'data.grounded', x: 0, y: 0, config: {} },
      { id: 'and', type: 'data.and', x: 0, y: 0, config: {} },
      { id: 'branch', type: 'action.branch', x: 0, y: 0, config: {} },
      { id: 'jump', type: 'action.setVelocity', x: 0, y: 0, config: { entityId: '' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'evt', pin: 'next' }, to: { node: 'vel', pin: 'exec' } },
      { id: 'e2', from: { node: 'axis', pin: 'value' }, to: { node: 'math', pin: 'a' } },
      { id: 'e3', from: { node: 'math', pin: 'value' }, to: { node: 'vel', pin: 'x' } },
      { id: 'e4', from: { node: 'vel', pin: 'next' }, to: { node: 'branch', pin: 'exec' } },
      { id: 'e5', from: { node: 'jumpKey', pin: 'value' }, to: { node: 'and', pin: 'a' } },
      { id: 'e6', from: { node: 'grounded', pin: 'value' }, to: { node: 'and', pin: 'b' } },
      { id: 'e7', from: { node: 'and', pin: 'value' }, to: { node: 'branch', pin: 'condition' } },
      { id: 'e8', from: { node: 'branch', pin: 'true' }, to: { node: 'jump', pin: 'exec' } },
    ],
  };
  const result = L.graphToLua({ name: 'Movement', graph }, gameNodeDef);
  assert.match(result.code, /function on_update/);
  assert.match(result.code, /input\.axis/);
  assert.match(result.code, /if .* then/);
  const compiled = L.compile(result.code, { lifecycle: true });
  assert.equal(compiled.ok, true, compiled.error);

  const calls = [];
  const api = {
    input: { axis: () => 1, justPressed: () => true },
    getVelocity: () => 0,
    setVelocity: (_entity, x, y) => calls.push([x, y]),
    isGrounded: () => true,
    entity: () => null,
    getVar: () => 0,
    setVar: () => {},
    log: () => {},
  };
  const Factory = new Function('api', 'entity', `"use strict";\n${compiled.code}`);
  const Script = Factory(api, { x: 0, y: 0 });
  const instance = new Script();
  instance.game = { api: () => api };
  instance.entity = { x: 0, y: 0 };
  instance.onUpdate(1 / 60);
  assert.deepEqual(calls, [[8, null], [null, null]]);
});

test('graph conversion stops at cycles instead of overflowing the stack', () => {
  const graph = {
    nodes: [
      { id: 'evt', type: 'event.update', x: 0, y: 0, config: {} },
      { id: 'a', type: 'action.log', x: 0, y: 0, config: { message: 'a' } },
      { id: 'b', type: 'action.log', x: 0, y: 0, config: { message: 'b' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'evt', pin: 'next' }, to: { node: 'a', pin: 'exec' } },
      { id: 'e2', from: { node: 'a', pin: 'next' }, to: { node: 'b', pin: 'exec' } },
      { id: 'e3', from: { node: 'b', pin: 'next' }, to: { node: 'a', pin: 'exec' } },
    ],
  };
  const result = L.graphToLua({ name: 'Cycle', graph }, gameNodeDef);
  assert.ok(result.code.length < 2000);
  assert.equal(L.compile(result.code, { lifecycle: true }).ok, true);
});
