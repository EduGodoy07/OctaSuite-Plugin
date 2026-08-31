import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  choicesFor,
  explodeLine,
  explodeToStockable,
  isConfigurable,
  fromDecimal,
  isKit,
  negativeStock,
  paidReceipts,
  project,
  purchaseAverageCost,
  receiptTotal,
  unpaidReceipts,
  stockLevels,
  stockOf,
  totalsSnapshot,
  validateComponents,
  validateSelections,
  type AnyEvent,
  type InvoiceLine,
  type Product,
} from "../src/index.js";

let seq = 0;
const evt = (type: AnyEvent["type"], payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: "2026-08-25T12:00:00.000Z", v: 1, type, payload } as AnyEvent);

const q = (v: string) => fromDecimal(v, "GTQ");

const producto = (id: string, name: string, price: string, components?: { productId: string; quantity: number }[]) =>
  evt("product.created", {
    productId: id,
    name,
    salePrice: q(price),
    ...(components ? { components } : {}),
  });

/** Menú de referencia: ingredientes almacenables + un combo con receta. */
const menu = [
  producto("pan", "Pan de hot dog", "2.00"),
  producto("chorizo", "Chorizo", "8.00"),
  producto("papas", "Papas fritas", "10.00"),
  producto("bebida", "Bebida", "8.00"),
  producto("hd_chorizo", "Hot dog de chorizo", "20.00", [
    { productId: "pan", quantity: 1 },
    { productId: "chorizo", quantity: 1 },
  ]),
  producto("combo_chorizo", "Combo hot dog de chorizo", "35.00", [
    { productId: "hd_chorizo", quantity: 1 },
    { productId: "papas", quantity: 1 },
    { productId: "bebida", quantity: 1 },
  ]),
];

const venta = (invoiceId: string, number: number, productId: string, quantity: number, price: string) => {
  const lines: InvoiceLine[] = [
    { description: "venta", quantity, unitPrice: q(price), taxRate: 12, productId },
  ];
  return evt("invoice.issued", {
    invoiceId,
    series: "A",
    number,
    date: "2026-08-25",
    currency: "GTQ",
    lines,
    totals: totalsSnapshot(computeInvoiceTotals(lines, "GTQ")),
    partnerName: "Consumidor final",
    partnerTaxId: "CF",
  });
};

const entrada = (receiptId: string, lines: { productId: string; quantity: number; unitCost: string }[]) =>
  evt("stock.received", {
    receiptId,
    date: "2026-08-20",
    partnerName: "Proveedor",
    lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: q(l.unitCost) })),
  });

describe("Explosión de recetas", () => {
  const products = new Map<string, Product>();
  const { state } = project(menu);
  for (const [id, p] of state.products) products.set(id, p);

  it("un producto sin receta se resuelve a sí mismo", () => {
    expect([...explodeToStockable(products, "pan", 3)]).toEqual([["pan", 3]]);
  });

  it("un combo se resuelve a sus componentes almacenables, bajando niveles", () => {
    const exploded = explodeToStockable(products, "combo_chorizo", 2);
    // combo → hot dog (pan + chorizo) + papas + bebida
    expect(Object.fromEntries(exploded)).toEqual({ pan: 2, chorizo: 2, papas: 2, bebida: 2 });
  });

  it("multiplica cantidades anidadas", () => {
    const products2 = new Map(products);
    products2.set("caja", {
      ...products2.get("combo_chorizo")!,
      id: "caja",
      name: "Caja de 6 combos",
      components: [{ productId: "combo_chorizo", quantity: 6 }],
    });
    expect(explodeToStockable(products2, "caja", 2).get("chorizo")).toBe(12);
  });

  it("detecta recetas circulares en vez de colgarse", () => {
    const products2 = new Map(products);
    products2.set("a", { ...products2.get("pan")!, id: "a", components: [{ productId: "b", quantity: 1 }] });
    products2.set("b", { ...products2.get("pan")!, id: "b", components: [{ productId: "a", quantity: 1 }] });
    expect(() => explodeToStockable(products2, "a", 1)).toThrow(/circular/);
  });

  it("un producto desconocido cuenta como almacenable", () => {
    expect([...explodeToStockable(products, "borrado", 5)]).toEqual([["borrado", 5]]);
  });

  it("distingue combo de producto simple", () => {
    expect(isKit(products.get("combo_chorizo")!)).toBe(true);
    expect(isKit(products.get("pan")!)).toBe(false);
  });
});

