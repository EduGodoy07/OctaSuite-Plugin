import type { IsoDate, IsoInstant, MonthKey } from "../dates.js";
import { DomainError, fail } from "../errors.js";
import { add, compare, isNegative, multiply, percentOf, subtract, sum, type Money } from "../money.js";

// ── Política salarial ─────────────────────────────────────────────────
//
// Todo valor normativo vive acá, en una política versionada por fecha. Si
// Guatemala cambia el salario mínimo, un tramo del ISR o una tasa del IGSS,
// se agrega una política nueva — el journal de nómina ya procesado NO se
// retoca (las líneas llevan su snapshot, igual que las facturas).

export interface IsrBracket {
  /** Límite inferior mensual, en centavos. Inclusivo. */
  readonly fromMinor: number;
  /** Límite superior mensual, en centavos. Exclusivo. */
  readonly toMinor: number;
  /** Tasa marginal sobre el exceso de `fromMinor`, en porcentaje. */
  readonly rate: number;
  /** Impuesto fijo acumulado hasta `fromMinor`, en centavos. */
  readonly fixedMinor: number;
}

export interface PayrollPolicy {
  readonly id: string;
  readonly label: string;
  /** Desde qué fecha de procesamiento aplica (ISO). */
  readonly effectiveFrom: IsoDate;
  /** Tasa IGSS del empleado (descuento), en porcentaje. */
  readonly igssEmployeeRate: number;
  /** Tasa IGSS patronal (costo de la empresa), en porcentaje. */
  readonly igssEmployerRate: number;
  /** Tope del salario cotizable mensual: 4× salario mínimo. */
  readonly igssSalaryCap: Money;
  readonly minimumWage: Money;
  readonly isrBrackets: readonly IsrBracket[];
}

/**
 * Política vigente. Valores de referencia — VERIFICAR CONTRA FUENTE OFICIAL
 * antes de usarlos para pagar: Acuerdo Gubernativo 269-2024 (salario mínimo
 * 2025-2026: Q3,594.55) y Decreto 10-2012 art. 72 (tarifa mensual ISR).
 * Tarifas IGSS: Ley del IGSS, art. 30 (4.83% empleado / 12.67% patronal).
 */
export const CURRENT_PAYROLL_POLICY: PayrollPolicy = {
  id: "pol-2026",
  label: "Política laboral 2026",
  effectiveFrom: "2026-01-01",
  igssEmployeeRate: 4.83, // VERIFICAR CONTRA FUENTE OFICIAL (IGSS)
  igssEmployerRate: 12.67, // VERIFICAR CONTRA FUENTE OFICIAL (IGSS)
  igssSalaryCap: { minor: 1_437_820, currency: "GTQ" }, // 4 × Q3,594.55 — VERIFICAR
  minimumWage: { minor: 359_455, currency: "GTQ" }, // VERIFICAR CONTRA FUENTE OFICIAL
  isrBrackets: [
    { fromMinor: 0, toMinor: 30_000, rate: 0, fixedMinor: 0 }, // Q0.00 – Q300.00 → exento
    { fromMinor: 30_000, toMinor: 75_000, rate: 5, fixedMinor: 0 }, // Q300.01 – Q750.00
    { fromMinor: 75_000, toMinor: 125_000, rate: 7, fixedMinor: 2_250 }, // Q750.01 – Q1,250.00
    { fromMinor: 125_000, toMinor: 210_000, rate: 10, fixedMinor: 5_750 }, // Q1,250.01 – Q2,100.00
    { fromMinor: 210_000, toMinor: 335_000, rate: 15, fixedMinor: 14_250 }, // Q2,100.01 – Q3,350.00
    { fromMinor: 335_000, toMinor: 850_000, rate: 20, fixedMinor: 33_000 }, // Q3,350.01 – Q8,500.00
    { fromMinor: 850_000, toMinor: Number.MAX_SAFE_INTEGER, rate: 25, fixedMinor: 136_000 }, // Q8,500.01+
  ], // VERIFICAR CONTRA FUENTE OFICIAL (SAT, tarifa mensual ISR)
} as const;

/** Devuelve la última política cuyo `effectiveFrom` es anterior o igual a la fecha. */
export function currentPayrollPolicy(date: IsoDate): PayrollPolicy {
  return CURRENT_PAYROLL_POLICY; // v1: política única; el versionado es por fecha desde acá
}

