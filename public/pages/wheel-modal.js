'use strict';

// Wheel of Fortune - Modal Implementation
(function() {
  // ===== Environment =====
  const hasAPI = typeof window !== 'undefined' && !!window.api;

  // ===== State =====
  let participants = [];
  let groups = [];
  let isSpinning = false;
  let currentRotation = 0;
  let wheelCanvas, wheelCtx;
  let soundEnabled = true;
  let excludeWinner = false;

  // ===== Colors for wheel segments (bright and vibrant) =====
  const WHEEL_COLORS = [
    '#FF1744', '#00E676', '#2196F3', '#FF9800', '#E91E63',
    '#9C27B0', '#00BCD4', '#8BC34A', '#FF5722', '#3F51B5',
    '#FFEB3B', '#4CAF50', '#F44336', '#009688', '#795548',
    '#607D8B', '#FFC107', '#673AB7', '#FF6F00', '#1976D2'
  ];

  // ===== DOM Elements =====
  let openWheelBtn, wheelModal, closeWheelModal, closeModalFooter;
  let nameInput, addNameBtn, groupSelect, loadGroupBtn;
  let participantsList, participantsCount, clearAllBtn, shuffleBtn;
  let spinBtn, resetWheelBtn;
  let winnerModal, winnerName, spinAgainBtn, closeWinnerModal;
  let soundToggleBtn, excludeWinnerBtn;

  // ===== LocalStorage Fallback =====
  const LS_GROUPS = 'cm_groups_v1';
  const LS_STUDENTS = 'cm_students_v1';
  
  function loadLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  // ===== Utility Functions =====
  function escapeHTML(str) {
    return (str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function showNotification(message, type = 'info') {
    // Simple notification system
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 1rem 1.5rem;
      border-radius: 8px;
      color: white;
      font-weight: 600;
      z-index: 30000;
      animation: slideInRight 0.3s ease;
      max-width: 300px;
    `;
    
    switch (type) {
      case 'success':
        notification.style.background = '#10b981';
        break;
      case 'error':
        notification.style.background = '#ef4444';
        break;
      case 'warning':
        notification.style.background = '#f59e0b';
        break;
      default:
        notification.style.background = '#3b82f6';
    }

    document.body.appendChild(notification);
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // ===== Sound System =====
  const SOUNDS = {
    spin: () => {
      if (!soundEnabled) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.5);
        
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
      } catch (e) {
        console.log('Sound not supported');
      }
    },
    
    winner: () => {
      if (!soundEnabled) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [523.25, 659.25, 783.99, 1046.50];
        let time = audioContext.currentTime;
        
        notes.forEach((freq, index) => {
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          oscillator.frequency.setValueAtTime(freq, time);
          gainNode.gain.setValueAtTime(0.2, time);
          gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
          
          oscillator.start(time);
          oscillator.stop(time + 0.3);
          
          time += 0.15;
        });
      } catch (e) {
        console.log('Sound not supported');
      }
    },
    
    click: () => {
      if (!soundEnabled) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
      } catch (e) {
        console.log('Sound not supported');
      }
    }
  };

  function toggleSound() {
    soundEnabled = !soundEnabled;
    updateSoundButton();
    localStorage.setItem('wheel_sound_enabled', soundEnabled);
    showNotification(soundEnabled ? '🔊 تم تفعيل الأصوات' : '🔇 تم إيقاف الأصوات', 'info');
  }

  function updateSoundButton() {
    if (soundToggleBtn) {
      soundToggleBtn.innerHTML = soundEnabled ? '🔊 إيقاف الصوت' : '🔇 تفعيل الصوت';
      soundToggleBtn.className = `btn ${soundEnabled ? 'btn-warning' : 'btn-secondary'}`;
    }
  }

  function loadSoundSettings() {
    const saved = localStorage.getItem('wheel_sound_enabled');
    soundEnabled = saved !== null ? saved === 'true' : true;
    updateSoundButton();
  }

  // ===== Exclude Winner System =====
  function toggleExcludeWinner() {
    excludeWinner = !excludeWinner;
    updateExcludeWinnerButton();
    localStorage.setItem('wheel_exclude_winner', excludeWinner);
    showNotification(excludeWinner ? '✅ سيتم استثناء الفائز من الدورات القادمة' : '❌ لن يتم استثناء الفائز', 'info');
  }

  function updateExcludeWinnerButton() {
    if (excludeWinnerBtn) {
      excludeWinnerBtn.innerHTML = excludeWinner ? '✅ إلغاء الاستثناء' : '❌ استثناء الفائز';
      excludeWinnerBtn.className = `btn ${excludeWinner ? 'btn-success' : 'btn-secondary'}`;
    }
  }

  function loadExcludeWinnerSettings() {
    const saved = localStorage.getItem('wheel_exclude_winner');
    excludeWinner = saved !== null ? saved === 'true' : false;
    updateExcludeWinnerButton();
  }

  // ===== Groups API =====
  async function loadGroups() {
    try {
      if (hasAPI && window.api.loadGroups) {
        groups = await window.api.loadGroups() || [];
      } else {
        groups = loadLocal(LS_GROUPS);
        if (groups.length === 0) {
          groups = [
            { id: 'demo1', name: 'الصف الأول الثانوي', description: 'طلاب الصف الأول' },
            { id: 'demo2', name: 'الصف الثاني الثانوي', description: 'طلاب الصف الثاني' },
            { id: 'demo3', name: 'الصف الثالث الثانوي', description: 'طلاب الصف الثالث' }
          ];
        }
      }
      updateGroupSelect();
    } catch (error) {
      console.error('Error loading groups:', error);
      groups = [];
      updateGroupSelect();
    }
  }

  async function loadStudentsFromGroup(groupId) {
    try {
      let students = [];
      if (hasAPI && window.api.loadStudents) {
        students = await window.api.loadStudents() || [];
      } else {
        students = loadLocal(LS_STUDENTS);
        if (students.length === 0) {
          students = [
            { id: 's1', name: 'أحمد محمد', groupId: 'demo1' },
            { id: 's2', name: 'فاطمة علي', groupId: 'demo1' },
            { id: 's3', name: 'محمد أحمد', groupId: 'demo1' },
            { id: 's4', name: 'عائشة سالم', groupId: 'demo1' },
            { id: 's5', name: 'عبدالله خالد', groupId: 'demo2' },
            { id: 's6', name: 'مريم عبدالله', groupId: 'demo2' },
            { id: 's7', name: 'يوسف إبراهيم', groupId: 'demo2' },
            { id: 's8', name: 'زينب محمود', groupId: 'demo2' },
            { id: 's9', name: 'عمر حسن', groupId: 'demo3' },
            { id: 's10', name: 'نور الدين', groupId: 'demo3' },
            { id: 's11', name: 'سارة أحمد', groupId: 'demo3' },
            { id: 's12', name: 'حسام علي', groupId: 'demo3' }
          ];
        }
      }
      return students.filter(student => student.groupId === groupId);
    } catch (error) {
      console.error('Error loading students:', error);
      return [];
    }
  }

  // ===== UI Updates =====
  function updateGroupSelect() {
    groupSelect.innerHTML = '<option value="">اختر مجموعة...</option>';
    groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = `${group.name} (${group.description || 'بدون وصف'})`;
      groupSelect.appendChild(option);
    });
  }

  function updateParticipantsList() {
    participantsCount.textContent = participants.length;
    
    if (participants.length === 0) {
      participantsList.innerHTML = `
        <div class="empty-state">
          <p>لا يوجد مشاركون بعد</p>
          <p class="hint">أضف أسماء أو اختر مجموعة للبدء</p>
        </div>
      `;
      spinBtn.disabled = true;
      return;
    }

    participantsList.innerHTML = participants.map(name => `
      <div class="participant-item">
        <span class="participant-name">${escapeHTML(name)}</span>
        <button class="remove-btn" onclick="removeParticipant('${escapeHTML(name)}')">×</button>
      </div>
    `).join('');
    
    spinBtn.disabled = false;
    drawWheel();
  }

  // ===== Participant Management =====
  function addParticipant(name) {
    if (!name || name.trim() === '') {
      showNotification('يرجى إدخال اسم صحيح', 'warning');
      return;
    }

    const trimmedName = name.trim();
    if (participants.includes(trimmedName)) {
      showNotification('هذا الاسم موجود بالفعل', 'warning');
      return;
    }

    if (participants.length >= 20) {
      showNotification('الحد الأقصى 20 مشارك', 'warning');
      return;
    }

    participants.push(trimmedName);
    nameInput.value = '';
    updateParticipantsList();
    showNotification(`تم إضافة: ${trimmedName}`, 'success');
  }

  window.removeParticipant = function(name) {
    const index = participants.indexOf(name);
    if (index > -1) {
      participants.splice(index, 1);
      updateParticipantsList();
      showNotification(`تم حذف: ${name}`, 'info');
    }
  };

  function shuffleParticipants() {
    if (participants.length < 2) {
      showNotification('يجب وجود مشاركين على الأقل للخلط', 'warning');
      return;
    }
    
    participants = shuffleArray(participants);
    updateParticipantsList();
    showNotification('تم خلط أسماء المشاركين', 'success');
  }

  function resetWheel() {
    if (isSpinning) return;
    
    participants = [];
    currentRotation = 0;
    updateParticipantsList();
    drawWheel();
    showNotification('تم إعادة تعيين العجلة', 'info');
  }

  // ===== Wheel Drawing =====
  function drawWheel() {
    if (!wheelCanvas || !wheelCtx) return;

    if (participants.length === 0) {
      wheelCtx.clearRect(0, 0, wheelCanvas.width, wheelCanvas.height);
      wheelCtx.fillStyle = '#64748b';
      wheelCtx.fillRect(0, 0, wheelCanvas.width, wheelCanvas.height);
      wheelCtx.fillStyle = '#ffffff';
      wheelCtx.font = 'bold 18px Cairo';
      wheelCtx.textAlign = 'center';
      wheelCtx.fillText('أضف مشاركين', wheelCanvas.width/2, wheelCanvas.height/2);
      return;
    }

    const centerX = wheelCanvas.width / 2;
    const centerY = wheelCanvas.height / 2;
    const radius = Math.min(centerX, centerY) - 10;
    const anglePerSegment = (2 * Math.PI) / participants.length;

    wheelCtx.clearRect(0, 0, wheelCanvas.width, wheelCanvas.height);

    // Draw segments
    participants.forEach((participant, index) => {
      const startAngle = index * anglePerSegment + currentRotation - Math.PI / 2;
      const endAngle = (index + 1) * anglePerSegment + currentRotation - Math.PI / 2;
      const color = WHEEL_COLORS[index % WHEEL_COLORS.length];

      // Draw segment
      wheelCtx.fillStyle = color;
      wheelCtx.beginPath();
      wheelCtx.moveTo(centerX, centerY);
      wheelCtx.arc(centerX, centerY, radius, startAngle, endAngle);
      wheelCtx.closePath();
      wheelCtx.fill();

      // Draw border
      wheelCtx.strokeStyle = '#ffffff';
      wheelCtx.lineWidth = 3;
      wheelCtx.stroke();

      // Draw text - rotate text to follow the segment direction
      const textAngle = startAngle + anglePerSegment / 2;
      const textX = centerX + Math.cos(textAngle) * (radius * 0.7);
      const textY = centerY + Math.sin(textAngle) * (radius * 0.7);

      wheelCtx.save();
      wheelCtx.translate(textX, textY);
      
      // Rotate text to follow the segment direction
      let textRotation = textAngle + Math.PI / 2;
      
      // If text would be upside down, flip it to be readable
      if (textAngle > Math.PI / 2 && textAngle < 3 * Math.PI / 2) {
        textRotation += Math.PI;
      }
      
      wheelCtx.rotate(textRotation);
      wheelCtx.fillStyle = '#ffffff';
      wheelCtx.font = 'bold 16px Cairo';
      wheelCtx.textAlign = 'center';
      wheelCtx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      wheelCtx.shadowBlur = 3;
      wheelCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      wheelCtx.lineWidth = 1;
      wheelCtx.strokeText(participant, 0, 0);
      wheelCtx.fillText(participant, 0, 0);
      wheelCtx.restore();
    });

    // Draw center circle
    wheelCtx.fillStyle = '#1e293b';
    wheelCtx.beginPath();
    wheelCtx.arc(centerX, centerY, 30, 0, 2 * Math.PI);
    wheelCtx.fill();
    
    wheelCtx.strokeStyle = '#ffffff';
    wheelCtx.lineWidth = 4;
    wheelCtx.stroke();
  }

  // ===== Wheel Spinning =====
  function spinWheel() {
    if (isSpinning || participants.length === 0) return;

    SOUNDS.spin();

    isSpinning = true;
    spinBtn.disabled = true;
    spinBtn.classList.add('spinning');
    spinBtn.querySelector('.spin-text').textContent = 'جاري الدوران...';
    
    wheelCanvas.classList.add('spinning');

    const minSpins = 5;
    const maxSpins = 8;
    const spins = minSpins + Math.random() * (maxSpins - minSpins);
    const finalRotation = spins * 2 * Math.PI + Math.random() * 2 * Math.PI;
    
    const duration = 3000 + Math.random() * 2000;
    const startTime = Date.now();
    const startRotation = currentRotation;

    function animate() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeOut = 1 - Math.pow(1 - progress, 3);
      
      currentRotation = startRotation + finalRotation * easeOut;
      drawWheel();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        isSpinning = false;
        spinBtn.disabled = false;
        spinBtn.classList.remove('spinning');
        spinBtn.querySelector('.spin-text').textContent = 'ابدأ الدوران';
        
        wheelCanvas.classList.remove('spinning');
        
        // Determine winner
        const anglePerSegment = (2 * Math.PI) / participants.length;
        const normalizedRotation = ((currentRotation % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
        const winnerIndex = Math.floor((2 * Math.PI - normalizedRotation) / anglePerSegment) % participants.length;
        const winner = participants[winnerIndex] || participants[0];
        
        showWinner(winner);
      }
    }

    requestAnimationFrame(animate);
  }

  // ===== Modal Management =====
  function openModal() {
    SOUNDS.click();
    wheelModal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    SOUNDS.click();
    wheelModal.classList.remove('show');
    document.body.style.overflow = '';
  }

  // ===== Winner Modal =====
  function showWinner(winner) {
    winnerName.textContent = winner;
    winnerModal.classList.add('show');
    
    SOUNDS.winner();
    
    showNotification(`🎉 الفائز هو: ${winner}`, 'success');
    
    // If exclude winner is enabled, remove winner from participants
    if (excludeWinner) {
      const winnerIndex = participants.indexOf(winner);
      if (winnerIndex > -1) {
        participants.splice(winnerIndex, 1);
        updateParticipantsList();
        showNotification(`تم استثناء "${winner}" من الدورات القادمة`, 'info');
      }
    }
  }

  function hideWinner() {
    winnerModal.classList.remove('show');
  }

  // ===== Event Handlers =====
  function setupEventListeners() {
    // Modal controls
    openWheelBtn.addEventListener('click', openModal);
    closeWheelModal.addEventListener('click', closeModal);
    closeModalFooter.addEventListener('click', closeModal);

    // Close modal on backdrop click
    wheelModal.addEventListener('click', (e) => {
      if (e.target === wheelModal || e.target.classList.contains('modal-backdrop')) {
        closeModal();
      }
    });

    // Add participant manually
    addNameBtn.addEventListener('click', () => {
      addParticipant(nameInput.value);
    });

    nameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addParticipant(nameInput.value);
      }
    });

    // Load group
    loadGroupBtn.addEventListener('click', async () => {
      const selectedGroupId = groupSelect.value;
      if (!selectedGroupId) {
        showNotification('يرجى اختيار مجموعة أولاً', 'warning');
        return;
      }

      try {
        const students = await loadStudentsFromGroup(selectedGroupId);
        if (students.length === 0) {
          showNotification('لا توجد طلاب في هذه المجموعة', 'warning');
          return;
        }

        const newParticipants = students.map(student => student.name).filter(name => !participants.includes(name));
        participants.push(...newParticipants);
        updateParticipantsList();
        
        const groupName = groups.find(g => g.id === selectedGroupId)?.name || 'المجموعة';
        showNotification(`تم تحميل ${newParticipants.length} طالب من ${groupName}`, 'success');
      } catch (error) {
        console.error('Error loading group students:', error);
        showNotification('حدث خطأ أثناء تحميل المجموعة', 'error');
      }
    });

    // Clear all participants
    clearAllBtn.addEventListener('click', () => {
      if (participants.length === 0) return;
      
      if (confirm('هل أنت متأكد من حذف جميع المشاركين؟')) {
        participants = [];
        updateParticipantsList();
        showNotification('تم حذف جميع المشاركين', 'info');
      }
    });

    // Shuffle participants
    shuffleBtn.addEventListener('click', shuffleParticipants);

    // Spin wheel
    spinBtn.addEventListener('click', spinWheel);

    // Reset wheel
    resetWheelBtn.addEventListener('click', resetWheel);

    // Winner modal
    spinAgainBtn.addEventListener('click', () => {
      hideWinner();
      setTimeout(spinWheel, 500);
    });

    closeWinnerModal.addEventListener('click', hideWinner);

    // Close winner modal on background click
    winnerModal.addEventListener('click', (e) => {
      if (e.target === winnerModal || e.target.classList.contains('modal-backdrop')) {
        hideWinner();
      }
    });

    // Sound toggle
    soundToggleBtn.addEventListener('click', () => {
      SOUNDS.click();
      toggleSound();
    });

    // Exclude winner toggle
    excludeWinnerBtn.addEventListener('click', () => {
      SOUNDS.click();
      toggleExcludeWinner();
    });

    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (winnerModal.classList.contains('show')) {
          hideWinner();
        } else if (wheelModal.classList.contains('show')) {
          closeModal();
        }
      }
    });
  }

  // ===== Initialization =====
  function init() {
    // Get DOM elements
    openWheelBtn = document.getElementById('openWheelBtn');
    wheelModal = document.getElementById('wheelModal');
    closeWheelModal = document.getElementById('closeWheelModal');
    closeModalFooter = document.getElementById('closeModalFooter');
    
    nameInput = document.getElementById('nameInput');
    addNameBtn = document.getElementById('addNameBtn');
    groupSelect = document.getElementById('groupSelect');
    loadGroupBtn = document.getElementById('loadGroupBtn');
    participantsList = document.getElementById('participantsList');
    participantsCount = document.getElementById('participantsCount');
    clearAllBtn = document.getElementById('clearAllBtn');
    shuffleBtn = document.getElementById('shuffleBtn');
    spinBtn = document.getElementById('spinBtn');
    resetWheelBtn = document.getElementById('resetWheelBtn');
    winnerModal = document.getElementById('winnerModal');
    winnerName = document.getElementById('winnerName');
    spinAgainBtn = document.getElementById('spinAgainBtn');
    closeWinnerModal = document.getElementById('closeWinnerModal');
    soundToggleBtn = document.getElementById('soundToggleBtn');
    excludeWinnerBtn = document.getElementById('excludeWinnerBtn');

    // Setup canvas
    wheelCanvas = document.getElementById('wheelCanvas');
    wheelCtx = wheelCanvas.getContext('2d');

    // Setup event listeners
    setupEventListeners();

    // Load sound settings
    loadSoundSettings();
    
    // Load exclude winner settings
    loadExcludeWinnerSettings();

    // Load initial data
    loadGroups();
    updateParticipantsList();
    drawWheel();

    console.log('Wheel Modal initialized successfully');
  }

  // ===== CSS Animations =====
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInRight {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOutRight {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();