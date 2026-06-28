@echo off
title Active Class - License Server
echo.
echo  ====================================
echo   Active Class - License Server
echo  ====================================
echo.
echo  جاري ايقاف اي نسخة قديمة...
taskkill /f /im ngrok.exe >nul 2>&1
timeout /t 1 /nobreak >nul
echo  جاري تشغيل نفق التراخيص...
echo.
"C:\Users\ADAM-LAP\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe" http --domain=twisting-energy-applied.ngrok-free.dev 5000
pause
