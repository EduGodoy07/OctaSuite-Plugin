import {
  ACCOUNT_TYPE_LABEL,
  LEDGER_ACCOUNT_TYPES,
  activeAccounts,
  accountsByType,
  accountBalance,
  computeTrialBalance,
  entriesOnDate,
  format,
  generateId,
  isBalanced,
  monthKeyOf,
  postedEntries,
  project,
  type Account,
  type LedgerAccountType,
  type JournalEntry,
  type JournalLine,
  type Money,
} from "@octasuite/core";
import { App, ItemView, Modal, Notice, type WorkspaceLeaf } from "obsidian";
import { ACCOUNTING_VIEW_TYPE } from "../modules.js";
import { companyLabel } from "./company-switcher.js";
import { moduleHeader } from "./nav.js";
import type { PluginHost } from "./host.js";

type Tab = "chart" | "journal" | "trial";

export class AccountingView extends ItemView {
  private tab: Tab = "chart";
  private journalMonth: string = monthKeyOf(new Date().toISOString().slice(0, 10));

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string { return ACCOUNTING_VIEW_TYPE; }
  override getDisplayText(): string { return "Contabilidad"; }
  override getIcon(): string { return "book-keeping"; }

  override async onOpen(): Promise<void> {
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("octa");
    this.contentEl.addClass("octa-accounting");

    const top = this.contentEl.createDiv();
    moduleHeader(top, "Contabilidad", this.host, this.app, this.leaf, ACCOUNTING_VIEW_TYPE);

    // La contabilidad todavía NO consolida multi-empresa: los asientos, el plan
    // de cuentas y el balance son de la empresa primaria. Avisar para que un
    // usuario con varias empresas no crea que el balance es del grupo.
    if (this.host.activeCompanyIds.length > 1) {
      const primary = this.host.activeCompanyIds[0];
      const banner = top.createDiv({ cls: "octa-warning" });
      banner.createEl("strong", { text: "Contabilidad consolidada en desarrollo" });
      banner.createEl("p", {
        text: primary
          ? `Esta pantalla trabaja solo sobre la empresa primaria (${companyLabel(primary)}). La consolidación de asientos y balance para el grupo está pendiente; los demás módulos ya consolidan en Inicio y Reportes.`
          : "Esta pantalla trabaja solo sobre la empresa primaria. La consolidación de asientos y balance para el grupo está pendiente.",
      });
    }

    // Tab bar
    const tabBar = top.createDiv({ cls: "octa-period" });
    this.tabBtn(tabBar, "Plan de Cuentas", "chart");
    this.tabBtn(tabBar, "Asientos", "journal");
    this.tabBtn(tabBar, "Balance", "trial");

    switch (this.tab) {
      case "chart": this.renderChartOfAccounts(); break;
      case "journal": this.renderJournal(); break;
      case "trial": this.renderTrialBalance(); break;
    }
  }

  private tabBtn(parent: HTMLElement, label: string, key: Tab): void {
    const btn = parent.createEl("button", {
      text: label,
      cls: this.tab === key ? "mod-cta" : "",
    });
    btn.onclick = () => {
      this.tab = key;
      this.render();
    };
  }

  // ── Tab 1: Plan de Cuentas ────────────────────────────────────────

