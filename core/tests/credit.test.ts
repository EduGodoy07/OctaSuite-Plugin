import { describe, expect, it } from "vitest";
import {
  allCreditAccounts,
  creditAccountByPartner,
  creditBalanceFor,
  creditTransactionsFor,
  project,
  type AnyEvent,
} from "../src/index.js";

let seq = 0;
const at = (day: number) => `2026-08-${day.toString().padStart(2, "0")}T12:00:00.000Z`;
const evt = <T extends AnyEvent["type"]>(type: T, day: number, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: at(day), v: 1, type, payload } as AnyEvent);

const g = (minor: number) => ({ minor, currency: "GTQ" });
const account = (state: { creditAccounts: Map<string, { id: string; partnerId: string; partnerName: string; balances: Map<string, { minor: number; currency: string }> }> }, id: string) =>
  state.creditAccounts.get(id)!;

describe("Proyeccion de credito de cliente", () => {
  it("abona y crea la cuenta de credito", () => {
    const { state, rejected } = project([
      evt("credit.added", 5, {
        accountId: "crd_1",
        partnerId: "p_1",
        partnerName: "Cliente Uno",
        amount: g(5000),
      }),
    ]);
    expect(rejected).toEqual([]);
    const acct = account(state, "crd_1");
    expect(acct.partnerId).toBe("p_1");
    expect(acct.partnerName).toBe("Cliente Uno");
    expect(acct.balances.get("GTQ")!.minor).toBe(5000);
    const tx = creditTransactionsFor(state, "crd_1");
    expect(tx).toHaveLength(1);
    expect(tx[0].type).toBe("added");
    expect(tx[0].amount.minor).toBe(5000);
  });

  it("acumula abonos en la cuenta existente", () => {
    const { state } = project([
      evt("credit.added", 5, { accountId: "crd_1", partnerId: "p_1", partnerName: "Cliente Uno", amount: g(5000) }),
      evt("credit.added", 10, { accountId: "crd_1", partnerId: "p_1", partnerName: "Cliente Uno", amount: g(3000) }),
    ]);
    expect(account(state, "crd_1").balances.get("GTQ")!.minor).toBe(8000);
  });

  it("consumo reduce el saldo y registra la transaccion con referencia", () => {
    const { state, rejected } = project([
      evt("credit.added", 5, { accountId: "crd_1", partnerId: "p_1", partnerName: "Cliente Uno", amount: g(5000) }),
      evt("credit.used", 6, { accountId: "crd_1", amount: g(2000), reference: "inv_1" }),
    ]);
    expect(rejected).toEqual([]);
    expect(account(state, "crd_1").balances.get("GTQ")!.minor).toBe(3000);
    const tx = creditTransactionsFor(state, "crd_1");
    expect(tx).toHaveLength(2);
    expect(tx[1].type).toBe("used");
    expect(tx[1].amount.minor).toBe(-2000);
    expect(tx[1].reference).toBe("inv_1");
  });

  it("rechaza consumo sin cuenta de credito", () => {
    const { state, rejected } = project([
      evt("credit.used", 6, { accountId: "crd_1", amount: g(2000), reference: "inv_1" }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].code).toBe("not_found");
    expect(state.creditAccounts.size).toBe(0);
  });

  it("rechaza consumo por saldo insuficiente", () => {
    const { state, rejected } = project([
      evt("credit.added", 5, { accountId: "crd_1", partnerId: "p_1", partnerName: "Cliente Uno", amount: g(1000) }),
      evt("credit.used", 6, { accountId: "crd_1", amount: g(2000), reference: "inv_1" }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].code).toBe("insufficient_balance");
    expect(account(state, "crd_1").balances.get("GTQ")!.minor).toBe(1000);
  });

  it("rechaza consumo en moneda sin saldo", () => {
    const { state, rejected } = project([
      evt("credit.added", 5, { accountId: "crd_1", partnerId: "p_1", partnerName: "Cliente Uno", amount: g(5000) }),
      evt("credit.used", 6, { accountId: "crd_1", amount: { minor: 500, currency: "USD" }, reference: "inv_1" }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].code).toBe("insufficient_balance");
    expect(account(state, "crd_1").balances.get("GTQ")!.minor).toBe(5000);
  });

  it("ajuste negativo deja el saldo en cero y registra transaccion", () => {
    const { state, rejected } = project([
      evt("credit.added", 5, { accountId: "crd_1", partnerId: "p_1", partnerName: "Cliente Uno", amount: g(5000) }),
      evt("credit.adjusted", 6, { accountId: "crd_1", amount: g(-5000), reason: "Corrección" }),
    ]);
    expect(rejected).toEqual([]);
    expect(account(state, "crd_1").balances.get("GTQ")!.minor).toBe(0);
    const tx = creditTransactionsFor(state, "crd_1");
    expect(tx[1].type).toBe("adjusted");
    expect(tx[1].amount.minor).toBe(-5000);
    expect(tx[1].note).toBe("Corrección");
  });

  it("rechaza ajuste que deja el saldo en negativo", () => {
    const { state, rejected } = project([
      evt("credit.added", 5, { accountId: "crd_1", partnerId: "p_1", partnerName: "Cliente Uno", amount: g(1000) }),
      evt("credit.adjusted", 6, { accountId: "crd_1", amount: g(-2000), reason: "Corrección" }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].code).toBe("negative_balance");
    expect(account(state, "crd_1").balances.get("GTQ")!.minor).toBe(1000);
  });

  it("rechaza abono con importe no positivo", () => {
    const { state, rejected } = project([
      evt("credit.added", 5, { accountId: "crd_1", partnerId: "p_1", partnerName: "Cliente Uno", amount: g(0) }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].code).toBe("invalid_amount");
    expect(state.creditAccounts.size).toBe(0);
  });

  it("expone proyecciones de saldo y cuentas", () => {
    const { state } = project([
      evt("credit.added", 5, { accountId: "crd_1", partnerId: "p_1", partnerName: "Cliente Uno", amount: g(5000) }),
      evt("credit.added", 5, { accountId: "crd_1", partnerId: "p_1", partnerName: "Cliente Uno", amount: { minor: 100, currency: "USD" } }),
    ]);
    expect(allCreditAccounts(state).map((a) => a.id)).toEqual(["crd_1"]);
    expect(creditAccountByPartner(state, "p_1")!.id).toBe("crd_1");
    expect(creditBalanceFor(state, "p_1", "GTQ").minor).toBe(5000);
    expect(creditBalanceFor(state, "p_1", "USD").minor).toBe(100);
    expect(creditBalanceFor(state, "p_x", "GTQ").minor).toBe(0);
    expect(creditBalanceFor(state, "p_x", "GTQ").currency).toBe("GTQ");
  });
});