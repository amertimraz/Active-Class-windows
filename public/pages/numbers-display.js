(function(){
  'use strict';

  const generateBtn = document.getElementById('generateBtn');
  const display = document.getElementById('display');
  const statsBar = document.getElementById('statsBar');
  const foldBtn = document.querySelector('.fold-btn');
  const closeBtn = document.querySelector('.close-btn');

  foldBtn?.addEventListener('click', async () => {
    try {
      const res = await window.api?.openToolWindow?.('numbers-settings');
      if (res && res.ok === false) console.error('openToolWindow(numbers-settings) failed:', res.error);
    } catch (e) { console.error('openToolWindow(numbers-settings) threw:', e); }
  });

  closeBtn?.addEventListener('click', () => {
    if (window.api?.closeWindow) { window.api.closeWindow(); return; }
    window.close();
  });

  const config = { min: 1, max: 10, count: 1, soundOn: true, noRepeat: false };
  let usedNumbers = [];

  window.api?.onNumbersSettingsUpdate?.((data) => {
    const rangeChanged = data.min !== config.min || data.max !== config.max;
    const repeatChanged = data.noRepeat !== config.noRepeat;
    Object.assign(config, data);
    if (rangeChanged || (repeatChanged && !config.noRepeat)) usedNumbers = [];
    updateStats();
  });

  function setPlaceholder() {
    display.classList.remove('running');
    display.innerHTML = `
      <div class="placeholder">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01"/></svg>
        <p>اضبط النطاق من الإعدادات ثم اضغط اختيار</p>
      </div>
    `;
  }

  function updateStats() {
    if (!config.noRepeat) { statsBar.textContent = ''; return; }
    const total = (config.max - config.min) + 1;
    const remaining = Math.max(0, total - usedNumbers.length);
    statsBar.textContent = `متبقي: ${remaining} من ${total}`;
  }

  // Sound
  let audioCtx;
  function ensureAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) {} }
  }
  function playTick() {
    if (!config.soundOn || !audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
      osc.start(); osc.stop(audioCtx.currentTime + 0.05);
    } catch(_) {}
  }
  function playSuccess() {
    if (!config.soundOn || !audioCtx) return;
    try {
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const startAt = audioCtx.currentTime + i * 0.1;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(freq, startAt);
        gain.gain.setValueAtTime(0.001, startAt);
        gain.gain.linearRampToValueAtTime(0.12, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.2);
        osc.start(startAt); osc.stop(startAt + 0.2);
      });
    } catch(_) {}
  }

  function pickNumbers(min, max, count, excludeUsed) {
    const pool = [];
    for (let i = min; i <= max; i++) {
      if (!excludeUsed || !usedNumbers.includes(i)) pool.push(i);
    }
    const result = [];
    for (let i = 0; i < count && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      result.push(pool.splice(idx, 1)[0]);
    }
    return result;
  }

  function notify(msg) {
    if (window.UXEnhancements) window.UXEnhancements.showNotification(msg, 'info');
  }

  function generate() {
    const { min, max, count, noRepeat } = config;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || count < 1) return;

    const rangeSize = (max - min) + 1;
    if (noRepeat && (rangeSize - usedNumbers.length) < count) {
      notify('لا يوجد أرقام كافية متبقية في هذا النطاق');
      return;
    }

    window.api?.closeNumbersSettings?.();
    generateBtn.disabled = true;
    display.classList.add('running');
    ensureAudio();

    const runPool = [];
    for (let i = min; i <= max; i++) runPool.push(i);
    for (let s = 0; s < 3; s++) {
      for (let i = runPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [runPool[i], runPool[j]] = [runPool[j], runPool[i]];
      }
    }
    const duration = 1000;
    const sequence = [];
    const steps = Math.max(20, runPool.length * 3);
    for (let i = 0; i < steps; i++) sequence.push(runPool[i % runPool.length]);
    const speed = Math.max(30, duration / sequence.length);

    let i = 0;
    const runStep = () => {
      if (i < sequence.length) {
        display.innerHTML = `<div class="big-number">${sequence[i]}</div>`;
        playTick();
        i++;
        setTimeout(runStep, speed);
      } else {
        finalize();
      }
    };

    const finalize = () => {
      display.classList.remove('running');
      const numbers = pickNumbers(min, max, count, noRepeat);
      if (numbers.length === 1) {
        display.innerHTML = `<div class="big-number">${numbers[0]}</div>`;
      } else {
        display.innerHTML = `<div class="number-list">${numbers.map(n => `<span class="number-chip">${n}</span>`).join('')}</div>`;
      }
      playSuccess();
      if (noRepeat) usedNumbers.push(...numbers);
      updateStats();
      generateBtn.disabled = false;
    };

    runStep();
  }

  generateBtn.addEventListener('click', generate);

  // Init
  setPlaceholder();
  updateStats();
})();
