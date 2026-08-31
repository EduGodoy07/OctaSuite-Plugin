import { describe, expect, it } from "vitest";
import {
  addDays,
  computeInvoiceTotals,
  customerMetrics,
  dailyExpenses,
  monthlySeries,
  shiftMonth,
  expensesVsPreviousWeekday,
  fromDecimal,
  paymentMix,
  pendingApprovalCount,
  previousWeekday,
  project,
  totalsSnapshot,
  UNSPECIFIED_METHOD,
  unpaidInvoices,
  type AnyEvent,
  type InvoiceLine,
} from "../src/index.js";

let seq = 0;
const evt = (type: AnyEvent["type"], day: number, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: `2026-08-${String(day).padStart(2, "0")}T12:00:00.000Z`, v: 1, type, payload } as AnyEvent);

const gasto = (id: string, date: string, amount: string) =>
  evt("expense.created", 1, { expenseId: id, name: `Gasto ${id}`, amount: fromDecimal(amount, "GTQ"), date });

const lines = (price: string): InvoiceLine[] => [
  { description: "Servicio", quantity: 1, unitPrice: fromDecimal(price, "GTQ"), taxRate: 12 },
];

const factura = (id: string, number: number, price: string, taxId: string, partnerId?: string) => {
  const l = lines(price);
  return evt("invoice.issued", 10, {
    invoiceId: id,
    series: "A",
    number,
    date: "2026-08-14",
    currency: "GTQ",
    lines: l,
    totals: totalsSnapshot(computeInvoiceTotals(l, "GTQ")),
    partnerName: `Cliente ${taxId}`,
    partnerTaxId: taxId,
    ...(partnerId ? { partnerId } : {}),
  });
};

