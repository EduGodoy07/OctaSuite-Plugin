/**
 * Catalogo de NOMBRES de unidad de medida (uoms) para la UI.
 *
 * Tres bloques:
 *  1. Los 26 valores reales que OctaSuite seedea en su `UOMSeeder.php` (los
 *     UoM clasicos de Odoo: Units, kg, m, L, etc.) — intactos.
 *  2. Nombres de negocio es_GT: Unidades, Docenas, Dias, Horas, Minutos.
 *  3. Categoria `Empaque`: empaques genericos (Caja, Carton, Tira, Paquete)
 *     + una lista curada de fardos numerados de uso cotidiano (Fardo 4..72).
 *
 * CONVENCION SIN ACENTOS: "Dias", no "Dias" con tilde. El filtro de
 * `suggestUoms` es substring lowercase y NO normaliza diacriticos — teclear
 * "dia" no matchearia el nombre con tilde. Mantener es_GT sin acentos
 * garantiza que el autocompletado encuentre lo que el usuario escribe.
 *
 * La lista de fardos es una convencion generica de retail, NO una copia del
 * catalogo operativo de ningun cliente (regla de aislamiento de IP).
 *
 * Es el catalogo de PRESENTACION: el campo libre "Unidad" de un producto lo
 * usa para autocompletar, pero el texto final queda libre (el DTE de
 * Guatemala cae en `product_uom_abbrev ?? 'UNI'` cuando viene vacio).
 *
 * No confundir con `uom-sat.ts`: ese es el catalogo del ESQUEMA DTE
 * (SAT-IA-008, codigos MTS/KGS/LTS...) y se mantiene aparte como referencia.
 * Este catalogo son nombres legibles que el usuario escribe, no codigos.
 */
export interface UomEntry {
  readonly name: string;
  readonly category: string;
}

const CAT_UNIDADES = "Unidades";
const CAT_PESO = "Peso";
const CAT_TIEMPO = "Tiempo";
const CAT_LONGITUD = "Longitud";
const CAT_AREA = "Area";
const CAT_VOLUMEN = "Volumen";
const CAT_EMPAQUE = "Empaque";

export const UOMS: readonly UomEntry[] = [
  // Unidades
  { name: "Units", category: CAT_UNIDADES },
  { name: "Dozens", category: CAT_UNIDADES },
  // Peso
  { name: "kg", category: CAT_PESO },
  { name: "g", category: CAT_PESO },
  { name: "t", category: CAT_PESO },
  { name: "lb", category: CAT_PESO },
  { name: "oz", category: CAT_PESO },
  // Tiempo
  { name: "Days", category: CAT_TIEMPO },
  { name: "Hours", category: CAT_TIEMPO },
  // Longitud
  { name: "m", category: CAT_LONGITUD },
  { name: "mm", category: CAT_LONGITUD },
  { name: "km", category: CAT_LONGITUD },
  { name: "cm", category: CAT_LONGITUD },
  { name: "in", category: CAT_LONGITUD },
  { name: "ft", category: CAT_LONGITUD },
  { name: "yd", category: CAT_LONGITUD },
  { name: "mi", category: CAT_LONGITUD },
  // Area
  { name: "m²", category: CAT_AREA },
  { name: "ft²", category: CAT_AREA },
  // Volumen
  { name: "L", category: CAT_VOLUMEN },
  { name: "m³", category: CAT_VOLUMEN },
  { name: "fl oz (US)", category: CAT_VOLUMEN },
  { name: "qt (US)", category: CAT_VOLUMEN },
  { name: "gal (US)", category: CAT_VOLUMEN },
  { name: "in³", category: CAT_VOLUMEN },
  { name: "ft³", category: CAT_VOLUMEN },
  // Nombres de negocio es_GT (sin acentos — ver nota de cabecera)
  { name: "Unidades", category: CAT_UNIDADES },
  { name: "Docenas", category: CAT_UNIDADES },
  { name: "Dias", category: CAT_TIEMPO },
  { name: "Horas", category: CAT_TIEMPO },
  { name: "Minutos", category: CAT_TIEMPO },
  // Empaque — genericos y fardos numerados curados (convencion de retail)
  { name: "Fardo", category: CAT_EMPAQUE },
  { name: "Fardo 4", category: CAT_EMPAQUE },
  { name: "Fardo 5", category: CAT_EMPAQUE },
  { name: "Fardo 6", category: CAT_EMPAQUE },
  { name: "Fardo 8", category: CAT_EMPAQUE },
  { name: "Fardo 10", category: CAT_EMPAQUE },
  { name: "Fardo 12", category: CAT_EMPAQUE },
  { name: "Fardo 20", category: CAT_EMPAQUE },
  { name: "Fardo 24", category: CAT_EMPAQUE },
  { name: "Fardo 36", category: CAT_EMPAQUE },
  { name: "Fardo 72", category: CAT_EMPAQUE },
  { name: "Caja", category: CAT_EMPAQUE },
  { name: "Cajita", category: CAT_EMPAQUE },
  { name: "Carton", category: CAT_EMPAQUE },
  { name: "Tira", category: CAT_EMPAQUE },
  { name: "Paquete", category: CAT_EMPAQUE },
];

const SUGGEST_LIMIT = 8;

/**
 * Registro mutable (mismo patron que `currencies.ts`): el seed por defecto
 * sigue vigente hasta que `registerUoms` lo reemplace con un catalogo externo
 * (ej. `octasuite-data/catalogs/uoms.json` cargado por el adaptador de
 * Obsidian). El seed nunca se muta.
 */
let registry: readonly UomEntry[] = UOMS;

export function registerUoms(entries: readonly UomEntry[]): void {
  registry = entries;
}

