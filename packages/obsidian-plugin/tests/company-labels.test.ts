import { describe, expect, it } from "vitest";
import { buildActiveLabel, companyDisplayName, companyLabel } from "../src/ui/company-labels.js";

describe("companyLabel", () => {
  it("marca la primaria como destino de escrituras", () => {
    expect(companyLabel("principal")).toBe("principal (principal)");
  });

  it("capitaliza el resto de empresas", () => {
    expect(companyLabel("miel")).toBe("Miel");
  });
});

describe("buildActiveLabel", () => {
  it("una sola empresa muestra su nombre", () => {
    expect(buildActiveLabel(["principal"])).toBe("principal (principal)");
  });

  it("dos empresas muestra ambas", () => {
    expect(buildActiveLabel(["principal", "miel"])).toBe("principal (principal) y Miel");
  });

  it("tres empresas muestra las tres", () => {
    expect(buildActiveLabel(["principal", "miel", "cacao"])).toBe(
      "principal (principal), Miel y Cacao",
    );
  });

  it("cuatro o más muestra las tres primeras y el conteo restante", () => {
    expect(buildActiveLabel(["principal", "miel", "cacao", "avena"])).toBe(
      "principal (principal), Miel, Cacao y 1 más",
    );
    expect(buildActiveLabel(["principal", "miel", "cacao", "avena", "trigo"])).toBe(
      "principal (principal), Miel, Cacao y 2 más",
    );
  });

  it("lista vacía cae a la primaria", () => {
    expect(buildActiveLabel([])).toBe("principal (principal)");
  });
});

describe("companyDisplayName", () => {
  it("usa el nombre real del journal si existe (empresa creada)", () => {
    expect(companyDisplayName("arepa", "The Arepa Factory", "Otra S.A.")).toBe("The Arepa Factory");
  });

  it("empresa principal sin nombre en journal usa el companyName de settings", () => {
    expect(companyDisplayName("principal", undefined, "The Arepa Factory")).toBe("The Arepa Factory");
  });

  it("empresa no-principal sin nombre en journal NO usa companyName global", () => {
    // El nombre comercial de settings es de la principal; para otra empresa el
    // journal es la única fuente del nombre real, si no hay, cae al label.
    expect(companyDisplayName("arepa", undefined, "The Arepa Factory")).toBe("Arepa");
  });

  it("cae al label técnico cuando no hay nombre real disponible", () => {
    expect(companyDisplayName("principal", undefined, "")).toBe("principal (principal)");
    expect(companyDisplayName("miel", undefined, "")).toBe("Miel");
  });

  it("nombre de journal vacío o con espacios no cuenta como real", () => {
    // Sin nombre real en el journal, una no-principal no toma el companyName
    // global (es de la principal): cae al label técnico.
    expect(companyDisplayName("miel", "   ", "Comercial Miel")).toBe("Miel");
    expect(companyDisplayName("miel", "", "")).toBe("Miel");
  });

  it("principal con journal vacío y companyName vacío cae al label técnico", () => {
    expect(companyDisplayName("principal", "  ", "")).toBe("principal (principal)");
  });
});