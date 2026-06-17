(function() {
let gameInstance = null;
let gameState = {
  score: 0,
  level: 1,
  currentQuestion: null,
  answeredCorrectly: false,
  gameScene: null
};

const phaserConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 400 },
      debug: false
    }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth - 40,
    height: window.innerHeight - 200
  },
  scene: {
    preload: preload,
    create: create,
    update: update
  }
};

gameInstance = new Phaser.Game(phaserConfig);

function preload() {
  // الرسومات ستُنشأ ديناميكياً
}

function createPlayerGraphic(scene) {
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  
  // الرأس (بني فاتح - جلد)
  graphics.fillStyle(0xd4a574, 1);
  graphics.fillCircle(20, 14, 11);
  
  // شعر (بني غامق)
  graphics.fillStyle(0x3d2817, 1);
  graphics.fillCircle(20, 10, 11);
  
  // الشعر الجانبي
  graphics.fillRect(10, 8, 20, 6);
  
  // العينان (أسود)
  graphics.fillStyle(0x000000, 1);
  graphics.fillCircle(15, 13, 2);
  graphics.fillCircle(25, 13, 2);
  
  // بريق العيون (أبيض)
  graphics.fillStyle(0xffffff, 0.9);
  graphics.fillCircle(15.5, 12.5, 1);
  graphics.fillCircle(25.5, 12.5, 1);
  
  // الفم (ابتسامة بسيطة)
  graphics.fillStyle(0x8b4513, 0.5);
  graphics.fillRect(18, 17, 4, 2);
  
  // الجسم الرئيسي (بدلة حمراء زاهية)
  graphics.fillStyle(0xdd0000, 1);
  graphics.fillRect(9, 26, 22, 18);
  
  // شريط أزرق على الصدر (مثل Mario)
  graphics.fillStyle(0x0066cc, 1);
  graphics.fillRect(9, 26, 22, 6);
  
  // الأزرار الذهبية
  graphics.fillStyle(0xffdd00, 1);
  graphics.fillCircle(14, 32, 1.5);
  graphics.fillCircle(26, 32, 1.5);
  
  // تحديد الأزرار
  graphics.lineStyle(1, 0xcc8800, 1);
  graphics.strokeCircle(14, 32, 1.5);
  graphics.strokeCircle(26, 32, 1.5);
  
  // الأرجل (جلد)
  graphics.fillStyle(0xd4a574, 1);
  graphics.fillRect(11, 44, 4, 6);
  graphics.fillRect(25, 44, 4, 6);
  
  // الأحذية (حمراء)
  graphics.fillStyle(0xaa0000, 1);
  graphics.fillRect(10, 50, 6, 4);
  graphics.fillRect(24, 50, 6, 4);
  
  // تفاصيل الأحذية (أسود)
  graphics.fillStyle(0x000000, 1);
  graphics.fillRect(10, 51.5, 6, 1.5);
  graphics.fillRect(24, 51.5, 6, 1.5);
  
  // خطوط القسمة على البدلة
  graphics.lineStyle(1, 0xffffff, 0.2);
  graphics.strokeRect(9, 26, 22, 18);
  
  const texture = graphics.generateTexture('player', 40, 56);
  graphics.destroy();
  return 'player';
}

function createCoinGraphic(scene) {
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  
  // الظل (أسفل العملة)
  graphics.fillStyle(0x000000, 0.2);
  graphics.fillCircle(12, 14, 10);
  
  // الحد الخارجي (ذهبي غامق)
  graphics.fillStyle(0x997700, 1);
  graphics.fillCircle(12, 12, 11);
  
  // الطبقة الثانية (ذهبي متوسط)
  graphics.fillStyle(0xddaa00, 1);
  graphics.fillCircle(12, 12, 10);
  
  // الطبقة الثالثة (ذهبي مشرق)
  graphics.fillStyle(0xffdd00, 1);
  graphics.fillCircle(12, 12, 8);
  
  // الوسط المشع
  graphics.fillStyle(0xffff66, 1);
  graphics.fillCircle(12, 12, 6);
  
  // لمعة عالية (highlight رئيسية)
  graphics.fillStyle(0xffffff, 0.8);
  graphics.fillCircle(9, 9, 2.5);
  
  // لمعة ثانوية
  graphics.fillStyle(0xffffff, 0.4);
  graphics.fillCircle(14, 10, 1.5);
  
  // حافة معدنية (خطوط)
  graphics.lineStyle(0.5, 0xcc8800, 0.5);
  graphics.strokeCircle(12, 12, 8);
  graphics.strokeCircle(12, 12, 6);
  
  const texture = graphics.generateTexture('coin', 24, 24);
  graphics.destroy();
  return 'coin';
}

