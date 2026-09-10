import { type IsoDate, monthKeyOf, type MonthKey } from "./dates.js";
import {
  validateAccountDraft,
  validateJournalDraft,
  isBalanced,
  type Account,
  type AccountDraft,
  type JournalEntry,
  type JournalStatus,
  type LedgerAccountType,
} from "./domain/accounting.js";
import { canTransition, type Expense, type ExpenseStatus } from "./domain/expense.js";
import {
  assertCreditable,
  assertRefundable,
  computeInvoiceTotals,
  type CreditNoteType,
  type ExchangeLine,
  formatInvoiceNumber,
  lineDiscountAmount,
  type TenderRefund,
  type CreditNote,
  type CreditNoteDraft,
  type Invoice,
  validateCreditNoteDraft,
} from "./domain/invoice.js";
import {
  PRIMARY_LOCATION_ID,
  validateLocationDraft,
  validateTransferDraft,
  type InventoryLocation,
  type StockTransfer,
} from "./domain/inventory.js";
import type { Lead, Stage } from "./domain/lead.js";
import {
  computeNewTier,
  DEFAULT_LOYALTY_TIERS,
  type LoyaltyAccount,
  type LoyaltyReward,
  type LoyaltyTransaction,
} from "./domain/loyalty.js";
import type { CreditAccount, CreditTransaction } from "./domain/credit.js";
import type { Partner } from "./domain/partner.js";
import { validateCompanyChanges, validateCompanyDraft, type Company } from "./domain/company.js";
import { validateExchangeRateDraft, type ExchangeRate } from "./domain/rate.js";
import {
  validateEmployeeDraft,
  verifyPayrollTotals,
  type Employee,
  type PayrollRun,
} from "./domain/payroll.js";
import type { Product } from "./domain/product.js";
import { isCashMethod, type CashMovement, type Shift, type ShiftSummary } from "./domain/register.js";
import { explodeLine, isKit, type Receipt, type StockAdjustment } from "./domain/stock.js";
import { DomainError } from "./errors.js";
import type { AnyEvent } from "./events.js";
import { generateId } from "./ids.js";
import { add, format, subtract, sum, zero, type CurrencyCode, type Money } from "./money.js";

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly archived: boolean;
}

export interface State {
  readonly expenses: Map<string, Expense>;
  readonly partners: Map<string, Partner>;
  readonly products: Map<string, Product>;
  readonly categories: Map<string, Category>;
  readonly invoices: Map<string, Invoice>;
  readonly creditNotes: Map<string, CreditNote>;
  readonly shifts: Map<string, Shift>;
  readonly movements: Map<string, CashMovement>;
  readonly receipts: Map<string, Receipt>;
  readonly adjustments: Map<string, StockAdjustment>;
  readonly leads: Map<string, Lead>;
  readonly loyaltyAccounts: Map<string, LoyaltyAccount>;
  readonly loyaltyTransactions: Map<string, LoyaltyTransaction>;
  readonly loyaltyRewards: Map<string, LoyaltyReward>;
  /** Cuentas de crédito de cliente. */
  readonly creditAccounts: Map<string, CreditAccount>;
  /** Transacciones de crédito de cliente. */
  readonly creditTransactions: Map<string, CreditTransaction>;
  /** Plan de cuentas. */
  readonly accounts: Map<string, Account>;
  /** Asientos contables. */
  readonly journalEntries: Map<string, JournalEntry>;
  /** Ultimo correlativo visto por serie. */
  readonly lastNumberBySeries: Map<string, number>;
  /** Empleados de nómina. */
  readonly employees: Map<string, Employee>;
  /** Períodos de nómina procesados. */
  readonly payrollRuns: Map<string, PayrollRun>;
  /** Ubicaciones de inventario. */
  readonly locations: Map<string, InventoryLocation>;
  /** Traslados entre ubicaciones. */
  readonly transfers: Map<string, StockTransfer>;
  /** Empresas (multi-empresa). */
  readonly companies: Map<string, Company>;
  /** Tasas de cambio vigentes por par+moneda. */
  readonly rates: Map<string, ExchangeRate>;
}

export function emptyState(): State {
  return {
    expenses: new Map(),
    partners: new Map(),
    products: new Map(),
    categories: new Map(),
    invoices: new Map(),
    creditNotes: new Map(),
    shifts: new Map(),
    movements: new Map(),
    receipts: new Map(),
    adjustments: new Map(),
    leads: new Map(),
    loyaltyAccounts: new Map(),
    loyaltyTransactions: new Map(),
    loyaltyRewards: new Map(),
    creditAccounts: new Map(),
    creditTransactions: new Map(),
    accounts: new Map(),
    journalEntries: new Map(),
    lastNumberBySeries: new Map(),
    employees: new Map(),
    payrollRuns: new Map(),
    locations: new Map(),
    transfers: new Map(),
    companies: new Map(),
    rates: new Map(),
  };
}

export interface RejectedEvent {
  readonly event: AnyEvent;
  readonly reason: string;
  readonly code: string;
}

/**
 * Valida que `managerId` sea un jefe valido para `employeeId`: existe, no esta
 * archivado, no es el propio empleado, y la cadena de mando no forma un ciclo.
 * La jerarquia admite N niveles; la raiz no tiene managerId (undefined = null).
 */
function managerProblem(state: State, employeeId: string, managerId: string | undefined): DomainError | null {
  if (!managerId) return null;
  if (managerId === employeeId) {
    return new DomainError("Un empleado no puede ser su propio jefe", "payroll.manager_cycle");
  }
  const manager = state.employees.get(managerId);
  if (!manager) return new DomainError(`Jefe directo inexistente: ${managerId}`, "payroll.manager_not_found");
  if (manager.archived) return new DomainError("El jefe directo esta archivado", "payroll.manager_archived");
  const seen = new Set<string>([employeeId]);
  let cursor: string | undefined = managerId;
  while (cursor) {
    if (seen.has(cursor)) return new DomainError("La cadena de mando no puede formar un ciclo", "payroll.manager_cycle");
    seen.add(cursor);
    cursor = state.employees.get(cursor)?.managerId;
  }
  return null;
}

/**
 * Aplica un hecho al estado. Devuelve `null` si se aplico, o el rechazo si el
 * hecho viola una invariante.
 *
 * No lanza: un journal reconciliado desde dos dispositivos puede contener
 * secuencias imposibles (dos facturas con el mismo correlativo, una transicion
 * que ya no aplica). Rechazar y reportar es correcto; abortar la carga del vault
 * no lo es.
 */
