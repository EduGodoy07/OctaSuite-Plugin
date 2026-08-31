import { describe, expect, it, vi } from "vitest";
import {
  assertSingleOperator,
  LocalNumberAuthority,
  RemoteNumberAuthority,
  type Transport,
} from "../src/index.js";

describe("Autoridad local", () => {
  it("asigna el siguiente correlativo de la serie", async () => {
    const authority = new LocalNumberAuthority((series) => (series === "A" ? 41 : undefined), "personal");
    await expect(authority.reserve("A")).resolves.toEqual({ series: "A", number: 42 });
    await expect(authority.reserve("B")).resolves.toEqual({ series: "B", number: 1 });
  });

  it("no se puede construir en modo conectado", () => {
    expect(() => new LocalNumberAuthority(() => 1, "conectado")).toThrow(/servidor/);
  });

  it("exige serie", async () => {
    const authority = new LocalNumberAuthority(() => 1, "personal");
    await expect(authority.reserve("  ")).rejects.toThrow(/serie/);
  });
});

describe("Autoridad remota", () => {
  it("usa el correlativo que reserva el servidor, no el local", async () => {
    const transport: Transport = vi.fn(async () => ({ series: "A", number: 108, token: "rsv_abc" }));
    const authority = new RemoteNumberAuthority(transport);
    await expect(authority.reserve("A")).resolves.toEqual({ series: "A", number: 108, token: "rsv_abc" });
    expect(transport).toHaveBeenCalledWith("documents/reserve-number", { series: "A" });
  });

  it("rechaza una respuesta sin correlativo utilizable", async () => {
    for (const bad of [null, {}, { number: "42" }, { number: 0 }, { number: 1.5 }]) {
      const authority = new RemoteNumberAuthority(async () => bad);
      await expect(authority.reserve("A")).rejects.toThrow(/servidor|invalido/);
    }
  });

  it("rechaza si el servidor reserva otra serie", async () => {
    const authority = new RemoteNumberAuthority(async () => ({ series: "B", number: 1 }));
    await expect(authority.reserve("A")).rejects.toThrow(/serie B/);
  });

  it("propaga la falla de red en vez de caer a numeracion local", async () => {
    const authority = new RemoteNumberAuthority(async () => {
      throw new Error("sin conexion");
    });
    await expect(authority.reserve("A")).rejects.toThrow(/sin conexion/);
  });
});

describe("Barrera de operador unico", () => {
  it("permite la operacion en modo personal", () => {
    expect(() => assertSingleOperator("personal", "Emitir factura")).not.toThrow();
  });

  it("la bloquea en modo conectado", () => {
    expect(() => assertSingleOperator("conectado", "Emitir factura")).toThrow(/requiere autoridad del servidor/);
  });
});