function create() {
  gameState.gameScene = this;
  const width = this.scale.width;
  const height = this.scale.height;

  // خلفية Sky مع تأثيرات
  const skyGraphics = this.make.graphics({ x: 0, y: 0, add: false });
  // سماء زرقاء متدرجة
  skyGraphics.fillStyle(0x87ceeb, 1);
  skyGraphics.fillRect(0, 0, width, height * 0.4);
  skyGraphics.fillStyle(0x4a9fd8, 1);
  skyGraphics.fillRect(0, height * 0.4, width, height * 0.3);
  skyGraphics.fillStyle(0x87c5d6, 1);
  skyGraphics.fillRect(0, height * 0.7, width, height * 0.3);
  
  const bgImg = this.add.image(0, 0, skyGraphics.generateTexture('bg', width, height)).setOrigin(0, 0);
  bgImg.setDepth(-100);
  skyGraphics.destroy();
  
  // إضافة شمس
  const sun = this.add.circle(width - 100, 80, 50, 0xffdd00);
  sun.setDepth(-99);
  const sunGlow = this.add.circle(width - 100, 80, 60, 0xffaa00);
  sunGlow.setAlpha(0.2);
  sunGlow.setDepth(-99);
  
  // إضافة نجوم/نقاط في السماء (مثل Super Mario)
  const stars = [];
  for (let i = 0; i < 12; i++) {
    const starX = Math.random() * width;
    const starY = Math.random() * (height * 0.5);
    const star = this.add.star(starX, starY, 5, 6, 10, 0xffff00);
    star.setScale(0.6);
    stars.push(star);
    
    // تأثير وميض للنجوم
    this.tweens.add({
      targets: star,
      alpha: { from: 0.3, to: 1 },
      duration: 1500 + Math.random() * 1000,
      yoyo: true,
      repeat: -1,
      delay: i * 200
    });
  }

  // إنشاء الرسومات
  createPlayerGraphic(this);
  createCoinGraphic(this);

  // منصات (platforms)
  const platforms = this.physics.add.staticGroup();
  
  // الأرضية الرئيسية (بني مثل الطوب)
  const groundGraphics = this.make.graphics({ x: 0, y: 0, add: false });
  groundGraphics.fillStyle(0x8b4513, 1);
  groundGraphics.fillRect(0, height - 40, width, 40);
  
  // إضافة نمط الطوب (عرض الشطرنج)
  groundGraphics.fillStyle(0xa0522d, 0.5);
  for (let x = 0; x < width; x += 40) {
    for (let y = height - 40; y < height; y += 20) {
      groundGraphics.fillRect(x, y, 40, 20);
    }
  }
  
  const groundImg = this.add.image(0, 0, groundGraphics.generateTexture('ground', width, 40)).setOrigin(0, 0);
  groundImg.setY(height - 40);
  groundGraphics.destroy();
  
  // إضافة الأرضية الفيزيائية
  const ground = this.add.rectangle(width / 2, height - 20, width, 40, 0x8b4513);
  ground.setAlpha(0);
  this.physics.add.existing(ground, true);
  platforms.add(ground);

  // منصات ملونة مع تفاصيل محسنة
  const platformData = [
    { x: width * 0.25, y: height - 150, w: 120, color: 0x8b4513, lightColor: 0xa0522d }, // بني (خشب)
    { x: width * 0.75, y: height - 200, w: 120, color: 0x22bb22, lightColor: 0x33dd33 }, // أخضر
    { x: width / 2, y: height - 280, w: 140, color: 0xdaa520, lightColor: 0xffcc00 }      // ذهبي
  ];

  platformData.forEach((data, idx) => {
    // الظل (أسفل المنصة) - أكثر كثافة
    const shadow = this.add.rectangle(data.x, data.y + 13, data.w + 6, 8, 0x000000);
    shadow.setAlpha(0.35);
    shadow.setDepth(-1);
    
    // المنصة الرئيسية
    const platform = this.add.rectangle(data.x, data.y, data.w, 18, data.color);
    this.physics.add.existing(platform, true);
    platforms.add(platform);
    platform.setDepth(5);
    
    // حد أعلى (highlight مشع)
    const topBorder = this.add.rectangle(data.x, data.y - 10, data.w, 2, data.lightColor);
    topBorder.setAlpha(0.6);
    topBorder.setDepth(6);
    
    // حد أسفل (shadow)
    const bottomBorder = this.add.rectangle(data.x, data.y + 9, data.w, 2, 0x000000);
    bottomBorder.setAlpha(0.4);
    bottomBorder.setDepth(4);
    
    // أنماط تفصيلية حسب اللون
    const graphics = this.make.graphics({ x: 0, y: 0, add: false });
    
    if (idx === 0) { // منصة خشب - نمط خشبي
      graphics.fillStyle(0x654321, 0.4);
      for (let i = 0; i < 6; i++) {
        graphics.fillRect(data.x - data.w / 2 + i * 20, data.y - 7, 3, 16);
      }
    } else if (idx === 1) { // منصة خضراء - نقاط عشب
      graphics.fillStyle(0x00aa00, 0.5);
      for (let i = 0; i < 8; i++) {
        graphics.fillCircle(data.x - data.w / 2 + i * 15, data.y - 5, 2);
        graphics.fillCircle(data.x - data.w / 2 + i * 15 + 8, data.y + 3, 2);
      }
    } else if (idx === 2) { // منصة ذهبية - نقاط لامعة
      graphics.fillStyle(0xffff99, 0.6);
      for (let i = 0; i < 7; i++) {
        graphics.fillCircle(data.x - data.w / 2 + i * 20, data.y, 1.5);
      }
    }
    
    graphics.destroy();
  });

  // الشخصية (Player)
  const player = this.add.image(50, height - 100, 'player');
  this.physics.add.existing(player);
  player.body.setBounce(0.3);
  player.body.setCollideWorldBounds(true);
  player.setScale(1.8);
  player.setDisplaySize(48, 72);

  this.player = player;

  // العملات (Coins)
  const coins = this.physics.add.group();
  const coinPositions = [
    { x: width * 0.25, y: height - 220 },
    { x: width * 0.75, y: height - 270 },
    { x: width / 2, y: height - 350 },
    { x: width * 0.35, y: height - 120 },
    { x: width * 0.65, y: height - 170 }
  ];

  coinPositions.forEach(pos => {
    const coin = coins.create(pos.x, pos.y, 'coin');
    coin.setBounce(0.6);
    coin.setCollideWorldBounds(true);
    coin.setVelocity(Phaser.Math.Between(-30, 30), Phaser.Math.Between(-10, 10));
    
    // Animation للعملات
    this.tweens.add({
      targets: coin,
      y: pos.y - 15,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inout'
    });
  });

  this.coins = coins;

  // Collisions
  this.physics.add.collider(player, platforms);
  this.physics.add.collider(coins, platforms);
  
  // عند جمع عملة
  this.physics.add.overlap(player, coins, collectCoin, null, this);

  // معالجة الإدخال
  this.cursors = this.input.keyboard.createCursorKeys();
  this.input.keyboard.on('keydown-SPACE', () => {
    if (player.body.touching.down) {
      player.body.setVelocityY(-350);
      
      // تأثير قفزة
      this.tweens.add({
        targets: player,
        scaleX: 1.3,
        scaleY: 1.2,
        duration: 100,
        yoyo: true
      });
    }
  });
}

