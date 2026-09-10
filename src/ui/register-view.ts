import {
  activeProducts,
  computeInvoiceTotals,
  creditAccountByPartner,
  creditBalanceFor,
  format,
  generateId,
  isConfigurable,
  LocalNumberAuthority,
  movementsOf,
  openShift,
  shiftSummary,
  shiftsOf,
  toIsoDate,
  totalsSnapshot,
  zero,
  type InvoiceLine,
  type OptionSelection,
  type Product,
  type Shift,
} from "@octasuite/core";
import { ItemView, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import { REGISTER_VIEW_TYPE } from "../modules.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";
import { PAYMENT_METHODS } from "./payment-modal.js";
import { AmountModal, CheckoutModal, ChoiceModal, CloseShiftModal, MOVEMENT_IN, MOVEMENT_OUT } from "./register-modals.js";

interface CartItem {
  readonly product: Product;
  quantity: number;
  readonly selections: OptionSelection[];
  /** Distingue dos veces el mismo combo con carnes distintas. */
  readonly key: string;
}

export class RegisterView extends ItemView {
  private cart: CartItem[] = [];
  private category = "";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return REGISTER_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Caja";
  }

  override getIcon(): string {
    return "shopping-cart";
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");

    const bar = moduleHeader(contentEl, "Caja", this.host, this.app, this.leaf, REGISTER_VIEW_TYPE);
    const shift = openShift(this.host.state);

    const tools = bar.createDiv({ cls: "octa-period" });
    if (shift) {
      tools.createEl("button", { text: "Ingreso" }).onclick = () => this.moveCash("in");
      tools.createEl("button", { text: "Retiro" }).onclick = () => this.moveCash("out");
      tools.createEl("button", { text: "Cerrar caja", cls: "mod-warning" }).onclick = () => this.closeShift(shift);
    } else {
      tools.createEl("button", { text: "Abrir caja", cls: "mod-cta" }).onclick = () => this.openShiftDialog();
    }

    if (!shift) {
      this.renderClosed(contentEl);
      return;
    }

    this.renderShiftStrip(contentEl, shift);

    const layout = contentEl.createDiv({ cls: "octa-pos" });
    this.renderCatalog(layout.createDiv({ cls: "octa-pos-catalog" }));
    this.renderCart(layout.createDiv({ cls: "octa-pos-cart" }));
  }

  // --- Turno ---------------------------------------------------------------

  private renderClosed(parent: HTMLElement): void {
    const { settings, state } = this.host;
    parent.createEl("p", {
      cls: "octa-empty",
      text: "No hay turno abierto. Abrí la caja con el fondo inicial para empezar a cobrar.",
    });

    const today = shiftsOf(state, toIsoDate(new Date()));
    if (today.length === 0) return;

    parent.createEl("h3", { text: "Turnos de hoy", cls: "octa-group" });
    const wrap = parent.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Abierto", "Cerrado", "Documentos", "Esperado", "Contado", "Diferencia"]) {
      head.createEl("th", { text: label });
    }
    const tbody = table.createEl("tbody");
    for (const shift of today) {
      const summary = shiftSummary(state, shift.id, settings.currency);
      if (!summary) continue;
      const row = tbody.createEl("tr");
      row.createEl("td", { text: shift.openedAt.slice(11, 16), cls: "octa-mono" });
      row.createEl("td", { text: shift.closedAt?.slice(11, 16) ?? "—", cls: "octa-mono" });
      row.createEl("td", { text: String(summary.ticketCount), cls: "octa-num" });
      row.createEl("td", { text: format(summary.expected, settings.locale), cls: "octa-num" });
      row.createEl("td", { text: summary.counted ? format(summary.counted, settings.locale) : "—", cls: "octa-num" });
      const diff = row.createEl("td", { cls: "octa-num" });
      if (!summary.difference) diff.createSpan({ cls: "octa-subtle", text: "—" });
      else {
        const value = summary.difference.minor;
        diff.createSpan({
          cls: value === 0 ? "" : "octa-invalid",
          text: `${value > 0 ? "+" : ""}${format(summary.difference, settings.locale)}`,
        });
      }
    }
  }

  private renderShiftStrip(parent: HTMLElement, shift: Shift): void {
    const { settings, state } = this.host;
    const summary = shiftSummary(state, shift.id, settings.currency);
    if (!summary) return;

    const kpis = parent.createDiv({ cls: "octa-kpis" });
    const tile = (label: string, value: string, hint?: string) => {
      const el = kpis.createDiv({ cls: "octa-kpi" });
      el.createDiv({ cls: "octa-kpi-label", text: label });
      el.createDiv({ cls: "octa-kpi-value", text: value });
      if (hint) el.createDiv({ cls: "octa-kpi-hint", text: hint });
    };
    tile("Turno abierto", shift.openedAt.slice(11, 16), `fondo ${format(summary.openingFloat, settings.locale)}`);
    tile("Documentos", String(summary.ticketCount));
    tile("Ventas en efectivo", format(summary.cashSales, settings.locale));
    tile("Esperado en cajón", format(summary.expected, settings.locale), "solo efectivo");

    const movements = movementsOf(state, shift.id);
    if (movements.length > 0) {
      const list = parent.createDiv({ cls: "octa-subtle" });
      for (const movement of movements) {
        list.createDiv({
          text: `${movement.at.slice(11, 16)} · ${movement.kind === "in" ? "+" : "−"}${format(movement.amount, settings.locale)} · ${movement.reason}`,
        });
      }
    }
  }

  private openShiftDialog(): void {
    new AmountModal(this.app, {
      title: "Abrir caja",
      amountLabel: "Fondo de apertura",
      amountDesc: "El efectivo con el que arranca el cajón.",
      reasonLabel: "Nota",
      confirmText: "Abrir turno",
      currency: this.host.settings.currency,
      defaultAmount: "0.00",
      onSubmit: async ({ amount, reason }) => {
        const ok = await this.host.commit(
          this.host.newEvent("register.opened", {
            shiftId: generateId("trn"),
            date: toIsoDate(new Date()),
            openingFloat: amount,
            ...(reason.trim() ? { notes: reason.trim() } : {}),
          }),
        );
        if (ok) new Notice(`Caja abierta con ${format(amount, this.host.settings.locale)}`);
      },
    }).open();
  }

  private moveCash(kind: "in" | "out"): void {
    const shift = openShift(this.host.state);
    if (!shift) return;
    new AmountModal(this.app, {
      title: kind === "in" ? "Ingreso de efectivo" : "Retiro de efectivo",
      amountLabel: "Monto",
      reasons: kind === "in" ? MOVEMENT_IN : MOVEMENT_OUT,
      confirmText: "Registrar",
      currency: this.host.settings.currency,
      onSubmit: async ({ amount, reason }) => {
        const ok = await this.host.commit(
          this.host.newEvent("register.moved", {
            movementId: generateId("mov"),
            shiftId: shift.id,
            kind,
            amount,
            reason,
          }),
        );
        if (ok) new Notice(`${kind === "in" ? "Ingreso" : "Retiro"} registrado`);
      },
    }).open();
  }

  private closeShift(shift: Shift): void {
    const { settings, state } = this.host;
    const summary = shiftSummary(state, shift.id, settings.currency);
    if (!summary) return;

    if (this.cart.length > 0) {
      new Notice("Hay un carrito sin cobrar. Cobralo o vacialo antes de cerrar.");
      return;
    }

    new CloseShiftModal(this.app, {
      summary,
      currency: settings.currency,
      locale: settings.locale,
      onSubmit: async ({ counted, notes }) => {
        const ok = await this.host.commit(
          this.host.newEvent("register.closed", {
            shiftId: shift.id,
            countedCash: counted,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          }),
        );
        if (!ok) return;
        const diff = counted.minor - summary.expected.minor;
        const label = format({ minor: Math.abs(diff), currency: settings.currency }, settings.locale);
        new Notice(
          diff === 0
            ? "Turno cerrado. El arqueo cuadra."
            : `Turno cerrado. ${diff > 0 ? "Sobra" : "Falta"} ${label}.`,
          8000,
        );
      },
    }).open();
  }

  // --- Catálogo ------------------------------------------------------------

  private renderCatalog(parent: HTMLElement): void {
    const products = activeProducts(this.host.state);
    const categories = [...new Set(products.map((p) => p.categoryName ?? "Sin categoría"))].sort((a, b) =>
      a.localeCompare(b, "es"),
    );

    const chips = parent.createDiv({ cls: "octa-chips" });
    const chip = (label: string, value: string) => {
      const el = chips.createEl("button", {
        text: label,
        cls: `octa-filter-chip${this.category === value ? " is-active" : ""}`,
      });
      el.onclick = () => {
        this.category = value;
        this.render();
      };
    };
    chip("Todo", "");
    for (const category of categories) chip(category, category);

    const visible = this.category === "" ? products : products.filter((p) => (p.categoryName ?? "Sin categoría") === this.category);

    const grid = parent.createDiv({ cls: "octa-pos-grid" });
    if (visible.length === 0) {
      parent.createEl("p", { cls: "octa-empty", text: "No hay productos en esta categoría." });
      return;
    }
    for (const product of visible) {
      const button = grid.createEl("button", { cls: "octa-pos-item" });
      button.createDiv({ cls: "octa-pos-item-name", text: product.name });
      button.createDiv({
        cls: "octa-pos-item-price",
        text: format(product.salePrice, this.host.settings.locale),
      });
      if (isConfigurable(product)) {
        button.createDiv({ cls: "octa-subtle", text: product.options!.map((o) => `${o.quantity} ${o.label}`).join(" · ") });
      }
      button.onclick = () => this.addToCart(product);
    }
  }

  private addToCart(product: Product): void {
    if (isConfigurable(product)) {
      new ChoiceModal(this.app, {
        product,
        state: this.host.state,
        onSubmit: (selections) => this.pushItem(product, selections),
      }).open();
      return;
    }
    this.pushItem(product, []);
  }

  private pushItem(product: Product, selections: OptionSelection[]): void {
    // La clave incluye las elecciones: dos combos con carnes distintas son
    // líneas distintas, aunque sean el mismo producto.
    const key = `${product.id}::${selections
      .map((s) => `${s.label}:${s.productId}:${s.quantity}`)
      .sort()
      .join("|")}`;
    const existing = this.cart.find((item) => item.key === key);
    if (existing) existing.quantity += 1;
    else this.cart.push({ product, quantity: 1, selections, key });
    this.render();
  }

  // --- Carrito -------------------------------------------------------------

  private renderCart(parent: HTMLElement): void {
    const { settings, state } = this.host;
    parent.createEl("h3", { text: "Cuenta", cls: "octa-group" });

    if (this.cart.length === 0) {
      parent.createEl("p", { cls: "octa-empty", text: "Tocá un producto para agregarlo." });
      return;
    }

    for (const item of this.cart) {
      const row = parent.createDiv({ cls: "octa-cart-row" });
      const left = row.createDiv({ cls: "octa-cart-main" });
      left.createDiv({ text: item.product.name });
      if (item.selections.length > 0) {
        const detail = item.selections
          .map((s) => `${s.quantity > 1 ? `${s.quantity}× ` : ""}${state.products.get(s.productId)?.name ?? "?"}`)
          .join(", ");
        left.createDiv({ cls: "octa-subtle", text: detail });
      }

      const controls = row.createDiv({ cls: "octa-cart-controls" });
      const minus = controls.createEl("button", { attr: { "aria-label": "Quitar uno" } });
      setIcon(minus, "minus");
      if (minus.childElementCount === 0) minus.setText("−");
      minus.onclick = () => {
        item.quantity -= 1;
        if (item.quantity <= 0) this.cart = this.cart.filter((i) => i !== item);
        this.render();
      };
      controls.createSpan({ cls: "octa-mono", text: String(item.quantity) });
      const plus = controls.createEl("button", { attr: { "aria-label": "Agregar uno" } });
      setIcon(plus, "plus");
      if (plus.childElementCount === 0) plus.setText("+");
      plus.onclick = () => {
        item.quantity += 1;
        this.render();
      };

      row.createDiv({
        cls: "octa-num",
        text: format({ minor: item.product.salePrice.minor * item.quantity, currency: settings.currency }, settings.locale),
      });
    }

    const totals = computeInvoiceTotals(this.cartLines(), settings.currency);
    const box = parent.createDiv({ cls: "octa-totals" });
    const row = (label: string, value: string, strong = false) => {
      const line = box.createDiv({ cls: "octa-total-row" });
      line.createSpan({ text: label });
      line.createSpan({ cls: strong ? "octa-num octa-strong" : "octa-num", text: value });
    };
    row("Base", format(totals.untaxed, settings.locale));
    for (const [rate, amount] of [...totals.taxByRate.entries()].sort((a, b) => a[0] - b[0])) {
      row(`IVA ${rate}%`, format(amount, settings.locale));
    }
    row("Total", format(totals.total, settings.locale), true);

    const actions = parent.createDiv({ cls: "octa-cart-actions" });
    actions.createEl("button", { text: "Vaciar" }).onclick = () => {
      this.cart = [];
      this.render();
    };
    actions.createEl("button", { text: "Cobrar", cls: "mod-cta" }).onclick = () => this.checkout();
  }

  private cartLines(): InvoiceLine[] {
    const { settings } = this.host;
    return this.cart.map((item) => ({
      description: item.product.name,
      quantity: item.quantity,
      unitPrice: item.product.salePrice,
      taxRate: item.product.taxRate ?? settings.defaultTaxRate,
      productId: item.product.id,
      ...(item.selections.length > 0 ? { selections: item.selections } : {}),
    }));
  }

  private checkout(): void {
    const { settings, state } = this.host;
    const shift = openShift(state);
    if (!shift) {
      new Notice("No hay turno abierto.");
      return;
    }
    const lines = this.cartLines();
    if (lines.length === 0) return;
    const totals = computeInvoiceTotals(lines, settings.currency);

    new CheckoutModal(this.app, {
      total: totals.total,
      host: this.host,
      methods: [...PAYMENT_METHODS, "Crédito"],
      defaultMethod: settings.defaultPaymentMethod,
      locale: settings.locale,
      onSubmit: async ({ partner, method }) => {
        // El crédito de cliente exige identificar a quien queda debiendo.
        if (method === "Crédito") {
          if (!partner) {
            new Notice("Seleccioná un cliente para cobrar a crédito.");
            return;
          }
          const available = creditBalanceFor(this.host.state, partner.id, settings.currency);
          if (available.minor < totals.total.minor) {
            new Notice(
              `Crédito insuficiente para ${partner.name}: disponible ${format(available, settings.locale)}, requerido ${format(totals.total, settings.locale)}.`,
            );
            return;
          }
        }

        const authority = new LocalNumberAuthority(
          (series) => this.host.state.lastNumberBySeries.get(series),
          "personal",
        );
        const reserved = await authority.reserve(settings.invoiceSeries);
        const invoiceId = generateId("inv");
        const now = new Date().toISOString();

        const issued = await this.host.commit(
          this.host.newEvent("invoice.issued", {
            invoiceId,
            series: settings.invoiceSeries,
            number: reserved.number,
            date: toIsoDate(new Date()),
            currency: settings.currency,
            lines,
            totals: totalsSnapshot(totals),
            partnerName: partner?.name ?? "Consumidor final",
            partnerTaxId: partner?.taxId ?? "CF",
            ...(partner ? { partnerId: partner.id } : {}),
          }),
        );
        if (!issued) return;

        // El crédito de cliente descuenta del saldo del cliente, no del cajón.
        if (method === "Crédito") {
          const account = creditAccountByPartner(this.host.state, partner!.id);
          if (!account) {
            new Notice("No hay cuenta de crédito para este cliente.");
            return;
          }
          const used = await this.host.commit(
            this.host.newEvent("credit.used", {
              accountId: account.id,
              amount: totals.total,
              reference: invoiceId,
              note: `${settings.invoiceSeries}-${String(reserved.number).padStart(4, "0")}`,
            }),
          );
          if (!used) return;
        }

        // El cobro carga el turno: sin eso el arqueo no sabría qué le pertenece.
        await this.host.commit(
          this.host.newEvent("invoice.paid", {
            invoiceId,
            paidAt: now,
            paymentMethod: method,
            shiftId: shift.id,
          }),
        );

        this.cart = [];
        this.render();
        new Notice(
          `${settings.invoiceSeries}-${String(reserved.number).padStart(4, "0")} · ${format(totals.total, settings.locale)} · ${method.toLowerCase()}`,
        );
      },
    }).open();
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}

/** Total vacío tipado, para cuando el carrito está sin líneas. */
export const emptyTotal = zero;
