import {
  computeInvoiceTotals,
  creditNotesFor,
  format,
  generateId,
  invoiceNetTotal,
  invoicesInMonth,
  monthKeyOf,
  seriesGaps,
  toIsoDate,
  totalInvoiced,
  totalsSnapshot,
  unpaidInvoices,
  type Invoice,
} from "@octasuite/core";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { INVOICES_VIEW_TYPE, PAYMENT_RECEIPT_VIEW_TYPE } from "../modules.js";
import { CreditNoteModal } from "./credit-note-modal.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";
import { InvoiceEditorModal } from "./invoice-editor-modal.js";
import { PaymentModal } from "./payment-modal.js";

export class InvoicesView extends ItemView {
  private month = monthKeyOf(toIsoDate(new Date()));

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return INVOICES_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Facturas";
  }

  override getIcon(): string {
    return "file-text";
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    const { state, settings } = this.host;
    const currency = settings.currency;
    const locale = settings.locale;
    contentEl.empty();
    contentEl.addClass("octa");

    const bar = moduleHeader(contentEl, "Facturas", this.host, this.app, this.leaf, INVOICES_VIEW_TYPE);
    const nav = bar.createDiv({ cls: "octa-period" });
    nav.createEl("button", { text: "◀" }).onclick = () => this.shiftMonth(-1);
    nav.createSpan({ text: this.month, cls: "octa-mono" });
    nav.createEl("button", { text: "▶" }).onclick = () => this.shiftMonth(1);
    nav.createEl("button", { text: "+ Factura", cls: "mod-cta" }).onclick = () => this.openEditor();

    const facturado = totalInvoiced(state, this.month, currency);
    const porCobrar = unpaidInvoices(state, this.month, currency);
    const invoices = invoicesInMonth(state, this.month);

    const kpis = contentEl.createDiv({ cls: "octa-kpis" });
    this.kpi(kpis, "Facturado", format(facturado, locale), "neto de notas de crédito");
    this.kpi(kpis, "Por cobrar", format(porCobrar.amount, locale), `${porCobrar.count} documento(s)`);
    this.kpi(kpis, "Documentos", String(invoices.length));

    const gaps = seriesGaps(state, settings.invoiceSeries);
    if (gaps.length > 0) {
      const warn = contentEl.createDiv({ cls: "octa-warning" });
      warn.createEl("strong", { text: "Huecos en el correlativo" });
      warn.createEl("p", {
        text: `Faltan los números ${gaps.join(", ")} de la serie ${settings.invoiceSeries}.`,
      });
    }

    if (invoices.length === 0) {
      contentEl.createEl("p", { cls: "octa-empty", text: "Sin documentos emitidos en este período." });
      return;
    }

    const wrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Número", "Fecha", "Cliente", "Total", "Saldo", "Estado", ""]) {
      head.createEl("th", { text: label });
    }
    const tbody = table.createEl("tbody");
    for (const invoice of invoices) this.row(tbody, invoice);
  }

  private row(tbody: HTMLElement, invoice: Invoice): void {
    const { locale } = this.host.settings;
    const row = tbody.createEl("tr");

    row.createEl("td", { text: invoice.displayNumber, cls: "octa-mono" });
    row.createEl("td", { text: invoice.date, cls: "octa-mono" });

    const client = row.createEl("td");
    client.createSpan({ text: invoice.partnerName });
    client.createDiv({ cls: "octa-subtle", text: invoice.partnerTaxId });

    row.createEl("td", { text: format(invoice.totals.total, locale), cls: "octa-num" });

    // `invoiceNetTotal` es el total neto de notas de crédito, no descuenta el
    // cobro. Mostrarlo tal cual dejaba una factura cobrada con saldo pendiente.
    const net = invoiceNetTotal(invoice);
    const pendiente = invoice.status === "paid" ? { minor: 0, currency: invoice.currency } : net;
    const saldo = row.createEl("td", { cls: "octa-num" });
    saldo.setText(format(pendiente, locale));
    const notes = creditNotesFor(this.host.state, invoice.id);
    if (notes.length > 0) {
      saldo.createDiv({
        cls: "octa-subtle",
        text: `${notes.length} nota(s) de crédito`,
      });
    }

    const status = row.createEl("td");
    if (invoice.status === "paid") {
      status.createSpan({ cls: "octa-chip is-status-paid", text: "Cobrada" });
    } else if (net.minor === 0) {
      status.createSpan({ cls: "octa-chip is-status-rejected", text: "Anulada" });
    } else {
      status.createSpan({ cls: "octa-chip is-status-submitted", text: "Emitida" });
    }

    const actions = row.createEl("td", { cls: "octa-actions" });
    if (invoice.status === "paid") {
      actions.createEl("button", { text: "Recibo" }).onclick = () => this.openReceipt(invoice);
    } else if (net.minor > 0) {
      actions.createEl("button", { text: "Cobrar" }).onclick = () => this.markPaid(invoice);
    }
    if (net.minor > 0) {
      actions.createEl("button", { text: "Nota de crédito" }).onclick = () => this.openCreditNote(invoice);
    }
  }

  private openEditor(): void {
    const { state, settings } = this.host;
    new InvoiceEditorModal(this.app, {
      host: this.host,
      state,
      currency: settings.currency,
      defaultTaxRate: settings.defaultTaxRate,
      series: settings.invoiceSeries,
      locale: settings.locale,
      onIssue: async (input) => {
        const totals = computeInvoiceTotals(input.lines, input.currency);
        const ok = await this.host.commit(
          this.host.newEvent("invoice.issued", {
            invoiceId: generateId("inv"),
            series: input.series,
            number: input.number,
            date: input.date,
            currency: input.currency,
            lines: input.lines,
            totals: totalsSnapshot(totals),
            partnerName: input.partnerName,
            partnerTaxId: input.partnerTaxId,
            ...(input.partnerId ? { partnerId: input.partnerId } : {}),
            ...(input.notes ? { notes: input.notes } : {}),
          }),
        );
        if (ok) {
          new Notice(
            `Factura ${input.series}-${String(input.number).padStart(4, "0")} emitida por ${format(totals.total, settings.locale)}`,
          );
        }
      },
    }).open();
  }

  private markPaid(invoice: Invoice): void {
    new PaymentModal(this.app, {
      heading: `Cobrar ${invoice.displayNumber}`,
      subtitle: `${invoice.partnerName} · ${format(invoiceNetTotal(invoice), this.host.settings.locale)}`,
      defaultMethod: this.host.settings.defaultPaymentMethod,
      dateLabel: "Fecha del cobro",
      confirmText: "Registrar cobro",
      initialDate: toIsoDate(new Date()),
      onSubmit: async ({ method, date }) => {
        const ok = await this.host.commit(
          this.host.newEvent("invoice.paid", {
            invoiceId: invoice.id,
            // Se guarda la fecha elegida, no el instante del clic: un cobro se
            // registra a veces días después de recibido.
            paidAt: `${date}T12:00:00.000Z`,
            paymentMethod: method,
          }),
        );
        if (ok) new Notice(`${invoice.displayNumber} cobrada — ${method.toLowerCase()}`);
      },
    }).open();
  }

  private openReceipt(invoice: Invoice): void {
    const leaf = this.app.workspace.getLeaf("split");
    leaf.setViewState({
      type: PAYMENT_RECEIPT_VIEW_TYPE,
      active: true,
      state: { invoice },
    });
  }

  private openCreditNote(invoice: Invoice): void {
    new CreditNoteModal(this.app, {
      invoice,
      locale: this.host.settings.locale,
      products: this.host.state.products,
      locations: this.host.state.locations,
      onSubmit: async ({ amount, reason, date, type, tenderMethod, returnLines, exchangeLines, stockReturnLocationId }) => {
        const creditNoteId = generateId("ncr");
        const ok = await this.host.commit(
          this.host.newEvent("invoice.refunded", {
            creditNoteId,
            invoiceId: invoice.id,
            date,
            amount,
            reason,
            type: type ?? "store_credit",
            tenderRefund: tenderMethod ? { method: tenderMethod, amount } : undefined,
            lines: returnLines,
            exchangeLines,
            stockReturnLocationId,
          }),
        );
        if (ok) new Notice(`Nota de crédito (${type ?? "store_credit"}) emitida sobre ${invoice.displayNumber}`);
      },
    }).open();
  }

  private kpi(parent: HTMLElement, label: string, value: string, hint?: string): void {
    const tile = parent.createDiv({ cls: "octa-kpi" });
    tile.createDiv({ cls: "octa-kpi-label", text: label });
    tile.createDiv({ cls: "octa-kpi-value", text: value });
    if (hint) tile.createDiv({ cls: "octa-kpi-hint", text: hint });
  }

  private shiftMonth(delta: number): void {
    const [y, m] = this.month.split("-").map(Number) as [number, number];
    const d = new Date(y, m - 1 + delta, 1);
    this.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    this.render();
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}
