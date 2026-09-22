import {
  activeProducts,
  format,
  generateId,
  money,
  roundHalfUp,
  validatePricelistDraft,
  type Pricelist,
  type PricelistDraft,
} from "@octasuite/core";
import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import type { PluginHost } from "./host.js";
import { ConfirmModal } from "./confirm-modal.js";

/**
 * Gestor de listas de precios (dual pricing, B-03).
 *
 * Una lista ajusta el precio de VENTA de un cliente al facturar:
 * - `factorBps` global: Ajuste en % sobre el precio de lista (-10 = descuento,
 *   12.5 = sobrecosto). Internamente se guarda en bps: 10000 = 1.0.
 * - `overrides`: precio exacto por producto (manda sobre el factor).
 *
 * El modal es un listado + editor simple, sin vista propia: se abre desde la
 * barra de Productos (botón "Precios"). Las escrituras van al catalogo del
 * vault (`VaultPricelists`); las facturas que se emitan después leen la
 * versión guardada.
 */

const PERCENT_RE = /^\s*(-?\d+(?:[.,]\d+)?)\s*%?\s*$/;

/** "-10" => 9000 (10% menos); "12.5" => 11250 (sobrecosto); vacío/inválido => undefined. */
function percentToFactorBps(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const match = PERCENT_RE.exec(raw);
  if (!match) return undefined;
  const percent = Number(match[1]?.replace(",", "."));
  if (!Number.isFinite(percent)) return undefined;
  return roundHalfUp(10000 + percent * 100);
}

/** Inverso de `percentToFactorBps` para precargar el input al editar. */
function factorBpsToPercent(bps: number | undefined): string {
  if (bps === undefined) return "";
  return String((bps - 10000) / 100).replace(".", ",");
}

interface EditorState {
  id: string;
  name: string;
  factorBps?: number;
  overrides: { productId: string; priceMinor: string }[];
}

export class PricelistManagerModal extends Modal {
  private editing: EditorState | null = null;
  private pricelists: Pricelist[] = [];

  constructor(app: App, private readonly host: PluginHost) {
    super(app);
  }

  override async onOpen(): Promise<void> {
    this.pricelists = await this.host.pricelists.load();
    this.render();
  }

  private render(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("octa-wide-modal");
    contentEl.empty();
    contentEl.addClass("octa");

    if (this.editing) return this.renderEditor();

    contentEl.createEl("h3", { text: "Listas de precios" });
    contentEl.createEl("p", {
      cls: "octa-muted",
      text: "Ajustan el precio de venta por cliente al facturar. Se asignan desde Contactos.",
    });

    const tools = contentEl.createDiv({ cls: "octa-tools" });
    tools.createEl("button", { text: "+ Nueva lista", cls: "mod-cta" }).onclick = () => {
      this.editing = { id: "", name: "", factorBps: undefined, overrides: [] };
      this.render();
    };

    const list = contentEl.createDiv({ cls: "octa-pricelist-list" });
    if (this.pricelists.length === 0) {
      list.createEl("p", { cls: "octa-muted", text: "Todavía no hay listas." });
      return;
    }
    for (const pl of this.pricelists) this.card(list, pl);
    new Setting(contentEl).addButton((b) => b.setButtonText("Cerrar").onClick(() => this.close()));
  }

  private card(container: HTMLElement, pl: Pricelist): void {
    const card = container.createDiv({ cls: "octa-card" });
    const head = card.createDiv({ cls: "octa-card-head" });
    head.createEl("strong", { text: pl.name });
    head.createEl("span", {
      cls: "octa-muted",
      text: pl.factorBps
        ? `${pl.factorBps < 10000 ? "•" : "+"}${Math.abs(pl.factorBps - 10000) / 100}% sobre lista`
        : "Precio de lista sin ajuste global",
    });
    const actions = head.createDiv({ cls: "octa-actions" });
    const edit = actions.createEl("button", { attr: { "aria-label": "Editar lista" } });
    setIcon(edit, "pencil");
    if (edit.childElementCount === 0) edit.setText("Editar");
    edit.onclick = () => {
      this.editing = {
        id: pl.id,
        name: pl.name,
        factorBps: pl.factorBps,
        overrides: pl.overrides.map((o) => ({ productId: o.productId, priceMinor: String(o.priceMinor) })),
      };
      this.render();
    };
    const del = actions.createEl("button", { attr: { "aria-label": "Borrar lista" } });
    setIcon(del, "trash-2");
    if (del.childElementCount === 0) del.setText("Borrar");
    del.onclick = () => {
      new ConfirmModal(this.app, {
        title: `Borrar «${pl.name}»`,
        body: "Los clientes que la usan volverán al precio de lista.",
        confirmText: "Borrar",
        onConfirm: async () => {
          await this.host.pricelists.remove(pl.id);
          this.pricelists = await this.host.pricelists.load();
          this.render();
          new Notice(`Lista «${pl.name}» eliminada`);
        },
      }).open();
    };

    if (pl.overrides.length > 0) {
      const rows = card.createEl("ul", { cls: "octa-pricelist-overrides" });
      for (const override of pl.overrides) {
        const product = this.host.state.products.get(override.productId);
        const item = rows.createEl("li");
        item.createEl("span", { text: product?.name ?? override.productId });
        item.createEl("span", {
          cls: "octa-num",
          text: format(money(override.priceMinor, product?.salePrice.currency ?? "GTQ"), this.host.settings.locale),
        });
      }
    }
  }

