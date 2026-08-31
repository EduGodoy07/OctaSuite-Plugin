import { assertIsoDate, type IsoDate, type IsoInstant } from "../dates.js";
import { DomainError, fail } from "../errors.js";
import { isNegative, isZero, type Money } from "../money.js";

/** Paridad exacta con `OctaSuite\Expenses\Enums\ExpenseStatus`. */
export const EXPENSE_STATUSES = ["draft", "submitted", "approved", "rejected", "paid"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/**
 * Maquina de estados leida de `ExpenseResource/Pages/EditExpense.php`, donde
 * OctaSuite la expresa como `visible()` de cada accion (capa Filament).
 * Aqui vive en el dominio: la regla deja de depender de la vista.
 */
export const EXPENSE_TRANSITIONS: Readonly<Record<ExpenseStatus, readonly ExpenseStatus[]>> = {
  draft: ["submitted"],
  submitted: ["approved", "rejected", "draft"],
  approved: ["paid"],
  rejected: ["draft"],
  paid: [],
};

export function canTransition(from: ExpenseStatus, to: ExpenseStatus): boolean {
  return EXPENSE_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ExpenseStatus, to: ExpenseStatus): void {
  if (!canTransition(from, to)) {
    fail("expense.illegal_transition", `Transicion no permitida: ${from} -> ${to}`);
  }
}

export interface Expense {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly amount: Money;
  readonly date: IsoDate;
  readonly categoryId?: string;
  readonly partnerId?: string;
  readonly paymentMethod?: string;
  readonly reference?: string;
  readonly notes?: string;
  readonly receiptPath?: string;
  readonly status: ExpenseStatus;
  readonly approvedAt?: IsoInstant;
  readonly paidAt?: IsoInstant;
  readonly archived: boolean;
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
}

export interface ExpenseDraft {
  readonly name: string;
  readonly amount: Money;
  readonly date: IsoDate;
  readonly description?: string;
  readonly categoryId?: string;
  readonly partnerId?: string;
  readonly paymentMethod?: string;
  readonly reference?: string;
  readonly notes?: string;
  readonly receiptPath?: string;
}

/** Devuelve la lista de problemas en vez de lanzar: la UI los muestra todos juntos. */
export function validateExpenseDraft(draft: Partial<ExpenseDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.name || draft.name.trim() === "") {
    errors.push(new DomainError("La descripcion del gasto es obligatoria", "expense.name_required"));
  }
  if (!draft.amount) {
    errors.push(new DomainError("El monto es obligatorio", "expense.amount_required"));
  } else if (isZero(draft.amount)) {
    errors.push(new DomainError("El monto no puede ser cero", "expense.amount_zero"));
  } else if (isNegative(draft.amount)) {
    errors.push(new DomainError("El monto no puede ser negativo; un reembolso se registra como ingreso", "expense.amount_negative"));
  }
  try {
    assertIsoDate(draft.date);
  } catch (e) {
    errors.push(e instanceof DomainError ? e : new DomainError("Fecha invalida", "expense.date_invalid"));
  }
  return errors;
}

/** Un gasto es inmutable en cuanto sale de `draft`, igual que en el flujo de aprobacion del ERP. */
export function isEditable(expense: Expense): boolean {
  return !expense.archived && expense.status === "draft";
}

export function assertEditable(expense: Expense): void {
  if (expense.archived) fail("expense.archived", "El gasto esta archivado");
  if (expense.status !== "draft") {
    fail("expense.not_editable", `Un gasto en estado ${expense.status} ya no se edita; regresalo a borrador primero`);
  }
}
