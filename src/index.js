import { config } from './config.js';
import { initDb } from './db.js';
import { startMain } from './server.js';
import { startNode } from './nodeServer.js';

await initDb();

if (config.mode === 'node') {
  startNode();
} else {
  startMain();
}
