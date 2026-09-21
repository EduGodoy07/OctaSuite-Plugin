/**
 * Mapeo Odoo 18 (dump DeLoAlto) → eventos de OctaSuite Lite.
 *
 * Decisión de diseño (Eduardo, 2026-09-15): los NIT se importan TAL CUAL;
 * los que no pasan la validación de dominio no se rechazan ni se mutan:
 * se conservan en `notes` para una verificación futura contra el SAT.
 * La regla del North Star aplica: extraemos el invariante (trazabilidad del
 * identificador fiscal), no copiamos el mecanismo de validación de Odoo.
 */
import { computeInvoiceTotals, totalsSnapshot, type InvoiceLine, type LineDiscount } from "../domain/invoice.js";
import { isValidNit, type AccountType, type PartnerDraft } from "../domain/partner.js";
import type { ProductDraft } from "../domain/product.js";
import type { AnyEvent } from "../events.js";
import { fromDecimal, money, type CurrencyCode, type Money } from "../money.js";
import { project } from "../store.js";
import type { Row } from "./copy.js";

const GTQ: CurrencyCode = "GTQ";
/** Serie fija para documentos importados de Odoo (número = id interno del dump). */
export const ODOO_SERIES = "ODOO";

export interface DomainReport {
  readonly imported: number;
  /** motivo → cantidad. */
  readonly skipped: ReadonlyMap<string, number>;
}

export interface PartnerReport extends DomainReport {
  /** NIT válidos (o CF) quedaron en el campo fiscal. */
  readonly taxIdKept: number;
  /** NIT dudosos preservados en notes (validación SAT futura). */
  readonly taxIdPreserved: number;
  readonly emptyVat: number;
  readonly cfCount: number;
}

export interface InvoiceReport extends DomainReport {
  /** Facturas cuyo total difiere del amount_total de Odoo (redondeo por línea). */
  readonly withRoundingDiff: number;
}

export interface DeloaltoImport {
  readonly events: readonly AnyEvent[];
  readonly categories: DomainReport;
  readonly products: DomainReport;
  readonly partners: PartnerReport;
  readonly invoices: InvoiceReport;
  /** Diferencia agregada Odoo vs OctaSuite (redondeo por línea), en centavos. */
  readonly totalDiffMinor: number;
  /** Eventos rechazados por la pre-validación con project() (no se importan). */
  readonly rejected: readonly { readonly type: string; readonly code: string; readonly reason: string }[];
}

type Skip = { readonly skip: true; readonly reason: string };
type Mapped<T> = T | Skip;
function isSkip<T>(m: Mapped<T>): m is Skip {
  return (m as Skip).skip === true;
}

