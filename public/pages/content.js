/* ══════════════════════════════════════
   Content Page — Smart Player
   ══════════════════════════════════════ */
(function () {
  'use strict';

  // Trial gate
  if (window.trialBlock && window.trialBlock('content')) {
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:80vh;gap:16px;font-family:Cairo,sans-serif;text-align:center;color:#64748b">
        <div style="font-size:3rem">📚</div>
        <h2 style="color:#1e293b;margin:0">المحتوى التعليمي غير متاح في النسخة التجريبية</h2>
        <p style="margin:0;font-size:.9rem">فعّل البرنامج للوصول إلى رفع الدروس وإدارة المحتوى</p>
        <div style="display:flex;gap:10px;">
          <a href="/pages/activation.html" style="background:#0f766e;color:#fff;padding:10px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.95rem">فعّل الآن ←</a>
          <a href="/" onclick="window.location.href='/'; return false;" style="background:transparent;color:#64748b;border:1.5px solid #cbd5e1;padding:10px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.95rem">أكمل في النسخة التجريبية</a>
        </div>
      </div>`;
    return;
  }

  /* ── Helpers ── */
  const $ = id => document.getElementById(id);
  const apiFetch = (...a) => (window.authFetch || fetch)(...a);
  let _key = '';
  window.api?.getApiKey?.().then(k => { _key = k || ''; }).catch(() => {});

  async function api(method, path, body) {
    const r = await apiFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.message || `خطأ ${r.status}`);
    }
    if (r.status === 204) return null;
    return r.json();
  }

  let _toastTimer;
  function toast(msg, type = 'info') {
    const el = $('cntToast');
    if (!el) return;
    el.textContent = msg;
    el.className = `cnt-toast cnt-toast-${type}`;
    el.style.display = 'block';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2800);
  }

  const openM  = id => { const e = $(id); if (e) e.style.display = 'flex'; };
  const closeM = id => { const e = $(id); if (e) e.style.display = 'none'; };

  function confirmDialog(msg) {
    return new Promise(resolve => {
      const overlay = $('mConfirm');
      const msgEl   = $('mConfirmMsg');
      const okBtn   = $('mConfirmOk');
      const cancelBtn = $('mConfirmCancel');
      if (msgEl) msgEl.textContent = msg;
      openM('mConfirm');
      const done = result => {
        closeM('mConfirm');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onBg);
        resolve(result);
      };
      const onOk     = () => done(true);
      const onCancel = () => done(false);
      const onBg     = e => { if (e.target === overlay) done(false); };
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      overlay.addEventListener('click', onBg);
    });
  }
  const esc    = s  => String(s).replace(/"/g, '&quot;');

  /* ── State ── */
  let grades = [];
  let activeLesson   = null;   // { lesson, unit, grade }
  let activeGradeId  = null;   // currently selected grade tab
  let activeIndex  = 0;
  let _prevIndex   = -1;     // slide currently on screen (to save its state when leaving)

  /* annotation — non-PDF (cnt-canvas overlay, content coords) */
  let canvas, ctx;
  let annoMode = false, drawing = false;
  let tool = 'pen', color = '#ef4444', strokeWidth = 3, strokeDash = 'solid';
  let activeShape = 'rect'; // last selected shape
  let strokes = [];
  let curStroke = null;

  /* annotation — PDF canvas overlay (per-page, page coords) */
  let pdfStrokes = {}; // { [pageNum]: [{tool,color,alpha,lw,pts}] }

  /* zoom / pan */
  let zoom = 1, panX = 0, panY = 0;

  /* PDF.js v5 — served locally for reliable Arabic font support */
  const PDF_MODULE = 'http://localhost:5000/pdfjs-build/pdf.min.mjs';
  const PDF_WORKER = 'http://localhost:5000/pdfjs-build/pdf.worker.min.mjs';
  const PDF_CMAP   = 'http://localhost:5000/pdfjs-cmaps/';
  const PDF_FONTS  = 'http://localhost:5000/pdfjs-fonts/';

  async function _loadPdfLib() {
    if (window._pdfjsLib) return window._pdfjsLib;
    const mod = await import(PDF_MODULE);
    mod.GlobalWorkerOptions.workerSrc = PDF_WORKER;
    window._pdfjsLib = mod;
    return mod;
  }
  let _pdfDoc = null;
  let _pdfCurrentPage = 1, _pdfTotalPages = 0, _pdfUrl = '';
  let _pdfRenderTask = null;          /* in-flight PDF.js render (cancellable) */
  const _thumbCache = {};
  const _pdfDocCache = {};            /* parsed PDFDocumentProxy keyed by url — avoids re-parsing on return */

  /* shared getDocument options — cMaps + standard fonts make Arabic render correctly */
  function _pdfDocOpts(url) {
    return {
      url,
      cMapUrl: PDF_CMAP, cMapPacked: true,
      standardFontDataUrl: PDF_FONTS,
      /* render glyph outlines directly instead of via browser @font-face —
         fixes broken Arabic shaping (disconnected letters) on content pages */
      disableFontFace: true,
      useSystemFonts: false,
    };
  }

  /* per-slide state cache — keyed by activeIndex, cleared on lesson change */
  const _slideState = {};

  function _saveSlideState(idx = activeIndex) {
    if (idx < 0) return;
    if ($('pdfjsWrap')) {                          /* leaving a PDF slide */
      _slideState[idx] = {
        kind: 'pdf',
        page: _pdfCurrentPage,
        pdfStrokes: JSON.parse(JSON.stringify(pdfStrokes)),
      };
    } else if (strokes.length) {                   /* leaving an image/video/whiteboard with drawings */
      _slideState[idx] = {
        kind: 'canvas',
        strokes: JSON.parse(JSON.stringify(strokes)),
      };
    } else {
      delete _slideState[idx];                     /* nothing drawn — drop any stale state */
    }
  }

  /* restore PDF page + strokes (called from renderPdfJs). Non-PDF slides
     restore their canvas strokes in renderCurrentSlide. */
  function _restoreSlideState() {
    const s = _slideState[activeIndex];
    if (!s || s.kind !== 'pdf') return false;
    pdfStrokes = s.pdfStrokes;
    _pdfGoToPage(s.page);
    return true;
  }

  async function getPdfThumb(url) {
    if (_thumbCache[url]) return _thumbCache[url];
    try {
      const pdfjsLib = await _loadPdfLib();
      const doc   = await pdfjsLib.getDocument(_pdfDocOpts(url)).promise;
      const page  = await doc.getPage(1);
      const vp0   = page.getViewport({ scale: 1 });
      const scale = Math.min(240 / vp0.width, 140 / vp0.height);
      const vp    = page.getViewport({ scale });
      const cvs   = document.createElement('canvas');
      cvs.width   = vp.width;
      cvs.height  = vp.height;
      const ctx   = cvs.getContext('2d');
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const dataUrl = cvs.toDataURL('image/jpeg', 0.82);
      _thumbCache[url] = dataUrl;
      return dataUrl;
    } catch { return null; }
  }

  /* ═══════════════════════════════════
     BOOT
     ═══════════════════════════════════ */
  function boot() {
    document.body.classList.add('cnt-page');
    window.addEventListener('hashchange', () => {
      document.body.classList.remove('cnt-page');
      hidePresent();
    }, { once: true });

    wireModals();
    wireSearch();
    wireGrade();
    wireUnit();
    wireLesson();
    wireLink();
    wireBoard();
    wirePresent();
    wireAnno();
    wireZoom();
    wireRename();
    loadGrades();
  }

  /* ═══════════════════════════════════
     DATA
     ═══════════════════════════════════ */
  async function loadGrades() {
    try {
      const data = await api('GET', '/api/educational-content');
      grades = Array.isArray(data) ? data : (data.grades || []);
      if (activeGradeId && !grades.find(g => g.id === activeGradeId)) activeGradeId = null;
      renderTree();
      enrichQuizTitles();
      renderDashboard();
    } catch (e) {
      const panel = $('cntUnitsPanel');
      if (panel) panel.innerHTML = `<div class="cnt-msg">تعذّر التحميل: ${e.message}</div>`;
    }
  }

  function renderDashboard() {
    /* stats */
    let units = 0, lessons = 0, files = 0;
    for (const g of grades) {
      for (const u of (g.units || [])) {
        units++;
        for (const l of (u.lessons || [])) {
          lessons++;
          files += (l.content || []).length;
        }
      }
    }
    const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    setText('dStatGrades',  grades.length);
    setText('dStatUnits',   units);
    setText('dStatLessons', lessons);
    setText('dStatFiles',   files);

    /* recent lessons (stored in localStorage, max 5) — filter out deleted ones */
    const allLessonIds = new Set(grades.flatMap(g => (g.units || []).flatMap(u => (u.lessons || []).map(l => l.id))));
    const recent = _getRecent().filter(r => allLessonIds.has(r.lid));
    localStorage.setItem('cnt_recent', JSON.stringify(recent)); // prune stale entries
    const list = $('cntDashRecent');
    if (!list) return;
    if (!recent.length) {
      list.innerHTML = `<span class="cnt-dash-empty">لم تفتح أي درس بعد</span>`;
      return;
    }
    list.innerHTML = recent.map(r => `
      <button class="cnt-dash-recent-item" data-lid="${r.lid}" data-uid="${r.uid}" data-gid="${r.gid}">
        <span class="cnt-dash-recent-icon">📄</span>
        <span class="cnt-dash-recent-info">
          <span class="cnt-dash-recent-name">${r.lessonName}</span>
          <span class="cnt-dash-recent-path">${r.gradeName} › ${r.unitName}</span>
        </span>
      </button>`).join('');
    list.querySelectorAll('.cnt-dash-recent-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = grades.find(g => g.id === btn.dataset.gid);
        const u = g?.units?.find(u => u.id === btn.dataset.uid);
        const l = u?.lessons?.find(l => l.id === btn.dataset.lid);
        if (l && u && g) selectLesson(l, u, g);
      });
    });
  }

  function _getRecent() {
    try { return JSON.parse(localStorage.getItem('cnt_recent') || '[]'); } catch { return []; }
  }
  function _addRecent(lesson, unit, grade) {
    const entry = { lid: lesson.id, uid: unit.id, gid: grade.id,
      lessonName: lesson.name, unitName: unit.name, gradeName: grade.name };
    let list = _getRecent().filter(r => r.lid !== lesson.id);
    list.unshift(entry);
    if (list.length > 5) list = list.slice(0, 5);
    localStorage.setItem('cnt_recent', JSON.stringify(list));
  }

  async function enrichQuizTitles() {
    try {
      const quizzes = await api('GET', '/api/quizzes');
      const map = Object.fromEntries(quizzes.map(q => [q.id, q.title || q.name || 'اختبار']));
      let changed = false;
      for (const g of grades) for (const u of g.units || []) for (const l of u.lessons || [])
        for (const c of l.content || [])
          if (c.type === 'quiz' && !c.quizTitle && map[c.quizId]) {
            c.quizTitle = map[c.quizId];
            changed = true;
          }
      if (changed) renderSlides();
    } catch { /* silent */ }
  }

  /* ═══════════════════════════════════
     ITEM META
     ═══════════════════════════════════ */
  function getMeta(item) {
    if (item.type === 'whiteboard') return { kind: 'whiteboard', label: 'لوح رسم', color: '#f59e0b', icon: 'ti-pencil' };
    if (item.type === 'link') {
      const u = item.url || '';
      if (/youtube\.com|youtu\.be|youtube-nocookie\.com/.test(u))
        return { kind: 'youtube', label: 'يوتيوب', color: '#ef4444', icon: 'ti-brand-youtube' };
      if (/vimeo\.com/.test(u))
        return { kind: 'vimeo', label: 'فيميو', color: '#1ab7ea', icon: 'ti-brand-vimeo' };
      const imgExt = /\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(u);
      if (imgExt) return { kind: 'image-url', label: 'صورة', color: '#10b981', icon: 'ti-photo' };
      return { kind: 'web', label: 'رابط ويب', color: '#8b5cf6', icon: 'ti-world' };
    }
    const ext = (item.path || item.name || '').split('.').pop().toLowerCase();
    if (item.type === 'quiz') return { kind: 'quiz', label: 'اختبار', color: '#8b5cf6', icon: 'ti-help-square' };
    if (item.type === 'whiteboard') return { kind: 'whiteboard', label: 'لوح رسم', color: '#f59e0b', icon: 'ti-pencil' };
    if (ext === 'pdf') return { kind: 'pdf', label: 'PDF', color: '#ef4444', icon: 'ti-file-type-pdf' };
    if (['jpg','jpeg','png','gif','webp'].includes(ext)) return { kind: 'image', label: 'صورة', color: '#10b981', icon: 'ti-photo' };
    if (['mp4','webm','ogg','mov'].includes(ext))        return { kind: 'video', label: 'فيديو', color: '#3b82f6', icon: 'ti-video' };
    return { kind: 'file', label: 'ملف', color: '#64748b', icon: 'ti-file' };
  }

  function itemName(item) {
    if (item.type === 'quiz') return item.quizTitle || 'اختبار';
    return _fixMojibake(item.name || item.title || item.url || 'بدون عنوان');
  }

  /* recover Arabic names mangled by the old latin1 upload bug (display-time, safe).
     Only acts when the string has Latin-1 bytes and no real Arabic — otherwise returns as-is. */
  function _fixMojibake(s) {
    if (!s || !/[-ÿ]/.test(s) || /[؀-ۿ]/.test(s)) return s;
    try {
      const bytes = Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
      const fixed = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      return /[؀-ۿ]/.test(fixed) ? fixed : s;   /* keep only if it produced Arabic */
    } catch { return s; }
  }

  function ytId(url) {
    const m = url.match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : '';
  }

  /* ═══════════════════════════════════
     TABS + UNITS PANEL
     ═══════════════════════════════════ */
  const SVG_PENCIL = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>`;
  const SVG_TRASH  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
  const SVG_COPY   = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const SVG_FOLDER = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
  const DRAG_HANDLE = `<span class="cnt-drag-handle" title="اسحب للترتيب">⠿</span>`;

  function _acts(type, id, name) {
    return `<span class="cnt-acts">
      <button class="cnt-act" data-rt="${type}" data-ri="${id}" data-rc="${esc(name)}" title="تعديل">${SVG_PENCIL}</button>
      <button class="cnt-act cnt-act-copy" data-cpt="${type}" data-cpi="${id}" data-cpn="${esc(name)}" title="نسخ">${SVG_COPY}</button>
      <button class="cnt-act cnt-act-del" data-dt="${type}" data-di="${id}" data-dn="${esc(name)}" title="حذف">${SVG_TRASH}</button>
    </span>`;
  }

  function renderTree() {
    renderGradeTabs();
    renderUnitsPanel();
  }

  function renderGradeTabs() {
    const tabsEl = $('cntGradeTabs');
    if (!tabsEl) return;

    if (!grades.length) {
      tabsEl.innerHTML = '<div class="cnt-tab-empty">لا يوجد صفوف — اضغط "+ صف"</div>';
      return;
    }

    if (!activeGradeId || !grades.find(g => g.id === activeGradeId)) {
      activeGradeId = grades[0].id;
    }

    let html = '';
    for (const g of grades) {
      const active = g.id === activeGradeId ? ' active' : '';
      html += `<div class="cnt-tab-wrap${active}" data-gid="${g.id}">
        <button class="cnt-tab${active}" data-gid="${g.id}">
          <span class="cnt-tab-name">${g.name}</span>
          <span class="cnt-tab-acts">
            <span class="cnt-tab-act" data-rt="grade" data-ri="${g.id}" data-rc="${esc(g.name)}" title="تعديل">${SVG_PENCIL}</span>
            <span class="cnt-tab-act cnt-act-del" data-dt="grade" data-di="${g.id}" data-dn="${esc(g.name)}" title="حذف">✕</span>
          </span>
        </button>
      </div>`;
    }
    tabsEl.innerHTML = html;

    tabsEl.querySelectorAll('.cnt-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeGradeId = btn.dataset.gid;
        tabsEl.querySelectorAll('.cnt-tab-wrap').forEach(w => w.classList.toggle('active', w.dataset.gid === activeGradeId));
        tabsEl.querySelectorAll('.cnt-tab').forEach(b => b.classList.toggle('active', b.dataset.gid === activeGradeId));
        renderUnitsPanel();
      });
    });

    tabsEl.querySelectorAll('[data-rt]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        _renameType = 'grade'; _renameId = b.dataset.ri;
        $('mRenameTitle').textContent = 'تعديل اسم الصف';
        $('mRenameInput').value = b.dataset.rc;
        openM('mRename');
        setTimeout(() => $('mRenameInput').select(), 80);
      });
    });

    tabsEl.querySelectorAll('[data-dt]').forEach(b => {
      b.addEventListener('click', async e => {
        e.stopPropagation();
        e.preventDefault();
        const id = b.dataset.di, name = b.dataset.dn;
        const ok = await confirmDialog(`حذف الصف "${name}"؟ سيتم حذف كل وحداته ودروسه.`);
        if (!ok) return;
        try {
          await api('DELETE', `/api/grades/${id}`);
          grades = grades.filter(g => g.id !== id);
          if (activeGradeId === id) activeGradeId = grades[0]?.id || null;
          renderTree();
        } catch (err) { }
      });
    });
  }

  function renderUnitsPanel() {
    const panel = $('cntUnitsPanel');
    if (!panel) return;

    if (!grades.length) {
      panel.innerHTML = '<div class="cnt-msg">أضف صفاً أولاً</div>';
      return;
    }

    const grade = grades.find(g => g.id === activeGradeId);
    if (!grade) { panel.innerHTML = '<div class="cnt-msg">اختر صفاً</div>'; return; }

    const q = ($('cntSearch')?.value || '').trim().toLowerCase();

    let html = '';
    for (const u of grade.units) {
      let lHtml = '';
      for (const l of u.lessons) {
        if (q && !l.name.toLowerCase().includes(q)) continue;
        const active = activeLesson?.lesson.id === l.id;
        const cnt    = l.content?.length || 0;
        lHtml += `<div class="cnt-lesson${active ? ' active' : ''}" draggable="true"
            data-lid="${l.id}" data-uid="${u.id}" data-gid="${grade.id}">
          ${DRAG_HANDLE}
          <span class="cnt-lesson-dot"></span>
          <span class="cnt-row-name">${l.name}</span>
          ${cnt ? `<span class="cnt-badge">${cnt}</span>` : ''}
          ${_acts('lesson', l.id, l.name)}
        </div>`;
      }
      if (q && !lHtml) continue;

      const lessonCount = u.lessons.length;
      const badge = lessonCount
        ? `<span class="cnt-unit-badge">${lessonCount} ${lessonCount === 1 ? 'درس' : 'دروس'}</span>`
        : `<span class="cnt-unit-badge empty">بدون دروس</span>`;
      const open = q || u.lessons.some(l => activeLesson?.lesson.id === l.id) ? ' open' : '';

      html += `<div class="cnt-unit-card${open}" id="uc-${u.id}" draggable="true">
        <div class="cnt-unit-card-head" data-toggle="uc-${u.id}">
          ${DRAG_HANDLE}
          <div class="cnt-unit-card-icon">${SVG_FOLDER}</div>
          <span class="cnt-unit-card-name">${u.name}</span>
          ${badge}
          ${_acts('unit', u.id, u.name)}
          <span class="cnt-arr">›</span>
        </div>
        <div class="cnt-unit-card-lessons">
          ${lHtml || '<div class="cnt-msg-sm">لا توجد دروس بعد</div>'}
          <button class="cnt-add-lesson-inline" data-au="${u.id}">+ إضافة درس</button>
        </div>
      </div>`;
    }

    if (!html && q) {
      html = '<div class="cnt-msg">لا نتائج</div>';
    } else if (!html) {
      html = '<div class="cnt-msg-sm" style="padding:12px 14px">لا توجد وحدات بعد</div>';
    }

    html += `<button class="cnt-add-unit-card" data-ag="${grade.id}">
      ${SVG_FOLDER} إضافة وحدة
    </button>`;

    const fresh = panel.cloneNode(false);
    fresh.innerHTML = html;
    panel.replaceWith(fresh);

    bindUnitsPanel();
    initDragDrop();
  }

  function bindUnitsPanel() {
    const panel = $('cntUnitsPanel');
    if (!panel) return;

    /* expand / collapse unit cards */
    panel.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('button, .cnt-acts')) return;
        document.getElementById(el.dataset.toggle)?.classList.toggle('open');
      });
    });

    /* select lesson */
    panel.querySelectorAll('.cnt-lesson').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('button, .cnt-acts')) return;
        const g = grades.find(g => g.id === el.dataset.gid);
        const u = g?.units.find(u => u.id === el.dataset.uid);
        const l = u?.lessons.find(l => l.id === el.dataset.lid);
        if (l) openLesson(l, u, g);
      });
    });

    /* add unit */
    panel.querySelectorAll('[data-ag]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        $('mUnitGid').value = b.dataset.ag;
        $('mUnitName').value = '';
        openM('mUnit');
        setTimeout(() => $('mUnitName').focus(), 80);
      });
    });

    /* add lesson inline */
    panel.querySelectorAll('[data-au]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        $('mLessonUid').value = b.dataset.au;
        $('mLessonName').value = '';
        openM('mLesson');
        setTimeout(() => $('mLessonName').focus(), 80);
      });
    });

    /* rename */
    panel.querySelectorAll('[data-rt]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        _renameType = b.dataset.rt; _renameId = b.dataset.ri;
        const labels = { grade: 'تعديل اسم الصف', unit: 'تعديل اسم الوحدة', lesson: 'تعديل اسم الدرس' };
        $('mRenameTitle').textContent = labels[_renameType] || 'تعديل';
        $('mRenameInput').value = b.dataset.rc;
        openM('mRename');
        setTimeout(() => $('mRenameInput').select(), 80);
      });
    });

    /* copy */
    panel.querySelectorAll('[data-cpt]').forEach(b => {
      b.addEventListener('click', async e => {
        e.stopPropagation();
        const type = b.dataset.cpt, id = b.dataset.cpi, name = b.dataset.cpn;
        b.disabled = true;
        try {
          if (type === 'unit') {
            const u = await api('GET', `/api/units/${id}`);
            await api('POST', '/api/units', { name: `${u.name} - نسخة`, gradeId: u.gradeId });
          } else if (type === 'lesson') {
            const l = await api('GET', `/api/lessons/${id}`);
            await api('POST', '/api/lessons', { name: `${l.name} - نسخة`, unitId: l.unitId });
          }
          await loadGrades();
        } catch { b.disabled = false; }
      });
    });

    /* delete */
    panel.querySelectorAll('[data-dt]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        confirmDelete(b.dataset.dt, b.dataset.di, b.dataset.dn, b);
      });
    });

    /* prevent drag from starting on buttons/acts */
    panel.querySelectorAll('button, .cnt-acts').forEach(el => {
      el.addEventListener('mousedown', e => e.stopPropagation());
    });
  }

  /* ═══════════════════════════════════
     DRAG-AND-DROP REORDER
     ═══════════════════════════════════ */
  function initDragDrop() {
    const panel = $('cntUnitsPanel');
    if (!panel) return;

    let dragEl      = null;
    let dragType    = null;
    let dropLine    = null;
    let _fromHandle = false;

    const getType = el =>
      el.classList.contains('cnt-unit-card') ? 'unit' :
      el.classList.contains('cnt-lesson')    ? 'lesson' : null;

    const sel = { unit: '.cnt-unit-card', lesson: '.cnt-lesson' };

    panel.addEventListener('mousedown', e => {
      _fromHandle = !!e.target.closest('.cnt-drag-handle');
    });

    panel.querySelectorAll('[draggable="true"]').forEach(node => {
      node.addEventListener('dragstart', e => {
        if (!_fromHandle) { e.preventDefault(); return; }
        _fromHandle = false;
        dragEl   = node;
        dragType = getType(node);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', node.id || node.dataset.lid || '');
        setTimeout(() => node.classList.add('cnt-dragging'), 0);
        e.stopPropagation();
      });
      node.addEventListener('dragend', () => {
        node.classList.remove('cnt-dragging');
        dropLine?.remove(); dropLine = null;
        dragEl = null; dragType = null;
      });
    });

    const removeDropLine = () => { dropLine?.remove(); dropLine = null; };

    panel.addEventListener('dragover', e => {
      if (!dragEl || !dragType) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest(sel[dragType]);
      if (!target || target === dragEl) { removeDropLine(); return; }
      const rect = target.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      removeDropLine();
      dropLine = document.createElement('div');
      dropLine.className = 'cnt-drop-line';
      target.parentNode.insertBefore(dropLine, before ? target : target.nextSibling);
    });

    panel.addEventListener('dragleave', e => {
      if (!e.relatedTarget || !panel.contains(e.relatedTarget)) removeDropLine();
    });

    panel.addEventListener('drop', async e => {
      e.preventDefault();
      if (!dragEl || !dropLine) { removeDropLine(); return; }
      const parent  = dropLine.parentNode;
      const refNode = dropLine.nextSibling;
      removeDropLine();
      if (refNode !== dragEl && refNode !== dragEl?.nextSibling) {
        parent.insertBefore(dragEl, refNode);
      }
      dragEl.classList.remove('cnt-dragging');
      await _saveOrder(dragType, dragEl, parent);
      dragEl = null; dragType = null;
    });
  }

  async function _saveOrder(type, el, parent) {
    try {
      if (type === 'grade') {
        const ids = [...parent.querySelectorAll(':scope > .cnt-grade-node')]
          .map(n => n.id.replace('gn-', ''));
        await api('POST', '/api/grades/reorder', { orderedGradeIds: ids });
        grades.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

      } else if (type === 'unit') {
        const ids = [...parent.querySelectorAll(':scope > .cnt-unit-card')]
          .map(n => n.id.replace('uc-', ''));
        await api('POST', '/api/units/reorder', { gradeId: activeGradeId, orderedUnitIds: ids });
        const grade = grades.find(g => g.id === activeGradeId);
        if (grade) grade.units.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

      } else {
        const unitCard = el.closest('.cnt-unit-card');
        const unitId   = unitCard?.id.replace('uc-', '');
        const ids = [...parent.querySelectorAll(':scope > .cnt-lesson')]
          .map(n => n.dataset.lid);
        await api('POST', '/api/lessons/reorder', { unitId, orderedLessonIds: ids });
        for (const g of grades) {
          const unit = g.units.find(u => u.id === unitId);
          if (unit) { unit.lessons.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); break; }
        }
      }
      toast('تم حفظ الترتيب ✓', 'success');
    } catch {
      toast('فشل حفظ الترتيب', 'error');
      renderTree();
    }
  }

  /* ═══════════════════════════════════
     OPEN LESSON
     ═══════════════════════════════════ */
  function selectLesson(lesson, unit, grade) { openLesson(lesson, unit, grade); }

  function openLesson(lesson, unit, grade) {
    _addRecent(lesson, unit, grade);
    activeLesson = { lesson, unit, grade };
    activeIndex  = 0;
    _prevIndex   = -1;
    Object.keys(_slideState).forEach(k => delete _slideState[k]); /* clear state on new lesson */
    Object.keys(_pdfDocCache).forEach(k => {                      /* free parsed docs from prev lesson */
      try { _pdfDocCache[k].destroy(); } catch {}
      delete _pdfDocCache[k];
    });
    renderTree();

    $('cntBc').innerHTML =
      `<span class="cnt-bc-item">
         ${grade.name}
         <button class="cnt-bc-add" data-bc-add-unit="${grade.id}" title="إضافة وحدة">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
         </button>
       </span>
       <span class="cnt-bc-sep">›</span>
       <span class="cnt-bc-item">
         ${unit.name}
         <button class="cnt-bc-add" data-bc-add-lesson="${unit.id}" data-gid="${grade.id}" title="إضافة درس">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
         </button>
       </span>
       <span class="cnt-bc-sep">›</span>
       <span class="cnt-bc-last">${lesson.name}</span>`;

    // wire breadcrumb quick-add buttons
    $('cntBc').querySelector('[data-bc-add-unit]')?.addEventListener('click', e => {
      e.stopPropagation();
      const gid = e.currentTarget.dataset.bcAddUnit;
      $('mUnitGid').value = gid;
      $('mUnitName').value = '';
      openM('mUnit');
    });
    $('cntBc').querySelector('[data-bc-add-lesson]')?.addEventListener('click', e => {
      e.stopPropagation();
      $('mLessonUid').value = e.currentTarget.dataset.bcAddLesson;
      $('mLessonName').value = '';
      openM('mLesson');
    });

    $('cntWelcome').style.display = 'none';
    $('cntBoard').style.display   = 'flex';
    renderSlides();
  }

  /* ═══════════════════════════════════
     SLIDES (storyboard)
     ═══════════════════════════════════ */
  function renderSlides() {
    if (!activeLesson) return;
    const content = activeLesson.lesson.content || [];
    const slides  = $('cntSlides');
    const empty   = $('cntBoardEmpty');
    const launch  = $('cntLaunch');

    if (!content.length) {
      slides.innerHTML        = '';
      empty.style.display     = 'flex';
      launch.disabled         = true;
      return;
    }
    empty.style.display = 'none';
    launch.disabled     = false;

    slides.innerHTML = content.map((item, i) => {
      const meta  = getMeta(item);
      const name  = itemName(item);
      const isPdf = meta.kind === 'pdf';
      const thumb = meta.kind === 'image'
        ? `<img src="http://localhost:5000${item.path}" alt="${name}" style="width:100%;height:100%;object-fit:cover">`
        : `<i class="ti ${meta.icon}" style="font-size:32px;color:#fff;opacity:.9"></i>`;
      const thumbAttr = isPdf && item.path ? ` data-pdf-url="http://localhost:5000${item.path}"` : '';
      return `<div class="cnt-slide-card" data-idx="${i}" data-cid="${item.id}" draggable="true">
        <div class="cnt-slide-thumb" style="background:${meta.color}"${thumbAttr}>${thumb}</div>
        <div class="cnt-slide-actions">
          <button class="cnt-slide-act cnt-act-open" data-play="${i}" title="فتح الدرس">
            <svg viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20" fill="currentColor" stroke="none"/></svg>
          </button>
          <button class="cnt-slide-act cnt-act-del" data-delcid="${item.id}" title="حذف">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        </div>
        <div class="cnt-slide-foot">
          <span class="cnt-slide-name" title="${name}">${name}</span>
          <span class="cnt-slide-badge" style="background:${meta.color}22;color:${meta.color}">${meta.label}</span>
        </div>
      </div>`;
    }).join('');

    /* load PDF thumbnails asynchronously */
    slides.querySelectorAll('.cnt-slide-thumb[data-pdf-url]').forEach(async thumbEl => {
      const url = thumbEl.dataset.pdfUrl;
      const dataUrl = await getPdfThumb(url);
      if (!dataUrl) return;
      thumbEl.style.background = '#f1f5f9';
      thumbEl.innerHTML = `<img src="${dataUrl}" alt="preview" style="width:100%;height:100%;object-fit:cover;border-radius:2px">`;
    });

    slides.querySelectorAll('[data-play]').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); launchPresent(+b.dataset.play); });
    });
    slides.querySelectorAll('.cnt-slide-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        launchPresent(+card.dataset.idx);
      });
    });
    slides.querySelectorAll('[data-delcid]').forEach(b => {
      b.addEventListener('click', async e => {
        e.stopPropagation();
        if (!await confirmDialog('هل أنت متأكد من حذف هذا العنصر؟')) return;
        try {
          await api('DELETE', `/api/content/${b.dataset.delcid}`);
          activeLesson.lesson.content = activeLesson.lesson.content.filter(c => c.id !== b.dataset.delcid);
          renderSlides();
          renderTree();
          toast('تم الحذف', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });
    });

    _wireSlideReorder(slides);
  }

  /* drag-and-drop reordering of the lesson's content cards */
  function _wireSlideReorder(slides) {
    let dragCard = null;

    slides.querySelectorAll('.cnt-slide-card').forEach(card => {
      card.addEventListener('dragstart', e => {
        dragCard = card;
        card.classList.add('cnt-card-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.cid);   /* Firefox needs data */
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('cnt-card-dragging');
        dragCard = null;
        _saveContentOrder(slides);
      });
      card.addEventListener('dragover', e => {
        if (!dragCard || card === dragCard) return;
        e.preventDefault();
        const box    = card.getBoundingClientRect();
        const before = e.clientX > box.left + box.width / 2;   /* RTL: right half = earlier */
        slides.insertBefore(dragCard, before ? card : card.nextSibling);
      });
    });
  }

  async function _saveContentOrder(slides) {
    if (!activeLesson) return;
    const ids = [...slides.querySelectorAll('.cnt-slide-card')].map(c => c.dataset.cid);
    /* unchanged order → nothing to do */
    const cur = activeLesson.lesson.content.map(c => c.id);
    if (ids.join() === cur.join()) return;
    try {
      await api('POST', '/api/content/reorder', {
        lessonId: activeLesson.lesson.id,
        orderedContentIds: ids,
      });
      activeLesson.lesson.content.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      renderSlides();                 /* refresh data-idx + thumbnails */
      toast('تم إعادة الترتيب', 'success');
    } catch (err) {
      toast(err.message, 'error');
      renderSlides();                 /* revert to server order on failure */
    }
  }

  /* ═══════════════════════════════════
     BOARD WIRING
     ═══════════════════════════════════ */
  function wireBoard() {
    $('cntLaunch')?.addEventListener('click', () => launchPresent(0));

    /* file upload */
    $('cntFile')?.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file || !activeLesson) return;
      e.target.value = '';
      const progress = $('cntProgress');
      const bar      = $('cntProgressBar');
      const label    = $('cntProgressLabel');
      progress.style.display = 'flex';
      bar.style.setProperty('--pct', '0%');

      try {
        const item = await new Promise((resolve, reject) => {
          const fd  = new FormData();
          fd.append('file', file);
          fd.append('lessonId', activeLesson.lesson.id);
          const xhr = new XMLHttpRequest();
          xhr.open('POST', 'http://localhost:5000/api/content/upload');
          xhr.setRequestHeader('x-api-key', _key);
          xhr.upload.onprogress = ev => {
            if (ev.lengthComputable) {
              const pct = Math.round(ev.loaded / ev.total * 100) + '%';
              bar.style.setProperty('--pct', pct);
              label.textContent = `${pct} — جارٍ الرفع`;
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try { resolve(JSON.parse(xhr.responseText)); }
              catch { reject(new Error('خطأ في الاستجابة')); }
            } else { reject(new Error(`خطأ ${xhr.status}`)); }
          };
          xhr.onerror = () => reject(new Error('خطأ في الاتصال'));
          xhr.send(fd);
        });
        activeLesson.lesson.content.push(item);
        progress.style.display = 'none';
        renderSlides();
        renderTree();
        toast('تم رفع الملف', 'success');
      } catch (err) {
        progress.style.display = 'none';
        toast(err.message, 'error');
      }
    });

    /* add link */
    $('cntAddLink')?.addEventListener('click', () => {
      $('mLinkTitle').value = '';
      $('mLinkUrl').value   = '';
      openM('mLink');
      setTimeout(() => $('mLinkUrl').focus(), 80);
    });

    /* whiteboard */
    $('cntAddWb')?.addEventListener('click', async () => {
      if (!activeLesson) return;
      try {
        const item = await api('POST', '/api/content/whiteboard', { lessonId: activeLesson.lesson.id });
        activeLesson.lesson.content.push(item);
        renderSlides();
        renderTree();
        toast('تم إضافة لوح الرسم', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });

    $('cntAddQuiz')?.addEventListener('click', () => {
      if (!activeLesson) return;
      openQuizPicker();
    });
  }

  /* ═══════════════════════════════════
     MODALS
     ═══════════════════════════════════ */
  function wireModals() {
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => closeM(btn.dataset.close));
    });
    document.querySelectorAll('.cnt-overlay').forEach(ov => {
      ov.addEventListener('click', e => { if (e.target === ov) closeM(ov.id); });
    });
    document.querySelectorAll('.cnt-minput').forEach(inp => {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') inp.closest('.cnt-modal')?.querySelector('.cnt-msave')?.click();
      });
    });
  }

  /* ── Edit mode toggle ── */
  $('cntEditToggle')?.addEventListener('click', () => {
    const sb  = $('cntSb');
    const btn = $('cntEditToggle');
    if (!sb || !btn) return;
    const on = sb.classList.toggle('cnt-edit-mode');
    btn.classList.toggle('active', on);
    btn.title = on ? 'إيقاف وضع التعديل' : 'وضع التعديل';
  });

  function wireGrade() {
    $('cntAddGrade')?.addEventListener('click', () => {
      $('mGradeName').value = '';
      openM('mGrade');
      setTimeout(() => $('mGradeName').focus(), 80);
    });
    $('mGradeSave')?.addEventListener('click', async () => {
      const name = $('mGradeName').value.trim();
      if (!name) return;
      const btn = $('mGradeSave'); btn.disabled = true;
      try {
        const g = await api('POST', '/api/grades', { name });
        grades.push({ ...g, units: g.units || [] });
        closeM('mGrade'); renderTree();
        toast('تم إضافة الصف', 'success');
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    });
  }

  function wireUnit() {
    $('mUnitSave')?.addEventListener('click', async () => {
      const name = $('mUnitName').value.trim();
      const gid  = $('mUnitGid').value;
      if (!name || !gid) return;
      const btn = $('mUnitSave'); btn.disabled = true;
      try {
        const u = await api('POST', '/api/units', { gradeId: gid, name });
        const g = grades.find(g => g.id === gid);
        if (g) g.units.push({ ...u, lessons: u.lessons || [] });
        closeM('mUnit'); renderTree();
        toast('تم إضافة الوحدة', 'success');
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    });
  }

  function wireLesson() {
    $('mLessonSave')?.addEventListener('click', async () => {
      const name = $('mLessonName').value.trim();
      const uid  = $('mLessonUid').value;
      if (!name || !uid) return;
      const btn = $('mLessonSave'); btn.disabled = true;
      try {
        const l = await api('POST', '/api/lessons', { unitId: uid, name });
        for (const g of grades) {
          const u = g.units.find(u => u.id === uid);
          if (u) { u.lessons.push({ ...l, content: l.content || [] }); break; }
        }
        closeM('mLesson'); renderTree();
        toast('تم إضافة الدرس', 'success');
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    });
  }

  function wireLink() {
    $('mLinkSave')?.addEventListener('click', async () => {
      if (!activeLesson) return;
      const url   = $('mLinkUrl').value.trim();
      const title = $('mLinkTitle').value.trim() || url;
      if (!url) { $('mLinkUrl').focus(); return; }
      const btn = $('mLinkSave'); btn.disabled = true;
      try {
        const item = await api('POST', '/api/content/link', {
          lessonId: activeLesson.lesson.id, url, title,
        });
        activeLesson.lesson.content.push(item);
        closeM('mLink'); renderSlides(); renderTree();
        toast('تم إضافة الرابط', 'success');
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    });
  }

  /* ═══════════════════════════════════
     RENAME
     ═══════════════════════════════════ */
  let _renameType = '', _renameId = '';

  function wireRename() {
    $('mRenameSave')?.addEventListener('click', async () => {
      const name = $('mRenameInput').value.trim();
      if (!name) return;
      const btn = $('mRenameSave'); btn.disabled = true;
      try {
        const ep = { grade: 'grades', unit: 'units', lesson: 'lessons' }[_renameType];
        await api('PUT', `/api/${ep}/${_renameId}`, { name });
        if (_renameType === 'grade') {
          const g = grades.find(g => g.id === _renameId);
          if (g) g.name = name;
        } else if (_renameType === 'unit') {
          for (const g of grades) { const u = g.units.find(u => u.id === _renameId); if (u) { u.name = name; break; } }
        } else {
          for (const g of grades) {
            for (const u of g.units) {
              const l = u.lessons.find(l => l.id === _renameId);
              if (l) {
                l.name = name;
                if (activeLesson?.lesson.id === _renameId) {
                  activeLesson.lesson.name = name;
                  openLesson(l, u, g);
                }
                break;
              }
            }
          }
        }
        closeM('mRename'); renderTree();
        toast('تم التعديل', 'success');
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    });
  }

  /* ═══════════════════════════════════
     DELETE CONFIRM (inline)
     ═══════════════════════════════════ */
  function confirmDelete(type, id, name, triggerBtn) {
    const row = triggerBtn.closest('.cnt-grade-row, .cnt-unit-row, .cnt-lesson');
    if (!row || row.querySelector('.cnt-del-confirm')) return;
    const box = document.createElement('div');
    box.className = 'cnt-del-confirm';
    box.innerHTML = `<span>حذف "<b>${name}</b>"؟</span>
      <button class="cnt-del-yes">حذف</button>
      <button class="cnt-del-no">إلغاء</button>`;
    row.appendChild(box);
    box.querySelector('.cnt-del-no').addEventListener('click', () => box.remove());
    box.querySelector('.cnt-del-yes').addEventListener('click', async () => {
      const y = box.querySelector('.cnt-del-yes');
      y.disabled = true; y.textContent = '...';
      try {
        const ep = { grade: 'grades', unit: 'units', lesson: 'lessons' }[type];
        await api('DELETE', `/api/${ep}/${id}`);
        if (type === 'lesson' && activeLesson?.lesson.id === id) {
          activeLesson = null;
          $('cntBoard').style.display   = 'none';
          $('cntWelcome').style.display = 'flex';
        }
        if (type === 'grade') {
          grades = grades.filter(g => g.id !== id);
        } else if (type === 'unit') {
          for (const g of grades) g.units = g.units.filter(u => u.id !== id);
        } else {
          for (const g of grades) for (const u of g.units) u.lessons = u.lessons.filter(l => l.id !== id);
        }
        renderTree();
        toast('تم الحذف', 'success');
      } catch (err) { toast(err.message, 'error'); box.remove(); }
    });
  }

  /* ═══════════════════════════════════
     SEARCH
     ═══════════════════════════════════ */
  function wireSearch() {
    $('cntSearch')?.addEventListener('input', renderTree);
  }

  /* ═══════════════════════════════════
     PRESENTATION
     ═══════════════════════════════════ */
  function launchPresent(idx) {
    if (!activeLesson?.lesson.content?.length) return;
    activeIndex = Math.max(0, Math.min(idx, activeLesson.lesson.content.length - 1));

    const cinema  = $('cntCinema');
    const titleEl = $('cntCinemaTitle');
    const subEl   = $('cntCinemaSub');

    // populate text
    if (titleEl) titleEl.textContent = activeLesson.lesson.name || '';
    if (subEl)   subEl.textContent   = [activeLesson.grade?.name, activeLesson.unit?.name].filter(Boolean).join(' › ');

    // show overlay and trigger enter animation
    cinema.hidden = false;
    cinema.classList.remove('exiting');
    // force reflow so transition fires
    void cinema.offsetWidth;
    cinema.classList.add('entering');

    // after circle fully expands → prepare presentation under it
    setTimeout(() => {
      $('cntPresent').style.display = 'flex';
      document.body.classList.add('cnt-presenting');
      resetZoom();
      resetAnno();
      resizeCanvas();
      renderThumbStrip();
      renderCurrentSlide();
      _initLaserPointer();
      _initSwipe();
    }, 750);

    // then fade the cinema overlay out
    setTimeout(() => {
      cinema.classList.remove('entering');
      cinema.classList.add('exiting');
      setTimeout(() => {
        cinema.hidden = true;
        cinema.classList.remove('exiting');
      }, 500);
    }, 2000);
  }

  /* ── Laser pointer ── */
  function _initLaserPointer() {
    const stage = $('cntPresent');
    if (!stage) return;
    let dot = document.getElementById('cntLaserDot');
    if (!dot) {
      dot = document.createElement('div');
      dot.id = 'cntLaserDot';
      dot.className = 'cnt-laser-dot';
      document.body.appendChild(dot);
    }
    let laserActive = false;
    const move = e => {
      if (!laserActive) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      dot.style.left = x + 'px';
      dot.style.top  = y + 'px';
      dot.classList.add('visible');
    };
    const hide = () => dot.classList.remove('visible');
    /* right-click or 2-finger hold activates laser */
    const down = e => {
      if (e.button === 2 || (e.touches && e.touches.length === 2)) {
        laserActive = true; move(e);
      }
    };
    const up = () => { laserActive = false; hide(); };
    stage.addEventListener('mousemove', move);
    stage.addEventListener('mousedown', down);
    stage.addEventListener('mouseup', up);
    stage.addEventListener('mouseleave', hide);
    stage.addEventListener('touchmove', move, { passive: true });
    stage.addEventListener('touchstart', down, { passive: true });
    stage.addEventListener('touchend', up);
    stage.addEventListener('contextmenu', e => e.preventDefault());
    stage._laserCleanup = () => {
      stage.removeEventListener('mousemove', move);
      stage.removeEventListener('mousedown', down);
      stage.removeEventListener('mouseup', up);
      stage.removeEventListener('mouseleave', hide);
      stage.removeEventListener('touchmove', move);
      stage.removeEventListener('touchstart', down);
      stage.removeEventListener('touchend', up);
      dot.remove();
    };
  }

  /* ── Swipe navigation ── */
  function _initSwipe() {
    const stage = $('cntPresent');
    if (!stage) return;
    let sx = 0, sy = 0;
    const ts = e => { if (e.touches.length !== 1) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
    const te = e => {
      if (!e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = Math.abs(e.changedTouches[0].clientY - sy);
      if (Math.abs(dx) > 50 && dy < 80) {
        /* only navigate if not a quiz (quiz handles its own prev/next) */
        const cur = activeLesson?.lesson.content?.[activeIndex];
        if (cur?.type === 'quiz') return;
        if (dx < 0) $('cntNext')?.click();
        else         $('cntPrev')?.click();
      }
    };
    stage.addEventListener('touchstart', ts, { passive: true });
    stage.addEventListener('touchend', te);
    stage._swipeCleanup = () => {
      stage.removeEventListener('touchstart', ts);
      stage.removeEventListener('touchend', te);
    };
  }

  function hidePresent() {
    const stage = $('cntPresent');
    stage?._laserCleanup?.(); stage?._swipeCleanup?.();
    stage.style.display = 'none';
    document.body.classList.remove('cnt-presenting');
    _pdfDoc = null;
    $('cntStage')?.classList.remove('pdf-mode');
    document.getElementById('pdfNavBar')?.remove();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  /* ═══════════════════════════════════
     QUIZ PLAYER
     ═══════════════════════════════════ */
  async function renderQuizPlayer(item) {
    const wrap = document.getElementById('cntQuizPlayer');
    if (!wrap) return;

    let quiz;
    try {
      quiz = await api('GET', `/api/quizzes/${item.quizId}`);
    } catch {
      wrap.innerHTML = `<div class="cnt-qp-error">تعذّر تحميل الاختبار</div>`;
      return;
    }

    const questions = quiz.questions || [];
    if (!questions.length) {
      wrap.innerHTML = `<div class="cnt-qp-error">لا توجد أسئلة في هذا الاختبار</div>`;
      return;
    }

    /* ── Cinematic intro ── */
    await new Promise(resolve => {
      wrap.innerHTML = '';
      const intro = document.createElement('div');
      intro.className = 'cnt-qp-intro';
      intro.innerHTML = `
        <img class="cnt-qp-intro-img" src="question.png" alt="">
        <div class="cnt-qp-intro-title">${quiz.name || quiz.title || 'اختبار'}</div>
        <div class="cnt-qp-intro-sub">${questions.length} سؤال</div>
        <div class="cnt-qp-intro-count" id="cntQpIntroCount">3</div>`;
      wrap.appendChild(intro);
      requestAnimationFrame(() => intro.classList.add('show'));

      let n = 3;
      const cd = setInterval(() => {
        n--;
        const el = document.getElementById('cntQpIntroCount');
        if (n > 0 && el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); el.textContent = n; }
        else {
          clearInterval(cd);
          intro.classList.add('hide');
          setTimeout(() => { intro.remove(); resolve(); }, 650);
        }
      }, 1000);
    });

    let current     = 0;
    let score       = 0;
    let answered    = 0;
    let zoom        = window._cntQuizZoom ?? 1;
    let teacherMode = false;
    let timerOn     = false;
    let timerSec    = 30;
    let _timerInt   = null;

    /* ── Audio ── */
    let _actx = null;
    function _tone(freq, dur, type = 'sine', vol = 0.3) {
      try {
        if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = _actx.createOscillator();
        const g   = _actx.createGain();
        osc.type = type; osc.frequency.value = freq;
        osc.connect(g); g.connect(_actx.destination);
        g.gain.setValueAtTime(0.001, _actx.currentTime);
        g.gain.exponentialRampToValueAtTime(vol, _actx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, _actx.currentTime + dur);
        osc.start(); osc.stop(_actx.currentTime + dur);
      } catch {}
    }
    function playCorrect() { _tone(523,.18); setTimeout(()=>_tone(659,.22),100); setTimeout(()=>_tone(784,.3),200); }
    function playWrong()   { _tone(220,.3,'sawtooth'); setTimeout(()=>_tone(180,.35,'sawtooth'),150); }
    function playFinish()  { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>_tone(f,.25),i*120)); }

    /* ── Confetti ── */
    function celebrate() {
      const emojis = ['🎉','⭐','✨','🌟','👏','🎊'];
      for (let i = 0; i < 18; i++) {
        const el = document.createElement('div');
        el.className = 'cnt-qp-confetti';
        el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        el.style.cssText = `left:${Math.random()*100}%;animation-delay:${Math.random()*0.5}s;font-size:${1.2+Math.random()}rem`;
        wrap.appendChild(el);
        setTimeout(() => el.remove(), 2000);
      }
    }

    /* ── Feedback overlay ── */
    function showFeedback(isCorrect, correctText, explanation) {
      const overlay = document.createElement('div');
      overlay.className = `cnt-qp-feedback ${isCorrect ? 'correct' : 'wrong'}`;
      const msgs = isCorrect
        ? ['أحسنت! 🎉','ممتاز! ⭐','رائع! 🌟','إجابة مثالية! 👏']
        : ['حاول مرة أخرى! 💪','لا بأس! 🤗','المحاولة القادمة ستكون أفضل 💡'];
      const msg = msgs[Math.floor(Math.random() * msgs.length)];

      overlay.innerHTML = `
        <div class="cnt-qp-feedback-card">
          <div class="cnt-qp-feedback-icon">${isCorrect ? '✅' : '❌'}</div>
          <div class="cnt-qp-feedback-title">${isCorrect ? 'إجابة صحيحة!' : 'إجابة خاطئة!'}</div>
          <div class="cnt-qp-feedback-msg">${msg}</div>
          ${!isCorrect && correctText ? `<div class="cnt-qp-feedback-correct">الإجابة الصحيحة: <strong>${correctText}</strong></div>` : ''}
          ${explanation ? `<div class="cnt-qp-feedback-exp">${explanation}</div>` : ''}
          <button class="cnt-qp-feedback-next">${current === questions.length - 1 ? '🏁 إنهاء الاختبار' : 'السؤال التالي ←'}</button>
        </div>`;
      wrap.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));

      overlay.querySelector('.cnt-qp-feedback-next').addEventListener('click', () => {
        overlay.classList.remove('show');
        setTimeout(() => {
          overlay.remove();
          if (current < questions.length - 1) { current++; renderQ(); }
          else showResults();
        }, 300);
      });
    }

    /* ── Results screen ── */
    function showResults() {
      playFinish();
      const pct = Math.round((score / questions.length) * 100);
      const grade = pct >= 90 ? 'ممتاز 🏆' : pct >= 75 ? 'جيد جداً ⭐' : pct >= 60 ? 'جيد 👍' : 'يحتاج مراجعة 📖';
      const emoji = pct >= 90 ? '🏆' : pct >= 60 ? '🎉' : '📖';

      /* curtain-in: dark overlay sweeps in then reveals results */
      const curtain = document.createElement('div');
      curtain.className = 'cnt-qp-curtain';
      wrap.appendChild(curtain);
      requestAnimationFrame(() => curtain.classList.add('in'));

      setTimeout(() => {
        wrap.innerHTML = `
          <div class="cnt-qp-results" id="cntQpResults">
            <div class="cnt-qp-results-emoji">${emoji}</div>
            <h2 class="cnt-qp-results-title">انتهى الاختبار!</h2>
            <div class="cnt-qp-results-score">${score} / ${questions.length}</div>
            <div class="cnt-qp-results-pct">${pct}%</div>
            <div class="cnt-qp-results-grade">${grade}</div>
            <div class="cnt-qp-results-actions">
              <button class="cnt-qp-btn cnt-qp-btn-reveal" id="cntQpRestart">↺ إعادة الاختبار</button>
              <button class="cnt-qp-btn" id="cntQpResultsExit">✕ خروج</button>
            </div>
          </div>`;
        requestAnimationFrame(() => {
          document.getElementById('cntQpResults')?.classList.add('show');
        });
        document.getElementById('cntQpRestart')?.addEventListener('click', () => {
          window._cntQuizZoom = 1;
          renderQuizPlayer(item);
        });
        document.getElementById('cntQpResultsExit')?.addEventListener('click', () => {
          const res = document.getElementById('cntQpResults');
          if (res) res.classList.add('exit');
          setTimeout(() => { window._cntQuizZoom = 1; $('cntExit')?.click(); }, 500);
        });
      }, 600);

      if (pct >= 60) celebrate();
    }

    /* ── Render question ── */
    function renderQ() {
      const q    = questions[current];
      const opts = q.options || [];
      const labels    = ['1','2','3','4','5','6'];
      const correctIdx = typeof q.correctAnswer === 'number' ? q.correctAnswer
                       : typeof q.correct === 'number' ? q.correct
                       : opts.findIndex(o => o.isCorrect || o.correct === true);

      const qImg = q.image || q.imageUrl || q.img || '';
      const pct  = Math.round(((current + 1) / questions.length) * 100);
      wrap.innerHTML = `
        <div class="cnt-qp-header">
          <div class="cnt-qp-header-right">
            <span class="cnt-qp-prog">${current + 1} / ${questions.length}</span>
            <span class="cnt-qp-score">✅ ${score} / ${answered}</span>
          </div>
          <span class="cnt-qp-title">${quiz.name || quiz.title || 'اختبار'}</span>
          <div class="cnt-qp-header-left">
            ${timerOn ? `<div class="cnt-qp-timer" id="cntQpTimer">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
              <span id="cntQpTimerVal">${timerSec}</span>
            </div>` : ''}
            <div class="cnt-qp-zoom">
              <button class="cnt-qp-zoom-btn" id="cntQpZoomIn" title="تكبير">+</button>
              <span class="cnt-qp-zoom-pct" id="cntQpZoomPct">${Math.round(zoom*100)}%</span>
              <button class="cnt-qp-zoom-btn" id="cntQpZoomOut" title="تصغير">−</button>
            </div>
            <button class="cnt-qp-icon-btn${teacherMode ? ' cnt-qp-teacher-on' : ''}" id="cntQpTeacher" title="وضع المعلم">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="cnt-qp-icon-btn" id="cntQpQt" title="أدوات سريعة">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
            </button>
            <button class="cnt-qp-icon-btn" id="cntQpFs" title="ملء الشاشة">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
            </button>
            <button class="cnt-qp-exit-btn" id="cntQpExit" title="خروج">✕ خروج</button>
          </div>
        </div>
        <!-- progress bar -->
        <div class="cnt-qp-progress-wrap">
          <div class="cnt-qp-progress-bar" style="width:${pct}%"></div>
        </div>
        <div class="cnt-qp-scaler" id="cntQpScaler" style="transform:scale(${zoom});transform-origin:top center;width:100%;transition:transform .2s">
          <div class="cnt-qp-card">
            <div class="cnt-qp-q">${q.text || q.question || ''}</div>
            ${qImg ? `<div class="cnt-qp-img-wrap"><img class="cnt-qp-img" src="${qImg}" alt="صورة السؤال"></div>` : ''}
            <div class="cnt-qp-opts" id="cntQpOpts">
              ${opts.map((o, i) => `
                <button class="cnt-qp-opt" data-i="${i}" data-label="${labels[i]||i+1}" data-correct="${i === correctIdx}">
                  ${o.text || o.label || (typeof o === 'string' ? o : '')}
                </button>`).join('')}
            </div>
          </div>
          <div class="cnt-qp-nav">
            <button class="cnt-qp-btn" id="cntQpPrev" ${current === 0 ? 'disabled' : ''}>&#8250; السابق</button>
            <button class="cnt-qp-btn cnt-qp-btn-reveal" id="cntQpReveal" style="${teacherMode ? '' : 'display:none'}">كشف الإجابة</button>
            <button class="cnt-qp-btn" id="cntQpNext" ${current === questions.length - 1 ? 'disabled' : ''}>التالي &#8249;</button>
          </div>
        </div>`;

      /* option click → interactive answer */
      wrap.querySelectorAll('.cnt-qp-opt').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.closest('.cnt-quiz-player').querySelector('.cnt-qp-feedback')) return;
          const chosen = btn.dataset.correct === 'true';
          answered++;
          if (chosen) { score++; playCorrect(); celebrate(); }
          else { playWrong(); }
          /* highlight all */
          wrap.querySelectorAll('.cnt-qp-opt').forEach(b => {
            b.classList.add('revealed');
            b.classList.add(b.dataset.correct === 'true' ? 'correct' : 'wrong');
          });
          const correctText = opts[correctIdx]?.text || opts[correctIdx]?.label || (typeof opts[correctIdx]==='string'?opts[correctIdx]:'');
          setTimeout(() => showFeedback(chosen, correctText, q.explanation), 500);
        });
      });

      /* teacher reveal (no score effect) */
      document.getElementById('cntQpReveal')?.addEventListener('click', () => {
        wrap.querySelectorAll('.cnt-qp-opt').forEach(b => {
          b.classList.add('revealed');
          b.classList.add(b.dataset.correct === 'true' ? 'correct' : 'wrong');
        });
        document.getElementById('cntQpReveal').disabled = true;
      });

      document.getElementById('cntQpPrev')?.addEventListener('click', () => { if (current > 0) { current--; renderQ(); } });
      document.getElementById('cntQpNext')?.addEventListener('click', () => { if (current < questions.length - 1) { current++; renderQ(); } });

      /* zoom controls */
      function applyZoom() {
        const scaler = document.getElementById('cntQpScaler');
        const pct    = document.getElementById('cntQpZoomPct');
        if (scaler) scaler.style.transform = `scale(${zoom})`;
        if (pct)    pct.textContent = Math.round(zoom * 100) + '%';
        window._cntQuizZoom = zoom;
      }
      document.getElementById('cntQpZoomIn')?.addEventListener('click', () => {
        zoom = Math.min(2, +(zoom + 0.1).toFixed(1)); applyZoom();
      });
      document.getElementById('cntQpZoomOut')?.addEventListener('click', () => {
        zoom = Math.max(0.5, +(zoom - 0.1).toFixed(1)); applyZoom();
      });

      /* exit button in quiz header */
      document.getElementById('cntQpExit')?.addEventListener('click', () => {
        window._cntQuizZoom = 1; /* reset zoom for next quiz */
        $('cntExit')?.click();
      });

      /* teacher mode toggle */
      document.getElementById('cntQpTeacher')?.addEventListener('click', () => {
        teacherMode = !teacherMode;
        const btn    = document.getElementById('cntQpTeacher');
        const reveal = document.getElementById('cntQpReveal');
        if (btn)    btn.classList.toggle('cnt-qp-teacher-on', teacherMode);
        if (reveal) reveal.style.display = teacherMode ? '' : 'none';
        if (teacherMode) {
          /* show timer control panel */
          const existing = document.getElementById('cntQpTimerPanel');
          if (!existing) {
            const panel = document.createElement('div');
            panel.id = 'cntQpTimerPanel';
            panel.className = 'cnt-qp-timer-panel';
            panel.innerHTML = `
              <span>⏱ تايمر لكل سؤال</span>
              <select id="cntQpTimerSec" class="cnt-qp-timer-select">
                <option value="0">بدون</option>
                <option value="15">15 ث</option>
                <option value="20">20 ث</option>
                <option value="30" ${timerSec===30?'selected':''}>30 ث</option>
                <option value="45">45 ث</option>
                <option value="60">60 ث</option>
              </select>`;
            wrap.insertBefore(panel, wrap.querySelector('.cnt-qp-progress-wrap'));
            document.getElementById('cntQpTimerSec').addEventListener('change', e => {
              timerSec = +e.target.value;
              timerOn  = timerSec > 0;
              renderQ();
            });
          }
        } else {
          document.getElementById('cntQpTimerPanel')?.remove();
        }
      });

      /* timer logic */
      if (timerOn && timerSec > 0) {
        clearInterval(_timerInt);
        let left = timerSec;
        const tick = () => {
          const el = document.getElementById('cntQpTimerVal');
          if (!el) { clearInterval(_timerInt); return; }
          el.textContent = left;
          el.parentElement.classList.toggle('cnt-qp-timer-warn', left <= 5);
          if (left <= 0) {
            clearInterval(_timerInt);
            /* time's up: auto-reveal wrong and move on */
            wrap.querySelectorAll('.cnt-qp-opt').forEach(b => {
              b.classList.add('revealed');
              b.classList.add(b.dataset.correct === 'true' ? 'correct' : 'wrong');
              b.disabled = true;
            });
            answered++;
            playWrong();
            setTimeout(() => {
              if (current < questions.length - 1) { current++; renderQ(); }
              else showResults();
            }, 1200);
          }
          left--;
        };
        tick();
        _timerInt = setInterval(tick, 1000);
      }

      /* quick tools button in quiz header → reuse existing menu */
      document.getElementById('cntQpQt')?.addEventListener('click', e => {
        e.stopPropagation();
        const menu = $('cntQtMenu');
        if (!menu) return;
        if (!menu.hidden) { menu.hidden = true; return; }
        const r = e.currentTarget.getBoundingClientRect();
        let left = r.left;
        if (left + 180 > window.innerWidth) left = r.right - 180;
        menu.style.left = `${Math.max(8, left)}px`;
        menu.style.top  = `${r.bottom + 8}px`;
        menu.hidden = false;
      });

      /* zoom toggle 100% ↔ 140% + window maximize/restore */
      document.getElementById('cntQpFs')?.addEventListener('click', () => {
        zoom = zoom >= 1.4 ? 1 : 1.4;
        applyZoom();
        window.api?.toggleFullscreen?.();
        const btn = document.getElementById('cntQpFs');
        if (!btn) return;
        const expanded = zoom >= 1.4;
        btn.innerHTML = expanded
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>`;
        btn.title = expanded ? 'تصغير' : 'تكبير 140%';
      });

      /* keyboard shortcuts */
      const _kbHandler = e => {
        if (!document.getElementById('cntQpOpts')) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        const opts = wrap.querySelectorAll('.cnt-qp-opt:not(.revealed)');
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const dir = e.key === 'ArrowRight' ? -1 : 1;
          const next = current + dir;
          if (next >= 0 && next < questions.length) { current = next; renderQ(); }
        } else if (['1','2','3','4','5','6'].includes(e.key)) {
          const idx = +e.key - 1;
          if (opts[idx]) opts[idx].click();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const fb = wrap.querySelector('.cnt-qp-feedback-next');
          if (fb) fb.click();
          else if (current < questions.length - 1) { current++; renderQ(); }
        }
      };
      document.addEventListener('keydown', _kbHandler);
      /* clean up on exit */
      const _cleanKb = () => document.removeEventListener('keydown', _kbHandler);
      document.getElementById('cntQpExit')?.addEventListener('click', _cleanKb, { once: true });
      document.getElementById('cntQpResultsExit')?.addEventListener('click', _cleanKb, { once: true });
    }

    renderQ();
  }

  /* ═══════════════════════════════════
     QUIZ PICKER MODAL
     ═══════════════════════════════════ */
  let _quizPickerSelected = null;

  async function openQuizPicker() {
    _quizPickerSelected = null;
    const listEl  = $('mQuizList');
    const saveBtn = $('mQuizSave');
    const searchEl = $('mQuizSearch');
    if (saveBtn) saveBtn.disabled = true;
    if (searchEl) searchEl.value = '';
    openM('mQuiz');

    let quizzes = [];
    let groupMap = {};
    try {
      [quizzes] = await Promise.all([
        api('GET', '/api/quizzes'),
        api('GET', '/api/groups').then(gs => { groupMap = Object.fromEntries((gs || []).map(g => [g.id, g.name])); }).catch(() => {})
      ]);
    } catch {
      if (listEl) listEl.innerHTML = '<div class="cnt-msg">تعذّر تحميل الاختبارات</div>';
      return;
    }

    function renderList(q) {
      if (!listEl) return;
      if (!q.length) { listEl.innerHTML = '<div class="cnt-msg">لا توجد اختبارات محفوظة</div>'; return; }
      listEl.innerHTML = q.map(quiz => {
        const groupName = quiz.groupId && groupMap[quiz.groupId] ? groupMap[quiz.groupId] : null;
        return `
        <div class="cnt-quiz-row" data-qid="${quiz.id}" data-qtitle="${esc(quiz.title || quiz.name || '')}">
          <span class="cnt-quiz-row-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>
          </span>
          <span class="cnt-quiz-row-info">
            <span class="cnt-quiz-row-name">${esc(quiz.title || quiz.name || 'اختبار')}</span>
            <span class="cnt-quiz-row-meta">${quiz.questionsCount || 0} سؤال${quiz.duration ? ' · ' + quiz.duration + ' دقيقة' : ''}${groupName ? ' · ' + esc(groupName) : ''}</span>
          </span>
          <span class="cnt-quiz-row-check"></span>
        </div>`;
      }).join('');

      listEl.querySelectorAll('.cnt-quiz-row').forEach(row => {
        row.addEventListener('click', () => {
          listEl.querySelectorAll('.cnt-quiz-row').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          _quizPickerSelected = { id: row.dataset.qid, title: row.dataset.qtitle };
          if (saveBtn) saveBtn.disabled = false;
        });
      });
    }

    renderList(quizzes);

    // Replace handler each open to avoid stacking listeners
    if (searchEl) {
      searchEl.oninput = () => {
        const q = searchEl.value.trim().toLowerCase();
        renderList(q ? quizzes.filter(z => (z.title || z.name || '').toLowerCase().includes(q)) : quizzes);
      };
    }

    if (saveBtn) {
      saveBtn.onclick = async () => {
        if (!_quizPickerSelected || !activeLesson) return;
        saveBtn.disabled = true;
        try {
          const item = await api('POST', '/api/content/quiz', { lessonId: activeLesson.lesson.id, quizId: _quizPickerSelected.id });
          item.quizTitle = _quizPickerSelected.title;
          activeLesson.lesson.content = activeLesson.lesson.content || [];
          activeLesson.lesson.content.push(item);
          closeM('mQuiz');
          renderSlides();
          toast('تمت إضافة الاختبار للدرس ✓', 'success');
        } catch {
          toast('حدث خطأ أثناء الإضافة', 'error');
          saveBtn.disabled = false;
        }
      };
    }
  }

  function renderCurrentSlide() {
    if (!activeLesson) return;
    const content = activeLesson.lesson.content;
    if (!content?.length) return;
    const item = content[activeIndex];

    /* save the slide we're leaving FIRST (its page/strokes are still live) */
    _saveSlideState(_prevIndex);
    _prevIndex = activeIndex;

    $('cntCounter').textContent = `${activeIndex + 1} / ${content.length}`;

    document.querySelectorAll('.cnt-thumb').forEach((t, i) => {
      t.classList.toggle('active', i === activeIndex);
    });
    document.querySelector('.cnt-thumb.active')
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

    _pdfDoc = null; _pdfCurrentPage = 1; _pdfTotalPages = 0; _pdfUrl = '';
    resetAnno();
    resetZoom();
    $('cntStage')?.classList.remove('pdf-mode');
    document.getElementById('pdfNavBar')?.remove();
    $('cntViewer').innerHTML = buildViewer(item);

    /* YouTube webview: inject CSS to hide everything except the player */
    if (item.type === 'link' && getMeta(item).kind === 'youtube') {
      const wv = $('cntViewer').querySelector('webview');
      if (wv) {
        wv.addEventListener('dom-ready', () => {
          wv.insertCSS(`
            * { box-sizing: border-box; }
            html, body { margin:0; padding:0; overflow:hidden; background:#000; width:100vw; height:100vh; }
            #masthead-container, ytd-watch-metadata, #secondary,
            #below, ytd-comments, #chat-container, #related,
            tp-yt-app-drawer, ytd-miniplayer, .ytp-chrome-top,
            .ytp-watermark, ytd-popup-container, tp-yt-paper-dialog,
            ytd-enforcement-message-view-model,
            yt-mealbar-promo-renderer, #mealbar-promo-renderer,
            .ytd-mealbar-promo-renderer { display:none!important; }
            ytd-app { --ytd-masthead-height:0px!important; }
            #page-manager, ytd-watch-flexy, #columns, #primary, #primary-inner {
              margin:0!important; padding:0!important; max-width:100vw!important;
            }
            #movie_player {
              position:fixed!important;
              top:2vh!important; left:2vw!important;
              width:96vw!important; height:84vh!important;
              z-index:9999!important;
            }
          `);
        });
      }
    }

    /* in quiz mode: hide drawing tools + canvas + stage overlays */
    const annoBar = $('cntAnnoBar');
    const canvas  = $('cntCanvas');
    const exitBtn = $('cntExit');
    const counter = $('cntCounter');
    const pnav    = document.querySelector('.cnt-pnav');
    const isQuiz      = item.type === 'quiz';
    const isYoutube    = getMeta(item).kind === 'youtube';
    const isWhiteboard = item.type === 'whiteboard';
    const hideTools = isQuiz || isYoutube || isWhiteboard;
    const _applyQuizMode = () => {
      if (annoBar) annoBar.style.display = hideTools ? 'none' : '';
      if (canvas)  canvas.style.display  = hideTools ? 'none' : '';
      if (exitBtn) exitBtn.style.display  = isQuiz ? 'none' : '';
      if (counter) counter.style.display  = isQuiz ? 'none' : '';
      /* the embedded whiteboard has its own fullscreen button sitting at the
         top-left of its topbar — move the exit button to the opposite
         corner so the two don't overlap */
      if (exitBtn) exitBtn.classList.toggle('cnt-exit-right', isWhiteboard);
      /* pnav (thumbnail strip) stays visible — user needs it to navigate between slides */
    };
    _applyQuizMode();
    /* re-apply after fullscreen exit (Electron resets some styles) */
    if (isQuiz) {
      const _fsHandler = () => { if (!document.fullscreenElement) _applyQuizMode(); };
      document.removeEventListener('fullscreenchange', window._quizFsHandler);
      window._quizFsHandler = _fsHandler;
      document.addEventListener('fullscreenchange', _fsHandler);
    }

    /* restore drawings on image/video/whiteboard slides (PDF restores itself in renderPdfJs) */
    const st = _slideState[activeIndex];
    if (st && st.kind === 'canvas') {
      strokes = JSON.parse(JSON.stringify(st.strokes));
      redrawCanvas();
    }
  }

  function buildViewer(item) {
    const meta = getMeta(item);
    const base = 'http://localhost:5000';

    switch (meta.kind) {
      case 'image':
        return `<img src="${base}${item.path}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;user-select:none" draggable="false">`;

      case 'image-url':
        return `<img src="${item.url}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;user-select:none" draggable="false">`;

      case 'video':
        return `<video controls src="${base}${item.path}" style="max-width:100%;max-height:100%;border-radius:4px;outline:none" controlslist="nodownload"></video>`;

      case 'youtube': {
        const id = ytId(item.url);
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
        return `<webview id="yt-webview-${id}" src="https://www.youtube.com/watch?v=${id}&hl=ar" useragent="${ua}" style="width:100%;height:100%;border-radius:4px"></webview>`;
      }

      case 'vimeo': {
        const id = item.url.split('/').filter(Boolean).pop();
        return `<iframe src="https://player.vimeo.com/video/${id}" style="width:100%;height:100%;border:none;border-radius:4px" allowfullscreen></iframe>`;
      }

      case 'web':
        return `<iframe src="${item.url}" style="width:100%;height:100%;border:none;border-radius:4px" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`;

      case 'pdf':
        setTimeout(() => renderPdfJs(`${base}${item.path}`), 0);
        return `<div id="pdfjsWrap" style="width:100%;height:100%;overflow-y:auto;overflow-x:hidden;background:#525659;box-sizing:border-box;padding:24px 0">
          <div id="pdfjsPages" style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:0 24px"></div>
        </div>`;

      case 'whiteboard':
        /* full interactive whiteboard (shapes, camera, recording, etc.) embedded
           directly in the slide — its own toolbar replaces the lightweight
           anno-bar for this slide type (see hideTools in renderCurrentSlide) */
        return `<iframe src="/pages/whiteboard-standalone.html" style="width:100%;height:100%;border:none;border-radius:4px;background:#fff"></iframe>`;

      case 'quiz':
        setTimeout(() => renderQuizPlayer(item), 0);
        return `<div class="cnt-quiz-player" id="cntQuizPlayer"><div style="color:rgba(255,255,255,.4);font-size:13px">جارٍ تحميل الاختبار...</div></div>`;

      default:
        return `<div style="color:#fff;text-align:center;padding:60px"><i class="ti ti-file" style="font-size:64px;opacity:.3"></i><p style="margin-top:16px;opacity:.5">${itemName(item)}</p></div>`;
    }
  }

  function renderThumbStrip() {
    if (!activeLesson) return;
    const strip   = $('cntThumbStrip');
    const content = activeLesson.lesson.content;
    strip.innerHTML = content.map((item, i) => {
      const meta = getMeta(item);
      let inner, pdfAttr = '';
      if (meta.kind === 'image') {
        inner = `<img src="http://localhost:5000${item.path}" style="width:100%;height:100%;object-fit:cover">`;
      } else if (meta.kind === 'pdf' && item.path) {
        inner = '';   /* filled async with the page preview below */
        pdfAttr = ` data-pdf-url="http://localhost:5000${item.path}"`;
      } else if (meta.kind === 'youtube' || meta.kind === 'vimeo' || meta.kind === 'video') {
        inner = `<span style="font-size:15px;color:#fff">▶</span>`;
      } else {
        inner = `<span style="font-size:11px;color:#fff;font-weight:700">${meta.label}</span>`;
      }
      return `<div class="cnt-thumb${i === activeIndex ? ' active' : ''}" data-idx="${i}" title="${itemName(item)}">
        <div class="cnt-thumb-inner" style="background:${meta.color}"${pdfAttr}>${inner}</div>
        <span>${i + 1}</span>
      </div>`;
    }).join('');

    /* load PDF page previews asynchronously */
    strip.querySelectorAll('.cnt-thumb-inner[data-pdf-url]').forEach(async el => {
      const dataUrl = await getPdfThumb(el.dataset.pdfUrl);
      if (!dataUrl) return;
      el.style.background = '#fff';
      el.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover">`;
    });

    strip.querySelectorAll('.cnt-thumb').forEach(t => {
      t.addEventListener('click', () => {
        activeIndex = +t.dataset.idx;
        renderCurrentSlide();
      });
    });
  }

  function wirePresent() {
    $('cntExit')?.addEventListener('click', hidePresent);

    $('cntPrev')?.addEventListener('click', () => {
      if (!activeLesson) return;
      activeIndex = Math.max(0, activeIndex - 1);
      renderCurrentSlide();
    });
    $('cntNext')?.addEventListener('click', () => {
      if (!activeLesson) return;
      activeIndex = Math.min(activeLesson.lesson.content.length - 1, activeIndex + 1);
      renderCurrentSlide();
    });

    document.addEventListener('keydown', e => {
      if ($('cntPresent')?.style.display === 'none') return;
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'Escape') { hidePresent(); return; }
      const len = activeLesson?.lesson.content.length || 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp')
        { activeIndex = Math.max(0, activeIndex - 1); renderCurrentSlide(); }
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown')
        { activeIndex = Math.min(len - 1, activeIndex + 1); renderCurrentSlide(); }
    });

    $('cntFullscreen')?.addEventListener('click', async () => {
      if (!document.fullscreenElement) {
        await $('cntPresent')?.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    });
    document.addEventListener('fullscreenchange', () => {
      const on  = !!document.fullscreenElement;
      const btn = $('cntFullscreen');
      if (btn) {
        btn.querySelector('.fs-icon-expand').style.display = on  ? 'none' : '';
        btn.querySelector('.fs-icon-shrink').style.display = on  ? ''     : 'none';
        btn.title = on ? 'خروج من ملء الشاشة' : 'ملء الشاشة';
      }
      resizeCanvas();
      _resizePdfViewer();   /* resize PDF iframe + canvas to new stage size */
    });
  }

  /* ═══════════════════════════════════
     ANNOTATION
     ═══════════════════════════════════ */
  function resetAnno() {
    annoMode = false; drawing = false; curStroke = null;
    canvas?.classList.remove('drawing');
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
    clearCanvas();
  }

  function resizeCanvas() {
    if (!canvas) return;
    const stage = $('cntStage');
    if (!stage) return;
    canvas.width  = stage.clientWidth;
    canvas.height = stage.clientHeight;
    redrawCanvas();
  }

  /* clear the LIVE drawing surface only — does NOT touch saved per-slide state,
     so switching slides preserves drawings. The Clear button wipes state separately. */
  function clearCanvas() {
    strokes = []; curStroke = null;
    ctx?.clearRect(0, 0, canvas?.width || 0, canvas?.height || 0);
    pdfStrokes = {};
    const annoCvs = document.getElementById('pdfjsAnnoCanvas');
    if (annoCvs) annoCvs.getContext('2d')?.clearRect(0, 0, annoCvs.width, annoCvs.height);
  }

  /* convert screen coords → content coords (for non-PDF cnt-canvas) */
  function toContent(vx, vy) {
    return { x: (vx - panX) / zoom, y: (vy - panY) / zoom };
  }

  /* redraw non-PDF strokes on cnt-canvas */
  function redrawCanvas() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    for (const s of strokes) _drawStroke(s);
    if (curStroke) _drawStroke(curStroke);
    ctx.restore();
  }

  const SHAPE_TOOLS = new Set(['line', 'arrow', 'rect', 'circle']);

  /* custom per-tool cursors — same idea as the standalone whiteboard: a small
     SVG icon with a hotspot at the actual drawing point, instead of a single
     generic crosshair for every tool. */
  function _svgCursor(svgBody, w, h, hx, hy) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svgBody}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}`;
  }
  const _CURSOR_MAP = {
    pen: _svgCursor(
      `<g transform="rotate(45 16 16)"><path d="M14 3a2 2 0 0 1 4 0v16l-2 5-2-5Z" fill="#3b82f6" stroke="#1e3a8a" stroke-width="1"/></g>`,
      32, 32, 4, 28) + ', crosshair',
    highlighter: _svgCursor(
      `<rect x="3" y="12" width="20" height="10" rx="2" fill="#eab308" opacity=".55" stroke="#a16207" stroke-width="1"/>`,
      28, 28, 4, 17) + ', crosshair',
    erase: _svgCursor(
      `<rect x="4" y="10" width="20" height="12" rx="3" fill="#fff" stroke="#f43f5e" stroke-width="2"/><line x1="4" y1="16" x2="24" y2="16" stroke="#f43f5e" stroke-width="1.5"/>`,
      28, 28, 14, 16) + ', cell',
    pointer: 'none', // the laser dot itself already shows position
    line:   _svgCursor(`<line x1="4" y1="20" x2="20" y2="4" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>`, 24, 24, 4, 20) + ', crosshair',
    arrow:  _svgCursor(`<line x1="4" y1="20" x2="20" y2="4" stroke="#f97316" stroke-width="2.5" stroke-linecap="round"/><path d="M20 4 12 6l6 6Z" fill="#f97316"/>`, 24, 24, 4, 20) + ', crosshair',
    rect:   _svgCursor(`<rect x="3" y="6" width="18" height="14" rx="2" fill="none" stroke="#0ea5e9" stroke-width="2.5"/>`, 24, 24, 3, 6) + ', crosshair',
    circle: _svgCursor(`<circle cx="12" cy="12" r="9" fill="none" stroke="#14b8a6" stroke-width="2.5"/>`, 24, 24, 3, 3) + ', crosshair',
  };
  function _cursorForTool(t) { return _CURSOR_MAP[t] || 'crosshair'; }

  function _drawStroke(s) {
    if (s.pts.length < 2) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = s.alpha;
    ctx.strokeStyle = s.color;
    ctx.lineWidth   = s.lw;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    const lw = s.lw;
    if (s.dash === 'dashed') ctx.setLineDash([lw * 3, lw * 2]);
    else if (s.dash === 'dotted') ctx.setLineDash([lw, lw * 2]);
    else ctx.setLineDash([]);
    ctx.beginPath();

    if (s.tool === 'line') {
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      ctx.lineTo(s.pts[s.pts.length - 1].x, s.pts[s.pts.length - 1].y);
      ctx.stroke();
    } else if (s.tool === 'arrow') {
      const p1 = s.pts[0], p2 = s.pts[s.pts.length - 1];
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const hw = Math.max(8, s.lw * 4);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - hw * Math.cos(angle - Math.PI / 7), p2.y - hw * Math.sin(angle - Math.PI / 7));
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - hw * Math.cos(angle + Math.PI / 7), p2.y - hw * Math.sin(angle + Math.PI / 7));
      ctx.stroke();
    } else if (s.tool === 'rect') {
      const p1 = s.pts[0], p2 = s.pts[s.pts.length - 1];
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    } else if (s.tool === 'circle') {
      const p1 = s.pts[0], p2 = s.pts[s.pts.length - 1];
      const rx = (p2.x - p1.x) / 2, ry = (p2.y - p1.y) / 2;
      ctx.ellipse(p1.x + rx, p1.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /* position a sub-popup above/below its trigger button */
  function _placePopup(popup, triggerBtn) {
    popup.style.visibility = 'hidden';
    popup.hidden = false;
    requestAnimationFrame(() => {
      const r   = triggerBtn.getBoundingClientRect();
      const pw  = popup.offsetWidth;
      const ph  = popup.offsetHeight;
      let left  = r.left + r.width / 2 - pw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
      const top = r.top > ph + 12 ? r.top - ph - 8 : r.bottom + 8;
      popup.style.left = `${left}px`;
      popup.style.top  = `${top}px`;
      popup.style.visibility = '';
    });
  }

  function _closeAllSubPopups(except) {
    ['cntShapesPopup','cntPalettePopup','cntLwPopup'].forEach(id => {
      if (id !== except) { const el = $(id); if (el) el.hidden = true; }
    });
  }

  const SHAPE_SVGS = {
    line:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="20" x2="20" y2="4"/></svg>`,
    arrow:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></svg>`,
    rect:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/></svg>`,
    circle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`,
  };

  function _wireShapesPopup(annoBar) {
    const btn = $('cntShapesBtn'), popup = $('cntShapesPopup'), icon = $('cntShapeIcon');
    if (!btn || !popup) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const wasHidden = popup.hidden;
      _closeAllSubPopups('cntShapesPopup');
      popup.hidden = !wasHidden;
    });
    popup.querySelectorAll('.cnt-sub-item').forEach(item => {
      item.addEventListener('click', () => {
        const shape = item.dataset.shape;
        popup.querySelectorAll('.cnt-sub-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        activeShape = shape;
        btn.innerHTML = SHAPE_SVGS[shape];
        // activate shape tool
        annoBar.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tool = shape; annoMode = true; _removePointer();
        if (canvas) canvas.style.cursor = _cursorForTool(tool);
        _syncPdfAnnoMode();
        popup.hidden = true;
      });
    });
  }

  function _wirePalettePopup(annoBar) {
    const btn = $('cntColorBtn'), popup = $('cntPalettePopup'), swatch = $('cntColorSwatch');
    if (!btn || !popup) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const wasHidden = popup.hidden;
      _closeAllSubPopups('cntPalettePopup');
      popup.hidden = !wasHidden;
    });
    popup.querySelectorAll('.cnt-pal-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        popup.querySelectorAll('.cnt-pal-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        color = dot.dataset.color;
        if (swatch) swatch.style.background = color;
        popup.hidden = true;
      });
    });
    const customInput = $('cntCustomColor');
    if (customInput) {
      customInput.addEventListener('input', () => {
        color = customInput.value;
        if (swatch) swatch.style.background = color;
        popup.querySelectorAll('.cnt-pal-dot').forEach(d => d.classList.remove('active'));
      });
    }
  }

  function _wireLwPopup() {
    const btn = $('cntLwBtn'), popup = $('cntLwPopup');
    if (!btn || !popup) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const wasHidden = popup.hidden;
      _closeAllSubPopups('cntLwPopup');
      popup.hidden = !wasHidden;
    });
    popup.querySelectorAll('[data-lw]').forEach(item => {
      item.addEventListener('click', () => {
        popup.querySelectorAll('[data-lw]').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        strokeWidth = parseInt(item.dataset.lw);
        popup.hidden = true;
      });
    });
    popup.querySelectorAll('[data-dash]').forEach(item => {
      item.addEventListener('click', () => {
        popup.querySelectorAll('[data-dash]').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        strokeDash = item.dataset.dash;
        popup.hidden = true;
      });
    });
  }

  /* close popups on outside click */
  document.addEventListener('click', () => _closeAllSubPopups(null));

  /* erase strokes that pass within radius of pt (content coords) */
  function eraseNear(pt) {
    const r = 14 / zoom;
    strokes = strokes.filter(s => !s.pts.some(p => Math.hypot(p.x - pt.x, p.y - pt.y) < r));
    redrawCanvas();
  }

  function wireAnno() {
    /* ── Anno bar buttons (always wire, no canvas dependency) ── */
    const annoBar = $('cntAnnoBar');
    if (annoBar && !annoBar._wired) {
      annoBar._wired = true;
      annoBar.addEventListener('click', e => {
        const toolBtn = e.target.closest('[data-tool]');
        if (toolBtn) {
          if (toolBtn.classList.contains('active')) {
            toolBtn.classList.remove('active');
            annoMode = false; drawing = false;
            canvas?.classList.remove('drawing');
            if (canvas) canvas.style.cursor = '';
            _removePointer();
          } else {
            annoBar.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
            toolBtn.classList.add('active');
            tool = toolBtn.dataset.tool;
            if (tool === 'pointer') { annoMode = false; _initPointer(); }
            else { annoMode = true; _removePointer(); }
            if (canvas) canvas.style.cursor = _cursorForTool(tool);
          }
          _syncPdfAnnoMode();
          return;
        }
        if (e.target.closest('#cntClear')) { clearCanvas(); delete _slideState[activeIndex]; }
        if (e.target.closest('#cntUndo')) {
          if (strokes.length) { strokes.pop(); redrawCanvas(); }
        }
      });

      /* collapse / expand */
      $('cntAnnoCollapse')?.addEventListener('click', e => {
        e.stopPropagation();
        annoBar.classList.toggle('collapsed');
      });

      /* orient toggle */
      $('cntAnnoOrient')?.addEventListener('click', e => {
        e.stopPropagation();
        annoBar.classList.toggle('vertical');
        localStorage.setItem('cnt_anno_orient', annoBar.classList.contains('vertical') ? 'v' : 'h');
      });
      if (localStorage.getItem('cnt_anno_orient') === 'v') annoBar.classList.add('vertical');

      _wireShapesPopup(annoBar);
      _wirePalettePopup(annoBar);
      _wireLwPopup(annoBar);
      _wireQuickTools();
      _wireAnnoBarDrag(annoBar);
    }

    /* ── Canvas drawing (lazy-init when present) ── */
    canvas = $('cntCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    window.addEventListener('resize', resizeCanvas);

    canvas.addEventListener('pointerdown', e => {
      if (!annoMode) return;
      drawing = true;
      const pt = toContent(e.offsetX, e.offsetY);
      if (tool === 'erase') {
        curStroke = null;
        eraseNear(pt);
      } else {
        curStroke = {
          tool, color,
          alpha: tool === 'highlighter' ? 0.38 : 1,
          lw: tool === 'highlighter' ? 20 : (strokeWidth || 3),
          dash: strokeDash || 'solid',
          pts: [pt, { ...pt }]
        };
        strokes.push(curStroke);
        redrawCanvas();
      }
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      const pt = toContent(e.offsetX, e.offsetY);
      if (tool === 'erase') { eraseNear(pt); return; }
      if (curStroke) {
        if (SHAPE_TOOLS.has(tool)) {
          curStroke.pts[curStroke.pts.length - 1] = pt; // update end point only
        } else {
          curStroke.pts.push(pt);
        }
        redrawCanvas();
      }
    });
    canvas.addEventListener('pointerup',    () => { drawing = false; curStroke = null; });
    canvas.addEventListener('pointercancel',() => { drawing = false; curStroke = null; });
  }

  /* open a classroom tool window (timer / wheel / numbers) via Electron IPC */
  function _openQuickTool(tool) {
    try {
      if (tool === 'wheel' && window.api?.openWheelWindow) { window.api.openWheelWindow(); return; }
      if (window.api?.openToolWindow) { window.api.openToolWindow(tool); return; }
    } catch (err) { console.error('quick tool error', err); }
  }

  /* quick-tools shortcut button + popup in the presentation toolbar */
  function _wireQuickTools() {
    const btn  = $('cntQuickTools');
    const menu = $('cntQtMenu');
    if (!btn || !menu) return;

    const place = () => {
      const r = btn.getBoundingClientRect();
      /* prefer to the right of the button; flip left if it would overflow */
      let left = r.right + 8;
      if (left + 180 > window.innerWidth) left = r.left - 188;
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top  = `${Math.max(8, Math.min(r.top, window.innerHeight - 150))}px`;
    };

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (menu.hidden) { place(); menu.hidden = false; }
      else menu.hidden = true;
    });
    menu.addEventListener('click', e => {
      const item = e.target.closest('[data-qt]');
      if (!item) return;
      _openQuickTool(item.dataset.qt);
      menu.hidden = true;
    });
    document.addEventListener('click', e => {
      if (menu.hidden) return;
      if (e.target.closest('#cntQtMenu') || e.target.closest('#cntQuickTools')) return;
      menu.hidden = true;
    });
  }

  /* laser pointer — shows a red dot that follows the mouse on the stage */
  function _initPointer() {
    const stage = $('cntStage');
    if (!stage || stage._pointerDot) return;
    const dot = document.createElement('div');
    dot.className = 'cnt-laser-dot';
    stage.appendChild(dot);
    stage._pointerDot = dot;
    stage._pointerMove = e => {
      const r = stage.getBoundingClientRect();
      dot.style.left = (e.clientX - r.left) + 'px';
      dot.style.top  = (e.clientY - r.top)  + 'px';
      dot.style.opacity = '1';
    };
    stage._pointerLeave = () => { dot.style.opacity = '0'; };
    stage.addEventListener('mousemove',  stage._pointerMove);
    stage.addEventListener('mouseleave', stage._pointerLeave);
  }
  function _removePointer() {
    const stage = $('cntStage');
    if (!stage) return;
    if (stage._pointerMove)  stage.removeEventListener('mousemove',  stage._pointerMove);
    if (stage._pointerLeave) stage.removeEventListener('mouseleave', stage._pointerLeave);
    stage._pointerDot?.remove();
    delete stage._pointerDot;
    delete stage._pointerMove;
    delete stage._pointerLeave;
  }

  /* drag the annotation toolbar anywhere inside the stage via its grip */
  function _wireAnnoBarDrag(bar) {
    const grip = $('cntAnnoGrip');
    if (!grip) return;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;

    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      const stage = $('cntStage');
      const br = bar.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      ox = br.left - sr.left;          /* current offset within the stage */
      oy = br.top  - sr.top;
      bar.classList.add('dragged');
      bar.style.transform = 'none';
      bar.style.bottom    = 'auto';
      bar.style.left = `${ox}px`;
      bar.style.top  = `${oy}px`;
      grip.setPointerCapture(e.pointerId);
    });

    grip.addEventListener('pointermove', e => {
      if (!dragging) return;
      const stage = $('cntStage');
      const sr = stage.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      let nx = ox + (e.clientX - sx);
      let ny = oy + (e.clientY - sy);
      nx = Math.max(0, Math.min(nx, sr.width  - br.width));
      ny = Math.max(0, Math.min(ny, sr.height - br.height));
      bar.style.left = `${nx}px`;
      bar.style.top  = `${ny}px`;

      /* auto-orient: vertical when mouse is in the left/right 20% of stage */
      const mouseRelX = (e.clientX - sr.left) / sr.width;
      const shouldBeVertical = mouseRelX < 0.2 || mouseRelX > 0.8;
      if (shouldBeVertical !== bar.classList.contains('vertical')) {
        bar.classList.toggle('vertical', shouldBeVertical);
        localStorage.setItem('cnt_anno_orient', shouldBeVertical ? 'v' : 'h');
      }
    });

    const end = () => { dragging = false; };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  /* ═══════════════════════════════════
     PDF ANNOTATION (per-page canvases)
     ═══════════════════════════════════ */

  /* anno ON  → pdf canvas captures pointer events (drawing mode)
     anno OFF → pdf canvas transparent; scroll passes through to pdfjsWrap */
  function _syncPdfAnnoMode() {
    if (canvas) {
      if (annoMode && !$('pdfjsWrap')) canvas.classList.add('drawing');
      else canvas.classList.remove('drawing');
    }
    const annoCvs = document.getElementById('pdfjsAnnoCanvas');
    if (annoCvs) {
      /* always capture: pen ON → draw (1 finger) / pan+zoom (2 fingers);
         pen OFF → 1-finger pan, 2-finger pan+zoom. */
      annoCvs.style.pointerEvents = 'all';
      annoCvs.style.cursor        = annoMode ? _cursorForTool(tool) : 'grab';
    }
  }

  /* render PDF page n into the page canvas, size the anno canvas to match,
     then redraw saved strokes. baseScale fits page width; multiplied by zoom. */
  async function _renderPdfPage(n) {
    if (!_pdfDoc) return;
    const stage     = $('cntStage');
    const pageWrap  = $('pdfjsPageWrap');
    const pdfCanvas = document.getElementById('pdfjsPageCanvas');
    const annoCvs   = document.getElementById('pdfjsAnnoCanvas');
    if (!stage || !pageWrap || !pdfCanvas || !annoCvs) return;

    const page = await _pdfDoc.getPage(n);
    const dpr  = window.devicePixelRatio || 1;
    const maxW = Math.max(stage.clientWidth - 120, 400);   /* room for left toolbar */
    const vp1  = page.getViewport({ scale: 1 });
    const base = (maxW / vp1.width) * zoom;
    const cssW = Math.round(vp1.width  * base);
    const cssH = Math.round(vp1.height * base);

    /* CSS footprint of the page */
    pageWrap.style.width  = `${cssW}px`;
    pageWrap.style.height = `${cssH}px`;

    /* render PDF crisply at device pixel ratio */
    pdfCanvas.width  = Math.round(cssW * dpr);
    pdfCanvas.height = Math.round(cssH * dpr);

    if (_pdfRenderTask) { try { _pdfRenderTask.cancel(); } catch {} }
    _pdfRenderTask = page.render({
      canvasContext: pdfCanvas.getContext('2d'),
      viewport: page.getViewport({ scale: base * dpr }),
    });
    try { await _pdfRenderTask.promise; }
    catch (e) { if (e?.name === 'RenderingCancelledException') return; }
    _pdfRenderTask = null;

    /* anno canvas in CSS pixels (strokes stored normalised, so size-independent) */
    annoCvs.width  = cssW;
    annoCvs.height = cssH;
    _redrawPdfPage(annoCvs.getContext('2d'), n);
  }

  /* re-render current page (after fullscreen / window resize) */
  function _resizePdfViewer() {
    const stage = $('cntStage');
    const wrap  = $('pdfjsWrap');
    if (!stage || !_pdfDoc) return;
    if (wrap) wrap.style.height = `${stage.clientHeight - 60}px`;
    _renderPdfPage(_pdfCurrentPage);
  }

  /* navigate to PDF page n — render it, redraw its strokes, scroll to top */
  async function _pdfGoToPage(n) {
    if (!_pdfDoc || n < 1 || n > _pdfTotalPages) return;
    _pdfCurrentPage = n;
    const counter = document.getElementById('pdfPageCounter');
    if (counter) counter.textContent = `${n} / ${_pdfTotalPages}`;
    await _renderPdfPage(n);
    const wrap = $('pdfjsWrap');
    if (wrap) wrap.scrollTop = 0;
  }

  /* ── drawing — strokes stored in NORMALISED page coords (0..1) so they survive
     zoom, resize and re-render without distortion ── */
  function _redrawPdfPage(pCtx, pageNum) {
    const W = pCtx.canvas.width, H = pCtx.canvas.height;
    pCtx.clearRect(0, 0, W, H);
    for (const s of (pdfStrokes[pageNum] || [])) _drawStrokeOnCtx(pCtx, s, W, H);
  }

  function _drawStrokeOnCtx(ctx, s, W, H) {
    if (s.pts.length < 2) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = s.alpha;
    ctx.strokeStyle = s.color;
    ctx.lineWidth   = s.lwN * W;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    const lw = s.lwN * W;
    if (s.dash === 'dashed') ctx.setLineDash([lw * 3, lw * 2]);
    else if (s.dash === 'dotted') ctx.setLineDash([lw, lw * 2]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    const p1 = { x: s.pts[0].x * W, y: s.pts[0].y * H };
    const p2 = { x: s.pts[s.pts.length - 1].x * W, y: s.pts[s.pts.length - 1].y * H };
    if (s.tool === 'line') {
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    } else if (s.tool === 'arrow') {
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x), hw = Math.max(8, s.lwN * W * 4);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); ctx.beginPath();
      ctx.moveTo(p2.x, p2.y); ctx.lineTo(p2.x - hw * Math.cos(angle - Math.PI / 7), p2.y - hw * Math.sin(angle - Math.PI / 7));
      ctx.moveTo(p2.x, p2.y); ctx.lineTo(p2.x - hw * Math.cos(angle + Math.PI / 7), p2.y - hw * Math.sin(angle + Math.PI / 7));
      ctx.stroke();
    } else if (s.tool === 'rect') {
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    } else if (s.tool === 'circle') {
      const rx = (p2.x - p1.x) / 2, ry = (p2.y - p1.y) / 2;
      ctx.ellipse(p1.x + rx, p1.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.moveTo(s.pts[0].x * W, s.pts[0].y * H);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x * W, s.pts[i].y * H);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function _erasePdfNear(pCtx, pageNum, ptN) {
    const rN = 0.018;   /* eraser radius as fraction of page */
    if (pdfStrokes[pageNum]) {
      pdfStrokes[pageNum] = pdfStrokes[pageNum].filter(
        s => !s.pts.some(p => Math.hypot(p.x - ptN.x, p.y - ptN.y) < rN)
      );
    }
    _redrawPdfPage(pCtx, pageNum);
  }

  /* wire pointer events on the annotation canvas overlay.
     Touch model:
       • 1 finger + pen ON  → draw
       • 1 finger + pen OFF → pan (scroll the page)
       • 2 fingers (any)    → pan + pinch-zoom (never draws) */
  function _wirePdfAnnoCanvas(annoCvs) {
    const pCtx = annoCvs.getContext('2d');
    const pointers = new Map();          /* pointerId → {x,y} */
    let mode = null;                     /* 'draw' | 'pan' | 'gesture' */
    let pCurStroke = null;
    let panX0 = 0, panY0 = 0;
    let gesture = null;                  /* { startDist, startZoom, midX, midY, liveScale } */

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    /* normalised point in 0..1 of the page */
    function getPt(e) {
      const rect = annoCvs.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / (rect.width  || 1),
        y: (e.clientY - rect.top)  / (rect.height || 1),
      };
    }

    function startStroke(e) {
      const pg = _pdfCurrentPage;
      if (!pdfStrokes[pg]) pdfStrokes[pg] = [];
      const pt = getPt(e);
      if (tool === 'erase') { pCurStroke = null; _erasePdfNear(pCtx, pg, pt); return; }
      pCurStroke = {
        tool, color,
        alpha: tool === 'highlighter' ? 0.38 : 1,
        lwN:   tool === 'highlighter' ? 0.022 : 0.004,
        pts: [pt],
      };
      pdfStrokes[pg].push(pCurStroke);
      _redrawPdfPage(pCtx, pg);
    }

    function cancelStroke() {
      const pg = _pdfCurrentPage;
      const arr = pdfStrokes[pg];
      if (pCurStroke && arr && arr[arr.length - 1] === pCurStroke) arr.pop();
      pCurStroke = null;
      _redrawPdfPage(pCtx, pg);
    }

    annoCvs.addEventListener('pointerdown', e => {
      if (!$('pdfjsWrap')) return;
      e.stopPropagation();
      e.preventDefault(); /* some touch-overlay drivers still trigger a native
        scroll-into-view/bounce on contact even with touch-action:none set —
        this is what was causing the page to jump to the top mid-stroke */
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      annoCvs.setPointerCapture(e.pointerId);

      if (pointers.size === 2) {
        if (mode === 'draw') cancelStroke();      /* second finger → never a drawing */
        const [a, b] = [...pointers.values()];
        gesture = {
          startDist: dist(a, b) || 1,
          startZoom: zoom,
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
          liveScale: 1,
        };
        mode = 'gesture';
        return;
      }
      if (pointers.size > 2) return;

      if (annoMode) { mode = 'draw'; startStroke(e); }
      else          { mode = 'pan';  panX0 = e.clientX; panY0 = e.clientY; }
    });

    annoCvs.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const wrap = $('pdfjsWrap');

      if (mode === 'gesture' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        if (wrap) {                                /* two-finger pan */
          wrap.scrollTop  -= (midY - gesture.midY);
          wrap.scrollLeft -= (midX - gesture.midX);
        }
        gesture.midX = midX; gesture.midY = midY;
        gesture.liveScale = dist(a, b) / gesture.startDist;   /* live pinch preview */
        /* only show the zoom preview once the finger spread has actually
           changed meaningfully — a plain two-finger scroll naturally jitters
           the distance a little, and scaling the page for that makes panning
           feel broken/glitchy instead of a clean scroll */
        const pw = $('pdfjsPageWrap');
        if (pw) {
          pw.style.transformOrigin = 'center top';
          pw.style.transform = Math.abs(gesture.liveScale - 1) > 0.04 ? `scale(${gesture.liveScale})` : '';
        }
        return;
      }

      if (mode === 'draw') {
        const pg = _pdfCurrentPage;
        const pt = getPt(e);
        if (tool === 'erase') { _erasePdfNear(pCtx, pg, pt); return; }
        if (pCurStroke) { pCurStroke.pts.push(pt); _redrawPdfPage(pCtx, pg); }
        return;
      }

      if (mode === 'pan' && wrap) {
        wrap.scrollTop  -= (e.clientY - panY0);
        wrap.scrollLeft -= (e.clientX - panX0);
        panX0 = e.clientX; panY0 = e.clientY;
      }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);

      if (mode === 'gesture' && pointers.size < 2) {
        const pw = $('pdfjsPageWrap');
        if (pw) pw.style.transform = '';
        if (gesture && Math.abs(gesture.liveScale - 1) > 0.02) {   /* commit pinch crisply */
          zoom = Math.max(0.5, Math.min(4, gesture.startZoom * gesture.liveScale));
          const p = $('cntZoomPct'); if (p) p.textContent = Math.round(zoom * 100) + '%';
          _renderPdfPage(_pdfCurrentPage);
        }
        gesture = null;
        mode = null;                       /* ignore a leftover finger until it lifts */
      }
      if (pointers.size === 0) { mode = null; pCurStroke = null; }
    }
    annoCvs.addEventListener('pointerup',     endPointer);
    annoCvs.addEventListener('pointercancel', endPointer);

    /* mouse wheel still scrolls the page */
    annoCvs.addEventListener('wheel', e => {
      const wrap = $('pdfjsWrap');
      if (wrap) wrap.scrollTop += e.deltaY;
    }, { passive: true });
  }


  /* ═══════════════════════════════════
     ZOOM / PAN
     ═══════════════════════════════════ */
  /* Zoom uses transformOrigin:center so zooming always stays within stage bounds.
     Pan is clamped so no empty background ever shows around the content. */
  function _clampPan() {
    const stage = $('cntStage');
    if (!stage || zoom <= 1) { panX = 0; panY = 0; return; }
    const W = stage.clientWidth, H = stage.clientHeight;
    const maxPX = W * (zoom - 1) / 2;
    const maxPY = H * (zoom - 1) / 2;
    panX = Math.max(-maxPX, Math.min(maxPX, panX));
    panY = Math.max(-maxPY, Math.min(maxPY, panY));
  }

  function applyZoom() {
    const p = $('cntZoomPct');
    if (p) p.textContent = Math.round(zoom * 100) + '%';

    /* PDF mode: re-render the page at the new zoom (crisp, not CSS-scaled) */
    if ($('pdfjsWrap')) {
      _renderPdfPage(_pdfCurrentPage);
      return;
    }

    /* Non-PDF: CSS transform on cnt-viewer */
    const v = $('cntViewer');
    if (!v) return;
    _clampPan();
    v.style.transformOrigin = 'center center';
    v.style.transform = zoom === 1 && panX === 0 && panY === 0
      ? '' : `translate(${panX}px,${panY}px) scale(${zoom})`;
    redrawCanvas();
  }

  function resetZoom() {
    zoom = 1; panX = 0; panY = 0;
    const v = $('cntViewer');
    if (v) { v.style.transform = ''; v.style.transformOrigin = ''; }
    const p = $('cntZoomPct');
    if (p) p.textContent = '100%';
    if ($('pdfjsWrap') && _pdfDoc) _renderPdfPage(_pdfCurrentPage);
  }

  /* Keep the stage point (mx, my) fixed while changing zoom by factor.
     With transformOrigin:center, the formula is:
       panX_new = (mx - W/2) * (1 - nz/zoom) + panX * (nz/zoom) */
  function zoomTo(mx, my, factor) {
    const stage = $('cntStage');
    const nz = Math.max(0.25, Math.min(8, zoom * factor));
    if (stage) {
      const W = stage.clientWidth, H = stage.clientHeight;
      panX = (mx - W / 2) * (1 - nz / zoom) + panX * (nz / zoom);
      panY = (my - H / 2) * (1 - nz / zoom) + panY * (nz / zoom);
    }
    zoom = nz; applyZoom();
  }

  function wireZoom() {
    const stage = $('cntStage');
    if (!stage) return;

    const center = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
    $('cntZoomIn') ?.addEventListener('click', () => { const [cx, cy] = center(); zoomTo(cx, cy, 1.25); });
    $('cntZoomOut')?.addEventListener('click', () => { const [cx, cy] = center(); zoomTo(cx, cy, 1 / 1.25); });
    $('cntZoomPct')?.addEventListener('click', resetZoom);

    stage.addEventListener('wheel', e => {
      if (e.ctrlKey) {
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        zoomTo(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 1 / 1.1);
        return;
      }
      /* scroll over PDF viewer → pdfjsWrap handles it naturally (within-page scroll) */
      if (e.target.closest('#pdfjsWrap')) return;
      if (e.target.closest('iframe')) return;
      if (!activeLesson?.lesson.content?.length) return;
      e.preventDefault();
      const len = activeLesson.lesson.content.length;
      if (e.deltaY > 0) { if (activeIndex < len - 1) { activeIndex++; renderCurrentSlide(); } }
      else              { if (activeIndex > 0)         { activeIndex--; renderCurrentSlide(); } }
    }, { passive: false });

    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === '0') { e.preventDefault(); resetZoom(); }
    });

    /* touch: 2-finger pinch+pan, 1-finger pan (when not drawing) */
    let _t0 = null, _t1 = null, _z0 = 1, _px0 = 0, _py0 = 0, _mx0 = 0, _my0 = 0;
    let _drag = false, _dx0 = 0, _dy0 = 0, _dpx0 = 0, _dpy0 = 0;

    stage.addEventListener('touchstart', e => {
      if ($('pdfjsWrap')) return;            /* PDF handles its own touch on the anno canvas */
      if (e.touches.length >= 2) {
        e.preventDefault(); _drag = false;
        _t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        _t1 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
        _z0 = zoom; _px0 = panX; _py0 = panY;
        const r = stage.getBoundingClientRect();
        _mx0 = (_t0.x + _t1.x) / 2 - r.left;
        _my0 = (_t0.y + _t1.y) / 2 - r.top;
      } else if (e.touches.length === 1 && !annoMode) {
        _drag = true;
        _dx0 = e.touches[0].clientX; _dy0 = e.touches[0].clientY;
        _dpx0 = panX; _dpy0 = panY;
      }
    }, { passive: false });

    stage.addEventListener('touchmove', e => {
      if ($('pdfjsWrap')) return;            /* PDF handles its own touch on the anno canvas */
      if (e.touches.length >= 2 && _t0) {
        e.preventDefault();
        const a = e.touches[0], b = e.touches[1];
        const r  = stage.getBoundingClientRect();
        const d0 = Math.hypot(_t1.x - _t0.x, _t1.y - _t0.y);
        const d1 = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const nz = Math.max(0.15, Math.min(8, _z0 * (d1 / Math.max(d0, 1))));
        const mx = (a.clientX + b.clientX) / 2 - r.left;
        const my = (a.clientY + b.clientY) / 2 - r.top;
        const W = r.width, H = r.height;
        /* keep pinch midpoint fixed + add translation from finger movement */
        panX = (_mx0 - W/2) * (1 - nz/_z0) + _px0 * (nz/_z0) + (mx - _mx0);
        panY = (_my0 - H/2) * (1 - nz/_z0) + _py0 * (nz/_z0) + (my - _my0);
        zoom = nz; applyZoom();
      } else if (e.touches.length === 1 && _drag && !annoMode) {
        e.preventDefault();
        panX = _dpx0 + (e.touches[0].clientX - _dx0);
        panY = _dpy0 + (e.touches[0].clientY - _dy0);
        applyZoom();
      }
    }, { passive: false });

    stage.addEventListener('touchend', e => {
      if (e.touches.length < 2) { _t0 = null; _t1 = null; }
      if (e.touches.length === 0) _drag = false;
    });
  }



  /* ═══════════════════════════════════
     PDF viewer — PDF.js renders each page to a <canvas>; an annotation
     <canvas> sits on top inside the SAME scroll container, so drawings move
     with the page when scrolling. cMaps + standard fonts → Arabic renders right.
     ═══════════════════════════════════ */
  async function renderPdfJs(url) {
    pdfStrokes = {};
    _pdfCurrentPage = 1;
    _pdfUrl = url;
    zoom = 1;
    document.getElementById('pdfNavBar')?.remove();   /* drop stale bar from a previous slide */
    try {
      const pdfjsLib = await _loadPdfLib();
      /* reuse the already-parsed document when returning to this PDF — no re-download/parse */
      if (_pdfDocCache[url]) {
        _pdfDoc = _pdfDocCache[url];
      } else {
        _pdfDoc = await pdfjsLib.getDocument(_pdfDocOpts(url)).promise;
        _pdfDocCache[url] = _pdfDoc;
      }
      _pdfTotalPages = _pdfDoc.numPages;

      const container = $('pdfjsPages');
      if (!container) return;

      const stage = $('cntStage');
      stage?.classList.add('pdf-mode');   /* anno toolbar → left side */

      /* pdfjsWrap scrolls vertically; both canvases live inside it and scroll together */
      const wrap = $('pdfjsWrap');
      if (wrap) {
        wrap.style.overflowY = 'auto';
        wrap.style.overflowX = 'auto';   /* horizontal scroll appears when zoomed in */
        wrap.style.height    = `${(stage?.clientHeight || 700) - 60}px`;
        /* keep wheel inside the PDF (don't trigger slide nav); let ctrl+wheel bubble to zoom */
        wrap.addEventListener('wheel', e => { if (!e.ctrlKey) e.stopPropagation(); }, { passive: true });
      }

      /* ── page wrapper holds the rendered PDF canvas + the annotation canvas ── */
      const pageWrap = document.createElement('div');
      pageWrap.className = 'pdf-page-wrap';
      pageWrap.id = 'pdfjsPageWrap';

      const pdfCanvas = document.createElement('canvas');
      pdfCanvas.id = 'pdfjsPageCanvas';
      pdfCanvas.style.cssText = 'display:block;width:100%;height:100%;background:#fff';

      const annoCvs = document.createElement('canvas');
      annoCvs.id = 'pdfjsAnnoCanvas';
      annoCvs.className = 'anno-canvas';

      pageWrap.appendChild(pdfCanvas);
      pageWrap.appendChild(annoCvs);
      container.appendChild(pageWrap);

      /* page navigation bar — on the stage (outside scroll area) so it's always visible */
      const navBar = document.createElement('div');
      navBar.id = 'pdfNavBar';
      navBar.innerHTML = `
        <button id="pdfPrevPage">&#8249;</button>
        <span id="pdfPageCounter" style="direction:ltr">1 / ${_pdfTotalPages}</span>
        <button id="pdfNextPage">&#8250;</button>`;
      stage.appendChild(navBar);
      navBar.querySelector('#pdfPrevPage').addEventListener('click', () => _pdfGoToPage(_pdfCurrentPage - 1));
      navBar.querySelector('#pdfNextPage').addEventListener('click', () => _pdfGoToPage(_pdfCurrentPage + 1));

      _wirePdfAnnoCanvas(annoCvs);
      _syncPdfAnnoMode();

      if (!_restoreSlideState()) await _pdfGoToPage(1);
    } catch (err) {
      const wrap = $('pdfjsWrap');
      if (wrap) wrap.innerHTML = `<div style="color:rgba(255,255,255,.45);text-align:center;padding:60px 20px">
        <p style="margin-top:12px;font-size:16px">تعذّر تحميل الـ PDF</p>
        <small style="opacity:.7">${err.message}</small>
      </div>`;
    }
  }

  /* ── init ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
