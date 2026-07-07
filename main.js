// Simple Electron main process
const { app, BrowserWindow, ipcMain, dialog, session, shell, desktopCapturer, Notification, Menu } = require('electron');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Interactive touchscreens (the app targets classroom smartboards): make sure
// Chromium treats touch/stylus input as real touch events with multi-touch,
// instead of falling back to synthesized single-point mouse emulation.
app.commandLine.appendSwitch('touch-events', 'enabled');
app.commandLine.appendSwitch('enable-pointer-lock-options');
app.commandLine.appendSwitch('disable-features', 'TouchpadAndWheelScrollLatching');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const XLSX = require('xlsx');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const log = require('./server/logger').create('main');

// ── License helpers ────────────────────────────────────────────────────────
const LICENSE_FILE = () => path.join(app.getPath('userData'), 'ac_license.json');

// ── Trial helpers ──────────────────────────────────────────────────────────
const TRIAL_DAYS   = 7;
const TRIAL_FILE   = () => path.join(app.getPath('userData'), 'ac_trial.json');
const TRIAL_LIMITS = { maxGroups: 1, maxStudents: 10, maxQuizzes: 2, allowedGames: 3, competitions: false, content: true, maxGrades: 1, maxUnits: 2, maxLessons: 3 };

function readTrialFile()  { try { return JSON.parse(fs.readFileSync(TRIAL_FILE(), 'utf8')); } catch { return null; } }
function writeTrialFile(d){ try { fs.writeFileSync(TRIAL_FILE(), JSON.stringify(d, null, 2), 'utf8'); } catch {} }
function isTrialValid(t)  { return !!(t?.expiresAt && new Date(t.expiresAt) > new Date()); }

function getMachineId() {
  // Stable fingerprint from hostname + platform + CPU model (no extra deps)
  const raw = [os.hostname(), os.platform(), os.arch(),
                (os.cpus()[0]?.model || ''), String(os.totalmem())].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24).toUpperCase();
}

function readLicenseFile() {
  try { return JSON.parse(fs.readFileSync(LICENSE_FILE(), 'utf8')); }
  catch { return null; }
}

function writeLicenseFile(data) {
  try { fs.writeFileSync(LICENSE_FILE(), JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { log.error('writeLicenseFile:', e.message); }
}

function isLicenseValid(lic) {
  if (!lic || !lic.expiresAt || !lic.key) return false;
  if (new Date(lic.expiresAt) <= new Date()) return false;
  // Offline grace: allow 7 days without re-verifying against server
  if (lic.cachedAt) {
    const daysSinceCached = (Date.now() - new Date(lic.cachedAt).getTime()) / 86400000;
    if (daysSinceCached > 7) return false;
  }
  return true;
}

// License verification — tries remote server first (for client machines),
async function verifyWithServer(key, machineId) {
  // Licenses are stored in Firestore — the local server reads from it directly.
  try {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/license/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, machineId }),
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    if (data && (data.ok === true || data.ok === false)) return data;
  } catch { /* server not ready */ }
  return null;
}
// ──────────────────────────────────────────────────────────────────────────

// Single source of truth for the renderer Content-Security-Policy (was
// duplicated across every BrowserWindow). Update here only.
const CSP_VALUE = `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:* https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://script.google.com https://script.googleusercontent.com; media-src 'self' data: blob:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://wordwall.net https://*.wordwall.net https://learningapps.org https://*.learningapps.org https://cokogames.com https://*.cokogames.com; worker-src 'self' blob: https://cdnjs.cloudflare.com;`;

// Uniform in-place shuffle (Fisher–Yates). Replaces the biased
// `arr.sort(() => Math.random() - 0.5)` idiom, which does not produce a
// uniform permutation — it matters for fair question selection/ordering.
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let mainWindow;
let numbersWindow;
let wheelWindow;
let serverProcess;
// Keep references to tool windows to prevent GC from closing them
const toolWindows = new Map();

