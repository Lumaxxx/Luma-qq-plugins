@echo off
rem Launch the bridge supervisor hidden (independent of any terminal).
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "<QQ_HOME>\supervise-bridge.ps1"
exit /b 0