  private renderChartOfAccounts(): void {
    const el = this.contentEl;
    const state = this.host.state;

    // Tools row
    const tools = el.createDiv({ cls: "octa-period" });
    tools.createEl("button", { text: "+ Cuenta", cls: "mod-cta" }).onclick = () => this.createAccount();

    // KPIs
    const accounts = activeAccounts(state);
    const kpis = el.createDiv({ cls: "octa-kpi-row" });
    this.kpi(kpis, "Cuentas activas", String(accounts.length));
    for (const type of LEDGER_ACCOUNT_TYPES) {
      const count = accountsByType(state, type).length;
      if (count > 0) this.kpi(kpis, ACCOUNT_TYPE_LABEL[type], String(count));
    }

    if (accounts.length === 0) {
      el.createDiv({ cls: "octa-empty", text: "No hay cuentas. Creá el plan de cuentas para empezar a registrar asientos." });
      return;
    }

    // Table grouped by type
    const tableWrap = el.createDiv({ cls: "octa-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "octa-table" });
    const thead = table.createEl("thead");
    thead.createEl("th", { text: "Código" });
    thead.createEl("th", { text: "Nombre" });
    thead.createEl("th", { text: "Tipo" });
    thead.createEl("th", { text: "Saldo" });

    const tbody = table.createEl("tbody");
    for (const acc of accounts) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: acc.code, cls: "octa-mono" });
      tr.createEl("td", { text: acc.name });
      const typeCell = tr.createEl("td");
      const badge = typeCell.createSpan({ cls: "octa-type-badge" });
      badge.textContent = ACCOUNT_TYPE_LABEL[acc.type];
      badge.addClass(`octa-type-${acc.type}`);

      const balance = accountBalance(state, acc.id, "GTQ");
      const balCell = tr.createEl("td", { cls: "octa-mono" });
      balCell.textContent = format(balance, "es-GT");

      // Context menu
      tr.oncontextmenu = (e: MouseEvent) => {
        e.preventDefault();
        const { Menu } = require("obsidian") as typeof import("obsidian");
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle("Editar").setIcon("pencil").onClick(() => this.editAccount(acc));
        });
        menu.addItem((item) => {
          item.setTitle(acc.archived ? "Restaurar" : "Archivar").setIcon("archive").onClick(() => {
            if (acc.archived) {
              this.host.commit(this.host.newEvent("accounting.account_restored", { accountId: acc.id }));
            } else {
              this.host.commit(this.host.newEvent("accounting.account_archived", { accountId: acc.id }));
            }
            this.render();
          });
        });
        menu.showAtMouseEvent(e);
      };
    }
  }

  private createAccount(): void {
    new AccountModal(this.app, this.host, null, () => this.render()).open();
  }

  private editAccount(account: Account): void {
    new AccountModal(this.app, this.host, account, () => this.render()).open();
  }

  // ── Tab 2: Asientos Contables ─────────────────────────────────────

  private renderJournal(): void {
    const el = this.contentEl;
    const state = this.host.state;

    // Month picker
    const tools = el.createDiv({ cls: "octa-period" });
    const prev = tools.createEl("button", { text: "←" });
    prev.onclick = () => {
      const [y, m] = this.journalMonth.split("-").map(Number);
      const d = new Date(y!, m! - 1, 1);
      d.setMonth(d.getMonth() - 1);
      this.journalMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      this.render();
    };
    tools.createEl("span", { text: this.journalMonth, cls: "octa-month-label" });
    const next = tools.createEl("button", { text: "→" });
    next.onclick = () => {
      const [y, m] = this.journalMonth.split("-").map(Number);
      const d = new Date(y!, m! - 1, 1);
      d.setMonth(d.getMonth() + 1);
      this.journalMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      this.render();
    };
    tools.createEl("button", { text: "+ Asiento", cls: "mod-cta" }).onclick = () => this.createEntry();

    // KPIs
    const entries = postedEntries(state);
    const kpis = el.createDiv({ cls: "octa-kpi-row" });
    this.kpi(kpis, "Asientos (total)", String(entries.length));
    const monthEntries = entries.filter((e) => monthKeyOf(e.date) === this.journalMonth);
    this.kpi(kpis, `Asientos (${this.journalMonth})`, String(monthEntries.length));

    if (entries.length === 0) {
      el.createDiv({ cls: "octa-empty", text: "No hay asientos. Registrá el primer asiento contable para empezar." });
      return;
    }

    // Table
    const tableWrap = el.createDiv({ cls: "octa-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "octa-table" });
    const thead = table.createEl("thead");
    thead.createEl("th", { text: "Fecha" });
    thead.createEl("th", { text: "Descripción" });
    thead.createEl("th", { text: "Líneas" });
    thead.createEl("th", { text: "Débitos" });
    thead.createEl("th", { text: "Créditos" });
    thead.createEl("th", { text: "Estado" });

    const tbody = table.createEl("tbody");
    for (const entry of entries) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: entry.date, cls: "octa-mono" });
      tr.createEl("td", { text: entry.description });
      tr.createEl("td", { text: String(entry.lines.length), cls: "octa-mono" });

      let totalDr = 0;
      let totalCr = 0;
      for (const line of entry.lines) {
        totalDr += line.debit.minor;
        totalCr += line.credit.minor;
      }
      tr.createEl("td", { text: format({ minor: totalDr, currency: "GTQ" }, "es-GT"), cls: "octa-mono" });
      tr.createEl("td", { text: format({ minor: totalCr, currency: "GTQ" }, "es-GT"), cls: "octa-mono" });

      const statusCell = tr.createEl("td");
      const statusBadge = statusCell.createSpan({ cls: `octa-status octa-status-${entry.status}` });
      statusBadge.textContent = entry.status === "posted" ? "Publicado" : entry.status === "voided" ? "Anulado" : "Borrador";

      // Context menu
      tr.oncontextmenu = (e: MouseEvent) => {
        e.preventDefault();
        if (entry.status !== "posted") return;
        const { Menu } = require("obsidian") as typeof import("obsidian");
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle("Anular").setIcon("x-circle").onClick(() => {
            this.host.commit(this.host.newEvent("accounting.entry_voided", {
              entryId: entry.id,
              reason: "Anulado desde la vista de asientos",
            }));
            this.render();
          });
        });
        menu.showAtMouseEvent(e);
      };
    }
  }

  private createEntry(): void {
    new JournalEntryModal(this.app, this.host, () => this.render()).open();
  }

  // ── Tab 3: Balance de Comprobación ────────────────────────────────

  private renderTrialBalance(): void {
    const el = this.contentEl;
    const state = this.host.state;

    const tools = el.createDiv({ cls: "octa-period" });
    tools.createEl("span", { text: `Al ${new Date().toISOString().slice(0, 10)}`, cls: "octa-month-label" });

    const accounts = activeAccounts(state);
    const entries = postedEntries(state);
    const today = new Date().toISOString().slice(0, 10);
    const tb = computeTrialBalance(accounts, entries, today, "GTQ");

    if (tb.lines.length === 0) {
      el.createDiv({ cls: "octa-empty", text: "No hay movimientos registrados. Publicá asientos contables para generar el balance." });
      return;
    }

    // Balance indicator
    const indicator = el.createDiv({ cls: `octa-balance-indicator ${tb.balanced ? "octa-balanced" : "octa-unbalanced"}` });
    indicator.textContent = tb.balanced
      ? "Balance cuadrado ✓"
      : "⚠ Balance descuadrado — los débitos no igualan a los créditos";

    // Table
    const tableWrap = el.createDiv({ cls: "octa-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "octa-table octa-table-trial" });
    const thead = table.createEl("thead");
    thead.createEl("th", { text: "Código" });
    thead.createEl("th", { text: "Cuenta" });
    thead.createEl("th", { text: "Tipo" });
    thead.createEl("th", { text: "Débitos" });
    thead.createEl("th", { text: "Créditos" });
    thead.createEl("th", { text: "Saldo" });

    const tbody = table.createEl("tbody");
    for (const line of tb.lines) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: line.accountCode, cls: "octa-mono" });
      tr.createEl("td", { text: line.accountName });
      const typeCell = tr.createEl("td");
      const badge = typeCell.createSpan({ cls: "octa-type-badge" });
      badge.textContent = ACCOUNT_TYPE_LABEL[line.accountType];
      badge.addClass(`octa-type-${line.accountType}`);

      tr.createEl("td", { text: format(line.debit, "es-GT"), cls: "octa-mono" });
      tr.createEl("td", { text: format(line.credit, "es-GT"), cls: "octa-mono" });
      tr.createEl("td", { text: format(line.balance, "es-GT"), cls: "octa-mono octa-bold" });
    }

    // Totals
    const tfoot = table.createEl("tfoot");
    const totalRow = tfoot.createEl("tr");
    totalRow.createEl("td", { text: "" });
    totalRow.createEl("td", { text: "TOTALES", cls: "octa-bold" });
    totalRow.createEl("td", { text: "" });
    totalRow.createEl("td", { text: format(tb.totalDebits, "es-GT"), cls: "octa-mono octa-bold" });
    totalRow.createEl("td", { text: format(tb.totalCredits, "es-GT"), cls: "octa-mono octa-bold" });
    totalRow.createEl("td", { text: "" });
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private kpi(parent: HTMLElement, label: string, value: string): void {
    const card = parent.createDiv({ cls: "octa-kpi" });
    card.createDiv({ cls: "octa-kpi-value", text: value });
    card.createDiv({ cls: "octa-kpi-label", text: label });
  }
}

