(function() {
  'use strict';

  console.log('Educational Hub V3 Initializing...');

  // --- State ---
  let educationalData = [];
  let educationalMedia = [];
  let currentZoom = 1;
  let isDrawing = false;
  let currentTool = 'pen';
  let currentColor = '#3b82f6';
  let ctx = null;
  let startX = 0, startY = 0;
  let snapshot = null;

  // --- DOM Elements Helper ---
  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => document.querySelectorAll(selector);

  // --- Initialization ---
  async function init() {
    try {
      await loadData();
      renderGrades();
      setupEvents();
      initCanvas();
      startTimer();
      console.log('Educational Hub V3 Initialized Successfully');
    } catch (err) {
      console.error('Initialization Failed:', err);
    }
  }

  function startTimer() {
    const timerEl = $('currentTime');
    if (!timerEl) return;
    setInterval(() => {
      const now = new Date();
      timerEl.textContent = now.toLocaleTimeString('ar-EG');
    }, 1000);
  }

  function updateBreadcrumb(items) {
    const breadcrumbEl = $('hubBreadcrumb');
    if (!breadcrumbEl) return;
    breadcrumbEl.innerHTML = '<span class="crumb">المحتوى التعليمي</span>';
    items.forEach(item => {
      const span = document.createElement('span');
      span.className = 'crumb';
      span.textContent = item;
      breadcrumbEl.appendChild(span);
    });
  }

  async function loadData() {
    try {
      const response = await fetch('/api/educational-content');
      if (response.ok) {
        const data = await response.json();
        educationalData = Array.isArray(data) ? data : (data.data && Array.isArray(data.data) ? data.data : []);
      }
      
      if (!educationalData || educationalData.length === 0) {
        educationalData = [
          { id: 1, name: 'الأول الثانوي', icon: '🧪', units: [
            { id: 101, name: 'الوحدة الأولى: الكيمياء', lessons: [
              { id: 1011, name: 'مقدمة', type: 'image', url: 'https://images.unsplash.com/photo-1532012197267-da84d127e765?q=80&w=1000' }
            ]}
          ]},
          { id: 2, name: 'الثاني الثانوي', icon: '🧬', units: [] }
        ];
      }
    } catch (e) {
      console.error('Data Loading Error:', e);
    }
  }

  function renderGrades() {
    const grid = $('gradesGrid');
    if (!grid) return;
    grid.innerHTML = '';
    educationalData.forEach(grade => {
      const pill = document.createElement('div');
      pill.className = 'grade-pill';
      pill.textContent = grade.name;
      pill.onclick = () => selectGrade(grade, pill);
      grid.appendChild(pill);
    });
  }

  function selectGrade(grade, pill) {
    $$('.grade-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    updateBreadcrumb([grade.name]);
    renderUnits(grade.units || []);
  }

  function renderUnits(units) {
    const grid = $('unitsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    if (units.length === 0) {
      grid.innerHTML = '<div class="unit-placeholder">لا توجد وحدات</div>';
      return;
    }
    units.forEach(unit => {
      const item = document.createElement('div');
      item.className = 'unit-item-v3';
      item.textContent = unit.name;
      item.onclick = () => {
        updateBreadcrumb([educationalData.find(g => g.units?.includes(unit))?.name || '', unit.name]);
        if (unit.lessons?.length > 0) openLesson(unit.lessons[0]);
      };
      grid.appendChild(item);
    });
  }

  function openLesson(lesson) {
    const stage = $('stageContent');
    if (!stage) return;
    stage.innerHTML = `<div class="presentation-viewer" style="transform: scale(${currentZoom});">
      <img src="${lesson.url}" style="max-width:85%; max-height:85%; border-radius:12px;">
    </div>`;
    if (ctx) ctx.clearRect(0, 0, $('annotationCanvas').width, $('annotationCanvas').height);
  }

  function setupEvents() {
    // Toolbar
    $$('.smart-tool').forEach(tool => {
      tool.onclick = () => {
        if (tool.id === 'clearCanvasBtn') {
          if (ctx) ctx.clearRect(0, 0, $('annotationCanvas').width, $('annotationCanvas').height);
          return;
        }
        $$('.smart-tool').forEach(t => t.classList.remove('active'));
        tool.classList.add('active');
        currentTool = tool.dataset.tool;
        if (['pen', 'highlighter', 'erase', 'rect', 'circle', 'line', 'text'].includes(currentTool)) {
          $('hubStage').classList.add('active-drawing');
        } else {
          $('hubStage').classList.remove('active-drawing');
        }
      };
    });

    // Zoom
    const zi = $('zoomInBtn'), zo = $('zoomOutBtn'), zv = $('zoomVal');
    if (zi) zi.onclick = () => { currentZoom = Math.min(currentZoom + 0.1, 3); updateZoom(); };
    if (zo) zo.onclick = () => { currentZoom = Math.max(currentZoom - 0.1, 0.5); updateZoom(); };

    function updateZoom() {
      if (zv) zv.textContent = Math.round(currentZoom * 100) + '%';
      const v = document.querySelector('.presentation-viewer');
      if (v) v.style.transform = `scale(${currentZoom})`;
    }

    // Management Modal
    const modal = $('manageContentModal');
    const openBtn = $('openManageModalBtn');
    const closeBtn = $('closeManageModalBtn');

    if (openBtn) {
      openBtn.onclick = () => {
        modal.style.display = 'flex';
        refreshManagementUI();
      };
    }
    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    // Modal Tabs
    $$('.side-tab-btn').forEach(btn => {
      btn.onclick = () => {
        $$('.side-tab-btn').forEach(b => b.classList.remove('active'));
        $$('.tab-content').forEach(c => c.style.display = 'none');
        btn.classList.add('active');
        const target = $(btn.dataset.tab + '-tab');
        if (target) target.style.display = 'block';
      };
    });

    // Save Grade
    const saveGradeBtn = $('saveGradeBtn');
    if (saveGradeBtn) {
      saveGradeBtn.onclick = () => {
        const nameInput = $('newGradeName');
        if (!nameInput.value) return alert('أدخل اسم الصف');
        educationalData.push({ id: Date.now(), name: nameInput.value, units: [] });
        nameInput.value = '';
        refreshManagementUI();
        renderGrades();
        alert('تم إضافة الصف بنجاح');
      };
    }

    // Save Unit
    const saveUnitBtn = $('saveUnitBtn');
    if (saveUnitBtn) {
      saveUnitBtn.onclick = () => {
        const gradeId = parseInt($('gradeSelectForUnit').value);
        const nameInput = $('newUnitName');
        if (!gradeId) return alert('اختر الصف أولاً');
        if (!nameInput.value) return alert('أدخل اسم الوحدة');
        
        const grade = educationalData.find(g => g.id === gradeId);
        if (grade) {
          if (!grade.units) grade.units = [];
          grade.units.push({ id: Date.now(), name: nameInput.value, lessons: [] });
          nameInput.value = '';
          refreshManagementUI();
          alert('تم إضافة الوحدة بنجاح');
        }
      };
    }

    // Save Lesson
    const saveLessonBtn = $('saveLessonBtn');
    if (saveLessonBtn) {
      saveLessonBtn.onclick = () => {
        const unitId = parseInt($('unitSelectForLesson').value);
        const type = $('newLessonType').value;
        const nameInput = $('newLessonName');
        const urlInput = $('newLessonUrl');
        
        if (!unitId) return alert('اختر الوحدة أولاً');
        if (!nameInput.value || !urlInput.value) return alert('أدخل عنوان الدرس والرابط');
        
        let foundUnit = null;
        educationalData.forEach(g => {
          if (g.units) {
            const u = g.units.find(u => u.id === unitId);
            if (u) foundUnit = u;
          }
        });
        
        if (foundUnit) {
          if (!foundUnit.lessons) foundUnit.lessons = [];
          foundUnit.lessons.push({ id: Date.now(), name: nameInput.value, type, url: urlInput.value });
          nameInput.value = '';
          urlInput.value = '';
          refreshManagementUI();
          alert('تم إضافة الدرس بنجاح');
        }
      };
    }

    // Save Media
    const saveMediaBtn = $('saveMediaBtn');
    if (saveMediaBtn) {
      saveMediaBtn.onclick = () => {
        const title = $('newMediaTitle').value;
        const url = $('newMediaUrl').value;
        if (!title || !url) return alert('أدخل العنوان والرابط');
        educationalMedia.push({ id: Date.now(), title, url });
        $('newMediaTitle').value = '';
        $('newMediaUrl').value = '';
        refreshManagementUI();
        renderMediaBank();
        alert('تم حفظ الوسيط بنجاح');
      };
    }

    // Drag
    const tb = $('mainToolbar');
    if (tb) makeDraggable(tb);

    setupDrawing();
  }

  function refreshManagementUI() {
    const gSelect = $('gradeSelectForUnit');
    const uSelect = $('unitSelectForLesson');
    if (gSelect) gSelect.innerHTML = '<option value="">-- اختر الصف أولاً --</option>' + educationalData.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    if (uSelect) uSelect.innerHTML = '<option value="">-- اختر الوحدة --</option>' + educationalData.flatMap(g => (g.units || []).map(u => `<option value="${u.id}">${g.name} - ${u.name}</option>`)).join('');
    
    const gList = $('existingGradesList');
    if (gList) gList.innerHTML = educationalData.map(g => `
      <div class="clean-list-item">
        <div class="item-info">
          <span class="item-title">${g.name}</span>
          <span class="item-meta">${g.units ? g.units.length : 0} وحدات</span>
        </div>
        <button class="btn-icon-del" onclick="window.deleteGrade(${g.id})">🗑️</button>
      </div>
    `).join('');

    const mList = $('existingMediaList');
    if (mList) mList.innerHTML = educationalMedia.map(m => `
      <div class="clean-list-item">
        <div class="item-info">
          <span class="item-title">${m.title}</span>
        </div>
        <button class="btn-icon-del" onclick="window.deleteMedia(${m.id})">🗑️</button>
      </div>
    `).join('');
    
    // Update Lessons List
    const lList = $('existingLessonsList');
    const allLessons = educationalData.flatMap(g => (g.units || []).flatMap(u => (u.lessons || []).map(l => ({...l, unitId: u.id, unitName: u.name}))));
    if (lList) lList.innerHTML = allLessons.map(l => `
      <div class="clean-list-item">
        <div class="item-info">
          <span class="item-title">${l.name}</span>
          <span class="item-meta">${l.unitName}</span>
        </div>
        <button class="btn-icon-del" onclick="window.deleteLesson(${l.unitId}, ${l.id})">🗑️</button>
      </div>
    `).join('');
  }

  window.deleteGrade = (id) => {
    if (confirm('تأكيد حذف هذا الصف وجميع وحداته ودروسه؟')) {
      educationalData = educationalData.filter(g => g.id !== id);
      renderGrades();
      refreshManagementUI();
    }
  };

  window.deleteLesson = (unitId, lessonId) => {
    if (confirm('تأكيد حذف هذا الدرس؟')) {
      educationalData.forEach(g => {
        if (g.units) {
          const unit = g.units.find(u => u.id === unitId);
          if (unit && unit.lessons) {
            unit.lessons = unit.lessons.filter(l => l.id !== lessonId);
          }
        }
      });
      // Re-render units/lessons if needed, but simple UI refresh is fine
      refreshManagementUI();
    }
  };

  window.deleteMedia = (id) => {
    if (confirm('حذف هذا الوسيط؟')) {
      educationalMedia = educationalMedia.filter(m => m.id !== id);
      renderMediaBank();
      refreshManagementUI();
    }
  };

  function renderMediaBank() {
    const grid = $('mediaGrid');
    if (!grid) return;
    grid.innerHTML = '';
    educationalMedia.forEach(media => {
      const el = document.createElement('div');
      el.className = 'media-item';
      el.title = media.title;
      el.innerHTML = `<img src="${media.url}" alt="${media.title}">`;
      el.onclick = () => openLesson({ url: media.url, type: 'image' });
      grid.appendChild(el);
    });
  }

  function initCanvas() {
    const c = $('annotationCanvas');
    if (!c) return;
    ctx = c.getContext('2d');
    const resize = () => {
      const r = c.parentElement.getBoundingClientRect();
      c.width = r.width; c.height = r.height;
    };
    resize();
    window.addEventListener('resize', resize);
  }

  function setupDrawing() {
    const c = $('annotationCanvas');
    if (!c) return;
    
    c.onmousedown = (e) => {
      if (currentTool === 'text') {
        const text = prompt('أدخل النص:');
        if (text) {
          ctx.font = '30px Cairo, sans-serif';
          ctx.fillStyle = currentColor;
          ctx.fillText(text, e.offsetX, e.offsetY);
        }
        return;
      }
      
      isDrawing = true;
      startX = e.offsetX;
      startY = e.offsetY;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.strokeStyle = currentTool === 'highlighter' ? currentColor + '55' : currentColor;
      ctx.lineWidth = currentTool === 'highlighter' ? 30 : 4;
      ctx.lineCap = 'round';
      
      // Save canvas state for shapes
      if (['rect', 'circle', 'line'].includes(currentTool)) {
        snapshot = ctx.getImageData(0, 0, c.width, c.height);
      }
    };
    
    c.onmousemove = (e) => {
      if (!isDrawing) return;
      
      if (currentTool === 'erase') {
        ctx.clearRect(e.offsetX - 25, e.offsetY - 25, 50, 50);
        return;
      }
      
      if (['rect', 'circle', 'line'].includes(currentTool)) {
        // Restore snapshot to avoid trailing shape lines
        ctx.putImageData(snapshot, 0, 0);
        ctx.beginPath();
        if (currentTool === 'rect') {
          ctx.rect(startX, startY, e.offsetX - startX, e.offsetY - startY);
        } else if (currentTool === 'circle') {
          const radius = Math.sqrt(Math.pow(e.offsetX - startX, 2) + Math.pow(e.offsetY - startY, 2));
          ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
        } else if (currentTool === 'line') {
          ctx.moveTo(startX, startY);
          ctx.lineTo(e.offsetX, e.offsetY);
        }
        ctx.stroke();
      } else {
        // Freehand (pen, highlighter)
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();
      }
    };
    
    c.onmouseup = () => { 
      isDrawing = false; 
      ctx.closePath(); 
    };
  }

  function makeDraggable(el) {
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    el.onmousedown = (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      e.preventDefault();
      p3 = e.clientX; p4 = e.clientY;
      document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
      document.onmousemove = (e) => {
        e.preventDefault();
        p1 = p3 - e.clientX; p2 = p4 - e.clientY;
        p3 = e.clientX; p4 = e.clientY;
        el.style.top = (el.offsetTop - p2) + "px";
        el.style.left = (el.offsetLeft - p1) + "px";
        el.style.bottom = 'auto';
      };
    };
  }

  init();
})();
