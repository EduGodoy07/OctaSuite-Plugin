import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  DomainError,
  format,
  fromDecimal,
  money,
  multiply,
  percentOf,
  roundHalfUp,
  subtract,
  sum,
  toDecimalString,
  zero,
} from "../src/index.js";

describe("Money", () => {
  it("rechaza importes no enteros: el centavo es la unidad", () => {
    expect(() => money(10.5, "GTQ")).toThrow(DomainError);
  });

  it("parsea decimales desde texto sin pasar por flotantes", () => {
    expect(fromDecimal("1234.56", "GTQ").minor).toBe(123456);
    expect(fromDecimal("-0.07", "GTQ").minor).toBe(-7);
    expect(fromDecimal("100", "GTQ").minor).toBe(10000);
    expect(fromDecimal(".5", "GTQ").minor).toBe(50);
    expect(fromDecimal("1,234.50", "GTQ").minor).toBe(123450);
  });

  it("redondea HALF-UP el tercer decimal al parsear", () => {
    expect(fromDecimal("1.005", "GTQ").minor).toBe(101);
    expect(fromDecimal("1.004", "GTQ").minor).toBe(100);
  });

  it("redondea alejandose del cero, no hacia el cero", () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(-0.5)).toBe(-1);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });

  it("no mezcla monedas sin tipo de cambio", () => {
    expect(() => add(money(100, "GTQ"), money(100, "USD"))).toThrow(/GTQ y USD/);
  });

  it("suma y resta en centavos exactos", () => {
    expect(add(fromDecimal("0.1", "GTQ"), fromDecimal("0.2", "GTQ")).minor).toBe(30);
    expect(subtract(fromDecimal("1", "GTQ"), fromDecimal("0.99", "GTQ")).minor).toBe(1);
    expect(sum([fromDecimal("10.10", "GTQ"), fromDecimal("20.20", "GTQ")], "GTQ").minor).toBe(3030);
    expect(sum([], "GTQ")).toEqual(zero("GTQ"));
  });

  it("multiplica por cantidades fraccionarias redondeando HALF-UP", () => {
    expect(multiply(fromDecimal("100.00", "GTQ"), 2.5).minor).toBe(25000);
    expect(multiply(fromDecimal("0.03", "GTQ"), 0.5).minor).toBe(2);
  });

  it("aplica IVA 12% de Guatemala", () => {
    expect(percentOf(fromDecimal("100.00", "GTQ"), 12).minor).toBe(1200);
    expect(percentOf(fromDecimal("0.12", "GTQ"), 12).minor).toBe(1);
  });

  it("reparte sin perder ni inventar centavos", () => {
    const parts = allocate(fromDecimal("100.00", "GTQ"), [1, 1, 1]);
    expect(parts.map((p) => p.minor)).toEqual([3334, 3333, 3333]);
    expect(sum(parts, "GTQ").minor).toBe(10000);
  });

  it("mantiene el reparto exacto tambien con importes negativos", () => {
    const parts = allocate(fromDecimal("-10.00", "GTQ"), [2, 1]);
    expect(sum(parts, "GTQ").minor).toBe(-1000);
  });

  it("serializa a decimal legible", () => {
    expect(toDecimalString(money(5, "GTQ"))).toBe("0.05");
    expect(toDecimalString(money(-5, "GTQ"))).toBe("-0.05");
    expect(toDecimalString(money(123456, "GTQ"))).toBe("1234.56");
  });

  it("formatea sin reventar con una moneda desconocida", () => {
    expect(format(money(10000, "XYZ"))).toContain("100.00");
  });
});
