# ADR-001 — Modelo de autoridad: un plugin, dos modos

**Fecha:** 2026-08-25
**Estado:** confirmado por Eduardo el 2026-08-30 — el orden de trabajo es el (1): completar el modo Personal primero y construir el modo Conectado después
**Reemplaza parcialmente:** `SPEC.md` §1, que asumía standalone puro como único modo

---

## Actualización 2026-09-18 (plan B — independencia)

**El modo Conectado queda FUERA DE ALCANCE del core por decisión de Eduardo.**
Se eliminó la maquinaria `RemoteNumberAuthority` / `Transport` /
`assertSingleOperator` y `reserve()` volvió a ser síncrono. El conector al
servidor OctaSuite (API v1 + Sanctum) **no se implementará en este repo**
mientras el modo Personal no esté completo y estable; si algún día se retoma,
se reintroduce con su propia revisión de diseño.

Las secciones siguientes describen el diseño original (2026-08-25) y quedan
como historial; el código vigente es el modo Personal únicamente.

---

## Contexto

El proyecto arrancó con tres requisitos que se contradicen entre sí:

1. **Standalone puro**, como Expensica: datos en el vault, sin servidor.
2. **Paridad funcional con Odoo y OctaSuite**, incluidas contabilidad, nómina y POS.
3. **Producto vendible a clientes con varios usuarios.**

Los tres no pueden ser verdad simultáneamente, y el obstáculo es mecánico, no de
esfuerzo:

- **Correlativos.** Sin una autoridad única, dos operadores offline emiten el
  mismo número de factura. El merge del journal lo detecta (`number_taken`) pero
  siempre *después* de que el documento se entregó al cliente.
- **Stock.** Dos operadores descargan la misma última unidad. Ningún merge de
  archivos puede serializar esa decisión.
- **Control de acceso.** Un vault no tiene identidad ni permisos: el vendedor ve
  la nómina porque los archivos están ahí.
- **Responsabilidad del respaldo.** Si el cliente pierde el vault, perdió su
  contabilidad, y el reclamo llega al proveedor.
- **Volumen.** El vault de referencia tiene 1,418 transacciones en un JSON de
  282 KB. Inventario, asientos y líneas de POS llegan a cientos de miles de
  filas: eso exige base de datos embebida, y en móvil la única vía sería SQLite
  en WASM — un binario que iCloud conflictúa sin posibilidad de merge.

## Decisión

**Un solo plugin con dos modos de operación**, distinguidos por *quién tiene la
autoridad sobre los datos*, no por la interfaz.

| | Modo Personal | Modo Conectado |
|---|---|---|
| Operadores | Uno | Varios |
| Autoridad | El journal del vault | Servidor OctaSuite (API v1 + Sanctum) |
| Correlativos | Locales (`LocalNumberAuthority`) | Reservados en el servidor antes de emitir (`RemoteNumberAuthority`) |
| Gastos, contactos, productos, proyectos | Locales | Locales con sincronización |
| Contabilidad, nómina, POS, inventario con ubicaciones | No disponibles | Vía servidor |
| RBAC y respaldo | No | Del servidor |
| Modelo comercial | Gratis — embudo | Licencia |

La UI es idéntica en ambos modos: el usuario nunca sale de Obsidian, que era el
requisito de fondo. Lo que cambia es la autoridad.

### Consecuencias inmediatas en el código

- `core/src/authority.ts` define `NumberAuthority` como **asíncrona desde el día
  uno**, para que pasar a autoridad remota no cambie el modelo de datos.
- `LocalNumberAuthority` **se niega a construirse** en modo conectado: es una
  barrera de tipo, no un comentario. Emitir con numeración local mientras hay
  varios operadores es el error que arruina un despliegue, y no debe ser posible
  por descuido.
- `RemoteNumberAuthority` **falla en vez de degradarse**: sin red no se emite. Es
  preferible bloquear la emisión a entregar un correlativo que otro operador ya
  usó.
- `assertSingleOperator()` marca cualquier operación que solo sea correcta con un
  operador.
- El core sigue sin dependencias de red: el transporte se inyecta
  (`Transport`), y el adaptador de Obsidian provee `requestUrl`.

## Alternativas descartadas

**Standalone puro también para varios usuarios.** Descartada: los correlativos
duplicados son inevitables y se descubren tarde. Ninguna cantidad de lógica de
merge lo arregla, porque el documento ya salió.

**Solo cliente del servidor (sin modo personal).** Descartada: pierde el embudo
comercial y la propuesta offline, que es lo que hace atractivo el plugin frente a
abrir el ERP en el navegador.

**Base de datos embebida en el vault para alcanzar volumen de ERP.** Descartada
para el modo personal: un archivo binario en iCloud u Obsidian Sync produce
conflictos irrecuperables. Si algún día hace falta, va acompañada de la decisión
de dejar de sincronizar por archivos.

## Módulos que no son candidatos al modo personal

Con LOC medidos en `EduGodoy07/OctaSuite`:

