import { beforeEach, describe, expect, it } from "vitest";
import {
  UOMS,
  isKnownUom,
  listRegisteredUoms,
  registerUoms,
  resolveUom,
  suggestUoms,
  uomCategory,
} from "../src/catalogs/uoms.js";

// Cada test arranca con el seed por defecto: el registry es estado global y
// tests como "registerUoms reemplaza" lo mutan (aislamiento entre tests).
beforeEach(() => {
  registerUoms(UOMS);
});

/**
 * Catalogo de NOMBRES de unidad de medida (uoms): los 26 valores reales que
 * OctaSuite seedea en su UOMSeeder.php (los UoM clasicos de Odoo) + nombres
 * de negocio es_GT (Unidades, Docenas, Dias, Horas, Minutos) + categoria
 * `Empaque` con empaques genéricos (Caja, Carton, Tira, Paquete) y una lista
 * curada de fardos numerados de uso cotidiano (Fardo 4..72).
 *
 * Los nombres es_GT van SIN acentos (Dias, no Dias con tilde) a proposito: el
 * filtro de `suggestUoms` es substring lowercase y NO normaliza diacriticos —
 * teclear "dia" no matchearia "Dias con tilde". Mantener la convencion
 * sin-tilde garantiza que el autocompletado encuentre lo que el usuario
 * escribe.
 *
 * La lista de fardos es una convencion generica de retail (cantidades chicas
 * de consumo comun), NO una copia del catalogo operativo de ningun cliente.
 *
 * A diferencia del catalogo UOM_SAT (esquema SAT-IA-008 usado por el DTE),
 * este es el catalogo de presentacion que usa la UI para autocompletar el
 * campo libre "Unidad" de un producto.
 */
