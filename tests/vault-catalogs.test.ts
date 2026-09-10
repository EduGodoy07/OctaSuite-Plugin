import { beforeEach, describe, expect, it } from "vitest";
import { VaultCatalogs } from "../src/storage/vault-catalogs.js";
import {
  currencyMeta,
  unitOfMeasure,
  registerCurrencies,
  registerUnitsOfMeasure,
  registerUoms,
  resolveUom,
  UOMS,
  uomCategory,
} from "@octasuite/core";

/**
 * Adapter minimo en memoria: VaultCatalogs usa `exists`, `read` y `write` de
 * `DataAdapter`. Modela el archivo `{folder}/catalogs/*.json` en el vault.
 */
class MemoryAdapter {
  private entries = new Map<string, string>();
  set(path: string, content: string): void {
    this.entries.set(path, content);
  }
  async exists(path: string): Promise<boolean> {
    return this.entries.has(path);
  }
  async read(path: string): Promise<string> {
    const content = this.entries.get(path);
    if (content === undefined) throw new Error(`No existe: ${path}`);
    return content;
  }
  async write(path: string, content: string): Promise<void> {
    this.entries.set(path, content);
  }
  get(path: string): string | undefined {
    return this.entries.get(path);
  }
}

describe("VaultCatalogs (adaptador de vault)", () => {
  // Cada test arranca con el registry de UoM en el seed por defecto: el
  // registry es estado global y los overrides de `load()`/`saveUom` lo mutan.
  beforeEach(() => {
    registerUoms(UOMS);
  });

  it("sin archivos de catalogo conserva los seeds por defecto", async () => {
    registerCurrencies([{ code: "GTQ", name: "Quetzal", symbol: "Q", decimals: 2 }]);
    registerUnitsOfMeasure([{ code: "U", name: "UNIDAD", symbol: "u" }]);
    const adapter = new MemoryAdapter();
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    const result = await loader.load();
    expect(result.currencies).toBeUndefined();
    expect(result.uom).toBeUndefined();
    // Nada se registro: conserva el seed previo (GTQ / UNIDAD).
    expect(currencyMeta("GTQ")?.name).toBe("Quetzal");
    expect(unitOfMeasure("U")?.name).toBe("UNIDAD");
  });

  it("carga currencies.json y aplica el override al core", async () => {
    const adapter = new MemoryAdapter();
    adapter.set(
      "octasuite-data/catalogs/currencies.json",
      JSON.stringify([{ code: "MXN", name: "Peso mexicano", symbol: "MX$", decimals: 2 }]),
    );
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    const result = await loader.load();
    expect(result.currencies?.length).toBe(1);
    expect(currencyMeta("MXN")?.symbol).toBe("MX$");
    expect(currencyMeta("GTQ")).toBeUndefined();
  });

  it("carga uom-sat.json y aplica el override al core", async () => {
    const adapter = new MemoryAdapter();
    adapter.set(
      "octasuite-data/catalogs/uom-sat.json",
      JSON.stringify([{ code: "XKG", name: "KILOGRAMO", symbol: "kg" }]),
    );
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    const result = await loader.load();
    expect(result.uom?.length).toBe(1);
    expect(unitOfMeasure("XKG")?.name).toBe("KILOGRAMO");
  });

  it("catalogo vacio pero bien formado NO borra el seed (sin override)", async () => {
    registerCurrencies([{ code: "GTQ", name: "Quetzal", symbol: "Q", decimals: 2 }]);
    const adapter = new MemoryAdapter();
    adapter.set("octasuite-data/catalogs/currencies.json", JSON.stringify([]));
    adapter.set("octasuite-data/catalogs/uom-sat.json", JSON.stringify([]));
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    const result = await loader.load();
    // El loader trata un array vacio como "no hay override": conserva el seed.
    expect(result.currencies).toBeUndefined();
    expect(result.uom).toBeUndefined();
    expect(currencyMeta("GTQ")?.name).toBe("Quetzal");
  });

  it("decimals fuera de rango invalida la fila de moneda (no corrompe el registro)", async () => {
    registerCurrencies([{ code: "GTQ", name: "Quetzal", symbol: "Q", decimals: 2 }]);
    const adapter = new MemoryAdapter();
    // decimals negativos (-1) y no entero (0.5) deben ser rechazados por la guard.
    adapter.set(
      "octasuite-data/catalogs/currencies.json",
      JSON.stringify([
        { code: "USD", name: "Dolar", symbol: "$", decimals: -1 },
        { code: "EUR", name: "Euro", symbol: "€", decimals: 0.5 },
      ]),
    );
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    const result = await loader.load();
    expect(result.currencies).toBeUndefined();
    expect(currencyMeta("GTQ")?.name).toBe("Quetzal"); // seed intacto
  });

  it("archivo mal formado o invalido se ignora sin tumbar el arranque", async () => {
    const adapter = new MemoryAdapter();
    adapter.set("octasuite-data/catalogs/currencies.json", "{ no soy json");
    adapter.set("octasuite-data/catalogs/uom-sat.json", JSON.stringify([{ code: 42 }])); // shape invalida
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    const result = await loader.load(); // no lanza
    expect(result.currencies).toBeUndefined();
    expect(result.uom).toBeUndefined();
  });

  // --- Wiring de `catalogs/uoms.json` (UomEntry: {name, category}) ---

  it("carga uoms.json y aplica el override de UoM de negocio al core", async () => {
    const adapter = new MemoryAdapter();
    adapter.set(
      "octasuite-data/catalogs/uoms.json",
      JSON.stringify([
        { name: "Caja 24", category: "Unidades" },
        { name: "Kilos", category: "Peso" },
      ]),
    );
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    const result = await loader.load();
    expect(result.uoms?.length).toBe(2);
    // El override reemplaza el seed (mismo patron que uom-sat/currencies).
    expect(resolveUom("kg")).toBeUndefined();
    expect(resolveUom("Caja 24")?.category).toBe("Unidades");
    expect(resolveUom("kilos")?.category).toBe("Peso");
    expect(uomCategory("Kilos")).toBe("Peso");
  });

  it("uoms.json vacio pero bien formado NO borra el seed", async () => {
    const adapter = new MemoryAdapter();
    adapter.set("octasuite-data/catalogs/uoms.json", JSON.stringify([]));
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    const result = await loader.load();
    expect(result.uoms).toBeUndefined();
    expect(resolveUom("kg")?.category).toBe("Peso");
    expect(resolveUom("Caja")?.category).toBe("Empaque");
  });

  it("uoms.json con filas fuera de shape (code/symbol en vez de name/category) se ignora", async () => {
    const adapter = new MemoryAdapter();
    // Shape de uom-sat (code/name/symbol) NO es UomEntry: falta `category`.
    adapter.set("octasuite-data/catalogs/uoms.json", JSON.stringify([{ code: "XKG", name: "KILOGRAMO", symbol: "kg" }]));
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    const result = await loader.load(); // no lanza
    expect(result.uoms).toBeUndefined();
    // Seed intacto: el archivo estuvo presente pero no calificaba como override.
    expect(resolveUom("kg")?.category).toBe("Peso");
  });

  it("uoms.json con mezcla valida+invalida descarta solo las filas invalidas", async () => {
    const adapter = new MemoryAdapter();
    adapter.set(
      "octasuite-data/catalogs/uoms.json",
      JSON.stringify([
        { name: "Caja 24", category: "Unidades" },
        { name: 42, category: "Peso" }, // name no string
        { name: "SinCategoria" }, // falta category
      ]),
    );
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    const result = await loader.load();
    expect(result.uoms?.length).toBe(1);
    expect(resolveUom("Caja 24")?.category).toBe("Unidades");
  });

  // --- saveUom: agregar UoM de negocio desde la UI ---

  it("saveUom escribe uoms.json, deduplica por nombre normalizado y sincroniza el registro", async () => {
    const adapter = new MemoryAdapter();
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    await loader.load();

    const saved = await loader.saveUom({ name: "Caja 24", category: "Unidades" });
    expect(saved).toBe(true);
    // En memoria (para la sesion actual).
    expect(resolveUom("Caja 24")?.category).toBe("Unidades");
    // En disco: archivo escrito con seed completo + la nueva entrada.
    // (Sin archivo previo, saveUom materializa el catalogo efectivo — regresion:
    //  antes solo escribia la nueva entrada y pisaba el seed en memoria.)
    const onDisk = JSON.parse(adapter.get("octasuite-data/catalogs/uoms.json") ?? "[]") as Array<{ name: string }>;
    expect(onDisk).toHaveLength(UOMS.length + 1);
    expect(onDisk[onDisk.length - 1]).toEqual({ name: "Caja 24", category: "Unidades" });
    expect(onDisk.some((u) => u.name === "kg")).toBe(true);

    // Dedup normalizado: "caja 24" (case/acentos) no crea duplicado.
    const duplicate = await loader.saveUom({ name: "CAJA 24", category: "Peso" });
    expect(duplicate).toBe(false);
    expect(resolveUom("Caja 24")?.category).toBe("Unidades"); // sin override
    const onDiskAfter = JSON.parse(adapter.get("octasuite-data/catalogs/uoms.json") ?? "[]");
    expect(onDiskAfter).toHaveLength(UOMS.length + 1); // seed + [Caja 24]
  });

  it("saveUom sin archivo previo materializa seed + nueva (no pierde el seed en el registro)", async () => {
    const adapter = new MemoryAdapter();
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    await loader.load(); // sin uoms.json -> registry = seed

    const saved = await loader.saveUom({ name: "Bolsa 5kg", category: "Empaque" });
    expect(saved).toBe(true);

    // La nueva UoM quedo registrada...
    expect(resolveUom("Bolsa 5kg")?.category).toBe("Empaque");

    // ...pero el seed SIGUE resolviendo (regresion: antes se pisaba con solo la nueva).
    expect(resolveUom("kg")?.category).toBe("Peso");
    expect(resolveUom("kilos")?.name).toBe("kg");
    expect(resolveUom("Units")?.category).toBe("Unidades");

    // En disco queda el catalogo efectivo completo (seed + nueva), no solo la nueva.
    const onDisk = JSON.parse(adapter.get("octasuite-data/catalogs/uoms.json") ?? "[]") as Array<{ name: string }>;
    expect(onDisk).toHaveLength(UOMS.length + 1);
    expect(onDisk.some((u) => u.name === "kg")).toBe(true);
    expect(onDisk.some((u) => u.name === "Bolsa 5kg")).toBe(true);
  });

  it("saveUom sobre catalogo existente agrega sin pisar entradas previas", async () => {
    const adapter = new MemoryAdapter();
    adapter.set("octasuite-data/catalogs/uoms.json", JSON.stringify([{ name: "Caja 24", category: "Unidades" }]));
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    await loader.load();

    const saved = await loader.saveUom({ name: "Paca 48", category: "Empaque" });
    expect(saved).toBe(true);
    const onDisk = JSON.parse(adapter.get("octasuite-data/catalogs/uoms.json") ?? "[]");
    expect(onDisk).toEqual([
      { name: "Caja 24", category: "Unidades" },
      { name: "Paca 48", category: "Empaque" },
    ]);
    expect(resolveUom("Paca 48")?.category).toBe("Empaque");
  });

  it("saveUom con uoms.json vacio ([]) materializa seed + nueva (no vacia el catalogo)", async () => {
    const adapter = new MemoryAdapter();
    adapter.set("octasuite-data/catalogs/uoms.json", "[]");
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    await loader.load(); // [] tolerado como "sin override" -> registry = seed

    const saved = await loader.saveUom({ name: "Paca 60", category: "Empaque" });
    expect(saved).toBe(true);
    // El seed sigue resolviendo y el archivo queda seed + nueva (una entrada
    // vacia no es un override legitimo — es un catalogo inexistente).
    expect(resolveUom("kg")?.category).toBe("Peso");
    const onDisk = JSON.parse(adapter.get("octasuite-data/catalogs/uoms.json") ?? "[]") as Array<{ name: string }>;
    expect(onDisk).toHaveLength(UOMS.length + 1);
    expect(onDisk.some((u) => u.name === "kg")).toBe(true);
    expect(onDisk.some((u) => u.name === "Paca 60")).toBe(true);
  });

  it("saveUom con uoms.json corrupto no lanza y auto-repara con seed + nueva", async () => {
    const adapter = new MemoryAdapter();
    adapter.set("octasuite-data/catalogs/uoms.json", "{ no soy json");
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    await loader.load(); // corrupto tolerado -> registry = seed (sin crash)

    const saved = await loader.saveUom({ name: "Paca 72", category: "Empaque" });
    expect(saved).toBe(true);
    expect(resolveUom("kg")?.category).toBe("Peso");
    const onDisk = JSON.parse(adapter.get("octasuite-data/catalogs/uoms.json") ?? "[]") as Array<{ name: string }>;
    expect(onDisk).toHaveLength(UOMS.length + 1);
    expect(onDisk.some((u) => u.name === "Paca 72")).toBe(true);
  });

  // --- Serializacion de writes (multi-ventana: dos saves en vuelo) ---

  // Adapter con write retardado: sin mutex, dos saveUom en paralelo alcanzan a
  // leer el archivo ANTES de que el primero lo escriba -> lost update (la
  // segunda pisa a la primera). Con mutex, la seccion critica corre de a una.
  class SlowWriteAdapter extends MemoryAdapter {
    async write(path: string, content: string): Promise<void> {
      await new Promise((r) => setTimeout(r, 5));
      return super.write(path, content);
    }
  }

  it("saveUom concurrente de entradas distintas no pierde ninguna (sin lost update)", async () => {
    const adapter = new SlowWriteAdapter();
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    await loader.load(); // registry = seed (sin uoms.json previo)

    const [a, b] = await Promise.all([
      loader.saveUom({ name: "Caja 24", category: "Unidades" }),
      loader.saveUom({ name: "Paca 48", category: "Empaque" }),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);

    const onDisk = JSON.parse(adapter.get("octasuite-data/catalogs/uoms.json") ?? "[]") as Array<{ name: string }>;
    const names = onDisk.map((u) => u.name);
    expect(names).toContain("Caja 24");
    expect(names).toContain("Paca 48");
    expect(names).toHaveLength(UOMS.length + 2);
  });

  it("saveUom concurrente del mismo nombre deduplica (solo una gana)", async () => {
    const adapter = new SlowWriteAdapter();
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    await loader.load();

    const [a, b] = await Promise.all([
      loader.saveUom({ name: "Caja 24", category: "Unidades" }),
      loader.saveUom({ name: "CAJA 24", category: "Peso" }),
    ]);
    // Exactamente una gana: la segunda espera, relee la primera y deduplica por
    // nombre normalizado (sin mutex ambas verian el seed y devolverian true).
    expect(a === b).toBe(false);
    expect(a || b).toBe(true);

    const onDisk = JSON.parse(adapter.get("octasuite-data/catalogs/uoms.json") ?? "[]") as Array<{ name: string }>;
    expect(onDisk).toHaveLength(UOMS.length + 1);
    expect(onDisk.some((u) => u.name === "Caja 24")).toBe(true);
    // Sin duplicado normalizado (case/acentos) en disco.
    expect(onDisk.filter((u) => u.name === "Caja 24" || u.name === "CAJA 24")).toHaveLength(1);
  });

  // Adapter que falla el primer write: valida que un write fallido deja la
  // cadena del mutex viva para el siguiente save encolado.
  class FlakyWriteAdapter extends MemoryAdapter {
    private writes = 0;
    async write(path: string, content: string): Promise<void> {
      this.writes += 1;
      if (this.writes === 1) throw new Error("flaky write");
      return super.write(path, content);
    }
  }

  it("saveUom con write fallido no rompe la cadena: el siguiente save encolado completa", async () => {
    const adapter = new FlakyWriteAdapter();
    const loader = new VaultCatalogs("octasuite-data", adapter as never);
    await loader.load(); // registry = seed (sin uoms.json previo)

    // Ambos se encolan: el segundo queda detras del primero (que fallara).
    const first = loader.saveUom({ name: "Caja 24", category: "Unidades" });
    const second = loader.saveUom({ name: "Paca 48", category: "Empaque" });

    // El primero rechaza (write fallido)...
    await expect(first).rejects.toThrow("flaky write");
    // ...pero la cadena absorbe el rechazo y el segundo procede y persiste.
    await expect(second).resolves.toBe(true);

    const onDisk = JSON.parse(adapter.get("octasuite-data/catalogs/uoms.json") ?? "[]") as Array<{ name: string }>;
    const names = onDisk.map((u) => u.name);
    expect(names).toContain("Paca 48");
    expect(names).not.toContain("Caja 24");
    expect(names).toHaveLength(UOMS.length + 1);
  });
});
