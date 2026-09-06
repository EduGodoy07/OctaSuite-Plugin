import { describe, expect, it } from "vitest";
import {
  activeAccounts,
  accountById,
  accountByCode,
  accountBalance,
  accountsByType,
  computeTrialBalance,
  DEFAULT_ACCOUNTS,
  entriesInMonth,
  entriesOnDate,
  isBalanced,
  normalSide,
  postedEntries,
  project,
  type AnyEvent,
} from "../src/index.js";

let seq = 0;
const at = (day: number) => `2026-08-${day.toString().padStart(2, "0")}T12:00:00.000Z`;
const evt = <T extends AnyEvent["type"]>(type: T, day: number, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: at(day), v: 1, type, payload } as AnyEvent);

// Helper: crear asiento cuadrado
function balancedEntry(
  entryId: string,
  day: number,
  desc: string,
  debitAccountId: string,
  creditAccountId: string,
  amount: number,
) {
  return evt("accounting.entry_posted", day, {
    entryId,
    date: `2026-08-${day.toString().padStart(2, "0")}`,
    description: desc,
    lines: [
      { accountId: debitAccountId, debit: { minor: amount, currency: "GTQ" }, credit: { minor: 0, currency: "GTQ" } },
      { accountId: creditAccountId, debit: { minor: 0, currency: "GTQ" }, credit: { minor: amount, currency: "GTQ" } },
    ],
  });
}

describe("Dominio de contabilidad", () => {
  it("normalSide retorna el lado correcto por tipo", () => {
    expect(normalSide("activo")).toBe("debit");
    expect(normalSide("gasto")).toBe("debit");
    expect(normalSide("pasivo")).toBe("credit");
    expect(normalSide("capital")).toBe("credit");
    expect(normalSide("ingreso")).toBe("credit");
  });

  it("isBalanced detecta asiento cuadrado", () => {
    const draft = {
      date: "2026-08-01",
      description: "Test",
      lines: [
        { accountId: "1", debit: { minor: 100, currency: "GTQ" }, credit: { minor: 0, currency: "GTQ" } },
        { accountId: "2", debit: { minor: 0, currency: "GTQ" }, credit: { minor: 100, currency: "GTQ" } },
      ],
    };
    expect(isBalanced(draft, "GTQ")).toBe(true);
  });

  it("isBalanced detecta asiento descuadrado", () => {
    const draft = {
      date: "2026-08-01",
      description: "Test",
      lines: [
        { accountId: "1", debit: { minor: 100, currency: "GTQ" }, credit: { minor: 0, currency: "GTQ" } },
        { accountId: "2", debit: { minor: 0, currency: "GTQ" }, credit: { minor: 80, currency: "GTQ" } },
      ],
    };
    expect(isBalanced(draft, "GTQ")).toBe(false);
  });
});

