import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, diffContent, materializeContent } from '../public/editors/collab-merge.mjs';

function merged(base, ...patches) {
  return materializeContent(base, patches.map((ops, i) => ({ id: String(i), ops })));
}

test('concurrent additions to a keyed array are both preserved', () => {
  const base = { elements: [] };
  const alice = { elements: [{ id: 'a', type: 'path', points: [[1, 2]] }] };
  const bob = { elements: [{ id: 'b', type: 'text', text: 'hello' }] };
  const result = merged(base, diffContent(base, alice), diffContent(base, bob));
  assert.deepEqual(result.elements.map((e) => e.id).sort(), ['a', 'b']);
  assert.equal(result.elements.find((e) => e.id === 'a').type, 'path');
  assert.equal(result.elements.find((e) => e.id === 'b').text, 'hello');
});

test('concurrent edits to different fields of one element merge', () => {
  const base = { elements: [{ id: 'a', color: '#000', points: [[0, 0]], width: 2 }] };
  const alice = { elements: [{ id: 'a', color: '#f00', points: [[0, 0]], width: 2 }] };
  const bob = { elements: [{ id: 'a', color: '#000', points: [[0, 0], [4, 4]], width: 5 }] };
  const result = merged(base, diffContent(base, alice), diffContent(base, bob));
  assert.equal(result.elements[0].color, '#f00');
  assert.equal(result.elements[0].width, 5);
  assert.deepEqual(result.elements[0].points, [[0, 0], [4, 4]]);
});

test('deleting an element does not remove a concurrent addition', () => {
  const base = { elements: [{ id: 'a', text: 'old' }] };
  const alice = { elements: [] };
  const bob = { elements: [{ id: 'a', text: 'old' }, { id: 'b', text: 'new' }] };
  const result = merged(base, diffContent(base, alice), diffContent(base, bob));
  assert.deepEqual(result.elements, [{ id: 'b', text: 'new' }]);
});

test('reordering keyed elements keeps the order and does not duplicate items', () => {
  const base = { slides: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  const after = { slides: [{ id: 'c' }, { id: 'a' }, { id: 'b' }] };
  const result = merged(base, diffContent(base, after));
  assert.deepEqual(result.slides.map((s) => s.id), ['c', 'a', 'b']);
});

test('nested object fields are patched without replacing the parent object', () => {
  const base = { settings: { theme: 'dark', grid: 8, nested: { a: 1 } } };
  const after = { settings: { theme: 'light', grid: 8, nested: { a: 1, b: 2 } } };
  const target = structuredClone(base);
  const settings = target.settings;
  applyOps(target, { ops: diffContent(base, after) });
  assert.equal(settings, target.settings);
  assert.equal(settings.theme, 'light');
  assert.equal(settings.nested.b, 2);
});

test('board elements keep their identity while remote points and fields change', () => {
  const base = { elements: [{ id: 'stroke', points: [[0, 0]], color: '#111' }] };
  const target = structuredClone(base);
  const stroke = target.elements[0];
  applyOps(target, { ops: diffContent(base, { elements: [{ id: 'stroke', points: [[0, 0], [9, 9]], color: '#111' }] }) });
  applyOps(target, { ops: diffContent({ elements: [{ id: 'stroke', points: [[0, 0], [9, 9]], color: '#111' }] }, { elements: [{ id: 'stroke', points: [[0, 0], [9, 9]], color: '#0f0' }] }) });
  assert.equal(target.elements[0], stroke);
  assert.deepEqual(stroke.points, [[0, 0], [9, 9]]);
  assert.equal(stroke.color, '#0f0');
});

test('deleting a nested key and an array item is applied', () => {
  const base = { a: { keep: 1, drop: 2 }, items: [{ id: 'x' }, { id: 'y' }] };
  const after = { a: { keep: 1 }, items: [{ id: 'y' }] };
  const result = merged(base, diffContent(base, after));
  assert.deepEqual(result, { a: { keep: 1 }, items: [{ id: 'y' }] });
});
