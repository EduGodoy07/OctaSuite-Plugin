import { describe, expect, it } from "vitest";
import {
  assertCreditable,
  computeInvoiceTotals,
  computeLineTotals,
  formatInvoiceNumber,
  fromDecimal,
  nextNumber,
  totalsSnapshot,
  validateIssueInput,
  verifyTotals,
  type Invoice,
  type InvoiceLine,
} from "../src/index.js";

const line = (qty: number, price: string, rate = 12): InvoiceLine => ({
  description: "Servicio",
  quantity: qty,
  unitPrice: fromDecimal(price, "GTQ"),
  taxRate: rate,
});

describe("Totales de factura", () => {
  it("calcula base, IVA 12% y total de una linea", () => {
    const t = computeLineTotals(line(1, "100.00"));
    expect(t.untaxed.minor).toBe(10000);
    expect(t.tax.minor).toBe(1200);
    expect(t.total.minor).toBe(11200);
  });

  it("redondea por linea y el total es la suma de las lineas redondeadas", () => {
    // 0.29 * 12% = 0.0348 -> 0.03 por linea. Tres lineas = 0.09, no 0.10.
    const totals = computeInvoiceTotals([line(1, "0.29"), line(1, "0.29"), line(1, "0.29")], "GTQ");
    expect(totals.untaxed.minor).toBe(87);
    expect(totals.tax.minor).toBe(9);
    expect(totals.total.minor).toBe(96);
  });

  it("desglosa el impuesto por tasa", () => {
    const totals = computeInvoiceTotals([line(1, "100.00", 12), line(1, "50.00", 0)], "GTQ");
    expect(totals.taxByRate.get(12)?.minor).toBe(1200);
    expect(totals.taxByRate.get(0)?.minor).toBe(0);
    expect(totals.total.minor).toBe(16200);
  });

  it("respeta cantidades fraccionarias", () => {
    const t = computeLineTotals(line(2.5, "80.00"));
    expect(t.untaxed.minor).toBe(20000);
    expect(t.total.minor).toBe(22400);
  });

  it("rechaza lineas imposibles", () => {
    expect(() => computeLineTotals(line(0, "10.00"))).toThrow(/mayor que cero/);
    expect(() => computeLineTotals({ ...line(1, "10.00"), taxRate: 120 })).toThrow(/Tasa invalida/);
    expect(() => computeInvoiceTotals([], "GTQ")).toThrow(/al menos una linea/);
  });
});

describe("Emision", () => {
  it("exige cliente, NIT y lineas", () => {
    const codes = validateIssueInput({ series: "A" }).map((e) => e.code);
    expect(codes).toEqual(["invoice.partner_name_required", "invoice.tax_id_required", "invoice.no_lines"]);
  });

  it("reporta la linea concreta que falla", () => {
    const errors = validateIssueInput({
      series: "A",
      partnerName: "Cliente",
      partnerTaxId: "CF",
      lines: [line(1, "10.00"), { ...line(1, "10.00"), quantity: -1 }],
    });
    expect(errors[0]?.message).toMatch(/^Linea 2:/);
  });

  it("da correlativos consecutivos sin huecos", () => {
    expect(nextNumber(undefined)).toBe(1);
    expect(nextNumber(1)).toBe(2);
    expect(nextNumber(41)).toBe(42);
    expect(() => nextNumber(-1)).toThrow();
    expect(formatInvoiceNumber("A", 42)).toBe("A-0042");
    expect(formatInvoiceNumber("FACT", 12345, 4)).toBe("FACT-12345");
  });
});

describe("Inmutabilidad fiscal", () => {
  it("detecta deriva entre los totales emitidos y los recalculados", () => {
    const lines = [line(1, "100.00")];
    const snapshot = totalsSnapshot(computeInvoiceTotals(lines, "GTQ"));
    expect(verifyTotals(lines, "GTQ", snapshot)).toBeNull();

    const tampered = { ...snapshot, total: fromDecimal("999.00", "GTQ") };
    expect(verifyTotals(lines, "GTQ", tampered)?.code).toBe("invoice.totals_drift");
  });
});

describe("Nota de credito", () => {
  const invoice = (): Invoice => {
    const lines = [line(1, "100.00")];
    const totals = computeInvoiceTotals(lines, "GTQ");
    return {
      id: "inv_1",
      series: "A",
      number: 1,
      displayNumber: "A-0001",
      date: "2026-08-24",
      currency: "GTQ",
      lines,
      totals,
      status: "issued",
      partnerName: "Cliente",
      partnerTaxId: "CF",
      creditedTotal: fromDecimal("0", "GTQ"),
      creditNoteIds: [],
    };
  };

  it("permite acreditar hasta el total", () => {
    expect(() => assertCreditable(invoice(), fromDecimal("112.00", "GTQ"))).not.toThrow();
  });

  it("no permite acreditar mas que el total", () => {
    expect(() => assertCreditable(invoice(), fromDecimal("112.01", "GTQ"))).toThrow(/excede/);
  });

  it("acumula con las notas previas", () => {
    const partial = { ...invoice(), creditedTotal: fromDecimal("100.00", "GTQ") };
    expect(() => assertCreditable(partial, fromDecimal("12.00", "GTQ"))).not.toThrow();
    expect(() => assertCreditable(partial, fromDecimal("12.01", "GTQ"))).toThrow(/excede/);
  });
});
