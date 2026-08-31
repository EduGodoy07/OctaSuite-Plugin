import { describe, expect, it } from "vitest";
import { isValidNit, validatePartnerDraft } from "../src/index.js";

describe("NIT guatemalteco (modulo 11)", () => {
  it("acepta los vectores de referencia", () => {
    // 42932-5: 4*6+2*5+9*4+3*3+2*2 = 83; 83 mod 11 = 6; 11-6 = 5.
    expect(isValidNit("42932-5")).toBe(true);
    expect(isValidNit("429325")).toBe(true);
    // 3602978-5: suma 149; 149 mod 11 = 6; 11-6 = 5.
    expect(isValidNit("3602978-5")).toBe(true);
  });

  it("rechaza un digito verificador incorrecto", () => {
    expect(isValidNit("42932-4")).toBe(false);
    expect(isValidNit("3602978-1")).toBe(false);
  });

  it("acepta CF de consumidor final", () => {
    expect(isValidNit("CF")).toBe(true);
    expect(isValidNit("cf")).toBe(true);
  });

  it("rechaza basura", () => {
    expect(isValidNit("")).toBe(false);
    expect(isValidNit("ABC-1")).toBe(false);
    expect(isValidNit("K")).toBe(false);
  });
});

describe("Validacion de contacto", () => {
  it("exige nombre", () => {
    expect(validatePartnerDraft({ accountType: "company" }).map((e) => e.code)).toContain("partner.name_required");
  });

  it("valida correo y NIT si vienen", () => {
    const errors = validatePartnerDraft({ name: "Cliente", accountType: "company", email: "no-es-correo", taxId: "42932-4" });
    expect(errors.map((e) => e.code)).toEqual(["partner.email_invalid", "partner.tax_id_invalid"]);
  });

  it("una direccion requiere contacto padre", () => {
    expect(validatePartnerDraft({ name: "Bodega", accountType: "address" }).map((e) => e.code)).toEqual([
      "partner.parent_required",
    ]);
    expect(validatePartnerDraft({ name: "Bodega", accountType: "address", parentId: "par_1" })).toEqual([]);
  });
});
