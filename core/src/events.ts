import type { IsoDate, IsoInstant, MonthKey } from "./dates.js";
import type { AccountDraft, LedgerAccountType, JournalLine, JournalStatus } from "./domain/accounting.js";
import type { ExpenseDraft, ExpenseStatus } from "./domain/expense.js";
import type { InvoiceLine, TotalsSnapshot } from "./domain/invoice.js";
import type { LocationDraft, StockTransferLine } from "./domain/inventory.js";
import type { LeadDraft, Stage, Source, LeadActivity } from "./domain/lead.js";
import type { PartnerDraft } from "./domain/partner.js";
import type { EmployeeDraft, PayrollLine, PayrollTotals } from "./domain/payroll.js";
import type { ProductDraft } from "./domain/product.js";
import type { AdjustmentReason, ReceiptLine } from "./domain/stock.js";
import type { CompanyDraft } from "./domain/company.js";
import type { ExchangeRate } from "./domain/rate.js";
import type { CurrencyCode, Money } from "./money.js";

/** Version del formato de evento. Cualquier cambio incompatible la incrementa. */
export const EVENT_VERSION = 1 as const;

export interface Envelope<T extends string, P> {
  readonly id: string;
  /** Instante en que se registro el hecho. Ordena el journal. */
  readonly at: IsoInstant;
  readonly v: typeof EVENT_VERSION;
  readonly type: T;
  readonly payload: P;
}

export type ExpenseCreated = Envelope<"expense.created", { expenseId: string } & ExpenseDraft>;
export type ExpenseUpdated = Envelope<"expense.updated", { expenseId: string; changes: Partial<ExpenseDraft> }>;
export type ExpenseTransitioned = Envelope<"expense.transitioned", { expenseId: string; to: ExpenseStatus }>;
export type ExpenseArchived = Envelope<"expense.archived", { expenseId: string }>;

export type PartnerCreated = Envelope<"partner.created", { partnerId: string } & PartnerDraft>;
export type PartnerUpdated = Envelope<"partner.updated", { partnerId: string; changes: Partial<PartnerDraft> }>;
export type PartnerArchived = Envelope<"partner.archived", { partnerId: string }>;
/** Archivar debe ser reversible: sin esto un archivado por error es permanente. */
export type PartnerRestored = Envelope<"partner.restored", { partnerId: string }>;

export type ProductCreated = Envelope<"product.created", { productId: string } & ProductDraft>;
export type ProductUpdated = Envelope<"product.updated", { productId: string; changes: Partial<ProductDraft> }>;
export type ProductArchived = Envelope<"product.archived", { productId: string }>;
export type ProductRestored = Envelope<"product.restored", { productId: string }>;

export type StockReceived = Envelope<
  "stock.received",
  {
    receiptId: string;
    date: IsoDate;
    reference?: string;
    partnerId?: string;
    partnerName?: string;
    lines: readonly ReceiptLine[];
  }
>;
export type StockReceiptPaid = Envelope<
  "stock.receipt_paid",
  { receiptId: string; paidAt: IsoInstant; paymentMethod?: string }
>;
export type StockAdjusted = Envelope<
  "stock.adjusted",
  { adjustmentId: string; date: IsoDate; productId: string; quantity: number; reason: AdjustmentReason }
>;

export type RegisterOpened = Envelope<
  "register.opened",
  { shiftId: string; date: IsoDate; openingFloat: Money; notes?: string }
>;
export type RegisterClosed = Envelope<
  "register.closed",
  { shiftId: string; countedCash: Money; notes?: string }
>;
export type RegisterMoved = Envelope<
  "register.moved",
  { movementId: string; shiftId: string; kind: "in" | "out"; amount: Money; reason: string }
>;

export type CategoryCreated = Envelope<"category.created", { categoryId: string; name: string; code: string }>;
export type CategoryRenamed = Envelope<"category.renamed", { categoryId: string; name: string }>;
export type CategoryArchived = Envelope<"category.archived", { categoryId: string }>;

/** Hecho fiscal: la factura queda emitida con estos datos y no se edita. */
export type InvoiceIssued = Envelope<
  "invoice.issued",
  {
    invoiceId: string;
    series: string;
    number: number;
    date: IsoDate;
    currency: CurrencyCode;
    lines: readonly InvoiceLine[];
    totals: TotalsSnapshot;
    partnerId?: string;
    partnerName: string;
    partnerTaxId: string;
    notes?: string;
  }
>;
export type InvoicePaid = Envelope<
  "invoice.paid",
  { invoiceId: string; paidAt: IsoInstant; paymentMethod?: string; shiftId?: string }
