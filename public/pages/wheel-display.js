(function(){
  'use strict';

  const canvas = document.getElementById('wheelCanvas');
  const ctx = canvas.getContext('2d');
  const spinBtn = document.getElementById('spinBtn');
  const winnerBar = document.getElementById('winnerBar');
  const foldBtn = document.querySelector('.fold-btn');
  const closeBtn = document.querySelector('.close-btn');

  foldBtn?.addEventListener('click', async () => {
    try {
      const res = await window.api?.openToolWindow?.('wheel-settings');
      if (res && res.ok === false) console.error('openToolWindow(wheel-settings) failed:', res.error);
    } catch (e) { console.error('openToolWindow(wheel-settings) threw:', e); }
  });

  closeBtn?.addEventListener('click', () => {
    if (window.api?.closeWindow) { window.api.closeWindow(); return; }
    window.close();
  });

  const colors = [
    '#FF1744', '#00E676', '#2196F3', '#FF9800', '#E91E63',
    '#9C27B0', '#00BCD4', '#8BC34A', '#FF5722', '#795548',
    '#607D8B', '#FFC107', '#4CAF50', '#F44336', '#3F51B5'
  ];

  const config = { participants: [], soundOn: true, excludeWinner: false };
  let currentRotation = 0;
  let isSpinning = false;

  window.api?.onWheelSettingsUpdate?.((data) => {
    Object.assign(config, data);
    spinBtn.disabled = config.participants.length === 0 || isSpinning;
    if (config.participants.length === 0) {
      winnerBar.textContent = 'أضف مشاركين من الإعدادات';
      winnerBar.classList.remove('has-winner');
    }
    drawWheel();
  });

  function drawWheel() {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(cx, cy) - 4;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (config.participants.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#f0f0f0';
      ctx.fill();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }

    const seg = (2 * Math.PI) / config.participants.length;
    config.participants.forEach((name, i) => {
      const start = i * seg + currentRotation;
      const end = start + seg;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (config.participants.length <= 12) {
        const textAngle = start + seg / 2;
        const textRadius = radius * 0.62;
        const tx = cx + Math.cos(textAngle) * textRadius;
        const ty = cy + Math.sin(textAngle) * textRadius;
        ctx.save();
        ctx.translate(tx, ty);
        let rot = textAngle;
        if (textAngle > Math.PI / 2 && textAngle < 3 * Math.PI / 2) rot += Math.PI;
        ctx.rotate(rot);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,.55)';
        ctx.lineWidth = 2;
        ctx.font = 'bold 9px Cairo, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = name.length > 10 ? name.slice(0, 9) + '…' : name;
        ctx.strokeText(label, 0, 0);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    });

    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Sound
  let audioCtx;
  let seqActive = false;
  let lastTickAt = 0;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) {}
    }
  }
  function runTick(progress) {
    if (!config.soundOn || !audioCtx || !seqActive) return;
    const now = audioCtx.currentTime;
    const startInterval = 0.06, endInterval = 0.28;
    const eased = 1 - Math.pow(1 - progress, 3);
    const interval = startInterval + (endInterval - startInterval) * eased;
    if (now - lastTickAt < interval) return;
    lastTickAt = now;
    try {
      const gain = audioCtx.createGain();
      gain.gain.value = 0;
      gain.connect(audioCtx.destination);
      const osc = audioCtx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 800 + (2000 - 800) * (1 - eased);
      osc.connect(gain);
      osc.start(now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.05);
      osc.stop(now + 0.06);
      osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch(_){} };
    } catch(_) {}
  }
  function winBeep() {
    if (!config.soundOn) return;
    ensureAudio();
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(660, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
      osc.stop(audioCtx.currentTime + 0.35);
    } catch(_) {}
  }

  function spin() {
    if (isSpinning || config.participants.length === 0) return;
    window.api?.closeWheelSettings?.();

    isSpinning = true;
    spinBtn.disabled = true;
    winnerBar.classList.remove('has-winner');
    winnerBar.textContent = 'جارِ الدوران...';

    if (config.soundOn) { ensureAudio(); seqActive = true; lastTickAt = 0; }

    const duration = 3000 + Math.random() * 1800;
    const startRotation = currentRotation;
    const finalRotation = startRotation + Math.PI * 2 * 5 + Math.random() * Math.PI * 2;
    const startTime = Date.now();

    function animate() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      currentRotation = startRotation + (finalRotation - startRotation) * eased;
      drawWheel();
      runTick(progress);
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        finishSpin();
      }
    }
    animate();
  }

  function finishSpin() {
    isSpinning = false;
    seqActive = false;

    const seg = (2 * Math.PI) / config.participants.length;
    const normalized = ((currentRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const pointerAngle = (3 * Math.PI / 2 - normalized + 2 * Math.PI) % (2 * Math.PI);
    const winnerIndex = Math.floor(pointerAngle / seg);
    const winner = config.participants[winnerIndex];

    winBeep();
    winnerBar.textContent = winner ? `🎉 المختار: ${winner}` : '—';
    winnerBar.classList.add('has-winner');

    window.api?.sendWheelWinnerPicked?.({ name: winner, index: winnerIndex });

    spinBtn.disabled = config.participants.length === 0;
  }

  spinBtn.addEventListener('click', spin);

  // Init
  drawWheel();
})();
