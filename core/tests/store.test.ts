import { describe, expect, it } from "vitest";
import {
  allCreditNotes,
  computeInvoiceTotals,
  creditNotesInPeriod,
  creditNotesFor,
  discountSummary,
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
  type State,
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

const refundPayload = (creditNoteId: string, invoiceId: string, day: number) => ({
  creditNoteId,
  invoiceId,
  date: at(day),
  amount: fromDecimal("50.00", "GTQ"),
  reason: "Devolucion",
  type: "store_credit" as const,
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

describe("Descuentos del periodo", () => {
  const issuedWithLines = (invoiceId: string, number: number, date: string, lines: InvoiceLine[], currency = "GTQ") => ({
    invoiceId,
    series: "A",
    number,
    date,
    currency,
    lines,
    totals: totalsSnapshot(computeInvoiceTotals(lines, currency)),
    partnerName: "Cliente Uno",
    partnerTaxId: "CF",
  });

  const plainLine = (price: string): InvoiceLine => ({
    description: "Consultoria",
    quantity: 1,
    unitPrice: fromDecimal(price, "GTQ"),
    taxRate: 12,
  });

  it("devuelve cero cuando no hay facturas en el mes", () => {
    const { state, rejected } = project([
      evt("invoice.issued", 10, issuedWithLines("inv_0", 1, "2026-08-10", [plainLine("100.00")])),
    ]);
    expect(rejected).toEqual([]);
    const summary = discountSummary(state, "2026-09", "GTQ");
    expect(summary.total.minor).toBe(0);
    expect(summary.total.currency).toBe("GTQ");
    expect(summary.documents).toBe(0);
  });

  it("suma el descuento porcentual por línea y cuenta el documento", () => {
    const discounted: InvoiceLine[] = [{ ...plainLine("100.00"), discount: { percent: 10 } }];
    const { state, rejected } = project([
      evt("invoice.issued", 10, issuedWithLines("inv_1", 1, "2026-08-10", discounted)),
    ]);
    expect(rejected).toEqual([]);
    const summary = discountSummary(state, "2026-08", "GTQ");
    expect(summary.total.minor).toBe(1000); // 10% de 100.00 = 10.00
    expect(summary.total.currency).toBe("GTQ");
    expect(summary.documents).toBe(1);
  });

  it("suma el descuento fijo por línea", () => {
    const discounted: InvoiceLine[] = [{ ...plainLine("100.00"), discount: { amount: fromDecimal("5.00", "GTQ") } }];
    const { state, rejected } = project([
      evt("invoice.issued", 10, issuedWithLines("inv_2", 2, "2026-08-10", discounted)),
    ]);
    expect(rejected).toEqual([]);
    const summary = discountSummary(state, "2026-08", "GTQ");
    expect(summary.total.minor).toBe(500); // 5.00 fijos
    expect(summary.documents).toBe(1);
  });

  it("combina descuento porcentual y fijo en la misma línea", () => {
    const discounted: InvoiceLine[] = [
      { ...plainLine("100.00"), discount: { percent: 10, amount: fromDecimal("5.00", "GTQ") } },
    ];
    const { state, rejected } = project([
      evt("invoice.issued", 10, issuedWithLines("inv_3", 3, "2026-08-10", discounted)),
    ]);
    expect(rejected).toEqual([]);
    const summary = discountSummary(state, "2026-08", "GTQ");
    expect(summary.total.minor).toBe(1500); // 10.00 + 5.00
    expect(summary.documents).toBe(1);
  });

  it("excluye facturas sin descuento, de otro mes y de otra moneda", () => {
    const usdLine: InvoiceLine = {
      description: "Servicio USD",
      quantity: 1,
      unitPrice: fromDecimal("100.00", "USD"),
      taxRate: 0,
      discount: { percent: 10 },
    };
    const { state, rejected } = project([
      evt("invoice.issued", 10, issuedWithLines("inv_a", 1, "2026-08-10", [{ ...plainLine("100.00"), discount: { percent: 10 } }])),
      evt("invoice.issued", 10, issuedWithLines("inv_b", 2, "2026-08-11", [plainLine("100.00")])),
      evt("invoice.issued", 10, issuedWithLines("inv_c", 3, "2026-09-01", [{ ...plainLine("100.00"), discount: { percent: 10 } }])),
      evt("invoice.issued", 10, issuedWithLines("inv_d", 4, "2026-08-12", [usdLine], "USD")),
    ]);
    expect(rejected).toEqual([]);
    const summary = discountSummary(state, "2026-08", "GTQ");
    expect(summary.total.minor).toBe(1000); // solo inv_a
    expect(summary.documents).toBe(1);
  });

  it("no tumba el reporte si una factura histórica tiene una línea con descuento inválido", () => {
    // Datos históricos corruptos no debieran entrar por eventos (la validación de
    // dominio los rechazaria), pero si llegan al journal, la consulta de reportes
    // no puede lanzar y matar la vista: omite la linea y sigue.
    const { state } = project([
      evt("invoice.issued", 10, issuedWithLines("inv_corrupta", 1, "2026-08-10", [plainLine("100.00")])),
    ]);
    const invoice = state.invoices.get("inv_corrupta")!;
    const badLine: InvoiceLine = { ...plainLine("100.00"), discount: { percent: 150 } };
    const corrupt: State = {
      ...state,
      invoices: new Map(state.invoices).set("inv_corrupta", { ...invoice, lines: [badLine] }),
    };
    const summary = discountSummary(corrupt, "2026-08", "GTQ");
    expect(summary.total.minor).toBe(0);
    expect(summary.documents).toBe(0);
  });

  it("salta solo la línea corrupta y conserva el resto del periodo", () => {
    const { state } = project([
      evt("invoice.issued", 10, issuedWithLines("inv_bad", 1, "2026-08-10", [plainLine("100.00")])),
      evt("invoice.issued", 10, issuedWithLines("inv_ok", 2, "2026-08-11", [{ ...plainLine("100.00"), discount: { percent: 10 } }])),
    ]);
    const invoice = state.invoices.get("inv_bad")!;
    const badLine: InvoiceLine = { ...plainLine("100.00"), discount: { amount: fromDecimal("5000.00", "GTQ") } };
    const corrupt: State = {
      ...state,
      invoices: new Map(state.invoices).set("inv_bad", { ...invoice, lines: [badLine] }),
    };
    const summary = discountSummary(corrupt, "2026-08", "GTQ");
    expect(summary.total.minor).toBe(1000); // solo inv_ok
    expect(summary.documents).toBe(1);
  });

  it("reporta el descuento bruto aunque la factura haya sido acreditada en el mismo mes", () => {
    // Semantica decidida: discountSummary mide el descuento concedido en bruto
    // (no netea notas de credito), a diferencia de totalInvoiced. Una NC en el
    // mismo mes NO reduce el descuento reportado.
    const discounted: InvoiceLine[] = [{ ...plainLine("100.00"), discount: { percent: 10 } }];
    const { state, rejected } = project([
      evt("invoice.issued", 10, issuedWithLines("inv_nc", 1, "2026-08-10", discounted)),
      evt("invoice.credited", 11, {
        creditNoteId: "cn_1",
        invoiceId: "inv_nc",
        date: "2026-08-12",
        amount: fromDecimal("90.00", "GTQ"),
        reason: "Descuento",
      }),
    ]);
    expect(rejected).toEqual([]);
    const summary = discountSummary(state, "2026-08", "GTQ");
    expect(summary.total.minor).toBe(1000); // 10% bruto, no 0 por la NC
    expect(summary.documents).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Orden temporal tolerable a dependencias (regresion del journal real)
//
// Caso real (HighSoftTech, 2026-09): `invoice.refunded` con `at` ANTERIOR al
// `invoice.issued` de su propia factura (sync/relojes entre dispositivos puede
// invertir el orden de escritura). La proyeccion ordenada por `at` procesaba el
// refund primero -> rechazo "Factura inexistente" permanente aunque la factura
// SÍ llega mas tarde en el journal.
// ---------------------------------------------------------------------------
describe("Reconstruccion tolerante a dependencias", () => {
  it("aplica un refund cuyo at es anterior al issued de su factura", () => {
    const { state, rejected } = project([
      evt("invoice.refunded", 2, refundPayload("ncr_1", "inv_1", 2)),
      evt("invoice.issued", 4, issuedPayload("inv_1", 1)),
    ]);
    expect(rejected).toEqual([]);
    expect(state.invoices.get("inv_1")).toBeDefined();
    expect(state.creditNotes.has("ncr_1")).toBe(true);
  });

  it("resuelve dependencias en cadena (refund + paid antes que su issued)", () => {
    const { state, rejected } = project([
      evt("invoice.refunded", 2, refundPayload("ncr_1", "inv_1", 2)),
      evt("invoice.paid", 3, { invoiceId: "inv_1", paidAt: at(3), paymentMethod: "efectivo" }),
      evt("invoice.issued", 4, issuedPayload("inv_1", 1)),
    ]);
    expect(rejected).toEqual([]);
    const invoice = state.invoices.get("inv_1")!;
    expect(invoice.status).toBe("paid");
    expect(invoice.creditNoteIds).toContain("ncr_1");
  });

  it("no oculta un refund de factura que nunca se emite (sigue en rejected)", () => {
    const { state, rejected } = project([
      evt("invoice.refunded", 2, refundPayload("ncr_1", "inv_ghost", 2)),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["not_found"]);
    expect(state.creditNotes.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Listado de notas de crédito (vista CREDIT_NOTES_VIEW_TYPE)
// ---------------------------------------------------------------------------
describe("allCreditNotes", () => {
  it("lista todas las notas de la empresa activa ordenadas por fecha desc", () => {
    const { state, rejected } = project([
      evt("invoice.issued", 1, issuedPayload("inv_1", 1)),
      evt("invoice.refunded", 2, refundPayload("ncr_1", "inv_1", 2)),
      evt("invoice.refunded", 3, refundPayload("ncr_2", "inv_1", 3)),
    ]);
    expect(rejected).toEqual([]);
    const notes = allCreditNotes(state);
    expect(notes.map((n) => n.id)).toEqual(["ncr_2", "ncr_1"]);
    expect(notes.every((n) => n.type === "store_credit")).toBe(true);
  });

  it("incluye notas base (credited) sin type junto a las extendidas", () => {
    const { state } = project([
      evt("invoice.issued", 1, issuedPayload("inv_1", 1)),
      evt("invoice.credited", 2, {
        creditNoteId: "ncr_base",
        invoiceId: "inv_1",
        date: "2026-08-10",
        amount: fromDecimal("30.00", "GTQ"),
        reason: "Descuento",
      }),
      evt("invoice.refunded", 3, refundPayload("ncr_ext", "inv_1", 3)),
    ]);
    const notes = allCreditNotes(state);
    expect(notes).toHaveLength(2);
    const base = notes.find((n) => n.id === "ncr_base")!;
    const ext = notes.find((n) => n.id === "ncr_ext")!;
    expect(base.type).toBeUndefined();
    expect(ext.type).toBe("store_credit");
  });

  it("expone los campos extendidos (tenderRefund/exchangeLines) si existen", () => {
    const { state } = project([
      evt("invoice.issued", 1, issuedPayload("inv_1", 1)),
      evt("invoice.refunded", 3, {
        ...refundPayload("ncr_x", "inv_1", 3),
        type: "refund",
        tenderRefund: { method: "efectivo", amount: fromDecimal("50.00", "GTQ") },
      }),
    ]);
    const note = allCreditNotes(state)[0]!;
    expect(note.type).toBe("refund");
    expect(note.tenderRefund?.method).toBe("efectivo");
  });
});

describe("creditNotesInPeriod", () => {
  it("filtra las notas por mes, sin traer las de otros meses", () => {
    const { state } = project([
      evt("invoice.issued", 1, issuedPayload("inv_1", 1)),
      // Nota en agosto (mes del fixture)
      evt("invoice.refunded", 3, { ...refundPayload("ncr_ago", "inv_1", 3), date: "2026-08-03" }),
      // Nota en septiembre
      evt("invoice.refunded", 32, { ...refundPayload("ncr_sep", "inv_1", 32), date: "2026-09-01" }),
      // Nota en julio
      evt("invoice.refunded", 33, { ...refundPayload("ncr_jul", "inv_1", 33), date: "2026-07-01" }),
    ]);
    const notes = creditNotesInPeriod(state, "2026-08");
    expect(notes.map((n) => n.id)).toEqual(["ncr_ago"]);
  });

  it("solo toma notas existentes (rechazadas o pendientes no aparecen)", () => {
    const { state } = project([
      evt("invoice.refunded", 2, refundPayload("ncr_ghost", "inv_ghost", 2)),
    ]);
    expect(creditNotesInPeriod(state, "2026-08")).toEqual([]);
  });
});
