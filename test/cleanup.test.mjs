import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanUnusedStorage, removeUnusedStorage } from '../src/cleanup.js';
import { validateNewAccount } from '../src/accounts.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-cleanup-'));
}

test('storage scan finds only blobs with no file record', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'known-id'), 'keep me');
  fs.writeFileSync(path.join(dir, 'orphan-a'), 'unused');
  fs.writeFileSync(path.join(dir, 'orphan-b'), 'unused twice');
  fs.mkdirSync(path.join(dir, 'a-directory'));
  const result = scanUnusedStorage({ storageDir: dir, knownIds: ['known-id'] });
  assert.deepEqual(result.files.map((f) => f.name), ['orphan-b', 'orphan-a']);
  assert.equal(result.files.length, 2);
  assert.equal(result.bytes, 18);
  assert.equal(result.totalFiles, 3);
  assert.equal(result.knownFiles, 1);
  assert.equal(result.skipped, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cleanup deletes only scanned orphan files and leaves records alone', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'known-id'), 'keep me');
  fs.writeFileSync(path.join(dir, 'orphan-a'), 'unused');
  const scan = scanUnusedStorage({ storageDir: dir, knownIds: ['known-id'] });
  const removed = removeUnusedStorage({ storageDir: dir, files: scan.files });
  assert.equal(removed.deleted.length, 1);
  assert.equal(fs.existsSync(path.join(dir, 'known-id')), true);
  assert.equal(fs.existsSync(path.join(dir, 'orphan-a')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('registration validation rejects weak names and passwords', () => {
  assert.equal(validateNewAccount({ username: 'no', password: '123456' }).ok, false);
  assert.equal(validateNewAccount({ username: '../admin', password: '123456' }).ok, false);
  assert.equal(validateNewAccount({ username: 'valid.user', password: '12345' }).ok, false);
  assert.deepEqual(validateNewAccount({ username: ' valid.user ', password: '123456' }), { ok: true, username: 'valid.user' });
});
