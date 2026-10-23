import type { IsoDate, IsoInstant } from "../dates.js";
import { DomainError } from "../errors.js";

// ── Ubicaciones de inventario ─────────────────────────────────────────
//
// El módulo anterior trataba todo el inventario como un solo montón
// (existencia = entradas − ventas ± ajustes). Acá se agregan ubicaciones y
// traslados entre ellas. La ubicación principal («main») sigue concentrando
// recepciones, ventas y ajustes; las demás son destinos de traslados
// (bodega, piso de venta, depósito externo, etc.).

export type InventoryLocationKind = "main" | "warehouse" | "store" | "external";

export interface InventoryLocation {
  readonly id: string;
  readonly name: string;
  readonly kind: InventoryLocationKind;
  readonly archived: boolean;
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
}

export type LocationDraft = Pick<InventoryLocation, "name" | "kind">;

export const VALID_LOCATION_KINDS: readonly InventoryLocationKind[] = ["main", "warehouse", "store", "external"];

export function validateLocationDraft(draft: Partial<LocationDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.name?.trim()) {
    errors.push(new DomainError("El nombre de la ubicación es obligatorio", "inventory.empty_name"));
  }
  if (draft.kind && !VALID_LOCATION_KINDS.includes(draft.kind)) {
    errors.push(new DomainError(`Tipo de ubicación inválido: ${draft.kind}`, "inventory.invalid_kind"));
  }
  return errors;
}

/** ID fijo de la ubicación principal. Recibe recepciones, ventas y ajustes. */
export const PRIMARY_LOCATION_ID = "main" as const;

// ── Traslados entre ubicaciones ───────────────────────────────────────

export interface StockTransferLine {
  readonly productId: string;
  readonly quantity: number;
}

export interface StockTransfer {
  readonly id: string;
  readonly date: IsoDate;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly reference?: string;
  readonly lines: readonly StockTransferLine[];
  readonly createdAt: IsoInstant;
}

export interface TransferDraft {
  readonly date: IsoDate;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly reference?: string;
  readonly lines: readonly StockTransferLine[];
}

export function validateTransferDraft(draft: Partial<TransferDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    errors.push(new DomainError(`Fecha de traslado inválida: ${draft.date}`, "inventory.bad_date"));
  }
  if (!draft.fromLocationId || !draft.toLocationId) {
    errors.push(new DomainError("Origen y destino son obligatorios", "inventory.empty_location"));
  } else if (draft.fromLocationId === draft.toLocationId) {
    errors.push(new DomainError("El origen y el destino deben ser distintos", "inventory.same_location"));
  }
  if (!draft.lines || draft.lines.length === 0) {
    errors.push(new DomainError("Un traslado debe tener al menos una línea", "inventory.no_lines"));
  } else {
    for (const line of draft.lines) {
      if (!line.productId?.trim()) {
        errors.push(new DomainError("Una línea del traslado tiene un producto vacío", "inventory.empty_product"));
      }
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        errors.push(
          new DomainError(`Cantidad inválida para ${line.productId || "producto"}: ${line.quantity}`, "inventory.bad_quantity"),
        );
      }
    }
  }
  return errors;
}