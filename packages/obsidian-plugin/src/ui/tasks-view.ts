import {
  createTask,
  parseNaturalTask,
  toIsoDate,
  transitionTask,
  updateTask,
  TASK_ALLOWED_TRANSITIONS,
  TASK_PRIORITIES,
  TASK_SCOPE_GLOBAL,
  TASK_STATUSES,
  taskIsDone,
  taskIsDueSoon,
  taskIsTerminal,
  taskIsOverdue,
  taskScopeVisibleIn,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@octasuite/core";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { TASKS_VIEW_TYPE } from "../modules.js";
import { ConfirmModal } from "./confirm-modal.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";
import { TaskModal } from "./task-modal.js";

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Abierta",
  "in-progress": "En curso",
  waiting: "En espera",
  blocked: "Bloqueada",
  paused: "Pausada",
  done: "Hecha",
  cancelled: "Cancelada",
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: "#6c757d",
  "in-progress": "#0d6efd",
  waiting: "#ffc107",
  blocked: "#dc3545",
  paused: "#fd7e14",
  done: "#198754",
  cancelled: "#adb5bd",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

/**
 * Lista de tareas por archivos del vault, con ámbitos Empresa/Global.
 * Los chips y la búsqueda re-renderizan solo la tabla (no pierden el foco);
 * cambiar de ámbito o estado re-renderiza todo porque también cambian los chips.
 */
export class TasksView extends ItemView {
  private filter = "";
  private statusFilter: TaskStatus | "all" = "all";
  /**
   * Ámbito de tareas de la vista (null = empresa activa; cualquier otro = scope explícito, ej. "global").
   * Se nombra `taskScope` y no `scope` porque `ItemView` ya posee la propiedad pública `scope: Scope`
   * (atajos y hotkeys locales de Obsidian), evitando colisiones de tipo con la clase base.
   */
  private taskScope: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return TASKS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Tareas";
  }

  override getIcon(): string {
    return "list-checks";
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private currentScope(): string {
    return this.taskScope ?? this.host.settings.activeCompanyId;
  }

  private render(): void {
    const { contentEl, host } = this;
    contentEl.empty();
    contentEl.addClass("octa");

    void host.tasks.ensureBaseFile();

    const bar = moduleHeader(
      contentEl,
      "Tareas",
      host,
      this.app,
      this.leaf,
      TASKS_VIEW_TYPE,
    );
    const tools = bar.createDiv({ cls: "octa-period" });
    const search = tools.createEl("input", { cls: "octa-search" });
    search.type = "search";
    search.placeholder = "Buscar título o notas…";
    search.value = this.filter;
    search.oninput = () => {
      this.filter = search.value.trim();
      void this.renderTable();
    };
    tools
      .createEl("button", { text: "+ Tarea", cls: "mod-cta" })
      .onclick = () => this.openEditor();

    // Captura rápida en lenguaje natural (estilo TaskNotes)
    const quickBar = contentEl.createDiv({ cls: "octa-period octa-quick-task" });
    const quickInput = quickBar.createEl("input", { cls: "octa-search" });
    quickInput.type = "text";
    quickInput.placeholder = "Captura rápida: ej. Pagar SAT mañana !urgent @global (Enter para crear)…";
    quickInput.onkeydown = async (ev) => {
      if (ev.key === "Enter" && quickInput.value.trim()) {
        const val = quickInput.value.trim();
        const parsed = parseNaturalTask(val);
        // Guardia de ámbito: si el usuario escribió un @ámbito que no es visible
        // bajo la empresa activa (no es "global" ni la empresa actual), no crear
        // una tarea en un ámbito huérfano: avisar y caer al ámbito visible.
        let scope = parsed.scope ?? this.currentScope();
        if (
          parsed.scope &&
          !taskScopeVisibleIn(parsed.scope, this.host.settings.activeCompanyId)
        ) {
          new Notice(
            `Ámbito @${parsed.scope} no existe en la empresa activa; se usó "${this.currentScope()}".`,
          );
          scope = this.currentScope();
        }
        try {
          await this.host.tasks.saveTask(createTask({ ...parsed, scope }));
          quickInput.value = "";
          new Notice(`Tarea creada: ${parsed.title}`);
          await this.renderTable();
        } catch (err) {
          new Notice(`Error al crear tarea: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };

    // KPIs (se llenan en renderTable)
    const kpis = contentEl.createDiv({ cls: "octa-kpi-row" });
    void kpis;

    // Ámbito
    const scopeChips = contentEl.createDiv({ cls: "octa-period" });
    const companyBtn = scopeChips.createEl("button", {
      text: "Empresa",
      cls: this.taskScope === null ? "mod-cta" : "",
    });
    companyBtn.onclick = () => {
      this.taskScope = null;
      this.render();
    };
    const globalBtn = scopeChips.createEl("button", {
      text: "Global",
      cls: this.taskScope === TASK_SCOPE_GLOBAL ? "mod-cta" : "",
    });
    globalBtn.onclick = () => {
      this.taskScope = TASK_SCOPE_GLOBAL;
      this.render();
    };

    // Estado
    const chips = contentEl.createDiv({ cls: "octa-period" });
    const allBtn = chips.createEl("button", {
      text: "Todos",
      cls: this.statusFilter === "all" ? "mod-cta" : "",
    });
    allBtn.onclick = () => {
      this.statusFilter = "all";
      this.render();
    };
    for (const status of TASK_STATUSES) {
      const btn = chips.createEl("button", {
        text: STATUS_LABEL[status],
        cls: this.statusFilter === status ? "mod-cta" : "",
      });
      btn.onclick = () => {
        this.statusFilter = status;
        this.render();
      };
    }

    // Tabla
    contentEl.createDiv({ cls: "octa-list-slot" });
    void this.renderTable();
  }

  private kpi(parent: HTMLElement, label: string, value: string): void {
    const card = parent.createDiv({ cls: "octa-kpi" });
    card.createDiv({ cls: "octa-kpi-value", text: value });
    card.createDiv({ cls: "octa-kpi-label", text: label });
  }

  private async renderTable(): Promise<void> {
    const { contentEl, host } = this;
    const scope = this.currentScope();
    const tasks = await host.tasks.listTasks(scope);

    const kpis = contentEl.querySelector<HTMLElement>(".octa-kpi-row");
    if (kpis) {
      kpis.empty();
      const today = toIsoDate(new Date());
      const pending = tasks.filter((t) => !taskIsTerminal(t.status));
      const dueSoon = tasks.filter((t) => taskIsDueSoon(t, today));
      const overdue = tasks.filter((t) => taskIsOverdue(t));
      const done = tasks.filter((t) => taskIsDone(t));
      this.kpi(kpis, "Pendientes", String(pending.length));
      this.kpi(kpis, "Por vencer", String(dueSoon.length));
      this.kpi(kpis, "Vencidas", String(overdue.length));
      this.kpi(kpis, "Hechas", String(done.length));
    }

    const slot = contentEl.querySelector(".octa-list-slot");
    if (!slot) return;
    slot.empty();

    const filtered = this.applyFilters(tasks);
    if (filtered.length === 0) {
      slot.createEl("p", {
        text: this.filter
          ? "Sin resultados para el filtro."
          : "No hay tareas en este ámbito.",
        cls: "octa-empty",
      });
      return;
    }

    const wrap = slot.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const head of [
      "Título",
      "Estado",
      "Prioridad",
      "Vencimiento",
      "Creada",
      "",
    ]) {
      headRow.createEl("th", { text: head });
    }
    const tbody = table.createEl("tbody");
    for (const task of filtered) this.row(tbody, task);
  }

  private applyFilters(tasks: Task[]): Task[] {
    let out = tasks;
    if (this.statusFilter !== "all") {
      out = out.filter((t) => t.status === this.statusFilter);
    }
    if (this.filter !== "") {
      const q = this.filter.toLowerCase();
      out = out.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.body ? t.body.toLowerCase().includes(q) : false),
      );
    }
    return out;
  }

  private row(tbody: HTMLElement, task: Task): void {
    const tr = tbody.createEl("tr");

    tr.createEl("td").createSpan({ text: task.title });

    const statusTd = tr.createEl("td");
    const chip = statusTd.createSpan({
      text: STATUS_LABEL[task.status],
      cls: "octa-chip",
    });
    chip.style.backgroundColor = STATUS_COLORS[task.status] ?? "#6c757d";
    chip.style.color = "#fff";

    tr.createEl("td").createSpan({
      text: PRIORITY_LABEL[task.priority],
      cls: "octa-chip",
    });
    tr.createEl("td").createSpan({
      text: task.due ?? "—",
      cls: "octa-mono",
    });
    tr.createEl("td").createSpan({
      text: task.created.slice(0, 10),
      cls: "octa-mono",
    });

    const actions = tr.createEl("td").createDiv({ cls: "octa-actions" });
    actions.createEl("button", { text: "Editar" }).onclick = () =>
      this.openEditor(task);

    for (const target of TASK_ALLOWED_TRANSITIONS[task.status] ?? []) {
      const btn = actions.createEl("button", {
        text: STATUS_LABEL[target],
      });
      btn.title = `Cambiar a ${STATUS_LABEL[target]}`;
      btn.onclick = () => void this.transition(task, target);
    }

    actions
      .createEl("button", { text: "Eliminar" })
      .onclick = () => this.confirmDelete(task);
  }

  private openEditor(task?: Task): void {
    new TaskModal(this.app, {
      existing: task,
      onSubmit: async (draft) => {
        const scope = this.currentScope();
        if (task) {
          await this.host.tasks.saveTask(updateTask(task, { ...draft, scope }));
          new Notice("Tarea actualizada.");
        } else {
          await this.host.tasks.saveTask(createTask({ ...draft, scope }));
          new Notice("Tarea creada.");
        }
        this.render();
      },
    }).open();
  }

  private async transition(task: Task, to: TaskStatus): Promise<void> {
    try {
      const next = transitionTask(task, to);
      await this.host.tasks.saveTask(next);
      new Notice(`Tarea marcada como ${STATUS_LABEL[to]}.`);
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "No se pudo cambiar el estado.");
    }
    this.render();
  }

  private confirmDelete(task: Task): void {
    new ConfirmModal(this.app, {
      title: "Eliminar tarea",
      body: `Se eliminará «${task.title}» de forma permanente.`,
      confirmText: "Eliminar",
      destructive: true,
      onConfirm: async () => {
        await this.host.tasks.deleteTask(task);
        new Notice("Tarea eliminada.");
        this.render();
      },
    }).open();
  }
}