import { describe, expect, it } from "vitest";
import { applyNaturalToForm } from "../src/ui/task-natural";

const REF_DATE = new Date(2026, 8, 5, 10, 0, 0); // Sábado 2026-09-05

const BASE_FORM = {
  title: "",
  priority: "normal" as const,
  due: "",
};

describe("task-natural: autofill del modal de tareas desde lenguaje natural", () => {
  it("limpia el título y aplica due + prioridad cuando hay tokens NL", () => {
    const res = applyNaturalToForm("Pagar SAT mañana !alta", BASE_FORM, REF_DATE);
    expect(res).toEqual({
      title: "Pagar SAT",
      priority: "high",
      due: "2026-09-06",
    });
  });

  it("devuelve null cuando no hay tokens NL (no interfiere con el submit directo)", () => {
    expect(applyNaturalToForm("Comprar leche", BASE_FORM, REF_DATE)).toBeNull();
    expect(applyNaturalToForm("", BASE_FORM, REF_DATE)).toBeNull();
  });

  it("conserva la prioridad ya elegida si el texto no trae token de prioridad", () => {
    const res = applyNaturalToForm(
      "Revisar contrato mañana",
      { ...BASE_FORM, priority: "urgent" },
      REF_DATE,
    );
    expect(res?.priority).toBe("urgent");
    expect(res?.due).toBe("2026-09-06");
  });

  it("NO pisa una due ya seteada si el texto no trae fecha", () => {
    const res = applyNaturalToForm(
      "Llamar a proveedor !urgent",
      { ...BASE_FORM, due: "2026-09-30" },
      REF_DATE,
    );
    expect(res?.priority).toBe("urgent");
    expect(res?.due).toBe("2026-09-30");
  });

  it("aplica prioridad del texto aunque el form tenga otra (el token manda)", () => {
    const res = applyNaturalToForm(
      "Limpiar inbox !baja",
      { ...BASE_FORM, priority: "high" },
      REF_DATE,
    );
    expect(res?.priority).toBe("low");
  });

  it("EN: también entiende términos ingleses en el modal", () => {
    const res = applyNaturalToForm("File VAT return day after tomorrow !medium", BASE_FORM, REF_DATE);
    expect(res).toEqual({
      title: "File VAT return",
      priority: "normal",
      due: "2026-09-07",
    });
  });
});