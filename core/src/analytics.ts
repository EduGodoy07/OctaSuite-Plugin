import { isWithin, monthRange, type IsoDate, type MonthKey, monthKeyOf, previousWeekday } from "./dates.js";
import { add, sum, zero, type CurrencyCode, type Money } from "./money.js";
import { activeExpenses, invoicesInMonth, totalExpenses, totalInvoiced, type State } from "./store.js";

/**
 * Metricas derivadas del journal. Nada se guarda: todo se recalcula, asi que no
 * hay indicadores que queden desincronizados de los hechos.
 *
 * Tres de estas vienen de la estructura de The Arepa Factory, que las tiene bien
 * pensadas: comparar contra el mismo dia de la semana, tasa de clientes que
 * vuelven, y mezcla de formas de pago en porcentaje.
 */

export interface Comparison {
  readonly current: Money;
  readonly previous: Money;
  /** Variacion porcentual, o `null` si el periodo anterior fue cero (dividir por cero no informa). */
  readonly deltaPercent: number | null;
}

function expenseTotalOn(state: State, date: IsoDate, currency: CurrencyCode): Money {
  const amounts = activeExpenses(state)
    .filter((e) => e.date === date && e.status !== "rejected" && e.amount.currency === currency)
    .map((e) => e.amount);
  return sum(amounts, currency);
}

/**
 * Gasto de un dia contra el MISMO DIA de la semana anterior.
 *
 * Comparar contra ayer engana en cualquier negocio con ritmo semanal: un lunes
 * nunca se parece a un domingo. Un viernes contra el viernes pasado, si.
 */
export function expensesVsPreviousWeekday(
  state: State,
  date: IsoDate,
  currency: CurrencyCode,
): Comparison {
  const current = expenseTotalOn(state, date, currency);
  const previous = expenseTotalOn(state, previousWeekday(date), currency);
  return {
    current,
    previous,
    deltaPercent: previous.minor === 0 ? null : ((current.minor - previous.minor) / previous.minor) * 100,
  };
}

export interface CustomerMetrics {
  /** Documentos emitidos en el periodo. */
  readonly tickets: number;
  /** Clientes distintos identificables. Consumidor final no cuenta: es anonimo. */
  readonly identified: number;
  /** Identificables con mas de un documento en el periodo. */
  readonly returning: number;
  /** `returning / identified`, o `null` si no hubo clientes identificables. */
  readonly returningRate: number | null;
  readonly avgTicket: Money;
  readonly avgPerCustomer: Money;
}

/**
 * Un NIT `CF` no identifica a nadie, asi que esos documentos cuentan como
 * tickets pero no como clientes: incluirlos inflaria la tasa de recurrencia.
 */
function customerKey(partnerId: string | undefined, taxId: string): string | null {
  if (partnerId) return `id:${partnerId}`;
  const normalized = taxId.trim().toUpperCase().replace(/[\s-]/g, "");
  if (normalized === "" || normalized === "CF") return null;
  return `nit:${normalized}`;
}

export function customerMetrics(state: State, month: MonthKey, currency: CurrencyCode): CustomerMetrics {
  const invoices = invoicesInMonth(state, month).filter((i) => i.currency === currency);
  const byCustomer = new Map<string, { count: number; total: Money }>();

  for (const invoice of invoices) {
    const key = customerKey(invoice.partnerId, invoice.partnerTaxId);
    if (!key) continue;
    const entry = byCustomer.get(key) ?? { count: 0, total: zero(currency) };
    byCustomer.set(key, { count: entry.count + 1, total: add(entry.total, invoice.totals.total) });
  }

  const revenue = sum(
    invoices.map((i) => i.totals.total),
    currency,
  );
  const identified = byCustomer.size;
  const returning = [...byCustomer.values()].filter((c) => c.count > 1).length;
  const identifiedRevenue = sum(
    [...byCustomer.values()].map((c) => c.total),
    currency,
  );

  return {
    tickets: invoices.length,
    identified,
    returning,
    returningRate: identified === 0 ? null : returning / identified,
    avgTicket: invoices.length === 0 ? zero(currency) : { minor: Math.round(revenue.minor / invoices.length), currency },
    avgPerCustomer:
      identified === 0 ? zero(currency) : { minor: Math.round(identifiedRevenue.minor / identified), currency },
  };
}

