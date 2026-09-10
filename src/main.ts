import {
  DEFAULT_EXPENSE_CATEGORY_NAMES,
  DomainError,
  apply,
  categoryCode,
  emptyState,
  expensesByCategory,
  format,
  generateId,
  knownBaseCurrencies,
  monthKeyOf,
  project,
  slugifyCompanyId,
  toIsoDate,
  totalExpenses,
  totalInvoiced,
  validateCompanyDraft,
  validateCompanyId,
  type AnyEvent,
  type Category,
  type CurrencyCode,
  type ParseResult,
  type RejectedEvent,
  type State,
} from "@octasuite/core";
import { App, Notice, Plugin, PluginSettingTab, Setting, type WorkspaceLeaf } from "obsidian";
import {
  ACCOUNTING_VIEW_TYPE,
  EXPENSES_VIEW_TYPE,
  INVENTORY_VIEW_TYPE,
  INVOICES_VIEW_TYPE,
  KNOWN_VIEW_TYPES,
  LAUNCHER_VIEW_TYPE,
  LEADS_VIEW_TYPE,
  LOYALTY_VIEW_TYPE,
  PARTNERS_VIEW_TYPE,
  PAYABLES_VIEW_TYPE,
  PAYMENT_RECEIPT_VIEW_TYPE,
  PAYROLL_VIEW_TYPE,
  PRODUCTS_VIEW_TYPE,
  RECEIPTS_VIEW_TYPE,
  REGISTER_VIEW_TYPE,
  REPORTS_VIEW_TYPE,
  SETTINGS_MODULE_ID,
  STATUS_LABEL,
  TASKS_VIEW_TYPE,
  VIEW_TYPE_PREFIX,
  isOctaSuiteViewType,
  type ModuleDef,
} from "./modules.js";
import { DEFAULT_SETTINGS, type OctaSuiteSettings } from "./settings.js";
import {
  migrateActiveCompanyIds,
  normalizeActiveCompanyIds,
  sameActiveCompanyIds,
} from "./company-selection.js";
import { VaultCatalogs } from "./storage/vault-catalogs.js";
import { VaultPricelists } from "./storage/vault-pricelists.js";
import { VaultTasks } from "./storage/task-store.js";
import { DEFAULT_COMPANY_ID, VaultJournal } from "./storage/vault-journal.js";
import { ExpensesView } from "./ui/expenses-view.js";
import type { PluginHost } from "./ui/host.js";
import { mountCompanySwitcher } from "./ui/company-switcher.js";
import { InvoicesView } from "./ui/invoices-view.js";
import { InventoryView } from "./ui/inventory-view.js";
import { TasksView } from "./ui/tasks-view.js";
import { LauncherView } from "./ui/launcher-view.js";
import { LeadsView } from "./ui/leads-view.js";
import { LoyaltyView } from "./ui/loyalty-view.js";
import { PartnersView } from "./ui/partners-view.js";
import { PayablesView } from "./ui/payables-view.js";
import { PayrollView } from "./ui/payroll-view.js";
import { ProductsView } from "./ui/products-view.js";
import { ReceiptsView } from "./ui/receipts-view.js";
import { ReceiptView } from "./ui/receipt-view.js";
import { RegisterView } from "./ui/register-view.js";
import { QuickAddExpenseModal } from "./ui/quick-add-expense.js";
import { ReportsView } from "./ui/reports-view.js";
import { AccountingView } from "./ui/accounting-view.js";

const REFRESHABLE = [
  LAUNCHER_VIEW_TYPE,
  EXPENSES_VIEW_TYPE,
  REPORTS_VIEW_TYPE,
  PARTNERS_VIEW_TYPE,
  PRODUCTS_VIEW_TYPE,
  INVOICES_VIEW_TYPE,
  RECEIPTS_VIEW_TYPE,
  PAYMENT_RECEIPT_VIEW_TYPE,
  REGISTER_VIEW_TYPE,
  PAYABLES_VIEW_TYPE,
  LEADS_VIEW_TYPE,
  LOYALTY_VIEW_TYPE,
  ACCOUNTING_VIEW_TYPE,
  PAYROLL_VIEW_TYPE,
  INVENTORY_VIEW_TYPE,
  TASKS_VIEW_TYPE,
] as const;

export default class OctaSuitePlugin extends Plugin implements PluginHost {
  // `Plugin.settings?: unknown` existe desde la API 1.13; aquí se concreta el tipo.
  override settings: OctaSuiteSettings = DEFAULT_SETTINGS;
  /** Estado de la empresa primaria (la primera de `activeCompanyIds`). Las vistas que escriben trabajan contra este. */
  state: State = emptyState();
  /**
   * Estados proyectados por empresa seleccionada. Launcher y reportes los
   * consolidan con las funciones `consolidated*` del core; nunca se mezclan
   * estados (los ids de categoría/cliente son locales a cada partición).
   */
  statesByCompany: Map<string, State> = new Map();
  /** Selección efectiva de la última carga; para detectar cambios de selección en saveSettings. */
  private previousActiveCompanyIds: string[] = [DEFAULT_COMPANY_ID];
  rejectedCount = 0;
  corruptCount = 0;