const str = (v: string | null | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/**
 * `price_unit` de Odoo INCLUYE IVA (precio al consumidor, patrón GT). El neto
 * real de la línea está en `price_subtotal` (= qty × unit × (1 - disc) /
 * (1 + tasa), calculado y redondeado por Odoo). Para que el dominio de
 * OctaSuite reproduzca el subtotal exacto, el unitPrice debe ser la base
 * pre-descuento: unitPrice = subtotal / (qty × (1 - disc/100)). Redondeo
 * HALF-UP al centavo (Money no admite fracciones de centavo). Si el dump no
 * trae `price_subtotal`, cae al comportamiento anterior desde `price_unit`.
 */
function netUnitPrice(line: Row, quantity: number, discountPercent: number): Money {
  const subtotal = str(line.price_subtotal);
  if (subtotal && quantity > 0) {
    const subtotalMinor = fromDecimal(subtotal, GTQ).minor;
    const discFactor =
      Number.isFinite(discountPercent) && discountPercent >= 0 && discountPercent <= 100
        ? 1 - discountPercent / 100
        : 1;
    if (discFactor > 0) {
      return money(Math.round(subtotalMinor / (quantity * discFactor)), GTQ);
    }
  }
  return fromDecimal(str(line.price_unit) ?? "0", GTQ);
}

// ── Partners ─────────────────────────────────────────────────────────

/**
 * Importa empresas (is_company) y personas sueltas (sin parent). Los contactos
 * hijo (direcciones de una empresa) se saltan; el importador de facturas los
 * reincorpora si alguna factura los referencia.
 */
export function mapPartnerRow(row: Row): Mapped<{ partnerId: string; draft: PartnerDraft }> {
  const odooId = str(row.id);
  if (!odooId) return { skip: true, reason: "sin_id" };
  if (row.is_company !== "t" && str(row.parent_id)) return { skip: true, reason: "contacto_hijo" };
  const name = str(row.name);
  if (!name) return { skip: true, reason: "sin_nombre" };

  const accountType: AccountType = row.is_company === "t" ? "company" : "individual";
  const vat = str(row.vat);
  let taxId: string | undefined;
  let notes = str(row.comment);
  if (vat && vat.toUpperCase() !== "CF" && !isValidNit(vat)) {
    // NIT dudoso: se preserva como evidencia, fuera del campo fiscal.
    notes = `NIT original (Odoo): ${vat}${notes ? ` — ${notes}` : ""}`;
  } else if (vat) {
    taxId = vat;
  }
  const draft: PartnerDraft = {
    name,
    accountType,
    email: str(row.email),
    phone: str(row.phone),
    mobile: str(row.mobile),
    taxId,
    street1: str(row.street),
    street2: str(row.street2),
    city: str(row.city),
    zip: str(row.zip),
    website: str(row.website),
    jobTitle: str(row.function),
    reference: str(row.ref) ?? `odoo:res.partner/${odooId}`,
    notes,
  };
  return { partnerId: `prt_odoo_${odooId}`, draft };
}

// ── Categorías ──────────────────────────────────────────────────────

export function mapCategoryRow(row: Row): Mapped<{ categoryId: string; name: string; code: string }> {
  const odooId = str(row.id);
  const name = str(row.name);
  if (!odooId || !name) return { skip: true, reason: "incompleta" };
  return { categoryId: `cat_odoo_${odooId}`, name, code: `OD${odooId}` };
}

// ── Productos ───────────────────────────────────────────────────────

export function mapProductRow(
  row: Row,
  taxAmountsByTemplate: ReadonlyMap<string, readonly number[]>,
  uomNames: ReadonlyMap<string, string>,
  categoryNames: ReadonlyMap<string, string>,
): Mapped<{ productId: string; draft: ProductDraft }> {
  const odooId = str(row.id);
  if (!odooId) return { skip: true, reason: "sin_id" };
  if (row.active === "f") return { skip: true, reason: "inactivo" };
  const name = str(row.name);
  if (!name) return { skip: true, reason: "sin_nombre" };

  const taxAmounts = taxAmountsByTemplate.get(odooId) ?? [];
  // Con impuestos: la tasa positiva máxima (en GT es el IVA 12%); sin ellos o
  // todo exento: 0 explícito (nunca la tasa por defecto de settings).
  const positive = taxAmounts.filter((a) => a > 0);
  const taxRate = positive.length > 0 ? Math.max(...positive) : 0;

  const draft: ProductDraft = {
    name,
    salePrice: fromDecimal(str(row.list_price) ?? "0", GTQ),
    costPrice: str(row.standard_price) ? fromDecimal(str(row.standard_price)!, GTQ) : undefined,
    taxRate,
    unit: uomNames.get(str(row.uom_id) ?? "") ?? undefined,
    categoryName: categoryNames.get(str(row.categ_id) ?? "") ?? undefined,
    reference: str(row.default_code) ?? `odoo:product.template/${odooId}`,
  };
  return { productId: `prd_odoo_${odooId}`, draft };
}

// ── Facturas ────────────────────────────────────────────────────────

export interface PartnerRef {
  readonly name: string;
  readonly taxId?: string;
}

export function mapInvoiceMove(
  move: Row,
  lines: readonly Row[],
  taxAmountsByLine: ReadonlyMap<string, readonly number[]>,
  /** Clave: id de Odoo (res_partner.id), sin prefijo. */
  partners: ReadonlyMap<string, PartnerRef>,
  currencyNames: ReadonlyMap<string, string>,
): Mapped<{
  invoiceId: string;
  series: string;
  number: number;
  date: string;
  currency: CurrencyCode;
  lines: InvoiceLine[];
  partnerId: string;
  partnerName: string;
  partnerTaxId: string;
  notes?: string;
  odooTotalMinor: number | null;
}> {
  const odooId = str(move.id);
  if (!odooId) return { skip: true, reason: "sin_id" };
  if (move.move_type !== "out_invoice") return { skip: true, reason: `tipo_${move.move_type ?? "desconocido"}` };
  if (move.state !== "posted") return { skip: true, reason: `estado_${move.state ?? "desconocido"}` };
  const currency = currencyNames.get(str(move.currency_id) ?? "") ?? "GTQ";
  if (currency !== GTQ) return { skip: true, reason: `moneda_${currency}` };
  const date = str(move.invoice_date) ?? str(move.create_date)?.slice(0, 10);
  if (!date) return { skip: true, reason: "sin_fecha" };
  const partnerOdooId = str(move.partner_id);
  const partner = partnerOdooId ? partners.get(partnerOdooId) : undefined;
  if (!partnerOdooId || !partner) return { skip: true, reason: "partner_faltante" };

  const invoiceLines: InvoiceLine[] = [];
  for (const line of lines) {
    if (line.display_type !== "product") continue;
    const quantity = Number(line.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const taxAmounts = taxAmountsByLine.get(str(line.id) ?? "") ?? [];
    const positive = taxAmounts.filter((a) => a > 0);
    // Rango válido del dominio: 0-100. Un descuento corrupto (>100, negativo o
    // NaN) NO se propaga: la línea entra sin descuento y la diferencia con el
    // amount_total de Odoo queda evidenciada en withRoundingDiff/totalDiffMinor.
    const discountPercent = Number(line.discount ?? 0);
    const discount: LineDiscount | undefined =
      Number.isFinite(discountPercent) && discountPercent > 0 && discountPercent <= 100
        ? { percent: Math.round(discountPercent * 100) / 100 }
        : undefined;
    // `price_unit` de Odoo INCLUYE IVA (precio al consumidor, patrón GT). El
    // neto real de la línea está en `price_subtotal` (= qty × unit ×
    // (1 - disc) / (1 + tasa), redondeado por Odoo). Derivamos el unitPrice
    // base pre-descuento que el dominio reproduce exacto:
    //   qty × unitPrice × (1 - disc) = price_subtotal.
    const unitPrice = netUnitPrice(line, quantity, discountPercent);
    invoiceLines.push({
      description: str(line.name) ?? "(sin descripción)",
      quantity,
      unitPrice,
      taxRate: positive.length > 0 ? Math.max(...positive) : 0,
      discount,
      productId: str(line.product_id) ? `prd_odoo_${str(line.product_id)}` : undefined,
    });
  }
  if (invoiceLines.length === 0) return { skip: true, reason: "sin_lineas" };

  const odooTotal = str(move.amount_total);
  const odooNumber = Number(odooTotal);
  return {
    invoiceId: `inv_odoo_${odooId}`,
    series: ODOO_SERIES,
    number: Number(odooId),
    date,
    currency: GTQ,
    lines: invoiceLines,
    partnerId: `prt_odoo_${partnerOdooId}`,
    partnerName: partner.name,
    partnerTaxId: partner.taxId ?? "CF",
    notes: `Importado de Odoo (account.move ${odooId}${str(move.name) ? `, ${str(move.name)}` : ""})`,
    odooTotalMinor: Number.isFinite(odooNumber) ? Math.round(odooNumber * 100) : null,
  };
}

// ── Orquestador ─────────────────────────────────────────────────────

export interface DeloaltoTables {
  readonly product_category: readonly Row[];
  readonly uom_uom: readonly Row[];
  readonly res_partner: readonly Row[];
  readonly product_template: readonly Row[];
  readonly product_taxes_rel: readonly Row[];
  readonly account_tax: readonly Row[];
  readonly res_currency: readonly Row[];
  readonly account_move: readonly Row[];
  readonly account_move_line: readonly Row[];
  readonly account_move_line_account_tax_rel: readonly Row[];
}

function instantFor(date: string | undefined, fallback: string): string {
  const d = date?.slice(0, 10);
  return `${d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : fallback}T12:00:00.000Z`;
}

class Counter {
  readonly skipped = new Map<string, number>();
  bump(reason: string): void {
    this.skipped.set(reason, (this.skipped.get(reason) ?? 0) + 1);
  }
  report(imported: number): DomainReport {
    return { imported, skipped: this.skipped };
  }
}

/**
 * Construye los eventos completos del import (categorías → productos →
 * partners → facturas, en ese orden para que el replay sea limpio) y los
 * valida con una proyección en memoria: los eventos que el dominio rechaza
 * NO se devuelven (van al reporte) para no ensuciar el journal.
 */
export function buildDeloaltoEvents(tables: DeloaltoTables): DeloaltoImport {
  const events: AnyEvent[] = [];

  // Catálogos auxiliares
  const uomNames = new Map(tables.uom_uom.map((r) => [str(r.id) ?? "", str(r.name) ?? ""]));
  const categoryNames = new Map(
    tables.product_category.map((r) => [str(r.id) ?? "", str(r.complete_name) ?? str(r.name) ?? ""]),
  );
  const taxAmounts = new Map(tables.account_tax.map((r) => [str(r.id) ?? "", Number(r.amount ?? 0)]));
  const currencyNames = new Map(tables.res_currency.map((r) => [str(r.id) ?? "", str(r.name) ?? ""]));

  // 1) Categorías
  const catCounter = new Counter();
  let catCount = 0;
  for (const row of tables.product_category) {
    const m = mapCategoryRow(row);
    if (isSkip(m)) {
      catCounter.bump(m.reason);
      continue;
    }
    catCount++;
    events.push({
      id: `evt_imp_cat_${m.categoryId}`,
      at: instantFor(str(row.create_date), "2026-06-16"),
      v: 1,
      type: "category.created",
      payload: { categoryId: m.categoryId, name: m.name, code: m.code },
    } as AnyEvent);
  }

  // 2) Productos
  const taxesByTemplate = new Map<string, number[]>();
  for (const rel of tables.product_taxes_rel) {
    const tmpl = str(rel.product_tmpl_id);
    const tax = str(rel.tax_id);
    if (!tmpl || !tax) continue;
    const amount = taxAmounts.get(tax);
    if (amount === undefined) continue;
    const list = taxesByTemplate.get(tmpl) ?? [];
    list.push(amount);
    taxesByTemplate.set(tmpl, list);
  }
  const prodCounter = new Counter();
  let prodCount = 0;
  for (const row of tables.product_template) {
    const m = mapProductRow(row, taxesByTemplate, uomNames, categoryNames);
    if (isSkip(m)) {
      prodCounter.bump(m.reason);
      continue;
    }
    prodCount++;
    events.push({
      id: `evt_imp_prd_${m.productId}`,
      at: instantFor(str(row.create_date), "2026-06-16"),
      v: 1,
      type: "product.created",
      payload: { productId: m.productId, ...m.draft },
    } as AnyEvent);
  }

  // 3) Partners
  const partCounter = new Counter();
  let partCount = 0;
  let taxIdKept = 0;
  let taxIdPreserved = 0;
  let emptyVat = 0;
  let cfCount = 0;
  /** Clave: id de Odoo crudo (para resolver move.partner_id). */
  const partnerRefs = new Map<string, PartnerRef>();
  for (const row of tables.res_partner) {
    const m = mapPartnerRow(row);
    if (isSkip(m)) {
      partCounter.bump(m.reason);
      continue;
    }
    partCount++;
    const vat = str(row.vat);
    if (!vat) emptyVat++;
    else if (vat.toUpperCase() === "CF") cfCount++;
    else if (m.draft.taxId) taxIdKept++;
    else taxIdPreserved++;
    const odooId = str(row.id)!;
    partnerRefs.set(odooId, { name: m.draft.name, taxId: m.draft.taxId });
    events.push({
      id: `evt_imp_prt_${m.partnerId}`,
      at: instantFor(str(row.create_date), "2026-06-16"),
      v: 1,
      type: "partner.created",
      payload: { partnerId: m.partnerId, ...m.draft },
    } as AnyEvent);
  }

  // 4) Facturas (solo out_invoice posted en GTQ; partner siempre resuelto)
  const linesByMove = new Map<string, Row[]>();
  for (const line of tables.account_move_line) {
    const moveId = str(line.move_id);
    if (!moveId) continue;
    const list = linesByMove.get(moveId) ?? [];
    list.push(line);
    linesByMove.set(moveId, list);
  }
  const taxesByLine = new Map<string, number[]>();
  for (const rel of tables.account_move_line_account_tax_rel) {
    const lineId = str(rel.account_move_line_id);
    const taxId = str(rel.account_tax_id);
    if (!lineId || !taxId) continue;
    const amount = taxAmounts.get(taxId);
    if (amount === undefined) continue;
    const list = taxesByLine.get(lineId) ?? [];
    list.push(amount);
    taxesByLine.set(lineId, list);
  }
  const invCounter = new Counter();
  let invCount = 0;
  let totalDiffMinor = 0;
  let invoicesWithDiff = 0;
  for (const move of tables.account_move) {
    const m = mapInvoiceMove(
      move,
      linesByMove.get(str(move.id) ?? "") ?? [],
      taxesByLine,
      partnerRefs,
      currencyNames,
    );
    if (isSkip(m)) {
      invCounter.bump(m.reason);
      continue;
    }
    invCount++;
    if (m.odooTotalMinor !== null) {
      const computed = computeInvoiceTotals(m.lines, m.currency).total.minor;
      if (computed !== m.odooTotalMinor) {
        totalDiffMinor += computed - m.odooTotalMinor;
        invoicesWithDiff++;
      }
    }
    events.push({
      id: `evt_imp_inv_${m.invoiceId}`,
      at: `${m.date}T12:00:00.000Z`,
      v: 1,
      type: "invoice.issued",
      payload: {
        invoiceId: m.invoiceId,
        series: m.series,
        number: m.number,
        date: m.date,
        currency: m.currency,
        lines: m.lines,
        totals: totalsSnapshot(computeInvoiceTotals(m.lines, m.currency)),
        partnerId: m.partnerId,
        partnerName: m.partnerName,
        partnerTaxId: m.partnerTaxId,
        notes: m.notes,
      },
    } as AnyEvent);
  }

  // Pre-vuelo: solo eventos que el dominio acepta. Los rechazados van al reporte.
  const { rejected } = project(events);
  const rejectedIds = new Set(rejected.map((r) => (r.event as { id?: string }).id));
  const accepted = rejectedIds.size === 0 ? events : events.filter((e) => !rejectedIds.has(e.id));
  const rejectedDetail = rejected.map((r) => ({
    type: (r.event as { type?: string }).type ?? "?",
    code: r.code,
    reason: r.reason,
  }));

  return {
    events: accepted,
    categories: catCounter.report(catCount),
    products: prodCounter.report(prodCount),
    partners: { ...partCounter.report(partCount), taxIdKept, taxIdPreserved, emptyVat, cfCount },
    invoices: { ...invCounter.report(invCount), withRoundingDiff: invoicesWithDiff },
    totalDiffMinor,
    rejected: rejectedDetail,
  };
}
