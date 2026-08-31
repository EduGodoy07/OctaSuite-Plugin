# OctaSuite Lite

Micro-ERP offline para Obsidian: gastos, contactos, productos y facturación. Los
datos viven en tu vault, en texto plano, sin servidor.

Comparte las reglas de negocio de [OctaSuite](https://github.com/EduGodoy07/OctaSuite)
(el ERP en Laravel), pero no su código: es una implementación independiente en
TypeScript. Ver [`docs/SPEC.md`](docs/SPEC.md) para el detalle de qué se portó,
qué divergió y por qué.

## Estructura

| Ruta | Qué es |
|---|---|
| `core/` | Dominio puro. Cero dependencias de Obsidian. Testeado con Vitest. |
| `src/` | Adaptador / lógica de UI para Obsidian (`main.js` bundleado). |
| `tests/` | Tests del plugin (Vitest). |
| `docs/` | `SPEC.md` y los ADRs de diseño. |

La raíz del repo es el plugin compilado listo para instalar (incluye
`main.js`, `manifest.json` y `styles.css`), por lo que se puede usar
directamente con **BRAT** sin necesidad de compilar.

## Instalación con BRAT

Este es el flujo estándar para usar el plugin sin compilar nada:

1. Instala el plugin **BRAT** desde *Configuración → Plugins de la
   comunidad* y actívalo.
2. Abre la paleta de comandos (`Cmd+P`) y ejecuta **BRAT: Add a beta
   plugin for testing**.
3. Pega la URL del repo: `https://github.com/EduGodoy07/OctaSuite-Plugin`.
4. Confirma. BRAT instala el plugin con el nombre **OctaSuite Lite**.
5. Activa `OctaSuite Lite` en *Configuración → Plugins de la comunidad*.

> **Repo privado.** Para que BRAT pueda descargar el plugin de un repo
> privado, debe estar autenticado con GitHub. La forma más simple es tener
> el repo como privado pero conceder acceso a tu cuenta en
> *Configuración → Comunidad de plugins* (o usar un [Personal Access
> Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
> con permiso de lectura del repo en la autenticación de BRAT). Si lo
> compartes con un tercero, dale acceso de lectura al repo en GitHub.

Cada vez que hagas un commit con `main.js` nuevo en `main`, BRAT puede
actualizar el plugin desde el botón *Check for updates* del plugin.

## Desarrollo

```bash
npm install
npm test              # suite completa (core + plugin)
npm run typecheck     # tsc en core y el plugin
npm run build         # bundle de producción -> ./main.js
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
cp main.js manifest.json styles.css "$DEST/"
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
