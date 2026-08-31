import {
  format,
  generateId,
  paidReceipts,
  receiptTotal,
  receiptsInMonth,
  toIsoDate,
  unpaidReceipts,
  type Receipt,
} from "@octasuite/core";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { PAYABLES_VIEW_TYPE } from "../modules.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";
import { PaymentModal } from "./payment-modal.js";

/**
 * Cuentas por pagar: el espejo de Facturas del lado de las compras. Entradas
 * de stock registra qué entró; acá se marca qué ya se pagó de eso.
 */
export class PayablesView extends ItemView {
  private month = toIsoDate(new Date()).slice(0, 7);

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return PAYABLES_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Pagos";
  }

  override getIcon(): string {
    return "credit-card";
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

    const bar = moduleHeader(contentEl, "Pagos", this.host, this.app, this.leaf, PAYABLES_VIEW_TYPE);
    const nav = bar.createDiv({ cls: "octa-period" });
    nav.createEl("button", { text: "◀" }).onclick = () => this.shiftMonth(-1);
    nav.createSpan({ text: this.month, cls: "octa-mono" });
    nav.createEl("button", { text: "▶" }).onclick = () => this.shiftMonth(1);

    const unpaid = unpaidReceipts(state, this.month, currency);
    const paid = paidReceipts(state, this.month, currency);

    const kpis = contentEl.createDiv({ cls: "octa-kpis" });
    this.kpi(kpis, "Por pagar", format(unpaid.amount, locale), `${unpaid.count} entrada(s)`);
    this.kpi(kpis, "Pagado este período", format(paid, locale));

    const receipts = receiptsInMonth(state, this.month);
    if (receipts.length === 0) {
      contentEl.createEl("p", { cls: "octa-empty", text: "Sin entradas de stock en este período." });
      contentEl.createDiv({
        cls: "octa-footnote",
        text: "Las compras se registran en Entradas de stock. Acá solo se marca qué ya se pagó.",
      });
      return;
    }

    const wrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Fecha", "Proveedor", "Documento", "Total", "Estado", ""]) {
      head.createEl("th", { text: label });
    }
    const tbody = table.createEl("tbody");
    for (const receipt of receipts) this.row(tbody, receipt);
  }

  private row(tbody: HTMLElement, receipt: Receipt): void {
    const { settings } = this.host;
    const row = tbody.createEl("tr");

    row.createEl("td", { text: receipt.date, cls: "octa-mono" });
    row.createEl("td", { text: receipt.partnerName ?? "—" });
    row.createEl("td", { text: receipt.reference ?? "—", cls: "octa-mono" });
    row.createEl("td", { text: format(receiptTotal(receipt, settings.currency), settings.locale), cls: "octa-num" });

    const status = row.createEl("td");
    if (receipt.status === "paid") {
      status.createSpan({ cls: "octa-chip is-status-paid", text: "Pagada" });
      if (receipt.paymentMethod) {
        status.createDiv({ cls: "octa-subtle", text: receipt.paymentMethod });
      }
    } else {
      status.createSpan({ cls: "octa-chip is-status-submitted", text: "Pendiente" });
    }

    const actions = row.createEl("td", { cls: "octa-actions" });
    if (receipt.status === "unpaid") {
      actions.createEl("button", { text: "Pagar" }).onclick = () => this.pay(receipt);
    }
  }

  private pay(receipt: Receipt): void {
    const { settings } = this.host;
    new PaymentModal(this.app, {
      heading: `Pagar entrada${receipt.reference ? ` ${receipt.reference}` : ""}`,
      subtitle: `${receipt.partnerName ?? "Sin proveedor"} · ${format(receiptTotal(receipt, settings.currency), settings.locale)}`,
      defaultMethod: settings.defaultPaymentMethod,
      dateLabel: "Fecha del pago",
      confirmText: "Registrar pago",
      initialDate: toIsoDate(new Date()),
      onSubmit: async ({ method, date }) => {
        const ok = await this.host.commit(
          this.host.newEvent("stock.receipt_paid", {
            receiptId: receipt.id,
            // Se guarda la fecha elegida, no el instante del clic: un pago se
            // registra a veces días después de hecho.
            paidAt: `${date}T12:00:00.000Z`,
            paymentMethod: method,
          }),
        );
        if (ok) new Notice(`Entrada pagada — ${method.toLowerCase()}`);
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