describe("Validación de receta", () => {
  const { state } = project(menu);

  it("acepta una receta correcta", () => {
    expect(
      validateComponents(state.products, "nuevo", [
        { productId: "pan", quantity: 1 },
        { productId: "chorizo", quantity: 2 },
      ]),
    ).toEqual([]);
  });

  it("rechaza que un combo se contenga a sí mismo", () => {
    expect(validateComponents(state.products, "combo_chorizo", [{ productId: "combo_chorizo", quantity: 1 }])).toEqual([
      "Un combo no puede contenerse a sí mismo",
    ]);
  });

  it("rechaza componentes repetidos, cantidades inválidas e inexistentes", () => {
    const problems = validateComponents(state.products, "nuevo", [
      { productId: "pan", quantity: 1 },
      { productId: "pan", quantity: 1 },
      { productId: "chorizo", quantity: 0 },
      { productId: "fantasma", quantity: 1 },
    ]);
    expect(problems.some((p) => p.includes("repetido"))).toBe(true);
    expect(problems.some((p) => p.includes("Cantidad inválida"))).toBe(true);
    expect(problems.some((p) => p.includes("no existe"))).toBe(true);
  });

  it("detecta el ciclo indirecto: A contiene B y B ya contiene A", () => {
    // combo_chorizo contiene hd_chorizo; meterle combo_chorizo a hd_chorizo cierra el ciclo.
    const problems = validateComponents(state.products, "hd_chorizo", [{ productId: "combo_chorizo", quantity: 1 }]);
    expect(problems.some((p) => p.includes("circular"))).toBe(true);
  });
});

