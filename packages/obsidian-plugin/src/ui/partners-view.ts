import {
  activePartners,
  creditAccountByPartner,
  format,
  generateId,
  invoiceCountForPartner,
  isValidNit,
  zero,
  type Partner,
  type PartnerDraft,
} from "@octasuite/core";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { PARTNERS_VIEW_TYPE } from "../modules.js";
import { ConfirmModal } from "./confirm-modal.js";
import type { PluginHost } from "./host.js";
import { moduleHeader } from "./nav.js";
import { PartnerModal } from "./partner-modal.js";
import { AmountModal } from "./register-modals.js";

const TYPE_LABEL: Record<string, string> = {
  individual: "Persona",
  company: "Empresa",
  address: "Dirección",
};

export class PartnersView extends ItemView {
  private filter = "";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return PARTNERS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Contactos";
  }

  override getIcon(): string {
    return "users";
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private matches(partner: Partner): boolean {
    if (this.filter === "") return true;
    const needle = this.filter.toLowerCase();
    return [partner.name, partner.taxId, partner.email, partner.phone, partner.mobile, partner.city]
      .filter((v): v is string => typeof v === "string")
      .some((v) => v.toLowerCase().includes(needle));
  }

  private render(): void {
    const { contentEl } = this;
    const { state } = this.host;
    contentEl.empty();
    contentEl.addClass("octa");

    const bar = moduleHeader(contentEl, "Contactos", this.host, this.app, this.leaf, PARTNERS_VIEW_TYPE);
    const tools = bar.createDiv({ cls: "octa-period" });
    const search = tools.createEl("input", { cls: "octa-search" });
    search.type = "search";
    search.placeholder = "Buscar nombre, NIT, correo…";
    search.value = this.filter;
    search.oninput = () => {
      this.filter = search.value.trim();
      this.renderList();
    };
    tools.createEl("button", { text: "+ Contacto", cls: "mod-cta" }).onclick = () => this.openEditor();

    contentEl.createDiv({ cls: "octa-list-slot" });
    this.renderList();

    const all = activePartners(state);
    if (all.length === 0) return;
    const withoutNit = all.filter((p) => p.accountType !== "address" && !p.taxId).length;
    if (withoutNit > 0) {
      const warn = contentEl.createDiv({ cls: "octa-warning" });
      warn.createEl("strong", { text: "Sin NIT" });
      warn.createEl("p", {
        text: `${withoutNit} contacto(s) no tienen NIT. No se les puede emitir factura hasta registrarlo (o usar CF).`,
      });
    }
  }

  /** Solo la lista se vuelve a dibujar al filtrar: la barra conserva el foco. */
  private renderList(): void {
    const slot = this.contentEl.querySelector<HTMLElement>(".octa-list-slot");
    if (!slot) return;
    slot.empty();

    const partners = activePartners(this.host.state).filter((p) => this.matches(p));

    if (partners.length === 0) {
      slot.createEl("p", {
        cls: "octa-empty",
        text: this.filter ? `Ningún contacto coincide con «${this.filter}».` : "Todavía no hay contactos.",
      });
      return;
    }

    const wrap = slot.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Nombre", "Tipo", "NIT", "Contacto", "Ciudad", ""]) head.createEl("th", { text: label });

    const tbody = table.createEl("tbody");
    for (const partner of partners) this.row(tbody, partner);
  }

  private row(tbody: HTMLElement, partner: Partner): void {
    const row = tbody.createEl("tr");

    const nameCell = row.createEl("td");
    nameCell.createSpan({ text: partner.name });
    if (partner.parentId) {
      const parent = this.host.state.partners.get(partner.parentId);
      if (parent) nameCell.createDiv({ cls: "octa-subtle", text: `de ${parent.name}` });
    }
    const account = creditAccountByPartner(this.host.state, partner.id);
    const balances = account
      ? [...account.balances.entries()].filter(([, m]) => m.minor > 0)
      : [];
    if (balances.length > 0) {
      nameCell.createDiv({ cls: "octa-subtle", text: `crédito: ${balances.map(([, m]) => format(m)).join(" + ")}` });
    }

    row.createEl("td").createSpan({ cls: "octa-chip", text: TYPE_LABEL[partner.accountType] ?? partner.accountType });

    const nitCell = row.createEl("td", { cls: "octa-mono" });
    if (!partner.taxId) {
      nitCell.createSpan({ cls: "octa-subtle", text: "—" });
    } else {
      nitCell.setText(partner.taxId);
      // El NIT pudo haber entrado antes de que existiera la validación.
      if (!isValidNit(partner.taxId)) {
        nitCell.addClass("octa-invalid");
        nitCell.setAttribute("aria-label", "Dígito verificador incorrecto");
      }
    }

    const contact = [partner.email, partner.mobile ?? partner.phone].filter(Boolean).join(" · ");
    row.createEl("td", { text: contact || "—" });
    row.createEl("td", { text: partner.city ?? "—" });

    const actions = row.createEl("td", { cls: "octa-actions" });
    actions.createEl("button", { text: "Editar" }).onclick = () => this.openEditor(partner);
    actions.createEl("button", { text: "Crédito" }).onclick = () => this.openCredit(partner);
    actions.createEl("button", { text: "Archivar" }).onclick = () => this.confirmArchive(partner);
  }

  private openCredit(partner: Partner): void {
    const { settings, state } = this.host;
    const account = creditAccountByPartner(state, partner.id);
    const current = account?.balances.get(settings.currency) ?? zero(settings.currency);
    new AmountModal(this.app, {
      title: `Abonar crédito · ${partner.name}`,
      amountLabel: "Abono",
      amountDesc: `Saldo actual: ${format(current, settings.locale)}`,
      reasonLabel: "Nota",
      confirmText: "Abonar",
      currency: settings.currency,
      onSubmit: async ({ amount, reason }) => {
        const ok = await this.host.commit(
          this.host.newEvent("credit.added", {
            accountId: account?.id ?? generateId("crd"),
            partnerId: partner.id,
            partnerName: partner.name,
            amount,
            note: reason || "Abono manual",
          }),
        );
        if (ok) {
          new Notice(`${partner.name} · abono ${format(amount, settings.locale)}`);
          this.renderList();
        }
      },
    }).open();
  }

  private openEditor(existing?: Partner): void {
    new PartnerModal(this.app, {
      host: this.host,
      ...(existing ? { existing } : {}),
      candidates: activePartners(this.host.state),
      onSubmit: async (draft) => {
        const ok = existing ? await this.update(existing, draft) : await this.create(draft);
        if (ok) new Notice(existing ? `${draft.name} actualizado` : `${draft.name} agregado`);
      },
    }).open();
  }

  private create(draft: PartnerDraft): Promise<boolean> {
    return this.host.commit(this.host.newEvent("partner.created", { partnerId: generateId("par"), ...draft }));
  }

  private update(existing: Partner, draft: PartnerDraft): Promise<boolean> {
    return this.host.commit(
      this.host.newEvent("partner.updated", { partnerId: existing.id, changes: draft }),
    );
  }

  private confirmArchive(partner: Partner): void {
    const documents = invoiceCountForPartner(this.host.state, partner.id);
    const body =
      documents > 0
        ? `${partner.name} tiene ${documents} documento(s) emitidos. Archivarlo lo saca de las listas; los documentos ya emitidos no cambian, porque guardan los datos del cliente tal como estaban al emitir.`
        : `${partner.name} sale de las listas. El histórico se conserva y se puede recuperar del journal.`;

    new ConfirmModal(this.app, {
      title: "Archivar contacto",
      body,
      confirmText: "Archivar",
      destructive: true,
      onConfirm: async () => {
        const ok = await this.host.commit(this.host.newEvent("partner.archived", { partnerId: partner.id }));
        if (ok) new Notice(`${partner.name} archivado`);
      },
    }).open();
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}
