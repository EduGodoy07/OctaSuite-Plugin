import type { IsoDate, IsoInstant } from "../dates.js";
import { DomainError, fail } from "../errors.js";
import { add, compare, isNegative, multiply, percentOf, subtract, sum, zero, type CurrencyCode, type Money } from "../money.js";
import type { OptionSelection } from "./stock.js";

/**
 * Descuento de una linea de venta. Puede ser porcentual, por monto, o ambos.
 * Si vienen ambos, se suman: `percent` de la base + `amount` fijo.
 * Siempre se aplica sobre la base (qty × unitPrice) ANTES del IVA.
 */
export interface LineDiscount {
  /** Porcentaje de la base. 10 = 10%. Rango valido: 0-100. */
  readonly percent?: number;
  /** Monto fijo en la moneda del documento. */
  readonly amount?: Money;
}

export interface InvoiceLine {
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  /** IVA en porcentaje. 12 = 12%. */
  readonly taxRate: number;
  /** Descuento aplicado a esta linea (opcional). */
  readonly discount?: LineDiscount;
  readonly productId?: string;
  readonly unit?: string;
  /**
   * Lo que se eligió al vender un producto configurable. Queda dentro del
   * documento: es parte de lo que se le vendió al cliente, no una referencia.
   */
  readonly selections?: readonly OptionSelection[];
}

export interface LineTotals {
  readonly untaxed: Money;
  readonly tax: Money;
  readonly total: Money;
}

export interface InvoiceTotals extends LineTotals {
  /** Impuesto desglosado por tasa, para el resumen del documento. */
  readonly taxByRate: ReadonlyMap<number, Money>;
}

/**
 * Redondeo POR LINEA, no sobre el total del documento.
 *
 * Divergencia consciente respecto de OctaSuite: alli `AccountManager` delega en
 * `TaxFacade` con lineas dinamicas, `include_base_amount`, terminos de pago y
 * lineas de redondeo (motor estilo Odoo, ~82k LOC). Aqui el impuesto se calcula
 * y redondea linea por linea porque es asi como el DTE de FEL reporta el
 * detalle, y porque un micronegocio no tiene impuestos compuestos.
 * Consecuencia: los totales pueden diferir en centavos de los del ERP cuando
 * hay muchas lineas. Documentado, no accidental.
 */
/**
 * Descuento total efectivo de una linea (porcentual + fijo, en montos).
 * Valida que el descuento no exceda la base de la linea.
 */
export function lineDiscountAmount(line: InvoiceLine): Money {
  if (!line.discount) return zero(line.unitPrice.currency);
  const { percent, amount } = line.discount;
  if (percent === undefined && amount === undefined) {
    fail("invoice.discount_empty", "El descuento requiere percent y/o amount");
  }
  if (percent !== undefined && (percent < 0 || percent > 100)) {
    fail("invoice.discount_percent_invalid", `Porcentaje de descuento invalido: ${percent}`);
  }
  if (amount !== undefined && isNegative(amount)) {
    fail("invoice.discount_amount_negative", "El monto de descuento no puede ser negativo");
  }

  const base = multiply(line.unitPrice, line.quantity);
  const percentPart = percent !== undefined ? percentOf(base, percent) : zero(base.currency);
  const amountPart = amount ?? zero(base.currency);
  const discount = add(percentPart, amountPart);
  if (compare(discount, base) > 0) {
    fail("invoice.discount_exceeds_base", "El descuento excede la base de la linea");
  }
  return discount;
}

export function computeLineTotals(line: InvoiceLine): LineTotals {
  if (!Number.isFinite(line.quantity)) fail("invoice.quantity_invalid", `Cantidad invalida: ${line.quantity}`);
  if (line.quantity <= 0) fail("invoice.quantity_not_positive", "La cantidad debe ser mayor que cero");
  if (isNegative(line.unitPrice)) fail("invoice.price_negative", "El precio unitario no puede ser negativo");
  if (line.taxRate < 0 || line.taxRate > 100) fail("invoice.tax_rate_invalid", `Tasa invalida: ${line.taxRate}`);

  const untaxedGross = multiply(line.unitPrice, line.quantity);
  const discount = lineDiscountAmount(line);
  const untaxed = subtract(untaxedGross, discount);
  const tax = percentOf(untaxed, line.taxRate);
  return { untaxed, tax, total: add(untaxed, tax) };
}