export function apply(state: State, event: AnyEvent): RejectedEvent | null {
  const reject = (code: string, reason: string): RejectedEvent => ({ event, reason, code });

  switch (event.type) {
    case "expense.created": {
      const { expenseId, ...draft } = event.payload;
      if (state.expenses.has(expenseId)) return reject("duplicate", `El gasto ${expenseId} ya existe`);
      state.expenses.set(expenseId, {
        id: expenseId,
        ...draft,
        status: "draft",
        archived: false,
        createdAt: event.at,
        updatedAt: event.at,
      });
      return null;
    }
    case "expense.updated": {
      const current = state.expenses.get(event.payload.expenseId);
      if (!current) return reject("not_found", `Gasto inexistente: ${event.payload.expenseId}`);
      if (current.archived) return reject("archived", "El gasto esta archivado");
      if (current.status !== "draft") {
        return reject("not_editable", `Un gasto en ${current.status} no se edita`);
      }
      state.expenses.set(current.id, { ...current, ...event.payload.changes, updatedAt: event.at });
      return null;
    }
    case "expense.transitioned": {
      const current = state.expenses.get(event.payload.expenseId);
      if (!current) return reject("not_found", `Gasto inexistente: ${event.payload.expenseId}`);
      if (current.archived) return reject("archived", "El gasto esta archivado");
      const to: ExpenseStatus = event.payload.to;
      if (!canTransition(current.status, to)) {
        return reject("illegal_transition", `Transicion no permitida: ${current.status} -> ${to}`);
      }
      state.expenses.set(current.id, {
        ...current,
        status: to,
        updatedAt: event.at,
        ...(to === "approved" ? { approvedAt: event.at } : {}),
        ...(to === "paid" ? { paidAt: event.at } : {}),
        ...(to === "draft" ? { approvedAt: undefined, paidAt: undefined } : {}),
      });
      return null;
    }
    case "expense.archived": {
      const current = state.expenses.get(event.payload.expenseId);
      if (!current) return reject("not_found", `Gasto inexistente: ${event.payload.expenseId}`);
      state.expenses.set(current.id, { ...current, archived: true, updatedAt: event.at });
      return null;
    }

    case "partner.created": {
      const { partnerId, ...draft } = event.payload;
      if (state.partners.has(partnerId)) return reject("duplicate", `El contacto ${partnerId} ya existe`);
      state.partners.set(partnerId, { id: partnerId, ...draft, archived: false, createdAt: event.at, updatedAt: event.at });
      return null;
    }
    case "partner.updated": {
      const current = state.partners.get(event.payload.partnerId);
      if (!current) return reject("not_found", `Contacto inexistente: ${event.payload.partnerId}`);
      state.partners.set(current.id, { ...current, ...event.payload.changes, updatedAt: event.at });
      return null;
    }
    case "partner.archived": {
      const current = state.partners.get(event.payload.partnerId);
      if (!current) return reject("not_found", `Contacto inexistente: ${event.payload.partnerId}`);
      state.partners.set(current.id, { ...current, archived: true, updatedAt: event.at });
      return null;
    }
    case "partner.restored": {
      const current = state.partners.get(event.payload.partnerId);
      if (!current) return reject("not_found", `Contacto inexistente: ${event.payload.partnerId}`);
      state.partners.set(current.id, { ...current, archived: false, updatedAt: event.at });
      return null;
    }

    case "product.created": {
      const { productId, ...draft } = event.payload;
      if (state.products.has(productId)) return reject("duplicate", `El producto ${productId} ya existe`);
      state.products.set(productId, { id: productId, ...draft, archived: false, createdAt: event.at, updatedAt: event.at });
      return null;
    }
    case "product.updated": {
      const current = state.products.get(event.payload.productId);
      if (!current) return reject("not_found", `Producto inexistente: ${event.payload.productId}`);
      state.products.set(current.id, { ...current, ...event.payload.changes, updatedAt: event.at });
      return null;
    }
    case "product.archived": {
      const current = state.products.get(event.payload.productId);
      if (!current) return reject("not_found", `Producto inexistente: ${event.payload.productId}`);
      state.products.set(current.id, { ...current, archived: true, updatedAt: event.at });
      return null;
    }
    case "product.restored": {
      const current = state.products.get(event.payload.productId);
      if (!current) return reject("not_found", `Producto inexistente: ${event.payload.productId}`);
      state.products.set(current.id, { ...current, archived: false, updatedAt: event.at });
      return null;
    }

    case "register.opened": {
      const p = event.payload;
      if (state.shifts.has(p.shiftId)) return reject("duplicate", `El turno ${p.shiftId} ya existe`);
      const open = [...state.shifts.values()].find((s) => !s.closedAt);
      // Un solo cajero: dos turnos abiertos a la vez harían imposible saber a
      // cual pertenece un cobro.
      if (open) return reject("shift_already_open", `Ya hay un turno abierto desde ${open.openedAt}`);
      if (p.openingFloat.minor < 0) return reject("bad_amount", "El fondo de caja no puede ser negativo");
      state.shifts.set(p.shiftId, {
        id: p.shiftId,
        openedAt: event.at,
        date: p.date,
        openingFloat: p.openingFloat,
        openingNotes: p.notes,
      });
      return null;
    }
    case "register.closed": {
      const p = event.payload;
      const shift = state.shifts.get(p.shiftId);
      if (!shift) return reject("not_found", `Turno inexistente: ${p.shiftId}`);
      if (shift.closedAt) return reject("already_closed", "El turno ya estaba cerrado");
      if (p.countedCash.minor < 0) return reject("bad_amount", "El conteo no puede ser negativo");
      state.shifts.set(shift.id, {
        ...shift,
        closedAt: event.at,
        countedCash: p.countedCash,
        closingNotes: p.notes,
      });
      return null;
    }
    case "register.moved": {
      const p = event.payload;
      if (state.movements.has(p.movementId)) return reject("duplicate", `El movimiento ${p.movementId} ya existe`);
      const shift = state.shifts.get(p.shiftId);
      if (!shift) return reject("not_found", `Turno inexistente: ${p.shiftId}`);
      if (shift.closedAt) return reject("shift_closed", "No se puede mover efectivo en un turno cerrado");
      if (p.amount.minor <= 0) return reject("bad_amount", "El movimiento debe ser mayor que cero");
      if (!p.reason || p.reason.trim() === "") return reject("no_reason", "El movimiento requiere motivo");
      state.movements.set(p.movementId, {
        id: p.movementId,
        shiftId: p.shiftId,
        kind: p.kind,
        amount: p.amount,
        reason: p.reason,
        at: event.at,
      });
      return null;
    }

    case "stock.received": {
      const p = event.payload;
      if (state.receipts.has(p.receiptId)) return reject("duplicate", `La entrada ${p.receiptId} ya existe`);
      if (p.lines.length === 0) return reject("no_lines", "Una entrada requiere al menos una linea");
      for (const line of p.lines) {
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
          return reject("bad_quantity", `Cantidad invalida en la entrada: ${line.quantity}`);
        }
        if (!state.products.has(line.productId)) {
          return reject("not_found", `Producto inexistente en la entrada: ${line.productId}`);
        }
      }
      state.receipts.set(p.receiptId, {
        id: p.receiptId,
        date: p.date,
        reference: p.reference,
        partnerId: p.partnerId,
        partnerName: p.partnerName,
        lines: p.lines,
        status: "unpaid",
        createdAt: event.at,
      });
      return null;
    }
    case "stock.receipt_paid": {
      const p = event.payload;
      const receipt = state.receipts.get(p.receiptId);
      if (!receipt) return reject("not_found", `Entrada inexistente: ${p.receiptId}`);
      if (receipt.status === "paid") return reject("already_paid", "La entrada ya estaba pagada");
      state.receipts.set(receipt.id, {
        ...receipt,
        status: "paid",
        paidAt: p.paidAt,
        paymentMethod: p.paymentMethod,
      });
      return null;
    }
    case "stock.adjusted": {
      const p = event.payload;
      if (state.adjustments.has(p.adjustmentId)) return reject("duplicate", `El ajuste ${p.adjustmentId} ya existe`);
      if (!Number.isFinite(p.quantity) || p.quantity === 0) {
        return reject("bad_quantity", "Un ajuste de cero no registra nada");
      }
      if (!state.products.has(p.productId)) return reject("not_found", `Producto inexistente: ${p.productId}`);
      if (!p.reason || p.reason.trim() === "") return reject("no_reason", "El ajuste requiere motivo");
      state.adjustments.set(p.adjustmentId, {
        id: p.adjustmentId,
        date: p.date,
        productId: p.productId,
        quantity: p.quantity,
        reason: p.reason,
        createdAt: event.at,
      });
      return null;
    }

    case "category.created": {
      const { categoryId, name, code } = event.payload;
      if (state.categories.has(categoryId)) return reject("duplicate", `La categoria ${categoryId} ya existe`);
      state.categories.set(categoryId, { id: categoryId, name, code, archived: false });
      return null;
    }
    case "category.renamed": {
      const current = state.categories.get(event.payload.categoryId);
      if (!current) return reject("not_found", `Categoria inexistente: ${event.payload.categoryId}`);
      state.categories.set(current.id, { ...current, name: event.payload.name });
      return null;
    }
    case "category.archived": {
      const current = state.categories.get(event.payload.categoryId);
      if (!current) return reject("not_found", `Categoria inexistente: ${event.payload.categoryId}`);
      state.categories.set(current.id, { ...current, archived: true });
      return null;
    }

    case "invoice.issued": {
      const p = event.payload;
      if (state.invoices.has(p.invoiceId)) return reject("duplicate", `La factura ${p.invoiceId} ya existe`);
      const clash = [...state.invoices.values()].find((i) => i.series === p.series && i.number === p.number);
      if (clash) {
        return reject(
          "number_taken",
          `El correlativo ${formatInvoiceNumber(p.series, p.number)} ya lo usa ${clash.id}; hay que renumerar`,
        );
      }
      const derived = computeInvoiceTotals(p.lines, p.currency);
      state.invoices.set(p.invoiceId, {
        id: p.invoiceId,
        series: p.series,
        number: p.number,
        displayNumber: formatInvoiceNumber(p.series, p.number),
        date: p.date,
        currency: p.currency,
        lines: p.lines,
        // Snapshot emitido como fuente de verdad; solo el desglose por tasa se deriva.
        totals: { ...p.totals, taxByRate: derived.taxByRate },
        status: "issued",
        partnerId: p.partnerId,
        partnerName: p.partnerName,
        partnerTaxId: p.partnerTaxId,
        notes: p.notes,
        creditedTotal: zero(p.currency),
        creditNoteIds: [],
      });
      const last = state.lastNumberBySeries.get(p.series);
      if (last === undefined || p.number > last) state.lastNumberBySeries.set(p.series, p.number);
      return null;
    }
    case "invoice.paid": {
      const current = state.invoices.get(event.payload.invoiceId);
      if (!current) return reject("not_found", `Factura inexistente: ${event.payload.invoiceId}`);
      if (current.status === "paid") return reject("already_paid", `${current.displayNumber} ya esta pagada`);
      state.invoices.set(current.id, {
        ...current,
        status: "paid",
        paidAt: event.payload.paidAt,
        paymentMethod: event.payload.paymentMethod,
        shiftId: event.payload.shiftId,
      });
      return null;
    }
    case "invoice.credited": {
      const p = event.payload;
      const current = state.invoices.get(p.invoiceId);
      if (!current) return reject("not_found", `Factura inexistente: ${p.invoiceId}`);
      if (state.creditNotes.has(p.creditNoteId)) return reject("duplicate", `La nota ${p.creditNoteId} ya existe`);
      try {
        assertCreditable(current, p.amount);
      } catch (e) {
        if (e instanceof DomainError) return reject(e.code, e.message);
        throw e;
      }
      state.creditNotes.set(p.creditNoteId, {
        id: p.creditNoteId,
        invoiceId: p.invoiceId,
        date: p.date,
        amount: p.amount,
        reason: p.reason,
        createdAt: event.at,
      });
      state.invoices.set(current.id, {
        ...current,
        creditedTotal: add(current.creditedTotal, p.amount),
        creditNoteIds: [...current.creditNoteIds, p.creditNoteId],
      });
      return null;
    }
    case "invoice.refunded": {
      const p = event.payload;
      const current = state.invoices.get(p.invoiceId);
      if (!current) return reject("not_found", `Factura inexistente: ${p.invoiceId}`);
      if (state.creditNotes.has(p.creditNoteId)) return reject("duplicate", `La nota ${p.creditNoteId} ya existe`);

      // Validar draft extendido
      const draft: CreditNoteDraft = {
        type: p.type,
        amount: p.amount,
        reason: p.reason,
        lines: p.lines,
        tenderRefund: p.tenderRefund,
        stockReturnLocationId: p.stockReturnLocationId,
        exchangeLines: p.exchangeLines,
      };
      const problems = validateCreditNoteDraft(draft);
      if (problems.length > 0) {
        return reject(problems[0]!.code, problems[0]!.message);
      }

      try {
        assertRefundable(current, p.amount);
      } catch (e) {
        if (e instanceof DomainError) return reject(e.code, e.message);
        throw e;
      }

      // Guardar credit note extendida (campos nuevos en objeto plano)
      const creditNote: CreditNote & {
        type?: CreditNoteType;
        lines?: typeof p.lines;
        tenderRefund?: TenderRefund;
        stockReturnLocationId?: string;
        exchangeLines?: typeof p.exchangeLines;
      } = {
        id: p.creditNoteId,
        invoiceId: p.invoiceId,
        date: p.date,
        amount: p.amount,
        reason: p.reason,
        createdAt: event.at,
        type: p.type,
        lines: p.lines,
        tenderRefund: p.tenderRefund,
        stockReturnLocationId: p.stockReturnLocationId,
        exchangeLines: p.exchangeLines,
      };
      state.creditNotes.set(p.creditNoteId, creditNote);
      state.invoices.set(current.id, {
        ...current,
        creditedTotal: add(current.creditedTotal, p.amount),
        creditNoteIds: [...current.creditNoteIds, p.creditNoteId],
      });

// 1) Stock return: si hay líneas devueltas, crear ajuste/traslado a ubicación
      if (p.lines && p.lines.length > 0) {
        const locationId = p.stockReturnLocationId ?? PRIMARY_LOCATION_ID;
        for (const line of p.lines) {
          state.adjustments.set(generateId("adj"), {
            id: generateId("adj"),
            date: p.date,
            productId: line.productId,
            quantity: line.quantity,
            reason: "Devolución de cliente",
            createdAt: event.at,
          });
        }
      }

      // 2) Tender refund: asiento contable doble partida (Caja/Banco -> Clientes)
      if (p.tenderRefund) {
        const tenderAccount = findTenderAccount(state, p.tenderRefund.method);
        const arAccount = findARAccount(state);
        if (tenderAccount && arAccount) {
          const entry: JournalEntry = {
            id: generateId("je"),
            date: p.date,
            description: `Reembolso ${p.tenderRefund.method} por nota ${p.creditNoteId}`,
            reference: p.creditNoteId,
            lines: [
              { accountId: tenderAccount.id, debit: p.tenderRefund.amount, credit: zero(p.tenderRefund.amount.currency), description: `Salida ${p.tenderRefund.method}` },
              { accountId: arAccount.id, debit: zero(p.tenderRefund.amount.currency), credit: p.tenderRefund.amount, description: `Reducción clientes por devolución` },
            ],
            status: "posted",
            postedAt: event.at,
            createdAt: event.at,
          };
          if (!isBalanced(entry, p.tenderRefund.amount.currency)) {
            return reject("unbalanced_entry", "El asiento de reembolso no cuadra");
          }
          state.journalEntries.set(entry.id, entry);
        }
      }

      // 3) Store credit: abono a cuenta de crédito del cliente
      if (p.type === "store_credit" || !p.type) {
        const creditAccount = creditAccountByPartner(state, current.partnerId ?? "");
        const accountId = creditAccount?.id ?? generateId("cra");
        state.creditAccounts.set(accountId, {
          ...creditAccount,
          id: accountId,
          partnerId: current.partnerId ?? "",
          partnerName: current.partnerName,
          balances: new Map(creditAccount?.balances ?? []).set(
            p.amount.currency,
            add(creditAccount?.balances.get(p.amount.currency) ?? zero(p.amount.currency), p.amount),
          ),
          createdAt: creditAccount?.createdAt ?? event.at,
          updatedAt: event.at,
        });
        state.creditTransactions.set(generateId("crt"), {
          id: generateId("crt"),
          accountId,
          type: "added",
          amount: p.amount,
          reference: p.creditNoteId,
          note: p.reason,
          createdAt: event.at,
        });
      }

      // 4) Exchange: líneas de cambio (productos nuevos) - crear factura vinculada o nota
      if (p.exchangeLines && p.exchangeLines.length > 0) {
        // Por ahora: registrar como líneas de exchange en la nota; no genera factura automática
        // (requeriría flujo de emisión nuevo; se deja como dato para UI)
      }

      return null;
    }

    case "lead.created": {
      const { leadId, ...draft } = event.payload;
      if (state.leads.has(leadId)) return reject("duplicate", `El lead ${leadId} ya existe`);
      state.leads.set(leadId, {
        id: leadId,
        name: draft.name,
        contactName: draft.contactName ?? "",
        email: draft.email ?? "",
        phone: draft.phone ?? "",
        company: draft.company ?? "",
        stage: draft.stage ?? "nuevo",
        source: draft.source ?? "otro",
        estimatedValue: draft.estimatedValue ?? 0,
        owner: draft.owner ?? "",
        notes: draft.notes ?? "",
        status: "active",
        activities: [],
        archived: false,
        createdAt: event.at,
        updatedAt: event.at,
      });
      return null;
    }
    case "lead.updated": {
      const current = state.leads.get(event.payload.leadId);
      if (!current) return reject("not_found", `Lead inexistente: ${event.payload.leadId}`);
      if (current.archived) return reject("archived", "El lead está archivado");
      state.leads.set(current.id, { ...current, ...event.payload.changes, updatedAt: event.at });
      return null;
    }
    case "lead.stage_changed": {
      const current = state.leads.get(event.payload.leadId);
      if (!current) return reject("not_found", `Lead inexistente: ${event.payload.leadId}`);
      if (current.archived) return reject("archived", "El lead está archivado");
      state.leads.set(current.id, { ...current, stage: event.payload.to, updatedAt: event.at });
      return null;
    }
    case "lead.won": {
      const current = state.leads.get(event.payload.leadId);
      if (!current) return reject("not_found", `Lead inexistente: ${event.payload.leadId}`);
      state.leads.set(current.id, { ...current, status: "won", stage: "ganado", updatedAt: event.at });
      return null;
    }
    case "lead.lost": {
      const current = state.leads.get(event.payload.leadId);
      if (!current) return reject("not_found", `Lead inexistente: ${event.payload.leadId}`);
      state.leads.set(current.id, { ...current, status: "lost", stage: "perdido", updatedAt: event.at });
      return null;
    }
    case "lead.archived": {
      const current = state.leads.get(event.payload.leadId);
      if (!current) return reject("not_found", `Lead inexistente: ${event.payload.leadId}`);
      state.leads.set(current.id, { ...current, archived: true, updatedAt: event.at });
      return null;
    }
    case "lead.restored": {
      const current = state.leads.get(event.payload.leadId);
      if (!current) return reject("not_found", `Lead inexistente: ${event.payload.leadId}`);
      state.leads.set(current.id, { ...current, archived: false, updatedAt: event.at });
      return null;
    }
    case "lead.activity_added": {
      const current = state.leads.get(event.payload.leadId);
      if (!current) return reject("not_found", `Lead inexistente: ${event.payload.leadId}`);
      state.leads.set(current.id, {
        ...current,
        activities: [...current.activities, event.payload.activity],
        updatedAt: event.at,
      });
      return null;
    }

    // ── Lealtad ───────────────────────────────────────────────────────
    case "loyalty.points_earned": {
      const p = event.payload;
      let account = state.loyaltyAccounts.get(p.accountId);
      if (account) {
        const newLifetime = account.lifetimePoints + p.points;
        const newTier = computeNewTier(account.lifetimePoints, p.points, DEFAULT_LOYALTY_TIERS);
        account = { ...account, points: account.points + p.points, lifetimePoints: newLifetime, tier: newTier, updatedAt: event.at };
      } else {
        account = {
          id: p.accountId,
          partnerId: p.partnerId,
          partnerName: p.partnerName,
          points: p.points,
          lifetimePoints: p.points,
          tier: computeNewTier(0, p.points, DEFAULT_LOYALTY_TIERS),
          createdAt: event.at,
          updatedAt: event.at,
        };
      }
      state.loyaltyAccounts.set(p.accountId, account);
      state.loyaltyTransactions.set(event.id, {
        id: event.id,
        accountId: p.accountId,
        type: "earned",
        points: p.points,
        reference: p.invoiceId,
        createdAt: event.at,
      });
      return null;
    }
    case "loyalty.points_redeemed": {
      const p = event.payload;
      const account = state.loyaltyAccounts.get(p.accountId);
      if (!account) return reject("not_found", `Cuenta de lealtad inexistente: ${p.accountId}`);
      if (account.points < p.points) {
        return reject("insufficient_points", `Puntos insuficientes: disponibles ${account.points}, necesarios ${p.points}`);
      }
      state.loyaltyAccounts.set(p.accountId, {
        ...account,
        points: account.points - p.points,
        updatedAt: event.at,
      });
      state.loyaltyTransactions.set(event.id, {
        id: event.id,
        accountId: p.accountId,
        type: "redeemed",
        points: -p.points,
        reference: p.rewardId,
        note: p.rewardName,
        createdAt: event.at,
      });
      return null;
    }
    case "loyalty.points_adjusted": {
      const p = event.payload;
      const account = state.loyaltyAccounts.get(p.accountId);
      if (!account) return reject("not_found", `Cuenta de lealtad inexistente: ${p.accountId}`);
      const newPoints = account.points + p.points;
      if (newPoints < 0) return reject("negative_balance", "El ajuste dejaría el saldo en negativo");
      const newLifetime = account.lifetimePoints + Math.max(0, p.points);
      const newTier = computeNewTier(newLifetime, 0, DEFAULT_LOYALTY_TIERS);
      state.loyaltyAccounts.set(p.accountId, {
        ...account,
        points: newPoints,
        lifetimePoints: newLifetime,
        tier: newTier,
        updatedAt: event.at,
      });
      state.loyaltyTransactions.set(event.id, {
        id: event.id,
        accountId: p.accountId,
        type: "adjusted",
        points: p.points,
        note: p.reason,
        createdAt: event.at,
      });
      return null;
    }
    case "loyalty.reward_created": {
      const p = event.payload;
      if (state.loyaltyRewards.has(p.rewardId)) {
        return reject("duplicate", `La recompensa ${p.rewardId} ya existe`);
      }
      state.loyaltyRewards.set(p.rewardId, {
        id: p.rewardId,
        name: p.name,
        description: p.description,
        pointsCost: p.pointsCost,
        active: true,
        createdAt: event.at,
        updatedAt: event.at,
      });
      return null;
    }
    case "loyalty.reward_updated": {
      const p = event.payload;
      const reward = state.loyaltyRewards.get(p.rewardId);
      if (!reward) return reject("not_found", `Recompensa inexistente: ${p.rewardId}`);
      state.loyaltyRewards.set(p.rewardId, {
        ...reward,
        ...p.changes,
        updatedAt: event.at,
      });
      return null;
    }

    // ── Crédito de cliente ─────────────────────────────────────────────
    case "credit.added": {
      const p = event.payload;
      if (p.amount.minor <= 0) return reject("invalid_amount", "El abono debe ser un importe positivo");
      const existing = state.creditAccounts.get(p.accountId);
      const account = existing ?? {
        id: p.accountId,
        partnerId: p.partnerId,
        partnerName: p.partnerName,
        balances: new Map<CurrencyCode, Money>(),
        createdAt: event.at,
        updatedAt: event.at,
      };
      state.creditAccounts.set(p.accountId, {
        ...account,
        partnerName: p.partnerName,
        balances: new Map(account.balances).set(
          p.amount.currency,
          add(account.balances.get(p.amount.currency) ?? zero(p.amount.currency), p.amount),
        ),
        updatedAt: event.at,
      });
      state.creditTransactions.set(event.id, {
        id: event.id,
        accountId: p.accountId,
        type: "added",
        amount: p.amount,
        reference: p.reference,
        note: p.note,
        createdAt: event.at,
      });
      return null;
    }
    case "credit.used": {
      const p = event.payload;
      if (p.amount.minor <= 0) return reject("invalid_amount", "El consumo debe ser un importe positivo");
      const account = state.creditAccounts.get(p.accountId);
      if (!account) return reject("not_found", `Cuenta de crédito inexistente: ${p.accountId}`);
      const available = account.balances.get(p.amount.currency) ?? zero(p.amount.currency);
      if (available.minor < p.amount.minor) {
        return reject(
          "insufficient_balance",
          `Crédito insuficiente en ${p.amount.currency}: disponible ${format(available)}, requerido ${format(p.amount)}`,
        );
      }
      state.creditAccounts.set(p.accountId, {
        ...account,
        balances: new Map(account.balances).set(
          p.amount.currency,
          subtract(available, p.amount),
        ),
        updatedAt: event.at,
      });
      state.creditTransactions.set(event.id, {
        id: event.id,
        accountId: p.accountId,
        type: "used",
        amount: { minor: -p.amount.minor, currency: p.amount.currency },
        reference: p.reference,
        note: p.note,
        createdAt: event.at,
      });
      return null;
    }
    case "credit.adjusted": {
      const p = event.payload;
      const account = state.creditAccounts.get(p.accountId);
      if (!account) return reject("not_found", `Cuenta de crédito inexistente: ${p.accountId}`);
      const current = account.balances.get(p.amount.currency) ?? zero(p.amount.currency);
      const newBalance = add(current, p.amount);
      if (newBalance.minor < 0) {
        return reject("negative_balance", `El ajuste dejaría el saldo en negativo en ${p.amount.currency}`);
      }
      state.creditAccounts.set(p.accountId, {
        ...account,
        balances: new Map(account.balances).set(p.amount.currency, newBalance),
        updatedAt: event.at,
      });
      state.creditTransactions.set(event.id, {
        id: event.id,
        accountId: p.accountId,
        type: "adjusted",
        amount: p.amount,
        note: p.reason,
        createdAt: event.at,
      });
      return null;
    }

    // ── Contabilidad ────────────────────────────────────────────────────
    case "accounting.account_created": {
      const { accountId, ...draft } = event.payload;
      if (state.accounts.has(accountId)) return reject("duplicate", `La cuenta ${accountId} ya existe`);
      // Validar código único
      for (const existing of state.accounts.values()) {
        if (existing.code === draft.code) {
          return reject("code_taken", `El código ${draft.code} ya está en uso por ${existing.name}`);
        }
      }
      state.accounts.set(accountId, {
        id: accountId,
        ...draft,
        archived: false,
      });
      return null;
    }
    case "accounting.account_updated": {
      const current = state.accounts.get(event.payload.accountId);
      if (!current) return reject("not_found", `Cuenta inexistente: ${event.payload.accountId}`);
      if (current.archived) return reject("archived", "La cuenta está archivada");
      // Si cambia el código, validar unicidad
      if (event.payload.changes.code && event.payload.changes.code !== current.code) {
        for (const other of state.accounts.values()) {
          if (other.id !== current.id && other.code === event.payload.changes.code) {
            return reject("code_taken", `El código ${event.payload.changes.code} ya está en uso`);
          }
        }
      }
      state.accounts.set(current.id, { ...current, ...event.payload.changes });
      return null;
    }
    case "accounting.account_archived": {
      const current = state.accounts.get(event.payload.accountId);
      if (!current) return reject("not_found", `Cuenta inexistente: ${event.payload.accountId}`);
      state.accounts.set(current.id, { ...current, archived: true });
      return null;
    }
    case "accounting.account_restored": {
      const current = state.accounts.get(event.payload.accountId);
      if (!current) return reject("not_found", `Cuenta inexistente: ${event.payload.accountId}`);
      state.accounts.set(current.id, { ...current, archived: false });
      return null;
    }
    case "accounting.entry_posted": {
      const p = event.payload;
      if (state.journalEntries.has(p.entryId)) return reject("duplicate", `El asiento ${p.entryId} ya existe`);
      // Validar que todas las cuentas existan
      for (const line of p.lines) {
        const account = state.accounts.get(line.accountId);
        if (!account) return reject("not_found", `Cuenta inexistente en el asiento: ${line.accountId}`);
        if (account.archived) return reject("archived_account", `Cuenta archivada en el asiento: ${account.name}`);
      }
      // Validar cuadratura
      if (!isBalanced({ date: p.date, description: p.description, reference: p.reference, lines: p.lines }, "GTQ")) {
        return reject("unbalanced", "El asiento no está cuadrado (débitos ≠ créditos)");
      }
      state.journalEntries.set(p.entryId, {
        id: p.entryId,
        date: p.date,
        description: p.description,
        reference: p.reference,
        lines: p.lines,
        status: "posted",
        postedAt: event.at,
        createdAt: event.at,
      });
      return null;
    }
    case "accounting.entry_voided": {
      const current = state.journalEntries.get(event.payload.entryId);
      if (!current) return reject("not_found", `Asiento inexistente: ${event.payload.entryId}`);
      if (current.status === "voided") return reject("already_voided", "El asiento ya estaba anulado");
      state.journalEntries.set(current.id, {
        ...current,
        status: "voided",
        voidedAt: event.at,
        voidReason: event.payload.reason,
      });
      return null;
    }
    case "payroll.employee_created": {
      const { employeeId, ...draft } = event.payload;
      if (state.employees.has(employeeId)) return reject("duplicate", `El empleado ${employeeId} ya existe`);
      const empProblems = validateEmployeeDraft(draft);
      const empProblem = empProblems[0];
      if (empProblem) return reject(empProblem.code, empProblem.message);
      const bossProblem = managerProblem(state, employeeId, draft.managerId);
      if (bossProblem) return reject(bossProblem.code, bossProblem.message);
      state.employees.set(employeeId, {
        id: employeeId,
        ...draft,
        archived: false,
        createdAt: event.at,
        updatedAt: event.at,
      });
      return null;
    }
    case "payroll.employee_updated": {
      const { employeeId, changes } = event.payload;
      const current = state.employees.get(employeeId);
      if (!current) return reject("not_found", `Empleado inexistente: ${employeeId}`);
      if (current.archived) return reject("archived", "El empleado esta archivado");
      const updated = { ...current, ...changes, id: current.id, updatedAt: event.at };
      const updProblems = validateEmployeeDraft(updated);
      const updProblem = updProblems[0];
      if (updProblem) return reject(updProblem.code, updProblem.message);
      const bossProblem = managerProblem(state, current.id, updated.managerId);
      if (bossProblem) return reject(bossProblem.code, bossProblem.message);
      state.employees.set(current.id, updated);
      return null;
    }
    case "payroll.employee_archived": {
      const current = state.employees.get(event.payload.employeeId);
      if (!current) return reject("not_found", `Empleado inexistente: ${event.payload.employeeId}`);
      if (current.archived) return reject("already_archived", "El empleado ya estaba archivado");
      state.employees.set(current.id, { ...current, archived: true, updatedAt: event.at });
      return null;
    }
    case "payroll.run_processed": {
      const p = event.payload;
      if (state.payrollRuns.has(p.runId)) return reject("duplicate", `La nómina ${p.runId} ya existe`);
      if (!/^\d{4}-\d{2}$/.test(p.month)) return reject("bad_month", `Mes inválido: ${p.month}`);
      if (p.lines.length === 0) return reject("no_lines", "Una nómina debe tener al menos una línea");
      const verifyProblem = verifyPayrollTotals(p.lines, p.totals);
      if (verifyProblem) return reject(verifyProblem.code, verifyProblem.message);
      state.payrollRuns.set(p.runId, {
        id: p.runId,
        month: p.month,
        lines: p.lines,
        totals: p.totals,
        processedAt: event.at,
      });
      return null;
    }
    case "inventory.location_created": {
      const { locationId, ...draft } = event.payload;
      if (state.locations.has(locationId)) return reject("duplicate", `La ubicación ${locationId} ya existe`);
      const locProblems = validateLocationDraft(draft);
      const locProblem = locProblems[0];
      if (locProblem) return reject(locProblem.code, locProblem.message);
      state.locations.set(locationId, {
        id: locationId,
        ...draft,
        archived: false,
        createdAt: event.at,
        updatedAt: event.at,
      });
      return null;
    }
    case "inventory.location_updated": {
      const { locationId, changes } = event.payload;
      const current = state.locations.get(locationId);
      if (!current) return reject("not_found", `Ubicación inexistente: ${locationId}`);
      if (current.archived) return reject("archived", "La ubicación esta archivada");
      if (locationId === PRIMARY_LOCATION_ID) {
        return reject("inventory.immutable_primary", "La ubicación principal no se puede editar");
      }
      const updated = { ...current, ...changes, id: current.id, updatedAt: event.at };
      const locProblems = validateLocationDraft(updated);
      const locProblem = locProblems[0];
      if (locProblem) return reject(locProblem.code, locProblem.message);
      state.locations.set(current.id, updated);
      return null;
    }
    case "inventory.location_archived": {
      const current = state.locations.get(event.payload.locationId);
      if (!current) return reject("not_found", `Ubicación inexistente: ${event.payload.locationId}`);
      if (event.payload.locationId === PRIMARY_LOCATION_ID) {
        return reject("inventory.immutable_primary", "La ubicación principal no se puede archivar");
      }
      if (current.archived) return reject("already_archived", "La ubicación ya estaba archivada");
      state.locations.set(current.id, { ...current, archived: true, updatedAt: event.at });
      return null;
    }
    case "inventory.transfer_created": {
      const p = event.payload;
      if (state.transfers.has(p.transferId)) return reject("duplicate", `El traslado ${p.transferId} ya existe`);
      const trProblems = validateTransferDraft({
        date: p.date,
        fromLocationId: p.fromLocationId,
        toLocationId: p.toLocationId,
        reference: p.reference,
        lines: p.lines,
      });
      const trProblem = trProblems[0];
      if (trProblem) return reject(trProblem.code, trProblem.message);
      const from = state.locations.get(p.fromLocationId);
      const to = state.locations.get(p.toLocationId);
      if (!from) return reject("not_found", `Ubicación de origen inexistente: ${p.fromLocationId}`);
      if (!to) return reject("not_found", `Ubicación de destino inexistente: ${p.toLocationId}`);
      if (from.archived) return reject("archived", `La ubicación de origen ${from.name} esta archivada`);
      if (to.archived) return reject("archived", `La ubicación de destino ${to.name} esta archivada`);
      for (const line of p.lines) {
        const product = state.products.get(line.productId);
        if (!product) return reject("not_found", `Producto inexistente: ${line.productId}`);
        if (isKit(product)) return reject("not_transferable", "Un combo no se traslada: se mueven sus componentes");
        const available = locationStock(state, from.id, line.productId);
        if (line.quantity > available) {
          return reject(
            "insufficient_stock",
            `Stock insuficiente en ${from.name}: ${product.name} (disponible ${available})`,
          );
        }
      }
      state.transfers.set(p.transferId, {
        id: p.transferId,
        date: p.date,
        fromLocationId: p.fromLocationId,
        toLocationId: p.toLocationId,
        reference: p.reference,
        lines: p.lines,
        createdAt: event.at,
      });
      return null;
    }

    case "company.created": {
      const { companyId, ...draft } = event.payload;
      if (state.companies.has(companyId)) return reject("duplicate", `La empresa ${companyId} ya existe`);
      const companyProblem = validateCompanyDraft(draft)[0];
      if (companyProblem) return reject(companyProblem.code, companyProblem.message);
      state.companies.set(companyId, {
        id: companyId,
        name: draft.name.trim(),
        baseCurrency: draft.baseCurrency,
        archived: false,
        createdAt: event.at,
        updatedAt: event.at,
      });
      return null;
    }
    case "company.updated": {
      const current = state.companies.get(event.payload.companyId);
      if (!current) return reject("not_found", `Empresa inexistente: ${event.payload.companyId}`);
      const { companyId: _companyId, changes } = event.payload;
      const companyProblem = validateCompanyChanges(changes)[0];
      if (companyProblem) return reject(companyProblem.code, companyProblem.message);
      state.companies.set(current.id, {
        ...current,
        name: changes.name !== undefined ? changes.name.trim() : current.name,
        baseCurrency: changes.baseCurrency ?? current.baseCurrency,
        updatedAt: event.at,
      });
      return null;
    }
    case "company.archived": {
      const current = state.companies.get(event.payload.companyId);
      if (!current) return reject("not_found", `Empresa inexistente: ${event.payload.companyId}`);
      state.companies.set(current.id, { ...current, archived: true, updatedAt: event.at });
      return null;
    }
    case "company.restored": {
      const current = state.companies.get(event.payload.companyId);
      if (!current) return reject("not_found", `Empresa inexistente: ${event.payload.companyId}`);
      state.companies.set(current.id, { ...current, archived: false, updatedAt: event.at });
      return null;
    }

    case "rate.updated": {
      const { rateId, from, to, rate, date, source } = event.payload;
      if (state.rates.has(rateId)) return reject("duplicate", `La tasa ${rateId} ya existe`);
      const rateProblem = validateExchangeRateDraft({ from, to, rate, date, source })[0];
      if (rateProblem) return reject(rateProblem.code, rateProblem.message);
      state.rates.set(rateId, {
        id: rateId,
        from,
        to,
        rate,
        date,
        source: source ?? "manual",
        createdAt: event.at,
      });
      return null;
    }
  }
}

