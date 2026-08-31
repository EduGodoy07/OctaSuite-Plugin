import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  creditNotesFor,
  expensesByCategory,
  invoiceNetTotal,
  fromDecimal,
  nextNumberFor,
  project,
  receiptData,
  seriesGaps,
  totalExpenses,
  totalInvoiced,
  totalsSnapshot,
  type AnyEvent,
  type InvoiceLine,
} from "../src/index.js";

let seq = 0;
const at = (day: number) => `2026-08-${day.toString().padStart(2, "0")}T12:00:00.000Z`;
const evt = <T extends AnyEvent["type"]>(type: T, day: number, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: at(day), v: 1, type, payload } as AnyEvent);

const lines: InvoiceLine[] = [
  { description: "Consultoria", quantity: 1, unitPrice: fromDecimal("1000.00", "GTQ"), taxRate: 12 },
];
const issuedPayload = (invoiceId: string, number: number) => ({
  invoiceId,
  series: "A",
  number,
  date: "2026-08-10",
  currency: "GTQ",
  lines,
  totals: totalsSnapshot(computeInvoiceTotals(lines, "GTQ")),
  partnerName: "Cliente Uno",
  partnerTaxId: "CF",
});

describe("Proyeccion de gastos", () => {
  it("reproduce el ciclo de vida completo", () => {
    const { state, rejected } = project([
      evt("expense.created", 1, { expenseId: "exp_1", name: "Taxi", amount: fromDecimal("50.00", "GTQ"), date: "2026-08-01", categoryId: "cat_transport" }),
      evt("expense.transitioned", 2, { expenseId: "exp_1", to: "submitted" }),
      evt("expense.transitioned", 3, { expenseId: "exp_1", to: "approved" }),
      evt("expense.transitioned", 4, { expenseId: "exp_1", to: "paid" }),
    ]);
    expect(rejected).toEqual([]);
    const expense = state.expenses.get("exp_1")!;
    expect(expense.status).toBe("paid");
    expect(expense.approvedAt).toBe(at(3));
    expect(expense.paidAt).toBe(at(4));
  });

  it("rechaza la edicion de un gasto que ya salio de borrador", () => {
    const { rejected } = project([
      evt("expense.created", 1, { expenseId: "exp_1", name: "Taxi", amount: fromDecimal("50.00", "GTQ"), date: "2026-08-01" }),
      evt("expense.transitioned", 2, { expenseId: "exp_1", to: "submitted" }),
      evt("expense.updated", 3, { expenseId: "exp_1", changes: { name: "Otro" } }),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["not_editable"]);
  });

  it("rechaza una transicion imposible sin abortar la carga", () => {
    const { state, rejected } = project([
      evt("expense.created", 1, { expenseId: "exp_1", name: "Taxi", amount: fromDecimal("50.00", "GTQ"), date: "2026-08-01" }),
      evt("expense.transitioned", 2, { expenseId: "exp_1", to: "paid" }),
      evt("expense.created", 3, { expenseId: "exp_2", name: "Almuerzo", amount: fromDecimal("75.00", "GTQ"), date: "2026-08-03" }),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["illegal_transition"]);
    expect(state.expenses.get("exp_1")!.status).toBe("draft");
    expect(state.expenses.size).toBe(2); // el evento posterior si se aplico
  });

  it("excluye los rechazados del total del periodo", () => {
    const { state } = project([
      evt("expense.created", 1, { expenseId: "exp_1", name: "Taxi", amount: fromDecimal("50.00", "GTQ"), date: "2026-08-01", categoryId: "cat_t" }),
      evt("expense.created", 2, { expenseId: "exp_2", name: "Cena", amount: fromDecimal("300.00", "GTQ"), date: "2026-08-02", categoryId: "cat_m" }),
      evt("expense.transitioned", 3, { expenseId: "exp_2", to: "submitted" }),
      evt("expense.transitioned", 4, { expenseId: "exp_2", to: "rejected" }),
      evt("expense.created", 5, { expenseId: "exp_3", name: "Mes pasado", amount: fromDecimal("999.00", "GTQ"), date: "2026-07-30" }),
    ]);
    expect(totalExpenses(state, "2026-08", "GTQ").minor).toBe(5000);
    expect(expensesByCategory(state, "2026-08", "GTQ").get("cat_t")?.minor).toBe(5000);
    expect(expensesByCategory(state, "2026-08", "GTQ").has("cat_m")).toBe(false);
  });

  it("un gasto archivado desaparece de los totales", () => {
    const { state } = project([
      evt("expense.created", 1, { expenseId: "exp_1", name: "Taxi", amount: fromDecimal("50.00", "GTQ"), date: "2026-08-01" }),
      evt("expense.archived", 2, { expenseId: "exp_1" }),
    ]);
    expect(totalExpenses(state, "2026-08", "GTQ").minor).toBe(0);
  });
});

describe("Proyeccion de facturas", () => {
  it("emite, cobra y calcula el facturado del periodo", () => {
    const { state, rejected } = project([
      evt("invoice.issued", 10, issuedPayload("inv_1", 1)),
      evt("invoice.paid", 11, { invoiceId: "inv_1", paidAt: at(11), paymentMethod: "transferencia" }),
    ]);
    expect(rejected).toEqual([]);
    const invoice = state.invoices.get("inv_1")!;
    expect(invoice.displayNumber).toBe("A-0001");
    expect(invoice.totals.total.minor).toBe(112000);
    expect(invoice.status).toBe("paid");
    expect(totalInvoiced(state, "2026-08", "GTQ").minor).toBe(112000);
    expect(nextNumberFor(state, "A")).toBe(2);
  });

  it("rechaza un correlativo duplicado (el caso de dos dispositivos offline)", () => {
    const { state, rejected } = project([
      evt("invoice.issued", 10, issuedPayload("inv_mac", 1)),
      evt("invoice.issued", 10, issuedPayload("inv_iphone", 1)),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["number_taken"]);
    expect(rejected[0]?.reason).toMatch(/renumerar/);
    expect(state.invoices.size).toBe(1);
  });

  it("reporta huecos en la serie", () => {
    const { state } = project([
      evt("invoice.issued", 10, issuedPayload("inv_1", 1)),
      evt("invoice.issued", 10, issuedPayload("inv_3", 3)),
    ]);
    expect(seriesGaps(state, "A")).toEqual([2]);
  });

  it("no paga dos veces la misma factura", () => {
    const { rejected } = project([
      evt("invoice.issued", 10, issuedPayload("inv_1", 1)),
      evt("invoice.paid", 11, { invoiceId: "inv_1", paidAt: at(11) }),
      evt("invoice.paid", 12, { invoiceId: "inv_1", paidAt: at(12) }),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["already_paid"]);
  });

  it("acredita parcialmente y bloquea el exceso", () => {
    const { state, rejected } = project([
      evt("invoice.issued", 10, issuedPayload("inv_1", 1)),
      evt("invoice.credited", 11, { creditNoteId: "cn_1", invoiceId: "inv_1", date: "2026-08-11", amount: fromDecimal("100.00", "GTQ"), reason: "Descuento" }),
      evt("invoice.credited", 12, { creditNoteId: "cn_2", invoiceId: "inv_1", date: "2026-08-12", amount: fromDecimal("1100.00", "GTQ"), reason: "Anulacion" }),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["credit_note.exceeds_invoice"]);
    const invoice = state.invoices.get("inv_1")!;
    expect(invoice.creditedTotal.minor).toBe(10000);
    expect(invoice.creditNoteIds).toEqual(["cn_1"]);
    expect(totalInvoiced(state, "2026-08", "GTQ").minor).toBe(102000);
  });

  it("congela los datos del cliente al emitir", () => {
    const { state } = project([
      evt("partner.created", 1, { partnerId: "par_1", name: "Cliente Original", accountType: "company", taxId: "42932-5" }),
      evt("invoice.issued", 10, { ...issuedPayload("inv_1", 1), partnerId: "par_1", partnerName: "Cliente Original", partnerTaxId: "42932-5" }),
      evt("partner.updated", 11, { partnerId: "par_1", changes: { name: "Cliente Renombrado" } }),
    ]);
    expect(state.partners.get("par_1")!.name).toBe("Cliente Renombrado");
    expect(state.invoices.get("inv_1")!.partnerName).toBe("Cliente Original");
  });
});

describe("Notas de crédito de una factura", () => {
  it("devuelve las notas en orden de emisión y calcula el neto", () => {
    const { state } = project([
      evt("invoice.issued", 10, issuedPayload("inv_1", 1)),
      evt("invoice.credited", 11, {
        creditNoteId: "cn_1",
        invoiceId: "inv_1",
        date: "2026-08-11",
        amount: fromDecimal("100.00", "GTQ"),
        reason: "Descuento",
      }),
      evt("invoice.credited", 12, {
        creditNoteId: "cn_2",
        invoiceId: "inv_1",
        date: "2026-08-12",
        amount: fromDecimal("20.00", "GTQ"),
        reason: "Producto devuelto",
      }),
    ]);
    const notes = creditNotesFor(state, "inv_1");
    expect(notes.map((n) => n.id)).toEqual(["cn_1", "cn_2"]);
    expect(notes.map((n) => n.reason)).toEqual(["Descuento", "Producto devuelto"]);
    // 1000 + 12% = 1120.00, menos 120.00 acreditados
    expect(invoiceNetTotal(state.invoices.get("inv_1")!).minor).toBe(100000);
  });

  it("no devuelve nada para una factura inexistente", () => {
    const { state } = project([]);
    expect(creditNotesFor(state, "inv_fantasma")).toEqual([]);
  });
});

describe("receiptData()", () => {
  const company = {
    name: "Mi Empresa",
    taxId: "12345678",
    address: "Ciudad, Guatemala",
    phone: "2222-3333",
    email: "info@empresa.com",
    logo: "octasuite-data/logo.png",
  };

  it("devuelve los datos correctos de una factura pagada", () => {
    const lines: InvoiceLine[] = [
      { description: "Producto A", quantity: 2, unitPrice: fromDecimal("100.00", "GTQ"), taxRate: 12 },
      { description: "Producto B", quantity: 1, unitPrice: fromDecimal("50.00", "GTQ"), taxRate: 0 },
    ];
    const { state } = project([
      evt("invoice.issued", 10, {
        invoiceId: "inv_rc",
        series: "A",
        number: 1,
        date: "2026-08-10",
        currency: "GTQ",
        lines,
        totals: totalsSnapshot(computeInvoiceTotals(lines, "GTQ")),
        partnerName: "Cliente Test",
        partnerTaxId: "CF",
      }),
      evt("invoice.paid", 11, {
        invoiceId: "inv_rc",
        paymentMethod: "Efectivo",
      }),
    ]);

    const invoice = state.invoices.get("inv_rc")!;
    const data = receiptData(invoice, company, "Gracias por su compra");

    expect(data.company.name).toBe("Mi Empresa");
    expect(data.company.taxId).toBe("12345678");
    expect(data.lines).toHaveLength(2);
    expect(data.lines[0]!.description).toBe("Producto A");
    expect(data.lines[0]!.quantity).toBe(2);
    expect(data.lines[0]!.subtotal.minor).toBe(20000); // 2 × 100.00
    expect(data.lines[0]!.tax.minor).toBe(2400);      // 12% de 200.00
    expect(data.lines[1]!.taxRate).toBe(0);
    expect(data.lines[1]!.tax.minor).toBe(0);
    // Total: (200 + 24) + (50 + 0) = 274.00
    expect(data.total.minor).toBe(27400);
    expect(data.footer).toBe("Gracias por su compra");
  });

  it("usa footer vacío si no se provee", () => {
    const lines: InvoiceLine[] = [
      { description: "Servicio", quantity: 1, unitPrice: fromDecimal("100.00", "GTQ"), taxRate: 12 },
    ];
    const { state } = project([
      evt("invoice.issued", 10, {
        invoiceId: "inv_rc2",
        series: "B",
        number: 1,
        date: "2026-08-10",
        currency: "GTQ",
        lines,
        totals: totalsSnapshot(computeInvoiceTotals(lines, "GTQ")),
        partnerName: "Otro Cliente",
        partnerTaxId: "CF",
      }),
    ]);

    const invoice = state.invoices.get("inv_rc2")!;
    const data = receiptData(invoice, company, "");
    expect(data.footer).toBe("");
  });
});
