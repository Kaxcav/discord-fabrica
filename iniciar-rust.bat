@echo off
title Discord Fabrica Rust Engine v2 (100%% Local)
cd /d "%~dp0"
echo Iniciando Painel Local Rust em http://localhost:3001 ...
start "" "http://localhost:3001"
".\target\release\discord-fabrica.exe"
