import type { CurrencyMeta } from "../money.js";

/**
 * Catalogo minimo. El catalogo completo se exporta de la tabla `currencies` de
 * OctaSuite a `octasuite-data/catalogs/currencies.json` y sobreescribe esto.
 */
export const CURRENCIES: readonly CurrencyMeta[] = [
  { code: "GTQ", name: "Quetzal guatemalteco", symbol: "Q", decimals: 2 },
  { code: "USD", name: "Dolar estadounidense", symbol: "$", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
  { code: "MXN", name: "Peso mexicano", symbol: "$", decimals: 2 },
];

export const DEFAULT_CURRENCY = "GTQ";

export function currencyMeta(code: string): CurrencyMeta | undefined {
  return CURRENCIES.find((c) => c.code === code);
}

export function decimalsFor(code: string): number {
  return currencyMeta(code)?.decimals ?? 2;
}
