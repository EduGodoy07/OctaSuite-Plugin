import {
  expensesVsPreviousWeekday,
  format,
  monthKeyOf,
  pendingApprovalCount,
  toIsoDate,
  totalExpenses,
  totalInvoiced,
  unpaidInvoices,
  type Comparison,
  type AnyEvent,
} from "@octasuite/core";
import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import { LAUNCHER_VIEW_TYPE, MODULES, moduleGroups, modulesIn, STATUS_LABEL, type ModuleDef } from "../modules.js";
import type { PluginHost } from "./host.js";

/**
 * Pantalla de inicio: indicadores del período arriba, mapa de módulos abajo.
 * Es la forma de la pantalla de aplicaciones de Odoo.
 */
export class LauncherView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return LAUNCHER_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "OctaSuite";
  }

  override getIcon(): string {
    return "layout-grid";
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
    const today = toIsoDate(new Date());
    const month = monthKeyOf(today);

    contentEl.empty();
    contentEl.addClass("octa");

    const header = contentEl.createDiv({ cls: "octa-topbar" });
    header.createEl("h2", { text: "OctaSuite", cls: "octa-brand" });
    const period = header.createDiv({ cls: "octa-period" });
    period.createSpan({ text: month, cls: "octa-mono" });
    const addExpense = period.createEl("button", { text: "+ Gasto", cls: "mod-cta" });
    addExpense.onclick = () => this.host.openQuickAdd();

    // --- Indicadores ---
    const facturado = totalInvoiced(state, month, currency);
    const gastos = totalExpenses(state, month, currency);
    const porCobrar = unpaidInvoices(state, month, currency);
    const hoy = expensesVsPreviousWeekday(state, today, currency);
    const pendientes = pendingApprovalCount(state);

    const kpis = contentEl.createDiv({ cls: "octa-kpis" });
    this.kpi(kpis, "Facturado", format(facturado, settings.locale));
    this.kpi(kpis, "Gastos", format(gastos, settings.locale));
    this.kpi(kpis, "Diferencia", format({ minor: facturado.minor - gastos.minor, currency }, settings.locale));
    this.kpi(kpis, "Por cobrar", format(porCobrar.amount, settings.locale), `${porCobrar.count} factura(s)`);
    this.kpiComparison(kpis, hoy, settings.locale);
    this.kpi(kpis, "Por aprobar", String(pendientes), pendientes === 1 ? "gasto" : "gastos");

    const problems: string[] = [];
    if (this.host.rejectedCount > 0) {
      problems.push(`${this.host.rejectedCount} evento(s) rechazado(s) al reconstruir el estado:`);
      for (const r of this.host.lastRejections) problems.push(`${describeEvent(r.event)} — ${r.reason}`);
    }
    if (this.host.corruptCount > 0) {
      problems.push(`${this.host.corruptCount} línea(s) ilegible(s) en el journal:`);
      for (const c of this.host.lastCorrupt) problems.push(`línea ${c.line}: ${snippet(c.text)} — ${c.reason}`);
    }
    if (problems.length > 0) {
      const warn = contentEl.createDiv({ cls: "octa-warning" });
      warn.createEl("strong", { text: "Requiere atención" });
      const list = warn.createEl("ul");
      for (const p of problems) list.createEl("li", { text: p });
    }

    // --- Módulos ---
    for (const group of moduleGroups()) {
      contentEl.createEl("h3", { text: group, cls: "octa-group" });
      const grid = contentEl.createDiv({ cls: "octa-grid" });
      for (const mod of modulesIn(group)) this.tile(grid, mod);
    }

    const footer = contentEl.createDiv({ cls: "octa-footnote" });
    const ready = MODULES.filter((m) => m.status === "ready").length;
    footer.setText(`${ready} de ${MODULES.length} módulos disponibles en modo Personal.`);
  }

  private kpi(parent: HTMLElement, label: string, value: string, hint?: string): void {
    const tile = parent.createDiv({ cls: "octa-kpi" });
    tile.createDiv({ cls: "octa-kpi-label", text: label });
    tile.createDiv({ cls: "octa-kpi-value", text: value });
    if (hint) tile.createDiv({ cls: "octa-kpi-hint", text: hint });
  }

  /**
   * Gasto de hoy contra el mismo día de la semana pasada. Comparar contra ayer
   * engaña en cualquier negocio con ritmo semanal.
   */
  private kpiComparison(parent: HTMLElement, cmp: Comparison, locale: string): void {
    const tile = parent.createDiv({ cls: "octa-kpi" });
    tile.createDiv({ cls: "octa-kpi-label", text: "Gasto de hoy" });
    tile.createDiv({ cls: "octa-kpi-value", text: format(cmp.current, locale) });
    if (cmp.deltaPercent === null) {
      tile.createDiv({ cls: "octa-kpi-hint", text: "sin dato la semana pasada" });
      return;
    }
    const rounded = Math.round(cmp.deltaPercent);
    const sign = rounded > 0 ? "+" : "";
    const cls = rounded > 0 ? "octa-kpi-hint is-up" : rounded < 0 ? "octa-kpi-hint is-down" : "octa-kpi-hint";
    tile.createDiv({ cls, text: `${sign}${rounded}% vs. mismo día la semana pasada` });
  }

  private tile(parent: HTMLElement, mod: ModuleDef): void {
    const tile = parent.createEl("button", { cls: `octa-tile is-${mod.status}` });
    tile.setAttribute("type", "button");

    const head = tile.createDiv({ cls: "octa-tile-head" });
    const iconEl = head.createSpan({ cls: "octa-tile-icon" });
    setIcon(iconEl, mod.icon);
    // Si Obsidian no conoce el icono, no dibuja nada: la inicial evita el hueco.
    if (iconEl.childElementCount === 0) iconEl.setText(mod.name.charAt(0));
    head.createSpan({ cls: "octa-tile-name", text: mod.name });

    tile.createDiv({ cls: "octa-tile-detail", text: mod.detail });

    // Un módulo que funciona no necesita etiqueta: se abre y ya. Etiquetar solo
    // lo que todavía no responde deja el estado donde importa y quita ruido.
    if (mod.status !== "ready") {
      tile.createDiv({ cls: "octa-tile-foot" }).createSpan({
        cls: `octa-chip is-${mod.status}`,
        text: STATUS_LABEL[mod.status],
      });
    }
    tile.onclick = () => this.host.openModule(mod);
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}

/** Nombre humano del evento para el aviso: tipo + nombre del payload si existe. */
function describeEvent(event: AnyEvent): string {
  const payload = event.payload as Record<string, unknown>;
  const name = payload && typeof payload.name === "string" ? payload.name : "";
  return name ? `${event.type} «${name}»` : event.type;
}

/** Recorte corto de una línea ilegible para no desbordar el aviso. */
function snippet(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
