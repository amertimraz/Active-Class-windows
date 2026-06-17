@echo off
echo Starting server for settings card test...
echo.
echo Opening test page: http://localhost:5000/test-settings-card.html
echo Main app: http://localhost:5000
echo.
start http://localhost:5000/test-settings-card.html
node server/server.js