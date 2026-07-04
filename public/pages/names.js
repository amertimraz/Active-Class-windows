(function(){
  'use strict';

  const pickBtn = document.getElementById('pickBtn');
  const display = document.getElementById('display');
  const availableCount = document.getElementById('availableCount');
  const pickedCount = document.getElementById('pickedCount');

  const foldBtn = document.querySelector('.fold-btn');
  const closeBtn = document.querySelector('.close-btn');

  // Settings live in a separate small popover window (names-settings.html) —
  // this window stays one fixed tiny size forever; no more resizing it to
  // fit an inline settings panel, which kept hitting an Electron/Windows
  // repaint bug on transparent frameless windows.
  foldBtn?.addEventListener('click', async () => {
    try {
      const res = await window.api?.openToolWindow?.('names-settings');
      if (res && res.ok === false) console.error('openToolWindow(names-settings) failed:', res.error);
    } catch (e) { console.error('openToolWindow(names-settings) threw:', e); }
  });

  // Settings state — mirrors what the settings popover holds, kept in sync
  // via names-settings-update messages instead of being read from local DOM.
  const config = {
    source: 'group',
    groupId: '',
    manualText: '',
    excludePicked: true,
    soundOn: true
  };

  window.api?.onNamesSettingsUpdate?.(async (data) => {
    const groupChanged = data.groupId !== config.groupId;
    Object.assign(config, data);
    if (config.source === 'group' && groupChanged) {
      students = config.groupId ? await loadStudentsForGroup(config.groupId) : [];
    }
    setPlaceholder();
    updateAvailable();
  });

  // Sound Logic
  let audioCtx;
  const beep = () => {
    if (!config.soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(660, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
      osc.stop(audioCtx.currentTime + 0.25);
    } catch(_) {}
  };

  const playTick = () => {
    if (!config.soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(420, audioCtx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.05, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
      osc.start(); osc.stop(audioCtx.currentTime + 0.05);
    } catch(_) {}
  };

  // App State
  let students = [];
  let allNames = [];
  const pickedIds = new Set();

  const notify = (msg) => {
    if (window.UXEnhancements) window.UXEnhancements.showNotification(msg, 'info');
    else alert(msg);
  };

  const setPlaceholder = () => {
    display.innerHTML = `
      <div class="placeholder">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/></svg>
        <p>اختر مجموعة من الإعدادات ثم اضغط اختيار</p>
      </div>
    `;
  };

  const updateAvailable = () => {
    if (config.source === 'group') {
      allNames = students.map(s => ({ id: s.id, name: s.name }));
    } else {
      const lines = config.manualText.trim() ? config.manualText.split('\n').map(t=>t.trim()).filter(Boolean) : [];
      allNames = lines.map((name, i) => ({ id: `m_${i}`, name }));
    }

    const pool = config.excludePicked ? allNames.filter(n => !pickedIds.has(n.id)) : allNames;
    availableCount.textContent = pool.length;
    pickedCount.textContent = pickedIds.size;
    pickBtn.disabled = pool.length === 0;
  };

  const pick = async () => {
    const pool = config.excludePicked ? allNames.filter(n => !pickedIds.has(n.id)) : allNames;
    if (pool.length === 0) return;

    window.api?.closeNamesSettings?.();
    pickBtn.disabled = true;
    display.classList.add('picking');

    // Prepare sequence
    const names = pool.map(n => n.name);
    const sequence = [];
    const steps = Math.max(20, names.length * 3);
    for (let i = 0; i < steps; i++) {
      sequence.push(names[Math.floor(Math.random() * names.length)]);
    }

    let i = 0;
    const minDelay = 30;
    const maxDelay = 200;

    const runStep = () => {
      if (i < sequence.length) {
        display.innerHTML = `<div class="winner-name">${sequence[i]}</div>`;
        playTick();
        const t = i / (sequence.length - 1);
        const delay = minDelay + (maxDelay - minDelay) * (t * t); // easeInQuad for slowing down
        i++;
        setTimeout(runStep, delay);
      } else {
        finalize();
      }
    };

    const finalize = () => {
      display.classList.remove('picking');
      const winner = pool[Math.floor(Math.random() * pool.length)];

      display.innerHTML = `<div class="winner-name">${winner.name}</div>`;
      beep();

      if (config.excludePicked) {
        pickedIds.add(winner.id);
        if (allNames.filter(n => !pickedIds.has(n.id)).length === 0) {
          pickedIds.clear();
          notify('تم سحب جميع الأسماء، تمت إعادة التصفير تلقائياً');
        }
      }

      updateAvailable();
      pickBtn.disabled = false;
    };

    runStep();
  };

  pickBtn.addEventListener('click', pick);

  async function loadStudentsForGroup(groupId) {
    try {
      const all = await loadStudentsData();
      return all.filter(s => s.groupId === groupId);
    } catch(e) { console.error('load students failed:', e); return []; }
  }

  async function loadStudentsData() {
    try {
      const api = window.api || (window.parent?.api);
      if (api?.loadStudents) {
        const result = await api.loadStudents();
        if (Array.isArray(result) && result.length > 0) return result;
      }
    } catch(e) { console.error('IPC loadStudents failed:', e); }
    try {
      const res = await fetch('http://localhost:5000/api/students');
      if (res.ok) return await res.json();
    } catch(e) { console.error('fetch loadStudents failed:', e); }
    return [];
  }

  closeBtn?.addEventListener('click', () => {
    if (window.api?.closeWindow) { window.api.closeWindow(); return; }
    if (window.api?.close)       { window.api.close();       return; }
    window.close();
  });

  // Init
  setPlaceholder();
  updateAvailable();

})();
