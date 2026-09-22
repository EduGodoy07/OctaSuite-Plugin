/**
 * DEMO — Organigrama por bloques con empleados FICTICIOS (código real).
 *
 * Propósito (directiva de Eduardo: "llena puestos con info ficticia para ver
 * que en realidad funciona"): construir un estado REAL del core con empleados
 * ficticios (raíces, cadena de mando, con/sin departamento, huérfanos) y
 * ejecutar el método renderOrgchart() REAL de payroll-view.ts contra un stub
 * de DOM, serializando el SVG producido.
 *
 * Este archivo NO es el test de regresión final (ver payroll-orgchart.test.ts):
 * es la evidencia de qué hace el código actual. Console.log + dump a /tmp.
 */
import { describe, it } from "vitest";
import { project, fromDecimal } from "@octasuite/core";
import type { AnyEvent } from "@octasuite/core";
import { PayrollView } from "../src/ui/payroll-view.js";
import { FakeNode, count, findFirst, installFakeDocument, serialize } from "./dom-stub.js";

// El paquete "obsidian" de npm solo trae tipos, sin export runtime.
// Se resuelve en runtime vía resolve.alias → tests/obsidian-stub.ts
installFakeDocument();

// ── Estado real del core con empleados ficticios ───────────────────────
let seq = 0;
const evt = (type: AnyEvent["type"], payload: unknown): AnyEvent =>
  ({ id: `d${++seq}`, at: "2026-09-12T08:00:00.000Z", v: 1, type, payload } as AnyEvent);

function buildState() {
  const q = (v: string) => fromDecimal(v, "GTQ");
  return project([
    evt("payroll.employee_created", {
      employeeId: "e1", name: "Ana Gerente", hireDate: "2026-01-15",
      baseSalary: q("9000"), contractType: "indefinido", department: "Dirección",
    }),
    evt("payroll.employee_created", {
      employeeId: "e2", name: "Luis Jefe Finanzas", hireDate: "2026-02-01",
      baseSalary: q("6500"), contractType: "indefinido", department: "Finanzas", managerId: "e1",
    }),
    evt("payroll.employee_created", {
      employeeId: "e3", name: "María Analista", hireDate: "2026-03-01",
      baseSalary: q("4500"), contractType: "indefinido", department: "Finanzas", managerId: "e2",
    }),
    evt("payroll.employee_created", {
      employeeId: "e4", name: "Pedro Ventas", hireDate: "2026-04-01",
      baseSalary: q("3800"), contractType: "indefinido", department: "Ventas", managerId: "e1",
    }),
    evt("payroll.employee_created", {
      employeeId: "e5", name: "Sofía Sin Departamento", hireDate: "2026-05-01",
      baseSalary: q("3000"), contractType: "indefinido", managerId: "e1",
    }),
    evt("payroll.employee_created", {
      employeeId: "e6", name: "Óscar Junior", hireDate: "2026-06-01",
      baseSalary: q("3200"), contractType: "indefinido", department: "Finanzas", managerId: "e2",
    }),
  ] as AnyEvent[]);
}

describe("DEMO organigrama por bloques (código real, datos ficticios)", () => {
  it("ejecuta renderOrgchart real y vuelca el SVG a /tmp", async () => {
    const root = new FakeNode("root");
    const { state } = buildState();

    const host = { state } as never;
    // El constructor de ItemView no corre con el stub vacío de obsidian,
    // pero como PayrollView no usa el constructor para renderOrgchart,
    // instanciamos directo y le inyectamos contentEl + host.
    const view = Object.create(PayrollView.prototype) as PayrollView & {
      contentEl: FakeNode;
      host: unknown;
    };
    view.contentEl = root;
    view.host = host;

    // Ejecución REAL del método real
    (view as unknown as { renderOrgchart(): void }).renderOrgchart();

    // Recolectar datos de la salida (el <svg> queda anidado dentro del wrap)
    const svg = findFirst(root, (n) => n.tag === "svg")!;
    const blocks = count(svg, (n) => n.tag === "rect" && n.attrs.class === "octa-orgchart-block-bg");
    const names = count(svg, (n) => n.tag === "text" && (n.attrs.class ?? "").includes("octa-orgchart-name"));
    const labels = count(svg, (n) => n.tag === "text" && n.attrs.class === "octa-orgchart-block-label");
    const texts = count(svg, (n) => n.tag === "text");
    const edgesGroups = count(svg, (n) => n.tag === "g" && n.attrs.class === "octa-orgchart-edges");
    const width = svg?.attrs.width;
    const height = svg?.attrs.height;

    console.log("=".repeat(72));
    console.log("EMPLEADOS FICTICIOS (dominio real @octasuite/core): 6");
    console.log("  e1 Ana Gerente (raíz, Dirección)");
    console.log("  e2 Luis Jefe Finanzas (jefe e1, Finanzas)");
    console.log("  e3 María Analista (jefe e2, Finanzas)");
    console.log("  e4 Pedro Ventas (jefe e1, Ventas)");
    console.log("  e5 Sofía Sin Departamento (jefe e1, sin dept)");
    console.log("  e6 Óscar Junior (jefe e2, Finanzas)");
    console.log("  Nota: un managerId inexistente sería RECHAZADO por el core (invariante);");
    console.log("        el huérfano real es el de jefe archivado (ver payroll-orgchart.test.ts).");
    console.log("-".repeat(72));
    console.log(`SVG generado: <svg width="${width}" height="${height}" class="${svg?.attrs.class}">`);
    console.log(`  bloque(s) VISIBLES (rect.octa-orgchart-block-bg): ${blocks}`);
    console.log(`  label(s) de bloque (text.octa-orgchart-block-label): ${labels}`);
    console.log(`  tarjeta(s) empleado (text.octa-orgchart-name):      ${names}`);
    console.log(`  texto(s) SVG:                                        ${texts}`);
    console.log(`  grupo(s) de conectores (edges):                      ${edgesGroups}`);
    console.log(`  KPI row presente:                                    ${root.children.some((c) => c.attrs.class === "octa-kpi-row")}`);
    console.log("=".repeat(72));

    const xml = serialize(svg);
    const fs = await import("node:fs");
    fs.writeFileSync("/tmp/octa-orgchart-demo.svg", `<?xml version="1.0"?>\n${xml}\n`);
    console.log("SVG serializado → /tmp/octa-orgchart-demo.svg");
    console.log(xml.slice(0, 1200));
  });
});