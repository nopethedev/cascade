/* Presentation editor: draggable/resizable slide elements, slide management,
   speaker notes, present mode, undo/redo, autosave. */
(function () {
  const DOC = window.__DOC__;
  if (!DOC) return;
  const blank = () => ({ w: 1280, h: 720, slides: [{ id: 's1', bg: '#101014', notes: '', elements: [] }] });
  const data = DOC.content && Array.isArray(DOC.content.slides) && DOC.content.slides.length ? DOC.content : blank();
  data.w = data.w || 1280;
  data.h = data.h || 720;

  const stage = document.getElementById('stage');
  const stageWrap = document.getElementById('stage-wrap');
  const slideList = document.getElementById('slide-list');
  const propsBody = document.getElementById('props-body');
  const slideLabel = document.getElementById('deck-slide-label');

  let index = 0;
  let selected = null;
  const history = [];
  const future = [];

  const uid = () => 'e' + Math.random().toString(36).slice(2, 8);
  const slide = () => data.slides[index];
  const current = () => (slide().elements || []).find((e) => e.id === selected) || null;

  function snapshot() {
    history.push(JSON.stringify({ w: data.w, h: data.h, slides: data.slides }));
    if (history.length > 60) history.shift();
    future.length = 0;
  }
  function undo() {
    if (!history.length) return;
    future.push(JSON.stringify({ slides: data.slides }));
    data.slides = JSON.parse(history.pop()).slides;
    index = Math.min(index, data.slides.length - 1);
    selected = null;
    render();
    ws.schedule();
  }
  function redo() {
    if (!future.length) return;
    history.push(JSON.stringify({ slides: data.slides }));
    data.slides = JSON.parse(future.pop()).slides;
    selected = null;
    render();
    ws.schedule();
  }

  const scaleOf = () => Math.min(1, (stageWrap.clientWidth || 900) / data.w);

  function makeEl(e, sc) {
    const node = document.createElement('div');
    node.className = `slide-el el-${e.type}` + (e.id === selected ? ' is-selected' : '');
    node.style.left = `${e.x}px`;
    node.style.top = `${e.y}px`;
    node.style.width = `${e.w}px`;
    node.style.height = `${e.h}px`;
    node.dataset.id = e.id;

    if (e.type === 'text') {
      node.textContent = e.text || '';
      node.style.color = e.color || '#f4f4f5';
      node.style.fontSize = `${e.size || 28}px`;
      node.style.fontWeight = e.bold ? '700' : '400';
      node.style.textAlign = e.align || 'left';
      node.style.whiteSpace = 'pre-wrap';
      node.addEventListener('dblclick', () => {
        node.contentEditable = 'true';
        node.focus();
        node.addEventListener('blur', () => {
          e.text = node.textContent;
          node.contentEditable = 'false';
          ws.schedule();
          renderProps();
        }, { once: true });
      });
    } else if (e.type === 'rect') {
      node.style.background = e.fill || '#e11d48';
      node.style.borderRadius = `${e.radius || 0}px`;
    } else if (e.type === 'image') {
      const img = document.createElement('img');
      img.src = e.src;
      img.alt = e.alt || '';
      img.title = e.credit || '';
      img.draggable = false;
      node.append(img);
      node.style.overflow = 'hidden';
      node.style.borderRadius = `${e.radius || 0}px`;
    }

    node.addEventListener('pointerdown', (ev) => {
      if (node.isContentEditable || ev.target.classList.contains('el-resize')) return;
      ev.preventDefault();
      selected = e.id;
      document.querySelectorAll('.slide-el.is-selected').forEach((n) => n.classList.remove('is-selected'));
      node.classList.add('is-selected');
      snapshot();
      const start = { x: ev.clientX, y: ev.clientY, ex: e.x, ey: e.y };
      const move = (m) => {
        e.x = Math.round(start.ex + (m.clientX - start.x) / sc);
        e.y = Math.round(start.ey + (m.clientY - start.y) / sc);
        node.style.left = `${e.x}px`;
        node.style.top = `${e.y}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        ws.schedule();
        renderProps();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    if (e.id === selected) {
      const handle = document.createElement('span');
      handle.className = 'el-resize';
      handle.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        snapshot();
        const start = { x: ev.clientX, y: ev.clientY, w: e.w, h: e.h };
        const move = (m) => {
          e.w = Math.max(40, Math.round(start.w + (m.clientX - start.x) / sc));
          e.h = Math.max(30, Math.round(start.h + (m.clientY - start.y) / sc));
          node.style.width = `${e.w}px`;
          node.style.height = `${e.h}px`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          ws.schedule();
          renderProps();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      node.append(handle);
    }
    return node;
  }

  function render() {
    slideList.textContent = '';
    data.slides.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `slide-thumb${i === index ? ' is-active' : ''}`;
      b.style.background = s.bg || '#101014';
      const no = document.createElement('span');
      no.className = 'slide-thumb-no';
      no.textContent = String(i + 1);
      b.append(no);
      b.title = `Slide ${i + 1}`;
      b.addEventListener('click', () => {
        index = i;
        selected = null;
        render();
      });
      slideList.append(b);
    });

    slideLabel.textContent = `Slide ${index + 1} / ${data.slides.length}`;
    const sc = scaleOf();
    stage.style.width = `${data.w}px`;
    stage.style.height = `${data.h}px`;
    stage.style.transform = `scale(${sc})`;
    stage.style.transformOrigin = 'top left';
    stage.style.background = slide().bg || '#101014';
    stage.textContent = '';
    for (const e of slide().elements || []) stage.append(makeEl(e, sc));
    renderProps();
  }

  function prop(labelText, input) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.className = 'label';
    label.textContent = labelText;
    wrap.append(label, input);
    return wrap;
  }

  function numberInput(value, onChange) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = value;
    inp.addEventListener('change', () => onChange(Number(inp.value) || 0));
    return inp;
  }

  function renderProps() {
    propsBody.textContent = '';
    const s = slide();

    const bgRow = document.createElement('div');
    bgRow.className = 'colorrow';
    const bgLabel = document.createElement('span');
    bgLabel.className = 'label';
    bgLabel.textContent = 'Background';
    const bg = document.createElement('input');
    bg.type = 'color';
    bg.value = s.bg || '#101014';
    bg.addEventListener('input', () => {
      s.bg = bg.value;
      render();
      ws.schedule();
    });
    bgRow.append(bgLabel, bg);
    propsBody.append(bgRow);

    const notes = document.createElement('div');
    notes.className = 'field';
    const nl = document.createElement('label');
    nl.className = 'label';
    nl.textContent = 'Speaker notes';
    const ta = document.createElement('textarea');
    ta.rows = 5;
    ta.value = s.notes || '';
    ta.placeholder = 'Only you see these while presenting.';
    ta.addEventListener('input', () => {
      s.notes = ta.value;
      ws.schedule();
    });
    notes.append(nl, ta);
    propsBody.append(notes);

    const e = current();
    if (e) {
      const heading = document.createElement('div');
      heading.className = 'label';
      heading.textContent = e.type === 'text' ? 'Text element' : e.type === 'image' ? 'Image' : 'Shape';
      propsBody.append(heading);

      if (e.type === 'text') {
        const l = document.createElement('label');
        l.className = 'label';
        l.textContent = 'Text';
        const area = document.createElement('textarea');
        area.rows = 3;
        area.value = e.text || '';
        area.addEventListener('input', () => {
          e.text = area.value;
          render();
          ws.schedule();
        });
        propsBody.append(l, area);

        propsBody.append(prop('Font size', numberInput(e.size || 28, (v) => ((e.size = Math.max(8, v)), render(), ws.schedule()))));
      }

      propsBody.append(
        prop('X', numberInput(Math.round(e.x), (v) => ((e.x = v), render(), ws.schedule()))),
        prop('Y', numberInput(Math.round(e.y), (v) => ((e.y = v), render(), ws.schedule()))),
        prop('Width', numberInput(Math.round(e.w), (v) => ((e.w = Math.max(20, v)), render(), ws.schedule()))),
        prop('Height', numberInput(Math.round(e.h), (v) => ((e.h = Math.max(20, v)), render(), ws.schedule()))),
      );

      const colorRow = document.createElement('div');
      colorRow.className = 'colorrow';
      const cl = document.createElement('span');
      cl.className = 'label';
      cl.textContent = e.type === 'text' ? 'Text colour' : 'Fill';
      const color = document.createElement('input');
      color.type = 'color';
      color.value = e.type === 'text' ? e.color || '#f4f4f5' : e.fill || '#e11d48';
      color.addEventListener('input', () => {
        if (e.type === 'text') e.color = color.value;
        else e.fill = color.value;
        render();
        ws.schedule();
      });
      colorRow.append(cl, color);
      propsBody.append(colorRow);

      const del = document.createElement('button');
      del.className = 'btn btn-danger btn-sm';
      del.type = 'button';
      del.textContent = 'Delete element';
      del.addEventListener('click', () => {
        snapshot();
        slide().elements = slide().elements.filter((x) => x.id !== e.id);
        selected = null;
        render();
        ws.schedule();
      });
      propsBody.append(del);
    }

    const slideActions = document.createElement('div');
    slideActions.className = 'row';
    slideActions.style.gap = '6px';
    const up = document.createElement('button');
    up.className = 'btn btn-quiet btn-sm';
    up.type = 'button';
    up.textContent = '↑ Slide';
    up.addEventListener('click', () => moveSlide(-1));
    const down = document.createElement('button');
    down.className = 'btn btn-quiet btn-sm';
    down.type = 'button';
    down.textContent = '↓ Slide';
    down.addEventListener('click', () => moveSlide(1));
    const dup = document.createElement('button');
    dup.className = 'btn btn-ghost btn-sm';
    dup.type = 'button';
    dup.textContent = 'Duplicate';
    dup.addEventListener('click', () => {
      snapshot();
      const copy = JSON.parse(JSON.stringify(slide()));
      copy.id = 's' + Math.random().toString(36).slice(2, 8);
      copy.elements = copy.elements.map((x) => ({ ...x, id: uid() }));
      data.slides.splice(index + 1, 0, copy);
      index += 1;
      render();
      ws.schedule();
    });
    const del = document.createElement('button');
    del.className = 'btn btn-danger btn-sm';
    del.type = 'button';
    del.textContent = 'Delete slide';
    del.addEventListener('click', () => {
      if (data.slides.length === 1) return window.cascadeToast?.('A deck needs at least one slide', true);
      snapshot();
      data.slides.splice(index, 1);
      index = Math.max(0, index - 1);
      selected = null;
      render();
      ws.schedule();
    });
    slideActions.append(up, down, dup, del);
    propsBody.append(slideActions);
  }

  function moveSlide(dir) {
    const target = index + dir;
    if (target < 0 || target >= data.slides.length) return;
    snapshot();
    const [s] = data.slides.splice(index, 1);
    data.slides.splice(target, 0, s);
    index = target;
    render();
    ws.schedule();
  }

  const ws = window.Workspace.create({
    id: DOC.id,
    kind: 'deck',
    version: DOC.version,
    content: data,
    isPublic: DOC.isPublic,
    filename: DOC.filename,
    apply(content) {
      if (content && Array.isArray(content.slides) && content.slides.length) {
        data.slides = content.slides;
        data.w = content.w || 1280;
        data.h = content.h || 720;
        index = Math.min(index, data.slides.length - 1);
        selected = null;
        render();
      }
    },
    collect() {
      return { w: data.w, h: data.h, slides: data.slides };
    },
  });

  document.getElementById('add-slide').addEventListener('click', () => {
    snapshot();
    data.slides.push({ id: 's' + Math.random().toString(36).slice(2, 8), bg: '#101014', notes: '', elements: [] });
    index = data.slides.length - 1;
    selected = null;
    render();
    ws.schedule();
  });

  document.getElementById('add-text').addEventListener('click', () => {
    snapshot();
    slide().elements.push({
      id: uid(), type: 'text', x: 120, y: 120, w: 700, h: 100,
      text: 'Double-click to edit', size: 40, color: '#f4f4f5', bold: true, align: 'left',
    });
    selected = slide().elements[slide().elements.length - 1].id;
    render();
    ws.schedule();
  });

  document.getElementById('add-rect').addEventListener('click', () => {
    snapshot();
    slide().elements.push({ id: uid(), type: 'rect', x: 200, y: 200, w: 320, h: 200, fill: '#e11d48', radius: 12 });
    selected = slide().elements[slide().elements.length - 1].id;
    render();
    ws.schedule();
  });

  document.getElementById('add-image').addEventListener('click', () => {
    window.CascadeImages?.open({
      onPick({ src, alt, credit }) {
        snapshot();
        slide().elements.push({
          id: uid(), type: 'image', src, alt: alt || '', credit: credit || '', x: 340, y: 160, w: 600, h: 400,
        });
        selected = slide().elements[slide().elements.length - 1].id;
        render();
        ws.schedule();
      },
    });
  });

  document.getElementById('deck-undo').addEventListener('click', undo);
  document.getElementById('deck-redo').addEventListener('click', redo);
  document.getElementById('deck-delete').addEventListener('click', () => {
    const e = current();
    if (!e) return;
    snapshot();
    slide().elements = slide().elements.filter((x) => x.id !== e.id);
    selected = null;
    render();
    ws.schedule();
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const el = current();
      if (!el) return;
      e.preventDefault();
      snapshot();
      slide().elements = slide().elements.filter((x) => x.id !== el.id);
      selected = null;
      render();
      ws.schedule();
    }
    if (e.key === 'ArrowLeft') {
      if (index > 0) { index -= 1; selected = null; render(); }
    }
    if (e.key === 'ArrowRight') {
      if (index < data.slides.length - 1) { index += 1; selected = null; render(); }
    }
  });

  document.getElementById('deck-present').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'present-overlay';
    let currentSlide = index;
    const paint = () => {
      const s = data.slides[currentSlide];
      overlay.textContent = '';
      const box = document.createElement('div');
      box.className = 'present-slide';
      box.style.background = s.bg || '#101014';
      const sc = Math.min(window.innerWidth / data.w, (window.innerHeight - 70) / data.h) * 0.94;
      box.style.width = `${data.w}px`;
      box.style.height = `${data.h}px`;
      box.style.transform = `scale(${sc})`;
      for (const e of s.elements || []) {
        const n = makeEl({ ...e, id: e.id + '-present' }, 1);
        n.classList.remove('is-selected');
        n.style.pointerEvents = 'none';
        box.append(n);
      }
      const nav = document.createElement('div');
      nav.className = 'present-nav';
      nav.textContent = `${currentSlide + 1} / ${data.slides.length} · Esc to exit`;
      overlay.append(box, nav);
    };
    overlay.addEventListener('click', () => {
      if (currentSlide < data.slides.length - 1) {
        currentSlide += 1;
        paint();
      } else {
        overlay.remove();
      }
    });
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      } else if (ev.key === 'ArrowRight' || ev.key === ' ') {
        ev.preventDefault();
        currentSlide = Math.min(data.slides.length - 1, currentSlide + 1);
        paint();
      } else if (ev.key === 'ArrowLeft') {
        currentSlide = Math.max(0, currentSlide - 1);
        paint();
      }
    };
    document.addEventListener('keydown', onKey);
    paint();
    document.body.append(overlay);
  });

  window.addEventListener('resize', () => {
    const sc = scaleOf();
    stage.style.transform = `scale(${sc})`;
  });

  render();
})();