| Módulo | LOC | Por qué |
|---|---|---|
| `accounting` | 82,384 | Partida doble exige ACID; archivos no lo dan |
| `hr` (nómina) | 53,610 | IGSS, ISR, bono 14, aguinaldo: un error es una multa del cliente, no un bug |
| `inventory` | 61,588 | Concurrencia sobre existencias |
| POS multiterminal | — | Varias terminales contra un mismo turno de caja |

En modo Conectado los cuatro funcionan, con el servidor como autoridad.

## Pendiente de decisión

Confirmar si el orden de trabajo es:

1. Completar el modo Personal (front office: contactos, productos, facturación) y
   después construir el modo Conectado, o
2. Construir el puente al servidor primero, para tener un producto vendible antes
   y dejar el modo Personal como derivado.

---

## Corrección 2026-08-25 — la tabla de módulos estaba mal

La sección «Módulos que no son candidatos al modo personal» atribuía a la falta
de servidor cosas que en realidad son de alcance o de cumplimiento. Con **un
operador**, la mayoría cabe en el vault:

| Módulo | Lo que decía | Lo que es cierto |
|---|---|---|
| Caja | «servidor por multiterminal» | Un cajero cabe local. Servidor solo si varias terminales comparten turno. |
| Contabilidad | «exige ACID» | Con un operador no hay concurrencia. Cada asiento es un evento que se valida cuadrado. Lo que falta es alcance y la especificación SAT. |
| Nómina | «va donde hay respaldo» | El cálculo es local. Frena la responsabilidad legal: hacen falta las tablas IGSS/ISR verificadas. |
| Inventario | «concurrencia sobre existencias» | Más tipos de evento sobre el mismo journal. Sin concurrencia, no hay problema. |
| Sitio web | servidor | **Correcto.** Un vault no sirve páginas públicas. |

**La línea divisoria real no es local contra servidor.** Es:

1. **Varios operadores simultáneos** — correlativos, stock, turno de caja compartido.
2. **Presencia pública en red** — un sitio web.
3. **Especificaciones que no tengo** — formatos SAT, tablas de IGSS e ISR.

Solo (1) y (2) son argumentos arquitectónicos. (3) es trabajo de investigación,
no de infraestructura. El modelo de dos modos sigue vigente para (1); el resto de
la tabla original sobreatribuía a la arquitectura lo que era alcance.


---

## Incidente 2026-08-25/26 — edición concurrente por FRIDAY, bundle sin reconstruir

Esta sesión de Claude Code llegó a su límite de cuota justo después de escribir
`register-view.ts`. El usuario pegó la transcripción en FRIDAY (agente autónomo
vía opencode, ver `[[project_friday_ecosystem]]`), que continuó el trabajo en
el mismo repo: confirmó que `register.ts`/`store.ts` ya tenían la lógica,
detectó que `modules.ts` seguía con Caja en `"soon"`, y la cambió a `"ready"`
editando `modules.ts` y `main.ts` directamente. Corrió `tsc` y `vitest` — ambos
en verde — pero **nunca corrió `npm run build`/`deploy`**.

Resultado: el código fuente decía `"ready"`, pero el `main.js` compilado (en el
repo y en el vault) seguía siendo el de antes del cambio, con `"soon"` horneado
adentro. El usuario reportó "sigue como próximamente" y tenía razón — no era un
bug de lógica, era un bundle desactualizado.

**Lección para cualquier agente que edite este repo:** `tsc --noEmit` y
`vitest` verifican tipos y reglas, **no** que el bundle instalado refleje el
código fuente. El único chequeo que lo confirma es comparar el bundle
desplegado contra la fuente (ej. `grep` del campo en `main.js`), o simplemente
correr `npm run deploy` como último paso de cualquier cambio visible en la UI.

De paso quedó sin escribir el CSS del punto de venta (`octa-pos-item`,
`octa-cart-row`, `octa-filter-chip`, etc.) — la vista de Caja habría abierto
sin estilo. Se agregó al cerrar este incidente.

**Resolución verificada (2026-09-04):** las tres clases del incidente ya
existen y se estilan (`styles.css:629-735`: `.octa-pos`, `.octa-pos-grid`,
`.octa-pos-item`, `.octa-pos-item-name`, `.octa-pos-item-price`,
`.octa-pos-cart`, `.octa-cart-row`, `.octa-cart-main`, `.octa-cart-controls`,
`.octa-cart-actions`, `.octa-filter-chip`), consumidas por
`register-view.ts:258-373`. La verificación reveló además un gap transversal
que el incidente no capturó: `octa-num` (cifras de caja/carrito/factura/nómina)
solo tenía definición dentro de tablas (`.octa-table .octa-num`, `styles.css:252`);
se agregó la variante global `.octa-num { font-variant-numeric: tabular-nums; }`
(`styles.css:1099`) para alinear las cifras fuera de tablas (`octa-total-row`,
`octa-cart-row`, resumen de caja). No contradice la regla de tabla (especificidad
superior la complementa). Deploy verificado en el vault
(`.obsidian/plugins/octasuite-lite/styles.css:1099`).
