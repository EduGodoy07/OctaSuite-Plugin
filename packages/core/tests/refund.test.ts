import { describe, expect, it } from "vitest";
import {
  CreditNote,
  CreditNoteType,
  TenderRefund,
  ExchangeLine,
  CreditNoteDraft,
  validateCreditNoteDraft,
  assertRefundable,
  type CreditNote as CreditNoteTypeAlias,
  DomainError,
  accountBalance,
  computeInvoiceTotals,
  fromDecimal,
  project,
  totalsSnapshot,
  type AnyEvent,
  type InvoiceLine,
} from "@octasuite/core";
import { money, zero } from "@octasuite/core";

const CURRENCY = "GTQ" as const;

let seq = 0;
const evt = <T extends AnyEvent["type"]>(type: T, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: "2026-09-10T10:00:00.000Z", v: 1, type, payload } as AnyEvent);

// Helper: factura emitida de Q100.00 (sin impuesto, simplificada para contabilidad)
function issuedInvoice(invoiceId: string, totalMinor: number, date = "2026-09-01"): AnyEvent {
  const lines: InvoiceLine[] = [{ description: "Producto", quantity: 1, unitPrice: money(totalMinor, CURRENCY), taxRate: 0 }];
  return evt("invoice.issued", {
    invoiceId,
    series: "FAC",
    number: 1,
    date,
    currency: CURRENCY,
    lines,
    totals: totalsSnapshot(computeInvoiceTotals(lines, CURRENCY)),
    partnerName: "Cliente",
    partnerTaxId: "CF",
  });
}

const baseInvoice = {
  id: "inv-1",
  series: "FAC",
  number: 1,
  displayNumber: "FAC-0001",
  date: "2026-09-01",
  currency: CURRENCY,
  lines: [
    { description: "Producto A", quantity: 2, unitPrice: money(10000, CURRENCY), taxRate: 12, productId: "prod-a" },
    { description: "Producto B", quantity: 1, unitPrice: money(25000, CURRENCY), taxRate: 12, productId: "prod-b" },
  ],
  totals: {
    untaxed: money(45000, CURRENCY),
    tax: money(5400, CURRENCY),
    total: money(50400, CURRENCY),
    taxByRate: new Map([[12, money(5400, CURRENCY)]]),
  },
  status: "paid" as const,
  creditedTotal: zero(CURRENCY),
  creditNoteIds: [],
  partnerName: "Cliente",
  partnerTaxId: "CF",
};

const baseCreditNote: CreditNote = {
  id: "ncr-1",
  invoiceId: "inv-1",
  date: "2026-09-05",
  amount: money(12000, CURRENCY),
  reason: "Devolución producto A",
  createdAt: "2026-09-05T10:00:00.000Z",
};

