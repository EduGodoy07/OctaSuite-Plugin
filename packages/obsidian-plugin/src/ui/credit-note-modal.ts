import {
  assertCreditable,
  type CreditNoteType,
  DomainError,
  format,
  fromDecimal,
  invoiceNetTotal,
  toDecimalString,
  toIsoDate,
  type Invoice,
  type Money,
  type Product,
} from "@octasuite/core";
import { App, Modal, Setting, setIcon } from "obsidian";

const TENDER_METHODS = ["Efectivo", "Tarjeta", "Transferencia"] as const;
type TenderMethod = (typeof TENDER_METHODS)[number];
const CREDIT_NOTE_TYPES: readonly { value: CreditNoteType; label: string }[] = [
  { value: "store_credit", label: "Crédito cliente (saldo a favor)" },
  { value: "refund", label: "Reembolso al método de pago original" },
  { value: "exchange", label: "Cambio (devolución + entrega nueva)" },
];

type ReturnLine = { productId: string; quantity: number; unitPrice: Money; taxRate: number };
type ExchangeLine = { productId: string; quantity: number; unitPrice: Money; taxRate: number };

export class CreditNoteModal extends Modal {
  private type: CreditNoteType = "store_credit";
  private amountRaw: string;
  private reason = "";
  private tenderMethod: TenderMethod = TENDER_METHODS[0];
  private date = toIsoDate(new Date());

  // exchange
  private returnLines: ReturnLine[] = [];
  private exchangeLines: ExchangeLine[] = [];

  // stock return
  private stockReturnLocationId = "main";

