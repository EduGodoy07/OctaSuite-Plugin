import { describe, expect, it } from "vitest";
import {
  activeEmployees,
  computePayrollLine,
  computePayrollTotals,
  currentPayrollPolicy,
  employeeById,
  employeePayrollRuns,
  fromDecimal,
  igssDeduction,
  igssEmployerContribution,
  isEventEnvelope,
  isrOnSalary,
  payrollRunById,
  payrollRunsInMonth,
  project,
  validateEmployeeDraft,
  verifyPayrollTotals,
  type AnyEvent,
  type PayrollLine,
  type PayrollTotals,
} from "../src/index.js";

let seq = 0;
const evt = (type: AnyEvent["type"], payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: "2026-08-25T12:00:00.000Z", v: 1, type, payload } as AnyEvent);

const q = (v: string) => fromDecimal(v, "GTQ");

const policy = currentPayrollPolicy("2026-08-01");

const linea = (employeeId: string, employeeName: string, gross: string): PayrollLine =>
  computePayrollLine({ employeeId, employeeName, gross: q(gross) }, policy);

describe("Liquidación de nómina (política 2026)", () => {
  it("descuenta IGSS del empleado (4.83%) y costo patronal (12.67%)", () => {
    const gross = q("5000");
    expect(igssDeduction(gross, policy).minor).toBe(24150); // Q241.50
    expect(igssEmployerContribution(gross, policy).minor).toBe(63350); // Q633.50
  });

  it("aplica el tope IGSS de 4× salario mínimo (Q14,378.20)", () => {
    const gross = q("15000");
    expect(igssDeduction(gross, policy).minor).toBe(69447); // 4.83% × 14,378.20 ≈ Q694.47
    expect(igssEmployerContribution(gross, policy).minor).toBe(182172); // 12.67% × 14,378.20 ≈ Q1,821.72
  });

  it("calcula la tarifa ISR mensual por tramos", () => {
    expect(isrOnSalary(q("300.00"), policy).minor).toBe(0); // exento
    expect(isrOnSalary(q("750.00"), policy).minor).toBe(2250); // Q22.50
    expect(isrOnSalary(q("1250.00"), policy).minor).toBe(5750); // Q57.50
    expect(isrOnSalary(q("8500.00"), policy).minor).toBe(136000); // Q1,360.00 (tramo tope + 25%)
  });

  it("liquida una línea completa: bruto Q5,000", () => {
    const l = linea("e1", "Ana", "5000");
    expect(l.igssEmployee.minor).toBe(24150);
    expect(l.taxBase.minor).toBe(475850); // bruto − IGSS
    expect(l.isr.minor).toBe(61170); // Q611.70
    expect(l.net.minor).toBe(414680); // bruto − IGSS − ISR
    expect(l.igssEmployer.minor).toBe(63350);
    expect(l.bono14Provision.minor).toBe(20833); // 5,000 × 1/24
    expect(l.aguinaldoProvision.minor).toBe(20833);
    expect(l.totalCost.minor).toBe(605016); // bruto + patronal + provisiones
  });

  it("agrega totales por columna", () => {
    const ana = linea("e1", "Ana", "5000");
    const luis = linea("e2", "Luis", "2500");
    // Luis: igss 120.75; taxBase 2,379.25; isr 184.39; net 2,194.86; patronal 316.75; provisión 104.17; costo 3,025.09
    expect(luis.igssEmployee.minor).toBe(12075);
    expect(luis.isr.minor).toBe(18439);
    const totals = computePayrollTotals([ana, luis], "GTQ");
    expect(totals.gross.minor).toBe(750000);
    expect(totals.igssEmployee.minor).toBe(36225); // 24150 + 12075
    expect(totals.isr.minor).toBe(79609); // 61170 + 18439
    expect(totals.net.minor).toBe(634166); // 414680 + 219486
    expect(totals.igssEmployer.minor).toBe(95025); // 63350 + 31675
    expect(totals.bono14Provision.minor).toBe(31250); // 20833 + 10417
    expect(totals.aguinaldoProvision.minor).toBe(31250);
    expect(totals.totalCost.minor).toBe(907525); // 605016 + 302509
  });

  it("verifica la aritmética de una nómina procesada", () => {
    const lines = [linea("e1", "Ana", "5000"), linea("e2", "Luis", "2500")];
    const totals = computePayrollTotals(lines, "GTQ");
    expect(verifyPayrollTotals(lines, totals)).toBeNull();
  });

  it("detecta una línea internamente inconsistente", () => {
    const good = linea("e1", "Ana", "5000");
    const broken: PayrollLine = { ...good, net: { minor: good.net.minor + 1, currency: "GTQ" } };
    const totals = computePayrollTotals([broken], "GTQ");
    expect(verifyPayrollTotals([broken], totals)?.code).toBe("payroll.line_drift");
  });

  it("detecta totales que no cuadran con sus líneas", () => {
    const lines = [linea("e1", "Ana", "5000")];
    const totals = computePayrollTotals(lines, "GTQ");
    const tampered: PayrollTotals = { ...totals, net: { minor: totals.net.minor + 1, currency: "GTQ" } };
    expect(verifyPayrollTotals(lines, tampered)?.code).toBe("payroll.totals_drift");
  });

  it("rechaza salarios negativos", () => {
    expect(verifyPayrollTotals([{ ...linea("e1", "Ana", "5000"), gross: { minor: -1, currency: "GTQ" } }], {
      gross: { minor: -1, currency: "GTQ" },
      igssEmployee: { minor: 0, currency: "GTQ" },
      isr: { minor: 0, currency: "GTQ" },
      net: { minor: -1, currency: "GTQ" },
      igssEmployer: { minor: 0, currency: "GTQ" },
      bono14Provision: { minor: 0, currency: "GTQ" },
      aguinaldoProvision: { minor: 0, currency: "GTQ" },
      totalCost: { minor: -1, currency: "GTQ" },
    })?.code).toBe("payroll.negative_gross");
  });
});

