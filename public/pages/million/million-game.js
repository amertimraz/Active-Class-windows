const MONEY_VALUES = [
  100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 125000, 250000, 500000, 1000000
];

let session = null;
let currentQuestionIndex = 0;
let answeredCorrectly = 0;
let usedLifelines = {
  fiftyFifty: false,
  change: false,
  hint: false
};
let disabledAnswers = new Set();
let audienceUsed = false;
let soundEnabled = true;
let audioContext = null;
let backgroundMusic = null;

const MILLION_PALETTES = ['classroom', 'sage'];
let currentPalette = MILLION_PALETTES[0];


function createBackgroundMusic() {
  if (!backgroundMusic) {
    backgroundMusic = document.getElementById('millionMusic');
    if (!backgroundMusic) {
      return;
    }
    backgroundMusic.volume = 0.35;
    backgroundMusic.loop = true;
  }

  if (!soundEnabled) {
    return;
  }

  const playPromise = backgroundMusic.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
}

function unlockBackgroundMusic() {
  if (!soundEnabled || !backgroundMusic) {
    return;
  }
  const playPromise = backgroundMusic.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
}

function stopBackgroundMusicImmediately() {
  soundEnabled = false;
  if (backgroundMusic) {
    backgroundMusic.pause();
    backgroundMusic.currentTime = 0;
  }
}

function resumeBackgroundMusic() {
  soundEnabled = true;
  createBackgroundMusic();
}

function initializeSound() {
  const soundToggle = document.getElementById('soundToggle');
  
  soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    
    if (soundEnabled) {
      soundToggle.classList.remove('muted');
      resumeBackgroundMusic();
    } else {
      soundToggle.classList.add('muted');
      stopBackgroundMusicImmediately();
    }
  });

  document.addEventListener('pointerdown', unlockBackgroundMusic, { once: true });
  document.addEventListener('keydown', unlockBackgroundMusic, { once: true });
  
  createBackgroundMusic();
}

function setMillionPalette(palette) {
  currentPalette = palette;
  document.documentElement.setAttribute('data-million-palette', palette);
  localStorage.setItem('cm_million_palette', palette);
}

function initializePaletteToggle() {
  const paletteToggle = document.getElementById('paletteToggle');
  const savedPalette = localStorage.getItem('cm_million_palette');
  const initialPalette = MILLION_PALETTES.includes(savedPalette) ? savedPalette : MILLION_PALETTES[0];
  setMillionPalette(initialPalette);

  if (!paletteToggle) {
    return;
  }

  paletteToggle.addEventListener('click', () => {
    const currentIndex = MILLION_PALETTES.indexOf(currentPalette);
    const nextPalette = MILLION_PALETTES[(currentIndex + 1) % MILLION_PALETTES.length];
    setMillionPalette(nextPalette);
  });
}


function playSound(type) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  if (type === 'correct') {
    const frequencies = [523.25, 659.25, 783.99];
    playTones(audioContext, frequencies, [0.2, 0.2, 0.3]);
  } else if (type === 'wrong') {
    const frequencies = [349.23, 293.66];
    playTones(audioContext, frequencies, [0.3, 0.3]);
  } else if (type === 'next') {
    const frequencies = [440, 495, 523.25];
    playTones(audioContext, frequencies, [0.15, 0.15, 0.2]);
  }
}

function playTones(audioContext, frequencies, durations) {
  let startTime = audioContext.currentTime;
  
  frequencies.forEach((freq, index) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = freq;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + durations[index]);
    
    oscillator.start(startTime);
    oscillator.stop(startTime + durations[index]);
    
    startTime += durations[index];
  });
}

async function initGame() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('sessionId');

  initializePaletteToggle();

  if (!sessionId) {
    showErrorScreen('لم يتم العثور على معرف الجلسة');
    return;
  }

  try {
    const response = await window.api.getMillionSession(sessionId);
    if (response.ok && response.session) {
      session = response.session;
      startGame();
    } else {
      showErrorScreen(response.error || 'فشل تحميل اللعبة');
    }
  } catch (error) {
    console.error('Error loading session:', error);
    showErrorScreen(`خطأ: ${error.message}`);
  }
}

function startGame() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'block';
  
  initializeSound();
  initializeMoneyLadder();
  showQuestion();
}

function initializeMoneyLadder() {
  const ladderItems = document.getElementById('ladderItems');
  ladderItems.innerHTML = '';

  MONEY_VALUES.forEach((value, index) => {
    const item = document.createElement('div');
    item.className = 'ladder-item';
    item.id = `ladder-${index}`;
    const level = index + 1;
    item.innerHTML = `<span class="level-num">${level}</span><span class="currency-symbol">$</span><span class="level-value">${formatMoney(value)}</span>`;
    
    if (index === MONEY_VALUES.length - 1) {
      item.classList.add('jackpot');
    }
    
    ladderItems.appendChild(item);
  });

  updateLadderUI();
}

function updateLadderUI() {
  MONEY_VALUES.forEach((value, index) => {
    const item = document.getElementById(`ladder-${index}`);
    if (index < currentQuestionIndex) {
      item.classList.add('passed');
    } else if (index === currentQuestionIndex) {
      item.classList.add('current');
    } else {
      item.classList.remove('passed', 'current');
    }
  });
}