describe("Existencias derivadas", () => {
  it("entradas menos ventas explotadas", () => {
    const { state, rejected } = project([
      ...menu,
      entrada("r1", [
        { productId: "pan", quantity: 100, unitCost: "1.50" },
        { productId: "chorizo", quantity: 50, unitCost: "6.00" },
        { productId: "papas", quantity: 40, unitCost: "5.00" },
        { productId: "bebida", quantity: 60, unitCost: "4.00" },
      ]),
      venta("i1", 1, "combo_chorizo", 3, "35.00"),
      venta("i2", 2, "hd_chorizo", 2, "20.00"),
    ]);
    expect(rejected).toEqual([]);

    // 3 combos + 2 hot dogs = 5 panes y 5 chorizos; papas y bebida solo del combo.
    expect(stockOf(state, "pan")).toBe(95);
    expect(stockOf(state, "chorizo")).toBe(45);
    expect(stockOf(state, "papas")).toBe(37);
    expect(stockOf(state, "bebida")).toBe(57);
  });

  it("un combo no tiene existencia propia", () => {
    const { state } = project([...menu, venta("i1", 1, "combo_chorizo", 1, "35.00")]);
    expect(stockOf(state, "combo_chorizo")).toBeNull();
    expect(stockLevels(state).has("combo_chorizo")).toBe(false);
  });

  it("los ajustes suman y restan, y el negativo se reporta", () => {
    const { state } = project([
      ...menu,
      entrada("r1", [{ productId: "papas", quantity: 10, unitCost: "5.00" }]),
      evt("stock.adjusted", {
        adjustmentId: "a1",
        date: "2026-08-25",
        productId: "papas",
        quantity: -12,
        reason: "Merma",
      }),
    ]);
    expect(stockOf(state, "papas")).toBe(-2);
    expect(negativeStock(state).map((l) => l.productId)).toEqual(["papas"]);
  });

  it("la nota de crédito NO devuelve existencia", () => {
    const { state } = project([
      ...menu,
      entrada("r1", [{ productId: "papas", quantity: 10, unitCost: "5.00" }]),
      venta("i1", 1, "papas", 4, "10.00"),
      evt("invoice.credited", {
        creditNoteId: "cn1",
        invoiceId: "i1",
        date: "2026-08-25",
        amount: q("44.80"),
        reason: "Anulación",
      }),
    ]);
    // La plata se corrigió, la mercadería no volvió sola.
    expect(stockOf(state, "papas")).toBe(6);
  });

  it("rechaza entradas y ajustes imposibles sin abortar la carga", () => {
    const { rejected } = project([
      ...menu,
      entrada("r1", [{ productId: "fantasma", quantity: 5, unitCost: "1.00" }]),
      evt("stock.adjusted", { adjustmentId: "a1", date: "2026-08-25", productId: "pan", quantity: 0, reason: "Merma" }),
      evt("stock.adjusted", { adjustmentId: "a2", date: "2026-08-25", productId: "pan", quantity: -1, reason: "  " }),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["not_found", "bad_quantity", "no_reason"]);
  });
});

describe("Costos de compra", () => {
  it("promedia ponderando por cantidad", () => {
    const { state } = project([
      ...menu,
      entrada("r1", [{ productId: "chorizo", quantity: 10, unitCost: "6.00" }]),
      entrada("r2", [{ productId: "chorizo", quantity: 30, unitCost: "7.00" }]),
    ]);
    // (10×6 + 30×7) / 40 = 6.75
    expect(purchaseAverageCost(state, "chorizo", "GTQ")?.minor).toBe(675);
  });

  it("devuelve null si nunca se compró", () => {
    const { state } = project(menu);
    expect(purchaseAverageCost(state, "chorizo", "GTQ")).toBeNull();
  });

  it("totaliza una entrada", () => {
    const { state } = project([
      ...menu,
      entrada("r1", [
        { productId: "pan", quantity: 100, unitCost: "1.50" },
        { productId: "chorizo", quantity: 50, unitCost: "6.00" },
      ]),
    ]);
    // 100×1.50 + 50×6.00 = 450.00
    expect(receiptTotal(state.receipts.get("r1")!, "GTQ").minor).toBe(45000);
  });
});

// ---------------------------------------------------------------------------
// Productos configurables: el SKU fija cuántas carnes y el precio; cuál carne
// se elige al vender.
// ---------------------------------------------------------------------------

const configurable = [
  producto("pan", "Pan de hot dog", "2.00"),
  producto("papas", "Papas fritas", "10.00"),
  producto("bebida", "Bebida", "8.00"),
  evt("product.created", { productId: "chorizo", name: "Chorizo", salePrice: q("10.00"), categoryName: "Carnes" }),
  evt("product.created", { productId: "tocino", name: "Tocino", salePrice: q("11.00"), categoryName: "Carnes" }),
  evt("product.created", {
    productId: "combo2",
    name: "Combo 2 carnes",
    salePrice: q("45.00"),
    components: [
      { productId: "pan", quantity: 1 },
      { productId: "papas", quantity: 1 },
      { productId: "bebida", quantity: 1 },
    ],
    options: [{ label: "Carne", quantity: 2, fromCategory: "Carnes" }],
  }),
];

describe("Combos configurables", () => {
  const { state } = project(configurable);
  const combo = state.products.get("combo2")!;

  it("reconoce el producto configurable y sus candidatos", () => {
    expect(isConfigurable(combo)).toBe(true);
    expect(choicesFor(state.products, combo.options![0]!).map((p) => p.id)).toEqual(["chorizo", "tocino"]);
  });

  it("descuenta las carnes elegidas, no unas genéricas", () => {
    const consumo = explodeLine(state.products, {
      productId: "combo2",
      quantity: 1,
      selections: [
        { label: "Carne", productId: "chorizo", quantity: 1 },
        { label: "Carne", productId: "tocino", quantity: 1 },
      ],
    });
    expect(Object.fromEntries(consumo)).toEqual({ pan: 1, papas: 1, bebida: 1, chorizo: 1, tocino: 1 });
  });

  it("dos carnes iguales cuentan dos veces", () => {
    const consumo = explodeLine(state.products, {
      productId: "combo2",
      quantity: 1,
      selections: [{ label: "Carne", productId: "chorizo", quantity: 2 }],
    });
    expect(consumo.get("chorizo")).toBe(2);
  });

  it("multiplica las elecciones por la cantidad de la línea", () => {
    const consumo = explodeLine(state.products, {
      productId: "combo2",
      quantity: 3,
      selections: [
        { label: "Carne", productId: "chorizo", quantity: 1 },
        { label: "Carne", productId: "tocino", quantity: 1 },
      ],
    });
    expect(consumo.get("chorizo")).toBe(3);
    expect(consumo.get("tocino")).toBe(3);
    expect(consumo.get("pan")).toBe(3);
  });

  it("exige que las elecciones cubran exactamente lo pedido", () => {
    const falta = validateSelections(state.products, combo, [
      { label: "Carne", productId: "chorizo", quantity: 1 },
    ]);
    expect(falta[0]).toMatch(/pide 2 y se eligieron 1/);

    const sobra = validateSelections(state.products, combo, [
      { label: "Carne", productId: "chorizo", quantity: 3 },
    ]);
    expect(sobra[0]).toMatch(/pide 2 y se eligieron 3/);

    const justo = validateSelections(state.products, combo, [
      { label: "Carne", productId: "chorizo", quantity: 1 },
      { label: "Carne", productId: "tocino", quantity: 1 },
    ]);
    expect(justo).toEqual([]);
  });

  it("rechaza elegir algo fuera de la categoría de la opción", () => {
    const problems = validateSelections(state.products, combo, [
      { label: "Carne", productId: "papas", quantity: 2 },
    ]);
    expect(problems.some((p) => p.includes("no es una opción válida"))).toBe(true);
  });

  it("rechaza una opción que el producto no declara", () => {
    const problems = validateSelections(state.products, combo, [
      { label: "Carne", productId: "chorizo", quantity: 2 },
      { label: "Salsa", productId: "chorizo", quantity: 1 },
    ]);
    expect(problems.some((p) => p.includes("opción desconocida"))).toBe(true);
  });

  it("la existencia refleja las carnes realmente elegidas", () => {
    const { state: s2 } = project([
      ...configurable,
      entrada("r1", [
        { productId: "chorizo", quantity: 10, unitCost: "6.00" },
        { productId: "tocino", quantity: 10, unitCost: "7.00" },
        { productId: "pan", quantity: 10, unitCost: "1.50" },
        { productId: "papas", quantity: 10, unitCost: "4.00" },
        { productId: "bebida", quantity: 10, unitCost: "3.50" },
      ]),
      evt("invoice.issued", {
        invoiceId: "i1",
        series: "A",
        number: 1,
        date: "2026-08-25",
        currency: "GTQ",
        lines: [
          {
            description: "Combo 2 carnes",
            quantity: 2,
            unitPrice: q("45.00"),
            taxRate: 12,
            productId: "combo2",
            selections: [{ label: "Carne", productId: "chorizo", quantity: 2 }],
          },
        ],
        totals: totalsSnapshot(
          computeInvoiceTotals(
            [{ description: "Combo 2 carnes", quantity: 2, unitPrice: q("45.00"), taxRate: 12 }],
            "GTQ",
          ),
        ),
        partnerName: "Consumidor final",
        partnerTaxId: "CF",
      }),
    ]);
    // 2 combos × 2 chorizos = 4; el tocino no se tocó.
    expect(stockOf(s2, "chorizo")).toBe(6);
    expect(stockOf(s2, "tocino")).toBe(10);
    expect(stockOf(s2, "pan")).toBe(8);
  });
});

describe("Archivar es reversible", () => {
  it("restaurar devuelve el producto a las listas", () => {
    const { state, rejected } = project([
      ...menu,
      evt("product.archived", { productId: "papas" }),
      evt("product.restored", { productId: "papas" }),
    ]);
    expect(rejected).toEqual([]);
    expect(state.products.get("papas")!.archived).toBe(false);
  });
});

describe("Cuentas por pagar (entradas de stock)", () => {
  it("una entrada nace sin pagar", () => {
    const { state } = project([...menu, entrada("r1", [{ productId: "papas", quantity: 10, unitCost: "5.00" }])]);
    expect(state.receipts.get("r1")!.status).toBe("unpaid");
  });

  it("pagar la marca pagada con fecha y forma de pago", () => {
    const { state, rejected } = project([
      ...menu,
      entrada("r1", [{ productId: "papas", quantity: 10, unitCost: "5.00" }]),
      evt("stock.receipt_paid", { receiptId: "r1", paidAt: "2026-08-21T10:00:00.000Z", paymentMethod: "Transferencia" }),
    ]);
    expect(rejected).toEqual([]);
    const receipt = state.receipts.get("r1")!;
    expect(receipt.status).toBe("paid");
    expect(receipt.paidAt).toBe("2026-08-21T10:00:00.000Z");
    expect(receipt.paymentMethod).toBe("Transferencia");
  });

  it("rechaza pagar dos veces o una entrada inexistente", () => {
    const { rejected } = project([
      ...menu,
      entrada("r1", [{ productId: "papas", quantity: 10, unitCost: "5.00" }]),
      evt("stock.receipt_paid", { receiptId: "r1", paidAt: "2026-08-21T10:00:00.000Z" }),
      evt("stock.receipt_paid", { receiptId: "r1", paidAt: "2026-08-22T10:00:00.000Z" }),
      evt("stock.receipt_paid", { receiptId: "rX", paidAt: "2026-08-22T10:00:00.000Z" }),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["already_paid", "not_found"]);
  });

  it("unpaidReceipts suma solo lo pendiente del período", () => {
    const { state } = project([
      ...menu,
      entrada("r1", [{ productId: "papas", quantity: 10, unitCost: "5.00" }]), // 50.00, sin pagar
      entrada("r2", [{ productId: "chorizo", quantity: 4, unitCost: "6.00" }]), // 24.00, se paga
      evt("stock.receipt_paid", { receiptId: "r2", paidAt: "2026-08-21T10:00:00.000Z", paymentMethod: "Efectivo" }),
    ]);
    const unpaid = unpaidReceipts(state, "2026-08", "GTQ");
    expect(unpaid.count).toBe(1);
    expect(unpaid.amount.minor).toBe(5000);
    expect(paidReceipts(state, "2026-08", "GTQ").minor).toBe(2400);
  });
});
