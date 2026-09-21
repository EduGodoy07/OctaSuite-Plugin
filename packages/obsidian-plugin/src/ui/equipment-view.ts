import {
  type Equipment,
  type EquipmentStatus,
  type State,
  activeEmployees,
  activeEquipment,
  activeEquipmentAssignment,
  activePartners,
  assignmentsFor,
  bookValue,
  employeeById,
  format,
  generateId,
  toIsoDate,
} from "@octasuite/core";
import { App, ItemView, Modal, Notice, Setting, type WorkspaceLeaf } from "obsidian";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";
import { EQUIPMENT_STATUS_LABEL, EQUIPMENT_TYPE_LABEL, EquipmentModal } from "./equipment-modal.js";
import { ConfirmModal } from "./confirm-modal.js";
import { EQUIPMENT_VIEW_TYPE } from "../modules.js";

interface AssignmentPayload {
  readonly employeeId: string;
  readonly assignedAt: string;
  readonly note?: string;
}

interface ReturnPayload {
  readonly returnedAt: string;
  readonly note?: string;
}

export class EquipmentView extends ItemView {
  private statusFilter: EquipmentStatus | "" = "";
  private clientFilter = "";
  private employeeFilter = "";
  private query = "";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return EQUIPMENT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Equipos";
  }

  override getIcon(): string {
    return "laptop";
  }

  override async onOpen(): Promise<void> {
    await this.host.ready;
    this.render();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private refresh(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    const { state, settings } = this.host;
    const { currency, locale } = settings;
    contentEl.empty();
    contentEl.addClass("octa");

    const bar = moduleHeader(contentEl, "Equipos", this.host, this.app, this.leaf, EQUIPMENT_VIEW_TYPE);
    const tools = bar.createDiv({ cls: "octa-period" });
    const search = tools.createEl("input", { cls: "octa-search" });
    search.type = "search";
    search.placeholder = "Buscar serial, marca, modelo, cliente…";
    search.value = this.query;
    search.oninput = () => {
      this.query = search.value.trim();
      this.renderList();
    };
    tools.createEl("button", { text: "+ Equipo", cls: "mod-cta" }).onclick = () => this.openCreateModal();
    this.renderFilters(tools);

    const equipos = activeEquipment(state);
    const enUso = equipos.filter((e) => e.status === "en_uso").length;
    const totalValue = equipos.reduce<number>((acc, e) => {
      const book = bookValue(e, toIsoDate(new Date()));
      return book && book.currency === currency ? acc + book.minor : acc;
    }, 0);

    const kpis = contentEl.createDiv({ cls: "octa-kpi-row" });
    this.kpi(kpis, "Equipos activos", String(equipos.length));
    this.kpi(kpis, "En uso", String(enUso));
    this.kpi(kpis, "Valor en libros", totalValue > 0 ? format({ minor: totalValue, currency }, locale) : "—");

    contentEl.createDiv({ cls: "octa-list-slot" });
    this.renderList();
  }

  private kpi(parent: HTMLElement, label: string, value: string): void {
    const box = parent.createDiv({ cls: "octa-kpi" });
    box.createEl("div", { cls: "octa-kpi-value", text: value });
    box.createEl("div", { cls: "octa-kpi-label", text: label });
  }

  private renderFilters(tools: HTMLElement): void {
    const statusSelect = tools.createEl("select", { cls: "octa-filter" });
    statusSelect.appendChild(this.option("", "Estado: todos"));
    for (const status of Object.keys(EQUIPMENT_STATUS_LABEL) as EquipmentStatus[]) {
      statusSelect.appendChild(this.option(status, EQUIPMENT_STATUS_LABEL[status]));
    }
    statusSelect.value = this.statusFilter;
    statusSelect.onchange = () => {
      this.statusFilter = statusSelect.value as EquipmentStatus | "";
      this.renderList();
    };

    const clientSelect = tools.createEl("select", { cls: "octa-filter" });
    clientSelect.appendChild(this.option("", "Cliente: todos"));
    for (const partner of [...activePartners(this.host.state)].sort((a, b) => a.name.localeCompare(b.name))) {
      clientSelect.appendChild(this.option(partner.id, partner.name));
    }
    clientSelect.value = this.clientFilter;
    clientSelect.onchange = () => {
      this.clientFilter = clientSelect.value;
      this.renderList();
    };

    const employeeSelect = tools.createEl("select", { cls: "octa-filter" });
    employeeSelect.appendChild(this.option("", "Empleado: todos"));
    for (const employee of [...activeEmployees(this.host.state)].sort((a, b) => a.name.localeCompare(b.name))) {
      employeeSelect.appendChild(this.option(employee.id, employee.name));
    }
    employeeSelect.value = this.employeeFilter;
    employeeSelect.onchange = () => {
      this.employeeFilter = employeeSelect.value;
      this.renderList();
    };
  }

  private option(value: string, label: string): HTMLOptionElement {
    const el = document.createElement("option");
    el.value = value;
    el.text = label;
    return el;
  }

  private renderList(): void {
    const slot = this.contentEl.querySelector<HTMLElement>(".octa-list-slot");
    if (!slot) return;
    slot.empty();

    const { state, settings } = this.host;
    const { locale } = settings;
    const needle = this.query.toLowerCase();
    const assigneeName = (eq: Equipment): string => {
      const assignment = activeEquipmentAssignment(state, eq.id);
      if (!assignment) return "—";
      return employeeById(state, assignment.employeeId)?.name ?? "—";
    };
    const equipos = activeEquipment(state)
      .filter((e) => this.statusFilter === "" || e.status === this.statusFilter)
      .filter((e) => this.clientFilter === "" || e.clientId === this.clientFilter)
      .filter((e) => this.employeeFilter === "" || activeEquipmentAssignment(state, e.id)?.employeeId === this.employeeFilter)
      .filter((e) => {
        if (needle === "") return true;
        const client = e.clientId ? state.partners.get(e.clientId)?.name ?? "" : "";
        const haystack = [e.serial, e.brand ?? "", e.model ?? "", client, assigneeName(e)];
        return haystack.some((part) => part.toLowerCase().includes(needle));
      });

    if (equipos.length === 0) {
      slot.createEl("p", {
        cls: "octa-empty",
        text: this.query !== "" ? `Ningún equipo coincide con «${this.query}».` : "Todavía no hay equipos registrados.",
      });
      return;
    }

    const wrap = slot.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Serial", "Equipo", "Cliente", "Asignado a", "Estado", "Valor", ""]) {
      head.createEl("th", { text: label });
    }
    const tbody = table.createEl("tbody");
    for (const eq of equipos) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: eq.serial });
      row.createEl("td", {
        text: [EQUIPMENT_TYPE_LABEL[eq.type], eq.brand ?? "", eq.model ?? ""].filter((s) => s !== "").join(" · "),
      });
      row.createEl("td", { text: eq.clientId ? state.partners.get(eq.clientId)?.name ?? "—" : "—" });
      row.createEl("td", { text: assigneeName(eq) });
      row.createEl("td", { text: EQUIPMENT_STATUS_LABEL[eq.status] });
      row.createEl("td", { text: eq.cost ? format({ minor: eq.cost.minor, currency: eq.cost.currency }, locale) : "—" });
      const actionCell = row.createEl("td");
      const actions = actionCell.createDiv();
      const addAction = (label: string, fn: () => void): void => {
        const button = actions.createEl("button", { text: label });
        button.onclick = () => fn();
      };
      addAction("Editar", () => this.openEditModal(eq));
      if (eq.status !== "dado_de_baja") {
        if (activeEquipmentAssignment(state, eq.id)) {
          addAction("Devolver", () => this.openReturnModal(eq));
        } else {
          addAction("Asignar", () => this.openAssignModal(eq));
        }
      }
      addAction("Historial", () => this.openHistoryModal(eq));
      addAction("Archivar", () => void this.confirmArchive(eq));
    }
  }

  private openCreateModal(): void {
    new EquipmentModal(this.app, {
      state: this.host.state,
      currency: this.host.settings.currency,
      locale: this.host.settings.locale,
      onSubmit: async (draft) => {
        const equipmentId = generateId("eq");
        const ok = await this.host.commit(this.host.newEvent("equipment.created", { equipmentId, ...draft }));
        if (ok) new Notice("Equipo registrado");
        this.refresh();
        return ok;
      },
    }).open();
  }

  private openEditModal(eq: Equipment): void {
    new EquipmentModal(this.app, {
      existing: eq,
      state: this.host.state,
      currency: this.host.settings.currency,
      locale: this.host.settings.locale,
      onSubmit: async (draft) => {
        const ok = await this.host.commit(
          this.host.newEvent("equipment.updated", { equipmentId: eq.id, changes: draft })
        );
        if (ok) new Notice("Equipo actualizado");
        this.refresh();
        return ok;
      },
    }).open();
  }

  private openAssignModal(eq: Equipment): void {
    new AssignmentModal(this.app, {
      state: this.host.state,
      onSubmit: async (payload) => {
        const ok = await this.host.commit(
          this.host.newEvent("equipment.assigned", {
            equipmentId: eq.id,
            employeeId: payload.employeeId,
            assignedAt: payload.assignedAt,
            ...(payload.note === undefined ? {} : { note: payload.note }),
          })
        );
        if (ok) new Notice("Equipo asignado");
        this.refresh();
        return ok;
      },
    }).open();
  }

  private openReturnModal(eq: Equipment): void {
    new ReturnModal(this.app, {
      onSubmit: async (payload) => {
        const ok = await this.host.commit(
          this.host.newEvent("equipment.returned", {
            equipmentId: eq.id,
            returnedAt: payload.returnedAt,
            ...(payload.note === undefined ? {} : { note: payload.note }),
          })
        );
        if (ok) new Notice("Equipo devuelto");
        this.refresh();
        return ok;
      },
    }).open();
  }

  private openHistoryModal(eq: Equipment): void {
    new HistoryModal(this.app, this.host.state, eq.id).open();
  }

  private confirmArchive(eq: Equipment): void {
    new ConfirmModal(this.app, {
      title: "Archivar equipo",
      body: `¿Archivar el equipo «${eq.serial}»? Dejará de aparecer en los listados activos.`,
      confirmText: "Archivar",
      destructive: true,
      onConfirm: () => {
        void this.doArchive(eq.id);
      },
    }).open();
  }

  private async doArchive(equipmentId: string): Promise<void> {
    const ok = await this.host.commit(this.host.newEvent("equipment.archived", { equipmentId }));
    if (ok) new Notice("Equipo archivado");
    this.refresh();
  }
}

