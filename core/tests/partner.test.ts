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

  it("acepta un NIT de 9 digitos derivado del CUI (SAT-DSI-393-2025)", () => {
    // Los NIT emitidos desde abril 2023 son los primeros 9 digitos del CUI.
    // El algoritmo de verificacion es equivalente al modulo 11 ponderado del NIT
    // por congruencia modulo 11 (0 divergencias en 200k frentes de 8 digitos).
    expect(isValidNit("123456789")).toBe(true);
    expect(isValidNit("101010109")).toBe(true);
  });

  it("acepta un CUI completo de 13 digitos como NIT (SAT-DSI-393-2025)", () => {
    // Desde marzo 2025 el CUI completo de 13 digitos se acepta como NIT en FEL.
    // El digito verificador del CUI es el digito 9 (no el 13): pesos 2..9 sobre
    // los primeros 8 digitos, comparacion directa mod 11.
    // 12345678: 1*2+2*3+3*4+4*5+5*6+6*7+7*8+8*9 = 240; 240 % 11 = 9. dept 01 mun 01.
    expect(isValidNit("1234567890101")).toBe(true);
    // 10101010: 1*2+0*3+1*4+0*5+1*6+0*7+1*8+0*9 = 20; 20 % 11 = 9. dept 01 mun 01.
    expect(isValidNit("1010101090101")).toBe(true);
    // Con separadores (formato CUI comun 1234-56789-0101)
    expect(isValidNit("1234-56789-0101")).toBe(true);
  });

  it("rechaza un CUI con digito verificador incorrecto o geografia invalida", () => {
    // 12345678 -> check 9, pero ponemos 8.
    expect(isValidNit("1234567880101")).toBe(false);
    // Municipio 00 (invalido) en departamento 01.
    expect(isValidNit("1234567890100")).toBe(false);
    // Departamento 99 (invalido).
    expect(isValidNit("1234567899901")).toBe(false);
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
