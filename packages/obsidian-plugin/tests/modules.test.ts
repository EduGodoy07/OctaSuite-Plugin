/**
 * Regresión de la detección de vistas de OctaSuite por prefijo.
 *
 * Causa raíz (2026-09-08): la flecha «volver al inicio» de Contabilidad no
 * encontraba la hoja del launcher porque allí se usaban nombres de vista con
 * una constante divergida; la detección por prefijo de main.ts sí reutilizaba
 * la hoja. Este test blinda que NUNCA se vuelva a una lista exacta: cualquier
 * vista `octasuite-*` (vigente, legacy o de versiones futuras) debe contarse
 * como hoja de OctaSuite, mientras que las vistas de otros plugins no.
 */
import { describe, expect, it } from "vitest";
import { isOctaSuiteViewType, VIEW_TYPE_PREFIX } from "../src/modules";
import { KNOWN_VIEW_TYPES } from "../src/modules";

describe("isOctaSuiteViewType (detección por prefijo)", () => {
  it("reconoce toda vista vigente registrada en KNOWN_VIEW_TYPES", () => {
    for (const viewType of KNOWN_VIEW_TYPES) {
      expect(isOctaSuiteViewType(viewType), viewType).toBe(true);
    }
  });

  it("reconoce vistas legacy/divergidas con el prefijo (la causa raíz de la flecha)", () => {
    // «octasuite-cashier» no está en KNOWN_VIEW_TYPES: es de una versión
    // anterior o de una constante divergida (como el bug del 2026-09-08).
    expect(isOctaSuiteViewType("octasuite-cashier")).toBe(true);
    expect(isOctaSuiteViewType("octasuite-unknown-future-view")).toBe(true);
  });

  it("NO reconoce vistas de otros plugins ni tipo sin el prefijo", () => {
    expect(isOctaSuiteViewType("markdown")).toBe(false);
    expect(isOctaSuiteViewType("google-calendar")).toBe(false);
    expect(isOctaSuiteViewType("")).toBe(false);
    expect(isOctaSuiteViewType("octa-")).toBe(false);
  });

  it("el prefijo es exactamente octasuite- (la constante que usa main.ts)", () => {
    expect(VIEW_TYPE_PREFIX).toBe("octasuite-");
  });
});