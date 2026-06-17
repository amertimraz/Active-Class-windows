const scenarios = [
  {
    prompt: 'وجدت زميلك نسي قلمه المفضل على الطاولة، ماذا تفعل؟',
    options: [
      { text: 'أحتفظ به لنفسي لأنه جميل', correct: false, feedback: 'الأمانة تقتضي إعادة الأمانات لأصحابها.' },
      { text: 'أعيده له بلطف وأخبره أنه نسيه', correct: true, feedback: 'أحسنت، هذا تصرف أمين ويحفظ الحقوق.' },
      { text: 'أرميه حتى لا يستخدمه أحد', correct: false, feedback: 'إتلاف الممتلكات ليس سلوكاً أخلاقياً.' }
    ]
  },
  {
    prompt: 'طلب منك صديقك أن تغششه في الاختبار، ما القرار الصحيح؟',
    options: [
      { text: 'أوافق حتى لا يغضب مني', correct: false, feedback: 'الغش مخالف للأمانة ويضر الصداقة.' },
      { text: 'أرفض بلطف وأشجعه على المذاكرة', correct: true, feedback: 'قرار صحيح يشجع على الاجتهاد.' },
      { text: 'أعطيه الإجابات بعد الاختبار', correct: false, feedback: 'يجب احترام قواعد الاختبار دائماً.' }
    ]
  },
  {
    prompt: 'رأيت طفلاً أصغر منك يحاول حمل كتب ثقيلة، ماذا تفعل؟',
    options: [
      { text: 'أتجاهله وأكمل طريقي', correct: false, feedback: 'التعاون ومساعدة الآخرين من الأخلاق الحسنة.' },
      { text: 'أساعده في حمل الكتب', correct: true, feedback: 'مساعدة المحتاجين تعكس الرحمة.' },
      { text: 'أطلب منه أن يبتعد', correct: false, feedback: 'المعاملة الطيبة واجبة مع الجميع.' }
    ]
  },
  {
    prompt: 'أسقط زميلك طعامه في الفسحة، كيف تتصرف؟',
    options: [
      { text: 'أضحك عليه مع الآخرين', correct: false, feedback: 'السخرية تؤذي مشاعر الآخرين.' },
      { text: 'أساعده في تنظيف المكان وأطمئنه', correct: true, feedback: 'التعاطف والستر من مكارم الأخلاق.' },
      { text: 'أبتعد حتى لا أتسخ', correct: false, feedback: 'من الأفضل المبادرة بالمساعدة.' }
    ]
  },
  {
    prompt: 'وعدت معلمك بإحضار واجب إضافي ولم تستطع، ماذا تفعل؟',
    options: [
      { text: 'أختلق عذراً غير صحيح', correct: false, feedback: 'الصدق أساس الثقة.' },
      { text: 'أصارحه بالحقيقة وأعتذر', correct: true, feedback: 'الصدق والاعتذار يعززان الاحترام.' },
      { text: 'أتجاهل الأمر', correct: false, feedback: 'الوفاء بالوعد مسؤولية.' }
    ]
  },
  {
    prompt: 'في أثناء العمل الجماعي، قام زميلك بجهد كبير، ما السلوك الأنسب؟',
    options: [
      { text: 'أنسب العمل لنفسي فقط', correct: false, feedback: 'العدل يقتضي الاعتراف بجهود الآخرين.' },
      { text: 'أذكر فضل زميلي أمام المعلم', correct: true, feedback: 'تقدير الآخرين خلق نبيل.' },
      { text: 'أتجاهل جهده حتى لا أشاركه النجاح', correct: false, feedback: 'الأنانية تضعف روح الفريق.' }
    ]
  },
  {
    prompt: 'رأيت قمامة في ممر المدرسة، ماذا تفعل؟',
    options: [
      { text: 'أتركها لأن عامل النظافة سيجمعها', correct: false, feedback: 'المسؤولية المشتركة تحافظ على النظافة.' },
      { text: 'ألتقطها وأضعها في السلة', correct: true, feedback: 'النظافة من الإيمان، أحسنت.' },
      { text: 'أدفعها بقدمي بعيداً', correct: false, feedback: 'الأفضل التخلص منها بطريقة صحيحة.' }
    ]
  },
  {
    prompt: 'طلب منك والدك المساعدة في ترتيب المنزل وأنت مشغول باللعب، ماذا تفعل؟',
    options: [
      { text: 'أؤجل الأمر دون إبلاغه', correct: false, feedback: 'بر الوالدين يقتضي المبادرة.' },
      { text: 'أعتذر وأساعده ثم أعود للعب', correct: true, feedback: 'الاستجابة للوالدين من حسن الخلق.' },
      { text: 'أغضب وأرفض تماماً', correct: false, feedback: 'احترام الوالدين واجب.' }
    ]
  },
  {
    prompt: 'اختلفت مع زميلك في الرأي داخل الصف، ما التصرف الصحيح؟',
    options: [
      { text: 'أرفع صوتي وأحرجه أمام الجميع', correct: false, feedback: 'الحوار الهادئ أفضل من الجدال.' },
      { text: 'أناقشه بهدوء وأحترم رأيه', correct: true, feedback: 'الاحترام المتبادل يعزز الأخوة.' },
      { text: 'أتجاهله تماماً بعد ذلك', correct: false, feedback: 'الخلاف لا يفسد الود.' }
    ]
  },
  {
    prompt: 'وجدت مبلغاً صغيراً في ساحة المدرسة، ما القرار الصحيح؟',
    options: [
      { text: 'أحتفظ به دون سؤال', correct: false, feedback: 'الأمانة تتطلب البحث عن صاحب المال.' },
      { text: 'أسلّمه للإدارة أو المعلم', correct: true, feedback: 'سلوك أمين يحفظ حقوق الآخرين.' },
      { text: 'أنفقه فوراً حتى لا يضيع', correct: false, feedback: 'الأولى تسليمه للجهة المسؤولة.' }
    ]
  }
];

