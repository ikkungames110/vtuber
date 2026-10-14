@echo off
rem WSL 上のフォルダ (\\wsl.localhost\...) からでも動くように pushd でドライブを割り当てる
pushd "%~dp0"
if not exist node_modules (
  echo First-time setup...
  call npm install
)
start "" http://localhost:3000/control.html
node server.js
popd
pause