export function computeInvoiceTotals(lines: readonly InvoiceLine[], currency: CurrencyCode): InvoiceTotals {
  if (lines.length === 0) fail("invoice.no_lines", "Una factura requiere al menos una linea");
  const perLine = lines.map(computeLineTotals);
  const taxByRate = new Map<number, Money>();
  lines.forEach((line, i) => {
    const t = perLine[i]!.tax;
    const acc = taxByRate.get(line.taxRate) ?? zero(currency);
    taxByRate.set(line.taxRate, add(acc, t));
  });
  return {
    untaxed: sum(perLine.map((t) => t.untaxed), currency),
    tax: sum(perLine.map((t) => t.tax), currency),
    total: sum(perLine.map((t) => t.total), currency),
    taxByRate,
  };
}

export type InvoiceStatus = "issued" | "paid";

/**
 * Documento emitido. Es inmutable: los borradores nunca entran al journal, y
 * una vez emitida solo se le agregan hechos posteriores (pago, nota de credito).
 */
export interface Invoice {
  readonly id: string;
  readonly series: string;
  readonly number: number;
  readonly displayNumber: string;
  readonly date: IsoDate;
  readonly currency: CurrencyCode;
  readonly lines: readonly InvoiceLine[];
  readonly totals: InvoiceTotals;
  readonly status: InvoiceStatus;
  readonly paidAt?: IsoInstant;
  readonly paymentMethod?: string;
  /** Turno de caja en el que se cobró, si se cobró desde Caja. */
  readonly shiftId?: string;
  /**
   * Datos del cliente CONGELADOS al momento de emitir. Si el partner cambia de
   * NIT o razon social despues, el documento fiscal ya emitido no cambia.
   */
  readonly partnerId?: string;
  readonly partnerName: string;
  readonly partnerTaxId: string;
  readonly notes?: string;
  readonly creditedTotal: Money;
  readonly creditNoteIds: readonly string[];
}

export interface CreditNote {
  readonly id: string;
  readonly invoiceId: string;
  readonly date: IsoDate;
  readonly amount: Money;
  readonly reason: string;
  readonly createdAt: IsoInstant;
}

/**
 * Nota de crédito como se persiste en el estado (incluye los campos del
 * borrador extendido B-05). `type` queda opcional: las notas creadas por
 * `invoice.credited` no lo llevan; las de `invoice.refunded` sí.
 */
export interface StoredCreditNote extends CreditNote {
  readonly type?: CreditNoteType;
  readonly lines?: readonly {
    readonly productId: string;
    readonly quantity: number;
    readonly unitPrice: Money;
    readonly taxRate: number;
  }[];
  readonly tenderRefund?: TenderRefund;
  readonly stockReturnLocationId?: string;
  readonly exchangeLines?: readonly ExchangeLine[];
}

/** Tipo de nota de crédito: anulación a crédito del cliente, reembolso al tender original, o cambio. */
export type CreditNoteType = "store_credit" | "refund" | "exchange";

/** Reembolso al método de pago original (tender). */
export interface TenderRefund {
  readonly method: string;
  readonly amount: Money;
}

/** Línea de cambio (producto nuevo que se entrega en el exchange). */
export interface ExchangeLine {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly taxRate: number;
}

/** Borrador para crear una nota de crédito extendida (B-05). */
export interface CreditNoteDraft {
  readonly type?: CreditNoteType;
  readonly amount: Money;
  readonly reason: string;
  readonly lines?: readonly {
    readonly productId: string;
    readonly quantity: number;
    readonly unitPrice: Money;
    readonly taxRate: number;
  }[];
  readonly tenderRefund?: TenderRefund;
  readonly stockReturnLocationId?: string;
  readonly exchangeLines?: readonly ExchangeLine[];
}

