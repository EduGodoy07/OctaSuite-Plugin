import type { CurrencyMeta } from "../money.js";

/**
 * Catalogo minimo (seed por defecto). El catalogo completo se exporta de la
 * tabla `currencies` de OctaSuite a `octasuite-data/catalogs/currencies.json`
 * y, al cargarse via `registerCurrencies` (adaptador de Obsidian), sobreescribe
 * este seed en el registro en memoria. El seed nunca se muta: sigue siendo el
 * valor inicial hasta que un catalogo externo lo reemplace.
 */
export const CURRENCIES: readonly CurrencyMeta[] = [
  { code: "GTQ", name: "Quetzal guatemalteco", symbol: "Q", decimals: 2 },
  { code: "USD", name: "Dolar estadounidense", symbol: "$", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
  { code: "MXN", name: "Peso mexicano", symbol: "$", decimals: 2 },
];

export const DEFAULT_CURRENCY = "GTQ";

/**
 * Registro mutable. El dominio puro no lee archivos del vault, asi que el
 * catalogo vive en memoria con el seed como valor inicial y puede reemplazarse
 * por completo con `registerCurrencies` cuando el adaptador carga un JSON.
 */
let registry: readonly CurrencyMeta[] = CURRENCIES;

/**
 * Reemplaza el catalogo de monedas en memoria por uno cargado desde fuera
 * (ej. `octasuite-data/catalogs/currencies.json`). Los consumidores del dominio
 * (`rate.ts`, `company.ts`) siguen llamando a `currencyMeta`/`decimalsFor`, que
 * leen del registro, de modo que ningun call-site cambia.
 */
export function registerCurrencies(entries: readonly CurrencyMeta[]): void {
  registry = entries;
}

export function currencyMeta(code: string): CurrencyMeta | undefined {
  return registry.find((c) => c.code === code);
}

export function decimalsFor(code: string): number {
  return currencyMeta(code)?.decimals ?? 2;
}
