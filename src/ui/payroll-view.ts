import {
  activeEmployees,
  computePayrollLine,
  computePayrollTotals,
  currentPayrollPolicy,
  format,
  fromDecimal,
  generateId,
  monthKeyOf,
  payrollRunsInMonth,
  toDecimalString,
  toIsoDate,
  validateEmployeeDraft,
  STANDARD_RESPONSIBILITIES,
  type ContractType,
  type Employee,
  type EmployeeDraft,
  type Money,
  type PayrollLine,
  type PayrollRun,
  type PayrollTotals,
} from "@octasuite/core";
import { App, ItemView, Modal, Notice, Setting, type WorkspaceLeaf } from "obsidian";
import { PAYROLL_VIEW_TYPE } from "../modules.js";
import { ConfirmModal } from "./confirm-modal.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";

const CONTRACT_LABEL: Record<ContractType, string> = {
  fijo: "Fijo",
  indefinido: "Indefinido",
  temporal: "Temporal",
};

type Tab = "employees" | "runs" | "orgchart";

const MONTH_RE = /^\d{4}-\d{2}$/;

export class PayrollView extends ItemView {
  private tab: Tab = "employees";
  private month: string = monthKeyOf(toIsoDate(new Date()));

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return PAYROLL_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Nómina";
  }

  override getIcon(): string {
    return "briefcase";
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("octa");

    const top = this.contentEl.createDiv();
    moduleHeader(top, "Nómina", this.host, this.app, this.leaf, PAYROLL_VIEW_TYPE);

    const tabBar = top.createDiv({ cls: "octa-period" });
    this.tabBtn(tabBar, "Empleados", "employees");
    this.tabBtn(tabBar, "Planilla", "runs");
    this.tabBtn(tabBar, "Organigrama", "orgchart");

    switch (this.tab) {
      case "employees":
        this.renderEmployees();
        break;
      case "runs":
        this.renderRuns();
        break;
      case "orgchart":
        this.renderOrgchart();
        break;
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

  private kpi(parent: HTMLElement, label: string, value: string): void {
    const box = parent.createDiv({ cls: "octa-kpi" });
    box.createDiv({ cls: "octa-kpi-value", text: value });
    box.createDiv({ cls: "octa-kpi-label", text: label });
  }

  // ── Tab 1: Empleados ───────────────────────────────────────────────

  private renderEmployees(): void {
    const el = this.contentEl;
    const state = this.host.state;
    const employees = activeEmployees(state);

    const tools = el.createDiv({ cls: "octa-period" });
    tools.createEl("button", { text: "+ Empleado", cls: "mod-cta" }).onclick = () => this.openEmployee();

    const kpis = el.createDiv({ cls: "octa-kpi-row" });
    this.kpi(kpis, "Empleados activos", String(employees.length));

    if (employees.length === 0) {
      el.createDiv({
        cls: "octa-empty",
        text: "No hay empleados. Agregá el primero para poder procesar la planilla del mes.",
      });
      return;
    }

    const wrap = el.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Nombre", "Puesto", "NIT/CUI", "Contrato", "Salario base", "Desde", ""]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const employee of employees) this.employeeRow(tbody, employee);
  }

  private employeeRow(tbody: HTMLElement, employee: Employee): void {
    const { settings } = this.host;
    const row = tbody.createEl("tr");

    const nameCell = row.createEl("td");
    nameCell.createSpan({ text: employee.name });
    if (employee.contractType) {
      nameCell.createDiv({
        cls: "octa-subtle",
        text: CONTRACT_LABEL[employee.contractType],
      });
    }

    row.createEl("td", { text: employee.position ?? "—" });
    row.createEl("td", { text: employee.taxId ?? "—", cls: "octa-mono" });
    row.createEl("td", {
      text: employee.contractType ? CONTRACT_LABEL[employee.contractType] : "—",
    });
    row.createEl("td", {
      text: format(employee.baseSalary, settings.locale),
      cls: "octa-num",
    });
    row.createEl("td", { text: employee.hireDate, cls: "octa-mono" });

    const actions = row.createEl("td", { cls: "octa-actions" });
    actions.createEl("button", { text: "Editar" }).onclick = () => this.openEmployee(employee);
    actions.createEl("button", { text: "Archivar" }).onclick = () =>
      this.confirmArchiveEmployee(employee);
  }

  private openEmployee(existing?: Employee): void {
    const { settings } = this.host;
    const managers = activeEmployees(this.host.state)
      .filter((m) => m.id !== existing?.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    new EmployeeModal(this.app, {
      ...(existing ? { existing } : {}),
      managers,
      currency: settings.currency,
      locale: settings.locale,
      onSubmit: async (draft) => {
        const ok = existing
          ? await this.host.commit(
              this.host.newEvent("payroll.employee_updated", {
                employeeId: existing.id,
                changes: draft,
              }),
            )
          : await this.host.commit(
              this.host.newEvent("payroll.employee_created", {
                employeeId: generateId("pay"),
                ...draft,
              }),
            );
        if (ok) new Notice(existing ? `${draft.name} actualizado` : `${draft.name} agregado`);
        return ok;
      },
    }).open();
  }

  private confirmArchiveEmployee(employee: Employee): void {
    new ConfirmModal(this.app, {
      title: "Archivar empleado",
      body: `${employee.name} deja de aparecer en la lista y en la próxima planilla. Las planillas ya procesadas no cambian.`,
      confirmText: "Archivar",
      destructive: true,
      onConfirm: async () => {
        const ok = await this.host.commit(
          this.host.newEvent("payroll.employee_archived", { employeeId: employee.id }),
        );
        if (ok) new Notice(`${employee.name} archivado`);
      },
    }).open();
  }

  // ── Tab 3: Organigrama ─────────────────────────────────────────────

  private renderOrgchart(): void {
    const el = this.contentEl;
    const employees = activeEmployees(this.host.state);

    const kpis = el.createDiv({ cls: "octa-kpi-row" });
    this.kpi(kpis, "Empleados activos", String(employees.length));
    this.kpi(kpis, "Con jefe asignado", String(employees.filter((e) => e.managerId).length));

    if (employees.length === 0) {
      el.createDiv({
        cls: "octa-empty",
        text: "No hay empleados. Agregá empleados en la pestaña Empleados.",
      });
      return;
    }

    const byManager = new Map<string, Employee[]>();
    for (const employee of employees) {
      if (!employee.managerId) continue;
      const children = byManager.get(employee.managerId) ?? [];
      children.push(employee);
      byManager.set(employee.managerId, children);
    }
    for (const children of byManager.values()) children.sort((a, b) => a.name.localeCompare(b.name));

    // Raíz = sin jefe, o con jefe que ya no está activo (archivado/inexistente):
    // el subordinado queda visible en lugar de perderse en el organigrama.
    const roots = employees
      .filter((e) => !e.managerId || !byManager.has(e.managerId))
      .sort((a, b) => a.name.localeCompare(b.name));

    const list = el.createDiv({ cls: "octa-orgchart" });
    for (const root of roots) this.renderOrgNode(list, root, byManager, 0);
  }

  private renderOrgNode(
    parent: HTMLElement,
    node: Employee,
    byManager: Map<string, Employee[]>,
    depth: number,
  ): void {
    const row = parent.createDiv({ cls: "octa-orgchart-node" });
    row.style.marginLeft = `${depth * 20}px`;
    row.createSpan({ text: node.name });
    if (node.position) row.createSpan({ cls: "octa-subtle", text: ` — ${node.position}` });
    const children = byManager.get(node.id);
    for (const child of children ?? []) this.renderOrgNode(parent, child, byManager, depth + 1);
  }

  // ── Tab 2: Planilla ────────────────────────────────────────────────

  private renderRuns(): void {
    const el = this.contentEl;
    const state = this.host.state;

    const nav = el.createDiv({ cls: "octa-period" });
    nav.createEl("button", { text: "◀" }).onclick = () => this.shiftMonth(-1);
    nav.createSpan({ text: this.month, cls: "octa-mono" });
    nav.createEl("button", { text: "▶" }).onclick = () => this.shiftMonth(1);

    const runs = payrollRunsInMonth(state, this.month);
    const latest = runs.length > 0 ? runs[runs.length - 1] : undefined;

    const kpis = el.createDiv({ cls: "octa-kpi-row" });
    this.kpi(kpis, "Empleados en planilla", latest ? String(latest.lines.length) : "—");
    this.kpi(kpis, "Bruto", latest ? format(latest.totals.gross, this.host.settings.locale) : "—");
    this.kpi(kpis, "Neto", latest ? format(latest.totals.net, this.host.settings.locale) : "—");
    this.kpi(kpis, "Costo total", latest ? format(latest.totals.totalCost, this.host.settings.locale) : "—");

    const tools = el.createDiv({ cls: "octa-period" });
    tools.createEl("button", { text: "+ Procesar planilla", cls: "mod-cta" }).onclick = () =>
      this.processRun();

    if (runs.length === 0) {
      el.createDiv({
        cls: "octa-empty",
        text: `No hay planillas procesadas en ${this.month}.`,
      });
      return;
    }

    const wrap = el.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Procesado", "Empleados", "Bruto", "Neto", "Costo total", ""]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const run of runs) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: run.processedAt, cls: "octa-mono" });
      row.createEl("td", { text: String(run.lines.length), cls: "octa-num" });
      row.createEl("td", {
        text: format(run.totals.gross, this.host.settings.locale),
        cls: "octa-num",
      });
      row.createEl("td", {
        text: format(run.totals.net, this.host.settings.locale),
        cls: "octa-num",
      });
      row.createEl("td", {
        text: format(run.totals.totalCost, this.host.settings.locale),
        cls: "octa-num",
      });
      const actions = row.createEl("td", { cls: "octa-actions" });
      actions.createEl("button", { text: "Ver" }).onclick = () => this.viewRun(run);
    }
  }

  private shiftMonth(delta: number): void {
    if (!MONTH_RE.test(this.month)) {
      // No debería pasar: esta vista siempre arranca con monthKeyOf. Si el estado
      // se corrompió, saltar a un mes válido en vez de tachar NaN.
      this.month = monthKeyOf(toIsoDate(new Date()));
      return;
    }
    const [yearPart, monthPart] = this.month.split("-");
    const year = Number(yearPart!);
    const month = Number(monthPart!);
    const d = new Date(year, month - 1 + delta, 1);
    this.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    this.render();
  }

  private processRun(): void {
    const state = this.host.state;
    const employees = activeEmployees(state);
    if (employees.length === 0) {
      new Notice("No hay empleados activos para procesar la planilla.");
      return;
    }

    try {
      const policy = currentPayrollPolicy(toIsoDate(new Date()));
      const lines: PayrollLine[] = employees.map((e) =>
        computePayrollLine({ employeeId: e.id, employeeName: e.name, gross: e.baseSalary }, policy),
      );
      const totals = computePayrollTotals(lines, "GTQ");

      new ProcessPayrollModal(this.app, {
        month: this.month,
        lines,
        totals,
        locale: this.host.settings.locale,
        runCount: payrollRunsInMonth(state, this.month).length,
        onConfirm: async () => {
          const ok = await this.host.commit(
            this.host.newEvent("payroll.run_processed", {
              runId: generateId("pay"),
              month: this.month,
              lines,
              totals,
            }),
          );
          if (ok) new Notice(`Planilla de ${this.month} procesada`);
        },
      }).open();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      new Notice(`No se pudo calcular la planilla: ${reason}`);
    }
  }

  private viewRun(run: PayrollRun): void {
    new PayrollRunModal(this.app, { run, locale: this.host.settings.locale }).open();
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}

// ── Modal: alta/edición de empleado ──────────────────────────────────

export class EmployeeModal extends Modal {
  private name: string;
  private taxId: string;
  private hireDate: string;
  private baseSalaryRaw: string;
  private contractType: ContractType;
  private position: string;
  private managerId: string;
  private responsibilities: Set<string>;

  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly existing?: Employee;
      readonly managers: readonly Employee[];
      readonly currency: string;
      readonly locale: string;
      readonly onSubmit: (draft: EmployeeDraft) => Promise<boolean>;
    },
  ) {
    super(app);
    const e = options.existing;
    this.name = e?.name ?? "";
    this.taxId = e?.taxId ?? "";
    this.hireDate = e?.hireDate ?? toIsoDate(new Date());
    this.baseSalaryRaw = e ? toDecimalString(e.baseSalary) : "";
    this.contractType = e?.contractType ?? "fijo";
    this.position = e?.position ?? "";
    const currentManager = e?.managerId ?? "";
    const managerAvailable = options.managers.some((m) => m.id === currentManager);
    if (currentManager && !managerAvailable) {
      // El jefe directo quedó archivado/inactivo: antes se limpiaba en silencio.
      new Notice("El jefe directo de este empleado ya no está activo y se guardará sin jefe.");
    }
    this.managerId = managerAvailable ? currentManager : "";
    this.responsibilities = new Set(e?.responsibilities ?? []);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: this.options.existing ? "Editar empleado" : "Nuevo empleado" });

    new Setting(contentEl).setName("Nombre").addText((t) => {
      t.setPlaceholder("María Pérez").setValue(this.name).onChange((v) => (this.name = v));
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(contentEl)
      .setName("NIT / CUI")
      .setDesc("Opcional. Se imprime en los comprobantes de nómina.")
      .addText((t) => t.setPlaceholder("12345678").setValue(this.taxId).onChange((v) => (this.taxId = v)));

    new Setting(contentEl).setName("Fecha de contratación").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(this.hireDate).onChange((v) => (this.hireDate = v));
    });

    new Setting(contentEl).setName(`Salario base (${this.options.currency})`).addText((t) => {
      t.setPlaceholder("4500.00").setValue(this.baseSalaryRaw).onChange((v) => (this.baseSalaryRaw = v));
      t.inputEl.inputMode = "decimal";
    });

    new Setting(contentEl).setName("Tipo de contrato").addDropdown((d) => {
      for (const key of Object.keys(CONTRACT_LABEL) as ContractType[]) {
        d.addOption(key, CONTRACT_LABEL[key]);
      }
      d.setValue(this.contractType).onChange((v) => (this.contractType = v as ContractType));
    });

    new Setting(contentEl)
      .setName("Puesto")
      .setDesc("Opcional. Ej.: «Cajero», «Encargado de bodega».")
      .addText((t) => t.setPlaceholder("Cajero").setValue(this.position).onChange((v) => (this.position = v)));

    new Setting(contentEl).setName("Jefe directo").addDropdown((d) => {
      d.addOption("", "— Sin jefe —");
      for (const manager of this.options.managers) d.addOption(manager.id, manager.name);
      d.setValue(this.managerId).onChange((v) => (this.managerId = v));
    });

    contentEl.createEl("h4", { text: "Responsabilidades", cls: "octa-group" });
    const checklist = contentEl.createDiv({ cls: "octa-checklist" });
    for (const responsibility of STANDARD_RESPONSIBILITIES) {
      const item = checklist.createDiv();
      const check = item.createEl("input", { type: "checkbox" });
      check.checked = this.responsibilities.has(responsibility);
      check.onchange = () => {
        if (check.checked) this.responsibilities.add(responsibility);
        else this.responsibilities.delete(responsibility);
      };
      item.createSpan({ text: responsibility });
    }

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Guardar").setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    const problems: string[] = [];

    let baseSalary: Money | undefined;
    try {
      baseSalary = fromDecimal(this.baseSalaryRaw, this.options.currency);
    } catch {
      problems.push(`Salario base inválido: ${this.baseSalaryRaw || "(vacío)"}`);
    }

    if (!this.hireDate) {
      problems.push("La fecha de contratación es obligatoria");
    }

    const draft: Partial<EmployeeDraft> = {
      name: this.name.trim(),
      hireDate: this.hireDate,
      ...(baseSalary ? { baseSalary } : {}),
      ...(this.taxId.trim() ? { taxId: this.taxId.trim() } : {}),
      ...(this.position.trim() ? { position: this.position.trim() } : {}),
      ...(this.managerId ? { managerId: this.managerId } : {}),
      ...(this.responsibilities.size > 0
        ? { responsibilities: [...this.responsibilities].sort() }
        : {}),
      contractType: this.contractType,
    };
    problems.push(...validateEmployeeDraft(draft).map((e) => e.message));

    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const message of problems) list.createEl("li", { text: message });
      return;
    }

    // La validación ya garantizó name/hireDate/baseSalary/contractType. posición,
    // jefe y responsabilidades se envían explícitos (undefined/vacío limpian).
    const complete: EmployeeDraft = {
      name: draft.name!,
      hireDate: draft.hireDate!,
      baseSalary: draft.baseSalary!,
      ...(draft.taxId ? { taxId: draft.taxId } : {}),
      position: draft.position,
      managerId: draft.managerId,
      responsibilities: draft.responsibilities ?? [],
      contractType: draft.contractType!,
    };
    if (await this.options.onSubmit(complete)) this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

