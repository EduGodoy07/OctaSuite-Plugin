import type { AnyEvent, ParseResult, RejectedEvent, State } from "@octasuite/core";
import type { OctaSuiteSettings } from "../settings.js";
import type { ModuleDef } from "../modules.js";
import type { VaultCatalogs } from "../storage/vault-catalogs.js";
import type { VaultPricelists } from "../storage/vault-pricelists.js";
import type { VaultTasks } from "../storage/task-store.js";

/**
 * Lo que las vistas necesitan del plugin. Existe para que las vistas dependan de
 * una interfaz y no de la clase del plugin, que las importaría en círculo.
 */
export interface PluginHost {
  /** Estado de la empresa primaria (la primera de `activeCompanyIds`). Las vistas que escriben trabajan contra esta proyección. */
  readonly state: State;
  /** Estados proyectados por empresa seleccionada, para lectura consolidada (launcher/reports). */
  readonly statesByCompany: ReadonlyMap<string, State>;
  /** Empresas seleccionadas en orden: la primera es la primaria (destino de escrituras). */
  readonly activeCompanyIds: readonly string[];
  readonly settings: OctaSuiteSettings;
  /** Instancia unica de los catalogos del vault (load + saveUom la comparten). */
  readonly catalogs: VaultCatalogs;
  /** Instancia unica de las listas de precios del vault (B-03). */
  readonly pricelists: VaultPricelists;
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
  /** Fija la selección multi-empresa (primera = primaria) y reconstruye los estados. */
  setActiveCompanyIds(companyIds: string[]): Promise<void>;
  openQuickAdd(): void;
  /** Vuelve al lanzador en la misma hoja. */
  openHome(): void;
  /** Lleva la vista del panel lateral al área principal. */
  expandToMain(viewType: string): void;
  openModule(mod: ModuleDef): void;
  commit(event: AnyEvent, options?: { silent?: boolean; companyId?: string }): Promise<boolean>;
  newEvent<T extends AnyEvent["type"]>(type: T, payload: unknown): AnyEvent;
}
