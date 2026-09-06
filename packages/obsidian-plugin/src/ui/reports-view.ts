import {
  customerMetrics,
  dailyExpenses,
  monthlySeries,
  discountSummary,
  expensesByCategory,
  format,
  monthKeyOf,
  paymentMix,
  seriesGaps,
  toIsoDate,
  totalExpenses,
  totalInvoiced,
  unpaidInvoices,
} from "@octasuite/core";
import { ItemView, WorkspaceLeaf } from "obsidian";
import { REPORTS_VIEW_TYPE } from "../modules.js";
import type { PluginHost } from "./host.js";
import { donut, groupedBars, monthHeatmap } from "./charts.js";
import { moduleHeader } from "./nav.js";

/**
 * Reportes del período. La estructura de bloques —resumen, categorías, formas de
 * pago, clientes— viene de The Arepa Factory, que los tiene bien elegidos.
 */
export class ReportsView extends ItemView {
  private month = monthKeyOf(toIsoDate(new Date()));

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return REPORTS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Reportes";
  }

  override getIcon(): string {
    return "bar-chart";
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

    const bar = moduleHeader(contentEl, "Reportes", this.host, this.app, this.leaf, REPORTS_VIEW_TYPE);
    const nav = bar.createDiv({ cls: "octa-period" });
    nav.createEl("button", { text: "◀" }).onclick = () => this.shiftMonth(-1);
    nav.createSpan({ text: this.month, cls: "octa-mono" });
    nav.createEl("button", { text: "▶" }).onclick = () => this.shiftMonth(1);

    const facturado = totalInvoiced(state, this.month, currency);
    const gastos = totalExpenses(state, this.month, currency);
    const porCobrar = unpaidInvoices(state, this.month, currency);
    const descuentos = discountSummary(state, this.month, currency);

    const kpis = contentEl.createDiv({ cls: "octa-kpis" });
    this.kpi(kpis, "Facturado", format(facturado, locale));
    this.kpi(kpis, "Gastos", format(gastos, locale));
    this.kpi(kpis, "Diferencia", format({ minor: facturado.minor - gastos.minor, currency }, locale));
    this.kpi(kpis, "Por cobrar", format(porCobrar.amount, locale), `${porCobrar.count} factura(s)`);
    this.kpi(
      kpis,
      "Descuentos",
      descuentos.documents === 0 ? "—" : format(descuentos.total, locale),
      descuentos.documents === 0 ? "sin descuentos en el período" : `${descuentos.documents} factura(s)`,
    );

    // Tendencia: doce meses de facturado contra gastos
    const money = (minor: number) => format({ minor, currency }, locale);
    const series = monthlySeries(state, this.month, 12, currency);
    const hayMovimiento = series.some((p) => p.invoiced.minor > 0 || p.expenses.minor > 0);
    this.block(contentEl, "Tendencia de 12 meses", hayMovimiento ? null : "Todavía no hay movimiento que graficar.", (body) => {
      groupedBars(
        body,
        { name: "Facturado", points: series.map((p) => ({ label: p.month, value: p.invoiced.minor })) },
        { name: "Gastos", points: series.map((p) => ({ label: p.month, value: p.expenses.minor })) },
        money,
      );
    });

    // Calendario del mes: qué días concentran el gasto
    const days = dailyExpenses(state, this.month, currency);
    const gastoEnElMes = days.some((d) => d.amount.minor > 0);
    this.block(contentEl, "Gasto por día", gastoEnElMes ? null : "Sin gastos en el período.", (body) => {
      monthHeatmap(body, days.map((d) => ({ date: d.date, value: d.amount.minor })), money);
    });

    // Gasto por categoría
    const byCategory = [...expensesByCategory(state, this.month, currency).entries()].sort(
      (a, b) => b[1].minor - a[1].minor,
    );
    this.block(contentEl, "Gasto por categoría", byCategory.length === 0 ? "Sin gastos en el período." : null, (body) => {
      const table = body.createEl("table", { cls: "octa-table" });
      const tbody = table.createEl("tbody");
      for (const [categoryId, amount] of byCategory) {
        const row = tbody.createEl("tr");
        row.createEl("td", { text: state.categories.get(categoryId)?.name ?? "Sin categoría" });
        row.createEl("td", { text: format(amount, locale), cls: "octa-num" });
        this.bar(row.createEl("td", { cls: "octa-bar-cell" }), amount.minor / (byCategory[0]?.[1].minor || 1));
      }
    });

    // Formas de pago
    const mix = paymentMix(state, this.month, currency);
    this.block(
      contentEl,
      "Formas de pago",
      mix.slices.length === 0 ? "Todavía no hay facturas cobradas en el período." : null,
      (body) => {
        donut(
          body,
          mix.slices.map((slice) => ({
            label: slice.method,
            share: slice.share,
            detail: format(slice.amount, locale),
          })),
        );
        const table = body.createEl("table", { cls: "octa-table" });
        const tbody = table.createEl("tbody");
        for (const slice of mix.slices) {
          const row = tbody.createEl("tr");
          row.createEl("td", { text: slice.method });
          row.createEl("td", { text: format(slice.amount, locale), cls: "octa-num" });
          row.createEl("td", { text: `${Math.round(slice.share * 100)}%`, cls: "octa-num octa-mono" });
          this.bar(row.createEl("td", { cls: "octa-bar-cell" }), slice.share);
        }
      },
    );

    // Clientes
    const customers = customerMetrics(state, this.month, currency);
    this.block(contentEl, "Clientes", customers.tickets === 0 ? "Sin documentos emitidos en el período." : null, (body) => {
      const grid = body.createDiv({ cls: "octa-kpis" });
      this.kpi(grid, "Documentos", String(customers.tickets));
      this.kpi(grid, "Clientes identificados", String(customers.identified), "consumidor final no cuenta");
      this.kpi(
        grid,
        "Vuelven a comprar",
        customers.returningRate === null ? "—" : `${Math.round(customers.returningRate * 100)}%`,
        `${customers.returning} de ${customers.identified}`,
      );
      this.kpi(grid, "Ticket promedio", format(customers.avgTicket, locale));
    });

    const gaps = seriesGaps(state, settings.invoiceSeries);
    if (gaps.length > 0) {
      const warn = contentEl.createDiv({ cls: "octa-warning" });
      warn.createEl("strong", { text: "Huecos en el correlativo" });
      warn.createEl("p", {
        text: `Faltan los números ${gaps.join(", ")} de la serie ${settings.invoiceSeries}. Casi siempre significa un evento rechazado al reconciliar dos dispositivos.`,
      });
    }
  }

  private block(parent: HTMLElement, title: string, emptyMessage: string | null, build: (body: HTMLElement) => void): void {
    parent.createEl("h3", { text: title, cls: "octa-group" });
    if (emptyMessage) {
      parent.createEl("p", { text: emptyMessage, cls: "octa-empty" });
      return;
    }
    build(parent.createDiv({ cls: "octa-table-wrap" }));
  }

  private kpi(parent: HTMLElement, label: string, value: string, hint?: string): void {
    const tile = parent.createDiv({ cls: "octa-kpi" });
    tile.createDiv({ cls: "octa-kpi-label", text: label });
    tile.createDiv({ cls: "octa-kpi-value", text: value });
    if (hint) tile.createDiv({ cls: "octa-kpi-hint", text: hint });
  }

  /** Barra proporcional. Un número solo no deja ver el peso relativo. */
  private bar(cell: HTMLElement, ratio: number): void {
    const track = cell.createDiv({ cls: "octa-bar" });
    const fill = track.createDiv({ cls: "octa-bar-fill" });
    fill.style.width = `${Math.max(2, Math.min(100, ratio * 100))}%`;
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
