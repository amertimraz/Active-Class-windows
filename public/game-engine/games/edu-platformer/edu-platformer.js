(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  const GRAVITY   = 1400;
  const JUMP_VY   = -900;
  const WALK_SPD  = 250;
  const MAX_FALL  = 900;
  const TILE      = 48;
  const WORLD_W   = 4400;

  // ── Module State ─────────────────────────────────────────────────────────────
  let _engine          = null;
  let _questionActive  = false;
  let _pendingTimeouts = [];
  let _screenH         = 500;

  // ── Sound System ─────────────────────────────────────────────────────────────
  const SFX = (() => {
    let _ctx = null;
    let _muted = false;
    let _bgGain = null;
    let _bgNodes = [];

    function ctx() {
      if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (_ctx.state === 'suspended') _ctx.resume();
      return _ctx;
    }

    function tone(freq, dur, type = 'sine', vol = 0.18, delay = 0) {
      if (_muted) return;
      try {
        const c = ctx();
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, c.currentTime + delay);
        gain.gain.setValueAtTime(vol, c.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + dur);
        osc.connect(gain); gain.connect(c.destination);
        osc.start(c.currentTime + delay);
        osc.stop(c.currentTime + delay + dur + 0.01);
      } catch (_) {}
    }

    return {
      jump()    { tone(320, 0.08, 'square', 0.12); tone(480, 0.1, 'square', 0.08, 0.06); },
      dblJump() { tone(480, 0.06, 'square', 0.1); tone(640, 0.06, 'square', 0.08, 0.05); tone(800, 0.12, 'square', 0.06, 0.1); },
      coin()    { tone(880, 0.06, 'sine', 0.16); tone(1100, 0.1, 'sine', 0.12, 0.06); },
      correct() { tone(523, 0.1, 'sine', 0.18); tone(659, 0.1, 'sine', 0.16, 0.1); tone(784, 0.18, 'sine', 0.14, 0.2); },
      wrong()   { tone(220, 0.06, 'sawtooth', 0.2); tone(160, 0.14, 'sawtooth', 0.18, 0.08); },
      stomp()   { tone(660, 0.05, 'square', 0.15); tone(330, 0.1, 'sine', 0.12, 0.05); },
      hurt()    { tone(180, 0.2, 'sawtooth', 0.2); },
      levelUp() {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'sine', 0.18, i * 0.1));
      },

      startBGM() {
        if (_muted) return;
        try {
          const c = ctx();
          _bgGain = c.createGain();
          _bgGain.gain.setValueAtTime(0.04, c.currentTime);
          _bgGain.connect(c.destination);

          const melody = [261, 294, 329, 349, 392, 349, 329, 294];
          const bass   = [130, 130, 164, 174, 196, 174, 164, 130];
          const step   = 0.55;

          function scheduleLoop(startT) {
            const nodes = [];
            melody.forEach((f, i) => {
              const o = c.createOscillator(); const g = c.createGain();
              o.type = 'triangle'; o.frequency.value = f;
              g.gain.setValueAtTime(0.6, startT + i * step);
              g.gain.exponentialRampToValueAtTime(0.001, startT + i * step + step * 0.85);
              o.connect(g); g.connect(_bgGain);
              o.start(startT + i * step); o.stop(startT + i * step + step);
              nodes.push(o);
            });
            bass.forEach((f, i) => {
              const o = c.createOscillator(); const g = c.createGain();
              o.type = 'sine'; o.frequency.value = f;
              g.gain.setValueAtTime(0.5, startT + i * step);
              g.gain.exponentialRampToValueAtTime(0.001, startT + i * step + step * 0.9);
              o.connect(g); g.connect(_bgGain);
              o.start(startT + i * step); o.stop(startT + i * step + step);
              nodes.push(o);
            });
            _bgNodes = nodes;
            const loopDur = melody.length * step;
            const tid = setTimeout(() => { if (!_muted) scheduleLoop(c.currentTime); }, loopDur * 1000 - 100);
            _pendingTimeouts.push(tid);
          }
          scheduleLoop(c.currentTime + 0.1);
        } catch (_) {}
      },

      stopBGM() {
        try {
          _bgNodes.forEach(n => { try { n.stop(); } catch (_) {} });
          _bgNodes = [];
          if (_bgGain) { _bgGain.disconnect(); _bgGain = null; }
        } catch (_) {}
      },

      get muted() { return _muted; },
      setMuted(v) {
        _muted = v;
        if (_bgGain) _bgGain.gain.setValueAtTime(_muted ? 0 : 0.04, _ctx ? _ctx.currentTime : 0);
        const btn = document.getElementById('ep-mute-btn');
        if (btn) btn.textContent = _muted ? '🔇' : '🔊';
        try { localStorage.setItem('ep_muted', _muted ? '1' : '0'); } catch (_) {}
      },
      toggle() { this.setMuted(!_muted); },
      init() {
        const saved = localStorage.getItem('ep_muted');
        _muted = saved === '1';
        const btn = document.getElementById('ep-mute-btn');
        if (btn) {
          btn.textContent = _muted ? '🔇' : '🔊';
          btn.addEventListener('click', () => SFX.toggle());
        }
      }
    };
  })();

  function safeTimeout(fn, ms) {
    const id = setTimeout(() => {
      _pendingTimeouts = _pendingTimeouts.filter(x => x !== id);
      fn();
    }, ms);
    _pendingTimeouts.push(id);
    return id;
  }

  function clearAllTimeouts() {
    _pendingTimeouts.forEach(clearTimeout);
    _pendingTimeouts = [];
  }

  // ── AABB Collision ────────────────────────────────────────────────────────────
  function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // ── Graphics Draw Functions ──────────────────────────────────────────────────
  function drawPlatform(g, w, h, isGround) {
    g.clear();
    if (isGround) {
      g.beginFill(0x8B6914);
      g.drawRect(0, 0, w, h);
      g.endFill();
      const brickH = 20, brickW = 48;
      for (let row = 0; row < Math.ceil(h / brickH); row++) {
        const yy = row * brickH + 13;
        const offset = (row % 2) * (brickW / 2);
        g.beginFill(row % 2 === 0 ? 0xA07040 : 0x946640);
        for (let col = -brickW; col < w + brickW; col += brickW) {
          g.drawRect(col + offset + 1, yy + 1, brickW - 2, brickH - 2);
        }
        g.endFill();
      }
      g.beginFill(0x43A047);
      g.drawRect(0, 0, w, 13);
      g.endFill();
      g.beginFill(0x2E7D32);
      g.drawRect(0, 10, w, 4);
      g.endFill();
      g.beginFill(0x66BB6A, 0.45);
      g.drawRect(0, 1, w, 4);
      g.endFill();
      g.beginFill(0x1B5E20);
      for (let gx = 6; gx < w - 4; gx += 14) {
        g.drawRect(gx, 0, 4, 5);
        g.drawRect(gx + 7, 2, 3, 4);
      }
      g.endFill();
    } else {
      const GRASS_H = 14;
      const brickH  = 18;
      const brickW  = TILE;

      // ── outer dark border (depth shadow) ──
      g.beginFill(0x3B2A14);
      g.drawRect(0, 0, w, h);
      g.endFill();

      // ── dirt/stone body ──
      g.beginFill(0x7A5230);
      g.drawRect(2, GRASS_H, w - 2, h - GRASS_H - 3);
      g.endFill();

      // ── staggered brick rows ──
      const BRICK_COLORS = [0xC4935A, 0xB8834E, 0xCFA06A, 0xB07848];
      for (let row = 0; row * brickH < h - GRASS_H - 3; row++) {
        const ry  = GRASS_H + row * brickH;
        const off = (row % 2) * (brickW / 2);
        for (let col = -brickW; col < w; col += brickW) {
          const bx = col + off;
          const bw = Math.min(brickW - 3, w - bx - 2);
          if (bw <= 0) continue;
          const bColor = BRICK_COLORS[(row + Math.floor(col / brickW)) % BRICK_COLORS.length];
          // brick face
          g.beginFill(bColor);
          g.drawRect(Math.max(2, bx + 2), ry + 2, Math.min(bw, w - 4 - (bx + 2 < 2 ? 0 : 0)), brickH - 4);
          g.endFill();
          // brick top highlight
          g.beginFill(0xFFFFFF, 0.12);
          g.drawRect(Math.max(2, bx + 2), ry + 2, Math.min(bw, w - 4), 3);
          g.endFill();
          // brick bottom shadow
          g.beginFill(0x000000, 0.18);
          g.drawRect(Math.max(2, bx + 2), ry + brickH - 4, Math.min(bw, w - 4), 3);
          g.endFill();
        }
      }

      // ── left edge highlight ──
      g.beginFill(0xFFFFFF, 0.1);
      g.drawRect(2, GRASS_H, 3, h - GRASS_H - 3);
      g.endFill();

      // ── bottom shadow ──
      g.beginFill(0x000000, 0.35);
      g.drawRect(2, h - 5, w - 2, 3);
      g.endFill();

      // ── grass top base ──
      g.beginFill(0x33691E);
      g.drawRect(0, 0, w, GRASS_H);
      g.endFill();

      // ── grass highlight band ──
      g.beginFill(0x558B2F);
      g.drawRect(0, 0, w, GRASS_H - 4);
      g.endFill();

      // ── bright top strip ──
      g.beginFill(0x7CB342);
      g.drawRect(0, 0, w, 5);
      g.endFill();

      // ── subtle top gloss ──
      g.beginFill(0xFFFFFF, 0.18);
      g.drawRect(0, 0, w, 3);
      g.endFill();

      // ── grass blades ──
      g.beginFill(0x1B5E20);
      for (let gx = 5; gx < w - 3; gx += 11) {
        g.drawRect(gx,     0, 3, 6);
        g.drawRect(gx + 5, 1, 2, 5);
      }
      g.endFill();
      g.beginFill(0xAED581, 0.45);
      for (let gx = 6; gx < w - 3; gx += 11) {
        g.drawRect(gx, 0, 1, 4);
      }
      g.endFill();
    }
  }

  function drawQBlock(g, hit) {
    g.clear();
    const S = TILE;
    // Drop shadow
    g.beginFill(0x000000, 0.22);
    g.drawRect(4, 5, S, S);
    g.endFill();
    if (hit) {
      g.beginFill(0x8D8D8D); g.drawRect(0, 0, S, S); g.endFill();
      g.beginFill(0xA5A5A5); g.drawRect(0, 0, S, 6); g.drawRect(0, 0, 6, S); g.endFill();
      g.beginFill(0x5A5A5A); g.drawRect(0, S-5, S, 5); g.drawRect(S-5, 0, 5, S); g.endFill();
    } else {
      // 3D bevel gold
      g.beginFill(0xF9A825); g.drawRect(0, 0, S, S); g.endFill();
      g.beginFill(0xFFE082); g.drawRect(0, 0, S, 7); g.drawRect(0, 0, 7, S); g.endFill();
      g.beginFill(0xBF6900); g.drawRect(0, S-7, S, 7); g.drawRect(S-7, 0, 7, S); g.endFill();
      g.beginFill(0xFFD740); g.drawRect(7, 7, S-14, S-14); g.endFill();
      g.beginFill(0xFFFFFF, 0.28); g.drawRect(10, 10, 13, 6); g.endFill();
    }
  }

  function drawPlayerShape(g, facing, walking, onGround, animT, hurt) {
    g.clear();
    const W = 36, H = 48;
    const phase = onGround && walking ? Math.sin(animT * 10) : 0;

    // shadow
    g.beginFill(0x000000, 0.12);
    g.drawEllipse(W / 2, H + 3, W / 2 + 2, 5);
    g.endFill();

    // shoes
    g.beginFill(0x4E342E);
    const lOff = phase > 0 ? 4 : 0;
    const rOff = phase < 0 ? 4 : 0;
    g.drawRoundedRect(-3, H - 12 + lOff, 19, 12, 3);
    g.drawRoundedRect(W - 16, H - 12 + rOff, 19, 12, 3);
    g.endFill();

    // pants
    g.beginFill(0x1A237E);
    g.drawRect(0, H - 24, W, 14);
    g.endFill();

    // overall bib & straps
    g.beginFill(0x283593);
    g.drawRect(5, H - 36, W - 10, 14);
    g.drawRect(3, H - 34, 12, 11);
    g.drawRect(W - 15, H - 34, 12, 11);
    g.endFill();

    // shirt
    g.beginFill(hurt ? 0xFF8A80 : 0xE53935);
    g.drawRect(0, H - 36, W, 14);
    g.endFill();

    // neck
    g.beginFill(0xFFCC80);
    g.drawRect(W / 2 - 6, H - 44, 12, 10);
    g.endFill();

    // head
    g.beginFill(0xFFCC80);
    g.drawRoundedRect(3, 8, W - 6, 24, 4);
    g.endFill();

    // cap
    g.beginFill(hurt ? 0xFF8A80 : 0xE53935);
    g.drawRect(-1, 3, W + 2, 12);
    g.drawRect(2, 0, W - 4, 13);
    g.endFill();
    g.beginFill(0xB71C1C);
    g.drawRect(-1, 13, W + 2, 3);
    g.endFill();

    // hair
    g.beginFill(0x5D4037);
    g.drawRect(3, 14, 7, 4);
    g.drawRect(W - 10, 14, 7, 4);
    g.endFill();

    // eyes
    const ex = facing > 0 ? 4 : -4;
    g.beginFill(0xFFFFFF);
    g.drawCircle(W / 2 + ex + 5, 19, 5);
    g.endFill();
    g.beginFill(0x1565C0);
    g.drawCircle(W / 2 + ex + 6, 19, 3);
    g.endFill();
    g.beginFill(0x000000);
    g.drawCircle(W / 2 + ex + 7, 19, 1.5);
    g.endFill();

    // nose
    g.beginFill(0xFFB74D);
    g.drawEllipse(W / 2 + ex + 10, 23, 5, 3);
    g.endFill();

    // mustache
    g.beginFill(0x5D4037);
    g.drawRoundedRect(W / 2 + ex + 1, 25, 16, 5, 2);
    g.endFill();

    // eyebrow
    g.lineStyle(2, 0x5D4037);
    g.moveTo(W / 2 + ex + 1, 14);
    g.lineTo(W / 2 + ex + 11, 15);
    g.lineStyle(0);
  }

  function drawEnemyShape(g, W, H, facing, squished) {
    g.clear();
    if (squished) {
      g.beginFill(0xBF360C);
      g.drawEllipse(W / 2, H - 5, W / 2 + 4, 5);
      g.endFill();
      return;
    }
    g.beginFill(0x000000, 0.12);
    g.drawEllipse(W / 2, H + 2, W / 2, 5);
    g.endFill();
    g.beginFill(0x4E342E);
    g.drawEllipse(9, H - 1, 10, 8);
    g.drawEllipse(W - 9, H - 1, 10, 8);
    g.endFill();
    g.beginFill(0xBF360C);
    g.drawEllipse(W / 2, H / 2, W / 2, H / 2 - 3);
    g.endFill();
    g.beginFill(0x7F1D00);
    g.drawEllipse(W / 2, H * 0.28, W / 2 - 5, H * 0.16);
    g.endFill();
    const ex = facing > 0 ? 3 : -3;
    g.beginFill(0xFFFFFF);
    g.drawCircle(W / 2 - 9 + ex, H / 2 - 4, 8);
    g.drawCircle(W / 2 + 9 + ex, H / 2 - 4, 8);
    g.endFill();
    g.beginFill(0x1A237E);
    g.drawCircle(W / 2 - 8 + ex, H / 2 - 4, 4);
    g.drawCircle(W / 2 + 10 + ex, H / 2 - 4, 4);
    g.endFill();
    g.lineStyle(3, 0x1A237E);
    g.moveTo(W / 2 - 16 + ex, H / 2 - 11);
    g.lineTo(W / 2 - 5 + ex, H / 2 - 8);
    g.moveTo(W / 2 + 16 + ex, H / 2 - 11);
    g.lineTo(W / 2 + 5 + ex, H / 2 - 8);
    g.lineStyle(0);
    g.beginFill(0xFFFFFF);
    g.drawRect(W / 2 - 7, H / 2 + 4, 5, 9);
    g.drawRect(W / 2 + 2, H / 2 + 4, 5, 9);
    g.endFill();
  }

  // ── QuestionBlock ────────────────────────────────────────────────────────────
  class QuestionBlock {
    constructor(parent, x, y, question) {
      this.originX = x;
      this.originY = y;
      this.question = question;
      this.hit = false;
      this.bounceT = -1;

      this.cont = new PIXI.Container();
      this.cont.x = x;
      this.cont.y = y;
      parent.addChild(this.cont);

      this.gfx = new PIXI.Graphics();
      this.cont.addChild(this.gfx);
      drawQBlock(this.gfx, false);

      this.label = new PIXI.Text('?', {
        fontFamily: 'Arial Black, Arial',
        fontSize: 26,
        fontWeight: 'bold',
        fill: 0x7B3F00,
      });
      this.label.anchor.set(0.5);
      this.label.x = TILE / 2;
      this.label.y = TILE / 2 + 1;
      this.cont.addChild(this.label);
    }

    get bounds() {
      return { x: this.cont.x, y: this.cont.y, w: TILE, h: TILE };
    }

    triggerHit() {
      if (this.hit) return false;
      this.hit = true;
      this.bounceT = 0;
      this.label.text = '';
      drawQBlock(this.gfx, true);
      return true;
    }

    update(dt) {
      if (this.bounceT < 0) return;
      this.bounceT += dt;
      if (this.bounceT >= 0.32) {
        this.bounceT = -1;
        this.cont.y = this.originY;
      } else {
        this.cont.y = this.originY - Math.sin((this.bounceT / 0.32) * Math.PI) * 22;
      }
    }
  }

  // ── Enemy ─────────────────────────────────────────────────────────────────────
  class Enemy {
    constructor(parent, x, groundY, patrolL, patrolR) {
      this.x = x;
      this.y = groundY - 44;
      this.w = 44;
      this.h = 44;
      this.vx = -85;
      this.vy = 0;
      this.patrolL = patrolL;
      this.patrolR = patrolR;
      this.facing = -1;
      this.alive = true;
      this.squished = false;
      this.squishTimer = 0;

      this.cont = new PIXI.Container();
      this.cont.x = this.x;
      this.cont.y = this.y;
      parent.addChild(this.cont);

      this.gfx = new PIXI.Graphics();
      this.cont.addChild(this.gfx);
      drawEnemyShape(this.gfx, this.w, this.h, this.facing, false);
    }

    get bounds() {
      return { x: this.x, y: this.y, w: this.w, h: this.h };
    }

    squish() {
      this.squished = true;
      this.squishTimer = 0.5;
      drawEnemyShape(this.gfx, this.w, this.h, this.facing, true);
    }

    update(dt, platforms) {
      if (!this.alive) return;
      if (this.squished) {
        this.squishTimer -= dt;
        if (this.squishTimer <= 0) {
          this.alive = false;
          this.cont.visible = false;
        }
        return;
      }

      this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      if (this.x < this.patrolL)             { this.x = this.patrolL;          this.vx =  Math.abs(this.vx); this.facing =  1; }
      if (this.x + this.w > this.patrolR)    { this.x = this.patrolR - this.w; this.vx = -Math.abs(this.vx); this.facing = -1; }

      for (const p of platforms) {
        if (!overlaps(this.x, this.y, this.w, this.h, p.x, p.y, p.w, p.h)) continue;
        if (this.vy >= 0) { this.y = p.y - this.h; this.vy = 0; }
      }

      this.cont.x = this.x;
      this.cont.y = this.y;
      drawEnemyShape(this.gfx, this.w, this.h, this.facing, false);
    }
  }

  // ── Coin Particle ─────────────────────────────────────────────────────────────
  class Coin {
    constructor(parent, x, y) {
      this.vx = (Math.random() - 0.5) * 90;
      this.vy = -460;
      this.t  = 0;
      this.life = 0.85;

      this.gfx = new PIXI.Graphics();
      this.gfx.beginFill(0xFFD740);
      this.gfx.lineStyle(2, 0xFFA000);
      this.gfx.drawCircle(0, 0, 11);
      this.gfx.endFill();
      this.gfx.beginFill(0xFFF9C4, 0.6);
      this.gfx.drawEllipse(0, 0, 5, 9);
      this.gfx.endFill();
      this.gfx.x = x;
      this.gfx.y = y;
      parent.addChild(this.gfx);
    }

    update(dt) {
      this.t  += dt;
      this.vy += 950 * dt;
      this.gfx.x += this.vx * dt;
      this.gfx.y += this.vy * dt;
      this.gfx.rotation += 4 * dt;
      this.gfx.alpha = 1 - this.t / this.life;
      return this.t < this.life;
    }
  }

  // ── Star Burst (wrong answer) ──────────────────────────────────────────────
  class StarBurst {
    constructor(parent, x, y) {
      this.parts = [];
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2;
        const spd   = 120 + Math.random() * 160;
        const g = new PIXI.Graphics();
        g.beginFill(0xEF5350);
        g.drawStar && g.drawStar(0, 0, 5, 9, 4);
        if (!g.drawStar) { g.drawCircle(0, 0, 7); }
        g.endFill();
        g.x = x; g.y = y;
        parent.addChild(g);
        this.parts.push({ g, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, t: 0, life: 0.55 });
      }
    }

    update(dt) {
      let alive = false;
      for (const p of this.parts) {
        if (p.t >= p.life) continue;
        alive = true;
        p.t += dt;
        p.g.x += p.vx * dt;
        p.g.y += p.vy * dt;
        p.vy  += 500 * dt;
        p.g.alpha = 1 - p.t / p.life;
        if (p.t >= p.life && p.g.parent) p.g.destroy();
      }
      return alive;
    }
  }

  // ── Pipe helper ───────────────────────────────────────────────────────────────
  function addPipe(parent, x, groundY, w, h) {
    const g = new PIXI.Graphics();
    // body
    g.beginFill(0x2E7D32); g.drawRect(x, groundY - h, w, h); g.endFill();
    // right edge shadow
    g.beginFill(0x1B5E20); g.drawRect(x + w - 8, groundY - h, 8, h); g.endFill();
    // cap
    g.beginFill(0x388E3C); g.drawRect(x - 6, groundY - h - 14, w + 12, 18); g.endFill();
    g.beginFill(0x1B5E20); g.drawRect(x - 6, groundY - h + 4, w + 12, 6); g.endFill();
    // highlight strip on body
    g.beginFill(0x4CAF50, 0.45); g.drawRect(x + 6, groundY - h + 4, 8, h - 8); g.endFill();
    parent.addChild(g);
  }

  // ── Castle helper ─────────────────────────────────────────────────────────────
  function buildCastle(parent, x, groundY) {
    const g = new PIXI.Graphics();
    const stoneColor  = 0x9E9E9E;
    const stoneDark   = 0x757575;
    const stoneLight  = 0xBDBDBD;

    function tower(tx, ty, tw, th) {
      g.beginFill(stoneColor); g.drawRect(tx, ty, tw, th); g.endFill();
      g.beginFill(stoneDark);  g.drawRect(tx + tw - 8, ty, 8, th); g.endFill();
      g.beginFill(stoneLight); g.drawRect(tx, ty, 8, th); g.endFill();
      // stone mortar lines
      g.lineStyle(1, stoneDark, 0.35);
      for (let ry = ty + 18; ry < ty + th; ry += 18) { g.moveTo(tx, ry); g.lineTo(tx + tw, ry); }
      for (let rx = tx + tw / 2; rx < tx + tw; rx += tw / 2) { g.moveTo(rx, ty); g.lineTo(rx, ty + th); }
      g.lineStyle(0);
      // battlements
      g.beginFill(stoneDark);
      for (let bx = tx; bx < tx + tw; bx += 14) { g.drawRect(bx, ty - 18, 9, 18); }
      g.endFill();
    }

    // Main body
    tower(x + 30, groundY - 120, 120, 120);
    // Left tower (taller)
    tower(x, groundY - 150, 55, 150);
    // Right tower (taller)
    tower(x + 125, groundY - 145, 55, 145);
    // Gate arch
    g.beginFill(0x424242); g.drawRect(x + 68, groundY - 55, 34, 55); g.endFill();
    g.beginFill(0x616161); g.drawEllipse(x + 85, groundY - 55, 17, 14); g.endFill();
    // Windows
    g.beginFill(0x424242);
    g.drawRect(x + 50, groundY - 100, 14, 20);
    g.drawRect(x + 116, groundY - 100, 14, 20);
    g.endFill();

    parent.addChild(g);

    // Flags on towers
    const fg = new PIXI.Graphics();
    fg.lineStyle(3, 0x8D8D8D);
    fg.moveTo(x + 27,   groundY - 172); fg.lineTo(x + 27,   groundY - 150);
    fg.moveTo(x + 152,  groundY - 168); fg.lineTo(x + 152,  groundY - 145);
    fg.lineStyle(0);
    fg.beginFill(0xE53935); fg.drawRect(x + 27, groundY - 172, 30, 20); fg.endFill();
    fg.beginFill(0xEF5350); fg.drawRect(x + 152, groundY - 168, 28, 18); fg.endFill();
    parent.addChild(fg);
  }

  // ── Background ───────────────────────────────────────────────────────────────
  function buildBackground(parent, W, H) {
    const groundY = H - TILE * 2;
    const tileW   = W > 0 ? W : H;
    // Sky — tiled background image stretched to screen width
    try {
      const bgTex = PIXI.Texture.from('/assets/40.png');
      const tilesNeeded = Math.ceil(WORLD_W / tileW) + 1;
      for (let i = 0; i < tilesNeeded; i++) {
        const bgSpr = new PIXI.Sprite(bgTex);
        bgSpr.x = i * tileW;
        bgSpr.y = 0;
        bgSpr.width  = tileW + 1;
        bgSpr.height = H * 1.4;
        parent.addChild(bgSpr);
      }
    } catch (_) {
      const skyG = new PIXI.Graphics();
      skyG.beginFill(0x1565C0); skyG.drawRect(0, 0, WORLD_W, H); skyG.endFill();
      parent.addChild(skyG);
    }

    // Far mountains — bluish
    const mg = new PIXI.Graphics();
    for (let i = 0; i < 18; i++) {
      const mx = i * 260 + (i % 3) * 40;
      const mh = 80 + (i % 4) * 30;
      const mw = 160 + (i % 3) * 50;
      mg.beginFill(i % 2 === 0 ? 0x5C6BC0 : 0x7986CB, 0.55);
      mg.moveTo(mx, groundY);
      mg.lineTo(mx + mw / 2, groundY - mh);
      mg.lineTo(mx + mw, groundY);
      mg.closePath(); mg.endFill();
      // snow
      mg.beginFill(0xFFFFFF, 0.55);
      const sw = mh * 0.18;
      mg.moveTo(mx + mw/2 - sw, groundY - mh * 0.74);
      mg.lineTo(mx + mw/2, groundY - mh);
      mg.lineTo(mx + mw/2 + sw, groundY - mh * 0.74);
      mg.closePath(); mg.endFill();
    }
    parent.addChild(mg);

    // Rolling green hills
    const hg = new PIXI.Graphics();
    for (let i = 0; i < 16; i++) {
      const hx = i * 310 + (i % 2) * 60;
      const hr = 90 + (i % 3) * 35;
      hg.beginFill(i % 2 === 0 ? 0x43A047 : 0x388E3C, 0.7);
      hg.drawEllipse(hx, groundY + 20, hr, 55);
      hg.endFill();
    }
    parent.addChild(hg);

    // Distant trees (simple silhouettes behind hills)
    const tg = new PIXI.Graphics();
    for (let tx2 = 60; tx2 < WORLD_W - 60; tx2 += 100 + (Math.floor(tx2/100) % 3) * 40) {
      const th = 55 + (Math.floor(tx2/150) % 3) * 20;
      tg.beginFill(0x2E7D32, 0.55);
      tg.drawRect(tx2 + 18, groundY - th, 8, th);
      tg.drawEllipse(tx2 + 22, groundY - th - 20, 22, 28);
      tg.endFill();
    }
    parent.addChild(tg);

    // Large puffy cartoon clouds
    const cloudDefs = [
      { x: 150,  y: 50,  s: 1.2, spd: 14 }, { x: 600,  y: 38,  s: 0.9, spd: 18 },
      { x: 1100, y: 60,  s: 1.0, spd: 12 }, { x: 1650, y: 42,  s: 1.3, spd: 20 },
      { x: 2200, y: 55,  s: 1.0, spd: 16 }, { x: 2700, y: 40,  s: 0.85, spd: 22 },
      { x: 3200, y: 62,  s: 1.1, spd: 15 }, { x: 3750, y: 48,  s: 0.95, spd: 19 },
      { x: 4200, y: 38,  s: 1.2, spd: 13 },
    ];
    const _clouds = [];
    for (const cd of cloudDefs) {
      const cont = new PIXI.Container();
      const cg = new PIXI.Graphics();
      const s = cd.s;
      cg.beginFill(0xFFFFFF, 0.95);
      cg.drawEllipse(0, 0, 80 * s, 36 * s);
      cg.drawEllipse(-50 * s, 12 * s, 55 * s, 28 * s);
      cg.drawEllipse(50 * s, 14 * s, 52 * s, 26 * s);
      cg.drawEllipse(-20 * s, 18 * s, 40 * s, 22 * s);
      cg.drawEllipse(25 * s, 20 * s, 38 * s, 20 * s);
      cg.endFill();
      cg.beginFill(0xB0C4DE, 0.25);
      cg.drawEllipse(0, 20 * s, 75 * s, 16 * s);
      cg.endFill();
      cont.addChild(cg);
      cont.x = cd.x; cont.y = cd.y;
      cont._baseY = cd.y;
      cont._spd   = cd.spd;
      cont._phase = Math.random() * Math.PI * 2;
      parent.addChild(cont);
      _clouds.push(cont);
    }

    // Cloud animation ticker
    let _cloudTime = 0;
    const _cloudTicker = (dt) => {
      _cloudTime += dt;
      for (const c of _clouds) {
        if (c.destroyed) continue;
        c.x  += c._spd * dt;
        c.y   = c._baseY + Math.sin(_cloudTime * 0.6 + c._phase) * 6;
        if (c.x > WORLD_W + 300) c.x = -300;
      }
    };
    parent._cloudTicker = _cloudTicker;

    // Castles
    buildCastle(parent, 800,  groundY);
    buildCastle(parent, 2600, groundY);
    buildCastle(parent, 3900, groundY);

    // River / water in gaps
    const riverG = new PIXI.Graphics();
    const riverDefs = [{ x: 1100, w: 120 }, { x: 2380, w: 100 }, { x: 3490, w: 90 }];
    for (const r of riverDefs) {
      riverG.beginFill(0x1976D2, 0.85);
      riverG.drawRect(r.x, groundY - 4, r.w, TILE * 2 + 8);
      riverG.endFill();
      // water shimmer
      riverG.beginFill(0xFFFFFF, 0.18);
      riverG.drawRect(r.x + 10, groundY + 4, r.w - 20, 6);
      riverG.drawRect(r.x + 20, groundY + 14, r.w - 40, 4);
      riverG.endFill();
    }
    parent.addChild(riverG);

    // Decorative bushes on ground
    for (let bx = 80; bx < WORLD_W - 80; bx += 160 + (Math.floor(bx / 200) % 3) * 60) {
      const bs = 0.55 + (Math.floor(bx / 300) % 3) * 0.2;
      const bg = new PIXI.Graphics();
      bg.beginFill(0x2E7D32);
      bg.drawEllipse(0, 0, 38 * bs, 24 * bs);
      bg.drawEllipse(-24 * bs, 6 * bs, 30 * bs, 18 * bs);
      bg.drawEllipse(24 * bs, 6 * bs, 30 * bs, 18 * bs);
      bg.endFill();
      bg.beginFill(0x43A047, 0.5);
      bg.drawEllipse(-8 * bs, -6 * bs, 20 * bs, 12 * bs);
      bg.endFill();
      bg.x = bx; bg.y = groundY - 7;
      parent.addChild(bg);
    }

    // Pipes at gap edges
    addPipe(parent, 1060,  groundY, 52, 82);
    addPipe(parent, 1220,  groundY, 42, 65);
    addPipe(parent, 2330,  groundY, 52, 88);
    addPipe(parent, 2530,  groundY, 42, 65);
    addPipe(parent, 3440,  groundY, 52, 78);
    addPipe(parent, 3600,  groundY, 42, 60);
  }

  // ── Level ────────────────────────────────────────────────────────────────────
  function buildLevel(parent, H, questions) {
    const groundY = H - TILE * 2;
    const platforms = [];
    const qBlocks   = [];
    const enemies   = [];

    function addPlat(x, y, w, h, isGround) {
      const g = new PIXI.Graphics();
      drawPlatform(g, w, h, isGround);
      g.x = x; g.y = y;
      parent.addChild(g);
      platforms.push({ x, y, w, h });
    }

    // Ground sections (with gaps to add challenge)
    addPlat(0,    groundY, 1100, TILE * 2, true);
    addPlat(1220, groundY, 1000, TILE * 2, true);
    addPlat(2380, groundY,  950, TILE * 2, true);
    addPlat(3490, groundY,  910, TILE * 2, true);

    // Floating platforms
    const platDefs = [
      { x: 200,  y: groundY - TILE * 3,  w: TILE * 4 },
      { x: 520,  y: groundY - TILE * 4,  w: TILE * 3 },
      { x: 800,  y: groundY - TILE * 3,  w: TILE * 4 },
      { x: 1100, y: groundY - TILE * 3,  w: TILE * 3 },
      { x: 1280, y: groundY - TILE * 5,  w: TILE * 4 },
      { x: 1620, y: groundY - TILE * 3,  w: TILE * 4 },
      { x: 1900, y: groundY - TILE * 4,  w: TILE * 3 },
      { x: 2160, y: groundY - TILE * 3,  w: TILE * 4 },
      { x: 2440, y: groundY - TILE * 4,  w: TILE * 4 },
      { x: 2780, y: groundY - TILE * 5,  w: TILE * 3 },
      { x: 3050, y: groundY - TILE * 3,  w: TILE * 4 },
      { x: 3350, y: groundY - TILE * 4,  w: TILE * 3 },
      { x: 3560, y: groundY - TILE * 5,  w: TILE * 4 },
      { x: 3900, y: groundY - TILE * 3,  w: TILE * 4 },
      { x: 4150, y: groundY - TILE * 4,  w: TILE * 4 },
    ];
    for (const p of platDefs) addPlat(p.x, p.y, p.w, TILE + 8, false);

    // Question blocks
    let qi = 0;
    const qDefs = [
      { x: 250,  y: groundY - TILE * 5 },
      { x: 560,  y: groundY - TILE * 7 },
      { x: 830,  y: groundY - TILE * 6 },
      { x: 1130, y: groundY - TILE * 5 },
      { x: 1320, y: groundY - TILE * 8 },
      { x: 1660, y: groundY - TILE * 6 },
      { x: 1940, y: groundY - TILE * 7 },
      { x: 2200, y: groundY - TILE * 5 },
      { x: 2480, y: groundY - TILE * 7 },
      { x: 2820, y: groundY - TILE * 8 },
      { x: 3090, y: groundY - TILE * 6 },
      { x: 3390, y: groundY - TILE * 7 },
      { x: 3600, y: groundY - TILE * 8 },
      { x: 3940, y: groundY - TILE * 6 },
      { x: 4190, y: groundY - TILE * 7 },
    ];
    for (const qd of qDefs) {
      const q = questions[qi % questions.length]; qi++;
      qBlocks.push(new QuestionBlock(parent, qd.x, qd.y, q));
    }

    // Enemies
    const eDefs = [
      { x: 380,  patL: 240,  patR: 640  },
      { x: 870,  patL: 800,  patR: 1060 },
      { x: 1340, patL: 1230, patR: 1600 },
      { x: 1690, patL: 1630, patR: 1880 },
      { x: 2460, patL: 2390, patR: 2760 },
      { x: 2850, patL: 2790, patR: 3030 },
      { x: 3140, patL: 3060, patR: 3330 },
      { x: 3640, patL: 3500, patR: 3890 },
      { x: 4000, patL: 3910, patR: 4200 },
    ];
    for (const ed of eDefs) {
      enemies.push(new Enemy(parent, ed.x, groundY, ed.patL, ed.patR));
    }

    // Goal flag
    const fg = new PIXI.Graphics();
    fg.lineStyle(5, 0xBDBDBD);
    fg.moveTo(4330 + 20, groundY - TILE * 7);
    fg.lineTo(4330 + 20, groundY);
    fg.lineStyle(0);
    fg.beginFill(0x66BB6A);
    fg.drawRect(4330 + 20, groundY - TILE * 7, 52, 36);
    fg.endFill();
    fg.beginFill(0xFFFFFF);
    fg.drawRect(4330 + 24, groundY - TILE * 7 + 6, 20, 24);
    fg.endFill();
    parent.addChild(fg);
    const flagLabel = new PIXI.Text('🏁', { fontSize: 30 });
    flagLabel.x = 4330 + 18;
    flagLabel.y = groundY - TILE * 7 - 2;
    parent.addChild(flagLabel);

    const goalZone = { x: 4315, y: groundY - TILE * 7, w: 90, h: TILE * 8 };
    return { platforms, qBlocks, enemies, goalZone };
  }

  // ── Player ───────────────────────────────────────────────────────────────────
  class Player {
    constructor(parent, x, y, onDamage) {
      this.x = x; this.y = y;
      this.vx = 0; this.vy = 0;
      this.w = 36; this.h = 48;
      this.onGround  = false;
      this.facing    = 1;
      this.animT     = 0;
      this.hurtTimer = 0;
      this.jumpsLeft = 2;
      this._onDamage = onDamage || null;

      this.cont = new PIXI.Container();
      this.cont.x = x; this.cont.y = y;
      parent.addChild(this.cont);

      this.gfx = new PIXI.Graphics();
      this.cont.addChild(this.gfx);
      drawPlayerShape(this.gfx, 1, false, true, 0, false);
    }

    get bounds() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

    takeDamage() {
      if (this.hurtTimer > 0) return;
      this.hurtTimer = 1.8;
      this.vy = JUMP_VY * 0.45;
      SFX.hurt();
      if (this._onDamage) this._onDamage();
    }

    update(dt, input, platforms, qBlocks, onBlockHit, enemies, onStomp) {
      // hurt flash
      if (this.hurtTimer > 0) {
        this.hurtTimer -= dt;
        this.cont.alpha = Math.floor(this.hurtTimer * 9) % 2 === 0 ? 0.25 : 1;
      } else {
        this.cont.alpha = 1;
      }

      // input
      const goLeft  = input.isKeyDown('ArrowLeft')  || input.isKeyDown('KeyA');
      const goRight = input.isKeyDown('ArrowRight') || input.isKeyDown('KeyD');
      const doJump  = input.isKeyJustPressed('ArrowUp') || input.isKeyJustPressed('KeyW') || input.isKeyJustPressed('ShiftLeft') || input.isKeyJustPressed('ShiftRight');

      if (goLeft)       { this.vx = -WALK_SPD; this.facing = -1; }
      else if (goRight) { this.vx =  WALK_SPD; this.facing =  1; }
      else              { this.vx *= 0.78; }

      if (this.onGround) this.jumpsLeft = 2;

      if (doJump && this.jumpsLeft > 0) {
        const isDoubleJump = this.jumpsLeft === 1;
        this.vy = isDoubleJump ? JUMP_VY * 1.25 : JUMP_VY;
        this.onGround = false;
        this.jumpsLeft--;
        if (isDoubleJump) SFX.dblJump(); else SFX.jump();
      }

      // gravity
      this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);

      // move X
      this.x = Math.max(0, Math.min(WORLD_W - this.w, this.x + this.vx * dt));

      // platform collision X
      for (const p of platforms) {
        if (!overlaps(this.x, this.y, this.w, this.h, p.x, p.y, p.w, p.h)) continue;
        if (this.vx > 0) this.x = p.x - this.w;
        else             this.x = p.x + p.w;
        this.vx = 0;
      }

      // move Y
      this.onGround = false;
      this.y += this.vy * dt;

      // platform collision Y
      for (const p of platforms) {
        if (!overlaps(this.x, this.y, this.w, this.h, p.x, p.y, p.w, p.h)) continue;
        if (this.vy > 0) {
          this.y = p.y - this.h;
          this.vy = 0;
          this.onGround = true;
        } else if (this.vy < 0) {
          this.y = p.y + p.h;
          this.vy = 0;
        }
      }

      // question block collision
      for (const qb of qBlocks) {
        const b = qb.bounds;
        if (!overlaps(this.x, this.y, this.w, this.h, b.x, b.y, b.w, b.h)) continue;
        if (this.vy < 0) {
          this.y = b.y + b.h;
          this.vy = 0;
          if (qb.triggerHit()) onBlockHit(qb);
        } else if (this.vy > 0) {
          this.y = b.y - this.h;
          this.vy = 0;
          this.onGround = true;
        } else {
          if (this.x + this.w / 2 < b.x + b.w / 2) this.x = b.x - this.w;
          else this.x = b.x + b.w;
          this.vx = 0;
        }
      }

      // enemy collision
      for (const e of enemies) {
        if (!e.alive || e.squished) continue;
        const eb = e.bounds;
        if (!overlaps(this.x, this.y, this.w, this.h, eb.x, eb.y, eb.w, eb.h)) continue;
        const prevBottom = (this.y - this.vy * dt) + this.h;
        if (this.vy > 50 && prevBottom <= eb.y + 10) {
          e.squish();
          this.vy = JUMP_VY * 0.42;
          onStomp();
        } else {
          this.takeDamage();
        }
      }

      // fall respawn
      if (this.y > _screenH + 120) {
        this.x = 120; this.y = _screenH * 0.4;
        this.vx = 0; this.vy = 0;
        this.hurtTimer = 1.5;
        this.jumpsLeft = 2;
      }

      if (Math.abs(this.vx) > 20) this.animT += dt;
      this.cont.x = this.x;
      this.cont.y = this.y;
      drawPlayerShape(this.gfx, this.facing, Math.abs(this.vx) > 25 && this.onGround, this.onGround, this.animT, this.hurtTimer > 0);
    }
  }

  let _externalQuestions = null;

  // ── PlatformerScene ──────────────────────────────────────────────────────────
  class PlatformerScene extends GE_Scene {
    constructor() {
      super('EduPlatformer');
      this._platforms  = [];
      this._qBlocks    = [];
      this._enemies    = [];
      this._coins      = [];
      this._bursts     = [];
      this._player     = null;
      this._world      = null;
      this._score          = 0;
      this._stomps         = 0;
      this._lives          = 3;
      this._timerSec       = 0;
      this._qAnswered      = 0;
      this._qTotal         = 15;
      this._correctAnswers = 0;
      this._gameEnded      = false;
    }

    _hudData() {
      return {
        score:    this._score,
        lives:    this._lives,
        timerSec: this._timerSec,
        qDone:    this._qAnswered,
        qTotal:   this._qTotal,
      };
    }

    create() {
      const app = this.engine.app;
      const W = app.screen.width;
      const H = app.screen.height;
      _screenH = H;

      this._world = new PIXI.Container();
      this._container.addChild(this._world);

      buildBackground(this._world, W, H);
      if (this._world._cloudTicker) {
        this.engine.Loop.add(this._world._cloudTicker);
        this._cloudTicker = this._world._cloudTicker;
      }

      const questions = _externalQuestions && _externalQuestions.length > 0
        ? _externalQuestions
        : this._defaultQuestions();
      const { platforms, qBlocks, enemies, goalZone } = buildLevel(this._world, H, questions);
      this._platforms = platforms;
      this._qBlocks   = qBlocks;
      this._enemies   = enemies;
      this._goalZone  = goalZone;
      this._qTotal    = questions.length;

      const groundY = H - TILE * 2;
      this._player = new Player(this._world, 120, groundY - 80, () => this._onPlayerDamage());

      updateHUD(this._hudData());
    }

    _defaultQuestions() {
      return [
        { text: '٥ × ٦ = ؟',                        options: ['٢٥', '٣٠', '٢٠', '٣٦'],                     answer: 1 },
        { text: 'عاصمة مصر؟',                       options: ['الإسكندرية', 'القاهرة', 'الأقصر', 'أسوان'],   answer: 1 },
        { text: '١٢ ÷ ٤ = ؟',                       options: ['٢', '٤', '٣', '٦'],                          answer: 2 },
        { text: 'كم يوماً في الأسبوع؟',             options: ['٥', '٦', '٨', '٧'],                          answer: 3 },
        { text: '٨ + ٧ = ؟',                        options: ['١٤', '١٦', '١٣', '١٥'],                       answer: 3 },
        { text: 'أكبر كوكب في المجموعة الشمسية؟',  options: ['زحل', 'الأرض', 'المشتري', 'نبتون'],           answer: 2 },
        { text: '٩ × ٩ = ؟',                        options: ['٧٢', '٧٨', '٨٤', '٨١'],                       answer: 3 },
        { text: 'ما لون الذهب؟',                    options: ['فضي', 'ذهبي', 'أزرق', 'أحمر'],                answer: 1 },
        { text: '٢٥ - ٨ = ؟',                       options: ['١٦', '١٨', '١٧', '١٥'],                       answer: 2 },
        { text: 'كم شهراً في السنة؟',               options: ['١٠', '١١', '١٣', '١٢'],                       answer: 3 },
        { text: 'عاصمة السعودية؟',                  options: ['جدة', 'مكة', 'الرياض', 'الدمام'],             answer: 2 },
        { text: '١٠٠ ÷ ٥ = ؟',                      options: ['١٥', '٢٥', '٢٠', '١٠'],                       answer: 2 },
        { text: 'كم ساعة في اليوم؟',                options: ['١٢', '٢٨', '٢٤', '٢٠'],                       answer: 2 },
        { text: 'أكبر محيط في العالم؟',             options: ['الأطلسي', 'الهندي', 'القطبي', 'الهادي'],      answer: 3 },
        { text: '٧ × ٨ = ؟',                        options: ['٤٩', '٦٣', '٥٦', '٤٨'],                       answer: 2 },
      ];
    }

    _onPlayerDamage() {
      if (this._gameEnded) return;
      this._lives = Math.max(0, this._lives - 1);
      updateHUD(this._hudData());
      if (this._lives === 0) this._triggerEnd(false);
    }

    _triggerEnd(won) {
      if (this._gameEnded) return;
      this._gameEnded = true;
      _questionActive = true;
      safeTimeout(() => {
        showEndModal(won, {
          score:          this._score,
          correctAnswers: this._correctAnswers,
          qTotal:         this._qTotal,
          timerSec:       this._timerSec,
        });
      }, won ? 700 : 1400);
    }

    _onBlockHit(qb) {
      _questionActive = true;
      showModal(qb.question, (correct) => {
        _questionActive = this._gameEnded;
        this._qAnswered++;
        if (correct) {
          this._correctAnswers++;
          this._score += 100;
          updateHUD(this._hudData());
          SFX.correct();
          const b = qb.bounds;
          for (let i = 0; i < 4; i++) {
            safeTimeout(() => {
              if (this._world && !this._world.destroyed) {
                this._coins.push(new Coin(this._world, b.x + TILE / 2, b.y));
              }
            }, i * 70);
          }
        } else {
          if (this._world && !this._world.destroyed) {
            this._bursts.push(new StarBurst(this._world, qb.bounds.x + TILE / 2, qb.bounds.y));
          }
          SFX.wrong();
        }
        if (this._qAnswered >= this._qTotal && !this._gameEnded) {
          this._triggerEnd(true);
        }
      });
    }

    _onStomp() {
      this._stomps++;
      this._score += 50;
      updateHUD(this._hudData());
      SFX.stomp();
    }

    update(delta) {
      if (!this.engine || !this.engine.Input) return;
      if (!_questionActive) {
        const prevSec = Math.floor(this._timerSec);
        this._timerSec += delta;
        if (Math.floor(this._timerSec) !== prevSec) {
          const timerEl = document.getElementById('ep-timer');
          if (timerEl) {
            const m = String(Math.floor(this._timerSec / 60)).padStart(2, '0');
            const s = String(Math.floor(this._timerSec % 60)).padStart(2, '0');
            timerEl.textContent = m + ':' + s;
          }
        }
      }
      if (_questionActive) return;

      const W = this.engine.app.screen.width;

      this._player.update(
        delta, this.engine.Input,
        this._platforms, this._qBlocks,
        (qb) => this._onBlockHit(qb),
        this._enemies,
        () => this._onStomp()
      );

      for (const e of this._enemies)  e.update(delta, this._platforms);
      for (const qb of this._qBlocks) qb.update(delta);

      this._coins = this._coins.filter(c => {
        const alive = c.update(delta);
        if (!alive && c.gfx.parent) c.gfx.destroy();
        return alive;
      });
      this._bursts = this._bursts.filter(b => b.update(delta));

      // Goal zone collision → Victory
      if (!this._gameEnded && this._goalZone) {
        const gz = this._goalZone;
        const pb = this._player.bounds;
        if (overlaps(pb.x, pb.y, pb.w, pb.h, gz.x, gz.y, gz.w, gz.h)) {
          SFX.coin(); SFX.coin();
          this._triggerEnd(true);
        }
      }

      // Camera follow (horizontal only)
      const targetX  = W / 2 - this._player.x - this._player.w / 2;
      const clampedX = Math.min(0, Math.max(W - WORLD_W, targetX));
      this._world.x += (clampedX - this._world.x) * 0.13;
    }

    destroy() {
      clearAllTimeouts();
      if (this._cloudTicker && this.engine && this.engine.Loop) {
        this.engine.Loop.remove(this._cloudTicker);
      }
      super.destroy();
    }
  }

  // ── DOM Helpers ───────────────────────────────────────────────────────────────
  const ARABIC_LETTERS = ['أ', 'ب', 'ج', 'د'];

  function showModal(q, callback) {
    const modal = document.getElementById('ep-modal');
    const text  = document.getElementById('ep-q-text');
    const opts  = document.getElementById('ep-q-opts');
    if (!modal) { callback(false); return; }
    text.textContent = q.text;
    opts.innerHTML   = '';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'ep-opt';

      const badge = document.createElement('span');
      badge.className   = 'ep-opt-letter';
      badge.textContent = ARABIC_LETTERS[i] + '.';

      const label = document.createElement('span');
      label.textContent = opt;

      btn.appendChild(badge);
      btn.appendChild(label);

      btn.addEventListener('click', () => {
        const ok = (i === q.answer);
        btn.classList.add(ok ? 'ep-opt-ok' : 'ep-opt-err');
        opts.querySelectorAll('.ep-opt').forEach(b => b.disabled = true);
        safeTimeout(() => {
          modal.style.display = 'none';
          callback(ok);
        }, 750);
      });
      opts.appendChild(btn);
    });
    modal.style.display = 'flex';
  }

  function updateHUD({ score = 0, lives = 3, timerSec = 0, qDone = 0, qTotal = 15 } = {}) {
    const scoreEl = document.getElementById('ep-score');
    if (scoreEl) scoreEl.textContent = score;

    const xpFill = document.getElementById('ep-xp-fill');
    const xpNum  = document.getElementById('ep-xp-num');
    if (xpFill) xpFill.style.width = Math.min(100, Math.round(score / 15)) + '%';
    if (xpNum)  xpNum.textContent  = score;

    const heartIds = ['ep-h1', 'ep-h2', 'ep-h3'];
    heartIds.forEach((id, idx) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (idx < lives) {
        el.classList.remove('ep-heart-lost');
      } else {
        el.classList.add('ep-heart-lost');
      }
    });

    const timerEl = document.getElementById('ep-timer');
    if (timerEl) {
      const m = String(Math.floor(timerSec / 60)).padStart(2, '0');
      const s = String(Math.floor(timerSec % 60)).padStart(2, '0');
      timerEl.textContent = m + ':' + s;
    }

    const qDoneEl  = document.getElementById('ep-q-done');
    const qTotalEl = document.getElementById('ep-q-total');
    if (qDoneEl)  qDoneEl.textContent  = qDone;
    if (qTotalEl) qTotalEl.textContent = qTotal;
  }

  // ── Touch Controls ────────────────────────────────────────────────────────────
  function setupTouch(input) {
    function press(k) {
      switch (k) {
        case 'left':  input._keys.set('ArrowLeft',  true); break;
        case 'right': input._keys.set('ArrowRight', true); break;
        case 'jump':
          input._keys.set('ShiftLeft', true);
          input._keysJustPressed.add('ShiftLeft');
          break;
      }
    }
    function release(k) {
      switch (k) {
        case 'left':  input._keys.set('ArrowLeft',  false); break;
        case 'right': input._keys.set('ArrowRight', false); break;
        case 'jump':  input._keys.set('ShiftLeft',   false); break;
      }
    }
    document.querySelectorAll('.ep-touch-btn').forEach(btn => {
      const k = btn.dataset.key;
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); press(k); },   { passive: false });
      btn.addEventListener('touchend',   (e) => { e.preventDefault(); release(k); }, { passive: false });
      btn.addEventListener('mousedown',  () => press(k));
      btn.addEventListener('mouseup',    () => release(k));
      btn.addEventListener('mouseleave', () => release(k));
    });
  }

  // ── Quiz loader helpers ───────────────────────────────────────────────────────
  function _normalizeQuestions(apiQuestions) {
    return apiQuestions.map(q => {
      const rawOpts = Array.isArray(q.options) ? q.options : [];
      const options = rawOpts.map(o =>
        typeof o === 'string' ? o : (o && (o.text || o.label || o.value || String(o)))
      ).filter(Boolean);
      return {
        text:    q.text || q.question || '',
        options,
        answer:  typeof q.correctAnswer === 'number' ? q.correctAnswer
               : typeof q.answer        === 'number' ? q.answer : 0
      };
    }).filter(q => q.text && q.options.length >= 2);
  }

  async function _loadStartModal() {
    const overlay   = document.getElementById('ep-start-modal');
    const selectEl  = document.getElementById('ep-quiz-select');
    const startBtn  = document.getElementById('ep-start-btn');
    if (!overlay || !selectEl || !startBtn) return null;

    const tempApi = new GE_EducationalAPI();
    let quizList = [];

    try {
      const res = await fetch('/api/quizzes');
      if (res.ok) {
        const data = await res.json();
        quizList = Array.isArray(data) ? data : (data.quizzes || []);
      }
    } catch (_) {}

    selectEl.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '__default__';
    defaultOpt.textContent = '⭐ أسئلة افتراضية (رياضيات + جغرافيا)';
    selectEl.appendChild(defaultOpt);

    quizList.forEach(q => {
      const opt = document.createElement('option');
      opt.value = q.id || q._id || '';
      opt.textContent = q.name || q.title || 'اختبار';
      selectEl.appendChild(opt);
    });

    startBtn.disabled = false;

    return new Promise((resolve) => {
      startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        startBtn.innerHTML = '<span class="ep-start-btn-icon">⏳</span> جاري التحميل...';

        const selectedId = selectEl.value;
        let questions = null;

        if (selectedId && selectedId !== '__default__') {
          try {
            const res = await fetch(`/api/quizzes/${selectedId}`);
            if (res.ok) {
              const data = await res.json();
              const raw = Array.isArray(data.questions) ? data.questions : [];
              if (raw.length > 0) questions = _normalizeQuestions(raw);
            }
          } catch (_) {}
        }

        _externalQuestions = questions;

        overlay.style.transition = 'opacity 0.35s ease';
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.classList.add('ep-hidden'); }, 350);
        resolve();
      });
    });
  }

  // ── End Modal ─────────────────────────────────────────────────────────────────
  function showEndModal(won, { score, correctAnswers, qTotal, timerSec }) {
    const overlay = document.getElementById('ep-end-modal');
    if (!overlay) return;

    document.getElementById('ep-end-icon').textContent  = won ? '🏆' : '💀';
    document.getElementById('ep-end-title').textContent = won ? '!أحسنت 🎉' : '!انتهت المحاولات';
    document.getElementById('ep-end-sub').textContent   = won
      ? 'أكملت المغامرة بنجاح!'
      : 'لا تستسلم! حاول مرة أخرى';

    document.getElementById('ep-end-score').textContent   = score;
    document.getElementById('ep-end-correct').textContent = correctAnswers + '/' + qTotal;

    const m = String(Math.floor(timerSec / 60)).padStart(2, '0');
    const s = String(Math.floor(timerSec % 60)).padStart(2, '0');
    document.getElementById('ep-end-time').textContent = m + ':' + s;

    const acc = qTotal > 0 ? Math.round(correctAnswers / qTotal * 100) : 0;
    document.getElementById('ep-end-acc').textContent = acc + '%';

    overlay.classList.remove('ep-hidden', 'ep-end-won', 'ep-end-lost');
    overlay.classList.add(won ? 'ep-end-won' : 'ep-end-lost');

    SFX.stopBGM();
    if (won) SFX.levelUp(); else SFX.wrong();

    const retryBtn = document.getElementById('ep-end-retry');
    const exitBtn  = document.getElementById('ep-end-exit');
    if (retryBtn) retryBtn.addEventListener('click', () => location.reload());
    if (exitBtn)  exitBtn.addEventListener('click',  () => history.back());
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  async function init() {
    if (!document.getElementById('ep-canvas')) return;
    try {
      await _loadStartModal();

      _engine = await GameEngine.init({ container: 'ep-canvas', backgroundColor: 0x000000 });

      const scene = new PlatformerScene();
      _engine.Scenes.register('main', scene);
      await _engine.Scenes.switchTo('main');

      setupTouch(_engine.Input);
      SFX.init();
      SFX.startBGM();

      // Back button
      const epBackBtn = document.getElementById('ep-back-btn');
      if (epBackBtn) epBackBtn.addEventListener('click', () => history.back());

      // Fullscreen button
      const epFsBtn = document.getElementById('ep-fs-btn');
      if (epFsBtn) {
        epFsBtn.addEventListener('click', () => {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
            epFsBtn.textContent = '✕';
            epFsBtn.title = 'خروج من ملء الشاشة';
          } else {
            document.exitFullscreen().catch(() => {});
          }
        });
        document.addEventListener('fullscreenchange', () => {
          if (!document.fullscreenElement) {
            epFsBtn.textContent = '⛶';
            epFsBtn.title = 'ملء الشاشة';
          }
        });
      }

      // Hide global floating controls while in this game
      const gfc = document.getElementById('geFloatingControls');
      if (gfc) gfc.style.display = 'none';

      const _resizeCanvas = () => {
        const cont = document.getElementById('ep-canvas');
        if (!cont || !_engine || !_engine.app) return;
        const W = cont.clientWidth;
        const H = cont.clientHeight;
        if (W > 0 && H > 0) {
          _engine.app.renderer.resize(W, H);
          _screenH = H;
        }
      };
      window.addEventListener('resize', _resizeCanvas);
      setTimeout(_resizeCanvas, 100);

      window.addEventListener('hashchange', () => {
        clearAllTimeouts();
        _questionActive = false;
        SFX.stopBGM();
        const modal = document.getElementById('ep-modal');
        if (modal) modal.style.display = 'none';
      }, { once: true });

      console.log('[EduPlatformer] Ready ✓');
    } catch (err) {
      console.error('[EduPlatformer] Init error:', err);
    }
  }

  if (document.readyState !== 'loading') init();
  else window.addEventListener('DOMContentLoaded', init);
})();