describe("catalogo de nombres UoM (uoms)", () => {
  it("el seed mantiene los 26 UoM reales + nombres es_GT + Empaque", () => {
    expect(UOMS.length).toBe(47);
    expect(UOMS.map((u) => u.name)).toEqual([
      // Unidades (clasicos Odoo)
      "Units",
      "Dozens",
      // Peso
      "kg",
      "g",
      "t",
      "lb",
      "oz",
      // Tiempo
      "Days",
      "Hours",
      // Longitud
      "m",
      "mm",
      "km",
      "cm",
      "in",
      "ft",
      "yd",
      "mi",
      // Area
      "m²",
      "ft²",
      // Volumen
      "L",
      "m³",
      "fl oz (US)",
      "qt (US)",
      "gal (US)",
      "in³",
      "ft³",
      // Nombres de negocio es_GT (sin acentos, ver nota de cabecera)
      "Unidades",
      "Docenas",
      "Dias",
      "Horas",
      "Minutos",
      // Empaque — genericos y fardos numerados curados
      "Fardo",
      "Fardo 4",
      "Fardo 5",
      "Fardo 6",
      "Fardo 8",
      "Fardo 10",
      "Fardo 12",
      "Fardo 20",
      "Fardo 24",
      "Fardo 36",
      "Fardo 72",
      "Caja",
      "Cajita",
      "Carton",
      "Tira",
      "Paquete",
    ]);
  });

  it("no hay nombres duplicados y todas las entradas tienen categoria", () => {
    const names = UOMS.map((u) => u.name);
    expect(new Set(names).size).toBe(names.length);
    for (const u of UOMS) {
      expect(u.category.length).toBeGreaterThan(0);
    }
  });

  it("las categorias son las seis clasicas de Odoo + Empaque", () => {
    const categories = new Set(UOMS.map((u) => u.category));
    expect(categories).toEqual(
      new Set(["Unidades", "Peso", "Tiempo", "Longitud", "Area", "Volumen", "Empaque"]),
    );
  });

  it("la lista de fardos es una convencion curada, no el catalogo de un cliente", () => {
    const empaque = UOMS.filter((u) => u.category === "Empaque").map((u) => u.name);
    for (const fardo of ["Fardo", "Fardo 4", "Fardo 72"]) {
      expect(empaque).toContain(fardo);
    }
    // Cantidades operativas de clientes NO deben colarse al seed generico.
    for (const nonGeneric of ["Fardo 408", "Fardo 456", "Fardo 600", "Fardo 24 x 16 of Barquillos"]) {
      expect(UOMS.map((u) => u.name)).not.toContain(nonGeneric);
    }
  });

  it("uomCategory resuelve la categoria de un nombre", () => {
    expect(uomCategory("kg")).toBe("Peso");
    expect(uomCategory("m²")).toBe("Area");
    expect(uomCategory("Hours")).toBe("Tiempo");
    expect(uomCategory("Fardo 36")).toBe("Empaque");
    expect(uomCategory("Dias")).toBe("Tiempo");
    expect(uomCategory("nope")).toBeUndefined();
  });

  it("suggestUoms filtra por substring case-insensitive", () => {
    const names = suggestUoms("k").map((u) => u.name);
    expect(names).toContain("kg");
    expect(names).toContain("km");
    const upper = suggestUoms("KG").map((u) => u.name);
    expect(upper).toContain("kg");
    expect(suggestUoms("hou").map((u) => u.name)).toContain("Hours");
    // es_GT se encuentra aunque se teclee sin acento
    expect(suggestUoms("dias").map((u) => u.name)).toContain("Dias");
    expect(suggestUoms("fardo 7").map((u) => u.name)).toContain("Fardo 72");
    expect(suggestUoms("caja").map((u) => u.name)).toContain("Caja");
  });

  it("suggestUoms respeta el limite y no empata con basura", () => {
    expect(suggestUoms("").length).toBeLessThanOrEqual(8);
    expect(suggestUoms("zzz")).toEqual([]);
    expect(suggestUoms("k", 1).length).toBe(1);
  });

  it("resolveUom normaliza a la entrada canonica (case-insensitive, trim, sin acentos)", () => {
    expect(resolveUom("kg")?.name).toBe("kg");
    expect(resolveUom("KG")?.name).toBe("kg");
    expect(resolveUom("  caja  ")?.name).toBe("Caja");
    expect(resolveUom("fardo 72")?.name).toBe("Fardo 72");
    // La convencion del catalogo es sin acentos: "Dias" (no con tilde) — el
    // usuario que teclee tilde igual debe caer en la entrada canonica.
    expect(resolveUom("Días")?.name).toBe("Dias");
    expect(resolveUom("minutos")?.name).toBe("Minutos");
    // Coincidencia exacta, no substring: "fardo" no es "Fardo 4".
    expect(resolveUom("fardo")?.name).toBe("Fardo");
    expect(resolveUom("unidades extra")).toBeUndefined();
    expect(resolveUom("")).toBeUndefined();
    expect(resolveUom("   ")).toBeUndefined();
  });

  it("isKnownUom distingue unidades validas de texto libre", () => {
    expect(isKnownUom("kg")).toBe(true);
    expect(isKnownUom("Caja")).toBe(true);
    expect(isKnownUom("fardo 12")).toBe(true);
    expect(isKnownUom("x")).toBe(false);
    // "kilos" es sinonimo es_GT de "kg" (ver UOMS_ALIASES)
    expect(isKnownUom("kilos")).toBe(true);
    expect(isKnownUom("")).toBe(false);
  });

  it("alias: sinonimos de peso/volumen/longitud resuelven a la entrada canonica", () => {
    // Sinonimos es_GT de negocio (UOMS_ALIASES) -> nombre canonico del catalogo.
    expect(resolveUom("kilos")?.name).toBe("kg");
    expect(resolveUom("kilogramos")?.name).toBe("kg");
    expect(resolveUom("gramos")?.name).toBe("g");
    expect(resolveUom("libras")?.name).toBe("lb");
    expect(resolveUom("onzas")?.name).toBe("oz");
    expect(resolveUom("litros")?.name).toBe("L");
    expect(resolveUom("galones")?.name).toBe("gal (US)");
    expect(resolveUom("metros")?.name).toBe("m");
    expect(resolveUom("centimetros")?.name).toBe("cm");
    expect(resolveUom("kilometros")?.name).toBe("km");
    expect(resolveUom("pulgadas")?.name).toBe("in");
    expect(resolveUom("pies")?.name).toBe("ft");
    expect(resolveUom("yardas")?.name).toBe("yd");
    expect(resolveUom("millas")?.name).toBe("mi");
    expect(resolveUom("metros cuadrados")?.name).toBe("m²");
    expect(resolveUom("pies cuadrados")?.name).toBe("ft²");
    expect(resolveUom("metros cubicos")?.name).toBe("m³");
    expect(resolveUom("pies cubicos")?.name).toBe("ft³");
    expect(resolveUom("onzas fluidas")?.name).toBe("fl oz (US)");
    expect(resolveUom("cuartos")?.name).toBe("qt (US)");
  });

  it("alias: sinonimos de empaque y genericos es_GT", () => {
    expect(resolveUom("cajas")?.name).toBe("Caja");
    expect(resolveUom("cajitas")?.name).toBe("Cajita");
    expect(resolveUom("cartones")?.name).toBe("Carton");
    expect(resolveUom("tiras")?.name).toBe("Tira");
    expect(resolveUom("paquetes")?.name).toBe("Paquete");
    expect(resolveUom("fardos")?.name).toBe("Fardo");
    // Ambiguos NO tienen alias: "unidades" ya es entrada canonica exacta
    // (no debe caer en "Units"); "dias" ya matchea "Dias" por normalizacion.
    expect(resolveUom("unidades")?.name).toBe("Unidades");
    expect(resolveUom("dias")?.name).toBe("Dias");
  });

  it("alias: solo aplica cuando no hay match directo (el catalogo extensible gana)", () => {
    // Si el usuario registra "kilos" como entrada real via uoms.json, el
    // registro en memoria gana sobre el alias estatico.
    registerUoms([{ name: "kilos", category: "Peso" }]);
    expect(resolveUom("kilos")?.category).toBe("Peso");
    // Sin alias para texturas libres que nunca seran unidad de medida.
    expect(resolveUom("fardo 408")).toBeUndefined();
    expect(isKnownUom("fardo 408")).toBe(false);
    expect(resolveUom("unidades extra")).toBeUndefined();
  });

  it("alias: case/acentos/trim normalizados por uomKey", () => {
    expect(resolveUom("KILOS")?.name).toBe("kg");
    expect(resolveUom("  Libras  ")?.name).toBe("lb");
    expect(resolveUom("Kílôs")?.name).toBe("kg");
    expect(resolveUom("Pies Cuadrados")?.name).toBe("ft²");
  });

  it("falla si registerUoms no cubre el registro completo", () => {
    // RED de guard: si el registry se rompe (e.g. override parcial), la
    // validacion no debe producir falsos positivos silenciosos.
    expect(isKnownUom("kg")).toBe(true);
    expect(resolveUom("L")?.name).toBe("L");
  });

  it("registerUoms reemplaza el catalogo en memoria", () => {
    registerUoms([{ name: "Caja", category: "Unidades" }]);
    expect(uomCategory("Caja")).toBe("Unidades");
    expect(uomCategory("kg")).toBeUndefined(); // el override reemplaza, no suma
  });

  it("listRegisteredUoms devuelve el catalogo VIGENTE (seed o override) y nunca la referencia interna", () => {
    // Sin override: igual al seed, pero siempre una copia (nunca `registry`/`UOMS`).
    expect(listRegisteredUoms()).toEqual(UOMS);
    expect(listRegisteredUoms()).not.toBe(UOMS);
    // Tras un override parcial: refleja el registro actual, no el seed.
    registerUoms([{ name: "Caja", category: "Unidades" }]);
    expect(listRegisteredUoms()).toEqual([{ name: "Caja", category: "Unidades" }]);
    expect(listRegisteredUoms()).not.toBe(UOMS);
  });
});