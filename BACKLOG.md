# Backlog — OctaSuite Plugin (Obsidian + core puro)

> Generado 2026-09-04 a partir de: (1) análisis de feature requests de comunidades
> Square / Odoo / Shopify, (2) comparación contra Odoo CE, (3) verificación directa
> en el código del repo (`packages/core/src` y `packages/obsidian-plugin/src`).
>
> Regla de oro: **nada de esto se implementa sin TDD (RED → GREEN)** y sin
> `npm run typecheck` + suite completa en verde antes de `npm run deploy`.

## Estado del mapa (cobertura actual — verificado en código)

El plugin ya cubre en modo `ready`: gastos, reportes, configuración, facturas
(incl. FEL/DTE), contactos, prospectos (leads), lealtad (puntos/recompensas),
productos, entradas (receipts), pagos, caja (register), contabilidad (partida
doble), nómina (IGSS/ISR/bono 14/aguinaldo) e inventario. Es decir: el **mapa
funcional** es comparable al de una suite comercial.

**Moat que no se toca:** localización guatemalteca (NIT, IVA 12%, FEL/DTE,
IGSS, bono 14) — ninguna plataforma de las comunidades comparadas la tiene.

**Lo que la profundidad NO tiene todavía** (re-verificado contra el código real el
2026-09-26; el bloque de 2026-09-04 quedó congelado y los 5 ítems de esa lista ya
no eran ciertos — corrección documentada más abajo):

- **B-08 · Rutas con geolocalización** → es lo único pendiente real de P2.
  Verificado: 0 hits de `geoloc|latitude|longitude` en `packages/core/src`,
  `packages/obsidian-plugin/src` y ambos directorios `tests/`. No existe entidad
  de ruta, ni paradas, ni captura de coordenadas.
- **Export PDF nativo** → no existe, y no se implementó a propósito (decisión B-04:
  evitar librería de render en un plugin de 8GB). El export es Markdown + CSV al
  vault; el botón "MD" se rotula "imprimible a PDF desde Obsidian" (impresión del
  navegador, no PDF generado por el plugin).
- **Descuento por línea en receipts (entradas)** → sigue sin capturarse. El campo
  existe solo como proyección **readonly** (`ReceiptLineData.discount` en
  `packages/core/src/store.ts`); `ui/receipt-modal.ts` tiene 0 ocurrencias de
  `discount` (no hay UI para cargarlo). Es el "posible B-06" que B-02 dejó fuera.

**Ítems del bloque de 2026-09-04 que ya NO son ciertos** (corregidos 2026-09-26,
con la evidencia real de cada uno):

- ~~`discount|descuento` solo existe en `domain/payroll.ts`~~ → **B-02 DONE**:
  `LineDiscount` (percent y/o amount minor, combinables) en
  `packages/core/src/domain/invoice.ts` (12 ocurrencias de `discount`).
- ~~`store credit|crédito de cliente|customerCredit` → 0 hits~~ → **B-01 DONE**:
  `domain/credit.ts` (35 líneas), `creditAccounts` + `creditAccountByPartner` en
  `store.ts`, tender "Crédito" en `ui/register-view.ts`, abono desde
  `ui/partners-view.ts`, `CreditNoteType` con `"store_credit"` en
  `domain/invoice.ts:174`.
- ~~`pricelist|lista de precio|precio por cliente` → 0 hits~~ → **B-03 DONE**:
  `packages/core/src/domain/pricelist.ts` (81 líneas) + `VaultPricelists` +
  `PricelistManagerModal` + `pricelistId` en `domain/partner.ts`.
- ~~Export PDF de reportes → no verificado (hay `reports-view.ts`, sin export)~~ →
  **B-04 DONE en MD+CSV (PDF no implementado, por decisión):** sí hay export, en
  MD y CSV (`ui/report-export.ts` con
  `reportMarkdown` / `reportCsv` / `writeReportToVault`; botones "MD"/"CSV" en
  `ui/reports-view.ts` líneas 79-82, que escriben `reporte-{month}.md` y
  `tablas-{month}.csv` en `{dataFolder}/reports`). Lo que no existe es el PDF
  nativo (ver arriba).
- ~~Refund/devolución → existe solo nota de crédito (`credit-note-modal.ts`)~~ →
  **B-05 DONE**: `CreditNoteType = "store_credit" | "refund" | "exchange"`
  (`domain/invoice.ts:174`) con `exchangeLines` (línea 170) y `tenderRefund`
  (línea 168), validaciones `credit_note.refund_requires_tender` /
  `credit_note.tender_amount_mismatch`.

---

## Prioridad 1 — impacto comunitario alto + alineado con el moat GT

### B-01 · Crédito de cliente / store credit
- **Por qué:** es el pedido #1 histórico de Square (5+ años abierto). Cuadra
  con el sistema de lealtad existente y es nativo del modelo `partner`.
