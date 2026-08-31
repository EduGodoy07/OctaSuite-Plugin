import {
  PIPELINE_STAGES,
  LEAD_SOURCES,
  STAGE_LABEL,
  SOURCE_LABEL,
  validateLeadDraft,
  type Lead,
  type LeadDraft,
  type Stage,
  type Source,
} from "@octasuite/core";
import { App, Modal, Setting } from "obsidian";

type Editable = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  company: string;
  stage: Stage;
  source: Source;
  estimatedValue: string;
  owner: string;
  notes: string;
};

export class LeadModal extends Modal {
  private form: Editable;
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly existing?: Lead;
      readonly onSubmit: (draft: LeadDraft) => Promise<void>;
    },
  ) {
    super(app);
    const e = options.existing;
    this.form = {
      name: e?.name ?? "",
      contactName: e?.contactName ?? "",
      email: e?.email ?? "",
      phone: e?.phone ?? "",
      company: e?.company ?? "",
      stage: e?.stage ?? "nuevo",
      source: e?.source ?? "otro",
      estimatedValue: e?.estimatedValue ? String(e.estimatedValue) : "",
      owner: e?.owner ?? "",
      notes: e?.notes ?? "",
    };
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: this.options.existing ? "Editar prospecto" : "Nuevo prospecto" });

    this.text(contentEl, "Nombre del lead", "Ej: Proyecto web Acme", "name", (input) => {
      window.setTimeout(() => input.focus(), 0);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.submit();
      });
    });

    this.text(contentEl, "Contacto", "Nombre de la persona", "contactName");
    this.text(contentEl, "Correo", "contacto@acme.com", "email");
    this.text(contentEl, "Teléfono", "2222-3333", "phone");
    this.text(contentEl, "Empresa", "Acme Corp", "company");

    new Setting(contentEl).setName("Etapa").addDropdown((d) => {
      for (const s of PIPELINE_STAGES) d.addOption(s, STAGE_LABEL[s]);
      d.setValue(this.form.stage).onChange((v) => (this.form.stage = v as Stage));
    });

    new Setting(contentEl).setName("Fuente").addDropdown((d) => {
      for (const s of LEAD_SOURCES) d.addOption(s, SOURCE_LABEL[s]);
      d.setValue(this.form.source).onChange((v) => (this.form.source = v as Source));
    });

    new Setting(contentEl).setName("Valor estimado (GTQ)").addText((t) => {
      t.setPlaceholder("0").setValue(this.form.estimatedValue).onChange((v) => {
        this.form.estimatedValue = v;
      });
    });

    this.text(contentEl, "Responsable", "Quién lleva este lead", "owner");

    new Setting(contentEl).setName("Notas").addTextArea((a) =>
      a.setValue(this.form.notes).onChange((v) => (this.form.notes = v)),
    );

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Guardar").setCta().onClick(() => void this.submit()));
  }

  private text(
    parent: HTMLElement,
    label: string,
    placeholder: string,
    key: keyof Editable,
    decorate?: (input: HTMLInputElement) => void,
  ): void {
    new Setting(parent).setName(label).addText((t) => {
      t.setPlaceholder(placeholder)
        .setValue(String(this.form[key]))
        .onChange((v) => {
          (this.form[key] as string) = v;
        });
      decorate?.(t.inputEl);
    });
  }

  private buildDraft(): LeadDraft {
    const clean = (v: string) => {
      const t = v.trim();
      return t === "" ? undefined : t;
    };
    const num = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    return {
      name: this.form.name.trim(),
      ...(clean(this.form.contactName) ? { contactName: this.form.contactName.trim() } : {}),
      ...(clean(this.form.email) ? { email: this.form.email.trim() } : {}),
      ...(clean(this.form.phone) ? { phone: this.form.phone.trim() } : {}),
      ...(clean(this.form.company) ? { company: this.form.company.trim() } : {}),
      stage: this.form.stage,
      source: this.form.source,
      ...(num(this.form.estimatedValue) !== undefined
        ? { estimatedValue: num(this.form.estimatedValue)! }
        : {}),
      ...(clean(this.form.owner) ? { owner: this.form.owner.trim() } : {}),
      ...(clean(this.form.notes) ? { notes: this.form.notes.trim() } : {}),
    };
  }

  private async submit(): Promise<void> {
    const draft = this.buildDraft();
    const problems = validateLeadDraft(draft);
    this.errorsEl.empty();
    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const p of problems) list.createEl("li", { text: p.message });
      return;
    }
    await this.options.onSubmit(draft);
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