>;
export type InvoiceCredited = Envelope<
  "invoice.credited",
  { creditNoteId: string; invoiceId: string; date: IsoDate; amount: Money; reason: string }
>;

// ── CRM ──────────────────────────────────────────────────────────────

export type LeadCreated = Envelope<"lead.created", { leadId: string } & LeadDraft>;
export type LeadUpdated = Envelope<"lead.updated", { leadId: string; changes: Partial<LeadDraft> }>;
export type LeadStageChanged = Envelope<"lead.stage_changed", { leadId: string; to: Stage }>;
export type LeadWon = Envelope<"lead.won", { leadId: string }>;
export type LeadLost = Envelope<"lead.lost", { leadId: string; reason?: string }>;
export type LeadArchived = Envelope<"lead.archived", { leadId: string }>;
export type LeadRestored = Envelope<"lead.restored", { leadId: string }>;
export type LeadActivityAdded = Envelope<
  "lead.activity_added",
  { leadId: string; activity: LeadActivity }
>;

// ── Lealtad ─────────────────────────────────────────────────────────

export type LoyaltyPointsEarned = Envelope<
  "loyalty.points_earned",
  {
    accountId: string;
    partnerId: string;
    partnerName: string;
    points: number;
    invoiceId: string;
  }
>;
export type LoyaltyPointsRedeemed = Envelope<
  "loyalty.points_redeemed",
  {
    accountId: string;
    points: number;
    rewardId: string;
    rewardName: string;
  }
>;
export type LoyaltyPointsAdjusted = Envelope<
  "loyalty.points_adjusted",
  {
    accountId: string;
    points: number;
    reason: string;
  }
>;
export type LoyaltyRewardCreated = Envelope<
  "loyalty.reward_created",
  {
    rewardId: string;
    name: string;
    description?: string;
    pointsCost: number;
  }
>;
export type LoyaltyRewardUpdated = Envelope<
  "loyalty.reward_updated",
  {
    rewardId: string;
    changes: { name?: string; description?: string; pointsCost?: number };
  }
>;

// ── Crédito de cliente ──────────────────────────────────────────────

export type CreditAdded = Envelope<
  "credit.added",
  {
    accountId: string;
    partnerId: string;
    partnerName: string;
    amount: Money;
    reference?: string;
    note?: string;
  }
>;
export type CreditUsed = Envelope<
  "credit.used",
  {
    accountId: string;
    amount: Money;
    reference?: string;
    note?: string;
  }
>;
export type CreditAdjusted = Envelope<
  "credit.adjusted",
  {
    accountId: string;
    amount: Money;
    reason?: string;
  }
>;

// ── Contabilidad ─────────────────────────────────────────────────────

export type AccountingAccountCreated = Envelope<
  "accounting.account_created",
  { accountId: string } & AccountDraft
>;
export type AccountingAccountUpdated = Envelope<
  "accounting.account_updated",
  { accountId: string; changes: Partial<AccountDraft> }
>;
export type AccountingAccountArchived = Envelope<"accounting.account_archived", { accountId: string }>;
export type AccountingAccountRestored = Envelope<"accounting.account_restored", { accountId: string }>;

export type AccountingEntryPosted = Envelope<
  "accounting.entry_posted",
  {
    entryId: string;
    date: IsoDate;
    description: string;
    reference?: string;
    lines: readonly JournalLine[];
  }
>;
export type AccountingEntryVoided = Envelope<
  "accounting.entry_voided",
  { entryId: string; reason: string }
>;

// ── Nómina ──────────────────────────────────────────────────────────

export type PayrollEmployeeCreated = Envelope<"payroll.employee_created", { employeeId: string } & EmployeeDraft>;
export type PayrollEmployeeUpdated = Envelope<
  "payroll.employee_updated",
  { employeeId: string; changes: Partial<EmployeeDraft> }
>;
export type PayrollEmployeeArchived = Envelope<"payroll.employee_archived", { employeeId: string }>;
export type PayrollRunProcessed = Envelope<
  "payroll.run_processed",
  { runId: string; month: MonthKey; lines: readonly PayrollLine[]; totals: PayrollTotals }
>;

// ── Inventario ──────────────────────────────────────────────────────

export type InventoryLocationCreated = Envelope<"inventory.location_created", { locationId: string } & LocationDraft>;
export type InventoryLocationUpdated = Envelope<
  "inventory.location_updated",
  { locationId: string; changes: Partial<LocationDraft> }