- **Estado:** DONE (2026-09-04) — dominio `packages/core/src/domain/credit.ts`
  + eventos `credit.added`/`credit.used`/`credit.adjusted` en `events.ts`
  (EVENT_TYPES) + proyección y helpers en `store.ts` (casos + `allCreditAccounts`
  / `creditAccountByPartner` / `creditBalanceFor` / `creditTransactionsFor`).
  Tender "Crédito" en `register-view.ts` (gate de cliente y saldo antes de
  reservar número; descuenta del saldo del cliente, no del cajón — `shiftSummary`
  sigue contando solo métodos cash). Abono manual desde `partners-view.ts`
  (botón "Crédito" + AmountModal). Evidencia: `packages/core/tests/credit.test.ts`
  (10 tests en verde), suite completa 323/323, typecheck 0, deploy instalado.
- **Alcance:** saldo de crédito por partner (multi-moneda); abono manual;
  tender "crédito" en caja con validación de saldo; consumos referenciados a
  factura. Queda fuera (posible B-05): devolución con destino a crédito.
- **Archivos:** `packages/core/src/domain/credit.ts`, `domain/loyalty.ts`
  (referencia), `events.ts`, `store.ts`, `index.ts`,
  `ui/register-view.ts`, `ui/partners-view.ts`.
- **Dependencias:** ninguno. Es factible sin servidor (event sourcing actual).

### B-02 · Descuentos rastreables por línea en ventas
- **Por qué:** "operational disconnect" reportado por Square; en GT el DTE/FEL
  exige lógica de descuento por línea y total explícita.
- **Estado:** DONE (2026-09-04) — `LineDiscount` tipado (`percent` y/o
  `amount` minor, combinables) en `domain/invoice.ts` con validación
  `invoice.discount_*` (≤ base, no con doc cerrado) y `lineDiscountAmount`
  (base = qty × price → discount → untaxed → tax). UI del editor de facturas
  (`ui/invoice-editor-modal.ts`) con columnas DTO % / DTO $ y `parseDiscount`
  inmutable. Helper de reporte `discountSummary(state, month, currency) →
  { total, documents }` en `store.ts` (proyección, no dominio) y KPI
  "Descuentos" en `ui/reports-view.ts`. Evidencia:
  `packages/core/tests/discount.test.ts` (10 tests) + describe "Descuentos del
  periodo" en `store.test.ts` (5 tests RED→GREEN), suite completa 338/338,
  typecheck 0, `npm run build` + `npm run deploy` instalado, bundle verificado
  (KPI presente en main.js).
- **Alcance:** líneas de invoice con DTO %/monto; totales por línea y factura
  corregidos; reporte por período (mes) y moneda. Queda fuera de esta fase
  (posible B-06): descuento en líneas de receipt (`domain/stock.ts`,
  `ui/receipt-modal.ts`) — no se tocó.
- **Archivos:** `packages/core/src/domain/invoice.ts`, `store.ts`, `index.ts`,
  `ui/invoice-editor-modal.ts`, `ui/reports-view.ts`.
- **Dependencias:** ninguno.

### F-01 · Gestión de tareas estilo TaskNotes (Scope Empresa/Global, Markdown nativo)
- **Por qué:** Permite a los negocios registrar y dar seguimiento a tareas operativas y fiscales (cobranzas pendientes, declaraciones, trámites) directamente en el vault sin requerir un gestor externo, aprovechando la portabilidad de archivos `.md` de Obsidian.
- **Decisiones arquitectónicas clave (el por qué del diseño):**
  1. **Tareas como archivos Markdown y no eventos en journal:** Las tareas son estados mutables de trabajo operativo en progreso; no pertenecen a la contabilidad inmutable de partida doble ni a los libros fiscales. Mantenerlas en `{folder}/tasks/{scope}/{id}.md` las hace legibles, auditables y compatibles con la filosofía TaskNotes sin inflar el journal financiero.
  2. **Ámbitos (Scope Empresa vs Global):** Soporta ámbito por empresa activa (`scope = companyId`) y ámbito transversal (`scope = "global"`), permitiendo alternar la visualización con chips rápidos y selector dinámico de empresa en la barra superior del launcher.
  3. **Integración con API nativa de Obsidian Vault:** En `task-store.ts`, se utiliza `vault.modify(file, data)` para actualizar archivos existentes y `vault.create(path, data)` para nuevos, asegurando que Obsidian indexe los archivos y emita eventos de sincronización nativos.
  4. **Aislamiento de nombres en UI:** En `tasks-view.ts`, la variable de estado se nombró `taskScope` para evitar colisiones estrictas con la propiedad nativa `ItemView.scope: Scope` de Obsidian (que administra atajos y hotkeys locales).
  5. **Contrato de dominio en validación de estado:** Se garantiza el paso de la entidad `Task` completa a `taskIsDone(t)` para respetar las invariantes de dominio del core (frente a `taskIsTerminal(status)` que evalúa solo el enum de estado).
