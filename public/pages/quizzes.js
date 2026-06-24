'use strict';

// نظام إدارة الاختبارات المطور مع التكامل مع نظام المجموعات
(function(){
  // ===== Environment =====
  const hasAPI = typeof window !== 'undefined' && !!window.api;

  // ===== State =====
  let quizzes = [];
  let groups = [];
  let students = [];
  let submissions = [];
  let currentQuizId = null;
  let currentView = 'grid';
  let filters = {
    search: '',
    group: '',
    status: '',
    showArchived: false,
    showEmpty: true
  };

  // ===== DOM refs =====
  const loadingOverlay = document.getElementById('loadingOverlay');
  const addQuizForm = document.getElementById('addQuizForm');
  const quizTitle = document.getElementById('quizTitle');
  const quizGroup = document.getElementById('quizGroup');
  const searchInput = document.getElementById('searchQuizzes');
  const filterGroup = document.getElementById('filterGroup');
  const filterStatus = document.getElementById('filterStatus');
  const sortBy = document.getElementById('sortBy');
  const showArchived = document.getElementById('showArchived');
  const showEmpty = document.getElementById('showEmpty');
  const resetFilters = document.getElementById('resetFilters');
  const gridViewBtn = document.getElementById('gridViewBtn');
  const listViewBtn = document.getElementById('listViewBtn');
  const gridView = document.getElementById('gridView');
  const listView = document.getElementById('listView');
  const quizzesGrid = document.getElementById('quizzesGrid');
  const quizzesTableBody = document.getElementById('quizzesTableBody');
  const noResultsMessage = document.getElementById('noResultsMessage');
  const clearFiltersBtn = document.getElementById('clearFiltersBtn');
  const homeButton = document.getElementById('homeButton');

  // Stats elements
  const totalQuizzesEl = document.getElementById('totalQuizzes');
  const activeQuizzesEl = document.getElementById('activeQuizzes');
  const totalQuestionsEl = document.getElementById('totalQuestions');
  const totalSubmissionsEl = document.getElementById('totalSubmissions');
  const quizzesCountEl = document.getElementById('quizzesCount');

  // Modal elements
  const quizModal = document.getElementById('quizModal');
  const quizModalClose = document.getElementById('quizModalClose');
  const modalQuizTitle = document.getElementById('modalQuizTitle');
  const modalQuizGroup = document.getElementById('modalQuizGroup');
  const modalQuizDesc = document.getElementById('modalQuizDesc');
  const saveQuiz = document.getElementById('saveQuiz');
  const cancelQuiz = document.getElementById('cancelQuiz');

  const deleteModal = document.getElementById('deleteModal');
  const deleteModalClose = document.getElementById('deleteModalClose');
  const confirmDelete = document.getElementById('confirmDelete');
  const cancelDelete = document.getElementById('cancelDelete');

  const editorModal = document.getElementById('editorModal');
  const editorModalClose = document.getElementById('editorModalClose');

  // ===== LocalStorage Fallback =====
  const LS_QUIZZES = 'cm_quizzes_v1';
  const LS_GROUPS = 'cm_groups_v1';
  const LS_STUDENTS = 'cm_students_v1';
  const LS_SUBMISSIONS = 'cm_quiz_submissions_v1';
  
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

  // ===== Utils =====
  const normalize = (s) => (s || '').toString().trim().toLowerCase();
  const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const debounce = (fn, d=150)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), d); }; };
  function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
  function formatDate(ts){ 
    try { 
      return new Date(ts).toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }); 
    } catch { 
      return ''; 
    } 
  }

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

  // ===== API wrappers (استخدام نفس API المجموعات) =====
  async function apiGetGroups(){
    if (!hasAPI || !window.api.loadGroups) return null;
    try { 
      const r = await window.api.loadGroups();
      if (Array.isArray(r)) return r; 
      return []; 
    } catch (e){ 
      console.error(e); 
      showToast(window.I18n ? I18n.t('quizzes.toast.load_groups_failed') : 'تعذّر تحميل المجموعات','error'); 
      return []; 
    }
  }

  async function apiGetStudents(){
    if (!hasAPI || !window.api.loadStudents) return null;
    try { 
      const r = await window.api.loadStudents();
      if (Array.isArray(r)) return r; 
      return []; 
    } catch(e){ 
      console.error('Error loading students:', e); 
      showToast(window.I18n ? I18n.t('quizzes.toast.load_students_failed') : 'تعذّر تحميل الطلاب','error'); 
      return []; 
    }
  }

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

  async function apiDeleteQuiz(id){ 
    if (!hasAPI || !window.api.deleteQuiz) return false; 
    try { 
      const r = await window.api.deleteQuiz(id); 
      return r?.ok !== false; 
    } catch(e){ 
      console.error(e); 
      showToast(window.I18n ? I18n.t('quizzes.toast.delete_failed') : 'فشل حذف الاختبار','error'); 
      return false; 
    } 
  }

  // ===== Data Loading =====
  async function loadAllData(){
    showLoading();
    try {
      // تحميل المجموعات (استخدام نفس API المجموعات)
      if (hasAPI) {
        const groupsData = await apiGetGroups();
        if (groupsData) groups = groupsData;
        else groups = loadLocal(LS_GROUPS);

        const studentsData = await apiGetStudents();
        if (studentsData) students = studentsData;
        else students = loadLocal(LS_STUDENTS);

        const quizzesData = await apiGetQuizzes();
        if (quizzesData) quizzes = quizzesData;
        else quizzes = loadLocal(LS_QUIZZES);
      } else {
        groups = loadLocal(LS_GROUPS);
        students = loadLocal(LS_STUDENTS);
        quizzes = loadLocal(LS_QUIZZES);
      }

      // Load submissions from SQLite via IPC (no quizId = all results)
      if (hasAPI && window.api.loadQuizSubmissions) {
        try { submissions = await window.api.loadQuizSubmissions() || []; }
        catch { submissions = loadLocal(LS_SUBMISSIONS); }
      } else {
        submissions = loadLocal(LS_SUBMISSIONS);
      }

      populateGroupSelects();
      updateStats();
      render();
    } finally {
      hideLoading();
    }
  }

  // ===== Group Management =====
  function populateGroupSelects(){
    const selects = [quizGroup, filterGroup, modalQuizGroup];
    
    selects.forEach(select => {
      if (!select) return;
      
      // حفظ القيمة المحددة حالياً
      const currentValue = select.value;
      
      // مسح الخيارات الموجودة (عدا الخيار الأول)
      while (select.children.length > 1) {
        select.removeChild(select.lastChild);
      }
      
      // إضافة المجموعات
      groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        select.appendChild(option);
      });
      
      // استعادة القيمة المحددة
      if (currentValue) {
        select.value = currentValue;
      }
    });
  }

  function getGroupName(groupId){
    const group = groups.find(g => g.id === groupId);
    return group ? group.name : (window.I18n ? I18n.t('common.unknown') : 'غير محدد');
  }

  function countStudentsInGroup(groupId){
    return students.filter(s => s.groupId === groupId).length;
  }

  // ===== Quiz Management =====
  function createQuiz(data){
    return {
      id: uid(),
      name: data.name || '',
      description: data.description || '',
      groupId: data.groupId || '',
      questions: [],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: {
        showResults: true,
        randomizeQuestions: false,
        randomizeOptions: false,
        allowReview: true
      }
    };
  }

  function countQuestions(quiz){
    if (typeof quiz.questionsCount === 'number') return quiz.questionsCount;
    return quiz.questions ? quiz.questions.length : 0;
  }

  function countSubmissions(quizId){
    return submissions.filter(s => (s.testId || s.quizId) === quizId).length;
  }

  // ===== Stats =====
  function updateStats(){
    const total = quizzes.length;
    const active = quizzes.filter(q => q.status === 'active').length;
    const totalQuestions = quizzes.reduce((sum, q) => sum + countQuestions(q), 0);
    const totalSubs = submissions.length;

    if (totalQuizzesEl) totalQuizzesEl.textContent = total;
    if (activeQuizzesEl) activeQuizzesEl.textContent = active;
    if (totalQuestionsEl) totalQuestionsEl.textContent = totalQuestions;
    if (totalSubmissionsEl) totalSubmissionsEl.textContent = totalSubs;
  }

  // ===== Filtering & Sorting =====
  function getFilteredQuizzes(){
    let result = [...quizzes];

    // البحث النصي
    if (filters.search) {
      const query = normalize(filters.search);
      result = result.filter(quiz => {
        const searchText = `${normalize(quiz.name)} ${normalize(quiz.description)} ${normalize(getGroupName(quiz.groupId))}`;
        return searchText.includes(query);
      });
    }

    // فلترة المجموعة
    if (filters.group) {
      result = result.filter(quiz => quiz.groupId === filters.group);
    }

    // فلترة الحالة
    if (filters.status) {
      result = result.filter(quiz => quiz.status === filters.status);
    }

    // إظهار المؤرشف
    if (!filters.showArchived) {
      result = result.filter(quiz => quiz.status !== 'archived');
    }

    // إظهار الفارغة
    if (!filters.showEmpty) {
      result = result.filter(quiz => countQuestions(quiz) > 0);
    }

    return result;
  }

  function sortQuizzes(quizzes, sortField = 'name'){
    return quizzes.sort((a, b) => {
      switch (sortField) {
        case 'date':
          return new Date(b.createdAt) - new Date(a.createdAt);
        case 'questions':
          return countQuestions(b) - countQuestions(a);
        case 'submissions':
          return countSubmissions(b.id) - countSubmissions(a.id);
        case 'name':
        default:
          return (a.name || '').localeCompare(b.name || '', 'ar');
      }
    });
  }

  // ===== Rendering =====
  function render(){
    const filtered = getFilteredQuizzes();
    const sorted = sortQuizzes(filtered, sortBy?.value || 'name');

    if (quizzesCountEl) quizzesCountEl.textContent = sorted.length;

    if (sorted.length === 0) {
      if (noResultsMessage) noResultsMessage.style.display = 'block';
      if (gridView) gridView.style.display = 'none';
      if (listView) listView.style.display = 'none';
    } else {
      if (noResultsMessage) noResultsMessage.style.display = 'none';
      
      if (currentView === 'grid') {
        renderGridView(sorted);
      } else {
        renderListView(sorted);
      }
    }
  }

  function renderGridView(quizzes){
    if (!quizzesGrid) return;
    
    if (gridView) gridView.style.display = 'block';
    if (listView) listView.style.display = 'none';

    quizzesGrid.innerHTML = quizzes.map(quiz => `
      <div class="quiz-card" data-quiz-id="${quiz.id}">
        <div class="quiz-header">
          <h3 class="quiz-title">${escapeHTML(quiz.name)}</h3>
          <span class="quiz-status ${quiz.status}">${quiz.status === 'active' ? (window.I18n ? I18n.t('quizzes.status.active') : 'نشط') : (window.I18n ? I18n.t('quizzes.status.archived') : 'مؤرشف')}</span>
        </div>
        <div class="quiz-meta">
          <span>👥 ${escapeHTML(getGroupName(quiz.groupId))}</span>
          <span>❓ ${countQuestions(quiz)} ${(window.I18n ? I18n.t('quizzes.table.questions') : 'الأسئلة')}</span>
          <span>📊 ${countSubmissions(quiz.id)} ${(window.I18n ? I18n.t('quizzes.table.submissions') : 'الإجابات')}</span>
        </div>
        <div class="quiz-actions">
          <button class="action-btn primary" data-action="openQuestionsEditor" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.editor.title') : 'محرر الأسئلة'}" aria-label="${window.I18n ? I18n.t('quizzes.editor.title') : 'محرر الأسئلة'}">✏️ ${window.I18n ? I18n.t('quizzes.editor.title') : 'محرر الأسئلة'}</button>
          <button class="action-btn" data-action="previewQuiz" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.preview') : 'معاينة الاختبار'}" aria-label="${window.I18n ? I18n.t('quizzes.preview') : 'معاينة الاختبار'}">👁️ ${window.I18n ? I18n.t('quizzes.preview') : 'معاينة'}</button>
          <button class="action-btn" data-action="openMetaEditor" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.meta.edit') : 'تعديل الاسم والمجموعة'}" aria-label="${window.I18n ? I18n.t('quizzes.meta.edit') : 'تعديل الاسم والمجموعة'}">🛠️ ${window.I18n ? I18n.t('quizzes.meta.edit') : 'تعديل البيانات'}</button>
          <button class="action-btn" data-action="viewResults" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.results') : 'عرض النتائج'}" aria-label="${window.I18n ? I18n.t('quizzes.results') : 'عرض النتائج'}">📊 ${window.I18n ? I18n.t('quizzes.results') : 'النتائج'}</button>
          <button class="action-btn" data-action="duplicateQuiz" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.duplicate') : 'نسخ الاختبار'}" aria-label="${window.I18n ? I18n.t('quizzes.duplicate') : 'نسخ الاختبار'}">📋 ${window.I18n ? I18n.t('quizzes.duplicate') : 'نسخ'}</button>
          <button class="action-btn qr-share-trigger" data-action="shareQR" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.qr.title') : 'مشاركة QR'}" aria-label="${window.I18n ? I18n.t('quizzes.qr.title') : 'مشاركة QR'}">🔗 ${window.I18n ? I18n.t('quizzes.qr.title') : 'مشاركة QR'}</button>
          <button class="action-btn danger" data-action="deleteQuiz" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.delete.delete_btn') : 'حذف الاختبار'}" aria-label="${window.I18n ? I18n.t('quizzes.delete.delete_btn') : 'حذف الاختبار'}">🗑️ ${window.I18n ? I18n.t('quizzes.delete.delete_btn') : 'حذف'}</button>
        </div>
      </div>
    `).join('');
  }

  function renderListView(quizzes){
    if (!quizzesTableBody) return;
    
    if (gridView) gridView.style.display = 'none';
    if (listView) listView.style.display = 'block';

    quizzesTableBody.innerHTML = quizzes.map(quiz => `
      <tr data-quiz-id="${quiz.id}">
        <td>${escapeHTML(quiz.name)}</td>
        <td>${escapeHTML(getGroupName(quiz.groupId))}</td>
        <td>${countQuestions(quiz)}</td>
        <td>${countSubmissions(quiz.id)}</td>
        <td><span class="quiz-status ${quiz.status}">${quiz.status === 'active' ? (window.I18n ? I18n.t('quizzes.status.active') : 'نشط') : (window.I18n ? I18n.t('quizzes.status.archived') : 'مؤرشف')}</span></td>
        <td>${formatDate(quiz.createdAt)}</td>
        <td>
          <div class="quiz-actions">
            <button class="action-btn primary" data-action="openQuestionsEditor" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.editor.title') : 'محرر الأسئلة'}" aria-label="${window.I18n ? I18n.t('quizzes.editor.title') : 'محرر الأسئلة'}">✏️ ${window.I18n ? I18n.t('quizzes.editor.title') : 'محرر الأسئلة'}</button>
            <button class="action-btn" data-action="previewQuiz" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.preview') : 'معاينة الاختبار'}" aria-label="${window.I18n ? I18n.t('quizzes.preview') : 'معاينة الاختبار'}">👁️ ${window.I18n ? I18n.t('quizzes.preview') : 'معاينة'}</button>
            <button class="action-btn" data-action="openMetaEditor" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.meta.edit') : 'تعديل الاسم والمجموعة'}" aria-label="${window.I18n ? I18n.t('quizzes.meta.edit') : 'تعديل الاسم والمجموعة'}">🛠️ ${window.I18n ? I18n.t('quizzes.meta.edit') : 'تعديل البيانات'}</button>
            <button class="action-btn" data-action="viewResults" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.results') : 'عرض النتائج'}" aria-label="${window.I18n ? I18n.t('quizzes.results') : 'عرض النتائج'}">📊 ${window.I18n ? I18n.t('quizzes.results') : 'النتائج'}</button>
            <button class="action-btn qr-share-trigger" data-action="shareQR" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.qr.title') : 'مشاركة QR'}" aria-label="${window.I18n ? I18n.t('quizzes.qr.title') : 'مشاركة QR'}">🔗 ${window.I18n ? I18n.t('quizzes.qr.title') : 'مشاركة QR'}</button>
            <button class="action-btn danger" data-action="deleteQuiz" data-quiz-id="${quiz.id}" title="${window.I18n ? I18n.t('quizzes.delete.delete_btn') : 'حذف الاختبار'}" aria-label="${window.I18n ? I18n.t('quizzes.delete.delete_btn') : 'حذف الاختبار'}">🗑️ ${window.I18n ? I18n.t('quizzes.delete.delete_btn') : 'حذف'}</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // ===== Event Handlers =====

  // Delegated actions for quiz buttons (CSP-friendly, no inline handlers)
  // Remove old handler from previous page load to prevent accumulation
  if (window.__quizzesClickHandler) {
    document.removeEventListener('click', window.__quizzesClickHandler);
  }
  window.__quizzesClickHandler = (e) => {
    const btn = e.target && e.target.closest('button[data-action][data-quiz-id]');
    if (!btn) return;
    // Scope to quizzes page only
    const inQuizzesSection = !!btn.closest('.quizzes-section');
    if (!inQuizzesSection) return;
    const quizId = btn.getAttribute('data-quiz-id');
    const action = btn.getAttribute('data-action');
    if (!quizId || !action) return;
    try {
      if (action === 'openQuestionsEditor') { window.openQuestionsEditor(quizId); }
      else if (action === 'previewQuiz') { window.previewQuiz(quizId); }
      else if (action === 'openMetaEditor') { window.openMetaEditor(quizId); }
      else if (action === 'viewResults') { window.viewResults(quizId); }
      else if (action === 'duplicateQuiz') { window.duplicateQuiz && window.duplicateQuiz(quizId); }
      else if (action === 'shareQR') { window.openQRShare && window.openQRShare(quizId); }
      else if (action === 'deleteQuiz') { window.deleteQuiz && window.deleteQuiz(quizId); }
    } catch {}
  };
  document.addEventListener('click', window.__quizzesClickHandler);

  // Add Quiz Form
  if (addQuizForm) {
    addQuizForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // نحدد وضع الحفظ: إضافة أم تعديل
      const mode = saveQuiz?.dataset?.mode === 'edit' ? 'edit' : 'add';
      const editingId = saveQuiz?.dataset?.quizId || null;

      const name = quizTitle?.value?.trim();
      const groupId = quizGroup?.value;

      if (!name || !groupId) {
        showToast(window.I18n ? I18n.t('quizzes.toast.fill_required') : 'يرجى ملء جميع الحقول المطلوبة', 'warning');
        return;
      }

      // Trial gate — only block when creating new quiz
      if (mode !== 'edit' && window.trialBlock && window.trialBlock('quizzes', quizzes.length)) return;

      showLoading();
      try {
        if (mode === 'edit' && editingId) {
          // تعديل بيانات الاختبار القائم
          const idx = quizzes.findIndex(q => q.id === editingId);
          if (idx !== -1) {
            quizzes[idx] = { ...quizzes[idx], name, groupId, updatedAt: new Date().toISOString() };
          }

          if (hasAPI && window.api.updateQuiz) {
            const result = await window.api.updateQuiz(editingId, { name, groupId });
            if (!result || result.message) {
              showToast(window.I18n ? I18n.t('quizzes.toast.save_failed') : 'فشل في حفظ التعديلات', 'error');
              return;
            }
          } else {
            saveLocal(LS_QUIZZES, quizzes);
          }

          showToast(window.I18n ? I18n.t('quizzes.toast.save_success') : 'تم حفظ التعديلات بنجاح', 'success');
          if (saveQuiz) {
            delete saveQuiz.dataset.mode;
            delete saveQuiz.dataset.quizId;
            saveQuiz.textContent = window.I18n ? I18n.t('quizzes.modal.save') : 'حفظ الاختبار';
          }
          if (quizModal) quizModal.style.display = 'none';

        } else {
          // إضافة جديدة
          const newQuiz = createQuiz({ name, groupId });

          if (hasAPI && window.api.createQuiz) {
            const result = await window.api.createQuiz({ id: newQuiz.id, name, groupId, status: 'active' });
            if (!result || result.message) {
              showToast(window.I18n ? I18n.t('quizzes.toast.create_failed') : 'فشل في حفظ الاختبار', 'error');
              return;
            }
            // Use server-assigned data (id may differ if server regenerated)
            newQuiz.id = result.id || newQuiz.id;
          } else {
            saveLocal(LS_QUIZZES, [...quizzes, newQuiz]);
          }

          quizzes.push(newQuiz);
          showToast(window.I18n ? I18n.t('quizzes.toast.create_success') : 'تم إضافة الاختبار بنجاح', 'success');
          addQuizForm.reset();
        }

        updateStats();
        render();
      } finally {
        hideLoading();
      }
    });
  }

  // Search and Filters
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      filters.search = searchInput.value;
      render();
    }));
  }

  if (filterGroup) {
    filterGroup.addEventListener('change', () => {
      filters.group = filterGroup.value;
      render();
    });
  }

  if (filterStatus) {
    filterStatus.addEventListener('change', () => {
      filters.status = filterStatus.value;
      render();
    });
  }

  if (sortBy) {
    sortBy.addEventListener('change', render);
  }

  if (showArchived) {
    showArchived.addEventListener('change', () => {
      filters.showArchived = showArchived.checked;
      render();
    });
  }

  if (showEmpty) {
    showEmpty.addEventListener('change', () => {
      filters.showEmpty = showEmpty.checked;
      render();
    });
  }

  if (resetFilters) {
    resetFilters.addEventListener('click', () => {
      filters = {
        search: '',
        group: '',
        status: '',
        showArchived: false,
        showEmpty: true
      };
      
      if (searchInput) searchInput.value = '';
      if (filterGroup) filterGroup.value = '';
      if (filterStatus) filterStatus.value = '';
      if (sortBy) sortBy.value = 'name';
      if (showArchived) showArchived.checked = false;
      if (showEmpty) showEmpty.checked = true;
      
      render();
    });
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      resetFilters?.click();
    });
  }

  // View Toggle
  if (gridViewBtn) {
    gridViewBtn.addEventListener('click', () => {
      currentView = 'grid';
      gridViewBtn.classList.add('active');
      listViewBtn?.classList.remove('active');
      render();
    });
  }

  if (listViewBtn) {
    listViewBtn.addEventListener('click', () => {
      currentView = 'list';
      listViewBtn.classList.add('active');
      gridViewBtn?.classList.remove('active');
      render();
    });
  }

  // Modal Events
  const resetQuizModalState = () => {
    if (saveQuiz) {
      delete saveQuiz.dataset.mode;
      delete saveQuiz.dataset.quizId;
      // Localize save button text
      saveQuiz.textContent = window.I18n ? I18n.t('quizzes.modal.save') : 'حفظ الاختبار';
    }
    if (modalQuizTitle) modalQuizTitle.value = '';
    if (modalQuizGroup) modalQuizGroup.value = '';
    const titleEl = document.getElementById('quizModalTitle');
    if (titleEl) titleEl.textContent = window.I18n ? I18n.t('quizzes.modal.add_title') : 'إضافة اختبار جديد';
  };

  if (quizModalClose) {
    quizModalClose.addEventListener('click', () => {
      if (quizModal) quizModal.style.display = 'none';
      resetQuizModalState();
    });
  }

  if (cancelQuiz) {
    cancelQuiz.addEventListener('click', () => {
      if (quizModal) quizModal.style.display = 'none';
      resetQuizModalState();
    });
  }

  if (deleteModalClose) {
    deleteModalClose.addEventListener('click', () => {
      if (deleteModal) deleteModal.style.display = 'none';
    });
  }

  if (cancelDelete) {
    cancelDelete.addEventListener('click', () => {
      if (deleteModal) deleteModal.style.display = 'none';
    });
  }

  if (confirmDelete) {
    confirmDelete.addEventListener('click', async () => {
      if (!currentQuizId) return;
      
      showLoading();
      try {
        const index = quizzes.findIndex(q => q.id === currentQuizId);
        if (index !== -1) {
          if (hasAPI && window.api.deleteQuiz) {
            const result = await window.api.deleteQuiz(currentQuizId);
            if (!result || result.ok === false) {
              showToast(window.I18n ? I18n.t('quizzes.toast.delete_failed') : 'فشل في حذف الاختبار', 'error');
              return;
            }
          } else {
            const local = loadLocal(LS_QUIZZES).filter(q => q.id !== currentQuizId);
            saveLocal(LS_QUIZZES, local);
          }

          quizzes.splice(index, 1);
          showToast(window.I18n ? I18n.t('quizzes.toast.delete_success') : 'تم حذف الاختبار بنجاح', 'success');
          updateStats();
          render();
        }
      } finally {
        hideLoading();
        if (deleteModal) deleteModal.style.display = 'none';
        currentQuizId = null;
      }
    });
  }

  if (editorModalClose) {
    editorModalClose.addEventListener('click', () => {
      if (editorModal) editorModal.style.display = 'none';
    });
  }

  // ===== QR Share (Modal + Actions) =====
  const qrShareModal = document.getElementById('qrShareModal');
  const qrShareClose = document.getElementById('qrShareClose');
  // Match interactive start settings
  const qrPreStartMinutes = document.getElementById('qrPreStartMinutes');
  const qrPreTimeUpMode = document.getElementById('qrPreTimeUpMode');
  const qrShowCorrectAnswer = document.getElementById('qrShowCorrectAnswer');
  const qrCodeContainer = document.getElementById('qrCodeContainer');
  const qrShareOutput = null; // removed textarea field from UI; generation/copy works with internal values
  const qrGenerateBtn = document.getElementById('qrGenerateBtn');
  const qrCopyBtn = document.getElementById('qrCopyBtn');
  const qrDownloadBtn = document.getElementById('qrDownloadBtn');
  const qrLanInfo = document.getElementById('qrLanInfo');
  const qrShortLinkWrap = document.getElementById('qrShortLinkWrap');
  const qrShortLink = document.getElementById('qrShortLink');
  const qrCopyShortBtn = document.getElementById('qrCopyShortBtn');
  const qrCopyLanBtn = document.getElementById('qrCopyLanBtn');

  function resetQRModal() {
    if (qrPreStartMinutes) qrPreStartMinutes.value = '1';
    if (qrPreTimeUpMode) qrPreTimeUpMode.value = 'auto-next-wrong';
    if (qrShowCorrectAnswer) qrShowCorrectAnswer.checked = true;
    if (qrCodeContainer) qrCodeContainer.innerHTML = '';
    if (qrLanInfo) qrLanInfo.textContent = '';
    if (qrShortLinkWrap) qrShortLinkWrap.style.display = 'none';
    if (qrShortLink) qrShortLink.textContent = '';
  }

  // Return the SQLite ID for this quiz so we can build a LAN QR URL.
  // All quizzes in the list are loaded from SQLite via apiGetQuizzes → IPC → /api/quizzes,
  // so their IDs are already valid SQLite UUIDs — no duplication needed.
  async function ensureQuizOnServer(quizId) {
    const quiz = quizzes.find(q => q.id === quizId);
    if (!quiz) throw new Error('quiz not found');
    return quizId;
  }

  // Build an HTTP share link that points to /quiz with a valid SQLite-backed quiz ID
  async function buildHttpShareLink(quizId) {
    const minutes = Math.max(0, parseInt(qrPreStartMinutes?.value || '0', 10) || 0);
    const allowReview = true; // review control mirrored via interactive page settings

    // Prefer LAN IP so students on the same local network can access without internet
    let origin = '';
    let lanInfoText = '';
    try {
      const res = await authFetch('/api/local-ip');
      if (res.ok) {
        const data = await res.json();
        const ips = Array.isArray(data?.ips) ? data.ips : [];
        // Prefer real LAN ranges over VPN/virtual adapters
        const ip = ips.find(a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) || ips.find(Boolean);
        const port = data?.port || 5000;
        if (ip) {
          const protocol = /^https?:$/i.test(window.location.protocol) ? window.location.protocol : 'http:';
          origin = `${protocol}//${ip}:${port}`;
          lanInfoText = `LAN: ${origin}`;
        }
      }
    } catch (_) { /* fallback to current origin below */ }
    if (!origin) {
      origin = window.location.origin || '';
      lanInfoText = origin ? `Origin: ${origin}` : '';
    }
    if (qrLanInfo) qrLanInfo.textContent = lanInfoText;
    if (qrCopyLanBtn) {
      const textToCopy = origin;
      qrCopyLanBtn.onclick = async () => {
        if (!textToCopy) { showToast('لا يوجد عنوان لنسخه', 'warning'); return; }
        try {
          await navigator.clipboard.writeText(textToCopy);
          showToast('تم نسخ عنوان الشبكة', 'success');
        } catch {
          showToast('تعذّر نسخ العنوان', 'error');
        }
      };
    }

    const serverId = await ensureQuizOnServer(quizId);

    // Try to fetch short code for pretty link
    let short = null;
    try {
      const r = await authFetch(`/api/quizzes/${serverId}`);
      if (r.ok) {
        const d = await r.json();
        if (d && d.short) short = String(d.short);
      }
    } catch {}

    const base = `${origin}/quiz`;
    const params = new URLSearchParams();
    params.set('id', serverId);
    if (minutes) params.set('minutes', String(minutes));
    params.set('review', allowReview ? '1' : '0');
    // pass extra flags for start behavior
    if (qrPreTimeUpMode) params.set('timeUp', qrPreTimeUpMode.value);
    if (qrShowCorrectAnswer) params.set('showCorrect', qrShowCorrectAnswer.checked ? '1' : '0');

    const longUrl = `${base}?${params.toString()}`;

    // If we have a short code, populate the short link block
    if (short && qrShortLinkWrap && qrShortLink) {
      const shortUrl = `${origin}/q/${encodeURIComponent(short)}?${params.toString()}`;
      qrShortLink.href = shortUrl;
      qrShortLink.textContent = shortUrl;
      qrShortLinkWrap.style.display = 'flex';
      if (qrCopyShortBtn) {
        qrCopyShortBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(shortUrl);
            showToast('تم نسخ الرابط القصير', 'success');
          } catch {
            showToast('تعذّر نسخ الرابط القصير', 'error');
          }
        };
      }
    }

    return longUrl;
  }

  // Offline/JSON share text (used when not under http(s))
  function buildShareText(quizId) {
    const minutes = Math.max(0, parseInt(qrPreStartMinutes?.value || '0', 10) || 0);

    const payload = {
      type: 'quizShare',
      version: 2,
      quizId,
      minutes,
      timeUp: qrPreTimeUpMode ? qrPreTimeUpMode.value : 'auto-next-wrong',
      showCorrect: !!(qrShowCorrectAnswer && qrShowCorrectAnswer.checked)
    };
    return JSON.stringify(payload);
  }

  function generateQRCode(data) {
    if (!qrCodeContainer) return;
    qrCodeContainer.innerHTML = '';
    try {
      // QRCode.js will append an <img> with data URL
      const qr = new QRCode(qrCodeContainer);
      qr.makeCode(data);
      // Make QR clickable: open full-screen overlay with enlarged QR
      qrCodeContainer.classList.remove('is-zoomed');
      qrCodeContainer.onclick = function(){
        try {
          const img = qrCodeContainer.querySelector('img') || qrCodeContainer.querySelector('canvas');
          if (!img) return;
          // Create overlay elements lazily
          let overlay = document.getElementById('qrZoomOverlay');
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'qrZoomOverlay';
            Object.assign(overlay.style, {
              position:'fixed', inset:'0', background:'rgba(0,0,0,.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:'999999', cursor:'zoom-out'
            });
            const wrap = document.createElement('div');
            Object.assign(wrap.style, { background:'#fff', padding:'16px', borderRadius:'12px', boxShadow:'0 20px 60px rgba(0,0,0,.35)' });
            const big = document.createElement('img');
            big.id = 'qrZoomImage';
            Object.assign(big.style, { width:'min(80vmin, 520px)', height:'min(80vmin, 520px)', objectFit:'contain', display:'block' });
            wrap.appendChild(big);
            overlay.appendChild(wrap);
            document.body.appendChild(overlay);
            // Close on click or Escape
            overlay.addEventListener('click', () => overlay.remove());
            document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ overlay.remove(); document.removeEventListener('keydown', esc); } });
          }
          const big = overlay.querySelector('#qrZoomImage');
          if (!big) return;
          if (img.tagName.toLowerCase() === 'canvas' && img.toDataURL) {
            big.src = img.toDataURL('image/png');
          } else if (img.src) {
            big.src = img.src;
          } else {
            // regenerate from last generated link if available
            const txt = window.__lastQRText || '';
            if (txt) {
              // draw a temporary QR on canvas to export
              try {
                const tmp = document.createElement('div');
                const q = new QRCode(tmp);
                q.makeCode(txt);
                const tmpImg = tmp.querySelector('img') || tmp.querySelector('canvas');
                if (tmpImg) {
                  big.src = tmpImg.toDataURL ? tmpImg.toDataURL('image/png') : tmpImg.src;
                }
              } catch {}
            }
          }
          overlay.style.display = 'flex';
        } catch(e){ console.warn('QR zoom overlay failed:', e); }
      };
    } catch (err) {
      console.error('QR generation failed:', err);
      showToast('تعذّر توليد كود QR', 'error');
    }
  }

  window.generateQRCode = generateQRCode;

  window.openQRShare = async function(quizId){
    const quiz = quizzes.find(q => q.id === quizId);
    if (!quiz) { showToast('الاختبار غير موجود', 'error'); return; }
    currentQuizId = quizId;
    resetQRModal();

    if (qrShareModal) qrShareModal.style.display = 'flex';
  };

  if (qrShareClose) {
    qrShareClose.addEventListener('click', () => {
      if (qrShareModal) qrShareModal.style.display = 'none';
    });
  }

  if (qrShareModal) {
    // Close when clicking overlay
    qrShareModal.addEventListener('click', (e) => {
      if (e.target === qrShareModal) {
        qrShareModal.style.display = 'none';
      }
    });
  }

  // Close QR modal on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && qrShareModal && qrShareModal.style.display !== 'none') {
      qrShareModal.style.display = 'none';
    }
  });

  if (qrGenerateBtn) {
    qrGenerateBtn.addEventListener('click', async () => {
      if (!currentQuizId) { showToast(window.I18n ? I18n.t('quizzes.toast.select_quiz_first') : 'يرجى اختيار اختبار أولاً', 'warning'); return; }
      const isHttp = typeof window !== 'undefined' && window.location && /^https?:/i.test(window.location.protocol);
      try {
        let text;
        if (isHttp) {
          // Ensure the quiz exists in SQLite and build /quiz link
          showToast(window.I18n ? I18n.t('quizzes.toast.preparing_share_link') : 'جاري تجهيز رابط المشاركة...', 'info');
          text = await buildHttpShareLink(currentQuizId);
          // Prefer short full URL if available on the UI
          if (qrShortLinkWrap && qrShortLink && qrShortLinkWrap.style.display !== 'none' && qrShortLink.href) {
            const shortUrlFull = qrShortLink.href;
            if (shortUrlFull && /^https?:\/\//i.test(shortUrlFull)) {
              text = shortUrlFull;
            }
          }
        } else {
          // Offline payload
          text = buildShareText(currentQuizId);
        }
        window.__lastQRText = text;
        generateQRCode(text);
        showToast(window.I18n ? I18n.t('quizzes.toast.qr_generated') : 'تم توليد كود QR', 'success');
      } catch (e) {
        console.error('QR build failed:', e);
        showToast(window.I18n ? I18n.t('quizzes.toast.share_build_failed') : 'فشل تجهيز رابط المشاركة', 'error');
      }
    });
  }

  if (qrCopyBtn) {
    qrCopyBtn.addEventListener('click', async () => {
      const text = window.__lastQRText || '';
      if (!text) { showToast(window.I18n ? I18n.t('quizzes.toast.nothing_to_copy') : 'لا يوجد نص لنسخه', 'warning'); return; }
      try {
        await navigator.clipboard.writeText(text);
        showToast(window.I18n ? I18n.t('quizzes.toast.copied') : 'تم نسخ الرابط', 'success');
      } catch {
        showToast(window.I18n ? I18n.t('quizzes.toast.copy_failed') : 'تعذّر النسخ', 'error');
      }
    });
  }

  if (qrDownloadBtn) {
    qrDownloadBtn.addEventListener('click', () => {
      if (!qrCodeContainer) return;
      const img = qrCodeContainer.querySelector('img');
      const canvas = qrCodeContainer.querySelector('canvas');
      let dataUrl = '';
      try {
        if (canvas && canvas.toDataURL) {
          dataUrl = canvas.toDataURL('image/png');
        } else if (img && img.src && img.src.startsWith('data:image')) {
          dataUrl = img.src;
        }
      } catch {}
      if (!dataUrl) { showToast(window.I18n ? I18n.t('quizzes.toast.no_image_to_save') : 'لا توجد صورة متاحة للحفظ', 'warning'); return; }
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `quiz-qr-${currentQuizId || 'share'}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 0);
    });
  }

  // حفظ التعديلات من مودال تعديل بيانات الاختبار
  const modalForm = document.getElementById('quizForm');
  async function handleSaveFromModal(e){
    // يدعم كلٍ من ضغط زر الحفظ أو Enter داخل النموذج
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    // نعمل فقط في وضع التعديل
    if (!saveQuiz || saveQuiz.dataset.mode !== 'edit') return;

    const editingId = saveQuiz.dataset.quizId;
    const name = document.getElementById('modalQuizTitle')?.value?.trim();
    const groupId = document.getElementById('modalQuizGroup')?.value;


    if (!name || !groupId) {
      showToast('يرجى ملء جميع الحقول المطلوبة', 'warning');
      return;
    }

    showLoading();
    try {
      const idx = quizzes.findIndex(q => q.id === editingId);
      if (idx !== -1) {
        quizzes[idx] = { ...quizzes[idx], name, groupId, updatedAt: new Date().toISOString() };
      }

      if (hasAPI && window.api.updateQuiz) {
        const result = await window.api.updateQuiz(editingId, { name, groupId });
        if (!result || result.message) {
          showToast('فشل في حفظ التعديلات', 'error');
          return;
        }
      } else {
        saveLocal(LS_QUIZZES, quizzes);
      }

      showToast('تم حفظ التعديلات بنجاح', 'success');
      if (quizModal) quizModal.style.display = 'none';
      resetQuizModalState();
      updateStats();
      render();
    } finally {
      hideLoading();
    }
  }

  if (saveQuiz) {
    // زر "حفظ التعديلات" داخل المودال
    saveQuiz.addEventListener('click', handleSaveFromModal);
  }
  if (modalForm) {
    // دعم الضغط على Enter داخل المودال
    modalForm.addEventListener('submit', handleSaveFromModal);
  }

  // ===== Global Functions =====
  window.openQuestionsEditor = function(quizId) {
    const quiz = quizzes.find(q => q.id === quizId);
    if (!quiz) {
      showToast('الاختبار غير موجود', 'error');
      return;
    }
    window.location.href = `/pages/quiz-editor.html?id=${quizId}`;
  };

  window.openMetaEditor = function(quizId) {
    const quiz = quizzes.find(q => q.id === quizId);
    if (!quiz) {
      showToast('الاختبار غير موجود', 'error');
      return;
    }
    // افتح مودال "إضافة اختبار" ولكن في وضع التعديل، واملأ الحقول الحالية
    if (quizModal) {
      quizModal.style.display = 'flex';
      const titleEl = document.getElementById('quizModalTitle');
      if (titleEl) titleEl.textContent = (window.I18n ? I18n.t('quizzes.modal.edit_title') : 'تعديل بيانات الاختبار');
      if (modalQuizTitle) modalQuizTitle.value = quiz.name || '';
      if (modalQuizGroup) modalQuizGroup.value = quiz.groupId || '';
      // غيّر سلوك زر الحفظ ليحفظ التعديل بدلاً من الإضافة
      if (saveQuiz) {
        saveQuiz.dataset.mode = 'edit';
        saveQuiz.dataset.quizId = quizId;
        saveQuiz.textContent = window.I18n ? I18n.t('quizzes.modal.save') : 'حفظ التعديلات';
      }
    }
  };

  window.viewResults = function(quizId) {
    const quiz = quizzes.find(q => q.id === quizId);
    if (!quiz) {
      showToast('الاختبار غير موجود', 'error');
      return;
    }
    
    // التوجه إلى صفحة نتائج الاختبار
    window.location.href = `/pages/quiz-results.html?id=${quizId}`;
  };

  window.previewQuiz = async function(quizId) {
    let quiz = quizzes.find(q => q.id === quizId);
    if (!quiz) {
      showToast('الاختبار غير موجود', 'error');
      return;
    }

    /* if questions not loaded yet (list API only returns questionsCount), fetch full quiz */
    if (!quiz.questions || !quiz.questions.length) {
      try {
        const res = await authFetch(`/api/quizzes/${quizId}`);
        if (res.ok) {
          const full = await res.json();
          if (full && Array.isArray(full.questions) && full.questions.length > 0) {
            quiz = full;
          } else {
            console.warn('[previewQuiz] API returned quiz with 0 questions. questionsCount from list:', quiz.questionsCount, 'quizId:', quizId);
          }
        } else {
          console.warn('[previewQuiz] API returned status:', res.status, 'for quizId:', quizId);
        }
      } catch(e) {
        console.error('[previewQuiz] authFetch failed:', e);
      }
    }

    if (!quiz.questions || quiz.questions.length === 0) {
      showToast(window.I18n ? I18n.t('quizzes.toast.no_questions') : 'هذا الاختبار لا يحتوي على أسئلة', 'warning');
      return;
    }

    try {
      // افتح نافذة جديدة مع تمرير الـ id كالمعتاد
      const quizWindow = window.open(
        `/pages/quiz-view.html?id=${quizId}`,
        'quiz_window',
        'width=1200,height=800,scrollbars=yes,resizable=yes,menubar=no,toolbar=no,location=no,status=no'
      );

      if (quizWindow) {
        // مرّر بيانات الاختبار الحالية إلى النافذة لضمان المعاينة حتى بدون تخزين/APIs
        try {
          quizWindow.quizData = quiz;
          if (quizWindow.addEventListener) {
            quizWindow.addEventListener('load', () => {
              try { quizWindow.quizData = quiz; } catch {}
            });
          }
        } catch {}

        quizWindow.focus();
        showToast('تم فتح الاختبار في نافذة جديدة', 'success');
        return;
      }

      // في حال تم حظر النوافذ المنبثقة → افتح في نفس الصفحة مع تمرير البيانات عبر global
      window.quizData = quiz;
      window.location.href = `/pages/quiz-view.html?id=${quizId}`;
    } catch (e) {
      // مسار أخير آمن
      window.quizData = quiz;
      window.location.href = `/pages/quiz-view.html?id=${quizId}`;
    }
  };

  window.duplicateQuiz = function(quizId) {
    const quiz = quizzes.find(q => q.id === quizId);
    if (!quiz) return;
    
    const duplicate = {
      ...quiz,
      id: uid(),
      name: quiz.name + ' (نسخة)',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (hasAPI && window.api.createQuiz) {
      window.api.createQuiz({
        id: duplicate.id,
        name: duplicate.name,
        groupId: duplicate.groupId,
        status: duplicate.status || 'active'
      }).then(result => {
        if (result && result.id) {
          duplicate.id = result.id;
          quizzes.push(duplicate);
          updateStats(); render();
        } else {
          showToast('فشل في نسخ الاختبار', 'error');
        }
      });
    } else {
      quizzes.push(duplicate);
      saveLocal(LS_QUIZZES, quizzes);
    }

    showToast('تم نسخ الاختبار بنجاح', 'success');
    updateStats();
    render();
  };

  window.deleteQuiz = function(quizId) {
    currentQuizId = quizId;
    if (deleteModal) deleteModal.style.display = 'flex';
  };

  // ===== Quiz Editor =====
  function loadQuizEditor(quiz) {
    const editorContainer = document.getElementById('quizEditor');
    if (!editorContainer) return;
    
    // هنا يمكن تحميل محرر الأسئلة المتقدم
    editorContainer.innerHTML = `
      <div class="editor-placeholder">
        <h3>محرر الأسئلة</h3>
        <p>جاري تطوير محرر الأسئلة المتقدم...</p>
        <p><strong>الاختبار:</strong> ${escapeHTML(quiz.name)}</p>
        <p><strong>المجموعة:</strong> ${escapeHTML(getGroupName(quiz.groupId))}</p>
        <p><strong>عدد الأسئلة:</strong> ${countQuestions(quiz)}</p>
      </div>
    `;
  }

  // ===== Keyboard Shortcuts =====
  if (window.__quizzesKeyHandler) {
    document.removeEventListener('keydown', window.__quizzesKeyHandler);
  }
  window.__quizzesKeyHandler = (e) => {
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      searchInput?.focus();
    }
    if (e.key === 'Escape') {
      if (quizModal && quizModal.style.display !== 'none') {
        quizModal.style.display = 'none';
      }
      if (deleteModal && deleteModal.style.display !== 'none') {
        deleteModal.style.display = 'none';
      }
      if (editorModal && editorModal.style.display !== 'none') {
        editorModal.style.display = 'none';
      }
    }
  };
  document.addEventListener('keydown', window.__quizzesKeyHandler);

  // ===== Initialization =====
  let __quizzesInitDone = false;
  function initQuizzesOnce() {
    if (__quizzesInitDone) return;
    __quizzesInitDone = true;

    // Home navigation without inline handlers (CSP-friendly)
    if (homeButton) {
      homeButton.addEventListener('click', () => {
        window.location.href = '/';
      });
    }

    loadAllData();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initQuizzesOnce, { once: true });
  } else {
    initQuizzesOnce();
  }

})();