import { mergeJournals, serializeEvent, type AnyEvent, type ParseResult } from "@octasuite/core";
import type { DataAdapter, Vault } from "obsidian";

// Fuente única de `DEFAULT_COMPANY_ID` en company-selection.ts (lógica pura);
// vault-journal la re-exporta para no romper a los consumidores existentes
// (settings, main, company-switcher, reports, tests).
import { DEFAULT_COMPANY_ID } from "../company-selection.js";
export { DEFAULT_COMPANY_ID } from "../company-selection.js";

/**
 * Cuantos eventos de la particion activa y del legacy plano. Un journal
 * participanado por empresa convive con la ruta plana vieja (`journal/{month}.jsonl`)
 * hasta que el vault se migra; ambos lados se leen, el merge deduplica por id.
 */
export class VaultJournal {
  constructor(
    private readonly vault: Vault,
    private readonly folder: string,
    /** Empresa activa: define la particion del journal (`journal/{companyId}/`). */
    private readonly companyId: string = DEFAULT_COMPANY_ID,
  ) {}

  /** Identidad del journal: la carpeta de datos. Los cambios de carpeta implican otro journal. */
  get folderName(): string {
    return this.folder;
  }

  /** Identidad del journal: la empresa activa (particion `journal/{companyId}/`). */
  get companyIdentifier(): string {
    return this.companyId;
  }

  private get adapter(): DataAdapter {
    return this.vault.adapter;
  }

  private get legacyJournalDir(): string {
    return `${this.folder}/journal`;
  }

  private companyDir(companyId: string = this.companyId): string {
    return `${this.folder}/journal/${companyId}`;
  }

  async ensureFolders(companyId: string = this.companyId): Promise<void> {
    for (const dir of [this.folder, this.legacyJournalDir, this.companyDir(companyId), `${this.folder}/catalogs`]) {
      if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
    }
  }

  /**
   * Todos los archivos .jsonl relevantes, incluidas las copias de conflicto:
   *  - los de la particion activa (`journal/{companyId}/*.jsonl`)
   *  - los del legacy plano (`journal/*.jsonl`), que es como vivia el journal
   *    antes de la multi-empresa. Una vez migrado el vault, esa carpeta deja
   *    de tener archivos y la lista queda solo con la particion.
   */
  async listJournalFiles(): Promise<string[]> {
    return [...(await this.listLegacyFiles()), ...(await this.listCompanyFiles(this.companyId))].sort();
  }

  private async listLegacyFiles(): Promise<string[]> {
    const files: string[] = [];
    if (await this.adapter.exists(this.legacyJournalDir)) {
      const listing = await this.adapter.list(this.legacyJournalDir);
      for (const f of listing.files) if (f.endsWith(".jsonl")) files.push(f);
    }
    return files;
  }

  private async listCompanyFiles(companyId: string): Promise<string[]> {
    const files: string[] = [];
    const dir = this.companyDir(companyId);
    if (await this.adapter.exists(dir)) {
      const listing = await this.adapter.list(dir);
      for (const f of listing.files) if (f.endsWith(".jsonl")) files.push(f);
    }
    return files;
  }

  /**
   * Las empresas con al menos una particion con archivos en el journal.
   * `adapter.list()` devuelve rutas completas (ej. `octasuite-data/journal/secundaria`),
   * pero `listCompanyFiles` espera el id simple; se extrae el basename de cada carpeta.
   */
  async listCompanyIds(): Promise<string[]> {
    if (!(await this.adapter.exists(this.legacyJournalDir))) return [];
    const listing = await this.adapter.list(this.legacyJournalDir);
    const ids: string[] = [];
    for (const folder of listing.folders) {
      // Obsidian puede reportar la carpeta con slash final; el basename debe
      // extraerse sobre la ruta normalizada para no quedar vacío.
      const normalized = folder.replace(/\/+$/, "");
      const companyId = normalized.slice(normalized.lastIndexOf("/") + 1);
      if ((await this.listCompanyFiles(companyId)).length > 0) ids.push(companyId);
    }
    return ids.sort();
  }

  /** Lee y reconcilia todo el historial. Devuelve tambien las lineas corruptas. */
  async loadAll(): Promise<ParseResult> {
    const files = await this.listJournalFiles();
    const contents: string[] = [];
    for (const file of files) contents.push(await this.adapter.read(file));
    return mergeJournals(...contents);
  }

  /**
   * Carga el historial de TODAS las empresas del journal, cada una por
   * separado: `Map<companyId, ParseResult>`. Los archivos legacy planos
   * pertenecen a la empresa por defecto ("principal"). Leer cada empresa en
   * su propio ParseResult permite proyectar cada particion por separado y
   * operar la activa (A) mientras las demas siguen en memoria (B).
   */
  async loadAllCompanies(): Promise<Map<string, ParseResult>> {
    const byCompany = new Map<string, string[]>();
    const legacy = await this.listLegacyFiles();
    if (legacy.length > 0) byCompany.set(DEFAULT_COMPANY_ID, [...legacy]);
    for (const companyId of await this.listCompanyIds()) {
      const files = await this.listCompanyFiles(companyId);
      const prev = byCompany.get(companyId) ?? [];
      byCompany.set(companyId, [...prev, ...files]);
    }

    const result = new Map<string, ParseResult>();
    for (const [companyId, files] of byCompany) {
      const contents: string[] = [];
      for (const file of files) contents.push(await this.adapter.read(file));
      result.set(companyId, mergeJournals(...contents));
    }
    return result;
  }

  private pathFor(event: AnyEvent, companyId: string = this.companyId): string {
    const month = event.at.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new RangeError(`Evento sin instante valido: ${event.at}`);
    }
    return `${this.companyDir(companyId)}/${month}.jsonl`;
  }

  async append(event: AnyEvent, companyId: string = this.companyId): Promise<void> {
    await this.ensureFolders(companyId);
    const path = this.pathFor(event, companyId);
    const line = serializeEvent(event);
    const adapter = this.adapter as DataAdapter & { append?: (p: string, d: string) => Promise<void> };

    if (typeof adapter.append === "function") {
      await adapter.append(path, line);
      return;
    }
    // Respaldo para adaptadores sin append: leer y reescribir. Mas fragil, por eso
    // es el segundo camino y no el primero.
    const previous = (await adapter.exists(path)) ? await adapter.read(path) : "";
    await adapter.write(path, previous + line);
  }

  async appendMany(events: readonly AnyEvent[], companyId?: string): Promise<void> {
    for (const event of events) await this.append(event, companyId);
  }
}
