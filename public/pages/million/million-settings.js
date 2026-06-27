let allQuizzes = [];
let allQuestions = [];           // pool from all selected quizzes
let selectedQuizIds = new Set(); // quizzes added by user

async function initSettings() {
  try {
    allQuizzes = await window.api.loadQuizzes();
    populateQuizSelect();
    setupEventListeners();
  } catch (error) {
    console.error('Error loading quizzes:', error);
  }
}

function populateQuizSelect() {
  const select = document.getElementById('quizSelect');
  select.innerHTML = '<option value="">اختر اختبار لإضافته...</option>';
  allQuizzes.forEach(quiz => {
    const option = document.createElement('option');
    option.value = quiz.id;
    option.textContent = `${quiz.name} (${quiz.questionsCount || 0} سؤال)`;
    select.appendChild(option);
  });
}

function setupEventListeners() {
  document.getElementById('addQuizBtn').addEventListener('click', handleAddQuiz);
  document.getElementById('millionSettingsForm').addEventListener('submit', handleFormSubmit);
  document.querySelectorAll('.difficulty-input').forEach(input => {
    input.addEventListener('input', validateDifficultyDistribution);
  });
}

async function handleAddQuiz() {
  const select = document.getElementById('quizSelect');
  const quizId = select.value;
  if (!quizId) return;
  if (selectedQuizIds.has(quizId)) {
    showWarning('هذا الاختبار مضاف بالفعل');
    return;
  }

  const quiz = allQuizzes.find(q => q.id === quizId);
  if (quiz && quiz.questionsCount === 0) {
    showWarning(`⚠️ "${quiz.name}" لا يحتوي على أسئلة`);
    return;
  }

  try {
    const res = await fetch(`/api/quizzes/${quizId}`);
    const data = await res.json();
    const questions = data.questions || [];

    if (!questions.length) {
      showWarning(`⚠️ "${data.name || quiz?.name}" لا يحتوي على أسئلة`);
      return;
    }

    selectedQuizIds.add(quizId);
    // Merge questions into pool (avoid duplicates by id)
    const existingIds = new Set(allQuestions.map(q => q.id));
    questions.forEach(q => { if (!existingIds.has(q.id)) allQuestions.push(q); });

    renderSelectedQuizzes(quizId, data.name || quiz?.name, questions.length);
    updatePoolInfo();
    validateDifficultyDistribution();

    // Reset select
    select.value = '';
  } catch (err) {
    showWarning('فشل تحميل الاختبار: ' + err.message);
  }
}

function renderSelectedQuizzes(quizId, name, count) {
  const container = document.getElementById('selectedQuizzes');
  const tag = document.createElement('div');
  tag.className = 'quiz-tag';
  tag.dataset.id = quizId;
  tag.innerHTML = `<span>${name} <em>(${count} سؤال)</em></span><button type="button" class="remove-quiz" data-id="${quizId}">✕</button>`;
  tag.querySelector('.remove-quiz').addEventListener('click', () => removeQuiz(quizId, tag));
  container.appendChild(tag);
}

async function removeQuiz(quizId, tagEl) {
  selectedQuizIds.delete(quizId);
  tagEl.remove();
  // Reload questions from remaining selected quizzes
  allQuestions = [];
  for (const id of selectedQuizIds) {
    try {
      const res = await fetch(`/api/quizzes/${id}`);
      const data = await res.json();
      (data.questions || []).forEach(q => allQuestions.push(q));
    } catch {}
  }
  updatePoolInfo();
  validateDifficultyDistribution();
}

function updatePoolInfo() {
  const info = document.getElementById('quizPoolInfo');
  if (!allQuestions.length) { info.style.display = 'none'; return; }

  const normalized = allQuestions.map(normalizeQ);
  const easy   = normalized.filter(q => q.difficulty === 'easy').length;
  const medium = normalized.filter(q => q.difficulty === 'medium').length;
  const hard   = normalized.filter(q => q.difficulty === 'hard').length;

  info.style.display = 'block';
  info.innerHTML = `📦 المجموع الكلي: <strong>${normalized.length}</strong> سؤال — سهلة: <strong>${easy}</strong> · متوسطة: <strong>${medium}</strong> · صعبة: <strong>${hard}</strong>`;

  document.getElementById('easyAvail').textContent   = `متاح: ${easy}`;
  document.getElementById('mediumAvail').textContent = `متاح: ${medium}`;
  document.getElementById('hardAvail').textContent   = `متاح: ${hard}`;
}

