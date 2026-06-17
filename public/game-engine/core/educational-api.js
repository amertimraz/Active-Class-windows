(function () {
  'use strict';
  if (window.GE_EducationalAPI) return;

  class EducationalAPI {
    constructor() {
      this._sessionResults = [];
      this._currentSession = null;
    }

    startSession(config = {}) {
      this._currentSession = {
        id: Date.now(),
        gameId: config.gameId || 'unknown',
        gameName: config.gameName || 'لعبة',
        startTime: Date.now(),
        endTime: null,
        score: 0,
        maxScore: 0,
        correctAnswers: 0,
        totalQuestions: 0,
        accuracy: 0,
        level: config.level || 1,
        metadata: config.metadata || {}
      };
      console.log('[EduAPI] Session started:', this._currentSession.gameName);
      return this._currentSession;
    }

    recordAnswer(isCorrect, points = 0, questionData = {}) {
      if (!this._currentSession) return;
      this._currentSession.totalQuestions++;
      if (isCorrect) {
        this._currentSession.correctAnswers++;
        this._currentSession.score += points;
      }
      this._currentSession.maxScore += points;
    }

    endSession(finalScore) {
      if (!this._currentSession) return null;
      this._currentSession.endTime = Date.now();
      if (typeof finalScore === 'number') this._currentSession.score = finalScore;
      const total = this._currentSession.totalQuestions;
      this._currentSession.accuracy = total > 0
        ? Math.round((this._currentSession.correctAnswers / total) * 100) : 0;

      this._sessionResults.push({ ...this._currentSession });
      this._persistSession(this._currentSession);

      const result = { ...this._currentSession };
      this._currentSession = null;
      console.log('[EduAPI] Session ended. Score:', result.score, 'Accuracy:', result.accuracy + '%');
      return result;
    }

    _persistSession(session) {
      try {
        const key = 'ge_game_results';
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        existing.push(session);
        if (existing.length > 100) existing.splice(0, existing.length - 100);
        localStorage.setItem(key, JSON.stringify(existing));
      } catch (e) {}

      try {
        fetch('/api/game-results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session)
        }).catch(() => {});
      } catch (e) {}
      // Note: /api/game-results endpoint is optional — results are always saved in localStorage
    }

    async loadQuizzes() {
      try {
        const res = await fetch('/api/quizzes');
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.quizzes || []);
        return list.length > 0 ? list : this._getFallbackQuestions();
      } catch (e) {
        console.warn('[EduAPI] Could not load quizzes from API, using fallback');
        return this._getFallbackQuestions();
      }
    }

    async loadQuizById(id) {
      try {
        const res = await fetch(`/api/quizzes/${id}`);
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        if (!Array.isArray(data.questions) || data.questions.length === 0) {
          throw new Error('No questions');
        }
        return {
          id: data.id,
          title: data.name || data.title || 'اختبار',
          questions: data.questions
        };
      } catch (e) {
        console.warn('[EduAPI] Could not load quiz by id, using fallback:', id);
        return this._getFallbackQuestions()[0];
      }
    }

    async loadStudents() {
      try {
        const res = await fetch('/api/students');
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch (e) {
        return [];
      }
    }

    async loadGroups() {
      try {
        const res = await fetch('/api/groups');
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch (e) {
        return [];
      }
    }

    getSessionHistory() {
      try {
        return JSON.parse(localStorage.getItem('ge_game_results') || '[]');
      } catch (e) {
        return [];
      }
    }

    _getFallbackQuestions() {
      return [{
        id: 'fallback-1',
        title: 'أسئلة تعليمية عامة',
        questions: [
          { text: 'كم عدد أيام الأسبوع؟', options: ['5', '6', '7', '8'], correctAnswer: 2 },
          { text: 'ما هي عاصمة المملكة العربية السعودية؟', options: ['جدة', 'مكة', 'الرياض', 'المدينة'], correctAnswer: 2 },
          { text: 'كم يساوي 7 × 8؟', options: ['54', '56', '48', '64'], correctAnswer: 1 },
          { text: 'ما هو أكبر كوكب في المجموعة الشمسية؟', options: ['زحل', 'أورانوس', 'المشتري', 'نبتون'], correctAnswer: 2 },
          { text: 'كم عدد حروف الهجاء العربية؟', options: ['26', '28', '30', '32'], correctAnswer: 1 },
          { text: 'ما هي أطول نهر في العالم؟', options: ['الأمازون', 'النيل', 'المسيسيبي', 'اليانغتسي'], correctAnswer: 1 },
          { text: 'كم تبعد الأرض عن الشمس تقريباً؟', options: ['100 مليون كم', '150 مليون كم', '200 مليون كم', '50 مليون كم'], correctAnswer: 1 },
          { text: 'ما هي أصغر قارة في العالم؟', options: ['أوروبا', 'أستراليا', 'أنتاركتيكا', 'أمريكا الجنوبية'], correctAnswer: 1 },
          { text: 'كم يساوي 15 + 27؟', options: ['40', '41', '42', '43'], correctAnswer: 2 },
          { text: 'ما هو عنصر الماء؟', options: ['H2O', 'CO2', 'O2', 'N2'], correctAnswer: 0 }
        ]
      }];
    }
  }

  window.GE_EducationalAPI = EducationalAPI;
})();
