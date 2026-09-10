import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  computeLineTotals,
  fromDecimal,
  type InvoiceLine,
  type LineDiscount,
} from "../src/index.js";

const line = (
  qty: number,
  price: string,
  rate = 12,
  discount?: LineDiscount,
): InvoiceLine => ({
  description: "Servicio",
  quantity: qty,
  unitPrice: fromDecimal(price, "GTQ"),
  taxRate: rate,
  ...(discount !== undefined ? { discount } : {}),
});

describe("Descuento por linea", () => {
  it("aplica descuento porcentual sobre la base antes del IVA", () => {
    const t = computeLineTotals(line(1, "100.00", 12, { percent: 10 }));
    expect(t.untaxed.minor).toBe(9000);
    expect(t.tax.minor).toBe(1080);
    expect(t.total.minor).toBe(10080);
  });

  it("aplica descuento por monto fijo sobre la base antes del IVA", () => {
    const t = computeLineTotals(line(1, "100.00", 12, { amount: fromDecimal("5.00", "GTQ") }));
    expect(t.untaxed.minor).toBe(9500);
    expect(t.tax.minor).toBe(1140);
    expect(t.total.minor).toBe(10640);
  });

  it("combina porcentaje y monto en la misma linea", () => {
    const t = computeLineTotals(
      line(1, "100.00", 12, { percent: 10, amount: fromDecimal("5.00", "GTQ") }),
    );
    // descuento = 10.00 + 5.00 = 15.00 -> base 85.00
    expect(t.untaxed.minor).toBe(8500);
    expect(t.tax.minor).toBe(1020);
    expect(t.total.minor).toBe(9520);
  });

  it("redondea el descuento por linea con HALF-UP", () => {
    // base 1 * 33.34 = 33.34; 10% = 3.334 -> 3.33
    const t = computeLineTotals(line(1, "33.34", 12, { percent: 10 }));
    expect(t.untaxed.minor).toBe(3001);
  });

  it("permite descuento igual a la base (articulo gratis)", () => {
    const t = computeLineTotals(line(1, "100.00", 12, { percent: 100 }));
    expect(t.untaxed.minor).toBe(0);
    expect(t.tax.minor).toBe(0);
    expect(t.total.minor).toBe(0);
  });

  it("rechaza descuento que excede la base", () => {
    expect(() => computeLineTotals(line(1, "10.00", 12, { amount: fromDecimal("15.00", "GTQ") }))).toThrow(
      /excede la base/,
    );
  });

  it("rechaza porcentaje fuera de rango", () => {
    expect(() => computeLineTotals(line(1, "100.00", 12, { percent: 110 }))).toThrow(/invalido/);
    expect(() => computeLineTotals(line(1, "100.00", 12, { percent: -5 }))).toThrow(/invalido/);
  });

  it("rechaza descuento por monto negativo", () => {
    expect(() => computeLineTotals(line(1, "100.00", 12, { amount: fromDecimal("-1.00", "GTQ") }))).toThrow(
      /negativo/,
    );
  });

  it("rechaza descuento vacio sin percent ni amount", () => {
    expect(() => computeLineTotals(line(1, "100.00", 12, {}))).toThrow(/descuento/);
  });

  it("agrega el descuento al total del documento", () => {
    const totals = computeInvoiceTotals(
      [
        line(1, "100.00", 12, { percent: 10 }),
        line(1, "50.00", 12, { amount: fromDecimal("5.00", "GTQ") }),
      ],
      "GTQ",
    );
    expect(totals.untaxed.minor).toBe(13500); // 90.00 + 45.00
    expect(totals.tax.minor).toBe(1620); // 10.80 + 5.40
    expect(totals.total.minor).toBe(15120);
  });
});