#!/usr/bin/env bash
# Instala o desinstala Quipu para el usuario actual (Linux, sin sudo).
# Uso:  ./install.sh           → instala
#       ./install.sh uninstall → desinstala
set -euo pipefail

APP=quipu
ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN_SRC="$ROOT/src-tauri/target/release/$APP"
ICON_SRC="$ROOT/src-tauri/icons/128x128.png"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/128x128/apps"
DATA_DIR="$HOME/.local/share/com.enrique.quipu"

case "${1:-install}" in
  install)
    if [[ ! -f "$BIN_SRC" ]]; then
      echo "❌ No existe $BIN_SRC"
      echo "   Compila primero:  bun run tauri build"
      exit 1
    fi
    mkdir -p "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"
    install -m755 "$BIN_SRC" "$BIN_DIR/$APP"
    install -m644 "$ICON_SRC" "$ICON_DIR/$APP.png"
    cat > "$DESKTOP_DIR/$APP.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Quipu
Comment=Biblioteca y lector personal de PDF/EPUB
Exec=$BIN_DIR/$APP
Icon=$APP
Terminal=false
Categories=Office;Viewer;Literature;
StartupWMClass=Quipu
EOF
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
    echo "✅ Quipu instalado."
    echo "   • Menú de aplicaciones: busca «Quipu»"
    echo "   • Terminal: $BIN_DIR/$APP"
    ;;
  uninstall)
    rm -f "$BIN_DIR/$APP" "$DESKTOP_DIR/$APP.desktop" "$ICON_DIR/$APP.png"
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
    echo "✅ Quipu desinstalado (binario, lanzador e icono)."
    echo "   Tus datos (biblioteca, progreso, notas) siguen en:"
    echo "     $DATA_DIR"
    echo "   Si también quieres borrarlos:  rm -rf \"$DATA_DIR\""
    ;;
  *)
    echo "Uso: $0 [install|uninstall]"
    exit 1
    ;;
esac