// ════════════════════════════════════════════════════════════════════
// Modals
// ════════════════════════════════════════════════════════════════════

class AccountModal extends Modal {
  private code = "";
  private name = "";
  private type: LedgerAccountType = "activo";
  private notes = "";
  private isEdit = false;
  private accountId = "";

  constructor(
    app: App,
    private readonly host: PluginHost,
    private readonly account: Account | null,
    private readonly onDone: () => void,
  ) {
    super(app);
    if (account) {
      this.isEdit = true;
      this.accountId = account.id;
      this.code = account.code;
      this.name = account.name;
      this.type = account.type;
      this.notes = account.notes ?? "";
    }
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: this.isEdit ? "Editar Cuenta" : "Nueva Cuenta" });

    // Code
    const codeField = contentEl.createDiv({ cls: "octa-field" });
    codeField.createEl("label", { text: "Código" });
    const codeInput = codeField.createEl("input", { type: "text", value: this.code });
    codeInput.placeholder = "1100";
    codeInput.oninput = () => { this.code = codeInput.value; };

    // Name
    const nameField = contentEl.createDiv({ cls: "octa-field" });
    nameField.createEl("label", { text: "Nombre" });
    const nameInput = nameField.createEl("input", { type: "text", value: this.name });
    nameInput.placeholder = "Caja";
    nameInput.oninput = () => { this.name = nameInput.value; };

    // Type
    const typeField = contentEl.createDiv({ cls: "octa-field" });
    typeField.createEl("label", { text: "Tipo" });
    const typeSelect = typeField.createEl("select");
    for (const t of LEDGER_ACCOUNT_TYPES) {
      const opt = typeSelect.createEl("option", { text: ACCOUNT_TYPE_LABEL[t], value: t });
      if (t === this.type) opt.selected = true;
    }
    typeSelect.onchange = () => { this.type = typeSelect.value as LedgerAccountType; };

    // Notes
    const notesField = contentEl.createDiv({ cls: "octa-field" });
    notesField.createEl("label", { text: "Notas" });
    const notesInput = notesField.createEl("textarea", { text: this.notes });
    notesInput.rows = 3;
    notesInput.oninput = () => { this.notes = notesInput.value; };

    // Actions
    const actions = contentEl.createDiv({ cls: "octa-actions" });
    actions.createEl("button", { text: "Cancelar" }).onclick = () => this.close();
    actions.createEl("button", { text: this.isEdit ? "Guardar" : "Crear", cls: "mod-cta" }).onclick = () => this.save();
  }

  private save(): void {
    if (!this.code.trim() || !this.name.trim()) {
      new Notice("Código y nombre son requeridos");
      return;
    }
    if (this.isEdit) {
      this.host.commit(this.host.newEvent("accounting.account_updated", {
        accountId: this.accountId,
        changes: { code: this.code.trim(), name: this.name.trim(), type: this.type, notes: this.notes || undefined },
      }));
    } else {
      this.host.commit(this.host.newEvent("accounting.account_created", {
        accountId: generateId("acc"),
        code: this.code.trim(),
        name: this.name.trim(),
        type: this.type,
        notes: this.notes || undefined,
      }));
    }
    this.onDone();
    this.close();
  }
}

