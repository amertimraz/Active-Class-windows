(function () {
  'use strict';
  if (window.GE_UISystem) return;

  class UISystem {
    constructor() {
      this._elements = new Map();
      this._feedbackTimeout = null;
    }

    createHUD(config = {}) {
      const hud = document.createElement('div');
      hud.className = 'ge-hud';
      hud.style.cssText = `
        position: absolute; top: 0; left: 0; right: 0;
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 20px; z-index: 100;
        background: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%);
        pointer-events: none; user-select: none;
        font-family: 'Cairo', sans-serif;
      `;

      if (config.score !== false) {
        const scoreEl = document.createElement('div');
        scoreEl.className = 'ge-hud-score';
        scoreEl.innerHTML = `<span class="ge-hud-label">النقاط</span><span class="ge-hud-value" id="ge-score-val">0</span>`;
        scoreEl.style.cssText = 'color: #fff; text-align: center;';
        hud.appendChild(scoreEl);
        this._elements.set('score-display', scoreEl);
      }

      if (config.timer !== false) {
        const timerEl = document.createElement('div');
        timerEl.className = 'ge-hud-timer';
        timerEl.innerHTML = `<span class="ge-hud-label">الوقت</span><span class="ge-hud-value" id="ge-timer-val">00:00</span>`;
        timerEl.style.cssText = 'color: #fff; text-align: center;';
        hud.appendChild(timerEl);
        this._elements.set('timer-display', timerEl);
      }

      if (config.lives !== false && config.lives !== undefined) {
        const livesEl = document.createElement('div');
        livesEl.className = 'ge-hud-lives';
        livesEl.id = 'ge-lives-val';
        livesEl.style.cssText = 'color: #fff; font-size: 1.2rem; text-align: center;';
        this.setLives(livesEl, config.lives);
        hud.appendChild(livesEl);
        this._elements.set('lives-display', livesEl);
      }

      if (config.level !== false && config.level !== undefined) {
        const levelEl = document.createElement('div');
        levelEl.className = 'ge-hud-level';
        levelEl.innerHTML = `<span class="ge-hud-label">المستوى</span><span class="ge-hud-value" id="ge-level-val">${config.level || 1}</span>`;
        levelEl.style.cssText = 'color: #fff; text-align: center;';
        hud.appendChild(levelEl);
        this._elements.set('level-display', levelEl);
      }

      return hud;
    }

    updateScore(score) {
      const el = document.getElementById('ge-score-val');
      if (el) el.textContent = Math.floor(score).toLocaleString('ar-EG');
    }

    updateTimer(seconds) {
      const el = document.getElementById('ge-timer-val');
      if (!el) return;
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      if (seconds <= 10) {
        el.style.color = '#ff4d4d';
        el.style.animation = 'ge-pulse 0.5s infinite';
      } else {
        el.style.color = '#fff';
        el.style.animation = '';
      }
    }

    updateLevel(level) {
      const el = document.getElementById('ge-level-val');
      if (el) el.textContent = level;
    }

    setLives(container, count) {
      const el = container || document.getElementById('ge-lives-val');
      if (!el) return;
      el.innerHTML = Array(count).fill('❤️').join('') || '💀';
    }

    showFeedback(message, type = 'correct', duration = 1200) {
      if (this._feedbackTimeout) clearTimeout(this._feedbackTimeout);

      let fb = document.getElementById('ge-feedback');
      if (!fb) {
        fb = document.createElement('div');
        fb.id = 'ge-feedback';
        fb.style.cssText = `
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0);
          font-family: 'Cairo', sans-serif; font-size: 2rem; font-weight: 900;
          padding: 16px 32px; border-radius: 20px; z-index: 9999;
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s;
          pointer-events: none; text-align: center; white-space: nowrap;
        `;
        document.body.appendChild(fb);
      }

      const styles = {
        correct: { bg: 'linear-gradient(135deg, #00c853, #00e676)', color: '#fff', shadow: '0 8px 32px rgba(0,200,83,0.5)' },
        wrong: { bg: 'linear-gradient(135deg, #d50000, #ff1744)', color: '#fff', shadow: '0 8px 32px rgba(213,0,0,0.5)' },
        info: { bg: 'linear-gradient(135deg, #1565c0, #1e88e5)', color: '#fff', shadow: '0 8px 32px rgba(21,101,192,0.5)' },
        bonus: { bg: 'linear-gradient(135deg, #ff6f00, #ffa000)', color: '#fff', shadow: '0 8px 32px rgba(255,111,0,0.5)' }
      };

      const s = styles[type] || styles.info;
      fb.textContent = message;
      fb.style.background = s.bg;
      fb.style.color = s.color;
      fb.style.boxShadow = s.shadow;
      fb.style.transform = 'translate(-50%, -50%) scale(1)';
      fb.style.opacity = '1';

      this._feedbackTimeout = setTimeout(() => {
        fb.style.transform = 'translate(-50%, -50%) scale(0)';
        fb.style.opacity = '0';
      }, duration);
    }

    createProgressBar(options = {}) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 100%; height: ${options.height || 8}px; background: rgba(255,255,255,0.2);
        border-radius: 4px; overflow: hidden;
      `;
      const fill = document.createElement('div');
      fill.style.cssText = `
        height: 100%; width: 0%; border-radius: 4px;
        background: ${options.color || 'linear-gradient(90deg, #00c853, #00e676)'};
        transition: width 0.3s ease;
      `;
      wrapper.appendChild(fill);
      wrapper._fill = fill;
      wrapper.setProgress = (pct) => { fill.style.width = Math.max(0, Math.min(100, pct)) + '%'; };
      return wrapper;
    }

    destroy() {
      if (this._feedbackTimeout) clearTimeout(this._feedbackTimeout);
      const fb = document.getElementById('ge-feedback');
      if (fb) fb.remove();
      this._elements.clear();
    }
  }

  window.GE_UISystem = UISystem;
})();
