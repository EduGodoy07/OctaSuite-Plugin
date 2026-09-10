import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  fromDecimal,
  project,
  totalsSnapshot,
  UNSPECIFIED_METHOD,
  type AnyEvent,
  type InvoiceLine,
} from "../src/index.js";

/**
 * Consolidación multi-empresa: KPIs de N estados de empresas distintas,
 * sumados para dashboards y reportes de grupo. Cada empresa proyecta su
 * propio State (ids y correlativos locales); acá solo se agregan métricas,
 * nunca se fusionan eventos ni se mezclan correlativos.
 */

let seq = 0;
const evt = (type: AnyEvent["type"], day: number, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: `2026-08-${String(day).padStart(2, "0")}T12:00:00.000Z`, v: 1, type, payload } as AnyEvent);

const gasto = (id: string, date: string, amount: string, categoryId?: string) =>
  evt("expense.created", 1, {
    expenseId: id,
    name: `Gasto ${id}`,
    amount: fromDecimal(amount, "GTQ"),
    date,
    ...(categoryId ? { categoryId } : {}),
  });

const categoria = (id: string, name: string, code: string) =>
  evt("category.created", 1, { categoryId: id, name, code });

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

const cobro = (invoiceId: string, day: number, amount: string) =>
  evt("invoice.paid", day, {
    invoiceId,
    amount: fromDecimal(amount, "GTQ"),
    paymentMethod: "Efectivo",
    paidAt: `2026-08-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    shiftId: "caja-1",
  });

describe("consolidatedTotalInvoiced", () => {
  it("suma el facturado de dos empresas en el mismo periodo", async () => {
    const { consolidatedTotalInvoiced } = await import("../src/consolidation.js");
    const a = project([factura("a1", 1, "100.00", "CF")]).state;
    const b = project([factura("b1", 1, "250.00", "CF")]).state;
    const total = consolidatedTotalInvoiced([a, b], "2026-08", "GTQ");
    // totalInvoiced suma totals.total (IVA incluido): 112.00 + 280.00
    expect(total.minor).toBe(39200);
  });

  it("devuelve cero cuando no hay estados", async () => {
    const { consolidatedTotalInvoiced } = await import("../src/consolidation.js");
    expect(consolidatedTotalInvoiced([], "2026-08", "GTQ").minor).toBe(0);
  });
});

describe("consolidatedTotalExpenses", () => {
  it("suma gastos de varias empresas y excluye rechazados", async () => {
    const { consolidatedTotalExpenses } = await import("../src/consolidation.js");
    const a = project([
      gasto("a1", "2026-08-03", "100.00"),
      gasto("a2", "2026-08-05", "50.00"),
    ]).state;
    const b = project([
      gasto("b1", "2026-08-04", "30.00"),
    ]).state;
    expect(consolidatedTotalExpenses([a, b], "2026-08", "GTQ").minor).toBe(18000);
  });

  it("filtra por moneda al sumar", async () => {
    const { consolidatedTotalExpenses } = await import("../src/consolidation.js");
    const a = project([
      { ...gasto("a1", "2026-08-03", "100.00"), payload: { ...gasto("a1", "2026-08-03", "100.00").payload, amount: fromDecimal("100.00", "USD") } },
    ]).state;
    const b = project([gasto("b1", "2026-08-04", "30.00")]).state;
    expect(consolidatedTotalExpenses([a, b], "2026-08", "GTQ").minor).toBe(3000);
  });
});

describe("consolidatedUnpaid", () => {
  it("suma documentos y monto pendiente entre empresas", async () => {
    const { consolidatedUnpaid } = await import("../src/consolidation.js");
    const a = project([
      factura("a1", 1, "100.00", "CF"),
      factura("a2", 2, "200.00", "CF"),
      cobro("a1", 15, "100.00"),
    ]).state;
    const b = project([factura("b1", 1, "50.00", "CF")]).state;
    const unpaid = consolidatedUnpaid([a, b], "2026-08", "GTQ");
    expect(unpaid.count).toBe(2);
    // a2 (200.00 sin IVA -> 224.00 con IVA) + b1 (50.00 -> 56.00) = 280.00
    expect(unpaid.amount.minor).toBe(28000);
  });
});

describe("consolidatedPendingApproval", () => {
  it("suma gastos esperando aprobación de todas las empresas", async () => {
    const { consolidatedPendingApproval } = await import("../src/consolidation.js");
    // Gastos nacen draft; solo cuentan los transicionados a submitted.
    const a = project([
      gasto("a1", "2026-08-03", "100.00"),
      evt("expense.transitioned", 3, { expenseId: "a1", to: "submitted" }),
      gasto("a2", "2026-08-05", "50.00"),
    ]).state;
    const b = project([
      gasto("b1", "2026-08-04", "30.00"),
      evt("expense.transitioned", 4, { expenseId: "b1", to: "submitted" }),
    ]).state;
    expect(consolidatedPendingApproval([a, b])).toBe(2);
  });
});

describe("consolidatedComparison", () => {
  it("suma current/previous y recalcula la variación", async () => {
    const { consolidatedComparison } = await import("../src/consolidation.js");
    const a = project([gasto("a1", "2026-08-14", "100.00"), gasto("a2", "2026-08-21", "150.00")]).state;
    const b = project([gasto("b1", "2026-08-14", "50.00"), gasto("b2", "2026-08-21", "100.00")]).state;
    const cmp = consolidatedComparison([a, b], "2026-08-21", "GTQ");
    expect(cmp).not.toBeNull();
    expect(cmp!.current.minor).toBe(25000);
    expect(cmp!.previous.minor).toBe(15000);
    expect(cmp!.deltaPercent).toBeCloseTo((25000 - 15000) / 15000 * 100, 6);
  });

  it("devuelve null cuando la semana pasada no hubo movimiento en ninguna empresa", async () => {
    const { consolidatedComparison } = await import("../src/consolidation.js");
    const a = project([gasto("a1", "2026-08-21", "150.00")]).state;
    const b = project([gasto("b1", "2026-08-21", "90.00")]).state;
    const cmp = consolidatedComparison([a, b], "2026-08-21", "GTQ");
    expect(cmp).not.toBeNull();
    expect(cmp!.previous.minor).toBe(0);
    expect(cmp!.deltaPercent).toBeNull();
  });
});

describe("consolidatedMonthlySeries", () => {
  it("suma punto a punto la serie temporal de cada empresa", async () => {
    const { consolidatedMonthlySeries } = await import("../src/consolidation.js");
    const a = project([factura("a1", 1, "100.00", "CF")]).state;
    const b = project([factura("b1", 1, "50.00", "CF")]).state;
    const series = consolidatedMonthlySeries([a, b], "2026-08", 3, "GTQ");
    expect(series.length).toBe(3);
    const last = series[series.length - 1]!;
    expect(last.month).toBe("2026-08");
    // invoiced con IVA: 112.00 + 56.00 = 168.00
    expect(last.invoiced.minor).toBe(16800);
  });
});

describe("consolidatedDailyExpenses", () => {
  it("suma por día calendario entre empresas", async () => {
    const { consolidatedDailyExpenses } = await import("../src/consolidation.js");
    const a = project([gasto("a1", "2026-08-03", "100.00")]).state;
    const b = project([gasto("b1", "2026-08-03", "50.00"), gasto("b2", "2026-08-05", "20.00")]).state;
    const days = consolidatedDailyExpenses([a, b], "2026-08", "GTQ");
    const d3 = days.find((d) => d.date === "2026-08-03")!;
    const d5 = days.find((d) => d.date === "2026-08-05")!;
    expect(d3.amount.minor).toBe(15000);
    expect(d5.amount.minor).toBe(2000);
  });
});

describe("consolidatedExpensesByCategory", () => {
  it("agrupa por code de categoría (no por id, que difiere entre empresas)", async () => {
    const { consolidatedExpensesByCategory } = await import("../src/consolidation.js");
    // Misma categoría semántica "materia-prima" pero con ids distintos por empresa.
    const a = project([
      categoria("cat-a-1", "Materia Prima", "materia-prima"),
      gasto("a1", "2026-08-03", "100.00", "cat-a-1"),
    ]).state;
    const b = project([
      categoria("cat-b-7", "Materia Prima", "materia-prima"),
      gasto("b1", "2026-08-04", "50.00", "cat-b-7"),
      gasto("b2", "2026-08-05", "30.00", "cat-b-7"),
    ]).state;
    const totals = consolidatedExpensesByCategory([a, b], "2026-08", "GTQ");
    expect(totals.length).toBe(1);
    expect(totals[0]!.code).toBe("materia-prima");
    expect(totals[0]!.name).toBe("Materia Prima");
    expect(totals[0]!.amount.minor).toBe(18000);
  });

  it("asigna sin-categoria a gastos sin categoría", async () => {
    const { consolidatedExpensesByCategory } = await import("../src/consolidation.js");
    const a = project([gasto("a1", "2026-08-03", "40.00")]).state;
    const totals = consolidatedExpensesByCategory([a], "2026-08", "GTQ");
    expect(totals.length).toBe(1);
    expect(totals[0]!.code).toBe("sin-categoria");
    expect(totals[0]!.amount.minor).toBe(4000);
  });
});

describe("consolidatedDiscountSummary", () => {
  it("suma total de descuentos y documentos afectados", async () => {
    const { consolidatedDiscountSummary } = await import("../src/consolidation.js");
    const a = project([factura("a1", 1, "100.00", "CF")]).state;
    const b = project([factura("b1", 1, "100.00", "CF")]).state;
    // 12% de IVA no genera descuento; sin líneas con descuento documents=0.
    const summary = consolidatedDiscountSummary([a, b], "2026-08", "GTQ");
    expect(summary.total.minor).toBe(0);
    expect(summary.documents).toBe(0);
  });
});

describe("consolidatedPaymentMix", () => {
  it("suma total y slices por método, recalculando shares", async () => {
    const { consolidatedPaymentMix } = await import("../src/consolidation.js");
    const a = project([
      factura("a1", 1, "100.00", "CF"),
      cobro("a1", 15, "100.00"),
    ]).state;
    const b = project([
      factura("b1", 1, "300.00", "CF"),
      cobro("b1", 16, "300.00"),
    ]).state;
    const mix = consolidatedPaymentMix([a, b], "2026-08", "GTQ");
    // paymentMix suma totals.total (IVA incluido): 112.00 + 336.00 = 448.00
    expect(mix.total.minor).toBe(44800);
    const effectivo = mix.slices.find((s) => s.method === "Efectivo")!;
    expect(effectivo.amount.minor).toBe(44800);
    expect(effectivo.share).toBeCloseTo(1, 6);
  });
});

describe("consolidatedCustomerMetrics", () => {
  it("un mismo NIT que compra en dos empresas es UN cliente identificado", async () => {
    const { consolidatedCustomerMetrics } = await import("../src/consolidation.js");
    const a = project([factura("a1", 1, "100.00", "12345678-9")]).state;
    const b = project([factura("b1", 1, "50.00", "12345678-9")]).state;
    const metrics = consolidatedCustomerMetrics([a, b], "2026-08", "GTQ");
    expect(metrics.tickets).toBe(2);
    expect(metrics.identified).toBe(1);
    expect(metrics.returning).toBe(1);
    expect(metrics.avgTicket.minor).toBe(8400); // (112 + 56) / 2, IVA incluido
  });

  it("consumidor final no cuenta como identificado en ningún estado", async () => {
    const { consolidatedCustomerMetrics } = await import("../src/consolidation.js");
    const a = project([factura("a1", 1, "100.00", "CF")]).state;
    const b = project([factura("b1", 1, "50.00", "CF")]).state;
    const metrics = consolidatedCustomerMetrics([a, b], "2026-08", "GTQ");
    expect(metrics.tickets).toBe(2);
    expect(metrics.identified).toBe(0);
    expect(metrics.returningRate).toBeNull();
  });
});