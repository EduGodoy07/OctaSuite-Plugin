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
