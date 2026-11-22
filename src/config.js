import 'dotenv/config';
import path from 'node:path';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  mode: (process.env.SERVER_MODE || 'main').toLowerCase() === 'node' ? 'node' : 'main',
  sessionSecret: process.env.SESSION_SECRET || 'cascade-dev-secret-change-me',
  dbPath: process.env.DB_PATH || './data/db.json',
  storageDir: process.env.STORAGE_DIR || './data/uploads',
  nodeAccessKey: process.env.NODE_ACCESS_KEY || '',
  healthcheckInterval: parseInt(process.env.HEALTHCHECK_INTERVAL_MS || '30000', 10),
  envTheme: {
    siteName: process.env.SITE_NAME || 'Cascade',
    accent: process.env.THEME_ACCENT || '#e11d48',
    bg: process.env.THEME_BG || '#0a0a0b',
    surface: process.env.THEME_SURFACE || '#131316',
    text: process.env.THEME_TEXT || '#f4f4f5',
  },
};

export function dataDir() {
  return path.dirname(config.dbPath);
}
