import { allCreditNotes, format, type StoredCreditNote } from "@octasuite/core";
import { ItemView, type ViewStateResult, WorkspaceLeaf } from "obsidian";
import { CREDIT_NOTES_VIEW_TYPE } from "../modules.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";

export interface CreditNotesViewParams {
  /** Filtrar por ID de factura. Abre la vista mostrando solo las notas de esa factura. */
  readonly filterInvoiceId?: string;
}

const TYPE_LABEL: Record<string, string> = {
  store_credit: "Crédito",
  refund: "Reembolso",
  exchange: "Cambio",
};

/**
 * Listado de notas de crédito de la empresa activa (solo lectura).
 *
 * Las notas se crean desde Facturas (openCreditNote) o Caja; esta vista es el
 * expediente historico: qué se devolvió, a qué factura, de qué tipo y por qué.
 *
 * Params (vía setViewState state): `filterInvoiceId` para pre-filtrar por factura.
 */
export class CreditNotesView extends ItemView {
  private filter = "";
  private filterInvoiceId: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return CREDIT_NOTES_VIEW_TYPE;
  }

  override getDisplayText(): string {
    if (this.filterInvoiceId) {
      const invoice = this.host.state.invoices.get(this.filterInvoiceId);
      return invoice ? `Notas de ${invoice.displayNumber}` : "Notas de crédito";
    }
    return "Notas de crédito";
  }

  override getIcon(): string {
    return "file-minus";
  }

  override async onOpen(): Promise<void> {
    const state = this.getState() as CreditNotesViewParams | undefined;
    if (state?.filterInvoiceId) {
      this.filterInvoiceId = state.filterInvoiceId;
      // Pre-filtrar por correlativo de la factura
      const invoice = this.host.state.invoices.get(state.filterInvoiceId);
      if (invoice) this.filter = invoice.displayNumber;
    }
    this.render();
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = state as CreditNotesViewParams | undefined;
    if (s?.filterInvoiceId) {
      this.filterInvoiceId = s.filterInvoiceId;
      const invoice = this.host.state.invoices.get(s.filterInvoiceId);
      if (invoice) this.filter = invoice.displayNumber;
    } else {
      this.filterInvoiceId = null;
    }
    this.render();
    await super.setState(state, result);
  }

  refresh(): void {
    this.render();
  }

  private matches(note: StoredCreditNote): boolean {
    // Filtro por factura (parámetro de apertura)
    if (this.filterInvoiceId && note.invoiceId !== this.filterInvoiceId) return false;

    if (this.filter === "") return true;
    const needle = this.filter.toLowerCase();
    const invoice = this.host.state.invoices.get(note.invoiceId);
    const haystack = [
      note.id,
      note.reason,
      invoice?.displayNumber ?? "",
      invoice?.partnerName ?? "",
      TYPE_LABEL[note.type ?? ""] ?? "",
      note.tenderRefund?.method ?? "",
    ].join(" ");
    return haystack.toLowerCase().includes(needle);
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");

    const title = this.filterInvoiceId
      ? (() => {
          const inv = this.host.state.invoices.get(this.filterInvoiceId!);
          return inv ? `Notas de ${inv.displayNumber}` : "Notas de crédito";
        })()
      : "Notas de crédito";

    const bar = moduleHeader(contentEl, title, this.host, this.app, this.leaf, CREDIT_NOTES_VIEW_TYPE);
    const tools = bar.createDiv({ cls: "octa-period" });
    const search = tools.createEl("input", { cls: "octa-search" });
    search.type = "search";
    search.placeholder = "Buscar nota, factura, cliente, motivo…";
    search.value = this.filter;
    search.oninput = () => {
      this.filter = search.value.trim();
      this.renderList();
    };

    contentEl.createDiv({ cls: "octa-list-slot" });
    this.renderList();
  }

  private renderList(): void {
    const slot = this.contentEl.querySelector<HTMLElement>(".octa-list-slot");
    if (!slot) return;
    slot.empty();

    const notes = allCreditNotes(this.host.state).filter((n) => this.matches(n));

    if (notes.length === 0) {
      slot.createEl("p", {
        cls: "octa-empty",
        text: this.filter
          ? `Ninguna nota de crédito coincide con «${this.filter}».`
          : "Todavía no hay notas de crédito. Se crean desde Facturas o Caja al devolver una venta.",
      });
      return;
    }

    const wrap = slot.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Nota", "Fecha", "Factura", "Cliente", "Tipo", "Motivo", "Monto"]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const note of notes) this.row(tbody, note);
  }

  private row(tbody: HTMLElement, note: StoredCreditNote): void {
    const { state, settings } = this.host;
    const row = tbody.createEl("tr");
    const invoice = state.invoices.get(note.invoiceId);

    row.createEl("td", { cls: "octa-mono", text: note.id });
    row.createEl("td", { text: note.date });
    const invoiceCell = row.createEl("td", { cls: "octa-mono" });
    if (invoice) {
      invoiceCell.createSpan({ text: invoice.displayNumber });
    } else {
      invoiceCell.createSpan({ cls: "octa-subtle", text: "—" });
    }
    row.createEl("td", { text: invoice?.partnerName ?? "—" });

    const type = (note.type && TYPE_LABEL[note.type]) ?? "Nota";
    row.createEl("td").createSpan({ cls: "octa-chip", text: type });

    const reasonCell = row.createEl("td");
    reasonCell.createSpan({ text: note.reason });
    if (note.tenderRefund) {
      reasonCell.createDiv({ cls: "octa-subtle", text: `tienda al ${note.tenderRefund.method}` });
    } else if (note.exchangeLines && note.exchangeLines.length > 0) {
      reasonCell.createDiv({ cls: "octa-subtle", text: `${note.exchangeLines.length} línea(s) de cambio` });
    }

    const amount = row.createEl("td", { cls: "octa-mono" });
    amount.createSpan({ text: format(note.amount, settings.locale) });
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}