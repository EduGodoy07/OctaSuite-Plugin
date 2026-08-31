import { ADJUSTMENT_REASONS, toIsoDate, type Product } from "@octasuite/core";
import { App, Modal, Setting } from "obsidian";

/**
 * Ajuste de existencia. Nunca se edita la existencia directamente: se registra
 * el movimiento que la corrige, con su motivo. Así el número siempre tiene
 * explicación en el histórico.
 */
export class AdjustmentModal extends Modal {
  private quantityRaw = "";
  private reason: string = ADJUSTMENT_REASONS[0];
  private date = toIsoDate(new Date());
  private mode: "delta" | "count" = "delta";
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly product: Product;
      readonly currentStock: number;
      readonly onSubmit: (data: { quantity: number; reason: string; date: string }) => Promise<void>;
    },
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: `Ajustar existencia — ${this.options.product.name}` });
    contentEl.createEl("p", { cls: "octa-subtle", text: `Existencia actual: ${this.options.currentStock}` });

    new Setting(contentEl)
      .setName("Tipo de ajuste")
      .addDropdown((d) => {
        d.addOption("delta", "Sumar o restar unidades");
        d.addOption("count", "Fijar el resultado de un conteo");
        d.setValue(this.mode).onChange((v) => {
          this.mode = v as "delta" | "count";
          this.onOpen();
        });
      });

    new Setting(contentEl)
      .setName(this.mode === "delta" ? "Unidades" : "Conteo físico")
      .setDesc(
        this.mode === "delta"
          ? "Negativo descuenta (merma), positivo suma."
          : "La cantidad contada. Se registra la diferencia contra la existencia actual.",
      )
      .addText((t) => {
        t.setPlaceholder(this.mode === "delta" ? "-2" : "18").setValue(this.quantityRaw).onChange((v) => (this.quantityRaw = v));
        t.inputEl.inputMode = "decimal";
        window.setTimeout(() => t.inputEl.focus(), 0);
      });

    new Setting(contentEl).setName("Motivo").addDropdown((d) => {
      for (const reason of ADJUSTMENT_REASONS) d.addOption(reason, reason);
      d.setValue(this.reason).onChange((v) => (this.reason = v));
    });

    new Setting(contentEl).setName("Fecha").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(this.date).onChange((v) => (this.date = v));
    });

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Registrar ajuste").setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    const value = Number(this.quantityRaw);
    const problems: string[] = [];

    if (!Number.isFinite(value)) problems.push(`Cantidad inválida: ${this.quantityRaw || "(vacío)"}`);

    // En modo conteo, lo que se registra es la diferencia contra lo que había.
    const quantity = this.mode === "count" ? value - this.options.currentStock : value;
    if (Number.isFinite(value) && quantity === 0) {
      problems.push(
        this.mode === "count"
          ? "El conteo coincide con la existencia: no hay nada que ajustar."
          : "Un ajuste de cero no registra nada.",
      );
    }

    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const message of problems) list.createEl("li", { text: message });
      return;
    }

    await this.options.onSubmit({ quantity, reason: this.reason, date: this.date });
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
