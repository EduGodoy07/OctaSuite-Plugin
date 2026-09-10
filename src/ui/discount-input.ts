import { fromDecimal } from "@octasuite/core";
import type { CurrencyCode, LineDiscount, Money } from "@octasuite/core";

/**
 * Parseo de los campos de descuento de línea. Función pura, agnóstica de
 * Obsidian, para poder testear sin abrir el modal.
 *
 * Diferencia tres casos que el modal necesita distinguir:
 * - `none`:  ambos campos vacíos → la línea no tiene descuento.
 * - `ok`:    al menos un campo válido → descuento aplicable.
 * - `invalid`: algún campo presente pero no parseable → NO se puede emitir en
 *   silencio: la línea quedaría sin el descuento que el usuario intentó escribir
 *   (problema fiscal FEL/DTE). El modal debe bloquear con el mensaje adecuado.
 *
 * Reglas de parseo:
 * - percent: `Number(raw)` debe ser finito.
 * - amount:  `fromDecimal(raw, currency)` debe parsear (formato es-GT).
 * - Si un campo está inválido, se reporta ESE problema (no se traga el otro
 *   campo válido ni se emite un descuento parcial).
 */
export function parseDiscountInput(
  percentRaw: string,
  amountRaw: string,
  currency: CurrencyCode,
):
  | { kind: "none" }
  | { kind: "ok"; discount: LineDiscount }
  | { kind: "invalid"; problem: "discount_percent_invalid" | "discount_amount_invalid" } {
  const percent = percentRaw.trim();
  const amount = amountRaw.trim();
  if (percent === "" && amount === "") return { kind: "none" };

  let percentNum: number | undefined;
  if (percent !== "") {
    percentNum = Number(percent);
    if (!Number.isFinite(percentNum)) return { kind: "invalid", problem: "discount_percent_invalid" };
  }

  let amountMoney: Money | undefined;
  if (amount !== "") {
    try {
      amountMoney = fromDecimal(amount, currency);
    } catch {
      return { kind: "invalid", problem: "discount_amount_invalid" };
    }
  }

  return {
    kind: "ok",
    discount: {
      ...(percentNum !== undefined ? { percent: percentNum } : {}),
      ...(amountMoney !== undefined ? { amount: amountMoney } : {}),
    },
  };
}