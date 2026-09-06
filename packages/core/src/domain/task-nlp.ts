import { toIsoDate, type IsoDate } from "../dates.js";
import {
  DEFAULT_TASK_PRIORITY,
  type TaskDraft,
  type TaskPriority,
} from "./task.js";

export interface ParsedNaturalTask extends TaskDraft {
  readonly tags: string[];
}

const PRIORITY_TOKENS: Record<string, TaskPriority> = {
  urgent: "urgent",
  urgente: "urgent",
  high: "high",
  alta: "high",
  normal: "normal",
  media: "normal",
  low: "low",
  baja: "low",
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

function nextWeekday(base: Date, targetDay: number): Date {
  const currentDay = base.getDay();
  let diff = targetDay - currentDay;
  if (diff <= 0) diff += 7;
  return addDays(base, diff);
}

/**
 * Parsea una entrada de texto en lenguaje natural para extraer metadatos de tarea.
 * Reconoce:
 * - Prioridades: `!urgent`, `!alta`, `!baja`, etc.
 * - Ámbito / Scope: `@global`, `@principal`, etc.
 * - Etiquetas / Tags: `#fiscal`, `#sat`, etc.
 * - Fechas ISO: `YYYY-MM-DD`
 * - Fechas relativas: `hoy`, `mañana`, `pasado mañana`, `en N días`, `en N semanas`
 * - Días de la semana: `(el) lunes`, `viernes`, etc. (calcula el próximo día correspondiente)
 */
export function parseNaturalTask(
  input: string,
  referenceDate: Date = new Date(),
): ParsedNaturalTask {
  let text = input.trim();
  let priority: TaskPriority = DEFAULT_TASK_PRIORITY;
  let due: IsoDate | null = null;
  let scope: string | undefined = undefined;
  const tags: string[] = [];

  // 1. Extraer prioridades: !urgent, !alta, etc.
  text = text.replace(/(?:^|\s)!([a-zA-ZáéíóúÁÉÍÓÚ]+)(?=\s|$)/g, (_match, token: string) => {
    const key = token.toLowerCase();
    if (key in PRIORITY_TOKENS) {
      priority = PRIORITY_TOKENS[key]!;
      return "";
    }
    return _match;
  });

  // 2. Extraer scope: @global, @principal, etc.
  text = text.replace(/(?:^|\s)@([a-zA-Z0-9_-]+)(?=\s|$)/g, (_match, token: string) => {
    scope = token.trim();
    return "";
  });

  // 3. Extraer tags: #fiscal, #sat, etc.
  text = text.replace(/(?:^|\s)#([a-zA-Z0-9_-]+)(?=\s|$)/g, (_match, token: string) => {
    tags.push(token.trim());
    return "";
  });

  // 4. Extraer fechas explícitas ISO: YYYY-MM-DD
  text = text.replace(/(?:^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$)/g, (_match, isoDate: string) => {
    due = isoDate;
    return "";
  });

  // 5. Expresiones relativas: "en N días" o "en N semanas"
  text = text.replace(
    /(?:^|\s)en\s+(\d+)\s+(d[ií]as?|semanas?)(?=\s|$)/i,
    (_match, countStr: string, unit: string) => {
      const count = parseInt(countStr, 10);
      if (Number.isFinite(count) && count > 0) {
        if (/semana/i.test(unit)) {
          due = toIsoDate(addDays(referenceDate, count * 7));
        } else {
          due = toIsoDate(addDays(referenceDate, count));
        }
      }
      return "";
    },
  );

  // 6. Fechas relativas inmediatas: "pasado mañana", "mañana", "hoy"
  if (/(?:^|\s)pasado\s+mañana(?=\s|$)/i.test(text)) {
    due = toIsoDate(addDays(referenceDate, 2));
    text = text.replace(/(?:^|\s)pasado\s+mañana(?=\s|$)/i, "");
  } else if (/(?:^|\s)mañana(?=\s|$)/i.test(text)) {
    due = toIsoDate(addDays(referenceDate, 1));
    text = text.replace(/(?:^|\s)mañana(?=\s|$)/i, "");
  } else if (/(?:^|\s)hoy(?=\s|$)/i.test(text)) {
    due = toIsoDate(referenceDate);
    text = text.replace(/(?:^|\s)hoy(?=\s|$)/i, "");
  }

  // 7. Días de la semana: "(el) lunes", "(el) viernes", etc.
  const weekdayRegex = new RegExp(
    `(?:^|\\s)(?:el\\s+)?(${Object.keys(WEEKDAYS).join("|")})(?=\\s|$)`,
    "i",
  );
  const weekdayMatch = text.match(weekdayRegex);
  if (weekdayMatch && weekdayMatch[1]) {
    const dayName = weekdayMatch[1].toLowerCase();
    const targetDay = WEEKDAYS[dayName];
    if (targetDay !== undefined) {
      due = toIsoDate(nextWeekday(referenceDate, targetDay));
      text = text.replace(weekdayRegex, "");
    }
  }

  // Limpieza de espacios redundantes en el título
  const cleanTitle = text.replace(/\s+/g, " ").trim();
  const finalTitle = cleanTitle || input.trim();

  return {
    title: finalTitle,
    priority,
    due,
    scope,
    tags,
  };
}