describe("Proyección de contabilidad", () => {
  it("crea cuentas del plan base", () => {
    const { state, rejected } = project(
      DEFAULT_ACCOUNTS.map((a, i) =>
        evt("accounting.account_created", 1 + Math.floor(i / 3), {
          accountId: `acc_${i}`,
          ...a,
        }),
      ),
    );
    expect(rejected).toEqual([]);
    expect(state.accounts.size).toBe(DEFAULT_ACCOUNTS.length);
    const caja = state.accounts.get("acc_0")!;
    expect(caja.code).toBe("1100");
    expect(caja.name).toBe("Caja");
    expect(caja.type).toBe("activo");
  });

  it("rechaza cuenta con código duplicado", () => {
    const { rejected } = project([
      evt("accounting.account_created", 1, { accountId: "a1", code: "1100", name: "Caja", type: "activo" }),
      evt("accounting.account_created", 2, { accountId: "a2", code: "1100", name: "Otra Caja", type: "activo" }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain("código");
  });

  it("actualiza nombre de cuenta", () => {
    const { state, rejected } = project([
      evt("accounting.account_created", 1, { accountId: "a1", code: "1100", name: "Caja", type: "activo" }),
      evt("accounting.account_updated", 2, { accountId: "a1", changes: { name: "Caja General" } }),
    ]);
    expect(rejected).toEqual([]);
    expect(state.accounts.get("a1")!.name).toBe("Caja General");
  });

  it("archiva y restaura cuenta", () => {
    const { state, rejected } = project([
      evt("accounting.account_created", 1, { accountId: "a1", code: "1100", name: "Caja", type: "activo" }),
      evt("accounting.account_archived", 2, { accountId: "a1" }),
    ]);
    expect(rejected).toEqual([]);
    expect(state.accounts.get("a1")!.archived).toBe(true);

    const { state: state2 } = project([
      evt("accounting.account_created", 1, { accountId: "a1", code: "1100", name: "Caja", type: "activo" }),
      evt("accounting.account_archived", 2, { accountId: "a1" }),
      evt("accounting.account_restored", 3, { accountId: "a1" }),
    ]);
    expect(state2.accounts.get("a1")!.archived).toBe(false);
  });

  it("publica asiento cuadrado correctamente", () => {
    const { state, rejected } = project([
      evt("accounting.account_created", 1, { accountId: "cash", code: "1100", name: "Caja", type: "activo" }),
      evt("accounting.account_created", 1, { accountId: "sales", code: "4100", name: "Ventas", type: "ingreso" }),
      balancedEntry("j1", 5, "Venta de contado", "cash", "sales", 50000),
    ]);
    expect(rejected).toEqual([]);
    const entry = state.journalEntries.get("j1")!;
    expect(entry.status).toBe("posted");
    expect(entry.lines).toHaveLength(2);
  });

  it("rechaza asiento descuadrado", () => {
    const { rejected } = project([
      evt("accounting.account_created", 1, { accountId: "cash", code: "1100", name: "Caja", type: "activo" }),
      evt("accounting.account_created", 1, { accountId: "sales", code: "4100", name: "Ventas", type: "ingreso" }),
      evt("accounting.entry_posted", 5, {
        entryId: "j1",
        date: "2026-08-05",
        description: "Descuadrado",
        lines: [
          { accountId: "cash", debit: { minor: 100, currency: "GTQ" }, credit: { minor: 0, currency: "GTQ" } },
          { accountId: "sales", debit: { minor: 0, currency: "GTQ" }, credit: { minor: 80, currency: "GTQ" } },
        ],
      }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].code).toBe("unbalanced");
  });

  it("rechaza asiento con cuenta inexistente", () => {
    const { rejected } = project([
      evt("accounting.entry_posted", 5, {
        entryId: "j1",
        date: "2026-08-05",
        description: "Fantasma",
        lines: [
          { accountId: "ghost", debit: { minor: 100, currency: "GTQ" }, credit: { minor: 0, currency: "GTQ" } },
          { accountId: "sales", debit: { minor: 0, currency: "GTQ" }, credit: { minor: 100, currency: "GTQ" } },
        ],
      }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].code).toBe("not_found");
  });

  it("anula asiento publicado", () => {
    const { state, rejected } = project([
      evt("accounting.account_created", 1, { accountId: "cash", code: "1100", name: "Caja", type: "activo" }),
      evt("accounting.account_created", 1, { accountId: "sales", code: "4100", name: "Ventas", type: "ingreso" }),
      balancedEntry("j1", 5, "Venta", "cash", "sales", 10000),
      evt("accounting.entry_voided", 10, { entryId: "j1", reason: "Error de captura" }),
    ]);
    expect(rejected).toEqual([]);
    const entry = state.journalEntries.get("j1")!;
    expect(entry.status).toBe("voided");
    expect(entry.voidReason).toBe("Error de captura");
  });

  it("rechaza doble anulación", () => {
    const { rejected } = project([
      evt("accounting.account_created", 1, { accountId: "cash", code: "1100", name: "Caja", type: "activo" }),
      evt("accounting.account_created", 1, { accountId: "sales", code: "4100", name: "Ventas", type: "ingreso" }),
      balancedEntry("j1", 5, "Venta", "cash", "sales", 10000),
      evt("accounting.entry_voided", 10, { entryId: "j1", reason: "Primero" }),
      evt("accounting.entry_voided", 12, { entryId: "j1", reason: "Segundo" }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].code).toBe("already_voided");
  });
});

describe("Consultas de contabilidad", () => {
  const { state } = project([
    evt("accounting.account_created", 1, { accountId: "cash", code: "1100", name: "Caja", type: "activo" }),
    evt("accounting.account_created", 1, { accountId: "bank", code: "1110", name: "Bancos", type: "activo" }),
    evt("accounting.account_created", 1, { accountId: "ar", code: "1200", name: "Cuentas por Cobrar", type: "activo" }),
    evt("accounting.account_created", 1, { accountId: "ap", code: "2100", name: "Cuentas por Pagar", type: "pasivo" }),
    evt("accounting.account_created", 1, { accountId: "capital", code: "3100", name: "Capital Social", type: "capital" }),
    evt("accounting.account_created", 1, { accountId: "sales", code: "4100", name: "Ventas", type: "ingreso" }),
    evt("accounting.account_created", 1, { accountId: "cogs", code: "5100", name: "Costo de Ventas", type: "gasto" }),
    balancedEntry("j1", 5, "Inversión inicial", "cash", "capital", 100000),
    balancedEntry("j2", 6, "Venta #1", "ar", "sales", 50000),
    balancedEntry("j3", 7, "Cobro", "cash", "ar", 50000),
    balancedEntry("j4", 8, "Compra inventario", "cogs", "cash", 20000),
  ]);

  it("activeAccounts filtra archivadas y ordena por código", () => {
    const accounts = activeAccounts(state);
    expect(accounts).toHaveLength(7);
    expect(accounts[0].code).toBe("1100");
    expect(accounts[6].code).toBe("5100");
  });

  it("accountsByType retorna solo del tipo indicado", () => {
    const activos = accountsByType(state, "activo");
    expect(activos).toHaveLength(3);
    const gastos = accountsByType(state, "gasto");
    expect(gastos).toHaveLength(1);
    expect(gastos[0].code).toBe("5100");
  });

  it("accountByCode", () => {
    expect(accountByCode(state, "1100")?.name).toBe("Caja");
    expect(accountByCode(state, "9999")).toBeUndefined();
  });

  it("accountBalance calcula saldo correcto", () => {
    // Caja: debió 100000 (j1) + 50000 (j3), acreditó 20000 (j4) = 130000
    expect(accountBalance(state, "cash", "GTQ")).toEqual({ minor: 130000, currency: "GTQ" });
    // Ventas: acreditó 50000 = -50000 (saldo negativo porque es crédito normal)
    expect(accountBalance(state, "sales", "GTQ")).toEqual({ minor: -50000, currency: "GTQ" });
    // Capital: acreditó 100000
    expect(accountBalance(state, "capital", "GTQ")).toEqual({ minor: -100000, currency: "GTQ" });
  });

  it("postedEntries ordena por fecha descendente", () => {
    const entries = postedEntries(state);
    expect(entries).toHaveLength(4);
    // Newest first
    expect(entries[0].description).toBe("Compra inventario");
    expect(entries[3].description).toBe("Inversión inicial");
  });

  it("entriesOnDate filtra por fecha", () => {
    const may5 = entriesOnDate(state, "2026-08-05");
    expect(may5).toHaveLength(1);
    expect(may5[0].description).toBe("Inversión inicial");
  });

  it("entriesInMonth", () => {
    const aug = entriesInMonth(state, "2026-08");
    expect(aug).toHaveLength(4);
  });
});

describe("Balance de comprobación", () => {
  const { state } = project([
    evt("accounting.account_created", 1, { accountId: "cash", code: "1100", name: "Caja", type: "activo" }),
    evt("accounting.account_created", 1, { accountId: "ar", code: "1200", name: "Cuentas por Cobrar", type: "activo" }),
    evt("accounting.account_created", 1, { accountId: "sales", code: "4100", name: "Ventas", type: "ingreso" }),
    evt("accounting.account_created", 1, { accountId: "cogs", code: "5100", name: "Costo de Ventas", type: "gasto" }),
    balancedEntry("j1", 5, "Venta #1", "ar", "sales", 50000),
    balancedEntry("j2", 6, "Cobro #1", "cash", "ar", 50000),
    balancedEntry("j3", 7, "Venta #2", "ar", "sales", 30000),
  ]);

  it("computeTrialBalance está cuadrado", () => {
    const tb = computeTrialBalance(
      [...state.accounts.values()],
      [...state.journalEntries.values()],
      "2026-08-31",
      "GTQ",
    );
    expect(tb.balanced).toBe(true);
    expect(tb.lines).toHaveLength(3); // cogs tiene 0 movimiento, no aparece
    expect(tb.totalDebits.minor).toBe(tb.totalCredits.minor);
  });

  it("excluye asientos voided del balance", () => {
    const { state: state2 } = project([
      evt("accounting.account_created", 1, { accountId: "cash", code: "1100", name: "Caja", type: "activo" }),
      evt("accounting.account_created", 1, { accountId: "sales", code: "4100", name: "Ventas", type: "ingreso" }),
      balancedEntry("j1", 5, "Venta", "cash", "sales", 10000),
      balancedEntry("j2", 6, "Venta", "cash", "sales", 20000),
      evt("accounting.entry_voided", 7, { entryId: "j1", reason: "Error" }),
    ]);
    const tb = computeTrialBalance(
      [...state2.accounts.values()],
      [...state2.journalEntries.values()],
      "2026-08-31",
      "GTQ",
    );
    // Solo j2: 20000
    expect(tb.totalDebits.minor).toBe(20000);
    expect(tb.totalCredits.minor).toBe(20000);
    expect(tb.balanced).toBe(true);
  });

  it("excluye asientos futuros del balance", () => {
    const { state: state2 } = project([
      evt("accounting.account_created", 1, { accountId: "cash", code: "1100", name: "Caja", type: "activo" }),
      evt("accounting.account_created", 1, { accountId: "sales", code: "4100", name: "Ventas", type: "ingreso" }),
      balancedEntry("j1", 5, "Hoy", "cash", "sales", 10000),
      balancedEntry("j2", 15, "Futuro", "cash", "sales", 50000),
    ]);
    const tb = computeTrialBalance(
      [...state2.accounts.values()],
      [...state2.journalEntries.values()],
      "2026-08-10", // antes del j2
      "GTQ",
    );
    expect(tb.totalDebits.minor).toBe(10000);
  });
});
