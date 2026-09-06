import type { AnyEvent, ParseResult, RejectedEvent, State } from "@octasuite/core";
import type { OctaSuiteSettings } from "../settings.js";
import type { ModuleDef } from "../modules.js";
import type { VaultCatalogs } from "../storage/vault-catalogs.js";
import type { VaultTasks } from "../storage/task-store.js";

/**
 * Lo que las vistas necesitan del plugin. Existe para que las vistas dependan de
 * una interfaz y no de la clase del plugin, que las importaría en círculo.
 */
export interface PluginHost {
  readonly state: State;
  readonly settings: OctaSuiteSettings;
  /** Instancia unica de los catalogos del vault (load + saveUom la comparten). */
  readonly catalogs: VaultCatalogs;
  /** Instancia unica de las tareas por archivos del vault. */
  readonly tasks: VaultTasks;
  readonly rejectedCount: number;
  readonly corruptCount: number;
  /** Se resuelve cuando termina el primer reload del journal (estado consistente). */
  readonly ready: Promise<void>;
  /** Rechazos del último reload, con evento y razón (para avisos específicos). */
  readonly lastRejections: RejectedEvent[];
  /** Líneas ilegibles del último reload, con número y motivo. */
  readonly lastCorrupt: ParseResult["corrupt"];
  /** Empresas que existen en el journal (fuente única: el filesystem). */
  journalCompanies(): Promise<string[]>;
  /** Cambia la empresa activa y reconstruye el estado del journal. */
  setActiveCompany(companyId: string): Promise<void>;
  openQuickAdd(): void;
  /** Vuelve al lanzador en la misma hoja. */
  openHome(): void;
  /** Lleva la vista del panel lateral al área principal. */
  expandToMain(viewType: string): void;
  openModule(mod: ModuleDef): void;
  commit(event: AnyEvent, options?: { silent?: boolean }): Promise<boolean>;
  newEvent<T extends AnyEvent["type"]>(type: T, payload: unknown): AnyEvent;
}
