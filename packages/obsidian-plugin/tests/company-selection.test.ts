import { describe, expect, it } from "vitest";
import { migrateActiveCompanyIds, normalizeActiveCompanyIds } from "../src/company-selection.js";

/**
 * Selección de empresa multi-empresa.
 *
 * `activeCompanyIds` es el estado fuente: lista ordenada (la primera es la
 * PRIMARIA, destino de escrituras) de empresas a las que miran dashboards y
 * reportes.
 *
 * Dos funciones con una sola responsabilidad cada una:
 * - `migrateActiveCompanyIds(stored)`: deriva la lista desde settings
 *   (migración v1 → v2). NO conoce el disco: la salida puede contener
 *   duplicados o empresas borradas.
 * - `normalizeActiveCompanyIds(ids, available, fallback)`: sana una lista
 *   pedida por el usuario contra las empresas disponibles: dedupe
 *   preservando orden, descarta no disponibles, nunca vacía. `reload()` la
 *   aplica sobre la salida de migrate (y sobre cada toggle del usuario).
 */

const AVAILABLE = ["redcat", "the-arepa-factory", "golden-leaf-dispensary"];

describe("normalizeActiveCompanyIds", () => {
  it("quita duplicados preservando el primer orden", () => {
    const ids = normalizeActiveCompanyIds(["redcat", "the-arepa-factory", "redcat"], AVAILABLE, "redcat");
    expect(ids).toEqual(["redcat", "the-arepa-factory"]);
  });

  it("filtra empresas no disponibles", () => {
    const ids = normalizeActiveCompanyIds(["redcat", "empresa-borrada", "the-arepa-factory"], AVAILABLE, "redcat");
    expect(ids).toEqual(["redcat", "the-arepa-factory"]);
  });

  it("preserva el orden de entrada de las válidas", () => {
    const ids = normalizeActiveCompanyIds(["the-arepa-factory", "redcat"], AVAILABLE, "redcat");
    expect(ids).toEqual(["the-arepa-factory", "redcat"]);
  });

  it("lista vacía -> fallback", () => {
    const ids = normalizeActiveCompanyIds([], AVAILABLE, "golden-leaf-dispensary");
    expect(ids).toEqual(["golden-leaf-dispensary"]);
  });

  it("solo no disponibles -> fallback", () => {
    const ids = normalizeActiveCompanyIds(["fantasma-1", "fantasma-2"], AVAILABLE, "redcat");
    expect(ids).toEqual(["redcat"]);
  });
});

describe("migrateActiveCompanyIds", () => {
  it("usa activeCompanyIds si ya existe (v2)", () => {
    const ids = migrateActiveCompanyIds({ activeCompanyIds: ["the-arepa-factory", "redcat"], activeCompanyId: "redcat" });
    expect(ids).toEqual(["the-arepa-factory", "redcat"]);
  });

  it("no muta la lista guardada", () => {
    const stored = { activeCompanyIds: ["redcat"] } as const;
    const ids = migrateActiveCompanyIds(stored);
    ids.push("the-arepa-factory");
    expect(stored.activeCompanyIds).toEqual(["redcat"]);
  });

  it("deriva de activeCompanyId cuando falta la lista (migración v1)", () => {
    const ids = migrateActiveCompanyIds({ activeCompanyId: "golden-leaf-dispensary" });
    expect(ids).toEqual(["golden-leaf-dispensary"]);
  });

  it("sin lista ni id -> por defecto", () => {
    const ids = migrateActiveCompanyIds({});
    expect(ids).toEqual(["principal"]);
  });

  it("lista vacía explícita -> deriva de activeCompanyId", () => {
    const ids = migrateActiveCompanyIds({ activeCompanyIds: [], activeCompanyId: "redcat" });
    expect(ids).toEqual(["redcat"]);
  });

  it("no valida contra el disco: la limpieza la hace normalize en reload", () => {
    const ids = migrateActiveCompanyIds({ activeCompanyId: "empresa-borrada" });
    expect(ids).toEqual(["empresa-borrada"]);
  });
});