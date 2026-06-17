(function() {
  // Game Configuration
  const modes = {
    nvp: {
      title: 'اسم، فعل، حرف',
      categories: [
        { id: 'noun', text: 'اسم', icon: '📦', color: '#3b82f6' },
        { id: 'verb', text: 'فعل', icon: '🏃', color: '#f59e0b' },
        { id: 'particle', text: 'حرف', icon: '🔗', color: '#10b981' }
      ],
      data: {
        noun: ['تفاحة', 'مدرسة', 'كتاب', 'حديقة', 'طالب', 'شجرة', 'مدينة', 'قلم', 'بيت', 'سماء', 'بحر', 'صديق', 'أسد', 'زهرة', 'شمس', 'قمر', 'باب', 'نافذة', 'سيارة', 'طائرة'],
        verb: ['يقرأ', 'كتب', 'يرسم', 'لعب', 'يجري', 'نام', 'يشرب', 'يأكل', 'صعد', 'نزل', 'يفكر', 'شرح', 'فتح', 'أغلق', 'سافر', 'ضحك', 'بكى', 'سبح', 'قفز', 'طبخ'],
        particle: ['في', 'من', 'إلى', 'على', 'عن', 'بـ', 'لـ', 'كـ', 'ثم', 'و', 'أو', 'بل', 'لا', 'لم', 'لن', 'إن', 'أن', 'لكن', 'ليت', 'لعل']
      }
    },
    tenses: {
      title: 'الأزمنة',
      categories: [
        { id: 'past', text: 'ماضٍ', icon: '🕰️', color: '#ef4444' },
        { id: 'present', text: 'مضارع', icon: '🕒', color: '#3b82f6' },
        { id: 'imperative', text: 'أمر', icon: '📣', color: '#f59e0b' }
      ],
      data: {
        past: ['كتب', 'قرأ', 'ذهب', 'لعب', 'أكل', 'نام', 'سافر', 'نجح', 'فهم', 'رسم', 'جلس', 'خرج', 'دخل', 'سمع', 'بصر', 'نصر', 'فتح', 'شرب', 'قام', 'باع'],
        present: ['يكتب', 'يقرأ', 'يذهب', 'يلعب', 'يأكل', 'ينام', 'يسافر', 'ينجح', 'يفهم', 'يرسم', 'يجلس', 'يخرج', 'يدخل', 'يسمع', 'يبصر', 'ينصر', 'يفتح', 'يشرب', 'يقوم', 'يبيع'],
        imperative: ['اكتب', 'اقرأ', 'اذهب', 'العب', 'كل', 'نم', 'سافر', 'انجح', 'افهم', 'ارسم', 'اجلس', 'اخرج', 'ادخل', 'اسمع', 'ابصر', 'انصر', 'افتح', 'اشرب', 'قم', 'بع']
      }
    },
    gender: {
      title: 'المذكر والمؤنث',
      categories: [
        { id: 'masculine', text: 'مذكر', icon: '👨', color: '#3b82f6' },
        { id: 'feminine', text: 'مؤنث', icon: '👩', color: '#ec4899' }
      ],
      data: {
        masculine: ['طالب', 'معلم', 'طبيب', 'أسد', 'جمل', 'رجل', 'طفل', 'مهندس', 'فلاح', 'سائق', 'قط', 'كتاب', 'قلم', 'باب', 'كرسي', 'حاسوب', 'قمر', 'بحر', 'نجم', 'بيت'],
        feminine: ['طالبة', 'معلمة', 'طبيبة', 'لبؤة', 'ناقة', 'امرأة', 'طفلة', 'مهندسة', 'فلاحة', 'سائقة', 'قطة', 'قصة', 'مسطرة', 'نافذة', 'طاولة', 'لوحة', 'شمس', 'مدرسة', 'حديقة', 'سيارة']
      }
    },
    number: {
      title: 'المفرد والمثنى والجمع',
      categories: [
        { id: 'singular', text: 'مفرد', icon: '1️⃣', color: '#10b981' },
        { id: 'dual', text: 'مثنى', icon: '2️⃣', color: '#3b82f6' },
        { id: 'plural', text: 'جمع', icon: '🔢', color: '#a855f7' }
      ],
      data: {
        singular: ['مسلم', 'كتاب', 'شجرة', 'معلم', 'طالب', 'سيارة', 'بيت', 'قلم', 'مدينة', 'طبيبة'],
        dual: ['مسلمان', 'كتابان', 'شجرتان', 'معلمان', 'طالبان', 'سيارتان', 'بيتان', 'قلمان', 'مدينتان', 'طبيبتان'],
        plural: ['مسلمون', 'كتب', 'أشجار', 'معلمون', 'طلاب', 'سيارات', 'بيوت', 'أقلام', 'مدن', 'طبيبات']
      }
    }
  };

  const themes = {
    space: {
      id: 'space',
      name: 'الفضاء',
      bg: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)',
      itemClass: 'word-space',
      powerupIcon: '⭐'
    },
    forest: {
      id: 'forest',
      name: 'الغابة',
      bg: 'linear-gradient(180deg, #166534 0%, #064e3b 100%)',
      itemClass: 'word-forest',
      powerupIcon: '🍃'
    },
    ocean: {
      id: 'ocean',
      name: 'المحيط',
      bg: 'linear-gradient(180deg, #075985 0%, #0c4a6e 100%)',
      itemClass: 'word-ocean',
      powerupIcon: '💎'
    }
  };

  // Game State
  let score = 0;
  let lives = 3;
  let gameActive = false;
  let fallingWords = [];
  let currentSpeed = 1.5;
  let spawnRate = 2000;
  let spawnTimer = null;
  let gameLoopReq = null;
  let currentMode = 'nvp';
  let currentTheme = 'space';
  let freezeTime = 0;
  let hasShield = false;
  let isPaused = false;

  // DOM Elements
  const startScreen = document.getElementById('start-screen');
  const gameScreen = document.getElementById('game-screen');
  const gameOverScreen = document.getElementById('game-over-screen');
  const fallingArea = document.getElementById('falling-area');
  const scoreDisplay = document.getElementById('score');
  const livesContainer = document.getElementById('lives');
  const finalScoreVal = document.getElementById('final-score-val');
  
  const startBtn = document.getElementById('start-btn');
  const bucketContainer = document.querySelector('.classification-bar');
  const modeSelector = document.getElementById('mode-selector');
  const themeSelector = document.getElementById('theme-selector');
  const pauseBtn = document.getElementById('pause-btn');

  // Initialization
  setupSelectors();
  startBtn.addEventListener('click', startGame);
  
  if (pauseBtn) {
    pauseBtn.addEventListener('click', togglePause);
  }

  function togglePause() {
    if (!gameActive) return;
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? '▶️' : '⏸️';
    
    if (isPaused) {
      clearInterval(spawnTimer);
      cancelAnimationFrame(gameLoopReq);
    } else {
      startSpawning();
      gameLoop();
    }
  }

  function setupSelectors() {
    modeSelector.querySelectorAll('.selector-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modeSelector.querySelector('.active').classList.remove('active');
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
      });
    });

    themeSelector.querySelectorAll('.selector-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        themeSelector.querySelector('.active').classList.remove('active');
        btn.classList.add('active');
        currentTheme = btn.dataset.theme;
      });
    });
  }

  function setupBuckets() {
    bucketContainer.innerHTML = '';
    const categories = modes[currentMode].categories;
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'bucket-btn';
      btn.dataset.type = cat.id;
      btn.style.borderColor = cat.color;
      btn.innerHTML = `
        <span class="icon">${cat.icon}</span>
        <span class="text">${cat.text}</span>
      `;
      btn.addEventListener('click', () => {
        if (!gameActive) return;
        classifyWord(cat.id);
      });
      bucketContainer.appendChild(btn);
    });
  }

  // Keyboard support updated for dynamic buckets
  document.addEventListener('keydown', (e) => {
    if (!gameActive || fallingWords.length === 0) return;
    const categories = modes[currentMode].categories;
    if (e.key === '1' || e.key === 'ArrowRight') classifyWord(categories[0].id);
    if (e.key === '2' || e.key === 'ArrowDown') classifyWord(categories[1].id);
    if (categories[2] && (e.key === '3' || e.key === 'ArrowLeft')) classifyWord(categories[2].id);
  });

  function startGame() {
    score = 0;
    lives = 3;
    gameActive = true;
    fallingWords = [];
    currentSpeed = 1.5;
    spawnRate = 2000;
    freezeTime = 0;
    hasShield = false;
    
    setupBuckets();
    applyTheme();
    
    updateScore();
    updateLives();
    
    startScreen.classList.remove('active');
    gameOverScreen.classList.remove('active');
    gameScreen.classList.add('active');
    gameScreen.classList.remove('freeze-active');
    
    startSpawning();
    gameLoop();
  }

  function applyTheme() {
    document.body.className = `theme-${currentTheme}`;
    const themeData = themes[currentTheme];
    // gameScreen.style.backgroundImage = themeData.bg; // Handled by CSS classes mostly
  }

  function startSpawning() {
    if (spawnTimer) clearInterval(spawnTimer);
    spawnTimer = setInterval(() => {
      if (gameActive) {
        // 10% chance for powerup if score > 50
        if (score > 50 && Math.random() < 0.1) {
          spawnPowerup();
        } else {
          spawnWord();
        }
      }
    }, spawnRate);
  }

  function spawnWord() {
    const modeData = modes[currentMode];
    const types = modeData.categories.map(c => c.id);
    const randomType = types[Math.floor(Math.random() * types.length)];
    const words = modeData.data[randomType];
    const randomText = words[Math.floor(Math.random() * words.length)];
    
    const wordEl = document.createElement('div');
    wordEl.className = `word-item ${themes[currentTheme].itemClass}`;
    wordEl.textContent = randomText;
    
    // نضع الكلمة أولاً في الصفحة لنتمكن من حساب عرضها الحقيقي
    fallingArea.appendChild(wordEl);
    const wordWidth = wordEl.getBoundingClientRect().width || 120;
    
    // حساب الموقع الأفقي مع ضمان عدم الخروج عن الحواف وهامش أمان 20 بكسل
    const xPos = Math.random() * (fallingArea.clientWidth - wordWidth - 40) + 20;
    wordEl.style.left = `${xPos}px`;
    wordEl.style.top = '20px'; // إزاحة للأسفل لتجنب الحواف المنحنية (Border Radius)
    
    fallingWords.push({
      el: wordEl,
      type: randomType,
      y: 20,
      isPowerup: false
    });

    updateSelection();
  }

  function spawnPowerup() {
    const types = ['freeze', 'shield', 'bomb'];
    const randomType = types[Math.floor(Math.random() * types.length)];
    const icons = { freeze: '❄️', shield: '🛡️', bomb: '💣' };
    
    const pEl = document.createElement('div');
    pEl.className = `powerup ${randomType}`;
    pEl.innerHTML = icons[randomType];
    
    // نضع الجائزة أولاً لحساب عرضها
    fallingArea.appendChild(pEl);
    const pWidth = pEl.getBoundingClientRect().width || 60;
    
    // حساب الموقع الأفقي مع هوامش أمان (30 بكسل من كل جانب)
    const xPos = Math.random() * (fallingArea.clientWidth - pWidth - 60) + 30;
    pEl.style.left = `${xPos}px`;
    pEl.style.top = '20px'; // إزاحة للأسفل لتجنب الحواف المنحنية
    
    fallingWords.push({
      el: pEl,
      type: randomType,
      y: 20,
      isPowerup: true
    });

    pEl.addEventListener('click', () => {
      activatePowerup(randomType);
      removeWord(fallingWords.findIndex(w => w.el === pEl));
    });
  }

  function activatePowerup(type) {
    if (type === 'freeze') {
      freezeTime = 5000; // 5 seconds
      gameScreen.classList.add('freeze-active');
      setTimeout(() => {
        freezeTime = 0;
        gameScreen.classList.remove('freeze-active');
      }, 5000);
    } else if (type === 'shield') {
      hasShield = true;
      gameScreen.classList.add('shield-active');
    } else if (type === 'bomb') {
      // Clear all words and get points
      const count = fallingWords.filter(w => !w.isPowerup).length;
      score += count * 5;
      updateScore();
      
      // Visual explosion effect could be added here
      [...fallingWords].forEach((w, i) => {
        if (!w.isPowerup) removeWord(fallingWords.indexOf(w));
      });
    }
  }

  function gameLoop() {
    if (!gameActive) return;

    const speedMultiplier = freezeTime > 0 ? 0.3 : 1;

    for (let i = fallingWords.length - 1; i >= 0; i--) {
      const word = fallingWords[i];
      word.y += currentSpeed * speedMultiplier;
      word.el.style.top = `${word.y}px`;

      // الكلمة تختفي بمجرد أن تلمس "قاع" منطقة التساقط المحددة
      const wordHeight = word.el.offsetHeight || 40;
      if (word.y + wordHeight > fallingArea.clientHeight - 10) {
        if (!word.isPowerup) handleMiss();
        removeWord(i);
      }
    }

    gameLoopReq = requestAnimationFrame(gameLoop);
  }

  function classifyWord(type) {
    // Find the first non-powerup word
    const targetIndex = fallingWords.findIndex(w => !w.isPowerup);
    if (targetIndex === -1) return;
    
    const targetWord = fallingWords[targetIndex];

    if (targetWord.type === type) {
      handleCorrect(targetWord.el);
    } else {
      handleWrong(targetWord.el);
    }
    
    removeWord(targetIndex);
    
    if (score > 0 && score % 100 === 0) {
      currentSpeed += 0.2;
      if (spawnRate > 600) {
        spawnRate -= 100;
        startSpawning();
      }
    }
  }

  function handleCorrect(el) {
    score += 10;
    updateScore();
    
    // إظهار النقاط الطائرة الذهبية (+10)
    const points = document.createElement('div');
    points.className = 'floating-points';
    points.textContent = '+10';
    
    // توسيط النقاط فوق العنصر
    const elRect = el.getBoundingClientRect();
    const areaRect = fallingArea.getBoundingClientRect();
    
    points.style.left = `${parseFloat(el.style.left) + 20}px`;
    points.style.top = el.style.top;
    
    fallingArea.appendChild(points);
    
    // إزالة العنصر بعد انتهاء الأنميشن
    setTimeout(() => points.remove(), 1000);
  }

  function handleWrong(el) {
    if (hasShield) {
      hasShield = false;
      gameScreen.classList.remove('shield-active');
      return;
    }
    lives--;
    updateLives();
    gameScreen.classList.add('shake');
    setTimeout(() => gameScreen.classList.remove('shake'), 400);
    
    if (lives <= 0) endGame();
  }

  function handleMiss() {
    if (hasShield) {
      hasShield = false;
      gameScreen.classList.remove('shield-active');
      return;
    }
    lives--;
    updateLives();
    if (lives <= 0) endGame();
  }

  function removeWord(index) {
    const word = fallingWords[index];
    if (word && word.el) {
      word.el.remove();
    }
    fallingWords.splice(index, 1);
    updateSelection();
  }

  function updateSelection() {
    // Highlight the first non-powerup word
    let firstWordFound = false;
    fallingWords.forEach((w) => {
      if (!w.isPowerup && !firstWordFound) {
        w.el.classList.add('selected');
        firstWordFound = true;
      } else {
        w.el.classList.remove('selected');
      }
    });
  }

  function updateScore() {
    scoreDisplay.textContent = score;
  }

  function updateLives() {
    livesContainer.innerHTML = '';
    for (let i = 0; i < lives; i++) {
      const s = document.createElement('span');
      s.className = 'heart';
      s.textContent = '❤️';
      livesContainer.appendChild(s);
    }
  }

  function endGame() {
    gameActive = false;
    cancelAnimationFrame(gameLoopReq);
    clearInterval(spawnTimer);
    
    finalScoreVal.textContent = score;
    gameScreen.classList.remove('active');
    gameOverScreen.classList.add('active');
    
    // Clear remaining words
    fallingWords.forEach(w => w.el.remove());
    fallingWords = [];
  }

  const exitBtn = document.getElementById('game-exit-btn');
  const playAgainBtn = document.getElementById('play-again-btn');

  if (exitBtn) exitBtn.onclick = () => location.reload();
  if (playAgainBtn) playAgainBtn.onclick = () => location.reload();

})();
