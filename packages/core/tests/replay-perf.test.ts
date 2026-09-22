/**
 * Regresión de performance (2026-09-15): la proyección del journal era O(n²)
 * porque el chequeo de correlativo duplicado en `invoice.issued` escaneaba
 * TODAS las facturas por cada factura emitida (store.ts:419). Con journals de
 * escala real (DeLoAlto: decenas de miles de documentos) el replay tardaba
 * minutos; el arranque del plugin quedaba inusable.
 *
 * Este test fija el presupuesto: 6.000 facturas deben proyectar en < 5s.
 * Antes del fix: ~30-60s (crece cuadrático). Después: < 1s.
 */
import { describe, expect, it } from "vitest";
import { computeInvoiceTotals, fromDecimal, project, totalsSnapshot, type AnyEvent } from "../src/index.js";

const q = (v: string) => fromDecimal(v, "GTQ");

describe("Replay lineal (regresión O(n²) en invoice.issued)", () => {
  it("proyecta 6.000 facturas en menos de 5 segundos", () => {
    const events: AnyEvent[] = [];
    for (let i = 1; i <= 6000; i++) {
      const lines = [
        { description: "Item A", quantity: 2, unitPrice: q("50.00"), taxRate: 12 },
        { description: "Item B", quantity: 1, unitPrice: q("120.00"), taxRate: 0 },
      ];
      events.push({
        id: `perf${i}`,
        at: "2026-09-15T12:00:00.000Z",
        v: 1,
        type: "invoice.issued",
        payload: {
          invoiceId: `inv_perf_${i}`,
          series: "A",
          number: i,
          date: "2026-09-15",
          currency: "GTQ",
          lines,
          totals: totalsSnapshot(computeInvoiceTotals(lines, "GTQ")),
          partnerName: "Cliente Perf",
          partnerTaxId: "CF",
        },
      } as AnyEvent);
    }
    const t0 = performance.now();
    const { state, rejected } = project(events);
    const elapsed = performance.now() - t0;
    expect(rejected).toHaveLength(0);
    expect(state.invoices.size).toBe(6000);
    expect(elapsed).toBeLessThan(5000);
  });

  it("rechaza correlativo duplicado con el mismo mensaje de siempre", () => {
    const mkEvent = (invoiceId: string, number: number): AnyEvent => {
      const lines = [{ description: "Item", quantity: 1, unitPrice: q("10.00"), taxRate: 0 }];
      return {
        id: invoiceId,
        at: "2026-09-15T12:00:00.000Z",
        v: 1,
        type: "invoice.issued",
        payload: {
          invoiceId,
          series: "A",
          number,
          date: "2026-09-15",
          currency: "GTQ",
          lines,
          totals: totalsSnapshot(computeInvoiceTotals(lines, "GTQ")),
          partnerName: "Cliente",
          partnerTaxId: "CF",
        },
      } as AnyEvent;
    };
    const { rejected } = project([mkEvent("inv_ok", 1), mkEvent("inv_dup", 1)]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.code).toBe("number_taken");
    expect(rejected[0]!.reason).toContain("ya lo usa inv_ok");
  });
});
