import { describe, expect, it } from "vitest";
import {
  convert,
  fromDecimal,
  money,
  project,
  rateFor,
  roundHalfUp,
  toDecimalString,
  validateExchangeRateDraft,
  type AnyEvent,
  type ExchangeRate,
  type Money,
} from "../src/index.js";

let seq = 0;
const at = (day: number) => `2026-08-${day.toString().padStart(2, "0")}T12:00:00.000Z`;
const evt = <T extends AnyEvent["type"]>(type: T, day: number, payload: unknown): AnyEvent =>
  ({ id: `e${++seq}`, at: at(day), v: 1, type, payload } as AnyEvent);

const g2u = (day: number, rate: number, source = "manual" as const): AnyEvent =>
  evt("rate.updated", day, {
    rateId: `r_${day}`,
    from: "GTQ",
    to: "USD",
    rate,
    date: `2026-08-${day.toString().padStart(2, "0")}`,
    source,
  });

describe("validateExchangeRateDraft", () => {
  it("acepta un draft valido", () => {
    expect(validateExchangeRateDraft({ from: "GTQ", to: "USD", rate: 0.129, date: "2026-08-10", source: "manual" })).toEqual([]);
  });

  it("source por defecto es manual si se omite", () => {
    expect(validateExchangeRateDraft({ from: "GTQ", to: "USD", rate: 0.129, date: "2026-08-10" })).toEqual([]);
  });

  it("rechaza monedas iguales", () => {
    const errors = validateExchangeRateDraft({ from: "GTQ", to: "GTQ", rate: 1, date: "2026-08-10" });
    expect(errors[0]?.code).toBe("rate.same_currency");
  });

  it("rechaza tasa cero, negativa o no finita", () => {
    expect(validateExchangeRateDraft({ from: "GTQ", to: "USD", rate: 0, date: "2026-08-10" })[0]?.code).toBe("rate.invalid");
    expect(validateExchangeRateDraft({ from: "GTQ", to: "USD", rate: -2, date: "2026-08-10" })[0]?.code).toBe("rate.invalid");
    expect(validateExchangeRateDraft({ from: "GTQ", to: "USD", rate: NaN, date: "2026-08-10" })[0]?.code).toBe("rate.invalid");
  });

  it("rechaza fecha invalida", () => {
    const errors = validateExchangeRateDraft({ from: "GTQ", to: "USD", rate: 0.129, date: "10-08-2026" as never });
    expect(errors[0]?.code).toBe("rate.date_invalid");
  });

  it("rechaza moneda desconocida", () => {
    const errors = validateExchangeRateDraft({ from: "XXX" as never, to: "USD", rate: 0.129, date: "2026-08-10" });
    expect(errors[0]?.code).toBe("rate.from_unknown");
  });

  it("rechaza source invalida", () => {
    const errors = validateExchangeRateDraft({
      from: "GTQ",
      to: "USD",
      rate: 0.129,
      date: "2026-08-10",
      source: "banco" as never,
    });
    expect(errors[0]?.code).toBe("rate.source_invalid");
  });
});

describe("convert", () => {
  const rate: ExchangeRate = {
    id: "r1",
    from: "GTQ",
    to: "USD",
    rate: 0.129,
    date: "2026-08-10",
    source: "manual",
    createdAt: at(1),
  };

  it("convierte de la moneda origen a la destino", () => {
    const out = convert(fromDecimal("1000.00", "GTQ"), rate);
    expect(out).toEqual<Money>(money(12900, "USD")); // Q1000.00 * 0.129 = $129.00
  });

  it("convierte a la inversa (USD->GTQ con la tasa inversa)", () => {
    const inverse: ExchangeRate = { ...rate, id: "r2", from: "USD", to: "GTQ", rate: 7.752 };
    const out = convert(fromDecimal("129.00", "USD"), inverse);
    // $129.00 * 7.752 = 1000.008 -> Q1000.01 (HALF-UP)
    expect(toDecimalString(out)).toBe("1000.01");
  });

  it("redondea HALF-UP al centavo", () => {
    const out = convert(fromDecimal("1.00", "GTQ"), { ...rate, rate: 0.12955 });
    // Q1.00 * 0.12955 = 0.12955 USD -> 12.955 centavos -> 13 centavos
    expect(out.minor).toBe(13);
    expect(roundHalfUp(12955, 2) / 100).toBe(129.55);
  });

  it("devuelve el importe si la moneda destino ya es la del importe", () => {
    expect(convert(money(100, "USD"), rate)).toEqual(money(100, "USD"));
  });

  it("falla si la tasa no corresponde a la moneda del importe", () => {
    expect(() => convert(fromDecimal("100.00", "EUR"), rate)).toThrow(/no convierte EUR/);
  });
});

describe("Proyeccion de tasas", () => {
  it("guarda la tasa y rateFor devuelve la vigente para la fecha", () => {
    const { state, rejected } = project([
      evt("rate.updated", 5, { rateId: "r1", from: "GTQ", to: "USD", rate: 0.12, date: "2026-08-05", source: "manual" }),
      evt("rate.updated", 10, { rateId: "r2", from: "GTQ", to: "USD", rate: 0.129, date: "2026-08-10", source: "auto" }),
    ]);
    expect(rejected).toEqual([]);
    expect(state.rates.size).toBe(2);
    // Para el dia 8 todavia aplica la primera
    expect(rateFor(state, "GTQ", "USD", "2026-08-08")?.rate).toBe(0.12);
    // Para el dia 10 y despues aplica la segunda
    const vigente = rateFor(state, "GTQ", "USD", "2026-08-12")!;
    expect(vigente.rate).toBe(0.129);
    expect(vigente.source).toBe("auto");
  });

  it("rechaza una tasa duplicada (mismo rateId)", () => {
    const { state, rejected } = project([g2u(10, 0.12), g2u(10, 0.13)]);
    expect(state.rates.size).toBe(1);
    expect(rejected[0]?.code).toBe("duplicate");
    expect(state.rates.get("r_10")!.rate).toBe(0.12);
  });

  it("source por defecto es manual en la proyeccion", () => {
    const { state } = project([
      evt("rate.updated", 10, { rateId: "r3", from: "GTQ", to: "USD", rate: 0.129, date: "2026-08-10" }),
    ]);
    expect(state.rates.get("r3")!.source).toBe("manual");
  });

  it("rechaza una tasa invalida (mismas monedas)", () => {
    const { state, rejected } = project([
      evt("rate.updated", 10, { rateId: "r4", from: "GTQ", to: "GTQ", rate: 1, date: "2026-08-10" }),
    ]);
    expect(state.rates.size).toBe(0);
    expect(rejected[0]?.code).toBe("rate.same_currency");
  });
});