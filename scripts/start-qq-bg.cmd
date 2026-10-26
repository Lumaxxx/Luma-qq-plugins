@echo off
setlocal
rem Idempotent start: if 3081 already listens, exit (avoid second instance EADDRINUSE).
netstat -ano | findstr ":3081" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [start-qq] already running on 3081
    exit /b 0
)

set DSH_HOME=<QQ_HOME>\home
set PATH=<QQ_HOME>\bin;%PATH%

rem Load local secrets (KEY=VALUE per line). Kept out of git; installer creates it.
if exist "<QQ_HOME>\ayu-secret.env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("<QQ_HOME>\ayu-secret.env") do set "%%a=%%b"
)

start "" /b "<USER_HOME>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" "<QQ_HOME>\node_modules\@deepseek-ai\dsh\lib\bin.js" web --port 3081 --no-open
