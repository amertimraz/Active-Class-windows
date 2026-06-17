(function () {
  'use strict';
  if (window.GE_GameLoop) return;

  class GameLoop {
    constructor() {
      this._running = false;
      this._lastTime = 0;
      this._rafId = null;
      this._callbacks = new Set();
      this._fps = 0;
      this._frameCount = 0;
      this._fpsTimer = 0;
      this._tick = this._tick.bind(this);
    }

    add(fn) {
      this._callbacks.add(fn);
      return this;
    }

    remove(fn) {
      this._callbacks.delete(fn);
      return this;
    }

    start() {
      if (this._running) return;
      this._running = true;
      this._lastTime = performance.now();
      this._rafId = requestAnimationFrame(this._tick);
    }

    stop() {
      this._running = false;
      if (this._rafId !== null) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    }

    _tick(now) {
      if (!this._running) return;
      const rawDelta = (now - this._lastTime) / 1000;
      const delta = Math.min(rawDelta, 0.1);
      this._lastTime = now;

      this._frameCount++;
      this._fpsTimer += delta;
      if (this._fpsTimer >= 1) {
        this._fps = this._frameCount;
        this._frameCount = 0;
        this._fpsTimer -= 1;
      }

      for (const fn of this._callbacks) {
        try { fn(delta, now); } catch (e) { console.error('[GameLoop] callback error:', e); }
      }

      this._rafId = requestAnimationFrame(this._tick);
    }

    get fps() { return this._fps; }
    get isRunning() { return this._running; }
  }

  window.GE_GameLoop = GameLoop;
})();
