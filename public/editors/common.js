/* Shared workspace editor runtime: autosave, versions, conflict handling,
   presence, sharing and template capture. Editors provide apply/collect. */
(function () {
  const $ = (id) => document.getElementById(id);

  function timeLabel(d = new Date()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  window.Workspace = {
    create(opts) {
      const api = `/api/workspace/docs/${opts.id}`;
      const state = {
        id: opts.id,
        kind: opts.kind,
        version: Number(opts.version) || 1,
        content: opts.content,
        isPublic: !!opts.isPublic,
        dirty: false,
        saving: false,
        pending: false,
        conflictContent: null,
      };

      const statusEl = $('save-status');
      const presenceEl = $('presence');
      const conflictBar = $('conflict-bar');
      const shareBtn = $('btn-share');
      let timer = null;
      let heartbeat = null;

      const status = (text, cls) => {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = 'badge ' + (cls || '');
      };

      function renderPresence(viewers) {
        if (!presenceEl) return;
        presenceEl.textContent = '';
        const list = (viewers || []).slice(0, 5);
        if (list.length > 1) {
          presenceEl.title = `${list.join(', ')} viewing`;
        }
        for (const name of list) {
          const chip = document.createElement('span');
          chip.className = 'viewer-chip';
          chip.textContent = initials(name);
          chip.title = name;
          presenceEl.append(chip);
        }
        if (list.length > 1) {
          const more = document.createElement('span');
          more.className = 'viewer-chip viewer-count';
          more.textContent = String(list.length);
          presenceEl.append(more);
        }
      }

      function showConflict(serverContent) {
        state.conflictContent = serverContent;
        if (conflictBar) conflictBar.hidden = false;
        status('Conflict', 'badge-bad');
      }

      async function saveNow(force = false) {
        if (state.saving) {
          state.pending = true;
          return;
        }
        state.saving = true;
        clearTimeout(timer);
        const content = opts.collect();
        status('Saving…', '');
        try {
          const r = await fetch(api, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content, version: state.version, force: !!force }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.status === 409) {
            showConflict(j.content);
            return;
          }
          if (!r.ok) throw new Error(j.error || 'save failed');
          state.version = j.version;
          state.content = content;
          state.dirty = false;
          if (conflictBar) conflictBar.hidden = true;
          status(`Saved ${timeLabel()}`, 'badge-ok');
          renderPresence(j.viewers);
        } catch (err) {
          status('Offline — retrying', 'badge-bad');
          clearTimeout(timer);
          timer = setTimeout(() => saveNow(force), 4000);
        } finally {
          state.saving = false;
          if (state.pending) {
            state.pending = false;
            schedule();
          }
        }
      }

      function schedule() {
        state.dirty = true;
        status('Unsaved', '');
        clearTimeout(timer);
        timer = setTimeout(() => saveNow(), 800);
      }

      async function reload() {
        const r = await fetch(api);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return;
        state.version = j.version;
        state.content = j.content;
        state.dirty = false;
        opts.apply(j.content);
        if (conflictBar) conflictBar.hidden = true;
        status('Reloaded', 'badge-ok');
        renderPresence(j.viewers);
      }

      // ---- version history drawer
      const drawer = $('versions-panel');
      const versionList = $('versions-list');
      async function openVersions() {
        if (!drawer) return;
        drawer.hidden = false;
        if (versionList) versionList.textContent = 'Loading…';
        const r = await fetch(`${api}/versions`);
        const j = await r.json().catch(() => ({}));
        if (!versionList) return;
        versionList.textContent = '';
        if (!r.ok || !j.versions || !j.versions.length) {
          versionList.textContent = 'No saved versions yet.';
          return;
        }
        for (const v of j.versions) {
          const row = document.createElement('div');
          row.className = 'version-row';
          const label = document.createElement('span');
          label.innerHTML = `<strong>v${v.version}</strong> <span class="faint">${new Date(v.createdAt).toLocaleString()}</span>`;
          const btn = document.createElement('button');
          btn.className = 'btn btn-ghost btn-sm';
          btn.textContent = 'Restore';
          btn.addEventListener('click', async () => {
            const rr = await fetch(`${api}/restore`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ version: v.version }),
            });
            const jj = await rr.json().catch(() => ({}));
            if (!rr.ok) return window.cascadeToast?.(jj.error || 'Restore failed', true);
            state.version = jj.version;
            state.content = jj.content;
            opts.apply(jj.content);
            drawer.hidden = true;
            status('History restored', 'badge-ok');
            window.cascadeToast?.('Version restored');
          });
          row.append(label, btn);
          versionList.append(row);
        }
      }

      document.addEventListener('keydown', (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 's') {
          e.preventDefault();
          saveNow();
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && state.dirty) saveNow();
      });

      window.addEventListener('beforeunload', (e) => {
        if (state.dirty) {
          saveNow();
          e.preventDefault();
          e.returnValue = '';
        }
      });

      const sidePanel = $('editor-side');
      const panelLayout = $('doc-layout');
      const panelButton = $('btn-editor-panel');
      function setPanel(open) {
        if (!sidePanel) return;
        if (panelLayout) panelLayout.classList.toggle('is-panel-hidden', !open);
        else sidePanel.hidden = !open;
        panelButton?.setAttribute('aria-expanded', String(open));
      }
      panelButton?.addEventListener('click', () => setPanel(panelLayout?.classList.contains('is-panel-hidden') ?? sidePanel.hidden));
      $('editor-side-close')?.addEventListener('click', () => setPanel(false));

      $('btn-versions')?.addEventListener('click', openVersions);
      $('versions-close')?.addEventListener('click', () => {
        if (drawer) drawer.hidden = true;
      });

      $('btn-save-template')?.addEventListener('click', async () => {
        const name = window.prompt('Template name', opts.filename || 'My template');
        if (!name) return;
        const r = await fetch(`${api}/template`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return window.cascadeToast?.(j.error || 'Could not save template', true);
        window.cascadeToast?.('Saved to your templates');
      });

      $('btn-share')?.addEventListener('click', async () => {
        const next = !state.isPublic;
        const r = await fetch(`/api/files/${opts.id}/share`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isPublic: next }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return window.cascadeToast?.(j.error || 'Could not update sharing', true);
        state.isPublic = !!j.isPublic;
        if (shareBtn) shareBtn.textContent = state.isPublic ? 'Public ✓' : 'Share';
        window.cascadeToast?.(state.isPublic ? 'Anyone with the link can open it' : 'Link disabled');
      });

      $('btn-save')?.addEventListener('click', () => saveNow());

      $('conflict-reload')?.addEventListener('click', reload);
      $('conflict-overwrite')?.addEventListener('click', () => saveNow(true));

      async function beat() {
        try {
          const r = await fetch(`${api}/heartbeat`, { method: 'POST' });
          if (!r.ok) return;
          const j = await r.json();
          renderPresence(j.viewers);
        } catch {
          /* offline */
        }
      }
      heartbeat = setInterval(beat, 7000);
      beat();

      status(`Saved ${timeLabel()}`, 'badge-ok');
      if (shareBtn) shareBtn.textContent = state.isPublic ? 'Public ✓' : 'Share';

      return {
        state,
        schedule,
        saveNow,
        reload,
        status,
        renderPresence,
      };
    },
  };
})();
