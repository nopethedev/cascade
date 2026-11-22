import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSceneMeshes,
  orbitPosition,
  orbitCamera,
  zoomCamera,
  screenPanDelta,
  snapValue,
  applyGizmoDrag,
  transformCommand,
  sceneDiff,
  gridConfig,
  frameTrace,
} from '../public/studio/scene-engine.mjs';

const part = (id, className, props, children = []) => ({ id, className, name: id, props: { ClassName: className, ...props }, children });

function sampleScene() {
  return {
    placeName: 'Viewport fixture',
    services: [
      {
        id: 'workspace', className: 'Workspace', name: 'Workspace', props: {},
        children: [
          part('part-a', 'Part', { Size: { x: 4, y: 2, z: 4 }, Position: { x: 0, y: 2, z: 0 }, Color: '#e11d48', Material: 'Plastic' }),
          part('part-b', 'Part', { Size: { x: 8, y: 1, z: 8 }, Position: { x: 12, y: 1, z: 0 }, Color: '#22d3ee', CFrame: { x: 12, y: 1, z: 0, rx: 0, ry: 90, rz: 0 } }),
          { id: 'script', className: 'Script', name: 'Main', props: { Source: 'print("hi")' }, children: [] },
        ],
      },
      { id: 'gui', className: 'StarterGui', name: 'StarterGui', props: {}, children: [{ id: 'screen', className: 'ScreenGui', name: 'HUD', props: {}, children: [] }] },
      { id: 'storage', className: 'ReplicatedStorage', name: 'ReplicatedStorage', props: {}, children: [] },
    ],
  };
}

test('scene descriptors are built from real instance props and skip GUI/scripts', () => {
  const meshes = buildSceneMeshes(sampleScene());
  assert.equal(meshes.length, 2);
  assert.deepEqual(meshes.map((m) => m.id), ['part-a', 'part-b']);
  assert.deepEqual(meshes[0].position, { x: 0, y: 2, z: 0 });
  assert.deepEqual(meshes[0].size, { x: 4, y: 2, z: 4 });
  assert.equal(meshes[0].color, '#e11d48');
  assert.deepEqual(meshes[1].rotation, { rx: 0, ry: 90, rz: 0 });
});

test('orbit, zoom, pan and grid math are deterministic', () => {
  const framed = orbitPosition({ target: { x: 0, y: 0, z: 0 }, radius: 10, theta: 0, phi: Math.PI / 2 });
  assert.ok(Math.abs(framed.x) < 1e-12 && Math.abs(framed.y) < 1e-12 && Math.abs(framed.z - 10) < 1e-12);
  const orbited = orbitCamera({ theta: 0.8, phi: 1.05 }, 20, 20);
  assert.equal(orbited.theta, 0.68);
  assert.ok(orbited.phi < 1.05);
  assert.equal(zoomCamera(34, 100), 37.5);
  assert.equal(zoomCamera(3, -1000), 3);
  const pan = screenPanDelta({ dx: 10, dy: 0, radius: 34, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } });
  assert.equal(pan.x, -0.544);
  assert.equal(pan.y, 0);
  assert.equal(snapValue(0.612, 1), 1);
  assert.equal(snapValue(-1.49, 0.5), -1.5);
  assert.deepEqual(gridConfig(160, 160), { size: 160, divisions: 160, spacing: 1 });
});

