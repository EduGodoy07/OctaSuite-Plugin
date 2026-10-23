import { beforeEach, describe, expect, it } from "vitest";
import { writeReportToVault } from "../src/ui/report-export.js";

/**
 * Adapter minimo en memoria para el vault (DataAdapter de Obsidian).
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
  async list(_path: string): Promise<{ files: string[]; folders: string[] }> {
    return { files: [], folders: [] };
  }
  get(path: string): string | undefined {
    return this.entries.get(path);
  }
}

/** Mock del vault de Obsidian (solo lo que usa writeReportToVault). */
function createMockVault(adapter: MemoryAdapter) {
  const folders = new Set<string>();
  return {
    createFolder: async (path: string) => {
      // Obsidian Vault.createFolder rechaza carpetas que ya existen.
      if (folders.has(path)) throw new Error(`Folder already exists: ${path}`);
      folders.add(path);
    },
    getAbstractFileByPath: (path: string) => {
      if (folders.has(path)) return { path, children: [] } as any;
      const content = adapter.get(path);
      if (content === undefined) return null;
      return {
        path,
        instanceof: () => true,
      } as any;
    },
    modify: async (file: any, content: string) => {
      await adapter.write(file.path, content);
    },
    create: async (path: string, content: string) => {
      await adapter.write(path, content);
    },
    adapter,
  };
}

describe("writeReportToVault (B-04)", () => {
  let adapter: MemoryAdapter;
  let vault: ReturnType<typeof createMockVault>;

  beforeEach(() => {
    adapter = new MemoryAdapter();
    vault = createMockVault(adapter);
  });

  it("crea carpeta y archivo .md si no existe", async () => {
    await writeReportToVault(vault, "octasuite-data/reports", "reporte-2026-09.md", "# Reporte 2026-09\n\nContenido");
    expect(adapter.get("octasuite-data/reports/reporte-2026-09.md")).toBe("# Reporte 2026-09\n\nContenido");
  });

  it("crea carpeta y archivo .csv si no existe", async () => {
    await writeReportToVault(vault, "octasuite-data/reports", "tablas-2026-09.csv", "# KPIs\nFacturado,\"Q 1,000.00\"\n");
    expect(adapter.get("octasuite-data/reports/tablas-2026-09.csv")).toBe("# KPIs\nFacturado,\"Q 1,000.00\"\n");
  });

  it("sobrescribe archivo existente (modify)", async () => {
    adapter.set("octasuite-data/reports/reporte-2026-09.md", "contenido viejo");
    await writeReportToVault(vault, "octasuite-data/reports", "reporte-2026-09.md", "contenido nuevo");
    expect(adapter.get("octasuite-data/reports/reporte-2026-09.md")).toBe("contenido nuevo");
  });

  it("maneja carpeta ya existente sin volver a crearla", async () => {
    // El mock usa el mismo contrato que Obsidian: createFolder lanza si ya existe.
    await vault.createFolder("octasuite-data/reports");
    await writeReportToVault(vault, "octasuite-data/reports", "reporte-2026-09.md", "ok");
    expect(adapter.get("octasuite-data/reports/reporte-2026-09.md")).toBe("ok");
  });
});