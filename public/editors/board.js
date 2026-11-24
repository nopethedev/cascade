/* Whiteboard: infinite canvas, pen/rect/ellipse/arrow tools, sticky notes,
   text, eraser, pan + zoom, undo/redo and autosave. */
(function () {
  const DOC = window.__DOC__;
  if (!DOC) return;
  const data = DOC.content && Array.isArray(DOC.content.elements) ? DOC.content : { elements: [], view: { x: 40, y: 40, zoom: 1 } };
  data.view = data.view && typeof data.view.zoom === 'number' ? data.view : { x: 40, y: 40, zoom: 1 };
  try {
    const storedView = JSON.parse(localStorage.getItem(`cascade:board-view:${DOC.id}`) || 'null');
    if (storedView && typeof storedView.zoom === 'number') data.view = storedView;
  } catch { /* private mode */ }
  let viewTimer = null;
  function rememberView() {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      try { localStorage.setItem(`cascade:board-view:${DOC.id}`, JSON.stringify(data.view)); } catch { /* ignore */ }
    }, 250);
  }

  const wrap = document.getElementById('board-wrap');
  const canvas = document.getElementById('board');
  const overlay = document.getElementById('board-overlay');
  const ctx = canvas.getContext('2d');
  const hint = document.getElementById('board-hint');
  const colorInput = document.getElementById('board-color');
  const widthSelect = document.getElementById('board-width');

  let tool = 'select';
  let selected = null;
  let spaceDown = false;
  let action = null;
  const history = [];
  const future = [];

  const uid = () => 'b' + Math.random().toString(36).slice(2, 8);
  const dpr = () => window.devicePixelRatio || 1;
  const view = () => data.view;

  function snapshot() {
    history.push(JSON.stringify({ elements: data.elements }));
    if (history.length > 60) history.shift();
    future.length = 0;
  }
  function undo() {
    if (!history.length) return;
    future.push(JSON.stringify({ elements: data.elements }));
    data.elements = JSON.parse(history.pop()).elements;
    selected = null;
    draw();
    positionStickies();
    ws.schedule();
  }
  function redo() {
    if (!future.length) return;
    history.push(JSON.stringify({ elements: data.elements }));
    data.elements = JSON.parse(future.pop()).elements;
    selected = null;
    draw();
    positionStickies();
    ws.schedule();
  }

  // ---- geometry -----------------------------------------------------------
  function bbox(e) {
    if (e.type === 'path') {
      const xs = e.points.map((p) => p[0]);
      const ys = e.points.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    if (e.type === 'line') return { x: Math.min(e.x1, e.x2), y: Math.min(e.y1, e.y2), w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
    if (e.type === 'text') return { x: e.x, y: e.y, w: e.w || 220, h: e.h || 30 };
    return { x: e.x, y: e.y, w: e.w || 0, h: e.h || 0 };
  }
  function hit(e, x, y) {
    const b = bbox(e);
    return x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6;
  }

  // ---- drawing ------------------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(text, maxWidth) {
    const lines = [];
    for (const paragraph of String(text || '').split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      lines.push(line);
    }
    return lines;
  }

  function drawEl(e) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (e.type === 'path') {
      if (!e.points || !e.points.length) return;
      ctx.strokeStyle = e.color || '#f4f4f5';
      ctx.lineWidth = e.width || 3;
      ctx.beginPath();
      ctx.moveTo(e.points[0][0], e.points[0][1]);
      for (const p of e.points.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    } else if (e.type === 'rect' || e.type === 'sticky') {
      ctx.fillStyle = e.color || '#27272a';
      roundRect(e.x, e.y, e.w, e.h, e.type === 'sticky' ? 4 : 8);
      ctx.fill();
      if (e.type === 'sticky') {
        ctx.fillStyle = '#111827';
        ctx.font = '14px Inter, system-ui, sans-serif';
        const lines = wrapText(e.text || '', Math.max(20, e.w - 20));
        lines.slice(0, Math.floor((e.h - 16) / 19)).forEach((line, i) => ctx.fillText(line, e.x + 10, e.y + 24 + i * 19));
      }
    } else if (e.type === 'ellipse') {
      ctx.fillStyle = e.color || '#27272a';
      ctx.beginPath();
      ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, Math.abs(e.w / 2), Math.abs(e.h / 2), 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === 'line') {
      ctx.strokeStyle = e.color || '#f4f4f5';
      ctx.lineWidth = e.width || 3;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      const angle = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
      const head = 12;
      ctx.beginPath();
      ctx.moveTo(e.x2, e.y2);
      ctx.lineTo(e.x2 - head * Math.cos(angle - Math.PI / 7), e.y2 - head * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(e.x2 - head * Math.cos(angle + Math.PI / 7), e.y2 - head * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fillStyle = e.color || '#f4f4f5';
      ctx.fill();
    } else if (e.type === 'text') {
      ctx.fillStyle = e.color || '#f4f4f5';
      ctx.font = `${e.size || 20}px Inter, system-ui, sans-serif`;
      ctx.fillText(e.text || '', e.x, e.y);
    }
  }

  function draw() {
    const r = wrap.getBoundingClientRect();
    const d = dpr();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);

    // dotted paper grid in screen space
    const spacing = Math.max(18, 32 * view().zoom);
    ctx.fillStyle = 'rgba(255,255,255,0.055)';
    const ox = ((view().x % spacing) + spacing) % spacing;
    const oy = ((view().y % spacing) + spacing) % spacing;
    for (let x = ox; x < r.width; x += spacing) {
      for (let y = oy; y < r.height; y += spacing) ctx.fillRect(x, y, 1.4, 1.4);
    }

    ctx.save();
    ctx.translate(view().x, view().y);
    ctx.scale(view().zoom, view().zoom);
    for (const e of data.elements) drawEl(e);
    if (selected) {
      const el = data.elements.find((e) => e.id === selected);
      if (el) {
        const b = bbox(el);
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = 1.5 / view().zoom;
        ctx.setLineDash([6 / view().zoom, 4 / view().zoom]);
        ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  function positionStickies() {
    // Reuse the existing textareas instead of rebuilding them. A remote update
    // used to replace the overlay and steal focus while someone was typing.
    const existing = new Map([...overlay.querySelectorAll('textarea.board-sticky')].map((ta) => [ta.dataset.id, ta]));
    const seen = new Set();
    for (const e of data.elements) {
      if (e.type !== 'sticky') continue;
      seen.add(String(e.id));
      let ta = existing.get(String(e.id));
      if (!ta) {
        ta = document.createElement('textarea');
        ta.className = 'board-sticky';
        ta.dataset.id = String(e.id);
        ta.placeholder = 'Type…';
        ta.addEventListener('input', () => {
          const live = data.elements.find((item) => String(item.id) === ta.dataset.id);
          if (!live) return;
          live.text = ta.value;
          draw();
          ws.schedule();
        });
        ta.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      }
      if (ta !== document.activeElement) ta.value = e.text || '';
      ta.style.left = `${e.x * view().zoom + view().x}px`;
      ta.style.top = `${e.y * view().zoom + view().y}px`;
      ta.style.width = `${e.w * view().zoom}px`;
      ta.style.height = `${e.h * view().zoom}px`;
      ta.style.background = e.color || '#fde68a';
      ta.style.fontSize = `${Math.max(9, 14 * view().zoom)}px`;
      if (ta !== document.activeElement) overlay.append(ta);
    }
    for (const [id, ta] of existing) if (!seen.has(id)) ta.remove();
  }

  function resize() {
    const r = wrap.getBoundingClientRect();
    const d = dpr();
    canvas.width = Math.max(1, Math.floor(r.width * d));
    canvas.height = Math.max(1, Math.floor(r.height * d));
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    draw();
    positionStickies();
  }

  // ---- interaction --------------------------------------------------------
  const toWorld = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left - view().x) / view().zoom, y: (ev.clientY - r.top - view().y) / view().zoom };
  };

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    const factor = ev.deltaY < 0 ? 1.12 : 0.89;
    const next = Math.min(4, Math.max(0.2, view().zoom * factor));
    view().x = mx - ((mx - view().x) / view().zoom) * next;
    view().y = my - ((my - view().y) / view().zoom) * next;
    view().zoom = next;
    rememberView();
    draw();
    positionStickies();
  }, { passive: false });

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    const p = toWorld(ev);
    if (ev.button === 1 || spaceDown || tool === 'pan') {
      action = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view().x, vy: view().y };
      return;
    }
    if (tool === 'select') {
      const found = [...data.elements].reverse().find((e) => hit(e, p.x, p.y));
      selected = found ? found.id : null;
      if (found) {
        snapshot();
        action = { mode: 'move', el: found, sx: p.x, sy: p.y, ex: found.x || 0, ey: found.y || 0 };
      }
      draw();
      return;
    }
    if (tool === 'eraser') {
      const found = [...data.elements].reverse().find((e) => hit(e, p.x, p.y));
      if (found) {
        snapshot();
        data.elements = data.elements.filter((e) => e.id !== found.id);
        draw();
        positionStickies();
        ws.schedule();
      }
      return;
    }
    if (tool === 'sticky') {
      snapshot();
      const el = { id: uid(), type: 'sticky', x: p.x - 90, y: p.y - 70, w: 180, h: 140, text: '', color: '#fde68a' };
      data.elements.push(el);
      selected = el.id;
      draw();
      positionStickies();
      overlay.querySelector('textarea:last-of-type')?.focus();
      ws.schedule();
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Text', '');
      if (!text) return;
      snapshot();
      data.elements.push({ id: uid(), type: 'text', x: p.x, y: p.y, w: 240, h: 30, text, color: colorInput.value, size: 22 });
      draw();
      ws.schedule();
      return;
    }

    snapshot();
    if (tool === 'pen') {
      action = { mode: 'draw', el: { id: uid(), type: 'path', points: [[p.x, p.y]], color: colorInput.value, width: Number(widthSelect.value) } };
    } else if (tool === 'rect' || tool === 'ellipse') {
      action = { mode: 'draw', el: { id: uid(), type: tool, x: p.x, y: p.y, w: 0, h: 0, color: colorInput.value } };
    } else if (tool === 'arrow') {
      action = { mode: 'draw', el: { id: uid(), type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: colorInput.value, width: Number(widthSelect.value) } };
    }
    if (action) {
      data.elements.push(action.el);
      // Publish the new element immediately. If a collaborator edits before
      // this stroke finishes, the shared patch log already contains it and the
      // remote merge can keep the same object alive.
      ws.schedule();
    }
    draw();
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!action) return;
    if (action.mode === 'pan') {
      view().x = action.vx + (ev.clientX - action.sx);
      view().y = action.vy + (ev.clientY - action.sy);
      rememberView();
      draw();
      positionStickies();
      return;
    }
    const p = toWorld(ev);
    if (action.mode === 'move') {
      action.el.x = action.ex + (p.x - action.sx);
      action.el.y = action.ey + (p.y - action.sy);
      draw();
      positionStickies();
      return;
    }
    if (action.mode === 'draw') {
      const el = action.el;
      if (el.type === 'path') el.points.push([p.x, p.y]);
      else if (el.type === 'line') {
        el.x2 = p.x;
        el.y2 = p.y;
      } else {
        el.w = p.x - el.x;
        el.h = p.y - el.y;
      }
      draw();
    }
  });

  const finish = () => {
    if (!action) return;
    const mode = action.mode;
    action = null;
    if (mode !== 'pan') ws.schedule();
    draw();
    positionStickies();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointerleave', () => {
    if (action && action.mode !== 'pan') finish();
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'Space' && !ev.target.matches('input, textarea')) {
      spaceDown = true;
      ev.preventDefault();
    }
    if (ev.target.matches('input, textarea') || ev.metaKey || ev.ctrlKey) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected) {
      ev.preventDefault();
      snapshot();
      data.elements = data.elements.filter((e) => e.id !== selected);
      selected = null;
      draw();
      positionStickies();
      ws.schedule();
    }
    const map = { v: 'select', p: 'pen', r: 'rect', o: 'ellipse', a: 'arrow', s: 'sticky', t: 'text', e: 'eraser', h: 'pan' };
    if (map[ev.key.toLowerCase()]) setTool(map[ev.key.toLowerCase()]);
  });
  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space') spaceDown = false;
  });

  function setTool(next) {
    tool = next;
    document.querySelectorAll('#board-tools .tool').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === next));
    canvas.style.cursor = next === 'pan' ? 'grab' : next === 'select' ? 'default' : 'crosshair';
    hint.textContent =
      next === 'pen' ? 'Drag to draw · wheel to zoom'
        : next === 'sticky' ? 'Click to drop a sticky note'
          : next === 'select' ? 'Click an element to move it'
            : next === 'eraser' ? 'Click an element to remove it'
              : 'Wheel to zoom · space or middle-drag to pan';
  }

  document.querySelectorAll('#board-tools .tool').forEach((btn) => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });
  document.getElementById('board-undo').addEventListener('click', undo);
  document.getElementById('board-redo').addEventListener('click', redo);
  document.getElementById('board-zoom-in').addEventListener('click', () => {
    view().zoom = Math.min(4, view().zoom * 1.2);
    rememberView();
    draw();
    positionStickies();
  });
  document.getElementById('board-zoom-out').addEventListener('click', () => {
    view().zoom = Math.max(0.2, view().zoom / 1.2);
    rememberView();
    draw();
    positionStickies();
  });
  document.getElementById('board-reset').addEventListener('click', () => {
    if (!data.elements.length) {
      data.view = { x: 40, y: 40, zoom: 1 };
    } else {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const e of data.elements) {
        const b = bbox(e);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      const r = wrap.getBoundingClientRect();
      const zoom = Math.min(2, Math.max(0.2, Math.min(r.width / (maxX - minX + 120), r.height / (maxY - minY + 120))));
      data.view = { x: 60 - minX * zoom, y: 60 - minY * zoom, zoom };
    }
    rememberView();
    draw();
    positionStickies();
    ws.schedule();
  });

  // ---- shared runtime -----------------------------------------------------
  const ws = window.Workspace.create({
    id: DOC.id,
    kind: 'board',
    version: DOC.version,
    content: { elements: data.elements },
    isPublic: DOC.isPublic,
    filename: DOC.filename,
    apply(content) {
      if (!content || !Array.isArray(content.elements)) return;
      // Merge by stable element id and reuse existing objects. A remote update
      // must never replace the array underneath an in-progress stroke or drag.
      const existing = new Map(data.elements.map((element) => [String(element.id), element]));
      const activeId = action?.el ? String(action.el.id) : null;
      const editing = document.activeElement?.classList?.contains('board-sticky') ? document.activeElement.dataset.id : null;
      data.elements = content.elements.map((element) => {
        const id = String(element.id);
        const previous = existing.get(id);
        if (!previous) return element;
        // Never overwrite the item that is being drawn, moved or typed into.
        // The remote snapshot was taken before those local points/text existed.
        if (id === activeId || id === editing) return previous;
        for (const key of Object.keys(previous)) if (!(key in element)) delete previous[key];
        Object.assign(previous, element);
        return previous;
      });
      if (action?.el && !data.elements.some((element) => String(element.id) === activeId)) {
        data.elements.push(action.el);
      }
      if (selected && !data.elements.some((element) => element.id === selected)) selected = null;
      draw();
      positionStickies();
    },
    collect() {
      // Pan/zoom is a personal view preference, not document data. Sharing it
      // made one collaborator's wheel gesture yank everyone else's canvas.
      return { elements: data.elements };
    },
  });

  window.addEventListener('resize', resize);
  resize();
  setTool('select');
})();
