'use strict';
// End-to-end of the critical teacher->student path against a real server
// instance: create quiz, add questions, student fetches + submits, score is
// computed and stored. Also locks in the Phase 1 security behaviours.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PORT = 5096;
const KEY = 'test-key-123';
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-e2e-'));

let server;

function authHeaders(extra = {}) {
  return { 'x-api-key': KEY, 'Content-Type': 'application/json', ...extra };
}

async function waitForReady(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/local-ip`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('server did not become ready in time');
}

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      SERVER_API_KEY: KEY,
      APP_DATA_DIR: tmpDir,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    stdio: 'ignore',
  });
  await waitForReady();
});

after(() => {
  if (server) server.kill();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('unauthenticated write is rejected (401)', async () => {
  const r = await fetch(`${BASE}/api/quizzes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'nope' }),
  });
  assert.strictEqual(r.status, 401);
});

test('public settings never leak a secret key', async () => {
  await fetch(`${BASE}/api/settings`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ key: 'gemini_api_key', value: 'SECRET' }),
  });
  const pub = await (await fetch(`${BASE}/api/settings`)).json();
  assert.ok(!('gemini_api_key' in pub), 'secret must not appear in public settings');
  const authed = await (await fetch(`${BASE}/api/settings`, { headers: authHeaders() })).json();
  assert.strictEqual(authed.gemini_api_key, 'SECRET', 'authed caller still sees it');
});

test('full quiz flow: create -> add questions -> fetch -> submit -> score', async () => {
  // Create quiz (teacher)
  const created = await (
    await fetch(`${BASE}/api/quizzes`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Math', duration: 10 }),
    })
  ).json();
  assert.ok(created.id, 'quiz id returned');

  // Add two questions with known correct answers
  const q1 = await (
    await fetch(`${BASE}/api/quizzes/${created.id}/questions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text: '1+1?', options: ['1', '2', '3'], correctAnswer: 1 }),
    })
  ).json();
  const q2 = await (
    await fetch(`${BASE}/api/quizzes/${created.id}/questions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text: '2+2?', options: ['3', '4', '5'], correctAnswer: 1 }),
    })
  ).json();

  // Student fetches the quiz (public)
  const quiz = await (await fetch(`${BASE}/api/quizzes/${created.id}`)).json();
  assert.strictEqual(quiz.questions.length, 2);

  // Student submits: one right, one wrong -> 50%
  const submit = await (
    await fetch(`${BASE}/api/submit-answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testId: created.id,
        studentName: '<b>Sara</b>',
        answers: [
          { questionId: q1.id, answerIndex: 1 },
          { questionId: q2.id, answerIndex: 0 },
        ],
      }),
    })
  ).json();
  assert.strictEqual(submit.score.correct, 1);
  assert.strictEqual(submit.score.total, 2);
  assert.strictEqual(submit.score.percent, 50);

  // Teacher reads results; name was sanitized (no angle brackets stored)
  const results = await (
    await fetch(`${BASE}/results?testId=${created.id}`, { headers: authHeaders() })
  ).json();
  assert.strictEqual(results.length, 1);
  assert.ok(!/[<>]/.test(results[0].studentName), 'stored name must not contain markup');
});
