const { app, BrowserWindow } = require('electron');

console.log('Electron loaded successfully');
console.log('app:', app);

app.whenReady().then(() => {
  console.log('App is ready!');
  const win = new BrowserWindow({
    width: 800,
    height: 600
  });
  win.loadFile('public/index.html');
});