- **Estado:** DONE (2026-09-05) — Dominio `packages/core/src/domain/task.ts` (59 tests), storage `task-store.ts`, modales `task-modal.ts`, vistas `tasks-view.ts`, selector de empresa en launcher `launcher-view.ts`, estilos `.octa-company-switch` en `styles.css`, cableado completo en `modules.ts`, `host.ts` y `main.ts`. 409 tests pasando, typecheck 0, build exitoso.
- **Archivos:** `packages/core/src/domain/task.ts`, `packages/obsidian-plugin/src/storage/task-store.ts`, `ui/task-modal.ts`, `ui/tasks-view.ts`, `ui/launcher-view.ts`, `modules.ts`, `ui/host.ts`, `main.ts`, `styles.css`.
- **Dependencias:** Ninguna externa. 100% offline y basado en el vault.

### F-02 · Endurecimiento de tareas: tags persistidos, ámbitos inválidos y KPI "Por vencer" (fixes post-revisión AGY)
- **Por qué:** El análisis post-F-01 (2026-09-06) encontró 3 invariantes rotas entre dominio y UI que el reporte de F-01 no cubría: (1) `task-nlp.ts` parsea mención de tags (`#etiqueta`) pero `TaskDraft`/`Task` no tenían campo `tags` → los tags se descartaban **en silencio** al crear una tarea; (2) la captura rápida aceptaba un ámbito explícito no visible bajo la empresa activa (ej. `@principal` o `@otra-empresa`) creando tareas en ámbitos huérfanos que la vista nunca muestra; (3) el KPI "Por vencer" usaba `due > today`, dejando las tareas con vencimiento **hoy** en un limbo (ni "por vencer" ni "vencidas").
- **Decisiones de fix:**
  1. **Tags como campo de dominio real:** `Task.tags: string[]` (readonly en `TaskDraft`), `TAG_RE = /^[a-zA-Z0-9_-]+$/`, `normalizeTags()` (dedupe + orden estable), validación `task.tag_invalid`, `KEYS_ORDER` incluye `tags`, `serializeTask` emite lista YAML y omite el campo si vacía para no tocar archivos existentes, `parseTask` acepta flow list `[a, b]` además de block list, y `updateTask` con `tags` usa `?? []` para poder **limpiar** (no solo pisar). Si el parse natural ya trae `#tag`, `task-nlp.ts` lo extrae sin el `#` y ya es compatible.
  2. **Guardia de ámbito en captura rápida (`taskScopeVisibleIn`):** nuevo helper de dominio `taskScopeVisibleIn(scope, activeCompanyId)` → `true` solo si `scope === "global"` o `scope === activeCompanyId`. La captura rápida de `tasks-view.ts` ahora valida con él: si el usuario escribe `@ámbito-no-visible`, muestra `Notice` y cae al ámbito visible (empresa activa) en vez de crear una tarea huérfana.
  3. **KPI "Por vencer" usa `taskIsDueSoon`:** nuevo helper `taskIsDueSoon(task, today = ISO de hoy)` → `due >= today && !terminal`. Cierra el limbo de vencimiento == hoy.
- **Estado:** DONE (2026-09-06) — Dominio `packages/core/src/domain/task.ts` con `tags`, `normalizeTags`, `TAG_RE`, `task.tag_invalid`, `taskIsDueSoon`, `taskScopeVisibleIn`; UI `tasks-view.ts` con guardia de ámbito y KPI corregido. 17 tests nuevos de regresión (tags round-trip, limpieza con `[]`, KPI, ámbito) escritos RED primero. Suite: **435 tests pasando** (antes 417/409), typecheck 0, build exitoso.
- **Archivos:** `packages/core/src/domain/task.ts`, `packages/core/tests/task.test.ts`, `packages/obsidian-plugin/src/ui/tasks-view.ts`.
- **Dependencias:** F-01 (requiere el modelo de tareas + ámbitos ya existentes). Sin dependencias externas.

---

## Prioridad 2 — profundidad de plataforma

### B-07 · Organigrama visual + CVs (PDF) y foto por empleado
- **Por qué:** pedido directo de Eduardo (2026-09-11). El módulo de payroll ya
  modela la jerarquía `managerId` desde hace tiempo (hasta N niveles, validación
  de ciclos en `store.ts`), pero hoy solo se ve como un campo en el modal del
  empleado. Un organigrama visual hace útil esa data (estructura de la empresa,
  cadena de mando) y los adjuntos (CV PDF + foto) convierten el módulo de nómina
  en el expediente del empleado.
