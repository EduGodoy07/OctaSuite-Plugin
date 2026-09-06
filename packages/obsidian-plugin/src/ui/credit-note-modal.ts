import {
  assertCreditable,
  DomainError,
  format,
  fromDecimal,
  invoiceNetTotal,
  toDecimalString,
  toIsoDate,
  type Invoice,
  type Money,
} from "@octasuite/core";
import { App, Modal, Setting } from "obsidian";

export class CreditNoteModal extends Modal {
  private amountRaw: string;
  private reason = "";
  private date = toIsoDate(new Date());
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly invoice: Invoice;
      readonly locale: string;
      readonly onSubmit: (data: { amount: Money; reason: string; date: string }) => Promise<void>;
    },
  ) {
    super(app);
    // Por defecto, acreditar el saldo completo: anular es el caso más común.
    this.amountRaw = toDecimalString(invoiceNetTotal(options.invoice));
  }

  override onOpen(): void {
    const { contentEl } = this;
    const { invoice, locale } = this.options;
    contentEl.empty();
    contentEl.addClass("octa");

    contentEl.createEl("h3", { text: `Nota de crédito sobre ${invoice.displayNumber}` });
    contentEl.createEl("p", {
      cls: "octa-subtle",
      text: `${invoice.partnerName} · ${invoice.partnerTaxId} · total ${format(invoice.totals.total, locale)} · acreditable ${format(invoiceNetTotal(invoice), locale)}`,
    });

    new Setting(contentEl).setName(`Monto (${invoice.currency})`).addText((t) => {
      t.setValue(this.amountRaw).onChange((v) => (this.amountRaw = v));
      t.inputEl.inputMode = "decimal";
      window.setTimeout(() => t.inputEl.select(), 0);
    });

    new Setting(contentEl).setName("Fecha").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(this.date).onChange((v) => (this.date = v));
    });

    new Setting(contentEl)
      .setName("Motivo")
      .setDesc("Queda en el histórico: es la explicación de por qué se corrigió el documento.")
      .addText((t) =>
        t.setPlaceholder("Producto devuelto, error en el precio, anulación…").onChange((v) => (this.reason = v)),
      );

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Emitir nota").setCta().onClick(() => void this.submit()));

    contentEl.createDiv({
      cls: "octa-footnote",
      text: "La factura original no cambia. La nota de crédito se registra aparte y reduce el saldo.",
    });
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    const problems: string[] = [];

    let amount: Money | undefined;
    try {
      amount = fromDecimal(this.amountRaw, this.options.invoice.currency);
    } catch {
      problems.push(`Monto inválido: ${this.amountRaw || "(vacío)"}`);
    }

    if (this.reason.trim() === "") problems.push("El motivo es obligatorio");

    if (amount) {
      if (amount.minor === 0) problems.push("El monto no puede ser cero");
      try {
        assertCreditable(this.options.invoice, amount);
      } catch (e) {
        problems.push(e instanceof DomainError ? e.message : String(e));
      }
    }

    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const message of problems) list.createEl("li", { text: message });
      return;
    }

    await this.options.onSubmit({ amount: amount!, reason: this.reason.trim(), date: this.date });
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
