import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencyMeta,
  decimalsFor,
  registerCurrencies,
} from "../src/catalogs/currencies.js";
import { UOM_SAT, registerUnitsOfMeasure, unitOfMeasure, unitLabel } from "../src/catalogs/uom-sat.js";

/**
 * El catalogo de monedas debe ser un registro mutable: el seed por defecto
 * sigue vigente hasta que `registerCurrencies` lo reemplace (el adaptador de
 * Obsidian carga `octasuite-data/catalogs/currencies.json` al arrancar).
 */
describe("catalogo de monedas (registro mutable)", () => {
  it("usa el seed por defecto mientras no haya override", () => {
    expect(DEFAULT_CURRENCY).toBe("GTQ");
    expect(currencyMeta("GTQ")?.name).toBe("Quetzal guatemalteco");
    expect(decimalsFor("USD")).toBe(2);
    expect(currencyMeta("NON")).toBeUndefined();
    expect(decimalsFor("NON")).toBe(2);
  });

  it("el seed por defecto es un catalogo valido (no vacio, cierra decimos)", () => {
    expect(CURRENCIES.length).toBeGreaterThan(0);
    for (const c of CURRENCIES) {
      expect(Number.isInteger(c.decimals)).toBe(true);
    }
  });

  it("registerCurrencies reemplaza el catalogo en memoria", () => {
    registerCurrencies([{ code: "GTQ", name: "Quetzal", symbol: "Q", decimals: 2 }]);
    expect(currencyMeta("GTQ")).toBeDefined();
    expect(currencyMeta("USD")).toBeUndefined(); // el override reemplaza, no suma
    expect(decimalsFor("USD")).toBe(2); // fallback por defecto
  });

  it("registerCurrencies con catalogo vacio deja el registro sin monedas", () => {
    registerCurrencies([]);
    expect(currencyMeta("GTQ")).toBeUndefined();
  });
});

/**
 * Catalogo de unidades de medida SAT-IA-008: seed inerte + registro mutable.
 * Inerte = cero consumidores en el core hoy (el modulo de producto no existe aun);
 * un catalogo no espera a su consumidor para existir.
 */
describe("catalogo de unidades SAT (uom-sat)", () => {
  it("seed SAT-IA-008 verificado de la fuente oficial", () => {
    const codes = UOM_SAT.map((u) => u.code);
    // Subconjunto minimo verificado contra la tabla SAT-IA-008 / DUCA.
    expect(codes).toContain("MTS");
    expect(codes).toContain("KGS");
    expect(codes).toContain("LTS");
  });

  it("exposiciones validas", () => {
    expect(unitOfMeasure("KGS")?.name).toBe("KILOGRAMO");
    expect(unitOfMeasure("KGS")?.symbol).toBe("kg");
    expect(unitOfMeasure("ZZZ")).toBeUndefined();
    expect(unitLabel("KGS")).toBe("KILOGRAMO");
    expect(unitLabel("ZZZ")).toBe("ZZZ");
  });

  it("registerUnitsOfMeasure reemplaza el catalogo en memoria", () => {
    registerUnitsOfMeasure([{ code: "U", name: "UNIDAD", symbol: "u" }]);
    expect(unitOfMeasure("U")?.name).toBe("UNIDAD");
    expect(unitOfMeasure("KGS")).toBeUndefined();
  });
});
