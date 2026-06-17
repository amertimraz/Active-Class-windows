/**
 * Tug Quiz — Game Engine Integration v2
 * ════════════════════════════════════════
 * Visual: Clean white arena, two illustrated figures per team, black rope, red flag
 * Audio:  Energetic background music + rich SFX via Web Audio API
 * Engine: GameEngine.init() → PixiJS, Loop, Scenes, Audio, EduAPI
 * Board:  1920×1080 Smart Board optimised, full touch support
 */
(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────
  const ROPE_MAX       = 5;     // rope range in each direction
  const DOTS_COUNT     = 5;     // progress dots per team
  const RESULT_SHOW_MS = 2200;  // ms overlay visible between rounds
  const NEXT_ROUND_MS  = 400;   // ms after overlay hides → new round
  const ROPE_LERP      = 0.06;  // flag lerp speed per frame
  const PULL_DURATION  = 0.85;  // seconds for the pull animation
  const POINTS_WIN     = 100;   // EduAPI points for a correct answer
  const POINTS_FASTEST = 150;   // EduAPI points when also fastest

  // ─── Shared engine reference ────────────────────────────────────────────────
  let engine    = null;
  let musicEng  = null; // TugMusicEngine instance

  // ─── Game state ─────────────────────────────────────────────────────────────
  const state = {
    phase:           'setup',   // setup | playing | round-result | game-over
    ropePosition:    0,         // −ROPE_MAX … +ROPE_MAX
    timerSeconds:    15,
    timerRemaining:  15,
    timerInterval:   null,
    roundNumber:     0,
    questionMode:    'mixed',
    currentQuestion: null,
    roundStartTime:  0,
    blue: { name: 'Team 1', score: 0, answer: '', submitted: false, submitTime: null, correct: false },
    red:  { name: 'Team 2', score: 0, answer: '', submitted: false, submitTime: null, correct: false }
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  TugMusicEngine — synthesised energetic background music
  // ════════════════════════════════════════════════════════════════════════════
  class TugMusicEngine {
    constructor() {
      this._ctx        = null;
      this._gain       = null;
      this._playing    = false;
      this._timer      = null;
      this._beat       = 0;
      this._nextTime   = 0;
      const BPM        = 132;
      this._stepLen    = (60 / BPM) / 4; // 16th-note duration in seconds

      // 16-step patterns  (freq, gain)  — 0 = rest
      this._melody = [
        [523.25,0.07],[0,0],[659.25,0.06],[783.99,0.07],
        [880.00,0.07],[0,0],[783.99,0.06],[659.25,0.06],
        [523.25,0.07],[0,0],[440.00,0.06],[523.25,0.07],
        [659.25,0.07],[523.25,0.05],[392.00,0.05],[0,0]
      ];
      this._bass = [
        [130.81,0.11],[0,0],[130.81,0.08],[0,0],
        [98.00, 0.11],[0,0],[98.00, 0.08],[0,0],
        [110.00,0.11],[0,0],[110.00,0.08],[0,0],
        [98.00, 0.09],[0,0],[73.42, 0.09],[0,0]
      ];
    }

    start(audioEngine) {
      try {
        const ctx = audioEngine._ensureContext();
        if (!ctx) return;
        this._ctx  = ctx;
        this._gain = ctx.createGain();
        this._gain.gain.value = 0.20;
        this._gain.connect(ctx.destination);
        this._playing  = true;
        this._beat     = 0;
        this._nextTime = ctx.currentTime + 0.08;
        const tick = () => {
          if (!this._playing) return;
          while (this._nextTime < this._ctx.currentTime + 0.18) {
            this._step(this._beat, this._nextTime);
            this._nextTime += this._stepLen;
            this._beat = (this._beat + 1) % 16;
          }
        };
        tick();
        this._timer = setInterval(tick, 50);
      } catch (e) { console.warn('[TugMusic] start error:', e); }
    }

    stop() {
      this._playing = false;
      clearInterval(this._timer);
      if (this._gain && this._ctx) {
        try {
          this._gain.gain.linearRampToValueAtTime(0, this._ctx.currentTime + 0.8);
        } catch (e) {}
      }
    }

    _step(b, t) {
      const [mf, mg] = this._melody[b];
      const [bf, bg] = this._bass[b];
      const dur = this._stepLen * 0.82;
      if (mf > 0) this._tone(mf, t, dur, 'square',   mg);
      if (bf > 0) this._tone(bf, t, dur, 'sawtooth', bg);
      if (b % 4 === 0)       this._kick(t);
      if (b % 8 === 4)       this._snare(t);
      if (b % 2 === 1)       this._hihat(t);
    }

    _tone(freq, t, dur, type, vol) {
      if (!this._gain) return;
      const osc = this._ctx.createOscillator();
      const g   = this._ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g); g.connect(this._gain);
      osc.start(t); osc.stop(t + dur + 0.01);
    }

    _kick(t) {
      if (!this._gain) return;
      const osc = this._ctx.createOscillator();
      const g   = this._ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.42, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(g); g.connect(this._gain);
      osc.start(t); osc.stop(t + 0.16);
    }

    _snare(t) {
      if (!this._gain) return;
      const len = Math.floor(this._ctx.sampleRate * 0.12);
      const buf = this._ctx.createBuffer(1, len, this._ctx.sampleRate);
      const d   = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src  = this._ctx.createBufferSource();
      src.buffer = buf;
      const flt  = this._ctx.createBiquadFilter();
      flt.type = 'highpass'; flt.frequency.value = 2200;
      const g = this._ctx.createGain();
      g.gain.setValueAtTime(0.24, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      src.connect(flt); flt.connect(g); g.connect(this._gain);
      src.start(t); src.stop(t + 0.13);
    }

    _hihat(t) {
      if (!this._gain) return;
      const len = Math.floor(this._ctx.sampleRate * 0.035);
      const buf = this._ctx.createBuffer(1, len, this._ctx.sampleRate);
      const d   = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src  = this._ctx.createBufferSource();
      src.buffer = buf;
      const flt  = this._ctx.createBiquadFilter();
      flt.type = 'highpass'; flt.frequency.value = 9000;
      const g = this._ctx.createGain();
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      src.connect(flt); flt.connect(g); g.connect(this._gain);
      src.start(t); src.stop(t + 0.04);
    }
  }

  // ─── Pending timeouts — cleared on cleanup ──────────────────────────────────
  const _timeouts = [];
  function _after(fn, ms) {
    const id = setTimeout(() => { _timeouts.splice(_timeouts.indexOf(id), 1); fn(); }, ms);
    _timeouts.push(id);
  }
  function _clearAll() {
    _timeouts.forEach(clearTimeout);
    _timeouts.length = 0;
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  TugArenaScene — extends GE_Scene
  //  Clean white arena: dashed center line, black rope, two illustrated
  //  figures per team with coloured clothing, red flag, particle FX
  // ════════════════════════════════════════════════════════════════════════════
  class TugArenaScene extends GE_Scene {
    constructor() {
      super('TugArena');
      this._bgGfx    = null; // static background — drawn once
      this._charGfx  = null; // PIXI.Container — holds 4 character sub-containers
      this._charDefs = null; // array of { con, gfx, team, cx, scale }
      this._ropeGfx  = null; // rope + flag — redrawn every frame
      this._fxLayer  = null; // PIXI.Container for particles & pops

      this._ropeCurrX    = 0;
      this._ropeTargetX  = 0;
      this._pullAnim     = null; // { team, life:0..1 }
      this._time         = 0;
      // Hand world-space positions — set each frame by _drawCharacters, read by _drawRope
      this._blueHandWorld = { x: 0, y: 0 };
      this._redHandWorld  = { x: 0, y: 0 };
    }

    // ── create ───────────────────────────────────────────────────────────────
    create() {
      const { width: W, height: H } = this.engine.app.renderer;

      this._bgGfx   = new PIXI.Graphics();
      this._charGfx = new PIXI.Container();
      this._ropeGfx = new PIXI.Graphics();
      this._fxLayer = new PIXI.Container();

      // z-order: bg → chars → rope → fx
      this._container.addChild(this._bgGfx, this._charGfx, this._ropeGfx, this._fxLayer);

      this._drawBackground(W, H);
      this._ropeCurrX = this._ropeTargetX = W / 2;

      // One character per side — each owns its PIXI.Container (rotation via PIXI)
      const groundY = H * 0.78;
      const defs = [
        { cx: W * 0.22, team: 'blue', scale: 1.00 },
        { cx: W * 0.78, team: 'red',  scale: 1.00 },
      ];
      this._charDefs = defs.map(d => {
        const con = new PIXI.Container();
        const gfx = new PIXI.Graphics();
        con.addChild(gfx);
        con.x = d.cx;
        con.y = groundY;
        this._charGfx.addChild(con);
        return { con, gfx, team: d.team, cx: d.cx, scale: d.scale };
      });
    }

    // ── update ───────────────────────────────────────────────────────────────
    update(delta) {
      const { width: W, height: H } = this.engine.app.renderer;
      this._time += delta;

      // Lerp rope flag
      this._ropeCurrX += (this._ropeTargetX - this._ropeCurrX) * ROPE_LERP;

      // Advance pull animation
      let pullPhase = 0;
      if (this._pullAnim) {
        this._pullAnim.life -= delta / PULL_DURATION;
        if (this._pullAnim.life <= 0) this._pullAnim = null;
        else pullPhase = Math.sin(this._pullAnim.life * Math.PI);
      }

      // Redraw dynamic layers
      this._ropeGfx.clear();
      this._drawRope(W, H, this._ropeCurrX, pullPhase);
      this._drawCharacters(W, H, pullPhase);
    }

    // ── Public API ──────────────────────────────────────────────────────────
    /**
     * Move the rope flag to the position corresponding to ropePosition (−5…+5).
     * Called after every round evaluation.
     */
    setRopeTarget(ropePosition) {
      const W = this.engine.app.renderer.width;
      const center     = W / 2;
      const halfTravel = W * 0.38; // max flag displacement from center
      this._ropeTargetX = center + (ropePosition / ROPE_MAX) * halfTravel;
    }

    /**
     * Trigger the pull-back lean animation for the winning team.
     * @param {'blue'|'red'} team
     */
    triggerPull(team) {
      this._pullAnim = { team, life: 1 };
    }

    /**
     * Spawn a particle burst at a canvas position.
     * @param {number} x
     * @param {number} y
     * @param {number} color   0xRRGGBB
     * @param {number} [count]
     */
    spawnBurst(x, y, color, count = 14) {
      const particles = [];
      for (let i = 0; i < count; i++) {
        const g = new PIXI.Graphics();
        g.beginFill(color, 1);
        g.drawCircle(0, 0, Math.random() * 4 + 2);
        g.endFill();
        g.x = x;
        g.y = y;
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const speed = Math.random() * 130 + 60;
        g._vx   = Math.cos(angle) * speed;
        g._vy   = Math.sin(angle) * speed - 90;
        g._life = 1;
        this._fxLayer.addChild(g);
        particles.push(g);
      }

      let elapsed = 0;
      const tick = (delta) => {
        elapsed += delta;
        let alive = false;
        for (const p of particles) {
          if (p._life <= 0 || p.destroyed) continue;
          alive = true;
          p._vy   += 220 * delta;
          p.x     += p._vx * delta;
          p.y     += p._vy * delta;
          p._life -= delta * 1.6;
          p.alpha  = Math.max(0, p._life);
          p.scale.set(Math.max(0, p._life));
        }
        if (!alive || elapsed > 1.5) {
          engine && engine.Loop && engine.Loop.remove(tick);
          for (const p of particles) { try { if (!p.destroyed) p.destroy(); } catch (e) {} }
        }
      };
      engine && engine.Loop && engine.Loop.add(tick);
    }

    /**
     * Show a floating score/text pop in the canvas.
     * @param {number} x
     * @param {number} y
     * @param {string} text
     * @param {number} [color]
     */
    spawnTextPop(x, y, text, color = 0xffd700) {
      const label = new PIXI.Text(text, {
        fontFamily:      'Cairo, Arial',
        fontSize:        32,
        fontWeight:      'bold',
        fill:            color,
        stroke:          0x000000,
        strokeThickness: 3
      });
      label.anchor.set(0.5, 0.5);
      label.x = x;
      label.y = y;
      this._fxLayer.addChild(label);

      let elapsed = 0;
      const tick = (delta) => {
        elapsed += delta;
        if (label.destroyed) { engine && engine.Loop && engine.Loop.remove(tick); return; }
        label.y     -= 55 * delta;
        label.alpha  = Math.max(0, 1 - elapsed * 1.4);
        label.scale.set(1 + elapsed * 0.25);
        if (elapsed > 0.9) {
          engine && engine.Loop && engine.Loop.remove(tick);
          try { if (!label.destroyed) label.destroy(); } catch (e) {}
        }
      };
      engine && engine.Loop && engine.Loop.add(tick);
    }

    /**
     * Canvas X position of the center of a team's character.
     * Used to place particles at the right location.
     * @param {'blue'|'red'} team
     */
    charX(team) {
      const W = this.engine.app.renderer.width;
      return team === 'blue' ? W * 0.19 : W * 0.81; // midpoint of 2-figure group
    }

    charY() {
      return this.engine.app.renderer.height * 0.60;
    }

    // ── Drawing helpers ──────────────────────────────────────────────────────

    // ── Drawing: static background ──────────────────────────────────────────
    _drawBackground(W, H) {
      const g = this._bgGfx;

      // White arena floor
      g.beginFill(0xfafafa);
      g.drawRect(0, 0, W, H);
      g.endFill();

      // Subtle light blue tint — blue team side
      g.beginFill(0xe3f2fd, 0.35);
      g.drawRect(0, 0, W * 0.48, H);
      g.endFill();

      // Subtle light red tint — red team side
      g.beginFill(0xffebee, 0.35);
      g.drawRect(W * 0.52, 0, W * 0.48, H);
      g.endFill();

      // Dashed vertical center line
      g.lineStyle(0);
      const dashH   = H / 22;
      const dashGap = dashH * 0.6;
      for (let y = 0; y < H; y += dashH + dashGap) {
        g.beginFill(0x9e9e9e, 0.45);
        g.drawRect(W / 2 - 2, y, 4, dashH);
        g.endFill();
      }

      // Ground strip (subtle)
      g.beginFill(0xeeeeee);
      g.drawRect(0, H * 0.80, W, H * 0.20);
      g.endFill();
      g.lineStyle(2, 0xbdbdbd, 0.8);
      g.moveTo(0, H * 0.78);
      g.lineTo(W, H * 0.78);
      g.lineStyle(0);
    }

    // ── Drawing: rope + flag — endpoints follow the characters' hands ──────────
    _drawRope(W, H, flagX, pullPhase) {
      const g = this._ropeGfx;

      // Rope endpoints = character hand world positions (set by _drawCharacters)
      const lx = this._blueHandWorld.x;
      const ly = this._blueHandWorld.y;
      const rx = this._redHandWorld.x;
      const ry = this._redHandWorld.y;

      // Mid-control-point: average of endpoints + downward sag
      const midX = (lx + rx) * 0.5;
      const midY = (ly + ry) * 0.5 + 10 + pullPhase * 8;

      // ── Rope shadow ────────────────────────────────────────────────────
      g.lineStyle(11, 0x000000, 0.10);
      g.moveTo(lx, ly + 6);
      g.quadraticCurveTo(midX, midY + 9, rx, ry + 6);

      // ── Rope core (dark brown) ─────────────────────────────────────────
      g.lineStyle(11, 0x3e2723, 1);
      g.moveTo(lx, ly);
      g.quadraticCurveTo(midX, midY, rx, ry);

      // ── Rope highlight (lighter strand) ───────────────────────────────
      g.lineStyle(4, 0x6d4c41, 0.85);
      g.moveTo(lx, ly - 1);
      g.quadraticCurveTo(midX, midY - 1, rx, ry - 1);
      g.lineStyle(0);

      // ── Twist marks along rope ────────────────────────────────────────
      for (let t = 0.04; t <= 0.96; t += 0.040) {
        const u  = 1 - t;
        const bx = u * u * lx + 2 * u * t * midX + t * t * rx;
        const by = u * u * ly + 2 * u * t * midY + t * t * ry;
        // Rope is angled — get tangent to align marks
        const tx2 = 2 * (1 - t) * (midX - lx) + 2 * t * (rx - midX);
        const ty2 = 2 * (1 - t) * (midY - ly) + 2 * t * (ry - midY);
        const ang = Math.atan2(ty2, tx2);
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        // Draw small tick perpendicular to rope direction
        g.lineStyle(2.5, 0x4e342e, 0.55);
        g.moveTo(bx - sin * 5, by + cos * 5);
        g.lineTo(bx + sin * 5, by - cos * 5);
        g.lineStyle(0);
      }

      // ── Knot at each hand attachment point ────────────────────────────
      [{ x: lx, y: ly }, { x: rx, y: ry }].forEach(pt => {
        g.beginFill(0x3e2723, 0.92);
        g.drawCircle(pt.x, pt.y, 8);
        g.endFill();
        g.beginFill(0x6d4c41, 0.75);
        g.drawCircle(pt.x, pt.y, 4);
        g.endFill();
      });

      // ── Flag position: parameterised along the bezier ─────────────────
      // t corresponds to how far the flag is between left and right endpoints
      const tFlag = (lx === rx) ? 0.5 : Math.max(0.02, Math.min(0.98, (flagX - lx) / (rx - lx)));
      const uFlag = 1 - tFlag;
      const fBX = uFlag * uFlag * lx + 2 * uFlag * tFlag * midX + tFlag * tFlag * rx;
      const fBY = uFlag * uFlag * ly + 2 * uFlag * tFlag * midY + tFlag * tFlag * ry;

      // Flag pole hangs DOWN from rope
      const poleH = H * 0.092;
      g.beginFill(0xe0e0e0);
      g.drawRect(fBX - 3, fBY, 6, poleH);
      g.endFill();

      // Flag triangle (red, points right)
      const fW = H * 0.060;
      const fH = H * 0.044;
      const fT = fBY;
      g.beginFill(0xe53935);
      g.moveTo(fBX + 3, fT);
      g.lineTo(fBX + 3 + fW, fT + fH * 0.5);
      g.lineTo(fBX + 3, fT + fH);
      g.closePath();
      g.endFill();
    }

    // ── One character per side — idle pull animation + hand → rope attachment ─
    _drawCharacters(W, H, pullPhase) {
      const charH   = H * 0.42;
      const groundY = H * 0.78;

      // Idle oscillation constants
      const IDLE_FREQ = 0.46;  // Hz — pull cycle ≈ 2.2 s
      const IDLE_BASE = 7;     // degrees: constant backward lean
      const IDLE_AMP  = 5;     // degrees: oscillation amplitude
      const PHASES    = [0, 0.50]; // blue phase 0, red phase 0.5 (opposite rhythm)

      this._charDefs.forEach(({ con, gfx, team, cx, scale }, idx) => {
        const facesRight = team === 'blue';
        const dir        = facesRight ? 1 : -1;
        const H2         = charH * scale;

        // ── Idle oscillation: smooth back-and-forth pull ───────────────────
        const phOff    = PHASES[idx] * Math.PI * 2;
        const cycle    = 0.5 - 0.5 * Math.cos(this._time * IDLE_FREQ * Math.PI * 2 + phOff);
        const idleLean = IDLE_BASE + IDLE_AMP * cycle; // 7°…12°

        // Pull bonus when this team answered correctly
        const isPullTeam = this._pullAnim && this._pullAnim.team === team;
        const pullBonus  = isPullTeam ? pullPhase * 13 : 0;

        // Rope-position bonus: winning team leans back more, losing team less
        // ropePosition: -5 = blue wins, +5 = red wins
        const ropeTug   = (team === 'blue' ? -state.ropePosition : state.ropePosition);
        const ropeBonus = ropeTug * 1.2; // extra lean when winning (+), forward drag when losing (-)

        const totalLean = Math.max(2, Math.min(24, idleLean + pullBonus + ropeBonus));
        // Blue: CCW = negative rotation, Red: CW = positive rotation
        const leanRad = -dir * (totalLean * Math.PI / 180);

        // Subtle vertical bob
        const bob = Math.sin(this._time * IDLE_FREQ * Math.PI * 2 + phOff + Math.PI) * H * 0.004;

        con.x        = cx;
        con.y        = groundY + bob;
        con.rotation = leanRad;

        // ── Compute primary hand world position ────────────────────────────
        // These proportional values must match what _drawChar draws:
        const torsoW   = H2 * 0.152;
        const torsoH   = H2 * 0.255;
        const legH     = H2 * 0.268;
        const shoeH    = H2 * 0.050;
        const legBot   = -shoeH + H2 * 0.008;
        const legTop   = legBot - legH;
        const torsoBot = legTop + H2 * 0.016;
        const torsoTop = torsoBot - torsoH;

        // Local hand pos (upper arm endpoint — same values used in _drawChar)
        const localHX  = dir * torsoW * 2.26;
        const localHY  = torsoTop + torsoH * 0.18;

        // Transform to world space:  world = container_pos + Rotation * local
        const cosL = Math.cos(leanRad);
        const sinL = Math.sin(leanRad);
        const wHX  = cx + cosL * localHX - sinL * localHY;
        const wHY  = (groundY + bob) + sinL * localHX + cosL * localHY;

        // Store for _drawRope to use as rope endpoints
        if (team === 'blue') {
          this._blueHandWorld.x = wHX;
          this._blueHandWorld.y = wHY;
        } else {
          this._redHandWorld.x = wHX;
          this._redHandWorld.y = wHY;
        }

        // Draw character — arm goes to fixed local endpoint (rope bends to meet it)
        gfx.clear();
        if (team === 'blue') {
          this._drawChar(gfx, H2, 0x1e88e5, 0x1565c0, 0x64b5f6, 0x0d47a1, true);
        } else {
          this._drawChar(gfx, H2, 0xe53935, 0xc62828, 0xff8a65, 0xb71c1c, false);
        }
      });
    }

    /**
     * Draw one high-quality flat-design character.
     * Origin is at the character's feet (0, 0). All Y values go negative (upward).
     * PIXI.Container handles rotation externally — no manual rotation math needed.
     *
     * @param {PIXI.Graphics} g          — cleared and redrawn each frame
     * @param {number}  H                — character height in px
     * @param {number}  shirt            — shirt/body colour
     * @param {number}  pants            — trousers colour
     * @param {number}  accent           — shirt pattern/stripe colour
     * @param {number}  shoe             — shoe colour
     * @param {boolean} facesRight       — true = blue team, faces rope on the right
     */
    _drawChar(g, H, shirt, pants, accent, shoe, facesRight) {
      g.clear();

      const SKIN = 0xf5c5a3;
      const DARK = 0xd4956c; // shadow skin tone
      const HAT  = 0x1c1c1c;
      const dir  = facesRight ? 1 : -1;

      // ── Proportions ──────────────────────────────────────────────────────
      const headR  = H * 0.098;
      const torsoW = H * 0.152;
      const torsoH = H * 0.255;
      const legW   = H * 0.060;
      const legH   = H * 0.268;
      const shoeW  = H * 0.090;
      const shoeH  = H * 0.050;
      const neckH  = H * 0.050;
      const neckW  = H * 0.042;
      const armR   = H * 0.050;
      const domeW  = headR * 0.94;
      const domeH  = headR * 0.92;
      const brimH  = headR * 0.26;

      // Key Y positions (0 = ground, negative = up)
      const shoeTop  = -shoeH;
      const legBot   = shoeTop + H * 0.008;
      const legTop   = legBot - legH;
      const torsoBot = legTop + H * 0.016;
      const torsoTop = torsoBot - torsoH;
      const neckBot  = torsoTop + H * 0.008;
      const neckTop  = neckBot - neckH;
      const headCY   = neckTop - headR * 0.78;
      const hatBaseY = headCY - headR * 0.18;
      const hatTopY  = hatBaseY - domeH;

      // ── Ground shadow ──────────────────────────────────────────────────
      g.beginFill(0x000000, 0.10);
      g.drawEllipse(0, 2, H * 0.20, H * 0.032);
      g.endFill();

      // ── Back leg (wide tug-of-war stride, pushed backward) ────────────
      const backLX = -dir * legW * 1.35;
      g.beginFill(pants, 0.76);
      g.drawRoundedRect(backLX - legW, legBot - legH, legW * 2, legH, legW * 0.55);
      g.endFill();

      // ── Back shoe (toe faces backward — heel digs in) ─────────────────
      g.beginFill(shoe, 0.70);
      // Shoe extends toward the back (-dir direction)
      const bsToe = backLX - dir * shoeW * 0.80;
      g.drawRoundedRect(bsToe - shoeW * 0.60, shoeTop, shoeW * 1.72, shoeH, shoeH * 0.50);
      g.endFill();

      // ── Torso / shirt ─────────────────────────────────────────────────
      g.beginFill(shirt);
      g.drawRoundedRect(-torsoW, torsoTop, torsoW * 2, torsoH, torsoW * 0.24);
      g.endFill();

      // Shirt horizontal stripes (subtle)
      for (let i = 1; i <= 3; i++) {
        const sy = torsoTop + (torsoH / 4) * i;
        g.beginFill(accent, 0.20);
        g.drawRect(-torsoW * 0.82, sy - H * 0.008, torsoW * 1.64, H * 0.016);
        g.endFill();
      }

      // Dot pattern on shirt
      for (let row = 0; row < 2; row++) {
        for (let col = -1; col <= 1; col++) {
          g.beginFill(accent, 0.38);
          g.drawCircle(
            col * torsoW * 0.48,
            torsoTop + torsoH * (0.28 + row * 0.38),
            H * 0.016
          );
          g.endFill();
        }
      }

      // V-collar
      g.beginFill(0xffffff, 0.16);
      g.moveTo(-torsoW * 0.26, torsoTop + H * 0.004);
      g.lineTo(0, torsoTop + torsoH * 0.22);
      g.lineTo(torsoW * 0.26, torsoTop + H * 0.004);
      g.closePath();
      g.endFill();

      // ── Primary hand target — MUST match localHX/localHY in _drawCharacters ─
      // (These are the exact values used to compute the hand world position,
      //  so the rope endpoint and the arm endpoint coincide perfectly.)
      const handX = dir * torsoW * 2.26;
      const handY = torsoTop + torsoH * 0.18;

      // ── Lower arm — second hand, slightly behind on rope (drawn first) ─────
      this._drawArm(g,
        dir * torsoW * 0.65, torsoTop + torsoH * 0.44,
        handX - dir * H * 0.068, handY,
        armR * 0.88, shirt, SKIN
      );

      // ── Front leg (stride toward rope) ────────────────────────────────
      const frontLX = dir * legW * 1.15;
      g.beginFill(pants);
      g.drawRoundedRect(frontLX - legW, legBot - legH, legW * 2, legH, legW * 0.55);
      g.endFill();

      // ── Front shoe (toe faces rope direction) ─────────────────────────
      g.beginFill(shoe);
      const fsToe = frontLX + dir * shoeW * 0.80;
      g.drawRoundedRect(fsToe - shoeW * (dir > 0 ? 0.40 : 1.32), shoeTop, shoeW * 1.72, shoeH, shoeH * 0.50);
      g.endFill();

      // ── Upper arm — primary hand on rope (drawn last = appears in front) ──
      this._drawArm(g,
        dir * torsoW * 0.82, torsoTop + torsoH * 0.20,
        handX, handY,
        armR, shirt, SKIN
      );

      // ── Neck ──────────────────────────────────────────────────────────
      g.beginFill(SKIN);
      g.drawRoundedRect(-neckW, neckBot - neckH, neckW * 2, neckH, neckW * 0.4);
      g.endFill();

      // ── Head ──────────────────────────────────────────────────────────
      // Head shadow side (subtle 3-D feel)
      g.beginFill(DARK, 0.22);
      g.drawCircle(-dir * headR * 0.28, headCY, headR * 0.82);
      g.endFill();
      // Main head
      g.beginFill(SKIN);
      g.drawCircle(0, headCY, headR);
      g.endFill();

      // Ear (facing away from rope)
      g.beginFill(SKIN);
      g.drawEllipse(-dir * headR * 0.90, headCY, headR * 0.20, headR * 0.30);
      g.endFill();
      g.beginFill(DARK, 0.45);
      g.drawEllipse(-dir * headR * 0.90, headCY, headR * 0.11, headR * 0.18);
      g.endFill();

      // ── Eyes ──────────────────────────────────────────────────────────
      const eyeX = dir * headR * 0.30;
      const eyeY = headCY - headR * 0.08;
      // Sclera
      g.beginFill(0xffffff);
      g.drawEllipse(eyeX, eyeY, headR * 0.27, headR * 0.22);
      g.endFill();
      // Iris
      g.beginFill(0x4a3728);
      g.drawCircle(eyeX + dir * headR * 0.06, eyeY, headR * 0.13);
      g.endFill();
      // Pupil
      g.beginFill(0x0a0a0a);
      g.drawCircle(eyeX + dir * headR * 0.08, eyeY, headR * 0.07);
      g.endFill();
      // Eye shine
      g.beginFill(0xffffff, 0.90);
      g.drawCircle(eyeX + dir * headR * 0.10, eyeY - headR * 0.04, headR * 0.04);
      g.endFill();
      // Eyelid top line
      g.lineStyle(H * 0.012, 0x3e2723, 0.80);
      g.moveTo(eyeX - headR * 0.26, eyeY - headR * 0.14);
      g.quadraticCurveTo(eyeX + dir * headR * 0.04, eyeY - headR * 0.26, eyeX + headR * 0.26, eyeY - headR * 0.10);
      g.lineStyle(0);

      // ── Eyebrow ───────────────────────────────────────────────────────
      g.lineStyle(H * 0.013, 0x3e2723, 1);
      g.moveTo(eyeX - headR * 0.28, headCY - headR * 0.30);
      g.lineTo(eyeX + headR * 0.28, headCY - headR * 0.32);
      g.lineStyle(0);

      // ── Nose (subtle) ─────────────────────────────────────────────────
      g.beginFill(DARK, 0.30);
      g.drawEllipse(dir * headR * 0.10, headCY + headR * 0.10, headR * 0.10, headR * 0.07);
      g.endFill();

      // ── Mouth ─────────────────────────────────────────────────────────
      g.lineStyle(H * 0.011, 0x8b5e52, 1);
      g.moveTo(dir * headR * 0.05, headCY + headR * 0.26);
      g.quadraticCurveTo(dir * headR * 0.22, headCY + headR * 0.36, dir * headR * 0.40, headCY + headR * 0.22);
      g.lineStyle(0);

      // Cheek blush
      g.beginFill(0xff8a65, 0.22);
      g.drawCircle(dir * headR * 0.62, headCY + headR * 0.10, headR * 0.22);
      g.endFill();

      // ── Hat ───────────────────────────────────────────────────────────
      // Brim (flat ellipse)
      g.beginFill(HAT);
      g.drawEllipse(0, hatBaseY, headR * 1.16, brimH);
      g.endFill();
      // Dome (rounded rectangle)
      g.beginFill(HAT);
      g.drawRoundedRect(-domeW, hatTopY, domeW * 2, domeH + brimH * 0.4, domeW * 0.44);
      g.endFill();
      // Hat sheen
      g.beginFill(0x555555, 0.30);
      g.drawEllipse(-domeW * 0.28, hatTopY + domeH * 0.18, domeW * 0.44, domeH * 0.22);
      g.endFill();
    }

    /**
     * Draw a two-segment arm: sleeve (shirt colour) + forearm/hand (skin colour).
     * Inputs are in the character's local coordinate space.
     */
    _drawArm(g, x1, y1, x2, y2, r, sleeveColor, skinColor) {
      const dx  = x2 - x1;
      const dy  = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) return;

      const nx = -dy / len;  // perpendicular normal X
      const ny =  dx / len;  // perpendicular normal Y

      const midX = x1 + dx * 0.52;
      const midY = y1 + dy * 0.52;
      const r2   = r * 0.90;  // forearm slightly thinner

      // Sleeve (shirt colour)
      g.beginFill(sleeveColor);
      g.drawPolygon([
        x1   + nx * r,    y1   + ny * r,
        x1   - nx * r,    y1   - ny * r,
        midX - nx * r2,   midY - ny * r2,
        midX + nx * r2,   midY + ny * r2,
      ]);
      g.endFill();
      // Joint cap
      g.beginFill(sleeveColor);
      g.drawCircle(x1, y1, r);
      g.endFill();

      // Forearm (skin colour)
      g.beginFill(skinColor);
      g.drawPolygon([
        midX + nx * r2,   midY + ny * r2,
        midX - nx * r2,   midY - ny * r2,
        x2   - nx * r2 * 0.72, y2 - ny * r2 * 0.72,
        x2   + nx * r2 * 0.72, y2 + ny * r2 * 0.72,
      ]);
      g.endFill();

      // Hand (rounded circle)
      g.beginFill(skinColor);
      g.drawCircle(x2, y2, r * 0.88);
      g.endFill();
      // Knuckle highlight
      g.beginFill(0xd4956c, 0.35);
      g.drawCircle(x2, y2, r * 0.48);
      g.endFill();
    }

    // ── Destroy ─────────────────────────────────────────────────────────────
    destroy() {
      super.destroy();
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  Math Question Generator
  // ════════════════════════════════════════════════════════════════════════════
  function generateQuestion(mode) {
    const opMap = { mixed: ['+','-','×','÷'], add: ['+'], sub: ['-'], mul: ['×'], div: ['÷'] };
    const ops   = opMap[mode] || opMap.mixed;
    const op    = ops[Math.floor(Math.random() * ops.length)];
    let a, b, answer;

    switch (op) {
      case '+': a = rand(5, 80);  b = rand(5, 80);  answer = a + b;  break;
      case '-': a = rand(20, 99); b = rand(1, a-1); answer = a - b;  break;
      case '×': a = rand(1, 12);  b = rand(1, 12);  answer = a * b;  break;
      case '÷': b = rand(2, 10);  answer = rand(1, 12); a = b * answer; break;
      default:  a = 1; b = 1; answer = 2;
    }
    return { text: `${a}  ${op}  ${b}  =  ?`, answer };
  }

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  // ════════════════════════════════════════════════════════════════════════════
  //  UI Helpers
  // ════════════════════════════════════════════════════════════════════════════
  function $(id) { return document.getElementById(id); }

  function showScreen(name) {
    ['tq-setup-screen', 'tq-game-screen', 'tq-gameover-screen'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.classList.toggle('tq-active', id === name);
    });
  }

  function displayQuestion(q) {
    const t = q ? q.text : '؟';
    const bq = $('tq-blue-question'); if (bq) bq.textContent = t;
    const rq = $('tq-red-question');  if (rq) rq.textContent = t;
  }

  function updateAnswerDisplay(team) {
    const el = $(`tq-${team}-answer-display`);
    if (el) el.textContent = state[team].answer || '0';
  }

  function setFeedback(team, type) {
    const wrap = $(`tq-${team}-answer-wrap`);
    if (!wrap) return;
    wrap.className = 'tq-answer-display tq-' + team + '-answer-display';
    if (type) wrap.classList.add('tq-answer-' + type);
  }

  function markSubmitted(team) {
    const panel = $(`tq-${team}-panel`);
    if (panel) panel.classList.add('tq-submitted');
    setFeedback(team, 'submitted');
  }

  function resetPanels() {
    ['blue', 'red'].forEach(team => {
      const panel = $(`tq-${team}-panel`);
      if (panel) panel.classList.remove('tq-submitted', 'tq-flash-correct', 'tq-flash-wrong');
      setFeedback(team, '');
      updateAnswerDisplay(team);
    });
  }

  function flashPanel(team, correct) {
    const panel = $(`tq-${team}-panel`);
    if (!panel) return;
    const cls = correct ? 'tq-flash-correct' : 'tq-flash-wrong';
    panel.classList.remove('tq-flash-correct', 'tq-flash-wrong');
    void panel.offsetWidth;
    panel.classList.add(cls);
    panel.addEventListener('animationend', () => panel.classList.remove(cls), { once: true });
    setFeedback(team, correct ? 'correct' : 'wrong');
  }

  function renderRopeDots() {
    const pos   = state.ropePosition;
    const blueC = $('tq-rope-dots-blue');
    const redC  = $('tq-rope-dots-red');

    if (blueC) {
      const filled = pos < 0 ? Math.abs(pos) : 0;
      blueC.innerHTML = Array.from({ length: DOTS_COUNT }, (_, i) =>
        `<div class="tq-rope-dot${(DOTS_COUNT - 1 - i) < filled ? ' tq-dot-blue' : ''}"></div>`
      ).join('');
    }
    if (redC) {
      const filled = pos > 0 ? pos : 0;
      redC.innerHTML = Array.from({ length: DOTS_COUNT }, (_, i) =>
        `<div class="tq-rope-dot${i < filled ? ' tq-dot-red' : ''}"></div>`
      ).join('');
    }
  }

  function updateScoreDisplay() {
    const bb = $('tq-blue-score-badge'); if (bb) bb.textContent = state.blue.score;
    const rb = $('tq-red-score-badge');  if (rb) rb.textContent = state.red.score;
    const ab = $('tq-arena-blue-score'); if (ab) ab.textContent = state.blue.score;
    const ar = $('tq-arena-red-score');  if (ar) ar.textContent = state.red.score;
  }

  function updateTimerUI(seconds) {
    const num = $('tq-timer-num');
    if (!num) return;
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    num.textContent = `${mins}:${secs}`;
    num.classList.toggle('tq-timer-urgent', seconds <= 5);
  }

  function showRoundOverlay(icon, text, detail) {
    const overlay = $('tq-round-overlay');
    const iconEl  = $('tq-round-result-icon');
    const textEl  = $('tq-round-result-text');
    const detEl   = $('tq-round-result-detail');
    if (iconEl) iconEl.textContent = icon;
    if (textEl) textEl.textContent = text;
    if (detEl)  detEl.textContent  = detail || '';
    if (overlay) {
      overlay.classList.add('tq-overlay-visible');
      _after(() => overlay.classList.remove('tq-overlay-visible'), RESULT_SHOW_MS);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  Game Flow
  // ════════════════════════════════════════════════════════════════════════════

  /** Reference to the active TugArenaScene */
  let arenaScene = null;

  function startGame() {
    state.blue.name  = ($('tq-blue-name') || {}).value || 'Team 1';
    state.red.name   = ($('tq-red-name')  || {}).value || 'Team 2';
    state.blue.score = 0;
    state.red.score  = 0;
    state.ropePosition = 0;
    state.roundNumber  = 0;
    state.phase        = 'playing';

    // Update team names in all displays
    const bn = $('tq-blue-team-name'); if (bn) bn.textContent = state.blue.name;
    const rn = $('tq-red-team-name');  if (rn) rn.textContent = state.red.name;
    const al = $('tq-arena-blue-label'); if (al) al.textContent = state.blue.name;
    const ar = $('tq-arena-red-label');  if (ar) ar.textContent = state.red.name;

    updateScoreDisplay();
    renderRopeDots();
    showScreen('tq-game-screen');

    // Start EduAPI session
    engine.EduAPI.startSession({
      gameId:   'tug-quiz',
      gameName: 'Tug Quiz — شد الحبل',
      level:    1,
      metadata: { mode: state.questionMode, timer: state.timerSeconds }
    });

    engine.Audio.playStartSFX();

    // Start background music
    if (!musicEng) musicEng = new TugMusicEngine();
    musicEng.start(engine.Audio);

    // Boot the arena scene after the screen is visible
    requestAnimationFrame(() => {
      // Switch scene (destroys previous if any)
      arenaScene = new TugArenaScene();
      engine.Scenes.register('tug-arena', arenaScene);
      engine.Scenes.switchTo('tug-arena', 250).then(() => {
        _after(startRound, 500);
      });
    });
  }

  function startRound() {
    if (state.phase !== 'playing') return;

    state.roundNumber++;
    state.currentQuestion = generateQuestion(state.questionMode);

    ['blue', 'red'].forEach(team => {
      state[team].answer     = '';
      state[team].submitted  = false;
      state[team].submitTime = null;
      state[team].correct    = false;
      updateAnswerDisplay(team);
    });

    resetPanels();
    displayQuestion(state.currentQuestion);

    const ri = $('tq-round-info');
    if (ri) ri.textContent = `السؤال ${state.roundNumber}`;

    state.timerRemaining = state.timerSeconds;
    updateTimerUI(state.timerRemaining);
    state.roundStartTime = Date.now();

    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(onTimerTick, 1000);
  }

  function onTimerTick() {
    state.timerRemaining--;
    updateTimerUI(state.timerRemaining);
    if (state.timerRemaining <= 0) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      // Play warning tone then evaluate
      engine.Audio.playTone(220, 0.15, 'sine', 0.2);
      evaluateRound();
    }
  }

  function submitAnswer(team) {
    if (state.phase !== 'playing')  return;
    if (state[team].submitted)      return;
    if (!state[team].answer)        return;

    state[team].submitted  = true;
    state[team].submitTime = Date.now() - state.roundStartTime;

    markSubmitted(team);

    // Keypress SFX
    engine.Audio.playTone(440, 0.08, 'sine', 0.15);

    if (state.blue.submitted && state.red.submitted) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      _after(evaluateRound, 280);
    }
  }

  function evaluateRound() {
    if (state.phase !== 'playing') return;
    state.phase = 'round-result';

    const correctAns = state.currentQuestion.answer;
    const blueNum    = parseInt(state.blue.answer, 10);
    const redNum     = parseInt(state.red.answer,  10);

    state.blue.correct = !isNaN(blueNum) && blueNum === correctAns;
    state.red.correct  = !isNaN(redNum)  && redNum  === correctAns;

    // Determine winner
    let winner = null; // 'blue' | 'red' | null (draw/none)

    if (state.blue.correct && state.red.correct) {
      const blueMs = state.blue.submitTime ?? Infinity;
      const redMs  = state.red.submitTime  ?? Infinity;
      if      (blueMs < redMs) winner = 'blue';
      else if (redMs  < blueMs) winner = 'red';
      // exact tie → no movement
    } else if (state.blue.correct) {
      winner = 'blue';
    } else if (state.red.correct) {
      winner = 'red';
    }

    // EduAPI: record answers for both teams
    const bothCorrect = state.blue.correct && state.red.correct;
    const bluePoints  = state.blue.correct ? (winner === 'blue' && bothCorrect ? POINTS_FASTEST : POINTS_WIN) : 0;
    const redPoints   = state.red.correct  ? (winner === 'red'  && bothCorrect ? POINTS_FASTEST : POINTS_WIN) : 0;
    engine.EduAPI.recordAnswer(state.blue.correct, bluePoints, { team: 'blue', round: state.roundNumber });
    engine.EduAPI.recordAnswer(state.red.correct,  redPoints,  { team: 'red',  round: state.roundNumber });

    // Rope movement + score tracking
    if (winner === 'blue')     { state.ropePosition -= 1; state.blue.score++; }
    else if (winner === 'red') { state.ropePosition += 1; state.red.score++;  }
    state.ropePosition = Math.max(-ROPE_MAX, Math.min(ROPE_MAX, state.ropePosition));
    updateScoreDisplay();

    // Audio feedback
    if (winner) {
      engine.Audio.playCorrectSFX();
    } else if (!state.blue.correct && !state.red.correct) {
      engine.Audio.playWrongSFX();
    } else {
      // One correct, one wrong — winning side hears correct
      engine.Audio.playCorrectSFX();
    }

    // Update PixiJS arena
    if (arenaScene) {
      arenaScene.setRopeTarget(state.ropePosition);
      if (winner) {
        arenaScene.triggerPull(winner);
        const W   = engine.app ? engine.app.renderer.width  : 400;
        const H   = engine.app ? engine.app.renderer.height : 300;
        const px  = winner === 'blue' ? W * 0.20 : W * 0.80;
        const py  = H * 0.55;
        const col = winner === 'blue' ? 0x1e88e5 : 0xe53935;
        arenaScene.spawnBurst(px, py, col, 18);
        arenaScene.spawnBurst(px, py, 0xffd700, 10);
        arenaScene.spawnTextPop(px, py - 60, winner === 'blue' ? '⬅ اسحب!' : 'اسحب! ➡', col);
      }
    }

    // HTML panel feedback
    flashPanel('blue', state.blue.correct);
    flashPanel('red',  state.red.correct);

    renderRopeDots();

    // Round overlay message
    let icon, text, detail;
    if (!state.blue.correct && !state.red.correct) {
      icon = '😮'; text = 'كلا الفريقين أخطأ!'; detail = `الإجابة الصحيحة: ${correctAns}`;
    } else if (winner === 'blue') {
      icon = '🔵';
      text = `فاز ${state.blue.name}!`;
      detail = bothCorrect
        ? `أسرع بـ ${((state.red.submitTime - state.blue.submitTime) / 1000).toFixed(1)} ث`
        : 'إجابة صحيحة 🎯';
    } else if (winner === 'red') {
      icon = '🔴';
      text = `فاز ${state.red.name}!`;
      detail = bothCorrect
        ? `أسرع بـ ${((state.blue.submitTime - state.red.submitTime) / 1000).toFixed(1)} ث`
        : 'إجابة صحيحة 🎯';
    } else {
      icon = '🤝'; text = 'تعادل!'; detail = 'كلا الفريقين صحيح بنفس الوقت';
    }
    showRoundOverlay(icon, text, detail);

    // Check win or continue
    _after(() => {
      if (Math.abs(state.ropePosition) >= ROPE_MAX) {
        endGame(state.ropePosition < 0 ? 'blue' : 'red');
      } else {
        state.phase = 'playing';
        _after(startRound, NEXT_ROUND_MS);
      }
    }, RESULT_SHOW_MS + 100);
  }

  function endGame(winner) {
    state.phase = 'game-over';
    _clearAll();

    // Stop background music
    if (musicEng) { musicEng.stop(); musicEng = null; }

    // End EduAPI session
    const result = engine.EduAPI.endSession();
    engine.Audio.playFinishSFX();

    // Celebration burst in canvas
    if (arenaScene) {
      const col = winner === 'blue' ? 0x42a5f5 : 0xef5350;
      const W   = engine.app.renderer.width;
      const H   = engine.app.renderer.height;
      const celebColors = [col, 0xffd700, 0xffffff, col];
      celebColors.forEach((c, i) => {
        _after(() => {
          if (!arenaScene) return;
          arenaScene.spawnBurst(Math.random() * W, Math.random() * H * 0.6, c, 20);
        }, i * 180);
      });
    }

    // Populate game-over screen
    const winnerName = winner === 'blue' ? state.blue.name : state.red.name;
    const icon  = $('tq-gameover-icon');
    const title = $('tq-gameover-title');
    const winEl = $('tq-gameover-winner');
    const stats = $('tq-gameover-stats');

    if (icon)  icon.textContent  = winner === 'blue' ? '🔵🏆' : '🔴🏆';
    if (title) title.textContent = 'انتهت اللعبة!';
    if (winEl) winEl.textContent = `${winnerName} يفوز!`;

    const accuracy = result ? result.accuracy : 0;
    const rounds   = state.roundNumber;
    if (stats) stats.innerHTML =
      `جولات: <strong>${rounds}</strong> &nbsp;|&nbsp; ` +
      `نقاط: <strong>${(result ? result.score : 0).toLocaleString('ar-EG')}</strong> &nbsp;|&nbsp; ` +
      `دقة: <strong>${accuracy}%</strong>`;

    _after(() => showScreen('tq-gameover-screen'), 800);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  Keypad input
  // ════════════════════════════════════════════════════════════════════════════
  function handleKey(team, key) {
    if (state.phase !== 'playing') return;
    if (state[team].submitted)     return;

    if (key === 'submit') {
      submitAnswer(team);
      return;
    }

    let ans = state[team].answer;
    if (key === 'clear') {
      ans = '';
    } else {
      if (ans.length < 5) ans += key;
    }
    state[team].answer = ans;
    updateAnswerDisplay(team);

    // Subtle keypress click SFX
    engine.Audio.playTone(440, 0.05, 'sine', 0.08);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  Engine resize handler
  // ════════════════════════════════════════════════════════════════════════════
  function onResize() {
    const mount = $('tq-pixi-mount');
    if (!mount || !engine || !engine.app) return;
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (w > 0 && h > 0) engine.resize(w, h);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  Initialization
  // ════════════════════════════════════════════════════════════════════════════
  async function init() {
    const mount = $('tq-pixi-mount');
    if (!mount) return;

    try {
      // Boot the shared Game Engine (boots PixiJS, Loop, Scenes, Audio, EduAPI …)
      engine = await GameEngine.init({
        container:       'tq-pixi-mount',
        backgroundColor: 0xfafafa
      });

      window.addEventListener('resize', onResize);

      // Teardown when navigating away
      window.addEventListener('hashchange', () => {
        _clearAll();
        if (musicEng) { musicEng.stop(); musicEng = null; }
        arenaScene = null;
        window.removeEventListener('resize', onResize);
        state.phase = 'destroyed';
      }, { once: true });

    } catch (err) {
      console.error('[TugQuiz] GameEngine init failed:', err);
      // Graceful fallback: stub engine so game UI still works
      engine = {
        app:    null,
        EduAPI: new GE_EducationalAPI(),
        Audio:  new GE_AudioEngine(),
        UI:     new GE_UISystem(),
        Loop:   { add: () => {}, remove: () => {} },
        Scenes: { register: () => {}, switchTo: () => Promise.resolve() },
        resize: () => {}
      };
      mount.innerHTML =
        `<div style="display:flex;align-items:center;justify-content:center;
          height:100%;color:#888;font-family:Cairo,sans-serif;
          font-size:0.9rem;padding:2rem;text-align:center;background:#f5f5f5;">
          ⚠️ تعذّر تحميل المحرك الرسومي — اللعبة تعمل بدون رسوميات
         </div>`;
    }

    // ── Wire up setup screen controls ────────────────────────────────────────

    document.querySelectorAll('.tq-opt-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tq-opt-btn[data-mode]').forEach(b => b.classList.remove('tq-opt-active'));
        btn.classList.add('tq-opt-active');
        state.questionMode = btn.dataset.mode;
      });
    });

    document.querySelectorAll('.tq-opt-btn[data-timer]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tq-opt-btn[data-timer]').forEach(b => b.classList.remove('tq-opt-active'));
        btn.classList.add('tq-opt-active');
        state.timerSeconds = parseInt(btn.dataset.timer, 10);
      });
    });

    const startBtn = $('tq-start-btn');
    if (startBtn) startBtn.addEventListener('click', startGame);

    // ── Wire up game screen keypads ──────────────────────────────────────────

    document.querySelectorAll('.tq-key').forEach(btn => {
      const { team, key } = btn.dataset;
      const press = (e) => { if (e.cancelable) e.preventDefault(); handleKey(team, key); };
      btn.addEventListener('click', press);
      btn.addEventListener('touchstart', press, { passive: false });
    });

    // ── Wire up game-over screen ─────────────────────────────────────────────

    const playAgain = $('tq-play-again-btn');
    if (playAgain) playAgain.addEventListener('click', () => {
      state.phase        = 'setup';
      state.blue.score   = 0;
      state.red.score    = 0;
      state.ropePosition = 0;
      arenaScene  = null;
      showScreen('tq-setup-screen');
    });

    const backBtn = $('tq-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => {
      window.location.hash = '#/game-engine';
    });

    console.log('[TugQuiz] Ready.');
  }

  // Entry point
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