  private renderEditor(): void {
    const { contentEl } = this;
    const state = this.editing;
    if (!state) return;
    const isNew = state.id === "";
    contentEl.createEl("h3", { text: isNew ? "Nueva lista de precios" : `Editar: ${state.name}` });

    new Setting(contentEl)
      .setName("Nombre")
      .setDesc("Aparece al asignarla a un cliente (Contactos).")
      .addText((t) => t.setValue(state.name).onChange((v) => (state.name = v)));

    new Setting(contentEl)
      .setName("Ajuste global")
      .setDesc("Descuento (-10) o sobrecosto (10) en % sobre el precio de lista. Vacío = sin ajuste.")
      .addText((t) =>
        t
          .setValue(factorBpsToPercent(state.factorBps))
          .setPlaceholder("ej. -10")
          .onChange((v) => (state.factorBps = percentToFactorBps(v))),
      );

    contentEl.createEl("h4", { text: "Precios por producto (opcional)", cls: "octa-group" });
    const products = activeProducts(this.host.state);
    const overridesEl = contentEl.createDiv({ cls: "octa-field-group" });

    const renderOverrides = (): void => {
      overridesEl.empty();
      state.overrides.forEach((override, index) => {
        const row = overridesEl.createDiv({ cls: "octa-inline-row" });
        const select = row.createEl("select", { cls: "dropdown" });
        select.createEl("option", { value: "", text: "— producto —" });
        for (const product of products) select.createEl("option", { value: product.id, text: product.name });
        select.value = override.productId;
        select.onchange = () => {
          override.productId = select.value;
          renderOverrides();
        };
        const product = products.find((p) => p.id === override.productId);
        const price = row.createEl("input", {
          cls: "octa-cell-input",
          attr: { type: "number", min: "0", step: "0.01", placeholder: product ? format(product.salePrice, this.host.settings.locale) : "Precio" },
        });
        price.value = override.priceMinor !== "" ? String(Number(override.priceMinor) / 100) : "";
        price.oninput = () => {
          override.priceMinor = String(roundHalfUp(Number(price.value) * 100));
        };
        const remove = row.createEl("button", { attr: { "aria-label": "Quitar" } });
        setIcon(remove, "x");
        if (remove.childElementCount === 0) remove.setText("×");
        remove.onclick = () => {
          state.overrides.splice(index, 1);
          renderOverrides();
        };
      });
      if (products.length === 0) {
        overridesEl.createEl("p", { cls: "octa-muted", text: "Crea productos antes de fijar precios por producto." });
      }
    };
    renderOverrides();

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("+ Producto").onClick(() => {
        state.overrides.push({ productId: "", priceMinor: "" });
        renderOverrides();
      }),
    );

    const errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });
    const submit = (): void => {
      void (async () => {
        const overrides = state.overrides
          .filter((o) => o.productId !== "")
          .map((o) => ({ productId: o.productId, priceMinor: o.priceMinor === "" ? 0 : Number(o.priceMinor) }));
        const draft: PricelistDraft = { name: state.name.trim(), factorBps: state.factorBps, overrides };
        const problems = validatePricelistDraft(draft);
        errorsEl.empty();
        for (const problem of problems) errorsEl.createEl("p", { text: problem.message });
        if (problems.length > 0) return;

        const now = new Date().toISOString();
        const existing = this.pricelists.find((p) => p.id === state.id);
        const saved: Pricelist = {
          id: state.id || generateId("pl"),
          name: draft.name,
          factorBps: draft.factorBps,
          overrides,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        await this.host.pricelists.save(saved);
        this.pricelists = await this.host.pricelists.load();
        this.editing = null;
        this.render();
        new Notice(`Lista «${saved.name}» guardada`);
      })();
    };

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Cancelar").onClick(() => {
          this.editing = null;
          void this.reload();
        }),
      )
      .addButton((b) => b.setButtonText("Guardar").setCta().onClick(submit));
  }

  private async reload(): Promise<void> {
    this.pricelists = await this.host.pricelists.load();
    this.render();
  }
}