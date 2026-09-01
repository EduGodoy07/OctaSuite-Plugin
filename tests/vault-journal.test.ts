import { describe, expect, it } from "vitest";
import { VaultJournal, DEFAULT_COMPANY_ID } from "../src/storage/vault-journal.js";
import type { AnyEvent, ParseResult } from "@octasuite/core";

/**
 * Adapter en memoria que modela el minimo de DataAdapter que usa VaultJournal:
 * exists, list, read, write, append, mkdir. Distingue carpetas (marcadas con
 * `__dir__`) de archivos para que list() devuelva files/folders como Obsidian.
 */
class MemoryAdapter {
  private entries = new Map<string, string>(); // path -> contenido o "__dir__"

  async exists(path: string): Promise<boolean> {
    return this.entries.has(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const files: string[] = [];
    const folders: string[] = [];
    for (const key of this.entries.keys()) {
      if (key === path || !key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.includes("/")) continue; // es un descendiente indirecto
      if (this.entries.get(key) === "__dir__") folders.push(key);
      else files.push(key);
    }
    return { files: files.sort(), folders: folders.sort() };
  }

  async read(path: string): Promise<string> {
    const content = this.entries.get(path);
    if (content === undefined || content === "__dir__") throw new Error(`No existe: ${path}`);
    return content;
  }

  async write(path: string, data: string): Promise<void> {
    if (data === "") throw new Error("write no se usa para crear carpetas");
    this.entries.set(path, data);
  }

  async append(path: string, data: string): Promise<void> {
    this.entries.set(path, `${this.entries.get(path) ?? ""}${data}`);
  }

  async mkdir(path: string): Promise<void> {
    this.entries.set(path, "__dir__");
  }
}

function adapter(vault: unknown): Vault {
  return vault as Vault;
}

/** Envelope minimo valido para mergeJournals: solo importa id/at/v/type/payload. */
function evt(id: string, at: string, type = "category.created"): AnyEvent {
  return { id, at, v: 1, type, payload: { categoryId: id, name: id, code: id.toUpperCase() } } as AnyEvent;
}

const FOLDER = "octasuite-data";

describe("VaultJournal (particion por empresa)", () => {
  it("lee el legacy plano (journal/{month}.jsonl) como hacia antes", async () => {
    const memory = new MemoryAdapter();
    const vault = adapter({ adapter: memory });
    await memory.mkdir(`${FOLDER}/journal`);
    await memory.write(`${FOLDER}/journal/2026-08.jsonl`, [
      JSON.stringify(evt("evt_1", "2026-08-25T18:02:48.850Z")),
      JSON.stringify(evt("evt_2", "2026-08-26T18:02:48.850Z")),
    ].join("\n") + "\n");

    const journal = new VaultJournal(vault, FOLDER);
    const { events, corrupt } = await journal.loadAll();
    expect(corrupt).toEqual([]);
    expect(events.map((e) => e.id)).toEqual(["evt_1", "evt_2"]);
  });

  it("escribe los eventos nuevos en journal/{companyId}/ y los lee junto al legacy sin duplicar", async () => {
    const memory = new MemoryAdapter();
    const vault = adapter({ adapter: memory });
    await memory.mkdir(`${FOLDER}/journal`);
    await memory.write(`${FOLDER}/journal/2026-08.jsonl`, JSON.stringify(evt("evt_legacy", "2026-08-25T18:02:48.850Z")) + "\n");

    const journal = new VaultJournal(vault, FOLDER, DEFAULT_COMPANY_ID);
    await journal.append(evt("evt_nuevo", "2026-08-27T18:02:48.850Z"));

    // El evento nuevo cae en la particion de la empresa por defecto.
    expect(await memory.exists(`${FOLDER}/journal/${DEFAULT_COMPANY_ID}/2026-08.jsonl`)).toBe(true);
    const { events, corrupt } = await journal.loadAll();
    expect(corrupt).toEqual([]);
    expect(events.map((e) => e.id)).toEqual(["evt_legacy", "evt_nuevo"]);
  });

  it("append con companyId explicito va a la particion de esa empresa", async () => {
    const memory = new MemoryAdapter();
    const vault = adapter({ adapter: memory });
    const journal = new VaultJournal(vault, FOLDER, DEFAULT_COMPANY_ID);
    await journal.append(evt("evt_secundaria", "2026-08-27T18:02:48.850Z"), "secundaria");

    expect(await memory.exists(`${FOLDER}/journal/secundaria/2026-08.jsonl`)).toBe(true);
    const files = await journal.listJournalFiles();
    // Solo la particion de la empresa activa (vacia) y ninguna otra empresa.
    expect(files.some((f) => f.includes("/secundaria/"))).toBe(false);
  });

  it("loadAll mezcla las copias de conflicto del sync", async () => {
    const memory = new MemoryAdapter();
    const vault = adapter({ adapter: memory });
    await memory.mkdir(`${FOLDER}/journal/${DEFAULT_COMPANY_ID}`);
    await memory.write(
      `${FOLDER}/journal/${DEFAULT_COMPANY_ID}/2026-08.jsonl`,
      JSON.stringify(evt("evt_a", "2026-08-25T18:02:48.850Z")) + "\n",
    );
    await memory.write(
      `${FOLDER}/journal/${DEFAULT_COMPANY_ID}/2026-08 1.jsonl`,
      JSON.stringify(evt("evt_b", "2026-08-26T18:02:48.850Z")) + "\n",
    );

    const journal = new VaultJournal(vault, FOLDER);
    const { events } = await journal.loadAll();
    expect(events.map((e) => e.id)).toEqual(["evt_a", "evt_b"]);
  });

  it("listCompanyIds devuelve las empresas con particion propia", async () => {
    const memory = new MemoryAdapter();
    const vault = adapter({ adapter: memory });
    await memory.mkdir(`${FOLDER}/journal`);
    await memory.mkdir(`${FOLDER}/journal/${DEFAULT_COMPANY_ID}`);
    await memory.mkdir(`${FOLDER}/journal/secundaria`);
    await memory.write(
      `${FOLDER}/journal/${DEFAULT_COMPANY_ID}/2026-08.jsonl`,
      JSON.stringify(evt("evt_p", "2026-08-25T18:02:48.850Z")) + "\n",
    );
    await memory.write(
      `${FOLDER}/journal/secundaria/2026-08.jsonl`,
      JSON.stringify(evt("evt_s", "2026-08-25T18:02:48.850Z")) + "\n",
    );
    // Una carpeta sin archivos (empresa sin datos) no cuenta.
    await memory.mkdir(`${FOLDER}/journal/vacia`);
    expect(await memory.exists(`${FOLDER}/journal/vacia`)).toBe(true);

    const journal = new VaultJournal(vault, FOLDER);
    expect(await journal.listCompanyIds()).toEqual([DEFAULT_COMPANY_ID, "secundaria"]);
  });

  it("loadAllCompanies carga cada empresa por separado, y el legacy plano es de 'principal'", async () => {
    const memory = new MemoryAdapter();
    const vault = adapter({ adapter: memory });
    // Legacy plano en la raiz del journal.
    await memory.mkdir(`${FOLDER}/journal`);
    await memory.write(`${FOLDER}/journal/2026-08.jsonl`, JSON.stringify(evt("evt_legacy", "2026-08-20T18:02:48.850Z")) + "\n");
    // Particiones de dos empresas.
    await memory.mkdir(`${FOLDER}/journal/${DEFAULT_COMPANY_ID}`);
    await memory.write(
      `${FOLDER}/journal/${DEFAULT_COMPANY_ID}/2026-08.jsonl`,
      JSON.stringify(evt("evt_principal", "2026-08-25T18:02:48.850Z")) + "\n",
    );
    await memory.mkdir(`${FOLDER}/journal/secundaria`);
    await memory.write(
      `${FOLDER}/journal/secundaria/2026-08.jsonl`,
      JSON.stringify(evt("evt_secundaria", "2026-08-27T18:02:48.850Z")) + "\n",
    );

    const journal = new VaultJournal(vault, FOLDER);
    const byCompany = await journal.loadAllCompanies();

    expect([...byCompany.keys()].sort()).toEqual(["principal", "secundaria"]);
    expect(byCompany.get("principal")!.events.map((e) => e.id)).toEqual(["evt_legacy", "evt_principal"]);
    expect(byCompany.get("secundaria")!.events.map((e) => e.id)).toEqual(["evt_secundaria"]);
  });

  it("identidad del journal cambia con la empresa activa (saveSettings decide recargar por esto)", async () => {
    const memory = new MemoryAdapter();
    const vault = adapter({ adapter: memory });

    const principal = new VaultJournal(vault, FOLDER, DEFAULT_COMPANY_ID);
    const secundaria = new VaultJournal(vault, FOLDER, "secundaria");

    expect(principal.folderName).toBe(secundaria.folderName);
    expect(principal.companyIdentifier).toBe(DEFAULT_COMPANY_ID);
    expect(secundaria.companyIdentifier).toBe("secundaria");
    // Misma carpeta, distinta empresa → identidad del journal distinta.
    expect(principal.folderName === secundaria.folderName && principal.companyIdentifier !== secundaria.companyIdentifier).toBe(true);
  });

  it("append con company.created crea la partición y listCompanyIds la incluye", async () => {
    const memory = new MemoryAdapter();
    const vault = adapter({ adapter: memory });
    const journal = new VaultJournal(vault, FOLDER, DEFAULT_COMPANY_ID);

    const event: AnyEvent = {
      id: "created_1",
      at: "2026-08-28T12:00:00.000Z",
      v: 1,
      type: "company.created",
      payload: { companyId: "nueva-empresa", name: "Nueva Empresa", baseCurrency: "USD" },
    } as AnyEvent;

    await journal.append(event, "nueva-empresa");

    // La partición debe existir con el archivo del mes.
    expect(await memory.exists(`${FOLDER}/journal/nueva-empresa/2026-08.jsonl`)).toBe(true);

    // El contenido del archivo debe contener el evento.
    const content = await memory.read(`${FOLDER}/journal/nueva-empresa/2026-08.jsonl`);
    const parsed = JSON.parse(content.trim()) as AnyEvent;
    expect(parsed.type).toBe("company.created");
    expect(parsed.payload).toMatchObject({ companyId: "nueva-empresa", name: "Nueva Empresa", baseCurrency: "USD" });

    // listCompanyIds debe devolver la empresa nueva.
    expect(await journal.listCompanyIds()).toContain("nueva-empresa");
  });

  it("listCompanyIds excluye empresas sin datos; la activa aún puede no estar en la lista", async () => {
    const memory = new MemoryAdapter();
    const vault = adapter({ adapter: memory });
    await memory.mkdir(`${FOLDER}/journal`);
    await memory.mkdir(`${FOLDER}/journal/${DEFAULT_COMPANY_ID}`);
    await memory.write(
      `${FOLDER}/journal/${DEFAULT_COMPANY_ID}/2026-08.jsonl`,
      JSON.stringify(evt("evt_p", "2026-08-25T18:02:48.850Z")) + "\n",
    );
    // Empresa sin partición ni datos.
    await memory.mkdir(`${FOLDER}/journal/sin_datos`);

    const journal = new VaultJournal(vault, FOLDER);
    expect(await journal.listCompanyIds()).toEqual([DEFAULT_COMPANY_ID]);
  });
});