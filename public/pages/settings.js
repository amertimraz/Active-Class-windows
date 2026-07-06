// Settings Management System
class SettingsManager {
    constructor() {
        this.settings = {};
        this.defaultSettings = {
            theme: 'light',
            dbPath: '',
            backupPath: '',
            autoBackup: false,
            autoBackupOnClose: false,
            autoBackupPeriodic: false,
            autoBackupInterval: 30,
            autoBackupFolder: '',
            showDeleteAllStudents: false,
            showDeleteAllGroups: false,
            showAnimations: true,
            showNotifications: true,
            groq_api_key: '',
            gemini_api_key: ''
        };
        
        this.translations = {
            'restore_backup': 'استرجاع نسخة',
            'settings_saved': 'تم حفظ الإعدادات بنجاح',
            'settings_error': 'حدث خطأ في حفظ الإعدادات',
            'backup_success': 'تم إنشاء النسخة الاحتياطية بنجاح',
            'backup_error': 'حدث خطأ في إنشاء النسخة الاحتياطية',
            'restore_success': 'تم استرجاع النسخة الاحتياطية بنجاح',
            'restore_error': 'حدث خطأ في استرجاع النسخة الاحتياطية',
            'reset_confirm': 'هل أنت متأكد من إعادة ضبط جميع الإعدادات؟',
        };
        
        this.init();
    }
    
    async init() {
        await this.loadSettings();
        this.setupEventListeners();
        this.updateUI();
        this.applyTheme();
    }

    async loadSettings() {
        try {
            const response = await authFetch('/api/settings');
            if (response.ok) {
                const data = await response.json();
                this.settings = { ...this.defaultSettings, ...data };
            } else {
                this.settings = { ...this.defaultSettings };
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            this.settings = { ...this.defaultSettings };
        }
    }
    
    async saveSettings() {
        try {
            this.showLoading(true);
            
            // Get values from UI that aren't auto-bound
            const groqInput = document.getElementById('groqApiKey');
            if (groqInput) {
                this.settings.groq_api_key = groqInput.value;
            }
            const geminiApiInput = document.getElementById('geminiApiKey');
            if (geminiApiInput) {
                this.settings.gemini_api_key = geminiApiInput.value;
            }

            for (const [key, value] of Object.entries(this.settings)) {
                await authFetch('/api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ key, value })
                });
            }
            
            this.showNotification(this.t('settings_saved'), 'success');
            this.applyTheme();
            setTimeout(() => this.closeModal(), 600);
            
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showNotification(this.t('settings_error'), 'error');
        } finally {
            this.showLoading(false);
        }
    }
    
    setupEventListeners() {
        // Modal controls
        const closeBtn = document.getElementById('closeSettings');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
        
        const cancelBtn = document.getElementById('cancelSettings');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());
        
