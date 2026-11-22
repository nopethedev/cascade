// Cascade front-end helpers (upload with progress, share toggles, editor).
async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `request failed (${r.status})`);
  }
  return r.json();
}

window.cascadeUpload = async function (form, statusEl) {
  const files = form.querySelector('input[type=file]').files;
  if (!files.length) return;
  statusEl.textContent = `Uploading ${files.length} file(s)…`;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const j = await r.json();
  if (!r.ok) {
    statusEl.textContent = 'Upload failed: ' + (j.error || r.status);
    return;
  }
  statusEl.textContent = 'Done: ' + j.files.map((f) => f.error ? `${f.filename} (${f.error})` : f.filename).join(', ');
  setTimeout(() => location.reload(), 800);
};

window.cascadeToggleShare = async function (id, isPublic) {
  await api(`/api/files/${id}/share`, { method: 'POST', body: JSON.stringify({ isPublic }) });
  location.reload();
};

window.cascadeDelete = async function (id, name) {
  if (!confirm(`Delete ${name}?`)) return;
  await api(`/api/files/${id}`, { method: 'DELETE' });
  location.reload();
};

window.cascadeRename = async function (id, current) {
  const name = prompt('Rename file:', current);
  if (!name || name === current) return;
  await api(`/api/files/${id}/rename`, { method: 'POST', body: JSON.stringify({ filename: name }) });
  location.reload();
};

window.cascadeCopy = function (text) {
  navigator.clipboard.writeText(text).then(() => alert('Copied:\n' + text));
};

window.cascadeLoadEditor = async function (id) {
  const box = document.getElementById('editor-box');
  const area = document.getElementById('editor');
  box.style.display = 'block';
  area.value = 'Loading…';
  try {
    const j = await api(`/api/files/${id}/text`);
    area.value = j.text;
  } catch (e) {
    area.value = 'Could not load: ' + e.message;
  }
};

window.cascadeSaveEditor = async function (id) {
  const area = document.getElementById('editor');
  const status = document.getElementById('editor-status');
  status.textContent = 'Saving…';
  try {
    const j = await api(`/api/files/${id}/text`, { method: 'PUT', body: JSON.stringify({ text: area.value }) });
    status.textContent = `Saved (${j.size} bytes).`;
  } catch (e) {
    status.textContent = 'Save failed: ' + e.message;
  }
};
