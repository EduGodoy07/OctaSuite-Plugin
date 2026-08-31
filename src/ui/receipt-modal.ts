import {
  activePartners,
  activeProducts,
  format,
  fromDecimal,
  isKit,
  toDecimalString,
  toIsoDate,
  zero,
  type Money,
  type Product,
  type ReceiptLine,
  type State,
} from "@octasuite/core";
import { App, Modal, setIcon, Setting } from "obsidian";

interface DraftLine {
  productId: string;
  quantityRaw: string;
  unitCostRaw: string;
}

export class ReceiptModal extends Modal {
  private partnerId = "";
  private partnerNameRaw = "";
  private reference = "";
  private date = toIsoDate(new Date());
  private lines: DraftLine[] = [];

  private linesEl!: HTMLElement;
  private totalEl!: HTMLElement;
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly state: State;
      readonly currency: string;
      readonly locale: string;
      readonly onSubmit: (data: {
        date: string;
        reference?: string;
        partnerId?: string;
        partnerName?: string;
        lines: ReceiptLine[];
      }) => Promise<void>;
    },
  ) {
    super(app);
    this.lines = [this.blankLine()];
  }

  /** Solo productos simples: un combo se arma al vender, no se recibe. */
  private stockable(): Product[] {
    return activeProducts(this.options.state).filter((p) => !isKit(p));
  }

  private blankLine(): DraftLine {
    const first = this.stockable()[0];
    return {
      productId: first?.id ?? "",
      quantityRaw: "",
      unitCostRaw: first?.costPrice ? toDecimalString(first.costPrice) : "",
    };
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("octa-wide-modal");
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: "Nueva entrada de stock" });

    const suppliers = activePartners(this.options.state).filter((p) => p.accountType !== "address");
    new Setting(contentEl)
      .setName("Proveedor")
      .setDesc("Opcional. Si no está en contactos, escribí el nombre abajo.")
      .addDropdown((d) => {
        d.addOption("", "— sin contacto —");
        for (const partner of suppliers) d.addOption(partner.id, partner.name);
        d.setValue(this.partnerId).onChange((v) => (this.partnerId = v));
      });

    new Setting(contentEl).setName("Nombre del proveedor").addText((t) =>
      t.setPlaceholder("Distribuidora X").onChange((v) => (this.partnerNameRaw = v)),
    );

    new Setting(contentEl)
      .setName("Documento")
      .setDesc("Número de la factura del proveedor, para poder rastrear la entrada.")
      .addText((t) => t.setPlaceholder("FAC-12345").onChange((v) => (this.reference = v)));

    new Setting(contentEl).setName("Fecha").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(this.date).onChange((v) => (this.date = v));
    });

    contentEl.createEl("h4", { text: "Líneas", cls: "octa-group" });
    this.linesEl = contentEl.createDiv();
    this.renderLines();

    const addRow = contentEl.createDiv({ cls: "octa-add-line" });
    addRow.createEl("button", { text: "+ Línea" }).onclick = () => {
      this.lines.push(this.blankLine());
      this.renderLines();
      this.renderTotal();
    };

    this.totalEl = contentEl.createDiv({ cls: "octa-totals" });
    this.renderTotal();

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Registrar entrada").setCta().onClick(() => void this.submit()));

    contentEl.createDiv({
      cls: "octa-footnote",
      text: "El costo unitario alimenta el costo promedio de compra, que es el que hace real el margen del producto.",
    });
  }

  private renderLines(): void {
    this.linesEl.empty();
    const products = this.stockable();

    if (products.length === 0) {
      this.linesEl.createEl("p", {
        cls: "octa-empty",
        text: "No hay productos simples en el catálogo. Creá primero los insumos que se compran.",
      });
      return;
    }

    const wrap = this.linesEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table octa-lines" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Producto", "Cantidad", "Costo unitario", "Subtotal", ""]) head.createEl("th", { text: label });
    const tbody = table.createEl("tbody");

    this.lines.forEach((line, index) => {
      const row = tbody.createEl("tr");

      const select = row.createEl("td").createEl("select", { cls: "dropdown" });
      for (const product of products) select.createEl("option", { value: product.id, text: product.name });
      select.value = line.productId;
      select.onchange = () => {
        line.productId = select.value;
        const product = products.find((p) => p.id === select.value);
        if (product?.costPrice && line.unitCostRaw.trim() === "") {
          line.unitCostRaw = toDecimalString(product.costPrice);
        }
        this.renderLines();
        this.renderTotal();
      };

      const qty = row.createEl("td").createEl("input", { cls: "octa-cell-narrow" });
      qty.type = "text";
      qty.inputMode = "decimal";
      qty.placeholder = "0";
      qty.value = line.quantityRaw;
      qty.oninput = () => {
        line.quantityRaw = qty.value;
        this.renderTotal();
      };

      const cost = row.createEl("td").createEl("input", { cls: "octa-cell-narrow" });
      cost.type = "text";
      cost.inputMode = "decimal";
      cost.placeholder = "0.00";
      cost.value = line.unitCostRaw;
      cost.oninput = () => {
        line.unitCostRaw = cost.value;
        this.renderTotal();
      };

      const subtotal = this.lineSubtotal(line);
      row.createEl("td", { cls: "octa-num", text: subtotal ? format(subtotal, this.options.locale) : "—" });

      const actions = row.createEl("td", { cls: "octa-actions" });
      const remove = actions.createEl("button", { attr: { "aria-label": "Quitar línea" } });
      setIcon(remove, "trash-2");
      if (remove.childElementCount === 0) remove.setText("×");
      remove.onclick = () => {
        this.lines.splice(index, 1);
        if (this.lines.length === 0) this.lines.push(this.blankLine());
        this.renderLines();
        this.renderTotal();
      };
    });
  }

  private parseLine(line: DraftLine): ReceiptLine | undefined {
    const quantity = Number(line.quantityRaw);
    if (!Number.isFinite(quantity) || quantity <= 0) return undefined;
    if (line.productId === "") return undefined;
    try {
      return { productId: line.productId, quantity, unitCost: fromDecimal(line.unitCostRaw, this.options.currency) };
    } catch {
      return undefined;
    }
  }

  private lineSubtotal(line: DraftLine): Money | undefined {
    const parsed = this.parseLine(line);
    if (!parsed) return undefined;
    return { minor: Math.round(parsed.unitCost.minor * parsed.quantity), currency: this.options.currency };
  }

  private renderTotal(): void {
    this.totalEl.empty();
    let minor = 0;
    for (const line of this.lines) minor += this.lineSubtotal(line)?.minor ?? 0;
    const row = this.totalEl.createDiv({ cls: "octa-total-row" });
    row.createSpan({ text: "Total de la entrada" });
    row.createSpan({
      cls: "octa-num octa-strong",
      text: format(minor === 0 ? zero(this.options.currency) : { minor, currency: this.options.currency }, this.options.locale),
    });
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    const problems: string[] = [];
    const lines: ReceiptLine[] = [];

    this.lines.forEach((line, index) => {
      const parsed = this.parseLine(line);
      if (!parsed) problems.push(`Línea ${index + 1}: producto, cantidad o costo incompletos`);
      else lines.push(parsed);
    });

    if (lines.length === 0) problems.push("La entrada requiere al menos una línea válida");

    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const message of problems) list.createEl("li", { text: message });
      return;
    }

    const partner = this.partnerId ? this.options.state.partners.get(this.partnerId) : undefined;
    await this.options.onSubmit({
      date: this.date,
      lines,
      ...(this.reference.trim() ? { reference: this.reference.trim() } : {}),
      ...(partner ? { partnerId: partner.id, partnerName: partner.name } : {}),
      ...(!partner && this.partnerNameRaw.trim() ? { partnerName: this.partnerNameRaw.trim() } : {}),
    });
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
