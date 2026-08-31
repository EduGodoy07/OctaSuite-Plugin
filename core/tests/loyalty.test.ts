import { describe, expect, it } from "vitest";
import {
  allLoyaltyAccounts,
  allLoyaltyRewards,
  loyaltyAccountById,
  loyaltyAccountByPartner,
  loyaltyPointsSummary,
  loyaltyTransactionsFor,
  project,
  type AnyEvent,
} from "../src/index.js";

let seq = 0;
const at = (day: number) => `2026-08-${day.toString().padStart(2, "0")}T12:00:00.000Z`;
const evt = <T extends AnyEvent["type"]>(type: T, day: number, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: at(day), v: 1, type, payload } as AnyEvent);

describe("Proyeccion de lealtad", () => {
  it("crea cuenta y registra puntos ganados", () => {
    const { state, rejected } = project([
      evt("loyalty.points_earned", 5, {
        accountId: "loy_1",
        partnerId: "p_1",
        partnerName: "Cliente Uno",
        points: 500,
        invoiceId: "inv_1",
      }),
    ]);
    expect(rejected).toEqual([]);
    const account = state.loyaltyAccounts.get("loy_1")!;
    expect(account.points).toBe(500);
    expect(account.lifetimePoints).toBe(500);
    expect(account.tier).toBe("plata"); // 500 >= 500
    expect(account.partnerName).toBe("Cliente Uno");
  });

  it("acumula puntos en cuenta existente", () => {
    const { state } = project([
      evt("loyalty.points_earned", 5, {
        accountId: "loy_1",
        partnerId: "p_1",
        partnerName: "Cliente Uno",
        points: 500,
        invoiceId: "inv_1",
      }),
      evt("loyalty.points_earned", 10, {
        accountId: "loy_1",
        partnerId: "p_1",
        partnerName: "Cliente Uno",
        points: 2000,
        invoiceId: "inv_2",
      }),
    ]);
    const account = state.loyaltyAccounts.get("loy_1")!;
    expect(account.points).toBe(2500);
    expect(account.lifetimePoints).toBe(2500);
    expect(account.tier).toBe("oro"); // 2500 >= 2000
  });

  it("canjea puntos correctamente", () => {
    const { state, rejected } = project([
      evt("loyalty.points_earned", 5, {
        accountId: "loy_1",
        partnerId: "p_1",
        partnerName: "Cliente Uno",
        points: 1000,
        invoiceId: "inv_1",
      }),
      evt("loyalty.reward_created", 6, {
        rewardId: "rw_1",
        name: "Descuento Q50",
        pointsCost: 500,
      }),
      evt("loyalty.points_redeemed", 7, {
        accountId: "loy_1",
        points: 500,
        rewardId: "rw_1",
        rewardName: "Descuento Q50",
      }),
    ]);
    expect(rejected).toEqual([]);
    const account = state.loyaltyAccounts.get("loy_1")!;
    expect(account.points).toBe(500); // 1000 - 500
    expect(account.lifetimePoints).toBe(1000); // no cambia
  });

  it("rechaza canje por puntos insuficientes", () => {
    const { rejected } = project([
      evt("loyalty.points_earned", 5, {
        accountId: "loy_1",
        partnerId: "p_1",
        partnerName: "Cliente Uno",
        points: 100,
        invoiceId: "inv_1",
      }),
      evt("loyalty.points_redeemed", 7, {
        accountId: "loy_1",
        points: 500,
        rewardId: "rw_1",
        rewardName: "Descuento",
      }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain("insuficientes");
  });

  it("ajuste manual de puntos (+/-)", () => {
    const { state, rejected } = project([
      evt("loyalty.points_earned", 5, {
        accountId: "loy_1",
        partnerId: "p_1",
        partnerName: "Cliente Uno",
        points: 100,
        invoiceId: "inv_1",
      }),
      evt("loyalty.points_adjusted", 6, {
        accountId: "loy_1",
        points: 50,
        reason: "Bono especial",
      }),
      evt("loyalty.points_adjusted", 7, {
        accountId: "loy_1",
        points: -30,
        reason: "Corrección",
      }),
    ]);
    expect(rejected).toEqual([]);
    const account = state.loyaltyAccounts.get("loy_1")!;
    expect(account.points).toBe(120); // 100 + 50 - 30
  });

  it("rechaza ajuste que deja saldo negativo", () => {
    const { rejected } = project([
      evt("loyalty.points_earned", 5, {
        accountId: "loy_1",
        partnerId: "p_1",
        partnerName: "Cliente Uno",
        points: 100,
        invoiceId: "inv_1",
      }),
      evt("loyalty.points_adjusted", 6, {
        accountId: "loy_1",
        points: -200,
        reason: "Error",
      }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain("negativo");
  });

  it("crea y actualiza recompensas", () => {
    const { state, rejected } = project([
      evt("loyalty.reward_created", 5, {
        rewardId: "rw_1",
        name: "Descuento Q50",
        pointsCost: 500,
      }),
      evt("loyalty.reward_updated", 6, {
        rewardId: "rw_1",
        changes: { pointsCost: 600, description: "Aplica en cualquier compra" },
      }),
    ]);
    expect(rejected).toEqual([]);
    const reward = state.loyaltyRewards.get("rw_1")!;
    expect(reward.pointsCost).toBe(600);
    expect(reward.description).toBe("Aplica en cualquier compra");
  });

  it("registra transacciones con tipo correcto", () => {
    const { state } = project([
      evt("loyalty.points_earned", 5, {
        accountId: "loy_1",
        partnerId: "p_1",
        partnerName: "Cliente Uno",
        points: 100,
        invoiceId: "inv_1",
      }),
      evt("loyalty.points_adjusted", 6, {
        accountId: "loy_1",
        points: 50,
        reason: "Bono",
      }),
    ]);
    const txs = [...state.loyaltyTransactions.values()].sort((a, b) =>
      a.createdAt > b.createdAt ? 1 : -1,
    );
    expect(txs).toHaveLength(2);
    expect(txs[0].type).toBe("earned");
    expect(txs[0].points).toBe(100);
    expect(txs[1].type).toBe("adjusted");
    expect(txs[1].points).toBe(50);
  });
});

describe("Consultas de lealtad", () => {
  const { state } = project([
    evt("loyalty.points_earned", 5, {
      accountId: "loy_1",
      partnerId: "p_1",
      partnerName: "Cliente Uno",
      points: 3000,
      invoiceId: "inv_1",
    }),
    evt("loyalty.points_earned", 6, {
      accountId: "loy_2",
      partnerId: "p_2",
      partnerName: "Cliente Dos",
      points: 500,
      invoiceId: "inv_2",
    }),
    evt("loyalty.points_earned", 7, {
      accountId: "loy_3",
      partnerId: "p_3",
      partnerName: "Cliente Tres",
      points: 100,
      invoiceId: "inv_3",
    }),
    evt("loyalty.reward_created", 8, {
      rewardId: "rw_1",
      name: "Descuento",
      pointsCost: 200,
    }),
  ]);

  it("allLoyaltyAccounts ordena por lifetimePoints descendente", () => {
    const accounts = allLoyaltyAccounts(state);
    expect(accounts).toHaveLength(3);
    expect(accounts[0].partnerName).toBe("Cliente Uno");
    expect(accounts[1].partnerName).toBe("Cliente Dos");
    expect(accounts[2].partnerName).toBe("Cliente Tres");
  });

  it("loyaltyAccountById", () => {
    const account = loyaltyAccountById(state, "loy_1");
    expect(account?.partnerName).toBe("Cliente Uno");
    expect(loyaltyAccountById(state, "nonexistent")).toBeUndefined();
  });

  it("loyaltyAccountByPartner", () => {
    const account = loyaltyAccountByPartner(state, "p_2");
    expect(account?.partnerName).toBe("Cliente Dos");
  });

  it("loyaltyTransactionsFor", () => {
    const txs = loyaltyTransactionsFor(state, "loy_1");
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe("earned");
  });

  it("allLoyaltyRewards", () => {
    const rewards = allLoyaltyRewards(state);
    expect(rewards).toHaveLength(1);
    expect(rewards[0].name).toBe("Descuento");
  });

  it("loyaltyPointsSummary", () => {
    const summary = loyaltyPointsSummary(state);
    expect(summary.totalCustomers).toBe(3);
    expect(summary.totalPoints).toBe(3600);
    expect(summary.byTier).toEqual(
      expect.arrayContaining([
        { tier: "oro", count: 1 },
        { tier: "plata", count: 1 },
        { tier: "bronce", count: 1 },
      ]),
    );
  });
});
