import { describe, expect, it } from "vitest";
import { activeCompanies, project, validateCompanyDraft, type AnyEvent } from "../src/index.js";

let seq = 0;
const at = (day: number) => `2026-08-${day.toString().padStart(2, "0")}T12:00:00.000Z`;
const evt = <T extends AnyEvent["type"]>(type: T, day: number, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: at(day), v: 1, type, payload } as AnyEvent);

describe("validateCompanyDraft", () => {
  it("acepta un draft valido", () => {
    expect(validateCompanyDraft({ name: "  Principal  ", baseCurrency: "GTQ" })).toEqual([]);
  });

  it("rechaza sin nombre", () => {
    const errors = validateCompanyDraft({ name: "  ", baseCurrency: "GTQ" });
    expect(errors[0]?.code).toBe("company.name_required");
  });

  it("rechaza sin moneda base", () => {
    const errors = validateCompanyDraft({ name: "Principal" });
    expect(errors[0]?.code).toBe("company.base_currency_required");
  });

  it("rechaza moneda base desconocida", () => {
    const errors = validateCompanyDraft({ name: "Principal", baseCurrency: "XXX" } as never);
    expect(errors[0]?.code).toBe("company.base_currency_unknown");
  });
});

describe("Proyeccion de empresas", () => {
  it("crea, actualiza y archiva una empresa", () => {
    const { state, rejected } = project([
      evt("company.created", 1, { companyId: "emp_1", name: "  Principal  ", baseCurrency: "GTQ" }),
      evt("company.updated", 2, { companyId: "emp_1", changes: { name: "Principal S.A." } }),
      evt("company.archived", 3, { companyId: "emp_1" }),
    ]);
    expect(rejected).toEqual([]);
    const company = state.companies.get("emp_1")!;
    expect(company).toMatchObject({
      id: "emp_1",
      name: "Principal S.A.",
      baseCurrency: "GTQ",
      archived: true,
      createdAt: at(1),
      updatedAt: at(3),
    });
    // La variante de hasta 2 digitos (el dia) no debe romper nada.
    expect(activeCompanies(state).map((c) => c.id)).toEqual([]);
  });

  it("rechaza duplicados", () => {
    const { state, rejected } = project([
      evt("company.created", 1, { companyId: "emp_1", name: "A", baseCurrency: "GTQ" }),
      evt("company.created", 2, { companyId: "emp_1", name: "B", baseCurrency: "USD" }),
    ]);
    expect(state.companies.size).toBe(1);
    expect(rejected[0]?.code).toBe("duplicate");
  });

  it("rechaza empresa inexistente al actualizar", () => {
    const { rejected } = project([evt("company.updated", 1, { companyId: "nope", changes: { name: "X" } })]);
    expect(rejected[0]?.code).toBe("not_found");
  });

  it("rechaza una empresa con base currency invalida (validacion de dominio)", () => {
    const { rejected } = project([
      evt("company.created", 1, { companyId: "emp_2", name: "A", baseCurrency: "XYZ" }),
    ]);
    expect(rejected[0]?.code).toBe("company.base_currency_unknown");
  });

  it("listado de activas excluye archivadas", () => {
    const { state } = project([
      evt("company.created", 1, { companyId: "emp_a", name: "A", baseCurrency: "GTQ" }),
      evt("company.created", 2, { companyId: "emp_b", name: "B", baseCurrency: "USD" }),
      evt("company.archived", 3, { companyId: "emp_b" }),
    ]);
    expect(activeCompanies(state).map((c) => c.id)).toEqual(["emp_a"]);
  });
});