  /** Se resuelve cuando termina la carga MÁS RECIENTE del journal (por empresa). Las vistas la esperan antes de commitear. */
  ready: Promise<void> = Promise.resolve();

  /** Contador de generación de recargas: distingue la carga actual de las anteriores (para el race de cambio de empresa). */
  private reloadGen = 0;

  /** Últimos eventos rechazados al reconstruir el estado (para avisos específicos). */
  lastRejections: RejectedEvent[] = [];
  /** Últimas líneas ilegibles del journal (para avisos específicos). */
  lastCorrupt: ParseResult["corrupt"] = [];

  private journal!: VaultJournal;

  /** Empresas seleccionadas en orden (primera = primaria). Vista de lecturas para el selector. */
  get activeCompanyIds(): readonly string[] {
    return this.settings.activeCompanyIds;
  }

  /** ID de la empresa primaria: la primera de la selección (destino de escrituras). */
  private get primaryCompanyId(): string {
    return this.settings.activeCompanyIds[0] ?? DEFAULT_COMPANY_ID;
  }

  private catalogsFolder = "";
  private catalogsInstance: VaultCatalogs | null = null;

  /**
   * Instancia unica de los catalogos del vault: `load()` (en reload) y
   * `saveUom()` (desde la UI) comparten la misma instancia, asi el mutex de
   * `saveUom` serializa de verdad los saves de UoM dentro de la ventana.
   * Se recrea si cambia la carpeta configurada (settings).
   */
  get catalogs(): VaultCatalogs {
    if (!this.catalogsInstance || this.catalogsFolder !== this.settings.dataFolder) {
      this.catalogsInstance = new VaultCatalogs(this.settings.dataFolder, this.app.vault.adapter);
      this.catalogsFolder = this.settings.dataFolder;
    }
    return this.catalogsInstance;
  }

  private pricelistsFolder = "";
  private pricelistsInstance: VaultPricelists | null = null;

  /**
   * Instancia unica del catalogo de listas de precios del vault (B-03): el
   * gestor (modal) escribe y las facturas leen la misma instancia. Mismo
   * patron de `catalogs`: se recrea si cambia la carpeta configurada.
   */
  get pricelists(): VaultPricelists {
    if (!this.pricelistsInstance || this.pricelistsFolder !== this.settings.dataFolder) {
      this.pricelistsInstance = new VaultPricelists(this.settings.dataFolder, this.app.vault.adapter);
      this.pricelistsFolder = this.settings.dataFolder;
    }
    return this.pricelistsInstance;
  }

  private tasksFolder = "";
  private tasksInstance: VaultTasks | null = null;

  /**
   * Instancia unica de las tareas del vault, por archivos (no event-sourced):
   * las vistas comparten la misma instancia, y se recrea si cambia la carpeta
   * configurada (settings). Las tareas no dependen de la empresa activa: el
   * scope de cada tarea se guarda en su propio archivo.
   */
  get tasks(): VaultTasks {
    if (!this.tasksInstance || this.tasksFolder !== this.settings.dataFolder) {
      this.tasksInstance = new VaultTasks(this.app.vault, this.settings.dataFolder);
      this.tasksFolder = this.settings.dataFolder;
    }
    return this.tasksInstance;
  }

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.journal = new VaultJournal(this.app.vault, this.settings.dataFolder, this.settings.activeCompanyId);

    this.registerView(LAUNCHER_VIEW_TYPE, (leaf: WorkspaceLeaf) => new LauncherView(leaf, this));
    this.registerView(EXPENSES_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ExpensesView(leaf, this));
    this.registerView(REPORTS_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ReportsView(leaf, this));
    this.registerView(PARTNERS_VIEW_TYPE, (leaf: WorkspaceLeaf) => new PartnersView(leaf, this));
    this.registerView(PRODUCTS_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ProductsView(leaf, this));
    this.registerView(INVOICES_VIEW_TYPE, (leaf: WorkspaceLeaf) => new InvoicesView(leaf, this));
    this.registerView(RECEIPTS_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ReceiptsView(leaf, this));
    this.registerView(PAYMENT_RECEIPT_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ReceiptView(leaf, this));
    this.registerView(REGISTER_VIEW_TYPE, (leaf: WorkspaceLeaf) => new RegisterView(leaf, this));
    this.registerView(PAYABLES_VIEW_TYPE, (leaf: WorkspaceLeaf) => new PayablesView(leaf, this));
    this.registerView(LEADS_VIEW_TYPE, (leaf: WorkspaceLeaf) => new LeadsView(leaf, this));
    this.registerView(LOYALTY_VIEW_TYPE, (leaf: WorkspaceLeaf) => new LoyaltyView(leaf, this));
    this.registerView(ACCOUNTING_VIEW_TYPE, (leaf: WorkspaceLeaf) => new AccountingView(leaf, this));
    this.registerView(PAYROLL_VIEW_TYPE, (leaf: WorkspaceLeaf) => new PayrollView(leaf, this));
    this.registerView(INVENTORY_VIEW_TYPE, (leaf: WorkspaceLeaf) => new InventoryView(leaf, this));
    this.registerView(TASKS_VIEW_TYPE, (leaf: WorkspaceLeaf) => new TasksView(leaf, this));