/**
 * Devuelve el catalogo VIGENTE en memoria (el seed, o el override registrado
 * por un adaptador vía `registerUoms`). Es el getter público del registro —
 * útil para adaptadores que deben materializar el catalogo efectivo (seed +
 * entradas custom) sin depender del seed estático `UOMS`.
 *
 * Devuelve una copia (no la referencia interna): los callers no pueden mutar
 * el seed exportado ni el registro vigente desde fuera.
 */
export function listRegisteredUoms(): readonly UomEntry[] {
  return [...registry];
}

/** Resuelve la categoria de un nombre de UoM, o undefined si no existe. */
export function uomCategory(name: string): string | undefined {
  return registry.find((u) => u.name === name)?.category;
}

/**
 * Filtro simple para autocompletar: substring case-insensitive sobre el
 * nombre, en el orden del catalogo (agrupado por categoria). Devuelve como
 * maximo `limit` sugerencias; con query vacio devuelve el inicio del catalogo.
 */
export function suggestUoms(query: string, limit = SUGGEST_LIMIT): readonly UomEntry[] {
  const q = query.trim().toLowerCase();
  const matches = q.length === 0 ? registry : registry.filter((u) => u.name.toLowerCase().includes(q));
  return matches.slice(0, limit);
}

/**
 * Normaliza un texto de entrada para comparar contra el catalogo:
 * trim, lowercase y NFD-strip de diacriticos. El catalogo es SIN ACENTOS por
 * convencion ("Dias", "Horas") pero el usuario puede teclear "Días" o "Hóras"
 * — esta normalizacion hace que ambos caigan en la misma entrada canonica.
 * No confundir con `suggestUoms`, que es SUBSTRING de autocompletar; esto es
 * comparacion EXACTA post-normalizacion, pensada para validar/guardar.
 */
function uomKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Version publica de la normalizacion interna `uomKey`: expone la misma clave
 * normalizada que usa `resolveUom` para que adaptadores (ej. `VaultCatalogs`
 * en Obsidian) puedan deduplicar un catalogo externo contra el registro en
 * memoria sin depender de un detalle interno.
 */
export function uomKeyOf(raw: string): string {
  return uomKey(raw);
}

/**
 * Sinonimos es_GT de negocio -> nombre canonico del catalogo. El usuario
 * guatemalteco teclea "kilos" o "libras"; el catalogo guarda "kg"/"lb". Las
 * claves van NORMALIZADAS (mismo `uomKey`: lowercase, sin diacriticos) porque
 * la busqueda ocurre despues de normalizar la entrada.
 *
 * Regla de precedencia N°1: el catalogo extensible SIEMPRE gana. Si una UoM
 * llamada "kilos" se registra vía `registerUoms` (ej. `uoms.json` del vault),
 * el match directo sobre el registry se resuelve antes de consultar este mapa,
 * por lo que la entrada real (con su propia categoria) tiene prioridad sobre
 * el sinonimo estatico.
 *
 * Regla N°2: los alias NUNCA apuntan a un texto libre; cada valor existe como
 * nombre canonico en el seed del catalogo, asi el resultado de `resolveUom`
 * conserva categoria y normalizacion.
 *
 * Regla N°3: no se mapean ambiguos. "unidades" no tiene alias a "Units"
 * porque "Unidades" ya es entrada canonica exacta; "dias" ya resuelve a
 * "Dias" via normalizacion de diacriticos.
 */
export const UOMS_ALIASES: Readonly<Record<string, string>> = {
  // Peso
  kilos: "kg",
  kilogramos: "kg",
  gramos: "g",
  libras: "lb",
  onzas: "oz",
  // Volumen
  litros: "L",
  galones: "gal (US)",
  "onzas fluidas": "fl oz (US)",
  cuartos: "qt (US)",
  // Longitud
  metros: "m",
  centimetros: "cm",
  kilometros: "km",
  milimetros: "mm",
  pulgadas: "in",
  pies: "ft",
  yardas: "yd",
  millas: "mi",
  // Area / Volumen cubico
  "metros cuadrados": "m²",
  "pies cuadrados": "ft²",
  "metros cubicos": "m³",
  "pies cubicos": "ft³",
  // Empaque — plurales de negocio
  cajas: "Caja",
  cajitas: "Cajita",
  cartones: "Carton",
  tiras: "Tira",
  paquetes: "Paquete",
  fardos: "Fardo",
};

/**
 * Resuelve un texto a la entrada canonica del catalogo, o undefined si no
 * existe ninguna UoM con ese nombre (comparacion exacta case-insensitive y
 * sin acentos). Devuelve siempre el NOMBRE CANONICO del catalogo (ej. "KG"
 * o "kG" resuelven a "kg", "Días" a "Dias"). NO hace match por substring:
 * "fardo" no resuelve "Fardo 4" y "unidades extra" no resuelve "Unidades".
 *
 * Los sinonimos es_GT (`UOMS_ALIASES`) se consultan SOLO como fallback cuando
 * el match directo contra el registry falla — el catalogo extensible creado
 * por el usuario siempre tiene prioridad sobre el sinonimo estatico.
 */
export function resolveUom(raw: string): UomEntry | undefined {
  const key = uomKey(raw);
  if (key.length === 0) return undefined;
  const direct = registry.find((u) => uomKey(u.name) === key);
  if (direct) return direct;
  const canonicalName = UOMS_ALIASES[key];
  if (canonicalName === undefined) return undefined;
  return registry.find((u) => u.name === canonicalName);
}

/** True si el texto corresponde exactamente a una UoM conocida del catalogo. */
export function isKnownUom(raw: string): boolean {
  return resolveUom(raw) !== undefined;
}