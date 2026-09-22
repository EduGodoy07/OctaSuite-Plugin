import { describe, expect, it } from "vitest";
import { buildActiveLabel, companyLabel } from "../src/ui/company-labels.js";

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