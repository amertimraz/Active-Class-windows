(function(){
  'use strict';

  const sourceSelect = document.getElementById('sourceSelect');
  const groupControl = document.getElementById('groupControl');
  const groupSelect = document.getElementById('groupSelect');
  const manualControl = document.getElementById('manualControl');
  const manualNames = document.getElementById('manualNames');
  const addSampleBtn = document.getElementById('addSampleBtn');
  const clearManualBtn = document.getElementById('clearManualBtn');
  const excludePicked = document.getElementById('excludePicked');
  const soundToggle = document.getElementById('soundToggle');
  const closeBtn = document.querySelector('.close-btn');

  function sendUpdate() {
    if (!window.api?.sendNamesSettingsUpdate) return;
    window.api.sendNamesSettingsUpdate({
      source: sourceSelect.value,
      groupId: groupSelect.value,
      manualText: manualNames.value,
      excludePicked: excludePicked.checked,
      soundOn: soundToggle.checked
    });
  }

  sourceSelect.addEventListener('change', () => {
    const isGroup = sourceSelect.value === 'group';
    groupControl.style.display = isGroup ? '' : 'none';
    manualControl.style.display = isGroup ? 'none' : 'block';
    sendUpdate();
  });
  groupSelect.addEventListener('change', sendUpdate);
  manualNames.addEventListener('input', sendUpdate);
  excludePicked.addEventListener('change', sendUpdate);
  soundToggle.addEventListener('change', sendUpdate);

  addSampleBtn.addEventListener('click', () => {
    manualNames.value = "أحمد محمد\nسارة خالد\nيوسف إبراهيم\nمريم حسن\nعلي حسن\nنورة سالم";
    sendUpdate();
  });
  clearManualBtn.addEventListener('click', () => {
    manualNames.value = "";
    sendUpdate();
  });

  closeBtn.addEventListener('click', () => {
    if (window.api?.closeWindow) { window.api.closeWindow(); return; }
    window.close();
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

  (async function init(){
    const groups = await loadGroupsData();
    groupSelect.innerHTML = '<option value="">— اختر مجموعة —</option>';
    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id; opt.textContent = g.name;
      groupSelect.appendChild(opt);
    });
    sendUpdate();
  })();

})();
