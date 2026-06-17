// Simple Electron main process
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const XLSX = require('xlsx');
const crypto = require('crypto');
const log = require('./server/logger').create('main');

let mainWindow;
let numbersWindow;
let wheelWindow;
let serverProcess;
// Keep references to tool windows to prevent GC from closing them
const toolWindows = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webSecurity: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set CSP header
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:* https://cdnjs.cloudflare.com; media-src 'self' data: blob:;"
        ]
      }
    });
  });

  // Ensure tool windows close when main window closes
  try {
    mainWindow.on('close', () => {
      for (const [key, win] of toolWindows.entries()) {
        try { if (win && !win.isDestroyed()) win.close(); } catch {}
      }
      toolWindows.clear();
    });
  } catch {}

  // Load the app (retry if server isn't ready yet)
  const APP_URL = 'http://localhost:5000';
  mainWindow.loadURL(APP_URL);

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
    alwaysOnTop: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webSecurity: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Optional CSP for numbers window (same as main)
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:* https://cdnjs.cloudflare.com; media-src 'self' data: blob:;"
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
    alwaysOnTop: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webSecurity: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set CSP header for wheel window
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:* https://cdnjs.cloudflare.com; media-src 'self' data: blob:;"
        ]
      }
    });
  });

  // Load via server to ensure absolute paths work
  win.loadURL('http://localhost:5000/pages/wheel-standalone.html');

  win.on('closed', () => { toolWindows.delete('wheel'); });
  toolWindows.set('wheel', win);
  return win;
}

const SERVER_API_KEY = crypto.randomBytes(16).toString('hex');

function startServer() {
  return new Promise((resolve, reject) => {
    const userDataPath = app.getPath('userData');
    serverProcess = spawn('node', ['server/server.js'], {
      cwd: __dirname,
      stdio: 'pipe',
      env: {
        ...process.env,
        APP_DATA_DIR: path.join(userDataPath, 'classroom-data'),
        SERVER_API_KEY: SERVER_API_KEY
      }
    });

    serverProcess.stdout.on('data', (data) => {
      log.info(`Server: ${data}`);
      if (data.toString().includes('Active Class server running at http://localhost:5000')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      log.error(`Server Error: ${data}`);
    });

    serverProcess.on('close', (code) => {
      log.info(`Server process exited with code ${code}`);
    });

    // Fallback timeout (give server a bit more time to bind)
    setTimeout(resolve, 5000);
  });
}

app.whenReady().then(async () => {
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
          backgroundColor: '#00000000',
          webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
        });
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:* https://cdnjs.cloudflare.com; media-src 'self' data: blob:;"
          ]}});
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
          backgroundColor: '#00000000',
          webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
        });
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:* https://cdnjs.cloudflare.com; media-src 'self' data: blob:;"
          ]}});
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

  // Data persistence for groups and students
  const dataDir = path.join(app.getPath('userData'), 'classroom-data');
  const groupsFile = path.join(dataDir, 'groups.json');
  const studentsFile = path.join(dataDir, 'students.json');
  const quizzesFile = path.join(dataDir, 'quizzes.json');
  const quizSubmissionsFile = path.join(dataDir, 'quiz-submissions.json');

  function ensureDataDir() {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    } catch {}
  }

  ipcMain.handle('load-groups', async () => {
    try {
      ensureDataDir();
      if (fs.existsSync(groupsFile)) {
        const data = fs.readFileSync(groupsFile, 'utf8');
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      log.error('Error loading groups:', error);
      return [];
    }
  });

  ipcMain.handle('save-groups', async (_e, groups) => {
    try {
      ensureDataDir();
      fs.writeFileSync(groupsFile, JSON.stringify(groups, null, 2), 'utf8');
      return { ok: true };
    } catch (error) {
      log.error('Error saving groups:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('load-students', async () => {
    try {
      ensureDataDir();
      if (fs.existsSync(studentsFile)) {
        const data = fs.readFileSync(studentsFile, 'utf8');
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      log.error('Error loading students:', error);
      return [];
    }
  });

  ipcMain.handle('save-students', async (_e, students) => {
    try {
      ensureDataDir();
      fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2), 'utf8');
      return { ok: true };
    } catch (error) {
      log.error('Error saving students:', error);
      return { ok: false, error: error.message };
    }
  });

  // ===== Quizzes IPC Handlers =====
  ipcMain.handle('load-quizzes', async () => {
    try {
      ensureDataDir();
      if (fs.existsSync(quizzesFile)) {
        const data = fs.readFileSync(quizzesFile, 'utf8');
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      log.error('Error loading quizzes:', error);
      return [];
    }
  });

  ipcMain.handle('save-quizzes', async (_e, quizzes) => {
    try {
      ensureDataDir();
      fs.writeFileSync(quizzesFile, JSON.stringify(quizzes, null, 2), 'utf8');
      return { ok: true };
    } catch (error) {
      log.error('Error saving quizzes:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('delete-quiz', async (_e, quizId) => {
    try {
      ensureDataDir();
      const existing = fs.existsSync(quizzesFile) ? JSON.parse(fs.readFileSync(quizzesFile, 'utf8')) : [];
      const filtered = Array.isArray(existing) ? existing.filter(q => q.id !== quizId) : [];
      fs.writeFileSync(quizzesFile, JSON.stringify(filtered, null, 2), 'utf8');
      return { ok: true };
    } catch (error) {
      log.error('Error deleting quiz:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('load-quiz-submissions', async () => {
    try {
      ensureDataDir();
      if (fs.existsSync(quizSubmissionsFile)) {
        const data = fs.readFileSync(quizSubmissionsFile, 'utf8');
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      log.error('Error loading quiz submissions:', error);
      return [];
    }
  });

  ipcMain.handle('save-quiz-submissions', async (_e, submissions) => {
    try {
      ensureDataDir();
      fs.writeFileSync(quizSubmissionsFile, JSON.stringify(submissions, null, 2), 'utf8');
      return { ok: true };
    } catch (error) {
      log.error('Error saving quiz submissions:', error);
      return { ok: false, error: error.message };
    }
  });

  // Excel file operations
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

  // Million Game IPC Handlers
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
        const allQuizzes = fs.existsSync(quizzesFile) ? JSON.parse(fs.readFileSync(quizzesFile, 'utf8')) : [];
        const quiz = allQuizzes.find(q => q.id === settings.quizId);
        
        if (!quiz || !Array.isArray(quiz.questions)) {
          return { ok: false, error: 'الاختبار غير موجود أو لا يحتوي على أسئلة' };
        }

        questions = quiz.questions
          .map(transformMillionQuestion)
          .filter(Boolean);
      } else if (sourceType === 'manual') {
        const allQuizzes = fs.existsSync(quizzesFile) ? JSON.parse(fs.readFileSync(quizzesFile, 'utf8')) : [];
        const selectedQuestionIds = settings.selectedQuestionIds || [];
        
        allQuizzes.forEach(quiz => {
          if (Array.isArray(quiz.questions)) {
            quiz.questions.forEach((q, idx) => {
              if (selectedQuestionIds.includes(idx)) {
                const transformed = transformMillionQuestion(q);
                if (transformed) {
                  questions.push(transformed);
                }
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

      const easyQuestions = questions.filter(q => q.difficulty === 'easy').sort(() => Math.random() - 0.5);
      const mediumQuestions = questions.filter(q => q.difficulty === 'medium').sort(() => Math.random() - 0.5);
      const hardQuestions = questions.filter(q => q.difficulty === 'hard').sort(() => Math.random() - 0.5);

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
        selectedQuestions.sort(() => Math.random() - 0.5);
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

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});