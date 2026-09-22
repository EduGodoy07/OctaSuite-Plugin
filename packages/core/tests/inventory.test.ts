import { describe, expect, it } from "vitest";
import {
  activeLocations,
  fromDecimal,
  isEventEnvelope,
  locationById,
  locationStock,
  locationStockLevels,
  project,
  transfersOf,
  type AnyEvent,
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

const entrada = (receiptId: string, productId: string, quantity: number) =>
  evt("stock.received", {
    receiptId,
    date: "2026-08-20",
    partnerName: "Proveedor",
    lines: [{ productId, quantity, unitCost: q("50") }],
  });

const ubicacion = (id: string, name: string, kind: "main" | "warehouse" | "store" | "external" = "warehouse") =>
  evt("inventory.location_created", { locationId: id, name, kind });

const traslado = (transferId: string, from: string, to: string, lines: { productId: string; quantity: number }[]) =>
  evt("inventory.transfer_created", {
    transferId,
    date: "2026-08-26",
    fromLocationId: from,
    toLocationId: to,
    lines,
  });

const base = () => [
  producto("p1", "Arroz", "10"),
  entrada("r1", "p1", 10),
  ubicacion("main", "Principal", "main"),
  ubicacion("bodega", "Bodega Norte"),
];

describe("Ubicaciones de inventario", () => {
  it("lista ubicaciones activas ordenadas por nombre", () => {
    const { state } = project(base());
    expect(activeLocations(state).map((l) => l.name)).toEqual(["Bodega Norte", "Principal"]);
    expect(locationById(state, "main")?.kind).toBe("main");
  });

  it("rechaza ubicaciones inválidas y duplicadas", () => {
    const { rejected } = project([
      ubicacion("main", "Principal", "main"),
      ubicacion("main", "Otro", "main"),
      evt("inventory.location_created", { locationId: "x", name: "", kind: "warehouse" }),
      evt("inventory.location_created", { locationId: "y", name: "Rara", kind: "nave" as never }),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["duplicate", "inventory.empty_name", "inventory.invalid_kind"]);
  });

  it("archiva ubicaciones y no re-archiva", () => {
    const { state, rejected } = project([
      ubicacion("cerrada", "Cerrada"),
      evt("inventory.location_archived", { locationId: "cerrada" }),
      evt("inventory.location_archived", { locationId: "cerrada" }),
    ]);
    expect(locationById(state, "cerrada")?.archived).toBe(true);
    expect(rejected.map((r) => r.code)).toEqual(["already_archived"]);
  });

  it("no archiva la ubicación principal (immutable_primary)", () => {
    const { state, rejected } = project([
      ubicacion("main", "Principal", "main"),
      evt("inventory.location_archived", { locationId: "main" }),
    ]);
    expect(locationById(state, "main")?.archived).toBe(false);
    expect(rejected.map((r) => r.code)).toEqual(["inventory.immutable_primary"]);
  });

  it("edita nombre y tipo de una ubicación", () => {
    const { state, rejected } = project([
      ubicacion("bodega", "Bodega Norte"),
      evt("inventory.location_updated", {
        locationId: "bodega",
        changes: { name: "Bodega Sur", kind: "external" },
      }),
    ]);
    expect(rejected).toHaveLength(0);
    const bodega = locationById(state, "bodega")!;
    expect(bodega.name).toBe("Bodega Sur");
    expect(bodega.kind).toBe("external");
    expect(bodega.updatedAt).toBe("2026-08-25T12:00:00.000Z");
  });

  it("no edita la ubicación principal (immutable_primary)", () => {
    const { rejected } = project([
      ubicacion("main", "Principal", "main"),
      evt("inventory.location_updated", { locationId: "main", changes: { name: "Otra" } }),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["inventory.immutable_primary"]);
  });

  it("rechaza editar ubicaciones inexistentes, archivadas o inválidas", () => {
    const { rejected: missing } = project([
      evt("inventory.location_updated", { locationId: "nope", changes: { name: "X" } }),
    ]);
    expect(missing.map((r) => r.code)).toEqual(["not_found"]);

    const { rejected: archived } = project([
      ubicacion("cerrada", "Cerrada"),
      evt("inventory.location_archived", { locationId: "cerrada" }),
      evt("inventory.location_updated", { locationId: "cerrada", changes: { name: "Abierta" } }),
    ]);
    expect(archived.map((r) => r.code)).toEqual(["archived"]);

    const { rejected: invalid } = project([
      ubicacion("bodega", "Bodega Norte"),
      evt("inventory.location_updated", { locationId: "bodega", changes: { name: "" } }),
      evt("inventory.location_updated", { locationId: "bodega", changes: { kind: "nave" as never } }),
    ]);
    expect(invalid.map((r) => r.code)).toEqual(["inventory.empty_name", "inventory.invalid_kind"]);
  });

  it("el wrapper location_updated pasa el validador de envoltura", () => {
    expect(
      isEventEnvelope(evt("inventory.location_updated", { locationId: "bodega", changes: { name: "X" } })),
    ).toBe(true);
  });
});

describe("Traslados entre ubicaciones", () => {
  it("mueve existencias y ajusta el stock de cada ubicación", () => {
    const { state, rejected } = project([...base(), traslado("t1", "main", "bodega", [{ productId: "p1", quantity: 3 }])]);
    expect(rejected).toHaveLength(0);
    expect(locationStock(state, "main", "p1")).toBe(7); // 10 recibidos − 3 trasladados
    expect(locationStock(state, "bodega", "p1")).toBe(3);
    expect(locationStockLevels(state, "bodega")).toEqual([{ productId: "p1", onHand: 3 }]);
    expect(locationStockLevels(state, "main")).toContainEqual({ productId: "p1", onHand: 7 });
    expect(transfersOf(state, "bodega").map((t) => t.id)).toEqual(["t1"]);
  });

  it("no mueve lo que no hay (insufficient_stock)", () => {
    const { rejected } = project([...base(), traslado("t1", "main", "bodega", [{ productId: "p1", quantity: 999 }])]);
    expect(rejected.map((r) => r.code)).toEqual(["insufficient_stock"]);
  });

  it("rechaza origen igual a destino", () => {
    const { rejected } = project([...base(), traslado("t1", "main", "main", [{ productId: "p1", quantity: 1 }])]);
    expect(rejected.map((r) => r.code)).toEqual(["inventory.same_location"]);
  });

  it("rechaza traslados vacíos y cantidades inválidas", () => {
    const { rejected: empty } = project([...base(), traslado("t1", "main", "bodega", [])]);
    expect(empty.map((r) => r.code)).toEqual(["inventory.no_lines"]);
    const { rejected: badQty } = project([...base(), traslado("t2", "main", "bodega", [{ productId: "p1", quantity: 0 }])]);
    expect(badQty.map((r) => r.code)).toEqual(["inventory.bad_quantity"]);
  });

  it("rechaza ubicaciones inexistentes o archivadas", () => {
    const { rejected: missing } = project([...base(), traslado("t1", "nope", "bodega", [{ productId: "p1", quantity: 1 }])]);
    expect(missing.map((r) => r.code)).toEqual(["not_found"]);
    const { rejected: archived } = project([
      ...base().slice(0, 4), // sin bodega creada
      ubicacion("cerrada", "Cerrada"),
      evt("inventory.location_archived", { locationId: "cerrada" }),
      traslado("t2", "main", "cerrada", [{ productId: "p1", quantity: 1 }]),
    ]);
    expect(archived.map((r) => r.code)).toEqual(["archived"]);
  });

  it("no traslada un combo: se mueven sus componentes", () => {
    const { rejected } = project([
      ...base(),
      producto("pk", "Combo Familiar", "100", [{ productId: "p1", quantity: 2 }]),
      traslado("t1", "main", "bodega", [{ productId: "pk", quantity: 1 }]),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["not_transferable"]);
  });

  it("rechaza un traslado duplicado", () => {
    const { rejected } = project([
      ...base(),
      traslado("t1", "main", "bodega", [{ productId: "p1", quantity: 3 }]),
      traslado("t1", "main", "bodega", [{ productId: "p1", quantity: 2 }]),
    ]);
    expect(rejected.map((r) => r.code)).toEqual(["duplicate"]);
  });

  it("los nuevos tipos pasan el validador de envoltura", () => {
    expect(isEventEnvelope(ubicacion("bodega", "Bodega Norte"))).toBe(true);
    expect(isEventEnvelope(traslado("t1", "main", "bodega", [{ productId: "p1", quantity: 1 }]))).toBe(true);
  });
});