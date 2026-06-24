// Settings Management System
class SettingsManager {
    constructor() {
        this.settings = {};
        this.defaultSettings = {
            language: 'ar',
            theme: 'light',
            dbPath: '',
            backupPath: '',
            autoBackup: false,
            showDeleteAllStudents: false,
            showDeleteAllGroups: false,
            showAnimations: true,
            showNotifications: true,
            groq_api_key: ''
        };
        
        this.translations = {
            ar: {
                // Database tab
                'database_tab_title': '💾 إعدادات قاعدة البيانات والنسخ الاحتياطي',
                'database_tab_desc': 'إدارة قاعدة البيانات والنسخ الاحتياطي',
                'current_db_path': 'المسار الحالي:',
                'change_db_path': 'تغيير المكان',
                'backup_folder': 'مجلد النسخ الاحتياطي:',
                'select_backup_path': 'اختيار مجلد',
                'backup_now': '📥 نسخ احتياطي الآن',
                'restore_backup': '📤 استرجاع نسخة',
                'auto_backup': 'نسخ احتياطي تلقائي عند إغلاق البرنامج',
                
                // Appearance tab
                'appearance_tab_title': '🎨 المظهر واللغة',
                'appearance_tab_desc': 'تخصيص مظهر البرنامج واللغة',
                'language_label': '🌐 اللغة',
                'theme_label': '🌙 الثيم',
                'dark_mode': 'الوضع الداكن',
                'reset_settings': 'إعادة ضبط جميع الإعدادات',
                'reset_warning': '⚠️ سيتم إعادة ضبط جميع الإعدادات إلى القيم الافتراضية',
                
                // Interface tab
                'interface_tab_title': '🖥️ واجهة النظام والتحكم',
                'interface_tab_desc': 'تحكم في عناصر الواجهة وخيارات العرض',
                'delete_buttons': '🗑️ أزرار الحذف',
                'show_delete_students': 'إظهار زر "حذف جميع الطلاب" 👨‍🎓',
                'show_delete_groups': 'إظهار زر "حذف جميع المجموعات" 🧑‍🤝‍🧑',
                'display_options': '📊 خيارات العرض',
                'show_animations': 'تفعيل الرسوم المتحركة',
                'show_notifications': 'إظهار الإشعارات',
                
                // About tab
                'about_tab_title': 'ℹ️ حول البرنامج',
                'about_tab_desc': 'معلومات حول Active Class',
                'version': 'الإصدار 1.0.0',
                'description': 'برنامج إدارة الفصول الدراسية التفاعلي',
                'developer': '👨‍💻 المطور',
                'developer_text': 'تم تطوير هذا البرنامج بواسطة فريق Active Class',
                'useful_links': '🔗 الروابط المفيدة',
                
                // Buttons
                'cancel': 'إلغاء',
                'save_settings': 'حفظ الإعدادات',
                'close': 'إغلاق',
                
                // Messages
                'settings_saved': 'تم حفظ الإعدادات بنجاح',
                'settings_error': 'حدث خطأ في حفظ الإعدادات',
                'backup_success': 'تم إنشاء النسخة الاحتياطية بنجاح',
                'backup_error': 'حدث خطأ في إنشاء النسخة الاحتياطية',
                'restore_success': 'تم استرجاع النسخة الاحتياطية بنجاح',
                'restore_error': 'حدث خطأ في استرجاع النسخة الاحتياطية',
                'reset_confirm': 'هل أنت متأكد من إعادة ضبط جميع الإعدادات؟',
                'processing': 'جاري المعالجة...'
            },
            en: {
                // Database tab
                'database_tab_title': '💾 Database & Backup Settings',
                'database_tab_desc': 'Manage database and backup settings',
                'current_db_path': 'Current Path:',
                'change_db_path': 'Change Location',
                'backup_folder': 'Backup Folder:',
                'select_backup_path': 'Select Folder',
                'backup_now': '📥 Backup Now',
                'restore_backup': '📤 Restore Backup',
                'auto_backup': 'Auto backup on app close',
                
                // Appearance tab
                'appearance_tab_title': '🎨 Appearance & Language',
                'appearance_tab_desc': 'Customize app appearance and language',
                'language_label': '🌐 Language',
                'theme_label': '🌙 Theme',
                'dark_mode': 'Dark Mode',
                'reset_settings': 'Reset All Settings',
                'reset_warning': '⚠️ All settings will be reset to default values',
                
                // Interface tab
                'interface_tab_title': '🖥️ System Interface & Control',
                'interface_tab_desc': 'Control interface elements and display options',
                'delete_buttons': '🗑️ Delete Buttons',
                'show_delete_students': 'Show "Delete All Students" button 👨‍🎓',
                'show_delete_groups': 'Show "Delete All Groups" button 🧑‍🤝‍🧑',
                'display_options': '📊 Display Options',
                'show_animations': 'Enable animations',
                'show_notifications': 'Show notifications',
                
                // About tab
                'about_tab_title': 'ℹ️ About',
                'about_tab_desc': 'Information about Active Class',
                'version': 'Version 1.0.0',
                'description': 'Interactive Classroom Management Software',
                'developer': '👨‍💻 Developer',
                'developer_text': 'Developed by Active Class Team',
                'useful_links': '🔗 Useful Links',
                
                // Buttons
                'cancel': 'Cancel',
                'save_settings': 'Save Settings',
                'close': 'Close',
                
                // Messages
                'settings_saved': 'Settings saved successfully',
                'settings_error': 'Error saving settings',
                'backup_success': 'Backup created successfully',
                'backup_error': 'Error creating backup',
                'restore_success': 'Backup restored successfully',
                'restore_error': 'Error restoring backup',
                'reset_confirm': 'Are you sure you want to reset all settings?',
                'processing': 'Processing...'
            }
        };
        
        this.init();
    }
    
