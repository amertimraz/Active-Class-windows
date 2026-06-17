/**
 * Active Class - App Initialization Script
 * Handles login, session management, and global UI state.
 */
window.addEventListener('DOMContentLoaded', () => {
    try { window.I18n && window.I18n.apply(document); } catch {}

    const loginScreen = document.getElementById('loginScreen');
    const appShell = document.getElementById('appShell');
    const loginEnter = document.getElementById('loginEnter');
    const loginGuest = document.getElementById('loginGuest');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginUsername = document.getElementById('loginUsername');
    const loginPassword = document.getElementById('loginPassword');
    const loginRemember = document.getElementById('loginRemember');
    const togglePassword = document.getElementById('togglePassword');
    const loginError = document.getElementById('loginError');
    const loginSuccess = document.getElementById('loginSuccess');

    const initApp = () => {
        if (window.__appInited) return;
        if (window.AppRouter && window.AppRouter.init) {
            window.AppRouter.init();
            window.__appInited = true;
        }
    };

    const setSession = (mode, remember) => {
        if (remember) {
            localStorage.setItem('cm_session', mode);
            sessionStorage.removeItem('cm_session');
        } else {
            sessionStorage.setItem('cm_session', mode);
            localStorage.removeItem('cm_session');
        }
    };

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

    const showApp = (mode, remember) => {
        if (mode) {
            setSession(mode, remember);
        }

        resetUiState();
        if (loginScreen) {
            loginScreen.style.display = 'none';
            loginScreen.style.pointerEvents = 'none';
        }
        if (appShell) {
            appShell.classList.add('is-visible');
        }

        if ((window.location.hash || '#/') === '#/settings') {
            window.location.hash = '#/';
        }

        if (!window.location.hash) {
            window.location.hash = '#/';
        }

        initApp();
    };

    const showSuccess = (message) => {
        if (!loginSuccess) return;
        loginSuccess.textContent = message;
        loginSuccess.classList.add('is-visible');
    };

    const clearSuccess = () => {
        if (!loginSuccess) return;
        loginSuccess.textContent = '';
        loginSuccess.classList.remove('is-visible');
    };

    const enterApp = (mode, remember, message) => {
        if (message) {
            showSuccess(message);
            setTimeout(() => showApp(mode, remember), 450);
        } else {
            showApp(mode, remember);
        }
    };

    const showLogin = () => {
        resetUiState();
        if (loginScreen) {
            loginScreen.style.zIndex = '';
            loginScreen.style.pointerEvents = '';
            loginScreen.style.display = '';
            requestAnimationFrame(() => {
                loginScreen.classList.add('is-visible');
            });
        }
        if (appShell) {
            appShell.classList.remove('is-visible');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('cm_session');
        sessionStorage.removeItem('cm_session');
        resetUiState();
        window.location.hash = '#/';
        showLogin();
    };

    // Auto-login logic (commented out in original but effectively implemented via showApp call)
    if (loginScreen) {
        loginScreen.classList.remove('is-visible');
        loginScreen.style.display = 'none';
        loginScreen.style.pointerEvents = 'none';
    }
    showApp();

    const clearError = () => {
        if (loginError) {
            loginError.textContent = '';
            loginError.classList.remove('is-visible');
        }
        clearSuccess();
    };

    const showError = (message) => {
        if (!loginError) return;
        loginError.textContent = message;
        loginError.classList.add('is-visible');
    };

    if (togglePassword && loginPassword) {
        togglePassword.addEventListener('click', () => {
            const isHidden = loginPassword.type === 'password';
            loginPassword.type = isHidden ? 'text' : 'password';
            togglePassword.textContent = isHidden ? 'إخفاء' : 'إظهار';
        });
    }

    if (loginUsername) loginUsername.addEventListener('input', clearError);
    if (loginPassword) loginPassword.addEventListener('input', clearError);

    if (loginEnter) {
        loginEnter.addEventListener('click', () => {
            const username = loginUsername ? loginUsername.value.trim() : '';
            const password = loginPassword ? loginPassword.value.trim() : '';
            if (!username || !password) {
                showError('يرجى إدخال اسم المستخدم وكلمة المرور للمتابعة.');
                if (!username && loginUsername) {
                    loginUsername.focus();
                } else if (loginPassword) {
                    loginPassword.focus();
                }
                return;
            }
            enterApp('member', loginRemember ? loginRemember.checked : false, 'تم تسجيل الدخول بنجاح');
        });
    }

    if (loginGuest) loginGuest.addEventListener('click', () => enterApp('guest', false, 'مرحباً بك كضيف'));
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

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
