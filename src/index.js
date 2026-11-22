import { config } from './config.js';
import { loadDb } from './db.js';
import { startMain } from './server.js';
import { startNode } from './nodeServer.js';

loadDb();

if (config.mode === 'node') {
  startNode();
} else {
  startMain();
}
