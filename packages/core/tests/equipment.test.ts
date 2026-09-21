import { describe, expect, it } from "vitest";
import {
  accumulatedDepreciation,
  activeEquipment,
  activeEquipmentAssignment,
  assignmentsFor,
  bookValue,
  equipmentByEmployee,
  equipmentById,
  fromDecimal,
  monthlyDepreciation,
  project,
  type AnyEvent,
} from "../src/index.js";

let seq = 0;
const evt = (type: AnyEvent["type"], payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: "2026-08-25T12:00:00.000Z", v: 1, type, payload } as AnyEvent);

const q = (v: string) => fromDecimal(v, "GTQ");

const baseDraft = {
  type: "laptop",
  serial: "SN-LAP-001",
} as const;

const created = (over: Record<string, unknown> = {}) =>
  evt("equipment.created", { equipmentId: "eq1", ...baseDraft, ...over });

const employeeCreated = (id: string, name: string) =>
  evt("payroll.employee_created", {
    employeeId: id,
    name,
    hireDate: "2026-08-01",
    baseSalary: q("5000"),
    contractType: "indefinido",
  });

describe("Inventario de equipos (activos de uso empresarial)", () => {
  it("crea un equipo con todos sus campos y status default nuevo", () => {
    const { state, rejected } = project([
      evt("partner.created", { partnerId: "p1", name: "GoldenLeaf", kind: "customer" }),
      created({
        brand: "Lenovo",
        model: "ThinkPad T14",
        imei: undefined,
        plan: "Plan Empresarial 20GB",
        planProvider: "Tigo",
        planRenewalDate: "2027-01-15",
        vendorName: "Juan Vendedor",
        vendorPhone: "+502 5555 0000",
        purchaseDate: "2026-08-01",
        supplier: "Distribuidora GT",
        cost: q("8600"),
        warrantyUntil: "2028-08-01",
        clientId: "p1",
        notes: "Único dueño anterior",
      }),
    ]);
    expect(rejected).toHaveLength(0);
    const eq = equipmentById(state, "eq1");
    expect(eq?.status).toBe("nuevo");
    expect(eq?.brand).toBe("Lenovo");
    expect(eq?.model).toBe("ThinkPad T14");
    expect(eq?.plan).toBe("Plan Empresarial 20GB");
    expect(eq?.planProvider).toBe("Tigo");
    expect(eq?.planRenewalDate).toBe("2027-01-15");
    expect(eq?.vendorName).toBe("Juan Vendedor");
    expect(eq?.vendorPhone).toBe("+502 5555 0000");
    expect(eq?.purchaseDate).toBe("2026-08-01");
    expect(eq?.supplier).toBe("Distribuidora GT");
    expect(eq?.cost?.minor).toBe(860000);
    expect(eq?.warrantyUntil).toBe("2028-08-01");
    expect(eq?.clientId).toBe("p1");
    expect(eq?.notes).toBe("Único dueño anterior");
  });

  it("rechaza serial vacío y tipo inválido", () => {
    const { rejected: noSerial } = project([created({ serial: "  " })]);
    expect(noSerial[0]?.code).toBe("equipment.empty_serial");
    const { rejected: badType } = project([created({ type: "desktop" })]);
    expect(badType[0]?.code).toBe("equipment.invalid_type");
  });

  it("rechaza costo negativo y fecha inválida en renovación del plan", () => {
    const { rejected: badCost } = project([created({ cost: { minor: -1, currency: "GTQ" } })]);
    expect(badCost[0]?.code).toBe("equipment.bad_cost");
    const { rejected: badDate } = project([created({ planRenewalDate: "enero-2027" })]);
    expect(badDate[0]?.code).toBe("equipment.bad_date");
  });

  it("rechaza serial duplicado entre equipos activos", () => {
    const { rejected } = project([
      created(),
      evt("equipment.created", { equipmentId: "eq2", type: "celular", serial: "SN-LAP-001" }),
    ]);
    expect(rejected[0]?.code).toBe("equipment.duplicate_serial");
  });

  it("permite reusar el serial de un equipo dado de baja", () => {
    const { rejected } = project([
      created(),
      evt("equipment.archived", { equipmentId: "eq1" }),
      evt("equipment.created", { equipmentId: "eq2", type: "celular", serial: "SN-LAP-001" }),
    ]);
    expect(rejected).toHaveLength(0);
  });

  it("asigna un equipo a un empleado y lo expone como equipo del empleado", () => {
    const { state, rejected } = project([
      employeeCreated("e1", "Ana"),
      created({ status: "en_uso" }),
      evt("equipment.assigned", { equipmentId: "eq1", employeeId: "e1", assignedAt: "2026-08-10", note: "Entrega inicial" }),
    ]);
    expect(rejected).toHaveLength(0);
    const eq = equipmentById(state, "eq1");
    expect(eq?.status).toBe("en_uso");
    expect(activeEquipmentAssignment(state, "eq1")?.employeeId).toBe("e1");
    expect(equipmentByEmployee(state, "e1").map((e) => e.id)).toEqual(["eq1"]);
  });

  it("rechaza doble asignación activa del mismo equipo", () => {
    const { rejected } = project([
      employeeCreated("e1", "Ana"),
      employeeCreated("e2", "Luis"),
      created(),
      evt("equipment.assigned", { equipmentId: "eq1", employeeId: "e1", assignedAt: "2026-08-10" }),
      evt("equipment.assigned", { equipmentId: "eq1", employeeId: "e2", assignedAt: "2026-08-11" }),
    ]);
    expect(rejected[0]?.code).toBe("equipment.already_assigned");
  });

  it("rechaza asignar a un empleado inexistente o archivado", () => {
    const { rejected: missing } = project([
      created(),
      evt("equipment.assigned", { equipmentId: "eq1", employeeId: "nadie", assignedAt: "2026-08-10" }),
    ]);
    expect(missing[0]?.code).toBe("equipment.employee_not_found");
    const { rejected: archivedEmp } = project([
      employeeCreated("e1", "Ana"),
      evt("payroll.employee_archived", { employeeId: "e1" }),
      created(),
      evt("equipment.assigned", { equipmentId: "eq1", employeeId: "e1", assignedAt: "2026-08-10" }),
    ]);
    expect(archivedEmp[0]?.code).toBe("equipment.employee_archived");
  });

  it("mantiene historial de asignaciones: devolver y reasignar a otro empleado", () => {
    const { state, rejected } = project([
      employeeCreated("e1", "Ana"),
      employeeCreated("e2", "Luis"),
      created(),
      evt("equipment.assigned", { equipmentId: "eq1", employeeId: "e1", assignedAt: "2026-08-10", note: "Entrega" }),
      evt("equipment.returned", { equipmentId: "eq1", returnedAt: "2026-08-20", note: "Devuelto" }),
      evt("equipment.assigned", { equipmentId: "eq1", employeeId: "e2", assignedAt: "2026-08-21" }),
    ]);
    expect(rejected).toHaveLength(0);
    expect(assignmentsFor(state, "eq1")).toHaveLength(2);
    expect(activeEquipmentAssignment(state, "eq1")?.employeeId).toBe("e2");
    expect(equipmentByEmployee(state, "e1")).toHaveLength(0);
    expect(equipmentByEmployee(state, "e2").map((e) => e.id)).toEqual(["eq1"]);
  });

  it("rechaza devolución sin asignación activa o con fecha anterior a la asignación", () => {
    const { rejected: loose } = project([
      created(),
      evt("equipment.returned", { equipmentId: "eq1", returnedAt: "2026-08-20" }),
    ]);
    expect(loose[0]?.code).toBe("equipment.not_assigned");
    const { rejected: backInTime } = project([
      employeeCreated("e1", "Ana"),
      created(),
      evt("equipment.assigned", { equipmentId: "eq1", employeeId: "e1", assignedAt: "2026-08-10" }),
      evt("equipment.returned", { equipmentId: "eq1", returnedAt: "2026-08-05" }),
    ]);
    expect(backInTime[0]?.code).toBe("equipment.bad_return_date");
  });

  it("validates que el cliente asignado exista en el CRM", () => {
    const { rejected } = project([
      evt("partner.created", { partnerId: "p1", name: "GoldenLeaf", kind: "customer" }),
      created({ clientId: "p1" }),
    ]);
    expect(rejected).toHaveLength(0);
    const { rejected: ghost } = project([created({ clientId: "no-existe" })]);
    expect(ghost[0]?.code).toBe("equipment.client_not_found");
  });

  it("actualiza cambios del equipo y lo excluye de activos al archivarlo", () => {
    const { state, rejected } = project([
      created({ status: "en_uso" }),
      evt("equipment.updated", { equipmentId: "eq1", changes: { status: "en_reparacion", planRenewalDate: "2027-06-01" } }),
    ]);
    expect(rejected).toHaveLength(0);
    const eq = equipmentById(state, "eq1");
    expect(eq?.status).toBe("en_reparacion");
    expect(eq?.planRenewalDate).toBe("2027-06-01");
    const { state: arch, rejected: archRej } = project([
      created(),
      evt("equipment.archived", { equipmentId: "eq1" }),
    ]);
    expect(archRej).toHaveLength(0);
    expect(activeEquipment(arch)).toHaveLength(0);
  });

  describe("depreciación lineal", () => {
    it("calcula depreciación mensual por línea recta según vida útil del tipo", () => {
      const laptop = project([
        created({ cost: q("3600"), purchaseDate: "2026-01-01" }),
      ]).state;
      const eq = equipmentById(laptop, "eq1")!;
      expect(monthlyDepreciation(eq)?.minor).toBe(10000); // 3600 / 36 meses
      const celular = project([
        evt("equipment.created", { equipmentId: "eq2", type: "celular", serial: "IMEI-1", cost: q("2400"), purchaseDate: "2026-01-01" }),
      ]).state;
      const mob = equipmentById(celular, "eq2")!;
      expect(monthlyDepreciation(mob)?.minor).toBe(10000); // 2400 / 24 meses
    });

    it("acumula depreciación y calcula valor en libros a una fecha", () => {
      const { state } = project([
        created({ cost: q("3600"), purchaseDate: "2026-01-01" }),
      ]);
      const eq = equipmentById(state, "eq1")!;
      expect(accumulatedDepreciation(eq, "2026-06-01")?.minor).toBe(50000); // 5 × 100
      expect(bookValue(eq, "2026-06-01")?.minor).toBe(310000); // 3600 − 500
    });

    it("nunca deprecia por debajo de cero (cap en el valor residual)", () => {
      const { state } = project([
        created({ cost: q("3650"), purchaseDate: "2026-01-01" }),
      ]);
      const eq = equipmentById(state, "eq1")!;
      expect(bookValue(eq, "2030-01-01")?.minor).toBe(0);
    });

    it("devuelve null sin costo o sin fecha de compra", () => {
      const { state } = project([created()]);
      const eq = equipmentById(state, "eq1")!;
      expect(monthlyDepreciation(eq)).toBeNull();
      expect(bookValue(eq, "2026-06-01")).toBeNull();
    });
  });
});