@echo off
rem vcvars64 : emplacement par machine (tour = LOCALAPPDATA, portable =
rem Program Files (x86)) - friction payee au smoke L1b deux machines
set VCVARS=%LOCALAPPDATA%\Microsoft\VisualStudio\BuildTools\VC\Auxiliary\Build\vcvars64.bat
if not exist "%VCVARS%" set VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat
if not exist "%VCVARS%" (
  echo vcvars64.bat introuvable - installer VS Build Tools ou ajuster VCVARS
  exit /b 1
)
call "%VCVARS%"
cd /d %~dp0build-msvc
rem M8/R10 settled: the tests and the host build WITH the engine - running
rem a stale daw_engine_test after a rebuild was a lie waiting to happen.
rem create_test_doc too (2026-08-28): the e2e specs spawn it, and a clean
rem build without it turned 3 specs red for nothing.
ninja daw_engine daw_engine_test plugin_host create_test_doc
