import {
  parseTask,
  serializeTask,
  TASK_SCOPE_GLOBAL,
  type Task,
} from "@octasuite/core";
import { TFile, Vault } from "obsidian";

/**
 * Tareas en archivos Markdown del vault (`{folder}/tasks/{scope}/{id}.md`).
 *
 * Las tareas son archivos legibles/auditables, no eventos del journal: del
 * mismo modo que los catálogos, `serializeTask`/`parseTask` del core son la
 * fuente de verdad del formato. Las mutaciones usan la API de Vault (TFile)
 * para que Obsidian indexe los .md; el listado usa `adapter.list` porque
 * Vault no lo expone (misma estrategia que el journal para enumerar archivos).
 */
export class VaultTasks {
  constructor(
    private readonly vault: Vault,
    private readonly folder: string,
  ) {}

  private get adapter() {
    return this.vault.adapter;
  }

  private tasksDir(scope: string): string {
    return `${this.folder}/tasks/${scope}`;
  }

  private pathFor(id: string, scope: string): string {
    return `${this.tasksDir(scope)}/${id}.md`;
  }

  /** Crea la carpeta de tareas del scope si hace falta. */
  async ensureFolder(scope: string): Promise<void> {
    const dir = this.tasksDir(scope);
    if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
  }

  /** Todas las tareas del scope. Los .md corruptos se ignoran (lista útil). */
  async listTasks(scope: string): Promise<Task[]> {
    const dir = this.tasksDir(scope);
    const tasks: Task[] = [];
    if (!(await this.adapter.exists(dir))) return tasks;
    const listing = await this.adapter.list(dir);
    for (const file of listing.files) {
      if (!file.endsWith(".md")) continue;
      const tf = this.vault.getAbstractFileByPath(file);
      if (!(tf instanceof TFile)) continue;
      const parsed = parseTask(await this.vault.read(tf));
      if (parsed.ok) tasks.push(parsed.task);
    }
    return tasks;
  }

  /** Lee una tarea por id dentro del scope, o null si no existe/corrupta. */
  async readTask(id: string, scope: string): Promise<Task | null> {
    const tf = this.vault.getAbstractFileByPath(this.pathFor(id, scope));
    if (!(tf instanceof TFile)) return null;
    const parsed = parseTask(await this.vault.read(tf));
    return parsed.ok ? parsed.task : null;
  }

  /** Crea la tarea si no existe o sobrescribe su archivo. */
  async saveTask(task: Task): Promise<void> {
    const scope = task.scope.trim() || TASK_SCOPE_GLOBAL;
    await this.ensureFolder(scope);
    const path = this.pathFor(task.id, scope);
    const data = serializeTask(task);
    const tf = this.vault.getAbstractFileByPath(path);
    // En la API Vault de Obsidian, `modify` actualiza un TFile existente y `create`
    // genera uno nuevo. Esto garantiza que Obsidian indexe y dispare eventos nativos de vault.
    if (tf instanceof TFile) await this.vault.modify(tf, data);
    else await this.vault.create(path, data);
  }

  /** Elimina el archivo de la tarea si existe. */
  async deleteTask(task: Task): Promise<void> {
    const tf = this.vault.getAbstractFileByPath(
      this.pathFor(task.id, task.scope),
    );
    if (tf instanceof TFile) await this.vault.delete(tf);
  }

  /** Ruta al archivo .base de Obsidian Bases para tareas. */
  baseFilePath(): string {
    return `${this.folder}/tasks/tareas.base`;
  }

  /**
   * Genera el archivo .base de Obsidian Bases en `{folder}/tasks/tareas.base`
   * si no existe, permitiendo vistas nativas de tabla y consulta en Obsidian Bases.
   */
  async ensureBaseFile(): Promise<void> {
    const path = this.baseFilePath();
    if (await this.adapter.exists(path)) return;
    const parent = `${this.folder}/tasks`;
    if (!(await this.adapter.exists(parent))) await this.adapter.mkdir(parent);
    const content = `# Obsidian Bases — Vista de Tareas OctaSuite
filters:
  and:
    - file.folder == "${this.folder}/tasks"
views:
  - type: table
    name: Todas las tareas
    order:
      - field: due
        direction: asc
    columns:
      - title
      - status
      - priority
      - due
      - scope
`;
    await this.vault.create(path, content);
  }
}