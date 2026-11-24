/* Yjs transport for Cascade editors. The server is authoritative for roles and
   persistence; this client only exchanges document updates and presence. */
import * as Y from '../vendor/yjs.bundle.mjs';

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
  let socket = null;
  let connected = false;
  let ready = false;
  let retry = 0;
  let retryTimer = null;
  let applying = false;
  let localMutation = false;
  let pendingContent = null;
  let lastPublished = JSON.stringify(content || {});
  let closedByUser = false;
  let lastCursor = null;
  let cursorTimer = null;
  let pingTimer = null;
  let participants = [];

  function localContent() {
    return map.get('content');
  }

  doc.on('update', (update, origin) => {
    if (origin === 'remote' || applying) return;
    if (!connected || !socket || socket.readyState !== WebSocket.OPEN || !canWrite) return;
    socket.send(update);
    onStatus({ state: 'live', canWrite, participants });
  });

  map.observe(() => {
    if (applying || localMutation) {
      localMutation = false;
      return;
    }
    const next = localContent();
    if (next) onRemoteContent(next);
  });

  function applyRemote(update) {
    applying = true;
    try {
      Y.applyUpdate(doc, update, 'remote');
      return localContent();
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
        lastPublished = JSON.stringify(localContent() || {});
        // A fresh room has no content item. Seed it with the editor's initial
        // payload only after the server state has been applied, so a stale local
        // copy can never outrank the authoritative document on connect.
        if (!localContent() && content) {
          applying = true;
          try { map.set('content', content); } finally { applying = false; }
        }
        onInit({ content: localContent(), version: message.version, role: message.role, canWrite: !!message.canWrite && canWrite, users: message.users || [] });
        participants = message.users || [];
        onPresence(participants);
        // Unsent local work survives a disconnect and is merged after re-init.
        if (pendingContent && canWrite) {
          const value = pendingContent;
          pendingContent = null;
          lastPublished = JSON.stringify(value);
          localMutation = true;
          map.set('content', value);
          socket.send(Y.encodeStateAsUpdate(doc));
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
    // Compare against a snapshot, not map.get(): the local map can hold the
    // same object the editor mutates in place, which would make every publish
    // look identical and silently skip the WebSocket update.
    if (serialized === lastPublished) return;
    pendingContent = value;
    if (!connected || !ready) return;
    lastPublished = serialized;
    localMutation = true;
    map.set('content', value);
    pendingContent = null;
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
