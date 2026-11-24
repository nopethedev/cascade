/* Yjs transport for Cascade editors. The server is authoritative for roles and
   persistence; this client exchanges incremental JSON patches and presence.

   A Yjs map of whole documents was the source of a serious collaboration bug:
   two people editing at once each replaced the entire map value, so the last
   full snapshot erased the other person's work. The document is now a shared
   base plus an append-only Yjs array of small patches. Yjs merges concurrent
   patch insertions, and every client materializes the same document from them. */
import * as Y from '../vendor/yjs.bundle.mjs';
import { diffContent, materializeContent } from './collab-merge.mjs';

export function connect(options) {
  const {
    token,
    content,
    canWrite = false,
    onInit = () => {},
    onRemoteContent = () => {},
    onStatus = () => {},
    onPresence = () => {},
    onSaved = () => {},
    onError = () => {},
  } = options;

  const doc = new Y.Doc();
  const map = doc.getMap('document');
  const patches = doc.getArray('operations');
  let socket = null;
  let connected = false;
  let ready = false;
  let retry = 0;
  let retryTimer = null;
  let applying = false;
  let pendingContent = null;
  let lastPublished = JSON.stringify(content || {});
  let closedByUser = false;
  let lastCursor = null;
  let cursorTimer = null;
  let pingTimer = null;
  let participants = [];

  function materialize() {
    return materializeContent(map.get('content') || content || {}, patches.toArray());
  }

  function newPatchId() {
    try {
      return crypto.randomUUID();
    } catch {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    }
  }

  function appendDiff(before, after) {
    const operations = diffContent(before, after);
    if (!operations.length) return false;
    doc.transact(() => {
      patches.push([{
        id: newPatchId(),
        version: 1,
        ops: operations,
      }]);
    });
    return true;
  }

  doc.on('update', (update, origin) => {
    if (origin === 'remote' || applying) return;
    if (!connected || !socket || socket.readyState !== WebSocket.OPEN || !canWrite) return;
    socket.send(update);
    onStatus({ state: 'live', canWrite, participants });
  });

  function applyRemote(update) {
    applying = true;
    try {
      Y.applyUpdate(doc, update, 'remote');
      const next = materialize();
      lastPublished = JSON.stringify(next);
      return next;
    } finally {
      applying = false;
    }
  }

  function sendPresence(immediate = false) {
    if (!connected || !socket || socket.readyState !== WebSocket.OPEN) return;
    if (!immediate) {
      if (cursorTimer) return;
      cursorTimer = setTimeout(() => {
        cursorTimer = null;
        sendPresence(true);
      }, 70);
      return;
    }
    const selection = (() => {
      try {
        const custom = window.__cascadePresenceSelection;
        if (typeof custom === 'string' && custom.trim()) return custom.trim().slice(0, 100);
        return String(window.getSelection?.()?.toString() || '').trim().slice(0, 100);
      } catch {
        return '';
      }
    })();
    socket.send(JSON.stringify({
      type: 'presence',
      cursor: lastCursor,
      selection,
    }));
  }

  function shoutdown() {
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    if (socket) {
      closedByUser = true;
      try {
        socket.close(1000, 'leaving');
      } catch {
        /* already closed */
      }
      socket = null;
    }
    connected = false;
  }

  function scheduleRetry() {
    if (closedByUser) return;
    retry += 1;
    const wait = Math.min(15000, 500 * 2 ** Math.min(5, retry));
    onStatus({ state: 'reconnecting', canWrite, participants });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(open, wait);
  }

  function open() {
    if (closedByUser) return;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      socket = new WebSocket(`${scheme}//${location.host}/collab?token=${encodeURIComponent(token)}`);
    } catch {
      scheduleRetry();
      return;
    }
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('open', () => {
      connected = true;
      retry = 0;
      onStatus({ state: 'connecting', canWrite, participants });
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
      }, 20000);
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        const next = applyRemote(new Uint8Array(event.data));
        onRemoteContent(next);
        return;
      }
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'init') {
        ready = true;
        const update = Uint8Array.from(atob(message.update || ''), (c) => c.charCodeAt(0));
        applyRemote(update);
        // A brand-new room may have an empty base object. Seed it from the
        // editor's initial payload only after the server state is applied.
        const serverBase = map.get('content');
        if ((!serverBase || !Object.keys(serverBase).length) && !patches.length && content && Object.keys(content).length) {
          doc.transact(() => map.set('content', content));
        }
        let next = materialize();
        lastPublished = JSON.stringify(next);
        onInit({ content: next, version: message.version, role: message.role, canWrite: !!message.canWrite && canWrite, users: message.users || [] });
        participants = message.users || [];
        onPresence(participants);
        // Work produced while the socket was down is replayed as a patch
        // against the server's current content, never as a full replacement.
        if (pendingContent && canWrite) {
          const value = pendingContent;
          pendingContent = null;
          const current = materialize();
          appendDiff(current, value);
          lastPublished = JSON.stringify(value);
          next = materialize();
          onRemoteContent(next);
        }
        onStatus({ state: 'live', canWrite, participants });
      } else if (message.type === 'presence') {
        participants = message.users || [];
        onPresence(participants);
      } else if (message.type === 'saved') {
        onSaved(message);
        onStatus({ state: 'live', canWrite, participants });
      } else if (message.type === 'error') {
        onError(message.error || 'Collaboration error');
      }
    });

    socket.addEventListener('close', (event) => {
      connected = false;
      ready = false;
      clearInterval(pingTimer);
      if (closedByUser) return;
      if (event.code === 4001 || event.code === 4003) {
        onError(event.code === 4001 ? 'Your access to this document was removed.' : 'Live collaboration is unavailable.');
        onStatus({ state: 'offline', canWrite: false, participants: [] });
        return;
      }
      scheduleRetry();
    });

    socket.addEventListener('error', () => {
      /* close handles reconnect */
    });
  }

  function publish(value) {
    if (!canWrite) return;
    const serialized = JSON.stringify(value);
    if (serialized === lastPublished) return;
    pendingContent = value;
    if (!connected || !ready) return;
    const current = materialize();
    const changed = appendDiff(current, value);
    pendingContent = null;
    if (!changed) return;
    lastPublished = serialized;
  }

  document.addEventListener('pointermove', (e) => {
    lastCursor = { x: Math.round(e.clientX), y: Math.round(e.clientY) };
    sendPresence();
  }, { passive: true });
  document.addEventListener('pointerleave', () => {
    lastCursor = null;
    sendPresence();
  });
  window.addEventListener('beforeunload', () => {
    try {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'save' }));
      }
    } catch {
      /* ignore */
    }
    shoutdown();
  });

  open();
  return {
    publish,
    sendPresence: () => sendPresence(true),
    disconnect: shoutdown,
    get participants() { return participants; },
    get connected() { return connected && ready; },
  };
}

window.CascadeCollab = { connect };
window.dispatchEvent(new Event('cascade:collab-ready'));