// ── Modal: previsualización del procesamiento ────────────────────────

export class ProcessPayrollModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      readonly month: string;
      readonly lines: readonly PayrollLine[];
      readonly totals: PayrollTotals;
      readonly locale: string;
      readonly runCount: number;
      readonly onConfirm: () => Promise<void>;
    },
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("octa-wide-modal");
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: `Procesar planilla ${this.options.month}` });

    contentEl.createEl("p", {
      cls: "octa-subtle",
      text:
        this.options.runCount > 0
          ? `Ya hay ${this.options.runCount} planilla procesada en este mes; esta se guardará como una corrida aparte.`
          : "Se calcula IGSS, ISR y provisiones con la política vigente para cada empleado activo.",
    });

    const wrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Empleado", "Bruto", "IGSS", "ISR", "Neto", "Costo total"]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const line of this.options.lines) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: line.employeeName });
      row.createEl("td", { text: format(line.gross, this.options.locale), cls: "octa-num" });
      row.createEl("td", { text: format(line.igssEmployee, this.options.locale), cls: "octa-num" });
      row.createEl("td", { text: format(line.isr, this.options.locale), cls: "octa-num" });
      row.createEl("td", { text: format(line.net, this.options.locale), cls: "octa-num" });
      row.createEl("td", { text: format(line.totalCost, this.options.locale), cls: "octa-num" });
    }

    const foot = table.createEl("tfoot").createEl("tr");
    foot.createEl("th", { text: "Totales" });
    const t = this.options.totals;
    foot.createEl("th", { text: format(t.gross, this.options.locale), cls: "octa-num" });
    foot.createEl("th", { text: format(t.igssEmployee, this.options.locale), cls: "octa-num" });
    foot.createEl("th", { text: format(t.isr, this.options.locale), cls: "octa-num" });
    foot.createEl("th", { text: format(t.net, this.options.locale), cls: "octa-num" });
    foot.createEl("th", { text: format(t.totalCost, this.options.locale), cls: "octa-num" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => {
        b.setButtonText("Procesar").setCta().onClick(async () => {
          this.close();
          await this.options.onConfirm();
        });
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

// ── Modal: detalle de una planilla procesada ─────────────────────────

export class PayrollRunModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      readonly run: PayrollRun;
      readonly locale: string;
    },
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("octa-wide-modal");
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: `Planilla ${this.options.run.month}` });
    contentEl.createEl("p", {
      cls: "octa-subtle",
      text: `Procesada el ${this.options.run.processedAt}.`,
    });

    const wrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Empleado", "Bruto", "IGSS", "ISR", "Neto", "Costo total"]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const line of this.options.run.lines) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: line.employeeName });
      row.createEl("td", { text: format(line.gross, this.options.locale), cls: "octa-num" });
      row.createEl("td", { text: format(line.igssEmployee, this.options.locale), cls: "octa-num" });
      row.createEl("td", { text: format(line.isr, this.options.locale), cls: "octa-num" });
      row.createEl("td", { text: format(line.net, this.options.locale), cls: "octa-num" });
      row.createEl("td", { text: format(line.totalCost, this.options.locale), cls: "octa-num" });
    }

    const foot = table.createEl("tfoot").createEl("tr");
    foot.createEl("th", { text: "Totales" });
    const t = this.options.run.totals;
    foot.createEl("th", { text: format(t.gross, this.options.locale), cls: "octa-num" });
    foot.createEl("th", { text: format(t.igssEmployee, this.options.locale), cls: "octa-num" });
    foot.createEl("th", { text: format(t.isr, this.options.locale), cls: "octa-num" });
    foot.createEl("th", { text: format(t.net, this.options.locale), cls: "octa-num" });
    foot.createEl("th", { text: format(t.totalCost, this.options.locale), cls: "octa-num" });

    new Setting(contentEl).addButton((b) => b.setButtonText("Cerrar").onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}