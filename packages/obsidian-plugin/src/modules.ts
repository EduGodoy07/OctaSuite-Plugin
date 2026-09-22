/**
 * Registro de módulos: única fuente de verdad del lanzador.
 *
 * Los mosaicos «próximamente» y «servidor» se muestran a propósito. Un ERP se
 * entiende por su mapa completo, no por lo que está listo hoy; ocultar lo que
 * falta hace que el sistema parezca más pequeño de lo que es y obliga al usuario
 * a adivinar si algo existe.
 */

export type ModuleStatus = "ready" | "soon" | "server";

export interface ModuleDef {
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly icon: string;
  readonly status: ModuleStatus;
  /** Qué hace el módulo, en una línea. */
  readonly detail: string;
  /** Vista que abre, cuando está listo. */
  readonly viewType?: string;
  /** Para pendientes y de servidor: por qué todavía no. */
  readonly reason?: string;
}

export const EXPENSES_VIEW_TYPE = "octasuite-expenses";
export const REPORTS_VIEW_TYPE = "octasuite-reports";
export const PARTNERS_VIEW_TYPE = "octasuite-partners";
export const PRODUCTS_VIEW_TYPE = "octasuite-products";
export const INVOICES_VIEW_TYPE = "octasuite-invoices";
export const RECEIPTS_VIEW_TYPE = "octasuite-receipts";
export const PAYMENT_RECEIPT_VIEW_TYPE = "octasuite-payment-receipt";
export const PAYABLES_VIEW_TYPE = "octasuite-payables";
export const LEADS_VIEW_TYPE = "octasuite-leads";
export const LOYALTY_VIEW_TYPE = "octasuite-loyalty";
export const ACCOUNTING_VIEW_TYPE = "octasuite-accounting";
export const PAYROLL_VIEW_TYPE = "octasuite-payroll";
export const INVENTORY_VIEW_TYPE = "octasuite-inventory";
export const EQUIPMENT_VIEW_TYPE = "octasuite-equipment";
export const TASKS_VIEW_TYPE = "octasuite-tasks";
export const LAUNCHER_VIEW_TYPE = "octasuite-launcher";
export const REGISTER_VIEW_TYPE = "octasuite-register";
export const CREDIT_NOTES_VIEW_TYPE = "octasuite-credit-notes";
export const SETTINGS_MODULE_ID = "configuracion";

/** Todas las vistas del plugin comparten prefijo, para poder barrer las viejas. */
export const VIEW_TYPE_PREFIX = "octasuite-";

/**
 * Detecta si un tipo de vista pertenece a OctaSuite por prefijo (y no por lista
 * exacta). Cualquier vista `octasuite-*` — vigente, legacy o de una constante
 * divergida de versiones anteriores — se reutiliza al navegar en lugar de abrir
 * una pestaña nueva. Testeado en `tests/modules.test.ts` (regresión 2026-09-09).
 */
export function isOctaSuiteViewType(viewType: string): boolean {
  return viewType.startsWith(VIEW_TYPE_PREFIX);
}

/** Tipos de vista vigentes. Cualquier otro con el prefijo es de una versión anterior. */
export const KNOWN_VIEW_TYPES: readonly string[] = [
  LAUNCHER_VIEW_TYPE,
  EXPENSES_VIEW_TYPE,
  REPORTS_VIEW_TYPE,
  PARTNERS_VIEW_TYPE,
  PRODUCTS_VIEW_TYPE,
  INVOICES_VIEW_TYPE,
  RECEIPTS_VIEW_TYPE,
  PAYMENT_RECEIPT_VIEW_TYPE,
  REGISTER_VIEW_TYPE,
  CREDIT_NOTES_VIEW_TYPE,
  PAYABLES_VIEW_TYPE,
  LEADS_VIEW_TYPE,
  LOYALTY_VIEW_TYPE,
  ACCOUNTING_VIEW_TYPE,
  PAYROLL_VIEW_TYPE,
  INVENTORY_VIEW_TYPE,
  EQUIPMENT_VIEW_TYPE,
  TASKS_VIEW_TYPE,
];

