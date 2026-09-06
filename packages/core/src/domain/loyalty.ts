import { DomainError, fail } from "../errors.js";

// ── Niveles (tiers) ─────────────────────────────────────────────────

export const TIER_ORDER = ["bronce", "plata", "oro", "platino"] as const;
export type Tier = (typeof TIER_ORDER)[number];

export const TIER_LABEL: Record<Tier, string> = {
  bronce: "Bronce",
  plata: "Plata",
  oro: "Oro",
  platino: "Platino",
};

/** Umbral de puntos acumulados para alcanzar un tier. */
export interface TierThreshold {
  readonly tier: Tier;
  /** Puntos acumulados (lifetime) para alcanzar este nivel. */
  readonly minPoints: number;
}

/** Configuración de un tier con color para la UI. */
export const TIER_COLORS: Record<Tier, string> = {
  bronce: "#cd7f32",
  plata: "#c0c0c0",
  oro: "#ffd700",
  platino: "#b4a7d6",
};

// ── Programa de lealtad ─────────────────────────────────────────────

export interface LoyaltyProgram {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  /** Puntos que gana el cliente por cada unidad monetaria. Ej: 1 = 1 punto por Q1. */
  readonly pointsPerUnit: number;
  /** Umbral de inactividad (días) para expirar puntos. 0 = sin expiración. */
  readonly expiryDays: number;
  readonly tiers: readonly TierThreshold[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LoyaltyProgramDraft {
  readonly name: string;
  readonly pointsPerUnit?: number;
  readonly expiryDays?: number;
  readonly tiers?: readonly TierThreshold[];
}

export function validateLoyaltyProgramDraft(draft: Partial<LoyaltyProgramDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.name || draft.name.trim() === "") {
    errors.push(new DomainError("El nombre del programa es obligatorio", "loyalty.name_required"));
  }
  if (draft.pointsPerUnit !== undefined && draft.pointsPerUnit < 0) {
    errors.push(new DomainError("Los puntos por unidad no pueden ser negativos", "loyalty.points_negative"));
  }
  if (draft.expiryDays !== undefined && draft.expiryDays < 0) {
    errors.push(new DomainError("Los días de expiración no pueden ser negativos", "loyalty.expiry_negative"));
  }
  if (draft.tiers) {
    for (let i = 1; i < draft.tiers.length; i++) {
      if (draft.tiers[i]!.minPoints <= draft.tiers[i - 1]!.minPoints) {
        errors.push(new DomainError("Los tiers deben tener umbrales crecientes", "loyalty.tiers_not_sorted"));
        break;
      }
    }
  }
  return errors;
}

// ── Cuenta de cliente ───────────────────────────────────────────────

export interface LoyaltyAccount {
  readonly id: string;
  readonly partnerId: string;
  readonly partnerName: string;
  /** Puntos disponibles para canjear. */
  readonly points: number;
  /** Puntos acumulados en toda la vida (para calcular tier). */
  readonly lifetimePoints: number;
  readonly tier: Tier;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Transacciones ───────────────────────────────────────────────────

export const LOYALTY_TX_TYPES = ["earned", "redeemed", "adjusted"] as const;
export type LoyaltyTxType = (typeof LOYALTY_TX_TYPES)[number];

export const LOYALTY_TX_LABEL: Record<LoyaltyTxType, string> = {
  earned: "Ganado",
  redeemed: "Canjeado",
  adjusted: "Ajuste",
};

export interface LoyaltyTransaction {
  readonly id: string;
  readonly accountId: string;
  readonly type: LoyaltyTxType;
  /** Positivo = ganado/ajuste+, negativo = canjeadp/ajuste-. */
  readonly points: number;
  /** Referencia externa (invoiceId, rewardId, etc.). */
  readonly reference?: string;
  readonly note?: string;
  readonly createdAt: string;
}

// ── Recompensas ─────────────────────────────────────────────────────

export interface LoyaltyReward {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly pointsCost: number;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LoyaltyRewardDraft {
  readonly name: string;
  readonly description?: string;
  readonly pointsCost: number;
}

export function validateLoyaltyRewardDraft(draft: Partial<LoyaltyRewardDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.name || draft.name.trim() === "") {
    errors.push(new DomainError("El nombre de la recompensa es obligatorio", "loyalty.reward_name_required"));
  }
  if (draft.pointsCost === undefined || draft.pointsCost <= 0) {
    errors.push(new DomainError("El costo en puntos debe ser mayor a cero", "loyalty.reward_cost_invalid"));
  }
  return errors;
}

// ── Funciones de dominio ────────────────────────────────────────────

/** Calcula el tier de un cliente según sus puntos acumulados. */
export function tierForLifetimePoints(
  lifetimePoints: number,
  tiers: readonly TierThreshold[],
): Tier {
  let result: Tier = "bronce";
  for (const t of tiers) {
    if (lifetimePoints >= t.minPoints) result = t.tier;
  }
  return result;
}

/** Calcula los puntos a ganar por un monto en unidades menores (centavos). */
export function pointsForAmount(amountMinor: number, pointsPerUnit: number): number {
  // pointsPerUnit = puntos por unidad monetaria (Q1 = 100 centavos)
  // Ej: amountMinor=55000 (Q550.00), pointsPerUnit=1 → 550 puntos
  const units = amountMinor / 100;
  return Math.floor(units * pointsPerUnit);
}

/** Calcula el tier del cliente tras una transacción. */
export function computeNewTier(
  currentLifetimePoints: number,
  earnedPoints: number,
  tiers: readonly TierThreshold[],
): Tier {
  return tierForLifetimePoints(currentLifetimePoints + earnedPoints, tiers);
}

// ── Defaults ────────────────────────────────────────────────────────

export const DEFAULT_LOYALTY_TIERS: readonly TierThreshold[] = [
  { tier: "bronce", minPoints: 0 },
  { tier: "plata", minPoints: 500 },
  { tier: "oro", minPoints: 2000 },
  { tier: "platino", minPoints: 5000 },
];

export const DEFAULT_LOYALTY_PROGRAM: LoyaltyProgramDraft = {
  name: "Lealtad",
  pointsPerUnit: 1,
  expiryDays: 0,
  tiers: DEFAULT_LOYALTY_TIERS,
};
