/**
 * Stub de "obsidian" para tests en node.
 *
 * El paquete npm "obsidian" solo trae declaraciones de tipos, sin export
 * runtime (su main apunta a código que solo existe dentro del runtime de
 * Obsidian). Los tests del plugin que importan vistas reales (p.ej.
 * PayrollView → renderOrgchart) necesitan que el módulo resuelva.
 *
 * Este stub está cableado vía `resolve.alias` en vitest.config.ts.
 * NO intenta emular Obsidian: expone las clases mínimas que usan los
 * módulos del plugin en tiempo de ejecución durante un render.
 */
export class App {}

/** No-op: en runtime real dibuja el icono de Lucide; en tests no hay SVG. */
export function setIcon(_el: unknown, _iconId: string): void {}

export class Component {}

export class WorkspaceLeaf {}

export class ItemView extends Component {
  contentEl: unknown;
  constructor(_leaf: WorkspaceLeaf) {
    super();
  }
  getIcon() {}
  getDisplayText() {
    return "";
  }
  async onOpen() {}
  async onClose() {}
}

export class Modal {
  constructor(_app: App) {}
  open() {}
  close() {}
  contentEl: unknown;
}

export class Notice {
  constructor(_message: string) {}
}

export class Setting {
  constructor(_containerEl: unknown) {}
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  addText() {
    return this;
  }
  addButton() {
    return this;
  }
  addToggle() {
    return this;
  }
  addDropdown() {
    return this;
  }
  addTextArea() {
    return this;
  }
}

export class TFile {}