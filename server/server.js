const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const os = require('os');
const AdmZip = require('adm-zip');
const { db, openDB, closeDB } = require('./sqlite');
const { generateQuizFromPDF, extractQuizQuestions } = require('./ai-service');
const log = require('./logger').create('server');

// ── Firebase Admin (shared Firestore for license requests) ─────────────────
// SECURITY: this used to be a hardcoded service-account private key baked
// directly into this file — which electron-builder then shipped inside
// every installer, extractable by anyone via `asar extract` on the
// distributed app. That key grants full admin read/write access to the
// Firestore project and must never ship to end-user machines. It is now
// loaded ONLY from an environment variable that you set on your own
// machine/build server — it is never committed to the repo or bundled into
// the app. If it's absent (as it will be for every end-user install),
// Firestore-backed license sync is simply disabled and the code falls back
// to the local licenses.json file (see readLicenses/writeLicenses below).
//
// IMPORTANT: the previously-hardcoded key was exposed in git history and in
// every build shipped so far — rotate/revoke it in the Firebase console
// (Project Settings → Service Accounts) and generate a new one, then set it
// via FIREBASE_SERVICE_ACCOUNT_JSON (the full JSON key file contents, as a
// single-line string) only in your own local/admin environment.
function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (e) { log.error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON:', e.message); return null; }
}

// Project id is not a secret (it's part of every Firebase web config) — safe
// to hardcode. Used only for the public REST fallback below, never for
// admin-privileged access.
const FIREBASE_PROJECT_ID = 'active-class-windows';

// Public, credential-free fallback for submitting a license request from a
// normal end-user machine (which never has FIREBASE_SERVICE_ACCOUNT_JSON
// set — see loadServiceAccount above). Writes straight to Firestore's REST
// API with no auth at all; safety comes entirely from Firestore Security
// Rules restricting the `license-requests` collection to create-only
// (no read/update/delete) for unauthenticated requests — see the rules
// snippet shared with the admin. This intentionally skips the
// query-then-upsert-by-machineId dance the admin-SDK path does below,
// since anonymous requests aren't granted read access to de-dupe against;
// a stray duplicate "pending" doc is harmless and the admin can still mark
// either one done.
async function createLicenseRequestPublic(payload) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/license-requests`;
  const body = {
    fields: {
      id:          { stringValue: payload.id },
      name:        { stringValue: payload.name },
      phone:       { stringValue: payload.phone },
      machineId:   { stringValue: payload.machineId },
      requestedAt: { stringValue: payload.requestedAt },
      status:      { stringValue: payload.status },
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.ok;
}

// Same idea as createLicenseRequestPublic, for logging that a trial started
// on a machine with no admin credentials (i.e. every normal end-user
// install) — writes straight to Firestore's REST API, restricted to
// create-only for this collection by the same Security Rules.
async function createTrialLogPublic(payload) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/trial-log`;
  const body = {
    fields: {
      machineId:   { stringValue: payload.machineId },
      name:        { stringValue: payload.name || '' },
      phone:       { stringValue: payload.phone || '' },
      activatedAt: { stringValue: payload.activatedAt },
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.ok;
}

// ── Public (credential-free) license lookup/activation ─────────────────────
// License verification is the one Firestore-backed flow that runs on every
// paying customer's machine, not just the admin's — so it MUST work without
// FIREBASE_SERVICE_ACCOUNT_JSON. Licenses are stored with their license
// `key` as the Firestore document ID (see writeLicenseDoc below), so a
// customer's machine can fetch exactly its own license by a direct `get`
// on a known document path — Firestore Security Rules allow `get` on
// /licenses/{key} for anyone, but deny `list`, so no one can enumerate or
// browse other customers' licenses (they'd need to already know the exact
// key, which is the same thing verify itself requires).
function firestoreValueToJs(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue'    in v) return null;
  return null;
}
function firestoreDocToObject(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = firestoreValueToJs(v);
  return out;
}
function jsToFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}

async function getLicensePublic(key) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/licenses/${encodeURIComponent(key)}`;
  const resp = await fetch(url);
  if (!resp.ok) return null; // 404 = no such license, or rules denied it
  const doc = await resp.json();
  return firestoreDocToObject(doc);
}

// Generic single-doc get/delete against Firestore's public REST API, used
// for the trial-revoked/trial-resets checks below — same "get by exact
// known doc ID, no list" safety property as getLicensePublic.
async function getDocPublic(collection, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const doc = await resp.json();
  return firestoreDocToObject(doc);
}
async function deleteDocPublic(collection, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}`;
  const resp = await fetch(url, { method: 'DELETE' });
  return resp.ok;
}