export interface Projection {
  readonly state: State;
  readonly rejected: RejectedEvent[];
}

export function project(events: readonly AnyEvent[]): Projection {
  const state = emptyState();
  const rejected: RejectedEvent[] = [];
  for (const event of events) {
    const problem = apply(state, event);
    if (problem) rejected.push(problem);
  }
  return { state, rejected };
}

// ---------------------------------------------------------------------------
// Consultas derivadas
// ---------------------------------------------------------------------------

export function activeExpenses(state: State): Expense[] {
  return [...state.expenses.values()].filter((e) => !e.archived);
}

export function expensesInMonth(state: State, month: MonthKey): Expense[] {
  return activeExpenses(state)
    .filter((e) => monthKeyOf(e.date) === month)
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}

/** Total de gastos del periodo. Excluye los rechazados: no representan salida de dinero. */
export function totalExpenses(state: State, month: MonthKey, currency: CurrencyCode): Money {
  const amounts = expensesInMonth(state, month)
    .filter((e) => e.status !== "rejected" && e.amount.currency === currency)
    .map((e) => e.amount);
  return sum(amounts, currency);
}

export function expensesByCategory(state: State, month: MonthKey, currency: CurrencyCode): Map<string, Money> {
  const result = new Map<string, Money>();
  for (const expense of expensesInMonth(state, month)) {
    if (expense.status === "rejected" || expense.amount.currency !== currency) continue;
    const key = expense.categoryId ?? "sin-categoria";
    result.set(key, add(result.get(key) ?? zero(currency), expense.amount));
  }
  return result;
}

