# Backlog — OctaSuite Plugin (Obsidian + core puro)

> Revisado 2026-10-22 (Guatemala) tras la publicación de `0.10.0-beta.1` y la
> auditoría funcional de la beta. El estado debe comprobarse contra el código y CI
> del commit actual; las notas históricas de sesiones más abajo no son un inventario
> de estado vigente.
>
> **Toolchain canónico:** npm workspaces + `package-lock.json`; CI ejecuta
> `npm ci`, `npm test`, `npm run typecheck` y `npm run build`. Los archivos
> pnpm heredados no representan estos workspaces y se retirarán. El antiguo
> `scripts/sync-push.sh` queda bloqueado; no usar `rsync --delete` ni push directo
> a `main`.
>
> **Regla de oro:** cualquier cambio funcional va por TDD (RED → GREEN) y Pull
> Request con CI verde. Desplegar en un vault real es una comprobación manual aparte.

## Estado del mapa (cobertura actual — verificado en código)

El plugin ya cubre en modo `ready`: gastos, reportes, configuración, facturas
(incl. FEL/DTE), contactos, prospectos (leads), lealtad (puntos/recompensas),
productos, entradas (receipts), pagos, caja (register), contabilidad (partida
doble), nómina (IGSS/ISR/bono 14/aguinaldo) e inventario. Es decir: el **mapa
funcional** es comparable al de una suite comercial.

**Moat que no se toca:** localización guatemalteca (NIT, IVA 12%, FEL/DTE,
IGSS, bono 14) — ninguna plataforma de las comunidades comparadas la tiene.

**Estado verificado — 2026-10-22**
- **B-01 — Crédito de cliente:** implementado en dominio y UI de Caja/Contactos.
- **B-02 — Descuentos por línea en factura de venta:** implementados con tipo y
  cálculo explícitos; el soporte de descuentos en recibos está registrado por
  separado en el historial de auditoría.
- **B-03 — Listas de precios:** implementadas (factor y overrides, asignación por
  cliente y aplicación al crear facturas).
- **B-04 — Exportación de reportes:** Markdown y CSV al vault están implementados;
  exportación PDF sigue pendiente.
- **B-05 — Notas de crédito/devoluciones:** reembolso a tender, store credit,
  retorno de inventario y destino por ubicación están soportados. El flujo
  **exchange** sigue parcial: registra las líneas nuevas, pero no emite
  automáticamente una factura nueva.
- **B-08 — Rutas geolocalizadas:** no implementadas.
- **Operación / confiabilidad:** restauración desde backup propio, migración
  explícita de esquema del journal y prueba automatizada de UI en Obsidian
  siguen siendo trabajo futuro.

La beta publicada `0.10.0-beta.1` precede a las correcciones posteriores a su tag.
La candidata `0.10.0-beta.2` incorpora esas correcciones y requiere smoke test
antes de publicarse como nueva prerelease.
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
- **Bonus (posible bug latente aparte, NO tocado):** `writeReportToVault`
  (`report-export.ts`) llama `vault.createFolder(folder)` sin chequear si la
  carpeta ya existe — en Obsidian real `createFolder` lanza si existe, y el
  test `reports-vault.test.ts` lo enmascara simulando idempotencia. Debería
  revisarse en otro cambio.
- **Push/sync:** el script histórico `scripts/sync-push.sh` quedó retirado por
  usar `rsync --delete` y hacer push directo a `main`; los cambios van por PR.

### B-03 · Dual pricing / listas de precios por cliente
- **Estado:** implementado en dominio y UI. `domain/pricelist.ts` calcula el
  factor global y los overrides por producto; `VaultPricelists` persiste el
  catálogo; `partner-modal.ts` asigna lista al cliente y
  `invoice-editor-modal.ts` la aplica al crear factura.
