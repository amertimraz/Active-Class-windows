'use strict';

(function () {

  // Trial gate — block entire page
  if (window.trialBlock && window.trialBlock('competitions')) {
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:80vh;gap:16px;font-family:Cairo,sans-serif;text-align:center;color:#64748b">
        <div style="font-size:3rem">🏆</div>
        <h2 style="color:#1e293b;margin:0">المسابقات غير متاحة في النسخة التجريبية</h2>
        <p style="margin:0;font-size:.9rem">فعّل البرنامج للوصول إلى المسابقات وجميع الميزات</p>
        <a href="/pages/activation.html" style="background:#0f766e;color:#fff;padding:10px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.95rem">فعّل الآن ←</a>
      </div>`;
    return;
  }

  // ═══════════════════════════════════════════
  // DOM refs
  // ═══════════════════════════════════════════
  const setupScreen    = document.getElementById('setupScreen');
  const prematchScreen = document.getElementById('prematchScreen');
  const gameScreen     = document.getElementById('gameScreen');
  const resultsScreen  = document.getElementById('resultsScreen');

  // Setup
  const quizSelect       = document.getElementById('cmpQuizSelect');
  const groupSelect      = document.getElementById('cmpGroupSelect');
  const refreshGroupsBtn = document.getElementById('cmpRefreshGroups');
  const timeBtns         = document.querySelectorAll('.cmp-time-btn');
  const questionsCountEl = document.getElementById('cmpQuestionsCount');
  const modeTabs         = document.querySelectorAll('.cmp-mode-tab');
  const teamSetupCol     = document.getElementById('teamSetupCol');
  const pvpSetupCol      = document.getElementById('pvpSetupCol');
  const countBtns        = document.querySelectorAll('.cmp-count-btn');
  const distributeBtn    = document.getElementById('cmpDistributeBtn');
  const teamsPreviewEl   = document.getElementById('cmpTeamsPreview');
  const pvpStudent1El    = document.getElementById('pvpStudent1');
  const pvpStudent2El    = document.getElementById('pvpStudent2');
  const pvpRandomBtn     = document.getElementById('pvpRandomBtn');
  const startBtn         = document.getElementById('cmpStartBtn');

  // Game
  const questionCounterEl = document.getElementById('cmpQuestionCounter');
  const turnBadgeEl       = document.getElementById('cmpTurnBadge');
  const turnDotEl         = document.getElementById('cmpTurnDot'); // قد لا يوجد بعد الـ redesign
  const turnNameEl        = document.getElementById('cmpTurnName');
  const pauseBtn          = document.getElementById('cmpPauseBtn');
  const resumeBtn         = document.getElementById('cmpResumeBtn');
  const nextBtn           = document.getElementById('cmpNextBtn');
  const endBtn            = document.getElementById('cmpEndBtn');
  const scoreboardEl      = document.getElementById('cmpScoreboard');
  const timerFillEl       = document.getElementById('cmpTimerFill');
  const timerLabelEl      = document.getElementById('cmpTimerNum');
  const questionTextEl    = document.getElementById('cmpQuestionText');
  const optionsEl         = document.getElementById('cmpOptions');
  const judgeHintEl       = document.getElementById('cmpJudgeHintText');
  const continueBtn       = document.getElementById('cmpContinueBtn');
  const fullscreenBtn     = document.getElementById('cmpFullscreenBtn');

  // Results
  const podiumEl     = document.getElementById('cmpPodium');
  const playAgainBtn = document.getElementById('cmpPlayAgainBtn');

  // Toast / celebrate
  const toastEl     = document.getElementById('cmpToast');
  const celebrateEl = document.getElementById('cmpCelebrate');

  // ═══════════════════════════════════════════
  // Constants
  // ═══════════════════════════════════════════
  const TEAM_PRESETS = [
    { name: 'الأسود',    icon: '🦁', color: '#d97706' },
    { name: 'التنانين', icon: '🐉', color: '#dc2626' },
    { name: 'الصواعق',  icon: '⚡', color: '#2563eb' },
    { name: 'البراكين', icon: '🔥', color: '#ea580c' },
    { name: 'الأمواج',  icon: '🌊', color: '#0891b2' },
    { name: 'الصقور',   icon: '🦅', color: '#0f766e' },
    { name: 'النجوم',   icon: '⭐', color: '#7c3aed' },
    { name: 'الذئاب',   icon: '🐺', color: '#4f46e5' },
  ];

  // ═══════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════
  let cfg = {
    mode: 'team',
    quizId: '',
    groupId: '',
    questionDuration: 20,
    questionsCount: 10,
    teamsCount: 3,
  };

  let data = {
    allStudents: [],
    allGroups:   [],
    allQuizzes:  [],
  };

  // teams/pvpPlayers: [{id, name, color, members:[], score}]
  let game = {
    teams:            [],
    pvpPlayers:       [],
    questions:        [],
    currentIndex:     0,
    turnIndex:        0,   // دور مين دلوقتي (round-robin)
    paused:           false,
    timerLeft:        20,
    timerTotal:       20,
    timerStartedAt:   0,
    timerTick:        null,
    questionRevealed: false,
      };

  // ═══════════════════════════════════════════
  // Utils
  // ═══════════════════════════════════════════
  function uid() { return Math.random().toString(36).slice(2, 9); }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function toast(msg, type = 'info') {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'cmp-toast cmp-toast-' + type + ' show';
    toastEl.hidden = false;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.classList.remove('show'); toastEl.hidden = true; }, 2800);
  }

  // ═══════════════════════════════════════════
  // Sound (Web Audio API — بدون ملفات صوت)
  // ═══════════════════════════════════════════
  let _audioCtx = null;
  function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
  }

  function playSound(type) {
    try {
      const ctx  = getAudioCtx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      const t = ctx.currentTime;

      if (type === 'correct') {
        // وتر صاعد احتفالي
        [[523,.08],[659,.18],[784,.28],[1047,.38]].forEach(([freq, when]) => {
          const o = ctx.createOscillator();
          o.type = 'sine'; o.frequency.value = freq;
          o.connect(gain); o.start(t + when); o.stop(t + when + .25);
        });
        gain.gain.setValueAtTime(.28, t);
        gain.gain.exponentialRampToValueAtTime(.001, t + .7);
      } else if (type === 'wrong') {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(300, t);
        o.frequency.linearRampToValueAtTime(120, t + .35);
        o.connect(gain); o.start(t); o.stop(t + .35);
        gain.gain.setValueAtTime(.22, t);
        gain.gain.exponentialRampToValueAtTime(.001, t + .35);
      } else if (type === 'tick') {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = 880;
        o.connect(gain); o.start(t); o.stop(t + .06);
        gain.gain.setValueAtTime(.12, t);
        gain.gain.exponentialRampToValueAtTime(.001, t + .06);
      } else if (type === 'timeup') {
        const o = ctx.createOscillator();
        o.type = 'square'; o.frequency.value = 220;
        o.connect(gain); o.start(t); o.stop(t + .5);
        gain.gain.setValueAtTime(.18, t);
        gain.gain.exponentialRampToValueAtTime(.001, t + .5);
      }
    } catch {}
  }

  // ═══════════════════════════════════════════
  // Celebrate — كونفيتي أقوى
  // ═══════════════════════════════════════════
  function celebrate() {
    if (!celebrateEl) return;
    celebrateEl.innerHTML = '';
    const colors = ['#f59e0b','#10b981','#3b82f6','#ec4899','#8b5cf6','#ef4444'];
    for (let i = 0; i < 60; i++) {
      const el = document.createElement('div');
      el.className = 'cmp-confetti-piece';
      el.style.cssText = `
        left:${Math.random()*100}%;
        background:${colors[Math.floor(Math.random()*colors.length)]};
        width:${6+Math.random()*8}px; height:${6+Math.random()*8}px;
        border-radius:${Math.random()>.5?'50%':'2px'};
        animation-delay:${Math.random()*.5}s;
        animation-duration:${.8+Math.random()*.8}s;
      `;
      celebrateEl.appendChild(el);
    }
    celebrateEl.classList.remove('hidden');
    setTimeout(() => { celebrateEl.classList.add('hidden'); celebrateEl.innerHTML=''; }, 2000);
  }

  function getEntities() {
    return cfg.mode === 'team' ? game.teams : game.pvpPlayers;
  }

  function getCurrentEntity() {
    const entities = getEntities();
    return entities[game.turnIndex % entities.length];
  }

  // ═══════════════════════════════════════════
  // Data loading
  // ═══════════════════════════════════════════
  async function loadAll() {
    await Promise.all([loadGroups(), loadStudents(), loadQuizzes()]);
    renderStudentSelects();
  }

  async function loadGroups() {
    try {
      const api = window.api;
      data.allGroups = api && api.loadGroups
        ? (await api.loadGroups()) || []
        : JSON.parse(localStorage.getItem('cm_groups_v1') || '[]');
    } catch { data.allGroups = []; }

    groupSelect.innerHTML = '<option value="">— كل الطلاب —</option>';
    data.allGroups.forEach(g => {
      const o = document.createElement('option');
      o.value = g.id; o.textContent = g.name;
      groupSelect.appendChild(o);
    });
  }

  async function loadStudents() {
    try {
      const api = window.api;
      data.allStudents = api && api.loadStudents
        ? (await api.loadStudents()) || []
        : JSON.parse(localStorage.getItem('cm_students_v1') || '[]');
    } catch { data.allStudents = []; }
  }

  async function loadQuizzes() {
    try {
      const api = window.api;
      const list = api && api.loadQuizzes
        ? (await api.loadQuizzes()) || []
        : JSON.parse(localStorage.getItem('cm_quizzes_v1') || '[]');

      data.allQuizzes = list.filter(q => q && q.id).map(q => ({
        id:             q.id,
        title:          q.title || q.name || 'اختبار',
        groupId:        q.groupId || q.group_id || '',
        questionsCount: Number(q.questionsCount) || 0,
      }));
    } catch { data.allQuizzes = []; }
  }

  async function fetchFullQuiz(quizId) {
    try {
      const api = window.api;
      const quiz = api && api.loadQuiz ? await api.loadQuiz(quizId) : null;
      return normalizeQuiz(quiz);
    } catch { return null; }
  }

  function normalizeQuiz(quiz) {
    if (!quiz || !Array.isArray(quiz.questions)) return null;
    const questions = quiz.questions.map(q => {
      const text    = q.text || q.question || q.title || 'سؤال';
      const options = Array.isArray(q.options || q.choices) ? (q.options || q.choices) : [];
      if (options.length < 2) return null;
      const ca = typeof q.correctAnswer === 'number' ? q.correctAnswer
               : typeof q.correctIndex  === 'number' ? q.correctIndex : 0;
      return { text, options, correctAnswer: Math.max(0, Math.min(options.length - 1, ca)) };
    }).filter(Boolean);
    if (!questions.length) return null;
    return { id: quiz.id, title: quiz.title || quiz.name || 'اختبار', questions };
  }

  // ═══════════════════════════════════════════
  // Quiz filter by group
  // ═══════════════════════════════════════════
  function filterQuizzesByGroup() {
    const gid      = cfg.groupId;
    const filtered = gid ? data.allQuizzes.filter(q => q.groupId === gid) : data.allQuizzes;
    const prev     = cfg.quizId;

    quizSelect.innerHTML = filtered.length
      ? '<option value="">— اختر اختبار —</option>'
      : `<option value="">${gid ? 'لا توجد اختبارات لهذه المجموعة' : 'لا توجد اختبارات'}</option>`;

    filtered.forEach(q => {
      const o = document.createElement('option');
      o.value = q.id;
      o.textContent = q.title + (q.questionsCount ? ` (${q.questionsCount} سؤال)` : '');
      quizSelect.appendChild(o);
    });

    cfg.quizId = filtered.find(q => q.id === prev) ? prev : '';
    quizSelect.value = cfg.quizId;
  }

  function getFilteredStudents() {
    return cfg.groupId
      ? data.allStudents.filter(s => s.groupId === cfg.groupId)
      : data.allStudents;
  }

  function renderStudentSelects() {
    const students = getFilteredStudents();
    [pvpStudent1El, pvpStudent2El].forEach(sel => {
      const prev = sel.value;
      sel.innerHTML = '<option value="">— اختر —</option>';
      students.forEach(s => {
        const o = document.createElement('option');
        o.value = s.id; o.textContent = s.name;
        sel.appendChild(o);
      });
      sel.value = prev;
    });
  }

  // ═══════════════════════════════════════════
  // Team distribution
  // ═══════════════════════════════════════════
  function distributeTeams() {
    if (!cfg.groupId) { toast('اختر مجموعة أولاً', 'warning'); return; }
    const students = shuffle(getFilteredStudents());
    if (!students.length) { toast('لا يوجد طلاب في هذه المجموعة', 'warning'); return; }

    const n       = cfg.teamsCount;
    const presets = shuffle([...TEAM_PRESETS]).slice(0, n);
    game.teams    = Array.from({ length: n }, (_, i) => ({
      id: uid(),
      name: presets[i].name,
      icon: presets[i].icon,
      color: presets[i].color,
      members: [], score: 0,    }));
    students.forEach((s, i) => game.teams[i % n].members.push(s));

    renderTeamsPreview();
    toast('تم توزيع الفرق ✓', 'success');
  }

  function renderTeamsPreview() {
    if (!teamsPreviewEl) return;
    teamsPreviewEl.innerHTML = game.teams.map(t => `
      <div class="cmp-team-card" style="border-color:${t.color}30;background:${t.color}08">
        <div class="cmp-team-card-title" style="color:${t.color}">
          <span class="cmp-team-icon">${t.icon || ''}</span>
          ${t.name}
          <span style="opacity:.55;font-size:12px;margin-right:4px">(${t.members.length})</span>
          ${t.members.length === 0 ? '<span class="cmp-team-empty-warn">⚠️ فارغ</span>' : ''}
        </div>
        <div class="cmp-team-members">
          ${t.members.map(m => `<span class="cmp-member-chip">${m.name}</span>`).join('')}
        </div>
      </div>
    `).join('');
  }

  // ═══════════════════════════════════════════
  // Game start
  // ═══════════════════════════════════════════
  async function startGame() {
    if (!cfg.quizId) { toast('اختر اختبار أولاً', 'warning'); return; }

    if (cfg.mode === 'team') {
      if (!game.teams.length) { toast('وزّع الفرق أولاً', 'warning'); return; }
      const empty = game.teams.find(t => t.members.length === 0);
      if (empty) { toast(`فريق "${empty.icon || ''} ${empty.name}" فارغ — وزّع الطلاب أولاً`, 'warning'); return; }
    } else {
      const id1 = pvpStudent1El.value;
      const id2 = pvpStudent2El.value;
      if (!id1 || !id2)   { toast('اختر الطالبَين أولاً', 'warning'); return; }
      if (id1 === id2)    { toast('اختر طالبَين مختلفَين', 'warning'); return; }
      const s1 = data.allStudents.find(s => s.id === id1);
      const s2 = data.allStudents.find(s => s.id === id2);
      game.pvpPlayers = [
        { id: s1.id, name: s1.name, color: TEAM_COLORS[0], score: 0, jokerUsed: false },
        { id: s2.id, name: s2.name, color: TEAM_COLORS[1], score: 0, jokerUsed: false },
      ];
    }

    startBtn.disabled    = true;
    startBtn.textContent = '⏳ جاري التحميل…';

    const quiz = await fetchFullQuiz(cfg.quizId);

    startBtn.disabled    = false;
    startBtn.textContent = '▶ ابدأ المسابقة';

    if (!quiz) { toast('تعذّر تحميل الاختبار', 'warning'); return; }

    const total       = Math.max(1, Math.min(50, cfg.questionsCount));
    game.questions    = shuffle([...quiz.questions]).slice(0, total);
    game.currentIndex = 0;
    game.turnIndex    = 0;
    game.paused       = false;
    game.jokerEntityId = null;

    // reset scores
    getEntities().forEach(e => { e.score = 0; });

    if (cfg.mode === 'team') await showPreMatchScreen();
    showScreen('game');
    await showReadyOverlay();
    showQuestion();
  }

  // ═══════════════════════════════════════════
  // Ready overlay (قبل أول سؤال بس)
  // ═══════════════════════════════════════════
  function showReadyOverlay() {
    return new Promise(resolve => {
      const overlay = document.getElementById('cmpReadyOverlay');
      const teamEl  = document.getElementById('cmpReadyTeam');
      const startBtn = document.getElementById('cmpReadyStartBtn');
      if (!overlay || !teamEl || !startBtn) { resolve(); return; }

      const entity = getCurrentEntity();
      teamEl.textContent = entity?.name || '—';
      overlay.style.setProperty('--turn-color', entity?.color || 'var(--primary)');
      startBtn.style.background = entity?.color || '';
      overlay.classList.remove('hidden');

      const handler = () => {
        startBtn.removeEventListener('click', handler);
        startBtn.classList.add('hidden');
        const countEl = document.getElementById('cmpReadyCount');
        if (!countEl) { overlay.classList.add('hidden'); resolve(); return; }

        let n = 3;
        countEl.textContent = n;
        countEl.classList.remove('hidden');
        playSound('tick');

        const iv = setInterval(() => {
          n--;
          if (n <= 0) {
            clearInterval(iv);
            overlay.classList.add('hidden');
            startBtn.classList.remove('hidden');
            countEl.classList.add('hidden');
            resolve();
          } else {
            countEl.textContent = n;
            playSound('tick');
          }
        }, 900);
      };
      startBtn.addEventListener('click', handler);
    });
  }

  // ═══════════════════════════════════════════
  // Question display
  // ═══════════════════════════════════════════
  function showQuestion() {
    const q = game.questions[game.currentIndex];
    game.stealMode        = false;
    game.questionRevealed = false;

    questionCounterEl.textContent = `السؤال ${game.currentIndex + 1} / ${game.questions.length}`;
    // progress dots
    const dotsEl = document.getElementById('cmpProgressDots');
    if (dotsEl) {
      dotsEl.innerHTML = game.questions.map((_, i) => {
        const cls = i < game.currentIndex ? 'done' : i === game.currentIndex ? 'current' : '';
        return `<span class="cmp-dot ${cls}"></span>`;
      }).join('');
    }
    questionTextEl.textContent    = q.text;

    const LETTERS = ['أ', 'ب', 'ج', 'د'];
    optionsEl.innerHTML = '';
    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'cmp-option';
      btn.innerHTML = `<span class="cmp-option-letter">${LETTERS[idx] || idx+1}</span><span class="cmp-option-text">${opt}</span>`;
      btn.addEventListener('click', () => onOptionClick(idx));
      optionsEl.appendChild(btn);
    });

    hideContinueBtn();
    if (judgeHintEl) judgeHintEl.textContent = `اضغط على إجابة ${getCurrentEntity()?.name || 'الفريق'} 👆`;

    // بادج الدور
    updateTurnBadge();

    // الليدربورد
    renderScoreboard();

    startTimer();
  }

  function updateTurnBadge() {
    const entity = getCurrentEntity();
    if (!entity || !turnBadgeEl) return;
    if (turnDotEl) turnDotEl.style.background = entity.color;
    turnNameEl.textContent = entity.name;
    turnBadgeEl.style.setProperty('--turn-color', entity.color);
    turnBadgeEl.classList.add('active');
  }

  function revealOptions(chosenIdx) {
    const correct = game.questions[game.currentIndex].correctAnswer;
    optionsEl.querySelectorAll('.cmp-option').forEach((btn, idx) => {
      if (idx === correct)      btn.classList.add('correct');
      else if (idx === chosenIdx) btn.classList.add('wrong');
      btn.disabled = true;
    });
  }

  // ═══════════════════════════════════════════
  // الضغط على خيار = الحكم مباشرة
  // ═══════════════════════════════════════════
  function onOptionClick(chosenIdx) {
    if (game.questionRevealed) return;
    game.questionRevealed = true;
    stopTimer();

    const correct = game.questions[game.currentIndex].correctAnswer;
    revealOptions(chosenIdx);

    if (chosenIdx === correct) {
      const entity     = getCurrentEntity();
      const speedBonus = Math.round((game.timerLeft / game.timerTotal) * 5);
      const pts = 10 + speedBonus;
      addScore(entity.id, pts);
      toast(`✓ ${entity.name} صح! +${pts} نقطة`, 'success');
      playSound('correct');
      celebrate();
    } else {
      const entity = getCurrentEntity();
      toast(`✗ ${entity.name} غلط!`, 'error');
      playSound('wrong');
    }
    showContinueBtn();
  }

function addScore(id, pts) {
    const entity = getEntities().find(e => e.id === id);
    if (entity) entity.score += pts;
    renderScoreboard();
  }

  function nextQuestion() {
    game.turnIndex++;   // الدور الجاي تلقائي

    if (game.currentIndex < game.questions.length - 1) {
      game.currentIndex++;
      showQuestion();
    } else {
      endGame();
    }
  }

  function endGame() {
    stopTimer();
    showScreen('results');
    renderResults();
  }

  // ═══════════════════════════════════════════
  // Scoreboard (شريط أفقي)
  // ═══════════════════════════════════════════
  function renderScoreboard() {
    if (!scoreboardEl) return;
    const entities = getEntities();
    const current  = getCurrentEntity();
    const topScore = Math.max(...entities.map(e => e.score));

    // احفظ النقاط القديمة قبل إعادة الرسم
    const prevScores = {};
    scoreboardEl.querySelectorAll('.cmp-score-chip[data-id]').forEach(chip => {
      prevScores[chip.dataset.id] = chip.querySelector('.cmp-chip-score')?.textContent;
    });

    scoreboardEl.innerHTML = entities.map(e => {
      const isActive  = e.id === current?.id;
      const isLeading = e.score > 0 && e.score === topScore;
      return `
        <div class="cmp-score-chip ${isActive ? 'active' : ''}" style="--chip-color:${e.color}" data-id="${e.id}">
          ${isLeading ? `<span class="cmp-chip-crown">👑</span>` : ''}
          <span class="cmp-chip-name" style="color:${isActive ? e.color : ''}">${e.name}</span>
          ${isActive ? `<span class="cmp-chip-label">يجاوب الآن</span>` : ''}
          <span class="cmp-chip-score">${e.score}</span>
        </div>
      `;
    }).join('');

    // animation لما النقاط تتغير
    scoreboardEl.querySelectorAll('.cmp-score-chip[data-id]').forEach(chip => {
      const id  = chip.dataset.id;
      const cur = chip.querySelector('.cmp-chip-score')?.textContent;
      if (prevScores[id] !== undefined && prevScores[id] !== cur) {
        chip.classList.add('score-updated');
        chip.addEventListener('animationend', () => chip.classList.remove('score-updated'), { once: true });
      }
    });

  }

  // ═══════════════════════════════════════════
  // Timer
  // ═══════════════════════════════════════════
  let _timerGen = 0; // generation counter — يمنع أي interval قديم يأثر على العداد

  function startTimer() {
    stopTimer();
    _timerGen++;
    const gen = _timerGen;

    game.timerTotal     = cfg.questionDuration;
    game.timerLeft      = cfg.questionDuration;
    game.timerStartedAt = Date.now();
    game.paused         = false;

    // snap الشريط لـ 100% بدون animation
    if (timerFillEl) {
      timerFillEl.style.transition = 'none';
      timerFillEl.style.transform  = 'scaleX(1)';
      timerFillEl.style.background = '#f59e0b';
      timerFillEl.getBoundingClientRect();
      timerFillEl.style.transition = '';
    }
    if (timerLabelEl) timerLabelEl.textContent = `${game.timerTotal} ث`;

    game.timerTick = setInterval(() => {
      if (gen !== _timerGen) return; // interval قديم، تجاهل
      if (game.paused) return;
      const elapsed  = Math.floor((Date.now() - game.timerStartedAt) / 1000);
      game.timerLeft = Math.max(0, game.timerTotal - elapsed);
      updateTimerDisplay();
      if (game.timerLeft <= 0) { stopTimer(); onTimeUp(); }
    }, 200);
  }

  function stopTimer() {
    _timerGen++; // أبطل أي interval قديم حتى لو clearInterval تأخر
    if (game.timerTick) { clearInterval(game.timerTick); game.timerTick = null; }
    if (timerFillEl) {
      // خذ القيمة المرسومة فعلاً (وسط أي transition) وليس القيمة المستهدفة
      const live = window.getComputedStyle(timerFillEl).transform;
      timerFillEl.style.transition = 'none';
      timerFillEl.getBoundingClientRect(); // force reflow — يجعل transition:none يأخذ أثره فوراً
      timerFillEl.style.transform  = live;
    }
    timerFillEl?.parentElement?.classList.remove('urgent');
  }

  function updateTimerDisplay() {
    const scale = game.timerLeft / game.timerTotal;
    if (timerLabelEl) timerLabelEl.textContent = `${game.timerLeft} ث`;
    if (timerFillEl) {
      timerFillEl.style.transform  = `scaleX(${scale})`;
      timerFillEl.style.background = scale > 0.5 ? '#f59e0b' : scale > 0.25 ? '#f97316' : '#ef4444';
    }
    // urgent mode: نبضة + صوت تيك عند آخر 10 ثواني
    const track = timerFillEl?.parentElement;
    if (track) track.classList.toggle('urgent', game.timerLeft <= 10 && game.timerLeft > 0);
    if (game.timerLeft <= 10 && game.timerLeft > 0) playSound('tick');
  }

  function onTimeUp() {
    if (game.questionRevealed) return;
    game.questionRevealed = true;
    playSound('timeup');
    toast('⏰ انتهى الوقت!', 'warning');
    revealOptions(-1);
    showContinueBtn();
  }

  function showContinueBtn() {
    if (judgeHintEl) judgeHintEl.classList.add('hidden');
    if (continueBtn) continueBtn.classList.remove('hidden');
  }

  function hideContinueBtn() {
    if (continueBtn) continueBtn.classList.add('hidden');
    if (judgeHintEl) judgeHintEl.classList.remove('hidden');
  }

  function setPaused(flag) {
    game.paused = flag;
    if (!flag && game.timerLeft > 0)
      game.timerStartedAt = Date.now() - (game.timerTotal - game.timerLeft) * 1000;
    pauseBtn.classList.toggle('hidden', flag);
    resumeBtn.classList.toggle('hidden', !flag);
  }

  // ═══════════════════════════════════════════
  // Results
  // ═══════════════════════════════════════════
  function renderResults() {
    const sorted = [...getEntities()].sort((a, b) => b.score - a.score);
    const medals = ['🥇','🥈','🥉'];

    podiumEl.innerHTML = sorted.map((e, i) => `
      <div class="cmp-result-card" style="border-color:${e.color}40;background:${e.color}10">
        <div class="cmp-result-medal">${medals[i] || (i + 1)}</div>
        <div class="cmp-result-name" style="color:${e.color}">${e.name}</div>
        <div class="cmp-result-score">${e.score} نقطة</div>
        ${cfg.mode === 'team' && e.members
          ? `<div class="cmp-result-members">${e.members.map(m => m.name).join('، ')}</div>`
          : ''}
      </div>
    `).join('');

    if (sorted[0]) celebrate();

    try {
      const result = {
        date: new Date().toISOString(), mode: cfg.mode,
        questionsCount: game.questions.length,
        winners: sorted.slice(0, 3).map(e => ({ name: e.name, score: e.score }))
      };
      const prev = JSON.parse(localStorage.getItem('cm_competition_results') || '[]');
      localStorage.setItem('cm_competition_results', JSON.stringify([result, ...prev].slice(0, 20)));
    } catch { }
  }

  // ═══════════════════════════════════════════
  // Screen switching
  // ═══════════════════════════════════════════
  function showScreen(name) {
    setupScreen.classList.toggle('hidden',    name !== 'setup');
    prematchScreen?.classList.toggle('hidden', name !== 'prematch');
    gameScreen.classList.toggle('hidden',     name !== 'game');
    resultsScreen.classList.toggle('hidden',  name !== 'results');
    document.body.classList.toggle('cmp-game-active', name === 'game');
  }

  function showPreMatchScreen() {
    return new Promise(resolve => {
      const teamsEl    = document.getElementById('prematchTeams');
      const subtitleEl = document.getElementById('prematchSubtitle');
      const startBtn   = document.getElementById('cmpPrematchStartBtn');
      if (!teamsEl) { resolve(); return; }

      const quiz = data.allQuizzes.find(q => q.id === cfg.quizId);
      if (subtitleEl) subtitleEl.textContent = quiz?.title || '';

      // build cards — all hidden initially
      teamsEl.innerHTML = game.teams.map(t => `
        <div class="cmp-prematch-team-card" style="--team-color:${t.color}">
          <div class="cmp-pm-glow"></div>
          <div class="cmp-pm-icon pm-part">${t.icon || '🏆'}</div>
          <div class="cmp-pm-name pm-part">${t.name}</div>
          <div class="cmp-pm-divider pm-part"></div>
          <div class="cmp-pm-chips pm-part">
            ${t.members.map(m => `<span class="cmp-pm-chip pm-chip">${m.name}</span>`).join('')}
          </div>
        </div>
      `).join('');

      startBtn?.classList.add('hidden');
      showScreen('prematch');

      const cards = teamsEl.querySelectorAll('.cmp-prematch-team-card');
      let delay = 200;

      cards.forEach(card => {
        setTimeout(() => card.classList.add('pm-card-in'), delay);
        delay += 300;

        card.querySelectorAll('.pm-part').forEach(part => {
          if (part.classList.contains('cmp-pm-chips')) {
            setTimeout(() => part.classList.add('pm-part-in'), delay);
            delay += 100;
            part.querySelectorAll('.pm-chip').forEach(chip => {
              setTimeout(() => chip.classList.add('pm-chip-in'), delay);
              delay += 90;
            });
            delay += 100;
          } else {
            setTimeout(() => part.classList.add('pm-part-in'), delay);
            delay += 160;
          }
        });

        delay += 350;
      });

      setTimeout(() => startBtn?.classList.remove('hidden'), delay);

      const handler = () => {
        startBtn.removeEventListener('click', handler);
        resolve();
      };
      startBtn?.addEventListener('click', handler);
    });
  }

  // ═══════════════════════════════════════════
  // Event bindings
  // ═══════════════════════════════════════════
  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      modeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      cfg.mode = tab.dataset.mode;
      teamSetupCol.classList.toggle('hidden', cfg.mode !== 'team');
      pvpSetupCol.classList.toggle('hidden',  cfg.mode !== 'pvp');
    });
  });

  timeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      timeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cfg.questionDuration = Number(btn.dataset.sec);
    });
  });

  countBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      countBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cfg.teamsCount = Number(btn.dataset.n);
      updateSetupHints();
    });
  });

  quizSelect.addEventListener('change', () => {
    cfg.quizId = quizSelect.value;
    const quiz = data.allQuizzes.find(q => q.id === cfg.quizId);
    if (quiz?.questionsCount) {
      const max = quiz.questionsCount;
      if (questionsCountEl) {
        questionsCountEl.max   = max;
        if (Number(questionsCountEl.value) > max) {
          questionsCountEl.value = max;
          cfg.questionsCount     = max;
        }
        questionsCountEl.title = `الاختبار يحتوي ${max} سؤال`;
      }
    }
  });
  groupSelect.addEventListener('change', () => {
    cfg.groupId = groupSelect.value;
    renderStudentSelects();
    filterQuizzesByGroup();
    updateSetupHints();
  });

  function updateSetupHints() {
    const countEl = document.getElementById('cmpStudentCount');
    const distEl  = document.getElementById('cmpDistHint');
    const students = getFilteredStudents();
    const n        = cfg.teamsCount || 3;

    if (countEl) {
      countEl.textContent = cfg.groupId
        ? `${students.length} طالب في هذه المجموعة`
        : students.length ? `${students.length} طالب (كل المجموعات)` : '';
    }

    if (distEl && students.length && cfg.groupId) {
      const base  = Math.floor(students.length / n);
      const extra = students.length % n;
      if (extra === 0) {
        distEl.textContent = `${base} أفراد لكل فريق`;
      } else {
        distEl.textContent = `${base + 1} أفراد في ${extra} فريق، و${base} في الباقين`;
      }
    } else if (distEl) {
      distEl.textContent = cfg.groupId ? '' : '';
    }
  }

  refreshGroupsBtn?.addEventListener('click', async () => {
    await loadGroups(); await loadStudents();
    renderStudentSelects(); filterQuizzesByGroup();
    toast('تم التحديث');
  });

  questionsCountEl?.addEventListener('change', () => {
    cfg.questionsCount = Number(questionsCountEl.value) || 10;
  });

  distributeBtn?.addEventListener('click', distributeTeams);

  pvpRandomBtn?.addEventListener('click', () => {
    const students = shuffle(getFilteredStudents());
    if (students.length < 2) { toast('لا يوجد طلاب كافيون', 'warning'); return; }
    pvpStudent1El.value = students[0].id;
    pvpStudent2El.value = students[1].id;
    toast(`${students[0].name} 🆚 ${students[1].name}`, 'success');
  });

  startBtn?.addEventListener('click', startGame);

  pauseBtn?.addEventListener('click',  () => setPaused(true));
  resumeBtn?.addEventListener('click', () => setPaused(false));

  // زر "تخطى" — يظهر الإجابة ويخلي المعلم يضغط "استمر" للانتقال
  nextBtn?.addEventListener('click', () => {
    if (game.questionRevealed) return;
    game.questionRevealed = true;
    stopTimer();
    revealOptions(-1);
    showContinueBtn();
  });

  // زر "الفريق التالي" — ينتقل للسؤال الجاي بعد ما المعلم مستعد
  continueBtn?.addEventListener('click', () => {
    hideContinueBtn();
    nextQuestion();
  });

  // زر ملء الشاشة
  fullscreenBtn?.addEventListener('click', () => {
    const gameEl = document.getElementById('gameScreen');
    if (!document.fullscreenElement) {
      (gameEl || document.documentElement).requestFullscreen?.();
      fullscreenBtn.textContent = '✕';
      fullscreenBtn.title = 'خروج من ملء الشاشة';
    } else {
      document.exitFullscreen?.();
      fullscreenBtn.textContent = '⛶';
      fullscreenBtn.title = 'ملء الشاشة';
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      if (fullscreenBtn) { fullscreenBtn.textContent = '⛶'; fullscreenBtn.title = 'ملء الشاشة'; }
    }
  });

  endBtn?.addEventListener('click', endGame);

  playAgainBtn?.addEventListener('click', () => {
    game.jokerEntityId = null;
    showScreen('setup');
  });

  // ═══════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════
  (async function init() {
    showScreen('setup');
    await loadAll();
    filterQuizzesByGroup();
  })();

})();
