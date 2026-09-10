import { DomainError } from "../errors.js";
import { generateId, systemClock, type Clock } from "../ids.js";
import { validateCompanyId } from "./company.js";

// ── Tipos ──────────────────────────────────────────────────────────────

export type TaskStatus = "open" | "in-progress" | "waiting" | "blocked" | "paused" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "open",
  "in-progress",
  "waiting",
  "blocked",
  "paused",
  "done",
  "cancelled",
] as const;

export const TASK_PRIORITIES: readonly TaskPriority[] = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;

export const DEFAULT_TASK_STATUS: TaskStatus = "open";
export const DEFAULT_TASK_PRIORITY: TaskPriority = "normal";
export const TASK_SCOPE_GLOBAL = "global";
export const TASK_TITLE_MAX = 120;

export interface Task {
  readonly id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due: string | null;
  scope: string;
  tags: string[];
  created: string;
  updated: string;
  body: string;
}

export interface TaskDraft {
  title: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due?: string | null;
  scope?: string;
  tags?: string[];
  body?: string;
}

export type TaskParseResult = { ok: true; task: Task } | { ok: false; errors: DomainError[] };

// ── Transiciones ───────────────────────────────────────────────────────

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  open:       ["in-progress", "waiting", "blocked", "paused", "cancelled"],
  "in-progress": ["done", "blocked", "paused", "cancelled", "waiting"],
  waiting:    ["in-progress", "done", "blocked", "paused", "cancelled"],
  blocked:    ["in-progress", "waiting", "done", "cancelled", "paused"],
  paused:     ["in-progress", "waiting", "blocked", "done", "cancelled"],
  done:       [],
  cancelled:  [],
};

export const TASK_ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = TRANSITIONS;

export function taskCanTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// ── Helpers ────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_RE = /^[a-zA-Z0-9_-]+$/;