export function invoicesInMonth(state: State, month: MonthKey): Invoice[] {
  return [...state.invoices.values()]
    .filter((i) => monthKeyOf(i.date) === month)
    .sort((a, b) => b.number - a.number);
}

export function totalInvoiced(state: State, month: MonthKey, currency: CurrencyCode): Money {
  const amounts = invoicesInMonth(state, month)
    .filter((i) => i.currency === currency)
    .map((i) => ({ minor: i.totals.total.minor - i.creditedTotal.minor, currency }));
  return sum(amounts, currency);
}

export interface DiscountSummary {
  total: Money;
  documents: number;
}

/**
 * Total descontado del periodo y cantidad de facturas con al menos una línea con
 * descuento.
 *
 * Universo BRUTO: mide el descuento concedido sobre los DTE emitidos, sin netear
 * notas de crédito (a diferencia de `totalInvoiced`, que sí descuenta
 * `creditedTotal`). Una factura acreditada en el mismo mes sigue aportando su
 * descuento.
 *
 * Resiliente a datos históricos corruptos: si una línea con descuento no puede
 * calcularse (descuento fuera de rango, monto que excede la base), se omite esa
 * línea sin tumbar la consulta — una proyección de reportes nunca debe morir por
 * un registro inválido.
 */
export function discountSummary(state: State, month: MonthKey, currency: CurrencyCode): DiscountSummary {
  const amounts: Money[] = [];
  let documents = 0;
  for (const invoice of invoicesInMonth(state, month)) {
    if (invoice.currency !== currency) continue;
    const lineDiscounts: Money[] = [];
    for (const line of invoice.lines) {
      try {
        lineDiscounts.push(lineDiscountAmount(line));
      } catch {
        // Línea histórica inválida: se omite y se sigue con el resto.
      }
    }
    if (lineDiscounts.some((d) => d.minor > 0)) documents += 1;
    amounts.push(...lineDiscounts);
  }
  return { total: sum(amounts, currency), documents };
}