- **Pendiente de alcance:** comprobar si la lista también debe afectar
  recepciones, cotizaciones futuras u otros canales de venta; no asumir que el
  soporte de factura implica todos esos flujos.
- **Archivos:** `packages/core/src/domain/pricelist.ts`,
  `packages/obsidian-plugin/src/storage/vault-pricelists.ts`,
  `packages/obsidian-plugin/src/ui/pricelist-manager-modal.ts`,
  `partner-modal.ts`, `invoice-editor-modal.ts`.
- **Criterio de seguridad:** ninguna lista de venta debe modificar costo o
  valoración de inventario.### B-04 · Reportes profesionales exportables (PDF/CSV)
- **Estado:** Markdown y CSV se exportan offline a `{dataFolder}/reports/`.
  PR #3 corrigió la creación de carpetas ya existentes y el armado de rutas;
  el test ahora simula el contrato real de Obsidian.
- **Pendiente:** exportación PDF. Mantenerla separada de los exports nativos
  para no añadir dependencias pesadas sin una decisión explícita.
- **Archivos:** `packages/obsidian-plugin/src/ui/report-export.ts`,
  `packages/obsidian-plugin/src/ui/reports-view.ts`,
  `packages/obsidian-plugin/tests/reports-vault.test.ts`.### B-05 · Refund/devolución flexible
- **Estado:** parcial, no paridad completa.
- **Implementado:** notas `store_credit`, reembolso a los métodos disponibles
  (Efectivo, Tarjeta, Transferencia), devoluciones parciales y ajustes de stock
  dirigidos a una ubicación. PR #4 hizo que el reducer respetara
  `stockReturnLocationId` y validara el destino antes de mutar factura/nota.
- **Pendiente crítico:** en tipo `exchange`, las líneas nuevas quedan registradas
  en la nota, pero aún no se emite automáticamente una nueva factura ni se
  descuenta inventario para los nuevos productos. No presentar el intercambio
  como flujo completo hasta cerrar la emisión contable y de stock.
- **Pendiente de control contable:** los tender no reconocidos ya no se asignan
  a Caja por fallback; si no existe cuenta compatible, el flujo actual puede
  guardar la nota sin asiento de tender. Mejorar el feedback/rechazo explícito.
- **Archivos:** `packages/core/src/domain/invoice.ts`, `packages/core/src/store.ts`,
  `packages/obsidian-plugin/src/ui/credit-note-modal.ts`,
  `packages/obsidian-plugin/src/ui/invoices-view.ts`.### B-08 · Rutas con geolocalización
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
remediación con TDD estricto RED→GREEN. Ítems 1-5 implementados; el 6 (deploy)
queda pendiente de confirmación final.

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
  store.test.ts 36/36, suite completa **560/560 (41 files)**, typecheck 0.
- **Ítem 5 — Docs (este cambio):** excepción del task-store documentada en
  `AGENTS.md`; cifra real de la suite actualizada (560+).

### Estado después de la auditoría 2026-10-22

- CI de `main` aprobado en el commit `2d281a7`: consulta el estado del commit
  actual en [GitHub Actions](https://github.com/EduGodoy07/OctaSuite-Plugin/actions).
  La cuenta exacta de tests es específica de cada commit y no debe reutilizarse
  como cifra estática.
- **Inventario — corregido:** PR #4 asigna devoluciones de stock a la ubicación
  elegida; PR #5 bloquea archivar ubicaciones con existencias y permite
  cantidades fraccionarias en traslados. Si el journal ya tenía una ubicación
  archivada con stock, revisar los eventos rechazados tras el replay.
- **Contabilidad — corregido:** PR #6 elimina el fallback que enviaba un tender
  desconocido a la primera cuenta de activo; métodos sin cuenta compatible aún
  requieren mejor feedback al usuario.
- **Release:** `0.10.0-beta.1` está publicada, pero antecede a las correcciones
  indicadas. La siguiente beta necesita smoke test de los cambios nuevos.

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