describe("CreditNote domain (B-05)", () => {
  describe("CreditNoteType", () => {
    it("acepta los tres tipos: store_credit, refund, exchange", () => {
      const types: CreditNoteType[] = ["store_credit", "refund", "exchange"];
      expect(types).toEqual(["store_credit", "refund", "exchange"]);
    });
  });

  describe("CreditNoteDraft validation", () => {
    it("válido: store_credit simple (solo monto + razón)", () => {
      const draft: CreditNoteDraft = {
        type: "store_credit",
        amount: money(12000, CURRENCY),
        reason: "Error en precio",
      };
      const problems = validateCreditNoteDraft(draft);
      expect(problems).toHaveLength(0);
    });

    it("válido: refund con tenderRefund", () => {
      const draft: CreditNoteDraft = {
        type: "refund",
        amount: money(25000, CURRENCY),
        reason: "Devolución efectivo",
        tenderRefund: { method: "Efectivo", amount: money(25000, CURRENCY) },
      };
      const problems = validateCreditNoteDraft(draft);
      expect(problems).toHaveLength(0);
    });

    it("válido: exchange con líneas devueltas y nuevas", () => {
      const draft: CreditNoteDraft = {
        type: "exchange",
        amount: money(5000, CURRENCY),
        reason: "Cambio talla",
        lines: [{ productId: "prod-a", quantity: 1, unitPrice: money(10000, CURRENCY), taxRate: 12 }],
        exchangeLines: [{ productId: "prod-c", quantity: 1, unitPrice: money(15000, CURRENCY), taxRate: 12 }],
      };
      const problems = validateCreditNoteDraft(draft);
      expect(problems).toHaveLength(0);
    });

    it("inválido: monto negativo", () => {
      const draft: CreditNoteDraft = { type: "store_credit", amount: money(-100, CURRENCY), reason: "x" };
      const problems = validateCreditNoteDraft(draft);
      expect(problems.some((p) => p.code === "credit_note.negative")).toBe(true);
    });

    it("inválido: refund sin tenderRefund", () => {
      const draft: CreditNoteDraft = { type: "refund", amount: money(10000, CURRENCY), reason: "x" };
      const problems = validateCreditNoteDraft(draft);
      expect(problems.some((p) => p.code === "credit_note.refund_requires_tender")).toBe(true);
    });

    it("inválido: exchange sin lines ni exchangeLines", () => {
      const draft: CreditNoteDraft = { type: "exchange", amount: money(10000, CURRENCY), reason: "x" };
      const problems = validateCreditNoteDraft(draft);
      expect(problems.some((p) => p.code === "credit_note.exchange_requires_lines")).toBe(true);
    });

    it("acepta cantidades fraccionarias en líneas de devolución para productos pesables", () => {
      const draft: CreditNoteDraft = {
        type: "exchange",
        amount: money(5000, CURRENCY),
        reason: "Devolución parcial de peso",
        lines: [{ productId: "kg-rice", quantity: 0.5, unitPrice: money(10000, CURRENCY), taxRate: 12 }],
      };
      expect(validateCreditNoteDraft(draft)).toHaveLength(0);
    });

    it("rechaza cantidades no positivas en líneas devueltas", () => {
      const draft: CreditNoteDraft = {
        type: "exchange",
        amount: money(5000, CURRENCY),
        reason: "Cantidad cero",
        lines: [{ productId: "kg-rice", quantity: 0, unitPrice: money(10000, CURRENCY), taxRate: 12 }],
      };
      expect(validateCreditNoteDraft(draft).map((e) => e.code)).toContain("credit_note.return_quantity_invalid");
    });

    it("rechaza líneas de cambio sin producto o con cantidad inválida", () => {
      const draft: CreditNoteDraft = {
        type: "exchange",
        amount: money(5000, CURRENCY),
        reason: "Línea incompleta",
        exchangeLines: [{ productId: " ", quantity: -1, unitPrice: money(10000, CURRENCY), taxRate: 12 }],
      };
      const codes = validateCreditNoteDraft(draft).map((e) => e.code);
      expect(codes).toContain("credit_note.exchange_product_required");
      expect(codes).toContain("credit_note.exchange_quantity_invalid");
    });

    it("rechaza tasas fiscales inválidas en líneas nuevas", () => {
      const draft: CreditNoteDraft = {
        type: "exchange",
        amount: money(5000, CURRENCY),
        reason: "Tasa inválida",
        exchangeLines: [{ productId: "new-product", quantity: 1, unitPrice: money(10000, CURRENCY), taxRate: 120 }],
      };
      expect(validateCreditNoteDraft(draft).map((e) => e.code)).toContain("credit_note.exchange_tax_rate_invalid");
    });

    it("inválido: tenderRefund amount no coincide con amount total", () => {
      const draft: CreditNoteDraft = {
        type: "refund",
        amount: money(10000, CURRENCY),
        reason: "x",
        tenderRefund: { method: "Efectivo", amount: money(5000, CURRENCY) },
      };
      const problems = validateCreditNoteDraft(draft);
      expect(problems.some((p) => p.code === "credit_note.tender_amount_mismatch")).toBe(true);
    });

    it("inválido: reason vacío", () => {
      const draft: CreditNoteDraft = { type: "store_credit", amount: money(10000, CURRENCY), reason: "" };
      const problems = validateCreditNoteDraft(draft);
      expect(problems.some((p) => p.code === "credit_note.reason_required")).toBe(true);
    });
  });

  describe("assertRefundable", () => {
    it("permite nota si no excede total - creditedTotal", () => {
      const inv = { ...baseInvoice, creditedTotal: money(10000, CURRENCY) };
      expect(() => assertRefundable(inv, money(20000, CURRENCY))).not.toThrow();
    });

    it("rechaza si excede saldo acreditable", () => {
      const inv = { ...baseInvoice, creditedTotal: money(40000, CURRENCY) };
      expect(() => assertRefundable(inv, money(20000, CURRENCY))).toThrow(DomainError);
      try {
        assertRefundable(inv, money(20000, CURRENCY));
      } catch (e) {
        expect(e instanceof DomainError && e.code).toBe("credit_note.exceeds_invoice");
      }
    });

    it("rechaza monto negativo", () => {
      expect(() => assertRefundable(baseInvoice, money(-100, CURRENCY))).toThrow(DomainError);
      try {
        assertRefundable(baseInvoice, money(-100, CURRENCY));
      } catch (e) {
        expect(e instanceof DomainError && e.code).toBe("credit_note.negative");
      }
    });
  });

  describe("Asiento contable del tender refund (dirección semántica)", () => {
    // Regresión 2026-09-16 (Antigravity #1): el asiento estaba invertido —
    // DEBIT a Caja (aumentaba caja) + CREDIT a AR (disminuía clientes).
    // Para un reembolso: la caja SALE (credit) y AR AUMENTA (debit).
    it("reembolso en efectivo: Caja decrece y Cuentas por Cobrar aumentan", () => {
      const amount = money(10000, CURRENCY);
      const { state, rejected } = project([
        evt("accounting.account_created", { accountId: "a-cash", code: "1100", name: "Caja", type: "activo" }),
        evt("accounting.account_created", { accountId: "a-ar", code: "1200", name: "Cuentas por Cobrar", type: "activo" }),
        issuedInvoice("inv-1", 10000),
        evt("invoice.paid", { invoiceId: "inv-1", paidAt: "2026-09-01T14:00:00.000Z", paymentMethod: "Efectivo" }),
        evt("invoice.refunded", {
          creditNoteId: "ncr-1",
          invoiceId: "inv-1",
          date: "2026-09-05",
          amount,
          reason: "Devolución",
          type: "refund",
          tenderRefund: { method: "Efectivo", amount },
        }),
      ]);

      expect(rejected).toHaveLength(0);

      // Caja: el dinero SALE — el balance debe ser NEGATIVO (credit > debit)
      const cashBalance = accountBalance(state, "a-cash", CURRENCY);
      expect(cashBalance.minor).toBe(-amount.minor);

      // AR: el cliente pasa a deber de nuevo — el balance debe ser POSITIVO (debit > credit)
      const arBalance = accountBalance(state, "a-ar", CURRENCY);
      expect(arBalance.minor).toBe(amount.minor);
    });

    it("reembolso con método tarjeta: Banco decrece y Cuentas por Cobrar aumentan", () => {
      const amount = money(5000, CURRENCY);
      const { state, rejected } = project([
        evt("accounting.account_created", { accountId: "a-bank", code: "1110", name: "Bancos", type: "activo" }),
        evt("accounting.account_created", { accountId: "a-ar", code: "1200", name: "Cuentas por Cobrar", type: "activo" }),
        issuedInvoice("inv-2", 10000),
        evt("invoice.paid", { invoiceId: "inv-2", paidAt: "2026-09-01T14:00:00.000Z", paymentMethod: "Tarjeta" }),
        evt("invoice.refunded", {
          creditNoteId: "ncr-2",
          invoiceId: "inv-2",
          date: "2026-09-05",
          amount,
          reason: "Devolución parcial",
          type: "refund",
          tenderRefund: { method: "Tarjeta", amount },
        }),
      ]);

      expect(rejected).toHaveLength(0);

      const bankBalance = accountBalance(state, "a-bank", CURRENCY);
      expect(bankBalance.minor).toBe(-amount.minor);

      const arBalance = accountBalance(state, "a-ar", CURRENCY);
      expect(arBalance.minor).toBe(amount.minor);
    });

    it("no mapea el método Crédito a una cuenta activa arbitraria", () => {
      const amount = money(5000, CURRENCY);
      const { state, rejected } = project([
        evt("accounting.account_created", { accountId: "a-cash", code: "1100", name: "Caja", type: "activo" }),
        evt("accounting.account_created", { accountId: "a-ar", code: "1200", name: "Cuentas por Cobrar", type: "activo" }),
        issuedInvoice("inv-legacy-credit", 10000),
        evt("invoice.refunded", {
          creditNoteId: "ncr-legacy-credit",
          invoiceId: "inv-legacy-credit",
          date: "2026-09-05",
          amount,
          reason: "Crédito a favor",
          type: "refund",
          tenderRefund: { method: "Crédito", amount },
        }),
      ]);
      expect(rejected).toHaveLength(0);
      // Crédito de cliente no es una salida de caja; debe usar store_credit, no fallback a Caja.
      expect(accountBalance(state, "a-cash", CURRENCY).minor).toBe(0);
    });

    it("reembolso sin cuentas configuradas: no rechaza el evento (fallback seguro)", () => {
      const amount = money(10000, CURRENCY);
      const { state, rejected } = project([
        issuedInvoice("inv-3", 10000),
        evt("invoice.paid", { invoiceId: "inv-3", paidAt: "2026-09-01T14:00:00.000Z", paymentMethod: "Efectivo" }),
        evt("invoice.refunded", {
          creditNoteId: "ncr-3",
          invoiceId: "inv-3",
          date: "2026-09-05",
          amount,
          reason: "Devolución",
          type: "refund",
          tenderRefund: { method: "Efectivo", amount },
        }),
      ]);

      expect(rejected).toHaveLength(0);
      // Sin cuentas no hay asiento, pero el refund se registra igual (no debe romper el flujo)
      expect(state.journalEntries.size).toBe(0);
    });
  });
});