import { DomainError } from "../errors.js";

/** Paridad con `OctaSuite\Partners\Enums\AccountType`. */
export const ACCOUNT_TYPES = ["individual", "company", "address"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Partner {
  readonly id: string;
  readonly accountType: AccountType;
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly mobile?: string;
  /** NIT en Guatemala. `CF` para consumidor final. */
  readonly taxId?: string;
  readonly street1?: string;
  readonly street2?: string;
  readonly city?: string;
  readonly zip?: string;
  readonly countryCode?: string;
  readonly website?: string;
  readonly jobTitle?: string;
  readonly reference?: string;
  /** Contacto o direccion perteneciente a otro partner (jerarquia `parent_id` del ERP). */
  readonly parentId?: string;
  /** Lista de precios asignada (dual pricing B-03); `applyPricelist` al facturar. */
  readonly pricelistId?: string;
  readonly notes?: string;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PartnerDraft {
  readonly name: string;
  readonly accountType: AccountType;
  readonly email?: string;
  readonly phone?: string;
  readonly mobile?: string;
  readonly taxId?: string;
  readonly street1?: string;
  readonly street2?: string;
  readonly city?: string;
  readonly zip?: string;
  readonly countryCode?: string;
  readonly website?: string;
  readonly jobTitle?: string;
  readonly reference?: string;
  readonly parentId?: string;
  readonly pricelistId?: string;
  readonly notes?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Cantidad de municipios por departamento (codigo 1..22), usada para validar la
 * geografia de un CUI (digitos 10-11 departamento, 12-13 municipio).
 * Fuente: codificacion publicada por MINEDUC / RENAP.
 */
const CUI_MAX_MUNICIPIOS = [
  17, 8, 16, 16, 13, 14, 19, 8, 24, 20, 9, 30, 32, 22, 8, 17, 14, 5, 11, 11, 7, 17,
];

/**
 * Valida un CUI/DPI de 13 digitos segun el algoritmo de RENAP (Ministerio de
 * Finanzas). El digito verificador es el 9: pesos 2..9 sobre los primeros 8
 * digitos, comparacion directa modulo 11, y geografia valida (departamento
 * 1..22, municipio dentro del maximo del departamento). Devuelve false si el
 * formato no es exactamente 13 digitos.
 */
export function isValidCui(value: string): boolean {
  const raw = value.trim().replace(/\D/g, "");
  if (!/^\d{13}$/.test(raw)) return false;
  const front = raw.slice(0, 8);
  const check = Number(raw[8]);
  const departamento = Number(raw.slice(9, 11));
  const municipio = Number(raw.slice(11, 13));
  let total = 0;
  for (let i = 0; i < 8; i++) {
    total += Number(front[i]) * (i + 2);
  }
  if (total % 11 !== check) return false;
  if (departamento < 1 || departamento > CUI_MAX_MUNICIPIOS.length) return false;
  const maxMunicipios = CUI_MAX_MUNICIPIOS[departamento - 1];
  if (maxMunicipios === undefined) return false;
  if (municipio < 1 || municipio > maxMunicipios) return false;
  return true;
}

/**
 * Valida el NIT guatemalteco con el digito verificador modulo 11 publicado por
 * SAT. Acepta `CF` (consumidor final). No valida existencia real del NIT: para
 * eso hace falta consultar SAT, que este plugin no hace.
 *
 * Formas aceptadas (SAT-DSI-393-2025):
 * - NIT heredado de 8 digitos: modulo 11 ponderado, digito K = 10.
 * - NIT de 9 digitos derivado del CUI (desde abr 2023): el cuerpo de 8 digitos
 *   es el front del CUI y el digito 9 su verificador; por congruencia modulo 11
 *   el algoritmo del NIT da el mismo resultado que el CUI, por eso se maneja
 *   con el camino heredado.
 * - CUI completo de 13 digitos (desde mar 2025): se valida como CUI.
 */
export function isValidNit(value: string): boolean {
  const raw = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (raw === "CF") return true;
  if (/^\d{13}$/.test(raw)) return isValidCui(raw);
  if (!/^\d+[0-9K]$/.test(raw)) return false;
  const body = raw.slice(0, -1);
  const checkChar = raw.slice(-1);
  const expected = checkChar === "K" ? 10 : Number(checkChar);
  let total = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[i]);
    total += digit * (body.length + 1 - i);
  }
  const modulus = 11 - (total % 11);
  const check = modulus === 11 ? 0 : modulus;
  return check === expected;
}

export function validatePartnerDraft(draft: Partial<PartnerDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.name || draft.name.trim() === "") {
    errors.push(new DomainError("El nombre es obligatorio", "partner.name_required"));
  }
  if (draft.accountType && !ACCOUNT_TYPES.includes(draft.accountType)) {
    errors.push(new DomainError(`Tipo de cuenta invalido: ${draft.accountType}`, "partner.account_type_invalid"));
  }
  if (draft.email && !EMAIL.test(draft.email)) {
    errors.push(new DomainError(`Correo invalido: ${draft.email}`, "partner.email_invalid"));
  }
  if (draft.taxId && !isValidNit(draft.taxId)) {
    errors.push(new DomainError(`NIT con digito verificador incorrecto: ${draft.taxId}`, "partner.tax_id_invalid"));
  }
  if (draft.accountType === "address" && !draft.parentId) {
    errors.push(new DomainError("Una direccion debe pertenecer a un contacto padre", "partner.parent_required"));
  }
  return errors;
}
