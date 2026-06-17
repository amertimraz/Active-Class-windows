/* uniform Fisher-Yates shuffle (replaces biased Array.sort random comparator) */
function __acShuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;}return a;}
(function(){
const COLORS = ['#1d4ed8', '#be123c', '#16a34a', '#f59e0b', '#7c3aed', '#0ea5e9'];

const SETTINGS_KEY = 'duckRaceSettings';

function showScreen(screenName) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  const screen = document.getElementById(`${screenName}-screen`);
  if (screen) {
    screen.classList.add('active');
  }
}

const state = {
  players: [],
  mode: 'math',
  topic: '',
  operations: ['add', 'sub'],
  level: 'easy',
  targetScore: 15,
  isRunning: false,
  gameLoopId: null,
  topicQueues: {}
};

const englishTopicsData = {
  'Fruits': { icon: '🍎', data: [{ q: '🍎', a: 'Apple' }, { q: '🍌', a: 'Banana' }, { q: '🍊', a: 'Orange' }, { q: '🥭', a: 'Mango' }, { q: '🍇', a: 'Grapes' }, { q: '🍓', a: 'Strawberry' }, { q: '🍍', a: 'Pineapple' }, { q: '🍉', a: 'Watermelon' }, { q: '🍒', a: 'Cherry' }, { q: '🥝', a: 'Kiwi' }, { q: '🍑', a: 'Peach' }, { q: '🍐', a: 'Pear' }, { q: '🍋', a: 'Lemon' }, { q: '🍈', a: 'Melon' }, { q: '🥥', a: 'Coconut' }, { q: '🥑', a: 'Avocado' }, { q: '🍅', a: 'Tomato' }, { q: '🫐', a: 'Blueberry' }, { q: '🌽', a: 'Corn' }, { q: '🥜', a: 'Peanut' }, { q: '🫒', a: 'Olive' }, { q: '🥦', a: 'Broccoli' }, { q: '🥕', a: 'Carrot' }] },
  'Vehicles': { icon: '🚗', data: [{ q: '🚗', a: 'Car' }, { q: '🚌', a: 'Bus' }, { q: '🚆', a: 'Train' }, { q: '✈️', a: 'Plane' }, { q: '🚲', a: 'Bike' }, { q: '🚢', a: 'Ship' }, { q: '🚚', a: 'Truck' }, { q: '🚁', a: 'Helicopter' }, { q: '🏍️', a: 'Motorcycle' }, { q: '⛵', a: 'Boat' }, { q: '🚑', a: 'Ambulance' }, { q: '🚓', a: 'Police Car' }, { q: '🚒', a: 'Fire Truck' }, { q: '🚜', a: 'Tractor' }, { q: '🚀', a: 'Rocket' }, { q: '🛶', a: 'Canoe' }, { q: '🛴', a: 'Scooter' }, { q: '🛸', a: 'UFO' }, { q: '🚂', a: 'Steam Engine' }, { q: '🚇', a: 'Metro' }] },
  'Verbs': { icon: '🏃', data: [{ q: '🏃', a: 'Run' }, { q: '🚶', a: 'Walk' }, { q: '🦘', a: 'Jump' }, { q: '📖', a: 'Read' }, { q: '✍️', a: 'Write' }, { q: '🍴', a: 'Eat' }, { q: '🥤', a: 'Drink' }, { q: '😴', a: 'Sleep' }, { q: '🎮', a: 'Play' }, { q: '🎤', a: 'Sing' }, { q: '💃', a: 'Dance' }, { q: '🏊', a: 'Swim' }, { q: '🧗', a: 'Climb' }, { q: '🚴', a: 'Ride' }, { q: '🧹', a: 'Clean' }, { q: '🍳', a: 'Cook' }, { q: '🎨', a: 'Paint' }, { q: '📸', a: 'Take Photo' }, { q: '💡', a: 'Think' }, { q: '🗣️', a: 'Talk' }, { q: '👂', a: 'Listen' }, { q: '🔍', a: 'Look' }, { q: '🚪', a: 'Open' }] },
  'Adjectives': { icon: '🌟', data: [{ q: '🐘', a: 'Big' }, { q: '🐜', a: 'Small' }, { q: '🐆', a: 'Fast' }, { q: '🐢', a: 'Slow' }, { q: '😊', a: 'Happy' }, { q: '😢', a: 'Sad' }, { q: '🔥', a: 'Hot' }, { q: '❄️', a: 'Cold' }, { q: '👍', a: 'Good' }, { q: '👎', a: 'Bad' }, { q: '🦁', a: 'Strong' }, { q: '🐭', a: 'Weak' }, { q: '💡', a: 'Bright' }, { q: '🌑', a: 'Dark' }, { q: '💎', a: 'Hard' }, { q: '☁️', a: 'Soft' }, { q: '🧴', a: 'Clean' }, { q: '💩', a: 'Dirty' }, { q: '📏', a: 'Long' }, { q: '🤏', a: 'Short' }, { q: '💰', a: 'Rich' }, { q: '📉', a: 'Poor' }] },
  'Sports': { icon: '⚽', data: [{ q: '⚽', a: 'Football' }, { q: '🏀', a: 'Basketball' }, { q: '🎾', a: 'Tennis' }, { q: '🏊', a: 'Swimming' }, { q: '🏃', a: 'Running' }, { q: '🚴', a: 'Cycling' }, { q: '🥊', a: 'Boxing' }, { q: '⛳', a: 'Golf' }, { q: '⚾', a: 'Baseball' }, { q: '🥋', a: 'Karate' }, { q: '🏐', a: 'Volleyball' }, { q: '🏹', a: 'Archery' }, { q: '🏓', a: 'Ping Pong' }, { q: ' skating', a: 'Skating' }, { q: ' surfing', a: 'Surfing' }, { q: ' Weightlifting', a: 'Weightlifting' }, { q: '♟️', a: 'Chess' }] },
  'Food & Drink': { icon: '🍔', data: [{ q: '🍞', a: 'Bread' }, { q: '🍚', a: 'Rice' }, { q: '🥛', a: 'Milk' }, { q: '💧', a: 'Water' }, { q: '🧃', a: 'Juice' }, { q: '🍕', a: 'Pizza' }, { q: '🍔', a: 'Burger' }, { q: '🥚', a: 'Egg' }, { q: '🧀', a: 'Cheese' }, { q: '🥗', a: 'Salad' }, { q: '🍦', a: 'Ice Cream' }, { q: '🍰', a: 'Cake' }, { q: '🍫', a: 'Chocolate' }, { q: '🍯', a: 'Honey' }, { q: '🍗', a: 'Chicken' }, { q: '🥩', a: 'Meat' }, { q: '🐟', a: 'Fish' }, { q: '🍟', a: 'Fries' }, { q: '🥪', a: 'Sandwich' }, { q: '🥨', a: 'Pretzel' }, { q: ' popcorn', a: 'Popcorn' }] },
  'Body Parts': { icon: '👂', data: [{ q: '🧒', a: 'Head' }, { q: '👁️', a: 'Eye' }, { q: '👂', a: 'Ear' }, { q: '👃', a: 'Nose' }, { q: '👄', a: 'Mouth' }, { q: '✋', a: 'Hand' }, { q: '👣', a: 'Foot' }, { q: '🦵', a: 'Leg' }, { q: '💪', a: 'Arm' }, { q: '🦴', a: 'Shoulder' }, { q: '🦷', a: 'Tooth' }, { q: '👅', a: 'Tongue' }, { q: '🖐️', a: 'Finger' }, { q: '🧔', a: 'Beard' }, { q: '💇', a: 'Hair' }, { q: '🧠', a: 'Brain' }, { q: '❤️', a: 'Heart' }, { q: '🦴', a: 'Bone' }] },
  'Animals': { icon: '🦁', data: [{ q: '🦁', a: 'Lion' }, { q: '🐯', a: 'Tiger' }, { q: '🐘', a: 'Elephant' }, { q: '🦒', a: 'Giraffe' }, { q: '🦓', a: 'Zebra' }, { q: '🐒', a: 'Monkey' }, { q: '🐱', a: 'Cat' }, { q: '🐶', a: 'Dog' }, { q: '🐰', a: 'Rabbit' }, { q: '🐦', a: 'Bird' }, { q: '🐍', a: 'Snake' }, { q: '🐢', a: 'Turtle' }, { q: '🐊', a: 'Crocodile' }, { q: '🐸', a: 'Frog' }, { q: '🐬', a: 'Dolphin' }, { q: '🐳', a: 'Whale' }, { q: '🦈', a: 'Shark' }, { q: '🐙', a: 'Octopus' }, { q: '🦋', a: 'Butterfly' }, { q: '🐝', a: 'Bee' }, { q: '🐜', a: 'Ant' }, { q: '🕷️', a: 'Spider' }, { q: '🐧', a: 'Penguin' }, { q: '🦘', a: 'Kangaroo' }, { q: '🐼', a: 'Panda' }] },
  'Family': { icon: '👨‍👩‍👦', data: [{ q: '👨', a: 'Father' }, { q: '👩', a: 'Mother' }, { q: '👦', a: 'Brother' }, { q: '👧', a: 'Sister' }, { q: '👴', a: 'Grandfather' }, { q: '👵', a: 'Grandmother' }, { q: '👨‍🦱', a: 'Uncle' }, { q: '👩‍🦱', a: 'Aunt' }, { q: '🧒', a: 'Cousin' }, { q: '👶', a: 'Baby' }, { q: '👰', a: 'Bride' }, { q: '🤵', a: 'Groom' }, { q: '👫', a: 'Friends' }, { q: '🏠', a: 'Family' }] },
  'Colours': { icon: '🎨', data: [{ q: '🔴', a: 'Red' }, { q: '🔵', a: 'Blue' }, { q: '🟢', a: 'Green' }, { q: '🟡', a: 'Yellow' }, { q: '🟠', a: 'Orange' }, { q: '🟣', a: 'Purple' }, { q: '💗', a: 'Pink' }, { q: '⚫', a: 'Black' }, { q: '⚪', a: 'White' }, { q: '🟤', a: 'Brown' }, { q: '🥈', a: 'Silver' }, { q: '🥇', a: 'Gold' }, { q: '🌈', a: 'Rainbow' }] },
  'Nature': { icon: '🌲', data: [{ q: '☀️', a: 'Sun' }, { q: '🌙', a: 'Moon' }, { q: '⭐', a: 'Star' }, { q: '🌳', a: 'Tree' }, { q: '🌸', a: 'Flower' }, { q: '🏞️', a: 'River' }, { q: '⛰️', a: 'Mountain' }, { q: '🌊', a: 'Sea' }, { q: '🌧️', a: 'Rain' }, { q: '☁️', a: 'Cloud' }, { q: '⚡', a: 'Lightning' }, { q: '❄️', a: 'Snow' }, { q: '🌬️', a: 'Wind' }, { q: '🌋', a: 'Volcano' }, { q: '🌵', a: 'Cactus' }, { q: '🌴', a: 'Palm Tree' }, { q: '🍂', a: 'Leaf' }, { q: '🔥', a: 'Fire' }] },
  'Places': { icon: '🏫', data: [{ q: '🏫', a: 'School' }, { q: '🏥', a: 'Hospital' }, { q: '🌳', a: 'Park' }, { q: '🛒', a: 'Market' }, { q: '🏠', a: 'House' }, { q: '🏙️', a: 'City' }, { q: '🏖️', a: 'Beach' }, { q: '🌲', a: 'Forest' }, { q: '📚', a: 'Library' }, { q: '🦁', a: 'Zoo' }, { q: '🏦', a: 'Bank' }, { q: '🎬', a: 'Cinema' }, { q: '🕌', a: 'Mosque' }, { q: '⛪', a: 'Church' }, { q: '🏪', a: 'Shop' }, { q: '🏟️', a: 'Stadium' }, { q: '🏝️', a: 'Island' }, { q: '🏔️', a: 'Mountains' }] },
  'Occupations': { icon: '👮', data: [{ q: '👨‍🏫', a: 'Teacher' }, { q: '👨‍⚕️', a: 'Doctor' }, { q: '👷', a: 'Engineer' }, { q: '👨‍✈️', a: 'Pilot' }, { q: '👨‍🍳', a: 'Chef' }, { q: '👨‍🌾', a: 'Farmer' }, { q: '👮', a: 'Police' }, { q: '👨‍🚒', a: 'Firefighter' }, { q: '👩‍⚕️', a: 'Nurse' }, { q: '🎨', a: 'Artist' }, { q: '🚀', a: 'Astronaut' }, { q: '⚖️', a: 'Judge' }, { q: '📸', a: 'Photographer' }, { q: '🎤', a: 'Singer' }, { q: '⚽', a: 'Player' }, { q: '💻', a: 'Programmer' }, { q: '🦷', a: 'Dentist' }] },
  'Common Nouns': { icon: '📚', data: [{ q: '📖', a: 'Book' }, { q: '🖊️', a: 'Pen' }, { q: '🪑', a: 'Table' }, { q: '🪑', a: 'Chair' }, { q: '🚪', a: 'Door' }, { q: '🪟', a: 'Window' }, { q: '📱', a: 'Phone' }, { q: '💻', a: 'Computer' }, { q: '👜', a: 'Bag' }, { q: '💡', a: 'Lamp' }] },
  'Numbers 1-20': { type: 'range', min: 1, max: 20 },
  'Numbers 1-100': { type: 'range', min: 1, max: 100 }
};

const arabicTopicsData = {
  'الفواكه': { icon: '🍎', data: [{ q: '🍎', a: 'تفاح' }, { q: '🍌', a: 'موز' }, { q: '🍊', a: 'برتقال' }, { q: '🥭', a: 'مانجو' }, { q: '🍇', a: 'عنب' }, { q: '🍓', a: 'فراولة' }, { q: '🍍', a: 'أناناس' }, { q: '🍉', a: 'بطيخ' }, { q: '🍒', a: 'كرز' }, { q: '🥝', a: 'كيوي' }, { q: '🍑', a: 'خوخ' }, { q: '🍐', a: 'كمثرى' }, { q: '🍋', a: 'ليمون' }, { q: '🍈', a: 'شمام' }, { q: '🥥', a: 'جوز هند' }, { q: '🥑', a: 'أفوكادو' }, { q: '🍅', a: 'طماطم' }, { q: '🫐', a: 'توت' }, { q: '🌽', a: 'ذرة' }, { q: '🥜', a: 'فول سوداني' }, { q: '🫒', a: 'زيتون' }, { q: '🥦', a: 'بروكلي' }, { q: '🥕', a: 'جزر' }] },
  'وسائل النقل': { icon: '🚗', data: [{ q: '🚗', a: 'سيارة' }, { q: '🚌', a: 'حافلة' }, { q: '🚆', a: 'قطار' }, { q: '✈️', a: 'طائرة' }, { q: '🚲', a: 'دراجة' }, { q: '🚢', a: 'سفينة' }, { q: '🚚', a: 'شاحنة' }, { q: ' helicopter', a: 'مروحية' }, { q: ' motorcycle', a: 'دراجة نارية' }, { q: '⛵', a: 'قارب' }, { q: ' ambulance', a: 'إسعاف' }, { q: ' police', a: 'سيارة شرطة' }, { q: ' fire', a: 'إطفاء' }, { q: ' tractor', a: 'جرار' }, { q: '🚀', a: 'صاروخ' }, { q: ' canoe', a: 'قارب صغير' }, { q: ' scooter', a: 'سكوتر' }, { q: ' UFO', a: 'طبق طائر' }, { q: ' steam', a: 'قطار قديم' }, { q: ' metro', a: 'مترو' }] },
  'الأفعال': { icon: '🏃', data: [{ q: '🏃', a: 'يجري' }, { q: '🚶', a: 'يمشي' }, { q: '🦘', a: 'يقفز' }, { q: '📖', a: 'يقرأ' }, { q: '✍️', a: 'يكتب' }, { q: '🍴', a: 'يأكل' }, { q: '🥤', a: 'يشرب' }, { q: '😴', a: 'ينام' }, { q: '🎮', a: 'يلعب' }, { q: '🎤', a: 'يغني' }, { q: '💃', a: 'يرقص' }, { q: '🏊', a: 'يسبح' }, { q: ' climb', a: 'يتسلق' }, { q: ' ride', a: 'يركب' }, { q: ' clean', a: 'ينظف' }, { q: ' cook', a: 'يطبخ' }, { q: ' paint', a: 'يرسم' }, { q: ' photo', a: 'يصور' }, { q: ' think', a: 'يفكر' }, { q: ' talk', a: 'يتحدث' }, { q: ' listen', a: 'يسمع' }, { q: ' look', a: 'يبحث' }, { q: ' open', a: 'يفتح' }] },
  'الصفات': { icon: '🌟', data: [{ q: '🐘', a: 'كبير' }, { q: '🐜', a: 'صغير' }, { q: '🐆', a: 'سريع' }, { q: '🐢', a: 'بطيء' }, { q: '😊', a: 'سعيد' }, { q: '😢', a: 'حزين' }, { q: '🔥', a: 'حار' }, { q: '❄️', a: 'بارد' }, { q: '👍', a: 'جيد' }, { q: '👎', a: 'سيء' }, { q: ' strong', a: 'قوي' }, { q: ' weak', a: 'ضعيف' }, { q: ' bright', a: 'مضيء' }, { q: ' dark', a: 'مظلم' }, { q: ' hard', a: 'صلب' }, { q: ' soft', a: 'ناعم' }, { q: ' clean', a: 'نظيف' }, { q: ' dirty', a: 'متسخ' }, { q: ' long', a: 'طويل' }, { q: ' short', a: 'قصير' }, { q: ' rich', a: 'غني' }, { q: ' poor', a: 'فقير' }] },
  'الرياضة': { icon: '⚽', data: [{ q: '⚽', a: 'كرة قدم' }, { q: '🏀', a: 'كرة سلة' }, { q: '🎾', a: 'تنس' }, { q: '🏊', a: 'سباحة' }, { q: '🏃', a: 'جري' }, { q: '🚴', a: 'ركوب دراجات' }, { q: '🥊', a: 'ملاكمة' }, { q: '⛳', a: 'غولف' }, { q: '⚾', a: 'بيسبول' }, { q: '🥋', a: 'كاراتيه' }, { q: ' volleyball', a: 'كرة طائرة' }, { q: ' archery', a: 'رماية' }, { q: ' pingpong', a: 'تنس طاولة' }, { q: ' skating', a: 'تزلج' }, { q: ' surfing', a: 'ركوب أمواج' }, { q: ' weights', a: 'رفع أثقال' }, { q: ' chess', a: 'شطرنج' }] },
  'الطعام والشراب': { icon: '🍔', data: [{ q: '🍞', a: 'خبز' }, { q: '🍚', a: 'أرز' }, { q: '🥛', a: 'حليب' }, { q: '💧', a: 'ماء' }, { q: '🧃', a: 'عصير' }, { q: '🍕', a: 'بيتزا' }, { q: '🍔', a: 'برجر' }, { q: '🥚', a: 'بيض' }, { q: '🧀', a: 'جبن' }, { q: '🥗', a: 'سلطة' }, { q: ' ice cream', a: 'آيس كريم' }, { q: ' cake', a: 'كيك' }, { q: ' chocolate', a: 'شوكولاتة' }, { q: ' honey', a: 'عسل' }, { q: ' chicken', a: 'دجاج' }, { q: ' meat', a: 'لحم' }, { q: ' fish', a: 'سمك' }, { q: ' fries', a: 'بطاطس' }, { q: ' sandwich', a: 'ساندوتش' }, { q: ' pretzel', a: 'بسكويت' }, { q: ' popcorn', a: 'فشار' }] },
  'أعضاء الجسم': { icon: '👂', data: [{ q: '🧒', a: 'رأس' }, { q: '👁️', a: 'عين' }, { q: '👂', a: 'أذن' }, { q: '👃', a: 'أنف' }, { q: '👄', a: 'فم' }, { q: '✋', a: 'يد' }, { q: '👣', a: 'قدم' }, { q: '🦵', a: 'رجل' }, { q: '💪', a: 'ذراع' }, { q: '🦴', a: 'كتف' }, { q: ' tooth', a: 'سن' }, { q: ' tongue', a: 'لسان' }, { q: ' finger', a: 'إصبع' }, { q: ' beard', a: 'لحية' }, { q: ' hair', a: 'شعر' }, { q: ' brain', a: 'عقل' }, { q: ' heart', a: 'قلب' }, { q: ' bone', a: 'عظم' }] },
  'الحيوانات': { icon: '🦁', data: [{ q: '🦁', a: 'أسد' }, { q: '🐯', a: 'نمر' }, { q: '🐘', a: 'فيل' }, { q: '🦒', a: 'زرافة' }, { q: '🦓', a: 'حمار وحشي' }, { q: '🐒', a: 'قرد' }, { q: '🐱', a: 'قطة' }, { q: '🐶', a: 'كلب' }, { q: '🐰', a: 'أرنب' }, { q: '🐦', a: 'عصفور' }, { q: ' snake', a: 'ثعبان' }, { q: ' turtle', a: 'سلحفاة' }, { q: ' crocodile', a: 'تمساح' }, { q: ' frog', a: 'ضفدع' }, { q: ' dolphin', a: 'دلفين' }, { q: ' whale', a: 'حوت' }, { q: ' shark', a: 'قرش' }, { q: ' octopus', a: 'أخطبوط' }, { q: ' butterfly', a: 'فراشة' }, { q: ' bee', a: 'نحلة' }, { q: ' ant', a: 'نملة' }, { q: ' spider', a: 'عنكبوت' }, { q: ' penguin', a: 'بطريق' }, { q: ' kangaroo', a: 'كنغر' }, { q: ' panda', a: 'باندا' }] },
  'العائلة': { icon: '👨‍👩‍👦', data: [{ q: '👨', a: 'أب' }, { q: '👩', a: 'أم' }, { q: '👦', a: 'أخ' }, { q: '👧', a: 'أخت' }, { q: '👴', a: 'جد' }, { q: '👵', a: 'جدة' }, { q: '👨‍🦱', a: 'عم' }, { q: '👩‍🦱', a: 'عمة' }, { q: '🧒', a: 'ابن عم' }, { q: '👶', a: 'طفل' }, { q: ' bride', a: 'عروس' }, { q: ' groom', a: 'عريس' }, { q: ' friends', a: 'أصدقاء' }, { q: ' family', a: 'عائلة' }] },
  'المهن': { icon: '👮', data: [{ q: '👨‍🏫', a: 'معلم' }, { q: '👨‍⚕️', a: 'طبيب' }, { q: '👷', a: 'مهندس' }, { q: '👨‍✈️', a: 'طيار' }, { q: '👨‍🍳', a: 'طباخ' }, { q: '👨‍🌾', a: 'فلاح' }, { q: '👮', a: 'شرطي' }, { q: '👨‍🚒', a: 'إطفائي' }, { q: '👩‍⚕️', a: 'ممرضة' }, { q: '🎨', a: 'فنان' }, { q: ' astronaut', a: 'رائد فضاء' }, { q: ' judge', a: 'قاضي' }, { q: ' photographer', a: 'مصور' }, { q: ' singer', a: 'مغني' }, { q: ' player', a: 'لاعب' }, { q: ' computer', a: 'مبرمج' }, { q: ' dentist', a: 'طبيب أسنان' }] },
  'الطبيعة': { icon: '🌲', data: [{ q: '☀️', a: 'شمس' }, { q: '🌙', a: 'قمر' }, { q: '⭐', a: 'نجمة' }, { q: '🌳', a: 'شجرة' }, { q: '🌸', a: 'زهرة' }, { q: '🏞️', a: 'نهر' }, { q: '⛰️', a: 'جبل' }, { q: '🌊', a: 'بحر' }, { q: '🌧️', a: 'مطر' }, { q: '☁️', a: 'سحاب' }, { q: ' lightning', a: 'برق' }, { q: ' snow', a: 'ثلج' }, { q: ' wind', a: 'رياح' }, { q: ' volcano', a: 'بركان' }, { q: ' cactus', a: 'صبار' }, { q: ' palm', a: 'نخلة' }, { q: ' leaf', a: 'ورقة شجر' }, { q: ' fire', a: 'نار' }] },
  'الأماكن': { icon: '🏫', data: [{ q: '🏫', a: 'مدرسة' }, { q: '🏥', a: 'مستشفى' }, { q: '🌳', a: 'حديقة' }, { q: '🛒', a: 'سوق' }, { q: '🏠', a: 'منزل' }, { q: '🏙️', a: 'مدينة' }, { q: '🏖️', a: 'شاطئ' }, { q: '🌲', a: 'غابة' }, { q: '📚', a: 'مكتبة' }, { q: '🦁', a: 'حديقة حيوان' }, { q: ' bank', a: 'بنك' }, { q: ' cinema', a: 'سينما' }, { q: ' mosque', a: 'مسجد' }, { q: ' church', a: 'كنيسة' }, { q: ' shop', a: 'محل' }, { q: ' stadium', a: 'ملعب' }, { q: ' island', a: 'جزيرة' }, { q: ' mountains', a: 'جبال' }] },
  'الألوان': { icon: '🎨', data: [{ q: '🔴', a: 'أحمر' }, { q: '🔵', a: 'أزرق' }, { q: '🟢', a: 'أخضر' }, { q: '🟡', a: 'أصفر' }, { q: '🟠', a: 'برتقالي' }, { q: '🟣', a: 'بنفسجي' }, { q: '💗', a: 'وردي' }, { q: '⚫', a: 'أسود' }, { q: '⚪', a: 'أبيض' }, { q: '🟤', a: 'بني' }, { q: ' silver', a: 'فضي' }, { q: ' gold', a: 'ذهبي' }, { q: ' rainbow', a: 'قوس قزح' }] },
  'أسماء شائعة': { icon: '📚', data: [{ q: '📖', a: 'كتاب' }, { q: '🖊️', a: 'قلم' }, { q: '🖼️', a: 'لوحة' }, { q: '🪑', a: 'كرسي' }, { q: '🚪', a: 'باب' }, { q: '🪟', a: 'نافذة' }, { q: '📱', a: 'هاتف' }, { q: '💻', a: 'حاسوب' }, { q: '👜', a: 'حقيبة' }, { q: '💡', a: 'مصباح' }] },
  'الأرقام 1-20': { type: 'range', min: 1, max: 20 },
  'الأرقام 1-100': { type: 'range', min: 1, max: 100 }
};

function numberToWords(n) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (n === 100) return 'One Hundred';
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? '-' + ones[n % 10] : '');
}

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

