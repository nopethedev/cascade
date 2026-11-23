// Cascade — front-end helpers: drag/drop uploads with progress, share/rename/delete,
// the text editor, toasts and a small dialog to replace alert/confirm/prompt.

// Theme preference is intentionally local to the browser. The inline head
// script applies it before paint to avoid a dark flash on load.
(function initTheme() {
  const root = document.documentElement;
  const key = 'cascade-theme';
  const apply = (theme, persist) => {
    const light = theme === 'light';
    if (light) root.dataset.theme = 'light'; else delete root.dataset.theme;
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.setAttribute('aria-pressed', String(light));
      button.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    });
    if (persist) {
      try { localStorage.setItem(key, light ? 'light' : 'dark'); } catch { /* private mode */ }
    }
  };
  apply(root.dataset.theme === 'light' ? 'light' : 'dark', false);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    apply(root.dataset.theme === 'light' ? 'dark' : 'light', true);
  });
})();

// Native dialogs close on a backdrop click, but not when the pointer is over
// their scrollbar. Checking the dialog rectangle makes scrollbar dragging safe
// and keeps every dialog's close button responsive.
document.addEventListener('click', (event) => {
  const dialog = event.target.closest('dialog');
  if (!dialog || event.target !== dialog) return;
  if (!dialog.classList.contains('share-dlg') && dialog.dataset.backdropClose !== 'true') return;
  const rect = dialog.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outside) dialog.close();
}, true);

