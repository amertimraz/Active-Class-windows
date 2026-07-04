// Preload script for Classroom Manager
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

// This preload also runs inside same-origin <iframe>s (nodeIntegrationInSubFrames
// is on, so the whiteboard embedded as a lesson-content slide gets window.api).
// Guard against exposing it to anything else — e.g. an arbitrary external site
// loaded via the "web link" content type — by only running for our own server.
const isTrustedFrame = location.origin === 'http://localhost:5000';

if (isTrustedFrame) {

contextBridge.exposeInMainWorld('electronPaths', {
  gamePreload: 'file://' + path.join(__dirname, 'public', 'preloads', 'game-preload.js').replace(/\\/g, '/'),
});

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // Excel file operations
  selectExcelFile: () => ipcRenderer.invoke('select-excel-file'),
  openGameUrl:        (opts) => ipcRenderer.invoke('open-game-url', opts),
  selectBackupFile:   () => ipcRenderer.invoke('select-backup-file'),
  selectBackupFolder: () => ipcRenderer.invoke('select-backup-folder'),
  setAutoBackup:      (cfg) => ipcRenderer.send('set-auto-backup', cfg),
  getExcelColumns: (filePath) => ipcRenderer.invoke('get-excel-columns', filePath),
  previewExcelData: (options) => ipcRenderer.invoke('preview-excel-data', options),
  
  // Data persistence operations
  loadGroups: () => ipcRenderer.invoke('load-groups'),
  saveGroups: (groups) => ipcRenderer.invoke('save-groups', groups),
  updateGroup: (group) => ipcRenderer.invoke('update-group', group),
  deleteGroup: (groupId) => ipcRenderer.invoke('delete-group', groupId),
  loadStudents: () => ipcRenderer.invoke('load-students'),
  saveStudents: (students) => ipcRenderer.invoke('save-students', students),

  // Individual student operations
  addStudent: (student) => ipcRenderer.invoke('add-student', student),
  updateStudent: (student) => ipcRenderer.invoke('update-student', student),
  deleteStudent: (studentId) => ipcRenderer.invoke('delete-student', studentId),
  
  // Export operations
  exportStudents: (data) => ipcRenderer.invoke('export-students', data),
  
  // Quiz operations
  loadQuizzes: () => ipcRenderer.invoke('load-quizzes'),
  saveQuizzes: (quizzes) => ipcRenderer.invoke('save-quizzes', quizzes),
  deleteQuiz: (quizId) => ipcRenderer.invoke('delete-quiz', quizId),
  createQuiz: (quiz) => ipcRenderer.invoke('create-quiz', quiz),
  updateQuiz: (quizId, updates) => ipcRenderer.invoke('update-quiz', quizId, updates),
  loadQuiz: (quizId) => ipcRenderer.invoke('load-quiz', quizId),
  saveQuestion: (quizId, question) => ipcRenderer.invoke('save-question', quizId, question),
  deleteQuestion: (questionId) => ipcRenderer.invoke('delete-question', questionId),
  
  // Quiz submissions operations
  loadQuizSubmissions: (quizId) => ipcRenderer.invoke('load-quiz-submissions', quizId),
  saveQuizSubmissions: (submissions) => ipcRenderer.invoke('save-quiz-submissions', submissions),
  clearQuizResults: (quizId) => ipcRenderer.invoke('clear-quiz-results', quizId),
  importQuestions: (quizId, questions) => ipcRenderer.invoke('import-questions', quizId, questions),

  // License operations
  getMachineId:     ()           => ipcRenderer.invoke('get-machine-id'),
  activateLicense:  (key, mid, name, phone) => ipcRenderer.invoke('activate-license', key, mid, name, phone),
  verifyLicense:    (key, mid)   => ipcRenderer.invoke('verify-license', key, mid),
  licenseVerified:  ()           => ipcRenderer.invoke('license-verified'),
  getLicenseStatus: ()           => ipcRenderer.invoke('get-license-status'),
  refreshLicense:   ()           => ipcRenderer.invoke('refresh-license'),
  logoutLicense:    ()           => ipcRenderer.invoke('logout-license'),

  // Window operations
  openToolWindow: (toolName) => ipcRenderer.invoke('open-tool-window', toolName),
  openNumbersWindow: () => ipcRenderer.invoke('open-numbers-window'),
  openWheelWindow: () => ipcRenderer.send('open-wheel-window'),

  // Names picker settings popover (separate small window)
  sendNamesSettingsUpdate: (data) => ipcRenderer.send('names-settings-update', data),
  onNamesSettingsUpdate: (cb) => ipcRenderer.on('names-settings-update', (_e, data) => cb(data)),
  closeNamesSettings: () => ipcRenderer.send('names-close-settings'),

  // Wheel settings popover (separate small window)
  sendWheelSettingsUpdate: (data) => ipcRenderer.send('wheel-settings-update', data),
  onWheelSettingsUpdate: (cb) => ipcRenderer.on('wheel-settings-update', (_e, data) => cb(data)),
  closeWheelSettings: () => ipcRenderer.send('wheel-close-settings'),
  sendWheelWinnerPicked: (data) => ipcRenderer.send('wheel-winner-picked', data),
  onWheelWinnerPicked: (cb) => ipcRenderer.on('wheel-winner-picked', (_e, data) => cb(data)),

  // Numbers generator settings popover (separate small window)
  sendNumbersSettingsUpdate: (data) => ipcRenderer.send('numbers-settings-update', data),
  onNumbersSettingsUpdate: (cb) => ipcRenderer.on('numbers-settings-update', (_e, data) => cb(data)),
  closeNumbersSettings: () => ipcRenderer.send('numbers-close-settings'),

  // Timer settings popover (separate small window)
  sendTimerSettingsUpdate: (data) => ipcRenderer.send('timer-settings-update', data),
  onTimerSettingsUpdate: (cb) => ipcRenderer.on('timer-settings-update', (_e, data) => cb(data)),
  closeTimerSettings: () => ipcRenderer.send('timer-close-settings'),

  // Native OS-level fullscreen toggle for the current window, and a listener
  // for when the main process reports the fullscreen state actually changed.
  onFullscreenChange: (cb) => ipcRenderer.on('fullscreen-changed', (_e, isFullscreen) => cb(isFullscreen)),

  // Window controls for tools
  setAlwaysOnTop: (flag) => ipcRenderer.send('set-always-on-top', flag),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  setFullscreen: (flag) => ipcRenderer.send('set-fullscreen', flag),
  focusWindow: () => ipcRenderer.send('focus-window'),
  // Resize current tool window (frameless)
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', { width, height }),
  // Standard names
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  close: () => ipcRenderer.send('close-window'),
  // Backward-compatible aliases used by names.js
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  
  // Million game operations
  createMillionSession: (settings) => ipcRenderer.invoke('million:createSession', settings),
  getMillionSession: (sessionId) => ipcRenderer.invoke('million:getSession', sessionId),
  
  // Security
  getApiKey: () => ipcRenderer.invoke('get-api-key'),

  // Screen sources (full-screen whiteboard recording)
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  getOwnWindowSource: () => ipcRenderer.invoke('get-own-window-source'),

  // Trial
  startTrial:      (name, phone) => ipcRenderer.invoke('start-trial', name, phone),
  getTrialStatus:  () => ipcRenderer.invoke('get-trial-status'),

  // Auto-update
  getAppVersion:   () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:  () => ipcRenderer.invoke('download-update'),
  installUpdate:   () => ipcRenderer.invoke('install-update'),
  onUpdateMessage: (cb) => ipcRenderer.on('update-message', (_e, data) => cb(data))
});

} // isTrustedFrame