const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const os = require('os');
const { db, dbData, saveDB, openDB, closeDB } = require('./sqlite');
const { generateQuizFromPDF } = require('./ai-service');

const app = express();
const PORT = process.env.PORT || 5000;

const publicDir = path.join(__dirname, '..', 'public');
const assetsDir = path.join(__dirname, '..', 'assets');
const dataDir = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
const dbPath = path.join(__dirname, '..', 'db.json');
const uploadsDir = path.join(publicDir, 'uploads');

// Ensure uploads directory exists
fs.mkdir(uploadsDir, { recursive: true });

// Middleware
app.use(express.static(publicDir));
app.use('/assets', express.static(assetsDir));
app.use(express.json());

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

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// --- API Endpoints ---

// Read data from db.json
async function readDB() {
  try {
    const data = await fs.readFile(dbPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database:', error);
    throw new Error('Could not read from database.');
  }
}

// Write data to db.json
async function writeDB(data) {
  try {
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing to database:', error);
    throw new Error('Could not write to database.');
  }
}

// Get all educational content structure
app.get('/api/educational-content', async (req, res) => {
  try {
    const db = await readDB();
    res.json({ grades: db.grades });
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
      groupId: r.groupId || null
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get a single lesson's details
app.get('/api/lesson/:id', async (req, res) => {
  try {
    const db = await readDB();
    const lesson = findLesson(db.grades, req.params.id);

    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found.' });
    }

    // If content includes quizzes, augment with quiz titles for convenience
    if (lesson.content && lesson.content.length > 0) {
      lesson.content.forEach(item => {
        if (item.type === 'quiz' && item.quizId) {
          const quiz = (db.quizzes || []).find(q => q.id === item.quizId);
          if (quiz) {
            item.title = quiz.title; // Add quiz title to the content item
          }
        }
      });
    }

    res.json(lesson);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload a file
app.post('/api/content/upload', authenticateTeacher, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  const { lessonId } = req.body;
  const newContentItem = {
    id: crypto.randomUUID(),
    type: 'file',
    name: req.file.originalname,
    path: `/uploads/${req.file.filename}`,
  };

  try {
    const db = await readDB();
    const lesson = findLesson(db.grades, lessonId);
    if (!lesson) return res.status(404).json({ message: 'Lesson not found.' });

    if (!lesson.content) lesson.content = [];
    lesson.content.push(newContentItem);

    await writeDB(db);
    res.status(201).json(newContentItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add a link
app.post('/api/content/link', authenticateTeacher, async (req, res) => {
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
    const db = await readDB();
    const lesson = findLesson(db.grades, lessonId);
    if (!lesson) return res.status(404).json({ message: 'Lesson not found.' });

    if (!lesson.content) lesson.content = [];
    lesson.content.push(newContentItem);

    await writeDB(db);
    res.status(201).json(newContentItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add a quiz
app.post('/api/content/quiz', authenticateTeacher, async (req, res) => {
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
    const db = await readDB();
    const lesson = findLesson(db.grades, lessonId);
    if (!lesson) return res.status(404).json({ message: 'Lesson not found.' });

    if (!lesson.content) lesson.content = [];
    lesson.content.push(newContentItem);

    await writeDB(db);
    res.status(201).json(newContentItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete content item
app.delete('/api/content/:id', authenticateTeacher, async (req, res) => {
  const { id } = req.params;
  try {
    const db = await readDB();
    let found = false;
    db.grades.forEach(grade => {
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
      await writeDB(db);
      res.status(204).send(); // No Content
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
    const db = await readDB();
    let unitFound = null;

    for (const grade of db.grades) {
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
      await writeDB(db);
      res.status(200).json({ message: 'Lessons reordered successfully.' });
    } else {
      res.status(404).json({ message: 'Unit not found.' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Endpoint to reorder content items within a lesson
app.post('/api/content/reorder', authenticateTeacher, async (req, res) => {
  const { lessonId, orderedContentIds } = req.body;
  if (!lessonId || !Array.isArray(orderedContentIds)) {
    return res.status(400).json({ message: 'Missing or invalid parameters.' });
  }

  try {
    const db = await readDB();
    const lesson = findLesson(db.grades, lessonId);

    if (lesson) {
      if (!lesson.content) lesson.content = [];

      // Create a new array of content in the desired order
      const orderedContent = orderedContentIds.map(id => lesson.content.find(c => c.id === id)).filter(Boolean);

      // Check if all content items were found
      if (orderedContent.length !== lesson.content.length) {
         return res.status(404).json({ message: 'One or more content IDs were not found in this lesson.' });
      }

      lesson.content = orderedContent;
      await writeDB(db);
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

// Add a new grade
app.post('/api/grades', authenticateTeacher, async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Grade name is required.' });
  }

  try {
    const db = await readDB();
    const newGrade = {
      id: crypto.randomUUID(),
      name,
      units: [],
    };
    db.grades.push(newGrade);
    await writeDB(db);
    res.status(201).json(newGrade);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add a new unit to a grade
app.post('/api/units', authenticateTeacher, async (req, res) => {
  const { gradeId, name } = req.body;
  if (!gradeId || !name) {
    return res.status(400).json({ message: 'Grade ID and unit name are required.' });
  }

  try {
    const db = await readDB();
    const grade = db.grades.find(g => g.id === gradeId);
    if (!grade) {
      return res.status(404).json({ message: 'Grade not found.' });
    }

    const newUnit = {
      id: crypto.randomUUID(),
      name,
      lessons: [],
    };
    grade.units.push(newUnit);
    await writeDB(db);
    res.status(201).json(newUnit);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== AI Interactive Lessons Endpoints =====

// Generate new AI Lesson from PDF
app.post('/api/generate-ai-quiz', authenticateTeacher, upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'الرجاء رفع ملف PDF.' });
  }

  const title = req.body.title || req.file.originalname.replace('.pdf', '');
  
  try {
    // Get Gemini API key from settings
    const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'gemini_api_key'").get();
    let apiKey = '';
    if (settingRow) {
      try { apiKey = JSON.parse(settingRow.value); } catch { apiKey = settingRow.value; }
    }

    if (!apiKey) {
      return res.status(400).json({ message: 'مفتاح API الخاص بـ Gemini غير موجود في الإعدادات.' });
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
    fs.unlink(req.file.path).catch(console.error);

    res.status(201).json({ id, title, message: 'تم إنشاء الدرس التفاعلي بنجاح!' });
  } catch (error) {
    console.error('=== AI Generation Error ===');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('===========================');
    res.status(500).json({ message: error.message || 'حدث خطأ أثناء معالجة الملف.' });
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
app.post('/api/lessons', authenticateTeacher, async (req, res) => {
  const { unitId, name } = req.body;
  if (!unitId || !name) {
    return res.status(400).json({ message: 'Unit ID and lesson name are required.' });
  }

  try {
    const db = await readDB();
    let unit = null;
    for (const grade of db.grades) {
      unit = grade.units.find(u => u.id === unitId);
      if (unit) break;
    }

    if (!unit) {
      return res.status(404).json({ message: 'Unit not found.' });
    }

    const newLesson = {
      id: crypto.randomUUID(),
      name,
      content: [],
    };
    unit.lessons.push(newLesson);
    await writeDB(db);
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
const tempQuizzesPath = path.join(__dirname, '..', 'temp_quizzes.json');

function ensureDataFiles() {
  try { if (!fssync.existsSync(dataDir)) fssync.mkdirSync(dataDir, { recursive: true }); } catch {}
  const seed = (p, v) => { try { if (!fssync.existsSync(p)) fssync.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); } catch {} };
  seed(resultsPath, []);
  seed(studentsPath, []);
  seed(groupsPath, []);
}
ensureDataFiles();

function listLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

async function readJSONFile(filepath, fallback) {
  try {
    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

// GET /api/local-ip → ["192.168.1.10", ...]
app.get('/api/local-ip', (_req, res) => {
  res.json({ ips: listLocalIPs(), port: PORT });
});

// [Consolidated] GET /api/quizzes/:id is defined later in the file with short link support

// GET /api/students (optional seed)
app.get('/api/students', async (_req, res) => {
  const students = await readJSONFile(studentsPath, []);
  res.json(students);
});

// GET /api/groups (optional seed)
app.get('/api/groups', async (_req, res) => {
  const groups = await readJSONFile(groupsPath, []);
  res.json(groups);
});

// GET /api/group/:id/students → students filtered by groupId
app.get('/api/group/:id/students', async (req, res) => {
  const students = await readJSONFile(studentsPath, []);
  res.json(students.filter(s => s.groupId === req.params.id));
});

// POST /api/submit-answers → store submission in SQLite
app.post('/api/submit-answers', async (req, res) => {
  try {
    const { testId, studentId, studentName, answers } = req.body || {};
    if (!testId || !Array.isArray(answers)) {
      return res.status(400).json({ message: 'Invalid payload' });
    }

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
      INSERT INTO results (id, test_id, student_id, student_name, answers_json, score_correct, score_total, score_percent, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, testId, studentId || null, studentName || null, JSON.stringify(answers), correct, total, percent, new Date().toISOString());

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
app.post('/api/quizzes', authenticateTeacher, (req, res) => {
  try {
    const { name, description, groupId, duration, status, settings } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ message: 'name is required' });
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
      ts: r.ts,
    }));
    res.json(list);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
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

// Database backup and restore endpoints
app.post('/api/backup', authenticateTeacher, async (req, res) => {
  try {
    const { backupPath } = req.body;
    if (!backupPath) {
      return res.status(400).json({ message: 'Backup path is required' });
    }
    
    // Use the active data directory (Electron sets APP_DATA_DIR); the old code
    // hard-coded ../data which pointed at the wrong file in the packaged app.
    const liveDbPath = path.join(dataDir, 'activeclass.db');
    const backupFile = path.join(backupPath, `activeclass_backup_${Date.now()}.db`);

    await fs.copyFile(liveDbPath, backupFile);
    res.json({ success: true, backupFile });
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

    // The WAL'd file is locked while open, so close before overwriting,
    // then reopen so the shared `db` proxy points at the restored data.
    closeDB();
    await fs.copyFile(source, liveDbPath);
    openDB();

    res.json({ success: true });
  } catch (error) {
    // Make sure we leave a usable connection behind even if the copy failed.
    try { openDB(); } catch { /* ignore */ }
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

// 2) Get single quiz with questions (Public for students, but includes answers)
app.get('/api/quizzes/:id', (req, res) => {
  try {
    const { id } = req.params;
    const q = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id);
    if (!q) return res.status(404).json({ message: 'Quiz not found' });

    const questions = db.prepare(`
      SELECT id, quiz_id, type, text, image, options_json, correct_answer, difficulty, points, explanation, position
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
      difficulty: row.difficulty || null,
      points: (typeof row.points === 'number') ? row.points : row.points == null ? 1 : Number(row.points) || 1,
      explanation: row.explanation || '',
      position: row.position || null
    }));

    // Include short code if exists
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

// Game Engine Results
app.post('/api/game-results', (req, res) => {
  try {
    const session = req.body;
    if (!session || typeof session !== 'object') {
      return res.status(400).json({ message: 'Invalid session data' });
    }
    if (!Array.isArray(dbData.game_results)) dbData.game_results = [];
    session._savedAt = new Date().toISOString();
    dbData.game_results.push(session);
    if (dbData.game_results.length > 500) dbData.game_results.splice(0, dbData.game_results.length - 500);
    saveDB();
    res.status(201).json({ ok: true, id: session.id });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.get('/api/game-results', authenticateTeacher, (req, res) => {
  try {
    const results = Array.isArray(dbData.game_results) ? dbData.game_results : [];
    const { gameId, limit = 100 } = req.query;
    const filtered = gameId ? results.filter(r => r.gameId === gameId) : results;
    res.json(filtered.slice(-Number(limit)).reverse());
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Serve settings test page
app.get('/test-settings', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'test-settings-simple.html'));
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Active Class server running at http://localhost:${PORT}`);
  if (!SERVER_API_KEY) {
    console.warn('[SECURITY] SERVER_API_KEY is not set — teacher API endpoints are UNAUTHENTICATED (dev mode). Do not expose this server on an untrusted network.');
  }
});