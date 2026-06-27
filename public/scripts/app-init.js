/**
 * Active Class - App Initialization Script
 */
window.addEventListener('DOMContentLoaded', () => {
    try { window.I18n && window.I18n.apply(document); } catch {}

    const appShell = document.getElementById('appShell');

    const resetUiState = () => {
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal) {
            settingsModal.classList.remove('active');
            settingsModal.style.display = 'none';
        }
        document.body.style.overflow = '';
        document.body.classList.remove('header-hidden');
        document.body.classList.remove('game-page');
        document.body.classList.remove('loading-state');
        const dynamicCss = document.getElementById('dynamic-page-css');
        if (dynamicCss) dynamicCss.remove();
        const dynamicJs = document.getElementById('dynamic-page-js');
        if (dynamicJs) dynamicJs.remove();
        document.querySelectorAll('body > .modal-overlay').forEach((overlay) => {
            if (overlay.id !== 'settingsModal') {
                overlay.classList.remove('active');
                overlay.style.display = 'none';
            }
        });
    };

    // Launch app directly — no login screen
    resetUiState();
    if (appShell) appShell.classList.add('is-visible');
    if (!window.location.hash) window.location.hash = '#/';

    if (!window.__appInited && window.AppRouter && window.AppRouter.init) {
        window.AppRouter.init();
        window.__appInited = true;
    }

    // Sync license localStorage with actual file on disk
    if (window.api?.getLicenseStatus) {
        window.api.getLicenseStatus().then(status => {
            if (!status?.valid) {
                localStorage.removeItem('ac_license_v1');
                localStorage.removeItem('ac_registration_v1');
                const nameEl = document.getElementById('headerUserName');
                if (nameEl) nameEl.textContent = '';
            } else {
                const nameEl = document.getElementById('headerUserName');
                if (nameEl && status.name) nameEl.textContent = status.name;
            }
        }).catch(() => {});
    }

    // Fill header user name from license/registration (immediate, before async check)
    try {
        const lic = JSON.parse(localStorage.getItem('ac_license_v1') || 'null');
        const reg = JSON.parse(localStorage.getItem('ac_registration_v1') || 'null');
        const name = lic?.name || reg?.name;
        const nameEl = document.getElementById('headerUserName');
        if (nameEl && name) nameEl.textContent = name;
    } catch {}

    // Restore auto-backup settings to main process on startup
    try {
        const abCfg = JSON.parse(localStorage.getItem('ac_auto_backup') || 'null');
        if (abCfg && window.api?.setAutoBackup) window.api.setAutoBackup(abCfg);
    } catch {}

    // Game engine controls
    const geBackBtn = document.getElementById('geBackBtn');
    const geFullscreenBtn = document.getElementById('geFullscreenBtn');

    if (geBackBtn) geBackBtn.addEventListener('click', () => { history.back(); });

    if (geFullscreenBtn) {
        geFullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
                geFullscreenBtn.innerHTML = '&#x2715;';
                geFullscreenBtn.title = 'خروج من ملء الشاشة';
            } else {
                document.exitFullscreen().catch(() => {});
                geFullscreenBtn.innerHTML = '&#x26F6;';
                geFullscreenBtn.title = 'ملء الشاشة';
            }
        });
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                geFullscreenBtn.innerHTML = '&#x26F6;';
                geFullscreenBtn.title = 'ملء الشاشة';
            }
        });
    }
});
