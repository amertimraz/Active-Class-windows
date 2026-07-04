(function(){
  'use strict';

  const display = document.getElementById('timerDisplay');
  const progressBar = document.getElementById('progressBar');
  const startPauseBtn = document.getElementById('startPauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const foldBtn = document.querySelector('.fold-btn');
  const closeBtn = document.querySelector('.close-btn');
  const fullscreenBtn = document.querySelector('.fullscreen-btn');

  foldBtn?.addEventListener('click', async () => {
    try {
      const res = await window.api?.openToolWindow?.('timer-settings');
      if (res && res.ok === false) console.error('openToolWindow(timer-settings) failed:', res.error);
    } catch (e) { console.error('openToolWindow(timer-settings) threw:', e); }
  });

  closeBtn?.addEventListener('click', () => {
    if (window.api?.closeWindow) { window.api.closeWindow(); return; }
    window.close();
  });

  // win.isFullScreen() is unreliable for this frameless/transparent window
  // on Windows, so we track the state here instead of asking main to
  // "toggle" based on a query that can get stuck. Applying the CSS class
  // immediately (rather than waiting for the main-process event to echo
  // back) also means the UI updates correctly even if that event never
  // fires for this window config.
  let isFullscreenState = false;
  function setFullscreen(flag) {
    isFullscreenState = !!flag;
    document.body.classList.toggle('is-fullscreen', isFullscreenState);
    fullscreenBtn?.classList.toggle('is-active', isFullscreenState);
    window.api?.setFullscreen?.(isFullscreenState);
  }
  fullscreenBtn?.addEventListener('click', () => setFullscreen(!isFullscreenState));
  window.api?.onFullscreenChange?.((isFullscreen) => {
    document.body.classList.toggle('is-fullscreen', !!isFullscreen);
    fullscreenBtn?.classList.toggle('is-active', !!isFullscreen);
    isFullscreenState = !!isFullscreen;
  });

  const config = { countType: 'countdown', hours: 0, minutes: 5, seconds: 0, soundOn: true };
  let totalSeconds = 0;
  let remainingSeconds = 0;
  let state = 'stopped'; // stopped | running | paused
  let intervalId = null;

  function resetFromConfig() {
    if (config.countType === 'countdown') {
      totalSeconds = config.hours * 3600 + config.minutes * 60 + config.seconds;
      remainingSeconds = totalSeconds;
    } else {
      totalSeconds = 0;
      remainingSeconds = 0;
    }
  }

  window.api?.onTimerSettingsUpdate?.((data) => {
    Object.assign(config, data);
    if (state === 'stopped') resetFromConfig();
    updateDisplay();
  });

  function formatTime(displayTime) {
    const h = Math.floor(Math.abs(displayTime) / 3600);
    const m = Math.floor((Math.abs(displayTime) % 3600) / 60);
    const s = Math.abs(displayTime) % 60;
    if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function updateDisplay() {
    display.textContent = formatTime(remainingSeconds);

    if (config.countType === 'countdown' && totalSeconds > 0) {
      progressBar.style.width = `${((totalSeconds - remainingSeconds) / totalSeconds) * 100}%`;
    } else {
      progressBar.style.width = '0%';
    }

    display.classList.remove('is-warning', 'is-danger');
    if (config.countType === 'countdown') {
      if (remainingSeconds <= 10 && remainingSeconds > 0) display.classList.add('is-danger');
      else if (remainingSeconds <= 60 && remainingSeconds > 10) display.classList.add('is-warning');
    }
  }

  // Sound
  let audioCtx;
  function ensureAudio() { if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) {} } }
  function playTick() {
    if (!config.soundOn) return;
    ensureAudio();
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.0008, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0008, audioCtx.currentTime + 0.15);
      osc.start(); osc.stop(audioCtx.currentTime + 0.15);
    } catch(_) {}
  }
  function playAlarm() {
    if (!config.soundOn) return;
    ensureAudio();
    if (!audioCtx) return;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        try {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain); gain.connect(audioCtx.destination);
          osc.frequency.setValueAtTime(800, audioCtx.currentTime);
          gain.gain.setValueAtTime(0, audioCtx.currentTime);
          gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.1);
          gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
          osc.start(); osc.stop(audioCtx.currentTime + 0.5);
        } catch(_) {}
      }, i * 600);
    }
  }

  function updateButton() {
    startPauseBtn.classList.remove('is-paused', 'is-running');
    if (state === 'stopped') startPauseBtn.textContent = 'ابدأ';
    else if (state === 'running') { startPauseBtn.textContent = 'إيقاف مؤقت'; startPauseBtn.classList.add('is-running'); }
    else if (state === 'paused') { startPauseBtn.textContent = 'استئناف'; startPauseBtn.classList.add('is-paused'); }
  }

  function tick() {
    if (config.countType === 'countdown') {
      remainingSeconds--;
      if (remainingSeconds <= 0) { finish(); return; }
      if (remainingSeconds <= 10) playTick();
    } else {
      remainingSeconds++;
    }
    updateDisplay();
  }

  function start() {
    if (config.countType === 'countdown' && remainingSeconds <= 0) {
      resetFromConfig();
      if (remainingSeconds <= 0) return;
    }
    window.api?.closeTimerSettings?.();
    state = 'running';
    updateButton();
    intervalId = setInterval(tick, 1000);
  }

  function pause() {
    clearInterval(intervalId);
    state = 'paused';
    updateButton();
  }

  function resume() {
    state = 'running';
    updateButton();
    intervalId = setInterval(tick, 1000);
  }

  function reset() {
    clearInterval(intervalId);
    state = 'stopped';
    resetFromConfig();
    updateButton();
    updateDisplay();
  }

  function finish() {
    clearInterval(intervalId);
    state = 'stopped';
    updateButton();
    playAlarm();
    display.textContent = '00:00';
    if (window.UXEnhancements) window.UXEnhancements.showNotification('انتهى الوقت!', 'warning');
    setTimeout(reset, 3000);
  }

  startPauseBtn.addEventListener('click', () => {
    if (state === 'stopped') start();
    else if (state === 'running') pause();
    else if (state === 'paused') resume();
  });
  resetBtn.addEventListener('click', reset);

  // Init
  resetFromConfig();
  updateButton();
  updateDisplay();
})();
