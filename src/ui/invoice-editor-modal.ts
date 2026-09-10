import {
  activeProducts,
  computeInvoiceTotals,
  choicesFor,
  computeLineTotals,
  format,
  fromDecimal,
  isConfigurable,
  LocalNumberAuthority,
  nextNumberFor,
  toDecimalString,
  toIsoDate,
  totalsSnapshot,
  validateIssueInput,
  validateSelections,
  zero,
  type InvoiceLine,
  type IssueInvoiceInput,
  type LineDiscount,
  type Money,
  type OptionSelection,
  type Partner,
  type Product,
  type State,
} from "@octasuite/core";
import { App, Modal, setIcon, Setting } from "obsidian";
import { CustomerPicker } from "./customer-picker.js";
import { parseDiscountInput } from "./discount-input.js";
import type { PluginHost } from "./host.js";

/** Línea en edición: los importes viven como texto hasta que se emite. */
interface DraftLine {
  productId: string;
  description: string;
  quantityRaw: string;
  unitPriceRaw: string;
  taxRateRaw: string;
  /** Descuento: porcentual y/o monto, viven como texto hasta emitir. */
  discountPercentRaw: string;
  discountAmountRaw: string;
  /** Una entrada por unidad a elegir: dos carnes son dos entradas. */
  picks: { label: string; productId: string }[];
}

export class InvoiceEditorModal extends Modal {
  private selectedPartner: Partner | undefined;
  private date = toIsoDate(new Date());
  private notes = "";
  private lines: DraftLine[] = [];

