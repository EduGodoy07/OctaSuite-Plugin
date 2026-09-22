import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  fromDecimal,
  invoicesOfShift,
  isCashMethod,
  movementsOf,
  openShift,
  project,
  shiftSummary,
  totalsSnapshot,
  type AnyEvent,
  type InvoiceLine,
} from "../src/index.js";

let seq = 0;
const evt = (type: AnyEvent["type"], payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: `2026-08-25T${String(10 + (seq % 12)).padStart(2, "0")}:00:00.000Z`, v: 1, type, payload } as AnyEvent);

const q = (v: string) => fromDecimal(v, "GTQ");

const abrir = (shiftId: string, fondo: string) =>
  evt("register.opened", { shiftId, date: "2026-08-25", openingFloat: q(fondo) });

const venta = (invoiceId: string, number: number, total: string) => {
  const lines: InvoiceLine[] = [{ description: "Combo", quantity: 1, unitPrice: q(total), taxRate: 0 }];
  return evt("invoice.issued", {
    invoiceId,
    series: "A",
    number,
    date: "2026-08-25",
    currency: "GTQ",
    lines,
    totals: totalsSnapshot(computeInvoiceTotals(lines, "GTQ")),
    partnerName: "Consumidor final",
    partnerTaxId: "CF",
  });
};

const cobrar = (invoiceId: string, method: string, shiftId?: string) =>
  evt("invoice.paid", {
    invoiceId,
    paidAt: "2026-08-25T14:00:00.000Z",
    paymentMethod: method,
    ...(shiftId ? { shiftId } : {}),
  });

describe("Turno de caja", () => {
  it("no permite dos turnos abiertos a la vez", () => {
    const { state, rejected } = project([abrir("t1", "200.00"), abrir("t2", "300.00")]);
    expect(rejected.map((r) => r.code)).toEqual(["shift_already_open"]);
    expect(openShift(state)?.id).toBe("t1");
  });

  it("permite abrir otro después de cerrar", () => {
    const { state, rejected } = project([
      abrir("t1", "200.00"),
      evt("register.closed", { shiftId: "t1", countedCash: q("200.00") }),
      abrir("t2", "300.00"),
    ]);
    expect(rejected).toEqual([]);
    expect(openShift(state)?.id).toBe("t2");
  });

  it("rechaza cerrar dos veces y mover efectivo con el turno cerrado", () => {
    const { rejected } = project([
      abrir("t1", "200.00"),
      evt("register.closed", { shiftId: "t1", countedCash: q("200.00") }),
      evt("register.closed", { shiftId: "t1", countedCash: q("210.00") }),
      evt("register.moved", { movementId: "m1", shiftId: "t1", kind: "out", amount: q("50.00"), reason: "Retiro" }),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["already_closed", "shift_closed"]);
  });

  it("rechaza movimientos sin motivo, en cero o de un turno inexistente", () => {
    const { rejected } = project([
      abrir("t1", "200.00"),
      evt("register.moved", { movementId: "m1", shiftId: "t1", kind: "out", amount: q("0"), reason: "Retiro" }),
      evt("register.moved", { movementId: "m2", shiftId: "t1", kind: "out", amount: q("10.00"), reason: "  " }),
      evt("register.moved", { movementId: "m3", shiftId: "tX", kind: "in", amount: q("10.00"), reason: "Fondo" }),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["bad_amount", "no_reason", "not_found"]);
  });
});

describe("Arqueo", () => {
  it("solo cuenta el efectivo, no la tarjeta", () => {
    const { state } = project([
      abrir("t1", "200.00"),
      venta("i1", 1, "100.00"),
      cobrar("i1", "Efectivo", "t1"),
      venta("i2", 2, "300.00"),
      cobrar("i2", "Tarjeta", "t1"),
    ]);
    const s = shiftSummary(state, "t1", "GTQ")!;
    expect(s.cashSales.minor).toBe(10000);
    expect(s.expected.minor).toBe(30000); // 200 de fondo + 100 en efectivo
    expect(s.ticketCount).toBe(2);
  });

  it("suma ingresos y resta retiros", () => {
    const { state } = project([
      abrir("t1", "200.00"),
      venta("i1", 1, "100.00"),
      cobrar("i1", "Efectivo", "t1"),
      evt("register.moved", { movementId: "m1", shiftId: "t1", kind: "out", amount: q("150.00"), reason: "Retiro a bóveda" }),
      evt("register.moved", { movementId: "m2", shiftId: "t1", kind: "in", amount: q("20.00"), reason: "Fondo adicional" }),
    ]);
    const s = shiftSummary(state, "t1", "GTQ")!;
    expect(s.movedOut.minor).toBe(15000);
    expect(s.movedIn.minor).toBe(2000);
    expect(s.expected.minor).toBe(17000); // 200 + 100 − 150 + 20
  });

  it("calcula el faltante y el sobrante contra lo contado", () => {
    const base = [abrir("t1", "200.00"), venta("i1", 1, "100.00"), cobrar("i1", "Efectivo", "t1")];

    const falta = project([...base, evt("register.closed", { shiftId: "t1", countedCash: q("295.00") })]);
    expect(shiftSummary(falta.state, "t1", "GTQ")!.difference!.minor).toBe(-500);

    const sobra = project([...base, evt("register.closed", { shiftId: "t1", countedCash: q("310.00") })]);
    expect(shiftSummary(sobra.state, "t1", "GTQ")!.difference!.minor).toBe(1000);
  });

  it("sin contar todavía, la diferencia es null y no cero", () => {
    const { state } = project([abrir("t1", "200.00")]);
    const s = shiftSummary(state, "t1", "GTQ")!;
    expect(s.counted).toBeNull();
    expect(s.difference).toBeNull();
  });

  it("no mezcla cobros de otro turno", () => {
    const { state } = project([
      abrir("t1", "200.00"),
      venta("i1", 1, "100.00"),
      cobrar("i1", "Efectivo", "t1"),
      evt("register.closed", { shiftId: "t1", countedCash: q("300.00") }),
      abrir("t2", "50.00"),
      venta("i2", 2, "80.00"),
      cobrar("i2", "Efectivo", "t2"),
    ]);
    expect(invoicesOfShift(state, "t2").map((i) => i.id)).toEqual(["i2"]);
    expect(shiftSummary(state, "t2", "GTQ")!.expected.minor).toBe(13000); // 50 + 80
  });

  it("un cobro sin turno no entra en ningún arqueo", () => {
    const { state } = project([
      abrir("t1", "200.00"),
      venta("i1", 1, "100.00"),
      cobrar("i1", "Efectivo"),
    ]);
    expect(shiftSummary(state, "t1", "GTQ")!.expected.minor).toBe(20000);
    expect(movementsOf(state, "t1")).toEqual([]);
  });

  it("reconoce «efectivo» sin importar mayúsculas ni espacios", () => {
    expect(isCashMethod("Efectivo")).toBe(true);
    expect(isCashMethod("  efectivo ")).toBe(true);
    expect(isCashMethod("Tarjeta")).toBe(false);
    expect(isCashMethod(undefined)).toBe(false);
  });
});