  private errorsEl!: HTMLElement;
  private tenderSectionEl!: HTMLElement;
  private exchangeSectionEl!: HTMLElement;
  private locationSectionEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly invoice: Invoice;
      readonly locale: string;
      readonly products: ReadonlyMap<string, Product>;
      readonly locations: ReadonlyMap<string, { id: string; name: string }>;
      readonly onSubmit: (data: {
        amount: Money;
        reason: string;
        date: string;
        type: CreditNoteType;
        tenderMethod?: TenderMethod;
        returnLines?: ReturnLine[];
        exchangeLines?: ExchangeLine[];
        stockReturnLocationId?: string;
      }) => Promise<void>;
    },
  ) {
    super(app);
    this.amountRaw = toDecimalString(invoiceNetTotal(options.invoice));
  }

  override onOpen(): void {
    const { contentEl } = this;
    const { invoice, locale, products, locations } = this.options;
    contentEl.empty();
    contentEl.addClass("octa");

    contentEl.createEl("h3", { text: `Nota de crédito sobre ${invoice.displayNumber}` });
    contentEl.createEl("p", {
      cls: "octa-subtle",
      text: `${invoice.partnerName} · ${invoice.partnerTaxId} · total ${format(invoice.totals.total, locale)} · acreditable ${format(invoiceNetTotal(invoice), locale)}`,
    });

    // Tipo de nota
    new Setting(contentEl).setName("Tipo").addDropdown((d) => {
      for (const t of CREDIT_NOTE_TYPES) d.addOption(t.value, t.label);
      d.setValue(this.type).onChange((v) => {
        this.type = v as CreditNoteType;
        this.renderConditionalSections();
      });
    });

    // Monto y fecha (siempre)
    new Setting(contentEl).setName(`Monto (${invoice.currency})`).addText((t) => {
      t.setValue(this.amountRaw).onChange((v) => (this.amountRaw = v));
      t.inputEl.inputMode = "decimal";
      window.setTimeout(() => t.inputEl.select(), 0);
    });

    new Setting(contentEl).setName("Fecha").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(this.date).onChange((v) => (this.date = v));
    });

    // Secciones condicionales
    this.tenderSectionEl = contentEl.createDiv();
    this.exchangeSectionEl = contentEl.createDiv();
    this.locationSectionEl = contentEl.createDiv();
    this.renderConditionalSections();

    // Motivo (siempre)
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

  private renderConditionalSections(): void {
    this.tenderSectionEl.empty();
    this.exchangeSectionEl.empty();
    this.locationSectionEl.empty();

    if (this.type === "refund") {
      new Setting(this.tenderSectionEl).setName("Método de reembolso").addDropdown((d) => {
        for (const m of TENDER_METHODS) d.addOption(m, m);
        d.setValue(this.tenderMethod).onChange((v) => (this.tenderMethod = v as TenderMethod));
      });
      new Setting(this.tenderSectionEl).setName("Monto a reembolsar").addText((t) => {
        t.setValue(this.amountRaw).onChange((v) => (this.amountRaw = v));
        t.inputEl.inputMode = "decimal";
      });
    }

    if (this.type === "exchange") {
      this.exchangeSectionEl.createEl("h4", { text: "Líneas devueltas", cls: "octa-group" });
      const returnTable = this.exchangeSectionEl.createEl("table", { cls: "octa-table" });
      const returnHead = returnTable.createEl("thead").createEl("tr");
      for (const h of ["Producto", "Cantidad", "Precio", "IVA %", ""]) returnHead.createEl("th", { text: h });
      const returnBody = returnTable.createEl("tbody");
      this.returnLines.forEach((line, i) => this.renderReturnRow(returnBody, line, i, this.options.products));
      const addReturnBtn = this.exchangeSectionEl.createEl("button", { text: "+ Agregar línea devuelta", cls: "mod-cta" });
      addReturnBtn.onclick = () => {
        this.returnLines.push({ productId: "", quantity: 1, unitPrice: { minor: 0, currency: this.options.invoice.currency }, taxRate: 12 });
        this.renderConditionalSections();
      };

      this.exchangeSectionEl.createEl("h4", { text: "Líneas de cambio (nuevas)", cls: "octa-group" });
      const exchangeTable = this.exchangeSectionEl.createEl("table", { cls: "octa-table" });
      const exchHead = exchangeTable.createEl("thead").createEl("tr");
      for (const h of ["Producto", "Cantidad", "Precio", "IVA %", ""]) exchHead.createEl("th", { text: h });
      const exchBody = exchangeTable.createEl("tbody");
      this.exchangeLines.forEach((line, i) => this.renderExchangeRow(exchBody, line, i, this.options.products));
      const addExchBtn = this.exchangeSectionEl.createEl("button", { text: "+ Agregar línea de cambio", cls: "mod-cta" });
      addExchBtn.onclick = () => {
        this.exchangeLines.push({ productId: "", quantity: 1, unitPrice: { minor: 0, currency: this.options.invoice.currency }, taxRate: 12 });
        this.renderConditionalSections();
      };
    }

    if (this.type === "refund" || this.type === "exchange") {
      new Setting(this.locationSectionEl).setName("Ubicación de retorno de stock").addDropdown((d) => {
        d.addOption("main", "Principal (main)");
        for (const loc of this.options.locations.values()) {
          if (loc.id !== "main") d.addOption(loc.id, loc.name);
        }
        d.setValue(this.stockReturnLocationId).onChange((v) => (this.stockReturnLocationId = v));
      });
    }
  }

  private renderReturnRow(
    tbody: HTMLElement,
    line: ReturnLine,
    index: number,
    products: ReadonlyMap<string, Product>,
  ): void {
    const row = tbody.createEl("tr");
    const select = row.createEl("td").createEl("select", { cls: "dropdown" });
    select.createEl("option", { value: "", text: "— producto —" });
    for (const p of products.values()) select.createEl("option", { value: p.id, text: p.name });
    select.value = line.productId;
    select.onchange = () => {
      line.productId = select.value;
      const p = products.get(select.value);
      if (p) {
        line.unitPrice = p.salePrice;
        line.taxRate = p.taxRate ?? 12;
      }
      this.renderConditionalSections();
    };
    row.createEl("td").createEl("input", {
      cls: "octa-cell-input octa-cell-narrow",
      attr: { type: "number", min: "1", step: "1" },
      value: String(line.quantity),
    }).oninput = (e) => { line.quantity = Number((e.target as HTMLInputElement).value) || 1; };
    row.createEl("td").createEl("input", {
      cls: "octa-cell-input octa-cell-narrow",
      attr: { type: "number", min: "0", step: "0.01" },
      value: toDecimalString(line.unitPrice),
    }).oninput = (e) => { line.unitPrice = fromDecimal((e.target as HTMLInputElement).value, this.options.invoice.currency); };
    row.createEl("td").createEl("input", {
      cls: "octa-cell-input octa-cell-narrow",
      attr: { type: "number", min: "0", max: "100", step: "1" },
      value: String(line.taxRate),
    }).oninput = (e) => { line.taxRate = Number((e.target as HTMLInputElement).value) || 0; };
    const del = row.createEl("td", { cls: "octa-actions" }).createEl("button", { attr: { "aria-label": "Quitar" } });
    setIcon(del, "x");
    del.onclick = () => { this.returnLines.splice(index, 1); this.renderConditionalSections(); };
  }

  private renderExchangeRow(
    tbody: HTMLElement,
    line: ExchangeLine,
    index: number,
    products: ReadonlyMap<string, Product>,
  ): void {
    const row = tbody.createEl("tr");
    const select = row.createEl("td").createEl("select", { cls: "dropdown" });
    select.createEl("option", { value: "", text: "— producto —" });
    for (const p of products.values()) select.createEl("option", { value: p.id, text: p.name });
    select.value = line.productId;
    select.onchange = () => {
      line.productId = select.value;
      const p = products.get(select.value);
      if (p) {
        line.unitPrice = p.salePrice;
        line.taxRate = p.taxRate ?? 12;
      }
      this.renderConditionalSections();
    };
    row.createEl("td").createEl("input", {
      cls: "octa-cell-input octa-cell-narrow",
      attr: { type: "number", min: "1", step: "1" },
      value: String(line.quantity),
    }).oninput = (e) => { line.quantity = Number((e.target as HTMLInputElement).value) || 1; };
    row.createEl("td").createEl("input", {
      cls: "octa-cell-input octa-cell-narrow",
      attr: { type: "number", min: "0", step: "0.01" },
      value: toDecimalString(line.unitPrice),
    }).oninput = (e) => { line.unitPrice = fromDecimal((e.target as HTMLInputElement).value, this.options.invoice.currency); };
    row.createEl("td").createEl("input", {
      cls: "octa-cell-input octa-cell-narrow",
      attr: { type: "number", min: "0", max: "100", step: "1" },
      value: String(line.taxRate),
    }).oninput = (e) => { line.taxRate = Number((e.target as HTMLInputElement).value) || 0; };
    const del = row.createEl("td", { cls: "octa-actions" }).createEl("button", { attr: { "aria-label": "Quitar" } });
    setIcon(del, "x");
    del.onclick = () => { this.exchangeLines.splice(index, 1); this.renderConditionalSections(); };
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

    if (this.type === "refund") {
      if (!this.tenderMethod || this.tenderMethod.trim() === "") problems.push("El método de reembolso es obligatorio");
    }
    if (this.type === "exchange") {
      const hasReturns = this.returnLines.some((l) => l.productId && l.quantity > 0);
      const hasExchanges = this.exchangeLines.some((l) => l.productId && l.quantity > 0);
      if (!hasReturns && !hasExchanges) problems.push("Un cambio requiere al menos una línea devuelta o de cambio");
    }

    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const message of problems) list.createEl("li", { text: message });
      return;
    }

    await this.options.onSubmit({
      amount: amount!,
      reason: this.reason.trim(),
      date: this.date,
      type: this.type,
      tenderMethod: this.type === "refund" ? this.tenderMethod : undefined,
      returnLines: this.type === "exchange" ? this.returnLines.filter((l) => l.productId && l.quantity > 0) : undefined,
      exchangeLines: this.type === "exchange" ? this.exchangeLines.filter((l) => l.productId && l.quantity > 0) : undefined,
      stockReturnLocationId: (this.type === "refund" || this.type === "exchange") ? this.stockReturnLocationId : undefined,
    });
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}