function normalizeQ(q) {
  return {
    id:         q.id,
    question:   q.text || q.question || '',
    choices:    q.options || q.choices || [],
    correct:    typeof q.correctAnswer !== 'undefined' ? q.correctAnswer : q.correct,
    difficulty: q.difficulty || 'easy',
  };
}

function validateDifficultyDistribution() {
  const easy   = parseInt(document.getElementById('easyCount').value)   || 0;
  const medium = parseInt(document.getElementById('mediumCount').value) || 0;
  const hard   = parseInt(document.getElementById('hardCount').value)   || 0;
  const total  = easy + medium + hard;

  document.getElementById('totalLabel').textContent = `الإجمالي: ${total}`;

  const warning = document.getElementById('difficultyWarning');
  if (total !== 15) {
    warning.style.display = 'block';
    warning.textContent = `⚠️ الإجمالي ${total} — يجب أن يكون 15`;
  } else {
    warning.style.display = 'none';
  }

  // Warn if requested > available
  if (allQuestions.length) {
    const normalized = allQuestions.map(normalizeQ);
    const avail = {
      easy:   normalized.filter(q => q.difficulty === 'easy').length,
      medium: normalized.filter(q => q.difficulty === 'medium').length,
      hard:   normalized.filter(q => q.difficulty === 'hard').length,
    };
    const colorEl = (id, ok) => {
      document.getElementById(id).style.color = ok ? '' : '#ef4444';
    };
    colorEl('easyAvail',   easy   <= avail.easy);
    colorEl('mediumAvail', medium <= avail.medium);
    colorEl('hardAvail',   hard   <= avail.hard);
  }
}

function showWarning(msg) {
  const w = document.getElementById('difficultyWarning');
  w.style.display = 'block';
  w.textContent = msg;
  setTimeout(() => { if (w.textContent === msg) w.style.display = 'none'; }, 4000);
}

function buildQuestionList(settings) {
  const { difficultyDistribution, ordering } = settings;
  const normalized = allQuestions.map(normalizeQ);
  const easy   = normalized.filter(q => q.difficulty === 'easy');
  const medium = normalized.filter(q => q.difficulty === 'medium');
  const hard   = normalized.filter(q => q.difficulty === 'hard');

  const pick = (pool, count) => [...pool].sort(() => Math.random() - 0.5).slice(0, count);

  const picked = [
    ...pick(easy,   difficultyDistribution.easy),
    ...pick(medium, difficultyDistribution.medium),
    ...pick(hard,   difficultyDistribution.hard),
  ];

  return ordering === 'random' ? picked.sort(() => Math.random() - 0.5) : picked;
}

async function handleFormSubmit(e) {
  e.preventDefault();

  if (!selectedQuizIds.size) {
    showWarning('⚠️ أضف اختباراً واحداً على الأقل');
    return;
  }

  const easy   = parseInt(document.getElementById('easyCount').value)   || 0;
  const medium = parseInt(document.getElementById('mediumCount').value) || 0;
  const hard   = parseInt(document.getElementById('hardCount').value)   || 0;

  if (easy + medium + hard !== 15) {
    showWarning('⚠️ يجب أن يكون إجمالي الأسئلة 15');
    return;
  }

  // Check available vs requested
  const normalized = allQuestions.map(normalizeQ);
  const avail = {
    easy:   normalized.filter(q => q.difficulty === 'easy').length,
    medium: normalized.filter(q => q.difficulty === 'medium').length,
    hard:   normalized.filter(q => q.difficulty === 'hard').length,
  };
  if (easy > avail.easy)     { showWarning(`⚠️ طلبت ${easy} سهلة لكن المتاح ${avail.easy} فقط`);   return; }
  if (medium > avail.medium) { showWarning(`⚠️ طلبت ${medium} متوسطة لكن المتاح ${avail.medium} فقط`); return; }
  if (hard > avail.hard)     { showWarning(`⚠️ طلبت ${hard} صعبة لكن المتاح ${avail.hard} فقط`);   return; }

  const settings = {
    difficultyDistribution: { easy, medium, hard },
    ordering: document.getElementById('orderingType').value,
    lifelines: {
      fiftyFifty: document.getElementById('lifelineFiftyFifty').checked,
      change:     document.getElementById('lifelineChange').checked,
      hint:       document.getElementById('lifelineHint').checked,
    },
  };

  settings.questions = buildQuestionList(settings);
  localStorage.setItem('millionGameSettings', JSON.stringify(settings));
  window.location.href = '/pages/million/million-game.html';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSettings);
} else {
  initSettings();
}
