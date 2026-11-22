import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

// Standalone storage node. Auth: `x-node-key: <NODE_ACCESS_KEY>`.
// Endpoints used by the main server:
//   GET  /node/health
//   PUT  /node/store/:id   (raw bytes, headers x-filename + content-type)
//   GET  /node/file/:id
//   DELETE /node/file/:id
//   GET  /node/stat

function resolveKey() {
  if (config.nodeAccessKey) return config.nodeAccessKey;
  const keyFile = path.join(path.dirname(config.dbPath), 'node-key.txt');
  try {
    if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim();
  } catch { /* ignore */ }
  const generated = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, generated + '\n', { mode: 0o600 });
    console.log(`[cascade-node] generated access key in ${keyFile} (mode 0600).`);
  } catch { /* ignore */ }
  console.log('[cascade-node] add this node on the main server with its URL and the key file contents.');
  return generated;
}

export function startNode() {
  const KEY = resolveKey();
  const app = express();
  app.use(express.raw({ type: '*/*', limit: '2gb' }));

  app.use('/node', (req, res, next) => {
    if ((req.headers['x-node-key'] || '') !== KEY) {
      return res.status(401).json({ error: 'bad node key' });
    }
    next();
  });

  const filePath = (id) => {
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    return path.join(config.storageDir, safe);
  };

  app.get('/node/health', (req, res) => {
    res.json({ ok: true, mode: 'node', time: new Date().toISOString() });
  });

  app.get('/node/stat', (req, res) => {
    let bytes = 0;
    let count = 0;
    fs.mkdirSync(config.storageDir, { recursive: true });
    for (const f of fs.readdirSync(config.storageDir)) {
      try {
        const st = fs.statSync(path.join(config.storageDir, f));
        if (st.isFile()) {
          bytes += st.size;
          count++;
        }
      } catch { /* ignore */ }
    }
    res.json({ ok: true, bytes, count });
  });

  app.put('/node/store/:id', (req, res) => {
    fs.mkdirSync(config.storageDir, { recursive: true });
    fs.writeFileSync(filePath(req.params.id), req.body || Buffer.alloc(0));
    res.json({ ok: true, bytes: (req.body || []).length });
  });

  app.get('/node/file/:id', (req, res) => {
    const p = filePath(req.params.id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
    res.sendFile(path.resolve(p));
  });

  app.delete('/node/file/:id', (req, res) => {
    const p = filePath(req.params.id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    res.json({ ok: true });
  });

  app.listen(config.port, config.host, () => {
    console.log(`[cascade] storage node listening on http://${config.host}:${config.port}`);
    if (!process.env.NODE_ACCESS_KEY) {
      console.log('[cascade] storage node is using the key from data/node-key.txt; the value is not logged.');
    }
  });
}
