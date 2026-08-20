@echo off
call "%LOCALAPPDATA%\Microsoft\VisualStudio\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cd /d %~dp0build-msvc
ninja daw_engine
