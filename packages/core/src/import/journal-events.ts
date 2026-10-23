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

/**
 * Remove events already present in the journal and duplicate IDs repeated in
 * the same import batch. The first occurrence wins, preserving source order.
 */
export function filterNewJournalEvents(
  events: readonly AnyEvent[],
  existingIds: ReadonlySet<string>,
): { fresh: AnyEvent[]; duplicateCount: number } {
  const seen = new Set(existingIds);
  const fresh: AnyEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    fresh.push(event);
  }
  return { fresh, duplicateCount: events.length - fresh.length };
}
