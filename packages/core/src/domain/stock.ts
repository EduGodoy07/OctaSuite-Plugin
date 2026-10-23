import type { IsoDate, IsoInstant } from "../dates.js";
import { fail } from "../errors.js";
import type { Money } from "../money.js";
import type { Product } from "./product.js";

/**
 * Un componente de una receta: qué producto entra y cuánto.
 * `quantity` puede ser fraccionaria (media libra de papas).
 */
export interface ProductComponent {
  readonly productId: string;
  readonly quantity: number;
}

/**
 * Una opción a elegir al vender: cuántas unidades hay que escoger y de qué
 * categoría salen los candidatos.
 *
 * Se apunta a una categoría y no a una lista fija de productos para que agregar
 * una carne nueva al menú no obligue a editar cada combo.
 */
export interface ProductOption {
  readonly label: string;
  readonly quantity: number;
  readonly fromCategory: string;
}

/** Lo que el vendedor eligió para una opción, al momento de facturar. */
export interface OptionSelection {
  readonly label: string;
  readonly productId: string;
  readonly quantity: number;
}

export interface ReceiptLine {
  readonly productId: string;
  readonly quantity: number;
  readonly unitCost: Money;
}

export type ReceiptStatus = "unpaid" | "paid";

export interface Receipt {
  readonly id: string;
  readonly date: IsoDate;
  readonly reference?: string;
  readonly partnerId?: string;
  readonly partnerName?: string;
  readonly lines: readonly ReceiptLine[];
  /** Cuenta por pagar: nace `unpaid`, igual que una factura nace `issued`. */
  readonly status: ReceiptStatus;
  readonly paidAt?: IsoInstant;
  readonly paymentMethod?: string;
  readonly createdAt: IsoInstant;
}

/** Motivos de ajuste. El motivo es obligatorio: un ajuste sin explicación es un descuadre. */
export const ADJUSTMENT_REASONS = ["Merma", "Conteo físico", "Devolución de cliente", "Devolución a proveedor", "Otro"] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number] | string;

export interface StockAdjustment {
  readonly id: string;
  readonly date: IsoDate;
  readonly productId: string;
  /** Firmada: negativa descuenta, positiva suma. */
  readonly quantity: number;
  readonly reason: AdjustmentReason;
  /**
   * Ubicación donde se aplica el ajuste. Ausente en eventos históricos =
   * ubicación principal, por compatibilidad con el journal anterior.
   */
  readonly locationId?: string;
  readonly createdAt: IsoInstant;
}

/** Un producto con receta es un combo: no se almacena, se arma al vender. */
export function isKit(product: Product): boolean {
  return (product.components?.length ?? 0) > 0;
}

/** Un producto configurable exige elegir algo al venderlo. */
export function isConfigurable(product: Product): boolean {
  return (product.options?.length ?? 0) > 0;
}

