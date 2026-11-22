/* Spreadsheet editor: grid, formula engine with dependency memoisation,
   formatting, multiple sheets, sorting and column filtering. */
(function () {
  const DOC = window.__DOC__;
  if (!DOC) return;
  const data =
    DOC.content && Array.isArray(DOC.content.sheets) && DOC.content.sheets.length
      ? DOC.content
      : { sheets: [{ name: 'Sheet1', rows: 32, cols: 12, cells: {} }], active: 0 };

  const grid = document.getElementById('sheet-grid');
  const tabsEl = document.getElementById('sheet-tabs');
  const formula = document.getElementById('formula-input');
  const refLabel = document.getElementById('cell-ref');
  const filterInput = document.getElementById('sheet-filter');
  const imageBar = document.getElementById('sheet-images');
  let selected = 'A1';

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
  const sheet = () => data.sheets[data.active] || data.sheets[0];
  const cells = () => sheet().cells;
  const ensure = (ref) => (sheet().cells[ref] = sheet().cells[ref] || {});

  // ---- formula engine -----------------------------------------------------
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
    const r1 = pa.row;
    const r2 = pb.row;
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) out.push(colName(c) + r);
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
    const names = refs.map((r) => `v_${r}`);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, ...Object.keys(FUNCS), `"use strict"; return (${e});`);
    return fn(...refs.map((r) => Number(get(r)) || 0), ...Object.values(FUNCS));
  }

  function computeAll(sh) {
    const cache = new Map();
    const visiting = new Set();
    function value(ref) {
      if (cache.has(ref)) return cache.get(ref);
      if (visiting.has(ref)) return 0;
      const cell = (sh.cells || {})[ref];
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
    for (const ref of Object.keys(sh.cells || {})) display[ref] = value(ref);
    return display;
  }

  // ---- rendering ----------------------------------------------------------
  function cellRaw(ref) {
    const c = sheet().cells[ref] || {};
    return c.f || c.v || '';
  }

  function setRaw(ref, raw) {
    const sh = sheet();
    const cell = ensure(ref);
    const val = String(raw);
    if (val.startsWith('=')) {
      cell.f = val;
      delete cell.v;
    } else {
      cell.v = val;
      delete cell.f;
    }
    if (!cell.v && !cell.f) delete sh.cells[ref];
    ws.schedule();
  }

  function select(ref) {
    selected = ref;
    render();
  }

  function startEdit(ref, initial) {
    const td = grid.querySelector(`td[data-ref="${ref}"]`);
    if (!td) return;
    const raw = initial !== undefined ? initial : cellRaw(ref);
    td.textContent = '';
    const input = document.createElement('input');
    input.className = 'cell-input';
    input.value = raw;
    td.append(input);
    let done = false;
    const commit = (move) => {
      if (done) return;
      done = true;
      setRaw(ref, input.value);
      render();
      if (move) {
        const p = partsOf(ref);
        if (p) select(p.col + Math.min(sheet().rows, p.row + 1));
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        done = true;
        render();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const p = partsOf(ref);
        commit(false);
        if (p) select(colName(Math.min(sheet().cols - 1, colIndex(p.col) + 1)) + p.row);
      }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => commit(false));
    input.focus();
    input.select();
  }

  function applyFilter() {
    const q = (filterInput.value || '').trim().toLowerCase();
    const p = partsOf(selected);
    if (!p) return;
    const disp = computeAll(sheet());
    grid.querySelectorAll('tbody tr').forEach((tr, idx) => {
      const ref = p.col + (idx + 1);
      const val = String(disp[ref] ?? '').toLowerCase();
      tr.classList.toggle('is-hidden', !!q && !val.includes(q));
    });
  }

  function updateFormulaBar() {
    refLabel.textContent = selected;
    formula.value = cellRaw(selected);
    const cell = sheet().cells[selected] || {};
    document.getElementById('sheet-align').value = cell.align || 'left';
  }

  function renderTabs() {
    tabsEl.textContent = '';
    data.sheets.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheet-tab' + (i === data.active ? ' is-active' : '');
      btn.textContent = s.name;
      btn.title = 'Double-click to rename';
      btn.addEventListener('click', () => {
        data.active = i;
        render();
      });
      btn.addEventListener('dblclick', () => {
        const name = window.prompt('Sheet name', s.name);
        if (!name) return;
        s.name = name.slice(0, 40);
        render();
        ws.schedule();
      });
      if (data.sheets.length > 1) {
        const x = document.createElement('span');
        x.className = 'sheet-tab-x';
        x.textContent = '×';
        x.title = 'Delete sheet';
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!window.confirm(`Delete sheet “${s.name}”?`)) return;
          data.sheets.splice(i, 1);
          data.active = 0;
          render();
          ws.schedule();
        });
        btn.append(x);
      }
      tabsEl.append(btn);
    });
  }

  function renderImages() {
    if (!imageBar) return;
    const list = Array.isArray(sheet().images) ? sheet().images : [];
    imageBar.textContent = '';
    imageBar.hidden = list.length === 0;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const card = document.createElement('div');
      card.className = 'sheet-image-card';
      const thumb = document.createElement('img');
      thumb.src = entry.src || '';
      thumb.alt = entry.alt || 'Sheet image';
      thumb.title = entry.credit || entry.alt || '';
      const meta = document.createElement('div');
      meta.className = 'sheet-image-meta';
      const name = document.createElement('strong');
      name.textContent = entry.alt || `Image ${i + 1}`;
      const credit = document.createElement('span');
      credit.textContent = entry.credit || 'Your image';
      meta.append(name, credit);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sheet-image-remove';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        list.splice(i, 1);
        render();
        ws.schedule();
      });
      card.append(thumb, meta, remove);
      imageBar.append(card);
    }
  }

  function render() {
    const sh = sheet();
    const disp = computeAll(sh);
    const table = document.createElement('table');
    table.className = 'sheet-table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'corner';
    hr.append(corner);
    for (let c = 0; c < sh.cols; c++) {
      const th = document.createElement('th');
      th.textContent = colName(c);
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead);

    const tbody = document.createElement('tbody');
    for (let r = 1; r <= sh.rows; r++) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.className = 'row-head';
      th.textContent = r;
      tr.append(th);
      for (let c = 0; c < sh.cols; c++) {
        const ref = colName(c) + r;
        const cell = sh.cells[ref] || {};
        const td = document.createElement('td');
        td.dataset.ref = ref;
        td.className = 'sheet-cell' + (ref === selected ? ' is-selected' : '');
        const raw = disp[ref] ?? '';
        td.textContent = typeof raw === 'number' ? String(raw) : raw;
        if (cell.b) td.style.fontWeight = '700';
        if (cell.i) td.style.fontStyle = 'italic';
        if (cell.align) td.style.textAlign = cell.align;
        if (cell.bg) td.style.background = cell.bg;
        if (cell.color) td.style.color = cell.color;
        if (typeof raw === 'string' && raw.startsWith('#')) td.classList.add('cell-error');
        td.addEventListener('mousedown', () => select(ref));
        td.addEventListener('dblclick', () => startEdit(ref));
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    grid.textContent = '';
    grid.append(table);
    updateFormulaBar();
    renderTabs();
    applyFilter();
    renderImages();
  }

  // ---- shared runtime -----------------------------------------------------
  const ws = window.Workspace.create({
    id: DOC.id,
    kind: 'sheet',
    version: DOC.version,
    content: data,
    isPublic: DOC.isPublic,
    filename: DOC.filename,
    apply(content) {
      if (content && Array.isArray(content.sheets) && content.sheets.length) {
        data.sheets = content.sheets;
        data.active = content.active || 0;
      }
      render();
    },
    collect() {
      return { sheets: data.sheets, active: data.active };
    },
  });

  // ---- toolbar ------------------------------------------------------------
  const style = (patch) => {
    Object.assign(ensure(selected), patch);
    render();
    ws.schedule();
  };
  document.getElementById('sheet-bold').addEventListener('click', () => {
    const c = sheet().cells[selected] || {};
    style({ b: !c.b });
  });
  document.getElementById('sheet-italic').addEventListener('click', () => {
    const c = sheet().cells[selected] || {};
    style({ i: !c.i });
  });
  document.getElementById('sheet-align').addEventListener('change', (e) => style({ align: e.target.value }));
  document.getElementById('sheet-fill').addEventListener('input', (e) => style({ bg: e.target.value }));
  document.getElementById('sheet-color').addEventListener('input', (e) => style({ color: e.target.value }));

  document.getElementById('add-row').addEventListener('click', () => {
    sheet().rows = Math.min(500, sheet().rows + 5);
    render();
    ws.schedule();
  });
  document.getElementById('add-col').addEventListener('click', () => {
    sheet().cols = Math.min(40, sheet().cols + 2);
    render();
    ws.schedule();
  });

  document.getElementById('add-sheet-image').addEventListener('click', () => {
    window.CascadeImages?.open({
      onPick({ src, alt, credit }) {
        const p = partsOf(selected);
        const list = Array.isArray(sheet().images) ? sheet().images : (sheet().images = []);
        list.push({
          id: 'img' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          src,
          alt: alt || 'Image',
          credit: credit || '',
          col: p ? colIndex(p.col) : 0,
          row: Math.max(0, (p ? p.row - 1 : 0) + list.length * 8),
          w: 240,
          h: 160,
        });
        render();
        ws.schedule();
      },
    });
  });

  function sortBy(dir) {
    const p = partsOf(selected);
    if (!p) return;
    const sh = sheet();
    const disp = computeAll(sh);
    const order = [];
    for (let r = 2; r <= sh.rows; r++) order.push(r);
    order.sort((a, b) => {
      const va = disp[p.col + a];
      const vb = disp[p.col + b];
      const na = Number(va);
      const nb = Number(vb);
      let cmp;
      if (va !== '' && vb !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) cmp = na - nb;
      else cmp = String(va ?? '').localeCompare(String(vb ?? ''));
      return dir === 'asc' ? cmp : -cmp;
    });
    const snapshot = order.map((r) => {
      const row = {};
      for (let c = 0; c < sh.cols; c++) {
        const ref = colName(c) + r;
        if (sh.cells[ref]) row[colName(c)] = JSON.parse(JSON.stringify(sh.cells[ref]));
      }
      return row;
    });
    for (let r = 2; r <= sh.rows; r++) for (let c = 0; c < sh.cols; c++) delete sh.cells[colName(c) + r];
    order.forEach((targetRow, i) => {
      for (let c = 0; c < sh.cols; c++) {
        const key = colName(c);
        if (snapshot[i][key]) sh.cells[key + targetRow] = snapshot[i][key];
      }
    });
    render();
    ws.schedule();
  }
  document.getElementById('sort-asc').addEventListener('click', () => sortBy('asc'));
  document.getElementById('sort-desc').addEventListener('click', () => sortBy('desc'));
  filterInput.addEventListener('input', applyFilter);

  document.getElementById('add-sheet').addEventListener('click', () => {
    const base = 'Sheet';
    let n = data.sheets.length + 1;
    while (data.sheets.some((s) => s.name === base + n)) n += 1;
    data.sheets.push({ name: base + n, rows: 32, cols: 12, cells: {} });
    data.active = data.sheets.length - 1;
    render();
    ws.schedule();
  });

  formula.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setRaw(selected, formula.value);
      render();
      const p = partsOf(selected);
      if (p) select(p.col + Math.min(sheet().rows, p.row + 1));
      grid.focus();
    }
    e.stopPropagation();
  });
  formula.addEventListener('focus', () => formula.select());

  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      startEdit(selected);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      setRaw(selected, '');
      render();
    } else if (e.key.length === 1) {
      e.preventDefault();
      startEdit(selected, e.key);
    }
  });

  render();
})();