function update() {
  const cursors = this.cursors;
  const player = this.player;

  // الحركة الأفقية
  if (cursors.left.isDown) {
    player.body.setVelocityX(-200);
    player.setFlipX(true);
  } else if (cursors.right.isDown) {
    player.body.setVelocityX(200);
    player.setFlipX(false);
  } else {
    player.body.setVelocityX(0);
  }
}

function collectCoin(player, coin) {
  // تأثير جمع العملة
  const scene = gameState.gameScene;
  
  // انفجار جزيئات ذهبية
  const particles = scene.add.particles({
    speed: { min: -250, max: 250 },
    angle: { min: 220, max: 320 },
    scale: { start: 1.2, end: 0 },
    lifespan: 800,
    gravityY: 400,
    emitZone: { type: 'circle', source: new Phaser.Geom.Circle(0, 0, 15) }
  });
  
  // إنشاء نص "10+" فوق العملة
  const floatingText = scene.add.text(coin.x, coin.y, '+10', {
    fontSize: '32px',
    fontFamily: 'Arial Bold',
    fill: '#FFD700',
    stroke: '#FF8800',
    strokeThickness: 3,
    align: 'center'
  });
  floatingText.setOrigin(0.5, 0.5);
  floatingText.setDepth(100);
  
  // رسم جزيئات ذهبية حول النص
  const emitter = particles.createEmitter({
    speed: { min: -150, max: 150 },
    angle: { min: 220, max: 320 },
    scale: { start: 1, end: 0 },
    lifespan: 700,
    gravityY: 350
  });
  
  emitter.emitParticleAt(coin.x, coin.y, 15);
  
  // حركة النص لأعلى مع الاختفاء
  scene.tweens.add({
    targets: floatingText,
    y: coin.y - 60,
    alpha: { from: 1, to: 0 },
    duration: 800,
    ease: 'Quad.out',
    onComplete: () => floatingText.destroy()
  });
  
  setTimeout(() => particles.destroy(), 800);
  
  coin.destroy();
  gameState.score += 10;
  updateScore();
  
  // تأثير هز الشخصية
  scene.tweens.add({
    targets: player,
    scaleX: 1.6,
    scaleY: 1.6,
    duration: 120,
    yoyo: true
  });
  
  // جلب سؤال عشوائي
  fetchRandomQuestion();
  showQuizModal();
}