- **Estado:** DONE (2026-09-11). Desviación respecto al plan original: se
  mantuvo el organigrama como **tab "Organigrama" dentro de PayrollView** en
  vez de crear una ItemView nueva (`octasuite-orgchart`), porque la tab ya
  existía mostrando una lista indentada — se reemplazó con un árbol SVG inline,
  evitando UI duplicada y romper el flujo de usuario. `payroll-view.ts` sigue
  siendo el único punto de entrada de nómina.
- **Implementación realizada:**
  1. **Modelo:** campos `photoPath?: string` y `cvPath?: string` añadidos a
     `Employee` (dominio, payroll.ts), validados por `validateEmployeeDraft`
     (rechaza `""` o whitespace → `payroll.bad_attachment_path`). `EmployeeDraft`
     los hereda vía `Omit`. Reducer `payroll.employee_updated` en `store.ts` ya
     soporta `changes.photoPath`/`changes.cvPath` (campo general).
  2. **Organigrama SVG (reemplaza la lista indentada):** `renderOrgchart()`
     en `payroll-view.ts` — layout de árbol (columna=profundidad, fila=centro
     de hojas descendientes, constantes `NODE_W=232/NODE_H=52/ROW_H=68/
     LEVEL_GAP=48/PAD=16`), nodos SVG con rect + círculo avatar (iniciales) +
     nombre + puesto, conectores ortogonales padre→hijo, raíces marcadas con
     clase `is-root`. Se eliminó `renderOrgNode` (lista indentada antigua) y
     helper `str` sin usar.
  3. **Adjuntos en el expediente:** en el modal `EmployeeModal`, sección
     "Expediente" (solo al editar) con botones "Subir foto" / "Subir CV" —
     `input type="file"` → `vault.createFolder` (idempotente: solo si la
     carpeta no existe) + `vault.createBinary` (o `vault.adapter.writeBinary`
     si el archivo ya existe) al path `octasuite-data/employees/{id}/foto.{ext}`
     / `cv.pdf` (extensión normalizada a minúsculas); al subir se actualiza
     `photoPath`/`cvPath` en el draft que se envía con el evento
     `payroll.employee_updated`. Re-subir el mismo tipo **sobrescribe el
     binario en el vault** (mismo path); no hay botón "Quitar" a propósito —
     el journal es inmutable y `photoPath: undefined` no se serializa, así
     que un path publicado no se puede limpiar con el modelo actual. Al
     crear un empleado nuevo, los adjuntos se agregan al editar (la creación
     aún no tiene `employeeId` para el path del vault).
  4. **Fila del empleado:** columna "Expediente" — miniatura de foto (`<img>`
     con `vault.getResourcePath`, `32px` circular, clase `.octa-employee-photo`)
     + botón "Ver CV" que abre el archivo del vault con
     `app.workspace.openLinkText`.
  5. **Estilos CSS:** `.octa-orgchart-wrap`, `.octa-orgchart-svg`, nodos/edges
     del árbol, `.octa-employee-photo`, `.octa-attachment-row`/`.octa-attachment-
     label`/`.octa-attachment-name` para la sección de adjuntos.
- **Archivos:** `packages/core/src/domain/payroll.ts` (campos),
  `packages/core/tests/payroll.test.ts` (2 tests: persistencia + rechazo blank),
  `packages/obsidian-plugin/src/ui/payroll-view.ts` (orgchart SVG + modal
  adjuntos + columna expediente), `styles.css` (nuevas clases).
- **Suite:** typecheck 0 errores, 522/522 tests pasando, build+deploy OK.
- **Bonus (bug latente aparte):** `writeReportToVault` (`report-export.ts`)
  llamaba `vault.createFolder(folder)` sin chequear si la carpeta ya existe — en
  Obsidian real `createFolder` lanza si existe, y el test
  `reports-vault.test.ts` lo enmascaraba simulando idempotencia. **CORREGIDO el
  2026-09-26** (TDD RED→GREEN): ver "Bug latente corregido (2026-09-26)" en la
  sección de remediación GLM.
- **Pendiente para push:** confirmación explícita de Eduardo (`scripts/sync-push.sh`).

### B-03 · Dual pricing / listas de precios por cliente
- **Por qué:** Square pide precio in-store vs online; Odoo lo resuelve con
  pricelists. Es la base para B2B vs retail.
