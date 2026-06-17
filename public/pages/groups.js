'use strict';

// Groups page controller with optional Electron API integration and local fallback
(function(){
  // ===== Load XLSX library if not present =====
  function loadXLSX(){
    return new Promise((resolve) => {
      if (window.XLSX) { resolve(true); return; }
      if (document.getElementById('xlsx-lib-script')) {
        const existing = document.getElementById('xlsx-lib-script');
        existing.addEventListener('load', () => resolve(!!window.XLSX));
        existing.addEventListener('error', () => resolve(false));
        return;
      }
      const s = document.createElement('script');
      s.id = 'xlsx-lib-script';
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => resolve(!!window.XLSX);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  loadXLSX();

  // ===== Environment =====
  const hasAPI = typeof window !== 'undefined' && !!window.api;

  // ===== State =====
  let groups = [];
  let students = [];
  let currentGroupId = null;
  let currentGroupSafeName = '';
  let lastSelectedGender = localStorage.getItem('cm_last_gender') || '';
  let currentView = 'grid'; // 'grid' or 'list'

  // ===== DOM refs =====
  const form = document.getElementById('addGroupForm');
  const nameInput = document.getElementById('groupName');
  const descInput = document.getElementById('groupDesc');
  const groupsContainer = document.getElementById('groupsContainer');
  const noGroupsMessage = document.getElementById('noGroupsMessage');
  const groupsCountEl = document.getElementById('groupsCount');
  const searchInput = document.getElementById('searchInput');
  const sortBySelect = document.getElementById('sortBy');
  const sortOrderSelect = document.getElementById('sortOrder');
  const clearBtn = document.querySelector('.search-clear');
  
  // View controls
  const gridViewBtn = document.getElementById('gridViewBtn');
  const listViewBtn = document.getElementById('listViewBtn');
  const gridView = document.getElementById('gridView');
  const listView = document.getElementById('listView');
  const groupsTableBody = document.getElementById('groupsTableBody');

  // ===== LocalStorage Fallback =====
  const LS_GROUPS = 'cm_groups_v1';
  const LS_STUDENTS = 'cm_students_v1';
  function loadLocal(key){ try { const raw = localStorage.getItem(key); return raw? JSON.parse(raw): []; } catch { return []; } }
  function saveLocal(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

  // ===== Utils =====
  const normalize = (s) => (s || '').toString().trim().toLowerCase();
  const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const debounce = (fn, d=150)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), d); }; };
  function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
  function formatDate(ts){
    try {
      const lang = (window.I18n && I18n.lang) ? I18n.lang : (localStorage.getItem('cm_language') || 'ar');
      const locale = (lang === 'ar') ? 'ar-EG' : 'en-US';
      return new Date(ts).toLocaleDateString(locale);
    } catch { return ''; }
  }
  
  // ===== Group Icons =====
  const GROUP_ICONS = [
    '📚', '📖', '📝', '✏️', '🎓', '🏫', '👨‍🏫', '👩‍🏫', '🎯', '🧠',
    '💡', '🔬', '🧪', '📐', '📏', '🖊️', '✒️', '📋', '📊', '📈',
    '🎨', '🖼️', '🎭', '🎪', '🎵', '🎶', '🏆', '🥇', '⭐', '🌟',
    '🔥', '💎', '🎪', '🎨', '🌈', '🦋', '🌸', '🌺', '🌻', '🌷'
  ];
  
  // ===== Group Colors =====
  const GROUP_COLORS = [
    '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4',
    '#84cc16', '#f97316', '#ec4899', '#6366f1', '#14b8a6', '#eab308',
    '#8b5cf6', '#f43f5e', '#0ea5e9', '#22c55e', '#a855f7', '#fb923c'
  ];
  
  function getRandomIcon(){
    return GROUP_ICONS[Math.floor(Math.random() * GROUP_ICONS.length)];
  }
  
  function getRandomColor(){
    return GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
  }
  
  function getUniqueColor(){
    // جمع الألوان المستخدمة حالياً
    const usedColors = groups.map(g => g.color).filter(Boolean);
    
    // البحث عن لون غير مستخدم
    const availableColors = GROUP_COLORS.filter(color => !usedColors.includes(color));
    
    if (availableColors.length > 0) {
      return availableColors[Math.floor(Math.random() * availableColors.length)];
    }
    
    // إذا تم استخدام جميع الألوان، إرجاع لون عشوائي
    return getRandomColor();
  }
  // Create YYYY-MM-DD for <input type="date"> in local time
  function dateInputValue(d){
    try {
      const dt = d ? new Date(d) : new Date();
      const tz = dt.getTimezoneOffset();
      const local = new Date(dt.getTime() - tz*60000);
      return local.toISOString().slice(0,10);
    } catch { return new Date().toISOString().slice(0,10); }
  }
  // Group and student code helpers
  function getNextAvailableGroupCode(){
    try { return groups.reduce((m,g)=> Math.max(m, Number(g?.groupCode||0)), 0) + 1; } catch { return 1; }
  }
  function getGroupCode(groupId){
    const g = groups.find(x=> x.id === groupId);
    if (!g) return 0;
    if (!g.groupCode){
      g.groupCode = getNextAvailableGroupCode();
      if (hasAPI && window.api.saveGroups) { apiSaveGroups(groups); } else { saveLocal(LS_GROUPS, groups); }
    }
    return Number(g.groupCode);
  }
  function getNextStudentSeqForGroup(groupId){
    let maxSeq = 0;
    students.forEach(s=>{
      if (s.groupId === groupId){
        let seq = 0;
        if (s.codeSeq) {
          seq = Number(s.codeSeq);
        } else if (typeof s.code === 'string' && s.code.includes('-')) {
          const parts = s.code.split('-');
          seq = Number(parts[parts.length - 1]); // use last segment as sequence
        }
        if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
      }
    });
    return maxSeq + 1;
  }
  function getGroupCodePrefix(groupId){
    const g = groups.find(x=> x.id === groupId);
    if (g) {
      const custom = (g.codePrefix || '').toString().trim();
      if (custom) return custom; // use custom prefix when provided
    }
    // fallback to auto numeric groupCode
    return String(getGroupCode(groupId) || 0);
  }
  function generateStudentCode(groupId){
    const prefix = getGroupCodePrefix(groupId);
    let seq = getNextStudentSeqForGroup(groupId);
    let code = `${prefix}-${String(seq).padStart(3,'0')}`;
    
    // Ensure code is unique within the group (double check)
    let attempts = 0;
    while (students.find(s => s.groupId === groupId && s.code === code) && attempts < 1000) {
      seq++;
      code = `${prefix}-${String(seq).padStart(3,'0')}`;
      attempts++;
    }
    
    return { code, seq };
  }

  // Gender normalization helper: returns 'male' | 'female' | ''
  function normalizeGenderValue(input){
    const val = (input || '').toString().trim().toLowerCase();
    if (!val) return '';
    const malePatterns = [/^m(ale)?\b/, /^(ذكر)\b/, /^(ولد)\b/, /^(boy)\b/];
    const femalePatterns = [/^f(emale)?\b/, /^(أنثى|انثى)\b/, /^(بنت)\b/, /^(girl)\b/];
    if (malePatterns.some(rx => rx.test(val))) return 'male';
    if (femalePatterns.some(rx => rx.test(val))) return 'female';
    return '';
  }

  // ===== Toast =====
  function showToast(message, type='info'){
    const exist = document.querySelector('.toast'); if (exist) exist.remove();
    const el = document.createElement('div');
    el.className = `toast ${type}`; el.textContent = message;
    Object.assign(el.style, { position:'fixed', top:'20px', right:'20px', padding:'14px 16px', borderRadius:'12px', color:'#fff', font:'14px Cairo, sans-serif', zIndex:'999999', transform:'translateX(120%)', transition:'all .3s ease', boxShadow:'0 20px 40px rgba(0,0,0,.25)', cursor:'pointer' });
    const colors = { success:'#16a34a', error:'#dc2626', warning:'#d97706', info:'#0ea5e9' }; el.style.background = colors[type] || colors.info;
    document.body.appendChild(el); requestAnimationFrame(()=>{ el.style.transform='translateX(0)'; });
    const close=()=>{ el.style.transform='translateX(120%)'; el.style.opacity='0'; setTimeout(()=>el.remove(), 240); };
    setTimeout(close, 3500); el.addEventListener('click', close);
  }

  // ===== Loading Overlay =====
  const overlay = document.getElementById('loadingOverlay');
  const showLoading = ()=>{ if (overlay) overlay.style.display='flex'; };
  const hideLoading = ()=>{ if (overlay) overlay.style.display='none'; };

  // ===== API wrappers =====
  async function apiGetGroups(){
    if (!hasAPI || !window.api.loadGroups) return null;
    try { 
      const r = await window.api.loadGroups();
      if (Array.isArray(r)) return r; 
      return []; 
    } catch (e){ 
      console.error(e); 
      showToast(I18n.t('groups.toast.load_groups_failed'),'error'); 
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
      showToast(I18n.t('groups.toast.load_students_failed'),'error'); 
      return []; 
    }
  }
  
  async function apiSaveGroups(groups){ 
    if (!hasAPI || !window.api.saveGroups) return false; 
    try { 
      const r = await window.api.saveGroups(groups); 
      return r?.ok !== false; 
    } catch(e){ 
      console.error(e); 
      showToast(I18n.t('groups.toast.save_groups_failed'),'error'); 
      return false; 
    } 
  }
  
  async function apiSaveStudents(students){ 
    if (!hasAPI || !window.api.saveStudents) return false; 
    try { 
      const r = await window.api.saveStudents(students); 
      return r?.ok !== false; 
    } catch(e){ 
      console.error('Error saving students:', e); 
      showToast(I18n.t('groups.toast.save_students_failed'),'error'); 
      return false; 
    } 
  }
  
  async function apiUpdateGroup(g){ 
    if (!hasAPI || !window.api.updateGroup) return false;
    try {
      const r = await window.api.updateGroup(g);
      return r?.ok !== false;
    } catch(e){
      console.error(e);
      showToast(I18n.t('groups.toast.update_group_failed'),'error');
      return false;
    }
  }
  
  async function apiAddStudent(s){ 
    if (!hasAPI || !window.api.addStudent) return null; 
    try { 
      const r = await window.api.addStudent(s); 
      return r?.ok !== false; 
    } catch(e){ 
      console.error(e); 
      showToast(I18n.t('groups.toast.add_student_failed'),'error'); 
      return false; 
    } 
  }
  
  async function apiUpdateStudent(s){ 
    if (!hasAPI || !window.api.updateStudent) return false; 
    try { 
      const r = await window.api.updateStudent(s); 
      return r?.ok !== false; 
    } catch(e){ 
      console.error(e); 
      showToast(I18n.t('groups.toast.update_student_failed'),'error'); 
      return false; 
    } 
  }
  
  async function apiDeleteStudent(id){ 
    if (!hasAPI || !window.api.deleteStudent) return false; 
    try { 
      const r = await window.api.deleteStudent(id); 
      return r?.ok !== false; 
    } catch(e){ 
      console.error(e); 
      showToast(I18n.t('groups.toast.delete_student_failed'),'error'); 
      return false; 
    } 
  }
  
  async function apiDeleteGroup(id){ 
    if (!hasAPI || !window.api.deleteGroup) return false; 
    try { 
      const r = await window.api.deleteGroup(id); 
      return r?.ok !== false; 
    } catch(e){ 
      console.error(e); 
      showToast(I18n.t('groups.toast.delete_group_failed'),'error'); 
      return false; 
    } 
  }

  // ===== Public helpers =====
  function goToAddGroup(){ if (!form) return; form.scrollIntoView({ behavior:'smooth', block:'start' }); nameInput?.focus(); }
  const goToAddGroupBtn = document.getElementById('goToAddGroupBtn');
  if (goToAddGroupBtn) { goToAddGroupBtn.addEventListener('click', goToAddGroup); }

  // ===== Add Group =====
  form && form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameVal = nameInput?.value?.trim() || ''; const descVal = descInput?.value?.trim() || '';
    if (!nameVal){ nameInput?.focus(); return; }

    // Check for duplicate group name
    const duplicate = groups.find(g => g.name.trim().toLowerCase() === nameVal.toLowerCase());
    if (duplicate) {
      showToast(I18n.t('groups.toast.group_name_exists'), 'warning');
      nameInput?.focus();
      return;
    }

    const newGroup = { id: uid(), name: nameVal, description: descVal, color: getUniqueColor(), icon: getRandomIcon(), createdAt: new Date().toISOString(), studentsCount: 0, groupCode: getNextAvailableGroupCode() };
    showLoading();
    try {
      groups.push(newGroup);
      
      if (hasAPI) {
        const saved = await apiSaveGroups(groups);
        if (!saved) {
          // Rollback on failure
          groups.pop();
          showToast(I18n.t('groups.toast.save_group_failed'), 'error');
          return;
        }
      } else {
        saveLocal(LS_GROUPS, groups);
      }
      
      showToast(I18n.t('groups.toast.group_added_success'),'success');
      nameInput && (nameInput.value=''); descInput && (descInput.value='');
      render(); nameInput?.focus();
    } finally { hideLoading(); }
  });

  // ===== Search / Sort =====
  searchInput && searchInput.addEventListener('input', debounce(()=>render(), 120));
  clearBtn && clearBtn.addEventListener('click', ()=>{ if (searchInput){ searchInput.value=''; render(); searchInput.focus(); } });
  sortBySelect && sortBySelect.addEventListener('change', render);
  sortOrderSelect && sortOrderSelect.addEventListener('change', render);

  // ===== View Toggle =====
  gridViewBtn && gridViewBtn.addEventListener('click', () => {
    currentView = 'grid';
    updateViewButtons();
    render();
  });

  listViewBtn && listViewBtn.addEventListener('click', () => {
    currentView = 'list';
    updateViewButtons();
    render();
  });

  function updateViewButtons() {
    if (gridViewBtn && listViewBtn) {
      gridViewBtn.classList.toggle('active', currentView === 'grid');
      listViewBtn.classList.toggle('active', currentView === 'list');
    }
  }

  // ===== Render Groups =====
  function render(){
    const query = normalize(searchInput ? searchInput.value : '');
    const sortBy = (sortBySelect && sortBySelect.value) || 'name';
    const order = (sortOrderSelect && sortOrderSelect.value) || 'asc';

    let result = groups.filter(g => {
      const key = `${normalize(g.name)} ${normalize(g.description || g.desc)}`;
      return !query || key.includes(query);
    });
    const dir = order === 'desc' ? -1 : 1;
    result.sort((a,b) => {
      if (sortBy === 'students') return ((countStudents(a.id)) - (countStudents(b.id))) * dir;
      if (sortBy === 'date') return (new Date(a.createdAt||0) - new Date(b.createdAt||0)) * dir;
      const lang = (window.I18n && I18n.lang) ? I18n.lang : (localStorage.getItem('cm_language') || 'ar');
      const locale = (lang === 'ar') ? 'ar' : 'en';
      return (a.name||'').localeCompare(b.name||'', locale) * dir;
    });

    if (groupsCountEl) groupsCountEl.textContent = String(result.length);
    if (noGroupsMessage) noGroupsMessage.style.display = result.length ? 'none' : 'block';

    // Toggle views
    if (gridView && listView) {
      if (currentView === 'grid') {
        gridView.style.display = 'block';
        listView.style.display = 'none';
        renderGridView(result);
      } else {
        gridView.style.display = 'none';
        listView.style.display = 'block';
        renderListView(result);
      }
    }
    
    // Update view buttons state
    updateViewButtons();
  }

  function renderGridView(result) {
    if (!groupsContainer) return;
    groupsContainer.innerHTML = result.map(groupCardHTML).join('');

    // Apply translations to newly injected content
    if (window.I18n) { I18n.apply(groupsContainer); }

    // bind actions
    groupsContainer.querySelectorAll('[data-action="manage"]').forEach(btn=>{
      btn.addEventListener('click', async ()=> await openStudentsModal(btn.getAttribute('data-id'), btn.getAttribute('data-name')));
    });
    groupsContainer.querySelectorAll('[data-action="edit"]').forEach(btn=>{
      btn.addEventListener('click', ()=> openEditGroupModal(btn.getAttribute('data-id')));
    });
    groupsContainer.querySelectorAll('[data-action="delete"]').forEach(btn=>{
      btn.addEventListener('click', ()=> openDeleteGroupModal(btn.getAttribute('data-id')));
    });
  }

  function renderListView(result) {
    if (!groupsTableBody) return;
    groupsTableBody.innerHTML = result.map(groupRowHTML).join('');

    // Apply translations to newly injected content
    if (window.I18n) { I18n.apply(groupsTableBody); }

    // bind actions
    groupsTableBody.querySelectorAll('[data-action="manage"]').forEach(btn=>{
      btn.addEventListener('click', async ()=> await openStudentsModal(btn.getAttribute('data-id'), btn.getAttribute('data-name')));
    });
    groupsTableBody.querySelectorAll('[data-action="edit"]').forEach(btn=>{
      btn.addEventListener('click', ()=> openEditGroupModal(btn.getAttribute('data-id')));
    });
    groupsTableBody.querySelectorAll('[data-action="delete"]').forEach(btn=>{
      btn.addEventListener('click', ()=> openDeleteGroupModal(btn.getAttribute('data-id')));
    });
  }

  // Global delegation fallback for Manage buttons to ensure modal opens even if per-render binding fails
  document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest && e.target.closest('[data-action="manage"][data-id]');
    if (btn) {
      try { e.preventDefault(); openStudentsModal(btn.getAttribute('data-id'), btn.getAttribute('data-name')); } catch(err){ console.error('manage click error', err); }
    }
  });

  // Global delegation fallbacks for Edit/Delete to ensure reliability even after re-renders/i18n updates
  document.addEventListener('click', function(e){
    var editBtn = e.target && e.target.closest && e.target.closest('[data-action="edit"][data-id]');
    if (editBtn) {
      try { e.preventDefault(); openEditGroupModal(editBtn.getAttribute('data-id')); } catch(err){ console.error('edit click error', err); }
    }
  });
  document.addEventListener('click', function(e){
    var delBtn = e.target && e.target.closest && e.target.closest('[data-action="delete"][data-id]');
    if (delBtn) {
      try { e.preventDefault(); openDeleteGroupModal(delBtn.getAttribute('data-id')); } catch(err){ console.error('delete click error', err); }
    }
  });

  function groupCardHTML(g){
    const total = countStudents(g.id);
    const icon = g.icon || '📚';
    const color = g.color || '#10b981';
    const desc = escapeHTML(g.description || g.desc || '');
    return `
      <div class="card group-card" data-group-id="${g.id}">
        <div class="group-card-top-bar" style="background:linear-gradient(90deg,${color},${color}88)"></div>
        <div class="group-card-body">
          <div class="group-card-header">
            <div class="group-card-icon-wrap" style="background:${color}1a;border-color:${color}40">
              <span style="font-size:22px;line-height:1">${icon}</span>
            </div>
            <div class="group-card-info">
              <h3 class="group-card-name" style="color:${color}">${escapeHTML(g.name)}</h3>
              <div class="group-card-meta">
                <span class="group-meta-item" style="color:${color}88">
                  <span>👥</span>
                  <span id="groupCount-${g.id}">${total}</span> طالب
                </span>
                <span class="group-meta-sep">•</span>
                <span class="group-meta-item group-meta-date">${formatDate(g.createdAt)}</span>
              </div>
            </div>
          </div>
          ${desc
            ? `<p class="group-card-desc">${desc}</p>`
            : `<p class="group-card-desc group-card-desc--empty">لا يوجد وصف</p>`
          }
        </div>
        <div class="group-card-footer">
          <button class="group-btn-manage" data-action="manage" data-id="${g.id}" data-name="${escapeHTML(g.name)}" title="${I18n.t('groups.actions.manage_title')}">
            <span>👥</span>
            <span>${I18n.t('groups.actions.manage')}</span>
          </button>
          <div class="group-btn-secondary-group">
            <button class="group-btn-edit" data-action="edit" data-id="${g.id}" title="${I18n.t('groups.actions.edit_title')}">
              <span>✏️</span>
            </button>
            <button class="group-btn-delete" data-action="delete" data-id="${g.id}" title="${I18n.t('groups.actions.delete_title')}">
              <span>🗑️</span>
            </button>
          </div>
        </div>
      </div>`;
  }

  function groupRowHTML(g){
    const total = countStudents(g.id);
    const icon = g.icon || '📚';
    const color = g.color || '#10b981';
    const description = g.description || g.desc || 'لا يوجد وصف';
    const date = formatDate(g.createdAt);
    
    return `
      <tr>
        <td>
          <div class="table-group-info">
            <div class="table-group-icon" style="background: ${color}15; color: ${color}; border: 2px solid ${color}25;">
              ${icon}
            </div>
            <div class="table-group-details">
              <h4>${escapeHTML(g.name)}</h4>
              <p>${escapeHTML(description)}</p>
            </div>
          </div>
        </td>
        <td>${escapeHTML(description)}</td>
        <td>
          <div class="table-students-count">
            <span>👥</span>
            <span>${total}</span>
          </div>
        </td>
        <td class="table-date">${date}</td>
        <td>
          <div class="table-actions">
            <button class="table-action-btn manage" data-action="manage" data-id="${g.id}" data-name="${escapeHTML(g.name)}" title="${I18n.t('groups.actions.manage_title')}">
              <span>👥</span>
              <span>${I18n.t('groups.actions.manage')}</span>
            </button>
            <button class="table-action-btn edit" data-action="edit" data-id="${g.id}" title="${I18n.t('groups.actions.edit_title')}">
              <span>✏️</span>
              <span>${I18n.t('groups.actions.edit')}</span>
            </button>
            <button class="table-action-btn delete" data-action="delete" data-id="${g.id}" title="${I18n.t('groups.actions.delete_title')}">
              <span>🗑️</span>
              <span>${I18n.t('groups.actions.delete')}</span>
            </button>
          </div>
        </td>
      </tr>`;
  }

  function countStudents(groupId){ return students.filter(s=> s.groupId === groupId).length; }

  // ===== Students Modal =====
  async function openStudentsModal(groupId, groupName){
    currentGroupId = groupId;
    const modal = document.getElementById('studentsModal');
    const content = document.getElementById('studentsModalContent');
    if (!modal || !content) return;
    
    console.log('Opening students modal:', {
      groupId,
      hasAPI,
      studentsInMemory: students.length
    });
    
    // Reload fresh data to ensure we have the latest state
    if (hasAPI) {
      console.log('Loading fresh data from API...');
      const freshStudents = await apiGetStudents();
      if (freshStudents !== null) {
        console.log('Loaded from API:', freshStudents.length, 'students');
        students = freshStudents;
      }
    } else {
      console.log('Loading from localStorage...');
      const localStudents = loadLocal(LS_STUDENTS);
      console.log('Loaded from localStorage:', localStudents.length, 'students');
      students = localStudents;
    }
    
    // Get current group students
    const groupStudents = students.filter(s=> s.groupId === groupId);
    console.log('Final result - Group students:', groupStudents.length);
    const totalStudents = groupStudents.length;
    const maleCount = groupStudents.filter(s => s.gender === 'male').length;
    const femaleCount = groupStudents.filter(s => s.gender === 'female').length;
    const otherCount = Math.max(totalStudents - (maleCount + femaleCount), 0);
    const groupLabel = groupName || '';
    const safeGroupName = escapeHTML(groupLabel);
    currentGroupSafeName = groupLabel;
    // Prevent i18n engine from overwriting injected HTML placeholder
    if (content.hasAttribute('data-i18n')) content.removeAttribute('data-i18n');
    content.innerHTML = `
      <div class="students-management">
        <div class="students-modal-grid">
          <section class="modal-card add-student-card">
            <form id="addStudentForm" class="add-student-form">
              <div class="add-student-title"><span>➕</span> <span data-i18n="groups.students.add.title">${I18n.t('groups.students.add.title')}</span></div>
              <div class="form-row">
                <div class="form-group">
                  <input type="text" name="studentName" class="form-input" data-i18n-placeholder="groups.students.add.name_placeholder" placeholder="${I18n.t('groups.students.add.name_placeholder')}" required />
                </div>
                <div class="form-group">
                  <select name="studentGender" class="form-select" required id="studentGenderSelect">
                    <option value="" data-i18n="groups.students.add.gender_placeholder">${I18n.t('groups.students.add.gender_placeholder')}</option>
                    <option value="male" data-i18n="groups.students.gender.male">${I18n.t('groups.students.gender.male')}</option>
                    <option value="female" data-i18n="groups.students.gender.female">${I18n.t('groups.students.gender.female')}</option>
                  </select>
                </div>
                <div class="form-group actions">
                  <button type="submit" class="btn btn-primary">
                    <span class="btn-icon">➕</span>
                    <span data-i18n="groups.students.add.submit">${I18n.t('groups.students.add.submit')}</span>
                  </button>
                  <button type="button" class="btn btn-outline" id="openImportExcelBtn" data-i18n-title="groups.students.controls.open_import_title" title="${I18n.t('groups.students.controls.open_import_title')}">
                    <span class="btn-icon">📥</span>
                    <span data-i18n="groups.students.controls.open_import">${I18n.t('groups.students.controls.open_import')}</span>
                  </button>
                  <button type="button" class="btn btn-outline" id="downloadTemplateBtn" data-i18n-title="groups.students.controls.download_template_title" title="${I18n.t('groups.students.controls.download_template_title')}">
                    <span class="btn-icon">📄</span>
                    <span data-i18n="groups.students.controls.download_template">${I18n.t('groups.students.controls.download_template')}</span>
                  </button>
                  <button type="button" class="btn btn-outline" id="openBulkAddBtn" data-i18n-title="groups.students.controls.open_bulk_add_title" title="${I18n.t('groups.students.controls.open_bulk_add_title')}">
                    <span class="btn-icon">👥</span>
                    <span data-i18n="groups.students.controls.open_bulk_add">${I18n.t('groups.students.controls.open_bulk_add')}</span>
                  </button>
                </div>
              </div>
              <div class="photo-preview" id="photoPreview" style="display:none">
                <img id="previewImage" src="" alt="${I18n.t('groups.students.photo.preview')}" />
                <span class="photo-name" id="photoName"></span>
              </div>
            </form>
          </section>
        </div>
        <section class="modal-card students-table-card">
          <div class="table-card-header table-card-header--compact">
            <div class="students-count">عدد المعروض: ${totalStudents} من ${totalStudents}</div>
          </div>
          <div class="students-toolbar">
            <div class="students-controls">
              <div class="students-controls-row">
                <div class="search-input-group">
                  <input type="text" id="studentSearch" class="search-input" data-i18n-placeholder="groups.students.search_placeholder" placeholder="${I18n.t('groups.students.search_placeholder')}" />
                  <span class="search-icon">🔍</span>
                  <button class="search-clear" type="button">✕</button>
                </div>
                <select id="genderFilter" class="form-select">
                  <option value="" data-i18n="groups.students.filter.all">${I18n.t('groups.students.filter.all')}</option>
                  <option value="male" data-i18n="groups.students.filter.male_only">${I18n.t('groups.students.filter.male_only')}</option>
                  <option value="female" data-i18n="groups.students.filter.female_only">${I18n.t('groups.students.filter.female_only')}</option>
                </select>
                <select id="sortStudents" class="form-select">
                  <option value="name-asc" data-i18n="groups.students.sort.name_asc">${I18n.t('groups.students.sort.name_asc')}</option>
                  <option value="name-desc" data-i18n="groups.students.sort.name_desc">${I18n.t('groups.students.sort.name_desc')}</option>
                  <option value="code-asc" data-i18n="groups.students.sort.code_asc">${I18n.t('groups.students.sort.code_asc')}</option>
                  <option value="code-desc" data-i18n="groups.students.sort.code_desc">${I18n.t('groups.students.sort.code_desc')}</option>
                  <option value="gender-male" data-i18n="groups.students.sort.gender_male">${I18n.t('groups.students.sort.gender_male')}</option>
                  <option value="gender-female" data-i18n="groups.students.sort.gender_female">${I18n.t('groups.students.sort.gender_female')}</option>
                  <option value="date-new" data-i18n="groups.students.sort.date_new">${I18n.t('groups.students.sort.date_new')}</option>
                  <option value="date-old" data-i18n="groups.students.sort.date_old">${I18n.t('groups.students.sort.date_old')}</option>
                </select>
              </div>
            </div>
          </div>
          <div class="students-list-section">
            <div id="studentsListContainer" class="students-list-container">
              ${renderStudentsList(groupStudents, { groupId, groupName: groupLabel })}
            </div>
          </div>
        </section>
      </div>`;

    // bind modal events
    setupStudentsModalEvents();
    setupDynamicModalListeners(); // Setup dynamic modal listeners after HTML is created
    // Set modal title to include the group name and students count next to 'إدارة الطلاب'
    const titleEl = document.querySelector('#studentsModal .modal-title');
    if (titleEl) {
      titleEl.innerHTML = `
        <span class="modal-title-group">${safeGroupName}</span>
        <span class="modal-title-label">${I18n.t('groups.modals.students.title')}</span>
        <div class="modal-title-stats">
          <span class="modal-title-chip" id="modalTitleTotal"><span>👥</span>${totalStudents}</span>
          <span class="modal-title-chip" id="modalTitleMale"><span>👦</span>${maleCount}</span>
          <span class="modal-title-chip" id="modalTitleFemale"><span>👧</span>${femaleCount}</span>
        </div>
      `;
    }
    modal.style.display = 'flex';
    
    // Reset search and filters when opening modal
    setTimeout(() => {
      const searchInput = document.getElementById('studentSearch');
      const genderFilter = document.getElementById('genderFilter');
      const sortSelect = document.getElementById('sortStudents');
      if (searchInput) searchInput.value = '';
      if (genderFilter) genderFilter.selectedIndex = 0;
      if (sortSelect) sortSelect.selectedIndex = 0;
      // Apply i18n to the newly injected modal content
      I18n.apply(modal);
      filterAndSortStudents();
    }, 100);
  }
  window.openImportExcelModal = function(){ 
    resetImportModal();
    document.getElementById('importExcelModal')?.style && (document.getElementById('importExcelModal').style.display='flex'); 
  };
  window.closeImportExcelModal = function(){ 
    const m=document.getElementById('importExcelModal'); 
    if(m) m.style.display='none'; 
    resetImportModal();
  };

  function resetImportModal(){
    // Reset file selection
    clearSelectedFile();
    
    // Reset form values
    const selects = ['nameColumnSelect', 'genderColumnSelect', 'extraColumn1Select', 'importModeSelect', 'duplicateHandlingSelect', 'defaultGenderSelect'];
    selects.forEach(id => {
      const select = document.getElementById(id);
      if (select) select.selectedIndex = 0;
    });
    
    // Reset preview
    const previewContent = document.getElementById('previewContent');
    const previewErrors = document.getElementById('previewErrors');
    if (previewContent) previewContent.innerHTML = '';
    if (previewErrors) previewErrors.style.display = 'none';
    
    // Reset stats
    ['totalRowsCount', 'validRowsCount', 'invalidRowsCount'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '0';
    });
    
    // Reset progress bar and current step
    currentStep = 1;
    resetProgressBar();
    updateStepNavigation();
    
    // Reset step statuses
    ['fileStepStatus', 'columnStepStatus', 'previewStepStatus'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = '';
        el.className = 'step-status';
      }
    });
    
    // Hide all steps except first
    document.getElementById('fileSelectionStep').style.display = 'block';
    document.getElementById('columnMappingStep').style.display = 'none';
    document.getElementById('importPreview').style.display = 'none';
  }

  // Progress bar management
  function updateProgressBar(currentStep) {
    const steps = document.querySelectorAll('.progress-step');
    steps.forEach((step, index) => {
      const stepNumber = index + 1;
      if (stepNumber < currentStep) {
        step.classList.add('completed');
        step.classList.remove('active');
      } else if (stepNumber === currentStep) {
        step.classList.add('active');
        step.classList.remove('completed');
      } else {
        step.classList.remove('active', 'completed');
      }
    });
  }

  function resetProgressBar() {
    const steps = document.querySelectorAll('.progress-step');
    steps.forEach((step, index) => {
      if (index === 0) {
        step.classList.add('active');
        step.classList.remove('completed');
      } else {
        step.classList.remove('active', 'completed');
      }
    });
  }

  function updateStepStatus(stepId, status, message) {
    const statusEl = document.getElementById(stepId);
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `step-status ${status}`;
    }
  }

  // Navigation functions
  let currentStep = 1;
  
  window.goToNextStep = function() {
    if (currentStep < 3) {
      currentStep++;
      updateStepNavigation();
    }
  };
  
  window.goToPreviousStep = function() {
    if (currentStep > 1) {
      currentStep--;
      updateStepNavigation();
    }
  };
  
  function updateStepNavigation() {
    const backBtn = document.getElementById('backBtn');
    const nextBtn = document.getElementById('nextBtn');
    const previewBtn = document.getElementById('previewBtn');
    const importBtn = document.getElementById('importBtn');
    
    // Show/hide back button
    if (backBtn) {
      backBtn.style.display = currentStep > 1 ? 'inline-flex' : 'none';
    }
    
    // Show/hide next button
    if (nextBtn) {
      nextBtn.style.display = currentStep < 2 ? 'inline-flex' : 'none';
    }
    
    // Show preview button on step 2
    if (previewBtn) {
      previewBtn.style.display = currentStep >= 2 ? 'inline-flex' : 'none';
    }
    
    // Show import button on step 3
    if (importBtn) {
      importBtn.style.display = currentStep >= 3 ? 'inline-flex' : 'none';
    }
    
    // Update progress bar
    updateProgressBar(currentStep);
  }
  function closeStudentsModal(){ const m=document.getElementById('studentsModal'); if(m) m.style.display='none'; }
  const closeStudentsModalBtn = document.getElementById('closeStudentsModalBtn');
  if (closeStudentsModalBtn) closeStudentsModalBtn.addEventListener('click', closeStudentsModal);

  function renderStudentsList(list, options = {}){
    if (!list || !list.length) return `<div class="empty-state" data-i18n="groups.students.empty">${I18n.t('groups.students.empty')}</div>`;
    const { groupId: actionsGroupId = currentGroupId, groupName: actionsGroupName = currentGroupSafeName } = options;
    const safeActionsGroupName = escapeHTML(actionsGroupName || '');
    return `<div class="students-table compact">
      <div class="students-table-header compact">
        <div class="header-cell info">${I18n.t('groups.students.table.name')}</div>
        <div class="header-cell meta">
          <span>${I18n.t('groups.students.table.code')}</span>
          <span>${I18n.t('groups.students.table.date')}</span>
          <span>${I18n.t('groups.students.table.gender')}</span>
        </div>
        <div class="header-cell actions">
          <span>${I18n.t('groups.students.table.actions')}</span>
          <div class="header-actions-buttons">
            <button type="button" class="btn btn-outline" id="updateCodesBtn" data-group-id="${actionsGroupId || ''}" data-i18n-title="groups.students.controls.update_codes_title" title="${I18n.t('groups.students.controls.update_codes_title')}">
              <span data-i18n="groups.students.controls.update_codes">${I18n.t('groups.students.controls.update_codes')}</span>
            </button>
            <button type="button" class="btn btn-success" id="exportExcelBtn" data-group-id="${actionsGroupId || ''}" data-group-name="${safeActionsGroupName}" data-i18n-title="groups.students.controls.export_excel_title" title="${I18n.t('groups.students.controls.export_excel_title')}">
              <span data-i18n="groups.students.controls.export_excel">${I18n.t('groups.students.controls.export_excel')}</span>
            </button>
            <button type="button" class="btn btn-danger" id="deleteAllStudentsBtn" data-group-id="${actionsGroupId || ''}" data-i18n-title="groups.students.controls.delete_all_title" title="${I18n.t('groups.students.controls.delete_all_title')}">
              <span data-i18n="groups.students.controls.delete_all">${I18n.t('groups.students.controls.delete_all')}</span>
            </button>
          </div>
        </div>
      </div>
      <div class="students-table-body">
        ${list.map(s=>{
          const safeName = escapeHTML(s.name || '');
          const code = escapeHTML(s.code || '');
          const genderLabel = s.gender === 'male' ? I18n.t('groups.students.gender.male') : I18n.t('groups.students.gender.female');
          const dateText = s.attendanceDate ? new Date(s.attendanceDate).toLocaleDateString(I18n.lang === 'ar' ? 'ar-EG' : 'en-US') : '—';
          const photo = s.photo ? `
            <button type="button" class="student-inline-avatar photo-thumb" data-src="${s.photo}" title="${I18n.t('groups.students.photo.view')}" aria-label="${I18n.t('groups.students.photo.view')}">
              <img src="${s.photo}" alt="${safeName}" class="student-photo"/>
            </button>
          ` : `
            <div class="student-inline-avatar avatar-placeholder" title="لا توجد صورة">
              ${s.gender === 'male' ? '👦' : '👧'}
            </div>
          `;
          return `
            <div class="student-row compact" data-student-id="${s.id}" data-gender="${s.gender}" data-name="${safeName}">
              <div class="student-line-info">
                ${photo}
                <div class="student-line-text">
                  <span class="student-name" title="${safeName}">${safeName}</span>
                </div>
              </div>
              <div class="student-line-meta">
                <span class="student-code-badge">${code || '—'}</span>
                <span class="student-date" title="${I18n.t('groups.students.table.date')}">${dateText}</span>
                <span class="gender-badge ${s.gender}" title="${genderLabel}">${genderLabel}</span>
              </div>
              <div class="student-line-actions">
                <button class="btn btn-sm btn-primary edit-student-btn" 
                        data-student-id="${s.id}" 
                        title="${I18n.t('groups.students.actions.edit_title')}" 
                        aria-label="تعديل الطالب ${safeName}">
                  <span class="btn-icon">✏️</span>
                  <span class="btn-text">${I18n.t('groups.students.actions.edit')}</span>
                </button>
                <button class="btn btn-sm btn-danger remove-student-btn" 
                        data-student-id="${s.id}" 
                        title="${I18n.t('groups.students.actions.delete_title')}" 
                        aria-label="حذف الطالب ${safeName}">
                  <span class="btn-icon">🗑️</span>
                  <span class="btn-text">${I18n.t('groups.students.actions.delete')}</span>
                </button>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  function setupStudentsModalEvents(){
    const form = document.getElementById('addStudentForm');
    if (form){ form.addEventListener('submit', handleAddStudent); }
    const gender = document.getElementById('studentGenderSelect');
    if (gender){ if (lastSelectedGender) gender.value = lastSelectedGender; gender.addEventListener('change', ()=>{ if (gender.value){ lastSelectedGender = gender.value; localStorage.setItem('cm_last_gender', lastSelectedGender); } }); }
    const file = document.getElementById('studentPhotoInput');
    if (file){ file.addEventListener('change', (e)=>{ const clearBtn=document.getElementById('clearPhotoBtn'); const img=document.getElementById('previewImage'); if (e.target.files && e.target.files[0]){ const reader=new FileReader(); reader.onload=(ev)=>{ img.src=ev.target.result; img.style.display='inline-block'; clearBtn.style.display='inline-flex'; }; reader.readAsDataURL(e.target.files[0]); } else { if(img){ img.style.display='none'; img.src=''; } if(clearBtn){ clearBtn.style.display='none'; } } }); }
    const si = document.getElementById('studentSearch'); si && si.addEventListener('input', filterAndSortStudents);
    const modalSearchClear = document.querySelector('#studentsModal .students-controls .search-clear');
    if (modalSearchClear) {
      modalSearchClear.addEventListener('click', () => {
        if (si) {
          si.value = '';
          filterAndSortStudents();
          si.focus();
        }
      });
    }
    const gf = document.getElementById('genderFilter'); gf && gf.addEventListener('change', filterAndSortStudents);
    const ss = document.getElementById('sortStudents'); ss && ss.addEventListener('change', filterAndSortStudents);
    // Prefill date input in add form to today (Gregorian)
    const dateField = document.querySelector('#addStudentForm input[name="attendanceDate"]');
    if (dateField) dateField.value = dateInputValue();

    // Clear photo button
    const clearPhotoBtn = document.getElementById('clearPhotoBtn');
    if (clearPhotoBtn) clearPhotoBtn.addEventListener('click', clearPhotoInput);

    // Edit student modal events
    const closeEditBtn = document.getElementById('closeEditStudentModalBtn');
    if (closeEditBtn) closeEditBtn.addEventListener('click', closeEditStudentModal);
    
    const cancelEditBtn = document.getElementById('cancelEditStudentFormBtn');  
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditStudentModal);

    // Remove photo button
    const removePhotoBtn = document.getElementById('removePhotoBtn');
    if (removePhotoBtn) removePhotoBtn.addEventListener('click', removeStudentPhoto);

    // Delete confirmation modal events
    const closeDeleteBtn = document.getElementById('closeConfirmDeleteStudentModalHeaderBtn');
    if (closeDeleteBtn) closeDeleteBtn.addEventListener('click', closeConfirmDeleteStudentModal);
    
    const confirmDeleteBtn = document.getElementById('confirmDeleteStudentBtn');
    if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', confirmStudentDeletion);
    
    const cancelDeleteBtn = document.getElementById('cancelDeleteStudentBtn');
    if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeConfirmDeleteStudentModal);

    // Import/Export buttons
    const openImportExcelBtn = document.getElementById('openImportExcelBtn');
    if (openImportExcelBtn) openImportExcelBtn.addEventListener('click', openImportExcelModal);

    const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
    if (downloadTemplateBtn) downloadTemplateBtn.addEventListener('click', downloadExcelTemplate);

    const openBulkAddBtn = document.getElementById('openBulkAddBtn');
    if (openBulkAddBtn) openBulkAddBtn.addEventListener('click', openBulkAddModal);

    // Group action buttons (updateCodesBtn, exportExcelBtn, deleteAllStudentsBtn)
    // handled via delegated listener on document (set up once in init)

    // Image zoom overlay events
    const container = document.getElementById('studentsListContainer');
    if (container){
      container.addEventListener('click', (e)=>{
        const btn = e.target.closest('.photo-thumb');
        if (!btn) return;
        const src = btn.getAttribute('data-src');
        if (!src) return;
        openImageOverlay(src);
      });

      // Event delegation for edit/remove student buttons
      container.addEventListener('click', (e) => {
        // Edit student button - improved selector to catch button and nested elements
        const editBtn = e.target.closest('.edit-student-btn') || (e.target.classList.contains('edit-student-btn') ? e.target : null);
        if (editBtn) {
          const studentId = editBtn.getAttribute('data-student-id');
          if (studentId) {
            console.log('Edit button clicked for student:', studentId);
            editStudent(studentId);
          }
          return;
        }

        // Remove student button - improved selector to catch button and nested elements  
        const removeBtn = e.target.closest('.remove-student-btn') || (e.target.classList.contains('remove-student-btn') ? e.target : null);
        if (removeBtn) {
          const studentId = removeBtn.getAttribute('data-student-id');
          if (studentId) {
            console.log('Remove button clicked for student:', studentId);
            removeStudent(studentId);
          }
          return;
        }
      });
    }
  }

  function openImageOverlay(src){
    // Create overlay if not exists
    let overlay = document.getElementById('imageOverlay');
    if (!overlay){
      overlay = document.createElement('div');
      overlay.id = 'imageOverlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.background = 'rgba(0,0,0,0.7)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '20000';
      overlay.innerHTML = `
        <div id="imageOverlayBackdrop" style="position:absolute;inset:0"></div>
        <img id="imageOverlayImg" src="" alt="صورة الطالب" style="max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.5);" />
      `;
      document.body.appendChild(overlay);
      // Close on backdrop click or Escape
      overlay.addEventListener('click', (ev)=>{
        if (ev.target.id === 'imageOverlay' || ev.target.id === 'imageOverlayBackdrop') closeImageOverlay();
      });
      document.addEventListener('keydown', escCloseHandler);
    }
    const img = overlay.querySelector('#imageOverlayImg');
    if (img){ img.src = src; }
    overlay.style.display = 'flex';
  }

  function closeImageOverlay(){
    const overlay = document.getElementById('imageOverlay');
    if (overlay){ overlay.style.display = 'none'; }
  }
  function escCloseHandler(e){ if (e.key === 'Escape') closeImageOverlay(); }

  async function handleAddStudent(e){
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = (fd.get('studentName')||'').toString().trim();
    const gender = fd.get('studentGender');
    const dateStr = (fd.get('attendanceDate')||'').toString().trim();
    if (!name || !gender){ showToast(I18n.t('groups.toast.fill_required'),'warning'); return; }
    
    // Check for duplicate student name in the same group
    const duplicateStudent = students.find(s => 
      s.groupId === currentGroupId && 
      s.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicateStudent) {
      showToast(I18n.t('groups.toast.student_name_exists'), 'warning');
      const nameInput = document.querySelector('#addStudentForm input[name="studentName"]');
      if (nameInput) nameInput.focus();
      return;
    }
    
    const file = fd.get('studentPhoto');
    let photo;
    if (file && file.size>0){ try { photo = await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); } catch{ showToast(I18n.t('groups.toast.student_added_no_photo'),'warning'); } }

    // Generate unique student code within the group
    const { code, seq } = generateStudentCode(currentGroupId);
    // Attendance date: use provided date or today
    const attendanceDate = dateStr ? new Date(dateStr + 'T00:00:00').toISOString() : new Date().toISOString();

    const payload = { id: uid(), name, gender, groupId: currentGroupId, photo, createdAt: attendanceDate, attendanceDate, code, codeSeq: seq };

    students.push(payload);
    
    if (hasAPI) {
      const saved = await apiSaveStudents(students);
      if (!saved) {
        // Rollback on failure
        students.pop();
        showToast('فشل في حفظ الطالب', 'error');
        return;
      }
    } else {
      saveLocal(LS_STUDENTS, students);
    }

    // Update students count for the group
    const group = groups.find(g => g.id === currentGroupId);
    if (group) {
      group.studentsCount = students.filter(s => s.groupId === currentGroupId).length;
      if (hasAPI) {
        await apiSaveGroups(groups);
      } else {
        saveLocal(LS_GROUPS, groups);
      }
    }
    
    showToast(I18n.t('groups.toast.student_added_success'),'success');
    // Update modal instantly without full re-render
    const container = document.getElementById('studentsListContainer');
    if (container) {
      const list = students.filter(s => s.groupId === currentGroupId);
      container.innerHTML = renderStudentsList(list, { groupId: currentGroupId, groupName: currentGroupSafeName });
      filterAndSortStudents();
    }
    updateModalSummaryCounts(group?.id || currentGroupId);
    // Update group card count in real-time
    const cardCount = document.getElementById(`groupCount-${currentGroupId}`);
    if (cardCount) cardCount.textContent = String(group?.studentsCount || students.filter(s=>s.groupId===currentGroupId).length);
    // Focus the name input and prefill last gender
    const nameInput2 = document.querySelector('#addStudentForm input[name="studentName"]');
    if (nameInput2) nameInput2.focus();
    const genderSelect2 = document.getElementById('studentGenderSelect');
    if (genderSelect2 && lastSelectedGender) genderSelect2.value = lastSelectedGender;

    // Reset add form inputs and preview
    const addForm = document.getElementById('addStudentForm');
    if (addForm) addForm.reset();
    const prev = document.getElementById('photoPreview');
    const clearBtn = document.getElementById('clearPhotoBtn');
    if (prev) prev.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    // Focus name input for quick successive adds
    const nameInput = document.querySelector('#addStudentForm input[name="studentName"]');
    if (nameInput) nameInput.focus();
  }

  window.clearPhotoInput = function(){
    const input=document.getElementById('studentPhotoInput');
    const btn=document.getElementById('clearPhotoBtn');
    const img=document.getElementById('previewImage');
    if (input){ input.value=''; }
    if (btn){ btn.style.display='none'; }
    if (img){ img.src=''; img.style.display='none'; }
  };

  function filterAndSortStudents(){
    if (!currentGroupId) return;
    
    const container = document.getElementById('studentsListContainer'); 
    if (!container) return;
    
    const q = normalize(document.getElementById('studentSearch')?.value || '');
    const gender = document.getElementById('genderFilter')?.value || '';
    const sort = document.getElementById('sortStudents')?.value || 'name-asc';
    
    // Get current students for this group from the data array, not DOM
    let groupStudents = students.filter(s => s.groupId === currentGroupId);
    
    // Apply filters
    let filteredStudents = groupStudents.filter(s => {
      const name = normalize(s.name || '');
      const code = normalize(s.code || '');
      const okText = !q || name.includes(q) || code.includes(q);
      const okGender = !gender || s.gender === gender;
      return okText && okGender;
    });
    
    // Apply sorting
    filteredStudents.sort((a, b) => {
      const aName = a.name || ''; 
      const bName = b.name || '';
      const aCode = a.code || '';
      const bCode = b.code || '';
      const aG = a.gender || ''; 
      const bG = b.gender || '';
      const aDate = new Date(a.attendanceDate || 0).getTime();
      const bDate = new Date(b.attendanceDate || 0).getTime();
      
      // Helper function to extract numeric part from code for proper sorting
      const getCodeNumber = (code) => {
        if (!code) return 0;
        const parts = code.split('-');
        const numPart = parts[parts.length - 1]; // get last part (sequence number)
        return parseInt(numPart) || 0;
      };
      
      const aCodeNum = getCodeNumber(aCode);
      const bCodeNum = getCodeNumber(bCode);
      
      const sortMap = {
        'name-asc': () => aName.localeCompare(bName, 'ar'),
        'name-desc': () => bName.localeCompare(aName, 'ar'),
        'code-asc': () => aCodeNum - bCodeNum,
        'code-desc': () => bCodeNum - aCodeNum,
        'gender-male': () => (aG === 'male' ? -1 : 1) - (bG === 'male' ? -1 : 1),
        'gender-female': () => (aG === 'female' ? -1 : 1) - (bG === 'female' ? -1 : 1),
        'date-new': () => bDate - aDate,
        'date-old': () => aDate - bDate
      };
      
      const sortFn = sortMap[sort];
      return sortFn ? sortFn() : 0;
    });
    
    // Re-render the filtered and sorted list
    container.innerHTML = renderStudentsList(filteredStudents, { groupId: currentGroupId, groupName: currentGroupSafeName });
    
    // Update count display
    const countEl = document.querySelector('.students-count'); 
    if (countEl) {
      countEl.textContent = `عدد المعروض: ${filteredStudents.length} من ${groupStudents.length}`;
    }
    updateModalSummaryCounts();
  }

  function updateModalSummaryCounts(targetGroupId = currentGroupId){
    if (!targetGroupId) return;
    const list = students.filter(s => s.groupId === targetGroupId);
    const total = list.length;
    const male = list.filter(s => s.gender === 'male').length;
    const female = list.filter(s => s.gender === 'female').length;
    const totalEl = document.getElementById('modalStudentsCount');
    if (totalEl) totalEl.textContent = String(total);
    const maleEl = document.getElementById('modalMaleCount');
    if (maleEl) maleEl.textContent = String(male);
    const femaleEl = document.getElementById('modalFemaleCount');
    if (femaleEl) femaleEl.textContent = String(female);
    const titleTotalEl = document.getElementById('modalTitleTotal');
    if (titleTotalEl) titleTotalEl.innerHTML = `<span>👥</span>${total}`;
    const titleMaleEl = document.getElementById('modalTitleMale');
    if (titleMaleEl) titleMaleEl.innerHTML = `<span>👦</span>${male}`;
    const titleFemaleEl = document.getElementById('modalTitleFemale');
    if (titleFemaleEl) titleFemaleEl.innerHTML = `<span>👧</span>${female}`;
  }

  // ===== Edit Group =====
  let selectedIcon = '📚'; // متغير لحفظ الأيقونة المختارة
  
  function openEditGroupModal(groupId){
    const g = groups.find(x=> x.id === groupId); if (!g) return;
    const m = document.getElementById('editGroupModal'); if (!m) return;
    m.style.display='flex';
    const n = document.getElementById('editGroupName'); const d = document.getElementById('editGroupDesc');
    const p = document.getElementById('editGroupCodePrefix');
    const hint = document.getElementById('editGroupCodeHint');
    if (n) n.value = g.name || ''; if (d) d.value = g.description || g.desc || '';
    const autoCode = String(getGroupCode(groupId));
    if (p) {
      p.value = (g.codePrefix || '').toString();
      p.placeholder = `تلقائي: ${autoCode}`;
    }
    if (hint) hint.textContent = `الكود الحالي الفعّال: ${getGroupCodePrefix(groupId)} — أكواد الطلاب ستكون: ${getGroupCodePrefix(groupId)}-001، ${getGroupCodePrefix(groupId)}-002، ...`;
    if (p && hint) {
      p.oninput = () => {
        const effective = p.value.trim() || autoCode;
        hint.textContent = `الكود الفعّال: ${effective} — أكواد الطلاب ستكون: ${effective}-001، ${effective}-002، ...`;
      };
    }

    // إعداد icon selector
    selectedIcon = g.icon || '📚';
    setupIconSelector();
    
    const form = document.getElementById('editGroupForm');
    form.onsubmit = async (e)=>{
      e.preventDefault();
      const name = n.value.trim(); const desc = d.value.trim();
      const rawPrefix = p ? p.value : '';
      // Allow empty prefix to fall back to auto numbering
      const codePrefix = (rawPrefix || '').toString().trim();
      if (!name) { n.focus(); return; }
      
      // Check for duplicate group name (excluding current group)
      const duplicate = groups.find(gr => gr.id !== g.id && gr.name.trim().toLowerCase() === name.toLowerCase());
      if (duplicate) {
        showToast('اسم المجموعة موجود بالفعل. الرجاء اختيار اسم آخر.', 'warning');
        n.focus();
        return;
      }
      
      showLoading();
      try {
        // Update in-memory
        const idx = groups.findIndex(x=> x.id === g.id); if (idx>-1){ groups[idx] = { ...groups[idx], name, description: desc, codePrefix, icon: selectedIcon }; }
        // Persist: try API then fallback to localStorage
        let persisted = false;
        if (hasAPI && window.api.saveGroups) {
          persisted = await apiSaveGroups(groups);
        }
        if (!persisted) {
          saveLocal(LS_GROUPS, groups);
          persisted = true;
        }
        showToast('تم حفظ التعديلات','success');
        render(); closeEditGroupModal();
      } finally { hideLoading(); }
    };
  }
  
  function setupIconSelector(){
    const selectedIconEl = document.getElementById('selectedIcon');
    const iconGrid = document.getElementById('iconGrid');
    const toggleBtn = document.getElementById('toggleIconGrid');
    
    if (!selectedIconEl || !iconGrid || !toggleBtn) return;
    
    // عرض الأيقونة المختارة
    selectedIconEl.textContent = selectedIcon;
    
    // إنشاء شبكة الأيقونات
    iconGrid.innerHTML = GROUP_ICONS.map(icon => 
      `<div class="icon-option ${icon === selectedIcon ? 'selected' : ''}" data-icon="${icon}">${icon}</div>`
    ).join('');
    
    // إضافة event listeners
    toggleBtn.onclick = () => {
      const isVisible = iconGrid.style.display !== 'none';
      iconGrid.style.display = isVisible ? 'none' : 'grid';
      toggleBtn.textContent = isVisible ? 'اختيار أيقونة أخرى' : 'إخفاء الأيقونات';
    };
    
    // النقر على الأيقونة المختارة لفتح/إغلاق الشبكة
    selectedIconEl.onclick = () => {
      const isVisible = iconGrid.style.display !== 'none';
      iconGrid.style.display = isVisible ? 'none' : 'grid';
      toggleBtn.textContent = isVisible ? 'اختيار أيقونة أخرى' : 'إخفاء الأيقونات';
    };
    
    // اختيار أيقونة من الشبكة
    iconGrid.addEventListener('click', (e) => {
      if (e.target.classList.contains('icon-option')) {
        // إزالة التحديد من الأيقونة السابقة
        iconGrid.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
        
        // تحديد الأيقونة الجديدة
        e.target.classList.add('selected');
        selectedIcon = e.target.dataset.icon;
        selectedIconEl.textContent = selectedIcon;
        
        // إخفاء الشبكة
        iconGrid.style.display = 'none';
        toggleBtn.textContent = 'اختيار أيقونة أخرى';
      }
    });
    
    // إخفاء الشبكة في البداية
    iconGrid.style.display = 'none';
  }
  window.closeEditGroupModal = function(){ const m=document.getElementById('editGroupModal'); if (m) m.style.display='none'; };

  // ===== Delete Group =====
  function openDeleteGroupModal(groupId){
    const g = groups.find(x=> x.id === groupId); if (!g) return;
    const m = document.getElementById('deleteGroupModal'); if (!m) return;
    const nameEl = document.getElementById('deleteGroupName'); if (nameEl) nameEl.textContent = g.name || '';
    m.dataset.groupId = groupId; m.style.display='flex';
  }
  window.closeDeleteGroupModal = function(){ const m=document.getElementById('deleteGroupModal'); if (m) m.style.display='none'; };
  window.confirmDeleteGroup = async function(){
    const m = document.getElementById('deleteGroupModal'); if (!m) return; const id = m.dataset.groupId; if (!id) return;
    
    // عد الطلاب في المجموعة
    const studentsInGroup = students.filter(s => s.groupId === id);
    const studentsCount = studentsInGroup.length;
    
    showLoading();
    try {
      // حذف المجموعة والطلاب من المصفوفات المحلية
      groups = groups.filter(g=> g.id !== id);
      students = students.filter(s=> s.groupId !== id);
      
      // حفظ التغييرات
      if (hasAPI) {
        // حفظ في API
        const groupsSaved = await apiSaveGroups(groups);
        const studentsSaved = await apiSaveStudents(students);
        
        if (!groupsSaved || !studentsSaved) {
          showToast('فشل في حفظ التغييرات', 'error');
          return;
        }
      } else {
        // حفظ في localStorage
        saveLocal(LS_GROUPS, groups); 
        saveLocal(LS_STUDENTS, students); 
      }
      
      // رسالة توضح التفاصيل
      const message = studentsCount > 0 
        ? `تم حذف المجموعة و ${studentsCount} طالب بنجاح`
        : 'تم حذف المجموعة بنجاح';
      
      showToast(message, 'success');
      render();
      closeDeleteGroupModal();
    } finally { hideLoading(); }
  };

  // ===== Student item actions =====
  let currentEditingStudentId = null;
  
  window.editStudent = function(studentId){
    const student = students.find(s => s.id === studentId);
    if (!student) {
      showToast('لم يتم العثور على الطالب', 'error');
      return;
    }
    
    currentEditingStudentId = studentId;
    
    // Fill form with current data
    document.getElementById('editStudentName').value = student.name || '';
    document.getElementById('editStudentGender').value = student.gender || '';
    // Prefill code and attendance date (Gregorian)
    const codeInput = document.getElementById('editStudentCode');
    if (codeInput) codeInput.value = student.code || '';
    const dateInputEl = document.getElementById('editAttendanceDate');
    if (dateInputEl) dateInputEl.value = dateInputValue(student.attendanceDate || student.createdAt);
    
    // Handle photo
    const currentPhotoDiv = document.getElementById('editCurrentPhoto');
    const currentPhotoImg = document.getElementById('editCurrentPhotoImg');
    const removePhotoBtn = document.getElementById('removePhotoBtn');
    const editPhotoPreview = document.getElementById('editPhotoPreview');
    
    if (student.photo) {
      currentPhotoImg.src = student.photo;
      currentPhotoDiv.style.display = 'block';
      removePhotoBtn.style.display = 'inline-flex';
    } else {
      currentPhotoDiv.style.display = 'none';
      removePhotoBtn.style.display = 'none';
    }
    
    editPhotoPreview.style.display = 'none';
    
    // Setup photo input event
    const photoInput = document.getElementById('editStudentPhotoInput');
    photoInput.value = '';
    photoInput.onchange = function(e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(ev) {
          document.getElementById('editPreviewImage').src = ev.target.result;
          editPhotoPreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      } else {
        editPhotoPreview.style.display = 'none';
      }
    };
    
    // Setup form submit
    const form = document.getElementById('editStudentForm');
    form.onsubmit = handleEditStudentSubmit;
    
    // Show modal
    document.getElementById('editStudentModal').style.display = 'flex';
  };
  
  window.closeEditStudentModal = function(){
    document.getElementById('editStudentModal').style.display = 'none';
    currentEditingStudentId = null;
  };
  
  window.removeStudentPhoto = function(){
    const currentPhotoDiv = document.getElementById('editCurrentPhoto');
    const removePhotoBtn = document.getElementById('removePhotoBtn');
    const editPhotoPreview = document.getElementById('editPhotoPreview');
    
    currentPhotoDiv.style.display = 'none';
    removePhotoBtn.style.display = 'none';
    editPhotoPreview.style.display = 'none';
    
    // Mark for removal
    currentPhotoDiv.dataset.removePhoto = 'true';
  };
  
  async function handleEditStudentSubmit(e) {
    e.preventDefault();
    
    if (!currentEditingStudentId) return;
    
    const formData = new FormData(e.target);
    const name = formData.get('studentName').toString().trim();
    const gender = formData.get('studentGender');
    const photoFile = formData.get('studentPhoto');
    const newCode = (formData.get('studentCode')||'').toString().trim();
    const newDateStr = (formData.get('attendanceDate')||'').toString().trim();
    
    if (!name || !gender) {
      showToast('يرجى إدخال جميع البيانات المطلوبة', 'warning');
      return;
    }
    
    showLoading();
    
    try {
      const student = students.find(s => s.id === currentEditingStudentId);
      if (!student) {
        showToast('لم يتم العثور على الطالب', 'error');
        return;
      }
      
      // Check for duplicate student name in the same group (excluding current student)
      const duplicateStudent = students.find(s => 
        s.groupId === student.groupId && 
        s.id !== student.id &&
        s.name.trim().toLowerCase() === name.toLowerCase()
      );
      if (duplicateStudent) {
        showToast('اسم الطالب موجود بالفعل في هذه المجموعة', 'warning');
        hideLoading();
        return;
      }
      
      // Update basic info
      student.name = name;
      student.gender = gender;
      // Ensure code exists (for older entries)
      if (!student.code){ const { code, seq } = generateStudentCode(student.groupId); student.code = code; student.codeSeq = seq; }
      
      // Update code if provided and unique within the group
      if (newCode) {
        const duplicate = students.find(s => s.groupId === student.groupId && s.id !== student.id && (s.code||'').toLowerCase() === newCode.toLowerCase());
        if (duplicate) {
          showToast('هذا الكود مستخدم بالفعل داخل المجموعة', 'error');
          hideLoading();
          return;
        }
        student.code = newCode;
        // Try to parse seq from pattern PREFIX-###
        const parts = newCode.split('-');
        const seqNum = Number(parts[1]);
        if (!isNaN(seqNum)) student.codeSeq = seqNum;
      }
      
      // Update attendance date (Gregorian)
      if (newDateStr) {
        // Keep as ISO with local timezone applied to preserve chosen date
        const dt = new Date(newDateStr + 'T00:00:00');
        student.attendanceDate = dt.toISOString();
      }
      
      // Handle photo
      const currentPhotoDiv = document.getElementById('editCurrentPhoto');
      if (currentPhotoDiv.dataset.removePhoto === 'true') {
        // Remove photo
        student.photo = null;
      } else if (photoFile && photoFile.size > 0) {
        // New photo uploaded
        const reader = new FileReader();
        await new Promise((resolve) => {
          reader.onload = function(ev) {
            student.photo = ev.target.result;
            resolve();
          };
          reader.readAsDataURL(photoFile);
        });
      }
      // If no changes to photo, keep existing photo
      
      // Save changes
      if (hasAPI) {
        const saved = await apiSaveStudents(students);
        if (!saved) {
          showToast('فشل في حفظ التحديثات', 'error');
          return;
        }
      } else {
        saveLocal(LS_STUDENTS, students);
      }
      
      // Update modal instantly without full re-render
      const container = document.getElementById('studentsListContainer');
      if (container) {
        const list = students.filter(s => s.groupId === currentGroupId);
        container.innerHTML = renderStudentsList(list, { groupId: currentGroupId, groupName: currentGroupSafeName });
        filterAndSortStudents();
      }
      updateModalSummaryCounts(currentGroupId);
      
      closeEditStudentModal();
      showToast('تم تحديث بيانات الطالب بنجاح', 'success');
      
    } catch (error) {
      console.error('Error updating student:', error);
      showToast('حدث خطأ أثناء تحديث بيانات الطالب', 'error');
    } finally {
      hideLoading();
    }
  }
  let currentDeletingStudentId = null;
  
  window.removeStudent = function(studentId){
    const student = students.find(s => s.id === studentId);
    if (!student) {
      showToast('لم يتم العثور على الطالب', 'error');
      return;
    }
    
    currentDeletingStudentId = studentId;
    
    // Fill preview with student data
    const preview = document.getElementById('deleteStudentPreview');
    preview.innerHTML = `
      <div class="student-preview-card" style="display:flex;align-items:center;gap:12px;padding:15px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <div class="student-avatar">
          ${student.photo ? 
            `<img src="${student.photo}" alt="${escapeHTML(student.name)}" style="height:50px;width:50px;object-fit:cover;border-radius:8px;" />` : 
            `<div style="height:50px;width:50px;background:#e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;">${student.gender === 'male' ? '👦' : '👧'}</div>`
          }
        </div>
        <div class="student-details">
          <h4 style="margin:0;color:#1e293b;font-size:16px;font-weight:600;">${escapeHTML(student.name)}</h4>
          <p style="margin:4px 0 0;color:#64748b;font-size:14px;">
            <span class="gender-badge" style="padding:2px 8px;border-radius:12px;background:${student.gender === 'male' ? '#dbeafe' : '#fce7f3'};color:${student.gender === 'male' ? '#1e40af' : '#be185d'};">
              ${student.gender === 'male' ? 'ذكر' : 'أنثى'}
            </span>
          </p>
        </div>
      </div>
    `;
    
    // Show modal
    document.getElementById('confirmDeleteStudentModal').style.display = 'flex';
  };
  
  window.closeConfirmDeleteStudentModal = function(){
    document.getElementById('confirmDeleteStudentModal').style.display = 'none';
    currentDeletingStudentId = null;
  };
  
  window.confirmStudentDeletion = async function(){
    const targetId = currentDeletingStudentId;
    if (!targetId) return;
    
    showLoading();
    // Hide modal without resetting the ID prematurely
    const modalEl = document.getElementById('confirmDeleteStudentModal');
    if (modalEl) modalEl.style.display = 'none';
    
    try {
      // Remove the student by captured ID
      students = students.filter(s => s.id !== targetId);
      
      if (hasAPI) {
        const saved = await apiSaveStudents(students);
        if (!saved) {
          showToast('فشل في حذف الطالب', 'error');
          return;
        }
      } else {
        saveLocal(LS_STUDENTS, students);
      }
      
      // Update students count for the group
      const group = groups.find(g => g.id === currentGroupId);
      if (group) {
        group.studentsCount = students.filter(s => s.groupId === currentGroupId).length;
        if (hasAPI) {
          await apiSaveGroups(groups);
        } else {
          saveLocal(LS_GROUPS, groups);
        }
      }
      
      // Update modal DOM immediately without full re-render
      const row = document.querySelector(`.student-row[data-student-id="${targetId}"]`);
      if (row) row.remove();
      updateModalSummaryCounts(group?.id || currentGroupId);
      // Update group card count in real-time
      const cardCount = document.getElementById(`groupCount-${currentGroupId}`);
      if (cardCount) cardCount.textContent = String(group?.studentsCount || students.filter(s=>s.groupId===currentGroupId).length);
      // Recalculate visible count and sorting
      filterAndSortStudents();
      const container = document.getElementById('studentsListContainer');
      if (container) {
        const remaining = container.querySelectorAll('.student-row').length;
        if (!remaining) container.innerHTML = renderStudentsList([], { groupId: currentGroupId, groupName: currentGroupSafeName });
      }
      showToast('تم حذف الطالب بنجاح', 'success');
    } catch (error) {
      console.error('Error deleting student:', error);
      showToast('حدث خطأ أثناء حذف الطالب', 'error');
    } finally { 
      // Now it's safe to clear the tracked ID
      currentDeletingStudentId = null;
      hideLoading(); 
    }
  };
  let currentDeletingGroupId = null;
  
  window.confirmDeleteAllStudents = function(groupId){
    const group = groups.find(g => g.id === groupId);
    const groupStudents = students.filter(s => s.groupId === groupId);
    
    if (!groupStudents.length) {
      showToast('لا يوجد طلاب في هذه المجموعة', 'info');
      return;
    }
    
    currentDeletingGroupId = groupId;
    
    // Fill preview with group data
    const preview = document.getElementById('deleteAllStudentsPreview');
    preview.innerHTML = `
      <div class="group-preview-card" style="padding:15px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <div class="group-header" style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <div style="height:50px;width:50px;background:#3b82f6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;color:white;font-weight:bold;">مج</div>
          <div>
            <h4 style="margin:0;color:#1e293b;font-size:16px;font-weight:600;">${escapeHTML(group?.name || 'مجموعة غير معروفة')}</h4>
            <p style="margin:4px 0 0;color:#64748b;font-size:14px;">عدد الطلاب: ${groupStudents.length}</p>
          </div>
        </div>
        <div class="students-summary" style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
          <h5 style="margin:0 0 8px;color:#374151;font-size:14px;">الطلاب المراد حذفهم:</h5>
          <div class="students-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;max-height:120px;overflow-y:auto;">
            ${groupStudents.slice(0, 12).map(s => `
              <div class="student-mini-card" style="display:flex;align-items:center;gap:6px;padding:6px;background:#f8fafc;border-radius:4px;">
                <div style="height:24px;width:24px;font-size:14px;">${s.photo ? `<img src="${s.photo}" style="height:24px;width:24px;object-fit:cover;border-radius:4px;" />` : (s.gender === 'male' ? '👦' : '👧')}</div>
                <span style="font-size:12px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(s.name)}</span>
              </div>
            `).join('')}
            ${groupStudents.length > 12 ? `<div style="padding:6px;color:#64748b;font-size:12px;text-align:center;">و ${groupStudents.length - 12} طالب آخر...</div>` : ''}
          </div>
        </div>
      </div>
    `;
    
    // Show modal
    document.getElementById('confirmDeleteAllStudentsModal').style.display = 'flex';
  };
  
  window.closeConfirmDeleteAllStudentsModal = function(){
    document.getElementById('confirmDeleteAllStudentsModal').style.display = 'none';
    currentDeletingGroupId = null;
  };
  
  window.confirmAllStudentsDeletion = async function(){
    const targetGroupId = currentDeletingGroupId; // Capture the ID before closing modal
    if (!targetGroupId) return;
    
    const groupStudents = students.filter(s => s.groupId === targetGroupId);
    if (!groupStudents.length) {
      showToast('لا يوجد طلاب في هذه المجموعة', 'info');
      closeConfirmDeleteAllStudentsModal();
      return;
    }
    
    console.log('Before deletion:', {
      hasAPI,
      totalStudents: students.length,
      groupStudents: groupStudents.length,
      targetGroupId: targetGroupId
    });
    
    showLoading();
    closeConfirmDeleteAllStudentsModal();
    
    try {
      // Remove all students from this group
      const originalStudents = [...students];
      console.log('Original students IDs:', originalStudents.map(s => ({id: s.id, groupId: s.groupId})));
      console.log('Target group ID:', targetGroupId);
      
      students = students.filter(s => s.groupId !== targetGroupId);
      
      console.log('After filtering:', {
        originalCount: originalStudents.length,
        newCount: students.length,
        removedCount: originalStudents.length - students.length
      });
      console.log('Remaining students IDs:', students.map(s => ({id: s.id, groupId: s.groupId})));
      
      // Save students data
      let saveSuccess = false;
      if (hasAPI) {
        console.log('Saving via API...');
        saveSuccess = await apiSaveStudents(students);
        console.log('API save result:', saveSuccess);
      } else {
        console.log('Saving to localStorage...');
        console.log('Data being saved:', students.length, 'students');
        saveLocal(LS_STUDENTS, students);
        // Verify localStorage save
        const saved = loadLocal(LS_STUDENTS);
        console.log('Verified localStorage save:', saved.length, 'students');
        
        // Double check that the group students are actually gone
        const remainingGroupStudents = saved.filter(s => s.groupId === targetGroupId);
        console.log('Students remaining in group after save:', remainingGroupStudents.length);
        
        saveSuccess = true;
      }
      
      if (!saveSuccess) {
        // Rollback on failure
        students = originalStudents;
        showToast('فشل في حفظ البيانات', 'error');
        return;
      }
      
      // Update group data
      const group = groups.find(g => g.id === targetGroupId);
      if (group) {
        group.studentsCount = 0;
        if (hasAPI) {
          await apiSaveGroups(groups);
        } else {
          saveLocal(LS_GROUPS, groups);
        }
      }
      
      // Update modal instantly without full re-render (same as single student deletion)
      const container = document.getElementById('studentsListContainer');
      if (container) {
        const list = students.filter(s => s.groupId === targetGroupId);
        container.innerHTML = renderStudentsList(list, { groupId: currentGroupId, groupName: currentGroupSafeName });
      }
      
      // Update modal counters
      updateModalSummaryCounts(targetGroupId);
      
      // Update group card count in real-time
      const cardCount = document.getElementById(`groupCount-${targetGroupId}`);
      if (cardCount) cardCount.textContent = String(students.filter(s=>s.groupId===targetGroupId).length);
      
      // Recalculate visible count and sorting (same as single student deletion)
      filterAndSortStudents();
      
      // Clear filters
      const searchInput = document.getElementById('studentSearch');
      const genderFilter = document.getElementById('genderFilter');
      const sortSelect = document.getElementById('sortStudents');
      if (searchInput) searchInput.value = '';
      if (genderFilter) genderFilter.selectedIndex = 0;
      if (sortSelect) sortSelect.selectedIndex = 0;
      
      // Update main groups display
      render();
      
      showToast(`تم حذف ${groupStudents.length} طالب بنجاح`, 'success');
      
      console.log('Deletion completed successfully');
      
    } catch (error) {
      console.error('Error deleting students:', error);
      showToast('حدث خطأ أثناء حذف الطلاب', 'error');
    } finally { 
      hideLoading(); 
    }
  };

  // ===== Import from Excel (Enhanced) =====
  let selectedExcelFile = null;
  let excelColumns = [];
  let excelData = [];

  window.selectExcelFileElectron = async function(){
    // Electron path
    if (hasAPI && window.api.selectExcelFile){
      try {
        const res = await window.api.selectExcelFile();
        if (res?.canceled){ showToast('تم الإلغاء','warning'); return; }
        const filePath = res.filePath;
        selectedExcelFile = { path: filePath, name: filePath.split('\\').pop() || filePath.split('/').pop() };
        updateFileSelection();
        await loadExcelColumns();
      } catch(e){ console.error(e); showToast('فشل اختيار الملف','error'); }
      return;
    }
    // Browser fallback: use hidden input
    const input = document.getElementById('hiddenExcelInput');
    input?.click();
    input?.addEventListener('change', async ()=>{
      const f = input.files && input.files[0];
      if (f){
        selectedExcelFile = { file: f, name: f.name, size: f.size };
        updateFileSelection();
        await loadExcelColumns();
      }
    }, { once:true });
  };

  function updateFileSelection(){
    if (!selectedExcelFile) return;
    
    document.getElementById('selectedFileName').textContent = selectedExcelFile.name;
    document.getElementById('selectedFileInfo').style.display = 'inline-flex';
    document.getElementById('selectFileBtnText').textContent = 'تم اختيار ملف';
    
    // Show file size if available
    if (selectedExcelFile.size){
      const sizeKB = Math.round(selectedExcelFile.size / 1024);
      document.getElementById('fileSize').textContent = `${sizeKB} KB`;
    }
    
    // Update progress and status
    currentStep = 2;
    updateProgressBar(2);
    updateStepStatus('fileStepStatus', 'success', 'تم اختيار الملف');
    updateStepNavigation();
    
    // Show next steps
    showStep('columnMappingStep');
  }

  async function loadExcelColumns(){
    if (!selectedExcelFile) return;
    
    showLoading();
    try {
      if (hasAPI && window.api.getExcelColumns){
        // Electron path
        const res = await window.api.getExcelColumns(selectedExcelFile.path);
        if (res?.ok === false) throw new Error(res?.error || 'فشل قراءة الملف');
        excelColumns = res.columns || [];
        populateColumnSelects();
      } else if (selectedExcelFile.file) {
        // Browser path using XLSX library
        const xlsxReady = await loadXLSX();
        if (!xlsxReady) { showToast('مكتبة قراءة Excel غير متوفرة','warning'); return; }
        const file = selectedExcelFile.file;
        const arrayBuffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
        
        // Get first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Get range and extract headers
        const range = window.XLSX.utils.decode_range(worksheet['!ref']);
        const headers = [];
        
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellAddress = window.XLSX.utils.encode_cell({ r: range.s.r, c: col });
          const cell = worksheet[cellAddress];
          headers.push(cell ? String(cell.v) : `Column ${col + 1}`);
        }
        
        excelColumns = headers;
        populateColumnSelects();
      } else {
        showToast('مكتبة قراءة Excel غير متوفرة','warning');
      }
    } catch(e){
      console.error(e);
      showToast(I18n.t('groups.import.preview.error.preview_failed').replace('{message}', e.message),'error');
    } finally {
      hideLoading();
    }
  }

  // Localize static labels in column mapping and file selection
  (function(){
    const btn = document.getElementById('selectFileBtnText');
    if (btn && btn.textContent.includes('اختر ملف Excel')) {
      btn.textContent = I18n.t('groups.import.preview.select_file_btn');
    }
  })();

  function populateColumnSelects(){
    const nameSelect = document.getElementById('nameColumnSelect');
    const genderSelect = document.getElementById('genderColumnSelect');
    
    // Clear existing options
    [nameSelect, genderSelect].forEach(select => {
      if (select) {
        select.innerHTML = '<option value="">اختر العمود...</option>';
        excelColumns.forEach((col, index) => {
          const option = document.createElement('option');
          option.value = index;
          option.textContent = col;
          select.appendChild(option);
        });
      }
    });

    // Auto-detect common column names
    autoDetectColumns();
    
    // Add event listeners to update progress
    if (nameSelect) {
      nameSelect.addEventListener('change', updateColumnMappingStatus);
    }
    if (genderSelect) {
      genderSelect.addEventListener('change', updateColumnMappingStatus);
    }
  }

  function updateColumnMappingStatus() {
    const nameCol = document.getElementById('nameColumnSelect').value;
    
    if (nameCol) {
      updateStepStatus('columnStepStatus', 'success', '');
    } else {
      updateStepStatus('columnStepStatus', 'warning', I18n.t('groups.import.preview.warn.name_column_required'));
    }
  }

  function autoDetectColumns(){
    const nameSelect = document.getElementById('nameColumnSelect');
    const genderSelect = document.getElementById('genderColumnSelect');

    let nameSet = false;
    let genderSet = false;
    const aliases = {
      name: ['اسم','الاسم','name','fullname','full name'],
      gender: ['نوع','النوع','gender','sex','male/female','ذكر/أنثى','ذكر','أنثى']
    };
    
    excelColumns.forEach((col, index) => {
      const colLower = (col || '').toString().toLowerCase();
      
      // Auto-detect name column (first match)
      if (!nameSet && aliases.name.some(a => colLower.includes(a))){
        if (nameSelect) nameSelect.value = index;
        nameSet = true;
      }
      
      // Auto-detect gender column (first match)
      if (!genderSet && aliases.gender.some(a => colLower.includes(a))){
        if (genderSelect) genderSelect.value = index;
        genderSet = true;
      }
    });
  }

  function showStep(stepId){
    // Show the specified step
    const step = document.getElementById(stepId);
    if (step) {
      step.style.display = 'block';
      step.classList.add('active');
    }
    
    // Show all previous steps as well for better UX
    const stepOrder = ['fileSelectionStep', 'columnMappingStep', 'importPreview'];
    const currentIndex = stepOrder.indexOf(stepId);
    
    for (let i = 0; i <= currentIndex; i++) {
      const el = document.getElementById(stepOrder[i]);
      if (el) {
        el.style.display = 'block';
        if (i < currentIndex) {
          el.classList.add('completed');
        }
      }
    }
  }

  window.previewExcelData = async function(){
    const nameCol = document.getElementById('nameColumnSelect')?.value;
    const genderCol = document.getElementById('genderColumnSelect')?.value;
    
    if (!nameCol){
      showToast(I18n.t('groups.import.preview.warn.name_column_required'),'warning');
      return;
    }
    
    showLoading();
    try {
      if (hasAPI && window.api.previewExcelData){
        // Electron path
        const res = await window.api.previewExcelData({
          file: selectedExcelFile.path,
          nameCol: parseInt(nameCol),
          genderCol: genderCol ? parseInt(genderCol) : null
        });
        
        if (res?.ok === false) throw new Error(res?.error || I18n.t('groups.import.preview.error.preview_failed').replace('{message}', ''));
        
        excelData = res.data || [];
        displayPreview(res);
        
        // Update progress and status
        currentStep = 3;
        updateProgressBar(3);
        const validCount = res.stats?.valid || 0;
        const totalCount = res.stats?.total || 0;
        updateStepStatus('previewStepStatus', 'success', I18n.t('groups.import.preview.success_short').replace('{valid}', validCount).replace('{total}', totalCount));
        updateStepNavigation();
        
        showStep('importPreview');
      } else if (selectedExcelFile.file) {
        // Browser path using XLSX library
        const xlsxReady = await loadXLSX();
        if (!xlsxReady) { showToast('مكتبة قراءة Excel غير متوفرة','warning'); return; }
        const file = selectedExcelFile.file;
        const arrayBuffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
        
        // Get first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = window.XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Process data
        const nameColIndex = parseInt(nameCol);
        const genderColIndex = genderCol ? parseInt(genderCol) : null;
        
        const processedData = [];
        let validCount = 0;
        let invalidCount = 0;
        
        // Skip header row
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          const name = row[nameColIndex] ? String(row[nameColIndex]).trim() : '';
          const genderValue = genderColIndex !== null && row[genderColIndex] ? String(row[genderColIndex]).trim() : '';
          
          let gender = null;
          if (genderValue) {
            const gNorm = normalizeGenderValue(genderValue);
            if (gNorm) {
              gender = gNorm;
            }
          }
          
          const valid = name.length > 0;
          if (valid) validCount++;
          else invalidCount++;
          
          processedData.push({
            name,
            gender,
            valid,
            originalRow: i + 1
          });
        }
        
        const result = {
          data: processedData,
          stats: {
            total: processedData.length,
            valid: validCount,
            invalid: invalidCount
          }
        };
        
        excelData = processedData;
        displayPreview(result);
        
        // Update progress and status
        currentStep = 3;
        updateProgressBar(3);
        updateStepStatus('previewStepStatus', 'success', I18n.t('groups.import.preview.success_short').replace('{valid}', validCount).replace('{total}', processedData.length));
        updateStepNavigation();
        
        showStep('importPreview');
      } else {
        showToast('مكتبة قراءة Excel غير متوفرة','warning');
      }
    } catch(e){
      console.error(e);
      showToast('فشل معاينة البيانات: ' + e.message,'error');
    } finally {
      hideLoading();
    }
  };

  function displayPreview(previewData){
    const { data, stats, errors } = previewData;
    
    // Update stats
    document.getElementById('totalRowsCount').textContent = stats?.total || 0;
    document.getElementById('validRowsCount').textContent = stats?.valid || 0;
    document.getElementById('invalidRowsCount').textContent = stats?.invalid || 0;
    
    // Display preview table
    const previewContent = document.getElementById('previewContent');
    if (data && data.length > 0){
      const tableHTML = `
        <table class="preview-table">
          <thead>
            <tr>
              <th data-i18n="groups.import.preview.table.name">${I18n.t('groups.import.preview.table.name')}</th>
              <th data-i18n="groups.import.preview.table.gender">${I18n.t('groups.import.preview.table.gender')}</th>
              <th data-i18n="groups.import.preview.table.status">${I18n.t('groups.import.preview.table.status')}</th>
            </tr>
          </thead>
          <tbody>
            ${data.slice(0, 10).map(row => `
              <tr>
                <td>${escapeHTML(row.name || '')}</td>
                <td>${row.gender ? `<span class=\"gender-badge ${row.gender}\">${row.gender === 'male' ? I18n.t('groups.import.preview.gender.male') : I18n.t('groups.import.preview.gender.female')}</span>` : '-'}</td>
                <td>${row.valid ? I18n.t('groups.import.preview.status.valid') : I18n.t('groups.import.preview.status.invalid')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${data.length > 10 ? `<p style=\"text-align:center;margin-top:8px;color:#64748b\">${I18n.t('groups.import.preview.more_rows').replace('{count}', (data.length - 10))}</p>` : ''}
      `;
      previewContent.innerHTML = tableHTML;
      I18n.apply(previewContent);
    }
    
    // Display errors if any
    const errorsContainer = document.getElementById('previewErrors');
    const errorsList = document.getElementById('errorsList');
    if (errors && errors.length > 0){
      errorsList.innerHTML = errors.map(error => `<li>${escapeHTML(error)}</li>`).join('');
      errorsContainer.style.display = 'block';
    } else {
      errorsContainer.style.display = 'none';
    }
  }

  window.clearSelectedFile = function(){
    selectedExcelFile = null;
    excelColumns = [];
    excelData = [];
    
    const info = document.getElementById('selectedFileInfo');
    const name = document.getElementById('selectedFileName');
    const size = document.getElementById('fileSize');
    const hiddenInput = document.getElementById('hiddenExcelInput');
    
    if (info) info.style.display = 'none';
    if (name) name.textContent = 'لم يتم اختيار ملف';
    if (size) size.textContent = '';
    if (hiddenInput) hiddenInput.value = '';
    
    // Reset to step 1
    currentStep = 1;
    updateProgressBar(1);
    updateStepNavigation();
    
    // Clear step statuses
    updateStepStatus('fileStepStatus', '', '');
    updateStepStatus('columnStepStatus', '', '');
    updateStepStatus('previewStepStatus', '', '');
    
    // Hide steps
    ['columnMappingStep', 'importPreview'].forEach(stepId => {
      const step = document.getElementById(stepId);
      if (step) {
        step.style.display = 'none';
        step.classList.remove('active');
      }
    });
    
    document.getElementById('selectFileBtnText').textContent = 'اختر ملف Excel (.xlsx, .xls)';
  };

  window.processExcelImport = async function(){
    const nameCol = document.getElementById('nameColumnSelect')?.value;
    const genderCol = document.getElementById('genderColumnSelect')?.value;
    const mode = document.getElementById('importModeSelect')?.value || 'add';
    
    if (!nameCol){
      showToast(I18n.t('groups.import.preview.warn.name_column_required'),'warning');
      return;
    }
    
    if (!excelData || excelData.length === 0) {
      showToast(I18n.t('groups.import.preview.warn.no_data'),'warning');
      return;
    }
    
    showLoading();
    try {
      // Process data locally since we already have it
      const validStudents = excelData.filter(row => row.valid && row.name.trim());
      
      if (mode === 'replace') {
        // Remove existing students for this group
        students = students.filter(s => s.groupId !== currentGroupId);
      }
      
      let importedCount = 0;
      for (const row of validStudents) {
        // Check for duplicates only in add mode
        if (mode === 'add') {
          const existingStudent = students.find(s => 
            s.groupId === currentGroupId && 
            s.name.toLowerCase().trim() === row.name.toLowerCase().trim()
          );
          if (existingStudent) {
            continue; // Skip duplicate
          }
        }
        
        const { code, seq } = generateStudentCode(currentGroupId);
        const nowISO = new Date().toISOString();
        const newStudent = {
          id: uid(),
          name: row.name.trim(),
          gender: row.gender || 'male', // Default to male if not specified
          groupId: currentGroupId,
          createdAt: nowISO,
          attendanceDate: nowISO,
          code,
          codeSeq: seq
        };
        
        students.push(newStudent);
        importedCount++;
      }
      
      // Persist students
      if (hasAPI) {
        const saved = await apiSaveStudents(students);
        if (!saved) {
          showToast('فشل في حفظ الطلاب المستوردين','error');
          return;
        }
      } else {
        saveLocal(LS_STUDENTS, students);
      }
      
      // Update students count for the current group and persist groups
      const group = groups.find(g => g.id === currentGroupId);
      if (group) {
        group.studentsCount = students.filter(s => s.groupId === currentGroupId).length;
        if (hasAPI) {
          await apiSaveGroups(groups);
        } else {
          saveLocal(LS_GROUPS, groups);
        }
      }
      
      // Update modal instantly without full re-open
      const container = document.getElementById('studentsListContainer');
      if (container) {
        const list = students.filter(s => s.groupId === currentGroupId);
        container.innerHTML = renderStudentsList(list, { groupId: currentGroupId, groupName: currentGroupSafeName });
      }
      updateModalSummaryCounts(group?.id || currentGroupId);
      // Update group card count in real-time
      const cardCount = document.getElementById(`groupCount-${currentGroupId}`);
      if (cardCount) cardCount.textContent = String(group?.studentsCount || students.filter(s=>s.groupId===currentGroupId).length);
      filterAndSortStudents();
      closeImportExcelModal();
      
      showToast(`تم استيراد ${importedCount} طالب بنجاح`, 'success');
    } catch(e){
      console.error(e);
      showToast('فشل استيراد الطلاب','error');
    } finally {
      hideLoading();
    }
  };

  // ===== Additional Functions =====
  window.downloadExcelTemplate = function(){
    // Create Excel template using XLSX library
    const templateData = [
      { 'الاسم': 'أحمد محمد علي', 'النوع': 'ذكر' },
      { 'الاسم': 'فاطمة سعد أحمد', 'النوع': 'أنثى' },
      { 'الاسم': 'محمد خالد سالم', 'النوع': 'ذكر' },
      { 'الاسم': 'نور الهدى محمود', 'النوع': 'أنثى' },
      { 'الاسم': 'علي أحمد يوسف', 'النوع': 'ذكر' },
      { 'الاسم': 'مريم سالم عبدالله', 'النوع': 'أنثى' },
      { 'الاسم': 'يوسف خالد محمد', 'النوع': 'ذكر' },
      { 'الاسم': 'زينب محمود علي', 'النوع': 'أنثى' },
      { 'الاسم': 'حسام الدين أحمد', 'النوع': 'ذكر' },
      { 'الاسم': 'آية عبدالرحمن', 'النوع': 'أنثى' }
    ];
    
    // Check if XLSX library is available
    if (typeof XLSX === 'undefined') {
      // Fallback: download the existing Excel file
      const a = document.createElement('a');
      a.href = '/قالب-الطلاب.xlsx';
      a.download = 'قالب-الطلاب.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('تم تحميل قالب Excel', 'success');
      return;
    }
    
    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    
    // Set column widths
    worksheet['!cols'] = [
      { width: 25 }, // الاسم
      { width: 10 }  // النوع
    ];
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'الطلاب');
    
    // Generate Excel file and download
    XLSX.writeFile(workbook, 'قالب-الطلاب.xlsx');
    
    showToast('تم تحميل قالب Excel', 'success');
  };

  window.openBulkAddModal = function(){
    document.getElementById('bulkAddModal').style.display = 'flex';
    document.getElementById('bulkStudentsList').focus();
  };

  window.closeBulkAddModal = function(){
    document.getElementById('bulkAddModal').style.display = 'none';
    // Reset form
    document.getElementById('bulkStudentsList').value = '';
    document.getElementById('bulkDefaultGender').selectedIndex = 0;
    document.getElementById('bulkDuplicateHandling').selectedIndex = 0;
    document.getElementById('bulkPreview').style.display = 'none';
  };

  window.previewBulkStudents = function(){
    const text = document.getElementById('bulkStudentsList').value.trim();
    const defaultGender = document.getElementById('bulkDefaultGender').value;
    
    if (!text) {
      showToast('يرجى إدخال قائمة الطلاب', 'warning');
      return;
    }
    
    const lines = text.split('\n').filter(line => line.trim());
    const students = [];
    let validCount = 0;
    let invalidCount = 0;
    
    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;
      
      const parts = trimmedLine.split(',').map(p => p.trim());
      const name = parts[0];
      let gender = parts[1] || defaultGender;
      
      // Normalize gender values
      if (gender) {
        const genderLower = gender.toLowerCase();
        if (genderLower === 'ذكر' || genderLower === 'male' || genderLower === 'm') {
          gender = 'male';
        } else if (genderLower === 'أنثى' || genderLower === 'female' || genderLower === 'f') {
          gender = 'female';
        } else {
          gender = '';
        }
      }
      
      const isValid = name && name.length >= 2 && gender;
      if (isValid) validCount++;
      else invalidCount++;
      
      students.push({
        name,
        gender,
        valid: isValid,
        hasGender: !!gender,
        line: index + 1
      });
    });
    
    // Update stats
    document.getElementById('bulkTotalCount').textContent = students.length;
    document.getElementById('bulkValidCount').textContent = validCount;
    document.getElementById('bulkInvalidCount').textContent = invalidCount;
    
    // Display preview
    const previewContent = document.getElementById('bulkPreviewContent');
    previewContent.innerHTML = students.map(student => {
      let statusText = 'صالح';
      let statusClass = 'valid';
      
      if (!student.name || student.name.length < 2) {
        statusText = 'اسم غير صالح';
        statusClass = 'invalid';
      } else if (!student.hasGender) {
        statusText = 'نوع مطلوب';
        statusClass = 'invalid';
      }
      
      return `
        <div class="bulk-student-item">
          <div class="bulk-student-info">
            <span class="bulk-student-name">${escapeHTML(student.name)}</span>
            ${student.gender ? `<span class="bulk-student-gender ${student.gender}">${student.gender === 'male' ? 'ذكر' : 'أنثى'}</span>` : '<span class="bulk-student-gender missing">لا يوجد نوع</span>'}
          </div>
          <span class="bulk-student-status ${statusClass}">
            ${statusText}
          </span>
        </div>
      `;
    }).join('');
    
    document.getElementById('bulkPreview').style.display = 'block';
  };

  window.processBulkAdd = async function(){
    const text = document.getElementById('bulkStudentsList').value.trim();
    const defaultGender = document.getElementById('bulkDefaultGender').value;
    const duplicateHandling = document.getElementById('bulkDuplicateHandling').value;
    
    if (!text) {
      showToast('يرجى إدخال قائمة الطلاب', 'warning');
      return;
    }
    
    const lines = text.split('\n').filter(line => line.trim());
    const studentsToAdd = [];
    const studentsWithoutGender = [];
    
    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;
      
      const parts = trimmedLine.split(',').map(p => p.trim());
      const name = parts[0];
      let gender = parts[1] || defaultGender;
      
      // Normalize gender values
      if (gender) {
        const genderLower = gender.toLowerCase();
        if (genderLower === 'ذكر' || genderLower === 'male' || genderLower === 'm') {
          gender = 'male';
        } else if (genderLower === 'أنثى' || genderLower === 'female' || genderLower === 'f') {
          gender = 'female';
        } else {
          gender = '';
        }
      }
      
      if (name && name.length >= 2) {
        // التحقق من وجود النوع
        if (!gender) {
          studentsWithoutGender.push(name);
          return;
        }
        
        studentsToAdd.push({
          id: uid(),
          name,
          gender,
          groupId: currentGroupId,
          createdAt: new Date().toISOString()
        });
      }
    });
    
    // التحقق من وجود طلاب بدون نوع
    if (studentsWithoutGender.length > 0) {
      const studentsList = studentsWithoutGender.slice(0, 5).join('، ');
      const moreText = studentsWithoutGender.length > 5 ? ` و ${studentsWithoutGender.length - 5} آخرين` : '';
      showToast(`يجب تحديد النوع (ذكر/أنثى) للطلاب التالية: ${studentsList}${moreText}`, 'error');
      return;
    }
    
    if (studentsToAdd.length === 0) {
      showToast('لا توجد أسماء صالحة للإضافة', 'warning');
      return;
    }
    
    showLoading();
    try {
      let addedCount = 0;
      let skippedCount = 0;
      let renamedCount = 0;
      let replacedCount = 0;
      const skippedNames = [];
      const renamedNames = [];
      const replacedNames = [];
      
      for (const student of studentsToAdd) {
        // Check for duplicates
        const existingStudent = students.find(s => 
          s.groupId === currentGroupId && 
          normalize(s.name) === normalize(student.name)
        );
        
        if (existingStudent) {
          if (duplicateHandling === 'skip') {
            skippedCount++;
            skippedNames.push(student.name);
            continue;
          } else if (duplicateHandling === 'rename') {
            let counter = 1;
            let newName = student.name;
            const originalName = student.name;
            while (students.find(s => s.groupId === currentGroupId && normalize(s.name) === normalize(newName))) {
              newName = `${student.name} (${counter})`;
              counter++;
            }
            student.name = newName;
            renamedCount++;
            renamedNames.push(`${originalName} → ${newName}`);
          } else if (duplicateHandling === 'replace') {
            // Remove existing student
            students = students.filter(s => s.id !== existingStudent.id);
            if (hasAPI && window.api.deleteStudent) {
              await apiDeleteStudent(existingStudent.id);
            }
            replacedCount++;
            replacedNames.push(student.name);
          }
        }
        
        // Ensure code and attendance for bulk add
        if (!student.code){ const g = generateStudentCode(currentGroupId); student.code = g.code; student.codeSeq = g.seq; }
        if (!student.createdAt) student.createdAt = new Date().toISOString();
        if (!student.attendanceDate) student.attendanceDate = student.createdAt;
        
        // Add student
        students.push(student);
        addedCount++;
        console.log('Added student:', student.name, 'to group:', currentGroupId);
      }
      
      console.log('Total students after import:', students.length);
      console.log('Students in current group:', students.filter(s => s.groupId === currentGroupId).length);
      
      // Save all students at once
      if (hasAPI) {
        const saved = await apiSaveStudents(students);
        if (!saved) {
          showToast('فشل في حفظ الطلاب المستوردين', 'error');
          return;
        }
        console.log('Students saved successfully to file');
      } else {
        saveLocal(LS_STUDENTS, students);
        console.log('Students saved to localStorage');
      }
      
      // Update students count for the group
      const group = groups.find(g => g.id === currentGroupId);
      if (group) {
        group.studentsCount = students.filter(s => s.groupId === currentGroupId).length;
        if (hasAPI) {
          await apiSaveGroups(groups);
        } else {
          saveLocal(LS_GROUPS, groups);
        }
      }
      
      // Update modal instantly without full re-render
      const container = document.getElementById('studentsListContainer');
      if (container) {
        const list = students.filter(s => s.groupId === currentGroupId);
        container.innerHTML = renderStudentsList(list, { groupId: currentGroupId, groupName: currentGroupSafeName });
        filterAndSortStudents();
      }
      updateModalSummaryCounts(currentGroupId);
      closeBulkAddModal();
      
      // إنشاء رسالة مفصلة
      let message = `تم إضافة ${addedCount} طالب بنجاح`;
      let details = [];
      
      if (skippedCount > 0) {
        details.push(`تم تجاهل ${skippedCount} طالب مكرر`);
      }
      if (renamedCount > 0) {
        details.push(`تم إعادة تسمية ${renamedCount} طالب`);
      }
      if (replacedCount > 0) {
        details.push(`تم استبدال ${replacedCount} طالب`);
      }
      
      if (details.length > 0) {
        message += ` (${details.join(', ')})`;
      }
      
      showToast(message, 'success');
      
      // إظهار تفاصيل إضافية في console للمطورين
      if (skippedNames.length > 0) {
        console.log('أسماء تم تجاهلها:', skippedNames);
      }
      if (renamedNames.length > 0) {
        console.log('أسماء تم إعادة تسميتها:', renamedNames);
      }
      if (replacedNames.length > 0) {
        console.log('أسماء تم استبدالها:', replacedNames);
      }
    } catch (e) {
      console.error(e);
      showToast('فشل في إضافة الطلاب', 'error');
    } finally {
      hideLoading();
    }
  };

  // ===== Export =====
  window.updateGroupStudentsCodes = async function(groupId){
    const group = groups.find(g => g.id === groupId);
    if (!group) { showToast('لم يتم العثور على المجموعة','error'); return; }
    const list = students.filter(s => s.groupId === groupId);
    if (!list.length) { showToast('لا يوجد طلاب لتحديث أكوادهم','info'); return; }

    showLoading();
    try {
      // Sort by current sequence to keep order
      list.sort((a,b)=> (Number(a.codeSeq||0)) - (Number(b.codeSeq||0)));
      let updated = 0;
      const prefix = getGroupCodePrefix(groupId);
      
      // Reassign sequential codes starting from 001
      for (let i = 0; i < list.length; i++){
        const s = list[i];
        const seq = i + 1; // Start from 1, not 0
        const code = `${prefix}-${String(seq).padStart(3,'0')}`;
        s.code = code; 
        s.codeSeq = seq;
        updated++;
      }
      if (hasAPI) {
        const saved = await apiSaveStudents(students);
        if (!saved) { showToast('فشل في حفظ الأكواد','error'); return; }
      } else {
        saveLocal(LS_STUDENTS, students);
      }
      const container = document.getElementById('studentsListContainer');
      if (container) {
        const list2 = students.filter(s => s.groupId === groupId);
        container.innerHTML = renderStudentsList(list2, { groupId, groupName: group?.name || '' });
      }
      
      // Refresh the filter and sort
      filterAndSortStudents();
      // Update counts in modal and groups page in real-time
      updateModalSummaryCounts(groupId);
      const cardCount2 = document.getElementById(`groupCount-${groupId}`);
      if (cardCount2) cardCount2.textContent = String(students.filter(s => s.groupId === groupId).length);
      showToast(`تم تحديث أكواد ${updated} طالب`, 'success');
    } catch(e){
      console.error(e); showToast('حدث خطأ أثناء تحديث الأكواد','error');
    } finally { hideLoading(); }
  };

  window.exportStudentsToExcel = async function(groupId, groupName){
    const list = students.filter(s => s.groupId === groupId);
    
    if (!list.length) {
      showToast('لا يوجد طلاب للتصدير في هذه المجموعة', 'info');
      return;
    }
    
    showLoading();
    
    try {
      // Try Electron API first
      if (hasAPI && window.api.exportStudents) {
        try { 
          await window.api.exportStudents({ groupId, groupName, students: list }); 
          showToast('تم تصدير الطلاب بنجاح', 'success'); 
          return; 
        }
        catch(e) { 
          console.error('Electron export failed:', e); 
        }
      }
      
      // Web Excel export using XLSX
      if (typeof XLSX !== 'undefined') {
        // Headers to match UI order: Code → Name → Photo → Gender → Date
        const header = ['كود الطالب', 'الاسم', 'الصورة', 'النوع', 'التاريخ (ميلادي)'];
        // Rows in the same order; date uses Gregorian (ar-EG)
        const rows = list.map(student => [
          student.code || '',
          student.name || '',
          student.photo ? 'نعم' : 'لا',
          student.gender === 'male' ? 'ذكر' : student.gender === 'female' ? 'أنثى' : '',
          student.attendanceDate ? new Date(student.attendanceDate).toLocaleDateString('ar-EG') : ''
        ]);
        
        // Create workbook and worksheet using AOA to preserve column order
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
        
        // Set column widths aligned to new headers
        worksheet['!cols'] = [
          { width: 16 },  // كود الطالب
          { width: 25 },  // الاسم
          { width: 8 },   // الصورة (نعم/لا)
          { width: 12 },  // النوع
          { width: 14 }   // التاريخ (ميلادي)
        ];
        
        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'الطلاب');
        
        // Generate filename
        const fileName = `طلاب-${groupName || 'مجموعة'}-${new Date().toLocaleDateString('ar-EG').replace(/\//g, '-')}.xlsx`;
        
        // Download file
        XLSX.writeFile(workbook, fileName);
        
        showToast(`تم تصدير ${list.length} طالب إلى Excel بنجاح`, 'success');
      } else {
        // Fallback to CSV with the same headers and order
        const header = ['كود الطالب', 'الاسم', 'الصورة', 'النوع', 'التاريخ (ميلادي)'];
        const rows = list.map(student => [
          student.code || '',
          student.name || '',
          student.photo ? 'نعم' : 'لا',
          student.gender === 'male' ? 'ذكر' : student.gender === 'female' ? 'أنثى' : '',
          student.attendanceDate ? new Date(student.attendanceDate).toLocaleDateString('ar-EG') : ''
        ]);
        const csvData = [header, ...rows];
        
        const csvContent = csvData.map(row => 
          row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `طلاب-${groupName || 'مجموعة'}-${new Date().toLocaleDateString('ar-EG').replace(/\//g, '-')}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        
        showToast(`تم تصدير ${list.length} طالب إلى CSV بنجاح`, 'success');
      }
    } catch (error) {
      console.error('Export error:', error);
      showToast('حدث خطأ أثناء تصدير الطلاب', 'error');
    } finally {
      hideLoading();
    }
  };

  // ===== Delete/Close helpers for modals already defined above =====

  // ===== Data loading =====
  async function reloadData(){
    if (hasAPI){
      const [g, s] = await Promise.all([
        apiGetGroups().catch(()=>[]),
        apiGetStudents().catch(()=>[])
      ]);
      groups = Array.isArray(g)? g: []; students = Array.isArray(s)? s: [];
    } else {
      groups = loadLocal(LS_GROUPS); students = loadLocal(LS_STUDENTS);
    }
    
    // إضافة أيقونات وألوان عشوائية للمجموعات اللي مالهاش أيقونة أو لون
    let needsSave = false;
    groups.forEach(group => {
      if (!group.icon) {
        group.icon = getRandomIcon();
        needsSave = true;
      }
      if (!group.color) {
        group.color = getUniqueColor();
        needsSave = true;
      }
    });
    
    // حفظ التحديثات إذا كان هناك مجموعات تم تحديثها
    if (needsSave) {
      if (hasAPI) {
        await apiSaveGroups(groups);
      } else {
        saveLocal(LS_GROUPS, groups);
      }
    }
    
    render();
  }

  // ===== Reset All Data =====
  window.resetAllData = async function() {
    if (!confirm('هل أنت متأكد من حذف جميع المجموعات والطلاب؟ هذا الإجراء لا يمكن التراجع عنه!')) {
      return;
    }
    
    showLoading();
    try {
      // مسح جميع البيانات
      groups = [];
      students = [];
      
      // حفظ البيانات الفارغة
      if (hasAPI) {
        const groupsSaved = await apiSaveGroups(groups);
        const studentsSaved = await apiSaveStudents(students);
        
        if (!groupsSaved || !studentsSaved) {
          showToast('فشل في مسح البيانات', 'error');
          return;
        }
      } else {
        saveLocal(LS_GROUPS, groups);
        saveLocal(LS_STUDENTS, students);
        
        // التحقق من الحفظ
        const savedGroups = loadLocal(LS_GROUPS);
        const savedStudents = loadLocal(LS_STUDENTS);
        console.log('Data after reset:', { groups: savedGroups.length, students: savedStudents.length });
      }
      
      showToast('تم مسح جميع البيانات بنجاح', 'success');
      render();
    } catch (error) {
      console.error('Error resetting data:', error);
      showToast('حدث خطأ أثناء مسح البيانات', 'error');
    } finally {
      hideLoading();
    }
  };

  // ===== Debug Data Status =====
  window.checkDataStatus = function() {
    console.log('=== Data Status ===');
    console.log('Memory - Groups:', groups.length, 'Students:', students.length);
    
    if (hasAPI) {
      console.log('Using API for data storage');
    } else {
      const savedGroups = loadLocal(LS_GROUPS);
      const savedStudents = loadLocal(LS_STUDENTS);
      console.log('LocalStorage - Groups:', savedGroups.length, 'Students:', savedStudents.length);
      console.log('Groups data:', savedGroups);
      console.log('Students data:', savedStudents);
    }
  };

  // ===== Setup Modal Event Listeners =====
  // Setup listeners for static modals (Edit/Delete Group) - called once in init()
  function setupStaticModalListeners() {
    // Edit Group Modal
    const cancelEditGroupBtn = document.getElementById('cancelEditGroupBtn');
    const closeEditGroupModalHeaderBtn = document.getElementById('closeEditGroupModalHeaderBtn');
    if (cancelEditGroupBtn) {
      cancelEditGroupBtn.addEventListener('click', closeEditGroupModal);
    }
    if (closeEditGroupModalHeaderBtn) {
      closeEditGroupModalHeaderBtn.addEventListener('click', closeEditGroupModal);
    }

    // Import Excel Modal (header close)
    const closeImportExcelModalBtn = document.getElementById('closeImportExcelModalBtn');
    if (closeImportExcelModalBtn) {
      closeImportExcelModalBtn.addEventListener('click', closeImportExcelModal);
    }

    // Delete Group Modal
    const closeDeleteGroupModalBtn = document.getElementById('closeDeleteGroupModalBtn');
    const confirmDeleteGroupBtn = document.getElementById('confirmDeleteGroupBtn');
    const cancelDeleteGroupBtn = document.getElementById('cancelDeleteGroupBtn');
    
    if (closeDeleteGroupModalBtn) {
      closeDeleteGroupModalBtn.addEventListener('click', closeDeleteGroupModal);
    }
    if (confirmDeleteGroupBtn) {
      confirmDeleteGroupBtn.addEventListener('click', confirmDeleteGroup);
    }
    if (cancelDeleteGroupBtn) {
      cancelDeleteGroupBtn.addEventListener('click', closeDeleteGroupModal);
    }
  }

  // Setup listeners for dynamic modals (Student-related, Excel, Bulk Add) - called in openStudentsModal()
  function setupDynamicModalListeners() {
    // Edit Student Modal
    const closeEditStudentModalBtn = document.getElementById('closeEditStudentModalBtn');
    const cancelEditStudentFormBtn = document.getElementById('cancelEditStudentFormBtn');
    if (closeEditStudentModalBtn) {
      closeEditStudentModalBtn.addEventListener('click', closeEditStudentModal);
    }
    if (cancelEditStudentFormBtn) {
      cancelEditStudentFormBtn.addEventListener('click', closeEditStudentModal);
    }

    // Delete Student Modal
    const closeConfirmDeleteStudentModalHeaderBtn = document.getElementById('closeConfirmDeleteStudentModalHeaderBtn');
    const confirmDeleteStudentBtn = document.getElementById('confirmDeleteStudentBtn');
    const cancelDeleteStudentBtn = document.getElementById('cancelDeleteStudentBtn');
    
    if (closeConfirmDeleteStudentModalHeaderBtn) {
      closeConfirmDeleteStudentModalHeaderBtn.addEventListener('click', closeConfirmDeleteStudentModal);
    }
    if (confirmDeleteStudentBtn) {
      confirmDeleteStudentBtn.addEventListener('click', confirmStudentDeletion);
    }
    if (cancelDeleteStudentBtn) {
      cancelDeleteStudentBtn.addEventListener('click', closeConfirmDeleteStudentModal);
    }

    // Delete All Students Modal
    const closeConfirmDeleteAllStudentsModalHeaderBtn = document.getElementById('closeConfirmDeleteAllStudentsModalHeaderBtn');
    const confirmDeleteAllStudentsBtn = document.getElementById('confirmDeleteAllStudentsBtn');
    const cancelDeleteAllStudentsBtn = document.getElementById('cancelDeleteAllStudentsBtn');
    
    if (closeConfirmDeleteAllStudentsModalHeaderBtn) {
      closeConfirmDeleteAllStudentsModalHeaderBtn.addEventListener('click', closeConfirmDeleteAllStudentsModal);
    }
    if (confirmDeleteAllStudentsBtn) {
      confirmDeleteAllStudentsBtn.addEventListener('click', confirmAllStudentsDeletion);
    }
    if (cancelDeleteAllStudentsBtn) {
      cancelDeleteAllStudentsBtn.addEventListener('click', closeConfirmDeleteAllStudentsModal);
    }

    // Excel Import Modal
    const selectFileBtn = document.getElementById('selectFileBtn');
    const clearFileBtn = document.getElementById('clearFileBtn');
    const cancelImportBtn = document.getElementById('cancelImportBtn');
    const previewBtn = document.getElementById('previewBtn');
    const importBtn = document.getElementById('importBtn');
    
    if (selectFileBtn) {
      selectFileBtn.addEventListener('click', window.selectExcelFileElectron);
    }
    if (clearFileBtn) {
      clearFileBtn.addEventListener('click', clearSelectedFile);
    }
    if (cancelImportBtn) {
      cancelImportBtn.addEventListener('click', closeImportExcelModal);
    }
    if (previewBtn) {
      previewBtn.addEventListener('click', previewExcelData);
    }
    if (importBtn) {
      importBtn.addEventListener('click', processExcelImport);
    }

    // Remove Photo Button
    const removePhotoBtn = document.getElementById('removePhotoBtn');
    if (removePhotoBtn) {
      removePhotoBtn.addEventListener('click', removeStudentPhoto);
    }

    // Bulk Add Modal
    const closeBulkAddModalBtn = document.getElementById('closeBulkAddModalBtn');
    const cancelBulkAddBtn = document.getElementById('cancelBulkAddBtn');
    const previewBulkAddBtn = document.getElementById('previewBulkAddBtn');
    const processBulkAddBtn = document.getElementById('processBulkAddBtn');
    
    if (closeBulkAddModalBtn) {
      closeBulkAddModalBtn.addEventListener('click', closeBulkAddModal);
    }
    if (cancelBulkAddBtn) {
      cancelBulkAddBtn.addEventListener('click', closeBulkAddModal);
    }
    if (previewBulkAddBtn) {
      previewBulkAddBtn.addEventListener('click', previewBulkStudents);
    }
    if (processBulkAddBtn) {
      processBulkAddBtn.addEventListener('click', processBulkAdd);
    }
  }

  // ===== Init =====
  async function init(){ 
    showLoading(); 
    try { 
      await reloadData(); 
      updateViewButtons(); // Initialize view buttons state
      setupStaticModalListeners(); // Setup listeners for static modals (Edit/Delete Group)
      // Note: setupDynamicModalListeners() is called in openStudentsModal() after dynamic HTML creation

      // Delegated listeners for dynamically-rendered action buttons inside studentsListContainer
      document.addEventListener('click', function(e){
        const updateBtn = e.target.closest('#updateCodesBtn');
        if (updateBtn) {
          const gid = updateBtn.getAttribute('data-group-id') || currentGroupId;
          if (gid) updateGroupStudentsCodes(gid);
          return;
        }
        const exportBtn = e.target.closest('#exportExcelBtn');
        if (exportBtn) {
          const gid = exportBtn.getAttribute('data-group-id') || currentGroupId;
          const gname = exportBtn.getAttribute('data-group-name') || currentGroupSafeName || '';
          if (gid) exportStudentsToExcel(gid, gname);
          return;
        }
        const delAllBtn = e.target.closest('#deleteAllStudentsBtn');
        if (delAllBtn) {
          const gid = delAllBtn.getAttribute('data-group-id') || currentGroupId;
          if (gid) confirmDeleteAllStudents(gid);
          return;
        }
      });
    } finally { 
      hideLoading(); 
    } 
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();