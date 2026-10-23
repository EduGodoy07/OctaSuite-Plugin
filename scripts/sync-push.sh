#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'MESSAGE'
ERROR: scripts/sync-push.sh está retirado y bloqueado.

El repositorio ahora es el monorepo canónico con npm workspaces. Este script
pertenecía a una topología antigua: usaba rsync --delete contra un mirror
temporal y hacía push directo a main. No debe usarse con el árbol actual.

Flujo correcto para cambios de código:
  1. Crear una rama.
  2. Ejecutar npm ci, npm test, npm run typecheck y npm run build.
  3. Abrir un Pull Request.
  4. Fusionar solo después de CI verde.

Para instalar el plugin en un vault local:
  OCTASUITE_VAULT="/ruta/a/vault" npm run deploy

Este bloqueo es intencional para evitar sobrescrituras o push accidental a main.
MESSAGE

exit 2
