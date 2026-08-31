import {
  choicesFor,
  format,
  fromDecimal,
  MOVEMENT_REASONS_IN,
  MOVEMENT_REASONS_OUT,
  type Money,
  type OptionSelection,
  type Partner,
  type Product,
  type ShiftSummary,
  type State,
} from "@octasuite/core";
import { App, Modal, Setting } from "obsidian";
import { CustomerPicker } from "./customer-picker.js";
import type { PluginHost } from "./host.js";

/** Pide un importe con un motivo o nota. Sirve para abrir caja y para mover efectivo. */
export class AmountModal extends Modal {
  private amountRaw: string;
  private reason: string;
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly title: string;
      readonly amountLabel: string;
      readonly amountDesc?: string;
      readonly reasons?: readonly string[];
      readonly reasonLabel?: string;
      readonly confirmText: string;
      readonly currency: string;
      readonly defaultAmount?: string;
      readonly onSubmit: (data: { amount: Money; reason: string }) => Promise<void>;
    },
  ) {
    super(app);
    this.amountRaw = options.defaultAmount ?? "";
    this.reason = options.reasons?.[0] ?? "";
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: this.options.title });

    const amount = new Setting(contentEl).setName(`${this.options.amountLabel} (${this.options.currency})`);
    if (this.options.amountDesc) amount.setDesc(this.options.amountDesc);
    amount.addText((t) => {
      t.setPlaceholder("0.00").setValue(this.amountRaw).onChange((v) => (this.amountRaw = v));
      t.inputEl.inputMode = "decimal";
      window.setTimeout(() => t.inputEl.focus(), 0);
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.submit();
      });
    });

    if (this.options.reasons) {
      new Setting(contentEl).setName(this.options.reasonLabel ?? "Motivo").addDropdown((d) => {
        for (const reason of this.options.reasons!) d.addOption(reason, reason);
        d.setValue(this.reason).onChange((v) => (this.reason = v));
      });
    } else {
      new Setting(contentEl).setName(this.options.reasonLabel ?? "Nota").addText((t) =>
        t.setPlaceholder("Opcional").onChange((v) => (this.reason = v)),
      );
    }

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.options.confirmText).setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    let amount: Money;
    try {
      amount = fromDecimal(this.amountRaw, this.options.currency);
    } catch {
      this.errorsEl.createEl("ul").createEl("li", { text: `Importe inválido: ${this.amountRaw || "(vacío)"}` });
      return;
    }
    await this.options.onSubmit({ amount, reason: this.reason });
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export const MOVEMENT_OUT = MOVEMENT_REASONS_OUT;
export const MOVEMENT_IN = MOVEMENT_REASONS_IN;

/**
 * Arqueo de cierre. Pide el conteo **antes** de mostrar lo esperado: si se ve el
 * número esperado primero, el conteo deja de ser una verificación.
 */
export class CloseShiftModal extends Modal {
  private countedRaw = "";
  private notes = "";
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly summary: ShiftSummary;
      readonly currency: string;
      readonly locale: string;
      readonly onSubmit: (data: { counted: Money; notes: string }) => Promise<void>;
    },
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    const { summary, locale } = this.options;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: "Cerrar caja" });
    contentEl.createEl("p", {
      cls: "octa-subtle",
      text: `${summary.ticketCount} documento(s) en el turno. Contá el efectivo del cajón antes de escribir el número.`,
    });

    new Setting(contentEl)
      .setName(`Efectivo contado (${this.options.currency})`)
      .setDesc("Lo que hay físicamente. La diferencia se calcula después.")
      .addText((t) => {
        t.setPlaceholder("0.00").onChange((v) => (this.countedRaw = v));
        t.inputEl.inputMode = "decimal";
        window.setTimeout(() => t.inputEl.focus(), 0);
      });

    new Setting(contentEl).setName("Notas del cierre").addTextArea((a) =>
      a.setPlaceholder("Opcional").onChange((v) => (this.notes = v)),
    );

    const preview = contentEl.createDiv({ cls: "octa-totals" });
    const row = (label: string, value: string, strong = false) => {
      const line = preview.createDiv({ cls: "octa-total-row" });
      line.createSpan({ text: label });
      line.createSpan({ cls: strong ? "octa-num octa-strong" : "octa-num", text: value });
    };
    row("Fondo de apertura", format(summary.openingFloat, locale));
    row("Ventas en efectivo", format(summary.cashSales, locale));
    if (summary.movedIn.minor > 0) row("Ingresos", format(summary.movedIn, locale));
    if (summary.movedOut.minor > 0) row("Retiros", `−${format(summary.movedOut, locale)}`);

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Cerrar turno").setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    let counted: Money;
    try {
      counted = fromDecimal(this.countedRaw, this.options.currency);
    } catch {
      this.errorsEl.createEl("ul").createEl("li", { text: `Conteo inválido: ${this.countedRaw || "(vacío)"}` });
      return;
    }
    await this.options.onSubmit({ counted, notes: this.notes });
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** Elige las opciones de un producto configurable antes de meterlo al carrito. */
export class ChoiceModal extends Modal {
  private picks: { label: string; productId: string }[] = [];

