'use strict';

// محرر الأسئلة المتقدم
(function(){
  // ===== Environment =====
  const hasAPI = typeof window !== 'undefined' && !!window.api;

  // ===== State =====
  let currentQuiz = null;
  let questions = [];
  let currentQuestionId = null;
  let currentQuestionIndex = -1;
  let isEditing = false;
  let hasUnsavedChanges = false;

  // ===== DOM refs =====
  const loadingOverlay = document.getElementById('loadingOverlay');
  const quizNameEl = document.getElementById('quizName');
  const quizMetaEl = document.getElementById('quizMeta');
  const saveQuizBtn = document.getElementById('saveQuiz');
  const previewQuizBtn = document.getElementById('previewQuiz');
  const goToQuizzesBtn = document.getElementById('goToQuizzes');
  const previewModal = document.getElementById('previewModal');
  const previewModalClose = document.getElementById('previewModalClose');
  const interactivePreviewBtn = document.getElementById('interactivePreview');
  const exportPdfBtn = document.getElementById('exportPdf');
  const previewPane = document.getElementById('previewPane');
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearch');
  const typeFilter = document.getElementById('typeFilter');
  const difficultyFilter = document.getElementById('difficultyFilter');
  const questionsCountEl = document.getElementById('questionsCount');
  const totalPointsEl = document.getElementById('totalPoints');
  const addQuestionBtn = document.getElementById('addQuestion') || document.getElementById('emptyAddQuestion');
  const expandAllBtn = document.getElementById('expandAll');
  const collapseAllBtn = document.getElementById('collapseAll');
  const questionsList = document.getElementById('questionsList');
  const emptyState = document.getElementById('emptyState');

  // Modal elements
  const questionModal = document.getElementById('questionModal');
  const questionModalClose = document.getElementById('questionModalClose');
  const questionModalTitle = document.getElementById('questionModalTitle');
  const questionForm = document.getElementById('questionForm');
  const questionType = document.getElementById('questionType');
  const questionText = document.getElementById('questionText');
  const questionImage = document.getElementById('questionImage');
  const imagePreview = document.getElementById('imagePreview');
  const previewImg = document.getElementById('previewImg');
  const removeImageBtn = document.getElementById('removeImage');
  const optionsContainer = document.getElementById('optionsContainer');
  const questionDifficulty = document.getElementById('questionDifficulty');
  const questionPoints = document.getElementById('questionPoints');
  const questionExplanation = document.getElementById('questionExplanation');
  const saveQuestionBtn = document.getElementById('saveQuestion');
  const cancelQuestionBtn = document.getElementById('cancelQuestion');

  const deleteQuestionModal = document.getElementById('deleteQuestionModal');
  const deleteQuestionModalClose = document.getElementById('deleteQuestionModalClose');
  const confirmDeleteQuestionBtn = document.getElementById('confirmDeleteQuestion');
  const cancelDeleteQuestionBtn = document.getElementById('cancelDeleteQuestion');

  // ===== LocalStorage =====
  const LS_QUIZZES = 'cm_quizzes_v1';
  const LS_GROUPS = 'cm_groups_v1';
  
  function loadLocal(key){ 
    try { 
      const raw = localStorage.getItem(key); 
      return raw ? JSON.parse(raw) : []; 
    } catch { 
      return []; 
    } 
  }
  
  function saveLocal(key, val){ 
    try { 
      localStorage.setItem(key, JSON.stringify(val)); 
    } catch {} 
  }

  // ===== Teacher Name Helper =====
  function getTeacherName(){
    try {
      if (currentQuiz && currentQuiz.teacherName) return currentQuiz.teacherName;
      const stored = localStorage.getItem('cm_teacher_name');
      if (stored) return stored;
    } catch {}
    return '';
  }

  // ===== Utils =====
  const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
  const debounce = (fn, d=150)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), d); }; };

  // ===== Toast =====
  function showToast(message, type='info'){
    const exist = document.querySelector('.toast'); 
    if (exist) exist.remove();
    
    const el = document.createElement('div');
    el.className = `toast ${type}`; 
    el.textContent = message;
    
    Object.assign(el.style, { 
      position:'fixed', 
      top:'20px', 
      right:'20px', 
      padding:'14px 16px', 
      borderRadius:'12px', 
      color:'#fff', 
      font:'14px Cairo, sans-serif', 
      zIndex:'999999', 
      transform:'translateX(120%)', 
      transition:'all .3s ease', 
      boxShadow:'0 20px 40px rgba(0,0,0,.25)', 
      cursor:'pointer' 
    });
    
    const colors = { 
      success:'#16a34a', 
      error:'#dc2626', 
      warning:'#d97706', 
      info:'#0ea5e9' 
    }; 
    el.style.background = colors[type] || colors.info;
    
    document.body.appendChild(el); 
    requestAnimationFrame(()=>{ el.style.transform='translateX(0)'; });
    
    const close=()=>{ 
      el.style.transform='translateX(120%)'; 
      el.style.opacity='0'; 
      setTimeout(()=>el.remove(), 240); 
    };
    
    setTimeout(close, 3500); 
    el.addEventListener('click', close);
  }

  // ===== Loading =====
  const showLoading = ()=>{ if (loadingOverlay) loadingOverlay.style.display='flex'; };
  const hideLoading = ()=>{ if (loadingOverlay) loadingOverlay.style.display='none'; };

  // ===== API wrappers =====
  async function apiGetQuizzes(){
    if (!hasAPI || !window.api.loadQuizzes) return null;
    try { 
      const r = await window.api.loadQuizzes();
      if (Array.isArray(r)) return r; 
      return []; 
    } catch (e){ 
      console.error(e); 
      showToast(window.I18n ? I18n.t('quizzes.toast.load_quizzes_failed') : 'تعذّر تحميل الاختبارات','error'); 
      return []; 
    }
  }

  async function apiGetGroups(){
    if (!hasAPI || !window.api.loadGroups) return null;
    try {
      const r = await window.api.loadGroups();
      if (Array.isArray(r)) return r;
      return [];
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async function apiSaveQuizzes(quizzes){ 
    if (!hasAPI || !window.api.saveQuizzes) return false; 
    try { 
      const r = await window.api.saveQuizzes(quizzes); 
      return r?.ok !== false; 
    } catch(e){ 
      console.error(e); 
      showToast(window.I18n ? I18n.t('quizzes.toast.save_quizzes_failed') : 'فشل حفظ الاختبارات','error'); 
      return false; 
    } 
  }

  // ===== Quiz Loading =====
  async function loadQuiz(){
    const urlParams = new URLSearchParams(window.location.search);
    const quizId = urlParams.get('id');
    
    if (!quizId) {
      showToast(window.I18n ? I18n.t('quizzes.editor.toast.quiz_id_missing') : 'معرف الاختبار غير موجود', 'error');
      window.location.href = '/#/quizzes';
      return;
    }

    showLoading();
    try {
      let quizzes = [];
      let groups = [];
      
      if (hasAPI && window.api.loadQuiz) {
        // Load single quiz with full questions via dedicated IPC handler
        const quizData = await window.api.loadQuiz(quizId);
        if (quizData && quizData.id) {
          currentQuiz = quizData;
          // Resolve group name from groups list for header
          const groupsData = await apiGetGroups();
          const grpList = Array.isArray(groupsData) ? groupsData : loadLocal(LS_GROUPS);
          const grp = grpList.find(g => g.id === currentQuiz.groupId);
          if (grp) currentQuiz.groupName = grp.name;
        } else {
          // Fallback to localStorage
          const localQuizzes = loadLocal(LS_QUIZZES);
          currentQuiz = localQuizzes.find(q => q.id === quizId);
        }
      } else {
        const localQuizzes = loadLocal(LS_QUIZZES);
        currentQuiz = localQuizzes.find(q => q.id === quizId);
      }

      if (!currentQuiz) {
        showToast(window.I18n ? I18n.t('quizzes.toast.quiz_not_found') : 'الاختبار غير موجود', 'error');
        window.location.href = '/#/quizzes';
        return;
      }

      questions = currentQuiz.questions || [];
      // إصلاح سريع لأسئلة قديمة تفتقد correctAnswer أو تحتويه بشكل غير صالح
      const fixes = quickRepairQuestions();
      if (fixes > 0) {
        // احفظ فورًا لضمان اتساق البيانات بعد الإصلاح
        try { await saveQuiz(); } catch {}
      }
      updateQuizInfo();
      updateStats();
      renderQuestions();
    } finally {
      hideLoading();
    }
  }

  // ===== Quiz Info =====
  function updateQuizInfo(){
    if (!currentQuiz) return;
    
    if (quizNameEl) quizNameEl.textContent = currentQuiz.name;
    if (quizMetaEl) {
      const questionsCount = questions.length;
      const label = window.I18n ? I18n.t('quizzes.editor.meta.questions_word') : 'أسئلة';
      quizMetaEl.textContent = `${questionsCount} ${label}`;
    }
  }

  function updateStats(){
    const questionsCount = questions.length;
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    
    if (questionsCountEl) questionsCountEl.textContent = questionsCount;
    if (totalPointsEl) totalPointsEl.textContent = totalPoints;
  }

  // إصلاح سريع للبيانات القديمة: يضبط correctAnswer إذا كان مفقودًا أو غير صالح
  function quickRepairQuestions(){
    let repaired = 0, rTF = 0, rMCQ = 0, rDD = 0;
    questions = (questions || []).map(q => {
      if (!q) return q;
      // ضمان وجود مصفوفة خيارات
      if (!Array.isArray(q.options)) q.options = [];
      if (q.type === 'tf') {
        if (q.options.length < 2) q.options = [
          window.I18n ? I18n.t('quizzes.editor.tf.true') : 'صح',
          window.I18n ? I18n.t('quizzes.editor.tf.false') : 'خطأ'
        ];
        const valid = typeof q.correctAnswer === 'number' && (q.correctAnswer === 0 || q.correctAnswer === 1);
        if (!valid) { q.correctAnswer = 0; repaired++; rTF++; }
      } else if (q.type === 'mcq' || q.type === 'dropdown') {
        // تحويل dropdown القديم إلى mcq
        if (q.type === 'dropdown') q.type = 'mcq';
        // لا يمكن الإصلاح إن لم تتوفر خيارات كافية
        if (q.options.length >= 2) {
          const valid = typeof q.correctAnswer === 'number' && q.correctAnswer >= 0 && q.correctAnswer < q.options.length;
          if (!valid) { q.correctAnswer = 0; repaired++; rMCQ++; }
        }
      }
      return q;
    });
    if (repaired > 0) {
      const msg = window.I18n
        ? `${I18n.t('quizzes.editor.repair.fixed_prefix') || ''} ${repaired} ${I18n.t('quizzes.editor.meta.questions_word') || 'أسئلة'} (TF: ${rTF}, MCQ: ${rMCQ}, Dropdown: ${rDD}) — ${I18n.t('quizzes.editor.repair.review_hint') || 'يرجى المراجعة'}`
        : `تم إصلاح ${repaired} سؤالًا (TF: ${rTF}, MCQ: ${rMCQ}, Dropdown: ${rDD}) — يرجى المراجعة`;
      showToast(msg, 'warning');
    }
    return repaired;
  }
  
  // ===== Preview & Export =====
  function buildPrintableHTML(){
    const title = escapeHTML(currentQuiz?.name || (window.I18n ? I18n.t('quizzes.editor.fallback.quiz') : 'اختبار'));
    const today = new Date();
    const dateStr = today.toLocaleDateString(document.documentElement.lang || (window.I18n?.lang || 'ar'));
    const totalQ = questions.length;

    const items = questions.map((q, i) => {
      const opts = (q.options || []).map((op, idx) => `
        <div class="opt"><span class="bubble">${idx + 1}</span><span>${escapeHTML(op)}</span></div>
      `).join('');
      return `
        <section class="q" aria-label="question">
          <div class="q-head">
            <div class="q-no">${i+1}</div>
            <div class="q-title">${escapeHTML(q.text)}</div>
            <div class="q-pts">${q.points || 1} ${(window.I18n ? I18n.t('quizzes.editor.print.points_suffix') : 'نقطة')}</div>
          </div>
          ${q.image ? `<div class=\"q-img\"><img src=\"${q.image}\" alt=\"${window.I18n ? I18n.t('quizzes.editor.print.image_alt') : 'صورة السؤال'}\"></div>` : ''}
          ${opts ? `<div class=\"opts\">${opts}</div>` : ''}
          ${(!q.options || q.options.length === 0) ? '<div class="answer-lines"></div>' : ''}
        </section>
      `;
    }).join('');

    return `
      <!doctype html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8">
        <title>${title} - PDF</title>
        <style>
          @page { size: A4; margin: 18mm 14mm; }
          html, body { height: 100%; }
          body { font-family: Cairo, Arial, sans-serif; color:#111827; }
          .wrap { display:block; }

          /* Header */
          .header { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #e5e7eb; padding-bottom:12px; margin-bottom:14px; }
          .hdr-left { display:flex; align-items:center; gap:10px; }
          .logo { width:36px; height:36px; border-radius:8px; background:#eef2ff; display:flex; align-items:center; justify-content:center; font-weight:800; color:#4338ca; }
          .title { font-size:18px; font-weight:800; }
          .meta { font-size:12px; color:#6b7280; display:flex; gap:10px; }

          /* Footer */
          .footer { position:fixed; bottom:0; left:0; right:0; height:24px; border-top:1px solid #e5e7eb; font-size:10px; color:#6b7280; display:flex; align-items:center; justify-content:space-between; padding-top:4px; }
          .pagenum:before { content: counter(page); }

          /* Watermark */
          .wm { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; opacity:0.06; font-size:64px; font-weight:900; color:#111827; pointer-events:none; }

          /* Questions */
          .q { break-inside: avoid; border:1px solid #e5e7eb; border-radius:10px; padding:12px; margin-bottom:12px; }
          .q-head { display:grid; grid-template-columns: 48px 1fr 80px; gap:10px; align-items:center; margin-bottom:8px; }
          .q-no { width:48px; height:48px; border-radius:12px; background:#f3f4f6; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:18px; color:#111827; }
          .q-title { font-weight:700; }
          .q-pts { text-align:center; font-size:12px; color:#6b7280; }
          .q-img { margin:8px 0; }
          .q-img img { max-width:100%; border-radius:10px; border:1px solid #e5e7eb; }
          .opts { display:grid; grid-template-columns: 1fr 1fr; gap:8px 16px; margin-top:8px; }
          .opt { display:flex; align-items:center; gap:8px; }
          .bubble { display:inline-flex; width:22px; height:22px; border-radius:50%; background:#eef2ff; color:#4338ca; font-weight:700; align-items:center; justify-content:center; font-size:12px; border:1px solid #dbeafe; }

          /* Answer lines for open questions */
          .answer-lines { height:72px; margin-top:10px; background: repeating-linear-gradient(0deg, #fff, #fff 20px, #e5e7eb 21px); border-radius:8px; border:1px solid #e5e7eb; }

          /* Print helpers */
          @media print {
            .footer { position: fixed; }
          }
        </style>
      </head>
      <body>
        <div class="wm">Classroom Manager</div>
        <header class="header">
          <div class="hdr-left">
            <div class="logo" style="background:none; border:none;">
              <img src="/assets/icon.gif" alt="Active Class" style="width:36px;height:36px;border-radius:8px;">
            </div>
            <div>
              <div class="title">${title}</div>
              <div class="meta">
                <span>${window.I18n ? I18n.t('quizzes.editor.print.meta.date') : 'التاريخ:'} ${dateStr}</span>
                <span>${window.I18n ? I18n.t('quizzes.editor.print.meta.questions') : 'الأسئلة:'} ${totalQ}</span>
              </div>
            </div>
          </div>
          <div class="meta">
            <span>${window.I18n ? I18n.t('quizzes.editor.print.meta.teacher') : 'المعلم:'} ${escapeHTML(getTeacherName())}</span>
            <span>${window.I18n ? I18n.t('quizzes.editor.group') : 'المجموعة:'} ${escapeHTML(currentQuiz?.groupName || '')}</span>
          </div>
        </header>

        <main class="wrap">
          ${items}
        </main>

        <footer class="footer">
          <div>Classroom Manager</div>
          <div>${document.documentElement.lang === 'ar' ? 'صفحة' : 'Page'} <span class="pagenum"></span></div>
        </footer>
      </body>
      </html>
    `;
  }

  function renderPreviewPane(){
    if (!previewPane) return;
    const html = questions.map((q, i) => {
      const opts = (q.options || []).map((op, idx) => `<div>(${idx + 1}) ${escapeHTML(op)}</div>`).join('');
      return `
        <div style="border-bottom:1px solid #eee; padding:10px 0;">
          <div style="font-weight:700; margin-bottom:6px;">${i+1}. ${escapeHTML(q.text)}</div>
          ${q.image ? `<div style=\"margin:8px 0\"><img src=\"${q.image}\" style=\"max-width:100%\"/></div>` : ''}
          ${opts}
        </div>
      `;
    }).join('');
    previewPane.innerHTML = html || `<div style="color:#666">${window.I18n ? I18n.t('quizzes.editor.empty.title') : 'لا توجد أسئلة للمعاينة'}</div>`;
  }

  function openPreviewModal(){
    renderPreviewPane();
    if (previewModal) previewModal.style.display = 'flex';
  }

  function closePreviewModal(){
    if (previewModal) previewModal.style.display = 'none';
  }

  function doInteractivePreview(){
    try {
      // Build preview object from current editor state (includes unsaved changes)
      const quizForPreview = currentQuiz ? { 
        ...currentQuiz, 
        questions: Array.isArray(questions) ? [...questions] : (currentQuiz.questions || []) 
      } : null;

      // Keep using id in URL if available (helps when child tries API/localStorage)
      const urlParams = new URLSearchParams(window.location.search);
      const quizId = urlParams.get('id') || (currentQuiz && currentQuiz.id) || '';

      // Try opening in a new window
      const w = window.open(`/pages/quiz-view.html${quizId ? `?id=${quizId}` : ''}`,
        'quiz_preview',
        'width=1200,height=800,scrollbars=yes,resizable=yes');
      if (w) {
        if (quizForPreview) {
          // Provide data directly to the preview window for immediate rendering
          w.quizData = quizForPreview;
          // Re-apply on load to avoid race conditions
          w.addEventListener('load', () => { try { w.quizData = quizForPreview; } catch {} });
        }
        w.focus();
        return;
      }

      // Popup blocked → open in same tab and pass data via global
      if (quizForPreview) window.quizData = quizForPreview;
      window.location.href = `/pages/quiz-view.html${quizId ? `?id=${quizId}` : ''}`;
    } catch (e) {
      showToast(window.I18n ? I18n.t('quizzes.editor.toast.interactive_preview_failed') : 'تعذر فتح المعاينة التفاعلية', 'error');
    }
  }

  function exportQuestionsPDF(){
    // إنشاء تبويب للطباعة يمكن حفظه PDF
    const html = buildPrintableHTML();
    const printWindow = window.open('', 'quiz_pdf');
    if (!printWindow) { showToast(window.I18n ? I18n.t('quizzes.editor.toast.print_window_failed') : 'تعذر فتح نافذة الطباعة', 'warning'); return; }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    // انتظر تحميل الصور ثم اطبع
    printWindow.onload = () => {
      try { printWindow.focus(); printWindow.print(); } catch {}
    };
  }

  // ===== Question Management =====
  function createQuestion(data){
    return {
      id: uid(),
      type: data.type || 'mcq',
      text: data.text || '',
      image: data.image || null,
      options: data.options || [],
      // حافظ على 0 كقيمة صالحة للإجابة الصحيحة
      correctAnswer: (typeof data.correctAnswer === 'number') ? data.correctAnswer : null,
      difficulty: data.difficulty || 'medium',
      points: parseInt(data.points) || 1,
      explanation: data.explanation || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function getQuestionTypeLabel(type){
    const types = {
      mcq: 'اختيار متعدد',
      tf: 'صح/خطأ',
      match: 'مطابقة',
      fill: 'ملء الفراغات'
    };
    return types[type] || type;
  }

  function getDifficultyLabel(difficulty){
    const difficulties = {
      easy: 'سهل',
      medium: 'متوسط',
      hard: 'صعب'
    };
    return difficulties[difficulty] || difficulty;
  }

  // ===== Rendering =====
  function renderQuestions(){
    if (!questionsList) return;

    const groupedByTypeEl = document.getElementById('groupedByType');

    if (questions.length === 0) {
      if (questionsList) questionsList.style.display = 'none';
      if (emptyState) emptyState.style.display = 'none';
      // نعرض الأقسام حسب النوع حتى لو لم توجد أسئلة
    }

    if (questionsList) questionsList.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';

    // القائمة المسطحة مخفية — سنعرض الأقسام المجمّعة فقط
    /*
    questionsList.innerHTML = questions.map((question, index) => `
      <div class="question-card" data-question-id="${question.id}">
        <div class="question-header" onclick="toggleQuestion('${question.id}')">
          <div class="question-info">
            <div class="question-number">السؤال ${index + 1}</div>
            <h3 class="question-title">${escapeHTML(question.text.substring(0, 100))}${question.text.length > 100 ? '...' : ''}</h3>
            <div class="question-meta">
              <span class="question-type ${question.type}">${getQuestionTypeLabel(question.type)}</span>
              <span class="question-difficulty ${question.difficulty}">${getDifficultyLabel(question.difficulty)}</span>
              <span>${question.points || 1} نقطة</span>
              ${question.options ? `<span>${question.options.length} خيارات</span>` : ''}
            </div>
          </div>
          <div class="question-actions" onclick="event.stopPropagation()">
            <button class="action-btn" onclick="editQuestion('${question.id}')" title="تعديل">✏️</button>
            <button class="action-btn" onclick="duplicateQuestion('${question.id}')" title="نسخ">📋</button>
            <button class="action-btn" onclick="moveQuestionUp(${index})" title="تحريك لأعلى" ${index === 0 ? 'disabled' : ''}>⬆️</button>
            <button class="action-btn" onclick="moveQuestionDown(${index})" title="تحريك لأسفل" ${index === questions.length - 1 ? 'disabled' : ''}>⬇️</button>
            <button class="action-btn danger" onclick="deleteQuestion('${question.id}')" title="حذف">🗑️</button>
          </div>
        </div>
        <div class="question-body">${renderQuestionBody(question)}</div>
      </div>
    `).join('');

    */

    // Grouped by type sections
    if (groupedByTypeEl) {
      const order = ['mcq','tf','match','fill'];
      const labels = { mcq:'اختيار متعدد', tf:'صح/خطأ', match:'مطابقة', fill:'ملء الفراغات' };
      const groups = order.map(t => ({ type:t, items: [] }));
      questions.forEach(q => {
        const g = groups.find(x => x.type === q.type) || groups[groups.length-1];
        g.items.push(q);
      });

      groupedByTypeEl.innerHTML = groups
        // إظهار جميع الأنواع حتى لو بدون أسئلة
        .map(g => {
          const idxIcon = {
            mcq:'🅰️', tf:'✔️', match:'🔗', fill:'➖'
          }[g.type] || '❓';
          const body = g.items.map((q, i) => {
            const index = questions.indexOf(q);
            return `
              <div class="question-card" data-question-id="${q.id}">
                <div class="question-header" onclick="toggleQuestion('${q.id}')">
                  <div class="question-info">
                    <div class="question-number">السؤال ${index + 1}</div>
                    <h3 class="question-title">${escapeHTML(q.text.substring(0, 100))}${q.text.length > 100 ? '...' : ''}</h3>
                    <div class="question-meta">
                      <span class="question-type ${q.type}">${getQuestionTypeLabel(q.type)}</span>
                      <span class="question-difficulty ${q.difficulty}">${getDifficultyLabel(q.difficulty)}</span>
                      <span>${q.points || 1} نقطة</span>
                      ${q.options ? `<span>${q.options.length} خيارات</span>` : ''}
                    </div>
                  </div>
                  <div class="question-actions" onclick="event.stopPropagation()">
                    <button class="action-btn" onclick="editQuestion('${q.id}')" title="تعديل">✏️</button>
                    <button class="action-btn" onclick="duplicateQuestion('${q.id}')" title="نسخ">📋</button>
                    <button class="action-btn" onclick="moveQuestionUp(${index})" title="تحريك لأعلى" ${index === 0 ? 'disabled' : ''}>⬆️</button>
                    <button class="action-btn" onclick="moveQuestionDown(${index})" title="تحريك لأسفل" ${index === questions.length - 1 ? 'disabled' : ''}>⬇️</button>
                    <button class="action-btn danger" onclick="deleteQuestion('${q.id}')" title="حذف">🗑️</button>
                  </div>
                </div>
                <div class="question-body">${renderQuestionBody(q)}</div>
              </div>`;
          }).join('');
          return `
            <section class="type-section" data-type="${g.type}">
              <div class="type-header">
                <div class="type-title"><span>${idxIcon}</span><span>${labels[g.type]}</span></div>
                <div style="display:flex; align-items:center; gap:.5rem;">
                  <span class="type-count">${g.items.length} سؤال</span>
                  <button class="control-btn primary" data-add-type="${g.type}" title="إضافة سؤال من هذا النوع">➕ إضافة</button>
                  <button class="type-toggle" data-type-toggle="${g.type}">توسيع</button>
                </div>
              </div>
              <div class="type-body">${body || '<div class="text-muted" style="color:#64748b;">لا توجد أسئلة من هذا النوع بعد</div>'}</div>
            </section>`;
        }).join('');

      // Wire add buttons
      groupedByTypeEl.querySelectorAll('[data-add-type]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const t = e.currentTarget.getAttribute('data-add-type');
          showQuestionModal(null, t);
        });
      });

      // Wire toggle buttons
      groupedByTypeEl.querySelectorAll('[data-type-toggle]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const t = e.currentTarget.getAttribute('data-type-toggle');
          const sec = groupedByTypeEl.querySelector(`.type-section[data-type="${t}"] .type-body`);
          // طي افتراضي عند البناء الأول
          if (sec && sec.dataset.initCollapsed !== '1') {
            sec.style.display = 'none';
            sec.dataset.initCollapsed = '1';
          }
          if (!sec) return;
          const hidden = sec.style.display === 'none';
          sec.style.display = hidden ? 'block' : 'none';
          e.currentTarget.textContent = hidden ? 'طي' : 'توسيع';
          // تركيز على القسم بعد التوسيع
          if (hidden) {
            e.currentTarget.closest('.type-section')?.scrollIntoView({behavior:'smooth', block:'nearest'});
          }
        });
      });
    }
  }

  function renderQuestionBody(question){
    let html = `<div class="question-text">${escapeHTML(question.text)}</div>`;
    
    if (question.image) {
      html += `<img src="${question.image}" alt="صورة السؤال" class="question-image">`;
    }

    if (question.options && question.options.length > 0) {
      html += '<div class="question-options">';
      question.options.forEach((option, index) => {
        const isCorrect = question.correctAnswer === index || 
                         (Array.isArray(question.correctAnswer) && question.correctAnswer.includes(index));
        const label = (index + 1).toString(); // 1, 2, 3, 4...
        
        html += `
          <div class="option-item ${isCorrect ? 'correct' : 'incorrect'}">
            <span class="option-label">${label})</span>
            <span class="option-text">${escapeHTML(option)}</span>
          </div>
        `;
      });
      html += '</div>';
    }



    return html;
  }

  // ===== Question Modal =====
  function showQuestionModal(question = null, presetType = null){
    if (!questionModal) return;

    isEditing = !!question;
    currentQuestionId = question ? question.id : null;
    
    if (questionModalTitle) {
      questionModalTitle.textContent = isEditing ? 'تعديل السؤال' : 'إضافة سؤال جديد';
    }

    // Reset form
    if (questionForm) questionForm.reset();
    if (optionsContainer) optionsContainer.innerHTML = '';
    if (imagePreview) imagePreview.style.display = 'none';

    if (question) {
      // Fill form with question data
      if (questionType) questionType.value = question.type;
      if (questionText) questionText.value = question.text;
      if (questionDifficulty) questionDifficulty.value = question.difficulty;
      if (questionPoints) questionPoints.value = question.points;
      
      if (question.image) {
        if (previewImg) previewImg.src = question.image;
        if (imagePreview) imagePreview.style.display = 'block';
      }
    }

    // Generate options based on type
    const type = question ? question.type : (presetType || 'mcq');
    if (questionType && !question) questionType.value = type;
    generateOptionsForType(type, question);

    questionModal.style.display = 'flex';
  }

  function generateOptionsForType(type, question = null){
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';

    switch (type) {
      case 'mcq':
        generateMCQOptions(question);
        break;
      case 'tf':
        generateTFOptions(question);
        break;
      case 'match':
        generateMatchingOptions(question);
        break;
      case 'fill':
        generateFillOptions(question);
        break;
    }
  }

  function generateMCQOptions(question = null){
    const options = question ? question.options : ['', '', '', ''];
    const correctAnswer = (question && typeof question.correctAnswer === 'number') ? question.correctAnswer : null;

    optionsContainer.innerHTML = `
      <div class="options-layout">
        <div class="options-side">
          <div class="options-tools-vertical">
            <button type="button" class="add-option-btn" onclick="addMCQOption()">➕ إضافة خيار</button>
            <div class="correct-answer-note"><small>⚠️ يرجى اختيار الإجابة الصحيحة بالنقر على الدائرة بجانب الخيار المناسب</small></div>
          </div>
        </div>
        <div id="mcqOptions">
          ${options.map((option, index) => `
            <div class="option-input-group">
              <input type="radio" name="correctAnswer" value="${index}" class="option-radio" ${correctAnswer === index ? 'checked' : ''} id="radio_${index}">
              <label for="radio_${index}" class="radio-label">✓</label>
              <input type="text" class="option-input" placeholder="الخيار ${index + 1}" value="${escapeHTML(option)}" data-option-index="${index}">
              ${options.length > 2 ? `<button type="button" class="remove-option-btn" onclick="removeOption(${index})">حذف</button>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    
    // إضافة مستمعي الأحداث للتحقق من الإجابة الصحيحة
    addOptionEventListeners();
  }

  function generateTFOptions(question = null){
    const correctAnswer = (question && typeof question.correctAnswer === 'number') ? question.correctAnswer : null;

    optionsContainer.innerHTML = `
      <h4>الإجابة الصحيحة:</h4>
      <div class="option-input-group">
        <input type="radio" name="correctAnswer" value="0" class="option-radio" ${correctAnswer === 0 ? 'checked' : ''} id="radio_tf_0">
        <label for="radio_tf_0">صح</label>
      </div>
      <div class="option-input-group">
        <input type="radio" name="correctAnswer" value="1" class="option-radio" ${correctAnswer === 1 ? 'checked' : ''} id="radio_tf_1">
        <label for="radio_tf_1">خطأ</label>
      </div>
    `;

    // تفعيل التمييز البصري عند اختيار الإجابة الصحيحة
    addOptionEventListeners();
  }

  // Removed: generateDropdownOptions (dropdown type deprecated)

  // دالة لإضافة مستمعي الأحداث للخيارات
  function addOptionEventListeners() {
    // إضافة تأكيد بصري عند اختيار الإجابة الصحيحة
    const radioButtons = optionsContainer.querySelectorAll('input[name="correctAnswer"]');
    radioButtons.forEach(radio => {
      radio.addEventListener('change', function() {
        // إزالة التأكيد البصري من جميع الخيارات
        const allGroups = optionsContainer.querySelectorAll('.option-input-group');
        allGroups.forEach(group => group.classList.remove('correct-selected'));
        
        // إضافة التأكيد البصري للخيار المختار
        if (this.checked) {
          const parentGroup = this.closest('.option-input-group');
          if (parentGroup) {
            parentGroup.classList.add('correct-selected');
          }
        }
      });
    });
    
    // تفعيل التأكيد البصري للخيار المختار مسبقاً
    const checkedRadio = optionsContainer.querySelector('input[name="correctAnswer"]:checked');
    if (checkedRadio) {
      const parentGroup = checkedRadio.closest('.option-input-group');
      if (parentGroup) {
        parentGroup.classList.add('correct-selected');
      }
    }
  }

  function generateMatchingOptions(question = null){
    optionsContainer.innerHTML = `
      <h4>أسئلة المطابقة:</h4>
      <p class="text-sm text-gray-600">قيد التطوير...</p>
    `;
  }

  function generateFillOptions(question = null){
    optionsContainer.innerHTML = `
      <h4>إجابات الفراغات:</h4>
      <p class="text-sm text-gray-600">استخدم [___] في النص للإشارة إلى الفراغات</p>
      <div id="fillAnswers">
        <input type="text" class="form-input" placeholder="الإجابة الصحيحة للفراغ الأول">
      </div>
    `;
  }

  // ===== Event Handlers =====

  // Question Type Change
  if (questionType) {
    questionType.addEventListener('change', (e) => {
      generateOptionsForType(e.target.value);
    });
  }

  // Image Upload
  if (questionImage) {
    questionImage.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (previewImg) previewImg.src = e.target.result;
          if (imagePreview) imagePreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', () => {
      if (questionImage) questionImage.value = '';
      if (imagePreview) imagePreview.style.display = 'none';
    });
  }

  // Add Question (works from main toolbar or empty-state button)
  if (addQuestionBtn) {
    addQuestionBtn.addEventListener('click', () => {
      showQuestionModal();
    });
  }

  // Navigate back to quizzes list (CSP-safe)
  if (goToQuizzesBtn) {
    goToQuizzesBtn.addEventListener('click', () => {
      window.location.href = '/#/quizzes';
    });
  }

  // Save Question
  if (saveQuestionBtn) {
    saveQuestionBtn.addEventListener('click', async () => {
      const formData = new FormData(questionForm);
      const questionData = {
        type: formData.get('questionType') || questionType?.value,
        text: questionText?.value?.trim(),
        difficulty: questionDifficulty?.value,
        points: parseInt(questionPoints?.value) || 1,
        explanation: questionExplanation?.value?.trim()
      };

      if (!questionData.text) {
        showToast('يرجى إدخال نص السؤال', 'warning');
        return;
      }

      // Get options based on type
      const options = [];
      let correctAnswer = null;

      if (questionData.type === 'mcq') {
        const optionInputs = optionsContainer?.querySelectorAll('.option-input');
        const correctRadio = optionsContainer?.querySelector('input[name="correctAnswer"]:checked');
        
        // جمع جميع الخيارات مع الحفاظ على الترقيم الأصلي
        const allOptions = [];
        optionInputs?.forEach(input => {
          allOptions.push(input.value.trim());
        });
        
        // إزالة الخيارات الفارغة من النهاية فقط
        while (allOptions.length > 0 && allOptions[allOptions.length - 1] === '') {
          allOptions.pop();
        }
        
        // التأكد من وجود خيارين على الأقل
        if (allOptions.length < 2) {
          showToast('يجب إدخال خيارين على الأقل', 'warning');
          return;
        }
        
        // التحقق من أن جميع الخيارات المتبقية غير فارغة
        for (let i = 0; i < allOptions.length; i++) {
          if (allOptions[i] === '') {
            showToast(`يرجى ملء الخيار ${i + 1}`,'warning');
            return;
          }
        }
        
        options.push(...allOptions);
        
        // التحقق من اختيار إجابة صحيحة
        if (!correctRadio) {
          showToast('يرجى اختيار الإجابة الصحيحة', 'warning');
          return;
        }
        
        const selectedIndex = parseInt(correctRadio.value);
        
        // التأكد من أن الإجابة الصحيحة ضمن النطاق المسموح
        if (selectedIndex >= options.length) {
          showToast('الإجابة الصحيحة المختارة غير صالحة', 'warning');
          return;
        }
        
        correctAnswer = selectedIndex;
      } else if (questionData.type === 'tf') {
        options.push('صح', 'خطأ');
        const correctRadio = optionsContainer?.querySelector('input[name="correctAnswer"]:checked');
        if (!correctRadio) {
          showToast('يرجى اختيار الإجابة الصحيحة', 'warning');
          return;
        }
        correctAnswer = parseInt(correctRadio.value);
      }

      questionData.options = options;
      questionData.correctAnswer = correctAnswer;

      // Remove explanation from saved data if present
      if (questionData && 'explanation' in questionData) {
        delete questionData.explanation;
      }

      // Handle image
      if (previewImg?.src && previewImg.src.startsWith('data:')) {
        questionData.image = previewImg.src;
      }

      if (isEditing && currentQuestionId) {
        // Update existing question
        const index = questions.findIndex(q => q.id === currentQuestionId);
        if (index !== -1) {
          questions[index] = { ...questions[index], ...questionData, updatedAt: new Date().toISOString() };
        }
      } else {
        // Add new question
        const newQuestion = createQuestion(questionData);
        questions.push(newQuestion);
      }

      await saveQuiz();
      updateStats();
      renderQuestions();
      
      if (questionModal) questionModal.style.display = 'none';
      showToast(isEditing ? 'تم تحديث السؤال بنجاح' : 'تم إضافة السؤال بنجاح', 'success');
    });
  }

  // Cancel Question
  if (cancelQuestionBtn) {
    cancelQuestionBtn.addEventListener('click', () => {
      if (questionModal) questionModal.style.display = 'none';
    });
  }

  // Modal Close
  if (questionModalClose) {
    questionModalClose.addEventListener('click', () => {
      if (questionModal) questionModal.style.display = 'none';
    });
  }

  // Delete Question Modal
  if (deleteQuestionModalClose) {
    deleteQuestionModalClose.addEventListener('click', () => {
      if (deleteQuestionModal) deleteQuestionModal.style.display = 'none';
    });
  }

  if (cancelDeleteQuestionBtn) {
    cancelDeleteQuestionBtn.addEventListener('click', () => {
      if (deleteQuestionModal) deleteQuestionModal.style.display = 'none';
    });
  }

  if (confirmDeleteQuestionBtn) {
    confirmDeleteQuestionBtn.addEventListener('click', async () => {
      if (currentQuestionId) {
        const index = questions.findIndex(q => q.id === currentQuestionId);
        if (index !== -1) {
          questions.splice(index, 1);
          await saveQuiz();
          updateStats();
          renderQuestions();
          showToast('تم حذف السؤال بنجاح', 'success');
        }
      }
      if (deleteQuestionModal) deleteQuestionModal.style.display = 'none';
    });
  }

  // Save Quiz
  if (saveQuizBtn) {
    saveQuizBtn.addEventListener('click', saveQuiz);
  }

  // Search
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      // Implement search functionality
      renderQuestions();
    }));
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      renderQuestions();
    });
  }

  // Expand/Collapse All
  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', () => {
      const grouped = document.getElementById('groupedByType');
      if (grouped) {
        grouped.querySelectorAll('.type-body').forEach(sec => sec.style.display = 'block');
        grouped.querySelectorAll('[data-type-toggle]').forEach(btn => btn.textContent = 'طي');
      }
    });
  }

  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', () => {
      const grouped = document.getElementById('groupedByType');
      if (grouped) {
        grouped.querySelectorAll('.type-body').forEach(sec => sec.style.display = 'none');
        grouped.querySelectorAll('[data-type-toggle]').forEach(btn => btn.textContent = 'توسيع');
      }
    });
  }

  // ===== Global Functions =====
  window.toggleQuestion = function(questionId) {
    const card = document.querySelector(`[data-question-id="${questionId}"]`);
    if (card) {
      card.classList.toggle('expanded');
    }
  };

  window.editQuestion = function(questionId) {
    const question = questions.find(q => q.id === questionId);
    if (question) {
      showQuestionModal(question);
    }
  };

  window.duplicateQuestion = function(questionId) {
    const question = questions.find(q => q.id === questionId);
    if (question) {
      const duplicate = { ...question, id: uid(), createdAt: new Date().toISOString() };
      questions.push(duplicate);
      saveQuiz();
      updateStats();
      renderQuestions();
      showToast('تم نسخ السؤال بنجاح', 'success');
    }
  };

  window.deleteQuestion = function(questionId) {
    currentQuestionId = questionId;
    if (deleteQuestionModal) deleteQuestionModal.style.display = 'flex';
  };

  window.moveQuestionUp = function(index) {
    if (index > 0) {
      [questions[index], questions[index - 1]] = [questions[index - 1], questions[index]];
      saveQuiz();
      renderQuestions();
    }
  };

  window.moveQuestionDown = function(index) {
    if (index < questions.length - 1) {
      [questions[index], questions[index + 1]] = [questions[index + 1], questions[index]];
      saveQuiz();
      renderQuestions();
    }
  };

  window.addMCQOption = function() {
    const mcqOptions = document.getElementById('mcqOptions');
    if (mcqOptions) {
      const optionCount = mcqOptions.children.length;
      const newOption = document.createElement('div');
      newOption.className = 'option-input-group';
      newOption.innerHTML = `
        <input type="radio" name="correctAnswer" value="${optionCount}" class="option-radio" id="radio_${optionCount}">
        <label for="radio_${optionCount}" class="radio-label">✓</label>
        <input type="text" class="option-input" placeholder="الخيار ${optionCount + 1}" data-option-index="${optionCount}">
        <button type="button" class="remove-option-btn" onclick="removeOption(${optionCount})">حذف</button>
      `;
      mcqOptions.appendChild(newOption);
      
      // إضافة مستمع الأحداث للخيار الجديد
      const newRadio = newOption.querySelector('input[name="correctAnswer"]');
      if (newRadio) {
        newRadio.addEventListener('change', function() {
          const allGroups = optionsContainer.querySelectorAll('.option-input-group');
          allGroups.forEach(group => group.classList.remove('correct-selected'));
          
          if (this.checked) {
            const parentGroup = this.closest('.option-input-group');
            if (parentGroup) {
              parentGroup.classList.add('correct-selected');
            }
          }
        });
      }
    }
  };

  // Removed: addDropdownOption (dropdown type deprecated)

  window.removeOption = function(index) {
    const optionGroups = optionsContainer?.querySelectorAll('.option-input-group');
    if (optionGroups && optionGroups[index] && optionGroups.length > 2) {
      // حفظ الإجابة الصحيحة الحالية قبل الحذف
      const currentCorrectRadio = optionsContainer.querySelector('input[name="correctAnswer"]:checked');
      const currentCorrectIndex = currentCorrectRadio ? parseInt(currentCorrectRadio.value) : 0;
      
      optionGroups[index].remove();
      
      // إعادة ترقيم الخيارات المتبقية
      const remainingGroups = optionsContainer.querySelectorAll('.option-input-group');
      remainingGroups.forEach((group, newIndex) => {
        const radio = group.querySelector('input[type="radio"]');
        const label = group.querySelector('.radio-label');
        const input = group.querySelector('.option-input');
        const button = group.querySelector('.remove-option-btn');
        
        if (radio) {
          radio.value = newIndex;
          radio.id = `radio_${newIndex}`;
          
          // تحديث الإجابة الصحيحة
          if (currentCorrectIndex === index) {
            // إذا تم حذف الإجابة الصحيحة، اختر الأولى
            radio.checked = newIndex === 0;
          } else if (currentCorrectIndex > index) {
            // إذا كانت الإجابة الصحيحة بعد المحذوف، قلل الرقم
            radio.checked = newIndex === (currentCorrectIndex - 1);
          } else {
            // إذا كانت الإجابة الصحيحة قبل المحذوف، احتفظ بها
            radio.checked = newIndex === currentCorrectIndex;
          }
        }
        
        if (label) {
          label.setAttribute('for', `radio_${newIndex}`);
        }
        
        if (input) {
          input.placeholder = `الخيار ${newIndex + 1}`;
          input.setAttribute('data-option-index', newIndex);
        }
        
        if (button) {
          button.setAttribute('onclick', `removeOption(${newIndex})`);
        }
      });
      
      // تحديث التأكيد البصري
      const allGroups = optionsContainer.querySelectorAll('.option-input-group');
      allGroups.forEach(group => group.classList.remove('correct-selected'));
      
      const newCheckedRadio = optionsContainer.querySelector('input[name="correctAnswer"]:checked');
      if (newCheckedRadio) {
        const parentGroup = newCheckedRadio.closest('.option-input-group');
        if (parentGroup) {
          parentGroup.classList.add('correct-selected');
        }
      }
    }
  };

  // ===== Save Quiz =====
  async function saveQuiz(){
    if (!currentQuiz) return;

    showLoading();
    try {
      currentQuiz.updatedAt = new Date().toISOString();

      if (hasAPI && window.api.loadQuiz && window.api.saveQuestion && window.api.deleteQuestion) {
        // Load current DB state to know which questions already exist
        const dbQuiz = await window.api.loadQuiz(currentQuiz.id);
        const dbQuestionIds = new Set((dbQuiz?.questions || []).map(q => q.id));
        const localQuestionIds = new Set(questions.map(q => q.id));

        // Delete questions that were removed from the editor
        for (const dbId of dbQuestionIds) {
          if (!localQuestionIds.has(dbId)) {
            await window.api.deleteQuestion(dbId).catch(() => {});
          }
        }

        // Create or update each question
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          const payload = {
            id: q.id,
            type: q.type,
            text: q.text,
            image: q.image || null,
            options: q.options || [],
            correctAnswer: q.correctAnswer,
            difficulty: q.difficulty || 'medium',
            points: q.points || 1,
            explanation: q.explanation || '',
            position: i
          };
          const result = await window.api.saveQuestion(currentQuiz.id, payload);
          // If this was a new question, update its local id to the DB-assigned UUID
          if (result && result.id && !dbQuestionIds.has(q.id)) {
            questions[i] = { ...q, id: result.id };
          }
        }
      } else {
        // Fallback: localStorage only
        const localQuizzes = loadLocal(LS_QUIZZES);
        const index = localQuizzes.findIndex(q => q.id === currentQuiz.id);
        if (index !== -1) localQuizzes[index] = currentQuiz;
        else localQuizzes.push(currentQuiz);
        saveLocal(LS_QUIZZES, localQuizzes);
      }

      hasUnsavedChanges = false;
      renderQuestions(); // refresh UI with DB-assigned IDs
      showToast('تم حفظ الاختبار بنجاح', 'success');
    } finally {
      hideLoading();
    }
  }

  // ===== Keyboard Shortcuts =====
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveQuiz();
    }
    
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      addQuestionBtn?.click();
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      openPreviewModal();
    }
    
    if (e.key === 'Escape') {
      // Close modals
      if (questionModal && questionModal.style.display !== 'none') {
        questionModal.style.display = 'none';
      }
      if (deleteQuestionModal && deleteQuestionModal.style.display !== 'none') {
        deleteQuestionModal.style.display = 'none';
      }
      if (previewModal && previewModal.style.display !== 'none') {
        previewModal.style.display = 'none';
      }
    }
  });

  // ===== Preview Modal Events =====
  if (previewQuizBtn) previewQuizBtn.addEventListener('click', openPreviewModal);
  if (previewModalClose) previewModalClose.addEventListener('click', () => previewModal.style.display = 'none');
  if (interactivePreviewBtn) interactivePreviewBtn.addEventListener('click', doInteractivePreview);
  if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportQuestionsPDF);

  // ===== Unsaved Changes Warning =====
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = 'لديك تغييرات غير محفوظة. هل تريد المغادرة؟';
    }
  });

  // Track changes
  document.addEventListener('input', () => {
    hasUnsavedChanges = true;
  });

  // ===== Initialization =====
  function setupStickyHeader(){
    const header = document.querySelector('.editor-header');
    if (!header) return;
    const observer = new IntersectionObserver(([e]) => {
      if (!e) return;
      if (e.intersectionRatio < 1) header.classList.add('is-sticky');
      else header.classList.remove('is-sticky');
    }, { threshold: [1] });
    observer.observe(header);
  }

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    loadQuiz();
    setupStickyHeader();
  });

  // If DOM is already ready, run immediately (e.g., cached load)
  if (document.readyState !== 'loading') {
    setupStickyHeader();
    loadQuiz();
  }

})();