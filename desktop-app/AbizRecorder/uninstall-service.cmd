@echo off
sc stop AbizRecorder >nul 2>&1
ping -n 4 127.0.0.1 >nul
taskkill /F /IM AbizRecorder.exe >nul 2>&1
sc delete AbizRecorder >nul 2>&1
exit /b 0
