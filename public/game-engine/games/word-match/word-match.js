(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────
  const DIFFICULTY = { easy: 120, medium: 60, hard: 30 };
  const POINTS_BASE = 100;
  const POINTS_SPEED_BONUS = 50;

  // ─── State ───────────────────────────────────────────────────────────────────
  let engine = null;
  let pixiApp = null;
  let bgScene = null;
  let _pendingTimeouts = [];

  function _safeTimeout(fn, ms) {
    const id = setTimeout(() => {
      _pendingTimeouts = _pendingTimeouts.filter(x => x !== id);
      fn();
    }, ms);
    _pendingTimeouts.push(id);
    return id;
  }

  function _clearAllTimeouts() {
    _pendingTimeouts.forEach(id => clearTimeout(id));
    _pendingTimeouts = [];
  }

  const state = {
    phase: 'start',          // start | playing | result
    questions: [],
    currentIndex: 0,
    score: 0,
    correctCount: 0,
    timeLeft: 60,
    timerInterval: null,
    questionStartTime: 0,
    difficulty: 'medium',
    totalTimes: [],
    locked: false
  };

  // ─── PixiJS Background Scene ──────────────────────────────────────────────
  class BackgroundScene extends GE_Scene {
    constructor() {
      super('Background');
      this._stars = [];
      this._particles = [];
      this._time = 0;
    }

    create() {
      const { width, height } = this.engine.app.renderer;
      this._createStarfield(width, height);
      this._createNebula(width, height);
    }

    _createStarfield(w, h) {
      const count = Math.floor((w * h) / 4000);
      for (let i = 0; i < count; i++) {
        const g = new PIXI.Graphics();
        const radius = Math.random() * 1.5 + 0.3;
        const alpha = Math.random() * 0.6 + 0.2;
        g.beginFill(0xffffff, alpha);
        g.drawCircle(0, 0, radius);
        g.endFill();
        g.x = Math.random() * w;
        g.y = Math.random() * h;
        g._twinkleSpeed = Math.random() * 2 + 0.5;
        g._twinkleOffset = Math.random() * Math.PI * 2;
        g._baseAlpha = alpha;
        this._container.addChild(g);
        this._stars.push(g);
      }
    }

    _createNebula(w, h) {
      const colors = [0x1e3a5c, 0x0f2744, 0x162c4a, 0x1a3050];
      for (let i = 0; i < 4; i++) {
        const g = new PIXI.Graphics();
        const x = Math.random() * w;
        const y = Math.random() * h;
        const rx = Math.random() * w * 0.4 + w * 0.2;
        const ry = Math.random() * h * 0.4 + h * 0.2;
        g.beginFill(colors[i % colors.length], 0.18);
        g.drawEllipse(x, y, rx, ry);
        g.endFill();
        this._container.addChildAt(g, 0);
      }
    }

    update(delta) {
      this._time += delta;
      for (const star of this._stars) {
        star.alpha = star._baseAlpha *
          (0.6 + 0.4 * Math.sin(this._time * star._twinkleSpeed + star._twinkleOffset));
      }
    }
  }

  // ─── Particle Burst ────────────────────────────────────────────────────────
  function createBurst(container, x, y, color, count = 12) {
    const particles = [];
    for (let i = 0; i < count; i++) {
      const g = new PIXI.Graphics();
      g.beginFill(color, 1);
      g.drawCircle(0, 0, Math.random() * 4 + 2);
      g.endFill();
      g.x = x;
      g.y = y;
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const speed = Math.random() * 120 + 60;
      g._vx = Math.cos(angle) * speed;
      g._vy = Math.sin(angle) * speed - 80;
      g._life = 1;
      container.addChild(g);
      particles.push(g);
    }

    let elapsed = 0;
    const tick = (delta) => {
      elapsed += delta;
      let alive = false;
      for (const p of particles) {
        if (p._life <= 0 || p.destroyed) continue;
        alive = true;
        p._vy += 200 * delta;
        p.x += p._vx * delta;
        p.y += p._vy * delta;
        p._life -= delta * 1.8;
        p.alpha = Math.max(0, p._life);
        p.scale.set(Math.max(0, p._life));
      }
      if (!alive || elapsed > 1.2) {
        engine && engine.Loop && engine.Loop.remove(tick);
        for (const p of particles) { try { if (!p.destroyed) p.destroy(); } catch (e) {} }
      }
    };
    engine && engine.Loop && engine.Loop.add(tick);
  }

  // ─── Score Pop ─────────────────────────────────────────────────────────────
  function createScorePop(container, x, y, text, color = 0xffd700) {
    const label = new PIXI.Text(text, {
      fontFamily: 'Cairo, Arial',
      fontSize: 28,
      fontWeight: 'bold',
      fill: color,
      stroke: 0x000000,
      strokeThickness: 3
    });
    label.anchor.set(0.5, 0.5);
    label.x = x;
    label.y = y;
    label.alpha = 1;
    container.addChild(label);

    let elapsed = 0;
    const tick = (delta) => {
      if (label.destroyed) {
        engine && engine.Loop && engine.Loop.remove(tick);
        return;
      }
      elapsed += delta;
      label.y -= 60 * delta;
      label.alpha = Math.max(0, 1 - elapsed * 1.5);
      label.scale.set(1 + elapsed * 0.3);
      if (elapsed > 0.8) {
        engine && engine.Loop && engine.Loop.remove(tick);
        try { if (!label.destroyed) label.destroy(); } catch (e) {}
      }
    };
    engine && engine.Loop && engine.Loop.add(tick);
  }

  // ─── UI Helpers ────────────────────────────────────────────────────────────
  function showScreen(id) {
    ['wm-start-screen', 'wm-question-screen', 'wm-result-screen'].forEach(s => {
      const el = document.getElementById(s);
      if (!el) return;
      if (s === id) { el.classList.add('wm-active'); }
      else { el.classList.remove('wm-active'); }
    });
  }

  function setHUDVisible(v) {
    const hud = document.getElementById('wm-hud');
    if (hud) hud.style.display = v ? 'grid' : 'none';
  }

  function updateHUD() {
    const scoreEl = document.getElementById('wm-score');
    const timerEl = document.getElementById('wm-timer');
    const curEl   = document.getElementById('wm-current-q');
    const totEl   = document.getElementById('wm-total-q');
    const fillEl  = document.getElementById('wm-progress-fill');

    if (scoreEl) scoreEl.textContent = state.score.toLocaleString('ar-EG');
    if (timerEl) {
      timerEl.textContent = state.timeLeft;
      timerEl.classList.toggle('wm-danger', state.timeLeft <= 10);
    }
    if (curEl) curEl.textContent = state.currentIndex + 1;
    if (totEl) totEl.textContent = state.questions.length;
    if (fillEl) {
      const pct = state.questions.length > 0
        ? (state.currentIndex / state.questions.length) * 100 : 0;
      fillEl.style.width = pct + '%';
    }
  }

  function updateRoundBadge(text) {
    const el = document.getElementById('wm-round-info');
    if (el) el.textContent = text;
  }

  // ─── Timer ─────────────────────────────────────────────────────────────────
  function startTimer() {
    clearTimer();
    const maxTime = DIFFICULTY[state.difficulty] || 60;
    state.timeLeft = maxTime;
    updateHUD();
    state.timerInterval = setInterval(() => {
      if (state.phase !== 'playing') return;
      state.timeLeft = Math.max(0, state.timeLeft - 1);
      updateHUD();
      if (state.timeLeft === 0) {
        if (!state.locked) onTimeUp();
      }
    }, 1000);
  }

  function clearTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  // ─── Game Flow ─────────────────────────────────────────────────────────────
  async function startGame() {
    const startBtn = document.getElementById('wm-start-btn');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = '⏳ جاري التحميل...'; }

    const select = document.getElementById('wm-quiz-select');
    const quizId = select ? select.value : 'fallback';

    let quizData;
    const isFallback = !quizId || quizId === 'fallback' || quizId.startsWith('fallback');
    if (!isFallback) {
      quizData = await engine.EduAPI.loadQuizById(quizId);
    } else {
      quizData = engine.EduAPI._getFallbackQuestions()[0];
    }

    const questions = Array.isArray(quizData && quizData.questions) ? quizData.questions : [];

    if (questions.length === 0) {
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = '🚀 ابدأ اللعبة'; }
      engine.UI.showFeedback('لا توجد أسئلة في هذا الاختبار!', 'wrong', 2000);
      return;
    }

    if (startBtn) { startBtn.disabled = false; startBtn.textContent = '🚀 ابدأ اللعبة'; }

    Object.assign(state, {
      phase: 'playing',
      questions: shuffleArray(questions).slice(0, 10),
      currentIndex: 0,
      score: 0,
      correctCount: 0,
      totalTimes: [],
      locked: false
    });

    engine.EduAPI.startSession({
      gameId: 'word-match',
      gameName: 'مطابقة الكلمات',
      level: state.difficulty === 'easy' ? 1 : state.difficulty === 'medium' ? 2 : 3,
      metadata: { quizId, difficulty: state.difficulty }
    });

    engine.Audio.playStartSFX();
    setHUDVisible(true);
    showScreen('wm-question-screen');
    updateRoundBadge(`صعوبة: ${state.difficulty === 'easy' ? 'سهل' : state.difficulty === 'medium' ? 'متوسط' : 'صعب'}`);
    startTimer();
    renderQuestion();
  }

  function renderQuestion() {
    const q = state.questions[state.currentIndex];
    if (!q) { endGame(); return; }

    state.locked = false;
    state.questionStartTime = Date.now();

    const textEl = document.getElementById('wm-question-text');
    const catEl  = document.getElementById('wm-q-category');
    const grid   = document.getElementById('wm-options-grid');
    const card   = document.getElementById('wm-question-card');

    if (textEl) textEl.textContent = q.text || q.question || '';
    if (catEl)  catEl.textContent  = q.category || 'سؤال';
    if (card) {
      card.classList.remove('wm-card-animate');
      requestAnimationFrame(() => card.classList.add('wm-card-animate'));
    }
    if (!document.getElementById('wm-card-anim-style')) {
      const style = document.createElement('style');
      style.id = 'wm-card-anim-style';
      style.textContent = `
        @keyframes wm-card-in {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .wm-card-animate { animation: wm-card-in 0.35s cubic-bezier(0.34,1.56,0.64,1); }`;
      document.head.appendChild(style);
    }

    if (!grid) return;
    grid.innerHTML = '';
    const options = Array.isArray(q.options) ? q.options : [];
    options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'wm-option-btn';
      btn.textContent = opt;
      btn.dataset.idx = idx;
      btn.addEventListener('click', () => onOptionClick(btn, idx, q));
      grid.appendChild(btn);
    });

    updateHUD();
  }

  function onOptionClick(btn, idx, q) {
    if (state.locked || state.phase !== 'playing') return;
    state.locked = true;

    const elapsed = (Date.now() - state.questionStartTime) / 1000;
    state.totalTimes.push(elapsed);

    const correct = idx === (q.correctAnswer ?? q.correct_answer ?? 0);
    const grid = document.getElementById('wm-options-grid');

    btn.classList.add(correct ? 'wm-correct' : 'wm-wrong');
    if (grid) {
      Array.from(grid.children).forEach(b => { b.disabled = true; });
      if (!correct) {
        const correctBtn = grid.children[q.correctAnswer ?? 0];
        if (correctBtn) correctBtn.classList.add('wm-correct');
      }
    }

    if (correct) {
      const speedBonus = elapsed < 5 ? POINTS_SPEED_BONUS : elapsed < 10 ? 25 : 0;
      const points = POINTS_BASE + speedBonus;
      state.score += points;
      state.correctCount++;
      engine.Audio.playCorrectSFX();
      engine.UI.showFeedback(speedBonus > 0 ? `✅ ممتاز! +${points}` : '✅ صحيح!', 'correct', 900);
      if (bgScene && bgScene.container) {
        const rect = btn.getBoundingClientRect();
        const cRect = document.getElementById('wm-canvas-container').getBoundingClientRect();
        const px = rect.left + rect.width / 2 - cRect.left;
        const py = rect.top + rect.height / 2 - cRect.top;
        createBurst(bgScene.container, px, py, 0x22c55e, 16);
        createScorePop(bgScene.container, px, py - 40, `+${points}`);
      }
    } else {
      engine.Audio.playWrongSFX();
      engine.UI.showFeedback('❌ خطأ!', 'wrong', 900);
      if (bgScene && bgScene.container) {
        const rect = btn.getBoundingClientRect();
        const cRect = document.getElementById('wm-canvas-container').getBoundingClientRect();
        const px = rect.left + rect.width / 2 - cRect.left;
        const py = rect.top + rect.height / 2 - cRect.top;
        createBurst(bgScene.container, px, py, 0xef4444, 10);
      }
    }

    engine.EduAPI.recordAnswer(correct, POINTS_BASE, { questionIndex: state.currentIndex });
    updateHUD();

    _safeTimeout(() => {
      state.currentIndex++;
      if (state.currentIndex >= state.questions.length) {
        endGame();
      } else {
        renderQuestion();
      }
    }, 1300);
  }

  function onTimeUp() {
    state.locked = true;
    engine.Audio.playWrongSFX();
    engine.UI.showFeedback('⏰ انتهى الوقت!', 'info', 1000);
    _safeTimeout(endGame, 1200);
  }

  function endGame() {
    state.phase = 'result';
    clearTimer();

    const result = engine.EduAPI.endSession(state.score);
    engine.Audio.playFinishSFX();

    setHUDVisible(false);
    showScreen('wm-result-screen');
    updateRoundBadge('النتيجة النهائية');

    const total = state.questions.length;
    const accuracy = total > 0 ? Math.round((state.correctCount / total) * 100) : 0;
    const avgTime = state.totalTimes.length > 0
      ? Math.round(state.totalTimes.reduce((a, b) => a + b, 0) / state.totalTimes.length)
      : 0;

    const scoreEl    = document.getElementById('wm-final-score');
    const correctEl  = document.getElementById('wm-final-correct');
    const accuracyEl = document.getElementById('wm-final-accuracy');
    const timeEl     = document.getElementById('wm-final-time');
    const iconEl     = document.getElementById('wm-result-icon');
    const titleEl    = document.getElementById('wm-result-title');
    const msgEl      = document.getElementById('wm-result-message');

    if (scoreEl)    scoreEl.textContent    = state.score.toLocaleString('ar-EG');
    if (correctEl)  correctEl.textContent  = `${state.correctCount}/${total}`;
    if (accuracyEl) accuracyEl.textContent = accuracy + '%';
    if (timeEl)     timeEl.textContent     = avgTime + ' ث';

    let icon = '🏆', title = 'ممتاز!', msg = '';
    if      (accuracy >= 90) { icon = '🏆'; title = 'رائع جداً!';     msg = 'أداء استثنائي! أنت نجم الفصل 🌟'; }
    else if (accuracy >= 70) { icon = '🥇'; title = 'ممتاز!';         msg = 'أداء رائع! استمر في التعلم 💪'; }
    else if (accuracy >= 50) { icon = '🥈'; title = 'جيد!';            msg = 'أداء جيد، حاول مرة أخرى للحصول على نتيجة أفضل'; }
    else                      { icon = '💪'; title = 'حاول مرة أخرى!'; msg = 'لا تستسلم! المحاولة مفتاح النجاح'; }

    if (iconEl)  iconEl.textContent  = icon;
    if (titleEl) titleEl.textContent = title;
    if (msgEl)   msgEl.textContent   = msg;

    if (pixiApp && engine && engine._initialized) {
      const { width, height } = pixiApp.renderer;
      const celebContainer = new PIXI.Container();
      pixiApp.stage.addChild(celebContainer);
      const colors = [0xffd700, 0xff6b6b, 0x4ecdc4, 0x45b7d1, 0x96ceb4, 0xffeaa7];
      for (let i = 0; i < 6; i++) {
        _safeTimeout(() => {
          if (!engine || !engine._initialized) return;
          createBurst(
            celebContainer,
            Math.random() * width,
            Math.random() * height * 0.5,
            colors[i % colors.length],
            20
          );
        }, i * 200);
      }
      _safeTimeout(() => {
        try { celebContainer.destroy({ children: true }); } catch (e) {}
      }, 3000);
    }
  }

  // ─── Quiz Loading ───────────────────────────────────────────────────────────
  async function loadQuizzes() {
    const select = document.getElementById('wm-quiz-select');
    if (!select) return;

    select.innerHTML = '<option value="">جاري التحميل...</option>';

    try {
      const quizzes = await engine.EduAPI.loadQuizzes();
      window._wmQuizList = Array.isArray(quizzes) ? quizzes : [];

      if (window._wmQuizList.length === 0) {
        select.innerHTML = '<option value="">لا توجد اختبارات — سيتم استخدام أسئلة افتراضية</option>';
        window._wmQuizList = [{ id: 'fallback', title: 'أسئلة تعليمية عامة' }];
      }

      select.innerHTML = window._wmQuizList.map(q =>
        `<option value="${q.id}">${q.title || q.name || 'اختبار'}</option>`
      ).join('');

      const startBtn = document.getElementById('wm-start-btn');
      if (startBtn) startBtn.disabled = false;
    } catch (e) {
      console.error('[WordMatch] Quiz load error:', e);
      select.innerHTML = '<option value="fallback">أسئلة تعليمية عامة</option>';
      const startBtn = document.getElementById('wm-start-btn');
      if (startBtn) startBtn.disabled = false;
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────
  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function resizeEngine() {
    const container = document.getElementById('wm-canvas-container');
    if (!container || !engine || !engine.app) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) engine.resize(w, h);
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    const container = document.getElementById('wm-canvas-container');
    if (!container) return;

    try {
      engine = await GameEngine.init({
        container: 'wm-canvas-container',
        backgroundColor: 0x0d1b2a
      });

      pixiApp = engine.app;

      bgScene = new BackgroundScene();
      engine.Scenes.register('background', bgScene);
      await engine.Scenes.switchTo('background', 200);

      window.addEventListener('resize', resizeEngine);

      window.addEventListener('hashchange', () => {
        _clearAllTimeouts();
        clearTimer();
        state.phase = 'destroyed';
        window.removeEventListener('resize', resizeEngine);
      }, { once: true });

      const startBtn   = document.getElementById('wm-start-btn');
      const replayBtn  = document.getElementById('wm-replay-btn');
      const diffBtns   = document.querySelectorAll('.wm-diff-btn');

      diffBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          diffBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.difficulty = btn.dataset.diff;
        });
      });

      if (startBtn) startBtn.addEventListener('click', startGame);
      if (replayBtn) replayBtn.addEventListener('click', () => {
        showScreen('wm-start-screen');
        updateRoundBadge('الجولة 1');
        state.phase = 'start';
      });

      await loadQuizzes();

      console.log('[WordMatch] Initialized successfully');
    } catch (err) {
      console.error('[WordMatch] Init error:', err);
      const container = document.getElementById('wm-canvas-container');
      if (container) {
        container.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100%;
            color:rgba(255,255,255,0.7);font-family:Cairo,sans-serif;font-size:0.9rem;padding:2rem;text-align:center;">
            ⚠️ تعذّر تحميل محرك الرسوميات. تأكد من الاتصال بالإنترنت لتحميل PixiJS.
          </div>`;
      }
      const startBtn = document.getElementById('wm-start-btn');
      if (startBtn) startBtn.disabled = false;
      engine = {
        EduAPI: new GE_EducationalAPI(),
        Audio: new GE_AudioEngine(),
        UI: new GE_UISystem(),
        Loop: { add: () => {}, remove: () => {} },
        resize: () => {}
      };
      await loadQuizzes();
    }
  }

  init();
})();
