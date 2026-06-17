(function () {
  'use strict';
  if (window.GE_InputManager) return;

  class InputManager {
    constructor(canvas) {
      this._canvas = canvas;
      this._keys = new Map();
      this._keysJustPressed = new Set();
      this._keysJustReleased = new Set();
      this._mouse = { x: 0, y: 0, buttons: new Map(), justClicked: new Set() };
      this._touches = [];
      this._listeners = new Map();
      this._pointerCallbacks = [];

      this._onKeyDown = this._onKeyDown.bind(this);
      this._onKeyUp = this._onKeyUp.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onMouseDown = this._onMouseDown.bind(this);
      this._onMouseUp = this._onMouseUp.bind(this);
      this._onTouchStart = this._onTouchStart.bind(this);
      this._onTouchEnd = this._onTouchEnd.bind(this);

      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);

      if (canvas) {
        canvas.addEventListener('mousemove', this._onMouseMove);
        canvas.addEventListener('mousedown', this._onMouseDown);
        canvas.addEventListener('mouseup', this._onMouseUp);
        canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
        canvas.addEventListener('touchend', this._onTouchEnd, { passive: true });
      }
    }

    isKeyDown(code) { return this._keys.get(code) === true; }
    isKeyJustPressed(code) { return this._keysJustPressed.has(code); }
    isKeyJustReleased(code) { return this._keysJustReleased.has(code); }

    get mouseX() { return this._mouse.x; }
    get mouseY() { return this._mouse.y; }
    isMouseDown(button = 0) { return this._mouse.buttons.get(button) === true; }
    isMouseJustClicked(button = 0) { return this._mouse.justClicked.has(button); }

    onPointer(fn) {
      this._pointerCallbacks.push(fn);
      return () => {
        const idx = this._pointerCallbacks.indexOf(fn);
        if (idx !== -1) this._pointerCallbacks.splice(idx, 1);
      };
    }

    flushFrameState() {
      this._keysJustPressed.clear();
      this._keysJustReleased.clear();
      this._mouse.justClicked.clear();
    }

    _onKeyDown(e) {
      const blockScroll = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
      if (blockScroll.includes(e.code)) e.preventDefault();
      if (!this._keys.get(e.code)) this._keysJustPressed.add(e.code);
      this._keys.set(e.code, true);
    }

    _onKeyUp(e) {
      this._keys.set(e.code, false);
      this._keysJustReleased.add(e.code);
    }

    _onMouseMove(e) {
      const rect = this._canvas ? this._canvas.getBoundingClientRect() : { left: 0, top: 0 };
      this._mouse.x = e.clientX - rect.left;
      this._mouse.y = e.clientY - rect.top;
    }

    _onMouseDown(e) {
      this._mouse.buttons.set(e.button, true);
    }

    _onMouseUp(e) {
      this._mouse.buttons.set(e.button, false);
      this._mouse.justClicked.add(e.button);
      this._firePointer(this._mouse.x, this._mouse.y);
    }

    _onTouchStart(e) {
      const rect = this._canvas ? this._canvas.getBoundingClientRect() : { left: 0, top: 0 };
      this._touches = Array.from(e.changedTouches).map(t => ({
        x: t.clientX - rect.left, y: t.clientY - rect.top
      }));
    }

    _onTouchEnd(e) {
      const rect = this._canvas ? this._canvas.getBoundingClientRect() : { left: 0, top: 0 };
      for (const t of e.changedTouches) {
        this._firePointer(t.clientX - rect.left, t.clientY - rect.top);
      }
    }

    _firePointer(x, y) {
      for (const cb of this._pointerCallbacks) {
        try { cb(x, y); } catch (e) { console.error('[InputManager] pointer callback error:', e); }
      }
    }

    destroy() {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      if (this._canvas) {
        this._canvas.removeEventListener('mousemove', this._onMouseMove);
        this._canvas.removeEventListener('mousedown', this._onMouseDown);
        this._canvas.removeEventListener('mouseup', this._onMouseUp);
        this._canvas.removeEventListener('touchstart', this._onTouchStart);
        this._canvas.removeEventListener('touchend', this._onTouchEnd);
      }
      this._pointerCallbacks = [];
    }
  }

  window.GE_InputManager = InputManager;
})();
