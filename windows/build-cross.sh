#!/usr/bin/env bash
# Cross-compila do Linux para Windows (x86_64-pc-windows-gnu)
# Requer UMA das opções abaixo:
#
# Opção A - MinGW (mais simples):
#   sudo apt install mingw-w64
#   rustup target add x86_64-pc-windows-gnu
#
# Opção B - Zig como linker (sem sudo, mais moderno):
#   # Download zig de https://ziglang.org/download/
#   export PATH="/path/to/zig:$PATH"
#   cargo install cargo-zigbuild
#
# Opção C - GitHub Actions (ver .github/workflows/build-windows.yml)
set -e

TARGET="x86_64-pc-windows-gnu"

# ---- Detecta método de compilação disponível ----
if command -v cargo-zigbuild &>/dev/null && command -v zig &>/dev/null; then
    echo "[Cross] Usando cargo-zigbuild (zig linker)"
    rustup target add "$TARGET" 2>/dev/null || true
    cargo zigbuild --release --target "$TARGET"
    OUT_DIR="./target/$TARGET/release"

elif command -v x86_64-w64-mingw32-gcc &>/dev/null; then
    echo "[Cross] Usando MinGW (x86_64-w64-mingw32-gcc)"
    rustup target add "$TARGET" 2>/dev/null || true
    cargo build --release --target "$TARGET"
    OUT_DIR="./target/$TARGET/release"

else
    echo "ERRO: Nenhum toolchain de cross-compile encontrado."
    echo ""
    echo "Instale uma das opcoes:"
    echo "  A) MinGW:    sudo apt install mingw-w64"
    echo "              rustup target add x86_64-pc-windows-gnu"
    echo ""
    echo "  B) Zig:     curl -L https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz | tar xJ"
    echo "              export PATH=\$PWD/zig-linux-x86_64-0.13.0:\$PATH"
    echo "              cargo install cargo-zigbuild"
    echo ""
    echo "  C) CI:      Push para o GitHub e use .github/workflows/build-windows.yml"
    exit 1
fi

echo ""
echo "Executaveis gerados em: $OUT_DIR"
ls -lh "$OUT_DIR/"*.exe 2>/dev/null || echo "(nenhum .exe encontrado)"
echo ""
echo "  discord-fabrica.exe  → servidor principal Rust (roda em Windows Server)"
echo "  local-bridge.exe     → bridge Discord Desktop IPC (roda no Windows do usuario)"
echo ""
echo "Para distribuir o local-bridge:"
echo "  1. Copie local-bridge.exe para o Desktop do usuario"
echo "  2. Defina as variaveis de ambiente:"
echo "     REMOTE_PANEL_URL=https://seu-servidor.app"
echo "     PANEL_PIN=sua-senha"
echo "  3. Execute iniciar.bat (ou diretamente local-bridge.exe)"
