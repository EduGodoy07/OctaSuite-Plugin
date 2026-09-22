import { describe, expect, it } from "vitest";
import {
  applyPricelist,
  validatePricelistDraft,
  type Pricelist,
} from "../src/domain/pricelist.js";
import { Product, money } from "@octasuite/core";

const saleQ12 = money(1235, "GTQ"); // Q12.35
const saleQ99 = money(990, "GTQ"); // Q9.90

const product = (id: string, salePrice = saleQ12): Product =>
  ({
    id,
    name: `Producto ${id}`,
    salePrice,
    archived: false,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  }) as Product;

const pricelist = (over: Partial<Pricelist> = {}): Pricelist => ({
  id: "pl-1",
  name: "Revendedores",
  factorBps: undefined,
  overrides: [],
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  ...over,
});

describe("applyPricelist", () => {
  it("sin reglas devuelve el precio de lista del producto", () => {
    expect(applyPricelist(pricelist(), product("p1")).minor).toBe(1235);
  });

  it("aplica el factor global redondeando HALF-UP (10% off sobre Q12.35 => Q11.12)", () => {
    const pl = pricelist({ factorBps: 9000 });
    expect(applyPricelist(pl, product("p1")).minor).toBe(1112);
  });

  it("aplica un recargo global (50% up sobre Q12.35 => Q18.53)", () => {
    const pl = pricelist({ factorBps: 15000 });
    expect(applyPricelist(pl, product("p1")).minor).toBe(1853);
  });

  it("el override por producto manda sobre el factor global", () => {
    const pl = pricelist({ factorBps: 9000, overrides: [{ productId: "p2", priceMinor: 990 }] });
    expect(applyPricelist(pl, product("p1")).minor).toBe(1112);
    expect(applyPricelist(pl, product("p2")).minor).toBe(990);
  });

  it("el override no afecta a productos que no lista", () => {
    const pl = pricelist({ overrides: [{ productId: "p3", priceMinor: 800 }] });
    expect(applyPricelist(pl, product("p1")).minor).toBe(1235);
    expect(applyPricelist(pl, product("p3")).minor).toBe(800);
  });
});

describe("validatePricelistDraft", () => {
  it("acepta un pricelist valido", () => {
    expect(
      validatePricelistDraft({
        name: "Revendedores",
        factorBps: 9000,
        overrides: [{ productId: "p1", priceMinor: 990 }],
      }),
    ).toEqual([]);
  });

  it("rechaza nombre vacio", () => {
    const errors = validatePricelistDraft({ name: "", factorBps: 9000, overrides: [] });
    expect(errors.some((e) => e.code === "pricelist.name_required")).toBe(true);
  });

  it("rechaza factor global en cero o negativo", () => {
    expect(validatePricelistDraft({ name: "X", factorBps: 0, overrides: [] })[0]?.code).toBe(
      "pricelist.factor_invalid",
    );
    expect(validatePricelistDraft({ name: "X", factorBps: -100, overrides: [] })[0]?.code).toBe(
      "pricelist.factor_invalid",
    );
  });

  it("rechaza precio de override negativo", () => {
    const errors = validatePricelistDraft({
      name: "X",
      overrides: [{ productId: "p1", priceMinor: -1 }],
    });
    expect(errors.some((e) => e.code === "pricelist.price_negative")).toBe(true);
  });

  it("mantiene la moneda del producto al resolver (no inventa monedas)", () => {
    const pl = pricelist({ factorBps: 9000 });
    const usd = applyPricelist(pl, product("p1", money(500, "USD")));
    expect(usd.currency).toBe("USD");
    expect(usd.minor).toBe(450);
  });
});