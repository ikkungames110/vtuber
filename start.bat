@echo off
cd /d %~dp0
if not exist node_modules (
  echo First-time setup...
  call npm install
)
start "" http://localhost:3000/control.html
node server.js
pause
