#!/usr/bin/env node
/* Render the renderer-independent Studio scene to a deterministic PNG.
 *
 * The cloud browser cannot create a reliable WebGL context, so this script
 * uses the exact same scene descriptors and projection code as the Studio
 * viewport. It is evidence that the scene build, camera framing and wireframe
 * rasterisation are real, and a regression artefact for the viewport tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildSceneMeshes, frameTrace } from '../public/studio/scene-engine.mjs';

const part = (id, name, position, size, color) => ({
  id,
  name,
  className: 'Part',
  props: { ClassName: 'Part', Size: size, Position: position, Color: color },
  children: [],
});

const scene = {
  placeName: 'Cascade viewport proof',
  services: [
    {
      id: 'workspace', name: 'Workspace', className: 'Workspace',
      children: [
        part('baseplate', 'Baseplate', { x: 0, y: 0, z: 0 }, { x: 28, y: 1, z: 28 }, '#27272a'),
        part('spawn', 'SpawnLocation', { x: 0, y: 0.75, z: 0 }, { x: 10, y: 1, z: 10 }, '#71717a'),
        part('tower-a', 'Tower A', { x: -6, y: 3.5, z: 1 }, { x: 3, y: 6, z: 3 }, '#e11d48'),
        part('tower-b', 'Tower B', { x: 0, y: 5, z: -5 }, { x: 4, y: 9, z: 4 }, '#8b5cf6'),
        part('tower-c', 'Tower C', { x: 7, y: 2.5, z: 4 }, { x: 3, y: 4, z: 3 }, '#14b8a6'),
        part('crate', 'Crate', { x: 2, y: 1, z: 7 }, { x: 2, y: 2, z: 2 }, '#f59e0b'),
      ],
    },
    { id: 'lighting', name: 'Lighting', className: 'Lighting', children: [] },
  ],
};
const meshes = buildSceneMeshes(scene);
const width = 960;
const height = 600;
const frame = frameTrace(meshes, {
  position: { x: 34, y: 27, z: 34 },
  target: { x: 0, y: 3, z: 0 },
  fov: 46,
}, width, height, { grid: true, gridSize: 28, gridDivisions: 14 });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const bytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([bytes, body])));
  return Buffer.concat([length, bytes, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // truecolour RGB
const raw = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y += 1) {
  raw[y * (width * 3 + 1)] = 0;
  frame.pixels.copy
    ? frame.pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
    : raw.set(frame.pixels.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.resolve(process.argv[2] || 'docs/screenshots/studio-frame.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(JSON.stringify({
  output: out,
  bytes: png.length,
  width,
  height,
  meshes: frame.meshes,
  segments: frame.segments,
  litPixels: frame.visiblePixels,
  traceHash: frame.hash,
}, null, 2));

// Small ASCII proof for terminals without an image viewer.
const chars = ' .:-=+*#%@';
for (let y = 0; y < height; y += 24) {
  let line = '';
  for (let x = 0; x < width; x += 12) {
    const index = (y * width + x) * 3;
    const lum = (frame.pixels[index] + frame.pixels[index + 1] + frame.pixels[index + 2]) / 3;
    line += lum < 20 ? ' ' : chars[Math.min(chars.length - 1, Math.floor(lum / 26))];
  }
  console.log(line);
}
