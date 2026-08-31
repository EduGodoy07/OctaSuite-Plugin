import {
  activeProducts,
  findProductByReference,
  fromDecimal,
  grossMarginPercent,
  isKit,
  markupRatio,
  toDecimalString,
  validateComponents,
  type ProductOption,
  validateProductDraft,
  type Product,
  type ProductComponent,
  type ProductDraft,
  type State,
} from "@octasuite/core";
import { App, Modal, setIcon, Setting } from "obsidian";

export class ProductModal extends Modal {
  private name: string;
  private reference: string;
  private salePriceRaw: string;
  private costPriceRaw: string;
  private taxRateRaw: string;
  private unit: string;
  private categoryName: string;
  private description: string;
  private components: { productId: string; quantityRaw: string }[];
  private saleOptions: { label: string; quantityRaw: string; fromCategory: string }[];

  private errorsEl!: HTMLElement;
  private marginEl!: HTMLElement;
  private componentsEl!: HTMLElement;
  private optionsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly existing?: Product;
      readonly state: State;
      readonly currency: string;
      readonly defaultTaxRate: number;
      readonly locale: string;
      readonly onSubmit: (draft: ProductDraft) => Promise<void>;
    },
  ) {
    super(app);
    const e = options.existing;
    this.name = e?.name ?? "";
    this.reference = e?.reference ?? "";
    this.salePriceRaw = e ? toDecimalString(e.salePrice) : "";
    this.costPriceRaw = e?.costPrice ? toDecimalString(e.costPrice) : "";
    this.taxRateRaw = String(e?.taxRate ?? options.defaultTaxRate);
    this.unit = e?.unit ?? "";
    this.categoryName = e?.categoryName ?? "";
    this.description = e?.description ?? "";
    this.components = (e?.components ?? []).map((c) => ({
      productId: c.productId,
      quantityRaw: String(c.quantity),
    }));
    this.saleOptions = (e?.options ?? []).map((o) => ({
      label: o.label,
      quantityRaw: String(o.quantity),
      fromCategory: o.fromCategory,
    }));
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("octa-wide-modal");
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: this.options.existing ? "Editar producto" : "Nuevo producto" });

    new Setting(contentEl).setName("Nombre").addText((t) => {
      t.setPlaceholder("Hot dog de chorizo").setValue(this.name).onChange((v) => (this.name = v));
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(contentEl)
      .setName("Código")
      .setDesc("Referencia interna. Debe ser única.")
      .addText((t) => t.setPlaceholder("HD-CHO").setValue(this.reference).onChange((v) => (this.reference = v)));

    new Setting(contentEl).setName(`Precio de venta (${this.options.currency})`).addText((t) => {
      t.setPlaceholder("35.00").setValue(this.salePriceRaw).onChange((v) => {
        this.salePriceRaw = v;
        this.updateMargin();
      });
      t.inputEl.inputMode = "decimal";
    });

    new Setting(contentEl)
      .setName(`Costo (${this.options.currency})`)
      .setDesc("Opcional. Si el producto se compra, el costo real sale de las entradas de stock.")
      .addText((t) => {
        t.setPlaceholder("18.00").setValue(this.costPriceRaw).onChange((v) => {
          this.costPriceRaw = v;
          this.updateMargin();
        });
        t.inputEl.inputMode = "decimal";
      });

    new Setting(contentEl).setName("IVA (%)").addText((t) =>
      t.setValue(this.taxRateRaw).onChange((v) => (this.taxRateRaw = v)),
    );

    new Setting(contentEl).setName("Unidad").addText((t) =>
      t.setPlaceholder("unidad, libra, hora").setValue(this.unit).onChange((v) => (this.unit = v)),
    );

    new Setting(contentEl).setName("Categoría").addText((t) =>
      t.setPlaceholder("Hot dogs, Combos, Insumos").setValue(this.categoryName).onChange((v) => (this.categoryName = v)),
    );

    // --- Receta ---
    contentEl.createEl("h4", { text: "Receta", cls: "octa-group" });
    contentEl.createEl("p", {
      cls: "octa-subtle",
      text: "Si agregás componentes, el producto es un combo: no lleva existencia propia y al venderlo se descuentan sus componentes.",
    });
    this.componentsEl = contentEl.createDiv();
    this.renderComponents();

    const addRow = contentEl.createDiv({ cls: "octa-add-line" });
    addRow.createEl("button", { text: "+ Componente" }).onclick = () => {
      const first = this.selectableProducts()[0];
      this.components.push({ productId: first?.id ?? "", quantityRaw: "1" });
      this.renderComponents();
      this.updateMargin();
    };

    // --- Opciones a elegir al vender ---
    contentEl.createEl("h4", { text: "Opciones al vender", cls: "octa-group" });
    contentEl.createEl("p", {
      cls: "octa-subtle",
      text: "Para combos donde el cliente escoge: «Carne», 2, de la categoría Carnes. El precio lo fija este producto; qué carne se elige al facturar.",
    });
    this.optionsEl = contentEl.createDiv();
    this.renderOptions();

    const addOption = contentEl.createDiv({ cls: "octa-add-line" });
    addOption.createEl("button", { text: "+ Opción" }).onclick = () => {
      this.saleOptions.push({ label: "Carne", quantityRaw: "1", fromCategory: this.categories()[0] ?? "" });
      this.renderOptions();
    };

    this.marginEl = contentEl.createDiv({ cls: "octa-margin-hint" });
    this.updateMargin();

    new Setting(contentEl).setName("Descripción").addTextArea((a) =>
      a.setValue(this.description).onChange((v) => (this.description = v)),
    );

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Guardar").setCta().onClick(() => void this.submit()));
  }

  /** Candidatos a componente: todo menos el producto que se está editando. */
  private selectableProducts(): Product[] {
    return activeProducts(this.options.state).filter((p) => p.id !== this.options.existing?.id);
  }

  private renderComponents(): void {
    this.componentsEl.empty();
    if (this.components.length === 0) {
      this.componentsEl.createEl("p", { cls: "octa-empty", text: "Producto simple, sin receta." });
      return;
    }

    const options = this.selectableProducts();
    const wrap = this.componentsEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table octa-lines" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Componente", "Cantidad", ""]) head.createEl("th", { text: label });
    const tbody = table.createEl("tbody");

    this.components.forEach((component, index) => {
      const row = tbody.createEl("tr");

      const select = row.createEl("td").createEl("select", { cls: "dropdown" });
      for (const product of options) {
        const label = isKit(product) ? `${product.name} (combo)` : product.name;
        select.createEl("option", { value: product.id, text: label });
      }
      select.value = component.productId;
      select.onchange = () => {
        component.productId = select.value;
        this.updateMargin();
      };

      const qtyCell = row.createEl("td");
      const qty = qtyCell.createEl("input", { cls: "octa-cell-narrow" });
      qty.type = "text";
      qty.inputMode = "decimal";
      qty.value = component.quantityRaw;
      qty.oninput = () => {
        component.quantityRaw = qty.value;
        this.updateMargin();
      };

      const actions = row.createEl("td", { cls: "octa-actions" });
      const remove = actions.createEl("button", { attr: { "aria-label": "Quitar componente" } });
      setIcon(remove, "trash-2");
      if (remove.childElementCount === 0) remove.setText("×");
      remove.onclick = () => {
        this.components.splice(index, 1);
        this.renderComponents();
        this.updateMargin();
      };
    });
  }

  /** Categorías existentes en el catálogo, para elegir de dónde salen las opciones. */
  private categories(): string[] {
    const names = new Set<string>();
    for (const product of activeProducts(this.options.state)) {
      if (product.categoryName) names.add(product.categoryName);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "es"));
  }

  private renderOptions(): void {
    this.optionsEl.empty();
    if (this.saleOptions.length === 0) {
      this.optionsEl.createEl("p", { cls: "octa-empty", text: "Nada que elegir: se vende tal cual." });
      return;
    }

    const categories = this.categories();
    const wrap = this.optionsEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table octa-lines" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Etiqueta", "Cuántas", "Categoría", ""]) head.createEl("th", { text: label });
    const tbody = table.createEl("tbody");

    this.saleOptions.forEach((option, index) => {
      const row = tbody.createEl("tr");

      const labelInput = row.createEl("td").createEl("input");
      labelInput.type = "text";
      labelInput.placeholder = "Carne";
      labelInput.value = option.label;
      labelInput.oninput = () => (option.label = labelInput.value);

      const qty = row.createEl("td").createEl("input", { cls: "octa-cell-narrow" });
      qty.type = "text";
      qty.inputMode = "numeric";
      qty.value = option.quantityRaw;
      qty.oninput = () => (option.quantityRaw = qty.value);

      const select = row.createEl("td").createEl("select", { cls: "dropdown" });
      for (const category of categories) select.createEl("option", { value: category, text: category });
      select.value = option.fromCategory;
      select.onchange = () => (option.fromCategory = select.value);

      const actions = row.createEl("td", { cls: "octa-actions" });
      const remove = actions.createEl("button", { attr: { "aria-label": "Quitar opción" } });
      setIcon(remove, "trash-2");
      if (remove.childElementCount === 0) remove.setText("×");
      remove.onclick = () => {
        this.saleOptions.splice(index, 1);
        this.renderOptions();
      };
    });
  }

  private parsedOptions(): ProductOption[] {
    return this.saleOptions
      .map((o) => ({ label: o.label.trim(), quantity: Number(o.quantityRaw), fromCategory: o.fromCategory }))
      .filter((o) => o.label !== "" && o.fromCategory !== "");
  }

  private parsedComponents(): ProductComponent[] {
    return this.components
      .map((c) => ({ productId: c.productId, quantity: Number(c.quantityRaw) }))
      .filter((c) => c.productId !== "");
  }

  /**
   * Margen contra el costo tecleado y, si es combo, también contra la suma de
   * los costos de sus componentes — que es el costo que de verdad tiene armarlo.
   */
  private updateMargin(): void {
    this.marginEl.empty();
    const sale = this.tryMoney(this.salePriceRaw);
    if (!sale) return;

    const cost = this.tryMoney(this.costPriceRaw);
    if (cost) {
      const margin = grossMarginPercent(sale, cost);
      const markup = markupRatio(sale, cost);
      if (margin !== null) {
        const line = this.marginEl.createDiv();
        line.createSpan({ text: "Margen bruto: " });
        line.createSpan({ cls: margin < 0 ? "octa-invalid" : "octa-strong", text: `${margin.toFixed(1)}%` });
        if (markup !== null) line.createSpan({ cls: "octa-subtle", text: `  ·  multiplicador ${markup.toFixed(2)}×` });
        if (margin < 0) this.marginEl.createDiv({ cls: "octa-subtle", text: "El precio está por debajo del costo." });
      }
    }

    const components = this.parsedComponents();
    if (components.length === 0) return;

    let componentsCost = 0;
    let complete = true;
    for (const component of components) {
      const product = this.options.state.products.get(component.productId);
      if (!product?.costPrice || !Number.isFinite(component.quantity)) {
        complete = false;
        continue;
      }
      componentsCost += product.costPrice.minor * component.quantity;
    }
    if (componentsCost === 0) return;

    const componentMargin = grossMarginPercent(sale, { minor: Math.round(componentsCost), currency: sale.currency });
    const line = this.marginEl.createDiv();
    line.createSpan({ text: "Margen sobre componentes: " });
    line.createSpan({
      cls: componentMargin !== null && componentMargin < 0 ? "octa-invalid" : "octa-strong",
      text: componentMargin === null ? "—" : `${componentMargin.toFixed(1)}%`,
    });
    if (!complete) {
      line.createSpan({ cls: "octa-subtle", text: "  ·  hay componentes sin costo cargado" });
    }
  }

  private tryMoney(raw: string) {
    if (raw.trim() === "") return undefined;
    try {
      return fromDecimal(raw, this.options.currency);
    } catch {
      return undefined;
    }
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    const problems: string[] = [];

    let salePrice;
    try {
      salePrice = fromDecimal(this.salePriceRaw, this.options.currency);
    } catch {
      problems.push(`Precio de venta inválido: ${this.salePriceRaw || "(vacío)"}`);
    }

    let costPrice;
    if (this.costPriceRaw.trim() !== "") {
      try {
        costPrice = fromDecimal(this.costPriceRaw, this.options.currency);
      } catch {
        problems.push(`Costo inválido: ${this.costPriceRaw}`);
      }
    }

    const taxRate = this.taxRateRaw.trim() === "" ? this.options.defaultTaxRate : Number(this.taxRateRaw);
    if (!Number.isFinite(taxRate)) problems.push(`IVA inválido: ${this.taxRateRaw}`);

    const duplicate =
      this.reference.trim() === ""
        ? undefined
        : findProductByReference(this.options.state, this.reference, this.options.existing?.id);
    if (duplicate) problems.push(`El código ${this.reference.trim()} ya lo usa «${duplicate.name}»`);

    const optionDefs = this.parsedOptions();
    for (const option of optionDefs) {
      if (!Number.isInteger(option.quantity) || option.quantity <= 0) {
        problems.push(`La opción «${option.label}» debe pedir un número entero mayor que cero`);
      }
      if (!this.categories().includes(option.fromCategory)) {
        problems.push(`La categoría «${option.fromCategory}» no existe en el catálogo`);
      }
    }
    const labels = optionDefs.map((o) => o.label);
    if (new Set(labels).size !== labels.length) problems.push("Hay dos opciones con la misma etiqueta");

    const components = this.parsedComponents();
    if (components.length > 0) {
      problems.push(
        ...validateComponents(this.options.state.products, this.options.existing?.id ?? "nuevo", components),
      );
    }

    if (salePrice) {
      const draft: ProductDraft = {
        name: this.name.trim(),
        salePrice,
        ...(costPrice ? { costPrice } : {}),
        ...(Number.isFinite(taxRate) ? { taxRate } : {}),
        ...(this.reference.trim() ? { reference: this.reference.trim() } : {}),
        ...(this.unit.trim() ? { unit: this.unit.trim() } : {}),
        ...(this.categoryName.trim() ? { categoryName: this.categoryName.trim() } : {}),
        ...(this.description.trim() ? { description: this.description.trim() } : {}),
        components,
        options: optionDefs,
      };
      problems.push(...validateProductDraft(draft).map((e) => e.message));

      if (problems.length === 0) {
        await this.options.onSubmit(draft);
        this.close();
        return;
      }
    }

    const list = this.errorsEl.createEl("ul");
    for (const message of problems) list.createEl("li", { text: message });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
