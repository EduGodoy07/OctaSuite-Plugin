import {
  ACCOUNT_TYPES,
  isValidNit,
  validatePartnerDraft,
  type AccountType,
  type Partner,
  type PartnerDraft,
} from "@octasuite/core";
import { App, Modal, Setting } from "obsidian";

const TYPE_LABEL: Record<AccountType, string> = {
  individual: "Persona",
  company: "Empresa",
  address: "Dirección de otro contacto",
};

/** Campos que se editan en el formulario, sin los derivados ni los de sistema. */
type Editable = {
  accountType: AccountType;
  name: string;
  taxId: string;
  email: string;
  phone: string;
  mobile: string;
  street1: string;
  city: string;
  parentId: string;
  notes: string;
};

export class PartnerModal extends Modal {
  private form: Editable;
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      /** Contacto a editar. Si falta, es creación. */
      readonly existing?: Partner;
      /**
       * Valores iniciales al crear desde un buscador (Caja, Facturas): lo que
       * la persona ya tecleó no se vuelve a pedir. Se ignora si hay `existing`.
       */
      readonly prefill?: { readonly name?: string; readonly taxId?: string };
      /** Contactos disponibles como padre, para el tipo «dirección». */
      readonly candidates: readonly Partner[];
      readonly onSubmit: (draft: PartnerDraft) => Promise<void>;
    },
  ) {
    super(app);
    const e = options.existing;
    const p = options.prefill;
    this.form = {
      accountType: e?.accountType ?? "company",
      name: e?.name ?? p?.name ?? "",
      taxId: e?.taxId ?? p?.taxId ?? "",
      email: e?.email ?? "",
      phone: e?.phone ?? "",
      mobile: e?.mobile ?? "",
      street1: e?.street1 ?? "",
      city: e?.city ?? "",
      parentId: e?.parentId ?? "",
      notes: e?.notes ?? "",
    };
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: this.options.existing ? "Editar contacto" : "Nuevo contacto" });

    new Setting(contentEl).setName("Tipo").addDropdown((d) => {
      for (const type of ACCOUNT_TYPES) d.addOption(type, TYPE_LABEL[type]);
      d.setValue(this.form.accountType).onChange((v) => {
        this.form.accountType = v as AccountType;
        this.onOpen(); // el campo «pertenece a» solo aplica a direcciones
      });
    });

    this.text(contentEl, "Nombre", "Razón social o nombre completo", "name", (input) => {
      window.setTimeout(() => input.focus(), 0);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.submit();
      });
    });

    if (this.form.accountType === "address") {
      new Setting(contentEl)
        .setName("Pertenece a")
        .setDesc("Una dirección siempre cuelga de un contacto.")
        .addDropdown((d) => {
          d.addOption("", "— elegir —");
          for (const c of this.options.candidates) {
            if (c.accountType === "address" || c.id === this.options.existing?.id) continue;
            d.addOption(c.id, c.name);
          }
          d.setValue(this.form.parentId).onChange((v) => (this.form.parentId = v));
        });
    } else {
      new Setting(contentEl)
        .setName("NIT")
        .setDesc("CF para consumidor final. Se valida el dígito verificador.")
        .addText((t) => {
          t.setPlaceholder("42932-5").setValue(this.form.taxId).onChange((v) => {
            this.form.taxId = v;
            const trimmed = v.trim();
            t.inputEl.toggleClass("octa-input-invalid", trimmed !== "" && !isValidNit(trimmed));
          });
        });
    }

    this.text(contentEl, "Correo", "cliente@dominio.com", "email");
    this.text(contentEl, "Teléfono", "2222-3333", "phone");
    this.text(contentEl, "Celular", "5555-6666", "mobile");
    this.text(contentEl, "Dirección", "Calle y número", "street1");
    this.text(contentEl, "Ciudad", "Guatemala", "city");

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

  private buildDraft(): PartnerDraft {
    const clean = (v: string) => {
      const t = v.trim();
      return t === "" ? undefined : t;
    };
    return {
      name: this.form.name.trim(),
      accountType: this.form.accountType,
      ...(clean(this.form.taxId) ? { taxId: this.form.taxId.trim() } : {}),
      ...(clean(this.form.email) ? { email: this.form.email.trim() } : {}),
      ...(clean(this.form.phone) ? { phone: this.form.phone.trim() } : {}),
      ...(clean(this.form.mobile) ? { mobile: this.form.mobile.trim() } : {}),
      ...(clean(this.form.street1) ? { street1: this.form.street1.trim() } : {}),
      ...(clean(this.form.city) ? { city: this.form.city.trim() } : {}),
      ...(clean(this.form.parentId) ? { parentId: this.form.parentId.trim() } : {}),
      ...(clean(this.form.notes) ? { notes: this.form.notes.trim() } : {}),
    };
  }

  private async submit(): Promise<void> {
    const draft = this.buildDraft();
    const problems = validatePartnerDraft(draft);
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
