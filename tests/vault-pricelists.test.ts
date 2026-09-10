import { beforeEach, describe, expect, it } from "vitest";
import { VaultPricelists } from "../src/storage/vault-pricelists.js";
import type { Pricelist } from "@octasuite/core";

/** Adapter minimo en memoria: `exists`, `read`, `write` de `DataAdapter`. */
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

const makePricelist = (id: string, name: string): Pricelist => ({
  id,
  name,
  factorBps: 9000,
  overrides: [],
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
});

describe("VaultPricelists (catalogo de listas de precios)", () => {
  let adapter: MemoryAdapter;
  let vault: VaultPricelists;

  beforeEach(() => {
    adapter = new MemoryAdapter();
    vault = new VaultPricelists("octasuite-data", adapter as never);
  });

  it("sin archivo devuelve lista vacia", async () => {
    expect(await vault.load()).toEqual([]);
  });

  it("lee pricelists.json y repara filas invalidas (tolerante)", async () => {
    adapter.set(
      "octasuite-data/catalogs/pricelists.json",
      JSON.stringify([
        makePricelist("pl-1", "Revendedores"),
        { id: 42 },
      ]),
    );
    const loaded = await vault.load();
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.name).toBe("Revendedores");
  });

  it("save agrega y persiste; load lo devuelve", async () => {
    expect(await vault.save(makePricelist("pl-1", "Revendedores"))).toBe(true);
    const loaded = await vault.load();
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.factorBps).toBe(9000);
  });

  it("save con mismo id reemplaza sin duplicar (upsert)", async () => {
    await vault.save(makePricelist("pl-1", "Revendedores"));
    await vault.save({ ...makePricelist("pl-1", "Mayorista"), factorBps: 8500 });
    const loaded = await vault.load();
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.name).toBe("Mayorista");
    expect(loaded[0]?.factorBps).toBe(8500);
  });

  it("remove quita la lista del archivo", async () => {
    await vault.save(makePricelist("pl-1", "Revendedores"));
    await vault.save(makePricelist("pl-2", "Retail"));
    expect(await vault.remove("pl-1")).toBe(true);
    const loaded = await vault.load();
    expect(loaded.map((p) => p.id)).toEqual(["pl-2"]);
  });

  it("archivo corrupto se auto-repara en el primer save (una fila no tumba el resto)", async () => {
    adapter.set("octasuite-data/catalogs/pricelists.json", "{corrupto");
    await vault.save(makePricelist("pl-1", "Nueva"));
    const loaded = await vault.load();
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.id).toBe("pl-1");
  });
});