class JournalEntryModal extends Modal {
  private date = new Date().toISOString().slice(0, 10);
  private description = "";
  private reference = "";
  private lines: { accountId: string; debit: string; credit: string }[] = [
    { accountId: "", debit: "", credit: "" },
    { accountId: "", debit: "", credit: "" },
  ];

  constructor(
    app: App,
    private readonly host: PluginHost,
    private readonly onDone: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: "Nuevo Asiento Contable" });

    // Date
    const dateField = contentEl.createDiv({ cls: "octa-field" });
    dateField.createEl("label", { text: "Fecha" });
    const dateInput = dateField.createEl("input", { type: "date", value: this.date });
    dateInput.oninput = () => { this.date = dateInput.value; };

    // Description
    const descField = contentEl.createDiv({ cls: "octa-field" });
    descField.createEl("label", { text: "Descripción" });
    const descInput = descField.createEl("input", { type: "text", value: this.description });
    descInput.placeholder = "Venta de contado";
    descInput.oninput = () => { this.description = descInput.value; };

    // Reference
    const refField = contentEl.createDiv({ cls: "octa-field" });
    refField.createEl("label", { text: "Referencia (opcional)" });
    const refInput = refField.createEl("input", { type: "text", value: this.reference });
    refInput.placeholder = "Factura #123";
    refInput.oninput = () => { this.reference = refInput.value; };

    // Lines
    const linesEl = contentEl.createDiv({ cls: "octa-journal-lines" });
    linesEl.createEl("h4", { text: "Líneas del asiento" });

    const table = linesEl.createEl("table", { cls: "octa-table" });
    const thead = table.createEl("thead");
    thead.createEl("th", { text: "Cuenta" });
    thead.createEl("th", { text: "Débito" });
    thead.createEl("th", { text: "Crédito" });
    thead.createEl("th", { text: "" });

    const tbody = table.createEl("tbody");
    for (let i = 0; i < this.lines.length; i++) {
      this.renderLineRow(tbody, i);
    }

    // Add line
    linesEl.createEl("button", { text: "+ Línea", cls: "mod-cta" }).onclick = () => {
      this.lines.push({ accountId: "", debit: "", credit: "" });
      this.rerender();
    };

    // Summary
    this.renderSummary(contentEl);

    // Actions
    const actions = contentEl.createDiv({ cls: "octa-actions" });
    actions.createEl("button", { text: "Cancelar" }).onclick = () => this.close();
    actions.createEl("button", { text: "Publicar", cls: "mod-cta" }).onclick = () => this.save();
  }

  private renderLineRow(tbody: HTMLElement, idx: number): void {
    const tr = tbody.createEl("tr");
    const state = this.host.state;
    const accounts = activeAccounts(state);

    const tdAcc = tr.createEl("td");
    const sel = tdAcc.createEl("select");
    sel.createEl("option", { text: "— Seleccionar —", value: "" });
    for (const acc of accounts) {
      const opt = sel.createEl("option", {
        text: `${acc.code} — ${acc.name}`,
        value: acc.id,
      });
      if (this.lines[idx]!.accountId === acc.id) opt.selected = true;
    }
    sel.onchange = () => { this.lines[idx]!.accountId = sel.value; };

    const tdDr = tr.createEl("td");
    const drInput = tdDr.createEl("input", {
      type: "number",
      value: this.lines[idx]!.debit,
      placeholder: "0",
    });
    drInput.oninput = () => { this.lines[idx]!.debit = drInput.value; };

    const tdCr = tr.createEl("td");
    const crInput = tdCr.createEl("input", {
      type: "number",
      value: this.lines[idx]!.credit,
      placeholder: "0",
    });
    crInput.oninput = () => { this.lines[idx]!.credit = crInput.value; };

    const tdDel = tr.createEl("td");
    if (this.lines.length > 2) {
      tdDel.createEl("button", { text: "×", cls: "octa-icon-btn" }).onclick = () => {
        this.lines.splice(idx, 1);
        this.rerender();
      };
    }
  }

  private rerender(): void {
    this.contentEl.empty();
    this.onOpen();
  }

  private renderSummary(parent: HTMLElement): void {
    let totalDr = 0;
    let totalCr = 0;
    for (const line of this.lines) {
      totalDr += Number(line.debit) || 0;
      totalCr += Number(line.credit) || 0;
    }

    const summary = parent.createDiv({ cls: "octa-journal-summary" });
    summary.createSpan({ text: `Débitos: Q${totalDr.toLocaleString("es-GT")}` });
    summary.createSpan({ text: `Créditos: Q${totalCr.toLocaleString("es-GT")}` });
    const diff = Math.abs(totalDr - totalCr);
    if (diff === 0 && (totalDr > 0 || totalCr > 0)) {
      summary.createSpan({ cls: "octa-balanced", text: "✓ Cuadrado" });
    } else if (totalDr > 0 || totalCr > 0) {
      summary.createSpan({ cls: "octa-unbalanced", text: `⚠ Diferencia: Q${diff.toLocaleString("es-GT")}` });
    }
  }

  private save(): void {
    if (!this.description.trim()) {
      new Notice("La descripción es requerida");
      return;
    }

    const lines: JournalLine[] = [];
    for (const raw of this.lines) {
      const dr = Number(raw.debit) || 0;
      const cr = Number(raw.credit) || 0;
      if (dr === 0 && cr === 0) continue;
      if (!raw.accountId) {
        new Notice("Seleccioná una cuenta para cada línea con monto");
        return;
      }
      lines.push({
        accountId: raw.accountId,
        debit: { minor: Math.round(dr * 100), currency: "GTQ" },
        credit: { minor: Math.round(cr * 100), currency: "GTQ" },
      });
    }

    if (lines.length < 2) {
      new Notice("Un asiento requiere al menos 2 líneas");
      return;
    }

    if (!isBalanced({ date: this.date, description: this.description, lines }, "GTQ")) {
      new Notice("El asiento no está cuadrado — débitos ≠ créditos");
      return;
    }

    this.host.commit(this.host.newEvent("accounting.entry_posted", {
      entryId: generateId("je"),
      date: this.date,
      description: this.description.trim(),
      reference: this.reference.trim() || undefined,
      lines,
    }));

    this.onDone();
    this.close();
  }
}
