import { App, setIcon, WorkspaceLeaf } from "obsidian";
import type { PluginHost } from "./host.js";

/**
 * Barra superior común de los módulos: volver al inicio, título, y expandir
 * cuando la vista está en el panel lateral.
 *
 * La navegación reemplaza el contenido de la MISMA pestaña. Abrir una pestaña
 * por módulo llenaba el área de trabajo de pestañas de OctaSuite; un ERP se
 * navega dentro de su propia área, como la pantalla de aplicaciones de Odoo.
 */
export function moduleHeader(
  parent: HTMLElement,
  title: string,
  host: PluginHost,
  app: App,
  leaf: WorkspaceLeaf,
  viewType: string,
): HTMLElement {
  const bar = parent.createDiv({ cls: "octa-topbar" });
  const left = bar.createDiv({ cls: "octa-nav-left" });

  const back = left.createEl("button", { cls: "octa-icon-button", attr: { "aria-label": "Volver al inicio" } });
  setIcon(back, "arrow-left");
  if (back.childElementCount === 0) back.setText("←");
  back.onclick = () => host.openHome();

  left.createEl("h2", { text: title, cls: "octa-brand" });

  if (leaf.getRoot() !== app.workspace.rootSplit) {
    const expand = left.createEl("button", {
      cls: "octa-icon-button",
      attr: { "aria-label": "Abrir en la ventana completa" },
    });
    setIcon(expand, "maximize-2");
    if (expand.childElementCount === 0) expand.setText("⤢");
    expand.onclick = () => host.expandToMain(viewType);
  }

  return bar;
}
