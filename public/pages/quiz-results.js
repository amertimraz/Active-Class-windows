'use strict';

// صفحة نتائج الاختبارات
(function(){
  // ===== Environment =====
  const hasAPI = typeof window !== 'undefined' && !!window.api;

  // ===== State =====
  let currentQuiz = null;
  let submissions = [];
  let students = [];
  let filteredSubmissions = [];

  // ===== DOM refs =====
  const loadingOverlay = document.getElementById('loadingOverlay');
  const quizTitle = document.getElementById('quizTitle');
  const totalSubmissions = document.getElementById('totalSubmissions');
  const averageScore = document.getElementById('averageScore');
  const highestScore = document.getElementById('highestScore');
  const lowestScore = document.getElementById('lowestScore');
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearch');
  const scoreFilter = document.getElementById('scoreFilter');
  const sortBy = document.getElementById('sortBy');
  const sortOrder = document.getElementById('sortOrder');
  const resultsCount = document.getElementById('resultsCount');
  const resultsTableBody = document.getElementById('resultsTableBody');
  const emptyState = document.getElementById('emptyState');
  const toggleAnalysisBtn = document.getElementById('toggleAnalysis');
  const toggleAnalysisText = document.getElementById('toggleAnalysisText');
  const questionAnalysis = document.getElementById('questionAnalysis');
  const exportResultsBtn = document.getElementById('exportResults');
  const printResultsBtn = document.getElementById('printResults');
  const backToQuizzesBtn = document.getElementById('backToQuizzes');

  // Modal elements
  const studentModal = document.getElementById('studentModal');
  const studentModalClose = document.getElementById('studentModalClose');
  const studentModalTitle = document.getElementById('studentModalTitle');
  const studentScore = document.getElementById('studentScore');
  const studentPoints = document.getElementById('studentPoints');
  const studentTotalPoints = document.getElementById('studentTotalPoints');
  const studentGrade = document.getElementById('studentGrade');
  const studentCorrect = document.getElementById('studentCorrect');
  const studentIncorrect = document.getElementById('studentIncorrect');
  const studentSkipped = document.getElementById('studentSkipped');
  const studentDuration = document.getElementById('studentDuration');
  const studentAnswers = document.getElementById('studentAnswers');
  const printStudentResultBtn = document.getElementById('printStudentResult');
  const closeStudentModalBtn = document.getElementById('closeStudentModal');

  // ===== LocalStorage Fallback =====
  const LS_QUIZZES = 'cm_quizzes_v1';
  const LS_SUBMISSIONS = 'cm_quiz_submissions_v1';
  const LS_STUDENTS = 'cm_students_v1';
  function loadLocal(key){ try { const raw = localStorage.getItem(key); return raw? JSON.parse(raw): []; } catch { return []; } }

  // ===== Utils =====
  const normalize = (s) => (s || '').toString().trim().toLowerCase();
  const debounce = (fn, d=150)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), d); }; };
  function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
  function formatDate(ts){ try { return new Date(ts).toLocaleDateString('ar-EG'); } catch { return ''; } }
  function formatTime(ts){ try { return new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
  function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}س ${minutes}د`;
    }
    return `${minutes}د ${secs}ث`;
  }

  // ===== Toast =====
  function showToast(message, type='info'){
    const exist = document.querySelector('.toast'); if (exist) exist.remove();
    const el = document.createElement('div');
    el.className = `toast ${type}`; el.textContent = message;
    Object.assign(el.style, { position:'fixed', top:'20px', right:'20px', padding:'14px 16px', borderRadius:'12px', color:'#fff', font:'14px Cairo, sans-serif', zIndex:'999999', transform:'translateX(120%)', transition:'all .3s ease', boxShadow:'0 20px 40px rgba(0,0,0,.25)', cursor:'pointer' });
    const colors = { success:'#16a34a', error:'#dc2626', warning:'#d97706', info:'#0ea5e9' }; el.style.background = colors[type] || colors.info;
    document.body.appendChild(el); requestAnimationFrame(()=>{ el.style.transform='translateX(0)'; });
    const close=()=>{ el.style.transform='translateX(120%)'; el.style.opacity='0'; setTimeout(()=>el.remove(), 240); };
    setTimeout(close, 3500); el.addEventListener('click', close);
  }

  // ===== Loading =====
  const showLoading = ()=>{ if (loadingOverlay) loadingOverlay.style.display='flex'; };
  const hideLoading = ()=>{ if (loadingOverlay) loadingOverlay.style.display='none'; };

  // ===== Modal Functions =====
  function openModal(modal) {
    if (modal) {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }

  function closeModal(modal) {
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  // ===== Data Loading =====
  async function loadData() {
    const urlParams = new URLSearchParams(window.location.search);
    const quizId = urlParams.get('id');
    
    if (!quizId) {
      showToast('معرف الاختبار غير موجود', 'error');
      setTimeout(() => window.location.href = '/#/quizzes', 2000);
      return;
    }

    showLoading();
    try {
      // Load full quiz (with questions) via IPC
      if (hasAPI && window.api.loadQuiz) {
        currentQuiz = await window.api.loadQuiz(quizId);
      }
      if (!currentQuiz) {
        // fallback: find in list
        const list = hasAPI && window.api.loadQuizzes ? await window.api.loadQuizzes() || [] : loadLocal(LS_QUIZZES);
        currentQuiz = list.find(q => q.id === quizId);
      }
      if (!currentQuiz) {
        showToast('الاختبار غير موجود', 'error');
        setTimeout(() => window.location.href = '/#/quizzes', 2000);
        return;
      }

      // Load submissions filtered by quizId
      if (hasAPI && window.api.loadQuizSubmissions) {
        submissions = await window.api.loadQuizSubmissions(quizId) || [];
      } else {
        submissions = loadLocal(LS_SUBMISSIONS).filter(s => s.quizId === quizId || s.testId === quizId);
      }

      // Load students for name lookup
      if (hasAPI && window.api.loadStudents) {
        students = await window.api.loadStudents() || [];
      } else {
        students = loadLocal(LS_STUDENTS);
      }

      // Process submissions: attach student info and compute results
      submissions = submissions.map(submission => {
        const student = students.find(s => s.id === submission.studentId);
        return {
          ...submission,
          studentName: submission.studentName || (student ? student.name : 'طالب غير معروف'),
          studentCode: student ? student.code : '',
          results: calculateSubmissionResults(submission)
        };
      });

      // Initialize page
      initializePage();
      updateStatistics();
      render();
      renderQuestionAnalysis();

    } catch (error) {
      console.error('Error loading data:', error);
      showToast('حدث خطأ في تحميل البيانات', 'error');
    } finally {
      hideLoading();
    }
  }

  function calculateSubmissionResults(submission) {
    // Use server-computed score if available (most reliable)
    if (submission.score && typeof submission.score.correct === 'number') {
      const correct = submission.score.correct;
      const total = submission.score.total || (currentQuiz.questions ? currentQuiz.questions.length : 0);
      const incorrect = total - correct;
      const percentage = submission.score.percent ?? (total > 0 ? Math.round((correct / total) * 100) : 0);
      return {
        correctCount: correct,
        incorrectCount: incorrect,
        skippedCount: 0,
        totalQuestions: total,
        earnedPoints: correct,
        totalPoints: total,
        percentage
      };
    }

    // Fallback: recalculate from answers array if quiz questions are available
    if (!currentQuiz || !Array.isArray(currentQuiz.questions)) return null;

    // Server stores answers as [{questionId, answerIndex}] — build a lookup map
    const answerMap = new Map();
    if (Array.isArray(submission.answers)) {
      submission.answers.forEach(a => {
        if (a && a.questionId != null) answerMap.set(a.questionId, a.answerIndex);
        else if (typeof a === 'number') answerMap.set(null, a); // old numeric format
      });
    }

    let correctCount = 0, incorrectCount = 0, skippedCount = 0, totalPoints = 0, earnedPoints = 0;
    currentQuiz.questions.forEach(question => {
      const points = question.points || 1;
      totalPoints += points;
      const userAnswer = answerMap.get(question.id);
      if (userAnswer == null || userAnswer < 0) {
        skippedCount++;
      } else {
        const isCorrect = checkAnswer(question, userAnswer);
        if (isCorrect) { correctCount++; earnedPoints += points; }
        else incorrectCount++;
      }
    });

    const percentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    return { correctCount, incorrectCount, skippedCount, totalQuestions: currentQuiz.questions.length, earnedPoints, totalPoints, percentage };
  }

  function checkAnswer(question, userAnswer) {
    const correctAnswer = question.correctAnswer;

    switch (question.type) {
      case 'mcq':
      case 'multiple-choice':
        if (question.allowMultiple) {
          if (!Array.isArray(userAnswer) || !Array.isArray(correctAnswer)) return false;
          return userAnswer.length === correctAnswer.length &&
                 userAnswer.every(ans => correctAnswer.includes(ans));
        }
        // numeric comparison (both may come as number or string from different paths)
        return Number(userAnswer) === Number(correctAnswer);

      case 'true-false':
        return Number(userAnswer) === Number(correctAnswer);

      case 'fill-blanks':
        if (!Array.isArray(userAnswer) || !Array.isArray(correctAnswer)) return false;
        return userAnswer.every((ans, i) => {
          const correct = correctAnswer[i];
          if (typeof correct === 'string') return String(ans).toLowerCase().trim() === correct.toLowerCase().trim();
          return ans === correct;
        });

      case 'matching': {
        if (typeof userAnswer !== 'object' || typeof correctAnswer !== 'object') return false;
        const uKeys = Object.keys(userAnswer);
        const cKeys = Object.keys(correctAnswer);
        return uKeys.length === cKeys.length && uKeys.every(k => userAnswer[k] === correctAnswer[k]);
      }

      default:
        return false;
    }
  }

  function initializePage() {
    if (quizTitle) quizTitle.textContent = `نتائج: ${currentQuiz.name}`;
  }

  function updateStatistics() {
    const total = submissions.length;
    if (totalSubmissions) totalSubmissions.textContent = total;

    if (total === 0) {
      if (averageScore) averageScore.textContent = '0%';
      if (highestScore) highestScore.textContent = '0%';
      if (lowestScore) lowestScore.textContent = '0%';
      return;
    }

    const percentages = submissions.map(s => s.results?.percentage || 0);
    const average = Math.round(percentages.reduce((sum, p) => sum + p, 0) / total);
    const highest = Math.max(...percentages);
    const lowest = Math.min(...percentages);

    if (averageScore) averageScore.textContent = `${average}%`;
    if (highestScore) highestScore.textContent = `${highest}%`;
    if (lowestScore) lowestScore.textContent = `${lowest}%`;
  }

  // ===== Filtering and Sorting =====
  function applyFilters() {
    const query = normalize(searchInput ? searchInput.value : '');
    const scoreFilterValue = scoreFilter ? scoreFilter.value : '';
    
    filteredSubmissions = submissions.filter(submission => {
      // Text search
      if (query) {
        const searchText = `${normalize(submission.studentName)} ${normalize(submission.studentCode)}`;
        if (!searchText.includes(query)) return false;
      }

      // Score filter
      if (scoreFilterValue) {
        const percentage = submission.results?.percentage || 0;
        switch (scoreFilterValue) {
          case 'excellent':
            if (percentage < 90) return false;
            break;
          case 'very-good':
            if (percentage < 80 || percentage >= 90) return false;
            break;
          case 'good':
            if (percentage < 70 || percentage >= 80) return false;
            break;
          case 'acceptable':
            if (percentage < 60 || percentage >= 70) return false;
            break;
          case 'weak':
            if (percentage >= 60) return false;
            break;
        }
      }

      return true;
    });

    // Sort results
    const sortByValue = sortBy ? sortBy.value : 'score';
    const sortOrderValue = sortOrder ? sortOrder.value : 'desc';
    const direction = sortOrderValue === 'desc' ? -1 : 1;

    filteredSubmissions.sort((a, b) => {
      switch (sortByValue) {
        case 'score':
          return ((a.results?.percentage || 0) - (b.results?.percentage || 0)) * direction;
        case 'name':
          return a.studentName.localeCompare(b.studentName, 'ar') * direction;
        case 'time':
          return (new Date(a.ts) - new Date(b.ts)) * direction;
        case 'duration':
          return ((a.duration || 0) - (b.duration || 0)) * direction;
        default:
          return 0;
      }
    });
  }

  function render() {
    applyFilters();

    if (resultsCount) resultsCount.textContent = filteredSubmissions.length;

    if (filteredSubmissions.length === 0) {
      if (resultsTableBody) resultsTableBody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    if (resultsTableBody) {
      // Calculate average for below-average coloring
      const avg = filteredSubmissions.length
        ? filteredSubmissions.reduce((s, sub) => s + (sub.results?.percentage || 0), 0) / filteredSubmissions.length
        : 0;

      // Sort by percentage desc to assign ranks (we sort a copy, not the display order)
      const rankMap = new Map();
      [...filteredSubmissions]
        .sort((a, b) => (b.results?.percentage || 0) - (a.results?.percentage || 0))
        .forEach((sub, i) => rankMap.set(sub.id, i + 1));

      const medals = ['🥇', '🥈', '🥉'];

      resultsTableBody.innerHTML = filteredSubmissions.map(submission => {
        const results = submission.results;
        const percentage = results?.percentage || 0;
        const percentageClass = getPercentageClass(percentage);
        const grade = getGrade(percentage);
        const rank = rankMap.get(submission.id);
        const belowAvg = avg > 0 && percentage < avg;

        const rankDisplay = rank <= 3
          ? `<span class="rank-medal">${medals[rank - 1]}</span>`
          : `<span class="rank-num">${rank}</span>`;

        return `
          <tr data-submission-id="${submission.id}" class="${belowAvg ? 'row-below-avg' : ''}">
            <td class="rank-col">${rankDisplay}</td>
            <td>
              <div class="student-name">${escapeHTML(submission.studentName)}</div>
              <div class="student-code">${escapeHTML(submission.studentCode)}</div>
            </td>
            <td class="score-cell">
              <div class="score-value">${results?.earnedPoints || 0}/${results?.totalPoints || 0}</div>
              <div class="score-points">${grade}</div>
            </td>
            <td class="percentage-cell">
              <span class="percentage-badge ${percentageClass}">${percentage}%</span>
            </td>
            <td class="correct-answers">${results?.correctCount || 0}/${results?.totalQuestions || 0}</td>
            <td class="duration-cell">${formatDuration(submission.duration || 0)}</td>
            <td class="date-cell">
              <div>${formatDate(submission.ts)}</div>
              <div>${formatTime(submission.ts)}</div>
            </td>
            <td class="actions-cell">
              <button class="action-btn primary" onclick="viewStudentDetails('${submission.id}')">
                عرض التفاصيل
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  function getPercentageClass(percentage) {
    if (percentage >= 90) return 'excellent';
    if (percentage >= 80) return 'very-good';
    if (percentage >= 70) return 'good';
    if (percentage >= 60) return 'acceptable';
    return 'weak';
  }

  function getGrade(percentage) {
    if (percentage >= 90) return 'ممتاز';
    if (percentage >= 80) return 'جيد جداً';
    if (percentage >= 70) return 'جيد';
    if (percentage >= 60) return 'مقبول';
    return 'ضعيف';
  }

  // ===== Question Analysis =====
  function renderQuestionAnalysis() {
    if (!questionAnalysis || !currentQuiz.questions) return;

    const analysisData = currentQuiz.questions.map((question, index) => {
      const answers = submissions.map(s => s.answers[index]).filter(a => a !== null && a !== undefined);
      const correctAnswers = answers.filter(answer => checkAnswer(question, answer));
      
      const totalAnswered = answers.length;
      const correctCount = correctAnswers.length;
      const incorrectCount = totalAnswered - correctCount;
      const skippedCount = submissions.length - totalAnswered;
      const correctPercentage = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

      return {
        question,
        index,
        totalAnswered,
        correctCount,
        incorrectCount,
        skippedCount,
        correctPercentage
      };
    });

    questionAnalysis.innerHTML = analysisData.map(data => {
      const difficultyClass = getDifficultyClass(data.correctPercentage);
      const difficultyText = getDifficultyText(data.correctPercentage);

      return `
        <div class="question-analysis-card">
          <div class="question-header">
            <div class="question-title">
              السؤال ${data.index + 1}: ${escapeHTML(data.question.text.substring(0, 100))}...
            </div>
            <div class="question-stats">
              <div class="question-stat">
                <div class="question-stat-value">${data.correctPercentage}%</div>
                <div class="question-stat-label">صحيح</div>
              </div>
              <div class="question-stat">
                <div class="question-stat-value">${data.totalAnswered}</div>
                <div class="question-stat-label">مُجاب</div>
              </div>
              <div class="question-stat">
                <div class="question-stat-value">${data.skippedCount}</div>
                <div class="question-stat-label">مُتجاهل</div>
              </div>
            </div>
          </div>
          
          <div class="question-difficulty">
            <div class="difficulty-bar">
              <div class="difficulty-fill ${difficultyClass}" style="width: ${100 - data.correctPercentage}%"></div>
            </div>
            <div class="difficulty-text">${difficultyText}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function getDifficultyClass(correctPercentage) {
    if (correctPercentage >= 80) return 'easy';
    if (correctPercentage >= 60) return 'medium';
    return 'hard';
  }

  function getDifficultyText(correctPercentage) {
    if (correctPercentage >= 80) return 'سؤال سهل';
    if (correctPercentage >= 60) return 'سؤال متوسط';
    return 'سؤال صعب';
  }

  // ===== Student Details Modal =====
  window.viewStudentDetails = function(submissionId) {
    const submission = submissions.find(s => s.id === submissionId);
    if (!submission) return;

    const results = submission.results;
    const percentage = results?.percentage || 0;
    const grade = getGrade(percentage);

    // Update modal header
    if (studentModalTitle) studentModalTitle.textContent = `تفاصيل إجابات: ${submission.studentName}`;

    // Update summary
    if (studentScore) studentScore.textContent = `${percentage}%`;
    if (studentPoints) studentPoints.textContent = results?.earnedPoints || 0;
    if (studentTotalPoints) studentTotalPoints.textContent = results?.totalPoints || 0;
    if (studentGrade) studentGrade.textContent = grade;
    if (studentCorrect) studentCorrect.textContent = results?.correctCount || 0;
    if (studentIncorrect) studentIncorrect.textContent = results?.incorrectCount || 0;
    if (studentSkipped) studentSkipped.textContent = results?.skippedCount || 0;
    if (studentDuration) studentDuration.textContent = formatDuration(submission.duration || 0);

    // Render answers
    if (studentAnswers && currentQuiz.questions) {
      // Build questionId → answerIndex map (server format: [{questionId, answerIndex}])
      const answerMap = new Map();
      if (Array.isArray(submission.answers)) {
        submission.answers.forEach((a, i) => {
          if (a && a.questionId != null) answerMap.set(a.questionId, a.answerIndex);
          else if (typeof a === 'number' || typeof a === 'boolean') answerMap.set(i, a);
        });
      }

      studentAnswers.innerHTML = currentQuiz.questions.map((question, index) => {
        const userAnswer = answerMap.has(question.id) ? answerMap.get(question.id) : answerMap.get(index);
        const isSkipped = userAnswer === null || userAnswer === undefined || userAnswer < 0;
        const isCorrect = !isSkipped && checkAnswer(question, userAnswer);
        
        let statusClass = 'skipped';
        let statusText = 'مُتجاهل';
        
        if (!isSkipped) {
          statusClass = isCorrect ? 'correct' : 'incorrect';
          statusText = isCorrect ? 'صحيح' : 'خطأ';
        }

        return `
          <div class="answer-card ${statusClass}">
            <div class="answer-header">
              <div class="answer-question">السؤال ${index + 1}</div>
              <span class="answer-status ${statusClass}">${statusText}</span>
            </div>
            <div class="answer-content">
              <p><strong>السؤال:</strong> ${escapeHTML(question.text)}</p>
              ${userAnswer !== null && userAnswer !== undefined ? 
                `<p><strong>إجابة الطالب:</strong> ${formatAnswer(question, userAnswer)}</p>` : 
                '<p><strong>إجابة الطالب:</strong> لم يجب</p>'
              }
              <p><strong>الإجابة الصحيحة:</strong> ${formatAnswer(question, question.correctAnswer)}</p>
              ${question.explanation ? `<p><strong>التفسير:</strong> ${escapeHTML(question.explanation)}</p>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    openModal(studentModal);
  };

  function formatAnswer(question, answer) {
    if (answer === null || answer === undefined) return '';
    switch (question.type) {
      case 'mcq':
      case 'multiple-choice': {
        const optText = (i) => {
          const opt = question.options?.[Number(i)];
          return (opt && typeof opt === 'object' ? opt.text : opt) || `خيار ${Number(i) + 1}`;
        };
        if (question.allowMultiple && Array.isArray(answer)) return answer.map(optText).join('، ');
        return optText(answer);
      }

      case 'true-false':
        return Number(answer) === 1 ? 'صحيح' : 'خطأ';

      case 'fill-blanks':
        return Array.isArray(answer) ? answer.join('، ') : String(answer);

      case 'matching':
        if (typeof answer === 'object' && !Array.isArray(answer)) {
          return Object.entries(answer)
            .map(([l, r]) => `${question.leftItems?.[l] || l} ← ${question.rightItems?.[r] || r}`)
            .join('، ');
        }
        return String(answer);

      default:
        return String(answer ?? '');
    }
  }

  // ===== Share Results =====
  function shareResults() {
    if (submissions.length === 0) {
      showToast('لا توجد نتائج للمشاركة', 'warning');
      return;
    }

    const quizTitle = document.getElementById('quizTitle')?.textContent?.trim() || 'الاختبار';
    const total = submissions.length;
    const avg = Math.round(
      submissions.reduce((s, sub) => s + (sub.results?.percentage || 0), 0) / total
    );
    const top = Math.max(...submissions.map(s => s.results?.percentage || 0));
    const passed = submissions.filter(s => (s.results?.percentage || 0) >= 60).length;

    // Sort by percentage desc for ranking
    const ranked = [...submissions]
      .sort((a, b) => (b.results?.percentage || 0) - (a.results?.percentage || 0));

    const medals = ['🥇', '🥈', '🥉'];
    const topThree = ranked.slice(0, 3)
      .map((s, i) => `${medals[i]} ${s.studentName} — ${s.results?.percentage || 0}%`)
      .join('\n');

    const text =
`📊 *نتائج ${quizTitle}*

👥 عدد المشاركين: ${total}
✅ الناجحون: ${passed} من ${total}
📈 متوسط الدرجات: ${avg}%
🏆 أعلى درجة: ${top}%

*أعلى الطلاب:*
${topThree}

#ActiveClass`;

    navigator.clipboard.writeText(text)
      .then(() => showToast('✅ تم نسخ النتائج — جاهزة للمشاركة على واتساب', 'success'))
      .catch(() => showToast('تعذّر النسخ', 'error'));
  }

  // ===== Export Functions =====
  function exportResults() {
    if (submissions.length === 0) {
      showToast('لا توجد نتائج للتصدير', 'warning');
      return;
    }

    const csvContent = generateCSV();
    downloadCSV(csvContent, `نتائج_${currentQuiz.name}_${new Date().toISOString().slice(0,10)}.csv`);
    showToast('تم تصدير النتائج بنجاح', 'success');
  }

  function generateCSV() {
    const headers = ['اسم الطالب', 'كود الطالب', 'الدرجة', 'النسبة المئوية', 'الإجابات الصحيحة', 'الإجابات الخاطئة', 'الأسئلة المتجاهلة', 'الوقت المستغرق', 'تاريخ التسليم'];
    
    const rows = submissions.map(submission => {
      const results = submission.results;
      return [
        submission.studentName,
        submission.studentCode,
        `${results?.earnedPoints || 0}/${results?.totalPoints || 0}`,
        `${results?.percentage || 0}%`,
        results?.correctCount || 0,
        results?.incorrectCount || 0,
        results?.skippedCount || 0,
        formatDuration(submission.duration || 0),
        formatDate(submission.ts)
      ];
    });

    return [headers, ...rows].map(row => 
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
  }

  function downloadCSV(content, filename) {
    const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ===== Event Listeners =====
  document.addEventListener('DOMContentLoaded', () => {
    // Search and filters
    if (searchInput) {
      searchInput.addEventListener('input', debounce(render, 150));
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          render();
          searchInput.focus();
        }
      });
    }

    if (scoreFilter) {
      scoreFilter.addEventListener('change', render);
    }

    if (sortBy) {
      sortBy.addEventListener('change', render);
    }

    if (sortOrder) {
      sortOrder.addEventListener('change', render);
    }

    // Analysis toggle
    if (toggleAnalysisBtn) {
      toggleAnalysisBtn.addEventListener('click', () => {
        if (questionAnalysis) {
          const isVisible = questionAnalysis.style.display !== 'none';
          questionAnalysis.style.display = isVisible ? 'none' : 'block';
          if (toggleAnalysisText) {
            toggleAnalysisText.textContent = isVisible ? 'إظهار التحليل' : 'إخفاء التحليل';
          }
        }
      });
    }

    // Share results button
    const shareResultsBtn = document.getElementById('shareResults');
    if (shareResultsBtn) {
      shareResultsBtn.addEventListener('click', shareResults);
    }

    // Action buttons
    if (exportResultsBtn) {
      exportResultsBtn.addEventListener('click', exportResults);
    }

    if (printResultsBtn) {
      printResultsBtn.addEventListener('click', () => window.print());
    }

    if (backToQuizzesBtn) {
      backToQuizzesBtn.addEventListener('click', () => {
        if (pollTimer) clearInterval(pollTimer);
        window.location.href = '/#/quizzes';
      });
    }

    // Clear results button — custom confirm modal
    const clearResultsBtn  = document.getElementById('clearResults');
    const confirmClearModal = document.getElementById('confirmClearModal');
    const confirmClearOk   = document.getElementById('confirmClearOk');
    const confirmClearCancel = document.getElementById('confirmClearCancel');

    if (clearResultsBtn && confirmClearModal) {
      clearResultsBtn.addEventListener('click', () => openModal(confirmClearModal));
      confirmClearCancel.addEventListener('click', () => closeModal(confirmClearModal));

      confirmClearOk.addEventListener('click', async () => {
        closeModal(confirmClearModal);
        const urlParams = new URLSearchParams(window.location.search);
        const quizId = urlParams.get('id');
        try {
          if (hasAPI && window.api.clearQuizResults) {
            await window.api.clearQuizResults(quizId);
          } else {
            await fetch(`/api/quizzes/${quizId}/results`, { method: 'DELETE' });
          }
          submissions = [];
          updateStatistics();
          render();
          renderQuestionAnalysis();
          showToast('تم حذف جميع النتائج', 'success');
        } catch (e) {
          showToast('حدث خطأ أثناء الحذف', 'error');
        }
      });
    }

    // Modal events
    if (studentModalClose) {
      studentModalClose.addEventListener('click', () => closeModal(studentModal));
    }

    if (closeStudentModalBtn) {
      closeStudentModalBtn.addEventListener('click', () => closeModal(studentModal));
    }

    if (printStudentResultBtn) {
      printStudentResultBtn.addEventListener('click', () => window.print());
    }

    // Load data then start live stream
    loadData().then(() => startLiveStream());
  });

  // ===== Live Results (polling) =====
  let pollTimer = null;
  let lastCount = 0;

  function startLiveStream() {
    const urlParams = new URLSearchParams(window.location.search);
    const quizId = urlParams.get('id');
    if (!quizId) return;

    const liveBadge = document.getElementById('liveBadge');
    if (liveBadge) liveBadge.style.display = 'inline-flex';

    async function poll() {
      try {
        let fresh = null;
        if (hasAPI && window.api.loadQuizSubmissions) {
          fresh = await window.api.loadQuizSubmissions(quizId);
        }
        if (!Array.isArray(fresh)) return;

        // only re-render if count changed
        if (fresh.length !== lastCount) {
          lastCount = fresh.length;
          submissions = fresh.map(sub => {
            const student = students.find(s => s.id === sub.studentId);
            return {
              ...sub,
              studentName: sub.studentName || (student ? student.name : 'طالب غير معروف'),
              studentCode: student ? student.code : '',
              results: calculateSubmissionResults(sub)
            };
          });
          updateStatistics();
          render();
          renderQuestionAnalysis();
        }
      } catch {}
    }

    pollTimer = setInterval(poll, 5000);
    window.addEventListener('beforeunload', () => clearInterval(pollTimer));
  }

})();