/* ══════════════════════════════════════
   Whiteboard v3 — bounded board + desk surface
   ══════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Board dimensions ── */
  /* Reverted from the enlarged 2880×1620 back to 1920×1080 — combined with
     the DPR floor below, the bigger backing store measurably lagged pen
     drawing (huge canvas textures being recomposited on every stroke).
     Panning-room and always-crisp-on-fullscreen were nice-to-haves; smooth
     drawing isn't. */
  const BOARD_W = 1920;
  const BOARD_H = 1080;

  /* ── DOM ── */
  const bgCvs   = document.getElementById('wbBg');
  const canvas  = document.getElementById('wbCanvas');
  const overlay = document.getElementById('wbOverlay');
  const wrap    = document.getElementById('wbCanvasWrap');
  const textBox = document.getElementById('wbTextBox');
  const bgCtx   = bgCvs.getContext('2d');
  const ctx     = canvas.getContext('2d');
  const octx    = overlay.getContext('2d');

  /* Offscreen scratch canvas the highlighter draws its live stroke onto at
     full opacity — each individual move-segment is opaque there, so
     overlapping round-capped segments (very common at slow pointer speed)
     just look like solid colour, not stacked transparency. The whole
     stroke is then composited onto the real canvas (and, live, onto the
     overlay for on-screen feedback) exactly once at the intended
     translucency, instead of blending translucency per-segment straight
     onto the board — which is what produced the dark overlapping dots. */
  const hlCvs = document.createElement('canvas');
  const hlCtx = hlCvs.getContext('2d');

  /* ── State ── */
  let tool    = 'pen';
  let color   = '#1e293b';
  let size    = 5;
  let textSize = 32; // CSS px — dedicated font-size for the text tool, independent of brush size
  let opacity = 1; // fixed — the opacity control was removed from the UI
  let fill    = true;
  let bgType  = 'grid';
  let boardCol = '#ffffff';

  /* zoom / pan */
  let scale = 1;
  let panX  = 0;
  let panY  = 0;

  /* Backing-store resolution multiplier for the board bitmap (board-units ->
     physical pixels). Fixed at 2x regardless of the screen's real
     devicePixelRatio (usually 1 on ordinary external monitors) — the actual
     lag culprits turned out to be elsewhere (PNG-encoding full-board undo
     snapshots, and recomputing wrap's bounding rect on every mousemove),
     both fixed separately. With those gone, the extra resolution here is a
     clear win for line crispness with no measured drawing-speed cost, at
     the board's normal 1920×1080 size. Capped at 2x so very high actual-DPR
     displays don't blow memory/perf up further for no visible benefit. */
  const DPR = 2;

  /* The three canvases (#wbBg/#wbCanvas/#wbOverlay) are sized ONCE to the
     full board at a fixed resolution (BOARD_W/H * DPR) and NEVER resized
     again after that — panning/zooming/window-resizing is done purely via
     CSS (width/height/left/top), which the browser scales non-destructively.
     Previously the backing store was resized to match the *viewport* on
     every window/fullscreen resize, which — because resizing a canvas's
     width/height property clears it — required capturing+repasting a raster
     snapshot each time. Any content outside the new (often smaller) canvas
     bounds was silently and permanently cropped, and the repeated
     raster round-trips blurred everything a little more each cycle. Fixing
     the backing store means neither of those can happen again. */
  let canvasesSized = false;
  function ensureCanvasesSized() {
    if (canvasesSized) return;
    canvasesSized = true;
    const bw = Math.round(BOARD_W * DPR), bh = Math.round(BOARD_H * DPR);
    [bgCvs, canvas, overlay].forEach(c => { c.width = bw; c.height = bh; });
    [ctx, octx].forEach(c => c.setTransform(DPR, 0, 0, DPR, 0, 0));
    drawBg();
  }

  /* drawing */
  let drawing   = false;
  let isPanning = false;
  let panStart  = { x: 0, y: 0 };
  let startX = 0, startY = 0, lastX = 0, lastY = 0;
  /* freehand-stroke smoothing (pen/highlight/eraser) — quadratic curve through
     the midpoints of consecutive raw pointer samples, instead of straight
     lineTo segments between them, which look faceted on fast/curved strokes */
  let smoothRawX = 0, smoothRawY = 0, smoothMidX = 0, smoothMidY = 0;

  /* history — kept lower than before (was 50) because each snapshot is now
     a full in-memory canvas clone at the board's (fairly large) backing-store
     resolution rather than a compressed PNG string; trades some undo depth
     for a lot less memory pressure. */
  let history   = [];
  let redoStack = [];
  const MAX_HIST = 20;

  /* floating image */
  let floatImg  = null;
  let floatRect = { x: 0, y: 0, w: 0, h: 0 }; // CSS px relative to wrap
  let _imgDrag  = null; // { type:'move'|'resize', dir, startX, startY, startRect }

  /* Bounding boxes (board px) of images, templates, and shapes placed on
     the current page — lets the "تحديد" (select) tool grab any of them
     with one click instead of needing a full drag-select rectangle around
     it every time. Purely an index into where things are; the actual
     pixels still live baked into the canvas like everything else (see
     commitFloatImg for images/templates, the shape branch of onUp below
     for shapes). */
  let placedObjects = [];

  /* Cached wrap rect — getBoundingClientRect() forces a synchronous layout
     flush, and getScreen() (below) used to call it on every single
     mousemove while drawing. At high pointer-event rates that layout
     thrashing was a real, continuous source of pen lag, separate from the
     history/backing-store cost fixed earlier. Refreshed only when wrap
     actually changes size/position (resize/fullscreen). */
  let wrapRect = wrap.getBoundingClientRect();
  function updateWrapRect() { wrapRect = wrap.getBoundingClientRect(); }

  /* ── Resize: purely a CSS re-layout now — see ensureCanvasesSized() above
     for why the canvas bitmaps themselves are never touched here. ── */
  function resize() {
    ensureCanvasesSized();
    // Safe to re-fit to the viewport on every resize now — the canvas
    // bitmaps themselves are never touched here, only CSS positioning, so
    // window/fullscreen size changes just re-frame the same fixed board
    // bitmap with zero risk of losing or blurring anything.
    centerBoard();
    updateWrapRect();
  }

  function centerBoard() {
    // "cover" (not "contain") — the board must always fill wrap completely
    // with no empty margin, in both windowed and fullscreen states, even if
    // that means the shorter axis overflows slightly off-screen.
    const coverScale = Math.max(
      wrap.clientWidth  / BOARD_W,
      wrap.clientHeight / BOARD_H
    );
    /* The board's aspect ratio (16:9) often matches the window's almost
       exactly, which makes strict "cover" scale fill both axes with zero
       slack — panning would have nowhere to go. Starting slightly zoomed in
       beyond that minimum guarantees room to pan in every direction by
       default; doZoom()'s own minScale still allows zooming back out to the
       exact cover fit if the user wants the whole board on screen. Fullscreen
       gets extra padding since that's the main place panning around a big
       board is actually useful. */
    scale = coverScale * (document.fullscreenElement ? 1.6 : 1.2);
    panX = (wrap.clientWidth  - BOARD_W * scale) / 2;
    panY = (wrap.clientHeight - BOARD_H * scale) / 2;
    applyTransform();
    updateZoomLabel();
  }

  /* Keeps panX/panY from dragging the board past its own edges — the board
     is a fixed size (not an infinite canvas), so panning/zooming should
     stop there instead of revealing blank wrap background beyond it. */
  function clampPan() {
    const bw = BOARD_W * scale, bh = BOARD_H * scale;
    panX = bw <= wrap.clientWidth
      ? (wrap.clientWidth - bw) / 2
      : Math.min(0, Math.max(wrap.clientWidth - bw, panX));
    panY = bh <= wrap.clientHeight
      ? (wrap.clientHeight - bh) / 2
      : Math.min(0, Math.max(wrap.clientHeight - bh, panY));
  }

  // The SPA router swaps #app's innerHTML on navigation without ever
  // tearing down the previous page's script — so without this, leaving the
  // whiteboard leaves this observer alive, and a later resize/reflow on
  // whatever page loaded next fires `resize()` against DOM elements
  // (#wbZoomLabel etc.) that no longer exist, throwing on null.
  const boardResizeObserver = new ResizeObserver(resize);
  boardResizeObserver.observe(wrap);
  window.addEventListener('hashchange', () => boardResizeObserver.disconnect(), { once: true });

  /* ── Transform: purely CSS — the canvas bitmaps are fixed-resolution and
     never redrawn/rescaled by this, so panning/zooming can't lose or blur
     content no matter how many times it's called. ── */
  function applyTransform() {
    [bgCvs, canvas, overlay].forEach(c => {
      c.style.left   = panX + 'px';
      c.style.top    = panY + 'px';
      c.style.width  = (BOARD_W * scale) + 'px';
      c.style.height = (BOARD_H * scale) + 'px';
    });
  }

  function screenToBoard(sx, sy) {
    return { x: (sx - panX) / scale, y: (sy - panY) / scale };
  }

  /* ── Background canvas (desk + board) ── */
  function drawBg() {
    const w = bgCvs.width, h = bgCvs.height;
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.clearRect(0, 0, w, h);

    /* board fills the full canvas */
    bgCtx.fillStyle = boardCol;
    bgCtx.fillRect(0, 0, w, h);

    /* board background pattern */
    drawBgPattern();
  }

  function drawBgPattern() {
    if (bgType === 'plain') return;
    const isDark  = boardCol === '#1e293b';
    const lineCol = isDark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.09)';
    const dotCol  = isDark ? 'rgba(255,255,255,.20)' : 'rgba(0,0,0,.18)';
    const step    = 40 * DPR;

    bgCtx.strokeStyle = lineCol;
    /* physical-pixel widths, scaled by DPR so the on-screen thickness stays
       constant regardless of DPR (which is now floored at 2x for sharpness
       — without this, raising DPR made these lines/dots proportionally
       thinner/fainter on screen) */
    bgCtx.lineWidth   = 0.5 * DPR;
    bgCtx.fillStyle   = dotCol;

    const bx = 0, by = 0;
    const bw = bgCvs.width, bh = bgCvs.height;

    bgCtx.save();

    if (bgType === 'lines') {
      bgCtx.beginPath();
      for (let y = by + step; y < by + bh; y += step) { bgCtx.moveTo(bx, y); bgCtx.lineTo(bx + bw, y); }
      bgCtx.stroke();
    } else if (bgType === 'grid') {
      bgCtx.beginPath();
      for (let y = by + step; y < by + bh; y += step) { bgCtx.moveTo(bx, y); bgCtx.lineTo(bx + bw, y); }
      for (let x = bx + step; x < bx + bw; x += step) { bgCtx.moveTo(x, by); bgCtx.lineTo(x, by + bh); }
      bgCtx.stroke();
    } else if (bgType === 'dots') {
      for (let y = by + step; y < by + bh; y += step)
        for (let x = bx + step; x < bx + bw; x += step) {
          bgCtx.beginPath(); bgCtx.arc(x, y, 1.5 * DPR, 0, Math.PI * 2); bgCtx.fill();
        }
    } else if (bgType === 'iso') {
      const h2 = step * Math.sin(Math.PI / 3);
      bgCtx.beginPath();
      for (let y = by; y < by + bh + h2; y += h2) { bgCtx.moveTo(bx, y); bgCtx.lineTo(bx + bw, y); }
      const rowLen = bw + bh;
      for (let x = bx - bh; x < bx + bw + bh; x += step) {
        bgCtx.moveTo(x, by); bgCtx.lineTo(x + rowLen / Math.tan(Math.PI / 3), by + bh);
        bgCtx.moveTo(x, by); bgCtx.lineTo(x - rowLen / Math.tan(Math.PI / 3), by + bh);
      }
      bgCtx.stroke();
    } else if (bgType === 'graph') {
      const sm = 10 * DPR;
      bgCtx.strokeStyle = isDark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.04)';
      bgCtx.beginPath();
      for (let y = by; y < by + bh; y += sm) { bgCtx.moveTo(bx, y); bgCtx.lineTo(bx + bw, y); }
      for (let x = bx; x < bx + bw; x += sm) { bgCtx.moveTo(x, by); bgCtx.lineTo(x, by + bh); }
      bgCtx.stroke();
      bgCtx.strokeStyle = lineCol;
      bgCtx.beginPath();
      for (let y = by; y < by + bh; y += step) { bgCtx.moveTo(bx, y); bgCtx.lineTo(bx + bw, y); }
      for (let x = bx; x < bx + bw; x += step) { bgCtx.moveTo(x, by); bgCtx.lineTo(x, by + bh); }
      bgCtx.stroke();
    }
    bgCtx.restore();
  }

  /* ── History ── */
  /* Snapshots are plain canvas clones (a direct pixel copy), not
     canvas.toDataURL() strings — PNG-encoding/decoding the board on every
     single stroke's mousedown (and every undo/redo) was real, measurable
     lag once the backing store got bigger this session, since that encode
     is CPU-bound and scales with pixel count. A canvas-to-canvas drawImage
     copy has no encode step and is effectively instant. */
  function snapshotCanvas() {
    const snap = document.createElement('canvas');
    snap.width = canvas.width;
    snap.height = canvas.height;
    snap.getContext('2d').drawImage(canvas, 0, 0);
    return snap;
  }

  function saveHistory() {
    history.push(snapshotCanvas());
    if (history.length > MAX_HIST) history.shift();
    redoStack = [];
  }

  function restoreSnap(snap) {
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(snap, 0, 0);
    ctx.restore();
  }

  function undo() { if (!history.length) return; redoStack.push(snapshotCanvas()); restoreSnap(history.pop()); }
  function redo() { if (!redoStack.length) return; history.push(snapshotCanvas()); restoreSnap(redoStack.pop()); }

  /* ── Pages ── */
  /* The alternative to one giant board: several normal-sized (1920×1080)
     pages instead. Switching pages just swaps which snapshot is drawn onto
     the one real canvas — no extra backing stores, so drawing performance
     is unaffected by how many pages exist. Each page keeps its own
     undo/redo history. */
  let pagesData     = [{ name: 'سبورة 1', snap: null, history: [], redoStack: [], placedObjects: [] }];
  let currentPageIdx = 0;
  const pageLabelEl = document.getElementById('wbPageLabel');

  function updatePageLabel() {
    if (pageLabelEl) pageLabelEl.textContent = pagesData[currentPageIdx].name;
    const delBtn = document.getElementById('wbPageDelete');
    if (delBtn) delBtn.disabled = pagesData.length <= 1;
    const prevBtn = document.getElementById('wbPagePrev');
    if (prevBtn) prevBtn.disabled = currentPageIdx === 0;
  }

  // click-to-rename: the label itself is contenteditable (see whiteboard.html)
  pageLabelEl?.addEventListener('blur', () => {
    const txt = pageLabelEl.textContent.trim();
    pagesData[currentPageIdx].name = txt || pagesData[currentPageIdx].name;
    updatePageLabel(); // re-render in case it was left empty
  });
  pageLabelEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); pageLabelEl.blur(); }
  });
  pageLabelEl?.addEventListener('click', e => e.stopPropagation());

  function loadPage(idx) {
    if (idx < 0 || idx >= pagesData.length || idx === currentPageIdx) return;
    // persist whatever the current page's live canvas/history look like now
    pagesData[currentPageIdx] = { ...pagesData[currentPageIdx], snap: snapshotCanvas(), history, redoStack, placedObjects };
    currentPageIdx = idx;
    const pd = pagesData[idx];
    history = pd.history;
    redoStack = pd.redoStack;
    placedObjects = pd.placedObjects || [];
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pd.snap) ctx.drawImage(pd.snap, 0, 0);
    ctx.restore();
    // defensive: any leftover shape-tool preview or selection marquee on the
    // overlay layer must never carry over onto a different page
    octx.save(); octx.setTransform(1,0,0,1,0,0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.restore();
    updatePageLabel();
  }

  function addPage() {
    pagesData.push({ name: `سبورة ${pagesData.length + 1}`, snap: null, history: [], redoStack: [], placedObjects: [] });
    loadPage(pagesData.length - 1);
  }

  function deletePage() {
    if (pagesData.length <= 1) return;
    pagesData.splice(currentPageIdx, 1);
    const target = Math.min(currentPageIdx, pagesData.length - 1);
    // currentPageIdx no longer points at a real (just-deleted) page, so
    // loadPage's "persist current" step must not run for it — jump straight
    // to loading the target page's own state instead.
    currentPageIdx = target;
    const pd = pagesData[target];
    history = pd.history;
    redoStack = pd.redoStack;
    placedObjects = pd.placedObjects || [];
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pd.snap) ctx.drawImage(pd.snap, 0, 0);
    ctx.restore();
    // defensive: any leftover shape-tool preview or selection marquee on the
    // overlay layer must never carry over onto a different page
    octx.save(); octx.setTransform(1,0,0,1,0,0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.restore();
    updatePageLabel();
  }

  document.getElementById('wbPagePrev')?.addEventListener('click', () => loadPage(currentPageIdx - 1));
  document.getElementById('wbPageNext')?.addEventListener('click', () => {
    if (currentPageIdx < pagesData.length - 1) loadPage(currentPageIdx + 1);
    else addPage();
  });
  document.getElementById('wbPageAdd')?.addEventListener('click', addPage);
  document.getElementById('wbPageDelete')?.addEventListener('click', deletePage);
  updatePageLabel();

  /* ── Drawing helpers ── */
  function applyStroke(c) {
    c.strokeStyle = color;
    c.fillStyle   = color;
    c.lineWidth   = size / scale;
    c.lineCap     = 'round';
    c.lineJoin    = 'round';
    c.globalAlpha = opacity;
  }

  function clampToBoard(x, y) {
    /* whole visible surface is drawable — no clamping to the 1920×1080 export frame */
    return { x, y };
  }

  /* Vertex/outline geometry for the shape tools, in board coordinates —
     mirrors drawShape's own math exactly so the "construction animation"
     (see animateShapeDraw) traces the same outline the shape was actually
     drawn with. Returns null for tools that aren't a clean outline shape
     (pen/highlight/eraser/arrow). */
  function getShapeGeometry(shapeTool, x1, y1, x2, y2) {
    const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    if (shapeTool === 'rect') {
      return { kind: 'polygon', points: [{x:rx,y:ry},{x:rx+rw,y:ry},{x:rx+rw,y:ry+rh},{x:rx,y:ry+rh}] };
    }
    if (shapeTool === 'triangle') {
      return { kind: 'polygon', points: [{x:rx+rw/2,y:ry},{x:rx+rw,y:ry+rh},{x:rx,y:ry+rh}] };
    }
    if (shapeTool === 'diamond') {
      return { kind: 'polygon', points: [{x:rx+rw/2,y:ry},{x:rx+rw,y:ry+rh/2},{x:rx+rw/2,y:ry+rh},{x:rx,y:ry+rh/2}] };
    }
    if (shapeTool === 'star') {
      const rOut = Math.max(rw, rh) / 2, rIn = rOut * 0.42;
      const points = [];
      for (let i = 0; i < 10; i++) {
        const ang = (Math.PI / 5) * i - Math.PI / 2;
        const r = i % 2 === 0 ? rOut : rIn;
        points.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
      }
      return { kind: 'polygon', points };
    }
    if (shapeTool === 'line') {
      return { kind: 'polygon', points: [{x:x1,y:y1},{x:x2,y:y2}], open: true };
    }
    if (shapeTool === 'circle') {
      return { kind: 'circle', cx, cy, rx: rw / 2, ry: rh / 2 };
    }
    return null;
  }

  /* Shared short musical tone, reused by the shape-construction animation
     and the alphabet "play all" tool — a little audible feedback per
     vertex/step instead of pure silence. */
  let _toneCtx;
  function playTone(freq, duration = 0.28) {
    if (!_toneCtx) { try { _toneCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return; } }
    const t = _toneCtx.currentTime;
    const osc = _toneCtx.createOscillator();
    const gain = _toneCtx.createGain();
    osc.connect(gain); gain.connect(_toneCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t); osc.stop(t + duration);
  }
  const TONE_SCALE = [261.63, 293.66, 329.63, 392.00, 440.00, 493.88];

  /* Small floating "🎬 حرّك الشكل" button that pops up right where the
     teacher clicked a shape (with the select tool) — clicking it plays
     the construction animation in place; clicking anywhere else dismisses
     it without doing anything (so a normal drag-select of the same area
     still works as before). */
  let _shapeAnimBtn = null;
  function showShapeAnimateButton(hit, screenPos) {
    dismissShapeAnimateButton();
    const btn = document.createElement('button');
    btn.textContent = '🎬 حرّك الشكل';
    btn.className = 'wb-shape-anim-btn';
    btn.style.left = screenPos.x + 'px';
    btn.style.top  = screenPos.y + 'px';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      dismissShapeAnimateButton();
      animateShapeDraw(hit);
    });
    wrap.appendChild(btn);
    _shapeAnimBtn = btn;
    setTimeout(() => {
      document.addEventListener('click', dismissShapeAnimateButton, { once: true });
    }, 0);
  }
  function dismissShapeAnimateButton() {
    if (_shapeAnimBtn) { _shapeAnimBtn.remove(); _shapeAnimBtn = null; }
  }

  /* Redraws a placed shape's outline progressively, vertex by vertex, with
     a short tone at each corner — a quick "how this shape is built"
     construction animation, triggered by the 🎬 button that appears when
     you click a shape with the select tool (see onDown below). */
  function animateShapeDraw(obj) {
    const { bx, by, bw, bh, shape } = obj;
    if (!shape) return;
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.restore();

    const draw = (c) => {
      c.save();
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
      c.strokeStyle = shape.color;
      c.fillStyle   = shape.color;
      c.lineWidth   = shape.size / scale;
      c.lineCap     = 'round';
      c.lineJoin    = 'round';
      c.globalAlpha = shape.opacity;
      return c;
    };

    if (shape.kind === 'circle') {
      const totalMs = 900;
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / totalMs);
        ctx.save();
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.clearRect(bx - 2, by - 2, bw + 4, bh + 4);
        ctx.restore();
        const c = draw(ctx);
        c.beginPath();
        c.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
        c.stroke();
        c.restore();
        if (Math.floor(t * 4) !== Math.floor(((now - 16 - start) / totalMs) * 4)) playTone(TONE_SCALE[Math.floor(t * 4) % TONE_SCALE.length]);
        if (t < 1) requestAnimationFrame(step);
        else if (shape.fill) { const c2 = draw(ctx); c2.beginPath(); c2.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2); c2.fill(); c2.restore(); }
      };
      requestAnimationFrame(step);
      return;
    }

    // polygon (rect/triangle/diamond/star/line) — one edge at a time
    const pts = shape.points;
    const segCount = shape.open ? pts.length - 1 : pts.length;
    let seg = 0;
    playTone(TONE_SCALE[0]);
    const drawSoFar = () => {
      const c = draw(ctx);
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= seg; i++) c.lineTo(pts[i % pts.length].x, pts[i % pts.length].y);
      c.stroke();
      c.restore();
    };
    const stepEdge = () => {
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(bx - 2, by - 2, bw + 4, bh + 4);
      ctx.restore();
      drawSoFar();
      if (seg < segCount) {
        seg++;
        playTone(TONE_SCALE[seg % TONE_SCALE.length]);
        setTimeout(stepEdge, 260);
      } else if (shape.fill && !shape.open) {
        const c = draw(ctx);
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach(p => c.lineTo(p.x, p.y));
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      }
    };
    stepEdge();
  }

  function drawShape(c, x1, y1, x2, y2) {
    c.save();
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    applyStroke(c);
    c.beginPath();
    if (tool === 'line') {
      c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    } else if (tool === 'arrow') {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = (14 + size * 1.5) / scale;
      c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.beginPath();
      c.moveTo(x2, y2);
      c.lineTo(x2 - len * Math.cos(ang - .4), y2 - len * Math.sin(ang - .4));
      c.lineTo(x2 - len * Math.cos(ang + .4), y2 - len * Math.sin(ang + .4));
      c.closePath(); c.fill();
    } else if (tool === 'rect') {
      const rx = Math.min(x1,x2), ry = Math.min(y1,y2);
      const rw = Math.abs(x2-x1), rh = Math.abs(y2-y1);
      if (fill) c.fillRect(rx, ry, rw, rh);
      c.strokeRect(rx, ry, rw, rh);
    } else if (tool === 'circle') {
      const cx = (x1+x2)/2, cy = (y1+y2)/2;
      c.ellipse(cx, cy, Math.abs(x2-x1)/2, Math.abs(y2-y1)/2, 0, 0, Math.PI*2);
      if (fill) c.fill();
      c.stroke();
    } else if (tool === 'triangle') {
      const rx = Math.min(x1,x2), ry = Math.min(y1,y2);
      const rw = Math.abs(x2-x1), rh = Math.abs(y2-y1);
      c.moveTo(rx + rw/2, ry);
      c.lineTo(rx + rw, ry + rh);
      c.lineTo(rx, ry + rh);
      c.closePath();
      if (fill) c.fill();
      c.stroke();
    } else if (tool === 'diamond') {
      const rx = Math.min(x1,x2), ry = Math.min(y1,y2);
      const rw = Math.abs(x2-x1), rh = Math.abs(y2-y1);
      c.moveTo(rx + rw/2, ry);
      c.lineTo(rx + rw, ry + rh/2);
      c.lineTo(rx + rw/2, ry + rh);
      c.lineTo(rx, ry + rh/2);
      c.closePath();
      if (fill) c.fill();
      c.stroke();
    } else if (tool === 'star') {
      const cx = (x1+x2)/2, cy = (y1+y2)/2;
      const rOut = Math.max(Math.abs(x2-x1), Math.abs(y2-y1)) / 2;
      const rIn  = rOut * 0.42;
      for (let i = 0; i < 10; i++) {
        const ang = (Math.PI / 5) * i - Math.PI / 2;
        const r   = i % 2 === 0 ? rOut : rIn;
        const px  = cx + r * Math.cos(ang);
        const py  = cy + r * Math.sin(ang);
        i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
      }
      c.closePath();
      if (fill) c.fill();
      c.stroke();
    }
    c.restore();
  }

  /* ── Pointer helpers ── */
  function getScreen(e) {
    // Must be measured against wrap, not overlay/canvas — those are now
    // CSS-positioned at (panX, panY) inside wrap, so using their own rect
    // would double-count the pan offset once screenToBoard subtracts panX/panY.
    // Uses the cached wrapRect (see updateWrapRect) instead of calling
    // getBoundingClientRect() here directly — this runs on every mousemove.
    const cl = e.touches ? e.touches[0] : e;
    return { x: cl.clientX - wrapRect.left, y: cl.clientY - wrapRect.top };
  }
  function getBoard(e) { const s = getScreen(e); return screenToBoard(s.x, s.y); }

  /* ── Pointer down ── */
  function onDown(e) {
    e.preventDefault();
    const sc = getScreen(e);
    const bd = screenToBoard(sc.x, sc.y);

    if (tool === 'hand') {
      isPanning = true;
      panStart  = { x: sc.x - panX, y: sc.y - panY };
      overlay.style.cursor = 'grabbing';
      return;
    }
    if (tool === 'text') { placeText(bd.x, bd.y); return; }
    if (tool === 'select' && floatImg) return; // finish the current floating selection first

    // Select tool: a plain click landing directly on a previously-placed
    // image grabs it immediately (move/resize/delete handles), instead of
    // needing a full drag-select rectangle around it every time.
    if (tool === 'select') {
      const hit = placedObjects.find(p => bd.x >= p.bx && bd.x <= p.bx + p.bw && bd.y >= p.by && bd.y <= p.by + p.bh);
      if (hit && hit.shape) { showShapeAnimateButton(hit, sc); return; }
      if (hit) { liftSelection(hit.bx, hit.by, hit.bx + hit.bw, hit.by + hit.bh); return; }
    }

    drawing = true;
    const p = clampToBoard(bd.x, bd.y);
    startX = lastX = p.x;
    startY = lastY = p.y;
    saveHistory();

    if (['pen','highlight','eraser'].includes(tool)) {
      if (tool === 'highlight') {
        // fresh full-opacity scratch layer for this stroke — see hlCvs above
        hlCvs.width = canvas.width;
        hlCvs.height = canvas.height;
        hlCtx.save();
        hlCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        applyStroke(hlCtx);
        hlCtx.globalAlpha = 1;
        hlCtx.lineWidth   = (size * 6) / scale;
        hlCtx.beginPath();
        hlCtx.moveTo(p.x, p.y);
        hlCtx.restore();
      } else {
        ctx.save();
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        applyStroke(ctx);
        if (tool === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.lineWidth = (size * 4) / scale;
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.restore();
      }
      smoothRawX = smoothMidX = p.x;
      smoothRawY = smoothMidY = p.y;
    }
  }

  /* ── Pointer move ── */
  const coordsLabel = document.getElementById('wbCoordsLabel');
  function onMove(e) {
    e.preventDefault();
    const sc = getScreen(e);
    const bd = screenToBoard(sc.x, sc.y);
    const cl = clampToBoard(bd.x, bd.y);

    coordsLabel.textContent = `${Math.round(cl.x)}, ${Math.round(cl.y)}`;

    if (isPanning) {
      panX = sc.x - panStart.x;
      panY = sc.y - panStart.y;
      clampPan();
      applyTransform();
      return;
    }

    if (!drawing) return;

    if (['pen','highlight','eraser'].includes(tool)) {
      const target = tool === 'highlight' ? hlCtx : ctx;
      target.save();
      target.setTransform(DPR, 0, 0, DPR, 0, 0);
      applyStroke(target);
      if (tool === 'eraser') {
        target.globalCompositeOperation = 'destination-out';
        target.lineWidth = (size * 4) / scale;
        target.globalAlpha = 1;
      } else if (tool === 'highlight') {
        // full opacity here — the whole scratch layer gets composited onto
        // the board at the real 0.35 highlighter alpha exactly once, in
        // onUp, instead of stacking translucency per segment (see hlCvs).
        target.globalAlpha = 1;
        target.lineWidth   = (size * 6) / scale;
      }
      /* quadratic curve through midpoints, using the previous raw sample as
         the control point — smooths out the faceted look of raw lineTo
         segments on fast or curved strokes */
      const newMidX = (smoothRawX + cl.x) / 2;
      const newMidY = (smoothRawY + cl.y) / 2;
      target.beginPath();
      target.moveTo(smoothMidX, smoothMidY);
      target.quadraticCurveTo(smoothRawX, smoothRawY, newMidX, newMidY);
      target.stroke();
      smoothMidX = newMidX;
      smoothMidY = newMidY;
      smoothRawX = cl.x;
      smoothRawY = cl.y;
      target.restore();
      if (tool === 'highlight') {
        // live on-screen feedback: one full-canvas composite of the
        // opaque scratch layer at the real alpha, replacing the previous
        // preview each frame rather than blending onto it.
        octx.save();
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, overlay.width, overlay.height);
        octx.globalAlpha = 0.35;
        octx.drawImage(hlCvs, 0, 0);
        octx.globalAlpha = 1;
        octx.restore();
      }
    } else if (tool === 'select') {
      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.restore();
      drawSelectionRect(startX, startY, cl.x, cl.y);
    } else {
      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.restore();
      drawShape(octx, startX, startY, cl.x, cl.y);
    }
    lastX = cl.x; lastY = cl.y;
  }

  function drawSelectionRect(x1, y1, x2, y2) {
    octx.save();
    octx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    octx.fillStyle = 'rgba(79,70,229,.08)';
    octx.fillRect(x, y, w, h);
    octx.strokeStyle = '#4f46e5';
    octx.lineWidth = 1.5 / scale;
    octx.setLineDash([6 / scale, 4 / scale]);
    octx.strokeRect(x, y, w, h);
    octx.restore();
  }

  /* ── Pointer up ── */
  function onUp(e) {
    if (isPanning) {
      isPanning = false;
      overlay.style.cursor = 'grab';
      return;
    }

    if (!drawing) return;
    drawing = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    if (tool === 'highlight') {
      // composite the whole opaque scratch stroke onto the real board
      // exactly once, at the real translucency — see hlCvs above.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(hlCvs, 0, 0);
      ctx.restore();
      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.restore();
    } else if (['line','arrow','rect','circle','triangle','diamond','star'].includes(tool)) {
      const bd = getBoard(e);
      const cl = clampToBoard(bd.x || lastX, bd.y || lastY);
      drawShape(ctx, startX, startY, cl.x, cl.y);
      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.restore();
      // track this shape's bounds so the select tool can grab it with one
      // click later — a little stroke-width padding so thin lines/shapes
      // (e.g. a straight horizontal line, near-zero height) stay clickable.
      const pad = Math.max(6, size);
      const bx = Math.min(startX, cl.x) - pad, by = Math.min(startY, cl.y) - pad;
      const bw = Math.abs(cl.x - startX) + pad * 2, bh = Math.abs(cl.y - startY) + pad * 2;
      if (bw > 6 && bh > 6) {
        // geometry + the exact style it was drawn with, so the 🎬
        // construction-animation button can replay this specific shape
        // later even if the teacher has since changed color/size/fill.
        const geom = getShapeGeometry(tool, startX, startY, cl.x, cl.y);
        const shape = geom ? { ...geom, color, size, opacity, fill } : null;
        placedObjects.push({ bx, by, bw, bh, shape });
      }
    } else if (tool === 'select') {
      const bd = getBoard(e);
      const cl = clampToBoard(bd.x || lastX, bd.y || lastY);
      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.restore();
      liftSelection(startX, startY, cl.x, cl.y);
    }
  }

  /* Lifts a rectangular region of already-drawn content (freehand strokes,
     shapes, pasted images, templates — it's all just pixels) into the same
     floating move/resize overlay used for images and templates, clearing it
     from the board in the meantime. cancelFloatImg() restores it if the
     user backs out instead of confirming or deleting. */
  function liftSelection(x1, y1, x2, y2) {
    const bx = Math.min(x1, x2), by = Math.min(y1, y2);
    const bw = Math.abs(x2 - x1), bh = Math.abs(y2 - y1);
    if (bw < 6 || bh < 6) return; // ignore accidental clicks/tiny drags

    const oc = document.createElement('canvas');
    oc.width  = Math.round(bw * DPR);
    oc.height = Math.round(bh * DPR);
    const c = oc.getContext('2d');
    c.drawImage(canvas, bx * DPR, by * DPR, bw * DPR, bh * DPR, 0, 0, oc.width, oc.height);

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(bx, by, bw, bh);
    ctx.restore();

    // any tracked image whose pixels just got cleared out from under it is
    // no longer "there" to one-click-grab later — commitFloatImg re-adds it
    // (at its possibly-new bounds) if the user re-commits instead of deleting.
    placedObjects = placedObjects.filter(p =>
      p.bx + p.bw <= bx || p.bx >= bx + bw || p.by + p.bh <= by || p.by >= by + bh);

    liftedFrom = { bx, by, bw, bh };
    const img = new Image();
    img.onload = () => {
      showFloatImg(img, bx * scale + panX, by * scale + panY, bw * scale, bh * scale);
    };
    img.src = oc.toDataURL('image/png');
  }

  overlay.addEventListener('mousedown',  onDown, { passive:false });
  overlay.addEventListener('mousemove',  onMove, { passive:false });
  overlay.addEventListener('mouseup',    onUp);
  overlay.addEventListener('mouseleave', onUp);
  overlay.addEventListener('touchstart', onDown, { passive:false });
  overlay.addEventListener('touchmove',  onMove, { passive:false });
  overlay.addEventListener('touchend',   onUp);

  /* ── Wheel zoom ── */
  overlay.addEventListener('wheel', e => {
    e.preventDefault();
    doZoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - wrapRect.left, e.clientY - wrapRect.top);
  }, { passive:false });

  /* ── Pinch zoom ── */
  let lastPinch = 0;
  overlay.addEventListener('touchstart', e => {
    if (e.touches.length === 2)
      lastPinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  }, { passive:true });
  overlay.addEventListener('touchmove', e => {
    if (e.touches.length !== 2) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - wrapRect.left;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - wrapRect.top;
    doZoom(d / lastPinch, cx, cy);
    lastPinch = d;
  }, { passive:true });

  function doZoom(factor, cx, cy) {
    // never zoom out past the "cover" fit — below that, the board can't
    // fill wrap anymore and blank margins show no matter how panning is clamped
    const minScale = Math.max(wrap.clientWidth / BOARD_W, wrap.clientHeight / BOARD_H);
    const ns = Math.min(Math.max(scale * factor, minScale), 8);
    panX = cx - (cx - panX) * (ns / scale);
    panY = cy - (cy - panY) * (ns / scale);
    scale = ns;
    clampPan();
    applyTransform();
    updateZoomLabel();
  }

  function updateZoomLabel() {
    const t = Math.round(scale * 100) + '%';
    const labelEl = document.getElementById('wbZoomLabel');
    const statusEl = document.getElementById('wbZoomStatus');
    if (labelEl) labelEl.textContent = t;
    if (statusEl) statusEl.textContent = t;
  }

  document.getElementById('wbZoomIn').addEventListener('click',    () => doZoom(1.2, wrap.clientWidth/2, wrap.clientHeight/2));
  document.getElementById('wbZoomOut').addEventListener('click',   () => doZoom(0.8, wrap.clientWidth/2, wrap.clientHeight/2));
  document.getElementById('wbZoomReset').addEventListener('click', () => { centerBoard(); });

  /* ── Spotlight: dims the whole board except a circle around the cursor —
     pure CSS (box-shadow spread as the dim layer), pointer-events:none so
     drawing/panning underneath still works exactly as before while it's on. */
  (function setupSpotlight() {
    const spot       = document.getElementById('wbSpotlight');
    const toggleBtn  = document.getElementById('wbSpotlightToggle');
    const biggerBtn  = document.getElementById('wbSpotlightBigger');
    const smallerBtn = document.getElementById('wbSpotlightSmaller');
    if (!spot || !toggleBtn) return;

    let active = false;
    let size   = 220;

    function moveSpot(e) {
      const cl = e.touches ? e.touches[0] : e;
      spot.style.left = (cl.clientX - wrapRect.left) + 'px';
      spot.style.top  = (cl.clientY - wrapRect.top)  + 'px';
    }
    function setSize(px) {
      size = Math.min(600, Math.max(80, px));
      spot.style.setProperty('--wb-spot-size', size + 'px');
    }

    toggleBtn.addEventListener('click', () => {
      active = !active;
      toggleBtn.classList.toggle('active', active);
      spot.style.display = active ? 'block' : 'none';
      if (active) { setSize(size); wrap.addEventListener('mousemove', moveSpot); wrap.addEventListener('touchmove', moveSpot); }
      else { wrap.removeEventListener('mousemove', moveSpot); wrap.removeEventListener('touchmove', moveSpot); }
    });
    biggerBtn?.addEventListener('click',  () => setSize(size + 40));
    smallerBtn?.addEventListener('click', () => setSize(size - 40));
  })();

  /* ── Scientific calculator: floating draggable panel, powered by math.js
     (served locally at /vendor/mathjs, same "no CDN" approach as pdf.js)
     loaded lazily on first open so pages that never touch it pay nothing. */
  (function setupCalculator() {
    const panel     = document.getElementById('wbCalc');
    const toggleBtn = document.getElementById('wbCalcToggle');
    const closeBtn  = document.getElementById('wbCalcClose');
    const head      = document.getElementById('wbCalcHead');
    const exprEl    = document.getElementById('wbCalcExpr');
    const resultEl  = document.getElementById('wbCalcResult');
    if (!panel || !toggleBtn) return;

    let expr = '';
    let mathLib = null;
    function loadMathLib() {
      if (mathLib) return Promise.resolve(mathLib);
      if (window.math) { mathLib = window.math; return Promise.resolve(mathLib); }
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'http://localhost:5000/vendor/mathjs/math.js';
        s.onload = () => { mathLib = window.math; resolve(mathLib); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    function render() {
      exprEl.textContent = expr;
      if (!expr) { resultEl.textContent = '0'; return; }
      try {
        const val = mathLib.evaluate(expr);
        resultEl.textContent = mathLib.format(val, { precision: 10 });
      } catch { resultEl.textContent = '…'; }
    }

    panel.querySelectorAll('.wb-calc-pad button').forEach(btn => {
      btn.addEventListener('click', async () => {
        await loadMathLib();
        const k = btn.dataset.k;
        if (k === 'AC') { expr = ''; }
        else if (k === 'DEL') { expr = expr.slice(0, -1); }
        else if (k === '=') {
          try { expr = mathLib.format(mathLib.evaluate(expr), { precision: 10 }); }
          catch { /* keep expr as-is on invalid expression */ }
        } else {
          expr += k;
        }
        render();
      });
    });

    toggleBtn.addEventListener('click', async () => {
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'block' : 'none';
      toggleBtn.classList.toggle('active', opening);
      if (opening) await loadMathLib();
    });
    closeBtn?.addEventListener('click', () => { panel.style.display = 'none'; toggleBtn.classList.remove('active'); });

    /* drag by the header, position kept in px relative to wrap */
    let dragOffset = null;
    function dragMove(e) {
      if (!dragOffset) return;
      const cl = e.touches ? e.touches[0] : e;
      panel.style.left = Math.max(0, cl.clientX - wrapRect.left - dragOffset.x) + 'px';
      panel.style.top  = Math.max(0, cl.clientY - wrapRect.top  - dragOffset.y) + 'px';
    }
    head?.addEventListener('mousedown', e => {
      const r = panel.getBoundingClientRect();
      dragOffset = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', () => { dragOffset = null; });
  })();

  /* ── Graph tool: plot y=f(x) as an image placed on the board (math
     subject tool) — reuses the same math.js instance the calculator loads,
     and the same floating-image placement flow templates/inserted images
     use, so the plotted graph is movable/resizable/deletable like anything
     else once placed. ── */
  (function setupGraphTool() {
    const panel    = document.getElementById('wbGraph');
    const toggleBtn = document.getElementById('wbGraphToggle');
    const closeBtn  = document.getElementById('wbGraphClose');
    const head      = document.getElementById('wbGraphHead');
    const eq1El     = document.getElementById('wbGraphEq1');
    const eq2El     = document.getElementById('wbGraphEq2');
    const xMinEl    = document.getElementById('wbGraphXMin');
    const xMaxEl    = document.getElementById('wbGraphXMax');
    const msgEl     = document.getElementById('wbGraphMsg');
    const plotBtn   = document.getElementById('wbGraphPlot');
    const typeTabs  = document.getElementById('wbGraphTypeTabs');
    const fnFields  = document.getElementById('wbGraphFnFields');
    const barFields = document.getElementById('wbGraphBarFields');
    const barValuesEl = document.getElementById('wbGraphBarValues');
    const barLabelsEl = document.getElementById('wbGraphBarLabels');
    if (!panel || !toggleBtn) return;

    let graphType = 'line';
    typeTabs?.querySelectorAll('.wb-graph-type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        graphType = tab.dataset.graphtype;
        typeTabs.querySelectorAll('.wb-graph-type-tab').forEach(t => t.classList.toggle('active', t === tab));
        fnFields.style.display  = graphType === 'line' ? 'block' : 'none';
        barFields.style.display = graphType === 'bar'  ? 'block' : 'none';
      });
    });

    let mathLib = null;
    function loadMathLib() {
      if (mathLib) return Promise.resolve(mathLib);
      if (window.math) { mathLib = window.math; return Promise.resolve(mathLib); }
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'http://localhost:5000/vendor/mathjs/math.js';
        s.onload = () => { mathLib = window.math; resolve(mathLib); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    function showMsg(text) {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.style.display = text ? 'block' : 'none';
    }

    const COLORS = ['#4f46e5', '#ef4444'];

    function renderGraphImage(equations, xMin, xMax) {
      const W = 640, H = 460;
      const padL = 42, padR = 16, padT = 16, padB = 32;
      const plotW = W - padL - padR, plotH = H - padT - padB;

      const SAMPLES = 400;
      const series = equations.map(eq => {
        const pts = [];
        for (let i = 0; i <= SAMPLES; i++) {
          const x = xMin + (xMax - xMin) * (i / SAMPLES);
          let y;
          try { y = mathLib.evaluate(eq, { x }); } catch { y = NaN; }
          pts.push({ x, y: (typeof y === 'number' && isFinite(y)) ? y : NaN });
        }
        return pts;
      });

      // auto-scale y using the 2nd–98th percentile of finite samples, so a
      // single asymptote spike doesn't blow out the whole vertical range
      const finiteYs = series.flat().map(p => p.y).filter(y => !isNaN(y)).sort((a, b) => a - b);
      let yMin = -10, yMax = 10;
      if (finiteYs.length > 4) {
        yMin = finiteYs[Math.floor(finiteYs.length * 0.02)];
        yMax = finiteYs[Math.ceil(finiteYs.length * 0.98) - 1];
        if (yMax - yMin < 1e-6) { yMin -= 5; yMax += 5; }
        const pad = (yMax - yMin) * 0.1;
        yMin -= pad; yMax += pad;
      }

      const oc = document.createElement('canvas');
      oc.width = W; oc.height = H;
      const c = oc.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, W, H);

      const toPx = (x, y) => ({
        px: padL + ((x - xMin) / (xMax - xMin)) * plotW,
        py: padT + (1 - (y - yMin) / (yMax - yMin)) * plotH,
      });

      // grid
      c.strokeStyle = '#e5e7eb';
      c.lineWidth = 1;
      const gridStepsX = 10, gridStepsY = 8;
      for (let i = 0; i <= gridStepsX; i++) {
        const x = xMin + (xMax - xMin) * (i / gridStepsX);
        const { px } = toPx(x, 0);
        c.beginPath(); c.moveTo(px, padT); c.lineTo(px, H - padB); c.stroke();
        c.fillStyle = '#6b7280'; c.font = '10px sans-serif'; c.textAlign = 'center';
        c.fillText(Math.round(x * 100) / 100, px, H - padB + 14);
      }
      for (let i = 0; i <= gridStepsY; i++) {
        const y = yMin + (yMax - yMin) * (i / gridStepsY);
        const { py } = toPx(0, y);
        c.beginPath(); c.moveTo(padL, py); c.lineTo(W - padR, py); c.stroke();
        c.fillStyle = '#6b7280'; c.font = '10px sans-serif'; c.textAlign = 'right';
        c.fillText(Math.round(y * 100) / 100, padL - 6, py + 3);
      }

      // axes (x=0 / y=0), only drawn if within range
      c.strokeStyle = '#111827';
      c.lineWidth = 1.5;
      if (xMin <= 0 && xMax >= 0) {
        const { px } = toPx(0, 0);
        c.beginPath(); c.moveTo(px, padT); c.lineTo(px, H - padB); c.stroke();
      }
      if (yMin <= 0 && yMax >= 0) {
        const { py } = toPx(0, 0);
        c.beginPath(); c.moveTo(padL, py); c.lineTo(W - padR, py); c.stroke();
      }
      c.strokeStyle = '#9ca3af';
      c.strokeRect(padL, padT, plotW, plotH);

      // curves
      series.forEach((pts, i) => {
        c.strokeStyle = COLORS[i % COLORS.length];
        c.lineWidth = 2.5;
        c.beginPath();
        let started = false;
        pts.forEach(p => {
          if (isNaN(p.y) || p.y < yMin - (yMax - yMin) || p.y > yMax + (yMax - yMin)) { started = false; return; }
          const { px, py } = toPx(p.x, p.y);
          if (!started) { c.moveTo(px, py); started = true; }
          else c.lineTo(px, py);
        });
        c.stroke();
      });

      // legend
      equations.forEach((eq, i) => {
        c.fillStyle = COLORS[i % COLORS.length];
        c.font = 'bold 12px monospace';
        c.textAlign = 'left';
        c.fillText(`y = ${eq}`, padL + 6, padT + 14 + i * 16);
      });

      return oc.toDataURL('image/png');
    }

    const BAR_COLORS = ['#4f46e5', '#f97316', '#10b981', '#ef4444', '#0ea5e9', '#eab308', '#8b5cf6', '#ec4899'];

    function renderBarChartImage(values, labels) {
      const W = 560, H = 420;
      const padL = 50, padR = 16, padT = 20, padB = 50;
      const plotW = W - padL - padR, plotH = H - padT - padB;

      const maxVal = Math.max(...values, 0);
      const niceMax = maxVal <= 0 ? 1 : maxVal * 1.15;

      const oc = document.createElement('canvas');
      oc.width = W; oc.height = H;
      const c = oc.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, W, H);

      // horizontal grid lines + y-axis labels
      c.strokeStyle = '#e5e7eb';
      c.lineWidth = 1;
      const gridSteps = 5;
      for (let i = 0; i <= gridSteps; i++) {
        const v = (niceMax / gridSteps) * i;
        const y = padT + plotH - (v / niceMax) * plotH;
        c.beginPath(); c.moveTo(padL, y); c.lineTo(W - padR, y); c.stroke();
        c.fillStyle = '#6b7280'; c.font = '10px sans-serif'; c.textAlign = 'right';
        c.fillText(Math.round(v * 100) / 100, padL - 6, y + 3);
      }

      const n = values.length;
      const slot = plotW / n;
      const barW = Math.min(slot * 0.6, 70);

      values.forEach((v, i) => {
        const barH = (Math.max(v, 0) / niceMax) * plotH;
        const x = padL + slot * i + (slot - barW) / 2;
        const y = padT + plotH - barH;
        c.fillStyle = BAR_COLORS[i % BAR_COLORS.length];
        c.beginPath();
        const r = 5;
        c.moveTo(x, y + r);
        c.arcTo(x, y, x + r, y, r);
        c.lineTo(x + barW - r, y);
        c.arcTo(x + barW, y, x + barW, y + r, r);
        c.lineTo(x + barW, padT + plotH);
        c.lineTo(x, padT + plotH);
        c.closePath();
        c.fill();

        // value on top of the bar
        c.fillStyle = '#1e293b';
        c.font = 'bold 11px sans-serif';
        c.textAlign = 'center';
        c.fillText(v, x + barW / 2, y - 6);

        // label under the bar
        const label = labels[i] || String(i + 1);
        c.fillStyle = '#374151';
        c.font = '11px Cairo, sans-serif';
        c.fillText(label, x + barW / 2, padT + plotH + 18);
      });

      c.strokeStyle = '#9ca3af';
      c.strokeRect(padL, padT, plotW, plotH);

      return oc.toDataURL('image/png');
    }

    function placeImage(dataUrl) {
      const img = new Image();
      img.onload = () => {
        const maxW = wrap.clientWidth  * 0.55;
        const maxH = wrap.clientHeight * 0.55;
        const sc2 = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * sc2, h = img.height * sc2;
        const cx = wrap.clientWidth / 2, cy = wrap.clientHeight / 2;
        showFloatImg(img, cx - w / 2, cy - h / 2, w, h);
      };
      img.src = dataUrl;
    }

    plotBtn?.addEventListener('click', async () => {
      showMsg('');

      if (graphType === 'bar') {
        const values = barValuesEl.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
        if (!values.length) { showMsg('اكتب قيمة واحدة على الأقل، مفصولة بفاصلة'); return; }
        const labels = barLabelsEl.value.split(',').map(s => s.trim());
        placeImage(renderBarChartImage(values, labels));
        return;
      }

      const eqs = [eq1El.value.trim(), eq2El.value.trim()].filter(Boolean);
      if (!eqs.length) { showMsg('اكتب معادلة واحدة على الأقل'); return; }
      const xMin = parseFloat(xMinEl.value), xMax = parseFloat(xMaxEl.value);
      if (!isFinite(xMin) || !isFinite(xMax) || xMin >= xMax) { showMsg('نطاق x غير صحيح'); return; }

      await loadMathLib();
      // validate each equation with a single test sample before committing
      // to a full render, so a typo shows a friendly Arabic message instead
      // of silently plotting a blank/garbage graph
      for (const eq of eqs) {
        try { mathLib.evaluate(eq, { x: (xMin + xMax) / 2 }); }
        catch { showMsg(`معادلة غير صحيحة: ${eq}`); return; }
      }

      placeImage(renderGraphImage(eqs, xMin, xMax));
    });

    toggleBtn.addEventListener('click', async () => {
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'block' : 'none';
      toggleBtn.classList.toggle('active', opening);
      if (opening) await loadMathLib();
    });
    closeBtn?.addEventListener('click', () => { panel.style.display = 'none'; toggleBtn.classList.remove('active'); });

    /* drag by the header, same pattern as the calculator panel */
    let dragOffset = null;
    function dragMove(e) {
      if (!dragOffset) return;
      const cl = e.touches ? e.touches[0] : e;
      panel.style.left = Math.max(0, cl.clientX - wrapRect.left - dragOffset.x) + 'px';
      panel.style.top  = Math.max(0, cl.clientY - wrapRect.top  - dragOffset.y) + 'px';
    }
    head?.addEventListener('mousedown', e => {
      const r = panel.getBoundingClientRect();
      dragOffset = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', () => { dragOffset = null; });
  })();

  /* ── Encouragement toast: one button, random phrase + confetti + spoken aloud ── */
  (function setupEncouragement(){
    const btn = document.getElementById('wbEncourage');
    if (!btn) return;

    const PHRASES = [
      { text: 'برافو!',      emoji: '👏' },
      { text: 'ممتاز!',      emoji: '🌟' },
      { text: 'أحسنت!',      emoji: '👍' },
      { text: 'رائع!',       emoji: '🎉' },
      { text: 'شاطر!',       emoji: '💪' },
      { text: 'تألقت!',      emoji: '✨' },
      { text: 'عاش!',        emoji: '🔥' },
      { text: 'ممتاز جدًا!', emoji: '🏆' }
    ];
    const CONFETTI_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

    let audioCtx;
    function ensureAudio() {
      if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) {} }
    }
    function playChime() {
      ensureAudio();
      if (!audioCtx) return;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const t = audioCtx.currentTime + i * 0.09;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        osc.start(t); osc.stop(t + 0.35);
      });
    }
    function spawnConfetti(container, count) {
      for (let i = 0; i < count; i++) {
        const piece = document.createElement('div');
        piece.className = 'wb-encourage-confetti';
        const left = Math.random() * 100;
        const drift = (Math.random() - 0.5) * 200;
        const duration = 1.4 + Math.random() * 1.2;
        const delay = Math.random() * 0.3;
        piece.style.left = left + 'vw';
        piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        piece.style.setProperty('--drift', drift + 'px');
        piece.style.animationDuration = duration + 's';
        piece.style.animationDelay = delay + 's';
        container.appendChild(piece);
      }
    }

    btn.addEventListener('click', () => {
      const pick = PHRASES[Math.floor(Math.random() * PHRASES.length)];

      const overlay = document.createElement('div');
      overlay.className = 'wb-encourage-overlay';
      const card = document.createElement('div');
      card.className = 'wb-encourage-card';
      card.innerHTML = `<span class="wb-encourage-emoji">${pick.emoji}</span><span>${pick.text}</span>`;
      overlay.appendChild(card);
      spawnConfetti(overlay, 40);
      // Append inside the whiteboard's own fullscreen element (.wb-root),
      // not document.body — the Fullscreen API only renders the fullscreen
      // element and its descendants, so anything appended to body (an
      // ancestor of .wb-root, not a descendant) was invisible whenever the
      // teacher had the whiteboard in fullscreen mode.
      const mountPoint = document.querySelector('.wb-root') || document.body;
      mountPoint.appendChild(overlay);

      playChime();

      setTimeout(() => overlay.remove(), 2300);
    });
  })();

  /* ── Text tool ── */
  function placeText(bx, by) {
    const sx = bx * scale + panX;
    const sy = by * scale + panY;
    textBox.style.display  = 'block';
    textBox.style.left     = sx + 'px';
    textBox.style.top      = sy + 'px';
    textBox.style.color    = color;
    textBox.style.fontSize = textSize + 'px';
    textBox.style.opacity  = opacity;
    textBox.textContent    = '';
    textBox.focus();
  }
  textBox.addEventListener('blur', () => {
    const txt = textBox.textContent.trim();
    if (txt) {
      saveHistory();
      const bd = screenToBoard(parseInt(textBox.style.left), parseInt(textBox.style.top));
      // font-size (like stroke width) is specified in board-space units
      // divided by scale, so the committed text keeps the same on-screen
      // CSS-px size the editable textbox showed, regardless of zoom level
      const fontSizeCss = parseInt(textBox.style.fontSize);
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.font        = `700 ${fontSizeCss / scale}px Cairo, sans-serif`;
      ctx.fillStyle   = color;
      ctx.globalAlpha = opacity;
      ctx.fillText(txt, bd.x, bd.y + fontSizeCss / scale);
      ctx.restore();
    }
    textBox.style.display = 'none';
  });
  textBox.addEventListener('keydown', e => {
    if (e.key === 'Escape') { textBox.textContent = ''; textBox.blur(); }
  });

  /* ── Fullscreen ── */
  const fsBtn  = document.getElementById('wbFullscreen');
  const fsIcon = document.getElementById('wbFsIcon');
  const FS_ON  = `<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>`;
  const FS_OFF = `<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>`;

  const wbRoot = document.querySelector('.wb-root');

  /* ── Manual tool-size override (floating +/− buttons) ──
     The automatic clamp()-based sizing only shrinks buttons/icons down to a
     fixed floor; on a small/short screen with many tool groups the overflow
     just scrolls out of view instead of shrinking further. These buttons
     let the teacher scale the whole toolbar/sidebar past that floor,
     persisted across sessions per-device. */
  (function setupUiScaleControl() {
    const UI_SCALE_KEY = 'wb_ui_scale';
    const UI_SCALE_MIN = 0.55;
    const UI_SCALE_MAX = 1.15;
    const UI_SCALE_STEP = 0.05;

    const upBtn = document.getElementById('wbUiScaleUp');
    const downBtn = document.getElementById('wbUiScaleDown');
    const resetBtn = document.getElementById('wbUiScaleReset');
    if (!wbRoot || !upBtn || !downBtn || !resetBtn) return;

    let scale = 1;
    try {
      const saved = parseFloat(localStorage.getItem(UI_SCALE_KEY));
      if (Number.isFinite(saved) && saved >= UI_SCALE_MIN && saved <= UI_SCALE_MAX) scale = saved;
    } catch {}

    function applyScale() {
      wbRoot.style.setProperty('--wb-ui-scale', String(scale));
      try { localStorage.setItem(UI_SCALE_KEY, String(scale)); } catch {}
    }
    applyScale();

    upBtn.addEventListener('click', () => {
      scale = Math.min(UI_SCALE_MAX, Math.round((scale + UI_SCALE_STEP) * 100) / 100);
      applyScale();
    });
    downBtn.addEventListener('click', () => {
      scale = Math.max(UI_SCALE_MIN, Math.round((scale - UI_SCALE_STEP) * 100) / 100);
      applyScale();
    });
    resetBtn.addEventListener('click', () => {
      scale = 1;
      applyScale();
    });
  })();

  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      (wbRoot || document.documentElement).requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
  /* Quick-tools copy — the main header's own quick-tools button is outside
     .wb-root and disappears once the whiteboard goes fullscreen, so mirror
     it here and only show it while fullscreen is active.
     Self-contained on purpose: this whiteboard page can be hosted either
     inside the app's SPA shell (where router.js provides window.initQtWidget
     and a global [data-qt] click handler) or standalone in a bare iframe
     (e.g. embedded as a lesson-content "whiteboard" slide, which loads none
     of that) — so it can't rely on router.js being present. */
  const wbQuickTools = document.getElementById('wbQuickTools');
  const wbQtToggle    = document.getElementById('wbQtToggle');
  const wbQtMenu      = document.getElementById('wbQtMenu');
  if (wbQtToggle && wbQtMenu) {
    const setQtOpen = open => {
      wbQtMenu.hidden = !open;
      wbQtToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    wbQtToggle.addEventListener('click', e => { e.stopPropagation(); setQtOpen(wbQtMenu.hidden); });
    document.addEventListener('click', e => {
      if (!wbQtToggle.contains(e.target) && !wbQtMenu.contains(e.target)) setQtOpen(false);
    });
    wbQtMenu.querySelectorAll('[data-qt]').forEach(btn => {
      btn.addEventListener('click', async () => {
        setQtOpen(false);
        const t = btn.getAttribute('data-qt');
        try {
          if (t === 'timer' && window.api?.openToolWindow) await window.api.openToolWindow('timer');
          else if (t === 'wheel' && window.api?.openWheelWindow) window.api.openWheelWindow();
          else if (t === 'numbers') {
            if (window.api?.openToolWindow) await window.api.openToolWindow('numbers');
            else if (window.api?.openNumbersWindow) await window.api.openNumbersWindow();
            else window.open('/pages/numbers-standalone.html', '_blank');
          } else if (t === 'names') {
            if (window.api?.openToolWindow) await window.api.openToolWindow('names');
            else window.open('/pages/names.html', '_blank');
          }
        } catch (err) { console.error('Quick tool error:', err); }
      });
    });
  }

  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    fsIcon.innerHTML = on ? FS_OFF : FS_ON;
    fsBtn.classList.toggle('active', on);
    if (wbQuickTools) wbQuickTools.style.display = on ? 'block' : 'none';
    // don't rely solely on the ResizeObserver picking up wrap's new size —
    // recompute the fullscreen-aware pan padding (see centerBoard) right away
    centerBoard();
    updateWrapRect();
  });

  /* ── Math tools dropdown: calculator + graph + geometry stamps, all under
     one icon (see wbMathToolsBtn/wbMathToolsMenu) instead of a separate
     topbar icon each. The calculator/graph menu items keep their original
     ids (wbCalcToggle/wbGraphToggle) so setupCalculator/setupGraphTool's
     own click listeners (which open their respective panels) still work
     unchanged — this wiring only adds "close the dropdown" on top. ── */
  const mathToolsBtn  = document.getElementById('wbMathToolsBtn');
  const mathToolsMenu = document.getElementById('wbMathToolsMenu');
  if (mathToolsBtn && mathToolsMenu) {
    const setMathToolsOpen = open => {
      if (open) {
        const r = mathToolsBtn.getBoundingClientRect();
        mathToolsMenu.hidden = false;
        const mw = mathToolsMenu.getBoundingClientRect().width;
        mathToolsMenu.style.top  = (r.bottom + 6) + 'px';
        let left = r.left;
        if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
        mathToolsMenu.style.left = Math.max(8, left) + 'px';
      } else {
        mathToolsMenu.hidden = true;
      }
    };
    mathToolsBtn.addEventListener('click', e => { e.stopPropagation(); setMathToolsOpen(mathToolsMenu.hidden); });
    document.addEventListener('click', e => {
      if (!mathToolsBtn.contains(e.target) && !mathToolsMenu.contains(e.target)) setMathToolsOpen(false);
    });
    mathToolsMenu.querySelectorAll('.hqt-item').forEach(btn => {
      btn.addEventListener('click', () => setMathToolsOpen(false));
    });

    // Geometry stamps (منقلة/مسطرة) — rendered as an SVG image and dropped
    // onto the board via the same floating-image placement flow the graph
    // tool and templates already use (movable/resizable/deletable once
    // placed, grabbable again with one click via the select tool).
    mathToolsMenu.querySelectorAll('[data-mathtool]').forEach(btn => {
      btn.addEventListener('click', () => insertGeometryTool(btn.dataset.mathtool));
    });
  }

  function insertGeometryTool(kind) {
    let svg;
    if (kind === 'protractor') {
      const cx0 = 160, cy0 = 175, R = 150;
      // ticks every 10°, a longer/bolder tick every 30° (major, numbered)
      const ticks = Array.from({ length: 19 }).map((_, i) => {
        const deg = i * 10;
        const angle = deg * Math.PI / 180;
        const major = deg % 30 === 0;
        const outerR = R, innerR = major ? R - 18 : R - 10;
        const x1 = cx0 - outerR * Math.cos(angle), y1 = cy0 - outerR * Math.sin(angle);
        const x2 = cx0 - innerR * Math.cos(angle), y2 = cy0 - innerR * Math.sin(angle);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1e293b" stroke-width="${major ? 2 : 1}"/>`;
      }).join('');
      // degree numbers just outside the arc at every major (30°) tick —
      // kept upright (not rotated along the arc) so they stay readable on
      // a projected screen from any angle in the room
      const labels = Array.from({ length: 7 }).map((_, i) => {
        const deg = i * 30;
        const angle = deg * Math.PI / 180;
        const labelR = R + 16;
        const x = cx0 - labelR * Math.cos(angle), y = cy0 - labelR * Math.sin(angle);
        return `<text x="${x}" y="${y}" font-size="13" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="#1e293b">${deg}°</text>`;
      }).join('');
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 195" width="320" height="195">
        <path d="M${cx0 - R} ${cy0} A${R} ${R} 0 0 1 ${cx0 + R} ${cy0} Z" fill="rgba(255,255,255,0.9)" stroke="#1e293b" stroke-width="2"/>
        ${ticks}
        ${labels}
        <line x1="${cx0 - R}" y1="${cy0}" x2="${cx0 + R}" y2="${cy0}" stroke="#1e293b" stroke-width="2"/>
        <circle cx="${cx0}" cy="${cy0}" r="3" fill="#ef4444"/>
      </svg>`;
    } else { // ruler
      const marks = Array.from({ length: 41 }).map((_, i) => {
        const x = 10 + i * 9.5;
        const tall = i % 5 === 0;
        const label = tall ? `<text x="${x}" y="38" font-size="9" text-anchor="middle" fill="#1e293b">${i / 5}</text>` : '';
        return `<line x1="${x}" y1="8" x2="${x}" y2="${tall ? 24 : 16}" stroke="#1e293b" stroke-width="1"/>${label}`;
      }).join('');
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 60" width="400" height="60">
        <rect x="2" y="2" width="396" height="56" rx="4" fill="rgba(255,255,255,0.9)" stroke="#1e293b" stroke-width="2"/>
        ${marks}
      </svg>`;
    }
    placeSvgImage(svg, 0.4);
  }

  /* Shared by insertGeometryTool and insertScienceTool: turns an inline
     SVG string into an <img>, then drops it on the board via the same
     floating-image placement flow images/templates/graphs already use. */
  function placeSvgImage(svg, maxWidthFrac) {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const maxW = wrap.clientWidth * maxWidthFrac;
      const sc2 = Math.min(maxW / img.width, 1);
      const w = img.width * sc2, h = img.height * sc2;
      const cx = wrap.clientWidth / 2, cy = wrap.clientHeight / 2;
      showFloatImg(img, cx - w / 2, cy - h / 2, w, h);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  /* ── Science tools: periodic table / circuit diagram / water cycle ── */
  const scienceToolsBtn  = document.getElementById('wbScienceToolsBtn');
  const scienceToolsMenu = document.getElementById('wbScienceToolsMenu');
  if (scienceToolsBtn && scienceToolsMenu) {
    const setScienceToolsOpen = open => {
      if (open) {
        const r = scienceToolsBtn.getBoundingClientRect();
        scienceToolsMenu.hidden = false;
        const mw = scienceToolsMenu.getBoundingClientRect().width;
        scienceToolsMenu.style.top  = (r.bottom + 6) + 'px';
        let left = r.left;
        if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
        scienceToolsMenu.style.left = Math.max(8, left) + 'px';
      } else {
        scienceToolsMenu.hidden = true;
      }
    };
    scienceToolsBtn.addEventListener('click', e => { e.stopPropagation(); setScienceToolsOpen(scienceToolsMenu.hidden); });
    document.addEventListener('click', e => {
      if (!scienceToolsBtn.contains(e.target) && !scienceToolsMenu.contains(e.target)) setScienceToolsOpen(false);
    });
    scienceToolsMenu.querySelectorAll('[data-sciencetool]').forEach(btn => {
      btn.addEventListener('click', () => {
        setScienceToolsOpen(false);
        insertScienceTool(btn.dataset.sciencetool);
      });
    });
  }

  function insertScienceTool(kind) {
    if (kind === 'periodic') {
      // First 20 elements, colour-coded by simple category, laid out in
      // their real periodic-table grid positions (with the usual gaps).
      const ELEMENTS = [
        { s:'H',  n:1,  g:1,  p:1, cat:'nonmetal'   }, { s:'He', n:2,  g:18, p:1, cat:'noble'      },
        { s:'Li', n:3,  g:1,  p:2, cat:'alkali'     }, { s:'Be', n:4,  g:2,  p:2, cat:'alkaline'   },
        { s:'B',  n:5,  g:13, p:2, cat:'metalloid'  }, { s:'C',  n:6,  g:14, p:2, cat:'nonmetal'   },
        { s:'N',  n:7,  g:15, p:2, cat:'nonmetal'   }, { s:'O',  n:8,  g:16, p:2, cat:'nonmetal'   },
        { s:'F',  n:9,  g:17, p:2, cat:'halogen'    }, { s:'Ne', n:10, g:18, p:2, cat:'noble'      },
        { s:'Na', n:11, g:1,  p:3, cat:'alkali'     }, { s:'Mg', n:12, g:2,  p:3, cat:'alkaline'   },
        { s:'Al', n:13, g:13, p:3, cat:'metal'      }, { s:'Si', n:14, g:14, p:3, cat:'metalloid'  },
        { s:'P',  n:15, g:15, p:3, cat:'nonmetal'   }, { s:'S',  n:16, g:16, p:3, cat:'nonmetal'   },
        { s:'Cl', n:17, g:17, p:3, cat:'halogen'    }, { s:'Ar', n:18, g:18, p:3, cat:'noble'      },
        { s:'K',  n:19, g:1,  p:4, cat:'alkali'     }, { s:'Ca', n:20, g:2,  p:4, cat:'alkaline'   },
      ];
      const CAT_COLORS = {
        nonmetal: '#22c55e', noble: '#8b5cf6', alkali: '#ef4444', alkaline: '#f97316',
        metalloid: '#eab308', halogen: '#0ea5e9', metal: '#94a3b8',
      };
      const cell = 46, gap = 3;
      const tiles = ELEMENTS.map(el => {
        const x = (el.g - 1) * (cell + gap), y = (el.p - 1) * (cell + gap);
        return `<g>
          <rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="6" fill="${CAT_COLORS[el.cat]}" opacity="0.85"/>
          <text x="${x + 6}" y="${y + 15}" font-size="10" fill="#fff" font-weight="700">${el.n}</text>
          <text x="${x + cell / 2}" y="${y + 33}" font-size="18" fill="#fff" font-weight="800" text-anchor="middle">${el.s}</text>
        </g>`;
      }).join('');
      const W = 18 * (cell + gap), H = 4 * (cell + gap) + 10;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(255,255,255,0.95)"/>
        ${tiles}
      </svg>`;
      placeSvgImage(svg, 0.7);

    } else if (kind === 'circuit') {
      // Simple series circuit: battery, wire loop, switch, light bulb
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 220" width="420" height="220">
        <rect x="0" y="0" width="420" height="220" fill="rgba(255,255,255,0.92)"/>
        <!-- wire loop -->
        <path d="M60 40 H360 V180 H60 Z" fill="none" stroke="#1e293b" stroke-width="3"/>
        <!-- battery (on the left side) -->
        <line x1="60" y1="90" x2="60" y2="110" stroke="#1e293b" stroke-width="3"/>
        <line x1="45" y1="90"  x2="75" y2="90"  stroke="#1e293b" stroke-width="6"/>
        <line x1="50" y1="110" x2="70" y2="110" stroke="#1e293b" stroke-width="3"/>
        <text x="20" y="104" font-size="14" font-weight="700" fill="#1e293b">+/-</text>
        <!-- switch (top wire) -->
        <circle cx="160" cy="40" r="4" fill="#1e293b"/>
        <circle cx="220" cy="40" r="4" fill="#1e293b"/>
        <line x1="160" y1="40" x2="210" y2="20" stroke="#ef4444" stroke-width="3"/>
        <text x="165" y="14" font-size="12" fill="#374151">مفتاح</text>
        <!-- bulb (right side) -->
        <circle cx="360" cy="110" r="26" fill="#fef9c3" stroke="#eab308" stroke-width="3"/>
        <line x1="345" y1="96" x2="375" y2="124" stroke="#eab308" stroke-width="2"/>
        <line x1="375" y1="96" x2="345" y2="124" stroke="#eab308" stroke-width="2"/>
        <text x="332" y="160" font-size="12" fill="#374151">لمبة</text>
      </svg>`;
      placeSvgImage(svg, 0.5);

    } else if (kind === 'watercycle') {
      // Labeled-arrow water cycle diagram: evaporation → condensation →
      // precipitation → collection, back to the sea
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 300" width="520" height="300">
        <rect x="0" y="0" width="520" height="300" fill="rgba(240,249,255,0.9)"/>
        <text x="440" y="50" font-size="34">☀️</text>
        <text x="220" y="60" font-size="34">☁️</text>
        <rect x="0" y="230" width="520" height="70" fill="#38bdf8" opacity="0.55"/>
        <text x="20" y="270" font-size="14" font-weight="700" fill="#0c4a6e">البحر</text>

        <!-- evaporation: sea -> cloud -->
        <path d="M120 230 Q 160 140 210 80" fill="none" stroke="#0284c7" stroke-width="2.5" marker-end="url(#arrow)"/>
        <text x="60" y="150" font-size="13" font-weight="700" fill="#0c4a6e">تبخّر</text>

        <!-- condensation label near cloud -->
        <text x="150" y="55" font-size="13" font-weight="700" fill="#0c4a6e">تكاثف</text>

        <!-- precipitation: cloud -> ground -->
        <path d="M250 90 Q 270 160 280 225" fill="none" stroke="#0284c7" stroke-width="2.5" marker-end="url(#arrow)"/>
        <text x="290" y="150" font-size="13" font-weight="700" fill="#0c4a6e">هطول (مطر)</text>

        <!-- collection: ground -> sea -->
        <path d="M300 240 Q 360 245 400 235" fill="none" stroke="#0284c7" stroke-width="2.5" marker-end="url(#arrow)"/>
        <text x="330" y="220" font-size="13" font-weight="700" fill="#0c4a6e">جريان/تجمّع</text>

        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="#0284c7"/>
          </marker>
        </defs>
      </svg>`;
      placeSvgImage(svg, 0.6);
    }
  }

  /* ── English tools: word pronunciation (Web Speech API, no backend) +
     alphabet chart stamp ── */
  const englishToolsBtn  = document.getElementById('wbEnglishToolsBtn');
  const englishToolsMenu = document.getElementById('wbEnglishToolsMenu');
  if (englishToolsBtn && englishToolsMenu) {
    const setEnglishToolsOpen = open => {
      if (open) {
        const r = englishToolsBtn.getBoundingClientRect();
        englishToolsMenu.hidden = false;
        const mw = englishToolsMenu.getBoundingClientRect().width;
        englishToolsMenu.style.top  = (r.bottom + 6) + 'px';
        let left = r.left;
        if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
        englishToolsMenu.style.left = Math.max(8, left) + 'px';
      } else {
        englishToolsMenu.hidden = true;
      }
    };
    englishToolsBtn.addEventListener('click', e => { e.stopPropagation(); setEnglishToolsOpen(englishToolsMenu.hidden); });
    document.addEventListener('click', e => {
      if (!englishToolsBtn.contains(e.target) && !englishToolsMenu.contains(e.target)) setEnglishToolsOpen(false);
    });
    // Both items open their own panel (wired below by setupPronounceTool /
    // setupAlphabetTool), so this just closes the dropdown.
    englishToolsMenu.querySelectorAll('.hqt-item').forEach(btn => {
      btn.addEventListener('click', () => setEnglishToolsOpen(false));
    });
  }

  /* Interactive A-Z panel — no static example words/images; every letter is
     a real button that speaks itself aloud on click (Web Speech API, same
     engine as the pronunciation tool), so the "reading" is live audio
     rather than a fixed baked-in example. */
  (function setupAlphabetTool() {
    const panel     = document.getElementById('wbAlphabet');
    const toggleBtn = document.getElementById('wbAlphabetToggle');
    const closeBtn  = document.getElementById('wbAlphabetClose');
    const head      = document.getElementById('wbAlphabetHead');
    const grid      = document.getElementById('wbAlphabetGrid');
    if (!panel || !toggleBtn || !grid) return;

    // letter + example word + emoji, each tile individually readable aloud
    const LETTERS = [
      ['A','Apple','🍎'], ['B','Ball','⚽'], ['C','Cat','🐱'], ['D','Dog','🐶'],
      ['E','Elephant','🐘'], ['F','Fish','🐟'], ['G','Grapes','🍇'], ['H','Hat','🎩'],
      ['I','Ice cream','🍦'], ['J','Juice','🧃'], ['K','Kite','🪁'], ['L','Lion','🦁'],
      ['M','Moon','🌙'], ['N','Nest','🪺'], ['O','Orange','🍊'], ['P','Pencil','✏️'],
      ['Q','Queen','👸'], ['R','Rabbit','🐰'], ['S','Sun','☀️'], ['T','Tree','🌳'],
      ['U','Umbrella','☂️'], ['V','Van','🚐'], ['W','Watch','⌚'], ['X','Xylophone','🎹'],
      ['Y','Yoyo','🪀'], ['Z','Zebra','🦓'],
    ];
    grid.innerHTML = LETTERS.map(([letter, word, emoji]) => `
      <button class="wb-alphabet-btn" data-letter="${letter}" data-word="${word}" type="button">
        <span class="wb-alphabet-letter">${letter}</span>
        <span class="wb-alphabet-emoji">${emoji}</span>
        <span class="wb-alphabet-word">${word}</span>
      </button>`).join('');
    grid.querySelectorAll('.wb-alphabet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!('speechSynthesis' in window)) return;
        stopPlayAll();
        window.speechSynthesis.cancel();
        // reads the letter, then its example word — one at a time per tile
        const utter = new SpeechSynthesisUtterance(`${btn.dataset.letter}. ${btn.dataset.word}`);
        utter.lang = 'en-US';
        utter.rate = 0.8;
        window.speechSynthesis.speak(utter);
      });
    });

    /* "▶️ اقرأ كل الحروف بالتسلسل" — steps through every tile, speaking its
       letter+word and playing a short musical note (a little rising/cycling
       tune) at the same time, highlighting the current tile as it goes. */
    const playAllBtn = document.getElementById('wbAlphabetPlayAll');
    let audioCtx;
    function ensureAudio() {
      if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
    }
    function playNote(freq) {
      ensureAudio();
      if (!audioCtx) return;
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.start(t); osc.stop(t + 0.4);
    }
    // simple pleasant pentatonic scale (C D E G A), cycling — gives the
    // read-through a light "little tune" feel without needing an actual
    // audio/song file
    const SCALE = [261.63, 293.66, 329.63, 392.00, 440.00];

    let playToken = 0;
    function stopPlayAll() {
      playToken++;
      grid.querySelectorAll('.wb-alphabet-btn.playing').forEach(b => b.classList.remove('playing'));
      if (playAllBtn) playAllBtn.textContent = '▶️ اقرأ كل الحروف بالتسلسل';
    }
    function playAllLetters() {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const myToken = ++playToken;
      if (playAllBtn) playAllBtn.textContent = '⏹️ إيقاف';
      const btns = Array.from(grid.querySelectorAll('.wb-alphabet-btn'));
      let i = 0;
      const step = () => {
        if (myToken !== playToken || i >= btns.length) { stopPlayAll(); return; }
        grid.querySelectorAll('.wb-alphabet-btn.playing').forEach(b => b.classList.remove('playing'));
        const btn = btns[i];
        btn.classList.add('playing');
        btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        playNote(SCALE[i % SCALE.length]);
        const utter = new SpeechSynthesisUtterance(`${btn.dataset.letter}. ${btn.dataset.word}`);
        utter.lang = 'en-US';
        utter.rate = 0.85;
        utter.onend = () => { i++; setTimeout(step, 150); };
        window.speechSynthesis.speak(utter);
      };
      step();
    }
    playAllBtn?.addEventListener('click', () => {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) stopPlayAll();
      else playAllLetters();
    });

    toggleBtn.addEventListener('click', () => {
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'block' : 'none';
      toggleBtn.classList.toggle('active', opening);
      if (!opening) { stopPlayAll(); window.speechSynthesis?.cancel(); }
    });
    closeBtn?.addEventListener('click', () => {
      panel.style.display = 'none';
      toggleBtn.classList.remove('active');
      stopPlayAll();
      window.speechSynthesis?.cancel();
    });

    /* drag by the header, same pattern as the other floating panels */
    let dragOffset = null;
    function dragMove(e) {
      if (!dragOffset) return;
      const cl = e.touches ? e.touches[0] : e;
      panel.style.left = Math.max(0, cl.clientX - wrapRect.left - dragOffset.x) + 'px';
      panel.style.top  = Math.max(0, cl.clientY - wrapRect.top  - dragOffset.y) + 'px';
    }
    head?.addEventListener('mousedown', e => {
      const r = panel.getBoundingClientRect();
      dragOffset = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', () => { dragOffset = null; });
  })();

  (function setupPronounceTool() {
    const panel    = document.getElementById('wbPronounce');
    const toggleBtn = document.getElementById('wbPronounceToggle');
    const closeBtn  = document.getElementById('wbPronounceClose');
    const head      = document.getElementById('wbPronounceHead');
    const textEl    = document.getElementById('wbPronounceText');
    const rateEl    = document.getElementById('wbPronounceRate');
    const speakBtn  = document.getElementById('wbPronounceSpeak');
    if (!panel || !toggleBtn) return;

    function speak() {
      const text = textEl.value.trim();
      if (!text || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel(); // don't queue/overlap repeated clicks
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-US';
      utter.rate = parseFloat(rateEl.value) || 0.9;
      window.speechSynthesis.speak(utter);
    }
    speakBtn?.addEventListener('click', speak);
    textEl?.addEventListener('keydown', e => { if (e.key === 'Enter') speak(); });

    toggleBtn.addEventListener('click', () => {
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'block' : 'none';
      toggleBtn.classList.toggle('active', opening);
    });
    closeBtn?.addEventListener('click', () => { panel.style.display = 'none'; toggleBtn.classList.remove('active'); });

    /* drag by the header, same pattern as calculator/graph panels */
    let dragOffset = null;
    function dragMove(e) {
      if (!dragOffset) return;
      const cl = e.touches ? e.touches[0] : e;
      panel.style.left = Math.max(0, cl.clientX - wrapRect.left - dragOffset.x) + 'px';
      panel.style.top  = Math.max(0, cl.clientY - wrapRect.top  - dragOffset.y) + 'px';
    }
    head?.addEventListener('mousedown', e => {
      const r = panel.getBoundingClientRect();
      dragOffset = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', () => { dragOffset = null; });
  })();

  /* ── Ready-made templates ── */
  const templateBtn  = document.getElementById('wbTemplateBtn');
  const templateMenu = document.getElementById('wbTemplateMenu');
  if (templateBtn && templateMenu) {
    const setTplOpen = open => {
      if (open) {
        const r = templateBtn.getBoundingClientRect();
        templateMenu.hidden = false; // measure while visible
        const mw = templateMenu.getBoundingClientRect().width;
        templateMenu.style.top  = (r.bottom + 6) + 'px';
        let left = r.left;
        if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
        templateMenu.style.left = Math.max(8, left) + 'px';
      } else {
        templateMenu.hidden = true;
      }
    };
    templateBtn.addEventListener('click', e => { e.stopPropagation(); setTplOpen(templateMenu.hidden); });
    document.addEventListener('click', e => {
      if (!templateBtn.contains(e.target) && !templateMenu.contains(e.target)) setTplOpen(false);
    });
    templateMenu.querySelectorAll('[data-template]').forEach(btn => {
      btn.addEventListener('click', () => { setTplOpen(false); insertTemplate(btn.getAttribute('data-template')); });
    });
  }

  /* Mind-map has its own layout + branch-count options, so it opens a
     second small panel instead of inserting immediately. */
  const mindmapOpener = document.getElementById('wbMindmapOpener');
  const mindmapPanel  = document.getElementById('wbMindmapPanel');
  if (templateBtn && mindmapOpener && mindmapPanel) {
    const setMmOpen = open => {
      if (open) {
        const r = templateBtn.getBoundingClientRect();
        mindmapPanel.hidden = false;
        const mw = mindmapPanel.getBoundingClientRect().width;
        mindmapPanel.style.top  = (r.bottom + 6) + 'px';
        let left = r.left;
        if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
        mindmapPanel.style.left = Math.max(8, left) + 'px';
      } else {
        mindmapPanel.hidden = true;
      }
    };
    mindmapOpener.addEventListener('click', e => {
      e.stopPropagation();
      templateMenu.hidden = true;
      setMmOpen(true);
    });
    document.addEventListener('click', e => {
      if (!templateBtn.contains(e.target) && !mindmapPanel.contains(e.target)) setMmOpen(false);
    });
    mindmapPanel.querySelectorAll('.wb-mm-layout').forEach(btn => {
      btn.addEventListener('click', () => {
        mindmapPanel.querySelectorAll('.wb-mm-layout').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    mindmapPanel.querySelectorAll('.wb-mm-count').forEach(btn => {
      btn.addEventListener('click', () => {
        mindmapPanel.querySelectorAll('.wb-mm-count').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    document.getElementById('wbMindmapInsert').addEventListener('click', () => {
      const layout = mindmapPanel.querySelector('.wb-mm-layout.active')?.dataset.layout || 'radial';
      const count  = +(mindmapPanel.querySelector('.wb-mm-count.active')?.dataset.count || 6);
      setMmOpen(false);
      insertTemplate('mindmap', { layout, count });
    });
  }

  function rrPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y,     x + w, y + h, r);
    c.arcTo(x + w, y + h, x,     y + h, r);
    c.arcTo(x,     y + h, x,     y,     r);
    c.arcTo(x,     y,     x + w, y,     r);
    c.closePath();
  }

  /* Shared by both the canvas-sizing step and the drawing step below, so
     the two can never disagree about how much room each node needs — that
     mismatch is what let tree/horizontal nodes overlap each other before:
     the canvas was sized from a flat per-layout formula while the actual
     node box size depended on `count` separately. */
  function mmNodeSize(count) {
    return count <= 4 ? { w: 190, h: 80 } : count <= 6 ? { w: 175, h: 72 } : { w: 150, h: 62 };
  }
  const MM_NODE_GAP = 20; // minimum clear space between adjacent node boxes

  /* Builds the template as its own small canvas (not drawn straight onto
     the board) so it can be dropped into the existing floating-image
     move/resize flow below — same drag handles + confirm/cancel the user
     already knows from pasting images, instead of a fixed, uneditable
     placement in the board center. */
  function buildTemplateCanvas(name, opts = {}) {
    const layout = opts.layout || 'radial';
    const count  = opts.count  || 6;
    const mmNode = mmNodeSize(count);
    let w, h;
    if (name === 'mult')      { w = 13 * 80; h = 13 * 80; }
    else if (name === 'timeline')  { w = 1200; h = 140; }
    else if (name === 'tchart')    { w = 900;  h = 560; }
    else if (name === 'venn')      { w = 760;  h = 460; }
    else if (name === 'kwl')       { w = 1020; h = 550; }
    else if (name === 'pyramid')   { w = 760;  h = 560; }
    else if (name === 'letters')   { w = 780;  h = 780; }
    else if (name === 'timetable') { w = 840;  h = 480; }
    else if (layout === 'radial')      { w = h = 620 + count * 40; }
    else if (layout === 'tree') {
      const margin = mmNode.w / 2 + 20;
      w = Math.round(margin * 2 + Math.max(count - 1, 0) * (mmNode.w + MM_NODE_GAP));
      h = 420;
    } else /* horizontal */ {
      const marginY = mmNode.h / 2 + 20;
      h = Math.round(marginY * 2 + Math.max(count - 1, 0) * (mmNode.h + MM_NODE_GAP));
      w = 620;
    }

    const oc = document.createElement('canvas');
    /* store at DPR density (like the board canvases) so the raster still
       holds up when the user zooms in later — draw math below stays in
       logical w/h units regardless */
    oc.width  = Math.round(w * DPR);
    oc.height = Math.round(h * DPR);
    const c = oc.getContext('2d');
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    const isDark  = boardCol === '#1e293b';
    const lineCol = isDark ? '#e2e8f0' : '#334155';
    const textCol = isDark ? '#f1f5f9' : '#1e293b';
    /* header/column tint palette for grid-style templates, shared so tables
       stay visually consistent with each other */
    const headerBg  = isDark ? 'rgba(99,102,241,.28)' : '#e0e7ff';
    const stripeBg   = isDark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.025)';
    const kwlBg = isDark
      ? ['rgba(59,130,246,.25)', 'rgba(234,179,8,.25)', 'rgba(34,197,94,.25)']
      : ['#dbeafe', '#fef9c3', '#dcfce7'];
    c.strokeStyle = lineCol;
    c.fillStyle   = textCol;
    c.textAlign    = 'center';
    c.textBaseline = 'middle';

    if (name === 'mult') {
      const cols = 13, rows = 13, cell = 80, N = 12;
      c.fillStyle = headerBg;
      c.fillRect(0, 0, w, cell);
      c.fillRect(0, 0, cell, h);
      c.fillStyle = textCol;
      c.lineWidth = 2;
      for (let i = 0; i <= cols; i++) { c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell, h); c.stroke(); }
      for (let j = 0; j <= rows; j++) { c.beginPath(); c.moveTo(0, j * cell); c.lineTo(w, j * cell); c.stroke(); }
      c.font = '900 24px Cairo, sans-serif';
      c.fillText('×', cell / 2, cell / 2);
      for (let k = 1; k <= N; k++) {
        c.fillText(String(k), (k + 0.5) * cell, cell / 2);
        c.fillText(String(k), cell / 2, (k + 0.5) * cell);
      }
    } else if (name === 'timeline') {
      const margin = 40, y = h / 2, n = 6;
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(margin, y); c.lineTo(w - margin, y); c.stroke();
      c.beginPath();
      c.moveTo(w - margin, y); c.lineTo(w - margin - 20, y - 12);
      c.moveTo(w - margin, y); c.lineTo(w - margin - 20, y + 12);
      c.stroke();
      const step = (w - margin * 2) / (n - 1);
      c.lineWidth = 3;
      c.font = '600 20px Cairo, sans-serif';
      for (let i = 0; i < n; i++) {
        const x = margin + i * step;
        c.beginPath(); c.moveTo(x, y - 16); c.lineTo(x, y + 16); c.stroke();
        c.fillText('. . .', x, y + 42);
      }
    } else if (name === 'tchart') {
      const headerH = 70, rows = 6, cellH = (h - headerH) / rows;
      c.fillStyle = headerBg;
      c.fillRect(0, 0, w, headerH);
      c.fillStyle = stripeBg;
      for (let r = 1; r < rows; r += 2) c.fillRect(0, headerH + r * cellH, w, cellH);
      c.lineWidth = 2;
      c.strokeStyle = lineCol;
      c.strokeRect(1, 1, w - 2, h - 2);
      c.beginPath(); c.moveTo(0, headerH); c.lineTo(w, headerH); c.stroke();
      c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
      for (let r = 1; r < rows; r++) { const y = headerH + r * cellH; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    } else if (name === 'venn') {
      const r = 210, cy = h / 2, cx1 = w / 2 - 120, cx2 = w / 2 + 120;
      c.lineWidth = 3;
      c.beginPath(); c.arc(cx1, cy, r, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(cx2, cy, r, 0, Math.PI * 2); c.stroke();
    } else if (name === 'kwl') {
      const cols = 3, rows = 6, headerH = 70, colW = w / cols, cellH = (h - headerH) / rows;
      for (let i = 0; i < cols; i++) {
        c.fillStyle = kwlBg[i];
        c.fillRect(i * colW, 0, colW, headerH);
        c.globalAlpha = 0.35; // faint tint under the column body, full color stays on the header
        c.fillRect(i * colW, headerH, colW, h - headerH);
        c.globalAlpha = 1;
      }
      c.lineWidth = 2;
      c.strokeStyle = lineCol;
      c.strokeRect(1, 1, w - 2, h - 2);
      c.beginPath(); c.moveTo(0, headerH); c.lineTo(w, headerH); c.stroke();
      for (let i = 1; i < cols; i++) { c.beginPath(); c.moveTo(i * colW, 0); c.lineTo(i * colW, h); c.stroke(); }
      for (let r = 1; r < rows; r++) { const y = headerH + r * cellH; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      c.fillStyle = textCol;
      c.font = '700 19px Cairo, sans-serif';
      ['ماذا أعرف؟', 'ماذا أريد أن أعرف؟', 'ماذا تعلمت؟'].forEach((t, i) => c.fillText(t, colW * (i + 0.5), headerH / 2));
    } else if (name === 'pyramid') {
      const levels = 5, baseW = 680, apexY = 30, baseY = h - 30, cx = w / 2;
      const totalH = baseY - apexY, bandH = totalH / levels;
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(cx, apexY); c.lineTo(cx + baseW / 2, baseY); c.lineTo(cx - baseW / 2, baseY);
      c.closePath(); c.stroke();
      for (let i = 1; i < levels; i++) {
        const y = apexY + bandH * i;
        const halfW = (baseW / 2) * ((y - apexY) / totalH);
        c.beginPath(); c.moveTo(cx - halfW, y); c.lineTo(cx + halfW, y); c.stroke();
      }
    } else if (name === 'letters') {
      const letters = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و','ي'];
      const cx = w / 2, cy = h / 2, R = 320, R2 = 360;
      c.lineWidth = 2;
      c.beginPath(); c.arc(cx, cy, R2, 0, Math.PI * 2); c.stroke();
      c.font = '700 28px Cairo, sans-serif';
      letters.forEach((L, i) => {
        const ang = (i / letters.length) * Math.PI * 2 - Math.PI / 2;
        c.fillText(L, cx + R * Math.cos(ang), cy + R * Math.sin(ang));
      });
    } else if (name === 'timetable') {
      const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
      const periods = 6, labelColW = 90, headerH = 60;
      const gridW = w - labelColW;
      const cellW = gridW / days.length, cellH = (h - headerH) / periods;
      /* RTL layout: label column on the right, day 0 (الأحد) starts right
         next to it and the week reads right-to-left across the grid */
      const dayX = i => w - labelColW - (i + 1) * cellW;
      c.fillStyle = headerBg;
      c.fillRect(0, 0, gridW, headerH);        // days header
      c.fillRect(gridW, 0, labelColW, h);       // period label column
      c.fillStyle = stripeBg;
      for (let r = 1; r < periods; r += 2) c.fillRect(0, headerH + r * cellH, gridW, cellH);
      c.lineWidth = 2;
      c.strokeStyle = lineCol;
      c.strokeRect(1, 1, w - 2, h - 2);
      c.beginPath(); c.moveTo(0, headerH); c.lineTo(w, headerH); c.stroke();
      c.beginPath(); c.moveTo(gridW, 0); c.lineTo(gridW, h); c.stroke();
      for (let i = 1; i < days.length; i++) { const x = i * cellW; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
      for (let r = 1; r < periods; r++) { const y = headerH + r * cellH; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      c.fillStyle = textCol;
      c.font = '700 17px Cairo, sans-serif';
      days.forEach((d, i) => c.fillText(d, dayX(i) + cellW / 2, headerH / 2));
      c.font = '600 15px Cairo, sans-serif';
      for (let r = 0; r < periods; r++) c.fillText(String(r + 1), gridW + labelColW / 2, headerH + cellH * (r + 0.5));
    } else if (name === 'mindmap') {
      const rw = 210, rh = 90;
      const accent = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4'];
      const nodeSize = mmNodeSize(count);

      const drawNode = (x, y, nw, nh, color, text, big) => {
        c.fillStyle = boardCol;
        rrPath(c, x - nw / 2, y - nh / 2, nw, nh, big ? 20 : 18);
        c.fill();
        c.strokeStyle = color; c.lineWidth = 2.5; c.stroke();
        c.fillStyle = textCol;
        c.font = big ? '700 24px Cairo, sans-serif' : '600 17px Cairo, sans-serif';
        if (text) c.fillText(text, x, y);
      };
      /* stop each connecting line at the node's border, not its center, so
         it doesn't poke into the box as a stray diagonal stub */
      const edgeStop = (fromX, fromY, toX, toY, nw, nh) => {
        const dx = toX - fromX, dy = toY - fromY, d = Math.hypot(dx, dy) || 1;
        const r = Math.min(nw, nh) / 2;
        return { x: toX - (dx / d) * r, y: toY - (dy / d) * r };
      };

      if (layout === 'radial') {
        const cx = w / 2, cy = h / 2;
        const radius = (Math.min(w, h) - nodeSize.w) / 2 - 20;
        const nodes = [];
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * Math.PI * 2 - Math.PI / 2;
          const nx = cx + radius * Math.cos(ang), ny = cy + radius * Math.sin(ang);
          nodes.push({ x: nx, y: ny, stop: edgeStop(cx, cy, nx, ny, nodeSize.w, nodeSize.h), color: accent[i % accent.length] });
        }
        nodes.forEach(p => { c.strokeStyle = p.color; c.lineWidth = 2.5; c.beginPath(); c.moveTo(cx, cy); c.lineTo(p.stop.x, p.stop.y); c.stroke(); });
        drawNode(cx, cy, rw, rh, lineCol, '', true);
        nodes.forEach(p => drawNode(p.x, p.y, nodeSize.w, nodeSize.h, p.color, ''));
      } else if (layout === 'tree') {
        const rootX = w / 2, rootY = 70, childY = h - 90;
        // margin must clear half a node's own width, not just a flat gap —
        // otherwise the outermost nodes' far edge overflows past the canvas
        const margin = nodeSize.w / 2 + 20;
        const step = (w - margin * 2) / Math.max(count - 1, 1);
        const xs = []; for (let i = 0; i < count; i++) xs.push(count === 1 ? w / 2 : margin + step * i);
        xs.forEach((x, i) => {
          const color = accent[i % accent.length];
          const a = edgeStop(rootX, rootY, x, childY, nodeSize.w, nodeSize.h);
          const b = edgeStop(x, childY, rootX, rootY, rw, rh);
          c.strokeStyle = color; c.lineWidth = 2.5;
          c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(a.x, a.y); c.stroke();
        });
        drawNode(rootX, rootY, rw, rh, lineCol, '', true);
        xs.forEach((x, i) => drawNode(x, childY, nodeSize.w, nodeSize.h, accent[i % accent.length], ''));
      } else { /* horizontal */
        const rootX = 110, rootY = h / 2, childX = w - 130;
        // same fix as tree layout above, on the vertical axis this time
        const marginY = nodeSize.h / 2 + 20;
        const stepY = (h - marginY * 2) / Math.max(count - 1, 1);
        const ys = []; for (let i = 0; i < count; i++) ys.push(count === 1 ? h / 2 : marginY + stepY * i);
        ys.forEach((y, i) => {
          const color = accent[i % accent.length];
          const a = edgeStop(rootX, rootY, childX, y, nodeSize.w, nodeSize.h);
          const b = edgeStop(childX, y, rootX, rootY, rw, rh);
          c.strokeStyle = color; c.lineWidth = 2.5;
          c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(a.x, a.y); c.stroke();
        });
        drawNode(rootX, rootY, rw, rh, lineCol, '', true);
        ys.forEach((y, i) => drawNode(childX, y, nodeSize.w, nodeSize.h, accent[i % accent.length], ''));
      }
    }
    return oc;
  }

  function insertTemplate(name, opts) {
    const oc = buildTemplateCanvas(name, opts);
    const img = new Image();
    img.onload = () => {
      const maxW = wrap.clientWidth  * 0.6;
      const maxH = wrap.clientHeight * 0.6;
      const sc2  = Math.min(maxW / img.width, maxH / img.height, 1);
      const w2 = img.width  * sc2, h2 = img.height * sc2;
      const x = (wrap.clientWidth  - w2) / 2;
      const y = (wrap.clientHeight - h2) / 2;
      showFloatImg(img, x, y, w2, h2);
    };
    img.src = oc.toDataURL('image/png');
  }

  /* ══ TOOLBAR WIRING ══ */
  const TOOL_LABELS = { pen:'قلم', highlight:'تظليل', eraser:'ممحاة', line:'خط', arrow:'سهم', rect:'مستطيل', circle:'دائرة', triangle:'مثلث', diamond:'معين', star:'نجمة', text:'نص', hand:'يد', select:'تحديد' };

  /* custom per-tool cursors — small SVG icons with a hotspot at the actual
     drawing point, so the pointer itself communicates which tool is active */
  function svgCursor(svgBody, w, h, hx, hy) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svgBody}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}`;
  }
  const CURSOR_MAP = {
    pen: svgCursor(
      `<g transform="rotate(45 16 16)"><path d="M14 3a2 2 0 0 1 4 0v16l-2 5-2-5Z" fill="#3b82f6" stroke="#1e3a8a" stroke-width="1"/></g>`,
      32, 32, 4, 28) + ', crosshair',
    highlight: svgCursor(
      `<rect x="3" y="12" width="20" height="10" rx="2" fill="#eab308" opacity=".55" stroke="#a16207" stroke-width="1"/>`,
      28, 28, 4, 17) + ', crosshair',
    eraser: svgCursor(
      `<rect x="4" y="10" width="20" height="12" rx="3" fill="#fff" stroke="#f43f5e" stroke-width="2"/><line x1="4" y1="16" x2="24" y2="16" stroke="#f43f5e" stroke-width="1.5"/>`,
      28, 28, 14, 16) + ', cell',
    text: 'text',
    hand: 'grab',
    select: 'crosshair',
    line: svgCursor(`<line x1="4" y1="20" x2="20" y2="4" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>`, 24, 24, 4, 20) + ', crosshair',
    arrow: svgCursor(`<line x1="4" y1="20" x2="20" y2="4" stroke="#f97316" stroke-width="2.5" stroke-linecap="round"/><path d="M20 4 12 6l6 6Z" fill="#f97316"/>`, 24, 24, 4, 20) + ', crosshair',
    rect: svgCursor(`<rect x="3" y="6" width="18" height="14" rx="2" fill="none" stroke="#0ea5e9" stroke-width="2.5"/>`, 24, 24, 3, 6) + ', crosshair',
    circle: svgCursor(`<circle cx="12" cy="12" r="9" fill="none" stroke="#14b8a6" stroke-width="2.5"/>`, 24, 24, 3, 3) + ', crosshair',
    triangle: svgCursor(`<path d="M12 4 21 20H3Z" fill="none" stroke="#0ea5e9" stroke-width="2.5"/>`, 24, 24, 3, 4) + ', crosshair',
    diamond: svgCursor(`<path d="M12 3 21 12 12 21 3 12Z" fill="none" stroke="#0ea5e9" stroke-width="2.5"/>`, 24, 24, 3, 3) + ', crosshair',
    star: svgCursor(`<path d="M12 2.5 14.9 9 22 9.9l-5.1 4.7L18.2 21.5 12 17.9 5.8 21.5 7.1 14.6 2 9.9 9.1 9Z" fill="none" stroke="#0ea5e9" stroke-width="2"/>`, 24, 24, 2, 2) + ', crosshair',
  };

  document.querySelectorAll('.wb-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wb-tool').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tool = btn.dataset.tool;
      overlay.style.cursor = CURSOR_MAP[tool] || 'crosshair';
      document.getElementById('wbToolLabel').textContent = TOOL_LABELS[tool] || tool;
    });
  });

  /* Colors */
  const colorBtn     = document.getElementById('wbColorBtn');
  const colorBtnIcon = document.getElementById('wbColorBtnIcon');
  const colorPop     = document.getElementById('wbColorPop');
  document.querySelectorAll('.wb-color').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wb-color').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      color = btn.dataset.color;
      document.getElementById('wbColorPicker').value = color;
      colorBtnIcon.querySelector('circle').setAttribute('fill', color);
      colorPop.classList.remove('open');
      colorBtn.classList.remove('open');
    });
  });
  document.getElementById('wbColorPicker').addEventListener('input', e => {
    color = e.target.value;
    document.querySelectorAll('.wb-color').forEach(b => b.classList.remove('active'));
    colorBtnIcon.querySelector('circle').setAttribute('fill', color);
  });

  /* Brush size — preset dot sizes instead of a percentage slider.
     Scoped to #wbSizePop so it doesn't collide with the separate text-size
     popover below, which reuses the same .wb-size-opt look. */
  const sizeBtn = document.getElementById('wbSizeBtn');
  document.querySelectorAll('#wbSizePop .wb-size-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#wbSizePop .wb-size-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      size = +opt.dataset.size;
      document.getElementById('wbSizePop').classList.remove('open');
      sizeBtn.classList.remove('open');
    });
  });

  /* Text font size — separate from brush size, see wbTextToolBtn */
  const textSizeBtn = document.getElementById('wbTextToolBtn');
  document.querySelectorAll('#wbTextSizePop .wb-size-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#wbTextSizePop .wb-size-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      textSize = +opt.dataset.textSize;
      document.getElementById('wbTextSizePop').classList.remove('open');
      textSizeBtn.classList.remove('open');
    });
  });

  /* Property popovers (size / shapes) — icon button toggles a flyout panel.
     Positioned with fixed coords computed from the trigger's rect, since the sidebar
     has overflow-x:hidden (for its own vertical scroll) which would otherwise clip
     any absolutely-positioned popover that extends past the sidebar's edge. */
  function positionPopover(btn, pop) {
    const r = btn.getBoundingClientRect();
    /* measure the popover's real width before placing it (it's display:none
       until .open is added, so briefly force it visible off-screen to measure) */
    pop.style.visibility = 'hidden';
    pop.style.display = 'flex';
    const popW = pop.getBoundingClientRect().width;
    const popH = pop.getBoundingClientRect().height;
    pop.style.display = '';
    pop.style.visibility = '';

    let left = r.right + 10;
    if (left + popW > window.innerWidth - 8) left = r.left - popW - 10; // flip to the other side
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));

    let top = r.top + r.height / 2;
    top = Math.max(popH / 2 + 8, Math.min(top, window.innerHeight - popH / 2 - 8));

    pop.style.left = left + 'px';
    pop.style.top  = top + 'px';
  }
  function wirePropPopover(btnId, popId) {
    const btn = document.getElementById(btnId);
    const pop = document.getElementById(popId);
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = !pop.classList.contains('open');
      document.querySelectorAll('.wb-prop-pop.open').forEach(p => p.classList.remove('open'));
      document.querySelectorAll('.wb-prop-btn.open').forEach(b => b.classList.remove('open'));
      if (willOpen) { positionPopover(btn, pop); pop.classList.add('open'); btn.classList.add('open'); }
    });
    pop.addEventListener('click', e => e.stopPropagation());
  }
  wirePropPopover('wbSizeBtn', 'wbSizePop');
  wirePropPopover('wbTextToolBtn', 'wbTextSizePop');
  wirePropPopover('wbShapeBtn', 'wbShapePop');
  wirePropPopover('wbColorBtn', 'wbColorPop');
  wirePropPopover('wbSbBgBtn', 'wbSbBgPop');
  wirePropPopover('wbBoardColBtn', 'wbBoardColPop');
  document.addEventListener('click', () => {
    document.querySelectorAll('.wb-prop-pop.open').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.wb-prop-btn.open').forEach(b => b.classList.remove('open'));
  });

  /* Shape picker — clicking a shape updates the trigger icon, closes the popover */
  const shapeBtn     = document.getElementById('wbShapeBtn');
  const shapeBtnIcon = document.getElementById('wbShapeBtnIcon');
  const shapePop     = document.getElementById('wbShapePop');
  document.querySelectorAll('.wb-shape-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.wb-shape-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      shapeBtnIcon.innerHTML = opt.querySelector('svg').innerHTML;
      shapePop.classList.remove('open');
      shapeBtn.classList.remove('open');
    });
  });

  /* Fill */
  document.getElementById('wbFillToggle').addEventListener('click', function() {
    fill = !fill;
    this.classList.toggle('active', fill);
  });

  /* Background */
  const sbBgBtn     = document.getElementById('wbSbBgBtn');
  const sbBgBtnIcon = document.getElementById('wbSbBgBtnIcon');
  const sbBgPop      = document.getElementById('wbSbBgPop');
  document.querySelectorAll('.wb-bg').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wb-bg').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      bgType = btn.dataset.bg;
      drawBg();
      sbBgBtnIcon.innerHTML = btn.querySelector('svg').innerHTML;
      sbBgPop.classList.remove('open');
      sbBgBtn.classList.remove('open');
    });
  });

  /* Board color */
  const boardColBtn     = document.getElementById('wbBoardColBtn');
  const boardColBtnIcon = document.getElementById('wbBoardColBtnIcon');
  const boardColPop     = document.getElementById('wbBoardColPop');
  document.querySelectorAll('.wb-board-col').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wb-board-col').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      boardCol = btn.dataset.boardCol;
      drawBg();
      boardColBtnIcon.querySelector('rect').setAttribute('fill', boardCol);
      boardColPop.classList.remove('open');
      boardColBtn.classList.remove('open');
      if (boardCol === '#1e293b' && color === '#1e293b') {
        color = '#ffffff';
        document.querySelector('[data-color="#ffffff"]')?.classList.add('active');
        document.querySelector('[data-color="#1e293b"]')?.classList.remove('active');
        document.getElementById('wbColorPicker').value = '#ffffff';
      } else if (boardCol !== '#1e293b' && color === '#ffffff') {
        color = '#1e293b';
        document.querySelector('[data-color="#1e293b"]')?.classList.add('active');
        document.querySelector('[data-color="#ffffff"]')?.classList.remove('active');
        document.getElementById('wbColorPicker').value = '#1e293b';
      }
    });
  });

  /* Undo / Redo / Clear */
  document.getElementById('wbUndo').addEventListener('click', undo);
  document.getElementById('wbRedo').addEventListener('click', redo);
  document.getElementById('wbClear').addEventListener('click', () => {
    if (!confirm('مسح السبورة بالكامل؟')) return;
    saveHistory();
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  });

  /* ── Save board ── */
  document.getElementById('wbSave').addEventListener('click', () => {
    // only the current page's canvas — that's already all `canvas` is
    const data = JSON.stringify({ v:3, scale, panX, panY, boardCol, bgType, img: canvas.toDataURL() });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type:'application/json' }));
    const safeName = (pagesData[currentPageIdx]?.name || 'سبورة').replace(/[\\/:*?"<>|]/g, '').trim() || 'سبورة';
    a.download = `${safeName}.wb`;
    a.click(); URL.revokeObjectURL(a.href);
  });

  /* ── Load board ── */
  document.getElementById('wbLoad').addEventListener('click', () => document.getElementById('wbLoadInput').click());
  document.getElementById('wbLoadInput').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        scale = d.scale || 1; panX = d.panX || 0; panY = d.panY || 0;
        boardCol = d.boardCol || '#ffffff'; bgType = d.bgType || 'plain';
        applyTransform(); drawBg(); updateZoomLabel();
        const img = new Image();
        img.onload = () => { saveHistory(); ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(img, 0, 0); ctx.restore(); };
        img.src = d.img;
      } catch { alert('ملف غير صالح'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  /* ── Floating image helpers ── */
  const imgOverlay = document.getElementById('wbImgOverlay');
  const imgFloat   = document.getElementById('wbImgFloat');
  const imgDeleteBtn = document.getElementById('wbImgDelete');
  /* set only when the current float came from lifting existing board
     content with the select tool — holds where to put it back if canceled */
  let liftedFrom = null;

  function showFloatImg(imgEl, x, y, w, h) {
    floatImg  = imgEl;
    floatRect = { x, y, w, h };
    imgFloat.src = imgEl.src;
    applyFloatRect();
    imgOverlay.style.display = 'block';
    if (imgDeleteBtn) imgDeleteBtn.style.display = liftedFrom ? '' : 'none';
  }

  function applyFloatRect() {
    const r = floatRect;
    imgOverlay.style.left   = r.x + 'px';
    imgOverlay.style.top    = r.y + 'px';
    imgOverlay.style.width  = r.w + 'px';
    imgOverlay.style.height = r.h + 'px';
  }

  function commitFloatImg() {
    if (!floatImg) return;
    const bx = (floatRect.x - panX) / scale;
    const by = (floatRect.y - panY) / scale;
    const bw = floatRect.w / scale;
    const bh = floatRect.h / scale;
    saveHistory();
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(floatImg, bx, by, bw, bh);
    ctx.restore();
    // remember where this landed so the select tool can grab it again with
    // one click next time — see the placedObjects hit-test in onDown.
    placedObjects.push({ bx, by, bw, bh });
    cancelFloatImg(false); // already placed at the new spot — nothing to restore
  }

  function cancelFloatImg(restore = true) {
    if (restore && liftedFrom && floatImg) {
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.drawImage(floatImg, liftedFrom.bx, liftedFrom.by, liftedFrom.bw, liftedFrom.bh);
      ctx.restore();
    }
    liftedFrom = null;
    floatImg = null;
    _imgDrag = null;
    imgOverlay.style.display = 'none';
    if (imgDeleteBtn) imgDeleteBtn.style.display = 'none';
  }

  document.getElementById('wbImgConfirm').addEventListener('click', commitFloatImg);
  document.getElementById('wbImgCancel').addEventListener('click',  () => cancelFloatImg(true));
  imgDeleteBtn?.addEventListener('click', () => cancelFloatImg(false));

  /* drag-move + corner-resize for floating image (mouse + touch) */
  function imgPointer(e) {
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }

  function imgDragStart(e) {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    const dir = e.target.dataset?.dir;
    const p = imgPointer(e);
    _imgDrag = {
      type: dir ? 'resize' : 'move',
      dir: dir || '',
      startX: p.x,
      startY: p.y,
      startRect: { ...floatRect }
    };
  }

  function imgDragMove(e) {
    if (!_imgDrag) return;
    if (e.cancelable) e.preventDefault();
    const p  = imgPointer(e);
    const dx = p.x - _imgDrag.startX;
    const dy = p.y - _imgDrag.startY;
    const sr = _imgDrag.startRect;
    if (_imgDrag.type === 'move') {
      floatRect.x = sr.x + dx;
      floatRect.y = sr.y + dy;
    } else {
      const d = _imgDrag.dir;
      if (d.includes('e')) floatRect.w = Math.max(40, sr.w + dx);
      if (d.includes('s')) floatRect.h = Math.max(40, sr.h + dy);
      if (d.includes('w')) { floatRect.x = sr.x + dx; floatRect.w = Math.max(40, sr.w - dx); }
      if (d.includes('n')) { floatRect.y = sr.y + dy; floatRect.h = Math.max(40, sr.h - dy); }
    }
    applyFloatRect();
  }

  function imgDragEnd() { _imgDrag = null; }

  imgOverlay.addEventListener('mousedown',  imgDragStart);
  imgOverlay.addEventListener('touchstart', imgDragStart, { passive: false });
  document.addEventListener('mousemove',  imgDragMove);
  document.addEventListener('touchmove',  imgDragMove, { passive: false });
  document.addEventListener('mouseup',  imgDragEnd);
  document.addEventListener('touchend', imgDragEnd);

  /* ── Image import ── */
  document.getElementById('wbImgBtn').addEventListener('click', () => document.getElementById('wbImgInput').click());
  document.getElementById('wbImgInput').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxW = wrap.clientWidth  * 0.65;
      const maxH = wrap.clientHeight * 0.65;
      const sc2  = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * sc2, h = img.height * sc2;
      const x = (wrap.clientWidth  - w) / 2;
      const y = (wrap.clientHeight - h) / 2;
      showFloatImg(img, x, y, w, h);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    e.target.value = '';
  });

  /* ── Export ── */
  document.getElementById('wbExportPng').addEventListener('click', () => exportImg('png'));

  function exportImg(fmt) {
    /* render at native board resolution */
    const tmp = document.createElement('canvas');
    tmp.width = BOARD_W; tmp.height = BOARD_H;
    const tc = tmp.getContext('2d');
    tc.fillStyle = boardCol;
    tc.fillRect(0, 0, BOARD_W, BOARD_H);
    /* `canvas` is always the full board already (fixed BOARD_W*DPR x
       BOARD_H*DPR backing store, independent of the current pan/zoom) — no
       need to "unproject" a viewport crop back to board space anymore, so
       this also fixes exporting only whatever happened to be on screen at
       the time */
    tc.drawImage(canvas, 0, 0, BOARD_W, BOARD_H);
    const a = document.createElement('a');
    a.href = tmp.toDataURL('image/' + fmt, fmt==='jpeg' ? 0.93 : 1);
    a.download = `سبورة-${new Date().toLocaleDateString('ar-EG').replace(/\//g,'-')}.${fmt==='jpeg'?'jpg':'png'}`;
    a.click();
  }

  /* ── Drag & drop image ── */
  wrap.addEventListener('dragover', e => e.preventDefault());
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r   = wrap.getBoundingClientRect();
      const cx  = e.clientX - r.left;
      const cy  = e.clientY - r.top;
      const maxW = wrap.clientWidth  * 0.5;
      const maxH = wrap.clientHeight * 0.5;
      const sc2 = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * sc2, h = img.height * sc2;
      showFloatImg(img, cx - w / 2, cy - h / 2, w, h);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

  /* ── Keyboard shortcuts ── */
  document.addEventListener('keydown', e => {
    if (e.target === textBox || e.target === pageLabelEl) return;
    if (floatImg) {
      if (e.key === 'Enter')  { e.preventDefault(); commitFloatImg(); return; }
      if (e.key === 'Escape') { e.preventDefault(); cancelFloatImg(); return; }
    }
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && (e.key==='y'||e.key==='Y')) { e.preventDefault(); redo(); }
    if (e.ctrlKey && e.key==='s') { e.preventDefault(); document.getElementById('wbSave').click(); }
    if (!e.ctrlKey) {
      const keyMap = { p:'pen', m:'highlight', e:'eraser', t:'text', h:'hand', s:'select', l:'line', a:'arrow', r:'rect', c:'circle' };
      if (keyMap[e.key.toLowerCase()]) document.querySelector(`[data-tool="${keyMap[e.key.toLowerCase()]}"]`)?.click();
      if (e.key==='+' || e.key==='=') doZoom(1.2, wrap.clientWidth/2, wrap.clientHeight/2);
      if (e.key==='-')                doZoom(0.8, wrap.clientWidth/2, wrap.clientHeight/2);
      if (e.key==='0')                document.getElementById('wbZoomReset').click();
      if (e.key==='F11') { e.preventDefault(); document.getElementById('wbFullscreen').click(); }
    }
  });

  /* ── Recording (board strokes + optional mic + optional teacher camera) ── */
  let micOn        = false;
  let micStream     = null;
  let camOn         = false;
  let camStream      = null;
  let recorder      = null;
  let recChunks     = [];
  let recRAF        = null;
  let recTimerId    = null;
  let recStartedAt  = 0;
  let recCanvas     = null; // offscreen: bg + strokes + camera composited per frame
  let recCtx        = null;
  let recFormat     = 'webm'; // 'webm' | 'mp4' — mp4 only offered when the browser actually supports encoding it
  let recVideoStream = null; // raw video-only stream (canvas.captureStream or desktopCapturer) — stopped explicitly on end

  let camShape      = 'circle'; // 'circle' | 'square' — controls both live preview and recorded composite

  const micBtn        = document.getElementById('wbMicToggle');
  const camBtn        = document.getElementById('wbCamToggle');
  const camShapeBtn   = document.getElementById('wbCamShapeToggle');
  const camShapeIcon  = document.getElementById('wbCamShapeIcon');
  const camBox        = document.getElementById('wbCamBox');
  const camPreview    = document.getElementById('wbCamPreview');
  const camHandles    = document.querySelectorAll('.wb-cam-h');
  const recBtn        = document.getElementById('wbRecToggle');
  const recToggleIcon = document.getElementById('wbRecToggleIcon');
  const recStatus     = document.getElementById('wbRecStatus');
  const recTimeEl     = document.getElementById('wbRecTime');
  const recFmtBtn     = document.getElementById('wbRecFormatToggle');
  const recFmtLabel   = document.getElementById('wbRecFormatLabel');
  const recModeBtn    = document.getElementById('wbRecModeToggle');
  const recModeLabel  = document.getElementById('wbRecModeLabel');
  const screenPicker      = document.getElementById('wbScreenPicker');
  const screenPickerGrid  = document.getElementById('wbScreenPickerGrid');
  const screenPickerCancel = document.getElementById('wbScreenPickerCancel');

  let recMode = 'board'; // 'board' (canvas only) | 'screen' (full screen/window via desktopCapturer)

  /* mp4 recording needs the browser's encoder to actually support it —
     unsupported here, the format toggle only ever offers webm */
  const mp4Supported = typeof MediaRecorder !== 'undefined' &&
    (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a') || MediaRecorder.isTypeSupported('video/mp4'));
  if (!mp4Supported) recFmtBtn.title = 'صيغة الفيديو: WEBM فقط (المتصفح لا يدعم MP4)';

  micBtn.addEventListener('click', () => {
    micOn = !micOn;
    micBtn.classList.toggle('active', micOn);
  });

  recModeBtn.addEventListener('click', () => {
    recMode = recMode === 'board' ? 'screen' : 'board';
    recModeLabel.textContent = recMode === 'board' ? 'سبورة' : 'أدوات';
    recModeBtn.title = recMode === 'board' ? 'السبورة فقط' : 'السبورة + شريط الأدوات';
    recModeBtn.classList.toggle('active', recMode === 'screen');
  });

  /* auto-select this app's own window — avoids showing the teacher a picker
     full of unrelated desktop windows just to record the toolbar + board */
  async function captureOwnWindow() {
    if (!window.api || !window.api.getOwnWindowSource) return null;
    let src;
    try { src = await window.api.getOwnWindowSource(); } catch { return null; }
    if (!src || !src.id) return null;
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id } }
      });
    } catch {
      return null;
    }
  }

  /* pick a screen/window to record when recMode === 'screen' — resolves with
     a MediaStream, or null if the teacher cancels */
  let pickScreenResolve = null;
  screenPickerCancel.addEventListener('click', () => {
    screenPicker.style.display = 'none';
    if (pickScreenResolve) { pickScreenResolve(null); pickScreenResolve = null; }
  });

  function pickScreenSource() {
    return new Promise(async resolve => {
      pickScreenResolve = resolve;
      if (!window.api || !window.api.getScreenSources) {
        alert('تسجيل الشاشة الكاملة غير مدعوم في هذا الإصدار');
        pickScreenResolve = null;
        resolve(null);
        return;
      }
      let sources;
      try { sources = await window.api.getScreenSources(); }
      catch { alert('تعذّر جلب مصادر الشاشة'); pickScreenResolve = null; resolve(null); return; }

      screenPickerGrid.innerHTML = '';
      sources.forEach(src => {
        const btn = document.createElement('button');
        btn.className = 'wb-screen-src';
        btn.type = 'button';
        btn.innerHTML = `<img src="${src.thumbnail}" alt=""><span>${src.name}</span>`;
        btn.addEventListener('click', async () => {
          screenPicker.style.display = 'none';
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id } }
            });
            pickScreenResolve = null;
            resolve(stream);
          } catch {
            alert('تعذّر بدء تسجيل الشاشة');
            pickScreenResolve = null;
            resolve(null);
          }
        });
        screenPickerGrid.appendChild(btn);
      });
      screenPicker.style.display = 'flex';
    });
  }

  recFmtBtn.addEventListener('click', () => {
    if (!mp4Supported) { alert('المتصفح الحالي لا يدعم التسجيل بصيغة MP4 مباشرة — سيتم الحفظ بصيغة WEBM (تشتغل في كل مشغلات الفيديو الحديثة).'); return; }
    recFormat = recFormat === 'webm' ? 'mp4' : 'webm';
    recFmtLabel.textContent = recFormat.toUpperCase();
    recFmtBtn.title = 'صيغة الفيديو: ' + recFormat.toUpperCase();
  });

  camShapeBtn.addEventListener('click', () => {
    camShape = camShape === 'circle' ? 'square' : 'circle';
    camBox.classList.toggle('wb-cam-square', camShape === 'square');
    camShapeBtn.classList.toggle('active', camShape === 'square');
    camShapeBtn.title = camShape === 'circle' ? 'شكل صورة الكاميرا: دائرة' : 'شكل صورة الكاميرا: مربع';
    camShapeIcon.innerHTML = camShape === 'circle'
      ? '<circle cx="12" cy="12" r="9"/>'
      : '<rect x="3" y="3" width="18" height="18" rx="4"/>';
  });

  /* resize the camera box by dragging one of its four corner handles —
     same interaction as the image/template floating overlay's corner
     handles, replacing the old +/- zoom buttons. The corner opposite the
     one being dragged stays fixed in place while the dragged corner
     follows the pointer. */
  camHandles.forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      const dir = handle.dataset.dir;
      const wr  = wrap.getBoundingClientRect();
      const r   = camBox.getBoundingClientRect();
      const fixedX = (dir.includes('w') ? r.right  : r.left) - wr.left;
      const fixedY = (dir.includes('n') ? r.bottom : r.top)  - wr.top;
      function onMove(e2) {
        const px = e2.clientX - wr.left;
        const py = e2.clientY - wr.top;
        const size = Math.max(80, Math.min(360, Math.max(Math.abs(px - fixedX), Math.abs(py - fixedY))));
        camBox.style.width  = size + 'px';
        camBox.style.height = size + 'px';
        camBox.style.left   = (dir.includes('w') ? fixedX - size : fixedX) + 'px';
        camBox.style.top    = (dir.includes('n') ? fixedY - size : fixedY) + 'px';
        camBox.style.right  = 'auto';
        camBox.style.bottom = 'auto';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  camBtn.addEventListener('click', async () => {
    if (camOn) {
      camStream.getTracks().forEach(t => t.stop());
      camStream = null;
      camOn = false;
      camBtn.classList.remove('active');
      camBox.style.display = 'none';
      camPreview.srcObject = null;
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 480 } }
      });
      camPreview.srcObject = camStream;
      camBox.style.display = 'block';
      camOn = true;
      camBtn.classList.add('active');
    } catch (err) {
      /* surface the real reason — permission denial, device busy, or no camera
         all show as generic failures otherwise, and are impossible to tell apart */
      let msg = 'تعذّر الوصول إلى الكاميرا';
      if (err && err.name === 'NotAllowedError')      msg += '\nالصلاحية مرفوضة — تأكد من السماح للكاميرا من إعدادات الخصوصية في ويندوز (Settings > Privacy > Camera) وسماح تطبيقات سطح المكتب بالوصول.';
      else if (err && err.name === 'NotFoundError')    msg += '\nمفيش كاميرا متاحة — تأكد إن برنامج Iriun شغال ومتصل قبل ما تضغط الزرار.';
      else if (err && err.name === 'NotReadableError') msg += '\nالكاميرا مستخدمة من برنامج تاني حاليًا (زي معاينة Iriun نفسها) — قفلها من هناك وجرّب تاني.';
      else if (err && err.name === 'OverconstrainedError') msg += '\nالكاميرا مش داعمة المقاس المطلوب.';
      else if (err) msg += `\n(${err.name}: ${err.message})`;
      alert(msg);
    }
  });

  /* drag the floating camera box around the board; a plain click (no drag)
     toggles the resize-handle controls instead of moving it */
  (function makeCamBoxDraggable() {
    let dragging = false, moved = false, offX = 0, offY = 0, startX = 0, startY = 0;
    camBox.addEventListener('mousedown', e => {
      if (e.target.classList.contains('wb-cam-h')) return;
      dragging = true;
      moved = false;
      startX = e.clientX; startY = e.clientY;
      const r = camBox.getBoundingClientRect();
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) moved = true;
      const wr = wrap.getBoundingClientRect();
      camBox.style.left   = (e.clientX - wr.left - offX) + 'px';
      camBox.style.top    = (e.clientY - wr.top  - offY) + 'px';
      camBox.style.right  = 'auto';
      camBox.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', e => {
      if (dragging && !moved && !e.target.classList.contains('wb-cam-h')) {
        camBox.classList.toggle('wb-cam-controls-visible');
      }
      dragging = false;
    });
    document.addEventListener('mousedown', e => {
      if (!camBox.contains(e.target)) camBox.classList.remove('wb-cam-controls-visible');
    });
  })();

  function pad2(n) { return String(n).padStart(2, '0'); }

  function recFrameLoop() {
    /* bgCvs/canvas are now fixed full-board bitmaps (see ensureCanvasesSized
       above), independent of the current pan/zoom — crop to whatever's
       actually on screen right now so the recording matches what the
       teacher sees, not the whole board regardless of view. */
    const srcX = (-panX / scale) * DPR;
    const srcY = (-panY / scale) * DPR;
    const srcW = (wrap.clientWidth  / scale) * DPR;
    const srcH = (wrap.clientHeight / scale) * DPR;
    recCtx.drawImage(bgCvs,  srcX, srcY, srcW, srcH, 0, 0, recCanvas.width, recCanvas.height);
    recCtx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, recCanvas.width, recCanvas.height);
    if (camOn && camPreview.readyState >= 2) {
      /* map the on-screen preview's dragged position/size (CSS px, relative to
         wrap) into the recording canvas's pixel space, so the recorded video
         matches exactly where the teacher put it on screen */
      const wr = wrap.getBoundingClientRect();
      const pr = camBox.getBoundingClientRect();
      const scaleF = recCanvas.width / wr.width;
      const cx = (pr.left - wr.left + pr.width  / 2) * scaleF;
      const cy = (pr.top  - wr.top  + pr.height / 2) * scaleF;
      const w  = pr.width  * scaleF;
      const h  = pr.height * scaleF;

      recCtx.save();
      recCtx.beginPath();
      if (camShape === 'circle') {
        recCtx.arc(cx, cy, w / 2, 0, Math.PI * 2);
      } else {
        const rr = w * 0.12;
        recCtx.roundRect(cx - w / 2, cy - h / 2, w, h, rr);
      }
      recCtx.clip();
      /* the live preview is CSS-mirrored for a natural self-view, but the
         recorded video should show the true (unmirrored) camera feed —
         otherwise anything the teacher writes/points at reads backwards */
      recCtx.drawImage(camPreview, cx - w / 2, cy - h / 2, w, h);
      recCtx.restore();

      recCtx.beginPath();
      if (camShape === 'circle') {
        recCtx.arc(cx, cy, w / 2, 0, Math.PI * 2);
      } else {
        const rr = w * 0.12;
        recCtx.roundRect(cx - w / 2, cy - h / 2, w, h, rr);
      }
      recCtx.lineWidth = 4;
      recCtx.strokeStyle = '#ffffff';
      recCtx.stroke();
    }
    recRAF = requestAnimationFrame(recFrameLoop);
  }

  async function startRecording() {
    let videoStream;

    if (recMode === 'screen') {
      videoStream = await captureOwnWindow();
      if (!videoStream) videoStream = await pickScreenSource(); // fallback: manual picker
      if (!videoStream) return; // teacher cancelled
    } else {
      recCanvas = document.createElement('canvas');
      // sized to the current viewport (not the fixed full-board canvas) —
      // recFrameLoop() crops the board bitmap down to whatever's visible
      recCanvas.width  = Math.round(wrap.clientWidth  * DPR);
      recCanvas.height = Math.round(wrap.clientHeight * DPR);
      recCtx = recCanvas.getContext('2d');
      videoStream = recCanvas.captureStream(30);
    }
    recVideoStream = videoStream;

    let stream = videoStream;

    if (micOn) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream = new MediaStream([...videoStream.getVideoTracks(), ...micStream.getAudioTracks()]);
      } catch {
        alert('تعذّر الوصول إلى المايك — سيتم التسجيل بدون صوت');
      }
    }

    const mimeCandidates = recFormat === 'mp4'
      ? ['video/mp4;codecs=avc1,mp4a', 'video/mp4']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
    const outExt   = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

    recChunks = [];
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(recChunks, { type: mimeType || 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `تسجيل-السبورة-${new Date().toLocaleDateString('ar-EG').replace(/\//g,'-')}.${outExt}`;
      a.click();
      URL.revokeObjectURL(a.href);
      if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    };

    recorder.start(1000);
    if (recMode === 'board') recFrameLoop();
    /* full-screen mode captures whatever's on screen directly (chrome UI
       included), so there's nothing to composite frame-by-frame */
    videoStream.getVideoTracks()[0].addEventListener('ended', stopRecording);

    recStartedAt = Date.now();
    recStatus.style.display = 'flex';
    recTimerId = setInterval(() => {
      const s = Math.floor((Date.now() - recStartedAt) / 1000);
      recTimeEl.textContent = `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
    }, 1000);

    recBtn.classList.add('active');
    recBtn.title = 'إيقاف التسجيل';
    recToggleIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2" fill="#ef4444"/>';
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (recRAF) cancelAnimationFrame(recRAF);
    if (recTimerId) clearInterval(recTimerId);
    if (recVideoStream) { recVideoStream.getTracks().forEach(t => t.stop()); recVideoStream = null; }
    recStatus.style.display = 'none';
    recTimeEl.textContent = '00:00';
    recBtn.classList.remove('active');
    recBtn.title = 'بدء التسجيل';
    recToggleIcon.innerHTML = '<circle cx="12" cy="12" r="8" fill="#ef4444"/>';
  }

  recBtn.addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') { stopRecording(); return; }
    if (!micOn && !confirm('المايك مش مفعّل — هيتم التسجيل بدون صوت. تحب تكمّل؟')) return;
    startRecording();
  });

  window.addEventListener('beforeunload', () => {
    if (recorder && recorder.state === 'recording') recorder.stop();
    if (camStream) camStream.getTracks().forEach(t => t.stop());
  });

  /* ── Init ── */
  overlay.style.cursor = CURSOR_MAP[tool] || 'crosshair';
  resize();
})();
