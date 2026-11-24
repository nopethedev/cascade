/* Incremental collaboration for Cascade editors.
 *
 * The editors persist plain JSON objects, not Yjs-native trees. Sending the
 * whole object on every edit made concurrent work last-write-wins: one person
 * could erase a drawing that another person had just made. The helpers here
 * turn a local snapshot into an ordered set of small JSON operations. The
 * operations travel through a Yjs array (so concurrent writers never replace
 * each other's work) and are applied to a shared base document.
 *
 * Arrays of objects with stable `id` values are merged per item. That is the
 * important case for boards, decks, slides, websites and other editors where
 * two people commonly create or edit different items at the same time.
 */

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through to JSON cloning */
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!equal(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const key of ak) if (!hasOwn(b, key) || !equal(a[key], b[key])) return false;
  return true;
}

const idOf = (item) => (isPlainObject(item) && item.id !== undefined && item.id !== null ? String(item.id) : null);

function keyedArray(value) {
  if (!Array.isArray(value) || !value.length) return true;
  const seen = new Set();
  for (const item of value) {
    const id = idOf(item);
    if (!id || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function allPrimitive(value) {
  return value.every((item) => item === null || typeof item !== 'object');
}

function diffObject(before, after, path, ops) {
  for (const key of Object.keys(before)) {
    if (!hasOwn(after, key)) ops.push({ o: 'del', p: [...path, key] });
  }
  for (const key of Object.keys(after)) {
    if (!hasOwn(before, key)) {
      ops.push({ o: 'set', p: [...path, key], v: clone(after[key]) });
      continue;
    }
    diffValue(before[key], after[key], [...path, key], ops);
  }
}

function diffKeyedArray(before, after, path, ops) {
  const beforeById = new Map(before.map((item) => [idOf(item), item]));
  const afterIds = new Set(after.map((item) => idOf(item)));
  for (const item of before) {
    if (!afterIds.has(idOf(item))) ops.push({ o: 'delId', p: path, id: idOf(item) });
  }
  after.forEach((item, index) => {
    const id = idOf(item);
    const previous = beforeById.get(id);
    if (previous === undefined) {
      ops.push({ o: 'ins', p: path, i: index, v: clone(item) });
    } else {
      diffValue(previous, item, [...path, { id }], ops);
    }
  });
  // Only record an order change when existing items actually move. A new
  // item's index is not a reorder: two people appending at the same time must
  // not push each other's additions around.
  const beforeOrder = before.filter((item) => afterIds.has(idOf(item))).map(idOf);
  const afterOrder = after.filter((item) => beforeById.has(idOf(item))).map(idOf);
  if (beforeOrder.length !== afterOrder.length || beforeOrder.some((id, i) => id !== afterOrder[i])) {
    ops.push({ o: 'ord', p: path, ids: after.map(idOf) });
  }
}

function diffIndexedArray(before, after, path, ops) {
  const common = Math.min(before.length, after.length);
  for (let i = 0; i < common; i += 1) diffValue(before[i], after[i], [...path, i], ops);
  for (let i = before.length - 1; i >= after.length; i -= 1) ops.push({ o: 'delAt', p: path, i });
  for (let i = common; i < after.length; i += 1) ops.push({ o: 'ins', p: path, i, v: clone(after[i]) });
}

function diffValue(before, after, path, ops) {
  if (equal(before, after)) return;
  if (isPlainObject(before) && isPlainObject(after)) {
    diffObject(before, after, path, ops);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (keyedArray(before) && keyedArray(after)) {
      diffKeyedArray(before, after, path, ops);
      return;
    }
    const objects = [...before, ...after].every((item) => item && typeof item === 'object');
    if (objects && before.length <= 1200 && after.length <= 1200) {
      diffIndexedArray(before, after, path, ops);
      return;
    }
  }
  if (Array.isArray(after) && allPrimitive(after)) {
    ops.push({ o: 'set', p: path, v: clone(after) });
    return;
  }
  ops.push({ o: 'set', p: path, v: clone(after) });
}

/** Return the operations needed to turn `before` into `after`. */
export function diffContent(before, after) {
  const ops = [];
  diffValue(before ?? {}, after ?? {}, [], ops);
  return ops;
}

function resolve(node, path) {
  let current = node;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (isPlainObject(segment) && hasOwn(segment, 'id')) {
      if (!Array.isArray(current)) return undefined;
      current = current.find((item) => idOf(item) === String(segment.id));
    } else {
      current = current[segment];
    }
  }
  return current;
}

function applyOp(root, op) {
  if (!op || typeof op !== 'object' || !Array.isArray(op.p)) return root;
  if (!op.p.length) return op.o === 'set' ? clone(op.v) : root;

  // Array operations point at the array itself. Field operations point at the
  // containing object/array and use the last path segment as the key.
  if (op.o === 'delAt' || op.o === 'delId' || op.o === 'ins' || op.o === 'ord') {
    const array = resolve(root, op.p);
    if (!Array.isArray(array)) return root;
    if (op.o === 'delAt') {
      array.splice(Math.max(0, Number(op.i) || 0), 1);
    } else if (op.o === 'delId') {
      const index = array.findIndex((item) => idOf(item) === String(op.id));
      if (index >= 0) array.splice(index, 1);
    } else if (op.o === 'ins') {
      const index = Math.max(0, Math.min(array.length, Number(op.i) || 0));
      array.splice(index, 0, clone(op.v));
    } else if (Array.isArray(op.ids)) {
      const rank = new Map(op.ids.map((id, index) => [String(id), index]));
      const listed = array
        .filter((item) => rank.has(idOf(item)))
        .sort((a, b) => rank.get(idOf(a)) - rank.get(idOf(b)));
      const unlisted = array.filter((item) => !rank.has(idOf(item)));
      array.splice(0, array.length, ...listed, ...unlisted);
    }
    return root;
  }

  const parent = resolve(root, op.p.slice(0, -1));
  const key = op.p[op.p.length - 1];
  if (parent === null || parent === undefined) return root;
  if (op.o === 'set') {
    parent[key] = clone(op.v);
  } else if (op.o === 'del') {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  }
  return root;
}

/** Apply a patch object, an array of operations, or a list of patch objects. */
export function applyOps(target, patches) {
  let root = target;
  const list = Array.isArray(patches) ? patches : [patches];
  for (const patch of list) {
    if (!patch) continue;
    if (Array.isArray(patch.ops)) {
      for (const op of patch.ops) root = applyOp(root, op);
    } else if (Array.isArray(patch)) {
      for (const op of patch) root = applyOp(root, op);
    } else {
      root = applyOp(root, patch);
    }
  }
  return root;
}

/** Materialize the authoritative JSON from a base snapshot and Yjs patch log. */
export function materializeContent(base, patches = []) {
  return applyOps(clone(base && typeof base === 'object' ? base : {}), patches);
}

export const COLLAB_PATCH_VERSION = 1;
