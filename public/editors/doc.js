/* Document editor: contenteditable rich text, tables, images, header/footer,
   autosave through the shared workspace runtime. */
(function () {
  const DOC = window.__DOC__;
  if (!DOC) return;
  const page = document.getElementById('doc-page');
  const header = document.getElementById('doc-header');
  const footer = document.getElementById('doc-footer');
  const count = document.getElementById('word-count');
  const initial = DOC.content || {};

  page.innerHTML = initial.html || '<h1>Untitled document</h1><p><br></p>';
  header.value = initial.header || '';
  footer.value = initial.footer || '';

  function updateCount() {
    const text = page.innerText.replace(/\s+/g, ' ').trim();
    const words = text ? text.split(' ').length : 0;
    count.textContent = `${words} word${words === 1 ? '' : 's'}`;
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
      updateCount();
    },
    collect() {
      return { html: page.innerHTML, header: header.value, footer: footer.value };
    },
  });

  function changed() {
    updateCount();
    ws.schedule();
  }

  page.addEventListener('input', changed);
  header.addEventListener('input', changed);
  footer.addEventListener('input', changed);

  // Native undo/redo plus the browser's own clipboard shortcuts.
  document.querySelectorAll('#doc-toolbar [data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      page.focus();
      changed();
    });
  });

  const blockStyle = document.getElementById('block-style');
  blockStyle.addEventListener('change', () => {
    document.execCommand('formatBlock', false, `<${blockStyle.value}>`);
    page.focus();
    changed();
  });

  document.getElementById('insert-link').addEventListener('mousedown', (e) => e.preventDefault());
  document.getElementById('insert-link').addEventListener('click', () => {
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:|\/)/i.test(url)) return window.cascadeToast?.('Use http(s):// or a relative path', true);
    document.execCommand('createLink', false, url);
    page.focus();
    changed();
  });

  document.getElementById('insert-table').addEventListener('mousedown', (e) => e.preventDefault());
  document.getElementById('insert-table').addEventListener('click', () => {
    const rows = Math.min(12, Math.max(1, parseInt(window.prompt('Rows', '3'), 10) || 3));
    const cols = Math.min(8, Math.max(1, parseInt(window.prompt('Columns', '3'), 10) || 3));
    let html = '<table><thead><tr>';
    for (let c = 0; c < cols; c++) html += `<th>Header ${c + 1}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows - 1; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += '<td><br></td>';
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    document.execCommand('insertHTML', false, html);
    page.focus();
    changed();
  });

  const imageInput = document.getElementById('doc-image');
  document.getElementById('insert-image').addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return window.cascadeToast?.('Pick an image file', true);
    const body = new FormData();
    body.append('files', file);
    ws.status('Uploading image…');
    try {
      const r = await fetch('/api/upload', { method: 'POST', body });
      const j = await r.json();
      const created = j.files && j.files.find((f) => f.id);
      if (!r.ok || !created) throw new Error(created?.error || 'upload failed');
      document.execCommand('insertHTML', false, `<img src="/f/${created.id}/raw" alt="${file.name}"><p><br></p>`);
      changed();
      ws.status('Saved');
    } catch (err) {
      window.cascadeToast?.(err.message || 'Image upload failed', true);
      ws.status('Upload failed', 'badge-bad');
    } finally {
      imageInput.value = '';
    }
  });

  document.getElementById('toggle-header').addEventListener('click', () => {
    const wrap = page.closest('.doc-page-wrap');
    const show = wrap.classList.toggle('show-hf');
    if (show) header.focus();
  });

  // Keep the document area a clean surface for pasted content.
  page.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      window.cascadeToast?.('Use the Image button to insert pictures');
    }
  });

  updateCount();
})();
