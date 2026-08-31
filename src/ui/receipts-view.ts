import {
  format,
  generateId,
  monthKeyOf,
  negativeStock,
  receiptTotal,
  receiptsInMonth,
  toIsoDate,
  zero,
  type Receipt,
} from "@octasuite/core";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { RECEIPTS_VIEW_TYPE } from "../modules.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";
import { ReceiptModal } from "./receipt-modal.js";

export class ReceiptsView extends ItemView {
  private month = monthKeyOf(toIsoDate(new Date()));

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return RECEIPTS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Entradas de stock";
  }

  override getIcon(): string {
    return "truck";
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

    const bar = moduleHeader(contentEl, "Entradas de stock", this.host, this.app, this.leaf, RECEIPTS_VIEW_TYPE);
    const nav = bar.createDiv({ cls: "octa-period" });
    nav.createEl("button", { text: "◀" }).onclick = () => this.shiftMonth(-1);
    nav.createSpan({ text: this.month, cls: "octa-mono" });
    nav.createEl("button", { text: "▶" }).onclick = () => this.shiftMonth(1);
    nav.createEl("button", { text: "+ Entrada", cls: "mod-cta" }).onclick = () => this.openEditor();

    const receipts = receiptsInMonth(state, this.month);
    const comprado = receipts.reduce(
      (acc, r) => ({ minor: acc.minor + receiptTotal(r, currency).minor, currency }),
      zero(currency),
    );
    const unidades = receipts.reduce((acc, r) => acc + r.lines.reduce((a, l) => a + l.quantity, 0), 0);

    const kpis = contentEl.createDiv({ cls: "octa-kpis" });
    this.kpi(kpis, "Comprado", format(comprado, locale));
    this.kpi(kpis, "Entradas", String(receipts.length));
    this.kpi(kpis, "Unidades recibidas", String(Math.round(unidades * 100) / 100));

    const negatives = negativeStock(state);
    if (negatives.length > 0) {
      const warn = contentEl.createDiv({ cls: "octa-warning" });
      warn.createEl("strong", { text: "Existencia negativa" });
      const list = warn.createEl("ul");
      for (const level of negatives) {
        const name = state.products.get(level.productId)?.name ?? level.productId;
        list.createEl("li", { text: `${name}: ${level.onHand}` });
      }
      warn.createEl("p", {
        text: "Casi siempre significa una entrada que no se registró. Registrala con su fecha real, no como ajuste.",
      });
    }

    if (receipts.length === 0) {
      contentEl.createEl("p", { cls: "octa-empty", text: "Sin entradas en este período." });
      return;
    }

    const wrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Fecha", "Proveedor", "Documento", "Productos", "Total"]) head.createEl("th", { text: label });
    const tbody = table.createEl("tbody");
    for (const receipt of receipts) this.row(tbody, receipt);
  }

  private row(tbody: HTMLElement, receipt: Receipt): void {
    const { state, settings } = this.host;
    const row = tbody.createEl("tr");
    row.createEl("td", { text: receipt.date, cls: "octa-mono" });
    row.createEl("td", { text: receipt.partnerName ?? "—" });
    row.createEl("td", { text: receipt.reference ?? "—", cls: "octa-mono" });

    const detail = row.createEl("td");
    for (const line of receipt.lines) {
      const name = state.products.get(line.productId)?.name ?? line.productId;
      detail.createDiv({
        cls: "octa-subtle",
        text: `${line.quantity} × ${name} @ ${format(line.unitCost, settings.locale)}`,
      });
    }

    row.createEl("td", {
      cls: "octa-num",
      text: format(receiptTotal(receipt, settings.currency), settings.locale),
    });
  }

  private openEditor(): void {
    const { state, settings } = this.host;
    new ReceiptModal(this.app, {
      state,
      currency: settings.currency,
      locale: settings.locale,
      onSubmit: async (data) => {
        const ok = await this.host.commit(
          this.host.newEvent("stock.received", { receiptId: generateId("ent"), ...data }),
        );
        if (ok) new Notice(`Entrada registrada: ${data.lines.length} producto(s)`);
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
