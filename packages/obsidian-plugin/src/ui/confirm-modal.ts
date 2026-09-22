import { App, Modal, Setting } from "obsidian";

/**
 * Confirmación propia en vez de `window.confirm`: el diálogo nativo bloquea el
 * hilo y no existe en Obsidian móvil.
 */
export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      readonly title: string;
      readonly body: string;
      readonly confirmText: string;
      readonly onConfirm: () => void | Promise<void>;
      readonly destructive?: boolean;
    },
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.options.title });
    contentEl.createEl("p", { text: this.options.body });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((b) => {
        b.setButtonText(this.options.confirmText).onClick(async () => {
          this.close();
          await this.options.onConfirm();
        });
        if (this.options.destructive) b.setWarning();
        else b.setCta();
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
