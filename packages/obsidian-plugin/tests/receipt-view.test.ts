/**
 * Regresión — Recibo de pago consistente con la factura cuando hay descuentos.
 *
 * Bug real (auditoría 2026-09-13): receipt-view recalculaba cada línea a mano
 * (`unitPrice × qty`, IVA sobre la base bruta) ignorando `line.discount`, así
 * que toda factura con descuento imprimía un recibo cuyas líneas y total
 * (Q224.00 en el fixture) no cuadraban con lo realmente cobrado según
 * `invoice.totals` (Q201.60). El recibo se entrega al cliente como comprobante
 * de pago: debe mostrar la base neta, el descuento y el IVA sobre la base neta,
 * exactamente como la factura (misma función: computeLineTotals).
 */
import { describe, expect, it } from "vitest";
import { computeInvoiceTotals, fromDecimal, project, totalsSnapshot } from "@octasuite/core";
import type { AnyEvent, Invoice } from "@octasuite/core";
import { ReceiptView } from "../src/ui/receipt-view.js";
import { FakeNode, installFakeDocument, serialize } from "./dom-stub.js";

installFakeDocument();

let seq = 0;
const evt = (type: AnyEvent["type"], payload: unknown): AnyEvent =>
  ({ id: `rv${++seq}`, at: "2026-09-13T12:00:00.000Z", v: 1, type, payload } as AnyEvent);

/** Factura pagada: 2 × Q100.00 con 10% de descuento e IVA 12%. */
function paidInvoiceWithDiscount(): Invoice {
  const lines = [
    {
      description: "Producto A",
      quantity: 2,
      unitPrice: fromDecimal("100.00", "GTQ"),
      taxRate: 12,
      discount: { percent: 10 },
    },
  ];
  const { state } = project([
    evt("invoice.issued", {
      invoiceId: "inv_rv",
      series: "A",
      number: 1,
      date: "2026-09-13",
      currency: "GTQ",
      lines,
      totals: totalsSnapshot(computeInvoiceTotals(lines, "GTQ")),
      partnerName: "Cliente Test",
      partnerTaxId: "CF",
    }),
    evt("invoice.paid", { invoiceId: "inv_rv", paymentMethod: "Efectivo" }),
  ]);
  return state.invoices.get("inv_rv")!;
}

function renderReceipt(invoice: Invoice): string {
  const root = new FakeNode("root");
  const view = Object.create(ReceiptView.prototype) as ReceiptView & {
    contentEl: FakeNode;
    host: unknown;
    invoice: Invoice | null;
    app: unknown;
    leaf: unknown;
  };
  view.contentEl = root;
  view.invoice = invoice;
  view.app = { workspace: { rootSplit: {} } };
  view.leaf = { getRoot: () => ({}) };
  view.host = {
    state: project([]).state,
    settings: {
      currency: "GTQ",
      locale: "es-GT",
      companyName: "",
      companyTaxId: "",
      companyAddress: "",
      companyPhone: "",
      companyEmail: "",
      companyLogo: "",
      receiptFooter: "",
    },
    activeCompanyIds: ["principal"],
    openHome: () => {},
    expandToMain: () => {},
  } as never;
  (view as unknown as { render(): void }).render();
  return serialize(root);
}

describe("Recibo de pago con descuentos (ReceiptView.render)", () => {
  it("muestra base neta, descuento e IVA sobre la base neta como la factura", () => {
    const html = renderReceipt(paidInvoiceWithDiscount());
    // El descuento es visible (columna o nota): Q20.00 sobre base Q200.00
    expect(html).toContain("Descuento");
    expect(html).toContain("20.00");
    // IVA sobre base neta: 12% de 180.00 = 21.60 (no 24.00 sobre la bruta)
    expect(html).toContain("21.60");
    expect(html).not.toContain("24.00");
  });

  it("el total del recibo cuadra con invoice.totals (lo cobrado), no con la base bruta", () => {
    const html = renderReceipt(paidInvoiceWithDiscount());
    expect(html).toContain("201.60"); // 180.00 + 21.60
    expect(html).not.toContain("224.00"); // 200.00 + 24.00 — el total erróneo del bug
  });
});
