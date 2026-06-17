let allQuizzes = [];
let allQuestions = [];

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
  select.innerHTML = '<option value="">اختر اختبار...</option>';
  
  allQuizzes.forEach(quiz => {
    const option = document.createElement('option');
    option.value = quiz.id;
    option.textContent = quiz.name;
    select.appendChild(option);
  });
}

function setupEventListeners() {
  const quizSelect = document.getElementById('quizSelect');
  const form = document.getElementById('millionSettingsForm');
  const difficultyInputs = document.querySelectorAll('.difficulty-input');

  quizSelect.addEventListener('change', handleQuizChange);
  
  difficultyInputs.forEach(input => {
    input.addEventListener('change', validateDifficultyDistribution);
  });

  form.addEventListener('submit', handleFormSubmit);
}

async function handleQuizChange(e) {
  const quizId = e.target.value;
  if (quizId) {
    const quiz = allQuizzes.find(q => q.id === quizId);
    if (quiz && quiz.questions) {
      allQuestions = quiz.questions;
    }
  }
}

function validateDifficultyDistribution() {
  const easy = parseInt(document.getElementById('easyCount').value) || 0;
  const medium = parseInt(document.getElementById('mediumCount').value) || 0;
  const hard = parseInt(document.getElementById('hardCount').value) || 0;
  const total = easy + medium + hard;
  
  const warning = document.getElementById('difficultyWarning');
  
  if (total !== 15) {
    warning.style.display = 'block';
    warning.textContent = `⚠️ الإجمالي: ${total} (يجب أن يكون 15)`;
  } else {
    warning.style.display = 'none';
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const easy = parseInt(document.getElementById('easyCount').value) || 0;
  const medium = parseInt(document.getElementById('mediumCount').value) || 0;
  const hard = parseInt(document.getElementById('hardCount').value) || 0;
  const total = easy + medium + hard;

  if (total !== 15) {
    alert('⚠️ يجب أن يكون إجمالي الأسئلة 15');
    return;
  }

  const quizId = document.getElementById('quizSelect').value;
  if (!quizId) {
    alert('⚠️ اختر اختبار');
    return;
  }

  let settings = {
    sourceType: 'quiz',
    quizId,
    difficultyDistribution: {
      easy,
      medium,
      hard
    },
    ordering: document.getElementById('orderingType').value,
    lifelines: {
      fiftyFifty: document.getElementById('lifelineFiftyFifty').checked,
      change: document.getElementById('lifelineChange').checked,
      hint: document.getElementById('lifelineHint').checked
    }
  };

  try {
    const response = await window.api.createMillionSession(settings);
    if (response.ok && response.sessionId) {
      window.location.href = `/pages/million/million-game.html?sessionId=${response.sessionId}`;
    } else {
      alert(`❌ خطأ: ${response.error || 'فشل إنشاء الجلسة'}`);
    }
  } catch (error) {
    console.error('Error creating session:', error);
    alert(`❌ خطأ: ${error.message}`);
  }
}

document.addEventListener('DOMContentLoaded', initSettings);