class AssignmentModal extends Modal {
  private readonly options: {
    readonly state: State;
    readonly onSubmit: (payload: AssignmentPayload) => Promise<boolean>;
  };
  private errorsEl!: HTMLElement;
  private employeeId = "";
  private assignedAt = toIsoDate(new Date());
  private note = "";

  constructor(
    app: App,
    options: {
      readonly state: State;
      readonly onSubmit: (payload: AssignmentPayload) => Promise<boolean>;
    }
  ) {
    super(app);
    this.options = options;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Asignar equipo" });

    new Setting(contentEl).setName("Empleado *").addDropdown((d) => {
      d.addOption("", "— Seleccionar —");
      for (const employee of [...activeEmployees(this.options.state)].sort((a, b) => a.name.localeCompare(b.name))) {
        d.addOption(employee.id, employee.name);
      }
      d.setValue(this.employeeId).onChange((v) => {
        this.employeeId = v;
      });
    });

    new Setting(contentEl).setName("Fecha de asignación").setDesc("AAAA-MM-DD").addText((t) =>
      t.setPlaceholder("AAAA-MM-DD").setValue(this.assignedAt).onChange((v) => {
        this.assignedAt = v;
      })
    );

    new Setting(contentEl).setName("Nota").addText((t) =>
      t.onChange((v) => {
        this.note = v;
      })
    );

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Cancelar").onClick(() => {
          this.close();
        })
      )
      .addButton((b) =>
        b
          .setButtonText("Asignar")
          .setCta()
          .onClick(() => {
            void this.submit();
          })
      );
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    const problems: string[] = [];
    if (this.employeeId === "") problems.push("Selecciona un empleado.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.assignedAt)) problems.push(`Fecha inválida: «${this.assignedAt}».`);
    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const message of problems) list.createEl("li", { text: message });
      return;
    }
    const payload: AssignmentPayload = {
      employeeId: this.employeeId,
      assignedAt: this.assignedAt,
      ...(this.note.trim() !== "" ? { note: this.note.trim() } : {}),
    };
    if (await this.options.onSubmit(payload)) this.close();
  }
}