/** Productos que pueden llenar una opción: los activos de esa categoría. */
export function choicesFor(
  products: ReadonlyMap<string, Product>,
  option: ProductOption,
): Product[] {
  return [...products.values()]
    .filter((p) => !p.archived && p.categoryName === option.fromCategory)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/**
 * Valida que las elecciones cubran exactamente lo que el producto pide.
 * Sin esto se podría facturar un combo de dos carnes eligiendo una sola, y el
 * inventario descontaría de menos para siempre.
 */
export function validateSelections(
  products: ReadonlyMap<string, Product>,
  product: Product,
  selections: readonly OptionSelection[],
): string[] {
  const problems: string[] = [];
  for (const option of product.options ?? []) {
    const forOption = selections.filter((s) => s.label === option.label);
    const chosen = forOption.reduce((acc, s) => acc + s.quantity, 0);
    if (chosen !== option.quantity) {
      problems.push(`${product.name}: ${option.label} pide ${option.quantity} y se eligieron ${chosen}`);
    }
    const valid = new Set(choicesFor(products, option).map((p) => p.id));
    for (const selection of forOption) {
      if (!valid.has(selection.productId)) {
        problems.push(
          `${product.name}: ${products.get(selection.productId)?.name ?? selection.productId} no es una opción válida para ${option.label}`,
        );
      }
    }
  }
  const known = new Set((product.options ?? []).map((o) => o.label));
  for (const selection of selections) {
    if (!known.has(selection.label)) problems.push(`${product.name}: opción desconocida «${selection.label}»`);
  }
  return problems;
}

const MAX_DEPTH = 8;

/**
 * Resuelve un producto a las unidades que sí se almacenan.
 *
 * Un combo se descompone en sus componentes, y si un componente es a su vez un
 * combo se sigue bajando. Un producto sin receta se devuelve a sí mismo.
 *
 * Protege contra recetas circulares (un combo que se contiene) y contra
 * anidamiento absurdo, porque ambas cuelgan el cálculo de existencias en vez de
 * fallar visiblemente.
 */
export function explodeToStockable(
  products: ReadonlyMap<string, Product>,
  productId: string,
  quantity: number,
  seen: readonly string[] = [],
  depth = 0,
): Map<string, number> {
  const result = new Map<string, number>();
  if (quantity === 0) return result;

  if (seen.includes(productId)) {
    fail("stock.circular_recipe", `Receta circular: ${[...seen, productId].join(" → ")}`);
  }
  if (depth > MAX_DEPTH) {
    fail("stock.recipe_too_deep", `Receta anidada más de ${MAX_DEPTH} niveles desde ${seen[0] ?? productId}`);
  }

  const product = products.get(productId);
  // Un producto borrado del catálogo sigue teniendo movimientos históricos: se
  // trata como almacenable para no perder su existencia.
  if (!product || !isKit(product)) {
    result.set(productId, quantity);
    return result;
  }

  for (const component of product.components ?? []) {
    const nested = explodeToStockable(
      products,
      component.productId,
      component.quantity * quantity,
      [...seen, productId],
      depth + 1,
    );
    for (const [id, qty] of nested) result.set(id, (result.get(id) ?? 0) + qty);
  }
  return result;
}

/** Valida una receta antes de guardarla, con los mismos límites que la explosión. */
export function validateComponents(
  products: ReadonlyMap<string, Product>,
  productId: string,
  components: readonly ProductComponent[],
): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();

  for (const component of components) {
    if (component.productId === productId) {
      problems.push("Un combo no puede contenerse a sí mismo");
      continue;
    }
    if (seenIds.has(component.productId)) {
      problems.push(`El componente ${products.get(component.productId)?.name ?? component.productId} está repetido`);
    }
    seenIds.add(component.productId);

    if (!Number.isFinite(component.quantity) || component.quantity <= 0) {
      problems.push(`Cantidad inválida para ${products.get(component.productId)?.name ?? component.productId}`);
    }
    if (!products.has(component.productId)) {
      problems.push(`El componente ${component.productId} no existe`);
      continue;
    }
    try {
      explodeToStockable(products, component.productId, 1, [productId]);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  return problems;
}

/** Lo mínimo que hace falta de una línea de documento para descontar existencia. */
export interface StockConsumingLine {
  readonly productId?: string;
  readonly quantity: number;
  readonly selections?: readonly OptionSelection[];
}

/**
 * Todo lo que consume una línea: su receta fija más lo que se eligió.
 *
 * Las elecciones se guardan por unidad, así que se multiplican por la cantidad
 * de la línea: tres combos de dos carnes descuentan seis carnes.
 */
export function explodeLine(
  products: ReadonlyMap<string, Product>,
  line: StockConsumingLine,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!line.productId) return result;

  const add = (id: string, qty: number) => result.set(id, (result.get(id) ?? 0) + qty);

  for (const [id, qty] of explodeToStockable(products, line.productId, line.quantity)) add(id, qty);

  for (const selection of line.selections ?? []) {
    for (const [id, qty] of explodeToStockable(products, selection.productId, selection.quantity * line.quantity)) {
      add(id, qty);
    }
  }
  return result;
}
