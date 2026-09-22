import {
  DEFAULT_EXPENSE_CATEGORY_NAMES,
  fromDecimal,
  generateId,
  toIsoDate,
  validateExpenseDraft,
  type ExpenseDraft,
} from "@octasuite/core";
import { App, Modal, Notice, Setting } from "obsidian";

export interface QuickAddResult {
  readonly draft: ExpenseDraft;
  readonly categoryName?: string;
}

/**
 * Captura de gasto en un solo modal. El objetivo de UX es el de Expensica:
 * registrar en menos de cinco segundos, sin salir del teclado.
 */
export class QuickAddExpenseModal extends Modal {
  private name = "";
  private amountRaw = "";
  private date = toIsoDate(new Date());
  private categoryName: string | undefined;
  private paymentMethod = "";
  private notes = "";

  constructor(
    app: App,
    private readonly currency: string,
    private readonly categories: readonly string[],
    private readonly onSubmit: (result: QuickAddResult) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Registrar gasto" });

    new Setting(contentEl).setName("Concepto").addText((text) => {
      text.setPlaceholder("Taxi al cliente").onChange((value) => (this.name = value));
      window.setTimeout(() => text.inputEl.focus(), 0);
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.submit();
      });
    });

    new Setting(contentEl).setName(`Monto (${this.currency})`).addText((text) => {
      text.setPlaceholder("125.50").onChange((value) => (this.amountRaw = value));
      text.inputEl.inputMode = "decimal";
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.submit();
      });
    });

    new Setting(contentEl).setName("Fecha").addText((text) => {
      text.inputEl.type = "date";
      text.setValue(this.date).onChange((value) => (this.date = value));
    });

    const options = this.categories.length > 0 ? this.categories : DEFAULT_EXPENSE_CATEGORY_NAMES;
    new Setting(contentEl).setName("Categoria").addDropdown((dropdown) => {
      dropdown.addOption("", "Sin categoria");
      for (const name of options) dropdown.addOption(name, name);
      dropdown.onChange((value) => (this.categoryName = value === "" ? undefined : value));
    });

    new Setting(contentEl).setName("Forma de pago").addText((text) => {
      text.setPlaceholder("efectivo, tarjeta, transferencia").onChange((value) => (this.paymentMethod = value));
    });

    new Setting(contentEl).setName("Notas").addTextArea((area) => {
      area.setPlaceholder("Opcional").onChange((value) => (this.notes = value));
    });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("Guardar")
          .setCta()
          .onClick(() => void this.submit()),
      );
  }

  private async submit(): Promise<void> {
    let amount;
    try {
      amount = fromDecimal(this.amountRaw, this.currency);
    } catch {
      new Notice(`Monto invalido: ${this.amountRaw || "(vacio)"}`);
      return;
    }

    const draft: ExpenseDraft = {
      name: this.name.trim(),
      amount,
      date: this.date,
      ...(this.paymentMethod.trim() ? { paymentMethod: this.paymentMethod.trim() } : {}),
      ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
    };

    const problems = validateExpenseDraft(draft);
    if (problems.length > 0) {
      new Notice(problems.map((p) => `- ${p.message}`).join("\n"));
      return;
    }

    await this.onSubmit({ draft, categoryName: this.categoryName });
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** Id de gasto. Expuesto aqui para que la vista y el modal usen el mismo prefijo. */
export const newExpenseId = (): string => generateId("exp");
