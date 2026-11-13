@echo off
REM ============================================================
REM  Build nativo no Windows (precisa do Rust instalado)
REM  https://rustup.rs
REM ============================================================

echo [Build] Compilando discord-fabrica para Windows...
cargo build --release

if %ERRORLEVEL% neq 0 (
    echo ERRO na compilacao.
    pause
    exit /b 1
)

echo.
echo Executaveis gerados em: .\target\release\
echo   discord-fabrica.exe
echo   local-bridge.exe
echo.
echo Para rodar o bridge:
echo   iniciar.bat
pause
