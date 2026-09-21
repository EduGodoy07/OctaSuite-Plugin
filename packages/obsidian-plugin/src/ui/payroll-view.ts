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
  rootEmployees,
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
import { App, ItemView, Modal, Notice, Setting, TFile, type WorkspaceLeaf } from "obsidian";
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
    for (const label of ["Nombre", "Puesto", "NIT/CUI", "Celular", "Email", "Contrato", "Salario base", "Desde", "Expediente", ""]) {
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
    row.createEl("td", { text: employee.phone ?? "—", cls: "octa-mono" });
    row.createEl("td", { text: employee.email ?? "—" });
    row.createEl("td", {
      text: employee.contractType ? CONTRACT_LABEL[employee.contractType] : "—",
    });
    row.createEl("td", {
      text: format(employee.baseSalary, settings.locale),
      cls: "octa-num",
    });
    row.createEl("td", { text: employee.hireDate, cls: "octa-mono" });

    // Expediente: foto + CV desde el vault (claves photoPath/cvPath opcionales).
    const fileCell = row.createEl("td");
    if (employee.photoPath) {
      const file = this.app.vault.getAbstractFileByPath(employee.photoPath);
      if (file instanceof TFile) {
        fileCell.createEl("img", {
          cls: "octa-employee-photo",
          attr: { src: this.app.vault.getResourcePath(file), alt: "" },
        });
      } else {
        fileCell.createSpan({ cls: "octa-subtle", text: "foto sin archivo" });
      }
    }
    if (employee.cvPath) {
      const file = this.app.vault.getAbstractFileByPath(employee.cvPath);
      fileCell.createEl("button", { text: "Ver CV" }).onclick = () => {
        if (file instanceof TFile) this.app.workspace.openLinkText(file.path, "");
        else new Notice("El archivo del CV no existe en el vault");
      };
    }

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

  // ── Tab 3: Organigrama con bloques por departamento ──────────────────

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

    // Hijos directos por manager
    const byManager = new Map<string, Employee[]>();
    for (const employee of employees) {
      if (!employee.managerId) continue;
      const children = byManager.get(employee.managerId) ?? [];
      children.push(employee);
      byManager.set(employee.managerId, children);
    }
    for (const children of byManager.values()) children.sort((a, b) => a.name.localeCompare(b.name));

    // Raíces = sin jefe (o con jefe archivado/inexistente).
    // Se registran bajo la key "" porque layoutBlocks(null, …) consulta
    // byManager.get(""). Sin esto el organigrama queda vacío (0 bloques):
    // el bucle de arriba saltea a quienes no tienen managerId.
    const roots = rootEmployees(this.host.state);
    byManager.set("", roots);

    // Layout SVG con bloques por departamento
    const NS = "http://www.w3.org/2000/svg";
    const BLOCK_W = 320;
    const BLOCK_PAD = 16;
    const HEADER_H = 36;
    const CARD_H = 52;
    const CARD_GAP = 8;
    const BLOCK_GAP = 24;
    const LEVEL_GAP = 80;

    // Cálculo de posiciones: recursivo por manager → bloques por dept → tarjetas
    interface BlockLayout {
      x: number;
      y: number;
      width: number;
      height: number;
      managerId: string | null;
      dept: string;
      employees: Employee[];
      childrenBlocks: BlockLayout[];
    }

    let maxX = 0;
    let maxY = 0;

    const layoutBlocks = (managerId: string | null, depth: number, startY: number): { blocks: BlockLayout[]; nextY: number } => {
      const mgrEmployees = byManager.get(managerId ?? "") ?? [];
      if (mgrEmployees.length === 0) return { blocks: [], nextY: startY };

      // Agrupar por department
      const byDept = new Map<string, Employee[]>();
      for (const e of mgrEmployees) {
        const dept = e.department?.trim() ?? "";
        const key = dept || "— sin departamento —";
        const arr = byDept.get(key) ?? [];
        arr.push(e);
        byDept.set(key, arr);
      }

      // Orden: alfabético, "sin departamento" al final
      const deptEntries = Array.from(byDept.entries()).sort(([a], [b]) => {
        if (a === "— sin departamento —") return 1;
        if (b === "— sin departamento —") return -1;
        return a.localeCompare(b);
      });

      let y = startY;
      const blocks: BlockLayout[] = [];
      for (const [dept, emps] of deptEntries) {
        const blockH = HEADER_H + emps.length * CARD_H + (emps.length - 1) * CARD_GAP + BLOCK_PAD * 2;
        const block: BlockLayout = {
          x: BLOCK_PAD + depth * (BLOCK_W + BLOCK_GAP),
          y,
          width: BLOCK_W,
          height: blockH,
          managerId,
          dept: dept === "— sin departamento —" ? "" : dept,
          employees: emps,
          childrenBlocks: [],
        };
        // Layout recursivo de sub-bloques (hijos de estos empleados que son managers)
        for (const emp of emps) {
          const childResult = layoutBlocks(emp.id, depth + 1, y);
          block.childrenBlocks.push(...childResult.blocks);
        }
        y += blockH + BLOCK_GAP;
        blocks.push(block);
        maxX = Math.max(maxX, block.x + block.width);
        maxY = Math.max(maxY, block.y + block.height);
      }
      return { blocks, nextY: y };
    };

    const { blocks: rootBlocks } = layoutBlocks(null, 0, BLOCK_PAD);
    const width = maxX + BLOCK_PAD;
    const height = Math.max(300, maxY + BLOCK_PAD);

    const wrap = el.createDiv({ cls: "octa-orgchart-wrap" });
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "octa-orgchart-svg octa-orgchart-blocks");
    wrap.appendChild(svg);

    // Defs para gradientes si se desea (opcional)
    const defs = document.createElementNS(NS, "defs");
    svg.appendChild(defs);

    // Conectores: header de bloque → cada tarjeta (member path)
    const edges = document.createElementNS(NS, "g");
    edges.setAttribute("class", "octa-orgchart-edges");
    svg.appendChild(edges);

    // Nodos y bloques
    const blocksG = document.createElementNS(NS, "g");
    blocksG.setAttribute("class", "octa-orgchart-blocks");
    svg.appendChild(blocksG);

    const renderBlock = (block: BlockLayout, parentHeaderCenter?: { x: number; y: number }): void => {
      const { x, y, width, height, dept, employees, childrenBlocks } = block;

      // Fondo del bloque
      const bg = document.createElementNS(NS, "rect");
      bg.setAttribute("class", "octa-orgchart-block-bg");
      bg.setAttribute("x", String(x));
      bg.setAttribute("y", String(y));
      bg.setAttribute("width", String(width));
      bg.setAttribute("height", String(height));
      bg.setAttribute("rx", "8");
      blocksG.appendChild(bg);

      // Header del bloque
      const header = document.createElementNS(NS, "rect");
      header.setAttribute("class", "octa-orgchart-block-header");
      header.setAttribute("x", String(x));
      header.setAttribute("y", String(y));
      header.setAttribute("width", String(width));
      header.setAttribute("height", String(HEADER_H));
      header.setAttribute("rx", "8 8 0 0");
      blocksG.appendChild(header);

      // Label del header
      const label = document.createElementNS(NS, "text");
      label.setAttribute("class", "octa-orgchart-block-label");
      label.setAttribute("x", String(x + 12));
      label.setAttribute("y", String(y + HEADER_H / 2 + 3));
      label.textContent = dept ? `${dept} (${employees.length})` : `Sin departamento (${employees.length})`;
      blocksG.appendChild(label);

      // Centro del header para conectores
      const headerCenterX = x + width / 2;
      const headerCenterY = y + HEADER_H;

      // Conector desde header padre → este header (si hay parentHeaderCenter)
      if (parentHeaderCenter) {
        const path = document.createElementNS(NS, "path");
        path.setAttribute("class", "octa-block-member-path");
        const midY = (parentHeaderCenter.y + headerCenterY) / 2;
        path.setAttribute(
          "d",
          `M ${parentHeaderCenter.x} ${parentHeaderCenter.y} V ${midY} H ${headerCenterX} V ${headerCenterY}`,
        );
        edges.appendChild(path);
      }

      // Tarjetas de empleados dentro del bloque
      let cardY = y + HEADER_H + BLOCK_PAD;
      for (const emp of employees) {
        const cardX = x + BLOCK_PAD;
        const cardW = width - BLOCK_PAD * 2;

        // Fondo tarjeta
        const cardBg = document.createElementNS(NS, "rect");
        cardBg.setAttribute("x", String(cardX));
        cardBg.setAttribute("y", String(cardY));
        cardBg.setAttribute("width", String(cardW));
        cardBg.setAttribute("height", String(CARD_H));
        cardBg.setAttribute("rx", "6");
        cardBg.setAttribute("fill", "var(--background-secondary)");
        cardBg.setAttribute("stroke", "var(--background-modifier-border)");
        blocksG.appendChild(cardBg);

        // Avatar (círculo con iniciales)
        const initials = emp.name
          .split(/\s+/)
          .map((p) => p[0] ?? "")
          .slice(0, 2)
          .join("")
          .toUpperCase();
        const circle = document.createElementNS(NS, "circle");
        circle.setAttribute("cx", String(cardX + 24));
        circle.setAttribute("cy", String(cardY + CARD_H / 2));
        circle.setAttribute("r", "15");
        circle.setAttribute("class", "octa-orgchart-nodes circle");
        blocksG.appendChild(circle);

        const initialsText = document.createElementNS(NS, "text");
        initialsText.setAttribute("class", "octa-orgchart-initials octa-orgchart-text");
        initialsText.setAttribute("x", String(cardX + 24));
        initialsText.setAttribute("y", String(cardY + CARD_H / 2 + 4));
        initialsText.setAttribute("text-anchor", "middle");
        initialsText.textContent = initials;
        blocksG.appendChild(initialsText);

        // Nombre
        const nameText = document.createElementNS(NS, "text");
        nameText.setAttribute("class", "octa-orgchart-name octa-orgchart-text");
        nameText.setAttribute("x", String(cardX + 48));
        nameText.setAttribute("y", String(cardY + CARD_H / 2 - 6));
        nameText.textContent = emp.name;
        blocksG.appendChild(nameText);

        // Puesto
        if (emp.position) {
          const roleText = document.createElementNS(NS, "text");
          roleText.setAttribute("class", "octa-orgchart-role octa-orgchart-text");
          roleText.setAttribute("x", String(cardX + 48));
          roleText.setAttribute("y", String(cardY + CARD_H / 2 + 10));
          roleText.textContent = emp.position;
          blocksG.appendChild(roleText);
        }

        // Conector header de bloque → tarjeta (member path)
        const cardCenterX = cardX + cardW / 2;
        const cardTopY = cardY;
        const path = document.createElementNS(NS, "path");
        path.setAttribute("class", "octa-block-member-path");
        const midY = (headerCenterY + cardTopY) / 2;
        path.setAttribute(
          "d",
          `M ${headerCenterX} ${headerCenterY} V ${midY} H ${cardCenterX} V ${cardTopY}`,
        );
        edges.appendChild(path);

        cardY += CARD_H + CARD_GAP;
      }

      // Renderizar sub-bloques recursivamente
      for (const childBlock of childrenBlocks) {
        renderBlock(childBlock, { x: headerCenterX, y: headerCenterY });
      }
    };

    for (const rootBlock of rootBlocks) renderBlock(rootBlock);
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
  private department: string;
  private phone: string;
  private email: string;
  private photoPath: string;
  private cvPath: string;
  private responsibilities: Set<string>;

  private errorsEl!: HTMLElement;
  private attachmentsEl!: HTMLElement;

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
    this.department = e?.department ?? "";
    this.phone = e?.phone ?? "";
    this.email = e?.email ?? "";
    this.photoPath = e?.photoPath ?? "";
    this.cvPath = e?.cvPath ?? "";
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

    new Setting(contentEl)
      .setName("Celular (móvil personal)")
      .setDesc("Opcional. Contacto del empleado. El móvil corporativo asignado se registra en el inventario de equipos.")
      .addText((t) =>
        t.setPlaceholder("+502 5555 1234").setValue(this.phone).onChange((v) => (this.phone = v)),
      );

    new Setting(contentEl)
      .setName("Email")
      .setDesc("Opcional. Contacto del empleado (personal o corporativo).")
      .addText((t) =>
        t.setPlaceholder("empleado@empresa.gt").setValue(this.email).onChange((v) => (this.email = v)),
      );

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

    new Setting(contentEl)
      .setName("Departamento / Área")
      .setDesc("Opcional. Se usa para agrupar el organigrama por área.")
      .addText((t) =>
        t.setPlaceholder("Operaciones").setValue(this.department).onChange((v) => (this.department = v)),
      );

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

    if (this.options.existing) {
      contentEl.createEl("h4", { text: "Expediente", cls: "octa-group" });
      this.attachmentsEl = contentEl.createDiv({ cls: "octa-attachments" });
      this.renderAttachments();
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
      ...(this.phone.trim() ? { phone: this.phone.trim() } : {}),
      ...(this.email.trim() ? { email: this.email.trim() } : {}),
      ...(this.position.trim() ? { position: this.position.trim() } : {}),
      ...(this.department.trim() ? { department: this.department.trim() } : {}),
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
      ...(draft.phone ? { phone: draft.phone } : {}),
      ...(draft.email ? { email: draft.email } : {}),
      ...(draft.department ? { department: draft.department } : {}),
      position: draft.position,
      managerId: draft.managerId,
      responsibilities: draft.responsibilities ?? [],
      contractType: draft.contractType!,
      ...(this.photoPath ? { photoPath: this.photoPath } : {}),
      ...(this.cvPath ? { cvPath: this.cvPath } : {}),
    };
    if (await this.options.onSubmit(complete)) this.close();
  }

  private renderAttachments(): void {
    this.attachmentsEl.empty();
    this.attachmentRow("Foto", "image/*", this.photoPath, (p) => (this.photoPath = p), "Subir foto", "Foto");
    this.attachmentRow("CV (PDF)", "application/pdf", this.cvPath, (p) => (this.cvPath = p), "Subir CV", "CV");
  }

  private attachmentRow(
    label: string,
    accept: string,
    value: string,
    set: (path: string) => void,
    buttonText: string,
    noticeLabel: string,
  ): void {
    const row = this.attachmentsEl.createDiv({ cls: "octa-attachment-row" });
    row.createSpan({ cls: "octa-attachment-label", text: label });
    if (value) {
      const name = value.split("/").pop() ?? value;
      row.createSpan({ cls: "octa-attachment-name", text: name, title: value });
    } else {
      row.createSpan({ cls: "octa-attachment-name octa-subtle", text: "Sin adjuntar" });
    }
    row.createEl("button", { text: buttonText }).onclick = () =>
      this.pickAttachment(accept, set, noticeLabel);
  }

  private async pickAttachment(
    accept: string,
    set: (path: string) => void,
    label: string,
  ): Promise<void> {
    const existing = this.options.existing;
    if (!existing) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ext = (file.name.split(".").pop() ?? (accept === "application/pdf" ? "pdf" : "jpg")).toLowerCase();
      const dir = `octasuite-data/employees/${existing.id}`;
      const fileName = accept === "application/pdf" ? `cv.${ext}` : `foto.${ext}`;
      const path = `${dir}/${fileName}`;
      try {
        if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFile)) {
          await this.app.vault.createFolder(dir);
        }
        const data = await file.arrayBuffer();
        const existingFile = this.app.vault.getAbstractFileByPath(path);
        if (existingFile instanceof TFile) {
          await this.app.vault.adapter.writeBinary(existingFile.path, data);
        } else {
          await this.app.vault.createBinary(path, data);
        }
        set(path);
        this.renderAttachments();
        new Notice(`${label} guardada en el vault`);
      } catch (err) {
        new Notice(`No se pudo guardar el adjunto: ${String(err)}`);
      }
    };
    input.click();
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