import { describe, expect, it } from "vitest";
import {
  activePartners,
  activeProducts,
  findProductByReference,
  fromDecimal,
  grossMarginPercent,
  invoiceCountForPartner,
  markupRatio,
  project,
  validateProductDraft,
  type AnyEvent,
} from "../src/index.js";

let seq = 0;
const evt = (type: AnyEvent["type"], payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: "2026-08-25T12:00:00.000Z", v: 1, type, payload } as AnyEvent);

const q = (v: string) => fromDecimal(v, "GTQ");

describe("Margen bruto", () => {
  it("calcula el margen real, no el multiplicador", () => {
    // El caso que la plantilla RetailOS reporta como 1.25.
    expect(grossMarginPercent(q("100.00"), q("80.00"))).toBeCloseTo(20, 6);
    expect(markupRatio(q("100.00"), q("80.00"))).toBeCloseTo(1.25, 6);
  });

  it("da margen negativo cuando se vende bajo costo", () => {
    expect(grossMarginPercent(q("80.00"), q("100.00"))).toBeCloseTo(-25, 6);
  });

  it("no divide por cero", () => {
    expect(markupRatio(q("100.00"), q("0"))).toBeNull();
    expect(grossMarginPercent(q("0"), q("80.00"))).toBeNull();
  });

  it("no calcula nada sin costo ni cruzando monedas", () => {
    expect(grossMarginPercent(q("100.00"), undefined)).toBeNull();
    expect(grossMarginPercent(q("100.00"), fromDecimal("80.00", "USD"))).toBeNull();
  });

  it("margen cero cuando el precio es el costo", () => {
    expect(grossMarginPercent(q("50.00"), q("50.00"))).toBe(0);
  });
});

describe("Validación de producto", () => {
  it("acepta lo mínimo", () => {
    expect(validateProductDraft({ name: "Arepa de queso", salePrice: q("15.00") })).toEqual([]);
  });

  it("rechaza nombre vacío, precio negativo y tasa fuera de rango", () => {
    expect(validateProductDraft({ salePrice: q("1.00") }).map((e) => e.code)).toEqual(["product.name_required"]);
    expect(validateProductDraft({ name: "X", salePrice: q("-1.00") }).map((e) => e.code)).toEqual([
      "product.price_negative",
    ]);
    expect(validateProductDraft({ name: "X", salePrice: q("1.00"), taxRate: 120 }).map((e) => e.code)).toEqual([
      "product.tax_rate_invalid",
    ]);
  });
});

describe("Consultas de listas", () => {
  const base = [
    evt("partner.created", { partnerId: "p2", name: "Zapatería Luna", accountType: "company" }),
    evt("partner.created", { partnerId: "p1", name: "Ábaco S.A.", accountType: "company" }),
    evt("product.created", { productId: "pr1", name: "Café", salePrice: q("25.00"), reference: "CAF-01" }),
    evt("product.created", { productId: "pr2", name: "Azúcar", salePrice: q("10.00"), reference: "AZU-01" }),
  ];

  it("ordena por nombre respetando acentos del español", () => {
    const { state } = project(base);
    expect(activePartners(state).map((p) => p.name)).toEqual(["Ábaco S.A.", "Zapatería Luna"]);
    expect(activeProducts(state).map((p) => p.name)).toEqual(["Azúcar", "Café"]);
  });

  it("excluye archivados", () => {
    const { state } = project([...base, evt("partner.archived", { partnerId: "p1" })]);
    expect(activePartners(state).map((p) => p.id)).toEqual(["p2"]);
  });

  it("detecta referencia de producto duplicada, ignorando caso y espacios", () => {
    const { state } = project(base);
    expect(findProductByReference(state, " caf-01 ")?.id).toBe("pr1");
    expect(findProductByReference(state, "CAF-01", "pr1")).toBeUndefined();
    expect(findProductByReference(state, "")).toBeUndefined();
    expect(findProductByReference(state, "NO-EXISTE")).toBeUndefined();
  });

  it("cuenta los documentos de un contacto antes de archivarlo", () => {
    const { state } = project(base);
    expect(invoiceCountForPartner(state, "p1")).toBe(0);
  });
});