    async init() {
        await this.loadSettings();
        this.setupEventListeners();
        this.updateUI();
        this.applyTheme();
        this.applyLanguage();
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
            const geminiInput = document.getElementById('groqApiKey');
            if (geminiInput) {
                this.settings.groq_api_key = geminiInput.value;
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
            this.applyLanguage();
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

        // Theme selection - using radio buttons in the new structure
        document.querySelectorAll('input[name="theme"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.theme = e.target.value;
                this.applyTheme();
            });
        });
        
        // Language selection
        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            languageSelect.addEventListener('change', (e) => {
                this.settings.language = e.target.value;
                this.applyLanguage();
            });
        }
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

    applyLanguage() {
        localStorage.setItem('cm_language', this.settings.language);
        // In a real app, this might trigger a reload or use I18n.apply
        try { window.I18n && window.I18n.apply(document); } catch {}
    }
    
    switchTab(tabName) {
        if (!tabName) return;
        
        // Update navigation
        document.querySelectorAll('.sm-nav-item').forEach(item => item.classList.remove('active'));
        const navButton = document.querySelector(`.sm-nav-item[data-tab="${tabName}"]`);
        if (navButton) navButton.classList.add('active');

        // Update header title/subtitle
        const titles = {
            appearance: ['المظهر واللغة', 'تخصيص مظهر التطبيق ولغة الواجهة'],
            database:   ['قاعدة البيانات', 'النسخ الاحتياطي وإحصائيات البيانات'],
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
    
    updateUI() {
        try {
            // Theme selection
            const themeRadio = document.querySelector(`input[name="theme"][value="${this.settings.theme}"]`);
            if (themeRadio) {
                themeRadio.checked = true;
                // Highlight the selected radio label
                document.querySelectorAll('input[name="theme"]').forEach(r => {
                    r.parentElement.style.borderColor = 'var(--border)';
                });
                themeRadio.parentElement.style.borderColor = 'var(--primary)';
            }
            
            // Language selection
            const languageSelect = document.getElementById('languageSelect');
            if (languageSelect) {
                languageSelect.value = this.settings.language;
            }
            
            // Groq API Key
            const geminiInput = document.getElementById('groqApiKey');
            if (geminiInput) {
                geminiInput.value = this.settings.groq_api_key || '';
            }
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
            // In a real Electron app, this would open a folder dialog
            // For now, we'll simulate it
            const path = prompt('أدخل مسار مجلد النسخ الاحتياطي:');
            if (path) {
                this.settings.backupPath = path;
                this.updateBackupPath();
            }
        } catch (error) {
            console.error('Error selecting backup path:', error);
        }
    }
    
    async createBackup() {
        try {
            if (!this.settings.backupPath) {
                this.showNotification('يرجى تحديد مجلد النسخ الاحتياطي أولاً', 'warning');
                return;
            }
            
            this.showLoading(true);
            
            const response = await authFetch('/api/backup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ backupPath: this.settings.backupPath })
            });
            
            if (response.ok) {
                const result = await response.json();
                this.showNotification(this.t('backup_success'), 'success');
            } else {
                throw new Error('Backup failed');
            }
        } catch (error) {
            console.error('Error creating backup:', error);
            this.showNotification(this.t('backup_error'), 'error');
        } finally {
            this.showLoading(false);
        }
    }
    
    async restoreBackup() {
        try {
            // In a real Electron app, this would open a file dialog
            const backupFile = prompt('أدخل مسار ملف النسخة الاحتياطية:');
            if (!backupFile) return;
            
            if (!confirm('هل أنت متأكد من استرجاع هذه النسخة؟ سيتم استبدال البيانات الحالية.')) {
                return;
            }
            
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
            this.applyLanguage();
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
    
    applyLanguage() {
        const lang = this.settings.language || 'ar';
        const isRTL = lang === 'ar';
        // Apply on current document
        document.documentElement.setAttribute('lang', lang);
        document.documentElement.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
        // Persist and broadcast to other pages/windows
        try { localStorage.setItem('cm_language', lang); } catch {}
        // Custom event for same-document listeners
        try { window.dispatchEvent(new CustomEvent('cm-language-changed', { detail: { language: lang } })); } catch {}
        
        // Update all translatable elements in this modal
        this.updateTranslations();
        
        // Apply to parent window if in modal/iframe
        if (window.parent && window.parent !== window) {
            try {
                window.parent.document.documentElement.setAttribute('lang', lang);
                window.parent.document.documentElement.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
            } catch(_) {}
        }
    }
    
    updateTranslations() {
        const updateText = (selector, key) => {
            const el = document.querySelector(selector);
            if (el) el.textContent = this.t(key);
        };

        // Update tab headers & descriptions safely
        updateText('#database-tab h3', 'database_tab_title');
        updateText('#database-tab .tab-description', 'database_tab_desc');
        
        updateText('#appearance-tab h3', 'appearance_tab_title');
        updateText('#appearance-tab .tab-description', 'appearance_tab_desc');
        
        updateText('#interface-tab h3', 'interface_tab_title');
        updateText('#interface-tab .tab-description', 'interface_tab_desc');
        
        updateText('#about-tab h3', 'about_tab_title');
        updateText('#about-tab .tab-description', 'about_tab_desc');
        
        // Update buttons
        updateText('#cancelSettings', 'cancel');
        updateText('#saveSettings', 'save_settings');
    }
    
    t(key) {
        return this.translations[this.settings.language]?.[key] || key;
    }

    _fillLicenseTab() {
        try {
            const lic = JSON.parse(localStorage.getItem('ac_license_v1') || 'null');
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

                const total = lic.totalDays || 365;
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

        } catch (e) { console.warn('_fillLicenseTab error', e); }
    }

    async showModal() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            this.updateUI();
            // Load DB stats
            try {
                const [students, groups, quizzes] = await Promise.all([
                    window.api?.loadStudents?.() ?? [],
                    window.api?.loadGroups?.()   ?? [],
                    window.api?.loadQuizzes?.()  ?? [],
                ]);
                const s = document.getElementById('sm-stat-students');
                const g = document.getElementById('sm-stat-groups');
                const q = document.getElementById('sm-stat-quizzes');
                if (s) s.textContent = `${Array.isArray(students) ? students.length : 0} طالب`;
                if (g) g.textContent = `${Array.isArray(groups)   ? groups.length   : 0} مجموعة`;
                if (q) q.textContent = `${Array.isArray(quizzes)  ? quizzes.length  : 0} اختبار`;
            } catch {}
        }
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