function showQuestion() {
  if (currentQuestionIndex >= session.questions.length) {
    endGame(true);
    return;
  }

  const question = session.questions[currentQuestionIndex];
  disabledAnswers.clear();
  audienceUsed = false;

  document.getElementById('questionNumber').textContent = `السؤال ${currentQuestionIndex + 1} من ${session.questions.length}`;
  document.getElementById('questionDifficulty').textContent = getDifficultyLabel(question.difficulty);
  document.getElementById('questionText').textContent = question.question;

  const answersGrid = document.getElementById('answersGrid');
  answersGrid.innerHTML = '';

  question.choices.forEach((choice, index) => {
    const choiceText = (choice === null || choice === undefined) ? '' : String(choice);
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.innerHTML = `<span class="answer-number">${index + 1}</span><span class="answer-text">${choiceText}</span>`;
    btn.dataset.index = index;
    btn.addEventListener('click', () => selectAnswer(index));
    answersGrid.appendChild(btn);
  });

  updateLifelineButtons();
}

function selectAnswer(answerIndex) {
  const question = session.questions[currentQuestionIndex];
  const isCorrect = answerIndex === question.correct;

  const answerBtns = document.querySelectorAll('.answer-btn');
  answerBtns.forEach(btn => btn.disabled = true);
  
  // Highlight selected answer
  answerBtns[answerIndex].classList.add('selected');
  playSound('next'); // play a sound to indicate selection
  
  // Delay to add suspense
  setTimeout(() => {
    answerBtns[answerIndex].classList.remove('selected');
    
    if (isCorrect) {
      playSound('correct');
      answerBtns[answerIndex].classList.add('correct');
      answeredCorrectly++;
      const earnedMoney = MONEY_VALUES[currentQuestionIndex];
      
      setTimeout(() => {
        showAnswerModal(true, question, earnedMoney);
      }, 1500);
    } else {
      playSound('wrong');
      answerBtns[answerIndex].classList.add('wrong');
      answerBtns[question.correct].classList.add('correct');
      setTimeout(() => {
        endGame(false);
      }, 3000);
    }
  }, 2000); // 2 second suspense delay
}

function showAnswerModal(isCorrect, question, earnedMoney) {
  const modal = document.getElementById('answerModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalCorrectAnswer = document.getElementById('modalCorrectAnswer');
  const modalEarned = document.getElementById('modalEarned');
  const earnedSection = document.getElementById('earnedSection');
  
  stopBackgroundMusicImmediately();
  
  if (isCorrect) {
    modalTitle.textContent = '✅ إجابة صحيحة!';
    modalTitle.style.color = '#00AA00';
  } else {
    modalTitle.textContent = '❌ إجابة خاطئة';
    modalTitle.style.color = '#FF3333';
  }
  
  modalCorrectAnswer.textContent = `${question.correct + 1}: ${question.choices[question.correct]}`;
  
  if (isCorrect && earnedMoney) {
    modalEarned.textContent = formatMoney(earnedMoney);
    earnedSection.style.display = 'block';
  } else {
    earnedSection.style.display = 'none';
  }
  
  modal.style.display = 'flex';
}

function closeAnswerModal() {
  const modal = document.getElementById('answerModal');
  modal.style.display = 'none';
  
  currentQuestionIndex++;
  updateLadderUI();
  playSound('next');
  
  setTimeout(() => {
    resumeBackgroundMusic();
    showQuestion();
  }, 500);
}

function updateLifelineButtons() {
  const question = session.questions[currentQuestionIndex];
  
  const fiftyBtn = document.getElementById('fiftyFiftyBtn');
  const changeBtn = document.getElementById('changeQuestionBtn');
  const audienceBtn = document.getElementById('audienceBtn');
  
  fiftyBtn.disabled = usedLifelines.fiftyFifty || !session.lifelines.fiftyFifty;
  changeBtn.disabled = usedLifelines.change || !session.lifelines.change || currentQuestionIndex === session.questions.length - 1;
  audienceBtn.disabled = audienceUsed || !session.lifelines.hint;

  fiftyBtn.onclick = usedLifelines.fiftyFifty ? null : useFiftyFifty;
  changeBtn.onclick = usedLifelines.change ? null : useChangeQuestion;
  audienceBtn.onclick = audienceUsed ? null : useAudience;
}

function useFiftyFifty() {
  const question = session.questions[currentQuestionIndex];
  const correctIndex = question.correct;
  const wrongAnswers = [0, 1, 2, 3].filter(i => i !== correctIndex);
  
  const toDisable = wrongAnswers.sort(() => Math.random() - 0.5).slice(0, 2);
  toDisable.forEach(index => {
    disabledAnswers.add(index);
    const btn = document.querySelector(`.answer-btn[data-index="${index}"]`);
    btn.style.opacity = '0.3';
    btn.disabled = true;
  });

  usedLifelines.fiftyFifty = true;
  document.getElementById('fiftyFiftyBtn').classList.add('used');
  document.getElementById('fiftyFiftyBtn').disabled = true;
}

function useChangeQuestion() {
  usedLifelines.change = true;
  document.getElementById('changeQuestionBtn').classList.add('used');
  document.getElementById('changeQuestionBtn').disabled = true;
  
  currentQuestionIndex++;
  updateLadderUI();
  showQuestion();
}

function useAudience() {
  if (audienceUsed) return;
  
  const question = session.questions[currentQuestionIndex];
  const correctIndex = question.correct;
  
  const correctRange = [40, 65];
  const correctPercent = Math.floor(Math.random() * (correctRange[1] - correctRange[0] + 1)) + correctRange[0];
  
  const remaining = 100 - correctPercent;
  const wrongAnswers = [0, 1, 2, 3].filter(i => i !== correctIndex);
  
  const percentages = [0, 0, 0, 0];
  percentages[correctIndex] = correctPercent;
  
  let remainingToDistribute = remaining;
  for (let i = 0; i < wrongAnswers.length - 1; i++) {
    const maxForThis = Math.min(
      Math.floor(remainingToDistribute / (wrongAnswers.length - i)),
      correctPercent - 1
    );
    const amountForThis = Math.floor(Math.random() * (Math.max(1, maxForThis) + 1));
    percentages[wrongAnswers[i]] = amountForThis;
    remainingToDistribute -= amountForThis;
  }
  
  let lastWrongPercent = remainingToDistribute;
  if (lastWrongPercent >= correctPercent) {
    lastWrongPercent = correctPercent - 1;
    remainingToDistribute = lastWrongPercent;
  }
  percentages[wrongAnswers[wrongAnswers.length - 1]] = lastWrongPercent;
  
  showAudienceChart(percentages);
  
  audienceUsed = true;
  document.getElementById('audienceBtn').classList.add('used');
  document.getElementById('audienceBtn').disabled = true;
  playAudienceSound();
}

function playAudienceSound() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  const now = audioContext.currentTime;
  
  const frequencies = [440, 495, 550, 587, 659, 784, 880];
  let startTime = now;
  
  frequencies.forEach((freq, index) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(audioContext.destination);
    
    osc.frequency.value = freq;
    osc.type = 'sine';
    
    gain.gain.setValueAtTime(0.15, startTime);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);
    
    osc.start(startTime);
    osc.stop(startTime + 0.1);
    
    startTime += 0.08;
  });
}

