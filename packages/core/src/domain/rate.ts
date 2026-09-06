import { decimalsFor, currencyMeta } from "../catalogs/currencies.js";
import { type IsoDate, assertIsoDate } from "../dates.js";
import { DomainError, fail } from "../errors.js";
import { money, roundHalfUp, type CurrencyCode, type Money } from "../money.js";

/**
 * Tasa de cambio registrada como evento (`rate.updated`). Es un hecho: se
 * sabe quien la cargo, cuando y de que fuente, y el journal permite merge
 * offline sin ambiguedad (dos dispositivos pueden cargar la misma tasa; gana
 * la mas reciente por `at`).
 */
export interface ExchangeRate {
  readonly id: string;
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  /** Cuantas unidades de `to` valen 1 unidad de `from`. Ej: GTQ->USD 0.129. */
  readonly rate: number;
  /** Fecha de vigencia. La conversion usa la tasa valida para la fecha del documento. */
  readonly date: IsoDate;
  /** Manual = cargada a mano. Auto = traida por el Transport (opt-in). */
  readonly source: "manual" | "auto";
  readonly createdAt: string;
}

export type RateSource = ExchangeRate["source"];

const RATE_SOURCES: readonly RateSource[] = ["manual", "auto"];

export function validateExchangeRateDraft(draft: Partial<Omit<ExchangeRate, "id" | "createdAt">>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.from) {
    errors.push(new DomainError("Moneda origen obligatoria", "rate.from_required"));
  } else if (!currencyMeta(draft.from)) {
    errors.push(new DomainError(`Moneda origen desconocida: ${draft.from}`, "rate.from_unknown"));
  }
  if (!draft.to) {
    errors.push(new DomainError("Moneda destino obligatoria", "rate.to_required"));
  } else if (!currencyMeta(draft.to)) {
    errors.push(new DomainError(`Moneda destino desconocida: ${draft.to}`, "rate.to_unknown"));
  }
  if (draft.from && draft.to && draft.from === draft.to) {
    errors.push(new DomainError("La tasa debe ser entre monedas distintas", "rate.same_currency"));
  }
  if (draft.rate === undefined) {
    errors.push(new DomainError("La tasa es obligatoria", "rate.required"));
  } else if (!Number.isFinite(draft.rate) || draft.rate <= 0) {
    errors.push(new DomainError(`Tasa invalida: ${draft.rate}`, "rate.invalid"));
  }
  if (draft.date !== undefined) {
    try {
      assertIsoDate(draft.date);
    } catch {
      errors.push(new DomainError(`Fecha invalida: ${draft.date}`, "rate.date_invalid"));
    }
  }
  if (draft.source !== undefined && !RATE_SOURCES.includes(draft.source)) {
    errors.push(new DomainError(`Fuente invalida: ${String(draft.source)}`, "rate.source_invalid"));
  }
  return errors;
}

/**
 * Convierte un importe a otra moneda usando la tasa indicada.
 *
 * La tasa es "1 unidad de `from` = `rate` unidades de `to`". Como los importes
 * viven en unidades minimas (centavos), la conversion escala por la diferencia
 * de decimales entre monedas y redondea HALF-UP al centavo destino.
 *
 * No lanza si la tasa no coincide con la moneda del importe: eso es un error
 * de programacion. Si la tasa no es para `m.currency`, es un DomainError.
 */
export function convert(m: Money, rate: ExchangeRate): Money {
  if (m.currency === rate.to) return m;
  if (m.currency !== rate.from) {
    fail(
      "rate.currency_mismatch",
      `La tasa ${rate.from}->${rate.to} no convierte ${m.currency}; use una tasa para esa moneda`,
    );
  }
  const toDec = decimalsFor(rate.to);
  const fromDec = decimalsFor(rate.from);
  // minor_to = minor_from * rate * 10^(toDec - fromDec)
  const scale = 10 ** (toDec - fromDec);
  const minor = roundHalfUp(m.minor * rate.rate * scale);
  return money(minor, rate.to);
}

/** Devuelve la tasa mas reciente vigente para la fecha (o undefined si no hay). */
export function rateOnOrBefore(
  rates: readonly ExchangeRate[],
  from: CurrencyCode,
  to: CurrencyCode,
  date: IsoDate,
): ExchangeRate | undefined {
  let best: ExchangeRate | undefined;
  for (const r of rates) {
    if (r.from !== from || r.to !== to) continue;
    if (r.date > date) continue;
    if (!best || r.date > best.date || (r.date === best.date && r.createdAt >= best.createdAt)) best = r;
  }
  return best;
}