// Conditional field-only update — only ever called to bind a license to a
// machine on first activation. Restricted by Security Rules to succeed
// only when the license's machineId is currently unset, so this can't be
// abused to hijack an already-activated license from another machine.
async function bindLicenseMachinePublic(key, machineId, activatedAt) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/licenses/${encodeURIComponent(key)}`
    + `?updateMask.fieldPaths=machineId&updateMask.fieldPaths=activatedAt`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        machineId:   jsToFirestoreValue(machineId),
        activatedAt: jsToFirestoreValue(activatedAt),
      },
    }),
  });
  return resp.ok;
}

let _firestore = null;
function getFirestore() {
  if (_firestore) return _firestore;
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) return null; // not configured on this machine — callers fall back to local storage
  try {
    // firebase-admin v14+ uses modular API
    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    const { getFirestore: _getFs } = require('firebase-admin/firestore');
    if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
    _firestore = _getFs();
  } catch (e) {
    log.error('Firebase init failed:', e.message);
  }
  return _firestore;
}

const app = express();
const PORT = process.env.PORT || 5000;

const publicDir = path.join(__dirname, '..', 'public');
const assetsDir = path.join(__dirname, '..', 'assets');
const dataDir = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
const dbPath = process.env.APP_DB_PATH || path.join(__dirname, '..', 'db.json');
const legacyDbPath = path.join(__dirname, '..', 'db.json');
const uploadsDir = process.env.APP_UPLOADS_DIR || path.join(publicDir, 'uploads');

// Ensure uploads directory exists
fs.mkdir(uploadsDir, { recursive: true });

// Migrate db.json from old location to userData if needed
(async () => {
  if (process.env.APP_DB_PATH && dbPath !== legacyDbPath) {
    try {
      await fs.access(dbPath);
    } catch {
      // New path doesn't exist yet — copy from legacy if available
      try {
        await fs.access(legacyDbPath);
        await fs.copyFile(legacyDbPath, dbPath);
        log.info('[db] Migrated db.json to userData:', dbPath);
      } catch {
        // No legacy file either — will be created on first readDB()
      }
    }
  }
})();

// Middleware

// Baseline security headers for every response, including the LAN-served
// student pages that the Electron CSP never covered. We mirror the renderer
// CSP (still permissive on inline/eval for now — tightening that needs
// per-page testing) but add it for browser clients too.
const CSP_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data: blob: https:; connect-src 'self' http://localhost:* https://cdnjs.cloudflare.com https://script.google.com https://script.googleusercontent.com; " +
  "media-src 'self' data: blob:; " +
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; " +
  "worker-src 'self' blob: https://cdnjs.cloudflare.com;";
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', CSP_POLICY);
  next();
});

app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));
app.use('/assets', express.static(assetsDir));
/* PDF.js v5 (local) — avoids CDN blocks & uses latest Arabic support */
app.use('/pdfjs-build', express.static(path.join(__dirname, '../node_modules/pdfjs-dist/build')));
app.use('/pdfjs-cmaps', express.static(path.join(__dirname, '../node_modules/pdfjs-dist/cmaps')));
app.use('/pdfjs-fonts', express.static(path.join(__dirname, '../node_modules/pdfjs-dist/standard_fonts')));
/* math.js (local) — scientific-calculator engine used by the whiteboard's calculator tool */
app.use('/vendor/mathjs', express.static(path.join(__dirname, '../node_modules/mathjs/lib/browser')));
app.use(express.json({ limit: '5mb' }));

// Security Middleware
const SERVER_API_KEY = process.env.SERVER_API_KEY;

// Returns true if the request carries the correct API key.
// When no key is configured (e.g. running `npm run server` standalone for
// development) we allow the request so local dev keeps working. In the packaged
// app, Electron always injects SERVER_API_KEY, so the check is enforced there.
function isAuthorized(req) {
  if (!SERVER_API_KEY) return true;
  const provided = req.get('x-api-key') || '';
  const a = Buffer.from(String(provided));
  const b = Buffer.from(SERVER_API_KEY);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

const authenticateTeacher = (req, res, next) => {
  if (isAuthorized(req)) return next();
  return res.status(401).json({ message: 'Unauthorized' });
};

// Setting keys that must never be exposed to unauthenticated callers.
function isSensitiveSettingKey(key) {
  return /api[_-]?key|secret|token|password/i.test(String(key || ''));
}

// Defense-in-depth for untrusted, student-supplied text (e.g. names submitted
// over the LAN). Strips angle brackets and control chars and caps length, so a
// stored value can't smuggle markup even into a view that forgets to escape.
function sanitizeText(value, maxLen = 120) {
  if (value == null) return null;
  let out = '';
  for (const ch of String(value)) {
    if (ch === '<' || ch === '>') continue; // no markup
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f) continue; // no control chars
    out += ch;
  }
  return out.trim().slice(0, maxLen);
}

// Multer setup for file uploads.
// Security: cap size, allow only a known-safe extension set, and never trust
// the client-supplied filename for the stored name. SVG is intentionally
// excluded because it can carry inline scripts when served from /uploads.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_CONTENT_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.txt', '.mp4', '.mp3', '.wav', '.webm',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, uniqueSuffix + ext);
  },
});

function extensionFilter(allowed) {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (allowed.has(ext)) return cb(null, true);
    cb(new Error(`نوع الملف غير مسموح به: ${ext || 'غير معروف'}`));
  };
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: extensionFilter(ALLOWED_CONTENT_EXT),
});

const pdfUpload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: extensionFilter(new Set(['.pdf'])),
});

const aiQuestionsUpload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: extensionFilter(new Set(['.pdf', '.txt', '.png', '.jpg', '.jpeg', '.webp'])),
});

// Translate multer/file-filter rejections into clean 400s instead of 500s.
function handleUpload(mw) {
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (err) {
        log.warn('Upload rejected:', err.message);
        return res.status(400).json({ message: err.message || 'Upload failed' });
      }
      next();
    });
  };
}

// --- API Endpoints ---

const DEFAULT_DB = { grades: [], quizzes: [] };

// Read data from db.json — creates the file with defaults if missing
async function readDB() {
  try {
    const data = await fs.readFile(dbPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet (fresh install) — create it
      try { await fs.writeFile(dbPath, JSON.stringify(DEFAULT_DB, null, 2), 'utf8'); } catch {}
      return { ...DEFAULT_DB };
    }
    log.error('Error reading database:', error);
    throw new Error('Could not read from database.');
  }
}

// Write data to db.json
async function writeDB(data) {
  try {
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    log.error('Error writing to database:', error);
    throw new Error('Could not write to database.');
  }
}

// Get all educational content structure
app.get('/api/educational-content', async (req, res) => {
  try {
    const content = await readDB();
    res.json({ grades: content.grades });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all quizzes from SQLite (authoritative)
app.get('/api/quizzes', authenticateTeacher, (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT q.id,
             COALESCE(q.name, 'Quiz') as name,
             q.duration,
             q.group_id as groupId,
             COALESCE(q.status, 'active') as status,
             (
               SELECT COUNT(*) FROM questions WHERE quiz_id = q.id
             ) as questionsCount
      FROM quizzes q
      ORDER BY COALESCE(q.updated_at, q.created_at) DESC
    `).all();
    res.json(rows.map(r => ({
      id: r.id,
      title: r.name,
      name: r.name,
      questionsCount: Number(r.questionsCount) || 0,
      duration: r.duration,
      groupId: r.groupId || null,
      status: r.status || 'active'
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get a single lesson's details
app.get('/api/lesson/:id', async (req, res) => {
  try {
    const content = await readDB();
    const lesson = findLesson(content.grades, req.params.id);

    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found.' });
    }

    // Augment quiz content items with titles from SQLite
    if (lesson.content && lesson.content.length > 0) {
      lesson.content.forEach(item => {
        if (item.type === 'quiz' && item.quizId) {
          const row = db.prepare('SELECT name FROM quizzes WHERE id = ?').get(item.quizId);
          if (row) item.title = row.name;
        }
      });
    }

    res.json(lesson);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload a file
const contentTrialGuard = trialGuard(t => t.content ? null : 'ميزة المحتوى التعليمي غير متاحة في النسخة التجريبية');

app.post('/api/content/upload', authenticateTeacher, contentTrialGuard, handleUpload(upload.single('file')), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  const { lessonId } = req.body;
  /* multer decodes originalname as latin1 → re-decode as UTF-8 so Arabic names are correct */
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const newContentItem = {
    id: crypto.randomUUID(),
    type: 'file',
    name: originalName,
    path: `/uploads/${req.file.filename}`,
  };

  try {
    const content = await readDB();
    const lesson = findLesson(content.grades, lessonId);
    if (!lesson) return res.status(404).json({ message: 'Lesson not found.' });

    if (!lesson.content) lesson.content = [];
    lesson.content.push(newContentItem);

    await writeDB(content);
    res.status(201).json(newContentItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add a link
app.post('/api/content/link', authenticateTeacher, contentTrialGuard, async (req, res) => {
  const { lessonId, url, title } = req.body;
  if (!lessonId || !url || !title) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const newContentItem = {
    id: crypto.randomUUID(),
    type: 'link',
    url,
    title,
  };

  try {
    const content = await readDB();
    const lesson = findLesson(content.grades, lessonId);
    if (!lesson) return res.status(404).json({ message: 'Lesson not found.' });

    if (!lesson.content) lesson.content = [];
    lesson.content.push(newContentItem);

    await writeDB(content);
    res.status(201).json(newContentItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add a whiteboard slide
app.post('/api/content/whiteboard', authenticateTeacher, contentTrialGuard, async (req, res) => {
  const { lessonId, name } = req.body;
  if (!lessonId) return res.status(400).json({ message: 'lessonId is required.' });
  const item = { id: crypto.randomUUID(), type: 'whiteboard', name: name || 'لوح رسم' };
  try {
    const content = await readDB();
    const lesson  = findLesson(content.grades, lessonId);
    if (!lesson) return res.status(404).json({ message: 'Lesson not found.' });
    if (!lesson.content) lesson.content = [];
    lesson.content.push(item);
    await writeDB(content);
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Add a quiz
app.post('/api/content/quiz', authenticateTeacher, contentTrialGuard, async (req, res) => {
  const { lessonId, quizId } = req.body;
  if (!lessonId || !quizId) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const newContentItem = {
    id: crypto.randomUUID(),
    type: 'quiz',
    quizId,
  };

  try {
    const content = await readDB();
    const lesson = findLesson(content.grades, lessonId);
    if (!lesson) return res.status(404).json({ message: 'Lesson not found.' });

    if (!lesson.content) lesson.content = [];
    lesson.content.push(newContentItem);

    await writeDB(content);
    res.status(201).json(newContentItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete content item
app.delete('/api/content/:id', authenticateTeacher, async (req, res) => {
  const { id } = req.params;
  try {
    const content = await readDB();
    let found = false;
    content.grades.forEach(grade => {
      grade.units.forEach(unit => {
        unit.lessons.forEach(lesson => {
          if (lesson.content) {
            const initialLength = lesson.content.length;
            lesson.content = lesson.content.filter(item => item.id !== id);
            if (lesson.content.length < initialLength) found = true;
          }
        });
      });
    });

    if (found) {
      await writeDB(content);
      res.status(204).send();
    } else {
      res.status(404).json({ message: 'Content item not found.' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Endpoint to reorder lessons
app.post('/api/lessons/reorder', authenticateTeacher, async (req, res) => {
  const { unitId, orderedLessonIds } = req.body;
  if (!unitId || !Array.isArray(orderedLessonIds)) {
    return res.status(400).json({ message: 'Missing or invalid parameters.' });
  }

  try {
    const content = await readDB();
    let unitFound = null;

    for (const grade of content.grades) {
      const unit = grade.units.find(u => u.id === unitId);
      if (unit) {
        unitFound = unit;
        break;
      }
    }

    if (unitFound) {
      // Create a new array of lessons in the desired order
      const orderedLessons = orderedLessonIds.map(id => unitFound.lessons.find(l => l.id === id)).filter(Boolean);
      
      // Check if all lessons were found
      if (orderedLessons.length !== unitFound.lessons.length) {
        return res.status(404).json({ message: 'One or more lesson IDs were not found in this unit.' });
      }

      unitFound.lessons = orderedLessons;
      await writeDB(content);
      res.status(200).json({ message: 'Lessons reordered successfully.' });
    } else {
      res.status(404).json({ message: 'Unit not found.' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reorder grades
app.post('/api/grades/reorder', authenticateTeacher, async (req, res) => {
  const { orderedGradeIds } = req.body;
  if (!Array.isArray(orderedGradeIds)) return res.status(400).json({ message: 'Invalid parameters.' });
  try {
    const content = await readDB();
    const ordered = orderedGradeIds.map(id => content.grades.find(g => g.id === id)).filter(Boolean);
    content.grades = ordered;
    await writeDB(content);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Reorder units within a grade
app.post('/api/units/reorder', authenticateTeacher, async (req, res) => {
  const { gradeId, orderedUnitIds } = req.body;
  if (!gradeId || !Array.isArray(orderedUnitIds)) return res.status(400).json({ message: 'Invalid parameters.' });
  try {
    const content = await readDB();
    const grade = content.grades.find(g => g.id === gradeId);
    if (!grade) return res.status(404).json({ message: 'Grade not found.' });
    const ordered = orderedUnitIds.map(id => grade.units.find(u => u.id === id)).filter(Boolean);
    grade.units = ordered;
    await writeDB(content);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Endpoint to reorder content items within a lesson
app.post('/api/content/reorder', authenticateTeacher, async (req, res) => {
  const { lessonId, orderedContentIds } = req.body;
  if (!lessonId || !Array.isArray(orderedContentIds)) {
    return res.status(400).json({ message: 'Missing or invalid parameters.' });
  }

  try {
    const content = await readDB();
    const lesson = findLesson(content.grades, lessonId);

    if (lesson) {
      if (!lesson.content) lesson.content = [];

      // Create a new array of content in the desired order
      const orderedContent = orderedContentIds.map(id => lesson.content.find(c => c.id === id)).filter(Boolean);

      // Check if all content items were found
      if (orderedContent.length !== lesson.content.length) {
         return res.status(404).json({ message: 'One or more content IDs were not found in this lesson.' });
      }

      lesson.content = orderedContent;
      await writeDB(content);
      res.status(200).json({ message: 'Content reordered successfully.' });
    } else {
      res.status(404).json({ message: 'Lesson not found.' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Helper to find a lesson by ID
function findLesson(grades, lessonId) {
  for (const grade of grades) {
    for (const unit of grade.units) {
      const lesson = unit.lessons.find(l => l.id === lessonId);
      if (lesson) return lesson;
    }
  }
  return null;
}

// Rename a grade
app.put('/api/grades/:id', authenticateTeacher, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'name is required' });
  try {
    const content = await readDB();
    const grade = content.grades.find(g => g.id === req.params.id);
    if (!grade) return res.status(404).json({ message: 'Grade not found' });
    grade.name = name;
    await writeDB(content);
    res.json(grade);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Delete a grade (cascade: removes all units, lessons, and their content files)
app.delete('/api/grades/:id', authenticateTeacher, async (req, res) => {
  try {
    const content = await readDB();
    const idx = content.grades.findIndex(g => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ message: 'Grade not found' });
    const grade = content.grades[idx];
    for (const unit of grade.units) {
      for (const lesson of unit.lessons) {
        for (const item of (lesson.content || [])) {
          if (item.path) fs.unlink(path.join(uploadsDir, path.basename(item.path))).catch(() => {});
        }
      }
    }
    content.grades.splice(idx, 1);
    await writeDB(content);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Rename a unit
app.put('/api/units/:id', authenticateTeacher, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'name is required' });
  try {
    const content = await readDB();
    for (const g of content.grades) {
      const unit = g.units.find(u => u.id === req.params.id);
      if (unit) { unit.name = name; await writeDB(content); return res.json(unit); }
    }
    res.status(404).json({ message: 'Unit not found' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Delete a unit (cascade)
app.delete('/api/units/:id', authenticateTeacher, async (req, res) => {
  try {
    const content = await readDB();
    for (const g of content.grades) {
      const idx = g.units.findIndex(u => u.id === req.params.id);
      if (idx !== -1) {
        for (const lesson of g.units[idx].lessons) {
          for (const item of (lesson.content || [])) {
            if (item.path) fs.unlink(path.join(uploadsDir, path.basename(item.path))).catch(() => {});
          }
        }
        g.units.splice(idx, 1);
        await writeDB(content);
        return res.json({ ok: true });
      }
    }
    res.status(404).json({ message: 'Unit not found' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Rename a lesson
app.put('/api/lessons/:id', authenticateTeacher, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'name is required' });
  try {
    const content = await readDB();
    for (const g of content.grades) {
      for (const u of g.units) {
        const lesson = u.lessons.find(l => l.id === req.params.id);
        if (lesson) { lesson.name = name; await writeDB(content); return res.json(lesson); }
      }
    }
    res.status(404).json({ message: 'Lesson not found' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Delete a lesson (cascade)
app.delete('/api/lessons/:id', authenticateTeacher, async (req, res) => {
  try {
    const content = await readDB();
    for (const g of content.grades) {
      for (const u of g.units) {
        const idx = u.lessons.findIndex(l => l.id === req.params.id);
        if (idx !== -1) {
          for (const item of (u.lessons[idx].content || [])) {
            if (item.path) fs.unlink(path.join(uploadsDir, path.basename(item.path))).catch(() => {});
          }
          u.lessons.splice(idx, 1);
          await writeDB(content);
          return res.json({ ok: true });
        }
      }
    }
    res.status(404).json({ message: 'Lesson not found' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Add a new grade
app.post('/api/grades', authenticateTeacher, contentTrialGuard, async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Grade name is required.' });
  }

  try {
    const content = await readDB();
    const trial = await getActiveTrial();
    if (trial && trial.maxGrades > 0 && content.grades.length >= trial.maxGrades) {
      return res.status(403).json({ message: `الحد الأقصى للصفوف في النسخة التجريبية هو ${trial.maxGrades}` });
    }
    const newGrade = {
      id: crypto.randomUUID(),
      name,
      units: [],
    };
    content.grades.push(newGrade);
    await writeDB(content);
    res.status(201).json(newGrade);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add a new unit to a grade
app.post('/api/units', authenticateTeacher, contentTrialGuard, async (req, res) => {
  const { gradeId, name } = req.body;
  if (!gradeId || !name) {
    return res.status(400).json({ message: 'Grade ID and unit name are required.' });
  }

  try {
    const content = await readDB();
    const grade = content.grades.find(g => g.id === gradeId);
    if (!grade) {
      return res.status(404).json({ message: 'Grade not found.' });
    }
    const trial = await getActiveTrial();
    if (trial && trial.maxUnits > 0) {
      const totalUnits = content.grades.reduce((s, g) => s + (g.units?.length || 0), 0);
      if (totalUnits >= trial.maxUnits) {
        return res.status(403).json({ message: `الحد الأقصى للوحدات في النسخة التجريبية هو ${trial.maxUnits}` });
      }
    }
    const newUnit = {
      id: crypto.randomUUID(),
      name,
      lessons: [],
    };
    grade.units.push(newUnit);
    await writeDB(content);
    res.status(201).json(newUnit);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== AI Interactive Lessons Endpoints =====

// Generate new AI Lesson from PDF
app.post('/api/generate-ai-quiz', authenticateTeacher, handleUpload(pdfUpload.single('pdf')), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'الرجاء رفع ملف PDF.' });
  }

  const title = req.body.title || req.file.originalname.replace('.pdf', '');
  
  try {
    // Get Groq API key from settings
    const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'groq_api_key'").get();
    let apiKey = '';
    if (settingRow) {
      try { apiKey = JSON.parse(settingRow.value); } catch { apiKey = settingRow.value; }
    }

    if (!apiKey) {
      return res.status(400).json({ message: 'مفتاح API الخاص بـ Groq غير موجود. أضفه من الإعدادات ← الذكاء الاصطناعي.' });
    }

    // Call AI Service
    const quizJson = await generateQuizFromPDF(req.file.path, apiKey);

    // Save to Database
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO ai_lessons (id, title, content_json, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(id, title, JSON.stringify(quizJson));

    // Optional: remove uploaded PDF file after processing to save space
    fs.unlink(req.file.path).catch((e) => log.error('Failed to remove uploaded PDF:', e));

    res.status(201).json({ id, title, message: 'تم إنشاء الدرس التفاعلي بنجاح!' });
  } catch (error) {
    log.error('=== AI Generation Error ===');
    log.error('Message:', error.message);
    log.error('Stack:', error.stack);
    log.error('===========================');
    res.status(500).json({ message: error.message || 'حدث خطأ أثناء معالجة الملف.' });
  }
});

// Extract quiz questions from an uploaded file (lesson explanation or a
// photographed/typed questions sheet) using the Groq API key from settings.
// Returns the extracted questions for the teacher to review — it does NOT
// create/save a quiz; that happens separately once the teacher confirms.
app.post('/api/quizzes/generate-questions', authenticateTeacher, handleUpload(aiQuestionsUpload.single('file')), async (req, res) => {
  const pastedText = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!req.file && !pastedText) {
    return res.status(400).json({ message: 'الرجاء رفع ملف أو لصق نص (PDF أو صورة أو نص).' });
  }

  // Pasted text reuses the exact same plain-text extraction pathway as an
  // uploaded .txt file — just write it out to a temp file first — so all
  // the existing chunking/top-up/provider logic works unchanged.
  let filePath = req.file?.path;
  let mimeType = req.file?.mimetype;
  let tempTextFile = null;
  if (!req.file && pastedText) {
    tempTextFile = path.join(uploadsDir, `pasted-${crypto.randomUUID()}.txt`);
    await fs.mkdir(uploadsDir, { recursive: true }).catch(() => {});
    await fs.writeFile(tempTextFile, pastedText, 'utf8');
    filePath = tempTextFile;
    mimeType = 'text/plain';
  }

  try {
    const provider = req.body.provider === 'gemini' ? 'gemini' : 'groq';
    const settingKey = provider === 'gemini' ? 'gemini_api_key' : 'groq_api_key';
    const settingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey);
    let apiKey = '';
    if (settingRow) {
      try { apiKey = JSON.parse(settingRow.value); } catch { apiKey = settingRow.value; }
    }

    if (!apiKey) {
      const providerLabel = provider === 'gemini' ? 'Google Gemini' : 'Groq';
      return res.status(400).json({ message: `مفتاح API الخاص بـ ${providerLabel} غير موجود. أضفه من الإعدادات ← الذكاء الاصطناعي.` });
    }

    const mcqCount = parseInt(req.body.mcqCount, 10);
    const tfCount = parseInt(req.body.tfCount, 10);
    const maxPages = parseInt(req.body.maxPages, 10);
    const counts = {
      mcqCount: Number.isFinite(mcqCount) ? mcqCount : undefined,
      tfCount: Number.isFinite(tfCount) ? tfCount : undefined,
      maxPages: Number.isFinite(maxPages) ? maxPages : undefined,
    };

    const { questions, meta } = await extractQuizQuestions(filePath, mimeType, apiKey, counts, provider);
    res.json({ questions, meta });
  } catch (error) {
    log.error('AI question extraction error:', error.message);
    res.status(500).json({ message: error.message || 'حدث خطأ أثناء معالجة الملف.' });
  } finally {
    if (req.file) fs.unlink(req.file.path).catch(() => {});
    if (tempTextFile) fs.unlink(tempTextFile).catch(() => {});
  }
});

// Get all AI Lessons
app.get('/api/ai-lessons', authenticateTeacher, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, title, description, created_at FROM ai_lessons ORDER BY created_at DESC').all();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single AI Lesson content
app.get('/api/ai-lessons/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT id, title, content_json FROM ai_lessons WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ message: 'الدرس غير موجود.' });
    
    res.json({
      id: row.id,
      title: row.title,
      content: JSON.parse(row.content_json)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add a new lesson to a unit
app.post('/api/lessons', authenticateTeacher, contentTrialGuard, async (req, res) => {
  const { unitId, name } = req.body;
  if (!unitId || !name) {
    return res.status(400).json({ message: 'Unit ID and lesson name are required.' });
  }

  try {
    const content = await readDB();
    let unit = null;
    for (const grade of content.grades) {
      unit = grade.units.find(u => u.id === unitId);
      if (unit) break;
    }

    if (!unit) {
      return res.status(404).json({ message: 'Unit not found.' });
    }
    const trial = await getActiveTrial();
    if (trial && trial.maxLessons > 0) {
      const totalLessons = content.grades.reduce((s, g) => s + g.units.reduce((s2, u) => s2 + (u.lessons?.length || 0), 0), 0);
      if (totalLessons >= trial.maxLessons) {
        return res.status(403).json({ message: `الحد الأقصى للدروس في النسخة التجريبية هو ${trial.maxLessons}` });
      }
    }
    const newLesson = {
      id: crypto.randomUUID(),
      name,
      content: [],
    };
    unit.lessons.push(newLesson);
    await writeDB(content);
    res.status(201).json(newLesson);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== Student Quiz Endpoints (LAN-accessible) =====
const fssync = require('fs');
// dataDir is already defined above
const resultsPath = path.join(dataDir, 'results.json');
const studentsPath = path.join(dataDir, 'students.json');
const groupsPath = path.join(dataDir, 'groups.json');
const tempQuizzesPath = path.join(dataDir, 'temp_quizzes.json');

function ensureDataFiles() {
  try { if (!fssync.existsSync(dataDir)) fssync.mkdirSync(dataDir, { recursive: true }); } catch {}
  const seed = (p, v) => { try { if (!fssync.existsSync(p)) fssync.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); } catch {} };
  seed(resultsPath, []);
  seed(studentsPath, []);
  seed(groupsPath, []);
}
ensureDataFiles();

async function readJSONFile(filepath, fallback) {
  try {
    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

// GET /api/local-ip is defined once below (see "LAN IP discovery") using
// getLocalIPv4s(); the earlier duplicate route + listLocalIPs() were removed.

// [Consolidated] GET /api/quizzes/:id is defined later in the file with short link support

// ===== Groups & Students — SQLite CRUD =====

function rowToStudent(r) {
  const extra = parseJSONSafe(r.extra_json, {});
  return { id: r.id, groupId: r.group_id, name: r.name, code: r.code, gender: r.gender, photo: r.photo, attendanceDate: r.attendance_date, notes: r.notes, ...extra };
}

function rowToGroup(r) {
  const { studentCount: _sc, studentsCount: _old, ...extra } = parseJSONSafe(r.extra_json, {});
  return { id: r.id, name: r.name, color: r.color, icon: r.icon, studentCount: r.student_count ?? 0, ...extra };
}

// GET /api/students
app.get('/api/students', (_req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM students ORDER BY name').all().map(rowToStudent));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/groups
app.get('/api/groups', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT g.*, COUNT(s.id) AS student_count
      FROM groups g
      LEFT JOIN students s ON s.group_id = g.id
      GROUP BY g.id
      ORDER BY g.name
    `).all();
    res.json(rows.map(rowToGroup));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/group/:id/students
app.get('/api/group/:id/students', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM students WHERE group_id = ? ORDER BY name').all(req.params.id).map(rowToStudent));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PUT /api/groups/bulk — upsert groups list (never DELETE to avoid ON DELETE SET NULL cascade)
app.put('/api/groups/bulk', authenticateTeacher, async (req, res) => {
  try {
    const groups = Array.isArray(req.body) ? req.body : [];
    const trial = await getActiveTrial();
    if (trial && groups.length > trial.maxGroups) {
      return res.status(403).json({ message: `النسخة التجريبية تسمح بـ ${trial.maxGroups} ${trial.maxGroups === 1 ? 'مجموعة' : 'مجموعات'} كحد أقصى` });
    }
    const now = new Date().toISOString();
    db.transaction(() => {
      const upsert = db.prepare(`
        INSERT INTO groups (id,name,color,icon,extra_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, color=excluded.color, icon=excluded.icon,
          extra_json=excluded.extra_json, updated_at=excluded.updated_at
      `);
      const incomingIds = [];
      for (const g of groups) {
        const { id, name, color, icon, created_at, updated_at, ...rest } = g;
        delete rest.students;
        const gid = id || crypto.randomUUID();
        incomingIds.push(gid);
        upsert.run(gid, name || 'مجموعة', color || '#6366f1', icon || null, JSON.stringify(rest), created_at || now, updated_at || now);
      }
      // حذف المجموعات المحذوفة — لكن بعد نقل طلابها لـ NULL بشكل صريح قبل الحذف
      if (incomingIds.length > 0) {
        const placeholders = incomingIds.map(() => '?').join(',');
        db.prepare(`UPDATE students SET group_id = NULL WHERE group_id NOT IN (${placeholders})`).run(...incomingIds);
        db.prepare(`DELETE FROM groups WHERE id NOT IN (${placeholders})`).run(...incomingIds);
      }
    })();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PUT /api/students/bulk — replace entire students list (used by save-students IPC)
app.put('/api/students/bulk', authenticateTeacher, async (req, res) => {
  try {
    const students = Array.isArray(req.body) ? req.body : [];
    const trial = await getActiveTrial();
    if (trial && students.length > trial.maxStudents) {
      return res.status(403).json({ message: `النسخة التجريبية تسمح بـ ${trial.maxStudents} طلاب كحد أقصى` });
    }
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('DELETE FROM students').run();
      const ins = db.prepare('INSERT INTO students (id,group_id,name,code,gender,photo,attendance_date,notes,extra_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const s of students) {
        const { id, group_id, groupId, name, code, gender, photo, attendance_date, attendanceDate, notes, created_at, updated_at, ...rest } = s;
        ins.run(id || crypto.randomUUID(), group_id || groupId || null, name || '', code || null, gender || null, photo || null, attendance_date || attendanceDate || null, notes || null, JSON.stringify(rest), created_at || now, updated_at || now);
      }
    })();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/students — add single student
app.post('/api/students', authenticateTeacher, async (req, res) => {
  try {
    const { id, group_id, groupId, name, code, gender, photo, attendanceDate, notes, ...rest } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name is required' });
    const trial = await getActiveTrial();
    if (trial) {
      const count = db.prepare('SELECT COUNT(*) as c FROM students').get().c;
      if (count >= trial.maxStudents) return res.status(403).json({ message: `النسخة التجريبية تسمح بـ ${trial.maxStudents} طلاب كحد أقصى` });
    }
    const now = new Date().toISOString();
    const sid = id || crypto.randomUUID();
    db.prepare('INSERT INTO students (id,group_id,name,code,gender,photo,attendance_date,notes,extra_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(sid, group_id || groupId || null, name, code || null, gender || null, photo || null, attendanceDate || null, notes || null, JSON.stringify(rest), now, now);
    res.status(201).json({ ok: true, student: rowToStudent(db.prepare('SELECT * FROM students WHERE id=?').get(sid)) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PUT /api/students/:id — update single student
app.put('/api/students/:id', authenticateTeacher, (req, res) => {
  try {
    const prev = db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);
    if (!prev) return res.status(404).json({ message: 'Student not found' });
    const { name, code, gender, photo, group_id, groupId, attendanceDate, notes, ...rest } = req.body || {};
    const now = new Date().toISOString();
    db.prepare('UPDATE students SET name=?,code=?,gender=?,photo=?,group_id=?,attendance_date=?,notes=?,extra_json=?,updated_at=? WHERE id=?')
      .run(name || prev.name, code ?? prev.code, gender ?? prev.gender, photo ?? prev.photo, group_id || groupId || prev.group_id, attendanceDate ?? prev.attendance_date, notes ?? prev.notes, JSON.stringify(rest), now, req.params.id);
    res.json({ ok: true, student: rowToStudent(db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id)) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// DELETE /api/students/:id
app.delete('/api/students/:id', authenticateTeacher, (req, res) => {
  try {
    const info = db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ message: 'Student not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/groups — add single group
app.post('/api/groups', authenticateTeacher, async (req, res) => {
  try {
    const { id, name, color, icon, ...rest } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name is required' });
    const trial = await getActiveTrial();
    if (trial) {
      const count = db.prepare('SELECT COUNT(*) as c FROM groups').get().c;
      if (count >= trial.maxGroups) return res.status(403).json({ message: `النسخة التجريبية تسمح بـ ${trial.maxGroups} ${trial.maxGroups === 1 ? 'مجموعة' : 'مجموعات'} كحد أقصى` });
    }
    const now = new Date().toISOString();
    const gid = id || crypto.randomUUID();
    db.prepare('INSERT INTO groups (id,name,color,icon,extra_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(gid, name, color || '#6366f1', icon || null, JSON.stringify(rest), now, now);
    res.status(201).json({ ok: true, group: rowToGroup(db.prepare('SELECT * FROM groups WHERE id=?').get(gid)) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PUT /api/groups/:id — update single group
app.put('/api/groups/:id', authenticateTeacher, (req, res) => {
  try {
    const prev = db.prepare('SELECT * FROM groups WHERE id=?').get(req.params.id);
    if (!prev) return res.status(404).json({ message: 'Group not found' });
    const { name, color, icon, ...rest } = req.body || {};
    const now = new Date().toISOString();
    db.prepare('UPDATE groups SET name=?,color=?,icon=?,extra_json=?,updated_at=? WHERE id=?')
      .run(name || prev.name, color || prev.color, icon ?? prev.icon, JSON.stringify(rest), now, req.params.id);
    res.json({ ok: true, group: rowToGroup(db.prepare('SELECT * FROM groups WHERE id=?').get(req.params.id)) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// DELETE /api/groups/:id
app.delete('/api/groups/:id', authenticateTeacher, (req, res) => {
  try {
    const info = db.prepare('DELETE FROM groups WHERE id=?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ message: 'Group not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/submit-answers → store submission in SQLite
app.post('/api/submit-answers', async (req, res) => {
  try {
    const { testId, studentId, studentName, answers, duration } = req.body || {};
    if (!testId || !Array.isArray(answers)) {
      return res.status(400).json({ message: 'Invalid payload' });
    }
    const cleanName = sanitizeText(studentName);
    const cleanStudentId = sanitizeText(studentId, 64);

    // Compute score from DB
    const qs = db.prepare(`SELECT id, correct_answer FROM questions WHERE quiz_id = ?`).all(testId);
    const answerMap = new Map(qs.map(q => [q.id, q.correct_answer]));
    let correct = 0;
    for (const a of answers) {
      const ca = answerMap.get(a.questionId);
      if (typeof ca === 'number' && a.answerIndex === ca) correct++;
    }
    const total = qs.length;
    const percent = total ? Math.round((correct / total) * 100) : 0;

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO results (id, test_id, student_id, student_name, answers_json, score_correct, score_total, score_percent, duration, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, testId, cleanStudentId || null, cleanName || null, JSON.stringify(answers), correct, total, percent, Number(duration) || 0, new Date().toISOString());

    // notify live results listeners
    broadcastResults(testId);
    return res.status(201).json({ ok: true, message: 'تم تسجيل الإجابة بنجاح', recordId: id, score: { correct, total, percent } });
  } catch (e) {
    return res.status(500).json({ message: 'Internal error' });
  }
});

// GET /results?testId=... (from SQLite)
app.get('/results', authenticateTeacher, (req, res) => {
  try {
    const testId = req.query.testId;
    const rows = testId
      ? db.prepare(`SELECT * FROM results WHERE test_id = ? ORDER BY ts DESC`).all(testId)
      : db.prepare(`SELECT * FROM results ORDER BY ts DESC`).all();
    const list = rows.map(r => ({
      id: r.id,
      testId: r.test_id,
      studentId: r.student_id,
      studentName: r.student_name,
      answers: (() => { try { return JSON.parse(r.answers_json || '[]'); } catch { return []; } })(),
      score: {
        correct: r.score_correct,
        total: r.score_total,
        percent: r.score_percent,
      },
      ts: r.ts,
    }));
    res.json(list);
  } catch (e) {
    res.status(500).json({ message: 'Internal error' });
  }
});

// ===== Quiz & Questions CRUD (SQLite) =====

// Create a new quiz
app.post('/api/quizzes', authenticateTeacher, async (req, res) => {
  try {
    const { name, description, groupId, duration, status, settings } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ message: 'name is required' });
    const trial = await getActiveTrial();
    if (trial) {
      const count = db.prepare('SELECT COUNT(*) as c FROM quizzes').get().c;
      if (count >= trial.maxQuizzes) return res.status(403).json({ message: `النسخة التجريبية تسمح بـ ${trial.maxQuizzes} اختبارات كحد أقصى` });
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO quizzes (id, name, description, group_id, duration, status, settings_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description || '', groupId || null, duration || null, status || 'active', JSON.stringify(settings || {}), now, now);

    // Generate short link automatically
    ensureShortLinksTable();
    const short = generateShortNumeric();
    db.prepare('INSERT INTO short_links (short, quiz_id, created_at) VALUES (?, ?, ?)').run(short, id, now);

    const quiz = db.prepare(`SELECT id, name, description, group_id as groupId, duration, status, settings_json as settingsJson, created_at as createdAt, updated_at as updatedAt FROM quizzes WHERE id = ?`).get(id);
    res.status(201).json({
      id: quiz.id,
      name: quiz.name,
      description: quiz.description,
      groupId: quiz.groupId,
      duration: quiz.duration,
      status: quiz.status,
      settings: (() => { try { return JSON.parse(quiz.settingsJson || '{}'); } catch { return {}; } })(),
      createdAt: quiz.createdAt,
      updatedAt: quiz.updatedAt,
      short
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update a quiz
app.put('/api/quizzes/:id', authenticateTeacher, (req, res) => {
  try {
    const id = req.params.id;
    const exists = db.prepare(`SELECT 1 FROM quizzes WHERE id = ?`).get(id);
    if (!exists) return res.status(404).json({ message: 'Quiz not found' });

    const { name, description, groupId, duration, status, settings } = req.body || {};
    const now = new Date().toISOString();
    const prev = db.prepare(`SELECT * FROM quizzes WHERE id = ?`).get(id);

    db.prepare(`
      UPDATE quizzes SET
        name = ?,
        description = ?,
        group_id = ?,
        duration = ?,
        status = ?,
        settings_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      typeof name === 'string' ? name : prev.name,
      typeof description === 'string' ? description : (prev.description || ''),
      typeof groupId !== 'undefined' ? groupId : prev.group_id,
      typeof duration !== 'undefined' ? duration : prev.duration,
      typeof status === 'string' ? status : (prev.status || 'active'),
      JSON.stringify(typeof settings !== 'undefined' ? settings : (() => { try { return JSON.parse(prev.settings_json || '{}'); } catch { return {}; } })()),
      now,
      id
    );

    const q = db.prepare(`SELECT * FROM quizzes WHERE id = ?`).get(id);
    res.json({
      id: q.id,
      name: q.name,
      description: q.description,
      groupId: q.group_id,
      duration: q.duration,
      status: q.status,
      settings: (() => { try { return JSON.parse(q.settings_json || '{}'); } catch { return {}; } })(),
      createdAt: q.created_at,
      updatedAt: q.updated_at,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete a quiz (cascade deletes questions)
app.delete('/api/quizzes/:id', authenticateTeacher, (req, res) => {
  try {
    const id = req.params.id;
    const info = db.prepare(`DELETE FROM quizzes WHERE id = ?`).run(id);
    if (info.changes === 0) return res.status(404).json({ message: 'Quiz not found' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// [Consolidated] POST /api/quizzes/:id/questions is defined later in the file

// Update a question
app.put('/api/questions/:id', authenticateTeacher, (req, res) => {
  try {
    const id = req.params.id;
    const prev = db.prepare(`SELECT * FROM questions WHERE id = ?`).get(id);
    if (!prev) return res.status(404).json({ message: 'Question not found' });

    const { type, text, image, options, correctAnswer, difficulty, points, explanation, position } = req.body || {};

    db.prepare(`
      UPDATE questions SET
        type = ?,
        text = ?,
        image = ?,
        options_json = ?,
        correct_answer = ?,
        difficulty = ?,
        points = ?,
        explanation = ?,
        position = COALESCE(?, position)
      WHERE id = ?
    `).run(
      typeof type === 'string' ? type : prev.type,
      typeof text === 'string' ? text : prev.text,
      typeof image !== 'undefined' ? image : prev.image,
      JSON.stringify(typeof options !== 'undefined' ? options : (() => { try { return JSON.parse(prev.options_json || '[]'); } catch { return []; } })()),
      typeof correctAnswer !== 'undefined' ? correctAnswer : prev.correct_answer,
      typeof difficulty !== 'undefined' ? difficulty : prev.difficulty,
      typeof points !== 'undefined' ? points : prev.points,
      typeof explanation !== 'undefined' ? explanation : prev.explanation,
      typeof position === 'number' ? position : null,
      id
    );

    const q = db.prepare(`SELECT * FROM questions WHERE id = ?`).get(id);
    res.json({
      id: q.id,
      quizId: q.quiz_id,
      type: q.type,
      text: q.text,
      image: q.image,
      options: (() => { try { return JSON.parse(q.options_json || '[]'); } catch { return []; } })(),
      correctAnswer: q.correct_answer,
      difficulty: q.difficulty,
      points: q.points,
      explanation: q.explanation,
      position: q.position,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete a question
app.delete('/api/questions/:id', authenticateTeacher, (req, res) => {
  try {
    const id = req.params.id;
    const info = db.prepare(`DELETE FROM questions WHERE id = ?`).run(id);
    if (info.changes === 0) return res.status(404).json({ message: 'Question not found' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reorder questions in a quiz
app.post('/api/quizzes/:id/questions/reorder', authenticateTeacher, (req, res) => {
  try {
    const quizId = req.params.id;
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ message: 'order must be an array of { id, position }' });

    const trx = db.transaction(() => {
      const upd = db.prepare(`UPDATE questions SET position = ? WHERE id = ? AND quiz_id = ?`);
      for (const item of order) {
        if (!item || typeof item.id !== 'string') continue;
        const pos = typeof item.position === 'number' ? item.position : null;
        if (pos === null) continue;
        upd.run(pos, item.id, quizId);
      }
    });
    trx();

    const rows = db.prepare(`SELECT * FROM questions WHERE quiz_id = ? ORDER BY position ASC`).all(quizId);
    res.json(rows.map(q => ({
      id: q.id,
      position: q.position,
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Results per quiz
app.get('/api/quizzes/:id/results', authenticateTeacher, (req, res) => {
  try {
    const quizId = req.params.id;
    const rows = db.prepare(`SELECT * FROM results WHERE test_id = ? ORDER BY ts DESC`).all(quizId);
    const list = rows.map(r => ({
      id: r.id,
      testId: r.test_id,
      studentId: r.student_id,
      studentName: r.student_name,
      answers: (() => { try { return JSON.parse(r.answers_json || '[]'); } catch { return []; } })(),
      score: { correct: r.score_correct, total: r.score_total, percent: r.score_percent },
      duration: r.duration || 0,
      ts: r.ts,
    }));
    res.json(list);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/quizzes/:id/results — clear all results for a quiz
app.delete('/api/quizzes/:id/results', authenticateTeacher, (req, res) => {
  try {
    const { count } = db.prepare('DELETE FROM results WHERE test_id = ?').run(req.params.id);
    // notify SSE listeners
    broadcastResults(req.params.id);
    res.json({ ok: true, deleted: count });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// SSE — real-time results stream per quiz
const sseClients = new Map(); // quizId → Set<res>

function broadcastResults(quizId) {
  const clients = sseClients.get(quizId);
  if (!clients || clients.size === 0) return;
  try {
    const rows = db.prepare('SELECT * FROM results WHERE test_id = ? ORDER BY ts DESC').all(quizId);
    const list = rows.map(r => ({
      id: r.id, testId: r.test_id, studentId: r.student_id,
      studentName: r.student_name,
      answers: (() => { try { return JSON.parse(r.answers_json || '[]'); } catch { return []; } })(),
      score: { correct: r.score_correct, total: r.score_total, percent: r.score_percent },
      duration: r.duration || 0, ts: r.ts,
    }));
    const data = `data: ${JSON.stringify(list)}\n\n`;
    for (const client of clients) {
      try { client.write(data); } catch { clients.delete(client); }
    }
  } catch {}
}

app.get('/api/quizzes/:id/results/stream', authenticateTeacher, (req, res) => {
  const quizId = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(quizId)) sseClients.set(quizId, new Set());
  sseClients.get(quizId).add(res);

  // send current data immediately
  broadcastResults(quizId);

  req.on('close', () => {
    const clients = sseClients.get(quizId);
    if (clients) { clients.delete(res); if (clients.size === 0) sseClients.delete(quizId); }
  });
});

// Settings API endpoints (GET is public for theme/lang, others are protected)
app.get('/api/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const authorized = isAuthorized(req);
    const settings = {};
    rows.forEach(row => {
      // Never leak secrets (e.g. gemini_api_key) to unauthenticated callers.
      if (isSensitiveSettingKey(row.key) && !authorized) return;
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/settings/:key', (req, res) => {
  try {
    if (isSensitiveSettingKey(req.params.key) && !isAuthorized(req)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(req.params.key);
    if (!row) {
      return res.status(404).json({ message: 'Setting not found' });
    }
    try {
      res.json({ value: JSON.parse(row.value) });
    } catch {
      res.json({ value: row.value });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/settings', authenticateTeacher, (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      return res.status(400).json({ message: 'Key is required' });
    }
    
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(key, valueStr);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/settings/:key', authenticateTeacher, (req, res) => {
  try {
    const { value } = req.body;
    const key = req.params.key;
    
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(key, valueStr);
    
    if (result.changes > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ message: 'Setting not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/settings/:key', authenticateTeacher, (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM settings WHERE key = ?');
    const result = stmt.run(req.params.key);
    
    if (result.changes > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ message: 'Setting not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Helper: copy a directory recursively
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

// Reset all data
app.post('/api/reset-all', authenticateTeacher, async (req, res) => {
  try {
    // 1. Clear SQLite tables (order respects FK constraints)
    db.prepare('DELETE FROM results').run();
    db.prepare('DELETE FROM short_links').run();
    db.prepare('DELETE FROM questions').run();
    db.prepare('DELETE FROM quizzes').run();
    db.prepare('DELETE FROM game_results').run();
    db.prepare('DELETE FROM ai_lessons').run();
    db.prepare('DELETE FROM students').run();
    db.prepare('DELETE FROM groups').run();

    // 2. Clear educational content (db.json)
    await writeDB({ grades: [], quizzes: [] });

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Database backup and restore endpoints
app.post('/api/backup', authenticateTeacher, async (req, res) => {
  try {
    const { backupPath } = req.body;
    if (!backupPath) return res.status(400).json({ message: 'Backup path is required' });

    const _n = new Date();
    const _stamp = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}_${String(_n.getHours()).padStart(2,'0')}-${String(_n.getMinutes()).padStart(2,'0')}`;
    const zipName = `activeclass_backup_${_stamp}.acbak`;
    const zipPath = path.join(backupPath, zipName);

    const zip = new AdmZip();

    // 1. SQLite database
    const liveDbPath = path.join(dataDir, 'activeclass.db');
    zip.addLocalFile(liveDbPath, '', 'activeclass.db');

    // 2. Educational content (db.json)
    if (fsSync.existsSync(dbPath)) {
      zip.addLocalFile(dbPath, '', 'db.json');
    }

    zip.writeZip(zipPath);
    res.json({ success: true, backupFile: zipPath });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/restore', authenticateTeacher, async (req, res) => {
  try {
    const { backupFile } = req.body;
    if (!backupFile || typeof backupFile !== 'string') {
      return res.status(400).json({ message: 'Backup file path is required' });
    }

    const source = path.resolve(backupFile);
    if (!fsSync.existsSync(source)) {
      return res.status(404).json({ message: 'Backup file not found' });
    }

    const liveDbPath = path.join(dataDir, 'activeclass.db');
    const stat = await fs.stat(source);

    if (stat.isDirectory()) {
      // Old folder format (backward compat)
      closeDB();
      await fs.copyFile(path.join(source, 'activeclass.db'), liveDbPath);
      openDB();
      try { await fs.copyFile(path.join(source, 'db.json'), dbPath); } catch {}

    } else if (source.endsWith('.acbak') || source.endsWith('.zip')) {
      // New ZIP format
      const zip = new AdmZip(source);
      closeDB();
      const dbEntry = zip.getEntry('activeclass.db');
      if (!dbEntry) { openDB(); return res.status(400).json({ message: 'Invalid backup file' }); }
      zip.extractEntryTo(dbEntry, dataDir, false, true);
      openDB();
      const jsonEntry = zip.getEntry('db.json');
      if (jsonEntry) zip.extractEntryTo(jsonEntry, path.dirname(dbPath), false, true);

    } else {
      // Legacy single .db file
      closeDB();
      await fs.copyFile(source, liveDbPath);
      openDB();
    }

    res.json({ success: true });
  } catch (error) {
    try { openDB(); } catch {}
    res.status(500).json({ message: error.message });
  }
});

// ===== Utility helpers =====
function parseJSONSafe(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

function getLocalIPv4s() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  // Deduplicate
  return Array.from(new Set(results));
}

// Ensure short_links table exists (idempotent)
function ensureShortLinksTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS short_links (
      short TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      created_at TEXT
    );
  `);
}

function generateShortNumeric() {
  // Try 5-digit codes first; fallback to 6 digits if collisions
  const tryOnce = () => String(Math.floor(10000 + Math.random() * 90000));
  let code = tryOnce();
  for (let i = 0; i < 10; i++) {
    const exists = db.prepare('SELECT 1 FROM short_links WHERE short = ?').get(code);
    if (!exists) return code;
    code = tryOnce();
  }
  // Fallback 6-digit
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ===== New API Endpoints for LAN IP, Quizzes CRUD, and Short Links =====

// 1) LAN IP discovery
app.get('/api/local-ip', (_req, res) => {
  try {
    const ips = getLocalIPv4s();
    res.json({ ips, port: Number(PORT) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 2) Get single quiz with questions (including correctAnswer for self-graded feedback).
app.get('/api/quizzes/:id', (req, res) => {
  try {
    const { id } = req.params;

    const q = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id);
    if (!q) return res.status(404).json({ message: 'Quiz not found' });

    const questions = db.prepare(`
      SELECT id, type, text, image, options_json, correct_answer, difficulty, points, explanation, position
      FROM questions
      WHERE quiz_id = ?
      ORDER BY COALESCE(position, rowid)
    `).all(id).map(row => ({
      id: row.id,
      type: row.type || 'mcq',
      text: row.text,
      image: row.image || null,
      options: parseJSONSafe(row.options_json, []),
      correctAnswer: (typeof row.correct_answer === 'number') ? row.correct_answer : row.correct_answer == null ? null : Number(row.correct_answer),
      explanation: row.explanation || '',
      difficulty: row.difficulty || null,
      points: (typeof row.points === 'number') ? row.points : row.points == null ? 1 : Number(row.points) || 1,
      position: row.position || null,
    }));

    ensureShortLinksTable();
    const shortRow = db.prepare('SELECT short FROM short_links WHERE quiz_id = ?').get(id);

    res.json({
      id: q.id,
      name: q.name || 'Quiz',
      description: q.description || '',
      groupId: q.group_id || null,
      duration: q.duration || null,
      status: q.status || 'active',
      settings: parseJSONSafe(q.settings_json, {}),
      short: shortRow?.short || null,
      questions
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


// 4) Append a question to a quiz
app.post('/api/quizzes/:id/questions', authenticateTeacher, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ message: 'Quiz not found' });

    const { type, text, image, options, correctAnswer, difficulty, points, explanation, position } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ message: 'Question text is required' });

    const qid = crypto.randomUUID();
    db.prepare(`
      INSERT INTO questions (id, quiz_id, type, text, image, options_json, correct_answer, difficulty, points, explanation, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      qid,
      id,
      type || 'mcq',
      String(text),
      image || null,
      JSON.stringify(Array.isArray(options) ? options : []),
      (typeof correctAnswer === 'number' ? correctAnswer : null),
      difficulty || null,
      (typeof points === 'number' ? points : 1),
      explanation || '',
      (typeof position === 'number' ? position : null)
    );

    res.status(201).json({ id: qid });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 4b) Bulk import questions
app.post('/api/quizzes/:id/questions/bulk', authenticateTeacher, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ message: 'Quiz not found' });

    const questions = req.body;
    if (!Array.isArray(questions) || questions.length === 0)
      return res.status(400).json({ message: 'No questions provided' });

    const insert = db.prepare(`
      INSERT INTO questions (id, quiz_id, type, text, options_json, correct_answer, points, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Get current max position
    const maxPos = db.prepare(`SELECT COALESCE(MAX(position),0) as m FROM questions WHERE quiz_id = ?`).get(id).m;

    const insertMany = db.transaction((qs) => {
      qs.forEach((q, i) => {
        insert.run(
          crypto.randomUUID(),
          id,
          q.type === 'tf' ? 'tf' : 'mcq',
          String(q.text).trim(),
          JSON.stringify(q.options),
          q.correctAnswer,
          1,
          maxPos + i + 1
        );
      });
    });

    insertMany(questions);
    res.status(201).json({ ok: true, inserted: questions.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 5) Short link redirect: /q/:short -> /quiz?id=<quiz_id>&{original query}
app.get('/q/:short', (req, res) => {
  try {
    ensureShortLinksTable();
    const { short } = req.params;
    const row = db.prepare('SELECT quiz_id FROM short_links WHERE short = ?').get(short);
    if (!row) return res.status(404).send('Not found');

    const quizId = row.quiz_id;
    const qs = new URLSearchParams(req.query || {});
    qs.set('id', quizId);
    const suffix = qs.toString();
    res.redirect(302, `/quiz?${suffix}`);
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
});

// Serve student quiz page at /quiz
app.get('/quiz', (_req, res) => {
  res.sendFile(path.join(publicDir, 'pages', 'quiz-view.html'));
});

// Game Engine Results — persisted in SQLite (previously written to an in-memory
// object with a no-op saveDB(), so every result was lost on restart).
app.post('/api/game-results', (req, res) => {
  try {
    const session = req.body;
    if (!session || typeof session !== 'object') {
      return res.status(400).json({ message: 'Invalid session data' });
    }
    const id = session.id || crypto.randomUUID();
    session._savedAt = new Date().toISOString();
    db.prepare(
      'INSERT OR REPLACE INTO game_results (id, game_id, session_json, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, session.gameId || null, JSON.stringify(session), session._savedAt);

    // Keep only the most recent 500 rows.
    db.prepare(
      `DELETE FROM game_results WHERE id NOT IN (
         SELECT id FROM game_results ORDER BY created_at DESC LIMIT 500
       )`
    ).run();

    res.status(201).json({ ok: true, id });
  } catch (e) {
    log.error('Error saving game result:', e);
    res.status(500).json({ message: e.message });
  }
});

app.get('/api/game-results', authenticateTeacher, (req, res) => {
  try {
    const { gameId, limit = 100 } = req.query;
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const rows = gameId
      ? db
          .prepare(
            'SELECT session_json FROM game_results WHERE game_id = ? ORDER BY created_at DESC LIMIT ?'
          )
          .all(gameId, lim)
      : db
          .prepare('SELECT session_json FROM game_results ORDER BY created_at DESC LIMIT ?')
          .all(lim);
    res.json(rows.map((r) => parseJSONSafe(r.session_json, {})));
  } catch (e) {
    log.error('Error reading game results:', e);
    res.status(500).json({ message: e.message });
  }
});

// Serve settings test page
app.get('/test-settings', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'test-settings-simple.html'));
});

// ── Trial Config & Stats API ───────────────────────────────────────────────
const TRIAL_CONFIG_FILE   = path.join(dataDir, 'trial-config.json');
const TRIAL_LOG_FILE      = path.join(dataDir, 'trial-log.json');
const GAMES_VIS_FILE      = path.join(dataDir, 'games-visibility.json');

const DEFAULT_TRIAL_CONFIG = {
  daysLimit:      7,
  maxGroups:      1,
  maxStudents:    10,
  maxQuizzes:     2,
  allowedGames:   3,
  competitions:   false,
  content:        true,
  maxGrades:      1,
  maxUnits:       2,
  maxLessons:     3,
};

// Trial limits are a single global policy the admin sets once and every
// customer's app must read the SAME values — previously this only ever
// wrote/read a local file, so admin changes never reached any real
// customer machine (each one just saw its own untouched defaults). Now
// mirrored to a single Firestore doc (config/trial) that any machine can
// read publicly (no admin credentials needed), while only the admin's own
// machine (via the Admin SDK, which bypasses Security Rules) can write it.
async function readTrialConfig() {
  const db2 = getFirestore();
  if (db2) {
    try {
      const doc = await db2.collection('config').doc('trial').get();
      if (doc.exists) return { ...DEFAULT_TRIAL_CONFIG, ...doc.data() };
    } catch {}
  } else {
    try {
      const remote = await getDocPublic('config', 'trial');
      if (remote) return { ...DEFAULT_TRIAL_CONFIG, ...remote };
    } catch {}
  }
  // offline / never-configured fallback
  try { return { ...DEFAULT_TRIAL_CONFIG, ...JSON.parse(await fs.readFile(TRIAL_CONFIG_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_TRIAL_CONFIG }; }
}

// Middleware: block if trial is active and the given feature is disabled/over limit
function trialGuard(check) {
  return async (req, res, next) => {
    const trial = await getActiveTrial();
    if (!trial) return next();
    const result = await check(trial, req);
    if (result) return res.status(403).json({ message: result });
    next();
  };
}

// Returns trial limits object if in an active trial, otherwise null
async function getActiveTrial() {
  try {
    const trialFile = process.env.APP_TRIAL_FILE || path.join(dataDir, 'ac_trial.json');
    const t = JSON.parse(await fs.readFile(trialFile, 'utf8'));
    if (!t || !t.expiresAt) return null;
    if (new Date(t.expiresAt) < new Date()) return null; // expired
    const cfg = await readTrialConfig();
    return { ...DEFAULT_TRIAL_CONFIG, ...cfg };
  } catch { return null; }
}

async function readTrialLog() {
  const db2 = getFirestore();
  if (db2) {
    try {
      const snap = await db2.collection('trial-log').get();
      const docs = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
      return docs.sort((a, b) => (b.activatedAt || '').localeCompare(a.activatedAt || ''));
    } catch {}
  }
  // fallback to local file
  try { return JSON.parse(await fs.readFile(TRIAL_LOG_FILE, 'utf8')); }
  catch { return []; }
}

async function isMachineRevoked(machineId) {
  const db2 = getFirestore();
  if (db2) {
    try {
      const doc = await db2.collection('trial-revoked').doc(machineId).get();
      return doc.exists;
    } catch { return false; }
  }
  // Normal customer machine — no admin credentials. `trial-revoked` docs are
  // keyed by machineId itself, so this is a direct single-doc `get` (not a
  // `list`), which Security Rules allow publicly for exactly this reason: a
  // machine can check whether IT was revoked without being able to browse
  // anyone else's revocation status.
  try { return !!(await getDocPublic('trial-revoked', machineId)); }
  catch { return false; }
}

app.get('/api/app-info', (req, res) => {
  try {
    const pkg = JSON.parse(fsSync.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    res.json({ version: pkg.version, year: new Date().getFullYear() });
  } catch { res.json({ version: '?', year: new Date().getFullYear() }); }
});

// Same global-policy-vs-local-file bug as trial config: the admin panel's
// per-game enable/disable toggle is meant to apply to every installed
// copy of the app immediately ("التغييرات تُطبَّق فوراً" in the admin UI),
// but a plain local file never reaches any customer machine but the
// admin's own. Mirrored to a public-readable Firestore doc, same pattern
// as config/trial above.
app.get('/api/games-visibility', async (req, res) => {
  const db2 = getFirestore();
  if (db2) {
    try {
      const doc = await db2.collection('config').doc('games-visibility').get();
      if (doc.exists) return res.json(doc.data());
    } catch {}
  } else {
    try {
      const remote = await getDocPublic('config', 'games-visibility');
      if (remote) return res.json(remote);
    } catch {}
  }
  try { res.json(JSON.parse(await fs.readFile(GAMES_VIS_FILE, 'utf8'))); }
  catch { res.json({}); }
});
app.post('/api/games-visibility', async (req, res) => {
  try {
    const db2 = getFirestore();
    if (db2) {
      try { await db2.collection('config').doc('games-visibility').set(req.body || {}, { merge: false }); }
      catch (e) { log.error('writeGamesVisibility Firestore error:', e.message); }
    }
    await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
    await fs.writeFile(GAMES_VIS_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/trial-config', async (req, res) => {
  res.json(await readTrialConfig());
});

app.post('/api/trial-config', async (req, res) => {
  try {
    const cfg = { ...DEFAULT_TRIAL_CONFIG, ...req.body };
    // sanitize numbers
    cfg.daysLimit    = Math.max(1,  parseInt(cfg.daysLimit)    || 7);
    cfg.maxGroups    = Math.max(1,  parseInt(cfg.maxGroups)    || 1);
    cfg.maxStudents  = Math.max(1,  parseInt(cfg.maxStudents)  || 10);
    cfg.maxQuizzes   = Math.max(1,  parseInt(cfg.maxQuizzes)   || 2);
    cfg.allowedGames = Math.max(1,  parseInt(cfg.allowedGames) || 3);
    cfg.competitions = !!cfg.competitions;
    cfg.content      = !!cfg.content;
    cfg.maxGrades    = Math.max(0,  parseInt(cfg.maxGrades)    || 0);
    cfg.maxUnits     = Math.max(0,  parseInt(cfg.maxUnits)     || 0);
    cfg.maxLessons   = Math.max(0,  parseInt(cfg.maxLessons)   || 0);
    const db2 = getFirestore();
    if (db2) {
      try { await db2.collection('config').doc('trial').set(cfg, { merge: true }); }
      catch (e) { log.error('writeTrialConfig Firestore error:', e.message); }
    }
    await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
    await fs.writeFile(TRIAL_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true, config: cfg });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/trial-stats', async (req, res) => {
  const log = await readTrialLog();
  res.json({ count: log.length, entries: log });
});

// Called by main.js (via internal fetch) when a trial is started
app.post('/api/trial-log', async (req, res) => {
  try {
    const machineId = req.body.machineId || '';
    const name      = (req.body.name  || '').trim();
    const phone     = (req.body.phone || '').trim();
    const db2 = getFirestore();
    if (db2) {
      const existing = await db2.collection('trial-log').where('machineId', '==', machineId).limit(1).get();
      if (existing.empty) {
        await db2.collection('trial-log').add({ machineId, name, phone, activatedAt: new Date().toISOString() });
      } else if (name) {
        // update name/phone if missing from an earlier entry
        const doc = existing.docs[0];
        if (!doc.data().name) await doc.ref.update({ name, phone });
      }
    } else {
      // No admin credentials on this machine (the normal case for every
      // end-user install) — write via the public, credential-free REST
      // fallback so the admin's Firestore-backed trial list actually sees
      // it, instead of only ever writing to a local file only this machine
      // can read (see createTrialLogPublic above).
      await createTrialLogPublic({ machineId, name, phone, activatedAt: new Date().toISOString() });
      // also mirror locally as an offline-friendly backup
      const log = await readTrialLog();
      if (!log.find(e => e.machineId === machineId)) {
        log.push({ activatedAt: new Date().toISOString(), machineId, name, phone });
        await fs.writeFile(TRIAL_LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
      }
    }
    res.json({ ok: true });
  } catch { res.json({ ok: false }); }
});

app.delete('/api/trial-log/:machineId', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.machineId);
    const db2 = getFirestore();
    if (db2) {
      // remove from trial-log, keeping name/phone so the revoked list stays readable
      const snap = await db2.collection('trial-log').where('machineId', '==', id).get();
      const meta = snap.docs[0] ? snap.docs[0].data() : {};
      await Promise.all(snap.docs.map(d => d.ref.delete()));
      // add to revoked list, keyed by machineId itself (not an auto-id) so
      // the revoked machine can check its own status via a public single-doc
      // `get` with no admin credentials — see isMachineRevoked above.
      await db2.collection('trial-revoked').doc(id).set({
        machineId: id, revokedAt: new Date().toISOString(),
        name: meta.name || '', phone: meta.phone || '',
      });
    } else {
      let log = await readTrialLog();
      log = log.filter(e => e.machineId !== id);
      await fs.writeFile(TRIAL_LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// List blocked devices so the admin panel can offer one-click restore
// without anyone having to copy/paste a machine ID.
app.get('/api/trial-revoked', async (req, res) => {
  try {
    const db2 = getFirestore();
    if (!db2) return res.json({ entries: [] });
    const snap = await db2.collection('trial-revoked').get();
    const entries = snap.docs.map(d => d.data())
      .sort((a, b) => (b.revokedAt || '').localeCompare(a.revokedAt || ''));
    res.json({ entries });
  } catch (e) { res.status(500).json({ entries: [], error: e.message }); }
});

// Un-block a machine that was previously revoked via the DELETE endpoint above.
// Only clears the revocation flag — it does not restore the deleted trial-log
// entry. The teacher's machine will be able to start a fresh trial once its
// own local ac_trial.json no longer blocks it (see start-trial in main.js).
app.post('/api/trial-log/:machineId/restore', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.machineId);
    const db2 = getFirestore();
    if (db2) {
      await db2.collection('trial-revoked').doc(id).delete().catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Grant a machine a brand-new trial period remotely, even after its previous
// one expired naturally. "restore" above only un-blocks a machine that was
// actively revoked — a machine whose trial simply ran out has no path back
// in via that flow (see the revokedByAdmin comment in main.js's start-trial
// handler), which is the gap this closes. Clears any trial-log/revoked
// record for the machine and drops a one-shot marker in `trial-resets`
// that the app consumes (via /api/trial-status + the consume endpoint
// below) the next time it tries to start a trial.
app.post('/api/trial-log/:machineId/reset', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.machineId);
    const db2 = getFirestore();
    if (!db2) return res.json({ ok: false, error: 'firebase_unavailable' });
    const [logSnap, revokedDoc] = await Promise.all([
      db2.collection('trial-log').where('machineId', '==', id).get(),
      db2.collection('trial-revoked').doc(id).get(),
    ]);
    await Promise.all([
      ...logSnap.docs.map(d => d.ref.delete()),
      revokedDoc.exists ? db2.collection('trial-revoked').doc(id).delete() : Promise.resolve(),
    ]);
    // keyed by machineId itself so the customer's own machine can later
    // check + consume this one-shot flag with no admin credentials — see
    // reset-consume and /api/trial-status below.
    await db2.collection('trial-resets').doc(id).set({ machineId: id, requestedAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Called by main.js when it's about to actually issue a fresh trial off the
// back of a reset — makes the reset one-shot so it can't be replayed. This
// runs on the CUSTOMER's own machine (no admin credentials), so it needs
// the public REST fallback too — safe because it only ever deletes the
// doc at its own exact machineId path (see deleteDocPublic above).
app.post('/api/trial-log/:machineId/reset-consume', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.machineId);
    const db2 = getFirestore();
    if (db2) {
      await db2.collection('trial-resets').doc(id).delete().catch(() => {});
    } else {
      await deleteDocPublic('trial-resets', id).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Called by main.js every 30s to check if admin revoked this machine's trial
app.get('/api/trial-status', async (req, res) => {
  const machineId = req.query.machineId || '';
  if (!machineId) return res.json({ revoked: false, resetAvailable: false });
  const db2 = getFirestore();
  const revoked = await isMachineRevoked(machineId);
  let resetAvailable = false;
  if (db2) {
    try {
      const doc = await db2.collection('trial-resets').doc(machineId).get();
      resetAvailable = doc.exists;
    } catch {}
  } else {
    // Normal customer machine — public single-doc check, same reasoning
    // as isMachineRevoked above.
    try { resetAvailable = !!(await getDocPublic('trial-resets', machineId)); }
    catch {}
  }
  res.json({ revoked, resetAvailable });
});
// ──────────────────────────────────────────────────────────────────────────

// ── License System ────────────────────────────────────────────────────────
const LICENSES_FILE  = path.join(dataDir, 'licenses.json');
const ADMIN_CFG_FILE = path.join(dataDir, 'admin-config.json');

// SECURITY: this used to fall back to a hardcoded default password
// ('admin2025') whenever no admin-config.json existed — which is the case
// on every fresh end-user install, since that file is never shipped or
// created automatically. A guessable hardcoded default defeats the purpose
// of the password check. Now: no config file and no ADMIN_PASS env var
// means there is no valid password at all, so licenseAdminAuth denies
// every request (fail-closed) instead of silently accepting a known
// default.
function getAdminPass() {
  try {
    const configured = JSON.parse(fssync.readFileSync(ADMIN_CFG_FILE, 'utf8')).pass;
    if (configured) return configured;
  } catch {}
  return process.env.ADMIN_PASS || null;
}

function licenseAdminAuth(req, res, next) {
  const expected = getAdminPass();
  if (!expected) return res.status(503).json({ ok: false, message: 'لوحة الإدارة غير مُفعّلة على هذا الجهاز.' });
  const pass = req.headers['x-admin-pass'] || '';
  if (pass !== expected) return res.status(401).json({ ok: false, message: 'غير مصرح' });
  next();
}

// ── Firestore-backed license storage (falls back to local JSON) ───────────
const FS_COLL = 'licenses';

async function readLicenses() {
  const db = getFirestore();
  if (db) {
    try {
      const snap = await db.collection(FS_COLL).get();
      return snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
    } catch (e) { log.error('readLicenses Firestore error:', e.message); }
  }
  // fallback: local file
  try { return JSON.parse(await fs.readFile(LICENSES_FILE, 'utf8')); }
  catch { return []; }
}

async function writeLicenses(licenses) {
  const db = getFirestore();
  if (db) {
    try {
      const batch = db.batch();
      // write each license as its own doc keyed by id
      for (const lic of licenses) {
        // Keyed by the license `key` itself (not a random id) so that a
        // customer's machine can fetch its own license from Firestore via
        // a public, credential-free single-doc `get` on a known path — see
        // getLicensePublic above. Migrate off any legacy random-id doc.
        const docId = (lic.key || lic._docId || lic.id).toUpperCase();
        const ref = db.collection(FS_COLL).doc(docId);
        const { _docId, ...data } = lic;
        batch.set(ref, data, { merge: true });
        if (_docId && _docId !== docId) batch.delete(db.collection(FS_COLL).doc(_docId));
      }
      await batch.commit();
    } catch (e) { log.error('writeLicenses Firestore error:', e.message); }
  }
  // always mirror locally as backup
  await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
  await fs.writeFile(LICENSES_FILE, JSON.stringify(licenses, null, 2), 'utf8');
}

// Single-license write helpers (for verify binding + admin edits)
async function writeLicenseDoc(lic) {
  const db = getFirestore();
  if (db) {
    try {
      const docId = (lic.key || lic._docId || lic.id).toUpperCase();
      const { _docId, ...data } = lic;
      await db.collection(FS_COLL).doc(docId).set(data, { merge: true });
      // migrate off a legacy random-id doc from before licenses were keyed by `key`
      if (_docId && _docId !== docId) await db.collection(FS_COLL).doc(_docId).delete().catch(() => {});
    } catch (e) { log.error('writeLicenseDoc Firestore error:', e.message); }
  }
  // mirror to local file
  const all = await readLicensesLocal();
  const idx = all.findIndex(l => l.id === lic.id);
  if (idx >= 0) all[idx] = lic; else all.unshift(lic);
  await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
  await fs.writeFile(LICENSES_FILE, JSON.stringify(all, null, 2), 'utf8');
}

async function deleteLicenseDoc(id) {
  const db = getFirestore();
  if (db) {
    try {
      const snap = await db.collection(FS_COLL).where('id', '==', id).limit(1).get();
      if (!snap.empty) await snap.docs[0].ref.delete();
    } catch (e) { log.error('deleteLicenseDoc Firestore error:', e.message); }
  }
}

async function readLicensesLocal() {
  try { return JSON.parse(await fs.readFile(LICENSES_FILE, 'utf8')); }
  catch { return []; }
}

// Verify — called by the client app on activation/startup
app.post('/api/license/verify', async (req, res) => {
  const { key, machineId } = req.body || {};
  if (!key || !machineId) return res.json({ ok: false, message: 'بيانات ناقصة' });
  const normKey = key.toUpperCase().trim();
  const db = getFirestore();

  let lic;
  if (db) {
    // Admin's own machine (has FIREBASE_SERVICE_ACCOUNT_JSON) — unchanged path.
    const licenses = await readLicenses();
    lic = licenses.find(l => l.key === normKey);
  } else {
    // Normal customer machine — no admin credentials. Fetch this one
    // license directly from Firestore's public REST API by its doc ID
    // (the key itself); see getLicensePublic above for why this is safe.
    lic = await getLicensePublic(normKey).catch(() => null);
    if (!lic) {
      // last-resort offline fallback (e.g. no internet at activation time)
      const local = await readLicensesLocal();
      lic = local.find(l => l.key === normKey) || null;
    }
  }

  if (!lic)         return res.json({ ok: false, message: 'المفتاح غير صحيح' });
  if (lic.revoked)  return res.json({ ok: false, message: 'الترخيص ملغي' });
  if (new Date(lic.expiresAt) < new Date()) return res.json({ ok: false, message: 'الترخيص منتهي', expired: true });

  // First activation: bind to machine
  if (!lic.machineId) {
    lic.machineId   = machineId;
    lic.activatedAt = new Date().toISOString();
    if (db) {
      await writeLicenseDoc(lic); // single-doc write — fast and atomic
    } else {
      const bound = await bindLicenseMachinePublic(normKey, machineId, lic.activatedAt).catch(() => false);
      if (!bound) return res.json({ ok: false, message: 'تعذّر تفعيل المفتاح، تأكد من الاتصال بالإنترنت وحاول مرة أخرى' });
      // mirror locally too, for the offline-fallback path above
      const local = await readLicensesLocal();
      const idx = local.findIndex(l => l.key === normKey);
      if (idx >= 0) local[idx] = lic; else local.push(lic);
      await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
      await fs.writeFile(LICENSES_FILE, JSON.stringify(local, null, 2), 'utf8').catch(() => {});
    }
  } else if (lic.machineId !== machineId) {
    return res.json({ ok: false, message: 'هذا المفتاح مفعّل على جهاز آخر — تواصل مع الدعم' });
  }
  const daysLeft = Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000);
  res.json({ ok: true, name: lic.name, phone: lic.phone, plan: lic.plan || 'Pro', expiresAt: lic.expiresAt, issuedAt: lic.issuedAt, daysLeft, totalDays: lic.totalDays || 365 });
});

// Create license — admin only
app.post('/api/admin/license/create', licenseAdminAuth, async (req, res) => {
  const { name, phone, plan, days } = req.body || {};
  if (!name || !phone) return res.json({ ok: false, message: 'الاسم والهاتف مطلوبان' });
  const last4 = phone.replace(/\D/g, '').slice(-4).padStart(4, '0');
  const rand  = crypto.randomBytes(2).toString('hex').toUpperCase();
  const key   = `AC-${rand}-${last4}`;
  const numDays = parseInt(days) || 365;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + numDays);
  const record = {
    id: crypto.randomUUID(), key, name, phone,
    plan: plan || 'Pro سنوي', totalDays: numDays,
    issuedAt: new Date().toISOString().split('T')[0],
    expiresAt: expiresAt.toISOString().split('T')[0],
    machineId: null, activatedAt: null, revoked: false,
  };
  await writeLicenseDoc(record); // saves to Firestore + local file
  res.json({ ok: true, key, expiresAt: record.expiresAt, id: record.id });
});

// List — admin only
app.get('/api/admin/license/list', licenseAdminAuth, async (req, res) => {
  res.json({ ok: true, licenses: await readLicenses() });
});

// Revoke / Restore
app.post('/api/admin/license/revoke', licenseAdminAuth, async (req, res) => {
  const licenses = await readLicenses();
  const lic = licenses.find(l => l.id === req.body.id);
  if (!lic) return res.json({ ok: false });
  lic.revoked = !req.body.restore;
  await writeLicenseDoc(lic);
  res.json({ ok: true });
});

// Reset machine binding (allow re-activation on new device)
app.post('/api/admin/license/reset', licenseAdminAuth, async (req, res) => {
  const licenses = await readLicenses();
  const lic = licenses.find(l => l.id === req.body.id);
  if (!lic) return res.json({ ok: false });
  lic.machineId = null;
  lic.activatedAt = null;
  await writeLicenseDoc(lic);
  res.json({ ok: true });
});

// Edit
app.put('/api/admin/license/:id', licenseAdminAuth, async (req, res) => {
  const licenses = await readLicenses();
  const lic = licenses.find(l => l.id === req.params.id);
  if (!lic) return res.json({ ok: false });
  const { name, phone, plan, expiresAt, totalDays } = req.body || {};
  if (name)      lic.name      = name;
  if (phone)     lic.phone     = phone;
  if (plan)      lic.plan      = plan;
  if (expiresAt) lic.expiresAt = expiresAt;
  if (totalDays) lic.totalDays = parseInt(totalDays);
  await writeLicenseDoc(lic);
  res.json({ ok: true });
});

// Delete
app.delete('/api/admin/license/:id', licenseAdminAuth, async (req, res) => {
  await deleteLicenseDoc(req.params.id);
  // also remove from local file
  const licenses = await readLicensesLocal();
  await fs.writeFile(LICENSES_FILE, JSON.stringify(licenses.filter(l => l.id !== req.params.id), null, 2), 'utf8').catch(() => {});
  res.json({ ok: true });
});

// Change admin password
app.post('/api/admin/license/set-pass', licenseAdminAuth, async (req, res) => {
  const { newPass } = req.body || {};
  if (!newPass || newPass.length < 6) return res.json({ ok: false, message: 'كلمة السر قصيرة جداً' });
  await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
  await fs.writeFile(ADMIN_CFG_FILE, JSON.stringify({ pass: newPass }, null, 2), 'utf8');
  res.json({ ok: true });
});
// ── License Requests via Firestore ────────────────────────────────────────
app.post('/api/license/request', async (req, res) => {
  const { name, phone, machineId } = req.body || {};
  if (!name || !phone) return res.json({ ok: false });
  const db2 = getFirestore();
  if (!db2) {
    // Normal case on every end-user machine — no admin credentials here.
    // Fall back to the public, credential-free REST write instead of
    // silently dropping the request.
    try {
      const ok = await createLicenseRequestPublic({
        id: crypto.randomUUID(), name, phone, machineId: machineId || '',
        requestedAt: new Date().toISOString(), status: 'pending',
      });
      return res.json({ ok });
    } catch (e) { return res.json({ ok: false, error: e.message }); }
  }
  try {
    const col = db2.collection('license-requests');
    // upsert by machineId (pending only)
    const existing = await col.where('machineId', '==', machineId || '').where('status', '==', 'pending').limit(1).get();
    if (!existing.empty) {
      await existing.docs[0].ref.update({ name, phone, updatedAt: new Date().toISOString() });
    } else {
      await col.add({ id: crypto.randomUUID(), name, phone, machineId: machineId || '', requestedAt: new Date().toISOString(), status: 'pending' });
    }
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/admin/license/requests', licenseAdminAuth, async (req, res) => {
  const db2 = getFirestore();
  if (!db2) return res.json({ ok: false, requests: [] });
  try {
    const snap = await db2.collection('license-requests').orderBy('requestedAt', 'desc').get();
    const requests = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
    res.json({ ok: true, requests });
  } catch (e) { res.json({ ok: false, requests: [], error: e.message }); }
});

app.post('/api/admin/license/request-done', licenseAdminAuth, async (req, res) => {
  const db2 = getFirestore();
  if (!db2) return res.json({ ok: false });
  try {
    const snap = await db2.collection('license-requests').where('id', '==', req.body.id).limit(1).get();
    if (!snap.empty) await snap.docs[0].ref.update({ status: 'done' });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});
// ── End License System ─────────────────────────────────────────────────────

// Bind host is configurable. Default is all interfaces (0.0.0.0) because LAN
// access is a core feature (students join quizzes from their own devices via
// the teacher's IP). Set HOST=127.0.0.1 to lock the server to this machine.
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  log.info(`Active Class server running at http://localhost:${PORT} (bound to ${HOST})`);
  if (HOST === '0.0.0.0') {
    log.info('LAN access enabled. Set HOST=127.0.0.1 to restrict to this machine.');
  }
  if (!SERVER_API_KEY) {
    log.warn('[SECURITY] SERVER_API_KEY is not set — teacher API endpoints are UNAUTHENTICATED (dev mode). Do not expose this server on an untrusted network.');
  }
});