const screens = {
  start: document.getElementById('startScreen'),
  game: document.getElementById('gameScreen'),
  end: document.getElementById('endScreen')
};

const startButton = document.getElementById('startGame');
const nextButton = document.getElementById('nextBtn');
const restartButton = document.getElementById('restartBtn');
const scoreValue = document.getElementById('scoreValue');
const progressValue = document.getElementById('progressValue');
const scenarioText = document.getElementById('scenarioText');
const optionsContainer = document.getElementById('options');
const feedbackEl = document.getElementById('feedback');
const pathTrack = document.getElementById('pathTrack');
const finalScore = document.getElementById('finalScore');
const resultSummary = document.getElementById('resultSummary');
const resultTitle = document.getElementById('resultTitle');

let currentIndex = 0;
let score = 0;
let correctCount = 0;
let pathNodes = [];

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove('is-active'));
  screens[name].classList.add('is-active');
}

function buildPath() {
  pathTrack.innerHTML = '';
  pathNodes = scenarios.map((_, index) => {
    const node = document.createElement('div');
    node.className = 'path-node';
    node.textContent = index + 1;
    pathTrack.appendChild(node);
    return node;
  });
}

function updatePath() {
  pathNodes.forEach((node, index) => {
    node.classList.toggle('is-active', index === currentIndex);
  });
}

function renderScenario() {
  const scenario = scenarios[currentIndex];
  scenarioText.textContent = scenario.prompt;
  feedbackEl.textContent = 'اختر الإجابة الأنسب من الخيارات أدناه.';
  optionsContainer.innerHTML = '';

  scenario.options.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option-btn';
    button.textContent = option.text;
    button.addEventListener('click', () => handleOption(option, button));
    optionsContainer.appendChild(button);
  });

  progressValue.textContent = `${currentIndex + 1} / ${scenarios.length}`;
  updatePath();
  nextButton.disabled = true;
}

function handleOption(option, button) {
  const buttons = Array.from(optionsContainer.querySelectorAll('.option-btn'));
  buttons.forEach((btn) => {
    btn.disabled = true;
  });

  if (option.correct) {
    score += 10;
    correctCount += 1;
    button.classList.add('is-correct');
    pathNodes[currentIndex].classList.add('is-correct');
    feedbackEl.textContent = option.feedback;
  } else {
    button.classList.add('is-wrong');
    pathNodes[currentIndex].classList.add('is-wrong');
    feedbackEl.textContent = option.feedback;
    const correctOption = scenarios[currentIndex].options.find((item) => item.correct);
    if (correctOption) {
      const hint = document.createElement('div');
      hint.textContent = `الإجابة الصحيحة: ${correctOption.text}`;
      feedbackEl.appendChild(hint);
    }
  }

  scoreValue.textContent = score;
  nextButton.disabled = false;
}

function nextScenario() {
  if (currentIndex < scenarios.length - 1) {
    currentIndex += 1;
    renderScenario();
    return;
  }
  showResults();
}

function startGame() {
  currentIndex = 0;
  score = 0;
  correctCount = 0;
  scoreValue.textContent = score;
  buildPath();
  renderScenario();
  showScreen('game');
}

function showResults() {
  finalScore.textContent = `${score} نقطة`;
  resultSummary.textContent = `الإجابات الصحيحة: ${correctCount} من ${scenarios.length}`;
  resultTitle.textContent = correctCount >= 8 ? 'رائع! قيمك واضحة' : 'محاولة جيدة! يمكنك التحسن';
  showScreen('end');
}

startButton.addEventListener('click', startGame);
nextButton.addEventListener('click', nextScenario);
restartButton.addEventListener('click', () => {
  showScreen('start');
});

buildPath();
