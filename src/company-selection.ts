/**
 * Selección de empresa multi-empresa (lógica pura, sin dependencias de obsidian).
 *
 * `activeCompanyIds` es el estado fuente de qué empresas mira el usuario:
 * lista ordenada donde la PRIMERA es la primaria (destino de escrituras) y el
 * resto son empresas de solo-lectura para dashboards/reportes consolidados.
 *
 * Dos responsabilidades separadas:
 * - `migrateActiveCompanyIds`: deriva la lista desde settings guardados
 *   (v1 tenía solo `activeCompanyId`). No conoce el disco; si un id dejó de
 *   existir, `normalizeActiveCompanyIds` lo sanea contra las disponibles en
 *   el primer reload.
 * - `normalizeActiveCompanyIds`: sanea una lista contra las empresas
 *   disponibles (dedupe preservando orden, descarta no disponibles, nunca
 *   vacía). La aplica tanto reload() como cada toggle del selector.
 */

export const DEFAULT_COMPANY_ID = "principal";

/** Valores de settings que alimentan la migración. */
export interface CompanySelectionStore {
  readonly activeCompanyIds?: readonly string[];
  readonly activeCompanyId?: string;
}

/**
 * Deriva la selección multi-empresa desde settings.
 * - v2: devuelve copia de `activeCompanyIds` (no muta el original).
 * - v1 (sin lista): deriva la lista de un solo elemento desde `activeCompanyId`.
 * - Sin nada: por defecto (`principal`).
 */
export function migrateActiveCompanyIds(stored: CompanySelectionStore): string[] {
  if (stored.activeCompanyIds && stored.activeCompanyIds.length > 0) {
    return [...stored.activeCompanyIds];
  }
  if (stored.activeCompanyId) {
    return [stored.activeCompanyId];
  }
  return [DEFAULT_COMPANY_ID];
}

/**
 * Normaliza una lista pedida por el usuario contra las empresas disponibles.
 * - Elimina duplicados preservando el PRIMER orden de aparición.
 * - Descarta empresas no disponibles (borradas o sin journal).
 * - Nunca devuelve lista vacía: cae al `fallback` (que el caller garantiza
 *   disponible).
 */
export function normalizeActiveCompanyIds(
  ids: readonly string[],
  available: readonly string[],
  fallback: string,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!available.includes(id)) continue;
    result.push(id);
  }
  return result.length > 0 ? result : [fallback];
}

/** Igualdad de listas en orden (para no recargar si la selección no cambió). */
export function sameActiveCompanyIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}