const elements = {
  root: document.querySelector('.duck-race'),
  setupSection: document.getElementById('setupSection'),
  settingsModal: document.getElementById('settingsModal'),
  openSettings: document.getElementById('openSettings'),
  closeSettings: document.getElementById('closeSettings'),
  saveSettings: document.getElementById('saveSettings'),
  cancelSettings: document.getElementById('cancelSettings'),
  fullscreenToggle: document.getElementById('fullscreenToggle'),
  playersIndicator: document.getElementById('playersIndicator'),
  gameSection: document.getElementById('gameSection'),
  playerCount: document.getElementById('playerCount'),
  levelSelect: document.getElementById('levelSelect'),
  targetScore: document.getElementById('targetScore'),
  modeSelect: document.getElementById('modeSelect'),
  topicCard: document.getElementById('topicCard'),
  topicSelect: document.getElementById('topicSelect'),
  mathOpsCard: document.getElementById('mathOpsCard'),
  opChecks: Array.from(document.querySelectorAll('.op-check')),
  playerNames: document.getElementById('playerNames'),
  startRace: document.getElementById('startRace'),
  countdownOverlay: document.getElementById('countdownOverlay'),
  countdownNumber: document.getElementById('countdownNumber'),
  lanes: document.getElementById('lanes'),
  panels: document.getElementById('playerPanels'),
  raceTrack: document.getElementById('raceTrack'),
  restartRace: document.getElementById('restartRace'),
  backToSetup: document.getElementById('backToSetup'),
  winnerModal: document.getElementById('winnerModal'),
  winnerTitle: document.getElementById('winnerTitle'),
  winnerSubtitle: document.getElementById('winnerSubtitle'),
  playAgain: document.getElementById('playAgain'),
  closeWinner: document.getElementById('closeWinner')
};

