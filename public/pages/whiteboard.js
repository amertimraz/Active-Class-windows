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
  let pagesData     = [{ name: 'سبورة 1', snap: null, history: [], redoStack: [] }];
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
    pagesData[currentPageIdx] = { ...pagesData[currentPageIdx], snap: snapshotCanvas(), history, redoStack };
    currentPageIdx = idx;
    const pd = pagesData[idx];
    history = pd.history;
    redoStack = pd.redoStack;
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
    pagesData.push({ name: `سبورة ${pagesData.length + 1}`, snap: null, history: [], redoStack: [] });
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

    drawing = true;
    const p = clampToBoard(bd.x, bd.y);
    startX = lastX = p.x;
    startY = lastY = p.y;
    saveHistory();

    if (['pen','highlight','eraser'].includes(tool)) {
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      applyStroke(ctx);
      if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = (size * 4) / scale;
        ctx.globalAlpha = 1;
      } else if (tool === 'highlight') {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth   = (size * 6) / scale;
      }
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.restore();
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
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      applyStroke(ctx);
      if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = (size * 4) / scale;
        ctx.globalAlpha = 1;
      } else if (tool === 'highlight') {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth   = (size * 6) / scale;
      }
      /* quadratic curve through midpoints, using the previous raw sample as
         the control point — smooths out the faceted look of raw lineTo
         segments on fast or curved strokes */
      const newMidX = (smoothRawX + cl.x) / 2;
      const newMidY = (smoothRawY + cl.y) / 2;
      ctx.beginPath();
      ctx.moveTo(smoothMidX, smoothMidY);
      ctx.quadraticCurveTo(smoothRawX, smoothRawY, newMidX, newMidY);
      ctx.stroke();
      smoothMidX = newMidX;
      smoothMidY = newMidY;
      smoothRawX = cl.x;
      smoothRawY = cl.y;
      ctx.restore();
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

    if (['line','arrow','rect','circle','triangle','diamond','star'].includes(tool)) {
      const bd = getBoard(e);
      const cl = clampToBoard(bd.x || lastX, bd.y || lastY);
      drawShape(ctx, startX, startY, cl.x, cl.y);
      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.restore();
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

  /* Text font size — separate from brush size, see wbTextSizeBtn */
  const textSizeBtn = document.getElementById('wbTextSizeBtn');
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
  wirePropPopover('wbTextSizeBtn', 'wbTextSizePop');
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
  const camZoomIn     = document.getElementById('wbCamZoomIn');
  const camZoomOut    = document.getElementById('wbCamZoomOut');
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

  /* enlarge/shrink the camera box, anchored to its current center */
  function resizeCamBox(factor) {
    const cur = camBox.getBoundingClientRect();
    const wr  = wrap.getBoundingClientRect();
    const cx  = cur.left - wr.left + cur.width  / 2;
    const cy  = cur.top  - wr.top  + cur.height / 2;
    const size = Math.max(80, Math.min(360, cur.width * factor));
    camBox.style.width  = size + 'px';
    camBox.style.height = size + 'px';
    camBox.style.left   = (cx - size / 2) + 'px';
    camBox.style.top    = (cy - size / 2) + 'px';
    camBox.style.right  = 'auto';
    camBox.style.bottom = 'auto';
  }
  camZoomIn.addEventListener('click', e  => { e.stopPropagation(); resizeCamBox(1.15); });
  camZoomOut.addEventListener('click', e => { e.stopPropagation(); resizeCamBox(0.87); });

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
     toggles the zoom +/- controls instead of moving it */
  (function makeCamBoxDraggable() {
    let dragging = false, moved = false, offX = 0, offY = 0, startX = 0, startY = 0;
    camBox.addEventListener('mousedown', e => {
      if (e.target === camZoomIn || e.target === camZoomOut) return;
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
      if (dragging && !moved && e.target !== camZoomIn && e.target !== camZoomOut) {
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
