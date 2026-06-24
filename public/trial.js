'use strict';

/**
 * trial.js — Global trial-mode gating
 * Sets window.TRIAL_STATUS on load so all pages can check limits.
 */
(async function () {
  const DEFAULT_LIMITS = { maxGroups: 1, maxStudents: 10, maxQuizzes: 2, allowedGames: 3, competitions: false, content: false };

  async function fetchStatus() {
    // Electron path
    if (window.api?.getTrialStatus) {
      try { return await window.api.getTrialStatus(); } catch {}
    }
    // Web / fallback — read from localStorage
    try {
      const t = JSON.parse(localStorage.getItem('ac_trial_v1') || 'null');
      if (!t) return { trial: false };
      const daysLeft = Math.max(0, Math.ceil((new Date(t.expiresAt) - new Date()) / 86400000));
      return { trial: true, daysLeft, daysLimit: t.daysLimit || 7, expiresAt: t.expiresAt, expired: daysLeft <= 0, limits: DEFAULT_LIMITS };
    } catch { return { trial: false }; }
  }

  const status = await fetchStatus();

  // Also check if user has a valid full license — if so, not in trial mode
  if (window.api?.getLicenseStatus) {
    try {
      const lic = await window.api.getLicenseStatus();
      if (lic?.licensed) {
        window.TRIAL_STATUS = { trial: false, licensed: true };
        updateBanner();
        return;
      }
    } catch {}
  }

  window.TRIAL_STATUS = { ...status, limits: status.limits || DEFAULT_LIMITS };
  updateBanner();

  function updateBanner() {
    const banner = document.getElementById('trialBanner');
    if (!banner) return;

    const s = window.TRIAL_STATUS;
    if (!s.trial || s.licensed) { banner.style.display = 'none'; return; }

    if (s.expired) {
      banner.style.display = 'flex';
      banner.style.background = '#fef2f2';
      banner.style.borderBottomColor = '#fca5a5';
      banner.innerHTML = `
        <span style="color:#ef4444;font-weight:700">⛔ انتهت النسخة التجريبية</span>
        <span style="color:#64748b;font-size:.8rem">فعّل البرنامج للاستمرار</span>
        <button onclick="location.href='/pages/activation.html'" style="margin-right:auto;background:#ef4444;color:#fff;border:none;border-radius:8px;padding:5px 14px;font-family:inherit;font-size:.82rem;font-weight:700;cursor:pointer">تفعيل الآن ←</button>`;
    } else {
      banner.style.display = 'flex';
      const urgent = s.daysLeft <= 2;
      banner.style.background = urgent ? '#fffbeb' : '#f0fdfa';
      banner.style.borderBottomColor = urgent ? '#fcd34d' : '#5eead4';
      banner.innerHTML = `
        <span style="color:${urgent ? '#92400e' : '#0f766e'};font-weight:700">${urgent ? '⚠️' : '🎯'} النسخة التجريبية</span>
        <span style="color:#64748b;font-size:.8rem">باقي <strong>${s.daysLeft}</strong> ${s.daysLeft === 1 ? 'يوم' : 'أيام'} من ${s.daysLimit}</span>
        <button onclick="location.href='/pages/activation.html'" style="margin-right:auto;background:#0f766e;color:#fff;border:none;border-radius:8px;padding:5px 14px;font-family:inherit;font-size:.82rem;font-weight:700;cursor:pointer">فعّل الآن ←</button>`;
    }
  }
})();

/**
 * trialBlock(feature) — call from any page before doing a restricted action.
 * Returns true if blocked (show message), false if allowed.
 */
window.trialBlock = function (feature, currentCount) {
  const s = window.TRIAL_STATUS;
  if (!s || !s.trial || s.licensed) return false; // full license or no trial — allow
  if (s.expired) {
    showTrialPopup('انتهت النسخة التجريبية. فعّل البرنامج للاستمرار.');
    return true;
  }
  const L = s.limits || {};
  const msgs = {
    groups:       `النسخة التجريبية تسمح بمجموعة واحدة فقط (${L.maxGroups || 1}).`,
    students:     `النسخة التجريبية تسمح بـ ${L.maxStudents || 10} طلاب فقط.`,
    quizzes:      `النسخة التجريبية تسمح بـ ${L.maxQuizzes || 2} اختبارات فقط.`,
    competitions: 'المسابقات غير متاحة في النسخة التجريبية.',
    content:      'المحتوى التعليمي غير متاح في النسخة التجريبية.',
    games:        `النسخة التجريبية تتيح ${L.allowedGames || 3} ألعاب فقط.`,
  };

  const limits = { groups: L.maxGroups, students: L.maxStudents, quizzes: L.maxQuizzes };
  if (feature in limits && typeof currentCount === 'number' && currentCount < limits[feature]) return false;
  if (feature === 'competitions' && L.competitions !== false) return false;
  if (feature === 'content'      && L.content      !== false) return false;

  showTrialPopup(msgs[feature] || 'هذه الميزة غير متاحة في النسخة التجريبية.');
  return true;
};

function showTrialPopup(msg) {
  let pop = document.getElementById('_trialPop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = '_trialPop';
    pop.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;
      background:#1e293b;color:#fff;padding:14px 20px;border-radius:12px;font-family:Cairo,sans-serif;
      font-size:.88rem;display:flex;align-items:center;gap:14px;box-shadow:0 8px 32px rgba(0,0,0,.25);
      max-width:440px;width:90%;direction:rtl`;
    document.body.appendChild(pop);
  }
  pop.innerHTML = `
    <span style="font-size:1.1rem">🔒</span>
    <span style="flex:1">${msg}</span>
    <a href="/pages/activation.html" style="white-space:nowrap;background:#0f766e;color:#fff;border-radius:7px;padding:5px 12px;text-decoration:none;font-weight:700;font-size:.8rem">فعّل الآن</a>
    <button onclick="this.parentElement.style.display='none'" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;padding:0">✕</button>`;
  pop.style.display = 'flex';
  clearTimeout(pop._t);
  pop._t = setTimeout(() => { if (pop) pop.style.display = 'none'; }, 6000);
}