class ReturnModal extends Modal {
  private readonly options: { readonly onSubmit: (payload: ReturnPayload) => Promise<boolean> };
  private errorsEl!: HTMLElement;
  private returnedAt = toIsoDate(new Date());
  private note = "";

  constructor(app: App, options: { readonly onSubmit: (payload: ReturnPayload) => Promise<boolean> }) {
    super(app);
    this.options = options;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Devolver equipo" });

    new Setting(contentEl).setName("Fecha de devolución").setDesc("AAAA-MM-DD").addText((t) =>
      t.setPlaceholder("AAAA-MM-DD").setValue(this.returnedAt).onChange((v) => {
        this.returnedAt = v;
      })
    );

    new Setting(contentEl).setName("Nota").addText((t) =>
      t.onChange((v) => {
        this.note = v;
      })
    );

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Cancelar").onClick(() => {
          this.close();
        })
      )
      .addButton((b) =>
        b
          .setButtonText("Devolver")
          .setCta()
          .onClick(() => {
            void this.submit();
          })
      );
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.returnedAt)) {
      const list = this.errorsEl.createEl("ul");
      list.createEl("li", { text: `Fecha inválida: «${this.returnedAt}».` });
      return;
    }
    const payload: ReturnPayload = {
      returnedAt: this.returnedAt,
      ...(this.note.trim() !== "" ? { note: this.note.trim() } : {}),
    };
    if (await this.options.onSubmit(payload)) this.close();
  }
}

class HistoryModal extends Modal {
  constructor(app: App, private readonly state: State, private readonly equipmentId: string) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("octa-wide-modal");
    contentEl.createEl("h2", { text: "Historial del equipo" });
    const history = assignmentsFor(this.state, this.equipmentId);
    if (history.length === 0) {
      contentEl.createEl("p", { cls: "octa-empty", text: "Sin asignaciones registradas." });
      return;
    }
    const wrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Asignado el", "Empleado", "Devuelto el", "Nota"]) head.createEl("th", { text: label });
    const tbody = table.createEl("tbody");
    for (const entry of [...history].sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: entry.assignedAt });
      row.createEl("td", { text: employeeById(this.state, entry.employeeId)?.name ?? "—" });
      row.createEl("td", { text: entry.returnedAt ?? "En uso" });
      row.createEl("td", { text: entry.note ?? "—" });
    }
  }
}