import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  validateTaskDraft,
  type Task,
  type TaskDraft,
  type TaskPriority,
  type TaskStatus,
} from "@octasuite/core";
import { App, Modal, Setting } from "obsidian";

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Abierta",
  "in-progress": "En curso",
  waiting: "En espera",
  blocked: "Bloqueada",
  paused: "Pausada",
  done: "Hecha",
  cancelled: "Cancelada",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

type Editable = {
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due: string;
  body: string;
};

/**
 * Editor de tareas. `existing` null crea, presente edita.
 * `onSubmit` decide si es create o update (y el scope lo inyecta la vista,
 * porque el modal no tiene contexto de empresa: edita campos, nada más).
 */
export class TaskModal extends Modal {
  private form: Editable;
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly existing?: Task;
      readonly onSubmit: (draft: TaskDraft) => Promise<void>;
    },
  ) {
    super(app);
    const e = options.existing;
    this.form = {
      title: e?.title ?? "",
      status: e?.status ?? "open",
      priority: e?.priority ?? "normal",
      due: e?.due ?? "",
      body: e?.body ?? "",
    };
  }

  override onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("octa");

    this.contentEl.createEl("h3", {
      text: this.options.existing ? "Editar tarea" : "Nueva tarea",
    });

    const title = new Setting(this.contentEl)
      .setName("Título")
      .addText((text) => {
        text
          .setPlaceholder("¿Qué hay que hacer?")
          .setValue(this.form.title)
          .onChange((v) => {
            this.form.title = v;
          });
        text.inputEl.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            void this.submit();
          }
        });
      });
    title.controlEl.querySelector("input")?.focus();

    new Setting(this.contentEl)
      .setName("Estado")
      .addDropdown((dd) => {
        for (const status of TASK_STATUSES) {
          dd.addOption(status, STATUS_LABEL[status]);
        }
        dd.setValue(this.form.status).onChange((v) => {
          this.form.status = v as TaskStatus;
        });
      });

    new Setting(this.contentEl)
      .setName("Prioridad")
      .addDropdown((dd) => {
        for (const priority of TASK_PRIORITIES) {
          dd.addOption(priority, PRIORITY_LABEL[priority]);
        }
        dd.setValue(this.form.priority).onChange((v) => {
          this.form.priority = v as TaskPriority;
        });
      });

    new Setting(this.contentEl)
      .setName("Vencimiento")
      .addText((text) => {
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.form.due)
          .onChange((v) => {
            this.form.due = v;
          });
      });

    new Setting(this.contentEl)
      .setName("Notas")
      .addTextArea((text) => {
        text
          .setPlaceholder("Contexto o detalles (opcional)")
          .setValue(this.form.body)
          .onChange((v) => {
            this.form.body = v;
          });
      });

    this.errorsEl = this.contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Guardar")
          .setCta()
          .onClick(() => void this.submit()),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private buildDraft(): TaskDraft {
    const clean = (v: string) => {
      const t = v.trim();
      return t === "" ? null : t;
    };
    const body = clean(this.form.body);
    const draft: TaskDraft = {
      title: this.form.title.trim(),
      status: this.form.status,
      priority: this.form.priority,
      due: clean(this.form.due),
    };
    if (body !== null) draft.body = body;
    return draft;
  }

  private async submit(): Promise<void> {
    const draft = this.buildDraft();
    const problems = validateTaskDraft(draft);
    this.errorsEl.empty();
    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const p of problems) list.createEl("li", { text: p.message });
      return;
    }
    try {
      await this.options.onSubmit(draft);
    } catch (err) {
      this.errorsEl.empty();
      const list = this.errorsEl.createEl("ul");
      list.createEl("li", {
        text:
          err instanceof Error ? err.message : "No se pudo guardar la tarea.",
      });
      return;
    }
    this.close();
  }
}