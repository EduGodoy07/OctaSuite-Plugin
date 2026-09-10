import {
  consolidatedCustomerMetrics,
  consolidatedDailyExpenses,
  consolidatedDiscountSummary,
  consolidatedExpensesByCategory,
  consolidatedMonthlySeries,
  consolidatedPaymentMix,
  consolidatedTotalExpenses,
  consolidatedTotalInvoiced,
  consolidatedUnpaid,
  format,
  monthKeyOf,
  seriesGaps,
  toIsoDate,
} from "@octasuite/core";
import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { REPORTS_VIEW_TYPE } from "../modules.js";
import { DEFAULT_COMPANY_ID } from "../storage/vault-journal.js";
import { companyLabel } from "./company-switcher.js";
import type { PluginHost } from "./host.js";
import { donut, groupedBars, monthHeatmap } from "./charts.js";
import { moduleHeader } from "./nav.js";
import { reportCsv, reportMarkdown, type ReportInput } from "./report-export.js";

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
    // Consolidado multi-empresa (la "primaria" = this.host.state/host.settings
    // es la única que aporta a los bloques que dependen de settings, en concreto
    // los huecos de correlativo: revisan la serie del settings tabulado).
    const states = [...this.host.statesByCompany.values()];
    const multi = states.length > 1;
    contentEl.empty();
    contentEl.addClass("octa");

    const bar = moduleHeader(contentEl, "Reportes", this.host, this.app, this.leaf, REPORTS_VIEW_TYPE);
    const nav = bar.createDiv({ cls: "octa-period" });
    nav.createEl("button", { text: "◀" }).onclick = () => this.shiftMonth(-1);
    nav.createSpan({ text: this.month, cls: "octa-mono" });
    nav.createEl("button", { text: "▶" }).onclick = () => this.shiftMonth(1);
    nav.createSpan({ text: "|", cls: "octa-mono" });
    nav.createEl("button", { text: "MD", title: "Exportar reporte Markdown (imprimible a PDF desde Obsidian)" }).onclick = () =>
      void this.exportReport("md");
    nav.createEl("button", { text: "CSV", title: "Exportar tablas a CSV para hoja de cálculo" }).onclick = () =>
      void this.exportReport("csv");

    const facturado = consolidatedTotalInvoiced(states, this.month, currency);
    const gastos = consolidatedTotalExpenses(states, this.month, currency);
    const porCobrar = consolidatedUnpaid(states, this.month, currency);
    const descuentos = consolidatedDiscountSummary(states, this.month, currency);

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

    if (multi) {
      const note = contentEl.createDiv({ cls: "octa-footnote" });
      note.setText(`Consolidando ${states.length} empresas: ${this.host.activeCompanyIds.map(companyLabel).join(", ")}`);
    }

    // Tendencia: doce meses de facturado contra gastos
    const money = (minor: number) => format({ minor, currency }, locale);
    const series = consolidatedMonthlySeries(states, this.month, 12, currency);
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
    const days = consolidatedDailyExpenses(states, this.month, currency);
    const gastoEnElMes = days.some((d) => d.amount.minor > 0);
    this.block(contentEl, "Gasto por día", gastoEnElMes ? null : "Sin gastos en el período.", (body) => {
      monthHeatmap(body, days.map((d) => ({ date: d.date, value: d.amount.minor })), money);
    });

    // Gasto por categoría (agrupado por CODE: el id de categoría es local a
    // cada partición, el code del catálogo semántico es compartido).
    const byCategory = consolidatedExpensesByCategory(states, this.month, currency);
    this.block(contentEl, "Gasto por categoría", byCategory.length === 0 ? "Sin gastos en el período." : null, (body) => {
      const table = body.createEl("table", { cls: "octa-table" });
      const tbody = table.createEl("tbody");
      for (const cat of byCategory) {
        const row = tbody.createEl("tr");
        row.createEl("td", { text: cat.name });
        row.createEl("td", { text: format(cat.amount, locale), cls: "octa-num" });
        this.bar(row.createEl("td", { cls: "octa-bar-cell" }), cat.amount.minor / (byCategory[0]?.amount.minor || 1));
      }
    });

    // Formas de pago
    const mix = consolidatedPaymentMix(states, this.month, currency);
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

    // Clientes (reagrupa por NIT: un mismo cliente que compra en dos empresas
    // es UN cliente identificado, no se duplican contando por empresa).
    const customers = consolidatedCustomerMetrics(states, this.month, currency);
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

    // Huecos del correlativo: la serie vive en settings (única), así que la
    // revisión se hace sobre la empresa primaria. Con multi se avisa el alcance.
    const gaps = seriesGaps(state, settings.invoiceSeries);
    if (gaps.length > 0) {
      const warn = contentEl.createDiv({ cls: "octa-warning" });
      warn.createEl("strong", { text: "Huecos en el correlativo" });
      const across = multi
        ? ` de la serie ${settings.invoiceSeries}, revisada sobre la empresa primaria (${companyLabel(this.host.activeCompanyIds[0] ?? DEFAULT_COMPANY_ID)})`
        : ` de la serie ${settings.invoiceSeries}`;
      warn.createEl("p", {
        text: `Faltan los números ${gaps.join(", ")}${across}. Casi siempre significa un evento rechazado al reconciliar dos dispositivos.`,
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

  /**
   * Export offline (B-04): misma consolidación que render(), serializada a
   * Markdown o CSV y escrita al vault en {dataFolder}/reports/. Reutiliza el
   * patrón del repo (vault.create para nuevo, vault.modify si ya existe) para
   * no duplicar pestañas del mismo mes y que Obsidian indexe el archivo.
   */
  private async exportReport(kind: "md" | "csv"): Promise<void> {
    const { state, settings } = this.host;
    const currency = settings.currency;
    const locale = settings.locale;
    const states = [...this.host.statesByCompany.values()];
    const formatMoney = (minor: number) => format({ minor, currency }, locale);

    const facturado = consolidatedTotalInvoiced(states, this.month, currency);
    const gastos = consolidatedTotalExpenses(states, this.month, currency);
    const porCobrar = consolidatedUnpaid(states, this.month, currency);
    const descuentos = consolidatedDiscountSummary(states, this.month, currency);
    const mix = consolidatedPaymentMix(states, this.month, currency);
    const customers = consolidatedCustomerMetrics(states, this.month, currency);
    const gaps = seriesGaps(state, settings.invoiceSeries);

    const input: ReportInput = {
      month: this.month,
      currency,
      locale,
      companies: this.host.activeCompanyIds.map(companyLabel),
      kpis: [
        { label: "Facturado", value: format(facturado, locale) },
        { label: "Gastos", value: format(gastos, locale) },
        {
          label: "Diferencia",
          value: format({ minor: facturado.minor - gastos.minor, currency }, locale),
        },
        { label: "Por cobrar", value: format(porCobrar.amount, locale), hint: `${porCobrar.count} factura(s)` },
        {
          label: "Descuentos",
          value: descuentos.documents === 0 ? "—" : format(descuentos.total, locale),
          hint: descuentos.documents === 0 ? "sin descuentos en el período" : `${descuentos.documents} factura(s)`,
        },
      ],
      trend: consolidatedMonthlySeries(states, this.month, 12, currency).map((p) => ({
        line: p.month,
        invoiced: format(p.invoiced, locale),
        expenses: format(p.expenses, locale),
      })),
      byCategory: consolidatedExpensesByCategory(states, this.month, currency).map((c) => ({
        name: c.name,
        amount: format(c.amount, locale),
      })),
      paymentMix: mix.slices.map((s) => ({
        method: s.method,
        amount: format(s.amount, locale),
        sharePct: `${Math.round(s.share * 100)}%`,
      })),
      customers: {
        tickets: String(customers.tickets),
        identified: String(customers.identified),
        returning: customers.returningRate === null ? "—" : `${Math.round(customers.returningRate * 100)}%`,
        avgTicket: format(customers.avgTicket, locale),
      },
      daily: consolidatedDailyExpenses(states, this.month, currency).map((d) => ({
        date: d.date,
        amount: format(d.amount, locale),
      })),
      gaps,
    };

    const content = kind === "md" ? reportMarkdown(input) : reportCsv(input);
    const folder = `${settings.dataFolder}/reports`;
    const path = `${folder}/${kind === "md" ? `reporte-${this.month}.md` : `tablas-${this.month}.csv`}`;

    try {
      await this.app.vault.createFolder(folder);
    } catch {
      // Ya existe: la carpeta de reportes es reutilizable.
    }
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
    new Notice(`Reporte exportado a ${path}`, 5000);
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}
