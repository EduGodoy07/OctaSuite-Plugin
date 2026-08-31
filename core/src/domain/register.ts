import type { IsoDate, IsoInstant } from "../dates.js";
import type { Money } from "../money.js";

/**
 * Turno de caja. Un solo cajero: abrir con fondo, mover efectivo durante el
 * turno, cerrar contando lo que hay.
 *
 * El turno no necesita servidor mientras haya una sola terminal. Lo que sí
 * exigiría autoridad remota es que dos cajas compartan el mismo turno.
 */
export interface CashMovement {
  readonly id: string;
  readonly shiftId: string;
  readonly kind: "in" | "out";
  readonly amount: Money;
  readonly reason: string;
  readonly at: IsoInstant;
}

export interface Shift {
  readonly id: string;
  readonly openedAt: IsoInstant;
  readonly date: IsoDate;
  readonly openingFloat: Money;
  readonly closedAt?: IsoInstant;
  /** Lo que el cajero contó al cerrar. */
  readonly countedCash?: Money;
  readonly openingNotes?: string;
  readonly closingNotes?: string;
}

export const MOVEMENT_REASONS_OUT = ["Retiro a bóveda", "Pago a proveedor", "Gasto menor", "Otro"] as const;
export const MOVEMENT_REASONS_IN = ["Fondo adicional", "Devolución", "Otro"] as const;

/** Efectivo, en cualquiera de las formas en que se escriba. */
export function isCashMethod(method: string | undefined): boolean {
  return (method ?? "").trim().toLowerCase() === "efectivo";
}

export interface ShiftSummary {
  readonly openingFloat: Money;
  readonly cashSales: Money;
  readonly movedIn: Money;
  readonly movedOut: Money;
  /** Lo que debería haber en el cajón. */
  readonly expected: Money;
  readonly counted: Money | null;
  /** `contado − esperado`. Positivo sobra, negativo falta. `null` si no se ha contado. */
  readonly difference: Money | null;
  readonly ticketCount: number;
}
