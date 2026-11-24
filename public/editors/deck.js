/* Slide editor: visual canvas, snapping, layer/align tools, real thumbnails,
   transitions, per-element animation timelines and a presenter with builds. */
(function () {
  const DOC = window.__DOC__;
  if (!DOC) return;
  const blank = () => ({ w: 1280, h: 720, slides: [{ id: 's1', bg: '#101014', notes: '', elements: [] }] });
  const data = DOC.content && Array.isArray(DOC.content.slides) && DOC.content.slides.length ? DOC.content : blank();
  data.w = Number(data.w) || 1280;
  data.h = Number(data.h) || 720;
  const canEdit = DOC.canEdit !== false && window.__ACCESS__?.canEdit !== false;

  const stage = document.getElementById('stage');
  const stageWrap = document.getElementById('stage-wrap');
  const slideList = document.getElementById('slide-list');
  const mobileSlides = document.getElementById('deck-mobile-slides');
  const propsBody = document.getElementById('props-body');
  const slideLabel = document.getElementById('deck-slide-label');
  const slideLabelMobile = document.getElementById('deck-slide-label-mobile');
  const slideCount = document.getElementById('deck-slide-count');
  const inspector = document.getElementById('deck-props');
  const inspectorToggle = document.getElementById('deck-inspector-toggle');
  const zoomLabel = document.getElementById('deck-zoom-label');

  let index = 0;
  let selected = null;
  let zoom = 1;
  let fitScale = 0.7;
  const history = [];
  const future = [];
  let guideX = null;
  let guideY = null;

  const uid = (prefix = 'e') => prefix + Math.random().toString(36).slice(2, 9);
  const slide = () => data.slides[index];
  const current = () => (slide().elements || []).find((e) => e.id === selected) || null;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));

  const TRANSITIONS = {
    none: 'None', fade: 'Fade', push: 'Push', wipe: 'Wipe', zoom: 'Zoom', dissolve: 'Dissolve',
  };
  const ANIMATIONS = {
    none: 'None', fade: 'Fade in', 'fly-up': 'Fly up', 'fly-left': 'Fly from left',
    'fly-right': 'Fly from right', zoom: 'Zoom in', grow: 'Grow', wipe: 'Wipe in', drop: 'Drop in',
  };
  const EASINGS = { ease: 'Ease', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in / out', linear: 'Linear' };

  function transitionOf(s) {
    const raw = s?.transition;
    if (raw && typeof raw === 'object') {
      return {
        type: TRANSITIONS[raw.type] ? raw.type : 'fade',
        duration: clamp(raw.duration || 550, 150, 2500),
        easing: EASINGS[raw.easing] ? raw.easing : 'ease',
      };
    }
    return {
      type: TRANSITIONS[String(raw || 'fade')] ? String(raw) : 'fade',
      duration: 550,
      easing: 'ease',
    };
  }

  function animationOf(e) {
    const raw = e?.animation;
    if (!raw || raw === 'none') return { type: 'none', trigger: 'after', delay: 0, duration: 500, easing: 'ease' };
    if (typeof raw === 'string') {
      return { type: ANIMATIONS[raw] ? raw : 'fade', trigger: 'after', delay: 0, duration: 500, easing: 'ease' };
    }
    return {
      type: ANIMATIONS[raw.type] ? raw.type : 'fade',
      trigger: ['with', 'click'].includes(raw.trigger) ? raw.trigger : 'after',
      delay: clamp(raw.delay || 0, 0, 5000),
      duration: clamp(raw.duration || 500, 100, 3000),
      easing: EASINGS[raw.easing] ? raw.easing : 'ease',
    };
  }

  function snapshot() {
    if (!canEdit) return;
    history.push(JSON.stringify({ w: data.w, h: data.h, slides: data.slides }));
    if (history.length > 80) history.shift();
    future.length = 0;
  }

  function commit(opts = {}) {
    if (!canEdit) return;
    if (opts.stage !== false) renderStage();
    if (opts.thumbs !== false) renderThumbs();
    window.Workspace?.schedule?.();
  }

  function undo() {
    if (!canEdit || !history.length) return;
    future.push(JSON.stringify({ w: data.w, h: data.h, slides: data.slides }));
    const prev = JSON.parse(history.pop());
    data.slides = prev.slides;
    data.w = prev.w || data.w;
    data.h = prev.h || data.h;
    index = Math.min(index, data.slides.length - 1);
    selected = null;
    render();
    window.Workspace?.schedule?.();
  }

  function redo() {
    if (!canEdit || !future.length) return;
    history.push(JSON.stringify({ w: data.w, h: data.h, slides: data.slides }));
    const next = JSON.parse(future.pop());
    data.slides = next.slides;
    data.w = next.w || data.w;
    data.h = next.h || data.h;
    selected = null;
    render();
    window.Workspace?.schedule?.();
  }

  function fitScaleNow() {
    const availW = Math.max(200, (stageWrap?.clientWidth || 900) - 44);
    const availH = Math.max(150, (stageWrap?.clientHeight || 500) - 38);
    // On phones the stage is a short 16:9 strip; fitting by width keeps the
    // slide readable instead of shrinking it to a postage stamp by height.
    fitScale = window.matchMedia('(max-width: 760px)').matches
      ? availW / data.w
      : Math.min(availW / data.w, availH / data.h);
    stageWrap?.style.setProperty('--deck-aspect', String(data.w / data.h));
  }
  const scaleOf = () => Math.max(0.08, fitScale * zoom);

  // ---------------- element rendering ----------------
  function styleBox(node, e) {
    node.style.left = `${Number(e.x) || 0}px`;
    node.style.top = `${Number(e.y) || 0}px`;
    node.style.width = `${Math.max(1, Number(e.w) || 1)}px`;
    node.style.height = `${Math.max(1, Number(e.h) || 1)}px`;
    node.style.opacity = String(clamp(e.opacity ?? 100, 0, 100) / 100);
    node.style.transform = e.rotation ? `rotate(${Number(e.rotation) || 0}deg)` : '';
  }

  function fillElement(node, e) {
    if (e.type === 'text') {
      node.textContent = e.text || '';
      node.style.color = e.color || '#f4f4f5';
      node.style.fontSize = `${Math.max(6, Number(e.size) || 28)}px`;
      node.style.fontFamily = e.fontFamily || '';
      node.style.fontWeight = e.bold ? '700' : '400';
      node.style.fontStyle = e.italic ? 'italic' : 'normal';
      node.style.textDecoration = e.underline ? 'underline' : 'none';
      node.style.textAlign = ['left', 'center', 'right'].includes(e.align) ? e.align : 'left';
      node.style.lineHeight = String(clamp(e.lineHeight || 120, 60, 240) / 100);
      node.style.letterSpacing = `${Number(e.letterSpacing) || 0}px`;
      node.style.whiteSpace = 'pre-wrap';
      node.style.display = 'flex';
      node.style.flexDirection = 'column';
      node.style.justifyContent = e.valign === 'middle' ? 'center' : e.valign === 'bottom' ? 'flex-end' : 'flex-start';
      node.style.overflow = 'hidden';
    } else if (e.type === 'rect' || e.type === 'ellipse') {
      node.style.background = e.fill || '#e11d48';
      node.style.borderRadius = e.type === 'ellipse' ? '50%' : `${Math.max(0, Number(e.radius) || 0)}px`;
      node.style.border = Number(e.borderWidth) > 0 ? `${Number(e.borderWidth)}px solid ${e.borderColor || '#ffffff'}` : '';
    } else if (e.type === 'line') {
      node.style.background = e.fill || '#e11d48';
      node.style.borderRadius = '99px';
    } else if (e.type === 'image') {
      const img = document.createElement('img');
      img.src = e.src;
      img.alt = e.alt || '';
      img.title = e.credit || '';
      img.draggable = false;
      img.style.objectFit = ['contain', 'fill'].includes(e.fit) ? e.fit : 'cover';
      node.append(img);
      node.style.overflow = 'hidden';
      node.style.borderRadius = `${Math.max(0, Number(e.radius) || 0)}px`;
      node.style.border = Number(e.borderWidth) > 0 ? `${Number(e.borderWidth)}px solid ${e.borderColor || '#ffffff'}` : '';
    }
  }

  function makeEl(e, sc) {
    const node = document.createElement('div');
    node.className = `slide-el el-${e.type}` + (e.id === selected ? ' is-selected' : '');
    node.dataset.id = e.id;
    styleBox(node, e);
    fillElement(node, e);
    if (!canEdit) {
      node.style.pointerEvents = 'none';
      return node;
    }

    node.addEventListener('pointerdown', (ev) => {
      if (node.isContentEditable || ev.target.classList.contains('el-resize')) return;
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      selectElement(e.id);
      const activeNode = stage.querySelector(`.slide-el[data-id="${CSS.escape(e.id)}"]`);
      if (!activeNode) return;
      snapshot();
      const start = { x: ev.clientX, y: ev.clientY, ex: Number(e.x) || 0, ey: Number(e.y) || 0 };
      const move = (m) => {
        let nx = start.ex + (m.clientX - start.x) / sc;
        let ny = start.ey + (m.clientY - start.y) / sc;
        const snapped = snapPosition(nx, ny, e.w, e.h);
        nx = snapped.x;
        ny = snapped.y;
        e.x = Math.round(nx);
        e.y = Math.round(ny);
        activeNode.style.left = `${e.x}px`;
        activeNode.style.top = `${e.y}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        guideX = guideY = null;
        renderStage();
        renderProps();
        commit({ stage: false, thumbs: true });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    node.addEventListener('dblclick', (ev) => {
      if (e.type !== 'text' || !canEdit) return;
      ev.preventDefault();
      ev.stopPropagation();
      node.contentEditable = 'true';
      node.style.justifyContent = 'flex-start';
      node.focus();
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      node.addEventListener('blur', () => {
        e.text = node.innerText;
        node.contentEditable = 'false';
        renderStage();
        renderProps();
        commit({ stage: false });
      }, { once: true });
    });

    if (e.id === selected) {
      for (const corner of ['nw', 'ne', 'sw', 'se']) {
        const handle = document.createElement('span');
        handle.className = `el-resize el-resize-${corner}`;
        handle.dataset.corner = corner;
        handle.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          snapshot();
          const start = { x: ev.clientX, y: ev.clientY, ex: Number(e.x) || 0, ey: Number(e.y) || 0, w: Number(e.w) || 20, h: Number(e.h) || 20 };
          const move = (m) => {
            const dx = (m.clientX - start.x) / sc;
            const dy = (m.clientY - start.y) / sc;
            const minW = 24;
            const minH = 18;
            if (corner.includes('e')) e.w = Math.max(minW, Math.round(start.w + dx));
            if (corner.includes('s')) e.h = Math.max(minH, Math.round(start.h + dy));
            if (corner.includes('w')) {
              const w = Math.max(minW, start.w - dx);
              e.x = Math.round(start.ex + (start.w - w));
              e.w = Math.round(w);
            }
            if (corner.includes('n')) {
              const h = Math.max(minH, start.h - dy);
              e.y = Math.round(start.ey + (start.h - h));
              e.h = Math.round(h);
            }
            const active = stage.querySelector(`.slide-el[data-id="${CSS.escape(e.id)}"]`);
            if (active) styleBox(active, e);
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            renderStage();
            renderProps();
            commit({ stage: false, thumbs: true });
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
        node.append(handle);
      }
    }
    return node;
  }

  function snapPosition(x, y, w, h) {
    const targetsX = [0, (data.w - w) / 2, data.w - w];
    const targetsY = [0, (data.h - h) / 2, data.h - h];
    const margin = 7 / scaleOf();
    let sx = x;
    let sy = y;
    guideX = null;
    guideY = null;
    for (const t of targetsX) {
      if (Math.abs(x - t) < margin) {
        sx = t;
        guideX = t + w / 2;
        break;
      }
    }
    for (const t of targetsY) {
      if (Math.abs(y - t) < margin) {
        sy = t;
        guideY = t + h / 2;
        break;
      }
    }
    return { x: Math.round(sx / 8) * 8, y: Math.round(sy / 8) * 8 };
  }

  function selectElement(id) {
    if (readOnly()) return;
    selected = id;
    renderStage();
    renderProps();
    document.body.classList.toggle('has-slide-selection', !!id);
  }

  const readOnly = () => !canEdit;

  // ---------------- thumbnails and stage ----------------
  function renderThumbs() {
    const paintThumb = (host, i, compact) => {
      const s = data.slides[i];
      host.textContent = '';
      host.style.background = s.bg || '#101014';
      if (s.bgImage) {
        const bg = document.createElement('span');
        bg.className = 'slide-thumb-bg';
        bg.style.backgroundImage = `url("${String(s.bgImage).replace(/"/g, '')}")`;
        host.append(bg);
      }
      const canvas = document.createElement('span');
      canvas.className = 'slide-thumb-canvas';
      for (const e of s.elements || []) {
        const item = document.createElement('span');
        item.className = `thumb-el thumb-${e.type}`;
        item.style.left = `${((Number(e.x) || 0) / data.w) * 100}%`;
        item.style.top = `${((Number(e.y) || 0) / data.h) * 100}%`;
        item.style.width = `${((Number(e.w) || 1) / data.w) * 100}%`;
        item.style.height = `${((Number(e.h) || 1) / data.h) * 100}%`;
        item.style.opacity = String(clamp(e.opacity ?? 100, 0, 100) / 100);
        if (e.rotation) item.style.transform = `rotate(${Number(e.rotation)}deg)`;
        if (e.type === 'text') {
          item.textContent = e.text || '';
          item.style.color = e.color || '#f4f4f5';
          item.style.fontSize = `${Math.max(3, ((Number(e.size) || 28) / data.w) * (compact ? 150 : 125))}px`;
          item.style.fontWeight = e.bold ? '700' : '400';
          item.style.textAlign = e.align || 'left';
          item.style.lineHeight = '1.15';
        } else if (e.type === 'image') {
          item.style.backgroundImage = `url("${String(e.src || '').replace(/"/g, '')}")`;
          item.style.backgroundSize = e.fit === 'contain' ? 'contain' : 'cover';
          item.style.backgroundPosition = 'center';
          item.style.backgroundRepeat = 'no-repeat';
        } else {
          item.style.background = e.fill || '#e11d48';
          item.style.borderRadius = e.type === 'ellipse' ? '50%' : `${Math.max(0, Number(e.radius) || 0) * (compact ? 0.12 : 0.1)}px`;
        }
        canvas.append(item);
      }
      host.append(canvas);
    };

    slideList.textContent = '';
    mobileSlides.textContent = '';
    data.slides.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `slide-thumb${i === index ? ' is-active' : ''}`;
      b.title = `Slide ${i + 1}`;
      const no = document.createElement('span');
      no.className = 'slide-thumb-no';
      no.textContent = String(i + 1);
      b.append(no);
      paintThumb(b, i, false);
      b.addEventListener('click', () => {
        index = i;
        selected = null;
        render();
      });
      slideList.append(b);

      const m = document.createElement('button');
      m.type = 'button';
      m.className = `slide-thumb mobile${i === index ? ' is-active' : ''}`;
      const mno = document.createElement('span');
      mno.className = 'slide-thumb-no';
      mno.textContent = String(i + 1);
      m.append(mno);
      paintThumb(m, i, true);
      m.addEventListener('click', () => {
        index = i;
        selected = null;
        render();
      });
      mobileSlides.append(m);
    });
    if (slideCount) slideCount.textContent = String(data.slides.length);
  }

  function renderStage() {
    if (!stage) return;
    fitScaleNow();
    const sc = scaleOf();
    stage.style.width = `${data.w}px`;
    stage.style.height = `${data.h}px`;
    stage.style.transform = `scale(${sc})`;
    stage.style.background = slide().bg || '#101014';
    stage.style.backgroundImage = slide().bgImage ? `url("${String(slide().bgImage).replace(/"/g, '')}")` : 'none';
    stage.style.backgroundSize = 'cover';
    stage.style.backgroundPosition = 'center';
    stage.textContent = '';
    for (const e of slide().elements || []) stage.append(makeEl(e, sc));
    if (guideX !== null) {
      const g = document.createElement('span');
      g.className = 'align-guide align-guide-v';
      g.style.left = `${guideX}px`;
      stage.append(g);
    }
    if (guideY !== null) {
      const g = document.createElement('span');
      g.className = 'align-guide align-guide-h';
      g.style.top = `${guideY}px`;
      stage.append(g);
    }
    if (zoomLabel) zoomLabel.textContent = `${Math.round(sc * 100)}%`;
  }

  function render() {
    if (!stage) return;
    renderThumbs();
    renderStage();
    renderProps();
    if (slideLabel) slideLabel.textContent = `Slide ${index + 1} / ${data.slides.length}`;
    if (slideLabelMobile) slideLabelMobile.textContent = `${index + 1} / ${data.slides.length}`;
    if (mobileSlides && mobileSlides.children[index]) {
      mobileSlides.children[index].scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  // ---------------- inspector helpers ----------------
  function prop(labelText, input) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.className = 'label';
    label.textContent = labelText;
    wrap.append(label, input);
    return wrap;
  }

  function numberInput(value, onChange, opts = {}) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = value;
    if (opts.min !== undefined) inp.min = opts.min;
    if (opts.max !== undefined) inp.max = opts.max;
    inp.addEventListener('change', () => onChange(Number(inp.value) || 0));
    return inp;
  }

  function textInput(value, onChange, placeholder = '') {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value || '';
    inp.placeholder = placeholder;
    inp.addEventListener('change', () => onChange(inp.value));
    return inp;
  }

  function selectInput(value, options, onChange) {
    const select = document.createElement('select');
    for (const [key, label] of Object.entries(options)) {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = label;
      o.selected = String(value) === String(key);
      select.append(o);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function rangeInput(value, min, max, step, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'deck-range';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = min;
    range.max = max;
    range.step = step;
    range.value = value;
    const out = document.createElement('span');
    out.textContent = value;
    range.addEventListener('input', () => {
      out.textContent = range.value;
      onChange(Number(range.value));
    });
    wrap.append(range, out);
    return wrap;
  }

  function section(title, children) {
    const box = document.createElement('section');
    box.className = 'deck-prop-section';
    const heading = document.createElement('div');
    heading.className = 'side-label';
    heading.textContent = title;
    box.append(heading, ...children);
    return box;
  }

  function colorRow(labelText, value, onChange) {
    const row = document.createElement('div');
    row.className = 'colorrow';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = labelText;
    const color = document.createElement('input');
    color.type = 'color';
    color.value = value || '#ffffff';
    color.addEventListener('input', () => onChange(color.value));
    row.append(label, color);
    return row;
  }

  function iconButton(label, title, onClick, cls = 'btn btn-ghost btn-sm') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.title = title || label;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderProps() {
    if (!propsBody) return;
    propsBody.textContent = '';
    const s = slide();
    const trans = transitionOf(s);

    const bgRow = colorRow('Background', s.bg || '#101014', (v) => {
      s.bg = v;
      renderStage();
      renderThumbs();
      window.Workspace?.schedule?.();
    });
    const bgActions = document.createElement('div');
    bgActions.className = 'side-actions';
    bgActions.append(
      iconButton(s.bgImage ? 'Replace image' : 'Background image', 'Choose a background image', () => {
        if (readOnly()) return;
        window.CascadeImages?.open({
          onPick({ src }) {
            s.bgImage = src;
            renderStage();
            renderThumbs();
            renderProps();
            window.Workspace?.schedule?.();
          },
        });
      }),
      iconButton('Clear image', 'Remove background image', () => {
        if (readOnly() || !s.bgImage) return;
        delete s.bgImage;
        renderStage();
        renderThumbs();
        renderProps();
        window.Workspace?.schedule?.();
      }, 'btn btn-quiet btn-sm'),
    );

    const transitionRow = document.createElement('div');
    transitionRow.className = 'form-grid';
    const duration = numberInput(trans.duration, (v) => {
      s.transition = { ...transitionOf(s), duration: clamp(v, 150, 2500) };
      window.Workspace?.schedule?.();
    }, { min: 150, max: 2500 });
    transitionRow.append(
      prop('Transition', selectInput(trans.type, TRANSITIONS, (v) => {
        s.transition = { ...transitionOf(s), type: v };
        renderProps();
        window.Workspace?.schedule?.();
      })),
      prop('Duration (ms)', duration),
    );
    const easing = selectInput(trans.easing, EASINGS, (v) => {
      s.transition = { ...transitionOf(s), easing: v };
      window.Workspace?.schedule?.();
    });
    const applyAll = iconButton('Apply transition to all slides', 'Copy this transition to every slide', () => {
      if (readOnly()) return;
      snapshot();
      const t = { ...transitionOf(s) };
      for (const other of data.slides) other.transition = { ...t };
      window.Workspace?.schedule?.();
      window.cascadeToast?.('Transition applied to every slide');
    });
    const playBtn = iconButton('Play transition', 'Preview this transition and its animations', () => present(index));
    const transActions = document.createElement('div');
    transActions.className = 'deck-prop-actions';
    transActions.append(playBtn, applyAll);

    const notes = document.createElement('textarea');
    notes.rows = 4;
    notes.value = s.notes || '';
    notes.placeholder = 'Speaker notes — visible in presenter and exported to PowerPoint.';
    notes.addEventListener('input', () => {
      s.notes = notes.value;
      window.Workspace?.schedule?.();
    });

    const layouts = document.createElement('div');
    layouts.className = 'deck-layout-grid';
    for (const [id, label] of [['title', 'Title'], ['title-body', 'Title + body'], ['two-col', 'Two columns'], ['quote', 'Quote'], ['section', 'Section'], ['blank', 'Blank']]) {
      layouts.append(iconButton(label, `Apply ${label.toLowerCase()} layout`, () => applyLayout(id), 'btn btn-quiet btn-sm'));
    }

    propsBody.append(section('Slide', [bgRow, bgActions, layouts]));
    propsBody.append(section('Transition', [transitionRow, prop('Easing', easing), transActions]));
    propsBody.append(section('Speaker notes', [notes]));
    propsBody.append(section('Slide order', [
      (() => {
        const row = document.createElement('div');
        row.className = 'row';
        row.style.gap = '5px';
        row.append(
          iconButton('↑', 'Move slide earlier', () => moveSlide(-1)),
          iconButton('↓', 'Move slide later', () => moveSlide(1)),
          iconButton('Duplicate slide', 'Duplicate this slide and its animations', duplicateSlide, 'btn btn-ghost btn-sm'),
          iconButton('Delete slide', 'Delete this slide', deleteSlide, 'btn btn-danger btn-sm'),
        );
        return row;
      })(),
    ]));

    const e = current();
    if (!e) {
      const hint = document.createElement('p');
      hint.className = 'side-note';
      hint.textContent = 'Select an element to edit its content, position, style and entrance animation. Drag on the canvas to move; drag a corner to resize.';
      propsBody.prepend(section('Selected element', [hint]));
      return;
    }

    const label = document.createElement('div');
    label.className = 'deck-selected-label';
    label.innerHTML = `<span class="badge badge-accent">${e.type}</span> <span class="hint">${e.id}</span>`;
    const selectedSection = document.createElement('section');
    selectedSection.className = 'deck-prop-section deck-selected-section';
    selectedSection.append(label);

    if (e.type === 'text') {
      const area = document.createElement('textarea');
      area.rows = 3;
      area.value = e.text || '';
      area.addEventListener('input', () => {
        e.text = area.value;
        const node = stage.querySelector(`.slide-el[data-id="${CSS.escape(e.id)}"]`);
        if (node) node.textContent = e.text;
        renderThumbs();
        window.Workspace?.schedule?.();
      });
      selectedSection.append(prop('Text', area));

      const fontRow = document.createElement('div');
      fontRow.className = 'form-grid';
      fontRow.append(
        prop('Font', selectInput(e.fontFamily || '', {
          '': 'Theme default', 'Inter, sans-serif': 'Inter', 'Georgia, serif': 'Georgia',
          'Arial, sans-serif': 'Arial', "'Courier New', monospace": 'Courier', "'Trebuchet MS', sans-serif": 'Trebuchet',
        }, (v) => {
          e.fontFamily = v;
          renderStage();
          window.Workspace?.schedule?.();
        })),
        prop('Size', numberInput(e.size || 28, (v) => {
          e.size = Math.max(8, v);
          renderStage();
          window.Workspace?.schedule?.();
        }, { min: 8, max: 220 })),
      );
      const styleRow = document.createElement('div');
      styleRow.className = 'deck-style-row';
      styleRow.append(
        iconButton('B', 'Bold', () => { e.bold = !e.bold; renderStage(); renderProps(); window.Workspace?.schedule?.(); }, `tool${e.bold ? ' is-active' : ''}`),
        iconButton('I', 'Italic', () => { e.italic = !e.italic; renderStage(); renderProps(); window.Workspace?.schedule?.(); }, `tool${e.italic ? ' is-active' : ''}`),
        iconButton('U', 'Underline', () => { e.underline = !e.underline; renderStage(); renderProps(); window.Workspace?.schedule?.(); }, `tool${e.underline ? ' is-active' : ''}`),
        iconButton('⇤', 'Align left', () => { e.align = 'left'; renderStage(); renderProps(); }, `tool${e.align === 'left' ? ' is-active' : ''}`),
        iconButton('↔', 'Align centre', () => { e.align = 'center'; renderStage(); renderProps(); }, `tool${e.align === 'center' ? ' is-active' : ''}`),
        iconButton('⇥', 'Align right', () => { e.align = 'right'; renderStage(); renderProps(); }, `tool${e.align === 'right' ? ' is-active' : ''}`),
      );
      const color = colorRow('Text colour', e.color || '#f4f4f5', (v) => {
        e.color = v;
        renderStage();
        window.Workspace?.schedule?.();
      });
      const lineRow = document.createElement('div');
      lineRow.className = 'form-grid';
      lineRow.append(
        prop('Line height %', numberInput(e.lineHeight || 120, (v) => {
          e.lineHeight = clamp(v, 60, 240);
          renderStage();
          window.Workspace?.schedule?.();
        }, { min: 60, max: 240 })),
        prop('Letter spacing', numberInput(e.letterSpacing || 0, (v) => {
          e.letterSpacing = clamp(v, -10, 40);
          renderStage();
          window.Workspace?.schedule?.();
        }, { min: -10, max: 40 })),
      );
      selectedSection.append(styleRow, color, lineRow);
    } else if (e.type === 'rect' || e.type === 'ellipse' || e.type === 'line') {
      selectedSection.append(
        prop('Shape', selectInput(e.type, { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' }, (v) => {
          e.type = v;
          render();
          window.Workspace?.schedule?.();
        })),
        colorRow('Fill', e.fill || '#e11d48', (v) => {
          e.fill = v;
          renderStage();
          window.Workspace?.schedule?.();
        }),
      );
      if (e.type !== 'line') {
        selectedSection.append(prop('Corner radius', numberInput(e.radius || 0, (v) => {
          e.radius = clamp(v, 0, 300);
          renderStage();
          window.Workspace?.schedule?.();
        }, { min: 0, max: 300 })));
      }
      const borderRow = document.createElement('div');
      borderRow.className = 'form-grid';
      borderRow.append(
        prop('Border width', numberInput(e.borderWidth || 0, (v) => {
          e.borderWidth = clamp(v, 0, 40);
          renderStage();
          window.Workspace?.schedule?.();
        }, { min: 0, max: 40 })),
        colorRow('Border', e.borderColor || '#ffffff', (v) => {
          e.borderColor = v;
          renderStage();
          window.Workspace?.schedule?.();
        }),
      );
      selectedSection.append(borderRow);
    } else if (e.type === 'image') {
      const fit = selectInput(e.fit || 'cover', { cover: 'Fill frame', contain: 'Fit inside', fill: 'Stretch' }, (v) => {
        e.fit = v;
        renderStage();
        window.Workspace?.schedule?.();
      });
      const actions = document.createElement('div');
      actions.className = 'row';
      actions.style.gap = '5px';
      actions.append(iconButton('Replace', 'Replace image', () => {
        window.CascadeImages?.open({
          onPick({ src, alt, credit }) {
            e.src = src;
            e.alt = alt || e.alt || '';
            e.credit = credit || e.credit || '';
            renderStage();
            renderProps();
            window.Workspace?.schedule?.();
          },
        });
      }, 'btn btn-ghost btn-sm'));
      selectedSection.append(prop('Image fit', fit), prop('Alt text', textInput(e.alt || '', (v) => {
        e.alt = v;
        renderStage();
        window.Workspace?.schedule?.();
      }, 'Describe the image')), prop('Corner radius', numberInput(e.radius || 0, (v) => {
        e.radius = clamp(v, 0, 300);
        renderStage();
        window.Workspace?.schedule?.();
      })), actions);
    }

    const geometry = document.createElement('div');
    geometry.className = 'deck-geometry';
    geometry.append(
      prop('X', numberInput(Math.round(e.x), (v) => { e.x = v; renderStage(); window.Workspace?.schedule?.(); })),
      prop('Y', numberInput(Math.round(e.y), (v) => { e.y = v; renderStage(); window.Workspace?.schedule?.(); })),
      prop('W', numberInput(Math.round(e.w), (v) => { e.w = Math.max(10, v); renderStage(); window.Workspace?.schedule?.(); })),
      prop('H', numberInput(Math.round(e.h), (v) => { e.h = Math.max(10, v); renderStage(); window.Workspace?.schedule?.(); })),
    );
    selectedSection.append(geometry);
    selectedSection.append(prop('Rotation', numberInput(e.rotation || 0, (v) => {
      e.rotation = clamp(v, -360, 360);
      renderStage();
      window.Workspace?.schedule?.();
    }, { min: -360, max: 360 })));
    const opacity = rangeInput(clamp(e.opacity ?? 100, 0, 100), 0, 100, 5, (v) => {
      e.opacity = v;
      renderStage();
      window.Workspace?.schedule?.();
    });
    selectedSection.append(prop('Opacity %', opacity));

    // Entrance animation.
    const anim = animationOf(e);
    const animGrid = document.createElement('div');
    animGrid.className = 'form-grid';
    animGrid.append(
      prop('Animation', selectInput(anim.type, ANIMATIONS, (v) => {
        e.animation = { ...animationOf(e), type: v, touch: true };
        renderProps();
        window.Workspace?.schedule?.();
      })),
      prop('Trigger', selectInput(anim.trigger, { after: 'After previous', with: 'With previous', click: 'On click' }, (v) => {
        e.animation = { ...animationOf(e), trigger: v, touch: true };
        window.Workspace?.schedule?.();
      })),
    );
    const animGrid2 = document.createElement('div');
    animGrid2.className = 'form-grid';
    animGrid2.append(
      prop('Delay (ms)', numberInput(anim.delay, (v) => {
        e.animation = { ...animationOf(e), delay: clamp(v, 0, 5000), touch: true };
        window.Workspace?.schedule?.();
      }, { min: 0, max: 5000 })),
      prop('Duration (ms)', numberInput(anim.duration, (v) => {
        e.animation = { ...animationOf(e), duration: clamp(v, 100, 3000), touch: true };
        window.Workspace?.schedule?.();
      }, { min: 100, max: 3000 })),
    );
    const animEase = selectInput(anim.easing, EASINGS, (v) => {
      e.animation = { ...animationOf(e), easing: v, touch: true };
      window.Workspace?.schedule?.();
    });
    const animActions = document.createElement('div');
    animActions.className = 'deck-prop-actions';
    animActions.append(
      iconButton('Preview', 'Preview this animation full screen', () => present(index)),
      iconButton('Remove animation', 'Remove this entrance animation', () => {
        e.animation = { type: 'none' };
        renderProps();
        window.Workspace?.schedule?.();
      }, 'btn btn-quiet btn-sm'),
    );

    // Arrange.
    const arrange = document.createElement('div');
    arrange.className = 'deck-prop-actions';
    arrange.append(
      iconButton('To front', 'Bring element to the front', () => arrangeLayer('front')),
      iconButton('Forward', 'Move element one layer forward', () => arrangeLayer('forward')),
      iconButton('Backward', 'Move element one layer backward', () => arrangeLayer('backward')),
      iconButton('To back', 'Send element to the back', () => arrangeLayer('back')),
      iconButton('Duplicate', 'Duplicate this element', duplicateElement),
      iconButton('Delete', 'Delete this element', deleteElement, 'btn btn-danger btn-sm'),
    );

    selectedSection.append(section('Entrance animation', [animGrid, animGrid2, prop('Easing', animEase), animActions]));
    selectedSection.append(section('Arrange', [arrange]));
    propsBody.prepend(selectedSection);
  }

  // ---------------- mutate helpers ----------------
  function arrangeLayer(mode) {
    const e = current();
    if (!e || readOnly()) return;
    const list = slide().elements;
    const i = list.findIndex((x) => x.id === e.id);
    if (i < 0) return;
    if (mode === 'front' && i === list.length - 1) return;
    if (mode === 'back' && i === 0) return;
    if (mode === 'forward' && i >= list.length - 1) return;
    if (mode === 'backward' && i <= 0) return;
    snapshot();
    if (mode === 'front') {
      list.splice(i, 1);
      list.push(e);
    } else if (mode === 'back') {
      list.splice(i, 1);
      list.unshift(e);
    } else if (mode === 'forward' && i < list.length - 1) {
      [list[i], list[i + 1]] = [list[i + 1], list[i]];
    } else if (mode === 'backward' && i > 0) {
      [list[i], list[i - 1]] = [list[i - 1], list[i]];
    } else {
      return;
    }
    render();
    window.Workspace?.schedule?.();
  }

  function duplicateElement() {
    const e = current();
    if (!e || readOnly()) return;
    snapshot();
    const copy = JSON.parse(JSON.stringify(e));
    copy.id = uid();
    copy.x = (Number(e.x) || 0) + 24;
    copy.y = (Number(e.y) || 0) + 24;
    slide().elements.push(copy);
    selected = copy.id;
    render();
    window.Workspace?.schedule?.();
  }

  function deleteElement() {
    const e = current();
    if (!e || readOnly()) return;
    snapshot();
    slide().elements = slide().elements.filter((x) => x.id !== e.id);
    selected = null;
    render();
    window.Workspace?.schedule?.();
  }

  function moveSlide(dir) {
    if (readOnly()) return;
    const target = index + dir;
    if (target < 0 || target >= data.slides.length) return;
    snapshot();
    const [s] = data.slides.splice(index, 1);
    data.slides.splice(target, 0, s);
    index = target;
    selected = null;
    render();
    window.Workspace?.schedule?.();
  }

  function duplicateSlide() {
    if (readOnly()) return;
    snapshot();
    const copy = JSON.parse(JSON.stringify(slide()));
    copy.id = uid('s');
    copy.elements = (copy.elements || []).map((e) => ({ ...e, id: uid() }));
    data.slides.splice(index + 1, 0, copy);
    index += 1;
    selected = null;
    render();
    window.Workspace?.schedule?.();
  }

  function deleteSlide() {
    if (readOnly()) return;
    if (data.slides.length === 1) return window.cascadeToast?.('A deck needs at least one slide', true);
    snapshot();
    data.slides.splice(index, 1);
    index = Math.max(0, index - 1);
    selected = null;
    render();
    window.Workspace?.schedule?.();
  }

  function textEl(id, x, y, w, h, value, opts = {}) {
    return {
      id, type: 'text', x, y, w, h, text: value,
      size: opts.size || 36, color: opts.color || '#f4f4f5', bold: !!opts.bold,
      align: opts.align || 'left', valign: opts.valign || 'top', fontFamily: opts.fontFamily || '',
    };
  }

  function applyLayout(kind) {
    if (readOnly()) return;
    snapshot();
    const s = slide();
    const w = data.w;
    const h = data.h;
    const pad = Math.round(w * 0.07);
    const elements = [];
    if (kind === 'title') {
      elements.push(textEl(uid(), pad, Math.round(h * 0.32), Math.round(w * 0.76), Math.round(h * 0.2), 'Your title', { size: Math.round(w * 0.062), bold: true }));
      elements.push(textEl(uid(), pad, Math.round(h * 0.58), Math.round(w * 0.62), Math.round(h * 0.1), 'A subtitle or one-line summary', { size: Math.round(w * 0.022), color: '#a1a1aa' }));
    } else if (kind === 'title-body') {
      elements.push(textEl(uid(), pad, Math.round(h * 0.09), Math.round(w * 0.75), Math.round(h * 0.11), 'Slide title', { size: Math.round(w * 0.042), bold: true }));
      elements.push(textEl(uid(), pad, Math.round(h * 0.27), Math.round(w * 0.8), Math.round(h * 0.5), '• First point\n• Second point\n• Third point', { size: Math.round(w * 0.022), lineHeight: 150 }));
    } else if (kind === 'two-col') {
      elements.push(textEl(uid(), pad, Math.round(h * 0.09), Math.round(w * 0.8), Math.round(h * 0.11), 'Two-column slide', { size: Math.round(w * 0.04), bold: true }));
      elements.push({ id: uid(), type: 'rect', x: pad, y: Math.round(h * 0.28), w: Math.round(w * 0.39), h: Math.round(h * 0.5), fill: '#1f2937', radius: 14 });
      elements.push({ id: uid(), type: 'rect', x: Math.round(w * 0.54), y: Math.round(h * 0.28), w: Math.round(w * 0.39), h: Math.round(h * 0.5), fill: '#1f2937', radius: 14 });
      elements.push(textEl(uid(), pad + 22, Math.round(h * 0.31), Math.round(w * 0.33), Math.round(h * 0.42), 'Left column', { size: Math.round(w * 0.023), color: '#d4d4d8' }));
      elements.push(textEl(uid(), Math.round(w * 0.54) + 22, Math.round(h * 0.31), Math.round(w * 0.33), Math.round(h * 0.42), 'Right column', { size: Math.round(w * 0.023), color: '#d4d4d8' }));
    } else if (kind === 'quote') {
      elements.push(textEl(uid(), Math.round(w * 0.12), Math.round(h * 0.26), Math.round(w * 0.76), Math.round(h * 0.34), '“A memorable quote goes here.”', { size: Math.round(w * 0.044), bold: true, align: 'center', valign: 'middle' }));
      elements.push(textEl(uid(), Math.round(w * 0.2), Math.round(h * 0.66), Math.round(w * 0.6), Math.round(h * 0.08), '— Attribution', { size: Math.round(w * 0.019), color: '#a1a1aa', align: 'center' }));
    } else if (kind === 'section') {
      elements.push({ id: uid(), type: 'rect', x: pad, y: Math.round(h * 0.42), w: Math.round(w * 0.08), h: 6, fill: '#e11d48', radius: 4 });
      elements.push(textEl(uid(), pad, Math.round(h * 0.5), Math.round(w * 0.76), Math.round(h * 0.14), 'Section title', { size: Math.round(w * 0.052), bold: true }));
    }
    s.elements = elements;
    selected = null;
    render();
    window.Workspace?.schedule?.();
  }

  // ---------------- presenter ----------------
  function present(start = index) {
    if (!stage) return;
    let currentSlide = clamp(start, 0, data.slides.length - 1);
    let buildStep = 0;
    let clickAnimations = [];
    let notesOpen = false;
    const overlay = document.createElement('div');
    overlay.className = 'present-overlay';
    overlay.tabIndex = 0;
    overlay.innerHTML = `
      <div class="present-topbar">
        <span class="present-brand">${String(DOC.filename || 'Presentation').replace(/[<>&]/g, '')}</span>
        <div class="present-top-actions">
          <button type="button" class="present-btn" data-present="notes" title="Speaker notes (N)">Notes</button>
          <button type="button" class="present-btn" data-present="fullscreen" title="Full screen (F)">Full screen</button>
          <button type="button" class="present-btn" data-present="exit" title="Exit (Esc)">Exit</button>
        </div>
      </div>
      <div class="present-body">
        <div class="present-canvas-wrap"><div class="present-slide" id="present-slide"></div></div>
        <aside class="present-notes" id="present-notes" hidden>
          <div class="side-label">Speaker notes</div>
          <div id="present-notes-body"></div>
          <div class="present-next-preview"><div class="side-label">Next</div><div id="present-next"></div></div>
        </aside>
      </div>
      <div class="present-controls">
        <button type="button" class="present-btn" data-present="prev" title="Previous (←)">←</button>
        <span class="present-progress" id="present-progress"></span>
        <button type="button" class="present-btn" data-present="next" title="Next (→ or Space)">→</button>
      </div>`;

    const slideHost = overlay.querySelector('#present-slide');
    const notesHost = overlay.querySelector('#present-notes-body');
    const notesPanel = overlay.querySelector('#present-notes');
    const progress = overlay.querySelector('#present-progress');
    const nextPreview = overlay.querySelector('#present-next');

    function paintElement(e) {
      const node = document.createElement('div');
      node.className = `present-el present-el-${e.type}`;
      styleBox(node, e);
      fillElement(node, e);
      node.style.pointerEvents = 'none';
      return node;
    }

    function animStyle(anim) {
      return {
        duration: anim.duration,
        delay: anim.delay,
        easing: anim.easing,
      };
    }

    function paintSlide() {
      const s = data.slides[currentSlide];
      const t = transitionOf(s);
      buildStep = 0;
      clickAnimations = [];
      slideHost.textContent = '';
      slideHost.className = `present-slide trans-${t.type}`;
      slideHost.style.setProperty('--transition-duration', `${t.duration}ms`);
      slideHost.style.setProperty('--transition-easing', t.easing);
      slideHost.style.background = s.bg || '#101014';
      slideHost.style.backgroundImage = s.bgImage ? `url("${String(s.bgImage).replace(/"/g, '')}")` : 'none';
      slideHost.style.backgroundSize = 'cover';
      slideHost.style.backgroundPosition = 'center';
      slideHost.style.width = `${data.w}px`;
      slideHost.style.height = `${data.h}px`;
      const elements = s.elements || [];
      for (let i = 0; i < elements.length; i++) {
        const e = elements[i];
        const node = paintElement(e);
        const anim = animationOf(e);
        node.dataset.animIndex = String(i);
        if (anim.type !== 'none') {
          const style = animStyle(anim);
          node.style.setProperty('--anim-duration', `${style.duration}ms`);
          node.style.setProperty('--anim-delay', `${style.delay + (anim.trigger === 'after' ? i * 60 : 0)}ms`);
          node.style.setProperty('--anim-ease', style.easing);
          node.classList.add('el-anim-ready', `el-anim-${anim.type}`);
          if (anim.trigger === 'click') {
            node.classList.add('is-build-waiting');
            clickAnimations.push(node);
            node.dataset.buildIndex = String(clickAnimations.length - 1);
          } else {
            node.classList.add('is-animating');
          }
        }
        slideHost.append(node);
      }
      notesHost.textContent = s.notes || 'No notes for this slide.';
      progress.textContent = `${currentSlide + 1} / ${data.slides.length}`;
      const next = data.slides[currentSlide + 1];
      nextPreview.textContent = next ? `Slide ${currentSlide + 2}` : 'End of deck';
      const host = overlay.querySelector('.present-canvas-wrap');
      const sc = Math.min((host.clientWidth || window.innerWidth) / data.w, (host.clientHeight || window.innerHeight) / data.h);
      slideHost.style.zoom = String(Math.max(0.1, sc));
      requestAnimationFrame(() => slideHost.classList.add('is-live'));
      if (isEnded()) progress.textContent = `${currentSlide + 1} / ${data.slides.length} · End`;
    }

    const isEnded = () => currentSlide === data.slides.length - 1;
    function revealNextBuild() {
      if (buildStep >= clickAnimations.length) return false;
      const node = clickAnimations[buildStep];
      node.classList.remove('is-build-waiting');
      node.classList.add('is-animating');
      buildStep += 1;
      return true;
    }
    function next() {
      if (revealNextBuild()) return;
      if (currentSlide < data.slides.length - 1) {
        currentSlide += 1;
        paintSlide();
      }
    }
    function prev() {
      if (buildStep > 0) {
        buildStep = 0;
        paintSlide();
        return;
      }
      if (currentSlide > 0) {
        currentSlide -= 1;
        paintSlide();
      }
    }
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('is-presenting');
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
    function toggleNotes() {
      notesOpen = !notesOpen;
      notesPanel.hidden = !notesOpen;
      paintSlide();
    }
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      else if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(ev.key)) { ev.preventDefault(); next(); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(ev.key)) { ev.preventDefault(); prev(); }
      else if (ev.key.toLowerCase() === 'n') { ev.preventDefault(); toggleNotes(); }
      else if (ev.key.toLowerCase() === 'f') { ev.preventDefault(); toggleFullscreen(); }
      else if (ev.key === 'Home') { currentSlide = 0; paintSlide(); }
      else if (ev.key === 'End') { currentSlide = data.slides.length - 1; paintSlide(); }
    }
    function toggleFullscreen() {
      if (!document.fullscreenElement) overlay.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
    }
    overlay.addEventListener('click', (ev) => {
      const action = ev.target.closest('[data-present]')?.dataset.present;
      if (action === 'next') next();
      else if (action === 'prev') prev();
      else if (action === 'exit') close();
      else if (action === 'notes') toggleNotes();
      else if (action === 'fullscreen') toggleFullscreen();
    });
    overlay.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button, .present-notes, .present-slide, .present-next-preview')) return;
      const rect = overlay.getBoundingClientRect();
      if (ev.clientX > rect.width * 0.7) next();
      else if (ev.clientX < rect.width * 0.3) prev();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    document.body.classList.add('is-presenting');
    paintSlide();
    overlay.focus();
    window.addEventListener('resize', () => {
      if (!overlay.isConnected) return;
      const host = overlay.querySelector('.present-canvas-wrap');
      const sc = Math.min((host.clientWidth || window.innerWidth) / data.w, (host.clientHeight || window.innerHeight) / data.h);
      slideHost.style.zoom = String(Math.max(0.1, sc));
    }, { passive: true });
    return overlay;
  }

  // ---------------- workspace runtime ----------------
  const ws = window.Workspace.create({
    id: DOC.id,
    kind: 'deck',
    version: DOC.version,
    content: data,
    isPublic: DOC.isPublic,
    filename: DOC.filename,
    canEdit,
    apply(content) {
      if (!content || !Array.isArray(content.slides) || !content.slides.length) return;
      data.slides = content.slides;
      data.w = Number(content.w) || 1280;
      data.h = Number(content.h) || 720;
      index = Math.min(index, data.slides.length - 1);
      selected = null;
      render();
    },
    collect() {
      return { w: data.w, h: data.h, slides: data.slides };
    },
  });

  // ---------------- toolbar wiring ----------------
  const addText = document.getElementById('add-text');
  addText?.addEventListener('click', () => {
    if (readOnly()) return;
    snapshot();
    const el = textEl(uid(), Math.round(data.w * 0.14), Math.round(data.h * 0.18), Math.round(data.w * 0.55), 100, 'Double-click to edit', { size: Math.round(data.w * 0.034), bold: true });
    slide().elements.push(el);
    selected = el.id;
    render();
    window.Workspace?.schedule?.();
  });

  document.getElementById('add-rect')?.addEventListener('click', () => {
    if (readOnly()) return;
    snapshot();
    const el = { id: uid(), type: 'rect', x: Math.round(data.w * 0.2), y: Math.round(data.h * 0.25), w: Math.round(data.w * 0.24), h: Math.round(data.h * 0.24), fill: '#e11d48', radius: 12 };
    slide().elements.push(el);
    selected = el.id;
    render();
    window.Workspace?.schedule?.();
  });

  document.getElementById('add-image')?.addEventListener('click', () => {
    if (readOnly()) return;
    window.CascadeImages?.open({
      onPick({ src, alt, credit }) {
        snapshot();
        const el = { id: uid(), type: 'image', src, alt: alt || '', credit: credit || '', x: Math.round(data.w * 0.28), y: Math.round(data.h * 0.22), w: Math.round(data.w * 0.42), h: Math.round(data.h * 0.46), fit: 'cover' };
        slide().elements.push(el);
        selected = el.id;
        render();
        window.Workspace?.schedule?.();
      },
    });
  });

  document.getElementById('add-slide')?.addEventListener('click', () => {
    if (readOnly()) return;
    snapshot();
    data.slides.push({ id: uid('s'), bg: slide()?.bg || '#101014', notes: '', transition: { ...transitionOf(slide()) }, elements: [] });
    index = data.slides.length - 1;
    selected = null;
    render();
    window.Workspace?.schedule?.();
  });

  document.getElementById('deck-layout-select')?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    applyLayout(e.target.value);
    e.target.value = '';
  });

  document.querySelectorAll('[data-align]').forEach((button) => {
    button.addEventListener('click', () => {
      const e = current();
      if (!e) return;
      snapshot();
      const a = button.dataset.align;
      if (a === 'left') e.x = 0;
      if (a === 'center') e.x = Math.round((data.w - e.w) / 2);
      if (a === 'right') e.x = Math.round(data.w - e.w);
      if (a === 'top') e.y = 0;
      if (a === 'middle') e.y = Math.round((data.h - e.h) / 2);
      if (a === 'bottom') e.y = Math.round(data.h - e.h);
      render();
      window.Workspace?.schedule?.();
    });
  });

  document.getElementById('deck-undo')?.addEventListener('click', undo);
  document.getElementById('deck-redo')?.addEventListener('click', redo);
  document.getElementById('deck-duplicate')?.addEventListener('click', duplicateElement);
  document.getElementById('deck-delete')?.addEventListener('click', deleteElement);
  document.getElementById('deck-preview')?.addEventListener('click', () => present(index));
  document.getElementById('deck-present')?.addEventListener('click', () => present(index));

  document.getElementById('deck-prev-slide')?.addEventListener('click', () => {
    if (index > 0) { index -= 1; selected = null; render(); }
  });
  document.getElementById('deck-next-slide')?.addEventListener('click', () => {
    if (index < data.slides.length - 1) { index += 1; selected = null; render(); }
  });

  const setZoom = (value) => {
    zoom = clamp(value, 0.35, 2.5);
    renderStage();
  };
  document.getElementById('deck-zoom-in')?.addEventListener('click', () => setZoom(zoom + 0.1));
  document.getElementById('deck-zoom-out')?.addEventListener('click', () => setZoom(zoom - 0.1));
  document.getElementById('deck-zoom-fit')?.addEventListener('click', () => { zoom = 1; renderStage(); });

  function toggleInspector(open) {
    const nextOpen = open ?? !inspector.classList.contains('is-open');
    inspector.classList.toggle('is-open', nextOpen);
    inspectorToggle?.setAttribute('aria-expanded', String(nextOpen));
  }
  inspectorToggle?.addEventListener('click', () => toggleInspector());
  document.getElementById('deck-inspector-close')?.addEventListener('click', () => toggleInspector(false));

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    if (document.body.classList.contains('is-presenting')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateElement();
      return;
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      present(index);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      deleteElement();
      return;
    }
    if (e.key === 'Escape') {
      selected = null;
      renderStage();
      renderProps();
      return;
    }
    if (selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const el = current();
      if (!el) return;
      e.preventDefault();
      snapshot();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') el.x -= step;
      if (e.key === 'ArrowRight') el.x += step;
      if (e.key === 'ArrowUp') el.y -= step;
      if (e.key === 'ArrowDown') el.y += step;
      renderStage();
      window.Workspace?.schedule?.();
      return;
    }
    if (e.key === 'ArrowLeft' && !selected) {
      if (index > 0) { index -= 1; render(); }
    }
    if (e.key === 'ArrowRight' && !selected) {
      if (index < data.slides.length - 1) { index += 1; render(); }
    }
    if (e.key.toLowerCase() === 't' && !mod) {
      addText?.click();
    }
    if (e.key.toLowerCase() === 'r' && !mod) {
      document.getElementById('add-rect')?.click();
    }
    if (e.key.toLowerCase() === 'p' && !mod) present(index);
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderStage(), 80);
  });

  if (!canEdit) {
    document.body.classList.add('is-readonly');
    document.querySelectorAll('#deck-toolbar button, #deck-toolbar select, #add-slide, #deck-inspector-close').forEach((el) => {
      if (!['deck-present', 'deck-preview', 'deck-inspector-toggle'].includes(el.id)) el.disabled = true;
    });
    if (addText) addText.hidden = true;
  }

  render();
  if (inspector && window.matchMedia('(max-width: 900px)').matches) inspector.classList.remove('is-open');
})();
