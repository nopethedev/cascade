// Server-side spreadsheet evaluator, used for CSV export and the read-only
// share page. Mirrors the browser engine in public/editors/sheet.js.

const colName = (i) => {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const colIndex = (letters) => letters.split('').reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

const partsOf = (ref) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: m[1], row: parseInt(m[2], 10) } : null;
};

const nums = (args) => args.flat(Infinity).map(Number).filter((n) => !Number.isNaN(n));
const SUM = (...a) => nums(a).reduce((s, n) => s + n, 0);
const AVERAGE = (...a) => {
  const n = nums(a);
  return n.length ? n.reduce((s, x) => s + x, 0) / n.length : 0;
};
const MIN = (...a) => (nums(a).length ? Math.min(...nums(a)) : 0);
const MAX = (...a) => (nums(a).length ? Math.max(...nums(a)) : 0);
const COUNT = (...a) => nums(a).length;
const PRODUCT = (...a) => (nums(a).length ? nums(a).reduce((s, n) => s * n, 1) : 0);
const ROUND = (n, d = 0) => Math.round(Number(n) * 10 ** d) / 10 ** d;
const ABS = (n) => Math.abs(Number(n));
const IF = (cond, a, b) => (cond ? a : b);
const FUNCS = { SUM, AVERAGE, MIN, MAX, COUNT, PRODUCT, ROUND, ABS, IF };

function rangeRefs(a, b) {
  const pa = partsOf(a);
  const pb = partsOf(b);
  if (!pa || !pb) return [];
  const out = [];
  const c1 = colIndex(pa.col);
  const c2 = colIndex(pb.col);
  for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
    for (let r = Math.min(pa.row, pb.row); r <= Math.max(pa.row, pb.row); r++) out.push(colName(c) + r);
  }
  return out;
}

function evaluate(expr, get) {
  let e = String(expr).trim();
  if (!e) return '';
  e = e.replace(/\b([A-Z]{1,3}\d{1,4}):([A-Z]{1,3}\d{1,4})\b/g, (m, a, b) =>
    rangeRefs(a, b)
      .map((r) => `v_${r}`)
      .join(','),
  );
  e = e.replace(/(?<![\w])([A-Z]{1,3}\d{1,4})(?![\w])/g, (m, r) => `v_${r}`);
  e = e.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
  if (!/^[0-9A-Za-z_+\-*/().,\s%]*$/.test(e)) throw new Error('unsupported characters');
  for (const m of e.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const tok = m[0];
    if (tok in FUNCS) continue;
    if (/^v_[A-Z]{1,3}\d{1,4}$/.test(tok)) continue;
    throw new Error(`unknown name ${tok}`);
  }
  const refs = [...new Set([...e.matchAll(/v_([A-Z]{1,3}\d{1,4})/g)].map((m) => m[1]))];
  // eslint-disable-next-line no-new-func
  const fn = new Function(...refs.map((r) => `v_${r}`), ...Object.keys(FUNCS), `"use strict"; return (${e});`);
  return fn(...refs.map((r) => Number(get(r)) || 0), ...Object.values(FUNCS));
}

/** Returns { A1: computedValue, ... } for one sheet object. */
export function computeSheet(sheet) {
  const cells = (sheet && sheet.cells) || {};
  const cache = new Map();
  const visiting = new Set();

  function value(ref) {
    if (cache.has(ref)) return cache.get(ref);
    if (visiting.has(ref)) return 0;
    const cell = cells[ref];
    if (!cell) return 0;
    visiting.add(ref);
    let out;
    if (cell.f && String(cell.f).startsWith('=')) {
      try {
        out = evaluate(cell.f.slice(1), value);
      } catch {
        out = '#ERR';
      }
    } else {
      out = cell.v ?? '';
    }
    visiting.delete(ref);
    if (typeof out === 'number' && !Number.isFinite(out)) out = '#ERR';
    if (typeof out === 'number') out = Math.round(out * 1e10) / 1e10;
    cache.set(ref, out);
    return out;
  }

  const display = {};
  for (const ref of Object.keys(cells)) display[ref] = value(ref);
  return display;
}
