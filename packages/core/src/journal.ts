import { isEventEnvelope, type AnyEvent } from "./events.js";

/**
 * El journal es append-only en JSONL, particionado por mes.
 *
 * Por que no un unico JSON como Expensica: un archivo monolitico reescrito en
 * cada cambio (a) pierde todo si el proceso muere a media escritura y (b) genera
 * conflictos de sincronizacion irreconciliables en iCloud/Obsidian Sync. Con
 * JSONL append-only, un crash pierde a lo sumo la ultima linea, y dos
 * dispositivos que escribieron offline se reconcilian reproduciendo y
 * deduplicando por id de evento.
 */
export function journalPathFor(dateOrInstant: string, folder = "octasuite-data"): string {
  const month = dateOrInstant.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new RangeError(`No se puede derivar el periodo de: ${dateOrInstant}`);
  }
  return `${folder}/journal/${month}.jsonl`;
}

export function serializeEvent(event: AnyEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export interface ParseResult {
  readonly events: AnyEvent[];
  /** Lineas que no se pudieron interpretar, con su numero (1-indexado) para reportarlas. */
  readonly corrupt: { line: number; text: string; reason: string }[];
}

export function parseJournal(text: string): ParseResult {
  const events: AnyEvent[] = [];
  const corrupt: { line: number; text: string; reason: string }[] = [];
  const lines = text.split("\n");

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      corrupt.push({ line: index + 1, text: line, reason: e instanceof Error ? e.message : "JSON invalido" });
      return;
    }
    if (!isEventEnvelope(parsed)) {
      corrupt.push({ line: index + 1, text: line, reason: "Sobre de evento no reconocido" });
      return;
    }
    events.push(parsed);
  });

  return { events, corrupt };
}

/** Orden total y estable: por instante y, a igual instante, por id. */
export function sortEvents(events: readonly AnyEvent[]): AnyEvent[] {
  return [...events].sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.at < b.at ? -1 : 1));
}

/**
 * Reconcilia varios journals del mismo periodo (el original y las copias que
 * deja el sync al detectar conflicto). Deduplica por id: reproducir dos veces el
 * mismo hecho no lo duplica.
 */
export function mergeJournals(...texts: readonly string[]): ParseResult {
  const byId = new Map<string, AnyEvent>();
  const corrupt: { line: number; text: string; reason: string }[] = [];
  for (const text of texts) {
    const result = parseJournal(text);
    corrupt.push(...result.corrupt);
    for (const event of result.events) {
      if (!byId.has(event.id)) byId.set(event.id, event);
    }
  }
  return { events: sortEvents([...byId.values()]), corrupt };
}
