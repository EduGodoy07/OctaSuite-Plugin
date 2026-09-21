#!/bin/bash
# ============================================================
# sync-push.sh - Sincroniza el codigo real (pnpm workspace) con
# el mirror de git y hace commit + push al remoto OctaSuite-Plugin.
#
# El codigo real NO es repo git; el remoto tiene estructura distinta
# (npm workspace: src/ + core/ + esbuild => main.js). Este script
# mapea pares, valida en el mirror y pushea. Uso:
#
#   scripts/sync-push.sh ["mensaje de commit opcional"]
#
# NOTA: solo caracteres ASCII en este archivo (un caracter no-ASCII
# corrupto rompio la expansion de $BRANCH el 2026-09-09).
# ============================================================
set -euo pipefail

REPO="${OCTASUITE_REPO:-/Users/edugodoy07/Documents/GitHub/octasuite-plugin}"
MIRROR="${OCTASUITE_MIRROR:-/tmp/octasuite-plugin-stage}"
REMOTE=origin
BRANCH=main
MESSAGE="${1:-chore: sync local -> remoto ($(date +%F))}"

echo "> Mirror: $MIRROR"

# 1) Recrear el mirror si hace falta (se pierde en cada reboot de /tmp)
if [ ! -d "$MIRROR/.git" ]; then
  echo "> Mirror no existe; clonando..."
  git clone git@github.com:EduGodoy07/OctaSuite-Plugin.git "$MIRROR"
fi

cd "$MIRROR"

# 2) Ponerse al dia con cualquier push previo
git fetch "$REMOTE"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "$REMOTE/$BRANCH")" ]; then
  echo "> Actualizando mirror contra $REMOTE/$BRANCH..."
  git pull --rebase "$REMOTE" "$BRANCH"
fi

# 3) Bundle fresco local (genera main.js) y mapeo por pares con rsync --delete
#    (espejo exacto: tambien limpia archivos huerfanos del mirror)
echo "> Build del bundle local..."
( cd "$REPO" && npm run build >/dev/null )

echo "> Copiando arboles al mirror..."
rsync -a --delete "$REPO/packages/obsidian-plugin/src/"  src/
rsync -a --delete "$REPO/packages/obsidian-plugin/tests/" tests/
rsync -a --delete "$REPO/packages/core/src/"  core/src/
rsync -a --delete "$REPO/packages/core/tests/" core/tests/
cp "$REPO/packages/obsidian-plugin/manifest.json" "$MIRROR/manifest.json"
cp "$REPO/packages/obsidian-plugin/styles.css"    "$MIRROR/styles.css"
cp "$REPO/packages/obsidian-plugin/main.js"       "$MIRROR/main.js"
cp "$REPO/README.md"  "$MIRROR/README.md"
cp "$REPO/BACKLOG.md" "$MIRROR/BACKLOG.md"

# 4) Instalar deps si el node_modules no existe aun y validar en el mirror
if [ ! -d node_modules ]; then
  echo "> npm install (workspaces)..."
  npm install >/dev/null
fi
echo "> typecheck..."
npm run typecheck
echo "> tests..."
npx vitest run 2>&1 | tail -4

# 5) Commit + push (si hay cambios o commits locales aun no pusheados)
NEED_COMMIT=false
if ! { git diff --quiet && git diff --cached --quiet; }; then
  git add -A
  git commit -m "$MESSAGE"
  NEED_COMMIT=true
fi

if [ "$(git rev-parse HEAD)" != "$(git rev-parse "$REMOTE/$BRANCH")" ] || [ "$NEED_COMMIT" = true ]; then
  echo "> Push a $REMOTE/$BRANCH..."
  git push "$REMOTE" "$BRANCH"
  echo "> Listo."
else
  echo "> Sin cambios y sin commits pendientes - nada que pushear."
fi