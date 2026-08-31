import { DomainError, fail } from "../errors.js";
import type { Money } from "../money.js";
import { format, zero } from "../money.js";
import type { IsoDate } from "../dates.js";

// ── Tipos de cuenta ──────────────────────────────────────────────────

export const LEDGER_ACCOUNT_TYPES = ["activo", "pasivo", "capital", "ingreso", "gasto"] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABEL: Record<LedgerAccountType, string> = {
  activo: "Activo",
  pasivo: "Pasivo",
  capital: "Capital",
  ingreso: "Ingreso",
  gasto: "Gasto",
};

/**
 * Clasificación contable normal: debit/credit por tipo de cuenta.
 *
 *   Activo / Gasto   → normal = Debit
 *   Pasivo / Capital / Ingreso → normal = Credit
 */
export function normalSide(type: LedgerAccountType): "debit" | "credit" {
  return type === "pasivo" || type === "capital" || type === "ingreso" ? "credit" : "debit";
}

/** Balance normal (lo que "debería" ser) de un tipo. */
export function isDebitNormal(type: LedgerAccountType): boolean {
  return normalSide(type) === "debit";
}

// ── Plan de cuentas ──────────────────────────────────────────────────

export interface AccountDraft {
  readonly code: string;
  readonly name: string;
  readonly type: LedgerAccountType;
  /** Cuenta padre para agrupación jerárquica (opcional). */
  readonly parentId?: string;
  readonly notes?: string;
}

export interface Account extends AccountDraft {
  readonly id: string;
  readonly archived: boolean;
}

export function validateAccountDraft(draft: AccountDraft, existing?: Account): void {
  if (!draft.code || draft.code.trim() === "") fail("empty_code", "El código de cuenta es obligatorio");
  if (!draft.name || draft.name.trim() === "") fail("empty_name", "El nombre de cuenta es obligatorio");
  if (!LEDGER_ACCOUNT_TYPES.includes(draft.type)) fail("invalid_type", `Tipo de cuenta inválido: ${draft.type}`);
  // Validar código único
  if (existing && existing.id !== undefined) {
    // Caller handles uniqueness check against store
  }
}

/** Códigos de ejemplo para el plan de cuentas base. */
export const DEFAULT_ACCOUNTS: readonly AccountDraft[] = [
  { code: "1100", name: "Caja", type: "activo" },
  { code: "1110", name: "Bancos", type: "activo" },
  { code: "1200", name: "Cuentas por Cobrar", type: "activo" },
  { code: "1300", name: "Inventario", type: "activo" },
  { code: "2100", name: "Cuentas por Pagar", type: "pasivo" },
  { code: "2200", name: "IVA por Pagar", type: "pasivo" },
  { code: "3100", name: "Capital Social", type: "capital" },
  { code: "3200", name: "Resultados Acumulados", type: "capital" },
  { code: "4100", name: "Ventas", type: "ingreso" },
  { code: "4200", name: "Otros Ingresos", type: "ingreso" },
  { code: "5100", name: "Costo de Ventas", type: "gasto" },
  { code: "6100", name: "Gastos Operativos", type: "gasto" },
  { code: "6200", name: "Gastos de Administración", type: "gasto" },
];

// ── Asientos contables ───────────────────────────────────────────────

export type JournalStatus = "draft" | "posted" | "voided";

export interface JournalLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly description?: string;
}

export interface JournalEntryDraft {
  readonly date: IsoDate;
  readonly description: string;
  /** Referencia externa (factura #, recibo #, etc.). */
  readonly reference?: string;
  readonly lines: readonly JournalLine[];
}

export interface JournalEntry extends JournalEntryDraft {
  readonly id: string;
  readonly status: JournalStatus;
  readonly postedAt?: string;
  readonly voidedAt?: string;
  readonly voidReason?: string;
  readonly createdAt: string;
}

// ── Validación ───────────────────────────────────────────────────────

