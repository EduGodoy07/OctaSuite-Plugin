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

**Lo que la profundidad NO tiene todavía** (verificado con grep, 2026-09-04):

- `discount|descuento` solo existe en `domain/payroll.ts` y `ui/reward-modal.ts`
  → descuento por línea en ventas NO existe.
- `store credit|crédito de cliente|customerCredit` → 0 hits.
- `pricelist|lista de precio|precio por cliente` → 0 hits.
- Export PDF de reportes → no verificado (hay `reports-view.ts`, sin export).
- Refund/devolución → existe solo nota de crédito (`credit-note-modal.ts`).

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
- **Estado:** IN PROGRESS (2026-09-11) — aprobado por Eduardo como punto del
  plan; alcance inicial sin implementar.
- **Alcance probable:**
  1. **Vista "Organigrama"** (`ItemView` nuevo, tipo `octasuite-orgchart`):
     árbol renderizado desde `state.employees` usando `managerId` (raíz =
     empleado sin manager). Formato a decidir con Eduardo: canvas `.canvas`
     nativo de Obsidian (generado en el vault) vs render HTML/SVG del plugin
     (más control visual). Probar primero la opción SVG/HTML inline para no
     depender de coordenadas manuales de canvas.
  2. **Adjuntos por empleado:** foto + CV en PDF guardados en el vault
     (`octasuite-data/employees/{employeeId}/foto.*` y `cv.pdf` vía
     `vault.createBinary`), con `photoPath`/`cvPath` en el modelo `Employee`
     persistidos como evento `employee.updated` (el journal sigue siendo la
     fuente de verdad; los binarios viven fuera pero el path es inmutable en el
     evento). Mostrar foto + acción "Ver CV" en el modal/expediente del empleado.
  3. No tocar la validación de jerarquía existente (ya cubre ciclos/archivados).
- **Archivos:** `packages/core/src/domain/payroll.ts` (campos nuevos),
  `packages/core/src/store.ts` (evento `employee.updated`), `events.ts`,
  `packages/obsidian-plugin/src/ui/orgchart-view.ts` (nueva),
  `ui/payroll-view.ts` (expediente + subida de archivos), `modules.ts`.
- **Dependencias:** ninguna externa. 100% offline (vault). Puede apoyarse en la
  jerarquía existente de `payroll`.

### B-03 · Dual pricing / listas de precios por cliente
- **Por qué:** Square pide precio in-store vs online; Odoo lo resuelve con
  pricelists. Es la base para B2B vs retail.
- **Estado:** no existe (`pricelist` → 0 hits).
- **Alcance probable:** pricelist por partner o grupo; override por producto;
  precio de venta resuelto en el momento de crear invoice/receipt; sin tocar
  el costo (costing sigue en el producto).
- **Archivos:** `packages/core/src/domain/product.ts`, `domain/partner.ts`,
  `ui/product-modal.ts`, `ui/customer-picker.ts`, `ui/receipt-modal.ts`.
- **Dependencias:** ideal tras B-02 (misma zona de líneas de venta).

### B-04 · Reportes profesionales exportables (PDF/CSV)
- **Por qué:** gap "básico" en todas las comunidades; en GT los reportes se
  adjuntan a trámites (SAT, bancos).
- **Estado:** `reports-view.ts` existe; export no verificado. La exportación
  puede ser markdown/CSV vía vault (sin servidor) y/o PDF si se acepta
  dependencia de render (decidir si entra o se deja en `soon`).
- **Alcance probable:** export CSV/Markdown nativo (vault, offline); opción
  PDF como `soon` si requiere librería pesada (8GB RAM).
- **Archivos:** `packages/obsidian-plugin/src/ui/reports-view.ts`.
- **Dependencias:** ninguno.

### B-05 · Refund/devolución flexible
- **Por qué:** pedido recurrente; Square permite devolución a crédito, a
  tender original o exchange.
- **Estado:** parcial — existe nota de crédito (`credit-note-modal.ts`).
- **Alcance probable:** extender a exchange (cambio de producto con
  diferencia), devolución de stock a localización, devolución parcial por
  tenders con monto exacto. Reglas de journal para no romper partida doble.
- **Archivos:** `packages/core/src/domain/invoice.ts`, `domain/stock.ts`,
  `ui/credit-note-modal.ts`.
- **Dependencias:** ninguna; puede apoyarse en B-01 (crédito como destino de
  devolución).

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