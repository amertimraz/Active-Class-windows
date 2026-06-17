'use strict';

(function () {

  /* =====================================================
     CONFIGURATION
     ===================================================== */
  const TEAM_COLORS = [
    { name: 'الفريق ١', number: '#e53e3e', bar: '#e53e3e' },
    { name: 'الفريق ٢', number: '#3b82f6', bar: '#3b82f6' },
    { name: 'الفريق ٣', number: '#f97316', bar: '#f97316' },
    { name: 'الفريق ٤', number: '#22c55e', bar: '#22c55e' },
    { name: 'الفريق ٥', number: '#ec4899', bar: '#ec4899' },
    { name: 'الفريق ٦', number: '#8b5cf6', bar: '#8b5cf6' },
  ];

  const ARABIC_NUMS = ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠'];

  const WHEEL_SEGMENT_COLORS = [
    '#DC143C', '#FFFFFF', '#0033A0', '#DC143C', '#FFFFFF',
    '#0033A0', '#DC143C', '#FFFFFF', '#0033A0', '#DC143C',
    '#FFFFFF', '#0033A0', '#DC143C', '#FFFFFF', '#0033A0',
    '#DC143C', '#FFFFFF', '#0033A0', '#DC143C', '#0033A0',
  ];

  /* =====================================================
     STATE
     ===================================================== */
  let state = {
    numTeams: 4,
    timeMins: 15,
    wheelMode: 'points',
    teams: [],
    currentTeam: 0,
    isSpinning: false,
    timerSecs: 0,
    timerInterval: null,
    timerRunning: false,
    wheelRotation: 0,
    segments: [],
    lastLanded: null,
  };

  /* =====================================================
     DOM REFS
     ===================================================== */
  const setupScreen   = document.getElementById('scSetupScreen');
  const gameScreen    = document.getElementById('scGameScreen');
  const gameoverScreen= document.getElementById('scGameoverScreen');
  const startBtn      = document.getElementById('scStartBtn');
  const playAgainBtn  = document.getElementById('scPlayAgainBtn');
  const pauseBtn      = document.getElementById('scPauseBtn');
  const backBtn       = document.getElementById('scBackToSetup');
  const timerLabel    = document.getElementById('scTimerLabel');
  const teamsLeft     = document.getElementById('scTeamsLeft');
  const teamsRight    = document.getElementById('scTeamsRight');
  const canvas        = document.getElementById('scWheelCanvas');
  const spinBtn       = document.getElementById('scSpinBtn');
  const spinBtnText   = document.getElementById('scSpinBtnText');
  const resultPopup   = document.getElementById('scResultPopup');
  const resultValue   = document.getElementById('scResultValue');
  const resultTeam    = document.getElementById('scResultTeam');
  const resAddBtn     = document.getElementById('scResAddBtn');
  const resSkipBtn    = document.getElementById('scResSkipBtn');
  const activeTeamName= document.getElementById('scActiveTeamName');
  const gameoverResults= document.getElementById('scGameoverResults');
  const starsBg       = document.getElementById('scStarsBg');

  let ctx = null;
  if (canvas) ctx = canvas.getContext('2d');

  /* =====================================================
     SETUP SCREEN — button groups
     ===================================================== */
  function initSetupButtons() {
    document.querySelectorAll('.sc-count-btn[data-count]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sc-count-btn[data-count]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.numTeams = parseInt(btn.dataset.count);
      });
    });

    document.querySelectorAll('.sc-count-btn[data-time]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sc-count-btn[data-time]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.timeMins = parseInt(btn.dataset.time);
      });
    });

    document.querySelectorAll('.sc-count-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sc-count-btn[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.wheelMode = btn.dataset.mode;
      });
    });
  }

  /* =====================================================
     GENERATE WHEEL SEGMENTS
     ===================================================== */
  function generateSegments(mode) {
    const segs = [];
    const count = 20;
    for (let i = 0; i < count; i++) {
      let label, value;
      if (mode === 'points') {
        value = Math.floor(Math.random() * 10) + 1;
        label = ARABIC_NUMS[value - 1];
      } else if (mode === 'multiply') {
        const a = Math.floor(Math.random() * 9) + 2;
        const b = Math.floor(Math.random() * 9) + 2;
        value = a * b;
        label = `${a}×${b}`;
      } else {
        const a = Math.floor(Math.random() * 49) + 1;
        const b = Math.floor(Math.random() * 49) + 1;
        value = a + b;
        label = `${a}+${b}`;
      }
      segs.push({ label, value, color: WHEEL_SEGMENT_COLORS[i % WHEEL_SEGMENT_COLORS.length] });
    }
    return segs;
  }

  /* =====================================================
     DRAW WHEEL ON CANVAS
     ===================================================== */
  function drawWheel(rotation) {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = cx - 8;
    const segs = state.segments;
    const n = segs.length;
    const arc = (Math.PI * 2) / n;

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();

    for (let i = 0; i < n; i++) {
      const startAngle = rotation + i * arc;
      const endAngle   = startAngle + arc;
      const seg = segs[i];

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const midAngle = startAngle + arc / 2;
      const starR = r * 0.72;
      const sx = cx + Math.cos(midAngle) * starR;
      const sy = cy + Math.sin(midAngle) * starR;
      drawStar(ctx, sx, sy, 5, 7, 3.5,
        seg.color === '#FFFFFF' ? 'rgba(0,0,130,.3)' : 'rgba(255,255,255,.35)');

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(midAngle);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const textR = r * 0.72;
      const fontSize = n > 16 ? 13 : 15;
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      ctx.fillStyle = seg.color === '#FFFFFF' ? '#0033A0' : '#fff';
      ctx.strokeStyle = seg.color === '#FFFFFF' ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.5)';
      ctx.lineWidth = 3;
      ctx.strokeText(seg.label, textR, 0);
      ctx.fillText(seg.label, textR, 0);
      ctx.restore();
    }

    const dotCount = n * 2;
    for (let i = 0; i < dotCount; i++) {
      const a = rotation + (Math.PI * 2 / dotCount) * i;
      const dx = cx + Math.cos(a) * (r + 2);
      const dy = cy + Math.sin(a) * (r + 2);
      ctx.beginPath();
      ctx.arc(dx, dy, 3, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? '#fff' : '#f5e642';
      ctx.fill();
    }

    const hubR = r * 0.18;
    ctx.beginPath();
    ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.stroke();
    drawStar(ctx, cx, cy, 5, hubR - 4, (hubR - 4) * 0.4, '#DC143C');
  }

  function drawStar(ctx, cx, cy, points, outerR, innerR, color) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (Math.PI / points) * i - Math.PI / 2;
      if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /* =====================================================
     BUILD TEAM CARDS
     ===================================================== */
  function buildTeamCards() {
    teamsLeft.innerHTML = '';
    teamsRight.innerHTML = '';
    state.teams = [];

    for (let i = 0; i < state.numTeams; i++) {
      const cfg = TEAM_COLORS[i];
      const team = { name: cfg.name, score: 0, index: i };
      state.teams.push(team);

      const card = document.createElement('div');
      card.className = 'sc-team-card';
      card.dataset.team = i;
      card.id = `scTeamCard_${i}`;
      card.innerHTML = `
        <div class="sc-team-top">
          <div class="sc-team-number" style="color:${cfg.number}">${ARABIC_NUMS[i]}</div>
        </div>
        <div class="sc-team-score-bar" style="background:${cfg.bar}">
          <span class="sc-team-score" id="scScore_${i}">٠</span>
        </div>
      `;

      if (i % 2 === 0) teamsLeft.appendChild(card);
      else teamsRight.appendChild(card);
    }
  }

  function updateScoreDisplay(teamIndex) {
    const el = document.getElementById(`scScore_${teamIndex}`);
    if (el) el.textContent = toArabicNum(state.teams[teamIndex].score);
  }

  function toArabicNum(n) {
    return String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  }

  function highlightActiveTeam() {
    document.querySelectorAll('.sc-team-card').forEach(c => c.classList.remove('active-team'));
    const card = document.getElementById(`scTeamCard_${state.currentTeam}`);
    if (card) card.classList.add('active-team');
    const t = state.teams[state.currentTeam];
    if (t && activeTeamName) activeTeamName.textContent = t.name;
  }

  /* =====================================================
     STARS BACKGROUND
     ===================================================== */
  function buildStars() {
    if (!starsBg) return;
    starsBg.innerHTML = '';
    for (let i = 0; i < 22; i++) {
      const s = document.createElement('div');
      s.className = 'sc-star';
      s.textContent = '★';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      s.style.animationDelay = (Math.random() * 3) + 's';
      s.style.fontSize = (1.2 + Math.random() * 1.8) + 'rem';
      starsBg.appendChild(s);
    }
  }

  /* =====================================================
     TIMER
     ===================================================== */
  function startTimer() {
    state.timerSecs = state.timeMins * 60;
    state.timerRunning = true;
    renderTimer();
    state.timerInterval = setInterval(() => {
      if (!state.timerRunning) return;
      state.timerSecs--;
      renderTimer();
      if (state.timerSecs <= 0) {
        clearInterval(state.timerInterval);
        endGame();
      }
    }, 1000);
  }

  function renderTimer() {
    const m = Math.floor(state.timerSecs / 60);
    const s = state.timerSecs % 60;
    if (timerLabel) timerLabel.textContent = `${pad(m)}:${pad(s)}`;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function togglePause() {
    state.timerRunning = !state.timerRunning;
    if (pauseBtn) pauseBtn.textContent = state.timerRunning ? '⏸' : '▶';
  }

  /* =====================================================
     SPIN WHEEL
     ===================================================== */
  function spinWheel() {
    if (state.isSpinning) return;
    state.isSpinning = true;
    resultPopup.style.display = 'none';
    spinBtn.disabled = true;
    spinBtnText.textContent = '...';

    const totalRotation = (Math.random() * 8 + 8) * Math.PI * 2;
    const duration = 4000 + Math.random() * 1500;
    const startRot = state.wheelRotation;
    const startTime = performance.now();

    function easeOut(t) { return 1 - Math.pow(1 - t, 4); }

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      state.wheelRotation = startRot + totalRotation * easeOut(t);
      drawWheel(state.wheelRotation);

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        state.isSpinning = false;
        onSpinEnd();
      }
    }

    requestAnimationFrame(animate);
  }

  function onSpinEnd() {
    const n = state.segments.length;
    const arc = (Math.PI * 2) / n;
    const normalized = (((-state.wheelRotation) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const idx = Math.floor(normalized / arc) % n;
    const seg = state.segments[idx];
    state.lastLanded = seg;

    resultValue.textContent = seg.label;
    resultTeam.textContent = state.teams[state.currentTeam].name + ' — ' + toArabicNum(seg.value) + ' نقطة';
    resultPopup.style.display = 'flex';
    spinBtnText.textContent = 'اضغط للدوران';
  }

  /* =====================================================
     SCORE ACTIONS
     ===================================================== */
  function addPoints() {
    if (!state.lastLanded) return;
    const t = state.teams[state.currentTeam];
    t.score += state.lastLanded.value;
    updateScoreDisplay(state.currentTeam);
    showScorePop(state.currentTeam, '+' + toArabicNum(state.lastLanded.value));
    spawnConfetti();
    nextTurn();
  }

  function nextTurn() {
    resultPopup.style.display = 'none';
    state.lastLanded = null;
    state.currentTeam = (state.currentTeam + 1) % state.numTeams;
    highlightActiveTeam();
    spinBtn.disabled = false;
  }

  function showScorePop(teamIndex, text) {
    const card = document.getElementById(`scTeamCard_${teamIndex}`);
    if (!card) return;
    const pop = document.createElement('div');
    pop.className = 'sc-score-pop';
    pop.textContent = text;
    const rect = card.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = rect.left + rect.width / 2 + 'px';
    pop.style.top = rect.top + 'px';
    pop.style.transform = 'translateX(-50%)';
    document.body.appendChild(pop);
    setTimeout(() => pop.remove(), 1300);
  }

  /* =====================================================
     CONFETTI
     ===================================================== */
  function spawnConfetti() {
    const colors = ['#e53e3e', '#3b82f6', '#f59e0b', '#22c55e', '#ec4899', '#8b5cf6', '#f5e642'];
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      p.className = 'sc-confetti-particle';
      p.style.left = 30 + Math.random() * 40 + 'vw';
      p.style.top = '-10px';
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDuration = (1.2 + Math.random() * 1) + 's';
      p.style.animationDelay = (Math.random() * .4) + 's';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 2500);
    }
  }

  /* =====================================================
     GAME FLOW
     ===================================================== */
  function startGame() {
    state.segments = generateSegments(state.wheelMode);
    state.currentTeam = 0;
    state.wheelRotation = 0;
    state.lastLanded = null;
    state.isSpinning = false;

    buildStars();
    buildTeamCards();
    highlightActiveTeam();
    drawWheel(state.wheelRotation);
    resultPopup.style.display = 'none';
    spinBtn.disabled = false;
    spinBtnText.textContent = 'اضغط للدوران';

    setupScreen.style.display = 'none';
    gameoverScreen.style.display = 'none';
    gameScreen.style.display = '';

    startTimer();
  }

  function endGame() {
    clearInterval(state.timerInterval);
    state.timerRunning = false;
    gameScreen.style.display = 'none';

    const sorted = [...state.teams].sort((a, b) => b.score - a.score);
    const medals = ['🥇', '🥈', '🥉'];

    gameoverResults.innerHTML = sorted.map((t, i) => `
      <div class="sc-result-row ${i === 0 ? 'winner' : ''}">
        <div class="sc-result-rank">${medals[i] || (i + 1)}</div>
        <div class="sc-result-team-name">${t.name}</div>
        <div class="sc-result-pts">${toArabicNum(t.score)} نقطة</div>
      </div>
    `).join('');

    gameoverScreen.style.display = '';
    if (sorted[0] && sorted[0].score > 0) spawnConfetti();

    try {
      const results = JSON.parse(localStorage.getItem('ge_game_results') || '[]');
      results.push({
        gameId: 'spin-compete',
        gameName: 'عجلة التنافس',
        score: sorted[0] ? sorted[0].score : 0,
        accuracy: 100,
        endTime: new Date().toISOString(),
      });
      localStorage.setItem('ge_game_results', JSON.stringify(results.slice(-50)));
    } catch (_) {}
  }

  /* =====================================================
     EVENT LISTENERS
     ===================================================== */
  function attachEvents() {
    if (startBtn)     startBtn.addEventListener('click', startGame);
    if (playAgainBtn) playAgainBtn.addEventListener('click', () => {
      gameoverScreen.style.display = 'none';
      setupScreen.style.display = '';
    });
    if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
    if (backBtn) backBtn.addEventListener('click', () => {
      clearInterval(state.timerInterval);
      state.timerRunning = false;
      gameScreen.style.display = 'none';
      setupScreen.style.display = '';
    });
    if (spinBtn) spinBtn.addEventListener('click', spinWheel);
    if (canvas)  canvas.addEventListener('click', () => {
      if (!state.isSpinning && resultPopup.style.display === 'none') spinWheel();
    });
    if (resAddBtn)  resAddBtn.addEventListener('click', addPoints);
    if (resSkipBtn) resSkipBtn.addEventListener('click', () => nextTurn());
  }

  /* =====================================================
     INIT
     ===================================================== */
  function init() {
    initSetupButtons();
    attachEvents();
    state.numTeams = 4;
    state.timeMins = 15;
    state.wheelMode = 'points';
  }

  init();

})();