export interface PaymentSlice {
  readonly method: string;
  readonly amount: Money;
  /** Proporcion sobre el total cobrado, de 0 a 1. */
  readonly share: number;
}

export const UNSPECIFIED_METHOD = "Sin especificar";

/**
 * Mezcla de formas de pago sobre lo efectivamente cobrado. Solo cuenta facturas
 * pagadas: una factura emitida y no cobrada no dice nada sobre como paga la gente.
 */
export function paymentMix(state: State, month: MonthKey, currency: CurrencyCode): {
  readonly total: Money;
  readonly slices: readonly PaymentSlice[];
} {
  const paid = invoicesInMonth(state, month).filter((i) => i.currency === currency && i.status === "paid");
  const byMethod = new Map<string, Money>();

  for (const invoice of paid) {
    const method = invoice.paymentMethod?.trim() || UNSPECIFIED_METHOD;
    byMethod.set(method, add(byMethod.get(method) ?? zero(currency), invoice.totals.total));
  }

  const total = sum([...byMethod.values()], currency);
  const slices = [...byMethod.entries()]
    .map(([method, amount]) => ({
      method,
      amount,
      share: total.minor === 0 ? 0 : amount.minor / total.minor,
    }))
    .sort((a, b) => b.amount.minor - a.amount.minor || a.method.localeCompare(b.method));

  return { total, slices };
}

/** Gasto pendiente de aprobacion: lo que espera una decision del operador. */
export function pendingApprovalCount(state: State): number {
  return activeExpenses(state).filter((e) => e.status === "submitted").length;
}

/** Facturas emitidas y no cobradas del periodo, con su saldo. */
export function unpaidInvoices(state: State, month: MonthKey, currency: CurrencyCode): {
  readonly count: number;
  readonly amount: Money;
} {
  const unpaid = invoicesInMonth(state, month).filter((i) => i.currency === currency && i.status !== "paid");
  return {
    count: unpaid.length,
    amount: sum(
      unpaid.map((i) => ({ minor: i.totals.total.minor - i.creditedTotal.minor, currency })),
      currency,
    ),
  };
}

/** Periodo actual segun la fecha civil local. */
export function currentMonth(today: IsoDate): MonthKey {
  return monthKeyOf(today);
}

// ---------------------------------------------------------------------------
// Series para gráficos
// ---------------------------------------------------------------------------

/** Retrocede o avanza períodos mensuales sobre la clave `YYYY-MM`. */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface MonthPoint {
  readonly month: MonthKey;
  readonly invoiced: Money;
  readonly expenses: Money;
}

/**
 * Serie mensual terminada en `endMonth`, con los meses vacíos en cero.
 *
 * Rellenar los huecos importa: una serie que salta de marzo a junio dibuja una
 * tendencia que no existió.
 */
export function monthlySeries(
  state: State,
  endMonth: MonthKey,
  count: number,
  currency: CurrencyCode,
): MonthPoint[] {
  const points: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(endMonth, -i);
    points.push({
      month,
      invoiced: totalInvoiced(state, month, currency),
      expenses: totalExpenses(state, month, currency),
    });
  }
  return points;
}

export interface DayPoint {
  readonly date: IsoDate;
  readonly amount: Money;
}

/** Gasto por día del período, incluidos los días sin movimiento. */
export function dailyExpenses(state: State, month: MonthKey, currency: CurrencyCode): DayPoint[] {
  const range = monthRange(month);
  const byDate = new Map<string, Money>();
  for (const expense of activeExpenses(state)) {
    if (expense.status === "rejected" || expense.amount.currency !== currency) continue;
    if (!isWithin(expense.date, range)) continue;
    byDate.set(expense.date, add(byDate.get(expense.date) ?? zero(currency), expense.amount));
  }

  const days: DayPoint[] = [];
  const last = Number(range.to.slice(8));
  for (let day = 1; day <= last; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    days.push({ date, amount: byDate.get(date) ?? zero(currency) });
  }
  return days;
}