describe("Empleados y períodos (store)", () => {
  const employee = (id: string, name: string, salary: string) =>
    evt("payroll.employee_created", {
      employeeId: id,
      name,
      hireDate: "2026-08-01",
      baseSalary: q(salary),
      contractType: "indefinido",
    });

  it("crea y lista empleados activos ordenados por nombre", () => {
    const { state } = project([employee("e1", "Ana", "5000"), employee("e2", "Luis", "2500")]);
    expect(activeEmployees(state).map((e) => e.name)).toEqual(["Ana", "Luis"]);
    expect(employeeById(state, "e1")?.hireDate).toBe("2026-08-01");
  });

  it("rechaza duplicados y empleados inválidos", () => {
    const { rejected } = project([employee("e1", "Ana", "5000"), employee("e1", "Otro", "3000")]);
    expect(rejected.map((r) => r.code)).toEqual(["duplicate"]);
    const { rejected: bad } = project([evt("payroll.employee_created", { employeeId: "eX", name: "", baseSalary: q("1") })]);
    expect(bad[0].code).toBe("payroll.name_required");
    const { rejected: badSalary } = project([employee("e1", "Ana", "0")]);
    expect(badSalary[0].code).toBe("payroll.bad_salary");
  });

  it("actualiza salarios y archiva (reversible)", () => {
    const { state, rejected } = project([
      employee("e1", "Ana", "5000"),
      evt("payroll.employee_updated", { employeeId: "e1", changes: { baseSalary: q("5500") } }),
      evt("payroll.employee_archived", { employeeId: "e1" }),
      evt("payroll.employee_archived", { employeeId: "e1" }),
      evt("payroll.employee_updated", { employeeId: "e1", changes: { baseSalary: q("6000") } }),
    ]);
    expect(employeeById(state, "e1")?.baseSalary.minor).toBe(550000);
    expect(rejected.map((r) => r.code)).toEqual(["already_archived", "archived"]);
    expect(activeEmployees(state)).toHaveLength(0);
  });

  it("procesa una nómina validando su aritmética", () => {
    const lines = [linea("e1", "Ana", "5000")];
    const totals = computePayrollTotals(lines, "GTQ");
    const { state, rejected } = project([
      employee("e1", "Ana", "5000"),
      evt("payroll.run_processed", { runId: "r1", month: "2026-08", lines, totals }),
      evt("payroll.run_processed", { runId: "r1", month: "2026-08", lines, totals }),
      evt("payroll.run_processed", { runId: "r2", month: "2026-8", lines, totals }),
      evt("payroll.run_processed", { runId: "r3", month: "2026-08", lines: [], totals }),
      evt("payroll.run_processed", {
        runId: "r4",
        month: "2026-08",
        lines,
        totals: { ...totals, net: { minor: totals.net.minor + 1, currency: "GTQ" } },
      }),
    ]);
    expect(payrollRunById(state, "r1")?.month).toBe("2026-08");
    expect(payrollRunsInMonth(state, "2026-08").map((r) => r.id)).toEqual(["r1"]);
    expect(employeePayrollRuns(state, "e1").map((r) => r.id)).toEqual(["r1"]);
    expect(rejected.map((r) => r.code)).toEqual(["duplicate", "bad_month", "no_lines", "payroll.totals_drift"]);
  });

  it("rechaza hireDate vacío (no solo ausente) — regresión MAJOR-2", () => {
    const withEmpty = validateEmployeeDraft({ hireDate: "" });
    expect(withEmpty.some((e) => e.code === "payroll.bad_date")).toBe(true);

    const without = validateEmployeeDraft({ name: "Ana", hireDate: undefined });
    expect(without.some((e) => e.code === "payroll.bad_date")).toBe(false);
  });

  it("los nuevos tipos pasan el validador de envoltura", () => {
    expect(isEventEnvelope(employee("e1", "Ana", "5000"))).toBe(true);
    expect(
      isEventEnvelope(
        evt("payroll.run_processed", {
          runId: "r1",
          month: "2026-08",
          lines: [linea("e1", "Ana", "5000")],
          totals: computePayrollTotals([linea("e1", "Ana", "5000")], "GTQ"),
        }),
      ),
    ).toBe(true);
  });

  it("guarda puesto y responsabilidades al crear y editar", () => {
    const { state, rejected } = project([
      evt("payroll.employee_created", {
        employeeId: "e1",
        name: "Ana",
        hireDate: "2026-08-01",
        baseSalary: q("5000"),
        contractType: "indefinido",
        position: "Cajera",
        responsibilities: ["Caja y arqueos", "Supervisión de personal"],
      }),
      evt("payroll.employee_updated", {
        employeeId: "e1",
        changes: { position: "Jefa de tienda", responsibilities: ["Supervisión de personal"] },
      }),
    ]);
    expect(rejected).toHaveLength(0);
    const emp = employeeById(state, "e1")!;
    expect(emp.position).toBe("Jefa de tienda");
    expect(emp.responsibilities).toEqual(["Supervisión de personal"]);
  });

  it("arma la cadena de mando y valida ciclos/referencias", () => {
    const { state, rejected } = project([
      evt("payroll.employee_created", {
        employeeId: "e1", name: "Ana", hireDate: "2026-08-01", baseSalary: q("9000"), contractType: "indefinido",
      }),
      evt("payroll.employee_created", {
        employeeId: "e2", name: "Luis", hireDate: "2026-08-01", baseSalary: q("6500"), contractType: "indefinido", managerId: "e1",
      }),
      evt("payroll.employee_created", {
        employeeId: "e3", name: "María", hireDate: "2026-08-01", baseSalary: q("4500"), contractType: "indefinido", managerId: "e2",
      }),
      evt("payroll.employee_created", {
        employeeId: "e4", name: "Pablo", hireDate: "2026-08-01", baseSalary: q("3200"), contractType: "indefinido", managerId: "e3",
      }),
      // jefe inválido: ciclo consigo mismo
      evt("payroll.employee_created", {
        employeeId: "e5", name: "Eva", hireDate: "2026-08-01", baseSalary: q("3000"), contractType: "indefinido", managerId: "e5",
      }),
      // jefe inexistente
      evt("payroll.employee_created", {
        employeeId: "e6", name: "Sofía", hireDate: "2026-08-01", baseSalary: q("3000"), contractType: "indefinido", managerId: "nope",
      }),
      // jefe archivado
      evt("payroll.employee_created", {
        employeeId: "e7", name: "Lucas", hireDate: "2026-08-01", baseSalary: q("3000"), contractType: "indefinido", managerId: "e1",
      }),
      evt("payroll.employee_archived", { employeeId: "e7" }),
      evt("payroll.employee_created", {
        employeeId: "e8", name: "Rosa", hireDate: "2026-08-01", baseSalary: q("3000"), contractType: "indefinido", managerId: "e7",
      }),
      // ciclo en actualización: e2 pasaría a depender de e3, que depende de e2
      evt("payroll.employee_updated", { employeeId: "e2", changes: { managerId: "e3" } }),
    ]);
    expect(employeeById(state, "e4")?.managerId).toBe("e3");
    expect(rejected.map((r) => r.code)).toEqual([
      "payroll.manager_cycle",
      "payroll.manager_not_found",
      "payroll.manager_archived",
      "payroll.manager_cycle",
    ]);
  });

  it("limpia el jefe con managerId: undefined", () => {
    const { state } = project([
      evt("payroll.employee_created", {
        employeeId: "e1", name: "Ana", hireDate: "2026-08-01", baseSalary: q("9000"), contractType: "indefinido",
      }),
      evt("payroll.employee_created", {
        employeeId: "e2", name: "Luis", hireDate: "2026-08-01", baseSalary: q("6500"), contractType: "indefinido", managerId: "e1",
      }),
      evt("payroll.employee_updated", { employeeId: "e2", changes: { managerId: undefined } }),
    ]);
    expect(employeeById(state, "e2")?.managerId).toBeUndefined();
  });
});