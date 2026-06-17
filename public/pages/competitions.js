'use strict';

// CompetitionsPage - Interactive competitions system
(function(){
  // ====== DOM ======
  const typeSelect = document.getElementById('competitionType');
  const groupSelect = document.getElementById('groupSelect');
  // const levelFilter = document.getElementById('levelFilter');
  const studentsList = document.getElementById('studentsList') || document.getElementById('participantsList');
  // const selectRandomBtn = document.getElementById('selectRandom');
  const clearSelectionBtn = document.getElementById('clearSelection');
  const selectAllBtn = document.getElementById('selectAll');
  const toggleParticipantsBtn = document.getElementById('toggleParticipants');
  const bulkLevelSelect = document.getElementById('bulkLevelSelect');
  const applyBulkLevelBtn = document.getElementById('applyBulkLevel');
  const saveLevelsInlineBtn = document.getElementById('saveLevelsInline');
  const levelsBox = document.getElementById('levelsBox');
  const levelsList = document.getElementById('levelsList');

  const teamSetup = document.getElementById('teamSetup');
  const teamsCountInput = document.getElementById('teamsCount');
  const distributeTeamsBtn = document.getElementById('distributeTeams');
  const customTeamNamesWrap = document.getElementById('customTeamNames');
  const questionsSource = document.getElementById('questionsSource');
  const quizSelectRow = document.getElementById('quizSelectRow');
  const quizSelect = document.getElementById('quizSelect');
  const questionsCountInput = document.getElementById('questionsCount');
  const questionDurationInput = document.getElementById('questionDuration');

  const startBtn = document.getElementById('startCompetition');

  const stage = document.getElementById('stage');
  const leaderboardEl = document.getElementById('leaderboard');
  const questionIndexEl = document.getElementById('questionIndex');
  const questionTextEl = document.getElementById('questionText');
  const optionsEl = document.getElementById('options');
  const timerFillEl = document.getElementById('timerFill');
  const timerLabelEl = document.getElementById('timerLabel');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const nextBtn = document.getElementById('nextBtn');
  const endBtn = document.getElementById('endBtn');
  const celebrateEl = document.getElementById('celebrate');

  const teamsSummaryEl = document.getElementById('teamsSummary');

  // Live modal refs
  const liveModal = document.getElementById('liveModal');
  const closeLiveModalBtn = document.getElementById('closeLiveModal');
  const modalTeamsRosterEl = document.getElementById('modalTeamsRoster');
  const modalLeaderboardEl = document.getElementById('modalLeaderboard');
  const modalQuestionIndexEl = document.getElementById('modalQuestionIndex');
  const modalQuestionTextEl = document.getElementById('modalQuestionText');
  const modalOptionsEl = document.getElementById('modalOptions');
  const modalTimerFillEl = document.getElementById('modalTimerFill');
  const modalTimerLabelEl = document.getElementById('modalTimerLabel');
  const modalPauseBtn = document.getElementById('modalPauseBtn');
  const modalResumeBtn = document.getElementById('modalResumeBtn');
  const modalNextBtn = document.getElementById('modalNextBtn');
  const modalEndBtn = document.getElementById('modalEndBtn');

  const toastEl = document.getElementById('toast');

  // ====== State ======
  const hasAPI = !!(window.api);
  let allGroups = [];
  let allStudents = [];
  let allQuizzes = [];

  const LEVELS = ['beginner','intermediate','advanced'];
  const RANDOM_TEAM_NAMES = [
    'النمور','الصقور','الأبطال','النسور','الفرسان','العواصف','النجوم','الذئاب','الأقوياء','المحاربون'
  ];
  const TEAM_COLORS = ['#60a5fa','#22c55e','#f59e0b','#ef4444','#a78bfa','#14b8a6'];

  let setup = {
    type: 'pvp', // 'pvp' | 'team'
    selectedGroupId: '',
    level: '', // '', 'beginner','intermediate','advanced'
    selectedStudentIds: new Set(),
    teamsCount: 2,
    teamNamesMode: 'random',
    customTeamNames: [],
    teams: [], // [{id,name,color,members:[studentId], score:0}]
    // Quiz / questions
    source: 'quiz', // 'quiz' | 'bank'
    selectedQuizId: '',
    questionsCount: 10,
    questionDuration: 20
  };

  let runtime = {
    started: false,
    paused: false,
    timerTotal: 20,
    timerLeft: 20,
    timerTick: null,
    currentIndex: 0,
    questions: [], // [{text, options:[..], correctAnswer: idx}]
    participants: [], // pvp: [{id,name,score}], team: teams with score
    answered: false,
    lastAnswerTimeSec: 0,
    // Highlighting: who is answering now (id of team or participant)
    activeResponderId: null
  };

  // ====== Utils ======
  function showToast(msg, type='info'){
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastEl.classList.add('show');
    setTimeout(()=>{ toastEl.classList.remove('show'); toastEl.hidden = true; }, 2600);
  }

  function uid(){ return Math.random().toString(36).slice(2,10); }
  function shuffle(arr){
    for (let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]]=[arr[j],arr[i]];
    }
    return arr;
  }
  function sample(arr, n){
    const a = [...arr];
    shuffle(a);
    return a.slice(0, n);
  }

  function ensureArray(v){ return Array.isArray(v) ? v : []; }

  function normalizeStudent(student){
    // If no level is defined, leave undefined for manual assignment box
    if (!student.level || !LEVELS.includes(student.level)) student.level = undefined;
    return student;
  }

  // Convert quizzes to a uniform shape if needed
  function normalizeQuiz(quiz){
    if (quiz && Array.isArray(quiz.questions) && quiz.questions.length) {
      // ensure each question has {text, options[], correctAnswer}
      const questions = quiz.questions.map(q => {
        if (q && typeof q === 'object'){
          const text = q.text || q.question || q.title || 'سؤال';
          const options = ensureArray(q.options || q.choices || q.answers || []);
          let correct = typeof q.correctAnswer === 'number' ? q.correctAnswer
                      : typeof q.correctIndex === 'number' ? q.correctIndex
                      : (typeof q.correct === 'number' ? q.correct : 0);
          // Clamp
          if (!options.length) {
            // minimal fallback
            return { text, options: ['صح','خطأ','—','—'], correctAnswer: 0 };
          }
          correct = Math.max(0, Math.min(options.length-1, Number(correct)||0));
          return { text, options, correctAnswer: correct };
        }
        return { text: 'سؤال', options: ['أ','ب','ج','د'], correctAnswer: 0 };
      });
      return { id: quiz.id || uid(), title: quiz.title || quiz.name || 'اختبار', questions };
    }
    return null;
  }

  // Basic fallback question bank
  function fallbackBank(n=20){
    const qs = [];
    const ops = (a,b,c,d)=>[String(a),String(b),String(c),String(d)];
    for (let i=1;i<=n;i++){
      const a = Math.ceil(Math.random()*10);
      const b = Math.ceil(Math.random()*10);
      const sum = a+b;
      const wrong = [sum+1, sum-1, sum+2];
      const options = shuffle(ops(sum, wrong[0], wrong[1], wrong[2]));
      const correctAnswer = options.indexOf(String(sum));
      qs.push({ text: `ما ناتج ${a} + ${b}؟`, options, correctAnswer });
    }
    return qs;
  }

  function buildSampleQuizzes(){
    // Inspired by race.js sample structure
    return [
      {
        id: 'sample-quiz-1',
        title: 'اختبار عام 1',
        questions: [
          { text: 'ما هو أكبر كوكب؟', options: ['الأرض','المريخ','المشتري','زحل'], correctAnswer: 2 },
          { text: 'عاصمة فرنسا؟', options: ['لندن','برلين','باريس','روما'], correctAnswer: 2 }
        ]
      },
      {
        id: 'sample-quiz-2',
        title: 'اختبار رياضيات',
        questions: [
          { text: '15 × 12 = ؟', options: ['170','180','175','185'], correctAnswer: 1 },
          { text: 'الجذر التربيعي لـ 144؟', options: ['10','12','14','16'], correctAnswer: 1 }
        ]
      }
    ];
  }

  // ====== Data Loading ======
  async function loadGroups(){
    try {
      if (hasAPI && window.api.loadGroups){
        const r = await window.api.loadGroups();
        allGroups = Array.isArray(r) ? r : [];
      } else {
        const raw = localStorage.getItem('cm_groups_v1');
        allGroups = raw ? JSON.parse(raw) : [
          { id:'group1', name:'المجموعة الأولى' },
          { id:'group2', name:'المجموعة الثانية' }
        ];
      }
    } catch {
      allGroups = [];
    }
    // populate UI
    groupSelect.innerHTML = '<option value="">— اختر مجموعة —</option>';
    allGroups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id; opt.textContent = g.name;
      groupSelect.appendChild(opt);
    });
    // restore selection
    if (setup.selectedGroupId) groupSelect.value = setup.selectedGroupId;
  }

  async function loadStudents(){
    try {
      if (hasAPI && window.api.loadStudents){
        const r = await window.api.loadStudents();
        allStudents = Array.isArray(r) ? r.map(normalizeStudent) : [];
      } else {
        const raw = localStorage.getItem('cm_students_v1');
        const sample = [
          { id:'1', name:'أحمد محمد', groupId:'group1', level:'beginner' },
          { id:'2', name:'فاطمة علي', groupId:'group1', level:'intermediate' },
          { id:'3', name:'محمد أحمد', groupId:'group1', level:'advanced' },
          { id:'4', name:'سارة خالد', groupId:'group2', level:'beginner' },
          { id:'5', name:'يوسف إبراهيم', groupId:'group2', level:'intermediate' },
          { id:'6', name:'مريم حسن', groupId:'group2', level:'advanced' }
        ];
        allStudents = raw ? JSON.parse(raw).map(normalizeStudent) : sample;
      }
    } catch {
      allStudents = [];
    }
  }

  async function loadQuizzes(){
    try {
      if (hasAPI && window.api.loadQuizzes){
        const r = await window.api.loadQuizzes();
        const list = Array.isArray(r) ? r : [];
        const normalized = list.map(normalizeQuiz).filter(Boolean);
        if (normalized.length) {
          allQuizzes = normalized;
        } else {
          // fallback to built-in samples
          allQuizzes = buildSampleQuizzes();
        }
      } else {
        // Try from localStorage used by quizzes page
        const raw = localStorage.getItem('cm_quizzes_v1');
        const list = raw ? JSON.parse(raw) : [];
        const normalized = list.map(normalizeQuiz).filter(Boolean);
        allQuizzes = normalized.length ? normalized : buildSampleQuizzes();
      }
    } catch {
      allQuizzes = buildSampleQuizzes();
    }

    // Populate quiz select
    if (!quizSelect) return;
    quizSelect.innerHTML = '<option value="">— اختر اختبار —</option>';
    allQuizzes.forEach(q => {
      const opt = document.createElement('option');
      opt.value = q.id; opt.textContent = q.title || 'اختبار';
      quizSelect.appendChild(opt);
    });
    // restore selection
    if (setup.selectedQuizId) quizSelect.value = setup.selectedQuizId;
  }

  // ====== Participants UI ======
  function getFilteredStudents(){
    const gid = setup.selectedGroupId;
    const lvl = setup.level;
    return allStudents
      .filter(s => !gid || s.groupId === gid)
      .filter(s => !lvl || (s.level === lvl));
  }

  function renderStudents(){
    if (!studentsList) return;
    const list = getFilteredStudents();
    studentsList.innerHTML = '';
    // اضبط كثافة الشبكة بحسب العدد لزيادة عدد العناصر في الصف الواحد
    studentsList.classList.remove('dense','xdense');
    if (list.length > 36) {
      studentsList.classList.add('xdense');
    } else if (list.length > 18) {
      studentsList.classList.add('dense');
    }
    if (!list.length){
      studentsList.innerHTML = '<div class="page-competitions-note">لا يوجد طلاب مطابقون.</div>';
      return;
    }
    list.forEach(s => {
      const el = document.createElement('label');
      el.className = 'student';
      el.dataset.level = s.level || 'unset';
      el.innerHTML = `
        <input type="checkbox" value="${s.id}" ${setup.selectedStudentIds.has(s.id)?'checked':''} />
        <span class="name">${s.name}</span>
        <select class="level-inline" data-student-id="${s.id}">
          <option value="">غير محدد</option>
          <option value="beginner" ${s.level==='beginner'?'selected':''}>مبتدئ</option>
          <option value="intermediate" ${s.level==='intermediate'?'selected':''}>متوسط</option>
          <option value="advanced" ${s.level==='advanced'?'selected':''}>متقدم</option>
        </select>
      `;
      const input = el.querySelector('input');
      input.addEventListener('change', () => {
        if (input.checked) setup.selectedStudentIds.add(s.id); else setup.selectedStudentIds.delete(s.id);
      });
      const levelSel = el.querySelector('select.level-inline');
      levelSel.addEventListener('change', () => {
        const val = levelSel.value || undefined;
        const idx = allStudents.findIndex(st => st.id===s.id);
        if (idx>=0){ allStudents[idx].level = val; }
        el.dataset.level = val || 'unset';
      });
      studentsList.appendChild(el);
    });
  }

  function levelLabel(l){
    switch(l){
      case 'beginner': return 'مبتدئ';
      case 'intermediate': return 'متوسط';
      case 'advanced': return 'متقدم';
      default: return 'غير محدد';
    }
  }

  function ensureCustomTeamInputs(){
    const count = Number(teamsCountInput.value||2);
    customTeamNamesWrap.innerHTML = '';
    for (let i=0;i<count;i++){
      const row = document.createElement('div');
      row.className = 'team-slot';
      row.innerHTML = `
        <label style="display:flex;align-items:center;gap:8px">
          <span class="team-badge"><span class="team-color" style="background:${TEAM_COLORS[i%TEAM_COLORS.length]}"></span> فريق ${i+1}</span>
          <input type="text" placeholder="اسم الفريق" data-team-name-index="${i}" style="flex:1;background:#0b1220;border:1px solid #1e293b;border-radius:8px;color:#e5e7eb;padding:8px" />
        </label>
      `;
      customTeamNamesWrap.appendChild(row);
    }
  }

  function buildTeams(){
    const count = Math.max(2, Math.min(6, Number(teamsCountInput.value||2)));
    const selected = getSelectedParticipants();
    if (selected.length < count) {
      showToast('عدد المشاركين أقل من عدد الفرق', 'warning');
    }
    // Require levels before distribution
    const missingLevels = selected.filter(s => !LEVELS.includes(s.level));
    if (missingLevels.length){
      showToast('حدد مستويات المشاركين أولاً من زر "تعيين المستويات"', 'warning');
      if (levelsBox){
        renderLevelsBox();
        levelsBox.classList.remove('hidden');
        levelsBox.setAttribute('aria-hidden','false');
      }
      return;
    }
    // Team names
    const teams = [];
    if (getTeamNamesMode()==='random'){
      const names = shuffle([...RANDOM_TEAM_NAMES]).slice(0, count);
      for (let i=0;i<count;i++){
        teams.push({ id: uid(), name: names[i], color: TEAM_COLORS[i%TEAM_COLORS.length], members: [], score: 0 });
      }
    } else {
      const inputs = customTeamNamesWrap.querySelectorAll('[data-team-name-index]');
      for (let i=0;i<count;i++){
        const name = inputs[i]?.value?.trim() || `فريق ${i+1}`;
        teams.push({ id: uid(), name, color: TEAM_COLORS[i%TEAM_COLORS.length], members: [], score: 0 });
      }
    }

    // Ensure every selected student has a level (manual assignment may be pending)
    selected.forEach(s => { if (!LEVELS.includes(s.level)) s.level = 'intermediate'; });

    // Distribute by level balance then fill (merge مختلف المستويات في كل فريق)
    const byLevel = {
      beginner: selected.filter(s=>s.level==='beginner'),
      intermediate: selected.filter(s=>s.level==='intermediate'),
      advanced: selected.filter(s=>s.level==='advanced')
    };
    Object.values(byLevel).forEach(arr => shuffle(arr));

    // Round-robin across Advanced -> Intermediate -> Beginner, to mix levels fairly
    const rounds = [byLevel.advanced, byLevel.intermediate, byLevel.beginner];
    const queue = rounds.flat();
    let idx = 0;
    queue.forEach(s => { teams[idx%teams.length].members.push(s); idx++; });

    setup.teams = teams;
    showToast('تم توزيع الفرق بنجاح','success');
    renderLeaderboard();
    renderTeamsSummary();
  }

  function getTeamNamesMode(){
    const checked = document.querySelector('input[name="teamNamesMode"]:checked');
    return checked ? checked.value : 'random';
  }

  function getSelectedParticipants(){
    const ids = Array.from(setup.selectedStudentIds);
    return getFilteredStudents().filter(s => ids.includes(s.id));
  }

  // [REMOVED] selectRandomParticipants was removed per request

  // ====== Questions/Quiz ======
  function buildQuestions(){
    const total = Math.max(1, Math.min(50, Number(questionsCountInput.value||10)));
    let questions = [];
    if (setup.source === 'quiz'){
      const quiz = allQuizzes.find(q => q.id === setup.selectedQuizId);
      if (quiz) questions = quiz.questions.slice(0, total);
    } else {
      // bank mode: take random from all quizzes; if empty, fallback
      const bank = allQuizzes.flatMap(q => q.questions || []);
      if (bank.length){
        questions = sample(bank, Math.min(total, bank.length));
      }
    }
    if (!questions.length){
      questions = fallbackBank(total);
    }
    return questions;
  }

  // ====== Stage / Rendering ======
  function renderLeaderboard(){
    if (!leaderboardEl) return;
    leaderboardEl.innerHTML = '';

    const items = (setup.type==='team') ? setup.teams.map(t => ({
      id: t.id, name: t.name, score: t.score || 0, meta: `${t.members.length} مشارك`
    })) : getSelectedParticipants().map(s => ({
      id: s.id, name: s.name, score: (runtime.participants.find(p=>p.id===s.id)?.score)||0
    }));

    items.sort((a,b)=>b.score-a.score);

    items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'board-item' + (runtime.activeResponderId===it.id ? ' active' : '');
      row.innerHTML = `
        <div class="name">${i+1}. ${it.name}</div>
        <div class="score">${it.score}</div>
      `;
      row.setAttribute('data-id', it.id);
      row.title = 'تعيين/إزالة المجاوب الحالي';
      row.addEventListener('click', () => {
        setActiveResponder(runtime.activeResponderId===it.id ? null : it.id);
      });
      leaderboardEl.appendChild(row);
    });

    // Mirror to modal leaderboard if exists
    if (modalLeaderboardEl){
      modalLeaderboardEl.innerHTML = '';
      items.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'board-item' + (runtime.activeResponderId===it.id ? ' active' : '');
        row.innerHTML = `
          <div class="name">${i+1}. ${it.name}</div>
          <div class="score">${it.score}</div>
        `;
        row.setAttribute('data-id', it.id);
        row.title = 'تعيين/إزالة المجاوب الحالي';
        row.addEventListener('click', () => {
          setActiveResponder(runtime.activeResponderId===it.id ? null : it.id);
        });
        modalLeaderboardEl.appendChild(row);
      });
    }
  }

  function levelColor(level){
    switch(level){
      case 'beginner': return '#22c55e';
      case 'intermediate': return '#f59e0b';
      case 'advanced': return '#ef4444';
      default: return '#64748b';
    }
  }

  function renderTeamsSummary(){
    if (!teamsSummaryEl) return;
    if (!setup.teams || !setup.teams.length){
      teamsSummaryEl.classList.add('hidden');
      teamsSummaryEl.setAttribute('aria-hidden','true');
      teamsSummaryEl.innerHTML='';
      return;
    }
    teamsSummaryEl.classList.remove('hidden');
    teamsSummaryEl.setAttribute('aria-hidden','false');
    teamsSummaryEl.innerHTML = setup.teams.map(t => {
      const members = (t.members||[]).map(m => `
        <div class="member"><span class="level-dot" style="background:${levelColor(m.level)}"></span><span>${m.name}</span></div>
      `).join('');
      return `
        <div class="team-card">
          <div class="team-title">
            <span class="team-color" style="width:10px;height:10px;border-radius:50%;background:${t.color}"></span>
            <span>${t.name}</span>
            <span style="opacity:.7">(${t.members.length})</span>
          </div>
          <div class="members">${members || '<div class="member" style="opacity:.7">— لا يوجد مشاركون —</div>'}</div>
        </div>
      `;
    }).join('');
  }

  function setActiveResponder(id){
    runtime.activeResponderId = id || null;
    renderLeaderboard();
    renderModalRoster();
  }

  function openLiveModal(){
    if (!liveModal) return;
    liveModal.classList.remove('hidden');
    liveModal.setAttribute('aria-hidden','false');
    renderModalRoster();
    renderLeaderboard();
    renderModalQuestion();
  }

  function closeLiveModal(){
    if (!liveModal) return;
    liveModal.classList.add('hidden');
    liveModal.setAttribute('aria-hidden','true');
  }

  function renderModalRoster(){
    if (!modalTeamsRosterEl) return;
    modalTeamsRosterEl.innerHTML = '';
    if (setup.type === 'team'){
      setup.teams.forEach(t => {
        const isActive = runtime.activeResponderId === t.id;
        const teamDiv = document.createElement('div');
        teamDiv.className = 'live-team' + (isActive ? ' active' : '');
        teamDiv.innerHTML = `
          <div class="team-head"><span class="team-color" style="width:10px;height:10px;border-radius:50%;background:${t.color}"></span><span>${t.name}</span><span style="opacity:.6">(${t.members.length})</span></div>
        `;
        teamDiv.setAttribute('data-id', t.id);
        teamDiv.title = 'تعيين/إزالة الفريق كمجاوب حالي';
        teamDiv.addEventListener('click', () => {
          setActiveResponder(runtime.activeResponderId===t.id ? null : t.id);
        });
        (t.members||[]).forEach(m => {
          const mr = document.createElement('div');
          mr.className = 'member';
          mr.innerHTML = `<span class="level-dot" style="width:8px;height:8px;border-radius:50%;background:${levelColor(m.level)}"></span><span>${m.name}</span>`;
          teamDiv.appendChild(mr);
        });
        modalTeamsRosterEl.appendChild(teamDiv);
      });
    } else {
      // PvP participants list as a single team block
      const box = document.createElement('div');
      box.className = 'live-team';
      box.innerHTML = `<div class="team-head"><span>المشاركون</span><span style="opacity:.6">(${runtime.participants.length})</span></div>`;
      runtime.participants.forEach(p => {
        const mr = document.createElement('div');
        mr.className = 'member' + (runtime.activeResponderId===p.id ? ' active' : '');
        mr.innerHTML = `<span class="level-dot" style="background:#60a5fa"></span><span>${p.name}</span>`;
        box.appendChild(mr);
      });
      modalTeamsRosterEl.appendChild(box);
    }
  }

  function renderModalQuestion(){
    if (!modalQuestionIndexEl || !modalQuestionTextEl || !modalOptionsEl) return;
    const q = runtime.questions[runtime.currentIndex];
    modalQuestionIndexEl.textContent = `السؤال ${runtime.currentIndex+1} / ${runtime.questions.length}`;
    modalQuestionTextEl.textContent = q?.text || '—';
    modalOptionsEl.innerHTML = '';
    (q.options||[]).forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.textContent = opt;
      btn.addEventListener('click', () => onAnswer(idx));
      modalOptionsEl.appendChild(btn);
    });
  }

  function showQuestion(){
    const q = runtime.questions[runtime.currentIndex];
    const idxText = `السؤال ${runtime.currentIndex+1} / ${runtime.questions.length}`;
    questionIndexEl.textContent = idxText;
    questionTextEl.textContent = q?.text || '—';
    optionsEl.innerHTML = '';
    (q.options||[]).forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.textContent = opt;
      btn.addEventListener('click', () => onAnswer(idx));
      optionsEl.appendChild(btn);
    });
    // Mirror to modal
    if (modalQuestionIndexEl) modalQuestionIndexEl.textContent = idxText;
    if (modalQuestionTextEl) modalQuestionTextEl.textContent = q?.text || '—';
    if (modalOptionsEl){
      modalOptionsEl.innerHTML = '';
      (q.options||[]).forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'option';
        btn.textContent = opt;
        btn.addEventListener('click', () => onAnswer(idx));
        modalOptionsEl.appendChild(btn);
      });
    }

    runtime.answered = false;
    startTimer();
  }

  function startTimer(){
    stopTimer();
    runtime.timerTotal = Math.max(10, Math.min(60, Number(questionDurationInput.value||20)));
    runtime.timerLeft = runtime.timerTotal;
    timerLabelEl.textContent = String(runtime.timerLeft);
    timerFillEl.style.width = '100%';
    // Mirror to modal
    if (modalTimerLabelEl) modalTimerLabelEl.textContent = String(runtime.timerLeft);
    if (modalTimerFillEl) modalTimerFillEl.style.width = '100%';

    const startedAt = Date.now();

    runtime.timerTick = setInterval(() => {
      if (runtime.paused) return;
      const elapsed = Math.floor((Date.now() - startedAt)/1000);
      runtime.timerLeft = Math.max(0, runtime.timerTotal - elapsed);
      timerLabelEl.textContent = String(runtime.timerLeft);
      if (modalTimerLabelEl) modalTimerLabelEl.textContent = String(runtime.timerLeft);
      const pct = (runtime.timerLeft / runtime.timerTotal) * 100;
      timerFillEl.style.width = pct + '%';
      if (modalTimerFillEl) modalTimerFillEl.style.width = pct + '%';
      if (runtime.timerLeft <= 0){
        stopTimer();
        onTimeUp();
      }
    }, 200);
  }

  function stopTimer(){
    if (runtime.timerTick){ clearInterval(runtime.timerTick); runtime.timerTick = null; }
  }

  function onTimeUp(){
    showToast('انتهى الوقت!');
    // Reveal correct answer visually
    revealCorrect();
    optionsEl.querySelectorAll('.option').forEach(b=>b.classList.add('disabled'));
  }

  function revealCorrect(){
    const q = runtime.questions[runtime.currentIndex];
    const correct = q.correctAnswer;
    const buttons = Array.from(optionsEl.querySelectorAll('.option'));
    buttons.forEach((b, idx) => {
      if (idx === correct) b.classList.add('correct'); else b.classList.add('wrong');
      b.classList.add('disabled');
    });
    // Mirror in modal
    if (modalOptionsEl){
      const mButtons = Array.from(modalOptionsEl.querySelectorAll('.option'));
      mButtons.forEach((b, idx) => {
        if (idx === correct) b.classList.add('correct'); else b.classList.add('wrong');
        b.classList.add('disabled');
      });
    }
  }

  // Award points to a participant or team
  function addScore(targetId, basePoints){
    const speedBonus = 5; // per requirements
    const total = basePoints + speedBonus;

    if (setup.type==='team'){
      const team = setup.teams.find(t => t.id === targetId);
      if (team){ team.score = (team.score||0) + total; }
    } else {
      const p = runtime.participants.find(p => p.id === targetId);
      if (p){ p.score = (p.score||0) + total; }
    }
    renderLeaderboard();
  }

  function onAnswer(chosenIndex){
    if (runtime.answered) return; // prevent double
    runtime.answered = true;
    stopTimer();

    const q = runtime.questions[runtime.currentIndex];
    const correct = q.correctAnswer;

    // Visual
    const buttons = Array.from(optionsEl.querySelectorAll('.option'));
    buttons.forEach((b, idx) => {
      const isCorrect = idx === correct;
      b.classList.toggle('correct', isCorrect);
      b.classList.toggle('wrong', !isCorrect);
      b.classList.add('disabled');
    });

    // Award
    if (chosenIndex === correct){
      // Use active responder if set; else fallback to round-robin attribution
      let targetId = runtime.activeResponderId;
      if (!targetId){
        targetId = (setup.type==='team')
          ? setup.teams[runtime.currentIndex % setup.teams.length].id
          : (runtime.participants[runtime.currentIndex % runtime.participants.length]?.id);
      }
      if (targetId) addScore(targetId, 10);
    }
  }

  function nextQuestion(){
    if (runtime.currentIndex < runtime.questions.length - 1){
      runtime.currentIndex++;
      showQuestion();
    } else {
      endCompetition(true);
    }
  }

  function endCompetition(auto=false){
    stopTimer();
    optionsEl.querySelectorAll('.option').forEach(b=>b.classList.add('disabled'));
    // Show celebration for the winner
    const winner = getWinners()[0];
    if (winner){
      celebrateEl.classList.remove('hidden');
      setTimeout(()=> celebrateEl.classList.add('hidden'), 2000);
      showToast(`الفائز: ${winner.name} 🎉`, 'success');
    }
    if (!auto) showToast('تم إنهاء المسابقة','info');
  }

  function getWinners(){
    if (setup.type==='team'){
      return [...setup.teams].sort((a,b)=> (b.score||0)-(a.score||0));
    }
    return [...runtime.participants].sort((a,b)=> (b.score||0)-(a.score||0));
  }

  // ====== Event Bindings ======
  typeSelect?.addEventListener('change', () => {
    setup.type = typeSelect.value;
    const isTeam = setup.type === 'team';
    if (teamSetup) {
      teamSetup.classList.toggle('hidden', !isTeam);
      teamSetup.setAttribute('aria-hidden', String(!isTeam));
    }
  });

  groupSelect?.addEventListener('change', () => {
    setup.selectedGroupId = groupSelect.value;
    renderStudents();
  });

  // Refresh actions for groups/quizzes
  document.getElementById('refreshGroups')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await loadGroups();
    renderStudents();
    showToast('تم تحديث المجموعات');
  });
  document.getElementById('refreshQuizzes')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await loadQuizzes();
    showToast('تم تحديث قائمة الاختبارات');
  });

  // level filter removed

  // selectRandomBtn?.addEventListener('click', (e) => { e.preventDefault(); selectRandomParticipants(); });
  clearSelectionBtn?.addEventListener('click', (e) => { e.preventDefault(); setup.selectedStudentIds.clear(); renderStudents(); });
  selectAllBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    // حدد كل الطلاب المعروضين بعد الفلترة الحالية
    const list = getFilteredStudents();
    list.forEach(s => setup.selectedStudentIds.add(s.id));
    renderStudents();
  });
  toggleParticipantsBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const body = document.querySelector('.participants-body');
    const chev = toggleParticipantsBtn.querySelector('.chevron');
    const isHidden = body?.style.display === 'none';
    if (body) body.style.display = isHidden ? '' : 'none';
    if (chev) chev.style.transform = isHidden ? 'rotate(135deg)' : 'rotate(-45deg)';
  });
  applyBulkLevelBtn?.addEventListener('click', (e)=>{
    e.preventDefault();
    const lvl = bulkLevelSelect?.value || '';
    if (!lvl){ showToast('اختر مستوى أولاً'); return; }
    const ids = Array.from(setup.selectedStudentIds);
    if (!ids.length){ showToast('اختر طلابًا أولاً'); return; }
    allStudents.forEach(s => { if (ids.includes(s.id)) s.level = lvl; });
    // أعِد الرسم لعكس المستويات الجديدة
    renderStudents();
  });
  saveLevelsInlineBtn?.addEventListener('click', async (e)=>{
    e.preventDefault();
    // احفظ المستويات الحالية (inline) في التخزين/الـ API
    let persisted = false;
    try {
      if (hasAPI && window.api && typeof window.api.saveStudents === 'function'){
        await window.api.saveStudents(allStudents);
        persisted = true;
      }
    } catch(_){}
    if (!persisted){
      try { localStorage.setItem('cm_students_v1', JSON.stringify(allStudents)); persisted = true; } catch(_){ }
    }
    showToast(persisted ? 'تم حفظ مستويات الطلاب' : 'تم حفظ المستويات مؤقتًا فقط');
  });

  // ألغينا نافذة المستويات المنفصلة، لكن نبقي الدوال الاحتياطية معطلة
  // (تم الاستبدال بالحفظ من زر حفظ المستويات داخل المشاركون)

  function renderLevelsBox(){
    const ids = Array.from(setup.selectedStudentIds);
    const selected = getFilteredStudents().filter(s => ids.includes(s.id));
    levelsList.innerHTML = '';
    if (!selected.length){
      levelsList.innerHTML = '<div class="page-competitions-note">لم يتم اختيار طلاب بعد.</div>';
      return;
    }
    selected.forEach(s => {
      const row = document.createElement('div');
      row.className = 'level-item';
      row.innerHTML = `
        <span>${s.name}</span>
        <select data-student-id="${s.id}">
          <option value="">غير محدد</option>
          <option value="beginner" ${s.level==='beginner'?'selected':''}>مبتدئ</option>
          <option value="intermediate" ${s.level==='intermediate'?'selected':''}>متوسط</option>
          <option value="advanced" ${s.level==='advanced'?'selected':''}>متقدم</option>
        </select>
      `;
      levelsList.appendChild(row);
    });
  }

  // Team names mode
  document.querySelectorAll('input[name="teamNamesMode"]').forEach(r => {
    r.addEventListener('change', () => {
      const mode = getTeamNamesMode();
      setup.teamNamesMode = mode;
      customTeamNamesWrap.classList.toggle('hidden', mode!=='custom');
      if (mode==='custom') ensureCustomTeamInputs();
    });
  });

  teamsCountInput?.addEventListener('change', () => {
    if (getTeamNamesMode()==='custom') ensureCustomTeamInputs();
  });

  distributeTeamsBtn?.addEventListener('click', (e)=>{ e.preventDefault(); buildTeams(); });

  // Questions source
  questionsSource?.addEventListener('change', () => {
    setup.source = questionsSource.value;
    if (quizSelectRow) quizSelectRow.classList.toggle('hidden', setup.source !== 'quiz');
  });

  quizSelect?.addEventListener('change', () => {
    setup.selectedQuizId = quizSelect.value;
  });

  questionsCountInput?.addEventListener('change', () => {
    setup.questionsCount = Number(questionsCountInput.value||10);
  });

  questionDurationInput?.addEventListener('change', () => {
    setup.questionDuration = Number(questionDurationInput.value||20);
  });

  function setPaused(flag){
    runtime.paused = flag;
    pauseBtn?.classList.toggle('hidden', flag);
    resumeBtn?.classList.toggle('hidden', !flag);
    // Mirror modal buttons
    if (modalPauseBtn && modalResumeBtn){
      modalPauseBtn.classList.toggle('hidden', flag);
      modalResumeBtn.classList.toggle('hidden', !flag);
    }
  }

  pauseBtn?.addEventListener('click', () => setPaused(true));
  resumeBtn?.addEventListener('click', () => setPaused(false));
  nextBtn?.addEventListener('click', () => nextQuestion());
  endBtn?.addEventListener('click', () => endCompetition(false));

  // Modal controls mirror
  closeLiveModalBtn?.addEventListener('click', () => closeLiveModal());
  modalPauseBtn?.addEventListener('click', () => setPaused(true));
  modalResumeBtn?.addEventListener('click', () => setPaused(false));
  modalNextBtn?.addEventListener('click', () => nextQuestion());
  modalEndBtn?.addEventListener('click', () => endCompetition(false));

  startBtn?.addEventListener('click', () => {
    if (!stage || !questionTextEl || !optionsEl || !leaderboardEl) {
      showToast('واجهة عرض المسابقة غير مكتملة في هذه الصفحة', 'warning');
      return;
    }

    // Validation
    const participants = getSelectedParticipants();
    if (setup.type==='pvp' && participants.length < 2){
      showToast('اختر على الأقل طالبين في وضع طالب ضد طالب', 'warning');
      return;
    }
    if (setup.type==='team'){
      if (!setup.teams.length){
        showToast('يرجى توزيع الفرق أولاً', 'warning');
        return;
      }
      if (setup.teams.some(t => !t.members.length)){
        showToast('تأكد أن كل فريق لديه مشاركون', 'warning');
        return;
      }
    }

    runtime.questions = buildQuestions();
    runtime.currentIndex = 0;
    runtime.started = true;
    setPaused(false);

    // Build participants model for PvP
    if (setup.type==='pvp'){
      runtime.participants = participants.map(s => ({ id: s.id, name: s.name, score: 0 }));
    } else {
      // Reset team scores
      setup.teams.forEach(t => t.score = 0);
    }

    // Show stage only (live modal opens in العرض المباشر فقط)
    stage.classList.remove('hidden');
    renderLeaderboard();
    renderModalRoster();
    // openLiveModal();
    showQuestion();
  });

  // ====== Init ======
  (async function init(){
    await Promise.all([loadGroups(), loadStudents(), loadQuizzes()]);
    renderStudents();
    // initial quiz UI
    setup.source = questionsSource ? questionsSource.value : 'bank';
    if (quizSelectRow) quizSelectRow.classList.toggle('hidden', setup.source !== 'quiz');
    // prepare custom inputs if needed
    if (getTeamNamesMode()==='custom') ensureCustomTeamInputs();
  })();
})();