/**
 * Correlativos faltantes en una serie. Un hueco no bloquea la operacion, pero
 * hay que reportarlo: casi siempre significa un evento rechazado en el merge.
 */
export function seriesGaps(state: State, series: string): number[] {
  const used = new Set(
    [...state.invoices.values()].filter((i) => i.series === series).map((i) => i.number),
  );
  const last = state.lastNumberBySeries.get(series);
  if (last === undefined) return [];
  const gaps: number[] = [];
  for (let n = 1; n <= last; n++) if (!used.has(n)) gaps.push(n);
  return gaps;
}

export function nextNumberFor(state: State, series: string): number {
  return (state.lastNumberBySeries.get(series) ?? 0) + 1;
}

export function findPartnerByTaxId(state: State, taxId: string): Partner | undefined {
  const normalized = taxId.trim().toUpperCase().replace(/[\s-]/g, "");
  return [...state.partners.values()].find(
    (p) => !p.archived && p.taxId && p.taxId.trim().toUpperCase().replace(/[\s-]/g, "") === normalized,
  );
}

export function expensesOnDate(state: State, date: IsoDate): Expense[] {
  return activeExpenses(state).filter((e) => e.date === date);
}

export function activePartners(state: State): Partner[] {
  return [...state.partners.values()]
    .filter((p) => !p.archived)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function activeProducts(state: State): Product[] {
  return [...state.products.values()]
    .filter((p) => !p.archived)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Referencia de producto ya usada por otro registro. Evita códigos duplicados. */
export function findProductByReference(state: State, reference: string, exceptId?: string): Product | undefined {
  const needle = reference.trim().toUpperCase();
  if (needle === "") return undefined;
  return activeProducts(state).find(
    (p) => p.id !== exceptId && (p.reference ?? "").trim().toUpperCase() === needle,
  );
}

/** Cuántos documentos emitidos referencian a este contacto. Bloquea el archivado a ciegas. */
export function invoiceCountForPartner(state: State, partnerId: string): number {
  return [...state.invoices.values()].filter((i) => i.partnerId === partnerId).length;
}

/** Notas de crédito de una factura, en el orden en que se emitieron. */
export function creditNotesFor(state: State, invoiceId: string): CreditNote[] {
  const invoice = state.invoices.get(invoiceId);
  if (!invoice) return [];
  return invoice.creditNoteIds
    .map((id) => state.creditNotes.get(id))
    .filter((note): note is CreditNote => note !== undefined);
}

/** Saldo vivo del documento: total menos lo acreditado. No descuenta el pago. */
export function invoiceNetTotal(invoice: Invoice): Money {
  return {
    minor: invoice.totals.total.minor - invoice.creditedTotal.minor,
    currency: invoice.currency,
  };
}

// ---------------------------------------------------------------------------
// Existencias
// ---------------------------------------------------------------------------

export interface StockLevel {
  readonly productId: string;
  readonly received: number;
  readonly sold: number;
  readonly adjusted: number;
  readonly onHand: number;
}

/**
 * Existencia por producto. **No se guarda nunca**: se calcula de los movimientos.
 *
 *   existencia = entradas − ventas ± ajustes
 *
 * Las ventas se explotan por receta: vender un combo descuenta sus componentes,
 * no el combo. Un combo, por lo tanto, no aparece acá.
 *
 * Las notas de crédito **no** devuelven existencia: son una corrección de dinero.
 * Si la mercadería volvió físicamente, eso es un ajuste con motivo «Devolución
 * de cliente». Confundir las dos cosas es cómo se descuadra un inventario.
 */
export function stockLevels(state: State): Map<string, StockLevel> {
  const received = new Map<string, number>();
  const sold = new Map<string, number>();
  const adjusted = new Map<string, number>();
  const bump = (map: Map<string, number>, id: string, qty: number) => map.set(id, (map.get(id) ?? 0) + qty);

  for (const receipt of state.receipts.values()) {
    for (const line of receipt.lines) bump(received, line.productId, line.quantity);
  }

  for (const invoice of state.invoices.values()) {
    for (const line of invoice.lines) {
      if (!line.productId) continue;
      try {
        for (const [id, qty] of explodeLine(state.products, line)) bump(sold, id, qty);
      } catch {
        // Receta circular o demasiado profunda: se descuenta el producto tal
        // cual para no perder el movimiento. El problema se reporta aparte.
        bump(sold, line.productId, line.quantity);
      }
    }
  }

  for (const adjustment of state.adjustments.values()) {
    bump(adjusted, adjustment.productId, adjustment.quantity);
  }

  const ids = new Set([...received.keys(), ...sold.keys(), ...adjusted.keys()]);
  const levels = new Map<string, StockLevel>();
  for (const productId of ids) {
    const product = state.products.get(productId);
    if (product && isKit(product)) continue; // un combo no lleva existencia
    const r = received.get(productId) ?? 0;
    const s = sold.get(productId) ?? 0;
    const a = adjusted.get(productId) ?? 0;
    levels.set(productId, { productId, received: r, sold: s, adjusted: a, onHand: r - s + a });
  }
  return levels;
}

/** Existencia de un producto. `null` para los combos, que no la tienen. */
export function stockOf(state: State, productId: string): number | null {
  const product = state.products.get(productId);
  if (product && isKit(product)) return null;
  return stockLevels(state).get(productId)?.onHand ?? 0;
}

/**
 * Costo promedio de compra: total pagado dividido entre unidades recibidas.
 * Es el promedio histórico de compras, no un costo promedio móvil de consumo.
 * Devuelve `null` si nunca se compró.
 */
export function purchaseAverageCost(state: State, productId: string, currency: CurrencyCode): Money | null {
  let quantity = 0;
  let total = 0;
  for (const receipt of state.receipts.values()) {
    for (const line of receipt.lines) {
      if (line.productId !== productId || line.unitCost.currency !== currency) continue;
      quantity += line.quantity;
      total += line.unitCost.minor * line.quantity;
    }
  }
  if (quantity === 0) return null;
  return { minor: Math.round(total / quantity), currency };
}

/** Productos con existencia negativa: casi siempre una entrada sin registrar. */
export function negativeStock(state: State): StockLevel[] {
  return [...stockLevels(state).values()].filter((l) => l.onHand < 0);
}

export function receiptsInMonth(state: State, month: MonthKey): Receipt[] {
  return [...state.receipts.values()]
    .filter((r) => monthKeyOf(r.date) === month)
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}

export function receiptTotal(receipt: Receipt, currency: CurrencyCode): Money {
  let minor = 0;
  for (const line of receipt.lines) {
    if (line.unitCost.currency !== currency) continue;
    minor += Math.round(line.unitCost.minor * line.quantity);
  }
  return { minor, currency };
}

/**
 * Entradas de stock sin pagar del período: la cuenta por pagar a proveedores.
 * Espejo de `unpaidInvoices`, del lado de las compras en vez de las ventas.
 */
export function unpaidReceipts(state: State, month: MonthKey, currency: CurrencyCode): {
  readonly count: number;
  readonly amount: Money;
} {
  const unpaid = receiptsInMonth(state, month).filter((r) => r.status === "unpaid");
  return {
    count: unpaid.length,
    amount: sum(
      unpaid.map((r) => receiptTotal(r, currency)),
      currency,
    ),
  };
}

/** Lo efectivamente pagado a proveedores en el período. */
export function paidReceipts(state: State, month: MonthKey, currency: CurrencyCode): Money {
  const paid = receiptsInMonth(state, month).filter((r) => r.status === "paid");
  return sum(
    paid.map((r) => receiptTotal(r, currency)),
    currency,
  );
}

// ---------------------------------------------------------------------------
// Caja
// ---------------------------------------------------------------------------

/** El turno abierto, si lo hay. Solo puede haber uno. */
export function openShift(state: State): Shift | undefined {
  return [...state.shifts.values()].find((s) => !s.closedAt);
}

export function shiftsOf(state: State, date: IsoDate): Shift[] {
  return [...state.shifts.values()]
    .filter((s) => s.date === date)
    .sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1));
}

