import { fail } from "./errors.js";

export type CurrencyCode = string;

/**
 * Importe monetario en unidades minimas enteras (centavos).
 *
 * Decision deliberada: nunca flotantes. Expensica guarda `amount: number` en
 * quetzales/dolares y acumula error de redondeo en cuanto hay porcentajes de
 * impuesto; para facturacion eso produce descuadres.
 */
export interface Money {
  readonly minor: number;
  readonly currency: CurrencyCode;
}

export interface CurrencyMeta {
  readonly code: CurrencyCode;
  readonly name: string;
  readonly symbol: string;
  /** Digitos decimales del ISO 4217. */
  readonly decimals: number;
}

export function money(minor: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(minor)) {
    fail("money.not_integer", `El importe debe ser entero en unidades minimas, recibido ${minor}`);
  }
  if (!Number.isSafeInteger(minor)) {
    fail("money.unsafe_integer", `El importe excede el entero seguro de JS: ${minor}`);
  }
  if (!currency) fail("money.no_currency", "Todo importe requiere moneda");
  return { minor, currency };
}

export function zero(currency: CurrencyCode): Money {
  return { minor: 0, currency };
}

/**
 * Convierte una cantidad decimal a Money sin pasar por flotantes cuando la
 * entrada es texto (el caso de un input de formulario).
 */
export function fromDecimal(value: string | number, currency: CurrencyCode, decimals = 2): Money {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("money.not_finite", `Valor no finito: ${value}`);
    return money(roundHalfUp(value * 10 ** decimals), currency);
  }
  const raw = value.trim().replace(/,/g, "");
  if (!/^[+-]?\d*(\.\d*)?$/.test(raw) || raw === "" || raw === "." || raw === "-" || raw === "+") {
    fail("money.unparsable", `No es un decimal valido: ${JSON.stringify(value)}`);
  }
  const negative = raw.startsWith("-");
  const unsigned = raw.replace(/^[+-]/, "");
  const [whole = "0", frac = ""] = unsigned.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const dropped = frac.slice(decimals);
  let minor = Number(`${whole || "0"}${padded || ""}`);
  // Redondeo HALF-UP sobre el primer digito descartado (igual que RoundingMethod::HALF_UP de OctaSuite).
  if (dropped && Number(dropped[0]) >= 5) minor += 1;
  return money(negative ? -minor : minor, currency);
}

export function toDecimalString(m: Money, decimals = 2): string {
  const sign = m.minor < 0 ? "-" : "";
  const abs = Math.abs(m.minor).toString().padStart(decimals + 1, "0");
  const whole = abs.slice(0, abs.length - decimals);
  const frac = decimals > 0 ? `.${abs.slice(abs.length - decimals)}` : "";
  return `${sign}${whole}${frac}`;
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    fail("money.currency_mismatch", `No se pueden operar ${a.currency} y ${b.currency} sin tipo de cambio`);
  }
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function negate(m: Money): Money {
  return money(-m.minor, m.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

/** HALF-UP con alejamiento del cero: -0.5 -> -1, 0.5 -> 1. Math.round daria -0. */
export function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Multiplica por una cantidad (puede ser fraccionaria: 2.5 horas) y redondea HALF-UP. */
export function multiply(m: Money, quantity: number): Money {
  if (!Number.isFinite(quantity)) fail("money.not_finite", `Cantidad no finita: ${quantity}`);
  return money(roundHalfUp(m.minor * quantity), m.currency);
}

/** Aplica un porcentaje (12 = 12%) redondeando HALF-UP. */
export function percentOf(m: Money, ratePercent: number): Money {
  if (!Number.isFinite(ratePercent)) fail("money.not_finite", `Tasa no finita: ${ratePercent}`);
  if (ratePercent < 0) fail("money.negative_rate", `Tasa negativa: ${ratePercent}`);
  return money(roundHalfUp((m.minor * ratePercent) / 100), m.currency);
}

/**
 * Reparte un importe en partes segun pesos, sin perder ni inventar centavos
 * (metodo del resto mayor). La suma de las partes es exactamente el total.
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) fail("money.no_weights", "Se requiere al menos un peso");
  if (weights.some((w) => w < 0)) fail("money.negative_weight", "Los pesos no pueden ser negativos");
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) fail("money.zero_weight", "La suma de pesos no puede ser cero");

  const sign = m.minor < 0 ? -1 : 1;
  const absMinor = Math.abs(m.minor);
  const exact = weights.map((w) => (absMinor * w) / totalWeight);
  const floored = exact.map((x) => Math.floor(x));
  let remainder = absMinor - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    remainder -= 1;
  }
  return result.map((minor) => money(sign * minor, m.currency));
}

export function compare(a: Money, b: Money): number {
  sameCurrency(a, b);
  return a.minor === b.minor ? 0 : a.minor < b.minor ? -1 : 1;
}

export function isZero(m: Money): boolean {
  return m.minor === 0;
}

export function isNegative(m: Money): boolean {
  return m.minor < 0;
}

/** Formato para UI. Cae a un formato manual si Intl no conoce la moneda. */
export function format(m: Money, locale = "es-GT", decimals = 2): string {
  const value = Number(toDecimalString(m, decimals));
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: m.currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${m.currency} ${toDecimalString(m, decimals)}`;
  }
}
