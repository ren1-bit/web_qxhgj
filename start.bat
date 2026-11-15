@echo off
chcp 65001 >nul
title 情绪烘干机 - 本地一键启动
color f0

echo.
echo  ================================================
echo    情绪烘干机 - 一键本地启动
echo    请勿直接双击 index.html，务必用本脚本启动
echo  ================================================
echo.

REM ---- 检查 Node.js ----
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo  [错误] 未检测到 Node.js，请先安装：https://nodejs.org
  echo.
  pause
  exit /b 1
)

REM ---- 检查后端依赖 ----
if not exist "%~dp0server\node_modules\express" (
  echo  [提示] 首次运行，正在安装后端依赖...
  cd /d "%~dp0server"
  call npm install --no-audit --no-fund
  cd /d "%~dp0"
  echo.
)

REM ---- 第一步：启动后端（端口 3000，提供 AI 转化 + 树洞）----
echo  [1/2] 启动后端服务 (http://localhost:3000)...
start "情绪烘干机-后端(请勿关闭)" cmd /k "cd /d %~dp0server && node server.js"

REM 等待后端就绪
echo         等待后端启动...
timeout /t 3 /nobreak >nul

REM ---- 第二步：启动前端静态服务器（端口 8080）----
echo  [2/2] 启动前端服务 (http://localhost:8080)...

where python >nul 2>nul
if %errorlevel% equ 0 (
  start "情绪烘干机-前端(请勿关闭)" cmd /k "cd /d %~dp0 && python -m http.server 8080"
  goto :wait_open
)
where py >nul 2>nul
if %errorlevel% equ 0 (
  start "情绪烘干机-前端(请勿关闭)" cmd /k "cd /d %~dp0 && py -m http.server 8080"
  goto :wait_open
)

REM 没有 Python，用 Node 静态服务器
start "情绪烘干机-前端(请勿关闭)" cmd /k "cd /d %~dp0 && node preview-server.js"

:wait_open
timeout /t 2 /nobreak >nul

REM ---- 打开浏览器 ----
echo.
echo  ================================================
echo    启动完成！正在打开浏览器...
echo.
echo    访问地址：http://localhost:8080
echo    （请勿直接双击 index.html，否则功能无法使用）
echo.
echo    后端提供：AI 情绪转化 + 树洞留言
echo    关闭本窗口不会影响服务，服务在另两个窗口运行。
echo  ================================================
echo.

start http://localhost:8080

pause
