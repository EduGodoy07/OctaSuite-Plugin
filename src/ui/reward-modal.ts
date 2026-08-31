import type { LoyaltyReward } from "@octasuite/core";
import { App, Modal, Setting } from "obsidian";

type Editable = {
  name: string;
  description: string;
  pointsCost: string;
};

export class RewardModal extends Modal {
  private form: Editable;
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly existing?: LoyaltyReward;
      readonly onSubmit: (draft: Pick<LoyaltyReward, "name" | "description" | "pointsCost">) => Promise<void>;
    },
  ) {
    super(app);
    const e = options.existing;
    this.form = {
      name: e?.name ?? "",
      description: e?.description ?? "",
      pointsCost: e ? String(e.pointsCost) : "",
    };
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: this.options.existing ? "Editar recompensa" : "Nueva recompensa" });

    new Setting(contentEl).setName("Nombre").addText((t) => {
      t.setPlaceholder("Ej: Descuento Q50")
        .setValue(this.form.name)
        .onChange((v) => (this.form.name = v));
      window.setTimeout(() => t.inputEl.focus(), 0);
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.submit();
      });
    });

    new Setting(contentEl).setName("Descripción (opcional)").addTextArea((a) =>
      a.setPlaceholder("Aplica en compras mayores a Q100")
        .setValue(this.form.description)
        .onChange((v) => (this.form.description = v)),
    );

    new Setting(contentEl).setName("Puntos requeridos").addText((t) => {
      t.setPlaceholder("500").setValue(this.form.pointsCost).onChange((v) => {
        this.form.pointsCost = v;
      });
    });

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Guardar").setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    const name = this.form.name.trim();
    const pointsCost = Number(this.form.pointsCost);
    const problems: string[] = [];
    if (!name) problems.push("El nombre es obligatorio");
    if (!Number.isFinite(pointsCost) || pointsCost <= 0) problems.push("Los puntos deben ser un número mayor a 0");

    this.errorsEl.empty();
    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const p of problems) list.createEl("li", { text: p });
      return;
    }

    await this.options.onSubmit({
      name,
      description: this.form.description.trim() || undefined,
      pointsCost,
    });
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
