import { fail } from "./errors.js";

/** Fecha civil en ISO corto: `YYYY-MM-DD`. */
export type IsoDate = string;
/** Instante en ISO 8601 completo. */
export type IsoInstant = string;
/** Periodo mensual: `YYYY-MM`. */
export type MonthKey = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === "string" && ISO_DATE.test(value);
}

export function assertIsoDate(value: unknown): IsoDate {
  if (!isIsoDate(value)) fail("date.invalid", `Fecha invalida, se espera YYYY-MM-DD: ${String(value)}`);
  const d = parseLocalDate(value);
  if (toIsoDate(d) !== value) fail("date.nonexistent", `Fecha inexistente en el calendario: ${value}`);
  return value;
}

/**
 * Interpreta `YYYY-MM-DD` como fecha civil LOCAL.
 * `new Date("2026-08-01")` la trata como UTC y en GT (UTC-6) retrocede al 31/07.
 */
export function parseLocalDate(value: IsoDate): Date {
  if (!ISO_DATE.test(value)) fail("date.invalid", `Fecha invalida: ${value}`);
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthKeyOf(date: IsoDate): MonthKey {
  assertIsoDate(date);
  return date.slice(0, 7);
}

export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/** Rango inclusivo del mes: del dia 1 al ultimo dia real del mes. */
export function monthRange(month: MonthKey): DateRange {
  if (!/^\d{4}-\d{2}$/.test(month)) fail("date.invalid_month", `Periodo invalido, se espera YYYY-MM: ${month}`);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${last.toString().padStart(2, "0")}` };
}

export function isWithin(date: IsoDate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** Suma dias a una fecha civil, sin salirse del calendario local. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseLocalDate(assertIsoDate(date));
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Misma fecha de la semana anterior. Base de la comparacion viernes-contra-viernes. */
export function previousWeekday(date: IsoDate): IsoDate {
  return addDays(date, -7);
}
