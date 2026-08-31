import { activePartners, generateId, type Partner } from "@octasuite/core";
import { App } from "obsidian";
import type { PluginHost } from "./host.js";
import { PartnerModal } from "./partner-modal.js";

/**
 * Buscar cliente por NIT o nombre, con creación inline si no aparece.
 *
 * En OctaSuite real (`PosRegister.php`) la búsqueda de caja sí incluye el NIT
 * junto a nombre/correo/teléfono, y si no hay coincidencia local intenta el
 * SAT vía Infile para autocompletar — pero el punto de venta **no tiene**
 * ningún formulario manual de alta; si el SAT no responde, no hay salida sin
 * salir a Contactos. Acá no hay SAT (el plugin es offline por diseño), así que
 * se reemplaza esa segunda mitad por la creación inline que el ERP no tiene:
 * si nadie coincide, se crea sin soltar el cobro o la factura que se está
 * armando.
 *
 * Vive en su propio contenedor: solo ese `<div>` se vuelve a dibujar al
 * escribir o seleccionar, para no perder el foco ni el resto del formulario
 * que lo rodea.
 */

/** Aproximación de «esto parece un NIT», solo para decidir qué precargar al crear. */
const LOOKS_LIKE_NIT = /^\d{4,16}-?[\dkK]$/;

const MAX_RESULTS = 8;

function matches(partner: Partner, needle: string): boolean {
  if (needle === "") return true;
  const n = needle.toLowerCase();
  return [partner.name, partner.taxId, partner.email, partner.phone, partner.mobile, partner.city]
    .filter((v): v is string => typeof v === "string")
    .some((v) => v.toLowerCase().includes(n));
}

export class CustomerPicker {
  private query = "";
  private searching = false;
  private selected: Partner | undefined;

  constructor(
    private readonly app: App,
    private readonly host: PluginHost,
    private readonly container: HTMLElement,
    initialPartnerId: string | undefined,
    private readonly onChange: (partner: Partner | undefined) => void,
  ) {
    this.selected = initialPartnerId ? host.state.partners.get(initialPartnerId) : undefined;
  }

  render(): void {
    this.container.empty();
    this.container.addClass("octa-customer-picker");
    if (this.searching) this.renderSearch();
    else this.renderSelected();
  }

  private renderSelected(): void {
    const row = this.container.createDiv({ cls: "octa-customer-selected" });
    const info = row.createDiv();
    info.createDiv({ text: this.selected?.name ?? "Consumidor final" });
    info.createDiv({ cls: "octa-subtle", text: this.selected?.taxId ?? "CF" });
    row.createEl("button", { text: "Cambiar" }).onclick = () => {
      this.searching = true;
      this.query = "";
      this.render();
    };
  }

  private renderSearch(): void {
    const bar = this.container.createDiv({ cls: "octa-customer-search-bar" });
    const input = bar.createEl("input", { cls: "octa-search" });
    input.type = "search";
    input.placeholder = "Buscar por NIT o nombre…";
    input.value = this.query;
    window.setTimeout(() => input.focus(), 0);
    input.oninput = () => {
      this.query = input.value;
      this.renderResults();
    };
    bar.createEl("button", { text: "Cancelar" }).onclick = () => {
      this.searching = false;
      this.render();
    };

    this.container.createDiv({ cls: "octa-customer-results" });
    this.renderResults();
  }

  private renderResults(): void {
    const results = this.container.querySelector<HTMLElement>(".octa-customer-results");
    if (!results) return;
    results.empty();

    const needle = this.query.trim();
    const candidates = activePartners(this.host.state).filter((p) => p.accountType !== "address");
    const matched = candidates.filter((p) => matches(p, needle)).slice(0, MAX_RESULTS);

    // Consumidor final siempre disponible, primero, para volver fácil a lo anónimo.
    if (matches({ name: "Consumidor final", taxId: "CF" } as Partner, needle)) {
      const row = results.createEl("button", { cls: "octa-customer-row" });
      row.createDiv({ text: "Consumidor final" });
      row.createDiv({ cls: "octa-subtle", text: "CF" });
      row.onclick = () => this.pick(undefined);
    }

    for (const partner of matched) {
      const row = results.createEl("button", { cls: "octa-customer-row" });
      row.createDiv({ text: partner.name });
      row.createDiv({ cls: "octa-subtle", text: partner.taxId ?? "sin NIT" });
      row.onclick = () => this.pick(partner);
    }

    if (needle !== "" && matched.length === 0) {
      results.createDiv({ cls: "octa-empty", text: `Nadie coincide con «${needle}».` });
    }

    const create = results.createEl("button", { cls: "octa-customer-create" });
    create.createSpan({ text: "+ Registrar cliente nuevo" });
    create.onclick = () => this.openCreate(needle);
  }

  private pick(partner: Partner | undefined): void {
    this.selected = partner;
    this.searching = false;
    this.onChange(partner);
    this.render();
  }

  private openCreate(query: string): void {
    const trimmed = query.trim();
    const prefill = trimmed === "" ? undefined : LOOKS_LIKE_NIT.test(trimmed) ? { taxId: trimmed } : { name: trimmed };

    new PartnerModal(this.app, {
      ...(prefill ? { prefill } : {}),
      candidates: activePartners(this.host.state),
      onSubmit: async (draft) => {
        const partnerId = generateId("par");
        const ok = await this.host.commit(this.host.newEvent("partner.created", { partnerId, ...draft }));
        if (ok) this.pick(this.host.state.partners.get(partnerId));
      },
    }).open();
  }
}
