import {
  activeLeads,
  pipelineSummary,
  generateId,
  STAGE_LABEL,
  SOURCE_LABEL,
  ACTIVE_STAGES,
  PIPELINE_STAGES,
  type Lead,
  type LeadDraft,
  type Stage,
  type State,
} from "@octasuite/core";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { LEADS_VIEW_TYPE } from "../modules.js";
import { ConfirmModal } from "./confirm-modal.js";
import type { PluginHost } from "./host.js";
import { LeadModal } from "./lead-modal.js";
import { moduleHeader } from "./nav.js";

const STAGE_COLORS: Record<Stage, string> = {
  nuevo: "#6c757d",
  contactado: "#0d6efd",
  calificado: "#6f42c1",
  propuesta: "#fd7e14",
  negociacion: "#ffc107",
  ganado: "#198754",
  perdido: "#dc3545",
};

export class LeadsView extends ItemView {
  private filter = "";
  private stageFilter: Stage | "all" = "all";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string { return LEADS_VIEW_TYPE; }
  override getDisplayText(): string { return "Prospectos"; }
  override getIcon(): string { return "trending-up"; }

  override async onOpen(): Promise<void> { this.render(); }
  refresh(): void { this.render(); }

  // ── Render principal ────────────────────────────────────────────────

  private render(): void {
    const { contentEl, host } = this;
    const { state } = host;
    contentEl.empty();
    contentEl.addClass("octa");

    // Header
    const bar = moduleHeader(contentEl, "Prospectos", host, this.app, this.leaf, LEADS_VIEW_TYPE);
    const tools = bar.createDiv({ cls: "octa-period" });
    const search = tools.createEl("input", { cls: "octa-search" });
    search.type = "search";
    search.placeholder = "Buscar nombre, empresa, contacto…";
    search.value = this.filter;
    search.oninput = () => { this.filter = search.value.trim(); this.renderTable(); };
    tools.createEl("button", { text: "+ Prospecto", cls: "mod-cta" }).onclick = () => this.openEditor();

    // KPIs
    const kpis = contentEl.createDiv({ cls: "octa-kpi-row" });
    const leads = activeLeads(state);
    const active = leads.filter((l) => l.status === "active");
    const won = leads.filter((l) => l.status === "won");
    const lost = leads.filter((l) => l.status === "lost");
    this.kpi(kpis, "Activos", String(active.length));
    this.kpi(kpis, "Ganados", String(won.length));
    this.kpi(kpis, "Perdidos", String(lost.length));
    this.kpi(kpis, "Tasa cierre", leads.length > 0 ? `${Math.round((won.length / leads.length) * 100)}%` : "—");

    // Funnel
    this.renderFunnel(contentEl, state);

    // Stage filter chips
    const chips = contentEl.createDiv({ cls: "octa-period" });
    const allBtn = chips.createEl("button", { text: "Todos", cls: this.stageFilter === "all" ? "mod-cta" : "" });
    allBtn.onclick = () => { this.stageFilter = "all"; this.renderTable(); };
    for (const stage of ACTIVE_STAGES) {
      const btn = chips.createEl("button", { text: STAGE_LABEL[stage], cls: this.stageFilter === stage ? "mod-cta" : "" });
      btn.onclick = () => { this.stageFilter = stage; this.renderTable(); };
    }

    // Table slot
    contentEl.createDiv({ cls: "octa-list-slot" });
    this.renderTable();
  }

  // ── KPI helper ──────────────────────────────────────────────────────

  private kpi(parent: HTMLElement, label: string, value: string): void {
    const card = parent.createDiv({ cls: "octa-kpi" });
    card.createDiv({ cls: "octa-kpi-value", text: value });
    card.createDiv({ cls: "octa-kpi-label", text: label });
  }

  // ── Funnel SVG ──────────────────────────────────────────────────────

  private renderFunnel(parent: HTMLElement, state: State): void {
    const summary = pipelineSummary(state);
    if (summary.every((s) => s.count === 0)) return;

    const maxCount = Math.max(...summary.map((s) => s.count), 1);
    const stageOrder = PIPELINE_STAGES.filter((s) => s !== "ganado" && s !== "perdido");
    const funnelData = stageOrder
      .map((stage) => {
        const s = summary.find((x) => x.stage === stage);
        return { stage, count: s?.count ?? 0, totalValue: s?.totalValue ?? 0 };
      })
      .filter((d) => d.count > 0);

    if (funnelData.length === 0) return;

    const wrap = parent.createDiv({ cls: "octa-funnel-wrap" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const W = 400, H = 32, GAP = 4;
    const totalH = funnelData.length * (H + GAP) - GAP;
    svg.setAttribute("viewBox", `0 0 ${W} ${totalH}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", String(totalH));

    for (let i = 0; i < funnelData.length; i++) {
      const d = funnelData[i]!;
      const ratio = d.count / maxCount;
      const wTop = 60 + ratio * (W - 60);
      const wBot = i < funnelData.length - 1
        ? 60 + (funnelData[i + 1]!.count / maxCount) * (W - 60)
        : wTop * 0.8;
      const xTop = (W - wTop) / 2;
      const xBot = (W - wBot) / 2;
      const y = i * (H + GAP);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${xTop},${y} L${xTop + wTop},${y} L${xBot + wBot},${y + H} L${xBot},${y + H} Z`);
      path.setAttribute("fill", STAGE_COLORS[d.stage] ?? "#6c757d");
      path.setAttribute("rx", "4");
      svg.appendChild(path);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(W / 2));
      label.setAttribute("y", String(y + H / 2 + 4));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", "#fff");
      label.setAttribute("font-size", "12");
      label.setAttribute("font-weight", "600");
      label.textContent = `${STAGE_LABEL[d.stage]} — ${d.count}`;
      svg.appendChild(label);
    }

    wrap.appendChild(svg);
  }