// ── Backup helpers (module scope so both the periodic timer inside
// createWindow() and the top-level before-quit handler share one
// implementation — this is what let the on-close path silently drift out
// of sync with a wrong DB path before) ──────────────────────────────────
function makeBackupName(ext) {
  const _n = new Date();
  const stamp = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}_${String(_n.getHours()).padStart(2,'0')}-${String(_n.getMinutes()).padStart(2,'0')}`;
  return `activeclass_backup_${stamp}.${ext}`;
}

const AUTO_BACKUP_KEEP = 10; // retention: keep only the N most recent auto-backups per folder

function cleanupOldBackups(folder) {
  try {
    const files = fs.readdirSync(folder)
      .filter(f => /^activeclass_backup_.*\.acbak$/.test(f))
      .map(f => ({ name: f, time: fs.statSync(path.join(folder, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const old of files.slice(AUTO_BACKUP_KEEP)) {
      fs.unlinkSync(path.join(folder, old.name));
    }
  } catch (e) {
    log.warn(`[AutoBackup] Cleanup failed: ${e.message}`);
  }
}

function notifyBackupFailure(context, message) {
  log.warn(`[AutoBackup] ${context} failed: ${message}`);
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'فشل النسخ الاحتياطي التلقائي',
        body: `${context}: تعذّر إنشاء نسخة احتياطية. راجع الإعدادات ← النسخ الاحتياطي.`,
      }).show();
    }
  } catch {}
}

// The live SQLite DB lives under <userData>/classroom-data/ (set as
// APP_DATA_DIR for the server — see startServer() below), NOT directly in
// userData. Backing up from the wrong path silently failed with ENOENT on
// every periodic/on-close run before this fix.
//
// Produces the same .acbak ZIP format as the manual "تصدير نسخة احتياطية"
// export (database + db.json together) so auto-backups are never missing
// data compared to a manual one, and old backups beyond AUTO_BACKUP_KEEP
// get pruned so the folder doesn't grow unbounded.
function doBackup(folder) {
  const dataDir = path.join(app.getPath('userData'), 'classroom-data');
  const dbSrc   = path.join(dataDir, 'activeclass.db');
  const jsonSrc = path.join(dataDir, 'db.json');
  const dest    = path.join(folder, makeBackupName('acbak'));

  const zip = new AdmZip();
  zip.addLocalFile(dbSrc, '', 'activeclass.db');
  if (fs.existsSync(jsonSrc)) zip.addLocalFile(jsonSrc, '', 'db.json');
  zip.writeZip(dest);

  cleanupOldBackups(folder);
  return dest;
}

async function createWindow() {
  const { screen } = require('electron');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  // Scale up on large screens (interactive whiteboards etc.)
  let zoom = 1.0;
  if (sw >= 3840) zoom = 2.0;       // 4K
  else if (sw >= 2560) zoom = 1.5;  // 2K / QHD
  else if (sw >= 1920) zoom = 1.0;  // FHD

  const winW = Math.min(Math.round(sw * 0.92), 1600);
  const winH = Math.min(Math.round(sh * 0.92), 1000);

  // Spoof user-agent so YouTube iframes don't block playback in Electron
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'public/assets/logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webSecurity: true,
      sandbox: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js'),
      // Needed so window.api is available inside same-origin <iframe>s (e.g. the
      // whiteboard embedded as a lesson-content slide). preload.js guards the
      // actual exposeInMainWorld calls to our own localhost origin, so arbitrary
      // external sites loaded via the "web link" content type still get nothing.
      nodeIntegrationInSubFrames: true
    }
  });

  mainWindow.webContents.setUserAgent(chromeUA);

  // Fix YouTube error 153: spoof Referer/Origin so YouTube accepts the embed
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.ytimg.com/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      headers['Referer'] = 'https://www.youtube.com/';
      headers['Origin']  = 'https://www.youtube.com';
      callback({ requestHeaders: headers });
    }
  );

  // Set CSP header — only for our own server responses so external iframes
  // (YouTube, Vimeo) can still load their own scripts without interference.
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ['http://localhost:5000/*'] },
    (details, callback) => {
      const h = {};
      for (const [k, v] of Object.entries(details.responseHeaders)) {
        if (k.toLowerCase() !== 'content-security-policy') h[k] = v;
      }
      callback({ responseHeaders: { ...h, 'Content-Security-Policy': [CSP_VALUE] } });
    }
  );

  // Ensure tool windows close when main window closes
  try {
    mainWindow.on('close', () => {
      for (const [key, win] of toolWindows.entries()) {
        try { if (win && !win.isDestroyed()) win.close(); } catch {}
      }
      toolWindows.clear();
    });
  } catch {}

  // Load the app — activation screen first if not licensed/trialing
  const APP_URL = 'http://localhost:5000';
  const lic   = readLicenseFile();
  const trial = readTrialFile();
  let startUrl = `${APP_URL}/pages/activation.html`;
  if (isLicenseValid(lic)) {
    startUrl = APP_URL;
  } else if (isTrialValid(trial)) {
    // Check revocation on startup before loading the app
    try {
      const mid = getMachineId();
      const r = await fetch(`${APP_URL}/api/trial-status?machineId=${encodeURIComponent(mid)}`,
        { signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      if (data.revoked) {
        writeTrialFile({ ...trial, expiresAt: new Date(0).toISOString(), revokedByAdmin: true });
      } else {
        startUrl = APP_URL;
      }
    } catch {
      startUrl = APP_URL; // offline — give benefit of the doubt
    }
  }
  mainWindow.loadURL(startUrl);
  mainWindow.webContents.on('did-finish-load', () => {
    if (zoom !== 1.0) mainWindow.webContents.setZoomFactor(zoom);
  });

  // Background license re-validation on startup — catches revoked licenses
  if (isLicenseValid(lic)) {
    setTimeout(async () => {
      try {
        const result = await verifyWithServer(lic.key, lic.machineId);
        if (result && result.ok === false) {
          // Server explicitly revoked — wipe local cache and redirect
          try { fs.unlinkSync(LICENSE_FILE()); } catch {}
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL(`${APP_URL}/pages/activation.html`);
          }
        } else if (result && result.ok) {
          // Re-verified — refresh cachedAt so offline grace resets
          writeLicenseFile({ ...lic, ...result, key: lic.key, machineId: lic.machineId, cachedAt: new Date().toISOString() });
        }
      } catch {}
    }, 3000); // give the app time to finish loading before any redirect
  }

  // Poll every 30s: check local trial expiry AND remote revocation
  if (isTrialValid(trial)) {
    const trialWatcher = setInterval(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) { clearInterval(trialWatcher); return; }
      const currentLic = readLicenseFile();
      if (isLicenseValid(currentLic)) { clearInterval(trialWatcher); return; }
      const currentTrial = readTrialFile();
      if (!isTrialValid(currentTrial)) {
        clearInterval(trialWatcher);
        mainWindow.loadURL(`${APP_URL}/pages/activation.html`);
        return;
      }
      // Check if admin revoked this machine remotely
      try {
        const mid = getMachineId();
        const r = await fetch(`${APP_URL}/api/trial-status?machineId=${encodeURIComponent(mid)}`);
        const data = await r.json();
        if (data.revoked) {
          clearInterval(trialWatcher);
          writeTrialFile({ ...currentTrial, expiresAt: new Date(0).toISOString(), revokedByAdmin: true });
          mainWindow.loadURL(`${APP_URL}/pages/activation.html`);
        }
      } catch {}
    }, 30000);
  }

  // Same-origin popups (e.g. "معاينة الاختبار" opening quiz-view.html via
  // window.open) should stay inside the app as a real Electron window instead
  // of being treated as an external link — otherwise they get kicked out to
  // the system browser, which breaks window.opener/closeQuizWindow() and
  // looks like the quiz "opened in a separate web page".
  // Everything else (embedded games, external links) still opens in the
  // system browser as before.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin === APP_URL) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 1200,
            height: 800,
            autoHideMenuBar: true,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: false,
              preload: path.join(__dirname, 'preload.js')
            }
          }
        };
      }
    } catch {}
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Retry a few times if initial load fails due to server not being ready
  try {
    let retryAttempts = 0;
    const maxRetry = 10;
    const retryDelay = 600; // ms
    mainWindow.webContents.on('did-fail-load', (_e, errorCode) => {
      // Handle common connection errors
      if ([-102, -105, -106, -118].includes(errorCode)) {
        if (retryAttempts < maxRetry) {
          retryAttempts += 1;
          setTimeout(() => {
            try { mainWindow.loadURL(APP_URL); } catch {}
          }, retryDelay);
        }
      }
    });
  } catch {}
  
  // Open DevTools only in development (prevents noisy Autofill.* errors otherwise)
  if (!app.isPackaged && process.env.OPEN_DEVTOOLS !== '0') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// Computes where a settings popover should sit relative to its owning
// display window — reused both when first opening the popover and
// whenever the display window is dragged, so the popover stays glued to
// it. Shared by the names and wheel tools.
function computeSettingsPopoverPosition(ownerWin, popW, popH) {
  const { screen } = require('electron');
  const b = ownerWin.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  // prefer opening to the left of the owner window, but flip to the
  // right (or clamp) if that would land off-screen
  const x = (b.x - (popW + 10) >= area.x) ? b.x - (popW + 10) : Math.min(b.x + b.width + 10, area.x + area.width - popW);
  const y = Math.max(area.y, Math.min(b.y, area.y + area.height - popH));
  return { x, y };
}
function positionSettingsPopover(ownerWin, popoverWin, popW, popH) {
  try {
    const { x, y } = computeSettingsPopoverPosition(ownerWin, popW, popH);
    popoverWin.setPosition(x, y);
  } catch {}
}

function createNumbersWindow() {
  // Reuse single window instance
  const existing = toolWindows.get('numbers');
  if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return existing; }

  // Small fixed-size display window — same two-window pattern as names and
  // wheel: this window only shows the big number + generate button, all
  // range/count/sound settings live in the separate numbers-settings popover.
  const win = new BrowserWindow({
    width: 255,
    height: 260,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');

  // Optional CSP for numbers window (same as main)
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          CSP_VALUE
        ]
      }
    });
  });

  win.loadURL('http://localhost:5000/pages/numbers-display.html');

  // Keep the settings popover glued to this window whenever it's dragged.
  win.on('move', () => {
    const settingsWin = toolWindows.get('numbers-settings');
    if (settingsWin && !settingsWin.isDestroyed()) positionSettingsPopover(win, settingsWin, 230, 260);
  });
  win.on('closed', () => {
    toolWindows.delete('numbers');
    const settingsWin = toolWindows.get('numbers-settings');
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  });
  toolWindows.set('numbers', win);
  return win;
}

function createWheelWindow() {
  const existing = toolWindows.get('wheel');
  if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return existing; }

  // Small fixed-size display window — mirrors the names picker's two-window
  // pattern: this window only ever shows the wheel + spin button, all
  // participant/settings management lives in the separate wheel-settings
  // popover so this window never needs to resize.
  const win = new BrowserWindow({
    width: 270,
    height: 330,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');

  // Set CSP header for wheel window
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          CSP_VALUE
        ]
      }
    });
  });

  win.loadURL('http://localhost:5000/pages/wheel-display.html');

  // Keep the settings popover glued to this window whenever it's dragged.
  win.on('move', () => {
    const settingsWin = toolWindows.get('wheel-settings');
    if (settingsWin && !settingsWin.isDestroyed()) positionSettingsPopover(win, settingsWin, 260, 360);
  });
  win.on('closed', () => {
    toolWindows.delete('wheel');
    const settingsWin = toolWindows.get('wheel-settings');
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  });
  toolWindows.set('wheel', win);
  return win;
}

const SERVER_API_KEY = crypto.randomBytes(16).toString('hex');
const SERVER_PORT = 5000;

// Thin wrapper: call the internal Express API on behalf of IPC handlers.
// The server is always running before any renderer IPC fires (startServer →
// createWindow order), so the fetch is safe.
async function serverFetch(endpoint, options = {}) {
  const res = await fetch(`http://localhost:${SERVER_PORT}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': SERVER_API_KEY,
      ...(options.headers || {}),
    },
  });
  return res.json();
}

