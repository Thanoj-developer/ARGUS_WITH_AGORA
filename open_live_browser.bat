@echo off
echo =======================================
echo Restarting Playwright Live Server...
echo =======================================

:: Wait 1 second for the calling server process to exit
timeout /t 1 /nobreak > nul

:: Find and kill any process occupying port 2001
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :2001') do (
    echo Killing existing process on port 2001 (PID: %%a)...
    taskkill /f /pid %%a
)

:: Start node server.js in a new interactive window
echo Launching server in interactive console...
start /b node server.js

:: Wait 3 seconds for the server to initialize
timeout /t 3 /nobreak > nul

:: Open or refresh the commanding panel
start http://localhost:2001/commanding.html
exit
