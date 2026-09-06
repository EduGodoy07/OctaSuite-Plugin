import { describe, expect, it } from "vitest";
import { fromDecimal } from "@octasuite/core";
import { parseDiscountInput } from "../src/ui/discount-input.js";

describe("parseDiscountInput", () => {
  it("devuelve none cuando ambos campos están vacíos", () => {
    expect(parseDiscountInput("", "", "GTQ")).toEqual({ kind: "none" });
    expect(parseDiscountInput("  ", "\t", "GTQ")).toEqual({ kind: "none" });
  });

  it("parsea un descuento porcentual válido", () => {
    expect(parseDiscountInput("10", "", "GTQ")).toEqual({
      kind: "ok",
      discount: { percent: 10 },
    });
  });

  it("parsea un descuento fijo válido", () => {
    expect(parseDiscountInput("", "5.50", "GTQ")).toEqual({
      kind: "ok",
      discount: { amount: fromDecimal("5.50", "GTQ") },
    });
  });

  it("combina percent y amount cuando ambos son válidos", () => {
    expect(parseDiscountInput("10", "5.50", "GTQ")).toEqual({
      kind: "ok",
      discount: { percent: 10, amount: fromDecimal("5.50", "GTQ") },
    });
  });

  it("marca inválido un percent que no es número", () => {
    expect(parseDiscountInput("abc", "", "GTQ")).toEqual({
      kind: "invalid",
      problem: "discount_percent_invalid",
    });
  });

  it("marca inválido un percent con coma decimal (Number('12,5') = NaN)", () => {
    expect(parseDiscountInput("12,5", "", "GTQ")).toEqual({
      kind: "invalid",
      problem: "discount_percent_invalid",
    });
  });

  it("marca inválido un amount que no parsea como money", () => {
    expect(parseDiscountInput("", "1.2.3", "GTQ")).toEqual({
      kind: "invalid",
      problem: "discount_amount_invalid",
    });
  });

  it("no se traga un percent válido cuando el amount es inválido (bug del review)", () => {
    // Regresión: antes parseDiscount devolvía undefined y la línea se emitía
    // SIN descuento en silencio, descartando el percent que sí estaba bien.
    expect(parseDiscountInput("10", "1.2.3", "GTQ")).toEqual({
      kind: "invalid",
      problem: "discount_amount_invalid",
    });
  });

  it("no deja pasar un amount válido cuando el percent es inválido", () => {
    expect(parseDiscountInput("abc", "5.00", "GTQ")).toEqual({
      kind: "invalid",
      problem: "discount_percent_invalid",
    });
  });
});