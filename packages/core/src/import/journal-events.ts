import type { AnyEvent } from "../events.js";

/**
 * Group journal events by the month encoded in `at`, matching VaultJournal's
 * `journal/<companyId>/YYYY-MM.jsonl` partitioning convention.
 */
export function groupEventsByMonth(events: readonly AnyEvent[]): Map<string, AnyEvent[]> {
  const grouped = new Map<string, AnyEvent[]>();

  for (const event of events) {
    const month = event.at.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isFinite(Date.parse(event.at))) {
      throw new RangeError(`Evento ${event.id} tiene instante inválido: ${event.at}`);
    }
    const bucket = grouped.get(month) ?? [];
    bucket.push(event);
    grouped.set(month, bucket);
  }

  return grouped;
}
