import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { GAME_TEMPLATES } from '../src/game/templates.js';
import { compileGameProject, validateGameProject } from '../public/game/compiler.js';
import { normalizeProject, blankProject } from '../public/game/schema.mjs';
import { buildGameHtml, buildGameZip } from '../src/game/export.js';

const template = (id) => GAME_TEMPLATES.find((item) => item.id === id).build();

test('every game template compiles and survives a save/reload round trip', () => {
  for (const entry of GAME_TEMPLATES) {
    const project = entry.build();
    const result = compileGameProject(project);
    assert.equal(result.ok, true, `${entry.id}: ${result.errors.map((error) => error.message).join('; ')}`);
    const reloaded = normalizeProject(JSON.parse(JSON.stringify(project)));
    assert.equal(reloaded.mode, project.mode);
    assert.equal(reloaded.scenes.length, project.scenes.length);
    assert.equal(reloaded.scripts.length, project.scripts.length);
    assert.deepEqual(reloaded, normalizeProject(project));
  }
});

test('3D templates contain a real character controller, physics and camera', () => {
  const project = template('game-firstperson-3d');
  assert.equal(project.mode, '3d');
  const entities = project.scenes[0].entities;
  const player = entities.find((entity) => entity.id === 'player');
  assert.ok(player.components.CharacterController3D);
  assert.ok(player.components.Rigidbody3D);
  assert.ok(player.components.Collider3D);
  assert.ok(entities.some((entity) => entity.components.Camera3D?.controller === 'firstPerson'));
  assert.ok(entities.some((entity) => entity.components.Light3D));
  assert.ok(project.assets.some((asset) => asset.type === 'model' && asset.src.startsWith('data:model/obj')));
  assert.ok(project.scripts.some((script) => script.type === 'visual' && script.graph.nodes.length > 2));
});

test('2D template still uses Matter components and camera follow', () => {
  const project = template('game-platformer-2d');
  assert.equal(project.mode, '2d');
  const entities = project.scenes[0].entities;
  assert.ok(entities.some((entity) => entity.components.Rigidbody2D));
  assert.ok(entities.some((entity) => entity.components.Collider2D));
  assert.ok(entities.some((entity) => entity.components.Camera2D?.follow === 'player'));
  assert.ok(project.scripts.length >= 2);
});

test('compiler reports missing script edges and bad entities', () => {
  const project = blankProject('Broken', '3d');
  project.scripts.push({ id: 's1', name: 'Bad', type: 'visual', trigger: 'update', graph: { nodes: [{ id: 'a', type: 'event.update', config: {} }], edges: [{ id: 'e', from: { node: 'a', pin: 'next' }, to: { node: 'missing', pin: 'exec' }, kind: 'exec' }] } });
  const result = validateGameProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /edge|node/i.test(error.message)));
});

test('standalone HTML export bundles the 3D engine, runtime, project and assets', async () => {
  const project = template('game-firstperson-3d');
  const result = await buildGameHtml(project, { ownerId: 'owner-test' });
  assert.ok(result.html.startsWith('<!doctype html>'));
  assert.ok(result.html.includes('window.__GAME_PROJECT__'));
  assert.ok(result.html.includes('CascadeThree'));
  assert.ok(result.html.includes('cannon-es'));
  assert.ok(result.html.includes('data:model/obj;base64,'));
  assert.ok(result.html.includes('CascadeGame3D'));
  assert.ok(!result.html.includes('src="/public/game'));
});

test('ZIP export includes playable html, game.json, README and runtime source', async () => {
  const project = template('game-sandbox-3d');
  const result = await buildGameZip(project, { ownerId: 'owner-test', source: true });
  const zip = await JSZip.loadAsync(result.buffer);
  assert.ok(zip.file('cascade-game/index.html'));
  assert.ok(zip.file('cascade-game/game.json'));
  assert.ok(zip.file('cascade-game/README.md'));
  assert.ok(zip.file('cascade-game/source/runtime3d.js'));
  assert.ok(zip.file('cascade-game/source/cannon-es.js'));
  const html = await zip.file('cascade-game/index.html').async('string');
  assert.ok(html.includes('CascadeGame3D'));
  const data = JSON.parse(await zip.file('cascade-game/game.json').async('string'));
  assert.equal(data.mode, '3d');
});

test('2D export bundles Matter and the 2D runtime', async () => {
  const result = await buildGameHtml(template('game-platformer-2d'), { ownerId: 'owner-test' });
  assert.ok(result.html.includes('matter.min.js') || result.html.includes('Matter'));
  assert.ok(result.html.includes('root.CascadeGame ='));
  assert.ok(result.html.includes('window.__GAME_PROJECT__'));
});
