import { renderSiteBody, siteCss, SECTION_LABELS } from '../site-render.mjs';

const DOC = window.__DOC__;
if (DOC) {
  const canEdit = DOC.canEdit !== false && window.__ACCESS__?.canEdit !== false;
  const host = document.getElementById('site-canvas');
  const wrap = document.getElementById('site-canvas-wrap');
  const layerList = document.getElementById('site-sections');
  const propsBody = document.getElementById('site-props');
  const inspector = document.getElementById('site-inspector');
  const inspectorTitle = document.getElementById('site-inspector-title');
  const deviceLabel = document.getElementById('site-device-label');
  const zoomLabel = document.getElementById('site-zoom-label');
  const addSelect = document.getElementById('site-add-section');

  const data = DOC.content && Array.isArray(DOC.content.sections)
    ? DOC.content
    : {
        brand: 'Your brand',
        sections: [],
        theme: { accent: '#e11d48', bg: '#0b0b10', surface: '#14141b', text: '#f7f7f8', muted: '#a1a1aa', font: 'Inter', radius: 14, maxWidth: 1120 },
        seo: { title: 'Your website', description: '' },
        customCss: '',
      };
  data.theme = data.theme || {};
  data.seo = data.seo || {};
  data.components = Array.isArray(data.components) ? data.components : [];
  data.cmsPreview = [];
  let cmsCollections = [];

  let selected = data.sections[0]?.id || null;
  let device = 'desktop';
  let zoom = 1;
  let history = [];
  let future = [];
  let dragId = null;
  let paintTimer = null;

  const shadow = host.attachShadow({ mode: 'open' });
  const uid = (type) => `${type}-${Math.random().toString(36).slice(2, 8)}`;
  const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function snapshot() {
    if (!canEdit) return;
    history.push(JSON.stringify(data.sections));
    if (history.length > 60) history.shift();
    future.length = 0;
  }
  function undo() {
    if (!canEdit || !history.length) return;
    future.push(JSON.stringify(data.sections));
    data.sections = JSON.parse(history.pop());
    selected = data.sections[0]?.id || null;
    paint();
    renderProps();
    window.Workspace.schedule();
  }
  function redo() {
    if (!canEdit || !future.length) return;
    history.push(JSON.stringify(data.sections));
    data.sections = JSON.parse(future.pop());
    selected = data.sections[0]?.id || null;
    paint();
    renderProps();
    window.Workspace.schedule();
  }

  function defaults(type) {
    const base = (id) => ({ id: id || uid(type), type });
    if (type === 'hero') return { ...base(), eyebrow: 'A new chapter', title: 'A headline worth reading.', text: 'Explain the promise in one or two clear sentences.', ctaLabel: 'Get started', ctaHref: '#contact', align: 'left', style: { paddingY: 110, bg: 'gradient' } };
    if (type === 'features') return { ...base(), title: 'What makes this different', text: '', items: [{ title: 'First feature', text: 'Say what it does and why that matters.' }, { title: 'Second feature', text: 'Keep each point specific and useful.' }, { title: 'Third feature', text: 'Three is usually enough.' }], style: { paddingY: 86 } };
    if (type === 'about') return { ...base(), title: 'A little about us', text: 'Tell the story behind the work.\n\nKeep it human and concrete.', image: '', reverse: false, style: { paddingY: 86 } };
    if (type === 'gallery') return { ...base(), title: 'Selected work', text: '', images: [], style: { paddingY: 86 } };
    if (type === 'testimonials') return { ...base(), title: 'Kind words', items: [{ quote: 'A specific, believable quote goes here.', name: 'Name', role: 'Role, Company' }], style: { paddingY: 86 } };
    if (type === 'logos') return { ...base(), title: 'Trusted by', items: ['Acme', 'Northwind', 'Vertex', 'Kepler'], style: { paddingY: 30 } };
    if (type === 'cta') return { ...base(), title: 'Ready when you are.', text: 'A short nudge and a clear next step.', ctaLabel: 'Get in touch', ctaHref: '#contact', style: { paddingY: 72 } };
    if (type === 'contact') return { ...base(), title: 'Get in touch', text: 'Tell us what you are working on.', email: 'hello@example.com', style: { paddingY: 86 } };
    if (type === 'cms') {
      const collection = cmsCollections[0];
      return { ...base(), eyebrow: 'From the journal', title: collection?.name || 'Latest posts', text: 'Published items are loaded from the site CMS.', collectionId: collection?.id || '', collectionSlug: collection?.slug || '', limit: 6, style: { paddingY: 88 } };
    }
    if (type === 'custom') return { ...base(), title: 'Custom embed', html: '<h2>Your custom content</h2><p>Edit the HTML, CSS and JS in the inspector.</p>', css: '', js: '', style: { paddingY: 40 } };
    return { ...base(), title: SECTION_LABELS[type] || type, style: { paddingY: 60 } };
  }

  function sectionLabel(section) {
    return SECTION_LABELS[section.type] || section.type;
  }

  function selectedSection() {
    return data.sections.find((s) => s.id === selected) || null;
  }

  // ---------------- canvas ----------------
  function paint() {
    // Timers, not requestAnimationFrame: embedded previews and background tabs
    // can pause rAF indefinitely, which would leave the canvas blank.
    if (paintTimer) clearTimeout(paintTimer);
    paintTimer = setTimeout(() => {
      paintTimer = null;
      const max = device === 'mobile' ? 390 : device === 'tablet' ? 834 : Math.max(900, Number(data.theme.maxWidth) || 1120);
      host.style.width = device === 'desktop' ? `${max}px` : `${max}px`;
      host.style.maxWidth = '100%';
      host.style.setProperty('--site-canvas-bg', data.theme.bg || '#0b0b10');
      host.style.zoom = String(zoom);
      shadow.innerHTML = `<style>
        :host { display:block; background:${data.theme.bg || '#0b0b10'}; color:${data.theme.text || '#f7f7f8'}; overflow:hidden; }
        ${siteCss(data)}
        .cs-site { min-height: 70vh; }
        [data-section-id] { position:relative; cursor:pointer; outline:1px solid transparent; outline-offset:-1px; transition:outline-color .12s; }
        [data-section-id]:hover { outline:1px dashed color-mix(in srgb, var(--cs-accent) 62%, transparent); }
        [data-section-id].is-selected { outline:2px solid var(--cs-accent); outline-offset:-2px; }
        [data-section-id].is-selected::after { content:attr(data-section-type); position:absolute; left:8px; top:8px; z-index:40; background:var(--cs-accent); color:white; font:700 8px/1 ui-monospace,monospace; letter-spacing:.08em; text-transform:uppercase; padding:4px 6px; border-radius:3px; pointer-events:none; }
        [data-section-id].is-dragging { opacity:.42; }
        [data-section-id].is-drop-target { outline:2px dashed var(--cs-accent); }
        .cs-form input, .cs-form textarea { pointer-events:none; }
      </style>${renderSiteBody(data, { preview: true, cmsItems: data.cmsPreview })}`;

      for (const section of shadow.querySelectorAll('[data-section-id]')) {
        if (section.dataset.sectionId === selected) section.classList.add('is-selected');
        if (!canEdit) continue;
        section.setAttribute('draggable', 'true');
        section.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selected = section.dataset.sectionId;
          paint();
          renderProps();
          renderLayers();
          if (window.matchMedia('(max-width: 1100px)').matches) inspector.classList.add('is-open');
        });
        section.addEventListener('dragstart', (e) => {
          dragId = section.dataset.sectionId;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', dragId);
          section.classList.add('is-dragging');
        });
        section.addEventListener('dragend', () => {
          dragId = null;
          section.classList.remove('is-dragging');
          shadow.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
        });
        section.addEventListener('dragover', (e) => {
          if (!dragId || dragId === section.dataset.sectionId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          section.classList.add('is-drop-target');
        });
        section.addEventListener('dragleave', () => section.classList.remove('is-drop-target'));
        section.addEventListener('drop', (e) => {
          e.preventDefault();
          section.classList.remove('is-drop-target');
          if (!dragId || dragId === section.dataset.sectionId) return;
          reorderBefore(dragId, section.dataset.sectionId);
        });
      }
      updateCanvasLabels();
    });
  }

  function reorderBefore(sourceId, targetId) {
    if (!canEdit) return;
    snapshot();
    const from = data.sections.findIndex((s) => s.id === sourceId);
    const to = data.sections.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [item] = data.sections.splice(from, 1);
    const nextIndex = data.sections.findIndex((s) => s.id === targetId);
    data.sections.splice(nextIndex < 0 ? data.sections.length : nextIndex, 0, item);
    paint();
    renderLayers();
    window.Workspace.schedule();
  }

  function moveSection(id, dir) {
    if (!canEdit) return;
    snapshot();
    const i = data.sections.findIndex((s) => s.id === id);
    const target = i + dir;
    if (i < 0 || target < 0 || target >= data.sections.length) return;
    const [item] = data.sections.splice(i, 1);
    data.sections.splice(target, 0, item);
    paint();
    renderLayers();
    window.Workspace.schedule();
  }

  function deleteSection(id) {
    if (!canEdit) return;
    snapshot();
    data.sections = data.sections.filter((s) => s.id !== id);
    selected = data.sections[0]?.id || null;
    paint();
    renderLayers();
    renderProps();
    window.Workspace.schedule();
  }

  function addSection(type, at = null) {
    if (!canEdit) return;
    if (type.startsWith('component:')) {
      const component = data.components[Number(type.split(':')[1])];
      if (!component) return;
      snapshot();
      const section = JSON.parse(JSON.stringify(component.section));
      section.id = uid(section.type);
      data.sections.splice(at ?? Math.max(0, data.sections.length - 1), 0, section);
      selected = section.id;
      paint();
      renderLayers();
      renderProps();
      window.Workspace.schedule();
      return;
    }
    const section = defaults(type);
    snapshot();
    const insertAt = at ?? Math.max(0, data.sections.length - (data.sections.at(-1)?.type === 'footer' ? 1 : 0));
    data.sections.splice(insertAt, 0, section);
    selected = section.id;
    paint();
    renderLayers();
    renderProps();
    window.Workspace.schedule();
  }

  function updateCanvasLabels() {
    const labels = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
    if (deviceLabel) deviceLabel.textContent = `${labels[device]} · ${Math.round(zoom * 100)}%`;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  // ---------------- layers ----------------
  function renderLayers() {
    if (!layerList) return;
    layerList.textContent = '';
    data.sections.forEach((section, i) => {
      const row = document.createElement('div');
      row.className = `site-layer${section.id === selected ? ' is-active' : ''}`;
      row.draggable = canEdit;
      row.dataset.id = section.id;
      row.innerHTML = `<span class="site-layer-grip" aria-hidden="true">⠿</span>
        <span class="site-layer-name"><strong>${sectionLabel(section)}</strong><small>${section.id.slice(0, 8)}</small></span>
        <span class="site-layer-tools"><button type="button" data-layer-up="${section.id}" aria-label="Move up">↑</button><button type="button" data-layer-down="${section.id}" aria-label="Move down">↓</button><button type="button" data-layer-delete="${section.id}" aria-label="Delete section">×</button></span>`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        selected = section.id;
        paint();
        renderLayers();
        renderProps();
        if (window.matchMedia('(max-width: 1100px)').matches) inspector.classList.add('is-open');
      });
      row.addEventListener('dragstart', (e) => {
        dragId = section.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', section.id);
      });
      row.addEventListener('dragover', (e) => {
        if (!dragId || dragId === section.id) return;
        e.preventDefault();
        row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('is-drop-target');
        if (dragId && dragId !== section.id) reorderBefore(dragId, section.id);
      });
      row.querySelector('[data-layer-up]')?.addEventListener('click', (e) => { e.stopPropagation(); moveSection(section.id, -1); });
      row.querySelector('[data-layer-down]')?.addEventListener('click', (e) => { e.stopPropagation(); moveSection(section.id, 1); });
      row.querySelector('[data-layer-delete]')?.addEventListener('click', (e) => { e.stopPropagation(); deleteSection(section.id); });
      layerList.append(row);
    });
    refreshAddSelect();
  }

  function refreshAddSelect() {
    if (!addSelect) return;
    addSelect.querySelectorAll('option[data-component]').forEach((o) => o.remove());
    data.components.forEach((component, i) => {
      const option = document.createElement('option');
      option.value = `component:${i}`;
      option.dataset.component = '1';
      option.textContent = `Component · ${component.name}`;
      addSelect.append(option);
    });
  }

  // ---------------- inspector helpers ----------------
  function prop(label, input) {
    const wrapEl = document.createElement('div');
    wrapEl.className = 'field';
    const l = document.createElement('label');
    l.className = 'label';
    l.textContent = label;
    wrapEl.append(l, input);
    return wrapEl;
  }
  function textInput(value, onChange, placeholder = '') {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.placeholder = placeholder;
    input.addEventListener('focus', () => { snapshot(); }, { once: true });
    input.addEventListener('change', () => { onChange(input.value); paint(); window.Workspace.schedule(); });
    return input;
  }
  function areaInput(value, onChange, rows = 3) {
    const area = document.createElement('textarea');
    area.rows = rows;
    area.value = value || '';
    area.addEventListener('change', () => { snapshot(); onChange(area.value); paint(); window.Workspace.schedule(); });
    return area;
  }
  function numberInput(value, onChange, opts = {}) {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = value;
    if (opts.min !== undefined) input.min = opts.min;
    if (opts.max !== undefined) input.max = opts.max;
    input.addEventListener('change', () => { snapshot(); onChange(Number(input.value) || 0); paint(); window.Workspace.schedule(); });
    return input;
  }
  function select(value, options, onChange) {
    const sel = document.createElement('select');
    for (const [key, label] of Object.entries(options)) {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = label;
      o.selected = String(value) === String(key);
      sel.append(o);
    }
    sel.addEventListener('change', () => { snapshot(); onChange(sel.value); paint(); renderProps(); window.Workspace.schedule(); });
    return sel;
  }
  function colorInput(value, onChange) {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = value || '#ffffff';
    input.addEventListener('input', () => { onChange(input.value); paint(); window.Workspace.schedule(); });
    input.addEventListener('change', () => renderProps());
    return input;
  }
  function block(title) {
    const box = document.createElement('section');
    box.className = 'site-prop-section';
    const h = document.createElement('div');
    h.className = 'side-label';
    h.textContent = title;
    box.append(h);
    return box;
  }
  function button(label, onClick, cls = 'btn btn-ghost btn-sm') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
  function row(...children) {
    const r = document.createElement('div');
    r.className = 'row';
    r.style.gap = '5px';
    r.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
    return r;
  }
  function linksEditor(items, onChange) {
    const box = document.createElement('div');
    box.className = 'repeater';
    (items || []).forEach((item, i) => {
      const r = document.createElement('div');
      r.className = 'repeater-row';
      const label = textInput(item.label, (v) => { item.label = v; onChange(); paint(); window.Workspace.schedule(); }, 'Label');
      const link = textInput(item.href, (v) => { item.href = v; onChange(); paint(); window.Workspace.schedule(); }, '#anchor');
      const remove = button('×', () => { items.splice(i, 1); onChange(); renderProps(); }, 'btn btn-quiet btn-sm');
      r.append(label, link, remove);
      box.append(r);
    });
    box.append(button('+ Add link', () => {
      items.push({ label: 'New link', href: '#' });
      snapshot();
      onChange();
      paint();
      window.Workspace.schedule();
      renderProps();
    }, 'btn btn-quiet btn-sm'));
    return box;
  }
  function itemsEditor(items, fields, make) {
    const box = document.createElement('div');
    box.className = 'repeater';
    (items || []).forEach((item, i) => {
      const r = document.createElement('div');
      r.className = 'repeater-card';
      for (const [key, label] of fields) {
        r.append(prop(label, textInput(item[key], (v) => {
          item[key] = v;
          paint();
          window.Workspace.schedule();
        }, label)));
      }
      r.append(button('Remove', () => { items.splice(i, 1); renderProps(); paint(); window.Workspace.schedule(); }, 'btn btn-quiet btn-sm'));
      box.append(r);
    });
    box.append(button('+ Add item', () => { items.push(make()); renderProps(); paint(); window.Workspace.schedule(); }, 'btn btn-ghost btn-sm'));
    return box;
  }

  // ---------------- inspector ----------------
  function renderProps() {
    if (!propsBody) return;
    propsBody.textContent = '';
    const section = selectedSection();
    inspectorTitle.textContent = section ? sectionLabel(section) : 'Site design';

    if (section) {
      const contentWrap = document.createElement('section');
      contentWrap.className = 'site-prop-section';
      contentWrap.append(sectionTitleBar(section));

      if (section.type === 'nav') {
        contentWrap.append(
          prop('Brand', textInput(section.brand, (v) => { section.brand = v; data.brand = v; })),
          prop('Links', linksEditor(section.links || (section.links = []), () => paint())),
          prop('Button label', textInput(section.ctaLabel, (v) => { section.ctaLabel = v; })),
          prop('Button link', textInput(section.ctaHref, (v) => { section.ctaHref = v; })),
        );
      } else if (section.type === 'hero') {
        contentWrap.append(
          prop('Eyebrow', textInput(section.eyebrow, (v) => { section.eyebrow = v; }, 'Small label above the title')),
          prop('Headline', areaInput(section.title, (v) => { section.title = v; }, 2)),
          prop('Body text', areaInput(section.text, (v) => { section.text = v; }, 3)),
          prop('Alignment', select(section.align || 'left', { left: 'Left', center: 'Center' }, (v) => { section.align = v; })),
          prop('Primary button', textInput(section.ctaLabel, (v) => { section.ctaLabel = v; })),
          prop('Primary link', textInput(section.ctaHref, (v) => { section.ctaHref = v; })),
          prop('Secondary button', textInput(section.secondaryLabel, (v) => { section.secondaryLabel = v; })),
          prop('Secondary link', textInput(section.secondaryHref, (v) => { section.secondaryHref = v; })),
          row(button(section.image ? 'Change hero image' : '+ Hero image', chooseImage((src, alt) => { section.image = src; section.imageAlt = alt || section.imageAlt || ''; }), 'btn btn-ghost btn-sm'), section.image ? button('Remove image', () => { delete section.image; paint(); renderProps(); window.Workspace.schedule(); }, 'btn btn-quiet btn-sm') : null),
        );
      } else if (section.type === 'features') {
        contentWrap.append(
          prop('Title', textInput(section.title, (v) => { section.title = v; })),
          prop('Intro', areaInput(section.text, (v) => { section.text = v; }, 2)),
          prop('Items', itemsEditor(section.items || (section.items = []), [['title', 'Title'], ['text', 'Description']], () => ({ title: 'New feature', text: '' }))),
        );
      } else if (section.type === 'about') {
        contentWrap.append(
          prop('Title', textInput(section.title, (v) => { section.title = v; })),
          prop('Text', areaInput(section.text, (v) => { section.text = v; }, 6)),
          prop('Image side', select(section.reverse ? 'left' : 'right', { right: 'Image right', left: 'Image left' }, (v) => { section.reverse = v === 'left'; })),
          row(button(section.image ? 'Change image' : '+ Image', chooseImage((src, alt) => { section.image = src; section.imageAlt = alt || section.imageAlt || ''; }), 'btn btn-ghost btn-sm'), section.image ? button('Remove', () => { delete section.image; paint(); renderProps(); window.Workspace.schedule(); }, 'btn btn-quiet btn-sm') : null),
        );
      } else if (section.type === 'gallery') {
        contentWrap.append(
          prop('Title', textInput(section.title, (v) => { section.title = v; })),
          prop('Intro', areaInput(section.text, (v) => { section.text = v; }, 2)),
        );
        const images = section.images || (section.images = []);
        const gallery = document.createElement('div');
        gallery.className = 'site-image-list';
        images.forEach((img, i) => {
          const card = document.createElement('div');
          card.className = 'site-image-row';
          card.innerHTML = `<img src="${String(img.src).replace(/[&<>"]/g, '')}" alt="" /><input value="${String(img.alt || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" aria-label="Image alt text" /><button type="button" class="btn btn-quiet btn-sm">×</button>`;
          card.querySelector('input').addEventListener('change', (e) => { img.alt = e.target.value; paint(); window.Workspace.schedule(); });
          card.querySelector('button').addEventListener('click', () => { images.splice(i, 1); paint(); renderProps(); window.Workspace.schedule(); });
          gallery.append(card);
        });
        contentWrap.append(gallery, button('+ Add images', () => {
          window.CascadeImages?.open({
            onPick({ src, alt }) {
              images.push({ src, alt: alt || '' });
              paint();
              renderProps();
              window.Workspace.schedule();
            },
          });
        }, 'btn btn-ghost btn-sm'));
      } else if (section.type === 'testimonials') {
        contentWrap.append(
          prop('Title', textInput(section.title, (v) => { section.title = v; })),
          prop('Quotes', itemsEditor(section.items || (section.items = []), [['quote', 'Quote'], ['name', 'Name'], ['role', 'Role / company']], () => ({ quote: '', name: '', role: '' }))),
        );
      } else if (section.type === 'logos') {
        contentWrap.append(
          prop('Title', textInput(section.title, (v) => { section.title = v; })),
          prop('Names', areaInput((section.items || []).join('\n'), (v) => { section.items = v.split('\n').map((x) => x.trim()).filter(Boolean); }, 4)),
        );
      } else if (section.type === 'cta') {
        contentWrap.append(
          prop('Title', textInput(section.title, (v) => { section.title = v; })),
          prop('Text', areaInput(section.text, (v) => { section.text = v; }, 2)),
          prop('Button label', textInput(section.ctaLabel, (v) => { section.ctaLabel = v; })),
          prop('Button link', textInput(section.ctaHref, (v) => { section.ctaHref = v; })),
        );
      } else if (section.type === 'contact') {
        contentWrap.append(
          prop('Title', textInput(section.title, (v) => { section.title = v; })),
          prop('Text', areaInput(section.text, (v) => { section.text = v; }, 3)),
          prop('Email', textInput(section.email, (v) => { section.email = v; }, 'hello@example.com')),
        );
        const note = document.createElement('p');
        note.className = 'side-note';
        note.textContent = 'Submissions are stored in SQLite and appear in the form responses for this site.';
        contentWrap.append(note);
      } else if (section.type === 'footer') {
        contentWrap.append(
          prop('Text', textInput(section.text, (v) => { section.text = v; })),
          prop('Links', linksEditor(section.links || (section.links = []), () => paint())),
        );
      } else if (section.type === 'cms') {
        const collectionOptions = Object.fromEntries(cmsCollections.map((c) => [c.id, c.name]));
        contentWrap.append(
          prop('Collection', select(section.collectionId || '', { '': 'Choose a collection…', ...collectionOptions }, (v) => {
            const collection = cmsCollections.find((c) => c.id === v);
            section.collectionId = v;
            section.collectionSlug = collection?.slug || '';
            section.title = collection?.name || section.title;
          })),
          prop('Eyebrow', textInput(section.eyebrow, (v) => { section.eyebrow = v; }, 'Small label')),
          prop('Title', textInput(section.title, (v) => { section.title = v; })),
          prop('Intro', areaInput(section.text, (v) => { section.text = v; }, 2)),
          prop('Items to show', numberInput(section.limit ?? 6, (v) => { section.limit = Math.max(1, Math.min(24, v)); }, { min: 1, max: 24 })),
          row(button('Manage CMS content', openCms, 'btn btn-ghost btn-sm')),
        );
      } else if (section.type === 'custom') {
        contentWrap.append(
          prop('HTML', areaInput(section.html, (v) => { section.html = v; }, 6)),
          prop('CSS', areaInput(section.css, (v) => { section.css = v; }, 4)),
          prop('JavaScript', areaInput(section.js, (v) => { section.js = v; }, 4)),
        );
        const note = document.createElement('p');
        note.className = 'side-note';
        note.textContent = 'Runs inside a sandboxed iframe and cannot access Cascade or your session.';
        contentWrap.append(note);
      }

      const style = section.style || (section.style = {});
      const styleBox = block('Section style');
      styleBox.append(
        prop('Vertical padding', numberInput(style.paddingY ?? 80, (v) => { style.paddingY = Math.max(0, Math.min(260, v)); }, { min: 0, max: 260 })),
        prop('Background', select(style.bg || 'plain', { plain: 'Theme background', gradient: 'Accent gradient', custom: 'Custom colour' }, (v) => {
          style.bg = v;
          if (v === 'custom' && !style.bgColor) style.bgColor = data.theme.surface;
          renderProps();
        })),
      );
      if (style.bg === 'custom') styleBox.append(prop('Background colour', colorInput(style.bgColor, (v) => { style.bgColor = v; })));
      styleBox.append(
        prop('Text alignment', select(style.align || 'left', { left: 'Left', center: 'Center', right: 'Right' }, (v) => { style.align = v; })),
        prop('Entrance animation', select(section.animation || 'none', { none: 'None', 'cs-rise': 'Fade up' }, (v) => { section.animation = v; })),
      );
      contentWrap.append(styleBox);
      propsBody.append(contentWrap);
    }

    // Site-wide design tokens and SEO.
    const themeBox = block('Site design tokens');
    const theme = data.theme;
    themeBox.append(
      prop('Brand', textInput(data.brand, (v) => { data.brand = v; })),
      prop('Accent', colorInput(theme.accent, (v) => { theme.accent = v; })),
      prop('Background', colorInput(theme.bg, (v) => { theme.bg = v; })),
      prop('Surface', colorInput(theme.surface, (v) => { theme.surface = v; })),
      prop('Text', colorInput(theme.text, (v) => { theme.text = v; })),
      prop('Muted text', colorInput(theme.muted, (v) => { theme.muted = v; })),
      prop('Font', textInput(theme.font, (v) => { theme.font = v; }, 'Inter')),
      prop('Corner radius', numberInput(theme.radius ?? 14, (v) => { theme.radius = Math.max(0, Math.min(40, v)); }, { min: 0, max: 40 })),
      prop('Content width', numberInput(theme.maxWidth ?? 1120, (v) => { theme.maxWidth = Math.max(720, Math.min(1440, v)); }, { min: 720, max: 1440 })),
    );
    const seoBox = block('SEO & social sharing');
    seoBox.append(
      prop('Page title', textInput(data.seo.title, (v) => { data.seo.title = v; })),
      prop('Description', areaInput(data.seo.description, (v) => { data.seo.description = v; }, 3)),
      row(button(data.seo.ogImage ? 'Change social image' : '+ Social image', chooseImage((src) => { data.seo.ogImage = src; }), 'btn btn-ghost btn-sm'), data.seo.ogImage ? button('Remove', () => { delete data.seo.ogImage; renderProps(); window.Workspace.schedule(); }, 'btn btn-quiet btn-sm') : null),
      prop('Custom CSS', areaInput(data.customCss, (v) => { data.customCss = v; }, 5)),
    );
    propsBody.append(themeBox, seoBox);
    if (data.components.length) {
      const components = block('Reusable components');
      components.append(button('Save current section as component', saveComponent, 'btn btn-ghost btn-sm'));
      propsBody.append(components);
    }
  }

  function sectionTitleBar(section) {
    const bar = document.createElement('div');
    bar.className = 'site-section-title';
    bar.innerHTML = `<span class="badge badge-accent">${sectionLabel(section)}</span><span class="hint">${section.id}</span>`;
    const tools = document.createElement('div');
    tools.className = 'row';
    tools.style.gap = '3px';
    tools.append(
      button('↑', () => moveSection(section.id, -1), 'btn btn-quiet btn-sm'),
      button('↓', () => moveSection(section.id, 1), 'btn btn-quiet btn-sm'),
      button('Duplicate', () => {
        snapshot();
        const copy = JSON.parse(JSON.stringify(section));
        copy.id = uid(section.type);
        const at = data.sections.findIndex((s) => s.id === section.id) + 1;
        data.sections.splice(at, 0, copy);
        selected = copy.id;
        paint();
        renderLayers();
        renderProps();
        window.Workspace.schedule();
      }, 'btn btn-quiet btn-sm'),
      button('Delete', () => deleteSection(section.id), 'btn btn-danger btn-sm'),
    );
    bar.append(tools);
    return bar;
  }

  async function loadCms() {
    try {
      const r = await fetch(`/api/workspace/docs/${DOC.id}/cms`);
      if (!r.ok) return;
      const j = await r.json();
      cmsCollections = j.collections || [];
      data.cmsPreview = cmsCollections.flatMap((c) => (c.items || []).filter((i) => i.status === 'published').map((i) => ({ ...i, collectionSlug: c.slug })));
      if (selectedSection()?.type === 'cms') renderProps();
      paint();
    } catch { /* CMS is optional for an offline preview */ }
  }

  function chooseImage(onPick) {
    return () => {
      window.CascadeImages?.open({
        onPick({ src, alt }) {
          snapshot();
          onPick(src, alt);
          paint();
          renderProps();
          window.Workspace.schedule();
        },
      });
    };
  }

  function saveComponent() {
    const section = selectedSection();
    if (!section) return;
    const name = window.prompt('Component name', section.title || sectionLabel(section));
    if (!name) return;
    data.components.push({ id: uid('component'), name: name.slice(0, 60), section: JSON.parse(JSON.stringify(section)) });
    refreshAddSelect();
    window.Workspace.schedule();
    window.cascadeToast?.('Component saved — add it from the section menu');
  }

  // ---------------- CMS and deployments ----------------
  async function cmsJson(url, options = {}) {
    const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Request failed');
    return body;
  }

  function cmsDialog() {
    let dlg = document.getElementById('site-cms-dialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'site-cms-dialog';
      dlg.className = 'dlg dlg-wide';
      dlg.innerHTML = `<div class="dlg-in"><div class="row-between"><div><h3 class="dlg-title">CMS collections</h3><p class="dlg-msg">Content is stored in SQLite and rendered through the same site renderer. Publish an item to make it visible.</p></div><button class="btn btn-quiet btn-sm" type="button" data-close>Close</button></div><div id="site-cms-body"></div><form id="site-cms-new" class="site-cms-new"><input name="name" placeholder="Collection name, e.g. Journal" maxlength="80" required /><button class="btn btn-sm" type="submit">Create collection</button></form></div>`;
      document.body.append(dlg);
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
      dlg.querySelector('#site-cms-new').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = new FormData(e.target).get('name');
        try {
          await cmsJson(`/api/workspace/docs/${DOC.id}/cms/collections`, { method: 'POST', body: JSON.stringify({ name, fields: [{ id: 'title', label: 'Title', type: 'text' }, { id: 'excerpt', label: 'Excerpt', type: 'text' }, { id: 'body', label: 'Body', type: 'richtext' }, { id: 'image', label: 'Image', type: 'image' }] }) });
          e.target.reset();
          await openCms();
        } catch (err) { window.cascadeToast?.(err.message, true); }
      });
    }
    return dlg;
  }

  async function openCms() {
    const dlg = cmsDialog();
    if (!dlg.open) dlg.showModal();
    const body = dlg.querySelector('#site-cms-body');
    body.textContent = 'Loading…';
    try {
      const { collections } = await cmsJson(`/api/workspace/docs/${DOC.id}/cms`);
      cmsCollections = collections;
      body.textContent = '';
      if (!collections.length) {
        body.innerHTML = '<p class="hint">No collections yet. Create one to start publishing dynamic pages.</p>';
        return;
      }
      for (const collection of collections) {
        const card = document.createElement('section');
        card.className = 'site-cms-collection';
        card.innerHTML = `<div class="row-between"><div><strong>${esc(collection.name)}</strong><small class="hint">/c/${esc(collection.slug)} · ${collection.items.length} items</small></div><button class="btn btn-ghost btn-sm" type="button" data-add-item="${collection.id}">+ Add item</button></div><div class="site-cms-items">${collection.items.map((item) => `<div class="site-cms-item"><span><strong>${esc(item.data.title || item.data.name || item.slug)}</strong><small>${esc(item.slug)} · ${esc(item.status)}</small></span><span class="row"><button class="btn btn-quiet btn-sm" type="button" data-toggle-item="${collection.id}:${item.id}">${item.status === 'published' ? 'Unpublish' : 'Publish'}</button><button class="btn btn-danger btn-sm" type="button" data-delete-item="${collection.id}:${item.id}">×</button></span></div>`).join('') || '<p class="hint">No items yet.</p>'}</div>`;
        card.querySelector('[data-add-item]').addEventListener('click', async () => {
          const title = window.prompt('Item title', 'A new story');
          if (!title) return;
          try {
            await cmsJson(`/api/workspace/docs/${DOC.id}/cms/collections/${collection.id}/items`, { method: 'POST', body: JSON.stringify({ data: { title, excerpt: 'A short summary for the card.', body: 'Start writing the story here.\n\nUse a blank line for a new paragraph.' }, status: 'published' }) });
            await openCms();
            await loadCms();
          } catch (err) { window.cascadeToast?.(err.message, true); }
        });
        card.querySelectorAll('[data-toggle-item]').forEach((b) => b.addEventListener('click', async () => {
          const [collectionId, itemId] = b.dataset.toggleItem.split(':');
          const item = collection.items.find((i) => i.id === itemId);
          try {
            await cmsJson(`/api/workspace/docs/${DOC.id}/cms/collections/${collectionId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ status: item.status === 'published' ? 'draft' : 'published' }) });
            await openCms();
            await loadCms();
          } catch (err) { window.cascadeToast?.(err.message, true); }
        }));
        card.querySelectorAll('[data-delete-item]').forEach((b) => b.addEventListener('click', async () => {
          if (!window.confirm('Delete this CMS item?')) return;
          const [collectionId, itemId] = b.dataset.deleteItem.split(':');
          try {
            await cmsJson(`/api/workspace/docs/${DOC.id}/cms/collections/${collectionId}/items/${itemId}`, { method: 'DELETE' });
            await openCms();
            await loadCms();
          } catch (err) { window.cascadeToast?.(err.message, true); }
        }));
        body.append(card);
      }
      if (selectedSection()?.type === 'cms') renderProps();
    } catch (err) {
      body.textContent = err.message;
    }
  }

  async function openDeployments() {
    let dlg = document.getElementById('site-deployments-dialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'site-deployments-dialog';
      dlg.className = 'dlg dlg-wide';
      dlg.innerHTML = '<div class="dlg-in"><div class="row-between"><div><h3 class="dlg-title">Deployments</h3><p class="dlg-msg">Production publishes and staging previews are immutable snapshots. Restore any version with one click.</p></div><button class="btn btn-quiet btn-sm" type="button" data-close>Close</button></div><div id="site-deployments-body">Loading…</div></div>';
      document.body.append(dlg);
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', async (e) => {
        const rollback = e.target.closest('[data-rollback]');
        if (!rollback) return;
        if (!window.confirm('Restore this deployment? The current draft is saved in history first.')) return;
        try {
          const out = await cmsJson(`/api/workspace/docs/${DOC.id}/deployments/${rollback.dataset.rollback}/rollback`, { method: 'POST' });
          window.cascadeToast?.(`Restored v${out.deployment.version}`);
          location.reload();
        } catch (err) { window.cascadeToast?.(err.message, true); }
      });
    }
    dlg.showModal();
    const body = dlg.querySelector('#site-deployments-body');
    try {
      const { deployments } = await cmsJson(`/api/workspace/docs/${DOC.id}/deployments`);
      body.textContent = '';
      if (!deployments.length) { body.innerHTML = '<p class="hint">No deployments yet. Publish the site to create the first production snapshot.</p>'; return; }
      for (const d of deployments) {
        const row = document.createElement('div');
        row.className = 'site-deployment-row';
        row.innerHTML = `<span class="badge ${d.environment === 'production' ? 'badge-accent' : ''}">${esc(d.environment)}</span><span><strong>v${d.version}</strong><small>${esc(d.label || '')}</small></span><span class="hint">${new Date(d.createdAt).toLocaleString()}</span><button class="btn btn-ghost btn-sm" type="button" data-rollback="${d.id}">Restore</button>`;
        body.append(row);
      }
    } catch (err) { body.textContent = err.message; }
  }

  document.getElementById('site-cms-btn')?.addEventListener('click', openCms);
  document.getElementById('site-deployments-btn')?.addEventListener('click', openDeployments);
  document.getElementById('site-stage-btn')?.addEventListener('click', async () => {
    try {
      await window.Workspace.saveNow(true);
      const out = await cmsJson(`/api/workspace/docs/${DOC.id}/deployments/staging`, { method: 'POST', body: JSON.stringify({}) });
      window.open(out.previewUrl, '_blank', 'noopener');
      window.cascadeToast?.('Staging preview created');
    } catch (err) { window.cascadeToast?.(err.message, true); }
  });

  // ---------------- publish / exports ----------------
  const publishBtn = document.getElementById('btn-site-publish');
  const publishMobileBtn = document.getElementById('btn-site-publish-mobile');
  const publishedBar = document.getElementById('site-published-bar');
  const publicLink = document.getElementById('site-public-link');
  const visit = document.getElementById('site-visit');

  function showPublished(show) {
    if (!publishedBar) return;
    publishedBar.hidden = !show;
    if (visit) {
      visit.hidden = !show;
      if (show) {
        visit.href = `/sites/${DOC.slug}`;
        publicLink.href = `${location.origin}/sites/${DOC.slug}`;
        publicLink.textContent = `/sites/${DOC.slug}`;
      }
    }
  }

  function openPublishDialog() {
    let dlg = document.getElementById('site-publish-dialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'site-publish-dialog';
      dlg.className = 'dlg';
      dlg.innerHTML = `<form class="dlg-in" method="dialog">
        <div><h3 class="dlg-title">Publish website</h3><p class="dlg-msg">Your page goes live with SEO metadata and a sitemap. You can unpublish at any time.</p></div>
        <div class="field"><label class="label" for="site-domain">Custom domain <span class="faint">(optional)</span></label><input id="site-domain" placeholder="www.example.com" maxlength="255" /></div>
        <p class="hint">Point an A/CNAME record at this server and terminate HTTPS at your proxy. The Host header is matched to the domain you enter.</p>
        <div class="dlg-actions"><button class="btn btn-quiet" value="cancel" type="button" data-close>Cancel</button><button class="btn" value="publish" id="site-publish-confirm">Publish</button></div>
      </form>`;
      document.body.append(dlg);
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
      dlg.querySelector('#site-publish-confirm').addEventListener('click', async (e) => {
        e.preventDefault();
        const domain = dlg.querySelector('#site-domain').value.trim();
        try {
          const result = await fetch(`/api/workspace/docs/${DOC.id}/publish`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content: data, customDomain: domain || null }),
          });
          const body = await result.json().catch(() => ({}));
          if (!result.ok) throw new Error(body.error || 'Could not publish');
          DOC.publishedAt = body.publishedAt;
          DOC.slug = body.slug;
          DOC.customDomain = body.customDomain;
          showPublished(true);
          dlg.close();
          window.cascadeToast?.('Website published');
        } catch (err) {
          window.cascadeToast?.(err.message, true);
        }
      });
    }
    showPublished(!!DOC.publishedAt);
    dlg.showModal();
  }

  publishBtn?.addEventListener('click', openPublishDialog);
  publishMobileBtn?.addEventListener('click', () => {
    publishMobileBtn.closest('details')?.removeAttribute('open');
    openPublishDialog();
  });
  document.getElementById('site-copy-link')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(`${location.origin}/sites/${DOC.slug}`).then(() => window.cascadeToast?.('Link copied')).catch(() => {});
  });
  document.getElementById('site-stats-btn')?.addEventListener('click', async () => {
    let dlg = document.getElementById('site-stats-dialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'site-stats-dialog';
      dlg.className = 'dlg';
      dlg.innerHTML = '<div class="dlg-in"><h3 class="dlg-title">Website analytics</h3><div id="site-stats-body" class="share-live">Loading…</div><div class="dlg-actions"><button class="btn btn-quiet" type="button" data-close>Close</button></div></div>';
      document.body.append(dlg);
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    }
    dlg.showModal();
    const body = dlg.querySelector('#site-stats-body');
    try {
      const r = await fetch(`/api/workspace/docs/${DOC.id}/site-stats`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load stats');
      body.textContent = '';
      for (const [letter, value, note] of [
        ['V', `${Number(j.views || 0).toLocaleString()} views`, 'Page visits recorded since publishing'],
        ['F', `${Number(j.submissions || 0).toLocaleString()} form responses`, 'Stored locally in SQLite'],
      ]) {
        const row = document.createElement('div');
        row.className = 'share-person';
        const avatar = document.createElement('span');
        avatar.className = 'share-avatar';
        avatar.textContent = letter;
        const main = document.createElement('span');
        main.className = 'share-person-main';
        const strong = document.createElement('strong');
        strong.textContent = value;
        const small = document.createElement('small');
        small.textContent = note;
        main.append(strong, small);
        row.append(avatar, main);
        body.append(row);
      }
      const link = document.createElement('p');
      link.className = 'hint';
      link.textContent = j.customDomain ? `Custom domain: ${j.customDomain}` : `Public URL: /sites/${j.slug}`;
      body.append(link);
    } catch (err) {
      body.textContent = err.message;
    }
  });

  document.getElementById('site-unpublish')?.addEventListener('click', async () => {
    try {
      const r = await fetch(`/api/workspace/docs/${DOC.id}/unpublish`, { method: 'POST', headers: { 'content-type': 'application/json' } });
      if (!r.ok) throw new Error('Could not unpublish');
      DOC.publishedAt = null;
      showPublished(false);
      window.cascadeToast?.('Website unpublished');
    } catch (err) {
      window.cascadeToast?.(err.message, true);
    }
  });

  for (const link of [document.getElementById('site-export-html'), document.getElementById('site-export-react')]) {
    link?.addEventListener('click', async (e) => {
      e.preventDefault();
      await window.Workspace.saveNow(true);
      location.href = link.href;
    });
  }

  // ---------------- workspace ----------------
  const ws = window.Workspace.create({
    id: DOC.id,
    kind: 'site',
    version: DOC.version,
    content: data,
    isPublic: DOC.isPublic,
    filename: DOC.filename,
    canEdit,
    apply(content) {
      if (!content || !Array.isArray(content.sections)) return;
      data.sections = content.sections;
      data.brand = content.brand || data.brand;
      data.theme = content.theme || data.theme;
      data.seo = content.seo || data.seo;
      data.customCss = content.customCss || '';
      data.components = Array.isArray(content.components) ? content.components : [];
      if (!data.sections.some((s) => s.id === selected)) selected = data.sections[0]?.id || null;
      paint();
      renderLayers();
      renderProps();
    },
    collect() {
      return {
        brand: data.brand,
        sections: data.sections,
        theme: data.theme,
        seo: data.seo,
        customCss: data.customCss,
        components: data.components,
      };
    },
  });

  // Toolbar.
  document.getElementById('site-undo')?.addEventListener('click', undo);
  document.getElementById('site-redo')?.addEventListener('click', redo);
  addSelect?.addEventListener('change', () => {
    if (!addSelect.value) return;
    addSection(addSelect.value);
    addSelect.value = '';
  });
  document.getElementById('site-add-section-btn')?.addEventListener('click', () => addSelect?.focus());
  document.getElementById('site-save-component')?.addEventListener('click', saveComponent);
  document.querySelectorAll('[data-device]').forEach((btn) => btn.addEventListener('click', () => {
    device = btn.dataset.device;
    document.querySelectorAll('[data-device]').forEach((b) => b.classList.toggle('is-active', b === btn));
    paint();
  }));
  const setZoom = (z) => { zoom = Math.max(0.25, Math.min(1.6, z)); paint(); };
  document.getElementById('site-zoom-in')?.addEventListener('click', () => setZoom(zoom + 0.1));
  document.getElementById('site-zoom-out')?.addEventListener('click', () => setZoom(zoom - 0.1));
  document.getElementById('site-zoom-fit')?.addEventListener('click', () => {
    const available = (wrap?.clientWidth || 1000) - 44;
    zoom = Math.min(1, available / (Number(data.theme.maxWidth) || 1120));
    paint();
  });
  document.getElementById('site-inspector-close')?.addEventListener('click', () => inspector?.classList.remove('is-open'));

  window.addEventListener('resize', () => {
    // Keep the phone preview usable when the device is rotated.
    if (device === 'desktop') paint();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      deleteSection(selected);
    }
  });

  showPublished(!!DOC.publishedAt);
  if (DOC.slug) {
    publicLink.href = `${location.origin}/sites/${DOC.slug}`;
    publicLink.textContent = `/sites/${DOC.slug}`;
    visit.href = `/sites/${DOC.slug}`;
  }
  renderLayers();
  paint();
  renderProps();
  loadCms();
}
