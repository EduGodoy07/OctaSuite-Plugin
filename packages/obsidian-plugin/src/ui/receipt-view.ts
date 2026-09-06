import { format, type Invoice } from "@octasuite/core";
import { ItemView, type ViewStateResult, WorkspaceLeaf } from "obsidian";
import { PAYMENT_RECEIPT_VIEW_TYPE } from "../modules.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";

export interface ReceiptViewParams {
  readonly invoice: Invoice;
}

/**
 * Vista de recibo de pago — diseño inspirado en Odoo 19.
 *
 * No crea eventos: es una vista derivada de Invoice + Settings.
 * Abre como leaf secundario (leaf: "split" en activate).
 */
export class ReceiptView extends ItemView {
  private invoice: Invoice | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return PAYMENT_RECEIPT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.invoice ? `Recibo ${this.invoice.displayNumber}` : "Recibo";
  }

  override getIcon(): string {
    return "file-text";
  }

  override async onOpen(): Promise<void> {
    const state = this.getState();
    if (state?.invoice) {
      this.invoice = state.invoice as Invoice;
    }
    this.render();
  }

  /** Recibe el estado del leaf al cambiar de vista. */
  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = state as Record<string, unknown> | undefined;
    if (s?.invoice) {
      this.invoice = s.invoice as Invoice;
      this.render();
    }
    await super.setState(state, result);
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    if (!this.invoice) return;
    const { contentEl } = this;
    const { state, settings } = this.host;
    const currency = settings.currency;
    const locale = settings.locale;
    const invoice = this.invoice;

    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.addClass("octa-receipt");

    // Header con botón de imprimir
    const bar = moduleHeader(contentEl, "Recibo de pago", this.host, this.app, this.leaf, PAYMENT_RECEIPT_VIEW_TYPE);
    bar.createEl("button", { text: "Imprimir", cls: "mod-cta" }).onclick = () => window.print();

    // Sección de empresa
    const companySection = contentEl.createDiv({ cls: "octa-receipt-company" });
    if (settings.companyLogo) {
      companySection.createEl("img", {
        cls: "octa-receipt-logo",
        attr: { src: settings.companyLogo, alt: settings.companyName || "Logo" },
      });
    }
    const companyInfo = companySection.createDiv({ cls: "octa-receipt-company-info" });
    companyInfo.createEl("strong", { text: settings.companyName || "Empresa" });
    if (settings.companyTaxId) {
      companyInfo.createDiv({ text: `NIT: ${settings.companyTaxId}` });
    }
    if (settings.companyAddress) {
      companyInfo.createDiv({ text: settings.companyAddress });
    }
    if (settings.companyPhone) {
      companyInfo.createDiv({ text: settings.companyPhone });
    }
    if (settings.companyEmail) {
      companyInfo.createDiv({ text: settings.companyEmail });
    }

    // Divider
    contentEl.createEl("hr", { cls: "octa-divider" });

    // Título del recibo
    const titleSection = contentEl.createDiv({ cls: "octa-receipt-title" });
    titleSection.createEl("h2", { text: "Recibo de pago" });

    // Detalles de la factura
    const detailsGrid = contentEl.createDiv({ cls: "octa-receipt-details" });
    const leftCol = detailsGrid.createDiv({ cls: "octa-receipt-details-left" });
    const rightCol = detailsGrid.createDiv({ cls: "octa-receipt-details-right" });

    // Izquierda: datos del cliente
    leftCol.createEl("strong", { text: "Cliente:" });
    leftCol.createDiv({ text: invoice.partnerName });
    if (invoice.partnerTaxId) {
      leftCol.createDiv({ cls: "octa-subtle", text: `NIT: ${invoice.partnerTaxId}` });
    }

    // Derecha: datos del documento
    rightCol.createEl("strong", { text: "Factura:" });
    rightCol.createDiv({ text: invoice.displayNumber, cls: "octa-mono" });
    rightCol.createEl("strong", { text: "Fecha:" });
    rightCol.createDiv({ text: invoice.date, cls: "octa-mono" });
    if (invoice.paidAt) {
      rightCol.createEl("strong", { text: "Cobro:" });
      rightCol.createDiv({ text: invoice.paidAt.split("T")[0]!, cls: "octa-mono" });
    }
    if (invoice.paymentMethod) {
      rightCol.createEl("strong", { text: "Método:" });
      rightCol.createDiv({ text: invoice.paymentMethod });
    }

    // Divider
    contentEl.createEl("hr", { cls: "octa-divider" });

    // Tabla de líneas
    const wrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table octa-receipt-table" });
    const thead = table.createEl("thead").createEl("tr");
    for (const label of ["Descripción", "Cant.", "Precio Unit.", "Subtotal", "IVA", "Total"]) {
      thead.createEl("th", { text: label });
    }
    const tbody = table.createEl("tbody");
    let subtotalAcum = 0;
    let ivaAcum = 0;
    let totalAcum = 0;

    for (const line of invoice.lines) {
      const subtotal = line.unitPrice.minor * line.quantity;
      const tax = Math.round((subtotal * line.taxRate) / 100);
      const total = subtotal + tax;
      subtotalAcum += subtotal;
      ivaAcum += tax;
      totalAcum += total;

      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: line.description });
      tr.createEl("td", { text: String(line.quantity), cls: "octa-num" });
      tr.createEl("td", { text: format({ minor: line.unitPrice.minor, currency }, locale), cls: "octa-num" });
      tr.createEl("td", { text: format({ minor: subtotal, currency }, locale), cls: "octa-num" });
      tr.createEl("td", { text: line.taxRate > 0 ? `${line.taxRate}%` : "-", cls: "octa-num" });
      tr.createEl("td", { text: format({ minor: total, currency }, locale), cls: "octa-num" });
    }

    // Totales
    const tfoot = table.createEl("tfoot").createEl("tr");
    const footerLabel = tfoot.createEl("td", { attr: { colspan: "5" } });
    footerLabel.createEl("strong", { text: "Subtotal:" });
    tfoot.createEl("td", { text: format({ minor: subtotalAcum, currency }, locale), cls: "octa-num" });

    const trIva = table.createEl("tfoot").createEl("tr");
    const ivaLabel = trIva.createEl("td", { attr: { colspan: "5" } });
    ivaLabel.createEl("strong", { text: "IVA:" });
    trIva.createEl("td", { text: format({ minor: ivaAcum, currency }, locale), cls: "octa-num" });

    const trTotal = table.createEl("tfoot").createEl("tr");
    const totalLabel = trTotal.createEl("td", { attr: { colspan: "5" } });
    totalLabel.createEl("strong", { text: "Total:" });
    trTotal.createEl("td", { text: format({ minor: totalAcum, currency }, locale), cls: "octa-num" });

    // Notas si existen
    if (invoice.notes) {
      contentEl.createEl("hr", { cls: "octa-divider" });
      const notesSection = contentEl.createDiv({ cls: "octa-receipt-notes" });
      notesSection.createEl("strong", { text: "Notas:" });
      notesSection.createDiv({ text: invoice.notes });
    }

    // Footer
    if (settings.receiptFooter) {
      contentEl.createEl("hr", { cls: "octa-divider" });
      contentEl.createEl("div", {
        cls: "octa-receipt-footer",
        text: settings.receiptFooter,
      });
    }
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}