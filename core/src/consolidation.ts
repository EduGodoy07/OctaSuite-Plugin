import {
  discountSummary,
  emptyState,
  expensesInMonth,
  invoicesInMonth,
  totalExpenses,
  totalInvoiced,
  type DiscountSummary,
  type State,
} from "./store.js";
import { add, sum, zero, type CurrencyCode, type Money } from "./money.js";
import type { IsoDate, MonthKey } from "./dates.js";
import {
  customerKey,
  dailyExpenses,
  expensesVsPreviousWeekday,
  monthlySeries,
  paymentMix,
  pendingApprovalCount,
  unpaidInvoices,
  type Comparison,
  type CustomerMetrics,
  type DayPoint,
  type MonthPoint,
} from "./analytics.js";

/**
 * Consolidación multi-empresa.
 *
 * Cada empresa proyecta su propio State: los ids de categoría, cliente o
 * documento pertenecen a su partición y NO son intercambiables entre empresas.
 * Por eso acá nunca se mezclan estados: se agregan KPIs escalares con la misma
 * moneda, o se reagrupa la fuente (facturas/gastos) con una clave semántica
 * (code de categoría, NIT normalizado) que sí es estable entre empresas.
 */

/**
 * Builds a zero Money value in the given currency.
 */
function zeroOf(currency: CurrencyCode): Money {
  return zero(currency);
}

/**
 * Suma el total facturado de N empresas en un periodo. Las facturas se suman
 * solo si su moneda coincide con la consulta (mismo criterio que totalInvoiced).
 */
export function consolidatedTotalInvoiced(
  states: readonly State[],
  month: MonthKey,
  currency: CurrencyCode,
): Money {
  const amounts = states.map((s) => totalInvoiced(s, month, currency));
  return sum(amounts, currency);
}

/**
 * Suma el total de gastos de N empresas en un periodo, excluyendo rechazados
 * y filtrando por moneda (mismo criterio que totalExpenses).
 */
export function consolidatedTotalExpenses(
  states: readonly State[],
  month: MonthKey,
  currency: CurrencyCode,
): Money {
  const amounts = states.map((s) => totalExpenses(s, month, currency));
  return sum(amounts, currency);
}

/** Suma documentos y saldo pendiente de cobro de N empresas. */
export function consolidatedUnpaid(
  states: readonly State[],
  month: MonthKey,
  currency: CurrencyCode,
): { count: number; amount: Money } {
  let count = 0;
  const amounts: Money[] = [];
  for (const s of states) {
    const unpaid = unpaidInvoices(s, month, currency);
    count += unpaid.count;
    amounts.push(unpaid.amount);
  }
  return { count, amount: sum(amounts, currency) };
}

/** Suma gastos en `submitted` (pendientes de aprobación) de N empresas. */
export function consolidatedPendingApproval(states: readonly State[]): number {
  return states.reduce((acc, s) => acc + pendingApprovalCount(s), 0);
}

/**
 * Compara el gasto de hoy contra el mismo día de la semana pasada, sumando
 * ambas empresas. Recalcula deltaPercent sobre los totales consolidados;
 * si no hubo movimiento la semana pasada, devuelve delta null (sin dividir
 * por cero), igual que expensesVsPreviousWeekday.
 */
export function consolidatedComparison(
  states: readonly State[],
  date: IsoDate,
  currency: CurrencyCode,
): Comparison {
  const comparisons = states.map((s) => expensesVsPreviousWeekday(s, date, currency));
  const currents = comparisons.map((c) => c.current);
  const previouses = comparisons.map((c) => c.previous);
  const current = sum(currents, currency);
  const previous = sum(previouses, currency);
  return {
    current,
    previous,
    deltaPercent: previous.minor === 0 ? null : ((current.minor - previous.minor) / previous.minor) * 100,
  };
}

/**
 * Serie mensual consolidada. Todos los estados comparten los mismos meses
 * (la serie se genera desde `endMonth` hacia atrás, con huecos en cero), así
 * que se suman punto a punto.
 */
export function consolidatedMonthlySeries(
  states: readonly State[],
  endMonth: MonthKey,
  count: number,
  currency: CurrencyCode,
): MonthPoint[] {
  if (states.length === 0) return monthlySeries(emptyState(), endMonth, count, currency);
  const reference = monthlySeries(states[0]!, endMonth, count, currency);
  return reference.map((point, i) => {
    let invoiced = zeroOf(currency);
    let expenses = zeroOf(currency);
    for (const s of states) {
      const other = monthlySeries(s, endMonth, count, currency);
      invoiced = add(invoiced, other[i]!.invoiced);
      expenses = add(expenses, other[i]!.expenses);
    }
    return { month: point.month, invoiced, expenses };
  });
}

/**
 * Gasto por día calendario consolidado. `dailyExpenses` siempre devuelve
 * todos los días del mes (con cero cuando no hay movimiento), así que los
 * puntos se alinean por índice.
 */
export function consolidatedDailyExpenses(
  states: readonly State[],
  month: MonthKey,
  currency: CurrencyCode,
): DayPoint[] {
  if (states.length === 0) return dailyExpenses(emptyState(), month, currency);
  const reference = dailyExpenses(states[0]!, month, currency);
  return reference.map((point, i) => {
    let amount = zeroOf(currency);
    for (const s of states) {
      const other = dailyExpenses(s, month, currency);
      amount = add(amount, other[i]!.amount);
    }
    return { date: point.date, amount };
  });
}

