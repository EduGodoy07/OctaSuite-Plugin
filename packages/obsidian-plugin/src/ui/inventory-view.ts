import {
  activeLocations,
  activeProducts,
  format,
  generateId,
  isKit,
  locationById,
  locationStock,
  locationStockLevels,
  PRIMARY_LOCATION_ID,
  toIsoDate,
  validateLocationDraft,
  validateTransferDraft,
  type InventoryLocation,
  type InventoryLocationKind,
  type LocationDraft,
  type State,
  type StockTransfer,
  type StockTransferLine,
  type TransferDraft,
} from "@octasuite/core";
import { App, ItemView, Modal, Notice, Setting, type DropdownComponent, type WorkspaceLeaf } from "obsidian";
import { INVENTORY_VIEW_TYPE } from "../modules.js";
import { ConfirmModal } from "./confirm-modal.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";

const LOCATION_KIND_LABEL: Record<InventoryLocationKind, string> = {
  main: "Principal",
  warehouse: "Bodega",
  store: "Punto de venta",
  external: "Externo",
};

type Tab = "locations" | "transfers";

export class InventoryView extends ItemView {
  private tab: Tab = "locations";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return INVENTORY_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Inventario";
  }

  override getIcon(): string {
    return "warehouse";
  }

  override async onOpen(): Promise<void> {
    // Espera la reconstrucción inicial: si el state aún es el por defecto (vacío),
    // ensureMain duplicaría "Principal" y el journal quedaría con un evento rechazado
    // (el launcher mostraría "Requiere atención").
    await this.host.ready;
    await this.ensureMain();
    this.render();
  }

  refresh(): void {
    this.render();
  }

  /**
   * La ubicación principal es obligatoria para los traslados (origen o destino
   * deben existir en state.locations). Si todavía no existe, se crea al abrir —
   * por eso `emptyState` no la pre-crea: así el módulo queda vacío para quien
   * no lo use, y esta vista no tiene sentido sin ella.
   */
  private async ensureMain(): Promise<void> {
    if (locationById(this.host.state, PRIMARY_LOCATION_ID)) return;
    await this.host.commit(
      this.host.newEvent("inventory.location_created", {
        locationId: PRIMARY_LOCATION_ID,
        name: "Principal",
        kind: "main",
      }),
    );
    // `commit` devuelve false si otra pestaña creó "Principal" en paralelo (race "duplicate"): esperado.
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("octa");

    const top = this.contentEl.createDiv();
    moduleHeader(top, "Inventario", this.host, this.app, this.leaf, INVENTORY_VIEW_TYPE);

    const tabBar = top.createDiv({ cls: "octa-period" });
    this.tabBtn(tabBar, "Ubicaciones", "locations");
    this.tabBtn(tabBar, "Traslados", "transfers");

    switch (this.tab) {
      case "locations":
        this.renderLocations();
        break;
      case "transfers":
        this.renderTransfers();
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

  // ── Tab 1: Ubicaciones ─────────────────────────────────────────────

  private renderLocations(): void {
    const el = this.contentEl;
    const state = this.host.state;
    const locations = activeLocations(state);

    const tools = el.createDiv({ cls: "octa-period" });
    tools.createEl("button", { text: "+ Ubicación", cls: "mod-cta" }).onclick = () =>
      this.openLocation();

    const kpis = el.createDiv({ cls: "octa-kpi-row" });
    this.kpi(kpis, "Ubicaciones activas", String(locations.length));

    if (locations.length === 0) {
      el.createDiv({
        cls: "octa-empty",
        text: "No hay ubicaciones. La principal se crea sola al abrir este módulo.",
      });
      return;
    }

    const wrap = el.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Nombre", "Tipo", "Existencias", ""]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const location of locations) this.locationRow(tbody, location);
  }

  private locationRow(tbody: HTMLElement, location: InventoryLocation): void {
    const state = this.host.state;
    const row = tbody.createEl("tr");

    const nameCell = row.createEl("td");
    nameCell.createSpan({ text: location.name });
    if (location.id === PRIMARY_LOCATION_ID) {
      nameCell.createDiv({ cls: "octa-subtle", text: "Principal (recibe recepciones, ventas y ajustes)" });
    }

    row.createEl("td", { text: LOCATION_KIND_LABEL[location.kind] });

    const total = locationStockLevels(state, location.id).reduce((acc, l) => acc + l.onHand, 0);
    row.createEl("td", { text: String(Math.round(total * 100) / 100), cls: "octa-num" });

    const actions = row.createEl("td", { cls: "octa-actions" });
    if (location.id !== PRIMARY_LOCATION_ID) {
      actions.createEl("button", { text: "Editar" }).onclick = () => this.openLocation(location);
      actions.createEl("button", { text: "Archivar" }).onclick = () => this.archiveLocation(location);
    }
  }

  private openLocation(existing?: InventoryLocation): void {
    new LocationModal(this.app, {
      ...(existing ? { existing } : {}),
      onSubmit: async (draft) => {
        const ok = existing
          ? await this.host.commit(
              this.host.newEvent("inventory.location_updated", {
                locationId: existing.id,
                changes: draft,
              }),
            )
          : await this.host.commit(
              this.host.newEvent("inventory.location_created", {
                locationId: generateId("loc"),
                ...draft,
              }),
            );
        if (ok) new Notice(existing ? `${draft.name} actualizado` : `${draft.name} agregado`);
        return ok;
      },
    }).open();
  }

  private archiveLocation(location: InventoryLocation): void {
    new ConfirmModal(this.app, {
      title: "Archivar ubicación",
      body: `${location.name} dejará de aparecer en las ubicaciones activas. Primero traslada o ajusta cualquier existencia; no se puede archivar una ubicación con stock pendiente.`,
      confirmText: "Archivar",
      destructive: true,
      onConfirm: async () => {
        const ok = await this.host.commit(
          this.host.newEvent("inventory.location_archived", { locationId: location.id }),
        );
        if (ok) new Notice(`${location.name} archivado`);
      },
    }).open();
  }

  // ── Tab 2: Traslados ───────────────────────────────────────────────

  private renderTransfers(): void {
    const el = this.contentEl;
    const state = this.host.state;

    const transfers = [...state.transfers.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const locations = activeLocations(state);

    if (locations.length < 2) {
      el.createDiv({
        cls: "octa-empty",
        text: "Hacen falta al menos dos ubicaciones para trasladar. Creá una bodega o punto de venta.",
      });
      return;
    }

    const tools = el.createDiv({ cls: "octa-period" });
    tools.createEl("button", { text: "+ Traslado", cls: "mod-cta" }).onclick = () => this.openTransfer();

    const kpis = el.createDiv({ cls: "octa-kpi-row" });
    this.kpi(kpis, "Traslados", String(transfers.length));
    this.kpi(kpis, "Ubicaciones activas", String(locations.length));

    if (transfers.length === 0) {
      el.createDiv({ cls: "octa-empty", text: "Todavía no hay traslados." });
      return;
    }

    const wrap = el.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Fecha", "Origen → Destino", "Referencia", "Líneas", ""]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const transfer of transfers) this.transferRow(tbody, transfer);
  }

  private transferRow(tbody: HTMLElement, transfer: StockTransfer): void {
    const state = this.host.state;
    const row = tbody.createEl("tr");

    row.createEl("td", { text: transfer.date, cls: "octa-mono" });

    const from = locationById(state, transfer.fromLocationId)?.name ?? transfer.fromLocationId;
    const to = locationById(state, transfer.toLocationId)?.name ?? transfer.toLocationId;
    const route = row.createEl("td");
    route.createSpan({ text: from });
    route.createSpan({ cls: "octa-subtle", text: " → " });
    route.createSpan({ text: to });

    row.createEl("td", { text: transfer.reference ?? "—" });

    const linesCell = row.createEl("td");
    const products = transfer.lines
      .map((l) => `${state.products.get(l.productId)?.name ?? l.productId} × ${l.quantity}`)
      .join(" + ");
    linesCell.createSpan({ text: products });

    const actions = row.createEl("td", { cls: "octa-actions" });
    actions.createEl("button", { text: "Ver" }).onclick = () => this.viewTransfer(transfer);
  }

  private openTransfer(): void {
    new TransferModal(this.app, {
      state: this.host.state,
      locale: this.host.settings.locale,
      onSubmit: async (draft) => {
        const ok = await this.host.commit(
          this.host.newEvent("inventory.transfer_created", {
            transferId: generateId("trf"),
            ...draft,
          }),
        );
        if (ok) new Notice("Traslado registrado");
        return ok;
      },
    }).open();
  }

  private viewTransfer(transfer: StockTransfer): void {
    new TransferDetailModal(this.app, {
      transfer,
      state: this.host.state,
    }).open();
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}

// ── Modal: nueva ubicación ───────────────────────────────────────────

export class LocationModal extends Modal {
  private name: string;
  private kind: InventoryLocationKind;

  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly existing?: InventoryLocation;
      readonly onSubmit: (draft: LocationDraft) => Promise<boolean>;
    },
  ) {
    super(app);
    const e = options.existing;
    this.name = e?.name ?? "";
    this.kind = e?.kind ?? "warehouse";
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: this.options.existing ? "Editar ubicación" : "Nueva ubicación" });

    new Setting(contentEl).setName("Nombre").addText((t) => {
      t.setPlaceholder("Bodega principal").setValue(this.name).onChange((v) => (this.name = v));
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(contentEl).setName("Tipo").addDropdown((d) => {
      for (const kind of ["warehouse", "store", "external"] as const) {
        d.addOption(kind, LOCATION_KIND_LABEL[kind]);
      }
      d.setValue(this.kind).onChange((v) => (this.kind = v as InventoryLocationKind));
    });

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Guardar").setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    const draft: LocationDraft = { name: this.name.trim(), kind: this.kind };
    const problems = validateLocationDraft(draft).map((e) => e.message);
    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const message of problems) list.createEl("li", { text: message });
      return;
    }
    if (await this.options.onSubmit(draft)) this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

// ── Modal: nuevo traslado ────────────────────────────────────────────

export class TransferModal extends Modal {
  private date: string;
  private fromLocationId: string;
  private toLocationId: string;
  private reference = "";
  private lines: { productId: string; quantityRaw: string }[];

  private errorsEl!: HTMLElement;
  private linesEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly state: State;
      readonly locale: string;
      readonly onSubmit: (draft: {
        date: string;
        fromLocationId: string;
        toLocationId: string;
        reference?: string;
        lines: readonly StockTransferLine[];
      }) => Promise<boolean>;
    },
  ) {
    super(app);
    const locations = activeLocations(options.state);
    const products = this.transferableProducts();
    this.date = toIsoDate(new Date());
    this.fromLocationId = locations[0]?.id ?? "";
    this.toLocationId = locations.filter((l) => l.id !== this.fromLocationId)[0]?.id ?? "";
    this.lines = [{ productId: products[0]?.id ?? "", quantityRaw: "1" }];
  }

  /** Los combos no llevan existencia propia: no hay nada que trasladar. */
  private transferableProducts() {
    return activeProducts(this.options.state).filter((p) => !isKit(p));
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    contentEl.createEl("h3", { text: "Nuevo traslado" });

    new Setting(contentEl).setName("Fecha").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(this.date).onChange((v) => (this.date = v));
    });

    const locations = activeLocations(this.options.state);
    new Setting(contentEl).setName("Desde").addDropdown((d) => {
      for (const l of locations) d.addOption(l.id, l.name);
      d.setValue(this.fromLocationId).onChange((v) => {
        this.fromLocationId = v;
        this.rerenderToOptions();
        this.renderLines();
      });
    });

    this.toDropdown = null;
    new Setting(contentEl).setName("Hacia").addDropdown((d) => {
      for (const l of locations) if (l.id !== this.fromLocationId) d.addOption(l.id, l.name);
      d.setValue(this.toLocationId).onChange((v) => (this.toLocationId = v));
      this.toDropdown = d;
    });

    new Setting(contentEl)
      .setName("Referencia")
      .setDesc("Opcional. Ej.: «Reabastecer piso de venta».")
      .addText((t) => t.setPlaceholder("Motivo del traslado").setValue(this.reference).onChange((v) => (this.reference = v)));

    contentEl.createEl("h4", { text: "Líneas", cls: "octa-group" });
    this.linesEl = contentEl.createDiv();
    this.renderLines();

    const addRow = contentEl.createDiv({ cls: "octa-add-line" });
    addRow.createEl("button", { text: "+ Línea" }).onclick = () => {
      const first = this.transferableProducts()[0];
      this.lines.push({ productId: first?.id ?? "", quantityRaw: "1" });
      this.renderLines();
    };

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Guardar traslado").setCta().onClick(() => void this.submit()));
  }

  override onOpen(): void {
    this.render();
  }

  private toDropdown: DropdownComponent | null = null;

  private rerenderToOptions(): void {
    const select = this.toDropdown?.selectEl;
    if (!select) return;
    const locations = activeLocations(this.options.state).filter(
      (l) => l.id !== this.fromLocationId,
    );
    const previous = this.toLocationId;
    if (previous === this.fromLocationId || !locations.some((l) => l.id === previous)) {
      this.toLocationId = locations[0]?.id ?? "";
    }
    select.empty();
    for (const l of locations) {
      select.createEl("option", { value: l.id, text: l.name });
    }
    select.value = this.toLocationId;
  }

  private renderLines(): void {
    this.linesEl.empty();
    const products = this.transferableProducts();

    if (products.length === 0) {
      this.linesEl.createEl("p", {
        cls: "octa-empty",
        text: "No hay productos activos para trasladar. Creá productos primero.",
      });
      return;
    }

    const wrap = this.linesEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table octa-lines" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Producto", "Cantidad", "Disponible", ""]) {
      head.createEl("th", { text: label });
    }
    const tbody = table.createEl("tbody");

    this.lines.forEach((line, index) => {
      const row = tbody.createEl("tr");

      const select = row.createEl("td").createEl("select", { cls: "dropdown" });
      for (const product of products) {
        select.createEl("option", { value: product.id, text: product.name });
      }
      select.value = line.productId;
      select.onchange = () => {
        line.productId = select.value;
        this.updateAvailability(row, line);
      };

      const qtyCell = row.createEl("td");
      const qty = qtyCell.createEl("input", { cls: "octa-cell-narrow" });
      qty.type = "text";
      qty.inputMode = "decimal";
      qty.value = line.quantityRaw;
      qty.oninput = () => {
        line.quantityRaw = qty.value;
        this.updateAvailability(row, line);
      };

      const avail = row.createEl("td", { cls: "octa-num" });
      this.updateAvailability(row, line, avail);

      const actions = row.createEl("td", { cls: "octa-actions" });
      const remove = actions.createEl("button", { text: "×" });
      remove.onclick = () => {
        this.lines.splice(index, 1);
        this.renderLines();
      };
    });
  }

  private updateAvailability(row: HTMLElement, line: { productId: string; quantityRaw: string }, cell?: HTMLElement): void {
    const availCell = cell ?? row.querySelector<HTMLElement>("td:nth-child(3)");
    if (!availCell) return;
    availCell.empty();
    if (!line.productId || !this.fromLocationId) {
      availCell.setText("—");
      return;
    }
    const available = locationStock(this.options.state, this.fromLocationId, line.productId);
    const quantity = Number(line.quantityRaw);
    const span = availCell.createSpan({
      cls: Number.isFinite(quantity) && quantity > available ? "octa-invalid" : "",
      text: String(available),
    });
    if (Number.isFinite(quantity) && quantity > available) {
      availCell.createDiv({ cls: "octa-subtle", text: "supera el disponible" });
    }
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    const problems: string[] = [];

    const lines: StockTransferLine[] = this.lines
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantityRaw) }))
      .filter((l) => l.productId !== "");

    // Fecha/origen/destino/líneas/cantidad los valida el dominio via validateTransferDraft
    // (abajo). La vista solo agrega la regla de negocio que el dominio no conoce: stock.
    for (const line of lines) {
      const product = this.options.state.products.get(line.productId);
      const available = this.fromLocationId
        ? locationStock(this.options.state, this.fromLocationId, line.productId)
        : 0;
      if (this.fromLocationId && Number.isFinite(line.quantity) && line.quantity > available) {
        problems.push(`Solo hay ${available} de ${product?.name ?? line.productId} en el origen`);
      }
    }

    const draft: TransferDraft = {
      date: this.date,
      fromLocationId: this.fromLocationId,
      toLocationId: this.toLocationId,
      ...(this.reference.trim() ? { reference: this.reference.trim() } : {}),
      lines,
    };
    problems.push(...validateTransferDraft(draft).map((e) => e.message));

    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const message of problems) list.createEl("li", { text: message });
      return;
    }

    if (await this.options.onSubmit(draft)) this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

// ── Modal: detalle de un traslado ────────────────────────────────────

export class TransferDetailModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      readonly transfer: StockTransfer;
      readonly state: State;
    },
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("octa-wide-modal");
    contentEl.empty();
    contentEl.addClass("octa");

    const { transfer, state } = this.options;
    const from = locationById(state, transfer.fromLocationId)?.name ?? transfer.fromLocationId;
    const to = locationById(state, transfer.toLocationId)?.name ?? transfer.toLocationId;

    contentEl.createEl("h3", { text: `Traslado del ${transfer.date}` });
    contentEl.createEl("p", {
      cls: "octa-subtle",
      text: `${from} → ${to}${transfer.reference ? ` · ${transfer.reference}` : ""}`,
    });

    const wrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Producto", "Cantidad"]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const line of transfer.lines) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: state.products.get(line.productId)?.name ?? line.productId });
      row.createEl("td", { text: String(line.quantity), cls: "octa-num" });
    }

    new Setting(contentEl).addButton((b) => b.setButtonText("Cerrar").onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}