/** Valida un borrador de nota de crédito extendida. */
export function validateCreditNoteDraft(draft: CreditNoteDraft): DomainError[] {
  const errors: DomainError[] = [];

  if (!draft.reason || draft.reason.trim() === "") {
    errors.push(new DomainError("El motivo es obligatorio", "credit_note.reason_required"));
  }

  if (isNegative(draft.amount)) {
    errors.push(new DomainError("El monto no puede ser negativo", "credit_note.negative"));
  }
  if (draft.amount.minor === 0) {
    errors.push(new DomainError("El monto no puede ser cero", "credit_note.zero_amount"));
  }

  const type = draft.type ?? "store_credit";

  const validateLines = (
    lines: readonly {
      readonly productId: string;
      readonly quantity: number;
      readonly unitPrice: Money;
      readonly taxRate: number;
    }[] | undefined,
    kind: "return" | "exchange",
  ): void => {
    if (!lines) return;
    for (const line of lines) {
      const label = kind === "return" ? "la devolución" : "el cambio";
      if (!line.productId || !line.productId.trim()) {
        errors.push(new DomainError(
          `Cada línea de ${label} requiere un producto`,
          kind === "return" ? "credit_note.return_product_required" : "credit_note.exchange_product_required",
        ));
      }
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        errors.push(new DomainError(
          `La cantidad de ${label} debe ser mayor que cero`,
          kind === "return" ? "credit_note.return_quantity_invalid" : "credit_note.exchange_quantity_invalid",
        ));
      }
      if (!Number.isSafeInteger(line.unitPrice.minor) || line.unitPrice.minor < 0) {
        errors.push(new DomainError(
          `El precio de ${label} no puede ser negativo ni inválido`,
          kind === "return" ? "credit_note.return_price_invalid" : "credit_note.exchange_price_invalid",
        ));
      }
      if (!Number.isFinite(line.taxRate) || line.taxRate < 0 || line.taxRate > 100) {
        errors.push(new DomainError(
          `La tasa de IVA de ${label} debe estar entre 0 y 100`,
          kind === "return" ? "credit_note.return_tax_rate_invalid" : "credit_note.exchange_tax_rate_invalid",
        ));
      }
      if (line.unitPrice.currency !== draft.amount.currency) {
        errors.push(new DomainError(
          `La moneda de la línea de ${label} debe coincidir con la nota`,
          kind === "return" ? "credit_note.return_currency_mismatch" : "credit_note.exchange_currency_mismatch",
        ));
      }
    }
  };

  validateLines(draft.lines, "return");
  validateLines(draft.exchangeLines, "exchange");

  if (type === "refund") {
    if (!draft.tenderRefund) {
      errors.push(new DomainError("El reembolso a tender requiere tenderRefund", "credit_note.refund_requires_tender"));
    } else {
      if (draft.tenderRefund.amount.minor !== draft.amount.minor) {
        errors.push(new DomainError("El monto del tenderRefund debe coincidir con el amount total", "credit_note.tender_amount_mismatch"));
      }
      if (!draft.tenderRefund.method || draft.tenderRefund.method.trim() === "") {
        errors.push(new DomainError("El método de tender es obligatorio", "credit_note.tender_method_required"));
      }
    }
  }

  if (type === "exchange") {
    const hasReturnLines = draft.lines && draft.lines.length > 0;
    const hasExchangeLines = draft.exchangeLines && draft.exchangeLines.length > 0;
    if (!hasReturnLines && !hasExchangeLines) {
      errors.push(new DomainError("Un exchange requiere líneas devueltas y/o líneas de cambio", "credit_note.exchange_requires_lines"));
    }
  }

  return errors;
}

/** Correlativo sin huecos por serie: el siguiente es siempre el ultimo mas uno. */
export function nextNumber(lastNumber: number | undefined): number {
  if (lastNumber === undefined) return 1;
  if (!Number.isInteger(lastNumber) || lastNumber < 0) {
    fail("invoice.bad_last_number", `Correlativo previo invalido: ${lastNumber}`);
  }
  return lastNumber + 1;
}

