(function(){
const SETTINGS_KEY = 'heroAttackSettings';

const screens = {
  start: document.getElementById('start-screen'),
  setup: document.getElementById('setup-screen'),
  game: document.getElementById('game-screen')
};

const startBtn = document.getElementById('startBtn');
const startGameBtn = document.getElementById('startGame');
const backToStartBtn = document.getElementById('backToStart');
const backToSetupBtn = document.getElementById('backToSetup');
const restartGameBtn = document.getElementById('restartGame');
const playerCountInput = document.getElementById('playerCount');
const levelSelect = document.getElementById('levelSelect');
const targetScoreInput = document.getElementById('targetScore');
const playerNamesWrap = document.getElementById('playerNames');
const playerPanels = document.getElementById('playerPanels');
const operationsNote = document.getElementById('operationsNote');
const winnerModal = document.getElementById('winnerModal');
const winnerTitle = document.getElementById('winnerTitle');
const winnerSubtitle = document.getElementById('winnerSubtitle');
const winnersStats = document.getElementById('winnersStats');
const playAgainBtn = document.getElementById('playAgain');
const closeWinnerBtn = document.getElementById('closeWinner');

const wraithVariants = ['01', '02', '03'];
const heroVariants = ['1', '2', '3'];
const heroIdleFrames = 10;

const state = {
  players: [],
  operations: ['add', 'sub'],
  level: 'easy',
  targetScore: 10,
  isRunning: false,
  loopId: null
};

const audioContext = typeof (window.AudioContext || window.webkitAudioContext) !== 'undefined' 
  ? new (window.AudioContext || window.webkitAudioContext)() 
  : null;
let audioUnlocked = false;

function unlockAudio() {
  if (!audioContext || audioUnlocked) return;
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  audioUnlocked = true;
}

function playSound(frequency = 800, duration = 100, type = 'sine', volume = 0.3) {
  if (!audioContext) return;
  try {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.frequency.setValueAtTime(frequency * 1.2, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.8, audioContext.currentTime + duration / 1000);
    osc.type = type;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + duration / 1000);
  } catch (e) {
    // Silent fail
  }
}

function playAttackSound() {
  if (!audioContext) return;
  try {
    const now = audioContext.currentTime;
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    const gain2 = audioContext.createGain();
    
    osc1.connect(gain1);
    osc2.connect(gain2);
    gain1.connect(audioContext.destination);
    gain2.connect(audioContext.destination);
    
    osc1.type = 'triangle';
    osc2.type = 'sine';
    
    osc1.frequency.setValueAtTime(800, now);
    osc1.frequency.exponentialRampToValueAtTime(400, now + 0.15);
    
    osc2.frequency.setValueAtTime(1200, now);
    osc2.frequency.exponentialRampToValueAtTime(600, now + 0.15);
    
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    gain2.gain.setValueAtTime(0.2, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.15);
    osc2.stop(now + 0.15);
  } catch (e) {
    // Silent fail
  }
}

function playHitSound() {
  if (!audioContext) return;
  try {
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(audioContext.destination);
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
    
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    
    osc.start(now);
    osc.stop(now + 0.1);
  } catch (e) {
    // Silent fail
  }
}

function playSoundSequence(frequencies, duration = 80) {
  frequencies.forEach((freq, idx) => {
    setTimeout(() => playSound(freq, duration), idx * (duration + 20));
  });
}

const enemyTickMs = 450;
const levelSpeed = {
  easy: 6,
  medium: 8,
  hard: 10
};

function showScreen(name) {
  Object.values(screens).forEach(screen => screen.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function enemyImage(id) {
  return `/assets/craftpix/PNG/Wraith_${id}/PNG Sequences/Idle/Wraith_${id}_Idle_000.png`;
}

function enemyWalkImage(id, frame) {
  const index = String(frame).padStart(3, '0');
  return `/assets/craftpix/PNG/Wraith_${id}/PNG Sequences/Walking/Wraith_${id}_Moving Forward_${index}.png`;
}

function heroIdleImage(variant, frame) {
  const index = String(frame).padStart(3, '0');
  return `/assets/archer2/_PNG/${variant}/Elf_0${variant}__IDLE_${index}.png`;
}

function getLevelRange(level) {
  if (level === 'easy') return { min: 1, max: 10 };
  if (level === 'medium') return { min: 5, max: 20 };
  return { min: 10, max: 50 };
}

function buildQuestion() {
  const ops = state.operations.length ? state.operations : ['add'];
  const op = randomItem(ops);
  const range = getLevelRange(state.level);
  let a = Math.ceil(Math.random() * (range.max - range.min + 1)) + range.min - 1;
  let b = Math.ceil(Math.random() * (range.max - range.min + 1)) + range.min - 1;
  if (op === 'sub' && b > a) [a, b] = [b, a];
  if (op === 'mul') {
    a = Math.ceil(Math.random() * 12) + 1;
    b = Math.ceil(Math.random() * 12) + 1;
  }
  if (op === 'div') {
    b = Math.ceil(Math.random() * 12) + 1;
    const result = Math.ceil(Math.random() * 12) + 1;
    a = b * result;
  }
  const symbol = op === 'add' ? '+' : op === 'sub' ? '-' : op === 'mul' ? '×' : '÷';
  const answer = op === 'add' ? a + b : op === 'sub' ? a - b : op === 'mul' ? a * b : a / b;
  return { text: `${a} ${symbol} ${b} = ؟`, answer };
}

function createPlayers(count) {
  const inputs = playerNamesWrap.querySelectorAll('input[data-player-name]');
  const names = Array.from(inputs).map(input => input.value.trim()).filter(Boolean);
  state.players = Array.from({ length: count }, (_, index) => {
    const name = names[index] || `لاعب ${index + 1}`;
    const question = buildQuestion();
    return {
      id: `p${index + 1}`,
      name,
      score: 0,
      hearts: 3,
      input: '',
      question,
      heroVariant: heroVariants[index % heroVariants.length],
      heroFrame: 0,
      heroAnimationDelay: Math.random() * 1.2, // Random delay for hero animation variation
      enemyId: randomItem(wraithVariants),
      enemyProgress: 100,
      enemyHealth: 100,
      enemyFrame: 0,
      enemyAnimationDelay: Math.random() * 0.8, // Random delay for animation variation
      enemySpeedMultiplier: 0.8 + Math.random() * 0.4, // Speed variation between 0.8-1.2
      feedback: '',
      feedbackClass: '',
      locked: false,
      hitPulse: false,
      isAttacking: false,
      combo: 0,
      maxCombo: 0,
      questionStartTime: Date.now()
    };
  });
}

function updateOperationsNote() {
  const hasDiv = state.operations.includes('div');
  operationsNote.textContent = hasDiv ? 'بدون كسور (ناتج صحيح)' : 'بدون كسور';
}

function renderPlayerInputs() {
  const count = Math.max(1, Math.min(6, parseInt(playerCountInput.value, 10) || 1));
  playerCountInput.value = count;
  playerNamesWrap.innerHTML = `
    <div class="player-names-grid">
      ${Array.from({ length: count }).map((_, i) => `
        <div class="name-card">
          <label>اسم اللاعب ${i + 1}</label>
          <input type="text" data-player-name value="لاعب ${i + 1}" />
        </div>
      `).join('')}
    </div>
  `;
}

function heartsMarkup(hearts) {
  return Array.from({ length: 3 }).map((_, i) => `<span class="heart${i >= hearts ? ' empty' : ''}"></span>`).join('');
}

function updatePlayersDOM() {
  state.players.forEach(player => {
    const panel = document.querySelector(`.player-panel[data-player="${player.id}"]`);
    if (!panel) return;
    
    if (player.locked) {
      panel.setAttribute('data-locked', 'true');
    } else {
      panel.removeAttribute('data-locked');
    }

    if (player.hitPulse) {
      panel.classList.add('hit');
    } else {
      panel.classList.remove('hit');
    }

    const scoreDiv = panel.querySelector('.panel-score');
    if (scoreDiv) {
      scoreDiv.innerHTML = `${player.score} / ${state.targetScore}`;
    }

    // combo display
    const headerInfo = panel.querySelector('.panel-header > div');
    if (headerInfo) {
      let comboEl = headerInfo.querySelector('.combo-display');
      if (player.combo > 0) {
        if (!comboEl) {
          comboEl = document.createElement('div');
          comboEl.className = 'combo-display';
          comboEl.style.cssText = 'color: #fbbf24; font-size: 0.9rem; font-weight: 700;';
          headerInfo.appendChild(comboEl);
        }
        comboEl.innerHTML = `🔥 COMBO x${player.combo}`;
      } else if (comboEl) {
        comboEl.remove();
      }
    }

    const heartsDiv = panel.querySelector('.panel-hearts');
    if (heartsDiv) {
      heartsDiv.innerHTML = heartsMarkup(player.hearts);
    }

    const heroEl = panel.querySelector('.hero');
    if (heroEl) {
      heroEl.src = heroIdleImage(player.heroVariant, player.heroFrame % heroIdleFrames);
      if (player.isAttacking) {
        heroEl.classList.add('attack');
      } else {
        heroEl.classList.remove('attack');
      }
    }

    const enemyEl = panel.querySelector('.enemy');
    if (enemyEl) {
      enemyEl.src = enemyWalkImage(player.enemyId, Math.floor(player.enemyFrame / 3) % 12);
    }
    
    const enemyWrapper = panel.querySelector('.enemy-wrapper');
    if (enemyWrapper) {
      const enemyOffset = Math.max(-50, Math.min(120, (100 - player.enemyProgress) * 1.7 - 50));
      enemyWrapper.style.transform = `translateX(${enemyOffset}px)`;
    }

    const healthFill = panel.querySelector('.enemy-health-fill');
    if (healthFill) {
      healthFill.style.width = `${player.enemyHealth}%`;
    }

    const questionDiv = panel.querySelector('.panel-question');
    if (questionDiv) {
      questionDiv.innerHTML = player.question.text;
    }

    const displayDiv = panel.querySelector('.panel-display');
    if (displayDiv) {
      displayDiv.innerHTML = player.input || '&nbsp;';
    }

    const feedbackDiv = panel.querySelector('.panel-feedback');
    if (feedbackDiv) {
      feedbackDiv.className = `panel-feedback ${player.feedbackClass || ''}`;
      feedbackDiv.innerHTML = player.feedback;
    }
  });
}

function renderPlayers() {
  const panelBackgrounds = ['300.PNG', '301.PNG', '302.PNG', '303.PNG'];
  playerPanels.innerHTML = state.players.map((player, index) => {
    const disabled = player.locked ? 'data-locked="true"' : '';
    const enemyOffset = Math.max(-50, Math.min(120, (100 - player.enemyProgress) * 1.7 - 50));
    const enemySrc = enemyWalkImage(player.enemyId, Math.floor(player.enemyFrame / 3) % 12);
    const heroSrc = heroIdleImage(player.heroVariant, player.heroFrame % heroIdleFrames);
    const pulseClass = player.hitPulse ? 'hit' : '';
    const attackClass = player.isAttacking ? 'attack' : '';
    const backgroundImage = panelBackgrounds[index % panelBackgrounds.length];
    const enemyAnimationDelay = player.enemyAnimationDelay || 0;
    const heroAnimationDelay = player.heroAnimationDelay || 0;
    return `
      <div class="player-panel ${pulseClass}" data-player="${player.id}" ${disabled}>
        <div class="panel-header">
          <div>
            <div>${player.name}</div>
            <div class="panel-score">${player.score} / ${state.targetScore}</div>
            ${player.combo > 0 ? `<div class="combo-display" style="color: #fbbf24; font-size: 0.9rem; font-weight: 700;">🔥 COMBO x${player.combo}</div>` : ''}
          </div>
          <div class="panel-hearts">${heartsMarkup(player.hearts)}</div>
        </div>
        <div class="panel-battle" style="background-image: url('/assets/${backgroundImage}');">
          <img src="${heroSrc}" alt="hero" class="hero ${attackClass}" style="animation-delay: ${heroAnimationDelay}s;" />
          <div class="enemy-health-bar">
            <div class="enemy-health-fill" style="width: ${player.enemyHealth}%;"></div>
          </div>
          <div class="enemy-wrapper" style="transform: translateX(${enemyOffset}px);">
            <img src="${enemySrc}" alt="enemy" class="enemy" style="animation-delay: ${enemyAnimationDelay}s;" />
          </div>
          <div class="projectile"></div>
        </div>
        <div class="panel-question">${player.question.text}</div>
        <div class="panel-display">${player.input || '&nbsp;'}</div>
        <div class="keypad">
          <button class="key" data-key="1" data-player="${player.id}">1</button>
          <button class="key" data-key="2" data-player="${player.id}">2</button>
          <button class="key" data-key="3" data-player="${player.id}">3</button>
          <button class="key" data-key="4" data-player="${player.id}">4</button>
          <button class="key" data-key="5" data-player="${player.id}">5</button>
          <button class="key" data-key="6" data-player="${player.id}">6</button>
          <button class="key" data-key="7" data-player="${player.id}">7</button>
          <button class="key" data-key="8" data-player="${player.id}">8</button>
          <button class="key" data-key="9" data-player="${player.id}">9</button>
          <button class="key action" data-key="clear" data-player="${player.id}">C</button>
          <button class="key" data-key="0" data-player="${player.id}">0</button>
          <button class="key submit" data-key="ok" data-player="${player.id}">GO</button>
        </div>
        <div class="panel-feedback ${player.feedbackClass || ''}">${player.feedback}</div>
      </div>
    `;
  }).join('');
}

function evaluateAnswer(player) {
  if (player.locked) return;
  if (player.input === '') return;
  const answer = parseInt(player.input, 10);
  const currentTime = Date.now();
  const timeTaken = currentTime - player.questionStartTime;
  
  if (answer === player.question.answer) {
    player.score += 1;
    player.combo += 1;
    player.maxCombo = Math.max(player.maxCombo, player.combo);
    
    let bonusScore = 0;
    let feedbackMsg = '✨ إجابة صحيحة! ضربة قوية!';
    
    if (timeTaken < 3000 && timeTaken > 0) {
      bonusScore = 1;
      feedbackMsg = '⚡ إجابة سريعة! +1 بونص!';
    }
    
    if (player.combo >= 3) {
      bonusScore += 1;
      feedbackMsg = `🔥 كومبو x${player.combo}! +${bonusScore} بونص!`;
    }
    
    if (player.combo >= 5) {
      feedbackMsg = `🌟 كومبو ممتاز x${player.combo}! +${bonusScore} بونص!`;
    }
    
    player.score += bonusScore;
    player.feedback = feedbackMsg;
    player.feedbackClass = 'good';
    player.enemyHealth = Math.max(0, player.enemyHealth - 34);
    player.hitPulse = true;
    player.isAttacking = true;
    
    updatePlayersDOM();
    
    playAttackSound();
    if (player.combo >= 3) {
      setTimeout(() => playSoundSequence([900, 1000, 1100, 1000], 100), 200);
    } else if (bonusScore > 0) {
      setTimeout(() => playSoundSequence([850, 950], 100), 200);
    }
    
    const panelEl = document.querySelector(`[data-player="${player.id}"]`);
    const battleEl = document.querySelector(`[data-player="${player.id}"] .panel-battle`);
    const heroEl = document.querySelector(`[data-player="${player.id}"] .hero`);
    const enemyEl = document.querySelector(`[data-player="${player.id}"] .enemy`);
    const projectileEl = document.querySelector(`[data-player="${player.id}"] .projectile`);
    
    if (heroEl) {
      heroEl.classList.add('attack');
    }
    
    if (projectileEl) {
      projectileEl.style.animation = 'projectileFly 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
    }
    
    setTimeout(() => {
      if (battleEl) {
        battleEl.classList.add('hit-effect');
      }
      playHitSound();
      
      if (player.enemyHealth <= 0) {
        if (enemyEl) {
          enemyEl.style.animation = 'enemyDeath 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
        }
        playSoundSequence([500, 400, 300, 200], 100);
        setTimeout(() => {
          player.enemyId = randomItem(wraithVariants);
          player.enemyProgress = 100;
          player.enemyHealth = 100;
          if (enemyEl) enemyEl.style.animation = '';
          updatePlayersDOM();
        }, 800);
      }
    }, 400);
    
    setTimeout(() => {
      if (heroEl) heroEl.classList.remove('attack');
      if (battleEl) battleEl.classList.remove('hit-effect');
      if (projectileEl) projectileEl.style.animation = '';
      player.isAttacking = false;
      player.hitPulse = false;
      updatePlayersDOM();
    }, 1200);
  } else {
    player.hearts -= 1;
    player.combo = 0;
    player.enemyHealth = Math.min(100, player.enemyHealth + 15);
    player.feedback = '❌ إجابة خاطئة! فقدت قلب.';
    player.feedbackClass = 'bad';
    playSound(300, 200);
    if (player.hearts <= 0) {
      player.locked = true;
      player.feedback = '☠️ خارج اللعب';
      playSoundSequence([200, 150, 100], 150);
    }
  }
  player.input = '';
  player.question = buildQuestion();
  player.questionStartTime = Date.now();
  checkGameOver();
}

function checkGameOver() {
  const winner = state.players.find(p => p.score >= state.targetScore);
  const allOut = state.players.every(p => p.locked);
  if (winner) {
    showWinner(`🎉 ${winner.name} فاز!`, `حقق ${winner.score} نقطة!`);
    stopEnemyLoop();
    return;
  }
  if (allOut) {
    const topPlayer = state.players.reduce((max, p) => p.score > max.score ? p : max, state.players[0]);
    showWinner('🏆 انتهت اللعبة', `أعلى نقاط: ${topPlayer.name} - ${topPlayer.score} نقطة`);
    stopEnemyLoop();
  }
}

function showWinner(title, subtitle) {
  winnerTitle.textContent = title;
  winnerSubtitle.textContent = subtitle;
  
  playSoundSequence([800, 1000, 1200, 1000, 1200], 150);
  
  const statsHtml = state.players.map(p => {
    return `
      <div style="background: rgba(255,255,255,0.08); padding: 10px 12px; border-radius: 12px; border-left: 3px solid #f97316;">
        <div style="font-weight: 700; color: #fff;">${p.name}</div>
        <div style="font-size: 0.9rem; color: #cbd5e1; margin-top: 4px;">
          نقاط: <strong style="color: #f97316;">${p.score}</strong> | 
          قلوب: <strong style="color: #ef4444;">${Math.max(0, p.hearts)}</strong> | 
          أعلى كومبو: <strong style="color: #fbbf24;">${p.maxCombo}</strong>
        </div>
      </div>
    `;
  }).join('');
  
  winnersStats.innerHTML = statsHtml;
  winnerModal.style.display = 'flex';
}

function closeWinner() {
  winnerModal.style.display = 'none';
}

function startEnemyLoop() {
  stopEnemyLoop();
  state.loopId = setInterval(() => {
    if (!state.isRunning) return;
    const baseSpeed = levelSpeed[state.level] || levelSpeed.easy;
    state.players.forEach(player => {
      if (player.locked || player.isAttacking) return;
      const speed = baseSpeed * (player.enemySpeedMultiplier || 1);
      player.enemyProgress = Math.max(0, player.enemyProgress - speed);
      player.enemyFrame = (player.enemyFrame + 1) % 12;
      player.heroFrame = (player.heroFrame + 1) % heroIdleFrames;
      if (player.enemyProgress === 0) {
        player.hearts -= 1;
        player.combo = 0;
        player.feedback = '💀 العدو وصل! خسرت قلب.';
        player.feedbackClass = 'bad';
        player.enemyProgress = 100;
        player.enemyHealth = 100;
        player.enemyId = randomItem(wraithVariants);
        playSound(300, 200);
        if (player.hearts <= 0) {
          player.locked = true;
          player.feedback = '☠️ خارج اللعب';
          playSoundSequence([200, 150, 100], 150);
        }
      }
    });
    updatePlayersDOM();
    checkGameOver();
  }, enemyTickMs);
}

function stopEnemyLoop() {
  if (state.loopId) {
    clearInterval(state.loopId);
    state.loopId = null;
  }
}

function handleKeyPress(playerId, key) {
  const player = state.players.find(p => p.id === playerId);
  if (!player || player.locked || !state.isRunning) return;
  if (key === 'clear') {
    player.input = '';
  } else if (key === 'ok') {
    evaluateAnswer(player);
  } else if (/^\d$/.test(key)) {
    if (player.input.length < 5) {
      player.input += key;
    }
  }
  updatePlayersDOM();
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (saved.playerCount) playerCountInput.value = saved.playerCount;
    if (saved.level) levelSelect.value = saved.level;
    if (saved.targetScore) targetScoreInput.value = saved.targetScore;
    if (Array.isArray(saved.operations)) state.operations = saved.operations;
  } catch {
    return;
  }
}

function saveSettings() {
  const payload = {
    playerCount: parseInt(playerCountInput.value, 10) || 1,
    level: levelSelect.value,
    targetScore: parseInt(targetScoreInput.value, 10) || 10,
    operations: state.operations
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

function startGame() {
  unlockAudio();
  state.level = levelSelect.value;
  state.targetScore = Math.max(3, Math.min(30, parseInt(targetScoreInput.value, 10) || 10));
  const selectedOps = Array.from(document.querySelectorAll('.op-check:checked')).map(el => el.value);
  state.operations = selectedOps.length ? selectedOps : ['add'];
  updateOperationsNote();
  createPlayers(parseInt(playerCountInput.value, 10) || 1);
  state.isRunning = true;
  renderPlayers();
  saveSettings();
  playSoundSequence([600, 700, 800], 120);
  startEnemyLoop();
  showScreen('game');
}

function init() {
  loadSettings();
  renderPlayerInputs();
  updateOperationsNote();
}

startBtn.addEventListener('click', () => {
  unlockAudio();
  showScreen('setup');
});

backToStartBtn.addEventListener('click', () => {
  showScreen('start');
});

startGameBtn.addEventListener('click', startGame);

restartGameBtn.addEventListener('click', () => {
  startGame();
  closeWinner();
});

backToSetupBtn.addEventListener('click', () => {
  state.isRunning = false;
  stopEnemyLoop();
  showScreen('setup');
});

playerCountInput.addEventListener('change', renderPlayerInputs);

document.addEventListener('click', (event) => {
  const key = event.target.closest('[data-key]');
  if (!key) return;
  const playerId = key.getAttribute('data-player');
  const value = key.getAttribute('data-key');
  handleKeyPress(playerId, value);
});

playAgainBtn.addEventListener('click', () => {
  closeWinner();
  startGame();
});

closeWinnerBtn.addEventListener('click', closeWinner);

init();
})();
