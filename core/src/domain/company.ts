import { currencyMeta } from "../catalogs/currencies.js";
import { DomainError } from "../errors.js";
import type { CurrencyCode } from "../money.js";

/**
 * Empresa del multi-empresa. Cada empresa tiene su propio journal
 * (`journal/{companyId}/`) y su moneda base; los correlativos fiscales
 * derivan de la serie de la particion, no de un contador compartido.
 */
export interface Company {
  readonly id: string;
  readonly name: string;
  /** Moneda base de la empresa: la moneda funcional para documentos nuevos. */
  readonly baseCurrency: CurrencyCode;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CompanyDraft {
  readonly name: string;
  readonly baseCurrency: CurrencyCode;
}

const NAME_MAX = 120;
const ID_MAX = 64;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Deriva un id de carpeta seguro desde el nombre: minúsculas, sin acentos,
 * no-alfanuméricos a guiones, guiones colapsados y recortados en los bordes.
 * Devuelve "" si el nombre no deja ningún carácter utilizable.
 */
export function slugifyCompanyId(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita los acentos (diacríticos descompuestos)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Valida un id de carpeta de empresa (la carpeta del journal: `journal/{companyId}/`).
 * Permite "principal" a propósito: es el id por defecto y debe poder seleccionarse.
 */
export function validateCompanyId(id: string): DomainError[] {
  if (!id) {
    return [new DomainError("El ID de la empresa es obligatorio", "company.id_required")];
  }
  const errors: DomainError[] = [];
  if (!ID_PATTERN.test(id)) {
    errors.push(
      new DomainError(
        "El ID solo puede contener letras minúsculas, números y guiones, y debe empezar con letra o número",
        "company.id_invalid",
      ),
    );
  }
  if (id.length > ID_MAX) {
    errors.push(new DomainError(`El ID supera ${ID_MAX} caracteres`, "company.id_too_long"));
  }
  return errors;
}

export function validateCompanyDraft(draft: Partial<CompanyDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (draft.name === undefined) {
    errors.push(new DomainError("El nombre de la empresa es obligatorio", "company.name_required"));
  }
  if (draft.baseCurrency === undefined) {
    errors.push(new DomainError("La moneda base es obligatoria", "company.base_currency_required"));
  }
  return [...errors, ...validateCompanyChanges(draft)];
}

/**
 * Valida un cambio parcial de empresa: solo valida los campos presentes.
 * Para `company.updated` no hay obligatorios, solo consistencia.
 */
export function validateCompanyChanges(changes: Partial<CompanyDraft>): DomainError[] {
  const errors: DomainError[] = [];
  const name = changes.name?.trim();
  if (changes.name !== undefined && !name) {
    errors.push(new DomainError("El nombre de la empresa es obligatorio", "company.name_required"));
  } else if (name && name.length > NAME_MAX) {
    errors.push(new DomainError(`El nombre supera ${NAME_MAX} caracteres`, "company.name_too_long"));
  }
  if (changes.baseCurrency !== undefined && !currencyMeta(changes.baseCurrency)) {
    errors.push(
      new DomainError(`Moneda base desconocida: ${changes.baseCurrency}`, "company.base_currency_unknown"),
    );
  }
  return errors;
}

/** Las monedas soportadas (catalogo actual). Driver de la UI del selector. */
export function knownBaseCurrencies(): readonly CurrencyCode[] {
  return ["GTQ", "USD", "EUR", "MXN"];
}