  private linesEl!: HTMLElement;
  private totalsEl!: HTMLElement;
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly host: PluginHost;
      readonly state: State;
      readonly currency: string;
      readonly defaultTaxRate: number;
      readonly series: string;
      readonly locale: string;
      readonly onIssue: (input: IssueInvoiceInput & { number: number }) => Promise<void>;
    },
  ) {
    super(app);
    this.lines = [this.blankLine()];
  }

  private blankLine(): DraftLine {
    return {
      productId: "",
      description: "",
      quantityRaw: "1",
      unitPriceRaw: "",
      taxRateRaw: String(this.options.defaultTaxRate),
      discountPercentRaw: "",
      discountAmountRaw: "",
      picks: [],
    };
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("octa-wide-modal");
    contentEl.empty();
    contentEl.addClass("octa");

    const number = nextNumberFor(this.options.state, this.options.series);
    contentEl.createEl("h3", { text: `Nueva factura ${this.options.series}-${String(number).padStart(4, "0")}` });

    contentEl.createDiv({ cls: "octa-field-label", text: "Cliente" });
    new CustomerPicker(
      this.app,
      this.options.host,
      contentEl.createDiv(),
      this.selectedPartner?.id,
      (partner) => (this.selectedPartner = partner),
    ).render();

    new Setting(contentEl).setName("Fecha").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(this.date).onChange((v) => (this.date = v));
    });

    contentEl.createEl("h4", { text: "Líneas", cls: "octa-group" });
    this.linesEl = contentEl.createDiv();
    this.renderLines();

    const addRow = contentEl.createDiv({ cls: "octa-add-line" });
    const addButton = addRow.createEl("button", { text: "+ Línea" });
    addButton.onclick = () => {
      this.lines.push(this.blankLine());
      this.renderLines();
      this.renderTotals();
    };

    this.totalsEl = contentEl.createDiv({ cls: "octa-totals" });
    this.renderTotals();

    new Setting(contentEl).setName("Notas").addTextArea((a) =>
      a.setPlaceholder("Opcional, aparece en el documento").onChange((v) => (this.notes = v)),
    );

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Emitir").setCta().onClick(() => void this.issue()));

    contentEl.createDiv({
      cls: "octa-footnote",
      text: "Una factura emitida no se edita: se corrige con nota de crédito. El correlativo se asigna al emitir.",
    });
  }

  private renderLines(): void {
    this.linesEl.empty();
    const products = activeProducts(this.options.state);

    const wrap = this.linesEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table octa-lines" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Producto", "Descripción", "Cant.", "Precio", "IVA %", "DTO %", "DTO $", "Subtotal", ""]) {
      head.createEl("th", { text: label });
    }
    const tbody = table.createEl("tbody");
    this.lines.forEach((line, index) => this.lineRow(tbody, line, index, products));
  }

  private lineRow(tbody: HTMLElement, line: DraftLine, index: number, products: readonly Product[]): void {
    const row = tbody.createEl("tr");

    const productCell = row.createEl("td");
    const select = productCell.createEl("select", { cls: "dropdown" });
    select.createEl("option", { value: "", text: "— libre —" });
    for (const product of products) {
      select.createEl("option", { value: product.id, text: product.name });
    }
    select.value = line.productId;
    select.onchange = () => {
      line.productId = select.value;
      const product = products.find((p) => p.id === select.value);
      line.picks = [];
      if (product) {
        // Se copian los datos del producto a la línea; a partir de acá la línea
        // es independiente, porque el documento congela lo que se facturó.
        line.description = product.name;
        line.unitPriceRaw = toDecimalString(product.salePrice);
        line.taxRateRaw = String(product.taxRate ?? this.options.defaultTaxRate);
        // Un configurable abre tantos selectores como unidades pida cada opción.
        for (const option of product.options ?? []) {
          const first = choicesFor(this.options.state.products, option)[0];
          for (let i = 0; i < option.quantity; i++) {
            line.picks.push({ label: option.label, productId: first?.id ?? "" });
          }
        }
      }
      this.renderLines();
      this.renderTotals();
    };

    this.cellInput(row, line, "description", "Detalle", "text");
    this.cellInput(row, line, "quantityRaw", "1", "decimal", "octa-cell-narrow");
    this.cellInput(row, line, "unitPriceRaw", "0.00", "decimal", "octa-cell-narrow");
    this.cellInput(row, line, "taxRateRaw", "12", "decimal", "octa-cell-narrow");
    this.cellInput(row, line, "discountPercentRaw", "", "decimal", "octa-cell-narrow");
    this.cellInput(row, line, "discountAmountRaw", "", "decimal", "octa-cell-narrow");

    const subtotal = this.lineSubtotal(line);
    row.createEl("td", {
      cls: "octa-num",
      text: subtotal ? format(subtotal, this.options.locale) : "—",
    });

    const actions = row.createEl("td", { cls: "octa-actions" });
    const remove = actions.createEl("button", { attr: { "aria-label": "Quitar línea" } });
    setIcon(remove, "trash-2");
    if (remove.childElementCount === 0) remove.setText("×");
    remove.onclick = () => {
      this.lines.splice(index, 1);
      if (this.lines.length === 0) this.lines.push(this.blankLine());
      this.renderLines();
      this.renderTotals();
    };

    this.picksRow(row, line, products);
  }

  /** Selectores de opciones, en una fila propia debajo de la línea. */
  private picksRow(row: HTMLElement, line: DraftLine, products: readonly Product[]): void {
    const product = products.find((p) => p.id === line.productId);
    if (!product || !isConfigurable(product) || line.picks.length === 0) return;

    const tbody = row.parentElement;
    if (!tbody) return;
    const picksRow = tbody.createEl("tr", { cls: "octa-picks-row" });
    const cell = picksRow.createEl("td", { attr: { colspan: "9" } });
    const strip = cell.createDiv({ cls: "octa-picks" });

    line.picks.forEach((pick, i) => {
      const option = (product.options ?? []).find((o) => o.label === pick.label);
      const group = strip.createDiv({ cls: "octa-pick" });
      const sameLabel = line.picks.filter((p) => p.label === pick.label).length;
      const ordinal = sameLabel > 1 ? ` ${line.picks.slice(0, i + 1).filter((p) => p.label === pick.label).length}` : "";
      group.createSpan({ cls: "octa-pick-label", text: `${pick.label}${ordinal}` });

      const select = group.createEl("select", { cls: "dropdown" });
      const candidates = option ? choicesFor(this.options.state.products, option) : [];
      for (const candidate of candidates) select.createEl("option", { value: candidate.id, text: candidate.name });
      select.value = pick.productId;
      select.onchange = () => {
        pick.productId = select.value;
      };
    });
  }

  private cellInput(
    row: HTMLElement,
    line: DraftLine,
    key: keyof DraftLine,
    placeholder: string,
    mode: "text" | "decimal",
    cls = "",
  ): void {
    const cell = row.createEl("td");
    const input = cell.createEl("input", { cls: cls || undefined });
    input.type = "text";
    input.placeholder = placeholder;
    input.value = String(line[key]);
    if (mode === "decimal") input.inputMode = "decimal";
    input.oninput = () => {
      (line[key] as string) = input.value;
      this.updateSubtotal(row, line);
      this.renderTotals();
    };
  }

  private updateSubtotal(row: HTMLElement, line: DraftLine): void {
    const cells = row.querySelectorAll("td");
    const cell = cells.item(cells.length - 2);
    if (!cell) return;
    const subtotal = this.lineSubtotal(line);
    cell.textContent = subtotal ? format(subtotal, this.options.locale) : "—";
  }

  /** Subtotal con impuesto de la línea, o `undefined` si todavía no es calculable. */
  private lineSubtotal(line: DraftLine): Money | undefined {
    const parsed = this.parseLine(line);
    if (!parsed) return undefined;
    try {
      return computeLineTotals(parsed).total;
    } catch {
      return undefined;
    }
  }

  private parseLine(line: DraftLine): InvoiceLine | undefined {
    const quantity = Number(line.quantityRaw);
    const taxRate = Number(line.taxRateRaw);
    if (!Number.isFinite(quantity) || !Number.isFinite(taxRate)) return undefined;
    if (line.unitPriceRaw.trim() === "") return undefined;
    let unitPrice: Money;
    try {
      unitPrice = fromDecimal(line.unitPriceRaw, this.options.currency);
    } catch {
      return undefined;
    }
    const discount = this.parseDiscount(line);
    if (discount === undefined && this.hasDiscountProblem(line)) return undefined;
    return {
      description: line.description.trim(),
      quantity,
      unitPrice,
      taxRate,
      ...(discount ? { discount } : {}),
      ...(line.productId ? { productId: line.productId } : {}),
      ...(line.picks.length > 0 ? { selections: groupPicks(line.picks) } : {}),
    };
  }

  /** Descuento de línea: percent y/o amount, según qué campos estén completos. */
  private parseDiscount(line: DraftLine): LineDiscount | undefined {
    const result = parseDiscountInput(line.discountPercentRaw, line.discountAmountRaw, this.options.currency);
    return result.kind === "ok" ? result.discount : undefined;
  }

  /** True si los campos de descuento de la línea están presentes pero inválidos. */
  private hasDiscountProblem(line: DraftLine): boolean {
    return parseDiscountInput(line.discountPercentRaw, line.discountAmountRaw, this.options.currency).kind === "invalid";
  }

  private renderTotals(): void {
    this.totalsEl.empty();

    if (this.lines.some((line) => this.hasDiscountProblem(line))) {
      this.totalsEl.createDiv({ cls: "octa-subtle", text: "Revisá los descuentos de las líneas." });
      return;
    }

    const parsed = this.lines.map((l) => this.parseLine(l)).filter((l): l is InvoiceLine => l !== undefined);

    if (parsed.length === 0) {
      this.totalsEl.createDiv({ cls: "octa-subtle", text: "Completá al menos una línea para ver los totales." });
      return;
    }

    let totals;
    try {
      totals = computeInvoiceTotals(parsed, this.options.currency);
    } catch {
      this.totalsEl.createDiv({ cls: "octa-subtle", text: "Revisá las cantidades y los precios." });
      return;
    }

    const row = (label: string, value: Money, strong = false) => {
      const line = this.totalsEl.createDiv({ cls: "octa-total-row" });
      line.createSpan({ text: label });
      line.createSpan({
        cls: strong ? "octa-num octa-strong" : "octa-num",
        text: format(value, this.options.locale),
      });
    };

    row("Base imponible", totals.untaxed);
    for (const [rate, amount] of [...totals.taxByRate.entries()].sort((a, b) => a[0] - b[0])) {
      row(`IVA ${rate}%`, amount);
    }
    row("Total", totals.total, true);
  }

  private async issue(): Promise<void> {
    this.errorsEl.empty();
    const problems: string[] = [];

    const parsed: InvoiceLine[] = [];
    this.lines.forEach((line, index) => {
      if (this.hasDiscountProblem(line)) {
        problems.push(`Línea ${index + 1}: descuento inválido`);
        return;
      }
      const one = this.parseLine(line);
      if (!one) {
        problems.push(`Línea ${index + 1}: cantidad, precio o IVA incompletos`);
        return;
      }
      if (one.description === "") problems.push(`Línea ${index + 1}: falta la descripción`);
      const product = line.productId ? this.options.state.products.get(line.productId) : undefined;
      if (product && isConfigurable(product)) {
        const bad = validateSelections(this.options.state.products, product, one.selections ?? []);
        problems.push(...bad.map((m) => `Línea ${index + 1}: ${m}`));
      }
      parsed.push(one);
    });

    const partner = this.selectedPartner;
    const input: IssueInvoiceInput = {
      series: this.options.series,
      date: this.date,
      currency: this.options.currency,
      lines: parsed,
      partnerName: partner?.name ?? "Consumidor final",
      partnerTaxId: partner?.taxId ?? "CF",
      ...(partner ? { partnerId: partner.id } : {}),
      ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
    };

    problems.push(...validateIssueInput(input).map((e) => e.message));

    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const message of problems) list.createEl("li", { text: message });
      return;
    }

    // Autoridad local: válida solo con un operador. En modo Conectado el número
    // lo reserva el servidor antes de emitir (ADR-001).
    const authority = new LocalNumberAuthority(
      (series) => this.options.state.lastNumberBySeries.get(series),
      "personal",
    );
    const reserved = await authority.reserve(this.options.series);

    await this.options.onIssue({ ...input, number: reserved.number });
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** Totales de una emisión, para el aviso de confirmación. */
export function issueSummary(input: IssueInvoiceInput, currency: string, locale: string): string {
  try {
    const totals = computeInvoiceTotals(input.lines, currency);
    return format(totals.total, locale);
  } catch {
    return format(zero(currency), locale);
  }
}

export { totalsSnapshot };

/** Agrupa las elecciones repetidas: dos veces chorizo es chorizo ×2. */
function groupPicks(picks: readonly { label: string; productId: string }[]): OptionSelection[] {
  const byKey = new Map<string, OptionSelection>();
  for (const pick of picks) {
    if (pick.productId === "") continue;
    const key = `${pick.label}::${pick.productId}`;
    const current = byKey.get(key);
    byKey.set(key, {
      label: pick.label,
      productId: pick.productId,
      quantity: (current?.quantity ?? 0) + 1,
    });
  }
  return [...byKey.values()];
}
