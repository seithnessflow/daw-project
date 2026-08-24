@echo off
rem Cibles COEUR seules (daw_engine + plugin_host) - contourne les cibles
rem bundle SDK en conflit (a stabiliser, TODO session crash 0xe06d7363)
set VCVARS=%LOCALAPPDATA%\Microsoft\VisualStudio\BuildTools\VC\Auxiliary\Build\vcvars64.bat
if not exist "%VCVARS%" set VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat
call "%VCVARS%"
cd /d %~dp0build-msvc
ninja daw_engine plugin_host
