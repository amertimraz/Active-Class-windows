'use strict';

console.log('Quiz view script loading...');

// Enhanced Quiz View Controller with Interactive Presentation Features
(function(){
  // ===== Performance Settings =====
  // Enable debug mode by adding ?debug=1 to URL or setting window.debugMode = true
  window.debugMode = window.debugMode || new URLSearchParams(window.location.search).get('debug') === '1';
  
  if (window.debugMode) {
    console.log('Debug mode enabled - detailed logging active');
    
    // Performance monitoring in debug mode
    let frameCount = 0;
    let lastTime = performance.now();
    
    function monitorPerformance() {
      frameCount++;
      const currentTime = performance.now();
      
      if (currentTime - lastTime >= 1000) {
        console.log(`FPS: ${frameCount} | Memory: ${(performance.memory?.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`);
        frameCount = 0;
        lastTime = currentTime;
      }
      
      requestAnimationFrame(monitorPerformance);
    }
    
    // Start monitoring
    requestAnimationFrame(monitorPerformance);
  }
  
  // Performance utilities
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  
  // RequestAnimationFrame throttle for smooth animations
  function throttleRAF(func) {
    let ticking = false;
    return function(...args) {
      if (!ticking) {
        requestAnimationFrame(() => {
          func.apply(this, args);
          ticking = false;
        });
        ticking = true;
      }
    };
  }
  
  // Batch DOM updates to prevent layout thrashing
  const batchDOMUpdates = (() => {
    let updates = [];
    let scheduled = false;
    
    return function(updateFn) {
      updates.push(updateFn);
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => {
          updates.forEach(fn => fn());
          updates = [];
          scheduled = false;
        });
      }
    };
  })();
  
  // ===== Environment =====
  const hasAPI = typeof window !== 'undefined' && !!window.api;

  // ===== State Management =====
  const state = {
    quiz: null,
    questions: [],
    currentIndex: 0,
    answers: {},
    startTime: null,
    endTime: null,
    timerInterval: null,
    timeRemaining: 0,
    isStarted: false,
    isSubmitted: false,
    soundsEnabled: true,
    autoRevealAnswers: false,
    settings: {
      showTimer: true,
      autoSubmit: true,
      showProgress: true,
      allowReview: true,
      showCorrectAnswerOnWrong: true
    }
  };

  // ===== DOM References =====
  const card = document.getElementById('card');
  const quizHeader = document.querySelector('.quiz-header');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const quizHeaderTitle = document.getElementById('quizHeaderTitle');
  const quizHeaderGroup = document.getElementById('quizHeaderGroup');
  const quizHeaderSub = document.getElementById('quizHeaderSub');
  const headerTimer = document.getElementById('headerTimer');
  const headerTimerText = document.getElementById('headerTimerText');
  const startOverlay = document.getElementById('startOverlay');
  const preStartMinutes = document.getElementById('preStartMinutes');
  const preTimeUpMode = document.getElementById('preTimeUpMode');
  const showCorrectAnswerCheckbox = document.getElementById('showCorrectAnswer');
  const startBtn = document.getElementById('startBtn');
  const contentBox = document.getElementById('contentBox');
  const questionCard = document.getElementById('questionCard');
  const quizIndexBadge = document.getElementById('quizIndexBadge');
  const quizTypeBadge = document.getElementById('quizTypeBadge');
  const qText = document.getElementById('qText');
  const questionImage = document.getElementById('questionImage');
  const questionImg = document.getElementById('questionImg');
  const opts = document.getElementById('opts');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const reviewBtn = document.getElementById('reviewBtn');
  const submitBtn = document.getElementById('submitBtn');
  const toggleSfxBtn = document.getElementById('toggleSfxBtn');
  const footerHints = document.getElementById('footerHints');
  const progressBar = document.getElementById('bar');
  const resultOverlay = document.getElementById('resultOverlay');
  const resultModal = document.getElementById('resultModal');
  const resultTitle = document.getElementById('resultTitle');
  const resultSub = document.getElementById('resultSub');
  const finalWrap = document.getElementById('finalWrap');
  const finalStats = document.getElementById('finalStats');
  const resultClose = document.getElementById('resultClose');
  const reviewModal = document.getElementById('reviewModal');
  const answeredCount = document.getElementById('answeredCount');
  const unansweredCount = document.getElementById('unansweredCount');
  const totalQuestionsReview = document.getElementById('totalQuestionsReview');
  const questionsGrid = document.getElementById('questionsGrid');
  const continueQuizBtn = document.getElementById('continueQuiz');
  const finalSubmit = document.getElementById('finalSubmit');
  const finalResultsModal = document.getElementById('finalResultsModal');
  const finalScore = document.getElementById('finalScore');
  const correctCount = document.getElementById('correctCount');
  const wrongCount = document.getElementById('wrongCount');
  const timeSpent = document.getElementById('timeSpent');
  const gradeText = document.getElementById('gradeText');
  const reviewAnswers = document.getElementById('reviewAnswers');
  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNum = document.getElementById('countdownNum');
  const toastContainer = document.getElementById('toastContainer');

  // ===== LocalStorage Keys =====
  const LS_QUIZ_STATE = 'cm_quiz_view_state';
  const LS_QUIZ_ANSWERS = 'cm_quiz_answers';
  const LS_QUIZ_SETTINGS = 'cm_quiz_settings';

  // ===== Utility Functions =====
  const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const normalize = (s) => (s || '').toString().trim().toLowerCase();
  const escapeHTML = (s) => (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));
  
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function getQuestionType(question) {
    if (!question || !question.type) return 'unknown';
    const type = question.type.toLowerCase();
    switch(type) {
      case 'mcq':
      case 'multiple-choice':
        return 'mcq';
      case 'tf':
      case 'true-false':
        return 'tf';
      case 'fill':
      case 'fill-blank':
        return 'fill';
      case 'match':
      case 'matching':
        return 'match';
      case 'dropdown':
        // Migrate legacy 'dropdown' to 'mcq'
        return 'mcq';
      default:
        return 'mcq';
    }
  }

  function getQuestionTypeLabel(type) {
    switch(type) {
      case 'mcq': return 'اختيار متعدد';
      case 'tf': return 'صح/خطأ';
      case 'fill': return 'أكمل الناقص';
      case 'match': return 'مطابقة';
      default: return 'سؤال';
    }
  }

  // Track last answer correctness for modal handling
  let lastAnswerWasCorrect = null;

  // ===== Audio System =====
  let audioContext = null;
  let masterGain = null;
  let sfxGain = null;

  function initAudio() {
    if (audioContext) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioContext.createGain();
      masterGain.gain.value = 1.0;
      masterGain.connect(audioContext.destination);
      
      sfxGain = audioContext.createGain();
      sfxGain.gain.value = 0.7;
      sfxGain.connect(masterGain);
    } catch (e) {
      console.warn('Audio context not supported:', e);
    }
  }

  function playTone(frequency = 880, duration = 0.15, type = 'sine') {
    if (!state.soundsEnabled || !audioContext) return;
    
    try {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      oscillator.connect(gainNode);
      gainNode.connect(sfxGain);
      
      gainNode.gain.setValueAtTime(0.001, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.3, audioContext.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch (e) {
      console.warn('Error playing tone:', e);
    }
  }

  function playCorrectSound() {
    playTone(523, 0.2, 'sine'); // C5
    setTimeout(() => playTone(659, 0.2, 'sine'), 100); // E5
  }

  function playWrongSound() {
    playTone(220, 0.3, 'sawtooth'); // A3
  }

  function playClickSound() {
    playTone(440, 0.1, 'square'); // A4
  }

  // ===== Toast System =====
  function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    if (toastContainer) {
      toastContainer.appendChild(toast);
      
      // Animate in
      requestAnimationFrame(() => {
        toast.classList.add('show');
      });
      
      // Auto remove
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
          }
        }, 300);
      }, duration);
    }
  }

  // ===== Loading System =====
  function showLoading() {
    if (loadingOverlay) {
      loadingOverlay.style.display = 'flex';
    }
  }

  function hideLoading() {
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }
  }

  // ===== Quiz Data Management =====
  function loadQuizFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const quizId = urlParams.get('id');

    // Apply minutes param to pre-start input
    const minutesParam = urlParams.get('minutes');
    if (preStartMinutes && minutesParam !== null) {
      const m = parseInt(minutesParam, 10);
      if (!Number.isNaN(m) && m >= 0 && m <= 999) {
        try { preStartMinutes.value = String(m); } catch {}
      }
    }

    // Apply review param (1/true enable, 0/false disable)
    const reviewParam = urlParams.get('review');
    if (reviewParam !== null) {
      const allow = reviewParam === '1' || (typeof reviewParam === 'string' && reviewParam.toLowerCase() === 'true');
      state.settings.allowReview = allow;
      // Reflect on UI when available
      try {
        const btn = document.getElementById('reviewBtn');
        if (btn) btn.style.display = state.settings.allowReview ? 'inline-flex' : 'none';
      } catch {}
    }

    // Apply time up mode and show-correct flags from URL if provided
    const timeUpParam = urlParams.get('timeUp');
    if (preTimeUpMode && timeUpParam) {
      try { preTimeUpMode.value = timeUpParam; } catch {}
    }
    const showCorrectParam = urlParams.get('showCorrect');
    if (showCorrectAnswerCheckbox && showCorrectParam !== null) {
      const v = showCorrectParam === '1' || (typeof showCorrectParam === 'string' && showCorrectParam.toLowerCase() === 'true');
      try { showCorrectAnswerCheckbox.checked = v; } catch {}
    }

    // If link contains any of the sharing params, minimize the pre-start UI (QR mode)
    const cameFromQR = minutesParam !== null || timeUpParam !== null || showCorrectParam !== null || reviewParam !== null;
    if (cameFromQR) {
      try { minimizeStartSettings(); } catch {}
    }
    
    if (!quizId) {
      showToast('معرف الاختبار غير موجود', 'error');
      setTimeout(() => {
        window.location.href = '/quizzes';
      }, 2000);
      return;
    }

    loadQuizData(quizId);
  }

  async function loadQuizData(quizId) {
    showLoading();
    console.log(`Loading quiz with ID: ${quizId}`);

    let quiz = null;

    try {
      // API-first approach: try to fetch a single quiz directly.
      const response = await fetch(`/api/quizzes/${quizId}`);
      
      if (response.ok) {
        quiz = await response.json();
        console.log('Quiz loaded successfully from API.');
      } else {
        console.warn(`API failed to load quiz (status: ${response.status}), falling back to localStorage.`);
      }
    } catch (error) {
      console.warn('API fetch error, falling back to localStorage:', error);
    }

    // Fallback to localStorage if API fails
    if (!quiz) {
      console.log('Looking for quiz in localStorage...');
      try {
        // This is the old, less reliable method
        const stored = localStorage.getItem('cm_quizzes_v1');
        const quizzes = stored ? JSON.parse(stored) : [];
        console.log('All saved quizzes:', quizzes);
        quiz = quizzes.find(q => q.id === quizId);

        if (quiz) {
          console.log('Quiz found in localStorage');
        } else {
          console.error('Quiz not found in localStorage');
        }
      } catch (e) {
        console.error('Error reading quizzes from localStorage:', e);
      }
    }

    if (!quiz) {
      hideLoading();
      console.error('No quiz data found');
      showToast('الاختبار المحدد غير موجود أو لا يمكن تحميله.', 'error');
      
      // Disable the start button and show an error state
      if (startBtn) {
          startBtn.textContent = 'خطأ في التحميل';
          startBtn.disabled = true;
          console.log('Fallback start button handler set');
      }
      return;
    }

    state.quiz = quiz;
    state.questions = quiz.questions || [];

    try {
      await initializeQuiz();
      // After quiz loaded, if it has a group, show student picker populated from API
      try {
        if (quiz.groupId) {
          const row = document.getElementById('studentPickerRow');
          const sel = document.getElementById('studentSelect');
          if (row && sel) {
            const res = await fetch(`/api/group/${encodeURIComponent(quiz.groupId)}/students`);
            const list = res.ok ? (await res.json()) : [];
            sel.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'اختر اسمك';
            placeholder.disabled = true;
            placeholder.selected = true;
            sel.appendChild(placeholder);
            list.forEach(s => {
              const opt = document.createElement('option');
              opt.value = s.id || s.studentId || '';
              opt.textContent = s.name || s.fullName || '';
              sel.appendChild(opt);
            });
            row.style.display = 'flex';
          }
        }
      } catch (e) {
        console.warn('Failed to load group students for picker', e);
      }
    } catch (initError) {
      console.error('Error initializing quiz:', initError);
      showToast('حدث خطأ أثناء تهيئة الاختبار.', 'error');
    } finally {
      hideLoading();
    }
  }

  // ===== Diagnostic Function =====
  function diagnoseQuizOptions() {
    console.log('=== QUIZ OPTIONS DIAGNOSTIC ===');

    // Check quiz state
    console.log('Quiz state:', {
      hasQuiz: !!state.quiz,
      questionsCount: state.questions?.length || 0,
      currentIndex: state.currentIndex,
      isStarted: state.isStarted
    });

    // Check current question
    const currentQuestion = state.questions?.[state.currentIndex];
    console.log('Current question:', {
      exists: !!currentQuestion,
      text: currentQuestion?.text?.substring(0, 50),
      type: currentQuestion?.type,
      hasOptions: !!currentQuestion?.options,
      optionsCount: currentQuestion?.options?.length || 0,
      options: currentQuestion?.options
    });

    // Check DOM elements
    console.log('DOM elements:', {
      opts: !!opts,
      optsHTML: opts?.innerHTML?.substring(0, 100),
      questionCard: !!questionCard,
      qText: !!qText
    });

    // Check if options are visible
    const optElements = opts?.querySelectorAll('.opt');
    console.log('Option elements:', {
      count: optElements?.length || 0,
      elements: optElements
    });

    // Check for error messages
    const errorMessages = opts?.querySelectorAll('.error-message');
    console.log('Error messages:', {
      count: errorMessages?.length || 0,
      messages: errorMessages
    });

    console.log('=== END DIAGNOSTIC ===');
  }

  // Make diagnostic function globally available
  window.diagnoseQuizOptions = diagnoseQuizOptions;

  // Force reload current question
  function reloadCurrentQuestion() {
    if (state.questions && state.questions.length > 0) {
      console.log('Reloading current question...');
      showQuestion(state.currentIndex);
    } else {
      console.warn('No questions available to reload');
    }
  }

  window.reloadCurrentQuestion = reloadCurrentQuestion;

  async function loadGroupData() {
    try {
      let groups = [];
      
      if (hasAPI && window.api.loadGroups) {
        groups = await window.api.loadGroups() || [];
      } else {
        const stored = localStorage.getItem('cm_groups_v1');
        groups = stored ? JSON.parse(stored) : [];
      }
      
      if (window.debugMode) {
        console.log('Groups loaded:', groups.length);
        console.log('Quiz groupId:', state.quiz?.groupId);
      }
      
      if (state.quiz && state.quiz.groupId && quizHeaderGroup) {
        const group = groups.find(g => g.id === state.quiz.groupId);
        if (group) {
          quizHeaderGroup.textContent = group.name;
          quizHeaderGroup.style.display = 'inline-flex';
          if (window.debugMode) {
            console.log('Group name set:', group.name);
          }
        } else {
          // Hide group element if no group found
          quizHeaderGroup.style.display = 'none';
          if (window.debugMode) {
            console.log('No group found for ID:', state.quiz.groupId);
          }
        }
      } else {
        // Hide group element if no groupId
        if (quizHeaderGroup) {
          quizHeaderGroup.style.display = 'none';
        }
        if (window.debugMode) {
          console.log('No groupId specified for quiz');
        }
      }
    } catch (error) {
      console.error('Error loading groups:', error);
      // Hide group element on error
      if (quizHeaderGroup) {
        quizHeaderGroup.style.display = 'none';
      }
    }
  }

  // ===== Quiz Initialization =====
  async function initializeQuiz() {
    try {
      if (!state.quiz) {
        showToast('بيانات الاختبار غير متوفرة', 'error');
        return;
      }

      // Load questions from quiz data
      try {
        if (state.quiz.questions && Array.isArray(state.quiz.questions) && state.quiz.questions.length > 0) {
          // Store original questions for reshuffling
          if (!state.originalQuestions) {
            state.originalQuestions = JSON.parse(JSON.stringify(state.quiz.questions));
          }
          
          state.questions = JSON.parse(JSON.stringify(state.originalQuestions)); // Deep copy
          if (window.debugMode) {
            console.log(`Loaded ${state.questions.length} questions from quiz data`);
          }
          
          // Debug: Check question structure
          if (window.debugMode) {
            console.log('Sample question structure:', state.questions[0]);
            state.questions.forEach((q, i) => {
              if (i < 3) { // Log first 3 questions
                console.log(`Question ${i}:`, {
                  type: getQuestionType(q),
                  correct: q.correct,
                  correctAnswer: q.correctAnswer,
                  options: q.options,
                  optionsLength: q.options?.length
                });
              }
            });
          }
          
        } else {
          console.error('No questions found in quiz data:', state.quiz);
          console.log('Quiz questions property:', state.quiz.questions);
          showToast('لا توجد أسئلة في هذا الاختبار', 'error');
          return;
        }
      } catch (questionsError) {
        console.error('Error loading questions:', questionsError);
        showToast('خطأ في تحميل الأسئلة', 'error');
        return;
      }

      // Set quiz title
      try {
        if (quizHeaderTitle) {
          const quizTitle = state.quiz.name || 'اختبار';
          quizHeaderTitle.textContent = quizTitle;
          if (window.debugMode) {
            console.log('Quiz title set:', quizTitle);
          }
        }
      } catch (titleError) {
        console.warn('Error setting quiz title:', titleError);
      }

      // Load group data for header
      try {
        await loadGroupData();
      } catch (groupError) {
        console.warn('Error loading group data:', groupError);
      }

      // Set duration (if duration element exists)
      try {
        const durationElement = document.getElementById('preStartMinutes');
        if (durationElement && state.quiz.duration) {
          durationElement.value = state.quiz.duration;
        }
      } catch (durationError) {
        console.warn('Error setting duration:', durationError);
      }

      // Initialize answers object
      try {
        state.answers = {};
        if (state.questions && Array.isArray(state.questions)) {
          state.questions.forEach((_, index) => {
            state.answers[index] = null;
          });
        }
      } catch (answersError) {
        console.error('Error initializing answers:', answersError);
        state.answers = {};
      }

      // Load saved state if exists (with timeout protection)
      try {
        const loadStatePromise = new Promise((resolve, reject) => {
          try {
            loadSavedState();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        
        // Add timeout protection
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Load state timeout')), 5000);
        });
        
        Promise.race([loadStatePromise, timeoutPromise]).catch(stateError => {
          console.warn('Error loading saved state:', stateError);
          // Clear potentially corrupted state
          try {
            clearSavedState();
          } catch (clearError) {
            console.warn('Error clearing saved state:', clearError);
          }
        });
      } catch (stateError) {
        console.warn('Error loading saved state:', stateError);
      }

      // Update UI
      try {
        updateQuizInfo();
        updateProgress();
        updateWindowTitle();
      } catch (uiError) {
        console.warn('Error updating UI:', uiError);
      }
      
      // Show start overlay
      try {
        if (startOverlay) {
          startOverlay.style.display = 'flex';
        }
        
        if (contentBox) {
          contentBox.style.display = 'none';
        }
      } catch (overlayError) {
        console.warn('Error showing start overlay:', overlayError);
      }
    } catch (error) {
      console.error('Critical error in initializeQuiz:', error);
      showToast('خطأ في تهيئة الاختبار', 'error');
    }
  }

  function updateQuizInfo() {
    if (!state.quiz) return;

    // Ensure quiz title is displayed
    if (quizHeaderTitle) {
      const quizTitle = state.quiz.name || 'اختبار';
      quizHeaderTitle.textContent = quizTitle;
      quizHeaderTitle.style.display = 'block';
      if (window.debugMode) {
        console.log('Quiz title updated in header:', quizTitle);
      }
    }
    
    // Ensure group name is displayed if available
    loadGroupData().catch(error => {
      console.warn('Error updating group data:', error);
    });
    
    // Update window title
    updateWindowTitle();
  }

  // ===== Quiz Header Info =====
  function updateQuizInfo() {
    try {
      // Set title from quiz object
      if (quizHeaderTitle && state.quiz) {
        const title = state.quiz.title || state.quiz.name || 'الاختبار';
        quizHeaderTitle.textContent = title;
      }

      // Resolve group name (prefer explicit groupName, else lookup by groupId)
      let groupName = '';
      try {
        if (state.quiz) {
          groupName = state.quiz.groupName || '';
          if (!groupName && state.quiz.groupId) {
            const stored = localStorage.getItem('cm_groups_v1');
            const groups = stored ? JSON.parse(stored) : [];
            const g = groups.find(gr => gr.id === state.quiz.groupId);
            if (g) groupName = g.name || '';
          }
        }
      } catch (e) {
        console.warn('Error resolving group name:', e);
      }

      // Place group name as a small subtitle under the title
      if (quizHeaderSub) {
        if (groupName) {
          quizHeaderSub.textContent = groupName;
          quizHeaderSub.style.display = 'block';
        } else {
          quizHeaderSub.style.display = 'none';
          quizHeaderSub.textContent = '';
        }
      }

      // Hide the old badge in title row to avoid duplication
      if (quizHeaderGroup) {
        quizHeaderGroup.style.display = 'none';
      }
    } catch (err) {
      console.warn('updateQuizInfo error:', err);
    }
  }

  // ===== Quiz Control =====
  function startQuiz() {
    try {
      console.log('=== START QUIZ FUNCTION CALLED ===');
      
      if (window.debugMode) {
        console.log('Starting quiz...');
      }
      
      if (state.isStarted) {
        console.log('Quiz already started, returning');
        return;
      }

      // Prevent multiple calls
      if (startQuiz.isRunning) {
        console.log('Start quiz already running, returning');
        return;
      }
      startQuiz.isRunning = true;
      console.log('Start quiz function proceeding...');

      // Check if quiz has questions
      if (!state.questions || state.questions.length === 0) {
        console.error('No questions found');
        showToast('لا توجد أسئلة في هذا الاختبار', 'error');
        startQuiz.isRunning = false;
        return;
      }

      console.log(`Starting quiz with ${state.questions.length} questions`);
      
      // Debug: Log current settings BEFORE reading them
      console.log('DOM elements state:', {
        preStartMinutes: !!preStartMinutes,
        preTimeUpMode: !!preTimeUpMode,
        showCorrectAnswerCheckbox: !!showCorrectAnswerCheckbox
      });

      // Read settings from DOM elements (ensure we get fresh values)
      let minutes = 1;
      let timeUpMode = 'auto-next-wrong';
      let showCorrectOnWrong = true;
      
      // Get minutes value
      try {
        if (preStartMinutes && preStartMinutes.value !== null && preStartMinutes.value !== '') {
          const rawMinutes = preStartMinutes.value;
          const parsed = Number.parseInt(rawMinutes, 10);
          minutes = Number.isFinite(parsed) ? Math.min(999, Math.max(0, parsed)) : 1;
          console.log('Minutes read from input:', minutes, 'raw:', rawMinutes);
        }
      } catch (e) {
        console.warn('Error reading minutes:', e);
      }
      
      // Get time up mode
      try {
        if (preTimeUpMode && preTimeUpMode.value) {
          timeUpMode = preTimeUpMode.value;
          console.log('Time up mode read:', timeUpMode);
        }
      } catch (e) {
        console.warn('Error reading time up mode:', e);
      }
      
      // Get show correct answer setting
      try {
        if (showCorrectAnswerCheckbox) {
          showCorrectOnWrong = showCorrectAnswerCheckbox.checked;
          console.log('Show correct answer read:', showCorrectOnWrong, 'checked:', showCorrectAnswerCheckbox.checked);
        }
      } catch (e) {
        console.warn('Error reading show correct answer:', e);
      }

      // Log final values
      console.log('Final settings to be applied:', {
        minutes,
        timeUpMode,
        showCorrectOnWrong
      });

      // Initialize audio safely
      try {
        initAudio();
        playClickSound();
      } catch (audioError) {
        console.warn('Audio initialization failed:', audioError);
      }

      state.isStarted = true;
      state.startTime = Date.now();
      
      // Apply timer settings
      const questionTime = Math.max(10, minutes * 60);
      state.questionTimeLimit = questionTime;
      state.questionTimeRemaining = questionTime;

      // Apply time up mode settings
      state.settings.autoNext = timeUpMode === 'auto-next-wrong';
      state.settings.markWrongOnTimeout = timeUpMode === 'auto-next-wrong';
      state.settings.waitOnTimeout = timeUpMode === 'wait';
      
      // Apply show correct answer setting
      state.settings.showCorrectAnswerOnWrong = showCorrectOnWrong;
      
      console.log('Applied quiz settings:', {
        questionTimeLimit: state.questionTimeLimit,
        timeUpMode,
        autoNext: state.settings.autoNext,
        markWrongOnTimeout: state.settings.markWrongOnTimeout,
        waitOnTimeout: state.settings.waitOnTimeout,
        showCorrectAnswerOnWrong: state.settings.showCorrectAnswerOnWrong
      });

      // Hide start overlay with smooth transition
      if (startOverlay) {
        startOverlay.style.opacity = '0';
        setTimeout(() => {
          startOverlay.style.display = 'none';
          startOverlay.style.opacity = '1';
        }, 300);
      }
      
      if (contentBox) {
        contentBox.style.display = 'flex';
      }

      // Show timer
      if (headerTimer) {
        headerTimer.style.display = 'inline-flex';
      }

      // Update quiz info (title and group)
      try {
        updateQuizInfo();
      } catch (infoError) {
        console.warn('Error updating quiz info:', infoError);
      }

      // Start timer
      try {
        startTimer();
      } catch (timerError) {
        console.error('Timer start failed:', timerError);
      }

      // Show first/last seen question
      try {
        const startIndex = Number.isInteger(state.currentIndex) && state.currentIndex >= 0 ? state.currentIndex : 0;
        showQuestion(startIndex);
      } catch (questionError) {
        console.error('Failed to show initial question:', questionError);
        showToast('خطأ في عرض السؤال الأول', 'error');
        startQuiz.isRunning = false;
        return;
      }

      // Update controls
      try {
        updateControls();
      } catch (controlsError) {
        console.warn('Controls update failed:', controlsError);
      }

      // Save state
      try {
        saveState();
      } catch (saveError) {
        console.warn('State save failed:', saveError);
      }

      const modeText = state.settings.markWrongOnTimeout ? 'احتساب خطأ ثم التالي' : 
                       state.settings.waitOnTimeout ? 'انتظار للسماح بالإجابة' : 'عادي';
      showToast(`بدأ الاختبار بنجاح - وضع انتهاء الوقت: ${modeText}`, 'success');
      console.log('Quiz started successfully with mode:', modeText);
      console.log('Final settings:', {
        showCorrectAnswerOnWrong: state.settings.showCorrectAnswerOnWrong,
        markWrongOnTimeout: state.settings.markWrongOnTimeout,
        waitOnTimeout: state.settings.waitOnTimeout
      });
    } catch (error) {
      console.error('Critical error in startQuiz:', error);
      showToast('خطأ في بدء الاختبار', 'error');
      
      // Reset state if something went wrong
      state.isStarted = false;
      if (startOverlay) {
        startOverlay.style.display = 'flex';
      }
      if (contentBox) {
        contentBox.style.display = 'none';
      }
    } finally {
      // Always reset the running flag
      startQuiz.isRunning = false;
    }
  }

  function startTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
    }

    // Use a more efficient timer that batches DOM updates
    state.timerInterval = setInterval(() => {
      // Don't decrement if already at 0 and in wait mode
      if (state.questionTimeRemaining > 0) {
        state.questionTimeRemaining--;
      }
      
      // Batch all DOM updates together
      batchDOMUpdates(() => {
        updateTimerDisplay();
        
        // Warning at 10 seconds
        if (state.questionTimeRemaining === 10) {
          showToast('تبقى 10 ثوانِ على انتهاء وقت السؤال', 'warning');
          if (headerTimer) {
            headerTimer.classList.add('warn');
          }
        }

        // Danger at 5 seconds
        if (state.questionTimeRemaining === 5) {
          showToast('تبقى 5 ثوانِ فقط!', 'error');
          if (headerTimer) {
            headerTimer.classList.add('danger');
          }
        }
      });

      // Countdown in last 5 seconds
      if (state.questionTimeRemaining <= 5 && state.questionTimeRemaining > 0) {
        showCountdown(state.questionTimeRemaining);
      }

      // Time up for current question (only trigger once)
      if (state.questionTimeRemaining === 0 && !state.timeUpTriggered) {
        state.timeUpTriggered = true;
        questionTimeUp();
      }
    }, 1000);
  }

  // Throttled timer display update for smooth performance
  const updateTimerDisplay = throttleRAF(() => {
    const timeText = formatTime(Math.max(0, state.questionTimeRemaining));
    if (headerTimerText) {
      // Only update if text actually changed
      if (headerTimerText.textContent !== timeText) {
        batchDOMUpdates(() => {
          headerTimerText.textContent = timeText;
        });
      }
    }
  });

  function showCountdown(seconds) {
    // إبقاء الحجم ثابتًا في آخر 5 ثوانٍ لمنع تغيير تخطيط البطاقات
    if (headerTimerText) {
      // لا نغيّر النص أو حجم الخط؛ فقط نُلعب صوت العد التنازلي
      playTone(800, 0.1);
    }
  }

  function questionTimeUp() {
    if (window.debugMode) {
      console.log('Question time up! Settings:', {
        markWrongOnTimeout: state.settings.markWrongOnTimeout,
        autoNext: state.settings.autoNext,
        waitOnTimeout: state.settings.waitOnTimeout
      });
    }
    
    // Reset timer classes
    if (headerTimer) {
      headerTimer.classList.remove('warn', 'danger');
    }
    
    // Hide countdown
    if (countdownOverlay) {
      countdownOverlay.style.display = 'none';
    }

    if (state.settings.markWrongOnTimeout) {
      // Mark as wrong and move to next question
      const qIndex = state.currentIndex;
      if (state.answers[qIndex] == null) {
        // save as wrong sentinel (-1) without showing correct
        state.answers[qIndex] = -1;
        saveState();
      }
      showToast('انتهى الوقت! تم احتسابها خاطئة والانتقال للتالي', 'warning');
      setTimeout(() => {
        if (state.currentIndex < state.questions.length - 1) {
          nextQuestion();
        } else {
          // Last question - submit quiz
          setTimeout(() => submitQuiz(true), 500);
        }
      }, 800);
    } else if (state.settings.waitOnTimeout) {
      // Wait mode - just show message and stop timer
      showToast('انتهى وقت السؤال! يمكنك الآن الإجابة بدون ضغط الوقت', 'info');
      // Stop timer but don't reset - let user answer without time pressure
      state.questionTimeRemaining = 0;
      updateTimerDisplay();
      
      // Clear the timer interval to stop counting
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
    } else {
      // Default behavior
      showToast('انتهى وقت السؤال!', 'warning');
      resetQuestionTimer();
    }
  }

  function resetQuestionTimer() {
    // Reset question timer
    state.questionTimeRemaining = state.questionTimeLimit;
    state.timeUpTriggered = false; // Reset time up trigger
    
    // Reset timer classes
    if (headerTimer) {
      headerTimer.classList.remove('warn', 'danger');
    }
    
    updateTimerDisplay();
  }

  // ===== Question Navigation =====
  function showQuestion(index) {
    console.log(`showQuestion called with index: ${index}`);
    console.log(`Questions array length: ${state.questions?.length || 0}`);
    console.log(`Current state.currentIndex: ${state.currentIndex}`);

    if (index < 0 || index >= state.questions.length) {
      console.warn(`Invalid question index: ${index}, valid range: 0-${state.questions.length - 1}`);
      return;
    }

    // Only update if index actually changed
    const indexChanged = state.currentIndex !== index;
    console.log(`Index changed: ${indexChanged} (old: ${state.currentIndex}, new: ${index})`);
    state.currentIndex = index;
    const question = state.questions[index];

    if (!question) {
      console.error(`No question found at index ${index}`);
      return;
    }

    console.log(`Showing question ${index + 1}:`, {
      text: question.text?.substring(0, 50),
      type: question.type,
      hasOptions: !!question.options,
      optionsCount: question.options?.length || 0,
      indexChanged: indexChanged
    });

    // Only reset timer if question changed
    if (indexChanged) {
      console.log('Resetting question timer...');
      resetQuestionTimer();
      // Restart timer if it was stopped in wait mode
      if (!state.timerInterval) {
        console.log('Timer was stopped - restarting...');
        startTimer();
      }
    } else {
      console.log('Index did not change - skipping timer reset');
    }

    // Update question meta
    updateQuestionMeta(question, index);

    // Update question text
    updateQuestionText(question);

    // Update question image
    updateQuestionImage(question);

    // Clear options container to prevent duplication in restart/edge cases
    if (opts) {
      opts.innerHTML = '';
      delete opts.dataset.currentType;
      delete opts.dataset.currentIndex;
    }

    // Build options (optimized to avoid unnecessary rebuilds)
    buildQuestionOptions(question, index);

    // Update progress (optimized to avoid unnecessary DOM updates)
    updateProgress();
    
    // Update current score
    updateCurrentScore();

    // Update controls
    updateControls();

    // Only animate if question changed
    if (indexChanged) {
      animateQuestion();
    }

    // Save state
    saveState();
  }

  function updateQuestionMeta(question, index) {
    if (quizIndexBadge) {
      const ordinals = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
      const ordinal = ordinals[index] || (index + 1);
      quizIndexBadge.textContent = `السؤال ${ordinal} من ${state.questions.length}`;
    }

    if (quizTypeBadge) {
      const type = getQuestionType(question);
      quizTypeBadge.textContent = getQuestionTypeLabel(type);
    }
  }

  function updateQuestionText(question) {
    if (qText) {
      let text = question.text || question.question || '';
      
      // Handle fill-in-the-blank questions
      if (getQuestionType(question) === 'fill' && question.correct) {
        const answer = String(question.correct);
        text = text.replace(new RegExp(`\\*\\*${answer}\\*\\*|${answer}`, 'gi'), '____');
      }
      
      // Only update if text actually changed
      if (qText.textContent !== text) {
        qText.textContent = text;
        qText.classList.remove('show');
        
        // Animate text
        setTimeout(() => {
          qText.classList.add('show');
        }, 100);
      }
    }
  }

  function updateQuestionImage(question) {
    if (questionImage && questionImg) {
      if (question.image) {
        questionImg.src = question.image;
        questionImg.alt = 'صورة السؤال';
        questionImage.style.display = 'block';
      } else {
        questionImage.style.display = 'none';
      }
    }
  }

  function buildQuestionOptions(question, questionIndex) {
    if (!opts) {
      if (window.debugMode) {
        console.error('Options container (opts) not found!');
      }
      return;
    }

    if (window.debugMode) {
      console.log(`buildQuestionOptions called for question ${questionIndex + 1}`);
      console.log('opts element:', opts);
    }

    // Always render options inside the in-page container (disable modal rendering)
    const targetContainer = opts;

    // Always clear and rebuild to avoid duplication in restart scenarios
    targetContainer.innerHTML = '';
    const type = getQuestionType(question);
    targetContainer.dataset.currentType = type;
    targetContainer.dataset.currentIndex = questionIndex;

    const currentAnswer = state.answers[questionIndex];

    // تشخيص: تسجيل نوع السؤال والبيانات الأساسية
    if (window.debugMode) {
      console.log(`Building options for question ${questionIndex + 1}:`, {
        type: type,
        questionText: question.text?.substring(0, 50),
        hasOptions: !!question.options,
        optionsCount: question.options?.length || 0,
        correctAnswer: question.correctAnswer,
        correct: question.correct,
        currentAnswer: currentAnswer
      });
    }

    switch (type) {
      case 'mcq':
        buildMCQOptions(question, questionIndex, currentAnswer);
        break;
      case 'tf':
        buildTrueFalseOptions(question, questionIndex, currentAnswer);
        break;
      case 'fill':
        buildFillOptions(question, questionIndex, currentAnswer);
        break;
      // 'dropdown' removed: treated as 'mcq'
      case 'match':
        buildMatchingOptions(question, questionIndex, currentAnswer);
        break;
      default:
        console.warn(`Unknown question type: ${type}, treating as MCQ`);
        buildMCQOptions(question, questionIndex, currentAnswer);
    }

    // Options will animate automatically via CSS animations (quiz-view-animations.css)
    // No need for JS animation here - CSS handles smooth staggered entrance
  }

  function buildMCQOptions(question, questionIndex, currentAnswer) {
    const options = question.options || [];

    // تشخيص: التأكد من وجود خيارات
    if (window.debugMode) {
      console.log(`Building MCQ options for question ${questionIndex}:`, {
        questionText: question.text?.substring(0, 50),
        optionsCount: options.length,
        options: options,
        correctAnswer: question.correctAnswer,
        hasOptions: !!question.options
      });
    }

    // تحقق من وجود خيارات
    if (!options || options.length === 0) {
      console.error(`❌ لا توجد خيارات لسؤال MCQ رقم ${questionIndex + 1}`);
      console.log('Question data:', question);

      // عرض رسالة خطأ للمستخدم
      const errorMsg = document.createElement('div');
      errorMsg.className = 'error-message';
      errorMsg.innerHTML = `
        <strong>خطأ في السؤال:</strong> لا توجد خيارات متاحة لهذا السؤال.
        <small>يرجى التواصل مع المعلم لإصلاح هذا السؤال.</small>
      `;
      opts.appendChild(errorMsg);
      return;
    }

    options.forEach((option, index) => {
      const optEl = document.createElement('div');
      optEl.className = 'opt';
      optEl.setAttribute('tabindex', '0');
      optEl.setAttribute('role', 'button');
      
      // Set data-label for CSS ::before pseudo-element
      optEl.setAttribute('data-label', String.fromCharCode(65 + index));

      // تمييز الإجابة الحالية عند إعادة البناء
      if (currentAnswer === index) {
        optEl.classList.add('selected');
      }

      // Simply add text content - CSS handles the label via ::before
      optEl.textContent = option;

      // Use data attributes instead of multiple event listeners
      optEl.dataset.questionIndex = questionIndex;
      optEl.dataset.optionIndex = index;
      optEl.onclick = (e) => selectOption(questionIndex, index);
      optEl.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectOption(questionIndex, index);
        }
      };

      opts.appendChild(optEl);
    });
  }

  function buildTrueFalseOptions(question, questionIndex, currentAnswer) {
    let options = question.options || ['صحيح', 'خطأ'];

    // تشخيص: التأكد من وجود خيارات صح/خطأ
    if (window.debugMode) {
      console.log(`Building TF options for question ${questionIndex}:`, {
        questionText: question.text?.substring(0, 50),
        optionsCount: options.length,
        options: options,
        correctAnswer: question.correctAnswer,
        hasOptions: !!question.options
      });
    }

    // تحقق من وجود خيارات
    if (!options || options.length !== 2) {
      console.warn(`⚠️ سؤال TF رقم ${questionIndex + 1} لا يحتوي على خيارات صحيحة، سيتم استخدام الافتراضي`);
      options = ['صحيح', 'خطأ'];
    }

    options.forEach((option, index) => {
      const optEl = document.createElement('div');
      optEl.className = 'opt';
      optEl.setAttribute('tabindex', '0');
      optEl.setAttribute('role', 'button');
      
      // Set data-label for CSS ::before pseudo-element (A, B for True/False)
      optEl.setAttribute('data-label', String.fromCharCode(65 + index));

      if (currentAnswer === index) {
        optEl.classList.add('selected');
      }

      // Simply add text content - CSS handles the label via ::before
      optEl.textContent = option;

      // Use data attributes instead of multiple event listeners
      optEl.dataset.questionIndex = questionIndex;
      optEl.dataset.optionIndex = index;
      optEl.onclick = (e) => selectOption(questionIndex, index);
      optEl.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectOption(questionIndex, index);
        }
      };

      opts.appendChild(optEl);
    });
  }

  function buildFillOptions(question, questionIndex, currentAnswer) {
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.className = 'fill-input';
    inputEl.placeholder = 'اكتب إجابتك هنا...';
    inputEl.value = currentAnswer || '';

    // Use direct event handlers instead of addEventListener
    inputEl.oninput = (e) => {
      selectOption(questionIndex, e.target.value);
    };

    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        nextQuestion();
      }
    };

    opts.appendChild(inputEl);

    // Focus the input
    setTimeout(() => {
      inputEl.focus();
    }, 300);
  }

  // 'dropdown' builder removed

  function buildMatchingOptions(question, questionIndex, currentAnswer) {
    // Simplified matching - just show as MCQ for now
    buildMCQOptions(question, questionIndex, currentAnswer);
  }

  function selectOption(questionIndex, value) {
    const question = state.questions[questionIndex];
    const type = getQuestionType(question);

    // تعامل خاص مع الأسئلة ذات الخيارات (بدون مودالات)
    if (type === 'mcq' || type === 'tf') {
      const container = opts;
      const optElements = container ? container.querySelectorAll('.opt') : [];

      // لو تم الضغط مسبقًا على خيار وتم وسمه كخطأ، تجاهل ضغطه مرة أخرى
      const previouslyWrong = optElements[value]?.classList.contains('wrong');
      const previouslyCorrect = optElements[value]?.classList.contains('correct');
      const alreadyAnswered = state.answers[questionIndex] !== undefined && state.answers[questionIndex] !== null;
      
      // منع الإجابة المتكررة
      if (previouslyWrong || previouslyCorrect || (alreadyAnswered && checkAnswer(question, state.answers[questionIndex]))) {
        if (window.debugMode) {
          console.log('Answer already selected or question already answered correctly');
        }
        return;
      }

      // تحديث التحديد البصري
      optElements.forEach((opt, index) => {
        opt.classList.toggle('selected', index === value);
      });

      const isCorrect = checkAnswer(question, value);

      if (!isCorrect) {
        // تلوين الخطأ وتعطيل إعادة الضغط عليه فقط
        const chosen = optElements[value];
        if (chosen) {
          chosen.classList.add('wrong');
          chosen.setAttribute('aria-disabled', 'true');
          chosen.style.pointerEvents = 'none';
          chosen.tabIndex = -1;
        }
        playWrongSound();
        
        // تسجيل المحاولة الخاطئة (لكن لا نحفظها كإجابة نهائية)
        if (!state.wrongAttempts) state.wrongAttempts = {};
        if (!state.wrongAttempts[questionIndex]) state.wrongAttempts[questionIndex] = [];
        state.wrongAttempts[questionIndex].push(value);
        
        // عرض modal الإجابة الخاطئة
        lastAnswerWasCorrect = false;
        setTimeout(() => {
          showWrongAnswerModal(question, value);
        }, 300);
        return;
      }

      // صحيح: تلوين بالأخضر وتعطيل كل الخيارات، ثم عرض modal
      const chosen = optElements[value];
      if (chosen) {
        chosen.classList.add('correct');
        chosen.setAttribute('aria-disabled', 'true');
        chosen.style.pointerEvents = 'none';
        chosen.tabIndex = -1;
      }
      optElements.forEach((opt, index) => {
        if (index !== value) {
          opt.setAttribute('aria-disabled', 'true');
          opt.style.pointerEvents = 'none';
          opt.tabIndex = -1;
        }
      });

      state.answers[questionIndex] = value;
      playCorrectSound();
      saveState();
      
      // تحديث النتيجة الحالية
      updateCurrentScore();

      // إيقاف العداد مؤقتًا حتى الانتقال للسؤال التالي (خيار 3)
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }

      // عرض modal الإجابة الصحيحة
      lastAnswerWasCorrect = true;
      setTimeout(() => {
        showCorrectAnswerModal(question, value);
      }, 300);
      return;
    }

    // أنواع أخرى (fill)
    state.answers[questionIndex] = value;
    playClickSound();
    saveState();
  }

  function animateQuestion() {
    // Simplified, smooth animation - CSS handles it via animations.css
    if (contentBox) {
      // Trigger reflow for CSS animation
      void contentBox.offsetWidth;
    }
  }

  function animateOptions() {
    // Options animate via CSS (quiz-view-animations.css) - no JS needed
    // CSS handles staggered entrance animations automatically
    // This keeps animations smooth and prevents lag
  }

  // ===== Navigation Controls =====
  function previousQuestion() {
    if (state.currentIndex > 0) {
      playClickSound();
      showQuestion(state.currentIndex - 1);
    }
  }

  function nextQuestion() {
    console.log('nextQuestion called - currentIndex:', state.currentIndex, 'total questions:', state.questions.length);
    if (state.currentIndex < state.questions.length - 1) {
      console.log('Moving to next question...');
      playClickSound();
      showQuestion(state.currentIndex + 1);
    } else {
      console.log('Last question - submitting quiz...');
      // Last question - auto submit and show results
      setTimeout(() => {
        submitQuiz(true);
      }, 800);
    }
  }

  function updateControls() {
    if (prevBtn) {
      prevBtn.disabled = state.currentIndex === 0;
    }
    
    if (nextBtn) {
      nextBtn.style.display = state.currentIndex < state.questions.length - 1 ? 'inline-flex' : 'none';
    }
    
    // Hide review and submit buttons - auto submit after last question
    if (reviewBtn) {
      reviewBtn.style.display = 'none';
    }
    
    if (submitBtn) {
      submitBtn.style.display = 'none';
    }
  }

  // Throttled progress update for smooth performance
  const updateProgress = throttleRAF(() => {
    if (progressBar && state.questions.length > 0) {
      const progress = ((state.currentIndex + 1) / state.questions.length) * 100;
      // Only update if progress actually changed
      const currentWidth = progressBar.style.width;
      const newWidth = `${progress}%`;
      if (currentWidth !== newWidth) {
        batchDOMUpdates(() => {
          progressBar.style.width = newWidth;
        });
      }
    }
  });
  
  // Update current score display
  function updateCurrentScore() {
    const results = calculateResults();
    const scoreElement = document.querySelector('.current-score');
    
    if (scoreElement) {
      const correctCount = results.correctAnswers;
      const totalAnswered = Object.values(state.answers).filter(a => a !== null && a !== undefined).length;
      
      batchDOMUpdates(() => {
        scoreElement.textContent = `${correctCount}/${totalAnswered} صحيح`;
      });
      
      if (window.debugMode) {
        console.log(`Current score: ${correctCount}/${totalAnswered} (${results.percentage}%)`);
      }
    }
  }

  // ===== Review System =====
  function showReviewOptions() {
    if (reviewBtn) {
      reviewBtn.style.display = state.settings.allowReview ? 'inline-flex' : 'none';
    }
    
    if (submitBtn) {
      submitBtn.style.display = 'inline-flex';
    }
  }

  function showReviewModal() {
    if (!reviewModal) return;

    const answered = Object.values(state.answers).filter(a => a !== null && a !== '').length;
    const unanswered = state.questions.length - answered;

    if (answeredCount) answeredCount.textContent = answered;
    if (unansweredCount) unansweredCount.textContent = unanswered;
    if (totalQuestionsReview) totalQuestionsReview.textContent = state.questions.length;

    // Build questions grid
    buildQuestionsGrid();

    reviewModal.style.display = 'flex';
    setTimeout(() => {
      reviewModal.classList.add('show');
    }, 10);
  }

  function buildQuestionsGrid() {
    if (!questionsGrid) return;

    questionsGrid.innerHTML = '';

    state.questions.forEach((question, index) => {
      const questionItem = document.createElement('div');
      questionItem.className = 'question-item';
      questionItem.textContent = index + 1;

      const answer = state.answers[index];
      const isAnswered = answer !== null && answer !== '';
      
      questionItem.classList.add(isAnswered ? 'answered' : 'unanswered');
      
      questionItem.addEventListener('click', () => {
        hideReviewModal();
        showQuestion(index);
      });

      questionsGrid.appendChild(questionItem);
    });
  }

  function hideReviewModal() {
    if (reviewModal) {
      reviewModal.classList.remove('show');
      setTimeout(() => {
        reviewModal.style.display = 'none';
      }, 250);
    }
  }

  // ===== Quiz Submission =====
  async function submitQuiz(isAutoSubmit = false) {
    if (state.isSubmitted) return;

    // Check for unanswered questions
    const unanswered = Object.values(state.answers).filter(a => a === null || a === '').length;
    
    if (unanswered > 0 && !isAutoSubmit) {
      const confirmSubmit = confirm(`لديك ${unanswered} أسئلة غير مُجابة. هل تريد المتابعة؟`);
      if (!confirmSubmit) return;
    }

    state.isSubmitted = true;
    state.endTime = Date.now();
    
    // Stop timer
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }

    // Calculate results
    const results = calculateResults();

    // Attempt to persist submission to server (bind to student if selected)
    try {
      const sel = document.getElementById('studentSelect');
      const studentId = sel ? sel.value || null : null;
      const studentName = sel ? (sel.options[sel.selectedIndex]?.text || null) : null;

      const payload = {
        testId: state.quiz?.id,
        studentId,
        studentName,
        answers: Object.entries(state.answers).map(([idx, ans]) => ({
          questionId: state.questions?.[Number(idx)]?.id,
          answerIndex: typeof ans === 'number' ? ans : null
        }))
      };

      // Only send if we have quiz id and at least one answer mapping
      const canSend = payload.testId && Array.isArray(payload.answers) && payload.answers.length > 0;
      if (canSend) {
        const resp = await fetch('/api/submit-answers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) {
          console.warn('Server submit failed with status', resp.status);
        }
      }
    } catch (e) {
      console.warn('Failed to submit answers to server, will still show local results.', e);
    }
    
    // Show results immediately
    console.log('About to show results:', results);
    setTimeout(() => {
      console.log('Calling showResults...');
      showResults(results);
      playCorrectSound();
      showToast('انتهى الاختبار!', 'success');
    }, 100);
  }

  function calculateResults() {
    let correctAnswers = 0;
    let totalQuestions = state.questions.length;
    let totalPoints = 0;
    let earnedPoints = 0;
    let questionsWithWrongAttempts = 0;

    // Only log in debug mode
    if (window.debugMode) {
      console.log('Calculating results for questions:', state.questions.length);
      console.log('User answers:', state.answers);
    }

    const questionResults = state.questions.map((question, index) => {
      const userAnswer = state.answers[index];
      // Try both possible property names
      const correctAnswer = question.correct || question.correctAnswer;
      const points = question.points || 1;
      totalPoints += points;
      
      // Only log in debug mode
      if (window.debugMode) {
        console.log(`Question ${index}:`, {
          question: question.text || question.question,
          userAnswer,
          correctAnswer,
          questionCorrect: question.correct,
          questionCorrectAnswer: question.correctAnswer,
          type: getQuestionType(question)
        });
      }

      let isCorrect = false;
      let hasWrongAttempts = false;
      
      // Check if there were wrong attempts for this question
      if (state.wrongAttempts && state.wrongAttempts[index] && state.wrongAttempts[index].length > 0) {
        hasWrongAttempts = true;
        questionsWithWrongAttempts++;
      }
      
      const type = getQuestionType(question);
      
      switch (type) {
        case 'mcq':
          isCorrect = userAnswer === correctAnswer;
          break;
        case 'tf':
          // Fix True/False logic: 0 = True, 1 = False
          let expectedValue;
          if (correctAnswer === true || correctAnswer === 'true' || correctAnswer === 1 || correctAnswer === '1') {
            expectedValue = 0; // True option
          } else {
            expectedValue = 1; // False option
          }
          isCorrect = userAnswer === expectedValue;
          break;
        case 'fill':
          if (userAnswer && correctAnswer) {
            isCorrect = normalize(userAnswer) === normalize(correctAnswer);
          }
          break;
        default:
          isCorrect = userAnswer === correctAnswer;
      }

      // If user made wrong attempts first, mark as incorrect even if final answer is correct
      if (hasWrongAttempts) {
        isCorrect = false;
        if (window.debugMode) {
          console.log(`Question ${index} marked as wrong due to previous wrong attempts:`, state.wrongAttempts[index]);
        }
      }

      if (isCorrect) {
        correctAnswers++;
        earnedPoints += points;
      }

      return {
        questionIndex: index,
        question: question,
        userAnswer: userAnswer,
        correctAnswer: correctAnswer,
        isCorrect: isCorrect,
        points: points,
        earnedPoints: isCorrect ? points : 0,
        wrongAttempts: state.wrongAttempts?.[index] || [],
        attemptCount: (state.wrongAttempts?.[index] || []).length + (userAnswer !== null && userAnswer !== undefined ? 1 : 0),
        hasWrongAttempts: hasWrongAttempts,
        finalAnswerCorrect: hasWrongAttempts ? checkAnswer(question, userAnswer) : isCorrect // Track if final answer was technically correct
      };
    });

    const percentage = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
    const timeSpentMs = state.endTime - state.startTime;
    const timeSpentSeconds = Math.floor(timeSpentMs / 1000);

    const results = {
      totalQuestions,
      correctAnswers,
      wrongAnswers: totalQuestions - correctAnswers,
      percentage,
      totalPoints,
      earnedPoints,
      timeSpentSeconds,
      questionResults,
      questionsWithWrongAttempts,
      grade: getGrade(percentage)
    };
    
    // Only log in debug mode
    if (window.debugMode) {
      console.log('Final calculation results:', results);
      console.log('Question by question results:', questionResults);
    }
    
    return results;
  }

  function getGrade(percentage) {
    if (percentage >= 90) return 'ممتاز';
    if (percentage >= 80) return 'جيد جداً';
    if (percentage >= 70) return 'جيد';
    if (percentage >= 60) return 'مقبول';
    return 'ضعيف';
  }

  async function saveSubmission(results) {
    const submission = {
      id: uid(),
      quizId: state.quiz.id,
      quizName: state.quiz.name,
      studentId: 'current-user', // In a real app, this would be the actual student ID
      studentName: 'الطالب الحالي',
      answers: state.answers,
      results: results,
      startTime: state.startTime,
      endTime: state.endTime,
      submittedAt: new Date().toISOString()
    };

    try {
      let submissions = [];
      
      if (hasAPI && window.api.loadQuizSubmissions) {
        submissions = await window.api.loadQuizSubmissions() || [];
      } else {
        const stored = localStorage.getItem('cm_quiz_submissions_v1');
        submissions = stored ? JSON.parse(stored) : [];
      }
      
      submissions.push(submission);
      
      if (hasAPI && window.api.saveQuizSubmissions) {
        await window.api.saveQuizSubmissions(submissions);
      } else {
        localStorage.setItem('cm_quiz_submissions_v1', JSON.stringify(submissions));
      }
      
    } catch (error) {
      console.error('Error saving submission:', error);
      showToast('خطأ في حفظ النتائج', 'error');
    }
  }

  function showResults(results) {
    console.log('showResults called with:', results);
    console.log('finalResultsModal element:', finalResultsModal);
    
    if (!finalResultsModal) {
      console.error('Final results modal not found');
      return;
    }

    try {
      // Only log in debug mode
      if (window.debugMode) {
        console.log('Before showing modal - current style:', {
          display: finalResultsModal.style.display,
          opacity: finalResultsModal.style.opacity,
          visibility: finalResultsModal.style.visibility
        });
      }
      
      // Update score circle
      if (finalScore) {
        finalScore.textContent = `${results.percentage}%`;
        if (finalScore.parentElement) {
          finalScore.parentElement.style.setProperty('--score', results.percentage);
        }
      }

      // Update results details with new format
      if (correctCount) correctCount.textContent = results.correctAnswers;
      
      const totalQuestionsEl = document.getElementById('totalQuestions');
      if (totalQuestionsEl) totalQuestionsEl.textContent = results.totalQuestions;
      
      const percentageDisplayEl = document.getElementById('percentageDisplay');
      if (percentageDisplayEl) percentageDisplayEl.textContent = `${results.percentage}%`;
      
      if (timeSpent) timeSpent.textContent = formatTime(results.timeSpentSeconds);
      if (gradeText) gradeText.textContent = results.grade;
      
      // Show wrong attempts info if any
      const wrongAttemptsInfo = document.getElementById('wrongAttemptsInfo');
      const wrongAttemptsCount = document.getElementById('wrongAttemptsCount');
      if (wrongAttemptsInfo && wrongAttemptsCount) {
        if (results.questionsWithWrongAttempts > 0) {
          wrongAttemptsCount.textContent = results.questionsWithWrongAttempts;
          wrongAttemptsInfo.style.display = 'flex';
        } else {
          wrongAttemptsInfo.style.display = 'none';
        }
      }

      // Show modal with direct approach - no animation to avoid conflicts
      // Only log in debug mode
      if (window.debugMode) {
        console.log('Setting modal styles directly...');
      }
      
      // Remove any conflicting classes first
      finalResultsModal.classList.remove('hide');
      finalResultsModal.classList.add('show');
      
      // Set styles directly
      finalResultsModal.style.display = 'flex';
      finalResultsModal.style.opacity = '1';
      finalResultsModal.style.visibility = 'visible';
      finalResultsModal.style.pointerEvents = 'auto';
      finalResultsModal.style.zIndex = '10000';
      
      // Only log in debug mode
      if (window.debugMode) {
        console.log('Modal should now be visible:', {
          display: finalResultsModal.style.display,
          opacity: finalResultsModal.style.opacity,
          visibility: finalResultsModal.style.visibility,
          classList: finalResultsModal.classList.toString()
        });
      }
      
      // Simplified visibility check - only if needed
      let visibilityCheckCount = 0;
      const keepVisible = setInterval(() => {
        visibilityCheckCount++;
        
        if (finalResultsModal.style.display !== 'flex' || 
            finalResultsModal.style.opacity !== '1' ||
            !finalResultsModal.classList.contains('show')) {
          
          finalResultsModal.classList.add('show');
          finalResultsModal.style.display = 'flex';
          finalResultsModal.style.opacity = '1';
          finalResultsModal.style.visibility = 'visible';
          finalResultsModal.style.zIndex = '10000';
        }
        
        // Stop after 20 checks (2 seconds) or if stable
        if (visibilityCheckCount >= 20) {
          clearInterval(keepVisible);
          window.modalKeepVisibleInterval = null;
        }
      }, 100); // Check every 100ms instead of 50ms
      
      // Store the interval ID to prevent conflicts
      window.modalKeepVisibleInterval = keepVisible;
      
      // Only log in debug mode
      if (window.debugMode) {
        console.log('Results modal shown successfully');
      }
      
      // Prevent accidental closing
      finalResultsModal.addEventListener('click', (e) => {
        // Only close if clicking on the overlay, not the modal content
        if (e.target === finalResultsModal) {
          e.preventDefault();
          e.stopPropagation();
          // Don't close automatically - require explicit button click
        }
      }, { once: true });
      
    } catch (error) {
      console.error('Error showing results:', error);
      showToast('خطأ في عرض النتائج', 'error');
    }
  }

  function closeFinalResults() {
    try {
      // Clear the keep visible interval first
      if (window.modalKeepVisibleInterval) {
        clearInterval(window.modalKeepVisibleInterval);
        window.modalKeepVisibleInterval = null;
        console.log('Cleared modal keep visible interval');
      }
      
      if (finalResultsModal) {
        finalResultsModal.style.opacity = '0';
        finalResultsModal.classList.remove('show');
        
        setTimeout(() => {
          finalResultsModal.style.display = 'none';
          finalResultsModal.style.visibility = 'hidden';
        }, 300);
        
        console.log('Final results modal closed');
      }
    } catch (error) {
      console.error('Error closing final results:', error);
    }
  }

  function showCorrectAnswers(results) {
    const correctAnswersList = document.getElementById('correctAnswersList');
    if (!correctAnswersList) return;

    correctAnswersList.innerHTML = '';

    state.questions.forEach((question, index) => {
      const correctAnswer = getCorrectAnswerText(question);
      
      const answerItem = document.createElement('div');
      answerItem.className = 'correct-answer-item';
      
      answerItem.innerHTML = `
        <div class="correct-answer-number">${index + 1}</div>
        <div class="correct-answer-content">
          <div class="correct-answer-question">${escapeHTML(question.question)}</div>
          <div class="correct-answer-text">✓ ${escapeHTML(correctAnswer)}</div>
        </div>
      `;
      
      correctAnswersList.appendChild(answerItem);
    });
  }

  function getCorrectAnswerText(question) {
    const type = getQuestionType(question);
    
    switch (type) {
      case 'mcq':
        const correctOption = question.options?.find(opt => opt.correct);
        return correctOption ? correctOption.text : 'غير محدد';
      
      case 'tf':
        return question.correct === true ? 'صحيح' : 'خطأ';
      
      case 'text':
        return question.correct || 'إجابة نصية';
      
      default:
        return 'غير محدد';
    }
  }

  // ===== State Management =====
  // Debounced saveState to reduce localStorage writes
  const saveState = debounce(() => {
    const stateData = {
      quizId: state.quiz?.id,
      currentIndex: state.currentIndex,
      answers: state.answers,
      startTime: state.startTime,
      questionTimeLimit: state.questionTimeLimit,
      questionTimeRemaining: state.questionTimeRemaining,
      isStarted: state.isStarted,
      settings: state.settings
    };

    localStorage.setItem(LS_QUIZ_STATE, JSON.stringify(stateData));
  }, 300); // Save at most once every 300ms

  function loadSavedState() {
    try {
      const saved = localStorage.getItem(LS_QUIZ_STATE);
      if (!saved) return;

      const stateData = JSON.parse(saved);
      
      // Only load if same quiz
      if (stateData.quizId === state.quiz?.id) {
        // تم إلغاء خيار "المتابعة من حيث توقفت" - يبدأ الاختبار من جديد دائماً
        // Always clear saved state and start fresh
        clearSavedState();
        console.log('Saved state cleared - quiz will start fresh');
      }
    } catch (error) {
      console.error('Error loading saved state:', error);
    }
  }

  function clearSavedState() {
    try {
      localStorage.removeItem(LS_QUIZ_STATE);
      localStorage.removeItem(LS_QUIZ_ANSWERS);
      console.log('Saved state cleared');
    } catch (error) {
      console.error('Error clearing saved state:', error);
    }
  }

  function continueQuiz() {
    try {
      state.isStarted = true;
      
      // Initialize question timer settings if not set
      if (!state.questionTimeLimit) {
        state.questionTimeLimit = 60; // default 60 seconds
        state.questionTimeRemaining = 60;
      }
      
      if (startOverlay) startOverlay.style.display = 'none';
      if (contentBox) contentBox.style.display = 'flex';
      if (headerTimer) headerTimer.style.display = 'inline-flex';

      try {
        startTimer();
      } catch (timerError) {
        console.error('Timer start failed in continue:', timerError);
      }

      try {
        showQuestion(state.currentIndex);
      } catch (questionError) {
        console.error('Failed to show question in continue:', questionError);
        showToast('خطأ في عرض السؤال', 'error');
        return;
      }

      try {
        updateControls();
      } catch (controlsError) {
        console.warn('Controls update failed in continue:', controlsError);
      }
      
      showToast('تم استكمال الاختبار', 'info');
    } catch (error) {
      console.error('Critical error in continueQuiz:', error);
      showToast('خطأ في استكمال الاختبار', 'error');
      
      // Reset state if something went wrong
      state.isStarted = false;
      if (startOverlay) {
        startOverlay.style.display = 'flex';
      }
      if (contentBox) {
        contentBox.style.display = 'none';
      }
    }
  }

  // ===== Event Handlers =====
  function setupEventHandlers() {
    try {
      // Start button - enhanced setup with multiple fallbacks
      if (startBtn) {
        try {
          // Remove any existing handlers first
          startBtn.onclick = null;
          startBtn.removeEventListener('click', startQuiz);
          
          // Add both event listener and onclick for maximum compatibility
          startBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Start button clicked via addEventListener');
            startQuiz();
          });
          
          startBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Start button clicked via onclick');
            startQuiz();
          };
          
          // Mark as set up
          startBtn.dataset.handlerSet = 'true';
          console.log('Start button handlers set up successfully');
        } catch (startBtnError) {
          console.error('Error setting up start button:', startBtnError);
        }
      } else {
        console.warn('Start button not found in DOM');
      }

      // Navigation buttons - simplified setup
      if (prevBtn && !prevBtn.dataset.handlerSet) {
        prevBtn.onclick = previousQuestion;
        prevBtn.dataset.handlerSet = 'true';
      }

      if (nextBtn && !nextBtn.dataset.handlerSet) {
        nextBtn.onclick = nextQuestion;
        nextBtn.dataset.handlerSet = 'true';
      }

      // Review button - simplified setup
      if (reviewBtn && !reviewBtn.dataset.handlerSet) {
        reviewBtn.onclick = showReviewModal;
        reviewBtn.dataset.handlerSet = 'true';
      }

      // Submit button - simplified setup
      if (submitBtn && !submitBtn.dataset.handlerSet) {
        submitBtn.onclick = () => submitQuiz(false);
        submitBtn.dataset.handlerSet = 'true';
      }

      // Sound toggle
      if (toggleSfxBtn) {
        try {
          // Load saved soundsEnabled from localStorage (if available)
          try {
            const savedSounds = localStorage.getItem('cm_sounds_enabled');
            if (savedSounds !== null) {
              state.soundsEnabled = savedSounds === 'true';
            }
          } catch (e) {}

          // Initial sync of button UI with current state
          // Use CSS icons instead of textContent flipping
          toggleSfxBtn.classList.toggle('muted', !state.soundsEnabled);
          toggleSfxBtn.setAttribute('aria-pressed', String(state.soundsEnabled));

          toggleSfxBtn.addEventListener('click', () => {
            state.soundsEnabled = !state.soundsEnabled;
            // Persist setting
            try { localStorage.setItem('cm_sounds_enabled', String(state.soundsEnabled)); } catch {}
            // Sync UI (CSS class + aria)
            toggleSfxBtn.classList.toggle('muted', !state.soundsEnabled);
            toggleSfxBtn.setAttribute('aria-pressed', String(state.soundsEnabled));
            try {
              // Ensure audio is initialized/active on user gesture
              initAudio();
              if (audioContext && typeof audioContext.state === 'string' && audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
              }
              if (state.soundsEnabled) {
                playClickSound();
              }
            } catch (soundError) {
              console.warn('Error handling sound toggle:', soundError);
            }
          });

          // Also ensure audio gets initialized on first user interaction (before quiz start)
          const initAudioOnce = () => {
            try {
              initAudio();
              if (audioContext && typeof audioContext.state === 'string' && audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
              }
            } catch {}
            document.removeEventListener('click', initAudioOnce);
          };
          document.addEventListener('click', initAudioOnce, { once: true });
        } catch (soundToggleError) {
          console.error('Error setting up sound toggle:', soundToggleError);
        }
      }

      // Modal disabled: no-op

      if (resultClose) {
        try {
          resultClose.addEventListener('click', () => {
            if (resultOverlay) {
              resultOverlay.style.display = 'none';
            }
          });
        } catch (resultCloseError) {
          console.error('Error setting up result close button:', resultCloseError);
        }
      }

      if (continueQuizBtn) {
        try {
          continueQuizBtn.addEventListener('click', hideReviewModal);
        } catch (continueError) {
          console.error('Error setting up continue button:', continueError);
        }
      }

      if (finalSubmit) {
        try {
          finalSubmit.addEventListener('click', () => {
            hideReviewModal();
            submitQuiz(false);
          });
        } catch (finalSubmitError) {
          console.error('Error setting up final submit button:', finalSubmitError);
        }
      }

      // Control buttons
      const goHomeBtn = document.getElementById('goHome');
      if (goHomeBtn) {
        try {
          goHomeBtn.addEventListener('click', () => {
            if (state.isStarted && !state.isSubmitted) {
              const confirmLeave = confirm('سيتم فقدان تقدمك في الاختبار. هل تريد المتابعة؟');
              if (!confirmLeave) return;
            }
            closeQuizWindow();
          });
        } catch (goHomeError) {
          console.error('Error setting up go home button:', goHomeError);
        }
      }

      const closeWindowBtn = document.getElementById('closeWindow');
      if (closeWindowBtn) {
        try {
          closeWindowBtn.addEventListener('click', () => {
            if (state.isStarted && !state.isSubmitted) {
              const confirmClose = confirm('سيتم فقدان تقدمك في الاختبار. هل تريد إغلاق النافذة؟');
              if (!confirmClose) return;
            }
            closeQuizWindow();
          });
        } catch (closeWindowError) {
          console.error('Error setting up close window button:', closeWindowError);
        }
      }
    } catch (error) {
      console.error('Critical error in setupEventHandlers:', error);
    }

    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', toggleFullscreen);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);

    // Prevent accidental page leave
    window.addEventListener('beforeunload', (e) => {
      if (state.isStarted && !state.isSubmitted) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Sticky header scroll effect - تأثير التمرير على الهيدر
    if (card && quizHeader) {
      const handleScroll = throttleRAF(() => {
        if (card.scrollTop > 10) {
          quizHeader.classList.add('scrolled');
        } else {
          quizHeader.classList.remove('scrolled');
        }
      });
      
      card.addEventListener('scroll', handleScroll);
    }
  }

  function handleKeyboard(e) {
    if (!state.isStarted) {
      if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        startQuiz();
      }
      return;
    }

    // Don't handle if typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        previousQuestion();
        break;
      case 'ArrowRight':
      case ' ':
        e.preventDefault();
        nextQuestion();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        e.preventDefault();
        const optionIndex = parseInt(e.key) - 1;
        const optElements = opts.querySelectorAll('.opt');
        if (optElements[optionIndex]) {
          selectOption(state.currentIndex, optionIndex);
        }
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        if (reviewBtn && reviewBtn.style.display !== 'none') {
          showReviewModal();
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (submitBtn && submitBtn.style.display !== 'none') {
          submitQuiz(false);
        }
        break;
    }
  }

  function toggleFullscreen() {
    const elem = document.documentElement;
    
    if (!document.fullscreenElement) {
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }

  // ===== Window Management =====
  function isStandaloneWindow() {
    return window.opener !== null;
  }

  function setupWindowBehavior() {
    if (isStandaloneWindow()) {
      // إضافة تحذير عند إغلاق النافذة أثناء الاختبار
      window.addEventListener('beforeunload', (e) => {
        if (state.isStarted && !state.isSubmitted) {
          e.preventDefault();
          e.returnValue = 'هل أنت متأكد من إغلاق النافذة؟ سيتم فقدان تقدمك في الاختبار.';
          return e.returnValue;
        }
      });

      // إضافة أنماط خاصة بالنافذة المستقلة
      document.body.classList.add('standalone-window');
    }
  }

  function updateWindowTitle() {
    if (isStandaloneWindow() && state.quiz) {
      document.title = `اختبار: ${state.quiz.name}`;
    }
  }

  // ===== Answer Feedback Modals =====
  function checkAnswer(question, selectedValue) {
    if (!question || selectedValue === undefined || selectedValue === null) return false;
    
    const type = getQuestionType(question);
    // Use the same logic as calculateResults - try both property names
    const correctAnswer = question.correct || question.correctAnswer;
    
    // Only log in debug mode
    if (window.debugMode) {
      console.log('checkAnswer:', {
        type,
        selectedValue,
        correctAnswer,
        questionCorrect: question.correct,
        questionCorrectAnswer: question.correctAnswer
      });
    }
    
    if (type === 'mcq') {
      return correctAnswer === selectedValue;
    } else if (type === 'tf') {
      // Fix True/False logic: 0 = True, 1 = False
      // correctAnswer can be: true/false, 0/1, "true"/"false"
      let expectedValue;
      if (correctAnswer === true || correctAnswer === 'true' || correctAnswer === 1 || correctAnswer === '1') {
        expectedValue = 0; // True option
      } else {
        expectedValue = 1; // False option
      }
      return selectedValue === expectedValue;
    } else if (type === 'fill') {
      // For fill-in-the-blank, normalize and compare
      const userAnswer = normalize(selectedValue.toString());
      const normalizedCorrect = normalize(correctAnswer?.toString() || '');
      return userAnswer === normalizedCorrect;
    }
    
    return false;
  }
  

  function showCorrectAnswerModal(question, selectedValue) {
    try {
      const correctModal = document.getElementById('correctAnswerModal');
      if (!correctModal) {
        console.warn('Correct answer modal not found');
        // الانتقال للسؤال التالي مباشرة إذا لم يوجد modal
        setTimeout(() => {
          if (state.currentIndex < state.questions.length - 1) {
            nextQuestion();
          }
        }, 500);
        return;
      }

      // تحديث محتوى modal
      const feedbackMessage = correctModal.querySelector('.feedback-message');
      const feedbackExplanation = correctModal.querySelector('.feedback-explanation');
      
      if (feedbackMessage) {
        const type = getQuestionType(question);
        let selectedText = '';
        
        if (type === 'mcq' && question.options && question.options[selectedValue]) {
          selectedText = question.options[selectedValue];
        } else if (type === 'tf') {
          selectedText = selectedValue === 0 ? 'صحيح' : 'خطأ';
        } else {
          selectedText = 'إجابتك صحيحة';
        }
        
        feedbackMessage.innerHTML = `
          <p style="font-size: 18px; margin-bottom: 8px;"><strong>إجابتك:</strong> ${escapeHTML(selectedText)}</p>
          <p class="success-message" style="color: var(--quiz-success); font-weight: 700; font-size: 20px;">🎉 أحسنت! إجابة ممتازة</p>
        `;
      }

      // عرض التفسير إذا كان متوفراً
      if (feedbackExplanation && question.explanation && question.explanation.trim()) {
        feedbackExplanation.textContent = question.explanation;
        feedbackExplanation.style.display = 'block';
      } else if (feedbackExplanation) {
        feedbackExplanation.style.display = 'none';
      }

      // عرض modal بشكل فوري مع تحسين الأداء
      batchDOMUpdates(() => {
        correctModal.style.display = 'flex';
        // استخدام requestAnimationFrame بدلاً من setTimeout لأداء أفضل
        requestAnimationFrame(() => {
          correctModal.classList.add('show');
          // إزالة will-change بعد انتهاء الانتقال لتوفير الذاكرة
          setTimeout(() => {
            correctModal.style.willChange = 'auto';
          }, 300);
        });
      });
      
      // تشغيل صوت النجاح
      try {
        playCorrectSound();
      } catch (soundError) {
        console.warn('Could not play correct sound:', soundError);
      }
      
      // ✅ تم إلغاء الانتقال التلقائي - لا يتم الانتقال إلا بالضغط على زر "متابعة"
      // لا يوجد auto-close للـ modal - المستخدم يجب أن يضغط على زر "متابعة"
      
      if (window.debugMode) {
        console.log('Correct answer modal shown - waiting for user to click continue');
      }
    } catch (error) {
      console.error('Error showing correct answer modal:', error);
      // الانتقال للسؤال التالي في حالة الخطأ
      setTimeout(() => {
        if (state.currentIndex < state.questions.length - 1) {
          nextQuestion();
        }
      }, 500);
    }
  }

  function showWrongAnswerModal(question, selectedValue, questionIndex = state.currentIndex) {
    try {
      const wrongModal = document.getElementById('wrongAnswerModal');
      if (!wrongModal) {
        console.warn('Wrong answer modal not found');
        return;
      }

      // تحديث محتوى modal
      const feedbackMessage = wrongModal.querySelector('.feedback-message');
      const feedbackExplanation = wrongModal.querySelector('.feedback-explanation');
      const feedbackCorrect = wrongModal.querySelector('.feedback-correct');
      
      const type = getQuestionType(question);
      let selectedText = '';
      
      if (type === 'mcq' && question.options && question.options[selectedValue]) {
        selectedText = question.options[selectedValue];
      } else if (type === 'tf') {
        selectedText = selectedValue === 0 ? 'صحيح' : 'خطأ';
      } else {
        selectedText = 'إجابتك';
      }
      
      // عدد المحاولات الخاطئة
      const wrongAttempts = state.wrongAttempts?.[questionIndex] || [];
      const attemptCount = wrongAttempts.length;
      
      if (feedbackMessage) {
        if (state.settings.showCorrectAnswerOnWrong) {
          feedbackMessage.innerHTML = `
            <p style="font-size: 18px; margin-bottom: 8px;"><strong>إجابتك:</strong> ${escapeHTML(selectedText)}</p>
            <p class="error-message" style="color: #fff; font-weight: 700; font-size: 20px;">❌ للأسف، هذه الإجابة غير صحيحة</p>
            ${attemptCount > 1 ? `<p style="color: var(--quiz-warning); font-size: 16px; margin-top: 8px;">المحاولة رقم ${attemptCount}</p>` : ''}
            <p style="color: var(--quiz-muted); font-size: 16px; margin-top: 12px;">راجع الإجابة الصحيحة أدناه وحاول مرة أخرى</p>
          `;
        } else {
          feedbackMessage.innerHTML = `
            <p style="font-size: 18px; margin-bottom: 8px;"><strong>إجابتك:</strong> ${escapeHTML(selectedText)}</p>
            <p class="error-message" style="color: #fff; font-weight: 700; font-size: 20px;">❌ للأسف، هذه الإجابة غير صحيحة</p>
          `;
        }
      }

      // عرض الإجابة الصحيحة (حسب الإعداد)
      if (feedbackCorrect) {
        if (state.settings.showCorrectAnswerOnWrong) {
          const correctAnswer = question.correct || question.correctAnswer;
          let correctText = '';
          
          if (type === 'mcq' && question.options && question.options[correctAnswer]) {
            correctText = question.options[correctAnswer];
          } else if (type === 'tf') {
            // Fix True/False display logic
            if (correctAnswer === true || correctAnswer === 'true' || correctAnswer === 1 || correctAnswer === '1') {
              correctText = 'صحيح';
            } else {
              correctText = 'خطأ';
            }
          } else {
            correctText = correctAnswer || 'غير محدد';
          }
          
          feedbackCorrect.innerHTML = `
            <span>✅ الإجابة الصحيحة:</span>
            <span>${escapeHTML(correctText)}</span>
          `;
          feedbackCorrect.style.display = 'flex';
        } else {
          feedbackCorrect.style.display = 'none';
        }
      }

      // عرض التفسير إذا كان متوفراً
      if (feedbackExplanation && question.explanation && question.explanation.trim()) {
        feedbackExplanation.textContent = question.explanation;
        feedbackExplanation.style.display = 'block';
      } else if (feedbackExplanation) {
        feedbackExplanation.style.display = 'none';
      }

      // عرض modal بشكل فوري مع تحسين الأداء
      batchDOMUpdates(() => {
        wrongModal.style.display = 'flex';
        // استخدام requestAnimationFrame بدلاً من setTimeout لأداء أفضل
        requestAnimationFrame(() => {
          wrongModal.classList.add('show');
          // إزالة will-change بعد انتهاء الانتقال لتوفير الذاكرة
          setTimeout(() => {
            wrongModal.style.willChange = 'auto';
          }, 200);
        });
      });
      
      // تشغيل صوت الخطأ
      try {
        playWrongSound();
      } catch (soundError) {
        console.warn('Could not play wrong sound:', soundError);
      }
      
      // ✅ تم إلغاء الانتقال التلقائي - لا يتم الانتقال إلا بالضغط على زر "متابعة"
      // لا يوجد auto-close للـ modal - المستخدم يجب أن يضغط على زر "متابعة"
      
      if (window.debugMode) {
        console.log('Wrong answer modal shown - waiting for user to click continue');
      }
    } catch (error) {
      console.error('Error showing wrong answer modal:', error);
    }
  }
  
  function closeAnswerModal() {
    try {
      const correctModal = document.getElementById('correctAnswerModal');
      const wrongModal = document.getElementById('wrongAnswerModal');
      
      console.log('closeAnswerModal called');
      
      // ✅ تحديد نوع modal المفتوح قبل أي تعديل
      const isCorrectModalOpen = correctModal && correctModal.style.display === 'flex' && correctModal.classList.contains('show');
      const isWrongModalOpen = wrongModal && wrongModal.style.display === 'flex' && wrongModal.classList.contains('show');
      const determinedByDOM = !!(isCorrectModalOpen || isWrongModalOpen);
      const effectiveCorrect = isCorrectModalOpen || (!determinedByDOM && lastAnswerWasCorrect === true);
      const effectiveWrong = isWrongModalOpen || (!determinedByDOM && lastAnswerWasCorrect === false);
      
      console.log('Modal states:', { isCorrectModalOpen, isWrongModalOpen, lastAnswerWasCorrect, effectiveCorrect, effectiveWrong });
      
      // إخفاء modal مع تأثير محسن
      if (correctModal && correctModal.classList.contains('show')) {
        correctModal.classList.remove('show');
        setTimeout(() => {
          correctModal.style.display = 'none';
        }, 300);
      }
      
      if (wrongModal && wrongModal.classList.contains('show')) {
        wrongModal.classList.remove('show');
        setTimeout(() => {
          wrongModal.style.display = 'none';
        }, 300);
      }
      
      // ✅ الانتقال بناءً على النوع الفعّال (DOM أو fallback عبر الحالة)
      if (effectiveCorrect) {
        console.log('Correct answer (DOM or fallback) - moving to next question');
        console.log('Current index:', state.currentIndex, 'Total questions:', state.questions.length);
        if (state.currentIndex < state.questions.length - 1) {
          console.log('Will call nextQuestion() after 350ms');
          setTimeout(() => {
            console.log('Now calling nextQuestion()');
            nextQuestion();
          }, 350);
        } else {
          console.log('Last question - will call submitQuiz() after 350ms');
          setTimeout(() => {
            console.log('Now calling submitQuiz()');
            submitQuiz(true);
          }, 350);
        }
        // Clear flag after action to avoid stale state
        lastAnswerWasCorrect = null;
      } else if (effectiveWrong) {
        // إذا كانت الإجابة خاطئة، لا يتم الانتقال - المستخدم يبقى في نفس السؤال
        console.log('Wrong answer (DOM or fallback) - staying on current question');
        setTimeout(() => {
          const opts = document.querySelectorAll('.opt');
          opts.forEach(opt => {
            if (!opt.classList.contains('wrong')) {
              opt.style.pointerEvents = 'auto';
              opt.removeAttribute('aria-disabled');
              opt.tabIndex = 0;
            }
          });
        }, 350);
        // Clear flag after handling
        lastAnswerWasCorrect = null;
      } else {
        console.warn('No modal detected and no fallback state available. Staying on current question.');
      }
      
    } catch (error) {
      console.error('Error closing answer modal:', error);
    }
  }
  
  // Make closeAnswerModal available globally for HTML onclick
  window.closeAnswerModal = closeAnswerModal;
  
  // Add event listeners for closing modals by clicking outside or pressing Escape
  function setupModalEventListeners() {
    try {
      const correctModal = document.getElementById('correctAnswerModal');
      const wrongModal = document.getElementById('wrongAnswerModal');
      
      [correctModal, wrongModal].forEach(modal => {
        if (modal) {
          try {
            // Close when clicking the dark backdrop
            modal.addEventListener('click', (e) => {
              if (e.target === modal) {
                closeAnswerModal();
              }
            });

            // Ensure the inner action button triggers closeAnswerModal even if inline handlers are blocked by CSP
            const btn = modal.querySelector('.feedback-btn');
            if (btn) {
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeAnswerModal();
              });

              // Keyboard support just in case
              btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  closeAnswerModal();
                }
              });
            }
          } catch (modalError) {
            console.warn('Error setting up modal listeners:', modalError);
          }
        }
      });
      
      // Close modal with Escape key
      try {
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            try {
              const isModalOpen = correctModal?.classList.contains('show') || wrongModal?.classList.contains('show');
              if (isModalOpen) {
                closeAnswerModal();
              }
            } catch (escapeError) {
              console.warn('Error handling escape key:', escapeError);
            }
          }
        });
      } catch (keyError) {
        console.warn('Error setting up escape key listener:', keyError);
      }
      
      // Setup restart quiz button
      try {
        const restartBtn = document.getElementById('restartQuiz');
        if (restartBtn) {
          restartBtn.removeEventListener('click', restartQuiz);
          restartBtn.addEventListener('click', restartQuiz);
          restartBtn.onclick = restartQuiz;
          console.log('Restart button set up successfully');
        }
      } catch (restartError) {
        console.warn('Error setting up restart button:', restartError);
      }
      
      // Setup close results modal button
      try {
        const closeResultsBtn = document.getElementById('closeResults');
        if (closeResultsBtn) {
          closeResultsBtn.removeEventListener('click', closeFinalResults);
          closeResultsBtn.addEventListener('click', closeFinalResults);
          closeResultsBtn.onclick = closeFinalResults;
          console.log('Close results button set up successfully');
        }
      } catch (closeError) {
        console.warn('Error setting up close results button:', closeError);
      }
      
    } catch (error) {
      console.error('Error setting up modal event listeners:', error);
    }
  }

  function closeQuizWindow() {
    if (isStandaloneWindow()) {
      // حفظ النتائج قبل الإغلاق
      if (state.isSubmitted) {
        saveQuizResults();
      }
      
      // إغلاق النافذة
      window.close();
    } else {
      // العودة لصفحة الاختبارات
      window.location.href = '/pages/quizzes.html';
    }
  }

  // ===== Initialization =====
  function init() {
    try {
      console.log('Initializing quiz view...');
      
      // Check for essential DOM elements
      const essentialElements = [
        { element: startBtn, name: 'Start button' },
        { element: contentBox, name: 'Content box' },
        { element: startOverlay, name: 'Start overlay' }
      ];
      
      const missingElements = essentialElements.filter(item => !item.element);
      if (missingElements.length > 0) {
        console.warn('Missing essential elements:', missingElements.map(item => item.name));
      }
      
      try {
        console.log('Setting up event handlers...');
        setupEventHandlers();
        console.log('Event handlers set up successfully');
      } catch (handlersError) {
        console.error('Error setting up event handlers:', handlersError);
      }
      
      try {
        setupWindowBehavior();
      } catch (windowError) {
        console.error('Error setting up window behavior:', windowError);
      }
      
      try {
        setupModalEventListeners();
      } catch (modalError) {
        console.error('Error setting up modal listeners:', modalError);
      }
      
      try {
        loadQuizFromURL();
      } catch (loadError) {
        console.error('Error loading quiz from URL:', loadError);
        showToast('خطأ في تحميل الاختبار', 'error');
      }
      
      console.log('Quiz view initialized successfully');
    } catch (error) {
      console.error('Critical error in init:', error);
      showToast('خطأ في تهيئة التطبيق', 'error');
    }
  }

  // ===== Close Final Results =====
  function closeFinalResults() {
    try {
      // Clear any keep-visible interval to avoid leaks
      if (window.modalKeepVisibleInterval) {
        clearInterval(window.modalKeepVisibleInterval);
        window.modalKeepVisibleInterval = null;
      }

      if (finalResultsModal) {
        finalResultsModal.style.opacity = '0';
        finalResultsModal.classList.remove('show');
        setTimeout(() => {
          finalResultsModal.style.display = 'none';
        }, 300);
      }
      
      // Close the page/window instead of redirecting to home
      setTimeout(() => {
        try {
          if (typeof isStandaloneWindow === 'function' && isStandaloneWindow()) {
            // If opened as a popup/child window, close it completely
            window.close();
          } else {
            // If in the same tab, reload the current page to reset state
            window.location.reload();
          }
        } catch (_) {
          // As a last resort, reload
          window.location.reload();
        }
      }, 300);
      
    } catch (error) {
      console.error('Error closing final results:', error);
      // Fallback: attempt to close or reload without redirecting to home
      try { window.close(); } catch (_) {}
      window.location.reload();
    }
  }

  // ===== Restart Quiz =====
  function restartQuiz() {
    try {
      // Reset state
      state.currentIndex = -1; // force change detection on first show
      state.answers = {};
      state.wrongAttempts = {}; // Reset wrong attempts
      state.startTime = null;
      state.endTime = null;
      state.isStarted = false;
      state.isSubmitted = false;
      state.questionTimeRemaining = state.questionTimeLimit;
      
      // Restore original questions
      if (state.originalQuestions) {
        state.questions = JSON.parse(JSON.stringify(state.originalQuestions)); // Deep copy
      }
      
      // Clear timer
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
      
      // Clear the keep visible interval first
      if (window.modalKeepVisibleInterval) {
        clearInterval(window.modalKeepVisibleInterval);
        window.modalKeepVisibleInterval = null;
        console.log('Cleared modal keep visible interval during restart');
      }
      
      // Hide results modal
      if (finalResultsModal) {
        finalResultsModal.style.opacity = '0';
        finalResultsModal.classList.remove('show');
        
        setTimeout(() => {
          finalResultsModal.style.display = 'none';
        }, 300);
      }
      
      // Clear options container to avoid duplicated options after restart
      if (opts) {
        opts.innerHTML = '';
        delete opts.dataset.currentType;
        delete opts.dataset.currentIndex;
      }
      
      // Initialize answers for all questions
      if (state.questions && Array.isArray(state.questions)) {
        state.questions.forEach((_, index) => {
          state.answers[index] = null;
        });
      }
      
      // Show start overlay
      setTimeout(() => {
        if (startOverlay) {
          startOverlay.style.display = 'flex';
        }
        if (contentBox) {
          contentBox.style.display = 'none';
        }
      }, 350);
      
      // Clear saved state
      localStorage.removeItem(LS_QUIZ_STATE);
      localStorage.removeItem(LS_QUIZ_ANSWERS);
      
      showToast('تم إعادة تعيين الاختبار مع خلط الأسئلة والاختيارات', 'success');
      
    } catch (error) {
      console.error('Error restarting quiz:', error);
      showToast('خطأ في إعادة تعيين الاختبار', 'error');
    }
  }

  // ===== Event Listeners Setup =====
  function setupEventListeners() {
    try {
      // Start button
      const startBtn = document.getElementById('startBtn');
      if (startBtn) {
        startBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Disable button temporarily to prevent multiple clicks
          startBtn.disabled = true;
          const originalText = startBtn.innerHTML;
          startBtn.innerHTML = '⏳ جاري البدء...';
          
          setTimeout(() => {
            try {
              startQuiz();
            } catch (error) {
              console.error('Error in startQuiz:', error);
              showToast('خطأ في بدء الاختبار', 'error');
            } finally {
              // Re-enable button after 2 seconds
              setTimeout(() => {
                startBtn.disabled = false;
                startBtn.innerHTML = originalText;
              }, 2000);
            }
          }, 100);
        });
        console.log('Start button event listener added');
      }

      // Add debounced input listener for time input to prevent lag
      const preStartMinutes = document.getElementById('preStartMinutes');
      if (preStartMinutes) {
        // Prevent excessive re-rendering
        const handleTimeInput = debounce((e) => {
          const value = parseInt(e.target.value, 10);
          if (value < 0) e.target.value = 0;
          if (value > 999) e.target.value = 999;
        }, 300);
        
        preStartMinutes.addEventListener('input', handleTimeInput);
        
        // Immediate validation on blur
        preStartMinutes.addEventListener('blur', (e) => {
          const value = parseInt(e.target.value, 10);
          if (isNaN(value) || value < 0) e.target.value = 1;
          if (value > 999) e.target.value = 999;
        });
      }

      // Navigation buttons
      const prevBtn = document.getElementById('prevBtn');
      const nextBtn = document.getElementById('nextBtn');
      
      if (prevBtn) {
        prevBtn.addEventListener('click', previousQuestion);
      }
      
      if (nextBtn) {
        nextBtn.addEventListener('click', nextQuestion);
      }

      // Submit button
      const submitBtn = document.getElementById('submitBtn');
      if (submitBtn) {
        submitBtn.addEventListener('click', () => submitQuiz(true));
      }

      console.log('Event listeners setup completed');
    } catch (error) {
      console.error('Error setting up event listeners:', error);
    }
  }

  // ===== Load Quiz Data =====
  async function loadQuizData() {
    try {
      // Try to get quiz data from URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const quizId = urlParams.get('id');
      
      console.log('URL search params:', window.location.search);
      console.log('Quiz ID from URL:', quizId);
      
      if (quizId) {
        console.log('Loading quiz with ID:', quizId);
        
        // Try API first
        if (hasAPI && window.api.loadQuizzes) {
          try {
            const allQuizzes = await window.api.loadQuizzes();
            if (Array.isArray(allQuizzes)) {
              const quiz = allQuizzes.find(q => q.id === quizId);
              if (quiz) {
                state.quiz = quiz;
                console.log('Quiz loaded from API:', quiz);
                return true;
              }
            }
          } catch (apiError) {
            console.warn('API load failed, trying localStorage:', apiError);
          }
        }
        
        // Fallback to localStorage
        try {
          const savedQuizzes = JSON.parse(localStorage.getItem('cm_quizzes_v1') || '[]');
          console.log('All saved quizzes:', savedQuizzes);
          console.log('Looking for quiz ID:', quizId);
          
          const quiz = savedQuizzes.find(q => q.id === quizId);
          if (quiz) {
            state.quiz = quiz;
            console.log('Quiz loaded from localStorage:', quiz);
            return true;
          } else {
            console.warn('Quiz not found in localStorage');
          }
        } catch (storageError) {
          console.warn('localStorage load failed:', storageError);
        }
      }
      
      // Try to get quiz data from global variable (if passed from parent page)
      if (window.quizData) {
        state.quiz = window.quizData;
        console.log('Quiz loaded from global variable:', window.quizData);
        return true;
      }
      
      console.error('No quiz data found');
      showToast('لم يتم العثور على بيانات الاختبار', 'error');
      return false;
      
    } catch (error) {
      console.error('Error loading quiz data:', error);
      showToast('خطأ في تحميل بيانات الاختبار', 'error');
      return false;
    }
  }

  // ===== Initialization =====
  async function init() {
    try {
      console.log('Initializing quiz view...');
      
      // Load quiz data first
      const quizLoaded = await loadQuizData();
      if (!quizLoaded) {
        return; // Stop initialization if quiz data couldn't be loaded
      }
      
      // Initialize quiz data
      await initializeQuiz();
      
      // Setup event listeners
      setupEventListeners();
      // Also bind modal action buttons and ESC/backdrop handlers (CSP-safe)
      if (typeof setupModalEventListeners === 'function') {
        setupModalEventListeners();
      }
      
      console.log('Quiz view initialized successfully');
    } catch (error) {
      console.error('Error initializing quiz view:', error);
      showToast('خطأ في تهيئة الاختبار', 'error');
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Fallback: expose functions globally to ensure buttons work even if inline handlers used
  window.startQuiz = startQuiz;
  window.restartQuiz = restartQuiz;
  window.closeFinalResults = closeFinalResults;
  window.showCorrectAnswers = showCorrectAnswers;
  
  // Additional fallback for start button
  document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('startBtn');
    if (startButton && !startButton.onclick) {
      startButton.onclick = startQuiz;
      console.log('Fallback start button handler set');
    }
  });

  // Cleanup on page unload
  window.addEventListener('unload', () => {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
    }
  });

})();