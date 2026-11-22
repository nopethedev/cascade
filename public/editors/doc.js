/* Document editor: contenteditable rich text, tables, images, header/footer,
   autosave through the shared workspace runtime. */
(function () {
  const DOC = window.__DOC__;
  if (!DOC) return;
  const $ = (id) => document.getElementById(id);
  const page = $('doc-page');
  const header = $('doc-header');
  const footer = $('doc-footer');
  const count = $('word-count');
  const initial = DOC.content || {};
  let selectedImage = null;
  let savedRange = null;

  page.innerHTML = initial.html || '<h1>Untitled document</h1><p><br></p>';
  header.value = initial.header || '';
  footer.value = initial.footer || '';

  function updateCount() {
    const text = page.innerText.replace(/\s+/g, ' ').trim();
    const words = text ? text.split(' ').length : 0;
    count.textContent = `${words} word${words === 1 ? '' : 's'}`;
  }

  function renderOutline() {
    const outline = $('doc-outline');
    if (!outline) return;
    outline.replaceChildren();
    const headings = [...page.querySelectorAll('h1, h2, h3')];
    if (!headings.length) {
      const empty = document.createElement('span');
      empty.className = 'empty';
      empty.textContent = 'Add a heading to build an outline.';
      outline.append(empty);
      return;
    }
    for (const heading of headings) {
      if (!heading.id) heading.id = `doc-section-${Math.random().toString(36).slice(2, 9)}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.level = heading.tagName.slice(1);
      button.textContent = heading.textContent.trim() || 'Untitled section';
      button.title = button.textContent;
      button.addEventListener('click', () => {
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        heading.focus({ preventScroll: true });
      });
      outline.append(button);
    }
  }

  function rememberSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && page.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    if (!savedRange || !page.contains(savedRange.commonAncestorContainer)) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  function wrapSelection(styles) {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    Object.assign(span.style, styles);
    try {
      range.surroundContents(span);
    } catch {
      span.append(range.extractContents());
      range.insertNode(span);
    }
    const next = document.createRange();
    next.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(next);
    rememberSelection();
    changed();
  }

  const ws = window.Workspace.create({
    id: DOC.id,
    kind: 'doc',
    version: DOC.version,
    content: initial,
    isPublic: DOC.isPublic,
    filename: DOC.filename,
    apply(content) {
      page.innerHTML = (content && content.html) || '<p><br></p>';
      header.value = (content && content.header) || '';
      footer.value = (content && content.footer) || '';
      selectedImage = null;
      hideImageTools();
      updateCount();
      renderOutline();
    },
    collect() {
      return { html: page.innerHTML, header: header.value, footer: footer.value };
    },
  });

  function changed() {
    updateCount();
    renderOutline();
    ws.schedule();
  }

  function hideImageTools() {
    const tools = $('image-tools');
    if (tools) tools.hidden = true;
    page.querySelectorAll('img.is-selected').forEach((img) => img.classList.remove('is-selected'));
    selectedImage = null;
  }

  function figureFor(img) {
    return img?.closest('figure') || null;
  }

  function captionFor(img) {
    return figureFor(img)?.querySelector('figcaption') || null;
  }

  function selectImage(img) {
    hideImageTools();
    selectedImage = img;
    img.classList.add('is-selected');
    const tools = $('image-tools');
    if (tools) tools.hidden = false;
    const alt = $('image-alt');
    const caption = $('image-caption');
    if (alt) alt.value = img.getAttribute('alt') || '';
    if (caption) caption.value = captionFor(img)?.textContent || '';
  }

  function addCaption(figure, text) {
    let caption = figure.querySelector('figcaption');
    if (!text) {
      caption?.remove();
      return;
    }
    if (!caption) {
      caption = document.createElement('figcaption');
      figure.append(caption);
    }
    caption.textContent = text;
  }

  function insertFigure(picked) {
    const figure = document.createElement('figure');
    figure.dataset.align = 'center';
    const img = document.createElement('img');
    img.src = picked.src;
    img.alt = picked.alt || '';
    figure.append(img);
    if (picked.credit) {
      const caption = document.createElement('figcaption');
      caption.textContent = picked.credit;
      figure.append(caption);
    }
    const tail = document.createElement('p');
    tail.append(document.createElement('br'));
    page.focus();
    restoreSelection();
    let anchor = null;
    try {
      const start = savedRange?.startContainer;
      const el = start?.nodeType === 1 ? start : start?.parentElement;
      anchor = el?.closest?.('figure,p,h1,h2,h3,h4,h5,h6,li,blockquote,table,pre') || null;
    } catch {
      anchor = null;
    }
    if (anchor && anchor !== page && page.contains(anchor)) anchor.after(figure, tail);
    else page.append(figure, tail);
    savedRange = null;
    selectImage(img);
    changed();
  }

  function insertImage() {
    window.CascadeImages?.open({
      onPick(picked) {
        insertFigure(picked);
      },
    });
  }

  function insertTable() {
    const rows = Math.min(12, Math.max(1, parseInt(window.prompt('Rows', '3'), 10) || 3));
    const cols = Math.min(8, Math.max(1, parseInt(window.prompt('Columns', '3'), 10) || 3));
    let html = '<table><thead><tr>';
    for (let c = 0; c < cols; c += 1) html += `<th>Header ${c + 1}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows - 1; r += 1) {
      html += '<tr>';
      for (let c = 0; c < cols; c += 1) html += '<td><br></td>';
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    page.focus();
    restoreSelection();
    document.execCommand('insertHTML', false, html);
    changed();
  }

  function insertLink() {
    restoreSelection();
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:|\/)/i.test(url)) {
      window.cascadeToast?.('Use http(s):// or a relative path', true);
      return;
    }
    page.focus();
    restoreSelection();
    document.execCommand('createLink', false, url);
    changed();
  }

  page.addEventListener('input', changed);
  header.addEventListener('input', changed);
  footer.addEventListener('input', changed);
  document.addEventListener('selectionchange', rememberSelection);

  document.querySelectorAll('#doc-toolbar [data-cmd]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      restoreSelection();
      document.execCommand(button.dataset.cmd, false, null);
      page.focus();
      changed();
    });
  });

  $('block-style')?.addEventListener('change', (event) => {
    restoreSelection();
    document.execCommand('formatBlock', false, `<${event.target.value}>`);
    page.focus();
    changed();
  });

  $('font-family')?.addEventListener('change', (event) => {
    if (event.target.value) wrapSelection({ fontFamily: event.target.value });
    event.target.value = '';
  });

  $('font-size')?.addEventListener('change', (event) => {
    if (event.target.value) wrapSelection({ fontSize: event.target.value });
    event.target.value = '';
  });

  $('text-color')?.addEventListener('input', (event) => {
    restoreSelection();
    document.execCommand('foreColor', false, event.target.value);
    changed();
  });

  $('highlight-color')?.addEventListener('input', (event) => {
    restoreSelection();
    document.execCommand('hiliteColor', false, event.target.value);
    changed();
  });

  $('clear-format')?.addEventListener('mousedown', (event) => event.preventDefault());
  $('clear-format')?.addEventListener('click', () => {
    restoreSelection();
    document.execCommand('removeFormat', false, null);
    page.focus();
    changed();
  });

  $('insert-link')?.addEventListener('mousedown', (event) => {
    event.preventDefault();
    rememberSelection();
  });
  $('insert-link')?.addEventListener('click', insertLink);
  $('insert-table')?.addEventListener('mousedown', (event) => event.preventDefault());
  $('insert-table')?.addEventListener('click', insertTable);
  $('insert-image')?.addEventListener('mousedown', (event) => {
    event.preventDefault();
    rememberSelection();
  });
  $('insert-image')?.addEventListener('click', insertImage);
  $('insert-rule')?.addEventListener('mousedown', (event) => event.preventDefault());
  $('insert-rule')?.addEventListener('click', () => {
    restoreSelection();
    page.focus();
    document.execCommand('insertHTML', false, '<hr><p><br></p>');
    changed();
  });

  $('toggle-header')?.addEventListener('click', () => {
    const wrap = page.closest('.doc-page-wrap');
    const show = wrap.classList.toggle('show-hf');
    if (show) header.focus();
  });

  page.addEventListener('click', (event) => {
    const img = event.target.closest('img');
    if (img && page.contains(img)) {
      event.preventDefault();
      selectImage(img);
    } else if (!event.target.closest('figure')) {
      hideImageTools();
    }
  });

  $('image-alt')?.addEventListener('input', (event) => {
    if (!selectedImage) return;
    selectedImage.alt = event.target.value;
    changed();
  });

  $('image-caption')?.addEventListener('input', (event) => {
    if (!selectedImage) return;
    addCaption(figureFor(selectedImage), event.target.value);
    changed();
  });

  document.querySelectorAll('[data-image-width]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!selectedImage) return;
      selectedImage.style.width = button.dataset.imageWidth;
      selectedImage.style.height = 'auto';
      changed();
    });
  });

  document.querySelectorAll('[data-image-align]').forEach((button) => {
    button.addEventListener('click', () => {
      const figure = figureFor(selectedImage);
      if (!figure) return;
      figure.dataset.align = button.dataset.imageAlign;
      changed();
    });
  });

  $('image-remove')?.addEventListener('click', () => {
    const figure = figureFor(selectedImage);
    if (!figure) return;
    figure.remove();
    hideImageTools();
    changed();
  });

  const click = (id) => $(id)?.click();
  $('side-insert-image')?.addEventListener('click', insertImage);
  $('side-image-library')?.addEventListener('click', insertImage);
  $('side-insert-table')?.addEventListener('click', insertTable);
  $('side-insert-link')?.addEventListener('click', insertLink);
  $('side-insert-rule')?.addEventListener('click', () => click('insert-rule'));
  $('side-versions')?.addEventListener('click', () => click('btn-versions'));
  $('side-share')?.addEventListener('click', () => click('btn-share'));
  $('side-template')?.addEventListener('click', () => click('btn-save-template'));

  page.addEventListener('drop', (event) => {
    if (event.dataTransfer?.files?.length) {
      event.preventDefault();
      window.cascadeToast?.('Use the Image button to insert pictures');
    }
  });

  document.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      insertLink();
    }
  });

  updateCount();
  renderOutline();
})();