- **Estado:** DONE (2026-09-21, commit `7a8b730`) — dominio
  `packages/core/src/domain/pricelist.ts` (81 líneas): `Pricelist`
  (`id`/`name`/`factorBps`/`overrides`), `PricelistOverride`, `PricelistDraft`,
  `applyPricelist(pricelist, product)` (resuelve precio de venta: override por
  producto si existe, si no factor global en bps con `roundHalfUp`, si no
  `salePrice` del producto) y `validatePricelistDraft` con errores
  `pricelist.name_required` / `pricelist.factor_invalid` /
  `pricelist.price_negative`. Exportado desde `packages/core/src/index.ts:15`.
  Vínculo con el cliente: `pricelistId?: string` en `Partner` y `PartnerDraft`
  (`domain/partner.ts:26-27,50`). Persistencia offline en el vault (archivo JSON,
  sin servidor): `packages/obsidian-plugin/src/storage/vault-pricelists.ts`
  (99 líneas) → `{dataFolder}/catalogs/pricelists.json`, carga tolerante (repara
  filas inválidas) y `save` encolado por serie. UI:
  `packages/obsidian-plugin/src/ui/pricelist-manager-modal.ts` (261 líneas,
  alta/edición de la lista con factor y overrides), integrada en
  `ui/products-view.ts` y `ui/partner-modal.ts`; `VaultPricelists` cableado en
  `main.ts` (`get pricelists()`) y expuesto por `ui/host.ts`. **No toca el
  costo**: el costing sigue en el producto (fuera de alcance por diseño).
  Evidencia: `packages/core/tests/pricelist.test.ts` (10 tests) +
  `packages/obsidian-plugin/tests/vault-pricelists.test.ts` (6 tests),
  verificados en verde en la corrida del 2026-09-26.
- **Alcance realizado:** lista de precios por partner; factor global en bps +
  override por producto; precio de venta resuelto al facturar; catálogo en el
  vault. Queda fuera: aplicar la lista en receipts/entradas, versionado del
  catálogo, y permissionamiento por rol.
- **Archivos:** `packages/core/src/domain/pricelist.ts`,
  `packages/core/tests/pricelist.test.ts`, `domain/partner.ts`, `index.ts`,
  `packages/obsidian-plugin/src/storage/vault-pricelists.ts`,
  `packages/obsidian-plugin/tests/vault-pricelists.test.ts`,
  `ui/pricelist-manager-modal.ts`, `ui/products-view.ts`, `ui/partner-modal.ts`,
  `main.ts`, `ui/host.ts`.
- **Dependencias:** ninguna externa. Reutiliza `Money`/`roundHalfUp` del core
  (misma aritmética minor-unit, sin flotantes). B-02 no era bloqueante.

### B-04 · Reportes profesionales exportables (PDF/CSV)
- **Por qué:** gap "básico" en todas las comunidades; en GT los reportes se
  adjuntan a trámites (SAT, bancos).
- **Estado:** DONE (2026-09-21, commit `7a8b730`) para MD + CSV; el **PDF nativo
  se decidió NO hacerlo** (librería de render innecesaria para un plugin
  offline-first; el Markdown se imprime a PDF desde Obsidian, y el botón lo dice
  explícitamente en su `title`). Implementación:
  `packages/obsidian-plugin/src/ui/report-export.ts` (187 líneas) con
  `reportMarkdown(input)` (KPIs, tendencia 12 meses, gasto por categoría, formas
  de pago, clientes, gasto por día, huecos del correlativo),
  `reportCsv(input)` (mismas secciones, celdas escapadas con `csvCell`) y
  `writeReportToVault(vault, folder, filename, content)` (create/modify).
  Función pura: recibe los datos ya calculados y formateados por la vista, sin
  duplicar la lógica de consolidación. Botones "MD" y "CSV" en
  `ui/reports-view.ts` (líneas 79-82) → `exportReport("md" | "csv")` escribe
  `reporte-{YYYY-MM}.md` / `tablas-{YYYY-MM}.csv` en `{dataFolder}/reports` y
  avisa con `Notice`. Evidencia: `packages/obsidian-plugin/tests/report-export.test.ts`
  (7 tests) + `reports-vault.test.ts` (5 tests, incluye el fix de
  `createFolder` del 2026-09-26 documentado más abajo).
- **Alcance realizado:** export MD + CSV al vault, sin servidor y sin
  dependencia nueva. Queda fuera: PDF nativo, export a XLSX, envío por correo.
- **Archivos:** `packages/obsidian-plugin/src/ui/report-export.ts`,
  `packages/obsidian-plugin/tests/report-export.test.ts`,
  `packages/obsidian-plugin/tests/reports-vault.test.ts`, `ui/reports-view.ts`.
- **Dependencias:** ninguna. Reusa las proyecciones de `store.ts` que la vista
  ya pintaba en pantalla.

### B-05 · Refund/devolución flexible
- **Por qué:** pedido recurrente; Square permite devolución a crédito, a
  tender original o exchange.
