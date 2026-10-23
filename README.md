# OctaSuite Lite

Micro-ERP offline para Obsidian: gastos, contactos, productos y facturación. Los
datos viven en tu vault, en texto plano, sin servidor.

Comparte las reglas de negocio de [OctaSuite](https://github.com/EduGodoy07/OctaSuite)
(el ERP en Laravel), pero no su código: es una implementación independiente en
TypeScript. Ver [`docs/SPEC.md`](docs/SPEC.md) para el detalle de qué se portó,
qué divergió y por qué.

## Estructura

| Paquete | Qué es |
|---|---|
| `packages/core` | Dominio puro. Cero dependencias de Obsidian. Testeado con Vitest. |
| `packages/obsidian-plugin` | Adaptador de UI para Obsidian. |

## Desarrollo

```bash
npm install
npm test              # suite del core
npm run typecheck     # tsc en ambos paquetes
npm run build         # bundle de producción -> packages/obsidian-plugin/main.js
npm run dev           # esbuild en watch
```

Este repositorio usa **npm workspaces** como gestor canónico (`package-lock.json`).
Para CI y reproducciones limpias usa `npm ci`. No mezcles lockfiles de otros
gestores de paquetes. Los cambios de código deben ir por rama + Pull Request;
`scripts/sync-push.sh` está retirado porque pertenecía a una topología antigua
y podía hacer `rsync --delete` y push directo a `main`.

## Instalar en un vault para probar

El plugin necesita `main.js`, `manifest.json` y `styles.css` en una carpeta dentro
de `.obsidian/plugins/`:

```bash
npm run build
VAULT=~/Desktop/Obsidian/Obsidian            # ajustar al vault de prueba
DEST="$VAULT/.obsidian/plugins/octasuite-lite"
mkdir -p "$DEST"
cp packages/obsidian-plugin/{main.js,manifest.json,styles.css} "$DEST/"
```

Después: Obsidian → Configuración → Plugins de la comunidad → activar
"OctaSuite Lite". Para desarrollo continuo, enlaza en vez de copiar
(`ln -s`) y usa `npm run dev`.

## Exportación de reportes y funciones pendientes

Los reportes se pueden exportar a Markdown o CSV dentro de
`{dataFolder}/reports/`. La exportación PDF aún no está implementada. El tipo
de nota de crédito `exchange` registra las líneas nuevas, pero todavía no crea
por sí solo la factura de reemplazo ni descuenta su inventario; consulta
[`BACKLOG.md`](BACKLOG.md), B-05, antes de usar ese flujo como un intercambio
completo.

> Prueba primero en un vault desechable, no en el de trabajo: el plugin crea la
> carpeta `octasuite-data/` y escribe en ella.

## Uso

- **Registrar gasto** — comando de la paleta o el botón `+ Gasto` del tablero.
- **Abrir tablero** — icono de la cinta lateral o comando de la paleta.
- **Consulta embebida en una nota:**

  ````markdown
  ```octasuite
  periodo: 2026-08
  detalle: categorias
  ```
  ````

## Datos

```
octasuite-data/
  journal/2026-08.jsonl    append-only, un evento por línea
  catalogs/                semillas exportadas del ERP
```

El journal es la fuente de verdad. Es texto, versionable con git, y se puede
inspeccionar con `cat`. Si dos dispositivos escribieron offline, los eventos se
reconcilian deduplicando por id.

## Licencia

MIT.
