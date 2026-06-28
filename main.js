// Simple Electron main process
const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const XLSX = require('xlsx');
const crypto = require('crypto');
const log = require('./server/logger').create('main');

// ── License helpers ────────────────────────────────────────────────────────
const LICENSE_FILE = () => path.join(app.getPath('userData'), 'ac_license.json');

// ── Trial helpers ──────────────────────────────────────────────────────────
const TRIAL_DAYS   = 7;
const TRIAL_FILE   = () => path.join(app.getPath('userData'), 'ac_trial.json');
const TRIAL_LIMITS = { maxGroups: 1, maxStudents: 10, maxQuizzes: 2, allowedGames: 3, competitions: false, content: false };

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
// then falls back to local server (admin's machine).
const REMOTE_LICENSE_SERVER = 'https://twisting-energy-applied.ngrok-free.dev';

async function verifyWithServer(key, machineId) {
  // Try local server first (admin's machine), then remote (client's machine)
  const urls = [`http://localhost:${SERVER_PORT}`, REMOTE_LICENSE_SERVER];
  for (const base of urls) {
    try {
      const res = await fetch(`${base}/api/license/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, machineId }),
        signal: AbortSignal.timeout(6000)
      });
      const data = await res.json();
      if (data && (data.ok || data.ok === false)) return data; // valid server response
    } catch { /* try next */ }
  }
  return null; // all servers unreachable — caller uses local cache
}
// ──────────────────────────────────────────────────────────────────────────

// Single source of truth for the renderer Content-Security-Policy (was
// duplicated across every BrowserWindow). Update here only.
const CSP_VALUE = `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:* https://twisting-energy-applied.ngrok-free.dev https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://script.google.com https://script.googleusercontent.com; media-src 'self' data: blob:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://wordwall.net https://*.wordwall.net https://learningapps.org https://*.learningapps.org https://cokogames.com https://*.cokogames.com; worker-src 'self' blob: https://cdnjs.cloudflare.com;`;

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

function createWindow() {
  const { screen } = require('electron');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  // Scale up on large screens (interactive whiteboards etc.)
  let zoom = 1.0;
  if (sw >= 3840) zoom = 2.0;       // 4K
  else if (sw >= 2560) zoom = 1.5;  // 2K / QHD
  else if (sw >= 1920) zoom = 1.0;  // FHD

  const winW = Math.min(Math.round(sw * 0.92), 1600);
  const winH = Math.min(Math.round(sh * 0.92), 1000);

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
      preload: path.join(__dirname, 'preload.js')
    }
  });

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
  const startUrl = (isLicenseValid(lic) || isTrialValid(trial))
    ? APP_URL
    : `${APP_URL}/pages/activation.html`;
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

  // Poll every 30s: if trial file disappears while app is open, redirect to activation
  if (isTrialValid(trial)) {
    const trialWatcher = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) { clearInterval(trialWatcher); return; }
      const currentLic = readLicenseFile();
      if (isLicenseValid(currentLic)) { clearInterval(trialWatcher); return; } // got a real license
      const currentTrial = readTrialFile();
      if (!isTrialValid(currentTrial)) {
        clearInterval(trialWatcher);
        mainWindow.loadURL(`${APP_URL}/pages/activation.html`);
      }
    }, 30000);
  }

  // Block popup windows from embedded games; open external URLs in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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

