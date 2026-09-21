import { describe, expect, it } from "vitest";
import { buildDeloaltoEvents, type DeloaltoTables } from "../src/import/deloalto.js";
import type { Row } from "../src/import/copy.js";

const r = (vals: Record<string, string | null | undefined>): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(vals)) out[k] = v ?? null;
  return out;
};

/**
 * Dump DeLoAlto real (2026-06-16) contenía una línea de factura con
 * `discount = 400` (400%). El dominio solo acepta 0-100; el mapper lo pasaba
 * tal cual y buildDeloaltoEvents crasheaba con DomainError en el total.
 * Regresión: el descuento corrupto debe ignorarse (evidencia en
 * withRoundingDiff/totalDiffMinor), no reventar el import ni saltar la línea.
 */
describe("buildDeloaltoEvents — descuento corrupto en línea de factura", () => {
  const baseTables = (): DeloaltoTables => ({
    product_category: [r({ id: "1", complete_name: "Servicios", name: "Servicios", create_date: "2025-01-01" })],
    uom_uom: [r({ id: "1", name: "Unidad(s)" })],
    res_partner: [
      r({
        id: "10",
        name: "Cliente GT",
        is_company: "t",
        parent_id: null,
        vat: "123456789",
        comment: null,
        email: null,
        phone: null,
        mobile: null,
        street: null,
        street2: null,
        city: null,
        zip: null,
        website: null,
        function: null,
        ref: null,
        create_date: "2025-01-01",
      }),
    ],
    product_template: [
      r({ id: "100", name: "Servicio", active: "t", list_price: "1000.00", standard_price: "0", uom_id: "1", categ_id: "1", default_code: null, create_date: "2025-01-01" }),
    ],
    product_taxes_rel: [],
    account_tax: [],
    res_currency: [r({ id: "1", name: "GTQ" })],
    account_move: [
      r({ id: "500", move_type: "out_invoice", state: "posted", currency_id: "1", invoice_date: "2025-06-01", create_date: "2025-06-01", partner_id: "10", amount_total: "880.00", name: "INV/2025/0001" }),
    ],
    account_move_line: [
      r({ id: "5001", move_id: "500", display_type: "product", quantity: "1", price_unit: "1000.00", discount: "400", name: "Línea con descuento corrupto", product_id: "100", tax_ids: null }),
    ],
    account_move_line_account_tax_rel: [],
  });

  it("no crashea con descuento > 100 y conserva la línea sin descuento", () => {
    const result = buildDeloaltoEvents(baseTables());
    expect(result.rejected.length).toBe(0);
    expect(result.events.filter((e) => e.type === "invoice.issued").length).toBe(1);
    const invoice = result.events.find((e) => e.type === "invoice.issued");
    expect(invoice && invoice.payload.lines.length).toBe(1);
    expect(invoice && invoice.payload.lines[0].discount).toBeUndefined();
  });

  it("ignora descuentos negativos", () => {
    const tables = baseTables();
    tables.account_move_line = [
      r({ id: "5001", move_id: "500", display_type: "product", quantity: "1", price_unit: "1000.00", discount: "-25", name: "Línea desc -25", product_id: "100", tax_ids: null }),
    ];
    const result = buildDeloaltoEvents(tables);
    const invoice = result.events.find((e) => e.type === "invoice.issued");
    expect(invoice && invoice.payload.lines[0].discount).toBeUndefined();
  });

  it("mantiene descuentos válidos (10%)", () => {
    const tables = baseTables();
    tables.account_move_line = [
      r({ id: "5001", move_id: "500", display_type: "product", quantity: "1", price_unit: "1000.00", discount: "10", name: "Línea desc 10", product_id: "100", tax_ids: null }),
    ];
    tables.account_move = [
      r({ id: "500", move_type: "out_invoice", state: "posted", currency_id: "1", invoice_date: "2025-06-01", create_date: "2025-06-01", partner_id: "10", amount_total: "900.00", name: "INV/2025/0001" }),
    ];
    const result = buildDeloaltoEvents(tables);
    const invoice = result.events.find((e) => e.type === "invoice.issued");
    expect(invoice && invoice.payload.lines[0].discount).toEqual({ percent: 10 });
  });
});

