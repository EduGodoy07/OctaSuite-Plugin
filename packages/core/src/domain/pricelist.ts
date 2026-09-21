import { DomainError } from "../errors.js";
import { money, roundHalfUp, type Money } from "../money.js";

/**
 * Lista de precios por cliente (dual pricing, B-03).
 *
 * El pricelist ajusta el PRECIO DE VENTA en el momento de crear la factura;
 * nunca toca el costo (el costing sigue en `Product.costPrice`).
 *
 * Dos mecanismos, en orden de precedencia:
 * 1. `overrides` — precio exacto por producto (`priceMinor` en la moneda del
 *    producto). Manda siempre.
 * 2. `factorBps` — factor global en puntos base sobre `Product.salePrice`.
 *    10000 = 1.0 (sin cambio); 9000 = 10% menos; 15000 = 50% mas. Aplica si
 *    no hay override para el producto.
 * 3. Sin ninguno -> `Product.salePrice` tal cual.
 *
 * Se usa `factorBps` (entero) en vez de un % flotante para mantener la
 * disciplina de aritmética del repo: cero flotantes para dinero.
 */
export interface Pricelist {
  readonly id: string;
  readonly name: string;
  /** Factor global en bps (ver arriba). Opcional si hay overrides. */
  readonly factorBps?: number;
  /** Precio exacto por producto; el override gana sobre el factor. */
  readonly overrides: readonly PricelistOverride[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PricelistOverride {
  readonly productId: string;
  /** Precio unitario en la moneda del producto overrideado. */
  readonly priceMinor: number;
}

export interface PricelistDraft {
  readonly name: string;
  readonly factorBps?: number;
  readonly overrides?: readonly PricelistOverride[];
}

/** Presenta un producto como precio de lista sin acoplar el pricelist a `Product`. */
export interface ListPriced {
  readonly id: string;
  readonly salePrice: Money;
}

/**
 * Resuelve el precio de venta de un producto segun el pricelist.
 * Colear sin pricelist: aplicar `salePrice` directamente.
 */
export function applyPricelist(pricelist: Pricelist, product: ListPriced): Money {
  const currency = product.salePrice.currency;
  const override = pricelist.overrides.find((o) => o.productId === product.id);
  if (override) return money(override.priceMinor, currency);
  if (pricelist.factorBps !== undefined) {
    return money(roundHalfUp((product.salePrice.minor * pricelist.factorBps) / 10000), currency);
  }
  return product.salePrice;
}

export function validatePricelistDraft(draft: Partial<PricelistDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.name || draft.name.trim() === "") {
    errors.push(new DomainError("El nombre de la lista es obligatorio", "pricelist.name_required"));
  }
  if (draft.factorBps !== undefined && (!Number.isInteger(draft.factorBps) || draft.factorBps <= 0)) {
    errors.push(new DomainError("El factor global debe ser un entero positivo (bps)", "pricelist.factor_invalid"));
  }
  if (draft.overrides) {
    for (const override of draft.overrides) {
      if (!Number.isInteger(override.priceMinor) || override.priceMinor < 0) {
        errors.push(
          new DomainError(`Precio de override invalido: ${override.priceMinor}`, "pricelist.price_negative"),
        );
      }
    }
  }
  return errors;
}