@echo off
rem ============================================================
rem  Magic Potion - lanceur de la stack complete (double-cliquable)
rem
rem  Lance serveur (Rust) + moteur (C++) + web (vite) puis OUVRE le
rem  site dans le navigateur, avec le token epingle (bookmark stable).
rem  Delegue a scripts\daw.ps1 -Secure (le vrai orchestrateur).
rem
rem  Arret :   double-clic sur stop-daw.cmd  (ou  scripts\daw.ps1 -Stop)
rem  Muet (verif, sans son ni navigateur) :  ajouter  -Mute
rem ============================================================
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\daw.ps1" -Secure %*
echo.
echo   Le navigateur s'est ouvert sur le projet 'studio'.
echo   Pour arreter la stack : double-clic sur stop-daw.cmd
echo.
pause