    this.addRibbonIcon("layout-grid", "OctaSuite", () => void this.openView(LAUNCHER_VIEW_TYPE));

    this.addCommand({ id: "open-launcher", name: "Abrir OctaSuite", callback: () => void this.openView(LAUNCHER_VIEW_TYPE) });
    this.addCommand({ id: "quick-add-expense", name: "Registrar gasto", callback: () => this.openQuickAdd() });
    this.addCommand({ id: "open-expenses", name: "Abrir gastos", callback: () => void this.openView(EXPENSES_VIEW_TYPE) });
    this.addCommand({ id: "open-reports", name: "Abrir reportes", callback: () => void this.openView(REPORTS_VIEW_TYPE) });
    this.addCommand({ id: "open-partners", name: "Abrir contactos", callback: () => void this.openView(PARTNERS_VIEW_TYPE) });
    this.addCommand({ id: "open-products", name: "Abrir productos", callback: () => void this.openView(PRODUCTS_VIEW_TYPE) });
    this.addCommand({ id: "open-invoices", name: "Abrir facturas", callback: () => void this.openView(INVOICES_VIEW_TYPE) });
    this.addCommand({ id: "open-receipts", name: "Abrir entradas de stock", callback: () => void this.openView(RECEIPTS_VIEW_TYPE) });
    this.addCommand({ id: "open-register", name: "Abrir caja", callback: () => void this.openView(REGISTER_VIEW_TYPE) });
    this.addCommand({ id: "open-payables", name: "Abrir pagos", callback: () => void this.openView(PAYABLES_VIEW_TYPE) });
    this.addCommand({ id: "open-leads", name: "Abrir prospectos", callback: () => void this.openView(LEADS_VIEW_TYPE) });
    this.addCommand({ id: "open-accounting", name: "Abrir contabilidad", callback: () => void this.openView(ACCOUNTING_VIEW_TYPE) });
    this.addCommand({ id: "open-payroll", name: "Abrir nómina", callback: () => void this.openView(PAYROLL_VIEW_TYPE) });
    this.addCommand({ id: "open-inventory", name: "Abrir inventario", callback: () => void this.openView(INVENTORY_VIEW_TYPE) });
    this.addCommand({ id: "open-tasks", name: "Abrir tareas", callback: () => void this.openView(TASKS_VIEW_TYPE) });
    this.addCommand({ id: "reload-journal", name: "Recargar datos del vault", callback: () => void this.reload(true) });

    // Consulta viva embebida en una nota:
    //   ```octasuite
    //   periodo: 2026-08
    //   ```
    this.registerMarkdownCodeBlockProcessor("octasuite", (source, el) => this.renderQueryBlock(source, el));

    this.addSettingTab(new OctaSuiteSettingTab(this.app, this));

