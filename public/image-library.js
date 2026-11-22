/* Shared image picker: the signed-in user's uploads plus keyless Wikimedia
   Commons search. The editor decides where the returned image goes. */
(function () {
  let dialog = null;
  let onPick = null;
  let ownLoaded = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setStatus(text, bad) {
    const el = dialog.querySelector('[data-image-status]');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-bad', !!bad);
  }

  function tile(src, title, sub, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-tile';
    const img = document.createElement('img');
    img.src = src;
    img.alt = title || '';
    img.loading = 'lazy';
    button.append(img);
    const name = document.createElement('span');
    name.className = 'image-tile-title';
    name.textContent = title || 'Image';
    button.append(name);
    if (sub) {
      const meta = document.createElement('span');
      meta.className = 'image-tile-sub';
      meta.textContent = sub;
      button.append(meta);
    }
    button.addEventListener('click', onClick);
    return button;
  }

  function empty(text) {
    const p = document.createElement('p');
    p.className = 'hint image-empty';
    p.textContent = text;
    return p;
  }

  async function loadOwn() {
    const grid = dialog.querySelector('[data-image-own]');
    grid.replaceChildren(empty('Loading your images…'));
    try {
      const r = await fetch('/api/files?limit=200');
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not load your files');
      const images = (j.files || []).filter((f) => String(f.mime || '').startsWith('image/') && (f.kind || 'file') === 'file');
      grid.replaceChildren();
      if (!images.length) {
        grid.append(empty('No uploaded images yet. Use “Upload” to add one, or search online.'));
        return;
      }
      for (const f of images) {
        grid.append(
          tile(`/f/${f.id}/raw`, f.filename, `${Math.max(1, Math.round(Number(f.size || 0) / 1024))} KB`, () => {
            finish({ src: `/f/${f.id}/raw`, alt: f.filename || 'Image', credit: '' });
          }),
        );
      }
    } catch (err) {
      grid.replaceChildren(empty(err.message || 'Could not load your images.'));
    }
  }

  async function normalizeImage(file) {
    if (!file.type || !file.type.startsWith('image/')) throw new Error('Pick an image file');
    if (file.type === 'image/png' || file.type === 'image/jpeg') return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert image'))), 'image/png'));
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
  }

  async function uploadImage(file, alt, credit) {
    const prepared = await normalizeImage(file);
    const body = new FormData();
    body.append('files', prepared);
    const r = await fetch('/api/upload', { method: 'POST', body });
    const j = await r.json().catch(() => ({}));
    const created = (j.files || []).find((f) => f.id);
    if (!r.ok || !created) throw new Error(created?.error || j.error || 'Upload failed');
    return { src: `/f/${created.id}/raw`, alt: alt || prepared.name, credit: credit || '' };
  }

  function finish(value) {
    const fn = onPick;
    dialog.close();
    onPick = null;
    if (fn) {
      try {
        fn(value);
      } catch (err) {
        window.cascadeToast?.(err.message || 'Could not insert image', true);
      }
    }
  }

  async function importSearchResult(result) {
    setStatus('Adding image…');
    try {
      const r = await fetch(result.thumb);
      if (!r.ok) throw new Error('Could not download that image');
      const blob = await r.blob();
      const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' })[blob.type] || 'jpg';
      const file = new File([blob], `${result.title || 'commons-image'}.${ext}`, { type: blob.type || 'image/jpeg' });
      const picked = await uploadImage(file, result.title, result.credit);
      finish(picked);
    } catch (err) {
      setStatus(err.message || 'Could not add that image.', true);
    }
  }

  async function search(query) {
    const grid = dialog.querySelector('[data-image-search]');
    const status = dialog.querySelector('[data-image-search-status]');
    grid.replaceChildren();
    status.textContent = 'Searching Wikimedia Commons…';
    try {
      const r = await fetch(`/api/images/search?q=${encodeURIComponent(query)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Search failed');
      const results = j.results || [];
      status.classList.remove('is-bad');
      status.textContent = results.length
        ? `${results.length} free images from ${j.provider}. Check the license and source before publishing.`
        : 'No images found. Try a broader search.';
      if (!results.length) return;
      for (const item of results) {
        const sub = `${item.artist || 'Unknown'} · ${item.license || 'See source'}`;
        const button = tile(item.thumb, item.title, sub, () => importSearchResult(item));
        button.title = `${item.title}\n${item.credit}\n${item.source}`;
        grid.append(button);
      }
    } catch (err) {
      status.textContent = err.message || 'Search failed.';
      status.classList.add('is-bad');
    }
  }

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'dlg image-dlg';
    dialog.id = 'cascade-image-library';
    dialog.innerHTML = `
      <div class="image-dlg-head">
        <div>
          <h3 class="dlg-title">Image library</h3>
          <p class="hint">Pick one of your uploads or search free images online.</p>
        </div>
        <button class="btn btn-quiet btn-sm" type="button" data-image-close>Close</button>
      </div>
      <div class="image-tabs" role="tablist">
        <button class="image-tab is-active" type="button" role="tab" data-image-tab="own">Your images</button>
        <button class="image-tab" type="button" role="tab" data-image-tab="search">Search online</button>
      </div>
      <section class="image-pane" data-image-pane="own">
        <div class="image-actions">
          <label class="btn btn-ghost btn-sm">Upload image<input type="file" accept="image/*" data-image-upload hidden /></label>
          <span class="hint" data-image-status></span>
        </div>
        <div class="image-grid" data-image-own></div>
      </section>
      <section class="image-pane" data-image-pane="search" hidden>
        <form class="image-search" data-image-search-form>
          <input class="input" type="search" placeholder="Search free images, e.g. mountain lake" maxlength="80" required data-image-query />
          <button class="btn btn-sm" type="submit">Search</button>
        </form>
        <p class="hint" data-image-search-status>Powered by Wikimedia Commons. Images keep their source license.</p>
        <div class="image-grid" data-image-search></div>
      </section>`;
    document.body.append(dialog);

    dialog.querySelector('[data-image-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.querySelectorAll('[data-image-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.imageTab === 'own'));
    });
    dialog.querySelectorAll('[data-image-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.dataset.imageTab;
        dialog.querySelectorAll('[data-image-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.imageTab === tab));
        dialog.querySelectorAll('[data-image-pane]').forEach((pane) => { pane.hidden = pane.dataset.imagePane !== tab; });
        if (tab === 'own' && !ownLoaded) {
          ownLoaded = true;
          loadOwn();
        }
      });
    });

    dialog.querySelector('[data-image-upload]').addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      setStatus('Uploading image…');
      try {
        finish(await uploadImage(file));
      } catch (err) {
        setStatus(err.message || 'Upload failed', true);
      }
    });

    dialog.querySelector('[data-image-search-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = dialog.querySelector('[data-image-query]');
      const query = input.value.trim();
      if (query.length >= 2) search(query);
    });
  }

  window.CascadeImages = {
    open(options = {}) {
      if (!dialog) build();
      onPick = options.onPick || null;
      if (!dialog.open) dialog.showModal();
      dialog.querySelectorAll('[data-image-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.imageTab === 'own'));
      dialog.querySelectorAll('[data-image-pane]').forEach((pane) => { pane.hidden = pane.dataset.imagePane !== 'own'; });
      setStatus('');
      ownLoaded = true;
      loadOwn();
      dialog.querySelector('[data-image-close]')?.focus();
    },
  };
})();