// Keep delegated close buttons working for dynamically rendered dialogs too.
document.addEventListener('click', (event) => {
  const button = event.target.closest('dialog [data-close]');
  if (!button) return;
  button.closest('dialog')?.close();
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

let toastTimer;
function toast(message, kind) {
  let el = document.getElementById('cascade-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cascade-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = 'toast is-on' + (kind === 'bad' ? ' is-bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

function ask({ title, message, value, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let dlg = document.getElementById('cascade-dialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'cascade-dialog';
      dlg.className = 'dlg';
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
      <form method="dialog" class="dlg-in">
        <h3 class="dlg-title">${escapeHtml(title)}</h3>
        ${message ? `<p class="dlg-msg">${escapeHtml(message)}</p>` : ''}
        ${value !== undefined ? `<input class="dlg-input" value="${escapeHtml(value)}" />` : ''}
        <div class="dlg-actions">
          <button class="btn btn-quiet" value="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : ''}" value="ok">${escapeHtml(confirm)}</button>
        </div>
      </form>`;
    const input = dlg.querySelector('.dlg-input');
    dlg.addEventListener(
      'close',
      () => {
        const ok = dlg.returnValue === 'ok';
        resolve(ok ? (input ? input.value.trim() : true) : input ? null : false);
      },
      { once: true },
    );
    dlg.returnValue = 'cancel';
    dlg.showModal();
    if (input) {
      input.focus();
      input.select();
    }
  });
}

async function cascadeUpload(form, statusEl) {
  const input = form.querySelector('input[type="file"]');
  const files = input && input.files;
  const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };
  if (!files || !files.length) {
    setStatus('Choose at least one file first.');
    return;
  }
  const fd = new FormData();
  for (const file of files) fd.append('files', file);
  for (const hidden of form.querySelectorAll('input[type="hidden"][name]')) fd.append(hidden.name, hidden.value);
  setStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);

  try {
    const result = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        setStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}… ${Math.round((e.loaded / e.total) * 100)}%`);
      };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error || `upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('network error while uploading'));
      xhr.send(fd);
    });

    const uploaded = result.files || [];
    const failed = uploaded.filter((f) => f.error);
    if (failed.length) {
      setStatus(`Uploaded ${uploaded.length - failed.length}, skipped ${failed.length}.`);
      toast(failed.map((f) => `${f.filename}: ${f.error}`).join(' · '), 'bad');
      return;
    }
    setStatus(`Uploaded ${uploaded.length} file${uploaded.length === 1 ? '' : 's'}.`);
    toast('Upload complete');
    setTimeout(() => location.reload(), 650);
  } catch (err) {
    setStatus('Upload failed.');
    toast(err.message, 'bad');
  }
}

async function cascadeToggleShare(id, isPublic) {
  try {
    const result = await api(`/api/files/${id}/share`, { method: 'POST', body: JSON.stringify({ isPublic }) });
    toast(result.isPublic ? 'File is now public' : 'File is private again');
    setTimeout(() => location.reload(), 350);
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function cascadeDelete(id, name) {
  const ok = await ask({
    title: `Delete “${name}”?`,
    message: 'The file is removed from every replica. This cannot be undone.',
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/files/${id}`, { method: 'DELETE' });
    toast('File deleted');
    setTimeout(() => { location.href = '/'; }, 350);
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function cascadeRename(id, current) {
  const name = await ask({ title: 'Rename file', value: current, confirm: 'Save' });
  if (!name || name === current) return;
  try {
    await api(`/api/files/${id}/rename`, { method: 'POST', body: JSON.stringify({ filename: name }) });
    toast('Renamed');
    setTimeout(() => location.reload(), 350);
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function cascadeCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast('Copied to clipboard');
    } catch {
      toast(text);
    }
    area.remove();
  }
}

let editorId = null;

async function cascadeLoadEditor(id) {
  editorId = id;
  const area = document.getElementById('editor');
  const status = document.getElementById('editor-status');
  if (!area) return;
  if (status) status.textContent = 'Loading…';
  try {
    const result = await api(`/api/files/${id}/text`);
    area.value = result.text;
    if (status) status.textContent = `${result.text.length.toLocaleString()} characters loaded`;
  } catch (err) {
    if (status) status.textContent = `Could not load: ${err.message}`;
  }
}

async function cascadeSaveEditor(id) {
  const area = document.getElementById('editor');
  const status = document.getElementById('editor-status');
  if (!area) return;
  if (status) status.textContent = 'Saving…';
  try {
    const result = await api(`/api/files/${id || editorId}/text`, {
      method: 'PUT',
      body: JSON.stringify({ text: area.value }),
    });
    if (status) status.textContent = `Saved · ${result.size.toLocaleString()} bytes`;
    toast('Changes saved');
  } catch (err) {
    if (status) status.textContent = `Save failed: ${err.message}`;
    toast(err.message, 'bad');
  }
}

// Drag & drop on the upload zone, with a readable "N files selected" label.
function bindDropZones() {
  document.querySelectorAll('[data-drop]').forEach((zone) => {
    const input = zone.querySelector('input[type="file"]');
    const title = zone.querySelector('.drop-title');
    if (!input) return;
    const showSelected = () => {
      const count = input.files ? input.files.length : 0;
      if (title) title.textContent = count ? `${count} file${count > 1 ? 's' : ''} selected` : 'Drop files here';
    };
    ['dragenter', 'dragover'].forEach((type) =>
      zone.addEventListener(type, (e) => {
        e.preventDefault();
        zone.classList.add('is-drag');
      }),
    );
    ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, () => zone.classList.remove('is-drag')));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        showSelected();
      }
    });
    input.addEventListener('change', showSelected);
  });
}

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  if (!e.target.closest || !e.target.closest('[data-drop]')) e.preventDefault();
});

document.addEventListener('DOMContentLoaded', bindDropZones);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    const area = document.getElementById('editor');
    if (area && area === document.activeElement) {
      e.preventDefault();
      cascadeSaveEditor(editorId);
    }
  }
});

window.cascadeUpload = cascadeUpload;
window.cascadeToggleShare = cascadeToggleShare;
window.cascadeDelete = cascadeDelete;
window.cascadeRename = cascadeRename;
window.cascadeCopy = cascadeCopy;
window.cascadeLoadEditor = cascadeLoadEditor;
window.cascadeSaveEditor = cascadeSaveEditor;
window.cascadeToast = toast;
