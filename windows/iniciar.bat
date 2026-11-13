@echo off
setlocal

REM ============================================================
REM  Discord Fabrica - Windows Local Bridge
REM  Roda o local-bridge.exe que conecta ao Discord Desktop
REM  e envia comandos IPC para o servidor remoto.
REM ============================================================

set "REMOTE_PANEL_URL=https://discord-fabrica-production.up.railway.app"
set "PANEL_PIN="
set "IPC_BRIDGE_PORT=6473"

REM Detecta executavel (build nativo ou cross-compiled)
if exist "%~dp0target\release\local-bridge.exe" (
    set "EXE=%~dp0target\release\local-bridge.exe"
) else if exist "%~dp0local-bridge.exe" (
    set "EXE=%~dp0local-bridge.exe"
) else (
    echo ERRO: local-bridge.exe nao encontrado.
    echo Execute primeiro: cargo build --release
    pause
    exit /b 1
)

echo [PC BRIDGE] Iniciando %EXE%
echo [PC BRIDGE] Painel: %REMOTE_PANEL_URL%
echo.

"%EXE%"
pause
