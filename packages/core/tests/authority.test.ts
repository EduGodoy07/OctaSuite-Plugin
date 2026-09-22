import { describe, expect, it } from "vitest";
import { LocalNumberAuthority } from "../src/index.js";

describe("Autoridad local (modo Personal, único modo soportado)", () => {
  it("asigna el siguiente correlativo de la serie, de forma síncrona", () => {
    const authority = new LocalNumberAuthority((series) => (series === "A" ? 41 : undefined));
    const first = authority.reserve("A");
    // El contrato es síncrono: el resultado es el objeto, no una Promise.
    expect(first).toEqual({ series: "A", number: 42 });
    expect(first).not.toBeInstanceOf(Promise);
    expect(authority.reserve("B")).toEqual({ series: "B", number: 1 });
  });

  it("vuelve a 1 cuando la serie no tiene correlativo previo", () => {
    const authority = new LocalNumberAuthority(() => undefined);
    expect(authority.reserve("X")).toEqual({ series: "X", number: 1 });
  });

  it("reporta el modo personal", () => {
    const authority = new LocalNumberAuthority(() => 1);
    expect(authority.mode).toBe("personal");
  });

  it("exige serie", () => {
    const authority = new LocalNumberAuthority(() => 1);
    expect(() => authority.reserve("  ")).toThrow(/serie/);
  });
});