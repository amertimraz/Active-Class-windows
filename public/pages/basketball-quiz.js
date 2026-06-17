(function(){
  const hasAPI = typeof window !== 'undefined' && !!window.api;
  const screens = {
    start: document.getElementById('start-screen'),
    question: document.getElementById('question-screen'),
    shot: document.getElementById('shot-screen'),
    result: document.getElementById('result-screen')
  };

  const quizSelect = document.getElementById('quizSelect');
  const startGameBtn = document.getElementById('startGame');
  const scoreValue = document.getElementById('scoreValue');
  const shotsValue = document.getElementById('shotsValue');
  const correctValue = document.getElementById('correctValue');
  const questionIndexEl = document.getElementById('questionIndex');
  const questionTotalEl = document.getElementById('questionTotal');
  const progressBar = document.getElementById('progressBar');
  const questionText = document.getElementById('questionText');
  const optionsGrid = document.getElementById('optionsGrid');
  const questionImageWrap = document.getElementById('questionImageWrap');
  const questionImage = document.getElementById('questionImage');

  const shotPointsEl = document.getElementById('shotPoints');
  const shotMadeEl = document.getElementById('shotMade');
  const quickShotBtn = document.getElementById('quickShot');
  const skipShotBtn = document.getElementById('skipShot');
  const shotMessage = document.getElementById('shotMessage');

  const finalScore = document.getElementById('finalScore');
  const finalCorrect = document.getElementById('finalCorrect');
  const finalShots = document.getElementById('finalShots');
  const restartGameBtn = document.getElementById('restartGame');

  const court = document.getElementById('court');
  const ball = document.getElementById('ball');
  const rim = document.getElementById('rim');
  const aimLine = document.getElementById('aimLine');

  const state = {
    quizzes: [],
    currentQuiz: null,
    questionIndex: 0,
    score: 0,
    correctCount: 0,
    shotsMade: 0,
    shotsTaken: 0,
    shotScore: 0,
    isShooting: false,
    dragStart: null,
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    gravity: 0.5,
    animationId: null
  };

  function showScreen(key){
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[key].classList.add('active');
  }

  function normalizeQuiz(quiz){
    if (!quiz) return null;
    const questions = Array.isArray(quiz.questions) ? quiz.questions.map(normalizeQuestion).filter(Boolean) : [];
    if (!questions.length) return null;
    return { id: quiz.id || quiz._id || quiz.title || Date.now(), title: quiz.title || quiz.name || 'اختبار', questions };
  }

  function normalizeQuestion(q){
    if (!q || typeof q !== 'object') return null;
    const text = q.text || q.question || q.title || 'سؤال';
    const options = Array.isArray(q.options) ? q.options : Array.isArray(q.choices) ? q.choices : Array.isArray(q.answers) ? q.answers : [];
    const normalizedOptions = options.length ? options.map(o => (o != null ? String(o) : '')) : ['صح','خطأ','—','—'];
    let correct = typeof q.correctAnswer === 'number' ? q.correctAnswer : typeof q.correctIndex === 'number' ? q.correctIndex : typeof q.correct === 'number' ? q.correct : 0;
    correct = Math.max(0, Math.min(normalizedOptions.length - 1, Number(correct) || 0));
    return { text, options: normalizedOptions, correctAnswer: correct, image: q.image || null };
  }

  async function loadQuizzes(){
    try {
      let list = [];
      if (window.quizData && Array.isArray(window.quizData.questions)) {
        list = [normalizeQuiz(window.quizData)].filter(Boolean);
      } else if (hasAPI && (window.api.loadQuizzes || window.api.getQuizzes)) {
        const res = await (window.api.loadQuizzes || window.api.getQuizzes)();
        list = Array.isArray(res) ? res.map(normalizeQuiz).filter(Boolean) : [];
      } else {
        const stored = JSON.parse(localStorage.getItem('cm_quizzes_v1') || '[]');
        const arr = Array.isArray(stored) ? stored : Object.values(stored || {});
        list = arr.map(normalizeQuiz).filter(Boolean);
      }
      state.quizzes = list;
      quizSelect.innerHTML = list.length ? '<option value="">اختر اختباراً</option>' : '<option value="">لا توجد اختبارات جاهزة</option>';
      list.forEach(q => {
        const opt = document.createElement('option');
        opt.value = q.id;
        opt.textContent = q.title;
        quizSelect.appendChild(opt);
      });
    } catch {
      quizSelect.innerHTML = '<option value="">تعذر تحميل الاختبارات</option>';
    }
  }

  function updateScoreboard(){
    scoreValue.textContent = state.score + state.shotScore;
    shotsValue.textContent = `${state.shotsMade}/${state.shotsTaken}`;
    correctValue.textContent = state.correctCount;
    shotPointsEl.textContent = state.shotScore;
    shotMadeEl.textContent = state.shotsMade;
  }

  function startGame(){
    state.currentQuiz = state.quizzes.find(q => String(q.id) === String(quizSelect.value));
    if (!state.currentQuiz) return;
    state.questionIndex = 0;
    state.score = 0;
    state.correctCount = 0;
    state.shotsMade = 0;
    state.shotsTaken = 0;
    state.shotScore = 0;
    updateScoreboard();
    renderQuestion();
    showScreen('question');
  }

  function renderQuestion(){
    const quiz = state.currentQuiz;
    if (!quiz || !quiz.questions[state.questionIndex]) {
      endGame();
      return;
    }
    const q = quiz.questions[state.questionIndex];
    questionIndexEl.textContent = state.questionIndex + 1;
    questionTotalEl.textContent = quiz.questions.length;
    progressBar.style.width = `${((state.questionIndex + 1) / quiz.questions.length) * 100}%`;
    questionText.textContent = q.text;
    optionsGrid.innerHTML = '';
    if (q.image) {
      questionImageWrap.style.display = 'block';
      questionImage.src = q.image;
    } else {
      questionImageWrap.style.display = 'none';
      questionImage.removeAttribute('src');
    }
    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => handleAnswer(idx));
      optionsGrid.appendChild(btn);
    });
  }

  function handleAnswer(index){
    const quiz = state.currentQuiz;
    const q = quiz.questions[state.questionIndex];
    const buttons = optionsGrid.querySelectorAll('.option-btn');
    buttons.forEach(b => b.disabled = true);
    const correct = index === q.correctAnswer;
    if (correct) {
      buttons[index].classList.add('correct');
      state.score += 10;
      state.correctCount += 1;
      updateScoreboard();
      setTimeout(() => {
        prepareShot();
        showScreen('shot');
      }, 600);
    } else {
      buttons[index].classList.add('wrong');
      if (typeof q.correctAnswer === 'number' && buttons[q.correctAnswer]) {
        buttons[q.correctAnswer].classList.add('correct');
      }
      setTimeout(nextQuestion, 900);
    }
  }

  function nextQuestion(){
    state.questionIndex += 1;
    renderQuestion();
    showScreen('question');
  }

  function endGame(){
    finalScore.textContent = state.score + state.shotScore;
    finalCorrect.textContent = state.correctCount;
    finalShots.textContent = `${state.shotsMade}/${state.shotsTaken}`;
    showScreen('result');
  }

  function resetBall(){
    const rect = court.getBoundingClientRect();
    state.ball.x = rect.width * 0.18;
    state.ball.y = rect.height * 0.72;
    state.ball.vx = 0;
    state.ball.vy = 0;
    updateBallPosition();
  }

  function updateBallPosition(){
    ball.style.transform = `translate(${state.ball.x}px, ${state.ball.y}px)`;
  }

  function prepareShot(){
    state.isShooting = false;
    state.dragStart = null;
    state.ball.scored = false;
    shotMessage.textContent = '';
    resetBall();
    aimLine.style.display = 'none';
  }

  function startShot(vx, vy){
    if (state.isShooting) return;
    state.isShooting = true;
    state.ball.vx = vx;
    state.ball.vy = vy;
    aimLine.style.display = 'none';
    state.shotsTaken += 1;
    updateScoreboard();
    state.animationId = requestAnimationFrame(stepShot);
  }

  function stepShot(){
    const rect = court.getBoundingClientRect();
    state.ball.vy += state.gravity;
    state.ball.x += state.ball.vx;
    state.ball.y += state.ball.vy;
    updateBallPosition();

    const rimRect = rim.getBoundingClientRect();
    const rimX = rimRect.left - rect.left + rimRect.width / 2;
    const rimY = rimRect.top - rect.top + rimRect.height / 2;
    const ballCenterX = state.ball.x + 22;
    const ballCenterY = state.ball.y + 22;
    const dx = ballCenterX - rimX;
    const dy = ballCenterY - rimY;

    if (!state.ball.scored && Math.abs(dx) < 16 && Math.abs(dy) < 12 && state.ball.vy > 0) {
      state.ball.scored = true;
      state.shotsMade += 1;
      state.shotScore += 10;
      shotMessage.textContent = 'سلة رائعة! +10 نقاط';
      updateScoreboard();
    }

    if (state.ball.y > rect.height + 40 || state.ball.x > rect.width + 40 || state.ball.x < -40) {
      finishShot();
      return;
    }

    state.animationId = requestAnimationFrame(stepShot);
  }

  function finishShot(){
    cancelAnimationFrame(state.animationId);
    state.animationId = null;
    state.isShooting = false;
    state.ball.scored = false;
    setTimeout(nextQuestion, 700);
  }

  function handlePointerDown(e){
    if (state.isShooting) return;
    const rect = court.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    const ballRect = ball.getBoundingClientRect();
    const bx = ballRect.left - rect.left + ballRect.width / 2;
    const by = ballRect.top - rect.top + ballRect.height / 2;
    const distance = Math.hypot(startX - bx, startY - by);
    if (distance > 60) return;
    state.dragStart = { x: startX, y: startY };
    aimLine.style.display = 'block';
    updateAimLine(startX, startY, startX, startY);
    ball.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e){
    if (!state.dragStart || state.isShooting) return;
    const rect = court.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    updateAimLine(state.dragStart.x, state.dragStart.y, currentX, currentY);
  }

  function handlePointerUp(e){
    if (!state.dragStart || state.isShooting) return;
    const rect = court.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;
    const dx = endX - state.dragStart.x;
    const dy = endY - state.dragStart.y;
    const power = Math.min(18, Math.max(6, Math.hypot(dx, dy) / 10));
    const vx = (dx / 20) * (power / 10);
    const vy = (dy / 18) * (power / 10);
    state.dragStart = null;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      aimLine.style.display = 'none';
      return;
    }
    startShot(vx, vy);
  }

  function updateAimLine(x1, y1, x2, y2){
    const length = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
    aimLine.style.width = `${Math.min(220, length)}px`;
    aimLine.style.left = `${x1}px`;
    aimLine.style.top = `${y1}px`;
    aimLine.style.transform = `rotate(${angle}deg)`;
  }

  quizSelect.addEventListener('change', () => {
    startGameBtn.disabled = !quizSelect.value;
  });

  startGameBtn.addEventListener('click', startGame);
  restartGameBtn.addEventListener('click', () => {
    showScreen('start');
  });

  quickShotBtn.addEventListener('click', () => startShot(7.5, -14));
  skipShotBtn.addEventListener('click', () => {
    if (!state.isShooting) nextQuestion();
  });

  ball.addEventListener('pointerdown', handlePointerDown);
  ball.addEventListener('pointermove', handlePointerMove);
  ball.addEventListener('pointerup', handlePointerUp);
  ball.addEventListener('pointercancel', handlePointerUp);

  window.addEventListener('resize', () => {
    if (screens.shot.classList.contains('active')) resetBall();
  });

  loadQuizzes();
})();