export function validateJournalDraft(draft: JournalEntryDraft): void {
  if (!draft.date) fail("missing_date", "La fecha del asiento es obligatoria");
  if (!draft.description || draft.description.trim() === "") {
    fail("missing_description", "La descripción del asiento es obligatoria");
  }
  if (draft.lines.length < 2) {
    fail("insufficient_lines", "Un asiento requiere al menos 2 líneas");
  }

  // Validar que cada línea tenga al menos un monto
  for (let i = 0; i < draft.lines.length; i++) {
    const line = draft.lines[i]!;
    if (!line.accountId || line.accountId.trim() === "") {
      fail("missing_account", `Línea ${i + 1}: cuenta es obligatoria`);
    }
    if (line.debit.minor < 0 || line.credit.minor < 0) {
      fail("negative_amount", `Línea ${i + 1}: montos no pueden ser negativos`);
    }
    if (line.debit.minor > 0 && line.credit.minor > 0) {
      fail("both_sides", `Línea ${i + 1}: no puede tener débito y crédito al mismo tiempo`);
    }
    if (line.debit.minor === 0 && line.credit.minor === 0) {
      fail("zero_amount", `Línea ${i + 1}: debe tener un monto en débito o crédito`);
    }
  }
}

/** Suma de débitos y créditos de un asiento. */
export function totalsOf(entry: JournalEntryDraft, currency: string): { debits: Money; credits: Money } {
  let debits = 0;
  let credits = 0;
  for (const line of entry.lines) {
    if (line.debit.currency === currency) debits += line.debit.minor;
    if (line.credit.currency === currency) credits += line.credit.minor;
  }
  return {
    debits: { minor: debits, currency },
    credits: { minor: credits, currency },
  };
}

/** Asiento cuadrado: débitos = créditos (en la moneda dada). */
export function isBalanced(entry: JournalEntryDraft, currency: string): boolean {
  const { debits, credits } = totalsOf(entry, currency);
  return debits.minor === credits.minor;
}

// ── Balance de comprobación ──────────────────────────────────────────

export interface TrialBalanceLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: LedgerAccountType;
  readonly debit: Money;
  readonly credit: Money;
  /** Saldo neto: positivo = saldo normal (deudor para activo/gasto, acreedor para pasivo/capital/ingreso). */
  readonly balance: Money;
}

export interface TrialBalance {
  readonly asOf: IsoDate;
  readonly lines: TrialBalanceLine[];
  readonly totalDebits: Money;
  readonly totalCredits: Money;
  readonly balanced: boolean;
}

/**
 * Calcula el balance de comprobación a partir de asientos contabilizados.
 *
 * Para cada cuenta, suma débitos y créditos de todos los asientos posted.
 * El saldo neto respeta la normalidad contable:
 *   - Activo/Gasto: saldo positivo = deudor (normal)
 *   - Pasivo/Capital/Ingreso: saldo positivo = acreedor (normal)
 */
export function computeTrialBalance(
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  asOf: IsoDate,
  currency: string,
): TrialBalance {
  const accountMap = new Map<string, Account>();
  for (const a of accounts) accountMap.set(a.id, a);

  // Acumular débitos y créditos por cuenta
  const totals = new Map<string, { debits: number; credits: number }>();
  const bump = (accountId: string, side: "debits" | "credits", amount: number) => {
    const prev = totals.get(accountId) ?? { debits: 0, credits: 0 };
    totals.set(accountId, { ...prev, [side]: prev[side] + amount });
  };

  for (const entry of entries) {
    if (entry.status !== "posted") continue;
    if (entry.date > asOf) continue;
    for (const line of entry.lines) {
      if (line.debit.currency === currency) bump(line.accountId, "debits", line.debit.minor);
      if (line.credit.currency === currency) bump(line.accountId, "credits", line.credit.minor);
    }
  }

  const lines: TrialBalanceLine[] = [];
  let totalDebits = 0;
  let totalCredits = 0;

  // Solo incluir cuentas con movimiento
  for (const [accountId, { debits, credits }] of totals) {
    const account = accountMap.get(accountId);
    if (!account) continue;
    if (debits === 0 && credits === 0) continue;

    const net = debits - credits;
    const balance: Money = { minor: Math.abs(net), currency };
    totalDebits += debits;
    totalCredits += credits;

    lines.push({
      accountId,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      debit: { minor: debits, currency },
      credit: { minor: credits, currency },
      balance,
    });
  }

  // Ordenar por código de cuenta
  lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode, "es", { numeric: true }));

  return {
    asOf,
    lines,
    totalDebits: { minor: totalDebits, currency },
    totalCredits: { minor: totalCredits, currency },
    balanced: totalDebits === totalCredits,
  };
}