function startServer() {
  return new Promise((resolve) => {
    const userDataPath = app.getPath('userData');

    // Set env vars the server reads at startup
    process.env.APP_DATA_DIR    = path.join(userDataPath, 'classroom-data');
    process.env.APP_DB_PATH     = path.join(userDataPath, 'db.json');
    process.env.APP_UPLOADS_DIR = path.join(userDataPath, 'uploads');
    process.env.APP_TRIAL_FILE  = path.join(userDataPath, 'ac_trial.json');
    process.env.SERVER_API_KEY  = SERVER_API_KEY;

    // In both packaged and dev mode, require() the server directly in the main process.
    // This avoids spawning a child process that may not find node in PATH.
    try {
      const net = require('net');
      const checkPort = () => {
        const client = net.createConnection({ port: 5000, host: '127.0.0.1' }, () => {
          client.destroy();
          resolve();
        });
        client.on('error', () => setTimeout(checkPort, 300));
      };

      require('./server/server.js');
      setTimeout(checkPort, 500);
    } catch (err) {
      log.error(`Failed to require server: ${err.message}`);
      const { dialog } = require('electron');
      dialog.showErrorBox('Server Error', `فشل تشغيل السيرفر:\n${err.message}`);
      resolve();
    }
  });
}

app.whenReady().then(async () => {
  // Every window is frameless with its own custom title-bar controls (no
  // native menu bar is ever shown), but Electron still installs its
  // *default* application menu unless explicitly cleared — and that
  // default menu's Edit role binds CmdOrCtrl+Z/Y/X/C/V as global
  // accelerators. Those accelerators intercept the keystroke before it
  // ever reaches renderer JS, which silently broke pages with their own
  // custom Ctrl+Z/Ctrl+Y handlers (e.g. the whiteboard's undo/redo) even
  // though clicking the on-screen buttons worked fine.
  Menu.setApplicationMenu(null);

  // Block ad networks in embedded games
  const adBlockList = [
    '*://*.googlesyndication.com/*',
    '*://*.googleads.g.doubleclick.net/*',
    '*://*.pagead2.googlesyndication.com/*',
    '*://*.azerioncircle.com/*',
    '*://*.gamemonetize.com/*',
    '*://*.criteo.net/*',
  ];
  session.defaultSession.webRequest.onBeforeRequest({ urls: adBlockList }, (_details, callback) => {
    callback({ cancel: true });
  });

  // Spoof Referer/Origin for external game sites so embedded games load correctly

  // Per-domain Referer spoof so each site sees its own domain as referrer
  const spoofMap = [
    { match: 'mathplayground.com', referer: 'https://www.mathplayground.com/', origin: 'https://www.mathplayground.com' },
    { match: 'cokoplay.com',       referer: 'https://www.cokoplay.com/',       origin: 'https://www.cokoplay.com'       },
    { match: 'lofgames.com',       referer: 'https://www.lofgames.com/',       origin: 'https://www.lofgames.com'       },
    { match: 'cokogames.com',      referer: 'https://www.cokogames.com/',      origin: 'https://www.cokogames.com'      },
    { match: 'wordwall.net',       referer: 'https://wordwall.net/',           origin: 'https://wordwall.net'           },
  ];
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      if (!details.url.startsWith('file://')) {
        const rule = spoofMap.find(r => details.url.includes(r.match));
        if (rule) {
          details.requestHeaders['Referer'] = rule.referer;
          details.requestHeaders['Origin']  = rule.origin;
        }
        details.requestHeaders['User-Agent'] = UA;
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // IPC handlers (invoke)
  ipcMain.handle('open-tool-window', async (_e, toolName) => {
    try {
      if (toolName === 'names') {
        // Names tool window (standalone page)
        const existing = toolWindows.get('names');
        if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return { ok: true }; }
        const win = new BrowserWindow({
          width: 255,
          height: 260,
          frame: false,
          transparent: true,
          resizable: true,
          alwaysOnTop: true,
          backgroundColor: '#00000000',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          const h2 = {}; for (const [k,v] of Object.entries(details.responseHeaders)) { if (k.toLowerCase() !== 'content-security-policy') h2[k]=v; } callback({ responseHeaders: { ...h2, 'Content-Security-Policy': [CSP_VALUE] } });
        });
        win.loadURL('http://localhost:5000/pages/names.html');
        // Keep the settings popover glued to this window whenever it's dragged.
        win.on('move', () => {
          const settingsWin = toolWindows.get('names-settings');
          if (settingsWin && !settingsWin.isDestroyed()) positionSettingsPopover(win, settingsWin, 230, 280);
        });
        win.on('closed', () => {
          toolWindows.delete('names');
          const settingsWin = toolWindows.get('names-settings');
          if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
        });
        toolWindows.set('names', win);
        return { ok: true };
      }
      if (toolName === 'names-settings') {
        // Small popover-style settings window for the names picker — kept
        // entirely separate from the main names window so that window can
        // stay one fixed, tiny size forever (no more resize-on-open-settings
        // dance, which kept hitting an Electron/Windows transparent-window
        // repaint bug).
        const existing = toolWindows.get('names-settings');
        if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return { ok: true }; }
        const namesWin = toolWindows.get('names');
        let x, y;
        try {
          if (namesWin && !namesWin.isDestroyed()) {
            ({ x, y } = computeSettingsPopoverPosition(namesWin, 230, 280));
          }
        } catch (posErr) {
          log.error('names-settings positioning failed, using OS default: ' + (posErr?.message || posErr));
          x = undefined; y = undefined;
        }
        const win = new BrowserWindow({
          width: 230,
          height: 280,
          x, y,
          frame: false,
          transparent: true,
          resizable: true,
          alwaysOnTop: true,
          backgroundColor: '#00000000',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          const h2 = {}; for (const [k,v] of Object.entries(details.responseHeaders)) { if (k.toLowerCase() !== 'content-security-policy') h2[k]=v; } callback({ responseHeaders: { ...h2, 'Content-Security-Policy': [CSP_VALUE] } });
        });
        win.loadURL('http://localhost:5000/pages/names-settings.html');
        win.on('closed', () => { toolWindows.delete('names-settings'); });
        toolWindows.set('names-settings', win);
        return { ok: true };
      }
      if (toolName === 'timer') {
        // Small fixed-size display window — same two-window pattern as the
        // other tools: this window only shows the countdown + start/reset,
        // all duration/mode/sound settings live in the timer-settings popover.
        // Fullscreen uses Electron's native setFullScreen (an OS-level
        // window-state switch, not a setBounds resize), so it doesn't hit
        // the transparent-window repaint bug that ruled out runtime resizing.
        const existing = toolWindows.get('timer');
        if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return { ok: true }; }
        const win = new BrowserWindow({
          width: 290,
          height: 300,
          frame: false,
          transparent: true,
          resizable: true,
          alwaysOnTop: true,
          backgroundColor: '#00000000',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          const h2 = {}; for (const [k,v] of Object.entries(details.responseHeaders)) { if (k.toLowerCase() !== 'content-security-policy') h2[k]=v; } callback({ responseHeaders: { ...h2, 'Content-Security-Policy': [CSP_VALUE] } });
        });
        win.loadURL('http://localhost:5000/pages/timer-display.html');
        win.on('enter-full-screen', () => { try { win.webContents.send('fullscreen-changed', true); } catch {} });
        win.on('leave-full-screen', () => { try { win.webContents.send('fullscreen-changed', false); } catch {} });
        win.on('move', () => {
          const settingsWin = toolWindows.get('timer-settings');
          if (settingsWin && !settingsWin.isDestroyed()) positionSettingsPopover(win, settingsWin, 230, 300);
        });
        win.on('closed', () => {
          toolWindows.delete('timer');
          const settingsWin = toolWindows.get('timer-settings');
          if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
        });
        toolWindows.set('timer', win);
        return { ok: true };
      }
      if (toolName === 'timer-settings') {
        // Small popover-style settings window for the timer — duration,
        // count type, quick presets, sound toggle.
        const existing = toolWindows.get('timer-settings');
        if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return { ok: true }; }
        const timerWin = toolWindows.get('timer');
        let x, y;
        try {
          if (timerWin && !timerWin.isDestroyed()) {
            ({ x, y } = computeSettingsPopoverPosition(timerWin, 230, 300));
          }
        } catch (posErr) {
          log.error('timer-settings positioning failed, using OS default: ' + (posErr?.message || posErr));
          x = undefined; y = undefined;
        }
        const win = new BrowserWindow({
          width: 230,
          height: 300,
          x, y,
          frame: false,
          transparent: true,
          resizable: true,
          alwaysOnTop: true,
          backgroundColor: '#00000000',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          const h2 = {}; for (const [k,v] of Object.entries(details.responseHeaders)) { if (k.toLowerCase() !== 'content-security-policy') h2[k]=v; } callback({ responseHeaders: { ...h2, 'Content-Security-Policy': [CSP_VALUE] } });
        });
        win.loadURL('http://localhost:5000/pages/timer-settings.html');
        win.on('closed', () => { toolWindows.delete('timer-settings'); });
        toolWindows.set('timer-settings', win);
        return { ok: true };
      }
      if (toolName === 'numbers') {
        createNumbersWindow();
        return { ok: true };
      }
      if (toolName === 'numbers-settings') {
        // Small popover-style settings window for the numbers generator —
        // range, count, sound, and no-repeat toggle. Same reasoning as the
        // names/wheel popovers: keeps the display window one fixed size.
        const existing = toolWindows.get('numbers-settings');
        if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return { ok: true }; }
        const numbersWin = toolWindows.get('numbers');
        let x, y;
        try {
          if (numbersWin && !numbersWin.isDestroyed()) {
            ({ x, y } = computeSettingsPopoverPosition(numbersWin, 230, 260));
          }
        } catch (posErr) {
          log.error('numbers-settings positioning failed, using OS default: ' + (posErr?.message || posErr));
          x = undefined; y = undefined;
        }
        const win = new BrowserWindow({
          width: 230,
          height: 260,
          x, y,
          frame: false,
          transparent: true,
          resizable: true,
          alwaysOnTop: true,
          backgroundColor: '#00000000',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          const h2 = {}; for (const [k,v] of Object.entries(details.responseHeaders)) { if (k.toLowerCase() !== 'content-security-policy') h2[k]=v; } callback({ responseHeaders: { ...h2, 'Content-Security-Policy': [CSP_VALUE] } });
        });
        win.loadURL('http://localhost:5000/pages/numbers-settings.html');
        win.on('closed', () => { toolWindows.delete('numbers-settings'); });
        toolWindows.set('numbers-settings', win);
        return { ok: true };
      }
      if (toolName === 'wheel') {
        createWheelWindow();
        return { ok: true };
      }
      if (toolName === 'wheel-settings') {
        // Small popover-style settings window for the wheel — participants
        // list, add/group-load/shuffle/clear, sound + exclude-winner toggles.
        // Kept separate from the wheel display window for the same reason
        // as the names tool: the display window stays one fixed tiny size.
        const existing = toolWindows.get('wheel-settings');
        if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return { ok: true }; }
        const wheelWin = toolWindows.get('wheel');
        let x, y;
        try {
          if (wheelWin && !wheelWin.isDestroyed()) {
            ({ x, y } = computeSettingsPopoverPosition(wheelWin, 260, 360));
          }
        } catch (posErr) {
          log.error('wheel-settings positioning failed, using OS default: ' + (posErr?.message || posErr));
          x = undefined; y = undefined;
        }
        const win = new BrowserWindow({
          width: 260,
          height: 360,
          x, y,
          frame: false,
          transparent: true,
          resizable: true,
          alwaysOnTop: true,
          backgroundColor: '#00000000',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          const h2 = {}; for (const [k,v] of Object.entries(details.responseHeaders)) { if (k.toLowerCase() !== 'content-security-policy') h2[k]=v; } callback({ responseHeaders: { ...h2, 'Content-Security-Policy': [CSP_VALUE] } });
        });
        win.loadURL('http://localhost:5000/pages/wheel-settings.html');
        win.on('closed', () => { toolWindows.delete('wheel-settings'); });
        toolWindows.set('wheel-settings', win);
        return { ok: true };
      }
      return { ok: false, error: 'Unknown tool' };
    } catch (err) {
      log.error(`open-tool-window(${toolName}) failed: ${err?.stack || err}`);
      return { ok: false, error: err?.message };
    }
  });

  ipcMain.handle('open-wheel-window', async () => {
    createWheelWindow();
  });
  ipcMain.handle('open-numbers-window', async () => {
    createNumbersWindow();
    return { ok: true };
  });

  // Support renderer 'send' calls as well
  ipcMain.on('open-wheel-window', () => {
    createWheelWindow();
  });

  // Window control handlers for tools (both invoke and send supported)
  // Unpinning a window that was raised with the 'screen-saver' level is
  // unreliable on Windows if you just flip the flag — the OS-level z-order
  // priority set by that level tends to stick. Explicitly dropping to the
  // lowest normal level (and never re-passing a level string once disabled)
  // is what actually releases it.
  function applyAlwaysOnTop(event, flag) {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      if (flag) {
        win.setAlwaysOnTop(true, 'screen-saver');
      } else {
        // Jumping straight from 'screen-saver' to false doesn't reliably
        // release the OS-level z-order on Windows — step the level down
        // first (still "on top", but at the lowest priority) before
        // actually disabling always-on-top, which is what makes it stick.
        win.setAlwaysOnTop(true, 'normal');
        win.setAlwaysOnTop(false);
      }
    } catch {}
  }
  ipcMain.handle('set-always-on-top', async (event, flag) => applyAlwaysOnTop(event, flag));
  ipcMain.on('set-always-on-top', (event, flag) => applyAlwaysOnTop(event, flag));

  ipcMain.handle('toggle-fullscreen', async (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.setFullScreen(!win.isFullScreen()); } catch {}
  });
  ipcMain.on('toggle-fullscreen', (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.setFullScreen(!win.isFullScreen()); } catch {}
  });

  // win.isFullScreen() is unreliable for frameless/transparent windows on
  // Windows (observed always returning false even while visually
  // fullscreen), which makes a "toggle based on current state" approach
  // get stuck. The timer display window instead tracks its own fullscreen
  // state client-side and tells main exactly which state to set.
  ipcMain.on('set-fullscreen', (event, flag) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.setFullScreen(!!flag); } catch {}
  });

  ipcMain.handle('focus-window', async (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) { win.show(); win.focus(); } } catch {}
  });
  ipcMain.on('focus-window', (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) { win.show(); win.focus(); } } catch {}
  });

  // Transparent frameless windows on Windows have a known Electron/Chromium quirk:
  // shrinking them with setSize() alone often leaves the old (larger) transparent
  // backing surface stale/visible until something forces a repaint — the window
  // *is* smaller, but stale pixels from the previous larger size stay drawn over
  // whatever's behind it. Nudging the size by 1px and back forces that repaint.
  function resizeTransparentWindow(win, width, height) {
    // was clamped to a hardcoded 320×300 minimum, which silently overrode
    // any smaller size a tool window asked for (e.g. names.js requesting a
    // compact 255×234) — every "shrink" call was quietly ignored
    const w = Math.max(180, Math.floor(width));
    const h = Math.max(160, Math.floor(height));
    const [x, y] = win.getPosition();
    // setBounds (not setSize) + no animation: this is the combination that
    // actually forces Windows to repaint a transparent frameless window at
    // its new size instead of leaving the old backing surface visible.
    win.setBounds({ x, y, width: w, height: h }, false);
  }

  ipcMain.handle('resize-window', async (event, payload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const { width, height } = payload || {};
      if (win && typeof width === 'number' && typeof height === 'number') {
        resizeTransparentWindow(win, width, height);
        return { ok: true };
      }
      return { ok: false, error: 'Invalid size' };
    } catch (e) {
      return { ok: false, error: e?.message };
    }
  });
  ipcMain.on('resize-window', (event, payload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const { width, height } = payload || {};
      if (win && typeof width === 'number' && typeof height === 'number') {
        resizeTransparentWindow(win, width, height);
      }
    } catch {}
  });

  // Relay settings changes from the small names-settings popover to the
  // main names window — the two windows never share state directly.
  ipcMain.on('names-settings-update', (_event, payload) => {
    try {
      const namesWin = toolWindows.get('names');
      if (namesWin && !namesWin.isDestroyed()) namesWin.webContents.send('names-settings-update', payload);
    } catch {}
  });

  // Close the settings popover the moment a pick starts — the user is done
  // configuring and the popover only gets in the way of the reveal.
  ipcMain.on('names-close-settings', () => {
    try {
      const settingsWin = toolWindows.get('names-settings');
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    } catch {}
  });

  // Same relay pattern as names-settings-update, for the wheel tool.
  ipcMain.on('wheel-settings-update', (_event, payload) => {
    try {
      const wheelWin = toolWindows.get('wheel');
      if (wheelWin && !wheelWin.isDestroyed()) wheelWin.webContents.send('wheel-settings-update', payload);
    } catch {}
  });

  // Close the wheel settings popover the moment a spin starts.
  ipcMain.on('wheel-close-settings', () => {
    try {
      const settingsWin = toolWindows.get('wheel-settings');
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    } catch {}
  });

  // The display window resolves the spin and reports the winner back so the
  // settings popover (source of truth for the participant list) can remove
  // them when "exclude winner" is on.
  ipcMain.on('wheel-winner-picked', (_event, payload) => {
    try {
      const settingsWin = toolWindows.get('wheel-settings');
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('wheel-winner-picked', payload);
    } catch {}
  });

  // Same relay pattern as names/wheel settings, for the numbers generator.
  ipcMain.on('numbers-settings-update', (_event, payload) => {
    try {
      const numbersWin = toolWindows.get('numbers');
      if (numbersWin && !numbersWin.isDestroyed()) numbersWin.webContents.send('numbers-settings-update', payload);
    } catch {}
  });

  // Close the numbers settings popover the moment generation starts.
  ipcMain.on('numbers-close-settings', () => {
    try {
      const settingsWin = toolWindows.get('numbers-settings');
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    } catch {}
  });

  // Same relay pattern as names/wheel/numbers settings, for the timer.
  ipcMain.on('timer-settings-update', (_event, payload) => {
    try {
      const timerWin = toolWindows.get('timer');
      if (timerWin && !timerWin.isDestroyed()) timerWin.webContents.send('timer-settings-update', payload);
    } catch {}
  });

  // Close the timer settings popover the moment the countdown starts.
  ipcMain.on('timer-close-settings', () => {
    try {
      const settingsWin = toolWindows.get('timer-settings');
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    } catch {}
  });

  ipcMain.handle('minimize-window', async (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.minimize(); } catch {}
  });
  ipcMain.on('minimize-window', (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.minimize(); } catch {}
  });

  ipcMain.handle('close-window', async (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.close(); } catch {}
  });
  ipcMain.on('close-window', (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.close(); } catch {}
  });

  ipcMain.on('maximize-window', (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
    } catch {}
  });

  // ===== Groups & Students — delegate to SQLite via HTTP API =====

  ipcMain.handle('load-groups', async () => {
    try { return await serverFetch('/api/groups'); }
    catch (e) { log.error('load-groups:', e.message); return []; }
  });

  ipcMain.handle('save-groups', async (_e, groups) => {
    try { return await serverFetch('/api/groups/bulk', { method: 'PUT', body: JSON.stringify(groups) }); }
    catch (e) { log.error('save-groups:', e.message); return { ok: false, error: e.message }; }
  });

  ipcMain.handle('update-group', async (_e, group) => {
    try {
      if (!group?.id) return { ok: false, error: 'Missing group id' };
      return await serverFetch(`/api/groups/${group.id}`, { method: 'PUT', body: JSON.stringify(group) });
    } catch (e) { log.error('update-group:', e.message); return { ok: false, error: e.message }; }
  });

  ipcMain.handle('delete-group', async (_e, groupId) => {
    try {
      if (!groupId) return { ok: false, error: 'Missing group id' };
      return await serverFetch(`/api/groups/${groupId}`, { method: 'DELETE' });
    } catch (e) { log.error('delete-group:', e.message); return { ok: false, error: e.message }; }
  });

  ipcMain.handle('load-students', async () => {
    try { return await serverFetch('/api/students'); }
    catch (e) { log.error('load-students:', e.message); return []; }
  });

  ipcMain.handle('save-students', async (_e, students) => {
    try { return await serverFetch('/api/students/bulk', { method: 'PUT', body: JSON.stringify(students) }); }
    catch (e) { log.error('save-students:', e.message); return { ok: false, error: e.message }; }
  });

  ipcMain.handle('add-student', async (_e, student) => {
    try {
      if (!student || typeof student !== 'object') return { ok: false, error: 'Invalid student' };
      return await serverFetch('/api/students', { method: 'POST', body: JSON.stringify(student) });
    } catch (e) { log.error('add-student:', e.message); return { ok: false, error: e.message }; }
  });

  ipcMain.handle('update-student', async (_e, student) => {
    try {
      if (!student?.id) return { ok: false, error: 'Missing student id' };
      return await serverFetch(`/api/students/${student.id}`, { method: 'PUT', body: JSON.stringify(student) });
    } catch (e) { log.error('update-student:', e.message); return { ok: false, error: e.message }; }
  });

  ipcMain.handle('delete-student', async (_e, studentId) => {
    try {
      if (!studentId) return { ok: false, error: 'Missing student id' };
      return await serverFetch(`/api/students/${studentId}`, { method: 'DELETE' });
    } catch (e) { log.error('delete-student:', e.message); return { ok: false, error: e.message }; }
  });

  // ===== Quizzes — delegate to SQLite via HTTP API =====

  ipcMain.handle('load-quizzes', async () => {
    try { return await serverFetch('/api/quizzes'); }
    catch (e) { log.error('load-quizzes:', e.message); return []; }
  });

  ipcMain.handle('save-quizzes', async () => {
    // Quizzes are now managed directly via REST endpoints; bulk-save is a no-op.
    return { ok: true };
  });

  ipcMain.handle('delete-quiz', async (_e, quizId) => {
    try {
      if (!quizId) return { ok: false, error: 'Missing quiz id' };
      return await serverFetch(`/api/quizzes/${quizId}`, { method: 'DELETE' });
    } catch (e) { log.error('delete-quiz:', e.message); return { ok: false, error: e.message }; }
  });

  // Create a new quiz
  ipcMain.handle('create-quiz', async (_e, quiz) => {
    try {
      if (!quiz) return { ok: false };
      return await serverFetch('/api/quizzes', { method: 'POST', body: JSON.stringify(quiz) });
    } catch (e) { log.error('create-quiz:', e.message); return { ok: false, error: e.message }; }
  });

  // Update quiz metadata (name, groupId, status, etc.)
  ipcMain.handle('update-quiz', async (_e, quizId, updates) => {
    try {
      if (!quizId) return { ok: false };
      return await serverFetch(`/api/quizzes/${quizId}`, { method: 'PUT', body: JSON.stringify(updates) });
    } catch (e) { log.error('update-quiz:', e.message); return { ok: false, error: e.message }; }
  });

  // Load a single quiz with its full questions list
  ipcMain.handle('load-quiz', async (_e, quizId) => {
    try {
      if (!quizId) return null;
      return await serverFetch(`/api/quizzes/${quizId}`);
    } catch (e) { log.error('load-quiz:', e.message); return null; }
  });

  // Save a single question (create if new uid, update if existing UUID)
  ipcMain.handle('save-question', async (_e, quizId, question) => {
    try {
      if (!quizId || !question) return { ok: false };
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(question.id || '');
      if (isUUID) {
        return await serverFetch(`/api/questions/${question.id}`, {
          method: 'PUT',
          body: JSON.stringify(question)
        });
      } else {
        return await serverFetch(`/api/quizzes/${quizId}/questions`, {
          method: 'POST',
          body: JSON.stringify(question)
        });
      }
    } catch (e) { log.error('save-question:', e.message); return { ok: false, error: e.message }; }
  });

  // Delete a single question
  ipcMain.handle('delete-question', async (_e, questionId) => {
    try {
      if (!questionId) return { ok: false };
      return await serverFetch(`/api/questions/${questionId}`, { method: 'DELETE' });
    } catch (e) { log.error('delete-question:', e.message); return { ok: false }; }
  });

  ipcMain.handle('load-quiz-submissions', async (_e, quizId) => {
    try {
      const url = quizId ? `/api/quizzes/${quizId}/results` : '/results';
      return await serverFetch(url);
    }
    catch (e) { log.error('load-quiz-submissions:', e.message); return []; }
  });

  ipcMain.handle('save-quiz-submissions', async () => {
    // Submissions are written directly to SQLite via /api/submit-answers; no-op here.
    return { ok: true };
  });

  ipcMain.handle('clear-quiz-results', async (_e, quizId) => {
    try { return await serverFetch(`/api/quizzes/${quizId}/results`, { method: 'DELETE' }); }
    catch (e) { log.error('clear-quiz-results:', e.message); return { ok: false }; }
  });

  ipcMain.handle('import-questions', async (_e, quizId, questions) => {
    try {
      return await serverFetch(`/api/quizzes/${quizId}/questions/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(questions)
      });
    } catch (e) {
      log.error('import-questions:', e.message);
      return { ok: false, message: e.message };
    }
  });

  // Excel file operations
  ipcMain.handle('open-game-url', async (_e, { url, title }) => {
    const win = new BrowserWindow({
      width: 1100, height: 700,
      title: title || 'لعبة تعليمية',
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    win.loadURL(url);
    win.setMenuBarVisibility(false);
    return { ok: true };
  });

  ipcMain.handle('select-backup-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'اختر ملف النسخة الاحتياطية',
      filters: [
        { name: 'Active Class Backup', extensions: ['acbak'] },
        { name: 'Legacy Backup', extensions: ['db'] },
      ],
      properties: ['openFile']
    });
    if (result.canceled) return { canceled: true };
    return { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.handle('select-backup-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'اختر مجلد النسخ الاحتياطي التلقائي',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  });

  // Auto-backup config helper (implementation of doBackup/cleanupOldBackups/
  // notifyBackupFailure lives at module scope below, shared with the
  // top-level before-quit handler).
  const AUTO_BACKUP_CFG_FILE = () => path.join(app.getPath('userData'), 'ac_auto_backup.json');
  function readAutoBackupCfg() {
    try { return JSON.parse(fs.readFileSync(AUTO_BACKUP_CFG_FILE(), 'utf8')); } catch { return null; }
  }

  let _autoBackupTimer = null;
  ipcMain.on('set-auto-backup', (_e, cfg) => {
    if (_autoBackupTimer) { clearInterval(_autoBackupTimer); _autoBackupTimer = null; }

    // Persist to disk so before-quit can read it without needing IPC
    try { fs.writeFileSync(AUTO_BACKUP_CFG_FILE(), JSON.stringify(cfg, null, 2), 'utf8'); } catch {}

    if (cfg.periodic && cfg.folder && cfg.interval > 0) {
      _autoBackupTimer = setInterval(() => {
        try { log.info(`[AutoBackup] Periodic → ${doBackup(cfg.folder)}`); }
        catch (e) { notifyBackupFailure('النسخ الدوري', e.message); }
      }, cfg.interval * 60 * 1000);
    }
  });

  ipcMain.handle('select-excel-file', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'اختر ملف Excel',
        filters: [
          { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
        ],
        properties: ['openFile']
      });
      
      if (result.canceled) {
        return { canceled: true };
      }
      
      return { 
        canceled: false, 
        filePath: result.filePaths[0] 
      };
    } catch (error) {
      log.error('Error selecting Excel file:', error);
      return { canceled: true, error: error.message };
    }
  });

  ipcMain.handle('get-excel-columns', async (_e, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, error: 'ملف غير موجود' };
      }
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) return { ok: false, error: 'لا يوجد ورقة عمل في الملف' };

      const range = XLSX.utils.decode_range(worksheet['!ref']);
      const headers = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c });
        const cell = worksheet[cellAddress];
        headers.push(cell ? String(cell.v) : `Column ${c + 1}`);
      }
      return { ok: true, columns: headers };
    } catch (error) {
      log.error('Error getting Excel columns:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('preview-excel-data', async (_e, options) => {
    try {
      const { file, nameCol, genderCol } = options || {};
      if (!file || !fs.existsSync(file)) {
        return { ok: false, error: 'ملف غير موجود' };
      }
      const workbook = XLSX.readFile(file);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) return { ok: false, error: 'لا يوجد ورقة عمل في الملف' };

      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      if (!rows || rows.length === 0) {
        return { ok: true, data: [], stats: { total: 0, valid: 0, invalid: 0 } };
      }

      // Helper: normalize gender
      const normalizeGenderValue = (input) => {
        const val = (input || '').toString().trim().toLowerCase();
        if (!val) return '';
        const malePatterns = [/^m(ale)?\b/, /^(ذكر)\b/, /^(ولد)\b/, /^(boy)\b/];
        const femalePatterns = [/^f(emale)?\b/, /^(أنثى|انثى)\b/, /^(بنت)\b/, /^(girl)\b/];
        if (malePatterns.some(rx => rx.test(val))) return 'male';
        if (femalePatterns.some(rx => rx.test(val))) return 'female';
        return '';
      };

      const startRow = 1; // skip header row
      const result = [];
      let valid = 0;
      let invalid = 0;

      for (let i = startRow; i < rows.length; i++) {
        const row = rows[i] || [];
        const name = row[nameCol] ? String(row[nameCol]).trim() : '';
        const genderRaw = (typeof genderCol === 'number' && row[genderCol]) ? String(row[genderCol]).trim() : '';
        const genderNorm = genderRaw ? normalizeGenderValue(genderRaw) : '';

        const isValid = name.length > 0;
        if (isValid) valid++; else invalid++;

        result.push({
          rowIndex: i,
          name,
          gender: genderNorm || null,
          valid: isValid
        });
      }

      return {
        ok: true,
        data: result,
        stats: { total: rows.length - 1, valid, invalid }
      };
    } catch (error) {
      log.error('Error previewing Excel data:', error);
      return { ok: false, error: error.message };
    }
  });

  // Export students to Excel (Electron)
  ipcMain.handle('export-students', async (_e, payload) => {
    try {
      const { groupName, students } = payload || {};
      if (!Array.isArray(students) || students.length === 0) {
        return { ok: false, error: 'لا يوجد طلاب للتصدير' };
      }

      const header = ['كود الطالب', 'الاسم', 'الصورة', 'النوع', 'التاريخ (ميلادي)'];
      const rows = students.map((s) => [
        s.code || '',
        s.name || '',
        s.photo ? 'نعم' : 'لا',
        s.gender === 'male' ? 'ذكر' : s.gender === 'female' ? 'أنثى' : '',
        s.attendanceDate ? new Date(s.attendanceDate).toLocaleDateString('ar-EG') : ''
      ]);

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
      worksheet['!cols'] = [
        { width: 16 },
        { width: 25 },
        { width: 8 },
        { width: 12 },
        { width: 14 }
      ];
      XLSX.utils.book_append_sheet(workbook, worksheet, 'الطلاب');

      const defaultFileName = `طلاب-${groupName || 'مجموعة'}-${new Date().toLocaleDateString('ar-EG').replace(/\//g, '-')}.xlsx`;
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'حفظ ملف الطلاب',
        defaultPath: path.join(app.getPath('documents'), defaultFileName),
        filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }]
      });

      if (canceled || !filePath) {
        return { ok: false, canceled: true };
      }

      XLSX.writeFile(workbook, filePath);
      return { ok: true, filePath };
    } catch (error) {
      log.error('Error exporting students:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('get-api-key', () => SERVER_API_KEY);

  // ── Screen sources for full-screen whiteboard recording ────────────────
  ipcMain.handle('get-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 200, height: 120 } });
    return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });

  // Resolves the capture-source id for this app's own window only — used so
  // "record screen" grabs the app (toolbar included) without showing the
  // teacher a picker full of unrelated desktop windows.
  ipcMain.handle('get-own-window-source', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    if (typeof win.getMediaSourceId === 'function') {
      try { return { id: win.getMediaSourceId() }; } catch { /* fall through to matching below */ }
    }
    const title = win.getTitle();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
    const match = sources.find(s => s.name === title);
    return match ? { id: match.id } : null;
  });

  // ── License IPC Handlers ───────────────────────────────────────────────
  ipcMain.handle('get-machine-id', () => getMachineId());

  ipcMain.handle('activate-license', async (_e, key, machineId, name, phone) => {
    if (!key) return { ok: false, message: 'مفتاح غير صحيح' };

    const mid = machineId || getMachineId();

    // Verify against local server (which stores all licenses in data/licenses.json)
    const serverResult = await verifyWithServer(key, mid);

    if (serverResult) {
      if (!serverResult.ok) return serverResult;
      // Cache result locally so the app can work offline for up to 7 days
      writeLicenseFile({ ...serverResult, key, machineId: mid, name: serverResult.name || name || '', phone: serverResult.phone || phone || '', activatedAt: new Date().toISOString(), cachedAt: new Date().toISOString() });
      return serverResult;
    }

    return { ok: false, message: 'تعذّر الاتصال بسيرفر التراخيص — تأكد من تشغيل البرنامج على الجهاز الرئيسي' };
  });

  ipcMain.handle('verify-license', async (_e, key, machineId) => {
    const serverResult = await verifyWithServer(key, machineId || getMachineId());
    return serverResult || { ok: true, offline: true }; // trust local if offline
  });

  ipcMain.handle('logout-license', () => {
    try { fs.unlinkSync(LICENSE_FILE()); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL('http://localhost:5000/pages/activation.html');
    }
  });

  ipcMain.handle('license-verified', () => {
    // Renderer confirmed license — load the main app
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL('http://localhost:5000');
    }
  });

  ipcMain.handle('get-license-status', () => {
    const lic = readLicenseFile();
    if (!lic) return { valid: false, licensed: false };
    if (!isLicenseValid(lic)) return { valid: false, licensed: false, expired: true, expiresAt: lic.expiresAt };
    const daysLeft = Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000);
    return { valid: true, licensed: true, name: lic.name || '', plan: lic.plan, expiresAt: lic.expiresAt, issuedAt: lic.issuedAt, daysLeft, totalDays: lic.totalDays || 365, key: lic.key, phone: lic.phone, machineId: lic.machineId };
  });

  ipcMain.handle('refresh-license', async () => {
    const lic = readLicenseFile();
    if (!lic || !lic.key || !lic.machineId) return { valid: false, licensed: false };
    try {
      const result = await verifyWithServer(lic.key, lic.machineId);
      if (result && result.ok === false) {
        try { fs.unlinkSync(LICENSE_FILE()); } catch {}
        return { valid: false, licensed: false, revoked: true };
      }
      if (result && result.ok) {
        const updated = { ...lic, ...result, key: lic.key, machineId: lic.machineId, cachedAt: new Date().toISOString() };
        writeLicenseFile(updated);
        const daysLeft = Math.ceil((new Date(updated.expiresAt) - new Date()) / 86400000);
        return { valid: true, licensed: true, name: updated.name, plan: updated.plan, expiresAt: updated.expiresAt, issuedAt: updated.issuedAt, daysLeft, totalDays: updated.totalDays || 365, key: updated.key, phone: updated.phone, machineId: updated.machineId };
      }
    } catch {}
    // Offline — return cached data
    const daysLeft = Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000);
    return { valid: true, licensed: true, name: lic.name, plan: lic.plan, expiresAt: lic.expiresAt, issuedAt: lic.issuedAt, daysLeft, totalDays: lic.totalDays || 365, key: lic.key, phone: lic.phone, machineId: lic.machineId, offline: true };
  });

  // ── Trial IPC ────────────────────────────────────────────────────────────
  ipcMain.handle('start-trial', async (_e, name, phone) => {
    const existing = readTrialFile();
    if (existing) {
      if (!isTrialValid(existing)) {
        // A naturally-expired trial stays blocked (expected behavior). But if
        // this machine was cut off by an admin and has since been restored
        // from the admin panel, let it start a fresh trial instead of being
        // stuck forever on a local file that predates the restore. Likewise,
        // if the admin has explicitly granted this machine a remote reset
        // (see /api/trial-log/:machineId/reset — for a trial that simply ran
        // out naturally, not a revocation), consume that one-shot grant and
        // let it through too.
        let allowFresh = false;
        try {
          const mid = getMachineId();
          const r = await fetch(`http://localhost:${SERVER_PORT}/api/trial-status?machineId=${encodeURIComponent(mid)}`,
            { signal: AbortSignal.timeout(5000) });
          const data = await r.json();
          if (existing.revokedByAdmin) {
            allowFresh = !data.revoked;
          } else {
            allowFresh = !!data.resetAvailable;
          }
          if (allowFresh && data.resetAvailable) {
            try {
              await fetch(`http://localhost:${SERVER_PORT}/api/trial-log/${encodeURIComponent(mid)}/reset-consume`,
                { method: 'POST', signal: AbortSignal.timeout(5000) });
            } catch {}
          }
        } catch {
          allowFresh = false; // can't confirm reset/restore while offline
        }
        if (!allowFresh) return { ok: false, message: 'trial_expired' };
        // fall through and issue a new trial period
      } else {
        // Trial already started and still valid — just navigate to the app
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL('http://localhost:5000');
        return { ok: true, message: 'already_started' };
      }
    }

    // Read config from server (may have been updated via admin panel)
    let cfg = { daysLimit: TRIAL_DAYS, ...TRIAL_LIMITS };
    try {
      const r = await fetch(`http://localhost:${SERVER_PORT}/api/trial-config`);
      if (r.ok) cfg = { ...cfg, ...await r.json() };
    } catch {}

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (cfg.daysLimit || TRIAL_DAYS));
    const trialData = {
      startedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      daysLimit: cfg.daysLimit || TRIAL_DAYS,
      limits: cfg,
    };
    writeTrialFile(trialData);

    // Log this activation — try local first, then remote (for admin stats)
    const logBody = JSON.stringify({ machineId: getMachineId(), name: name || '', phone: phone || '' });
    const logHeaders = { 'Content-Type': 'application/json' };
    try { await fetch(`http://localhost:${SERVER_PORT}/api/trial-log`, { method: 'POST', headers: logHeaders, body: logBody }); } catch {}

    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL('http://localhost:5000');
    return { ok: true };
  });

  ipcMain.handle('get-trial-status', async () => {
    // If user has a valid full license, never show trial restrictions
    const lic = readLicenseFile();
    if (lic && isLicenseValid(lic)) return { trial: false };

    const t = readTrialFile();
    if (!t) return { trial: false };

    // Merge saved limits with latest config (admin may have updated limits)
    let limits = t.limits || TRIAL_LIMITS;
    try {
      const r = await fetch(`http://localhost:${SERVER_PORT}/api/trial-config`);
      if (r.ok) limits = { ...limits, ...await r.json() };
    } catch {}

    const daysLeft = Math.max(0, Math.ceil((new Date(t.expiresAt) - new Date()) / 86400000));
    return { trial: true, daysLeft, daysLimit: t.daysLimit || TRIAL_DAYS, expiresAt: t.expiresAt, expired: daysLeft <= 0, limits };
  });
  // ──────────────────────────────────────────────────────────────────────────

  // ── Auto-Update Handlers ────────────────────────────────────────────────
  const https = require('https');
  const { shell } = require('electron');

  // Compare semantic versions: returns 1 if a > b, -1 if a < b, 0 if equal
  // ── electron-updater (packaged only) ─────────────────────────────────────
  ipcMain.handle('get-app-version', () => app.getVersion());

  if (app.isPackaged) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload         = false;
    autoUpdater.autoInstallOnAppQuit = false;

    const sendUpdateMsg = (event, data = {}) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('update-message', { event, ...data });
    };

    autoUpdater.on('checking-for-update',  ()     => sendUpdateMsg('checking'));
    autoUpdater.on('update-not-available', (info) => sendUpdateMsg('up-to-date', { version: info.version }));
    autoUpdater.on('error', (err) => {
      // 404 on latest.yml means no release file published yet — treat as "up to date"
      if (err.message && (err.message.includes('latest.yml') || err.message.includes('404'))) {
        sendUpdateMsg('up-to-date', { version: app.getVersion() });
      } else {
        sendUpdateMsg('error', { message: err.message });
      }
    });
    autoUpdater.on('update-available',     (info) => sendUpdateMsg('available',  { version: info.version }));
    autoUpdater.on('download-progress',    (prog) => sendUpdateMsg('progress',   { percent: Math.round(prog.percent) }));
    autoUpdater.on('update-downloaded',    ()     => sendUpdateMsg('downloaded'));

    ipcMain.handle('check-for-updates', () => { autoUpdater.checkForUpdates(); return {}; });
    ipcMain.handle('download-update',   () => autoUpdater.downloadUpdate());
    ipcMain.handle('install-update',    () => autoUpdater.quitAndInstall(false, true));

    // Auto-check shortly after startup instead of only when the teacher
    // manually opens Settings ← About and clicks "check for updates" — the
    // 'update-available' event this triggers is what shows the header
    // badge + toast (see settings.js _showUpdateAvailableNotice), so this
    // is what actually makes the notification "just happen" on its own.
    setTimeout(() => {
      try { autoUpdater.checkForUpdates(); } catch (e) { log.warn('Startup update check failed:', e.message); }
    }, 8000);
  } else {
    // Development stubs — prevent "no handler" errors in renderer
    ipcMain.handle('check-for-updates', () => ({ devMode: true }));
    ipcMain.handle('download-update',   () => {});
    ipcMain.handle('install-update',    () => {});
  }
  // ── End electron-updater ──────────────────────────────────────────────────

  // Million Game IPC Handlers
  const dataDir = path.join(app.getPath('userData'), 'classroom-data');
  function ensureDataDir() {
    try { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); } catch {}
  }
  const millionSessionsFile = path.join(dataDir, 'million-sessions.json');
  
  function loadMillionSessions() {
    try {
      ensureDataDir();
      if (fs.existsSync(millionSessionsFile)) {
        const data = fs.readFileSync(millionSessionsFile, 'utf8');
        return JSON.parse(data);
      }
      return {};
    } catch (error) {
      log.error('Error loading million sessions:', error);
      return {};
    }
  }

  function saveMillionSessions(sessions) {
    try {
      ensureDataDir();
      fs.writeFileSync(millionSessionsFile, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (error) {
      log.error('Error saving million sessions:', error);
    }
  }

  function getMillionChoices(question) {
    if (Array.isArray(question?.choices) && question.choices.length) {
      return question.choices;
    }
    if (Array.isArray(question?.options) && question.options.length) {
      return question.options;
    }
    if (Array.isArray(question?.answers) && question.answers.length) {
      return question.answers;
    }
    return [];
  }

  function getMillionCorrectIndex(question) {
    const candidates = [
      question?.correctAnswer,
      question?.correct,
      question?.answerIndex,
      question?.answer
    ];

    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined) {
        continue;
      }
      const value = typeof candidate === 'string' ? Number(candidate) : candidate;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value);
      }
    }
    return null;
  }

  function transformMillionQuestion(question) {
    if (!question) {
      return null;
    }

    const text = (question.text || question.question || question.prompt || '').toString().trim();
    if (!text) {
      return null;
    }

    const choicesWithIndex = getMillionChoices(question)
      .map((choice, index) => ({
        originalIndex: index,
        value: choice === null || choice === undefined ? '' : String(choice).trim()
      }))
      .filter(choice => choice.value.length > 0);

    if (choicesWithIndex.length < 4) {
      return null;
    }

    const correctIndexValue = getMillionCorrectIndex(question);
    if (correctIndexValue === null) {
      return null;
    }

    const correctChoiceIndex = choicesWithIndex.findIndex(choice => choice.originalIndex === correctIndexValue);
    if (correctChoiceIndex === -1) {
      return null;
    }

    let finalChoices = choicesWithIndex.slice(0, 4);
    let finalCorrectIndex = correctChoiceIndex;

    if (finalCorrectIndex >= finalChoices.length) {
      finalChoices[finalChoices.length - 1] = choicesWithIndex[correctChoiceIndex];
      finalCorrectIndex = finalChoices.length - 1;
    }

    return {
      id: question.id,
      text,
      question: text,
      choices: finalChoices.map(choice => choice.value),
      correct: finalCorrectIndex,
      difficulty: question.difficulty || 'medium'
    };
  }

  ipcMain.handle('million:createSession', async (_e, settings) => {
    try {
      const crypto = require('crypto');
      const sessionId = crypto.randomUUID();
      const sessions = loadMillionSessions();

      const sourceType = settings.sourceType;
      let questions = [];

      if (sourceType === 'quiz') {
        let quiz = null;
        try { quiz = await serverFetch(`/api/quizzes/${settings.quizId}`); } catch (e) { log.error('million:createSession fetch quiz:', e.message); }

        if (!quiz || !Array.isArray(quiz.questions)) {
          return { ok: false, error: 'الاختبار غير موجود أو لا يحتوي على أسئلة' };
        }

        questions = quiz.questions
          .map(transformMillionQuestion)
          .filter(Boolean);
      } else if (sourceType === 'manual') {
        // Load quizzes from SQLite via HTTP
        let allQuizzes = [];
        try {
          allQuizzes = await serverFetch('/api/quizzes');
          // Fetch full question data for each quiz
          allQuizzes = await Promise.all(allQuizzes.map(q => serverFetch(`/api/quizzes/${q.id}`)));
        } catch (e) { log.error('million:createSession fetch quizzes:', e.message); }

        const selectedQuestionIds = settings.selectedQuestionIds || [];

        allQuizzes.forEach(quiz => {
          if (Array.isArray(quiz.questions)) {
            quiz.questions.forEach((q) => {
              // Fix: filter by question id, not array index
              if (selectedQuestionIds.includes(q.id)) {
                const transformed = transformMillionQuestion(q);
                if (transformed) questions.push(transformed);
              }
            });
          }
        });
      }

      if (questions.length < 15) {
        return { ok: false, error: `عدد الأسئلة ${questions.length} أقل من المطلوب (15)` };
      }

      const distribution = settings.difficultyDistribution || { easy: 5, medium: 5, hard: 5 };
      const selectedQuestions = [];

      const easyQuestions = shuffleInPlace(questions.filter(q => q.difficulty === 'easy'));
      const mediumQuestions = shuffleInPlace(questions.filter(q => q.difficulty === 'medium'));
      const hardQuestions = shuffleInPlace(questions.filter(q => q.difficulty === 'hard'));

      selectedQuestions.push(...easyQuestions.slice(0, Math.min(distribution.easy, easyQuestions.length)));
      selectedQuestions.push(...mediumQuestions.slice(0, Math.min(distribution.medium, mediumQuestions.length)));
      selectedQuestions.push(...hardQuestions.slice(0, Math.min(distribution.hard, hardQuestions.length)));

      if (selectedQuestions.length < 15) {
        const allQuestions = [...easyQuestions, ...mediumQuestions, ...hardQuestions].filter(
          q => !selectedQuestions.some(sq => sq.id === q.id)
        );
        selectedQuestions.push(...allQuestions.slice(0, 15 - selectedQuestions.length));
      }

      if (selectedQuestions.length < 15) {
        return { ok: false, error: `عدد الأسئلة المتاحة ${selectedQuestions.length} أقل من المطلوب (15)` };
      }

      selectedQuestions.splice(15);

      if (settings.ordering === 'random') {
        shuffleInPlace(selectedQuestions);
      }

      const session = {
        id: sessionId,
        createdAt: new Date().toISOString(),
        settings,
        questions: selectedQuestions.map((q, idx) => ({
          ...q,
          level: idx + 1
        })),
        lifelines: settings.lifelines
      };

      sessions[sessionId] = session;
      saveMillionSessions(sessions);

      return { ok: true, sessionId };
    } catch (error) {
      log.error('Error creating million session:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('million:getSession', async (_e, sessionId) => {
    try {
      const sessions = loadMillionSessions();
      const session = sessions[sessionId];

      if (!session) {
        return { ok: false, error: 'الجلسة غير موجودة' };
      }

      return { ok: true, session };
    } catch (error) {
      log.error('Error getting million session:', error);
      return { ok: false, error: error.message };
    }
  });

  await startServer();

  // Backfill trial log for trials activated before logging was added
  const _existingTrial = readTrialFile();
  if (_existingTrial && isTrialValid(_existingTrial)) {
    try {
      const _dataDir = process.env.APP_DATA_DIR || path.join(__dirname, 'data');
      const _logPath = path.join(_dataDir, 'trial-log.json');
      let _log = [];
      try { _log = JSON.parse(fs.readFileSync(_logPath, 'utf8')); } catch {}
      const _mid = getMachineId();
      if (!_log.some(e => e.machineId === _mid)) {
        _log.push({ activatedAt: _existingTrial.startedAt || new Date().toISOString(), machineId: _mid, backfilled: true });
        fs.mkdirSync(_dataDir, { recursive: true });
        fs.writeFileSync(_logPath, JSON.stringify(_log, null, 2), 'utf8');
      }
    } catch {}
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'ac_auto_backup.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!cfg?.onClose || !cfg?.folder) return;
    const dest = doBackup(cfg.folder);
    log.info(`[AutoBackup] On-close backup saved → ${dest}`);
  } catch (e) {
    if (e.code !== 'ENOENT') notifyBackupFailure('نسخة الإغلاق', e.message);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});