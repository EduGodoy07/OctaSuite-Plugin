import {
  allLoyaltyAccounts,
  allLoyaltyRewards,
  generateId,
  loyaltyPointsSummary,
  loyaltyTransactionsFor,
  TIER_LABEL,
  TIER_ORDER,
  type LoyaltyAccount,
  type LoyaltyReward,
} from "@octasuite/core";
import { ItemView, Menu, Notice, type WorkspaceLeaf } from "obsidian";
import { LOYALTY_VIEW_TYPE } from "../modules.js";
import { moduleHeader } from "./nav.js";
import type { PluginHost } from "./host.js";
import { ConfirmModal } from "./confirm-modal.js";
import { RewardModal } from "./reward-modal.js";
import { PointsAdjustModal } from "./points-adjust-modal.js";

const TIER_COLORS: Record<string, string> = {
  bronce: "#CD7F32",
  plata: "#C0C0C0",
  oro: "#FFD700",
  platino: "#E5E4E2",
};

export class LoyaltyView extends ItemView {
  private stageFilter: string = "all";
  private tab: "accounts" | "rewards" = "accounts";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PluginHost,
  ) {
    super(leaf);
  }

  override getViewType(): string { return LOYALTY_VIEW_TYPE; }
  override getDisplayText(): string { return "Lealtad"; }
  override getIcon(): string { return "badge-percent"; }

  override async onOpen(): Promise<void> {
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("octa");
    this.contentEl.addClass("octa-loyalty");

    const top = this.contentEl.createDiv();
    moduleHeader(top, "Lealtad", this.host, this.app, this.leaf, LOYALTY_VIEW_TYPE);

    // Tab bar
    const tabBar = top.createDiv({ cls: "octa-period" });
    this.tabBtn(tabBar, "Cuentas", "accounts");
    this.tabBtn(tabBar, "Recompensas", "rewards");

    if (this.tab === "accounts") {
      this.renderAccounts();
    } else {
      this.renderRewards();
    }
  }

  private tabBtn(parent: HTMLElement, label: string, key: "accounts" | "rewards"): void {
    const btn = parent.createEl("button", {
      text: label,
      cls: this.tab === key ? "mod-cta" : "",
    });
    btn.onclick = () => {
      this.tab = key;
      this.render();
    };
  }

  // ── Accounts ─────────────────────────────────────────────────────

  private renderAccounts(): void {
    const contentEl = this.contentEl;
    const state = this.host.state;

    // Tools row
    const tools = contentEl.createDiv({ cls: "octa-period" });
    tools.createEl("button", { text: "+ Recompensa", cls: "mod-cta" }).onclick = () => this.openRewardModal();

    // KPIs
    const summary = loyaltyPointsSummary(state);
    const kpis = contentEl.createDiv({ cls: "octa-kpi-row" });
    this.kpi(kpis, "Clientes", String(summary.totalCustomers));
    this.kpi(kpis, "Puntos en circulación", String(summary.totalPoints));
    this.kpi(kpis, "Recompensas", String(allLoyaltyRewards(state).length));

    // Tier breakdown
    if (summary.byTier.length > 0) {
      const tierRow = contentEl.createDiv({ cls: "octa-loyalty-tiers" });
      for (const tier of TIER_ORDER) {
        const info = summary.byTier.find((t) => t.tier === tier);
        if (!info || info.count === 0) continue;
        const chip = tierRow.createDiv({
          cls: "octa-loyalty-tier-chip",
          text: `${TIER_LABEL[tier]} — ${info.count}`,
        });
        chip.style.setProperty("--tier-color", TIER_COLORS[tier] ?? "#999");
      }
    }

    // Accounts table
    const accounts = allLoyaltyAccounts(state);
    if (accounts.length === 0) {
      contentEl.createDiv({ cls: "octa-empty", text: "No hay cuentas de lealtad. Se crean automáticamente al cobrar facturas con cliente." });
      return;
    }

    const tableWrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "octa-table" });
    const thead = table.createEl("thead");
    thead.createEl("th", { text: "Cliente" });
    thead.createEl("th", { text: "Puntos" });
    thead.createEl("th", { text: "Canjeados" });
    thead.createEl("th", { text: "Historial" });
    thead.createEl("th", { text: "Tier" });
    thead.createEl("th", { text: "" });

    const tbody = table.createEl("tbody");
    for (const acct of accounts) {
      const tr = tbody.createEl("tr");
      const nameCell = tr.createEl("td", { text: acct.partnerName });
      nameCell.createDiv({ cls: "octa-subtle", text: `ID: ${acct.partnerId}` });
      tr.createEl("td", { text: String(acct.points) });
      tr.createEl("td", { text: String(acct.lifetimePoints - acct.points) });
      tr.createEl("td", { text: String(acct.lifetimePoints) });
      const tierCell = tr.createEl("td");
      const tierBadge = tierCell.createSpan({
        cls: "octa-loyalty-tier-badge",
        text: TIER_LABEL[acct.tier],
      });
      tierBadge.style.setProperty("--tier-color", TIER_COLORS[acct.tier] ?? "#999");

      // Actions
      const actionsCell = tr.createEl("td");
      const actionsBtn = actionsCell.createEl("button", { text: "…", cls: "octa-icon-btn" });
      actionsBtn.onclick = (e: MouseEvent) => {
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle("Ajustar puntos").setIcon("plus-circle").onClick(() => this.openAdjustModal(acct));
        });
        menu.addItem((item) => {
          item.setTitle("Historial").setIcon("history").onClick(() => this.openHistory(acct));
        });
        menu.showAtMouseEvent(e);
      };
    }
  }

  // ── Rewards ──────────────────────────────────────────────────────

  private renderRewards(): void {
    const contentEl = this.contentEl;
    const state = this.host.state;

    const tools = contentEl.createDiv({ cls: "octa-period" });
    tools.createEl("button", { text: "+ Recompensa", cls: "mod-cta" }).onclick = () => this.openRewardModal();

    const rewards = allLoyaltyRewards(state);
    if (rewards.length === 0) {
      contentEl.createDiv({ cls: "octa-empty", text: "No hay recompensas configuradas. Creá una para que los clientes puedan canjear puntos." });
      return;
    }

    const grid = contentEl.createDiv({ cls: "octa-loyalty-rewards-grid" });
    for (const reward of rewards) {
      const card = grid.createDiv({ cls: "octa-loyalty-reward-card" });
      card.createDiv({ cls: "octa-loyalty-reward-name", text: reward.name });
      if (reward.description) {
        card.createDiv({ cls: "octa-loyalty-reward-desc", text: reward.description });
      }
      card.createDiv({ cls: "octa-loyalty-reward-cost", text: `${String(reward.pointsCost)} puntos` });
      card.createDiv({ cls: "octa-subtle", text: `ID: ${reward.id}` });

      const actions = card.createDiv({ cls: "octa-loyalty-reward-actions" });
      actions.createEl("button", { text: "Editar", cls: "mod-cta" }).onclick = () => this.openRewardModal(reward);
      actions.createEl("button", { text: "Desactivar", cls: "" }).onclick = () => this.deactivateReward(reward);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private kpi(parent: HTMLElement, label: string, value: string): void {
    const card = parent.createDiv({ cls: "octa-kpi" });
    card.createDiv({ cls: "octa-kpi-value", text: value });
    card.createDiv({ cls: "octa-kpi-label", text: label });
  }

  private openRewardModal(reward?: LoyaltyReward): void {
    new RewardModal(this.app, {
      existing: reward,
      onSubmit: async (draft) => {
        if (reward) {
          const ok = await this.host.commit(this.host.newEvent("loyalty.reward_updated", { rewardId: reward.id, changes: draft }));
          if (ok) new Notice("Recompensa actualizada");
        } else {
          const rewardId = generateId("rw");
          const ok = await this.host.commit(this.host.newEvent("loyalty.reward_created", { rewardId, ...draft }));
          if (ok) new Notice("Recompensa creada");
        }
      },
    }).open();
  }

  private openAdjustModal(account: LoyaltyAccount): void {
    new PointsAdjustModal(this.app, {
      account,
      host: this.host,
      onSubmit: async (points, reason) => {
        const ok = await this.host.commit(this.host.newEvent("loyalty.points_adjusted", {
          accountId: account.id,
          points,
          reason,
        }));
        if (ok) new Notice(points > 0 ? `+${points} puntos agregados` : `${points} puntos deducidos`);
      },
    }).open();
  }

  private deactivateReward(reward: LoyaltyReward): void {
    new ConfirmModal(this.app, {
      title: "Desactivar recompensa",
      body: `¿Desactivar «${reward.name}»? Los clientes no podrán canjearla.`,
      confirmText: "Desactivar",
      destructive: true,
      onConfirm: async () => {
        const ok = await this.host.commit(this.host.newEvent("loyalty.reward_updated", {
          rewardId: reward.id,
          changes: { active: false } as Partial<LoyaltyReward>,
        }));
        if (ok) new Notice("Recompensa desactivada");
      },
    }).open();
  }

  private openHistory(account: LoyaltyAccount): void {
    const txs = loyaltyTransactionsFor(this.host.state, account.id);
    const contentEl = this.contentEl;
    contentEl.empty();
    contentEl.addClass("octa");

    const top = contentEl.createDiv();
    moduleHeader(top, `${account.partnerName} — Historial`, this.host, this.app, this.leaf, LOYALTY_VIEW_TYPE);

    const summary = contentEl.createDiv({ cls: "octa-loyalty-account-summary" });
    summary.createDiv({ cls: "octa-loyalty-account-name", text: account.partnerName });
    summary.createDiv({ cls: "octa-loyalty-account-points", text: `Saldo: ${String(account.points)} puntos` });
    const tierBadge = summary.createSpan({
      cls: "octa-loyalty-tier-badge",
      text: TIER_LABEL[account.tier],
    });
    tierBadge.style.setProperty("--tier-color", TIER_COLORS[account.tier] ?? "#999");

    if (txs.length === 0) {
      contentEl.createDiv({ cls: "octa-empty", text: "No hay transacciones aún." });
      return;
    }

    const tableWrap = contentEl.createDiv({ cls: "octa-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "octa-table" });
    const thead = table.createEl("thead");
    thead.createEl("th", { text: "Fecha" });
    thead.createEl("th", { text: "Tipo" });
    thead.createEl("th", { text: "Puntos" });
    thead.createEl("th", { text: "Referencia" });
    thead.createEl("th", { text: "Nota" });

    const tbody = table.createEl("tbody");
    for (const tx of txs) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: new Date(tx.createdAt).toLocaleDateString("es-GT") });
      tr.createEl("td", { text: tx.type === "earned" ? "Ganado" : tx.type === "redeemed" ? "Canjeado" : "Ajuste" });
      const ptsCell = tr.createEl("td", { text: tx.points > 0 ? `+${tx.points}` : String(tx.points) });
      if (tx.points > 0) ptsCell.addClass("octa-positive");
      else if (tx.points < 0) ptsCell.addClass("octa-negative");
      tr.createEl("td", { text: tx.reference ?? "—" });
      tr.createEl("td", { text: tx.note ?? "—" });
    }
  }

  override onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }
}