  constructor(
    app: App,
    private readonly options: {
      readonly product: Product;
      readonly state: State;
      readonly onSubmit: (selections: OptionSelection[]) => void;
    },
  ) {
    super(app);
    for (const option of options.product.options ?? []) {
      const first = choicesFor(options.state.products, option)[0];
      for (let i = 0; i < option.quantity; i++) {
        this.picks.push({ label: option.label, productId: first?.id ?? "" });
      }
    }
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: this.options.product.name });

    this.picks.forEach((pick, index) => {
      const option = (this.options.product.options ?? []).find((o) => o.label === pick.label);
      const sameLabel = this.picks.filter((p) => p.label === pick.label).length;
      const ordinal = sameLabel > 1 ? ` ${this.picks.slice(0, index + 1).filter((p) => p.label === pick.label).length}` : "";

      new Setting(contentEl).setName(`${pick.label}${ordinal}`).addDropdown((d) => {
        const candidates = option ? choicesFor(this.options.state.products, option) : [];
        for (const candidate of candidates) d.addOption(candidate.id, candidate.name);
        d.setValue(pick.productId).onChange((v) => (pick.productId = v));
      });
    });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Agregar")
          .setCta()
          .onClick(() => {
            this.options.onSubmit(groupPicks(this.picks));
            this.close();
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

function groupPicks(picks: readonly { label: string; productId: string }[]): OptionSelection[] {
  const byKey = new Map<string, OptionSelection>();
  for (const pick of picks) {
    if (pick.productId === "") continue;
    const key = `${pick.label}::${pick.productId}`;
    const current = byKey.get(key);
    byKey.set(key, { label: pick.label, productId: pick.productId, quantity: (current?.quantity ?? 0) + 1 });
  }
  return [...byKey.values()];
}

/** Cobro del carrito: cliente y forma de pago. */
export class CheckoutModal extends Modal {
  private method: string;
  private selectedPartner: Partner | undefined;

  constructor(
    app: App,
    private readonly options: {
      readonly total: Money;
      readonly host: PluginHost;
      readonly methods: readonly string[];
      readonly defaultMethod: string;
      readonly locale: string;
      readonly onSubmit: (data: { partner: Partner | undefined; method: string }) => Promise<void>;
    },
  ) {
    super(app);
    this.method = options.defaultMethod || options.methods[0] || "Efectivo";
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: `Cobrar ${format(this.options.total, this.options.locale)}` });

    contentEl.createDiv({ cls: "octa-field-label", text: "Cliente" });
    new CustomerPicker(this.app, this.options.host, contentEl.createDiv(), undefined, (partner) => {
      this.selectedPartner = partner;
    }).render();

    new Setting(contentEl).setName("Forma de pago").addDropdown((d) => {
      for (const method of this.options.methods) d.addOption(method, method);
      d.setValue(this.method).onChange((v) => (this.method = v));
    });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Cobrar y emitir")
          .setCta()
          .onClick(async () => {
            this.close();
            await this.options.onSubmit({ partner: this.selectedPartner, method: this.method });
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
