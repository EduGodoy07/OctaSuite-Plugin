# OctaSuite Lite — Especificación v1

Micro-ERP **standalone y offline** para Obsidian. Los datos viven en el vault; no
hay servidor, no hay cuentas de usuario, no hay red saliente.

Referencia de UX: [Expensica](https://github.com/dhruvir-zala/obsidian-expensica)
(MIT). Referencia de **reglas de negocio**: el repo `EduGodoy07/OctaSuite`, branch
`highsofttech/unificacion-aureus`.

---

> **Actualización 2026-08-25:** esta especificación describe el **modo Personal**.
> El proyecto adoptó un modelo de dos modos (Personal / Conectado) documentado en
> [`ADR-001`](ADR-001-modelo-de-autoridad.md), porque el requisito de varios
> usuarios es incompatible con autoridad local sobre los correlativos.
>
> **Actualización 2026-09-18 (plan B):** el modo Conectado quedó **FUERA DE
> ALCANCE** del core (decisión de Eduardo). Esta especificación describe
> únicamente el modo Personal.

## 1. Qué es y qué no es

Esto **no es un port de OctaSuite**. OctaSuite son 445,731 LOC de PHP, 443
migraciones y 375 modelos sobre Laravel + MySQL. Nada de ese código viaja. Lo que
se reutiliza es:

1. **Las reglas como especificación** — extraídas del PHP y reimplementadas en
   TypeScript, con el archivo de origen citado en cada caso (sección 4).
2. **Los catálogos como datos** — monedas, categorías, y a futuro SAT/UoM,
   exportados de MySQL a JSON.

### Alcance v1

| Incluido | Excluido y por qué |
|---|---|
| Gastos con flujo de aprobación | Contabilidad de partida doble — 82k LOC y requiere ACID |
| Contactos (partners) con validación de NIT | RBAC / multiusuario — no existe el concepto en un vault |
| Productos con precio e IVA | POS multiterminal — requiere servidor por definición |
| Facturación con correlativo y notas de crédito | FEL / certificación DTE — ver sección 6 |
| Tablero por período y bloque de consulta en notas | Workflows, webhooks, colas — no hay runtime para eso |

---

## 2. Arquitectura

```
packages/core              dominio puro, cero dependencias de Obsidian, testeado con Vitest
  src/money.ts             aritmética monetaria en enteros
  src/dates.ts             fechas civiles locales
  src/events.ts            catálogo de hechos (event sourcing)
  src/journal.ts           serialización JSONL, merge de conflictos
  src/store.ts             proyección de eventos a estado + consultas derivadas
  src/domain/*.ts          reglas por entidad
  src/catalogs/*.ts        semillas

packages/obsidian-plugin   solo adaptador de UI
  src/main.ts              ciclo de vida, comandos, bloque ```octasuite
  src/storage/             persistencia sobre el vault
  src/ui/                  modal de captura, tablero
```

El core no importa `obsidian`. Es la condición que permite: (a) probar las reglas
sin Obsidian, (b) reutilizarlas en una versión web o desktop, (c) exportar a
CSV/JSON sin duplicar lógica. La sincronización con la API v1 de OctaSuite quedó
**descartada del alcance del plugin** (decisión futura, no planificada — ver
`ADR-001`, actualización 2026-09-18).

---

## 3. Almacenamiento

```
octasuite-data/
  journal/2026-08.jsonl      append-only, un evento JSON por línea
  catalogs/*.json            semillas exportadas del ERP (solo lectura)
```

### Decisiones y su motivo

**Event sourcing, no estado mutable.** El journal es la única fuente de verdad;
el estado en memoria es una proyección reconstruible. Un archivo de estado
corrupto se descarta y se reconstruye; un journal corrupto pierde solo las líneas
ilegibles.

**JSONL append-only particionado por mes, no un JSON monolítico.** Expensica
reescribe `transactions.json` completo en cada cambio. Eso implica: (a) un crash
a media escritura puede perder el archivo entero, (b) dos dispositivos que
editaron offline producen un conflicto de sync irreconciliable. Con append-only,
un crash pierde a lo sumo la última línea (`parseJournal` la aparta y sigue), y
el merge deduplica por id de evento (`mergeJournals`), que es idempotente.

**Dinero en enteros de unidad mínima.** `Money = { minor: number, currency }`.
Expensica usa `amount: number` en unidades mayores; con porcentajes de impuesto
eso acumula error de redondeo. `money()` rechaza cualquier no-entero.

**Redondeo HALF-UP alejándose del cero**, igual que `RoundingMethod::HALF_UP` del
ERP. `Math.round(-0.5)` da `-0`; `roundHalfUp(-0.5)` da `-1`.

**Documentos fiscales inmutables.** Un borrador de factura no entra al journal:
solo el hecho `invoice.issued`. Una vez emitida, no se edita — se le agregan
hechos posteriores (`invoice.paid`, `invoice.credited`). El evento de emisión
carga su propio **snapshot de totales**, así que si mañana cambia la regla de
impuestos, reproducir el journal no altera una factura ya emitida.
`verifyTotals()` detecta la deriva sin corregirla en silencio.

**Datos del cliente congelados al emitir.** `partnerName` y `partnerTaxId` se
copian al documento. Si el contacto cambia de razón social después, el documento
emitido no cambia. Cubierto por test.

**Rechazar en vez de abortar.** `apply()` devuelve el rechazo en lugar de lanzar:
un journal reconciliado desde dos dispositivos puede contener secuencias
imposibles (dos facturas con el mismo correlativo, una transición que ya no
aplica). Se rechaza el evento, se reporta en el tablero, y la carga del vault
continúa.

---

## 4. Reglas portadas y su origen

| Regla | Origen en OctaSuite | Implementación |
|---|---|---|
| Estados de gasto (5) | `Expenses/Enums/ExpenseStatus.php` | `EXPENSE_STATUSES` |
| Transiciones legales | `ExpenseResource/Pages/EditExpense.php` — expresadas como `visible()` de cada acción | `EXPENSE_TRANSITIONS` |
| Categorías por defecto (8) y regla del `code` | migración `..._create_expense_categories_table.php` | `DEFAULT_EXPENSE_CATEGORY_NAMES`, `categoryCode()` |
| Tipos de cuenta de contacto (3) | `Partners/Enums/AccountType.php` | `ACCOUNT_TYPES` |
| Jerarquía padre/dirección | `Partner::addresses()` filtrando `account_type = address` | `validatePartnerDraft` exige `parentId` |
| Estados de documento | `Accounting/Account/Enums/MoveState.php` | `InvoiceStatus` (reducido a `issued`/`paid`) |
| Método de redondeo | `Enums/RoundingMethod.php` (`HALF-UP`) | `roundHalfUp()` |

### Divergencias deliberadas

**Transiciones en el dominio, no en la vista.** En OctaSuite el guard vive en
`EditExpense.php` vía `visible()`; aquí vive en `core/domain/expense.ts` y lo
verifica también la proyección. La regla deja de depender de la UI.

**Motor de impuestos simplificado.** OctaSuite calcula vía
`AccountManager::computeMoveLineTotals()` → `TaxFacade`, con líneas dinámicas,
`include_base_amount`, términos de pago y líneas de redondeo (motor estilo Odoo).
Aquí el impuesto se calcula y **redondea línea por línea**, porque así lo reporta
el detalle del DTE y porque un micronegocio no tiene impuestos compuestos.
**Consecuencia aceptada:** con muchas líneas los totales pueden diferir en
centavos de los del ERP. Está documentado y cubierto por test, no es accidental.

**Sin `company_id` ni `creator_id`.** Un vault es una empresa y un usuario. Si
alguna vez hace falta multiempresa, se agrega al sobre del evento, no a cada
entidad.

**Margen bruto, no multiplicador.** La plantilla RetailOS de Notion llama
«Margin» a `round((precio / costo) × 100) / 100`, que es el multiplicador sobre el
costo: con precio 100 y costo 80 devuelve 1.25 cuando el margen real es 20%, y
divide por el costo sin proteger el cero. `grossMarginPercent()` calcula el margen
correcto y `markupRatio()` expone el otro número con su nombre propio, para que no
se vuelvan a confundir. Ambos devuelven `null` cuando el cálculo no aplica, en vez
de un número que parece válido.

**Buscar-o-crear cliente al cobrar, que el POS real no tiene.** En
OctaSuite (`PosRegister.php` + `FelPartnerSearch.php`) la búsqueda de caja sí
incluye el NIT junto a nombre/correo/teléfono, y si no hay coincidencia local
intenta el SAT vía Infile para autocompletar el nombre legal — pero el punto de
venta real **no tiene ningún formulario manual de alta**: si el SAT no
responde, no hay salida sin ir a Contactos aparte. Este plugin no tiene SAT (es
offline por diseño), así que se reemplaza esa segunda mitad por creación
inline: si nadie coincide, `CustomerPicker` abre el formulario completo de
contacto con lo tecleado precargado (NIT si parece NIT, nombre si no), y
selecciona al recién creado sin soltar el cobro o la factura en curso. Mejora
al ERP real en este punto específico, no es paridad.

**Validación de NIT que el ERP no tiene.** Se implementó el dígito verificador
módulo 11 (`isValidNit`) porque una factura con NIT inválido es un problema
inmediato. Verificado contra dos vectores: `42932-5` y `3602978-5`.
**Pendiente:** confirmar el algoritmo contra el documento oficial de validaciones
FEL de SAT. El CUI del DPI usa otro algoritmo y **no** está implementado.

---

## 5. Estado actual

- `packages/core`: **251 tests en verde**, typecheck limpio.
- `packages/obsidian-plugin` v0.10.0: instalado y **corriendo** en el vault de
  iCloud, bundle verificado contra la fuente (no solo el resultado de `tsc`,
  ver el incidente al final de `ADR-001`). Contiene:
  - **Lanzador**: indicadores del período + mosaicos de módulo agrupados
    (`Listo` / `Próximamente`), cada pendiente con el motivo real. Registro
    único en `modules.ts`. Navega dentro de la misma hoja, con botón ← al
    inicio y ⤢ para expandir del lateral al área principal.
  - **Gastos**: acciones de flujo derivadas de `EXPENSE_TRANSITIONS` — la vista
    no conoce la máquina de estados, la consulta.
  - **Reportes**: gasto por categoría, mezcla de formas de pago, métricas de
    cliente, tendencia de 12 meses y mapa de calor diario (SVG propio, sin
    librerías), aviso de huecos en el correlativo.
  - **Contactos**: lista con búsqueda, validación de NIT en vivo, archivado
    reversible (`partner.restored`) con aviso de cuántos documentos referencian
    al contacto.
  - **Productos**: precio, costo, margen bruto real, combos con receta
    (`components`) y opciones configurables (`options`/`OptionSelection`) —
    un SKU declara cuántas unidades de una categoría hay que elegir al vender.
  - **Facturas**: líneas desde el catálogo con selector de opciones para
    configurables, totales en vivo, correlativo por `LocalNumberAuthority`,
    cobro y notas de crédito con tope en el saldo acreditable.
  - **Entradas de stock**: recepciones con proveedor y costo; alimenta el
    costo promedio de compra y el aviso de existencia negativa.
  - **Caja**: turno de un solo cajero (fondo, ingresos/retiros con motivo),
    catálogo con carrito, arqueo que pide el conteo antes de mostrar lo
    esperado (`shiftSummary`, solo cuenta efectivo).
  - **Buscador de cliente compartido** (Caja y Facturas): por NIT o nombre; si
    nadie coincide, crea inline sin soltar el cobro ni la factura.
  - **Nómina**: puesto por empleado, jefe directo (`managerId`) y
    responsabilidades desde el catálogo común; pestaña **Organigrama** con la
    cadena de mando y aviso de ciclos/referencias rotas en la carga.
  - **Inventario**: edición de nombre y tipo de ubicación (`location_updated`),
    con la ubicación principal protegida (`inventory.immutable_primary`).
  - **Pagos**: cuentas por pagar sobre las entradas de stock — espejo de
    Facturas del lado de las compras. `PaymentModal` es ahora compartido entre
    cobrar (Facturas/Caja) y pagar (Pagos), mismo flujo de forma de pago+fecha.
  - Captura rápida de gasto, bloque ```octasuite``` embebible, configuración.
- `authority.ts`: autoridad local síncrona, un solo modo (Personal). Ver `ADR-001`, actualización 2026-09-18.
- `analytics.ts`: comparación contra el mismo día de la semana, tasa de
  clientes que vuelven (excluyendo consumidor final, que es anónimo), mezcla
  de formas de pago, series mensuales y diarias para los gráficos.
- `domain/stock.ts`: existencia derivada de entradas − ventas ± ajustes; los
  combos se explotan a sus componentes almacenables, con protección contra
  recetas circulares.
- `domain/register.ts`: turno de caja y arqueo, ver `ADR-001` sobre por qué
  cabe en modo Personal con un solo cajero.

---

## 6. Riesgos abiertos

| Riesgo | Estado |
|---|---|
| Sin respaldo propio: si se pierde el vault, se pierde la contabilidad | Mitigar con recordatorio de export y, más adelante, export automático |
| Correlativos duplicados entre dispositivos offline | Detectado y rechazado en el merge, con aviso en el tablero. No auto-renumera: eso es decisión del usuario |
| FEL fuera de alcance en v1 | Técnicamente posible vía `requestUrl()`, pero exige custodia de credenciales del certificador dentro del vault y una pista de auditoría que hoy no existe |
| Algoritmo de NIT sin confirmar contra fuente oficial | Ver sección 4 |
| Sin migración de esquema de eventos | `EVENT_VERSION = 1`. Cualquier cambio incompatible exige un migrador que reescriba el journal |

---

## 7. Roadmap

1. **v0.1 (hecho)** — core + journal + gastos + tablero.
2. **v0.2** — contactos y productos en UI; notas markdown por contacto para
   enlazarlas desde el vault.
3. **v0.3** — facturación: modal de emisión, nota markdown por factura con
   frontmatter (para que Dataview la consulte), notas de crédito.
4. **v0.4** — export: CSV/JSON local. Ver `docs/EXPORT.md` cuando exista.
5. **v0.5** — presupuestos, heatmap de calendario, export PDF.
