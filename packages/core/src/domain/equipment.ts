import type { IsoDate, IsoInstant } from "../dates.js";
import { DomainError } from "../errors.js";
import { isNegative, roundHalfUp, subtract, type Money } from "../money.js";

// ── Inventario de equipos (activos de uso empresarial) ────────────────
//
// Inventario INDEPENDIENTE del stock: acá viven los activos que la empresa
// usa internamente (laptops, celulares corporativos, tablets, monitores),
// NO los productos que se venden a clientes.
//
// - Cada equipo tiene un serial único (por empresa) y un ciclo de vida
//   (nuevo → en uso → en reparación → dado de baja).
// - La asignación a empleados se modela con historial (EquipmentAssignment):
//   el dueño actual se DERIVA de la última asignación sin `returnedAt`, nunca
//   se edita un campo "dueño" — eso deja audit trail de quién tuvo qué.
// - Un equipo no puede estar asignado a dos personas a la vez.
// - El cliente asignado (clientId) indica para qué Partner del CRM se usa el
//   equipo (facturación/auditoría), no cambia la propiedad del activo.
// - La depreciación es línea recta, calculada por el dominio (función pura);
//   esta versión NO genera asientos contables automáticos, solo el cálculo.

export const EQUIPMENT_TYPES = ["laptop", "celular", "tablet", "monitor", "otro"] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export const EQUIPMENT_STATUSES = ["nuevo", "en_uso", "en_reparacion", "dado_de_baja"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const DEFAULT_EQUIPMENT_STATUS: EquipmentStatus = "nuevo";

/** Vida útil en años por tipo para depreciación lineal (defaults razonables GT). */
export const EQUIPMENT_USEFUL_LIFE_YEARS: Record<EquipmentType, number> = {
  laptop: 3,
  celular: 2,
  tablet: 3,
  monitor: 5,
  otro: 5,
} as const;

export interface Equipment {
  readonly id: string;
  readonly type: EquipmentType;
  /** Número de serie (único entre equipos activos de la empresa). */
  readonly serial: string;
  readonly brand?: string;
  readonly model?: string;
  /** IMEI del celular, si aplica. */
  readonly imei?: string;
  readonly status: EquipmentStatus;
  /** Nombre del plan de datos móviles (ej. "Plan Empresarial 20GB"). */
  readonly plan?: string;
  /** Operador/proveedor del plan (ej. "Tigo"). */
  readonly planProvider?: string;
  /** Fecha de renovación del plan/contrato. */
  readonly planRenewalDate?: IsoDate;
  /** Contacto del vendedor asignado (nombre). */
  readonly vendorName?: string;
  /** Contacto del vendedor asignado (teléfono). */
  readonly vendorPhone?: string;
  readonly purchaseDate?: IsoDate;
  readonly supplier?: string;
  readonly cost?: Money;
  readonly warrantyUntil?: IsoDate;
  /** Cliente (Partner del CRM) al que sirve el equipo. */
  readonly clientId?: string;
  readonly notes?: string;
  readonly archived: boolean;
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
}

export type EquipmentDraft = Omit<Equipment, "id" | "status" | "archived" | "createdAt" | "updatedAt"> & {
  /** Default "nuevo" si se omite al crear. */
  readonly status?: EquipmentStatus;
};

export interface EquipmentAssignment {
  readonly equipmentId: string;
  readonly employeeId: string;
  readonly assignedAt: IsoDate;
  readonly returnedAt?: IsoDate;
  readonly note?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TEXT_FIELDS = [
  "brand",
  "model",
  "imei",
  "plan",
  "planProvider",
  "vendorName",
  "vendorPhone",
  "supplier",
  "notes",
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

export function validateEquipmentDraft(draft: Partial<EquipmentDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.serial?.trim()) {
    errors.push(new DomainError("El serial o número de serie es obligatorio", "equipment.empty_serial"));
  }
  if (draft.type && !EQUIPMENT_TYPES.includes(draft.type)) {
    errors.push(new DomainError(`Tipo de equipo inválido: ${draft.type}`, "equipment.invalid_type"));
  }
  if (draft.status && !EQUIPMENT_STATUSES.includes(draft.status)) {
    errors.push(new DomainError(`Estado inválido: ${draft.status}`, "equipment.invalid_status"));
  }
  if (draft.cost && isNegative(draft.cost)) {
    errors.push(new DomainError("El costo no puede ser negativo", "equipment.bad_cost"));
  }
  for (const field of ["planRenewalDate", "purchaseDate", "warrantyUntil"] as const) {
    const value = draft[field];
    if (value !== undefined && !DATE_RE.test(value)) {
      errors.push(new DomainError(`Fecha inválida en ${field}: ${value}`, "equipment.bad_date"));
    }
  }
  for (const field of TEXT_FIELDS) {
    const value = draft[field];
    if (value !== undefined && value.trim() === "") {
      errors.push(new DomainError(`El campo ${field} no puede estar vacío`, "equipment.empty_field"));
    }
  }
  if (draft.clientId !== undefined && draft.clientId.trim() === "") {
    errors.push(new DomainError("El cliente asignado no puede estar vacío", "equipment.bad_client"));
  }
  return errors;
}

// ── Depreciación (línea recta) ─────────────────────────────────────────

/**
 * Depreciación mensual en línea recta: costo ÷ (vida útil en meses del tipo).
 * Devuelve null cuando no hay costo o fecha de compra (no depreciable).
 */
export function monthlyDepreciation(eq: Equipment): Money | null {
  if (!eq.cost || !eq.purchaseDate) return null;
  const months = EQUIPMENT_USEFUL_LIFE_YEARS[eq.type] * 12;
  if (months <= 0) return null;
  return { minor: roundHalfUp(eq.cost.minor / months), currency: eq.cost.currency };
}

/** Meses calendario completos transcurridos entre dos fechas (mínimo 0). */
function monthsBetween(earlier: IsoDate, later: IsoDate): number {
  // Formato ISO YYYY-MM-DD: posiciones fijas, sin depender del destructuring
  // de arrays (noUncheckedIndexedAccess).
  const ey = Number(earlier.slice(0, 4));
  const em = Number(earlier.slice(5, 7));
  const ly = Number(later.slice(0, 4));
  const lm = Number(later.slice(5, 7));
  return (ly - ey) * 12 + (lm - em);
}

/**
 * Depreciación acumulada a una fecha. Nunca supera el costo total (valor
 * residual 0 por default en esta versión).
 */
export function accumulatedDepreciation(eq: Equipment, asOf: IsoDate): Money | null {
  if (!eq.cost || !eq.purchaseDate) return null;
  const perMonth = monthlyDepreciation(eq);
  if (!perMonth) return null;
  const months = Math.max(0, monthsBetween(eq.purchaseDate, asOf));
  const raw = Math.min(perMonth.minor * months, eq.cost.minor);
  return { minor: raw, currency: eq.cost.currency };
}

/** Valor en libros: costo − depreciación acumulada (nunca menor a 0). */
export function bookValue(eq: Equipment, asOf: IsoDate): Money | null {
  if (!eq.cost) return null;
  const acc = accumulatedDepreciation(eq, asOf);
  return acc ? subtract(eq.cost, acc) : { minor: eq.cost.minor, currency: eq.cost.currency };
}