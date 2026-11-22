/* Create page: gallery filtering + document creation dialog. */
(function () {
  const grid = document.getElementById('tpl-grid');
  if (!grid) return;
  const cards = [...grid.querySelectorAll('.tpl')];
  const empty = document.getElementById('tpl-empty');
  const count = document.getElementById('tpl-count');
  const search = document.getElementById('tpl-search');
  const dlg = document.getElementById('create-dlg');
  const form = document.getElementById('create-form');
  const nameInput = document.getElementById('new-name');
  const folderSelect = document.getElementById('new-folder');
  const kindInput = document.getElementById('new-kind');
  const templateInput = document.getElementById('new-template');
  const title = document.getElementById('dlg-title');
  const submit = document.getElementById('create-submit');

  let kind = '';
  let category = '';
  let query = '';

  function apply() {
    let shown = 0;
    for (const card of cards) {
      const match =
        (!kind || card.dataset.kind === kind) &&
        (!category || card.dataset.category === category) &&
        (!query ||
          (card.dataset.name + ' ' + card.dataset.category + ' ' + card.dataset.label).toLowerCase().includes(query));
      card.hidden = !match;
      if (match) shown += 1;
    }
    empty.hidden = shown !== 0;
    count.textContent = `${shown} template${shown === 1 ? '' : 's'}`;
  }

  document.querySelectorAll('#kind-filter .filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      kind = btn.dataset.kind;
      document.querySelectorAll('#kind-filter .filter').forEach((b) => b.classList.toggle('is-active', b === btn));
      apply();
    });
  });
  document.querySelectorAll('#category-filter .filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      category = btn.dataset.category;
      document.querySelectorAll('#category-filter .filter').forEach((b) => b.classList.toggle('is-active', b === btn));
      apply();
    });
  });
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    apply();
  });

  function openDialog(card) {
    kindInput.value = card.dataset.kind;
    templateInput.value = card.dataset.template;
    title.textContent = `New ${(card.dataset.label || 'document').toLowerCase()}`;
    nameInput.value = card.dataset.name === 'Blank document' || card.dataset.name.startsWith('Blank') ? '' : `${card.dataset.name}`;
    nameInput.placeholder = card.dataset.name;
    dlg.showModal();
    setTimeout(() => nameInput.focus(), 40);
  }

  const previewDialog = document.getElementById('template-preview-dialog');
  const previewFrame = document.getElementById('template-preview-frame');
  const previewTitle = document.getElementById('template-preview-title');
  const previewUse = document.getElementById('template-preview-use');
  let previewCard = null;

  function openPreview(card) {
    if (!previewDialog || !previewFrame) return openDialog(card);
    previewCard = card;
    previewTitle.textContent = `${card.dataset.name} preview`;
    previewFrame.src = `/template-preview/${encodeURIComponent(card.dataset.template)}`;
    previewDialog.showModal();
  }

  cards.forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-preview]')) return;
      openDialog(card);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('[data-preview]')) return;
      e.preventDefault();
      openDialog(card);
    });
    const previewButton = card.querySelector('[data-preview]');
    previewButton?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPreview(card);
    });
    previewButton?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      openPreview(card);
    });
  });
  document.getElementById('template-preview-close')?.addEventListener('click', () => previewDialog?.close());
  previewUse?.addEventListener('click', () => {
    if (!previewCard) return;
    previewDialog.close();
    openDialog(previewCard);
  });
  previewDialog?.addEventListener('click', (e) => {
    if (e.target === previewDialog) previewDialog.close();
  });
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });

  document.getElementById('add-folder').addEventListener('click', async () => {
    const input = document.getElementById('new-folder-name');
    const name = input.value.trim();
    if (!name) return;
    const r = await fetch('/api/workspace/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return window.cascadeToast?.(j.error || 'Could not create folder', true);
    const opt = document.createElement('option');
    opt.value = j.folder.id;
    opt.textContent = j.folder.name;
    folderSelect.append(opt);
    folderSelect.value = j.folder.id;
    input.value = '';
    window.cascadeToast?.('Folder created');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Creating…';
    try {
      const r = await fetch('/api/workspace/docs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: kindInput.value,
          templateId: templateInput.value || null,
          name: nameInput.value.trim() || null,
          folderId: folderSelect.value || null,
          isPublic: document.getElementById('new-public').checked,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error || 'Could not create the file');
      location.href = j.url;
    } catch (err) {
      submit.disabled = false;
      submit.textContent = 'Create & open';
      window.cascadeToast?.(err.message, true);
    }
  });

  const initialKind = new URLSearchParams(location.search).get('kind');
  if (initialKind) {
    const btn = document.querySelector(`#kind-filter [data-kind="${initialKind}"]`);
    if (btn) btn.click();
  }
  apply();
})();
