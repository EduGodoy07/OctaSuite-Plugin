import {
  listRegisteredUoms,
  registerCurrencies,
  registerUnitsOfMeasure,
  registerUoms,
  uomKeyOf,
  type CurrencyMeta,
  type UnitOfMeasure,
  type UomEntry,
} from "@octasuite/core";
import type { DataAdapter } from "obsidian";

/**
 * Catalogos de SAT/UoM y monedas que el dominio puro no puede leer del vault
 * (el core no tiene dependencias de Obsidian). Este adaptador lee cada
 * `{folder}/catalogs/*.json` en el arranque y aplica el override al registro en
 * memoria del core via `registerCurrencies` / `registerUnitsOfMeasure` /
 * `registerUoms`.
 *
 * Los archivos son opcionales: si no existen (vault nuevo o sin catalogo
 * exportado), se conserva el seed por defecto del core. Un archivo mal formado
 * no debe tumbar el arranque: se ignora (y se reporta) en lugar de lanzar.
 */

interface CatalogsShape {
  currencies: readonly CurrencyMeta[] | undefined;
  uom: readonly UnitOfMeasure[] | undefined;
  /** UoM de negocio (vault, `{name, category}`) — el catalogo personal del usuario. */
  uoms?: readonly UomEntry[] | undefined;
}

function isCurrencyMeta(v: unknown): v is CurrencyMeta {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.code === "string" &&
    typeof c.name === "string" &&
    typeof c.symbol === "string" &&
    c.symbol.length > 0 &&
    typeof c.decimals === "number" &&
    Number.isInteger(c.decimals) &&
    c.decimals >= 0 &&
    c.decimals <= 8
  );
}

function isUnitOfMeasure(v: unknown): v is UnitOfMeasure {
  if (typeof v !== "object" || v === null) return false;
  const u = v as Record<string, unknown>;
  return typeof u.code === "string" && typeof u.name === "string" && typeof u.symbol === "string";
}

function isUomEntry(v: unknown): v is UomEntry {
  if (typeof v !== "object" || v === null) return false;
  const u = v as Record<string, unknown>;
  return typeof u.name === "string" && u.name.length > 0 && typeof u.category === "string" && u.category.length > 0;
}

/**
 * Lee y valida un catalogo opcional. Devuelve undefined si no existe o es invalido.
 *
 * Modo estricto (default): una fila invalida descarta el catalogo COMPLETO
 * (catalogos SAT de referencia — mas vale ninguno que uno corrupto).
 * Modo tolerante: descarta solo las filas invalidas y conserva las validas
 * (uoms.json es el catalogo personal del usuario, generado/escrito por la UI:
 * una fila corrupta no debe tumbar el resto del catalogo).
 */
async function readCatalog<T>(
  adapter: DataAdapter,
  path: string,
  guard: (v: unknown) => v is T,
  mode: "strict" | "tolerant" = "strict",
): Promise<readonly T[] | undefined> {
  if (!(await adapter.exists(path))) return undefined;
  let raw: string;
  try {
    raw = await adapter.read(path);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  let items: unknown[] = parsed;
  if (mode === "strict") {
    if (!items.every(guard)) return undefined;
  } else {
    items = items.filter(guard);
  }
  // Un catalogo bien formado pero vacio (o sin filas validas en modo tolerante)
  // no debe borrar el seed por defecto: se trata como "sin override" (igual que
  // si el archivo no existiera).
  if (items.length === 0) return undefined;
  return items as readonly T[];
}

export class VaultCatalogs {
  constructor(private readonly folder: string, private readonly adapter: DataAdapter) {}

  private catalogPath(file: string): string {
    return `${this.folder}/catalogs/${file}`;
  }

  /**
   * Serializa los saves de `uoms.json` DENTRO de esta instancia: la secuencia
   * leer-dedup-escribir corre de a una para que dos `saveUom` en vuelo (rapidas
   * de saves de la misma ventana; la UI comparte una unica instancia vía el
   * host) no se pisen entre si — de otro modo ambas leen el mismo estado, ambas
   * agregan y la ultima escritura pierde la primera (lost update).
   * Alcance: intra-ventana. Cada ventana de Obsidian es un proceso JS aparte
   * con su propia instancia del plugin; la serialización no cruza ventanas
   * (eso requeriria un lock a nivel archivo, fuera de alcance).
   */
  private saveUomSerial: Promise<void> = Promise.resolve();

  /** Lee todos los catalogos opcionales y aplica los overrides al core. */
  async load(): Promise<CatalogsShape> {
    const [currencies, uom, uoms] = await Promise.all([
      readCatalog(this.adapter, this.catalogPath("currencies.json"), isCurrencyMeta),
      readCatalog(this.adapter, this.catalogPath("uom-sat.json"), isUnitOfMeasure),
      readCatalog(this.adapter, this.catalogPath("uoms.json"), isUomEntry, "tolerant"),
    ]);

    if (currencies) registerCurrencies(currencies);
    if (uom) registerUnitsOfMeasure(uom);
    if (uoms) registerUoms(uoms);

    return { currencies, uom, uoms };
  }

  /**
   * Agrega una UoM de negocio al catalogo personal del vault (`uoms.json`) y
   * sincroniza el registro en memoria. Devuelve false si ya existe (comparacion
   * normalizada via `uomKeyOf`, igual que `resolveUom`) o si la entrada no es
   * valida (`isUomEntry`) — no crea duplicados.
   * El archivo es la fuente de verdad persistente; `registerUoms` solo actualiza
   * la sesion actual en memoria.
   *
   * Sin archivo previo parte del catalogo VIGENTE en memoria (`listRegisteredUoms`,
   * que es el seed por defecto) y materializa seed + nueva en disco — asi el
   * primer save custom nunca reemplaza el catálogo entero por una sola entrada.
   * Nota: "sin archivo" incluye archivo vacio (`[]`) o corrupto — `readCatalog`
   * tolerante los trata como inexistentes y el save los auto-repara escribiendo
   * seed + nueva encima (no se puede "vaciar" el catalogo con `[]`).
   * Con archivo existente (valido), el archivo manda (contrato de reemplazo de
   * `load()`).
   *
   * Los saves concurrentes se serializan dentro de la instancia (la UI comparte
   * una sola instancia via el host): la seccion critica corre de a una, nunca
   * dos read-modify-write solapados. No cruza ventanas de Obsidian — cada
   * ventana es un proceso JS aparte con su propio mutex.
   */
  async saveUom(entry: UomEntry): Promise<boolean> {
    if (!isUomEntry(entry)) return false;
    const run = this.saveUomSerial.then(() => this.saveUomUnlocked(entry));
    // La cadena nunca se rompe para los siguientes: un write fallido no deja
    // encolados a los demas detras de una promesa rechazada.
    this.saveUomSerial = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async saveUomUnlocked(entry: UomEntry): Promise<boolean> {
    const path = this.catalogPath("uoms.json");
    const current = (await readCatalog(this.adapter, path, isUomEntry, "tolerant")) ?? listRegisteredUoms();
    const key = uomKeyOf(entry.name);
    if (current.some((u) => uomKeyOf(u.name) === key)) return false;
    const next = [...current, entry];
    await this.adapter.write(path, JSON.stringify(next, null, 2));
    registerUoms(next);
    return true;
  }
}
