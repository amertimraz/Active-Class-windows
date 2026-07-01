/* ══════════════════════════════════════
   Whiteboard v3 — bounded board + desk surface
   ══════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Board dimensions ── */
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
  let opacity = 1; // fixed — the opacity control was removed from the UI
  let fill    = true;
  let bgType  = 'plain';
  let boardCol = '#ffffff';

  /* zoom / pan */
  let scale = 1;
  let panX  = 0;
  let panY  = 0;

  /* drawing */
  let drawing   = false;
  let isPanning = false;
  let panStart  = { x: 0, y: 0 };
  let startX = 0, startY = 0, lastX = 0, lastY = 0;

  /* history */
  let history   = [];
  let redoStack = [];
  const MAX_HIST = 50;

  /* floating image */
  let floatImg  = null;
  let floatRect = { x: 0, y: 0, w: 0, h: 0 }; // CSS px relative to wrap
  let _imgDrag  = null; // { type:'move'|'resize', dir, startX, startY, startRect }

  /* ── Resize all canvases ── */
  function resize() {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const snap = canvas.width ? canvas.toDataURL() : null;

    [bgCvs, canvas, overlay].forEach(c => { c.width = w; c.height = h; });

    centerBoard();
    drawBg();

    if (snap) {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      };
      img.src = snap;
    }
  }

  function centerBoard() {
    scale = Math.min(
      wrap.clientWidth  / BOARD_W,
      wrap.clientHeight / BOARD_H
    );
    panX = (wrap.clientWidth  - BOARD_W * scale) / 2;
    panY = (wrap.clientHeight - BOARD_H * scale) / 2;
    applyTransform();
    updateZoomLabel();
  }

  new ResizeObserver(resize).observe(wrap);

  /* ── Transform ── */
  function applyTransform() {
    [ctx, octx].forEach(c => c.setTransform(scale, 0, 0, scale, panX, panY));
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
    const step    = 40 * scale;

    bgCtx.strokeStyle = lineCol;
    bgCtx.lineWidth   = 0.5;
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
          bgCtx.beginPath(); bgCtx.arc(x, y, 1.5, 0, Math.PI * 2); bgCtx.fill();
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
      const sm = 10 * scale;
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
  function saveHistory() {
    history.push(canvas.toDataURL());
    if (history.length > MAX_HIST) history.shift();
    redoStack = [];
  }

  function restoreSnap(dataURL) {
    const img = new Image();
    img.onload = () => {
      ctx.save(); ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    };
    img.src = dataURL;
  }

  function undo() { if (!history.length) return; redoStack.push(canvas.toDataURL()); restoreSnap(history.pop()); }
  function redo() { if (!redoStack.length) return; history.push(canvas.toDataURL()); restoreSnap(redoStack.pop()); }

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
    c.setTransform(scale, 0, 0, scale, panX, panY);
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
    const r  = overlay.getBoundingClientRect();
    const cl = e.touches ? e.touches[0] : e;
    return { x: cl.clientX - r.left, y: cl.clientY - r.top };
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

    drawing = true;
    const p = clampToBoard(bd.x, bd.y);
    startX = lastX = p.x;
    startY = lastY = p.y;
    saveHistory();

    if (['pen','highlight','eraser'].includes(tool)) {
      ctx.save();
      ctx.setTransform(scale, 0, 0, scale, panX, panY);
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
    }
  }

  /* ── Pointer move ── */
  function onMove(e) {
    e.preventDefault();
    const sc = getScreen(e);
    const bd = screenToBoard(sc.x, sc.y);
    const cl = clampToBoard(bd.x, bd.y);

    document.getElementById('wbCoordsLabel').textContent =
      `${Math.round(cl.x)}, ${Math.round(cl.y)}`;

    if (isPanning) {
      panX = sc.x - panStart.x;
      panY = sc.y - panStart.y;
      applyTransform();
      drawBg();
      return;
    }

    if (!drawing) return;

    if (['pen','highlight','eraser'].includes(tool)) {
      ctx.save();
      ctx.setTransform(scale, 0, 0, scale, panX, panY);
      applyStroke(ctx);
      if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = (size * 4) / scale;
        ctx.globalAlpha = 1;
      } else if (tool === 'highlight') {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth   = (size * 6) / scale;
      }
      ctx.lineTo(cl.x, cl.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cl.x, cl.y);
      ctx.restore();
    } else {
      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.restore();
      drawShape(octx, startX, startY, cl.x, cl.y);
    }
    lastX = cl.x; lastY = cl.y;
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

    if (['line','arrow','rect','circle'].includes(tool)) {
      const bd = getBoard(e);
      const cl = clampToBoard(bd.x || lastX, bd.y || lastY);
      drawShape(ctx, startX, startY, cl.x, cl.y);
      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.restore();
    }
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
    doZoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - overlay.getBoundingClientRect().left, e.clientY - overlay.getBoundingClientRect().top);
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
    const r = overlay.getBoundingClientRect();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
    doZoom(d / lastPinch, cx, cy);
    lastPinch = d;
  }, { passive:true });

  function doZoom(factor, cx, cy) {
    const ns = Math.min(Math.max(scale * factor, 0.05), 8);
    panX = cx - (cx - panX) * (ns / scale);
    panY = cy - (cy - panY) * (ns / scale);
    scale = ns;
    applyTransform();
    drawBg();
    updateZoomLabel();
  }

  function updateZoomLabel() {
    const t = Math.round(scale * 100) + '%';
    document.getElementById('wbZoomLabel').textContent  = t;
    document.getElementById('wbZoomStatus').textContent = t;
  }

  document.getElementById('wbZoomIn').addEventListener('click',    () => doZoom(1.2, wrap.clientWidth/2, wrap.clientHeight/2));
  document.getElementById('wbZoomOut').addEventListener('click',   () => doZoom(0.8, wrap.clientWidth/2, wrap.clientHeight/2));
  document.getElementById('wbZoomReset').addEventListener('click', () => { centerBoard(); drawBg(); });

  /* ── Text tool ── */
  function placeText(bx, by) {
    const sx = bx * scale + panX;
    const sy = by * scale + panY;
    textBox.style.display  = 'block';
    textBox.style.left     = sx + 'px';
    textBox.style.top      = sy + 'px';
    textBox.style.color    = color;
    textBox.style.fontSize = (size * 5 + 14) + 'px';
    textBox.style.opacity  = opacity;
    textBox.textContent    = '';
    textBox.focus();
  }
  textBox.addEventListener('blur', () => {
    const txt = textBox.textContent.trim();
    if (txt) {
      saveHistory();
      const bd = screenToBoard(parseInt(textBox.style.left), parseInt(textBox.style.top));
      ctx.save();
      ctx.setTransform(scale, 0, 0, scale, panX, panY);
      ctx.font        = `700 ${textBox.style.fontSize} Cairo, sans-serif`;
      ctx.fillStyle   = color;
      ctx.globalAlpha = opacity;
      ctx.fillText(txt, bd.x, bd.y + parseInt(textBox.style.fontSize));
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
  });

  /* ══ TOOLBAR WIRING ══ */
  const TOOL_LABELS = { pen:'قلم', highlight:'تظليل', eraser:'ممحاة', line:'خط', arrow:'سهم', rect:'مستطيل', circle:'دائرة', triangle:'مثلث', diamond:'معين', star:'نجمة', text:'نص', hand:'يد' };

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

  /* Brush size — preset dot sizes instead of a percentage slider */
  const sizeBtn = document.getElementById('wbSizeBtn');
  document.querySelectorAll('.wb-size-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.wb-size-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      size = +opt.dataset.size;
      document.getElementById('wbSizePop').classList.remove('open');
      sizeBtn.classList.remove('open');
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
    const data = JSON.stringify({ v:3, scale, panX, panY, boardCol, bgType, img: canvas.toDataURL() });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type:'application/json' }));
    a.download = `سبورة-${new Date().toLocaleDateString('ar-EG').replace(/\//g,'-')}.wb`;
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

  function showFloatImg(imgEl, x, y, w, h) {
    floatImg  = imgEl;
    floatRect = { x, y, w, h };
    imgFloat.src = imgEl.src;
    applyFloatRect();
    imgOverlay.style.display = 'block';
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
    ctx.setTransform(scale, 0, 0, scale, panX, panY);
    ctx.drawImage(floatImg, bx, by, bw, bh);
    ctx.restore();
    cancelFloatImg();
  }

  function cancelFloatImg() {
    floatImg = null;
    _imgDrag = null;
    imgOverlay.style.display = 'none';
  }

  document.getElementById('wbImgConfirm').addEventListener('click', commitFloatImg);
  document.getElementById('wbImgCancel').addEventListener('click',  cancelFloatImg);

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
  document.getElementById('wbExportJpg').addEventListener('click', () => exportImg('jpeg'));

  function exportImg(fmt) {
    /* render at native board resolution */
    const tmp = document.createElement('canvas');
    tmp.width = BOARD_W; tmp.height = BOARD_H;
    const tc = tmp.getContext('2d');
    tc.fillStyle = boardCol;
    tc.fillRect(0, 0, BOARD_W, BOARD_H);
    /* draw strokes scaled back to board coords */
    tc.save();
    tc.setTransform(1/scale, 0, 0, 1/scale, -panX/scale, -panY/scale);
    tc.drawImage(canvas, 0, 0);
    tc.restore();
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
    if (e.target === textBox) return;
    if (floatImg) {
      if (e.key === 'Enter')  { e.preventDefault(); commitFloatImg(); return; }
      if (e.key === 'Escape') { e.preventDefault(); cancelFloatImg(); return; }
    }
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && (e.key==='y'||e.key==='Y')) { e.preventDefault(); redo(); }
    if (e.ctrlKey && e.key==='s') { e.preventDefault(); document.getElementById('wbSave').click(); }
    if (!e.ctrlKey) {
      const keyMap = { p:'pen', m:'highlight', e:'eraser', t:'text', h:'hand', l:'line', a:'arrow', r:'rect', c:'circle' };
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
    recCtx.drawImage(bgCvs, 0, 0);
    recCtx.drawImage(canvas, 0, 0);
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
      recCanvas.width  = canvas.width;
      recCanvas.height = canvas.height;
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
