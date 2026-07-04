(function(){
  'use strict';

  const countTypeSelect = document.getElementById('countTypeSelect');
  const durationGroup = document.getElementById('durationGroup');
  const presetGroup = document.getElementById('presetGroup');
  const hoursInput = document.getElementById('hoursInput');
  const minutesInput = document.getElementById('minutesInput');
  const secondsInput = document.getElementById('secondsInput');
  const presetSelect = document.getElementById('presetSelect');
  const soundToggle = document.getElementById('soundToggle');
  const closeBtn = document.querySelector('.close-btn');

  function sendUpdate() {
    if (!window.api?.sendTimerSettingsUpdate) return;
    window.api.sendTimerSettingsUpdate({
      countType: countTypeSelect.value,
      hours: parseInt(hoursInput.value, 10) || 0,
      minutes: parseInt(minutesInput.value, 10) || 0,
      seconds: parseInt(secondsInput.value, 10) || 0,
      soundOn: soundToggle.checked
    });
  }

  function updateModeUI() {
    const isCountdown = countTypeSelect.value === 'countdown';
    durationGroup.style.display = isCountdown ? '' : 'none';
    presetGroup.style.display = isCountdown ? '' : 'none';
  }

  countTypeSelect.addEventListener('change', () => { updateModeUI(); sendUpdate(); });
  [hoursInput, minutesInput, secondsInput].forEach(el => el.addEventListener('input', sendUpdate));
  soundToggle.addEventListener('change', sendUpdate);

  presetSelect.addEventListener('change', () => {
    const value = presetSelect.value;
    if (!value) return;
    const seconds = parseInt(value, 10);
    hoursInput.value = Math.floor(seconds / 3600);
    minutesInput.value = Math.floor((seconds % 3600) / 60);
    secondsInput.value = seconds % 60;
    sendUpdate();
  });

  closeBtn.addEventListener('click', () => {
    if (window.api?.closeWindow) { window.api.closeWindow(); return; }
    window.close();
  });

  updateModeUI();
  sendUpdate();
})();
