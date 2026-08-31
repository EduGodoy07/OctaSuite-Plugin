import { App, Modal, Setting } from "obsidian";

/**
 * Formas de pago habituales en Guatemala. Se pregunta al cobrar/pagar en vez de
 * asumir una: la mezcla de formas de pago es uno de los reportes, y con un valor
 * por defecto silencioso todos los movimientos saldrían iguales y el reporte
 * mentiría.
 */
export const PAYMENT_METHODS = ["Efectivo", "Tarjeta", "Transferencia", "Cheque", "Depósito"] as const;

/**
 * Pide forma de pago y fecha. Sirve tanto para cobrar una factura (Facturas,
 * Caja) como para pagar una entrada de stock (Pagos) — el dinero que entra y el
 * que sale se registran con la misma pregunta.
 */
export class PaymentModal extends Modal {
  private method: string;
  private date: string;

  constructor(
    app: App,
    private readonly options: {
      readonly heading: string;
      readonly subtitle: string;
      readonly defaultMethod: string;
      readonly dateLabel?: string;
      readonly confirmText?: string;
      readonly initialDate: string;
      readonly onSubmit: (data: { method: string; date: string }) => Promise<void>;
    },
  ) {
    super(app);
    this.method = options.defaultMethod || PAYMENT_METHODS[0];
    this.date = options.initialDate;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");

    contentEl.createEl("h3", { text: this.options.heading });
    contentEl.createEl("p", { cls: "octa-subtle", text: this.options.subtitle });

    new Setting(contentEl).setName("Forma de pago").addDropdown((d) => {
      const options = [...PAYMENT_METHODS];
      if (this.method && !options.includes(this.method as (typeof PAYMENT_METHODS)[number])) {
        d.addOption(this.method, this.method);
      }
      for (const method of options) d.addOption(method, method);
      d.setValue(this.method).onChange((v) => (this.method = v));
    });

    new Setting(contentEl).setName(this.options.dateLabel ?? "Fecha").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(this.date).onChange((v) => (this.date = v));
    });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(this.options.confirmText ?? "Registrar")
          .setCta()
          .onClick(async () => {
            this.close();
            await this.options.onSubmit({ method: this.method, date: this.date });
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
