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
} from "@octasuite/core";
import { money, zero } from "@octasuite/core";

const CURRENCY = "GTQ" as const;

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
});