- **Estado:** DONE (2026-09-21, commit `7a8b730`) — la nota de crédito dejó de
  ser un único caso: `CreditNoteType = "store_credit" | "refund" | "exchange"`
  (`packages/core/src/domain/invoice.ts:174`) con payload extendido:
  `tenderRefund?: TenderRefund` (línea 168) y `exchangeLines?: readonly ExchangeLine[]`
  (línea 170). Validaciones de dominio: `credit_note.refund_requires_tender`
  (línea 225) y `credit_note.tender_amount_mismatch` (línea 227, el monto del
  tender debe cuadrar con el total), más la rama de `exchangeLines` (línea 238).
  Evento `invoice.refunded` extendido (nota en `packages/core/src/events.ts:107`)
  y proyección en `store.ts:600` que distingue `store_credit` (destino: cuenta
  de crédito del cliente) de `refund`/`exchange` sin re-proyectar. UI: selector
  de tipo en `ui/credit-note-modal.ts:19` ("Crédito cliente (saldo a favor)"),
  etiqueta por tipo en `ui/credit-notes-view.ts:13`, y emisión con tipo
  explícito desde `ui/invoices-view.ts:241`. Evidencia:
  `packages/core/tests/refund.test.ts` (15 tests) +
  `packages/core/tests/credit.test.ts` (10 tests), en verde en la corrida del
  2026-09-26.
- **Alcance realizado:** los tres destinos (crédito / tender original / exchange
  con líneas de cambio); devolución por tenders con monto exacto validado; nota
  de crédito como destino de la devolución (apoyado en B-01). Queda fuera:
  ubicaciones secundarias de retorno de stock (ver "Pendiente" de la auditoría
  GLM) y exchange parcial con múltiplos productos.
- **Archivos:** `packages/core/src/domain/invoice.ts`,
  `packages/core/tests/refund.test.ts`, `packages/core/src/events.ts`,
  `packages/core/src/store.ts`, `packages/obsidian-plugin/src/ui/credit-note-modal.ts`,
  `ui/credit-notes-view.ts`, `ui/invoices-view.ts`.
- **Dependencias:** se apoyó en B-01 (crédito de cliente) para el destino
  `store_credit`. Sin dependencias externas.

### B-08 · Rutas con geolocalización
- **Por qué:** pedido de Eduardo (2026-09-18). Para field service / entregas /
  visitas se necesita registrar rutas, paradas y coordenadas. Verificado: ni el
  ERP OctaSuite (Laravel) ni el plugin tienen geolocalización (0 hits de
  `geoloc|latitude|longitude` en `plugins/octa` + migrations del ERP, y solo
  "ruta" como file path en el plugin).
- **Estado:** no existe.
- **Alcance probable:** entidad Ruta (nombre, fecha, paradas ordenadas);
  paradas con `lat/lng` (captura manual o vía `navigator.geolocation` si el
  runtime de Obsidian lo permite) y estado de visita (pendiente/completada);
  vínculo con partners/empleados. En modo offline-first el journal sigue siendo
  la fuente de verdad (event sourcing actual, sin servidor).
- **Archivos:** (a definir — probablemente `packages/core/src/domain/route.ts`,
  `packages/obsidian-plugin/src/ui/route-view.ts`).
- **Dependencias:** ninguno. No requiere servidor (event sourcing actual).

---

## Remediación de auditoría GLM 5.3 (2026-09-13)

Auditoría de invariantes/estado (GLM 5.3) sobre OctaSuite Lite — 6 ítems de
remediación con TDD estricto RED→GREEN. Ítems 1-5 implementados; el 6 (build +
deploy) quedó verificado el 2026-09-26 contra el commit `4e56ee1` (ver
"Pendiente" más abajo).

### Ítems implementados (evidencia real, no assert)

- **Ítem 1 — Prórrateo fiscal bono14/aguinaldo y provisión mensual:**
  `multiply(highestSalary, Math.min(1, workedDays/365))` en
  `packages/core/src/domain/payroll.ts` (~l.113/l.123) y provisiones
  `multiply(gross, 1/12)`. Evidencia: `packages/core/tests/payroll.test.ts`
  (31/31 en verde). Decisión aprobada por Eduardo: prorrata con tope 1 y
  provisión 1/12.
- **Ítem 2 — Descuento por línea readonly en receipts + totales en UI:**
  `readonly discount: Money` en `ReceiptLineData` (`domain/stock.ts`);
  `receiptData()` usa `computeLineTotals`/`lineDiscountAmount`; tabla de
  receipts en `ui/receipt-view.ts` con 7 columnas y totales por línea.
  Evidencia: `packages/obsidian-plugin/tests/receipt-view.test.ts` (2/2).
- **Ítem 3 — IDs deterministas en nota de crédito (invoice.refunded):**
  causa raíz: `generateId()` (hash global no determinista) rompía el replay.
  Fix sin `generateId()` — adjustments `adj_{creditNoteId}_{i}` (índice de
  línea), journal entry `je_{creditNoteId}`, credit account
  `cra_{partnerId}` (partnerId = `current.partnerId ?? ""`, cuenta existente
  reutilizada), credit transaction `crt_{creditNoteId}`; claves de map ===
  valores `id`; `receipt-{id}` (invoice.paid) intacto. Grep: ningún test
  depende de IDs generados. Suite completa 558/558.
