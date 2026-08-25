@echo off
rem Magic Potion - arrete toute la stack (serveur + moteur + web + enfants).
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\daw.ps1" -Stop
echo.
pause
