import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  EXPENSE_STATUSES,
  fromDecimal,
  validateExpenseDraft,
  type ExpenseStatus,
} from "../src/index.js";

/**
 * Matriz portada de `ExpenseResource/Pages/EditExpense.php`, donde OctaSuite
 * expresa cada transicion con `visible()`:
 *   draft -> submitted | submitted -> approved/rejected | approved -> paid
 *   submitted|rejected -> draft (reset)
 */
const LEGAL: ReadonlyArray<[ExpenseStatus, ExpenseStatus]> = [
  ["draft", "submitted"],
  ["submitted", "approved"],
  ["submitted", "rejected"],
  ["submitted", "draft"],
  ["approved", "paid"],
  ["rejected", "draft"],
];

describe("Maquina de estados del gasto", () => {
  it("permite exactamente las transiciones del ERP", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("rechaza toda transicion fuera de la matriz", () => {
    const legal = new Set(LEGAL.map(([f, t]) => `${f}->${t}`));
    for (const from of EXPENSE_STATUSES) {
      for (const to of EXPENSE_STATUSES) {
        if (legal.has(`${from}->${to}`)) continue;
        expect(canTransition(from, to), `${from} -> ${to} deberia ser ilegal`).toBe(false);
      }
    }
  });

  it("un gasto pagado es terminal", () => {
    for (const to of EXPENSE_STATUSES) expect(canTransition("paid", to)).toBe(false);
    expect(() => assertTransition("paid", "draft")).toThrow(/no permitida/);
  });

  it("no se salta la aprobacion", () => {
    expect(() => assertTransition("draft", "paid")).toThrow(/draft -> paid/);
    expect(() => assertTransition("submitted", "paid")).toThrow();
  });
});

describe("Validacion del gasto", () => {
  const valid = { name: "Taxi al cliente", amount: fromDecimal("125.50", "GTQ"), date: "2026-08-24" };

  it("acepta un borrador completo", () => {
    expect(validateExpenseDraft(valid)).toEqual([]);
  });

  it("exige nombre, monto positivo y fecha valida", () => {
    expect(validateExpenseDraft({ ...valid, name: "  " }).map((e) => e.code)).toEqual(["expense.name_required"]);
    expect(validateExpenseDraft({ ...valid, amount: fromDecimal("0", "GTQ") }).map((e) => e.code)).toEqual([
      "expense.amount_zero",
    ]);
    expect(validateExpenseDraft({ ...valid, amount: fromDecimal("-1", "GTQ") }).map((e) => e.code)).toEqual([
      "expense.amount_negative",
    ]);
    expect(validateExpenseDraft({ ...valid, date: "2026-02-30" }).map((e) => e.code)).toEqual(["date.nonexistent"]);
  });

  it("reporta todos los problemas juntos, no solo el primero", () => {
    expect(validateExpenseDraft({}).length).toBe(3);
  });
});
