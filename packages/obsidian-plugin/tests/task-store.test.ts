import { beforeEach, describe, expect, it } from "vitest";
import { VaultTasks } from "../src/storage/task-store.js";
import { createTask, updateTask } from "@octasuite/core";
import { TFile } from "obsidian";

/**
 * Mock minimo de Vault + DataAdapter en memoria para VaultTasks.
 *
 * VaultTasks usa: adapter.exists/list/mkdir, vault.getAbstractFileByPath,
 * vault.read, vault.create, vault.modify, vault.delete. Modela el árbol
 * `{folder}/tasks/{scope}/{id}.md` del vault real.
 */
class MemoryVault {
  files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;
    // Un directorio existe si hay algún archivo por debajo de él.
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const p of this.files.keys()) if (p.startsWith(prefix)) return true;
    return false;
  }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const files: string[] = [];
    const folders = new Set<string>();
    for (const p of this.files.keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (rest.includes("/")) folders.add(`${path}/${rest.split("/")[0]}`);
      else files.push(p);
    }
    return { files, folders: [...folders] };
  }
  async mkdir(path: string): Promise<void> {
    // Los directorios no se modelan como entradas; su existencia se infiere.
    void path;
  }
  async read(_path: string): Promise<string> {
    throw new Error("read va por vault.read(TFile), no por adapter.read");
  }

  getAbstractFileByPath(path: string): TFile | null {
    if (!this.files.has(path)) return null;
    const tf = new TFile();
    (tf as unknown as { path: string }).path = path;
    return tf;
  }
  async read(tf: TFile): Promise<string> {
    const path = (tf as unknown as { path: string }).path;
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`No existe: ${path}`);
    return content;
  }
  async create(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async modify(tf: TFile, data: string): Promise<void> {
    const path = (tf as unknown as { path: string }).path;
    this.files.set(path, data);
  }
  async delete(tf: TFile): Promise<void> {
    const path = (tf as unknown as { path: string }).path;
    this.files.delete(path);
  }

  get adapter() {
    return this;
  }
}

describe("VaultTasks (archivos Markdown por scope)", () => {
  let vault: MemoryVault;
  let store: VaultTasks;

  beforeEach(() => {
    vault = new MemoryVault();
    store = new VaultTasks(vault as never, "octasuite-data");
  });

  it("guarda y lee una tarea en su scope (round-trip)", async () => {
    const task = createTask({ title: "Comprar arroz", scope: "global" });
    await store.saveTask(task);

    const loaded = await store.readTask(task.id, "global");
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe("Comprar arroz");
    expect(loaded?.scope).toBe("global");
  });

  describe("Regresión 2026-09-16 (Antigravity #3): orphan scope al cambiar de ámbito", () => {
    it("saveTask con scope cambiado NO deja el archivo viejo del scope anterior", async () => {
      const task = createTask({ title: "Tarea", scope: "global" });
      await store.saveTask(task);

      // La tarea se mueve a otro scope (empresa activa): mismo id, scope nuevo.
      const moved = updateTask(task, { scope: "empresa-uno" });
      await store.saveTask(moved);

      // El archivo del scope viejo debe desaparecer: solo existe en el scope nuevo.
      expect(vault.files.has(`octasuite-data/tasks/global/${task.id}.md`)).toBe(false);
      expect(vault.files.has(`octasuite-data/tasks/empresa-uno/${task.id}.md`)).toBe(true);

      // Y la lectura en el nuevo scope devuelve la tarea actualizada.
      const reloaded = await store.readTask(task.id, "empresa-uno");
      expect(reloaded?.scope).toBe("empresa-uno");
    });
  });

  describe("Regresión 2026-09-16 (Antigravity #5): filtro del .base de Obsidian Bases", () => {
    it("ensureBaseFile genera un filtro por PREFIJO de la carpeta de tareas (archivos en subcarpetas por scope)", async () => {
      await store.saveTask(createTask({ title: "T1", scope: "global" }));
      await store.ensureBaseFile();

      const content = vault.files.get("octasuite-data/tasks/tareas.base");
      expect(content).toBeDefined();

      // Los .md viven en `{folder}/tasks/{scope}/{id}.md`, así que el filtro
      // debe matchear por prefijo/startsWith la carpeta raíz de tareas, NO por
      // igualdad exacta contra folder raíz (nunca matchearía: file.folder de un
      // archivo en tasks/global/x.md es "octasuite-data/tasks/global").
      expect(content).not.toContain('file.folder == "octasuite-data/tasks"');
      expect(content).toContain('startsWith "octasuite-data/tasks/"');
    });
  });
});