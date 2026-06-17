(function () {
  'use strict';
  if (window.GE_SceneManager) return;

  class Scene {
    constructor(name) {
      this.name = name;
      this.engine = null;
      this._container = null;
    }

    get container() { return this._container; }

    init(engine) {
      this.engine = engine;
      if (engine.app) {
        this._container = new PIXI.Container();
        engine.app.stage.addChild(this._container);
      }
    }

    create() {}
    update(delta) {}

    destroy() {
      if (this._container && this.engine && this.engine.app) {
        this.engine.app.stage.removeChild(this._container);
        this._container.destroy({ children: true });
        this._container = null;
      }
    }
  }

  class SceneManager {
    constructor(engine) {
      this._engine = engine;
      this._scenes = new Map();
      this._current = null;
      this._transitioning = false;
    }

    register(name, sceneInstance) {
      this._scenes.set(name, sceneInstance);
      return this;
    }

    async switchTo(name, transitionMs = 300) {
      if (this._transitioning) return;
      const next = this._scenes.get(name);
      if (!next) { console.warn('[SceneManager] Scene not found:', name); return; }
      if (this._current === next) return;

      this._transitioning = true;

      if (this._current) {
        await this._fadeOut(transitionMs);
        this._current.destroy();
      }

      this._current = next;
      next.init(this._engine);
      next.create();

      await this._fadeIn(transitionMs);
      this._transitioning = false;
    }

    update(delta) {
      if (this._current && !this._transitioning) {
        try { this._current.update(delta); } catch (e) { console.error('[SceneManager] update error:', e); }
      }
    }

    destroy() {
      if (this._current) {
        this._current.destroy();
        this._current = null;
      }
      this._scenes.clear();
    }

    _fadeOut(ms) {
      if (!this._engine.app) return Promise.resolve();
      const stage = this._engine.app.stage;
      return new Promise(resolve => {
        const duration = ms / 1000;
        let elapsed = 0;
        const startAlpha = stage.alpha;
        const tick = (delta) => {
          elapsed += delta;
          stage.alpha = Math.max(0, startAlpha * (1 - elapsed / duration));
          if (elapsed >= duration) {
            stage.alpha = 0;
            this._engine.Loop.remove(tick);
            resolve();
          }
        };
        this._engine.Loop.add(tick);
      });
    }

    _fadeIn(ms) {
      if (!this._engine.app) return Promise.resolve();
      const stage = this._engine.app.stage;
      stage.alpha = 0;
      return new Promise(resolve => {
        const duration = ms / 1000;
        let elapsed = 0;
        const tick = (delta) => {
          elapsed += delta;
          stage.alpha = Math.min(1, elapsed / duration);
          if (elapsed >= duration) {
            stage.alpha = 1;
            this._engine.Loop.remove(tick);
            resolve();
          }
        };
        this._engine.Loop.add(tick);
      });
    }

    get current() { return this._current; }
  }

  window.GE_Scene = Scene;
  window.GE_SceneManager = SceneManager;
})();