>;
export type InventoryLocationArchived = Envelope<"inventory.location_archived", { locationId: string }>;
export type InventoryTransferCreated = Envelope<
  "inventory.transfer_created",
  {
    transferId: string;
    date: IsoDate;
    fromLocationId: string;
    toLocationId: string;
    reference?: string;
    lines: readonly StockTransferLine[];
  }
>;

export type CompanyCreated = Envelope<"company.created", { companyId: string } & CompanyDraft>;
export type CompanyUpdated = Envelope<"company.updated", { companyId: string; changes: Partial<CompanyDraft> }>;
export type CompanyArchived = Envelope<"company.archived", { companyId: string }>;
export type CompanyRestored = Envelope<"company.restored", { companyId: string }>;

export type RateUpdated = Envelope<
  "rate.updated",
  { rateId: string } & Pick<ExchangeRate, "from" | "to" | "rate" | "date" | "source">
>;

export type AnyEvent =
  | AccountingAccountCreated
  | AccountingAccountUpdated
  | AccountingAccountArchived
  | AccountingAccountRestored
  | AccountingEntryPosted
  | AccountingEntryVoided
  | PayrollEmployeeCreated
  | PayrollEmployeeUpdated
  | PayrollEmployeeArchived
  | PayrollRunProcessed
  | InventoryLocationCreated
  | InventoryLocationUpdated
  | InventoryLocationArchived
  | InventoryTransferCreated
  | ExpenseCreated
  | ExpenseUpdated
  | ExpenseTransitioned
  | ExpenseArchived
  | PartnerCreated
  | PartnerUpdated
  | PartnerArchived
  | PartnerRestored
  | ProductCreated
  | ProductUpdated
  | ProductArchived
  | ProductRestored
  | StockReceived
  | StockAdjusted
  | StockReceiptPaid
  | RegisterOpened
  | RegisterClosed
  | RegisterMoved
  | CategoryCreated
  | CategoryRenamed
  | CategoryArchived
  | InvoiceIssued
  | InvoicePaid
  | InvoiceCredited
  | LeadCreated
  | LeadUpdated
  | LeadStageChanged
  | LeadWon
  | LeadLost
  | LeadArchived
  | LeadRestored
  | LeadActivityAdded
  | LoyaltyPointsEarned
  | LoyaltyPointsRedeemed
  | LoyaltyPointsAdjusted
  | LoyaltyRewardCreated
  | LoyaltyRewardUpdated
  | CreditAdded
  | CreditUsed
  | CreditAdjusted
  | CompanyCreated
  | CompanyUpdated
  | CompanyArchived
  | CompanyRestored
  | RateUpdated;

export type EventType = AnyEvent["type"];

const EVENT_TYPES: readonly string[] = [
  "accounting.account_created",
  "accounting.account_updated",
  "accounting.account_archived",
  "accounting.account_restored",
  "accounting.entry_posted",
  "accounting.entry_voided",
  "expense.created",
  "expense.updated",
  "expense.transitioned",
  "expense.archived",
  "partner.created",
  "partner.updated",
  "partner.archived",
  "partner.restored",
  "product.created",
  "product.updated",
  "product.archived",
  "product.restored",
  "stock.received",
  "stock.adjusted",
  "stock.receipt_paid",
  "register.opened",
  "register.closed",
  "register.moved",
  "category.created",
  "category.renamed",
  "category.archived",
  "invoice.issued",
  "invoice.paid",
  "invoice.credited",
  "lead.created",
  "lead.updated",
  "lead.stage_changed",
  "lead.won",
  "lead.lost",
  "lead.archived",
  "lead.restored",
  "lead.activity_added",
  "loyalty.points_earned",
  "loyalty.points_redeemed",
  "loyalty.points_adjusted",
  "loyalty.reward_created",
  "loyalty.reward_updated",
  "credit.added",
  "credit.used",
  "credit.adjusted",
  "payroll.employee_created",
  "payroll.employee_updated",
  "payroll.employee_archived",
  "payroll.run_processed",
  "inventory.location_created",
  "inventory.location_updated",
  "inventory.location_archived",
  "inventory.transfer_created",
  "company.created",
  "company.updated",
  "company.archived",
  "company.restored",
  "rate.updated",
];

/**
 * Valida la forma del sobre, no el contenido del payload. Se usa al leer el
 * journal: una linea que no pase esto se aparta como corrupta en vez de
 * envenenar la proyeccion.
 */
export function isEventEnvelope(value: unknown): value is AnyEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    typeof e.at === "string" &&
    e.v === EVENT_VERSION &&
    typeof e.type === "string" &&
    EVENT_TYPES.includes(e.type) &&
    typeof e.payload === "object" &&
    e.payload !== null
  );
}
