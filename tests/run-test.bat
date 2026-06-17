@echo off
echo Starting Active Class Server...
echo.
echo Server will be available at:
echo - Main App: http://localhost:5000
echo - Settings Test: http://localhost:5000/test-settings
echo.
echo Press Ctrl+C to stop the server
echo.
node server/server.js
pause