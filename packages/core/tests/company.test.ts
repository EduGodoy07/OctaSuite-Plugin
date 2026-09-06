import { describe, expect, it } from "vitest";
import {
  activeCompanies,
  project,
  slugifyCompanyId,
  validateCompanyDraft,
  validateCompanyId,
  type AnyEvent,
} from "../src/index.js";

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

describe("slugifyCompanyId", () => {
  it("minúsculas y espacios a guiones", () => {
    expect(slugifyCompanyId("Segunda Empresa")).toBe("segunda-empresa");
    expect(slugifyCompanyId("  Principal  ")).toBe("principal");
  });

  it("quita acentos", () => {
    expect(slugifyCompanyId("Cafetería Águila")).toBe("cafeteria-aguila");
  });

  it("colapsa símbolos no-alfanuméricos y recorta bordes", () => {
    expect(slugifyCompanyId("Mi -- Empresa!!!")).toBe("mi-empresa");
    expect(slugifyCompanyId("---emp---")).toBe("emp");
  });

  it("devuelve vacío si no quedan caracteres utilizables", () => {
    expect(slugifyCompanyId("!!!")).toBe("");
  });

  it("salida no vacía de slugify siempre es un companyId válido", () => {
    const names = ["Mi Empresa", "Café & Té", "!!!", "---", "A", "Empresa 123", "Ñoño", "Alcázar Real"];
    for (const name of names) {
      const slug = slugifyCompanyId(name);
      if (slug) {
        expect(validateCompanyId(slug)).toEqual([]);
      }
    }
  });
});

describe("validateCompanyId", () => {
  it("acepta ids válidos incluyendo 'principal'", () => {
    expect(validateCompanyId("principal")).toEqual([]);
    expect(validateCompanyId("secundaria-2")).toEqual([]);
    expect(validateCompanyId("emp1")).toEqual([]);
  });

  it("rechaza vacío", () => {
    expect(validateCompanyId("")[0]?.code).toBe("company.id_required");
  });

  it("rechaza mayúsculas, espacios y símbolos inválidos", () => {
    expect(validateCompanyId("Segunda")[0]?.code).toBe("company.id_invalid");
    expect(validateCompanyId("segunda empresa")[0]?.code).toBe("company.id_invalid");
    expect(validateCompanyId("emp_1")[0]?.code).toBe("company.id_invalid");
    expect(validateCompanyId("mi.empresa")[0]?.code).toBe("company.id_invalid");
  });

  it("rechaza ids con más de 64 caracteres", () => {
    const long = "a".repeat(65);
    expect(validateCompanyId(long)[0]?.code).toBe("company.id_too_long");
  });

  it("acepta ids de exactamente 64 caracteres", () => {
    expect(validateCompanyId("a".repeat(64))).toEqual([]);
  });
});