function assertGross(gross: Money, policy: PayrollPolicy): void {
  if (gross.currency !== policy.minimumWage.currency) {
    fail("payroll.currency_mismatch", `Esperaba ${policy.minimumWage.currency}, recibió ${gross.currency}`);
  }
  if (isNegative(gross)) fail("payroll.negative_gross", "El salario no puede ser negativo");
}

/** Cotiza IGSS del empleado sobre el salario bruto, con tope de 4× salario mínimo. */
export function igssDeduction(gross: Money, policy: PayrollPolicy): Money {
  assertGross(gross, policy);
  const base = compare(gross, policy.igssSalaryCap) > 0 ? policy.igssSalaryCap : gross;
  return percentOf(base, policy.igssEmployeeRate);
}

/** Costo patronal IGSS sobre el salario bruto, con el mismo tope. */
export function igssEmployerContribution(gross: Money, policy: PayrollPolicy): Money {
  assertGross(gross, policy);
  const base = compare(gross, policy.igssSalaryCap) > 0 ? policy.igssSalaryCap : gross;
  return percentOf(base, policy.igssEmployerRate);
}

/**
 * Retención ISR sobre la renta del trabajo (tarifa mensual). El imponible es
 * el salario bruto menos el descuento IGSS del empleado.
 * Redondeo: centavos completos, mismo criterio que el resto del sistema.
 */
export function isrOnSalary(taxable: Money, policy: PayrollPolicy): Money {
  assertGross(taxable, policy);
  for (const bracket of policy.isrBrackets) {
    if (taxable.minor >= bracket.fromMinor && taxable.minor < bracket.toMinor) {
      const excess = taxable.minor - bracket.fromMinor;
      const marginal = Math.round((excess * bracket.rate) / 100);
      return { minor: bracket.fixedMinor + marginal, currency: taxable.currency };
    }
  }
  return { minor: 0, currency: taxable.currency }; // sin tramo: exento
}

/**
 * Bono 14 anual: un salario mensual completo (100%) por año trabajado
 * (art. 183 Código de Trabajo, Decreto 42-92). Quien no completó el período
 * (1-jul a 30-jun) recibe la parte proporcional por días laborados.
 */
export function bono14AnnualEntitlement(highestSalary: Money, workedDays: number, periodDays = 365): Money {
  assertProration(workedDays, periodDays);
  return multiply(highestSalary, Math.min(1, workedDays / periodDays));
}

/**
 * Aguinaldo anual: un salario mensual completo (100%) por año trabajado
 * (art. 102 Código de Trabajo). Quien no completó el año calendario recibe
 * la parte proporcional por días laborados.
 */
export function aguinaldoAnnualEntitlement(highestSalary: Money, workedDays: number, periodDays = 365): Money {
  assertProration(workedDays, periodDays);
  return multiply(highestSalary, Math.min(1, workedDays / periodDays));
}

/** Un prorrateo válido exige días no negativos y un período de al menos un día. */
function assertProration(workedDays: number, periodDays: number): void {
  if (!Number.isFinite(workedDays) || workedDays < 0) {
    fail("payroll.invalid_worked_days", `Días trabajados inválidos: ${workedDays}`);
  }
  if (!Number.isFinite(periodDays) || periodDays <= 0) {
    fail("payroll.invalid_period_days", `Días del período inválidos: ${periodDays}`);
  }
}

/** Provisión mensual del Bono 14: anual / 12. */
export function bono14MonthlyProvision(gross: Money): Money {
  return multiply(gross, 1 / 12);
}

/** Provisión mensual del aguinaldo: anual / 12. */
export function aguinaldoMonthlyProvision(gross: Money): Money {
  return multiply(gross, 1 / 12);
}

// ── Empleados ─────────────────────────────────────────────────────────

export type ContractType = "fijo" | "indefinido" | "temporal";

