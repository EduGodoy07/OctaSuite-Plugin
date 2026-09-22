import type { DataAdapter } from "obsidian";
import type { Pricelist, PricelistOverride } from "@octasuite/core";

/**
 * Catalogo de listas de precios del vault (`{folder}/catalogs/pricelists.json`),
 * gestionado por la UI (vista Precios / B-03). Sigue el patron de `uoms.json`:
 * - Lectura tolerante: una fila corrupta no tumba el catalogo (es un archivo
 *   personal, escrito por la UI), se filtra. Vacio o corrupto total => lista
 *   vacia (sin pricelists).
 * - Escrituras serializadas dentro de la instancia (mutex de read-modify-write)
 *   para que dos `save()` rapidos de saves de la misma ventana no se pisen.
 *   No cruza ventanas de Obsidian (cada ventana es un proceso JS aparte).
 *
 * El archivo es la fuente de verdad; el consumer (host) mantiene la copia en
 * memoria que reparte a las vistas.
 */

function isPricelist(v: unknown): v is Pricelist {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== "string" || p.id.length === 0) return false;
  if (typeof p.name !== "string" || p.name.length === 0) return false;
  if (p.factorBps !== undefined && (typeof p.factorBps !== "number" || !Number.isInteger(p.factorBps) || p.factorBps <= 0)) {
    return false;
  }
  if (!Array.isArray(p.overrides)) return false;
  for (const override of p.overrides as unknown[]) {
    const o = override as Partial<PricelistOverride>;
    if (typeof o?.productId !== "string" || typeof o?.priceMinor !== "number" || o.priceMinor < 0) return false;
  }
  return typeof p.createdAt === "string" && typeof p.updatedAt === "string";
}

export class VaultPricelists {
  constructor(private readonly folder: string, private readonly adapter: DataAdapter) {}

  private get path(): string {
    return `${this.folder}/catalogs/pricelists.json`;
  }

  /** Serializa los read-modify-write de `save`/`remove`. */
  private serial: Promise<void> = Promise.resolve();

  private async readAll(): Promise<Pricelist[]> {
    if (!(await this.adapter.exists(this.path))) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.adapter.read(this.path));
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter(isPricelist);
  }

  async load(): Promise<Pricelist[]> {
    return this.readAll();
  }

  /** Upsert: reemplaza si ya existe un pricelist con el mismo id, agrega si no. */
  async save(pricelist: Pricelist): Promise<boolean> {
    if (!isPricelist(pricelist)) return false;
    const run = this.serial.then(() => this.saveUnlocked(pricelist));
    this.serial = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async saveUnlocked(pricelist: Pricelist): Promise<boolean> {
    const current = await this.readAll();
    const next = [...current.filter((p) => p.id !== pricelist.id), pricelist];
    await this.adapter.write(this.path, JSON.stringify(next, null, 2));
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const run = this.serial.then(() => this.removeUnlocked(id));
    this.serial = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async removeUnlocked(id: string): Promise<boolean> {
    const current = await this.readAll();
    const next = current.filter((p) => p.id !== id);
    if (next.length === current.length) return false;
    if (next.length === 0) {
      // No queda ninguna lista: eliminar el archivo (un `[]` dejaria un catalogo
      // valido pero vacio que `load()` ya trataria como vacio de todos modos).
      await this.adapter.remove(this.path).catch(() => undefined);
    } else {
      await this.adapter.write(this.path, JSON.stringify(next, null, 2));
    }
    return true;
  }
}