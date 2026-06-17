(function() {
  const startBtn = document.getElementById('start-btn');
  const startScreen = document.getElementById('start-screen');
  const topicsScreen = document.getElementById('topics-screen');
  const gamePlayScreen = document.getElementById('game-play-screen');
  const restartBtn = document.getElementById('game-restart-btn');
  const playAgainBtn = document.getElementById('play-again-btn');
  const victoryOverlay = document.getElementById('victory-overlay');

  // Game State
  let ropePosition = 50; 
  let currentTopic = '';
  let topicQueues = {}; 
  
  const topicsData = {
    'الأرقام 1-20': { icon: '🔢', type: 'range', min: 1, max: 20 },
    'الأرقام 1-100': { icon: '💯', type: 'range', min: 1, max: 100 },
    'الفواكه': { icon: '🍎', data: [
      { q: '🍎', a: 'تفاح' }, { q: '🍌', a: 'موز' }, { q: '🍊', a: 'برتقال' },
      { q: '🥭', a: 'مانجو' }, { q: '🍇', a: 'عنب' }, { q: '🍓', a: 'فراولة' },
      { q: ' Pineapple', a: 'أناناس' }, { q: ' Watermelon', a: 'بطيخ' }, { q: ' Cherry', a: 'كرز' },
      { q: '🥝', a: 'كيوي' }, { q: ' Peach', a: 'خوخ' }, { q: ' Pear', a: 'كمثرى' },
      { q: ' Lemon', a: 'ليمون' }, { q: ' Melon', a: 'شمام' }, { q: ' Coconut', a: 'جوز هند' },
      { q: ' Avocado', a: 'أفوكادو' }, { q: ' Tomato', a: 'طماطم' }, { q: ' Blueberry', a: 'توت' },
      { q: ' Corn', a: 'ذرة' }, { q: ' Peanut', a: 'فول سوداني' }, { q: ' Olive', a: 'زيتون' },
      { q: ' Broccoli', a: 'بروكلي' }, { q: ' Carrot', a: 'جزر' }
    ]},
    'الألوان': { icon: '🎨', data: [
      { q: '🔴', a: 'أحمر' }, { q: '🔵', a: 'أزرق' }, { q: '🟢', a: 'أخضر' },
      { q: '🟡', a: 'أصفر' }, { q: '🟠', a: 'برتقالي' }, { q: '🟣', a: 'بنفسجي' },
      { q: '💗', a: 'وردي' }, { q: '⚫', a: 'أسود' }, { q: '⚪', a: 'أبيض' },
      { q: '🟤', a: 'بني' }, { q: ' Silver', a: 'فضي' }, { q: ' Gold', a: 'ذهبي' },
      { q: ' Rainbow', a: 'قوس قزح' }
    ]},
    'الحيوانات': { icon: '🦁', data: [
      { q: '🦁', a: 'أسد' }, { q: '🐯', a: 'نمر' }, { q: '🐘', a: 'فيل' },
      { q: '🦒', a: 'زرافة' }, { q: '🦓', a: 'حمار وحشي' }, { q: '🐒', a: 'قرد' },
      { q: '🐱', a: 'قطة' }, { q: '🐶', a: 'كلب' }, { q: '🐰', a: 'أرنب' },
      { q: '🐦', a: 'عصفور' }, { q: ' Snake', a: 'ثعبان' }, { q: ' Turtle', a: 'سلحفاة' },
      { q: ' Crocodile', a: 'تمساح' }, { q: ' Frog', a: 'ضفدع' }, { q: ' Dolphin', a: 'دلفين' },
      { q: ' Whale', a: 'حوت' }, { q: ' Shark', a: 'قرش' }, { q: ' Octopus', a: 'أخطبوط' },
      { q: ' Butterfly', a: 'فراشة' }, { q: ' Bee', a: 'نحلة' }, { q: ' Ant', a: 'نملة' },
      { q: ' Spider', a: 'عنكبوت' }, { q: ' Penguin', a: 'بطريق' }, { q: ' Kangaroo', a: 'كنغر' },
      { q: ' Panda', a: 'باندا' }
    ]},
    'أعضاء الجسم': { icon: '👂', data: [
      { q: '🧒', a: 'رأس' }, { q: '👁️', a: 'عين' }, { q: '👂', a: 'أذن' },
      { q: '👃', a: 'أنف' }, { q: '👄', a: 'فم' }, { q: '✋', a: 'يد' },
      { q: '👣', a: 'قدم' }, { q: '🦵', a: 'رجل' }, { q: '💪', a: 'ذراع' },
      { q: '🦴', a: 'كتف' }, { q: ' Tooth', a: 'سن' }, { q: ' Tongue', a: 'لسان' },
      { q: ' Finger', a: 'إصبع' }, { q: ' Beard', a: 'لحية' }, { q: ' Hair', a: 'شعر' },
      { q: ' Brain', a: 'عقل' }, { q: ' Heart', a: 'قلب' }, { q: ' Bone', a: 'عظم' }
    ]},
    'وسائل النقل': { icon: '🚗', data: [
      { q: '🚗', a: 'سيارة' }, { q: '🚌', a: 'حافلة' }, { q: '🚆', a: 'قطار' },
      { q: '✈️', a: 'طائرة' }, { q: '🚲', a: 'دراجة' }, { q: '🚢', a: 'سفينة' },
      { q: '🚚', a: 'شاحنة' }, { q: '🚁', a: 'مروحية' }, { q: '🏍️', a: 'دراجة نارية' },
      { q: '⛵', a: 'قارب' }, { q: ' Ambulance', a: 'إسعاف' }, { q: ' Police Car', a: 'سيارة شرطة' },
      { q: ' Fire Truck', a: 'إطفاء' }, { q: ' Tractor', a: 'جرار' }, { q: ' Rocket', a: 'صاروخ' },
      { q: ' Canoe', a: 'قارب صغير' }, { q: ' Scooter', a: 'سكوتر' }, { q: ' UFO', a: 'طبق طائر' },
      { q: ' Steam Engine', a: 'قطار قديم' }, { q: ' Metro', a: 'مترو' }
    ]},
    'الرياضة': { icon: '⚽', data: [
      { q: '⚽', a: 'كرة قدم' }, { q: '🏀', a: 'كرة سلة' }, { q: '🎾', a: 'تنس' },
      { q: '🏊', a: 'سباحة' }, { q: '🏃', a: 'جري' }, { q: '🚴', a: 'ركوب دراجات' },
      { q: '🥊', a: 'ملاكمة' }, { q: '⛳', a: 'غولف' }, { q: '⚾', a: 'بيسبول' },
      { q: '🥋', a: 'كاراتيه' }, { q: ' Volleyball', a: 'كرة طائرة' }, { q: ' Archery', a: 'رماية' },
      { q: ' Ping Pong', a: 'تنس طاولة' }, { q: ' Skating', a: 'تزلج' }, { q: ' Surfing', a: 'ركوب أمواج' },
      { q: ' Weightlifting', a: 'رفع أثقال' }, { q: ' Chess', a: 'شطرنج' }
    ]},
    'العائلة': { icon: '👨‍👩‍👦', data: [
      { q: '👨', a: 'أب' }, { q: '👩', a: 'أم' }, { q: '👦', a: 'أخ' },
      { q: '👧', a: 'أخت' }, { q: '👴', a: 'جد' }, { q: '👵', a: 'جدة' },
      { q: '👨‍🦱', a: 'عم' }, { q: '👩‍🦱', a: 'عمة' }, { q: '🧒', a: 'ابن عم' },
      { q: '👶', a: 'طفل' }, { q: ' Bride', a: 'عروس' }, { q: ' Groom', a: 'عريس' },
      { q: ' Friends', a: 'أصدقاء' }, { q: ' Family', a: 'عائلة' }
    ]},
    'المهن': { icon: '👮', data: [
      { q: '👨‍🏫', a: 'معلم' }, { q: '👨‍⚕️', a: 'طبيب' }, { q: '👷', a: 'مهندس' },
      { q: '👨‍✈️', a: 'طيار' }, { q: '👨‍🍳', a: 'طباخ' }, { q: '👨‍🌾', a: 'فلاح' },
      { q: '👮', a: 'شرطي' }, { q: '👨‍🚒', a: 'إطفائي' }, { q: '👩‍⚕️', a: 'ممرضة' },
      { q: '🎨', a: 'فنان' }, { q: ' Astronaut', a: 'رائد فضاء' }, { q: ' Judge', a: 'قاضي' },
      { q: ' Photographer', a: 'مصور' }, { q: ' Singer', a: 'مغني' }, { q: ' Player', a: 'لاعب' },
      { q: ' Computer', a: 'مبرمج' }, { q: ' Dentist', a: 'طبيب أسنان' }
    ]},
    'الطبيعة': { icon: '🌲', data: [
      { q: '☀️', a: 'شمس' }, { q: '🌙', a: 'قمر' }, { q: '⭐', a: 'نجمة' },
      { q: '🌳', a: 'شجرة' }, { q: '🌸', a: 'زهرة' }, { q: '🏞️', a: 'نهر' },
      { q: '⛰️', a: 'جبل' }, { q: '🌊', a: 'بحر' }, { q: '🌧️', a: 'مطر' },
      { q: '☁️', a: 'سحاب' }, { q: ' Lightning', a: 'برق' }, { q: ' Snow', a: 'ثلج' },
      { q: ' Wind', a: 'رياح' }, { q: ' Volcano', a: 'بركان' }, { q: ' Cactus', a: 'صبار' },
      { q: ' Palm Tree', a: 'نخلة' }, { q: ' Leaf', a: 'ورقة شجر' }, { q: ' Fire', a: 'نار' }
    ]},
    'الأماكن': { icon: '🏫', data: [
      { q: '🏫', a: 'مدرسة' }, { q: '🏥', a: 'مستشفى' }, { q: '🌳', a: 'حديقة' },
      { q: '🛒', a: 'سوق' }, { q: '🏠', a: 'منزل' }, { q: '🏙️', a: 'مدينة' },
      { q: '🏖️', a: 'شاطئ' }, { q: '🌲', a: 'غابة' }, { q: '📚', a: 'مكتبة' },
      { q: '🦁', a: 'حديقة حيوان' }, { q: ' Bank', a: 'بنك' }, { q: ' Cinema', a: 'سينما' },
      { q: ' Mosque', a: 'مسجد' }, { q: ' Church', a: 'كنيسة' }, { q: ' Shop', a: 'محل' },
      { q: ' Stadium', a: 'ملعب' }, { q: ' Island', a: 'جزيرة' }, { q: ' Mountains', a: 'جبال' }
    ]},
    'الطعام والشراب': { icon: '🍔', data: [
      { q: '🍞', a: 'خبز' }, { q: '🍚', a: 'أرز' }, { q: '🥛', a: 'حليب' },
      { q: '💧', a: 'ماء' }, { q: '🧃', a: 'عصير' }, { q: '🍕', a: 'بيتزا' },
      { q: '🍔', a: 'برجر' }, { q: '🥚', a: 'بيض' }, { q: '🧀', a: 'جبن' },
      { q: '🥗', a: 'سلطة' }, { q: ' Ice Cream', a: 'آيس كريم' }, { q: ' Cake', a: 'كيك' },
      { q: ' Chocolate', a: 'شوكولاتة' }, { q: ' Honey', a: 'عسل' }, { q: ' Chicken', a: 'دجاج' },
      { q: ' Meat', a: 'لحم' }, { q: ' Fish', a: 'سمك' }, { q: ' Fries', a: 'بطاطس' },
      { q: ' Sandwich', a: 'ساندوتش' }, { q: ' Pretzel', a: 'بسكويت' }, { q: ' Popcorn', a: 'فشار' }
    ]},
    'الصفات': { icon: '🌟', data: [
      { q: '🐘', a: 'كبير' }, { q: '🐜', a: 'صغير' }, { q: '🐆', a: 'سريع' },
      { q: '🐢', a: 'بطيء' }, { q: '😊', a: 'سعيد' }, { q: '😢', a: 'حزين' },
      { q: '🔥', a: 'حار' }, { q: '❄️', a: 'بارد' }, { q: '👍', a: 'جيد' },
      { q: '👎', a: 'سيء' }, { q: ' Strong', a: 'قوي' }, { q: ' Weak', a: 'ضعيف' },
      { q: ' Bright', a: 'مضيء' }, { q: ' Dark', a: 'مظلم' }, { q: ' Hard', a: 'صلب' },
      { q: ' Soft', a: 'ناعم' }, { q: ' Clean', a: 'نظيف' }, { q: ' Dirty', a: 'متسخ' },
      { q: ' Long', a: 'طويل' }, { q: ' Short', a: 'قصير' }, { q: ' Rich', a: 'غني' },
      { q: ' Poor', a: 'فقير' }
    ]},
    'الأفعال': { icon: '🏃', data: [
      { q: '🏃', a: 'يجري' }, { q: '🚶', a: 'يمشي' }, { q: '🦘', a: 'يقفز' },
      { q: '📖', a: 'يقرأ' }, { q: '✍️', a: 'يكتب' }, { q: '🍴', a: 'يأكل' },
      { q: '🥤', a: 'يشرب' }, { q: '😴', a: 'ينام' }, { q: '🎮', a: 'يلعب' },
      { q: '🎤', a: 'يغني' }, { q: ' Dance', a: 'يرقص' }, { q: ' Swim', a: 'يسبح' },
      { q: ' Climb', a: 'يتسلق' }, { q: ' Ride', a: 'يركب' }, { q: ' Clean', a: 'ينظف' },
      { q: ' Cook', a: 'يطبخ' }, { q: ' Paint', a: 'يرسم' }, { q: ' Take Photo', a: 'يصور' },
      { q: ' Think', a: 'يفكر' }, { q: ' Talk', a: 'يتحدث' }, { q: ' Listen', a: 'يسمع' },
      { q: ' Look', a: 'يبحث' }, { q: ' Open', a: 'يفتح' }
    ]},
    'مختلط': { icon: '🔀', type: 'mixed' },
    'عمليات حسابية': { icon: '➕', type: 'math' },
    'أسماء شائعة': { icon: '📚', data: [
      { q: '📖', a: 'كتاب' }, { q: '🖊️', a: 'قلم' }, { q: '🖼️', a: 'لوحة' },
      { q: '🪑', a: 'كرسي' }, { q: '🚪', a: 'باب' }, { q: '🪟', a: 'نافذة' },
      { q: '📱', a: 'هاتف' }, { q: '💻', a: 'حاسوب' }, { q: '👜', a: 'حقيبة' },
      { q: '💡', a: 'مصباح' }
    ]}
  };

  function numberToWordsArabic(n) {
    const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
    const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
    if (n === 0) return 'صفر';
    if (n === 100) return 'مئة';
    if (n < 20) return ones[n];
    const unit = n % 10;
    const ten = Math.floor(n / 10);
    if (unit === 0) return tens[ten];
    return ones[unit] + ' و' + tens[ten];
  }

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      startScreen.classList.remove('active');
      topicsScreen.classList.add('active');
      renderTopics();
    });
  }

  function renderTopics() {
    const grid = document.querySelector('.topics-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    Object.keys(topicsData).forEach(key => {
      const item = topicsData[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'topic-card';
      btn.innerHTML = `${item.icon} ${key}`;
      btn.onclick = () => {
        currentTopic = key;
        startTugOfWar();
      };
      grid.appendChild(btn);
    });
  }

  // Full Screen Logic
  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  const fsBtn = document.createElement('button');
  fsBtn.className = 'fullscreen-btn';
  fsBtn.innerHTML = '⛶';
  fsBtn.onclick = toggleFullScreen;
  document.body.appendChild(fsBtn);

  function startTugOfWar() {
    topicsScreen.classList.remove('active');
    gamePlayScreen.classList.add('active');
    ropePosition = 50;
    updateVisuals();
    nextQuestion('a');
    nextQuestion('b');
  }

  function nextQuestion(team) {
    let topicToUse = currentTopic;
    if (topicToUse === 'مختلط') {
      const keys = Object.keys(topicsData).filter(k => k !== 'مختلط' && k !== 'عمليات حسابية');
      topicToUse = keys[Math.floor(Math.random() * keys.length)];
    }
    
    if (!topicQueues[topicToUse]) {
      topicQueues[topicToUse] = [];
    }

    const data = topicsData[topicToUse];
    let question = '';
    let correctAnswer = '';
    let options = [];

    // إذا فرغ الطابور، نملأه ونبعثره
    if (topicQueues[topicToUse].length === 0) {
      if (data.type === 'range') {
        for (let i = data.min; i <= data.max; i++) topicQueues[topicToUse].push(i);
      } else if (data.type === 'math') {
        for (let i = 0; i < 50; i++) {
          const a = Math.floor(Math.random() * 10) + 1;
          const b = Math.floor(Math.random() * 10) + 1;
          const op = Math.random() > 0.5 ? '+' : '-';
          if (op === '+') topicQueues[topicToUse].push({ q: `${a} + ${b}`, a: numberToWordsArabic(a + b) });
          else topicQueues[topicToUse].push({ q: `${Math.max(a,b)} - ${Math.min(a,b)}`, a: numberToWordsArabic(Math.abs(a-b)) });
        }
      } else {
        topicQueues[topicToUse] = [...data.data];
      }
      topicQueues[topicToUse].sort(() => Math.random() - 0.5);
    }

    const currentItem = topicQueues[topicToUse].pop();

    if (data.type === 'range') {
      const num = currentItem;
      question = num.toString();
      correctAnswer = numberToWordsArabic(num);
      
      options = [correctAnswer];
      while(options.length < 4) {
        const r = Math.floor(Math.random() * (data.max - data.min + 1)) + data.min;
        const w = numberToWordsArabic(r);
        if (!options.includes(w)) options.push(w);
      }
    } 
    else if (data.type === 'math') {
      question = currentItem.q;
      correctAnswer = currentItem.a;
      
      options = [correctAnswer];
      while(options.length < 4) {
        const w = numberToWordsArabic(Math.floor(Math.random() * 20));
        if (w !== '' && !options.includes(w)) options.push(w);
      }
    }
    else {
      question = currentItem.q;
      correctAnswer = currentItem.a;
      
      options = [correctAnswer];
      const allAnswers = data.data.map(i => i.a);
      while(options.length < 4 && options.length < allAnswers.length) {
        const w = allAnswers[Math.floor(Math.random() * allAnswers.length)];
        if (!options.includes(w)) options.push(w);
      }
    }

    document.getElementById(`question-${team}`).textContent = question;
    const container = document.getElementById(`answers-${team}`);
    container.innerHTML = '';
    options.sort(() => Math.random() - 0.5);

    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'ans-btn';
      btn.textContent = opt;
      btn.onclick = () => handleAnswer(team, opt === correctAnswer, btn);
      container.appendChild(btn);
    });
  }

  function handleAnswer(team, isCorrect, btn) {
    if (isCorrect) {
      btn.classList.add('correct');
      const dinoContainer = document.getElementById(`dino-${team}`);
      const dinoImg = dinoContainer.querySelector('.dino-img');
      dinoImg.classList.add(`pulling-${team}`);
      const container = document.querySelector('.tug-area');
      container.classList.add('shake');
      
      setTimeout(() => {
        dinoImg.classList.remove(`pulling-${team}`);
        container.classList.remove('shake');
      }, 600);

      if (team === 'b') { ropePosition -= 5; } else { ropePosition += 5; }
      
      checkWin();
      updateVisuals();
      setTimeout(() => nextQuestion(team), 500);
    } else {
      btn.classList.add('wrong');
      const scoreboard = document.querySelector(`.team-${team}`);
      scoreboard.classList.add('shake');
      setTimeout(() => {
        scoreboard.classList.remove('shake');
        btn.classList.remove('wrong');
      }, 400);
    }
  }

  function updateVisuals() {
    const marker = document.getElementById('rope-marker');
    const dinoA = document.getElementById('dino-a');
    const dinoB = document.getElementById('dino-b');
    marker.style.left = `${ropePosition}%`;
    dinoB.style.left = `calc(${ropePosition}% - 20% - 70px)`;
    dinoA.style.left = `calc(${ropePosition}% + 20% - 70px)`;
    dinoA.setAttribute('data-name', 'دينو أ');
    dinoB.setAttribute('data-name', 'دينو ب');
    
    const dinoImgA = dinoA.querySelector('.dino-img');
    const dinoImgB = dinoB.querySelector('.dino-img');
    dinoImgA.style.transform = `scaleX(-1)`; 
    dinoImgB.style.transform = `scaleX(-1)`; 
    
    const scaleB = 1 + (50 - ropePosition) / 100;
    const scaleA = 1 + (ropePosition - 50) / 100;
    dinoA.style.transform = `scale(${scaleA})`; 
    dinoB.style.transform = `scale(${scaleB})`;
  }

  function checkWin() {
    if (ropePosition <= 25) { showVictory('دينو ب'); }
    else if (ropePosition >= 75) { showVictory('دينو أ'); }
  }

  function showVictory(teamName) {
    const overlay = document.getElementById('victory-overlay');
    const winnerDisplay = document.getElementById('winner-name');
    if (overlay && winnerDisplay) {
      winnerDisplay.textContent = teamName;
      winnerDisplay.style.color = teamName === 'دينو أ' ? '#16a34a' : '#a855f7';
      overlay.style.display = 'flex';
    }
  }

  if (restartBtn) restartBtn.onclick = () => location.reload();
  if (playAgainBtn) playAgainBtn.onclick = () => location.reload();

})();