- **Ítem 4 — Guardia de integridad de emisión:** (a) `verifyTotals` en
  `domain/invoice.ts` (l.338-355, code `invoice.totals_drift`) ahora corre en
  el reducer `invoice.issued` y rechaza cuando los totals del payload no
  cuadran con las líneas; (b) `apply()` en `store.ts` gana un case `default:`
  con assertNever (`unknown_event`) — antes un evento runtime desconocido era
  aceptado en silencio (el switch exhaustivo solo compilaba, no protegía en
  runtime). Tests RED primero en `packages/core/tests/store.test.ts`
  (describe `"Integridad de emision (item 4)"`): espera
  `["invoice.totals_drift"]` y `state.invoices.has("inv_drift") === false`;
  y `["unknown_event"]` con `state.invoices.size === 0`. Verde verificado:
  store.test.ts 36/36, suite completa **560/560 (41 files)** — cifras de esa
  corrida (2026-09-13); la cifra vigente es **583/583 (45 files)**, verificada
  el 2026-09-26 —, typecheck 0.
- **Ítem 5 — Docs (este cambio):** excepción del task-store documentada en
  `AGENTS.md`; cifra real de la suite actualizada (560+). **Actualizado
  2026-09-26:** la cifra vigente es **583 tests / 45 archivos** (verificada con
  `npm test` + `npm run typecheck` en esa corrida). `AGENTS.md` sigue con
  "560+ / 41 archivos" porque ese archivo no se editó en esta corrida.

### Pendiente

- **Ítem 6 — Verificación final y deploy: DONE para el estado de `4e56ee1`,
  verificado 2026-09-26.** Evidencia real (comandos corridos en esa fecha):
  - `packages/obsidian-plugin/main.js` existe, **309.361 bytes, mtime
    2026-09-22 18:01**, es decir 9 minutos antes del commit `4e56ee1`
    (2026-09-22 18:10) — el build se hizo sobre el árbol que ese commit dejó.
  - El build **sí incluye F2** (lo único que `4e56ee1` agrega): los marcadores
    del parser EN de `task-nlp.ts` están en el bundle minificado
    (`next\s+week`, `day\s+after\s+tomorrow`, y el placeholder
    `¿Qué hay que hacer? (ej. Pagar SAT mañana !alta)`).
  - **El deploy sí se hizo**: `diff` entre el `main.js` del repo y el instalado
    en el vault activo
    (`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/.obsidian/plugins/octasuite-lite/main.js`)
    no arroja diferencias → **byte-idénticos**; `manifest.json` también
    idéntico. O sea que el vault instalado tiene esa versión.
  - `npm test` → **583/583 en 45 archivos** y `npm run typecheck` → **0 errores**,
    ambos verificados en la corrida del 2026-09-26 (con el fix de
    `writeReportToVault` de esa misma fecha ya aplicado).
  - **Aclaración importante:** el commit `4e56ee1` **no** incluye el build —
    `main.js` está en `.gitignore` (línea `main.js`) y `git ls-files` lo
    devuelve vacío; ningún commit de la historia toca ese archivo. El bundle es
    un artefacto local/no versionado **por diseño**, no un olvido.
  - **Advertencia (P0, corregido 2026-09-26 — ver "Defecto adyacente" más
    abajo):** el `main.js` desplegado contuvo el botón de export de B-04 que
    **nunca funcionó** por la duplicación de folder en el caller de
    `writeReportToVault` (presente desde `93275ab`). El fix quedó en `src/` con
    RED→GREEN y suite 586/586; el vault se actualiza con `npm run deploy`
    + Cmd+R una vez aprobado el diff.
  - **Lo que queda pendiente de verdad:** como el fix de `writeReportToVault`
    (2026-09-26) tocó `src/`, el `main.js` instalado en el vault quedó
    **atrás respecto al working tree**. Hace falta `npm run build` +
    `npm run deploy` (más Cmd+R en Obsidian) para llevar el fix al vault. No se
    ejecutó en esta corrida porque el orquestador lo tiene reservado y para no
    pisar la evidencia de mtime/byte-identidad que se verificó arriba.
- **Staging — Ubicaciones secundarias en devoluciones/stock:** decisión
  aprobada: `stockReturnLocationId` NO es PRIMARY → se valida/rechaza en
  emisión (ya mantenido en el reducer histórico); soporte real de
  localizaciones secundarias de retorno queda en BACKLOG, requiere TDD.

### Bug latente corregido (2026-09-26) — `writeReportToVault`

El "bonus (posible bug latente)" anotado en B-07 **estaba confirmado y se
corrigió**. Detalle, porque es la clase de bug que el mock estaba enmascarando:

