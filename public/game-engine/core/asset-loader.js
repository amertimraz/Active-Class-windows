(function () {
  'use strict';
  if (window.GE_AssetLoader) return;

  class AssetLoader {
    constructor() {
      this._cache = new Map();
      this._loadingPromises = new Map();
    }

    async loadImage(key, url) {
      if (this._cache.has(key)) return this._cache.get(key);
      if (this._loadingPromises.has(key)) return this._loadingPromises.get(key);

      const promise = PIXI.Texture.fromURL(url).then(texture => {
        this._cache.set(key, texture);
        this._loadingPromises.delete(key);
        return texture;
      });

      this._loadingPromises.set(key, promise);
      return promise;
    }

    async loadImages(manifest) {
      const entries = Object.entries(manifest);
      const results = await Promise.all(
        entries.map(([key, url]) => this.loadImage(key, url).then(t => [key, t]))
      );
      return Object.fromEntries(results);
    }

    async loadJSON(key, url) {
      if (this._cache.has(key)) return this._cache.get(key);

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this._cache.set(key, data);
        return data;
      } catch (e) {
        console.error('[AssetLoader] Failed to load JSON:', url, e);
        throw e;
      }
    }

    async loadAudio(key, url) {
      if (this._cache.has(key)) return this._cache.get(key);

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        this._cache.set(key, arrayBuffer);
        return arrayBuffer;
      } catch (e) {
        console.error('[AssetLoader] Failed to load audio:', url, e);
        throw e;
      }
    }

    get(key) {
      return this._cache.get(key) || null;
    }

    has(key) {
      return this._cache.has(key);
    }

    clear() {
      try { PIXI.utils.clearTextureCache(); } catch (e) {}
      this._cache.clear();
      this._loadingPromises.clear();
    }
  }

  window.GE_AssetLoader = AssetLoader;
})();
