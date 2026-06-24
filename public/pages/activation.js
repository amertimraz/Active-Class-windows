'use strict';

(function () {
  // ── Config ────────────────────────────────────────────────────────────────
  const ADMIN_WHATSAPP = '201096066818';
  // ضع هنا رابط الـ Web App بعد نشر Google Apps Script
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyTzd-OZZUyrt7km1gYzFLRnSndASq_fAv5JmtDEV6CV-cYNrancbIN9zC6gVRRwMns/exec';

  const hasAPI = typeof window !== 'undefined' && !!window.api;
  const LS_KEY = 'ac_license_v1';
  const LS_REG = 'ac_registration_v1';

  // ── State ─────────────────────────────────────────────────────────────────
  let machineId   = 'UNKNOWN';
  let regName     = '';
  let regPhone    = '';

  // ── DOM ───────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // Window controls
  $('btnClose')?.addEventListener('click', () => window.api?.close?.());
  $('btnMin')?.addEventListener('click',   () => window.api?.minimize?.());
  $('btnMax')?.addEventListener('click',   () => window.api?.maximize?.());

  // ── Show / hide states ────────────────────────────────────────────────────
  const STATES = ['stateRegister', 'stateActivate', 'stateSuccess', 'stateAlreadyActive', 'stateExpired'];
  function showState(name) {
    STATES.forEach(id => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', id !== name);
    });
  }

  // ── Machine ID ────────────────────────────────────────────────────────────
  async function loadMachineId() {
    try {
      if (hasAPI && window.api.getMachineId) {
        machineId = await window.api.getMachineId();
      } else {
        machineId = btoa(navigator.userAgent + screen.width + screen.height)
          .replace(/[^A-Z0-9]/gi, '').slice(0, 24).toUpperCase();
      }
    } catch { machineId = 'OFFLINE'; }
    const el = $('machineIdDisplay');
    if (el) el.textContent = machineId;
  }

  // ── Local storage helpers ─────────────────────────────────────────────────
  function saveLicense(data) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ ...data, machineId, savedAt: Date.now() })); } catch {}
  }
  function loadLicense() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
  }
  function clearLicense() { localStorage.removeItem(LS_KEY); }

  function saveRegistration(name, phone) {
    try { localStorage.setItem(LS_REG, JSON.stringify({ name, phone })); } catch {}
  }
  function loadRegistration() {
    try { return JSON.parse(localStorage.getItem(LS_REG) || 'null'); } catch { return null; }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function daysLeft(expiresAt) {
    return Math.max(0, Math.ceil((new Date(expiresAt) - new Date()) / 86400000));
  }
  function showMsg(id, text, type = 'error') {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = `msg ${type}`;
  }
  function hideMsg(id) {
    const el = $(id);
    if (el) el.className = 'msg hidden';
  }
  function shake(el) {
    el?.classList.remove('shake');
    void el?.offsetWidth;
    el?.classList.add('shake');
    setTimeout(() => el?.classList.remove('shake'), 500);
  }

  // ── STEP 1: Registration ──────────────────────────────────────────────────
  $('btnSendRequest')?.addEventListener('click', () => {
    const nameVal  = $('regName')?.value.trim();
    const phoneVal = $('regPhone')?.value.trim();

    hideMsg('regMsg');
    $('regName')?.classList.remove('error');
    $('regPhone')?.classList.remove('error');

    if (!nameVal) {
      $('regName')?.classList.add('error');
      showMsg('regMsg', 'من فضلك أدخل اسمك الكامل');
      shake($('regName'));
      return;
    }
    if (!phoneVal || phoneVal.replace(/\D/g, '').length < 10) {
      $('regPhone')?.classList.add('error');
      showMsg('regMsg', 'من فضلك أدخل رقم موبايل صحيح');
      shake($('regPhone'));
      return;
    }

    regName  = nameVal;
    regPhone = phoneVal;
    saveRegistration(regName, regPhone);

    // بعت الطلب للـ API في الخلفية (مش بيوقف المستخدم لو فشل)
    if (SCRIPT_URL) {
      fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'register', name: regName, phone: regPhone, machineId }),
      }).catch(() => {});
    }

    // Move to step 2
    goToActivateStep();
  });

  $('btnStartTrial')?.addEventListener('click', async () => {
    const btn = $('btnStartTrial');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري التفعيل...'; }
    try {
      if (hasAPI && window.api.startTrial) {
        await window.api.startTrial();
        // main.js redirects automatically after startTrial
      } else {
        // Web fallback — store in localStorage
        const exp = new Date(); exp.setDate(exp.getDate() + 7);
        localStorage.setItem('ac_trial_v1', JSON.stringify({ startedAt: new Date().toISOString(), expiresAt: exp.toISOString(), daysLimit: 7 }));
        window.location.href = '/';
      }
    } catch { if (btn) { btn.disabled = false; btn.textContent = 'جرّب مجاناً لمدة 7 أيام'; } }
  });

  $('btnAlreadyHaveKey')?.addEventListener('click', () => {
    const nameVal  = $('regName')?.value.trim();
    const phoneVal = $('regPhone')?.value.trim();
    if (nameVal)  regName  = nameVal;
    if (phoneVal) regPhone = phoneVal;
    if (!regName || !regPhone) {
      // Load from saved if available
      const saved = loadRegistration();
      if (saved) { regName = saved.name; regPhone = saved.phone; }
    }
    goToActivateStep();
  });

  function goToActivateStep() {
    $('summaryName')?.textContent  !== undefined && ($('summaryName').textContent  = regName  || '—');
    $('summaryPhone')?.textContent !== undefined && ($('summaryPhone').textContent = regPhone || '—');
    $('summaryMachineId')?.textContent !== undefined && ($('summaryMachineId').textContent = machineId);
    buildSegments();
    showState('stateActivate');
    setTimeout(() => $('keyInput')?.focus(), 300);
  }

  $('btnWhatsappSupport')?.addEventListener('click', () => {
    const msg = encodeURIComponent(
      `🔔 *طلب تفعيل Active Class*\n\n` +
      `👤 الاسم: ${regName || '—'}\n` +
      `📱 الموبايل: ${regPhone || '—'}\n` +
      `🖥️ معرّف الجهاز: ${machineId}`
    );
    const url = `https://wa.me/${ADMIN_WHATSAPP}?text=${msg}`;
    if (hasAPI && window.api.openExternal) window.api.openExternal(url);
    else window.open(url, '_blank');
  });

  $('btnBackToRegister')?.addEventListener('click', () => {
    hideMsg('keyMsg');
    showState('stateRegister');
    if (regName)  $('regName').value  = regName;
    if (regPhone) $('regPhone').value = regPhone;
  });

  // ── STEP 2: Key Entry ─────────────────────────────────────────────────────
  const SEG_LEN   = 5;
  const SEG_COUNT = 4;

  function buildSegments() {
    const wrap = $('keySegments');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (let s = 0; s < SEG_COUNT; s++) {
      for (let c = 0; c < SEG_LEN; c++) {
        const span = document.createElement('span');
        span.className = 'seg';
        span.dataset.pos = String(s * SEG_LEN + c);
        wrap.appendChild(span);
      }
      if (s < SEG_COUNT - 1) {
        const sep = document.createElement('span');
        sep.className = 'seg-sep';
        sep.textContent = '—';
        wrap.appendChild(sep);
      }
    }
  }

  function updateSegments(raw) {
    const chars = raw.replace(/-/g, '').toUpperCase();
    $('keySegments')?.querySelectorAll('.seg').forEach(span => {
      const pos = Number(span.dataset.pos);
      const ch  = chars[pos] || '';
      span.textContent = ch || '·';
      span.className   = 'seg' + (ch ? ' filled' : '');
    });
  }

  function formatKey(val) {
    const raw = val.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, SEG_LEN * SEG_COUNT);
    const segs = [];
    for (let i = 0; i < SEG_COUNT; i++) segs.push(raw.slice(i * SEG_LEN, (i + 1) * SEG_LEN));
    return segs.filter(Boolean).join('-');
  }

  $('keyInput')?.addEventListener('input', e => {
    const pos = e.target.selectionStart;
    const fmt = formatKey(e.target.value);
    e.target.value = fmt;
    const np = Math.min(pos, fmt.length);
    e.target.setSelectionRange(np, np);
    updateSegments(fmt);
    hideMsg('keyMsg');
    $('keyInput').classList.remove('error', 'success');
  });

  $('keyInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btnActivate')?.click();
  });

  // ── Activate ──────────────────────────────────────────────────────────────
  $('btnActivate')?.addEventListener('click', async () => {
    const key = $('keyInput')?.value?.trim();
    if (!key || key.replace(/-/g, '').length < SEG_LEN * SEG_COUNT) {
      showMsg('keyMsg', 'أدخل كود التفعيل كاملاً');
      shake($('keyInput'));
      $('keyInput')?.classList.add('error');
      return;
    }

    setActivating(true);
    hideMsg('keyMsg');

    try {
      let result;

      if (hasAPI && window.api.activateLicense) {
        result = await window.api.activateLicense(key, machineId, regName, regPhone);
      } else if (SCRIPT_URL) {
        // تحقق مباشر من Google Apps Script
        const r = await fetch(SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'verify', key, machineId }),
        });
        result = await r.json();
      } else {
        await new Promise(r => setTimeout(r, 1200));
        result = simulateActivation(key);
      }

      if (result.ok) {
        saveLicense({ ...result, name: regName, phone: regPhone });
        showSuccessState({ ...result, name: regName });
      } else {
        showMsg('keyMsg', result.message || 'كود غير صحيح أو منتهي الصلاحية');
        $('keyInput')?.classList.add('error');
        shake($('keyInput'));
      }
    } catch {
      showMsg('keyMsg', 'تعذّر الاتصال — تحقق من الإنترنت وأعد المحاولة');
    } finally {
      setActivating(false);
    }
  });

  function setActivating(on) {
    const btn = $('btnActivate');
    if (!btn) return;
    btn.disabled = on;
    $('btnActivateText').textContent = on ? 'جاري التحقق...' : 'تفعيل الترخيص';
    $('btnActivateSpinner')?.classList.toggle('hidden', !on);
  }

  // Demo mode — accept any key starting with ACTCLS
  function simulateActivation(key) {
    if (key.toUpperCase().replace(/-/g, '').startsWith('ACTCLS')) {
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1);
      return { ok: true, plan: 'Pro سنوي', expiresAt: expiry.toISOString().split('T')[0], daysLeft: 365, totalDays: 365 };
    }
    return { ok: false, message: 'كود غير صحيح' };
  }

  // ── Render states ─────────────────────────────────────────────────────────
  function showSuccessState(data) {
    $('successName').textContent   = data.name   || '';
    $('successPlan').textContent   = data.plan   || 'Pro';
    $('successExpiry').textContent = formatDate(data.expiresAt);
    $('successDays').textContent   = `${data.daysLeft} يوم`;
    const pct = Math.min(100, Math.round((data.daysLeft / (data.totalDays || 365)) * 100));
    $('successDaysPct').textContent = pct + '%';
    setTimeout(() => { if ($('successDaysBar')) $('successDaysBar').style.width = pct + '%'; }, 100);
    showState('stateSuccess');
  }

  function showAlreadyActiveState(lic) {
    const days = daysLeft(lic.expiresAt);
    const pct  = Math.min(100, Math.round((days / (lic.totalDays || 365)) * 100));
    $('activeName').textContent    = lic.name    || 'المستخدم';
    $('activePlan').textContent    = lic.plan    || 'Pro';
    $('activeExpiry').textContent  = formatDate(lic.expiresAt);
    $('activeDaysLeft').textContent= `${days} يوم`;
    $('activeDaysPct').textContent = pct + '%';
    setTimeout(() => { if ($('activeDaysBar')) $('activeDaysBar').style.width = pct + '%'; }, 100);
    showState('stateAlreadyActive');
  }

  function showExpiredState(lic) {
    $('expiredDate').textContent = formatDate(lic.expiresAt);
    showState('stateExpired');
  }

  // ── Enter app ─────────────────────────────────────────────────────────────
  function enterApp() {
    if (hasAPI && window.api.licenseVerified) {
      window.api.licenseVerified();
    } else {
      window.location.href = '/';
    }
  }

  $('btnEnterApp')?.addEventListener('click',  enterApp);
  $('btnEnterApp2')?.addEventListener('click', enterApp);

  $('btnChangeKey')?.addEventListener('click', () => {
    clearLicense();
    const reg = loadRegistration();
    if (reg) { regName = reg.name; regPhone = reg.phone; }
    goToActivateStep();
  });

  $('btnExpiredChangeKey')?.addEventListener('click', () => {
    clearLicense();
    const reg = loadRegistration();
    if (reg) { regName = reg.name; regPhone = reg.phone; }
    goToActivateStep();
  });

  $('btnRenew')?.addEventListener('click', () => {
    const lic = loadLicense() || {};
    const msg = encodeURIComponent(
      `🔄 *طلب تجديد ترخيص Active Class*\n\n` +
      `👤 الاسم: ${lic.name || regName || '—'}\n` +
      `📱 الموبايل: ${lic.phone || regPhone || '—'}\n` +
      `🖥️ معرّف الجهاز: ${machineId}\n` +
      `📅 انتهى في: ${formatDate(lic.expiresAt)}`
    );
    const waURL = `https://wa.me/${ADMIN_WHATSAPP}?text=${msg}`;
    if (hasAPI && window.api.openExternal) window.api.openExternal(waURL);
    else window.open(waURL, '_blank');
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    await loadMachineId();

    const lic = loadLicense();

    if (lic?.expiresAt) {
      const days = daysLeft(lic.expiresAt);
      if (days <= 0) {
        showExpiredState(lic);
        return;
      }
      // Silent server re-verify
      if (hasAPI && window.api.verifyLicense) {
        window.api.verifyLicense(lic.key, machineId).then(res => {
          if (res && !res.ok && !res.offline) { clearLicense(); showState('stateRegister'); }
        }).catch(() => {});
      }
      showAlreadyActiveState(lic);
      return;
    }

    // If already registered → skip to step 2
    const reg = loadRegistration();
    if (reg?.name && reg?.phone) {
      regName  = reg.name;
      regPhone = reg.phone;
      goToActivateStep();
      return;
    }

    showState('stateRegister');
    setTimeout(() => $('regName')?.focus(), 300);
  }

  init();
})();
