/* Clean unified file manager: mixed folders/files, multi-select, drag-to-folder,
   move/copy/rename/delete and folder management. */
(function () {
  const root = document.getElementById('file-manager');
  if (!root) return;
  const body = document.getElementById('fm-body');
  const selectAll = document.getElementById('fm-select-all');
  const selectionBar = document.getElementById('fm-selection');
  const selectedCount = document.getElementById('fm-selected-count');
  const countEl = document.getElementById('fm-count');
  const folderDialog = document.getElementById('fm-folder-dialog');
  const folderForm = document.getElementById('fm-folder-form');
  const folderName = document.getElementById('fm-folder-name');
  const folderTitle = document.getElementById('fm-folder-title');
  const folderSave = document.getElementById('fm-folder-save');
  const placeDialog = document.getElementById('fm-place-dialog');
  const placeForm = document.getElementById('fm-place-form');
  const placeTitle = document.getElementById('fm-place-title');
  const placeMsg = document.getElementById('fm-place-msg');
  const placeSave = document.getElementById('fm-place-save');
  const destination = document.getElementById('fm-destination');
  const fileInput = document.getElementById('fm-file-input');
  const uploadForm = document.getElementById('fm-upload');
  const uploadStatus = document.getElementById('fm-upload-status');
  const dragHint = document.getElementById('fm-drop-hint');
  let folderMode = 'create';
  let folderEditId = null;
  let placeMode = 'move';
  let placeIds = [];
  let draggingIds = [];

  const selectedItems = () =>
    [...document.querySelectorAll('.fm-select:checked')].map((input) => ({
      id: input.dataset.id,
      kind: input.dataset.kind,
      name: input.dataset.name,
    }));

  function refreshSelection() {
    const items = selectedItems();
    const files = items.filter((i) => i.kind === 'file');
    document.querySelectorAll('.fm-row').forEach((row) => {
      const box = row.querySelector('.fm-select');
      row.classList.toggle('is-selected', !!box?.checked);
    });
    if (selectedCount) selectedCount.textContent = String(items.length);
    if (selectionBar) selectionBar.hidden = items.length === 0;
    if (countEl) {
      const total = document.querySelectorAll('.fm-row[data-file-id], .fm-row[data-folder-id]').length;
      countEl.textContent = items.length ? `${items.length} of ${total} selected` : `${total} item${total === 1 ? '' : 's'}`;
    }
    if (selectAll) {
      const boxes = [...document.querySelectorAll('.fm-select')];
      selectAll.checked = boxes.length > 0 && boxes.every((b) => b.checked);
      selectAll.indeterminate = boxes.some((b) => b.checked) && !selectAll.checked;
    }
    // Folders cannot be moved/copied in bulk through the file endpoints.
    document.querySelectorAll('[data-bulk="move"], [data-bulk="copy"]').forEach((b) => {
      b.disabled = files.length === 0;
      b.title = files.length === 0 ? 'Select files to move or copy' : '';
    });
  }

  document.addEventListener('click', (e) => {
    document.querySelectorAll('.fm-row-menu[open], .fm-menu[open]').forEach((menu) => {
      if (!menu.contains(e.target)) menu.open = false;
    });
  });

  body?.addEventListener('change', (e) => {
    if (e.target.classList.contains('fm-select')) refreshSelection();
  });
  selectAll?.addEventListener('change', () => {
    document.querySelectorAll('.fm-select').forEach((box) => {
      box.checked = selectAll.checked;
    });
    refreshSelection();
  });

  document.querySelectorAll('[data-bulk]').forEach((button) => {
    button.addEventListener('click', async () => {
      const items = selectedItems();
      const files = items.filter((i) => i.kind === 'file');
      if (!files.length) return window.cascadeToast?.('Select at least one file', true);
      if (button.dataset.bulk === 'delete') {
        const ok = await ask({
          title: `Delete ${files.length} file${files.length === 1 ? '' : 's'}?`,
          message: 'The files are removed from every replica. This cannot be undone.',
          confirm: 'Delete',
          danger: true,
        });
        if (!ok) return;
        let failed = 0;
        for (const item of files) {
          try {
            await api(`/api/files/${item.id}`, { method: 'DELETE' });
          } catch {
            failed += 1;
          }
        }
        window.cascadeToast?.(failed ? `${failed} file(s) could not be deleted` : 'Files deleted', failed > 0);
        if (!failed) setTimeout(() => location.reload(), 300);
        return;
      }
      openPlaceDialog(button.dataset.bulk, files.map((f) => f.id));
    });
  });

  function openPlaceDialog(mode, ids) {
    placeMode = mode;
    placeIds = ids;
    placeTitle.textContent = mode === 'copy' ? 'Copy files' : 'Move files';
    placeMsg.textContent = mode === 'copy'
      ? 'Choose where the copies should go. The originals stay where they are.'
      : 'Choose a destination folder. You can also drag files onto a folder in the list.';
    placeSave.textContent = mode === 'copy' ? 'Copy here' : 'Move here';
    placeDialog.showModal();
  }

  placeForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    placeSave.disabled = true;
    const folderId = destination.value || null;
    let failed = 0;
    try {
      for (const id of placeIds) {
        try {
          await api(`/api/files/${id}/${placeMode === 'copy' ? 'copy' : 'move'}`, {
            method: 'POST',
            body: JSON.stringify({ folderId, ...(placeMode === 'copy' ? { keepFolder: false } : {}) }),
          });
        } catch {
          failed += 1;
        }
      }
      placeDialog.close();
      window.cascadeToast?.(failed ? `${failed} item(s) failed` : placeMode === 'copy' ? 'Copied' : 'Moved', failed > 0);
      if (!failed) setTimeout(() => location.reload(), 300);
    } finally {
      placeSave.disabled = false;
    }
  });

  function openFolderDialog(mode, folder) {
    folderMode = mode;
    folderEditId = folder?.id || null;
    folderTitle.textContent = mode === 'rename' ? 'Rename folder' : 'New folder';
    folderSave.textContent = mode === 'rename' ? 'Save name' : 'Create folder';
    folderName.value = folder?.name || '';
    folderDialog.showModal();
    setTimeout(() => {
      folderName.focus();
      folderName.select();
    }, 40);
  }

  document.getElementById('fm-new-folder')?.addEventListener('click', () => openFolderDialog('create'));
  document.getElementById('fm-folder-menu')?.addEventListener('click', () => openFolderDialog('create'));
  document.getElementById('fm-empty-folder')?.addEventListener('click', () => openFolderDialog('create'));

  folderForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = folderName.value.trim();
    if (!name) return;
    folderSave.disabled = true;
    try {
      if (folderMode === 'rename') {
        await api(`/api/folders/${folderEditId}/rename`, { method: 'POST', body: JSON.stringify({ name }) });
      } else {
        await api('/api/folders', { method: 'POST', body: JSON.stringify({ name }) });
      }
      folderDialog.close();
      window.cascadeToast?.(folderMode === 'rename' ? 'Folder renamed' : 'Folder created');
      setTimeout(() => location.reload(), 250);
    } catch (err) {
      window.cascadeToast?.(err.message, true);
    } finally {
      folderSave.disabled = false;
    }
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });

  body?.addEventListener('click', async (e) => {
    const folderAction = e.target.closest('[data-folder-action]');
    if (folderAction) {
      e.preventDefault();
      const { action, id, name } = folderAction.dataset;
      if (action === 'rename') return openFolderDialog('rename', { id, name });
      if (action === 'delete') {
        const ok = await ask({
          title: `Delete “${name}”?`,
          message: 'The folder is removed. Any files inside return to All files — they are not deleted.',
          confirm: 'Delete folder',
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/api/folders/${id}`, { method: 'DELETE' });
          window.cascadeToast?.('Folder deleted — files moved to All files');
          setTimeout(() => { location.href = '/'; }, 300);
        } catch (err) {
          window.cascadeToast?.(err.message, true);
        }
      }
      return;
    }

    const action = e.target.closest('[data-file-action]');
    if (!action) return;
    e.preventDefault();
    const { id, name, kind } = action.dataset;
    const fileAction = action.dataset.fileAction;
    if (fileAction === 'move') return openPlaceDialog('move', [id]);
    if (fileAction === 'copy') return openPlaceDialog('copy', [id]);
    if (fileAction === 'rename') {
      const value = await ask({ title: 'Rename file', value: name, confirm: 'Save' });
      if (!value || value === name) return;
      try {
        await api(`/api/files/${id}/rename`, { method: 'POST', body: JSON.stringify({ filename: value }) });
        window.cascadeToast?.('Renamed');
        setTimeout(() => location.reload(), 250);
      } catch (err) {
        window.cascadeToast?.(err.message, true);
      }
      return;
    }
    if (fileAction === 'share' || fileAction === 'unshare') {
      try {
        await api(`/api/files/${id}/share`, { method: 'POST', body: JSON.stringify({ isPublic: fileAction === 'share' }) });
        window.cascadeToast?.(fileAction === 'share' ? 'File is now public' : 'File is private again');
        setTimeout(() => location.reload(), 250);
      } catch (err) {
        window.cascadeToast?.(err.message, true);
      }
      return;
    }
    if (fileAction === 'delete') {
      const ok = await ask({
        title: `Delete “${name}”?`,
        message: kind === 'folder' ? 'This cannot be undone.' : 'The file is removed from every replica. This cannot be undone.',
        confirm: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/files/${id}`, { method: 'DELETE' });
        window.cascadeToast?.('File deleted');
        setTimeout(() => location.reload(), 250);
      } catch (err) {
        window.cascadeToast?.(err.message, true);
      }
    }
  });

  // ---- file input / upload -------------------------------------------------
  function launchUpload() {
    fileInput?.click();
  }
  document.getElementById('fm-upload-menu')?.addEventListener('click', launchUpload);
  fileInput?.addEventListener('change', () => {
    if (!fileInput.files?.length) return;
    window.cascadeUpload?.(uploadForm, uploadStatus);
  });
  document.querySelector('label[for="fm-file-input"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    launchUpload();
  });

  // ---- drag files onto folders --------------------------------------------
  document.querySelectorAll('.fm-file-row').forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      const selected = selectedItems().filter((i) => i.kind === 'file');
      draggingIds = selected.some((i) => i.id === row.dataset.fileId) ? selected.map((i) => i.id) : [row.dataset.fileId];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggingIds.join(','));
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      draggingIds = [];
      document.querySelectorAll('.fm-folder-row.is-drop-target, .fm-up-row.is-drop-target').forEach((r) => r.classList.remove('is-drop-target'));
      if (dragHint) dragHint.hidden = true;
    });
  });

  function bindDropTarget(row, folderId, label) {
    row.addEventListener('dragover', (e) => {
      if (!draggingIds.length) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('is-drop-target');
      if (dragHint) {
        dragHint.hidden = false;
        dragHint.textContent = `Move to ${label}`;
      }
    });
    row.addEventListener('dragleave', (e) => {
      if (row.contains(e.relatedTarget)) return;
      row.classList.remove('is-drop-target');
    });
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('is-drop-target');
      if (dragHint) dragHint.hidden = true;
      const ids = (e.dataTransfer.getData('text/plain') || '').split(',').filter(Boolean);
      if (!ids.length) return;
      let failed = 0;
      for (const id of ids) {
        try {
          await api(`/api/files/${id}/move`, { method: 'POST', body: JSON.stringify({ folderId }) });
        } catch {
          failed += 1;
        }
      }
      window.cascadeToast?.(failed ? `${failed} item(s) could not be moved` : `Moved to ${label}`, failed > 0);
      if (!failed) setTimeout(() => location.reload(), 250);
    });
  }

  document.querySelectorAll('.fm-folder-row').forEach((row) => {
    bindDropTarget(row, row.dataset.folderId, row.dataset.name);
  });
  const upRow = document.querySelector('.fm-up-row');
  if (upRow) bindDropTarget(upRow, '', 'All files');

  refreshSelection();
})();
