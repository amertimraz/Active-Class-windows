(function(){
  'use strict';

  // DOM Elements
  const sourceSelect = document.getElementById('sourceSelect');
  const groupControl = document.getElementById('groupControl');
  const groupSelect = document.getElementById('groupSelect');
  const manualControl = document.getElementById('manualControl');
  const manualNames = document.getElementById('manualNames');
  const addSampleBtn = document.getElementById('addSampleBtn');
  const clearManualBtn = document.getElementById('clearManualBtn');
  const pickBtn = document.getElementById('pickBtn');
  const display = document.getElementById('display');
  const availableCount = document.getElementById('availableCount');
  const pickedCount = document.getElementById('pickedCount');
  const excludePicked = document.getElementById('excludePicked');
  const soundToggle = document.getElementById('soundToggle');

  // Shell & Header Controls
  const shell = document.querySelector('.tool-shell');
  const foldBtn = document.querySelector('.fold-btn');
  const pinBtn = document.querySelector('.pin-btn');
  const closeBtn = document.querySelector('.close-btn');

  // Handle embedded vs standalone
  try {
    if (window.top !== window) {
      const header = document.querySelector('.tool-header');
      if (header) header.style.display = 'none'; // Optional: hide header if in modal
    }
  } catch (_) {}

  // Sound Logic
  let audioCtx;
  const beep = () => {
    if (soundToggle && !soundToggle.checked) return;
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
    if (soundToggle && !soundToggle.checked) return;
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
  let groups = [];
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
        <div class="placeholder-icon">🎲</div>
        <p>اختر مجموعة وابدأ السحب العشوائي</p>
      </div>
    `;
  };

  const updateAvailable = () => {
    const source = sourceSelect.value;
    if (source === 'group') {
      allNames = students.map(s => ({ id: s.id, name: s.name }));
    } else {
      const lines = manualNames.value.trim() ? manualNames.value.split('\n').map(t=>t.trim()).filter(Boolean) : [];
      allNames = lines.map((name, i) => ({ id: `m_${i}`, name }));
    }
    
    const pool = excludePicked.checked ? allNames.filter(n => !pickedIds.has(n.id)) : allNames;
    availableCount.textContent = pool.length;
    pickedCount.textContent = pickedIds.size;
    pickBtn.disabled = pool.length === 0;
  };

  let isFirstPick = true;
  const pick = async () => {
    const pool = excludePicked.checked ? allNames.filter(n => !pickedIds.has(n.id)) : allNames;
    if (pool.length === 0) return;

    // طي تلقائي عند أول اختيار لتوفير المساحة
    if (isFirstPick) {
      if (!shell.classList.contains('compact-mode')) {
        shell.classList.add('compact-mode');
        if (foldBtn) foldBtn.classList.add('is-folded');
        if (window.api && window.api.resizeWindow) {
          window.api.resizeWindow(400, 320);
        }
      }
      isFirstPick = false;
    }

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
        display.innerHTML = `<div class="winner-name" style="opacity:0.7; transform:scale(0.8)">${sequence[i]}</div>`;
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

      if (excludePicked.checked) {
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

  // Event Listeners
  sourceSelect.addEventListener('change', () => {
    const isGroup = sourceSelect.value === 'group';
    groupControl.style.display = isGroup ? '' : 'none';
    manualControl.style.display = isGroup ? 'none' : 'block';
    setPlaceholder();
    updateAvailable();
  });

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

  groupSelect.addEventListener('change', async () => {
    const gid = groupSelect.value;
    if (gid) {
      const all = await loadStudentsData();
      students = all.filter(s => s.groupId === gid);
    } else {
      students = [];
    }
    setPlaceholder();
    updateAvailable();
  });

  manualNames.addEventListener('input', updateAvailable);
  excludePicked.addEventListener('change', updateAvailable);
  pickBtn.addEventListener('click', pick);

  addSampleBtn.addEventListener('click', () => {
    manualNames.value = "أحمد محمد\nسارة خالد\nيوسف إبراهيم\nمريم حسن\nعلي حسن\nنورة سالم";
    updateAvailable();
  });

  clearManualBtn.addEventListener('click', () => {
    manualNames.value = "";
    updateAvailable();
  });

  // Header Actions
  foldBtn?.addEventListener('click', () => {
    shell.classList.toggle('compact-mode');
    const isCompact = shell.classList.contains('compact-mode');
    foldBtn.classList.toggle('is-folded', isCompact);
    
    // Resize window if standalone (Compact height is smaller)
    if (window.api && window.api.resizeWindow) {
      window.api.resizeWindow(400, isCompact ? 320 : 520);
    }
    // Notify parent if in modal
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'names:compact-mode', enabled: isCompact }, '*');
    }
  });

  let isPinned = true;
  if (pinBtn) pinBtn.classList.add('active-pin');
  pinBtn?.addEventListener('click', async () => {
    isPinned = !isPinned;
    pinBtn.classList.toggle('active-pin', isPinned);
    
    if (window.api && window.api.setAlwaysOnTop) {
      await window.api.setAlwaysOnTop(isPinned);
      if (window.UXEnhancements) {
        window.UXEnhancements.showNotification(isPinned ? '📌 تم تثبيت النافذة في المقدمة' : '🔓 تم إلغاء التثبيت', 'info');
      }
    }
  });

  closeBtn?.addEventListener('click', () => {
    if (window.api?.closeWindow) { window.api.closeWindow(); return; }
    if (window.api?.close)       { window.api.close();       return; }
    window.close();
  });

  // Load groups — tries IPC first, falls back to direct HTTP fetch
  async function loadGroupsData() {
    try {
      const api = window.api || (window.parent?.api);
      if (api?.loadGroups) {
        const result = await api.loadGroups();
        if (Array.isArray(result) && result.length > 0) return result;
      }
    } catch(e) { console.error('IPC loadGroups failed:', e); }
    // Fallback: direct fetch from server
    try {
      const res = await fetch('http://localhost:5000/api/groups');
      if (res.ok) return await res.json();
    } catch(e) { console.error('fetch loadGroups failed:', e); }
    return [];
  }

  async function renderGroups() {
    groups = await loadGroupsData();
    groupSelect.innerHTML = '<option value="">— اختر مجموعة —</option>';
    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id; opt.textContent = g.name;
      groupSelect.appendChild(opt);
    });
    updateAvailable();
  }

  // Init
  (async function init(){
    setPlaceholder();
    await renderGroups();
  })();

})();