- **Causa raíz:** `writeReportToVault` (`ui/report-export.ts`) llamaba
  `await vault.createFolder(folder)` sin condición. Las tipificaciones oficiales
  de Obsidian lo dicen explícito — `node_modules/obsidian/obsidian.d.ts:7400`:
  `@throws Error if folder already exists`. O sea que el **segundo** export al
  mismo folder fallaba en Obsidian real.
- **Por qué los tests no lo veían:** el `createFolder` del mock en
  `tests/reports-vault.test.ts` era idempotente (no lanzaba), que **no** es el
  comportamiento real.
- **Fix (TDD RED→GREEN):** el mock ahora modela carpetas (`MemoryAdapter` con un
  `Set` de carpetas; un archivo implica sus carpetas padre) y `createFolder`
  **lanza si la carpeta ya existe**, igual que Obsidian. Con eso, 3 tests
  quedaron en RED — incluido "maneja carpeta ya existente sin fallar", que
  justamente era el que lo enmascaraba — y el fix fue condicionar la creación:
  `if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder)`.
  Se usó `getAbstractFileByPath` (no `adapter.exists`) para no ampliar la
  superficie de `MinimalVault`: en Obsidian real devuelve un `TFolder` (que
  extiende `TAbstractFile` y trae `path`), y el typecheck lo valida.
- **Verde:** `reports-vault.test.ts` 5/5 (se añadió un test explícito de
  doble export al mismo folder con contador de llamadas a `createFolder`), suite
  completa 583/583, typecheck 0.
- **Defecto adyacente DETECTADO y CORREGIDO (P0, 2026-09-26):**
  `ui/reports-view.ts` llamaba
  `writeReportToVault(this.app.vault, folder, path, content)` donde `path` ya
  venía con la carpeta incluida (`path = \`${folder}/reporte-{month}.md\``).
  Como la función arma `fullPath = \`${folder}/${filename}\``, el archivo real
  quedaba en
  `octasuite-data/reports/octasuite-data/reports/reporte-2026-09.md` (folder
  duplicado), y `vault.create` no crea carpetas intermedias → el export fallaba
  en Obsidian real aunque la carpeta existiera. **El síntoma real era PEOR que
  un path engañoso: fallo silencioso total.** El `await` iba ANTES del
  `new Notice`; si `vault.create` lanzaba, el Notice nunca se ejecutaba y no
  había try/catch en el archivo → el usuario hacía clic en "MD"/"CSV", no pasaba
  nada, y quedaba un unhandled rejection en consola. `git log -S` confirmó que
  la duplicación existía desde el commit ORIGINAL de B-04 (`93275ab`): **el
  export nunca funcionó ni una sola vez desde que se escribieron los botones**,
  y los unit tests de `writeReportToVault` no podían cazarlo (le pasaban el
  filename bien; el error estaba en la composición de argumentos del caller).
  **Fix aplicado (TDD RED→GREEN):** helper puro exportado
  `reportFileName(month, kind)` en `report-export.ts` (devuelve solo el nombre,
  sin ruta; test `expect(name).not.toContain("/")` ata la regresión), el caller
  usa `reportFileName` y pasa solo el filename a `writeReportToVault`, y el
  export quedó envuelto en `try/catch` con `new Notice` de error (ya no hay
  unhandled rejection ni silencio). Suite completa 586/586, typecheck 0.

---

## Ya cubierto (no re-inventar)

| Feature | Dónde está |
|---|---|
| Formas de pago / tenders | `domain/invoice.ts`, `domain/stock.ts`, `domain/expense.ts`, `ui/register-view.ts` |
| Impuestos por categoría (IVA/exento/0%) | `catalogs/uom-sat.ts`, dominio GT |
| Flujo quote→invoice + FEL | `domain/invoice.ts` + FEL |
| Lealtad (puntos, niveles, recompensas) | `domain/loyalty.ts`, `ui/loyalty-view.ts`, `ui/reward-modal.ts` |
| Caja / register | `domain/register.ts`, `ui/register-view.ts`, `ui/register-modals.ts` |
| Contabilidad partida doble | `domain/accounting.ts`, `domain/journal.ts`, `money.ts` |

---

## Notas

- **Mosaico "Sitio web" (2026-09-04):** se actualizó `modules.ts` para
  distinguir vitrina (publicable desde el vault, sin servidor: Obsidian
  Publish/export estático) vs tienda transaccional (requiere servidor → Odoo).
- **Viabilidad sin servidor:** todo B-01..B-05 es factible con el event
  sourcing actual; referentes: voodo-erp, kasirgratisan, selyo-pwa
  (POS offline-first, mismo patrón).
- Criterio de priorización usado: demanda comunitaria × alineación GT ×
  esfuerzo. Re-evaluar tras cada release.