@echo off
setlocal
rem Start NapCat with quick login. If 6099 already listens, do nothing (idempotent).
netstat -ano | findstr ":6099" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 exit /b 0
set "S=<QQ_HOME>\napcat\shell"
set "NAPCAT_PATCH_PACKAGE=%S%\qqnt.json"
set "NAPCAT_LOAD_PATH=%S%\loadNapCat.js"
set "NAPCAT_INJECT_PATH=%S%\NapCatWinBootHook.dll"
set "NAPCAT_LAUNCHER_PATH=%S%\NapCatWinBootMain.exe"
set "NAPCAT_MAIN_PATH=%S%\napcat.mjs"
start "" /b "<QQ_HOME>\napcat\shell\NapCatWinBootMain.exe" "C:\Program Files\Tencent\QQNT\QQ.exe" "%S%\NapCatWinBootHook.dll" <BOT_QQ>
exit /b 0