function updateScore() {
  document.getElementById('score-value').textContent = gameState.score;
}

async function fetchRandomQuestion() {
  try {
    // جلب الأسئلة من localStorage أو API
    const storedQuizzes = localStorage.getItem('cm_quizzes_v1');
    if (!storedQuizzes) {
      gameState.currentQuestion = {
        question: 'كم عدد كواكب النظام الشمسي؟',
        answers: ['7', '8', '9', '10'],
        correct: 1
      };
      return;
    }

    const quizzes = JSON.parse(storedQuizzes);
    if (!Array.isArray(quizzes) || quizzes.length === 0) {
      gameState.currentQuestion = null;
      return;
    }

    // اختيار كويز عشوائي
    const randomQuiz = quizzes[Math.floor(Math.random() * quizzes.length)];
    
    if (randomQuiz.questions && Array.isArray(randomQuiz.questions)) {
      const randomQuestion = randomQuiz.questions[Math.floor(Math.random() * randomQuiz.questions.length)];
      gameState.currentQuestion = randomQuestion;
    }
  } catch (error) {
    console.error('Error fetching question:', error);
    gameState.currentQuestion = null;
  }
}

function showQuizModal() {
  if (!gameState.currentQuestion) {
    showDefaultQuestion();
    return;
  }

  const modal = document.getElementById('quiz-modal');
  const questionEl = document.getElementById('quiz-question');
  const answersEl = document.getElementById('quiz-answers');

  questionEl.textContent = gameState.currentQuestion.question || gameState.currentQuestion.text;
  answersEl.innerHTML = '';

  const answers = gameState.currentQuestion.answers || gameState.currentQuestion.options || [];
  const correctIndex = gameState.currentQuestion.correct || gameState.currentQuestion.correctAnswer || 0;

  answers.forEach((answer, index) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.textContent = answer;
    btn.onclick = () => checkAnswer(index, correctIndex, btn);
    answersEl.appendChild(btn);
  });

  modal.style.display = 'flex';
}

function showDefaultQuestion() {
  const modal = document.getElementById('quiz-modal');
  const questionEl = document.getElementById('quiz-question');
  const answersEl = document.getElementById('quiz-answers');

  questionEl.textContent = '🎓 لا توجد أسئلة متاحة حالياً. استمتع باللعبة!';
  answersEl.innerHTML = '';

  modal.style.display = 'flex';
}

function checkAnswer(selectedIndex, correctIndex, buttonEl) {
  const allBtns = document.querySelectorAll('.answer-btn');
  allBtns.forEach(btn => btn.disabled = true);

  if (selectedIndex === correctIndex) {
    buttonEl.classList.add('correct');
    gameState.score += 20;
    updateScore();
    gameState.answeredCorrectly = true;
    setTimeout(() => {
      closeQuiz();
    }, 1500);
  } else {
    buttonEl.classList.add('incorrect');
    allBtns[correctIndex].classList.add('correct');
    setTimeout(() => {
      closeQuiz();
    }, 1500);
  }
}

function skipQuestion() {
  closeQuiz();
}

function closeQuiz() {
  const modal = document.getElementById('quiz-modal');
  modal.style.display = 'none';
  
  // إعادة تفعيل الأزرار
  const allBtns = document.querySelectorAll('.answer-btn');
  allBtns.forEach(btn => btn.disabled = false);
  
  // مسح الألوان
  document.getElementById('quiz-answers').innerHTML = '';
}

// تحديث الدرجة عند بدء اللعبة
updateScore();

const closeQuizBtn = document.getElementById('close-quiz-btn');
const skipQuizBtn = document.getElementById('skip-quiz-btn');

if (closeQuizBtn) closeQuizBtn.onclick = closeQuiz;
if (skipQuizBtn) skipQuizBtn.onclick = skipQuestion;

})();