        const saveBtn = document.getElementById('saveSettings');
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveSettings());

        // ── About / Update tab ──────────────────────────────────────────
        this._initAboutTab();
        // ── End About / Update tab ──────────────────────────────────────

        // Tab navigation
        document.querySelectorAll('.sm-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const button = e.target.closest('.sm-nav-item');
                if (button && button.dataset.tab) {
                    this.switchTab(button.dataset.tab);
                }
            });
        });

        // Theme toggle in header
        const themeToggle = document.getElementById('headerThemeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                this.settings.theme = this.settings.theme === 'dark' ? 'light' : 'dark';
                this.applyTheme();
                this._updateHeaderControls();
                authFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'theme', value: this.settings.theme }) }).catch(() => {});
            });
        }


        // ── Export / Restore buttons ────────────────────────────────────────
        const exportDbBtn = document.getElementById('exportDbBtn');
        if (exportDbBtn) exportDbBtn.addEventListener('click', () => this.createBackup());

        const importDbBtn = document.getElementById('importDbBtn');
        if (importDbBtn) importDbBtn.addEventListener('click', () => this.restoreBackup());
        // ── End Export / Restore ────────────────────────────────────────────

        // ── Auto-backup controls ────────────────────────────────────────────
        const selectAutoFolderBtn = document.getElementById('selectAutoBackupFolderBtn');
        if (selectAutoFolderBtn) {
            selectAutoFolderBtn.addEventListener('click', async () => {
                if (!window.api?.selectBackupFolder) return;
                const result = await window.api.selectBackupFolder();
                if (!result?.canceled && result?.path) {
                    this.settings.autoBackupFolder = result.path;
                    const label = document.getElementById('autoBackupPathLabel');
                    if (label) label.textContent = result.path;
                    this._syncAutoBackupSettings();
                }
            });
        }

        const onCloseToggle = document.getElementById('autoBackupOnCloseToggle');
        if (onCloseToggle) {
            onCloseToggle.addEventListener('change', () => {
                this.settings.autoBackupOnClose = onCloseToggle.checked;
                this._syncAutoBackupSettings();
            });
        }

        const periodicToggle = document.getElementById('autoBackupPeriodicToggle');
        const intervalRow    = document.getElementById('periodicIntervalRow');
        if (periodicToggle) {
            periodicToggle.addEventListener('change', () => {
                this.settings.autoBackupPeriodic = periodicToggle.checked;
                if (intervalRow) intervalRow.style.display = periodicToggle.checked ? 'flex' : 'none';
                this._syncAutoBackupSettings();
            });
        }

        const intervalSelect = document.getElementById('autoBackupInterval');
        if (intervalSelect) {
            intervalSelect.addEventListener('change', () => {
                this.settings.autoBackupInterval = parseInt(intervalSelect.value, 10);
                this._syncAutoBackupSettings();
            });
        }
        // ── End Auto-backup controls ────────────────────────────────────────
    }

    _syncAutoBackupSettings() {
        const cfg = {
            folder:   this.settings.autoBackupFolder  || '',
            onClose:  this.settings.autoBackupOnClose  || false,
            periodic: this.settings.autoBackupPeriodic || false,
            interval: this.settings.autoBackupInterval || 30,
        };
        localStorage.setItem('ac_auto_backup', JSON.stringify(cfg));
        if (window.api?.setAutoBackup) window.api.setAutoBackup(cfg);
    }

    closeModal() {
        const modal = document.getElementById('settingsModal');
        if (modal) modal.style.display = 'none';
        // Go back to previous hash or home if we were on /settings
        if (window.location.hash === '#/settings') {
            window.location.hash = '#/';
        }
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.settings.theme);
        localStorage.setItem('cm_theme', this.settings.theme);
    }


    
    switchTab(tabName) {
        if (!tabName) return;
        
        // Update navigation
        document.querySelectorAll('.sm-nav-item').forEach(item => item.classList.remove('active'));
        const navButton = document.querySelector(`.sm-nav-item[data-tab="${tabName}"]`);
        if (navButton) navButton.classList.add('active');

        // Update header title/subtitle
        const titles = {
            database:   ['النسخ الاحتياطي', 'حفظ واسترجاع بيانات التطبيق'],
            interface:  ['الذكاء الاصطناعي', 'إعداد مفتاح Groq API'],
            license:    ['الترخيص', 'معلومات المستخدم والترخيص'],
            about:      ['حول البرنامج', 'معلومات عن Active Class'],
        };
        if (tabName === 'license') this._fillLicenseTab();
        const t = titles[tabName];
        if (t) {
            const titleEl = document.getElementById('sm-current-title');
            const subEl   = document.getElementById('sm-current-sub');
            if (titleEl) titleEl.textContent = t[0];
            if (subEl)   subEl.textContent   = t[1];
        }

        // Update content
        document.querySelectorAll('#settingsModal .sm-tab').forEach(content => {
            content.classList.remove('active');
        });
        const tabContent = document.getElementById(`${tabName}-tab`);
        if (tabContent) tabContent.classList.add('active');
    }
    
    _updateHeaderControls() {
        const isDark = this.settings.theme === 'dark';
        const sunIcon  = document.getElementById('themeIconSun');
        const moonIcon = document.getElementById('themeIconMoon');
        if (sunIcon)  sunIcon.style.display  = isDark ? 'none' : '';
        if (moonIcon) moonIcon.style.display = isDark ? '' : 'none';
    }

    updateUI() {
        try {
            this._updateHeaderControls();
            
            // Groq API Key
            const groqInput = document.getElementById('groqApiKey');
            if (groqInput) {
                groqInput.value = this.settings.groq_api_key || '';
            }

            // Gemini API Key
            const geminiApiInput = document.getElementById('geminiApiKey');
            if (geminiApiInput) {
                geminiApiInput.value = this.settings.gemini_api_key || '';
            }

            // Auto-backup UI
            const autoFolderLabel = document.getElementById('autoBackupPathLabel');
            if (autoFolderLabel) autoFolderLabel.textContent = this.settings.autoBackupFolder || 'لم يتم تحديد مجلد';

            const onCloseToggle = document.getElementById('autoBackupOnCloseToggle');
            if (onCloseToggle) onCloseToggle.checked = !!this.settings.autoBackupOnClose;

            const periodicToggle = document.getElementById('autoBackupPeriodicToggle');
            const intervalRow    = document.getElementById('periodicIntervalRow');
            if (periodicToggle) {
                periodicToggle.checked = !!this.settings.autoBackupPeriodic;
                if (intervalRow) intervalRow.style.display = periodicToggle.checked ? 'flex' : 'none';
            }

            const intervalSelect = document.getElementById('autoBackupInterval');
            if (intervalSelect) intervalSelect.value = this.settings.autoBackupInterval || 30;
        } catch (error) {
            console.error('Error updating UI:', error);
        }
    }
    
    async updateDbPath() {
        try {
            // In Electron, we would get this from the main process
            const dbPath = 'data/activeclass.db'; // Default path
            const currentDbPathEl = document.getElementById('currentDbPath');
            if (currentDbPathEl) {
                currentDbPathEl.textContent = dbPath;
            }
        } catch (error) {
            const currentDbPathEl = document.getElementById('currentDbPath');
            if (currentDbPathEl) {
                currentDbPathEl.textContent = 'غير محدد';
            }
        }
    }
    
    updateBackupPath() {
        try {
            const backupPath = this.settings.backupPath || 'لم يتم تحديد مجلد';
            const backupPathEl = document.getElementById('backupPath');
            if (backupPathEl) {
                backupPathEl.textContent = backupPath;
            }
        } catch (error) {
            console.error('Error updating backup path:', error);
        }
    }
    
    async selectBackupPath() {
        try {
            if (window.api?.selectBackupFolder) {
                const result = await window.api.selectBackupFolder();
                if (!result?.canceled && result?.path) {
                    this.settings.backupPath = result.path;
                    this.updateBackupPath();
                }
            }
        } catch (error) {
            console.error('Error selecting backup path:', error);
        }
    }

    async createBackup() {
        try {
            // If no folder set, open dialog to pick one
            let folder = this.settings.autoBackupFolder || this.settings.backupPath;
            if (!folder) {
                if (window.api?.selectBackupFolder) {
                    const result = await window.api.selectBackupFolder();
                    if (result?.canceled || !result?.path) return;
                    folder = result.path;
                    this.settings.autoBackupFolder = folder;
                    this.settings.backupPath = folder;
                    const label = document.getElementById('autoBackupPathLabel');
                    if (label) label.textContent = folder;
                } else {
                    this.showNotification('يرجى تحديد مجلد النسخ الاحتياطي أولاً', 'warning');
                    return;
                }
            }

            this.showLoading(true);

            const response = await authFetch('/api/backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backupPath: folder })
            });

            if (response.ok) {
                const result = await response.json();
                this.showBackupSuccessToast(result.backupFile || folder);
            } else {
                const errText = await response.text().catch(() => response.status);
                throw new Error(`Backup failed (${response.status}): ${errText}`);
            }
        } catch (error) {
            console.error('Error creating backup:', error);
            this.showNotification(`❌ ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    showBackupSuccessToast(filePath) {
        // Remove any existing toast
        const old = document.getElementById('_backupToast');
        if (old) old.remove();

        const toast = document.createElement('div');
        toast.id = '_backupToast';
        toast.style.cssText = `
            position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
            background:#0f172a;color:#f1f5f9;border-radius:12px;
            padding:16px 20px;min-width:340px;max-width:90vw;
            box-shadow:0 8px 32px rgba(0,0,0,.45);z-index:99999;
            font-family:inherit;direction:rtl;
            border:1px solid rgba(99,102,241,.4);
            animation:_bkSlideIn .25s ease;
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes _bkSlideIn{from{opacity:0;transform:translateX(-50%) translateY(16px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        `;
        document.head.appendChild(style);

        toast.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                <span style="font-size:20px">✅</span>
                <span style="font-weight:700;font-size:15px">تم حفظ النسخة الاحتياطية</span>
                <button id="_bkClose" style="margin-right:auto;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;line-height:1">✕</button>
            </div>
            <div style="background:#1e293b;border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:8px">
                <span style="font-size:13px;color:#94a3b8;flex:1;word-break:break-all;font-family:monospace">${filePath}</span>
                <button id="_bkCopy" title="نسخ المسار" style="background:#334155;border:none;border-radius:6px;color:#e2e8f0;cursor:pointer;padding:5px 10px;font-size:12px;white-space:nowrap;flex-shrink:0">📋 نسخ</button>
            </div>
        `;

        document.body.appendChild(toast);

        document.getElementById('_bkClose').onclick = () => toast.remove();
        document.getElementById('_bkCopy').onclick = () => {
            navigator.clipboard.writeText(filePath).catch(() => {});
            const btn = document.getElementById('_bkCopy');
            if (btn) { btn.textContent = '✓ تم النسخ'; setTimeout(() => { if (btn) btn.textContent = '📋 نسخ'; }, 2000); }
        };

        // Auto-dismiss after 10 seconds
        setTimeout(() => { if (document.getElementById('_backupToast')) toast.remove(); }, 10000);
    }
    
    async restoreBackup() {
        try {
            let backupFile;
            if (window.api?.selectBackupFile) {
                const result = await window.api.selectBackupFile();
                if (result.canceled) return;
                backupFile = result.filePath;
            } else {
                backupFile = prompt('أدخل مسار ملف النسخة الاحتياطية:');
                if (!backupFile) return;
            }

            const confirmed = await this._showRestoreConfirm();
            if (!confirmed) return;

            this.showLoading(true);
            
            const response = await authFetch('/api/restore', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ backupFile })
            });
            
            if (response.ok) {
                this.showNotification(this.t('restore_success'), 'success');
                // Reload the page after a short delay
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } else {
                throw new Error('Restore failed');
            }
        } catch (error) {
            console.error('Error restoring backup:', error);
            this.showNotification(this.t('restore_error'), 'error');
        } finally {
            this.showLoading(false);
        }
    }
    
    resetSettings() {
        if (confirm(this.t('reset_confirm'))) {
            this.settings = { ...this.defaultSettings };
            this.updateUI();
            this.applyTheme();
            this.showNotification('تم إعادة ضبط الإعدادات', 'success');
        }
    }
    
    applyTheme() {
        const theme = this.settings.theme === 'dark' ? 'dark' : 'light';
        // Apply on current document
        document.documentElement.setAttribute('data-theme', theme);
        // Broadcast to other pages/windows (same origin) via localStorage
        try { localStorage.setItem('cm_theme', theme); } catch {}
        // Sync parent if in iframe/modal
        if (window.parent && window.parent !== window) {
            try { window.parent.document.documentElement.setAttribute('data-theme', theme); } catch {}
        }
    }
    
    
    t(key) {
        return this.translations[key] || key;
    }

    _fillGamesTab() {
        const REGISTRY = [
            { section: 'memory', label: '🧠 ذاكرة ومهارات', games: [
                { id: 'dino-memory',     name: 'Dino Memory',             emoji: '🦕' },
                { id: 'animal-puzzle',   name: 'Animal Puzzle Deluxe',    emoji: '🐾' },
                { id: 'one-line-puzzle', name: 'One Line Drawing Puzzle',  emoji: '〰️' },
                { id: 'spot-5-diff',     name: 'Spot 5 Differences',      emoji: '🔍' },
                { id: 'hogie',           name: 'Hogie the Globehopper',   emoji: '🌍' },
            ]},
            { section: 'edu', label: '📚 ألعاب تعليمية', games: [
                { id: 'order-ops',      name: 'Order of Operations',           emoji: '➗' },
                { id: 'oddball',        name: 'Oddball Detective',             emoji: '🕵️' },
                { id: 'bike-math',      name: 'Bike Racing Math',              emoji: '🏍️' },
                { id: 'world-flags',    name: 'World Flags Trivia',            emoji: '🏳️' },
                { id: 'picsword',       name: 'Picsword Puzzles',              emoji: '🧩' },
                { id: 'math-shot',      name: 'Math Shot',                     emoji: '🎯' },
                { id: 'follow-code',    name: 'Follow the Code',               emoji: '🔢' },
                { id: 'code-panda',     name: 'Code Panda',                    emoji: '🐼' },
                { id: 'f1-math',        name: 'F1 Racer Math',                 emoji: '🏎️' },
                { id: 'math-tank',      name: 'Math Tank',                     emoji: '🪖' },
                { id: 'math-crossword', name: 'Math Crossword Puzzle',         emoji: '➕' },
                { id: 'math-runner',    name: 'Math Runner',                   emoji: '🏃' },
            ]},
            { section: 'compete', label: '⚔️ ألعاب تنافسية', games: [
                { id: 'zombie-math',      name: 'Math Battle: Zombie City',  emoji: '🧟' },
                { id: 'football-cup',     name: 'Tiny Football Cup 2026',    emoji: '⚽' },
                { id: 'basketball-rush',  name: 'Basketball Rush',            emoji: '🏀' },
            ]},
        ];

        const vis = JSON.parse(localStorage.getItem('ac_games_vis') || '{}');
        const tab = document.getElementById('games-tab');
        if (!tab) return;

        let html = `<div style="display:flex;flex-direction:column;gap:2rem;">`;

        REGISTRY.forEach(sec => {
            html += `
            <div>
              <div style="font-size:1rem;font-weight:800;margin-bottom:12px;color:var(--text-primary)">${sec.label}</div>
              <div style="display:flex;flex-direction:column;gap:0;">`;

            sec.games.forEach((g, i) => {
                const enabled = vis[g.id] !== false;
                const isLast  = i === sec.games.length - 1;
                html += `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:${i===0?'12px 12px':'0'} ${isLast?'0 0 12px 12px':''};${i>0?'border-top:none':''}">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:1.2rem">${g.emoji}</span>
                    <span style="font-size:.9rem;font-weight:600;color:var(--text-primary)">${g.name}</span>
                  </div>
                  <label style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;cursor:pointer">
                    <input type="checkbox" data-gid="${g.id}" ${enabled ? 'checked' : ''} style="opacity:0;width:0;height:0;position:absolute"
                      onchange="(function(el){
                        var vis=JSON.parse(localStorage.getItem('ac_games_vis')||'{}');
                        vis[el.dataset.gid]=el.checked;
                        localStorage.setItem('ac_games_vis',JSON.stringify(vis));
                        var track=el.parentElement.querySelector('.gt');
                        if(track){track.style.background=el.checked?'#0d9488':'#cbd5e1';}
                        var thumb=el.parentElement.querySelector('.gth');
                        if(thumb){thumb.style.transform=el.checked?'translateX(-20px)':'translateX(0)';}
                      })(this)">
                    <span class="gt" style="position:absolute;inset:0;border-radius:24px;background:${enabled?'#0d9488':'#cbd5e1'};transition:background .2s"></span>
                    <span class="gth" style="position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s;transform:${enabled?'translateX(-20px)':'translateX(0)'}"></span>
                  </label>
                </div>`;
            });

            html += `</div></div>`;
        });

        html += `
          <div style="background:rgba(14,149,136,.08);border:1px solid rgba(14,149,136,.25);border-radius:10px;padding:11px 15px;font-size:.8rem;color:#0d9488;">
            💡 الألعاب المعطّلة لن تظهر في هاب الألعاب الأونلاين. التغيير فوري بدون حفظ.
          </div>`;

        html += `</div>`;
        tab.innerHTML = html;
    }

    async _fillLicenseTab() {
        try {
            // Always fetch fresh data from server (catches admin edits to expiry/plan)
            let lic = null;
            if (window.api?.refreshLicense) {
                const fresh = await window.api.refreshLicense();
                if (fresh?.licensed) lic = fresh;
            }
            // Fallback: cached file via IPC
            if (!lic && window.api?.getLicenseStatus) {
                const status = await window.api.getLicenseStatus();
                if (status?.licensed) lic = status;
            }
            if (!lic) lic = JSON.parse(localStorage.getItem('ac_license_v1') || 'null');
            const reg = JSON.parse(localStorage.getItem('ac_registration_v1') || 'null');

            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };

            set('licInfoName',   lic?.name  || reg?.name);
            set('licInfoPhone',  lic?.phone || reg?.phone);
            set('licInfoKey',    lic?.key);

            if (lic?.expiresAt) {
                const expDate = new Date(lic.expiresAt);
                set('licInfoExpiry', expDate.toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' }));
                const days = Math.max(0, Math.ceil((expDate - new Date()) / 86400000));
                set('licInfoDays', `${days} يوم`);

                // Prefer the license's real original span (issuedAt → expiresAt)
                // over the separately-cached totalDays — that field defaults to
                // 365 whenever it's missing (older cached licenses, offline
                // fallbacks, etc.), which silently clips the bar at 100% for
                // the entire first year of any longer-than-a-year license even
                // though the remaining-days count keeps counting down correctly.
                const total = lic.issuedAt
                    ? Math.max(1, Math.round((expDate - new Date(lic.issuedAt)) / 86400000))
                    : (lic.totalDays || 365);
                const pct = Math.min(100, Math.round((days / total) * 100));
                const barWrap = document.getElementById('licBarWrap');
                const bar = document.getElementById('licDaysBar');
                const pctEl = document.getElementById('licBarPct');
                if (barWrap) barWrap.style.display = '';
                if (pctEl) pctEl.textContent = pct + '%';
                setTimeout(() => { if (bar) bar.style.width = pct + '%'; }, 100);

                const color = days < 30 ? '#ef4444' : days < 90 ? '#f59e0b' : '#0d9488';
                if (bar) bar.style.background = color;
            }

            // Machine ID
            if (window.api?.getMachineId) {
                window.api.getMachineId().then(mid => set('licInfoMid', mid)).catch(() => {});
            } else {
                set('licInfoMid', lic?.machineId);
            }

            // Update header user name
            const nameEl = document.getElementById('headerUserName');
            const name = lic?.name || reg?.name;
            if (nameEl && name) nameEl.textContent = name;

        // Logout button
        const logoutBtn    = document.getElementById('licLogoutBtn');
        const logoutModal  = document.getElementById('licLogoutModal');
        const logoutCancel = document.getElementById('licLogoutCancel');
        const logoutConfirm = document.getElementById('licLogoutConfirm');
        if (logoutBtn && logoutModal) {
            logoutBtn.onmouseenter = () => { logoutBtn.style.background = '#fef2f2'; };
            logoutBtn.onmouseleave = () => { logoutBtn.style.background = 'transparent'; };
            logoutBtn.onclick = () => { logoutModal.style.display = 'flex'; };
            logoutCancel.onclick = () => { logoutModal.style.display = 'none'; };
            logoutModal.onclick = (e) => { if (e.target === logoutModal) logoutModal.style.display = 'none'; };
            logoutConfirm.onclick = async () => {
                logoutConfirm.disabled = true;
                logoutConfirm.textContent = 'جاري الخروج...';
                if (window.api?.logoutLicense) await window.api.logoutLicense();
            };
        }

        } catch (e) { console.warn('_fillLicenseTab error', e); }
    }

    async showModal() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            this.updateUI();
            this.switchTab('database');
            this._loadStats();
            this._initResetAll();
        }
    }

    async _loadStats() {
        try {
            const [groups, quizzes] = await Promise.all([
                window.api?.loadGroups?.()  ?? [],
                window.api?.loadQuizzes?.() ?? [],
            ]);
            const studentCount = Array.isArray(groups)
                ? groups.reduce((sum, g) => sum + (g.studentCount ?? g.studentsCount ?? 0), 0)
                : 0;
            const s = document.getElementById('sm-stat-students');
            const g = document.getElementById('sm-stat-groups');
            const q = document.getElementById('sm-stat-quizzes');
            if (s) s.textContent = studentCount;
            if (g) g.textContent = Array.isArray(groups)  ? groups.length  : 0;
            if (q) q.textContent = Array.isArray(quizzes) ? quizzes.length : 0;
        } catch(e) { console.error('_loadStats:', e); }
    }

    _initResetAll() {
        const btn     = document.getElementById('sm-reset-all-btn');
        const modal   = document.getElementById('sm-reset-modal');
        const cancel  = document.getElementById('sm-reset-cancel');
        const confirm = document.getElementById('sm-reset-confirm');
        if (!btn || !modal) return;

        btn.onmouseenter = () => { btn.style.background = '#fef2f2'; };
        btn.onmouseleave = () => { btn.style.background = 'transparent'; };

        btn.onclick = () => { modal.style.display = 'flex'; };
        cancel.onclick  = () => { modal.style.display = 'none'; };
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

        confirm.onclick = async () => {
            confirm.disabled = true;
            confirm.textContent = 'جاري الحذف...';
            try {
                const res = await authFetch('/api/reset-all', { method: 'POST' });
                if (!res.ok) throw new Error('reset failed');
                modal.style.display = 'none';
                this._loadStats();
                this.showNotification('✅ تم تصفير جميع البيانات', 'success');
            } catch(e) {
                this.showNotification('❌ حدث خطأ أثناء التصفير', 'error');
            } finally {
                confirm.disabled = false;
                confirm.textContent = 'تأكيد الحذف';
            }
        };
    }

    // Styled replacement for the native confirm() dialog previously used
    // before restoring a backup — matches the app's other confirm modals
    // (e.g. #sm-reset-modal) instead of the OS-native "active-class" box.
    _showRestoreConfirm() {
        return new Promise((resolve) => {
            const modal = document.getElementById('sm-restore-modal');
            const cancel = document.getElementById('sm-restore-cancel');
            const confirmBtn = document.getElementById('sm-restore-confirm');
            if (!modal || !cancel || !confirmBtn) { resolve(true); return; }

            const cleanup = (result) => {
                modal.style.display = 'none';
                cancel.onclick = null;
                confirmBtn.onclick = null;
                modal.onclick = null;
                resolve(result);
            };

            modal.style.display = 'flex';
            cancel.onclick = () => cleanup(false);
            confirmBtn.onclick = () => cleanup(true);
            modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
        });
    }

    closeModal() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
        if (window.location.hash === '#/settings') {
            window.location.hash = '#/';
        }
    }
    
    showLoading(show) {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.style.display = show ? 'flex' : 'none';
        }
    }
    
    showNotification(message, type = 'success') {
        if (!this.settings.showNotifications) return;
        
        console.log(`Notification (${type}): ${message}`);
        // If there's a global toast system, use it here. 
        // For now, we'll use a simple alert if no notification element exists
        const notification = document.getElementById('notification');
        if (notification) {
            const textElement = notification.querySelector('.notification-text');
            if (textElement) textElement.textContent = message;
            notification.className = `notification ${type} show`;
            setTimeout(() => this.hideNotification(), 5000);
        } else {
            // fallback
            if (type === 'error') alert(message);
        }
    }
    
    hideNotification() {
        const notification = document.getElementById('notification');
        if (notification) notification.classList.remove('show');
    }
}