function showAudienceChart(percentages) {
  const modal = document.getElementById('audienceModal');
  const bars = Array.from({ length: 4 }, (_, index) => `bar${index + 1}`);
  const percents = Array.from({ length: 4 }, (_, index) => `percent${index + 1}`);
  
  modal.style.display = 'flex';
  
  let delay = 500;
  bars.forEach((barId, index) => {
    setTimeout(() => {
      document.getElementById(barId).style.width = percentages[index] + '%';
      document.getElementById(percents[index]).textContent = percentages[index] + '%';
      playSound('next');
    }, delay);
    delay += 600;
  });
}

function closeAudienceModal() {
  document.getElementById('audienceModal').style.display = 'none';
}

function endGame(won) {
  stopBackgroundMusicImmediately();
  
  document.getElementById('gameScreen').style.display = 'none';

  if (won) {
    const winScreen = document.getElementById('winScreen');
    winScreen.style.display = 'block';
    document.getElementById('winMessage').textContent = `أحسنت! لقد أجبت على جميع الأسئلة الـ 15 بشكل صحيح وفزت بـ ${formatMoney(MONEY_VALUES[14])}`;
    document.getElementById('correctCount').textContent = answeredCorrectly;
    document.getElementById('finalAmount').textContent = formatMoney(MONEY_VALUES[14]);
  } else {
    const loseScreen = document.getElementById('loseScreen');
    loseScreen.style.display = 'block';
    const lastAmount = currentQuestionIndex > 0 ? MONEY_VALUES[currentQuestionIndex - 1] : 0;
    document.getElementById('loseMessage').textContent = `لقد أجبت على ${answeredCorrectly} سؤال بشكل صحيح وحصلت على ${formatMoney(lastAmount)}`;
    document.getElementById('loseCorrectCount').textContent = answeredCorrectly;
    document.getElementById('lastAmount').textContent = formatMoney(lastAmount);
  }
}

function formatMoney(value) {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0
  }).format(value);
  return formatted;
}

function getDifficultyLabel(difficulty) {
  const labels = {
    'easy': '🟢 سهل',
    'medium': '🟡 متوسط',
    'hard': '🔴 صعب'
  };
  return labels[difficulty] || '🟡 متوسط';
}

function showErrorScreen(message) {
  document.getElementById('loadingScreen').style.display = 'none';
  const gameScreen = document.getElementById('gameScreen');
  gameScreen.style.display = 'block';
  gameScreen.innerHTML = `
    <div style="text-align: center; padding: 40px; color: var(--error);">
      <h2>❌ خطأ</h2>
      <p>${message}</p>
      <a href="#/games" class="btn">العودة للألعاب</a>
    </div>
  `;
}

initGame();