const englishTopicsList = ['Fruits', 'Vehicles', 'Verbs', 'Adjectives', 'Sports', 'Food & Drink', 'Body Parts', 'Animals', 'Family', 'Colours', 'Nature', 'Places', 'Occupations', 'Common Nouns', 'Numbers 1-20', 'Numbers 1-100'];
const arabicTopicsList = ['الفواكه', 'وسائل النقل', 'الأفعال', 'الصفات', 'الرياضة', 'الطعام والشراب', 'أعضاء الجسم', 'الحيوانات', 'العائلة', 'المهن', 'الطبيعة', 'الأماكن', 'الألوان', 'أسماء شائعة', 'الأرقام 1-20', 'الأرقام 1-100'];

function updateTopicOptions() {
  const mode = elements.modeSelect.value;
  if (mode === 'math') {
    if (elements.topicCard) elements.topicCard.style.display = 'none';
    if (elements.mathOpsCard) elements.mathOpsCard.style.display = 'block';
  } else {
    if (elements.topicCard) elements.topicCard.style.display = 'block';
    if (elements.mathOpsCard) elements.mathOpsCard.style.display = 'none';
    if (elements.topicSelect) {
      elements.topicSelect.innerHTML = '';
      const topics = mode === 'english' ? englishTopicsList : arabicTopicsList;
      topics.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        elements.topicSelect.appendChild(opt);
      });
    }
  }
}

