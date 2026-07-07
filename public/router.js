// Hash router with dashboard-style home and subpages
(function(){
  console.log('Router.js loaded');
  const app = document.getElementById('app');
  let SERVER_API_KEY = null;

  // Initialize Security
  async function initSecurity() {
    if (window.api && window.api.getApiKey) {
      try {
        SERVER_API_KEY = await window.api.getApiKey();
        console.log('Security initialized');
      } catch (e) { console.error('Failed to get API key', e); }
    }
  }
  initSecurity();

  // Helper for authenticated fetch
  window.authFetch = async function(url, options = {}) {
    if (SERVER_API_KEY && url.startsWith('/api/')) {
      options.headers = {
        ...options.headers,
        'x-api-key': SERVER_API_KEY
      };
    }
    return fetch(url, options);
  }

  // Apply saved theme and language on page load
  async function applySavedSettings() {
    // 1) Apply theme from localStorage immediately (no wait) to avoid mismatch
    try {
      const lsTheme = localStorage.getItem('cm_theme');
      if (lsTheme) {
        document.documentElement.setAttribute('data-theme', lsTheme);
      }
    } catch {}

    // 2) Fetch server settings (authoritative on language, and theme fallback)
    try {
      const response = await authFetch('/api/settings');
      if (response.ok) {
        const settings = await response.json();
        
        // Apply theme: prefer server if provided, else keep localStorage-applied or default
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const theme = settings.theme || currentTheme;
        document.documentElement.setAttribute('data-theme', theme);
        
        // Apply language and direction
        const language = settings.language || 'ar';
        const isArabic = language === 'ar';
        document.documentElement.lang = language;
        document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
        
        console.log('Settings applied:', { theme, language });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      // Apply default settings if loading fails (keep theme as-is)
      if (!document.documentElement.getAttribute('lang')) {
        document.documentElement.lang = 'ar';
      }
      if (!document.documentElement.getAttribute('dir')) {
        document.documentElement.dir = 'rtl';
      }
    }
  }

  // Apply settings on page load
  applySavedSettings();

  // Also initialize language from localStorage immediately to avoid FOUC
  try {
    const lang = localStorage.getItem('cm_language');
    if (lang) {
      const isArabic = lang === 'ar';
      document.documentElement.lang = lang;
      document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
    }
  } catch {}

  // Listen for theme and language changes broadcasted via localStorage to update all open pages/windows instantly
  window.addEventListener('storage', (e) => {
    if (e.key === 'cm_theme' && e.newValue) {
      document.documentElement.setAttribute('data-theme', e.newValue);
    }
    if (e.key === 'cm_language' && e.newValue) {
      const lang = e.newValue;
      const isArabic = lang === 'ar';
      document.documentElement.lang = lang;
      document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
    }
  });

  const pages = {
    '/': home,
    '/groups': () => fetchPageContent('/pages/groups.html'),
    '/quizzes': () => fetchPageContent('/pages/quizzes.html'),
    '/ai-generator': () => fetchPageContent('/pages/ai-generator.html'),
    '/competitions': () => fetchPageContent('/pages/competitions.html'),
    '/games': () => fetchPageContent('/pages/games.html'),
    '/content':     () => fetchPageContent('/pages/content.html'),
    '/whiteboard':  () => fetchPageContent('/pages/whiteboard.html'),
    '/settings': () => {
       if (window.openSettings) {
         window.openSettings();
         return;
       }
       const modal = document.getElementById('settingsModal');
       if (modal) {
         modal.classList.add('active');
         modal.style.display = 'flex';
         document.body.style.overflow = 'hidden';
       }
    },
    '/timer': () => fetchPageContent('/pages/timer.html'),
    '/wheel': () => fetchPageContent('/pages/wheel.html'),
    '/numbers': () => fetchPageContent('/pages/numbers.html'),
    '/names': () => fetchPageContent('/pages/names.html'),
    // Games Routes
    '/dino-arabic': () => fetchPageContent('/pages/dino-arabic.html'),
    '/grammar-hunter': () => fetchPageContent('/pages/grammar-hunter.html'),
    '/ethics-path': () => fetchPageContent('/pages/ethics-path.html'),
    '/million': () => fetchPageContent('/pages/million/million-settings.html'),
    '/basketball-quiz': () => fetchPageContent('/pages/basketball-quiz.html'),
    '/hero-attack': () => fetchPageContent('/pages/hero-attack.html'),
    '/dino-english': () => fetchPageContent('/pages/dino-english.html'),
    '/duck-race': () => fetchPageContent('/pages/duck-race.html'),
    '/game-geography-map': () => fetchPageContent('/pages/game_geography_map.html'),
    // Game Engine Routes
    '/external-game': () => fetchPageContent('/pages/external-game.html'),
    '/game-engine': () => fetchPageContent('/game-engine/launcher.html'),
    '/game-engine/word-match': () => fetchPageContent('/game-engine/games/word-match/word-match.html'),
    '/game-engine/edu-platformer': () => fetchPageContent('/game-engine/games/edu-platformer/edu-platformer.html'),
    '/game-engine/tug-quiz': () => fetchPageContent('/game-engine/games/tug-quiz/tug-quiz.html'),
    '/game-engine/spin-compete': () => fetchPageContent('/game-engine/games/spin-compete/spin-compete.html')
  };

  async function fetchPageContent(url) {
    try {
      app.innerHTML = '<div class="loading-spinner">جاري التحميل...</div>';

      // Remove previous dynamic page CSS to avoid style bleed
      const prevCss = document.getElementById('dynamic-page-css');
      if (prevCss) prevCss.remove();

      // Auto-load CSS for this page
      const cssUrl = url.replace('.html', '.css');
      const cssCheck = await fetch(cssUrl, { method: 'HEAD' }).catch(() => null);
      const cssType = cssCheck ? (cssCheck.headers.get('content-type') || '') : '';
      if (cssCheck && cssCheck.ok && cssType.includes('text/css')) {
        const link = document.createElement('link');
        link.id = 'dynamic-page-css';
        link.rel = 'stylesheet';
        link.href = cssUrl + '?t=' + Date.now();
        document.head.appendChild(link);
        await new Promise(resolve => { link.onload = resolve; link.onerror = resolve; setTimeout(resolve, 500); });
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error('Page not found');
      const html = await response.text();
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      if (url.startsWith('/pages/') && doc.querySelector('#appShell')) {
        throw new Error('Page not found');
      }
      
      // Try to find a main container or use body
      const content = doc.querySelector('main') || doc.querySelector('.container') || doc.body;
      
      app.innerHTML = content.innerHTML;

      // If the page has a game-container, enable full-height game mode
      if (app.querySelector('.game-container')) {
        document.body.classList.add('game-page');
      }
      
      // Re-apply translations and scripts if needed
      try { I18n.apply(app); } catch {}
      
      // Execute scripts from the fetched page (both head and body)
      const scripts = doc.querySelectorAll('script');
      for (const oldScript of scripts) {
        // Skip scripts that are already in the main index.html to avoid loops
        if (oldScript.src && (
          oldScript.src.includes('router.js') || 
          oldScript.src.includes('i18n.js') || 
          oldScript.src.endsWith('/settings.js') ||
          oldScript.src.includes('ux-improvements.js') ||
          oldScript.src.includes('performance.js')
        )) continue;

        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
        // Cache-bust page-local scripts (e.g. content.js) so edits show up on the
        // next navigation instead of being served from a stale cached copy —
        // matches the cache-busting already done for auto-loaded CSS/JS below.
        if (newScript.src && newScript.getAttribute('src').startsWith('/pages/')) {
          const sep = newScript.src.includes('?') ? '&' : '?';
          newScript.src = newScript.src + sep + 't=' + Date.now();
        }
        if (oldScript.innerHTML) {
          newScript.appendChild(document.createTextNode(oldScript.innerHTML));
        }
        
        // Wait for external scripts to load before continuing if possible
        if (oldScript.src) {
          await new Promise((resolve) => {
            newScript.onload = resolve;
            newScript.onerror = resolve;
            document.body.appendChild(newScript);
          });
        } else {
          document.body.appendChild(newScript);
        }
      }

      // Auto-load JS for this page (skip if already loaded via <script src> in the HTML)
      const jsUrl = url.replace('.html', '.js');
      const alreadyInHtml = Array.from(doc.querySelectorAll('script[src]')).some(s =>
        s.getAttribute('src') === jsUrl || s.src.endsWith(jsUrl)
      );
      if (!alreadyInHtml) {
        const jsCheck = await fetch(jsUrl, { method: 'HEAD' }).catch(() => null);
        const jsType = jsCheck ? (jsCheck.headers.get('content-type') || '') : '';
        if (jsCheck && jsCheck.ok && jsType.includes('javascript')) {
          const prevJs = document.getElementById('dynamic-page-js');
          if (prevJs) prevJs.remove();
          const script = document.createElement('script');
          script.id = 'dynamic-page-js';
          script.src = jsUrl + '?t=' + Date.now();
          await new Promise(resolve => { script.onload = resolve; script.onerror = resolve; document.body.appendChild(script); });
        }
      }

    } catch (error) {
      console.error('Fetch error:', error);
      app.innerHTML = `<div class="error-msg">حدث خطأ أثناء تحميل الصفحة: ${error.message}</div>`;
    }
  }

  function updateActiveNavLink() {
    const hash = window.location.hash || '#/';
    document.querySelectorAll('.nav-item').forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === hash);
    });
  }

  function home(){
    console.log('Home function called');
    app.innerHTML = `
      <section class="home-v2">

        <!-- ── Hero (centred) ── -->
        <div class="hv2-hero">
          <div class="hv2-hero-inner">
            <div class="hv2-badge">منصة إدارة الصف التفاعلي</div>
            <h1 class="hv2-headline">حوّل فصلك إلى<br><span>تجربة لا تُنسى</span></h1>
            <p class="hv2-sub">ألعاب تعليمية، اختبارات تفاعلية، وذكاء اصطناعي —<br>كل ما تحتاجه في مكان واحد.</p>
            <div class="hv2-ctas">
              <a href="#/quizzes" class="hv2-btn-primary" id="homeCtaBtn">ابدأ أول اختبار ←</a>
              <a href="#/games" class="hv2-btn-secondary">استكشف الألعاب</a>
            </div>
          </div>
        </div>

        <!-- ── Stats Band ── -->
        <div class="hv2-stats-bar">
          <div class="hv2-stats-row">
            <div class="hv2-stat">
              <span class="hv2-stat-num" id="homeStatsStudents">—</span>
              <span class="hv2-stat-lbl">طالب مسجّل</span>
            </div>
            <div class="hv2-stat-divider"></div>
            <div class="hv2-stat">
              <span class="hv2-stat-num" id="homeStatsGroups">—</span>
              <span class="hv2-stat-lbl">مجموعة</span>
            </div>
            <div class="hv2-stat-divider"></div>
            <div class="hv2-stat">
              <span class="hv2-stat-num" id="homeStatsQuizzes">—</span>
              <span class="hv2-stat-lbl">اختبار</span>
            </div>
            <div class="hv2-stat-divider"></div>
            <div class="hv2-stat">
              <span class="hv2-stat-num" id="_heroGamesNum">...</span>
              <span class="hv2-stat-lbl">لعبة تعليمية</span>
            </div>
          </div>
        </div>

        <!-- ── Feature Cards ── -->
        <div class="hv2-features">
          ${featureCardV2('#/groups',     '#3b82f6', 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75', 'المجموعات والطلاب', 'أدر مجموعاتك واعرف أداء كل طالب بنظرة واحدة.',         'إدارة المجموعات', '#eff6ff', '#3b82f6', true)}
          ${featureCardV2('#/content',    '#14b8a6', 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z', 'المحتوى التعليمي',  'ارفع دروسك وعرضها بشكل احترافي داخل الفصل.',          'تصفح المحتوى',    '#f0fdfa', '#14b8a6')}
          ${featureCardV2('#/quizzes',    '#f97316', 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', 'الاختبارات',         'أنشئ اختبارات تفاعلية لحظية وتابع نتائج طلابك فوراً.',  'إنشاء اختبار',   '#fff7ed', '#f97316', true)}
          ${featureCardV2('#/competitions','#eab308','M8 21h8m-4-4v4M7 4H4v6a8 8 0 0 0 16 0V4h-3 M4 4a16 16 0 0 0 16 0',                                  'المسابقات',          'نظّم مسابقات بين الطلاب وتابع النتائج فورياً.',        'ابدأ مسابقة',     '#fefce8', '#eab308')}
          ${featureCardV2('#/games',      '#ec4899', 'M8 21h8m-4-4v4M7 4H4v6a8 8 0 0 0 16 0V4h-3 M4 4a16 16 0 0 0 16 0',                                 'الألعاب التعليمية',  '<span id="_gamesCountLabel">...</span> لعبة تفاعلية تحوّل المراجعة إلى تنافس ممتع.',       'ابدأ لعبة',       '#fdf2f8', '#ec4899')}
          ${featureCardV2('#/whiteboard', '#6366f1', 'M2 3h20v15H2z M8 21h8m-4-3v3 M7 8l3 3-3 3 M13 11h4',                                                   'السبورة التفاعلية', 'اشرح وارسم وكتّب على سبورة ذكية مع أدوات احترافية.',   'افتح السبورة',    '#eef2ff', '#6366f1')}
          <!-- ai-generator hidden temporarily -->
        </div>

      </section>
    `;

    try { I18n.apply(app); } catch {}
    loadHomeStats();
    updateGamesCount();
  }

  async function updateGamesCount() {
    try {
      const vis = await fetch('http://localhost:5000/api/games-visibility').then(r => r.ok ? r.json() : {}).catch(() => ({}));
      // 5 local cards actually rendered in #localGamesGrid on games.html
      // (dino-arabic, dino-english, duck-race, million, game-engine) — the
      // "ألعاب الإنترنت" hub tile is a navigation entry, not a game, so it's
      // excluded here too, matching the counting fix already applied there.
      const builtIn = 5;
      const onlineTotal = 22;

      const s = window.TRIAL_STATUS;
      const isTrial = s && s.trial && !s.licensed && !s.expired;
      let total;
      if (isTrial) {
        // A trial user can't actually reach the admin's full catalog — show
        // what's really unlocked for them (same numbers games.html enforces),
        // not the full total, which is what was showing "10" here regardless
        // of the trial's own games limit.
        const allowedLocal = Math.min(s.limits?.allowedGames ?? 3, builtIn);
        const enabledOnline = Object.values(vis).filter(v => v === true).length;
        total = allowedLocal + enabledOnline;
      } else {
        const disabledCount = Object.values(vis).filter(v => v === false).length;
        total = builtIn + (onlineTotal - disabledCount);
      }

      const el1 = document.getElementById('_gamesCountLabel');
      const el2 = document.getElementById('_heroGamesNum');
      if (el1) el1.textContent = total;
      if (el2) el2.textContent = total;
    } catch {}
  }

  function summaryCard(label, initialValue, icon, colorClass) {
    const idMap = {
      'إجمالي الألعاب التعليمية': 'homeStatsGames',
      'إجمالي الاختبارات': 'homeStatsQuizzes',
      'إجمالي المجموعات': 'homeStatsGroups',
      'إجمالي الطلاب': 'homeStatsStudents'
    };
    const id = idMap[label] || '';
    return `
      <div class="summary-card">
        <div class="summary-content">
          <span class="summary-label">${label}</span>
          <span class="summary-value" id="${id}">${initialValue}</span>
        </div>
        <div class="summary-icon-box ${colorClass}">
          <span class="summary-icon">${icon}</span>
        </div>
      </div>
    `;
  }

  function featureCard(href, icon, title, desc, btnText, colorClass) {
    return `
      <div class="feature-card">
        <div class="feature-header">
          <div class="feature-icon-box ${colorClass}">
            <span class="feature-icon">${icon}</span>
          </div>
          <h3 class="feature-title">${title}</h3>
          <p class="feature-desc">${desc}</p>
        </div>
        <a href="${href}" class="feature-btn">${btnText}</a>
      </div>
    `;
  }

  function featureCardV2(href, accentColor, svgPath, title, desc, btnText, bgColor, iconColor, featured = false) {
    return `
      <a href="${href}" class="fv2-card${featured ? ' fv2-featured' : ''}" style="--fv2-accent:${accentColor};--fv2-bg:${bgColor};--fv2-icon:${iconColor};">
        <div class="fv2-top-stripe"></div>
        <div class="fv2-icon-wrap">
          <svg width="${featured ? 32 : 28}" height="${featured ? 32 : 28}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${svgPath.split(' M').map((p,i)=>`<path d="${i===0?p:'M'+p}"/>`).join('')}
          </svg>
        </div>
        <h3 class="fv2-title">${title}</h3>
        <p class="fv2-desc">${desc}</p>
        <div class="fv2-btn">${btnText} ←</div>
      </a>
    `;
  }

  function subPageLink(href, icon, title, desc, btnText, colorClass) {
     return featureCard(href, icon, title, desc, btnText, colorClass);
  }

  function card(href, icon, title, desc, color){
    return `
    <a class="card" href="${href}" data-i18n-title="${desc ? '' : ''}" title="${desc || ''}">
      <div class="icon" style="background:${color}">${icon}</div>
      <div class="content">
        <h3 class="title">${title}</h3>
        ${desc ? `<p class="desc">${desc}</p>` : ''}
      </div>
    </a>`;
  }

  function settingsCard(){
    return `
    <div class="card settings-card" role="button" tabindex="0" aria-label="إعدادات البرنامج" title="إعدادات البرنامج والتخصيص">
      <div class="icon" style="background:#6b7280">⚙️</div>
      <div class="content">
        <h3 class="title">إعدادات البرنامج</h3>
      </div>
    </div>`;
  }

  const LS_GROUPS = 'cm_groups_v1';
  const LS_STUDENTS = 'cm_students_v1';
  const LS_QUIZZES = 'cm_quizzes_v1';

  function getLocalList(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async function loadHomeStats() {
    const studentsEl = document.getElementById('homeStatsStudents');
    const groupsEl = document.getElementById('homeStatsGroups');
    const quizzesEl = document.getElementById('homeStatsQuizzes');
    if (!studentsEl || !groupsEl || !quizzesEl) {
      return;
    }

    let groups = [];
    let quizzes = [];

    try {
      if (window.api && window.api.loadGroups) {
        groups = await window.api.loadGroups();
      } else {
        groups = getLocalList(LS_GROUPS);
      }
    } catch {
      groups = getLocalList(LS_GROUPS);
    }

    try {
      if (window.api && window.api.loadQuizzes) {
        quizzes = await window.api.loadQuizzes();
      } else {
        quizzes = getLocalList(LS_QUIZZES);
      }
    } catch {
      quizzes = getLocalList(LS_QUIZZES);
    }

    /* count only students that belong to current groups */
    const studentCount = Array.isArray(groups)
      ? groups.reduce((sum, g) => sum + (g.studentCount ?? g.studentsCount ?? 0), 0)
      : 0;
    const groupCount = Array.isArray(groups) ? groups.length : 0;
    const quizCount = Array.isArray(quizzes) ? quizzes.length : 0;

    studentsEl.textContent = studentCount;
    groupsEl.textContent = groupCount;
    quizzesEl.textContent = quizCount;

    const ctaBtn = document.getElementById('homeCtaBtn');
    if (ctaBtn && quizCount > 0) {
      ctaBtn.textContent = 'عرض الاختبارات ←';
    }
  }

  // Attach quick tools events
  // Action handler fires on ANY [data-qt] click anywhere in the document
  async function handleQtAction(tool) {
    try {
      if (tool === 'timer' && window.api?.openToolWindow) {
        await window.api.openToolWindow('timer'); return;
      }
      if (tool === 'wheel' && window.api?.openWheelWindow) {
        window.api.openWheelWindow(); return;
      }
      if (tool === 'numbers') {
        try {
          if (window.api?.openToolWindow) await window.api.openToolWindow('numbers');
          else if (window.api?.openNumbersWindow) await window.api.openNumbersWindow();
          else window.open('/pages/numbers-standalone.html', '_blank');
        } catch(_) { window.open('/pages/numbers-standalone.html', '_blank'); }
        return;
      }
      if (tool === 'names') {
        try {
          if (window.api?.openToolWindow) await window.api.openToolWindow('names');
          else window.open('/pages/names.html', '_blank');
        } catch (e) { window.open('/pages/names.html', '_blank'); }
        return;
      }
    } catch (err) { console.error('Quick tool error:', err); }
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-qt]');
    if (btn) handleQtAction(btn.getAttribute('data-qt'));
  });

  // Init a quick-tools toggle widget (supports multiple instances on page)
  window.initQtWidget = function initQtWidget(toggleEl, menuEl) {
    const placeMenu = () => {
      const r = toggleEl.getBoundingClientRect();
      menuEl.style.top   = `${r.bottom + 6}px`;
      menuEl.style.left  = 'auto';
      menuEl.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    };
    const setOpen = (open) => {
      if (open) placeMenu();
      menuEl.hidden = !open;
      toggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    toggleEl.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menuEl.hidden); });
    document.addEventListener('click', (e) => {
      if (!toggleEl.contains(e.target) && !menuEl.contains(e.target)) setOpen(false);
    });
    menuEl.addEventListener('click', (e) => { if (e.target.closest('[data-qt]')) setOpen(false); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Main header widget
    const qtToggle = document.getElementById('qtToggle');
    const qtMenu   = document.getElementById('qtMenu');
    if (qtToggle && qtMenu) initQtWidget(qtToggle, qtMenu);
  });

  function toolCard(toolName, icon, title, desc, color){
    return `
    <div class="card tool-card" onclick="openToolWindow('${toolName}')" style="cursor: pointer;" title="${desc}">
      <div class="icon" style="background:${color}">${icon}</div>
      <div class="content">
        <h3 class="title">${title}</h3>
      </div>
    </div>`;
  }

  function numbersCard(){
    return `
    <div class="card numbers-card" role="button" tabindex="0" aria-label="مولد الأرقام العشوائية" title="اختيار رقم واحد أو مجموعة أرقام بسهولة">
      <div class="icon" style="background:#0ea5e9">🔢</div>
      <div class="content">
        <h3 class="title">الأرقام العشوائية</h3>
      </div>
    </div>`;
  }

  function namesCard(){
    return `
    <div class="card names-card" role="button" tabindex="0" aria-label="اختيار الأسماء العشوائية" title="اختيار عشوائي للأسماء من المجموعات أو الإدخال اليدوي">
      <div class="icon" style="background:#fb923c">🎲</div>
      <div class="content">
        <h3 class="title">اختيار الأسماء</h3>
      </div>
    </div>`;
  }

  function timerCard(){
    return `
    <div class="card timer-card" role="button" tabindex="0" aria-label="المؤقت الذكي" title="مؤقت متطور مع واجهة عصرية">
      <div class="icon" style="background:#06b6d4">⏱️</div>
      <div class="content">
        <h3 class="title">المؤقت الذكي</h3>
      </div>
    </div>`;
  }



  function wheelStandaloneCard(){
    return `
    <div class="card wheel-standalone-card" role="button" tabindex="0" aria-label="عجلة الحظ - نافذة مستقلة" title="عجلة الحظ في نافذة منفصلة مع تحكم كامل">
      <div class="icon" style="background:#a855f7">🎡</div>
      <div class="content">
        <h3 class="title">عجلة الحظ المستقلة</h3>
      </div>
    </div>`;
  }


  let numbersModalState = null;











  function attachNumbersCardTriggers(){
    const cardElements = document.querySelectorAll('.numbers-card');
    cardElements.forEach((card) => {
      if (card.dataset.bound === 'true') return;
      card.dataset.bound = 'true';

      const trigger = async (event) => {
        event.preventDefault();
        // افتح دائماً نافذة مستقلة للأرقام؛ في حال عدم توفر Electron افتح تبويبًا جديدًا
        try {
          if (window.openToolWindow) {
            await window.openToolWindow('numbers');
            return;
          }
          if (window.api && window.api.openNumbersWindow) {
            await window.api.openNumbersWindow();
            return;
          }
          window.open('/pages/numbers-standalone.html', '_blank');
        } catch (_) {
          window.open('/pages/numbers-standalone.html', '_blank');
        }
      };

      card.addEventListener('click', trigger);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          trigger(event);
        }
      });
    });
  }



  function attachNamesCardTriggers(){
    const cardElements = document.querySelectorAll('.names-card');
    cardElements.forEach((card) => {
      if (card.dataset.bound === 'true') return;
      card.dataset.bound = 'true';

      const trigger = async (event) => {
        event.preventDefault();
        // افتح دائماً نافذة مستقلة؛ في حال عدم توفر Electron افتح في تبويب جديد
        try {
          const res = await (window.openToolWindow
            ? window.openToolWindow('names')
            : (window.api && window.api.openToolWindow ? window.api.openToolWindow('names') : null));
          if (!res || res.ok === false) {
            window.open('/pages/names.html', '_blank');
          }
        } catch (_) {
          window.open('/pages/names.html', '_blank');
        }
      };

      card.addEventListener('click', trigger);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          trigger(event);
        }
      });
    });
  }





  // Toast helper to show small hint/notification, supports optional action button
  function showNumbersToast(message, type = 'success', action){
    // Scope toast inside the modal card (not the document body)
    const container = numbersModalState && numbersModalState.modalCard ? numbersModalState.modalCard : document.body;
    let toast = container.querySelector('.numbers-toast');
    if (!toast){
      toast = document.createElement('div');
      toast.className = 'numbers-toast';
      const textSpan = document.createElement('span');
      textSpan.className = 'toast-text';
      toast.appendChild(textSpan);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-btn';
      btn.style.display = 'none';
      toast.appendChild(btn);
      container.appendChild(toast);
    }
    const textSpan = toast.querySelector('.toast-text');
    const btn = toast.querySelector('.action-btn');

    toast.className = `numbers-toast ${type}`;
    textSpan.textContent = message;

    // configure action button
    if (action && action.label && typeof action.onClick === 'function'){
      btn.textContent = action.label;
      btn.style.display = '';
      btn.onclick = () => {
        try { action.onClick(); } catch(_) {}
        toast.classList.remove('is-visible');
      };
    } else {
      btn.style.display = 'none';
      btn.onclick = null;
    }

    // show
    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });
    // hide after 2.6s if no action
    clearTimeout(showNumbersToast._t);
    if (!action){
      showNumbersToast._t = setTimeout(() => {
        toast.classList.remove('is-visible');
      }, 2600);
    }
  }

  function pickUniqueRandomNumbers(min, max, count){
    const availableNumbers = [];
    for (let i = min; i <= max; i++){
      availableNumbers.push(i);
    }

    const result = [];
    for (let i = 0; i < count; i++){
      const index = Math.floor(Math.random() * availableNumbers.length);
      result.push(availableNumbers.splice(index, 1)[0]);
    }
    return result;
  }

  function pickNoRepeatRandomNumbers(min, max, count, usedNumbers){
    const availableNumbers = [];
    for (let i = min; i <= max; i++){
      if (!usedNumbers.includes(i)) {
        availableNumbers.push(i);
      }
    }

    const result = [];
    for (let i = 0; i < count; i++){
      const index = Math.floor(Math.random() * availableNumbers.length);
      result.push(availableNumbers.splice(index, 1)[0]);
    }
    return result;
  }





  // Function to open tool in separate window
  window.openToolWindow = async function(toolName) {
    try {
      if (window.api && window.api.openToolWindow) {
        const result = await window.api.openToolWindow(toolName);
        return result || { ok: false };
      }
      // Web fallback
      window.open(`/pages/${toolName}.html`, '_blank');
      return { ok: true, fallback: 'web' };
    } catch (error) {
      console.error('Error opening tool window:', error);
      return { ok: false, error: error?.message };
    }
  };

  function subPage({title, desc}){
    app.innerHTML = `
      <div class="panel">
        <h2>${title}</h2>
        <p>${desc}</p>
        <div class="actions">
          <a class="btn" href="#/">العودة للرئيسية</a>
        </div>
      </div>
    `;
  }




  function toggleTimerForm(){
    if (!timerModalState) return;
    
    timerModalState.isCollapsed = !timerModalState.isCollapsed;
    const wrapper = timerModalState.formWrapper;
    const btn = timerModalState.collapseButton;
    
    if (timerModalState.isCollapsed) {
      wrapper.style.display = 'none';
      btn.innerHTML = '<span aria-hidden="true">⌃</span>';
      btn.setAttribute('aria-expanded', 'false');
    } else {
      wrapper.style.display = 'block';
      btn.innerHTML = '<span aria-hidden="true">⌄</span>';
      btn.setAttribute('aria-expanded', 'true');
    }
  }

  function toggleTimerFullscreen(){
    if (!timerModalState) return;
    
    timerModalState.isFullscreen = !timerModalState.isFullscreen;
    const card = timerModalState.modalCard;
    const display = timerModalState.display;
    const btn = timerModalState.fullscreenButton;
    
    if (timerModalState.isFullscreen) {
      card.classList.add('is-fullscreen');
      display.classList.add('is-fullscreen');
      btn.classList.add('is-active');
      
      // إخفاء عناصر الإعداد في وضع ملء الشاشة
      timerModalState.formWrapper.style.display = 'none';
      timerModalState.backdrop.querySelector('.timer-progress').style.display = 'none';
      
      // إظهار الأزرار والحالة في وضع ملء الشاشة
      const controls = timerModalState.backdrop.querySelector('.timer-controls');
      const status = timerModalState.backdrop.querySelector('.timer-status');
      if (controls) controls.style.display = 'flex';
      if (status) status.style.display = 'block';
    } else {
      card.classList.remove('is-fullscreen');
      display.classList.remove('is-fullscreen');
      btn.classList.remove('is-active');
      
      // إظهار عناصر التحكم
      if (!timerModalState.isCollapsed) {
        timerModalState.formWrapper.style.display = 'block';
      }
      timerModalState.backdrop.querySelector('.timer-controls').style.display = 'flex';
      timerModalState.backdrop.querySelector('.timer-progress').style.display = 'block';
    }
  }

  function updateTimerDisplay(){
    if (!timerModalState) return;
    
    const hours = parseInt(timerModalState.hoursInput.value) || 0;
    const minutes = parseInt(timerModalState.minutesInput.value) || 0;
    const seconds = parseInt(timerModalState.secondsInput.value) || 0;
    
    if (!timerIsRunning) {
      if (timerModalState.countType === 'countdown') {
        timerTotalSeconds = hours * 3600 + minutes * 60 + seconds;
        timerRemainingSeconds = timerTotalSeconds;
      } else {
        timerTotalSeconds = 0;
        timerRemainingSeconds = 0;
      }
    }
    
    let displayTime;
    if (timerModalState.countType === 'countdown') {
      displayTime = timerRemainingSeconds;
    } else {
      displayTime = timerTotalSeconds - timerRemainingSeconds;
    }
    
    const displayHours = Math.floor(Math.abs(displayTime) / 3600);
    const displayMinutes = Math.floor((Math.abs(displayTime) % 3600) / 60);
    const displaySeconds = Math.abs(displayTime) % 60;
    
    let timeString = '';
    if (displayHours > 0) {
      timeString = `${displayHours.toString().padStart(2, '0')}:${displayMinutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`;
    } else {
      timeString = `${displayMinutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`;
    }
    
    timerModalState.display.textContent = timeString;
    
    // تحديث شريط التقدم (للعد التنازلي فقط)
    if (timerModalState.countType === 'countdown' && timerTotalSeconds > 0) {
      const progress = ((timerTotalSeconds - timerRemainingSeconds) / timerTotalSeconds) * 100;
      timerModalState.progressBar.style.width = `${progress}%`;
    } else {
      timerModalState.progressBar.style.width = '0%';
    }
    
    // تحديث ألوان العرض (للعد التنازلي فقط)
    timerModalState.display.classList.remove('is-warning', 'is-danger');
    if (timerModalState.countType === 'countdown') {
      if (timerRemainingSeconds <= 10 && timerRemainingSeconds > 0) {
        timerModalState.display.classList.add('is-danger');
      } else if (timerRemainingSeconds <= 60 && timerRemainingSeconds > 10) {
        timerModalState.display.classList.add('is-warning');
      }
    }
  }

  function toggleTimer(){
    if (timerModalState.timerState === 'stopped') {
      startTimer();
    } else if (timerModalState.timerState === 'running') {
      pauseTimer();
    } else if (timerModalState.timerState === 'paused') {
      resumeTimer();
    }
  }

  function startTimer(){
    if (timerModalState.countType === 'countdown' && timerRemainingSeconds <= 0) {
      showTimerToast('يرجى تعيين وقت صحيح', 'error');
      return;
    }
    
    timerIsRunning = true;
    timerIsPaused = false;
    timerModalState.timerState = 'running';
    
    updateStartPauseButton();
    timerModalState.status.textContent = 'يعمل...';
    
    // طي تلقائي عند البدء
    if (!timerModalState.isCollapsed) {
      toggleTimerForm();
    }
    
    timerInterval = setInterval(() => {
      if (timerModalState.countType === 'countdown') {
        timerRemainingSeconds--;
        if (timerRemainingSeconds <= 0) {
          finishTimer();
          return;
        }
      } else {
        timerRemainingSeconds++;
      }
      updateTimerDisplay();
    }, 1000);
  }

  function pauseTimer(){
    clearInterval(timerInterval);
    timerIsPaused = true;
    timerModalState.timerState = 'paused';
    
    updateStartPauseButton();
    timerModalState.status.textContent = 'متوقف مؤقتاً';
  }

  function resumeTimer(){
    timerIsPaused = false;
    timerModalState.timerState = 'running';
    
    updateStartPauseButton();
    timerModalState.status.textContent = 'يعمل...';
    
    timerInterval = setInterval(() => {
      if (timerModalState.countType === 'countdown') {
        timerRemainingSeconds--;
        if (timerRemainingSeconds <= 0) {
          finishTimer();
          return;
        }
      } else {
        timerRemainingSeconds++;
      }
      updateTimerDisplay();
    }, 1000);
  }

  function resetTimer(){
    clearInterval(timerInterval);
    timerIsRunning = false;
    timerIsPaused = false;
    timerModalState.timerState = 'stopped';
    
    updateStartPauseButton();
    timerModalState.status.textContent = 'جاهز للبدء';
    
    updateTimerDisplay();
  }

  function finishTimer(){
    clearInterval(timerInterval);
    timerIsRunning = false;
    timerIsPaused = false;
    timerModalState.timerState = 'stopped';
    
    updateStartPauseButton();
    timerModalState.status.textContent = 'انتهى الوقت!';
    
    // تشغيل صوت التنبيه
    playTimerAlarmSound();
    
    // إظهار إشعار
    showTimerToast('انتهى الوقت!', 'warning');
    
    // إعادة تعيين العرض بعد 3 ثوان
    setTimeout(() => {
      resetTimer();
    }, 3000);
  }

  function updateStartPauseButton(){
    if (!timerModalState || !timerModalState.startPauseBtn) return;
    
    const btn = timerModalState.startPauseBtn;
    
    switch (timerModalState.timerState) {
      case 'stopped':
        btn.textContent = 'ابدأ';
        btn.className = 'timer-btn timer-btn-start';
        break;
      case 'running':
        btn.textContent = 'إيقاف مؤقت';
        btn.className = 'timer-btn timer-btn-pause';
        break;
      case 'paused':
        btn.textContent = 'استئناف';
        btn.className = 'timer-btn timer-btn-resume';
        break;
    }
  }

  function updateCountTypeUI(){
    if (!timerModalState) return;
    
    const presetContainer = timerModalState.backdrop.querySelector('.preset-container');
    if (presetContainer) {
      if (timerModalState.countType === 'countdown') {
        presetContainer.style.display = 'block';
      } else {
        presetContainer.style.display = 'none';
      }
    }
    
    // إعادة تعيين القيم عند تغيير نوع العد
    if (timerModalState.timerState === 'stopped') {
      timerModalState.hoursInput.value = 0;
      timerModalState.minutesInput.value = 0;
      timerModalState.secondsInput.value = 0;
      if (timerModalState.presetSelect) {
        timerModalState.presetSelect.value = '';
      }
    }
  }

  function playTimerAlarmSound(){
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // تشغيل نغمة تنبيه
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
          oscillator.type = 'sine';
          
          gainNode.gain.setValueAtTime(0, audioContext.currentTime);
          gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.1);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
          
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.5);
        }, i * 600);
      }
    } catch (e) {
      console.error('خطأ في تشغيل الصوت:', e);
    }
  }

  function showTimerToast(message, type = 'success'){
    const container = timerModalState && timerModalState.modalCard ? timerModalState.modalCard : document.body;
    let toast = container.querySelector('.timer-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'timer-toast';
      container.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.className = `timer-toast ${type}`;
    
    // إظهار الإشعار
    setTimeout(() => toast.classList.add('show'), 100);
    
    // إخفاء الإشعار بعد 3 ثوان
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  function attachTimerCardTriggers(){
    const cardElements = document.querySelectorAll('.timer-card');
    cardElements.forEach((card) => {
      if (card.dataset.timerBound === 'true') return;
      card.dataset.timerBound = 'true';

      const trigger = async (event) => {
        event.preventDefault();
        try {
          if (window.api && window.api.openToolWindow) {
            await window.api.openToolWindow('timer');
          } else if (window.openToolWindow) {
            await window.openToolWindow('timer');
          } else {
            window.open('/pages/timer-standalone.html', '_blank', 'width=500,height=700');
          }
        } catch (e) {
          console.warn('Failed to open timer window, fallback to tab:', e);
          window.open('/pages/timer-standalone.html', '_blank', 'width=500,height=700');
        }
      };

      card.addEventListener('click', trigger);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          trigger(event);
        }
      });
    });
  }

  async function onRoute(){
    console.log('onRoute called');
    const hash = location.hash.replace('#','') || '/';
    const hashPath = hash.split('?')[0];
    console.log('Current hash:', hash);

    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal && hash !== '/settings') {
      settingsModal.classList.remove('active');
      settingsModal.style.display = 'none';
      document.body.style.overflow = '';
    }

    // Clean up game-page state on every navigation
    const gameRoutes = ['/dino-arabic', '/grammar-hunter', '/ethics-path', '/million',
      '/basketball-quiz', '/hero-attack', '/dino-english', '/duck-race', '/game-geography-map',
      '/game-engine', '/game-engine/word-match', '/game-engine/edu-platformer', '/external-game'];
    const isGameRoute = gameRoutes.includes(hashPath);
    const isEngineRoute = hashPath === '/game-engine' || hashPath.startsWith('/game-engine/');
    const isWhiteboardRoute = hashPath === '/whiteboard';
    // The whiteboard keeps the app header visible (per user request) but
    // still needs #app sized to the space below the header — same pattern
    // as .game-page — otherwise its own toolbar assumes full-viewport
    // height and visually collides with the header/window controls above it.
    const isImmersiveRoute = isEngineRoute;

    if (!isGameRoute) {
      document.body.classList.remove('game-page');
      const prevCss = document.getElementById('dynamic-page-css');
      if (prevCss) prevCss.remove();
    }
    if (!isImmersiveRoute) {
      document.body.classList.remove('header-hidden');
    }

    if (isImmersiveRoute) {
      document.body.classList.add('header-hidden');
    }

    document.body.classList.toggle('whiteboard-page', isWhiteboardRoute);

    // geFloatingControls (back arrow + fullscreen) is a game-engine-only
    // overlay — it duplicates the whiteboard's own fullscreen button and
    // its "ملء الشاشة"/history navigation, so only show it for game-engine
    // routes, not for the whiteboard even though both hide the shell header.
    if (!isEngineRoute) {
      document.body.classList.remove('ge-active');
    } else {
      document.body.classList.add('ge-active');
    }

    updateActiveNavLink();

    // Updated handling: open Timer as standalone window
    if (hash === '/timer') {
      try {
        if (window.api && window.api.openToolWindow) {
          await window.api.openToolWindow('timer');
        } else if (window.openToolWindow) {
          await window.openToolWindow('timer');
        } else {
          window.open('/pages/timer-standalone.html', '_blank', 'width=500,height=700');
        }
      } catch (e) {
        console.warn('Failed to open timer window, fallback to tab:', e);
        window.open('/pages/timer-standalone.html', '_blank', 'width=500,height=700');
      }
      location.hash = '#/'
      return;
    }

    // Updated handling: open Names as in-page modal
    if (hash === '/names') {
      try {
        await ensureNamesStyles();
        openNamesModal();
      } catch (e) {
        console.warn('Failed to open names modal, falling back:', e);
        // Fallback to separate window if modal fails
        if (window.openToolWindow) {
          try { window.openToolWindow('names'); } catch(_) {}
        } else {
          window.open('/pages/names.html', '_blank');
        }
      }
      location.hash = '#/'
      return;
    }

    if (hash === '/students') {
      location.hash = '#/groups'
      return;
    }

    if (hash === '/dashboard' || hash === '/help') {
      location.hash = '#/'
      return;
    }

    const view = pages[hashPath] || pages[hash];

    if (hash.startsWith('/ai-player/')) {
       console.log('Loading AI Player');
       fetchPageContent('/pages/quiz-player.html');
       return;
    }

    // Trial enforcement for the local games grid — the lock icons on the
    // games.html cards are cosmetic (they only intercept clicks on that
    // specific page); a trial user hitting one of these routes directly
    // (typed hash, deep link, browser back/forward into history, etc.)
    // previously bypassed the limit entirely. This mirrors the exact same
    // order/allowedGames logic games.html uses to decide which cards get
    // the lock overlay, so both stay in sync.
    const LOCAL_GAME_ROUTE_ORDER = ['/dino-arabic', '/dino-english', '/duck-race', '/million', '/game-engine'];
    const localGameIndex = LOCAL_GAME_ROUTE_ORDER.indexOf(hashPath);
    if (localGameIndex !== -1) {
      const s = window.TRIAL_STATUS;
      if (s && s.trial && !s.licensed && !s.expired) {
        const allowed = s.limits?.allowedGames ?? 3;
        if (localGameIndex >= allowed) {
          window.trialBlock && window.trialBlock('games');
          location.hash = '#/games';
          return;
        }
      }
    }

    if (view) {
      console.log('Selected view:', view);
      view();
    } else if (hash === '/' || !hash) {
      console.log('Going home');
      home();
    } else {
      console.warn('Unknown route, staying put or handling internally:', hash);
      // If it's not a known route but we are already in a subpage (like a game), 
      // do nothing to let the subpage handle its own internal routing if any.
    }
  }

  // ===== Wheel Modal Functions =====
  function attachWheelModalTriggers() {
    const wheelModalCard = document.querySelector('.wheel-modal-card');
    if (wheelModalCard) {
      wheelModalCard.addEventListener('click', openWheelModal);
      wheelModalCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openWheelModal();
        }
      });
    }
  }

  function openWheelModal() {
    // Open wheel modal in a new window/tab
    window.open('/pages/wheel-modal.html', 'wheelModal', 'width=1200,height=800,scrollbars=yes,resizable=yes');
  }

  // ===== Wheel Standalone Functions =====
  function attachWheelStandaloneCardTriggers() {
    const wheelStandaloneCard = document.querySelector('.wheel-standalone-card');
    if (wheelStandaloneCard) {
      wheelStandaloneCard.addEventListener('click', openWheelStandalone);
      wheelStandaloneCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openWheelStandalone();
        }
      });
    }
  }

  async function openWheelStandalone() {
    try {
      if (window.api && window.api.openWheelWindow) {
        await window.api.openWheelWindow();
      } else {
        console.warn('Wheel standalone window API not available');
        // Fallback to opening in new tab
        window.open('/pages/wheel-standalone.html', '_blank');
      }
    } catch (error) {
      console.error('Error opening wheel standalone window:', error);
      // Fallback to opening in new tab
      window.open('/pages/wheel-standalone.html', '_blank');
    }
  }

  function attachSettingsCardTrigger(){
    const cardElements = document.querySelectorAll('.settings-card');
    cardElements.forEach((card) => {
      if (card.dataset.bound === 'true') return;
      card.dataset.bound = 'true';

      const trigger = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        
        try {
          // Load settings page if not already loaded
          if (!document.querySelector('#settingsModal')) {
            console.log('Loading settings modal...');
            
            const response = await fetch('/pages/settings.html');
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            const html = await response.text();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            
            // Extract the modal and append to body
            const modal = tempDiv.querySelector('#settingsModal');
            const loadingOverlay = tempDiv.querySelector('#loadingOverlay');
            const notification = tempDiv.querySelector('#notification');
            
            if (modal) document.body.appendChild(modal);
            if (loadingOverlay) document.body.appendChild(loadingOverlay);
            if (notification) document.body.appendChild(notification);
            
            // Load CSS
            if (!document.querySelector('link[href="/pages/settings.css"]')) {
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = '/pages/settings.css';
              document.head.appendChild(link);
              
              // Wait for CSS to load
              await new Promise((resolve) => {
                link.onload = resolve;
                link.onerror = resolve; // Continue even if CSS fails
                setTimeout(resolve, 1000);
              });
            }
            
            // Load JS
            if (!window.settingsManager) {
              const script = document.createElement('script');
              script.src = '/pages/settings.js';
              document.head.appendChild(script);
              
              // Wait for script to load
              await new Promise((resolve, reject) => {
                script.onload = () => {
                  console.log('Settings script loaded');
                  resolve();
                };
                script.onerror = reject;
                setTimeout(reject, 5000); // timeout after 5 seconds
              });
              
              // Give extra time for initialization
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
          
          // Open settings modal
          console.log('Opening settings modal...');
          if (window.openSettings) {
            window.openSettings();
          } else {
            console.warn('Settings manager not loaded yet, trying again...');
            setTimeout(() => {
              if (window.openSettings) {
                window.openSettings();
              } else {
                console.error('Settings still not available');
                alert('حدث خطأ في تحميل الإعدادات. يرجى إعادة تحميل الصفحة.');
              }
            }, 500);
          }
        } catch (e) {
          console.error('Settings error:', e);
          alert('حدث خطأ في تحميل الإعدادات. يرجى المحاولة مرة أخرى.');
        }
      };

      card.addEventListener('click', trigger);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          trigger(event);
        }
      });
    });
  }

  window.addEventListener('hashchange', () => requestAnimationFrame(onRoute));
  window.AppRouter = { init(){ 
    console.log('AppRouter.init called');
    onRoute(); 
    initGlobalToolHandlers();
  } };

  function initGlobalToolHandlers() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.toolbar-btn, .hqt-btn');
      if (!btn) return;
      const tool = btn.dataset.tool || btn.dataset.qt;
      if (!tool) return;
      console.log('Tool triggered:', tool);
      switch(tool) {
        case 'timer': location.hash = '#/timer'; break;
        case 'names':
        case 'random': location.hash = '#/names'; break;
        case 'wheel': window.open('/pages/wheel-standalone.html', '_blank'); break;
        case 'numbers': if (window.UXEnhancements) window.UXEnhancements.showNotification('🔢 أداة الأرقام العشوائية ستتوفر قريباً', 'info'); break;
        case 'call':
          playAlertSound(); // إطلاق جرس تنبيه لجذب الانتباه فقط
          if (window.UXEnhancements) window.UXEnhancements.showNotification('🔔 تم إطلاق جرس التنبيه', 'info');
          break;
        case 'fullscreen':
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            if (window.UXEnhancements) window.UXEnhancements.showNotification('🖥️ وضع ملء الشاشة (Focus Mode) نشط', 'success');
          } else {
            if (document.exitFullscreen) document.exitFullscreen();
          }
          break;
      }
    });
  }

  function playAlertSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      const now = audioCtx.currentTime;
      oscillator.type = 'sine';
      
      // Ding 1
      oscillator.frequency.setValueAtTime(880, now);
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.5, now + 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
      
      // Ding 2
      oscillator.frequency.setValueAtTime(1046.50, now + 0.7); // C6
      gainNode.gain.setValueAtTime(0, now + 0.7);
      gainNode.gain.linearRampToValueAtTime(0.5, now + 0.8);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.3);
      
      oscillator.start(now);
      oscillator.stop(now + 1.4);
    } catch (e) { console.warn('Audio failed', e); }
  }
})();