export interface ConsolidatedCategoryTotal {
  /** Code de la categoría: estable entre empresas (el id no lo es). */
  readonly code: string;
  /** Nombre de la categoría para mostrar (del estado que la definió). */
  readonly name: string;
  readonly amount: Money;
}

/**
 * Gasto por categoría consolidado, agrupando por CODE de categoría.
 *
 * El id de una categoría es local a su empresa (generateId); el mismo rubro
 * ("Materia Prima") vive con ids distintos en cada partición. El code viene del
 * catálogo semántico y sí es compartido. Los gastos sin categoría se agrupan
 * bajo "sin-categoria" (mismo criterio que expensesByCategory).
 */
export function consolidatedExpensesByCategory(
  states: readonly State[],
  month: MonthKey,
  currency: CurrencyCode,
): ConsolidatedCategoryTotal[] {
  const byCode = new Map<string, { name: string; amount: Money }>();
  for (const s of states) {
    for (const expense of expensesInMonth(s, month)) {
      if (expense.status === "rejected" || expense.amount.currency !== currency) continue;
      const categoryId = expense.categoryId ?? null;
      const category = categoryId === null ? undefined : s.categories.get(categoryId);
      const code = category?.code ?? "sin-categoria";
      const name = category?.name ?? "Sin categoría";
      const entry = byCode.get(code) ?? { name, amount: zeroOf(currency) };
      entry.amount = add(entry.amount, expense.amount);
      byCode.set(code, entry);
    }
  }
  return [...byCode.entries()]
    .map(([code, entry]) => ({ code, name: entry.name, amount: entry.amount }))
    .sort((a, b) => b.amount.minor - a.amount.minor || a.code.localeCompare(b.code));
}

export function consolidatedDiscountSummary(
  states: readonly State[],
  month: MonthKey,
  currency: CurrencyCode,
): DiscountSummary {
  let documents = 0;
  const amounts: Money[] = [];
  for (const s of states) {
    const d = discountSummary(s, month, currency);
    documents += d.documents;
    amounts.push(d.total);
  }
  return { total: sum(amounts, currency), documents };
}

/**
 * Mezcla de formas de pago consolidada. Suma el total cobrado y los montos por
 * método, luego recalcula las proporciones sobre el total consolidado.
 */
export function consolidatedPaymentMix(
  states: readonly State[],
  month: MonthKey,
  currency: CurrencyCode,
): { total: Money; slices: readonly { method: string; amount: Money; share: number }[] } {
  const byMethod = new Map<string, Money>();
  const total = zeroOf(currency);
  for (const s of states) {
    const mix = paymentMix(s, month, currency);
    for (const slice of mix.slices) {
      byMethod.set(slice.method, add(byMethod.get(slice.method) ?? zeroOf(currency), slice.amount));
    }
  }
  const consolidatedTotal = [...byMethod.values()].reduce((acc, m) => add(acc, m), total);
  const slices = [...byMethod.entries()]
    .map(([method, amount]) => ({
      method,
      amount,
      share: consolidatedTotal.minor === 0 ? 0 : amount.minor / consolidatedTotal.minor,
    }))
    .sort((a, b) => b.amount.minor - a.amount.minor || a.method.localeCompare(b.method));
  return { total: consolidatedTotal, slices };
}

/**
 * Métricas de clientes consolidada: reagrupa las facturas de TODAS las
 * empresas con una sola clave de cliente (customerKey). Un mismo NIT que
 * compra en dos empresas es UN cliente identificado — no se suman los
 * identified por empresa porque eso duplicaría a los clientes compartidos.
 */
export function consolidatedCustomerMetrics(
  states: readonly State[],
  month: MonthKey,
  currency: CurrencyCode,
): CustomerMetrics {
  const invoices = states.flatMap((s) => invoicesInMonth(s, month)).filter((i) => i.currency === currency);
  const byCustomer = new Map<string, { count: number; total: Money }>();

  for (const invoice of invoices) {
    const key = customerKey(invoice.partnerId, invoice.partnerTaxId);
    if (!key) continue;
    const entry = byCustomer.get(key) ?? { count: 0, total: zeroOf(currency) };
    byCustomer.set(key, { count: entry.count + 1, total: add(entry.total, invoice.totals.total) });
  }

  const revenue = invoices.reduce((acc, i) => add(acc, i.totals.total), zeroOf(currency));
  const identified = byCustomer.size;
  const returning = [...byCustomer.values()].filter((c) => c.count > 1).length;
  const identifiedRevenue = [...byCustomer.values()].reduce((acc, c) => add(acc, c.total), zeroOf(currency));

  return {
    tickets: invoices.length,
    identified,
    returning,
    returningRate: identified === 0 ? null : returning / identified,
    avgTicket:
      invoices.length === 0 ? zeroOf(currency) : { minor: Math.round(revenue.minor / invoices.length), currency },
    avgPerCustomer:
      identified === 0 ? zeroOf(currency) : { minor: Math.round(identifiedRevenue.minor / identified), currency },
  };
}

// ── helpers internos ─────────────────────────────────────────────────────────

// emptyState() viene de store.js: estado mínimo para consultas de forma
// (meses/días completos en cero) cuando la lista de estados viene vacía. El
// plugin siempre pasa al menos la empresa primaria; esto solo cubre robustez.