export const MODULES: readonly ModuleDef[] = [
  {
    id: "gastos",
    name: "Gastos",
    group: "Operación diaria",
    icon: "receipt",
    status: "ready",
    detail: "Captura rápida y flujo de aprobación",
    viewType: EXPENSES_VIEW_TYPE,
  },
  {
    id: "reportes",
    name: "Reportes",
    group: "Operación diaria",
    icon: "bar-chart",
    status: "ready",
    detail: "Período, categorías, formas de pago y clientes",
    viewType: REPORTS_VIEW_TYPE,
  },
  {
    id: SETTINGS_MODULE_ID,
    name: "Configuración",
    group: "Operación diaria",
    icon: "settings",
    status: "ready",
    detail: "Moneda, IVA, serie y carpeta de datos",
  },

  {
    id: "tareas",
    name: "Tareas",
    group: "Operación diaria",
    icon: "list-checks",
    status: "ready",
    detail: "Lista de tareas con estados y fechas límite",
    viewType: TASKS_VIEW_TYPE,
  },

  {
    id: "facturas",
    name: "Facturas",
    group: "Ventas",
    icon: "file-text",
    status: "ready",
    detail: "Emitir con correlativo, IVA y notas de crédito",
    viewType: INVOICES_VIEW_TYPE,
  },
  {
    id: "contactos",
    name: "Contactos",
    group: "Ventas",
    icon: "users",
    status: "ready",
    detail: "Clientes y proveedores con NIT validado",
    viewType: PARTNERS_VIEW_TYPE,
  },
  {
    id: "crm",
    name: "Prospectos",
    group: "Ventas",
    icon: "trending-up",
    status: "ready",
    detail: "Embudo, seguimiento y probabilidad de cierre",
    viewType: LEADS_VIEW_TYPE,
  },
  {
    id: "lealtad",
    name: "Lealtad",
    group: "Ventas",
    icon: "badge-percent",
    status: "ready",
    detail: "Puntos y niveles sobre el histórico de compras",
    viewType: LOYALTY_VIEW_TYPE,
  },

  {
    id: "productos",
    name: "Productos",
    group: "Catálogo y compras",
    icon: "package",
    status: "ready",
    detail: "Precio, costo, margen real, combos y existencia",
    viewType: PRODUCTS_VIEW_TYPE,
  },
  {
    id: "entradas",
    name: "Entradas de stock",
    group: "Catálogo y compras",
    icon: "truck",
    status: "ready",
    detail: "Recepciones con proveedor, costo y ajustes",
    viewType: RECEIPTS_VIEW_TYPE,
  },
  {
    id: "pagos",
    name: "Pagos",
    group: "Catálogo y compras",
    icon: "credit-card",
    status: "ready",
    detail: "Cuentas por pagar a proveedores",
    viewType: PAYABLES_VIEW_TYPE,
  },

  {
    id: "caja",
    name: "Caja",
    group: "Administración",
    icon: "shopping-cart",
    status: "ready",
    detail: "Turno, arqueo y cobro rápido",
    viewType: REGISTER_VIEW_TYPE,
  },
  {
    id: "contabilidad",
    name: "Contabilidad",
    group: "Administración",
    icon: "calculator",
    status: "ready",
    detail: "Partida doble, libro diario y mayor",
    viewType: ACCOUNTING_VIEW_TYPE,
  },
  {
    id: "nomina",
    name: "Nómina",
    group: "Administración",
    icon: "briefcase",
    status: "ready",
    detail: "Planilla, IGSS, ISR, bono 14 y aguinaldo",
    viewType: PAYROLL_VIEW_TYPE,
  },
  {
    id: "inventario",
    name: "Inventario avanzado",
    group: "Administración",
    icon: "warehouse",
    status: "ready",
    detail: "Ubicaciones, lotes y traslados",
    viewType: INVENTORY_VIEW_TYPE,
  },
  {
    id: "equipos",
    name: "Equipos",
    group: "Administración",
    icon: "laptop",
    status: "ready",
    detail: "Activos de uso interno, asignación y depreciación",
    viewType: EQUIPMENT_VIEW_TYPE,
  },
  {
    id: "sitio",
    name: "Sitio web",
    group: "Fuera del vault",
    icon: "globe",
    status: "server",
    detail: "Vitrina y catálogo público + tienda en línea",
    reason:
      "La vitrina se puede publicar desde el vault sin operar un servidor (Obsidian Publish o export estático). La tienda transaccional — carrito, checkout, pagos e inventario en tiempo real — sí exige un backend, y la cubren los módulos Odoo propios.",
  },
];

/** Grupos en orden de aparición, sin repetir. */
export function moduleGroups(): string[] {
  const seen: string[] = [];
  for (const m of MODULES) if (!seen.includes(m.group)) seen.push(m.group);
  return seen;
}

export function modulesIn(group: string): ModuleDef[] {
  return MODULES.filter((m) => m.group === group);
}

export const STATUS_LABEL: Record<ModuleStatus, string> = {
  ready: "Listo",
  soon: "Próximamente",
  server: "Servidor",
};
