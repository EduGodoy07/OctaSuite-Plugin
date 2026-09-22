import { describe, expect, it } from "vitest";
import { assertIsoDate, isWithin, monthKeyOf, monthRange, parseLocalDate, toIsoDate } from "../src/index.js";

describe("Fechas", () => {
  it("interpreta la fecha como civil local, no como UTC", () => {
    // new Date("2026-08-01") es UTC y en Guatemala (UTC-6) cae el 31/07.
    const d = parseLocalDate("2026-08-01");
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(7);
    expect(toIsoDate(d)).toBe("2026-08-01");
  });

  it("rechaza fechas inexistentes en el calendario", () => {
    expect(() => assertIsoDate("2026-02-30")).toThrow(/inexistente/);
    expect(() => assertIsoDate("2026-13-01")).toThrow();
    expect(() => assertIsoDate("24/08/2026")).toThrow();
    expect(assertIsoDate("2024-02-29")).toBe("2024-02-29");
  });

  it("calcula el rango real del mes", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange("2026-08")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("ubica una fecha dentro del periodo", () => {
    expect(monthKeyOf("2026-08-24")).toBe("2026-08");
    expect(isWithin("2026-08-31", monthRange("2026-08"))).toBe(true);
    expect(isWithin("2026-09-01", monthRange("2026-08"))).toBe(false);
  });
});
