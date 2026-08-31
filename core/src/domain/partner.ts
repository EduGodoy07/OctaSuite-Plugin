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
  readonly notes?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valida el NIT guatemalteco con el digito verificador modulo 11 publicado por
 * SAT. Acepta `CF` (consumidor final). No valida existencia real del NIT: para
 * eso hace falta consultar SAT, que este plugin no hace.
 */
export function isValidNit(value: string): boolean {
  const raw = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (raw === "CF") return true;
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
