(function () {
  'use strict';

  const PIXI_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pixi.js/6.5.10/browser/pixi.min.js';

  const GameEngine = {
    version: '1.0.0',
    _loaded: true,
    _initialized: false,

    Loop: null,
    Scenes: null,
    Assets: null,
    Input: null,
    Audio: null,
    UI: null,
    EduAPI: null,
    app: null,

    _canUseWebGL() {
      try {
        new Function('return 1')();
        return true;
      } catch (e) {
        return false;
      }
    },

    async _ensurePixi() {
      if (window.PIXI) return;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PIXI_CDN_URL;
        s.onload = resolve;
        s.onerror = () => reject(new Error('[GameEngine] Failed to load PixiJS from CDN'));
        document.head.appendChild(s);
      });
    },

    async _ensureCoreModules() {
      const modules = [
        '/game-engine/core/game-loop.js',
        '/game-engine/core/scene-manager.js',
        '/game-engine/core/asset-loader.js',
        '/game-engine/core/input-manager.js',
        '/game-engine/core/audio-engine.js',
        '/game-engine/core/ui-system.js',
        '/game-engine/core/educational-api.js'
      ];
      const guards = ['GE_GameLoop', 'GE_SceneManager', 'GE_AssetLoader', 'GE_InputManager', 'GE_AudioEngine', 'GE_UISystem', 'GE_EducationalAPI'];
      for (let i = 0; i < modules.length; i++) {
        if (window[guards[i]]) continue;
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = modules[i];
          s.onload = resolve;
          s.onerror = () => { console.warn('[GameEngine] Could not load:', modules[i]); resolve(); };
          document.body.appendChild(s);
        });
      }
    },

    /**
     * Initialize the game engine
     * @param {Object} config
     * @param {HTMLElement|string} config.container  - DOM element or id
     * @param {number}  [config.width]               - canvas width  (default: container width)
     * @param {number}  [config.height]              - canvas height (default: container height)
     * @param {number}  [config.backgroundColor]     - bg color 0xRRGGBB (default: 0x0d1b2a)
     * @param {boolean} [config.transparent]         - transparent bg (default: false)
     * @returns {Promise<typeof GameEngine>}
     */
    async init(config = {}) {
      if (this._initialized) this.destroy();

      await this._ensurePixi();
      await this._ensureCoreModules();

      const container = typeof config.container === 'string'
        ? document.getElementById(config.container)
        : config.container;

      if (!container) throw new Error('[GameEngine] Container element not found');

      const width  = config.width  || container.clientWidth  || 800;
      const height = config.height || container.clientHeight || 500;

      const canEval = this._canUseWebGL();
      const forceCanvas = config.forceCanvas === true || !canEval;
      this.app = new PIXI.Application({
        width,
        height,
        backgroundColor: config.transparent ? undefined : (config.backgroundColor ?? 0x0d1b2a),
        transparent: config.transparent || false,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        autoStart: false,
        forceCanvas
      });
      console.log(`[GameEngine] Renderer: ${forceCanvas ? 'Canvas2D (fallback)' : 'WebGL'}`);

      container.appendChild(this.app.view);
      this.app.view.style.display = 'block';
      this.app.view.style.width  = '100%';
      this.app.view.style.height = '100%';

      this.Loop   = new GE_GameLoop();
      this.Scenes = new GE_SceneManager(this);
      this.Assets = new GE_AssetLoader();
      this.Input  = new GE_InputManager(this.app.view);
      this.Audio  = new GE_AudioEngine();
      this.UI     = new GE_UISystem();
      this.EduAPI = new GE_EducationalAPI();

      this.Loop.add((delta, now) => {
        this.app.ticker.update(now);
        this.Scenes.update(delta);
        this.Input.flushFrameState();
      });

      this.Loop.start();
      this._initialized = true;
      this._setupCleanup();

      console.log(`[GameEngine] v${this.version} ready — ${width}×${height}`);
      return this;
    },

    _setupCleanup() {
      const onHash = () => {
        if (!this._initialized) return;

        this.Loop && this.Loop.stop();
        this._initialized = false;

        try { this.Input && this.Input.destroy(); } catch (e) {}

        const appRef    = this.app;
        const scenesRef = this.Scenes;

        this.Loop = this.Scenes = this.Assets = this.Input = this.Audio = this.UI = this.EduAPI = null;
        this.app  = null;

        setTimeout(() => {
          try { scenesRef && scenesRef.destroy(); } catch (e) {}
          try {
            if (appRef) {
              appRef.ticker.stop();
              appRef.destroy(false, false);
            }
          } catch (e) {}
          console.log('[GameEngine] Resources freed');
        }, 1500);
      };
      window.addEventListener('hashchange', onHash, { once: true });
    },

    resize(width, height) {
      if (!this.app) return;
      this.app.renderer.resize(width, height);
    },

    _destroyResources() {
      try {
        this.Scenes && this.Scenes.destroy();
        this.Input  && this.Input.destroy();
        this.Audio  && this.Audio.destroy();
        this.UI     && this.UI.destroy();

        if (this.app) {
          this.app.ticker.stop();
          this.app.destroy(false, false);
          this.app = null;
        }

        this.Loop = this.Scenes = this.Assets = this.Input = this.Audio = this.UI = this.EduAPI = null;
        console.log('[GameEngine] Resources freed');
      } catch (e) {
        console.warn('[GameEngine] Destroy error (non-fatal):', e);
      }
    },

    destroy() {
      if (!this._initialized) return;
      this.Loop && this.Loop.stop();
      this._initialized = false;
      this._destroyResources();
    }
  };

  if (!window.GameEngine || !window.GameEngine._loaded) {
    window.GameEngine = GameEngine;
  }
})();
