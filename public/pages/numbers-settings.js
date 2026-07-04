(function(){
  'use strict';

  const minInput = document.getElementById('minInput');
  const maxInput = document.getElementById('maxInput');
  const countInput = document.getElementById('countInput');
  const noRepeat = document.getElementById('noRepeat');
  const soundToggle = document.getElementById('soundToggle');
  const closeBtn = document.querySelector('.close-btn');

  function sendUpdate() {
    if (!window.api?.sendNumbersSettingsUpdate) return;
    window.api.sendNumbersSettingsUpdate({
      min: parseInt(minInput.value, 10),
      max: parseInt(maxInput.value, 10),
      count: parseInt(countInput.value, 10),
      noRepeat: noRepeat.checked,
      soundOn: soundToggle.checked
    });
  }

  [minInput, maxInput, countInput].forEach(el => el.addEventListener('input', sendUpdate));
  noRepeat.addEventListener('change', sendUpdate);
  soundToggle.addEventListener('change', sendUpdate);

  closeBtn.addEventListener('click', () => {
    if (window.api?.closeWindow) { window.api.closeWindow(); return; }
    window.close();
  });

  sendUpdate();
})();
