import {
  EXPENSE_TRANSITIONS,
  expensesInMonth,
  format,
  monthKeyOf,
  toIsoDate,
  totalExpenses,
  type Expense,
  type ExpenseStatus,
} from "@octasuite/core";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { EXPENSES_VIEW_TYPE } from "../modules.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";

const STATUS_LABEL: Record<ExpenseStatus, string> = {
  draft: "Borrador",
  submitted: "Enviado",
  approved: "Aprobado",
  rejected: "Rechazado",
  paid: "Pagado",
};

/** Verbo de la acción que lleva a cada estado, desde el punto de vista del operador. */
const ACTION_LABEL: Record<ExpenseStatus, string> = {
  draft: "Volver a borrador",
  submitted: "Enviar",
  approved: "Aprobar",
  rejected: "Rechazar",
  paid: "Marcar pagado",
};

export class ExpensesView extends ItemView {
  private month = monthKeyOf(toIsoDate(new Date()));

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return EXPENSES_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Gastos";
  }

  override getIcon(): string {
    return "receipt";
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
    contentEl.empty();
    contentEl.addClass("octa");

    const bar = moduleHeader(contentEl, "Gastos", this.host, this.app, this.leaf, EXPENSES_VIEW_TYPE);
    const nav = bar.createDiv({ cls: "octa-period" });
    nav.createEl("button", { text: "◀" }).onclick = () => this.shiftMonth(-1);
    nav.createSpan({ text: this.month, cls: "octa-mono" });
    nav.createEl("button", { text: "▶" }).onclick = () => this.shiftMonth(1);
    nav.createEl("button", { text: "+ Gasto", cls: "mod-cta" }).onclick = () => this.host.openQuickAdd();

    const expenses = expensesInMonth(state, this.month);
    const total = totalExpenses(state, this.month, settings.currency);

    const kpis = contentEl.createDiv({ cls: "octa-kpis" });
    const tile = kpis.createDiv({ cls: "octa-kpi" });
    tile.createDiv({ cls: "octa-kpi-label", text: "Total del período" });
    tile.createDiv({ cls: "octa-kpi-value", text: format(total, settings.locale) });
    tile.createDiv({ cls: "octa-kpi-hint", text: "los rechazados no suman" });

    if (expenses.length === 0) {
      contentEl.createEl("p", { text: "Sin movimientos en este período.", cls: "octa-empty" });
      return;
    }

    const wrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Fecha", "Concepto", "Categoría", "Estado", "Monto", ""]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const expense of expenses) this.row(tbody, expense);
  }

  private row(tbody: HTMLElement, expense: Expense): void {
    const { state, settings } = this.host;
    const row = tbody.createEl("tr");
    if (expense.status === "rejected") row.addClass("is-muted");

    row.createEl("td", { text: expense.date, cls: "octa-mono" });
    row.createEl("td", { text: expense.name });
    row.createEl("td", {
      text: expense.categoryId ? (state.categories.get(expense.categoryId)?.name ?? "—") : "—",
    });
    row.createEl("td").createSpan({
      cls: `octa-chip is-status-${expense.status}`,
      text: STATUS_LABEL[expense.status],
    });
    row.createEl("td", { text: format(expense.amount, settings.locale), cls: "octa-num" });

    // Las acciones se derivan de la matriz de transiciones del dominio: la vista
    // no conoce el flujo, solo lo consulta.
    const actions = row.createEl("td", { cls: "octa-actions" });
    for (const next of EXPENSE_TRANSITIONS[expense.status]) {
      const button = actions.createEl("button", { text: ACTION_LABEL[next] });
      button.onclick = () => void this.transition(expense, next);
    }
  }

  private async transition(expense: Expense, to: ExpenseStatus): Promise<void> {
    const ok = await this.host.commit(
      this.host.newEvent("expense.transitioned", { expenseId: expense.id, to }),
    );
    if (ok) new Notice(`${expense.name}: ${STATUS_LABEL[to].toLowerCase()}`);
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