export interface Employee {
  readonly id: string;
  readonly name: string;
  /** Puesto u ocupación (texto libre, ej. "Cajero"). Impacta el organigrama. */
  readonly position?: string;
  /** ID del jefe directo. Raíz del organigrama = sin managerId. Admite N niveles. */
  readonly managerId?: string;
  /** Responsabilidades elegidas del catálogo estándar. Lista plana: sin notas ni fechas. */
  readonly responsibilities?: readonly string[];
  /** NIT/CUI opcional; si viene, se espera el formato guatemalteco. */
  readonly taxId?: string;
  /** Móvil personal del empleado (contacto). El móvil corporativo asignado vive en el inventario de equipos. */
  readonly phone?: string;
  /** Email del empleado (contacto; personal o corporativo). */
  readonly email?: string;
  readonly hireDate: IsoDate;
  readonly baseSalary: Money;
  readonly contractType?: ContractType;
  /** Path en el vault del retrato del empleado (relativo a la raíz del vault). */
  readonly photoPath?: string;
  /** Path en el vault del CV en PDF del empleado (relativo a la raíz del vault). */
  readonly cvPath?: string;
  /** Departamento/área del empleado (texto libre, ej. "Ventas", "Operaciones"). Usado para agrupar en el organigrama. */
  readonly department?: string;
  readonly archived: boolean;
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
}

export type EmployeeDraft = Omit<Employee, "id" | "archived" | "createdAt" | "updatedAt">;

/**
 * Catálogo estándar de responsabilidades, editable en código (mismo patrón que
 * la política salarial): cambiar este arreglo NO reescribe empleados ya
 * creados — cada empleado guarda su propia lista en el journal.
 */
export const STANDARD_RESPONSIBILITIES: readonly string[] = [
  "Apertura y cierre de tienda",
  "Administración",
  "Atención al cliente",
  "Caja y arqueos",
  "Compras",
  "Control de inventario",
  "Facturación",
  "Recibo de mercadería",
  "Reposición de producto",
  "Supervisión de personal",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s().-]{7,20}$/;
const TAX_ID_RE = /^(\d{8}|\d{13})$/;

export function validateEmployeeDraft(draft: Partial<EmployeeDraft>): DomainError[] {
  const errors: DomainError[] = [];
  if (!draft.name?.trim()) errors.push(new DomainError("El nombre del empleado es obligatorio", "payroll.name_required"));
  if (draft.baseSalary && (isNegative(draft.baseSalary) || draft.baseSalary.minor === 0)) {
    errors.push(new DomainError("El salario base debe ser mayor a cero", "payroll.bad_salary"));
  }
  if (draft.hireDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(draft.hireDate)) {
    errors.push(new DomainError(`Fecha de contratación inválida: ${draft.hireDate}`, "payroll.bad_date"));
  }
  if (draft.contractType && !["fijo", "indefinido", "temporal"].includes(draft.contractType)) {
    errors.push(new DomainError(`Tipo de contrato inválido: ${draft.contractType}`, "payroll.bad_contract"));
  }
  if (draft.photoPath !== undefined && draft.photoPath.trim() === "") {
    errors.push(new DomainError("El path de la foto no puede estar vacío", "payroll.bad_attachment_path"));
  }
  if (draft.cvPath !== undefined && draft.cvPath.trim() === "") {
    errors.push(new DomainError("El path del CV no puede estar vacío", "payroll.bad_attachment_path"));
  }
  if (draft.department !== undefined && draft.department.trim() === "") {
    errors.push(new DomainError("El departamento no puede estar vacío", "payroll.bad_department"));
  }
  // Contacto: opcionales, pero si vienen con contenido se validan. El celular
  // admite cualquier código de país (empleados extranjeros), no solo +502.
  if (draft.email !== undefined && draft.email.trim() !== "" && !EMAIL_RE.test(draft.email.trim())) {
    errors.push(new DomainError(`Email inválido: ${draft.email}`, "payroll.bad_email"));
  }
  if (draft.phone !== undefined && draft.phone.trim() !== "" && !PHONE_RE.test(draft.phone.trim())) {
    errors.push(new DomainError(`Celular inválido: ${draft.phone}`, "payroll.bad_phone"));
  }
  // NIT guatemalteco = 8 dígitos; CUI = 13 dígitos. Vacío/ausente = ok.
  if (draft.taxId !== undefined && draft.taxId.trim() !== "" && !TAX_ID_RE.test(draft.taxId.trim())) {
    errors.push(new DomainError(`NIT/CUI inválido: ${draft.taxId}`, "payroll.bad_tax_id"));
  }
  return errors;
}

// ── Liquidación de nómina ─────────────────────────────────────────────

export interface PayrollInput {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly gross: Money;
}

