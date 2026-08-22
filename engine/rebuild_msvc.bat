@echo off
call "%LOCALAPPDATA%\Microsoft\VisualStudio\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cd /d %~dp0build-msvc
rem M8/R10 settled: the tests and the host build WITH the engine - running
rem a stale daw_engine_test after a rebuild was a lie waiting to happen
ninja daw_engine daw_engine_test plugin_host