function updatePlayersIndicator(count) {
  if (!elements.playersIndicator) return;
  const ducks = Array.from({ length: count }, () => '🦆').join('');
  elements.playersIndicator.textContent = `عدد اللاعبين ${count} ${ducks}`;
}

function openSettingsModal() {
  if (elements.settingsModal) {
    loadSettings();
    elements.settingsModal.style.display = 'flex';
  }
}

function closeSettingsModal() {
  if (elements.settingsModal) {
    elements.settingsModal.style.display = 'none';
  }
}

function setLanding(active) {
  if (!elements.root) return;
  elements.root.classList.toggle('is-landing', active);
  elements.root.classList.toggle('is-running', !active);
}

function handleStartButtonClick() {
  showScreen('setup');
  updateTopicOptions();
  loadSettings();
}

function createNameInputs(count, names = []) {
  elements.playerNames.innerHTML = '';
  const title = document.createElement('div');
  title.textContent = 'أسماء اللاعبين';
  title.className = 'players-title';
  title.style.gridColumn = '1 / -1';
  elements.playerNames.appendChild(title);
  for (let i = 0; i < count; i += 1) {
    const wrap = document.createElement('div');
    wrap.className = 'name-input';
    const label = document.createElement('label');
    label.textContent = `لاعب ${i + 1}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = names[i] || `لاعب ${i + 1}`;
    input.dataset.index = i.toString();
    wrap.appendChild(label);
    wrap.appendChild(input);
    elements.playerNames.appendChild(wrap);
  }
  updatePlayersIndicator(count);
}

function getOperations() {
  const selected = elements.opChecks.filter((check) => check.checked).map((check) => check.value);
  return selected.length > 0 ? selected : ['add'];
}

function getDefaultSettings() {
  return {
    players: ['لاعب 1', 'لاعب 2'],
    level: 'easy',
    targetScore: 15,
    operations: ['add', 'sub']
  };
}

function getStoredSettings() {
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch (error) {
    return null;
  }
}

function getSettingsFromInputs() {
  const count = Math.min(Math.max(parseInt(elements.playerCount.value, 10) || 2, 2), 6);
  const names = Array.from(elements.playerNames.querySelectorAll('input')).map((input, index) => {
    return input.value.trim() || `لاعب ${index + 1}`;
  });
  return {
    players: names.slice(0, count),
    level: elements.levelSelect.value,
    targetScore: parseInt(elements.targetScore.value, 10) || 15,
    mode: elements.modeSelect.value,
    topic: elements.topicSelect.value,
    operations: getOperations()
  };
}

function applySettingsToInputs(settings) {
  const count = Math.min(Math.max(settings.players?.length || 2, 2), 6);
  if (elements.playerCount) elements.playerCount.value = count;
  if (elements.levelSelect) elements.levelSelect.value = settings.level || 'easy';
  if (elements.targetScore) elements.targetScore.value = settings.targetScore || 15;
  if (elements.modeSelect) {
    elements.modeSelect.value = settings.mode || 'math';
    updateTopicOptions();
  }
  if (elements.topicSelect && settings.topic) elements.topicSelect.value = settings.topic;
  elements.opChecks.forEach((check) => {
    check.checked = settings.operations?.includes(check.value);
  });
  createNameInputs(count, settings.players || []);
}

function saveSettings() {
  const settings = getSettingsFromInputs();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  updatePlayersIndicator(settings.players.length);
  closeSettingsModal();
  return settings;
}

function loadSettings() {
  const settings = getStoredSettings() || getDefaultSettings();
  state.level = settings.level || 'easy';
  state.targetScore = settings.targetScore || 15;
  state.operations = settings.operations || ['add'];
  state.mode = settings.mode || 'math';
  state.topic = settings.topic || '';
  applySettingsToInputs(settings);
  updatePlayersIndicator(settings.players.length);
  return settings;
}

function createPlayers(settings) {
  const names = settings?.players || [];
  const count = Math.min(Math.max(names.length || 2, 2), 6);
  
  const spriteIndices = __acShuffle([0, 1, 2, 3, 4]);
  
  state.players = Array.from({ length: count }, (_, index) => {
    const name = names[index]?.trim() || `لاعب ${index + 1}`;
    return {
      id: index,
      name,
      score: 0,
      passiveScore: 0,
      randomSpeed: 0.003 + Math.random() * 0.004,
      spriteIndex: spriteIndices[index % spriteIndices.length],
      question: null,
      input: '',
      choices: []
    };
  });
  updatePlayersIndicator(count);
}

function getRange(level) {
  if (level === 'easy') return { add: [1, 15], sub: [1, 15], mul: [1, 6], div: [1, 6] };
  if (level === 'medium') return { add: [5, 40], sub: [5, 40], mul: [2, 10], div: [2, 10] };
  return { add: [10, 99], sub: [10, 99], mul: [3, 12], div: [2, 12] };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildQuestion(level, operations, mode, topic) {
  if (mode === 'math') {
    const op = operations[randomInt(0, operations.length - 1)];
    const range = getRange(level)[op];
    const a = randomInt(range[0], range[1]);
    const b = randomInt(range[0], range[1]);

    if (op === 'add') return { text: `${a} + ${b} =`, answer: a + b };
    if (op === 'sub') {
      const bigger = Math.max(a, b);
      const smaller = Math.min(a, b);
      return { text: `${bigger} - ${smaller} =`, answer: bigger - smaller };
    }
    if (op === 'mul') return { text: `${a} × ${b} =`, answer: a * b };
    const divisor = b === 0 ? 1 : b;
    const quotient = randomInt(range[0], range[1]);
    const dividend = divisor * quotient;
    return { text: `${dividend} ÷ ${divisor} =`, answer: quotient };
  } else {
    const dataSet = mode === 'english' ? englishTopicsData : arabicTopicsData;
    let topicToUse = topic;
    const data = dataSet[topicToUse];
    
    if (!state.topicQueues[topicToUse]) state.topicQueues[topicToUse] = [];
    
    if (state.topicQueues[topicToUse].length === 0) {
      if (data.type === 'range') {
        for (let i = data.min; i <= data.max; i++) state.topicQueues[topicToUse].push(i);
      } else {
        state.topicQueues[topicToUse] = [...data.data];
      }
      state.__acShuffle(topicQueues[topicToUse]);
    }

    const currentItem = state.topicQueues[topicToUse].pop();
    let qText = '';
    let correctAnswer = '';
    let choices = [];

    if (data.type === 'range') {
      qText = currentItem.toString();
      correctAnswer = mode === 'english' ? numberToWords(currentItem) : numberToWordsArabic(currentItem);
      choices = [correctAnswer];
      while (choices.length < 4) {
        const r = Math.floor(Math.random() * (data.max - data.min + 1)) + data.min;
        const w = mode === 'english' ? numberToWords(r) : numberToWordsArabic(r);
        if (!choices.includes(w)) choices.push(w);
      }
    } else {
      qText = currentItem.q;
      correctAnswer = currentItem.a;
      choices = [correctAnswer];
      const allAnswers = data.data.map(i => i.a);
      while (choices.length < 4 && choices.length < allAnswers.length) {
        const w = allAnswers[Math.floor(Math.random() * allAnswers.length)];
        if (!choices.includes(w)) choices.push(w);
      }
    }
    __acShuffle(choices);
    return { text: qText, answer: correctAnswer, choices: choices };
  }
}

function assignQuestion(player) {
  player.question = buildQuestion(state.level, state.operations, state.mode, state.topic);
  player.choices = player.question.choices || [];
}

function updatePanelLayout() {
  const count = state.players.length;
  const gap = count <= 2 ? 36 : count <= 4 ? 24 : 16;
  elements.panels.style.gap = `${gap}px`;
}

function updatePanels() {
  elements.panels.innerHTML = '';
  updatePanelLayout();
  state.players.forEach((player, index) => {
    const panel = document.createElement('div');
    panel.className = 'player-panel';
    panel.dataset.playerId = player.id;

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.style.background = COLORS[index % COLORS.length];
    header.textContent = player.name;

    const question = document.createElement('div');
    question.className = 'panel-question';
    question.id = `q-${player.id}`;
    question.textContent = player.question.text;

    const input = document.createElement('input');
    input.className = 'panel-input';
    input.id = `i-${player.id}`;
    input.readOnly = true;
    input.value = player.input;
    if (state.mode !== 'math') input.style.display = 'none';

    const keypad = document.createElement('div');
    keypad.className = 'keypad';
    if (state.mode === 'math') {
      const keys = ['1','2','3','4','5','6','7','8','9','C','0','Go'];
      keys.forEach((key) => {
        const button = document.createElement('button');
        button.className = 'key';
        button.type = 'button';
        button.textContent = key;
        if (key === 'C') button.classList.add('action');
        if (key === 'Go') button.classList.add('submit');
        button.addEventListener('click', () => handleKey(player.id, key));
        keypad.appendChild(button);
      });
    } else {
      keypad.classList.add('choices-grid');
      player.choices.forEach(choice => {
        const button = document.createElement('button');
        button.className = 'key choice-btn';
        button.type = 'button';
        button.textContent = choice;
        button.addEventListener('click', () => submitAnswer(player, choice));
        keypad.appendChild(button);
      });
    }

    panel.appendChild(header);
    panel.appendChild(question);
    panel.appendChild(input);
    panel.appendChild(keypad);
    elements.panels.appendChild(panel);
  });
}

function updatePlayerUI(player) {
  const qEl = document.getElementById(`q-${player.id}`);
  const iEl = document.getElementById(`i-${player.id}`);
  if (qEl) qEl.textContent = player.question.text;
  if (iEl) iEl.value = player.input;
  
  if (state.mode !== 'math') {
    const panel = elements.panels.querySelector(`[data-player-id="${player.id}"]`);
    const keypad = panel.querySelector('.keypad');
    keypad.innerHTML = '';
    player.choices.forEach(choice => {
      const button = document.createElement('button');
      button.className = 'key choice-btn';
      button.type = 'button';
      button.textContent = choice;
      button.addEventListener('click', () => submitAnswer(player, choice));
      keypad.appendChild(button);
    });
  }
}

function updateLanes() {
  elements.lanes.innerHTML = '';
  state.players.forEach((player) => {
    const lane = document.createElement('div');
    lane.className = 'lane';
    lane.dataset.playerId = player.id;

    const duck = document.createElement('div');
    duck.className = 'duck';

    const duckSprite = document.createElement('div');
    duckSprite.className = 'duck-sprite';
    duckSprite.dataset.index = player.spriteIndex;

    duck.appendChild(duckSprite);

    const label = document.createElement('div');
    label.className = 'duck-label';
    label.textContent = player.name;

    lane.appendChild(duck);
    lane.appendChild(label);
    elements.lanes.appendChild(lane);
  });
  updateDuckPositions();
}

function updateDuckPositions(onlyPlayerId = null) {
  const trackWidth = elements.raceTrack.clientWidth;
  const maxOffset = trackWidth - 140;
  state.players.forEach((player) => {
    if (onlyPlayerId !== null && player.id !== onlyPlayerId) return;
    
    const lane = elements.lanes.querySelector(`[data-player-id="${player.id}"]`);
    if (!lane) return;
    const duck = lane.querySelector('.duck');
    const label = lane.querySelector('.duck-label');
    const totalScore = player.score + player.passiveScore;
    const progress = Math.min(totalScore / state.targetScore, 1);
    const offset = 16 + progress * maxOffset;
    
    if (onlyPlayerId !== null) {
      duck.classList.remove('moving');
      void duck.offsetWidth; // trigger reflow
      duck.classList.add('moving');
    }
    
    duck.style.left = `${offset}px`;
    label.style.left = `${Math.min(offset, maxOffset)}px`;
  });
}

function handleKey(playerId, key) {
  if (!state.isRunning) return;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  if (key === 'C') {
    player.input = '';
  } else if (key === 'Go') {
    submitAnswer(player);
    return;
  } else {
    player.input = `${player.input}${key}`.slice(0, 4);
  }
  updatePanelInput(player.id);
}

function updatePanelInput(playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (player) updatePlayerUI(player);
}

function submitAnswer(player, providedChoice = null) {
  let isCorrect = false;
  if (state.mode === 'math') {
    if (player.input === '') return;
    const answer = parseInt(player.input, 10);
    isCorrect = (answer === player.question.answer);
  } else {
    isCorrect = (providedChoice === player.question.answer);
  }

  const panel = elements.panels.querySelector(`[data-player-id="${player.id}"]`);
  
  if (isCorrect) {
    player.score += 1.2;
    if (panel) {
      panel.classList.add('correct');
      setTimeout(() => panel.classList.remove('correct'), 500);
    }
    if (player.score >= state.targetScore) {
      showWinner(player);
      return;
    }
    player.input = '';
    assignQuestion(player);
    updateDuckPositions(player.id);
  } else {
    player.input = '';
    if (panel) {
      panel.classList.add('wrong');
      setTimeout(() => panel.classList.remove('wrong'), 500);
    }
  }
  updatePlayerUI(player);
}

function showWinner(player) {
  state.isRunning = false;
  if (state.gameLoopId) {
    clearInterval(state.gameLoopId);
    state.gameLoopId = null;
  }
  elements.winnerTitle.textContent = `الفائز: ${player.name}`;
  elements.winnerSubtitle.textContent = `أكمل ${state.targetScore} إجابة صحيحة أولاً`;
  elements.winnerModal.style.display = 'flex';
}

function hideWinner() {
  elements.winnerModal.style.display = 'none';
}

function startCountdown() {
  if (!elements.countdownOverlay || !elements.countdownNumber) return;
  state.isRunning = false;
  if (state.gameLoopId) clearInterval(state.gameLoopId);
  
  elements.countdownOverlay.style.display = 'flex';
  let count = 3;
  elements.countdownNumber.textContent = count;
  const interval = setInterval(() => {
    count -= 1;
    if (count <= 0) {
      clearInterval(interval);
      elements.countdownOverlay.style.display = 'none';
      state.isRunning = true;
      
      // Start Passive Movement
      state.gameLoopId = setInterval(() => {
        if (!state.isRunning) return;
        state.players.forEach(p => {
          p.passiveScore += p.randomSpeed; // استخدام السرعة العشوائية الخاصة بكل لاعب
          if (p.score + p.passiveScore >= state.targetScore) {
            showWinner(p);
          }
        });
        updateDuckPositions();
      }, 100);
      
      return;
    }
    elements.countdownNumber.textContent = count;
  }, 1000);
}

function startRace() {
  const storedSettings = getStoredSettings();
  if (!storedSettings) {
    showScreen('setup');
    return;
  }
  const settings = storedSettings;
  state.level = settings.level || 'easy';
  state.targetScore = settings.targetScore || 15;
  state.operations = settings.operations?.length ? settings.operations : ['add'];
  state.mode = settings.mode || 'math';
  state.topic = settings.topic || '';
  
  // تحديث العنوان بناءً على النوع
  const titleEl = document.querySelector('.header-title h1');
  if (titleEl) {
    if (state.mode === 'math') titleEl.textContent = '🦆 سباق البط الحسابي';
    else if (state.mode === 'english') titleEl.textContent = '🦆 Duck Race English';
    else titleEl.textContent = '🦆 سباق البط العربي';
  }

  createPlayers(settings);
  state.players.forEach(assignQuestion);
  closeSettingsModal();
  hideWinner();
  setLanding(false);
  showScreen('game');
  updateLanes();
  updatePanels();
  updateDuckPositions();
  startCountdown();
}

function restartRace() {
  if (state.gameLoopId) {
    clearInterval(state.gameLoopId);
    state.gameLoopId = null;
  }
  state.players.forEach((player) => {
    player.score = 0;
    player.passiveScore = 0;
    player.input = '';
    assignQuestion(player);
  });
  hideWinner();
  updateLanes();
  updatePanels();
  updateDuckPositions();
  startCountdown();
}

function backToSetup() {
  if (state.gameLoopId) {
    clearInterval(state.gameLoopId);
    state.gameLoopId = null;
  }
  hideWinner();
  showScreen('setup');
}

function handlePlayerCountChange() {
  const count = Math.min(Math.max(parseInt(elements.playerCount.value, 10) || 2, 2), 6);
  elements.playerCount.value = count;
  const names = Array.from(elements.playerNames.querySelectorAll('input')).map((input) => input.value.trim());
  createNameInputs(count, names);
}

function cancelSettings() {
  closeSettingsModal();
  loadSettings();
}

function toggleFullscreen() {
  if (!elements.root) return;
  
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch((err) => {
      console.error(`Error attempting to enable full-screen mode: ${err.message}`);
    });
    elements.root.classList.add('is-expanded');
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
  updateFullscreenLabel();
}

function updateFullscreenLabel() {
  if (!elements.fullscreenToggle || !elements.root) return;
  const isExpanded = elements.root.classList.contains('is-expanded');
  if (isExpanded) {
    elements.fullscreenToggle.textContent = '🗗';
    elements.restartRace.textContent = '🔄';
    elements.backToSetup.textContent = '⚙️';
  } else {
    elements.fullscreenToggle.textContent = 'تكبير المساحة';
    elements.restartRace.textContent = 'إعادة السباق';
    elements.backToSetup.textContent = 'رجوع للإعدادات';
  }
}

function handleSaveSettings() {
  saveSettings();
  startRace();
}

function setupEventListeners() {
  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.addEventListener('click', handleStartButtonClick);
  
  if (elements.modeSelect) elements.modeSelect.addEventListener('change', updateTopicOptions);
  if (elements.playerCount) elements.playerCount.addEventListener('change', handlePlayerCountChange);
  if (elements.startRace) elements.startRace.addEventListener('click', startRace);
  if (elements.restartRace) elements.restartRace.addEventListener('click', restartRace);
  if (elements.backToSetup) elements.backToSetup.addEventListener('click', backToSetup);
  if (elements.playAgain) elements.playAgain.addEventListener('click', restartRace);
  if (elements.closeWinner) elements.closeWinner.addEventListener('click', hideWinner);
  if (elements.openSettings) elements.openSettings.addEventListener('click', openSettingsModal);
  if (elements.closeSettings) elements.closeSettings.addEventListener('click', closeSettingsModal);
  if (elements.saveSettings) elements.saveSettings.addEventListener('click', handleSaveSettings);
  if (elements.cancelSettings) elements.cancelSettings.addEventListener('click', cancelSettings);
  if (elements.fullscreenToggle) elements.fullscreenToggle.addEventListener('click', toggleFullscreen);
  
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      if (elements.root) elements.root.classList.remove('is-expanded');
      updateFullscreenLabel();
    }
  });

  if (elements.settingsModal) {
    elements.settingsModal.addEventListener('click', (event) => {
      if (event.target === elements.settingsModal) {
        cancelSettings();
      }
    });
  }
  window.addEventListener('resize', updateDuckPositions);
}

loadSettings();
setLanding(true);
updateFullscreenLabel();
setupEventListeners();
showScreen('start');
})();