/**
 * Dump DeLoAlto real (2026-06-16): `price_unit` de Odoo INCLUYE el IVA
 * (precio al consumidor). Línea real: qty=24, price_unit=1.75 (bruto 42.00),
 * price_subtotal=37.50 (= 42/1.12). El mapper trataba price_unit como neto y
 * le sumaba 12% encima → IVA duplicado en TODAS las facturas (61,010 de
 * 61,017 con diff, total 763M centavos). Regresión: el unitPrice debe
 * derivarse del price_subtotal (neto real de Odoo), no de price_unit.
 */
describe("buildDeloaltoEvents — price_unit de Odoo incluye IVA", () => {
  const baseTables = (): DeloaltoTables => ({
    product_category: [r({ id: "1", complete_name: "Productos", name: "Productos", create_date: "2025-01-01" })],
    uom_uom: [r({ id: "1", name: "Unidad(s)" })],
    res_partner: [
      r({
        id: "10",
        name: "Cliente GT",
        is_company: "t",
        parent_id: null,
        vat: "123456789",
        comment: null,
        email: null,
        phone: null,
        mobile: null,
        street: null,
        street2: null,
        city: null,
        zip: null,
        website: null,
        function: null,
        ref: null,
        create_date: "2025-01-01",
      }),
    ],
    product_template: [
      r({ id: "100", name: "Producto", active: "t", list_price: "1.75", standard_price: "0", uom_id: "1", categ_id: "1", default_code: null, create_date: "2025-01-01" }),
    ],
    product_taxes_rel: [],
    account_tax: [r({ id: "1", amount: "12.0000", amount_type: "percent", name: "12% Ventas" })],
    res_currency: [r({ id: "1", name: "GTQ" })],
    account_move: [
      r({ id: "500", move_type: "out_invoice", state: "posted", currency_id: "1", invoice_date: "2025-06-01", create_date: "2025-06-01", partner_id: "10", amount_total: "42.00", name: "INV/2025/0001" }),
    ],
    account_move_line: [
      r({ id: "5001", move_id: "500", display_type: "product", quantity: "24", price_unit: "1.75", discount: null, name: "24 uds a 1.75 (bruto 42.00)", product_id: "100", price_subtotal: "37.50", tax_ids: null }),
    ],
    account_move_line_account_tax_rel: [r({ account_move_line_id: "5001", account_tax_id: "1" })],
  });

  it("deriva el unitPrice neto desde price_subtotal (no duplica IVA)", () => {
    const result = buildDeloaltoEvents(baseTables());
    expect(result.rejected.length).toBe(0);
    const invoice = result.events.find((e) => e.type === "invoice.issued");
    expect(invoice && invoice.payload.lines.length).toBe(1);
    const line = invoice && invoice.payload.lines[0];
    if (!line) throw new Error("sin línea");
    // 37.50/24 = 1.5625 → 1.56 (HALF-UP a centavos). NO 1.75.
    expect(line.unitPrice.minor).toBe(156);
    expect(line.unitPrice.minor).not.toBe(175);
    // El total de la factura queda MUY cerca de 42.00 (diff = redondeo de
    // centavos por línea), no inflado por IVA duplicado.
    expect(Math.abs(result.totalDiffMinor)).toBeLessThan(1000);
  });

  it("con descuento, el unitPrice refleja la base neta pre-descuento", () => {
    const tables = baseTables();
    tables.account_move_line = [
      r({ id: "5001", move_id: "500", display_type: "product", quantity: "2", price_unit: "28.00", discount: "10", name: "2 uds bruto 56 con 10%", product_id: "100", price_subtotal: "45.00", tax_ids: null }),
    ];
    tables.account_tax = [r({ id: "1", amount: "12.0000", amount_type: "percent", name: "12% Ventas" })];
    tables.account_move = [
      r({ id: "500", move_type: "out_invoice", state: "posted", currency_id: "1", invoice_date: "2025-06-01", create_date: "2025-06-01", partner_id: "10", amount_total: "50.40", name: "INV/2025/0001" }),
    ];
    const result = buildDeloaltoEvents(tables);
    const invoice = result.events.find((e) => e.type === "invoice.issued");
    const line = invoice && invoice.payload.lines[0];
    if (!line) throw new Error("sin línea");
    // Base neta sin descuento = subtotal / (qty × (1-disc)) = 4500/(2×0.9) = 2500.
    // unitPrice = 25.00; el dominio aplica 10% → subtotal 45.00.
    expect(line.unitPrice.minor).toBe(2500);
    expect(Math.abs(result.totalDiffMinor)).toBeLessThan(1000);
  });
});