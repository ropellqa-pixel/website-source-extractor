@echo off
rem Installs Windows service "AbizRecorder" (warehouse video recorder). Run by the ABIZ installer as admin.
set DIR=%~dp0
if not exist "%ProgramData%\AnodBiz\recorder" mkdir "%ProgramData%\AnodBiz\recorder"
icacls "%ProgramData%\AnodBiz\recorder" /grant *S-1-5-32-545:(OI)(CI)M /Q >nul 2>&1
sc stop AbizRecorder >nul 2>&1
sc delete AbizRecorder >nul 2>&1
ping -n 3 127.0.0.1 >nul
sc create AbizRecorder binPath= "\"%DIR%AbizRecorder.exe\"" start= auto DisplayName= "ABIZ Recorder" >nul
sc description AbizRecorder "ABIZ: warehouse camera recorder (SKUD). Video only, no remote control." >nul
sc failure AbizRecorder reset= 86400 actions= restart/10000/restart/30000/restart/60000 >nul
rem Ordinary users may start/stop the service (needed by ABIZ auto-update), but not change or delete it.
sc sdset AbizRecorder D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWRPWPLOCRRC;;;BU) >nul
sc start AbizRecorder >nul
exit /b 0
