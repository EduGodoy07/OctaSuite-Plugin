import { DEFAULT_COMPANY_ID } from "../company-selection.js";

/**
 * Etiquetas de empresas para el selector multi-empresa. Lógica pura (sin
 * dependencias de Obsidian) para que se pueda testear el texto exacto que ve
 * el usuario.
 */

/**
 * Nombre humano de una empresa. La principal se etiqueta para que quede claro
 * que es el destino de escrituras; el resto se capitaliza.
 */
export function companyLabel(companyId: string): string {
  if (companyId === DEFAULT_COMPANY_ID) return `${companyId} (principal)`;
  return companyId.charAt(0).toUpperCase() + companyId.slice(1);
}

/**
 * Texto del chip que resume la selección activa. Siempre dice CUÁLES empresas
 * están seleccionadas (antes, con más de una, solo decía "N empresas" y los
 * nombres quedaban únicamente en el tooltip).
 *
 * - 1 empresa: su nombre.
 * - 2-3: los nombres completos.
 * - 4+: tres nombres y el conteo del resto (el tooltip sigue listándolas todas).
 */
export function buildActiveLabel(active: readonly string[]): string {
  if (active.length <= 1) return companyLabel(active[0] ?? DEFAULT_COMPANY_ID);
  const names = active.map(companyLabel);
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} y ${names[2]}`;
  return `${names.slice(0, 3).join(", ")} y ${names.length - 3} más`;
}