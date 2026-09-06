import { describe, expect, it } from "vitest";
import { parseNaturalTask } from "../src/domain/task-nlp.js";

// Fecha base de prueba: Sábado 5 de Septiembre de 2026
const REF_DATE = new Date(2026, 8, 5, 10, 0, 0); // 2026-09-05

describe("task-nlp: Parser de lenguaje natural para tareas", () => {
  it("extrae título simple sin modificadores", () => {
    const res = parseNaturalTask("Comprar insumos de limpieza", REF_DATE);
    expect(res.title).toBe("Comprar insumos de limpieza");
    expect(res.due).toBeNull();
    expect(res.priority).toBe("normal");
    expect(res.scope).toBeUndefined();
  });

  it("reconoce prioridades con prefijo !", () => {
    const r1 = parseNaturalTask("Pagar impuestos SAT !urgent", REF_DATE);
    expect(r1.title).toBe("Pagar impuestos SAT");
    expect(r1.priority).toBe("urgent");

    const r2 = parseNaturalTask("Revisar inventario !alta", REF_DATE);
    expect(r2.title).toBe("Revisar inventario");
    expect(r2.priority).toBe("high");

    const r3 = parseNaturalTask("Archivar documentos viejos !baja", REF_DATE);
    expect(r3.title).toBe("Archivar documentos viejos");
    expect(r3.priority).toBe("low");
  });

  it("reconoce fechas relativas: hoy y mañana", () => {
    const r1 = parseNaturalTask("Llamar a proveedor hoy", REF_DATE);
    expect(r1.title).toBe("Llamar a proveedor");
    expect(r1.due).toBe("2026-09-05");

    const r2 = parseNaturalTask("Cobrar factura A-10 mañana", REF_DATE);
    expect(r2.title).toBe("Cobrar factura A-10");
    expect(r2.due).toBe("2026-09-06");

    const r3 = parseNaturalTask("Entregar pedido pasado mañana", REF_DATE);
    expect(r3.title).toBe("Entregar pedido");
    expect(r3.due).toBe("2026-09-07");
  });

  it("reconoce expresiones 'en N días' y 'en N semanas'", () => {
    const r1 = parseNaturalTask("Auditoría de caja en 3 días", REF_DATE);
    expect(r1.title).toBe("Auditoría de caja");
    expect(r1.due).toBe("2026-09-08");

    const r2 = parseNaturalTask("Renovar contrato en 2 semanas", REF_DATE);
    expect(r2.title).toBe("Renovar contrato");
    expect(r2.due).toBe("2026-09-19");
  });

  it("reconoce días de la semana (próximo día)", () => {
    // 2026-09-05 es Sábado. El próximo lunes es 2026-09-07.
    const r1 = parseNaturalTask("Reunión de equipo el lunes", REF_DATE);
    expect(r1.title).toBe("Reunión de equipo");
    expect(r1.due).toBe("2026-09-07");

    // El próximo viernes es 2026-09-11.
    const r2 = parseNaturalTask("Liquidación nómina viernes", REF_DATE);
    expect(r2.title).toBe("Liquidación nómina");
    expect(r2.due).toBe("2026-09-11");
  });

  it("reconoce fechas ISO explícitas (YYYY-MM-DD)", () => {
    const res = parseNaturalTask("Presentar informe 2026-09-30 !urgent", REF_DATE);
    expect(res.title).toBe("Presentar informe");
    expect(res.due).toBe("2026-09-30");
    expect(res.priority).toBe("urgent");
  });

  it("reconoce ámbito/scope (@global o @empresa)", () => {
    const r1 = parseNaturalTask("Comprar café para oficina @global", REF_DATE);
    expect(r1.title).toBe("Comprar café para oficina");
    expect(r1.scope).toBe("global");

    const r2 = parseNaturalTask("Declarar IVA @principal mañana !urgent", REF_DATE);
    expect(r2.title).toBe("Declarar IVA");
    expect(r2.scope).toBe("principal");
    expect(r2.due).toBe("2026-09-06");
    expect(r2.priority).toBe("urgent");
  });

  it("extrae hashtags como tags", () => {
    const res = parseNaturalTask("Revisar retenciones ISR #fiscal #sat mañana", REF_DATE);
    expect(res.title).toBe("Revisar retenciones ISR");
    expect(res.tags).toEqual(["fiscal", "sat"]);
    expect(res.due).toBe("2026-09-06");
  });
});
