import type { CurrencyCode, Money } from "../money.js";

// ── Cuenta de crédito de cliente ────────────────────────────────────

export interface CreditAccount {
  readonly id: string;
  readonly partnerId: string;
  readonly partnerName: string;
  /** Saldo disponible por moneda (unidades mínimas). */
  readonly balances: ReadonlyMap<CurrencyCode, Money>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Transacciones ───────────────────────────────────────────────────

export const CREDIT_TX_TYPES = ["added", "used", "adjusted"] as const;
export type CreditTxType = (typeof CREDIT_TX_TYPES)[number];

export const CREDIT_TX_LABEL: Record<CreditTxType, string> = {
  added: "Abono",
  used: "Consumo",
  adjusted: "Ajuste",
};

export interface CreditTransaction {
  readonly id: string;
  readonly accountId: string;
  readonly type: CreditTxType;
  /** Positivo = abono/ajuste+, negativo = consumo/ajuste-. */
  readonly amount: Money;
  /** Referencia externa (invoiceId, etc.). */
  readonly reference?: string;
  readonly note?: string;
  readonly createdAt: string;
}