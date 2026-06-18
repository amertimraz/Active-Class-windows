// Preload script for Classroom Manager
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // Excel file operations
  selectExcelFile: () => ipcRenderer.invoke('select-excel-file'),
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
  loadQuizSubmissions: () => ipcRenderer.invoke('load-quiz-submissions'),
  saveQuizSubmissions: (submissions) => ipcRenderer.invoke('save-quiz-submissions', submissions),
  
  // Window operations
  openToolWindow: (toolName) => ipcRenderer.invoke('open-tool-window', toolName),
  openNumbersWindow: () => ipcRenderer.invoke('open-numbers-window'),
  openWheelWindow: () => ipcRenderer.send('open-wheel-window'),
  
  // Window controls for tools
  setAlwaysOnTop: (flag) => ipcRenderer.send('set-always-on-top', flag),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
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
  getApiKey: () => ipcRenderer.invoke('get-api-key')
});