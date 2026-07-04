(function(){
  'use strict';

  const nameInput = document.getElementById('nameInput');
  const addNameBtn = document.getElementById('addNameBtn');
  const groupSelect = document.getElementById('groupSelect');
  const loadGroupBtn = document.getElementById('loadGroupBtn');
  const participantsList = document.getElementById('participantsList');
  const participantsCount = document.getElementById('participantsCount');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const excludeWinner = document.getElementById('excludeWinner');
  const soundToggle = document.getElementById('soundToggle');
  const closeBtn = document.querySelector('.close-btn');

  let participants = [];

  function sendUpdate() {
    if (!window.api?.sendWheelSettingsUpdate) return;
    window.api.sendWheelSettingsUpdate({
      participants: [...participants],
      excludeWinner: excludeWinner.checked,
      soundOn: soundToggle.checked
    });
  }

  function renderList() {
    participantsCount.textContent = participants.length;
    if (participants.length === 0) {
      participantsList.innerHTML = '<div class="empty-state">لا يوجد مشاركون بعد</div>';
      return;
    }
    participantsList.innerHTML = '';
    participants.forEach((name, i) => {
      const item = document.createElement('div');
      item.className = 'participant-item';
      const span = document.createElement('span');
      span.textContent = name;
      const btn = document.createElement('button');
      btn.className = 'remove-btn';
      btn.textContent = '×';
      btn.addEventListener('click', () => {
        participants.splice(i, 1);
        renderList();
        sendUpdate();
      });
      item.appendChild(span);
      item.appendChild(btn);
      participantsList.appendChild(item);
    });
  }

  function addParticipant() {
    const name = nameInput.value.trim();
    if (!name) return;
    if (participants.includes(name)) { nameInput.value = ''; return; }
    participants.push(name);
    nameInput.value = '';
    renderList();
    sendUpdate();
  }

  addNameBtn.addEventListener('click', addParticipant);
  nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addParticipant(); });

  shuffleBtn.addEventListener('click', () => {
    for (let i = participants.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [participants[i], participants[j]] = [participants[j], participants[i]];
    }
    renderList();
    sendUpdate();
  });

  clearAllBtn.addEventListener('click', () => {
    participants = [];
    renderList();
    sendUpdate();
  });

  excludeWinner.addEventListener('change', sendUpdate);
  soundToggle.addEventListener('change', sendUpdate);

  closeBtn.addEventListener('click', () => {
    if (window.api?.closeWindow) { window.api.closeWindow(); return; }
    window.close();
  });

  // The display window reports who it landed on so we can drop them from
  // the list when "exclude winner" is checked — participants live here.
  window.api?.onWheelWinnerPicked?.((data) => {
    if (!excludeWinner.checked) return;
    const idx = participants.indexOf(data?.name);
    if (idx !== -1) {
      participants.splice(idx, 1);
      renderList();
      sendUpdate();
    }
  });

  async function loadGroupsData() {
    try {
      if (window.api?.loadGroups) {
        const result = await window.api.loadGroups();
        if (Array.isArray(result) && result.length > 0) return result;
      }
    } catch(e) { console.error('IPC loadGroups failed:', e); }
    try {
      const res = await fetch('http://localhost:5000/api/groups');
      if (res.ok) return await res.json();
    } catch(e) { console.error('fetch loadGroups failed:', e); }
    return [];
  }

  async function loadStudentsData() {
    try {
      if (window.api?.loadStudents) {
        const result = await window.api.loadStudents();
        if (Array.isArray(result) && result.length > 0) return result;
      }
    } catch(e) { console.error('IPC loadStudents failed:', e); }
    try {
      const res = await fetch('http://localhost:5000/api/students');
      if (res.ok) return await res.json();
    } catch(e) { console.error('fetch loadStudents failed:', e); }
    return [];
  }

  loadGroupBtn.addEventListener('click', async () => {
    const groupId = groupSelect.value;
    if (!groupId) return;
    const students = await loadStudentsData();
    const names = students
      .filter(s => String(s.groupId) === String(groupId))
      .map(s => s.name || s.fullName || s.displayName || s.code || 'طالب')
      .filter(n => !participants.includes(n));
    participants.push(...names);
    renderList();
    sendUpdate();
  });

  (async function init(){
    const groups = await loadGroupsData();
    groupSelect.innerHTML = '<option value="">— اختر مجموعة —</option>';
    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id; opt.textContent = g.name;
      groupSelect.appendChild(opt);
    });
    renderList();
    sendUpdate();
  })();

})();
