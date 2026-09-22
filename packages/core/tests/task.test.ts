import { describe, it, expect } from "vitest";
import {
  createTask,
  updateTask,
  transitionTask,
  taskCanTransition,
  taskIsTerminal,
  taskIsDone,
  taskIsOverdue,
  taskIsDueSoon,
  taskScopeVisibleIn,
  serializeTask,
  parseTask,
  validateTaskDraft,
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  TASK_SCOPE_GLOBAL,
  TASK_TITLE_MAX,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from "../src/index.js";

// ── Helpers ────────────────────────────────────────────────────────────

const FIXED_ISO = "2026-09-05T12:00:00.000Z";
const clock = () => new Date(FIXED_ISO);

const draft = (overrides?: Record<string, unknown>) => ({
  title: "Revisar facturas pendientes",
  ...overrides,
});

const task = (overrides?: Partial<Task>): Task => ({
  id: "task_20260905T120000_abc12345",
  title: "Revisar facturas pendientes",
  status: "open",
  priority: "normal",
  due: null,
  scope: TASK_SCOPE_GLOBAL,
  created: FIXED_ISO,
  updated: FIXED_ISO,
  body: "",
  tags: [],
  ...overrides,
});

const errCode = (fn: () => unknown): string => {
  try {
    fn();
    return "__no_error__";
  } catch (e: unknown) {
    return (e as { code?: string }).code ?? "__unknown__";
  }
};

// ── validateTaskDraft ──────────────────────────────────────────────────

describe("validateTaskDraft", () => {
  it("acepta un draft válido", () => {
    expect(validateTaskDraft(draft())).toEqual([]);
  });

  it("rechaza título vacío", () => {
    const errors = validateTaskDraft(draft({ title: "" }));
    expect(errors[0]?.code).toBe("task.title_required");
  });

  it("rechaza título solo espacios", () => {
    const errors = validateTaskDraft(draft({ title: "   " }));
    expect(errors[0]?.code).toBe("task.title_required");
  });

  it("rechaza título con salto de línea", () => {
    const errors = validateTaskDraft(draft({ title: "Línea uno\nLínea dos" }));
    expect(errors[0]?.code).toBe("task.title_single_line");
  });

  it("rechaza título mayor a 120 caracteres", () => {
    const errors = validateTaskDraft(draft({ title: "x".repeat(TASK_TITLE_MAX + 1) }));
    expect(errors[0]?.code).toBe("task.title_too_long");
  });

  it("acepta título de exactamente 120 caracteres", () => {
    expect(validateTaskDraft(draft({ title: "x".repeat(TASK_TITLE_MAX) }))).toEqual([]);
  });

  it("rechaza status inválido", () => {
    const errors = validateTaskDraft(draft({ status: "fantasy" as TaskStatus }));
    expect(errors[0]?.code).toBe("task.status_invalid");
  });

  it("rechaza priority inválida", () => {
    const errors = validateTaskDraft(draft({ priority: "mega" as TaskPriority }));
    expect(errors[0]?.code).toBe("task.priority_invalid");
  });

  it("rechaza due con formato inválido", () => {
    const errors = validateTaskDraft(draft({ due: "05/09/2026" }));
    expect(errors[0]?.code).toBe("task.due_invalid");
  });

  it("acepta due null", () => {
    expect(validateTaskDraft(draft({ due: null }))).toEqual([]);
  });

  it("acepta due vacío (se interpreta como null)", () => {
    expect(validateTaskDraft(draft({ due: "" }))).toEqual([]);
  });

  it("acepta due válido YYYY-MM-DD", () => {
    expect(validateTaskDraft(draft({ due: "2026-12-31" }))).toEqual([]);
  });

  it("rechaza scope inválido", () => {
    const errors = validateTaskDraft(draft({ scope: "INVALID!" }));
    expect(errors[0]?.code).toBe("task.scope_invalid");
  });

  it("acepta scope global", () => {
    expect(validateTaskDraft(draft({ scope: TASK_SCOPE_GLOBAL }))).toEqual([]);
  });

  it("acepta scope como companyId válido", () => {
    expect(validateTaskDraft(draft({ scope: "mi-empresa" }))).toEqual([]);
  });

  it("acumula múltiples errores", () => {
    const errors = validateTaskDraft({
      title: "",
      status: "zzz" as TaskStatus,
      priority: "zzz" as TaskPriority,
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
    const codes = errors.map((e) => e.code);
    expect(codes).toContain("task.title_required");
    expect(codes).toContain("task.status_invalid");
    expect(codes).toContain("task.priority_invalid");
  });
});

// ── createTask ─────────────────────────────────────────────────────────

describe("createTask", () => {
  it("crea una tarea con valores por defecto", () => {
    const t = createTask(draft(), clock);
    expect(t.id).toMatch(/^task_\d{8}T\d{6}_[a-z0-9]{8}$/);
    expect(t.title).toBe("Revisar facturas pendientes");
    expect(t.status).toBe(DEFAULT_TASK_STATUS);
    expect(t.priority).toBe(DEFAULT_TASK_PRIORITY);
    expect(t.due).toBeNull();
    expect(t.scope).toBe(TASK_SCOPE_GLOBAL);
    expect(t.created).toBe(FIXED_ISO);
    expect(t.updated).toBe(FIXED_ISO);
    expect(t.body).toBe("");
  });

  it("genera id con prefijo task_", () => {
    const t = createTask(draft(), clock);
    expect(t.id).toContain("task_");
  });

  it("usa clock para created y updated", () => {
    const t = createTask(draft(), clock);
    expect(t.created).toBe(FIXED_ISO);
    expect(t.updated).toBe(FIXED_ISO);
  });

  it("respeta scope personalizado", () => {
    const t = createTask(draft({ scope: "mi-empresa" }), clock);
    expect(t.scope).toBe("mi-empresa");
  });

  it("respeta due", () => {
    const t = createTask(draft({ due: "2026-12-25" }), clock);
    expect(t.due).toBe("2026-12-25");
  });

  it("respeta status y priority", () => {
    const t = createTask(draft({ status: "in-progress", priority: "urgent" }), clock);
    expect(t.status).toBe("in-progress");
    expect(t.priority).toBe("urgent");
  });

  it("respeta body", () => {
    const t = createTask(draft({ body: "Detalle aquí" }), clock);
    expect(t.body).toBe("Detalle aquí");
  });

  it("trimea title", () => {
    const t = createTask(draft({ title: " spaces  " }), clock);
    expect(t.title).toBe("spaces");
  });

  it("lanza DomainError si title vacío", () => {
    expect(() => createTask(draft({ title: "" }), clock)).toThrow("obligatorio");
  });
});

// ── updateTask ─────────────────────────────────────────────────────────

describe("updateTask", () => {
  it("actualiza campos y changed updated", () => {
    const t0 = createTask(draft(), clock);
    const t1 = updateTask(t0, { title: "Nuevo título", due: "2026-12-01" }, clock);
    expect(t1.title).toBe("Nuevo título");
    expect(t1.due).toBe("2026-12-01");
    expect(t1.updated).toBe(FIXED_ISO);
    expect(t1.id).toBe(t0.id);
    expect(t1.created).toBe(t0.created);
  });

  it("respeta status si es transición válida", () => {
    const t0 = createTask(draft({ status: "open" }), clock);
    const t1 = updateTask(t0, { status: "in-progress" }, clock);
    expect(t1.status).toBe("in-progress");
  });

  it("lanza DomainError si transición inválida", () => {
    const t0 = createTask(draft({ status: "done" }), clock);
    expect(errCode(() => updateTask(t0, { status: "open" }, clock))).toBe("task.invalid_transition");
  });

  it("valida el merge (title vacío en patch → error)", () => {
    const t0 = createTask(draft(), clock);
    expect(errCode(() => updateTask(t0, { title: "" }, clock))).toBe("task.title_required");
  });

  it("no cambia campos no presentes en patch", () => {
    const t0 = createTask(draft({ priority: "urgent", body: "texto" }), clock);
    const t1 = updateTask(t0, { title: "Actualizado" }, clock);
    expect(t1.priority).toBe("urgent");
    expect(t1.body).toBe("texto");
  });
});

// ── transitionTask ─────────────────────────────────────────────────────

describe("transitionTask", () => {
  it("permite transiciones válidas", () => {
    const t0 = createTask(draft({ status: "open" }), clock);
    const t1 = transitionTask(t0, "in-progress", clock);
    expect(t1.status).toBe("in-progress");
  });

  it("lanza DomainError para transiciones inválidas", () => {
    const t0 = createTask(draft({ status: "open" }), clock);
    expect(errCode(() => transitionTask(t0, "done", clock))).toBe("task.invalid_transition");
  });

  it("done no permite transiciones", () => {
    const t0 = createTask(draft({ status: "done" }), clock);
    expect(errCode(() => transitionTask(t0, "open", clock))).toBe("task.invalid_transition");
  });

  it("cancelled no permite transiciones", () => {
    const t0 = createTask(draft({ status: "cancelled" }), clock);
    expect(errCode(() => transitionTask(t0, "open", clock))).toBe("task.invalid_transition");
  });
});

// ── canTransition / isTerminal / isDone / isOverdue ────────────────────

describe("canTransition", () => {
  it("open → in-progress es válido", () => {
    expect(taskCanTransition("open", "in-progress")).toBe(true);
  });

  it("open → done es inválido (requiere in-progress primero)", () => {
    expect(taskCanTransition("open", "done")).toBe(false);
  });

  it("done → open es inválido (terminal)", () => {
    expect(taskCanTransition("done", "open")).toBe(false);
  });

  it("cancelled → open es inválido (terminal)", () => {
    expect(taskCanTransition("cancelled", "open")).toBe(false);
  });

  it("todas las transiciones del mapa son correctas", () => {
    // open: in-progress, waiting, blocked, paused, cancelled
    expect(taskCanTransition("open", "in-progress")).toBe(true);
    expect(taskCanTransition("open", "waiting")).toBe(true);
    expect(taskCanTransition("open", "blocked")).toBe(true);
    expect(taskCanTransition("open", "paused")).toBe(true);
    expect(taskCanTransition("open", "cancelled")).toBe(true);

    // in-progress: done, blocked, paused, cancelled, waiting
    expect(taskCanTransition("in-progress", "done")).toBe(true);
    expect(taskCanTransition("in-progress", "blocked")).toBe(true);
    expect(taskCanTransition("in-progress", "paused")).toBe(true);
    expect(taskCanTransition("in-progress", "cancelled")).toBe(true);
    expect(taskCanTransition("in-progress", "waiting")).toBe(true);

    // waiting: in-progress, done, blocked, paused, cancelled
    expect(taskCanTransition("waiting", "in-progress")).toBe(true);
    expect(taskCanTransition("waiting", "done")).toBe(true);
    expect(taskCanTransition("waiting", "blocked")).toBe(true);
    expect(taskCanTransition("waiting", "paused")).toBe(true);
    expect(taskCanTransition("waiting", "cancelled")).toBe(true);

    // blocked: in-progress, waiting, done, cancelled, paused
    expect(taskCanTransition("blocked", "in-progress")).toBe(true);
    expect(taskCanTransition("blocked", "waiting")).toBe(true);
    expect(taskCanTransition("blocked", "done")).toBe(true);
    expect(taskCanTransition("blocked", "cancelled")).toBe(true);
    expect(taskCanTransition("blocked", "paused")).toBe(true);

    // paused: in-progress, waiting, blocked, done, cancelled
    expect(taskCanTransition("paused", "in-progress")).toBe(true);
    expect(taskCanTransition("paused", "waiting")).toBe(true);
    expect(taskCanTransition("paused", "blocked")).toBe(true);
    expect(taskCanTransition("paused", "done")).toBe(true);
    expect(taskCanTransition("paused", "cancelled")).toBe(true);
  });
});

describe("isTerminal / isDone / isOverdue", () => {
  it("isTerminal true para done y cancelled", () => {
    expect(taskIsTerminal("done")).toBe(true);
    expect(taskIsTerminal("cancelled")).toBe(true);
    expect(taskIsTerminal("open")).toBe(false);
  });

  it("isDone true solo para done", () => {
    expect(taskIsDone(task({ status: "done" }))).toBe(true);
    expect(taskIsDone(task({ status: "open" }))).toBe(false);
  });

  it("isOverdue true cuando due < hoy y no está done/cancelled", () => {
    expect(taskIsOverdue(task({ due: "2020-01-01" }))).toBe(true);
  });

  it("isOverdue false cuando due es null", () => {
    expect(taskIsOverdue(task({ due: null }))).toBe(false);
  });

  it("isOverdue false cuando status es done", () => {
    expect(taskIsOverdue(task({ due: "2020-01-01", status: "done" }))).toBe(false);
  });

  it("isOverdue false cuando due es futuro", () => {
    expect(taskIsOverdue(task({ due: "2099-12-31" }))).toBe(false);
  });
});

// ── serializeTask / parseTask ──────────────────────────────────────────

describe("serializeTask + parseTask round-trip", () => {
  it("round-trip completo (todos los campos)", () => {
    const t0 = task({
      id: "task_20260905T120000_abc12345",
      title: "Entregar reporte",
      status: "in-progress",
      priority: "high",
      due: "2026-09-15",
      scope: "mi-empresa",
      created: "2026-09-01T10:00:00.000Z",
      updated: "2026-09-05T12:00:00.000Z",
      body: "Detalle del reporte aquí",
    });
    const md = serializeTask(t0);
    const result = parseTask(md);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task).toEqual(t0);
    }
  });

  it("sin due → due null en parse", () => {
    const t0 = task({ due: null });
    const md = serializeTask(t0);
    expect(md).not.toContain("due:");
    const result = parseTask(md);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.task.due).toBeNull();
  });

  it("title con comillas y backslashes round-trip", () => {
    const t0 = task({ title: 'He said "hello" \\back' });
    const md = serializeTask(t0);
    const result = parseTask(md);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.task.title).toBe('He said "hello" \\back');
  });

  it("body se preserva", () => {
    const t0 = task({ body: "Primera línea\nSegunda línea" });
    const md = serializeTask(t0);
    const result = parseTask(md);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.task.body).toBe("Primera línea\nSegunda línea");
  });

  it("parsea status inválido del archivo → error", () => {
    const md = `---
id: task_20260905T120000_abc12345
title: "Test"
status: fantasy
priority: normal
scope: global
created: 2026-09-05T12:00:00.000Z
updated: 2026-09-05T12:00:00.000Z
---`;
    const result = parseTask(md);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("task.status_invalid");
    }
  });

  it("falta frontmatter → error", () => {
    const result = parseTask("Sin frontmatter aquí");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("task.invalid_frontmatter");
  });

  it("falta cierre de frontmatter → error", () => {
    const result = parseTask("---\nid: x\ntitle: \"X\"");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("task.invalid_frontmatter");
  });

  it("falta id → error", () => {
    const md = `---
title: "Sin ID"
status: open
priority: normal
scope: global
created: 2026-09-05T12:00:00.000Z
updated: 2026-09-05T12:00:00.000Z
---`;
    const result = parseTask(md);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("task.id_required");
    }
  });

  it("falta created → error", () => {
    const md = `---
id: task_20260905T120000_abc12345
title: "Test"
status: open
priority: normal
scope: global
updated: 2026-09-05T12:00:00.000Z
---`;
    const result = parseTask(md);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("task.created_invalid");
    }
  });
});