describe("Aritmetica de fechas", () => {
  it("cruza fin de mes y ano bisiesto", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("el mismo dia de la semana anterior cae siete dias atras", () => {
    // 2026-08-21 es viernes; el viernes previo es el 14.
    expect(previousWeekday("2026-08-21")).toBe("2026-08-14");
    expect(previousWeekday("2026-09-03")).toBe("2026-08-27");
  });
});

describe("Comparacion contra el mismo dia de la semana", () => {
  it("calcula la variacion entre viernes y viernes", () => {
    const { state } = project([gasto("a", "2026-08-14", "100.00"), gasto("b", "2026-08-21", "150.00")]);
    const cmp = expensesVsPreviousWeekday(state, "2026-08-21", "GTQ");
    expect(cmp.current.minor).toBe(15000);
    expect(cmp.previous.minor).toBe(10000);
    expect(cmp.deltaPercent).toBeCloseTo(50, 6);
  });

  it("no divide por cero cuando la semana pasada no hubo movimiento", () => {
    const { state } = project([gasto("a", "2026-08-21", "150.00")]);
    const cmp = expensesVsPreviousWeekday(state, "2026-08-21", "GTQ");
    expect(cmp.previous.minor).toBe(0);
    expect(cmp.deltaPercent).toBeNull();
  });

  it("ignora los gastos rechazados", () => {
    const { state } = project([
      gasto("a", "2026-08-21", "150.00"),
      evt("expense.transitioned", 21, { expenseId: "a", to: "submitted" }),
      evt("expense.transitioned", 21, { expenseId: "a", to: "rejected" }),
    ]);
    expect(expensesVsPreviousWeekday(state, "2026-08-21", "GTQ").current.minor).toBe(0);
  });
});

describe("Metricas de cliente", () => {
  it("no cuenta al consumidor final como cliente identificable", () => {
    const { state } = project([factura("i1", 1, "100.00", "CF"), factura("i2", 2, "200.00", "CF")]);
    const m = customerMetrics(state, "2026-08", "GTQ");
    expect(m.tickets).toBe(2);
    expect(m.identified).toBe(0);
    expect(m.returningRate).toBeNull();
    // El ticket promedio si usa los dos documentos: (112.00 + 224.00) / 2
    expect(m.avgTicket.minor).toBe(16800);
  });

  it("detecta al cliente que vuelve", () => {
    const { state } = project([
      factura("i1", 1, "100.00", "42932-5"),
      factura("i2", 2, "100.00", "42932-5"),
      factura("i3", 3, "100.00", "3602978-5"),
    ]);
    const m = customerMetrics(state, "2026-08", "GTQ");
    expect(m.identified).toBe(2);
    expect(m.returning).toBe(1);
    expect(m.returningRate).toBeCloseTo(0.5, 6);
  });

  it("usa el id del contacto cuando existe, no el NIT", () => {
    const { state } = project([
      factura("i1", 1, "100.00", "CF", "par_1"),
      factura("i2", 2, "100.00", "CF", "par_1"),
    ]);
    const m = customerMetrics(state, "2026-08", "GTQ");
    expect(m.identified).toBe(1);
    expect(m.returning).toBe(1);
  });

  it("devuelve ceros sin datos, sin lanzar", () => {
    const { state } = project([]);
    const m = customerMetrics(state, "2026-08", "GTQ");
    expect(m).toMatchObject({ tickets: 0, identified: 0, returning: 0, returningRate: null });
    expect(m.avgTicket.minor).toBe(0);
  });
});

describe("Mezcla de formas de pago", () => {
  it("solo cuenta lo efectivamente cobrado", () => {
    const { state } = project([
      factura("i1", 1, "100.00", "CF"),
      evt("invoice.paid", 15, { invoiceId: "i1", paidAt: "2026-08-15T12:00:00.000Z", paymentMethod: "efectivo" }),
      factura("i2", 2, "100.00", "CF"), // emitida y no cobrada: no entra en la mezcla
    ]);
    const mix = paymentMix(state, "2026-08", "GTQ");
    expect(mix.total.minor).toBe(11200);
    expect(mix.slices).toHaveLength(1);
    expect(mix.slices[0]).toMatchObject({ method: "efectivo" });
    expect(mix.slices[0]?.share).toBe(1);
  });

  it("reparte las proporciones y ordena por monto", () => {
    const { state } = project([
      factura("i1", 1, "300.00", "CF"),
      evt("invoice.paid", 15, { invoiceId: "i1", paidAt: "2026-08-15T12:00:00.000Z", paymentMethod: "tarjeta" }),
      factura("i2", 2, "100.00", "CF"),
      evt("invoice.paid", 16, { invoiceId: "i2", paidAt: "2026-08-16T12:00:00.000Z", paymentMethod: "efectivo" }),
    ]);
    const mix = paymentMix(state, "2026-08", "GTQ");
    expect(mix.slices.map((s) => s.method)).toEqual(["tarjeta", "efectivo"]);
    expect(mix.slices[0]?.share).toBeCloseTo(0.75, 6);
    expect(mix.slices.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 6);
  });

  it("agrupa lo cobrado sin forma de pago declarada", () => {
    const { state } = project([
      factura("i1", 1, "100.00", "CF"),
      evt("invoice.paid", 15, { invoiceId: "i1", paidAt: "2026-08-15T12:00:00.000Z" }),
    ]);
    expect(paymentMix(state, "2026-08", "GTQ").slices[0]?.method).toBe(UNSPECIFIED_METHOD);
  });
});

describe("Colas de trabajo", () => {
  it("cuenta lo que espera aprobacion", () => {
    const { state } = project([
      gasto("a", "2026-08-01", "10.00"),
      evt("expense.transitioned", 2, { expenseId: "a", to: "submitted" }),
      gasto("b", "2026-08-02", "20.00"),
    ]);
    expect(pendingApprovalCount(state)).toBe(1);
  });

  it("suma el saldo de lo emitido y no cobrado, neto de notas de credito", () => {
    const { state } = project([
      factura("i1", 1, "100.00", "CF"),
      evt("invoice.credited", 16, {
        creditNoteId: "cn1",
        invoiceId: "i1",
        date: "2026-08-16",
        amount: fromDecimal("12.00", "GTQ"),
        reason: "Descuento",
      }),
      factura("i2", 2, "100.00", "CF"),
      evt("invoice.paid", 15, { invoiceId: "i2", paidAt: "2026-08-15T12:00:00.000Z" }),
    ]);
    const unpaid = unpaidInvoices(state, "2026-08", "GTQ");
    expect(unpaid.count).toBe(1);
    expect(unpaid.amount.minor).toBe(10000); // 112.00 - 12.00
  });
});

describe("Series para gráficos", () => {
  it("cuenta meses hacia atrás cruzando el año", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-08", 0)).toBe("2026-08");
  });

  it("rellena con cero los meses sin movimiento", () => {
    const { state } = project([gasto("a", "2026-08-10", "100.00")]);
    const series = monthlySeries(state, "2026-08", 3, "GTQ");
    expect(series.map((p) => p.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(series.map((p) => p.expenses.minor)).toEqual([0, 0, 10000]);
  });

  it("da un punto por cada día del mes, incluidos los vacíos", () => {
    const { state } = project([gasto("a", "2026-02-03", "50.00"), gasto("b", "2026-02-03", "25.00")]);
    const days = dailyExpenses(state, "2026-02", "GTQ");
    expect(days).toHaveLength(28);
    expect(days[0]?.amount.minor).toBe(0);
    expect(days[2]?.date).toBe("2026-02-03");
    expect(days[2]?.amount.minor).toBe(7500);
  });

  it("respeta los días reales de un mes bisiesto", () => {
    const { state } = project([]);
    expect(dailyExpenses(state, "2024-02", "GTQ")).toHaveLength(29);
  });
});
