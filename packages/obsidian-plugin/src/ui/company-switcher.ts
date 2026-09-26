import { Menu, Notice, setIcon } from "obsidian";
import { buildActiveLabel, companyLabel } from "./company-labels.js";
import type { PluginHost } from "./host.js";

// Re-export para compatibilidad con las vistas que importan companyLabel desde
// este archivo (reports-view, launcher-view, accounting-view).
export { companyDisplayName, companyLabel } from "./company-labels.js";

/**
 * Selector multi-empresa reutilizable: un botón que resume la selección y un
 * menú con las empresas disponibles (check = seleccionada). Cada toggle llama
 * a `host.setActiveCompanyIds(ids)`; el host reconstruye los estados y las
 * vistas se refrescan. Se usa en el launcher, en la barra de los módulos
 * (nav.ts) y en el panel de configuración.
 *
 * Las escrituras siempre van a la PRIMERA seleccionada (primaria); elegir
 * otra empresa como primaria = desmarcarla y volverla a marcar primero.
 */
export function mountCompanySwitcher(parent: HTMLElement, host: PluginHost): HTMLElement {
  const active = host.activeCompanyIds;
  const label = buildActiveLabel(active);

  const button = parent.createEl("button", {
    cls: "octa-company-chip",
    attr: {
      type: "button",
      "aria-label": "Empresas activas",
      title: active.map(companyLabel).join(", "),
    },
  });
  const icon = button.createSpan({ cls: "octa-company-chip-icon" });
  setIcon(icon, "building-2");
  // Si Obsidian no conoce el icono no dibuja nada: la letra evita el hueco.
  if (icon.childElementCount === 0) icon.setText("E");
  button.createSpan({ text: label });

  button.onclick = () => void openMenu(button, host);
  return button;
}

async function openMenu(button: HTMLElement, host: PluginHost): Promise<void> {
  const active = host.activeCompanyIds;
  const companies = await host.journalCompanies();
  // La primaria siempre es una opción válida, aunque todavía no tenga datos
  // (listCompanyIds solo lista las que ya tienen archivos).
  for (const id of active) if (!companies.includes(id)) companies.unshift(id);

  // Orden estable: primero las activas en su orden, luego el resto alfabético.
  const ordered = [
    ...active.filter((id) => companies.includes(id)),
    ...companies.filter((id) => !active.includes(id)).sort((a, b) => a.localeCompare(b)),
  ];
  if (ordered.length <= 1) return;

  const menu = new Menu();
  for (const companyId of ordered) {
    const selected = active.includes(companyId);
    menu.addItem((item) => {
      item.setTitle(companyLabel(companyId));
      // setChecked es el mecanismo nativo de check de los menús de Obsidian
      // (API >= 0.16.2): dibuja el marcador del ítem seleccionado. setIcon no
      // se usa porque el icono del slot no se renderiza de forma visible en el
      // menú moderno (verificado en vivo con instrumentación 2026-09-08).
      item.setChecked(selected);
      item.onClick(() => {
        // La última empresa activa no se desmarca: la selección nunca puede
        // quedar vacía (normalizeActiveCompanyIds caería a la primaria y el
        // toggle se ignoraría en silencio). Antes se usaba setDisabled(true),
        // que Obsidian pinta GRIS: parecía inaccesible cuando en realidad solo
        // estaba protegida de desmarcarse. Ahora el ítem se ve normal y el
        // intento de desmarcarla recibe feedback explícito.
        if (selected && active.length === 1) {
          new Notice("Debe quedar al menos una empresa activa.");
          return;
        }
        const next = selected
          ? active.filter((id) => id !== companyId)
          : [...active, companyId];
        void host.setActiveCompanyIds(next);
      });
    });
  }

  const rect = button.getBoundingClientRect();
  menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
}