// ── Serialización YAML ─────────────────────────────────────────────────

describe("serializeTask formato", () => {
  it("empieza y cierra con ---", () => {
    const md = serializeTask(task());
    expect(md.startsWith("---\n")).toBe(true);
    const lines = md.split("\n");
    const fenceLines = lines.filter((l) => l === "---");
    expect(fenceLines.length).toBe(2);
  });

  it("title siempre entrecomillado", () => {
    const md = serializeTask(task({ title: "Mi tarea" }));
    expect(md).toContain('title: "Mi tarea"');
  });

  it("sin línea due cuando due es null", () => {
    const md = serializeTask(task({ due: null }));
    const lines = md.split("\n");
    expect(lines.some((l) => l.startsWith("due:"))).toBe(false);
  });

  it("línea due cuando due tiene valor", () => {
    const md = serializeTask(task({ due: "2026-12-31" }));
    expect(md).toContain("due: 2026-12-31");
  });

  it("body va después de una línea vacía tras el segundo ---", () => {
    const md = serializeTask(task({ body: "Contenido" }));
    expect(md.trimEnd().endsWith("---\n\nContenido")).toBe(true);
  });
});

// ── Etiquetas (tags) ───────────────────────────────────────────────────

describe("tags", () => {
  it("valida draft con tags aceptables", () => {
    expect(validateTaskDraft(draft({ tags: ["fiscal", "sat"] }))).toEqual([]);
  });

  it("rechaza tag con caracteres inválidos", () => {
    const errors = validateTaskDraft(draft({ tags: ["fiscal", "con espacio"] }));
    expect(errors[0]?.code).toBe("task.tag_invalid");
  });

  it("createTask normaliza tags (trim, quita #, descarta vacíos, dedupe)", () => {
    const t = createTask(
      draft({ title: "Declarar ISR", tags: [" fiscal ", "#sat", "fiscal", "", "  "] }),
      clock,
    );
    expect(t.tags).toEqual(["fiscal", "sat"]);
  });

  it("createTask sin tags → []", () => {
    const t = createTask(draft({ title: "Sin tags" }), clock);
    expect(t.tags).toEqual([]);
  });

  it("updateTask reemplaza tags y [] limpia", () => {
    const t0 = createTask(draft({ title: "Con tags", tags: ["fiscal"] }), clock);
    const t1 = updateTask(t0, { tags: ["sat", "2026"] }, clock);
    expect(t1.tags).toEqual(["sat", "2026"]);
    const t2 = updateTask(t0, { tags: [] }, clock);
    expect(t2.tags).toEqual([]);
  });

  it("serializeTask incluye tags en frontmatter", () => {
    const md = serializeTask(task({ tags: ["fiscal", "sat"] }));
    expect(md).toContain('tags: ["fiscal", "sat"]');
  });

  it("serializeTask omite línea tags cuando está vacío", () => {
    const md = serializeTask(task({ tags: [] }));
    expect(md.split("\n").some((l) => l.startsWith("tags:"))).toBe(false);
  });

  it("round-trip con tags", () => {
    const original = task({ tags: ["fiscal", "sat"] });
    const result = parseTask(serializeTask(original));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.tags).toEqual(["fiscal", "sat"]);
    }
  });

  it("parseTask sin línea tags → []", () => {
    const md = serializeTask(task({ tags: [] }));
    const result = parseTask(md);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.tags).toEqual([]);
    }
  });
});

