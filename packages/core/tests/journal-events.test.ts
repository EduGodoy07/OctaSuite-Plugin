import { describe, expect, it } from "vitest";
import { groupEventsByMonth } from "../src/import/journal-events.js";
import type { AnyEvent } from "../src/events.js";

const event = (id: string, at: string): AnyEvent => ({
  id,
  at,
  v: 1,
  type: "expense.created",
  payload: { expenseId: id },
} as unknown as AnyEvent);

describe("groupEventsByMonth", () => {
  it("partitions events into the month encoded in their timestamp", () => {
    const grouped = groupEventsByMonth([
      event("e1", "2026-08-31T23:59:59.000Z"),
      event("e2", "2026-09-01T00:00:00.000Z"),
      event("e3", "2026-08-03T12:00:00.000Z"),
    ]);

    expect([...grouped.keys()]).toEqual(["2026-08", "2026-09"]);
    expect(grouped.get("2026-08")?.map((item) => item.id)).toEqual(["e1", "e3"]);
    expect(grouped.get("2026-09")?.map((item) => item.id)).toEqual(["e2"]);
  });


  it("deduplicates IDs across the existing journal and within one import batch", async () => {
    const { filterNewJournalEvents } = await import("../src/import/journal-events.js");
    const result = filterNewJournalEvents(
      [
        event("already-there", "2026-08-01T12:00:00.000Z"),
        event("new", "2026-09-01T12:00:00.000Z"),
        event("new", "2026-09-02T12:00:00.000Z"),
      ],
      new Set(["already-there"]),
    );
    expect(result.fresh.map((item) => item.id)).toEqual(["new"]);
    expect(result.duplicateCount).toBe(2);
  });

  it("returns an empty map for an empty import", () => {
    expect(groupEventsByMonth([])).toEqual(new Map());
  });

  it("rejects events with invalid timestamps rather than writing them to a guessed month", () => {
    expect(() => groupEventsByMonth([event("bad", "not-a-timestamp")])).toThrow(/instante inválido/);
  });
});
