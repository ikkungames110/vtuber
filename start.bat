@echo off
rem pushd maps a drive letter so this also works from \\wsl.localhost\... paths
pushd "%~dp0"
if not exist node_modules (
  echo First-time setup...
  call npm install
)
start "" http://localhost:3000/control.html
node server.js
popd
pause