test('move/rotate/scale gizmo drags clamp, snap and support local space', () => {
  const start = { id: 'part-a', position: { x: 0, y: 2, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, size: { x: 4, y: 2, z: 4 }, hasCFrame: false };
  const moved = applyGizmoDrag(start, { mode: 'move', dx: 10, dy: 0, radius: 34, snapStep: 1 });
  assert.deepEqual(moved.position, { x: 1, y: 2, z: 0 });
  const xOnly = applyGizmoDrag(start, { mode: 'move', axis: 'x', dx: 10, dy: 50, radius: 34, snapStep: 1 });
  assert.deepEqual(xOnly.position, { x: 1, y: 2, z: 0 });
  const local = applyGizmoDrag({ ...start, rotation: { rx: 0, ry: 90, rz: 0 } }, { mode: 'move', dx: 10, dy: 0, radius: 34, space: 'local', snapStep: 1 });
  assert.deepEqual(local.position, { x: 0, y: 2, z: -1 });
  const rotated = applyGizmoDrag(start, { mode: 'rotate', dx: 100, dy: 0, rotationSnap: true, rotationDegrees: 15 });
  assert.equal(rotated.rotation.ry, 75);
  const scaled = applyGizmoDrag(start, { mode: 'scale', dx: 100, dy: 0 });
  assert.deepEqual(scaled.size, { x: 5.6, y: 2.8, z: 5.6 });
});

test('transform diffs are the exact relay update payloads', () => {
  const start = { id: 'part-a', position: { x: 0, y: 2, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, size: { x: 4, y: 2, z: 4 }, hasCFrame: false };
  const moved = applyGizmoDrag(start, { mode: 'move', dx: 10, dy: 0, radius: 34, snapStep: 1 });
  assert.deepEqual(transformCommand('part-a', start, moved, 'move'), {
    kind: 'update',
    payload: { instanceId: 'part-a', props: { Position: { x: 1, y: 2, z: 0 } } },
  });
  const cframeStart = { ...start, hasCFrame: true, rotation: { rx: 0, ry: 15, rz: 0 }, cframe: { x: 0, y: 2, z: 0, rx: 0, ry: 15, rz: 0 } };
  const rotated = applyGizmoDrag(cframeStart, { mode: 'rotate', dx: 20, dy: 0, rotationSnap: true });
  const rotateCommand = transformCommand('part-a', cframeStart, rotated, 'rotate');
  assert.equal(rotateCommand.payload.props.CFrame.ry, 30);
  assert.equal(rotateCommand.payload.props.CFrame.x, 0);
  const scaled = applyGizmoDrag(start, { mode: 'scale', dx: 100, dy: 0 });
  assert.deepEqual(transformCommand('part-a', start, scaled, 'scale').payload.props.Size, { x: 5.6, y: 2.8, z: 5.6 });
});

test('sceneDiff emits only changed instances and properties', () => {
  const before = buildSceneMeshes(sampleScene());
  const scene = sampleScene();
  scene.services[0].children[0].props.Position = { x: 0, y: 2, z: 8 };
  scene.services[0].children.splice(1, 1);
  scene.services[0].children.push(part('part-c', 'Part', { Size: { x: 2, y: 2, z: 2 }, Position: { x: 0, y: 1, z: 0 } }));
  const events = sceneDiff(before, buildSceneMeshes(scene));
  assert.deepEqual(events.map((e) => e.kind).sort(), ['create', 'delete', 'update']);
  assert.deepEqual(events.find((e) => e.kind === 'update').payload.props.Position, { x: 0, y: 2, z: 8 });
  assert.equal(events.find((e) => e.kind === 'delete').payload.instanceId, 'part-b');
  assert.equal(events.find((e) => e.kind === 'create').payload.instanceId, 'part-c');
});

test('deterministic headless frame contains projected geometry and a stable trace', () => {
  const trace = frameTrace(sampleScene(), { target: { x: 4, y: 1, z: 0 }, radius: 28, theta: 0.8, phi: 1.05, fov: 48 }, 320, 200);
  assert.equal(trace.width, 320);
  assert.equal(trace.height, 200);
  assert.equal(trace.meshes, 2);
  assert.equal(trace.segments, 24);
  assert.ok(trace.visiblePixels > 100, `expected visible geometry, got ${trace.visiblePixels}`);
  assert.match(trace.hash, /^[0-9a-f]{8}$/);
  const again = frameTrace(sampleScene(), { target: { x: 4, y: 1, z: 0 }, radius: 28, theta: 0.8, phi: 1.05, fov: 48 }, 320, 200);
  assert.equal(again.hash, trace.hash);
  const gridded = frameTrace(sampleScene(), { target: { x: 4, y: 1, z: 0 }, radius: 28, theta: 0.8, phi: 1.05, fov: 48 }, 320, 200, { grid: true, gridSize: 28, gridDivisions: 14 });
  assert.equal(gridded.segments, trace.segments + 31, 'grid must add 31 projected lines');
  assert.notEqual(gridded.hash, trace.hash);
  // A small ASCII preview makes the frame trace auditable in terminal output.
  const chars = ' .:-=+*#%@';
  let ascii = '';
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const px = Math.floor((x / 64) * 320);
      const py = Math.floor((y / 24) * 200);
      const i = (py * 320 + px) * 3;
      const lit = Math.abs(trace.pixels[i] - 11) + Math.abs(trace.pixels[i + 1] - 16) + Math.abs(trace.pixels[i + 2] - 24) > 30;
      ascii += lit ? chars[Math.min(chars.length - 1, 4 + ((x + y) % 4))] : ' ';
    }
    ascii += '\n';
  }
  console.log(`HEADLESS FRAME ${trace.width}x${trace.height} meshes=${trace.meshes} segments=${trace.segments} litPixels=${trace.visiblePixels} traceHash=${trace.hash}`);
  console.log(ascii);
});
