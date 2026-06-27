/* uniform Fisher-Yates shuffle (replaces biased Array.sort random comparator) */
function __acShuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;}return a;}
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
  let topicQueues = {}; // طوابير الأسئلة لمنع التكرار نهائياً
  
  const topicsData = {
    'Fruits': { icon: '🍎', data: [
      { q: '🍎', a: 'Apple' }, { q: '🍌', a: 'Banana' }, { q: '🍊', a: 'Orange' },
      { q: '🥭', a: 'Mango' }, { q: '🍇', a: 'Grapes' }, { q: '🍓', a: 'Strawberry' },
      { q: '🍍', a: 'Pineapple' }, { q: '🍉', a: 'Watermelon' }, { q: '🍒', a: 'Cherry' },
      { q: '🥝', a: 'Kiwi' }, { q: '🍑', a: 'Peach' }, { q: '🍐', a: 'Pear' },
      { q: '🍋', a: 'Lemon' }, { q: '🍈', a: 'Melon' }, { q: '🥥', a: 'Coconut' },
      { q: '🥑', a: 'Avocado' }, { q: '🍅', a: 'Tomato' }, { q: '🫐', a: 'Blueberry' },
      { q: '🌽', a: 'Corn' }, { q: '🥜', a: 'Peanut' }, { q: '🫒', a: 'Olive' },
      { q: '🥦', a: 'Broccoli' }, { q: '🥕', a: 'Carrot' }
    ]},
    'Numbers 1-100': { icon: '💯', type: 'range', min: 1, max: 100 },
    'Numbers 1-20': { icon: '🔢', type: 'range', min: 1, max: 20 },
    'Vehicles': { icon: '🚗', data: [
      { q: '🚗', a: 'Car' }, { q: '🚌', a: 'Bus' }, { q: '🚆', a: 'Train' },
      { q: '✈️', a: 'Plane' }, { q: '🚲', a: 'Bike' }, { q: '🚢', a: 'Ship' },
      { q: '🚚', a: 'Truck' }, { q: '🚁', a: 'Helicopter' }, { q: '🏍️', a: 'Motorcycle' },
      { q: '⛵', a: 'Boat' }, { q: '🚑', a: 'Ambulance' }, { q: '🚓', a: 'Police Car' },
      { q: '🚒', a: 'Fire Truck' }, { q: '🚜', a: 'Tractor' }, { q: '🚀', a: 'Rocket' },
      { q: '🛶', a: 'Canoe' }, { q: '🛴', a: 'Scooter' }, { q: '🛸', a: 'UFO' },
      { q: '🚂', a: 'Steam Engine' }, { q: '🚇', a: 'Metro' }
    ]},
    'Verbs': { icon: '🏃', data: [
      { q: '🏃', a: 'Run' }, { q: '🚶', a: 'Walk' }, { q: '🦘', a: 'Jump' },
      { q: '📖', a: 'Read' }, { q: '✍️', a: 'Write' }, { q: '🍴', a: 'Eat' },
      { q: '🥤', a: 'Drink' }, { q: '😴', a: 'Sleep' }, { q: '🎮', a: 'Play' },
      { q: '🎤', a: 'Sing' }, { q: '💃', a: 'Dance' }, { q: '🏊', a: 'Swim' },
      { q: '🧗', a: 'Climb' }, { q: '🚴', a: 'Ride' }, { q: '🧹', a: 'Clean' },
      { q: '🍳', a: 'Cook' }, { q: '🎨', a: 'Paint' }, { q: '📸', a: 'Take Photo' },
      { q: '💡', a: 'Think' }, { q: '🗣️', a: 'Talk' }, { q: '👂', a: 'Listen' },
      { q: '🔍', a: 'Look' }, { q: '🚪', a: 'Open' }
    ]},
    'Adjectives': { icon: '🌟', data: [
      { q: '🐘', a: 'Big' }, { q: '🐜', a: 'Small' }, { q: '🐆', a: 'Fast' },
      { q: '🐢', a: 'Slow' }, { q: '😊', a: 'Happy' }, { q: '😢', a: 'Sad' },
      { q: '🔥', a: 'Hot' }, { q: '❄️', a: 'Cold' }, { q: '👍', a: 'Good' },
      { q: '👎', a: 'Bad' }, { q: '🦁', a: 'Strong' }, { q: '🐭', a: 'Weak' },
      { q: '💡', a: 'Bright' }, { q: '🌑', a: 'Dark' }, { q: '💎', a: 'Hard' },
      { q: '☁️', a: 'Soft' }, { q: '🧴', a: 'Clean' }, { q: '💩', a: 'Dirty' },
      { q: '📏', a: 'Long' }, { q: '🤏', a: 'Short' }, { q: '💰', a: 'Rich' },
      { q: '📉', a: 'Poor' }
    ]},
    'Sports': { icon: '⚽', data: [
      { q: '⚽', a: 'Football' }, { q: '🏀', a: 'Basketball' }, { q: '🎾', a: 'Tennis' },
      { q: '🏊', a: 'Swimming' }, { q: '🏃', a: 'Running' }, { q: '🚴', a: 'Cycling' },
      { q: '🥊', a: 'Boxing' }, { q: '⛳', a: 'Golf' }, { q: '⚾', a: 'Baseball' },
      { q: '🥋', a: 'Karate' }, { q: '🏐', a: 'Volleyball' }, { q: '🏹', a: 'Archery' },
      { q: '🏓', a: 'Ping Pong' }, { q: '⛸️', a: 'Skating' }, { q: '🏄', a: 'Surfing' },
      { q: '🏋️', a: 'Weightlifting' }, { q: '♟️', a: 'Chess' }
    ]},
    'Food & Drink': { icon: '🍔', data: [
      { q: '🍞', a: 'Bread' }, { q: '🍚', a: 'Rice' }, { q: '🥛', a: 'Milk' },
      { q: '💧', a: 'Water' }, { q: '🧃', a: 'Juice' }, { q: '🍕', a: 'Pizza' },
      { q: '🍔', a: 'Burger' }, { q: '🥚', a: 'Egg' }, { q: '🧀', a: 'Cheese' },
      { q: '🥗', a: 'Salad' }, { q: '🍦', a: 'Ice Cream' }, { q: '🍰', a: 'Cake' },
      { q: '🍫', a: 'Chocolate' }, { q: '🍯', a: 'Honey' }, { q: '🍗', a: 'Chicken' },
      { q: '🥩', a: 'Meat' }, { q: '🐟', a: 'Fish' }, { q: '🍟', a: 'Fries' },
      { q: '🥪', a: 'Sandwich' }, { q: '🥨', a: 'Pretzel' }, { q: '🍿', a: 'Popcorn' }
    ]},
    'Body Parts': { icon: '👂', data: [
      { q: '🧒', a: 'Head' }, { q: '👁️', a: 'Eye' }, { q: '👂', a: 'Ear' },
      { q: '👃', a: 'Nose' }, { q: '👄', a: 'Mouth' }, { q: '✋', a: 'Hand' },
      { q: '👣', a: 'Foot' }, { q: '🦵', a: 'Leg' }, { q: '💪', a: 'Arm' },
      { q: '🦴', a: 'Shoulder' }, { q: '🦷', a: 'Tooth' }, { q: '👅', a: 'Tongue' },
      { q: '🖐️', a: 'Finger' }, { q: '🧔', a: 'Beard' }, { q: '💇', a: 'Hair' },
      { q: '🧠', a: 'Brain' }, { q: '❤️', a: 'Heart' }, { q: '🦴', a: 'Bone' }
    ]},
    'Animals': { icon: '🦁', data: [
      { q: '🦁', a: 'Lion' }, { q: '🐯', a: 'Tiger' }, { q: '🐘', a: 'Elephant' },
      { q: '🦒', a: 'Giraffe' }, { q: '🦓', a: 'Zebra' }, { q: '🐒', a: 'Monkey' },
      { q: '🐱', a: 'Cat' }, { q: '🐶', a: 'Dog' }, { q: '🐰', a: 'Rabbit' },
      { q: '🐦', a: 'Bird' }, { q: '🐍', a: 'Snake' }, { q: '🐢', a: 'Turtle' },
      { q: '🐊', a: 'Crocodile' }, { q: '🐸', a: 'Frog' }, { q: '🐬', a: 'Dolphin' },
      { q: '🐳', a: 'Whale' }, { q: '🦈', a: 'Shark' }, { q: '🐙', a: 'Octopus' },
      { q: '🦋', a: 'Butterfly' }, { q: '🐝', a: 'Bee' }, { q: '🐜', a: 'Ant' },
      { q: '🕷️', a: 'Spider' }, { q: '🐧', a: 'Penguin' }, { q: '🦘', a: 'Kangaroo' },
      { q: '🐼', a: 'Panda' }
    ]},
    'Family': { icon: '👨‍👩‍👦', data: [
      { q: '👨', a: 'Father' }, { q: '👩', a: 'Mother' }, { q: '👦', a: 'Brother' },
      { q: '👧', a: 'Sister' }, { q: '👴', a: 'Grandfather' }, { q: '👵', a: 'Grandmother' },
      { q: '👨‍🦱', a: 'Uncle' }, { q: '👩‍🦱', a: 'Aunt' }, { q: '🧒', a: 'Cousin' },
      { q: '👶', a: 'Baby' }, { q: '👰', a: 'Bride' }, { q: '🤵', a: 'Groom' },
      { q: '👫', a: 'Friends' }, { q: '🏠', a: 'Family' },
      { q: '👨‍👧', a: 'Parent' }, { q: '👩‍🍼', a: 'Nanny' }, { q: '🧓', a: 'Elderly' },
      { q: '👭', a: 'Twins' }, { q: '💑', a: 'Couple' }, { q: '🧑‍🤝‍🧑', a: 'Siblings' }
    ]},
    'Colours': { icon: '🎨', data: [
      { q: '🔴', a: 'Red' }, { q: '🔵', a: 'Blue' }, { q: '🟢', a: 'Green' },
      { q: '🟡', a: 'Yellow' }, { q: '🟠', a: 'Orange' }, { q: '🟣', a: 'Purple' },
      { q: '💗', a: 'Pink' }, { q: '⚫', a: 'Black' }, { q: '⚪', a: 'White' },
      { q: '🟤', a: 'Brown' }, { q: '🥈', a: 'Silver' }, { q: '🥇', a: 'Gold' },
      { q: '🌈', a: 'Rainbow' }, { q: '🩵', a: 'Light Blue' }, { q: '🩶', a: 'Grey' },
      { q: '🫐', a: 'Indigo' }, { q: '🟩', a: 'Lime' }, { q: '🫧', a: 'Turquoise' },
      { q: '🌸', a: 'Magenta' }, { q: '🦩', a: 'Coral' }
    ]},
    'Nature': { icon: '🌲', data: [
      { q: '☀️', a: 'Sun' }, { q: '🌙', a: 'Moon' }, { q: '⭐', a: 'Star' },
      { q: '🌳', a: 'Tree' }, { q: '🌸', a: 'Flower' }, { q: '🏞️', a: 'River' },
      { q: '⛰️', a: 'Mountain' }, { q: '🌊', a: 'Sea' }, { q: '🌧️', a: 'Rain' },
      { q: '☁️', a: 'Cloud' }, { q: '⚡', a: 'Lightning' }, { q: '❄️', a: 'Snow' },
      { q: '🌬️', a: 'Wind' }, { q: '🌋', a: 'Volcano' }, { q: '🌵', a: 'Cactus' },
      { q: '🌴', a: 'Palm Tree' }, { q: '🍂', a: 'Leaf' }, { q: '🔥', a: 'Fire' }
    ]},
    'Places': { icon: '🏫', data: [
      { q: '🏫', a: 'School' }, { q: '🏥', a: 'Hospital' }, { q: '🌳', a: 'Park' },
      { q: '🛒', a: 'Market' }, { q: '🏠', a: 'House' }, { q: '🏙️', a: 'City' },
      { q: '🏖️', a: 'Beach' }, { q: '🌲', a: 'Forest' }, { q: '📚', a: 'Library' },
      { q: '🦁', a: 'Zoo' }, { q: '🏦', a: 'Bank' }, { q: '🎬', a: 'Cinema' },
      { q: '🕌', a: 'Mosque' }, { q: '⛪', a: 'Church' }, { q: '🏪', a: 'Shop' },
      { q: '🏟️', a: 'Stadium' }, { q: '🏝️', a: 'Island' }, { q: '🏔️', a: 'Mountains' }
    ]},
    'Occupations': { icon: '👮', data: [
      { q: '👨‍🏫', a: 'Teacher' }, { q: '👨‍⚕️', a: 'Doctor' }, { q: '👷', a: 'Engineer' },
      { q: '👨‍✈️', a: 'Pilot' }, { q: '👨‍🍳', a: 'Chef' }, { q: '👨‍🌾', a: 'Farmer' },
      { q: '👮', a: 'Police' }, { q: '👨‍🚒', a: 'Firefighter' }, { q: '👩‍⚕️', a: 'Nurse' },
      { q: '🎨', a: 'Artist' }, { q: '🚀', a: 'Astronaut' }, { q: '⚖️', a: 'Judge' },
      { q: '📸', a: 'Photographer' }, { q: '🎤', a: 'Singer' }, { q: '⚽', a: 'Player' },
      { q: '💻', a: 'Programmer' }, { q: '🦷', a: 'Dentist' }
    ]},
    'Other / Mixed': { icon: '🔀', type: 'mixed' },
    'Math Ops': { icon: '➕', type: 'math' },
    'Common Nouns': { icon: '📚', data: [
      { q: '📖', a: 'Book' }, { q: '🖊️', a: 'Pen' }, { q: '🪑', a: 'Table' },
      { q: '🪑', a: 'Chair' }, { q: '🚪', a: 'Door' }, { q: '🪟', a: 'Window' },
      { q: '📱', a: 'Phone' }, { q: '💻', a: 'Computer' }, { q: '👜', a: 'Bag' },
      { q: '💡', a: 'Lamp' }, { q: '🛏️', a: 'Bed' }, { q: '🛁', a: 'Bathtub' },
      { q: '🪞', a: 'Mirror' }, { q: '🚿', a: 'Shower' }, { q: '🧺', a: 'Basket' },
      { q: '🪴', a: 'Plant' }, { q: '🕰️', a: 'Clock' }, { q: '📷', a: 'Camera' },
      { q: '📺', a: 'TV' }, { q: '🎒', a: 'Backpack' }, { q: '🧸', a: 'Toy' },
      { q: '🪣', a: 'Bucket' }, { q: '🧴', a: 'Bottle' }, { q: '🗝️', a: 'Key' },
      { q: '📦', a: 'Box' }, { q: '🪤', a: 'Trap' }, { q: '🧲', a: 'Magnet' }
    ]}
  };

  function numberToWords(n) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    if (n === 100) return 'One Hundred';
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? '-' + ones[n % 10] : '');
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
    var el = document.querySelector('.tug-of-war-container') || document.querySelector('.game-container');
    if (!document.fullscreenElement) {
      if (el && el.requestFullscreen) el.requestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  const fsBtn = document.getElementById('fullscreen-btn');
  if (fsBtn) fsBtn.onclick = toggleFullScreen;

  function startTugOfWar() {
    topicsScreen.classList.remove('active');
    gamePlayScreen.classList.add('active');
    ropePosition = 50;

    // Handle Mixed topic
    if (currentTopic === 'Other / Mixed') {
      const keys = Object.keys(topicsData).filter(k => k !== 'Other / Mixed');
      // For mixed, we don't change currentTopic itself so nextQuestion can pick random from different sets
      // but it's better to just pick a random one once or per question.
      // Let's make nextQuestion handle it per question if currentTopic is mixed.
    }

    updateVisuals();
    nextQuestion('a');
    nextQuestion('b');
  }

  function nextQuestion(team) {
    let topicToUse = currentTopic;
    if (topicToUse === 'Other / Mixed') {
      const keys = Object.keys(topicsData).filter(k => k !== 'Other / Mixed' && k !== 'Math Ops');
      topicToUse = keys[Math.floor(Math.random() * keys.length)];
    }
    
    // إنشاء طابور للموضوع إذا لم يوجد
    if (!topicQueues[topicToUse]) {
      topicQueues[topicToUse] = [];
    }

    const data = topicsData[topicToUse];
    let question = '';
    let correctAnswer = '';
    let options = [];

    // المنطق الجديد: إذا فرغ الطابور، نملأه ونبعثره
    if (topicQueues[topicToUse].length === 0) {
      if (data.type === 'range') {
        for (let i = data.min; i <= data.max; i++) topicQueues[topicToUse].push(i);
      } else if (data.type === 'math') {
        // توليد 50 مسألة مختلفة للطابور
        for (let i = 0; i < 50; i++) {
          const a = Math.floor(Math.random() * 10) + 1;
          const b = Math.floor(Math.random() * 10) + 1;
          const op = Math.random() > 0.5 ? '+' : '-';
          if (op === '+') topicQueues[topicToUse].push({ q: `${a} + ${b}`, a: numberToWords(a + b) });
          else topicQueues[topicToUse].push({ q: `${Math.max(a,b)} - ${Math.min(a,b)}`, a: numberToWords(Math.abs(a-b)) });
        }
      } else {
        topicQueues[topicToUse] = [...data.data];
      }
      // بعثرة (Shuffle)
      __acShuffle(topicQueues[topicToUse]);
    }

    const currentItem = topicQueues[topicToUse].pop();

    if (data.type === 'range') {
      const num = currentItem;
      question = num.toString();
      correctAnswer = numberToWords(num);
      
      options = [correctAnswer];
      while(options.length < 4) {
        const r = Math.floor(Math.random() * (data.max - data.min + 1)) + data.min;
        const w = numberToWords(r);
        if (!options.includes(w)) options.push(w);
      }
    } 
    else if (data.type === 'math') {
      question = currentItem.q;
      correctAnswer = currentItem.a;
      
      options = [correctAnswer];
      while(options.length < 4) {
        const w = numberToWords(Math.floor(Math.random() * 20));
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

    // UI Update
    document.getElementById(`question-${team}`).textContent = question;
    
    const container = document.getElementById(`answers-${team}`);
    container.innerHTML = '';

    __acShuffle(options);

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
      
      // إضافة حركة الشد للصورة مباشرة
      dinoImg.classList.add(`pulling-${team}`);
      
      const container = document.querySelector('.tug-area');
      container.classList.add('shake');
      
      setTimeout(() => {
        dinoImg.classList.remove(`pulling-${team}`);
        container.classList.remove('shake');
      }, 600);

      // Dino B (Purple) is on LEFT -> pulls towards 0%
      // Dino A (Green) is on RIGHT -> pulls towards 100%
      if (team === 'b') {
        ropePosition -= 5;
      } else {
        ropePosition += 5;
      }
      
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
    // A يمين (+20%), B يسار (-20%)
    dinoB.style.left = `calc(${ropePosition}% - 20% - 70px)`;
    dinoA.style.left = `calc(${ropePosition}% + 20% - 70px)`;

    dinoA.setAttribute('data-name', 'Dino A');
    dinoB.setAttribute('data-name', 'Dino B');

    const dinoImgA = dinoA.querySelector('.dino-img');
    const dinoImgB = dinoB.querySelector('.dino-img');
    dinoImgA.style.transform = 'scaleX(1)';  // A on right → faces left (towards B)
    dinoImgB.style.transform = 'scaleX(-1)'; // B on left → faces right (towards A)

    // A يمين يفوز بسحب يمين
    const scaleA = 1 + (ropePosition - 50) / 150;
    const scaleB = 1 + (50 - ropePosition) / 150;
    dinoA.style.transform = `scale(${Math.max(0.8, scaleA)})`;
    dinoB.style.transform = `scale(${Math.max(0.8, scaleB)})`;
  }

  function checkWin() {
    // يحتاج الفريق لـ 5 إجابات (5 * 5% = 25% إزاحة)
    // البداية 50%، الفوز عند 25% لليسار أو 75% لليمين
    if (ropePosition <= 25) {
      showVictory('Dino B');
    } else if (ropePosition >= 75) {
      showVictory('Dino A');
    }
  }

  function showVictory(teamName) {
    const overlay = document.getElementById('victory-overlay');
    const winnerDisplay = document.getElementById('winner-name');
    if (overlay && winnerDisplay) {
      winnerDisplay.textContent = teamName;
      winnerDisplay.style.color = teamName === 'Dino A' ? '#16a34a' : '#a855f7';
      overlay.style.display = 'flex';
    }
  }

  if (restartBtn) restartBtn.onclick = () => location.reload();
  if (playAgainBtn) playAgainBtn.onclick = () => location.reload();

  // Init page-level quick tools widget
  const _qtT = document.getElementById('qtToggle_dinoEn');
  const _qtM = document.getElementById('qtMenu_dinoEn');
  if (_qtT && _qtM && window.initQtWidget) window.initQtWidget(_qtT, _qtM);


})();
