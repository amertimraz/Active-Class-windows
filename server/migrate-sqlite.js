// server/migrate-sqlite.js
const { db } = require('./sqlite');
const fs = require('fs');
const path = require('path');

const tempQuizzesPath = path.join(__dirname, '..', 'temp_quizzes.json');

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function migrate() {
  const quizzes = loadJSON(tempQuizzesPath, []);
  if (!Array.isArray(quizzes) || quizzes.length === 0) {
    console.log('No quizzes found in temp_quizzes.json');
    return;
  }

  const insertQuiz = db.prepare(`
    INSERT OR REPLACE INTO quizzes
    (id, name, description, group_id, duration, status, settings_json, created_at, updated_at)
    VALUES (@id, @name, @description, @groupId, @duration, @status, @settings_json, @createdAt, @updatedAt)
  `);

  const insertQuestion = db.prepare(`
    INSERT OR REPLACE INTO questions
    (id, quiz_id, type, text, image, options_json, correct_answer, difficulty, points, explanation, position)
    VALUES (@id, @quiz_id, @type, @text, @image, @options_json, @correctAnswer, @difficulty, @points, @explanation, @position)
  `);

  const trx = db.transaction(() => {
    for (const qz of quizzes) {
      insertQuiz.run({
        id: qz.id,
        name: qz.name || qz.title || 'Quiz',
        description: qz.description || '',
        groupId: qz.groupId || null,
        duration: qz.duration || null,
        status: qz.status || 'active',
        settings_json: JSON.stringify(qz.settings || {}),
        createdAt: qz.createdAt || null,
        updatedAt: qz.updatedAt || null,
      });

      const questions = Array.isArray(qz.questions) ? qz.questions : [];
      questions.forEach((qq, idx) => {
        insertQuestion.run({
          id: qq.id,
          quiz_id: qz.id,
          type: qq.type || 'mcq',
          text: qq.text || '',
          image: qq.image || null,
          options_json: JSON.stringify(qq.options ?? []),
          correctAnswer: typeof qq.correctAnswer === 'number' ? qq.correctAnswer : null,
          difficulty: qq.difficulty || null,
          points: qq.points ?? 1,
          explanation: qq.explanation || '',
          position: idx + 1,
        });
      });
    }
  });

  trx();
  console.log(`Migrated ${quizzes.length} quizzes to SQLite`);
}

migrate();