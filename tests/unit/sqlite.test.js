'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Isolate the DB in a throwaway directory so the test never touches real data.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-sqlite-test-'));
process.env.APP_DATA_DIR = tmpDir;

const sqlite = require('../../server/sqlite');

after(() => {
  try {
    sqlite.closeDB();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('default settings are seeded on init', () => {
  const count = sqlite.db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
  assert.ok(count >= 4, `expected seeded settings, got ${count}`);
});

test('db proxy keeps working after closeDB + openDB (restore path)', () => {
  const before = sqlite.db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
  sqlite.closeDB();
  sqlite.openDB();
  const after = sqlite.db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
  assert.strictEqual(after, before, 'row count should survive a reconnect');
});

test('reconnect() returns a usable connection', () => {
  sqlite.reconnect();
  const one = sqlite.db.prepare('SELECT 1 AS x').get().x;
  assert.strictEqual(one, 1);
});
