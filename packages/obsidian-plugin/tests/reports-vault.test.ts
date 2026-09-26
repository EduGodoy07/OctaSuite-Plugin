import { beforeEach, describe, expect, it } from "vitest";
import { reportFileName, writeReportToVault } from "../src/ui/report-export.js";

/**
 * Adapter minimo en memoria para el vault (DataAdapter de Obsidian).
 * Modela tambien las carpetas: un archivo implica que sus carpetas padre
 * existen, igual que en un vault real.
 */
class MemoryAdapter {
  private entries = new Map<string, string>();
  private folders = new Set<string>();

  /** Registra las carpetas padre de un archivo (los archivos implican su carpeta). */
  private markParents(filePath: string): void {
    const parts = filePath.split("/");
    parts.pop();
    for (let i = 1; i <= parts.length; i++) {
      this.folders.add(parts.slice(0, i).join("/"));
    }
  }

  set(path: string, content: string): void {
    this.entries.set(path, content);
    this.markParents(path);
  }
  async exists(path: string): Promise<boolean> {
    return this.entries.has(path) || this.folders.has(path);
  }
  async read(path: string): Promise<string> {
    const content = this.entries.get(path);
    if (content === undefined) throw new Error(`No existe: ${path}`);
    return content;
  }
  async write(path: string, content: string): Promise<void> {
    this.entries.set(path, content);
    this.markParents(path);
  }
  async list(_path: string): Promise<{ files: string[]; folders: string[] }> {
    return { files: [], folders: [] };
  }
  get(path: string): string | undefined {
    return this.entries.get(path);
  }
  hasFolder(path: string): boolean {
    return this.folders.has(path);
  }
  createFolder(path: string): void {
    // En Obsidian real `vault.createFolder` LANZA si la carpeta ya existe.
    if (this.folders.has(path)) throw new Error(`Folder already exists: ${path}`);
    this.folders.add(path);
    this.markParents(path);
  }
}

/** Mock del vault de Obsidian (solo lo que usa writeReportToVault). */
function createMockVault(adapter: MemoryAdapter) {
  /** Registro de intentos de createFolder (para contar llamadas en tests). */
  const createFolderCalls: string[] = [];
  return {
    createFolderCalls,
    createFolder: async (path: string) => {
      createFolderCalls.push(path);
      adapter.createFolder(path);
    },
    getAbstractFileByPath: (path: string) => {
      // En Obsidian una carpeta existente también resuelve a un TFolder.
      if (adapter.hasFolder(path)) {
        return {
          path,
          children: [],
          isFolder: () => true,
        } as any;
      }
      const content = adapter.get(path);
      if (!content) return null;
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

  it("maneja carpeta ya existente sin fallar", async () => {
    // Pre-crear la carpeta (simular que ya existe)
    adapter.set("octasuite-data/reports/.keep", "");
    await writeReportToVault(vault, "octasuite-data/reports", "reporte-2026-09.md", "ok");
    expect(adapter.get("octasuite-data/reports/reporte-2026-09.md")).toBe("ok");
  });

  it("exporta dos veces al mismo folder sin volver a crear la carpeta", async () => {
    // 1er export: crea la carpeta y el archivo .md
    await writeReportToVault(vault, "octasuite-data/reports", "reporte-2026-09.md", "reporte md");
    // 2do export al MISMO folder con otro archivo: la carpeta ya existe, y en
    // Obsidian real `createFolder` lanzaria si se volviera a llamar.
    await writeReportToVault(vault, "octasuite-data/reports", "tablas-2026-09.csv", "tablas csv");

    expect(adapter.get("octasuite-data/reports/reporte-2026-09.md")).toBe("reporte md");
    expect(adapter.get("octasuite-data/reports/tablas-2026-09.csv")).toBe("tablas csv");
    // La carpeta se creo una sola vez (el 2do export no debe intentar crearla).
    expect(vault.createFolderCalls).toEqual(["octasuite-data/reports"]);
  });

  it("escribe en la ruta exacta {folder}/{filename} sin duplicar el folder (P0)", async () => {
    // Regresión del 2026-09-26: el caller pasaba `path` con el folder ya incluido
    // y la función volvía a anteponerlo -> `folder/folder/...`. El filename ahora
    // viene del helper reportFileName (que no admite "/"), y este test verifica
    // que el archivo aterriza en exactamente un folder de profundidad.
    const folder = "octasuite-data/reports";
    const filename = reportFileName("2026-09", "md");
    await writeReportToVault(vault, folder, filename, "# Reporte 2026-09");

    expect(adapter.get(`${folder}/${filename}`)).toBe("# Reporte 2026-09");
    // El path duplicado (folder/folder/filename) NO debe existir.
    expect(adapter.get(`${folder}/${folder}/${filename}`)).toBeUndefined();
  });
});
