// HTTP client used by the MAIN server to talk to storage nodes.
const TIMEOUT_MS = 15000;

async function fetchTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function base(url) {
  return String(url).replace(/\/+$/, '');
}

export async function nodeHealth(node) {
  if (node.id === 'local') return { online: true, latencyMs: 0 };
  try {
    const start = Date.now();
    const r = await fetchTimeout(`${base(node.url)}/node/health`, {
      headers: { 'x-node-key': node.accessKey || '' },
    }, 8000);
    if (!r.ok) return { online: false };
    const j = await r.json().catch(() => ({}));
    return { online: true, latencyMs: Date.now() - start, ...j };
  } catch {
    return { online: false };
  }
}

export async function nodeStore(node, fileId, buffer, { filename, mime }) {
  const r = await fetchTimeout(`${base(node.url)}/node/store/${encodeURIComponent(fileId)}`, {
    method: 'PUT',
    headers: {
      'x-node-key': node.accessKey || '',
      'x-filename': encodeURIComponent(filename || fileId),
      'content-type': mime || 'application/octet-stream',
    },
    body: buffer,
  });
  if (!r.ok) throw new Error(`node store failed: ${r.status}`);
  return r.json().catch(() => ({}));
}

export async function nodeFetch(node, fileId) {
  const r = await fetchTimeout(`${base(node.url)}/node/file/${encodeURIComponent(fileId)}`, {
    headers: { 'x-node-key': node.accessKey || '' },
  });
  if (!r.ok) throw new Error(`node fetch failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { buffer: buf, mime: r.headers.get('content-type') || 'application/octet-stream' };
}

export async function nodeDelete(node, fileId) {
  const r = await fetchTimeout(`${base(node.url)}/node/file/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { 'x-node-key': node.accessKey || '' },
  });
  if (!r.ok && r.status !== 404) throw new Error(`node delete failed: ${r.status}`);
}

export async function nodeStat(node) {
  const r = await fetchTimeout(`${base(node.url)}/node/stat`, {
    headers: { 'x-node-key': node.accessKey || '' },
  }, 8000);
  if (!r.ok) throw new Error(`node stat failed: ${r.status}`);
  return r.json();
}
