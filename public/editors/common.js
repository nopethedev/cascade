/* Shared workspace runtime: collaboration, autosave, offline drafts, versions,
   sharing, comments and template capture. Editors provide apply/collect. */
(function () {
  const $ = (id) => document.getElementById(id);
  const shareMode = !!window.__ACCESS__?.shareMode;

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

  async function request(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  function toast(message, bad = false) {
    if (window.cascadeToast) return window.cascadeToast(message, bad);
    console[bad ? 'error' : 'log'](message);
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')).catch(() => toast(text));
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast('Copied to clipboard');
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function timeAgo(value) {
    const diff = Math.max(0, Date.now() - new Date(value).getTime());
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(value).toLocaleDateString();
  }

  window.Workspace = {
    create(opts) {
      const api = `/api/workspace/docs/${opts.id}`;
      const shareToken = window.__SHARE_TOKEN__ || null;
      const savePath = shareToken ? `/s/${encodeURIComponent(shareToken)}/content` : api;
      const readOnly = opts.canEdit === false || window.__ACCESS__?.canEdit === false;
      const editorSurface = '.ed-toolbar, .doc-toolbar, .sheet-toolbar, .board-toolbar, .pdf-toolbar, .code-toolbar, .form-toolbar, .deck-toolbar, .site-toolbar, .site-layers, .site-inspector, .doc-page, .sheet-wrap, .board-wrap, .code-editor-wrap, #stage';
      const state = {
        id: opts.id,
        kind: opts.kind,
        version: Number(opts.version) || 1,
        content: opts.content,
        isPublic: !!opts.isPublic,
        dirty: false,
        saving: false,
        pending: false,
        revoked: false,
        live: false,
        collabState: 'offline',
        conflictContent: null,
        role: window.__ACCESS__?.role || (readOnly ? 'viewer' : 'owner'),
        canEdit: !readOnly,
        canComment: !readOnly || ['commenter', 'editor', 'owner'].includes(window.__ACCESS__?.role),
        participants: [],
        me: null,
      };

      const statusEl = $('save-status');
      const presenceEl = $('presence');
      const liveEl = $('live-status');
      const liveLabel = $('live-label');
      const conflictBar = $('conflict-bar');
      const shareBtn = $('btn-share');
      const commentCount = $('comment-count');
      let timer = null;
      let heartbeat = null;
      let collab = null;
      let remoteApplying = false;
      let draftTimer = null;
      let comments = [];
      let commentPoll = null;
      const draftKey = `cascade:draft:${opts.id}`;

      const status = (text, cls) => {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = 'badge ' + (cls || '');
      };

      if (readOnly) {
        document.body.classList.add('is-readonly');
        document.body.dataset.canEdit = '0';
        const enforceReadOnly = () => {
          document.querySelectorAll('[data-requires-edit]').forEach((el) => {
            el.disabled = true;
            el.hidden = true;
          });
          document.querySelectorAll('[contenteditable]:not([contenteditable="false"])').forEach((el) => {
            el.setAttribute('contenteditable', 'false');
          });
          document.querySelectorAll('.sheet-grid, .board-wrap, #stage, .code-editor-wrap').forEach((el) => el.classList.add('is-view-only'));
        };
        enforceReadOnly();
        // Editors rebuild their DOM after load (sheets, boards, live content), so
        // apply the guard again whenever nodes are added instead of once at boot.
        new MutationObserver(enforceReadOnly).observe(document.body, { childList: true, subtree: true });
        // Toolbars may not carry data-requires-edit. Refuse edit gestures at the
        // surface level so a Viewer link cannot format, type, drop or paste.
        const blockEdit = (event) => {
          if (!window.__ACCESS__ || window.__ACCESS__.canEdit !== false) return;
          if (event.target.closest('dialog, #btn-share, #btn-comments, #btn-versions, #btn-editor-panel, .ed-more, a, .versions-panel, .share-dlg, .comment-dlg, .draft-bar')) return;
          if (event.target.closest(editorSurface)) {
            event.preventDefault();
            event.stopPropagation();
          }
        };
        document.addEventListener('beforeinput', blockEdit, true);
        document.addEventListener('paste', blockEdit, true);
        document.addEventListener('drop', blockEdit, true);
        document.addEventListener('click', (event) => {
          if (!window.__ACCESS__ || window.__ACCESS__.canEdit !== false) return;
          if (event.target.closest('dialog')) return;
          if (event.target.closest(editorSurface) && !event.target.closest('a, .sheet-tab, .deck-slide, nav')) {
            const control = event.target.closest('button, input, select, textarea');
            if (control && !control.closest('#btn-share, #btn-comments, #btn-versions, #btn-editor-panel, .ed-more')) {
              event.preventDefault();
              event.stopPropagation();
            }
          }
        }, true);
      }

      async function loadMe() {
        try {
          state.me = await request('/api/me');
        } catch {
          state.me = null;
        }
        return state.me;
      }

      function renderPresence(users) {
        if (!presenceEl) return;
        presenceEl.textContent = '';
        const list = (users || [])
          .map((u) => (typeof u === 'string' ? { username: u, color: null } : u))
          .filter((u) => u && u.username)
          .slice(0, 6);
        for (const person of list) {
          const chip = document.createElement('span');
          chip.className = 'viewer-chip';
          chip.textContent = initials(person.username);
          chip.title = `${person.username}${person.role ? ` · ${person.role}` : ''}`;
          if (person.color) {
            chip.style.color = person.color;
            chip.style.borderColor = person.color;
            chip.style.background = `color-mix(in srgb, ${person.color} 18%, transparent)`;
          }
          if (state.me?.user?.id && person.userId === state.me.user.id) chip.classList.add('is-me');
          presenceEl.append(chip);
        }
        if (list.length > 1) {
          const more = document.createElement('span');
          more.className = 'viewer-chip viewer-count';
          more.textContent = `+${list.length - 1}`;
          presenceEl.append(more);
        }
      }

      function renderLive() {
        if (!liveEl || shareMode) return;
        liveEl.hidden = state.collabState === 'offline' && !state.live;
        if (liveEl.hidden) return;
        liveEl.className = `live-status is-${state.collabState}`;
        liveLabel.textContent = state.collabState === 'live'
          ? (state.participants.length > 1 ? `Live · ${state.participants.length}` : 'Live')
          : state.collabState === 'connecting' ? 'Connecting…'
            : state.collabState === 'reconnecting' ? 'Reconnecting…' : 'Offline';
      }

      const cursorLayer = $('remote-cursors');
      async function renderCursors(users) {
        if (!cursorLayer) return;
        const meId = state.me?.user?.id;
        cursorLayer.textContent = '';
        for (const person of users || []) {
          if (!person.cursor || (meId && person.userId === meId)) continue;
          const x = Number(person.cursor.x);
          const y = Number(person.cursor.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
          const dot = document.createElement('span');
          dot.className = 'remote-cursor';
          dot.style.left = `${x}px`;
          dot.style.top = `${y}px`;
          dot.style.setProperty('--cursor-color', person.color || '#60a5fa');
          dot.innerHTML = `<i></i><b>${escapeHtml(person.username)}</b>${person.selection ? `<em>${escapeHtml(person.selection)}</em>` : ''}`;
          cursorLayer.append(dot);
        }
      }

      function showConflict(serverContent) {
        state.conflictContent = serverContent;
        if (conflictBar) conflictBar.hidden = false;
        status('Conflict', 'badge-bad');
      }

      function saveDraft() {
        if (readOnly) return;
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
          try {
            localStorage.setItem(draftKey, JSON.stringify({
              content: opts.collect(),
              version: state.version,
              savedAt: Date.now(),
            }));
          } catch {
            /* storage may be full or disabled */
          }
        }, 180);
      }

      function clearDraft() {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* ignore */
        }
      }

      function restoreDraft() {
        if (readOnly) return;
        let draft;
        try {
          draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
        } catch {
          draft = null;
        }
        if (!draft?.content || !draft.savedAt || Date.now() - draft.savedAt > 7 * 86400000) return;
        if (JSON.stringify(draft.content) === JSON.stringify(state.content)) return;
        if (draft.version !== state.version) return;
        const bar = document.createElement('div');
        bar.className = 'draft-bar';
        bar.innerHTML = `<span>An unsaved local draft from ${new Date(draft.savedAt).toLocaleString()} was found.</span>
          <span class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" type="button" data-draft="discard">Discard</button>
          <button class="btn btn-sm" type="button" data-draft="restore">Restore draft</button></span>`;
        bar.querySelector('[data-draft="restore"]').addEventListener('click', () => {
          opts.apply(draft.content);
          state.dirty = true;
          bar.remove();
          if (collab?.connected) collab.publish(draft.content);
          else schedule();
          toast('Local draft restored');
        });
        bar.querySelector('[data-draft="discard"]').addEventListener('click', () => {
          clearDraft();
          bar.remove();
        });
        (conflictBar?.parentNode || document.querySelector('main'))?.insertBefore(bar, conflictBar?.nextSibling || null);
      }

      async function saveNow(force = false) {
        if (readOnly || state.revoked) return;
        if (state.saving) {
          state.pending = true;
          return;
        }
        clearTimeout(timer);
        if (state.live && !force) {
          // Live rooms persist via the WebSocket. The server broadcasts the new
          // version after its debounce, so there is no competing HTTP write.
          if (collab?.connected) collab.publish(opts.collect());
          state.dirty = false;
          status('Saved · live', 'badge-ok');
          return;
        }
        state.saving = true;
        const content = opts.collect();
        status('Saving…', '');
        try {
          const j = await request(savePath, {
            method: 'PUT',
            body: JSON.stringify({ content, version: state.version, force: !!force }),
          });
          state.version = j.version;
          state.content = content;
          state.dirty = false;
          if (conflictBar) conflictBar.hidden = true;
          status(`Saved ${timeLabel()}`, 'badge-ok');
          clearDraft();
          renderPresence(j.viewers);
          if (collab?.connected) collab.publish(content);
        } catch (err) {
          if (err.status === 409) {
            showConflict(err.body?.content);
            return;
          }
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
        if (readOnly || state.revoked) return;
        state.dirty = true;
        const content = opts.collect();
        saveDraft();
        if (collab?.connected) {
          collab.publish(content);
          status('Live edit…', '');
          return;
        }
        status('Unsaved', '');
        clearTimeout(timer);
        timer = setTimeout(() => saveNow(), 800);
      }

      async function reload() {
        try {
          const j = await request(api);
          state.version = j.version;
          state.content = j.content;
          state.dirty = false;
          opts.apply(j.content);
          if (conflictBar) conflictBar.hidden = true;
          status('Reloaded', 'badge-ok');
          renderPresence(j.viewers);
        } catch {
          /* keep local editor usable */
        }
      }

      // ---- collaboration ------------------------------------------------
      async function getCollabToken() {
        if (window.__COLLAB_SHARE_TOKEN__) {
          return {
            token: window.__COLLAB_SHARE_TOKEN__,
            canEdit: !!window.__ACCESS__?.canEdit,
            role: window.__ACCESS__?.role || 'viewer',
          };
        }
        const j = await request(`${api}/collab-token`);
        return { token: j.token, canEdit: !!j.canEdit, role: j.role };
      }

      async function initCollab() {
        if (!window.CascadeCollab) return;
        try {
          const grant = await getCollabToken();
          if (!grant?.token) return;
          state.collabState = 'connecting';
          renderLive();
          collab = window.CascadeCollab.connect({
            token: grant.token,
            content: state.content,
            canWrite: !!grant.canEdit && !readOnly,
            onInit(info) {
              state.role = info.role || state.role;
              state.participants = info.users || [];
              if (info.version) state.version = info.version;
              if (info.content && JSON.stringify(info.content) !== JSON.stringify(opts.collect()) && !state.dirty) {
                remoteApplying = true;
                try {
                  state.content = info.content;
                  opts.apply(info.content);
                } finally {
                  remoteApplying = false;
                }
              }
              renderPresence(state.participants);
              renderCursors(state.participants);
            },
            onRemoteContent(content) {
              if (!content || JSON.stringify(content) === JSON.stringify(opts.collect())) return;
              remoteApplying = true;
              try {
                state.content = content;
                opts.apply(content);
                state.dirty = false;
                status('Live · updated', 'badge-ok');
              } finally {
                remoteApplying = false;
              }
            },
            onStatus(info) {
              state.live = info.state === 'live';
              state.collabState = info.state;
              state.participants = info.participants || state.participants;
              renderLive();
              renderPresence(state.participants);
              renderCursors(state.participants);
              if (info.state === 'offline' && state.dirty && !readOnly) {
                clearTimeout(timer);
                timer = setTimeout(() => saveNow(), 600);
              }
            },
            onPresence(users) {
              state.participants = users || [];
              renderPresence(state.participants);
              renderCursors(state.participants);
              if (accessDialog?.open) renderShareDialog();
            },
            onSaved(info) {
              if (info.version) state.version = Number(info.version);
              status(`Saved · live ${timeLabel()}`, 'badge-ok');
              clearDraft();
            },
            onError(message) {
              toast(message, true);
              state.collabState = 'offline';
              if (/access.*removed|revoked|forbidden/i.test(String(message))) {
                state.revoked = true;
                document.body.classList.add('is-readonly');
                status('Access removed', 'badge-bad');
                document.querySelectorAll('[data-requires-edit], #btn-share, #btn-comments').forEach((el) => { el.hidden = true; });
              }
              renderLive();
            },
          });
        } catch (err) {
          state.collabState = 'offline';
          renderLive();
          if (err.status !== 401) toast('Live collaboration unavailable — autosave is still on', true);
        }
      }

      // ---- copy / temporary guards -------------------------------------
      function guardUnsaved() {
        if (state.dirty && !readOnly) saveNow();
      }

      document.addEventListener('keydown', (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 's') {
          e.preventDefault();
          saveNow(true);
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && state.dirty) guardUnsaved();
      });
      window.addEventListener('beforeunload', (e) => {
        if (state.dirty && !readOnly) {
          guardUnsaved();
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
      const togglePanel = () => setPanel(panelLayout?.classList.contains('is-panel-hidden') ?? sidePanel.hidden);
      panelButton?.addEventListener('click', togglePanel);
      $('btn-editor-panel-mobile')?.addEventListener('click', () => {
        togglePanel();
        document.querySelector('.ed-more[open]')?.removeAttribute('open');
      });
      $('editor-side-close')?.addEventListener('click', () => setPanel(false));
      if (window.matchMedia('(max-width: 760px)').matches && panelLayout) setPanel(false);

      // ---- versions -----------------------------------------------------
      const drawer = $('versions-panel');
      const versionList = $('versions-list');
      async function openVersions() {
        if (!drawer) return;
        drawer.hidden = false;
        if (versionList) versionList.textContent = 'Loading…';
        try {
          const j = await request(`${api}/versions`);
          if (!versionList) return;
          versionList.textContent = '';
          if (!j.versions?.length) {
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
            btn.disabled = readOnly;
            btn.addEventListener('click', async () => {
              try {
                const jj = await request(`${api}/restore`, { method: 'POST', body: JSON.stringify({ version: v.version }) });
                state.version = jj.version;
                state.content = jj.content;
                opts.apply(jj.content);
                drawer.hidden = true;
                status('History restored', 'badge-ok');
                if (collab?.connected) collab.publish(jj.content);
                else schedule();
                toast('Version restored');
              } catch (err) {
                toast(err.message, true);
              }
            });
            row.append(label, btn);
            versionList.append(row);
          }
        } catch (err) {
          if (versionList) versionList.textContent = err.message;
        }
      }

      $('btn-versions')?.addEventListener('click', openVersions);
      $('btn-versions-mobile')?.addEventListener('click', openVersions);
      $('versions-close')?.addEventListener('click', () => {
        if (drawer) drawer.hidden = true;
      });

      $('btn-save-template')?.addEventListener('click', async () => {
        if (readOnly) return;
        const name = window.prompt('Template name', opts.filename || 'My template');
        if (!name) return;
        try {
          await request(`${api}/template`, { method: 'POST', body: JSON.stringify({ name }) });
          toast('Saved to your templates');
        } catch (err) {
          toast(err.message, true);
        }
      });
      $('btn-template-mobile')?.addEventListener('click', () => $('btn-save-template')?.click());

      $('btn-save')?.addEventListener('click', () => saveNow(true));
      $('btn-save-mobile')?.addEventListener('click', () => saveNow(true));
      $('conflict-reload')?.addEventListener('click', reload);
      $('conflict-overwrite')?.addEventListener('click', () => saveNow(true));

      // ---- share dialog -------------------------------------------------
      let accessDialog = null;
      let accessData = null;
      let shareTab = 'people';

      function shareUrl() {
        return state.isPublic && accessData?.slug ? `${location.origin}/c/${accessData.slug}` : `${location.origin}/edit/${opts.id}`;
      }

      async function loadAccess() {
        try {
          accessData = await request(`/api/files/${opts.id}/access`);
          state.isPublic = !!accessData.isPublic;
          state.role = accessData.role;
          state.canEdit = !!accessData.canEdit && !readOnly;
          state.canComment = !!accessData.canComment;
        } catch {
          accessData = null;
        }
      }

      function buildShareDialog() {
        if (accessDialog) return accessDialog;
        accessDialog = document.createElement('dialog');
        accessDialog.className = 'dlg share-dlg';
        accessDialog.innerHTML = '<div class="share-dlg-in" id="share-dlg-in"></div>';
        document.body.append(accessDialog);
        return accessDialog;
      }

      function renderShareDialog() {
        if (!accessDialog) return;
        const host = accessDialog.querySelector('#share-dlg-in');
        if (!host) return;
        const owner = accessData?.owner?.username || 'Owner';
        const isOwner = accessData?.role === 'owner';
        const people = accessData?.collaborators || [];
        const links = accessData?.links || [];
        host.innerHTML = `
          <div class="share-head">
            <div>
              <h3 class="dlg-title">Share “${escapeHtml(opts.filename || 'document')}”</h3>
              <p class="dlg-msg">Invite people, choose what they can do, or create a read-only link.</p>
            </div>
            <button class="btn btn-quiet btn-sm" type="button" data-share-close>Close</button>
          </div>
          <div class="share-tabs" role="tablist">
            <button type="button" class="${shareTab === 'people' ? 'is-active' : ''}" data-share-tab="people">People</button>
            <button type="button" class="${shareTab === 'link' ? 'is-active' : ''}" data-share-tab="link">Link</button>
            <button type="button" class="${shareTab === 'live' ? 'is-active' : ''}" data-share-tab="live">Live now</button>
          </div>
          ${shareTab === 'people' ? `
            ${isOwner ? `<form class="share-invite" id="share-invite-form">
              <input id="share-invitee" placeholder="Username or email" maxlength="180" aria-label="Invite username or email" />
              <select id="share-invite-role" aria-label="Invite role">
                <option value="viewer">Viewer</option>
                <option value="commenter">Commenter</option>
                <option value="editor">Editor</option>
              </select>
              <button class="btn btn-sm" type="submit">Invite</button>
            </form>` : ''}
            <div class="share-people">
              <div class="share-person">
                <span class="share-avatar">${escapeHtml(initials(owner))}</span>
                <span class="share-person-main"><strong>${escapeHtml(owner)}</strong><small>Owner · full access</small></span>
              </div>
              ${people.map((p) => `<div class="share-person" data-collab="${p.id}">
                <span class="share-avatar">${escapeHtml(initials(p.username || p.email || '?'))}</span>
                <span class="share-person-main"><strong>${escapeHtml(p.username || p.email)}</strong><small>${escapeHtml(p.username ? 'Cascade account' : p.email)}</small></span>
                ${isOwner ? `<select class="share-role" data-role-for="${p.id}" aria-label="Role for ${escapeHtml(p.username || p.email)}">
                  ${['viewer', 'commenter', 'editor'].map((r) => `<option value="${r}"${r === p.role ? ' selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}
                </select><button class="btn btn-quiet btn-sm" type="button" data-remove-collab="${p.id}" aria-label="Remove access">×</button>` : `<span class="badge">${p.role}</span>`}
              </div>`).join('') || '<p class="side-note">No one else has access yet.</p>'}
            </div>` : ''}
          ${shareTab === 'link' ? `
            <div class="share-link-block">
              <label class="check"><input type="checkbox" id="share-public" ${state.isPublic ? 'checked' : ''} ${isOwner ? '' : 'disabled'} /><span>Anyone with the link can view</span></label>
              <div class="copyrow"><input id="share-url" readonly value="${escapeHtml(shareUrl())}" aria-label="Share link" /><button class="btn btn-ghost btn-sm" type="button" data-copy-share>Copy</button></div>
              <p class="hint">${state.isPublic ? 'This page is public. Turn it off to revoke access instantly.' : 'The link only works for people who already have access.'}</p>
            </div>
            ${isOwner ? `<div class="share-capability">
              <div class="row-between"><strong>Create a capability link</strong><span class="hint">Expires automatically</span></div>
              <div class="form-grid">
                <div class="field"><label class="label">Role</label><select id="share-cap-role"><option value="viewer">Viewer</option><option value="commenter">Commenter</option></select></div>
                <div class="field"><label class="label">Valid for</label><select id="share-cap-expiry"><option value="24">24 hours</option><option value="168" selected>7 days</option><option value="720">30 days</option></select></div>
              </div>
              <button class="btn btn-ghost btn-sm" type="button" data-create-link>Create link</button>
              ${links.length ? `<div class="share-link-list">${links.map((l) => `<div class="share-link-row"><span><strong>${escapeHtml(l.role)}</strong><small>expires ${new Date(l.expiresAt).toLocaleDateString()}</small></span><span class="row"><button class="btn btn-quiet btn-sm" type="button" data-copy-cap="${escapeHtml(l.token)}">Copy</button><button class="btn btn-quiet btn-sm" type="button" data-revoke-cap="${l.id}">Revoke</button></span></div>`).join('')}</div>` : ''}
            </div>` : ''}` : ''}
          ${shareTab === 'live' ? `
            <div class="share-live">
              <div class="live-head"><span class="dot ${state.live ? 'dot-ok' : ''}"></span><strong>${state.live ? 'Live collaboration is on' : 'Live collaboration unavailable'}</strong></div>
              ${state.participants.length ? state.participants.map((p) => `<div class="share-person"><span class="share-avatar" style="color:${p.color || 'var(--accent)'}">${escapeHtml(initials(p.username))}</span><span class="share-person-main"><strong>${escapeHtml(p.username)}${state.me?.user?.id && p.userId === state.me.user.id ? ' (you)' : ''}</strong><small>${p.guest ? 'share-link guest' : escapeHtml(p.role || 'viewer')}</small></span></div>`).join('') : '<p class="side-note">No one is editing right now.</p>'}
              <p class="hint">Changes merge through a Yjs document, save automatically, and reconnect after a dropped connection.</p>
            </div>` : ''}`;

        host.querySelector('[data-share-close]')?.addEventListener('click', () => accessDialog.close());
        host.querySelectorAll('[data-share-tab]').forEach((tab) => tab.addEventListener('click', () => {
          shareTab = tab.dataset.shareTab;
          renderShareDialog();
        }));
        host.querySelector('[data-copy-share]')?.addEventListener('click', () => copyText(host.querySelector('#share-url').value));
        host.querySelector('#share-public')?.addEventListener('change', async (e) => {
          try {
            const j = await request(`/api/files/${opts.id}/share`, { method: 'POST', body: JSON.stringify({ isPublic: e.target.checked }) });
            state.isPublic = !!j.isPublic;
            accessData.slug = j.slug;
            toast(state.isPublic ? 'Anyone with the link can now view' : 'Public link disabled');
            renderShareDialog();
          } catch (err) {
            toast(err.message, true);
            e.target.checked = !e.target.checked;
          }
        });
        host.querySelector('#share-invite-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const invitee = host.querySelector('#share-invitee').value.trim();
          const role = host.querySelector('#share-invite-role').value;
          if (!invitee) return;
          try {
            const invited = await request(`/api/files/${opts.id}/collaborators`, { method: 'POST', body: JSON.stringify({ invitee, role }) });
            if (invited.inviteUrl) {
              copyText(`${location.origin}${invited.inviteUrl}`);
              toast('Email invite link copied — send it to them');
            } else {
              toast(invited.existing ? 'Role updated' : 'Access granted');
            }
            await loadAccess();
            renderShareDialog();
          } catch (err) {
            toast(err.message, true);
          }
        });
        host.querySelectorAll('[data-role-for]').forEach((select) => select.addEventListener('change', async () => {
          try {
            await request(`/api/files/${opts.id}/collaborators/${select.dataset.roleFor}`, { method: 'PATCH', body: JSON.stringify({ role: select.value }) });
            toast('Role updated');
            await loadAccess();
            renderShareDialog();
          } catch (err) {
            toast(err.message, true);
          }
        }));
        host.querySelectorAll('[data-remove-collab]').forEach((btn) => btn.addEventListener('click', async () => {
          try {
            await request(`/api/files/${opts.id}/collaborators/${btn.dataset.removeCollab}`, { method: 'DELETE' });
            toast('Access removed');
            await loadAccess();
            renderShareDialog();
          } catch (err) {
            toast(err.message, true);
          }
        }));
        host.querySelector('[data-create-link]')?.addEventListener('click', async () => {
          const role = host.querySelector('#share-cap-role').value;
          const expiresInHours = Number(host.querySelector('#share-cap-expiry').value);
          try {
            const j = await request(`/api/files/${opts.id}/share-links`, { method: 'POST', body: JSON.stringify({ role, expiresInHours }) });
            copyText(`${location.origin}/s/${j.link.token}`);
            await loadAccess();
            renderShareDialog();
            toast('Link copied to clipboard');
          } catch (err) {
            toast(err.message, true);
          }
        });
        host.querySelectorAll('[data-copy-cap]').forEach((btn) => btn.addEventListener('click', () => copyText(`${location.origin}/s/${btn.dataset.copyCap}`)));
        host.querySelectorAll('[data-revoke-cap]').forEach((btn) => btn.addEventListener('click', async () => {
          try {
            await request(`/api/files/${opts.id}/share-links/${btn.dataset.revokeCap}`, { method: 'DELETE' });
            toast('Link revoked');
            await loadAccess();
            renderShareDialog();
          } catch (err) {
            toast(err.message, true);
          }
        }));
      }

      async function openShare() {
        buildShareDialog();
        // A mobile "More actions" details popup can remain open above the
        // dialog. Close it before taking focus so pointer and keyboard focus
        // always land on the dialog controls.
        document.querySelectorAll('details[open].ed-more, details[open].fm-menu').forEach((details) => details.removeAttribute('open'));
        await loadAccess();
        renderShareDialog();
        accessDialog.showModal();
      }

      shareBtn?.addEventListener('click', openShare);
      $('btn-share-mobile')?.addEventListener('click', openShare);

      // ---- comments -----------------------------------------------------
      let commentsPanel = null;
      async function loadComments(render = true) {
        try {
          const j = await request(`${api}/comments`);
          comments = j.comments || [];
          const open = comments.filter((c) => !c.resolved && !c.parentId);
          if (commentCount) {
            commentCount.textContent = String(open.length);
            commentCount.hidden = open.length === 0;
          }
          if (render && commentsPanel && !commentsPanel.hidden) renderComments();
        } catch {
          /* comments are optional for read-only guests */
        }
      }

      function commentAnchor() {
        const selection = window.getSelection?.();
        const quote = String(selection?.toString() || '').trim().slice(0, 180);
        if (quote) return { quote, kind: opts.kind };
        return { kind: opts.kind, editor: location.hash || null };
      }

      async function addComment(body, parentId = null) {
        if (!body.trim()) return;
        try {
          await request(`${api}/comments`, {
            method: 'POST',
            body: JSON.stringify({ body: body.trim(), parentId, anchor: commentAnchor() }),
          });
          await loadComments();
          renderComments();
        } catch (err) {
          toast(err.message, true);
        }
      }

      function commentNode(comment, replies) {
        const row = document.createElement('div');
        row.className = `comment${comment.resolved ? ' is-resolved' : ''}`;
        row.dataset.commentId = comment.id;
        row.innerHTML = `
          <div class="comment-head">
            <span class="share-avatar">${escapeHtml(initials(comment.authorName))}</span>
            <span><strong>${escapeHtml(comment.authorName)}</strong><small>${timeAgo(comment.createdAt)}${comment.resolved ? ' · resolved' : ''}</small></span>
            <div class="comment-tools">
              ${comment.parentId ? '' : `<button type="button" class="btn btn-quiet btn-sm" data-resolve="${comment.id}">${comment.resolved ? 'Reopen' : 'Resolve'}</button>`}
              <button type="button" class="btn btn-quiet btn-sm" data-delete-comment="${comment.id}" aria-label="Delete comment">×</button>
            </div>
          </div>
          <p>${escapeHtml(comment.body).replace(/\n/g, '<br>')}</p>
          ${comment.anchor?.quote ? `<blockquote>“${escapeHtml(comment.anchor.quote)}”</blockquote>` : ''}
          <div class="comment-replies">${(replies || []).map((r) => `<div class="comment-reply"><strong>${escapeHtml(r.authorName)}</strong> <small>${timeAgo(r.createdAt)}</small><p>${escapeHtml(r.body).replace(/\n/g, '<br>')}</p></div>`).join('')}</div>
          <form class="comment-reply-form" data-reply="${comment.parentId || comment.id}"><input placeholder="Reply…" maxlength="4000" aria-label="Reply to comment" /><button class="btn btn-ghost btn-sm" type="submit">Reply</button></form>`;
        row.querySelector('[data-resolve]')?.addEventListener('click', async () => {
          try {
            await request(`/api/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ resolved: !comment.resolved }) });
            await loadComments();
            renderComments();
          } catch (err) {
            toast(err.message, true);
          }
        });
        row.querySelector('[data-delete-comment]')?.addEventListener('click', async () => {
          try {
            await request(`/api/comments/${comment.id}`, { method: 'DELETE' });
            await loadComments();
            renderComments();
          } catch (err) {
            toast(err.message, true);
          }
        });
        row.querySelector('[data-reply]')?.addEventListener('submit', (e) => {
          e.preventDefault();
          const input = e.currentTarget.querySelector('input');
          addComment(input.value, e.currentTarget.dataset.reply);
        });
        return row;
      }

      function renderComments() {
        if (!commentsPanel) return;
        const body = commentsPanel.querySelector('.comments-body');
        if (!body) return;
        const roots = comments.filter((c) => !c.parentId);
        body.textContent = '';
        if (!roots.length) {
          body.innerHTML = '<div class="comments-empty"><strong>No comments yet</strong><span>Select text on the page, then leave a comment for your team.</span></div>';
        }
        for (const root of roots) {
          body.append(commentNode(root, comments.filter((c) => c.parentId === root.id)));
        }
        const composer = commentsPanel.querySelector('.comment-composer');
        composer.hidden = !state.canComment || shareMode;
      }

      function buildCommentsPanel() {
        if (commentsPanel) return commentsPanel;
        commentsPanel = document.createElement('aside');
        commentsPanel.className = 'drawer comments-drawer';
        commentsPanel.hidden = true;
        commentsPanel.innerHTML = `
          <div class="drawer-head">
            <strong>Comments</strong>
            <button class="btn btn-quiet btn-sm" type="button" data-comments-close>Close</button>
          </div>
          <div class="comments-body drawer-body"></div>
          <form class="comment-composer">
            <textarea rows="3" placeholder="Add a comment. Use @username to mention someone." maxlength="4000" aria-label="Add a comment"></textarea>
            <button class="btn btn-sm" type="submit">Comment</button>
          </form>`;
        document.body.append(commentsPanel);
        commentsPanel.querySelector('[data-comments-close]').addEventListener('click', () => { commentsPanel.hidden = true; });
        commentsPanel.querySelector('.comment-composer').addEventListener('submit', (e) => {
          e.preventDefault();
          const area = e.currentTarget.querySelector('textarea');
          addComment(area.value).then(() => { area.value = ''; });
        });
        return commentsPanel;
      }

      async function openComments() {
        buildCommentsPanel();
        commentsPanel.hidden = false;
        await loadComments();
        renderComments();
      }

      $('btn-comments')?.addEventListener('click', openComments);
      $('btn-comments-mobile')?.addEventListener('click', openComments);
      document.addEventListener('selectionchange', () => {
        // Keep the selection visible for the next comment; no request here.
      });

      // ---- boot ---------------------------------------------------------
      status(`Saved ${timeLabel()}`, 'badge-ok');
      if (shareBtn) shareBtn.textContent = 'Share';
      if (!readOnly) {
        restoreDraft();
        loadComments(false);
        commentPoll = setInterval(() => loadComments(false), 25000);
      }

      // Presence fallback for browsers that have not opened a live socket yet.
      async function beat() {
        if (shareMode || collab?.connected) return;
        try {
          const r = await fetch(`${api}/heartbeat`, { method: 'POST' });
          if (!r.ok) return;
          const j = await r.json();
          if (!collab?.connected) renderPresence(j.viewers);
        } catch {
          /* offline */
        }
      }
      heartbeat = setInterval(beat, 10000);
      setTimeout(async () => {
        if (!shareMode) await loadMe();
        if (window.CascadeCollab) initCollab();
        else {
          window.addEventListener('cascade:collab-ready', initCollab, { once: true });
          // The module may already have completed before this classic script
          // ran; a short retry covers both orderings.
          setTimeout(() => initCollab(), 250);
        }
        if (!shareMode) beat();
      }, 0);

      const instance = {
        state,
        schedule,
        saveNow,
        reload,
        status,
        renderPresence,
        get collab() { return collab; },
      };
      // Editors such as the website builder use the live instance helpers from
      // the shared namespace instead of threading their own copy through every
      // inspector control.
      Object.assign(window.Workspace, {
        instance,
        schedule: instance.schedule,
        saveNow: instance.saveNow,
        reload: instance.reload,
        status: instance.status,
      });
      return instance;
    },
  };
})();
