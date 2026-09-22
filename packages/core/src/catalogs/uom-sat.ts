/**
 * Catalogo de unidades de medida — nomenclatura SAT.
 *
 * Fuente: tabla SAT-IA-008 "Tipo de unidad de medida" de la Intendencia de
 * Aduanas de la SAT (metodo de la Declaracion Unica Centroamericana / DUCA),
 * que el esquema DTE del Regimen FEL adopta explicitamente para el elemento
 * `UnidadMedida` del item: "Si el emisor lo desea, puede utilizar la
 * nomenclatura definida por la Intendencia de Aduanas de la SAT en su tabla
 * SAT-IA-008".
 *
 * Nota de alcance: este seed contiene el subconjunto de la tabla SAT-IA-008 que
 * se pudo verificar contra la fuente oficial (7 codigos). La tabla completa
 * vive en un documento adicional de la SAT y no se incluye aqui hasta
 * extraerse; mientras tanto el plugin queda con el minimo verificable.
 *
 * El core no lee archivos del vault: este seed es el valor inicial de un
 * registro en memoria que el adaptador de Obsidian puede reemplazar cargando
 * `octasuite-data/catalogs/uom-sat.json` via `registerUnitsOfMeasure`.
 */

export interface UnitOfMeasure {
  /** Codigo de la tabla SAT (ej. `KGS`). */
  readonly code: string;
  /** Descripcion oficial (ej. `KILOGRAMO`). */
  readonly name: string;
  /** Abreviatura legible para la UI (ej. `kg`). */
  readonly symbol: string;
}

/** Seed minimo verificado de SAT-IA-008 (subconjunto, ver nota de alcance). */
export const UOM_SAT: readonly UnitOfMeasure[] = [
  { code: "MTS", name: "METROS", symbol: "m" },
  { code: "MT2", name: "METROS CUADRADOS", symbol: "m²" },
  { code: "MT3", name: "METROS CUBICOS", symbol: "m³" },
  { code: "KGS", name: "KILOGRAMO", symbol: "kg" },
  { code: "LTS", name: "LITROS", symbol: "L" },
  { code: "PAR", name: "PAR", symbol: "par" },
  { code: "CBZ", name: "CABEZA", symbol: "cbz" },
];

/**
 * Registro mutable, mismo patron que `currencies.ts`: seed como valor inicial y
 * reemplazo por completo via `registerUnitsOfMeasure`.
 */
let registry: readonly UnitOfMeasure[] = UOM_SAT;

export function registerUnitsOfMeasure(entries: readonly UnitOfMeasure[]): void {
  registry = entries;
}

export function unitOfMeasure(code: string): UnitOfMeasure | undefined {
  return registry.find((u) => u.code === code);
}

/** Descripcion legible o el codigo como fallback, para UI. */
export function unitLabel(code: string): string {
  return unitOfMeasure(code)?.name ?? code;
}