function normalizeDue(due: string | null | undefined): string | null {
  if (due === null || due === undefined) return null;
  const trimmed = due.trim();
  if (trimmed === "") return null;
  return trimmed;
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = raw.trim().replace(/^#+/, "");
    if (t === "" || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function setStatus(task: Task, status: TaskStatus): Task {
  return { ...task, status, updated: new Date().toISOString() };
}

// ── Validación ─────────────────────────────────────────────────────────

const STATUS_SET = new Set<string>(TASK_STATUSES);
const PRIORITY_SET = new Set<string>(TASK_PRIORITIES);

function validateScope(scope: string): DomainError[] {
  if (scope === TASK_SCOPE_GLOBAL) return [];
  return validateCompanyId(scope).map(
    (e) => new DomainError(`Alcance inválido: «${scope}» — ${e.message}`, "task.scope_invalid"),
  );
}

export function validateTaskDraft(draft: TaskDraft): DomainError[] {
  const errors: DomainError[] = [];

  // title
  const title = draft.title?.trim() ?? "";
  if (!title) {
    errors.push(new DomainError("El título es obligatorio", "task.title_required"));
  } else {
    if (title.length > TASK_TITLE_MAX) {
      errors.push(
        new DomainError(`El título no puede superar ${TASK_TITLE_MAX} caracteres`, "task.title_too_long"),
      );
    }
    if (title.includes("\n")) {
      errors.push(new DomainError("El título debe estar en una sola línea", "task.title_single_line"));
    }
  }

  // status
  if (draft.status !== undefined && !STATUS_SET.has(draft.status)) {
    errors.push(new DomainError(`Estado inválido: «${draft.status}»`, "task.status_invalid"));
  }

  // priority
  if (draft.priority !== undefined && !PRIORITY_SET.has(draft.priority)) {
    errors.push(new DomainError(`Prioridad inválida: «${draft.priority}»`, "task.priority_invalid"));
  }

  // due
  if (draft.due !== undefined && draft.due !== null) {
    const due = normalizeDue(draft.due);
    if (due !== null && !DATE_RE.test(due)) {
      errors.push(
        new DomainError(`Fecha límite inválida (formato YYYY-MM-DD): «${draft.due}»`, "task.due_invalid"),
      );
    }
  }

  // scope
  if (draft.scope !== undefined) {
    const scope = draft.scope.trim() || TASK_SCOPE_GLOBAL;
    errors.push(...validateScope(scope));
  }

  // tags
  if (draft.tags !== undefined) {
    const tags = normalizeTags(draft.tags);
    for (const tag of tags) {
      if (!TAG_RE.test(tag)) {
        errors.push(new DomainError(`Etiqueta inválida: «${tag}»`, "task.tag_invalid"));
      }
    }
  }

  return errors;
}

// ── CRUD ───────────────────────────────────────────────────────────────

export function createTask(draft: TaskDraft, clock: Clock = systemClock): Task {
  const errors = validateTaskDraft(draft);
  if (errors.length > 0) throw errors[0];

  const now = clock().toISOString();
  const id = generateId("task", clock);
  const scope = (draft.scope?.trim() || TASK_SCOPE_GLOBAL) as string;
  const due = normalizeDue(draft.due);

  return {
    id,
    title: draft.title.trim(),
    status: (draft.status ?? DEFAULT_TASK_STATUS) as TaskStatus,
    priority: (draft.priority ?? DEFAULT_TASK_PRIORITY) as TaskPriority,
    due,
    scope,
    tags: normalizeTags(draft.tags),
    created: now,
    updated: now,
    body: draft.body ?? "",
  };
}

export function updateTask(task: Task, patch: TaskDraft, clock: Clock = systemClock): Task {
  const merged: TaskDraft = {
    title: patch.title ?? task.title,
    status: patch.status ?? task.status,
    priority: patch.priority ?? task.priority,
    tags: patch.tags ?? task.tags,
    due: patch.due !== undefined ? patch.due : task.due,
    scope: patch.scope ?? task.scope,
    body: patch.body ?? task.body,
  };

  const errors = validateTaskDraft(merged);
  if (errors.length > 0) throw errors[0];

  // Check transition if status changed
  if (merged.status !== task.status && !taskCanTransition(task.status, merged.status!)) {
    throw new DomainError(
      `No se puede pasar de «${task.status}» a «${merged.status}»`,
      "task.invalid_transition",
    );
  }

  const now = clock().toISOString();
  const scope = (merged.scope?.trim() || TASK_SCOPE_GLOBAL) as string;
  const due = normalizeDue(merged.due);

  return {
    ...task,
    title: merged.title.trim(),
    status: (merged.status ?? task.status) as TaskStatus,
    priority: (merged.priority ?? task.priority) as TaskPriority,
    due,
    scope,
    tags: normalizeTags(merged.tags ?? task.tags),
    body: merged.body ?? task.body,
    updated: now,
  };
}

export function transitionTask(
  task: Task,
  to: TaskStatus,
  clock: Clock = systemClock,
): Task {
  if (!taskCanTransition(task.status, to)) {
    throw new DomainError(
      `No se puede pasar de «${task.status}» a «${to}»`,
      "task.invalid_transition",
    );
  }
  const now = clock().toISOString();
  return { ...task, status: to, updated: now };
}

// ── Serialización ──────────────────────────────────────────────────────

const YAML_FENCE = "---";
const KEYS_ORDER = ["id", "title", "status", "priority", "tags", "due", "scope", "created", "updated"] as const;
type TaskSerializableKey = (typeof KEYS_ORDER)[number];

function yamlEscapeScalar(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function serializeTask(task: Task): string {
  const lines: string[] = [YAML_FENCE];
  const values: Record<TaskSerializableKey, unknown> = {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    tags: task.tags,
    due: task.due,
    scope: task.scope,
    created: task.created,
    updated: task.updated,
  };
  for (const key of KEYS_ORDER) {
    const value = values[key];
    if (key === "due" && (value === null || value === undefined)) continue;
    if (key === "tags" && (value as string[]).length === 0) continue;
    if (key === "title") {
      lines.push(`${key}: ${yamlEscapeScalar(String(value))}`);
    } else if (key === "tags") {
      lines.push(`${key}: [${(value as string[]).map((t) => yamlEscapeScalar(t)).join(", ")}]`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push(YAML_FENCE);
  if (task.body) {
    lines.push("", task.body);
  }
  return lines.join("\n") + "\n";
}

// ── Parseo ─────────────────────────────────────────────────────────────

const FIELD_RE = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/;

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return t;
}

export function parseTask(markdown: string): TaskParseResult {
  const errors: DomainError[] = [];
  const fencePrefix = YAML_FENCE + "\n";
  if (!markdown.startsWith(fencePrefix)) {
    return {
      ok: false,
      errors: [new DomainError("Falta el bloque frontmatter (---)", "task.invalid_frontmatter")],
    };
  }

  const endIdx = markdown.indexOf("\n" + YAML_FENCE, YAML_FENCE.length);
  if (endIdx < 0) {
    return {
      ok: false,
      errors: [new DomainError("Falta el cierre del frontmatter (---)", "task.invalid_frontmatter")],
    };
  }

  const head = markdown.slice(YAML_FENCE.length + 1, endIdx);
  const body = markdown
    .slice(endIdx + 1 + YAML_FENCE.length)
    .replace(/^\n+/, "")
    .replace(/\n$/, "");

  const fields = new Map<string, string>();
  for (const raw of head.split("\n")) {
    if (raw.trim() === "") continue;
    const m = FIELD_RE.exec(raw);
    if (m?.[1]) fields.set(m[1], m[2] ?? "");
  }

  // id
  const id = fields.get("id");
  if (!id) errors.push(new DomainError("Falta el id", "task.id_required"));

  // title
  const rawTitle = fields.get("title");
  const title = rawTitle ? unquote(rawTitle) : "";
  if (!title) {
    errors.push(new DomainError("El título es obligatorio", "task.title_required"));
  }

  // status
  const statusStr = fields.get("status") ?? DEFAULT_TASK_STATUS;
  if (!STATUS_SET.has(statusStr)) {
    errors.push(new DomainError(`Estado inválido: «${statusStr}»`, "task.status_invalid"));
  }

  // priority
  const priorityStr = fields.get("priority") ?? DEFAULT_TASK_PRIORITY;
  if (!PRIORITY_SET.has(priorityStr)) {
    errors.push(new DomainError(`Prioridad inválida: «${priorityStr}»`, "task.priority_invalid"));
  }

  // due (absent → null)
  const dueStr = fields.get("due");
  const due = normalizeDue(dueStr);
  if (dueStr !== undefined && due !== null && !DATE_RE.test(due)) {
    errors.push(
      new DomainError(`Fecha límite inválida (formato YYYY-MM-DD): «${dueStr}»`, "task.due_invalid"),
    );
  }

  // scope
  const scopeStr = fields.get("scope") ?? TASK_SCOPE_GLOBAL;
  if (scopeStr !== TASK_SCOPE_GLOBAL && validateCompanyId(scopeStr).length > 0) {
    errors.push(new DomainError(`Alcance inválido: «${scopeStr}»`, "task.scope_invalid"));
  }

  // tags (ausente → [])
  const tagsStr = fields.get("tags");
  let tags: string[] = [];
  if (tagsStr !== undefined) {
    let inner = tagsStr.trim();
    if (inner.startsWith("[") && inner.endsWith("]")) inner = inner.slice(1, -1);
    tags = normalizeTags(inner.split(",").map((t) => unquote(t)));
    for (const tag of tags) {
      if (!TAG_RE.test(tag)) {
        errors.push(new DomainError(`Etiqueta inválida: «${tag}»`, "task.tag_invalid"));
      }
    }
  }

  // created
  const created = fields.get("created");
  if (!created) {
    errors.push(new DomainError("Falta created", "task.created_invalid"));
  }

  // updated
  const updated = fields.get("updated");
  if (!updated) {
    errors.push(new DomainError("Falta updated", "task.updated_invalid"));
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    task: {
      id: id!,
      title,
      status: statusStr as TaskStatus,
      priority: priorityStr as TaskPriority,
      due,
      scope: scopeStr,
      tags,
      created: created!,
      updated: updated!,
      body,
    },
  };
}

// ── Helpers de consulta ────────────────────────────────────────────────

export function taskIsTerminal(status: TaskStatus): boolean {
  return status === "done" || status === "cancelled";
}

export function taskIsDone(task: Task): boolean {
  return task.status === "done";
}

export function taskIsOverdue(task: Task): boolean {
  if (!task.due || taskIsDone(task) || task.status === "cancelled") return false;
  return task.due < new Date().toISOString().slice(0, 10);
}

export function taskIsDueSoon(
  task: Task,
  today: string = new Date().toISOString().slice(0, 10),
): boolean {
  if (!task.due || taskIsTerminal(task.status)) return false;
  return task.due >= today;
}

export function taskScopeVisibleIn(scope: string, activeCompanyId: string): boolean {
  return scope === TASK_SCOPE_GLOBAL || scope === activeCompanyId;
}