export interface PayrollLine {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly gross: Money;
  readonly igssEmployee: Money;
  /** Salario imponible para ISR: bruto − IGSS empleado. */
  readonly taxBase: Money;
  readonly isr: Money;
  readonly net: Money;
  readonly igssEmployer: Money;
  readonly bono14Provision: Money;
  readonly aguinaldoProvision: Money;
  /** Costo total para la empresa: bruto + IGSS patronal + provisiones. */
  readonly totalCost: Money;
}

export function computePayrollLine(input: PayrollInput, policy: PayrollPolicy): PayrollLine {
  assertGross(input.gross, policy);
  const igssEmployee = igssDeduction(input.gross, policy);
  const taxBase = subtract(input.gross, igssEmployee);
  const isr = isrOnSalary(taxBase, policy);
  const net = subtract(subtract(input.gross, igssEmployee), isr);
  const igssEmployer = igssEmployerContribution(input.gross, policy);
  const bono14Provision = bono14MonthlyProvision(input.gross);
  const aguinaldoProvision = aguinaldoMonthlyProvision(input.gross);
  const totalCost = add(add(add(input.gross, igssEmployer), bono14Provision), aguinaldoProvision);
  return {
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    gross: input.gross,
    igssEmployee,
    taxBase,
    isr,
    net,
    igssEmployer,
    bono14Provision,
    aguinaldoProvision,
    totalCost,
  };
}

export interface PayrollTotals {
  readonly gross: Money;
  readonly igssEmployee: Money;
  readonly isr: Money;
  readonly net: Money;
  readonly igssEmployer: Money;
  readonly bono14Provision: Money;
  readonly aguinaldoProvision: Money;
  readonly totalCost: Money;
}

export function computePayrollTotals(lines: readonly PayrollLine[], currency: "GTQ"): PayrollTotals {
  const pick = (key: keyof PayrollLine): Money => {
    const values = lines.map((line) => line[key] as Money);
    return sum(values, currency);
  };
  return {
    gross: pick("gross"),
    igssEmployee: pick("igssEmployee"),
    isr: pick("isr"),
    net: pick("net"),
    igssEmployer: pick("igssEmployer"),
    bono14Provision: pick("bono14Provision"),
    aguinaldoProvision: pick("aguinaldoProvision"),
    totalCost: pick("totalCost"),
  };
}

/**
 * Verifica la aritmética de una nómina procesada: cada línea debe ser
 * internamente consistente y los totales deben ser la suma de sus líneas.
 * La política NO se re-aplica (puede haber cambiado después): se valida la
 * forma, no la tasa. Devuelve null si todo cuadra.
 */
export function verifyPayrollTotals(lines: readonly PayrollLine[], totals: PayrollTotals): DomainError | null {
  const eq = (a: Money, b: Money) => compare(a, b) === 0;
  for (const line of lines) {
    if (isNegative(line.gross)) return new DomainError("Línea de nómina con salario negativo", "payroll.negative_gross");
    if (!eq(line.taxBase, subtract(line.gross, line.igssEmployee))) {
      return new DomainError(`Línea de ${line.employeeName}: imponible ≠ bruto − IGSS`, "payroll.line_drift");
    }
    if (!eq(line.net, subtract(subtract(line.gross, line.igssEmployee), line.isr))) {
      return new DomainError(`Línea de ${line.employeeName}: neto ≠ bruto − IGSS − ISR`, "payroll.line_drift");
    }
    const expectedCost = add(add(add(line.gross, line.igssEmployer), line.bono14Provision), line.aguinaldoProvision);
    if (!eq(line.totalCost, expectedCost)) {
      return new DomainError(`Línea de ${line.employeeName}: costo total inconsistente`, "payroll.line_drift");
    }
  }
  const recomputed = computePayrollTotals(lines, "GTQ");
  const drift = (
    ["gross", "igssEmployee", "isr", "net", "igssEmployer", "bono14Provision", "aguinaldoProvision", "totalCost"] as const
  ).filter((key) => !eq(totals[key], recomputed[key]));
  if (drift.length > 0) {
    return new DomainError(`Los totales no cuadran: ${drift.join(", ")}`, "payroll.totals_drift");
  }
  return null;
}

// ── Períodos procesados ───────────────────────────────────────────────

export interface PayrollRun {
  readonly id: string;
  readonly month: MonthKey;
  readonly lines: readonly PayrollLine[];
  readonly totals: PayrollTotals;
  readonly processedAt: IsoInstant;
}