  // ── Table ───────────────────────────────────────────────────────────

  private renderTable(): void {
    const slot = this.contentEl.querySelector<HTMLElement>(".octa-list-slot");
    if (!slot) return;
    slot.empty();

    let leads = activeLeads(this.host.state);
    if (this.stageFilter !== "all") leads = leads.filter((l) => l.stage === this.stageFilter);
    if (this.filter) {
      const needle = this.filter.toLowerCase();
      leads = leads.filter((l) =>
        [l.name, l.contactName, l.company, l.email, l.phone, l.owner]
          .filter((v): v is string => typeof v === "string" && v !== "")
          .some((v) => v.toLowerCase().includes(needle)),
      );
    }

    if (leads.length === 0) {
      slot.createEl("p", {
        cls: "octa-empty",
        text: this.filter || this.stageFilter !== "all"
          ? "Ningún prospecto coincide con el filtro."
          : "Todavía no hay prospectos. Creá el primero con «+ Prospecto».",
      });
      return;
    }

    const wrap = slot.createDiv({ cls: "octa-table-wrap" });
    const table = wrap.createEl("table", { cls: "octa-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Nombre", "Contacto", "Empresa", "Etapa", "Fuente", "Valor", "Responsable", ""]) {
      head.createEl("th", { text: label });
    }

    const tbody = table.createEl("tbody");
    for (const lead of leads) this.row(tbody, lead);
  }

  private row(tbody: HTMLElement, lead: Lead): void {
    const row = tbody.createEl("tr");

    const nameCell = row.createEl("td");
    nameCell.createSpan({ text: lead.name });

    row.createEl("td", { text: lead.contactName || "—" });
    row.createEl("td", { text: lead.company || "—" });

    const stageCell = row.createEl("td");
    const chip = stageCell.createEl("span", { cls: "octa-chip" });
    chip.setText(STAGE_LABEL[lead.stage]);
    chip.style.backgroundColor = STAGE_COLORS[lead.stage] ?? "#6c757d";
    chip.style.color = "#fff";

    row.createEl("td", { text: SOURCE_LABEL[lead.source] ?? lead.source });
    row.createEl("td", { cls: "octa-mono", text: lead.estimatedValue > 0 ? `Q${lead.estimatedValue.toLocaleString("es")}` : "—" });
    row.createEl("td", { text: lead.owner || "—" });

    const actions = row.createEl("td", { cls: "octa-actions" });
    actions.createEl("button", { text: "Editar" }).onclick = () => this.openEditor(lead);
    if (lead.status === "active") {
      actions.createEl("button", { text: "Ganar" }).onclick = () => this.win(lead);
      actions.createEl("button", { text: "Perder" }).onclick = () => this.lose(lead);
    }
    actions.createEl("button", { text: "Archivar" }).onclick = () => this.confirmArchive(lead);
  }

  // ── Actions ─────────────────────────────────────────────────────────

  private openEditor(existing?: Lead): void {
    new LeadModal(this.app, {
      ...(existing ? { existing } : {}),
      onSubmit: async (draft) => {
        const ok = existing ? await this.update(existing, draft) : await this.create(draft);
        if (ok) new Notice(existing ? `${draft.name} actualizado` : `${draft.name} creado`);
      },
    }).open();
  }

  private create(draft: LeadDraft): Promise<boolean> {
    return this.host.commit(this.host.newEvent("lead.created", { leadId: generateId("lead"), ...draft }));
  }

  private update(existing: Lead, draft: LeadDraft): Promise<boolean> {
    return this.host.commit(this.host.newEvent("lead.updated", { leadId: existing.id, changes: draft }));
  }

  private win(lead: Lead): Promise<boolean> {
    return this.host.commit(this.host.newEvent("lead.won", { leadId: lead.id }));
  }

  private lose(lead: Lead): Promise<boolean> {
    return this.host.commit(this.host.newEvent("lead.lost", { leadId: lead.id }));
  }

  private confirmArchive(lead: Lead): void {
    new ConfirmModal(this.app, {
      title: "Archivar prospecto",
      body: `${lead.name} sale de la vista activa. Podés recuperarlo del journal.`,
      confirmText: "Archivar",
      destructive: true,
      onConfirm: async () => {
        const ok = await this.host.commit(this.host.newEvent("lead.archived", { leadId: lead.id }));
        if (ok) new Notice(`${lead.name} archivado`);
      },
    }).open();
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}
