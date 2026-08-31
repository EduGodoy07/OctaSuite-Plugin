import type { LoyaltyAccount } from "@octasuite/core";
import { App, Modal, Setting } from "obsidian";
import type { PluginHost } from "./host.js";

export class PointsAdjustModal extends Modal {
  private pointsRaw = "";
  private reason = "";
  private mode: "add" | "deduct" = "add";
  private errorsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly options: {
      readonly account: LoyaltyAccount;
      readonly host: PluginHost;
      readonly onSubmit: (points: number, reason: string) => Promise<void>;
    },
  ) {
    super(app);
  }

  override onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("octa");
    const acct = this.options.account;

    contentEl.createEl("h3", { text: `Ajustar puntos — ${acct.partnerName}` });
    contentEl.createDiv({ cls: "octa-subtle", text: `Saldo actual: ${acct.points} puntos · Tier: ${acct.tier}` });

    // Mode toggle
    const modeRow = contentEl.createDiv({ cls: "octa-period" });
    const addBtn = modeRow.createEl("button", { text: "Agregar", cls: this.mode === "add" ? "mod-cta" : "" });
    addBtn.onclick = () => { this.mode = "add"; this.render(); };
    const dedBtn = modeRow.createEl("button", { text: "Deducir", cls: this.mode === "deduct" ? "mod-cta" : "" });
    dedBtn.onclick = () => { this.mode = "deduct"; this.render(); };

    // Points
    new Setting(contentEl).setName("Puntos").addText((t) => {
      t.setPlaceholder("500").setValue(this.pointsRaw).onChange((v) => {
        this.pointsRaw = v;
      });
      window.setTimeout(() => t.inputEl.focus(), 0);
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.submit();
      });
    });

    // Reason
    new Setting(contentEl).setName("Motivo").addTextArea((a) =>
      a.setPlaceholder("Ej: Bono por cumpleaños, corrección de error…")
        .setValue(this.reason)
        .onChange((v) => (this.reason = v)),
    );

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Aplicar").setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    const raw = Number(this.pointsRaw);
    const problems: string[] = [];
    if (!Number.isFinite(raw) || raw <= 0) problems.push("Los puntos deben ser un número mayor a 0");
    if (!this.reason.trim()) problems.push("El motivo es obligatorio");

    this.errorsEl.empty();
    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const p of problems) list.createEl("li", { text: p });
      return;
    }

    const points = this.mode === "deduct" ? -raw : raw;

    // Check for negative balance
    if (this.options.account.points + points < 0) {
      const list = this.errorsEl.createEl("ul");
      list.createEl("li", { text: `El ajuste dejaría el saldo en negativo (${this.options.account.points + points})` });
      return;
    }

    await this.options.onSubmit(points, this.reason.trim());
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
