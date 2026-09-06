import { DomainError } from "../errors.js";
import { isNegative, type Money } from "../money.js";
import type { ProductComponent, ProductOption } from "./stock.js";

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly reference?: string;
  readonly salePrice: Money;
  readonly costPrice?: Money;
  /** Tasa de IVA en porcentaje. Si se omite, se usa la tasa por defecto de la configuracion. */
  readonly taxRate?: number;
  readonly unit?: string;
  readonly categoryName?: string;
  readonly description?: string;
  /**
   * Receta. Si tiene componentes es un combo: no lleva existencia propia,
   * al venderlo se descuentan sus componentes.
   */
  readonly components?: readonly ProductComponent[];
  /** Opciones a elegir al vender. Un producto con opciones es configurable. */
  readonly options?: readonly ProductOption[];
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProductDraft {
  readonly name: string;
  readonly salePrice: Money;
  readonly reference?: string;
  readonly costPrice?: Money;
  readonly taxRate?: number;
  readonly unit?: string;
  readonly categoryName?: string;
  readonly description?: string;
  readonly components?: readonly ProductComponent[];
  readonly options?: readonly ProductOption[];
}

export function validateProductDraft(draft: Partial<ProductDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.name || draft.name.trim() === "") {
    errors.push(new DomainError("El nombre del producto es obligatorio", "product.name_required"));
  }
  if (!draft.salePrice) {
    errors.push(new DomainError("El precio de venta es obligatorio", "product.price_required"));
  } else if (isNegative(draft.salePrice)) {
    errors.push(new DomainError("El precio de venta no puede ser negativo", "product.price_negative"));
  }
  if (draft.taxRate !== undefined && (draft.taxRate < 0 || draft.taxRate > 100)) {
    errors.push(new DomainError(`Tasa de impuesto fuera de rango: ${draft.taxRate}`, "product.tax_rate_invalid"));
  }
  return errors;
}

/**
 * Margen bruto en porcentaje: `(venta − costo) / venta × 100`.
 *
 * Existe porque la plantilla RetailOS de Notion llama «Margin» a
 * `round((precio / costo) × 100) / 100`, que es el MULTIPLICADOR sobre el costo,
 * no el margen. Con precio 100 y costo 80 devuelve 1.25 cuando el margen real es
 * 20%. Y divide por el costo sin proteger el cero.
 *
 * Devuelve `null` cuando no se puede calcular (sin costo, o precio en cero), en
 * vez de un número que parece válido.
 */
export function grossMarginPercent(salePrice: Money, costPrice: Money | undefined): number | null {
  if (!costPrice) return null;
  if (salePrice.currency !== costPrice.currency) return null;
  if (salePrice.minor === 0) return null;
  return ((salePrice.minor - costPrice.minor) / salePrice.minor) * 100;
}

/**
 * Multiplicador sobre el costo: `venta / costo`. Es lo que RetailOS llama
 * «Margin». Se expone con su nombre correcto para que nadie confunda los dos.
 */
export function markupRatio(salePrice: Money, costPrice: Money | undefined): number | null {
  if (!costPrice) return null;
  if (salePrice.currency !== costPrice.currency) return null;
  if (costPrice.minor === 0) return null;
  return salePrice.minor / costPrice.minor;
}
