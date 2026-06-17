(function () {
  'use strict';
  if (window.GE_AudioEngine) return;

  class AudioEngine {
    constructor() {
      this._ctx = null;
      this._masterGain = null;
      this._musicGain = null;
      this._sfxGain = null;
      this._buffers = new Map();
      this._music = null;
      this._muted = false;
    }

    _ensureContext() {
      if (!this._ctx) {
        try {
          this._ctx = new (window.AudioContext || window.webkitAudioContext)();
          this._masterGain = this._ctx.createGain();
          this._masterGain.gain.value = 1;
          this._masterGain.connect(this._ctx.destination);

          this._musicGain = this._ctx.createGain();
          this._musicGain.gain.value = 0.4;
          this._musicGain.connect(this._masterGain);

          this._sfxGain = this._ctx.createGain();
          this._sfxGain.gain.value = 0.8;
          this._sfxGain.connect(this._masterGain);
        } catch (e) {
          console.warn('[AudioEngine] Web Audio API not available:', e);
        }
      }
      if (this._ctx && this._ctx.state === 'suspended') {
        this._ctx.resume().catch(() => {});
      }
      return this._ctx;
    }

    async loadBuffer(key, arrayBuffer) {
      const ctx = this._ensureContext();
      if (!ctx) return;
      try {
        const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        this._buffers.set(key, buffer);
      } catch (e) {
        console.warn('[AudioEngine] Failed to decode audio:', key, e);
      }
    }

    playSFX(key, options = {}) {
      const ctx = this._ensureContext();
      if (!ctx || this._muted) return;
      const buffer = this._buffers.get(key);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = options.pitch || 1;
      source.connect(this._sfxGain);
      source.start(0);
      return source;
    }

    playTone(frequency, duration = 0.15, type = 'sine', gainValue = 0.3) {
      const ctx = this._ensureContext();
      if (!ctx || this._muted) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(gainValue, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this._sfxGain);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
      } catch (e) {}
    }

    playCorrectSFX() {
      this.playTone(523.25, 0.1, 'sine');
      setTimeout(() => this.playTone(659.25, 0.1, 'sine'), 100);
      setTimeout(() => this.playTone(783.99, 0.2, 'sine'), 200);
    }

    playWrongSFX() {
      this.playTone(220, 0.2, 'sawtooth', 0.2);
      setTimeout(() => this.playTone(180, 0.3, 'sawtooth', 0.15), 150);
    }

    playStartSFX() {
      [261.63, 329.63, 392, 523.25].forEach((freq, i) => {
        setTimeout(() => this.playTone(freq, 0.15, 'sine'), i * 80);
      });
    }

    playFinishSFX() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        setTimeout(() => this.playTone(freq, 0.25, 'sine'), i * 100);
      });
    }

    setMasterVolume(v) {
      if (this._masterGain) this._masterGain.gain.value = Math.max(0, Math.min(1, v));
    }

    setMusicVolume(v) {
      if (this._musicGain) this._musicGain.gain.value = Math.max(0, Math.min(1, v));
    }

    setSFXVolume(v) {
      if (this._sfxGain) this._sfxGain.gain.value = Math.max(0, Math.min(1, v));
    }

    mute() { this._muted = true; if (this._masterGain) this._masterGain.gain.value = 0; }
    unmute() { this._muted = false; if (this._masterGain) this._masterGain.gain.value = 1; }
    toggleMute() { this._muted ? this.unmute() : this.mute(); }
    get isMuted() { return this._muted; }

    destroy() {
      if (this._music) { try { this._music.stop(); } catch (e) {} this._music = null; }
      if (this._ctx) { this._ctx.close().catch(() => {}); this._ctx = null; }
      this._buffers.clear();
    }
  }

  window.GE_AudioEngine = AudioEngine;
})();
