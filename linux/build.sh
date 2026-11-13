#!/usr/bin/env bash
set -e

echo "[Linux] Compilando discord-fabrica (Rust)..."
cargo build --release

echo "[Linux] Compilando frontend (React/Vite)..."
npm install --prefer-offline
npm run build

echo ""
echo "Binários gerados:"
echo "  ./target/release/discord-fabrica   (servidor principal)"
echo "  ./target/release/local-bridge      (bridge IPC local)"
echo ""
echo "Para rodar o servidor:"
echo "  ./target/release/discord-fabrica"
echo "  PORT=3001 ./target/release/discord-fabrica"
