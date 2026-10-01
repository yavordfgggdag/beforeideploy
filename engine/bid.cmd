@echo off
rem Before I Deploy - engine launcher for Windows. It only finds a Node and starts the engine: the PATH every
rem engine process uses is built in Node (engine\src\platform\index.mjs buildPath). macOS/Linux: engine/bid.
rem Messages are JSON with \u escapes, so no code page can garble them.
setlocal
set "ENGINE_DIR=%~dp0"
if "%ENGINE_DIR:~-1%"=="\" set "ENGINE_DIR=%ENGINE_DIR:~0,-1%"

rem optional PATH captured at install time (plain `set "PATH=..."` lines)
if exist "%ENGINE_DIR%\env.cmd" call "%ENGINE_DIR%\env.cmd"

rem Node's names (process.arch): AMD64 -> x64, ARM64 -> arm64
set "ARCH_KEY=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH_KEY=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "ARCH_KEY=arm64"

set "BUNDLED_NODE=%ENGINE_DIR%\runtime\win32-%ARCH_KEY%\node.exe"
if defined BID_NO_BUNDLED_NODE goto findnode
if not exist "%BUNDLED_NODE%" goto findnode
set "BID_NODE_RUNTIME=bundled"
"%BUNDLED_NODE%" "%ENGINE_DIR%\src\bid.mjs" %*
exit /b %ERRORLEVEL%

:findnode
set "NODE_EXE="
for /f "delims=" %%n in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%n"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Volta\bin\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Volta\bin\node.exe"
if defined NODE_EXE goto checkversion
if /i "%BID_LANG:~0,2%"=="bg" (
  echo {"type":"result","ok":false,"code":"no_node","key":"engine.noNode","error":"Node.js \u043d\u0435 \u0435 \u043d\u0430\u043c\u0435\u0440\u0435\u043d. \u0418\u043d\u0441\u0442\u0430\u043b\u0438\u0440\u0430\u0439 \u0433\u043e \u043e\u0442 nodejs.org."}
) else (
  echo {"type":"result","ok":false,"code":"no_node","key":"engine.noNode","error":"Node.js was not found. Install it from nodejs.org."}
)
exit /b 127

:checkversion
rem the engine needs Node 18+ (fetch, structuredClone)
set "NODE_V="
for /f "delims=" %%v in ('"%NODE_EXE%" --version 2^>nul') do set "NODE_V=%%v"
set "NODE_MAJOR=%NODE_V:v=%"
for /f "tokens=1 delims=." %%m in ("%NODE_MAJOR%") do set "NODE_MAJOR=%%m"
set /a NODE_MAJOR_N=%NODE_MAJOR% 2>nul
if not defined NODE_MAJOR_N goto run
if %NODE_MAJOR_N% GEQ 18 goto run
if /i "%BID_LANG:~0,2%"=="bg" (
  echo {"type":"result","ok":false,"code":"no_node","key":"engine.oldNode","error":"Node.js %NODE_V% \u0435 \u0442\u0432\u044a\u0440\u0434\u0435 \u0441\u0442\u0430\u0440 \u2014 \u043d\u0443\u0436\u043d\u0430 \u0435 \u0432\u0435\u0440\u0441\u0438\u044f 18 \u0438\u043b\u0438 \u043f\u043e-\u043d\u043e\u0432\u0430."}
) else (
  echo {"type":"result","ok":false,"code":"no_node","key":"engine.oldNode","error":"Node.js %NODE_V% is too old \u2014 version 18 or newer is needed."}
)
exit /b 127

:run
"%NODE_EXE%" "%ENGINE_DIR%\src\bid.mjs" %*
exit /b %ERRORLEVEL%
