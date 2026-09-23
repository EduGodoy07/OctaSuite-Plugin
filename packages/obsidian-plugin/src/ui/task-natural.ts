import { parseNaturalTask, type TaskPriority } from "@octasuite/core";

/**
 * Estado del modal de tareas relevante para el autofill NL.
 * `due` vacío = sin vencimiento.
 */
export interface NaturalFormState {
  title: string;
  priority: TaskPriority;
  due: string;
}

const PRIORITY_TOKEN_RE = /(?:^|\s)![a-záéíóú]+(?=\s|$)/i;

/**
 * Aplica el parser de lenguaje natural (ES/EN) al estado del modal de tareas.
 *
 * - Devuelve `null` cuando el texto no trae tokens NL (título === texto crudo):
 *   señal para que el modal haga submit directo sin fricción.
 * - El título se limpia de tokens NL (prioridad/fecha/scope se extraen).
 * - La prioridad del texto manda SOLO si trae token de prioridad (`!alta`); si
 *   no, se conserva la prioridad ya elegida en el form.
 * - La fecha se aplica SOLO si el texto trae token de fecha; si no, se conserva
 *   la `due` ya elegida en el form.
 *
 * `referenceDate` se inyecta para tests deterministas (default: ahora).
 */
export function applyNaturalToForm(
  rawInput: string,
  current: NaturalFormState,
  referenceDate: Date = new Date(),
): NaturalFormState | null {
  const raw = rawInput.trim();
  if (raw === "") return null;

  const parsed = parseNaturalTask(raw, referenceDate);
  const hadTokens = parsed.title.trim() !== raw;
  if (!hadTokens) return null;

  const parsedPriority = parsed.priority ?? current.priority;
  const parsedDue = parsed.due ?? null;
  return {
    title: parsed.title.trim(),
    priority: PRIORITY_TOKEN_RE.test(raw) ? parsedPriority : current.priority,
    due: parsedDue !== null ? parsedDue : current.due,
  };
}