function createNumbersWindow() {
  // Reuse single window instance
  const existing = toolWindows.get('numbers');
  if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return existing; }

  const win = new BrowserWindow({
    width: 418,
    height: 640,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
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

  win.loadURL('http://localhost:5000/pages/numbers-standalone.html');
  win.on('closed', () => { toolWindows.delete('numbers'); });
  toolWindows.set('numbers', win);
  return win;
}

function createWheelWindow() {
  const existing = toolWindows.get('wheel');
  if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return existing; }

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
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

  win.loadURL('http://localhost:5000/pages/wheel-standalone.html');

  win.on('closed', () => { toolWindows.delete('wheel'); });
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
          width: 418,
          height: 520,
          frame: false,
          transparent: true,
          resizable: true,
          alwaysOnTop: true,
          backgroundColor: '#00000000',
          webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          const h2 = {}; for (const [k,v] of Object.entries(details.responseHeaders)) { if (k.toLowerCase() !== 'content-security-policy') h2[k]=v; } callback({ responseHeaders: { ...h2, 'Content-Security-Policy': [CSP_VALUE] } });
        });
        win.loadURL('http://localhost:5000/pages/names.html');
        win.on('closed', () => { toolWindows.delete('names'); });
        toolWindows.set('names', win);
        return { ok: true };
      }
      if (toolName === 'timer') {
        const existing = toolWindows.get('timer');
        if (existing && !existing.isDestroyed()) { try { existing.focus(); } catch {} return { ok: true }; }
        const win = new BrowserWindow({
          width: 418,
          height: 520,
          frame: false,
          transparent: true,
          resizable: false,
          alwaysOnTop: true,
          backgroundColor: '#00000000',
          webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          const h2 = {}; for (const [k,v] of Object.entries(details.responseHeaders)) { if (k.toLowerCase() !== 'content-security-policy') h2[k]=v; } callback({ responseHeaders: { ...h2, 'Content-Security-Policy': [CSP_VALUE] } });
        });
        win.loadURL('http://localhost:5000/pages/timer-standalone.html');
        win.on('closed', () => { toolWindows.delete('timer'); });
        toolWindows.set('timer', win);
        return { ok: true };
      }
      if (toolName === 'numbers') {
        createNumbersWindow();
        return { ok: true };
      }
      if (toolName === 'wheel') {
        createWheelWindow();
        return { ok: true };
      }
      return { ok: false, error: 'Unknown tool' };
    } catch (err) {
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
  ipcMain.handle('set-always-on-top', async (event, flag) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) win.setAlwaysOnTop(!!flag, 'screen-saver');
    } catch {}
  });
  ipcMain.on('set-always-on-top', (event, flag) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) win.setAlwaysOnTop(!!flag, 'screen-saver');
    } catch {}
  });

  ipcMain.handle('toggle-fullscreen', async (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.setFullScreen(!win.isFullScreen()); } catch {}
  });
  ipcMain.on('toggle-fullscreen', (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.setFullScreen(!win.isFullScreen()); } catch {}
  });

  ipcMain.handle('focus-window', async (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) { win.show(); win.focus(); } } catch {}
  });
  ipcMain.on('focus-window', (event) => {
    try { const win = BrowserWindow.fromWebContents(event.sender); if (win) { win.show(); win.focus(); } } catch {}
  });

  ipcMain.handle('resize-window', async (event, payload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const { width, height } = payload || {};
      if (win && typeof width === 'number' && typeof height === 'number') {
        win.setSize(Math.max(320, Math.floor(width)), Math.max(300, Math.floor(height)), true);
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
        win.setSize(Math.max(320, Math.floor(width)), Math.max(300, Math.floor(height)), true);
      }
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

  // Auto-backup helpers
  const AUTO_BACKUP_CFG_FILE = () => path.join(app.getPath('userData'), 'ac_auto_backup.json');
  function readAutoBackupCfg() {
    try { return JSON.parse(fs.readFileSync(AUTO_BACKUP_CFG_FILE(), 'utf8')); } catch { return null; }
  }
  function makeBackupName() {
    const _n = new Date();
    return `activeclass_backup_${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}_${String(_n.getHours()).padStart(2,'0')}-${String(_n.getMinutes()).padStart(2,'0')}.db`;
  }
  function doBackup(folder) {
    const src  = path.join(app.getPath('userData'), 'activeclass.db');
    const dest = path.join(folder, makeBackupName());
    fs.copyFileSync(src, dest);
    return dest;
  }

  let _autoBackupTimer = null;
  ipcMain.on('set-auto-backup', (_e, cfg) => {
    if (_autoBackupTimer) { clearInterval(_autoBackupTimer); _autoBackupTimer = null; }

    // Persist to disk so before-quit can read it without needing IPC
    try { fs.writeFileSync(AUTO_BACKUP_CFG_FILE(), JSON.stringify(cfg, null, 2), 'utf8'); } catch {}

    if (cfg.periodic && cfg.folder && cfg.interval > 0) {
      _autoBackupTimer = setInterval(() => {
        try { log.info(`[AutoBackup] Periodic → ${doBackup(cfg.folder)}`); }
        catch (e) { log.warn(`[AutoBackup] Periodic failed: ${e.message}`); }
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
    return { valid: true, licensed: true, name: lic.name || '', plan: lic.plan, expiresAt: lic.expiresAt, daysLeft, totalDays: lic.totalDays || 365, key: lic.key, phone: lic.phone, machineId: lic.machineId };
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
        return { valid: true, licensed: true, name: updated.name, plan: updated.plan, expiresAt: updated.expiresAt, daysLeft, totalDays: updated.totalDays || 365, key: updated.key, phone: updated.phone, machineId: updated.machineId };
      }
    } catch {}
    // Offline — return cached data
    const daysLeft = Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000);
    return { valid: true, licensed: true, name: lic.name, plan: lic.plan, expiresAt: lic.expiresAt, daysLeft, totalDays: lic.totalDays || 365, key: lic.key, phone: lic.phone, machineId: lic.machineId, offline: true };
  });

  // ── Trial IPC ────────────────────────────────────────────────────────────
  ipcMain.handle('start-trial', async () => {
    const existing = readTrialFile();
    if (existing) {
      // Trial already started — just navigate to the app
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL('http://localhost:5000');
      return { ok: true, message: 'already_started' };
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
    const logBody = JSON.stringify({ machineId: getMachineId() });
    const logHeaders = { 'Content-Type': 'application/json' };
    try { await fetch(`http://localhost:${SERVER_PORT}/api/trial-log`, { method: 'POST', headers: logHeaders, body: logBody }); } catch {}
    try { await fetch(`${REMOTE_LICENSE_SERVER}/api/trial-log`, { method: 'POST', headers: logHeaders, body: logBody, signal: AbortSignal.timeout(5000) }); } catch {}

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
    const _n   = new Date();
    const name = `activeclass_backup_${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}_${String(_n.getHours()).padStart(2,'0')}-${String(_n.getMinutes()).padStart(2,'0')}.db`;
    const src  = path.join(app.getPath('userData'), 'activeclass.db');
    const dest = path.join(cfg.folder, name);
    fs.copyFileSync(src, dest);
    log.info(`[AutoBackup] On-close backup saved → ${dest}`);
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn(`[AutoBackup] On-close failed: ${e.message}`);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});