export function formatInvoiceNumber(series: string, number: number, padding = 4): string {
  return `${series}-${number.toString().padStart(padding, "0")}`;
}

export interface IssueInvoiceInput {
  readonly series: string;
  readonly date: IsoDate;
  readonly currency: CurrencyCode;
  readonly lines: readonly InvoiceLine[];
  readonly partnerName: string;
  readonly partnerTaxId: string;
  readonly partnerId?: string;
  readonly notes?: string;
}

export function validateIssueInput(input: Partial<IssueInvoiceInput>): DomainError[] {
  const errors: DomainError[] = [];
  if (!input.series || input.series.trim() === "") {
    errors.push(new DomainError("La serie es obligatoria", "invoice.series_required"));
  }
  if (!input.partnerName || input.partnerName.trim() === "") {
    errors.push(new DomainError("El nombre del cliente es obligatorio", "invoice.partner_name_required"));
  }
  if (!input.partnerTaxId || input.partnerTaxId.trim() === "") {
    errors.push(new DomainError("El NIT es obligatorio; usa CF para consumidor final", "invoice.tax_id_required"));
  }
  if (!input.lines || input.lines.length === 0) {
    errors.push(new DomainError("La factura requiere al menos una linea", "invoice.no_lines"));
  } else {
    input.lines.forEach((line, i) => {
      try {
        computeLineTotals(line);
      } catch (e) {
        if (e instanceof DomainError) {
          errors.push(new DomainError(`Linea ${i + 1}: ${e.message}`, e.code));
        } else throw e;
      }
    });
  }
  return errors;
}

/** Una nota de credito nunca puede acreditar mas de lo que queda vivo en la factura. */
export function assertRefundable(invoice: Invoice, amount: Money): void {
  if (isNegative(amount)) fail("credit_note.negative", "El monto de la nota de credito no puede ser negativo");
  const afterCredit = add(invoice.creditedTotal, amount);
  if (compare(afterCredit, invoice.totals.total) > 0) {
    fail(
      "credit_note.exceeds_invoice",
      `La nota de credito excede el saldo acreditable de ${invoice.displayNumber}`,
    );
  }
}

/** Alias para compatibilidad. */
export const assertCreditable = assertRefundable;

export function outstandingBalance(invoice: Invoice): Money {
  const credited = invoice.creditedTotal;
  const base = invoice.status === "paid" ? zero(invoice.currency) : invoice.totals.total;
  const balance = base.minor - credited.minor;
  return { minor: Math.max(0, balance), currency: invoice.currency };
}

/**
 * Totales congelados dentro del evento de emision.
 *
 * Si en una version futura cambia la regla de impuestos, reproducir el journal
 * NO debe alterar los totales de una factura ya emitida. Por eso el hecho carga
 * su propio snapshot y `taxByRate` se deriva solo para presentacion.
 */
export interface TotalsSnapshot {
  readonly untaxed: Money;
  readonly tax: Money;
  readonly total: Money;
}

export function totalsSnapshot(totals: InvoiceTotals): TotalsSnapshot {
  return { untaxed: totals.untaxed, tax: totals.tax, total: totals.total };
}

/** Recalcula y compara contra el snapshot. Sirve para detectar deriva de reglas. */
export function verifyTotals(
  lines: readonly InvoiceLine[],
  currency: CurrencyCode,
  snapshot: TotalsSnapshot,
): DomainError | null {
  const recomputed = computeInvoiceTotals(lines, currency);
  if (
    recomputed.untaxed.minor !== snapshot.untaxed.minor ||
    recomputed.tax.minor !== snapshot.tax.minor ||
    recomputed.total.minor !== snapshot.total.minor
  ) {
    return new DomainError(
      `Los totales recalculados no coinciden con los emitidos (emitido ${snapshot.total.minor}, recalculado ${recomputed.total.minor})`,
      "invoice.totals_drift",
    );
  }
  return null;
}
