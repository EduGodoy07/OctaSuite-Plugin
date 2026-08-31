import { describe, expect, it } from "vitest";
import { journalPathFor, mergeJournals, parseJournal, serializeEvent, sortEvents, type AnyEvent } from "../src/index.js";

const ev = (id: string, at: string): AnyEvent => ({
  id,
  at,
  v: 1,
  type: "category.created",
  payload: { categoryId: `cat_${id}`, name: id, code: id.toUpperCase() },
});

describe("Journal JSONL", () => {
  it("particiona por periodo mensual", () => {
    expect(journalPathFor("2026-08-24")).toBe("octasuite-data/journal/2026-08.jsonl");
    expect(journalPathFor("2026-08-24T10:00:00.000Z", "datos")).toBe("datos/journal/2026-08.jsonl");
    expect(() => journalPathFor("agosto")).toThrow();
  });

  it("ida y vuelta sin perdida", () => {
    const text = [ev("a", "2026-08-01T10:00:00.000Z"), ev("b", "2026-08-02T10:00:00.000Z")]
      .map(serializeEvent)
      .join("");
    const result = parseJournal(text);
    expect(result.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(result.corrupt).toEqual([]);
  });

  it("tolera una ultima linea truncada por un crash a media escritura", () => {
    const good = serializeEvent(ev("a", "2026-08-01T10:00:00.000Z"));
    const truncated = good + '{"id":"b","at":"2026-08-0';
    const result = parseJournal(truncated);
    expect(result.events.map((e) => e.id)).toEqual(["a"]);
    expect(result.corrupt).toHaveLength(1);
    expect(result.corrupt[0]?.line).toBe(2);
  });

  it("aparta lineas con sobre desconocido en vez de envenenar la proyeccion", () => {
    const text = `{"id":"x","at":"2026-08-01T10:00:00.000Z","v":9,"type":"category.created","payload":{}}\n`;
    expect(parseJournal(text).corrupt[0]?.reason).toMatch(/no reconocido/);
  });

  it("ordena por instante y desempata por id", () => {
    const ordered = sortEvents([ev("b", "2026-08-02T00:00:00.000Z"), ev("z", "2026-08-01T00:00:00.000Z"), ev("a", "2026-08-01T00:00:00.000Z")]);
    expect(ordered.map((e) => e.id)).toEqual(["a", "z", "b"]);
  });

  it("reconcilia el conflicto de sync deduplicando por id", () => {
    // Dos dispositivos offline: comparten el evento 'a', cada uno agrego el suyo.
    const deviceA = [ev("a", "2026-08-01T00:00:00.000Z"), ev("mac", "2026-08-02T00:00:00.000Z")].map(serializeEvent).join("");
    const deviceB = [ev("a", "2026-08-01T00:00:00.000Z"), ev("iphone", "2026-08-03T00:00:00.000Z")].map(serializeEvent).join("");
    const merged = mergeJournals(deviceA, deviceB);
    expect(merged.events.map((e) => e.id)).toEqual(["a", "mac", "iphone"]);
    expect(merged.corrupt).toEqual([]);
  });

  it("el merge es idempotente", () => {
    const text = [ev("a", "2026-08-01T00:00:00.000Z")].map(serializeEvent).join("");
    expect(mergeJournals(text, text, text).events).toHaveLength(1);
  });
});
