#!/usr/bin/env bash
# Compila y copia el plugin al vault. El destino se puede sobreescribir:
#   OCTASUITE_VAULT="/ruta/al/vault" npm run deploy
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="${OCTASUITE_VAULT:-$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents}"
DEST="$VAULT/.obsidian/plugins/octasuite-lite"

if [[ ! -d "$VAULT/.obsidian" ]]; then
  echo "No parece un vault de Obsidian: $VAULT" >&2
  echo "Define OCTASUITE_VAULT con la ruta correcta." >&2
  exit 1
fi

npm --prefix "$ROOT" run build

mkdir -p "$DEST"
cp "$ROOT/packages/obsidian-plugin/main.js" "$DEST/"
cp "$ROOT/packages/obsidian-plugin/manifest.json" "$DEST/"
cp "$ROOT/packages/obsidian-plugin/styles.css" "$DEST/"

echo "Instalado en: $DEST"
echo "En Obsidian: Cmd+R para recargar, o Configuracion -> Plugins de la comunidad."
