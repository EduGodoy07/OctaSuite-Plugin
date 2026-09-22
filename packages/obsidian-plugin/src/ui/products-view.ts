import {
  activeProducts,
  format,
  generateId,
  grossMarginPercent,
  isKit,
  purchaseAverageCost,
  stockLevels,
  type Product,
} from "@octasuite/core";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { PRODUCTS_VIEW_TYPE } from "../modules.js";
import { AdjustmentModal } from "./adjustment-modal.js";
import { ConfirmModal } from "./confirm-modal.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";
import { PricelistManagerModal } from "./pricelist-manager-modal.js";
import { ProductModal } from "./product-modal.js";

export class ProductsView extends ItemView {
  private filter = "";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return PRODUCTS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Productos";
  }

  override getIcon(): string {
    return "package";
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private matches(product: Product): boolean {
    if (this.filter === "") return true;
    const needle = this.filter.toLowerCase();
    return [product.name, product.reference, product.categoryName]
      .filter((v): v is string => typeof v === "string")
      .some((v) => v.toLowerCase().includes(needle));
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");

    const bar = moduleHeader(contentEl, "Productos", this.host, this.app, this.leaf, PRODUCTS_VIEW_TYPE);
    const tools = bar.createDiv({ cls: "octa-period" });
    const search = tools.createEl("input", { cls: "octa-search" });
    search.type = "search";
    search.placeholder = "Buscar nombre, código, categoría…";
    search.value = this.filter;
    search.oninput = () => {
      this.filter = search.value.trim();
      this.renderList();
    };
    tools.createEl("button", { text: "+ Producto", cls: "mod-cta" }).onclick = () => this.openEditor();
    tools.createEl("button", { text: "Precios" }).onclick = () =>
      new PricelistManagerModal(this.app, this.host).open();

    contentEl.createDiv({ cls: "octa-list-slot" });
    this.renderList();

    contentEl.createDiv({
      cls: "octa-footnote",
      text: "La existencia no se guarda: se calcula como entradas − ventas ± ajustes. Un combo no lleva existencia propia; al venderlo se descuentan sus componentes.",
    });
  }

  private renderList(): void {
    const slot = this.contentEl.querySelector<HTMLElement>(".octa-list-slot");
    if (!slot) return;
    slot.empty();

    const products = activeProducts(this.host.state).filter((p) => this.matches(p));

    if (products.length === 0) {
      slot.createEl("p", {
        cls: "octa-empty",
        text: this.filter ? `Ningún producto coincide con «${this.filter}».` : "Todavía no hay productos.",
      });
      return;
    }

    const levels = stockLevels(this.host.state);
    const wrap = slot.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Producto", "Código", "Precio", "Costo", "Margen", "IVA", "Existencia", ""]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const product of products) this.row(tbody, product, levels.get(product.id)?.onHand ?? 0);
  }

  private row(tbody: HTMLElement, product: Product, onHand: number): void {
    const { settings, state } = this.host;
    const kit = isKit(product);
    const row = tbody.createEl("tr");

    const nameCell = row.createEl("td");
    nameCell.createSpan({ text: product.name });
    const meta = [product.categoryName, product.unit].filter(Boolean).join(" · ");
    if (meta) nameCell.createDiv({ cls: "octa-subtle", text: meta });
    if (kit) {
      const parts = (product.components ?? [])
        .map((c) => `${c.quantity} × ${state.products.get(c.productId)?.name ?? "?"}`)
        .join(" + ");
      nameCell.createDiv({ cls: "octa-subtle", text: `Combo: ${parts}` });
    }

    row.createEl("td", { text: product.reference ?? "—", cls: "octa-mono" });
    row.createEl("td", { text: format(product.salePrice, settings.locale), cls: "octa-num" });

    // El costo de compra real gana sobre el tecleado: es el que salió del bolsillo.
    const averageCost = purchaseAverageCost(state, product.id, settings.currency);
    const effectiveCost = averageCost ?? product.costPrice;
    const costCell = row.createEl("td", { cls: "octa-num" });
    if (!effectiveCost) {
      costCell.createSpan({ cls: "octa-subtle", text: "—" });
    } else {
      costCell.setText(format(effectiveCost, settings.locale));
      if (averageCost) costCell.createDiv({ cls: "octa-subtle", text: "promedio de compra" });
    }

    const margin = grossMarginPercent(product.salePrice, effectiveCost);
    const marginCell = row.createEl("td", { cls: "octa-num" });
    if (margin === null) marginCell.createSpan({ cls: "octa-subtle", text: "—" });
    else marginCell.createSpan({ cls: margin < 0 ? "octa-invalid" : "", text: `${margin.toFixed(1)}%` });

    row.createEl("td", { text: `${product.taxRate ?? settings.defaultTaxRate}%`, cls: "octa-num octa-mono" });

    const stockCell = row.createEl("td", { cls: "octa-num" });
    if (kit) {
      stockCell.createSpan({ cls: "octa-subtle", text: "se arma" });
    } else {
      stockCell.createSpan({
        cls: onHand < 0 ? "octa-invalid" : "",
        text: String(Math.round(onHand * 100) / 100),
      });
    }

    const actions = row.createEl("td", { cls: "octa-actions" });
    actions.createEl("button", { text: "Editar" }).onclick = () => this.openEditor(product);
    if (!kit) {
      actions.createEl("button", { text: "Ajustar" }).onclick = () => this.openAdjustment(product, onHand);
    }
    actions.createEl("button", { text: "Archivar" }).onclick = () => this.confirmArchive(product);
  }

  private openEditor(existing?: Product): void {
    const { settings, state } = this.host;
    new ProductModal(this.app, {
      ...(existing ? { existing } : {}),
      state,
      currency: settings.currency,
      defaultTaxRate: settings.defaultTaxRate,
      locale: settings.locale,
      onSubmit: async (draft) => {
        const ok = existing
          ? await this.host.commit(this.host.newEvent("product.updated", { productId: existing.id, changes: draft }))
          : await this.host.commit(this.host.newEvent("product.created", { productId: generateId("prd"), ...draft }));
        if (ok) new Notice(existing ? `${draft.name} actualizado` : `${draft.name} agregado`);
      },
      onRegisterUom: async (entry) => {
        // Feedback unico: el span del hint en el modal (product-modal.ts) muestra
        // "agregada"/"ya estaba" segun el resultado — la Notice es redundante.
        // Usa la instancia compartida del host (mismo mutex que el load).
        return this.host.catalogs.saveUom(entry);
      },
    }).open();
  }

  private openAdjustment(product: Product, currentStock: number): void {
    new AdjustmentModal(this.app, {
      product,
      currentStock,
      onSubmit: async ({ quantity, reason, date }) => {
        const ok = await this.host.commit(
          this.host.newEvent("stock.adjusted", {
            adjustmentId: generateId("ajt"),
            date,
            productId: product.id,
            quantity,
            reason,
          }),
        );
        if (ok) {
          const signo = quantity > 0 ? "+" : "";
          new Notice(`${product.name}: ${signo}${quantity} (${reason.toLowerCase()})`);
        }
      },
    }).open();
  }

  private confirmArchive(product: Product): void {
    new ConfirmModal(this.app, {
      title: "Archivar producto",
      body: `${product.name} sale de las listas y del selector de líneas. Las facturas ya emitidas no cambian: guardan la descripción y el precio tal como estaban al emitir.`,
      confirmText: "Archivar",
      destructive: true,
      onConfirm: async () => {
        const ok = await this.host.commit(this.host.newEvent("product.archived", { productId: product.id }));
        if (ok) new Notice(`${product.name} archivado`);
      },
    }).open();
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}