// ── taskIsDueSoon ──────────────────────────────────────────────────────

describe("taskIsDueSoon", () => {
  const today = "2026-09-05";

  it("true cuando due es hoy", () => {
    expect(taskIsDueSoon(task({ due: today }), today)).toBe(true);
  });

  it("true cuando due es futuro", () => {
    expect(taskIsDueSoon(task({ due: "2026-09-06" }), today)).toBe(true);
  });

  it("false cuando due es ayer", () => {
    expect(taskIsDueSoon(task({ due: "2026-09-04" }), today)).toBe(false);
  });

  it("false cuando due es null", () => {
    expect(taskIsDueSoon(task({ due: null }), today)).toBe(false);
  });

  it("false cuando status es done", () => {
    expect(taskIsDueSoon(task({ due: today, status: "done" }), today)).toBe(false);
  });

  it("false cuando status es cancelled", () => {
    expect(taskIsDueSoon(task({ due: today, status: "cancelled" }), today)).toBe(false);
  });
});

// ── taskScopeVisibleIn ─────────────────────────────────────────────────

describe("taskScopeVisibleIn", () => {
  it("global visible en cualquier empresa", () => {
    expect(taskScopeVisibleIn(TASK_SCOPE_GLOBAL, "mi-empresa")).toBe(true);
  });

  it("scope igual a empresa activa visible", () => {
    expect(taskScopeVisibleIn("mi-empresa", "mi-empresa")).toBe(true);
  });

  it("scope foráneo no visible", () => {
    expect(taskScopeVisibleIn("principal", "mi-empresa")).toBe(false);
  });
});