export function movementsOf(state: State, shiftId: string): CashMovement[] {
  return [...state.movements.values()]
    .filter((m) => m.shiftId === shiftId)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** Documentos cobrados dentro del turno. */
export function invoicesOfShift(state: State, shiftId: string): Invoice[] {
  return [...state.invoices.values()]
    .filter((i) => i.shiftId === shiftId)
    .sort((a, b) => a.number - b.number);
}

/**
 * Arqueo del turno.
 *
 *   esperado = fondo + ventas en efectivo + ingresos − retiros
 *
 * Solo el efectivo entra al cálculo: lo cobrado con tarjeta o transferencia no
 * está en el cajón, así que sumarlo haría que todo arqueo saliera con faltante.
 */
export function shiftSummary(state: State, shiftId: string, currency: CurrencyCode): ShiftSummary | null {
  const shift = state.shifts.get(shiftId);
  if (!shift) return null;

  const invoices = invoicesOfShift(state, shiftId).filter((i) => i.currency === currency);
  const cashSales = sum(
    invoices.filter((i) => isCashMethod(i.paymentMethod)).map((i) => i.totals.total),
    currency,
  );

  const movements = movementsOf(state, shiftId).filter((m) => m.amount.currency === currency);
  const movedIn = sum(movements.filter((m) => m.kind === "in").map((m) => m.amount), currency);
  const movedOut = sum(movements.filter((m) => m.kind === "out").map((m) => m.amount), currency);

  const expected: Money = {
    minor: shift.openingFloat.minor + cashSales.minor + movedIn.minor - movedOut.minor,
    currency,
  };
  const counted = shift.countedCash ?? null;

  return {
    openingFloat: shift.openingFloat,
    cashSales,
    movedIn,
    movedOut,
    expected,
    counted,
    difference: counted ? { minor: counted.minor - expected.minor, currency } : null,
    ticketCount: invoices.length,
  };
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

export function activeLeads(state: State): Lead[] {
  return [...state.leads.values()]
    .filter((l) => !l.archived)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function leadsInStage(state: State, stage: Stage): Lead[] {
  return activeLeads(state).filter((l) => l.stage === stage);
}

export interface PipelineSummary {
  readonly stage: Stage;
  readonly count: number;
  readonly totalValue: number;
}

export function pipelineSummary(state: State): PipelineSummary[] {
  const active = activeLeads(state).filter((l) => l.status === "active");
  const map = new Map<Stage, { count: number; totalValue: number }>();
  for (const lead of active) {
    const bucket = map.get(lead.stage) ?? { count: 0, totalValue: 0 };
    map.set(lead.stage, { count: bucket.count + 1, totalValue: bucket.totalValue + lead.estimatedValue });
  }
  const ORDER: Stage[] = ["nuevo", "contactado", "calificado", "propuesta", "negociacion", "ganado", "perdido"];
  return ORDER.filter((s) => map.has(s)).map((stage) => ({ stage, ...(map.get(stage) ?? { count: 0, totalValue: 0 }) }));
}

export function leadById(state: State, leadId: string): Lead | undefined {
  return state.leads.get(leadId);
}

// ---------------------------------------------------------------------------
// Recibo de pago (vista derivada de Invoice + empresa)
// ---------------------------------------------------------------------------

export interface ReceiptLineData {
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly taxRate: number;
  readonly subtotal: Money;
  readonly tax: Money;
  readonly total: Money;
}

export interface ReceiptData {
  readonly invoice: Invoice;
  readonly lines: ReceiptLineData[];
  readonly untaxed: Money;
  readonly taxByRate: ReadonlyMap<number, Money>;
  readonly total: Money;
  readonly currency: CurrencyCode;
  /** Datos de empresa (vienen de settings, no del dominio). */
  readonly company: {
    readonly name: string;
    readonly taxId: string;
    readonly address: string;
    readonly phone: string;
    readonly email: string;
    readonly logo: string;
  };
  readonly footer: string;
}

/**
 * Deriva los datos necesarios para renderizar un recibo de pago a partir de
 * una factura pagada y la configuración de empresa.
 *
 * No crea eventos ni muta estado: es puramente una vista derivada.
 */
export function receiptData(
  invoice: Invoice,
  company: { name: string; taxId: string; address: string; phone: string; email: string; logo: string },
  footer: string,
): ReceiptData {
  const lines: ReceiptLineData[] = invoice.lines.map((line) => {
    const subtotal = { minor: line.unitPrice.minor * line.quantity, currency: line.unitPrice.currency } as Money;
    const tax = { minor: Math.round((subtotal.minor * line.taxRate) / 100), currency: line.unitPrice.currency } as Money;
    const total = { minor: subtotal.minor + tax.minor, currency: line.unitPrice.currency } as Money;
    return { description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate, subtotal, tax, total };
  });

  return {
    invoice,
    lines,
    untaxed: invoice.totals.untaxed,
    taxByRate: invoice.totals.taxByRate,
    total: invoice.totals.total,
    currency: invoice.currency,
    company,
    footer,
  };
}

// ---------------------------------------------------------------------------
// Lealtad
// ---------------------------------------------------------------------------

export function allLoyaltyAccounts(state: State): LoyaltyAccount[] {
  return [...state.loyaltyAccounts.values()].sort((a, b) =>
    b.lifetimePoints - a.lifetimePoints || a.partnerName.localeCompare(b.partnerName, "es"),
  );
}

export function loyaltyAccountById(state: State, accountId: string): LoyaltyAccount | undefined {
  return state.loyaltyAccounts.get(accountId);
}

export function loyaltyAccountByPartner(state: State, partnerId: string): LoyaltyAccount | undefined {
  return [...state.loyaltyAccounts.values()].find((a) => a.partnerId === partnerId);
}

export function loyaltyTransactionsFor(state: State, accountId: string): LoyaltyTransaction[] {
  return [...state.loyaltyTransactions.values()]
    .filter((t) => t.accountId === accountId)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
}

export function allLoyaltyRewards(state: State): LoyaltyReward[] {
  return [...state.loyaltyRewards.values()].filter((r) => r.active).sort((a, b) => a.pointsCost - b.pointsCost);
}

export function loyaltyPointsSummary(state: State): {
  totalCustomers: number;
  totalPoints: number;
  byTier: { tier: string; count: number }[];
} {
  const accounts = [...state.loyaltyAccounts.values()];
  const byTier = new Map<string, number>();
  for (const a of accounts) {
    byTier.set(a.tier, (byTier.get(a.tier) ?? 0) + 1);
  }
  return {
    totalCustomers: accounts.length,
    totalPoints: accounts.reduce((sum, a) => sum + a.points, 0),
    byTier: [...byTier.entries()].map(([tier, count]) => ({ tier, count })),
  };
}

// ---------------------------------------------------------------------------
// Crédito de cliente
// ---------------------------------------------------------------------------

export function allCreditAccounts(state: State): CreditAccount[] {
  return [...state.creditAccounts.values()].sort((a, b) =>
    a.partnerName.localeCompare(b.partnerName, "es"),
  );
}

export function creditAccountByPartner(state: State, partnerId: string): CreditAccount | undefined {
  return [...state.creditAccounts.values()].find((a) => a.partnerId === partnerId);
}

export function creditBalanceFor(state: State, partnerId: string, currency: CurrencyCode): Money {
  const account = creditAccountByPartner(state, partnerId);
  return account?.balances.get(currency) ?? zero(currency);
}

export function creditTransactionsFor(state: State, accountId: string): CreditTransaction[] {
  return [...state.creditTransactions.values()]
    .filter((t) => t.accountId === accountId)
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Contabilidad
// ---------------------------------------------------------------------------

export function activeAccounts(state: State): Account[] {
  return [...state.accounts.values()]
    .filter((a) => !a.archived)
    .sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }));
}

export function accountsByType(state: State, type: LedgerAccountType): Account[] {
  return activeAccounts(state).filter((a) => a.type === type);
}

export function accountById(state: State, accountId: string): Account | undefined {
  return state.accounts.get(accountId);
}

export function accountByCode(state: State, code: string): Account | undefined {
  return [...state.accounts.values()].find((a) => a.code === code);
}

export function postedEntries(state: State): JournalEntry[] {
  return [...state.journalEntries.values()]
    .filter((e) => e.status === "posted")
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}

export function entriesOnDate(state: State, date: IsoDate): JournalEntry[] {
  return [...state.journalEntries.values()]
    .filter((e) => e.date === date && e.status !== "voided")
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

export function entriesInMonth(state: State, month: MonthKey): JournalEntry[] {
  return [...state.journalEntries.values()]
    .filter((e) => monthKeyOf(e.date) === month && e.status !== "voided")
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}

/** Balance de una cuenta individual (débitos - créditos, en moneda dada). */
export function accountBalance(state: State, accountId: string, currency: CurrencyCode): Money {
  let debits = 0;
  let credits = 0;
  for (const entry of state.journalEntries.values()) {
    if (entry.status !== "posted") continue;
    for (const line of entry.lines) {
      if (line.accountId !== accountId) continue;
      if (line.debit.currency === currency) debits += line.debit.minor;
      if (line.credit.currency === currency) credits += line.credit.minor;
    }
  }
  return { minor: debits - credits, currency };
}

// ---------------------------------------------------------------------------
// Nómina
// ---------------------------------------------------------------------------

export function activeEmployees(state: State): Employee[] {
  return [...state.employees.values()]
    .filter((e) => !e.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Empleados que actúan como raíz en el organigrama:
 * Aquellos activos sin jefe asignado, O cuyo jefe directo ya no está activo
 * (inexistente o archivado). Esto garantiza que ningún empleado activo
 * quede huérfano o invisible si su jefe es archivado.
 */
export function rootEmployees(state: State): Employee[] {
  const activeIds = new Set(activeEmployees(state).map((e) => e.id));
  return activeEmployees(state)
    .filter((e) => !e.managerId || !activeIds.has(e.managerId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function employeeById(state: State, employeeId: string): Employee | undefined {
  return state.employees.get(employeeId);
}

export function payrollRunById(state: State, runId: string): PayrollRun | undefined {
  return state.payrollRuns.get(runId);
}

export function payrollRunsInMonth(state: State, month: MonthKey): PayrollRun[] {
  return [...state.payrollRuns.values()]
    .filter((r) => r.month === month)
    .sort((a, b) => a.processedAt.localeCompare(b.processedAt));
}

export function employeePayrollRuns(state: State, employeeId: string): PayrollRun[] {
  return [...state.payrollRuns.values()]
    .filter((r) => r.lines.some((l) => l.employeeId === employeeId))
    .sort((a, b) => a.processedAt.localeCompare(b.processedAt));
}

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------

export interface LocationStockLevel {
  readonly productId: string;
  readonly onHand: number;
}

export function activeLocations(state: State): InventoryLocation[] {
  return [...state.locations.values()]
    .filter((l) => !l.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function locationById(state: State, locationId: string): InventoryLocation | undefined {
  return state.locations.get(locationId);
}

export function transfersOf(state: State, locationId: string): StockTransfer[] {
  return [...state.transfers.values()]
    .filter((t) => t.fromLocationId === locationId || t.toLocationId === locationId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Existencias por producto en una ubicación. Incluye todo lo que pasó por ella. */
export function locationStockLevels(state: State, locationId: string): LocationStockLevel[] {
  const ids = new Set<string>();
  for (const t of state.transfers.values()) {
    if (t.fromLocationId !== locationId && t.toLocationId !== locationId) continue;
    for (const line of t.lines) ids.add(line.productId);
  }
  if (locationId === PRIMARY_LOCATION_ID) {
    for (const [id, level] of stockLevels(state)) {
      const product = state.products.get(id);
      if (product && isKit(product)) continue;
      if (level.onHand !== 0) ids.add(id);
    }
  }
  const levels: LocationStockLevel[] = [];
  for (const productId of ids) {
    levels.push({ productId, onHand: locationStock(state, locationId, productId) });
  }
  return levels.sort((a, b) => a.productId.localeCompare(b.productId));
}

/** Existencia de un producto en una ubicación. La principal acumula recepciones, ventas y ajustes. */
export function locationStock(state: State, locationId: string, productId: string): number {
  const transferDelta = (loc: string): number => {
    let delta = 0;
    for (const t of state.transfers.values()) {
      if (t.fromLocationId !== loc && t.toLocationId !== loc) continue;
      for (const line of t.lines) {
        if (line.productId !== productId) continue;
        if (t.fromLocationId === loc) delta -= line.quantity;
        if (t.toLocationId === loc) delta += line.quantity;
      }
    }
    return delta;
  };
  if (locationId === PRIMARY_LOCATION_ID) {
    const base = stockLevels(state).get(productId)?.onHand ?? 0;
    return base + transferDelta(PRIMARY_LOCATION_ID);
  }
  return transferDelta(locationId);
}

/** Empresas activas (no archivadas), ordenadas por nombre. */
export function activeCompanies(state: State): Company[] {
  return [...state.companies.values()]
    .filter((c) => !c.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Tasa de cambio vigente para el par `from`->`to` en una fecha: la mas reciente
 * por `date` (desempatando por `createdAt`). Devuelve undefined si no hay fecha
 * valida para esa moneda.
 */
export function rateFor(
  state: State,
  from: CurrencyCode,
  to: CurrencyCode,
  date: IsoDate,
): ExchangeRate | undefined {
  let best: ExchangeRate | undefined;
  for (const r of state.rates.values()) {
    if (r.from !== from || r.to !== to) continue;
    if (r.date > date) continue;
    if (!best || r.date > best.date || (r.date === best.date && r.createdAt >= best.createdAt)) best = r;
  }
  return best;
}

/** Busca la cuenta contable asociada a un método de pago (tender). */
function findTenderAccount(state: State, method: string): Account | undefined {
  const methodLower = method.toLowerCase();
  for (const acc of state.accounts.values()) {
    const nameLower = acc.name.toLowerCase();
    if (methodLower.includes("efectiv") && (nameLower.includes("caja") || nameLower.includes("efectiv"))) return acc;
    if (methodLower.includes("tarjet") && nameLower.includes("banco")) return acc;
    if (methodLower.includes("transfer") && nameLower.includes("banco")) return acc;
    if (methodLower.includes("credito") && acc.type === "activo" && nameLower.includes("cobrar")) return acc;
  }
  // Fallback: primera cuenta de activo
  return [...state.accounts.values()].find((a) => a.type === "activo");
}

/** Busca la cuenta de Cuentas por Cobrar (activo). */
function findARAccount(state: State): Account | undefined {
  return [...state.accounts.values()].find((a) => a.code === "1200" || (a.type === "activo" && a.name.toLowerCase().includes("cobrar")));
}
