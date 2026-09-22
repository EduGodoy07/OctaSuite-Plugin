/**
 * Regresión — Organigrama por bloques (payroll-view.ts renderOrgchart).
 *
 * Bug real (2026-09-12, demostrado con datos ficticios): el organigrama
 * quedaba VACÍO (SVG 16×300, 0 bloques, 0 tarjetas) porque
 * layoutBlocks(null, …) lee byManager.get("") y el bucle que construye
 * byManager saltea a los empleados sin managerId (`if (!employee.managerId)
 * continue;`). rootEmployees() sí los identifica como raíces, pero el valor
 * nunca se usaba para poblar el nivel "".
 *
 * Fix mínimo: byManager.set("", roots) — el "sin jefe" entra como el bloque
 * raíz que layoutBlocks(null, …) espera.
 *
 * Nota de dominio: NO se puede crear un empleado cuyo managerId no exista
 * (el core rechaza el evento). El "huérfano" real es el de jefe ARCHIVADO
 * (caso cubierto por rootEmployees y verificado en el test de huérfano).
 */
import { describe, expect, it } from "vitest";
import { project, fromDecimal } from "@octasuite/core";
import type { AnyEvent } from "@octasuite/core";
import { PayrollView } from "../src/ui/payroll-view.js";
import { FakeNode, count, findFirst, installFakeDocument } from "./dom-stub.js";

installFakeDocument();

let seq = 0;
const evt = (type: AnyEvent["type"], payload: unknown): AnyEvent =>
  ({ id: `r${++seq}`, at: "2026-09-12T08:00:00.000Z", v: 1, type, payload } as AnyEvent);

function buildState() {
  const q = (v: string) => fromDecimal(v, "GTQ");
  return project([
    evt("payroll.employee_created", {
      employeeId: "e1", name: "Ana Gerente", hireDate: "2026-01-15",
      baseSalary: q("9000"), contractType: "indefinido", department: "Dirección",
    }),
    evt("payroll.employee_created", {
      employeeId: "e2", name: "Luis Finanzas", hireDate: "2026-02-01",
      baseSalary: q("6500"), contractType: "indefinido", department: "Finanzas", managerId: "e1",
    }),
    evt("payroll.employee_created", {
      employeeId: "e3", name: "Pedro Ventas", hireDate: "2026-03-01",
      baseSalary: q("3800"), contractType: "indefinido", department: "Ventas", managerId: "e1",
    }),
  ] as AnyEvent[]);
}

/** Huérfano por archivo del jefe: el caso real que rootEmployees documenta. */
function buildStateArchivedManager() {
  const q = (v: string) => fromDecimal(v, "GTQ");
  return project([
    evt("payroll.employee_created", {
      employeeId: "e1", name: "Ana Gerente", hireDate: "2026-01-15",
      baseSalary: q("9000"), contractType: "indefinido", department: "Dirección",
    }),
    evt("payroll.employee_created", {
      employeeId: "e2", name: "Luis Finanzas", hireDate: "2026-02-01",
      baseSalary: q("6500"), contractType: "indefinido", department: "Finanzas", managerId: "e1",
    }),
    evt("payroll.employee_created", {
      employeeId: "e3", name: "Óscar Huérfano", hireDate: "2026-03-01",
      baseSalary: q("3200"), contractType: "indefinido", managerId: "e2",
    }),
    evt("payroll.employee_archived", { employeeId: "e2" }),
  ] as AnyEvent[]);
}

function renderOrgchart(stateProject: ReturnType<typeof project>) {
  const root = new FakeNode("root");
  const { state } = stateProject;
  const view = Object.create(PayrollView.prototype) as PayrollView & {
    contentEl: FakeNode;
    host: unknown;
  };
  view.contentEl = root;
  view.host = { state } as never;
  (view as unknown as { renderOrgchart(): void }).renderOrgchart();
  return { root, svg: findFirst(root, (n) => n.tag === "svg")! };
}

describe("Organigrama por bloques (renderOrgchart)", () => {
  it("renderiza bloque raíz y bloques de subordinados (sin fix: 0 bloques)", () => {
    const { svg } = renderOrgchart(buildState());
    const blocks = count(svg, (n) => n.tag === "rect" && n.attrs.class === "octa-orgchart-block-bg");
    // Dirección (e1) en raíz + Finanzas (e2) y Ventas (e3) bajo e1
    expect(blocks).toBe(3);
  });

  it("dibuja una tarjeta de nombre por empleado activo", () => {
    const { svg } = renderOrgchart(buildState());
    const names = count(svg, (n) => n.tag === "text" && (n.attrs.class ?? "").includes("octa-orgchart-name"));
    expect(names).toBe(3);
  });

  it("produce un SVG con ancho real (no el vacío 16px del bug)", () => {
    const { svg } = renderOrgchart(buildState());
    expect(Number(svg.attrs.width)).toBeGreaterThan(300);
  });

  it("el subordinado de un jefe archivado aparece como raíz (Sin departamento)", () => {
    const { svg } = renderOrgchart(buildStateArchivedManager());
    const blocks = count(svg, (n) => n.tag === "rect" && n.attrs.class === "octa-orgchart-block-bg");
    // Dirección (e1) + Sin departamento (e3, cuyo jefe fue archivado)
    expect(blocks).toBe(2);
    const names = count(svg, (n) => n.tag === "text" && (n.attrs.class ?? "").includes("octa-orgchart-name"));
    expect(names).toBe(2);
  });
});