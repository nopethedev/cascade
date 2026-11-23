import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/photo/psd.js';
import { photoToSvg } from '../src/photo.js';

const PSD = globalThis.CascadePSD;

function rgbPsd({ width = 2, height = 2, channels = 3, alpha = false } = {}) {
  const pixels = width * height;
  const buffer = Buffer.alloc(26 + 12 + 2 + pixels * channels);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  buffer.set([56, 66, 80, 83], 0);
  view.setUint16(4, 1);
  view.setUint16(12, channels);
  view.setUint32(14, height);
  view.setUint32(18, width);
  view.setUint16(22, 8);
  view.setUint16(24, 3);
  let offset = 26;
  view.setUint32(offset, 0); offset += 4;
  view.setUint32(offset, 0); offset += 4;
  view.setUint32(offset, 0); offset += 4;
  view.setUint16(offset, 0); offset += 2;
  const red = [255, 0, 0, 0];
  const green = [0, 0, 0, 0];
  const blue = [0, 0, 255, 0];
  const opacity = alpha ? [255, 255, 255, 255] : [];
  for (const plane of [red, green, blue, ...(alpha ? [opacity] : [])]) {
    buffer.set(plane.slice(0, pixels), offset);
    offset += pixels;
  }
  return buffer;
}

test('PSD parser reads an 8-bit RGB composite', () => {
  const result = PSD.parse(rgbPsd());
  assert.equal(result.width, 2);
  assert.equal(result.height, 2);
  assert.deepEqual([...result.data.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...result.data.slice(8, 12)], [0, 0, 255, 255]);
});

test('PSD parser carries the alpha channel through', () => {
  const result = PSD.parse(rgbPsd({ channels: 4, alpha: true }));
  assert.equal(result.data[3], 255);
  assert.equal(result.data[7], 255);
});

test('PSD parser rejects malformed and unsupported files', () => {
  assert.throws(() => PSD.parse(new Uint8Array([1, 2, 3])), /PSD/);
  assert.equal(PSD.isPsd(new Uint8Array([56, 66, 80, 83, 0, 1])), true);
});

test('Photo SVG export keeps vector layers and embeds raster data', () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const svg = photoToSvg({ filename: 'poster.cascade' }, {
    w: 800,
    h: 600,
    background: '#0b1220',
    layers: [
      { id: 'a', type: 'raster', name: 'Photo', src: tinyPng, x: 0, y: 0, w: 800, h: 600, visible: true, opacity: 1 },
      { id: 'b', type: 'rect', name: 'Panel', x: 20, y: 30, w: 200, h: 100, fill: '#38bdf8', radius: 12, visible: true, opacity: 0.9 },
      { id: 'c', type: 'text', name: 'Title', x: 40, y: 60, w: 400, h: 80, text: 'Hello <world>', color: '#ffffff', size: 48, align: 'left', visible: true, opacity: 1 },
    ],
  });
  assert.match(svg, /^<svg/);
  assert.match(svg, /width="800"/);
  assert.match(svg, /data:image\/png;base64/);
  assert.match(svg, /fill="#38bdf8"/);
  assert.match(svg, /Hello &lt;world&gt;/);
});