    // La carga difiere hasta que el workspace está listo: en vaults grandes el
    // adapter todavía no responde durante onload.
    this.app.workspace.onLayoutReady(() => {
      this.normalizeLayout();
      // `reload()` re-asigna `this.ready` y lo resuelve cuando termina la carga más
      // reciente: ninguna vista debe commitear un seed (p. ej. "Principal") contra un
      // estado a medio cargar o de otra empresa.
      void this.reload(false);
    });
  }

  // --- Estado ---------------------------------------------------------------

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<OctaSuiteSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    // Migración v1 → v2: la selección se deriva del selector simple. La
    // normalización contra el disco (empresas borradas) la hace reload().
    this.settings.activeCompanyIds = migrateActiveCompanyIds(stored ?? {});
    this.settings.activeCompanyId = this.settings.activeCompanyIds[0] ?? DEFAULT_COMPANY_ID;
    this.previousActiveCompanyIds = [...this.settings.activeCompanyIds];
  }

  /** Cola secuencial para serializar escrituras de configuración y cambios de journal. */
  private settingsSaveQueue: Promise<void> = Promise.resolve();

  async saveSettings(): Promise<void> {
    this.settingsSaveQueue = this.settingsSaveQueue.then(async () => {
      await this.saveData(this.settings);
      const next = new VaultJournal(this.app.vault, this.settings.dataFolder, this.settings.activeCompanyId);
      // Cambiar la carpeta, la empresa primaria o la selección multi-empresa
      // cambia QUÉ particiones del journal se leen: hay que reconstruir el
      // estado. El resto de campos de settings (perfil, IVA, etc.) no cambian
      // el origen, así que solo se refrescan las vistas (sin re-leer del disco).
      const journalChanged =
        next.folderName !== this.journal.folderName || next.companyIdentifier !== this.journal.companyIdentifier;
      const selectionChanged = !sameActiveCompanyIds(
        this.settings.activeCompanyIds,
        this.previousActiveCompanyIds,
      );
      this.previousActiveCompanyIds = [...this.settings.activeCompanyIds];
      this.journal = next;
      if (journalChanged || selectionChanged) {
        await this.reload(false);
        return;
      }
      this.refreshViews();
    });
    return this.settingsSaveQueue;
  }

  /** Empresas que existen en el journal (las que tienen partición con datos). Fuente única: el filesystem. */
  async journalCompanies(): Promise<string[]> {
    try {
      return await this.journal!.listCompanyIds();
    } catch (error) {
      console.error("[OctaSuite] no se pudieron listar las empresas", error);
      return [this.settings.activeCompanyId];
    }
  }

  /**
   * Fija la selección multi-empresa: normaliza contra las empresas disponibles
   * (dedupe, descarta borradas, nunca vacía), actualiza la primaria si la
   * primera cambió y reconstruye los estados. `saveSettings()` detecta el
   * cambio de partición o de selección y recarga.
   */
  async setActiveCompanyIds(companyIds: string[]): Promise<void> {
    const onDisk = await this.journalCompanies();
    const primary = this.primaryCompanyId;
    if (!onDisk.includes(primary)) onDisk.unshift(primary);
    const next = normalizeActiveCompanyIds(companyIds, onDisk, primary);
    if (sameActiveCompanyIds(next, this.settings.activeCompanyIds)) return;
    this.settings.activeCompanyIds = next;
    this.settings.activeCompanyId = next[0] ?? primary;
    await this.saveSettings();
  }

  /**
   * Crea una empresa: partición del journal + evento `company.created` como primer evento,
   * la activa, y sincroniza la moneda global a la moneda base de la empresa.
   * El ID se deriva del nombre si no se pasa explícitamente.
   */
  async createCompany(name: string, baseCurrency: string, companyId?: string): Promise<string> {
    const id = companyId?.trim() || slugifyCompanyId(name);
    const errors = [
      ...validateCompanyId(id),
      ...validateCompanyDraft({ name, baseCurrency: baseCurrency as CurrencyCode }),
    ];

    // Colisión: empresas con partición existente + la activa aunque aún no tenga datos.
    const taken = new Set(await this.journalCompanies());
    taken.add(this.settings.activeCompanyId);
    if (taken.has(id)) {
      errors.push(new DomainError(`Ya existe una empresa con el ID "${id}"`, "company.id_taken"));
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      // errors[0] existe: este bloque solo corre cuando hay más de un error.
      throw new DomainError(errors.map((e) => e.message).join("; "), errors[0]!.code);
    }

    const event = this.newEvent("company.created", { companyId: id, name, baseCurrency });
    await this.journal.append(event, id);
    // La empresa nueva queda como PRIMARIA y la selección conserva las anteriores.
    this.settings.activeCompanyId = id;
    this.settings.activeCompanyIds = [id, ...this.settings.activeCompanyIds.filter((c) => c !== id)];
    this.settings.currency = baseCurrency;
    await this.saveSettings(); // detecta el cambio de empresa y recarga con la partición nueva.
    return id;
  }



  /** Reconstruye el estado desde el journal, que es la única fuente de verdad. */
  async reload(notify: boolean): Promise<void> {
    // Cada recarga (incluido el cambio de empresa) reinicia `ready`: las vistas que
    // esperan `this.host.ready` deben esperar esta carga, no la del primer arranque.
    // Un generador evita que una recarga vieja que terminó tarde "libere" a las vistas
    // antes de que termine la más reciente (race de sembrar contra el estado equivocado).
    const gen = ++this.reloadGen;
    let settleReady!: () => void;
    this.ready = new Promise<void>((resolve) => {
      settleReady = resolve;
    });

    try {
      await this.journal.ensureFolders();
      // Catálogos opcionales del vault (`{folder}/catalogs/*.json`): sobreescriben
      // los seeds del core si existen y son válidos; un archivo ausente o mal
      // formado se conserva el seed y no tumba el arranque. Idempotente por recarga.
      try {
        await this.catalogs.load();
      } catch (error) {
        console.warn("[OctaSuite] no se pudieron cargar los catálogos del vault", error);
      }

      // Selección efectiva contra el disco: las seleccionadas que ya no existen
      // se descartan y la primaria siempre se mantiene válida aunque su partición
      // todavía no tenga archivos.
      const primary = this.primaryCompanyId;
      const onDisk = await this.journalCompanies();
      if (!onDisk.includes(primary)) onDisk.unshift(primary);
      const selected = normalizeActiveCompanyIds(this.settings.activeCompanyIds, onDisk, primary);
      this.settings.activeCompanyIds = selected;
      this.settings.activeCompanyId = selected[0] ?? primary;

      // Una proyección POR empresa seleccionada (loadAllCompanies carga todas
      // las particiones del journal, cada una en su propio ParseResult).
      const all = await this.journal.loadAllCompanies();
      const nextStates = new Map<string, State>();
      let rejected: RejectedEvent[] = [];
      let corrupt: ParseResult["corrupt"] = [];
      for (const companyId of selected) {
        const parsed = all.get(companyId);
        if (!parsed) {
          // Partición vacía (empresa recién creada sin eventos): estado mínimo.
          nextStates.set(companyId, emptyState());
          continue;
        }
        const { state, rejected: companyRejected } = project(parsed.events);
        nextStates.set(companyId, state);
        rejected = rejected.concat(companyRejected);
        corrupt = corrupt.concat(parsed.corrupt);
      }

      this.statesByCompany = nextStates;
      this.state = nextStates.get(this.settings.activeCompanyId) ?? emptyState();
      this.rejectedCount = rejected.length;
      this.corruptCount = corrupt.length;
      this.lastRejections = rejected;
      this.lastCorrupt = corrupt;

      await this.seedCategoriesIfEmpty();
      this.refreshViews();

      const totalEvents = selected.reduce((acc, id) => acc + (all.get(id)?.events.length ?? 0), 0);
      if (notify) new Notice(`OctaSuite: ${totalEvents} evento(s) cargados en ${selected.length} empresa(s)`);
      if (rejected.length > 0) console.warn("[OctaSuite] eventos rechazados al reconstruir el estado", rejected);
      if (corrupt.length > 0) console.warn("[OctaSuite] líneas ilegibles en el journal", corrupt);
    } catch (error) {
      console.error("[OctaSuite] no se pudo cargar el journal", error);
      new Notice(`OctaSuite: no se pudo leer ${this.settings.dataFolder}. Revisa la consola.`);
    } finally {
      // Solo la recarga más reciente resuelve `ready`. Las anteriores se descartan
      // aunque terminen: liberar antes de tiempo reintroduciría el race.
      if (gen === this.reloadGen) settleReady();
    }
  }

  /** Siembra las categorías por defecto, con los nombres y códigos del ERP. */
  private async seedCategoriesIfEmpty(): Promise<void> {
    if (this.state.categories.size > 0) return;
    for (const name of DEFAULT_EXPENSE_CATEGORY_NAMES) {
      await this.commit(
        this.newEvent("category.created", { categoryId: generateId("cat"), name, code: categoryCode(name) }),
        { silent: true },
      );
    }
  }

  newEvent<T extends AnyEvent["type"]>(type: T, payload: unknown): AnyEvent {
    return { id: generateId("evt"), at: new Date().toISOString(), v: 1, type, payload } as AnyEvent;
  }

  /** Agrega el hecho al journal y lo aplica al estado en memoria. */
  async commit(event: AnyEvent, options: { silent?: boolean; companyId?: string } = {}): Promise<boolean> {
    const rejection = apply(this.state, event);
    if (rejection) {
      new Notice(`OctaSuite: ${rejection.reason}`);
      return false;
    }
    try {
      await this.journal.append(event, options.companyId);
    } catch (error) {
      console.error("[OctaSuite] no se pudo escribir el journal", error);
      new Notice("OctaSuite: el cambio NO se guardó en disco. Revisa la consola.");
      // El estado en memoria quedó adelantado al disco: se reconstruye para no
      // mostrarle al usuario algo que no está guardado.
      await this.reload(false);
      return false;
    }
    if (!options.silent) this.refreshViews();
    return true;
  }

  // --- Navegación -----------------------------------------------------------

  openModule(mod: ModuleDef): void {
    if (mod.status === "ready") {
      if (mod.id === SETTINGS_MODULE_ID) {
        this.openSettings();
        return;
      }
      if (mod.viewType) void this.openView(mod.viewType);
      return;
    }
    const prefix = mod.status === "server" ? "Requiere el servidor de OctaSuite" : "En construcción";
    new Notice(`${mod.name} — ${prefix}.\n${mod.reason ?? ""}`.trim(), 8000);
  }

  private openSettings(): void {
    // `app.setting` no es API pública; si cambia, se avisa en vez de fallar callado.
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    if (!setting) {
      new Notice("Abrí Configuración → Plugins de la comunidad → OctaSuite Lite.");
      return;
    }
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  /** Hojas que muestran alguna vista de OctaSuite. */
  private octasuiteLeaves(): WorkspaceLeaf[] {
    const leaves: WorkspaceLeaf[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      // Por prefijo y no por lista exacta: cualquier vista octasuite-* (incluidas
      // de versiones anteriores o con divergencia de constante) se reutiliza en
      // lugar de abrir una pestaña nueva al navegar.
      if (isOctaSuiteViewType(leaf.getViewState().type)) leaves.push(leaf);
    });
    return leaves;
  }

  private isInMain(leaf: WorkspaceLeaf): boolean {
    return leaf.getRoot() === this.app.workspace.rootSplit;
  }

  /**
   * Navega dentro de la MISMA hoja: cambiar de módulo reemplaza el contenido en
   * vez de abrir otra pestaña. Antes, recorrer seis mosaicos dejaba seis
   * pestañas de OctaSuite abiertas.
   *
   * La hoja ACTIVA tiene prioridad: si ya estás dentro de OctaSuite, "volver al
   * inicio" (y cualquier otro navigación) convierte ESA hoja en la vista pedida.
   * Sin esto, con varias hojas abiertas (ej. panel lateral + main tras usar
   * "abrir en ventana completa"), la flecha revelaba/creaba otra pestaña en vez
   * de regresar.
   */
  async openView(viewType: string): Promise<void> {
    const { workspace } = this.app;
    const ours = this.octasuiteLeaves();

    // 1) La hoja activa ya es de OctaSuite: navegar en ella, nunca abrir otra.
    const activeLeaf = workspace.getMostRecentLeaf();
    if (activeLeaf && ours.includes(activeLeaf)) {
      await activeLeaf.setViewState({ type: viewType, active: true });
      await workspace.revealLeaf(activeLeaf);
      return;
    }

    // 2) La vista pedida ya está abierta en alguna hoja: revelarla sin duplicar.
    const existing = ours.find((leaf) => leaf.getViewState().type === viewType);
    if (existing) {
      await workspace.revealLeaf(existing);
      return;
    }

    // 3) Reutilizar una hoja de OctaSuite existente en la zona preferida.
    const wantsSidebar = this.settings.openLocation === "sidebar";
    const target = ours.find((leaf) => this.isInMain(leaf) !== wantsSidebar) ?? ours[0];
    if (target) {
      await target.setViewState({ type: viewType, active: true });
      await workspace.revealLeaf(target);
      return;
    }

    // 4) Primera vez: crear la hoja según la ubicación configurada.
    const leaf = wantsSidebar ? workspace.getRightLeaf(false) : workspace.getLeaf("tab");
    if (!leaf) return;
    await leaf.setViewState({ type: viewType, active: true });
    await workspace.revealLeaf(leaf);
  }

  openHome(): void {
    void this.openView(LAUNCHER_VIEW_TYPE);
  }

  /**
   * Abre el módulo en el área principal sin cerrar el panel lateral, que vuelve
   * al lanzador: el lateral queda como acceso rápido y el detalle se ve ancho.
   */
  expandToMain(viewType: string): void {
    void (async () => {
      const { workspace } = this.app;
      const existingMain = this.octasuiteLeaves().find((leaf) => this.isInMain(leaf));
      const leaf = existingMain ?? workspace.getLeaf("tab");
      await leaf.setViewState({ type: viewType, active: true });
      await workspace.revealLeaf(leaf);

      for (const sidebar of this.octasuiteLeaves()) {
        if (!this.isInMain(sidebar) && sidebar.getViewState().type === viewType) {
          await sidebar.setViewState({ type: LAUNCHER_VIEW_TYPE });
        }
      }
    })();
  }

  /**
   * Deja el layout guardado en el estado que el plugin espera: nada de versiones
   * anteriores, y nada en las barras laterales si el usuario eligió el área
   * principal.
   *
   * Barre TODAS las hojas por prefijo, no solo los tipos vigentes: el vault de
   * pruebas tenía una hoja `octasuite-dashboard` de la v0.1, un tipo que ya no
   * se registra, y ningún barrido por tipo conocido la alcanzaba.
   *
   * `getViewState()` lee el tipo sin instanciar la vista, que es lo correcto
   * para las hojas diferidas de las barras laterales.
   */
  private normalizeLayout(): void {
    const { workspace } = this.app;
    const stale: WorkspaceLeaf[] = [];

    workspace.iterateAllLeaves((leaf) => {
      const type = leaf.getViewState().type;
      if (!type.startsWith(VIEW_TYPE_PREFIX)) return;
      const isLegacy = !KNOWN_VIEW_TYPES.includes(type);
      // El lateral solo se limpia si el usuario eligió el área principal.
      const misplaced = this.settings.openLocation === "main" && leaf.getRoot() !== workspace.rootSplit;
      if (isLegacy || misplaced) stale.push(leaf);
    });

    if (stale.length === 0) return;
    for (const leaf of stale) leaf.detach();
    // Sin esto el layout limpio no se persiste hasta el proximo cambio manual.
    void workspace.requestSaveLayout();
    console.info(`[OctaSuite] ${stale.length} panel(es) retirados del layout guardado`);
  }

  openQuickAdd(): void {
    const categories = [...this.state.categories.values()].filter((c) => !c.archived);
    new QuickAddExpenseModal(
      this.app,
      this.settings.currency,
      categories.map((c) => c.name),
      async ({ draft, categoryName }) => {
        const category = categories.find((c: Category) => c.name === categoryName);
        const ok = await this.commit(
          this.newEvent("expense.created", {
            expenseId: generateId("exp"),
            ...draft,
            ...(category ? { categoryId: category.id } : {}),
          }),
        );
        if (ok) new Notice(`Gasto registrado: ${format(draft.amount, this.settings.locale)}`);
      },
    ).open();
  }

  private refreshViews(): void {
    for (const viewType of REFRESHABLE) {
      for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
        const view = leaf.view as { refresh?: () => void };
        view.refresh?.();
      }
    }
  }

  // --- Bloque embebido ------------------------------------------------------

  private renderQueryBlock(source: string, el: HTMLElement): void {
    const options = new Map<string, string>();
    for (const line of source.split("\n")) {
      const match = /^\s*([a-zA-Z]+)\s*:\s*(.+?)\s*$/.exec(line);
      if (match?.[1] && match[2]) options.set(match[1].toLowerCase(), match[2]);
    }
    const month = options.get("periodo") ?? monthKeyOf(toIsoDate(new Date()));
    const currency = options.get("moneda") ?? this.settings.currency;

    let gastos;
    let facturado;
    try {
      gastos = totalExpenses(this.state, month, currency);
      facturado = totalInvoiced(this.state, month, currency);
    } catch (error) {
      el.createEl("p", { text: `OctaSuite: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    el.addClass("octa");
    const table = el.createEl("table", { cls: "octa-table" });
    const tbody = table.createEl("tbody");
    const row = (label: string, value: string) => {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: label });
      tr.createEl("td", { text: value, cls: "octa-num" });
    };
    row(`Facturado ${month}`, format(facturado, this.settings.locale));
    row(`Gastos ${month}`, format(gastos, this.settings.locale));
    row("Diferencia", format({ minor: facturado.minor - gastos.minor, currency }, this.settings.locale));

    if (options.get("detalle") === "categorias") {
      const byCategory = expensesByCategory(this.state, month, currency);
      for (const [categoryId, amount] of [...byCategory.entries()].sort((a, b) => b[1].minor - a[1].minor)) {
        row(this.state.categories.get(categoryId)?.name ?? "Sin categoría", format(amount, this.settings.locale));
      }
    }
  }
}

class OctaSuiteSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: OctaSuitePlugin,
  ) {
    super(app, plugin);
  }

  /**
   * Selector de empresas activas (multi-selección). La primera seleccionada
   * es la primaria: partición que se lee y escribe. Se monta el mismo
   * componente `company-switcher` que usan el launcher y la barra de módulos,
   * para que el comportamiento sea idéntico en todos los puntos de entrada.
   */
  private renderCompanySwitcher(containerEl: HTMLElement): void {
    const row = new Setting(containerEl)
      .setName("Empresas activas")
      .setDesc(
        "Selecciona las empresas que se ven consolidadas en Inicio y Reportes. La PRIMERA es la primaria: ahí se escriben los documentos. Usa el selector de cada módulo para reordenar eligiendo otra empresa.",
      );
    mountCompanySwitcher(row.settingEl, this.plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Carpeta de datos")
      .setDesc("Donde vive el journal dentro del vault. Cambiarla no mueve los datos existentes.")
      .addText((text) =>
        text.setValue(this.plugin.settings.dataFolder).onChange(async (value) => {
          this.plugin.settings.dataFolder = value.trim() || DEFAULT_SETTINGS.dataFolder;
          await this.plugin.saveSettings();
        }),
      );

    this.renderCompanySwitcher(containerEl);

    // ── Crear empresa ───────────────────────────────────────────────
    {
      let name = "";
      let baseCurrency: CurrencyCode = this.plugin.settings.currency as CurrencyCode;
      let customId = "";

      new Setting(containerEl)
        .setName("Crear empresa")
        .setDesc("Escribe un nombre para crear una partición nueva del journal.")
        .addText((text) =>
          text
            .setPlaceholder("Nombre de la nueva empresa")
            .onChange((value) => {
              name = value.trim();
            }),
        );

      new Setting(containerEl)
        .setName("Moneda base")
        .setDesc("Define la moneda funcional de esta empresa.")
        .addDropdown((dropdown) => {
          for (const code of knownBaseCurrencies()) dropdown.addOption(code, code);
          dropdown.setValue(baseCurrency);
          dropdown.onChange((value) => {
            baseCurrency = value as CurrencyCode;
          });
        });

      new Setting(containerEl)
        .setName("ID de carpeta (opcional)")
        .setDesc("Ej: `secundaria`. Por defecto se deriva del nombre.")
        .addText((text) =>
          text
            .setPlaceholder("auto desde el nombre")
            .onChange((value) => {
              customId = value.trim();
            }),
        );

      new Setting(containerEl).addButton((button) =>
        button
          .setButtonText("Crear")
          .setCta()
          .onClick(async () => {
            try {
              const id = await this.plugin.createCompany(name, baseCurrency, customId);
              new Notice(`Empresa creada: ${id}`);
              this.display();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : String(error));
            }
          }),
      );
    }

    // ── Moneda ──────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Moneda")
      .setDesc("Código ISO 4217. Los importes se guardan en centavos de esta moneda.")
      .addText((text) =>
        text.setValue(this.plugin.settings.currency).onChange(async (value) => {
          this.plugin.settings.currency = value.trim().toUpperCase() || DEFAULT_SETTINGS.currency;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Tasa de IVA por defecto")
      .setDesc("Porcentaje aplicado a las líneas de factura cuando el producto no define el suyo.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.defaultTaxRate)).onChange(async (value) => {
          const rate = Number(value);
          if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
            new Notice("La tasa debe estar entre 0 y 100");
            return;
          }
          this.plugin.settings.defaultTaxRate = rate;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Serie de facturación")
      .setDesc("Prefijo del correlativo. El número se asigna consecutivo y sin huecos.")
      .addText((text) =>
        text.setValue(this.plugin.settings.invoiceSeries).onChange(async (value) => {
          this.plugin.settings.invoiceSeries = value.trim() || DEFAULT_SETTINGS.invoiceSeries;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Dónde abrir OctaSuite")
      .setDesc("En el área principal las listas tienen más ancho; en el lateral queda como panel de consulta rápida, con un botón para expandir.")
      .addDropdown((d) => {
        d.addOption("main", "Área principal");
        d.addOption("sidebar", "Panel lateral derecho");
        d.setValue(this.plugin.settings.openLocation).onChange(async (value) => {
          this.plugin.settings.openLocation = value === "sidebar" ? "sidebar" : "main";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Forma de pago preseleccionada")
      .setDesc("Solo es el valor inicial del diálogo de cobro; siempre se puede cambiar al registrar.")
      .addText((text) =>
        text.setValue(this.plugin.settings.defaultPaymentMethod).onChange(async (value) => {
          this.plugin.settings.defaultPaymentMethod = value.trim() || DEFAULT_SETTINGS.defaultPaymentMethod;
          await this.plugin.saveSettings();
        }),
      );

    // Empresa
    containerEl.createEl("h3", { text: "Empresa" });
    containerEl.createEl("p", { cls: "setting-item-description", text: "Datos que aparecen en los recibos de pago." });

    new Setting(containerEl)
      .setName("Nombre de la empresa")
      .addText((text) =>
        text.setValue(this.plugin.settings.companyName || "").onChange(async (value) => {
          this.plugin.settings.companyName = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("NIT")
      .setDesc("Número de Identificación Tributaria.")
      .addText((text) =>
        text.setValue(this.plugin.settings.companyTaxId || "").onChange(async (value) => {
          this.plugin.settings.companyTaxId = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Dirección")
      .addText((text) =>
        text.setValue(this.plugin.settings.companyAddress || "").onChange(async (value) => {
          this.plugin.settings.companyAddress = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Teléfono")
      .addText((text) =>
        text.setValue(this.plugin.settings.companyPhone || "").onChange(async (value) => {
          this.plugin.settings.companyPhone = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Email")
      .addText((text) =>
        text.setValue(this.plugin.settings.companyEmail || "").onChange(async (value) => {
          this.plugin.settings.companyEmail = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Logo")
      .setDesc("Ruta de la imagen dentro del vault (ej: octasuite-data/logo.png).")
      .addText((text) =>
        text.setValue(this.plugin.settings.companyLogo || "").onChange(async (value) => {
          this.plugin.settings.companyLogo = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Pie de recibo")
      .setDesc("Texto que aparece al final de los recibos de pago.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.receiptFooter || "").onChange(async (value) => {
          this.plugin.settings.receiptFooter = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Recargar datos")
      .setDesc("Vuelve a leer el journal desde el vault y reconstruye el estado.")
      .addButton((button) =>
        button.setButtonText("Recargar").onClick(async () => {
          await this.plugin.reload(true);
        }),
      );

    const info = containerEl.createDiv({ cls: "octa-footnote" });
    info.setText(`Modo Personal. Módulos de servidor: ${STATUS_LABEL.server.toLowerCase()} — ver ADR-001.`);
  }
}
