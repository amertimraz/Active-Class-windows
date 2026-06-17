// Test Electron
console.log('Starting Electron test...');

try {
  const electron = require('electron');
  console.log('Electron loaded successfully');
  console.log('Electron keys:', Object.keys(electron));
  
  const { app } = electron;
  console.log('App:', app);
  
  if (app) {
    console.log('App loaded successfully');
    app.whenReady().then(() => {
      console.log('App is ready!');
      app.quit();
    });
  } else {
    console.log('App is undefined');
  }
} catch (error) {
  console.error('Error loading Electron:', error);
}