// Initialize settings immediately (for dynamic loading)
if (!window.settingsManager) {
    window.settingsManager = new SettingsManager();
}

// Also initialize on DOM loaded (for direct page access)
document.addEventListener('DOMContentLoaded', () => {
    if (!window.settingsManager) {
        window.settingsManager = new SettingsManager();
    }
});

// Global function to open settings modal
// ── About / Update helper ────────────────────────────────────────────────
SettingsManager.prototype._initAboutTab = function () {
    const verEl      = document.getElementById('aboutCurrentVersion');
    const statusEl   = document.getElementById('updateStatus');
    const statusText = document.getElementById('updateStatusText');
    const checkBtn   = document.getElementById('checkUpdateBtn');
    const dlBtn      = document.getElementById('downloadUpdateBtn');

    const api = window.api;

    // Show current version
    if (verEl && api && api.getAppVersion) {
        api.getAppVersion().then(v => { verEl.textContent = `الإصدار ${v}`; }).catch(() => {});
    }

    if (!checkBtn) return;

    // Listen for update events pushed from main process
    if (api && api.onUpdateMessage) {
        api.onUpdateMessage((msg) => {
            switch (msg.event) {
                case 'checking':
                    statusEl.className = 'sm-update-status is-checking';
                    statusText.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin .8s linear infinite"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> جارٍ التحقق…';
                    checkBtn.disabled = true;
                    dlBtn.style.display = 'none';
                    break;

                case 'up-to-date':
                    statusEl.className = 'sm-update-status is-uptodate';
                    statusText.textContent = `✓ أنت على أحدث إصدار (${msg.version})`;
                    checkBtn.disabled = false;
                    break;

                case 'available':
                    statusEl.className = 'sm-update-status is-available';
                    statusText.textContent = `✦ يوجد تحديث جديد: ${msg.version}`;
                    checkBtn.disabled = false;
                    dlBtn.style.display = 'flex';
                    dlBtn.textContent   = 'تثبيت التحديث';
                    dlBtn.onclick = () => {
                        dlBtn.disabled = true;
                        dlBtn.textContent = 'جارٍ التحميل…';
                        api.downloadUpdate();
                    };
                    break;

                case 'progress':
                    statusEl.className = 'sm-update-status is-checking';
                    statusText.textContent = `جارٍ التحميل… ${msg.percent}%`;
                    dlBtn.textContent = `${msg.percent}%`;
                    break;

                case 'downloaded':
                    statusEl.className = 'sm-update-status is-uptodate';
                    statusText.textContent = '✓ اكتمل التحميل — سيُعاد تشغيل البرنامج';
                    dlBtn.style.display = 'flex';
                    dlBtn.disabled = false;
                    dlBtn.textContent = 'إعادة التشغيل والتثبيت';
                    dlBtn.onclick = () => api.installUpdate();
                    break;

                case 'error':
                    statusEl.className = 'sm-update-status is-error';
                    statusText.textContent = `⚠ ${msg.message}`;
                    checkBtn.disabled = false;
                    break;
            }
        });
    }

    checkBtn.addEventListener('click', async () => {
        if (!api || !api.checkForUpdates) {
            statusText.textContent = 'ميزة التحديث غير متوفرة في هذا الوضع.';
            return;
        }
        const res = await api.checkForUpdates();
        if (res && res.devMode) {
            statusEl.className = 'sm-update-status';
            statusText.textContent = 'ميزة التحديث تعمل فقط في النسخة المثبّتة.';
        }
    });
};
// ── End About / Update helper ────────────────────────────────────────────

window.openSettings = () => {
    if (window.settingsManager) {
        window.settingsManager.showModal();
    } else {
        // Fallback: create manager if it doesn't exist
        window.settingsManager = new SettingsManager();
        setTimeout(() => {
            window.settingsManager.showModal();
        }, 100);
    }
};