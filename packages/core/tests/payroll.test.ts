import { describe, expect, it } from "vitest";
import {
  activeEmployees,
  aguinaldoAnnualEntitlement,
  aguinaldoMonthlyProvision,
  bono14AnnualEntitlement,
  bono14MonthlyProvision,
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
  rootEmployees,
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

  it("provisiona bono 14 y aguinaldo a 1/12 del salario mensual", () => {
    expect(bono14MonthlyProvision(q("5000")).minor).toBe(41667); // 5,000 × 1/12
    expect(aguinaldoMonthlyProvision(q("5000")).minor).toBe(41667);
    expect(bono14MonthlyProvision(q("2500")).minor).toBe(20833); // 2,500 × 1/12
  });

  it("paga bono 14 y aguinaldo completos tras el año trabajado (100%)", () => {
    const salary = q("5000");
    // Bono 14: 1-jul a 30-jun; aguinaldo: año calendario. Año completo = 100%.
    expect(bono14AnnualEntitlement(salary, 365).minor).toBe(500000);
    expect(aguinaldoAnnualEntitlement(salary, 365).minor).toBe(500000);
  });

  it("prorratea bono 14 y aguinaldo por días trabajados", () => {
    const salary = q("5000");
    expect(bono14AnnualEntitlement(salary, 180, 360).minor).toBe(250000); // medio período
    expect(aguinaldoAnnualEntitlement(salary, 90, 360).minor).toBe(125000); // un trimestre
    // workedDays mayor al período: se trunca a 100%, nunca se sobrepaga
    expect(bono14AnnualEntitlement(salary, 400, 365).minor).toBe(500000);
  });

  it("rechaza prorrateos inválidos (días negativos o período nulo)", () => {
    expect(() => bono14AnnualEntitlement(q("5000"), -1)).toThrow();
    expect(() => aguinaldoAnnualEntitlement(q("5000"), 10, 0)).toThrow();
  });

  it("liquida una línea completa: bruto Q5,000", () => {
    const l = linea("e1", "Ana", "5000");
    expect(l.igssEmployee.minor).toBe(24150);
    expect(l.taxBase.minor).toBe(475850); // bruto − IGSS
    expect(l.isr.minor).toBe(61170); // Q611.70
    expect(l.net.minor).toBe(414680); // bruto − IGSS − ISR
    expect(l.igssEmployer.minor).toBe(63350);
    expect(l.bono14Provision.minor).toBe(41667); // 5,000 × 1/12
    expect(l.aguinaldoProvision.minor).toBe(41667);
    expect(l.totalCost.minor).toBe(646684); // bruto + patronal + provisiones
  });

  it("agrega totales por columna", () => {
    const ana = linea("e1", "Ana", "5000");
    const luis = linea("e2", "Luis", "2500");
    // Luis: igss 120.75; taxBase 2,379.25; isr 184.39; net 2,194.86; patronal 316.75; provisión 208.33; costo 3,233.41
    expect(luis.igssEmployee.minor).toBe(12075);
    expect(luis.isr.minor).toBe(18439);
    const totals = computePayrollTotals([ana, luis], "GTQ");
    expect(totals.gross.minor).toBe(750000);
    expect(totals.igssEmployee.minor).toBe(36225); // 24150 + 12075
    expect(totals.isr.minor).toBe(79609); // 61170 + 18439
    expect(totals.net.minor).toBe(634166); // 414680 + 219486
    expect(totals.igssEmployer.minor).toBe(95025); // 63350 + 31675
    expect(totals.bono14Provision.minor).toBe(62500); // 41667 + 20833
    expect(totals.aguinaldoProvision.minor).toBe(62500);
    expect(totals.totalCost.minor).toBe(970025); // 646684 + 323341
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

  it("persiste paths de foto y CV al crear y actualizar un empleado", () => {
    const { state, rejected } = project([
      evt("payroll.employee_created", {
        employeeId: "e1", name: "Ana", hireDate: "2026-08-01", baseSalary: q("5000"),
        contractType: "indefinido",
        photoPath: "octasuite-data/employees/e1/foto.jpg",
        cvPath: "octasuite-data/employees/e1/cv.pdf",
      }),
      evt("payroll.employee_updated", {
        employeeId: "e1",
        changes: { cvPath: "octasuite-data/employees/e1/cv-v2.pdf" },
      }),
    ]);
    expect(rejected).toHaveLength(0);
    const emp = employeeById(state, "e1");
    expect(emp?.photoPath).toBe("octasuite-data/employees/e1/foto.jpg");
    expect(emp?.cvPath).toBe("octasuite-data/employees/e1/cv-v2.pdf");
  });

  it("rechaza paths de foto/CV vacíos o en blanco", () => {
    const { rejected } = project([
      evt("payroll.employee_created", {
        employeeId: "e1", name: "Ana", hireDate: "2026-08-01", baseSalary: q("5000"),
        contractType: "indefinido",
        photoPath: "   ",
      }),
    ]);
    expect(rejected[0]?.code).toBe("payroll.bad_attachment_path");
    const { rejected: blankCv } = project([
      evt("payroll.employee_created", {
        employeeId: "e1", name: "Ana", hireDate: "2026-08-01", baseSalary: q("5000"),
        contractType: "indefinido",
        cvPath: "",
      }),
    ]);
    expect(blankCv[0]?.code).toBe("payroll.bad_attachment_path");
  });

  it("rechaza department vacío o en blanco y persiste department válido", () => {
    const { rejected } = project([
      evt("payroll.employee_created", {
        employeeId: "e1", name: "Ana", hireDate: "2026-08-01", baseSalary: q("5000"),
        contractType: "indefinido",
        department: "   ",
      }),
    ]);
    expect(rejected[0]?.code).toBe("payroll.bad_department");
    const { state, rejected: ok } = project([
      evt("payroll.employee_created", {
        employeeId: "e1", name: "Ana", hireDate: "2026-08-01", baseSalary: q("5000"),
        contractType: "indefinido",
        department: "Ventas",
      }),
      evt("payroll.employee_updated", {
        employeeId: "e1",
        changes: { department: "Operaciones" },
      }),
    ]);
    expect(ok).toHaveLength(0);
    const emp = employeeById(state, "e1");
    expect(emp?.department).toBe("Operaciones");
  });

  it("identifica raíces del organigrama (rootEmployees) incluyendo empleados cuyo jefe fue archivado", () => {
    const { state } = project([
      evt("payroll.employee_created", {
        employeeId: "e1", name: "Ana (Gerente)", hireDate: "2026-08-01", baseSalary: q("9000"), contractType: "indefinido",
      }),
      evt("payroll.employee_created", {
        employeeId: "e2", name: "Carlos (Subdirector)", hireDate: "2026-08-01", baseSalary: q("7000"), contractType: "indefinido", managerId: "e1",
      }),
      evt("payroll.employee_created", {
        employeeId: "e3", name: "Beatriz (Especialista)", hireDate: "2026-08-01", baseSalary: q("5000"), contractType: "indefinido", managerId: "e2",
      }),
    ]);

    // Inicialmente solo e1 (Ana) es raíz
    expect(rootEmployees(state).map((e) => e.id)).toEqual(["e1"]);

    // Se archiva e2 (Carlos). Ahora Beatriz (e3) tiene jefe archivado -> se convierte en raíz visible
    const { state: stateAfterArchive } = project([
      evt("payroll.employee_created", {
        employeeId: "e1", name: "Ana (Gerente)", hireDate: "2026-08-01", baseSalary: q("9000"), contractType: "indefinido",
      }),
      evt("payroll.employee_created", {
        employeeId: "e2", name: "Carlos (Subdirector)", hireDate: "2026-08-01", baseSalary: q("7000"), contractType: "indefinido", managerId: "e1",
      }),
      evt("payroll.employee_created", {
        employeeId: "e3", name: "Beatriz (Especialista)", hireDate: "2026-08-01", baseSalary: q("5000"), contractType: "indefinido", managerId: "e2",
      }),
      evt("payroll.employee_archived", { employeeId: "e2" }),
    ]);

    // Raíces activas: Ana (e1) y Beatriz (e3) ordenada alfabéticamente
    const roots = rootEmployees(stateAfterArchive);
    expect(roots.map((e) => e.name)).toEqual(["Ana (Gerente)", "Beatriz (Especialista)"]);
  });

  it("persiste phone y email válidos del empleado", () => {
    const { state, rejected } = project([
      evt("payroll.employee_created", {
        employeeId: "e1", name: "Ana", hireDate: "2026-08-01", baseSalary: q("5000"), contractType: "indefinido",
        phone: "+502 5555 1234",
        email: "ana@empresa.gt",
      }),
      evt("payroll.employee_updated", {
        employeeId: "e1",
        changes: { phone: "+502 5555 9999", email: "ana.nueva@empresa.gt" },
      }),
    ]);
    expect(rejected).toHaveLength(0);
    const emp = employeeById(state, "e1");
    expect(emp?.phone).toBe("+502 5555 9999");
    expect(emp?.email).toBe("ana.nueva@empresa.gt");
  });

  it("acepta celulares extranjeros (código de país distinto de +502)", () => {
    const p = validateEmployeeDraft({ name: "Luis", phone: "+1 305 555 0100" });
    expect(p).toHaveLength(0);
  });

  it("rechaza email mal formado", () => {
    const p = validateEmployeeDraft({ name: "Ana", email: "ana@sin-punto" });
    expect(p.some((e) => e.code === "payroll.bad_email")).toBe(true);
  });

  it("rechaza celular con caracteres no permitidos o de largo inválido", () => {
    const chars = validateEmployeeDraft({ name: "Ana", phone: "555-12 3abc" });
    expect(chars.some((e) => e.code === "payroll.bad_phone")).toBe(true);
    const largo = validateEmployeeDraft({ name: "Ana", phone: "123" });
    expect(largo.some((e) => e.code === "payroll.bad_phone")).toBe(true);
  });

  it("rechaza NIT/CUI que no sea 8 o 13 dígitos", () => {
    const bad = validateEmployeeDraft({ name: "Ana", taxId: "ABCD1234" });
    expect(bad.some((e) => e.code === "payroll.bad_tax_id")).toBe(true);
    const validNIT = validateEmployeeDraft({ name: "Ana", taxId: "12345678" });
    expect(validNIT).toHaveLength(0);
    const validCUI = validateEmployeeDraft({ name: "Ana", taxId: "1234567890123" });
    expect(validCUI).toHaveLength(0);
  });
});