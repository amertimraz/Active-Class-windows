'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const log = require('./logger').create('db');

const dataDir = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'activeclass.db');
const jsonDbFile = path.join(dataDir, 'activeclass.db.json');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database.
// We keep the real connection in a mutable internal variable and expose it
// through a Proxy so that callers can always do `db.prepare(...)` even after
// the underlying connection is swapped (e.g. on restore). This avoids stale
// references that previously broke /api/restore.
let _db;

function applyPragmas(conn) {
    conn.pragma('journal_mode = WAL');
    conn.pragma('synchronous = NORMAL');
}

function openDB() {
    _db = new Database(dbFile);
    applyPragmas(_db);
    return _db;
}

function closeDB() {
    try { _db && _db.close(); } catch { /* already closed */ }
}

function reconnect() {
    closeDB();
    return openDB();
}

openDB();

// Live proxy: always forwards to the current connection.
const db = new Proxy({}, {
    get(_target, prop) {
        const value = _db[prop];
        return typeof value === 'function' ? value.bind(_db) : value;
    }
});

// --- Schema Initialization ---
db.exec(`
  CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    group_id TEXT,
    duration INTEGER,
    status TEXT DEFAULT 'active',
    settings_json TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    type TEXT DEFAULT 'mcq',
    text TEXT NOT NULL,
    image TEXT,
    options_json TEXT DEFAULT '[]',
    correct_answer INTEGER,
    difficulty TEXT,
    points INTEGER DEFAULT 1,
    explanation TEXT,
    position INTEGER,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    test_id TEXT NOT NULL,
    student_id TEXT,
    student_name TEXT,
    answers_json TEXT DEFAULT '[]',
    score_correct INTEGER,
    score_total INTEGER,
    score_percent INTEGER,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS short_links (
    short TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ai_lessons (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    content_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// --- One-time Migration from JSON ---
function migrateFromJSON() {
    if (!fs.existsSync(jsonDbFile)) return;

    const quizCount = db.prepare('SELECT COUNT(*) as count FROM quizzes').get().count;
    if (quizCount > 0) {
        log.info('[DB] SQLite already has data, skipping JSON migration.');
        return;
    }

    try {
        log.info('[DB] Migrating data from activeclass.db.json...');
        const jsonContent = fs.readFileSync(jsonDbFile, 'utf8');
        const dbData = JSON.parse(jsonContent);

        const insertQuiz = db.prepare(`
            INSERT INTO quizzes (id, name, description, group_id, duration, status, settings_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertQuestion = db.prepare(`
            INSERT INTO questions (id, quiz_id, type, text, image, options_json, correct_answer, difficulty, points, explanation, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertResult = db.prepare(`
            INSERT INTO results (id, test_id, student_id, student_name, answers_json, score_correct, score_total, score_percent, ts)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertLink = db.prepare(`
            INSERT INTO short_links (short, quiz_id, created_at)
            VALUES (?, ?, ?)
        `);

        const insertSetting = db.prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `);

        db.transaction(() => {
            if (Array.isArray(dbData.quizzes)) {
                dbData.quizzes.forEach(q => {
                    insertQuiz.run(q.id, q.name || 'Quiz', q.description || '', q.group_id || q.groupId, q.duration, q.status || 'active', q.settings_json || '{}', q.created_at || q.createdAt, q.updated_at || q.updatedAt);
                });
            }

            if (Array.isArray(dbData.questions)) {
                dbData.questions.forEach(q => {
                    insertQuestion.run(q.id, q.quiz_id, q.type || 'mcq', q.text || '', q.image || null, q.options_json || '[]', q.correct_answer, q.difficulty, q.points ?? 1, q.explanation || '', q.position);
                });
            }

            if (Array.isArray(dbData.results)) {
                dbData.results.forEach(r => {
                    insertResult.run(r.id, r.test_id, r.student_id, r.student_name, r.answers_json || '[]', r.score_correct, r.score_total, r.score_percent, r.ts);
                });
            }

            if (Array.isArray(dbData.short_links)) {
                dbData.short_links.forEach(l => {
                    insertLink.run(l.short, l.quiz_id, l.created_at);
                });
            }

            if (dbData.settings && typeof dbData.settings === 'object') {
                Object.entries(dbData.settings).forEach(([k, v]) => {
                    const valueStr = typeof v === 'string' ? v : JSON.stringify(v);
                    insertSetting.run(k, valueStr);
                });
            }
        })();

        log.info('[DB] Migration complete.');
        // Rename the old JSON file to prevent repeated migration
        fs.renameSync(jsonDbFile, jsonDbFile + '.migrated');
    } catch (e) {
        log.error('[DB] Migration error:', e.message);
    }
}

migrateFromJSON();

// Default settings
const defaults = {
    language: 'ar',
    theme: 'light',
    showAnimations: 'true',
    showNotifications: 'true'
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
Object.entries(defaults).forEach(([k, v]) => {
    insertSetting.run(k, v);
});

module.exports = {
    db,
    // Connection lifecycle helpers (used by /api/restore)
    openDB,
    closeDB,
    reconnect,
    // Compatibility exports (empty objects for now)
    dbData: {},
    saveDB: () => {}
};
